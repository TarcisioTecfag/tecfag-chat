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

        try {
          const query = tenantId 
            ? db.select().from(accessGroups).where(eq(accessGroups.tenantId, tenantId))
            : db.select().from(accessGroups);

          const list = await query;

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
          const { id, tenantId, name, allowedTenants, allowedChannels, canCreateUser, canResetPassword, canEditProfile } = body;

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

        if (!id) {
          return new Response(JSON.stringify({ error: "id é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
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
