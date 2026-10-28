import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  agentConfigs,
  agentFlowStates,
  channelConfigs,
  conversations,
  contacts,
  messages,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { isSiteConversationId, parseSiteChannelSettings } from "../livechat/site-channel-policy";
import { getMetaServiceWindow } from "../whatsapp/meta-policy";
import {
  isWithinIndustrialSchedule,
  parseIndustrialScheduleConfig,
  parseIndustrialSilenceConfig,
} from "../triage/industrial-silence-policy";

export type IndustrialDeliveryContext = {
  flowId: string;
  cycle: string;
  triggerId?: string;
  triggerIds?: string[];
};
export type IndustrialDeliveryIdentity = IndustrialDeliveryContext & {
  version: 1;
  triggerId: string;
  outcome: string | null;
  operatorId: string | null;
  batchId: string;
  sequence: number;
  scheduleOnly: boolean;
  queueState: string;
  contactId: string;
};

/** Only server state authorizes automatic delivery, including recovery. */
export async function readIndustrialDeliveryContext(
  database: Pick<typeof db, "select">,
  tenantId: string,
  conversationId: string,
  operatorId: string | null,
) {
  if (getAiPersona(tenantId).triagePolicy !== "industrial") return null;
  const [config] = await database
    .select()
    .from(agentConfigs)
    .where(
      and(
        eq(agentConfigs.tenantId, tenantId),
        eq(agentConfigs.agentType, "sdr"),
        eq(agentConfigs.enabled, 1),
      ),
    )
    .limit(1);
  if (!config) return null;
  const [conversation] = await database
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
    .limit(1);
  if (
    !conversation ||
    conversation.whatsappConnectionId ||
    conversation.queueState === "finalizados" ||
    (conversation.operatorId || null) !== operatorId ||
    (conversation.queueState === "meus" && !operatorId)
  )
    return null;
  const [contact] = await database
    .select()
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, conversation.contactId)))
    .limit(1);
  if (!contact) return null;
  const [flow] = await database
    .select()
    .from(agentFlowStates)
    .where(
      and(
        eq(agentFlowStates.tenantId, tenantId),
        eq(agentFlowStates.conversationId, conversationId),
        eq(agentFlowStates.agentType, "sdr"),
      ),
    )
    .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
    .limit(1);
  const [trigger] = await database
    .select({ id: messages.id, sentAt: messages.sentAt })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.conversationId, conversationId),
        eq(messages.senderType, "client"),
        eq(messages.isInternalNote, false),
      ),
    )
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(1);
  if (
    !flow ||
    !trigger ||
    !["in_progress", "transferred", "completed"].includes(flow.outcome || "")
  )
    return null;
  const settings = (config.config || {}) as Record<string, unknown>;
  let provider: "livechat" | "meta" | "baileys";
  if (isSiteConversationId(conversationId)) {
    if (!parseSiteChannelSettings(true, settings).enabled) return null;
    provider = "livechat";
  } else {
    const [channel] = await database
      .select({ provider: channelConfigs.activeProvider })
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, tenantId))
      .limit(1);
    if (channel?.provider !== "meta" && channel?.provider !== "baileys") return null;
    provider = channel.provider;
  }
  return { conversation, contact, flow, trigger, settings, provider };
}

export async function validateIndustrialDelivery(
  message: typeof messages.$inferSelect,
  now = new Date(),
) {
  const identity = message.metaDetails.industrialDelivery as IndustrialDeliveryIdentity | undefined;
  if (
    !identity ||
    identity.version !== 1 ||
    !identity.triggerId ||
    !identity.batchId ||
    !Number.isInteger(identity.sequence)
  )
    return { decision: "cancel", reason: "Envio automático sem contexto recuperável." } as const;
  const context = await readIndustrialDeliveryContext(
    db,
    message.tenantId,
    message.conversationId,
    identity.operatorId,
  );
  if (
    !context ||
    context.provider !== message.provider ||
    context.flow.id !== identity.flowId ||
    context.flow.startedAt.toISOString() !== identity.cycle ||
    context.flow.outcome !== identity.outcome ||
    context.trigger.id !== identity.triggerId ||
    context.conversation.queueState !== identity.queueState ||
    context.contact.id !== identity.contactId ||
    (message.provider !== "livechat" &&
      (String(message.metaDetails.recipientPhone || "").replace(/\D/g, "") !==
        (context.contact.phone || "").replace(/\D/g, "") ||
        (message.metaDetails.recipientUserId || null) !== (context.contact.whatsappUserId || null)))
  )
    return {
      decision: "cancel",
      reason: "Contexto, ciclo, responsável ou canal da resposta automática mudou.",
    } as const;
  if (now.getTime() - message.sentAt.getTime() > 24 * 60 * 60_000)
    return { decision: "cancel", reason: "Resposta automática expirada; requer revisão." } as const;
  const [human] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, message.tenantId),
        eq(messages.conversationId, message.conversationId),
        eq(messages.senderType, "agent"),
        eq(messages.isInternalNote, false),
        gte(messages.sentAt, context.trigger.sentAt),
      ),
    )
    .limit(1);
  if (human)
    return {
      decision: "cancel",
      reason: "O operador já respondeu; resposta automática cancelada.",
    } as const;
  const predecessors = await db
    .select({ status: messages.status })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, message.tenantId),
        eq(messages.conversationId, message.conversationId),
        eq(messages.senderType, "bot"),
        sql`${messages.metaDetails}->'industrialDelivery'->>'triggerId' = ${identity.triggerId}`,
        sql`${messages.metaDetails}->'industrialDelivery'->>'cycle' = ${identity.cycle}`,
        lt(messages.sentAt, message.sentAt),
      ),
    )
    .orderBy(asc(messages.sentAt));
  if (predecessors.some((row) => ["failed", "unknown", "uncertain"].includes(row.status)))
    return {
      decision: "cancel",
      reason: "Fragmento anterior falhou ou tem resultado desconhecido; revise o lote.",
    } as const;
  if (predecessors.some((row) => !["accepted", "delivered", "read", "sent"].includes(row.status)))
    return { decision: "defer", reason: "Aguardando confirmação do fragmento anterior." } as const;
  if (
    (identity.scheduleOnly ||
      message.retryCount > 0 ||
      now.getTime() - message.sentAt.getTime() > 60_000) &&
    parseIndustrialSilenceConfig(context.settings).pauseOutsideSchedule &&
    !isWithinIndustrialSchedule(now, parseIndustrialScheduleConfig(context.settings))
  )
    return {
      decision: "defer",
      reason: "Recuperação automática aguardando expediente configurado.",
    } as const;
  if (
    message.provider === "meta" &&
    !(await getMetaServiceWindow(message.tenantId, message.conversationId, now)).open
  )
    return {
      decision: "cancel",
      reason: "Janela Meta encerrada; resposta automática não foi enviada.",
    } as const;
  return { decision: "send", reason: "" } as const;
}
