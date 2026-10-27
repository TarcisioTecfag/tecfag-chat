import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  channelConfigs,
  contacts,
  conversations,
  crmActionHistory,
  whatsappConnections,
  whatsappConnectionContacts,
} from "../../db/schema";
import type { AuthSessionContext } from "../auth-session";
import {
  conversationReadCondition,
  hasWhatsappConnectionAccess,
  requireConversationAccess,
} from "../access-control/conversation-access";
import { conversationReadRules } from "../access-control/conversation-policy";
import { lockContactDeals } from "../crm/deal-associations";
import { conversationConnectionCondition } from "./connections";
import { multiConnectionEnabled } from "./connection-policy";

export class WhatsappPreparationError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 409,
  ) {
    super(message);
  }
}
const fail = (message: string, code: string, status = 409): never => {
  throw new WhatsappPreparationError(message, code, status);
};

/** Saves an uncaptured thread for the chosen number. Never rewrites a thread's transport. */
export async function prepareWhatsappConversation(
  session: AuthSessionContext,
  input: { sourceConversationId: string; expectedVersion: number; connectionId: string | null },
) {
  const tenantId = session.tenantId;
  const master = session.operator.role === "admin";
  if (!multiConnectionEnabled(tenantId))
    fail("Múltiplas conexões não habilitadas.", "FEATURE_DISABLED");
  const rules = conversationReadRules(session);
  if (
    session.permissions.chat.canCaptureChat !== true ||
    !rules.enabled ||
    !rules.channels.includes("whatsapp")
  )
    fail("Sem permissão para preparar o atendimento.", "FORBIDDEN", 403);
  const denied = await requireConversationAccess(session, input.sourceConversationId);
  if (denied) fail("Atendimento não encontrado.", "NOT_FOUND", denied.status);
  if (
    input.connectionId &&
    !(await hasWhatsappConnectionAccess(session, input.connectionId, "send"))
  )
    fail("Sem permissão para enviar por este número.", "CONNECTION_SEND_FORBIDDEN", 403);
  const [source] = await db
    .select({ contactId: conversations.contactId })
    .from(conversations)
    .where(
      and(eq(conversations.tenantId, tenantId), eq(conversations.id, input.sourceConversationId)),
    )
    .limit(1);
  if (!source) fail("Atendimento não encontrado.", "NOT_FOUND", 404);

  return db.transaction(async (tx) => {
    await lockContactDeals(tx, tenantId, source.contactId);
    const [current] = await tx
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.tenantId, tenantId), eq(conversations.id, input.sourceConversationId)),
      )
      .for("update")
      .limit(1);
    if (!current || current.contactId !== source.contactId)
      fail("Atendimento alterado. Atualize a conversa.", "CONCURRENCY_CONFLICT");
    if (current.version !== input.expectedVersion)
      fail("O atendimento mudou. Atualize antes de escolher o número.", "CONCURRENCY_CONFLICT");
    if (current.queueState === "meus" && !master)
      fail("Finalize o atendimento antes de trocar o número.", "ATTENDANCE_NUMBER_LOCKED");
    if (current.queueState !== "finalizados" && current.operatorId && !master)
      fail("Este atendimento já tem um responsável.", "ATTENDANCE_NUMBER_LOCKED");
    const [contact] = await tx
      .select({ mainChannel: contacts.mainChannel })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, current.contactId)))
      .limit(1);
    if (
      !contact ||
      (!current.whatsappConnectionId && (contact.mainChannel ?? "whatsapp") !== "whatsapp")
    )
      fail("Este atendimento não pertence ao WhatsApp.", "INVALID_CHANNEL", 400);
    if (input.connectionId) {
      const [connection] = await tx
        .select({
          enabled: whatsappConnections.enabled,
          ownerOperatorId: whatsappConnections.ownerOperatorId,
          status: whatsappConnections.baileysSessionStatus,
          leaseUntil: whatsappConnections.leaseUntil,
        })
        .from(whatsappConnections)
        .where(
          and(
            eq(whatsappConnections.tenantId, tenantId),
            eq(whatsappConnections.id, input.connectionId),
          ),
        )
        .limit(1);
      if (connection && !master && connection.ownerOperatorId !== session.operator.id)
        fail("Somente o titular pode usar este número.", "CONNECTION_SEND_FORBIDDEN", 403);
      if (
        !connection?.enabled ||
        connection.status !== "connected" ||
        !connection.leaseUntil ||
        connection.leaseUntil.getTime() <= Date.now()
      )
        fail("Este número não está conectado. Atualize a lista.", "CONNECTION_UNAVAILABLE");
    } else {
      const [corporate] = await tx
        .select({ status: channelConfigs.connectionStatus })
        .from(channelConfigs)
        .where(eq(channelConfigs.tenantId, tenantId))
        .limit(1);
      if (!corporate || corporate.status !== "connected")
        fail("O WhatsApp da empresa não está conectado.", "CONNECTION_UNAVAILABLE");
      if ((contact.mainChannel ?? "whatsapp") !== "whatsapp")
        fail("Use o atendimento do canal original deste contato.", "INVALID_CHANNEL", 400);
    }
    const candidates = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.contactId, current.contactId),
          conversationConnectionCondition(input.connectionId),
        ),
      )
      .orderBy(desc(conversations.lastMessageTime), desc(conversations.id))
      .for("update");
    if (!master && candidates.some((row) => row.queueState === "meus"))
      fail(
        "Já existe um atendimento em andamento por este número. Finalize-o antes de preparar outro.",
        "TARGET_ATTENDANCE_ACTIVE",
      );
    const existing =
      (master && candidates.find((row) => row.queueState === "meus")) || candidates[0];
    if (existing) {
      const [visible] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.id, existing.id),
            conversationReadCondition(session),
          ),
        )
        .limit(1);
      if (!visible) fail("Atendimento de destino não encontrado.", "NOT_FOUND", 404);
    }
    const reopen = existing?.queueState === "finalizados";
    if ((!existing || reopen) && (!rules.queues.includes("fila") || rules.ownOnly))
      fail(
        "Seu grupo precisa de acesso à fila de espera para preparar este atendimento.",
        "FORBIDDEN",
        403,
      );
    let target = existing;
    if (!existing) {
      [target] = await tx
        .insert(conversations)
        .values({
          id: randomUUID(),
          tenantId,
          contactId: current.contactId,
          whatsappConnectionId: input.connectionId,
          queueState: "fila",
          operatorId: null,
          version: 1,
        })
        .returning();
    } else if (reopen) {
      [target] = await tx
        .update(conversations)
        .set({
          queueState: "fila",
          operatorId: null,
          version: sql`${conversations.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, existing.id)))
        .returning();
    }
    if (input.connectionId)
      await tx
        .insert(whatsappConnectionContacts)
        .values({
          id: randomUUID(),
          tenantId,
          connectionId: input.connectionId,
          contactId: current.contactId,
        })
        .onConflictDoNothing();
    await tx.insert(crmActionHistory).values({
      id: randomUUID(),
      tenantId,
      operatorId: session.operator.id,
      operatorName: session.operator.name,
      action: "prepare_whatsapp_attendance",
      entityType: "conversation",
      itemCount: 1,
      details: {
        sourceConversationId: current.id,
        conversationId: target.id,
        connectionId: input.connectionId,
        queueState: target.queueState,
        captured: false,
      },
    });
    return {
      conversationId: target.id,
      queueState: target.queueState,
      operatorId: target.operatorId,
      sectorId: target.sectorId,
      version: target.version,
    };
  });
}
