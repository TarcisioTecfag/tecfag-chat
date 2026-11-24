import type {
  LiveConversation,
  LiveData,
  LiveOperator,
  LiveSectorOption,
  LiveSummary,
} from "../monitor-mock-data";
import { buildPhoneQueryPlan, matchesPhoneSearchQuery } from "../utils";

export interface LiveFilterCriteria {
  opIdFilter?: string;
  sectorIdFilter?: string;
  pipelineFilter?: string;
  searchTerm?: string;
}

export interface FilteredLiveDataset {
  operators: LiveOperator[];
  unassigned: LiveConversation[];
  automation: LiveConversation[];
  summary: LiveSummary;
}

/**
 * Resolve se uma conversa pertence ao setor filtrado.
 * Regra canônica (mesma de /api/gestao/performance):
 * 1. Se a conversa possui `sectorId` explícito, usa exclusivamente `conv.sectorId === sectorId`.
 * 2. Se `conv.sectorId` é nulo/indefinido, faz fallback para o conjunto de operadores do setor.
 */
export function matchesLiveSector(
  conv: { sectorId?: string | null; operatorId?: string | null },
  sectorIdFilter: string | null | undefined,
  sectorOperatorIds?: ReadonlySet<string> | null
): boolean {
  const normalized = (sectorIdFilter || "").trim();
  if (!normalized) return true;
  if (conv.sectorId) {
    return conv.sectorId === normalized;
  }
  if (conv.operatorId && sectorOperatorIds && sectorOperatorIds.has(conv.operatorId)) {
    return true;
  }
  return false;
}

/**
 * Resolve se uma conversa atende ao filtro de funil CRM.
 * - `""`: todos os atendimentos
 * - `"__with_deal__"`: apenas com negócio ABERTO vinculado
 * - `<pipelineId>`: negócio ativo naquele funil OU presente em `linkedPipelineIds`
 */
export function matchesLivePipeline(
  conv: Pick<LiveConversation, "activeDeal" | "linkedPipelineIds" | "hasOpenDeal">,
  pipelineFilter: string | null | undefined
): boolean {
  const normalized = (pipelineFilter || "").trim();
  if (!normalized) return true;
  if (normalized === "__with_deal__") {
    if (typeof conv.hasOpenDeal === "boolean") {
      return conv.hasOpenDeal;
    }
    return Boolean(conv.activeDeal && conv.activeDeal.status === "open");
  }
  if (conv.activeDeal?.pipelineId === normalized) return true;
  if (Array.isArray(conv.linkedPipelineIds) && conv.linkedPipelineIds.includes(normalized)) {
    return true;
  }
  return false;
}

/**
 * Resolve busca textual/telefone em cliente, telefone, empresa, negócio ou operador.
 */
export function matchesLiveSearch(
  conv: Pick<
    LiveConversation,
    "contactName" | "contactPhone" | "accountName" | "activeDeal"
  >,
  searchTerm: string | null | undefined
): boolean {
  const searchLower = (searchTerm || "").toLowerCase().trim();
  if (!searchLower) return true;
  const phonePlan = buildPhoneQueryPlan(searchTerm || "");
  return (
    (conv.contactName?.toLowerCase().includes(searchLower) ?? false) ||
    matchesPhoneSearchQuery(conv.contactPhone || "", phonePlan) ||
    (conv.accountName?.toLowerCase().includes(searchLower) ?? false) ||
    (conv.activeDeal?.title?.toLowerCase().includes(searchLower) ?? false)
  );
}

/**
 * Recalcula as métricas de um operador exclusivamente a partir do conjunto de conversas filtrado.
 */
