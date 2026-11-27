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
import {
  formatQuotedPreviewForSite,
  resolveSiteQuotedSenderLabel,
} from "../triage/industrial-citations";
import { siteGateway } from "../livechat/site-gateway";
import { buildSiteCatalogMediaUrl, visitorIdFromSiteConversation } from "../livechat/site-channel-policy";
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
/** Janela exclusiva para o despacho ativo concluir os delays humanizados (beforeSend) antes do cron de recovery. */
export const ACTIVE_BATCH_RECOVERY_GRACE_MS = 45_000;
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
          (input.context.triggerIds &&
            input.context.triggerIds.length > 0 &&
            !input.context.triggerIds.includes(context.trigger.id)) ||
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
        nextRetryAt: new Date(now.getTime() + ACTIVE_BATCH_RECOVERY_GRACE_MS),
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
          sitePublicUrl: item.image?.publicUrl
            ? buildSiteCatalogMediaUrl(input.tenantId, item.image.publicUrl)
            : null,
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
    const rawImageUrl =
      typeof current.metaDetails.sitePublicUrl === "string"
        ? current.metaDetails.sitePublicUrl
        : null;
    const imageUrl = rawImageUrl
      ? buildSiteCatalogMediaUrl(current.tenantId, rawImageUrl)
      : null;
    const widgetContent = imageUrl
      ? `[Anexo_Cliente: ${imageUrl}]`
      : String(current.metaDetails.text || current.content);
    let widgetQuotedMessageId: string | null = null;
    let widgetQuotedSender: string | null = null;
    let widgetQuotedContent: string | null = null;
    if (current.quotedMessageId) {
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
            eq(messages.tenantId, current.tenantId),
            eq(messages.conversationId, current.conversationId),
            eq(messages.id, current.quotedMessageId),
          ),
        )
        .limit(1);
      if (quotedRow) {
        widgetQuotedMessageId = quotedRow.externalId || quotedRow.id;
        widgetQuotedSender = resolveSiteQuotedSenderLabel(
          quotedRow,
          getAiPersona(current.tenantId).name,
        );
        widgetQuotedContent = formatQuotedPreviewForSite(
          quotedRow.content,
          quotedRow.mediaInterpretation,
        );
      } else if (current.quotedMessageContent) {
        widgetQuotedMessageId = current.quotedMessageId;
        widgetQuotedSender = current.quotedMessageSender || getAiPersona(current.tenantId).name;
        widgetQuotedContent = formatQuotedPreviewForSite(current.quotedMessageContent);
      }
    }
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
        quotedMessageId: widgetQuotedMessageId,
        quotedMessageSender: widgetQuotedSender,
        quotedMessageContent: widgetQuotedContent,
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
  const rawSavedImageUrl =
    typeof saved.canonical.metaDetails.sitePublicUrl === "string"
      ? saved.canonical.metaDetails.sitePublicUrl
      : null;
  const imageUrl = rawSavedImageUrl
    ? buildSiteCatalogMediaUrl(message.tenantId, rawSavedImageUrl)
    : null;
  const quotePayload = saved.widget.quotedMessageContent
    ? {
        quotedMessageId: saved.widget.quotedMessageId || undefined,
        quotedMessageSender: saved.widget.quotedMessageSender || undefined,
        quotedMessageContent: saved.widget.quotedMessageContent,
      }
    : {};
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
          ...quotePayload,
        }
      : {
          type: "message",
          chatId: saved.widget.chatId,
          messageId: saved.widget.id,
          sender: "ai",
          senderName: saved.canonical.senderName,
          content: saved.widget.content,
          ...quotePayload,
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
    ...quotePayload,
  });
  notify(message.tenantId, {
    type: "message_status",
    conversationId: message.conversationId,
    messageId: message.id,
    status: "accepted",
  });
  // Espelhamento em tempo real da resposta do Fagner no Site para a conversa ativa do WhatsApp (24h).
  // Pula mensagens de despedida pós-encerramento (queueState === "finalizados" / outcome === "transferred"),
  // pois a ponte Site → WhatsApp (pós-triagem ou mid-triage) já espelha essa despedida na ordem cronológica exata.
  try {
    const deliveryMeta = (saved.canonical.metaDetails as Record<string, any> | null)
      ?.industrialDelivery;
    const contactIdFromMeta = deliveryMeta?.contactId;
    const isAlreadyClosedBridgeReply =
      deliveryMeta?.queueState === "finalizados" || deliveryMeta?.outcome === "transferred";
    if (!isAlreadyClosedBridgeReply && typeof contactIdFromMeta === "string" && contactIdFromMeta) {
      const { findActiveWhatsappSessionForSiteContact } = await import(
        "../livechat/site-cross-channel-guard"
      );
      const activeWa = await findActiveWhatsappSessionForSiteContact(db, {
        tenantId: message.tenantId,
        contactId: contactIdFromMeta,
        siteConversationId: message.conversationId,
        siteLatestClientMessageAt: saved.canonical.sentAt,
        now: new Date(),
      });
      if (activeWa.suppressed && activeWa.whatsappConversationId) {
        const { mirrorSiteMessagesToWhatsapp } = await import("../livechat/site-whatsapp-mirror");
        await mirrorSiteMessagesToWhatsapp(db, {
          tenantId: message.tenantId,
          siteConversationId: message.conversationId,
          waConversationId: activeWa.whatsappConversationId,
          sourceMessages: [saved.canonical],
          bumpUnreadForHuman: false,
          closeLivechatRecord: false,
          notifyRealtime: true,
        });
      }
    }
  } catch (mirrorErr: any) {
    console.warn(
      `[IndustrialOutbound] Aviso ao espelhar resposta do site para WhatsApp (${message.conversationId}):`,
      mirrorErr?.message || mirrorErr,
    );
  }
  return storedResult(saved.canonical);
}

