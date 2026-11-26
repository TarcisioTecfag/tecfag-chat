import { and, desc, eq, inArray } from "drizzle-orm";
import { messages } from "../../db/schema";
import {
  isClientDecliningTriage,
  isPostCloseCourtesyOnlyMessage,
  type CollectedFields,
} from "./industrial-policy";

export interface IndustrialOutboundSample {
  senderType: string;
  senderName?: string | null;
  sentAt: Date | string;
  isInternalNote?: boolean | null;
}

/**
 * Identifica mensagens enviadas pelo próprio canal SDR interno (ex.: template Meta disparado
 * como "Fagner (SDR)" / "Valentina (SDR)" em `queueState = "automacao"` sem operador atribuído),
 * evitando falso bloqueio de `external_agent_active` quando salvas como `senderType = "agent"`.
 */
export function isOwnSdrOutboundSender(senderName?: string | null): boolean {
  const trimmed = String(senderName || "").trim();
  if (!trimmed) return false;
  return /\(\s*sdr\s*\)$/i.test(trimmed);
}

export interface IndustrialSdrGuardInput {
  queueState?: string | null;
  operatorId?: string | null;
  flowOutcome?: string | null;
  flowCurrentStep?: string | null;
  flowMetadata?: Record<string, unknown> | null;
  flowStartedAt?: Date | string | null;
  latestOutbound?: IndustrialOutboundSample | null;
  incomingText?: string | null;
  hasIncomingMedia?: boolean;
  now?: Date;
  externalAgentWindowMs?: number;
}

export interface IndustrialSdrGuardDecision {
  blocked: boolean;
  reason: string | null;
  reopenCompletedFlow?: boolean;
}

const REOPENABLE_COMPLETED_STEPS = new Set([
  "encerrado (sem interesse)",
  "concluído (informativo)",
  "concluido (informativo)",
]);

const IDENTITY_COLLECTED_KEYS = new Set([
  "NOME COMPLETO",
  "EMPRESA",
  "CNPJ OU CPF",
  "_KNOWN_COMPANY_CONFIRMED",
]);

/**
 * Verifica se um fluxo industrial recém-encerrado automaticamente pelo Fagner (sem transferência
 * nem intervenção humana) pode ser reaberto quando o cliente envia uma nova demanda real
 * (ex.: Reci disse "Não, obrigada" e segundos depois "aproveitando, ainda não recebi as seladoras").
 * Mensagens puramente de cortesia ("Obrigada!", "Ok", "Ah ta joia") NÃO reabrem o fluxo.
 */
export function isReopenableCompletedIndustrialFlow(
  input: Pick<
    IndustrialSdrGuardInput,
    | "queueState"
    | "operatorId"
    | "flowOutcome"
    | "flowCurrentStep"
    | "flowMetadata"
    | "incomingText"
    | "hasIncomingMedia"
  >,
): boolean {
  if (input.operatorId) return false;
  const queue = (input.queueState || "").trim().toLowerCase();
  if (queue !== "automacao") return false;
  if (input.flowOutcome !== "completed") return false;

  const meta = (input.flowMetadata || {}) as Record<string, unknown>;
  if (meta.dismissedBy || meta.pendingApproval || meta.handoffRequest) return false;
  if (meta.handoffStatus === "awaiting_approval") return false;

  const stepNorm = String(input.flowCurrentStep || "").trim().toLowerCase();
  const closedWithoutTransfer =
    meta.handoffStatus === "resolved" || REOPENABLE_COMPLETED_STEPS.has(stepNorm);
  if (!closedWithoutTransfer) return false;

  if (input.hasIncomingMedia) return true;
  const text = String(input.incomingText || "").trim();
  if (!text) return false;
  if (isPostCloseCourtesyOnlyMessage(text)) return false;
  if (isClientDecliningTriage(text)) return false;
  return true;
}

/**
 * Constrói o patch de reabertura limpa de um fluxo industrial encerrado sem transferência,
 * arquivando o ciclo anterior em `previousTriages`, preservando identidade já coletada e
 * limpando intenção/funil antigos para classificar a nova demanda do cliente do zero.
 */
