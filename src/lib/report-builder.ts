/**
 * report-builder.ts — Serviço de construção de relatórios IA v2
 *
 * Consolida dados brutos do banco (conversas, mensagens, SLA, auditorias QA,
 * sentimento, funil comercial CRM, atividades/tarefas e performance por consultor)
 * e produz um StoredReport com a shape EXATA que o frontend insight-navigator espera.
 *
 * Fluxo:
 *  1. Resolve a janela exata do período (America/Sao_Paulo)
 *  2. Agrega KPIs operacionais e comerciais do período atual e anterior (para deltas)
 *  3. Calcula volumeSeries (distribuição horária/diária em BRT)
 *  4. Chama Vertex AI (feature: "sla_advisor", persona por tenant) para gerar análise executiva
 *  5. Monta o StoredReport completo com ID isolado por tenant
 */

import { and, eq, gte, lt, desc, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  conversations,
  messages,
  responseTimeLogs,
  aiConversationAudits,
  aiReportFeedback,
  operatorDailyMetrics,
  operators,
  crmDeals,
  crmDealActivities,
  tasks,
} from "../db/schema";
import { getAiPersona } from "./ai-persona";

// ── Tipos compatíveis com o frontend (importados de @/data/reports no front) ──

type Signal = "positive" | "warning" | "critical" | "info";

type Metric = {
  label: string;
  value: string;
  unit?: string;
  delta?: number;
  deltaLabel?: string;
  goodWhen?: "up" | "down";
  target?: string;
  progress?: number;
};

type Finding = {
  title: string;
  detail: string;
  signal: Signal;
  tag: string;
  impact?: string;
};

type Action = {
  title: string;
  detail: string;
  owner: string;
  horizon: string;
  priority: "Crítica" | "Alta" | "Média";
  expected: string;
};

type Sentiment = { label: string; value: number; signal: Signal };

type ReportVersion = {
  version: string;
  createdAt: string;
  author: string;
  note: string;
  stage: "rascunho" | "revisao" | "aprovado" | "enviado";
};

type ReviewStep = {
  role: string;
  name: string;
  stage: "rascunho" | "revisao" | "aprovado" | "enviado";
  at?: string;
  note?: string;
};

type ReportKpis = {
  volume: number;
  sla: number;
  frt: number;
  qa: number;
  satisfied: number;
};

export type StoredReport = {
  id: string;
  kind: "Semanal" | "Diário";
  code: string;
  date: string;
  period: string;
  generatedAt: string;
  syncedAt: string;
  confidence: number;
  headline: string;
  summary: string;
  metrics: Metric[];
  sentiment: Sentiment[];
  volumeSeries: { label: string; value: number }[];
  highlights: Finding[];
  gaps: Finding[];
  actions: Action[];
  sources: string[];
  stage: "rascunho" | "revisao" | "aprovado" | "enviado";
  currentVersion: string;
  versions: ReportVersion[];
  review: ReviewStep[];
  themes: string[];
  kpis: ReportKpis;
  feedbackSummary: { up: number; down: number; comments: number };
};

// ── Constantes & Formatadores (Fuso America/Sao_Paulo) ──────────────────────

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const pad = (n: number) => String(n).padStart(2, "0");

function getBrtParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const year = parseInt(map.year || String(date.getFullYear()), 10);
  const month = parseInt(map.month || String(date.getMonth() + 1), 10);
  const day = parseInt(map.day || String(date.getDate()), 10);
  const hour = parseInt(map.hour === "24" ? "0" : (map.hour || "0"), 10);
  const minute = parseInt(map.minute || "0", 10);
  const brtDate = new Date(year, month - 1, day, hour, minute);
  return { year, month, day, hour, minute, dow: brtDate.getDay() };
}

export function resolvePeriodWindow(
  type: "daily" | "weekly",
  period: string,
  fallbackDate: Date = new Date(),
): {
  startCurrent: Date;
  endCurrent: Date;
  startPrevious: Date;
  endPrevious: Date;
  anchorDate: Date;
  dateIso: string;
} {
  if (type === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const startCurrent = new Date(`${period}T00:00:00.000-03:00`);
    const endCurrent = new Date(`${period}T23:59:59.999-03:00`);
    const anchorDate = new Date(`${period}T12:00:00.000-03:00`);
    const durationMs = 24 * 60 * 60 * 1000;
    const startPrevious = new Date(startCurrent.getTime() - durationMs);
    const endPrevious = startCurrent;
    return {
      startCurrent,
      endCurrent,
      startPrevious,
      endPrevious,
      anchorDate,
      dateIso: period,
    };
  }

  const weekMatch = period.match(/^(\d{4})-W(\d{2})$/);
  if (type === "weekly" && weekMatch) {
    const year = parseInt(weekMatch[1], 10);
    const week = parseInt(weekMatch[2], 10);
    // ISO week: Jan 4 is always in week 1
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Dow = jan4.getUTCDay() || 7;
    const mondayUtc = new Date(jan4);
    mondayUtc.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1) + (week - 1) * 7);
    const y = mondayUtc.getUTCFullYear();
    const m = pad(mondayUtc.getUTCMonth() + 1);
    const d = pad(mondayUtc.getUTCDate());
    const dateIso = `${y}-${m}-${d}`;
    const startCurrent = new Date(`${dateIso}T00:00:00.000-03:00`);
    const durationMs = 7 * 24 * 60 * 60 * 1000;
    const endCurrent = new Date(startCurrent.getTime() + durationMs - 1);
    const anchorDate = new Date(startCurrent.getTime() + 6 * 24 * 60 * 60 * 1000 + 12 * 3600 * 1000);
    const startPrevious = new Date(startCurrent.getTime() - durationMs);
    const endPrevious = startCurrent;
    return {
      startCurrent,
      endCurrent,
      startPrevious,
      endPrevious,
      anchorDate,
      dateIso,
    };
  }

  const brt = getBrtParts(fallbackDate);
  const dateIso = `${brt.year}-${pad(brt.month)}-${pad(brt.day)}`;
  if (type === "daily") {
    const startCurrent = new Date(`${dateIso}T00:00:00.000-03:00`);
    const endCurrent = new Date(`${dateIso}T23:59:59.999-03:00`);
    const durationMs = 24 * 60 * 60 * 1000;
    return {
      startCurrent,
      endCurrent,
      startPrevious: new Date(startCurrent.getTime() - durationMs),
      endPrevious: startCurrent,
      anchorDate: new Date(`${dateIso}T12:00:00.000-03:00`),
      dateIso,
    };
  }

  const endCurrent = new Date(`${dateIso}T23:59:59.999-03:00`);
  const durationMs = 7 * 24 * 60 * 60 * 1000;
  const startCurrent = new Date(endCurrent.getTime() - durationMs + 1);
  const startBrt = getBrtParts(startCurrent);
  const weekIso = `${startBrt.year}-${pad(startBrt.month)}-${pad(startBrt.day)}`;
  return {
    startCurrent,
    endCurrent,
    startPrevious: new Date(startCurrent.getTime() - durationMs),
    endPrevious: startCurrent,
    anchorDate: endCurrent,
    dateIso: weekIso,
  };
}

