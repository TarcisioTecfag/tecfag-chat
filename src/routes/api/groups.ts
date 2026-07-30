import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { accessGroups } from "../../db/schema";
import { eq } from "drizzle-orm";

export const Route = createFileRoute("/api/groups")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        // tenantId é OBRIGATÓRIO — nunca retornar grupos de múltiplos tenants
        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          const list = await db.select().from(accessGroups).where(eq(accessGroups.tenantId, tenantId));

          return new Response(JSON.stringify(list), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao listar grupos de acesso do DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const body = await request.json();
          const {
            id, tenantId, name, allowedTenants, allowedChannels,
            canCreateUser, canResetPassword, canEditProfile,
            canCaptureChat, canTransferChat, canFinishChat, canViewAllChats, canOverrideChat,
          } = body;

          if (!id || !tenantId || !name) {
            return new Response(JSON.stringify({ error: "id, tenantId e name são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Verificar se o grupo já existe
          const existing = await db.query.accessGroups.findFirst({
            where: eq(accessGroups.id, id),
          });

          if (existing) {
            await db
              .update(accessGroups)
              .set({
                tenantId,
                name,
                allowedTenants: allowedTenants || existing.allowedTenants,
                allowedChannels: allowedChannels || existing.allowedChannels,
                canCreateUser: canCreateUser !== undefined ? canCreateUser : existing.canCreateUser,
                canResetPassword: canResetPassword !== undefined ? canResetPassword : existing.canResetPassword,
                canEditProfile: canEditProfile !== undefined ? canEditProfile : existing.canEditProfile,
                canCaptureChat: canCaptureChat !== undefined ? canCaptureChat : existing.canCaptureChat,
                canTransferChat: canTransferChat !== undefined ? canTransferChat : existing.canTransferChat,
                canFinishChat: canFinishChat !== undefined ? canFinishChat : existing.canFinishChat,
                canViewAllChats: canViewAllChats !== undefined ? canViewAllChats : existing.canViewAllChats,
                canOverrideChat: canOverrideChat !== undefined ? canOverrideChat : existing.canOverrideChat,
              })
              .where(eq(accessGroups.id, id));
          } else {
            await db.insert(accessGroups).values({
              id,
              tenantId,
              name,
              allowedTenants: allowedTenants || [],
              allowedChannels: allowedChannels || [],
              canCreateUser: canCreateUser !== undefined ? canCreateUser : true,
              canResetPassword: canResetPassword !== undefined ? canResetPassword : true,
              canEditProfile: canEditProfile !== undefined ? canEditProfile : true,
              canCaptureChat: canCaptureChat !== undefined ? canCaptureChat : false,
              canTransferChat: canTransferChat !== undefined ? canTransferChat : false,
              canFinishChat: canFinishChat !== undefined ? canFinishChat : false,
              canViewAllChats: canViewAllChats !== undefined ? canViewAllChats : false,
              canOverrideChat: canOverrideChat !== undefined ? canOverrideChat : false,
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao criar/atualizar grupo de acesso no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      DELETE: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const tenantId = url.searchParams.get("tenantId");

        if (!id) {
          return new Response(JSON.stringify({ error: "id é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          // Verificar pertinência ao tenant antes de deletar
          const existing = await db.query.accessGroups.findFirst({
            where: eq(accessGroups.id, id),
          });

          if (!existing) {
            return new Response(JSON.stringify({ error: "Grupo não encontrado" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (existing.tenantId !== tenantId) {
            console.warn(`[DELETE /api/groups] Tentativa de deletar grupo ${id} do tenant ${existing.tenantId} pelo tenant ${tenantId}. Bloqueado.`);
            return new Response(JSON.stringify({ error: "Acesso negado: grupo não pertence ao seu tenant" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          await db.delete(accessGroups).where(eq(accessGroups.id, id));
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao excluir grupo de acesso no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
