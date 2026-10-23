export type DealContextState = {
  currentDealId: string | null;
  previousDealId: string | null;
  selectionRequired: boolean;
  version: number;
};

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
