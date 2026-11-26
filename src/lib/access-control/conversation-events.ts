import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { contacts, conversations } from "../../db/schema";
import { conversationReadCondition, requireConversationAccess } from "./conversation-access";
import type { AuthSessionContext } from "../auth-session";
import { canonicalJson } from "./group-settings";
import { canManageWhatsappConnection } from "./channel-permissions";

export function conversationAuthorizationRevision(session: AuthSessionContext): string {
  return canonicalJson({ tenantId: session.tenantId, operatorId: session.operator.id, groupId: session.operator.groupId,
    role: session.operator.role, permissions: session.permissions, channels: session.accessGroup?.allowedChannels });
}

/** Resolve against current server records; event owner/queue fields never grant authority. Unknown events are dropped. */
export async function filterConversationEvent(session: AuthSessionContext, event: any): Promise<Record<string, any> | null> {
  if (!event || typeof event !== "object" || (event.tenantId && event.tenantId !== session.tenantId) ||
      (event.message?.tenantId && event.message.tenantId !== session.tenantId)) return null;
  const permissions = session.permissions;
  if (event.type === "qr") return canManageWhatsappConnection(session) ? event : null;
  if (event.type === "status") {
    if (canManageWhatsappConnection(session)) return event;
    return permissions?.views?.chat === true ? { type: "status", status: event.status } : null;
  }
  if (event.type === "operator_ai_notification") {
    const rawMsg = event.message || event.notification;
    const isSupervisorWhisper =
      rawMsg?.metadata?.type === "supervisor_whisper" || rawMsg?.warningType === "whisper";
    const isLeadTransfer =
      !isSupervisorWhisper &&
      (rawMsg?.metadata?.type === "lead_transfer" || rawMsg?.warningType === "new_lead");
    const canReceiveOperatorAi =
      (permissions?.views?.chat === true || permissions?.views?.valentina === true) &&
      permissions?.valentina?.canAccessChat === true;
    const canReceiveLeadTransfer = isLeadTransfer && permissions?.views?.chat === true;
    if (event.operatorId !== session.operator.id || (!canReceiveOperatorAi && !canReceiveLeadTransfer)) {
      return null;
    }
    const conversationId =
      event.message?.warningMetadata?.conversationId ??
      event.notification?.warningMetadata?.conversationId ??
      (isLeadTransfer
        ? event.message?.metadata?.conversationId ??
          event.notification?.metadata?.conversationId ??
          event.message?.warningMetadata?.clientId ??
          event.notification?.warningMetadata?.clientId
        : undefined);
    if (conversationId && (await requireConversationAccess(session, conversationId))) {
      if (!isSupervisorWhisper) return null;
      // Sussurro direcionado explicitamente ao operador: entrega a orientação mesmo sem acesso direto à conversa,
      // removendo apenas o deep-link para a conversa restrita.
      const stripConv = (payload: any) =>
        payload && typeof payload === "object"
          ? {
              ...payload,
              metadata: payload.metadata
                ? { ...payload.metadata, conversationId: null, clientId: null }
                : payload.metadata,
              warningMetadata: payload.warningMetadata
                ? { ...payload.warningMetadata, conversationId: null, clientId: "" }
                : payload.warningMetadata,
            }
          : payload;
      return {
        ...event,
        message: stripConv(event.message),
        notification: stripConv(event.notification),
      };
    }
    return event;
  }
  if (event.type === "operator_whisper_acknowledged") {
    const isOwn = event.operatorId === session.operator.id;
    const isMonitorSupervisor =
      session.operator.role === "admin" || permissions?.views?.monitor === true;
    if (!isOwn && !isMonitorSupervisor) return null;
    return event;
  }
  if (event.type === "supervisor_attention_alert") {
    if (event.operatorId !== session.operator.id) return null;
    if (permissions?.views?.chat !== true) return null;
    const conversationId = event.alert?.conversationId;
    if (typeof conversationId !== "string" || !conversationId) return null;
    if (await requireConversationAccess(session, conversationId)) return null;
    return event;
  }
  if (event.type === "valentina_thought_progress") {
    if (event.operatorId !== session.operator.id) return null;
    return event;
  }
  if (event.type === "onboarding_updated") {
    if (event.operatorId && event.operatorId !== session.operator.id) return null;
    return { type: "onboarding_updated", operatorId: event.operatorId ?? session.operator.id };
  }
  if (event.type === "operators_updated") {
    return { type: "operators_updated" };
  }
  if (event.type === "sectors_updated") {
    return { type: "sectors_updated" };
  }
  if (permissions?.views?.chat !== true) return null;
  if (event.type === "connection_access_changed") return session.operator.role !== "admin" && event.groupId === session.operator.groupId ? { type: "access_changed" } : null;
  const byConversation: Record<string, unknown> = {
    message: event.message?.conversationId, chat_updated: event.chat?.id,
    queue_update: event.conversationId, sdr_flow_updated: event.conversationId,
    message_reaction: event.conversationId, message_status: event.conversationId, operator_typing: event.conversationId,
  };
  if (Object.hasOwn(byConversation, event.type)) {
    const id = byConversation[event.type];
    return typeof id === "string" && id && !await requireConversationAccess(session, id) ? event : null;
  }
  if (event.type === "contact_updated" || event.type === "contact_avatar") {
    const contactId = event.contactId ?? event.contact?.id;
    if (typeof contactId !== "string" || !contactId) return null;
    const [visible] = await db.select({ id: conversations.id }).from(conversations).where(and(
      eq(conversations.tenantId, session.tenantId), eq(conversations.contactId, contactId), conversationReadCondition(session),
    )).limit(1);
    return visible ? event : null;
  }
  if (event.type === "presence_update" && typeof event.id === "string") {
    if (typeof event.conversationId === "string") {
      if (await requireConversationAccess(session, event.conversationId)) return null;
      const state = event.presences?.[event.id];
      return state ? { type: "presence_update", id: event.id, conversationId: event.conversationId, presences: { [event.id]: state } } : null;
    }
    const [visible] = await db.select({ id: conversations.id }).from(conversations).innerJoin(contacts, and(
      eq(contacts.id, conversations.contactId), eq(contacts.tenantId, session.tenantId),
    )).where(and(eq(conversations.tenantId, session.tenantId), eq(contacts.whatsappJid, event.id), conversationReadCondition(session))).limit(1);
    if (!visible) return null;
    const state = event.presences?.[event.id];
    return state ? { type: "presence_update", id: event.id, presences: { [event.id]: state } } : null;
  }
  return null;
}
