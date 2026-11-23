import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  agentConfigs,
  agentFlowStates,
  contacts,
  conversations,
  crmConversationDeals,
  crmDealEvents,
  crmDeals,
  crmPipelines,
  crmStages,
  messages,
  operators,
  sectors,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { setAttendanceActor } from "../attendance-events";
import { SessionManager } from "../baileys/session-manager";
import { sendPushToOperator } from "../push-notifications";
import { notifyOperatorLeadTransferred } from "../valentina/operator-notifications";
import { sendSdrChannelText } from "../valentina/sdr-channel-sender";
import { SdrDebouncer } from "../valentina/sdr-debouncer";
import { getBrtTodayYmd, isOperatorOnLeaveToday } from "../valentina/rodizio-types";
import { ensureCwrDealOnContacting, moveDealOnSdrApproval } from "./industrial-cwr-crm";
import type { MachineDecision } from "./industrial-decisor";
import { industrialHandoffMessage } from "./industrial-handoff";
import {
  assessIndustrialReadiness,
  INDUSTRIAL_POLICY_VERSION,
  INDUSTRIAL_REVIEW_FUNNEL,
  isEligibleIndustrialOperator,
  normalizeIndustrialFunnel,
  normalizeTriageText,
  type CollectedFields,
  type IndustrialRoute,
} from "./industrial-policy";
import {
  lockIndustrialRodizio,
  writeIndustrialRodizio,
  type IndustrialDatabase,
  type IndustrialTransaction,
  type RodizioConfig,
} from "./industrial-rodizio-store";
import {
  DESTINATION_KEYS,
  INDUSTRIAL_DESTINATIONS,
  industrialDestinationKey,
  resolveIndustrialDestination,
  type IndustrialDestinationKey,
} from "./industrial-settings";
import { readIndustrialSettings } from "./industrial-settings-store";
import {
  buildIndustrialOffHoursClosingNotice,
  deterministicIndustrialHandoffConfirmMessageId,
  isWithinIndustrialSchedule,
  parseIndustrialScheduleConfig,
} from "./industrial-silence-policy";
import { appendIndustrialJournal } from "./industrial-triage-journal-store";
import { isSdrAnalysisFlowOperator } from "./sdr-disabled-routing";

export class IndustrialApprovalError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ApprovalActor {
  id: string | null;
  name: string;
  role: string;
  canAccessSdr: boolean;
}

export interface PendingApprovalSuggestion {
  version: 1;
  cycle: string;
  preparedAt: string;
  subflow: string | null;
  targetFunnel: string | null;
  destinationKey: IndustrialDestinationKey | null;
  suggestedSectorId: string | null;
  suggestedSectorName: string | null;
  suggestedOperatorId: string | null;
  suggestedOperatorName: string | null;
  suggestedOperatorIsAbsent: boolean;
  suggestedPipelineId: string | null;
  suggestedPipelineName: string | null;
  suggestedStageId: string | null;
  suggestedStageName: string | null;
  reason: string | null;
  needsReview: boolean;
  dealId: string | null;
  clientName: string;
  companyName: string;
}

function assertApprovalPermission(actor: ApprovalActor) {
  if (actor.role !== "admin" && !actor.canAccessSdr) {
    throw new IndustrialApprovalError(
      403,
      "Permissão insuficiente. Apenas operadores com acesso à tela SDR ou administradores podem aprovar triagens.",
    );
  }
}

/**
 * Calcula a sugestão completa do Fagner (Setor + Operador do Rodízio + Funil/Etapa CRM)
 * em modo SOMENTE LEITURA (sem consumir slot do rodízio, sem transferir e sem mover o card).
 */