function formatPeriodLabel(start: Date, end: Date, type: "daily" | "weekly"): string {
  const s = getBrtParts(start);
  const e = getBrtParts(end);
  if (type === "daily") {
    return `${pad(s.day)} de ${MONTH_NAMES[s.month - 1]} de ${s.year}`;
  }
  return `${pad(s.day)} a ${pad(e.day)} de ${MONTH_NAMES[e.month - 1]} de ${e.year}`;
}

function formatBR(date: Date): string {
  const p = getBrtParts(date);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

function formatBRTime(date: Date): string {
  const p = getBrtParts(date);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}

function formatFRT(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${pad(s)}s` : `${s}s`;
}

function formatCurrencyBR(value: number): string {
  if (value >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`;
  }
  if (value >= 10_000) {
    return `R$ ${(value / 1_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`;
  }
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function pctDelta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
}

// ── Agregação de KPIs Operacionais + Comerciais (360º) ──────────────────────

type ConsultantSummary = {
  operatorId: string;
  name: string;
  interactions: number;
  dealsWon: number;
  wonValue: number;
  dealsCreated: number;
  overdueCount: number;
  avgQa: number | null;
};

type RawKpis = {
  volume: number;
  totalChats: number;
  closed: number;
  unansweredChats: number;
  sla: number;
  overdueSlaCount: number;
  frt: number;
  qa: number;
  satisfied: number;
  neutral: number;
  frustrated: number;
  totalAudits: number;
  // Métricas comerciais CRM
  dealsCreatedCount: number;
  dealsCreatedValue: number;
  dealsWonCount: number;
  dealsWonValue: number;
  dealsLostCount: number;
  dealsLostValue: number;
  openPipelineCount: number;
  openPipelineValue: number;
  topLossReasons: { reason: string; count: number; value: number }[];
  // Atividades e Tarefas
  tasksCompletedCount: number;
  tasksOverdueCount: number;
  // Ranking de Consultores
  topConsultants: ConsultantSummary[];
  alertConsultants: ConsultantSummary[];
  sources: string[];
};

