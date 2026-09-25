import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db/index.js";
import { accessGroups, operators } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { getAuthSession, validateTenantAccess } from "../../lib/auth-session.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/groups")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }) => {
        const session = await getAuthSession(request);
        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");

        const effectiveTenantId = session ? session.tenantId : queryTenantId;

        if (!effectiveTenantId) {
          return new Response(
            JSON.stringify({ error: "Sessão inválida ou tenantId ausente.", code: "UNAUTHORIZED" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (session) {
          const check = validateTenantAccess(session, queryTenantId);
          if (check) return check;
        }

        try {
          const list = await db
            .select()
            .from(accessGroups)
            .where(eq(accessGroups.tenantId, effectiveTenantId));

          return new Response(JSON.stringify(list), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[GET /api/groups] Erro ao listar grupos de acesso:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      POST: async ({ request }) => {
        try {
          const session = await getAuthSession(request);
          const body = await request.json().catch(() => ({}));
          const {
            id,
            name,
            allowedChannels,
            canCreateUser,
            canResetPassword,
            canEditProfile,
            canCaptureChat,
            canTransferChat,
            canFinishChat,
            canViewAllChats,
            canOverrideChat,
            permissions,
          } = body;

          const tenantId = session ? session.tenantId : body.tenantId;

          if (!tenantId) {
            return new Response(
              JSON.stringify({ error: "Sessão inválida ou tenantId ausente.", code: "UNAUTHORIZED" }),
              { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (session && body.tenantId && body.tenantId !== session.tenantId) {
            return new Response(
              JSON.stringify({ error: "Não é permitido manipular grupos de outro tenant.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!id || !name) {
            return new Response(
              JSON.stringify({ error: "id e name são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // No MVP, cada sessão opera estritamente o tenant do operador (sem cross-tenant)
          const safeAllowedTenants = [tenantId];

          const existing = await db.query.accessGroups.findFirst({
            where: eq(accessGroups.id, id),
          });

          if (existing) {
            // SEGURANÇA: Impedir transferência de tenant de grupo existente
            if (existing.tenantId !== tenantId) {
              return new Response(
                JSON.stringify({ error: "Grupo não encontrado neste tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            await db
              .update(accessGroups)
              .set({
                name,
                allowedTenants: safeAllowedTenants,
                allowedChannels: allowedChannels || existing.allowedChannels,
                canCreateUser: canCreateUser !== undefined ? canCreateUser : existing.canCreateUser,
                canResetPassword: canResetPassword !== undefined ? canResetPassword : existing.canResetPassword,
                canEditProfile: canEditProfile !== undefined ? canEditProfile : existing.canEditProfile,
                canCaptureChat: canCaptureChat !== undefined ? canCaptureChat : existing.canCaptureChat,
                canTransferChat: canTransferChat !== undefined ? canTransferChat : existing.canTransferChat,
                canFinishChat: canFinishChat !== undefined ? canFinishChat : existing.canFinishChat,
                canViewAllChats: canViewAllChats !== undefined ? canViewAllChats : existing.canViewAllChats,
                canOverrideChat: canOverrideChat !== undefined ? canOverrideChat : existing.canOverrideChat,
                permissions: permissions !== undefined ? permissions : existing.permissions,
              })
              .where(and(eq(accessGroups.id, id), eq(accessGroups.tenantId, tenantId)));
          } else {
            await db.insert(accessGroups).values({
              id,
              tenantId,
              name,
              allowedTenants: safeAllowedTenants,
              allowedChannels: allowedChannels || ["whatsapp", "instagram", "messenger", "livechat"],
              canCreateUser: canCreateUser ?? true,
              canResetPassword: canResetPassword ?? true,
              canEditProfile: canEditProfile ?? true,
              canCaptureChat: canCaptureChat ?? false,
              canTransferChat: canTransferChat ?? false,
              canFinishChat: canFinishChat ?? false,
              canViewAllChats: canViewAllChats ?? false,
              canOverrideChat: canOverrideChat ?? false,
              permissions: permissions ?? {},
              createdAt: new Date(),
            });
          }

          const savedGroup = await db.query.accessGroups.findFirst({ where: eq(accessGroups.id, id) });
          return new Response(JSON.stringify(savedGroup), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[POST /api/groups] Erro ao salvar grupo de acesso:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      DELETE: async ({ request }) => {
        const session = await getAuthSession(request);
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const queryTenantId = url.searchParams.get("tenantId");

        const tenantId = session ? session.tenantId : queryTenantId;

        if (!tenantId) {
          return new Response(
            JSON.stringify({ error: "Sessão inválida ou tenantId ausente.", code: "UNAUTHORIZED" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!id) {
          return new Response(JSON.stringify({ error: "id é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (id === "group-admin") {
          return new Response(JSON.stringify({ error: "O grupo padrão de administradores não pode ser excluído." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          const existing = await db.query.accessGroups.findFirst({
            where: and(eq(accessGroups.id, id), eq(accessGroups.tenantId, tenantId)),
          });

          if (!existing) {
            return new Response(
              JSON.stringify({ error: "Grupo não encontrado.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Desvincular operadores do grupo excluído
          await db
            .update(operators)
            .set({ groupId: null })
            .where(and(eq(operators.groupId, id), eq(operators.tenantId, tenantId)));

          await db
            .delete(accessGroups)
            .where(and(eq(accessGroups.id, id), eq(accessGroups.tenantId, tenantId)));

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[DELETE /api/groups] Erro ao excluir grupo de acesso:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
