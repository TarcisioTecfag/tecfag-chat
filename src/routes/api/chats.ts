import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { conversations, contacts, messages, sectors, operators } from "../../db/schema";
import { eq, and, or, desc, lt, inArray, sql } from "drizzle-orm";
import { rdRequest, getCachedUsers } from "../../lib/rdCrmService";
import { requireSession } from "../../lib/auth-session";
import { getAiPersona } from "../../lib/ai-persona";
import { readReactions } from "../../lib/whatsapp/meta-reactions";
import { conversationReadCondition, requireConversationWriteAccess } from "../../lib/access-control/conversation-access";
import { conversationReadRules } from "../../lib/access-control/conversation-policy";
import { getDealContext, recordConversationAction, assertDealContextVersion, DealContextError } from "../../lib/crm/conversation-deal-context";

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

      // PATCH /api/chats — Atualiza contador de mensagens não lidas com isolamento por tenant
      PATCH: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Content-Type": "application/json",
        };

        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const body = (await request.json().catch(() => ({}))) as {
            conversationId?: string;
            unreadCount?: number;
          };

          const { conversationId, unreadCount = 0 } = body;
          if (!conversationId) {
            return new Response(JSON.stringify({ error: "conversationId é obrigatório" }), {
              status: 400,
              headers: corsHeaders,
            });
          }

          const targetUnread = Math.max(0, Math.floor(Number(unreadCount) || 0));
          const denied = await requireConversationWriteAccess(session, conversationId);
          if (denied) return denied;

          await db
            .update(conversations)
            .set({
              unreadCount: targetUnread,
            })
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, session.tenantId),
                conversationReadCondition(session),
                eq(conversations.operatorId, session.operator.id), eq(conversations.queueState, "meus")
              )
            );

          return new Response(JSON.stringify({ success: true, conversationId, unreadCount: targetUnread }), {
            status: 200,
            headers: corsHeaders,
          });
        } catch (e: any) {
          console.error("[api/chats PATCH] Erro:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: corsHeaders,
          });
        }
      },

      // POST /api/chats — Persiste mensagem (nota interna ou do sistema) no banco
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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
            expectedContextVersion?: number;
            noteScope?: "current" | "general";
            clientMessageId?: string;
            checkAccessIds?: string[];
          };

          if (body.checkAccessIds !== undefined) {
            const ids = body.checkAccessIds;
            if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== "string" || !id || id.length > 160)) {
              return Response.json({ error: "Informe até 100 identificadores válidos." }, { status: 400 });
            }
            const visible = ids.length ? await db.select({ id: conversations.id }).from(conversations).where(and(
              eq(conversations.tenantId, session.tenantId), inArray(conversations.id, [...new Set(ids)]), conversationReadCondition(session),
            )) : [];
            return Response.json({ operatorId: session.operator.id, visibleConversationIds: visible.map((row) => row.id) }, { headers: { "Cache-Control": "no-store" } });
          }

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

          const denied = await requireConversationWriteAccess(session, conversationId);
          if (denied) return denied;

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
          if (isInternalNote && session.permissions.chat.canSendInternalNotes !== true) {
            return Response.json({ error: "Sem permissão para enviar notas internas.", code: "FORBIDDEN" }, { status: 403 });
          }

          if (body.noteScope !== undefined && !["current", "general"].includes(body.noteScope)) return Response.json({ error: "Destino da nota inválido." }, { status: 400 });
          if (body.clientMessageId !== undefined && (typeof body.clientMessageId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(body.clientMessageId))) return Response.json({ error: "Identificador de mensagem inválido." }, { status: 400 });
          let msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          let selectedRdDealId: string | null = null;
          const now = new Date();

          const stored = await db.transaction(async (tx) => {
            const [owned] = await tx.select({ id: conversations.id }).from(conversations).where(and(
              eq(conversations.id, conversationId), eq(conversations.tenantId, session.tenantId),
              eq(conversations.operatorId, session.operator.id), eq(conversations.queueState, "meus"), conversationReadCondition(session),
            )).for("update").limit(1);
            if (!owned) return false;
            if (body.clientMessageId) {
              const [existing] = await tx.select({ id: messages.id }).from(messages).where(and(
                eq(messages.tenantId, session.tenantId), eq(messages.conversationId, conversationId), eq(messages.idempotencyKey, body.clientMessageId),
              )).limit(1);
              if (existing) { msgId = existing.id; return true; }
            }
            const state = isInternalNote ? await getDealContext(tx, session.tenantId, conversationId, session.operator.id) : null;
            const generalNote = body.noteScope === "general";
            if (state && senderType !== "system" && !generalNote) {
              assertDealContextVersion(state.context, body.expectedContextVersion);
              if (!state.context.currentDealId) throw new DealContextError("Selecione a negociação deste atendimento ou marque a nota como geral.", "DEAL_CONTEXT_REQUIRED");
            }
            const selectedDealId = generalNote ? null : state?.context.currentDealId || null;
            selectedRdDealId = state?.deals.find(d => d.id === selectedDealId)?.rdDealId || null;
            await tx.insert(messages).values({
              id: msgId,
              conversationId,
              tenantId: session.tenantId,
              senderType: senderType as any,
              senderName: senderName || session.operator.name,
              content,
              isInternalNote,
              idempotencyKey: body.clientMessageId || null,
              quotedMessageId: quotedMessageId ?? null,
              quotedMessageSender: quotedMessageSender ?? null,
              quotedMessageContent: quotedMessageContent ?? null,
              direction: "outbound",
              status: "accepted",
              sentAt: now,
              updatedAt: now,
            });

            if (isInternalNote) await recordConversationAction(tx, {
              tenantId: session.tenantId, conversationId, dealId: selectedDealId, operatorId: session.operator.id,
              messageId: msgId, content, type: senderType === "system" ? "system_event" : "note",
            });

            await tx.update(conversations).set({
              ...(isInternalNote || senderType === "system" ? {} : { lastMessageTime: now }),
              updatedAt: now,
              unreadCount: 0,
            }).where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, session.tenantId)));
            return true;
          });
          if (!stored) return Response.json({ error: "O responsável pelo atendimento mudou. Atualize a conversa.", code: "FORBIDDEN" }, { status: 403 });

          // Integração externa usa exclusivamente o ID RD do card validado no servidor.
          if (isInternalNote && selectedRdDealId) {
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
                  `/deals/${selectedRdDealId}/activity_notes`,
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
          if (e instanceof DealContextError) return Response.json({ error: e.message, code: e.code }, { status: e.statusCode });
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
          "Cache-Control": "no-store",
        };

        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const url = new URL(request.url);
          const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10), 1), 300);
          const queueFilter = url.searchParams.get("queue");
          const beforeCursor = url.searchParams.get("before");
          const beforeId = url.searchParams.get("beforeId");
          const beforeQueue = url.searchParams.get("beforeQueue");
          const requestedConversationId = url.searchParams.get("conversationId");
          const includeRecent = url.searchParams.get("includeRecent") === "1";

          if (url.searchParams.get("ownership") === "1") {
            const ownership = await db.select({
              id: conversations.id,
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
              responsibleName: operators.name,
              sectorId: conversations.sectorId,
              version: conversations.version,
            }).from(conversations)
              .leftJoin(operators, and(eq(operators.id, conversations.operatorId), eq(operators.tenantId, session.tenantId)))
              .where(and(eq(conversations.tenantId, session.tenantId), conversationReadCondition(session)))
              .orderBy(desc(conversations.updatedAt))
              .limit(500);
            return Response.json({
              operatorId: session.operator.id,
              role: session.operator.role,
              permissions: session.permissions,
              ownership,
            }, {
              headers: { "Cache-Control": "no-store" },
            });
          }
          if (!conversationReadRules(session).enabled) return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });

          // 1. Montar condições da query com isolamento por tenant
          const conditions = [eq(conversations.tenantId, session.tenantId), conversationReadCondition(session)];

          if (requestedConversationId) {
            conditions.push(eq(conversations.id, requestedConversationId));
          }

          if (queueFilter && queueFilter !== "todos") {
            conditions.push(eq(conversations.queueState, queueFilter));
          }
          if (queueFilter === "meus" && url.searchParams.get("mine") === "1") {
            conditions.push(eq(conversations.operatorId, session.operator.id));
          }

          if (beforeCursor) {
            const beforeDate = new Date(beforeCursor);
            if (!isNaN(beforeDate.getTime())) {
              const olderInGroup = beforeId
                ? or(lt(conversations.lastMessageTime, beforeDate), and(
                    eq(conversations.lastMessageTime, beforeDate), lt(conversations.id, beforeId),
                  ))!
                : lt(conversations.lastMessageTime, beforeDate);
              if ((!queueFilter || queueFilter === "todos") && (beforeQueue === "active" || beforeQueue === "finalizados")) {
                const rank = beforeQueue === "active" ? 0 : 1;
                const queueRank = sql<number>`CASE WHEN ${conversations.queueState} != 'finalizados' THEN 0 ELSE 1 END`;
                conditions.push(or(sql`${queueRank} > ${rank}`, and(sql`${queueRank} = ${rank}`, olderInGroup))!);
              } else {
                conditions.push(olderInGroup);
              }
            }
          }

          // 2. Buscar conversas com contacts e sectors via INNER JOIN eficiente
          // Prioriza sempre as conversas ativas (não finalizadas) na ordenação inicial
          const rowsQuery = db
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
              desc(conversations.lastMessageTime),
              desc(conversations.id)
            )
            .limit(requestedConversationId ? 1 : limit + 1);
          const [allOperators, fetchedRows] = await Promise.all([
            db.select({ id: operators.id, name: operators.name }).from(operators)
              .where(eq(operators.tenantId, session.tenantId)),
            rowsQuery,
          ]);
          const operatorMap = new Map(allOperators.map((operator) => [operator.id, operator.name]));
          const hasMore = !requestedConversationId && fetchedRows.length > limit;
          const rows = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;

          if (rows.length === 0) {
            return new Response(JSON.stringify([]), { headers: { ...corsHeaders, "X-Has-More": "0" } });
          }

          // A lista só precisa da última mensagem para o preview. O histórico
          // completo é carregado, com paginação, quando a conversa é aberta.
          const convIds = rows.map((r) => r.conversation.id);
          const messageFields = {
            id: messages.id,
            conversationId: messages.conversationId,
            senderType: messages.senderType,
            senderName: messages.senderName,
            content: messages.content,
            isInternalNote: messages.isInternalNote,
            quotedMessageId: messages.quotedMessageId,
            quotedMessageSender: messages.quotedMessageSender,
            quotedMessageContent: messages.quotedMessageContent,
            metaDetails: messages.metaDetails,
            status: messages.status,
            idempotencyKey: messages.idempotencyKey,
            provider: messages.provider,
            errorMessage: messages.errorMessage,
            sentAt: messages.sentAt,
          };
          const recentPerConversation = requestedConversationId || includeRecent ? 30 : 1;
          const latestMessage = db.select(messageFields).from(messages)
            .where(and(eq(messages.tenantId, session.tenantId), eq(messages.conversationId, conversations.id)))
            .orderBy(desc(messages.sentAt), desc(messages.id))
            .limit(recentPerConversation).as("latest_message");
          const [recentMessages, latestClientTimes] = await Promise.all([
            db.select().from(conversations)
              .leftJoinLateral(latestMessage, sql`true`)
              .where(and(eq(conversations.tenantId, session.tenantId), inArray(conversations.id, convIds)))
              .then((rowsRes) => rowsRes.flatMap((row) => row.latest_message ? [row.latest_message] : [])),
            db.select({
              conversationId: messages.conversationId,
              lastClientSentAt: sql<Date | string | null>`max(${messages.sentAt})`,
            })
              .from(messages)
              .where(
                and(
                  eq(messages.tenantId, session.tenantId),
                  inArray(messages.conversationId, convIds),
                  eq(messages.senderType, "client"),
                ),
              )
              .groupBy(messages.conversationId),
          ]);

          const lastClientTimeByConv = new Map<string, string>();
          for (const item of latestClientTimes) {
            if (item.lastClientSentAt) {
              try {
                const d = new Date(item.lastClientSentAt);
                if (!isNaN(d.getTime())) {
                  lastClientTimeByConv.set(item.conversationId, d.toISOString());
                }
              } catch {}
            }
          }

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
            const convMsgs = (messagesByConv.get(row.conversation.id) || [])
              .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime() || b.id.localeCompare(a.id))
              .reverse();

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

            const clientIso = lastClientTimeByConv.get(row.conversation.id);
            const fallbackIso = row.conversation.lastMessageTime.toISOString();

            return {
              id: row.conversation.id,
              contactId: row.contact.id,
              name: row.contact.name,
              avatar: row.contact.avatar || "",
              initials: initials || "C",
              initialsBg: "",
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
              // Leitura de lista nunca escreve no banco. O contador é mantido
              // pelos fluxos de mensagem e marcação de leitura.
              unreadCount: convMsgs.at(-1)?.senderType === "client"
                ? row.conversation.unreadCount
                : 0,
              version: row.conversation.version || 1, // Concorrência otimista (Entrega C)
              lastMessageTime: new Date(clientIso || row.conversation.lastMessageTime).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              lastMessageAtISO: clientIso || fallbackIso,
              lastClientMessageAtISO: clientIso || fallbackIso,
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
                status: m.status,
                clientMessageId: m.idempotencyKey,
                provider: m.provider,
                errorMessage: m.status === "failed" ? m.errorMessage : null,
              })),
            };
          });

          return new Response(JSON.stringify(chatList), {
            headers: { ...corsHeaders, "X-Has-More": hasMore ? "1" : "0" },
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
