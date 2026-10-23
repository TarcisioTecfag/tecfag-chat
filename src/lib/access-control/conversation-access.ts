import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { contacts, conversations } from "../../db/schema";
import { conversationReadRules } from "./conversation-policy";
import type { ConversationPrincipal } from "./conversation-policy";

/** Use in SQL before pagination/counting, including direct-ID queries. Never filter a fetched page. */
export function conversationReadCondition(session: ConversationPrincipal) {
  const rules = conversationReadRules(session);
  if (!rules.enabled || !rules.channels.length || !rules.queues.length) return sql`false`;
  return and(
    eq(conversations.tenantId, session.tenantId), inArray(conversations.queueState, rules.queues),
    rules.ownOnly ? eq(conversations.operatorId, session.operator.id) : !rules.others ?
      or(eq(conversations.operatorId, session.operator.id), isNull(conversations.operatorId)) : undefined,
    exists(db.select({ id: contacts.id }).from(contacts).where(and(
      eq(contacts.tenantId, session.tenantId), eq(contacts.id, conversations.contactId),
      inArray(sql<string>`coalesce(${contacts.mainChannel}, 'whatsapp')`, rules.channels),
    ))),
  )!;
}
export async function requireConversationAccess(session: ConversationPrincipal, conversationId: string): Promise<Response | null> {
  if (!conversationReadRules(session).enabled) return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
  const [row] = await db.select({ id: conversations.id }).from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, session.tenantId), conversationReadCondition(session))).limit(1);
  return row ? null : Response.json({ error: "Conversa não encontrada.", code: "NOT_FOUND" }, { status: 404 });
}
export async function requireConversationWriteAccess(session: ConversationPrincipal, conversationId: string): Promise<Response | null> {
  const denied = await requireConversationAccess(session, conversationId);
  if (denied) return denied;
  const [owned] = await db.select({ id: conversations.id }).from(conversations).where(and(
    eq(conversations.id, conversationId), eq(conversations.tenantId, session.tenantId),
    eq(conversations.operatorId, session.operator.id), eq(conversations.queueState, "meus"),
  )).limit(1);
  return owned ? null : Response.json({ error: "Capture o atendimento antes de responder.", code: "FORBIDDEN" }, { status: 403 });
}
