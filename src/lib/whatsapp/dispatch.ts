import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { channelConfigs, contacts, conversations, messages } from "../../db/schema";
import { metaAdapter } from "./adapters/meta";
import { baileysAdapter } from "./adapters/baileys";
import { restoreOutbound } from "./envelope";
import { replayPendingMetaStatuses } from "./meta-status";
import { resetMetaTypingThrottle } from "./meta-presence";
import { recordCommercialFirstResponse } from "../commercial/tma";
import { SessionManager } from "../baileys/session-manager";
import type { UniversalOutboundResult } from "./types";
import { resolveConversationConnection } from "./connections";
import { baileysStanzaId } from "./connection-policy";

export function storedResult(msg: typeof messages.$inferSelect): UniversalOutboundResult {
  return {
    success: ["pending", "sending", "accepted", "delivered", "read"].includes(msg.status),
    messageId: msg.id,
    status: (msg.status === "uncertain"
      ? "unknown"
      : msg.status) as UniversalOutboundResult["status"],
    externalId: msg.externalId || undefined,
    error: msg.errorMessage || undefined,
  };
}

/** Reserva curta no banco, sem manter transação aberta durante a chamada externa. */
export async function dispatchStored(
  tenantId: string,
  messageId: string,
): Promise<UniversalOutboundResult | null> {
  const token = randomUUID();
  const [msg] = await db
    .update(messages)
    .set({
      status: "sending",
      leaseToken: token,
      leaseUntil: new Date(Date.now() + 5 * 60_000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.id, messageId),
        eq(messages.direction, "outbound"),
        eq(messages.status, "pending"),
        sql`NOT EXISTS (SELECT 1 FROM messages earlier
          WHERE earlier.tenant_id = ${tenantId} AND earlier.conversation_id = ${messages.conversationId}
          AND earlier.direction = 'outbound' AND earlier.status IN ('pending', 'sending')
          AND (earlier.sent_at, earlier.id) < (${messages.sentAt}, ${messages.id}))`,
      ),
    )
    .returning();
  if (!msg) return null;
  const owned = and(
    eq(messages.tenantId, tenantId),
    eq(messages.id, msg.id),
    eq(messages.leaseToken, token),
    eq(messages.status, "sending"),
  );
  const finish = async (
    status: string,
    errorMessage: string | null,
    retryable = false,
    externalId?: string,
  ) => {
    const [updated] = await db
      .update(messages)
      .set({
        status,
        errorMessage,
        ...(externalId ? { externalId } : {}),
        ...(externalId && msg.whatsappConnectionId && msg.provider === "baileys" ? { metaDetails: { ...msg.metaDetails, wireStanzaId: baileysStanzaId(externalId) } } : {}),
        retryCount: sql`${messages.retryCount} + 1`,
        nextRetryAt: retryable
          ? new Date(Date.now() + Math.min(30_000 * 2 ** Math.min(msg.retryCount, 6), 30 * 60_000))
          : null,
        leaseToken: null,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(owned)
      .returning();
    if (updated) try {
      SessionManager.getInstance().notifyPublic(tenantId, {
        type: "message_status",
        conversationId: msg.conversationId,
        messageId: msg.id,
        status,
        error: errorMessage,
      });
    } catch { console.error("[Outbound] Status persistido; notificação indisponível."); }
    return updated ? storedResult(updated) : null;
  };
  let dispatched = false;
  try {
    const target = await resolveConversationConnection(tenantId, msg.conversationId);
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, msg.conversationId)));
    if (!conv || conv.queueState === "finalizados")
      return finish("failed", "Conversa finalizada ou indisponível; revise a mensagem.");
    if (msg.metaDetails.operatorId && conv.operatorId !== msg.metaDetails.operatorId)
      return finish("failed", "Responsável pelo atendimento mudou; revise o envio pendente.");
    if (target.provider !== msg.provider || target.connectionId !== msg.whatsappConnectionId)
      return finish("failed", "Canal alterado; envio original preservado para revisão.");
    const approvedAt = msg.metaDetails.approvedReplayAt
      ? new Date(String(msg.metaDetails.approvedReplayAt)).getTime()
      : msg.sentAt.getTime();
    if (Date.now() - approvedAt > 24 * 60 * 60_000)
      return finish(
        "failed",
        "Envio pendente há mais de 24 horas; revise o contexto antes de reenviar.",
      );
    if (target.status === "switching")
      return finish("pending", "Canal em transição; aguardando.", true);
    if (msg.senderType === "bot" && msg.metaDetails.industrialDelivery) {
      const { validateIndustrialDelivery } = await import("../valentina/industrial-delivery-context");
      const validation = await validateIndustrialDelivery(msg);
      if (validation.decision !== "send") return finish(
        validation.decision === "defer" ? "pending" : "failed", validation.reason, validation.decision === "defer",
      );
    }
    const [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, conv.contactId)));
    if (!contact) return finish("failed", "Contato indisponível.");
    if (msg.whatsappConnectionId && typeof msg.metaDetails.recipientPhone === "string" && msg.metaDetails.recipientPhone && msg.metaDetails.recipientPhone.replace(/\D/g, "") !== (contact.phone || "").replace(/\D/g, "")) {
      return finish("failed", "O telefone do contato mudou. Confira o destinatário e crie um novo envio.");
    }
    let payload;
    try {
      payload = restoreOutbound(msg, contact.phone || "", contact.whatsappUserId || undefined);
      payload.whatsappConnectionId = target.connectionId;
    } catch {
      return finish(
        "failed",
        "Envio antigo sem dados completos; revise o conteúdo antes de reenviar.",
      );
    }
    dispatched = true;
    const result =
      msg.provider === "meta"
        ? await metaAdapter.send(tenantId, payload)
        : await baileysAdapter.send(tenantId, payload);
    const outcome = await finish(
      result.status === "accepted"
        ? "accepted"
        : result.status === "unknown"
          ? "unknown"
          : result.retryable
            ? "pending"
            : "failed",
      result.status === "accepted" ? null : result.error || "Falha no envio.",
      result.retryable,
      result.externalId,
    );
    if (result.status === "accepted") {
      // Efeitos auxiliares não podem converter um envio confirmado em falha.
      try {
        if (msg.provider === "meta" && result.externalId) {
          await replayPendingMetaStatuses(tenantId, result.externalId);
          resetMetaTypingThrottle(tenantId, conv.id);
        }
        await db
          .update(conversations)
          .set({ lastMessageTime: new Date(), updatedAt: new Date() })
          .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conv.id)));
        if (payload.operatorId)
          await recordCommercialFirstResponse(tenantId, conv.id, payload.operatorId, msg.id);
      } catch {
        console.error("[Outbound] Envio confirmado; efeitos auxiliares precisam de reconciliação.");
      }
    }
    return outcome;
  } catch (error) {
    return finish(
      dispatched ? "unknown" : "pending",
      dispatched
        ? "Provedor pode ter aceitado; verifique antes de reenviar."
        : "Dependência indisponível; envio preservado.",
      !dispatched,
    );
  }
}
