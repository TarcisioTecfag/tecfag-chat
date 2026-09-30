import { db } from "../../db";
import { messages, conversations, contacts, pendingInbounds, channelConfigs } from "../../db/schema";
import { eq, and, lt, inArray, sql } from "drizzle-orm";
import { metaAdapter } from "./adapters/meta";
import { baileysAdapter } from "./adapters/baileys";
import { inboundProcessor } from "./inbound";
import { WhatsAppProviderType } from "./types";
import { applyMetaStatus } from "./meta-status";

export interface RecoveryStats {
  stuckOutboundsChecked: number;
  recoveredOutbounds: number;
  exhaustedOutbounds: number;
  stuckInboundsChecked: number;
  recoveredInbounds: number;
  exhaustedInbounds: number;
}

export class WhatsAppRecoveryService {
  private static instance: WhatsAppRecoveryService;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunningCycle = false;

  private constructor() {}

  static getInstance(): WhatsAppRecoveryService {
    if (!WhatsAppRecoveryService.instance) {
      WhatsAppRecoveryService.instance = new WhatsAppRecoveryService();
    }
    return WhatsAppRecoveryService.instance;
  }

  /**
   * Executa um ciclo completo de verificação e recuperação de mensagens presas
   * em status intermediários ('sending', 'processing') devido a crashes ou timeouts.
   */
  async runRecoveryCycle(timeoutSeconds = 60): Promise<RecoveryStats> {
    if (this.isRunningCycle) {
      return {
        stuckOutboundsChecked: 0,
        recoveredOutbounds: 0,
        exhaustedOutbounds: 0,
        stuckInboundsChecked: 0,
        recoveredInbounds: 0,
        exhaustedInbounds: 0,
      };
    }

    this.isRunningCycle = true;
    const stats: RecoveryStats = {
      stuckOutboundsChecked: 0,
      recoveredOutbounds: 0,
      exhaustedOutbounds: 0,
      stuckInboundsChecked: 0,
      recoveredInbounds: 0,
      exhaustedInbounds: 0,
    };

    try {
      const thresholdDate = new Date(Date.now() - timeoutSeconds * 1000);
      const configuredTenants = await db.select({ tenantId: channelConfigs.tenantId }).from(channelConfigs);
      for (const { tenantId } of configuredTenants) {

      // ── 1. Recuperar mensagens de saída presas em 'sending' ────────────────
      const stuckOutbounds = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.direction, "outbound"),
            eq(messages.tenantId, tenantId),
            eq(messages.status, "sending"),
            lt(messages.updatedAt, thresholdDate)
          )
        );

      stats.stuckOutboundsChecked += stuckOutbounds.length;

      for (const msg of stuckOutbounds) {
        try {
          // Trava de concorrência atômica por mensagem para evitar duplo reenvio
          try {
            const [lockRes] = await db.execute<{ locked: boolean }>(
              sql`SELECT pg_try_advisory_xact_lock(hashtext(${'outbound:' + msg.id})) as locked`
            );
            if (lockRes && lockRes.locked === false) {
              continue; // outro processo ou worker já está processando
            }
          } catch {
            // Suporte defensivo a ambientes de teste sem Postgres nativo
          }

          const currentRetries = msg.retryCount || 0;

          // Um timeout da Cloud API pode ocorrer após a Meta aceitar a mensagem.
          // Reenvio automático nessa situação cria duplicidade cobrável.
          if (msg.provider === "meta") {
            await db.update(messages).set({
              status: "unknown",
              errorMessage: "Envio Meta sem confirmação. Aguarde status do webhook ou reconcilie manualmente antes de reenviar.",
              updatedAt: new Date(),
            }).where(and(eq(messages.id, msg.id), eq(messages.tenantId, msg.tenantId)));
            continue;
          }

          if (currentRetries >= 3) {
            // Esgotou retentativas: marcar como falha definitiva
            await db
              .update(messages)
              .set({
                status: "failed",
                errorMessage: "Tempo limite de envio excedido após 3 tentativas (timeout/crash).",
                updatedAt: new Date(),
              })
              .where(and(eq(messages.id, msg.id), eq(messages.tenantId, msg.tenantId)));

            stats.exhaustedOutbounds++;
            console.warn(`[RecoveryWorker] Mensagem ${msg.id} marcada como 'failed' por exaustão de retentativas.`);
          } else {
            // Incrementar retentativa e tentar despacho novamente
            await db
              .update(messages)
              .set({
                retryCount: currentRetries + 1,
                updatedAt: new Date(),
              })
              .where(and(eq(messages.id, msg.id), eq(messages.tenantId, msg.tenantId)));

            const [channelConfig] = await db
              .select()
              .from(channelConfigs)
              .where(eq(channelConfigs.tenantId, msg.tenantId));

            // CRÍTICO: O reenvio DEVE usar o provedor original gravado na mensagem, NUNCA o ativo do canal
            const provider: WhatsAppProviderType =
              (msg.provider as WhatsAppProviderType) || (channelConfig?.activeProvider as WhatsAppProviderType) || "baileys";

            // Resolver telefone de destino a partir do contato da conversa
            let resolvedPhone = "";
            if (msg.conversationId) {
              const [conv] = await db
                .select({ contactId: conversations.contactId })
                .from(conversations)
                .where(and(eq(conversations.id, msg.conversationId), eq(conversations.tenantId, msg.tenantId)));

              if (conv?.contactId) {
                const [contact] = await db
                  .select({ phone: contacts.phone })
                  .from(contacts)
                  .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, msg.tenantId)));
                if (contact?.phone) resolvedPhone = contact.phone;
              }
            }

