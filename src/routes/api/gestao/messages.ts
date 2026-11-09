import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts, conversations, messages, operators } from "../../../db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { requireConversationAccess } from "../../../lib/access-control/conversation-access";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function canAccessSupervisorMessages(session: any): boolean {
  if (session?.operator?.role === "admin") return true;
  if (session?.permissions?.views?.monitor !== true) return false;
  const mon = session?.permissions?.monitor;
  return Boolean(
    mon?.canAccessLive === true ||
      mon?.canAccessAlerts === true ||
      mon?.canAccessAudits === true ||
      mon?.canAccessTasks === true
  );
}

/**
 * GET /api/gestao/messages?tenantId=&conversationId=
 * Retorna TODAS as mensagens de uma conversa específica (sem limite) com metadados completos.
 *
 * POST /api/gestao/messages
 * Permite que a diretoria/supervisão envie um "Sussurro" (Nota Interna de Supervisão)
 * diretamente na conversa monitorada sem precisar capturar o atendimento do consultor.
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
          if (!canAccessSupervisorMessages(session)) {
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          }
          const denied = await requireConversationAccess(session, conversationId);
          if (denied) return denied;

          const rows = await db
            .select({
              id: messages.id,
              conversationId: messages.conversationId,
              senderType: messages.senderType,
              senderName: messages.senderName,
              content: messages.content,
              sentAt: messages.sentAt,
              isInternalNote: messages.isInternalNote,
              mediaInterpretation: messages.mediaInterpretation,
              status: messages.status,
              errorMessage: messages.errorMessage,
              quotedMessageId: messages.quotedMessageId,
              quotedMessageSender: messages.quotedMessageSender,
              quotedMessageContent: messages.quotedMessageContent,
              metaDetails: messages.metaDetails,
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
            mediaInterpretation: m.mediaInterpretation ?? null,
            status: m.status ?? "accepted",
            errorMessage: m.errorMessage ?? null,
            quotedMessageId: m.quotedMessageId ?? null,
            quotedMessageSender: m.quotedMessageSender ?? null,
            quotedMessageContent: m.quotedMessageContent ?? null,
            metaDetails: m.metaDetails ?? null,
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

      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (!canAccessSupervisorMessages(session)) {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente para enviar orientação de supervisão.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const body = (await request.json().catch(() => ({}))) as {
            conversationId?: string;
            content?: string;
            targetOperatorId?: string | null;
          };

          const conversationId = String(body.conversationId || "").trim();
          const rawContent = String(body.content || "").trim();
          const requestedTargetOpId = body.targetOperatorId
            ? String(body.targetOperatorId).trim()
            : null;

          if (!conversationId || !rawContent) {
            return new Response(
              JSON.stringify({ error: "conversationId e content são obrigatórios." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (rawContent.length > 4000) {
            return new Response(
              JSON.stringify({ error: "A orientação interna não pode exceder 4000 caracteres." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const denied = await requireConversationAccess(session, conversationId);
          if (denied) return denied;

          const [conv] = await db
            .select({
              id: conversations.id,
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
              sectorId: conversations.sectorId,
              version: conversations.version,
              contactName: contacts.name,
              contactPhone: contacts.phone,
              contactAvatar: contacts.avatar,
              walletOperatorId: contacts.operatorId,
            })
            .from(conversations)
            .leftJoin(
              contacts,
              and(
                eq(conversations.contactId, contacts.id),
                eq(contacts.tenantId, tenantId)
              )
            )
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, tenantId)
              )
            )
            .limit(1);

          if (!conv) {
            return new Response(
              JSON.stringify({ error: "Conversa não encontrada." }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          let effectiveOperatorId = conv.operatorId || null;
          let effectiveOperatorName: string | null = null;
          let effectiveQueueState = conv.queueState;
          let didAssignOperator = false;
          let systemAssignMessage: {
            id: string;
            conversationId: string;
            senderType: "system";
            senderName: string;
            content: string;
            sentAt: string;
            isInternalNote: boolean;
            status: string;
          } | null = null;

          const targetLookupId = requestedTargetOpId || conv.operatorId || conv.walletOperatorId || null;
          if (targetLookupId) {
            const [opRow] = await db
              .select({ id: operators.id, name: operators.name })
              .from(operators)
              .where(
                and(
                  eq(operators.id, targetLookupId),
                  eq(operators.tenantId, tenantId)
                )
              )
              .limit(1);
            if (opRow) {
              effectiveOperatorName = opRow.name;
              if (requestedTargetOpId) {
                if (conv.operatorId !== opRow.id || conv.queueState !== "meus") {
                  didAssignOperator = true;
                }
                effectiveOperatorId = opRow.id;
                effectiveQueueState = "meus";
              } else if (!effectiveOperatorId) {
                effectiveOperatorId = opRow.id;
              }
            }
          }

          const now = new Date();
          const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const senderLabel = `${session.operator.name} (Supervisão)`;

          const whisperMetaDetails = {
            supervisorWhisper: true,
            targetOperatorId: effectiveOperatorId,
            targetOperatorName: effectiveOperatorName,
            attendanceActor: {
              name: session.operator.name,
              operatorId: session.operator.id,
              role: session.operator.role,
            },
          };

          if (didAssignOperator && effectiveOperatorId && effectiveOperatorName) {
            const sysMsgId = `msg-${Date.now() - 1}-${Math.random().toString(36).slice(2, 7)}`;
            const sysText = `Atendimento atribuído para ${effectiveOperatorName} pela Supervisão (${session.operator.name}).`;
            const sysTime = new Date(now.getTime() - 50);

            await db.insert(messages).values({
              id: sysMsgId,
              tenantId,
              conversationId,
              senderType: "system",
              senderName: "Sistema",
              content: sysText,
              isInternalNote: false,
              provider: "internal",
              direction: "outbound",
              status: "accepted",
              metaDetails: {
                supervisorIntervention: "transfer",
                attendanceActor: {
                  name: session.operator.name,
                  operatorId: session.operator.id,
                  role: session.operator.role,
                },
              },
              sentAt: sysTime,
              updatedAt: sysTime,
            });

            systemAssignMessage = {
              id: sysMsgId,
              conversationId,
              senderType: "system",
              senderName: "Sistema",
              content: sysText,
              sentAt: sysTime.toISOString(),
              isInternalNote: false,
              status: "accepted",
            };
          }

          await db.insert(messages).values({
            id: msgId,
            tenantId,
            conversationId,
            senderType: "agent",
            senderName: senderLabel,
            content: rawContent,
            isInternalNote: true,
            provider: "internal",
            direction: "outbound",
            status: "accepted",
            metaDetails: whisperMetaDetails,
            sentAt: now,
            updatedAt: now,
          });

          await db
            .update(conversations)
            .set({
              ...(didAssignOperator && effectiveOperatorId
                ? {
                    operatorId: effectiveOperatorId,
                    queueState: "meus",
                    version: sql`COALESCE(${conversations.version}, 1) + 1`,
                  }
                : {}),
              lastMessageTime: now,
              unreadCount: sql`COALESCE(${conversations.unreadCount}, 0) + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, tenantId)
              )
            );

          // Notificar via SSE para aparecer instantaneamente (com alerta sonoro + toast) na tela do consultor
          try {
            const { SessionManager } = await import("../../../lib/baileys/session-manager");
            if (didAssignOperator && effectiveOperatorId) {
              SessionManager.getInstance().notifyPublic(tenantId, {
                type: "queue_update",
                conversationId,
                queueState: "meus",
                operatorId: effectiveOperatorId,
                sectorId: conv.sectorId,
                responsibleName: effectiveOperatorName || undefined,
                version: (conv.version || 1) + 1,
              });
            }
            if (systemAssignMessage) {
              SessionManager.getInstance().notifyPublic(tenantId, {
                type: "message",
                message: systemAssignMessage,
              });
            }
            SessionManager.getInstance().notifyPublic(tenantId, {
              type: "message",
              message: {
                id: msgId,
                conversationId,
                senderType: "agent",
                senderName: senderLabel,
                content: rawContent,
                isInternalNote: true,
                isSupervisorWhisper: true,
                sentAt: now.toISOString(),
                status: "accepted",
                operatorId: effectiveOperatorId,
                walletOperatorId: conv.walletOperatorId ?? null,
                queue: effectiveQueueState,
                phone: conv.contactPhone ?? undefined,
                avatar: conv.contactAvatar ?? undefined,
                contactName: conv.contactName ?? "Cliente",
                metaDetails: whisperMetaDetails,
              },
            });
          } catch (sseErr: any) {
            console.warn("[gestao/messages POST] Falha não-crítica ao emitir SSE:", sseErr?.message);
          }

          return new Response(
            JSON.stringify({
              success: true,
              assignedOperatorId: effectiveOperatorId,
              assignedOperatorName: effectiveOperatorName,
              assignedQueueState: effectiveQueueState,
              didAssignOperator,
              message: {
                id: msgId,
                conversationId,
                senderType: "agent",
                senderName: senderLabel,
                content: rawContent,
                sentAt: now.toISOString(),
                isInternalNote: true,
                isSupervisorWhisper: true,
                status: "accepted",
                metaDetails: whisperMetaDetails,
              },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[gestao/messages POST] Erro ao enviar sussurro de supervisão:", e);
          return new Response(
            JSON.stringify({ error: e.message || "Erro interno ao salvar orientação." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
