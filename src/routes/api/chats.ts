import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { conversations, contacts, messages } from "../../db/schema";
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
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          // 1. Obter todas as conversas do tenant com o respectivo contato
          const rows = await db
            .select({
              conversation: conversations,
              contact: contacts,
            })
            .from(conversations)
            .innerJoin(contacts, eq(conversations.contactId, contacts.id))
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

            // Formatar no formato que o frontend espera
            const initials = row.contact.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .toUpperCase()
              .substring(0, 2);

            chatList.push({
              id: row.conversation.id,
              name: row.contact.name,
              avatar: "",
              initials: initials || "C",
              initialsBg: "#a6d6f2",
              phone: row.contact.phone || "",
              tags: row.contact.tags || [],
              channel: row.contact.mainChannel || "whatsapp",
              queue: row.conversation.queueState || "fila", // 'meus' | 'fila' | 'bot' | 'finalizados'
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
              })),
            });
          }

          return new Response(JSON.stringify(chatList), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          });
        } catch (e: any) {
          console.error("Erro ao listar chats do banco:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
