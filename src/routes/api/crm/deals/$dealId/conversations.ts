import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { db } from "../../../../../db";
import { crmDeals, crmConversationDeals, conversations, contacts, operators } from "../../../../../db/schema";
import { eq, and, desc } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/conversations")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/conversations
       * Lista os atendimentos vinculados a uma negociação (com contato, operador e datas).
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };

          // Valida a negociação no tenant
          const [deal] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return new Response(JSON.stringify({ error: "Negociação não encontrada.", code: "NOT_FOUND" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Busca conversas vinculadas ativas com joins de contato e operador
          const rows = await db
            .select({
              linkId: crmConversationDeals.id,
              origin: crmConversationDeals.origin,
              linkedAt: crmConversationDeals.createdAt,
              conversation: conversations,
              contact: contacts,
              operatorName: operators.name,
            })
            .from(crmConversationDeals)
            .innerJoin(conversations, eq(crmConversationDeals.conversationId, conversations.id))
            .innerJoin(contacts, eq(conversations.contactId, contacts.id))
            .leftJoin(operators, eq(conversations.operatorId, operators.id))
            .where(
              and(
                eq(crmConversationDeals.tenantId, tenantId),
                eq(crmConversationDeals.dealId, dealId),
                eq(crmConversationDeals.isActive, true)
              )
            )
            .orderBy(desc(conversations.lastMessageTime));

          return new Response(JSON.stringify({ conversations: rows }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Deal Conversations API] Erro no GET:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
