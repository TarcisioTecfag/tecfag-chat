/**
 * Trava cross-channel Site (`conv-lc-*`) × WhatsApp Oficial para o perfil industrial.
 *
 * Evita colisão simultânea de dois Fagner atendendo o mesmo cliente em paralelo
 * (caso real `Denise / DENTALNEWS`, 25/11/2026: cliente abriu o site e, minutos depois,
 * concluiu a triagem no WhatsApp enquanto o site continuou disparando respostas e follow-up).
 *
 * Regras:
 * - Isolamento estrito por `tenantId` (nunca mistura dados entre tenants; `valem` não usa).
 * - Considera apenas conversas oficiais de WhatsApp (`!isSiteConversationId`, `whatsappConnectionId IS NULL`)
 *   do MESMO `contactId` dentro do MESMO `tenantId`.
 */
import { and, desc, eq, isNull, ne, notLike } from "drizzle-orm";
import { agentFlowStates, conversations } from "../../db/schema";
import type { IndustrialDatabase } from "../triage/industrial-rodizio-store";
import { isSiteConversationId } from "./site-channel-policy";

export const SITE_CROSS_CHANNEL_WA_FLOW_WINDOW_MS = 4 * 60 * 60 * 1000; // 4h para triagem WA em andamento
export const SITE_CROSS_CHANNEL_WA_APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h para aprovação SDR pendente no WA
export const SITE_CROSS_CHANNEL_WA_HUMAN_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h para conversa ativa com humano no WA

export interface WhatsappPeerCandidate {
  conversationId: string;
  queueState: string | null;
  operatorId: string | null;
  lastMessageTime: Date | string | null;
  flow?: {
    id: string;
    outcome: string | null;
    completedAt: Date | string | null;
    lastInteractionAt: Date | string | null;
    currentStep?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
}

export interface SiteCrossChannelDecision {
  suppressed: boolean;
  reason:
    | "none"
    | "whatsapp_awaiting_approval"
    | "whatsapp_triage_in_progress"
    | "whatsapp_human_active";
  whatsappConversationId: string | null;
  whatsappLastActivityAt: string | null;
  /**
   * true quando a atividade no WhatsApp é mais recente do que a última mensagem do site
   * (ou se trata de ciclo de follow-up): encerra a sessão do site silenciosamente sem
   * disparar nova mensagem redundante no widget.
   */
  silentClose: boolean;
}

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Avaliador puro (sem IO) para decidir se uma sessão do Site (`conv-lc-*`) deve ser
 * pausada/encerrada porque o mesmo contato já possui atendimento ou triagem ativa no WhatsApp.
 */
export function evaluateSiteCrossChannelSuppression(params: {
  siteConversationId: string;
  now: Date;
  siteLatestClientMessageAt?: Date | string | null;
  whatsappPeers: ReadonlyArray<WhatsappPeerCandidate>;
}): SiteCrossChannelDecision {
  const empty: SiteCrossChannelDecision = {
    suppressed: false,
    reason: "none",
    whatsappConversationId: null,
    whatsappLastActivityAt: null,
    silentClose: false,
  };

  if (!isSiteConversationId(params.siteConversationId)) return empty;
  if (!params.whatsappPeers || params.whatsappPeers.length === 0) return empty;

  const nowMs = params.now.getTime();
  const siteClientMs = toMs(params.siteLatestClientMessageAt);

  for (const peer of params.whatsappPeers) {
    if (!peer.conversationId || isSiteConversationId(peer.conversationId)) continue;
    if (peer.queueState === "finalizados") continue;

    const flow = peer.flow || null;
    const flowMeta = (flow?.metadata || {}) as Record<string, unknown>;
    const flowLastMs = toMs(flow?.lastInteractionAt);
    const convLastMs = toMs(peer.lastMessageTime);
    const activityMs = Math.max(flowLastMs ?? 0, convLastMs ?? 0) || null;
    const activityIso = activityMs ? new Date(activityMs).toISOString() : null;

    // 1. WhatsApp já concluiu a triagem e está em `awaiting_approval` (Human-in-the-Loop)
    const isWaAwaitingApproval =
      flow &&
      flow.outcome === "in_progress" &&
      !flow.completedAt &&
      (flowMeta.handoffStatus === "awaiting_approval" || Boolean(flowMeta.pendingApproval));
    if (
      isWaAwaitingApproval &&
      activityMs !== null &&
      nowMs - activityMs <= SITE_CROSS_CHANNEL_WA_APPROVAL_WINDOW_MS
    ) {
      return {
        suppressed: true,
        reason: "whatsapp_awaiting_approval",
        whatsappConversationId: peer.conversationId,
        whatsappLastActivityAt: activityIso,
        silentClose: siteClientMs === null || activityMs >= siteClientMs,
      };
    }

    // 2. WhatsApp está em triagem ativa do Fagner nas últimas 4h
    const isWaInProgressTriage =
      peer.queueState === "automacao" &&
      !peer.operatorId &&
      flow &&
      flow.outcome === "in_progress" &&
      !flow.completedAt &&
      flowMeta.handoffStatus !== "resolved";
    if (
      isWaInProgressTriage &&
      activityMs !== null &&
      nowMs - activityMs <= SITE_CROSS_CHANNEL_WA_FLOW_WINDOW_MS
    ) {
      return {
        suppressed: true,
        reason: "whatsapp_triage_in_progress",
        whatsappConversationId: peer.conversationId,
        whatsappLastActivityAt: activityIso,
        silentClose: siteClientMs === null || activityMs >= siteClientMs,
      };
    }

    // 3. WhatsApp já está em atendimento humano ativo (`meus` + `operatorId`) nas últimas 2h
    if (
      peer.queueState === "meus" &&
      Boolean(peer.operatorId) &&
      activityMs !== null &&
      nowMs - activityMs <= SITE_CROSS_CHANNEL_WA_HUMAN_WINDOW_MS
    ) {
      return {
        suppressed: true,
        reason: "whatsapp_human_active",
        whatsappConversationId: peer.conversationId,
        whatsappLastActivityAt: activityIso,
        silentClose: siteClientMs === null || activityMs >= siteClientMs,
      };
    }
  }

  return empty;
}

/**
 * Consulta o banco (isolado por `tenantId`) para verificar se o contato da conversa do Site
 * já possui atendimento ou triagem ativa no canal oficial de WhatsApp.
 */
export async function findActiveWhatsappSessionForSiteContact(
  database: IndustrialDatabase,
  params: {
    tenantId: string;
    contactId: string | null | undefined;
    siteConversationId: string;
    siteLatestClientMessageAt?: Date | string | null;
    now?: Date;
  },
): Promise<SiteCrossChannelDecision> {
  const empty: SiteCrossChannelDecision = {
    suppressed: false,
    reason: "none",
    whatsappConversationId: null,
    whatsappLastActivityAt: null,
    silentClose: false,
  };

  if (!params.contactId || !isSiteConversationId(params.siteConversationId)) {
    return empty;
  }

  const waConvs = await database
    .select({
      id: conversations.id,
      queueState: conversations.queueState,
      operatorId: conversations.operatorId,
      lastMessageTime: conversations.lastMessageTime,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, params.tenantId),
        eq(conversations.contactId, params.contactId),
        ne(conversations.id, params.siteConversationId),
        notLike(conversations.id, "conv-lc-%"),
        isNull(conversations.whatsappConnectionId),
      ),
    )
    .orderBy(desc(conversations.lastMessageTime))
    .limit(3);

