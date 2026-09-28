import { db } from "../../db";
import { messages, conversations, channelConfigs } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import {
  UniversalOutboundMessage,
  UniversalOutboundResult,
  WhatsAppProviderType,
} from "./types";
import { metaAdapter } from "./adapters/meta";
import { baileysAdapter } from "./adapters/baileys";

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

    // 1. Verificação de Idempotência por clientMessageId
    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            eq(messages.idempotencyKey, idempotencyKey)
          )
        );

      if (existing) {
        if (existing.status === "accepted" || existing.status === "sending") {
          console.log(`[OutboundQueue] Idempotência acionada para key '${idempotencyKey}'. Mensagem id '${existing.id}' já processada.`);
          return {
            success: existing.status === "accepted",
            messageId: existing.id,
            externalId: existing.externalId || undefined,
            status: (existing.status as any) || "accepted",
          };
        }
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
          senderName: "Operador",
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
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.idempotencyKey, idempotencyKey)
              )
            );
          if (existing) {
            return {
              success: true,
              messageId: existing.id,
              status: "accepted",
            };
          }
        }
        throw insertErr;
      }

      await db
        .update(conversations)
        .set({ lastMessageTime: now, updatedAt: now })
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

    // 4. Inserção durável no PostgreSQL em status 'sending' (com proteção atômica contra race conditions)
    try {
      await db.insert(messages).values({
        id: messageId,
        tenantId,
        conversationId,
        senderType: "agent",
        senderName: "Operador",
        content: payload.text || "",
        quotedMessageId: payload.quotedMessageId || null,
        isInternalNote: false,
        direction: "outbound",
        provider: activeProvider,
        status: "sending",
        idempotencyKey: idempotencyKey || null,
        retryCount: 0,
        sentAt: now,
        updatedAt: now,
      });
    } catch (insertErr: any) {
      if (idempotencyKey && isIdempotencyConflict(insertErr)) {
        console.log(
          `[OutboundQueue] Idempotência atômica interceptada (23505) para key '${idempotencyKey}'. Retornando mensagem existente.`
        );
        const [existing] = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, tenantId),
              eq(messages.idempotencyKey, idempotencyKey)
            )
          );
        if (existing) {
          return {
            success: existing.status === "accepted" || existing.status === "sending",
            messageId: existing.id,
            externalId: existing.externalId || undefined,
            status: (existing.status as any) || "accepted",
          };
        }
      }
      throw insertErr;
    }

    // 5. Despacho real pelo adaptador correspondente
    try {
      let dispatchResult: { externalId: string; status: any; error?: string };

      if (activeProvider === "meta") {
        dispatchResult = await metaAdapter.send(tenantId, payload);
      } else {
        dispatchResult = await baileysAdapter.send(tenantId, payload);
      }

      // 6. Atualização do resultado no banco
      if (dispatchResult.status === "accepted") {
        await db
          .update(messages)
          .set({
            status: "accepted",
            externalId: dispatchResult.externalId || null,
            updatedAt: new Date(),
          })
          .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId)));

        await db
          .update(conversations)
          .set({ lastMessageTime: new Date(), updatedAt: new Date() })
          .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));

        return {
          success: true,
          messageId,
          externalId: dispatchResult.externalId,
          status: "accepted",
        };
      } else {
        await db
          .update(messages)
          .set({
            status: "failed",
            errorMessage: dispatchResult.error || "Falha no envio pelo provedor",
            retryCount: 1,
            updatedAt: new Date(),
          })
          .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId)));

        return {
          success: false,
          messageId,
          status: "failed",
          error: dispatchResult.error,
        };
      }
    } catch (err: any) {
      console.error(`[OutboundQueue] Exceção crítica ao despachar mensagem ${messageId}:`, err);

      const isUncertain =
        err?.code === "ETIMEDOUT" ||
        err?.code === "ECONNRESET" ||
        err?.code === "UND_ERR_CONNECT_TIMEOUT" ||
        err?.name === "AbortError" ||
        err?.message?.toLowerCase().includes("timeout") ||
        err?.message?.toLowerCase().includes("network");

      const finalStatus = isUncertain ? "uncertain" : "failed";
      const finalMsg = isUncertain
        ? "Confirmação não recebida do provedor (estado incerto). Ação manual de reconciliação disponível."
        : (err.message || "Erro desconhecido durante despacho");

      await db
        .update(messages)
        .set({
          status: finalStatus,
          errorMessage: finalMsg,
          retryCount: 1,
          updatedAt: new Date(),
        })
        .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId)));

      return {
        success: false,
        messageId,
        status: finalStatus as any,
        error: finalMsg,
      };
    }
  }
}

export const outboundQueue = OutboundQueue.getInstance();