export async function computePendingApprovalSuggestion(
  tx: IndustrialDatabase | IndustrialTransaction,
  params: {
    tenantId: string;
    conversationId: string;
    cycle: string;
    route: IndustrialRoute;
    data: CollectedFields;
    clientName: string;
    companyName: string;
    machineDecision?: MachineDecision;
    dealId?: string | null;
  },
): Promise<PendingApprovalSuggestion> {
  const { tenantId, conversationId, cycle, route, data } = params;

  const [
    settingsState,
    rodizioRow,
    tenantSectors,
    tenantOperators,
    tenantPipelines,
    tenantStages,
  ] = await Promise.all([
    readIndustrialSettings(tx, tenantId).catch(() => ({
      row: undefined,
      revision: 0,
      settings: { version: 1 as const, catalog: [], blockedFamilies: [], destinations: {} },
      catalogFingerprint: "",
    })),
    tx
      .select()
      .from(agentConfigs)
      .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "rodizio")))
      .limit(1)
      .then((rows) => rows[0] || null),
    tx
      .select({ id: sectors.id, name: sectors.name, operatorIds: sectors.operatorIds })
      .from(sectors)
      .where(eq(sectors.tenantId, tenantId))
      .orderBy(asc(sectors.name)),
    tx
      .select({ id: operators.id, name: operators.name, status: operators.status })
      .from(operators)
      .where(eq(operators.tenantId, tenantId))
      .orderBy(asc(operators.name)),
    tx
      .select({ id: crmPipelines.id, name: crmPipelines.name })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId))
      .orderBy(asc(crmPipelines.orderIndex)),
    tx
      .select({
        id: crmStages.id,
        name: crmStages.name,
        pipelineId: crmStages.pipelineId,
        isWinStage: crmStages.isWinStage,
        isLossStage: crmStages.isLossStage,
      })
      .from(crmStages)
      .where(eq(crmStages.tenantId, tenantId))
      .orderBy(asc(crmStages.orderIndex)),
  ]);

  let readiness = assessIndustrialReadiness(route, data);
  const machine = params.machineDecision;
  const isCommercial = ["MAQUINAS", "PERSONNALITE"].includes(route.subflow || "");
  const validCatalogDecision =
    machine?.status === "confirmed" &&
    (machine.line === "SEMI-INDUSTRIAL" || machine.line === "PERSONNALITE") &&
    Number.isFinite(machine.confidence) &&
    machine.confidence >= 0.95 &&
    machine.confidence <= 1 &&
    settingsState.settings.catalog.some(
      (entry) => entry.active && entry.id === machine.machineId && entry.line === machine.line,
    );

  if (isCommercial && !validCatalogDecision && route.reason !== "direct_operator_requested") {
    readiness = { ...readiness, action: "review", createsDeal: false };
  }

  const destinationKey: IndustrialDestinationKey | null =
    route.reason === "direct_operator_requested"
      ? industrialDestinationKey(route) || "REVIEW"
      : readiness.action === "review"
        ? "REVIEW"
        : industrialDestinationKey(route);

  const resolvedDest = destinationKey
    ? resolveIndustrialDestination(settingsState.settings, destinationKey).destination || null
    : null;

  const targetFunnel =
    readiness.action === "review" && route.reason !== "direct_operator_requested"
      ? INDUSTRIAL_REVIEW_FUNNEL
      : route.targetFunnel
        ? normalizeIndustrialFunnel(route.targetFunnel)
        : destinationKey
          ? INDUSTRIAL_DESTINATIONS[destinationKey].label
          : null;

  const rodizioConfig = ((rodizioRow?.config as RodizioConfig | undefined) || {}) as RodizioConfig;
  const flowOps = Array.isArray(rodizioConfig.flowOperators) ? rodizioConfig.flowOperators : [];
  const todayBrt = getBrtTodayYmd();
  const registeredIds = new Set(tenantOperators.map((o) => o.id));
  const opById = new Map(tenantOperators.map((o) => [o.id, o]));

  let suggestedSector = resolvedDest?.sectorId
    ? tenantSectors.find((s) => s.id === resolvedDest.sectorId) || null
    : null;

  let suggestedOperatorId: string | null = null;
  let suggestedOperatorName: string | null = null;
  let suggestedOperatorIsAbsent = false;

  // Caso 1: pedido nominal de operador específico (ainda assim aguarda aprovação do SDR!)
  if (route.reason === "direct_operator_requested" && route.targetOperator?.id) {
    const targetOp = opById.get(route.targetOperator.id);
    if (targetOp) {
      const flowOp = flowOps.find((o) => o.id === targetOp.id);
      suggestedOperatorId = targetOp.id;
      suggestedOperatorName = targetOp.name;
      suggestedOperatorIsAbsent = Boolean(
        route.targetOperator.isAbsent ||
          (flowOp && isOperatorOnLeaveToday(flowOp, todayBrt)) ||
          normalizeTriageText(targetOp.status || "") === "ausente",
      );
      if (!suggestedSector) {
        suggestedSector =
          tenantSectors.find(
            (s) => Array.isArray(s.operatorIds) && s.operatorIds.includes(targetOp.id),
          ) || null;
      }
    }
  }

  // Caso 2: pré-seleção pelo Rodízio (somente leitura — NÃO incrementa leadsReceivedCount)
  if (!suggestedOperatorId && targetFunnel) {
    const sectorOpIds = Array.isArray(suggestedSector?.operatorIds)
      ? suggestedSector!.operatorIds
      : null;

    const pickFromRodizio = (restrictToSector: boolean) => {
      const candidates = flowOps.filter((op) => {
        if (!op || !registeredIds.has(op.id)) return false;
        if (isOperatorOnLeaveToday(op, todayBrt)) return false;
        if (restrictToSector && sectorOpIds && !sectorOpIds.includes(op.id)) return false;
        return isEligibleIndustrialOperator(
          {
            id: op.id,
            funnels: op.funnels || [],
            isParticipating: op.isParticipating ?? true,
            isOnLeave: isOperatorOnLeaveToday(op, todayBrt),
            isPenalized: op.isPenalized,
          },
          targetFunnel,
          registeredIds,
        );
      });

      candidates.sort(
        (a, b) =>
          (a.leadsReceivedCount || 0) -
            (a.compensation || 0) -
            ((b.leadsReceivedCount || 0) - (b.compensation || 0)) ||
          (a.leadsReceivedCount || 0) - (b.leadsReceivedCount || 0) ||
          a.id.localeCompare(b.id),
      );
      return candidates[0] || null;
    };

    const chosen = pickFromRodizio(true) || pickFromRodizio(false);
    if (chosen) {
      const opRow = opById.get(chosen.id);
      if (opRow) {
        suggestedOperatorId = opRow.id;
        suggestedOperatorName = opRow.name;
        suggestedOperatorIsAbsent = normalizeTriageText(opRow.status || "") === "ausente";
        if (!suggestedSector) {
          suggestedSector =
            tenantSectors.find(
              (s) => Array.isArray(s.operatorIds) && s.operatorIds.includes(opRow.id),
            ) || null;
        }
      }
    }
  }

  // Resolver Funil + Etapa CRM sugeridos (de Fluxos, ou fallback por nome do destino)
  let suggestedPipeline = resolvedDest?.pipelineId
    ? tenantPipelines.find((p) => p.id === resolvedDest.pipelineId) || null
    : null;
  let suggestedStage = resolvedDest?.stageId
    ? tenantStages.find(
        (st) => st.id === resolvedDest.stageId && (!suggestedPipeline || st.pipelineId === suggestedPipeline.id),
      ) || null
    : null;

  if (!suggestedPipeline && targetFunnel) {
    const normFunnel = normalizeTriageText(targetFunnel);
    suggestedPipeline =
      tenantPipelines.find((p) => normalizeTriageText(p.name).includes(normFunnel)) ||
      (normFunnel.includes("pos venda") || normFunnel.includes("assistencia")
        ? tenantPipelines.find((p) => normalizeTriageText(p.name).includes("suporte")) || null
        : null);
  }

  if (suggestedPipeline && !suggestedStage) {
    const openStages = tenantStages.filter(
      (st) => st.pipelineId === suggestedPipeline!.id && !st.isWinStage && !st.isLossStage,
    );
    if (targetFunnel && normalizeTriageText(targetFunnel).includes("pos venda")) {
      suggestedStage =
        openStages.find((st) => normalizeTriageText(st.name).includes("rastreio")) ||
        openStages[0] ||
        null;
    } else {
      suggestedStage = openStages[0] || null;
    }
  }

  let resolvedDealId = params.dealId || null;
  if (!resolvedDealId) {
    const [activeLink] = await tx
      .select({ dealId: crmConversationDeals.dealId })
      .from(crmConversationDeals)
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.conversationId, conversationId),
          eq(crmConversationDeals.isActive, true),
        ),
      )
      .orderBy(desc(crmConversationDeals.createdAt))
      .limit(1);
    resolvedDealId = activeLink?.dealId || null;
  }

  return {
    version: 1,
    cycle,
    preparedAt: new Date().toISOString(),
    subflow: route.subflow || null,
    targetFunnel,
    destinationKey,
    suggestedSectorId: suggestedSector?.id || null,
    suggestedSectorName: suggestedSector?.name || null,
    suggestedOperatorId,
    suggestedOperatorName,
    suggestedOperatorIsAbsent,
    suggestedPipelineId: suggestedPipeline?.id || null,
    suggestedPipelineName: suggestedPipeline?.name || null,
    suggestedStageId: suggestedStage?.id || null,
    suggestedStageName: suggestedStage?.name || null,
    reason: route.reason || null,
    needsReview: Boolean(route.needsReview || readiness.action === "review"),
    dealId: resolvedDealId,
    clientName: params.clientName,
    companyName: params.companyName,
  };
}

