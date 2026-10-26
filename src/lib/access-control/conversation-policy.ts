import type { ChatPermissions } from "../rbac";

export const CONVERSATION_QUEUES = ["meus", "fila", "automacao", "finalizados"] as const;
export const CONVERSATION_CHANNELS = ["whatsapp", "instagram", "messenger", "livechat"] as const;
export const QUEUE_PERMISSION = {
  meus: "canViewQueueMine", fila: "canViewQueueWaiting", automacao: "canViewQueueBot", finalizados: "canViewQueueClosed",
} as const;
export const OWN_CONVERSATIONS_PRESET = { restrictToOwnChats: true, canViewAllChats: false,
  canViewQueueMine: true, canViewQueueWaiting: false, canViewQueueBot: false, canViewQueueClosed: false } as const;
export interface ConversationPrincipal {
  tenantId: string;
  operator: { id: string; role?: string };
  permissions?: { views?: { chat?: boolean }; chat?: Partial<ChatPermissions> };
  accessGroup?: { allowedChannels?: unknown } | null;
}
export function conversationReadRules(session: ConversationPrincipal) {
  const permissions = session.permissions?.chat;
  const configuredChannels = session.accessGroup?.allowedChannels;
  const channels = configuredChannels === undefined ? [...CONVERSATION_CHANNELS] :
    Array.isArray(configuredChannels) ? CONVERSATION_CHANNELS.filter((channel) => configuredChannels.includes(channel)) : [];
  return {
    enabled: !!session.tenantId && !!session.operator?.id && session.permissions?.views?.chat === true,
    queues: CONVERSATION_QUEUES.filter((queue) => permissions?.[QUEUE_PERMISSION[queue]] === undefined || permissions?.[QUEUE_PERMISSION[queue]] === true),
    channels,
    ownOnly: permissions?.restrictToOwnChats !== undefined && permissions?.restrictToOwnChats !== false,
    others: permissions?.canViewAllChats === true,
  };
}
export function canReadConversation(session: ConversationPrincipal, resource: {
  tenantId: string; operatorId?: string | null; queueState: string; mainChannel?: string | null;
  whatsappConnectionId?: string | null; connectionOwnerOperatorId?: string | null;
}): boolean {
  const rules = conversationReadRules(session);
  if (!rules.enabled || resource.tenantId !== session.tenantId ||
      !rules.queues.includes(resource.queueState as typeof CONVERSATION_QUEUES[number]) ||
      !rules.channels.includes((resource.whatsappConnectionId ? "whatsapp" : resource.mainChannel ?? "whatsapp") as typeof CONVERSATION_CHANNELS[number])) return false;
  if (resource.whatsappConnectionId && session.operator.role !== "admin" && resource.connectionOwnerOperatorId !== session.operator.id) return false;
  if (rules.ownOnly) return resource.operatorId === session.operator.id;
  return rules.others || resource.operatorId === session.operator.id || resource.operatorId === null;
}