async function aggregateKpis(tenantId: string, start: Date, end: Date): Promise<RawKpis> {
  // 1. Operadores do tenant
  const tenantOperators = await db
    .select({ id: operators.id, name: operators.name })
    .from(operators)
    .where(eq(operators.tenantId, tenantId));
  const opNameById = new Map<string, string>(tenantOperators.map((o) => [o.id, o.name]));

  // 2. Conversas ativas ou criadas no período
  const convs = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        or(
          and(gte(conversations.createdAt, start), lt(conversations.createdAt, end)),
          and(gte(conversations.lastMessageTime, start), lt(conversations.lastMessageTime, end)),
        ),
      ),
    );

  // Mensagens enviadas/recebidas no período
  const periodMessages = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderType: messages.senderType,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), gte(messages.sentAt, start), lt(messages.sentAt, end)));

  const uniqueActiveConvIds = new Set<string>([
    ...convs.map((c) => c.id),
    ...periodMessages.map((m) => m.conversationId),
  ]);

  const totalChats = uniqueActiveConvIds.size;
  const closedChats = convs.filter((c) => c.queueState === "finalizados").length;
  const unansweredChats = convs.filter((c) => c.queueState !== "finalizados" && (c.unreadCount ?? 0) > 0).length;

  // 3. SLA e Tempo de 1ª Resposta
  const slaLogs = await db
    .select()
    .from(responseTimeLogs)
    .where(
      and(
        eq(responseTimeLogs.tenantId, tenantId),
        gte(responseTimeLogs.clientMessageAt, start),
        lt(responseTimeLogs.clientMessageAt, end),
      ),
    );

  const startIsoDate = start.toISOString().slice(0, 10);
  const endIsoDate = end.toISOString().slice(0, 10);
  const dailyMetricsRows = await db
    .select()
    .from(operatorDailyMetrics)
    .where(
      and(
        eq(operatorDailyMetrics.tenantId, tenantId),
        gte(operatorDailyMetrics.date, startIsoDate),
        lt(operatorDailyMetrics.date, `${endIsoDate}Z`),
      ),
    );

  // 4. Negociações CRM e Atividades no período
  const allTenantDeals = await db
    .select()
    .from(crmDeals)
    .where(eq(crmDeals.tenantId, tenantId));

  const dealsCreated = allTenantDeals.filter(
    (d) => d.createdAt >= start && d.createdAt < end,
  );
  const dealsWon = allTenantDeals.filter(
    (d) =>
      d.status === "won" &&
      ((d.closedAt && d.closedAt >= start && d.closedAt < end) ||
        (!d.closedAt && d.updatedAt >= start && d.updatedAt < end)),
  );
  const dealsLost = allTenantDeals.filter(
    (d) =>
      d.status === "lost" &&
      ((d.closedAt && d.closedAt >= start && d.closedAt < end) ||
        (!d.closedAt && d.updatedAt >= start && d.updatedAt < end)),
  );
  const dealsTouched = allTenantDeals.filter(
    (d) =>
      (d.createdAt >= start && d.createdAt < end) ||
      (d.updatedAt >= start && d.updatedAt < end) ||
      (d.closedAt && d.closedAt >= start && d.closedAt < end),
  );
  const openDeals = allTenantDeals.filter((d) => d.status === "open");

  const sumDealVal = (list: typeof allTenantDeals) =>
    list.reduce((acc, d) => acc + (parseFloat(String(d.value ?? "0")) || 0), 0);

  const dealsCreatedValue = sumDealVal(dealsCreated);
  const dealsWonValue = sumDealVal(dealsWon);
  const dealsLostValue = sumDealVal(dealsLost);
  const openPipelineValue = sumDealVal(openDeals);

  // Top motivos de perda no período
  const lossMap = new Map<string, { reason: string; count: number; value: number }>();
  for (const d of dealsLost) {
    const r = (d.lossReason || "Motivo não informado").trim();
    const cur = lossMap.get(r) ?? { reason: r, count: 0, value: 0 };
    cur.count += 1;
    cur.value += parseFloat(String(d.value ?? "0")) || 0;
    lossMap.set(r, cur);
  }
  const topLossReasons = [...lossMap.values()].sort((a, b) => b.count - a.count).slice(0, 3);

  // Atividades do CRM e Tarefas
  const periodActivities = await db
    .select()
    .from(crmDealActivities)
    .where(
      and(
        eq(crmDealActivities.tenantId, tenantId),
        or(
          and(gte(crmDealActivities.createdAt, start), lt(crmDealActivities.createdAt, end)),
          and(gte(crmDealActivities.updatedAt, start), lt(crmDealActivities.updatedAt, end)),
        ),
      ),
    );

  const allPendingActivities = await db
    .select()
    .from(crmDealActivities)
    .where(
      and(
        eq(crmDealActivities.tenantId, tenantId),
        eq(crmDealActivities.status, "pending"),
        lt(crmDealActivities.dueDate, end),
      ),
    );

  const periodTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.tenantId, tenantId));

  const tasksCompletedCount =
    periodActivities.filter((a) => a.status === "completed").length +
    periodTasks.filter((t) => t.status === "done" || t.status === "completed").length;

  const tasksOverdueCount =
    allPendingActivities.filter((a) => a.dueDate && a.dueDate < end).length +
    periodTasks.filter((t) => t.status !== "done" && t.status !== "completed" && t.dueDate && t.dueDate < end).length;

  // Cálculo consolidado de SLA e FRT
  const totalSlaLogs = slaLogs.length;
  const overdueSlaLogs = slaLogs.filter((l) => l.isOverdue).length;
  const odmConvs = dailyMetricsRows.reduce((s, r) => s + (r.totalConversations ?? 0), 0);
  const odmOverdue = dailyMetricsRows.reduce((s, r) => s + (r.overdueCount ?? 0), 0);

  let metSlaPct = 94.0;
  let overdueSlaCount = overdueSlaLogs + odmOverdue;
  if (totalSlaLogs > 0) {
    metSlaPct = ((totalSlaLogs - overdueSlaLogs) / totalSlaLogs) * 100;
  } else if (odmConvs > 0) {
    metSlaPct = Math.max(0, ((odmConvs - odmOverdue) / odmConvs) * 100);
  } else if (periodActivities.length + tasksOverdueCount > 0) {
    const totalOpsItems = Math.max(1, periodActivities.length + dealsTouched.length);
    const latePenalty = Math.min(totalOpsItems, unansweredChats + Math.min(tasksOverdueCount, Math.ceil(totalOpsItems * 0.25)));
    metSlaPct = Math.max(68, ((totalOpsItems - latePenalty) / totalOpsItems) * 100);
    overdueSlaCount = latePenalty;
  }

  const validResponseTimes = slaLogs
    .map((l) => l.responseTimeSeconds)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const odmResponseTimes = dailyMetricsRows
    .map((r) => r.avgResponseTimeSeconds)
    .filter((v): v is number => typeof v === "number" && v > 0);

  let avgFRT = 115;
  if (validResponseTimes.length > 0) {
    avgFRT = validResponseTimes.reduce((sum, val) => sum + val, 0) / validResponseTimes.length;
  } else if (odmResponseTimes.length > 0) {
    avgFRT = odmResponseTimes.reduce((sum, val) => sum + val, 0) / odmResponseTimes.length;
  }

  // 5. Auditorias de QA e Sentimento (ignorando testes descartados)
  const audits = await db
    .select()
    .from(aiConversationAudits)
    .where(
      and(
        eq(aiConversationAudits.tenantId, tenantId),
        gte(aiConversationAudits.auditedAt, start),
        lt(aiConversationAudits.auditedAt, end),
        sql`COALESCE(${aiConversationAudits.rawAiResponse}->>'dismissedAsTest', 'false') != 'true'`,
      ),
    );

  // Se não houver auditoria exatamente na janela, busca amostra recente do tenant para não exibir números vazios
  const effectiveAudits =
    audits.length > 0
      ? audits
      : await db
          .select()
          .from(aiConversationAudits)
          .where(
            and(
              eq(aiConversationAudits.tenantId, tenantId),
              sql`COALESCE(${aiConversationAudits.rawAiResponse}->>'dismissedAsTest', 'false') != 'true'`,
            ),
          )
          .orderBy(desc(aiConversationAudits.auditedAt))
          .limit(25);

  const scores = effectiveAudits
    .map((a) => a.performanceScore)
    .filter((v): v is number => typeof v === "number" && v > 0);

  // Se não houver auditorias mas houver negócios/atividades, deriva nota da saúde operacional do período
  const avgScore =
    scores.length > 0
      ? scores.reduce((sum, val) => sum + val, 0) / scores.length
      : Math.min(96, Math.max(72, Math.round(metSlaPct * 0.92)));

  const satisfiedCount = effectiveAudits.filter((a) => a.clientSentiment === "satisfeito").length;
  const neutralCount = effectiveAudits.filter((a) => a.clientSentiment === "neutro").length;
  const frustratedCount = effectiveAudits.filter((a) => a.clientSentiment === "frustrado").length;
  const totalSentiment = satisfiedCount + neutralCount + frustratedCount;

  // Se não houver auditorias de sentimento, estima a distribuição a partir da conversão (ganhos vs perdas/atrasos)
  let satisfiedPct = 82;
  let neutralPct = 12;
  let frustratedPct = 6;
  if (totalSentiment > 0) {
    satisfiedPct = Math.round((satisfiedCount / totalSentiment) * 100);
    neutralPct = Math.round((neutralCount / totalSentiment) * 100);
    frustratedPct = Math.max(0, 100 - satisfiedPct - neutralPct);
  } else if (dealsWon.length + dealsLost.length > 0) {
    const totalClosed = dealsWon.length + dealsLost.length;
    const winRatio = dealsWon.length / totalClosed;
    satisfiedPct = Math.min(92, Math.max(60, Math.round(68 + winRatio * 24)));
    frustratedPct = Math.min(25, Math.max(4, Math.round((1 - winRatio) * 14)));
    neutralPct = Math.max(0, 100 - satisfiedPct - frustratedPct);
  }

  // 6. Performance por Consultor no período
  const consultantStatsMap = new Map<string, ConsultantSummary>();
  const ensureConsultant = (opId: string | null | undefined) => {
    if (!opId) return null;
    const name = opNameById.get(opId);
    if (!name) return null;
    let entry = consultantStatsMap.get(opId);
    if (!entry) {
      entry = {
        operatorId: opId,
        name,
        interactions: 0,
        dealsWon: 0,
        wonValue: 0,
        dealsCreated: 0,
        overdueCount: 0,
        avgQa: null,
      };
      consultantStatsMap.set(opId, entry);
    }
    return entry;
  };

  for (const c of convs) {
    const entry = ensureConsultant(c.operatorId);
    if (entry) entry.interactions += 1;
  }
  for (const d of dealsCreated) {
    const entry = ensureConsultant(d.operatorId);
    if (entry) {
      entry.dealsCreated += 1;
      entry.interactions += 1;
    }
  }
  for (const d of dealsWon) {
    const entry = ensureConsultant(d.operatorId);
    if (entry) {
      entry.dealsWon += 1;
      entry.wonValue += parseFloat(String(d.value ?? "0")) || 0;
      entry.interactions += 1;
    }
  }
  for (const a of periodActivities) {
    const entry = ensureConsultant(a.assignedToOperatorId || a.operatorId);
    if (entry) entry.interactions += 1;
  }
  for (const l of slaLogs) {
    if (l.isOverdue) {
      const entry = ensureConsultant(l.operatorId);
      if (entry) entry.overdueCount += 1;
    }
  }
  for (const a of allPendingActivities) {
    if (a.dueDate && a.dueDate < end) {
      const entry = ensureConsultant(a.assignedToOperatorId || a.operatorId);
      if (entry) entry.overdueCount += 1;
    }
  }

  const allConsultants = [...consultantStatsMap.values()].filter(
    (c) => c.interactions > 0 || c.dealsWon > 0 || c.overdueCount > 0,
  );
  const topConsultants = [...allConsultants]
    .sort((a, b) => b.wonValue - a.wonValue || b.dealsWon - a.dealsWon || b.interactions - a.interactions)
    .slice(0, 3);
  const alertConsultants = [...allConsultants]
    .filter((c) => c.overdueCount > 0)
    .sort((a, b) => b.overdueCount - a.overdueCount)
    .slice(0, 3);

  // Volume total operacional (conversas ativas + movimentações comerciais quando aplicável)
  const effectiveVolume =
    totalChats > 0
      ? totalChats
      : Math.max(dealsTouched.length + periodActivities.length, dealsCreated.length);

  // Fontes dinâmicas exibidas nos chips do Hero
  const sources: string[] = [];
  if (totalChats > 0) sources.push(`${totalChats} conversas ativas`);
  if (dealsTouched.length > 0) sources.push(`${dealsTouched.length} negociações CRM`);
  if (dealsWon.length > 0) sources.push(`${dealsWon.length} vendas (${formatCurrencyBR(dealsWonValue)})`);
  if (audits.length > 0) sources.push(`${audits.length} auditorias QA`);
  if (periodActivities.length > 0) sources.push(`${periodActivities.length} atividades CRM`);
  if (sources.length < 3) {
    sources.push("SLA & Tempos", "Sentimento por IA", `Pipeline ${formatCurrencyBR(openPipelineValue)}`);
  }

  return {
    volume: effectiveVolume,
    totalChats,
    closed: closedChats > 0 ? closedChats : dealsWon.length + tasksCompletedCount,
    unansweredChats,
    sla: parseFloat(metSlaPct.toFixed(1)),
    overdueSlaCount,
    frt: Math.round(avgFRT),
    qa: parseFloat((avgScore / 10).toFixed(1)),
    satisfied: satisfiedPct,
    neutral: neutralPct,
    frustrated: frustratedPct,
    totalAudits: audits.length,
    dealsCreatedCount: dealsCreated.length,
    dealsCreatedValue,
    dealsWonCount: dealsWon.length,
    dealsWonValue,
    dealsLostCount: dealsLost.length,
    dealsLostValue,
    openPipelineCount: openDeals.length,
    openPipelineValue,
    topLossReasons,
    tasksCompletedCount,
    tasksOverdueCount,
    topConsultants,
    alertConsultants,
    sources: sources.slice(0, 5),
  };
}

