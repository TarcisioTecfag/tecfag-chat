import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "../../db";
import {
  agentFlowStates,
  contacts,
  conversations,
  crmConversationDeals,
  crmDeals,
  crmPipelines,
  crmStages,
  messages,
  operators,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { isSiteConversationId } from "../livechat/site-channel-policy";
import { projectIndustrialMonitoring } from "../triage/industrial-monitor";
import {
  computeIndustrialTriageProgress,
  normalizeIndustrialFunnel,
} from "../triage/industrial-policy";
import {
  getBrtDateKeyFromDate,
  resolveSweepDateRange,
  runSdrSweep,
  type SdrSweepItem,
  type SdrSweepPeriod,
} from "../triage/sdr-sweep";
import type { McpToolDefinition, McpWriteActorContext } from "./valem-tecfag-mcp-write-tools";

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description:
    "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

export const MCP_TRIAGE_AUDIT_TOOLS: McpToolDefinition[] = [
  {
    name: "get_fagner_triage_sweep",
    access: "read",
    description:
      "Varredura operacional SQL em tempo real das triagens do assistente IA (SDR) por período ('today', 'range' com startDate/endDate em Brasília ou 'all'). Retorna em 1 chamada: totais exatos, taxa de transferência, quem está aguardando resposta da IA (com minutos de espera), quem está aguardando aprovação humana SDR (Human-in-the-Loop), quem aguarda resposta do cliente, todos os transferidos e o ranking de transferências por operador e funil.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        period: {
          type: "string",
          enum: ["today", "range", "all"],
          default: "today",
          description:
            "Período da varredura em horário de Brasília (America/Sao_Paulo): 'today' (padrão), 'range' (usa startDate/endDate) ou 'all'.",
        },
        startDate: {
          type: "string",
          description:
            "Data inicial no formato YYYY-MM-DD (Brasília). Quando informada com period omitido, ativa automaticamente 'range'.",
        },
        endDate: {
          type: "string",
          description:
            "Data final no formato YYYY-MM-DD (Brasília). Quando informada com period omitido, ativa automaticamente 'range'.",
        },
        bucket: {
          type: "string",
          enum: ["all", "awaiting_ai", "awaiting_approval", "awaiting_client", "transferred"],
          default: "all",
          description:
            "Permite retornar apenas uma lista específica ('awaiting_ai', 'awaiting_approval', 'awaiting_client', 'transferred') ou 'all' (padrão). O bloco summary sempre traz todos os totais.",
        },
        targetFunnel: {
          type: "string",
          description:
            "Filtro opcional por nome parcial do funil/setor de destino (ex: 'Máquinas', 'Peças', 'Manutenção').",
        },
        operatorName: {
          type: "string",
          description:
            "Filtro opcional por nome parcial do operador/consultor (aplicado aos transferidos e sugeridos).",
        },
        limitPerBucket: {
          type: "number",
          default: 30,
          description:
            "Máximo de itens retornados em cada lista (padrão 30, máx 100). Os totais em summary nunca são truncados.",
        },
        includeOperatorItems: {
          type: "boolean",
          default: false,
          description:
            "Quando true, inclui a lista detalhada de leads dentro de cada operador em transferredByOperator (padrão false para resposta compacta).",
        },
      },
    },
  },
  {
    name: "get_fagner_triage_audit_batch",
    access: "read",
    description:
      "Auditoria de precisão em lote das triagens do assistente IA (SDR) em 1 única chamada (sem precisar chamar get_conversation_messages uma por uma). Retorna para até 30 conversas: estado operacional, progresso de campos coletados, funil/máquina decidida, aprovação pendente, métricas de SLA (tempo até 1ª resposta da IA e espera atual), flags automáticas de problemas de qualidade, cards vinculados no CRM e a transcrição cronológica do diálogo cliente × IA.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Opcional: lista explícita de até 30 conversationIds para auditar diretamente (ignora period/startDate/endDate).",
        },
        period: {
          type: "string",
          enum: ["today", "7d", "30d", "range", "all"],
          default: "today",
          description:
            "Período de busca quando conversationIds não é informado: 'today' (padrão), '7d', '30d', 'range' ou 'all'.",
        },
        startDate: {
          type: "string",
          description: "Data inicial YYYY-MM-DD (Brasília) para recorte por intervalo.",
        },
        endDate: {
          type: "string",
          description: "Data final YYYY-MM-DD (Brasília) para recorte por intervalo.",
        },
        stateFilter: {
          type: "string",
          description:
            "Filtro opcional por estado de monitoramento (ex: 'collecting', 'awaiting_approval', 'ready', 'waiting_for_team', 'handoff_pending', 'transferred', 'no_response', 'stopped', 'manual', 'closed').",
        },
        targetFunnel: {
          type: "string",
          description: "Filtro opcional por nome parcial do funil/setor decidido.",
        },
        onlyWithProblems: {
          type: "boolean",
          default: false,
          description:
            "Quando true, retorna apenas triagens que tenham pelo menos 1 flag de problema/alerta detectada (ex: aguardando resposta da IA, handoff travado, aprovação pendente, sem card CRM, abandono).",
        },
        limit: {
          type: "number",
          default: 15,
          description: "Máximo de conversas auditadas no lote (padrão 15, máx 30).",
        },
        messagesPerConversation: {
          type: "number",
          default: 20,
          description:
            "Quantidade máxima de mensagens cronológicas mais recentes incluídas na transcrição de cada conversa (padrão 20, máx 50; use 0 para omitir transcrições).",
        },
        includeLinkedDeals: {
          type: "boolean",
          default: true,
          description: "Quando true (padrão), inclui os cards do CRM vinculados a cada conversa.",
        },
        includeJournalNotes: {
          type: "boolean",
          default: false,
          description:
            "Quando true, inclui também as notas progressivas (journal) gravadas pela triagem.",
        },
      },
    },
  },
];