export async function dispatchIndustrialMessage(
  tenantId: string,
  id: string,
  options?: { ignoreInitialGrace?: boolean },
) {
  const [message] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.id, id)))
    .limit(1);
  if (!message || message.senderType !== "bot" || !message.metaDetails.industrialDelivery)
    return null;
  const deferBlocked =
    Boolean(message.nextRetryAt && message.nextRetryAt.getTime() > Date.now()) &&
    !(options?.ignoreInitialGrace === true && (message.retryCount ?? 0) === 0);
  if (message.status !== "pending" || deferBlocked)
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
  let releaseInitialGraceOnExit = true;
  try {
    for (const row of rows) {
      notify(input.tenantId, {
        type: "message",
        message: {
          ...row,
          queue: String(
            (row.metaDetails as any)?.industrialDelivery?.queueState ||
              (input.expectedOperatorId ? "meus" : "automacao"),
          ),
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
        releaseInitialGraceOnExit = false;
        return { sent: false, reason: "interrupted", messageId: rows[0].id };
      }
      const result = await dispatchIndustrialMessage(input.tenantId, row.id, {
        ignoreInitialGrace: true,
      });
      if (!result || !confirmed(result.status)) {
        // Se foi adiado (pending) ou outro worker detém o envio ativo (sending), preserva a janela de grace.
        if (result?.status === "pending" || result?.status === "sending") {
          releaseInitialGraceOnExit = false;
        }
        return { sent: false, reason: result?.status || "pending", messageId: rows[0].id };
      }
    }
    releaseInitialGraceOnExit = false;
    return { sent: true, messageId: rows[0].id };
  } finally {
    if (releaseInitialGraceOnExit) {
      // Se o despacho ativo falhou/ficou unknown ou lançou exceção (ex.: crash em beforeSend),
      // libera imediatamente a janela de grace nos fragmentos ainda `pending` de 1ª tentativa
      // para o worker de recovery cancelar a continuação (em caso de unknown/failed) ou retomar.
      try {
        await db
          .update(messages)
          .set({ nextRetryAt: new Date() })
          .where(
            and(
              eq(messages.tenantId, input.tenantId),
              inArray(
                messages.id,
                rows.map((item) => item.id),
              ),
              eq(messages.status, "pending"),
              eq(messages.retryCount, 0),
            ),
          );
      } catch {
        // Melhor esforço: mesmo sem liberar agora, o grace de ACTIVE_BATCH_RECOVERY_GRACE_MS expira sozinho.
      }
    }
  }
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