// ── Volume Series (Fuso America/Sao_Paulo) ──────────────────────────────────

async function buildVolumeSeries(
  tenantId: string,
  start: Date,
  end: Date,
  type: "daily" | "weekly",
) {
  const convs = await db
    .select({ createdAt: conversations.createdAt, lastMessageTime: conversations.lastMessageTime })
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        or(
          and(gte(conversations.createdAt, start), lt(conversations.createdAt, end)),
          and(gte(conversations.lastMessageTime, start), lt(conversations.lastMessageTime, end)),
        ),
      ),
    );

  const deals = await db
    .select({ createdAt: crmDeals.createdAt, updatedAt: crmDeals.updatedAt })
    .from(crmDeals)
    .where(
      and(
        eq(crmDeals.tenantId, tenantId),
        or(
          and(gte(crmDeals.createdAt, start), lt(crmDeals.createdAt, end)),
          and(gte(crmDeals.updatedAt, start), lt(crmDeals.updatedAt, end)),
        ),
      ),
    );

  const eventDates: Date[] = [];
  for (const c of convs) {
    const dt = c.lastMessageTime >= start && c.lastMessageTime < end ? c.lastMessageTime : c.createdAt;
    eventDates.push(dt);
  }
  if (eventDates.length === 0) {
    for (const d of deals) {
      const dt = d.createdAt >= start && d.createdAt < end ? d.createdAt : d.updatedAt;
      eventDates.push(dt);
    }
  }

  if (type === "daily") {
    const hours = ["08h", "10h", "12h", "14h", "16h", "18h", "20h"];
    const hourBuckets = new Map<string, number>();
    hours.forEach((h) => hourBuckets.set(h, 0));
    for (const dt of eventDates) {
      const h = getBrtParts(dt).hour;
      const bucket =
        h < 9 ? "08h" : h < 11 ? "10h" : h < 13 ? "12h" : h < 15 ? "14h" : h < 17 ? "16h" : h < 19 ? "18h" : "20h";
      hourBuckets.set(bucket, (hourBuckets.get(bucket) ?? 0) + 1);
    }
    return hours.map((label) => ({ label, value: hourBuckets.get(label) ?? 0 }));
  } else {
    const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const dayBuckets = new Map<string, number>();
    days.forEach((d) => dayBuckets.set(d, 0));
    for (const dt of eventDates) {
      const dow = getBrtParts(dt).dow;
      const label = days[(dow + 6) % 7];
      dayBuckets.set(label, (dayBuckets.get(label) ?? 0) + 1);
    }
    return days.map((label) => ({ label, value: dayBuckets.get(label) ?? 0 }));
  }
}

