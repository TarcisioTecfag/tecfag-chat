export type DealContextState = {
  currentDealId: string | null;
  previousDealId: string | null;
  selectionRequired: boolean;
  version: number;
};

/**
 * Período de carência de 24 horas após uma negociação ser marcada como Vendida ('won') ou Perdida ('lost').
 * Durante essas 24 horas, o operador pode continuar conversando no chat correlacionado sem ser obrigado
 * a vincular ou selecionar outra negociação em andamento.
 */
export const DEAL_POST_CLOSE_GRACE_MS = 24 * 60 * 60 * 1000;

export function isDealWithinPostCloseGrace(
  deal: {
    status: string;
    isLinked?: boolean;
    closedAt?: string | Date | null;
  },
  nowMs: number = Date.now(),
): boolean {
  if (deal.isLinked === false) return false;
  if (deal.status !== "won" && deal.status !== "lost") return false;
  if (!deal.closedAt) return false;
  const closedTime = new Date(deal.closedAt).getTime();
  if (!Number.isFinite(closedTime) || closedTime <= 0) return false;
  const elapsed = nowMs - closedTime;
  return elapsed >= -60_000 && elapsed <= DEAL_POST_CLOSE_GRACE_MS;
}

export function getDealPostCloseGraceExpiresAt(
  deal:
    | {
        status: string;
        isLinked?: boolean;
        closedAt?: string | Date | null;
      }
    | null
    | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!deal || !isDealWithinPostCloseGrace(deal, nowMs)) return null;
  const closedTime = new Date(deal.closedAt!).getTime();
  return new Date(closedTime + DEAL_POST_CLOSE_GRACE_MS).toISOString();
}

export function findActiveGraceDeal<
  T extends {
    id: string;
    status: string;
    isLinked?: boolean;
    closedAt?: string | Date | null;
  },
>(
  deals: readonly T[],
  preferredDealIds: Array<string | null | undefined> = [],
  nowMs: number = Date.now(),
): T | null {
  for (const prefId of preferredDealIds) {
    if (!prefId) continue;
    const matched = deals.find((d) => d.id === prefId && isDealWithinPostCloseGrace(d, nowMs));
    if (matched) return matched;
  }
  const candidates = deals
    .filter((d) => isDealWithinPostCloseGrace(d, nowMs))
    .sort((a, b) => {
      const timeA = a.closedAt ? new Date(a.closedAt).getTime() || 0 : 0;
      const timeB = b.closedAt ? new Date(b.closedAt).getTime() || 0 : 0;
      return timeB - timeA || a.id.localeCompare(b.id);
    });
  return candidates[0] || null;
}

export function isCurrentDealEligible(deal: { status: string; isLinked?: boolean }) {
  return deal.status === "open" && deal.isLinked !== false;
}

export function sortContactDeals<
  T extends { id: string; status: string; createdAt?: string | Date },
>(deals: readonly T[]): T[] {
  return [...deals].sort((a, b) => {
    const statusOrder = Number(b.status === "open") - Number(a.status === "open");
    if (statusOrder) return statusOrder;
    const time = (value?: string | Date) => (value ? new Date(value).getTime() || 0 : 0);
    return time(b.createdAt) - time(a.createdAt) || a.id.localeCompare(b.id);
  });
}

/** A escolha anterior tem precedência; nunca promove outro card após conclusão. */
export function resolveDealSelection(
  state: DealContextState,
  openDealIds: string[],
): string | null {
  if (state.currentDealId)
    return openDealIds.includes(state.currentDealId) ? state.currentDealId : null;
  if (state.selectionRequired) return null;
  return openDealIds.length === 1 ? openDealIds[0] : null;
}

export class DealContextError extends Error {
  constructor(
    message: string,
    readonly code = "DEAL_CONTEXT_CHANGED",
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

export function assertDealContextVersion(state: DealContextState, expectedVersion: unknown) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== state.version) {
    throw new DealContextError(
      "A negociação deste atendimento mudou. Confira o destino e tente novamente.",
    );
  }
}
