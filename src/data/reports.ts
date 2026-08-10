/**
 * reports.ts — Store reativo para a aba Relatórios IA (v2)
 *
 * Exporta a MESMA interface que o insight-navigator original:
 * - Tipos (Signal, Metric, Finding, Action, etc.)
 * - Constantes (stageMeta, stageOrder, trendMeta)
 * - Variáveis de estado (reports, dailyReports, weeklyReports, pendingApprovals, coverage)
 * - Funções seletoras (groupReports, trendSeries, periodAverage, themeRanking, feedbackTotals, previousOf)
 *
 * Os dados são carregados via loadReports() chamado pelo wrapper ReportsIATab.
 * Os componentes importam tudo normalmente sem precisar saber que vem de uma API.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type Signal = "positive" | "warning" | "critical" | "info";

export type Metric = {
  label: string;
  value: string;
  unit?: string;
  delta?: number;
  deltaLabel?: string;
  goodWhen?: "up" | "down";
  target?: string;
  progress?: number;
};

export type Finding = {
  title: string;
  detail: string;
  signal: Signal;
  tag: string;
  impact?: string;
};

export type Action = {
  title: string;
  detail: string;
  owner: string;
  horizon: string;
  priority: "Crítica" | "Alta" | "Média";
  expected: string;
};

export type Sentiment = { label: string; value: number; signal: Signal };

export type ApprovalStage = "rascunho" | "revisao" | "aprovado" | "enviado";

export type ReportVersion = {
  version: string;
  createdAt: string;
  author: string;
  note: string;
  stage: ApprovalStage;
};

export type ReviewStep = {
  role: string;
  name: string;
  stage: ApprovalStage;
  at?: string;
  note?: string;
};

export type Report = {
  id: string;
  kind: "Semanal" | "Diário";
  code: string;
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
  stage: ApprovalStage;
  currentVersion: string;
  versions: ReportVersion[];
  review: ReviewStep[];
};

export type ReportKpis = {
  volume: number;
  sla: number;
  frt: number;
  qa: number;
  satisfied: number;
};

export type StoredReport = Report & {
  date: string;
  kpis: ReportKpis;
  themes: string[];
  feedbackSummary: { up: number; down: number; comments: number };
};

export type TrendKey = "sla" | "volume" | "frt" | "qa" | "satisfied";

// ─── Constantes (idênticas ao insight-navigator) ────────────────────────────

export const stageOrder: ApprovalStage[] = ["rascunho", "revisao", "aprovado", "enviado"];

export const stageMeta: Record<
  ApprovalStage,
  { label: string; description: string; signal: Signal }
> = {
  rascunho: {
    label: "Rascunho da IA",
    description: "Gerado automaticamente, ainda não revisado por um humano.",
    signal: "info",
  },
  revisao: {
    label: "Em revisão",
    description: "Sob análise da supervisão antes da aprovação executiva.",
    signal: "warning",
  },
  aprovado: {
    label: "Aprovado",
    description: "Conteúdo validado e liberado para envio à diretoria.",
    signal: "positive",
  },
  enviado: {
    label: "Enviado à diretoria",
    description: "Distribuído por e-mail corporativo e WhatsApp da diretoria.",
    signal: "positive",
  },
};

// ─── Formatadores ────────────────────────────────────────────────────────────

function fmt(n: number, digits = 1) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function secs(n: number) {
  const p = (v: number) => String(v).padStart(2, "0");
  const m = Math.floor(n / 60);
  return m > 0 ? `${m}m ${p(Math.round(n % 60))}s` : `${Math.round(n)}s`;
}

export const trendMeta: Record<
  TrendKey,
  { label: string; format: (v: number) => string; goodWhen: "up" | "down"; target?: number }
> = {
  sla: { label: "SLA cumprido", format: (v) => `${fmt(v)}%`, goodWhen: "up", target: 92 },
  volume: { label: "Conversas/dia", format: (v) => Math.round(v).toLocaleString("pt-BR"), goodWhen: "up" },
  frt: { label: "1ª resposta", format: (v) => secs(v), goodWhen: "down" },
  qa: { label: "Nota de QA", format: (v) => `${fmt(v)}/10`, goodWhen: "up", target: 8.5 },
  satisfied: { label: "Clientes satisfeitos", format: (v) => `${fmt(v, 0)}%`, goodWhen: "up", target: 85 },
};

// ─── Estado mutável (populado via loadReports) ──────────────────────────────

export let reports: StoredReport[] = [];
export let dailyReports: StoredReport[] = [];
export let weeklyReports: StoredReport[] = [];
export let pendingApprovals: StoredReport[] = [];

export let coverage = {
  days: 0,
  total: 0,
  daily: 0,
  weekly: 0,
  firstDate: "—",
  lastDate: "—",
  sent: 0,
};

/**
 * Carrega os relatórios do array recebido da API e popula todos os exports derivados.
 * Chamado pelo wrapper ReportsIATab após o fetch.
 */
