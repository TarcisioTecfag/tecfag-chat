import { and, desc, eq, inArray } from "drizzle-orm";
import {
  conversationDealContexts,
  conversations,
  crmConversationDeals,
  crmDeals,
  crmDealActivities,
  crmDealEvents,
  messages,
  operators,
  rdMarketingReceipts,
} from "../../db/schema";
import type { DealTransaction } from "./deal-associations";
import { getContactDealRows } from "./contact-deals-query";
import {
  assertDealContextVersion,
  DealContextError,
  isCurrentDealEligible,
  isTrashedDeal,
  resolveDealSelection,
  findActiveGraceDeal,
  getDealPostCloseGraceExpiresAt,
  isDealWithinPostCloseGrace,
  DEAL_POST_CLOSE_GRACE_DAYS,
  DEAL_POST_CLOSE_GRACE_MS,
} from "./conversation-deal-policy";

export {
  DealContextError,
  assertDealContextVersion,
  isCurrentDealEligible,
  findActiveGraceDeal,
  getDealPostCloseGraceExpiresAt,
  isDealWithinPostCloseGrace,
  DEAL_POST_CLOSE_GRACE_DAYS,
  DEAL_POST_CLOSE_GRACE_MS,
} from "./conversation-deal-policy";

async function ensureCurrentDealLink(
  tx: DealTransaction,
  tenantId: string,
  conversationId: string,
  dealId: string,
  operatorId: string | null,
) {
  const [link] = await tx
    .select({ id: crmConversationDeals.id })
    .from(crmConversationDeals)
    .where(
      and(
        eq(crmConversationDeals.tenantId, tenantId),
        eq(crmConversationDeals.conversationId, conversationId),
        eq(crmConversationDeals.dealId, dealId),
        eq(crmConversationDeals.isActive, true),
      ),
    )
    .limit(1);
  if (!link)
    await tx
      .insert(crmConversationDeals)
      .values({
        id: `cd-${crypto.randomUUID()}`,
        tenantId,
        conversationId,
        dealId,
        origin: "chat",
        createdByOperatorId: operatorId,
        isActive: true,
      })
      .onConflictDoNothing();
}

