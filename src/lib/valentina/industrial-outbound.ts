import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  conversations,
  lcChats,
  lcMessages,
  lcVisitors,
  mediaFiles,
  messages,
  tenants,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { siteGateway } from "../livechat/site-gateway";
import { visitorIdFromSiteConversation } from "../livechat/site-channel-policy";
import { SessionManager } from "../baileys/session-manager";
import { dispatchStored, storedResult } from "../whatsapp/dispatch";
import { outboundEnvelope } from "../whatsapp/envelope";
import {
  readIndustrialDeliveryContext,
  validateIndustrialDelivery,
  type IndustrialDeliveryContext,
  type IndustrialDeliveryIdentity,
} from "./industrial-delivery-context";

export type IndustrialBotItem = {
  text: string;
  quotedMessageId?: string;
  image?: { buffer: Buffer; mimeType: string; fileName: string; publicUrl?: string };
};
type BotBatch = {
  tenantId: string;
  conversationId: string;
  items: IndustrialBotItem[];
  scope: string;
  expectedOperatorId?: string | null;
  context?: IndustrialDeliveryContext;
  idempotencyMessageId?: string;
  scheduleOnly?: boolean;
  signal?: AbortSignal;
  beforeSend?: (text: string) => Promise<void>;
};
const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const confirmed = (status: string) => ["sent", "accepted", "delivered", "read"].includes(status);
function notify(
  tenantId: string,
  event: Parameters<ReturnType<typeof SessionManager.getInstance>["notifyPublic"]>[1],
) {
  try {
    SessionManager.getInstance().notifyPublic(tenantId, event);
  } catch {
    console.error("[IndustrialOutbound] Histórico preservado; notificação indisponível.");
  }
}

