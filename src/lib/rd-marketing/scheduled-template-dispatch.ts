import crypto from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, notLike, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  agentFlowStates,
  contacts,
  conversations,
  crmConversationDeals,
  crmDeals,
  messages,
  metaMessageTemplates,
  operators,
  rdMarketingFlows,
  rdMarketingLogs,
  rdMarketingScheduledTemplates,
  tenants,
} from "../../db/schema";
import { CrmError } from "../crm/crm-service";
import { normalizeCanonicalPhone } from "../utils";
import { DEFAULT_RD_TEMPLATE_DELAY_MINUTES, resolveFlowTemplateDelay } from "./mapping";
import {
  dispatchRdSdrTemplatePostCommit,
  HUMAN_ACTIVE_CONVERSATION_WINDOW_MS,
  resolveApprovedRdTemplate,
  type RdTemplateDispatchJob,
  type RdTemplateDispatchResult,
} from "./sdr-template-dispatch";

export const PRE_WEBHOOK_CLIENT_MESSAGE_LOOKBACK_MS = 15 * 60 * 1000;
export const ACTIVE_NON_MEUS_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SCHEDULED_TEMPLATE_LEASE_MS = 2 * 60 * 1000;
export const MAX_SCHEDULED_TEMPLATE_ATTEMPTS = 3;

export type RdTemplateDispatcherFn = (
  job: RdTemplateDispatchJob,
) => Promise<RdTemplateDispatchResult>;

export type ScheduledTemplateRow = typeof rdMarketingScheduledTemplates.$inferSelect;

export type WhatsappActivityBlockReason =
  | "client_messaged_during_delay"
  | "client_messaged_before_webhook"
  | "wallet_protected"
  | "active_human_conversation"
  | "active_automacao_conversation"
  | "active_queue_conversation";

export interface WhatsappActivityConversationSample {
  id: string;
  queueState: string | null;
  operatorId: string | null;
  whatsappConnectionId: string | null;
  latestRealMessageAt: Date | null;
  activeSdrFlowLastInteractionAt: Date | null;
}

export interface WhatsappActivityEvaluationInput {
  triggeredAt: Date;
  now: Date;
  walletOperatorId?: string | null;
  operatorNamesById?: Record<string, string | null | undefined>;
  latestClientMessage?: {
    conversationId: string;
    sentAt: Date;
  } | null;
  conversations: WhatsappActivityConversationSample[];
  preWebhookLookbackMs?: number;
  humanActiveWindowMs?: number;
  nonMeusActiveWindowMs?: number;
}

export interface WhatsappActivityBlockDecision {
  blocked: boolean;
  reason?: WhatsappActivityBlockReason;
  conversationId?: string;
  operatorName?: string | null;
}

/**
 * Formata horário em BRT (America/Sao_Paulo) como HH:mm para logs amigáveis.
 */
export function formatBrtClockTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

/**
 * Regra pura de avaliação de atividade WhatsApp que cancela o disparo atrasado de template:
 * 1) Cliente enviou mensagem no WhatsApp durante a janela OU nos 15 min anteriores ao webhook;
 * 2) Contato já possui conversa WhatsApp ativa (excluindo `finalizados` e chats vazios sem mensagens reais):
 *    - `meus` com mensagem real nos últimos 7 dias (proteção humana / carteira ativa);
 *    - `automacao` com mensagem real nas últimas 24h (ou fluxo SDR ativo nas últimas 24h com msg real);
 *    - `fila` com mensagem real nas últimas 24h.
 */
export function evaluateWhatsappActivityBlock(
  input: WhatsappActivityEvaluationInput,
): WhatsappActivityBlockDecision {
  const preWebhookLookbackMs =
    input.preWebhookLookbackMs ?? PRE_WEBHOOK_CLIENT_MESSAGE_LOOKBACK_MS;
  const humanActiveWindowMs = input.humanActiveWindowMs ?? HUMAN_ACTIVE_CONVERSATION_WINDOW_MS;
  const nonMeusActiveWindowMs =
    input.nonMeusActiveWindowMs ?? ACTIVE_NON_MEUS_CONVERSATION_WINDOW_MS;

  const triggeredMs = input.triggeredAt.getTime();
  const nowMs = input.now.getTime();
  const lookbackCutoffMs = triggeredMs - preWebhookLookbackMs;

  if (input.latestClientMessage) {
    const clientMsgMs = input.latestClientMessage.sentAt.getTime();
    if (Number.isFinite(clientMsgMs) && clientMsgMs >= lookbackCutoffMs) {
      return {
        blocked: true,
        reason:
          clientMsgMs >= triggeredMs
            ? "client_messaged_during_delay"
            : "client_messaged_before_webhook",
        conversationId: input.latestClientMessage.conversationId,
      };
    }
  }

  const humanCutoffMs = nowMs - humanActiveWindowMs;
  const nonMeusCutoffMs = nowMs - nonMeusActiveWindowMs;

  for (const conv of input.conversations) {
    const queue = (conv.queueState || "").trim().toLowerCase();
    if (!queue || queue === "finalizados") continue;

    // Chats abertos vazios (ex.: operador abriu chat pelo CRM mas sem nenhuma msg real) NÃO bloqueiam.
    const latestRealMs = conv.latestRealMessageAt ? conv.latestRealMessageAt.getTime() : NaN;
    if (!Number.isFinite(latestRealMs)) continue;

    if (queue === "meus" && latestRealMs >= humanCutoffMs) {
      const opId = conv.operatorId || input.walletOperatorId || null;
      const operatorName = opId ? (input.operatorNamesById?.[opId] ?? null) : null;
      return {
        blocked: true,
        reason: input.walletOperatorId ? "wallet_protected" : "active_human_conversation",
        conversationId: conv.id,
        operatorName,
      };
    }

    if (queue === "automacao") {
      const flowMs = conv.activeSdrFlowLastInteractionAt
        ? conv.activeSdrFlowLastInteractionAt.getTime()
        : NaN;
      if (latestRealMs >= nonMeusCutoffMs || (Number.isFinite(flowMs) && flowMs >= nonMeusCutoffMs)) {
        return {
          blocked: true,
          reason: "active_automacao_conversation",
          conversationId: conv.id,
        };
      }
    }

    if (queue === "fila" && latestRealMs >= nonMeusCutoffMs) {
      return {
        blocked: true,
        reason: "active_queue_conversation",
        conversationId: conv.id,
      };
    }
  }

  return { blocked: false };
}

