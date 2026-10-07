import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { commercialTransferResponseEvents, messages } from "../../db/schema";

/** Registra somente a primeira resposta externa do consultor após a atribuição. */
export async function recordCommercialFirstResponse(tenantId: string, conversationId: string, operatorId: string, messageId: string) {
  await db.transaction(async (tx) => {
    const [message] = await tx.select({ id: messages.id, sentAt: messages.sentAt })
      .from(messages)
      .where(and(
        eq(messages.tenantId, tenantId), eq(messages.id, messageId),
        eq(messages.conversationId, conversationId), eq(messages.senderType, "agent"),
        eq(messages.isInternalNote, false), eq(messages.status, "accepted"),
      )).limit(1);
    if (!message) return;

    const [event] = await tx.select().from(commercialTransferResponseEvents)
      .where(and(
        eq(commercialTransferResponseEvents.tenantId, tenantId),
        eq(commercialTransferResponseEvents.conversationId, conversationId),
        eq(commercialTransferResponseEvents.operatorId, operatorId),
        eq(commercialTransferResponseEvents.status, "pending"),
      ))
      .orderBy(desc(commercialTransferResponseEvents.transferredAt))
      .for("update")
      .limit(1);
    if (!event || message.sentAt < event.transferredAt) return;
    await tx.update(commercialTransferResponseEvents).set({
      status: "responded",
      firstResponseMessageId: message.id,
      firstRespondedAt: message.sentAt,
      durationSeconds: Math.max(0, Math.floor((message.sentAt.getTime() - event.transferredAt.getTime()) / 1000)),
    }).where(and(
      eq(commercialTransferResponseEvents.tenantId, tenantId),
      eq(commercialTransferResponseEvents.id, event.id),
      eq(commercialTransferResponseEvents.status, "pending"),
    ));
  });
}
