import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import {
  accessGroups,
  whatsappConnections,
  whatsappConnectionGroupAccess,
  crmActionHistory,
} from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { groupRevision } from "../../../lib/access-control/group-revision";
import { multiConnectionEnabled } from "../../../lib/whatsapp/connection-policy";
import { SessionManager } from "../../../lib/baileys/session-manager";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
function accessState(row?: typeof whatsappConnectionGroupAccess.$inferSelect) {
  return {
    canRead: row?.canRead ?? false,
    canSend: row?.canSend ?? false,
    revision: groupRevision(row ?? { canRead: false, canSend: false }),
  };
}
type SaveResult =
  { response: Response } | { access: ReturnType<typeof accessState>; changed: boolean };
async function authorize(request: Request) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth;
  const { session } = auth;
  if (
    session.operator.role !== "admin" ||
    session.permissions?.views?.groups !== true ||
    session.permissions?.security?.canManageAccessGroups !== true
  )
    return {
      response: json(
        { error: "Sem permissão para configurar grupos de acesso.", code: "FORBIDDEN" },
        403,
      ),
    };
  return auth;
}

export const Route = createFileRoute("/api/groups/whatsapp-connections")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;
        const tenantId = auth.session.tenantId;
        const groupId = new URL(request.url).searchParams.get("groupId") || "";
        if (!groupId || groupId.length > 160) return json({ error: "Grupo inválido." }, 400);
        const [group] = await db
          .select({ id: accessGroups.id })
          .from(accessGroups)
          .where(and(eq(accessGroups.tenantId, tenantId), eq(accessGroups.id, groupId)))
          .limit(1);
        if (!group) return json({ error: "Grupo não encontrado." }, 404);
        if (!multiConnectionEnabled(tenantId)) return json({ enabled: false, connections: [] });
        const [connections, grants] = await Promise.all([
          db
            .select({
              id: whatsappConnections.id,
              name: whatsappConnections.name,
              phone: whatsappConnections.baileysPairedPhone,
              enabled: whatsappConnections.enabled,
            })
            .from(whatsappConnections)
            .where(eq(whatsappConnections.tenantId, tenantId)),
          db
            .select()
            .from(whatsappConnectionGroupAccess)
            .where(
              and(
                eq(whatsappConnectionGroupAccess.tenantId, tenantId),
                eq(whatsappConnectionGroupAccess.groupId, group.id),
              ),
            ),
        ]);
        return json({
          enabled: true,
          connections: connections.map((connection) => ({
            ...connection,
            ...accessState(grants.find((grant) => grant.connectionId === connection.id)),
          })),
        });
      },
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (!multiConnectionEnabled(tenantId))
          return json({ error: "Recurso não habilitado." }, 409);
        const body = await request.json().catch(() => null);
        if (
          !body ||
          typeof body.groupId !== "string" ||
          !body.groupId ||
          body.groupId.length > 160 ||
          typeof body.connectionId !== "string" ||
          !body.connectionId ||
          body.connectionId.length > 160 ||
          typeof body.canRead !== "boolean" ||
          typeof body.canSend !== "boolean" ||
          (body.canSend && !body.canRead) ||
          typeof body.expectedRevision !== "string"
        )
          return json(
            { error: "Informe grupo, número, permissões e revisão. Enviar exige visualizar." },
            400,
          );
        try {
          const result = await db.transaction(async (tx): Promise<SaveResult> => {
            const [group] = await tx
              .select({ id: accessGroups.id })
              .from(accessGroups)
              .where(and(eq(accessGroups.tenantId, tenantId), eq(accessGroups.id, body.groupId)))
              .for("update")
              .limit(1);
            if (!group) return { response: json({ error: "Grupo não encontrado." }, 404) };
            const [connection] = await tx
              .select({ id: whatsappConnections.id })
              .from(whatsappConnections)
              .where(
                and(
                  eq(whatsappConnections.tenantId, tenantId),
                  eq(whatsappConnections.id, body.connectionId),
                ),
              )
              .for("update")
              .limit(1);
            if (!connection) return { response: json({ error: "Número não encontrado." }, 404) };
            const condition = and(
              eq(whatsappConnectionGroupAccess.tenantId, tenantId),
              eq(whatsappConnectionGroupAccess.connectionId, connection.id),
              eq(whatsappConnectionGroupAccess.groupId, group.id),
            );
            const [before] = await tx
              .select()
              .from(whatsappConnectionGroupAccess)
              .where(condition)
              .limit(1);
            if (body.expectedRevision !== accessState(before).revision)
              return {
                response: json(
                  {
                    error: "Estas permissões foram alteradas. Atualize antes de salvar.",
                    code: "GROUP_CONNECTION_ACCESS_CONFLICT",
                    access: accessState(before),
                  },
                  409,
                ),
              };
            if (
              (before?.canRead ?? false) === body.canRead &&
              (before?.canSend ?? false) === body.canSend
            )
              return { access: accessState(before), changed: false };
            let after: typeof before | undefined;
            if (!body.canRead && !body.canSend)
              await tx.delete(whatsappConnectionGroupAccess).where(condition);
            else {
              [after] = await tx
                .insert(whatsappConnectionGroupAccess)
                .values({
                  id: randomUUID(),
                  tenantId,
                  connectionId: connection.id,
                  groupId: group.id,
                  canRead: body.canRead,
                  canSend: body.canSend,
                })
                .onConflictDoUpdate({
                  target: [
                    whatsappConnectionGroupAccess.tenantId,
                    whatsappConnectionGroupAccess.connectionId,
                    whatsappConnectionGroupAccess.groupId,
                  ],
                  set: { canRead: body.canRead, canSend: body.canSend, updatedAt: new Date() },
                })
                .returning();
            }
            await tx.insert(crmActionHistory).values({
              id: randomUUID(),
              tenantId,
              operatorId: session.operator.id,
              operatorName: session.operator.name,
              action: "update_whatsapp_group_access",
              entityType: "access_group",
              itemCount: 1,
              details: {
                groupId: group.id,
                connectionId: connection.id,
                before: accessState(before),
                after: accessState(after),
              },
            });
            return { access: accessState(after), changed: true };
          });
          if ("response" in result) return result.response;
          if (result.changed) {
            try {
              SessionManager.getInstance().notifyPublic(tenantId, {
                type: "connection_access_changed",
                groupId: body.groupId,
              });
            } catch {
              console.error(
                "[groups] Permissão salva; atualização do contexto aguardando reconexão.",
              );
            }
          }
          return json({ ok: true, access: result.access });
        } catch {
          return json(
            { error: "Não foi possível salvar. Nenhuma alteração parcial foi mantida." },
            500,
          );
        }
      },
    },
  },
});
