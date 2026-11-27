import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { db } from "../../db";
import { conversations, lcChats, lcMessages, lcVisitors, messages } from "../../db/schema";
import { SITE_PROVIDER, visitorIdFromSiteConversation } from "./site-channel-policy";
import { getAiPersona } from "../ai-persona";
import {
  formatQuotedPreviewForSite,
  resolveSiteQuotedSenderLabel,
} from "../triage/industrial-citations";

/** Both histories commit together. An accepted legacy row is repaired before retry succeeds. */
export async function persistSiteOperatorMessage(
  database: Pick<typeof db, "transaction">,
  input: {
    tenantId: string;
    conversationId: string;
    operatorId: string;
    operatorName: string;
    text: string;
    idempotencyKey?: string;
    quotedMessageId?: string;
  },
) {
  const { tenantId, conversationId, operatorId, idempotencyKey } = input;
  const visitorId = visitorIdFromSiteConversation(conversationId);
  if (!visitorId) throw new Error("Conversa não pertence ao canal do site.");
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${idempotencyKey || conversationId}))`,
    );
    const [conv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .for("update")
      .limit(1);
    if (!conv || conv.queueState !== "meus" || conv.operatorId !== operatorId)
      throw new Error("O responsável pelo atendimento mudou. Atualize a conversa.");
    const [visitor] = await tx
      .select({ id: lcVisitors.id })
      .from(lcVisitors)
      .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.id, visitorId)))
      .limit(1);
    if (!visitor) throw new Error("Visitante não encontrado para esta empresa.");
    const [previous] = idempotencyKey
      ? await tx
          .select()
          .from(messages)
          .where(and(eq(messages.tenantId, tenantId), eq(messages.idempotencyKey, idempotencyKey)))
          .limit(1)
      : [];
    if (
      previous &&
      (previous.conversationId !== conversationId ||
        previous.provider !== SITE_PROVIDER ||
        previous.senderType !== "agent")
    )
      throw new Error("Chave já utilizada em outra mensagem.");
    const now = new Date();
    const id = previous?.id || `msg-${randomUUID()}`;
    const content = previous?.content ?? input.text;
    const widgetId = previous?.externalId || `${id}-widget`;
    let canonicalQuotedId: string | null = previous?.quotedMessageId ?? null;
    let canonicalQuotedSender: string | null = previous?.quotedMessageSender ?? null;
    let canonicalQuotedContent: string | null = previous?.quotedMessageContent ?? null;
    let widgetQuotedId: string | null = null;
    let widgetQuotedSender: string | null = null;
    let widgetQuotedContent: string | null = null;
    const requestedQuoteId = input.quotedMessageId?.trim() || canonicalQuotedId;
    if (requestedQuoteId) {
      const [quotedRow] = await tx
        .select({
          id: messages.id,
          externalId: messages.externalId,
          senderType: messages.senderType,
          senderName: messages.senderName,
          content: messages.content,
          mediaInterpretation: messages.mediaInterpretation,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            eq(messages.conversationId, conversationId),
            eq(messages.id, requestedQuoteId),
          ),
        )
        .limit(1);
      if (quotedRow) {
        canonicalQuotedId = quotedRow.id;
        canonicalQuotedSender =
          quotedRow.senderName || (quotedRow.senderType === "client" ? "Cliente" : "Operador");
        canonicalQuotedContent = quotedRow.content || null;
        widgetQuotedId = quotedRow.externalId || quotedRow.id;
        widgetQuotedSender = resolveSiteQuotedSenderLabel(quotedRow, getAiPersona(tenantId).name);
        widgetQuotedContent = formatQuotedPreviewForSite(
          quotedRow.content,
          quotedRow.mediaInterpretation,
        );
      }
    }
    let [widget] = await tx
      .select()
      .from(lcMessages)
      .where(and(eq(lcMessages.tenantId, tenantId), eq(lcMessages.id, widgetId)))
      .limit(1);
    if (widget) {
      const [chat] = await tx
        .select({ id: lcChats.id })
        .from(lcChats)
        .where(
          and(
            eq(lcChats.tenantId, tenantId),
            eq(lcChats.id, widget.chatId),
            eq(lcChats.visitorId, visitorId),
          ),
        )
        .limit(1);
      if (!chat || widget.content !== content || widget.sender !== "operator")
        throw new Error("Histórico do envio inconsistente.");
    } else {
      let [chat] = await tx
        .select()
        .from(lcChats)
        .where(
          and(
            eq(lcChats.tenantId, tenantId),
            eq(lcChats.visitorId, visitorId),
            inArray(lcChats.status, ["active", "operator_took_over", "bridge_sent"]),
          ),
        )
        .orderBy(desc(lcChats.startedAt))
        .limit(1);
      if (!chat)
        [chat] = await tx
          .insert(lcChats)
          .values({
            id: randomUUID(),
            tenantId,
            visitorId,
            status: "operator_took_over",
            operatorId,
          })
          .returning();
      [widget] = await tx
        .insert(lcMessages)
        .values({
          id: widgetId,
          tenantId,
          chatId: chat.id,
          sender: "operator",
          content,
          contentType: "text",
          quotedMessageId: widgetQuotedId,
          quotedMessageSender: widgetQuotedSender,
          quotedMessageContent: widgetQuotedContent,
          sentAt: previous?.sentAt || now,
        })
        .returning();
    }
    const values = {
      externalId: widget.id,
      status: previous && ["delivered", "read"].includes(previous.status) ? previous.status : "accepted",
      updatedAt: now,
    };
    let canonical = previous;
    if (canonical) {
      [canonical] = await tx
        .update(messages)
        .set(values)
        .where(and(eq(messages.tenantId, tenantId), eq(messages.id, canonical.id)))
        .returning();
    } else {
      [canonical] = await tx
        .insert(messages)
        .values({
          id,
          tenantId,
          conversationId,
          senderType: "agent",
          senderName: input.operatorName,
          content,
          isInternalNote: false,
          direction: "outbound",
          provider: SITE_PROVIDER,
          idempotencyKey: idempotencyKey || null,
          quotedMessageId: canonicalQuotedId,
          quotedMessageSender: canonicalQuotedSender,
          quotedMessageContent: canonicalQuotedContent,
          sentAt: now,
          ...values,
        })
        .returning();
    }
    // Replaying an older message must not overwrite the latest conversation preview.
    if (!previous)
      await tx
        .update(conversations)
        .set({
          lastMessageText: content,
          lastMessageTime: now,
          updatedAt: now,
          unreadCount: 0,
          supervisorAttentionAt: null,
          supervisorAttentionOperatorId: null,
          supervisorAttentionMessage: null,
          supervisorAttentionBy: null,
          supervisorAttentionMessageId: null,
        })
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)));
    return { message: canonical!, widgetMessage: widget, visitorId };
  });
}