export function describeScheduledTemplateCancelReason(
  reason: string,
  ctx?: {
    templateLabel?: string | null;
    delayMinutes?: number;
    operatorName?: string | null;
  },
): string {
  const tplPrefix = ctx?.templateLabel ? `Template '${ctx.templateLabel}'` : "Template agendado";
  const delaySuffix = ctx?.delayMinutes ? ` de ${ctx.delayMinutes} min` : "";
  const ownerLabel = ctx?.operatorName ? ` (${ctx.operatorName})` : "";

  switch (reason) {
    case "client_messaged_during_delay":
      return `${tplPrefix} cancelado automaticamente: cliente enviou mensagem no WhatsApp antes do prazo${delaySuffix}.`;
    case "client_messaged_before_webhook":
      return `${tplPrefix} cancelado automaticamente: cliente já havia enviado mensagem no WhatsApp pouco antes da chegada do webhook.`;
    case "wallet_protected":
      return `${tplPrefix} cancelado automaticamente: contato pertence à carteira ativa${ownerLabel} com conversa recente em Meus.`;
    case "active_human_conversation":
      return `${tplPrefix} cancelado automaticamente: contato já possui atendimento humano ativo em Meus${ownerLabel}.`;
    case "active_automacao_conversation":
      return `${tplPrefix} cancelado automaticamente: contato já possui triagem ativa em Automação.`;
    case "active_queue_conversation":
      return `${tplPrefix} cancelado automaticamente: contato já possui conversa ativa aguardando na Fila.`;
    case "replaced_by_newer_flow":
      return `${tplPrefix} substituído por acionamento mais recente do mesmo contato (cronômetro reiniciado).`;
    case "flow_disabled_or_deleted":
      return `${tplPrefix} cancelado: o fluxo foi pausado ou removido antes do horário previsto.`;
    case "flow_template_removed":
      return `${tplPrefix} cancelado: o template foi removido das configurações do fluxo antes do envio.`;
    case "cancelled_by_operator":
      return ctx?.operatorName
        ? `${tplPrefix} cancelado manualmente por ${ctx.operatorName}.`
        : `${tplPrefix} cancelado manualmente pelo operador.`;
    default:
      return `${tplPrefix} cancelado (${reason}).`;
  }
}

const PERMANENT_DISPATCH_BLOCK_REASONS = new Set([
  "sdr_disabled",
  "contact_not_found",
  "missing_phone",
  "template_not_found",
  "wallet_protected",
  "active_human_conversation",
]);

async function resolveFriendlyTemplateName(
  tenantId: string,
  whatsappTemplateId: string,
  flowId?: string | null,
): Promise<string> {
  const cleanKey = whatsappTemplateId.trim();
  if (!cleanKey) return whatsappTemplateId;
  try {
    const resolved = await resolveApprovedRdTemplate(tenantId, cleanKey, {
      flowId,
      persistAutoHeal: false,
    });
    if (resolved.template?.name) return resolved.template.name;
    if (resolved.staleRecord?.name) return resolved.staleRecord.name;
  } catch {
    // Fallback para o ID configurado
  }
  return cleanKey;
}

/**
 * Consulta o banco (estritamente isolado por `tenantId`) para verificar se o contato
 * já enviou mensagem no WhatsApp ou possui conversa WhatsApp ativa que bloqueia o disparo.
 */