export function recomputeOperatorMetrics(
  op: LiveOperator,
  conversations: LiveConversation[]
): LiveOperator {
  const waitingReplyCount = conversations.filter((c) => c.isUnanswered).length;
  const criticalWaitCount = conversations.filter(
    (c) => c.isUnanswered && c.waitingMinutes >= 15
  ).length;
  const activeTodayCount = conversations.filter(
    (c) => c.isActiveToday || c.isUnanswered
  ).length;
  const awaitingFirstContactCount = conversations.filter(
    (c) => c.activityCategory === "awaiting_first_contact"
  ).length;
  const dormantCount = conversations.filter(
    (c) => c.activityCategory === "dormant" || c.activityCategory === "recent_active"
  ).length;
  const maxWaitMinutes = conversations.reduce(
    (max, c) => (c.isUnanswered && c.waitingMinutes > max ? c.waitingMinutes : max),
    0
  );

  const seenDealIds = new Set<string>();
  const activeDealsValue = conversations.reduce((sum, c) => {
    if (
      c.activeDeal &&
      c.activeDeal.status === "open" &&
      c.activeDeal.value &&
      !seenDealIds.has(c.activeDeal.id)
    ) {
      seenDealIds.add(c.activeDeal.id);
      return sum + Number(c.activeDeal.value);
    }
    return sum;
  }, 0);

  const failedDeliveriesCount = conversations.filter(
    (c) => (c.failedMessagesCount ?? 0) > 0
  ).length;
  const expiringWindowCount = conversations.filter(
    (c) =>
      Boolean(c.metaWindowOpen) &&
      typeof c.metaWindowRemainingMinutes === "number" &&
      c.metaWindowRemainingMinutes <= 120
  ).length;

  const hasPerConvSent = conversations.some(
    (c) => typeof c.sentMessagesToday === "number"
  );
  const sentMessagesToday = hasPerConvSent
    ? conversations.reduce((acc, c) => acc + (c.sentMessagesToday ?? 0), 0)
    : conversations.length === op.conversations.length
    ? (op.sentMessagesToday ?? 0)
    : 0;

  const hasPerConvDeltas = conversations.some((c) =>
    Array.isArray(c.responseDeltasMinutes)
  );
  let avgResponseMinutesToday: number | null;
  if (hasPerConvDeltas) {
    const allDeltas = conversations.flatMap((c) => c.responseDeltasMinutes ?? []);
    avgResponseMinutesToday =
      allDeltas.length > 0
        ? Math.max(
            1,
            Math.round(allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length)
          )
        : null;
  } else {
    avgResponseMinutesToday =
      conversations.length === op.conversations.length
        ? (op.avgResponseMinutesToday ?? null)
        : null;
  }

  return {
    ...op,
    waitingReplyCount,
    criticalWaitCount,
    activeTodayCount,
    awaitingFirstContactCount,
    dormantCount,
    maxWaitMinutes,
    activeDealsValue,
    failedDeliveriesCount,
    expiringWindowCount,
    sentMessagesToday,
    avgResponseMinutesToday,
    conversations,
  };
}

/**
 * Recalcula o summary executivo exclusivamente sobre o dataset já filtrado.
 */
export function computeLiveSummary(
  operators: LiveOperator[],
  unassigned: LiveConversation[],
  automation: LiveConversation[]
): LiveSummary {
  const allOpConvs = operators.flatMap((o) => o.conversations);
  const allLiveConvs = [...allOpConvs, ...unassigned, ...automation];
  const allUnanswered = [
    ...allOpConvs.filter((c) => c.isUnanswered),
    ...unassigned,
  ];

  const maxWaitMinutes = allUnanswered.reduce(
    (max, c) => (c.waitingMinutes > max ? c.waitingMinutes : max),
    0
  );
  const avgWaitMinutes =
    allUnanswered.length > 0
      ? Math.round(
          allUnanswered.reduce((acc, c) => acc + c.waitingMinutes, 0) /
            allUnanswered.length
        )
      : 0;

  const seenDealIds = new Set<string>();
  let activePipelineValue = 0;
  let openDealsInLiveCount = 0;

  for (const c of allLiveConvs) {
    if (
      c.activeDeal &&
      c.activeDeal.status === "open" &&
      !seenDealIds.has(c.activeDeal.id)
    ) {
      seenDealIds.add(c.activeDeal.id);
      openDealsInLiveCount += 1;
      if (c.activeDeal.value) {
        activePipelineValue += Number(c.activeDeal.value);
      }
    }
  }

  const failedDeliveriesCount = allLiveConvs.filter(
    (c) => (c.failedMessagesCount ?? 0) > 0
  ).length;
  const expiringWindowsCount = allLiveConvs.filter(
    (c) =>
      Boolean(c.metaWindowOpen) &&
      typeof c.metaWindowRemainingMinutes === "number" &&
      c.metaWindowRemainingMinutes <= 120
  ).length;
  const overdueTasksConversationsCount = allLiveConvs.filter(
    (c) => (c.overdueTasksCount ?? 0) > 0
  ).length;
  const totalSentMessagesToday = operators.reduce(
    (acc, op) => acc + (op.sentMessagesToday ?? 0),
    0
  );

  return {
    totalOperators: operators.length,
    onlineOperators: operators.filter((o) => o.isOnline).length,
    unassignedQueueCount: unassigned.length,
    automationCount: automation.length,
    waitingReplyCount: allOpConvs.filter((c) => c.isUnanswered).length,
    criticalWaitCount: allUnanswered.filter((c) => c.waitingMinutes >= 15).length,
    activeTodayCount: allOpConvs.filter((c) => c.isActiveToday || c.isUnanswered).length,
    awaitingFirstContactCount: allOpConvs.filter(
      (c) => c.activityCategory === "awaiting_first_contact"
    ).length,
    dormantCount: allOpConvs.filter(
      (c) => c.activityCategory === "dormant" || c.activityCategory === "recent_active"
    ).length,
    maxWaitMinutes,
    avgWaitMinutes,
    activePipelineValue,
    openDealsInLiveCount,
    failedDeliveriesCount,
    expiringWindowsCount,
    overdueTasksConversationsCount,
    totalSentMessagesToday,
  };
}

