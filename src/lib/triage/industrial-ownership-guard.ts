import { and, desc, eq, inArray } from "drizzle-orm";
import { messages } from "../../db/schema";

export interface IndustrialOutboundSample {
  senderType: string;
  sentAt: Date | string;
  isInternalNote?: boolean | null;
}

export interface IndustrialSdrGuardInput {
  queueState?: string | null;
  operatorId?: string | null;
  flowOutcome?: string | null;
  flowMetadata?: Record<string, unknown> | null;
  flowStartedAt?: Date | string | null;
  latestOutbound?: IndustrialOutboundSample | null;
  now?: Date;
  externalAgentWindowMs?: number;
}

export interface IndustrialSdrGuardDecision {
  blocked: boolean;
  reason: string | null;
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

  if (
    input.flowOutcome === "completed" ||
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
  if (latest && !latest.isInternalNote && latest.senderType === "agent") {
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

  return { blocked: false, reason: null };
}

/**
 * Valida antes de cada envio (texto, áudio, imagem) se a conversa industrial ainda pertence
 * ao SDR (ou ao operador recém-alocado na transferência).
 */
export function isIndustrialOwnerStillValidForSend(params: {
  queueState?: string | null;
  operatorId?: string | null;
  expectedOperatorId?: string | null;
}): boolean {
  const queue = (params.queueState || "").trim().toLowerCase();
  if (!queue || queue === "finalizados" || queue === "fila") return false;
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