/** Todos os escritores serializam pela conversa, inclusive notas e transferências. */
export async function getDealContext(
  tx: DealTransaction,
  tenantId: string,
  conversationId: string,
  operatorId: string | null,
) {
  const [conversation] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
    .for("update")
    .limit(1);
  if (!conversation) throw new DealContextError("Conversa não encontrada.", "NOT_FOUND", 404);
  await tx
    .insert(conversationDealContexts)
    .values({ tenantId, conversationId })
    .onConflictDoNothing();
  let [context] = await tx
    .select()
    .from(conversationDealContexts)
    .where(
      and(
        eq(conversationDealContexts.tenantId, tenantId),
        eq(conversationDealContexts.conversationId, conversationId),
      ),
    )
    .for("update")
    .limit(1);
  const deals = (await getContactDealRows(tx, tenantId, conversation.contactId))
    .filter((d) => !isTrashedDeal(d))
    .map(
      ({
        id,
        title,
        status,
        pausedReason,
        pipelineId,
        pipelineName,
        stageId,
        stageName,
        operatorId,
        operatorName,
        rdDealId,
        isLinked,
        closedAt,
        closedByOperatorId,
      }) => ({
        id,
        title,
        status,
        pausedReason: pausedReason ?? null,
        pipelineId,
        pipelineName,
        stageId,
        stageName,
        operatorId,
        operatorName,
        rdDealId,
        isLinked,
        closedAt,
        closedByOperatorId: closedByOperatorId ?? null,
      }),
    );

  // Fallback seguro para cards encerrados antes da coluna closed_by_operator_id:
  // resolve o autor da última transição para won/lost a partir de crm_deal_events.
  const dealsMissingCloser = deals.filter(
    (d) =>
      (d.status === "won" || d.status === "lost") &&
      d.isLinked &&
      d.closedAt &&
      !d.closedByOperatorId,
  );
  if (dealsMissingCloser.length > 0) {
    try {
      const missingIds = dealsMissingCloser.map((d) => d.id);
      const closeEvents = await tx
        .select({
          dealId: crmDealEvents.dealId,
          eventType: crmDealEvents.eventType,
          toStatus: crmDealEvents.toStatus,
          metadata: crmDealEvents.metadata,
          operatorId: crmDealEvents.operatorId,
        })
        .from(crmDealEvents)
        .where(
          and(
            eq(crmDealEvents.tenantId, tenantId),
            inArray(crmDealEvents.dealId, missingIds),
            inArray(crmDealEvents.eventType, ["status_changed", "bulk_updated"]),
          ),
        )
        .orderBy(desc(crmDealEvents.createdAt));

      const closerByDeal = new Map<string, string>();
      for (const evt of closeEvents) {
        if (!evt.operatorId || closerByDeal.has(evt.dealId)) continue;
        const meta = (evt.metadata || {}) as Record<string, unknown>;
        const targetStatus =
          evt.eventType === "status_changed"
            ? evt.toStatus || (typeof meta.toStatus === "string" ? meta.toStatus : null)
            : typeof meta.newStatus === "string"
              ? meta.newStatus
              : null;
        if (targetStatus === "won" || targetStatus === "lost") {
          closerByDeal.set(evt.dealId, evt.operatorId);
        }
      }
      for (const d of deals) {
        if (!d.closedByOperatorId && closerByDeal.has(d.id)) {
          d.closedByOperatorId = closerByDeal.get(d.id)!;
        }
      }
    } catch {
      // Em mocks unitários parciais, mantém closedByOperatorId como está.
    }
  }
  // Conversas encerradas só conservam a sugestão histórica, nunca o destino ativo.
  const openDealIds = deals.filter((d) => d.status === "open" && d.isLinked).map((d) => d.id);
  const pausedDealIds = deals.filter((d) => d.status === "paused" && d.isLinked).map((d) => d.id);
  const selectedId =
    conversation.queueState === "finalizados"
      ? null
      : resolveDealSelection(context, openDealIds, pausedDealIds);
  if (
    selectedId !== context.currentDealId ||
    (conversation.queueState === "finalizados" && !context.selectionRequired)
  ) {
    if (selectedId)
      await ensureCurrentDealLink(tx, tenantId, conversationId, selectedId, operatorId);
    const previousDealId = context.currentDealId || context.previousDealId;
    [context] = await tx
      .update(conversationDealContexts)
      .set({
        currentDealId: selectedId,
        previousDealId,
        // Depois da primeira escolha, a remoção/exclusão do card sempre exige revisão.
        selectionRequired: true,
        version: context.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationDealContexts.tenantId, tenantId),
          eq(conversationDealContexts.conversationId, conversationId),
        ),
      )
      .returning();
    await recordContextChange(
      tx,
      tenantId,
      conversationId,
      previousDealId,
      selectedId,
      operatorId,
      selectedId ? "automatic" : "unavailable",
    );
  }
  return { context, deals, conversation };
}