            let dispatchResult: { externalId?: string; status: any; error?: string };

            if (provider === "meta") {
              dispatchResult = await metaAdapter.send(msg.tenantId, {
                tenantId: msg.tenantId,
                conversationId: msg.conversationId || "",
                recipientPhone: resolvedPhone,
                text: msg.content || "",
              });
            } else {
              dispatchResult = await baileysAdapter.send(msg.tenantId, {
                tenantId: msg.tenantId,
                conversationId: msg.conversationId || "",
                recipientPhone: resolvedPhone,
                text: msg.content || "",
              });
            }

            if (dispatchResult.status === "accepted") {
              await db
                .update(messages)
                .set({
                  status: "accepted",
                  externalId: dispatchResult.externalId || null,
                  updatedAt: new Date(),
                })
                .where(and(eq(messages.id, msg.id), eq(messages.tenantId, msg.tenantId)));

              stats.recoveredOutbounds++;
              console.log(`[RecoveryWorker] Mensagem ${msg.id} recuperada e enviada com sucesso.`);
            } else {
              if (currentRetries + 1 >= 3) {
                await db
                  .update(messages)
                  .set({
                    status: "failed",
                    errorMessage: dispatchResult.error || "Falha final no envio pelo provedor",
                    updatedAt: new Date(),
                  })
                  .where(and(eq(messages.id, msg.id), eq(messages.tenantId, msg.tenantId)));

                stats.exhaustedOutbounds++;
              }
            }
          }
        } catch (msgErr: any) {
          console.error(`[RecoveryWorker] Erro ao recuperar mensagem ${msg.id}:`, msgErr);
        }
      }

      // ── 2. Recuperar eventos de entrada presos em 'processing' ─────────────
      const stuckInbounds = await db
        .select()
        .from(pendingInbounds)
        .where(
          and(
            eq(pendingInbounds.tenantId, tenantId),
            inArray(pendingInbounds.status, ["pending", "processing", "failed"]),
            lt(pendingInbounds.createdAt, thresholdDate)
          )
        );

      stats.stuckInboundsChecked += stuckInbounds.length;

      for (const inb of stuckInbounds) {
        try {
          // Trava de concorrência atômica por evento de entrada
          try {
            const [lockRes] = await db.execute<{ locked: boolean }>(
              sql`SELECT pg_try_advisory_xact_lock(hashtext(${'inbound:' + inb.id})) as locked`
            );
            if (lockRes && lockRes.locked === false) {
              continue; // outro processo já está processando
            }
          } catch {
            // Suporte defensivo
          }

          const attempts = inb.attempts || 0;
          if (attempts >= 3) {
            await db
              .update(pendingInbounds)
              .set({
                status: "error",
                errorMessage: "Excedido limite de 3 tentativas de processamento de entrada.",
                processedAt: new Date(),
              })
              .where(and(eq(pendingInbounds.id, inb.id), eq(pendingInbounds.tenantId, inb.tenantId)));

            stats.exhaustedInbounds++;
          } else {
            await db
              .update(pendingInbounds)
              .set({
                attempts: attempts + 1,
              })
              .where(and(eq(pendingInbounds.id, inb.id), eq(pendingInbounds.tenantId, inb.tenantId)));

            const payload: any = inb.payload || {};
            if (payload.kind === "meta_status" && payload.statusObj) {
              if (await applyMetaStatus(inb.tenantId, payload.statusObj, false)) {
                await db.update(pendingInbounds).set({ status: "processed", processedAt: new Date() })
                  .where(and(eq(pendingInbounds.id, inb.id), eq(pendingInbounds.tenantId, inb.tenantId)));
                stats.recoveredInbounds++;
              }
              continue;
            }

            let recoveredMedia: any;
            if (inb.provider === "meta" && ["image", "audio", "video", "document"].includes(payload.type)) {
              const mediaObject = payload[payload.type];
              const [config] = await db.select({ metaPhoneNumberId: channelConfigs.metaPhoneNumberId })
                .from(channelConfigs).where(eq(channelConfigs.tenantId, inb.tenantId));
              if (!config?.metaPhoneNumberId || !mediaObject?.id) throw new Error("Mídia Meta sem número ou ID para recuperação");
              const downloaded = await metaAdapter.downloadInboundMedia(inb.tenantId, config.metaPhoneNumberId, mediaObject.id);
              recoveredMedia = {
                mediaType: payload.type,
                mimeType: downloaded.mimeType,
                fileName: mediaObject.filename || `${payload.type}_${payload.id}`,
                dataBuffer: downloaded.buffer,
              };
            }
            const result = await inboundProcessor.process({
              externalEventId: inb.externalEventId || inb.id,
              tenantId: inb.tenantId,
              provider: (inb.provider as WhatsAppProviderType) || "meta",
              fromPhone: payload.fromPhone || payload.from || "",
              senderName: payload.senderName || "",
              text: typeof payload.text === "string" ? payload.text : payload.text?.body || payload[payload.type]?.caption || "",
              media: recoveredMedia,
              quotedExternalId: payload.context?.id,
              rawPayload: payload,
              timestamp: payload.timestamp ? new Date(Number(payload.timestamp) * 1000) : inb.createdAt,
            });

            if (result.success) {
              stats.recoveredInbounds++;
              console.log(`[RecoveryWorker] Evento de entrada ${inb.id} reprocessado com sucesso.`);
            }
          }
        } catch (inbErr: any) {
          console.error(`[RecoveryWorker] Erro ao recuperar inbound ${inb.id}:`, inbErr);
        }
      }
      }
    } finally {
      this.isRunningCycle = false;
    }

    return stats;
  }

  /**
   * Inicia o worker em segundo plano para rodar periodicamente.
   */
  startRecoveryWorker(intervalMs = 30000): void {
    if (this.intervalTimer) return;

    console.log(`[RecoveryWorker] 🔄 Serviço de recuperação iniciado (ciclo a cada ${intervalMs / 1000}s).`);
    // Rodar imediatamente na inicialização
    this.runRecoveryCycle().catch((err) =>
      console.error("[RecoveryWorker] Erro no ciclo inicial de recuperação:", err)
    );

    this.intervalTimer = setInterval(() => {
      this.runRecoveryCycle().catch((err) =>
        console.error("[RecoveryWorker] Erro no ciclo periódico de recuperação:", err)
      );
    }, intervalMs);

    // Permitir shutdown gracioso sem prender o event-loop
    if (this.intervalTimer.unref) {
      this.intervalTimer.unref();
    }
  }

  /**
   * Para o worker periódico.
   */
  stopRecoveryWorker(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      console.log("[RecoveryWorker] ⏹️ Serviço de recuperação finalizado.");
    }
  }
}

export const whatsAppRecoveryService = WhatsAppRecoveryService.getInstance();