/**
 * Coloca a triagem em modo Human-in-the-Loop (`awaiting_approval`):
 * - Salva a sugestão pré-calculada (sem consumir rodízio nem transferir o cliente).
 * - Garante que o card CWR exista em `CONTATANDO`.
 * - Pausa o Fagner nesta conversa até decisão do SDR humano.
 */
export async function prepareIndustrialApproval(
  database: IndustrialDatabase,
  key: { tenantId: string; conversationId: string; flowId: string; cycle: string },
  input: {
    route: IndustrialRoute;
    data: CollectedFields;
    clientName: string;
    companyName: string;
    contactId: string | null;
    machineDecision?: MachineDecision;
    siteContext?: unknown;
  },
): Promise<{ prepared: boolean; suggestion: PendingApprovalSuggestion | null }> {
  return database.transaction(async (tx) => {
    const [conv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, key.tenantId), eq(conversations.id, key.conversationId)))
      .for("update");
    if (!conv || conv.operatorId || conv.queueState === "meus" || conv.queueState === "finalizados") {
      return { prepared: false, suggestion: null };
    }

    const [flow] = await tx
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, key.tenantId),
          eq(agentFlowStates.id, key.flowId),
          eq(agentFlowStates.conversationId, key.conversationId),
          eq(agentFlowStates.agentType, "sdr"),
        ),
      )
      .for("update");

    if (!flow || flow.outcome !== "in_progress") {
      return { prepared: false, suggestion: null };
    }

    // Garantir card no FUNIL CWR em CONTATANDO antes de aguardar aprovação
    const cwrResult = await ensureCwrDealOnContacting(tx, {
      tenantId: key.tenantId,
      conversationId: key.conversationId,
      contactId: input.contactId || conv.contactId,
      clientName: input.clientName,
      companyName: input.companyName,
      actorName: getAiPersona(key.tenantId).name,
    });

    const suggestion = await computePendingApprovalSuggestion(tx, {
      tenantId: key.tenantId,
      conversationId: key.conversationId,
      cycle: key.cycle,
      route: input.route,
      data: input.data,
      clientName: input.clientName,
      companyName: input.companyName,
      machineDecision: input.machineDecision,
      dealId: cwrResult.dealId || null,
    });

    const now = new Date();
    const currentMeta = (flow.metadata as Record<string, unknown>) || {};
    const nextMeta: Record<string, unknown> = {
      ...currentMeta,
      triagePolicyVersion: INDUSTRIAL_POLICY_VERSION,
      subflow: input.route.subflow,
      funnelStage: input.route.funnelStage,
      targetFunnel: suggestion.targetFunnel,
      needsReview: suggestion.needsReview,
      routeReason: input.route.reason,
      missingFields: [],
      readyForHandoff: true,
      handoffStatus: "awaiting_approval",
      pendingApproval: suggestion,
      ...(input.machineDecision ? { machineDecision: input.machineDecision } : {}),
      ...(suggestion.dealId ? { localCrmDealId: suggestion.dealId } : {}),
      ...(cwrResult.dealTitle ? { localCrmDealTitle: cwrResult.dealTitle } : {}),
      ...(suggestion.suggestedOperatorId ? { suggestedOperatorId: suggestion.suggestedOperatorId } : {}),
      ...(suggestion.suggestedOperatorName ? { suggestedOperatorName: suggestion.suggestedOperatorName } : {}),
    };

    const [updated] = await tx
      .update(agentFlowStates)
      .set({
        collectedData: input.data,
        currentStep: "Aguardando Aprovação SDR",
        outcome: "in_progress",
        completedAt: null,
        lastInteractionAt: now,
        metadata: nextMeta,
      })
      .where(and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, flow.id)))
      .returning();

    if (updated) {
      await appendIndustrialJournal(tx, flow, updated, "collection", `approval:${key.cycle}`);
    }

    return { prepared: true, suggestion };
  });
}

/**
 * Emite alerta em tempo real (SSE + Web Push) para a equipe do setor SDR
 * avisando que o Fagner concluiu uma triagem e aguarda aprovação humana.
 */
export async function notifySdrTeamApprovalPending(
  database: IndustrialDatabase,
  params: {
    tenantId: string;
    conversationId: string;
    suggestion: PendingApprovalSuggestion;
  },
): Promise<void> {
  const { tenantId, conversationId, suggestion } = params;
  const persona = getAiPersona(tenantId);

  try {
    SessionManager.getInstance().notifyPublic(tenantId, {
      type: "sdr_approval_pending",
      conversationId,
      clientName: suggestion.clientName,
      companyName: suggestion.companyName,
      targetFunnel: suggestion.targetFunnel,
      suggestedOperatorName: suggestion.suggestedOperatorName,
      suggestedSectorName: suggestion.suggestedSectorName,
      preparedAt: suggestion.preparedAt,
    });
    SessionManager.getInstance().notifyPublic(tenantId, {
      type: "sdr_flow_updated",
      conversationId,
      funnelStage: suggestion.subflow || "triagem",
      targetFunnel: suggestion.targetFunnel,
      outcome: "in_progress",
      handoffStatus: "awaiting_approval",
    });
  } catch (err: any) {
    console.warn("[IndustrialApproval] Falha ao emitir SSE de aprovação pendente:", err?.message);
  }

  // Enviar Web Push para os operadores do setor SDR / pasta "SDR / Análise"
  try {
    const [tenantSectors, rodizioRow] = await Promise.all([
      database
        .select({ id: sectors.id, name: sectors.name, operatorIds: sectors.operatorIds })
        .from(sectors)
        .where(eq(sectors.tenantId, tenantId)),
      database
        .select({ config: agentConfigs.config })
        .from(agentConfigs)
        .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "rodizio")))
        .limit(1)
        .then((rows) => rows[0] || null),
    ]);

    const recipientIds = new Set<string>();
    for (const sec of tenantSectors) {
      const norm = normalizeTriageText(sec.name || "");
      if (norm === "sdr" || norm.includes("sdr") || norm.includes("triagem")) {
        for (const opId of Array.isArray(sec.operatorIds) ? sec.operatorIds : []) {
          recipientIds.add(opId);
        }
      }
    }

    const flowOps = Array.isArray((rodizioRow?.config as RodizioConfig | undefined)?.flowOperators)
      ? (rodizioRow!.config as RodizioConfig).flowOperators!
      : [];
    const todayBrt = getBrtTodayYmd();
    for (const op of flowOps) {
      if (op?.id && isSdrAnalysisFlowOperator(op, todayBrt)) {
        recipientIds.add(op.id);
      }
    }

    const summaryDest = [suggestion.targetFunnel, suggestion.suggestedOperatorName]
      .filter(Boolean)
      .join(" → ");

    await Promise.allSettled(
      [...recipientIds].map((opId) =>
        sendPushToOperator(tenantId, opId, {
          title: `Triagem pronta para aprovação (${persona.name})`,
          body: `${suggestion.clientName}${summaryDest ? ` • Sugestão: ${summaryDest}` : ""}`,
          conversationId,
          tenantId,
          url: `/?view=valentina&sdrChatId=${conversationId}`,
        }),
      ),
    );
  } catch (pushErr: any) {
    console.warn("[IndustrialApproval] Falha ao enviar push ao setor SDR:", pushErr?.message);
  }
}

