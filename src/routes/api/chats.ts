import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { conversations, contacts, messages, sectors, operators } from "../../db/schema";
import { eq, and, desc, lt, inArray, sql } from "drizzle-orm";
import { rdRequest, getCachedUsers } from "../../lib/rdCrmService";
import { requireSession } from "../../lib/auth-session";
import { getAiPersona } from "../../lib/ai-persona";
import { readReactions } from "../../lib/whatsapp/meta-reactions";

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

      // POST /api/chats — Persiste mensagem (nota interna ou do sistema) no banco
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Content-Type": "application/json",
        };

        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const body = await request.json() as {
            conversationId: string;
            senderType?: string;
            senderName?: string;
            senderEmail?: string;
            content: string;
            isInternalNote?: boolean;
            quotedMessageId?: string | null;
            quotedMessageSender?: string | null;
            quotedMessageContent?: string | null;
            dealId?: string | null;
          };

          const {
            conversationId, senderType = "agent", senderName, senderEmail,
            content, isInternalNote = false,
            quotedMessageId, quotedMessageSender, quotedMessageContent,
            dealId,
          } = body;

          if (!conversationId || !content) {
            return new Response(
              JSON.stringify({ error: "conversationId e content são obrigatórios" }),
              { status: 400, headers: corsHeaders }
            );
          }

          // Validar se a conversa pertence ao tenant da sessão
          const [conv] = await db
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, session.tenantId)
              )
            );

          if (!conv) {
            return new Response(JSON.stringify({ error: "Conversa não encontrada" }), {
              status: 404,
              headers: corsHeaders,
            });
          }

          if (conv.queueState !== "meus" || conv.operatorId !== session.operator.id) {
            return Response.json({ error: "Capture o atendimento antes de escrever nesta conversa.", code: "FORBIDDEN" }, { status: 403 });
          }
          if (isInternalNote && session.operator.role !== "admin" && session.permissions.chat.canSendInternalNotes !== true) {
            return Response.json({ error: "Sem permissão para enviar notas internas.", code: "FORBIDDEN" }, { status: 403 });
          }

          const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const now = new Date();

          await db.insert(messages).values({
            id: msgId,
            conversationId,
            tenantId: session.tenantId,
            senderType: senderType as any,
            senderName: senderName || session.operator.name,
            content,
            isInternalNote,
            quotedMessageId: quotedMessageId ?? null,
            quotedMessageSender: quotedMessageSender ?? null,
            quotedMessageContent: quotedMessageContent ?? null,
            direction: "outbound",
            status: "accepted",
            sentAt: now,
            updatedAt: now,
          });

          await db
            .update(conversations)
            .set({ lastMessageTime: now, updatedAt: now })
            .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, session.tenantId)));

          // Se for nota comercial vinculada explicitamente a um card/deal
          // NOTA MANDATÓRIA (Fase 0): Nota geral permanece apenas na conversa.
          // Envio ao CRM exige dealId explícito, sem presunção cega de card único no contato.
          if (isInternalNote && dealId) {
            (async () => {
              try {
                let noteUserId: string | undefined;
                if (senderEmail) {
                  try {
                    const users = await getCachedUsers(session.tenantId);
                    const matched = users.find((u: any) => u.email?.toLowerCase() === senderEmail.toLowerCase());
                    if (matched) noteUserId = matched._id || matched.id;
                  } catch {}
                }

                await rdRequest(
                  session.tenantId,
                  "POST",
                  `/deals/${dealId}/activity_notes`,
                  {
                    activity_note: {
                      text: content,
                      user_id: noteUserId,
                    },
                  }
                );
              } catch (err: any) {
                console.error("[api/chats] Erro ao enviar nota para RD CRM:", err.message);
              }
            })();
          }

          return new Response(JSON.stringify({ success: true, id: msgId }), {
            status: 200,
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

      // GET /api/chats — Retorna lista paginada e otimizada de conversas do tenant
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Content-Type": "application/json",
        };

        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const url = new URL(request.url);
          const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10), 1), 300);
          const queueFilter = url.searchParams.get("queue");
          const beforeCursor = url.searchParams.get("before");
          const requestedConversationId = url.searchParams.get("conversationId");

          // 0. Carregar mapa de operadores do tenant em memória
          const allOperators = await db
            .select({ id: operators.id, name: operators.name })
            .from(operators)
            .where(eq(operators.tenantId, session.tenantId));
          const operatorMap = new Map(allOperators.map((o) => [o.id, o.name]));

          // 1. Montar condições da query com isolamento por tenant
          const conditions = [eq(conversations.tenantId, session.tenantId)];

          if (requestedConversationId) {
            conditions.push(eq(conversations.id, requestedConversationId));
          }

          if (queueFilter && queueFilter !== "todos") {
            conditions.push(eq(conversations.queueState, queueFilter));
          }

          if (beforeCursor) {
            const beforeDate = new Date(beforeCursor);
            if (!isNaN(beforeDate.getTime())) {
              conditions.push(lt(conversations.lastMessageTime, beforeDate));
            }
          }

          // 2. Buscar conversas com contacts e sectors via INNER JOIN eficiente
          // Prioriza sempre as conversas ativas (não finalizadas) na ordenação inicial
          const rows = await db
            .select({
              conversation: conversations,
              contact: contacts,
              sectorName: sectors.name,
            })
            .from(conversations)
            .innerJoin(contacts, and(eq(conversations.contactId, contacts.id), eq(contacts.tenantId, session.tenantId)))
            .leftJoin(sectors, and(eq(conversations.sectorId, sectors.id), eq(sectors.tenantId, session.tenantId)))
            .where(and(...conditions))
            .orderBy(
              sql`CASE WHEN ${conversations.queueState} != 'finalizados' THEN 0 ELSE 1 END`,
              desc(conversations.lastMessageTime)
            )
            .limit(requestedConversationId ? 1 : limit);

          if (rows.length === 0) {
            return new Response(JSON.stringify([]), { headers: corsHeaders });
          }

          // 3. Buscar mensagens recentes em lote (BATCH) eliminando o problema N+1
          const convIds = rows.map((r) => r.conversation.id);
          const recentMessages = await db
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, session.tenantId),
                inArray(messages.conversationId, convIds)
              )
            )
            .orderBy(desc(messages.sentAt))
            .limit(convIds.length * 30); // Limite razoável para preview

          // Agrupa mensagens por conversa
          const messagesByConv = new Map<string, any[]>();
          for (const m of recentMessages) {
            const list = messagesByConv.get(m.conversationId) || [];
            list.push(m);
            messagesByConv.set(m.conversationId, list);
          }

          const aiPersona = getAiPersona(session.tenantId);
          const aiName = `${aiPersona.name} IA`;

          // 4. Montar a lista formatada de retorno
          const chatList = rows.map((row) => {
            const convMsgs = (messagesByConv.get(row.conversation.id) || []).reverse();

            const initials = row.contact.name
              .split(" ")
              .map((w: string) => w[0])
              .join("")
              .toUpperCase()
              .substring(0, 2);

            let respName = "Na Fila";
            if (row.conversation.operatorId && operatorMap.has(row.conversation.operatorId)) {
              respName = operatorMap.get(row.conversation.operatorId)!;
            } else if (row.conversation.queueState === "automacao") {
              respName = aiName;
            } else if (row.contact.responsibleName && row.contact.responsibleName !== "Na Fila") {
              respName = row.contact.responsibleName;
            }

            return {
              id: row.conversation.id,
              contactId: row.contact.id,
              name: row.contact.name,
              avatar: row.contact.avatar || "",
              initials: initials || "C",
              initialsBg: "#a6d6f2",
              phone: row.contact.phone || "",
              whatsappUsername: row.contact.whatsappUsername || "",
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
              version: row.conversation.version || 1, // Concorrência otimista (Entrega C)
              lastMessageTime: new Date(row.conversation.lastMessageTime).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              messages: convMsgs.map((m) => ({
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
                }),
                sentAtISO: new Date(m.sentAt).toISOString(),
                side: m.senderType === "client" ? "in" : "out",
                isInternalNote: m.isInternalNote,
                senderType: m.senderType,
                quotedMessageId: m.quotedMessageId,
                quotedMessageSender: m.quotedMessageSender,
                quotedMessageContent: m.quotedMessageContent,
                reactions: readReactions(m.metaDetails),
              })),
            };
          });

          return new Response(JSON.stringify(chatList), {
            headers: corsHeaders,
          });

        } catch (e: any) {
          console.error("[api/chats GET] Erro ao buscar lista de conversas:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: corsHeaders,
          });
        }
      },
    },
  },
});