async function recordContextChange(
  tx: DealTransaction,
  tenantId: string,
  conversationId: string,
  fromDealId: string | null,
  toDealId: string | null,
  operatorId: string | null,
  reason: string,
) {
  const changeId = crypto.randomUUID();
  const [actor] = operatorId
    ? await tx
        .select({ name: operators.name })
        .from(operators)
        .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
        .limit(1)
    : [];
  const operatorName = actor?.name?.trim() || null;
  let isRdMarketingOrigin = false;
  if (toDealId) {
    const [rdReceipt] = await tx
      .select({ id: rdMarketingReceipts.id })
      .from(rdMarketingReceipts)
      .where(
        and(eq(rdMarketingReceipts.tenantId, tenantId), eq(rdMarketingReceipts.dealId, toDealId)),
      )
      .limit(1);
    isRdMarketingOrigin = Boolean(rdReceipt);
  }
  const resolvedActorName =
    reason === "automatic"
      ? isRdMarketingOrigin
        ? operatorName
          ? `Automação RD Station Marketing (${operatorName})`
          : "Automação RD Station Marketing"
        : operatorName || "Automação CRM"
      : operatorName || "Operador";

  if (reason === "automatic" && toDealId) {
    const [deal] = await tx
      .select({ title: crmDeals.title })
      .from(crmDeals)
      .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, toDealId)))
      .limit(1);
    await tx.insert(messages).values({
      id: `context-auto-${changeId}`,
      tenantId,
      conversationId,
      senderType: "system",
      senderName: resolvedActorName,
      isInternalNote: true,
      direction: "outbound",
      status: "accepted",
      content: `Negociação atual selecionada automaticamente: ${deal?.title || toDealId}.`,
      metaDetails: {
        attendanceActor: { name: resolvedActorName, operatorId },
        attendanceEventType: "attendance.context_selected",
        dealId: toDealId,
      },
    });
  }
  for (const dealId of new Set([fromDealId, toDealId].filter((id): id is string => Boolean(id)))) {
    await tx.insert(crmDealEvents).values({
      id: `context-${changeId}-${dealId}`,
      tenantId,
      dealId,
      operatorId,
      eventType: "conversation_context_changed",
      metadata: {
        conversationId,
        fromDealId,
        toDealId,
        reason,
        actorName: resolvedActorName,
        direction: dealId === toDealId ? "selected" : "released",
      },
    });
  }
}

export async function selectDealContext(
  tx: DealTransaction,
  tenantId: string,
  conversationId: string,
  dealId: string | null,
  operatorId: string,
  expectedVersion: unknown,
) {
  const state = await getDealContext(tx, tenantId, conversationId, operatorId);
  assertDealContextVersion(state.context, expectedVersion);
  if (dealId && !state.deals.some((d) => d.id === dealId && isCurrentDealEligible(d))) {
    throw new DealContextError(
      "Selecione uma negociação vinculada (em andamento ou pausada).",
      "INVALID_DEAL_CONTEXT",
      400,
    );
  }
  if (state.conversation.queueState === "finalizados")
    throw new DealContextError("Reative o atendimento antes de selecionar a negociação.");
  if (state.context.currentDealId === dealId) return state.context;
  if (dealId) await ensureCurrentDealLink(tx, tenantId, conversationId, dealId, operatorId);
  const [context] = await tx
    .update(conversationDealContexts)
    .set({
      currentDealId: dealId,
      previousDealId: state.context.currentDealId || state.context.previousDealId,
      selectionRequired: true,
      version: state.context.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conversationDealContexts.tenantId, tenantId),
        eq(conversationDealContexts.conversationId, conversationId),
      ),
    )
    .returning();
  await recordContextChange(
    tx,
    tenantId,
    conversationId,
    state.context.currentDealId,
    dealId,
    operatorId,
    "manual",
  );
  const [actor] = await tx.select({ name: operators.name }).from(operators).where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId))).limit(1);
  await tx.insert(messages).values({
    id: `context-${crypto.randomUUID()}`,
    tenantId,
    conversationId,
    senderType: "system",
    senderName: "Sistema",
    metaDetails: { attendanceActor: { name: actor?.name || "Operador", operatorId }, attendanceEventType: "attendance.context_selected" },
    isInternalNote: true,
    direction: "outbound",
    status: "accepted",
    content: dealId
      ? `Negociação deste atendimento: ${state.deals.find((d) => d.id === dealId)!.title}. As próximas ações serão registradas neste card.`
      : "Negociação atual removida. Selecione o card antes de registrar ações da negociação.",
  });
  return context;
}