/**
 * Carrega todas as opções válidas (Setores, Operadores com info de rodízio, Pipelines, Etapas
 * e Destinos configurados em Fluxos) para o painel de aprovação da UI.
 */
export async function loadIndustrialApprovalOptions(
  database: IndustrialDatabase,
  tenantId: string,
) {
  const [
    settingsState,
    rodizioRow,
    tenantSectors,
    tenantOperators,
    tenantPipelines,
    tenantStages,
    activeChatsRows,
  ] = await Promise.all([
    readIndustrialSettings(database, tenantId).catch(() => ({
      row: undefined,
      revision: 0,
      settings: { version: 1 as const, catalog: [], blockedFamilies: [], destinations: {} },
      catalogFingerprint: "",
    })),
    database
      .select({ config: agentConfigs.config })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "rodizio")))
      .limit(1)
      .then((rows) => rows[0] || null),
    database
      .select({ id: sectors.id, name: sectors.name, operatorIds: sectors.operatorIds })
      .from(sectors)
      .where(eq(sectors.tenantId, tenantId))
      .orderBy(asc(sectors.name)),
    database
      .select({
        id: operators.id,
        name: operators.name,
        email: operators.email,
        role: operators.role,
        status: operators.status,
        avatar: operators.avatar,
      })
      .from(operators)
      .where(eq(operators.tenantId, tenantId))
      .orderBy(asc(operators.name)),
    database
      .select({ id: crmPipelines.id, name: crmPipelines.name, color: crmPipelines.color })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId))
      .orderBy(asc(crmPipelines.orderIndex)),
    database
      .select({
        id: crmStages.id,
        name: crmStages.name,
        pipelineId: crmStages.pipelineId,
        orderIndex: crmStages.orderIndex,
        isWinStage: crmStages.isWinStage,
        isLossStage: crmStages.isLossStage,
      })
      .from(crmStages)
      .where(eq(crmStages.tenantId, tenantId))
      .orderBy(asc(crmStages.orderIndex)),
    database
      .select({
        operatorId: conversations.operatorId,
        count: sql<number>`count(*)::int`,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.queueState, "meus"),
          isNull(conversations.whatsappConnectionId),
        ),
      )
      .groupBy(conversations.operatorId),
  ]);

  const activeChatsByOp = new Map<string, number>();
  for (const r of activeChatsRows) {
    if (r.operatorId) activeChatsByOp.set(r.operatorId, Number(r.count || 0));
  }

  const flowOps = Array.isArray((rodizioRow?.config as RodizioConfig | undefined)?.flowOperators)
    ? (rodizioRow!.config as RodizioConfig).flowOperators!
    : [];
  const flowById = new Map(flowOps.map((op) => [op.id, op]));
  const todayBrt = getBrtTodayYmd();

  const destinations: Record<
    string,
    {
      key: IndustrialDestinationKey;
      label: string;
      sectorId: string | null;
      pipelineId: string | null;
      stageId: string | null;
    }
  > = {};

  for (const key of DESTINATION_KEYS) {
    const resolved = resolveIndustrialDestination(settingsState.settings, key).destination;
    destinations[key] = {
      key,
      label: INDUSTRIAL_DESTINATIONS[key].label,
      sectorId: resolved?.sectorId || null,
      pipelineId: resolved?.pipelineId || null,
      stageId: resolved?.stageId || null,
    };
  }

  return {
    sectors: tenantSectors.map((s) => ({
      id: s.id,
      name: s.name,
      operatorIds: Array.isArray(s.operatorIds) ? s.operatorIds : [],
    })),
    operators: tenantOperators.map((op) => {
      const fOp = flowById.get(op.id);
      return {
        id: op.id,
        name: op.name,
        email: op.email,
        role: op.role,
        status: op.status,
        avatar: op.avatar || null,
        funnels: Array.isArray(fOp?.funnels) ? fOp!.funnels : [],
        isParticipating: fOp ? (fOp.isParticipating ?? true) : false,
        isOnLeave: fOp ? isOperatorOnLeaveToday(fOp, todayBrt) : false,
        leadsReceivedCount: Number(fOp?.leadsReceivedCount || 0),
        compensation: Number(fOp?.compensation || 0),
        activeChatsNow: activeChatsByOp.get(op.id) || 0,
      };
    }),
    pipelines: tenantPipelines,
    stages: tenantStages.filter((st) => !st.isWinStage && !st.isLossStage),
    destinations,
  };
}

export interface ApproveIndustrialTriageInput {
  conversationId: string;
  sectorId?: string | null;
  operatorId: string;
  pipelineId?: string | null;
  stageId?: string | null;
  targetFunnel?: string | null;
  sendClientConfirmation?: boolean;
  note?: string | null;
}

/**
 * Aprovação oficial pelo SDR Humano (Human-in-the-Loop):
 * - Consome o slot do rodízio no operador final aprovado.
 * - Move o card do FUNIL CWR para o Funil + Etapa escolhidos com o responsável alocado + tarefa "Responder o contato".
 * - Transfere a conversa para `meus` do operador e atualiza carteira (`walletOperatorId`).
 * - Conclui o ciclo do Fagner (`outcome = "transferred"`) para ocultar imediatamente do Kanban ativo.
 * - Pós-commit: envia confirmação oficial ao cliente (com aviso de fora do expediente se aplicável) e notifica o operador.
 */
