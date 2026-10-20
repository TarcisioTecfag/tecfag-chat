import { runtimeSingleton } from "../runtime-singleton";
import { db } from "../../db";
import { agentConfigs, agentFlowStates, conversations, messages, contacts } from "../../db/schema";
import { eq, and, asc, desc, gte, ne, isNull, sql } from "drizzle-orm";
import { vertexAi } from "../vertex-ai";
import { SessionManager, resolveRealJid } from "../baileys/session-manager";
import { resolveTenantActiveProvider, sendBotPresence, sendSdrChannelText } from "./sdr-channel-sender";
import { getAiPersona, isSdrTenant } from "../ai-persona";
import { SdrDebouncer } from "./sdr-debouncer";
import { ensureLocalCrmDealBeforeTransfer } from "./sdr-crm-local";
import {
  parseIndustrialScheduleConfig,
  isWithinIndustrialSchedule,
  parseIndustrialSilenceConfig,
  evaluateIndustrialSilence,
  buildIndustrialFollowUpText,
  deterministicIndustrialFollowUpMessageId,
  selectRecentCycleMessages,
} from "../triage/industrial-silence-policy";

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
    const scheduleCfg = parseIndustrialScheduleConfig(configData);
    const withinSchedule = isWithinIndustrialSchedule(now, scheduleCfg);
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

        const rawCycleMsgs = await db
          .select({
            id: messages.id,
            senderType: messages.senderType,
            sentAt: messages.sentAt,
            content: messages.content,
          })
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, tenantId),
              eq(messages.conversationId, flow.conversationId),
              ne(messages.content, "!reset"),
              ...(flow.startedAt ? [gte(messages.sentAt, flow.startedAt)] : []),
            ),
          )
          .orderBy(desc(messages.sentAt), desc(messages.id))
          .limit(40);

        const cycleMsgs = selectRecentCycleMessages(rawCycleMsgs, flow.startedAt || null, 40);
        const collectedData = (flow.collectedData as Record<string, any>) || {};
        const meta = (flow.metadata as Record<string, any>) || {};

        const decision = evaluateIndustrialSilence({
          now,
          withinSchedule,
          flow: {
            id: flow.id,
            tenantId,
            conversationId: flow.conversationId,
            startedAt: flow.startedAt,
            lastInteractionAt: flow.lastInteractionAt,
            outcome: flow.outcome,
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

        if (decision.action === "none") {
          continue;
        }

        if (decision.action === "cancel_by_human") {
          await db
            .update(agentFlowStates)
            .set({
              metadata: { ...meta, followUpStage: 0 },
              outcome: conv?.queueState === "meus" ? "transferred" : "abandoned",
              completedAt: now,
              lastInteractionAt: now,
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

        if (decision.action === "reset_followup") {
          const resetMeta = { ...meta, followUpStage: 0 };
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
        if (decision.rescuePartialLead) {
          try {
            await ensureLocalCrmDealBeforeTransfer({
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

        const cycleIso = flow.startedAt ? flow.startedAt.toISOString() : "cycle-0";

        if (decision.action === "send_followup" && (decision.nextStage === 1 || decision.nextStage === 2)) {
          const prevStage = Number(meta.followUpStage ?? 0);
          const nextMeta = {
            ...meta,
            followUpStage: decision.nextStage,
            lastFollowUpCycle: cycleIso,
            lastFollowUpStage: decision.nextStage,
            lastFollowUpAt: now.toISOString(),
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
                sql`COALESCE((${agentFlowStates.metadata}->>'followUpStage')::int, 0) = ${prevStage}`,
              ),
            )
            .returning({ id: agentFlowStates.id });

          if (claimed.length === 0) {
            continue;
          }

          const followUpText = buildIndustrialFollowUpText({
            personaName: persona.name,
            stage: decision.nextStage,
            collectedData,
            metadata: meta,
          });
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
              .where(and(eq(agentFlowStates.id, flow.id), eq(agentFlowStates.tenantId, tenantId)));
          }
          continue;
        }

        if (decision.action === "mark_no_response") {
          const currentFunnelStage =
            typeof meta.funnelStage === "string" && meta.funnelStage.trim()
              ? meta.funnelStage.trim()
              : "triagem";
          const preSilenceStage =
            currentFunnelStage !== "sem_resposta"
              ? currentFunnelStage
              : typeof meta.preSilenceFunnelStage === "string" && meta.preSilenceFunnelStage.trim()
                ? meta.preSilenceFunnelStage.trim()
                : "triagem";

          const abandonedMeta = {
            ...meta,
            followUpStage: 3,
            preSilenceFunnelStage: preSilenceStage,
            funnelStage: "sem_resposta",
            noResponseAt: now.toISOString(),
            noResponseReason: decision.reason,
            ...(partialLeadRescuedAt ? { partialLeadRescuedAt } : {}),
          };

          const updatedAbandoned = await db
            .update(agentFlowStates)
            .set({
              currentStep: "Sem Resposta",
              outcome: "abandoned",
              metadata: abandonedMeta,
              lastInteractionAt: now,
            })
            .where(
              and(
                eq(agentFlowStates.id, flow.id),
                eq(agentFlowStates.tenantId, tenantId),
                eq(agentFlowStates.outcome, "in_progress"),
                isNull(agentFlowStates.completedAt),
              ),
            )
            .returning({ id: agentFlowStates.id });

          if (updatedAbandoned.length > 0) {
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
