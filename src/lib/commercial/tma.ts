import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  commercialConsultantProfiles,
  commercialTransferResponseEvents,
  conversations,
  messages,
} from "../../db/schema";

/** Atribuição confirmada pelo chat. Falha de métrica nunca deve bloquear a fila. */
export async function recordCommercialTransfer(
  tenantId: string,
  conversationId: string,
  operatorId: string | null,
  expectedVersion: number,
  transferredAt: Date,
) {
  await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({
        id: conversations.id,
        queueState: conversations.queueState,
        operatorId: conversations.operatorId,
        version: conversations.version,
      })
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .for("update")
      .limit(1);
    if (!conversation || conversation.version !== expectedVersion) return;
    await tx
      .update(commercialTransferResponseEvents)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(commercialTransferResponseEvents.tenantId, tenantId),
          eq(commercialTransferResponseEvents.conversationId, conversationId),
          eq(commercialTransferResponseEvents.status, "pending"),
        ),
      );
    if (conversation.queueState !== "meus" || conversation.operatorId !== operatorId || !operatorId)
      return;
    const [profile] = await tx
      .select({ id: commercialConsultantProfiles.id })
      .from(commercialConsultantProfiles)
      .where(
        and(
          eq(commercialConsultantProfiles.tenantId, tenantId),
          eq(commercialConsultantProfiles.operatorId, operatorId),
        ),
      )
      .limit(1);
    if (!profile) return;
    await tx.insert(commercialTransferResponseEvents).values({
      id: crypto.randomUUID(),
      tenantId,
      conversationId,
      operatorId,
      transferredAt,
    });
  });
}

/** Registra somente a primeira resposta externa do consultor após a atribuição. */
export async function recordCommercialFirstResponse(
  tenantId: string,
  conversationId: string,
  operatorId: string,
  messageId: string,
) {
  const [pending] = await db
    .select({ id: commercialTransferResponseEvents.id })
    .from(commercialTransferResponseEvents)
    .where(
      and(
        eq(commercialTransferResponseEvents.tenantId, tenantId),
        eq(commercialTransferResponseEvents.conversationId, conversationId),
        eq(commercialTransferResponseEvents.operatorId, operatorId),
        eq(commercialTransferResponseEvents.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) return;
  await db.transaction(async (tx) => {
    const [message] = await tx
      .select({ id: messages.id, sentAt: messages.sentAt })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.id, messageId),
          eq(messages.conversationId, conversationId),
          eq(messages.senderType, "agent"),
          eq(messages.isInternalNote, false),
          eq(messages.status, "accepted"),
        ),
      )
      .limit(1);
    if (!message) return;

    const [event] = await tx
      .select()
      .from(commercialTransferResponseEvents)
      .where(
        and(
          eq(commercialTransferResponseEvents.tenantId, tenantId),
          eq(commercialTransferResponseEvents.conversationId, conversationId),
          eq(commercialTransferResponseEvents.operatorId, operatorId),
          eq(commercialTransferResponseEvents.status, "pending"),
        ),
      )
      .orderBy(desc(commercialTransferResponseEvents.transferredAt))
      .for("update")
      .limit(1);
    if (!event || message.sentAt < event.transferredAt) return;
    await tx
      .update(commercialTransferResponseEvents)
      .set({
        status: "responded",
        firstResponseMessageId: message.id,
        firstRespondedAt: message.sentAt,
        durationSeconds: Math.max(
          0,
          Math.floor((message.sentAt.getTime() - event.transferredAt.getTime()) / 1000),
        ),
      })
      .where(
        and(
          eq(commercialTransferResponseEvents.tenantId, tenantId),
          eq(commercialTransferResponseEvents.id, event.id),
          eq(commercialTransferResponseEvents.status, "pending"),
        ),
      );
  });
}
