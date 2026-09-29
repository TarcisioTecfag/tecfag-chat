import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";
import { db } from "../../../../../db";
import { crmDeals, crmConversationDeals, conversations, contacts, operators } from "../../../../../db/schema";
import { eq, and, desc } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/conversations")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/conversations
       * Lista os atendimentos vinculados a uma negociação (com contato, operador e datas).
       * Exige permissão canViewCrm.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };

          // Valida a negociação no tenant
          const [deal] = await db
            .select({ id: crmDeals.id, operatorId: crmDeals.operatorId })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return new Response(JSON.stringify({ error: "Negociação não encontrada.", code: "NOT_FOUND" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (
            session.operator.role !== "admin" &&
            !session.permissions?.crm?.canViewAllDeals &&
            deal.operatorId &&
            deal.operatorId !== session.operator.id
          ) {
            return new Response(
              JSON.stringify({
                error: "Acesso restrito: você não tem permissão para visualizar dados deste negócio.",
                code: "FORBIDDEN",
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
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

          const mappedConversations = rows.map((r) => {
            const mainChan = r.contact?.mainChannel || "whatsapp";
            return {
              id: r.conversation.id,
              linkId: r.linkId,
              conversationId: r.conversation.id,
              origin: r.origin,
              linkedAt: r.linkedAt,
              queueState: r.conversation.queueState || "meus",
              lastMessageText: r.conversation.lastMessageText || null,
              lastMessageTime: r.conversation.lastMessageTime || null,
              createdAt: r.conversation.createdAt,
              contactId: r.contact?.id || r.conversation.contactId,
              contactName: r.contact?.name || "Sem nome",
              contactPhone: r.contact?.phone || null,
              contactAvatar: r.contact?.avatar || null,
              channel: mainChan,
              mainChannel: mainChan,
              operatorId: r.conversation.operatorId,
              operatorName: r.operatorName || (r.conversation.operatorId ? "Operador" : "Na Fila"),
              conversation: r.conversation,
              contact: r.contact,
            };
          });

          return new Response(JSON.stringify({ conversations: mappedConversations }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Deal Conversations API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * POST /api/crm/deals/:dealId/conversations
       * Associa uma conversa existente a esta negociação.
       * Body: { conversationId: string, origin?: "chat" | "crm" | "auto_sdr" }
       * Exige permissão canEditDeals.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };
          const body = await request.json();

          if (!body.conversationId) {
            return new Response(
              JSON.stringify({ error: "O campo conversationId é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const link = await crmService.linkConversationDeal(
            tenantId,
            body.conversationId,
            dealId,
            session.operator.id,
            body.origin || "crm"
          );

          return new Response(JSON.stringify({ success: true, link }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Deal Conversations API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/deals/:dealId/conversations
       * Desvincula uma conversa desta negociação sem exclui-la.
       * Suporta conversationId no Body JSON ou Query string (?conversationId=...).
       * Exige permissão canEditDeals.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };

          // Tenta ler conversationId da query string
          const url = new URL(request.url);
          let conversationId = url.searchParams.get("conversationId");

          // Se não estiver na query, tenta ler do body
          if (!conversationId) {
            try {
              const body = await request.json();
              conversationId = body.conversationId;
            } catch {
              // Body vazio ou inválido
            }
          }

          if (!conversationId) {
            return new Response(
              JSON.stringify({ error: "O campo conversationId é obrigatório (via body ou query string).", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await crmService.unlinkConversationDeal(
            tenantId,
            conversationId,
            dealId,
            session.operator.id
          );

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Deal Conversations API] Erro no DELETE:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