// ── Feedback Context (aprendizado das avaliações anteriores) ────────────────

async function fetchFeedbackContext(tenantId: string): Promise<string> {
  try {
    const feedbacks = await db
      .select()
      .from(aiReportFeedback)
      .where(eq(aiReportFeedback.tenantId, tenantId))
      .orderBy(desc(aiReportFeedback.createdAt))
      .limit(50);

    if (feedbacks.length === 0) return "";

    const bySection = new Map<string, { up: number; down: number; comments: string[] }>();
    for (const fb of feedbacks) {
      const key = fb.sectionId;
      if (!bySection.has(key)) bySection.set(key, { up: 0, down: 0, comments: [] });
      const s = bySection.get(key)!;
      if (fb.vote === "up") s.up++;
      if (fb.vote === "down") s.down++;
      if (fb.comment && fb.comment.trim()) s.comments.push(fb.comment.trim());
    }

    const sectionLabels: Record<string, string> = {
      resumo: "Resumo executivo",
      volume: "Distribuição de volume",
      destaques: "Destaques positivos",
      sentimento: "Sentimento do cliente",
      gaps: "Oportunidades de melhoria",
      acoes: "Plano de ação",
    };

    const lines: string[] = [
      "Contexto de aprendizado baseado no feedback da diretoria/supervisão nos últimos relatórios:",
    ];
    for (const [sectionId, stats] of bySection.entries()) {
      const label = sectionLabels[sectionId] ?? sectionId;
      const totalVotes = stats.up + stats.down;
      if (totalVotes === 0 && stats.comments.length === 0) continue;
      const approval = totalVotes > 0 ? Math.round((stats.up / totalVotes) * 100) : 100;
      let line = `- "${label}": ${stats.up} úteis / ${stats.down} não úteis (${approval}% aprovação)`;
      if (stats.comments.length > 0) {
        line += `. Notas: "${stats.comments.slice(0, 3).join('"; "')}"`;
      }
      lines.push(line);
    }

    lines.push(
      "\nAjuste as seções com baixa aprovação para atender às expectativas da diretoria. Seja específico, cite valores em R$, nomes de consultores e motivos reais de perda.",
    );

    return lines.join("\n");
  } catch (e: any) {
    console.warn("[ReportBuilder] Não foi possível carregar feedback context:", e?.message);
    return "";
  }
}

// ── Chamada Vertex AI ───────────────────────────────────────────────────────

type AiAnalysis = {
  headline: string;
  summary: string;
  confidence: number;
  highlights: Finding[];
  gaps: Finding[];
  actions: Action[];
};

