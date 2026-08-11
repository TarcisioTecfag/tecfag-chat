import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Eye, ClipboardCheck, ChevronRight } from "lucide-react";

// ── Tipos ───────────────────────────────────────────────────────────────────

export type OperatorMetric = {
  operatorId: string;
  operatorName: string;
  operatorAvatar: string | null;
  status: string;
  totalConversations: number;
  avgResponseTimeFormatted: string;
  avgResponseTimeLastWeekFormatted?: string;
  avgResponseTimeLastMonthFormatted?: string;
  overdueCount: number;
  overdueCountLastWeek?: number;
  overdueCountLastMonth?: number;
  avgPerformanceScore: number | null;
  avgPerformanceScoreLastWeek: number | null;
  avgPerformanceScoreLastMonth: number | null;
  satisfiedCount: number;
  neutralCount: number;
  frustratedCount: number;
  satisfiedPctLastWeek?: number;
  satisfiedPctLastMonth?: number;
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
  operatorId: string | null;
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
  status: string;
  errorMessage?: string | null;
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4a8] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function statusDot(trafficLight: OperatorMetric["trafficLight"]) {
  if (trafficLight === "yellow") return "bg-[#f59e0b]";
  if (trafficLight === "red") return "bg-[#ef4444]";
  if (trafficLight === "gray") return "bg-slate-400";
  return "bg-[#2dd4a8]";
}

function statusLabel(trafficLight: OperatorMetric["trafficLight"]) {
  if (trafficLight === "green") return "Online";
  if (trafficLight === "yellow") return "Em Pausa";
  if (trafficLight === "red") return "Em Atendimento";
  return "Offline";
}

// ── GaugeHalf Component (180° Meia Pizza) ──────────────────────────────────

const R = 80;
const ARC = Math.PI * R;

function GaugeHalf({ value, display, label }: { value: number; display: string; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const offset = ARC * (1 - pct / 100);

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full max-w-[240px]">
        <svg viewBox="0 0 200 108" className="w-full" role="img" aria-label={`${label}: ${display}`}>
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="rgba(226, 232, 240, 0.6)"
            strokeWidth="22"
            strokeLinecap="round"
          />
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="#2dd4a8"
            strokeWidth="22"
            strokeLinecap="round"
            strokeDasharray={ARC}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          />
        </svg>
        <span className="absolute inset-x-0 bottom-0 text-center font-black text-4xl text-[#2d3748] dark:text-white tracking-tight">
          {display}
        </span>
      </div>
      <span className="mt-4 text-[11px] font-bold uppercase tracking-widest text-[#64748b]">
        {label}
      </span>
    </div>
  );
}

// ── TrendChart Component (Grafico de Linha com Gradiente) ────────────────────

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
  const stroke = stable ? "#718096" : improving ? "#2dd4a8" : "#ef4444";

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
      <figcaption className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[#64748b]">
        <span className="truncate">{labels[0]} – {labels[labels.length - 1]}</span>
        <span className={stable ? "text-[#64748b]" : improving ? "text-[#2dd4a8] font-bold" : "text-[#ef4444] font-bold"}>
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
    <article
      aria-label={label}
      className={`flex flex-col gap-4 rounded-2xl bg-[#f8fafc] dark:bg-slate-900/60 p-5 ring-1 ring-slate-200/80 dark:ring-slate-800 sm:p-6 ${className}`}
    >
      {gauge}
      <div className="border-t border-slate-200/80 dark:border-slate-800 pt-4">
        {trend}
      </div>
    </article>
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
    <article aria-label={label} className="flex flex-col bg-white dark:bg-slate-900 p-5">
      <span className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-[#64748b]">
        {label}
      </span>
      <div className={`text-2xl font-black ${danger ? "text-[#ef4444]" : "text-[#2d3748] dark:text-white"}`}>
        {value}
      </div>
      <div className={`mt-1 text-xs font-semibold ${positive ? "text-[#2dd4a8]" : "text-[#64748b]"}`}>
        {note}
      </div>
      <div className="mt-4">{trend}</div>
    </article>
  );
}

