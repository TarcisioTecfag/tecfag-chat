export const LOSS_REASON_REQUIRED_CODE = "LOSS_REASON_REQUIRED";
export const LOSS_REASON_REQUIRED_MESSAGE =
  "Selecione o motivo de perda antes de marcar a negociação como perdida.";

export function normalizeLossReasonInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "__none__") return null;
  return trimmed;
}

export interface ResolveRequiredLossReasonInput {
  currentStatus?: string | null;
  currentLossReason?: string | null;
  nextStatus?: string | null;
  explicitStatus?: string | null;
  incomingLossReason?: unknown;
}

export type ResolveRequiredLossReasonResult =
  | { ok: true; lossReason: string | null | undefined }
  | { ok: false; error: string; code: string };

/**
 * Regra canônica de obrigatoriedade do motivo de perda:
 * - Toda transição para status "lost" (via botão "Marcar perda", mudança para etapa de perda
 *   ou ação em massa) exige um motivo de perda preenchido.
 * - Tentar limpar o motivo de perda enquanto a negociação permanece com status "lost" também é bloqueado.
 * - Edições em outros campos de uma negociação legada que já estava perdida (sem re-enviar status="lost"
 *   nem limpar lossReason) continuam permitidas.
 */
export function resolveRequiredLossReason(
  input: ResolveRequiredLossReasonInput,
): ResolveRequiredLossReasonResult {
  const hasIncomingLossReason = input.incomingLossReason !== undefined;
  const normalizedIncoming = hasIncomingLossReason
    ? normalizeLossReasonInput(input.incomingLossReason)
    : undefined;

  const finalStatus = input.nextStatus ?? input.currentStatus ?? "open";
  const enteringLost = input.nextStatus === "lost" && input.currentStatus !== "lost";
  const explicitlyMarkingLost = input.explicitStatus === "lost";
  const updatingLossReasonWhileLost = finalStatus === "lost" && hasIncomingLossReason;

  if (enteringLost || explicitlyMarkingLost || updatingLossReasonWhileLost) {
    const effectiveLossReason = hasIncomingLossReason
      ? normalizedIncoming ?? null
      : normalizeLossReasonInput(input.currentLossReason);

    if (!effectiveLossReason) {
      return {
        ok: false,
        error: LOSS_REASON_REQUIRED_MESSAGE,
        code: LOSS_REASON_REQUIRED_CODE,
      };
    }

    return {
      ok: true,
      lossReason: effectiveLossReason,
    };
  }

  return {
    ok: true,
    lossReason: normalizedIncoming,
  };
}
