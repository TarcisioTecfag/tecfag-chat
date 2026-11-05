import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Eye, ClipboardCheck, ChevronRight } from "lucide-react";

// ── Tipos ───────────────────────────────────────────────────────────────────

export type OperatorMetric = {
  operatorId: string;
  operatorName: string;
  operatorAvatar: string | null;
  status: string;
  isOnline?: boolean;
  presenceLabel?: "ONLINE" | "EM ATENDIMENTO" | "EM PAUSA" | "OFFLINE";
  lastSeenAt?: string | null;
  usageSecondsToday?: number;
  roleSubtitle?: string;
  scoreSourceLabel?: "Auditoria IA" | "Índice Operacional" | "Sem dados";

  totalConversations: number;
  yesterdayConversations?: number;
  vsYesterdayDelta?: number;
  vsYesterdayLabel?: string;
  vsYesterdayPositive?: boolean;
  monthlyConversations?: number;
  avgDailyConversations7d?: number;
  conversationsNote?: string;

  avgResponseTimeSeconds?: number | null;
  avgResponseTimeFormatted: string;
  avgResponseTime7dFormatted?: string;
  avgResponseTimeLastWeekFormatted?: string;
  avgResponseTimeLastMonthFormatted?: string;
  tmaNote?: string;
  slaTargetMinutes?: number;
  slaPct?: number | null;
  slaNote?: string;

  overdueCount: number;
  overdueCountLastWeek?: number;
  overdueCountLastMonth?: number;

  avgPerformanceScore: number | null;
  avgPerformanceScoreLastWeek: number | null;
  avgPerformanceScoreLastMonth: number | null;
  sentimentScore10?: number | null;
  sentimentLabel?: string;
  sentimentNote?: string;
  satisfiedCount: number;
  neutralCount: number;
  frustratedCount: number;
  satisfiedPctLastWeek?: number;
  satisfiedPctLastMonth?: number;

  conversionRatePct?: number;
  conversionDisplay?: string;
  conversionNote?: string;
  totalDealsCount?: number;
  openDealsCount?: number;
  wonDealsCount?: number;
  lostDealsCount?: number;
  openPipelineValue?: number;
  wonPipelineValue?: number;

  monthlyVolumePct?: number;
  retentionOrResolutionPct?: number;
  retentionLabel?: string;
  crmWalletPct?: number;

  monthlyRank?: number;
  totalRankedOperators?: number;
  monthlyRankNote?: string;

  horasLabels?: string[];
  horasSla?: number[];
  horasSentimento?: number[];
  horasConversao?: number[];
  horasScore?: number[];

  diasLabels?: string[];
  diasAtendimentos?: number[];
  diasTmaMin?: number[];
  diasAtrasados?: number[];
  diasRanking?: number[];

  trafficLight: "green" | "yellow" | "red" | "gray";
};

export type OverviewData = {
  today: string;
  activeConversations: number;
  overdueAlerts: number;
  avgResponseTimeFormatted: string;
  teamPerformanceScore: number | null;
  operators: OperatorMetric[];
};

