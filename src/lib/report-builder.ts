/**
 * report-builder.ts — Serviço de construção de relatórios IA v2
 *
 * Consolida dados brutos do banco (conversas, SLA, auditorias, sentimento)
 * e produz um StoredReport com a shape EXATA que o frontend insight-navigator espera.
 *
 * Fluxo:
 *  1. Agrega KPIs do período atual
 *  2. Agrega KPIs do período anterior (para calcular deltas)
 *  3. Calcula volumeSeries (distribuição horária/diária)
 *  4. Chama Vertex AI para gerar análise executiva (headline, highlights, gaps, actions)
 *  5. Monta o StoredReport completo
 */

import { and, eq, gte, lt, desc } from "drizzle-orm";
import { db } from "../db";
import { conversations, responseTimeLogs, aiConversationAudits, aiReportFeedback } from "../db/schema";

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
  stage: "rascunho";
  currentVersion: string;
  versions: ReportVersion[];
  review: ReviewStep[];
  themes: string[];
  kpis: ReportKpis;
  feedbackSummary: { up: number; down: number; comments: number };
};

// ── Constantes ──────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const pad = (n: number) => String(n).padStart(2, "0");

function formatPeriodLabel(date: Date, type: "daily" | "weekly"): string {
  if (type === "daily") {
    return `${pad(date.getDate())} de ${MONTH_NAMES[date.getMonth()]} de ${date.getFullYear()}`;
  }
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return `${pad(weekStart.getDate())} a ${pad(weekEnd.getDate())} de ${MONTH_NAMES[weekEnd.getMonth()]} de ${weekEnd.getFullYear()}`;
}

function formatBR(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatBRTime(date: Date): string {
  return `${formatBR(date)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatFRT(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${pad(s)}s` : `${s}s`;
}

function pctDelta(current: number, previous: number): number {
  if (previous === 0) return 0;
  return parseFloat(((current - previous) / previous * 100).toFixed(1));
}

// ── Agregação de KPIs ───────────────────────────────────────────────────────

type RawKpis = {
  volume: number;
  closed: number;
  sla: number;
  frt: number;
  qa: number;
  satisfied: number;
  neutral: number;
  frustrated: number;
  totalAudits: number;
  sources: string[];
};

async function aggregateKpis(tenantId: string, start: Date, end: Date): Promise<RawKpis> {
  // Volume de conversas
  const convs = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), gte(conversations.createdAt, start), lt(conversations.createdAt, end)));

  const totalChats = convs.length;
  const closedChats = convs.filter((c) => c.queueState === "finalizados").length;

  // SLA
  const slaLogs = await db
    .select()
    .from(responseTimeLogs)
    .where(and(eq(responseTimeLogs.tenantId, tenantId), gte(responseTimeLogs.clientMessageAt, start), lt(responseTimeLogs.clientMessageAt, end)));

  const totalSla = slaLogs.length;
  const overdueSla = slaLogs.filter((l) => l.isOverdue).length;
  const metSlaPct = totalSla > 0 ? ((totalSla - overdueSla) / totalSla) * 100 : 100;
  const validResponseTimes = slaLogs.map((l) => l.responseTimeSeconds).filter(Boolean) as number[];
  const avgFRT = validResponseTimes.length > 0
    ? validResponseTimes.reduce((sum, val) => sum + val, 0) / validResponseTimes.length
    : 0;

  // Auditorias e sentimento
  const audits = await db
    .select()
    .from(aiConversationAudits)
    .where(and(eq(aiConversationAudits.tenantId, tenantId), gte(aiConversationAudits.auditedAt, start), lt(aiConversationAudits.auditedAt, end)));

  const scores = audits.map((a) => a.performanceScore).filter(Boolean) as number[];
  const avgScore = scores.length > 0
    ? scores.reduce((sum, val) => sum + val, 0) / scores.length
    : 80;

  const satisfiedCount = audits.filter((a) => a.clientSentiment === "satisfeito").length;
  const neutralCount = audits.filter((a) => a.clientSentiment === "neutro").length;
  const frustratedCount = audits.filter((a) => a.clientSentiment === "frustrado").length;
  const totalSentiment = satisfiedCount + neutralCount + frustratedCount;

  return {
    volume: totalChats,
    closed: closedChats,
    sla: parseFloat(metSlaPct.toFixed(1)),
    frt: Math.round(avgFRT),
    qa: parseFloat((avgScore / 10).toFixed(1)), // Normaliza para /10
    satisfied: totalSentiment > 0 ? Math.round((satisfiedCount / totalSentiment) * 100) : 85,
    neutral: totalSentiment > 0 ? Math.round((neutralCount / totalSentiment) * 100) : 10,
    frustrated: totalSentiment > 0 ? Math.round((frustratedCount / totalSentiment) * 100) : 5,
    totalAudits: audits.length,
    sources: [
      `${totalChats} conversas`,
      `${audits.length} auditorias de QA`,
      "SLA do dia",
      "Sentimento por IA",
    ],
  };
}

