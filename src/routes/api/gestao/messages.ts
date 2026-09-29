import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { messages } from "../../../db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * GET /api/gestao/messages?tenantId=&conversationId=
 *
 * Retorna TODAS as mensagens de uma conversa específica (sem limite).
 * Usado pelo painel "Ao Vivo" quando o supervisor clica em "Carregar histórico completo".
 * As mensagens chegam em ordem cronológica (mais antiga → mais recente).
 */
export const Route = createFileRoute("/api/gestao/messages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const conversationId = url.searchParams.get("conversationId");

        if (!conversationId) {
          return new Response(
            JSON.stringify({ error: "conversationId é obrigatório" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const rows = await db
            .select({
              id: messages.id,
              conversationId: messages.conversationId,
              senderType: messages.senderType,
              senderName: messages.senderName,
              content: messages.content,
              sentAt: messages.sentAt,
              isInternalNote: messages.isInternalNote,
            })
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.conversationId, conversationId)
              )
            )
            .orderBy(asc(messages.sentAt)); // cronológico: mais antiga → mais recente

          const result = rows.map((m) => ({
            id: m.id,
            conversationId: m.conversationId,
            senderType: m.senderType,
            senderName: m.senderName,
            content: m.content,
            sentAt: m.sentAt instanceof Date ? m.sentAt.toISOString() : String(m.sentAt),
            isInternalNote: m.isInternalNote,
          }));

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[gestao/messages] Erro ao buscar mensagens:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