export async function checkContactHasBlockingWhatsappActivity(
  tenantId: string,
  contactId: string,
  opts: { triggeredAt: Date; now?: Date },
): Promise<WhatsappActivityBlockDecision> {
  const now = opts.now ?? new Date();
  const [contactRow, waConvs] = await Promise.all([
    db
      .select({
        id: contacts.id,
        walletOperatorId: contacts.walletOperatorId,
      })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
      .limit(1)
      .then((rows) => rows[0] || null),
    db
      .select({
        id: conversations.id,
        queueState: conversations.queueState,
        operatorId: conversations.operatorId,
        whatsappConnectionId: conversations.whatsappConnectionId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.contactId, contactId),
          notLike(conversations.id, "conv-lc-%"),
          notLike(conversations.id, "site-%"),
        ),
      ),
  ]);

  if (waConvs.length === 0) {
    return { blocked: false };
  }

  const convIds = waConvs.map((c) => c.id);
  const lookbackCutoff = new Date(
    opts.triggeredAt.getTime() - PRE_WEBHOOK_CLIENT_MESSAGE_LOOKBACK_MS,
  );

  const nonFinalizedIds = waConvs
    .filter((c) => (c.queueState || "").trim().toLowerCase() !== "finalizados")
    .map((c) => c.id);

  const operatorIdsToLoad = Array.from(
    new Set(
      [
        contactRow?.walletOperatorId,
        ...waConvs.map((c) => c.operatorId),
      ].filter((id): id is string => Boolean(id)),
    ),
  );

  const [latestClientRows, latestRealByConvRows, sdrFlowRows, operatorRows] = await Promise.all([
    db
      .select({
        conversationId: messages.conversationId,
        sentAt: messages.sentAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          inArray(messages.conversationId, convIds),
          eq(messages.senderType, "client"),
          eq(messages.isInternalNote, false),
          gte(messages.sentAt, lookbackCutoff),
          sql`COALESCE(${messages.metaDetails}->>'metaMessageType', '') <> 'system'`,
        ),
      )
      .orderBy(desc(messages.sentAt))
      .limit(1),
    nonFinalizedIds.length > 0
      ? db
          .select({
            conversationId: messages.conversationId,
            latestSentAt: sql<Date>`max(${messages.sentAt})`,
          })
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, tenantId),
              inArray(messages.conversationId, nonFinalizedIds),
              eq(messages.isInternalNote, false),
              sql`COALESCE(${messages.metaDetails}->>'metaMessageType', '') <> 'system'`,
            ),
          )
          .groupBy(messages.conversationId)
      : Promise.resolve([]),
    nonFinalizedIds.length > 0
      ? db
          .select({
            conversationId: agentFlowStates.conversationId,
            outcome: agentFlowStates.outcome,
            metadata: agentFlowStates.metadata,
            lastInteractionAt: agentFlowStates.lastInteractionAt,
          })
          .from(agentFlowStates)
          .where(
            and(
              eq(agentFlowStates.tenantId, tenantId),
              inArray(agentFlowStates.conversationId, nonFinalizedIds),
              eq(agentFlowStates.agentType, "sdr"),
            ),
          )
      : Promise.resolve([]),
    operatorIdsToLoad.length > 0
      ? db
          .select({ id: operators.id, name: operators.name })
          .from(operators)
          .where(and(eq(operators.tenantId, tenantId), inArray(operators.id, operatorIdsToLoad)))
      : Promise.resolve([]),
  ]);

  const latestRealMap = new Map<string, Date>();
  for (const row of latestRealByConvRows) {
    if (row.latestSentAt) {
      latestRealMap.set(
        row.conversationId,
        row.latestSentAt instanceof Date ? row.latestSentAt : new Date(row.latestSentAt),
      );
    }
  }

  const activeSdrMap = new Map<string, Date>();
  for (const flow of sdrFlowRows) {
    const meta = (flow.metadata as Record<string, unknown>) || {};
    const isActiveFlow =
      flow.outcome === "in_progress" ||
      meta.handoffStatus === "awaiting_approval" ||
      Boolean(meta.pendingApproval);
    if (!isActiveFlow || !flow.lastInteractionAt) continue;
    const dt =
      flow.lastInteractionAt instanceof Date
        ? flow.lastInteractionAt
        : new Date(flow.lastInteractionAt);
    const prev = activeSdrMap.get(flow.conversationId);
    if (!prev || dt.getTime() > prev.getTime()) {
      activeSdrMap.set(flow.conversationId, dt);
    }
  }

  const operatorNamesById: Record<string, string> = {};
  for (const op of operatorRows) {
    operatorNamesById[op.id] = op.name;
  }

  const latestClientRow = latestClientRows[0] || null;
  return evaluateWhatsappActivityBlock({
    triggeredAt: opts.triggeredAt,
    now,
    walletOperatorId: contactRow?.walletOperatorId ?? null,
    operatorNamesById,
    latestClientMessage: latestClientRow
      ? {
          conversationId: latestClientRow.conversationId,
          sentAt:
            latestClientRow.sentAt instanceof Date
              ? latestClientRow.sentAt
              : new Date(latestClientRow.sentAt),
        }
      : null,
    conversations: waConvs.map((c) => ({
      id: c.id,
      queueState: c.queueState,
      operatorId: c.operatorId,
      whatsappConnectionId: c.whatsappConnectionId,
      latestRealMessageAt: latestRealMap.get(c.id) ?? null,
      activeSdrFlowLastInteractionAt: activeSdrMap.get(c.id) ?? null,
    })),
  });
}

