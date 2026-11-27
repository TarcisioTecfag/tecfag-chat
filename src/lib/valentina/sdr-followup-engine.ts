import { runtimeSingleton } from "../runtime-singleton";
import { db } from "../../db";
import { agentConfigs, agentFlowStates, conversations, messages, contacts, tenants } from "../../db/schema";
import { eq, and, asc, desc, gte, ne, isNull, sql, inArray, or } from "drizzle-orm";
import { vertexAi } from "../vertex-ai";
import { SessionManager, resolveRealJid } from "../baileys/session-manager";
import { resolveTenantActiveProvider, sendBotPresence, sendSdrChannelText } from "./sdr-channel-sender";
import { getAiPersona, isSdrTenant } from "../ai-persona";
import { SdrDebouncer } from "./sdr-debouncer";
import { ensureLocalCrmDealBeforeTransfer } from "./sdr-crm-local";
import { markIndustrialNoResponse } from "../triage/industrial-silence-store";
import {
  parseIndustrialSilenceConfig,
  evaluateIndustrialSilence,
  buildIndustrialFollowUpText,
  deterministicIndustrialFollowUpMessageId,
  selectRecentCycleMessages,
} from "../triage/industrial-silence-policy";
import { loadIndustrialBusinessHoursForTenant } from "../triage/industrial-business-hours-store";
import { decideIndustrialFollowUpWithAi } from "../triage/industrial-followup-ai";
import { isSiteConversationId } from "../livechat/site-channel-policy";
import { findActiveWhatsappSessionForSiteContact } from "../livechat/site-cross-channel-guard";

/**
 * Motor Autônomo de Follow-up de Silêncio (Reengajamento Ativo)
 * - Para tenants legados (`valem` / `triagePolicy === "legacy"`): preserva integralmente os 3 estágios (6 min, 15 min, 20 min).
 * - Para tenants industriais (`triagePolicy === "industrial"`): executa a política de silêncio industrial configurável
 *   (FU1 25 min, FU2 +20 min, Sem Resposta +30 min ou 20h BRT, resgate parcial no site em 10 min e respeito ao expediente).
 */
