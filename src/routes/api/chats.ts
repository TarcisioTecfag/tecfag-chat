import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { conversations, contacts, messages, sectors, operators } from "../../db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { rdRequest } from "../../lib/rdCrmService";

export const Route = createFileRoute("/api/chats")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },

      // POST /api/chats — Persiste mensagem (nota interna) no banco
      // Quando isInternalNote=true e o contato tiver rdCrmDealId, envia também como anotação no RD CRM
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Content-Type": "application/json",
        };

        try {
          const body = await request.json() as {
            tenantId: string;
            conversationId: string;
            senderType: string;
            senderName: string;
            content: string;
            isInternalNote?: boolean;
            quotedMessageId?: string | null;
            quotedMessageSender?: string | null;
            quotedMessageContent?: string | null;
          };

          const {
            tenantId, conversationId, senderType, senderName,
            content, isInternalNote = false,
            quotedMessageId, quotedMessageSender, quotedMessageContent,
          } = body;

          if (!tenantId || !conversationId || !content) {
            return new Response(
              JSON.stringify({ error: "tenantId, conversationId e content são obrigatórios" }),
              { status: 400, headers: corsHeaders }
            );
          }

          // 1. Salvar mensagem no banco
          const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await db.insert(messages).values({
            id: msgId,
            conversationId,
            tenantId,
            senderType: senderType as any,
            senderName,
            content,
            isInternalNote,
            quotedMessageId: quotedMessageId ?? null,
            quotedMessageSender: quotedMessageSender ?? null,
            quotedMessageContent: quotedMessageContent ?? null,
            sentAt: new Date(),
          });

          // 2. Se for nota interna, tentar enviar como anotação no RD CRM (fire-and-forget)
          if (isInternalNote) {
            (async () => {
              try {
                const [conv] = await db
                  .select({ contactId: conversations.contactId })
                  .from(conversations)
                  .where(eq(conversations.id, conversationId));

                if (!conv?.contactId) return;

                const [contact] = await db
                  .select({ rdCrmDealId: contacts.rdCrmDealId })
                  .from(contacts)
                  .where(eq(contacts.id, conv.contactId));

                if (!contact?.rdCrmDealId) return;

                // Endpoint de anotações do RD CRM v2
                await rdRequest(tenantId, "POST", `/deals/${contact.rdCrmDealId}/annotations`, {
                  text: `[Nota Interna] ${senderName}: ${content}`,
                });
                console.log(`[chats POST] Nota interna enviada ao CRM para deal ${contact.rdCrmDealId}`);
              } catch (crmErr: any) {
                console.warn("[chats POST] Falha ao enviar nota interna ao CRM (não bloqueante):", crmErr.message);
              }
            })();
          }

          return new Response(JSON.stringify({ success: true, id: msgId }), {
            status: 201,
            headers: corsHeaders,
          });
        } catch (e: any) {
          console.error("[api/chats POST] Erro:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: corsHeaders,
          });
        }
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
                  timeZone: "America/Sao_Paulo",
                }),
                date: new Date(m.sentAt).toLocaleDateString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                }), // "DD/MM/AAAA" — usado pelo separador de data no chat
                sentAtISO: new Date(m.sentAt).toISOString(),
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