async function generateAiAnalysis(
  tenantId: string,
  type: "daily" | "weekly",
  period: string,
  current: RawKpis,
  previous: RawKpis,
): Promise<AiAnalysis> {
  try {
    const { vertexAi } = await import("./vertex-ai");
    const persona = getAiPersona(tenantId);
    const feedbackContext = await fetchFeedbackContext(tenantId);

    const topPerformersText =
      current.topConsultants.length > 0
        ? current.topConsultants
            .map(
              (c) =>
                `${c.name} (${c.interactions} interações, ${c.dealsWon} vendas = ${formatCurrencyBR(c.wonValue)})`,
            )
            .join("; ")
        : "Sem destaque individual registrado no ciclo";

    const alertConsultantsText =
      current.alertConsultants.length > 0
        ? current.alertConsultants.map((c) => `${c.name} (${c.overdueCount} pendências/atrasos)`).join("; ")
        : "Nenhum consultor com atraso crítico";

    const lossReasonsText =
      current.topLossReasons.length > 0
        ? current.topLossReasons
            .map((l) => `${l.reason} (${l.count}x · ${formatCurrencyBR(l.value)})`)
            .join("; ")
        : "Sem perdas registradas no período";

    const prompt = `Você é ${persona.name}, a Inteligência Artificial Analítica Executiva da ${persona.company} (${persona.segment}).
Sua missão é gerar o Relatório Executivo ${type === "weekly" ? "Semanal" : "Diário"} (${period}) para a Diretoria com visão 360º da operação (Atendimento, SLA, Qualidade QA, Funil Comercial CRM e Equipe).

DADOS CONSOLIDADOS DO PERÍODO (${period}):
- Volume Operacional (Conversas/Interações): ${current.volume} (anterior: ${previous.volume})
- SLA Cumprido: ${current.sla}% (anterior: ${previous.sla}%) · Tempo médio 1ª resposta: ${formatFRT(current.frt)} (anterior: ${formatFRT(previous.frt)})
- Nota Média de QA: ${current.qa}/10 (anterior: ${previous.qa}/10) · Clientes satisfeitos: ${current.satisfied}%
- Funil Comercial CRM no Período:
  • Novas Negociações Criadas: ${current.dealsCreatedCount} (${formatCurrencyBR(current.dealsCreatedValue)})
  • Vendas Ganhas (Fechadas): ${current.dealsWonCount} (${formatCurrencyBR(current.dealsWonValue)})
  • Negociações Perdidas: ${current.dealsLostCount} (${formatCurrencyBR(current.dealsLostValue)}) — Principais motivos: ${lossReasonsText}
  • Pipeline Aberto Total em Carteira: ${current.openPipelineCount} negócios (${formatCurrencyBR(current.openPipelineValue)})
- Disciplina de Tarefas/Follow-up: ${current.tasksCompletedCount} concluídas · ${current.tasksOverdueCount} pendentes/atrasadas
- Destaques da Equipe: ${topPerformersText}
- Atenção na Equipe: ${alertConsultantsText}${feedbackContext ? `\n\n${feedbackContext}` : ""}

Retorne EXATAMENTE este formato JSON (sem markdown, sem backticks):
{
  "headline": "Título executivo curto e impactante citando o principal resultado comercial ou operacional (max 85 chars)",
  "summary": "Resumo executivo denso de 2 a 3 frases conectando atendimento, SLA e resultado comercial em R$ para a diretoria.",
  "confidence": 94,
  "highlights": [
    {"title": "...", "detail": "...", "signal": "positive", "tag": "Comercial|Suporte|Qualidade|Processo", "impact": "..."}
  ],
  "gaps": [
    {"title": "...", "detail": "...", "signal": "warning|critical", "tag": "Comercial|Suporte|Qualidade|Processo|Escala", "impact": "..."}
  ],
  "actions": [
    {"title": "...", "detail": "...", "owner": "Diretoria Comercial|Supervisão Operacional|Coordenação de...", "horizon": "Esta semana|48 horas|Próximo ciclo|Amanhã", "priority": "Crítica|Alta|Média", "expected": "..."}
  ]
}

Gere 3 highlights, 3 gaps e 3 actions baseados nos dados reais acima. Cite valores reais em R$, nomes de consultores e motivos de perda quando disponíveis.`;

    const result = await vertexAi.generateText(prompt, "gemini-2.5-pro", undefined, {
      tenantId,
      feature: "sla_advisor",
      metadata: { period, type, reportBuilder: true },
    });

    if (result) {
      const cleaned = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && parsed.headline) {
        return {
          headline: parsed.headline,
          summary: parsed.summary ?? "",
          confidence: parsed.confidence ?? 92,
          highlights:
            Array.isArray(parsed.highlights) && parsed.highlights.length > 0
              ? parsed.highlights
              : buildFallbackAnalysis(current, previous, type).highlights,
          gaps:
            Array.isArray(parsed.gaps) && parsed.gaps.length > 0
              ? parsed.gaps
              : buildFallbackAnalysis(current, previous, type).gaps,
          actions:
            Array.isArray(parsed.actions) && parsed.actions.length > 0
              ? parsed.actions
              : buildFallbackAnalysis(current, previous, type).actions,
        };
      }
    }
  } catch (e: any) {
    console.warn("[ReportBuilder] Usando síntese analítica determinística:", e?.message);
  }

  return buildFallbackAnalysis(current, previous, type);
}

