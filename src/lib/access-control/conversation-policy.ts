import type { ChatPermissions } from "../rbac";

export const CONVERSATION_QUEUES = ["meus", "fila", "automacao", "finalizados"] as const;
export const CONVERSATION_CHANNELS = ["whatsapp", "instagram", "messenger", "livechat"] as const;
export const SITE_CONVERSATION_PREFIX = "conv-lc-";
export const QUEUE_PERMISSION = {
  meus: "canViewQueueMine", fila: "canViewQueueWaiting", automacao: "canViewQueueBot", finalizados: "canViewQueueClosed",
} as const;
export const OWN_CONVERSATIONS_PRESET = { restrictToOwnChats: true, canViewAllChats: false,
  canViewQueueMine: true, canViewQueueWaiting: false, canViewQueueBot: false, canViewQueueClosed: false } as const;
export interface ConversationPrincipal {
  tenantId: string;
  operator: { id: string; role?: string; groupId?: string | null };
  permissions?: { views?: { chat?: boolean }; chat?: Partial<ChatPermissions> };
  accessGroup?: { allowedChannels?: unknown } | null;
}

/**
 * Resolve o canal efetivo de uma conversa de forma idêntica ao roteamento operacional:
 * - Conversas `conv-lc-*` pertencem estritamente ao canal `"livechat"` (Site), mesmo que o contato já tenha migrado para WhatsApp.
 * - Conversas com `whatsappConnectionId` (Baileys dedicado) pertencem sempre a `"whatsapp"`.
 * - Conversas não-site (`id` presente e sem prefixo `conv-lc-`) de contatos criados no Site (`mainChannel = "livechat"`)
 *   são atendimentos de WhatsApp Oficial (Meta) e pertencem a `"whatsapp"`.
 */
export function resolveEffectiveConversationChannel(resource: {
  id?: string | null;
  whatsappConnectionId?: string | null;
  mainChannel?: string | null;
}): string {
  if (typeof resource.id === "string" && resource.id.startsWith(SITE_CONVERSATION_PREFIX)) {
    return "livechat";
  }
  if (resource.whatsappConnectionId) {
    return "whatsapp";
  }
  const contactChannel = resource.mainChannel ?? "whatsapp";
  if (typeof resource.id === "string" && resource.id.length > 0 && contactChannel === "livechat") {
    return "whatsapp";
  }
  return contactChannel;
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
  id?: string | null;
  tenantId: string; operatorId?: string | null; queueState: string; mainChannel?: string | null;
  whatsappConnectionId?: string | null; connectionOwnerOperatorId?: string | null; connectionCanRead?: boolean;
}): boolean {
  const rules = conversationReadRules(session);
  const effectiveChannel = resolveEffectiveConversationChannel(resource);
  if (!rules.enabled || resource.tenantId !== session.tenantId ||
      !rules.queues.includes(resource.queueState as typeof CONVERSATION_QUEUES[number]) ||
      !rules.channels.includes(effectiveChannel as typeof CONVERSATION_CHANNELS[number])) return false;
  if (resource.whatsappConnectionId && session.operator.role !== "admin" && resource.connectionOwnerOperatorId !== session.operator.id && resource.connectionCanRead !== true) return false;
  if (rules.ownOnly) return resource.operatorId === session.operator.id;
  return rules.others || resource.operatorId === session.operator.id || resource.operatorId === null;
}