export function buildIndustrialPostCloseReopenPatch(input: {
  collectedData?: CollectedFields | null;
  metadata?: Record<string, unknown> | null;
  currentStep?: string | null;
  completedAt?: Date | string | null;
  startedAt?: Date | string | null;
  now?: Date;
}): {
  collectedData: CollectedFields;
  metadata: Record<string, unknown>;
} {
  const now = input.now || new Date();
  const prevMeta = (input.metadata || {}) as Record<string, unknown>;
  const prevData = (input.collectedData || {}) as CollectedFields;

  const preservedData: CollectedFields = {};
  for (const [key, val] of Object.entries(prevData)) {
    if (IDENTITY_COLLECTED_KEYS.has(key) && val && typeof val === "object") {
      preservedData[key] = val;
    }
  }

  const prevTriages = Array.isArray(prevMeta.previousTriages) ? [...prevMeta.previousTriages] : [];
  prevTriages.push({
    cycleStartedAt:
      input.startedAt instanceof Date
        ? input.startedAt.toISOString()
        : input.startedAt || null,
    completedAt:
      input.completedAt instanceof Date
        ? input.completedAt.toISOString()
        : input.completedAt || now.toISOString(),
    outcome: "completed",
    currentStep: input.currentStep || "Encerrado (Sem interesse)",
    targetFunnel: prevMeta.targetFunnel || null,
    reopenedAt: now.toISOString(),
    reopenReason: "client_new_demand_after_close",
  });

  const nextMetadata: Record<string, unknown> = {
    ...prevMeta,
    previousTriages: prevTriages.slice(-10),
    funnelStage: "triagem",
    targetFunnel: null,
    subflow: null,
    needsReview: false,
    routeReason: null,
    missingFields: [],
    handoffStatus: "collecting",
    readyForHandoff: false,
    machineDecision: null,
    followUpStage: 0,
    greetingDone: true,
    assumePriorGreeting: true,
    reopenedFromCompletedAt: now.toISOString(),
  };

  // Nunca gravar null literal em JSONB para handoffRequest/pendingApproval (em PostgreSQL 'null'::jsonb IS NULL é FALSE).
  delete nextMetadata.handoffRequest;
  delete nextMetadata.handoffReceipt;
  delete nextMetadata.handoffOutbox;
  delete nextMetadata.pendingApproval;
  delete nextMetadata.turnRecoveryMessageId;
  delete nextMetadata.turnRecoveryAttempts;
  delete nextMetadata.turnRecoveryNextAttemptAt;
  delete nextMetadata.turnRecoveryEscalatedMessageId;
  delete nextMetadata.turnRecoveryEscalatedAt;
  delete nextMetadata.turnRecoveryEscalationReason;
  delete nextMetadata.metaWindowBlockedAt;
  delete nextMetadata.metaWindowBlockedMessageId;

  return {
    collectedData: preservedData,
    metadata: nextMetadata,
  };
}

/**
 * Calcula `startedAt` seguro ao reabrir um fluxo industrial encerrado:
 * considera o `sentAt` real persistido no banco (que a Meta trunca para segundos inteiros)
 * sem invadir o ciclo encerrado anterior quando possível.
 */
export function computeIndustrialReopenStartedAt(params: {
  batchEarliestMs: number;
  dbEarliestSentAtMs?: number | null;
  previousCompletedAt?: Date | string | null;
}): Date {
  const earliestMs =
    typeof params.dbEarliestSentAtMs === "number" && Number.isFinite(params.dbEarliestSentAtMs)
      ? Math.min(params.batchEarliestMs, params.dbEarliestSentAtMs)
      : params.batchEarliestMs;
  const prevCompletedMs = toMillis(params.previousCompletedAt);

  if (prevCompletedMs !== null) {
    if (earliestMs <= prevCompletedMs) {
      return new Date(earliestMs);
    }
    return new Date(Math.max(prevCompletedMs + 1, earliestMs - 5000));
  }

  return new Date(earliestMs - 5000);
}

