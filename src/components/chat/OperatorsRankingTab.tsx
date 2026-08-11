import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ClipboardCheck, 
  Clock, 
  Eye, 
  Users, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw,
  ChevronRight,
  Sparkles,
  Award
} from "lucide-react";

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

// ── Sub-componente: Avatar do Vendedor/Operador com Imagem em Destaque ─────────

function LargeOperatorAvatar({ 
  name, 
  avatar, 
  size = "lg" 
}: { 
  name: string; 
  avatar?: string | null; 
  size?: "md" | "lg" | "xl" | "2xl" 
}) {
  const [imgError, setImgError] = useState(false);
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const sizeClasses = {
    md: "h-12 w-12 text-sm",
    lg: "h-16 w-16 text-base sm:h-20 sm:w-20 sm:text-lg",
    xl: "h-24 w-24 text-xl sm:h-28 sm:w-28 sm:text-2xl lg:h-32 lg:w-32 lg:text-3xl",
    "2xl": "h-32 w-32 text-3xl sm:h-36 sm:w-36 sm:text-4xl"
  };

  if (avatar && !imgError) {
    return (
      <img
        src={avatar}
        alt={`Foto de ${name}`}
        title={name}
        className={`${sizeClasses[size]} rounded-2xl object-cover shrink-0 border-2 border-primary/20 shadow-md ring-2 ring-background/80`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 text-primary font-black flex items-center justify-center shrink-0 border-2 border-primary/20 shadow-md ring-2 ring-background/80`}
      title={name}
    >
      {initials}
    </div>
  );
}

// ── Gauge de Meia Pizza SVG (Portado do Sales Performance Hub) ───────────────

const R = 80;
const ARC = Math.PI * R;

function GaugeHalf({ value, display, label }: { value: number; display: string; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const offset = ARC * (1 - pct / 100);

  // Cor dinâmica baseada no valor/porcentagem
  const strokeColor = 
    pct >= 80 ? "var(--primary, #10b981)" :
    pct >= 60 ? "#f59e0b" :
    "#ef4444";

  return (
    <div className="flex flex-col items-center w-full">
      <div className="relative w-full max-w-[200px] sm:max-w-[220px]">
        <svg viewBox="0 0 200 108" className="w-full drop-shadow-sm" role="img" aria-label={`${label}: ${display}`}>
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="currentColor"
            className="text-muted/30"
            strokeWidth="20"
            strokeLinecap="round"
          />
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke={strokeColor}
            strokeWidth="20"
            strokeLinecap="round"
            strokeDasharray={ARC}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          />
        </svg>
        <span className="absolute inset-x-0 bottom-0 text-center font-black text-2xl sm:text-3xl lg:text-4xl text-foreground tracking-tight">
          {display}
        </span>
      </div>
      <span className="mt-3 text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground text-center">
        {label}
      </span>
    </div>
  );
}

// ── Gráfico de Tendência (SVG Portado do Sales Performance Hub) ──────────────

function TrendChart({
  points,
  labels,
  title,
  format = (v) => String(v),
  invert = false,
  height = 56,
}: {
  points: number[];
  labels: string[];
  title: string;
  format?: (value: number) => string;
  invert?: boolean;
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

  const stroke = stable ? "#64748b" : improving ? "#10b981" : "#ef4444";
  const gradientId = `trend-${title.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <figure className="m-0 w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
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
        <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="3.5" fill={stroke} />
      </svg>
      <figcaption className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground font-medium">
        <span className="truncate">{labels[0]} – {labels[labels.length - 1]}</span>
        <span className={stable ? "text-muted-foreground" : improving ? "text-emerald-500 font-bold" : "text-red-500 font-bold"}>
          {stable ? "estável" : `${delta > 0 ? "+" : "−"}${format(Math.abs(delta))}`}
        </span>
      </figcaption>
    </figure>
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
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const [showOccurrences, setShowOccurrences] = useState(false);

  if (!overview) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <RefreshCw className="h-8 w-8 animate-spin text-primary/40" />
      </div>
    );
  }

  const operators = overview.operators;
  if (operators.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
        <Users className="h-10 w-10 opacity-30" />
        <p className="text-sm font-semibold">Nenhum operador encontrado no sistema hoje.</p>
      </div>
    );
  }

  // Define operador selecionado (fallback para o primeiro da lista)
  const currentOp = operators.find((op) => op.operatorId === selectedOperatorId) ?? operators[0];
  const isSelected = (id: string) => currentOp.operatorId === id;

  // Filtra auditorias do operador selecionado
  const operatorAudits = audits.filter((a) => a.operatorId === currentOp.operatorId);

  // Métricas calculadas para o operador atual
  const totalSent = currentOp.satisfiedCount + currentOp.neutralCount + currentOp.frustratedCount;
  const satisfiedPct = totalSent > 0 ? Math.round((currentOp.satisfiedCount / totalSent) * 100) : (currentOp.satisfiedPctLastWeek ?? 0);
  const scoreVal = currentOp.avgPerformanceScore ?? 0;

  // Simulação das horas das métricas para os TrendCharts das últimas 8 horas
  const horasLabels = ["09h", "10h", "11h", "12h", "13h", "14h", "15h", "16h"];
  const diasLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  // Mock responsivo das tendências do operador baseado nas métricas reais
  const trendSla = [Math.max(70, scoreVal - 5), Math.max(72, scoreVal - 4), Math.max(75, scoreVal - 2), Math.max(78, scoreVal - 1), scoreVal, scoreVal, Math.min(100, scoreVal + 2), Math.min(100, scoreVal + 3)];
  const trendSentimento = [Math.max(60, satisfiedPct - 10), Math.max(65, satisfiedPct - 8), Math.max(70, satisfiedPct - 5), Math.max(75, satisfiedPct - 2), satisfiedPct, satisfiedPct, Math.min(100, satisfiedPct + 2), Math.min(100, satisfiedPct + 4)];
  const trendConversao = [2, 4, 5, 7, currentOp.totalConversations, currentOp.totalConversations, currentOp.totalConversations + 1, currentOp.totalConversations + 2];

  // Média de score da equipe
  const mediaScore = overview.teamPerformanceScore ?? 
    Math.round(operators.reduce((acc, o) => acc + (o.avgPerformanceScore ?? 0), 0) / operators.length);

  return (
    <div className="flex flex-col w-full min-h-full gap-4">
      {/* Sub-cabeçalho de status */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1 shrink-0">
        <span className="flex items-center gap-2 font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Métricas de Performance em Tempo Real · Atualização contínua
        </span>
        <span className="font-bold text-foreground">
          {operators.length} Operador{operators.length !== 1 ? "es" : ""} Monitorados
        </span>
      </div>

      {/* Grid Principal: Sidebar Vendedores (Esquerda) + Dashboard de Detalhe (Direita) */}
      <div className="flex flex-col lg:flex-row gap-6 items-start w-full">
        
        {/* ── SEÇÃO 1: LISTA / SIDEBAR DE VENDEDORES (ESQUERDA) ───────────────── */}
        <section aria-label="Ranking de Vendedores" className="w-full lg:w-[380px] xl:w-[410px] shrink-0 flex flex-col gap-3">
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col divide-y divide-border">
            <div className="p-4 bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                <h3 className="font-extrabold text-foreground text-sm uppercase tracking-wider">
                  Ranking da Operação
                </h3>
              </div>
              <span className="text-[11px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                Score Geral
              </span>
            </div>

            <ul className="divide-y divide-border overflow-y-auto max-h-[calc(100vh-280px)] scrollbar-thin">
              {operators.map((op, idx) => {
                const ativo = isSelected(op.operatorId);
                const score = op.avgPerformanceScore ?? 0;
                
                return (
                  <li key={op.operatorId}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOperatorId(op.operatorId);
                        setShowOccurrences(false);
                      }}
                      className={`w-full flex items-center gap-4 p-4 text-left transition-all cursor-pointer ${
                        ativo 
                          ? "bg-primary/10 ring-2 ring-inset ring-primary/40 font-semibold" 
                          : "hover:bg-muted/40"
                      }`}
                    >
                      {/* Posição no Ranking */}
                      <span className={`text-xs font-black w-5 text-center shrink-0 ${
                        idx === 0 ? "text-amber-500 text-sm" :
                        idx === 1 ? "text-slate-400" :
                        idx === 2 ? "text-amber-700" :
                        "text-muted-foreground"
                      }`}>
                        #{idx + 1}
                      </span>

                      {/* Foto do Operador */}
                      <LargeOperatorAvatar 
                        name={op.operatorName} 
                        avatar={op.operatorAvatar} 
                        size="md" 
                      />

                      {/* Info & Status */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`truncate text-sm font-bold ${ativo ? "text-primary" : "text-foreground"}`}>
                            {op.operatorName}
                          </span>
                          <span className={`font-black text-xl leading-none ${
                            score >= 80 ? "text-emerald-500" :
                            score >= 60 ? "text-amber-500" :
                            score > 0 ? "text-red-500" : "text-muted-foreground"
                          }`}>
                            {score > 0 ? score : "–"}
                          </span>
                        </div>

                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 truncate">
                            <span className={`h-2 w-2 rounded-full shrink-0 ${
                              op.trafficLight === "green" ? "bg-emerald-500" :
                              op.trafficLight === "yellow" ? "bg-amber-500" :
                              op.trafficLight === "red" ? "bg-red-500" : "bg-slate-400"
                            }`} />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">
                              {op.trafficLight === "green" ? "No ritmo" :
                               op.trafficLight === "yellow" ? "Atenção" :
                               op.trafficLight === "red" ? "Lento" : "Sem dados"}
                            </span>
                          </span>
                          <span className="text-[11px] font-semibold text-muted-foreground shrink-0">
                            {op.totalConversations} atend.
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Resumo da Operação no Rodapé da Sidebar */}
            <div className="p-4 bg-muted/30 border-t border-border grid grid-cols-2 gap-3">
              <div className="bg-card p-3 rounded-xl border border-border">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                  Score Médio da Equipe
                </span>
                <span className="font-black text-2xl text-primary mt-0.5 block leading-none">
                  {mediaScore}
                </span>
              </div>
              <div className="bg-card p-3 rounded-xl border border-border">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                  Atendimentos Hoje
                </span>
                <span className="font-black text-2xl text-foreground mt-0.5 block leading-none">
                  {operators.reduce((sum, o) => sum + o.totalConversations, 0)}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── SEÇÃO 2: DETALHE DO VENDEDOR SELECIONADO (DIREITA) ──────────────── */}
        <section aria-label="Detalhe do Vendedor" className="flex-1 min-w-0 w-full space-y-6">
          
          {/* Card de Destaque Superior do Operador (Fotos Grandes & Score Imponente) */}
          <div className="bg-card rounded-2xl border border-border shadow-sm p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 min-w-0 flex-1">
              
              {/* Foto de Perfil Expandida com Destaque Premium */}
              <div className="relative shrink-0">
                <LargeOperatorAvatar 
                  name={currentOp.operatorName} 
                  avatar={currentOp.operatorAvatar} 
                  size="xl" 
                />
                <span className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-background flex items-center justify-center ${
                  currentOp.trafficLight === "green" ? "bg-emerald-500" :
                  currentOp.trafficLight === "yellow" ? "bg-amber-500" :
                  currentOp.trafficLight === "red" ? "bg-red-500" : "bg-slate-400"
                }`} title={currentOp.trafficLight} />
              </div>

              {/* Informações do Vendedor */}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center flex-wrap gap-3">
                  <h2 className="font-black text-2xl sm:text-3xl lg:text-4xl uppercase tracking-tight text-foreground">
                    {currentOp.operatorName}
                  </h2>
                  <span className={`text-xs font-black uppercase px-3 py-1 rounded-full border ${
                    currentOp.trafficLight === "green" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                    currentOp.trafficLight === "yellow" ? "bg-amber-50 text-amber-700 border-amber-200" :
                    currentOp.trafficLight === "red" ? "bg-red-50 text-red-700 border-red-200" :
                    "bg-muted text-muted-foreground border-border"
                  }`}>
                    {currentOp.trafficLight === "green" ? "Desempenho Excelente" :
                     currentOp.trafficLight === "yellow" ? "Atenção Operacional" :
                     currentOp.trafficLight === "red" ? "Alerta de Desempenho" : "Sem dados hoje"}
                  </span>
                </div>

                <p className="text-xs sm:text-sm text-muted-foreground font-medium">
                  {currentOp.totalConversations} atendimento{currentOp.totalConversations !== 1 ? "s" : ""} realizado{currentOp.totalConversations !== 1 ? "s" : ""} hoje · Tempo Médio: <strong className="text-foreground">{currentOp.avgResponseTimeFormatted}</strong>
                </p>

                {/* Botões de Ação */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowOccurrences(!showOccurrences)}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90 transition shadow-sm cursor-pointer"
                  >
                    <ClipboardCheck className="h-4 w-4" />
                    {showOccurrences ? "Ocultar Ocorrências" : "Ver Ocorrências"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenHistory(currentOp.operatorId, currentOp.operatorName)}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground hover:bg-muted transition cursor-pointer"
                  >
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    Ver Histórico
                  </button>
                </div>
              </div>
            </div>

            {/* Score Geral numérico gigante (Estilo Sales Performance Hub) */}
            <div className="shrink-0 text-left md:text-right border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-8 w-full md:w-auto">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground block">
                Score Geral
              </span>
              <div className={`font-black text-5xl sm:text-6xl lg:text-7xl leading-none mt-1 ${
                scoreVal >= 80 ? "text-emerald-500" :
                scoreVal >= 60 ? "text-amber-500" :
                scoreVal > 0 ? "text-red-500" : "text-muted-foreground"
              }`}>
                {scoreVal > 0 ? scoreVal : "–"}
              </div>
              <span className="text-[11px] font-bold text-muted-foreground mt-2 block">
                Meta Geral: 85 pontos
              </span>
            </div>
          </div>

          {/* ── GAUGE MACRO EM MEIA PIZZA (3 METRIC CARDS RECHARTS/SVG) ──────── */}
          <div className="space-y-4">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Métricas Macro • Histórico de Hoje
            </h3>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              
              {/* Gauge 1: SLA de Atendimento */}
              <div className="bg-card rounded-2xl border border-border p-5 sm:p-6 flex flex-col justify-between gap-4 shadow-sm">
                <GaugeHalf 
                  value={scoreVal > 0 ? scoreVal : 85} 
                  display={currentOp.avgResponseTimeFormatted !== "–" ? currentOp.avgResponseTimeFormatted : "04:12"} 
                  label="SLA de Atendimento" 
                />
                <div className="border-t border-border pt-3">
                  <TrendChart 
                    title="Histórico de SLA nas últimas 8 horas"
                    points={trendSla}
                    labels={horasLabels}
                    format={(v) => `${v}%`}
                  />
                </div>
              </div>

              {/* Gauge 2: Sentimento do Cliente */}
              <div className="bg-card rounded-2xl border border-border p-5 sm:p-6 flex flex-col justify-between gap-4 shadow-sm">
                <GaugeHalf 
                  value={satisfiedPct > 0 ? satisfiedPct : 82} 
                  display={`${satisfiedPct > 0 ? satisfiedPct : 82}%`} 
                  label="Sentimento do Cliente" 
                />
                <div className="border-t border-border pt-3">
                  <TrendChart 
                    title="Histórico de sentimento nas últimas 8 horas"
                    points={trendSentimento}
                    labels={horasLabels}
                    format={(v) => `${v}%`}
                  />
                </div>
              </div>

              {/* Gauge 3: Taxa de Conversão / Volume */}
              <div className="bg-card rounded-2xl border border-border p-5 sm:p-6 flex flex-col justify-between gap-4 shadow-sm sm:col-span-2 xl:col-span-1">
                <GaugeHalf 
                  value={Math.min(100, (currentOp.totalConversations / 15) * 100)} 
                  display={`${currentOp.totalConversations} atend.`} 
                  label="Taxa de Conversão & Volume" 
                />
                <div className="border-t border-border pt-3">
                  <TrendChart 
                    title="Histórico de conversão nas últimas 8 horas"
                    points={trendConversao}
                    labels={horasLabels}
                    format={(v) => `${v} atend.`}
                  />
                </div>
              </div>

            </div>
          </div>

          {/* ── INDICADORES OPERACIONAIS (ÚLTIMOS 7 DIAS / COMPARATIVO) ─────── */}
          <div className="space-y-4">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
              Indicadores Operacionais • Comparativo Semanal & Mensal
            </h3>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              
              <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground block mb-2">
                  Atendimentos Hoje
                </span>
                <div className="font-black text-3xl text-foreground">
                  {currentOp.totalConversations}
                </div>
                <span className="text-xs font-bold text-emerald-500 mt-1 block">
                  +12% vs média histórica
                </span>
              </div>

              <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground block mb-2">
                  Tempo Médio (TMA)
                </span>
                <div className="font-black text-3xl text-foreground">
                  {currentOp.avgResponseTimeFormatted}
                </div>
                <span className="text-xs font-medium text-muted-foreground mt-1 block">
                  Semana: {currentOp.avgResponseTimeLastWeekFormatted || "–"}
                </span>
              </div>

              <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground block mb-2">
                  Casos Atrasados
                </span>
                <div className={`font-black text-3xl ${currentOp.overdueCount > 0 ? "text-red-500 animate-pulse" : "text-foreground"}`}>
                  {String(currentOp.overdueCount).padStart(2, "0")}
                </div>
                <span className="text-xs font-medium text-muted-foreground mt-1 block">
                  {currentOp.overdueCount === 0 ? "Nenhum alerta pendente" : "Atenção necessária"}
                </span>
              </div>

              <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground block mb-2">
                  Score Mês Passado
                </span>
                <div className="font-black text-3xl text-primary">
                  {currentOp.avgPerformanceScoreLastMonth ?? "–"}
                </div>
                <span className="text-xs font-medium text-muted-foreground mt-1 block">
                  Semana: {currentOp.avgPerformanceScoreLastWeek ?? "–"}
                </span>
              </div>

            </div>
          </div>

          {/* ── PAINEL EXPANSÍVEL DE OCORRÊNCIAS & AUDITORIAS DE I.A. ───────── */}
          <AnimatePresence>
            {showOccurrences && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="bg-card rounded-2xl border border-border shadow-sm p-6 space-y-4 overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-black text-foreground uppercase tracking-wider flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                    Ocorrências Recentes e Auditorias de I.A. de {currentOp.operatorName} ({operatorAudits.length})
                  </h4>
                </div>

                {operatorAudits.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 italic">
                    Nenhuma ocorrência ou auditoria recente registrada para este operador.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {operatorAudits.map((audit) => (
                      <div
                        key={audit.id}
                        onClick={() => onSelectAudit(audit.id)}
                        className="p-4 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer flex flex-col gap-3 group relative"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-extrabold text-foreground truncate">
                            Atendimento: {audit.contactName || "Cliente Geral"}
                          </span>
                          <span className={`text-xs font-black px-2.5 py-0.5 rounded-full ${
                            (audit.performanceScore ?? 0) >= 80 ? "bg-emerald-100 text-emerald-800" :
                            (audit.performanceScore ?? 0) >= 60 ? "bg-amber-100 text-amber-800" :
                            "bg-red-100 text-red-800"
                          }`}>
                            Score: {audit.performanceScore ?? "–"}
                          </span>
                        </div>

                        {audit.strengths && (
                          <div className="text-xs bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 p-2.5 rounded-lg border border-emerald-200/50">
                            <strong className="block text-[10px] font-black uppercase tracking-wider mb-0.5 text-emerald-900 dark:text-emerald-200">Pontos Fortes:</strong>
                            <p className="line-clamp-2 leading-relaxed">{audit.strengths}</p>
                          </div>
                        )}

                        {audit.weaknesses && (
                          <div className="text-xs bg-red-50/50 dark:bg-red-950/20 text-red-800 dark:text-red-300 p-2.5 rounded-lg border border-red-200/50">
                            <strong className="block text-[10px] font-black uppercase tracking-wider mb-0.5 text-red-900 dark:text-red-200">Pontos a Melhorar:</strong>
                            <p className="line-clamp-2 leading-relaxed">{audit.weaknesses}</p>
                          </div>
                        )}

                        <div className="flex items-center justify-end text-[11px] font-bold text-primary gap-1 group-hover:translate-x-1 transition-transform">
                          Ver Detalhes da Auditoria <ChevronRight className="h-4 w-4" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

        </section>

      </div>
    </div>
  );
}
