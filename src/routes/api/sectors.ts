import { createFileRoute } from "@tanstack/react-router";
import { recordCrmAction } from "../../lib/crm/action-history";
import { db } from "../../db/index.js";
import { sectors } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../../lib/auth-session.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/sectors")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        try {
          const list = await db
            .select()
            .from(sectors)
            .where(eq(sectors.tenantId, tenantId));

          return new Response(JSON.stringify(list), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[GET /api/sectors] Erro ao listar setores do DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const body = await request.json().catch(() => ({}));
          const { id, name, operatorIds } = body;

          if (!id || !name) {
            return new Response(JSON.stringify({ error: "id e name são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const existing = await db.query.sectors.findFirst({
            where: eq(sectors.id, id),
          });

          if (existing) {
            // Verificar que o recurso pertence ao tenant da sessão antes de atualizar
            if (existing.tenantId !== tenantId) {
              return new Response(
                JSON.stringify({ error: "Setor não encontrado neste tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            await db
              .update(sectors)
              .set({
                name,
                operatorIds: operatorIds || existing.operatorIds,
              })
              .where(and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)));
          } else {
            await db.insert(sectors).values({
              id,
              tenantId,
              name,
              operatorIds: operatorIds || [],
              createdAt: new Date(),
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[POST /api/sectors] Erro ao criar/atualizar setor no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      DELETE: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response; // retorna 401 automaticamente
        const { session } = auth;
        const tenantId = session.tenantId; // SEMPRE da sessão

        const url = new URL(request.url);
        const id = url.searchParams.get("id");

        if (!id) {
          return new Response(JSON.stringify({ error: "id é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          // Verificar que o recurso pertence ao tenant da sessão antes de deletar
          const existing = await db.query.sectors.findFirst({
            where: and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)),
          });

          if (!existing) {
            return new Response(
              JSON.stringify({ error: "Setor não encontrado.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await db
            .delete(sectors)
            .where(and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)));
          await recordCrmAction({ tenantId, operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_sector", entityType: "sector", itemCount: 1, details: { id, name: existing.name } });

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[DELETE /api/sectors] Erro ao excluir setor no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