  if (waConvs.length === 0) return empty;

  const peers: WhatsappPeerCandidate[] = [];
  for (const waConv of waConvs) {
    const [latestFlow] = await database
      .select({
        id: agentFlowStates.id,
        outcome: agentFlowStates.outcome,
        completedAt: agentFlowStates.completedAt,
        lastInteractionAt: agentFlowStates.lastInteractionAt,
        currentStep: agentFlowStates.currentStep,
        metadata: agentFlowStates.metadata,
      })
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, params.tenantId),
          eq(agentFlowStates.conversationId, waConv.id),
          eq(agentFlowStates.agentType, "sdr"),
        ),
      )
      .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
      .limit(1);

    peers.push({
      conversationId: waConv.id,
      queueState: waConv.queueState,
      operatorId: waConv.operatorId,
      lastMessageTime: waConv.lastMessageTime,
      flow: latestFlow
        ? {
            id: latestFlow.id,
            outcome: latestFlow.outcome,
            completedAt: latestFlow.completedAt,
            lastInteractionAt: latestFlow.lastInteractionAt,
            currentStep: latestFlow.currentStep,
            metadata: (latestFlow.metadata as Record<string, unknown>) || null,
          }
        : null,
    });
  }

  return evaluateSiteCrossChannelSuppression({
    siteConversationId: params.siteConversationId,
    now: params.now || new Date(),
    siteLatestClientMessageAt: params.siteLatestClientMessageAt,
    whatsappPeers: peers,
  });
}
