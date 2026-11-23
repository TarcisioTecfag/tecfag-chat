export type ConversationDealContextItem = {
  id: string;
  title: string;
  status?: string;
  pipelineId?: string | null;
  pipelineName?: string | null;
  stageId?: string | null;
  stageName?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
};

export type ConversationDealContext = {
  version: number;
  currentDeal: ConversationDealContextItem | null;
  previousDeal: ConversationDealContextItem | null;
  hasCurrentDeal: boolean;
  selectionRequired: boolean;
  gracePeriodActive?: boolean;
  graceDeal?: {
    id: string;
    title: string;
    status: string;
    closedAt?: string | Date | null;
    closedByOperatorId?: string | null;
  } | null;
  graceExpiresAt?: string | null;
  editable: boolean;
  contactId: string;
  deals: Array<{
    id: string;
    title: string;
    status: string;
    pipelineId?: string | null;
    pipelineName?: string | null;
    stageId?: string | null;
    stageName?: string | null;
    operatorId?: string | null;
    operatorName?: string | null;
    isLinked: boolean;
    closedAt?: string | Date | null;
    closedByOperatorId?: string | null;
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

const requirementKey = (
  conversationId: string,
  tenantId?: string | null,
  operatorId?: string | null,
) =>
  tenantId && operatorId
    ? JSON.stringify([tenantId, operatorId, conversationId])
    : conversationId;

export const cachedDealRequirement = (
  conversationId?: string | null,
  tenantId?: string | null,
  operatorId?: string | null,
) => {
  if (!conversationId) return undefined;
  return requirementCache.get(requirementKey(conversationId, tenantId, operatorId));
};

export function invalidateDealContextCache(conversationId?: string | null) {
  if (!conversationId) return;
  mutationEpoch.set(conversationId, (mutationEpoch.get(conversationId) || 0) + 1);
  inFlightRequirement.delete(conversationId);
  requirementCache.delete(conversationId);
  const keySuffix = `,${JSON.stringify(conversationId)}]`;
  for (const k of Array.from(requirementCache.keys())) {
    if (k === conversationId || k.endsWith(keySuffix)) {
      requirementCache.delete(k);
    }
  }
  for (const k of Array.from(inFlightRequirement.keys())) {
    if (k === conversationId || k.endsWith(keySuffix)) {
      inFlightRequirement.delete(k);
    }
  }
  for (const k of Array.from(cache.keys())) {
    if (k.endsWith(keySuffix)) {
      cache.delete(k);
    }
  }
  for (const k of Array.from(inFlightContext.keys())) {
    if (k.endsWith(keySuffix)) {
      inFlightContext.delete(k);
    }
  }
}

export function markConversationDealSatisfied(
  conversationId?: string | null,
  selectedDeal?: { id: string; title: string; status?: string; version?: number } | null,
) {
  if (!conversationId) return;
  mutationEpoch.set(conversationId, (mutationEpoch.get(conversationId) || 0) + 1);
  inFlightRequirement.delete(conversationId);
  const keySuffix = `,${JSON.stringify(conversationId)}]`;
  for (const k of Array.from(inFlightRequirement.keys())) {
    if (k === conversationId || k.endsWith(keySuffix)) {
      inFlightRequirement.delete(k);
    }
  }
  for (const k of inFlightContext.keys()) {
    if (k.endsWith(keySuffix)) {
      inFlightContext.delete(k);
    }
  }
  const satisfiedState: ConversationDealRequirementState = {
    id: conversationId,
    pending: false,
    currentRequired: false,
    error: "",
  };
  requirementCache.set(conversationId, satisfiedState);
  for (const k of Array.from(requirementCache.keys())) {
    if (k.endsWith(keySuffix)) {
      requirementCache.set(k, satisfiedState);
    }
  }
  if (selectedDeal?.id) {
    for (const [k, existing] of cache.entries()) {
      if (k.endsWith(keySuffix)) {
        cache.set(k, {
          ...existing,
          version:
            typeof selectedDeal.version === "number" && selectedDeal.version > existing.version
              ? selectedDeal.version
              : existing.version,
          currentDeal: {
            id: selectedDeal.id,
            title: selectedDeal.title,
            ...(selectedDeal.status ? { status: selectedDeal.status } : {}),
          },
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
      const reqKey = requirementKey(conversationId, tenantId, operatorId);
      if (resolved.hasCurrentDeal || resolved.gracePeriodActive) {
        requirementCache.set(reqKey, {
          id: conversationId,
          pending: false,
          currentRequired: false,
          gracePeriodActive: resolved.gracePeriodActive,
          error: "",
        });
      } else {
        requirementCache.delete(reqKey);
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
  tenantId?: string | null,
  operatorId?: string | null,
): Promise<ConversationDealRequirementState> {
  const reqKey = requirementKey(conversationId, tenantId, operatorId);
  const existingFlight = inFlightRequirement.get(reqKey);
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
      const existingReq = requirementCache.get(reqKey);
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
      requirementCache.set(reqKey, nextState);
      return nextState;
    } finally {
      if (inFlightRequirement.get(reqKey) === promise) {
        inFlightRequirement.delete(reqKey);
      }
    }
  })();

  inFlightRequirement.set(reqKey, promise);
  return promise;
}