export function loadReports(data: StoredReport[]) {
  reports = data;
  dailyReports = data.filter((r) => r.kind === "Diário");
  weeklyReports = data.filter((r) => r.kind === "Semanal");
  pendingApprovals = data.filter((r) => r.stage !== "enviado");

  const pad = (n: number) => String(n).padStart(2, "0");
  const sortedDates = dailyReports.map((r) => r.date).sort();
  const first = sortedDates[0] ?? "";
  const last = sortedDates[sortedDates.length - 1] ?? "";
  const fmtBr = (iso: string) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    return `${pad(d)}/${pad(m)}/${y}`;
  };

  coverage = {
    days: dailyReports.length,
    total: data.length,
    daily: dailyReports.length,
    weekly: weeklyReports.length,
    firstDate: fmtBr(first),
    lastDate: fmtBr(last),
    sent: data.filter((r) => r.stage === "enviado").length,
  };
}

// ─── Funções seletoras (mesma assinatura do insight-navigator) ──────────────

const monthNames = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function groupLabel(dateIso: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const diff = Math.round((today.getTime() - date.getTime()) / 86400000);
  const todayDow = (today.getDay() + 6) % 7;
  if (diff <= todayDow) return "Esta semana";
  if (diff <= todayDow + 7) return "Semana passada";
  if (date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear())
    return "Este mês";
  const name = monthNames[date.getMonth()];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${date.getFullYear()}`;
}

export function groupReports(list: StoredReport[]) {
  const groups: { label: string; items: StoredReport[] }[] = [];
  for (const report of list) {
    const label = groupLabel(report.date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(report);
    else groups.push({ label, items: [report] });
  }
  return groups;
}

/**
 * Retorna série temporal de um KPI. Usa dailyReports do estado global.
 * Assinatura IDÊNTICA ao insight-navigator: trendSeries(key, days)
 */
export function trendSeries(key: TrendKey, days = 100) {
  return dailyReports
    .slice(0, days)
    .reverse()
    .map((r) => ({ date: r.date, value: r.kpis[key] }));
}

/**
 * Média de um KPI num slice dos dailyReports. Assinatura IDÊNTICA ao original.
 */
export function periodAverage(key: TrendKey, from: number, to: number) {
  const slice = dailyReports.slice(from, to);
  if (!slice.length) return 0;
  return slice.reduce((sum, r) => sum + r.kpis[key], 0) / slice.length;
}

/**
 * Top 5 temas recorrentes dos gaps. Assinatura IDÊNTICA ao original.
 */
export function themeRanking(days = 30) {
  const window = dailyReports.slice(0, days);
  const counts = new Map<string, { count: number; signal: Signal; title: string }>();
  for (const r of window) {
    for (const gap of r.gaps) {
      const entry = counts.get(gap.title) ?? { count: 0, signal: gap.signal, title: gap.title };
      entry.count += 1;
      counts.set(gap.title, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
}

/**
 * Totais de feedback agregados. Assinatura IDÊNTICA ao original.
 */
export function feedbackTotals() {
  return reports.reduce(
    (acc, r) => ({
      up: acc.up + r.feedbackSummary.up,
      down: acc.down + r.feedbackSummary.down,
      comments: acc.comments + r.feedbackSummary.comments,
    }),
    { up: 0, down: 0, comments: 0 },
  );
}

/**
 * Relatório anterior do mesmo tipo. Assinatura IDÊNTICA ao original.
 */
export function previousOf(report: StoredReport): StoredReport | null {
  const sameKind = reports.filter((r) => r.kind === report.kind);
  const i = sameKind.findIndex((r) => r.id === report.id);
  return i >= 0 && i < sameKind.length - 1 ? sameKind[i + 1] : null;
}