export type AuditItem = {
  id: string;
  conversationId: string;
  operatorId?: string | null;
  contactName: string | null;
  operatorName: string;
  performanceScore: number | null;
  clientSentiment: string | null;
  hadLongResponseGap: boolean;
  hadMissedObjection: boolean;
  hadRudeLanguage: boolean;
  hadNoFollowUp: boolean;
  summary: string | null;
  strengths: string | null;
  weaknesses: string | null;
  actionableInsight: string | null;
  flagCount: number;
  auditedAt: string | null;
  status?: string;
  errorMessage?: string | null;
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function presenceDot(op: OperatorMetric) {
  if (op.isOnline) {
    if (op.presenceLabel === "EM PAUSA" || op.status === "ausente") return "bg-amber-500";
    if (op.presenceLabel === "EM ATENDIMENTO" || op.status === "ocupado") return "bg-primary";
    return "bg-emerald-500";
  }
  return "bg-muted-foreground/40";
}

function presenceStatusLabel(op: OperatorMetric) {
  if (op.presenceLabel) return op.presenceLabel;
  if (op.isOnline) {
    if (op.status === "ausente") return "EM PAUSA";
    if (op.status === "ocupado") return "EM ATENDIMENTO";
    return "ONLINE";
  }
  return "OFFLINE";
}

// ── GaugeHalf Component (180° Meia Pizza) ──────────────────────────────────

const R = 80;
const ARC = Math.PI * R;

function GaugeHalf({
  value,
  display,
  label,
  sublabel,
}: {
  value: number;
  display: string;
  label: string;
  sublabel?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const offset = ARC * (1 - pct / 100);

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full max-w-[240px]">
        <svg viewBox="0 0 200 108" className="w-full" role="img" aria-label={`${label}: ${display}`}>
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="var(--border)"
            strokeWidth="22"
            strokeLinecap="round"
          />
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="22"
            strokeLinecap="round"
            strokeDasharray={ARC}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          />
        </svg>
        <span className="absolute inset-x-0 bottom-0 text-center font-black text-4xl text-foreground tracking-tight">
          {display}
        </span>
      </div>
      <span className="mt-4 text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground text-center">
        {label}
      </span>
      {sublabel && (
        <span className="mt-1 text-[11px] font-medium text-muted-foreground text-center truncate max-w-full">
          {sublabel}
        </span>
      )}
    </div>
  );
}

// ── TrendChart Component ────────────────────────────────────────────────────

function TrendChart({
  points,
  labels,
  title,
  format = (v) => String(v),
  invert = false,
  className = "",
  height = 56,
}: {
  points: number[];
  labels: string[];
  title: string;
  format?: (value: number) => string;
  invert?: boolean;
  className?: string;
  height?: number;
}) {
  const W = 300;
  const H = height;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const stepX = points.length > 1 ? W / (points.length - 1) : W;

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = H - 6 - ((p - min) / span) * (H - 14);
    return [x, y] as const;
  });

  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;

  const first = points[0];
  const last = points[points.length - 1];
  const delta = last - first;
  const improving = invert ? delta < 0 : delta > 0;
  const stable = delta === 0;
  const stroke = stable ? "var(--muted-foreground)" : improving ? "var(--primary)" : "var(--muted-foreground)";

  const gradientId = `trend-${title.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <figure className={`m-0 w-full ${className}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: H }}
        role="img"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="3" fill={stroke} />
      </svg>
      <figcaption className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{labels[0]} – {labels[labels.length - 1]}</span>
        <span className={stable ? "text-muted-foreground" : improving ? "text-primary font-bold" : "text-muted-foreground font-bold"}>
          {stable ? "estável" : `${delta > 0 ? "+" : "−"}${format(Math.abs(delta))}`}
        </span>
      </figcaption>
    </figure>
  );
}

function MetricCard({
  label,
  gauge,
  trend,
  className = "",
}: {
  label: string;
  gauge: React.ReactNode;
  trend: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      aria-label={label}
      className={`flex flex-col gap-4 rounded-2xl bg-muted/30 p-5 ring-1 ring-border sm:p-6 ${className}`}
    >
      {gauge}
      <div className="border-t border-border pt-4">
        {trend}
      </div>
    </motion.article>
  );
}

function KpiCard({
  label,
  value,
  note,
  positive,
  danger,
  trend,
}: {
  label: string;
  value: string;
  note: string;
  positive?: boolean;
  danger?: boolean;
  trend?: React.ReactNode;
}) {
  return (
    <article aria-label={label} className="flex flex-col bg-card p-5">
      <span className="mb-2 block text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className={`text-2xl font-black ${danger ? "text-primary" : "text-foreground"}`}>
        {value}
      </div>
      <div className={`mt-1 text-xs font-semibold ${positive ? "text-primary" : "text-muted-foreground"}`}>
        {note}
      </div>
      <div className="mt-4">{trend}</div>
    </article>
  );
}