/** Persist the entire fragment group (and image bytes) before any provider/socket call. */
async function prepareBatch(input: BotBatch) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.tenantId}), hashtext(${input.conversationId}))`,
    );
    await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(eq(conversations.tenantId, input.tenantId), eq(conversations.id, input.conversationId)),
      )
      .for("update");
    if (input.idempotencyMessageId) {
      const previous = await tx
        .select()
        .from(messages)
        .where(
          and(eq(messages.tenantId, input.tenantId), eq(messages.id, input.idempotencyMessageId)),
        )
        .limit(1);
      if (previous.length) {
        if (previous[0].conversationId !== input.conversationId || previous[0].senderType !== "bot")
          throw Error("Identidade de resposta já utilizada.");
        return previous;
      }
    }
    const context = await readIndustrialDeliveryContext(
      tx,
      input.tenantId,
      input.conversationId,
      input.expectedOperatorId || null,
    );
    if (
      !context ||
      (input.context &&
        (context.flow.id !== input.context.flowId ||
          context.flow.startedAt.toISOString() !== input.context.cycle ||
          (input.context.triggerIds && !input.context.triggerIds.includes(context.trigger.id)) ||
          (input.context.triggerId && input.context.triggerId !== context.trigger.id)))
    )
      return [];
    const batchId = hash([
      input.tenantId,
      input.conversationId,
      context.flow.id,
      context.flow.startedAt.toISOString(),
      context.trigger.id,
      input.scope,
      input.idempotencyMessageId || null,
    ]);
    const previous = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, input.tenantId),
          eq(messages.conversationId, input.conversationId),
          sql`${messages.metaDetails}->'industrialDelivery'->>'batchId' = ${batchId}`,
        ),
      )
      .orderBy(asc(messages.sentAt), asc(messages.id));
    if (previous.length) return previous; // Never regenerate/extend a group after partial delivery.
    const now = new Date();
    const rows: (typeof messages.$inferInsert)[] = [];
    for (const [sequence, item] of input.items.entries()) {
      if (context.provider === "livechat" && item.image && !item.image.publicUrl)
        throw Error("Imagem do site sem URL pública do catálogo.");
      const id = input.idempotencyMessageId || `bot-durable-${hash([batchId, sequence])}`;
      const mediaId = item.image ? `${id}-media` : null;
      if (item.image)
        await tx.insert(mediaFiles).values({
          id: mediaId!,
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          fileName: item.image.fileName,
          mimeType: item.image.mimeType,
          fileSize: item.image.buffer.length,
          base64Data: item.image.buffer.toString("base64"),
          createdAt: now,
        });
      let quote: typeof messages.$inferSelect | undefined;
      if (item.quotedMessageId) {
        [quote] = await tx
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, input.tenantId),
              eq(messages.conversationId, input.conversationId),
              eq(messages.id, item.quotedMessageId),
            ),
          )
          .limit(1);
        if (!quote) throw Error("Citação não pertence ao atendimento.");
      }
      const identity: IndustrialDeliveryIdentity = {
        version: 1,
        flowId: context.flow.id,
        cycle: context.flow.startedAt.toISOString(),
        triggerId: context.trigger.id,
        outcome: context.flow.outcome,
        operatorId: input.expectedOperatorId || null,
        batchId,
        sequence,
        scheduleOnly: input.scheduleOnly === true,
        queueState: context.conversation.queueState,
        contactId: context.contact.id,
      };
      rows.push({
        id,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        senderType: "bot",
        senderName: `${getAiPersona(input.tenantId).name} (SDR)`,
        content: mediaId
          ? `[MEDIA:image]${mediaId}${item.text ? `\n${item.text}` : ""}`
          : item.text,
        direction: "outbound",
        isInternalNote: false,
        provider: context.provider,
        whatsappConnectionId: null,
        status: "pending",
        idempotencyKey: id,
        retryCount: 0,
        nextRetryAt: now,
        quotedMessageId: item.quotedMessageId || null,
        quotedMessageSender: quote?.senderName || null,
        quotedMessageContent: quote?.content || null,
        metaDetails: {
          ...outboundEnvelope({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            recipientPhone: context.contact.phone || "",
            recipientUserId: context.contact.whatsappUserId || undefined,
            text: item.text,
            mediaUrl: mediaId ? `/api/baileys/media?messageId=${mediaId}` : undefined,
            mediaType: mediaId ? "image" : undefined,
            fileName: item.image?.fileName,
            quotedMessageId: item.quotedMessageId,
          }),
          industrialDelivery: identity,
          sitePublicUrl: item.image?.publicUrl || null,
        },
        sentAt: new Date(now.getTime() + sequence),
        updatedAt: now,
      });
    }
    return rows.length ? tx.insert(messages).values(rows).returning() : [];
  });
}

async function dispatchSiteBot(message: typeof messages.$inferSelect) {
  const validation = await validateIndustrialDelivery(message);
  if (validation.decision !== "send") {
    const [updated] = await db
      .update(messages)
      .set({
        status: validation.decision === "defer" ? "pending" : "failed",
        errorMessage: validation.reason,
        nextRetryAt: validation.decision === "defer" ? new Date(Date.now() + 60_000) : null,
        retryCount: sql`${messages.retryCount} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(messages.tenantId, message.tenantId),
          eq(messages.id, message.id),
          eq(messages.status, "pending"),
        ),
      )
      .returning();
    return updated ? storedResult(updated) : null;
  }
  const saved = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.tenantId, message.tenantId), eq(messages.id, message.id)))
      .for("update")
      .limit(1);
    if (!current || current.status !== "pending") return null;
    const identity = current.metaDetails.industrialDelivery as IndustrialDeliveryIdentity;
    const context = await readIndustrialDeliveryContext(
      tx,
      current.tenantId,
      current.conversationId,
      identity.operatorId,
    );
    if (
      !context ||
      context.flow.id !== identity.flowId ||
      context.flow.startedAt.toISOString() !== identity.cycle ||
      context.flow.outcome !== identity.outcome ||
      context.trigger.id !== identity.triggerId ||
      context.provider !== "livechat" ||
      context.conversation.queueState !== identity.queueState ||
      context.contact.id !== identity.contactId
    ) {
      await tx
        .update(messages)
        .set({
          status: "failed",
          errorMessage: "Contexto mudou antes do commit do site.",
          updatedAt: new Date(),
        })
        .where(and(eq(messages.tenantId, current.tenantId), eq(messages.id, current.id)));
      return null;
    }
    const visitorId = visitorIdFromSiteConversation(current.conversationId);
    const [visitor] = await tx
      .select({ id: lcVisitors.id })
      .from(lcVisitors)
      .where(and(eq(lcVisitors.tenantId, current.tenantId), eq(lcVisitors.id, visitorId || "")))
      .limit(1);
    if (!visitor) throw Error("Visitante não encontrado para esta empresa.");
    let [chat] = await tx
      .select()
      .from(lcChats)
      .where(
        and(
          eq(lcChats.tenantId, current.tenantId),
          eq(lcChats.visitorId, visitor.id),
          inArray(lcChats.status, ["active", "operator_took_over", "bridge_sent"]),
        ),
      )
      .orderBy(desc(lcChats.startedAt))
      .limit(1);
    if (!chat)
      [chat] = await tx
        .insert(lcChats)
        .values({
          id: `${current.id}-chat`,
          tenantId: current.tenantId,
          visitorId: visitor.id,
          status: "active",
        })
        .returning();
    const imageUrl =
      typeof current.metaDetails.sitePublicUrl === "string"
        ? current.metaDetails.sitePublicUrl
        : null;
    const widgetContent = imageUrl
      ? `[Anexo_Cliente: ${imageUrl}]`
      : String(current.metaDetails.text || current.content);
    const [widget] = await tx
      .insert(lcMessages)
      .values({
        id: `${current.id}-widget`,
        tenantId: current.tenantId,
        chatId: chat.id,
        sender: "ai",
        content: widgetContent,
        contentType: imageUrl ? "image" : "text",
        mediaUrl: imageUrl,
        sentAt: current.sentAt,
      })
      .returning();
    const [canonical] = await tx
      .update(messages)
      .set({ status: "accepted", externalId: widget.id, nextRetryAt: null, updatedAt: new Date() })
      .where(and(eq(messages.tenantId, current.tenantId), eq(messages.id, current.id)))
      .returning();
    await tx
      .update(conversations)
      .set({
        lastMessageText: current.content,
        lastMessageTime: current.sentAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversations.tenantId, current.tenantId),
          eq(conversations.id, current.conversationId),
        ),
      );
    return { canonical, widget, visitorId: visitor.id };
  });
  if (!saved) {
    const [latest] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.tenantId, message.tenantId), eq(messages.id, message.id)))
      .limit(1);
    return latest ? storedResult(latest) : null;
  }
  const imageUrl = saved.canonical.metaDetails.sitePublicUrl;
  siteGateway.push(
    message.tenantId,
    saved.visitorId,
    imageUrl
      ? {
          type: "send_image",
          chatId: saved.widget.chatId,
          messageId: saved.widget.id,
          sender: "ai",
          imageUrl,
        }
      : {
          type: "message",
          chatId: saved.widget.chatId,
          messageId: saved.widget.id,
          sender: "ai",
          senderName: saved.canonical.senderName,
          content: saved.widget.content,
        },
  );
  siteGateway.push(message.tenantId, saved.visitorId, {
    type: "CHAT_REPLY",
    chatId: saved.widget.chatId,
    messageId: saved.widget.id,
    sender: "ai",
    senderName: saved.canonical.senderName,
    content: saved.widget.content,
    timestamp: saved.canonical.sentAt.toISOString(),
  });
  notify(message.tenantId, {
    type: "message_status",
    conversationId: message.conversationId,
    messageId: message.id,
    status: "accepted",
  });
  return storedResult(saved.canonical);
}

