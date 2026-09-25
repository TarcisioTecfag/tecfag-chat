import { db } from "../../db";
import { messages, conversations, pendingInbounds, channelConfigs } from "../../db/schema";
import { eq, and, lt, inArray, sql } from "drizzle-orm";
import { metaAdapter } from "./adapters/meta";
import { baileysAdapter } from "./adapters/baileys";
import { inboundProcessor } from "./inbound";
import { WhatsAppProviderType } from "./types";

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

      // ── 1. Recuperar mensagens de saída presas em 'sending' ────────────────
      const stuckOutbounds = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.direction, "outbound"),
            eq(messages.status, "sending"),
            lt(messages.updatedAt, thresholdDate)
          )
        );

      stats.stuckOutboundsChecked = stuckOutbounds.length;

      for (const msg of stuckOutbounds) {
        try {
          const currentRetries = msg.retryCount || 0;

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

            const provider: WhatsAppProviderType =
              (channelConfig?.activeProvider as WhatsAppProviderType) || (msg.provider as WhatsAppProviderType) || "baileys";

            let dispatchResult: { externalId?: string; status: any; error?: string };

            if (provider === "meta") {
              dispatchResult = await metaAdapter.send(msg.tenantId, {
                tenantId: msg.tenantId,
                conversationId: msg.conversationId || "",
                recipientPhone: "", // obtido se houver contato
                text: msg.content || "",
              });
            } else {
              dispatchResult = await baileysAdapter.send(msg.tenantId, {
                tenantId: msg.tenantId,
                conversationId: msg.conversationId || "",
                recipientPhone: "",
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
            inArray(pendingInbounds.status, ["pending", "processing"]),
            lt(pendingInbounds.createdAt, thresholdDate)
          )
        );

      stats.stuckInboundsChecked = stuckInbounds.length;

      for (const inb of stuckInbounds) {
        try {
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
            const result = await inboundProcessor.process({
              externalEventId: inb.externalEventId || inb.id,
              tenantId: inb.tenantId,
              provider: (inb.provider as WhatsAppProviderType) || "meta",
              fromPhone: payload.fromPhone || "",
              senderName: payload.senderName || "",
              text: payload.text || "",
              rawPayload: payload,
              timestamp: inb.createdAt,
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
