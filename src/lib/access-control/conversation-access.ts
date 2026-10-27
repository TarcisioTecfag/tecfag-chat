import { and, eq, exists, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  contacts,
  conversations,
  whatsappConnections,
  whatsappConnectionGroupAccess,
} from "../../db/schema";
import { conversationReadRules } from "./conversation-policy";
import type { ConversationPrincipal } from "./conversation-policy";

/** Groups may read history; only the linked owner or master may send. Existing chat limits still apply. */
export function whatsappConnectionAccessCondition(
  session: ConversationPrincipal,
  permission: "read" | "send" = "read",
) {
  return and(
    eq(whatsappConnections.tenantId, session.tenantId),
    session.operator.role === "admin"
      ? undefined
      : or(
          eq(whatsappConnections.ownerOperatorId, session.operator.id),
          permission === "read" && session.operator.groupId
            ? exists(
                db
                  .select({ id: whatsappConnectionGroupAccess.id })
                  .from(whatsappConnectionGroupAccess)
                  .where(
                    and(
                      eq(whatsappConnectionGroupAccess.tenantId, session.tenantId),
                      eq(whatsappConnectionGroupAccess.connectionId, whatsappConnections.id),
                      eq(whatsappConnectionGroupAccess.groupId, session.operator.groupId),
                      eq(whatsappConnectionGroupAccess.canRead, true),
                    ),
                  ),
              )
            : sql`false`,
        ),
  )!;
}

export async function hasWhatsappConnectionAccess(
  session: ConversationPrincipal,
  connectionId: string,
  permission: "read" | "send" = "read",
) {
  const [connection] = await db
    .select({ id: whatsappConnections.id })
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.id, connectionId),
        eq(whatsappConnections.tenantId, session.tenantId),
        whatsappConnectionAccessCondition(session, permission),
      ),
    )
    .limit(1);
  return !!connection;
}

/** Use in SQL before pagination/counting, including direct-ID queries. Never filter a fetched page. */
export function conversationReadCondition(session: ConversationPrincipal) {
  const rules = conversationReadRules(session);
  if (!rules.enabled || !rules.channels.length || !rules.queues.length) return sql`false`;
  return and(
    eq(conversations.tenantId, session.tenantId),
    inArray(conversations.queueState, rules.queues),
    or(
      isNull(conversations.whatsappConnectionId),
      exists(
        db
          .select({ id: whatsappConnections.id })
          .from(whatsappConnections)
          .where(
            and(
              eq(whatsappConnections.tenantId, session.tenantId),
              eq(whatsappConnections.id, conversations.whatsappConnectionId),
              whatsappConnectionAccessCondition(session),
            ),
          ),
      ),
    ),
    rules.ownOnly
      ? eq(conversations.operatorId, session.operator.id)
      : !rules.others
        ? or(eq(conversations.operatorId, session.operator.id), isNull(conversations.operatorId))
        : undefined,
    exists(
      db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, session.tenantId),
            eq(contacts.id, conversations.contactId),
            or(
              rules.channels.includes("whatsapp")
                ? isNotNull(conversations.whatsappConnectionId)
                : undefined,
              and(
                isNull(conversations.whatsappConnectionId),
                inArray(sql<string>`coalesce(${contacts.mainChannel}, 'whatsapp')`, rules.channels),
              ),
            ),
          ),
        ),
    ),
  )!;
}
export async function requireConversationAccess(
  session: ConversationPrincipal,
  conversationId: string,
): Promise<Response | null> {
  if (!conversationReadRules(session).enabled)
    return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.tenantId, session.tenantId),
        conversationReadCondition(session),
      ),
    )
    .limit(1);
  return row
    ? null
    : Response.json({ error: "Conversa não encontrada.", code: "NOT_FOUND" }, { status: 404 });
}
export async function requireConversationSendAccess(
  session: ConversationPrincipal,
  conversationId: string,
): Promise<Response | null> {
  const denied = await requireConversationAccess(session, conversationId);
  if (denied) return denied;
  const [allowed] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.tenantId, session.tenantId),
        or(
          isNull(conversations.whatsappConnectionId),
          exists(
            db
              .select({ id: whatsappConnections.id })
              .from(whatsappConnections)
              .where(
                and(
                  eq(whatsappConnections.tenantId, session.tenantId),
                  eq(whatsappConnections.id, conversations.whatsappConnectionId),
                  whatsappConnectionAccessCondition(session, "send"),
                ),
              ),
          ),
        ),
      ),
    )
    .limit(1);
  return allowed
    ? null
    : Response.json(
        {
          error:
            "Somente o titular do celular ou administrador master pode enviar por este número.",
          code: "CONNECTION_SEND_FORBIDDEN",
        },
        { status: 403 },
      );
}
export async function requireConversationWriteAccess(
  session: ConversationPrincipal,
  conversationId: string,
): Promise<Response | null> {
  const denied = await requireConversationSendAccess(session, conversationId);
  if (denied) return denied;
  const [owned] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.tenantId, session.tenantId),
        eq(conversations.operatorId, session.operator.id),
        eq(conversations.queueState, "meus"),
      ),
    )
    .limit(1);
  return owned
    ? null
    : Response.json(
        { error: "Capture o atendimento antes de responder.", code: "FORBIDDEN" },
        { status: 403 },
      );
}