export async function approveIndustrialTriage(
  database: IndustrialDatabase,
  tenantId: string,
  actor: ApprovalActor,
  input: ApproveIndustrialTriageInput,
) {
  assertApprovalPermission(actor);
  const { conversationId, operatorId } = input;
  if (!conversationId || !operatorId) {
    throw new IndustrialApprovalError(400, "Informe a conversa e o operador responsável.");
  }

  const persona = getAiPersona(tenantId);

  const committed = await database.transaction(async (tx) => {
    const rodizioRow = await lockIndustrialRodizio(tx, tenantId);

    const [conv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .for("update");
    if (!conv) {
      throw new IndustrialApprovalError(404, "Atendimento não encontrado nesta empresa.");
    }

    const [targetOp] = await tx
      .select({ id: operators.id, name: operators.name, status: operators.status })
      .from(operators)
      .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
      .limit(1);
    if (!targetOp) {
      throw new IndustrialApprovalError(400, "Operador de destino não encontrado nesta empresa.");
    }

    let resolvedSectorId: string | null = null;
    let resolvedSectorName: string | null = null;
    if (input.sectorId) {
      const [sec] = await tx
        .select({ id: sectors.id, name: sectors.name })
        .from(sectors)
        .where(and(eq(sectors.tenantId, tenantId), eq(sectors.id, input.sectorId)))
        .limit(1);
      if (!sec) {
        throw new IndustrialApprovalError(400, "Setor de destino inválido para esta empresa.");
      }
      resolvedSectorId = sec.id;
      resolvedSectorName = sec.name;
    } else {
      const tenantSectors = await tx
        .select({ id: sectors.id, name: sectors.name, operatorIds: sectors.operatorIds })
        .from(sectors)
        .where(eq(sectors.tenantId, tenantId));
      const matched = tenantSectors.find(
        (s) => Array.isArray(s.operatorIds) && s.operatorIds.includes(targetOp.id),
      );
      resolvedSectorId = matched?.id || conv.sectorId || null;
      resolvedSectorName = matched?.name || null;
    }

    let targetPipelineId: string | null = input.pipelineId || null;
    let targetStageId: string | null = input.stageId || null;
    if (targetPipelineId || targetStageId) {
      if (!targetPipelineId || !targetStageId) {
        throw new IndustrialApprovalError(400, "Selecione o Funil CRM e a Etapa juntos.");
      }
      const [pipe] = await tx
        .select({ id: crmPipelines.id, name: crmPipelines.name })
        .from(crmPipelines)
        .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, targetPipelineId)))
        .limit(1);
      const [stage] = await tx
        .select({
          id: crmStages.id,
          name: crmStages.name,
          isWinStage: crmStages.isWinStage,
          isLossStage: crmStages.isLossStage,
        })
        .from(crmStages)
        .where(
          and(
            eq(crmStages.tenantId, tenantId),
            eq(crmStages.id, targetStageId),
            eq(crmStages.pipelineId, targetPipelineId),
          ),
        )
        .limit(1);
      if (!pipe || !stage || stage.isWinStage || stage.isLossStage) {
        throw new IndustrialApprovalError(400, "Funil ou etapa CRM inválidos para esta empresa.");
      }
    }

    const [contact] = conv.contactId
      ? await tx
          .select()
          .from(contacts)
          .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, conv.contactId)))
          .limit(1)
      : [];

    const [flow] = await tx
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
      .for("update")
      .limit(1);

    const flowMeta = ((flow?.metadata as Record<string, any>) || {}) as Record<string, any>;
    const pending = (flowMeta.pendingApproval as Partial<PendingApprovalSuggestion> | null) || null;
    const collectedData = ((flow?.collectedData as Record<string, any>) || {}) as Record<
      string,
      { value?: string; status?: string }
    >;

    const rawTargetFunnel =
      input.targetFunnel?.trim() ||
      pending?.targetFunnel ||
      resolvedSectorName ||
      flowMeta.targetFunnel ||
      INDUSTRIAL_REVIEW_FUNNEL;
    const targetFunnel = normalizeIndustrialFunnel(rawTargetFunnel);

    const clientName =
      collectedData["NOME COMPLETO"]?.value?.trim() ||
      pending?.clientName ||
      contact?.name ||
      "Cliente WhatsApp";
    const companyName =
      collectedData["EMPRESA"]?.value?.trim() || pending?.companyName || "";

    // 1. Mover card CWR (ou criar) para o Funil/Etapa aprovados + alocar operador + tarefa "Responder o contato"
    let dealResult: Awaited<ReturnType<typeof moveDealOnSdrApproval>> | null = null;
    if (targetPipelineId && targetStageId) {
      dealResult = await moveDealOnSdrApproval(tx, {
        tenantId,
        conversationId,
        contactId: contact?.id || conv.contactId || null,
        contactPhone: contact?.phone || conv.contactPhone || "",
        dealIdHint: pending?.dealId || flowMeta.localCrmDealId || null,
        targetPipelineId,
        targetStageId,
        targetOperatorId: targetOp.id,
        targetOperatorName: targetOp.name,
        targetFunnel,
        funnelStage: typeof flowMeta.funnelStage === "string" ? flowMeta.funnelStage : "Qualificação",
        clientName,
        companyName,
        collectedData,
        approvedByOperatorId: actor.id,
        approvedByOperatorName: actor.name,
      });
    }

    // 2. Transferir conversa para o operador aprovado em "meus"
    const now = new Date();
    await setAttendanceActor(tx, tenantId, `${actor.name} (Aprovação ${persona.name})`, actor.id);

    const [updatedConv] = await tx
      .update(conversations)
      .set({
        operatorId: targetOp.id,
        sectorId: resolvedSectorId,
        queueState: "meus",
        version: sql`${conversations.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .returning();

    if (contact) {
      await tx
        .update(contacts)
        .set({
          walletOperatorId: targetOp.id,
          responsibleName: targetOp.name,
        })
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contact.id)));
    }

    // 3. Consumir o slot do rodízio APENAS AGORA (na aprovação humana!)
    const rodizioConfig = ((rodizioRow?.config as RodizioConfig | undefined) || {}) as RodizioConfig;
    const allFlowOps = Array.isArray(rodizioConfig.flowOperators) ? rodizioConfig.flowOperators : [];
    const todayBrt = getBrtTodayYmd();
    const matchedFlowOp = allFlowOps.find((op) => op.id === targetOp.id);
    const isOperatorAbsent = Boolean(
      (matchedFlowOp && isOperatorOnLeaveToday(matchedFlowOp, todayBrt)) ||
        normalizeTriageText(targetOp.status || "") === "ausente",
    );

    if (rodizioRow && matchedFlowOp) {
      const nextOps = allFlowOps.map((op) =>
        op.id !== targetOp.id
          ? op
          : {
              ...op,
              compensation: Math.max(0, Number(op.compensation || 0) - 1),
              leadsReceivedCount: Number(op.leadsReceivedCount || 0) + 1,
              recentLeads: [
                {
                  chatId: conversationId,
                  clientName,
                  receivedAt: now.toISOString(),
                },
                ...(Array.isArray(op.recentLeads) ? op.recentLeads : []).slice(0, 9),
              ],
            },
      );
      await writeIndustrialRodizio(tx, tenantId, rodizioRow.id, {
        ...rodizioConfig,
        flowOperators: nextOps,
      });
    }

    // 4. Montar mensagem de confirmação ao cliente (com aviso de fora do expediente se fora do horário)
    const [sdrConfigRow] = await tx
      .select({ config: agentConfigs.config })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr")))
      .limit(1);
    const scheduleCfg = parseIndustrialScheduleConfig(
      (sdrConfigRow?.config as Record<string, unknown> | undefined) || {},
    );
    const offHoursNotice =
      scheduleCfg.enabled && !isWithinIndustrialSchedule(now, scheduleCfg)
        ? buildIndustrialOffHoursClosingNotice(now, scheduleCfg, targetOp.name)
        : null;

    const confirmationText =
      input.sendClientConfirmation === false
        ? null
        : industrialHandoffMessage("transferred", targetOp.name, {
            isOperatorAbsent,
            offHoursNotice,
          });

    // 5. Concluir ciclo da triagem (`outcome = "transferred"`) e limpar `pendingApproval`
    const cycleIso = flow ? flow.startedAt.toISOString() : now.toISOString();
    if (flow) {
      const nextMeta: Record<string, unknown> = {
        ...flowMeta,
        targetFunnel,
        handoffStatus: "transferred",
        readyForHandoff: false,
        pendingApproval: null,
        allocatedOperatorId: targetOp.id,
        allocatedOperatorName: targetOp.name,
        approvedBy: {
          operatorId: actor.id,
          operatorName: actor.name,
          approvedAt: now.toISOString(),
          note: input.note?.trim() || null,
        },
        ...(dealResult
          ? {
              localCrmDealId: dealResult.dealId,
              localCrmDealTitle: dealResult.dealTitle,
              localCrmDealAction: dealResult.action,
            }
          : {}),
        handoffReceipt: {
          cycle: cycleIso,
          committedAt: now.toISOString(),
          result: {
            status: "transferred",
            operator: { id: targetOp.id, name: targetOp.name, isAbsent: isOperatorAbsent },
            deal: dealResult
              ? {
                  dealId: dealResult.dealId,
                  dealTitle: dealResult.dealTitle,
                  action: dealResult.action === "reused_within_3h" ? "reused_within_3h" : "created_new",
                  funnelId: dealResult.pipelineId,
                  stageId: dealResult.stageId,
                }
              : null,
            conversationVersion: updatedConv.version,
            sectorId: resolvedSectorId || undefined,
          },
        },
        handoffOutbox: {
          cycle: cycleIso,
          operatorNotificationRequired: true,
          operatorNotifiedAt: null,
          clientConfirmationRequired: Boolean(confirmationText),
          clientConfirmationText: confirmationText,
          clientNotifiedAt: null,
          attempts: 0,
          nextAttemptAt: new Date(now.getTime() + 25_000).toISOString(),
        },
      };

      const [updatedFlow] = await tx
        .update(agentFlowStates)
        .set({
          currentStep: "Concluído",
          outcome: "transferred",
          completedAt: now,
          lastInteractionAt: now,
          metadata: nextMeta,
        })
        .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, flow.id)))
        .returning();

      if (updatedFlow) {
        await appendIndustrialJournal(tx, flow, updatedFlow, "handoff", `approved:${actor.id || "mcp"}:${now.getTime()}`);
      }
    }

    // 6. Registrar nota de sistema na conversa
    const sysText = `Triagem do ${persona.name} aprovada por ${actor.name} e encaminhada para ${targetOp.name}${targetFunnel ? ` (${targetFunnel})` : ""}.`;
    await tx.insert(messages).values({
      id: `sys-appr-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      tenantId,
      conversationId,
      senderType: "system",
      senderName: "Sistema",
      content: sysText,
      isInternalNote: true,
      direction: "outbound",
      provider: "system",
      status: "accepted",
      metaDetails: {
        attendanceSkip: true,
        sdrHumanApproval: true,
        approvedByOperatorId: actor.id,
        approvedByOperatorName: actor.name,
        allocatedOperatorId: targetOp.id,
        allocatedOperatorName: targetOp.name,
        targetFunnel,
      },
      sentAt: now,
      updatedAt: now,
    });

    return {
      conversation: updatedConv,
      operator: targetOp,
      sectorId: resolvedSectorId,
      targetFunnel,
      dealResult,
      clientName,
      companyName,
      contactId: contact?.id || conv.contactId || null,
      contactPhone: contact?.phone || conv.contactPhone || "",
      collectedData,
      confirmationText,
      flowId: flow?.id || null,
      cycleIso,
    };
  });

  // ── PÓS-COMMIT ──────────────────────────────────────────────────────────────
  SdrDebouncer.getInstance().clearSession(conversationId);

  try {
    const sm = SessionManager.getInstance();
    sm.notifyPublic(tenantId, {
      type: "chat_updated",
      chat: {
        id: conversationId,
        contactId: committed.contactId,
        queue: "meus",
        operatorId: committed.operator.id,
        walletOperatorId: committed.operator.id,
        responsibleName: committed.operator.name,
        version: committed.conversation.version,
        sectorId: committed.sectorId,
      },
    });
    sm.notifyPublic(tenantId, {
      type: "queue_update",
      conversationId,
      contactId: committed.contactId || undefined,
      contactName: committed.clientName,
      queueState: "meus",
      operatorId: committed.operator.id,
      walletOperatorId: committed.operator.id,
      sectorId: committed.sectorId,
      responsibleName: committed.operator.name,
      version: committed.conversation.version,
    });
    sm.notifyPublic(tenantId, {
      type: "sdr_flow_updated",
      conversationId,
      targetFunnel: committed.targetFunnel,
      outcome: "transferred",
      handoffStatus: "transferred",
    });
  } catch (sseErr: any) {
    console.warn("[IndustrialApproval] Erro ao emitir SSE pós-aprovação:", sseErr?.message);
  }

  let clientNotified = false;
  if (committed.confirmationText) {
    try {
      const idempotencyMessageId = committed.flowId
        ? deterministicIndustrialHandoffConfirmMessageId(tenantId, committed.flowId, committed.cycleIso)
        : `hconf-appr-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
      const sendRes = await sendSdrChannelText({
        tenantId,
        conversationId,
        phone: committed.contactPhone,
        text: committed.confirmationText,
        idempotencyMessageId,
        expectedOperatorId: committed.operator.id,
      });
      clientNotified = Boolean(sendRes.sent);
    } catch (sendErr: any) {
      console.warn("[IndustrialApproval] Falha ao enviar confirmação ao cliente:", sendErr?.message);
    }
  }

  let operatorNotified = false;
  try {
    operatorNotified = await notifyOperatorLeadTransferred({
      tenantId,
      operatorId: committed.operator.id,
      operatorName: committed.operator.name,
      conversationId,
      clientName: committed.clientName,
      company: committed.companyName,
      targetFunnel: committed.targetFunnel,
      dealId: committed.dealResult?.dealId || null,
      dealTitle: committed.dealResult?.dealTitle || null,
      taskId: committed.dealResult?.taskId || null,
      taskTitle: committed.dealResult?.taskTitle || null,
      temperature: "quente",
      transferSource: "sdr_auto",
      transferredBy: actor.name,
      cycle: committed.cycleIso,
      collectedData: committed.collectedData,
    });
  } catch (notifErr: any) {
    console.warn("[IndustrialApproval] Falha ao notificar operador:", notifErr?.message);
  }

  // Marcar outbox pós-commit como entregue
  if (committed.flowId && (clientNotified || operatorNotified)) {
    try {
      const nowIso = new Date().toISOString();
      const patch: Record<string, string> = {};
      if (clientNotified) patch.clientNotifiedAt = nowIso;
      if (operatorNotified) patch.operatorNotifiedAt = nowIso;
      await database
        .update(agentFlowStates)
        .set({
          metadata: sql`jsonb_set(${agentFlowStates.metadata}, '{handoffOutbox}', COALESCE(${agentFlowStates.metadata}->'handoffOutbox', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
        })
        .where(
          and(
            eq(agentFlowStates.tenantId, tenantId),
            eq(agentFlowStates.id, committed.flowId),
          ),
        );
    } catch {
      // Não bloqueia resposta
    }
  }

  return {
    success: true,
    conversationId,
    operator: committed.operator,
    sectorId: committed.sectorId,
    deal: committed.dealResult,
    clientNotified,
    operatorNotified,
  };
}

