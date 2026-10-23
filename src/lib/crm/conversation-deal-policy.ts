export type DealContextState = {
  currentDealId: string | null;
  previousDealId: string | null;
  selectionRequired: boolean;
  version: number;
};

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