// ── Volume Series ───────────────────────────────────────────────────────────

async function buildVolumeSeries(tenantId: string, start: Date, end: Date, type: "daily" | "weekly") {
  const convs = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), gte(conversations.createdAt, start), lt(conversations.createdAt, end)));

  if (type === "daily") {
    const hours = ["08h", "10h", "12h", "14h", "16h", "18h", "20h"];
    const hourBuckets = new Map<string, number>();
    hours.forEach((h) => hourBuckets.set(h, 0));
    for (const c of convs) {
      const h = c.createdAt.getHours();
      const bucket = h < 9 ? "08h" : h < 11 ? "10h" : h < 13 ? "12h" : h < 15 ? "14h" : h < 17 ? "16h" : h < 19 ? "18h" : "20h";
      hourBuckets.set(bucket, (hourBuckets.get(bucket) ?? 0) + 1);
    }
    return hours.map((label) => ({ label, value: hourBuckets.get(label) ?? 0 }));
  } else {
    const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const dayBuckets = new Map<string, number>();
    days.forEach((d) => dayBuckets.set(d, 0));
    for (const c of convs) {
      const dow = c.createdAt.getDay();
      const label = days[(dow + 6) % 7]; // 0=Dom → index 6
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

    // Agrupa por sectionId
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

    const lines: string[] = ["Contexto de aprendizado baseado no feedback dos operadores nos últimos relatórios:"];
    for (const [sectionId, stats] of bySection.entries()) {
      const label = sectionLabels[sectionId] ?? sectionId;
      const totalVotes = stats.up + stats.down;
      if (totalVotes === 0) continue;
      const approval = Math.round((stats.up / totalVotes) * 100);
      let line = `- "${label}": ${stats.up} 👍 / ${stats.down} 👎 (${approval}% aprovação)`;
      if (stats.comments.length > 0) {
        line += `. Comentários: "${stats.comments.slice(0, 2).join('"; "')}"}`;
      }
      lines.push(line);
    }

    lines.push(
      "\nAjuste as seções com baixa aprovação para atender às expectativas da equipe de operações." +
      " Seja mais específico e use números reais nas seções críticas."
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

    // Carrega contexto de feedback das versões anteriores para aprendizado contínuo
    const feedbackContext = await fetchFeedbackContext(tenantId);

    const prompt = `Você é a IA analítica de BI da operação de atendimento. Analise os dados do período e retorne um JSON com análise executiva em português brasileiro.

Dados do período ${type === "weekly" ? "semanal" : "diário"} (${period}):
- Volume de conversas: ${current.volume} (anterior: ${previous.volume})
- SLA cumprido: ${current.sla}% (anterior: ${previous.sla}%)
- Tempo médio 1ª resposta: ${current.frt}s (anterior: ${previous.frt}s)
- Nota QA: ${current.qa}/10 (anterior: ${previous.qa}/10)
- Clientes satisfeitos: ${current.satisfied}% (anterior: ${previous.satisfied}%)
- Auditorias realizadas: ${current.totalAudits}${feedbackContext ? `\n\n${feedbackContext}` : ""}

Retorne EXATAMENTE este formato JSON (sem markdown, sem backticks):
{
  "headline": "Título executivo curto e impactante (max 80 chars)",
  "summary": "Resumo analítico de 2-3 frases descrevendo a performance geral do período",
  "confidence": 92,
  "highlights": [
    {"title": "...", "detail": "...", "signal": "positive", "tag": "Comercial|Suporte|Qualidade|Processo", "impact": "..."}
  ],
  "gaps": [
    {"title": "...", "detail": "...", "signal": "warning|critical", "tag": "Comercial|Suporte|Qualidade|Processo|Escala", "impact": "..."}
  ],
  "actions": [
    {"title": "...", "detail": "...", "owner": "Supervisão de...", "horizon": "Esta semana|10 dias|Próximo ciclo|Amanhã", "priority": "Crítica|Alta|Média", "expected": "SLA projetado de X% para Y%"}
  ]
}

Gere 2-3 highlights, 2-3 gaps e 2-3 actions baseados nos dados reais. Seja específico nos números e impactos.`;

    const result = await vertexAi.generateText(prompt, "gemini-2.5-pro", undefined, {
      tenantId,
      feature: "sla_advisor",
      metadata: { period, type },
    });

    if (result) {
      // Limpa possíveis backticks/markdown
      const cleaned = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        headline: parsed.headline ?? "Relatório do período",
        summary: parsed.summary ?? "",
        confidence: parsed.confidence ?? 90,
        highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      };
    }
  } catch (e: any) {
    console.error("[ReportBuilder] Erro ao chamar Vertex AI:", e?.message);
  }

  // Fallback sem IA
  return buildFallbackAnalysis(current, previous, type);
}