export interface DismissIndustrialTriageInput {
  conversationId: string;
  reason?: string | null;
  finishConversation?: boolean;
  dealAction?: "keep" | "mark_lost" | "move_stage";
  targetPipelineId?: string | null;
  targetStageId?: string | null;
}

/**
 * Ação "Concluir sem Transferir" (currículos, fornecedores, spam ou leads desqualificados):
 * encerra a triagem, oculta imediatamente do Kanban ativo do Fagner e opcionalmente
 * finaliza a conversa e marca/move o card CRM.
 */
export async function completeIndustrialTriageWithoutTransfer(
  database: IndustrialDatabase,
  tenantId: string,
  actor: ApprovalActor,
  input: DismissIndustrialTriageInput,
) {
  assertApprovalPermission(actor);
  const { conversationId } = input;
  if (!conversationId) {
    throw new IndustrialApprovalError(400, "conversationId é obrigatório.");
  }

  const persona = getAiPersona(tenantId);
  const finishConv = input.finishConversation !== false;
  const reasonText = input.reason?.trim() || "Concluído sem transferência pelo SDR";

  const result = await database.transaction(async (tx) => {
    const [conv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .for("update");
    if (!conv) {
      throw new IndustrialApprovalError(404, "Atendimento não encontrado.");
    }

    const now = new Date();
    const [flow] = await tx
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
      .for("update")
      .limit(1);

    if (flow) {
      const meta = (flow.metadata as Record<string, unknown>) || {};
      const [updatedFlow] = await tx
        .update(agentFlowStates)
        .set({
          outcome: "completed",
          currentStep: "Concluído (Sem Transferência)",
          completedAt: now,
          lastInteractionAt: now,
          metadata: {
            ...meta,
            handoffStatus: "resolved",
            readyForHandoff: false,
            pendingApproval: null,
            dismissedBy: {
              operatorId: actor.id,
              operatorName: actor.name,
              reason: reasonText,
              at: now.toISOString(),
            },
          },
        })
        .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, flow.id)))
        .returning();

      if (updatedFlow) {
        await appendIndustrialJournal(tx, flow, updatedFlow, "handoff", `dismiss:${actor.id || "mcp"}:${now.getTime()}`);
      }
    }

    let updatedConv = conv;
    if (finishConv && conv.queueState !== "finalizados") {
      await setAttendanceActor(tx, tenantId, `${actor.name} (Concluiu triagem ${persona.name})`, actor.id);
      const [row] = await tx
        .update(conversations)
        .set({
          queueState: "finalizados",
          operatorId: null,
          version: sql`${conversations.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
        .returning();
      if (row) updatedConv = row;
    }

    // Ação opcional no card CRM vinculado
    if (input.dealAction === "mark_lost" || input.dealAction === "move_stage") {
      const [linked] = await tx
        .select({ deal: crmDeals })
        .from(crmConversationDeals)
        .innerJoin(
          crmDeals,
          and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId)),
        )
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(crmConversationDeals.conversationId, conversationId),
            eq(crmConversationDeals.isActive, true),
            eq(crmDeals.status, "open"),
          ),
        )
        .orderBy(desc(crmDeals.updatedAt))
        .limit(1);

      if (linked?.deal) {
        if (input.dealAction === "mark_lost") {
          await tx
            .update(crmDeals)
            .set({
              status: "lost",
              lossReason: reasonText,
              lostAt: now,
              closedAt: now,
              version: sql`${crmDeals.version} + 1`,
              updatedAt: now,
            })
            .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, linked.deal.id)));

          await tx.insert(crmDealEvents).values({
            id: `ev-dismiss-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
            tenantId,
            dealId: linked.deal.id,
            eventType: "status_changed",
            fromStatus: linked.deal.status,
            toStatus: "lost",
            operatorId: actor.id,
            metadata: {
              origin: "sdr_human_dismiss",
              reason: reasonText,
              actorName: actor.name,
              conversationId,
            },
            createdAt: now,
          });
        } else if (input.targetPipelineId && input.targetStageId) {
          await tx
            .update(crmDeals)
            .set({
              pipelineId: input.targetPipelineId,
              stageId: input.targetStageId,
              version: sql`${crmDeals.version} + 1`,
              updatedAt: now,
            })
            .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, linked.deal.id)));

          await tx.insert(crmDealEvents).values({
            id: `ev-dismiss-mv-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
            tenantId,
            dealId: linked.deal.id,
            eventType: "stage_changed",
            fromStageId: linked.deal.stageId,
            toStageId: input.targetStageId,
            operatorId: actor.id,
            metadata: {
              origin: "sdr_human_dismiss",
              reason: reasonText,
              actorName: actor.name,
              conversationId,
            },
            createdAt: now,
          });
        }
      }
    }

    await tx.insert(messages).values({
      id: `sys-dismiss-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      tenantId,
      conversationId,
      senderType: "system",
      senderName: "Sistema",
      content: `Triagem concluída sem transferência por ${actor.name}${reasonText ? ` — ${reasonText}` : ""}.`,
      isInternalNote: true,
      direction: "outbound",
      provider: "system",
      status: "accepted",
      metaDetails: { attendanceSkip: true, sdrHumanDismiss: true, reason: reasonText },
      sentAt: now,
      updatedAt: now,
    });

    return { conversation: updatedConv };
  });

  SdrDebouncer.getInstance().clearSession(conversationId);

  try {
    const sm = SessionManager.getInstance();
    sm.notifyPublic(tenantId, {
      type: "queue_update",
      conversationId,
      queueState: result.conversation.queueState,
      operatorId: result.conversation.operatorId,
      version: result.conversation.version,
    });
    sm.notifyPublic(tenantId, {
      type: "sdr_flow_updated",
      conversationId,
      outcome: "completed",
      handoffStatus: "resolved",
    });
  } catch {
    // Não bloqueia resposta
  }

  return { success: true, conversationId, queueState: result.conversation.queueState };
}

