export type ConversationDealContext = {
  version: number;
  currentDeal: { id: string; title: string } | null;
  previousDeal: { id: string; title: string } | null;
  hasCurrentDeal: boolean;
  selectionRequired: boolean;
  gracePeriodActive?: boolean;
  graceDeal?: {
    id: string;
    title: string;
    status: string;
    closedAt?: string | Date | null;
  } | null;
  graceExpiresAt?: string | null;
  editable: boolean;
  contactId: string;
  deals: Array<{
    id: string;
    title: string;
    status: string;
    isLinked: boolean;
    closedAt?: string | Date | null;
  }>;
};

export type ConversationDealRequirementState = {
  id: string;
  pending: boolean;
  currentRequired: boolean;
  gracePeriodActive?: boolean;
  error: string;
};

const cache = new Map<string, ConversationDealContext>();
const inFlightContext = new Map<string, Promise<ConversationDealContext>>();
const requirementCache = new Map<string, ConversationDealRequirementState>();
const inFlightRequirement = new Map<string, Promise<ConversationDealRequirementState>>();
const mutationEpoch = new Map<string, number>();

const key = (tenantId: string, operatorId: string, conversationId: string) =>
  JSON.stringify([tenantId, operatorId, conversationId]);

export const cachedDealContext = (
  tenantId?: string | null,
  operatorId?: string | null,
  conversationId?: string | null,
) => {
  if (!tenantId || !operatorId || !conversationId) return undefined;
  return cache.get(key(tenantId, operatorId, conversationId));
};

export const cachedDealRequirement = (conversationId?: string | null) => {
  if (!conversationId) return undefined;
  return requirementCache.get(conversationId);
};

export function markConversationDealSatisfied(
  conversationId?: string | null,
  selectedDeal?: { id: string; title: string; version?: number } | null,
) {
  if (!conversationId) return;
  mutationEpoch.set(conversationId, (mutationEpoch.get(conversationId) || 0) + 1);
  inFlightRequirement.delete(conversationId);
  const keySuffix = `,${JSON.stringify(conversationId)}]`;
  for (const k of inFlightContext.keys()) {
    if (k.endsWith(keySuffix)) {
      inFlightContext.delete(k);
    }
  }
  requirementCache.set(conversationId, {
    id: conversationId,
    pending: false,
    currentRequired: false,
    error: "",
  });
  if (selectedDeal?.id) {
    for (const [k, existing] of cache.entries()) {
      if (k.endsWith(keySuffix)) {
        cache.set(k, {
          ...existing,
          version:
            typeof selectedDeal.version === "number" && selectedDeal.version > existing.version
              ? selectedDeal.version
              : existing.version,
          currentDeal: { id: selectedDeal.id, title: selectedDeal.title },
          hasCurrentDeal: true,
          selectionRequired: false,
        });
      }
    }
  }
}

export async function fetchDealContext(
  tenantId: string,
  operatorId: string,
  conversationId: string,
) {
  const k = key(tenantId, operatorId, conversationId);
  const existingFlight = inFlightContext.get(k);
  if (existingFlight) return existingFlight;

  const startEpoch = mutationEpoch.get(conversationId) || 0;
  const promise = (async () => {
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(conversationId)}/deal-context`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Não foi possível carregar a negociação do atendimento.");
      const previous = cachedDealContext(tenantId, operatorId, conversationId);
      const currentEpoch = mutationEpoch.get(conversationId) || 0;
      const resolved = (
        previous &&
        (previous.version > data.version ||
          (currentEpoch !== startEpoch && previous.hasCurrentDeal && !data.hasCurrentDeal))
          ? previous
          : data
      ) as ConversationDealContext;
      cache.set(k, resolved);
      if (resolved.hasCurrentDeal || resolved.gracePeriodActive) {
        requirementCache.set(conversationId, {
          id: conversationId,
          pending: false,
          currentRequired: false,
          gracePeriodActive: resolved.gracePeriodActive,
          error: "",
        });
      }
      return resolved;
    } finally {
      if (inFlightContext.get(k) === promise) {
        inFlightContext.delete(k);
      }
    }
  })();

  inFlightContext.set(k, promise);
  return promise;
}

export async function fetchDealRequirement(
  conversationId: string,
): Promise<ConversationDealRequirementState> {
  const existingFlight = inFlightRequirement.get(conversationId);
  if (existingFlight) return existingFlight;

  const startEpoch = mutationEpoch.get(conversationId) || 0;
  const promise = (async () => {
    try {
      const res = await fetch(
        `/api/chats/${encodeURIComponent(conversationId)}/deals?statusOnly=1`,
        {
          credentials: "include",
          cache: "no-store",
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Não foi possível verificar a negociação.");
      const currentEpoch = mutationEpoch.get(conversationId) || 0;
      const existingReq = requirementCache.get(conversationId);
      if (currentEpoch !== startEpoch && existingReq && !existingReq.pending) {
        return existingReq;
      }
      const inGrace = data.gracePeriodActive === true;
      const nextState: ConversationDealRequirementState = {
        id: conversationId,
        pending: inGrace ? false : data.dealRequired !== false || data.currentDealRequired === true,
        currentRequired: inGrace ? false : data.currentDealRequired === true,
        gracePeriodActive: inGrace,
        error: "",
      };
      requirementCache.set(conversationId, nextState);
      return nextState;
    } finally {
      if (inFlightRequirement.get(conversationId) === promise) {
        inFlightRequirement.delete(conversationId);
      }
    }
  })();

  inFlightRequirement.set(conversationId, promise);
  return promise;
}