export class SdrFollowupEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  public static getInstance(): SdrFollowupEngine {
    return runtimeSingleton("__valem_sdrFollowupEngine", () => new SdrFollowupEngine());
  }

  public start() {
    if (this.intervalId) return;
    console.log("[SdrFollowupEngine] ⏱️ Motor de Follow-up de Silêncio iniciado (ciclo: 60s)");
    this.intervalId = setInterval(() => {
      this.runFollowupCycle().catch((err) =>
        console.error("[SdrFollowupEngine] Erro no ciclo de follow-up:", err)
      );
    }, 60 * 1000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public async runFollowupCycle(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const configs = await db
        .select()
        .from(agentConfigs)
        .where(and(eq(agentConfigs.agentType, "sdr"), eq(agentConfigs.enabled, 1)));

      for (const sdrConfig of configs) {
        const tenantId = sdrConfig.tenantId;
        if (!isSdrTenant(tenantId)) continue;

        const persona = getAiPersona(tenantId);
        const configData = (sdrConfig.config as Record<string, any>) || {};

        if (persona.triagePolicy === "industrial") {
          await this.runIndustrialSilenceCycle(tenantId, configData);
        } else {
          await this.runLegacyFollowupCycle(tenantId);
        }
      }
    } catch (err: any) {
      console.error("[SdrFollowupEngine] Erro geral ao verificar conversas em silêncio:", err?.message);
    } finally {
      this.isRunning = false;
    }
  }

  /** Runtime industrial: never starts or changes the legacy tenant's follow-up loop. */
  public async runIndustrialFollowupCycle(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const companies = await db.select({ id: tenants.id }).from(tenants);
      for (const { id: tenantId } of companies) {
        if (getAiPersona(tenantId).triagePolicy !== "industrial") continue;
        const [config] = await db.select().from(agentConfigs).where(and(
          eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr"), eq(agentConfigs.enabled, 1),
        )).limit(1);
        if (config) await this.runIndustrialSilenceCycle(tenantId, (config.config as Record<string, any>) || {});
      }
    } finally { this.isRunning = false; }
  }

  /**
   * Ciclo de silêncio industrial (Fagner / tenants com triagePolicy === "industrial")
   */
  public async runIndustrialSilenceCycle(
    tenantId: string,
    configData: Record<string, any> = {},
    nowOverride?: Date,
  ): Promise<void> {
    const silenceCfg = parseIndustrialSilenceConfig(configData);
    if (!silenceCfg.enabled) return;

    const now = nowOverride || new Date();
    const { config: scheduleCfg, evaluation: businessHours } =
      await loadIndustrialBusinessHoursForTenant(db, tenantId, now, configData);
    const withinSchedule = businessHours.isWithinSchedule;
    const persona = getAiPersona(tenantId);

    const activeFlows = await db
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.agentType, "sdr"),
          eq(agentFlowStates.outcome, "in_progress"),
          isNull(agentFlowStates.completedAt),
        ),
      );

    for (const flow of activeFlows) {
      try {
        if (SdrDebouncer.getInstance().isBusy(flow.conversationId)) {
          continue;
        }

        const [conv] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.id, flow.conversationId),
              eq(conversations.tenantId, tenantId),
            ),
          );

        // Auto-recuperação de ponte Site → WhatsApp interrompida entre Step 5 (template Meta enviado)
        // e Step 6 (commit de espelhamento/CRM/awaiting_approval), ex.: deploy no Railway durante o handoff.
        if (isSiteConversationId(flow.conversationId) && conv && conv.queueState !== "finalizados" && !conv.operatorId) {
          const metaBridgeCheck = (flow.metadata as Record<string, unknown>) || {};
          const { shouldRecoverPendingSiteWhatsappBridge, recoverInterruptedSiteWhatsappBridge } = await import(
            "../livechat/site-whatsapp-handoff"
          );
          const pendingBridge = shouldRecoverPendingSiteWhatsappBridge(metaBridgeCheck, now.getTime());
          if (pendingBridge) {
            try {
              const recovered = await recoverInterruptedSiteWhatsappBridge(db, {
                tenantId,
                siteConversationId: flow.conversationId,
                siteFlowId: flow.id,
                collectedData: (flow.collectedData as Record<string, any>) || {},
                pending: pendingBridge,
                nowMs: now.getTime(),
              });
              if (recovered.handedOff) {
                SessionManager.getInstance().notifyPublic(tenantId, {
                  type: "queue_update",
                  conversationId: flow.conversationId,
                  queueState: "finalizados",
                  operatorId: null,
                  unreadCount: 0,
                });
                SessionManager.getInstance().notifyPublic(tenantId, {
                  type: "sdr_flow_updated",
                  conversationId: flow.conversationId,
                  funnelStage: pendingBridge.route.funnelStage,
                  targetFunnel: pendingBridge.route.targetFunnel,
                  outcome: "transferred",
                  handoffStatus: "continued_to_whatsapp",
                });
                console.log(
                  `[SdrFollowupEngine] 🔁 Ponte Site→WhatsApp interrompida recuperada com sucesso (${flow.conversationId} → ${recovered.whatsappConversationId}, deal=${recovered.dealId || "n/a"}).`,
                );
                continue;
              }
            } catch (bridgeRecErr: any) {
              console.error(
                `[SdrFollowupEngine] ❌ Falha ao recuperar ponte Site→WhatsApp interrompida (${flow.conversationId}):`,
                bridgeRecErr?.stack || bridgeRecErr?.message || bridgeRecErr,
              );
              continue;
            }
          }
        }

        // Trava cross-channel Site × WhatsApp: se o mesmo contato já está em triagem/aprovação/atendimento
        // ativo no WhatsApp oficial (24h), espelha as mensagens do site no WhatsApp e encerra o ciclo
        // paralelo do Site sem disparar follow-up nem criar card duplicado (exceto se o cliente
        // explicitamente recusou ir ao WhatsApp durante triagem IA e optou por continuar no site).
        if (isSiteConversationId(flow.conversationId) && conv?.contactId) {
          try {
            const metaFlowCheck = (flow.metadata as Record<string, any>) || {};
            const crossChannel = await findActiveWhatsappSessionForSiteContact(db, {
              tenantId,
              contactId: conv.contactId,
              siteConversationId: flow.conversationId,
              now,
            });
            const stayOnSiteAllowed =
              metaFlowCheck.crossChannelContinueOnSite === true &&
              crossChannel.reason === "whatsapp_triage_in_progress";
            if (crossChannel.suppressed && !stayOnSiteAllowed) {
              if (crossChannel.whatsappConversationId) {
                const { mirrorSiteMessagesToWhatsapp } = await import(
                  "../livechat/site-whatsapp-mirror"
                );
                await mirrorSiteMessagesToWhatsapp(db, {
                  tenantId,
                  siteConversationId: flow.conversationId,
                  waConversationId: crossChannel.whatsappConversationId,
                  bumpUnreadForHuman: false,
                  closeLivechatRecord: true,
                  notifyRealtime: true,
                }).catch(() => {});
              }
              await db
                .update(agentFlowStates)
                .set({
                  currentStep: "Em Atendimento no WhatsApp",
                  outcome: "transferred",
                  completedAt: now,
                  lastInteractionAt: now,
                  metadata: {
                    ...metaFlowCheck,
                    followUpStage: 0,
                    handoffStatus: "continued_to_whatsapp",
                    whatsappConversationId: crossChannel.whatsappConversationId,
                    crossChannelSuppressedReason: crossChannel.reason,
                    crossChannelSuppressedAt: now.toISOString(),
                  },
                })
                .where(
                  and(
                    eq(agentFlowStates.id, flow.id),
                    eq(agentFlowStates.tenantId, tenantId),
                    eq(agentFlowStates.outcome, "in_progress"),
                    isNull(agentFlowStates.completedAt),
                  ),
                );
              if (!conv.operatorId && conv.queueState !== "finalizados") {
                await db
                  .update(conversations)
                  .set({
                    queueState: "finalizados",
                    unreadCount: 0,
                    updatedAt: now,
                    version: sql`${conversations.version} + 1`,
                  })
                  .where(
                    and(
                      eq(conversations.tenantId, tenantId),
                      eq(conversations.id, flow.conversationId),
                      isNull(conversations.operatorId),
                    ),
                  );
              }
              console.log(
                `[SdrFollowupEngine] 🛑 Follow-up do site ${flow.conversationId} cancelado e histórico espelhado (atendimento ativo no WhatsApp ${crossChannel.whatsappConversationId}: ${crossChannel.reason}).`,
              );
              continue;
            }
          } catch (crossErr: any) {
            console.warn(
              `[SdrFollowupEngine] Aviso ao checar cross-channel Site×WhatsApp (${flow.conversationId}):`,
              crossErr?.message,
            );
          }
        }

        const rawCycleMsgs = await db
          .select({
            id: messages.id,
            senderType: messages.senderType,
            senderName: messages.senderName,
            sentAt: messages.sentAt,
            content: messages.content,
          })
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, tenantId),
              eq(messages.conversationId, flow.conversationId),
              ne(messages.content, "!reset"),
              eq(messages.isInternalNote, false),
              or(ne(messages.senderType, "bot"), inArray(messages.status, ["sent", "accepted", "delivered", "read"])),
              ...(flow.startedAt ? [gte(messages.sentAt, flow.startedAt)] : []),
            ),
          )
          .orderBy(desc(messages.sentAt), desc(messages.id))
          .limit(40);

        const latestClient = rawCycleMsgs.find((row) => row.senderType === "client");
        if (latestClient) {
          const [blockedDelivery] = await db.select({ id: messages.id }).from(messages).where(and(
            eq(messages.tenantId, tenantId), eq(messages.conversationId, flow.conversationId), eq(messages.senderType, "bot"),
            inArray(messages.status, ["pending", "sending", "unknown", "failed"]),
            sql`${messages.metaDetails}->'industrialDelivery'->>'triggerId' = ${latestClient.id}`,
            sql`${messages.metaDetails}->'industrialDelivery'->>'cycle' = ${flow.startedAt.toISOString()}`,
          )).limit(1);
          if (blockedDelivery) continue;
        }
        const cycleMsgs = selectRecentCycleMessages(rawCycleMsgs, flow.startedAt || null, 40);
        const collectedData = (flow.collectedData as Record<string, any>) || {};
        const meta = (flow.metadata as Record<string, any>) || {};

        const decision = evaluateIndustrialSilence({
          now,
          withinSchedule,
          scheduleStartHour: scheduleCfg.startHour,
          scheduleStartMinute: scheduleCfg.startMinute,
          scheduleTimezone: scheduleCfg.timezone,
          flow: {
            id: flow.id,
            tenantId,
            conversationId: flow.conversationId,
            startedAt: flow.startedAt,
            lastInteractionAt: flow.lastInteractionAt,
            outcome: flow.outcome,
            currentStep: flow.currentStep,
            completedAt: flow.completedAt,
            followUpStage: Number(meta.followUpStage || 0),
            collectedData,
            metadata: meta,
          },
          conversation: conv
            ? {
                id: conv.id,
                queueState: conv.queueState,
                operatorId: conv.operatorId,
                contactId: conv.contactId,
              }
            : null,
          recentMessages: cycleMsgs,
          config: silenceCfg,
        });

        if (decision.action === "cancel_by_human") {
          const movedToHuman = conv?.queueState === "meus" || Boolean(conv?.operatorId);
          const preSilenceStage =
            typeof meta.funnelStage === "string" && meta.funnelStage !== "sem_resposta"
              ? meta.funnelStage
              : typeof meta.preSilenceFunnelStage === "string"
                ? meta.preSilenceFunnelStage
                : "triagem";
          await db
            .update(agentFlowStates)
            .set(
              movedToHuman
                ? {
                    metadata: { ...meta, followUpStage: 0 },
                    outcome: "transferred",
                    completedAt: now,
                    lastInteractionAt: now,
                  }
                : {
                    currentStep: "Sem Resposta",
                    metadata: {
                      ...meta,
                      followUpStage: 0,
                      preSilenceFunnelStage: preSilenceStage,
                      funnelStage: "sem_resposta",
                      noResponseAt: now.toISOString(),
                      noResponseReason: decision.reason || "conversation_closed_before_completion",
                    },
                    outcome: "abandoned",
                    completedAt: now,
                    lastInteractionAt: now,
                  },
            )
            .where(
              and(
                eq(agentFlowStates.id, flow.id),
                eq(agentFlowStates.tenantId, tenantId),
                eq(agentFlowStates.outcome, "in_progress"),
                isNull(agentFlowStates.completedAt),
              ),
            );
          continue;
        }

        if (decision.action === "reset_followup") {
          const resetMeta = {
            ...meta,
            followUpStage: 0,
            followUpSuppressedCycle: null,
            followUpSuppressedAt: null,
            followUpDeferredCycle: null,
            followUpDeferredAt: null,
            followUpDeferredUntil: null,
          };
          await db
            .update(agentFlowStates)
            .set({
              metadata: resetMeta,
            })
            .where(
              and(
                eq(agentFlowStates.id, flow.id),
                eq(agentFlowStates.tenantId, tenantId),
                eq(agentFlowStates.outcome, "in_progress"),
                isNull(agentFlowStates.completedAt),
              ),
            );
          continue;
        }

        if (decision.action === "none" && !decision.rescuePartialLead) {
          continue;
        }

        // Resolver telefone do contato para resgate parcial ou envio WhatsApp
        let contactPhone = "";
        if (conv?.contactId) {
          const [cnt] = await db
            .select({ phone: contacts.phone })
            .from(contacts)
            .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)))
            .limit(1);
          contactPhone = cnt?.phone || conv.contactId.replace(/^c-/, "");
        }

        let partialLeadRescuedAt: string | undefined;
        let rescuedDeal: Awaited<ReturnType<typeof ensureLocalCrmDealBeforeTransfer>> | null = null;
        if (decision.rescuePartialLead) {
          try {
            rescuedDeal = await ensureLocalCrmDealBeforeTransfer({
              tenantId,
              conversationId: flow.conversationId,
              contactId: conv?.contactId || null,
              contactPhone,
              targetFunnel: String(meta.targetFunnel || "Máquinas"),
              funnelStage: String(meta.funnelStage || "triagem"),
              collectedData,
              allocatedOperator: null,
            });
            partialLeadRescuedAt = now.toISOString();
          } catch (rescueErr: any) {
            console.warn(
              `[SdrFollowupEngine] Aviso ao resgatar lead parcial (${flow.conversationId}):`,
              rescueErr?.message,
            );
          }
        }

        if (decision.action === "none") {
          if (partialLeadRescuedAt) {
            const rescuedMetaPatch = {
              ...meta,
              partialLeadRescuedAt,
              ...(rescuedDeal
                ? {
                    localCrmDealId: rescuedDeal.dealId,
                    localCrmDealTitle: rescuedDeal.dealTitle,
                    localCrmDealAction: rescuedDeal.action,
                  }
                : {}),
            };
            await db
              .update(agentFlowStates)
              .set({ metadata: rescuedMetaPatch })
              .where(
                and(
                  eq(agentFlowStates.id, flow.id),
                  eq(agentFlowStates.tenantId, tenantId),
                  eq(agentFlowStates.outcome, "in_progress"),
                  isNull(agentFlowStates.completedAt),
                ),
              );

            const interestRaw = String(
              collectedData["MÁQUINA / PEÇA / INTERESSE"]?.value ||
                collectedData["SOLICITAÇÃO"]?.value ||
                collectedData["PRODUTO DE INTERESSE"]?.value ||
                "",
            ).trim();
            const hasRealInterest =
              interestRaw.length >= 2 && !/^aguardando/i.test(interestRaw);
            const isExpiredSiteSession =
              decision.reason === "site_followup_stage_limit" ||
              decision.reason === "site_session_expired_for_followup";

            if (isSiteConversationId(flow.conversationId) && isExpiredSiteSession && hasRealInterest) {
              try {
                const { prepareIndustrialApproval, notifySdrTeamApprovalPending } = await import(
                  "../triage/industrial-approval-store"
                );
                const { INDUSTRIAL_REVIEW_FUNNEL } = await import("../triage/industrial-policy");
                const cycleIsoForApproval = flow.startedAt ? flow.startedAt.toISOString() : now.toISOString();
                const approvalPrep = await prepareIndustrialApproval(
                  db,
                  {
                    tenantId,
                    conversationId: flow.conversationId,
                    flowId: flow.id,
                    cycle: cycleIsoForApproval,
                  },
                  {
                    route: {
                      subflow: "5A_CLIENTE",
                      funnelStage: "outros",
                      targetFunnel: INDUSTRIAL_REVIEW_FUNNEL,
                      needsReview: true,
                      reason: "specialist_review",
                    },
                    data: collectedData,
                    clientName: String(collectedData["NOME COMPLETO"]?.value || "Visitante do Site"),
                    companyName: String(collectedData["EMPRESA"]?.value || "Empresa não informada"),
                    contactId: conv?.contactId || null,
                    siteContext: meta.siteContext,
                  },
                );
                if (approvalPrep.prepared && approvalPrep.suggestion) {
                  void notifySdrTeamApprovalPending(db, {
                    tenantId,
                    conversationId: flow.conversationId,
                    suggestion: approvalPrep.suggestion,
                  }).catch((err: any) =>
                    console.warn(
                      "[SdrFollowupEngine] Aviso ao notificar SDR sobre resgate parcial do Site:",
                      err?.message,
                    ),
                  );
                }
              } catch (approvalErr: any) {
                console.warn(
                  `[SdrFollowupEngine] Aviso ao abrir aprovação SDR para lead parcial do Site (${flow.conversationId}):`,
                  approvalErr?.message,
                );
              }
            }
          }
          continue;
        }

        const cycleIso = flow.startedAt ? flow.startedAt.toISOString() : "cycle-0";

        if (decision.action === "send_followup" && (decision.nextStage === 1 || decision.nextStage === 2)) {
          const isSiteConvEarly =
            flow.conversationId.startsWith("conv-lc-") || flow.conversationId.startsWith("site-");
          // Proteção estrita da janela Meta 24h: nunca dispara follow-up de texto livre fora da janela
          // (especialmente importante quando a triagem foi migrada do Site via Template Meta e o cliente ainda não respondeu).
          if (!isSiteConvEarly) {
            try {
              const { resolveConfiguredWhatsappProvider } = await import("./sdr-channel-sender");
              const { getMetaServiceWindow } = await import("../whatsapp/meta-policy");
              const configuredProv = await resolveConfiguredWhatsappProvider(tenantId);
              if (configuredProv === "meta") {
                const win = await getMetaServiceWindow(tenantId, flow.conversationId, now);
                if (!win.open) {
                  console.log(
                    `[SdrFollowupEngine] ⏸️ Follow-up Estágio ${decision.nextStage} ignorado para ${flow.conversationId}: janela Meta 24h fechada (aguardando resposta do cliente no WhatsApp).`,
                  );
                  continue;
                }
              }
            } catch {}
          }
          const prevStage = Number(meta.followUpStage ?? 0);
          const lastCycleMsg = cycleMsgs[cycleMsgs.length - 1];
          const lastCycleMsgMs = lastCycleMsg
            ? lastCycleMsg.sentAt instanceof Date
              ? lastCycleMsg.sentAt.getTime()
              : Date.parse(String(lastCycleMsg.sentAt))
            : flow.lastInteractionAt.getTime();
          const silenceMinutes = Math.max(0, (now.getTime() - lastCycleMsgMs) / 60_000);
          const isSiteConv =
            flow.conversationId.startsWith("conv-lc-") || flow.conversationId.startsWith("site-");

          let followUpText: string;
          let aiObservabilityMeta: Record<string, unknown> = {};

          const canUseAiJudge =
            silenceCfg.aiDecisionEnabled !== false &&
            typeof decideIndustrialFollowUpWithAi === "function";

          if (canUseAiJudge) {
            const aiResult = await decideIndustrialFollowUpWithAi({
              tenantId,
              conversationId: flow.conversationId,
              personaName: persona.name,
              personaCompany: persona.company || "Empresa",
              personaGender: persona.gender,
              stage: decision.nextStage,
              channel: isSiteConv ? "site" : "whatsapp",
              silenceMinutes,
              now,
              timezone: scheduleCfg.timezone,
              subflow: typeof meta.subflow === "string" ? meta.subflow : null,
              targetFunnel: typeof meta.targetFunnel === "string" ? meta.targetFunnel : null,
              currentStep: flow.currentStep,
              collectedData,
              missingFields: Array.isArray(meta.missingFields)
                ? meta.missingFields.filter((v): v is string => typeof v === "string")
                : null,
              recentMessages: cycleMsgs,
            });

            if (aiResult.decision === "skip_close") {
              await db
                .update(agentFlowStates)
                .set({
                  metadata: {
                    ...meta,
                    followUpSuppressedCycle: cycleIso,
                    followUpSuppressedAt: now.toISOString(),
                    followUpDeferredUntil: null,
                    followUpAiDecision: "skip_close",
                    followUpAiReason: aiResult.reason,
                    followUpAiModel: aiResult.model,
                    followUpAiSource: aiResult.source,
                    followUpAiAt: now.toISOString(),
                    ...(partialLeadRescuedAt ? { partialLeadRescuedAt } : {}),
                  },
                })
                .where(
                  and(
                    eq(agentFlowStates.id, flow.id),
                    eq(agentFlowStates.tenantId, tenantId),
                    eq(agentFlowStates.outcome, "in_progress"),
                    isNull(agentFlowStates.completedAt),
                    eq(agentFlowStates.lastInteractionAt, flow.lastInteractionAt),
                    sql`COALESCE(${agentFlowStates.metadata}, '{}'::jsonb) = ${JSON.stringify(meta)}::jsonb`,
                    sql`COALESCE((${agentFlowStates.metadata}->>'followUpStage')::int, 0) = ${prevStage}`,
                  ),
                );
              console.log(
                `[SdrFollowupEngine] 🧠 Follow-up Estágio ${decision.nextStage} suprimido pela IA (${flow.conversationId}): ${aiResult.reason}`,
              );
              continue;
            }

            if (aiResult.decision === "defer") {
              const deferMinutes = aiResult.deferMinutes || 120;
              const deferredUntilIso = new Date(now.getTime() + deferMinutes * 60_000).toISOString();
              await db
                .update(agentFlowStates)
                .set({
                  metadata: {
                    ...meta,
                    followUpDeferredCycle: cycleIso,
                    followUpDeferredAt: now.toISOString(),
                    followUpDeferredUntil: deferredUntilIso,
                    followUpAiDecision: "defer",
                    followUpAiReason: aiResult.reason,
                    followUpAiModel: aiResult.model,
                    followUpAiSource: aiResult.source,
                    followUpAiAt: now.toISOString(),
                    ...(partialLeadRescuedAt ? { partialLeadRescuedAt } : {}),
                  },
                })
                .where(
                  and(
                    eq(agentFlowStates.id, flow.id),
                    eq(agentFlowStates.tenantId, tenantId),
                    eq(agentFlowStates.outcome, "in_progress"),
                    isNull(agentFlowStates.completedAt),
                    eq(agentFlowStates.lastInteractionAt, flow.lastInteractionAt),
                    sql`COALESCE(${agentFlowStates.metadata}, '{}'::jsonb) = ${JSON.stringify(meta)}::jsonb`,
                    sql`COALESCE((${agentFlowStates.metadata}->>'followUpStage')::int, 0) = ${prevStage}`,
                  ),
                );
              console.log(
                `[SdrFollowupEngine] ⏳ Follow-up Estágio ${decision.nextStage} adiado pela IA até ${deferredUntilIso} (${flow.conversationId}): ${aiResult.reason}`,
              );
              continue;
            }

            followUpText =
              aiResult.message ||
              buildIndustrialFollowUpText({
                personaName: persona.name,
                stage: decision.nextStage,
                collectedData,
                metadata: meta,
              });
            aiObservabilityMeta = {
              followUpDeferredUntil: null,
              followUpAiDecision: "send",
              followUpAiReason: aiResult.reason,
              followUpAiModel: aiResult.model,
              followUpAiSource: aiResult.source,
              followUpAiAt: now.toISOString(),
            };
          } else {
            followUpText = buildIndustrialFollowUpText({
              personaName: persona.name,
              stage: decision.nextStage,
              collectedData,
              metadata: meta,
            });
          }

          const nextMeta = {
            ...meta,
            followUpStage: decision.nextStage,
            lastFollowUpCycle: cycleIso,
            lastFollowUpStage: decision.nextStage,
            lastFollowUpAt: now.toISOString(),
            ...aiObservabilityMeta,
            ...(partialLeadRescuedAt ? { partialLeadRescuedAt } : {}),
          };

          const claimed = await db
            .update(agentFlowStates)
            .set({
              metadata: nextMeta,
              lastInteractionAt: now,
            })
            .where(
              and(
                eq(agentFlowStates.id, flow.id),
                eq(agentFlowStates.tenantId, tenantId),
                eq(agentFlowStates.outcome, "in_progress"),
                isNull(agentFlowStates.completedAt),
                eq(agentFlowStates.lastInteractionAt, flow.lastInteractionAt),
                sql`COALESCE(${agentFlowStates.metadata}, '{}'::jsonb) = ${JSON.stringify(meta)}::jsonb`,
                sql`COALESCE((${agentFlowStates.metadata}->>'followUpStage')::int, 0) = ${prevStage}`,
              ),
            )
            .returning({ id: agentFlowStates.id });

          if (claimed.length === 0) {
            continue;
          }

          const msgId = deterministicIndustrialFollowUpMessageId(
            tenantId,
            flow.id,
            cycleIso,
            decision.nextStage,
          );

          const sendResult = await sendSdrChannelText({
            tenantId,
            conversationId: flow.conversationId,
            phone: contactPhone,
            text: followUpText,
            idempotencyMessageId: msgId,
            expectedOperatorId: null,
            deliveryContext: { flowId: flow.id, cycle: cycleIso, triggerId: latestClient?.id },
            scheduleOnly: true,
          });

          if (!sendResult.sent) {
            // Reverter claim caso o envio tenha falhado por indisponibilidade temporária do canal
            await db
              .update(agentFlowStates)
              .set({
                metadata: {
                  ...meta,
                  followUpStage: prevStage,
                  ...(partialLeadRescuedAt ? { partialLeadRescuedAt } : {}),
                },
                lastInteractionAt: flow.lastInteractionAt,
              })
              .where(and(eq(agentFlowStates.id, flow.id), eq(agentFlowStates.tenantId, tenantId),
                eq(agentFlowStates.startedAt, flow.startedAt), eq(agentFlowStates.lastInteractionAt, now),
                sql`${agentFlowStates.metadata} = ${JSON.stringify(nextMeta)}::jsonb`));
          }
          continue;
        }

        if (decision.action === "mark_no_response") {
          const updatedAbandoned = await markIndustrialNoResponse(db, tenantId, flow.conversationId, {
            flowId: flow.id, cycle: flow.startedAt.toISOString(), expectedInteraction: flow.lastInteractionAt.toISOString(), at: now, reason: decision.reason, partialLeadRescuedAt,
          });
          if (updatedAbandoned) {
            if (isSiteConversationId(flow.conversationId)) {
              SessionManager.getInstance().notifyPublic(tenantId, {
                type: "queue_update",
                conversationId: flow.conversationId,
                queueState: "finalizados",
                operatorId: null,
                unreadCount: 0,
              });
            }
            SessionManager.getInstance().notifyPublic(tenantId, {
              type: "sdr_flow_updated",
              conversationId: flow.conversationId,
              funnelStage: "sem_resposta",
              targetFunnel: (meta.targetFunnel as string) || null,
              outcome: "abandoned",
            });
          }
        }
      } catch (flowErr: any) {
        console.error(
          `[SdrFollowupEngine] Erro ao processar silêncio industrial da conversa ${flow.conversationId}:`,
          flowErr?.message,
        );
      }
    }
  }

  /**
   * Ciclo legado de follow-up (Valentina / Valem: 6 min, 15 min, 20 min) — preservado sem alterações
   */
  private async runLegacyFollowupCycle(tenantId: string): Promise<void> {
    const activeProvider = await resolveTenantActiveProvider(tenantId);
    const sock = SessionManager.getInstance().getSession(tenantId);
    if (activeProvider === "baileys" && !sock) return;

    const persona = getAiPersona(tenantId);

    const activeFlows = await db
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.agentType, "sdr"),
          eq(agentFlowStates.outcome, "in_progress"),
          isNull(agentFlowStates.completedAt)
        )
      );

    for (const flow of activeFlows) {
      try {
        const meta = (flow.metadata as Record<string, any>) || {};
        const currentStage = Number(meta.followUpStage || 0);
        if (currentStage >= 3) continue;

        const [conv] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.id, flow.conversationId),
              eq(conversations.tenantId, tenantId)
            )
          );

        if (!conv || conv.operatorId || conv.queueState === "meus" || conv.queueState === "finalizados") {
          await db
            .update(agentFlowStates)
            .set({
              outcome: conv?.queueState === "meus" ? "transferred" : "abandoned",
              completedAt: new Date(),
            })
            .where(and(eq(agentFlowStates.id, flow.id), eq(agentFlowStates.tenantId, tenantId)));
          continue;
        }

        const recentMsgs = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, tenantId),
              eq(messages.conversationId, flow.conversationId),
              ne(messages.content, "!reset"),
              ...(flow.startedAt ? [gte(messages.sentAt, flow.startedAt)] : [])
            )
          )
          .orderBy(asc(messages.sentAt))
          .limit(30);

        if (recentMsgs.length === 0) continue;

        const lastMsg = recentMsgs[recentMsgs.length - 1];
        if (lastMsg.senderType === "client") {
          if (currentStage > 0) {
            await db
              .update(agentFlowStates)
              .set({ metadata: { ...meta, followUpStage: 0 } })
              .where(and(eq(agentFlowStates.id, flow.id), eq(agentFlowStates.tenantId, tenantId)));
          }
          continue;
        }

        const silenceMinutes = (Date.now() - new Date(lastMsg.sentAt).getTime()) / 60000;

        let targetStage = 0;
        if (currentStage === 0 && silenceMinutes >= 6) targetStage = 1;
        else if (currentStage === 1 && silenceMinutes >= 9) targetStage = 2;
        else if (currentStage === 2 && silenceMinutes >= 5) targetStage = 3;

        if (targetStage === 0) continue;

        const contactPhone = (conv.contactId || "").replace(/^c-/, "");
        let recipientUserId: string | undefined;
        let resolvedPhone = contactPhone;
        try {
          if (conv.contactId) {
            const [cnt] = await db
              .select({ whatsappUserId: contacts.whatsappUserId, phone: contacts.phone })
              .from(contacts)
              .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)))
              .limit(1);
            if (cnt?.whatsappUserId) recipientUserId = cnt.whatsappUserId;
            if (cnt?.phone) resolvedPhone = cnt.phone;
          }
        } catch {}

        const realJid = sock ? await resolveRealJid(sock, resolvedPhone) : null;
        if (activeProvider === "baileys" && !realJid) continue;

        const collectedData = (flow.collectedData as Record<string, any>) || {};
        const clientName = collectedData["NOME COMPLETO"]?.value || "";
        const historySnippet = recentMsgs
          .slice(-8)
          .map((m) => `[${m.senderType === "client" ? "Cliente" : persona.name}]: ${m.content}`)
          .join("\n");

        let stageInstruction = "";
        if (targetStage === 1) {
          stageInstruction = `ESTÁGIO 1 (6 minutos de silêncio): Envie um toque super leve, natural e prestativo perguntando se o cliente conseguiu ver a última mensagem ou se ficou alguma dúvida. Sem cobrar.`;
        } else if (targetStage === 2) {
          stageInstruction = `ESTÁGIO 2 (15 minutos de silêncio): Ofereça ajuda ativa de forma consultiva (ex: se ele estiver sem o CNPJ ou dado em mãos agora, diga que pode anotar o que ele souber de cabeça para já ir adiantando com o especialista).`;
        } else {
          stageInstruction = `ESTÁGIO 3 (20 minutos de silêncio — PAUSA ELEGANTE): Diga com muita simpatia que vai deixar o atendimento em aberto para não incomodar, e que assim que ele puder responder é só mandar mensagem aqui que você retoma na hora.`;
        }

        const prompt = `Você é ${persona.gender === "female" ? "a" : "o"} ${persona.name}, consultor(a) de pré-vendas da ${persona.company}.
O cliente está em silêncio no WhatsApp há alguns minutos após a sua última pergunta.

NOME DO CLIENTE (se já souber): ${clientName || "Ainda não informado"}
ÚLTIMAS MENSAGENS DA CONVERSA:
${historySnippet}

MISSÃO (${stageInstruction}):
Gere APENAS 1 frase curta, ultra natural de WhatsApp (máximo 160 caracteres), sem aspas, sem emojis repetitivos, sem parecer robô cobrando resposta.`;

        const followupText = (
          await vertexAi.generateText(prompt, "gemini-2.5-flash", undefined, {
            feature: "sdr_agent",
            tenantId,
            metadata: { conversationId: flow.conversationId, followupStage: targetStage },
          })
        ).trim();

        if (!followupText) continue;

        await sendBotPresence(tenantId, flow.conversationId, resolvedPhone, "composing");
        await new Promise((r) => setTimeout(r, 2500));

        const botSenderName = `${persona.name} (SDR)`;
        let botMessageId = `bot-fup-${Date.now()}`;
        let externalId: string | null = null;

        if (activeProvider === "meta" || !sock || !realJid) {
          const { metaAdapter } = await import("../whatsapp/adapters/meta");
          const sendRes = await metaAdapter.send(tenantId, {
            tenantId,
            conversationId: flow.conversationId,
            recipientPhone: resolvedPhone,
            recipientUserId,
            text: followupText,
          });
          if (sendRes.status === "failed" || !sendRes.externalId) {
            console.error(`[SdrFollowupEngine] ❌ Falha ao enviar follow-up via Meta: ${sendRes.error}`);
            continue;
          }
          externalId = sendRes.externalId;
        } else {
          const sentMsg = await sock.sendMessage(realJid, { text: followupText });
          if (sentMsg?.key?.id) botMessageId = sentMsg.key.id;
        }

        const now = new Date();
        await db.insert(messages).values({
          id: botMessageId,
          tenantId,
          conversationId: flow.conversationId,
          senderType: "bot",
          senderName: botSenderName,
          content: followupText,
          isInternalNote: false,
          direction: "outbound",
          provider: activeProvider,
          externalId,
          status: "sent",
          sentAt: now,
        }).onConflictDoNothing();

        await db
          .update(conversations)
          .set({ lastMessageText: followupText, lastMessageTime: now })
          .where(and(eq(conversations.id, flow.conversationId), eq(conversations.tenantId, tenantId)));

        const updatedMeta = {
          ...meta,
          followUpStage: targetStage,
          lastFollowUpAt: now.toISOString(),
        };

        await db
          .update(agentFlowStates)
          .set({
            metadata: updatedMeta,
            lastInteractionAt: now,
            ...(targetStage === 3 ? { currentStep: "Aguardando Retorno (Follow-up 3)" } : {}),
          })
          .where(and(eq(agentFlowStates.id, flow.id), eq(agentFlowStates.tenantId, tenantId)));

        SessionManager.getInstance().notifyPublic(tenantId, {
          type: "message",
          message: {
            id: botMessageId,
            conversationId: flow.conversationId,
            senderType: "bot",
            senderName: botSenderName,
            content: followupText,
            sentAt: now,
            queue: "automacao",
            operatorId: null,
          },
        });

        console.log(
          `[SdrFollowupEngine] 💬 Follow-up Estágio ${targetStage}/3 enviado para ${resolvedPhone} (conversa ${flow.conversationId})`
        );
      } catch (flowErr: any) {
        console.error(`[SdrFollowupEngine] Erro ao processar conversa ${flow.conversationId}:`, flowErr?.message);
      }
    }
  }
}
