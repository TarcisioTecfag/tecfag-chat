import { createFileRoute } from "@tanstack/react-router";
import { recordCrmAction } from "../../lib/crm/action-history";
import { db } from "../../db/index.js";
import { quickResponses } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requirePermission, requireSession } from "../../lib/auth-session.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/quick-responses")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response; // retorna 401 automaticamente
        const { session } = auth;
        const tenantId = session.tenantId; // SEMPRE da sessão

        try {
          const list = await db
            .select()
            .from(quickResponses)
            .where(eq(quickResponses.tenantId, tenantId));

          return new Response(JSON.stringify(list), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[GET /api/quick-responses] Erro ao listar respostas rápidas:", e);
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
          const tenantId = session.tenantId; // SEMPRE da sessão

          const denied = requirePermission(session, (permissions) => permissions.security?.canManageGlobalTemplates === true);
          if (denied) return denied;

          const body = await request.json().catch(() => ({}));
          const { id, shortcut, text, description } = body;

          if (!id || !shortcut || !text) {
            return new Response(
              JSON.stringify({ error: "id, shortcut e text são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const existing = await db.query.quickResponses.findFirst({
            where: and(eq(quickResponses.id, id), eq(quickResponses.tenantId, tenantId)),
          });

          if (existing) {
            // Verificar que o recurso pertence ao tenant da sessão
            if (existing.tenantId !== tenantId) {
              return new Response(
                JSON.stringify({ error: "Resposta rápida não encontrada neste tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            await db
              .update(quickResponses)
              .set({
                shortcut,
                text,
                description: description || null,
              })
              .where(and(eq(quickResponses.id, id), eq(quickResponses.tenantId, tenantId)));
          } else {
            await db.insert(quickResponses).values({
              id,
              tenantId,
              shortcut,
              text,
              description: description || null,
              createdAt: new Date(),
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[POST /api/quick-responses] Erro ao salvar resposta rápida:", e);
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

        const denied = requirePermission(session, (permissions) => permissions.security?.canManageGlobalTemplates === true);
        if (denied) return denied;

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
          const existing = await db.query.quickResponses.findFirst({
            where: and(eq(quickResponses.id, id), eq(quickResponses.tenantId, tenantId)),
          });

          if (!existing) {
            return new Response(
              JSON.stringify({ error: "Resposta rápida não encontrada.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await db
            .delete(quickResponses)
            .where(and(eq(quickResponses.id, id), eq(quickResponses.tenantId, tenantId)));
          await recordCrmAction({ tenantId, operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_quick_response", entityType: "quick_response", itemCount: 1,
            details: { id } });

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[DELETE /api/quick-responses] Erro ao excluir resposta rápida:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
