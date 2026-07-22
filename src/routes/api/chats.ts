import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { conversations, contacts, messages, sectors, operators } from "../../db/schema";
import { eq, desc, asc } from "drizzle-orm";

export const Route = createFileRoute("/api/chats")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "valem";

        try {
          // 0. Carregar mapa de operadores do tenant para resolver nome do responsável dinamicamente
          const allOperators = await db.select().from(operators).where(eq(operators.tenantId, tenantId));
          const operatorMap = new Map(allOperators.map((o) => [o.id, o.name]));

          // 1. Buscar todas as conversas do tenant com contatos e setores relacionados
          const rows = await db
            .select({
              conversation: conversations,
              contact: contacts,
              sectorName: sectors.name,
            })
            .from(conversations)
            .innerJoin(contacts, eq(conversations.contactId, contacts.id))
            .leftJoin(sectors, eq(conversations.sectorId, sectors.id))
            .where(eq(conversations.tenantId, tenantId))
            .orderBy(desc(conversations.lastMessageTime));

          const chatList = [];

          for (const row of rows) {
            // 2. Obter as mensagens da conversa ordenadas por tempo de envio
            const msgs = await db
              .select()
              .from(messages)
              .where(eq(messages.conversationId, row.conversation.id))
              .orderBy(asc(messages.sentAt));

            // Formatar iniciais do cliente
            const initials = row.contact.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .toUpperCase()
              .substring(0, 2);

            // Resolução consistente e garantida do Nome do Responsável (sem dessincronia)
            let respName = "Na Fila";
            if (row.conversation.operatorId && operatorMap.has(row.conversation.operatorId)) {
              respName = operatorMap.get(row.conversation.operatorId)!;
            } else if (row.conversation.queueState === "automacao") {
              respName = "Valentina IA";
            } else if (row.contact.responsibleName && row.contact.responsibleName !== "Na Fila") {
              respName = row.contact.responsibleName;
            }

            chatList.push({
              id: row.conversation.id,
              contactId: row.contact.id,
              name: row.contact.name,
              avatar: row.contact.avatar || "",
              initials: initials || "C",
              initialsBg: "#a6d6f2",
              phone: row.contact.phone || "",
              email: row.contact.email || "",
              cnpj: row.contact.cnpj || "",
              cpf: row.contact.cpf || "",
              cnpjDetails: (row.contact as any).cnpjDetails || {},
              tags: row.contact.tags || [],
              channel: row.contact.mainChannel || "whatsapp",
              queue: row.conversation.queueState || "fila",
              operatorId: row.conversation.operatorId || null,
              walletOperatorId: row.contact.walletOperatorId || null,
              responsibleName: respName,
              sectorId: row.conversation.sectorId || null,
              sectorName: row.sectorName || null,
              unreadCount: row.conversation.unreadCount || 0,
              lastMessageTime: new Date(row.conversation.lastMessageTime).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              messages: msgs.map((m) => ({
                id: m.id,
                author: m.senderType === "client" ? row.contact.name : m.senderName,
                text: m.content,
                time: new Date(m.sentAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                side: m.senderType === "client" ? "in" : "out",
                isInternalNote: m.isInternalNote,
                senderType: m.senderType,
                quotedMessageId: m.quotedMessageId,
                quotedMessageSender: m.quotedMessageSender,
                quotedMessageContent: m.quotedMessageContent,
              })),
            });
          }

          return new Response(JSON.stringify(chatList), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        } catch (e: any) {
          console.error("[api/chats] Erro ao buscar lista de conversas:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
