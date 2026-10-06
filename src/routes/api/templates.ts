import { createFileRoute } from "@tanstack/react-router";
import { recordCrmAction } from "../../lib/crm/action-history";
import { db } from "../../db/index.js";
import { operatorTemplates } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../../lib/auth-session.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/templates")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response; // retorna 401 automaticamente
        const { session } = auth;
        const tenantId = session.tenantId;       // SEMPRE da sessão
        const operatorId = session.operator.id;  // SEMPRE da sessão

        try {
          const list = await db
            .select()
            .from(operatorTemplates)
            .where(
              and(
                eq(operatorTemplates.tenantId, tenantId),
                eq(operatorTemplates.operatorId, operatorId)
              )
            )
            .orderBy(operatorTemplates.title);

          return new Response(JSON.stringify(list), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[GET /api/templates] Erro ao listar templates do DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response; // retorna 401 automaticamente
          const { session } = auth;
          const tenantId = session.tenantId;       // SEMPRE da sessão
          const operatorId = session.operator.id;  // SEMPRE da sessão

          const body = await request.json().catch(() => ({}));
          const { id, title, text } = body;

          if (!id || !title || !text) {
            return new Response(
              JSON.stringify({ error: "id, title e text são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const existing = await db.query.operatorTemplates.findFirst({
            where: eq(operatorTemplates.id, id),
          });

          if (existing) {
            // Verificar que o recurso pertence ao tenant e operador da sessão
            if (existing.tenantId !== tenantId || existing.operatorId !== operatorId) {
              return new Response(
                JSON.stringify({ error: "Template não encontrado.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            await db
              .update(operatorTemplates)
              .set({ title, text })
              .where(and(eq(operatorTemplates.id, id), eq(operatorTemplates.tenantId, tenantId)));
          } else {
            await db.insert(operatorTemplates).values({
              id,
              tenantId,
              operatorId,
              title,
              text,
              createdAt: new Date(),
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[POST /api/templates] Erro ao salvar template no DB:", e);
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
        const tenantId = session.tenantId;       // SEMPRE da sessão
        const operatorId = session.operator.id;  // SEMPRE da sessão

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
          const existing = await db.query.operatorTemplates.findFirst({
            where: and(
              eq(operatorTemplates.id, id),
              eq(operatorTemplates.tenantId, tenantId)
            ),
          });

          if (!existing) {
            return new Response(
              JSON.stringify({ error: "Template não encontrado.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Se operador comum, só pode deletar seu próprio template
          if (session.operator.role !== "admin" && existing.operatorId !== operatorId) {
            return new Response(
              JSON.stringify({ error: "Permissão insuficiente para excluir este template.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await db
            .delete(operatorTemplates)
            .where(and(eq(operatorTemplates.id, id), eq(operatorTemplates.tenantId, tenantId)));
          await recordCrmAction({ tenantId, operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_template", entityType: "template", itemCount: 1, details: { id } });

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[DELETE /api/templates] Erro ao excluir template no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
