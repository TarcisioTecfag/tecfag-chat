import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../../db";
import { messages, conversations } from "../../../../db/schema";
import { eq, and, desc, lt } from "drizzle-orm";
import { requireSession } from "../../../../lib/auth-session";
import { readReactions } from "../../../../lib/whatsapp/meta-reactions";

export const Route = createFileRoute("/api/chats/$chatId/messages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const { chatId } = params as { chatId: string };
          const url = new URL(request.url);

          const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 100);
          const beforeStr = url.searchParams.get("before");

          // 1. Validar se a conversa pertence ao tenant do operador
          const [conv] = await db
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(
                eq(conversations.id, chatId),
                eq(conversations.tenantId, session.tenantId)
              )
            );

          if (!conv) {
            return new Response(JSON.stringify({ error: "Conversa não encontrada para este tenant" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }

          // 2. Consulta paginada das mensagens usando o índice composto (tenant_id, conversation_id, sent_at)
          const conditions = [
            eq(messages.tenantId, session.tenantId),
            eq(messages.conversationId, chatId),
          ];

          if (beforeStr) {
            const beforeDate = new Date(beforeStr);
            if (!isNaN(beforeDate.getTime())) {
              conditions.push(lt(messages.sentAt, beforeDate));
            }
          }

          const rawRows = await db
            .select()
            .from(messages)
            .where(and(...conditions))
            .orderBy(desc(messages.sentAt))
            .limit(limit + 1); // Pede 1 a mais para saber se tem mais páginas

          const hasMore = rawRows.length > limit;
          const rows = hasMore ? rawRows.slice(0, limit) : rawRows;

          // Inverte para retornar em ordem cronológica (mais antiga -> mais recente)
          const chronological = rows.reverse().map((r) => ({
            id: r.id,
            author: r.senderName,
            text: r.content,
            time: new Date(r.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
            date: new Date(r.sentAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
            sentAtISO: r.sentAt.toISOString(),
            side: r.direction === "inbound" || r.senderType === "client" ? "in" : "out",
            isInternalNote: r.isInternalNote,
            status: r.status,
            provider: r.provider,
            errorMessage: r.status === "failed" ? r.errorMessage : null,
            quotedMessageId: r.quotedMessageId,
            quotedMessageSender: r.quotedMessageSender,
            quotedMessageContent: r.quotedMessageContent,
            reactions: readReactions(r.metaDetails),
            sentAt: r.sentAt,
          }));

          const nextCursor = hasMore && rawRows[limit - 1] ? rawRows[limit - 1].sentAt.toISOString() : null;

          return new Response(
            JSON.stringify({
              conversationId: chatId,
              messages: chronological,
              hasMore,
              nextCursor,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (err: any) {
          console.error(`[Messages Route] Erro ao buscar mensagens de ${params}:`, err);
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