async function linkDealToConversationBestEffort(
  tenantId: string,
  conversationId: string,
  dealId: string,
): Promise<void> {
  if (!conversationId || conversationId.startsWith("conv-lc-") || conversationId.startsWith("site-")) {
    return;
  }
  try {
    await db
      .insert(crmConversationDeals)
      .values({
        id: `cd-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        tenantId,
        conversationId,
        dealId,
        origin: "auto_sdr",
        isActive: true,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  } catch {
    // Melhor esforço: não quebra o fluxo principal
  }
}

export interface ScheduleRdTemplateResult {
  scheduled: boolean;
  cancelled?: boolean;
  scheduleId?: string;
  scheduledFor?: Date;
  replacedScheduleId?: string | null;
  reason?: string;
}

/**
 * Agenda o disparo condicional atrasado do template WhatsApp após o commit do webhook RD.
 * - Se o cliente já enviou mensagem nos últimos 15 min ou já possui conversa ativa, cancela imediatamente.
 * - Mantém no máximo 1 agendamento `pending` por `(tenantId, contactId)` substituindo pelo mais recente.
 */
export async function scheduleRdSdrTemplatePostCommit(
  job: RdTemplateDispatchJob,
  opts?: { now?: Date },
): Promise<ScheduleRdTemplateResult> {
  const now = opts?.now ?? new Date();
  const { tenantId, flowId, dealId, contactId, whatsappTemplateId } = job;
  const delayMinutes = resolveFlowTemplateDelay({
    whatsappTemplateDelayEnabled: true,
    whatsappTemplateDelayMinutes: job.delayMinutes ?? DEFAULT_RD_TEMPLATE_DELAY_MINUTES,
  }).minutes;

  const templateLabel = await resolveFriendlyTemplateName(tenantId, whatsappTemplateId, flowId);

  // 1. Checar se já existe mensagem recente do cliente ou conversa ativa
  const activityCheck = await checkContactHasBlockingWhatsappActivity(tenantId, contactId, {
    triggeredAt: now,
    now,
  });

  if (activityCheck.blocked && activityCheck.reason) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${`rd_sched_tpl:${contactId}`}))`,
      );
      await tx
        .update(rdMarketingScheduledTemplates)
        .set({
          status: "cancelled",
          cancelReason: activityCheck.reason,
          processedAt: now,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(rdMarketingScheduledTemplates.tenantId, tenantId),
            eq(rdMarketingScheduledTemplates.contactId, contactId),
            eq(rdMarketingScheduledTemplates.status, "pending"),
          ),
        );
      await tx.insert(rdMarketingLogs).values({
        id: crypto.randomUUID(),
        tenantId,
        flowId,
        status: "cancelled",
        dealId,
        message: describeScheduledTemplateCancelReason(activityCheck.reason!, {
          templateLabel,
          delayMinutes,
          operatorName: activityCheck.operatorName,
        }),
      });
    });

    if (activityCheck.conversationId) {
      await linkDealToConversationBestEffort(tenantId, activityCheck.conversationId, dealId);
    }

    return {
      scheduled: false,
      cancelled: true,
      reason: activityCheck.reason,
    };
  }

  // 2. Garantir no máximo 1 agendamento `pending` por contato no tenant (substitui anterior se existir)
  const scheduledFor = new Date(now.getTime() + delayMinutes * 60_000);
  const scheduleId = `rdtpl-${crypto.randomUUID()}`;

  const txResult = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${`rd_sched_tpl:${contactId}`}))`,
    );

    const replaced = await tx
      .update(rdMarketingScheduledTemplates)
      .set({
        status: "cancelled",
        cancelReason: "replaced_by_newer_flow",
        processedAt: now,
        leaseToken: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(rdMarketingScheduledTemplates.tenantId, tenantId),
          eq(rdMarketingScheduledTemplates.contactId, contactId),
          eq(rdMarketingScheduledTemplates.status, "pending"),
        ),
      )
      .returning({
        id: rdMarketingScheduledTemplates.id,
        flowId: rdMarketingScheduledTemplates.flowId,
        dealId: rdMarketingScheduledTemplates.dealId,
      });

    for (const prev of replaced) {
      await tx.insert(rdMarketingLogs).values({
        id: crypto.randomUUID(),
        tenantId,
        flowId: prev.flowId,
        status: "cancelled",
        dealId: prev.dealId,
        message: describeScheduledTemplateCancelReason("replaced_by_newer_flow"),
      });
    }

    await tx.insert(rdMarketingScheduledTemplates).values({
      id: scheduleId,
      tenantId,
      flowId,
      dealId,
      contactId,
      whatsappTemplateId: whatsappTemplateId.trim(),
      clientName: job.clientName ?? null,
      companyName: job.companyName ?? null,
      document: job.document ?? null,
      delayMinutes,
      status: "pending",
      scheduledFor,
      triggeredAt: now,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });

    const replacedSuffix =
      replaced.length > 0 ? " (substituiu agendamento anterior do mesmo contato)" : "";
    await tx.insert(rdMarketingLogs).values({
      id: crypto.randomUUID(),
      tenantId,
      flowId,
      status: "scheduled",
      dealId,
      message: `Template '${templateLabel}' agendado para ${formatBrtClockTime(scheduledFor)} (atraso de ${delayMinutes} min — será cancelado se o cliente enviar mensagem antes)${replacedSuffix}.`,
    });

    return { replacedId: replaced[0]?.id ?? null };
  });

  return {
    scheduled: true,
    scheduleId,
    scheduledFor,
    replacedScheduleId: txResult.replacedId,
  };
}

/**
 * Cancelamento imediato quando chega mensagem real de cliente no WhatsApp.
 * Chamado pós-commit pelo `InboundProcessor` (além da rechecagem obrigatória no worker).
 */
export async function cancelPendingRdScheduledTemplatesOnClientMessage(params: {
  tenantId: string;
  contactId: string;
  conversationId?: string | null;
  messageAt?: Date;
}): Promise<{ cancelledCount: number; cancelledIds: string[] }> {
  const now = params.messageAt ?? new Date();
  const { tenantId, contactId } = params;

  const cancelledRows = await db
    .update(rdMarketingScheduledTemplates)
    .set({
      status: "cancelled",
      cancelReason: "client_messaged_during_delay",
      processedAt: now,
      leaseToken: null,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(rdMarketingScheduledTemplates.tenantId, tenantId),
        eq(rdMarketingScheduledTemplates.contactId, contactId),
        eq(rdMarketingScheduledTemplates.status, "pending"),
      ),
    )
    .returning();

  if (cancelledRows.length === 0) {
    return { cancelledCount: 0, cancelledIds: [] };
  }

  for (const row of cancelledRows) {
    const templateLabel = await resolveFriendlyTemplateName(
      tenantId,
      row.whatsappTemplateId,
      row.flowId,
    );
    await db.insert(rdMarketingLogs).values({
      id: crypto.randomUUID(),
      tenantId,
      flowId: row.flowId,
      status: "cancelled",
      dealId: row.dealId,
      message: describeScheduledTemplateCancelReason("client_messaged_during_delay", {
        templateLabel,
        delayMinutes: row.delayMinutes,
      }),
    });

    if (params.conversationId) {
      await linkDealToConversationBestEffort(tenantId, params.conversationId, row.dealId);
    }
  }

  return {
    cancelledCount: cancelledRows.length,
    cancelledIds: cancelledRows.map((r) => r.id),
  };
}

function dueScheduledCondition(now: Date) {
  return or(
    and(
      eq(rdMarketingScheduledTemplates.status, "pending"),
      lte(rdMarketingScheduledTemplates.scheduledFor, now),
    ),
    and(
      eq(rdMarketingScheduledTemplates.status, "processing"),
      or(
        isNull(rdMarketingScheduledTemplates.leaseUntil),
        lte(rdMarketingScheduledTemplates.leaseUntil, now),
      ),
    ),
  );
}

export async function claimDueRdScheduledTemplates(
  tenantId: string,
  opts?: { now?: Date; limit?: number },
): Promise<ScheduledTemplateRow[]> {
  const now = opts?.now ?? new Date();
  const limit = Math.max(1, Math.min(50, opts?.limit ?? 20));
  const candidates = await db
    .select({ id: rdMarketingScheduledTemplates.id })
    .from(rdMarketingScheduledTemplates)
    .where(
      and(eq(rdMarketingScheduledTemplates.tenantId, tenantId), dueScheduledCondition(now)),
    )
    .orderBy(asc(rdMarketingScheduledTemplates.scheduledFor))
    .limit(limit);

  const claimed: ScheduledTemplateRow[] = [];
  for (const candidate of candidates) {
    const leaseToken = crypto.randomUUID();
    const leaseUntil = new Date(now.getTime() + SCHEDULED_TEMPLATE_LEASE_MS);
    const [row] = await db
      .update(rdMarketingScheduledTemplates)
      .set({
        status: "processing",
        leaseToken,
        leaseUntil,
        attempts: sql`${rdMarketingScheduledTemplates.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(rdMarketingScheduledTemplates.tenantId, tenantId),
          eq(rdMarketingScheduledTemplates.id, candidate.id),
          dueScheduledCondition(now),
        ),
      )
      .returning();
    if (row) claimed.push(row);
  }

  return claimed;
}