/**
 * Ação "Assumir Manualmente": o próprio SDR assume o atendimento em `meus`,
 * encerra o ciclo de automação do Fagner e oculta do Kanban ativo.
 */
export async function assumeIndustrialTriageManually(
  database: IndustrialDatabase,
  tenantId: string,
  actor: ApprovalActor,
  conversationId: string,
) {
  assertApprovalPermission(actor);
  if (!conversationId) {
    throw new IndustrialApprovalError(400, "conversationId é obrigatório.");
  }
  if (!actor.id) {
    throw new IndustrialApprovalError(400, "Um operador válido é obrigatório para assumir a triagem manualmente.");
  }
  const actorId = actor.id;

  const persona = getAiPersona(tenantId);

  const result = await database.transaction(async (tx) => {
    const [conv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .for("update");
    if (!conv) {
      throw new IndustrialApprovalError(404, "Atendimento não encontrado.");
    }

    const now = new Date();
    await ensureCwrDealOnContacting(tx, {
      tenantId,
      conversationId,
      contactId: conv.contactId,
      actorName: actor.name,
    });

    await setAttendanceActor(tx, tenantId, actor.name, actorId);
    const [updatedConv] = await tx
      .update(conversations)
      .set({
        operatorId: actorId,
        queueState: "meus",
        version: sql`${conversations.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .returning();

    if (conv.contactId) {
      await tx
        .update(contacts)
        .set({
          walletOperatorId: actorId,
          responsibleName: actor.name,
        })
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, conv.contactId)));
    }

    const [flow] = await tx
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
      .for("update")
      .limit(1);

    if (flow) {
      const meta = (flow.metadata as Record<string, unknown>) || {};
      const [updatedFlow] = await tx
        .update(agentFlowStates)
        .set({
          outcome: "transferred",
          currentStep: "Assumido Manualmente",
          completedAt: now,
          lastInteractionAt: now,
          metadata: {
            ...meta,
            handoffStatus: "superseded",
            readyForHandoff: false,
            pendingApproval: null,
            allocatedOperatorId: actorId,
            allocatedOperatorName: actor.name,
          },
        })
        .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, flow.id)))
        .returning();

      if (updatedFlow) {
        await appendIndustrialJournal(tx, flow, updatedFlow, "handoff", `assume:${actorId}:${now.getTime()}`);
      }
    }

    await tx.insert(messages).values({
      id: `sys-assume-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      tenantId,
      conversationId,
      senderType: "system",
      senderName: "Sistema",
      content: `Atendimento assumido manualmente por ${actor.name} (triagem ${persona.name} encerrada).`,
      isInternalNote: true,
      direction: "outbound",
      provider: "system",
      status: "accepted",
      metaDetails: { attendanceSkip: true, sdrManualAssume: true, operatorId: actorId },
      sentAt: now,
      updatedAt: now,
    });

    return { conversation: updatedConv };
  });

  SdrDebouncer.getInstance().clearSession(conversationId);

  try {
    const sm = SessionManager.getInstance();
    sm.notifyPublic(tenantId, {
      type: "chat_updated",
      chat: {
        id: conversationId,
        contactId: result.conversation.contactId,
        queue: "meus",
        operatorId: actorId,
        walletOperatorId: actorId,
        responsibleName: actor.name,
        version: result.conversation.version,
        sectorId: result.conversation.sectorId,
      },
    });
    sm.notifyPublic(tenantId, {
      type: "queue_update",
      conversationId,
      queueState: "meus",
      operatorId: actorId,
      walletOperatorId: actorId,
      responsibleName: actor.name,
      version: result.conversation.version,
    });
    sm.notifyPublic(tenantId, {
      type: "sdr_flow_updated",
      conversationId,
      outcome: "transferred",
      handoffStatus: "superseded",
    });
  } catch {
    // Não bloqueia resposta
  }

  return { success: true, conversationId, operatorId: actorId };
}
