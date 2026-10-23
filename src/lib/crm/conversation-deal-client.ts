export type ConversationDealContext = {
  version: number;
  currentDeal: { id: string; title: string } | null;
  previousDeal: { id: string; title: string } | null;
  hasCurrentDeal: boolean;
  selectionRequired: boolean;
  editable: boolean;
  contactId: string;
  deals: Array<{ id: string; title: string; status: string; isLinked: boolean }>;
};

export type ConversationDealRequirementState = {
  id: string;
  pending: boolean;
  currentRequired: boolean;
  error: string;
};

const cache = new Map<string, ConversationDealContext>();
const inFlightContext = new Map<string, Promise<ConversationDealContext>>();
const requirementCache = new Map<string, ConversationDealRequirementState>();
const inFlightRequirement = new Map<string, Promise<ConversationDealRequirementState>>();

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

export function markConversationDealSatisfied(conversationId?: string | null) {
  if (!conversationId) return;
  requirementCache.set(conversationId, {
    id: conversationId,
    pending: false,
    currentRequired: false,
    error: "",
  });
}

export async function fetchDealContext(
  tenantId: string,
  operatorId: string,
  conversationId: string,
) {
  const k = key(tenantId, operatorId, conversationId);
  const existingFlight = inFlightContext.get(k);
  if (existingFlight) return existingFlight;

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
      const resolved = (
        previous && previous.version > data.version ? previous : data
      ) as ConversationDealContext;
      cache.set(k, resolved);
      if (resolved.hasCurrentDeal) {
        markConversationDealSatisfied(conversationId);
      }
      return resolved;
    } finally {
      inFlightContext.delete(k);
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
      const nextState: ConversationDealRequirementState = {
        id: conversationId,
        pending: data.dealRequired !== false || data.currentDealRequired === true,
        currentRequired: data.currentDealRequired === true,
        error: "",
      };
      requirementCache.set(conversationId, nextState);
      return nextState;
    } finally {
      inFlightRequirement.delete(conversationId);
    }
  })();

  inFlightRequirement.set(conversationId, promise);
  return promise;
}

