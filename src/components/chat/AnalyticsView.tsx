import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useChat } from "@/hooks/useChatState";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import {
  BarChart2, Clock, Users, ArrowUpRight, ArrowDownRight,
  MessageSquare, RefreshCw, Percent, FileText, CheckCircle2,
  AlertTriangle, Info, Shield, HelpCircle, Activity, Star,
  TrendingUp, TrendingDown, Eye, Coins, Globe, Phone, Zap,
  Search, ArrowUpDown, Filter, Award
} from "lucide-react";
// Componentes migrados do Monitoramento
import { OverviewTab, CostsTab } from "@/components/chat/MonitorView";
import { WhatsappLogo } from "@/components/chat/ChatList";
import { SystemTooltip } from "@/components/ui/tooltip";
import { ReportsIATab } from "@/components/reports/ReportsIATab";
import { usePermissions } from "@/hooks/usePermissions";
import { getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";
import { enhanceLegacyAvatarSrc } from "@/lib/avatar-image";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, BarChart, Bar, Cell, PieChart, Pie
} from "recharts";

// ── Tipos ───────────────────────────────────────────────────────────────────
type AnalyticsTab = "overview" | "performance" | "sla" | "contacts" | "reports" | "costs";

type HistoricalVolume = {
  name: string;
  chats: number;
  atendidos: number;
  sla: number;
};

type ChannelVolume = {
  name: string;
  value: number;
  color: string;
};

type SectorPerformance = {
  name: string;
  avgResponse: number | null;
  completed: number;
  slaPct: number | null;
};

type OperatorPerformance = {
  id?: string;
  name: string;
  avatar?: string | null;
  chats: number;
  avgResponseSeconds: number;
  slaPct: number;
  slaSampleCount?: number;
  overdueCount?: number;
  withinSlaCount?: number;
};

type ClientMetric = {
  name: string;
  novos: number;
  recorrentes: number;
};

type AiReportData = {
  id: string;
  type: "daily" | "weekly";
  period: string;
  reportMarkdown: string;
  generatedAt: string;
};

// ── Helpers Visuais & Formatação ─────────────────────────────────────────────

