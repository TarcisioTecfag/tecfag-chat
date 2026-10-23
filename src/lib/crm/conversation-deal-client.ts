export type ConversationDealContext = {
  version: number;
  currentDeal: { id: string; title: string } | null;
  previousDeal: { id: string; title: string } | null;
  hasCurrentDeal: boolean;
  selectionRequired: boolean;
  editable: boolean;
  deals: Array<{ id: string; title: string }>;
};
const cache = new Map<string, ConversationDealContext>();
const key = (tenantId: string, operatorId: string, conversationId: string) =>
  JSON.stringify([tenantId, operatorId, conversationId]);
export const cachedDealContext = (tenantId: string, operatorId: string, conversationId: string) =>
  cache.get(key(tenantId, operatorId, conversationId));
export async function fetchDealContext(
  tenantId: string,
  operatorId: string,
  conversationId: string,
) {
  const res = await fetch(`/api/chats/${encodeURIComponent(conversationId)}/deal-context`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error || "Não foi possível carregar a negociação do atendimento.");
  const previous = cachedDealContext(tenantId, operatorId, conversationId);
  if (previous && previous.version > data.version) return previous;
  cache.set(key(tenantId, operatorId, conversationId), data);
  return data as ConversationDealContext;
}
