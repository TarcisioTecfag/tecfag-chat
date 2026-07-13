import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { conversations, contacts, messages, responseTimeLogs, sectors } from "../../db/schema";
import { eq, desc, asc, isNull, and } from "drizzle-orm";
import { SlaEngine } from "../../lib/sla-engine";

export const Route = createFileRoute("/api/chats")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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

            // Formatar no formato que o frontend espera
            const initials = row.contact.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .toUpperCase()
              .substring(0, 2);

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
              tags: row.contact.tags || [],
              channel: row.contact.mainChannel || "whatsapp",
              queue: row.conversation.queueState || "fila",
              operatorId: row.conversation.operatorId || null,
              walletOperatorId: row.contact.walletOperatorId || null,
              responsibleName: (row.contact as any).responsibleName || "Na Fila",
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
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const body = await request.json();
          const { tenantId, conversationId, senderType, senderName, content, isInternalNote, quotedMessageId, quotedMessageSender, quotedMessageContent } = body;

          if (!tenantId || !conversationId || !content) {
            return new Response(JSON.stringify({ error: "tenantId, conversationId e content são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const messageId = `msg-${Date.now()}`;

          let cleanQuotedContent = quotedMessageContent || "";
          if (cleanQuotedContent.startsWith("[MEDIA:") || cleanQuotedContent.startsWith("[LOCAL_MEDIA:")) {
            if (cleanQuotedContent.includes("audio")) cleanQuotedContent = "🎵 Áudio";
            else if (cleanQuotedContent.includes("image")) cleanQuotedContent = "📷 Foto";
            else if (cleanQuotedContent.includes("video")) cleanQuotedContent = "🎥 Vídeo";
            else if (cleanQuotedContent.includes("document")) cleanQuotedContent = "📄 Documento";
            else if (cleanQuotedContent.includes("sticker")) cleanQuotedContent = "💟 Figurinha";
          }

          await db.insert(messages).values({
            id: messageId,
            tenantId,
            conversationId,
            senderType: senderType || "agent",
            senderName: senderName || "Operador",
            content,
            isInternalNote: !!isInternalNote,
            quotedMessageId: quotedMessageId || null,
            quotedMessageSender: quotedMessageSender || null,
            quotedMessageContent: cleanQuotedContent || null,
            sentAt: new Date(),
          });

          // Atualizar última mensagem na conversa
          await db.update(conversations)
            .set({
              lastMessageText: content,
              lastMessageTime: new Date(),
            })
            .where(eq(conversations.id, conversationId));

          // ── SLA Engine: rastreamento de tempo de resposta ──────────────────
          // Notas internas não entram no cálculo de SLA
          if (!isInternalNote) {
            const now = new Date();

            if (senderType === "client") {
              // Cliente enviou: abre um novo ciclo de SLA (pendente)
              await db.insert(responseTimeLogs).values({
                id: `sla-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                tenantId,
                conversationId,
                operatorId: null, // Ainda não sabemos qual operador vai responder
                clientMessageId: messageId,
                clientMessageAt: now,
                overdueThresholdSeconds: 900, // 15 minutos (configurável futuramente)
              });
            } else if (senderType === "agent" || senderType === "bot") {
              // Agente respondeu: fecha o ciclo de SLA mais recente pendente desta conversa
              const openLog = await db
                .select()
                .from(responseTimeLogs)
                .where(
                  and(
                    eq(responseTimeLogs.conversationId, conversationId),
                    isNull(responseTimeLogs.agentResponseId)
                  )
                )
                .orderBy(desc(responseTimeLogs.clientMessageAt))
                .limit(1);

              if (openLog.length > 0) {
                const log = openLog[0];
                const deltaSeconds = Math.floor(
                  (now.getTime() - new Date(log.clientMessageAt).getTime()) / 1000
                );
                await db
                  .update(responseTimeLogs)
                  .set({
                    agentResponseId: messageId,
                    agentResponseAt: now,
                    responseTimeSeconds: deltaSeconds,
                  })
                  .where(eq(responseTimeLogs.id, log.id));

                // Atualiza métricas diárias do operador em tempo real
                const convRow = await db
                  .select({ operatorId: conversations.operatorId })
                  .from(conversations)
                  .where(eq(conversations.id, conversationId))
                  .limit(1);

                if (convRow[0]?.operatorId) {
                  SlaEngine.getInstance().updateResponseMetrics(
                    tenantId,
                    convRow[0].operatorId,
                    deltaSeconds
                  ).catch((e) => console.error("[SlaEngine] Erro ao atualizar métricas:", e));
                }
              }
            }
          }
          // ── Fim SLA Engine ─────────────────────────────────────────────────

          return new Response(JSON.stringify({ success: true, messageId }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao salvar mensagem no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      PATCH: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const body = await request.json();
          const { conversationId, unreadCount } = body;

          if (!conversationId) {
            return new Response(JSON.stringify({ error: "conversationId é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          await db
            .update(conversations)
            .set({
              unreadCount: unreadCount !== undefined ? unreadCount : 0,
            })
            .where(eq(conversations.id, conversationId));

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao atualizar unreadCount no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
