import { and, asc, eq, isNull, lt, lte, or, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { channelConfigs, messages, pendingInbounds } from "../../db/schema";
import { runtimeSingleton } from "../runtime-singleton";
import { dispatchStored } from "./dispatch";
import { inboundProcessor } from "./inbound";
import { metaAdapter } from "./adapters/meta";
import { applyMetaStatus } from "./meta-status";
import { isMetaMediaType } from "./meta-message-text";
import type { WhatsAppProviderType } from "./types";

export interface RecoveryStats {
  stuckOutboundsChecked: number;
  recoveredOutbounds: number;
  exhaustedOutbounds: number;
  stuckInboundsChecked: number;
  recoveredInbounds: number;
  exhaustedInbounds: number;
}
export class WhatsAppRecoveryService {
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private isRunningCycle = false;
  static getInstance() {
    return runtimeSingleton("WhatsAppRecoveryService", () => new WhatsAppRecoveryService());
  }
  async runRecoveryCycle(timeoutSeconds = 60): Promise<RecoveryStats> {
    const stats = {
      stuckOutboundsChecked: 0,
      recoveredOutbounds: 0,
      exhaustedOutbounds: 0,
      stuckInboundsChecked: 0,
      recoveredInbounds: 0,
      exhaustedInbounds: 0,
    };
    if (this.isRunningCycle) return stats;
    this.isRunningCycle = true;
    try {
      const companies = await db.select({ tenantId: channelConfigs.tenantId }).from(channelConfigs);
      const now = new Date();
      const threshold = new Date(now.getTime() - timeoutSeconds * 1000);
      for (const { tenantId } of companies) {
        const abandoned = await db
          .update(messages)
          .set({
            status: "unknown",
            leaseToken: null,
            leaseUntil: null,
            errorMessage: "Envio interrompido sem confirmação. Verifique antes de reenviar.",
            updatedAt: now,
          })
          .where(
            and(
              eq(messages.tenantId, tenantId),
              eq(messages.direction, "outbound"),
              eq(messages.status, "sending"),
              lt(messages.updatedAt, threshold),
              or(isNull(messages.leaseUntil), lte(messages.leaseUntil, now)),
            ),
          )
          .returning({ id: messages.id });
        stats.stuckOutboundsChecked += abandoned.length;
        const queued = await db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, tenantId),
              eq(messages.direction, "outbound"),
              eq(messages.status, "pending"),
              or(isNull(messages.nextRetryAt), lte(messages.nextRetryAt, now)),
            ),
          )
          .orderBy(asc(messages.sentAt))
          .limit(20);
        for (const row of queued) {
          const result = await dispatchStored(tenantId, row.id);
          if (result?.status === "accepted") stats.recoveredOutbounds++;
          if (result?.status === "failed") stats.exhaustedOutbounds++;
        }
        const inputs = await db
          .select()
          .from(pendingInbounds)
          .where(
            and(
              eq(pendingInbounds.tenantId, tenantId),
              inArray(pendingInbounds.status, ["pending", "processing", "failed"]),
              lt(pendingInbounds.createdAt, threshold),
              or(isNull(pendingInbounds.nextRetryAt), lte(pendingInbounds.nextRetryAt, now)),
            ),
          )
          .orderBy(asc(pendingInbounds.createdAt))
          .limit(20);
        stats.stuckInboundsChecked += inputs.length;
        for (const event of inputs) {
          const identity = and(
            eq(pendingInbounds.tenantId, tenantId),
            eq(pendingInbounds.id, event.id),
          );
          try {
            const claimed = await db
              .update(pendingInbounds)
              .set({ nextRetryAt: new Date(Date.now() + 5 * 60_000) })
              .where(
                and(
                  identity,
                  or(isNull(pendingInbounds.nextRetryAt), lte(pendingInbounds.nextRetryAt, now)),
                ),
              )
              .returning({ id: pendingInbounds.id });
            if (!claimed.length) continue;
            const raw: any = event.payload || {};
            if (raw.kind === "meta_status") {
              if (await applyMetaStatus(tenantId, raw.statusObj, false)) {
                await db
                  .update(pendingInbounds)
                  .set({ status: "processed", processedAt: new Date() })
                  .where(identity);
                stats.recoveredInbounds++;
              }
              continue;
            }
            if (raw.kind === "baileys_message") {
              const { SessionManager } = await import("../baileys/session-manager");
              await SessionManager.getInstance().recoverInbound(
                tenantId,
                raw.message,
                raw.historical,
              );
              stats.recoveredInbounds++;
              continue;
            }
            if (!raw.fromPhone && !raw.from && !raw.fromUserId && !raw.from_user_id) {
              await db
                .update(pendingInbounds)
                .set({
                  status: "error",
                  errorMessage: "Evento sem identidade; requer revisão do payload original.",
                })
                .where(identity);
              stats.exhaustedInbounds++;
              continue;
            }
            let media: any;
            if (event.provider === "meta" && isMetaMediaType(raw.type)) {
              const source = raw[raw.type];
              const [config] = await db
                .select({ phone: channelConfigs.metaPhoneNumberId })
                .from(channelConfigs)
                .where(eq(channelConfigs.tenantId, tenantId));
              if (!config?.phone || !source?.id) throw Error("Mídia indisponível");
              const downloaded = await metaAdapter.downloadInboundMedia(
                tenantId,
                config.phone,
                source.id,
              );
              media = {
                mediaType: raw.type,
                mimeType: downloaded.mimeType,
                fileName: source.filename,
                dataBuffer: downloaded.buffer,
              };
            }
            const result = await inboundProcessor.process({
              tenantId,
              provider: event.provider as WhatsAppProviderType,
              externalEventId: event.externalEventId || event.id,
              fromPhone: raw.fromPhone || raw.from || "",
              fromUserId: raw.fromUserId || raw.from_user_id,
              senderName: raw.senderName,
              whatsappUsername: raw.whatsappUsername,
              text:
                typeof raw.text === "string"
                  ? raw.text
                  : raw.text?.body || raw[raw.type]?.caption || "",
              media,
              quotedExternalId: raw.context?.id,
              rawPayload: raw,
              timestamp: raw.timestamp ? new Date(Number(raw.timestamp) * 1000) : event.createdAt,
            });
            if (result.success) stats.recoveredInbounds++;
          } catch {
            await db
              .update(pendingInbounds)
              .set({
                nextRetryAt: new Date(
                  Date.now() + Math.min(60_000 * 2 ** Math.min(event.attempts, 5), 30 * 60_000),
                ),
                attempts: sql`${pendingInbounds.attempts}+1`,
                errorMessage: "Dependência indisponível; nova tentativa programada.",
              })
              .where(identity);
          }
        }
      }
    } finally {
      this.isRunningCycle = false;
    }
    return stats;
  }
  startRecoveryWorker(intervalMs = 30000) {
    if (this.intervalTimer) return;
    console.log("[Recovery] Worker durável iniciado.");
    const run = () =>
      this.runRecoveryCycle().catch(() =>
        console.error("[Recovery] Falha de ciclo; pendências preservadas."),
      );
    void run();
    this.intervalTimer = setInterval(run, intervalMs);
    this.intervalTimer.unref();
  }
  stopRecoveryWorker() {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = null;
  }
}
export const whatsAppRecoveryService = WhatsAppRecoveryService.getInstance();