function ProgressBar({ label, value, pct }: { label: string; value: string; pct: number }) {
  const clampedPct = Math.max(0, Math.min(100, pct));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-muted-foreground font-medium">{label}</span>
        <span className="shrink-0 text-sm font-black text-foreground">
          {value}
          {clampedPct > 0 && (
            <>
              {" "}
              <span className="font-bold text-primary" aria-hidden="true">
                ↑
              </span>
            </>
          )}
        </span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={clampedPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${clampedPct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full bg-primary rounded-full" 
        />
      </div>
    </div>
  );
}

// ── HighResAvatar Component ──────────────────────────────────────────────────

function HighResAvatar({ src, name, className = "" }: { src: string | null; name: string; className?: string }) {
  const [imgErr, setImgErr] = useState(false);
  const initials = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  if (src && !imgErr) {
    return (
      <div className={`relative overflow-hidden aspect-square rounded-2xl bg-muted shrink-0 border border-border ${className}`}>
        <img
          src={src}
          alt={`Foto de ${name}`}
          decoding="async"
          loading="eager"
          className="w-full h-full object-cover object-center shadow-sm"
          style={{ imageRendering: "-webkit-optimize-contrast" }}
          onError={() => setImgErr(true)}
        />
      </div>
    );
  }

  return (
    <div className={`aspect-square shrink-0 rounded-2xl bg-primary/15 text-primary font-black flex items-center justify-center border border-border ${className}`}>
      {initials}
    </div>
  );
}

// ── Componente Principal: OperatorsRankingTab ─────────────────────────────────

export function OperatorsRankingTab({
  overview,
  audits,
  onSelectAudit,
  onOpenHistory,
}: {
  overview: OverviewData | null;
  audits: AuditItem[];
  onSelectAudit: (auditId: string) => void;
  onOpenHistory: (operatorId: string, operatorName: string) => void;
}) {
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [showOccurrences, setShowOccurrences] = useState(false);

  if (!overview || !overview.operators || overview.operators.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-muted-foreground">
        Carregando lista de vendedores monitorados...
      </div>
    );
  }

  // Ordena os operadores dando prioridade a quem tem atendimentos hoje, depois volume 30d e score,
  // mantendo quem está sem atendimento no final da lista
  const operadores = [...overview.operators].sort((a, b) => {
    const aHasConvs = a.totalConversations > 0 ? 1 : 0;
    const bHasConvs = b.totalConversations > 0 ? 1 : 0;
    if (bHasConvs !== aHasConvs) return bHasConvs - aHasConvs;
    const convDiff = (b.totalConversations ?? 0) - (a.totalConversations ?? 0);
    if (convDiff !== 0) return convDiff;
    const monthDiff = (b.monthlyConversations ?? 0) - (a.monthlyConversations ?? 0);
    if (monthDiff !== 0) return monthDiff;
    const scoreDiff = (b.avgPerformanceScore ?? 0) - (a.avgPerformanceScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.operatorName.localeCompare(b.operatorName, "pt-BR");
  });

  const atual = operadores.find((o) => o.operatorId === selecionadoId) ?? operadores[0];

  const scoredOps = operadores.filter((o) => (o.avgPerformanceScore ?? 0) > 0);
  const mediaScore =
    overview.teamPerformanceScore ??
    (scoredOps.length > 0
      ? Math.round(scoredOps.reduce((s, o) => s + (o.avgPerformanceScore ?? 0), 0) / scoredOps.length)
      : null);

  // Status Real Online vs Total (baseado em presença real computeOperatorPresenceSnapshot)
  const onlineCount = operadores.filter((o) => o.isOnline === true).length;

  const scoreVal = atual.avgPerformanceScore ?? 0;

  // Séries e Rótulos Reais (com fallback seguro apenas para evitar array vazio em TrendChart)
  const horasLabels =
    atual.horasLabels && atual.horasLabels.length >= 2
      ? atual.horasLabels
      : ["09h", "10h", "11h", "12h", "13h", "14h", "15h", "16h"];
  const diasLabels =
    atual.diasLabels && atual.diasLabels.length >= 2
      ? atual.diasLabels
      : ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  const slaPctVal = atual.slaPct ?? null;
  const slaDisplay = slaPctVal !== null ? `${slaPctVal}%` : "–";
  const slaGaugeVal = slaPctVal ?? 0;

  const sentimentVal = atual.sentimentScore10 ?? null;
  const sentimentDisplay = sentimentVal !== null ? sentimentVal.toFixed(1) : "–";
  const sentimentGaugeVal = sentimentVal !== null ? Math.round(sentimentVal * 10) : 0;
  const sentimentTitle = atual.sentimentLabel ?? "Sentimento do Cliente";

  const conversionPctVal = atual.conversionRatePct ?? 0;
  const conversionDisplay = atual.conversionDisplay ?? `${conversionPctVal}%`;

  const horasSla =
    atual.horasSla && atual.horasSla.length >= 2
      ? atual.horasSla
      : Array(horasLabels.length).fill(slaGaugeVal);
  const horasSentimento =
    atual.horasSentimento && atual.horasSentimento.length >= 2
      ? atual.horasSentimento
      : Array(horasLabels.length).fill(sentimentVal ?? 0);
  const horasConversao =
    atual.horasConversao && atual.horasConversao.length >= 2
      ? atual.horasConversao
      : Array(horasLabels.length).fill(conversionPctVal);
  const horasScore =
    atual.horasScore && atual.horasScore.length >= 2
      ? atual.horasScore
      : Array(horasLabels.length).fill(scoreVal);

  const diasAtendimentos =
    atual.diasAtendimentos && atual.diasAtendimentos.length >= 2
      ? atual.diasAtendimentos
      : [0, 0, 0, 0, 0, 0, atual.totalConversations];
  const diasTmaMin =
    atual.diasTmaMin && atual.diasTmaMin.length >= 2
      ? atual.diasTmaMin
      : [0, 0, 0, 0, 0, 0, 0];
  const diasAtrasados =
    atual.diasAtrasados && atual.diasAtrasados.length >= 2
      ? atual.diasAtrasados
      : [0, 0, 0, 0, 0, 0, atual.overdueCount];

  const currentRank =
    atual.monthlyRank ?? (operadores.findIndex((o) => o.operatorId === atual.operatorId) + 1);
  const diasRanking =
    atual.diasRanking && atual.diasRanking.length >= 2
      ? atual.diasRanking
      : Array(diasLabels.length).fill(currentRank);

  const tmaEffectiveFormatted =
    atual.avgResponseTimeFormatted !== "–"
      ? atual.avgResponseTimeFormatted
      : (atual.avgResponseTime7dFormatted ?? "–");

  const operatorAudits = audits.filter(
    (a) => a.operatorId === atual.operatorId || a.operatorName === atual.operatorName,
  );

  return (
    <div className="flex-1 w-full min-h-0 overflow-y-auto scrollbar-thin bg-background text-foreground selection:bg-primary/30 rounded-2xl border border-border">
      <main className="flex min-h-full w-full min-w-0 flex-col lg:flex-row">
        
        {/* ── SIDEBAR DE VENDEDORES COM RANKING (#1, #2, #3) ────────────────── */}
        <section
          aria-label="Vendedores monitorados"
          className="flex w-full shrink-0 flex-col border-b border-border bg-muted/30 lg:w-[380px] xl:w-[420px] lg:border-b-0 lg:border-r"
        >
          <h2 className="sr-only">Lista de vendedores</h2>
          <ul className="flex flex-col divide-y divide-border overflow-y-auto" role="list">
            {operadores.map((op, idx) => {
              const ativo = op.operatorId === atual.operatorId;
              const opScore = op.avgPerformanceScore ?? 0;
              const rankPos = idx + 1;
              const trendText =
                op.vsYesterdayLabel ??
                (op.totalConversations > 0
                  ? `${op.totalConversations} atendimento(s) hoje`
                  : "Sem atendimentos hoje");
              const trendPositive = op.vsYesterdayPositive ?? op.totalConversations > 0;

              return (
                <li key={op.operatorId}>
                  <motion.button
                    type="button"
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => {
                      setSelecionadoId(op.operatorId);
                      setShowOccurrences(false);
                    }}
                    aria-pressed={ativo}
                    className={`flex w-full items-center gap-3.5 p-4 text-left transition-all sm:gap-4 sm:p-5 ${focusRing} focus-visible:ring-inset focus-visible:ring-offset-0 cursor-pointer ${
                      ativo ? "bg-card ring-1 ring-inset ring-primary" : "hover:bg-muted/50"
                    }`}
                  >
                    {/* Badge da Posição no Ranking (#1, #2, #3) */}
                    <span
                      className={`font-black text-xs sm:text-sm shrink-0 w-6 text-center ${
                        rankPos === 1 ? "text-primary font-black" :
                        rankPos === 2 ? "text-foreground font-bold" :
                        rankPos === 3 ? "text-muted-foreground font-bold" :
                        "text-muted-foreground font-medium"
                      }`}
                    >
                      #{rankPos}
                    </span>

                    {/* Avatar do Operador */}
                    <HighResAvatar 
                      src={op.operatorAvatar} 
                      name={op.operatorName} 
                      className="size-14 sm:size-16" 
                    />

                    {/* Nome, Status Real & Tendência Real */}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span
                          className={`truncate text-base font-bold sm:text-lg ${
                            ativo ? "text-foreground" : "text-foreground/80"
                          }`}
                        >
                          {op.operatorName}
                        </span>
                        <span
                          className={`shrink-0 font-black text-2xl leading-none ${
                            ativo ? "text-primary" : "text-muted-foreground"
                          }`}
                        >
                          <span className="sr-only">Score </span>
                          {opScore > 0 ? opScore : "–"}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className={`size-2 shrink-0 rounded-full ${presenceDot(op)}`} aria-hidden="true" />
                        <span className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {presenceStatusLabel(op)} • {op.totalConversations} ATEND.
                          {op.totalConversations === 0 && (op.monthlyConversations ?? 0) > 0
                            ? ` (${op.monthlyConversations} no mês)`
                            : ""}
                        </span>
                      </span>
                      <span
                        className={`block text-xs font-semibold mt-0.5 truncate ${
                          trendPositive ? "text-primary" : "text-muted-foreground"
                        }`}
                      >
                        {trendText}
                      </span>
                    </span>
                  </motion.button>
                </li>
              );
            })}
          </ul>

          {/* Resumo do Time no Rodapé da Sidebar (Online Real vs Total) */}
          <div className="mt-auto border-t border-border p-5">
            <h3 className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
              Resumo do time
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-card p-3 ring-1 ring-border">
                <dt className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">Score médio</dt>
                <dd className="font-black text-2xl leading-none text-primary mt-1">
                  {mediaScore !== null ? mediaScore : "–"}
                </dd>
              </div>
              <div className="rounded-xl bg-card p-3 ring-1 ring-border">
                <dt className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">Online / Total</dt>
                <dd className="font-black text-2xl leading-none text-foreground mt-1">
                  {onlineCount}/{operadores.length}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* ── PAINEL DE DETALHE DO VENDEDOR COM ANIMAÇÃO & SCROLL LIBERADO ─────── */}
        <div
          id="detalhe-vendedor"
          tabIndex={-1}
          className="min-w-0 flex-1 bg-card p-4 sm:p-6 lg:p-8"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={atual.operatorId}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="mx-auto max-w-5xl space-y-8"
            >
              {/* Seção Cabeçalho Vendedor */}
              <section
                aria-labelledby="titulo-vendedor"
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-4 lg:flex lg:items-center lg:gap-8"
              >
                <HighResAvatar 
                  src={atual.operatorAvatar} 
                  name={atual.operatorName} 
                  className="col-span-2 size-24 sm:size-32 lg:size-36" 
                />
                <div className="min-w-0 flex-1">
                  <h2
                    id="titulo-vendedor"
                    className="font-black text-2xl leading-tight tracking-tight text-foreground sm:text-3xl lg:text-4xl uppercase"
                  >
                    {atual.operatorName}
                  </h2>
                  <p className="max-w-[64ch] text-pretty text-sm text-muted-foreground lg:text-base font-medium mt-1">
                    {atual.roleSubtitle ?? "Consultor(a) Comercial • Comercial"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setShowOccurrences(!showOccurrences)}
                      className={`flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground transition-colors hover:opacity-90 cursor-pointer ${focusRing}`}
                    >
                      <Eye className="size-4 shrink-0" aria-hidden="true" />
                      {showOccurrences ? "Ocultar Ocorrências" : `Ver Ocorrências (${operatorAudits.length})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenHistory(atual.operatorId, atual.operatorName)}
                      className={`flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold uppercase text-foreground ring-1 ring-border transition-colors hover:bg-muted cursor-pointer ${focusRing}`}
                    >
                      <Clock className="size-4 shrink-0" aria-hidden="true" />
                      Ver Histórico
                    </button>
                  </div>
                </div>

                {/* Score Geral Numérico Imponente (100% consistente com a Sidebar) */}
                <div className="shrink-0 text-right">
                  <span className="text-xs font-extrabold uppercase tracking-[0.2em] text-muted-foreground block">
                    Score Geral
                  </span>
                  <div className="mt-1 font-black text-5xl leading-none text-primary sm:text-6xl lg:text-7xl">
                    {scoreVal > 0 ? scoreVal : "–"}
                  </div>
                  <span className="mt-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {atual.scoreSourceLabel ?? (scoreVal > 0 ? "Auditoria IA" : "Sem atividade")}
                  </span>
                </div>
              </section>

              {/* Seção 3 Gauges de Meia Pizza */}
              <section aria-labelledby="titulo-qualidade" className="space-y-4">
                <h3
                  id="titulo-qualidade"
                  className="text-xs font-extrabold uppercase tracking-[0.2em] text-muted-foreground"
                >
                  Métricas macro • hoje e últimas horas
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <MetricCard
                    label="SLA de Atendimento"
                    gauge={
                      <GaugeHalf
                        value={slaGaugeVal}
                        display={slaDisplay}
                        label="SLA de Atendimento"
                        sublabel={atual.slaNote}
                      />
                    }
                    trend={
                      <TrendChart
                        title="Histórico de SLA nas últimas 8 horas"
                        points={horasSla}
                        labels={horasLabels}
                        format={(v) => `${v}%`}
                      />
                    }
                  />
                  <MetricCard
                    label={sentimentTitle}
                    gauge={
                      <GaugeHalf
                        value={sentimentGaugeVal}
                        display={sentimentDisplay}
                        label={sentimentTitle}
                        sublabel={atual.sentimentNote}
                      />
                    }
                    trend={
                      <TrendChart
                        title="Histórico de qualidade nas últimas 8 horas"
                        points={horasSentimento}
                        labels={horasLabels}
                        format={(v) => v.toFixed(1)}
                      />
                    }
                  />
                  <MetricCard
                    label="Taxa de Conversão"
                    className="sm:col-span-2 xl:col-span-1"
                    gauge={
                      <GaugeHalf
                        value={conversionPctVal}
                        display={conversionDisplay}
                        label="Taxa de Conversão"
                        sublabel={atual.conversionNote}
                      />
                    }
                    trend={
                      <TrendChart
                        title="Histórico de conversão nas últimas 8 horas"
                        points={horasConversao}
                        labels={horasLabels}
                        format={(v) => `${v}%`}
                      />
                    }
                  />
                </div>
              </section>

              {/* Seção Indicadores Operacionais (4 KPIs com Gráficos 7d Reais) */}
              <section aria-labelledby="titulo-kpis" className="space-y-4">
                <h3 id="titulo-kpis" className="text-xs font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                  Indicadores operacionais • últimos 7 dias
                </h3>
                <div className="grid gap-px overflow-hidden rounded-2xl bg-border ring-1 ring-border sm:grid-cols-2 xl:grid-cols-4">
                  <KpiCard
                    label="Atendimentos Hoje"
                    value={String(atual.totalConversations)}
                    note={atual.conversationsNote ?? "Sem atendimentos nos últimos 7d"}
                    positive={(atual.totalConversations ?? 0) > (atual.avgDailyConversations7d ?? 0)}
                    trend={
                      <TrendChart
                        title="Atendimentos por dia nos últimos 7 dias"
                        points={diasAtendimentos}
                        labels={diasLabels}
                        height={48}
                        format={(v) => `${v}`}
                      />
                    }
                  />
                  <KpiCard
                    label="Tempo Médio (TMA)"
                    value={tmaEffectiveFormatted}
                    note={atual.tmaNote ?? `Meta SLA: ${atual.slaTargetMinutes ?? 15}min`}
                    positive={
                      atual.avgResponseTimeSeconds != null &&
                      atual.avgResponseTimeSeconds <= (atual.slaTargetMinutes ?? 15) * 60
                    }
                    trend={
                      <TrendChart
                        title="Tempo médio de atendimento nos últimos 7 dias"
                        points={diasTmaMin}
                        labels={diasLabels}
                        height={48}
                        invert
                        format={(v) => `${v.toFixed(1)}m`}
                      />
                    }
                  />
                  <KpiCard
                    label="Casos Atrasados"
                    value={String(atual.overdueCount).padStart(2, "0")}
                    note={
                      atual.overdueCount > 0
                        ? `${atual.overdueCount} aguardando > ${atual.slaTargetMinutes ?? 15}min`
                        : "Nenhum alerta de SLA"
                    }
                    danger={atual.overdueCount > 0}
                    trend={
                      <TrendChart
                        title="Casos atrasados nos últimos 7 dias"
                        points={diasAtrasados}
                        labels={diasLabels}
                        height={48}
                        invert
                        format={(v) => `${v}`}
                      />
                    }
                  />
                  <KpiCard
                    label="Ranking Mensal"
                    value={`${currentRank}º Lugar`}
                    note={atual.monthlyRankNote ?? `De ${operadores.length} consultores`}
                    positive={
                      currentRank <= 3 &&
                      ((atual.monthlyConversations ?? 0) > 0 || atual.totalConversations > 0)
                    }
                    trend={
                      <TrendChart
                        title="Posição no ranking nos últimos 7 dias"
                        points={diasRanking}
                        labels={diasLabels}
                        height={48}
                        invert
                        format={(v) => `${v}º`}
                      />
                    }
                  />
                </div>
              </section>

              {/* Evolução do Score & Comparativo Mensal Real (30 dias) */}
              <section aria-labelledby="titulo-evolucao" className="grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl bg-muted/30 p-5 ring-1 ring-border sm:p-6">
                  <h4 className="mb-4 text-xs font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                    Evolução do Score (hoje)
                  </h4>
                  <TrendChart
                    title="Evolução do score geral nas últimas 8 horas"
                    points={horasScore}
                    labels={horasLabels}
                    height={96}
                  />
                </article>
                <article className="rounded-2xl bg-muted/30 p-5 ring-1 ring-border sm:p-6">
                  <h4 className="mb-4 text-xs font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                    Comparativo Mensal (últimos 30 dias)
                  </h4>
                  <div className="space-y-4">
                    <ProgressBar
                      label="Volume de Conversas (30d)"
                      value={`${atual.monthlyConversations ?? atual.totalConversations} atend.`}
                      pct={atual.monthlyVolumePct ?? 0}
                    />
                    <ProgressBar
                      label={atual.retentionLabel ?? "Conformidade de SLA (30d)"}
                      value={`${atual.retentionOrResolutionPct ?? 0}%`}
                      pct={atual.retentionOrResolutionPct ?? 0}
                    />
                    <ProgressBar
                      label="Carteira Ativa no CRM"
                      value={`${atual.openDealsCount ?? 0} negócio(s)`}
                      pct={atual.crmWalletPct ?? 0}
                    />
                  </div>
                </article>
              </section>

              {/* Painel Expansível de Ocorrências & Auditorias de I.A. */}
              <AnimatePresence>
                {showOccurrences && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="rounded-2xl border border-border bg-muted/30 p-6 space-y-4 overflow-hidden"
                  >
                    <h4 className="text-xs font-extrabold text-foreground uppercase tracking-wider flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-primary" />
                      Ocorrências Recentes e Auditorias de I.A. ({operatorAudits.length})
                    </h4>

                    {operatorAudits.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2 italic">
                        Nenhuma auditoria de I.A. registrada para {atual.operatorName} neste período.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {operatorAudits.map((audit) => (
                          <div
                            key={audit.id}
                            onClick={() => onSelectAudit(audit.id)}
                            className="p-4 rounded-xl border border-border bg-card hover:bg-muted/50 transition cursor-pointer flex flex-col gap-2 group"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-foreground truncate">
                                Atendimento: {audit.contactName || "Cliente"}
                              </span>
                              <span className="text-xs font-black text-primary flex items-center gap-1">
                                Score: {audit.performanceScore ?? "–"}
                                <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                              </span>
                            </div>

                            {audit.strengths && (
                              <div className="text-xs bg-primary/10 text-foreground p-2 rounded border border-primary/20">
                                <strong className="block text-[10px] font-extrabold uppercase text-primary mb-0.5">Pontos Fortes:</strong>
                                <p className="line-clamp-2">{audit.strengths}</p>
                              </div>
                            )}

                            {audit.weaknesses && (
                              <div className="text-xs bg-muted/40 text-muted-foreground p-2 rounded border border-border">
                                <strong className="block text-[10px] font-extrabold uppercase text-foreground mb-0.5">Pontos a Melhorar:</strong>
                                <p className="line-clamp-2">{audit.weaknesses}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
