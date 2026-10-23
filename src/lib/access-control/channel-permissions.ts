import { conversationReadRules } from "./conversation-policy";
import type { ConversationPrincipal } from "./conversation-policy";

export function canManageWhatsappConnection(session: { operator: { role: string }; permissions?: any }): boolean {
  return session.operator.role === "admin" && session.permissions?.views?.settings === true && session.permissions?.settings?.canManageWhatsapp === true;
}

/** Legacy site monitoring is a global snapshot. A narrower chat profile must not enter this transport. */
export function canMonitorAllSiteVisitors(session: ConversationPrincipal & { permissions?: any }): boolean {
  const rules = conversationReadRules(session);
  return rules.enabled && rules.others && !rules.ownOnly && rules.queues.length === 4 && rules.channels.includes("livechat") &&
    session.permissions?.views?.monitor === true && session.permissions?.monitor?.canAccessSiteVisitors === true;
}