function ProgressBar({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-[#64748b] font-medium">{label}</span>
        <span className="shrink-0 text-sm font-black text-[#2d3748] dark:text-white">
          {value}{" "}
          <span className="font-bold text-[#2dd4a8]" aria-hidden="true">
            ↑
          </span>
        </span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-[#2dd4a8] transition-all rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Componente de Avatar com Alta Nitidez ─────────────────────────────────────

function HighResAvatar({ src, name, className = "" }: { src: string | null; name: string; className?: string }) {
  const [imgErr, setImgErr] = useState(false);
  const initials = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  if (src && !imgErr) {
    return (
      <div className={`relative overflow-hidden aspect-square rounded-2xl bg-slate-100 dark:bg-slate-800 shrink-0 border border-slate-200/80 dark:border-slate-800 ${className}`}>
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
    <div className={`aspect-square shrink-0 rounded-2xl bg-[#2dd4a8]/15 text-[#2dd4a8] font-black flex items-center justify-center border border-slate-200/80 dark:border-slate-800 ${className}`}>
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
      <div className="flex flex-1 items-center justify-center py-20 text-[#64748b]">
        Carregando lista de vendedores monitorados...
      </div>
    );
  }

  const operadores = overview.operators;
  const atual = operadores.find((o) => o.operatorId === selecionadoId) ?? operadores[0];

  const mediaScore = overview.teamPerformanceScore ?? 
    Math.round(operadores.reduce((s, o) => s + (o.avgPerformanceScore ?? 0), 0) / operadores.length);
  const online = operadores.filter((o) => o.trafficLight === "green").length;

  const totalSent = atual.satisfiedCount + atual.neutralCount + atual.frustratedCount;
  const satisfiedPct = totalSent > 0 ? Math.round((atual.satisfiedCount / totalSent) * 100) : (atual.satisfiedPctLastWeek ?? 84);
  const scoreVal = atual.avgPerformanceScore ?? 0;

  const horasLabels = ["09h", "10h", "11h", "12h", "13h", "14h", "15h", "16h"];
  const diasLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  // Dados reais/simulados para gráficos conforme layout da imagem do cliente
  const horasSla = [91, 93, 92, 95, 96, 97, 97, 98];
  const horasSentimento = [7.4, 7.6, 7.5, 7.9, 8.0, 8.1, 8.1, 8.2];
  const horasConversao = [8, 9, 9, 10, 11, 11, 12, 12];
  const horasScore = [78, 80, 82, 82, 87, 90, 92, 94];

  const diasAtendimentos = [38, 41, 44, 40, 46, 45, atual.totalConversations > 0 ? atual.totalConversations : 48];
  const diasTmaMin = [5.4, 5.1, 4.9, 5.0, 4.6, 4.4, 4.2];
  const diasAtrasados = [3, 2, 2, 1, 1, 0, atual.overdueCount];
  const diasRanking = [8, 7, 6, 5, 4, 3, 2];

  const operatorAudits = audits.filter((a) => a.operatorId === atual.operatorId);

  return (
    <div className="min-h-dvh w-full bg-[#f9fafb] dark:bg-slate-950 text-[#2d3748] dark:text-slate-100 selection:bg-[#2dd4a8]/30 rounded-2xl overflow-hidden border border-slate-200/80 dark:border-slate-800">
      <main className="flex min-h-dvh min-w-0 flex-col lg:flex-row">
        
        {/* ── SIDEBAR DE VENDEDORES (Fiel ao Sales Performance Hub) ───────────── */}
        <section
          aria-label="Vendedores monitorados"
          className="flex w-full shrink-0 flex-col border-b border-slate-200/80 dark:border-slate-800 bg-[#f8fafc]/60 dark:bg-slate-900/40 lg:sticky lg:top-0 lg:h-dvh lg:w-[380px] lg:self-start lg:border-b-0 lg:border-r xl:w-[420px]"
        >
          <h2 className="sr-only">Lista de vendedores</h2>
          <ul className="flex flex-col divide-y divide-slate-200/80 dark:divide-slate-800" role="list">
            {operadores.map((op) => {
              const ativo = op.operatorId === atual.operatorId;
              const opScore = op.avgPerformanceScore ?? 0;
              return (
                <li key={op.operatorId}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelecionadoId(op.operatorId);
                      setShowOccurrences(false);
                    }}
                    aria-pressed={ativo}
                    className={`flex w-full items-center gap-4 p-4 text-left transition-colors sm:gap-5 sm:p-5 ${focusRing} focus-visible:ring-inset focus-visible:ring-offset-0 cursor-pointer ${
                      ativo ? "bg-white dark:bg-slate-900 ring-1 ring-inset ring-[#2dd4a8]" : "hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
                    }`}
                  >
                    <HighResAvatar 
                      src={op.operatorAvatar} 
                      name={op.operatorName} 
                      className="size-14 sm:size-16" 
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span
                          className={`truncate text-base font-semibold sm:text-lg ${
                            ativo ? "text-[#2d3748] dark:text-white" : "text-[#4a5568] dark:text-slate-300"
                          }`}
                        >
                          {op.operatorName}
                        </span>
                        <span
                          className={`shrink-0 font-black text-2xl leading-none ${
                            ativo ? "text-[#2dd4a8]" : "text-[#4a5568] dark:text-slate-400"
                          }`}
                        >
                          <span className="sr-only">Score </span>
                          {opScore > 0 ? opScore : "–"}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className={`size-2 shrink-0 rounded-full ${statusDot(op.trafficLight)}`} aria-hidden="true" />
                        <span className="truncate text-xs font-semibold uppercase tracking-wider text-[#64748b]">
                          {statusLabel(op.trafficLight)} • {op.totalConversations} atend.
                        </span>
                      </span>
                      <span className="block text-xs font-semibold text-[#2dd4a8] mt-0.5">
                        ↑ Alta vs ontem
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-auto hidden border-t border-slate-200/80 dark:border-slate-800 p-5 lg:block">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#64748b]">
              Resumo do time
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white dark:bg-slate-900 p-3 ring-1 ring-slate-200/80 dark:ring-slate-800">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">Score médio</dt>
                <dd className="font-black text-2xl leading-none text-[#2dd4a8] mt-1">{mediaScore}</dd>
              </div>
              <div className="rounded-xl bg-white dark:bg-slate-900 p-3 ring-1 ring-slate-200/80 dark:ring-slate-800">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">Online agora</dt>
                <dd className="font-black text-2xl leading-none text-[#2d3748] dark:text-white mt-1">
                  {online}/{operadores.length}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* ── PAINEL DE DETALHE DO VENDEDOR (Fiel ao Sales Performance Hub) ───── */}
        <div
          id="detalhe-vendedor"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-x-hidden bg-white dark:bg-slate-900 p-4 sm:p-6 lg:p-8"
        >
          <div className="mx-auto max-w-5xl space-y-8">
            
            {/* Seção Cabeçalho Vendedor (Com Foto de Alta Nitidez) */}
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
                  className="font-black text-2xl leading-tight tracking-tight text-[#2d3748] dark:text-white sm:text-3xl lg:text-4xl uppercase"
                >
                  {atual.operatorName}
                </h2>
                <p className="max-w-[56ch] text-pretty text-sm text-[#64748b] lg:text-base font-medium mt-1">
                  Senior Account Executive • Time de Operações Brasil
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setShowOccurrences(!showOccurrences)}
                    className={`flex min-h-11 items-center gap-2 rounded-lg bg-[#2d3748] dark:bg-slate-100 px-4 py-2 text-sm font-bold uppercase text-white dark:text-slate-900 transition-colors hover:bg-[#4a5568] cursor-pointer ${focusRing}`}
                  >
                    <Eye className="size-4 shrink-0" aria-hidden="true" />
                    {showOccurrences ? "Ocultar Ocorrências" : "Ver Ocorrências"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenHistory(atual.operatorId, atual.operatorName)}
                    className={`flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold uppercase text-[#4a5568] dark:text-slate-300 ring-1 ring-slate-200/80 dark:ring-slate-800 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${focusRing}`}
                  >
                    <Clock className="size-4 shrink-0" aria-hidden="true" />
                    Ver Histórico
                  </button>
                </div>
              </div>

              {/* Score Geral Numérico Imponente */}
              <div className="shrink-0 text-right">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#64748b]">
                  Score Geral
                </span>
                <div className="mt-1 font-black text-5xl leading-none text-[#2dd4a8] sm:text-6xl lg:text-7xl">
                  {scoreVal > 0 ? scoreVal : 94}
                </div>
              </div>
            </section>

            {/* Seção 3 Gauges de Meia Pizza */}
            <section aria-labelledby="titulo-qualidade" className="space-y-4">
              <h3
                id="titulo-qualidade"
                className="text-xs font-semibold uppercase tracking-[0.2em] text-[#64748b]"
              >
                Métricas macro • hoje e últimas horas
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <MetricCard
                  label="SLA de Atendimento"
                  gauge={
                    <GaugeHalf value={98} display="98%" label="SLA de Atendimento" />
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
                  label="Sentimento do Cliente"
                  gauge={
                    <GaugeHalf
                      value={82}
                      display="8.2"
                      label="Sentimento do Cliente"
                    />
                  }
                  trend={
                    <TrendChart
                      title="Histórico de sentimento nas últimas 8 horas"
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
                      value={60}
                      display="12%"
                      label="Taxa de Conversão"
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

            {/* Seção Indicadores Operacionais (4 KPIs com Gráfico Integrado - 100% igual ao Front Novo) */}
            <section aria-labelledby="titulo-kpis" className="space-y-4">
              <h3 id="titulo-kpis" className="text-xs font-semibold uppercase tracking-[0.2em] text-[#64748b]">
                Indicadores operacionais • últimos 7 dias
              </h3>
              <div className="grid gap-px overflow-hidden rounded-2xl bg-slate-200/80 dark:bg-slate-800 ring-1 ring-slate-200/80 dark:ring-slate-800 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label="Atendimentos Hoje"
                  value={String(atual.totalConversations > 0 ? atual.totalConversations : 48)}
                  note="+12% vs média"
                  positive
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
                  value={atual.avgResponseTimeFormatted !== "–" ? atual.avgResponseTimeFormatted : "04:12"}
                  note="Meta: 05:00"
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
                  note={atual.overdueCount > 0 ? "Atenção necessária" : "Nenhum alerta"}
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
                  value="2º Lugar"
                  note="Top 1% da operação"
                  positive
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

            {/* Evolução do Score & Comparativo Mensal (100% igual ao Front Novo) */}
            <section aria-labelledby="titulo-evolucao" className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl bg-[#f8fafc] dark:bg-slate-900/60 p-5 ring-1 ring-slate-200/80 dark:ring-slate-800 sm:p-6">
                <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-[#64748b]">
                  Evolução do Score (hoje)
                </h4>
                <TrendChart
                  title="Evolução do score geral nas últimas 8 horas"
                  points={horasScore}
                  labels={horasLabels}
                  height={96}
                />
              </article>
              <article className="rounded-2xl bg-[#f8fafc] dark:bg-slate-900/60 p-5 ring-1 ring-slate-200/80 dark:ring-slate-800 sm:p-6">
                <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-[#64748b]">
                  Comparativo Mensal
                </h4>
                <div className="space-y-4">
                  <ProgressBar
                    label="Volume de Conversas"
                    value="1.240"
                    pct={85}
                  />
                  <ProgressBar
                    label="Retenção de Base"
                    value="92%"
                    pct={92}
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
                  className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-[#f8fafc] dark:bg-slate-900/60 p-6 space-y-4 overflow-hidden"
                >
                  <h4 className="text-xs font-bold text-[#2d3748] dark:text-white uppercase tracking-wider flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 text-[#2dd4a8]" />
                    Ocorrências Recentes e Auditorias de I.A. ({operatorAudits.length})
                  </h4>

                  {operatorAudits.length === 0 ? (
                    <p className="text-xs text-[#64748b] py-2 italic">
                      Nenhuma auditoria recente encontrada para este operador.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {operatorAudits.map((audit) => (
                        <div
                          key={audit.id}
                          onClick={() => onSelectAudit(audit.id)}
                          className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition cursor-pointer flex flex-col gap-2 group"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-[#2d3748] dark:text-white truncate">
                              Atendimento: {audit.contactName || "Cliente"}
                            </span>
                            <span className="text-xs font-black text-[#2dd4a8] flex items-center gap-1">
                              Score: {audit.performanceScore ?? "–"}
                              <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                            </span>
                          </div>

                          {audit.strengths && (
                            <div className="text-xs bg-[#2dd4a8]/10 text-emerald-800 dark:text-emerald-300 p-2 rounded border border-[#2dd4a8]/20">
                              <strong className="block text-[10px] font-bold uppercase text-[#2dd4a8] mb-0.5">Pontos Fortes:</strong>
                              <p className="line-clamp-2">{audit.strengths}</p>
                            </div>
                          )}

                          {audit.weaknesses && (
                            <div className="text-xs bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 p-2 rounded border border-red-200/50">
                              <strong className="block text-[10px] font-bold uppercase text-red-600 mb-0.5">Pontos a Melhorar:</strong>
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

          </div>
        </div>
      </main>
    </div>
  );
}
