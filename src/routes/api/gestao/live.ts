import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { operators, conversations, contacts, messages } from "../../../db/schema";
import { eq, and, ne, desc, inArray } from "drizzle-orm";
import { getComercialOperatorIds } from "../../../lib/gestao-filter";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/live")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          const now = new Date();

          // 0. IDs dos operadores do setor Comercial (regra de negócio)
          const comercialIds = await getComercialOperatorIds(tenantId);

          // 1. Buscar operadores do setor Comercial do tenant
          const opList = await db
            .select()
            .from(operators)
            .where(
              comercialIds !== null
                ? and(eq(operators.tenantId, tenantId), inArray(operators.id, comercialIds))
                : eq(operators.tenantId, tenantId)
            );

          // 2. Buscar conversas ativas (não finalizadas) do tenant
          const activeConvs = await db
            .select({
              id: conversations.id,
              operatorId: conversations.operatorId,
              contactId: conversations.contactId,
              contactName: contacts.name,
              contactPhone: contacts.phone,
              updatedAt: conversations.updatedAt,
            })
            .from(conversations)
            .leftJoin(contacts, eq(conversations.contactId, contacts.id))
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                ne(conversations.queueState, "finalizados")
              )
            )
            .orderBy(desc(conversations.updatedAt));

          // Se houver conversas ativas, carregar mensagens recentes
          const convIds = activeConvs.map((c) => c.id);
          let allMessagesMap: Record<string, any[]> = {};

          if (convIds.length > 0) {
            const rawMsgs = await db
              .select()
              .from(messages)
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  inArray(messages.conversationId, convIds)
                )
              )
              .orderBy(desc(messages.createdAt))
              .limit(300);

            // Agrupar mensagens por conversa (cronológico do mais antigo para o mais recente)
            for (const msg of rawMsgs.reverse()) {
              if (!allMessagesMap[msg.conversationId]) {
                allMessagesMap[msg.conversationId] = [];
              }
              allMessagesMap[msg.conversationId].push(msg);
            }
          }

          // 3. Montar a resposta agrupada por operador
          const result = opList.map((op) => {
            const opConvs = activeConvs.filter((c) => c.operatorId === op.id);

            const liveConvs = opConvs.map((c) => {
              const msgs = allMessagesMap[c.id] || [];
              const lastMsg = msgs[msgs.length - 1];

              let waitingMinutes = 0;
              let isUnanswered = false;

              if (lastMsg && lastMsg.senderType === "client") {
                const msgTime = new Date(lastMsg.createdAt).getTime();
                waitingMinutes = Math.floor((now.getTime() - msgTime) / 60000);
                isUnanswered = true;
              }

              const formattedMessages = msgs.slice(-15).map((m) => ({
                id: m.id,
                sender: m.senderType === "client" ? ("client" as const) : ("agent" as const),
                text: m.content || "",
                time: new Date(m.createdAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              }));

              return {
                id: c.id,
                contactName: c.contactName || "Cliente sem Nome",
                contactPhone: c.contactPhone || "",
                lastMessage: lastMsg?.content || "Nenhuma mensagem recente",
                waitingMinutes,
                isUnanswered,
                messages: formattedMessages,
              };
            });

            return {
              operatorId: op.id,
              operatorName: op.name,
              status: op.status || "disponivel",
              conversations: liveConvs,
            };
          });

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[gestao/live] Erro ao buscar conversas ao vivo:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