export async function dispatchIndustrialMessage(tenantId: string, id: string) {
  const [message] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.id, id)))
    .limit(1);
  if (!message || message.senderType !== "bot" || !message.metaDetails.industrialDelivery)
    return null;
  if (
    message.status !== "pending" ||
    (message.nextRetryAt && message.nextRetryAt.getTime() > Date.now())
  )
    return storedResult(message);
  return message.provider === "livechat" ? dispatchSiteBot(message) : dispatchStored(tenantId, id);
}

export async function sendIndustrialBotBatch(input: BotBatch) {
  if (input.signal?.aborted || (input.idempotencyMessageId && input.items.length !== 1))
    return { sent: false, reason: "invalid_batch" };
  const rows = await prepareBatch({
    ...input,
    items: input.items.filter((item) => item.text.trim() || item.image),
  });
  if (!rows.length) return { sent: false, reason: "context_changed" };
  for (const row of rows) {
    notify(input.tenantId, {
      type: "message",
      message: {
        ...row,
        queue: input.expectedOperatorId ? "meus" : "automacao",
        operatorId: input.expectedOperatorId || null,
      },
    });
    if (confirmed(row.status)) continue;
    if (row.status === "pending") await input.beforeSend?.(String(row.metaDetails.text || ""));
    if (input.signal?.aborted) {
      await db
        .update(messages)
        .set({
          status: "failed",
          errorMessage: "Resposta interrompida; contexto requer nova avaliação.",
          nextRetryAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(messages.tenantId, input.tenantId),
            inArray(
              messages.id,
              rows.map((item) => item.id),
            ),
            eq(messages.status, "pending"),
          ),
        );
      return { sent: false, reason: "interrupted", messageId: rows[0].id };
    }
    const result = await dispatchIndustrialMessage(input.tenantId, row.id);
    if (!result || !confirmed(result.status))
      return { sent: false, reason: result?.status || "pending", messageId: rows[0].id };
  }
  return { sent: true, messageId: rows[0].id };
}

/** Site and WhatsApp share stable bot IDs; unknown results never enter automatic retry. */
export async function recoverIndustrialBotOutbounds() {
  const companies = await db.select({ id: tenants.id }).from(tenants);
  for (const { id: tenantId } of companies) {
    if (getAiPersona(tenantId).triagePolicy !== "industrial") continue;
    await db
      .update(messages)
      .set({
        status: "unknown",
        leaseToken: null,
        leaseUntil: null,
        nextRetryAt: null,
        errorMessage: "Despacho automático interrompido sem confirmação; revise antes de reenviar.",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.senderType, "bot"),
          eq(messages.status, "sending"),
          sql`${messages.metaDetails}->'industrialDelivery' IS NOT NULL`,
          lt(messages.updatedAt, new Date(Date.now() - 60_000)),
          or(isNull(messages.leaseUntil), lte(messages.leaseUntil, new Date())),
        ),
      );
    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.senderType, "bot"),
          eq(messages.status, "pending"),
          sql`${messages.metaDetails}->'industrialDelivery' IS NOT NULL`,
          or(isNull(messages.nextRetryAt), lte(messages.nextRetryAt, new Date())),
        ),
      )
      .orderBy(asc(messages.sentAt), asc(messages.id))
      .limit(40);
    for (const row of rows) await dispatchIndustrialMessage(tenantId, row.id);
  }
}
