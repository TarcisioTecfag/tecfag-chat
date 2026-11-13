import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { conversations, contacts, messages, mediaFiles, sectors, operators } from "../../db/schema";
import { eq, and, or, desc, lt, inArray, sql } from "drizzle-orm";
import { rdRequest, getCachedUsers } from "../../lib/rdCrmService";
import { requireSession } from "../../lib/auth-session";
import { getAiPersona } from "../../lib/ai-persona";
import { readReactions } from "../../lib/whatsapp/meta-reactions";
import { SessionManager } from "../../lib/baileys/session-manager";
import { conversationReadCondition, requireConversationAccess, requireConversationWriteAccess } from "../../lib/access-control/conversation-access";
import { conversationReadRules } from "../../lib/access-control/conversation-policy";
import { getDealContext, recordConversationAction, assertDealContextVersion, DealContextError, findActiveGraceDeal } from "../../lib/crm/conversation-deal-context";
import { getContactPhonesMap } from "../../lib/crm/contact-phones";
import { computeContactPhoneIdentity, getContactPhoneTypeLabel } from "../../lib/contact-phone-types";

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

          const MAX_NOTE_ATTACHMENT_BYTES = 50 * 1024 * 1024;
          const contentType = request.headers?.get?.("content-type") || "";

          let body: {
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
          let pendingNoteFile:
            | {
                id: string;
                buffer: Buffer;
                mime: string;
                name: string;
                mediaType: "image" | "video" | "audio" | "document";
                rawCaption: string;
              }
            | undefined;

          if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const rawCaption = String(formData.get("content") || "").trim();
            const file = formData.get("file");
            if (!(file instanceof File)) {
              return Response.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
            }
            if (file.size <= 0) {
              return Response.json({ error: "O arquivo enviado está vazio." }, { status: 400 });
            }
            if (file.size > MAX_NOTE_ATTACHMENT_BYTES) {
              return Response.json(
                { error: "O arquivo excede o limite máximo de 50MB." },
                { status: 400 },
              );
            }

            const fileId = `media-${crypto.randomUUID()}`;
            const mime = (file.type || "application/octet-stream").trim() || "application/octet-stream";
            const safeFileName =
              (file.name || "arquivo")
                .replace(/[\r\n:]+/g, "_")
                .trim()
                .slice(0, 180) || "arquivo";
            const ext = safeFileName.split(".").pop()?.toLowerCase() || "";

            let mediaType: "image" | "video" | "audio" | "document" = "document";
            if (mime.startsWith("image/")) {
              mediaType = "image";
            } else if (
              mime.startsWith("audio/") ||
              ["mp3", "ogg", "webm", "m4a", "aac", "oga", "opus", "wav"].includes(ext)
            ) {
              mediaType = "audio";
            } else if (
              mime.startsWith("video/") ||
              ["mp4", "mov", "webm", "mkv", "avi", "m4v", "3gp", "mpeg", "mpg"].includes(ext)
            ) {
              mediaType = "video";
            }

            const buffer = Buffer.from(await file.arrayBuffer());
            pendingNoteFile = {
              id: fileId,
              buffer,
              mime,
              name: safeFileName,
              mediaType,
              rawCaption,
            };

            const expectedVerRaw = formData.get("expectedContextVersion");
            const parsedExpectedVer =
              expectedVerRaw !== null && expectedVerRaw !== ""
                ? Number(expectedVerRaw)
                : undefined;
            const rawScope = formData.get("noteScope");
            const rawClientMsgId = formData.get("clientMessageId");

            body = {
              conversationId: String(formData.get("conversationId") || "").trim(),
              senderType: String(formData.get("senderType") || "agent"),
              senderName: formData.get("senderName") ? String(formData.get("senderName")) : undefined,
              senderEmail: formData.get("senderEmail") ? String(formData.get("senderEmail")) : undefined,
              content: `[MEDIA:${mediaType}]${fileId}:${safeFileName}${rawCaption ? `\n${rawCaption}` : ""}`,
              isInternalNote: formData.get("isInternalNote") === "true",
              expectedContextVersion: Number.isFinite(parsedExpectedVer) ? parsedExpectedVer : undefined,
              noteScope: rawScope ? (String(rawScope) as "current" | "general") : undefined,
              clientMessageId: rawClientMsgId ? String(rawClientMsgId).trim() : undefined,
              quotedMessageId: formData.get("quotedMessageId") ? String(formData.get("quotedMessageId")) : null,
              quotedMessageSender: formData.get("quotedMessageSender")
                ? String(formData.get("quotedMessageSender"))
                : null,
              quotedMessageContent: formData.get("quotedMessageContent")
                ? String(formData.get("quotedMessageContent"))
                : null,
            };
          } else {
            body = (await request.json()) as typeof body;
          }

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

          if (isInternalNote && session.permissions.chat.canSendInternalNotes !== true) {
            return Response.json({ error: "Sem permissão para enviar notas internas.", code: "FORBIDDEN" }, { status: 403 });
          }

          const denied = isInternalNote
            ? await requireConversationAccess(session, conversationId)
            : await requireConversationWriteAccess(session, conversationId);
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

          if (!isInternalNote && (conv.queueState !== "meus" || conv.operatorId !== session.operator.id)) {
            return Response.json({ error: "Capture o atendimento antes de escrever nesta conversa.", code: "FORBIDDEN" }, { status: 403 });
          }

          if (body.noteScope !== undefined && !["current", "general"].includes(body.noteScope)) return Response.json({ error: "Destino da nota inválido." }, { status: 400 });
          if (body.clientMessageId !== undefined && (typeof body.clientMessageId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(body.clientMessageId))) return Response.json({ error: "Identificador de mensagem inválido." }, { status: 400 });
          let msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          let msgContent = content;
          let reusedIdempotent = false;
          let selectedRdDealId: string | null = null;
          const now = new Date();

          const stored = await db.transaction(async (tx) => {
            const [lockedConv] = await tx
              .select({
                id: conversations.id,
                queueState: conversations.queueState,
                operatorId: conversations.operatorId,
              })
              .from(conversations)
              .where(
                and(
                  eq(conversations.id, conversationId),
                  eq(conversations.tenantId, session.tenantId),
                  ...(isInternalNote
                    ? []
                    : [
                        eq(conversations.operatorId, session.operator.id),
                        eq(conversations.queueState, "meus"),
                      ]),
                  conversationReadCondition(session),
                ),
              )
              .for("update")
              .limit(1);
            if (!lockedConv) return false;
            const effectiveQueueState = lockedConv.queueState ?? conv.queueState;
            const effectiveOperatorId =
              lockedConv.operatorId !== undefined ? lockedConv.operatorId : conv.operatorId;
            const isCurrentOwner =
              effectiveQueueState === "meus" && effectiveOperatorId === session.operator.id;
            if (body.clientMessageId) {
              const [existing] = await tx.select({ id: messages.id, content: messages.content }).from(messages).where(and(
                eq(messages.tenantId, session.tenantId), eq(messages.conversationId, conversationId), eq(messages.idempotencyKey, body.clientMessageId),
              )).limit(1);
              if (existing) {
                msgId = existing.id;
                if (existing.content) msgContent = existing.content;
                reusedIdempotent = true;
                return true;
              }
            }
            const state = isInternalNote ? await getDealContext(tx, session.tenantId, conversationId, session.operator.id) : null;
            const graceDeal = state && !state.context.currentDealId ? findActiveGraceDeal(state.deals, [state.context.currentDealId, state.context.previousDealId]) : null;
            const generalNote = body.noteScope === "general" || !isCurrentOwner;
            if (state && senderType !== "system") {
              if (isCurrentOwner || body.expectedContextVersion !== undefined) {
                assertDealContextVersion(state.context, body.expectedContextVersion);
              }
              if (!state.context.currentDealId && !graceDeal && !generalNote) throw new DealContextError("Selecione a negociação deste atendimento ou permita salvar a nota com vínculo pendente.", "DEAL_CONTEXT_REQUIRED");
            }
            const selectedDealId = state?.context.currentDealId || graceDeal?.id || null;
            selectedRdDealId = state?.deals.find(d => d.id === selectedDealId)?.rdDealId || null;

            if (pendingNoteFile) {
              await tx.insert(mediaFiles).values({
                id: pendingNoteFile.id,
                tenantId: session.tenantId,
                conversationId,
                fileName: pendingNoteFile.name,
                mimeType: pendingNoteFile.mime,
                fileSize: pendingNoteFile.buffer.length,
                base64Data: pendingNoteFile.buffer.toString("base64"),
                createdAt: now,
              });
            }

            await tx.insert(messages).values({
              id: msgId,
              conversationId,
              tenantId: session.tenantId,
              senderType: senderType as any,
              senderName: senderName || session.operator.name,
              metaDetails: { attendanceActor: { name: session.operator.name, operatorId: session.operator.id } },
              content: msgContent,
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
              messageId: msgId, content: msgContent, type: senderType === "system" ? "system_event" : "note",
            });

            await tx.update(conversations).set({
              ...(isInternalNote || senderType === "system" ? {} : { lastMessageTime: now }),
              updatedAt: now,
              ...(isCurrentOwner ? { unreadCount: 0 } : {}),
            }).where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, session.tenantId)));
            return true;
          });
          if (!stored) return Response.json({ error: isInternalNote ? "Sem acesso a esta conversa." : "O responsável pelo atendimento mudou. Atualize a conversa.", code: "FORBIDDEN" }, { status: 403 });

          if (pendingNoteFile && !reusedIdempotent) {
            try {
              const fsMod = await import("node:fs");
              const pathMod = await import("node:path");
              const mediaDir = pathMod.join(process.cwd(), "media");
              if (!fsMod.existsSync(mediaDir)) fsMod.mkdirSync(mediaDir, { recursive: true });
              const targetDiskPath = pathMod.join(mediaDir, pendingNoteFile.id);
              if (!fsMod.existsSync(targetDiskPath)) {
                await fsMod.promises.writeFile(targetDiskPath, pendingNoteFile.buffer);
                await fsMod.promises.writeFile(pathMod.join(mediaDir, `${pendingNoteFile.id}.mime`), pendingNoteFile.mime);
              }
            } catch (fsErr) {
              console.warn("[api/chats POST] Mídia salva no banco, falha ao gravar cache em disco:", fsErr);
            }
          }

          try {
            const [contactRow] = conv.contactId
              ? await db
                  .select({
                    name: contacts.name,
                    phone: contacts.phone,
                    avatar: contacts.avatar,
                    walletOperatorId: contacts.walletOperatorId,
                  })
                  .from(contacts)
                  .where(
                    and(
                      eq(contacts.id, conv.contactId),
                      eq(contacts.tenantId, session.tenantId),
                    ),
                  )
                  .limit(1)
              : [];

            SessionManager.getInstance().notifyPublic(session.tenantId, {
              type: "message",
              message: {
                id: msgId,
                conversationId,
                contactId: conv.contactId,
                contactName: contactRow?.name || undefined,
                phone: conv.contactPhone || contactRow?.phone || undefined,
                avatar: contactRow?.avatar || undefined,
                whatsappConnectionId: conv.whatsappConnectionId,
                senderType: (senderType || "agent") as any,
                senderName: senderName || session.operator.name,
                content: msgContent,
                isInternalNote: !!isInternalNote,
                sentAt: now,
                status: "accepted",
                clientMessageId: body.clientMessageId || undefined,
                quotedMessageId: quotedMessageId ?? null,
                quotedMessageSender: quotedMessageSender ?? null,
                quotedMessageContent: quotedMessageContent ?? null,
                queue: conv.queueState,
                operatorId: conv.operatorId,
                walletOperatorId: contactRow?.walletOperatorId ?? null,
              },
            });
          } catch (sseErr) {
            console.warn("[api/chats POST] Nota salva, falha ao emitir SSE:", sseErr);
          }

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

                const rdNoteText = pendingNoteFile
                  ? `[Anexo interno: ${pendingNoteFile.name}]${pendingNoteFile.rawCaption ? `\n${pendingNoteFile.rawCaption}` : ""}`
                  : msgContent;

                await rdRequest(
                  session.tenantId,
                  "POST",
                  `/deals/${selectedRdDealId}/activity_notes`,
                  {
                    activity_note: {
                      text: rdNoteText,
                      user_id: noteUserId,
                    },
                  }
                );
              } catch (err: any) {
                console.error("[api/chats] Erro ao enviar nota para RD CRM:", err.message);
              }
            })();
          }

          return new Response(
            JSON.stringify({
              success: true,
              id: msgId,
              sentAtISO: now.toISOString(),
              ...(pendingNoteFile ? { mediaId: pendingNoteFile.id, mediaContent: msgContent } : {}),
            }),
            {
              status: 200,
              headers: corsHeaders,
            },
          );

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
              contactName: contacts.name,
            }).from(conversations)
              .leftJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, session.tenantId)))
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
          const contactIds = [...new Set(rows.map((r) => r.contact.id))];
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
            mediaInterpretation: messages.mediaInterpretation,
            sentAt: messages.sentAt,
          };
          const recentPerConversation = requestedConversationId || includeRecent ? 30 : 5;
          const latestMessage = db.select(messageFields).from(messages)
            .where(and(eq(messages.tenantId, session.tenantId), eq(messages.conversationId, conversations.id)))
            .orderBy(desc(messages.sentAt), desc(messages.id))
            .limit(recentPerConversation).as("latest_message");
          const [recentMessages, latestClientTimes, phonesByContactId] = await Promise.all([
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
            getContactPhonesMap(
              db,
              session.tenantId,
              contactIds,
              rows.map((r) => r.contact),
            ),
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

          const isAutoDealNote = (text?: string | null) =>
            /^(?:\[(?:Sistema|Nota)\]\s*)?Negociaç(?:ão|ões) (?:atual|deste atendimento|criada neste atendimento|vinculada)/i.test(
              (text || "").trim(),
            );

          const selectPreviewRawMessage = (list: any[]) => {
            if (!Array.isArray(list) || list.length === 0) return undefined;
            for (let i = list.length - 1; i >= 0; i--) {
              const candidate = list[i];
              if (
                !isAutoDealNote(candidate?.content) &&
                candidate?.senderType !== "system" &&
                candidate?.senderName !== "Sistema"
              ) {
                return candidate;
              }
            }
            for (let i = list.length - 1; i >= 0; i--) {
              const candidate = list[i];
              if (!isAutoDealNote(candidate?.content)) {
                return candidate;
              }
            }
            return list[list.length - 1];
          };

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
            const previewRawMsg = selectPreviewRawMessage(convMsgs);
            const rawPreviewDate = previewRawMsg?.sentAt
              ? new Date(previewRawMsg.sentAt)
              : new Date(row.conversation.lastMessageTime);
            const effectivePreviewDate = !isNaN(rawPreviewDate.getTime())
              ? rawPreviewDate
              : new Date(row.conversation.lastMessageTime);
            const effectivePreviewIso = effectivePreviewDate.toISOString();
            const cf = ((row.contact.customFields || {}) as Record<string, any>) || {};
            const siteVisitorId =
              typeof cf.siteVisitorId === "string" && cf.siteVisitorId
                ? cf.siteVisitorId
                : row.contact.id.startsWith("cont-lc-")
                  ? row.contact.id.slice("cont-lc-".length)
                  : row.conversation.id.startsWith("conv-lc-")
                    ? row.conversation.id.slice("conv-lc-".length)
                    : Array.isArray(cf.linkedSiteContactIds) &&
                        typeof cf.linkedSiteContactIds[0] === "string" &&
                        cf.linkedSiteContactIds[0].startsWith("cont-lc-")
                      ? cf.linkedSiteContactIds[0].slice("cont-lc-".length)
                      : null;
            const hasSiteJourney = Boolean(
              siteVisitorId ||
                row.contact.mainChannel === "livechat" ||
                cf.siteContext ||
                cf.siteContinuityCode ||
                (Array.isArray(cf.linkedSiteContactIds) && cf.linkedSiteContactIds.length > 0),
            );

            const contactPhonesList = phonesByContactId.get(row.contact.id) || [];
            const matchedPhoneItem =
              (row.conversation.contactPhoneId
                ? contactPhonesList.find((p) => p.id === row.conversation.contactPhoneId)
                : undefined) ||
              (row.conversation.contactPhone
                ? contactPhonesList.find(
                    (p) =>
                      computeContactPhoneIdentity(p.phone) ===
                      computeContactPhoneIdentity(row.conversation.contactPhone),
                  )
                : undefined) ||
              contactPhonesList.find((p) => p.isPrimary) ||
              contactPhonesList[0];

            const effectivePhone =
              row.conversation.contactPhone ||
              matchedPhoneItem?.phone ||
              row.contact.phone ||
              "";

            return {
              id: row.conversation.id,
              contactId: row.contact.id,
              contactPhoneId: row.conversation.contactPhoneId || matchedPhoneItem?.id || null,
              whatsappConnectionId: row.conversation.whatsappConnectionId,
              name: row.contact.name,
              avatar: row.contact.avatar || "",
              initials: initials || "C",
              initialsBg: "",
              phone: effectivePhone,
              phoneType: matchedPhoneItem?.type || null,
              phoneLabel: matchedPhoneItem
                ? getContactPhoneTypeLabel(matchedPhoneItem.type, matchedPhoneItem.label)
                : null,
              contactPhones: contactPhonesList,
              whatsappUsername: row.contact.whatsappUsername || "",
              email: row.contact.email || "",
              cnpj: row.contact.cnpj || "",
              cpf: row.contact.cpf || "",
              cnpjDetails: (row.contact as any).cnpjDetails || {},
              tags: row.contact.tags || [],
              channel: row.conversation.whatsappConnectionId ? "whatsapp" : row.contact.mainChannel || "whatsapp",
              siteVisitorId,
              hasSiteJourney,
              siteContext: cf.siteContext || null,
              siteContinuityCode: cf.siteContinuityCode || null,
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
              lastMessageTime: effectivePreviewDate.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "America/Sao_Paulo",
              }),
              lastMessageAtISO: effectivePreviewIso || fallbackIso,
              lastClientMessageAtISO: clientIso || effectivePreviewIso || fallbackIso,
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
                isSupervisorWhisper: Boolean((m.metaDetails as any)?.supervisorWhisper),
                metaDetails: (m.metaDetails as Record<string, any> | null) || null,
                senderType: m.senderType,
                quotedMessageId: m.quotedMessageId,
                quotedMessageSender: m.quotedMessageSender,
                quotedMessageContent: m.quotedMessageContent,
                reactions: readReactions(m.metaDetails),
                status: m.status,
                clientMessageId: m.idempotencyKey,
                provider: m.provider,
                errorMessage: m.status === "failed" ? m.errorMessage : null,
                mediaInterpretation: m.mediaInterpretation || null,
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