export const MCP_TRIAGE_AUDIT_TOOL_LABELS_PT: Record<string, string> = {
  get_fagner_triage_sweep: "Varredura SQL da Triagem IA",
  get_fagner_triage_audit_batch: "Auditoria em Lote da Triagem IA",
};

const TRIAGE_AUDIT_TOOL_NAMES = new Set(MCP_TRIAGE_AUDIT_TOOLS.map((t) => t.name));

export function isTriageAuditMcpTool(name: string): boolean {
  return TRIAGE_AUDIT_TOOL_NAMES.has(name);
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function asTrimmedString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function safeIso(val?: Date | string | null): string | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface TriageAuditDateWindow {
  period: "today" | "7d" | "30d" | "range" | "all";
  startUtc: Date | null;
  endUtc: Date | null;
}

export function resolveTriageAuditDateWindow(params: {
  period?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  now?: Date;
}): TriageAuditDateWindow {
  const now = params.now || new Date();
  const rawStart = asTrimmedString(params.startDate);
  const rawEnd = asTrimmedString(params.endDate);
  const validStart = rawStart && DATE_REGEX.test(rawStart) ? rawStart : null;
  const validEnd = rawEnd && DATE_REGEX.test(rawEnd) ? rawEnd : null;

  const rawPeriod = asTrimmedString(params.period);
  const inferredPeriod: TriageAuditDateWindow["period"] =
    rawPeriod === "today" ||
    rawPeriod === "7d" ||
    rawPeriod === "30d" ||
    rawPeriod === "range" ||
    rawPeriod === "all"
      ? rawPeriod
      : validStart || validEnd
        ? "range"
        : "today";

  if (inferredPeriod === "all") {
    return { period: "all", startUtc: null, endUtc: null };
  }

  if (inferredPeriod === "today") {
    const { startUtc, endUtc } = resolveSweepDateRange({ period: "today", now });
    return { period: "today", startUtc, endUtc };
  }

  if (inferredPeriod === "7d" || inferredPeriod === "30d") {
    const days = inferredPeriod === "7d" ? 6 : 29;
    const endKey = getBrtDateKeyFromDate(now);
    const startDateObj = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const startKey = getBrtDateKeyFromDate(startDateObj);
    return {
      period: inferredPeriod,
      startUtc: new Date(`${startKey}T00:00:00.000-03:00`),
      endUtc: new Date(`${endKey}T23:59:59.999-03:00`),
    };
  }

  const { startUtc, endUtc } = resolveSweepDateRange({
    period: "range",
    startDate: validStart,
    endDate: validEnd,
    now,
  });
  return { period: "range", startUtc, endUtc };
}

function cleanTargetFunnel(
  meta: Record<string, any>,
  collectedData: Record<string, any>,
): string | null {
  const pendingFunnel =
    meta?.pendingApproval && typeof meta.pendingApproval === "object"
      ? asTrimmedString((meta.pendingApproval as Record<string, unknown>).targetFunnel)
      : null;
  if (pendingFunnel && !/^aguardando/i.test(pendingFunnel))
    return normalizeIndustrialFunnel(pendingFunnel);

  const rawMeta = asTrimmedString(meta?.targetFunnel);
  if (rawMeta && !/^aguardando/i.test(rawMeta)) return normalizeIndustrialFunnel(rawMeta);

  const entry = collectedData?.["SETOR / FUNIL DE DESTINO"];
  if (entry && entry.status === "filled" && typeof entry.value === "string") {
    const val = entry.value.trim();
    if (val && !/^aguardando/i.test(val)) return normalizeIndustrialFunnel(val);
  }
  return null;
}

function compactMessageText(content?: string | null, mediaInterpretation?: string | null): string {
  const base = String(content || "").trim();
  const interp = String(mediaInterpretation || "").trim();
  if (!base && interp) return `[Mídia interpretada] ${interp.slice(0, 320)}`;
  const clipped = base.length > 420 ? `${base.slice(0, 420)}…` : base;
  if (interp && base.startsWith("[MEDIA:")) {
    return `${clipped} | Interpretação: ${interp.slice(0, 220)}`;
  }
  return clipped;
}

function stripSweepItemForMcp(item: SdrSweepItem) {
  return {
    flowId: item.flowId,
    conversationId: item.conversationId,
    contactName: item.contactName,
    phone: item.phone,
    company: item.company,
    channel: item.channel,
    outcome: item.outcome,
    statusLabel: item.statusLabel,
    targetFunnel: item.targetFunnel,
    operatorId: item.operatorId,
    operatorName: item.operatorName,
    startedAt: item.startedAt,
    lastInteractionAt: item.lastInteractionAt,
    lastMessageAt: item.lastMessageAt,
    lastMessageSender: item.lastMessageSender,
    lastMessagePreview: item.lastMessagePreview,
    waitingMinutes: item.waitingMinutes,
    reason: item.reason,
  };
}

export interface TriageConversationMetrics {
  totalMessages: number;
  clientMessages: number;
  aiMessages: number;
  humanAgentMessages: number;
  firstClientAt: string | null;
  firstAiReplyAt: string | null;
  firstResponseSeconds: number | null;
  lastMessageAt: string | null;
  lastMessageSender: "client" | "bot" | "agent" | null;
  waitingMinutes: number | null;
}

export function computeTriageConversationMetrics(
  msgs: Array<{ senderType: string; sentAt: Date | string }>,
  now: Date = new Date(),
): TriageConversationMetrics {
  let clientMessages = 0;
  let aiMessages = 0;
  let humanAgentMessages = 0;
  let firstClientDate: Date | null = null;
  let firstAiAfterClientDate: Date | null = null;
  let firstAiAnyDate: Date | null = null;

  for (const m of msgs) {
    const sent = m.sentAt instanceof Date ? m.sentAt : new Date(m.sentAt);
    if (Number.isNaN(sent.getTime())) continue;
    if (m.senderType === "client") {
      clientMessages += 1;
      if (!firstClientDate) firstClientDate = sent;
    } else if (m.senderType === "agent") {
      humanAgentMessages += 1;
    } else if (m.senderType === "bot") {
      aiMessages += 1;
      if (!firstAiAnyDate) firstAiAnyDate = sent;
      if (firstClientDate && !firstAiAfterClientDate && sent.getTime() >= firstClientDate.getTime()) {
        firstAiAfterClientDate = sent;
      }
    }
  }

  const effectiveAiReply = firstAiAfterClientDate || firstAiAnyDate;
  const firstResponseSeconds =
    firstClientDate &&
    firstAiAfterClientDate &&
    firstAiAfterClientDate.getTime() >= firstClientDate.getTime()
      ? Math.round((firstAiAfterClientDate.getTime() - firstClientDate.getTime()) / 1000)
      : null;

  const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
  const lastDate = last ? (last.sentAt instanceof Date ? last.sentAt : new Date(last.sentAt)) : null;
  const validLastDate = lastDate && !Number.isNaN(lastDate.getTime()) ? lastDate : null;
  const lastMessageSender: "client" | "bot" | "agent" | null =
    last?.senderType === "client"
      ? "client"
      : last?.senderType === "agent"
        ? "agent"
        : last?.senderType === "bot"
          ? "bot"
          : null;

  return {
    totalMessages: msgs.length,
    clientMessages,
    aiMessages,
    humanAgentMessages,
    firstClientAt: firstClientDate ? firstClientDate.toISOString() : null,
    firstAiReplyAt: effectiveAiReply ? effectiveAiReply.toISOString() : null,
    firstResponseSeconds,
    lastMessageAt: validLastDate ? validLastDate.toISOString() : null,
    lastMessageSender,
    waitingMinutes: validLastDate
      ? Math.max(0, Math.floor((now.getTime() - validLastDate.getTime()) / 60000))
      : null,
  };
}

export function detectTriageQualityFlags(input: {
  monitoringState: string;
  handoffIssue: string | null;
  outcome: string | null;
  queueState: string;
  metrics: TriageConversationMetrics;
  fieldsPercentage: number;
  linkedDealsCount: number;
  hasTargetFunnel: boolean;
}): string[] {
  const flags: string[] = [];

  if (
    input.queueState === "automacao" &&
    input.monitoringState === "collecting" &&
    input.metrics.lastMessageSender === "client"
  ) {
    flags.push("awaiting_ai_reply");
  }
  if (input.monitoringState === "awaiting_approval") {
    flags.push("awaiting_approval_pending");
  }
  if (
    input.monitoringState === "handoff_pending" ||
    input.monitoringState === "waiting_for_team" ||
    Boolean(input.handoffIssue)
  ) {
    flags.push("handoff_issue");
  }
  if (input.monitoringState === "no_response" || input.outcome === "abandoned") {
    flags.push("client_no_response");
  }
  if (input.monitoringState === "stopped" || input.outcome === "stopped") {
    flags.push("automation_stopped");
  }
  if (
    input.metrics.clientMessages > 0 &&
    input.metrics.aiMessages === 0 &&
    input.queueState === "automacao"
  ) {
    flags.push("zero_ai_replies");
  }
  if (input.metrics.firstResponseSeconds !== null && input.metrics.firstResponseSeconds > 180) {
    flags.push("slow_first_reply_gt_3m");
  }
  if (
    (input.monitoringState === "transferred" || input.monitoringState === "awaiting_approval") &&
    input.fieldsPercentage < 50
  ) {
    flags.push("low_field_completion");
  }
  if (
    (input.monitoringState === "transferred" || input.monitoringState === "awaiting_approval") &&
    !input.hasTargetFunnel
  ) {
    flags.push("missing_target_funnel");
  }
  if (
    (input.monitoringState === "transferred" ||
      input.monitoringState === "awaiting_approval" ||
      input.monitoringState === "collecting") &&
    input.linkedDealsCount === 0
  ) {
    flags.push("no_linked_crm_deal");
  }

  return flags;
}

function summarizeCollectedData(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (v && typeof v === "object" && "value" in v) {
      if (v.status === "filled" && typeof v.value === "string" && v.value.trim()) {
        out[k] = v.value.trim();
      }
    } else if (typeof v === "string" && v.trim()) {
      out[k] = v.trim();
    }
  }
  return out;
}