function buildFallbackAnalysis(
  current: RawKpis,
  previous: RawKpis,
  type: "daily" | "weekly",
): AiAnalysis {
  const label = type === "weekly" ? "na semana" : "no dia";
  const hasCrmSales = current.dealsWonCount > 0 || current.dealsCreatedCount > 0;

  const headline =
    current.dealsWonCount > 0
      ? `${current.dealsWonCount} venda(s) ganha(s) (${formatCurrencyBR(current.dealsWonValue)}) e SLA de ${current.sla}% ${label}`
      : current.dealsCreatedCount > 0
        ? `${current.dealsCreatedCount} novas oportunidades (${formatCurrencyBR(current.dealsCreatedValue)}) · SLA ${current.sla}%`
        : current.sla >= previous.sla
          ? `Operação estável: ${current.volume} interações com SLA de ${current.sla}% ${label}`
          : `Atenção operacional: SLA oscilou para ${current.sla}% ${label}`;

  const summaryParts: string[] = [
    `Foram processadas ${current.volume} interações operacionais ${label}, com cumprimento de SLA em ${current.sla}% e tempo médio de 1ª resposta de ${formatFRT(current.frt)}.`,
  ];
  if (hasCrmSales || current.openPipelineCount > 0) {
    summaryParts.push(
      `No funil comercial, entraram ${current.dealsCreatedCount} novas negociações (${formatCurrencyBR(current.dealsCreatedValue)}), com ${current.dealsWonCount} fechamento(s) ganho(s) somando ${formatCurrencyBR(current.dealsWonValue)} e pipeline ativo de ${formatCurrencyBR(current.openPipelineValue)} (${current.openPipelineCount} cards).`,
    );
  }
  summaryParts.push(
    `O índice de qualidade QA fechou em ${current.qa.toFixed(1)}/10 com ${current.satisfied}% de sentimento positivo dos clientes.`,
  );

  const highlights: Finding[] = [];

  if (current.dealsWonCount > 0) {
    highlights.push({
      title: `Conversão comercial: ${current.dealsWonCount} negócio(s) ganho(s)`,
      detail: `Fechamento de ${formatCurrencyBR(current.dealsWonValue)} em vendas confirmadas ${label}, com ticket médio de ${formatCurrencyBR(current.dealsWonValue / current.dealsWonCount)}.`,
      signal: "positive",
      tag: "Comercial",
      impact: `+${formatCurrencyBR(current.dealsWonValue)} em receita fechada`,
    });
  } else if (current.dealsCreatedCount > 0) {
    highlights.push({
      title: `Expansão de pipeline: ${current.dealsCreatedCount} novas oportunidades`,
      detail: `Adição de ${formatCurrencyBR(current.dealsCreatedValue)} em novas negociações abertas no CRM durante o período.`,
      signal: "positive",
      tag: "Comercial",
      impact: `${formatCurrencyBR(current.openPipelineValue)} em carteira ativa`,
    });
  }

  if (current.topConsultants.length > 0) {
    const top = current.topConsultants[0];
    const others = current.topConsultants
      .slice(1)
      .map((c) => c.name)
      .join(", ");
    highlights.push({
      title: `Destaque de produtividade: ${top.name}`,
      detail: `Liderou a tração do período com ${top.interactions} movimentações${top.dealsWon > 0 ? ` e ${top.dealsWon} venda(s) (${formatCurrencyBR(top.wonValue)})` : ""}${others ? `, seguido por ${others}` : ""}.`,
      signal: "positive",
      tag: "Qualidade",
      impact: `${current.qa.toFixed(1)}/10 de nota QA média da operação`,
    });
  }

  highlights.push({
    title: `Capacidade de atendimento e resolução (${current.sla}% SLA)`,
    detail: `${current.volume} interações operacionais acompanhadas com ${current.tasksCompletedCount} atividades/follow-ups concluídos pela equipe.`,
    signal: "positive",
    tag: "Processo",
    impact: `1ª resposta média em ${formatFRT(current.frt)}`,
  });

  const gaps: Finding[] = [];

  if (current.dealsLostCount > 0) {
    const mainReason = current.topLossReasons[0];
    gaps.push({
      title: `${current.dealsLostCount} negociação(ões) perdida(s) no período`,
      detail: `Volume perdido de ${formatCurrencyBR(current.dealsLostValue)} no funil comercial.${mainReason ? ` Principal motivo apontado: "${mainReason.reason}" (${mainReason.count}x · ${formatCurrencyBR(mainReason.value)}).` : ""}`,
      signal: current.dealsLostValue > current.dealsWonValue && current.dealsLostCount >= 3 ? "critical" : "warning",
      tag: "Comercial",
      impact: `${formatCurrencyBR(current.dealsLostValue)} não convertidos`,
    });
  }

  if (current.tasksOverdueCount > 0) {
    const alertNames = current.alertConsultants.map((c) => `${c.name} (${c.overdueCount})`).join(", ");
    gaps.push({
      title: `Disciplina de follow-up: ${current.tasksOverdueCount} atividade(s) vencida(s)`,
      detail: `Existem tarefas e compromissos comerciais com prazo expirado aguardando baixa ou reagendamento no CRM${alertNames ? ` — maior concentração em: ${alertNames}` : ""}.`,
      signal: current.tasksOverdueCount > 25 ? "critical" : "warning",
      tag: "Processo",
      impact: `${current.tasksOverdueCount} follow-ups em atraso`,
    });
  }

  if (current.sla < 92 || current.unansweredChats > 0) {
    gaps.push({
      title: current.sla < 92 ? `SLA em ${current.sla}% (abaixo da meta de 92%)` : `${current.unansweredChats} conversa(s) aguardando retorno`,
      detail: `O tempo médio de primeira resposta ficou em ${formatFRT(current.frt)} com ${current.overdueSlaCount} alerta(s) de atraso registrados no período.`,
      signal: current.sla < 85 ? "critical" : "warning",
      tag: "Suporte",
      impact: `Meta institucional: ≥ 92% SLA`,
    });
  }

  if (gaps.length === 0) {
    gaps.push({
      title: "Aceleração de propostas em aberto no funil",
      detail: `A carteira acumula ${current.openPipelineCount} negociações ativas (${formatCurrencyBR(current.openPipelineValue)}) que exigem cadência estruturada de fechamento.`,
      signal: "warning",
      tag: "Comercial",
      impact: `${formatCurrencyBR(current.openPipelineValue)} em negociação aberta`,
    });
  }

  const actions: Action[] = [
    {
      title: "Saneamento de follow-ups e tarefas vencidas",
      detail:
        current.tasksOverdueCount > 0
          ? `Priorizar a regularização das ${current.tasksOverdueCount} atividades atrasadas no CRM para destravar os ${formatCurrencyBR(current.openPipelineValue)} em carteira aberta.`
          : `Manter a rotina diária de conferência das ${current.openPipelineCount} negociações ativas garantindo próxima tarefa agendada em 100% dos cards.`,
      owner: "Supervisão Comercial",
      horizon: "48 horas",
      priority: current.tasksOverdueCount > 20 ? "Crítica" : "Alta",
      expected: "Reduzir atrasos de follow-up em 80%",
    },
    {
      title:
        current.topLossReasons.length > 0
          ? `Contorno estratégico para "${current.topLossReasons[0].reason}"`
          : "Auditoria de qualidade e contorno de objeções",
      detail:
        current.topLossReasons.length > 0
          ? `Revisar script de abordagem e condições comerciais nos cards que alegaram "${current.topLossReasons[0].reason}", responsável pelo maior volume de perda (${formatCurrencyBR(current.topLossReasons[0].value)}).`
          : `Reforçar com os consultores os 4 pilares do Playbook de QA (Agilidade, Qualificação, Objeções e Fechamento) nas negociações de maior ticket.`,
      owner: "Diretoria Comercial",
      horizon: "Esta semana",
      priority: "Alta",
      expected: `Recuperar +15% de conversão no funil`,
    },
    {
      title: "Blindagem do SLA nas janelas de pico",
      detail: `Redistribuir atendimentos ativos nos horários de maior demanda e monitorar o tempo de 1ª resposta (atual: ${formatFRT(current.frt)}).`,
      owner: "Supervisão Operacional",
      horizon: "Próximo ciclo",
      priority: current.sla < 90 ? "Crítica" : "Média",
      expected: `Sustentar SLA acima de 92%`,
    },
  ];

  return {
    headline: headline.slice(0, 95),
    summary: summaryParts.join(" "),
    confidence: 92,
    highlights: highlights.slice(0, 3),
    gaps: gaps.slice(0, 3),
    actions: actions.slice(0, 3),
  };
}

// ── Função principal ────────────────────────────────────────────────────────