function buildFallbackAnalysis(current: RawKpis, previous: RawKpis, type: "daily" | "weekly"): AiAnalysis {
  const slaUp = current.sla >= previous.sla;
  const label = type === "weekly" ? "semanal" : "do dia";
  return {
    headline: slaUp
      ? `Operação estável: SLA de ${current.sla}% ${label}`
      : `Atenção: SLA caiu para ${current.sla}% ${label}`,
    summary: `${current.volume} conversas atendidas no período, SLA de ${current.sla}% e primeira resposta média de ${formatFRT(current.frt)}. O sentimento predominante foi ${current.satisfied >= 70 ? "positivo" : "neutro"} em ${current.satisfied}% das conversas auditadas.`,
    confidence: 85,
    highlights: [
      {
        title: "Volume de atendimento",
        detail: `${current.volume} conversas processadas no período com ${current.closed} finalizações.`,
        signal: "positive" as Signal,
        tag: "Processo",
        impact: `${Math.round((current.closed / Math.max(current.volume, 1)) * 100)}% de resolução`,
      },
    ],
    gaps: current.sla < 92 ? [
      {
        title: "SLA abaixo da meta",
        detail: `O SLA ficou em ${current.sla}%, abaixo da meta de 92%.`,
        signal: "warning" as Signal,
        tag: "Suporte",
        impact: `${(100 - current.sla).toFixed(1)}% de quebras`,
      },
    ] : [],
    actions: [
      {
        title: "Monitorar primeira resposta",
        detail: `O tempo médio de primeira resposta está em ${formatFRT(current.frt)}. Acompanhar de perto.`,
        owner: "Supervisão Operacional",
        horizon: "Esta semana",
        priority: current.frt > 300 ? "Crítica" : "Média",
        expected: `Reduzir FRT para abaixo de 2 minutos`,
      },
    ],
  };
}

// ── Função principal ────────────────────────────────────────────────────────

export async function buildStoredReport(
  tenantId: string,
  type: "daily" | "weekly",
  period: string,
  date: Date,
): Promise<{ storedReport: StoredReport; markdown: string }> {
  const now = new Date();

  // Janela do período atual
  const startCurrent = type === "daily"
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0)
    : (() => { const d = new Date(date); d.setDate(d.getDate() - 7); return d; })();
  const endCurrent = type === "daily"
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
    : date;

  // Janela do período anterior (para deltas)
  const durationMs = endCurrent.getTime() - startCurrent.getTime();
  const startPrevious = new Date(startCurrent.getTime() - durationMs);
  const endPrevious = startCurrent;

  // Agrega KPIs
  const current = await aggregateKpis(tenantId, startCurrent, endCurrent);
  const previous = await aggregateKpis(tenantId, startPrevious, endPrevious);

  // Volume series
  const volumeSeries = await buildVolumeSeries(tenantId, startCurrent, endCurrent, type);

  // IA analysis
  const analysis = await generateAiAnalysis(tenantId, type, period, current, previous);

  // Monta as 4 métricas (MetricCards)
  const metrics: Metric[] = [
    {
      label: "Conversas atendidas",
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

  // IDs
  const reportId = type === "daily" ? `d-${period}` : period;
  const code = period;
  const dateIso = type === "daily" ? period : (() => {
    const d = new Date(date); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  const storedReport: StoredReport = {
    id: reportId,
    kind: type === "weekly" ? "Semanal" : "Diário",
    code,
    date: dateIso,
    period: formatPeriodLabel(date, type),
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
    versions: [{
      version: "v1",
      createdAt: formatBRTime(now),
      author: "IA · sla_advisor",
      note: "Primeira síntese automática do ciclo.",
      stage: "rascunho",
    }],
    review: [
      { role: "Geração", name: "IA · Gemini 2.5 Pro", stage: "rascunho", at: formatBRTime(now) },
      { role: "Revisão operacional", name: "Supervisor", stage: "revisao" },
      { role: "Aprovação executiva", name: "Administrador", stage: "aprovado" },
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

  // Markdown para WhatsApp/Email (backward compat)
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
    lines.push(`- **${m.label}:** ${m.value}${m.unit ?? ""} (${(m.delta ?? 0) >= 0 ? "+" : ""}${m.delta ?? 0}% ${m.deltaLabel ?? ""})`);
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