/**
 * Aplica TODOS os filtros ativos (operador, setor, funil CRM e busca) de forma estrita
 * e consistente sobre operadores, fila, automação e summary executivo.
 * Garante que o Cockpit Executivo, Radar Executivo de Prioridade, Equipe & Produtividade
 * e Sidebar compartilhem exatamente o mesmo recorte filtrado — sem vazamento.
 */
export function filterLiveDataset(
  liveData: LiveData | null,
  criteria: LiveFilterCriteria
): FilteredLiveDataset {
  const opIdFilter = (criteria.opIdFilter || "").trim();
  const sectorIdFilter = (criteria.sectorIdFilter || "").trim();
  const pipelineFilter = (criteria.pipelineFilter || "").trim();
  const searchTerm = (criteria.searchTerm || "").trim();

  if (!liveData) {
    return {
      operators: [],
      unassigned: [],
      automation: [],
      summary: computeLiveSummary([], [], []),
    };
  }

  const sectorObj: LiveSectorOption | undefined = sectorIdFilter
    ? (liveData.sectors ?? []).find((s) => s.id === sectorIdFilter)
    : undefined;
  const sectorOpSet = sectorObj ? new Set(sectorObj.operatorIds) : null;

  const convMatchesAll = (c: LiveConversation) =>
    matchesLiveSector(c, sectorIdFilter, sectorOpSet) &&
    matchesLivePipeline(c, pipelineFilter) &&
    matchesLiveSearch(c, searchTerm);

  const hasRestrictiveConvFilter = Boolean(pipelineFilter || searchTerm);

  const filteredOperators: LiveOperator[] = [];
  for (const op of liveData.operators ?? []) {
    if (opIdFilter && op.operatorId !== opIdFilter) continue;

    const belongsToSector =
      !sectorIdFilter ||
      Boolean(sectorOpSet?.has(op.operatorId)) ||
      Boolean(op.sectorIds?.includes(sectorIdFilter));

    const filteredConvs = (op.conversations ?? []).filter((c) => {
      if (opIdFilter && c.operatorId && c.operatorId !== opIdFilter) return false;
      return convMatchesAll(c);
    });

    if (sectorIdFilter && !belongsToSector && filteredConvs.length === 0) {
      continue;
    }

    // Quando há filtro de funil ou busca sem operador explícito fixado, oculta operadores sem atendimentos no recorte
    if (!opIdFilter && hasRestrictiveConvFilter && filteredConvs.length === 0) {
      continue;
    }

    filteredOperators.push(recomputeOperatorMetrics(op, filteredConvs));
  }

  filteredOperators.sort((a, b) => {
    const waitDiff = (b.waitingReplyCount ?? 0) - (a.waitingReplyCount ?? 0);
    if (waitDiff !== 0) return waitDiff;
    const activeDiff = (b.activeTodayCount ?? 0) - (a.activeTodayCount ?? 0);
    if (activeDiff !== 0) return activeDiff;
    if (Boolean(a.isOnline) !== Boolean(b.isOnline)) {
      return a.isOnline ? -1 : 1;
    }
    const convDiff = b.conversations.length - a.conversations.length;
    if (convDiff !== 0) return convDiff;
    return a.operatorName.localeCompare(b.operatorName, "pt-BR");
  });

  // Quando um operador específico está selecionado, fila sem consultor e triagem IA NÃO pertencem a ele
  const filteredUnassigned = opIdFilter
    ? []
    : (liveData.unassigned ?? []).filter(convMatchesAll);

  const filteredAutomation = opIdFilter
    ? []
    : (liveData.automation ?? []).filter(convMatchesAll);

  const summary = computeLiveSummary(
    filteredOperators,
    filteredUnassigned,
    filteredAutomation
  );

  return {
    operators: filteredOperators,
    unassigned: filteredUnassigned,
    automation: filteredAutomation,
    summary,
  };
}
