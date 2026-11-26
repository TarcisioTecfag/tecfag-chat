import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { messages, conversations } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { dispatchStored, storedResult } from "../../../lib/whatsapp/dispatch";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { requireConversationWriteAccess } from "../../../lib/access-control/conversation-access";
import { extractPendingClientMessageId } from "../../../lib/whatsapp/reconcile-client";

export const Route = createFileRoute("/api/chats/reconcile-message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        try {
          const body = await request.json();
          const rawMessageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
          const rawClientMessageId =
            typeof body.clientMessageId === "string" ? body.clientMessageId.trim() : "";
          const fallbackClientMessageId = extractPendingClientMessageId(
            rawMessageId,
            rawClientMessageId,
          );
          if (!rawMessageId && !fallbackClientMessageId)
            return Response.json({ error: "Informe a mensagem." }, { status: 400 });

          let msg: (typeof messages.$inferSelect) | undefined;
          if (rawMessageId && !rawMessageId.startsWith("pending-")) {
            const [byId] = await db
              .select()
              .from(messages)
              .where(and(eq(messages.tenantId, tenantId), eq(messages.id, rawMessageId)));
            msg = byId;
          }
          if (!msg && fallbackClientMessageId) {
            const [byIdempotencyKey] = await db
              .select()
              .from(messages)
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  eq(messages.idempotencyKey, fallbackClientMessageId),
                ),
              );
            msg = byIdempotencyKey;
          }
          if (!msg || msg.direction !== "outbound" || msg.isInternalNote)
            return Response.json(
              { error: "Envio não encontrado.", code: "MESSAGE_NOT_FOUND" },
              { status: 404 },
            );
          const denied = await requireConversationWriteAccess(session, msg.conversationId);
          if (denied) return denied;
          const [conv] = await db
            .select()
            .from(conversations)
            .where(
              and(eq(conversations.tenantId, tenantId), eq(conversations.id, msg.conversationId)),
            );
          if (!conv) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
          if (
            conv.queueState !== "meus" || conv.operatorId !== session.operator.id
          )
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          if (["accepted", "delivered", "read"].includes(msg.status))
            return Response.json(storedResult(msg));
          if (
            msg.status === "sending" &&
            ((msg.leaseUntil && msg.leaseUntil.getTime() > Date.now()) ||
              Date.now() - msg.updatedAt.getTime() < 60_000)
          )
            return Response.json(
              { error: "O envio ainda está em processamento." },
              { status: 409 },
            );
          if (!["failed", "unknown", "uncertain", "sending"].includes(msg.status))
            return Response.json({ error: "Mensagem já está na fila." }, { status: 409 });
          if (body.action === "confirm_sent") {
            const [updated] = await db
              .update(messages)
              .set({
                status: "accepted",
                errorMessage: null,
                leaseToken: null,
                leaseUntil: null,
                metaDetails: {
                  ...msg.metaDetails,
                  manualConfirmation: {
                    operatorId: session.operator.id,
                    at: new Date().toISOString(),
                  },
                },
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  eq(messages.id, msg.id),
                  eq(messages.status, msg.status),
                ),
              )
              .returning();
            if (updated) SessionManager.getInstance().notifyPublic(tenantId, { type: "message_status", conversationId: msg.conversationId, messageId: msg.id, status: "accepted", error: null });
            return updated
              ? Response.json(storedResult(updated))
              : Response.json({ error: "Estado alterado; atualize o histórico." }, { status: 409 });
          }
          if (
            ["unknown", "uncertain", "sending"].includes(msg.status) &&
            body.confirmNotDelivered !== true
          )
            return Response.json(
              {
                error:
                  "Confira o histórico do WhatsApp antes de reenviar. Confirme que o envio anterior não ocorreu.",
                code: "DELIVERY_CONFIRMATION_REQUIRED",
              },
              { status: 409 },
            );
          const [queued] = await db
            .update(messages)
            .set({
              status: "pending",
              leaseToken: null,
              leaseUntil: null,
              nextRetryAt: new Date(),
              errorMessage: null,
              metaDetails: {
                ...msg.metaDetails,
                approvedReplayAt: new Date().toISOString(),
                replayedBy: session.operator.id,
              },
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.id, msg.id),
                eq(messages.status, msg.status),
              ),
            )
            .returning();
          if (!queued)
            return Response.json(
              { error: "Estado alterado; atualize o histórico." },
              { status: 409 },
            );
          return Response.json((await dispatchStored(tenantId, msg.id)) || storedResult(queued));
        } catch {
          return Response.json(
            { error: "Não foi possível reconciliar; registro preservado." },
            { status: 500 },
          );
        }
      },
    },
  },
});
