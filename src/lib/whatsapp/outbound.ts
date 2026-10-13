import { dispatchStored, storedResult } from "./dispatch";
import { outboundEnvelope } from "./envelope";
import { db } from "../../db";
import { messages, conversations, channelConfigs } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { UniversalOutboundMessage, UniversalOutboundResult, WhatsAppProviderType } from "./types";

import { getMetaServiceWindow } from "./meta-policy";

export class OutboundQueue {
  private static instance: OutboundQueue;

  private constructor() {}

  static getInstance(): OutboundQueue {
    if (!OutboundQueue.instance) {
      OutboundQueue.instance = new OutboundQueue();
    }
    return OutboundQueue.instance;
  }

  /**
   * Envia uma mensagem com controle de idempotência, persistência durável no PostgreSQL
   * e despacho para o provedor ativo (Baileys ou Meta) do respectivo tenant.
   */
  async enqueueAndSend(payload: UniversalOutboundMessage): Promise<UniversalOutboundResult> {
    const { tenantId, conversationId, idempotencyKey, isInternalNote } = payload;

    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.tenantId, tenantId), eq(messages.idempotencyKey, idempotencyKey)));
      if (existing) {
        if (existing.conversationId !== conversationId)
          throw new Error("Chave já utilizada em outra conversa.");
        return storedResult(existing);
      }
    }

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    function isIdempotencyConflict(err: any): boolean {
      const code = err?.code || err?.cause?.code;
      const constraint = err?.constraint || err?.cause?.constraint_name || err?.cause?.constraint;
      const msg = `${err?.message || ""} ${err?.cause?.message || ""} ${err?.detail || ""} ${err?.cause?.detail || ""}`;
      return (
        code === "23505" ||
        constraint === "idx_messages_tenant_idempotency_uniq" ||
        msg.includes("idx_messages_tenant_idempotency_uniq") ||
        msg.includes("restrição de unicidade") ||
        msg.includes("unique constraint")
      );
    }

    // 2. Nota Interna — não é despachada para o WhatsApp externo
    if (isInternalNote) {
      try {
        await db.insert(messages).values({
          id: messageId,
          tenantId,
          conversationId,
          senderType: "agent",
          senderName: payload.senderName || "Operador",
          content: payload.text || "",
          isInternalNote: true,
          direction: "outbound",
          status: "accepted",
          idempotencyKey: idempotencyKey || null,
          sentAt: now,
          updatedAt: now,
        });
      } catch (insertErr: any) {
        if (idempotencyKey && isIdempotencyConflict(insertErr)) {
          const [existing] = await db
            .select()
            .from(messages)
            .where(
              and(eq(messages.tenantId, tenantId), eq(messages.idempotencyKey, idempotencyKey)),
            );
          if (existing) {
            if (existing.conversationId !== conversationId)
              throw new Error("Chave já utilizada em outra conversa.");
            return storedResult(existing);
          }
        }
        throw insertErr;
      }

      await db
        .update(conversations)
        .set({ lastMessageTime: now, updatedAt: now, unreadCount: 0 })
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));

      return {
        success: true,
        messageId,
        status: "accepted",
      };
    }

    // 3. Determinar o provedor ativo configurado no tenant
    const [channelConfig] = await db
      .select()
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, tenantId));

    const activeProvider: WhatsAppProviderType =
      (channelConfig?.activeProvider as WhatsAppProviderType) || "baileys";

    if (activeProvider === "meta" && !payload.templateName) {
      const window = await getMetaServiceWindow(tenantId, conversationId);
      if (!window.open) {
        return {
          success: false,
          messageId: "",
          status: "failed",
          code: "META_TEMPLATE_REQUIRED",
          error:
            "A janela de 24 horas terminou. Envie um template aprovado pela Meta para retomar a conversa.",
        };
      }
    }

    const localMediaId = payload.mediaUrl?.match(/messageId=([^&]+)/)?.[1];
    const mediaContent =
      payload.mediaType && localMediaId
        ? `[MEDIA:${payload.mediaType}]${localMediaId}${payload.fileName ? `:${payload.fileName}` : ""}${payload.text ? `\n${payload.text}` : ""}`
        : payload.mediaType
          ? `[Mídia: ${payload.fileName || payload.mediaType}]`
          : "";
    const content = payload.templateName
      ? payload.text?.trim() || `[Template Meta: ${payload.templateName}]`
      : mediaContent || payload.text || "";

    // 4. Preservar a intenção pendente antes de reservar o despacho.
    try {
      await db.insert(messages).values({
        id: messageId,
        tenantId,
        conversationId,
        senderType: "agent",
        senderName: payload.senderName || "Operador",
        content,
        quotedMessageId: payload.quotedMessageId || null,
        isInternalNote: false,
        direction: "outbound",
        provider: activeProvider,
        status: "pending",
        idempotencyKey: idempotencyKey || null,
        retryCount: 0,
        metaDetails: outboundEnvelope(payload),
        nextRetryAt: now,
        sentAt: now,
        updatedAt: now,
      });
    } catch (insertErr: any) {
      if (idempotencyKey && isIdempotencyConflict(insertErr)) {
        console.log(
          `[OutboundQueue] Idempotência atômica interceptada (23505) para key '${idempotencyKey}'. Retornando mensagem existente.`,
        );
        const [existing] = await db
          .select()
          .from(messages)
          .where(and(eq(messages.tenantId, tenantId), eq(messages.idempotencyKey, idempotencyKey)));
        if (existing) {
          if (existing.conversationId !== conversationId)
            throw new Error("Chave já utilizada em outra conversa.");
          return storedResult(existing);
        }
      }
      throw insertErr;
    }

    return (
      (await dispatchStored(tenantId, messageId)) || {
        success: true,
        messageId,
        status: "pending",
      }
    );
  }
}

export const outboundQueue = OutboundQueue.getInstance();
