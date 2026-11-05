import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { conversations, messages } from "../../../db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { requireConversationAccess } from "../../../lib/access-control/conversation-access";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
          if (session.permissions?.views?.monitor !== true || session.permissions?.monitor?.canAccessLive !== true) {
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

        if (session.permissions?.views?.monitor !== true || session.permissions?.monitor?.canAccessLive !== true) {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente para enviar orientação de supervisão.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const body = (await request.json().catch(() => ({}))) as {
            conversationId?: string;
            content?: string;
          };

          const conversationId = String(body.conversationId || "").trim();
          const rawContent = String(body.content || "").trim();

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
            })
            .from(conversations)
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

          const now = new Date();
          const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const senderLabel = `${session.operator.name} (Supervisão)`;

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
            metaDetails: {
              supervisorWhisper: true,
              attendanceActor: {
                name: session.operator.name,
                operatorId: session.operator.id,
                role: session.operator.role,
              },
            },
            sentAt: now,
            updatedAt: now,
          });

          await db
            .update(conversations)
            .set({ updatedAt: now })
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, tenantId)
              )
            );

          // Notificar via SSE para aparecer instantaneamente na tela do operador
          try {
            const { SessionManager } = await import("../../../lib/baileys/session-manager");
            SessionManager.getInstance().notifyPublic(tenantId, {
              type: "message",
              message: {
                id: msgId,
                conversationId,
                senderType: "agent",
                senderName: senderLabel,
                content: rawContent,
                isInternalNote: true,
                sentAt: now.toISOString(),
                status: "accepted",
                metaDetails: {
                  supervisorWhisper: true,
                },
              },
            });
          } catch (sseErr: any) {
            console.warn("[gestao/messages POST] Falha não-crítica ao emitir SSE:", sseErr?.message);
          }

          return new Response(
            JSON.stringify({
              success: true,
              message: {
                id: msgId,
                conversationId,
                senderType: "agent",
                senderName: senderLabel,
                content: rawContent,
                sentAt: now.toISOString(),
                isInternalNote: true,
                status: "accepted",
                metaDetails: {
                  supervisorWhisper: true,
                },
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