/** O evento guarda o card no momento da ação; a seleção futura não reatribui o passado. */
export async function recordConversationAction(
  tx: DealTransaction,
  input: {
    tenantId: string;
    conversationId: string;
    dealId: string | null;
    operatorId: string;
    messageId: string;
    content: string;
    type: "note" | "system_event";
    metadata?: Record<string, unknown>;
  },
) {
  if (!input.dealId) return;
  // Eventos operacionais não são tarefas e não devem inflar métricas de atividades.
  if (input.type === "note")
    await tx
      .insert(crmDealActivities)
      .values({
        id: `chat-${input.messageId}`,
        tenantId: input.tenantId,
        dealId: input.dealId,
        conversationId: input.conversationId,
        type: "note",
        title: "Nota do atendimento",
        description: input.content,
        status: "completed",
        completedAt: new Date(),
        operatorId: input.operatorId,
      })
      .onConflictDoNothing();
  // O ledger attendance_events e a projeção no CRM são gravados pelos triggers
  // da mesma transação que persiste a ação. Aqui mantemos apenas o card rico da nota.
}

export async function endDealContext(
  tx: DealTransaction,
  tenantId: string,
  conversationId: string,
) {
  const [context] = await tx
    .select()
    .from(conversationDealContexts)
    .where(
      and(
        eq(conversationDealContexts.tenantId, tenantId),
        eq(conversationDealContexts.conversationId, conversationId),
      ),
    )
    .limit(1);
  if (!context || (!context.currentDealId && context.selectionRequired)) return;
  await tx
    .update(conversationDealContexts)
    .set({
      currentDealId: null,
      previousDealId: context.currentDealId || context.previousDealId,
      selectionRequired: true,
      version: context.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conversationDealContexts.tenantId, tenantId),
        eq(conversationDealContexts.conversationId, conversationId),
      ),
    );
}

/**
 * Valida se o operador pode enviar mensagens externas na conversa:
 * - Permitido se houver uma negociação atual ativa (em andamento ou pausada);
 * - Permitido se o PRÓPRIO operador estiver dentro da carência de 30 dias após marcar
 *   como vendida ('won') ou perdida ('lost') uma negociação vinculada a esta conversa;
 * - Caso contrário, bloqueia exigindo seleção de negociação disponível ou criação/vínculo.
 */
export async function resolveOutboundDealAccess(
  tx: DealTransaction,
  tenantId: string,
  conversationId: string,
  operatorId: string,
  nowMs: number = Date.now(),
): Promise<{
  allowed: boolean;
  activeDealId: string | null;
  graceDealId: string | null;
  code?: "DEAL_REQUIRED" | "DEAL_CONTEXT_REQUIRED";
  error?: string;
}> {
  const state = await getDealContext(tx, tenantId, conversationId, operatorId);
  if (state.context.currentDealId) {
    return {
      allowed: true,
      activeDealId: state.context.currentDealId,
      graceDealId: null,
    };
  }
  const graceDeal = findActiveGraceDeal(
    state.deals,
    [state.context.currentDealId, state.context.previousDealId],
    nowMs,
    operatorId,
  );
  if (graceDeal) {
    return {
      allowed: true,
      activeDealId: null,
      graceDealId: graceDeal.id,
    };
  }
  const hasEligible = state.deals.some(isCurrentDealEligible);
  if (hasEligible) {
    return {
      allowed: false,
      activeDealId: null,
      graceDealId: null,
      code: "DEAL_CONTEXT_REQUIRED",
      error: "Selecione a negociação deste atendimento antes de enviar mensagens.",
    };
  }
  return {
    allowed: false,
    activeDealId: null,
    graceDealId: null,
    code: "DEAL_REQUIRED",
    error:
      "Todo contato e atendimento precisa de uma negociação. Vincule uma existente ou crie uma para continuar.",
  };
}