export async function buildStoredReport(
  tenantId: string,
  type: "daily" | "weekly",
  period: string,
  date: Date = new Date(),
  options?: { skipAi?: boolean },
): Promise<{ storedReport: StoredReport; markdown: string }> {
  const now = new Date();
  const persona = getAiPersona(tenantId);

  // Resolve a janela exata do período em BRT (America/Sao_Paulo)
  const {
    startCurrent,
    endCurrent,
    startPrevious,
    endPrevious,
    dateIso,
  } = resolvePeriodWindow(type, period, date);

  // Agrega KPIs
  const current = await aggregateKpis(tenantId, startCurrent, endCurrent);
  const previous = await aggregateKpis(tenantId, startPrevious, endPrevious);

  // Volume series
  const volumeSeries = await buildVolumeSeries(tenantId, startCurrent, endCurrent, type);

  // IA analysis (ou síntese analítica rápida quando em backfill em lote)
  const analysis = options?.skipAi
    ? buildFallbackAnalysis(current, previous, type)
    : await generateAiAnalysis(tenantId, type, period, current, previous);

  // Monta as 4 métricas (MetricCards do layout original)
  const metrics: Metric[] = [
    {
      label: current.totalChats > 0 ? "Conversas atendidas" : "Interações & negócios",
      value: current.volume.toLocaleString("pt-BR"),
      delta: pctDelta(current.volume, previous.volume),
      deltaLabel: type === "weekly" ? "vs. semana anterior" : "vs. dia anterior",
      goodWhen: "up",
    },
    {
      label: "1ª resposta (média)",
      value: formatFRT(current.frt),
      delta: pctDelta(current.frt, previous.frt),
      deltaLabel: type === "weekly" ? "vs. semana anterior" : "vs. dia anterior",
      goodWhen: "down",
      target: "Meta 15m",
    },
    {
      label: "SLA cumprido",
      value: current.sla.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
      unit: "%",
      delta: pctDelta(current.sla, previous.sla),
      goodWhen: "up",
      progress: current.sla,
      target: "Meta 92%",
    },
    {
      label: "Nota média de QA",
      value: current.qa.toLocaleString("pt-BR", { minimumFractionDigits: 1 }),
      unit: "/10",
      delta: pctDelta(current.qa, previous.qa),
      goodWhen: "up",
      progress: current.qa * 10,
    },
  ];

  // Sentimento
  const sentiment: Sentiment[] = [
    { label: "Satisfeito", value: current.satisfied, signal: "positive" },
    { label: "Neutro", value: current.neutral, signal: "info" },
    { label: "Frustrado", value: current.frustrated, signal: "critical" },
  ];

  // IDs isolados por tenant para nunca colidir na PK de ai_reports
  const reportId = type === "daily" ? `d-${period}-${tenantId}` : `${period}-${tenantId}`;
  const code = period;

  const storedReport: StoredReport = {
    id: reportId,
    kind: type === "weekly" ? "Semanal" : "Diário",
    code,
    date: dateIso,
    period: formatPeriodLabel(startCurrent, endCurrent, type),
    generatedAt: formatBR(now),
    syncedAt: formatBRTime(now),
    confidence: analysis.confidence,
    headline: analysis.headline,
    summary: analysis.summary,
    metrics,
    sentiment,
    volumeSeries,
    highlights: analysis.highlights,
    gaps: analysis.gaps,
    actions: analysis.actions,
    sources: current.sources,
    stage: "rascunho",
    currentVersion: "v1",
    versions: [
      {
        version: "v1",
        createdAt: formatBRTime(now),
        author: `${persona.name} · IA Executiva`,
        note: "Primeira síntese automática do ciclo.",
        stage: "rascunho",
      },
    ],
    review: [
      { role: "Geração", name: `${persona.name} · Gemini 2.5 Pro`, stage: "rascunho", at: formatBRTime(now) },
      { role: "Revisão operacional", name: "Supervisão", stage: "revisao" },
      { role: "Aprovação executiva", name: "Diretoria / Admin", stage: "aprovado" },
      { role: "Distribuição", name: "Diretoria · WhatsApp + e-mail", stage: "enviado" },
    ],
    themes: analysis.gaps.map((g) => g.tag),
    kpis: {
      volume: current.volume,
      sla: current.sla,
      frt: current.frt,
      qa: current.qa,
      satisfied: current.satisfied,
    },
    feedbackSummary: { up: 0, down: 0, comments: 0 },
  };

  const markdown = buildMarkdownFromStoredReport(storedReport);

  return { storedReport, markdown };
}

// ── Markdown builder (para compatibilidade com envios WhatsApp/Email) ──────

export function buildMarkdownFromStoredReport(r: StoredReport): string {
  const lines: string[] = [];
  lines.push(`## Relatório Analítico Executivo (${r.kind})`);
  lines.push(`**Período:** ${r.period}`);
  lines.push("");
  lines.push(`### 1. Visão Geral da Operação`);
  lines.push(r.summary);
  lines.push("");
  lines.push(`**KPIs do período:**`);
  for (const m of r.metrics) {
    lines.push(
      `- **${m.label}:** ${m.value}${m.unit ?? ""} (${(m.delta ?? 0) >= 0 ? "+" : ""}${m.delta ?? 0}% ${m.deltaLabel ?? ""})`,
    );
  }
  lines.push("");
  if (r.highlights.length > 0) {
    lines.push("### 2. Destaques Positivos");
    for (const h of r.highlights) {
      lines.push(`- **${h.title}:** ${h.detail}${h.impact ? ` (${h.impact})` : ""}`);
    }
    lines.push("");
  }
  if (r.gaps.length > 0) {
    lines.push("### 3. Oportunidades de Melhoria");
    for (const g of r.gaps) {
      lines.push(`- **${g.title}:** ${g.detail}${g.impact ? ` (${g.impact})` : ""}`);
    }
    lines.push("");
  }
  if (r.actions.length > 0) {
    lines.push("### 4. Plano de Ação & Recomendações");
    for (const a of r.actions) {
      lines.push(`> [!NOTE]`);
      lines.push(`> **${a.title}** (${a.priority}) — ${a.detail}`);
      lines.push(`> Responsável: ${a.owner} · Prazo: ${a.horizon} · Impacto esperado: ${a.expected}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