export async function processClaimedRdScheduledTemplate(
  row: ScheduledTemplateRow,
  opts?: {
    now?: Date;
    dispatcher?: RdTemplateDispatcherFn;
    manualTrigger?: boolean;
    triggeredByOperatorName?: string | null;
  },
): Promise<{
  outcome: "sent" | "cancelled" | "requeued" | "failed" | "skipped";
  reason?: string;
  dispatchResult?: RdTemplateDispatchResult;
}> {
  const now = opts?.now ?? new Date();
  const dispatcher = opts?.dispatcher ?? dispatchRdSdrTemplatePostCommit;
  const owned = and(
    eq(rdMarketingScheduledTemplates.tenantId, row.tenantId),
    eq(rdMarketingScheduledTemplates.id, row.id),
    eq(rdMarketingScheduledTemplates.leaseToken, row.leaseToken!),
  );

  // 1. Verificar estado atual do fluxo no banco
  const [liveFlow] = await db
    .select({
      id: rdMarketingFlows.id,
      settings: rdMarketingFlows.settings,
    })
    .from(rdMarketingFlows)
    .where(
      and(
        eq(rdMarketingFlows.tenantId, row.tenantId),
        eq(rdMarketingFlows.id, row.flowId),
      ),
    )
    .limit(1);

  if (!liveFlow || !liveFlow.settings?.enabled) {
    const updated = await db
      .update(rdMarketingScheduledTemplates)
      .set({
        status: "cancelled",
        cancelReason: "flow_disabled_or_deleted",
        processedAt: now,
        leaseToken: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(owned)
      .returning({ id: rdMarketingScheduledTemplates.id });

    if (updated.length > 0 && liveFlow) {
      const templateLabel = await resolveFriendlyTemplateName(
        row.tenantId,
        row.whatsappTemplateId,
        row.flowId,
      );
      await db.insert(rdMarketingLogs).values({
        id: crypto.randomUUID(),
        tenantId: row.tenantId,
        flowId: row.flowId,
        status: "cancelled",
        dealId: row.dealId,
        message: describeScheduledTemplateCancelReason("flow_disabled_or_deleted", {
          templateLabel,
        }),
      });
    }
    return { outcome: "cancelled", reason: "flow_disabled_or_deleted" };
  }

  const effectiveTemplateId = (liveFlow.settings.whatsappTemplateId || "").trim();
  if (!effectiveTemplateId) {
    const updated = await db
      .update(rdMarketingScheduledTemplates)
      .set({
        status: "cancelled",
        cancelReason: "flow_template_removed",
        processedAt: now,
        leaseToken: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(owned)
      .returning({ id: rdMarketingScheduledTemplates.id });

    if (updated.length > 0) {
      await db.insert(rdMarketingLogs).values({
        id: crypto.randomUUID(),
        tenantId: row.tenantId,
        flowId: row.flowId,
        status: "cancelled",
        dealId: row.dealId,
        message: describeScheduledTemplateCancelReason("flow_template_removed"),
      });
    }
    return { outcome: "cancelled", reason: "flow_template_removed" };
  }

  // 2. Rechecagem obrigatória no momento do disparo (exceto quando o operador clicou explicitamente em "Enviar agora")
  if (!opts?.manualTrigger) {
    const activityCheck = await checkContactHasBlockingWhatsappActivity(
      row.tenantId,
      row.contactId,
      { triggeredAt: row.triggeredAt, now },
    );

    if (activityCheck.blocked && activityCheck.reason) {
      const updated = await db
        .update(rdMarketingScheduledTemplates)
        .set({
          status: "cancelled",
          cancelReason: activityCheck.reason,
          processedAt: now,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(owned)
        .returning({ id: rdMarketingScheduledTemplates.id });

      if (updated.length > 0) {
        const templateLabel = await resolveFriendlyTemplateName(
          row.tenantId,
          effectiveTemplateId,
          row.flowId,
        );
        await db.insert(rdMarketingLogs).values({
          id: crypto.randomUUID(),
          tenantId: row.tenantId,
          flowId: row.flowId,
          status: "cancelled",
          dealId: row.dealId,
          message: describeScheduledTemplateCancelReason(activityCheck.reason, {
            templateLabel,
            delayMinutes: row.delayMinutes,
            operatorName: activityCheck.operatorName,
          }),
        });
        if (activityCheck.conversationId) {
          await linkDealToConversationBestEffort(
            row.tenantId,
            activityCheck.conversationId,
            row.dealId,
          );
        }
      }
      return { outcome: "cancelled", reason: activityCheck.reason };
    }
  }

  // 3. Executar disparo oficial via motor de templates SDR
  const dispatchResult = await dispatcher({
    tenantId: row.tenantId,
    flowId: row.flowId,
    dealId: row.dealId,
    contactId: row.contactId,
    whatsappTemplateId: effectiveTemplateId,
    clientName: row.clientName,
    companyName: row.companyName,
    document: row.document,
    dispatchContext: opts?.manualTrigger
      ? {
          manualTrigger: true,
          triggeredByOperatorName: opts.triggeredByOperatorName ?? null,
        }
      : {
          delayedMinutes: row.delayMinutes,
        },
  });

  if (dispatchResult.dispatched) {
    await db
      .update(rdMarketingScheduledTemplates)
      .set({
        status: "sent",
        processedAt: now,
        leaseToken: null,
        leaseUntil: null,
        lastError: null,
        updatedAt: now,
      })
      .where(owned);
    return { outcome: "sent", dispatchResult };
  }

  const reason = dispatchResult.reason || "template_send_failed";
  if (PERMANENT_DISPATCH_BLOCK_REASONS.has(reason)) {
    await db
      .update(rdMarketingScheduledTemplates)
      .set({
        status: "cancelled",
        cancelReason: reason,
        processedAt: now,
        leaseToken: null,
        leaseUntil: null,
        lastError: reason,
        updatedAt: now,
      })
      .where(owned);
    return { outcome: "cancelled", reason, dispatchResult };
  }

  // Falha transitória: tentar novamente até MAX_SCHEDULED_TEMPLATE_ATTEMPTS respeitando unicidade de `pending`
  if (row.attempts < MAX_SCHEDULED_TEMPLATE_ATTEMPTS && !opts?.manualTrigger) {
    const requeued = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${row.tenantId}), hashtext(${`rd_sched_tpl:${row.contactId}`}))`,
      );
      const [newerPending] = await tx
        .select({ id: rdMarketingScheduledTemplates.id })
        .from(rdMarketingScheduledTemplates)
        .where(
          and(
            eq(rdMarketingScheduledTemplates.tenantId, row.tenantId),
            eq(rdMarketingScheduledTemplates.contactId, row.contactId),
            eq(rdMarketingScheduledTemplates.status, "pending"),
          ),
        )
        .limit(1);

      if (newerPending) {
        await tx
          .update(rdMarketingScheduledTemplates)
          .set({
            status: "cancelled",
            cancelReason: "replaced_by_newer_flow",
            processedAt: now,
            leaseToken: null,
            leaseUntil: null,
            lastError: reason,
            updatedAt: now,
          })
          .where(owned);
        return false;
      }

      await tx
        .update(rdMarketingScheduledTemplates)
        .set({
          status: "pending",
          scheduledFor: new Date(now.getTime() + 60_000),
          leaseToken: null,
          leaseUntil: null,
          lastError: reason,
          updatedAt: now,
        })
        .where(owned);
      return true;
    });

    return {
      outcome: requeued ? "requeued" : "cancelled",
      reason: requeued ? reason : "replaced_by_newer_flow",
      dispatchResult,
    };
  }

  await db
    .update(rdMarketingScheduledTemplates)
    .set({
      status: "failed",
      processedAt: now,
      leaseToken: null,
      leaseUntil: null,
      lastError: reason,
      updatedAt: now,
    })
    .where(owned);

  return { outcome: "failed", reason, dispatchResult };
}

export async function processDueRdScheduledTemplatesForTenant(
  tenantId: string,
  opts?: { now?: Date; limit?: number; dispatcher?: RdTemplateDispatcherFn },
): Promise<{ processed: number; sent: number; cancelled: number; failed: number }> {
  const claimed = await claimDueRdScheduledTemplates(tenantId, opts);
  let sent = 0;
  let cancelled = 0;
  let failed = 0;

  for (const row of claimed) {
    const res = await processClaimedRdScheduledTemplate(row, {
      now: opts?.now,
      dispatcher: opts?.dispatcher,
    });
    if (res.outcome === "sent") sent += 1;
    else if (res.outcome === "cancelled") cancelled += 1;
    else if (res.outcome === "failed") failed += 1;
  }

  return { processed: claimed.length, sent, cancelled, failed };
}

let scheduledWorkerRunning = false;
export async function runRdScheduledTemplateWorker(opts?: {
  now?: Date;
  dispatcher?: RdTemplateDispatcherFn;
}): Promise<void> {
  if (scheduledWorkerRunning) return;
  scheduledWorkerRunning = true;
  try {
    const companies = await db.select({ id: tenants.id }).from(tenants);
    for (const { id: tenantId } of companies) {
      await processDueRdScheduledTemplatesForTenant(tenantId, opts);
    }
  } finally {
    scheduledWorkerRunning = false;
  }
}

export interface ScheduledRdTemplateItem {
  id: string;
  flowId: string;
  flowName: string;
  dealId: string;
  dealTitle: string | null;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  whatsappTemplateId: string;
  templateName: string | null;
  delayMinutes: number;
  status: string;
  scheduledFor: string;
  triggeredAt: string;
}

export async function listScheduledRdTemplateDispatches(
  tenantId: string,
): Promise<ScheduledRdTemplateItem[]> {
  const rows = await db
    .select()
    .from(rdMarketingScheduledTemplates)
    .where(
      and(
        eq(rdMarketingScheduledTemplates.tenantId, tenantId),
        inArray(rdMarketingScheduledTemplates.status, ["pending", "processing"]),
      ),
    )
    .orderBy(asc(rdMarketingScheduledTemplates.scheduledFor))
    .limit(100);

  if (rows.length === 0) return [];

  const flowIds = Array.from(new Set(rows.map((r) => r.flowId)));
  const contactIds = Array.from(new Set(rows.map((r) => r.contactId)));
  const dealIds = Array.from(new Set(rows.map((r) => r.dealId)));

  const [flowRows, contactRows, dealRows, templateRows] = await Promise.all([
    db
      .select({ id: rdMarketingFlows.id, settings: rdMarketingFlows.settings })
      .from(rdMarketingFlows)
      .where(and(eq(rdMarketingFlows.tenantId, tenantId), inArray(rdMarketingFlows.id, flowIds))),
    db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, contactIds))),
    db
      .select({ id: crmDeals.id, title: crmDeals.title })
      .from(crmDeals)
      .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, dealIds))),
    db
      .select({
        id: metaMessageTemplates.id,
        metaTemplateId: metaMessageTemplates.metaTemplateId,
        name: metaMessageTemplates.name,
        status: metaMessageTemplates.status,
      })
      .from(metaMessageTemplates)
      .where(eq(metaMessageTemplates.tenantId, tenantId)),
  ]);

  const flowMap = new Map(flowRows.map((f) => [f.id, f.settings]));
  const contactMap = new Map(contactRows.map((c) => [c.id, c]));
  const dealMap = new Map(dealRows.map((d) => [d.id, d.title]));
  const tplByKey = new Map<string, string>();
  for (const t of templateRows) {
    if (t.status === "APPROVED") {
      tplByKey.set(t.id, t.name);
      tplByKey.set(t.metaTemplateId, t.name);
      tplByKey.set(t.name, t.name);
    }
  }
  for (const t of templateRows) {
    if (!tplByKey.has(t.id)) tplByKey.set(t.id, t.name);
    if (!tplByKey.has(t.metaTemplateId)) tplByKey.set(t.metaTemplateId, t.name);
    if (!tplByKey.has(t.name)) tplByKey.set(t.name, t.name);
  }

  return rows.map((row) => {
    const flowSettings = flowMap.get(row.flowId);
    const contact = contactMap.get(row.contactId);
    const liveTplId = (flowSettings?.whatsappTemplateId || row.whatsappTemplateId || "").trim();
    return {
      id: row.id,
      flowId: row.flowId,
      flowName: flowSettings?.name || row.flowId,
      dealId: row.dealId,
      dealTitle: dealMap.get(row.dealId) ?? null,
      contactId: row.contactId,
      contactName: contact?.name || row.clientName || "Contato",
      contactPhone: contact?.phone ? normalizeCanonicalPhone(contact.phone) || contact.phone : null,
      whatsappTemplateId: liveTplId,
      templateName: tplByKey.get(liveTplId) ?? null,
      delayMinutes: row.delayMinutes,
      status: row.status,
      scheduledFor:
        row.scheduledFor instanceof Date
          ? row.scheduledFor.toISOString()
          : String(row.scheduledFor),
      triggeredAt:
        row.triggeredAt instanceof Date ? row.triggeredAt.toISOString() : String(row.triggeredAt),
    };
  });
}

export async function cancelScheduledRdTemplateByOperator(
  tenantId: string,
  scheduleId: string,
  operatorName: string,
): Promise<{ cancelled: boolean; scheduleId: string }> {
  const now = new Date();
  const [cancelled] = await db
    .update(rdMarketingScheduledTemplates)
    .set({
      status: "cancelled",
      cancelReason: "cancelled_by_operator",
      processedAt: now,
      leaseToken: null,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(rdMarketingScheduledTemplates.tenantId, tenantId),
        eq(rdMarketingScheduledTemplates.id, scheduleId),
        eq(rdMarketingScheduledTemplates.status, "pending"),
      ),
    )
    .returning();

  if (!cancelled) {
    throw new CrmError(
      "Agendamento não encontrado ou já foi processado/cancelado.",
      "NOT_FOUND",
      404,
    );
  }

  const templateLabel = await resolveFriendlyTemplateName(
    tenantId,
    cancelled.whatsappTemplateId,
    cancelled.flowId,
  );
  await db.insert(rdMarketingLogs).values({
    id: crypto.randomUUID(),
    tenantId,
    flowId: cancelled.flowId,
    status: "cancelled",
    dealId: cancelled.dealId,
    message: describeScheduledTemplateCancelReason("cancelled_by_operator", {
      templateLabel,
      operatorName,
    }),
  });

  return { cancelled: true, scheduleId: cancelled.id };
}

export async function dispatchScheduledRdTemplateNow(
  tenantId: string,
  scheduleId: string,
  operatorName: string,
  opts?: { dispatcher?: RdTemplateDispatcherFn },
): Promise<{
  dispatched: boolean;
  outcome: string;
  reason?: string;
  templateName?: string;
  cwrAction?: string;
}> {
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const leaseUntil = new Date(now.getTime() + SCHEDULED_TEMPLATE_LEASE_MS);

  const [claimed] = await db
    .update(rdMarketingScheduledTemplates)
    .set({
      status: "processing",
      leaseToken,
      leaseUntil,
      attempts: sql`${rdMarketingScheduledTemplates.attempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(rdMarketingScheduledTemplates.tenantId, tenantId),
        eq(rdMarketingScheduledTemplates.id, scheduleId),
        eq(rdMarketingScheduledTemplates.status, "pending"),
      ),
    )
    .returning();

  if (!claimed) {
    throw new CrmError(
      "Agendamento não encontrado ou já foi processado/cancelado.",
      "NOT_FOUND",
      404,
    );
  }

  const result = await processClaimedRdScheduledTemplate(claimed, {
    now,
    dispatcher: opts?.dispatcher,
    manualTrigger: true,
    triggeredByOperatorName: operatorName,
  });

  return {
    dispatched: result.outcome === "sent",
    outcome: result.outcome,
    reason: result.reason,
    templateName: result.dispatchResult?.templateName,
    cwrAction: result.dispatchResult?.cwrAction,
  };
}
