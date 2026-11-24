import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  agentConfigs,
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
import { ensureLinkedDeviceConversationDeal, lockContactDeals } from "../crm/deal-associations";
import { setAttendanceActor } from "../attendance-events";
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
  input: {
    sourceConversationId: string;
    expectedVersion: number;
    connectionId: string | null;
    allowDisconnectedOwner?: boolean;
  },
) {
  const tenantId = session.tenantId;
  const master = session.operator.role === "admin";
  if (!multiConnectionEnabled(tenantId))
    fail("Múltiplas conexões não habilitadas.", "FEATURE_DISABLED");
  const rules = conversationReadRules(session);
  const [ownConnectedBaileys] = master
    ? []
    : await db
        .select({ id: whatsappConnections.id })
        .from(whatsappConnections)
        .where(
          and(
            eq(whatsappConnections.tenantId, tenantId),
            eq(whatsappConnections.ownerOperatorId, session.operator.id),
            eq(whatsappConnections.enabled, true),
            eq(whatsappConnections.baileysSessionStatus, "connected"),
            sql`${whatsappConnections.leaseUntil} > now()`,
          ),
        )
        .limit(1);
  const canSwitchOwnAttendance = master || Boolean(ownConnectedBaileys);
  let dedicatedRoutingActive = false;
  if (!master) {
    try {
      const [toggle] = await db
        .select({ enabled: agentConfigs.enabled })
        .from(agentConfigs)
        .where(
          and(
            eq(agentConfigs.tenantId, tenantId),
            eq(agentConfigs.agentType, "whatsapp_dedicated_routing"),
          ),
        )
        .limit(1);
      dedicatedRoutingActive = toggle?.enabled === 1;
    } catch (err: any) {
      const code = err?.code ?? err?.cause?.code;
      if (code !== "42P01") throw err;
    }
  }
  if (
    (session.permissions.chat.canCaptureChat !== true && !canSwitchOwnAttendance) ||
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
    const isOwnActiveAttendance =
      current.queueState === "meus" && current.operatorId === session.operator.id;
    if (
      current.queueState === "meus" &&
      !master &&
      !(canSwitchOwnAttendance && isOwnActiveAttendance)
    )
      fail("Finalize o atendimento antes de trocar o número.", "ATTENDANCE_NUMBER_LOCKED");
    if (
      current.queueState !== "finalizados" &&
      current.operatorId &&
      current.operatorId !== session.operator.id &&
      !master
    )
      fail("Este atendimento já tem um responsável.", "ATTENDANCE_NUMBER_LOCKED");
    const [contact] = await tx
      .select({ mainChannel: contacts.mainChannel })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, current.contactId)))
      .limit(1);
    const isEffectiveWhatsappChannel =
      !current.id.startsWith("conv-lc-") &&
      (Boolean(current.whatsappConnectionId) ||
        !contact?.mainChannel ||
        contact.mainChannel === "whatsapp" ||
        contact.mainChannel === "livechat");
    if (!contact || !isEffectiveWhatsappChannel)
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
      const isOwnEnabledConnection =
        Boolean(connection?.enabled) && connection?.ownerOperatorId === session.operator.id;
      const isLiveConnected =
        Boolean(connection?.enabled) &&
        connection?.status === "connected" &&
        Boolean(connection?.leaseUntil && connection.leaseUntil.getTime() > Date.now());
      if (!isLiveConnected && !(input.allowDisconnectedOwner && isOwnEnabledConnection))
        fail("Este número não está conectado. Atualize a lista.", "CONNECTION_UNAVAILABLE");
    } else {
      if (!master && dedicatedRoutingActive) {
        const [ownDedicated] = await tx
          .select({ id: whatsappConnections.id, name: whatsappConnections.name })
          .from(whatsappConnections)
          .where(
            and(
              eq(whatsappConnections.tenantId, tenantId),
              eq(whatsappConnections.ownerOperatorId, session.operator.id),
              eq(whatsappConnections.provider, "baileys"),
              eq(whatsappConnections.enabled, true),
            ),
          )
          .limit(1);
        if (ownDedicated) {
          fail(
            `Seu usuário opera exclusivamente pelo WhatsApp dedicado (${ownDedicated.name}).`,
            "DEDICATED_BAILEYS_ONLY",
            403,
          );
        }
      }
      const [corporate] = await tx
        .select({ status: channelConfigs.connectionStatus })
        .from(channelConfigs)
        .where(eq(channelConfigs.tenantId, tenantId))
        .limit(1);
      if (!corporate || corporate.status !== "connected")
        fail("O WhatsApp da empresa não está conectado.", "CONNECTION_UNAVAILABLE");
      if (
        (contact.mainChannel ?? "whatsapp") !== "whatsapp" &&
        contact.mainChannel !== "livechat"
      )
        fail("Use o atendimento do canal original deste contato.", "INVALID_CHANNEL", 400);
    }
    const allCandidates = await tx
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
    const candidates = current.contactPhoneId
      ? allCandidates.filter(
          (row) => !row.contactPhoneId || row.contactPhoneId === current.contactPhoneId,
        )
      : allCandidates;
    const activeConflict = candidates.some(
      (row) =>
        row.queueState === "meus" &&
        (!canSwitchOwnAttendance || (!master && row.operatorId !== session.operator.id)),
    );
    if (!master && activeConflict)
      fail(
        "Já existe um atendimento em andamento por este número. Finalize-o antes de preparar outro.",
        "TARGET_ATTENDANCE_ACTIVE",
      );
    const existing =
      (canSwitchOwnAttendance &&
        candidates.find(
          (row) =>
            row.queueState === "meus" && (master || row.operatorId === session.operator.id),
        )) ||
      candidates[0];
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
      if (!visible && !(isOwnActiveAttendance && !existing.operatorId))
        fail("Atendimento de destino não encontrado.", "NOT_FOUND", 404);
    }
    const reopen = existing?.queueState === "finalizados";
    const promoteWaitingToOwn =
      isOwnActiveAttendance && existing?.queueState === "fila" && !existing.operatorId;
    if (isOwnActiveAttendance) {
      if (!rules.queues.includes("meus"))
        fail(
          "Seu grupo precisa de acesso aos seus atendimentos para usar este número.",
          "FORBIDDEN",
          403,
        );
    } else if ((!existing || reopen) && (!rules.queues.includes("fila") || rules.ownOnly)) {
      fail(
        "Seu grupo precisa de acesso à fila de espera para preparar este atendimento.",
        "FORBIDDEN",
        403,
      );
    }
    const desiredQueueState = isOwnActiveAttendance ? "meus" : "fila";
    const desiredOperatorId = isOwnActiveAttendance ? session.operator.id : null;
    let target = existing;
    if (!existing) {
      await setAttendanceActor(tx, tenantId, session.operator.name, session.operator.id);
      [target] = await tx
        .insert(conversations)
        .values({
          id: randomUUID(),
          tenantId,
          contactId: current.contactId,
          contactPhoneId: current.contactPhoneId ?? null,
          contactPhone: current.contactPhone ?? null,
          whatsappConnectionId: input.connectionId,
          queueState: desiredQueueState,
          operatorId: desiredOperatorId,
          version: 1,
        })
        .returning();
    } else if (reopen || promoteWaitingToOwn) {
      await setAttendanceActor(tx, tenantId, session.operator.name, session.operator.id);
      [target] = await tx
        .update(conversations)
        .set({
          queueState: desiredQueueState,
          operatorId: desiredOperatorId,
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
    if (typeof ensureLinkedDeviceConversationDeal === "function") {
      await ensureLinkedDeviceConversationDeal(tx, {
        tenantId,
        conversationId: target.id,
        contactId: current.contactId,
        connectionId: input.connectionId,
        operatorId: session.operator.id,
        operatorName: session.operator.name,
      });
    }
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
        captured: target.queueState === "meus",
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