const DEFAULT_EXTERNAL_AGENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function toMillis(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Regra estrita de posse da conversa para o perfil industrial (Fagner SDR):
 * - Só pode atuar quando `queueState === "automacao"` e `operatorId === null`.
 * - Nunca atua em `fila` (fila humana / agentes externos de campanha), `meus` ou `finalizados`.
 * - Nunca atua quando o fluxo já foi concluído, transferido, parado, pausado ou aguarda aprovação SDR.
 * - Nunca colide com um agente humano/externo (`senderType === "agent"`) que enviou a última
 *   mensagem de saída na conversa após o início do ciclo (ou nas últimas 24h sem ciclo ativo).
 */
export function evaluateIndustrialSdrOwnershipGuard(
  input: IndustrialSdrGuardInput,
): IndustrialSdrGuardDecision {
  if (input.operatorId) {
    return { blocked: true, reason: "operator_assigned" };
  }

  const queue = (input.queueState || "").trim().toLowerCase();
  if (queue !== "automacao") {
    return { blocked: true, reason: `non_automacao_queue:${queue || "unknown"}` };
  }

  let reopenCompletedFlow = false;
  if (input.flowOutcome === "completed") {
    if (isReopenableCompletedIndustrialFlow(input)) {
      reopenCompletedFlow = true;
    } else {
      return { blocked: true, reason: "flow_outcome:completed" };
    }
  } else if (
    input.flowOutcome === "transferred" ||
    input.flowOutcome === "stopped" ||
    input.flowOutcome === "paused"
  ) {
    return { blocked: true, reason: `flow_outcome:${input.flowOutcome}` };
  }

  const meta = input.flowMetadata || {};
  if (meta.handoffStatus === "awaiting_approval" || Boolean(meta.pendingApproval)) {
    return { blocked: true, reason: "awaiting_approval" };
  }

  const latest = input.latestOutbound;
  if (
    latest &&
    !latest.isInternalNote &&
    latest.senderType === "agent" &&
    !isOwnSdrOutboundSender(latest.senderName)
  ) {
    const nowMs = (input.now || new Date()).getTime();
    const sentMs = toMillis(latest.sentAt);
    const windowMs = input.externalAgentWindowMs ?? DEFAULT_EXTERNAL_AGENT_WINDOW_MS;
    const flowStartMs = toMillis(input.flowStartedAt);
    const withinWindow = sentMs !== null && nowMs - sentMs <= windowMs;
    const afterFlowStart = flowStartMs === null || (sentMs !== null && sentMs >= flowStartMs);
    if (withinWindow && afterFlowStart) {
      return { blocked: true, reason: "external_agent_active" };
    }
  }

  return reopenCompletedFlow
    ? { blocked: false, reason: null, reopenCompletedFlow: true }
    : { blocked: false, reason: null };
}

/**
 * Valida antes de cada envio (texto, áudio, imagem) se a conversa industrial ainda pertence
 * ao SDR (ou ao operador recém-alocado na transferência).
 */
export function isIndustrialOwnerStillValidForSend(params: {
  queueState?: string | null;
  operatorId?: string | null;
  expectedOperatorId?: string | null;
  allowSiteWhatsappClosing?: boolean;
}): boolean {
  const queue = (params.queueState || "").trim().toLowerCase();
  if (!queue || queue === "fila") return false;
  if (queue === "finalizados") {
    return Boolean(
      params.allowSiteWhatsappClosing &&
        !params.operatorId &&
        !params.expectedOperatorId,
    );
  }
  if ((params.operatorId || null) !== (params.expectedOperatorId || null)) return false;
  if (queue === "meus" && !params.expectedOperatorId) return false;
  if (!params.expectedOperatorId && queue !== "automacao") return false;
  return true;
}

/**
 * Busca a última mensagem de saída pública (agent ou bot) de uma conversa no tenant,
 * permitindo detectar atuação ativa de agente externo/humano antes de acionar o SDR.
 */
export async function fetchLatestPublicOutboundMessage(
  database: any,
  tenantId: string,
  conversationId: string,
): Promise<IndustrialOutboundSample | null> {
  const rows = await database
    .select({
      senderType: messages.senderType,
      senderName: messages.senderName,
      sentAt: messages.sentAt,
      isInternalNote: messages.isInternalNote,
    })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.conversationId, conversationId),
        eq(messages.isInternalNote, false),
        inArray(messages.senderType, ["agent", "bot"]),
      ),
    )
    .orderBy(desc(messages.sentAt))
    .limit(1);

  return rows[0] || null;
}
