import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../../../db/index.js";
import {
  accessGroups,
  operators,
  platformAccessGroups,
  platformAccounts,
  tenants,
} from "../../../db/schema.js";
import { requireSession } from "../../../lib/auth-session.js";
import { hashPassword } from "../../../lib/auth-crypto.js";
import { canManagePlatformAccess, revokeAccountSessions } from "../../../lib/platform-access.js";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const bad = (message: string, status = 400) => json({ error: message }, status);

export const Route = createFileRoute("/api/platform/access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        if (!(await canManagePlatformAccess(auth.session.operator)))
          return bad("Permissão insuficiente.", 403);

        const tenantRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
        const groups = await db.select().from(platformAccessGroups);
        const accounts = await db
          .select({
            id: platformAccounts.id,
            email: platformAccounts.email,
            groupId: platformAccounts.groupId,
            homeTenantId: platformAccounts.homeTenantId,
          })
          .from(platformAccounts);
        const localGroups: Record<string, { id: string; name: string }[]> = {};
        const memberships: Record<
          string,
          {
            id: string;
            tenantId: string;
            accountId: string | null;
            name: string;
            email: string;
            role: string;
            groupId: string | null;
          }[]
        > = {};
        for (const tenant of tenantRows) {
          localGroups[tenant.id] = await db
            .select({ id: accessGroups.id, name: accessGroups.name })
            .from(accessGroups)
            .where(eq(accessGroups.tenantId, tenant.id));
          memberships[tenant.id] = await db
            .select({
              id: operators.id,
              tenantId: operators.tenantId,
              accountId: operators.accountId,
              name: operators.name,
              email: operators.email,
              role: operators.role,
              groupId: operators.groupId,
            })
            .from(operators)
            .where(and(eq(operators.tenantId, tenant.id), isNotNull(operators.accountId)));
        }
        return json({ tenants: tenantRows, groups, accounts, localGroups, memberships });
      },
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (!(await canManagePlatformAccess(session.operator)))
          return bad("Permissão insuficiente.", 403);
        const body = await request.json().catch(() => ({}));
        const action = body.action;

        if (action === "save-group") {
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const requested = Array.isArray(body.allowedTenants) ? body.allowedTenants : [];
          const tenantRows = await db.select({ id: tenants.id }).from(tenants);
          const valid = new Set(tenantRows.map((row) => row.id));
          const allowedTenants = [...new Set(requested)].filter(
            (id): id is string => typeof id === "string" && valid.has(id),
          );
          if (!name || allowedTenants.length === 0 || allowedTenants.length !== requested.length) {
            return bad("Informe o nome e empresas válidas, sem duplicações.");
          }
          if (body.id) {
            const existing = await db.query.platformAccessGroups.findFirst({
              where: eq(platformAccessGroups.id, body.id),
            });
            if (!existing) return bad("Grupo não encontrado.", 404);
            await db
              .update(platformAccessGroups)
              .set({ name, allowedTenants })
              .where(eq(platformAccessGroups.id, existing.id));
            const members = await db
              .select({ id: platformAccounts.id })
              .from(platformAccounts)
              .where(eq(platformAccounts.groupId, existing.id));
            for (const member of members) await revokeAccountSessions(member.id);
            return json({ success: true, id: existing.id });
          }
          const id = randomUUID();
          await db.insert(platformAccessGroups).values({ id, name, allowedTenants });
          return json({ success: true, id }, 201);
        }

        if (action === "remove-member") {
          if (typeof body.accountId !== "string") return bad("Conta obrigatória.");
          const account = await db.query.platformAccounts.findFirst({
            where: eq(platformAccounts.id, body.accountId),
          });
          if (!account) return bad("Conta não encontrada.", 404);
          await db
            .update(platformAccounts)
            .set({ groupId: null })
            .where(eq(platformAccounts.id, account.id));
          await revokeAccountSessions(account.id);
          return json({ success: true });
        }

        if (action !== "assign-member") return bad("Ação inválida.");
        if (typeof body.operatorId !== "string" || typeof body.groupId !== "string")
          return bad("Operador e grupo são obrigatórios.");
        const source = await db.query.operators.findFirst({
          where: and(eq(operators.id, body.operatorId), eq(operators.tenantId, tenantId)),
        });
        const group = await db.query.platformAccessGroups.findFirst({
          where: eq(platformAccessGroups.id, body.groupId),
        });
        if (!source || !group) return bad("Operador ou grupo não encontrado.", 404);
        if (!group.allowedTenants.includes(tenantId))
          return bad("O grupo deve incluir a empresa atual.");

        const targetGroups: Record<string, string> =
          body.localGroupIds && typeof body.localGroupIds === "object" ? body.localGroupIds : {};
        const targetRoles: Record<string, string> =
          body.targetRoles && typeof body.targetRoles === "object" ? body.targetRoles : {};
        const targetOperators: Record<string, typeof source | null> = {};
        for (const targetTenant of group.allowedTenants) {
          if (targetTenant === tenantId) continue;
          const existing = await db.query.operators.findFirst({
            where: and(
              eq(operators.tenantId, targetTenant),
              sql`lower(${operators.email}) = ${source.email.toLowerCase()}`,
            ),
          });
          if (existing && existing.accountId && existing.accountId !== source.accountId) {
            return bad(`O e-mail já está vinculado a outra conta em ${targetTenant}.`, 409);
          }
          if (existing && !existing.accountId && body.confirmExisting !== true) {
            return json(
              {
                error:
                  "Já existe um operador com esse e-mail na empresa de destino. Confirme o vínculo existente.",
                existingOperator: {
                  id: existing.id,
                  name: existing.name,
                  role: existing.role,
                  tenantId: targetTenant,
                },
              },
              409,
            );
          }
          const targetRole =
            targetRoles[targetTenant] === "admin" || targetRoles[targetTenant] === "agent"
              ? targetRoles[targetTenant]
              : (existing?.role ?? "agent");
          const localGroupId = targetGroups[targetTenant] || existing?.groupId;
          if (targetRole !== "admin" || localGroupId) {
            if (!localGroupId) return bad(`Selecione o grupo local para ${targetTenant}.`);
            const localGroup = await db.query.accessGroups.findFirst({
              where: and(
                eq(accessGroups.id, localGroupId),
                eq(accessGroups.tenantId, targetTenant),
              ),
            });
            if (!localGroup) return bad(`Grupo local inválido para ${targetTenant}.`);
          }
          targetOperators[targetTenant] = existing ?? null;
        }

        const existingAccount = source.accountId
          ? await db.query.platformAccounts.findFirst({
              where: eq(platformAccounts.id, source.accountId),
            })
          : await db.query.platformAccounts.findFirst({
              where: eq(platformAccounts.email, source.email.toLowerCase()),
            });
        if (existingAccount && !source.accountId)
          return bad(
            "Este e-mail já possui outra conta multiempresa. Resolva o vínculo antes de continuar.",
            409,
          );
        const accountId = existingAccount?.id ?? randomUUID();
        await db.transaction(async (tx) => {
          if (existingAccount) {
            await tx
              .update(platformAccounts)
              .set({ groupId: group.id })
              .where(eq(platformAccounts.id, accountId));
          } else {
            await tx.insert(platformAccounts).values({
              id: accountId,
              email: source.email.toLowerCase(),
              passwordHash: source.passwordHash,
              homeTenantId: tenantId,
              groupId: group.id,
            });
          }
          await tx
            .update(operators)
            .set({ accountId })
            .where(and(eq(operators.id, source.id), eq(operators.tenantId, tenantId)));
          for (const targetTenant of group.allowedTenants) {
            if (targetTenant === tenantId) continue;
            const target = targetOperators[targetTenant];
            const targetRole =
              targetRoles[targetTenant] === "admin" || targetRoles[targetTenant] === "agent"
                ? targetRoles[targetTenant]
                : (target?.role ?? "agent");
            const localGroupId = targetGroups[targetTenant] || target?.groupId || null;
            if (target) {
              await tx
                .update(operators)
                .set({ accountId, groupId: localGroupId, role: targetRole })
                .where(and(eq(operators.id, target.id), eq(operators.tenantId, targetTenant)));
            } else {
              await tx.insert(operators).values({
                id: randomUUID(),
                tenantId: targetTenant,
                accountId,
                name: source.name,
                email: source.email.toLowerCase(),
                passwordHash: hashPassword(randomUUID()),
                role: targetRole,
                groupId: localGroupId,
                avatar: source.avatar,
                status: "disponivel",
                isOnline: false,
              });
            }
          }
        });
        if (existingAccount) await revokeAccountSessions(accountId);
        return json({ success: true, accountId });
      },
    },
  },
});
