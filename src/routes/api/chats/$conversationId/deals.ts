import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { crmService } from "../../../../lib/crm/crm-service";
import { db } from "../../../../db";
import { conversations, contacts } from "../../../../db/schema";
import { eq, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/chats/$conversationId/deals")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/chats/:conversationId/deals
       * Lista as negociações ativas vinculadas a esta conversa (relação N:N).
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { conversationId } = params as { conversationId: string };

          // Valida existência e propriedade da conversa
          const [conv] = await db
            .select()
            .from(conversations)
            .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
            .limit(1);

          if (!conv) {
            return new Response(JSON.stringify({ error: "Conversa não encontrada.", code: "NOT_FOUND" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const deals = await crmService.getConversationDeals(tenantId, conversationId);

          return new Response(JSON.stringify({ deals }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Chat Deals API] Erro no GET:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * POST /api/chats/:conversationId/deals
       * Vincula um card existente à conversa OU cria um novo card a partir do chat.
       * Body: { dealId?: string } OU { title, pipelineId, stageId, value?, accountId? }
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { conversationId } = params as { conversationId: string };

          // Valida a conversa no tenant
          const [conv] = await db
            .select()
            .from(conversations)
            .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
            .limit(1);

          if (!conv) {
            return new Response(JSON.stringify({ error: "Conversa não encontrada.", code: "NOT_FOUND" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const body = await request.json();

          // Caso 1: Vincular card existente
          if (body.dealId) {
            const link = await crmService.linkConversationDeal(
              tenantId,
              conversationId,
              body.dealId,
              session.operator.id,
              "chat"
            );
            return new Response(JSON.stringify({ success: true, link }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Caso 2: Criar novo card a partir do chat
          if (!body.title || !body.pipelineId || !body.stageId) {
            return new Response(
              JSON.stringify({ error: "Para criar um novo card, informe title, pipelineId e stageId.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Busca dados do contato da conversa para herdar comprador se houver
          const [contact] = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)))
            .limit(1);

          const deal = await crmService.createDeal(tenantId, session.operator.id, {
            title: body.title,
            pipelineId: body.pipelineId,
            stageId: body.stageId,
            accountId: body.accountId || contact?.accountId || null,
            value: body.value,
            contactId: conv.contactId,
            conversationId: conv.id,
            source: "whatsapp",
          });

          return new Response(JSON.stringify({ success: true, deal }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Chat Deals API] Erro no POST:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * DELETE /api/chats/:conversationId/deals
       * Desvincula uma negociação da conversa sem exclui-la.
       * Query param ou body: dealId
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { conversationId } = params as { conversationId: string };
          const url = new URL(request.url);
          let dealId = url.searchParams.get("dealId");

          if (!dealId) {
            try {
              const body = await request.json();
              dealId = body.dealId;
            } catch (_) {}
          }

          if (!dealId) {
            return new Response(
              JSON.stringify({ error: "O dealId é obrigatório para desvincular.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const unlinked = await crmService.unlinkConversationDeal(
            tenantId,
            conversationId,
            dealId,
            session.operator.id
          );

          return new Response(JSON.stringify({ success: unlinked }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Chat Deals API] Erro no DELETE:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