export async function executeTriageAuditMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: "tecfag" | "valem",
  _actor?: McpWriteActorContext,
): Promise<unknown> {
  const persona = getAiPersona(tenantId);

  switch (name) {
    case "get_fagner_triage_sweep": {
      const rawStart = asTrimmedString(args.startDate);
      const rawEnd = asTrimmedString(args.endDate);
      const rawPeriod = asTrimmedString(args.period);
      const period: SdrSweepPeriod =
        rawPeriod === "today" || rawPeriod === "range" || rawPeriod === "all"
          ? rawPeriod
          : rawStart || rawEnd
            ? "range"
            : "today";

      const bucket = asTrimmedString(args.bucket) || "all";
      const targetFunnelFilter = asTrimmedString(args.targetFunnel)?.toLowerCase() || null;
      const operatorNameFilter = asTrimmedString(args.operatorName)?.toLowerCase() || null;
      const limitPerBucket = clampInt(args.limitPerBucket, 30, 1, 100);
      const includeOperatorItems = asBool(args.includeOperatorItems, false);

      const sweep = await runSdrSweep(db, tenantId, {
        period,
        startDate: rawStart,
        endDate: rawEnd,
      });

      const matchesFilters = (item: SdrSweepItem) => {
        if (targetFunnelFilter) {
          const f = (item.targetFunnel || "").toLowerCase();
          if (!f.includes(targetFunnelFilter)) return false;
        }
        if (operatorNameFilter) {
          const op = (item.operatorName || "").toLowerCase();
          if (!op.includes(operatorNameFilter)) return false;
        }
        return true;
      };

      const awaitingAiFiltered = sweep.awaitingFagner.filter(matchesFilters);
      const awaitingApprovalFiltered = sweep.awaitingApproval.filter(matchesFilters);
      const awaitingClientFiltered = sweep.awaitingClient.filter(matchesFilters);
      const transferredFiltered = sweep.transferred.filter(matchesFilters);

      const countsByFunnel: Record<string, number> = {};
      for (const item of [
        ...awaitingAiFiltered,
        ...awaitingApprovalFiltered,
        ...awaitingClientFiltered,
        ...transferredFiltered,
      ]) {
        const key = item.targetFunnel || "Sem funil definido";
        countsByFunnel[key] = (countsByFunnel[key] || 0) + 1;
      }

      const transferredByOperator = sweep.transferredByOperator
        .map((group) => {
          const items = group.items.filter(matchesFilters);
          if (items.length === 0) return null;
          const funnels: Record<string, number> = {};
          for (const it of items) {
            const fk = it.targetFunnel || "Sem funil definido";
            funnels[fk] = (funnels[fk] || 0) + 1;
          }
          return {
            operatorId: group.operatorId,
            operatorName: group.operatorName,
            count: items.length,
            funnels,
            ...(includeOperatorItems
              ? { items: items.slice(0, limitPerBucket).map(stripSweepItemForMcp) }
              : {}),
          };
        })
        .filter((g): g is NonNullable<typeof g> => g !== null)
        .sort((a, b) => b.count - a.count);

      const filteredTotal =
        targetFunnelFilter || operatorNameFilter
          ? awaitingAiFiltered.length +
            awaitingApprovalFiltered.length +
            awaitingClientFiltered.length +
            transferredFiltered.length
          : sweep.summary.totalAnalyzed;

      const transferRatePct =
        filteredTotal > 0 ? Math.round((transferredFiltered.length / filteredTotal) * 1000) / 10 : 0;

      const includeBucket = (key: string) => bucket === "all" || bucket === key;

      return {
        tenantId,
        aiPersona: persona.name,
        period: sweep.period,
        rangeStartIso: sweep.rangeStartIso,
        rangeEndIso: sweep.rangeEndIso,
        generatedAt: sweep.generatedAt,
        timeZone: sweep.timeZone,
        appliedFilters: {
          bucket,
          targetFunnel: targetFunnelFilter,
          operatorName: operatorNameFilter,
          limitPerBucket,
        },
        summary: {
          totalAnalyzed: filteredTotal,
          awaitingAiCount: awaitingAiFiltered.length,
          awaitingApprovalCount: awaitingApprovalFiltered.length,
          awaitingClientCount: awaitingClientFiltered.length,
          transferredCount: transferredFiltered.length,
          distinctOperatorsCount: transferredByOperator.filter((o) => Boolean(o.operatorId)).length,
          manualWithoutCompletionCount:
            targetFunnelFilter || operatorNameFilter ? 0 : sweep.summary.manualWithoutCompletionCount,
          stoppedCount:
            targetFunnelFilter || operatorNameFilter ? 0 : sweep.summary.stoppedCount,
          transferRatePct,
          countsByFunnel,
        },
        transferredByOperator,
        awaitingAi: includeBucket("awaiting_ai")
          ? awaitingAiFiltered.slice(0, limitPerBucket).map(stripSweepItemForMcp)
          : [],
        awaitingApproval: includeBucket("awaiting_approval")
          ? awaitingApprovalFiltered.slice(0, limitPerBucket).map(stripSweepItemForMcp)
          : [],
        awaitingClient: includeBucket("awaiting_client")
          ? awaitingClientFiltered.slice(0, limitPerBucket).map(stripSweepItemForMcp)
          : [],
        transferred: includeBucket("transferred")
          ? transferredFiltered.slice(0, limitPerBucket).map(stripSweepItemForMcp)
          : [],
      };
    }

    case "get_fagner_triage_audit_batch": {
      const now = new Date();
      const rawConvIds = Array.isArray(args.conversationIds)
        ? [
            ...new Set(
              args.conversationIds
                .map((id) => (typeof id === "string" ? id.trim() : ""))
                .filter(Boolean),
            ),
          ].slice(0, 30)
        : [];
      const limit = clampInt(args.limit, 15, 1, 30);
      const messagesPerConversation = clampInt(args.messagesPerConversation, 20, 0, 50);
      const stateFilter = asTrimmedString(args.stateFilter);
      const targetFunnelFilter = asTrimmedString(args.targetFunnel)?.toLowerCase() || null;
      const onlyWithProblems = asBool(args.onlyWithProblems, false);
      const includeLinkedDeals = asBool(args.includeLinkedDeals, true);
      const includeJournalNotes = asBool(args.includeJournalNotes, false);

      const dateWindow =
        rawConvIds.length > 0
          ? { period: "all" as const, startUtc: null, endUtc: null }
          : resolveTriageAuditDateWindow({
              period: args.period,
              startDate: args.startDate,
              endDate: args.endDate,
              now,
            });

      // 1. Carregar último ciclo SDR por conversa (tenant isolado)
      const latestFlowsSubquery = db
        .selectDistinctOn([agentFlowStates.conversationId])
        .from(agentFlowStates)
        .where(
          rawConvIds.length > 0
            ? and(
                eq(agentFlowStates.tenantId, tenantId),
                eq(agentFlowStates.agentType, "sdr"),
                inArray(agentFlowStates.conversationId, rawConvIds),
              )
            : and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.agentType, "sdr")),
        )
        .orderBy(
          agentFlowStates.conversationId,
          desc(agentFlowStates.startedAt),
          desc(agentFlowStates.id),
        )
        .as("latest_triage_audit_flows");

      const candidateFlows = await db
        .select()
        .from(latestFlowsSubquery)
        .orderBy(desc(latestFlowsSubquery.lastInteractionAt), desc(latestFlowsSubquery.id))
        .limit(rawConvIds.length > 0 ? 30 : 400);

      const inRange = (d?: Date | string | null): boolean => {
        if (!dateWindow.startUtc || !dateWindow.endUtc) return true;
        if (!d) return false;
        const ms = (d instanceof Date ? d : new Date(d)).getTime();
        if (Number.isNaN(ms)) return false;
        return ms >= dateWindow.startUtc.getTime() && ms <= dateWindow.endUtc.getTime();
      };

      const flowsInWindow =
        rawConvIds.length > 0
          ? candidateFlows
          : candidateFlows.filter(
              (f) => inRange(f.startedAt) || inRange(f.lastInteractionAt) || inRange(f.completedAt),
            );

      const allConvIds = [...new Set(flowsInWindow.map((f) => f.conversationId))];
      if (allConvIds.length === 0) {
        return {
          tenantId,
          aiPersona: persona.name,
          period: dateWindow.period,
          rangeStartIso: dateWindow.startUtc ? dateWindow.startUtc.toISOString() : null,
          rangeEndIso: dateWindow.endUtc ? dateWindow.endUtc.toISOString() : null,
          generatedAt: now.toISOString(),
          auditSummary: {
            totalMatched: 0,
            returnedCount: 0,
            countsByState: {},
            countsByFunnel: {},
            countsByFlag: {},
            avgFirstResponseSeconds: null,
            avgFieldsCompletionPct: null,
            linkedDealsCoveragePct: null,
          },
          sessions: [],
        };
      }

      // 2. Batch fetch conversations + operators (ZERO N+1)
      const [convRows, opRows] = await Promise.all([
        db
          .select()
          .from(conversations)
          .where(and(eq(conversations.tenantId, tenantId), inArray(conversations.id, allConvIds))),
        db
          .select({ id: operators.id, name: operators.name })
          .from(operators)
          .where(eq(operators.tenantId, tenantId)),
      ]);

      const convMap = new Map(convRows.map((c) => [c.id, c]));
      const opNameById = new Map(opRows.map((o) => [o.id, o.name]));

      // Pré-filtrar por stateFilter e targetFunnel antes de carregar mensagens/deals
      const preFiltered = flowsInWindow
        .map((flow) => {
          const conv = convMap.get(flow.conversationId) || null;
          const monitoring = projectIndustrialMonitoring(
            {
              startedAt: flow.startedAt,
              outcome: flow.outcome,
              metadata: flow.metadata,
            },
            conv ? { operatorId: conv.operatorId, queueState: conv.queueState } : null,
          );
          const meta = (flow.metadata as Record<string, any>) || {};
          const collected = (flow.collectedData as Record<string, any>) || {};
          const targetFunnel = cleanTargetFunnel(meta, collected);
          return { flow, conv, monitoring, meta, collected, targetFunnel };
        })
        .filter((entry) => {
          if (stateFilter && entry.monitoring.state !== stateFilter) return false;
          if (targetFunnelFilter) {
            const f = (entry.targetFunnel || "").toLowerCase();
            if (!f.includes(targetFunnelFilter)) return false;
          }
          return true;
        });

      // Se onlyWithProblems=true, analisamos um lote mais amplo (até 80) para garantir retorno de até `limit` problemáticos
      const analysisPool = preFiltered.slice(0, onlyWithProblems ? Math.max(limit * 4, 80) : limit);
      const poolConvIds = analysisPool.map((e) => e.flow.conversationId);
      const poolContactIds = [
        ...new Set(analysisPool.map((e) => e.conv?.contactId).filter((id): id is string => Boolean(id))),
      ];

      if (poolConvIds.length === 0) {
        return {
          tenantId,
          aiPersona: persona.name,
          period: dateWindow.period,
          rangeStartIso: dateWindow.startUtc ? dateWindow.startUtc.toISOString() : null,
          rangeEndIso: dateWindow.endUtc ? dateWindow.endUtc.toISOString() : null,
          generatedAt: now.toISOString(),
          auditSummary: {
            totalMatched: 0,
            returnedCount: 0,
            countsByState: {},
            countsByFunnel: {},
            countsByFlag: {},
            avgFirstResponseSeconds: null,
            avgFieldsCompletionPct: null,
            linkedDealsCoveragePct: null,
          },
          sessions: [],
        };
      }

      // 3. Batch fetch contacts, dialogue messages, linked deals and (optional) journal notes em paralelo
      const [contactRows, msgRows, dealLinkRows, journalRows] = await Promise.all([
        poolContactIds.length > 0
          ? db
              .select({
                id: contacts.id,
                name: contacts.name,
                phone: contacts.phone,
                mainChannel: contacts.mainChannel,
                cnpj: contacts.cnpj,
                cnpjDetails: contacts.cnpjDetails,
                customFields: contacts.customFields,
              })
              .from(contacts)
              .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, poolContactIds)))
          : Promise.resolve([]),
        db
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            senderType: messages.senderType,
            senderName: messages.senderName,
            content: messages.content,
            mediaInterpretation: messages.mediaInterpretation,
            sentAt: messages.sentAt,
          })
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, tenantId),
              inArray(messages.conversationId, poolConvIds),
              eq(messages.isInternalNote, false),
              ne(messages.senderType, "system"),
              isNotNull(messages.sentAt),
            ),
          )
          .orderBy(asc(messages.sentAt), asc(messages.id)),
        includeLinkedDeals
          ? db
              .select({
                conversationId: crmConversationDeals.conversationId,
                dealId: crmDeals.id,
                title: crmDeals.title,
                status: crmDeals.status,
                value: crmDeals.value,
                operatorId: crmDeals.operatorId,
                pipelineName: crmPipelines.name,
                stageName: crmStages.name,
                createdAt: crmDeals.createdAt,
              })
              .from(crmConversationDeals)
              .innerJoin(
                crmDeals,
                and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId)),
              )
              .leftJoin(
                crmPipelines,
                and(eq(crmPipelines.id, crmDeals.pipelineId), eq(crmPipelines.tenantId, tenantId)),
              )
              .leftJoin(
                crmStages,
                and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.tenantId, tenantId)),
              )
              .where(
                and(
                  eq(crmConversationDeals.tenantId, tenantId),
                  eq(crmConversationDeals.isActive, true),
                  inArray(crmConversationDeals.conversationId, poolConvIds),
                ),
              )
          : Promise.resolve([]),
        includeJournalNotes
          ? db
              .select({
                id: messages.id,
                conversationId: messages.conversationId,
                content: messages.content,
                sentAt: messages.sentAt,
                metaDetails: messages.metaDetails,
              })
              .from(messages)
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  inArray(messages.conversationId, poolConvIds),
                  eq(messages.isInternalNote, true),
                  isNotNull(messages.sentAt),
                ),
              )
              .orderBy(asc(messages.sentAt), asc(messages.id))
          : Promise.resolve([]),
      ]);

      const contactMap = new Map(contactRows.map((c) => [c.id, c]));
      const msgsByConv = new Map<string, typeof msgRows>();
      for (const m of msgRows) {
        const list = msgsByConv.get(m.conversationId);
        if (list) list.push(m);
        else msgsByConv.set(m.conversationId, [m]);
      }

      const dealsByConv = new Map<
        string,
        Array<{
          dealId: string;
          title: string;
          status: string;
          value: string | null;
          pipelineName: string | null;
          stageName: string | null;
          operatorName: string | null;
          createdAt: string | null;
        }>
      >();
      for (const d of dealLinkRows) {
        const item = {
          dealId: d.dealId,
          title: d.title,
          status: d.status,
          value: d.value !== null && d.value !== undefined ? String(d.value) : null,
          pipelineName: d.pipelineName ?? null,
          stageName: d.stageName ?? null,
          operatorName: d.operatorId ? opNameById.get(d.operatorId) ?? null : null,
          createdAt: safeIso(d.createdAt),
        };
        const list = dealsByConv.get(d.conversationId);
        if (list) list.push(item);
        else dealsByConv.set(d.conversationId, [item]);
      }

      const journalByConv = new Map<
        string,
        Array<{ at: string | null; kind: string; text: string }>
      >();
      for (const j of journalRows) {
        const triageMeta = (j.metaDetails as any)?.industrialTriage;
        if (String(triageMeta?.version ?? "") !== "1") continue;
        const entry = {
          at: safeIso(j.sentAt),
          kind: String(triageMeta.kind || "note"),
          text: String(j.content || "").slice(0, 1200),
        };
        const list = journalByConv.get(j.conversationId);
        if (list) list.push(entry);
        else journalByConv.set(j.conversationId, [entry]);
      }

      // 4. Montar dossiês completos com métricas e flags
      const builtSessions = analysisPool.map(({ flow, conv, monitoring, meta, collected, targetFunnel }) => {
        const contact = conv ? contactMap.get(conv.contactId) : undefined;
        const allConvMsgs = msgsByConv.get(flow.conversationId) || [];
        // Considerar mensagens do ciclo atual (a partir de 2 min antes de startedAt) para SLA fiel do ciclo
        const flowStartMs = flow.startedAt ? new Date(flow.startedAt).getTime() - 120_000 : 0;
        const cycleMsgs =
          flowStartMs > 0
            ? allConvMsgs.filter((m) => new Date(m.sentAt).getTime() >= flowStartMs)
            : allConvMsgs;
        const effectiveMsgs = cycleMsgs.length > 0 ? cycleMsgs : allConvMsgs;

        const metrics = computeTriageConversationMetrics(effectiveMsgs, now);
        const progress = computeIndustrialTriageProgress({
          collectedData: collected as any,
          route: meta?.route || undefined,
          isCompleted:
            flow.outcome === "transferred" ||
            flow.outcome === "completed" ||
            monitoring.state === "transferred",
        });
        const compactCollected = summarizeCollectedData(collected);
        const missingFields = progress.targetFields.filter((key) => !compactCollected[key]);

        const linkedDeals = dealsByConv.get(flow.conversationId) || [];
        const handoffIssue =
          (monitoring as any)?.handoffIssue?.code ||
          (monitoring as any)?.handoffIssue?.message ||
          null;

        const qualityFlags = detectTriageQualityFlags({
          monitoringState: monitoring.state,
          handoffIssue: handoffIssue ? String(handoffIssue) : null,
          outcome: flow.outcome ?? null,
          queueState: conv?.queueState || "unknown",
          metrics,
          fieldsPercentage: progress.percentage,
          linkedDealsCount: linkedDeals.length,
          hasTargetFunnel: Boolean(targetFunnel),
        });

        const transcript =
          messagesPerConversation > 0
            ? effectiveMsgs.slice(-messagesPerConversation).map((m) => ({
                at: safeIso(m.sentAt),
                sender:
                  m.senderType === "client"
                    ? "client"
                    : m.senderType === "agent"
                      ? "agent"
                      : "bot",
                senderName: m.senderName,
                text: compactMessageText(m.content, m.mediaInterpretation),
              }))
            : [];

        const company =
          compactCollected["EMPRESA"] ||
          (contact?.cnpjDetails as any)?.razaoSocial ||
          (contact?.customFields as any)?.company ||
          null;

        const pendingApprovalRaw =
          meta?.pendingApproval && typeof meta.pendingApproval === "object"
            ? (meta.pendingApproval as Record<string, any>)
            : null;

        return {
          flowId: flow.id,
          conversationId: flow.conversationId,
          contactName: contact?.name || compactCollected["NOME COMPLETO"] || "Contato",
          contactPhone: contact?.phone || null,
          company,
          channel: isSiteConversationId(flow.conversationId) ? "site" : "whatsapp",
          queueState: conv?.queueState || null,
          operatorId: conv?.operatorId || null,
          operatorName: conv?.operatorId ? opNameById.get(conv.operatorId) ?? null : null,
          startedAt: safeIso(flow.startedAt),
          lastInteractionAt: safeIso(flow.lastInteractionAt),
          completedAt: safeIso(flow.completedAt),
          outcome: flow.outcome ?? null,
          currentStep: flow.currentStep,
          monitoringState: monitoring.state,
          monitoringLabel: monitoring.label,
          handoffIssue: (monitoring as any)?.handoffIssue ?? null,
          targetFunnel,
          machineDecision: (monitoring as any)?.machineDecision ?? meta?.machineDecision ?? null,
          triageAccuracy: (monitoring as any)?.triageAccuracy ?? meta?.triageAccuracy ?? null,
          pendingApproval: pendingApprovalRaw
            ? {
                targetFunnel: pendingApprovalRaw.targetFunnel ?? null,
                suggestedSectorName: pendingApprovalRaw.suggestedSectorName ?? null,
                suggestedOperatorId: pendingApprovalRaw.suggestedOperatorId ?? null,
                suggestedOperatorName: pendingApprovalRaw.suggestedOperatorName ?? null,
                requestedAt: pendingApprovalRaw.requestedAt ?? pendingApprovalRaw.preparedAt ?? null,
              }
            : null,
          fieldsProgress: {
            filledCount: progress.filledCount,
            totalCount: progress.totalCount,
            percentage: progress.percentage,
            missingFields,
          },
          collectedData: compactCollected,
          metrics,
          qualityFlags,
          ...(includeLinkedDeals ? { linkedDeals } : {}),
          ...(messagesPerConversation > 0 ? { transcript } : {}),
          ...(includeJournalNotes
            ? { journalNotes: (journalByConv.get(flow.conversationId) || []).slice(-15) }
            : {}),
        };
      });

      const finalSessions = onlyWithProblems
        ? builtSessions.filter((s) => s.qualityFlags.length > 0).slice(0, limit)
        : builtSessions.slice(0, limit);

      // 5. Consolidar KPIs do lote
      const countsByState: Record<string, number> = {};
      const countsByFunnel: Record<string, number> = {};
      const countsByFlag: Record<string, number> = {};
      let firstResponseSum = 0;
      let firstResponseCount = 0;
      let fieldsPctSum = 0;
      let withDealsCount = 0;

      for (const s of finalSessions) {
        countsByState[s.monitoringState] = (countsByState[s.monitoringState] || 0) + 1;
        const fk = s.targetFunnel || "Sem funil definido";
        countsByFunnel[fk] = (countsByFunnel[fk] || 0) + 1;
        for (const fl of s.qualityFlags) {
          countsByFlag[fl] = (countsByFlag[fl] || 0) + 1;
        }
        if (s.metrics.firstResponseSeconds !== null) {
          firstResponseSum += s.metrics.firstResponseSeconds;
          firstResponseCount += 1;
        }
        fieldsPctSum += s.fieldsProgress.percentage;
        if (includeLinkedDeals && Array.isArray((s as any).linkedDeals) && (s as any).linkedDeals.length > 0) {
          withDealsCount += 1;
        }
      }

      return {
        tenantId,
        aiPersona: persona.name,
        period: dateWindow.period,
        rangeStartIso: dateWindow.startUtc ? dateWindow.startUtc.toISOString() : null,
        rangeEndIso: dateWindow.endUtc ? dateWindow.endUtc.toISOString() : null,
        generatedAt: now.toISOString(),
        timeZone: "America/Sao_Paulo",
        auditSummary: {
          totalMatched: onlyWithProblems
            ? builtSessions.filter((s) => s.qualityFlags.length > 0).length
            : preFiltered.length,
          returnedCount: finalSessions.length,
          countsByState,
          countsByFunnel,
          countsByFlag,
          avgFirstResponseSeconds:
            firstResponseCount > 0 ? Math.round(firstResponseSum / firstResponseCount) : null,
          avgFieldsCompletionPct:
            finalSessions.length > 0 ? Math.round(fieldsPctSum / finalSessions.length) : null,
          linkedDealsCoveragePct:
            includeLinkedDeals && finalSessions.length > 0
              ? Math.round((withDealsCount / finalSessions.length) * 1000) / 10
              : null,
        },
        sessions: finalSessions,
      };
    }

    default:
      throw new Error(`Ferramenta de auditoria de triagem desconhecida: '${name}'.`);
  }
}