function formatDurationHuman(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const totalMinutes = Math.floor(s / 60);
  const remSeconds = s % 60;
  if (totalMinutes < 60) {
    return remSeconds > 0 ? `${totalMinutes}min ${remSeconds}s` : `${totalMinutes}min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}min` : `${hours}h`;
}

function getOperatorInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function OperatorAvatarBadge({
  name,
  avatar,
  highlight = false,
}: {
  name: string;
  avatar?: string | null;
  highlight?: boolean;
}) {
  const resolvedAvatar = avatar ? enhanceLegacyAvatarSrc(avatar) : null;
  if (resolvedAvatar) {
    return (
      <img
        src={resolvedAvatar}
        alt={name}
        className={`h-7 w-7 rounded-full object-cover shrink-0 border ${
          highlight ? "border-primary/40" : "border-border"
        }`}
      />
    );
  }
  return (
    <div
      className={`h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-extrabold border ${
        highlight
          ? "bg-primary/15 text-primary border-primary/30"
          : "bg-muted text-muted-foreground border-border"
      }`}
    >
      {getOperatorInitials(name)}
    </div>
  );
}

function SystemChartTooltip({
  active,
  payload,
  label,
  valueSuffix = "",
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  valueSuffix?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-card/95 backdrop-blur-md border border-border rounded-xl p-3 shadow-card min-w-[150px]">
      {label && (
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground border-b border-line pb-1.5 mb-2">
          {label}
        </p>
      )}
      <div className="space-y-1.5">
        {payload.map((entry: any, idx: number) => (
          <div key={idx} className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: entry.color || entry.fill || "var(--primary)" }}
              />
              <span className="text-muted-foreground font-medium">{entry.name}:</span>
            </div>
            <span className="font-extrabold text-foreground tabular-nums">
              {entry.value}
              {valueSuffix}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlaPrecisionGauge({
  pct,
  targetPct = 90,
}: {
  pct: number;
  targetPct?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const size = 188;
  const cx = size / 2;
  const cy = size / 2;
  const r = 70;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - clamped / 100);

  // Ângulo da meta (ex: 90% partindo do topo -90deg)
  const targetAngleRad = ((targetPct / 100) * 360 - 90) * (Math.PI / 180);
  const targetInnerX = cx + (r - strokeWidth / 2 - 3) * Math.cos(targetAngleRad);
  const targetInnerY = cy + (r - strokeWidth / 2 - 3) * Math.sin(targetAngleRad);
  const targetOuterX = cx + (r + strokeWidth / 2 + 3) * Math.cos(targetAngleRad);
  const targetOuterY = cy + (r + strokeWidth / 2 + 3) * Math.sin(targetAngleRad);

  // Ponto final do arco atual
  const endAngleRad = ((clamped / 100) * 360 - 90) * (Math.PI / 180);
  const endDotX = cx + r * Math.cos(endAngleRad);
  const endDotY = cy + r * Math.sin(endAngleRad);

  const isOnTarget = clamped >= targetPct;
  const diffFromTarget = clamped - targetPct;

  return (
    <div className="relative flex flex-col items-center justify-center my-2">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id="slaRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--primary)" />
              <stop offset="100%" stopColor="color-mix(in srgb, var(--primary) 75%, var(--foreground))" />
            </linearGradient>
            <filter id="slaRingGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="var(--primary)" floodOpacity="0.28" />
            </filter>
          </defs>

          {/* Anel externo sutil de referência */}
          <circle
            cx={cx}
            cy={cy}
            r={r + 12}
            fill="none"
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray="2 4"
            opacity="0.6"
          />

          {/* Trilha de fundo (0 a 100% real) */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={strokeWidth}
          />

          {/* Arco de preenchimento proporcional real (0 a 100%) */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="url(#slaRingGrad)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            filter="url(#slaRingGlow)"
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          />

          {/* Marcador da Meta de 90% na trilha */}
          <line
            x1={targetInnerX}
            y1={targetInnerY}
            x2={targetOuterX}
            y2={targetOuterY}
            stroke="var(--foreground)"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.75"
          />

          {/* Indicador na ponta do progresso */}
          {clamped > 0 && (
            <circle
              cx={endDotX}
              cy={endDotY}
              r={4.5}
              fill="var(--card)"
              stroke="var(--primary)"
              strokeWidth={2.5}
            />
          )}
        </svg>

        {/* Conteúdo Central do Anel */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <span className="text-3xl font-black text-foreground tracking-tight tabular-nums leading-none">
            {clamped}%
          </span>
          <span
            className={`mt-1.5 text-[9px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
              isOnTarget
                ? "text-primary bg-primary/10 border-primary/25"
                : "text-foreground bg-muted border-border"
            }`}
          >
            {isOnTarget ? "DENTRO DA META" : "ATENÇÃO"}
          </span>
          <span className="mt-1 text-[10px] font-semibold text-muted-foreground tabular-nums">
            Meta {targetPct}% ({diffFromTarget >= 0 ? `+${diffFromTarget}%` : `${diffFromTarget}%`})
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Helpers de Renderização de Markdown Simples ──────────────────────────────
function parseMarkdown(md: string) {
  if (!md) return null;
  const lines = md.split("\n");
  
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      return (
        <h2 key={idx} className="text-sm font-extrabold text-foreground mt-4 mb-2 border-b border-line pb-1.5 flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-primary" />
          {trimmed.slice(3)}
        </h2>
      );
    }
    if (trimmed.startsWith("### ")) {
      return (
        <h3 key={idx} className="text-xs font-bold text-foreground mt-3 mb-1.5">
          {trimmed.slice(4)}
        </h3>
      );
    }
    if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
      return (
        <li key={idx} className="text-xs text-muted-foreground list-disc list-inside ml-3 py-0.5">
          {trimmed.slice(2)}
        </li>
      );
    }
    if (trimmed.startsWith("> [!NOTE]")) {
      return null;
    }
    if (line.startsWith("> ")) {
      return (
        <div key={idx} className="my-3 p-3 bg-primary-soft/50 border border-primary/20 text-foreground rounded-xl text-xs flex gap-2">
          <Info className="h-4.5 w-4.5 text-primary shrink-0 mt-0.5" />
          <div className="font-medium">{line.replace(/^>\s*(\[!NOTE\])?\s*/i, "").trim()}</div>
        </div>
      );
    }
    if (!trimmed) {
      return <div key={idx} className="h-2" />;
    }
    return (
      <p key={idx} className="text-xs text-muted-foreground leading-relaxed py-0.5">
        {trimmed}
      </p>
    );
  });
}

// ── Sub-Views ────────────────────────────────────────────────────────────────

// 1. Aba: Desempenho e Volumes
function PerformanceTab({ volumes, channels, sectors }: { 
  volumes: HistoricalVolume[]; 
  channels: ChannelVolume[]; 
  sectors: SectorPerformance[];
}) {
  const totalVolume = channels.reduce((sum, c) => sum + c.value, 0);
  const totalRecebidas7d = volumes.reduce((sum, v) => sum + (v.chats || 0), 0);
  const totalFinalizadas7d = volumes.reduce((sum, v) => sum + (v.atendidos || 0), 0);
  const resolutionRatePct =
    totalRecebidas7d > 0 ? Math.min(100, Math.round((totalFinalizadas7d / totalRecebidas7d) * 100)) : 0;

  const sortedSectors = useMemo(
    () =>
      [...sectors].sort((a, b) => {
        if (b.completed !== a.completed) return b.completed - a.completed;
        return (b.slaPct ?? -1) - (a.slaPct ?? -1);
      }),
    [sectors]
  );
  const maxSectorCompleted = useMemo(
    () => Math.max(1, ...sortedSectors.map((s) => s.completed || 0)),
    [sortedSectors]
  );

  const channelPalette = [
    "var(--primary)",
    "var(--muted-foreground)",
    "color-mix(in srgb, var(--primary) 45%, var(--muted-foreground))",
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 overflow-y-auto scrollbar-thin pr-1 pb-2">
      {/* Gráfico de Volume de Conversas */}
      <div className="xl:col-span-2 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[340px]">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-foreground">Volumetria Semanal</h3>
              <p className="text-[10px] text-muted-foreground">Evolução diária de conversas recebidas vs. finalizadas (últimos 7 dias)</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="px-2.5 py-1 rounded-xl bg-muted/40 border border-line text-[10px] font-semibold text-muted-foreground">
              Recebidas: <span className="font-extrabold text-foreground tabular-nums">{totalRecebidas7d}</span>
            </div>
            <div className="px-2.5 py-1 rounded-xl bg-muted/40 border border-line text-[10px] font-semibold text-muted-foreground">
              Finalizadas: <span className="font-extrabold text-foreground tabular-nums">{totalFinalizadas7d}</span>
            </div>
            <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-xl border border-primary/20 flex items-center gap-1 tabular-nums">
              <CheckCircle2 className="h-3 w-3" />
              {resolutionRatePct}% conclusão
            </span>
          </div>
        </div>

        <div className="flex-1 w-full h-[230px]">
          {volumes.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volumes} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorChats" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="colorAtendidos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--muted-foreground)" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="var(--muted-foreground)" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip content={<SystemChartTooltip />} />
                <Legend verticalAlign="top" height={32} iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 600 }} />
                <Area
                  type="monotone"
                  dataKey="chats"
                  name="Recebidas"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "var(--primary)", strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
                  fillOpacity={1}
                  fill="url(#colorChats)"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="atendidos"
                  name="Finalizadas"
                  stroke="var(--muted-foreground)"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "var(--muted-foreground)", strokeWidth: 0 }}
                  activeDot={{ r: 4.5, fill: "var(--muted-foreground)", stroke: "var(--card)", strokeWidth: 2 }}
                  fillOpacity={1}
                  fill="url(#colorAtendidos)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Sem dados de volumetria registrados nos últimos 7 dias.
            </div>
          )}
        </div>
      </div>

      {/* Gráfico de Canais (Pie) */}
      <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-extrabold text-foreground">Distribuição por Canal</h3>
            <p className="text-[10px] text-muted-foreground">Volume acumulado por meio de comunicação</p>
          </div>
        </div>

        <div className="h-[155px] flex items-center justify-center relative my-3">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={channels}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={66}
                paddingAngle={4}
                cornerRadius={4}
                dataKey="value"
                stroke="var(--card)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {channels.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={channelPalette[index % channelPalette.length]} />
                ))}
              </Pie>
              <Tooltip content={<SystemChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute text-center pointer-events-none">
            <p className="text-xl font-black text-foreground tabular-nums leading-none">{totalVolume}</p>
            <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mt-1">Chats</p>
          </div>
        </div>

        <div className="space-y-2.5 pt-2 border-t border-line">
          {channels.map((chan, index) => {
            const dotColor = channelPalette[index % channelPalette.length];
            const sharePct = totalVolume > 0 ? Math.round((chan.value / totalVolume) * 100) : 0;
            return (
              <div key={chan.name} className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-semibold">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dotColor }} />
                    <span className="text-foreground font-bold">{chan.name}</span>
                  </div>
                  <span className="text-muted-foreground tabular-nums">
                    <strong className="text-foreground">{chan.value}</strong> ({sharePct}%)
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${sharePct}%`, background: dotColor }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabela de Desempenho por Setores */}
      <div className="xl:col-span-3 bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <h3 className="text-xs font-extrabold text-foreground">Volume por Setor / Departamento</h3>
            <p className="text-[10px] text-muted-foreground">Atendimento concluído, TME e cumprimento de SLA consolidado</p>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-xl border border-line">
            {sortedSectors.length} {sortedSectors.length === 1 ? "setor" : "setores"}
          </span>
        </div>
        <div className="overflow-x-auto">
          {sortedSectors.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Nenhum setor cadastrado ou com atendimentos registrados.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-line">
                  <th className="px-5 py-3">Setor</th>
                  <th className="px-5 py-3">Conversas Concluídas</th>
                  <th className="px-5 py-3">TME de Resposta</th>
                  <th className="px-5 py-3">SLA Cumprido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sortedSectors.map((sec) => {
                  const volPct = Math.round(((sec.completed || 0) / maxSectorCompleted) * 100);
                  return (
                    <tr key={sec.name} className="hover:bg-muted/30 transition font-medium">
                      <td className="px-5 py-3 text-foreground font-bold">{sec.name}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-foreground font-extrabold tabular-nums w-10">{sec.completed}</span>
                          <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden hidden sm:block">
                            <div
                              className="h-full rounded-full bg-primary/75"
                              style={{ width: `${sec.completed > 0 ? Math.max(volPct, 4) : 0}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-foreground tabular-nums">
                        {sec.avgResponse === null ? (
                          <span className="text-muted-foreground">Sem amostra</span>
                        ) : (
                          formatDurationHuman(sec.avgResponse)
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {sec.slaPct === null ? (
                          <span className="text-muted-foreground">Sem amostra</span>
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden hidden sm:block">
                              <div
                                className={`h-full rounded-full ${
                                  sec.slaPct >= 90 ? "bg-primary" : "bg-muted-foreground"
                                }`}
                                style={{ width: `${Math.max(sec.slaPct, 3)}%` }}
                              />
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border tabular-nums ${
                                sec.slaPct >= 90
                                  ? "bg-primary/10 text-primary border-primary/20"
                                  : "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              {sec.slaPct}%
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// 2. Aba: SLA e Tempos
function SlaTab({
  overallSlaPct,
  overdueCount,
  totalSlaCount,
  withinSlaCount,
  overallAvgResponseSeconds,
  operators,
}: {
  overallSlaPct: number;
  overdueCount: number;
  totalSlaCount?: number;
  withinSlaCount?: number;
  overallAvgResponseSeconds?: number;
  operators: OperatorPerformance[];
}) {
  const avgSla = overallSlaPct;
  const [chartSortBy, setChartSortBy] = useState<"sla" | "volume">("sla");
  const [tableFilter, setTableFilter] = useState<"active" | "all">("active");
  const [tableSearch, setTableSearch] = useState("");
  const [tableSortField, setTableSortField] = useState<"chats" | "slaPct" | "avgResponseSeconds" | "name">("chats");
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("desc");

  // Operadores com atividade real (atendimentos ou amostra de SLA)
  const activeOperators = useMemo(
    () => operators.filter((op) => op.chats > 0 || (op.slaSampleCount ?? 0) > 0),
    [operators]
  );

  const inactiveCount = Math.max(0, operators.length - activeOperators.length);

  // Lista para o gráfico de ranking horizontal (apenas ativos se houver; senão todos)
  const chartOperators = useMemo(() => {
    const base = activeOperators.length > 0 ? [...activeOperators] : [...operators];
    return base.sort((a, b) => {
      if (chartSortBy === "sla") {
        if (b.slaPct !== a.slaPct) return b.slaPct - a.slaPct;
        return b.chats - a.chats;
      }
      if (b.chats !== a.chats) return b.chats - a.chats;
      return b.slaPct - a.slaPct;
    });
  }, [activeOperators, operators, chartSortBy]);

  // Cálculos consolidados para os mini-cards do Gauge
  const totalChatsAll = useMemo(
    () => operators.reduce((sum, op) => sum + (op.chats || 0), 0),
    [operators]
  );

  const computedWithinSla = useMemo(() => {
    if (typeof withinSlaCount === "number" && withinSlaCount > 0) return withinSlaCount;
    if (typeof totalSlaCount === "number" && totalSlaCount > 0) {
      return Math.max(0, totalSlaCount - overdueCount);
    }
    if (avgSla > 0 && overdueCount > 0 && avgSla < 100) {
      return Math.max(0, Math.round((overdueCount * avgSla) / (100 - avgSla)));
    }
    return totalChatsAll;
  }, [withinSlaCount, totalSlaCount, overdueCount, avgSla, totalChatsAll]);

  const computedOverallTme = useMemo(() => {
    if (typeof overallAvgResponseSeconds === "number" && overallAvgResponseSeconds > 0) {
      return overallAvgResponseSeconds;
    }
    const withTime = activeOperators.filter((op) => op.avgResponseSeconds > 0);
    if (withTime.length === 0) return 0;
    const weightedSum = withTime.reduce(
      (acc, op) => acc + op.avgResponseSeconds * Math.max(1, op.chats),
      0
    );
    const totalWeight = withTime.reduce((acc, op) => acc + Math.max(1, op.chats), 0);
    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }, [overallAvgResponseSeconds, activeOperators]);

  const onTargetOperatorsCount = useMemo(
    () => activeOperators.filter((op) => op.slaPct >= 90).length,
    [activeOperators]
  );
  const belowTargetOperatorsCount = Math.max(0, activeOperators.length - onTargetOperatorsCount);

  // Ordenação e filtro da tabela inferior
  const filteredTableOperators = useMemo(() => {
    const base =
      tableFilter === "active" && activeOperators.length > 0 ? [...activeOperators] : [...operators];
    const query = tableSearch.trim().toLowerCase();
    const searched = query ? base.filter((op) => op.name.toLowerCase().includes(query)) : base;

    return searched.sort((a, b) => {
      const dir = tableSortDir === "asc" ? 1 : -1;
      if (tableSortField === "name") {
        return a.name.localeCompare(b.name, "pt-BR") * dir;
      }
      // Manter quem tem 0 chats no final quando ordenando por métricas
      const aActive = a.chats > 0 ? 1 : 0;
      const bActive = b.chats > 0 ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;

      const valA = a[tableSortField] ?? 0;
      const valB = b[tableSortField] ?? 0;
      if (valA !== valB) return (valA - valB) * dir;
      return b.chats - a.chats;
    });
  }, [tableFilter, activeOperators, operators, tableSearch, tableSortField, tableSortDir]);

  const maxOperatorChats = useMemo(
    () => Math.max(1, ...operators.map((op) => op.chats || 0)),
    [operators]
  );

  const handleToggleSort = (field: "chats" | "slaPct" | "avgResponseSeconds" | "name") => {
    if (tableSortField === field) {
      setTableSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setTableSortField(field);
      setTableSortDir(field === "name" ? "asc" : "desc");
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 overflow-y-auto scrollbar-thin pr-1 pb-2">
      {/* 1. Card Esquerdo: Gauge Circular SLA Geral da Operação */}
      <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-foreground">SLA Geral da Operação</h3>
              <p className="text-[10px] text-muted-foreground">Chamados respondidos em até 15 minutos</p>
            </div>
          </div>

          <SystemTooltip content="Meta corporativa: mínimo de 90% dos ciclos respondidos dentro de 15 minutos.">
            <span className="text-[10px] font-bold text-muted-foreground bg-muted/50 px-2 py-1 rounded-lg border border-line shrink-0 cursor-default">
              Alvo ≥ 90%
            </span>
          </SystemTooltip>
        </div>

        {/* Medidor Circular Proporcional (0 a 100% real com marcador em 90%) */}
        <SlaPrecisionGauge pct={avgSla} targetPct={90} />

        {/* Grade 2x2 de Mini-KPIs de Contexto */}
        <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-line w-full">
          <div className="rounded-xl bg-muted/35 border border-line px-3 py-2 text-left">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
              Meta SLA
            </span>
            <span className="text-foreground font-black text-xs tabular-nums mt-0.5 block">
              15 min
            </span>
          </div>

          <div className="rounded-xl bg-muted/35 border border-line px-3 py-2 text-left">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
              TME Geral
            </span>
            <span className="text-foreground font-black text-xs tabular-nums mt-0.5 block">
              {formatDurationHuman(computedOverallTme)}
            </span>
          </div>

          <div className="rounded-xl bg-muted/35 border border-line px-3 py-2 text-left">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
              Dentro do Prazo
            </span>
            <span className="text-foreground font-black text-xs tabular-nums mt-0.5 block">
              {computedWithinSla} ciclos
            </span>
          </div>

          <div className="rounded-xl bg-primary/5 border border-primary/20 px-3 py-2 text-left">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
              Excedidos (&gt;15m)
            </span>
            <span className={`font-black text-xs tabular-nums mt-0.5 block ${overdueCount > 0 ? "text-primary" : "text-foreground"}`}>
              {overdueCount} chats
            </span>
          </div>
        </div>
      </div>

      {/* 2. Card Direito: Ranking Visual de Cumprimento de SLA por Operador */}
      <div className="xl:col-span-2 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[340px]">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Award className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-foreground">Cumprimento de SLA por Operador</h3>
              <p className="text-[10px] text-muted-foreground">
                Ranking de conformidade por agente ativo · Linha tracejada indica a meta de 90%
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeOperators.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5">
                <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20 tabular-nums">
                  {onTargetOperatorsCount} na meta
                </span>
                <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-muted text-muted-foreground border border-border tabular-nums">
                  {belowTargetOperatorsCount} em atenção
                </span>
              </div>
            )}

            {/* Alternador de Ordenação do Gráfico */}
            <div className="flex items-center bg-muted/40 p-0.5 rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setChartSortBy("sla")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  chartSortBy === "sla"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Por SLA %
              </button>
              <button
                type="button"
                onClick={() => setChartSortBy("volume")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  chartSortBy === "volume"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Por Volume
              </button>
            </div>
          </div>
        </div>

        {/* Régua de Escala Superior (0% — 25% — 50% — 75% — Meta 90% — 100%) */}
        {chartOperators.length > 0 ? (
          <div className="flex-1 flex flex-col justify-between mt-3">
            <div>
              <div className="flex items-center gap-3 px-2 pb-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                <div className="w-44 sm:w-52 shrink-0">Operador / Volume</div>
                <div className="flex-1 relative h-4 hidden sm:block">
                  <span className="absolute left-0 -translate-x-0">0%</span>
                  <span className="absolute left-1/4 -translate-x-1/2">25%</span>
                  <span className="absolute left-1/2 -translate-x-1/2">50%</span>
                  <span className="absolute left-3/4 -translate-x-1/2">75%</span>
                  <span className="absolute left-[90%] -translate-x-1/2 text-primary font-extrabold">
                    Meta 90%
                  </span>
                  <span className="absolute right-0">100%</span>
                </div>
                <div className="w-20 shrink-0 text-right">SLA %</div>
              </div>

              {/* Lista de Barras Horizontais com Scroll Suave */}
              <div className="space-y-1.5 max-h-[245px] overflow-y-auto scrollbar-thin pr-1">
                {chartOperators.map((op, index) => {
                  const isGoalMet = op.slaPct >= 90;
                  const isModerate = op.slaPct >= 70 && op.slaPct < 90;
                  const fillWidth = op.chats > 0 ? Math.max(op.slaPct, 3) : 0;

                  const barColorStyle = isGoalMet
                    ? "var(--primary)"
                    : isModerate
                    ? "color-mix(in srgb, var(--primary) 62%, var(--muted-foreground))"
                    : "var(--muted-foreground)";

                  const tooltipText = `${op.name} • SLA: ${op.slaPct}% • ${op.chats} atendimentos • TME: ${formatDurationHuman(
                    op.avgResponseSeconds
                  )}`;

                  return (
                    <SystemTooltip key={op.id || op.name} content={tooltipText} side="top">
                      <div className="flex items-center gap-3 px-2.5 py-2 rounded-xl bg-muted/20 hover:bg-muted/45 border border-transparent hover:border-line transition group">
                        {/* Identificação do Agente */}
                        <div className="w-44 sm:w-52 shrink-0 flex items-center gap-2.5 min-w-0">
                          <span
                            className={`h-5 w-5 rounded-md text-[10px] font-extrabold flex items-center justify-center shrink-0 border tabular-nums ${
                              isGoalMet
                                ? "bg-primary/15 text-primary border-primary/30"
                                : "bg-muted text-muted-foreground border-border"
                            }`}
                          >
                            {index + 1}
                          </span>
                          <OperatorAvatarBadge
                            name={op.name}
                            avatar={op.avatar}
                            highlight={isGoalMet}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-foreground truncate leading-tight">
                              {op.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate tabular-nums mt-0.5">
                              {op.chats} {op.chats === 1 ? "chat" : "chats"} · TME{" "}
                              {formatDurationHuman(op.avgResponseSeconds)}
                            </p>
                          </div>
                        </div>

                        {/* Trilha da Barra Horizontal + Linha de Meta 90% */}
                        <div className="flex-1 relative h-3.5 rounded-lg bg-muted/70 border border-border/60 overflow-hidden">
                          {/* Grades verticais discretas */}
                          <div className="absolute inset-y-0 left-1/4 border-l border-line/50 pointer-events-none" />
                          <div className="absolute inset-y-0 left-1/2 border-l border-line/50 pointer-events-none" />
                          <div className="absolute inset-y-0 left-3/4 border-l border-line/50 pointer-events-none" />

                          {/* Linha de Meta 90% */}
                          <div className="absolute inset-y-0 left-[90%] border-l-2 border-dashed border-primary/60 z-10 pointer-events-none" />

                          {/* Preenchimento da Barra */}
                          <div
                            className="h-full rounded-lg transition-all duration-500"
                            style={{
                              width: `${fillWidth}%`,
                              background: barColorStyle,
                            }}
                          />
                        </div>

                        {/* Percentual à Direita */}
                        <div className="w-20 shrink-0 flex items-center justify-end">
                          <span
                            className={`inline-flex items-center justify-center min-w-[48px] px-2 py-0.5 rounded-lg text-[11px] font-extrabold border tabular-nums ${
                              isGoalMet
                                ? "bg-primary/10 text-primary border-primary/25"
                                : isModerate
                                ? "bg-muted text-foreground border-border"
                                : "bg-muted/60 text-muted-foreground border-border"
                            }`}
                          >
                            {op.slaPct}%
                          </span>
                        </div>
                      </div>
                    </SystemTooltip>
                  );
                })}
              </div>
            </div>

            {/* Nota de Rodapé do Gráfico */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-3 border-t border-line text-[10px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Dentro da Meta (≥ 90%)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: "color-mix(in srgb, var(--primary) 62%, var(--muted-foreground))" }}
                  />
                  Atenção (70% – 89%)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                  Abaixo de 70%
                </span>
              </div>

              {inactiveCount > 0 && (
                <span>
                  Exibindo <strong>{activeOperators.length}</strong> operadores com atendimentos ({inactiveCount} sem volume ocultos)
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground">
            Nenhum operador com métricas de SLA registradas.
          </div>
        )}
      </div>

      {/* 3. Card Inferior: Tabela Executiva de Métricas de Tempo e SLA por Operador */}
      <div className="xl:col-span-3 bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-extrabold text-foreground">Métricas de Tempo e SLA por Operador</h3>
            <p className="text-[10px] text-muted-foreground">
              Visão detalhada e desagregada da performance operacional por consultor
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Busca Rápida de Operador */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Buscar agente..."
                className="h-8 pl-8 pr-3 rounded-xl bg-muted/40 border border-line text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 w-40 sm:w-48"
              />
            </div>

            {/* Filtro: Com Atendimentos vs. Todos */}
            <div className="flex items-center bg-muted/40 p-0.5 rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setTableFilter("active")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  tableFilter === "active"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Com atendimentos ({activeOperators.length})
              </button>
              <button
                type="button"
                onClick={() => setTableFilter("all")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  tableFilter === "all"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Todos ({operators.length})
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {filteredTableOperators.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Nenhum operador encontrado para o filtro selecionado.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-line">
                  <th className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleSort("name")}
                      className="inline-flex items-center gap-1 hover:text-foreground transition cursor-pointer font-semibold"
                    >
                      Agente
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleSort("chats")}
                      className="inline-flex items-center gap-1 hover:text-foreground transition cursor-pointer font-semibold"
                    >
                      Atendimentos
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleSort("avgResponseSeconds")}
                      className="inline-flex items-center gap-1 hover:text-foreground transition cursor-pointer font-semibold"
                    >
                      Tempo Médio de Resposta
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleSort("slaPct")}
                      className="inline-flex items-center gap-1 hover:text-foreground transition cursor-pointer font-semibold"
                    >
                      SLA Cumprido
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredTableOperators.map((op) => {
                  const hasActivity = op.chats > 0 || (op.slaSampleCount ?? 0) > 0;
                  const volumeSharePct =
                    totalChatsAll > 0 ? Math.round((op.chats / totalChatsAll) * 100) : 0;
                  const volumeBarPct = Math.round((op.chats / maxOperatorChats) * 100);
                  const isFastResponse =
                    op.avgResponseSeconds > 0 && op.avgResponseSeconds <= 15 * 60;
                  const isGoalMet = hasActivity && op.slaPct >= 90;

                  return (
                    <tr key={op.id || op.name} className="hover:bg-muted/30 transition font-medium">
                      {/* Coluna 1: Agente */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <OperatorAvatarBadge
                            name={op.name}
                            avatar={op.avatar}
                            highlight={isGoalMet}
                          />
                          <div>
                            <span className="text-foreground font-bold block leading-tight">
                              {op.name}
                            </span>
                            {!hasActivity && (
                              <span className="text-[10px] text-muted-foreground">
                                Sem atendimentos no período
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Coluna 2: Atendimentos + Barra Proporcional */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-foreground font-extrabold tabular-nums w-10">
                            {op.chats}
                          </span>
                          <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden hidden sm:block">
                            <div
                              className="h-full rounded-full bg-primary/75 transition-all duration-500"
                              style={{ width: `${op.chats > 0 ? Math.max(volumeBarPct, 4) : 0}%` }}
                            />
                          </div>
                          {op.chats > 0 && totalChatsAll > 0 && (
                            <span className="text-[10px] text-muted-foreground tabular-nums hidden md:inline">
                              ({volumeSharePct}%)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Coluna 3: Tempo Médio de Resposta Formatado */}
                      <td className="px-5 py-3">
                        {hasActivity && op.avgResponseSeconds > 0 ? (
                          <div className="flex items-center gap-2">
                            <span className="text-foreground font-bold tabular-nums">
                              {formatDurationHuman(op.avgResponseSeconds)}
                            </span>
                            <span
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-md border ${
                                isFastResponse
                                  ? "bg-primary/10 text-primary border-primary/20"
                                  : "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              {isFastResponse ? "≤ 15m" : "> 15m"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground font-mono text-xs">–</span>
                        )}
                      </td>

                      {/* Coluna 4: SLA Cumprido + Mini-Barra */}
                      <td className="px-5 py-3">
                        {hasActivity ? (
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden hidden sm:block">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${Math.max(op.slaPct, 3)}%`,
                                  background: isGoalMet
                                    ? "var(--primary)"
                                    : op.slaPct >= 70
                                    ? "color-mix(in srgb, var(--primary) 62%, var(--muted-foreground))"
                                    : "var(--muted-foreground)",
                                }}
                              />
                            </div>
                            <span
                              className={`inline-flex items-center justify-center min-w-[46px] px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border tabular-nums ${
                                isGoalMet
                                  ? "bg-primary/10 text-primary border-primary/25"
                                  : op.slaPct >= 70
                                  ? "bg-muted text-foreground border-border"
                                  : "bg-muted/60 text-muted-foreground border-border"
                              }`}
                            >
                              {op.slaPct}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground font-mono text-xs">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// 3. Aba: Clientes e Frequência
function ContactsTab({
  clientMetrics,
  avgDaysWithoutService,
  avgFrequency,
  ragConversionPct,
}: {
  clientMetrics: ClientMetric[];
  avgDaysWithoutService: number;
  avgFrequency: number;
  ragConversionPct: number;
}) {
  const totalNovos = useMemo(
    () => clientMetrics.reduce((sum, c) => sum + (c.novos || 0), 0),
    [clientMetrics]
  );
  const totalRecorrentes = useMemo(
    () => clientMetrics.reduce((sum, c) => sum + (c.recorrentes || 0), 0),
    [clientMetrics]
  );
  const totalClientesPeriodo = totalNovos + totalRecorrentes;
  const recorrenciaPct =
    totalClientesPeriodo > 0 ? Math.round((totalRecorrentes / totalClientesPeriodo) * 100) : 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 overflow-y-auto scrollbar-thin pr-1 pb-2">
      {/* Novos vs Recorrentes */}
      <div className="xl:col-span-2 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[320px]">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-foreground">Novos Clientes vs. Recorrentes</h3>
              <p className="text-[10px] text-muted-foreground">Aquisição de novos leads vs. retenção de contatos ativos</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="px-2.5 py-1 rounded-xl bg-muted/40 border border-line text-[10px] font-semibold text-muted-foreground">
              Novos: <span className="font-extrabold text-foreground tabular-nums">{totalNovos}</span>
            </div>
            <div className="px-2.5 py-1 rounded-xl bg-muted/40 border border-line text-[10px] font-semibold text-muted-foreground">
              Recorrentes: <span className="font-extrabold text-foreground tabular-nums">{totalRecorrentes}</span>
            </div>
            <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-xl border border-primary/20 tabular-nums">
              {recorrenciaPct}% retenção
            </span>
          </div>
        </div>

        <div className="flex-1 w-full h-[220px] mt-2">
          {clientMetrics.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientMetrics} margin={{ top: 10, right: 12, left: -20, bottom: 0 }} barGap={6}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip content={<SystemChartTooltip />} />
                <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11, fontWeight: 600 }} iconType="circle" />
                <Bar dataKey="novos" name="Novos Clientes" fill="var(--primary)" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                <Bar dataKey="recorrentes" name="Recorrentes" fill="var(--muted-foreground)" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Sem dados de aquisição de contatos nas últimas semanas.
            </div>
          )}
        </div>
      </div>

      {/* Cartões Estatísticos de Contato */}
      <div className="space-y-4 flex flex-col justify-between">
        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex items-start gap-3.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
            <Clock className="h-4.5 w-4.5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Tempo Médio Sem Atendimento
            </span>
            <p className="text-2xl font-black text-foreground mt-0.5 tabular-nums">
              {avgDaysWithoutService > 0 ? `${avgDaysWithoutService} dias` : "–"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Média desde o último atendimento finalizado
            </p>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex items-start gap-3.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
            <RefreshCw className="h-4.5 w-4.5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Frequência Média
            </span>
            <p className="text-2xl font-black text-foreground mt-0.5 tabular-nums">
              {avgFrequency > 0 ? `${avgFrequency} vezes/mês` : "–"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Contatos recorrentes que reabrem conversas
            </p>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft">
          <div className="flex items-start gap-3.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Star className="h-4.5 w-4.5" />
            </div>
            <div className="flex-1">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Taxa de Conversão RAG / CSAT
              </span>
              <p className="text-2xl font-black text-foreground mt-0.5 tabular-nums">
                {ragConversionPct}%
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Satisfação estimada em auditorias de contatos recorrentes
              </p>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mt-2.5">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, ragConversionPct))}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 4. Aba: Relatórios Automáticos de IA
function ReportsTab({ reports, loading }: { reports: AiReportData[]; loading: boolean }) {
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  useEffect(() => {
    if (reports.length > 0 && !selectedReportId) {
      setSelectedReportId(reports[0].id);
    }
  }, [reports, selectedReportId]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  const selectedReport = reports.find((r) => r.id === selectedReportId) || reports[0];

  return (
    <div className="flex gap-5 h-full overflow-hidden">
      {/* Lateral: Lista de Relatórios */}
      <div className="w-60 shrink-0 flex flex-col gap-2 overflow-y-auto scrollbar-thin pr-1">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-2 block mb-1">
          Histórico de Relatórios
        </span>
        {reports.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground border border-dashed border-border rounded-xl text-center">
            Nenhum relatório de IA gerado ainda. Os relatórios são compilados diariamente às 18h.
          </div>
        ) : (
          reports.map((rep) => (
            <button
              key={rep.id}
              onClick={() => setSelectedReportId(rep.id)}
              className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                selectedReportId === rep.id
                  ? "border-primary bg-primary-soft/50 text-primary font-bold shadow-soft"
                  : "border-border bg-card text-foreground hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="capitalize">{rep.type === "weekly" ? "Semanal" : "Diário"}</span>
                <span className="text-[9px] text-muted-foreground font-mono">
                  {rep.period}
                </span>
              </div>
              <p className="text-[9px] text-muted-foreground/80">
                Gerado em: {new Date(rep.generatedAt).toLocaleDateString("pt-BR")}
              </p>
            </button>
          ))
        )}
      </div>

      {/* Principal: Visualizador Markdown */}
      <div className="flex-1 bg-card rounded-2xl border border-border shadow-soft p-6 overflow-y-auto scrollbar-thin">
        {selectedReport ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                  selectedReport.type === "weekly" ? "bg-primary/10 text-primary border border-primary/20" : "bg-muted text-foreground border border-border"
                }`}>
                  Relatório {selectedReport.type === "weekly" ? "Semanal" : "Diário"}
                </span>
                <span className="text-[10px] text-muted-foreground ml-2">Período: {selectedReport.period}</span>
              </div>
              
              <span className="text-[9px] text-muted-foreground font-medium">
                Sincronizado via IA em {new Date(selectedReport.generatedAt).toLocaleString("pt-BR")}
              </span>
            </div>

            {/* Renderizador de Markdown */}
            <div className="space-y-3 font-sans">
              {parseMarkdown(selectedReport.reportMarkdown)}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            Selecione um relatório para visualizar.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componente Principal ─────────────────────────────────────────────────────
export function AnalyticsView() {
  const { tenant } = useChat();
  const { canAccessAnalyticsTab } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [performanceError, setPerformanceError] = useState<string | null>(null);

  // Estados para dados reais das abas
  const [overview, setOverview] = useState<any | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [audits, setAudits] = useState<any[]>([]);

  const [performanceData, setPerformanceData] = useState<{
    volumes: HistoricalVolume[];
    channels: ChannelVolume[];
    sectors: SectorPerformance[];
  }>({
    volumes: [],
    channels: [],
    sectors: [],
  });

  const [slaData, setSlaData] = useState<{
    overallSlaPct: number;
    overdueCount: number;
    totalSlaCount?: number;
    withinSlaCount?: number;
    overallAvgResponseSeconds?: number;
    operators: OperatorPerformance[];
  }>({
    overallSlaPct: 100,
    overdueCount: 0,
    totalSlaCount: 0,
    withinSlaCount: 0,
    overallAvgResponseSeconds: 0,
    operators: [],
  });

  const [contactsData, setContactsData] = useState<{
    clientMetrics: ClientMetric[];
    avgDaysWithoutService: number;
    avgFrequency: number;
    ragConversionPct: number;
  }>({
    clientMetrics: [],
    avgDaysWithoutService: 0,
    avgFrequency: 0,
    ragConversionPct: 100,
  });

  const [reports, setReports] = useState<AiReportData[]>([]);

  const [lcMetrics, setLcMetrics] = useState<{
    totalChats: number;
    activeSessions: number;
    bridgesWhatsapp: number;
    avgScore: number;
    conversionRate: number;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setPerformanceError(null);
    try {
      // Buscar dados reais de todas as APIs do módulo de estatísticas em paralelo
      const [ovRes, alRes, auRes, perfRes, slaRes, contRes, repRes] = await Promise.all([
        fetch(`/api/gestao/overview?tenantId=${tenant}`),
        fetch(`/api/gestao/alerts?tenantId=${tenant}`),
        fetch(`/api/gestao/audits?tenantId=${tenant}&limit=50`),
        fetch(`/api/gestao/performance?tenantId=${tenant}`),
        fetch(`/api/gestao/sla?tenantId=${tenant}`),
        fetch(`/api/gestao/contacts-analytics?tenantId=${tenant}`),
        fetch(`/api/gestao/reports?tenantId=${tenant}`),
      ]);

      if (ovRes.ok) setOverview(await ovRes.json());
      if (alRes.ok) setAlerts(await alRes.json());
      if (auRes.ok) setAudits(await auRes.json());

      if (perfRes.ok) {
        const pData = await perfRes.json();
        setPerformanceData({
          volumes: pData.volumes || [],
          channels: pData.channels || [],
          sectors: pData.sectors || [],
        });
      } else {
        setPerformanceData({ volumes: [], channels: [], sectors: [] });
        setPerformanceError("Indicadores de desempenho indisponíveis. Tente atualizar novamente.");
      }

      if (slaRes.ok) {
        const sData = await slaRes.json();
        setSlaData({
          overallSlaPct: sData.overallSlaPct ?? 100,
          overdueCount: sData.overdueCount ?? 0,
          totalSlaCount: sData.totalSlaCount,
          withinSlaCount: sData.withinSlaCount,
          overallAvgResponseSeconds: sData.overallAvgResponseSeconds,
          operators: sData.operators || [],
        });
      }

      if (contRes.ok) {
        const cData = await contRes.json();
        setContactsData({
          clientMetrics: cData.clientMetrics || [],
          avgDaysWithoutService: cData.avgDaysWithoutService ?? 0,
          avgFrequency: cData.avgFrequency ?? 0,
          ragConversionPct: cData.ragConversionPct ?? 100,
        });
      }

      if (repRes.ok) {
        const rData = await repRes.json();
        if (Array.isArray(rData)) setReports(rData);
      }

      setLastRefresh(new Date());
    } catch (e) {
      console.error("[AnalyticsView] Erro ao carregar dados reais de BI:", e);
      setPerformanceData({ volumes: [], channels: [], sectors: [] });
      setPerformanceError("Não foi possível atualizar os indicadores de desempenho.");
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const load = async () => {
      try {
        const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";
        const res = await fetch(`${BACKEND_URL}/api/livechat/metrics?tenantId=${tenant}&hours=24`);
        if (res.ok) setLcMetrics(await res.json());
      } catch {}
    };
    load();
  }, [tenant]);

  const allTabs: { id: AnalyticsTab; label: string; icon: React.ElementType }[] = [
    { id: "overview",     label: "Visão Geral",   icon: Eye },
    { id: "performance",  label: "Desempenho",     icon: BarChart2 },
    { id: "sla",          label: "SLA & Tempos",   icon: Clock },
    { id: "contacts",     label: "Clientes",       icon: Users },
    { id: "reports",      label: "Relatórios IA",  icon: FileText },
    { id: "costs",        label: "Custos",         icon: Coins },
  ];

  const allowedTabs = allTabs.filter(t => canAccessAnalyticsTab(t.id));
  const allowedTabIds = useMemo(() => allowedTabs.map((t) => t.id), [allowedTabs]);
  const [activeTab, setActiveTab] = useState<AnalyticsTab>(() =>
    getInitialTabFromUrl("analytics", allowedTabs[0]?.id || "overview", allowedTabIds),
  );

  useTabNavigation({
    tabs: allowedTabIds,
    activeTab,
    onChange: setActiveTab,
  });

  useSyncModuleTabWithUrl({
    viewId: "analytics",
    activeTab,
    setActiveTab,
    allowedTabs: allowedTabIds,
  });

  const [costViewMode, setCostViewMode] = useState<"ai" | "meta">("ai");

  useEffect(() => {
    if (!allowedTabs.some(t => t.id === activeTab)) {
      if (allowedTabs.length > 0) {
        setActiveTab(allowedTabs[0].id);
      }
    }
  }, [allowedTabs, activeTab]);

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3.5 md:py-4 border-b border-line shrink-0">
        <div>
          <h1 className="text-base font-extrabold text-foreground flex items-center gap-2">
            <BarChart2 className="h-4.5 w-4.5 text-primary" />
            Estatísticas da Operação
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">Análise e BI de performance histórica consolidada</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {activeTab === "costs" && (
            <SystemTooltip
              content={
                costViewMode === "meta"
                  ? "Alternar para Custos de I.A. (Vertex AI)"
                  : "Custos WhatsApp (Meta Oficial API)"
              }
              side="bottom"
            >
              <button
                type="button"
                onClick={() => setCostViewMode((prev) => (prev === "ai" ? "meta" : "ai"))}
                aria-label={
                  costViewMode === "meta"
                    ? "Alternar para Custos de I.A. (Vertex AI)"
                    : "Ver Custos WhatsApp (Meta Oficial API)"
                }
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  costViewMode === "meta"
                    ? "bg-primary text-primary-foreground border-primary shadow-soft"
                    : "bg-muted/40 border-line text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5"
                }`}
              >
                <WhatsappLogo className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline text-[11px]">
                  {costViewMode === "meta" ? "Meta Oficial API" : "Custos Meta API"}
                </span>
              </button>
            </SystemTooltip>
          )}
          <SystemTooltip content="Atualizar agora" side="bottom">
            <button
              type="button"
              onClick={fetchData}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition cursor-pointer shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
              {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Interna Tab Bar */}
      <div className="flex items-center gap-1 px-3 md:px-5 py-2.5 border-b border-line bg-muted/30 shrink-0 overflow-x-auto scrollbar-none">
        {allowedTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 whitespace-nowrap relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "reports" ? (
        <ReportsIATab tenant={tenant} refreshTrigger={lastRefresh.getTime()} />
      ) : (
        <div className="flex-1 overflow-y-auto md:overflow-hidden px-3 md:px-5 py-4 flex flex-col">
          {activeTab === "overview" && (
            <>
              <OverviewTab
                overview={overview}
                alerts={alerts}
                audits={audits}
                onSwitchTab={() => {}}
              />

              {/* ─── SEÇÃO LIVE CHAT ────────────────────────────────────────────────── */}
              {lcMetrics !== null && (
                <div className="rounded-2xl bg-card border border-border p-6 shadow-soft mt-5">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
                      <Globe className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-foreground">Live Chat (Site)</h3>
                      <p className="text-xs text-muted-foreground">Atendimentos via widget — últimas 24h</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {([
                      { label: "Sessões",        value: lcMetrics.totalChats,      icon: MessageSquare },
                      { label: "Ativas agora",   value: lcMetrics.activeSessions,  icon: Activity },
                      { label: "Bridges WA",     value: lcMetrics.bridgesWhatsapp, icon: Phone },
                      { label: "Score médio",    value: lcMetrics.avgScore,        icon: TrendingUp },
                      { label: "Conversão",      value: `${lcMetrics.conversionRate}%`, icon: Zap },
                    ] as const).map(({ label, value, icon: Icon }) => (
                      <div key={label} className="rounded-xl bg-muted/40 p-4 border border-border/50">
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="h-3.5 w-3.5 text-primary" />
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
                        </div>
                        <p className="text-2xl font-extrabold text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === "performance" && (
            performanceError ? <div role="alert" className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">{performanceError}</div> :
            <PerformanceTab
              volumes={performanceData.volumes}
              channels={performanceData.channels}
              sectors={performanceData.sectors}
            />
          )}
          {activeTab === "sla" && (
            <SlaTab
              overallSlaPct={slaData.overallSlaPct}
              overdueCount={slaData.overdueCount}
              totalSlaCount={slaData.totalSlaCount}
              withinSlaCount={slaData.withinSlaCount}
              overallAvgResponseSeconds={slaData.overallAvgResponseSeconds}
              operators={slaData.operators}
            />
          )}
          {activeTab === "contacts" && (
            <ContactsTab
              clientMetrics={contactsData.clientMetrics}
              avgDaysWithoutService={contactsData.avgDaysWithoutService}
              avgFrequency={contactsData.avgFrequency}
              ragConversionPct={contactsData.ragConversionPct}
            />
          )}
          {activeTab === "costs" && (
            <CostsTab
              tenant={tenant}
              costViewMode={costViewMode}
              onChangeCostViewMode={setCostViewMode}
            />
          )}
        </div>
      )}
    </div>
  );
}
