import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db/index.js";
import { accessGroups, operators, crmActionHistory } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../../lib/auth-session.js";
import { handleConditionalResponse } from "../../lib/http-cache.js";
import { DEFAULT_DENY_PERMISSIONS } from "../../lib/rbac";
import { mergeGroupPermissions } from "../../lib/access-control/group-settings";
import { validatePermissionPatch } from "../../lib/access-control/group-validation";
import { groupRevision, withGroupRevision } from "../../lib/access-control/group-revision";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: corsHeaders });
const flags = ["canCreateUser", "canResetPassword", "canEditProfile", "canCaptureChat",
  "canTransferChat", "canFinishChat", "canViewAllChats", "canOverrideChat"] as const;

export const Route = createFileRoute("/api/groups")({
  server: { handlers: {
    OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
    GET: async ({ request }) => {
      const auth = await requireSession(request);
      if ("response" in auth) return auth.response;
      const tenantId = auth.session.tenantId;
      try {
        const list = await db.select().from(accessGroups).where(eq(accessGroups.tenantId, tenantId));
        return handleConditionalResponse(request, list.map(withGroupRevision), { headers: corsHeaders });
      } catch (error) {
        console.error("[groups] Falha ao listar grupos", error);
        return json({ error: "Não foi possível consultar os grupos." }, 500);
      }
    },
    POST: async ({ request }) => {
      const auth = await requireSession(request);
      if ("response" in auth) return auth.response;
      const { session } = auth;
      const tenantId = session.tenantId;
      if (session.operator.role !== "admin") return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
      const body = await request.json().catch(() => null);
      if (!body || typeof body.id !== "string" || !body.id.trim() || body.id.length > 160 ||
          typeof body.name !== "string" || !body.name.trim() || body.name.length > 160) {
        return json({ error: "id e name válidos são obrigatórios." }, 400);
      }
      if (body.allowedChannels !== undefined && (!Array.isArray(body.allowedChannels) ||
          !body.allowedChannels.every((channel: unknown) => typeof channel === "string" &&
            ["whatsapp", "instagram", "messenger", "livechat"].includes(channel)))) {
        return json({ error: "Canais inválidos." }, 400);
      }
      for (const flag of flags) {
        if (body[flag] !== undefined && typeof body[flag] !== "boolean") return json({ error: `${flag} deve ser booleano.` }, 400);
      }
      try {
        return await db.transaction(async (tx) => {
          const [existing] = await tx.select().from(accessGroups).where(and(
            eq(accessGroups.id, body.id), eq(accessGroups.tenantId, tenantId),
          )).for("update").limit(1);
          if (existing) {
            const expected = body.expectedRevision ?? body.revision;
            if (expected !== groupRevision(existing)) return json({
              error: "Este grupo foi alterado ou sua tela está desatualizada. Recarregue antes de salvar.",
              code: "GROUP_VERSION_CONFLICT", group: withGroupRevision(existing),
            }, 409);
          }
          if (body.permissions !== undefined) {
            const invalid = validatePermissionPatch(body.permissions, existing?.permissions);
            if (invalid) return json({ error: invalid, code: "INVALID_PERMISSIONS" }, 400);
          }
          const patch: Record<string, any> = {
            name: body.name.trim(),
            allowedTenants: [tenantId],
            allowedChannels: body.allowedChannels ?? existing?.allowedChannels ?? [],
            permissions: body.permissions === undefined
              ? existing?.permissions ?? structuredClone(DEFAULT_DENY_PERMISSIONS)
              : mergeGroupPermissions(existing?.permissions ?? DEFAULT_DENY_PERMISSIONS, body.permissions),
          };
          for (const flag of flags) patch[flag] = body[flag] ?? existing?.[flag] ?? false;
          const [saved] = existing
            ? await tx.update(accessGroups).set(patch).where(and(
                eq(accessGroups.id, body.id), eq(accessGroups.tenantId, tenantId),
              )).returning()
            : await tx.insert(accessGroups).values({ ...patch, id: body.id, tenantId } as any).returning();
          // Recovery copy and update are atomic; no operator passwords or channel credentials.
          await tx.insert(crmActionHistory).values({
            id: crypto.randomUUID(), tenantId, operatorId: session.operator.id,
            operatorName: session.operator.name, action: existing ? "update_access_group" : "create_access_group",
            entityType: "access_group", itemCount: 1,
            details: { groupId: saved.id, before: existing ?? null, after: saved,
              beforeRevision: existing ? groupRevision(existing) : null, afterRevision: groupRevision(saved) },
          });
          return json(withGroupRevision(saved));
        });
      } catch (error) {
        console.error("[groups] Falha ao salvar grupo", error);
        return json({ error: "Não foi possível salvar o grupo. Nenhuma alteração parcial foi mantida." }, 500);
      }
    },
    DELETE: async ({ request }) => {
      const auth = await requireSession(request);
      if ("response" in auth) return auth.response;
      const { session } = auth;
      const tenantId = session.tenantId;
      if (session.operator.role !== "admin") return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
      const url = new URL(request.url), id = url.searchParams.get("id");
      if (!id) return json({ error: "id é obrigatório." }, 400);
      if (id === "group-admin") return json({ error: "O grupo padrão de administradores não pode ser excluído." }, 400);
      try {
        return await db.transaction(async (tx) => {
          const [existing] = await tx.select().from(accessGroups).where(and(
            eq(accessGroups.id, id), eq(accessGroups.tenantId, tenantId),
          )).for("update").limit(1);
          if (!existing) return json({ error: "Grupo não encontrado." }, 404);
          if (url.searchParams.get("revision") !== groupRevision(existing)) return json({
            error: "Recarregue o grupo antes de excluir.", code: "GROUP_VERSION_CONFLICT",
          }, 409);
          const [member] = await tx.select({ id: operators.id }).from(operators).where(and(
            eq(operators.groupId, id), eq(operators.tenantId, tenantId),
          )).limit(1);
          if (member) return json({ error: "Este grupo possui operadores. Transfira-os para outro grupo antes de excluir.", code: "GROUP_IN_USE" }, 409);
          await tx.insert(crmActionHistory).values({
            id: crypto.randomUUID(), tenantId, operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_group", entityType: "access_group", itemCount: 1,
            details: { groupId: id, before: existing, beforeRevision: groupRevision(existing) },
          });
          await tx.delete(accessGroups).where(and(eq(accessGroups.id, id), eq(accessGroups.tenantId, tenantId)));
          return json({ success: true });
        });
      } catch (error) {
        console.error("[groups] Falha ao excluir grupo", error);
        return json({ error: "Não foi possível excluir o grupo." }, 500);
      }
    },
  } },
});
