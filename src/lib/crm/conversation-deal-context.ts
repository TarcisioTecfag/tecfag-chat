import { and, eq } from "drizzle-orm";
import {
  conversationDealContexts,
  conversations,
  crmConversationDeals,
  crmDeals,
  crmDealActivities,
  crmDealEvents,
  messages,
} from "../../db/schema";
import type { DealTransaction } from "./deal-associations";
import {
  assertDealContextVersion,
  DealContextError,
  resolveDealSelection,
} from "./conversation-deal-policy";

export { DealContextError, assertDealContextVersion } from "./conversation-deal-policy";

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
  const deals = await tx
    .select({
      id: crmDeals.id,
      title: crmDeals.title,
      status: crmDeals.status,
      pipelineId: crmDeals.pipelineId,
      operatorId: crmDeals.operatorId,
      rdDealId: crmDeals.rdDealId,
    })
    .from(crmConversationDeals)
    .innerJoin(
      crmDeals,
      and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, crmConversationDeals.dealId)),
    )
    .where(
      and(
        eq(crmConversationDeals.tenantId, tenantId),
        eq(crmConversationDeals.conversationId, conversationId),
        eq(crmConversationDeals.isActive, true),
      ),
    );
  // Conversas encerradas só conservam a sugestão histórica, nunca o destino ativo.
  const selectedId =
    conversation.queueState === "finalizados"
      ? null
      : resolveDealSelection(
          context,
          deals.filter((d) => d.status === "open").map((d) => d.id),
        );
  if (
    selectedId !== context.currentDealId ||
    (conversation.queueState === "finalizados" && !context.selectionRequired)
  ) {
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
  if (dealId && !state.deals.some((d) => d.id === dealId && d.status === "open")) {
    throw new DealContextError(
      "Selecione uma negociação vinculada e em andamento.",
      "INVALID_DEAL_CONTEXT",
      400,
    );
  }
  if (state.conversation.queueState === "finalizados")
    throw new DealContextError("Reative o atendimento antes de selecionar a negociação.");
  if (state.context.currentDealId === dealId) return state.context;
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
  await tx.insert(messages).values({
    id: `context-${crypto.randomUUID()}`,
    tenantId,
    conversationId,
    senderType: "system",
    senderName: "Sistema",
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
  await tx
    .insert(crmDealEvents)
    .values({
      id: `chat-${input.messageId}`,
      tenantId: input.tenantId,
      dealId: input.dealId,
      eventType: "conversation_action",
      operatorId: input.operatorId,
      metadata: {
        ...input.metadata,
        conversationId: input.conversationId,
        messageId: input.messageId,
        description: input.content,
        actionType: input.type,
      },
    })
    .onConflictDoNothing();
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
  if (!context) return;
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

/** Alterações do card aparecem apenas nas conversas que o usam como contexto atual. */
export async function recordDealChangeInConversation(
  tx: DealTransaction,
  tenantId: string,
  dealId: string,
  content: string,
  conversationId?: string | null,
) {
  const contexts = await tx
    .select({ conversationId: conversationDealContexts.conversationId })
    .from(conversationDealContexts)
    .where(
      and(
        eq(conversationDealContexts.tenantId, tenantId),
        eq(conversationDealContexts.currentDealId, dealId),
        conversationId ? eq(conversationDealContexts.conversationId, conversationId) : undefined,
      ),
    );
  for (const context of contexts)
    await tx.insert(messages).values({
      id: `crm-${crypto.randomUUID()}`,
      tenantId,
      conversationId: context.conversationId,
      senderType: "system",
      senderName: "Sistema",
      isInternalNote: true,
      direction: "outbound",
      status: "accepted",
      content,
    });
}
