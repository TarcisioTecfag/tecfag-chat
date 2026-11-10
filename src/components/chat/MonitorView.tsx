import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, SystemTooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useChat } from "@/hooks/useChatState";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import {
  Eye, AlertTriangle, Clock, Users, TrendingUp, TrendingDown,
  RefreshCw, ChevronRight, Minus, CheckCircle, XCircle,
  MessageSquare, BarChart2, Bell, Zap, FlaskConical,
  Activity, Search, ClipboardCheck, ChevronLeft, Phone,
  Mail, Calendar, CheckCircle2, Circle, ExternalLink,
  Loader2, X, Filter, Coins, DollarSign, Cpu, Layers, Bot, Sparkles, ShieldCheck,
  Play, Volume2, FileText, Radio, ChevronDown, Globe,
  Smile, Meh, Frown, Briefcase, Building2, Lock, Send,
  CornerUpLeft, Check, CheckCheck, LayoutDashboard, Flame, ArrowLeft,
  ArrowRightLeft, RotateCcw, Image as ImageIcon, Video as VideoIcon,
  Tag, Paperclip, PenTool, Timer, User, UserCheck,
  Utensils, MapPin, Columns3, ListTodo, Pencil, Trash2, Ban, CalendarClock, Plus, Target
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { getAiPersona } from "@/lib/ai-persona";
import { formatMetaErrorMessagePt } from "@/lib/whatsapp/meta-template-common";
import { DealDetailModal } from "@/components/crm/DealDetailModal";
import { CreateTaskModal, type EditingTaskData } from "@/components/crm/CreateTaskModal";
import { CrmDatePicker } from "@/components/crm/CrmDatePicker";
import { SystemDateTimePicker } from "@/components/ui/system-date-time-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MOCK_LIVE,
  MOCK_OVERVIEW,
  MOCK_ALERTS,
  MOCK_AUDITS,
  MOCK_GLOBAL_TASKS_RESPONSE,
  LiveOperator,
  LiveConversation,
  LiveData,
  LiveMessage,
  LivePipelineOption,
  LiveTaskItem,
  AlertItem,
  AlertOperatorBottleneck,
  AlertsExecutiveSummary,
  AlertCategoryTag,
  AuditDirectorReview,
  AuditItem,
  AuditLearnedRuleItem,
  AuditStatusCounts,
  AuditOperatorRankingItem,
  AuditsExecutiveSummary,
  GlobalTaskItem,
  GlobalTaskOperatorBreakdown,
  GlobalTasksExecutiveSummary,
} from "@/lib/monitor-mock-data";
import { useNavigate } from "@tanstack/react-router";
import { OperatorsRankingTab } from "./OperatorsRankingTab";
import { SiteVisitorsTab } from "./SiteVisitorsTab";
import { WhatsappLogo } from "./ChatList";
import { usePermissions } from "@/hooks/usePermissions";
import { AudioWithSpeed } from "@/components/ui/audio-with-speed";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  Cell,
} from "recharts";

// ══════════════════════════════════════════════════════════════════════════════
// DEMO MODE — troque para false para usar dados reais da API
// ══════════════════════════════════════════════════════════════════════════════
const DEMO_MODE = false;

// ── Tipos ───────────────────────────────────────────────────────────────────
type MonitorTab = "live" | "alerts" | "operators" | "audits" | "tasks" | "site";

type OverviewData = {
  today: string;
  activeConversations: number;
  overdueAlerts: number;
  avgResponseTimeFormatted: string;
  teamPerformanceScore: number | null;
  operators: OperatorMetric[];
};

type OperatorMetric = {
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

// ── Helpers ──────────────────────────────────────────────────────────────────
function TrafficDot({ light }: { light: "green" | "yellow" | "red" | "gray" }) {
  const colors = {
    green: "bg-primary",
    yellow: "bg-muted-foreground",
    red: "bg-primary",
    gray: "bg-muted-foreground/40",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colors[light]} ${
        light === "red" ? "animate-pulse" : ""
      }`}
    />
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">–</span>;
  const color =
    score >= 75
      ? "text-primary bg-primary/10 border border-primary/20"
      : "text-muted-foreground bg-muted border border-border";
  return (
    <span className={`inline-flex items-center justify-center h-7 w-12 rounded-lg text-xs font-extrabold ${color}`}>
      {score}
    </span>
  );
}

function ScoreGauge({ score, size = 140 }: { score: number | null; size?: number }) {
  if (score === null) return <span className="text-xs text-muted-foreground">–</span>;
  
  const [animatedScore, setAnimatedScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const [uuid] = useState(() => Math.random().toString(36).substring(2, 9));
  
  useEffect(() => {
    // Animar o arco com um leve delay para percepção visual da transição
    const animTimer = setTimeout(() => {
      setAnimatedScore(score);
    }, 80);
    
    // Animar o contador numérico usando requestAnimationFrame
    let startTimestamp: number | null = null;
    const duration = 1000; // 1s de animação fluida
    const startVal = 0;
    
    let animationFrameId: number;
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      // Easing out cubic para desaceleração suave no fim
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.floor(easeProgress * (score - startVal) + startVal));
      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      }
    };
    animationFrameId = window.requestAnimationFrame(step);
    
    return () => {
      clearTimeout(animTimer);
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [score]);

  // Se o tamanho for menor (ex: 90px), usamos dimensões menores para o arco
  const isSmall = size < 110;
  const r = isSmall ? 32 : 35;
  const strokeWidth = isSmall ? 8 : 9;
  const cx = 50;
  const cy = isSmall ? 42 : 40;
  const totalLength = Math.PI * r;
  const offset = totalLength - (Math.min(Math.max(animatedScore, 0), 100) / 100) * totalLength;
  
  // Coordenadas da bolinha indicadora na ponta do arco usando trigonometria
  const percent = Math.min(Math.max(animatedScore, 0), 100) / 100;
  const angle = Math.PI - (percent * Math.PI);
  const indicatorX = cx + r * Math.cos(angle);
  const indicatorY = cy - r * Math.sin(angle);
  
  // Identificação do Gradiente Único
  const getGradientId = () => {
    if (score >= 75) return `primaryGrad-${uuid}`;
    return `mutedGrad-${uuid}`;
  };
  
  const color = score >= 75 ? "var(--primary)" : "var(--muted-foreground)";
    
  const fontSizeClass = isSmall ? "text-[13px]" : "text-[18px]";
  const indicatorRadius = isSmall ? 4.5 : 6;
  const indicatorStroke = isSmall ? 2 : 3;
    
  return (
    <div className="relative flex flex-col items-center justify-center shrink-0" style={{ width: size, height: size * 0.62 }}>
      <svg viewBox="0 0 100 52" className="w-full h-full overflow-visible">
        <defs>
          {/* Definições de Gradientes Lineares Nativos */}
          <linearGradient id={`primaryGrad-${uuid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--primary)" />
          </linearGradient>
          <linearGradient id={`mutedGrad-${uuid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--muted-foreground)" />
            <stop offset="100%" stopColor="var(--muted-foreground)" />
          </linearGradient>
          
          {/* Sombra de Glow para o arco e indicador */}
          <filter id={`shadowGlow-${uuid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={color} floodOpacity="0.3" />
          </filter>
        </defs>
        
        {/* Arco de fundo (trilho cinza) */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="text-muted/30"
        />
        
        {/* Arco de progresso com gradiente e glow */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={`url(#${getGradientId()})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={totalLength}
          strokeDashoffset={offset}
          filter={`url(#shadowGlow-${uuid})`}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)" }}
        />
        
        {/* Bolinha indicadora brilhante no final do progresso */}
        {animatedScore > 0 && (
          <circle
            cx={indicatorX}
            cy={indicatorY}
            r={indicatorRadius}
            fill="var(--card)"
            stroke={color}
            strokeWidth={indicatorStroke}
            filter={`url(#shadowGlow-${uuid})`}
            className="transition-all duration-1000 ease-out"
          />
        )}
      </svg>
      {/* Texto no centro/baixo */}
      <span className={`absolute bottom-0 font-black text-foreground animate-in fade-in zoom-in-75 duration-300 ${fontSizeClass}`} style={{ transform: "translateY(-1px)" }}>
        {displayScore}
      </span>
    </div>
  );
}

function WaitBadge({ minutes, isCritical }: { minutes: number; isCritical: boolean }) {
  const color = isCritical
    ? "text-primary bg-primary/10 border border-primary/20"
    : minutes >= 10
    ? "text-foreground bg-muted border border-border"
    : "text-muted-foreground bg-muted/60 border border-border";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${color}`}>
      <Clock className="h-3 w-3" />
      {formatWaitDuration(minutes)}
    </span>
  );
}

function Avatar({ name, avatar, size = "md" }: { name: string; avatar?: string | null; size?: "sm" | "md" | "lg" | "xl" }) {
  const initials = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const [imgError, setImgError] = React.useState(false);
  const sizes = { 
    sm: "h-7 w-7 text-[10px]", 
    md: "h-9 w-9 text-xs", 
    lg: "h-11 w-11 text-sm",
    xl: "h-16 w-16 text-lg" 
  };
  if (avatar && !imgError) {
    return (
      <SystemTooltip content={name}>
        <img
          src={avatar}
          alt={name}
          className={`${sizes[size]} rounded-full object-cover shrink-0 border border-border`}
          onError={() => setImgError(true)}
        />
      </SystemTooltip>
    );
  }
  return (
    <SystemTooltip content={name}>
      <div className={`${sizes[size]} rounded-full bg-primary/15 text-primary font-extrabold flex items-center justify-center shrink-0`}>
        {initials}
      </div>
    </SystemTooltip>
  );
}

// ── Sub-views ────────────────────────────────────────────────────────────────

export function OverviewTab({
  overview,
  alerts,
  audits,
  onSwitchTab,
}: {
  overview: OverviewData | null;
  alerts: AlertItem[];
  audits: AuditItem[];
  onSwitchTab: (tab: MonitorTab) => void;
}) {
  if (!overview) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-7 w-7 animate-spin opacity-40" />
          <span className="text-sm">Carregando dados da operação...</span>
        </div>
      </div>
    );
  }

  // Função utilitária para converter "2h 23min", "2min 45s" ou similar em minutos decimais
  const parseTimeToMinutes = (timeStr: string, rawSeconds?: number): number => {
    if (typeof rawSeconds === "number" && Number.isFinite(rawSeconds) && rawSeconds > 0) {
      return Number((rawSeconds / 60).toFixed(2));
    }
    if (!timeStr) return 0;
    const hourMatch = timeStr.match(/(\d+)\s*h/i);
    const minMatch = timeStr.match(/(\d+)\s*(?:min|m(?!s))/i);
    const secMatch = timeStr.match(/(\d+)\s*s/i);
    const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
    const min = minMatch ? parseInt(minMatch[1], 10) : 0;
    const sec = secMatch ? parseInt(secMatch[1], 10) : 0;
    return Number((hours * 60 + min + sec / 60).toFixed(2));
  };

  // 1. Dados do gráfico de performance e tempo de resposta da equipe (filtra operadores sem atividade quando há ativos)
  const operatorsWithActivity = overview.operators.filter(
    (op) =>
      (op.totalConversations ?? 0) > 0 ||
      (op.avgPerformanceScore ?? 0) > 0 ||
      parseTimeToMinutes(op.avgResponseTimeFormatted, (op as any).avgResponseTimeSeconds) > 0
  );
  const operatorsForChart =
    operatorsWithActivity.length > 0 ? operatorsWithActivity : overview.operators.slice(0, 8);

  const chartDataEquipe = operatorsForChart.map((op) => ({
    name:
      op.operatorName.split(" ")[0] +
      (op.operatorName.split(" ")[1] ? " " + op.operatorName.split(" ")[1][0] + "." : ""),
    score: op.avgPerformanceScore || 0,
    tmr: parseTimeToMinutes(op.avgResponseTimeFormatted, (op as any).avgResponseTimeSeconds),
  }));

  // 2. Dados do gráfico de alertas críticos
  const chartDataAlertas = alerts.slice(0, 6).map((al) => {
    const fullName = (al.contactName || "Cliente").trim();
    const shortName = fullName.length > 18 ? `${fullName.slice(0, 17).trimEnd()}…` : fullName;
    const waitMin = Number((al.waitingMinutes + (al.waitingSeconds || 0) / 60).toFixed(1));
    return {
      cliente: shortName,
      clienteCompleto: fullName,
      espera: waitMin,
    };
  });

  const metricCards = [
    {
      label: "Conversas Ativas",
      value: overview.activeConversations,
      icon: MessageSquare,
      color: "text-primary bg-primary/10",
    },
    {
      label: "Aguardando Resposta",
      value: overview.overdueAlerts,
      icon: AlertTriangle,
      color: "text-primary bg-primary/10",
      pulse: overview.overdueAlerts > 0,
    },
    {
      label: "Tempo Médio Hoje",
      value: overview.avgResponseTimeFormatted,
      icon: Clock,
      color: "text-primary bg-primary/10",
      isText: true,
    },
    {
      label: "Score da Equipe",
      value: overview.teamPerformanceScore !== null ? `${overview.teamPerformanceScore}/100` : "–",
      icon: BarChart2,
      color: "text-primary bg-primary/10",
      isText: true,
    },
  ];

  return (
    <div className="flex flex-col gap-5 overflow-y-auto scrollbar-thin pr-1">
      {/* Metric Cards */}
      <div className="grid grid-cols-4 gap-4 shrink-0">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col gap-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {card.label}
                </span>
                <div className={`h-8 w-8 rounded-xl flex items-center justify-center ${card.color}`}>
                  <Icon className={`h-4 w-4 ${card.pulse ? "animate-pulse" : ""}`} />
                </div>
              </div>
              <p className="text-2xl font-extrabold text-foreground leading-none">
                {card.isText ? card.value : card.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-5 gap-4 shrink-0">
        {/* Performance vs Response Time Chart */}
        <div className="col-span-3 bg-card rounded-2xl border border-border shadow-soft p-4 flex flex-col justify-between h-72">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground mb-3 block">
            Performance vs. Tempo de Resposta da Equipe
          </span>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartDataEquipe} margin={{ top: 10, right: -5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} />
                <YAxis yAxisId="left" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} domain={[0, 100]} />
                <YAxis yAxisId="right" orientation="right" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} unit="m" />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: "var(--card)", borderColor: "var(--border)", borderRadius: "12px", fontSize: "11px", color: "var(--foreground)" }}
                />
                <Legend verticalAlign="top" height={36} iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                <Bar yAxisId="left" dataKey="score" name="Score de Qualidade" fill="var(--primary)" radius={[4, 4, 0, 0]} barSize={16} isAnimationActive={false} />
                <Line yAxisId="right" type="monotone" dataKey="tmr" name="TMR Médio (min)" stroke="var(--muted-foreground)" strokeWidth={2} dot={{ r: 3, fill: "var(--foreground)", stroke: "var(--muted-foreground)" }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Critical Alerts Wait Time Chart */}
        <div className="col-span-2 bg-card rounded-2xl border border-border shadow-soft p-4 flex flex-col justify-between h-72">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground mb-3 block">
            Tempo de Espera dos Casos Críticos (Minutos)
          </span>
          <div className="flex-1 min-h-0">
            {chartDataAlertas.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1">
                <CheckCircle className="h-6 w-6 text-primary" />
                <span className="text-xs">Fila zerada no momento</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartDataAlertas} layout="vertical" margin={{ top: 5, right: 12, left: 4, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                  <XAxis
                    type="number"
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                    tickLine={false}
                    tickFormatter={(v: number) =>
                      v >= 1440
                        ? `${Math.round(v / 1440)}d`
                        : v >= 60
                        ? `${Math.round(v / 60)}h`
                        : `${Math.round(v)}m`
                    }
                  />
                  <YAxis dataKey="cliente" type="category" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} width={105} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "var(--card)", borderColor: "var(--border)", borderRadius: "12px", fontSize: "11px", color: "var(--foreground)" }}
                    labelFormatter={(_label, payload) => payload?.[0]?.payload?.clienteCompleto || _label}
                    formatter={(val: any) => [formatWaitDuration(Math.round(Number(val) || 0)), "Tempo de Espera"]}
                  />
                  <Bar dataKey="espera" name="Minutos de Espera" radius={[0, 4, 4, 0]} barSize={12} isAnimationActive={false}>
                    {chartDataAlertas.map((entry, index) => {
                      const color = entry.espera >= 15 ? "var(--primary)" : "var(--muted-foreground)";
                      return <Cell key={`cell-${index}`} fill={color} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Middle Row */}
      <div className="grid grid-cols-5 gap-4 shrink-0 min-h-[240px] max-h-[320px]">
        {/* Critical Alerts */}
        <div className="col-span-3 bg-card rounded-2xl border border-border shadow-soft flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-sm font-extrabold text-foreground">Alertas Críticos</span>
            </div>
            <button
              onClick={() => onSwitchTab("alerts")}
              className="flex items-center gap-1 text-xs text-primary font-semibold hover:opacity-75 transition cursor-pointer"
            >
              Ver todos <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground gap-2">
                <CheckCircle className="h-8 w-8 text-primary" />
                <span className="text-sm font-medium">Nenhum cliente aguardando</span>
              </div>
            ) : (
              alerts.slice(0, 6).map((alert, i) => (
                <div
                  key={alert.logId}
                  className={`flex items-center gap-3 px-5 py-3 ${
                    i < alerts.length - 1 ? "border-b border-line" : ""
                  } hover:bg-muted/50 transition`}
                >
                  {alert.isCritical && (
                    <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                  )}
                  <Avatar name={alert.contactName} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">{alert.contactName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">via {alert.operatorName}</p>
                  </div>
                  <WaitBadge minutes={alert.waitingMinutes} isCritical={alert.isCritical} />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Team Today */}
        <div className="col-span-2 bg-card rounded-2xl border border-border shadow-soft flex flex-col overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line shrink-0">
            <span className="text-sm font-extrabold text-foreground">Equipe Hoje</span>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {overview.operators.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Nenhum operador online
              </div>
            ) : (
              overview.operators.map((op, i) => (
                <div
                  key={op.operatorId}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    i < overview.operators.length - 1 ? "border-b border-line" : ""
                  }`}
                >
                  <Avatar name={op.operatorName} avatar={(op as any).operatorAvatar} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">{op.operatorName}</p>
                    <p className="text-[10px] text-muted-foreground">{op.avgResponseTimeFormatted} média</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ScoreBadge score={op.avgPerformanceScore} />
                    <TrafficDot light={op.trafficLight} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Auditorias IA — mostra as últimas ou estado vazio */}
      <div className="bg-card rounded-2xl border border-border shadow-soft shrink-0">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <span className="text-sm font-extrabold text-foreground">Últimas Auditorias IA</span>
          <button
            onClick={() => onSwitchTab("audits")}
            className="flex items-center gap-1 text-xs text-primary font-semibold hover:opacity-75 transition cursor-pointer"
          >
            Ver todas <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {audits.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground gap-3">
            <Zap className="h-4 w-4 text-primary/40" />
            <span className="text-sm">Nenhuma auditoria concluída ainda hoje — finalize atendimentos para gerar</span>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {audits.filter((a) => a.performanceScore !== null).slice(0, 4).map((audit) => (
              <div key={audit.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40 transition">
                <Avatar name={audit.contactName || "?"} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground truncate">{audit.contactName || "Contato"}</p>
                  <p className="text-[10px] text-muted-foreground truncate">via {audit.operatorName}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ScoreBadge score={audit.performanceScore} />
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border inline-flex items-center gap-1 ${
                    audit.clientSentiment === "satisfeito"
                      ? "text-primary bg-primary/10 border-primary/20"
                      : "text-muted-foreground bg-muted border-border"
                  }`}>
                    {audit.clientSentiment === "satisfeito" ? <Smile className="h-3 w-3" /> : audit.clientSentiment === "frustrado" ? <Frown className="h-3 w-3" /> : <Meh className="h-3 w-3" />}
                    <span className="capitalize">{audit.clientSentiment || "neutro"}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type AlertFilterCategory =
  | "all"
  | "critical"
  | "warning"
  | "queue"
  | "conflict"
  | "meta_window"
  | "delivery";

type AlertSortMode =
  | "severity"
  | "wait_desc"
  | "wait_asc"
  | "deal_value"
  | "meta_window";

function AlertsSortSelect({
  value,
  onChange,
}: {
  value: AlertSortMode;
  onChange: (v: AlertSortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const options: { id: AlertSortMode; label: string }[] = [
    { id: "severity", label: "Maior Criticidade (Padrão)" },
    { id: "wait_desc", label: "Maior Tempo de Espera" },
    { id: "wait_asc", label: "Espera Mais Recente" },
    { id: "deal_value", label: "Maior Valor em Risco (R$)" },
    { id: "meta_window", label: "Janela 24h Prestes a Expirar" },
  ];

  const activeLabel = options.find((o) => o.id === value)?.label || "Ordenar";

  return (
    <div ref={ref} className="relative min-w-[215px]">
      <SystemTooltip content="Ordenar lista de alertas operacionais">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-1.5 bg-card border border-border hover:border-primary/40 rounded-xl px-3 py-1.5 text-[11px] font-semibold text-foreground transition cursor-pointer"
        >
          <Filter className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="flex-1 text-left truncate">{activeLabel}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </SystemTooltip>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-card border border-border rounded-2xl shadow-xl py-1.5 min-w-[235px] w-full">
          {options.map((opt) => {
            const isActive = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-left transition cursor-pointer ${
                  isActive
                    ? "bg-primary/10 text-primary font-bold"
                    : "text-foreground hover:bg-muted/60"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const SUPERVISOR_ALERT_PRESETS = [
  "Priorizar resposta imediata a este cliente (SLA estourado).",
  "Cliente em risco/atrito — entrar em contato ou ligar agora.",
  "Negociação ativa — atualizar retorno e próximo passo no CRM.",
];

function AlertsTab({
  alerts,
  summary,
  operatorBottlenecks,
  operators = [],
  loading,
  onRefresh,
}: {
  alerts: AlertItem[];
  summary: AlertsExecutiveSummary | null;
  operatorBottlenecks: AlertOperatorBottleneck[];
  operators?: OperatorOverviewItem[];
  loading: boolean;
  onRefresh?: () => void;
}) {
  const { tenant, setActiveView, setSelectedChatId } = useChat();
  const navigate = useNavigate();

  // Filtros e ordenação
  const [categoryFilter, setCategoryFilter] = useState<AlertFilterCategory>("all");
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<AlertSortMode>("severity");

  // Estados por card: Inspeção Inline da Conversa e Sussurro de Cobrança
  const [expandedConvId, setExpandedConvId] = useState<string | null>(null);
  const [whisperOpenConvId, setWhisperOpenConvId] = useState<string | null>(null);
  const [whisperDraft, setWhisperDraft] = useState("");
  const [whisperTargetOpByConv, setWhisperTargetOpByConv] = useState<Record<string, string>>({});
  const [assignedOpOverrideByConv, setAssignedOpOverrideByConv] = useState<
    Record<string, { operatorId: string; operatorName: string; queueState: string }>
  >({});
  const [sendingWhisperConvId, setSendingWhisperConvId] = useState<string | null>(null);
  const [localWhispersByConv, setLocalWhispersByConv] = useState<Record<string, LiveMessage[]>>({});
  const [fullHistoryByConv, setFullHistoryByConv] = useState<Record<string, LiveMessage[]>>({});
  const [loadingHistoryConvId, setLoadingHistoryConvId] = useState<string | null>(null);

  const availableConsultants = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; avatar?: string | null; isOnline: boolean }
    >();
    for (const op of operators) {
      if (op.operatorId && op.operatorId !== "__fila__") {
        map.set(op.operatorId, {
          id: op.operatorId,
          name: op.operatorName,
          avatar: op.avatarUrl ?? null,
          isOnline: Boolean(op.isOnline || op.status === "disponivel" || op.status === "ocupado"),
        });
      }
    }
    for (const b of operatorBottlenecks) {
      if (b.operatorId && b.operatorId !== "__fila__" && !map.has(b.operatorId)) {
        map.set(b.operatorId, {
          id: b.operatorId,
          name: b.operatorName,
          avatar: b.operatorAvatar ?? null,
          isOnline: Boolean(b.isOnline),
        });
      }
    }
    for (const a of alerts) {
      if (a.operatorId && !map.has(a.operatorId)) {
        map.set(a.operatorId, {
          id: a.operatorId,
          name: a.operatorName,
          avatar: a.operatorAvatar ?? null,
          isOnline: Boolean(a.operatorIsOnline),
        });
      }
      if (a.suggestedOperatorId && a.suggestedOperatorName && !map.has(a.suggestedOperatorId)) {
        map.set(a.suggestedOperatorId, {
          id: a.suggestedOperatorId,
          name: a.suggestedOperatorName,
          avatar: null,
          isOnline: false,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }, [operators, operatorBottlenecks, alerts]);

  // Sumário calculado com fallback caso summary venha nulo (ex: modo demo)
  const computedSummary = useMemo<AlertsExecutiveSummary>(() => {
    if (summary) return summary;
    const unanswered = alerts.filter((a) => a.isUnanswered !== false);
    const maxWait = unanswered.reduce(
      (m, a) => (a.waitingMinutes > m ? a.waitingMinutes : m),
      0
    );
    const avgWait =
      unanswered.length > 0
        ? Math.round(
            unanswered.reduce((acc, a) => acc + a.waitingMinutes, 0) / unanswered.length
          )
        : 0;
    const seenDeals = new Set<string>();
    let pipelineVal = 0;
    for (const a of alerts) {
      if (a.activeDeal?.status === "open" && !seenDeals.has(a.activeDeal.id)) {
        seenDeals.add(a.activeDeal.id);
        pipelineVal += Number(a.activeDeal.value || 0);
      }
    }
    return {
      totalAlerts: alerts.length,
      criticalCount: alerts.filter((a) => a.isCritical).length,
      overdueCount: alerts.filter(
        (a) => a.alertTags?.includes("sla_critical") || a.isOverdue
      ).length,
      warningCount: alerts.filter(
        (a) => a.alertTags?.includes("sla_warning") || (!a.isOverdue && a.waitingMinutes < 15)
      ).length,
      unassignedQueueCount: alerts.filter(
        (a) => a.alertTags?.includes("unassigned_queue") || a.queueState === "fila"
      ).length,
      conflictRiskCount: alerts.filter(
        (a) => a.alertTags?.includes("conflict_risk") || a.alertType === "conflict"
      ).length,
      metaWindowExpiringCount: alerts.filter((a) =>
        a.alertTags?.includes("meta_window_expiring")
      ).length,
      deliveryFailureCount: alerts.filter(
        (a) => a.alertTags?.includes("delivery_failed") || a.alertType === "delivery_failure"
      ).length,
      overdueTasksAlertsCount: alerts.filter((a) =>
        a.alertTags?.includes("overdue_task")
      ).length,
      maxWaitMinutes: maxWait,
      avgWaitMinutes: avgWait,
      pipelineAtRiskValue: pipelineVal,
      dealsAtRiskCount: seenDeals.size,
      offlineOperatorsWithAlertsCount: 0,
      slaCompliancePctToday: null,
      slaCyclesTodayTotal: 0,
      slaCyclesTodayWithinLimit: 0,
    };
  }, [summary, alerts]);

  // Lista de gargalos por operador com fallback
  const bottlenecks = useMemo<AlertOperatorBottleneck[]>(() => {
    if (operatorBottlenecks && operatorBottlenecks.length > 0) return operatorBottlenecks;
    const map = new Map<string, AlertOperatorBottleneck>();
    for (const a of alerts) {
      const key = a.operatorId || "__fila__";
      const cur = map.get(key) || {
        operatorId: key,
        operatorName: a.operatorName || "Sem consultor",
        operatorAvatar: a.operatorAvatar ?? null,
        isOnline: Boolean(a.operatorIsOnline),
        status: a.operatorStatus || "ausente",
        totalAlerts: 0,
        criticalCount: 0,
        overdueCount: 0,
        conflictCount: 0,
        maxWaitMinutes: 0,
        pipelineAtRiskValue: 0,
      };
      cur.totalAlerts += 1;
      if (a.isCritical) cur.criticalCount += 1;
      if (a.isOverdue) cur.overdueCount += 1;
      if (a.alertType === "conflict" || a.alertTags?.includes("conflict_risk")) {
        cur.conflictCount += 1;
      }
      if (a.waitingMinutes > cur.maxWaitMinutes) cur.maxWaitMinutes = a.waitingMinutes;
      if (a.activeDeal?.value) cur.pipelineAtRiskValue += Number(a.activeDeal.value);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.totalAlerts - a.totalAlerts);
  }, [operatorBottlenecks, alerts]);

  // Contadores por pílula de categoria
  const categoryCounts = useMemo(() => {
    const hasTag = (a: AlertItem, tag: AlertCategoryTag) =>
      Boolean(a.alertTags?.includes(tag));
    return {
      all: alerts.length,
      critical: alerts.filter(
        (a) => a.isCritical || a.isOverdue || hasTag(a, "sla_critical")
      ).length,
      warning: alerts.filter(
        (a) => hasTag(a, "sla_warning") || (!a.isOverdue && a.waitingMinutes < 15)
      ).length,
      queue: alerts.filter(
        (a) => hasTag(a, "unassigned_queue") || (!a.operatorId && a.queueState === "fila")
      ).length,
      conflict: alerts.filter(
        (a) => hasTag(a, "conflict_risk") || a.alertType === "conflict"
      ).length,
      meta_window: alerts.filter(
        (a) => hasTag(a, "meta_window_expiring") || a.alertType === "meta_window"
      ).length,
      delivery: alerts.filter(
        (a) => hasTag(a, "delivery_failed") || a.alertType === "delivery_failure"
      ).length,
    };
  }, [alerts]);

  // Filtragem e Ordenação da lista
  const filteredAlerts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const hasTag = (a: AlertItem, tag: AlertCategoryTag) =>
      Boolean(a.alertTags?.includes(tag));

    const list = alerts.filter((a) => {
      // Filtro de operador
      if (selectedOperatorId) {
        const itemOpKey = a.operatorId || "__fila__";
        if (itemOpKey !== selectedOperatorId) return false;
      }

      // Filtro de categoria
      if (categoryFilter === "critical") {
        if (!(a.isCritical || a.isOverdue || hasTag(a, "sla_critical"))) return false;
      } else if (categoryFilter === "warning") {
        if (!(hasTag(a, "sla_warning") || (!a.isOverdue && a.waitingMinutes < 15)))
          return false;
      } else if (categoryFilter === "queue") {
        if (!(hasTag(a, "unassigned_queue") || (!a.operatorId && a.queueState === "fila")))
          return false;
      } else if (categoryFilter === "conflict") {
        if (!(hasTag(a, "conflict_risk") || a.alertType === "conflict")) return false;
      } else if (categoryFilter === "meta_window") {
        if (!(hasTag(a, "meta_window_expiring") || a.alertType === "meta_window"))
          return false;
      } else if (categoryFilter === "delivery") {
        if (!(hasTag(a, "delivery_failed") || a.alertType === "delivery_failure"))
          return false;
      }

      // Filtro de busca textual
      if (q) {
        const matchName = a.contactName?.toLowerCase().includes(q);
        const matchPhone = a.contactPhone?.toLowerCase().includes(q);
        const matchCompany = a.accountName?.toLowerCase().includes(q);
        const matchDeal = a.activeDeal?.title?.toLowerCase().includes(q);
        const matchOp = a.operatorName?.toLowerCase().includes(q);
        const matchMsg = a.lastMessagePreview?.toLowerCase().includes(q);
        const matchTranscript = a.lastMessageTranscription?.toLowerCase().includes(q);
        if (
          !matchName &&
          !matchPhone &&
          !matchCompany &&
          !matchDeal &&
          !matchOp &&
          !matchMsg &&
          !matchTranscript
        ) {
          return false;
        }
      }

      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "wait_desc") {
        return b.waitingSeconds - a.waitingSeconds;
      }
      if (sortBy === "wait_asc") {
        // Prioriza quem está esperando há menos tempo (alertas mais frescos do dia)
        const aWait = a.waitingSeconds > 0 ? a.waitingSeconds : 99999999;
        const bWait = b.waitingSeconds > 0 ? b.waitingSeconds : 99999999;
        return aWait - bWait;
      }
      if (sortBy === "deal_value") {
        const aVal = Number(a.activeDeal?.value || 0);
        const bVal = Number(b.activeDeal?.value || 0);
        if (bVal !== aVal) return bVal - aVal;
        return b.waitingSeconds - a.waitingSeconds;
      }
      if (sortBy === "meta_window") {
        const aRem = a.metaWindowRemainingMinutes ?? 99999;
        const bRem = b.metaWindowRemainingMinutes ?? 99999;
        if (aRem !== bRem) return aRem - bRem;
        return b.waitingSeconds - a.waitingSeconds;
      }
      // "severity" (padrão)
      if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
      const aConflict =
        a.alertTags?.includes("conflict_risk") || a.alertType === "conflict" ? 1 : 0;
      const bConflict =
        b.alertTags?.includes("conflict_risk") || b.alertType === "conflict" ? 1 : 0;
      if (aConflict !== bConflict) return bConflict - aConflict;
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return b.waitingSeconds - a.waitingSeconds;
    });
  }, [alerts, selectedOperatorId, categoryFilter, searchQuery, sortBy]);

  const handleLoadFullConversation = useCallback(
    async (convId: string) => {
      if (!convId || loadingHistoryConvId === convId) return;
      setLoadingHistoryConvId(convId);
      try {
        const res = await fetch(
          `/api/gestao/messages?tenantId=${tenant}&conversationId=${convId}`
        );
        if (res.ok) {
          const msgs: LiveMessage[] = await res.json();
          setFullHistoryByConv((prev) => ({ ...prev, [convId]: msgs }));
        }
      } catch (e) {
        console.error("[AlertsTab] Erro ao carregar histórico completo:", e);
      } finally {
        setLoadingHistoryConvId(null);
      }
    },
    [tenant, loadingHistoryConvId]
  );

  const handleSendAlertWhisper = useCallback(
    async (convId: string, contentText: string, targetOperatorId?: string | null) => {
      const trimmed = contentText.trim();
      if (!trimmed || sendingWhisperConvId) return;
      setSendingWhisperConvId(convId);
      try {
        const res = await fetch("/api/gestao/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: convId,
            content: trimmed,
            targetOperatorId: targetOperatorId || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Não foi possível enviar a orientação.");
        }
        const createdMsg: LiveMessage | undefined = data.message;
        if (createdMsg) {
          setLocalWhispersByConv((prev) => ({
            ...prev,
            [convId]: [...(prev[convId] || []), createdMsg],
          }));
        }
        if (data.assignedOperatorId && data.assignedOperatorName) {
          setAssignedOpOverrideByConv((prev) => ({
            ...prev,
            [convId]: {
              operatorId: data.assignedOperatorId,
              operatorName: data.assignedOperatorName,
              queueState: data.assignedQueueState || "meus",
            },
          }));
        }
        setWhisperDraft("");
        setWhisperOpenConvId(null);
        const targetLabel = data.assignedOperatorName
          ? ` para ${data.assignedOperatorName}`
          : "";
        toast.success(
          data.didAssignOperator
            ? `Atendimento atribuído e cobrança enviada em tempo real${targetLabel}!`
            : `Cobrança/orientação enviada em tempo real${targetLabel}!`
        );
      } catch (err: any) {
        toast.error(err.message || "Falha ao enviar orientação ao consultor.");
      } finally {
        setSendingWhisperConvId(null);
      }
    },
    [sendingWhisperConvId]
  );

  if (loading && alerts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <RefreshCw className="h-6 w-6 animate-spin text-primary/50" />
        <span className="text-xs font-semibold">
          Auditando SLA, fila, conflitos, janela Meta e pipeline em risco...
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto scrollbar-thin pr-1 space-y-4 pb-4">
      {/* ── BLOCO 1: COCKPIT EXECUTIVO DE RISCO OPERACIONAL (4 KPIs) ────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 shrink-0">
        {/* KPI 1: Alertas Críticos & SLA Estourado */}
        <button
          type="button"
          onClick={() =>
            setCategoryFilter((prev) => (prev === "critical" ? "all" : "critical"))
          }
          className={`text-left bg-card rounded-2xl p-4 border shadow-soft transition cursor-pointer flex flex-col justify-between gap-2 ${
            categoryFilter === "critical"
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              SLA Estourado & Críticos
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Bell
                className={`h-4 w-4 ${
                  computedSummary.criticalCount > 0 ? "animate-pulse" : ""
                }`}
              />
            </div>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-black text-foreground">
              {categoryCounts.critical}
            </span>
            {computedSummary.criticalCount > 0 && (
              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground animate-pulse">
                {computedSummary.criticalCount} críticos
              </span>
            )}
            {computedSummary.warningCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
                +{computedSummary.warningCount} em atenção
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {computedSummary.maxWaitMinutes > 0
              ? `Maior espera: ${formatWaitDuration(computedSummary.maxWaitMinutes)} · Média: ${formatWaitDuration(computedSummary.avgWaitMinutes)}`
              : "Nenhum cliente com SLA estourado no momento"}
          </p>
        </button>

        {/* KPI 2: Receita em Risco no Pipeline (R$) */}
        <button
          type="button"
          onClick={() =>
            setSortBy((prev) => (prev === "deal_value" ? "severity" : "deal_value"))
          }
          className={`text-left bg-card rounded-2xl p-4 border shadow-soft transition cursor-pointer flex flex-col justify-between gap-2 ${
            sortBy === "deal_value"
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Receita em Risco no Pipeline
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Briefcase className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black text-foreground truncate">
              {computedSummary.pipelineAtRiskValue.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
                maximumFractionDigits: 0,
              })}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            <strong className="text-foreground">{computedSummary.dealsAtRiskCount}</strong>{" "}
            negociação(ões) aberta(s) com alerta ativo
          </p>
        </button>

        {/* KPI 3: Riscos de Atrito, Fila Sem Consultor & Janela Meta */}
        <button
          type="button"
          onClick={() =>
            setCategoryFilter((prev) => (prev === "conflict" ? "all" : "conflict"))
          }
          className={`text-left bg-card rounded-2xl p-4 border shadow-soft transition cursor-pointer flex flex-col justify-between gap-2 ${
            categoryFilter === "conflict"
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Atrito, Fila & Canal WhatsApp
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-2xl font-black text-foreground">
              {computedSummary.conflictRiskCount +
                computedSummary.unassignedQueueCount +
                computedSummary.deliveryFailureCount}
            </span>
            <span className="text-[10px] font-semibold text-muted-foreground">
              riscos operacionais
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground truncate">
            Atrito:{" "}
            <strong className="text-foreground">{computedSummary.conflictRiskCount}</strong> ·
            Fila:{" "}
            <strong className="text-foreground">
              {computedSummary.unassignedQueueCount}
            </strong>{" "}
            · Janela 24h:{" "}
            <strong className="text-foreground">
              {computedSummary.metaWindowExpiringCount}
            </strong>{" "}
            · Falhas:{" "}
            <strong className="text-foreground">
              {computedSummary.deliveryFailureCount}
            </strong>
          </p>
        </button>

        {/* KPI 4: Conformidade SLA Hoje & Consultores Offline */}
        <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Conformidade SLA Hoje
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-black text-foreground">
              {computedSummary.slaCompliancePctToday !== null
                ? `${computedSummary.slaCompliancePctToday}%`
                : "100%"}
            </span>
            <span className="text-[10px] font-semibold text-muted-foreground">
              dentro de 15m hoje
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {computedSummary.offlineOperatorsWithAlertsCount > 0 ? (
              <span className="text-primary font-bold">
                ⚠️ {computedSummary.offlineOperatorsWithAlertsCount} consultor(es) offline com
                cliente esperando
              </span>
            ) : computedSummary.slaCyclesTodayTotal > 0 ? (
              `${computedSummary.slaCyclesTodayWithinLimit}/${computedSummary.slaCyclesTodayTotal} ciclos respondidos no prazo hoje`
            ) : (
              "Todos os consultores com alerta estão monitorados"
            )}
          </p>
        </div>
      </div>

      {/* ── BLOCO 2: CONCENTRAÇÃO DE ALERTAS POR CONSULTOR (GARGALOS) ──────── */}
      {bottlenecks.length > 0 && (
        <div className="bg-card rounded-2xl border border-border shadow-soft px-4 py-3 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-foreground">
                Concentração de Alertas por Consultor / Fila
              </span>
              <span className="text-[10px] text-muted-foreground hidden sm:inline">
                (Clique em um consultor para filtrar a lista abaixo)
              </span>
            </div>
            {selectedOperatorId && (
              <button
                type="button"
                onClick={() => setSelectedOperatorId("")}
                className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
              >
                Limpar filtro de consultor
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1">
            {bottlenecks.map((b) => {
              const isSelected = selectedOperatorId === b.operatorId;
              const isQueue = b.operatorId === "__fila__";
              return (
                <SystemTooltip
                  key={b.operatorId}
                  content={
                    isQueue
                      ? `${b.totalAlerts} cliente(s) aguardando captura na Fila Humana · Maior espera: ${formatWaitDuration(b.maxWaitMinutes)}`
                      : `${b.operatorName} (${b.isOnline ? "Online agora" : "Offline"}) · ${b.totalAlerts} alerta(s) · Maior espera: ${formatWaitDuration(b.maxWaitMinutes)}`
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedOperatorId((prev) =>
                        prev === b.operatorId ? "" : b.operatorId
                      )
                    }
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition cursor-pointer shrink-0 ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-muted/30 hover:bg-muted/60 text-foreground border-border"
                    }`}
                  >
                    <div className="relative shrink-0">
                      <Avatar
                        name={b.operatorName}
                        avatar={b.operatorAvatar}
                        size="sm"
                      />
                      {!isQueue && (
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${
                            b.isOnline ? "bg-emerald-500" : "bg-muted-foreground/45"
                          }`}
                        />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-extrabold truncate max-w-[130px]">
                          {b.operatorName}
                        </span>
                        {!isQueue && !b.isOnline && (
                          <span
                            className={`text-[8px] font-extrabold px-1 py-0.2 rounded uppercase ${
                              isSelected
                                ? "bg-white/20 text-white"
                                : "bg-muted text-muted-foreground border border-border"
                            }`}
                          >
                            Offline
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                        <span
                          className={`font-extrabold ${
                            isSelected ? "text-primary-foreground" : "text-primary"
                          }`}
                        >
                          {b.totalAlerts} alerta{b.totalAlerts !== 1 ? "s" : ""}
                        </span>
                        {b.criticalCount > 0 && (
                          <span
                            className={`px-1 rounded text-[9px] font-extrabold ${
                              isSelected
                                ? "bg-white/25 text-white"
                                : "bg-primary/15 text-primary"
                            }`}
                          >
                            {b.criticalCount} crít.
                          </span>
                        )}
                        {b.pipelineAtRiskValue > 0 && (
                          <span
                            className={`text-[9px] font-semibold ${
                              isSelected
                                ? "text-primary-foreground/85"
                                : "text-muted-foreground"
                            }`}
                          >
                            ·{" "}
                            {b.pipelineAtRiskValue.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                              maximumFractionDigits: 0,
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </SystemTooltip>
              );
            })}
          </div>
        </div>
      )}

      {/* ── BLOCO 3: BARRA DE FILTROS EXECUTIVOS, BUSCA E ORDENAÇÃO ────────── */}
      <div className="bg-card rounded-2xl border border-border shadow-soft p-3.5 space-y-3 shrink-0">
        {/* Pílulas de Categoria de Alerta */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
          {(
            [
              { id: "all", label: "Todos os Alertas", count: categoryCounts.all, icon: Layers },
              {
                id: "critical",
                label: "SLA Estourado & Críticos",
                count: categoryCounts.critical,
                icon: Flame,
              },
              {
                id: "warning",
                label: "Em Atenção (5-14m)",
                count: categoryCounts.warning,
                icon: Clock,
              },
              {
                id: "queue",
                label: "Fila s/ Consultor",
                count: categoryCounts.queue,
                icon: Users,
              },
              {
                id: "conflict",
                label: "Atrito / Conflito",
                count: categoryCounts.conflict,
                icon: AlertTriangle,
              },
              {
                id: "meta_window",
                label: "Janela 24h Expirando",
                count: categoryCounts.meta_window,
                icon: ShieldCheck,
              },
              {
                id: "delivery",
                label: "Falha de Entrega",
                count: categoryCounts.delivery,
                icon: XCircle,
              },
            ] as const
          ).map((pill) => {
            const Icon = pill.icon;
            const active = categoryFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setCategoryFilter(pill.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer shrink-0 border ${
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-xs"
                    : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{pill.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[9px] font-extrabold ${
                    active
                      ? "bg-white/25 text-white"
                      : pill.count > 0
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {pill.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Busca + Filtro de Consultor + Ordenação */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[230px]">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar cliente, telefone, empresa, negociação, consultor ou texto da mensagem..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-muted/40 border border-border rounded-xl pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="w-52 shrink-0">
            <LiveOperatorSelect
              value={selectedOperatorId}
              onChange={setSelectedOperatorId}
              operators={bottlenecks.map((b) => ({
                operatorId: b.operatorId,
                operatorName: b.operatorName,
                status: b.status,
                isOnline: b.isOnline,
                waitingReplyCount: b.totalAlerts,
              }))}
            />
          </div>

          <AlertsSortSelect value={sortBy} onChange={setSortBy} />

          {onRefresh && (
            <SystemTooltip content="Atualizar alertas agora">
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card hover:bg-muted text-xs font-bold text-foreground transition cursor-pointer shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5 text-primary" />
                <span className="hidden md:inline">Atualizar</span>
              </button>
            </SystemTooltip>
          )}
        </div>
      </div>

      {/* ── BLOCO 4: LISTA DE CARDS 360º DE ALERTAS OPERACIONAIS ───────────── */}
      {filteredAlerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-16 bg-card rounded-2xl border border-border text-muted-foreground gap-3">
          <CheckCircle className="h-11 w-11 text-primary" />
          <div className="text-center">
            <p className="font-extrabold text-sm text-foreground">
              {alerts.length === 0
                ? "Operação em dia! Nenhum alerta ativo no momento."
                : "Nenhum alerta encontrado para este filtro."}
            </p>
            <p className="text-xs mt-1">
              {alerts.length === 0
                ? "Todos os clientes ativos foram respondidos dentro do SLA e não há falhas pendentes."
                : "Experimente limpar os filtros de categoria, consultor ou busca textual."}
            </p>
          </div>
          {(categoryFilter !== "all" || selectedOperatorId || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setCategoryFilter("all");
                setSelectedOperatorId("");
                setSearchQuery("");
              }}
              className="text-xs font-bold text-primary hover:underline cursor-pointer mt-1"
            >
              Limpar todos os filtros ({alerts.length} alertas no total)
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredAlerts.map((alert) => {
            const assignedOverride = assignedOpOverrideByConv[alert.conversationId];
            const effectiveOperatorId =
              assignedOverride?.operatorId ?? alert.operatorId ?? null;
            const effectiveOperatorName =
              assignedOverride?.operatorName ?? alert.operatorName;
            const effectiveQueueState =
              assignedOverride?.queueState ?? alert.queueState;

            const tags = alert.alertTags || [];
            const isConflict =
              tags.includes("conflict_risk") || alert.alertType === "conflict";
            const isQueue =
              !effectiveOperatorId &&
              (tags.includes("unassigned_queue") || effectiveQueueState === "fila");
            const isInAutomation =
              !effectiveOperatorId && effectiveQueueState === "automacao";
            const hasHumanConsultant = Boolean(effectiveOperatorId);
            const isDeliveryFailed =
              tags.includes("delivery_failed") || alert.alertType === "delivery_failure";
            const isMetaExpiring =
              tags.includes("meta_window_expiring") || alert.alertType === "meta_window";
            const isOverdueTask =
              tags.includes("overdue_task") || (alert.overdueTasksCount ?? 0) > 0;

            const isExpanded = expandedConvId === alert.conversationId;
            const isWhisperOpen = whisperOpenConvId === alert.conversationId;

            const selectedWhisperOpId =
              whisperTargetOpByConv[alert.conversationId] ??
              effectiveOperatorId ??
              alert.suggestedOperatorId ??
              "";
            const selectedWhisperOpObj = availableConsultants.find(
              (c) => c.id === selectedWhisperOpId
            );
            const selectedWhisperOpLabel =
              selectedWhisperOpObj?.name ||
              (selectedWhisperOpId === effectiveOperatorId ? effectiveOperatorName : "") ||
              alert.suggestedOperatorName ||
              "Selecione um consultor";

            const baseMessages =
              fullHistoryByConv[alert.conversationId] || alert.recentMessages || [];
            const extraWhispers = localWhispersByConv[alert.conversationId] || [];
            const existingMsgIds = new Set(baseMessages.map((m) => m.id));
            const combinedMessages = [
              ...baseMessages,
              ...extraWhispers.filter((m) => !existingMsgIds.has(m.id)),
            ];

            const lastSupervisorWhisper = [...combinedMessages]
              .reverse()
              .find(
                (m) =>
                  Boolean(m.isInternalNote) &&
                  (Boolean((m.metaDetails as any)?.supervisorWhisper) ||
                    /\(Supervisão\)/i.test(m.senderName || ""))
              );

            const translatedDeliveryError = alert.lastMessageError
              ? formatMetaErrorMessagePt(
                  alert.lastMessageError,
                  alert.contactPhone || undefined
                )
              : null;

            return (
              <div
                key={alert.logId}
                className={`bg-card rounded-2xl border shadow-soft p-4 md:p-5 flex flex-col gap-3.5 transition-all ${
                  alert.isCritical
                    ? "border-primary/45 bg-primary/[0.03]"
                    : isConflict || isDeliveryFailed
                    ? "border-primary/30"
                    : "border-border hover:border-muted-foreground/25"
                }`}
              >
                {/* 1. Header do Card: Cliente, Empresa, Badges de Risco e Tempo de Espera */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <Avatar
                      name={alert.contactName}
                      avatar={alert.contactAvatar}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center flex-wrap gap-1.5">
                        <span className="text-sm font-extrabold text-foreground truncate">
                          {alert.contactName}
                        </span>

                        {alert.accountName && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-muted text-foreground border border-border truncate max-w-[210px]">
                            <Building2 className="h-2.5 w-2.5 text-primary shrink-0" />
                            {alert.accountName}
                          </span>
                        )}

                        {alert.isCritical && (
                          <span className="text-[10px] font-extrabold text-primary-foreground bg-primary px-2 py-0.5 rounded-md animate-pulse">
                            CRÍTICO
                          </span>
                        )}

                        {isConflict && (
                          <span className="text-[10px] font-extrabold text-primary bg-primary/15 px-2 py-0.5 rounded-full border border-primary/30 inline-flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            Atrito / Reclamação
                            {alert.conflictTriggerText
                              ? ` ("${alert.conflictTriggerText}")`
                              : ""}
                          </span>
                        )}

                        {isQueue && (
                          <span className="text-[10px] font-extrabold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/25 inline-flex items-center gap-1">
                            <Users className="h-3 w-3 shrink-0" />
                            Na Fila Sem Consultor
                          </span>
                        )}

                        {isDeliveryFailed && (
                          <span className="text-[10px] font-extrabold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/25 inline-flex items-center gap-1">
                            <XCircle className="h-3 w-3 shrink-0" />
                            Falha de Entrega ({alert.failedMessagesCount || 1})
                          </span>
                        )}

                        {isMetaExpiring && alert.metaWindowRemainingMinutes && (
                          <span className="text-[10px] font-extrabold text-foreground bg-muted px-2 py-0.5 rounded-full border border-border inline-flex items-center gap-1">
                            <Clock className="h-3 w-3 text-primary shrink-0" />
                            Janela 24h expira em{" "}
                            {formatWaitDuration(alert.metaWindowRemainingMinutes)}
                          </span>
                        )}

                        {!isConflict && !isQueue && !isDeliveryFailed && (
                          <span className="text-[10px] font-extrabold text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border inline-flex items-center gap-1">
                            <Clock className="h-3 w-3 shrink-0" />
                            {alert.isOverdue
                              ? "SLA Estourado (≥ 15m)"
                              : "Aguardando Retorno"}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground mt-1">
                        {alert.contactPhone && (
                          <span className="font-medium">
                            {formatPhone(alert.contactPhone)}
                          </span>
                        )}
                        {alert.conversationStartedAt && (
                          <span>· Início: {alert.conversationStartedAt}</span>
                        )}
                        {alert.metaWindowOpen !== undefined && (
                          <span>
                            ·{" "}
                            {alert.metaWindowOpen && alert.metaWindowRemainingMinutes
                              ? `Janela Meta aberta (${formatWaitDuration(alert.metaWindowRemainingMinutes)} restantes)`
                              : "Janela Meta 24h fechada (exige Template)"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Lado Direito: Consultor Responsável (com presença Online/Offline) + Badge de Espera */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <SystemTooltip
                      content={
                        !hasHumanConsultant
                          ? isInAutomation
                            ? "Atendimento na Triagem I.A. — clique em 'Cobrar / Orientar Consultor' para atribuir e orientar um consultor"
                            : "Nenhum consultor capturou este atendimento ainda — clique em 'Cobrar / Orientar Consultor' para atribuir"
                          : alert.operatorIsOnline
                          ? `${effectiveOperatorName} está ONLINE agora no sistema`
                          : `${effectiveOperatorName} está OFFLINE no momento — risco de demora no atendimento!`
                      }
                    >
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-muted/50 border border-border text-xs">
                        {hasHumanConsultant && (
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 ${
                              alert.operatorIsOnline
                                ? "bg-emerald-500"
                                : "bg-muted-foreground/45"
                            }`}
                          />
                        )}
                        <span className="text-[10px] text-muted-foreground font-semibold">
                          Consultor:
                        </span>
                        <span className="font-extrabold text-foreground text-[11px]">
                          {effectiveOperatorName}
                        </span>
                        {hasHumanConsultant && !alert.operatorIsOnline && (
                          <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-primary/15 text-primary border border-primary/25 uppercase">
                            Offline
                          </span>
                        )}
                      </div>
                    </SystemTooltip>

                    {(alert.isUnanswered !== false || alert.waitingMinutes > 0) && (
                      <WaitBadge
                        minutes={alert.waitingMinutes}
                        isCritical={alert.isCritical || alert.isOverdue}
                      />
                    )}
                  </div>
                </div>

                {/* 2. Barra de Contexto Comercial (Negociação Ativa no CRM & Tarefas) */}
                {(alert.activeDeal || (alert.openTasksCount ?? 0) > 0) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-muted/30 border border-border text-xs">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {alert.activeDeal ? (
                        <>
                          <span className="inline-flex items-center gap-1 font-extrabold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md">
                            <Briefcase className="h-3 w-3 shrink-0" />
                            <span className="truncate max-w-[260px]">
                              {alert.activeDeal.title}
                            </span>
                          </span>
                          {alert.activeDeal.value !== null &&
                            alert.activeDeal.value > 0 && (
                              <span className="font-black text-foreground bg-card border border-border px-2 py-0.5 rounded-md">
                                {alert.activeDeal.value.toLocaleString("pt-BR", {
                                  style: "currency",
                                  currency: "BRL",
                                })}
                              </span>
                            )}
                          {(alert.activeDeal.pipelineName ||
                            alert.activeDeal.stageName) && (
                            <span className="text-[10px] font-semibold text-muted-foreground bg-card border border-border px-2 py-0.5 rounded-md">
                              {[
                                alert.activeDeal.pipelineName,
                                alert.activeDeal.stageName,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          Atendimento com tarefa comercial vinculada
                        </span>
                      )}
                    </div>

                    {(alert.openTasksCount ?? 0) > 0 && (
                      <SystemTooltip
                        content={
                          alert.nextTaskTitle
                            ? `Próxima tarefa: ${alert.nextTaskTitle}`
                            : "Tarefas abertas vinculadas a esta conversa"
                        }
                      >
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${
                            isOverdueTask
                              ? "bg-primary/15 text-primary border-primary/30"
                              : "bg-card text-foreground border-border"
                          }`}
                        >
                          <ClipboardCheck className="h-3 w-3 shrink-0" />
                          {alert.openTasksCount} tarefa(s)
                          {(alert.overdueTasksCount ?? 0) > 0 &&
                            ` · ${alert.overdueTasksCount} vencida(s)`}
                        </span>
                      </SystemTooltip>
                    )}
                  </div>
                )}

                {/* 3. Última Mensagem / Áudio com Transcrição IA / Erro de Entrega */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground ml-1">
                    {alert.lastMessageSenderType === "agent"
                      ? "Último Disparo do Atendimento"
                      : "Última Mensagem do Cliente"}
                  </span>

                  <div
                    className={`rounded-xl p-3 text-xs border ${
                      isConflict || isDeliveryFailed
                        ? "bg-primary/5 text-foreground border-primary/25"
                        : "bg-muted/40 text-foreground border-border"
                    }`}
                  >
                    {alert.lastMessageMediaType === "audio" &&
                    alert.lastMessageMediaId ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Volume2 className="h-4 w-4 text-primary shrink-0" />
                          <span className="text-[11px] font-bold text-foreground">
                            Áudio enviado pelo cliente:
                          </span>
                          <AudioWithSpeed
                            src={`${LIVE_BACKEND_URL}/api/baileys/media?messageId=${alert.lastMessageMediaId}`}
                            audioClassName="h-7 w-52"
                          />
                        </div>
                        {alert.lastMessageTranscription ? (
                          <div className="rounded-lg bg-card/90 border border-border px-3 py-2 text-[11px] leading-relaxed">
                            <span className="text-[9px] font-extrabold uppercase tracking-wider text-primary block mb-0.5">
                              Transcrição Automática (Vertex AI):
                            </span>
                            <p className="italic text-foreground break-words">
                              "{alert.lastMessageTranscription}"
                            </p>
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-foreground italic">
                            Ouça o áudio diretamente no player acima ou abra a conversa.
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="font-medium break-words leading-relaxed select-text">
                        "{alert.lastMessagePreview || "Aguardando retorno do atendimento..."}"
                      </p>
                    )}

                    {translatedDeliveryError && (
                      <div className="mt-2 rounded-lg bg-primary/10 border border-primary/25 p-2.5 flex items-start gap-2 text-[11px]">
                        <AlertTriangle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <span className="font-extrabold text-primary block">
                            Diagnóstico da Falha de Entrega no WhatsApp:
                          </span>
                          <span className="text-foreground/90 block mt-0.5">
                            {translatedDeliveryError}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Gaveta Expansível: Inspeção Rápida da Conversa Inline */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-2xl border border-border bg-muted/15 p-3.5 space-y-2.5 mt-1">
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-line">
                          <div className="flex items-center gap-2">
                            <Eye className="h-3.5 w-3.5 text-primary" />
                            <span className="text-xs font-extrabold text-foreground">
                              Inspeção Rápida do Histórico ({combinedMessages.length}{" "}
                              mensagens)
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {!fullHistoryByConv[alert.conversationId] && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleLoadFullConversation(alert.conversationId)
                                }
                                disabled={
                                  loadingHistoryConvId === alert.conversationId
                                }
                                className="text-[10px] font-bold text-primary hover:underline cursor-pointer disabled:opacity-50"
                              >
                                {loadingHistoryConvId === alert.conversationId
                                  ? "Carregando histórico..."
                                  : "Carregar histórico completo"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setExpandedConvId(null)}
                              className="text-[10px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              Fechar
                            </button>
                          </div>
                        </div>

                        <div className="max-h-72 overflow-y-auto scrollbar-thin space-y-2 pr-1">
                          {combinedMessages.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-6">
                              Nenhuma mensagem disponível para visualização rápida.
                            </p>
                          ) : (
                            combinedMessages.map((m, idx) => {
                              const prevMsg =
                                idx > 0 ? combinedMessages[idx - 1] : null;
                              const showDateSep =
                                getMessageDateKey(m.sentAt) !==
                                getMessageDateKey(prevMsg?.sentAt);
                              const dateLabel = showDateSep
                                ? formatMessageDateSeparator(m.sentAt)
                                : null;

                              return (
                                <React.Fragment key={m.id}>
                                  {dateLabel && (
                                    <div className="flex justify-center my-1.5">
                                      <span className="px-2.5 py-0.5 rounded-full bg-card border border-border text-[9px] font-bold text-muted-foreground">
                                        {dateLabel}
                                      </span>
                                    </div>
                                  )}
                                  <LiveMessageBubble
                                    msg={m}
                                    isAgent={
                                      m.senderType === "agent" ||
                                      m.senderType === "bot"
                                    }
                                    contactPhone={alert.contactPhone || undefined}
                                  />
                                </React.Fragment>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Selo de Confirmação de Cobrança da Supervisão (visível mesmo com Espiar Conversa fechado) */}
                {lastSupervisorWhisper && (
                  <div className="rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2 flex items-start justify-between gap-2 text-xs">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary block">
                          Consultor Cobrado / Orientado ({lastSupervisorWhisper.senderName}) ·{" "}
                          {new Date(lastSupervisorWhisper.sentAt).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <p className="text-[11px] font-medium text-foreground truncate">
                          &ldquo;{lastSupervisorWhisper.content}&rdquo;
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Rodapé de Ações Executivas */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-line/60">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedChatId(alert.conversationId);
                        setActiveView("chat");
                      }}
                      className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-primary-foreground bg-primary hover:bg-primary/90 px-3.5 py-2 rounded-xl transition shadow-xs cursor-pointer"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Abrir no Chat
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedConvId((prev) =>
                          prev === alert.conversationId ? null : alert.conversationId
                        )
                      }
                      className={`inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl border transition cursor-pointer ${
                        isExpanded
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "bg-card hover:bg-muted text-foreground border-border"
                      }`}
                    >
                      <Eye className="h-3.5 w-3.5 text-primary" />
                      {isExpanded ? "Ocultar Conversa" : "Espiar Conversa"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const willOpen = whisperOpenConvId !== alert.conversationId;
                        setWhisperOpenConvId(willOpen ? alert.conversationId : null);
                        if (willOpen) {
                          setWhisperDraft("");
                          if (!whisperTargetOpByConv[alert.conversationId]) {
                            const defaultTarget =
                              effectiveOperatorId ||
                              alert.suggestedOperatorId ||
                              availableConsultants[0]?.id ||
                              "";
                            if (defaultTarget) {
                              setWhisperTargetOpByConv((prev) => ({
                                ...prev,
                                [alert.conversationId]: defaultTarget,
                              }));
                            }
                          }
                        }
                      }}
                      className={`inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl border transition cursor-pointer ${
                        isWhisperOpen
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "bg-card hover:bg-muted text-foreground border-border"
                      }`}
                    >
                      <Lock
                        className={`h-3.5 w-3.5 ${
                          isWhisperOpen ? "text-primary-foreground" : "text-primary"
                        }`}
                      />
                      {hasHumanConsultant
                        ? "Cobrar / Orientar Consultor"
                        : "Atribuir & Cobrar Consultor"}
                    </button>
                  </div>

                  {/* Botão CRM Nativo (ou link externo RD fallback) com SystemTooltip */}
                  <div className="flex items-center gap-2">
                    {alert.activeDeal ? (
                      <SystemTooltip
                        content={`Abrir negociação "${alert.activeDeal.title}" no CRM`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            navigate({
                              to: "/crm/deals/$dealId",
                              params: { dealId: alert.activeDeal!.id },
                              search: { from: "crm" },
                            })
                          }
                          className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-foreground bg-muted/60 hover:bg-muted border border-border px-3.5 py-2 rounded-xl transition cursor-pointer"
                        >
                          <Briefcase className="h-3.5 w-3.5 text-primary" />
                          Ver Negociação no CRM
                        </button>
                      </SystemTooltip>
                    ) : alert.crmCardUrl ? (
                      <SystemTooltip content="Abrir card vinculado no CRM externo">
                        <a
                          href={alert.crmCardUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-foreground bg-muted/60 hover:bg-muted border border-border px-3.5 py-2 rounded-xl transition"
                        >
                          <ExternalLink className="h-3.5 w-3.5 text-primary" />
                          Ver no CRM
                        </a>
                      </SystemTooltip>
                    ) : (
                      <SystemTooltip content="Nenhuma negociação ativa vinculada a este atendimento no CRM">
                        <span className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted/40 border border-border px-3 py-2 rounded-xl opacity-65 select-none">
                          <Briefcase className="h-3.5 w-3.5" />
                          Sem Card no CRM
                        </span>
                      </SystemTooltip>
                    )}
                  </div>
                </div>

                {/* 6. Gaveta Expansível (abaixo dos botões): Cobrar / Orientar Consultor em Tempo Real */}
                <AnimatePresence>
                  {isWhisperOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-2xl border border-primary/35 bg-primary/5 p-3.5 space-y-3 mt-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 text-xs font-extrabold text-primary">
                            <Lock className="h-3.5 w-3.5 shrink-0" />
                            <span>
                              {hasHumanConsultant &&
                              selectedWhisperOpId === effectiveOperatorId
                                ? `Enviar Cobrança / Orientação Direta para ${effectiveOperatorName}`
                                : `Atribuir Atendimento & Cobrar ${selectedWhisperOpLabel}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              Dispara alerta sonoro + pop-up na tela do consultor · Invisível ao cliente
                            </span>
                            <button
                              type="button"
                              onClick={() => setWhisperOpenConvId(null)}
                              className="text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Seletor de Consultor Destinatário (obrigatório quando sem consultor humano, opcional para reatribuir) */}
                        {availableConsultants.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                              {hasHumanConsultant
                                ? "Consultor destinatário (clique em outro caso queira transferir e cobrar):"
                                : `Atendimento atualmente em ${effectiveOperatorName} — escolha qual consultor vai assumir e receber a cobrança:`}
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {availableConsultants.map((c) => {
                                const isSelected = selectedWhisperOpId === c.id;
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() =>
                                      setWhisperTargetOpByConv((prev) => ({
                                        ...prev,
                                        [alert.conversationId]: c.id,
                                      }))
                                    }
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold border transition cursor-pointer ${
                                      isSelected
                                        ? "bg-primary text-primary-foreground border-primary shadow-2xs"
                                        : "bg-card hover:bg-muted text-foreground border-border"
                                    }`}
                                  >
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                                        isSelected
                                          ? "bg-primary-foreground"
                                          : c.isOnline
                                          ? "bg-emerald-500"
                                          : "bg-muted-foreground/45"
                                      }`}
                                    />
                                    <span>{c.name}</span>
                                    {c.id === alert.suggestedOperatorId && !hasHumanConsultant && (
                                      <span
                                        className={`text-[8px] font-extrabold uppercase px-1 rounded ${
                                          isSelected
                                            ? "bg-white/25 text-white"
                                            : "bg-primary/15 text-primary"
                                        }`}
                                      >
                                        Dono CRM
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Pílulas de 1 clique */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {SUPERVISOR_ALERT_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              disabled={sendingWhisperConvId === alert.conversationId}
                              onClick={() => {
                                if (!hasHumanConsultant && !selectedWhisperOpId) {
                                  toast.error(
                                    "Selecione acima qual consultor deve assumir e receber a orientação."
                                  );
                                  return;
                                }
                                void handleSendAlertWhisper(
                                  alert.conversationId,
                                  preset,
                                  selectedWhisperOpId || effectiveOperatorId
                                );
                              }}
                              className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-card hover:bg-primary hover:text-primary-foreground text-foreground border border-border transition cursor-pointer disabled:opacity-50"
                            >
                              <Zap className="h-3 w-3 shrink-0 text-primary" />
                              <span>{preset}</span>
                            </button>
                          ))}
                        </div>

                        {/* Campo livre de sussurro */}
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!hasHumanConsultant && !selectedWhisperOpId) {
                              toast.error(
                                "Selecione acima qual consultor deve assumir e receber a orientação."
                              );
                              return;
                            }
                            void handleSendAlertWhisper(
                              alert.conversationId,
                              whisperDraft,
                              selectedWhisperOpId || effectiveOperatorId
                            );
                          }}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="text"
                            placeholder={`Escreva uma orientação direta para ${selectedWhisperOpLabel}...`}
                            value={whisperDraft}
                            onChange={(e) => setWhisperDraft(e.target.value)}
                            className="flex-1 bg-card border border-border rounded-xl px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <button
                            type="submit"
                            disabled={
                              !whisperDraft.trim() ||
                              sendingWhisperConvId === alert.conversationId
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            {sendingWhisperConvId === alert.conversationId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            {hasHumanConsultant && selectedWhisperOpId === effectiveOperatorId
                              ? "Cobrar Agora"
                              : "Atribuir & Cobrar"}
                          </button>
                        </form>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OperatorsTab({ 
  overview, 
  audits, 
  onSelectAudit, 
  onOpenHistory 
}: { 
  overview: OverviewData | null; 
  audits: AuditItem[]; 
  onSelectAudit: (auditId: string) => void;
  onOpenHistory: (operatorId: string, operatorName: string) => void;
}) {
  const [expandedOperatorId, setExpandedOperatorId] = useState<string | null>(null);

  if (!overview) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1">
      <p className="text-xs text-muted-foreground shrink-0">
        Métricas acumuladas hoje · Atualiza automaticamente a cada 30s
      </p>
      {overview.operators.map((op, i) => {
        const total = op.satisfiedCount + op.neutralCount + op.frustratedCount;
        const satisfiedPct = total > 0 ? Math.round((op.satisfiedCount / total) * 100) : 0;
        const isExpanded = expandedOperatorId === op.operatorId;

        // Filtra auditorias vinculadas a este operador por ID (robusto, não por nome)
        const operatorAudits = audits.filter(
          (a) => a.operatorId === op.operatorId
        );

        return (
          <motion.div
            key={op.operatorId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-card rounded-2xl border border-border shadow-soft p-6 flex flex-col md:grid md:grid-cols-12 md:items-center justify-between gap-6"
          >
            {/* Coluna 1: Informações do Operador */}
            <div className="flex flex-col gap-3 w-full md:col-span-3">
              <div className="flex items-center gap-4">
                <Avatar name={op.operatorName} avatar={op.operatorAvatar} size="xl" />
                <div>
                  <div className="flex items-center flex-wrap gap-2">
                    <p className="font-black text-foreground text-lg leading-tight">{op.operatorName}</p>
                    <TrafficDot light={op.trafficLight} />
                  </div>
                  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-1.5 ${
                    op.trafficLight === "green" ? "bg-primary/10 text-primary border border-primary/20" :
                    op.trafficLight === "yellow" ? "bg-muted text-foreground border border-border" :
                    op.trafficLight === "red" ? "bg-primary/15 text-primary border border-primary/30" :
                    "bg-muted/60 text-muted-foreground border border-border"
                  }`}>
                    {op.trafficLight === "green" ? "No ritmo" :
                     op.trafficLight === "yellow" ? "Atenção" :
                     op.trafficLight === "red" ? "Lento" : "Sem dados hoje"}
                  </span>
                  <p className="text-xs text-muted-foreground mt-1">
                    {op.totalConversations} atendimento{op.totalConversations !== 1 ? "s" : ""} hoje
                  </p>
                </div>
              </div>
              
              {/* Botões de Ação */}
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => setExpandedOperatorId(isExpanded ? null : op.operatorId)}
                  className="inline-flex items-center justify-center gap-1 text-[11px] font-extrabold text-primary hover:text-primary-hover bg-primary/10 hover:bg-primary/15 px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  {isExpanded ? "Fechar Ocorrências" : "Ver Ocorrências"}
                </button>
                <button
                  onClick={() => onOpenHistory(op.operatorId, op.operatorName)}
                  className="inline-flex items-center justify-center gap-1 text-[11px] font-extrabold text-foreground hover:bg-muted border border-border px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Ver Histórico
                </button>
              </div>
            </div>

            {/* Coluna 2 (Centro): Os Três Termômetros */}
            <div className="flex flex-row items-center justify-around gap-2 border-y md:border-y-0 md:border-x border-line py-3 px-4 md:col-span-6 w-full">
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Geral</span>
                <ScoreGauge score={op.avgPerformanceScore} size={90} />
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">vs Semana</span>
                <ScoreGauge score={op.avgPerformanceScoreLastWeek} size={90} />
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">vs Mês</span>
                <ScoreGauge score={op.avgPerformanceScoreLastMonth} size={90} />
              </div>
            </div>

            {/* Coluna 3: Métricas Comparativas */}
            <div className="grid grid-cols-3 gap-x-4 gap-y-2 w-full text-center md:col-span-3 text-xs">
              {/* Header */}
              <div className="col-span-3 grid grid-cols-3 border-b border-line pb-1.5 font-bold text-[9px] text-muted-foreground uppercase tracking-widest">
                <span>Tempo Médio</span>
                <span>Atrasados</span>
                <span>Sentimento</span>
              </div>
              
              {/* Row 1: Hoje */}
              <div className="col-span-3 grid grid-cols-3 items-center py-1 hover:bg-muted/30 rounded-md">
                <span className="font-bold text-foreground text-xs" title="Hoje">{op.avgResponseTimeFormatted}</span>
                <span className={`font-bold text-xs ${op.overdueCount > 0 ? "text-primary font-extrabold animate-pulse" : "text-foreground"}`}>{op.overdueCount}</span>
                <span className="font-bold text-foreground text-xs flex items-center justify-center gap-1">
                  <span>{satisfiedPct}%</span>
                  <Smile className="h-3 w-3 text-primary" />
                </span>
              </div>
              
              {/* Row 2: vs Semana */}
              <div className="col-span-3 grid grid-cols-3 items-center py-1 hover:bg-muted/30 rounded-md text-muted-foreground">
                <span className="text-[11px] font-medium" title="Média da Semana">{op.avgResponseTimeLastWeekFormatted || "–"}</span>
                <span className="text-[11px] font-medium">{op.overdueCountLastWeek ?? 0}</span>
                <span className="text-[11px] font-medium flex items-center justify-center gap-1">
                  <span>{op.satisfiedPctLastWeek ?? 0}%</span>
                  <Smile className="h-3 w-3 text-primary" />
                </span>
              </div>
              
              {/* Row 3: vs Mês */}
              <div className="col-span-3 grid grid-cols-3 items-center py-1 hover:bg-muted/30 rounded-md text-muted-foreground">
                <span className="text-[11px] font-medium" title="Média do Mês">{op.avgResponseTimeLastMonthFormatted || "–"}</span>
                <span className="text-[11px] font-medium">{op.overdueCountLastMonth ?? 0}</span>
                <span className="text-[11px] font-medium flex items-center justify-center gap-1">
                  <span>{op.satisfiedPctLastMonth ?? 0}%</span>
                  <Smile className="h-3 w-3 text-primary" />
                </span>
              </div>
            </div>

            {/* Ocorrências Recentes (Framer Motion Slide-down) */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="col-span-1 md:col-span-12 border-t border-line pt-4 mt-2 flex flex-col gap-3 overflow-hidden"
                >
                  <h4 className="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <ClipboardCheck className="h-4 w-4 text-primary" />
                    Ocorrências Recentes e Auditorias de I.A. ({operatorAudits.length})
                  </h4>
                  
                  {operatorAudits.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 italic">Nenhuma auditoria recente encontrada para este operador.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-2">
                      {operatorAudits.slice(0, 4).map((audit) => (
                        <div 
                          key={audit.id}
                          onClick={() => onSelectAudit(audit.id)}
                          className="p-4 rounded-xl border border-border bg-card hover:bg-muted/30 transition cursor-pointer flex flex-col gap-2 relative group"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Avatar name={audit.contactName || "?"} size="sm" />
                              <span className="text-xs font-bold text-foreground">{audit.contactName || "Contato"}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <ScoreBadge score={audit.performanceScore} />
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                            </div>
                          </div>
                          
                          {/* Pontos Positivos / Negativos */}
                          <div className="flex flex-col gap-1.5 text-[11px] mt-1">
                            {audit.strengths && (
                              <div className="text-primary bg-primary/5 px-2 py-1 rounded border border-primary/10">
                                <span className="font-extrabold uppercase text-[9px] tracking-wider block mb-0.5 text-primary">Pontos Fortes:</span>
                                <span className="line-clamp-2 leading-relaxed">{audit.strengths}</span>
                              </div>
                            )}
                            {audit.weaknesses && (
                              <div className="text-muted-foreground bg-muted/40 px-2 py-1 rounded border border-border">
                                <span className="font-extrabold uppercase text-[9px] tracking-wider block mb-0.5 text-foreground">Pontos a Melhorar:</span>
                                <span className="line-clamp-2 leading-relaxed">{audit.weaknesses}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

type AuditQualityFilter =
  | "all"
  | "critical"
  | "frustrated"
  | "with_flags"
  | "no_followup"
  | "long_gap"
  | "missed_objection"
  | "excellent"
  | "pending_review"
  | "reviewed"
  | "likely_test";

type AuditSortOption =
  | "recent"
  | "score_asc"
  | "score_desc"
  | "deal_value"
  | "flags_desc";

function AuditsSortSelect({
  value,
  onChange,
}: {
  value: AuditSortOption;
  onChange: (v: AuditSortOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const options: { id: AuditSortOption; label: string }[] = [
    { id: "recent", label: "Mais recentes" },
    { id: "score_asc", label: "Menor Score (Críticos 1º)" },
    { id: "score_desc", label: "Maior Score (Exemplares 1º)" },
    { id: "deal_value", label: "Maior Valor no CRM (R$)" },
    { id: "flags_desc", label: "Mais Falhas Detectadas" },
  ];

  const current = options.find((o) => o.id === value) ?? options[0];

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 bg-muted/50 hover:bg-muted border border-border rounded-xl px-3 py-1.5 text-[11px] font-bold text-foreground transition cursor-pointer"
      >
        <Filter className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="truncate max-w-[165px]">{current.label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-56 bg-card border border-border rounded-2xl shadow-xl p-1.5 space-y-0.5">
          {options.map((opt) => {
            const active = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-semibold transition cursor-pointer ${
                  active
                    ? "bg-primary/10 text-primary font-extrabold"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span>{opt.label}</span>
                {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatSecondsDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || sec <= 0) return "–";
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  if (mins === 0) return `${rem}s`;
  if (mins < 60) return `${mins}m ${String(rem).padStart(2, "0")}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function AuditsTab({
  selectedAuditId,
  onSelectAudit,
  operators = [],
}: {
  selectedAuditId?: string | null;
  onSelectAudit?: (id: string | null) => void;
  operators?: OperatorMetric[];
}) {
  const { tenant } = useChat();
  const aiPersona = getAiPersona(tenant);
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [statusCounts, setStatusCounts] = useState<AuditStatusCounts>({
    done: 0,
    pending: 0,
    processing: 0,
    error: 0,
    eligibleUnauditedCount: 0,
    dismissedTestCount: 0,
    likelyTestCount: 0,
  });
  const [apiSummary, setApiSummary] = useState<AuditsExecutiveSummary | null>(null);
  const [operatorRanking, setOperatorRanking] = useState<AuditOperatorRankingItem[]>([]);
  const [learnedRules, setLearnedRules] = useState<AuditLearnedRuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditItem | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // ── Filtros Executivos & Layout Compacto ──────────────────────────────────
  const [periodFilter, setPeriodFilter] = useState<"all" | "today" | "7d" | "30d">("all");
  const [dateFilter, setDateFilter] = useState("");
  const [operatorIdFilter, setOperatorIdFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"done" | "pending" | "error">("done");
  const [qualityFilter, setQualityFilter] = useState<AuditQualityFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<AuditSortOption>("recent");
  const [compactTop, setCompactTop] = useState(false);
  const [learnedDrawerOpen, setLearnedDrawerOpen] = useState(false);

  // ── Ações Executivas (Gaveta de Transcrição, Sussurro, CRM Modal e Scan) ──
  const [retrying, setRetrying] = useState(false);
  const [scanningEligible, setScanningEligible] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [whisperOpen, setWhisperOpen] = useState(false);
  const [whisperDraft, setWhisperDraft] = useState("");
  const [sendingWhisper, setSendingWhisper] = useState(false);
  const [fullHistoryByConv, setFullHistoryByConv] = useState<Record<string, LiveMessage[]>>({});
  const [loadingHistoryConvId, setLoadingHistoryConvId] = useState<string | null>(null);
  const [localWhispersByConv, setLocalWhispersByConv] = useState<Record<string, LiveMessage[]>>({});
  const [selectedDealModalId, setSelectedDealModalId] = useState<string | null>(null);

  // ── Estado de Validação da Diretoria & Aprendizado da Máquina ─────────────
  const [reviewVerdict, setReviewVerdict] = useState<
    "approved" | "approved_with_caveats" | "rejected_wrong" | null
  >(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewAdjustedScore, setReviewAdjustedScore] = useState<string>("");
  const [savingReview, setSavingReview] = useState(false);
  const [dismissingTestId, setDismissingTestId] = useState<string | null>(null);
  const [dismissingAllTests, setDismissingAllTests] = useState(false);

  // Sincroniza campos de revisão quando troca a auditoria selecionada
  useEffect(() => {
    if (!selected) {
      setReviewVerdict(null);
      setReviewComment("");
      setReviewAdjustedScore("");
      return;
    }
    if (selected.directorReview) {
      setReviewVerdict(selected.directorReview.verdict);
      setReviewComment(selected.directorReview.comment || "");
      setReviewAdjustedScore(
        selected.directorReview.adjustedScore !== null &&
          selected.directorReview.adjustedScore !== undefined
          ? String(selected.directorReview.adjustedScore)
          : "",
      );
    } else {
      setReviewVerdict(null);
      setReviewComment("");
      setReviewAdjustedScore("");
    }
  }, [selected?.id]);

  // ── Fetch principal com sumário executivo ─────────────────────────────────
  const fetchAudits = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({
          tenantId: tenant,
          limit: "100",
          summary: "1",
          status: statusFilter,
          period: periodFilter,
        });
        if (dateFilter) params.set("date", dateFilter);
        if (operatorIdFilter) params.set("operatorId", operatorIdFilter);

        const res = await fetch(`/api/gestao/audits?${params.toString()}`);
        if (res.ok) {
          const payload = await res.json();
          if (Array.isArray(payload)) {
            setAudits(payload);
          } else if (payload && typeof payload === "object") {
            const list: AuditItem[] = Array.isArray(payload.audits) ? payload.audits : [];
            setAudits(list);
            if (payload.statusCounts) setStatusCounts(payload.statusCounts);
            if (payload.summary) setApiSummary(payload.summary);
            if (Array.isArray(payload.operatorRanking)) {
              setOperatorRanking(payload.operatorRanking);
            }
            if (Array.isArray(payload.learnedRules)) {
              setLearnedRules(payload.learnedRules);
            }
            // Sincroniza item selecionado caso tenha atualizado
            setSelected((prev) => {
              if (!prev) return null;
              return list.find((a) => a.id === prev.id) ?? null;
            });
          }
          setLastRefresh(new Date());
        }
      } catch (e) {
        console.error("[AuditsTab] Erro ao buscar auditorias:", e);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [tenant, dateFilter, periodFilter, operatorIdFilter, statusFilter],
  );

  useEffect(() => {
    fetchAudits();
  }, [fetchAudits]);

  // Auto-refresh rápido (3.5s) enquanto houver auditorias em processamento/fila
  useEffect(() => {
    if (statusCounts.pending <= 0 && !scanningEligible) return;
    const timer = setInterval(() => {
      fetchAudits(true);
    }, 3500);
    return () => clearInterval(timer);
  }, [statusCounts.pending, scanningEligible, fetchAudits]);

  // Quando a fila zera e já existem auditorias concluídas, volta automaticamente para "Concluídas"
  useEffect(() => {
    if (
      statusFilter === "pending" &&
      statusCounts.pending === 0 &&
      statusCounts.done > 0 &&
      !loading
    ) {
      setStatusFilter("done");
    }
  }, [statusFilter, statusCounts.pending, statusCounts.done, loading]);

  // Quando selectedAuditId chega via navegação do OperatorsTab -> abre detalhe
  useEffect(() => {
    if (selectedAuditId && audits.length > 0) {
      const found = audits.find((a) => a.id === selectedAuditId);
      if (found) setSelected(found);
    }
  }, [selectedAuditId, audits]);

  // Carrega histórico completo da conversa quando o diretor abre "Espiar Conversa"
  const handleLoadFullConversation = useCallback(
    async (convId: string) => {
      if (!convId || loadingHistoryConvId === convId) return;
      setLoadingHistoryConvId(convId);
      try {
        const res = await fetch(
          `/api/gestao/messages?tenantId=${tenant}&conversationId=${convId}`,
        );
        if (res.ok) {
          const msgs: LiveMessage[] = await res.json();
          setFullHistoryByConv((prev) => ({ ...prev, [convId]: msgs }));
        }
      } catch (e) {
        console.error("[AuditsTab] Erro ao carregar histórico da conversa:", e);
      } finally {
        setLoadingHistoryConvId(null);
      }
    },
    [tenant, loadingHistoryConvId],
  );

  // Salva Validação da Diretoria / Aprendizado da IA (e opcionalmente reavalia com IA)
  const handleSubmitDirectorReview = useCallback(
    async (params: {
      auditId: string;
      verdict: "approved" | "approved_with_caveats" | "rejected_wrong";
      comment?: string;
      adjustedScore?: number | null;
      reauditWithAi?: boolean;
    }) => {
      if (
        (params.verdict === "approved_with_caveats" ||
          params.verdict === "rejected_wrong") &&
        !(params.comment || "").trim()
      ) {
        toast.error(
          params.verdict === "rejected_wrong"
            ? "Explique brevemente o erro da IA para que ela aprenda e calibre as próximas avaliações."
            : "Descreva a ressalva para registrar na memória de aprendizado da IA.",
        );
        return;
      }

      setSavingReview(true);
      try {
        const res = await fetch("/api/gestao/audits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant,
            action: "submit_review",
            auditId: params.auditId,
            verdict: params.verdict,
            comment: (params.comment || "").trim(),
            learnedRule: (params.comment || "").trim(),
            adjustedScore: params.adjustedScore ?? null,
            reauditWithAi: Boolean(params.reauditWithAi),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Não foi possível salvar a validação da Diretoria.");
        }

        if (params.reauditWithAi) {
          toast.success(
            "Aprendizado absorvido! A IA já está reavaliando este atendimento com base na sua correção.",
          );
        } else if (params.verdict === "approved") {
          toast.success("Auditoria validada como correta pela Diretoria!");
        } else if (params.verdict === "approved_with_caveats") {
          toast.success(
            "Ressalva registrada! A IA absorveu o apontamento para os próximos atendimentos.",
          );
        } else {
          toast.success(
            "Correção salva na memória da IA! As próximas auditorias já aplicarão essa regra.",
          );
        }

        await fetchAudits(true);
      } catch (err: any) {
        toast.error(err.message || "Falha ao registrar validação da Diretoria.");
      } finally {
        setSavingReview(false);
      }
    },
    [tenant, fetchAudits],
  );

  // Remove revisão / regra aprendida de uma auditoria
  const handleClearDirectorReview = useCallback(
    async (auditId: string) => {
      setSavingReview(true);
      try {
        const res = await fetch("/api/gestao/audits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant,
            action: "clear_review",
            auditId,
          }),
        });
        if (res.ok) {
          toast.info("Validação/regra removida da auditoria.");
          setReviewVerdict(null);
          setReviewComment("");
          setReviewAdjustedScore("");
          await fetchAudits(true);
        }
      } catch (e) {
        console.error("[AuditsTab] Erro ao limpar revisão:", e);
      } finally {
        setSavingReview(false);
      }
    },
    [tenant, fetchAudits],
  );

  // Descarta um atendimento de teste (individual)
  const handleDismissTestAudit = useCallback(
    async (auditId: string, contactName?: string | null, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      setDismissingTestId(auditId);
      try {
        const res = await fetch("/api/gestao/audits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant,
            action: "dismiss_test",
            auditId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Não foi possível descartar o atendimento de teste.");
        }
        toast.success(
          `Atendimento "${contactName || "Teste"}" removido das auditorias e métricas recalculadas!`,
        );
        if (selected?.id === auditId) {
          setSelected(null);
          if (onSelectAudit) onSelectAudit(null);
        }
        await fetchAudits(true);
      } catch (err: any) {
        toast.error(err.message || "Falha ao descartar atendimento de teste.");
      } finally {
        setDismissingTestId(null);
      }
    },
    [tenant, selected?.id, onSelectAudit, fetchAudits],
  );

  // Limpa em lote todos os atendimentos detectados como teste
  const handleDismissAllDetectedTests = useCallback(async () => {
    setDismissingAllTests(true);
    try {
      const res = await fetch("/api/gestao/audits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          action: "dismiss_detected_tests",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Falha ao limpar atendimentos de teste.");
      }
      const count = Number(data.dismissedCount ?? 0);
      if (count > 0) {
        toast.success(
          `${count} atendimento(s) de teste descartado(s) e scores dos consultores recalculados!`,
        );
        setSelected(null);
        if (qualityFilter === "likely_test") setQualityFilter("all");
      } else {
        toast.info("Nenhum atendimento de teste pendente para remoção.");
      }
      await fetchAudits(false);
    } catch (err: any) {
      toast.error(err.message || "Falha ao remover atendimentos de teste.");
    } finally {
      setDismissingAllTests(false);
    }
  }, [tenant, qualityFilter, fetchAudits]);

  // Dispara varredura sob demanda de conversas elegíveis
  const handleScanAndEnqueue = useCallback(
    async (forceReaudit = false) => {
      setScanningEligible(true);
      try {
        const res = await fetch("/api/gestao/audits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant,
            action: "scan_and_audit",
            operatorId: operatorIdFilter || undefined,
            limit: 15,
            force: forceReaudit,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Não foi possível enfileirar auditorias.");
        }
        const enq = Number(data.enqueuedCount ?? 0);
        const pend = Number(data.pendingTotal ?? 0);
        if (enq > 0) {
          toast.success(
            `${enq} atendimento(s) enfileirado(s) para auditoria imediata pela Vertex AI!`,
          );
          if (statusCounts.done === 0) {
            setStatusFilter("pending");
          }
        } else if (pend > 0) {
          toast.info(
            `Processando ${pend} auditoria(s) na fila da Vertex AI em tempo real...`,
          );
          if (statusCounts.done === 0) {
            setStatusFilter("pending");
          }
        } else {
          toast.info(
            "Todos os atendimentos recentes com diálogo ativo já estão auditados.",
          );
        }
        setTimeout(() => fetchAudits(false), 400);
      } catch (err: any) {
        toast.error(err.message || "Falha ao disparar auditoria de atendimentos.");
      } finally {
        setScanningEligible(false);
      }
    },
    [tenant, operatorIdFilter, statusCounts.done, fetchAudits],
  );

  // Reprocessa ou reaudita uma auditoria específica
  const retryAudit = useCallback(
    async (auditId: string, force = false) => {
      setRetrying(true);
      try {
        const res = await fetch("/api/gestao/audits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId: tenant, auditId, force }),
        });
        if (res.ok) {
          toast.success(
            force
              ? "Conversa enviada para nova auditoria da IA!"
              : "Auditoria reenviada para fila de processamento!",
          );
        }
        setTimeout(() => fetchAudits(false), 700);
      } catch (e) {
        console.error("[AuditsTab] Erro ao reprocessar auditoria:", e);
      } finally {
        setRetrying(false);
      }
    },
    [tenant, fetchAudits],
  );

  const retryAll = useCallback(async () => {
    setRetrying(true);
    try {
      await fetch("/api/gestao/audits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant, action: "retry_all" }),
      });
      toast.success("Todas as auditorias com erro foram reenviadas para processamento!");
      setSelected(null);
      setTimeout(() => fetchAudits(false), 800);
    } catch (e) {
      console.error("[AuditsTab] Erro ao reprocessar todas:", e);
    } finally {
      setRetrying(false);
    }
  }, [tenant, fetchAudits]);

  // Envia orientação interna (Sussurro do Supervisor) para a conversa auditada
  const handleSendAuditWhisper = useCallback(
    async (convId: string, contentText: string) => {
      const trimmed = contentText.trim();
      if (!trimmed || sendingWhisper) return;
      setSendingWhisper(true);
      try {
        const res = await fetch("/api/gestao/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: convId,
            content: trimmed,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Não foi possível enviar a orientação.");
        }
        const createdMsg: LiveMessage | undefined = data.message;
        if (createdMsg) {
          setLocalWhispersByConv((prev) => ({
            ...prev,
            [convId]: [...(prev[convId] || []), createdMsg],
          }));
        }
        setWhisperDraft("");
        toast.success("Orientação de auditoria enviada em tempo real ao consultor!");
      } catch (err: any) {
        toast.error(err.message || "Falha ao enviar orientação ao consultor.");
      } finally {
        setSendingWhisper(false);
      }
    },
    [sendingWhisper],
  );

  // Sumário executivo consolidado (usa apiSummary ou calcula localmente como fallback)
  const summary = useMemo<AuditsExecutiveSummary>(() => {
    if (apiSummary) return apiSummary;
    const done = audits.filter((a) => a.performanceScore !== null);
    const total = done.length;
    const scoreSum = done.reduce((s, a) => s + (a.performanceScore ?? 0), 0);
    const satisfied = done.filter((a) => a.clientSentiment === "satisfeito").length;
    const frustrated = done.filter((a) => a.clientSentiment === "frustrado").length;
    const neutral = total - satisfied - frustrated;
    const longGap = done.filter((a) => a.hadLongResponseGap).length;
    const missedObj = done.filter((a) => a.hadMissedObjection).length;
    const noFollow = done.filter((a) => a.hadNoFollowUp).length;
    const rude = done.filter((a) => a.hadRudeLanguage).length;
    const reviewed = done.filter((a) => Boolean(a.directorReview)).length;
    return {
      totalAudited: total,
      avgScore: total > 0 ? Math.round(scoreSum / total) : null,
      excellentCount: done.filter((a) => (a.performanceScore ?? 0) >= 80).length,
      attentionCount: done.filter(
        (a) => (a.performanceScore ?? 0) >= 60 && (a.performanceScore ?? 0) < 80,
      ).length,
      criticalCount: done.filter((a) => (a.performanceScore ?? 0) < 60).length,
      satisfiedCount: satisfied,
      neutralCount: neutral,
      frustratedCount: frustrated,
      satisfactionPct: total > 0 ? Math.round((satisfied / total) * 100) : null,
      totalFlagsCount: longGap + missedObj + noFollow + rude,
      longGapCount: longGap,
      missedObjectionCount: missedObj,
      noFollowUpCount: noFollow,
      rudeLanguageCount: rude,
      topFailureLabel:
        noFollow > 0
          ? `Sem próximo passo (${noFollow})`
          : longGap > 0
          ? `Demora >15m (${longGap})`
          : "Nenhuma falha crítica",
      auditedPipelineValue: 0,
      atRiskPipelineValue: 0,
      atRiskDealsCount: 0,
      wonDealsAuditedCount: 0,
      lostDealsAuditedCount: 0,
      avgPillarScores: {
        agility: total > 0 ? Math.round(scoreSum / total) : 0,
        qualification: total > 0 ? Math.round(scoreSum / total) : 0,
        objectionHandling: total > 0 ? Math.round(scoreSum / total) : 0,
        closingNextStep: total > 0 ? Math.round(scoreSum / total) : 0,
      },
      reviewedCount: reviewed,
      pendingReviewCount: Math.max(0, total - reviewed),
      learnedRulesCount: learnedRules.length,
    };
  }, [apiSummary, audits, learnedRules.length]);

  // Contadores para as pílulas de qualidade sobre a lista atual
  const qualityCounts = useMemo(() => {
    return {
      all: audits.length,
      critical: audits.filter(
        (a) => a.performanceScore !== null && a.performanceScore < 60,
      ).length,
      frustrated: audits.filter((a) => a.clientSentiment === "frustrado").length,
      with_flags: audits.filter((a) => a.flagCount > 0).length,
      no_followup: audits.filter((a) => a.hadNoFollowUp).length,
      long_gap: audits.filter((a) => a.hadLongResponseGap).length,
      missed_objection: audits.filter((a) => a.hadMissedObjection).length,
      excellent: audits.filter(
        (a) => a.performanceScore !== null && a.performanceScore >= 80,
      ).length,
      pending_review: audits.filter((a) => a.status === "done" && !a.directorReview)
        .length,
      reviewed: audits.filter((a) => Boolean(a.directorReview)).length,
      likely_test: audits.filter((a) => Boolean(a.isLikelyTest)).length,
    };
  }, [audits]);

  // Lista filtrada e ordenada
  const filteredAudits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = audits.filter((a) => {
      if (qualityFilter === "critical") {
        if (a.performanceScore === null || a.performanceScore >= 60) return false;
      } else if (qualityFilter === "frustrated") {
        if (a.clientSentiment !== "frustrado") return false;
      } else if (qualityFilter === "with_flags") {
        if (a.flagCount <= 0) return false;
      } else if (qualityFilter === "no_followup") {
        if (!a.hadNoFollowUp) return false;
      } else if (qualityFilter === "long_gap") {
        if (!a.hadLongResponseGap) return false;
      } else if (qualityFilter === "missed_objection") {
        if (!a.hadMissedObjection) return false;
      } else if (qualityFilter === "excellent") {
        if (a.performanceScore === null || a.performanceScore < 80) return false;
      } else if (qualityFilter === "pending_review") {
        if (a.directorReview) return false;
      } else if (qualityFilter === "reviewed") {
        if (!a.directorReview) return false;
      } else if (qualityFilter === "likely_test") {
        if (!a.isLikelyTest) return false;
      }

      if (q) {
        const matchContact = a.contactName?.toLowerCase().includes(q);
        const matchPhone = a.contactPhone?.toLowerCase().includes(q);
        const matchAccount = a.accountName?.toLowerCase().includes(q);
        const matchOp = a.operatorName?.toLowerCase().includes(q);
        const matchDeal = a.deal?.title?.toLowerCase().includes(q);
        const matchSummary = a.summary?.toLowerCase().includes(q);
        const matchInsight = a.actionableInsight?.toLowerCase().includes(q);
        const matchReview = a.directorReview?.comment?.toLowerCase().includes(q);
        if (
          !matchContact &&
          !matchPhone &&
          !matchAccount &&
          !matchOp &&
          !matchDeal &&
          !matchSummary &&
          !matchInsight &&
          !matchReview
        ) {
          return false;
        }
      }

      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "score_asc") {
        const sa = a.performanceScore ?? 999;
        const sb = b.performanceScore ?? 999;
        if (sa !== sb) return sa - sb;
      } else if (sortBy === "score_desc") {
        const sa = a.performanceScore ?? -1;
        const sb = b.performanceScore ?? -1;
        if (sb !== sa) return sb - sa;
      } else if (sortBy === "deal_value") {
        const va = Number(a.deal?.value ?? 0);
        const vb = Number(b.deal?.value ?? 0);
        if (vb !== va) return vb - va;
      } else if (sortBy === "flags_desc") {
        if (b.flagCount !== a.flagCount) return b.flagCount - a.flagCount;
        const sa = a.performanceScore ?? 999;
        const sb = b.performanceScore ?? 999;
        if (sa !== sb) return sa - sb;
      }
      const ta = a.auditedAt ? new Date(a.auditedAt).getTime() : 0;
      const tb = b.auditedAt ? new Date(b.auditedAt).getTime() : 0;
      return tb - ta;
    });
  }, [audits, qualityFilter, searchQuery, sortBy]);

  // Operadores disponíveis para o dropdown de filtro
  const operatorSelectList = useMemo(() => {
    if (operatorRanking.length > 0) {
      return operatorRanking.map((r) => ({
        operatorId: r.operatorId,
        operatorName: r.operatorName,
        status: r.isOnline ? "disponivel" : "ausente",
        isOnline: r.isOnline,
        waitingReplyCount: r.flagCount,
      }));
    }
    return operators.map((o) => ({
      operatorId: o.operatorId,
      operatorName: o.operatorName,
      status: o.status,
    }));
  }, [operatorRanking, operators]);

  function renderAuditSentimentBadge(sentiment?: string | null, compact = false) {
    if (sentiment === "satisfeito") {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-bold ${
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-2.5 py-0.5 text-[10px]"
          }`}
        >
          <Smile className="h-3 w-3 shrink-0" />
          <span>Satisfeito</span>
        </span>
      );
    }
    if (sentiment === "frustrado") {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground font-extrabold ${
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-2.5 py-0.5 text-[10px]"
          }`}
        >
          <Frown className="h-3 w-3 shrink-0" />
          <span>Frustrado</span>
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border border-border font-semibold ${
          compact ? "px-1.5 py-0.5 text-[9px]" : "px-2.5 py-0.5 text-[10px]"
        }`}
      >
        <Meh className="h-3 w-3 shrink-0" />
        <span>Neutro</span>
      </span>
    );
  }

  function renderDirectorReviewBadge(
    review?: AuditDirectorReview | null,
    compact = false,
  ) {
    if (!review) {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md bg-muted/70 text-muted-foreground border border-border font-semibold ${
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"
          }`}
        >
          <Clock className="h-2.5 w-2.5 shrink-0" />
          <span>Pendente Validação</span>
        </span>
      );
    }
    if (review.verdict === "approved") {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary border border-primary/25 font-extrabold ${
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"
          }`}
        >
          <CheckCheck className="h-2.5 w-2.5 shrink-0" />
          <span>Validado Diretoria</span>
        </span>
      );
    }
    if (review.verdict === "approved_with_caveats") {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md bg-primary/15 text-primary border border-primary/30 font-extrabold ${
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"
          }`}
        >
          <Sparkles className="h-2.5 w-2.5 shrink-0" />
          <span>Ressalva Aprendida</span>
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground font-extrabold ${
          compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"
        }`}
      >
        <Bot className="h-2.5 w-2.5 shrink-0" />
        <span>IA Corrigida</span>
      </span>
    );
  }

  function AuditStatusBadge({ status }: { status?: string }) {
    if (!status || status === "done") return null;
    if (status === "processing") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-extrabold">
          <Cpu className="h-3 w-3 animate-pulse" /> Processando IA
        </span>
      );
    }
    if (status === "pending") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border text-[10px] font-extrabold">
          <Clock className="h-3 w-3" /> Na Fila
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 text-foreground border border-border text-[10px] font-extrabold">
        <XCircle className="h-3 w-3 text-primary" /> Erro
      </span>
    );
  }

  const isTopCompact = compactTop || Boolean(selected);
  const detectedTestsCount = Math.max(
    statusCounts.likelyTestCount ?? 0,
    qualityCounts.likely_test,
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto lg:overflow-hidden scrollbar-thin pr-0.5 gap-2.5 pb-1">
      {/* ── BLOCO 1 & 2: INDICADORES DE TOPO (MODO COMPACTO OU EXPANDIDO) ── */}
      {isTopCompact ? (
        <div className="bg-card rounded-2xl border border-border shadow-soft px-3.5 py-2 flex items-center justify-between gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <button
              type="button"
              onClick={() => {
                setStatusFilter("done");
                setQualityFilter((prev) => (prev === "critical" ? "all" : "critical"));
              }}
              className="inline-flex items-center gap-1.5 font-bold text-foreground hover:text-primary transition cursor-pointer"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span>Score QA:</span>
              <strong className="font-black text-foreground">
                {summary.avgScore !== null ? `${summary.avgScore}/100` : "–"}
              </strong>
              {summary.criticalCount > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-primary text-primary-foreground text-[9px] font-extrabold">
                  {summary.criticalCount} crít.
                </span>
              )}
            </button>

            <span className="text-border">|</span>

            <button
              type="button"
              onClick={() => {
                setStatusFilter("done");
                setQualityFilter((prev) => (prev === "frustrated" ? "all" : "frustrated"));
              }}
              className="inline-flex items-center gap-1.5 font-bold text-foreground hover:text-primary transition cursor-pointer"
            >
              <Smile className="h-3.5 w-3.5 text-primary" />
              <span>Aprovação:</span>
              <strong className="font-black text-foreground">
                {summary.satisfactionPct !== null ? `${summary.satisfactionPct}%` : "–"}
              </strong>
              {summary.frustratedCount > 0 && (
                <span className="text-[10px] text-primary font-extrabold">
                  ({summary.frustratedCount} frustr.)
                </span>
              )}
            </button>

            <span className="text-border hidden sm:inline">|</span>

            <span className="hidden sm:inline-flex items-center gap-1.5 text-muted-foreground">
              <Briefcase className="h-3.5 w-3.5 text-primary" />
              <span>Pipeline Auditado:</span>
              <strong className="text-foreground font-extrabold">
                {summary.auditedPipelineValue.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                  maximumFractionDigits: 0,
                })}
              </strong>
            </span>

            <span className="text-border hidden md:inline">|</span>

            <span className="hidden md:inline-flex items-center gap-1.5 text-muted-foreground">
              <Bot className="h-3.5 w-3.5 text-primary" />
              <span>Validadas Diretoria:</span>
              <strong className="text-foreground font-extrabold">
                {summary.reviewedCount ?? 0}/{summary.totalAudited}
              </strong>
            </span>
          </div>

          {/* Consultores em Pílulas Compactas + Botão Expandir KPIs */}
          <div className="flex items-center gap-1.5 ml-auto overflow-x-auto scrollbar-none">
            {operatorRanking.slice(0, 5).map((op) => {
              const isOpSelected = operatorIdFilter === op.operatorId;
              return (
                <button
                  key={op.operatorId}
                  type="button"
                  onClick={() =>
                    setOperatorIdFilter((prev) => (prev === op.operatorId ? "" : op.operatorId))
                  }
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer shrink-0 ${
                    isOpSelected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 hover:bg-muted text-foreground border-border"
                  }`}
                >
                  <span className="truncate max-w-[90px]">{op.operatorName.split(" ")[0]}</span>
                  <span
                    className={`px-1 rounded text-[9px] font-black ${
                      isOpSelected ? "bg-white/25 text-white" : "bg-primary/15 text-primary"
                    }`}
                  >
                    {op.avgScore}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setCompactTop(false)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-border text-[10px] font-bold transition cursor-pointer shrink-0"
            >
              <ChevronDown className="h-3 w-3 text-primary" />
              <span>Expandir KPIs</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── BLOCO 1: COCKPIT EXECUTIVO DE QUALIDADE DA DIRETORIA (4 KPIs) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 shrink-0">
            {/* KPI 1: Score Médio de Qualidade (QA) */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter("done");
                setQualityFilter((prev) => (prev === "critical" ? "all" : "critical"));
              }}
              className={`text-left bg-card rounded-2xl p-3 border shadow-soft transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                qualityFilter === "critical"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Score Médio de Qualidade (QA)
                </span>
                <div className="h-6 w-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xl font-black text-foreground">
                  {summary.avgScore !== null ? `${summary.avgScore}/100` : "–"}
                </span>
                {summary.criticalCount > 0 && (
                  <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground animate-pulse">
                    {summary.criticalCount} crítico{summary.criticalCount !== 1 ? "s" : ""} (&lt;60)
                  </span>
                )}
                {summary.excellentCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                    {summary.excellentCount} excelente{summary.excellentCount !== 1 ? "s" : ""} (80+)
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground truncate">
                {summary.totalAudited > 0
                  ? `${summary.totalAudited} auditado(s) · ${summary.reviewedCount ?? 0} validado(s) pela Diretoria`
                  : statusCounts.pending > 0
                  ? `${statusCounts.pending} atendimento(s) em análise pela IA neste momento`
                  : "Clique em 'Auditar Atendimentos' para avaliar as conversas"}
              </p>
            </button>

            {/* KPI 2: Sentimento & Experiência do Cliente */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter("done");
                setQualityFilter((prev) => (prev === "frustrated" ? "all" : "frustrated"));
              }}
              className={`text-left bg-card rounded-2xl p-3 border shadow-soft transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                qualityFilter === "frustrated"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Sentimento dos Clientes
                </span>
                <div className="h-6 w-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <Smile className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xl font-black text-foreground">
                  {summary.satisfactionPct !== null ? `${summary.satisfactionPct}%` : "–"}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground">
                  de aprovação
                </span>
                {summary.frustratedCount > 0 && (
                  <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground">
                    {summary.frustratedCount} frustrado{summary.frustratedCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground truncate">
                Satisfeitos: <strong className="text-foreground">{summary.satisfiedCount}</strong> ·
                Neutros: <strong className="text-foreground">{summary.neutralCount}</strong> ·
                Frustrados: <strong className="text-foreground">{summary.frustratedCount}</strong>
              </p>
            </button>

            {/* KPI 3: Receita Auditada & Risco Comercial no CRM */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter("done");
                setSortBy((prev) => (prev === "deal_value" ? "recent" : "deal_value"));
              }}
              className={`text-left bg-card rounded-2xl p-3 border shadow-soft transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                sortBy === "deal_value"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Receita Auditada & Risco CRM
                </span>
                <div className="h-6 w-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <Briefcase className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-lg font-black text-foreground truncate">
                  {summary.auditedPipelineValue.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                    maximumFractionDigits: 0,
                  })}
                </span>
                {summary.atRiskPipelineValue > 0 && (
                  <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/25">
                    {summary.atRiskPipelineValue.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                      maximumFractionDigits: 0,
                    })}{" "}
                    em risco
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground truncate">
                <strong className="text-foreground">{summary.atRiskDealsCount}</strong> negócio(s) com
                alerta QA · Ganhas:{" "}
                <strong className="text-foreground">{summary.wonDealsAuditedCount}</strong> · Perdidas:{" "}
                <strong className="text-foreground">{summary.lostDealsAuditedCount}</strong>
              </p>
            </button>

            {/* KPI 4: Raio-X de Falhas Operacionais (Top Ofensores) */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter("done");
                setQualityFilter((prev) => (prev === "with_flags" ? "all" : "with_flags"));
              }}
              className={`text-left bg-card rounded-2xl p-3 border shadow-soft transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                qualityFilter === "with_flags"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Incidência de Falhas QA
                </span>
                <div className="h-6 w-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xl font-black text-foreground">
                  {summary.totalFlagsCount}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground">
                  apontamentos da IA
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">
                S/ Follow-up: <strong className="text-foreground">{summary.noFollowUpCount}</strong> ·
                Demora: <strong className="text-foreground">{summary.longGapCount}</strong> · Objeção:{" "}
                <strong className="text-foreground">{summary.missedObjectionCount}</strong> · Postura:{" "}
                <strong className="text-foreground">{summary.rudeLanguageCount}</strong>
              </p>
            </button>
          </div>

          {/* ── BLOCO 2: FAIXA DE QUALIDADE POR CONSULTOR (CLICÁVEL) ──────────── */}
          {operatorRanking.length > 0 && (
            <div className="bg-card rounded-2xl border border-border shadow-soft px-3.5 py-2.5 shrink-0">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-foreground">
                    Qualidade & Incidência de Falhas por Consultor
                  </span>
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">
                    (Clique para filtrar)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {operatorIdFilter && (
                    <button
                      type="button"
                      onClick={() => setOperatorIdFilter("")}
                      className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
                    >
                      Limpar filtro de consultor
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setCompactTop(true)}
                    className="text-[10px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Recolher indicadores
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-0.5">
                {operatorRanking.map((op) => {
                  const isSelected = operatorIdFilter === op.operatorId;
                  return (
                    <SystemTooltip
                      key={op.operatorId}
                      content={`${op.operatorName} · Score Médio: ${op.avgScore}/100 · ${op.auditedCount} auditoria(s) · ${op.flagCount} falha(s) detectada(s)`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOperatorIdFilter((prev) =>
                            prev === op.operatorId ? "" : op.operatorId,
                          )
                        }
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-left transition cursor-pointer shrink-0 ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-muted/30 hover:bg-muted/60 text-foreground border-border"
                        }`}
                      >
                        <div className="relative shrink-0">
                          <Avatar name={op.operatorName} avatar={op.operatorAvatar} size="sm" />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-card ${
                              op.isOnline ? "bg-primary" : "bg-muted-foreground/45"
                            }`}
                          />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-extrabold truncate max-w-[115px]">
                              {op.operatorName}
                            </span>
                            <span
                              className={`text-[9px] font-black px-1.5 py-0.2 rounded-md ${
                                isSelected
                                  ? "bg-white/25 text-white"
                                  : op.avgScore >= 75
                                  ? "bg-primary/15 text-primary"
                                  : "bg-muted text-foreground border border-border"
                              }`}
                            >
                              {op.avgScore} pts
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5 text-[9px]">
                            <span
                              className={
                                isSelected ? "text-primary-foreground/90" : "text-muted-foreground"
                              }
                            >
                              {op.auditedCount} aud.
                            </span>
                            {op.flagCount > 0 && (
                              <span
                                className={`font-extrabold ${
                                  isSelected ? "text-white" : "text-primary"
                                }`}
                              >
                                · {op.flagCount} falha{op.flagCount !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </SystemTooltip>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── BLOCO 3: BARRA DE COMANDO, MEMÓRIA DA IA E FILTROS EXECUTIVOS ── */}
      <div className="bg-card rounded-2xl border border-border shadow-soft px-3.5 py-2.5 space-y-2 shrink-0">
        {/* Linha Superior: Status Tabs + Período Rápido + Data + Memória IA + Limpar Testes + Ações */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Abas de Status com Contadores Reais */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1 shrink-0">
            {(
              [
                {
                  id: "done" as const,
                  label: "Concluídas",
                  count: statusCounts.done,
                  icon: CheckCircle2,
                },
                {
                  id: "pending" as const,
                  label: statusCounts.processing > 0 ? "Processando IA" : "Na Fila",
                  count: statusCounts.pending,
                  icon: statusCounts.processing > 0 ? Cpu : Clock,
                },
                {
                  id: "error" as const,
                  label: "Com Erro",
                  count: statusCounts.error,
                  icon: XCircle,
                },
              ]
            ).map((s) => {
              const Icon = s.icon;
              const active = statusFilter === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setStatusFilter(s.id);
                    setSelected(null);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    active
                      ? "bg-card shadow-sm text-foreground border border-border/60"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 ${
                      active || s.id === "done" ? "text-primary" : "text-muted-foreground"
                    } ${s.id === "pending" && statusCounts.processing > 0 ? "animate-spin" : ""}`}
                  />
                  <span>{s.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9px] font-extrabold ${
                      active
                        ? "bg-primary/15 text-primary"
                        : s.count > 0
                        ? "bg-muted text-foreground"
                        : "bg-muted/60 text-muted-foreground"
                    }`}
                  >
                    {s.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Seletor de Período Rápido */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-xl p-1 shrink-0">
            {(
              [
                { id: "all" as const, label: "Tudo" },
                { id: "today" as const, label: "Hoje" },
                { id: "7d" as const, label: "7 dias" },
                { id: "30d" as const, label: "30 dias" },
              ]
            ).map((p) => {
              const active = !dateFilter && periodFilter === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setDateFilter("");
                    setPeriodFilter(p.id);
                  }}
                  className={`px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    active
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Date Picker Específico */}
          <div className="w-36 shrink-0">
            <LiveDatePicker
              value={dateFilter}
              onChange={(val) => {
                setDateFilter(val);
                if (val) setPeriodFilter("all");
              }}
            />
          </div>

          {/* Ações à Direita: Limpar Testes + Memória de Aprendizado IA + Auditar + Atualizar */}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {detectedTestsCount > 0 && (
              <SystemTooltip
                content={`Descartar ${detectedTestsCount} atendimento(s) identificado(s) como teste interno e recalcular imediatamente a média dos consultores`}
              >
                <button
                  type="button"
                  onClick={handleDismissAllDetectedTests}
                  disabled={dismissingAllTests}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/15 border border-primary/25 px-2.5 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  {dismissingAllTests ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  <span>Limpar Testes ({detectedTestsCount})</span>
                </button>
              </SystemTooltip>
            )}

            <SystemTooltip
              content={`Ver regras e correções ensinadas pela Diretoria que a IA (${aiPersona.name}) aplica automaticamente nas auditorias`}
            >
              <button
                type="button"
                onClick={() => setLearnedDrawerOpen((o) => !o)}
                className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-xl border transition cursor-pointer ${
                  learnedDrawerOpen
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 hover:bg-muted text-foreground border-border"
                }`}
              >
                <Bot className="h-3.5 w-3.5 text-primary" />
                <span>Memória da IA</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[9px] font-extrabold ${
                    learnedDrawerOpen
                      ? "bg-white/25 text-white"
                      : learnedRules.length > 0
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {learnedRules.length}
                </span>
              </button>
            </SystemTooltip>

            {statusFilter === "error" && audits.length > 0 && (
              <button
                type="button"
                onClick={retryAll}
                disabled={retrying || loading}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary hover:opacity-90 bg-primary/10 border border-primary/20 px-2.5 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-40"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
                <span>Reprocessar Todos</span>
              </button>
            )}

            <SystemTooltip
              content={
                statusCounts.eligibleUnauditedCount > 0
                  ? `Existem ${statusCounts.eligibleUnauditedCount} atendimento(s) com diálogo real prontos para serem auditados pela IA (${aiPersona.name})`
                  : `Verificar e auditar novos atendimentos da operação com ${aiPersona.name} IA`
              }
            >
              <button
                type="button"
                onClick={() => handleScanAndEnqueue(false)}
                disabled={scanningEligible}
                className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-primary-foreground bg-primary hover:opacity-95 px-3 py-1.5 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {scanningEligible ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span>Auditar Atendimentos</span>
                {statusCounts.eligibleUnauditedCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-white/25 text-white text-[9px] font-black">
                    +{statusCounts.eligibleUnauditedCount}
                  </span>
                )}
              </button>
            </SystemTooltip>

            <button
              type="button"
              onClick={() => fetchAudits(false)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-foreground bg-muted/50 hover:bg-muted border border-border px-2.5 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-primary ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
          </div>
        </div>

        {/* Gaveta Expansível: Memória de Aprendizado & Calibração da Diretoria */}
        <AnimatePresence>
          {learnedDrawerOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-muted/30 border border-border rounded-xl p-3 space-y-2 mt-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-foreground">
                      Regras & Aprendizados Absorvidos pela IA ({learnedRules.length})
                    </span>
                    <span className="text-[10px] text-muted-foreground hidden md:inline">
                      (Injetados automaticamente no prompt das próximas auditorias)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLearnedDrawerOpen(false)}
                    className="text-[10px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Fechar
                  </button>
                </div>

                {learnedRules.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    Nenhuma correção ou ressalva registrada ainda. Ao inspecionar qualquer relatório
                    ao lado, você pode validar se a IA avaliou certo, apontar ressalvas ou corrigir
                    erros para que a máquina aprenda continuamente.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-44 overflow-y-auto scrollbar-thin pr-1">
                    {learnedRules.map((rule) => (
                      <div
                        key={rule.auditId}
                        className="bg-card border border-border rounded-xl p-2.5 flex flex-col justify-between gap-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                              rule.verdict === "rejected_wrong"
                                ? "bg-primary text-primary-foreground"
                                : "bg-primary/15 text-primary border border-primary/25"
                            }`}
                          >
                            {rule.verdict === "rejected_wrong"
                              ? "Correção de Erro da IA"
                              : "Ressalva da Diretoria"}
                          </span>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            {rule.originalAiScore !== null &&
                              rule.adjustedScore !== null &&
                              rule.originalAiScore !== rule.adjustedScore && (
                                <span className="font-bold text-foreground">
                                  Nota: {rule.originalAiScore} → {rule.adjustedScore}
                                </span>
                              )}
                            <button
                              type="button"
                              onClick={() => handleClearDirectorReview(rule.auditId)}
                              className="text-muted-foreground hover:text-primary cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-foreground font-medium leading-snug">
                          &ldquo;{rule.learnedRule}&rdquo;
                        </p>
                        <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                          <span>
                            Caso: <strong className="text-foreground">{rule.contactName}</strong> ·
                            Por {rule.reviewedByOperatorName}
                          </span>
                          <span>
                            {new Date(rule.reviewedAt).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Linha Inferior: Pílulas de Filtro de Qualidade/Falha/Validação + Busca + Consultor + Ordenação */}
        {statusFilter === "done" && (
          <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-border/60">
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-0.5 max-w-full">
              {(
                [
                  { id: "all" as const, label: "Todas", count: qualityCounts.all, icon: Layers },
                  {
                    id: "pending_review" as const,
                    label: "Aguardando Diretoria",
                    count: qualityCounts.pending_review,
                    icon: ClipboardCheck,
                  },
                  {
                    id: "reviewed" as const,
                    label: "Validadas / Calibradas",
                    count: qualityCounts.reviewed,
                    icon: CheckCheck,
                  },
                  {
                    id: "critical" as const,
                    label: "Críticas (<60)",
                    count: qualityCounts.critical,
                    icon: Flame,
                  },
                  {
                    id: "frustrated" as const,
                    label: "Frustrado",
                    count: qualityCounts.frustrated,
                    icon: Frown,
                  },
                  {
                    id: "with_flags" as const,
                    label: "Com Falhas",
                    count: qualityCounts.with_flags,
                    icon: AlertTriangle,
                  },
                  {
                    id: "excellent" as const,
                    label: "Excelentes (80+)",
                    count: qualityCounts.excellent,
                    icon: CheckCircle2,
                  },
                  ...(qualityCounts.likely_test > 0
                    ? [
                        {
                          id: "likely_test" as const,
                          label: "Suspeita de Teste",
                          count: qualityCounts.likely_test,
                          icon: FlaskConical,
                        },
                      ]
                    : []),
                ]
              ).map((pill) => {
                const Icon = pill.icon;
                const active = qualityFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setQualityFilter(pill.id)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[10px] font-bold transition cursor-pointer shrink-0 border ${
                      active
                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                        : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border"
                    }`}
                  >
                    <Icon className="h-3 w-3 shrink-0" />
                    <span>{pill.label}</span>
                    <span
                      className={`px-1.5 py-0.1 rounded-full text-[9px] font-extrabold ${
                        active
                          ? "bg-white/25 text-white"
                          : pill.count > 0
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {pill.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 ml-auto flex-1 min-w-[260px] justify-end">
              <div className="relative flex-1 max-w-xs min-w-[160px]">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar cliente, consultor, resumo..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl pl-8 pr-6 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {operatorSelectList.length > 0 && (
                <div className="w-44 shrink-0 hidden sm:block">
                  <LiveOperatorSelect
                    value={operatorIdFilter}
                    onChange={setOperatorIdFilter}
                    operators={operatorSelectList as any}
                  />
                </div>
              )}

              <AuditsSortSelect value={sortBy} onChange={setSortBy} />
            </div>
          </div>
        )}
      </div>

      {/* ── BLOCO 4: CONTEÚDO PRINCIPAL (ALTURA TOTAL ALINHADA SEM PAREDE INVISÍVEL) ── */}
      {loading && audits.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-16 gap-3 text-muted-foreground bg-card rounded-2xl border border-border">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          <span className="text-xs font-semibold">
            Carregando auditorias de qualidade e cruzando negociações do CRM...
          </span>
        </div>
      ) : filteredAudits.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-14 px-4 gap-4 text-muted-foreground bg-card rounded-2xl border border-border">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            {statusCounts.pending > 0 ? (
              <Cpu className="h-7 w-7 text-primary animate-pulse" />
            ) : (
              <Zap className="h-7 w-7 text-primary" />
            )}
          </div>
          <div className="text-center max-w-md space-y-1.5">
            <p className="font-extrabold text-foreground text-sm">
              {statusFilter === "done" && statusCounts.pending > 0
                ? `A Vertex AI está processando ${statusCounts.pending} auditoria(s) neste instante`
                : statusFilter === "done" && statusCounts.eligibleUnauditedCount > 0
                ? `${statusCounts.eligibleUnauditedCount} atendimento(s) prontos para auditoria imediata`
                : statusFilter === "done"
                ? "Nenhuma auditoria encontrada para os filtros atuais"
                : statusFilter === "pending"
                ? "Nenhum atendimento aguardando processamento na fila"
                : "Nenhum erro de processamento encontrado"}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {statusFilter === "done" && statusCounts.pending > 0
                ? "Os diagnósticos de qualidade, score por pilar e insights para a Diretoria aparecerão aqui automaticamente assim que concluídos."
                : statusFilter === "done" && statusCounts.eligibleUnauditedCount > 0
                ? "Clique no botão abaixo para auditar imediatamente os atendimentos recentes com diálogo entre cliente e consultor."
                : statusFilter === "done"
                ? "As auditorias são geradas automaticamente ao finalizar atendimentos, ao fechar negócios (Venda/Perda) no CRM ou sob demanda."
                : statusFilter === "pending"
                ? "Você pode enviar novos atendimentos recentes para análise clicando em 'Auditar Atendimentos'."
                : "Todas as auditorias da fila foram processadas sem falhas."}
            </p>

            <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
              {statusFilter === "done" && statusCounts.pending > 0 && (
                <button
                  type="button"
                  onClick={() => setStatusFilter("pending")}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted hover:bg-muted/80 text-foreground border border-border text-xs font-bold transition cursor-pointer"
                >
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  <span>Ver Fila de Processamento ({statusCounts.pending})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleScanAndEnqueue(false)}
                disabled={scanningEligible}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-95 text-xs font-extrabold shadow-sm transition cursor-pointer disabled:opacity-50"
              >
                {scanningEligible ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span>
                  {statusCounts.eligibleUnauditedCount > 0
                    ? `Auditar ${statusCounts.eligibleUnauditedCount} Atendimento(s) Agora`
                    : "Buscar & Auditar Atendimentos Recentes"}
                </span>
              </button>

              {(dateFilter ||
                periodFilter !== "all" ||
                operatorIdFilter ||
                qualityFilter !== "all" ||
                searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFilter("");
                    setPeriodFilter("all");
                    setOperatorIdFilter("");
                    setQualityFilter("all");
                    setSearchQuery("");
                  }}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-muted/50 hover:bg-muted text-primary text-xs font-bold transition cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Limpar filtros</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 flex-1 min-h-0">
          {/* ── COLUNA ESQUERDA: LISTA DE AUDITORIAS 360º (ALTURA 100% ALINHADA) ── */}
          <div className="lg:col-span-4 flex flex-col gap-2 lg:h-full min-h-0 overflow-y-auto scrollbar-thin pr-1">
            {filteredAudits.map((audit) => {
              const isSelected = selected?.id === audit.id;
              const isCritical =
                audit.performanceScore !== null && audit.performanceScore < 60;
              const dealVal = Number(audit.deal?.value ?? 0);

              return (
                <div
                  key={audit.id}
                  onClick={() => {
                    setSelected(audit);
                    setInspectOpen(false);
                    setWhisperOpen(false);
                    if (onSelectAudit) onSelectAudit(audit.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(audit);
                      setInspectOpen(false);
                      setWhisperOpen(false);
                      if (onSelectAudit) onSelectAudit(audit.id);
                    }
                  }}
                  className={`group w-full text-left p-3 rounded-2xl border transition cursor-pointer flex flex-col gap-1.5 shrink-0 ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : isCritical
                      ? "border-primary/35 bg-card hover:bg-muted/40"
                      : "border-border bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Avatar
                        name={audit.contactName || "Cliente"}
                        avatar={audit.contactAvatar}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-extrabold text-foreground truncate">
                            {audit.contactName ?? "Cliente"}
                          </p>
                          {audit.isLikelyTest && (
                            <span className="shrink-0 text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-primary/15 text-primary border border-primary/30">
                              Teste?
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                          <span>Consultor: {audit.operatorName}</span>
                          {audit.accountName && (
                            <span className="truncate">· {audit.accountName}</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {audit.performanceScore !== null ? (
                        <ScoreBadge score={audit.performanceScore} />
                      ) : (
                        <AuditStatusBadge status={audit.status} />
                      )}
                    </div>
                  </div>

                  {audit.summary && (
                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                      {audit.summary}
                    </p>
                  )}

                  <div className="flex items-center flex-wrap gap-1.5 pt-1 border-t border-border/50">
                    {audit.status === "done" &&
                      renderAuditSentimentBadge(audit.clientSentiment, true)}

                    {audit.status === "done" &&
                      renderDirectorReviewBadge(audit.directorReview, true)}

                    {audit.flagCount > 0 && (
                      <span className="text-[9px] font-extrabold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md border border-primary/20">
                        {audit.flagCount} falha{audit.flagCount > 1 ? "s" : ""}
                      </span>
                    )}

                    {dealVal > 0 && (
                      <span className="text-[9px] font-bold text-foreground bg-muted px-1.5 py-0.5 rounded-md border border-border">
                        {dealVal.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                          maximumFractionDigits: 0,
                        })}
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-1.5">
                      {(audit.auditedAt || audit.createdAt) && (
                        <span className="text-[9px] text-muted-foreground font-medium">
                          {new Date(
                            (audit.auditedAt || audit.createdAt) as string,
                          ).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}

                      <SystemTooltip content="Remover atendimento de teste (não contabilizar nas métricas)">
                        <button
                          type="button"
                          onClick={(e) =>
                            handleDismissTestAudit(audit.id, audit.contactName, e)
                          }
                          disabled={dismissingTestId === audit.id}
                          className="opacity-70 group-hover:opacity-100 p-1 rounded-lg hover:bg-primary/15 text-muted-foreground hover:text-primary transition cursor-pointer"
                        >
                          {dismissingTestId === audit.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </button>
                      </SystemTooltip>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── COLUNA DIREITA: OVERVIEW DA DIRETORIA OU FICHA 360º (ALTURA 100% ALINHADA) ── */}
          <div className="lg:col-span-8 flex flex-col min-w-0 lg:h-full min-h-0 overflow-y-auto scrollbar-thin pr-1">
            {!selected ? (
              /* ── MODO 1: COCKPIT OVERVIEW ANALÍTICO DA DIRETORIA ──────── */
              <div className="bg-card rounded-2xl border border-border shadow-soft p-5 space-y-5 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border">
                  <div>
                    <h2 className="text-sm font-extrabold text-foreground flex items-center gap-2">
                      <LayoutDashboard className="h-4 w-4 text-primary" />
                      <span>Visão Geral Executiva de Qualidade Comercial (QA)</span>
                    </h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Diagnóstico consolidado dos 4 pilares comerciais, atendimentos que exigem
                      intervenção imediata e exemplos de excelência.
                    </p>
                  </div>
                  {filteredAudits.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelected(filteredAudits[0])}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 text-[11px] font-extrabold transition cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Inspecionar 1ª Auditoria</span>
                    </button>
                  )}
                </div>

                {/* 1. Desempenho Médio da Equipe nos 4 Pilares do Playbook */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      Desempenho da Operação por Pilar do Playbook
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Ofensor principal:{" "}
                      <strong className="text-primary">{summary.topFailureLabel}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {(
                      [
                        {
                          label: "Agilidade & SLA",
                          score: summary.avgPillarScores.agility,
                          failText: `${summary.longGapCount} c/ demora >15m`,
                          icon: Timer,
                        },
                        {
                          label: "Qualificação Técnica",
                          score: summary.avgPillarScores.qualification,
                          failText: `${summary.rudeLanguageCount} falha(s) postura`,
                          icon: Sparkles,
                        },
                        {
                          label: "Gestão de Objeções",
                          score: summary.avgPillarScores.objectionHandling,
                          failText: `${summary.missedObjectionCount} objeção(ões) ignorada(s)`,
                          icon: ShieldCheck,
                        },
                        {
                          label: "Fechamento & Follow-up",
                          score: summary.avgPillarScores.closingNextStep,
                          failText: `${summary.noFollowUpCount} sem próximo passo`,
                          icon: CheckCircle2,
                        },
                      ] as const
                    ).map((p) => {
                      const PIcon = p.icon;
                      return (
                        <div
                          key={p.label}
                          className="bg-muted/30 rounded-xl border border-border p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                              <PIcon className="h-3.5 w-3.5 text-primary" />
                              {p.label}
                            </span>
                            <span className="text-xs font-black text-foreground">
                              {p.score}/100
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-500"
                              style={{ width: `${Math.min(100, Math.max(0, p.score))}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground">{p.failText}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Radar Duplo: Prioridades de Intervenção vs. Atendimentos Exemplares */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Coluna A: Prioridades de Intervenção da Diretoria */}
                  <div className="bg-muted/20 rounded-2xl border border-border p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-primary flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>Prioridades de Intervenção (Críticos / Falhas)</span>
                      </span>
                    </div>
                    {filteredAudits
                      .filter(
                        (a) =>
                          (a.performanceScore !== null && a.performanceScore < 70) ||
                          a.clientSentiment === "frustrado" ||
                          a.flagCount > 0,
                      )
                      .sort(
                        (a, b) =>
                          (a.performanceScore ?? 100) - (b.performanceScore ?? 100),
                      )
                      .slice(0, 4)
                      .map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelected(item)}
                          className="w-full text-left p-2.5 rounded-xl bg-card hover:bg-muted/60 border border-border transition cursor-pointer flex flex-col gap-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-foreground truncate">
                              {item.contactName} ·{" "}
                              <span className="font-semibold text-muted-foreground">
                                {item.operatorName}
                              </span>
                            </span>
                            <ScoreBadge score={item.performanceScore} />
                          </div>
                          {item.actionableInsight && (
                            <p className="text-[10px] text-primary font-semibold line-clamp-2">
                              {item.actionableInsight}
                            </p>
                          )}
                        </button>
                      ))}
                    {filteredAudits.filter(
                      (a) =>
                        (a.performanceScore !== null && a.performanceScore < 70) ||
                        a.clientSentiment === "frustrado" ||
                        a.flagCount > 0,
                    ).length === 0 && (
                      <p className="text-xs text-muted-foreground py-4 text-center">
                        Nenhum atendimento crítico ou com falha registrado neste recorte.
                      </p>
                    )}
                  </div>

                  {/* Coluna B: Atendimentos Exemplares (Benchmarks de Treinamento) */}
                  <div className="bg-muted/20 rounded-2xl border border-border p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                        <span>Destaques de Excelência (Score 80+)</span>
                      </span>
                    </div>
                    {filteredAudits
                      .filter(
                        (a) => a.performanceScore !== null && a.performanceScore >= 80,
                      )
                      .sort(
                        (a, b) =>
                          (b.performanceScore ?? 0) - (a.performanceScore ?? 0),
                      )
                      .slice(0, 4)
                      .map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelected(item)}
                          className="w-full text-left p-2.5 rounded-xl bg-card hover:bg-muted/60 border border-border transition cursor-pointer flex flex-col gap-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-foreground truncate">
                              {item.contactName} ·{" "}
                              <span className="font-semibold text-muted-foreground">
                                {item.operatorName}
                              </span>
                            </span>
                            <ScoreBadge score={item.performanceScore} />
                          </div>
                          {item.strengths && (
                            <p className="text-[10px] text-muted-foreground line-clamp-2">
                              {item.strengths}
                            </p>
                          )}
                        </button>
                      ))}
                    {filteredAudits.filter(
                      (a) => a.performanceScore !== null && a.performanceScore >= 80,
                    ).length === 0 && (
                      <p className="text-xs text-muted-foreground py-4 text-center">
                        Nenhum atendimento com score acima de 80 neste filtro.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* ── MODO 2: FICHA DE AUDITORIA 360º SELECIONADA ─────────── */
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card rounded-2xl border border-border shadow-soft p-4 sm:p-5 flex flex-col gap-3.5 flex-1"
              >
                {/* Barra de Topo: Voltar ao Overview + Descartar Teste + Reauditar */}
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-border flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      if (onSelectAudit) onSelectAudit(null);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 text-primary" />
                    <span>Voltar ao Overview da Diretoria</span>
                  </button>

                  <div className="flex items-center gap-2 flex-wrap">
                    <SystemTooltip content="Remover este atendimento caso seja apenas um teste interno (recalcula o score do consultor)">
                      <button
                        type="button"
                        onClick={() =>
                          handleDismissTestAudit(selected.id, selected.contactName)
                        }
                        disabled={dismissingTestId === selected.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-primary/10 text-muted-foreground hover:text-primary border border-border text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Descartar (Teste)</span>
                      </button>
                    </SystemTooltip>

                    <button
                      type="button"
                      onClick={() => retryAudit(selected.id, true)}
                      disabled={retrying}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-foreground border border-border text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className={`h-3 w-3 text-primary ${retrying ? "animate-spin" : ""}`} />
                      <span>Reauditar com IA</span>
                    </button>
                  </div>
                </div>

                {/* Cabeçalho 360º do Atendimento Auditado */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      name={selected.contactName || "Cliente"}
                      avatar={selected.contactAvatar}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-extrabold text-foreground text-base truncate">
                          {selected.contactName ?? "Cliente"}
                        </h2>
                        {selected.accountName && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-muted text-foreground border border-border">
                            <Building2 className="h-3 w-3 text-primary" />
                            {selected.accountName}
                          </span>
                        )}
                        {renderAuditSentimentBadge(selected.clientSentiment)}
                        {renderDirectorReviewBadge(selected.directorReview)}
                      </div>
                      <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground mt-1">
                        <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                          <UserCheck className="h-3.5 w-3.5 text-primary" />
                          {selected.operatorName}
                        </span>
                        {selected.contactPhone && <span>· {selected.contactPhone}</span>}
                        {selected.auditedAt && (
                          <span>
                            · Auditado em{" "}
                            {new Date(selected.auditedAt).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {selected.performanceScore !== null ? (
                      <ScoreGauge score={selected.performanceScore} size={86} />
                    ) : (
                      <AuditStatusBadge status={selected.status} />
                    )}
                  </div>
                </div>

                {/* ── BLOCO DE VALIDAÇÃO DA DIRETORIA & APRENDIZADO DA MÁQUINA ── */}
                {selected.status === "done" && (
                  <div className="bg-muted/25 border border-border rounded-2xl p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-primary" />
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-foreground">
                          Validação da Diretoria & Aprendizado da IA ({aiPersona.name})
                        </span>
                        {selected.directorReview && (
                          <span className="text-[10px] text-muted-foreground">
                            · Avaliado por{" "}
                            <strong className="text-foreground">
                              {selected.directorReview.reviewedByOperatorName}
                            </strong>
                          </span>
                        )}
                      </div>

                      {/* 3 Botões de Veredito */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            setReviewVerdict("approved");
                            handleSubmitDirectorReview({
                              auditId: selected.id,
                              verdict: "approved",
                              comment: reviewComment,
                              adjustedScore: null,
                            });
                          }}
                          disabled={savingReview}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition cursor-pointer ${
                            reviewVerdict === "approved"
                              ? "bg-primary text-primary-foreground border-primary shadow-xs"
                              : "bg-card hover:bg-muted text-foreground border-border"
                          }`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>IA Avaliou Certo</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setReviewVerdict("approved_with_caveats")}
                          disabled={savingReview}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition cursor-pointer ${
                            reviewVerdict === "approved_with_caveats"
                              ? "bg-primary text-primary-foreground border-primary shadow-xs"
                              : "bg-card hover:bg-muted text-foreground border-border"
                          }`}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Certo c/ Ressalvas</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setReviewVerdict("rejected_wrong")}
                          disabled={savingReview}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition cursor-pointer ${
                            reviewVerdict === "rejected_wrong"
                              ? "bg-primary text-primary-foreground border-primary shadow-xs"
                              : "bg-card hover:bg-muted text-foreground border-border"
                          }`}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>IA Avaliou Errado (Ensinar IA)</span>
                        </button>
                      </div>
                    </div>

                    {/* Formulário de Explicação / Calibração quando Ressalvas ou Erro é selecionado */}
                    {(reviewVerdict === "approved_with_caveats" ||
                      reviewVerdict === "rejected_wrong" ||
                      Boolean(selected.directorReview?.comment)) && (
                      <div className="space-y-2 pt-1.5 border-t border-border/60">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                          <div className="md:col-span-9">
                            <label className="text-[10px] font-bold text-muted-foreground block mb-1">
                              {reviewVerdict === "rejected_wrong"
                                ? "Por que a IA avaliou errado? (A IA absorverá esta regra nas próximas avaliações):"
                                : "Qual ressalva ou contexto comercial a IA deve considerar nas próximas vezes?"}
                            </label>
                            <textarea
                              rows={2}
                              value={reviewComment}
                              onChange={(e) => setReviewComment(e.target.value)}
                              placeholder="Ex: O cliente já era recorrente da carteira e pediu retorno apenas no dia seguinte; não houve falha de SLA nem falta de qualificação..."
                              className="w-full bg-card border border-border rounded-xl px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                            />
                          </div>

                          <div className="md:col-span-3 flex flex-col justify-between">
                            <div>
                              <label className="text-[10px] font-bold text-muted-foreground block mb-1">
                                Corrigir Nota (0–100):
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={reviewAdjustedScore}
                                onChange={(e) => setReviewAdjustedScore(e.target.value)}
                                placeholder={`Atual: ${selected.performanceScore ?? 70}`}
                                className="w-full bg-card border border-border rounded-xl px-3 py-1.5 text-xs font-bold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {selected.directorReview && (
                            <button
                              type="button"
                              onClick={() => handleClearDirectorReview(selected.id)}
                              disabled={savingReview}
                              className="text-[11px] font-semibold text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-lg cursor-pointer"
                            >
                              Limpar calibração
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              handleSubmitDirectorReview({
                                auditId: selected.id,
                                verdict: reviewVerdict || "approved_with_caveats",
                                comment: reviewComment,
                                adjustedScore:
                                  reviewAdjustedScore.trim() !== ""
                                    ? Number(reviewAdjustedScore)
                                    : null,
                                reauditWithAi: false,
                              })
                            }
                            disabled={savingReview}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card hover:bg-muted text-foreground border border-border text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5 text-primary" />
                            <span>Salvar Aprendizado</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handleSubmitDirectorReview({
                                auditId: selected.id,
                                verdict: reviewVerdict || "rejected_wrong",
                                comment: reviewComment,
                                adjustedScore:
                                  reviewAdjustedScore.trim() !== ""
                                    ? Number(reviewAdjustedScore)
                                    : null,
                                reauditWithAi: true,
                              })
                            }
                            disabled={savingReview}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground hover:opacity-95 text-[11px] font-extrabold shadow-xs transition cursor-pointer disabled:opacity-50"
                          >
                            {savingReview ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                            <span>Salvar & Reavaliar Agora com IA</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Barra de Contexto Comercial (CRM Deal + Métricas Reais de SLA da Conversa) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 bg-muted/30 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                        Negociação Vinculada no CRM
                      </span>
                      {selected.deal ? (
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="text-xs font-extrabold text-foreground truncate max-w-[180px]">
                            {selected.deal.title}
                          </span>
                          <span className="text-xs font-black text-primary">
                            {Number(selected.deal.value ?? 0).toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </span>
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-card border border-border text-muted-foreground uppercase">
                            {selected.deal.status === "won"
                              ? "Venda Ganha"
                              : selected.deal.status === "lost"
                              ? "Perdida"
                              : "Em Aberto"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Sem negociação vinculada
                        </span>
                      )}
                    </div>
                    {selected.deal && (
                      <button
                        type="button"
                        onClick={() => setSelectedDealModalId(selected.deal!.id)}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-[10px] font-bold transition cursor-pointer"
                      >
                        <ExternalLink className="h-3 w-3 text-primary" />
                        <span>Abrir CRM</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 md:border-l md:border-border md:pl-3">
                    <div>
                      <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                        TMA da Conversa
                      </span>
                      <span className="text-xs font-bold text-foreground">
                        {formatSecondsDuration(selected.slaMetrics?.avgResponseSeconds)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                        Maior Espera
                      </span>
                      <span className="text-xs font-bold text-foreground">
                        {formatSecondsDuration(selected.slaMetrics?.maxResponseSeconds)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                        Volume do Diálogo
                      </span>
                      <span className="text-xs font-bold text-foreground">
                        {selected.slaMetrics?.messageCount ?? 0} msgs (
                        {selected.slaMetrics?.clientMessageCount ?? 0} cli /{" "}
                        {selected.slaMetrics?.agentMessageCount ?? 0} cons)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Barra de Ações Diretas da Diretoria (Espiar Transcrição + Sussurro ao Consultor) */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !inspectOpen;
                      setInspectOpen(next);
                      if (next && !fullHistoryByConv[selected.conversationId]) {
                        handleLoadFullConversation(selected.conversationId);
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                      inspectOpen
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 hover:bg-muted text-foreground border-border"
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>
                      {inspectOpen
                        ? "Ocultar Conversa Auditada"
                        : `Espiar Conversa Auditada (${
                            selected.slaMetrics?.messageCount ||
                            selected.recentMessages?.length ||
                            0
                          } msgs)`}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWhisperOpen((o) => !o)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                      whisperOpen
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-primary/10 hover:bg-primary/15 text-primary border-primary/25"
                    }`}
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Orientar / Cobrar Consultor (Sussurro)</span>
                  </button>
                </div>

                {/* Gaveta 1: Sussurro / Orientação de Coaching em 1 Clique */}
                <AnimatePresence>
                  {whisperOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="bg-primary/5 border border-primary/25 rounded-2xl p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>
                              Enviar Orientação Interna para {selected.operatorName} (Invisível para o
                              cliente)
                            </span>
                          </span>
                        </div>

                        {/* Presets de 1 Clique baseados no diagnóstico da IA */}
                        <div className="flex flex-wrap gap-1.5">
                          {selected.coachingMessageSuggestion && (
                            <button
                              type="button"
                              onClick={() =>
                                handleSendAuditWhisper(
                                  selected.conversationId,
                                  selected.coachingMessageSuggestion!,
                                )
                              }
                              disabled={sendingWhisper}
                              className="text-left text-[11px] font-bold px-2.5 py-1.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition cursor-pointer disabled:opacity-50"
                            >
                              Enviar Sugestão IA: &ldquo;
                              {selected.coachingMessageSuggestion.slice(0, 85)}
                              {selected.coachingMessageSuggestion.length > 85 ? "..." : ""}&rdquo;
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              handleSendAuditWhisper(
                                selected.conversationId,
                                `Atenção neste atendimento (${selected.contactName}): retome o contato com o cliente e defina um próximo passo claro no CRM hoje.`,
                              )
                            }
                            disabled={sendingWhisper}
                            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-xl bg-card hover:bg-muted text-foreground border border-border transition cursor-pointer disabled:opacity-50"
                          >
                            Cobrar Follow-up / Próximo Passo
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleSendAuditWhisper(
                                selected.conversationId,
                                `Parabéns pela condução técnica e agilidade neste atendimento com ${selected.contactName}! Excelente referência comercial.`,
                              )
                            }
                            disabled={sendingWhisper}
                            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-xl bg-card hover:bg-muted text-foreground border border-border transition cursor-pointer disabled:opacity-50"
                          >
                            Elogiar Condução Comercial
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={whisperDraft}
                            onChange={(e) => setWhisperDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && whisperDraft.trim()) {
                                handleSendAuditWhisper(selected.conversationId, whisperDraft);
                              }
                            }}
                            placeholder={`Escrever orientação personalizada para ${selected.operatorName}...`}
                            className="flex-1 bg-card border border-border rounded-xl px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleSendAuditWhisper(selected.conversationId, whisperDraft)
                            }
                            disabled={!whisperDraft.trim() || sendingWhisper}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-extrabold hover:opacity-90 transition cursor-pointer disabled:opacity-40"
                          >
                            {sendingWhisper ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            <span>Enviar</span>
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Gaveta 2: Inspeção da Transcrição Completa e Áudios da Conversa */}
                <AnimatePresence>
                  {inspectOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="bg-muted/30 border border-border rounded-2xl p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                            <Eye className="h-3.5 w-3.5 text-primary" />
                            <span>Transcrição Real & Áudios do Atendimento Auditado</span>
                          </span>
                          {loadingHistoryConvId === selected.conversationId && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                              Sincronizando histórico completo...
                            </span>
                          )}
                        </div>

                        <div className="max-h-80 overflow-y-auto scrollbar-thin space-y-2 pr-1">
                          {(() => {
                            const baseMsgs =
                              fullHistoryByConv[selected.conversationId] ||
                              selected.recentMessages ||
                              [];
                            const extraWhispers =
                              localWhispersByConv[selected.conversationId] || [];
                            const existingIds = new Set(baseMsgs.map((m) => m.id));
                            const allMsgs = [
                              ...baseMsgs,
                              ...extraWhispers.filter((m) => !existingIds.has(m.id)),
                            ];
                            if (allMsgs.length === 0) {
                              return (
                                <p className="text-xs text-muted-foreground py-4 text-center">
                                  Nenhuma mensagem encontrada para esta conversa.
                                </p>
                              );
                            }
                            return allMsgs.map((m) => {
                              const isAgent =
                                m.senderType === "agent" ||
                                m.senderType === "bot" ||
                                m.sender === "agent";
                              return (
                                <div
                                  key={m.id}
                                  className={`flex ${
                                    m.senderType === "system"
                                      ? "justify-center"
                                      : isAgent
                                      ? "justify-end"
                                      : "justify-start"
                                  }`}
                                >
                                  <LiveMessageBubble
                                    msg={m}
                                    isAgent={isAgent}
                                    contactPhone={selected.contactPhone || undefined}
                                  />
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Estados de Pendente / Processando / Erro */}
                {(selected.status === "pending" || selected.status === "processing") && (
                  <div className="bg-muted/50 border border-border rounded-2xl p-4 flex items-center gap-3">
                    <RefreshCw
                      className={`h-5 w-5 text-primary shrink-0 ${
                        selected.status === "processing" ? "animate-spin" : ""
                      }`}
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {selected.status === "processing"
                          ? "A Vertex AI está auditando este atendimento agora..."
                          : "Atendimento na fila para auditoria imediata"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        A página será atualizada automaticamente assim que a nota e os insights
                        forem gerados.
                      </p>
                    </div>
                  </div>
                )}

                {selected.status === "error" && (
                  <div className="bg-muted/40 border border-border rounded-2xl p-4 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-primary mb-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        <span>Motivo da não conclusão</span>
                      </p>
                      <p className="text-sm text-foreground break-words">
                        {selected.errorMessage ?? "Erro desconhecido durante a auditoria."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => retryAudit(selected.id, true)}
                      disabled={retrying}
                      className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold text-primary-foreground bg-primary hover:opacity-90 px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
                      <span>Reprocessar</span>
                    </button>
                  </div>
                )}

                {/* Insight Acionável para a Diretoria */}
                {selected.actionableInsight && (
                  <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-primary mb-1 flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      <span>Recomendação Executiva da IA para Agir Hoje</span>
                    </p>
                    <p className="text-sm font-bold text-foreground leading-relaxed">
                      {selected.actionableInsight}
                    </p>
                  </div>
                )}

                {/* Notas dos 4 Pilares Avaliados + Checklist de Falhas */}
                {selected.pillarScores && selected.status === "done" && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {(
                      [
                        {
                          label: "Agilidade / SLA",
                          score: selected.pillarScores.agility,
                          failed: selected.hadLongResponseGap,
                          failLabel: "Demora > 15m",
                          okLabel: "Dentro do SLA",
                        },
                        {
                          label: "Qualificação & Postura",
                          score: selected.pillarScores.qualification,
                          failed: selected.hadRudeLanguage,
                          failLabel: "Postura inadequada",
                          okLabel: "Postura adequada",
                        },
                        {
                          label: "Gestão de Objeções",
                          score: selected.pillarScores.objectionHandling,
                          failed: selected.hadMissedObjection,
                          failLabel: "Objeção ignorada",
                          okLabel: "Dúvidas atendidas",
                        },
                        {
                          label: "Fechamento / Follow-up",
                          score: selected.pillarScores.closingNextStep,
                          failed: selected.hadNoFollowUp,
                          failLabel: "Sem próximo passo",
                          okLabel: "Próximo passo claro",
                        },
                      ] as const
                    ).map((pil) => (
                      <div
                        key={pil.label}
                        className={`rounded-xl border p-3 space-y-1.5 ${
                          pil.failed
                            ? "bg-primary/5 border-primary/30"
                            : "bg-muted/30 border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-muted-foreground truncate">
                            {pil.label}
                          </span>
                          <span className="text-xs font-black text-foreground">
                            {pil.score}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, Math.max(0, pil.score))}%` }}
                          />
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-bold">
                          {pil.failed ? (
                            <>
                              <AlertTriangle className="h-3 w-3 text-primary shrink-0" />
                              <span className="text-primary truncate">{pil.failLabel}</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                              <span className="text-muted-foreground truncate">
                                {pil.okLabel}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Resumo Executivo */}
                {selected.summary && (
                  <div className="bg-card border border-border rounded-2xl p-4">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Resumo Executivo do Atendimento
                    </p>
                    <p className="text-xs sm:text-sm text-foreground leading-relaxed">
                      {selected.summary}
                    </p>
                  </div>
                )}

                {/* Pontos Fortes e Falhas Detalhadas */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {selected.strengths && (
                    <div className="bg-primary/5 border border-primary/15 rounded-2xl p-4">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-primary mb-2 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                        <span>Pontos Fortes (Acertos Específicos)</span>
                      </p>
                      <p className="text-xs text-foreground/90 leading-relaxed">
                        {selected.strengths}
                      </p>
                    </div>
                  )}
                  {selected.weaknesses && (
                    <div className="bg-muted/40 border border-border rounded-2xl p-4">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-foreground mb-2 flex items-center gap-1.5">
                        <XCircle className="h-3.5 w-3.5 text-primary" />
                        <span>Falhas & Oportunidades Perdidas</span>
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {selected.weaknesses}
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* Modal Nativo de Negociação do CRM */}
      {selectedDealModalId && (
        <DealDetailModal
          dealId={selectedDealModalId}
          isOpen={Boolean(selectedDealModalId)}
          onClose={() => setSelectedDealModalId(null)}
          onDealUpdated={() => fetchAudits(true)}
          onOpenDeal={(targetDealId) => setSelectedDealModalId(targetDealId)}
        />
      )}
    </div>
  );
}

// ── Componentes de Filtro Customizados ────────────────────────────────────────

/**
 * Calendário customizado com paleta de cores do sistema (var(--primary)).
 * Substitui o <input type="date"> nativo que usa cores do browser.
 */
function LiveDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const today = new Date();
  const selected = value ? new Date(value + "T12:00:00") : null;
  const [viewYear, setViewYear] = React.useState(selected?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(selected?.getMonth() ?? today.getMonth());

  const MONTHS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const DAYS_PT = ["D","S","T","Q","Q","S","S"];

  // Gera os dias do mês com padding
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Completa até 42 células
  while (cells.length < 42) cells.push(null);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const selectDay = (day: number) => {
    const mm = String(viewMonth + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    onChange(`${viewYear}-${mm}-${dd}`);
    setOpen(false);
  };

  const isSelected = (day: number) =>
    selected &&
    selected.getFullYear() === viewYear &&
    selected.getMonth() === viewMonth &&
    selected.getDate() === day;

  const isToday = (day: number) =>
    today.getFullYear() === viewYear &&
    today.getMonth() === viewMonth &&
    today.getDate() === day;

  const label = selected
    ? selected.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "dd/mm/aaaa";

  return (
    <div ref={ref} className="relative flex-1">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-1.5 bg-muted/60 border rounded-lg px-2.5 py-1.5 text-[11px] transition cursor-pointer ${
          value
            ? "border-primary text-primary font-semibold"
            : "border-border text-muted-foreground hover:border-primary/50"
        }`}
      >
        <Calendar className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        {value && (
          <button
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
            className="ml-auto text-primary/70 hover:text-primary"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 bg-card border border-border rounded-2xl shadow-xl p-3 w-56 select-none">
          {/* Cabeçalho mês/ano */}
          <div className="flex items-center justify-between mb-2.5">
            <button
              onClick={prevMonth}
              className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted transition cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4 text-foreground" />
            </button>
            <span className="text-[12px] font-bold text-foreground">
              {MONTHS_PT[viewMonth]} {viewYear}
            </span>
            <button
              onClick={nextMonth}
              className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted transition cursor-pointer"
            >
              <ChevronRight className="h-4 w-4 text-foreground" />
            </button>
          </div>

          {/* Dias da semana */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS_PT.map((d, i) => (
              <div key={i} className="text-center text-[9px] font-bold text-muted-foreground py-0.5">{d}</div>
            ))}
          </div>

          {/* Células de dias */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => (
              <button
                key={i}
                disabled={!day}
                onClick={() => day && selectDay(day)}
                className={`h-7 w-full rounded-lg text-[11px] font-medium transition ${
                  !day ? "" :
                  isSelected(day)
                    ? "bg-primary text-primary-foreground font-bold shadow-sm cursor-pointer"
                    : isToday(day)
                    ? "border border-primary text-primary font-bold cursor-pointer hover:bg-primary/10"
                    : "text-foreground hover:bg-muted cursor-pointer"
                }`}
              >
                {day || ""}
              </button>
            ))}
          </div>

          {/* Ações rápidas */}
          <div className="flex justify-between mt-2.5 pt-2 border-t border-border">
            <button
              onClick={() => { onChange(""); setOpen(false); }}
              className="text-[10px] text-muted-foreground hover:text-foreground font-semibold transition cursor-pointer"
            >
              Limpar
            </button>
            <button
              onClick={() => {
                const t = new Date();
                const mm = String(t.getMonth() + 1).padStart(2, "0");
                const dd = String(t.getDate()).padStart(2, "0");
                onChange(`${t.getFullYear()}-${mm}-${dd}`);
                setOpen(false);
              }}
              className="text-[10px] text-primary hover:text-primary/80 font-bold transition cursor-pointer"
            >
              Hoje
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Dropdown customizado de operadores com paleta do sistema.
 * Substitui o <select> nativo que usa cores do browser.
 */
function LiveOperatorSelect({
  value,
  onChange,
  operators,
}: {
  value: string;
  onChange: (v: string) => void;
  operators: {
    operatorId: string;
    operatorName: string;
    status: string;
    isOnline?: boolean;
    waitingReplyCount?: number;
    activeTodayCount?: number;
  }[];
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedName = value
    ? (operators.find((o) => o.operatorId === value)?.operatorName ?? "Operador")
    : "Todos";

  const options = [
    {
      operatorId: "",
      operatorName: "Todos",
      status: "",
      isOnline: false,
      waitingReplyCount: 0,
      activeTodayCount: 0,
    },
    ...operators,
  ];

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <motion.button
        type="button"
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-1.5 bg-muted/60 border rounded-lg px-2.5 py-1.5 text-[11px] transition-all duration-200 cursor-pointer ${
          value
            ? "border-primary text-primary font-semibold bg-primary/5"
            : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
        }`}
      >
        <Users className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left truncate">{selectedName}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute left-0 top-full mt-1.5 z-50 bg-card border border-border rounded-2xl shadow-xl py-1.5 min-w-[225px] w-full max-h-60 overflow-y-auto scrollbar-thin"
          >
            {options.map((op) => {
              const isActive = op.operatorId === value;
              return (
                <button
                  key={op.operatorId || "__all__"}
                  type="button"
                  onClick={() => {
                    onChange(op.operatorId);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left transition-colors duration-150 cursor-pointer ${
                    isActive
                      ? "bg-primary/10 text-primary font-bold"
                      : "text-foreground hover:bg-muted/60"
                  }`}
                >
                  {op.operatorId ? (
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        op.isOnline
                          ? "bg-primary ring-2 ring-primary/25"
                          : op.status === "ocupado"
                          ? "bg-muted-foreground"
                          : "bg-muted-foreground/35"
                      }`}
                    />
                  ) : (
                    <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate flex-1">{op.operatorName}</span>
                  {op.operatorId && (op.waitingReplyCount ?? 0) > 0 && (
                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 shrink-0">
                      {op.waitingReplyCount} esp.
                    </span>
                  )}
                  {op.operatorId &&
                    (op.activeTodayCount ?? 0) > 0 &&
                    (op.waitingReplyCount ?? 0) === 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                        {op.activeTodayCount} hoje
                      </span>
                    )}
                  {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Dropdown customizado de Funil Comercial (CRM Pipeline) com animações suaves e paleta do sistema.
 */
function LivePipelineSelect({
  value,
  onChange,
  pipelines,
  openDealsCount,
}: {
  value: string;
  onChange: (v: string) => void;
  pipelines: LivePipelineOption[];
  openDealsCount: number;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedLabel = useMemo(() => {
    if (!value) return "Todos os Funis CRM";
    if (value === "__with_deal__") return "Com Negócio Aberto";
    return pipelines.find((p) => p.id === value)?.name ?? "Funil CRM";
  }, [value, pipelines]);

  return (
    <div ref={ref} className="relative w-full">
      <motion.button
        type="button"
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-1.5 bg-muted/60 border rounded-lg px-2.5 py-1.5 text-[11px] transition-all duration-200 cursor-pointer ${
          value
            ? "border-primary text-primary font-semibold bg-primary/5"
            : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
        }`}
      >
        <Briefcase className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left truncate">{selectedLabel}</span>
        {openDealsCount > 0 && !value && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-card border border-border text-foreground shrink-0">
            {openDealsCount} cards
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute left-0 top-full mt-1.5 z-50 bg-card border border-border rounded-2xl shadow-xl py-1.5 w-full max-h-60 overflow-y-auto scrollbar-thin"
          >
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-left transition-colors cursor-pointer ${
                !value
                  ? "bg-primary/10 text-primary font-bold"
                  : "text-foreground hover:bg-muted/60"
              }`}
            >
              <span className="truncate">Todos os Atendimentos</span>
              {!value && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
            </button>

            <button
              type="button"
              onClick={() => {
                onChange("__with_deal__");
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-left transition-colors cursor-pointer ${
                value === "__with_deal__"
                  ? "bg-primary/10 text-primary font-bold"
                  : "text-foreground hover:bg-muted/60"
              }`}
            >
              <span className="truncate">Apenas com Negócio Aberto</span>
              <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                {openDealsCount}
              </span>
            </button>

            {pipelines.length > 0 && <div className="my-1 border-t border-line" />}

            {pipelines.map((p) => {
              const isActive = value === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-left transition-colors cursor-pointer ${
                    isActive
                      ? "bg-primary/10 text-primary font-bold"
                      : "text-foreground hover:bg-muted/60"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate">{p.name}</span>
                    {p.totalValue > 0 && (
                      <span className="text-[9px] text-muted-foreground">
                        {p.totalValue.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                          maximumFractionDigits: 0,
                        })}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                    {p.count}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Popover de Intervenção Direta da Supervisão:
 * Permite transferir/atribuir imediatamente a um consultor, devolver para a fila ou finalizar o atendimento
 * sem sair da aba Ao Vivo.
 */
function LiveSupervisorInterventionPopover({
  conv,
  operators,
  onIntervene,
  busy,
  compact = false,
}: {
  conv: LiveConversation;
  operators: LiveOperator[];
  onIntervene: (
    conversationId: string,
    action: "transfer" | "return_to_queue" | "close",
    targetOperatorId?: string
  ) => Promise<void>;
  busy: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <motion.button
        type="button"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-lg border font-bold transition-all duration-200 cursor-pointer disabled:opacity-50 ${
          compact
            ? "px-2 py-1 text-[10px] bg-card hover:bg-primary/10 text-foreground hover:text-primary border-border hover:border-primary/30"
            : "px-2.5 py-1.5 text-[11px] bg-muted/60 hover:bg-primary/10 text-foreground hover:text-primary border-border hover:border-primary/30"
        }`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        ) : (
          <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
        )}
        <span>{conv.queueState === "fila" ? "Atribuir" : "Intervir"}</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute right-0 top-full mt-1.5 z-50 w-64 bg-card border border-border rounded-2xl shadow-xl py-2 overflow-hidden"
          >
            <div className="px-3 pb-1.5 border-b border-line flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                Atribuir / Transferir para
              </span>
              <UserCheck className="h-3.5 w-3.5 text-primary" />
            </div>

            <div className="max-h-48 overflow-y-auto scrollbar-thin py-1">
              {operators.map((op) => {
                const isCurrent = conv.operatorId === op.operatorId && conv.queueState === "atendimento";
                return (
                  <button
                    key={op.operatorId}
                    type="button"
                    disabled={isCurrent || busy}
                    onClick={async () => {
                      setOpen(false);
                      await onIntervene(conv.id, "transfer", op.operatorId);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-[11px] flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      isCurrent
                        ? "bg-primary/10 text-primary font-bold cursor-default"
                        : "hover:bg-muted/60 text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          op.isOnline ? "bg-primary" : "bg-muted-foreground/40"
                        }`}
                      />
                      <span className="truncate">{op.operatorName}</span>
                    </div>
                    <span className="text-[9px] text-muted-foreground shrink-0">
                      {isCurrent ? "Atual" : `${op.waitingReplyCount ?? 0} esp.`}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-line pt-1 mt-1 space-y-0.5 px-1.5">
              {conv.queueState !== "fila" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setOpen(false);
                    await onIntervene(conv.id, "return_to_queue");
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Devolver para a Fila</span>
                </button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setOpen(false);
                  await onIntervene(conv.id, "close");
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors cursor-pointer"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>Finalizar Atendimento</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Popover de Tarefas do Atendimento (mostra todas as tarefas abertas/atrasadas da conversa e da negociação).
 */
function LiveTasksPopover({
  tasks,
  openTasksCount,
  overdueTasksCount,
}: {
  tasks: LiveTaskItem[];
  openTasksCount: number;
  overdueTasksCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (openTasksCount <= 0) return null;

  return (
    <div ref={ref} className="relative">
      <motion.button
        type="button"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
          overdueTasksCount > 0
            ? "bg-primary/15 text-primary border-primary/30 hover:bg-primary/20"
            : "bg-card text-foreground border-border hover:border-primary/40"
        }`}
      >
        <ClipboardCheck className="h-3 w-3 shrink-0 text-primary" />
        <span>
          {openTasksCount} tarefa(s)
          {overdueTasksCount > 0 ? ` · ${overdueTasksCount} atrasada(s)` : ""}
        </span>
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute right-0 top-full mt-1.5 z-50 w-72 bg-card border border-border rounded-2xl shadow-xl p-3 space-y-2"
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-line">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
                Tarefas Pendentes ({openTasksCount})
              </span>
              {overdueTasksCount > 0 && (
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/25">
                  {overdueTasksCount} em atraso
                </span>
              )}
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-thin">
              {tasks.map((t) => (
                <div
                  key={t.id}
                  className={`p-2 rounded-xl border text-[11px] flex items-start justify-between gap-2 ${
                    t.isOverdue
                      ? "bg-primary/5 border-primary/25"
                      : "bg-muted/30 border-border"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-foreground truncate">{t.title}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5 text-primary shrink-0" />
                      {t.dueDate
                        ? new Date(t.dueDate).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Sem prazo definido"}
                    </p>
                  </div>
                  {t.isOverdue && (
                    <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-primary text-primary-foreground shrink-0">
                      Atrasada
                    </span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── LiveTab & Helpers ────────────────────────────────────────────────────────

const LIVE_BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

/**
 * Formata o preview da última mensagem sem qualquer emoji (apenas texto limpo).
 */
function formatLiveMessagePreview(raw?: string | null): string {
  if (!raw) return "Nenhuma mensagem recente";
  const mediaMatch = raw.match(
    /^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::([\s\S]+))?$/
  );
  if (mediaMatch) {
    const [, mediaType, , caption] = mediaMatch;
    const cleanCaption = caption ? caption.replace(/\s+/g, " ").trim() : "";
    const labels: Record<string, string> = {
      image: "Imagem",
      video: "Vídeo",
      audio: "Áudio",
      document: "Documento",
      sticker: "Figurinha",
    };
    const prefix = labels[mediaType] || "Anexo de mídia";
    return cleanCaption ? `${prefix}: ${cleanCaption}` : prefix;
  }
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Retorna o ícone Lucide correspondente caso a mensagem bruta seja uma mídia.
 */
function getLiveMessageMediaIcon(raw?: string | null, className = "h-3 w-3 shrink-0"): React.ReactNode {
  if (!raw) return null;
  const mediaMatch = raw.match(/^\[MEDIA:(image|video|audio|document|sticker)\]/);
  if (!mediaMatch) return null;
  const mediaType = mediaMatch[1];
  switch (mediaType) {
    case "image":
      return <ImageIcon className={className} />;
    case "video":
      return <VideoIcon className={className} />;
    case "audio":
      return <Volume2 className={className} />;
    case "document":
      return <FileText className={className} />;
    case "sticker":
      return <Tag className={className} />;
    default:
      return <Paperclip className={className} />;
  }
}

function formatWaitDuration(minutes: number): string {
  if (minutes < 1) return "< 1m";
  if (minutes < 60) return `${minutes}min`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function formatUsageHoursShort(seconds?: number): string {
  if (!seconds || seconds <= 0) return "0m";
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatMessageDateSeparator(isoStr?: string): string | null {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return null;

  const fmtKey = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  const msgKey = fmtKey(d);

  if (msgKey === fmtKey(now)) return "Hoje";
  if (msgKey === fmtKey(yesterday)) return "Ontem";

  return d.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getMessageDateKey(isoStr?: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Renderiza o conteúdo de uma mensagem ao vivo com paridade completa e paleta 100% do sistema.
 */
function LiveMessageBubble({
  msg,
  isAgent,
  contactPhone,
}: {
  msg: LiveMessage;
  isAgent: boolean;
  contactPhone?: string;
}) {
  const [showTranscript, setShowTranscript] = useState(true);
  const content = msg.content || "";

  const timeStr = msg.sentAt
    ? new Date(msg.sentAt).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  if (msg.senderType === "system") {
    return (
      <div className="flex justify-center my-1.5">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/50 border border-border text-[10px] text-muted-foreground font-medium max-w-[85%] text-center">
          <Clock className="h-3 w-3 shrink-0 opacity-70" />
          <span className="truncate">{content}</span>
          {timeStr && <span className="opacity-60 shrink-0">· {timeStr}</span>}
        </div>
      </div>
    );
  }

  const mediaMatch = content.match(
    /^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::([\s\S]+))?$/
  );

  const isSupervisorWhisper =
    Boolean(msg.isInternalNote) &&
    (Boolean((msg.metaDetails as any)?.supervisorWhisper) ||
      Boolean(msg.senderName?.includes("(Supervisão)")));

  const isFailed = msg.status === "failed" || Boolean(msg.errorMessage);
  const translatedError = isFailed
    ? formatMetaErrorMessagePt(msg.errorMessage || "Falha no envio da mensagem", contactPhone)
    : null;

  const bubbleCls = `max-w-[75%] rounded-2xl px-3.5 py-2.5 shadow-sm text-xs leading-relaxed ${
    isSupervisorWhisper
      ? "bg-primary/10 border border-primary/30 text-foreground"
      : msg.isInternalNote
      ? "bg-muted/80 border border-border text-foreground"
      : isFailed
      ? "bg-card border-2 border-primary/50 text-foreground rounded-tr-none"
      : isAgent
      ? "bg-primary text-primary-foreground rounded-tr-none"
      : "bg-card text-foreground border border-border rounded-tl-none"
  }`;

  const isLightOnPrimary = isAgent && !msg.isInternalNote && !isFailed;

  const timeCls = `text-[9px] flex items-center justify-end gap-1 mt-1 select-none ${
    isLightOnPrimary ? "text-primary-foreground/70" : "text-muted-foreground"
  }`;

  const renderDeliveryIcon = () => {
    if (!isAgent || msg.isInternalNote) return null;
    if (isFailed) {
      return <AlertTriangle className="h-3 w-3 text-primary shrink-0" />;
    }
    if (msg.status === "read" || msg.status === "delivered") {
      return <CheckCheck className="h-3 w-3 shrink-0 opacity-90" />;
    }
    return <Check className="h-3 w-3 shrink-0 opacity-75" />;
  };

  const renderQuotedBlock = () => {
    if (!msg.quotedMessageContent) return null;
    return (
      <div
        className={`mb-2 rounded-lg px-2.5 py-1.5 border-l-2 text-[10px] ${
          isLightOnPrimary
            ? "bg-black/15 border-white/60 text-primary-foreground/90"
            : "bg-muted/60 border-primary text-muted-foreground"
        }`}
      >
        <div className="flex items-center gap-1 font-bold mb-0.5">
          <CornerUpLeft className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{msg.quotedMessageSender || "Mensagem citada"}</span>
        </div>
        <p className="line-clamp-2 break-words opacity-90 flex items-center gap-1">
          {getLiveMessageMediaIcon(msg.quotedMessageContent, "h-2.5 w-2.5 shrink-0")}
          <span>{formatLiveMessagePreview(msg.quotedMessageContent)}</span>
        </p>
      </div>
    );
  };

  const renderInternalHeader = () => {
    if (!msg.isInternalNote) return null;
    return (
      <div className="flex items-center gap-1.5 mb-1 pb-1 border-b border-border/60 text-[10px] font-extrabold text-primary">
        <Lock className="h-3 w-3 shrink-0" />
        <span>
          {isSupervisorWhisper ? "Orientação da Supervisão (Sussurro)" : "Nota Interna da Equipe"}
        </span>
      </div>
    );
  };

  const renderFailureNotice = () => {
    if (!isFailed || !translatedError) return null;
    return (
      <div className="mt-2 rounded-xl bg-primary/10 border border-primary/25 p-2 text-[10px] text-foreground flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <span className="font-extrabold text-primary block">Falha de Entrega no WhatsApp</span>
          <span className="text-muted-foreground leading-snug block mt-0.5">{translatedError}</span>
        </div>
      </div>
    );
  };

  if (mediaMatch) {
    const [, mediaType, messageId, caption] = mediaMatch;
    const mediaUrl = `${LIVE_BACKEND_URL}/api/baileys/media?messageId=${messageId}`;

    let mediaEl: React.ReactNode = null;

    if (mediaType === "image") {
      mediaEl = (
        <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
          <img
            src={mediaUrl}
            alt="Imagem"
            className="max-h-56 w-full object-contain rounded-xl cursor-pointer hover:opacity-90 transition"
          />
        </a>
      );
    } else if (mediaType === "video") {
      mediaEl = (
        <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="relative block">
          <video
            src={mediaUrl}
            controls
            preload="metadata"
            className="max-h-56 w-full object-contain rounded-xl"
          />
        </a>
      );
    } else if (mediaType === "audio") {
      mediaEl = (
        <div className="flex flex-col gap-1.5 py-1 min-w-[210px]">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 shrink-0" />
            <AudioWithSpeed src={mediaUrl} audioClassName="h-7 w-44" />
            {msg.mediaInterpretation && (
              <SystemTooltip
                content={showTranscript ? "Ocultar transcrição" : "Ver transcrição do áudio"}
              >
                <button
                  type="button"
                  onClick={() => setShowTranscript((v) => !v)}
                  className={`p-1 rounded-md transition cursor-pointer ${
                    isLightOnPrimary ? "hover:bg-white/15" : "hover:bg-muted"
                  }`}
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      showTranscript ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </SystemTooltip>
            )}
          </div>
          {msg.mediaInterpretation && showTranscript && (
            <div
              className={`rounded-lg px-2.5 py-1.5 text-[10px] leading-relaxed border ${
                isLightOnPrimary
                  ? "bg-black/15 border-white/20 text-primary-foreground/95"
                  : "bg-muted/60 border-border text-foreground"
              }`}
            >
              <span className="font-bold uppercase tracking-wider text-[8px] opacity-75 block mb-0.5">
                Transcrição IA:
              </span>
              <p className="italic whitespace-pre-wrap break-words">
                "{msg.mediaInterpretation}"
              </p>
            </div>
          )}
        </div>
      );
    } else if (mediaType === "document") {
      const fileName = caption || "documento";
      mediaEl = (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 hover:underline py-0.5"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="text-[11px] font-semibold truncate max-w-[180px]">{fileName}</span>
        </a>
      );
    } else {
      mediaEl = (
        <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="underline text-[11px]">
          Anexo ({mediaType})
        </a>
      );
    }

    return (
      <div className={`flex ${isAgent ? "justify-end" : "justify-start"}`}>
        <div className={bubbleCls}>
          {renderInternalHeader()}
          {renderQuotedBlock()}
          {mediaEl}
          {caption && mediaType !== "document" && (
            <p className="mt-1.5 text-[11px] whitespace-pre-wrap break-words">{caption}</p>
          )}
          {renderFailureNotice()}
          <div className={timeCls}>
            <span>
              {timeStr} · {msg.senderName}
            </span>
            {renderDeliveryIcon()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isAgent ? "justify-end" : "justify-start"}`}>
      <div className={bubbleCls}>
        {renderInternalHeader()}
        {renderQuotedBlock()}
        <p className="whitespace-pre-wrap break-words">{content}</p>
        {renderFailureNotice()}
        <div className={timeCls}>
          <span>
            {timeStr} · {msg.senderName}
          </span>
          {renderDeliveryIcon()}
        </div>
      </div>
    </div>
  );
}

type LiveSidebarFilter = "active" | "waiting" | "unstarted" | "all";

const SUPERVISOR_WHISPER_TEMPLATES = [
  "Priorizar retorno agora",
  "Ligar para o cliente",
  "Atualizar etapa e tarefa no CRM",
  "Verificar condição comercial",
] as const;

function LiveTab({ demoMode }: { demoMode: boolean }) {
  const {
    tenant,
    setSelectedChatId,
    setActiveView,
    operatorTypingStatus,
    clientTypingStatus,
  } = useChat();
  const aiPersona = getAiPersona(tenant);

  // Estado principal
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Conversa selecionada (null = exibe o Cockpit Executivo da Diretoria)
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  // Modal de inspeção direta do Negócio CRM sem sair da aba Ao Vivo
  const [inspectDealId, setInspectDealId] = useState<string | null>(null);

  // Estado de intervenção direta da supervisão
  const [interveningConvId, setInterveningConvId] = useState<string | null>(null);

  // Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState(""); // YYYY-MM-DD
  const [opIdFilter, setOpIdFilter] = useState(""); // operatorId
  const [pipelineFilter, setPipelineFilter] = useState(""); // "" | "__with_deal__" | pipelineId
  const [sidebarFilter, setSidebarFilter] = useState<LiveSidebarFilter>("active");

  // Sussurro do Supervisor (Nota Interna Direta)
  const [whisperText, setWhisperText] = useState("");
  const [sendingWhisper, setSendingWhisper] = useState(false);

  // Histórico completo (carregado sob demanda)
  const [fullHistory, setFullHistory] = useState<LiveMessage[]>([]);
  const [fullHistoryLoading, setFullHistoryLoading] = useState(false);
  const [fullHistoryConvId, setFullHistoryConvId] = useState<string | null>(null);

  // Quando a conversa muda, limpa histórico completo e campo de sussurro
  useEffect(() => {
    setFullHistory([]);
    setFullHistoryConvId(null);
    setWhisperText("");
  }, [selectedConvId]);

  const loadFullHistory = useCallback(
    async (convId: string) => {
      if (!convId || demoMode) return;
      setFullHistoryLoading(true);
      try {
        const res = await fetch(
          `/api/gestao/messages?tenantId=${tenant}&conversationId=${convId}`
        );
        if (res.ok) {
          const data: LiveMessage[] = await res.json();
          setFullHistory(data);
          setFullHistoryConvId(convId);
        }
      } catch (e) {
        console.error("[LiveTab] Erro ao carregar histórico completo:", e);
      } finally {
        setFullHistoryLoading(false);
      }
    },
    [tenant, demoMode]
  );

  // Fetch de dados com filtros
  const fetchLive = useCallback(async () => {
    if (demoMode) {
      setLiveData({
        operators: MOCK_LIVE as LiveOperator[],
        unassigned: [],
        automation: [],
        pipelines: [],
      });
      setLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams({ tenantId: tenant });
      if (dateFilter) params.set("date", dateFilter);
      if (opIdFilter) params.set("opId", opIdFilter);
      if (searchTerm.length >= 2) params.set("search", searchTerm);

      const res = await fetch(`/api/gestao/live?${params.toString()}`);
      if (res.ok) {
        const data: LiveData = await res.json();
        setLiveData(data);
        setLastUpdated(new Date());
      }
    } catch (e) {
      console.error("[MonitorView/LiveTab] Erro ao buscar dados ao vivo:", e);
    } finally {
      setLoading(false);
    }
  }, [tenant, demoMode, dateFilter, opIdFilter, searchTerm]);

  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, 8_000);
    return () => clearInterval(interval);
  }, [fetchLive]);

  // Enviar Sussurro / Nota Interna de Supervisão
  const handleSendWhisper = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = whisperText.trim();
    if (!trimmed || !selectedConvId || sendingWhisper) return;

    setSendingWhisper(true);
    try {
      const res = await fetch("/api/gestao/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: selectedConvId,
          content: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Não foi possível enviar a orientação.");
      }

      const createdMsg: LiveMessage = data.message;
      setWhisperText("");
      toast.success("Orientação interna enviada para o consultor!");

      if (createdMsg) {
        setLiveData((prev) => {
          if (!prev) return prev;
          const appendMsg = (c: LiveConversation) =>
            c.id === selectedConvId
              ? { ...c, messages: [...c.messages, createdMsg] }
              : c;
          return {
            ...prev,
            operators: prev.operators.map((op) => ({
              ...op,
              conversations: op.conversations.map(appendMsg),
            })),
            unassigned: prev.unassigned.map(appendMsg),
            automation: prev.automation.map(appendMsg),
          };
        });
        if (fullHistoryConvId === selectedConvId) {
          setFullHistory((prev) => [...prev, createdMsg]);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar orientação de supervisão.");
    } finally {
      setSendingWhisper(false);
    }
  };

  // Intervenção Direta da Supervisão (Atribuir / Transferir / Devolver à Fila / Finalizar)
  const handleSupervisoryIntervention = useCallback(
    async (
      conversationId: string,
      action: "transfer" | "return_to_queue" | "close",
      targetOperatorId?: string
    ) => {
      if (demoMode) {
        toast.info("Ação indisponível no modo demonstração.");
        return;
      }
      setInterveningConvId(conversationId);
      try {
        const res = await fetch("/api/gestao/live", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            action,
            targetOperatorId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Não foi possível executar a intervenção.");
        }

        if (action === "close") {
          toast.success("Atendimento finalizado pela supervisão.");
          if (selectedConvId === conversationId) {
            setSelectedConvId(null);
          }
        } else if (action === "return_to_queue") {
          toast.success("Atendimento devolvido para a fila geral.");
        } else {
          toast.success(
            `Atendimento atribuído para ${data.targetOperatorName || "o consultor"}.`
          );
        }

        await fetchLive();
      } catch (err: any) {
        toast.error(err.message || "Falha ao executar intervenção.");
      } finally {
        setInterveningConvId(null);
      }
    },
    [demoMode, fetchLive, selectedConvId]
  );

  // Encontrar conversa selecionada em qualquer seção (incluindo automação IA)
  const allConvs = useMemo(
    () => [
      ...(liveData?.operators.flatMap((op) => op.conversations) ?? []),
      ...(liveData?.unassigned ?? []),
      ...(liveData?.automation ?? []),
    ],
    [liveData]
  );

  const selectedConv = useMemo(
    () => allConvs.find((c) => c.id === selectedConvId) ?? null,
    [allConvs, selectedConvId]
  );

  const selectedOpName = useMemo(() => {
    if (!selectedConvId) return null;
    const foundOp = liveData?.operators.find((op) =>
      op.conversations.some((c) => c.id === selectedConvId)
    );
    if (foundOp) return foundOp.operatorName;
    if (selectedConv?.queueState === "automacao") return `${aiPersona.name} (IA)`;
    return selectedConv?.operatorName ?? null;
  }, [liveData?.operators, selectedConvId, selectedConv, aiPersona.name]);

  // Mensagens exibidas: combina fullHistory (quando carregado) com novas mensagens ao vivo sem congelar
  const displayedMessages = useMemo(() => {
    if (!selectedConv) return [];
    if (fullHistoryConvId !== selectedConvId || fullHistory.length === 0) {
      return selectedConv.messages;
    }
    const existingIds = new Set(fullHistory.map((m) => m.id));
    const newerFromLive = selectedConv.messages.filter((m) => !existingIds.has(m.id));
    return [...fullHistory, ...newerFromLive];
  }, [selectedConv, fullHistoryConvId, selectedConvId, fullHistory]);

  // Filtro de busca, funil CRM e categoria na sidebar
  const searchLower = searchTerm.toLowerCase().trim();
  const matchesSearch = useCallback(
    (c: LiveConversation) =>
      !searchLower ||
      c.contactName.toLowerCase().includes(searchLower) ||
      c.contactPhone.includes(searchLower) ||
      (c.accountName?.toLowerCase().includes(searchLower) ?? false) ||
      (c.activeDeal?.title.toLowerCase().includes(searchLower) ?? false),
    [searchLower]
  );

  const matchesPipeline = useCallback(
    (c: LiveConversation) => {
      if (!pipelineFilter) return true;
      if (pipelineFilter === "__with_deal__") return Boolean(c.activeDeal);
      return c.activeDeal?.pipelineId === pipelineFilter;
    },
    [pipelineFilter]
  );

  const matchesSidebarCategory = useCallback(
    (c: LiveConversation) => {
      if (searchLower) return true;
      if (sidebarFilter === "waiting") {
        return Boolean(c.isUnanswered);
      }
      if (sidebarFilter === "unstarted") {
        return c.activityCategory === "awaiting_first_contact" || c.hasRealInteraction === false;
      }
      if (sidebarFilter === "active") {
        if (c.queueState === "fila" || c.queueState === "automacao") return true;
        if (c.isUnanswered || c.isActiveToday) return true;
        if (c.activityCategory === "recent_active") return true;
        return false;
      }
      return true;
    },
    [sidebarFilter, searchLower]
  );

  const filterConv = useCallback(
    (c: LiveConversation) =>
      matchesSearch(c) && matchesPipeline(c) && matchesSidebarCategory(c),
    [matchesSearch, matchesPipeline, matchesSidebarCategory]
  );

  // Lista de operadores ordenada por urgência e atividade real hoje
  const allOperators = useMemo(() => {
    const ops = liveData?.operators ?? [];
    return [...ops].sort((a, b) => {
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
  }, [liveData?.operators]);

  // Contadores para as pílulas da sidebar (respeitando filtro de funil comercial quando ativo)
  const filterCounts = useMemo(() => {
    const opConvs = (liveData?.operators.flatMap((o) => o.conversations) ?? []).filter(
      matchesPipeline
    );
    const queueCount = (liveData?.unassigned ?? []).filter(matchesPipeline).length;
    const autoCount = (liveData?.automation ?? []).filter(matchesPipeline).length;

    const waitingCount =
      opConvs.filter((c) => c.isUnanswered).length + queueCount;
    const activeCount =
      opConvs.filter(
        (c) =>
          c.isUnanswered ||
          c.isActiveToday ||
          c.activityCategory === "recent_active"
      ).length +
      queueCount +
      autoCount;
    const unstartedCount = opConvs.filter(
      (c) =>
        c.activityCategory === "awaiting_first_contact" ||
        c.hasRealInteraction === false
    ).length;
    const allCount = opConvs.length + queueCount + autoCount;

    return { activeCount, waitingCount, unstartedCount, allCount };
  }, [liveData, matchesPipeline]);

  // Mapas auxiliares para o DealDetailModal
  const operatorsMapForDeal = useMemo(() => {
    const map: Record<string, string> = {};
    for (const op of liveData?.operators ?? []) {
      map[op.operatorId] = op.operatorName;
    }
    return map;
  }, [liveData?.operators]);

  const operatorsListForDeal = useMemo(
    () =>
      (liveData?.operators ?? []).map((op) => ({
        id: op.operatorId,
        name: op.operatorName,
      })),
    [liveData?.operators]
  );

  // Ref para auto-scroll do chat
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedConvId, displayedMessages.length]);

  const filteredUnassigned = useMemo(
    () => (liveData?.unassigned ?? []).filter(filterConv),
    [liveData?.unassigned, filterConv]
  );

  const filteredAutomation = useMemo(
    () =>
      sidebarFilter === "unstarted"
        ? []
        : (liveData?.automation ?? []).filter(
            (c) => matchesSearch(c) && matchesPipeline(c)
          ),
    [liveData?.automation, sidebarFilter, matchesSearch, matchesPipeline]
  );

  const selectedOperatorTyping = selectedConvId
    ? operatorTypingStatus?.[selectedConvId]
    : undefined;
  const selectedClientTyping = selectedConvId
    ? clientTypingStatus?.[selectedConvId]
    : undefined;

  // ── Renderização ────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-[500px] divide-x divide-line rounded-2xl border border-border overflow-hidden bg-card">
      {/* ── SIDEBAR ESQUERDA ────────────────────────────────────────────────── */}
      <div className="w-80 lg:w-[344px] flex flex-col min-h-0 bg-muted/10 shrink-0">
        {/* Barra de busca e filtros */}
        <div className="p-3 border-b border-line shrink-0 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar cliente, número, empresa ou card..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-muted/60 border border-border rounded-xl pl-9 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filtros: Data + Operador */}
          <div className="flex gap-2">
            <LiveDatePicker value={dateFilter} onChange={setDateFilter} />
            <LiveOperatorSelect
              value={opIdFilter}
              onChange={setOpIdFilter}
              operators={allOperators}
            />
          </div>

          {/* Filtro Executivo de Funil Comercial (CRM Pipeline) */}
          <LivePipelineSelect
            value={pipelineFilter}
            onChange={setPipelineFilter}
            pipelines={liveData?.pipelines ?? []}
            openDealsCount={liveData?.summary?.openDealsInLiveCount ?? 0}
          />

          {/* Pílulas de Filtro Operacional com animação suave */}
          <div className="grid grid-cols-4 gap-1 bg-muted/50 p-1 rounded-xl border border-border/60">
            {(
              [
                { id: "active", label: "Ativos", count: filterCounts.activeCount },
                { id: "waiting", label: "Espera", count: filterCounts.waitingCount },
                { id: "unstarted", label: "S/ Início", count: filterCounts.unstartedCount },
                { id: "all", label: "Todos", count: filterCounts.allCount },
              ] as const
            ).map((pill) => {
              const active = sidebarFilter === pill.id;
              return (
                <motion.button
                  key={pill.id}
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setSidebarFilter(pill.id)}
                  className={`flex flex-col items-center justify-center py-1 px-1 rounded-lg text-[10px] font-bold transition-all duration-200 cursor-pointer ${
                    active
                      ? "bg-card text-primary shadow-xs border border-primary/25"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="truncate leading-tight">{pill.label}</span>
                  <span
                    className={`text-[9px] font-extrabold leading-tight ${
                      active
                        ? "text-primary"
                        : pill.id === "waiting" && pill.count > 0
                        ? "text-primary"
                        : "text-muted-foreground/80"
                    }`}
                  >
                    {pill.count}
                  </span>
                </motion.button>
              );
            })}
          </div>

          {/* Chips de filtros ativos */}
          {(dateFilter || opIdFilter || pipelineFilter) && (
            <div className="flex items-center gap-1 flex-wrap pt-0.5">
              {dateFilter && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-semibold">
                  {new Date(dateFilter + "T12:00:00").toLocaleDateString("pt-BR")}
                  <button
                    type="button"
                    onClick={() => setDateFilter("")}
                    className="cursor-pointer hover:opacity-75"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}
              {opIdFilter && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-semibold">
                  {allOperators.find((o) => o.operatorId === opIdFilter)?.operatorName ??
                    "Operador"}
                  <button
                    type="button"
                    onClick={() => setOpIdFilter("")}
                    className="cursor-pointer hover:opacity-75"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}
              {pipelineFilter && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-semibold">
                  {pipelineFilter === "__with_deal__"
                    ? "Com Negócio"
                    : (liveData?.pipelines?.find((p) => p.id === pipelineFilter)?.name ??
                      "Funil")}
                  <button
                    type="button"
                    onClick={() => setPipelineFilter("")}
                    className="cursor-pointer hover:opacity-75"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Botão rápido para voltar ao Cockpit Executivo quando uma conversa está selecionada */}
        <AnimatePresence>
          {selectedConvId && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="px-2.5 pt-2 shrink-0 overflow-hidden"
            >
              <motion.button
                type="button"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedConvId(null)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 text-[11px] font-extrabold transition-all cursor-pointer"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Ver Cockpit Executivo Ao Vivo
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Lista de conversas agrupadas */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-3.5">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground/40" />
            </div>
          )}

          {/* ── Seção: Na Fila (sem operador) ─────────────────────────────── */}
          {!loading && !opIdFilter && filteredUnassigned.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-primary/5 border border-primary/15">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-primary animate-pulse" />
                  <span className="text-[10px] font-extrabold text-primary uppercase tracking-wider">
                    Na Fila sem Consultor
                  </span>
                </div>
                <span className="text-[10px] font-extrabold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                  {filteredUnassigned.length}
                </span>
              </div>
              {filteredUnassigned.map((conv) => (
                <LiveConvCard
                  key={conv.id}
                  conv={conv}
                  isSelected={conv.id === selectedConvId}
                  isClientTyping={Boolean(clientTypingStatus?.[conv.id])}
                  isOperatorTyping={Boolean(operatorTypingStatus?.[conv.id])}
                  onClick={() => setSelectedConvId(conv.id)}
                />
              ))}
            </div>
          )}

          {/* ── Seção: Com Fagner / Valentina (automação — espiável inline) ── */}
          {!loading && !opIdFilter && filteredAutomation.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between px-2 py-1">
                <div className="flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[10px] font-extrabold text-primary uppercase tracking-wider">
                    Triagem IA ({aiPersona.name})
                  </span>
                </div>
                <span className="text-[10px] font-extrabold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                  {filteredAutomation.length}
                </span>
              </div>
              {filteredAutomation.map((conv) => (
                <LiveConvCard
                  key={conv.id}
                  conv={conv}
                  isSelected={conv.id === selectedConvId}
                  isAiTriage
                  isClientTyping={Boolean(clientTypingStatus?.[conv.id])}
                  isOperatorTyping={Boolean(operatorTypingStatus?.[conv.id])}
                  onClick={() => setSelectedConvId(conv.id)}
                />
              ))}
            </div>
          )}

          {/* ── Seção: Operadores ── */}
          {!loading &&
            allOperators
              .filter((op) => (opIdFilter ? op.operatorId === opIdFilter : true))
              .map((op) => ({
                op,
                filtered: op.conversations.filter(filterConv),
              }))
              .filter(({ op, filtered }) => {
                if (opIdFilter) return true;
                if (searchLower || pipelineFilter) return filtered.length > 0;
                if (sidebarFilter === "waiting") return filtered.length > 0;
                if (sidebarFilter === "unstarted") return filtered.length > 0;
                if (sidebarFilter === "active") {
                  return filtered.length > 0 || Boolean(op.isOnline);
                }
                return true;
              })
              .sort((a, b) => {
                const waitDiff =
                  (b.op.waitingReplyCount ?? 0) - (a.op.waitingReplyCount ?? 0);
                if (waitDiff !== 0) return waitDiff;
                const filteredDiff = b.filtered.length - a.filtered.length;
                if (filteredDiff !== 0) return filteredDiff;
                if (Boolean(a.op.isOnline) !== Boolean(b.op.isOnline)) {
                  return a.op.isOnline ? -1 : 1;
                }
                return a.op.operatorName.localeCompare(b.op.operatorName, "pt-BR");
              })
              .map(({ op, filtered }) => {
                const waitingCount = op.waitingReplyCount ?? 0;
                const activeToday = op.activeTodayCount ?? 0;
                const totalCarteira = op.conversations.length;

                return (
                  <div key={op.operatorId} className="space-y-1">
                    <div className="flex items-center justify-between px-2 py-1 shrink-0 gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <SystemTooltip
                          content={
                            op.isOnline
                              ? "Consultor online agora no sistema"
                              : op.lastSeenAt
                              ? `Offline · Visto às ${new Date(
                                  op.lastSeenAt
                                ).toLocaleTimeString("pt-BR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}`
                              : "Offline"
                          }
                        >
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 ${
                              op.isOnline
                                ? "bg-primary ring-2 ring-primary/25"
                                : op.status === "ocupado"
                                ? "bg-muted-foreground"
                                : "bg-muted-foreground/35"
                            }`}
                          />
                        </SystemTooltip>
                        <span className="text-[11px] font-bold text-foreground truncate">
                          {op.operatorName}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {waitingCount > 0 && (
                          <SystemTooltip
                            content={`${waitingCount} cliente(s) aguardando resposta deste consultor`}
                          >
                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground animate-pulse">
                              {waitingCount} esp.
                            </span>
                          </SystemTooltip>
                        )}
                        <SystemTooltip
                          content={`${activeToday} ativo(s) hoje · ${totalCarteira} total na carteira`}
                        >
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                            {sidebarFilter === "all" || sidebarFilter === "unstarted"
                              ? `${filtered.length}/${totalCarteira}`
                              : `${activeToday} hoje`}
                          </span>
                        </SystemTooltip>
                      </div>
                    </div>

                    {filtered.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground pl-4 italic py-0.5">
                        {sidebarFilter === "active"
                          ? totalCarteira > 0
                            ? `Sem conversa ativa hoje (${totalCarteira} na carteira)`
                            : "Sem conversas ativas"
                          : "Nenhum atendimento neste filtro"}
                      </p>
                    ) : (
                      filtered.map((conv) => (
                        <LiveConvCard
                          key={conv.id}
                          conv={conv}
                          isSelected={conv.id === selectedConvId}
                          isClientTyping={Boolean(clientTypingStatus?.[conv.id])}
                          isOperatorTyping={Boolean(operatorTypingStatus?.[conv.id])}
                          onClick={() => setSelectedConvId(conv.id)}
                        />
                      ))
                    )}
                  </div>
                );
              })}

          {!loading &&
            filteredUnassigned.length === 0 &&
            filteredAutomation.length === 0 &&
            allOperators.every((op) => op.conversations.filter(filterConv).length === 0) && (
              <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center text-muted-foreground">
                <Radio className="h-7 w-7 opacity-25" />
                <span className="text-xs font-semibold text-foreground">
                  Nenhum atendimento neste filtro
                </span>
                {sidebarFilter !== "all" && filterCounts.allCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSidebarFilter("all")}
                    className="text-[11px] font-bold text-primary hover:underline cursor-pointer mt-1"
                  >
                    Ver todos os {filterCounts.allCount} registros da carteira
                  </button>
                )}
              </div>
            )}
        </div>

        {/* Rodapé com timestamp de atualização */}
        {lastUpdated && (
          <div className="px-3 py-2 border-t border-line shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
              <span className="text-[9px] text-muted-foreground">
                Atualizado às{" "}
                {lastUpdated.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={fetchLive}
              className="text-[9px] font-bold text-primary hover:underline cursor-pointer"
            >
              Atualizar
            </motion.button>
          </div>
        )}
      </div>

      {/* ── ÁREA PRINCIPAL: Cockpit Executivo OU Modo Espião do Chat ────────── */}
      <div className="flex-1 flex flex-col min-h-0 bg-muted/5 overflow-hidden">
        <AnimatePresence mode="wait">
          {selectedConv ? (
            <motion.div
              key={`spy-${selectedConv.id}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="flex-1 flex flex-col min-h-0 overflow-hidden"
            >
              {/* Header Principal da Conversa Selecionada */}
              <div className="px-5 py-3 border-b border-line bg-card flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <SystemTooltip content="Voltar ao Cockpit Executivo Ao Vivo">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={() => setSelectedConvId(null)}
                      className="h-8 w-8 rounded-xl border border-border bg-muted/40 hover:bg-muted flex items-center justify-center text-foreground transition cursor-pointer shrink-0"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </motion.button>
                  </SystemTooltip>

                  <Avatar
                    name={selectedConv.contactName}
                    avatar={selectedConv.contactAvatar}
                    size="md"
                  />

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xs font-extrabold text-foreground truncate">
                        {selectedConv.contactName}
                      </h3>
                      {selectedConv.accountName && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-muted text-foreground border border-border truncate max-w-[200px]">
                          <Building2 className="h-2.5 w-2.5 text-primary shrink-0" />
                          {selectedConv.accountName}
                        </span>
                      )}
                      {selectedConv.isUnanswered && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/25 animate-pulse">
                          <Clock className="h-2.5 w-2.5" />
                          Esperando há {formatWaitDuration(selectedConv.waitingMinutes)}
                        </span>
                      )}
                      {selectedClientTyping && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-primary text-primary-foreground animate-pulse">
                          <PenTool className="h-2.5 w-2.5" />
                          Cliente digitando...
                        </span>
                      )}
                      {selectedOperatorTyping && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-card text-primary border border-primary/30">
                          <PenTool className="h-2.5 w-2.5 animate-bounce" />
                          {selectedOperatorTyping.operatorName || "Consultor"} digitando...
                        </span>
                      )}
                    </div>

                    <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{formatPhone(selectedConv.contactPhone)}</span>
                      {selectedConv.contactEmail && (
                        <>
                          <span>·</span>
                          <span className="truncate max-w-[180px]">{selectedConv.contactEmail}</span>
                        </>
                      )}
                      {selectedOpName && (
                        <>
                          <span>·</span>
                          <span>
                            Responsável:{" "}
                            <strong className="text-foreground">{selectedOpName}</strong>
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {/* Status da Janela 24h Meta (100% paleta do sistema) */}
                  <SystemTooltip
                    content={
                      selectedConv.metaWindowOpen
                        ? "O cliente enviou mensagem nas últimas 24h. Mensagens livres estão liberadas."
                        : "Sem resposta do cliente nas últimas 24h. Novas abordagens na Meta exigem Template aprovado."
                    }
                  >
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                        selectedConv.metaWindowOpen
                          ? "bg-primary/10 text-primary border-primary/25"
                          : "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      <Clock className="h-3 w-3 shrink-0" />
                      {selectedConv.metaWindowOpen && selectedConv.metaWindowRemainingMinutes
                        ? `Janela 24h (${formatWaitDuration(
                            selectedConv.metaWindowRemainingMinutes
                          )})`
                        : "Janela 24h Fechada"}
                    </span>
                  </SystemTooltip>

                  {/* Popover de Intervenção Direta (Atribuir / Transferir / Devolver à Fila / Finalizar) */}
                  <LiveSupervisorInterventionPopover
                    conv={selectedConv}
                    operators={allOperators}
                    onIntervene={handleSupervisoryIntervention}
                    busy={interveningConvId === selectedConv.id}
                  />

                  {/* Se estiver em triagem com a IA, botão adicional para abrir no módulo da IA */}
                  {selectedConv.queueState === "automacao" && (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        setSelectedChatId(selectedConv.id);
                        setActiveView("valentina");
                      }}
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold text-foreground bg-muted hover:bg-muted/80 border border-border px-3 py-1.5 rounded-lg transition cursor-pointer"
                    >
                      <Bot className="h-3.5 w-3.5 text-primary" />
                      Ver n{aiPersona.gender === "female" ? "a" : "o"} {aiPersona.name}
                    </motion.button>
                  )}

                  {/* Botão Abrir Conversa no Chat */}
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setSelectedChatId(selectedConv.id);
                      setActiveView("chat");
                    }}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/15 border border-primary/20 px-3 py-1.5 rounded-lg transition cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir Conversa
                  </motion.button>

                  {/* Badge AO VIVO */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                    </span>
                    AO VIVO
                  </div>
                </div>
              </div>

              {/* Sub-barra de Contexto Comercial (Card CRM Clicável + Popover de Tarefas) */}
              <div className="px-5 py-2 border-b border-line bg-muted/25 flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0">
                {selectedConv.activeDeal ? (
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <SystemTooltip content="Clique para abrir e inspecionar os detalhes desta negociação no CRM sem sair da aba Ao Vivo">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setInspectDealId(selectedConv.activeDeal!.id)}
                        className="inline-flex items-center gap-1.5 font-extrabold text-primary bg-primary/10 hover:bg-primary/15 border border-primary/25 px-2.5 py-0.5 rounded-md transition cursor-pointer"
                      >
                        <Briefcase className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[230px]">
                          {selectedConv.activeDeal.title}
                        </span>
                        <ExternalLink className="h-2.5 w-2.5 opacity-80 shrink-0" />
                      </motion.button>
                    </SystemTooltip>
                    {selectedConv.activeDeal.value !== null &&
                      selectedConv.activeDeal.value > 0 && (
                        <span className="font-extrabold text-foreground bg-card border border-border px-2 py-0.5 rounded-md">
                          {selectedConv.activeDeal.value.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </span>
                      )}
                    {(selectedConv.activeDeal.pipelineName ||
                      selectedConv.activeDeal.stageName) && (
                      <span className="text-[10px] font-semibold text-muted-foreground bg-card border border-border px-2 py-0.5 rounded-md">
                        {[
                          selectedConv.activeDeal.pipelineName,
                          selectedConv.activeDeal.stageName,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Briefcase className="h-3 w-3 opacity-60" />
                    <span>Sem negociação ativa vinculada a este atendimento no CRM</span>
                  </div>
                )}

                <div className="flex items-center gap-2 shrink-0">
                  <LiveTasksPopover
                    tasks={selectedConv.tasks ?? []}
                    openTasksCount={selectedConv.openTasksCount ?? 0}
                    overdueTasksCount={selectedConv.overdueTasksCount ?? 0}
                  />
                </div>
              </div>

              {/* Balões de Mensagem com suporte a mídia, transcrição e separadores de data */}
              <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col">
                {/* Banner de carregar histórico completo */}
                {selectedConv.messages.length >= 30 && fullHistoryConvId !== selectedConvId && (
                  <div className="px-5 pt-3 pb-1 shrink-0">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.005 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => loadFullHistory(selectedConvId!)}
                      disabled={fullHistoryLoading}
                      className="w-full flex items-center justify-center gap-2 py-1.5 rounded-xl border border-dashed border-border bg-muted/30 hover:bg-muted/60 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer disabled:opacity-50"
                    >
                      {fullHistoryLoading ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando histórico
                          completo...
                        </>
                      ) : (
                        <>
                          <Clock className="h-3.5 w-3.5" /> Carregar histórico anterior completo
                          (exibindo últimas {selectedConv.messages.length})
                        </>
                      )}
                    </motion.button>
                  </div>
                )}

                {/* Timeline de Mensagens */}
                <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-2.5">
                  {displayedMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                      <MessageSquare className="h-8 w-8 opacity-20" />
                      <span className="text-xs">Nenhuma mensagem registrada nesta conversa</span>
                    </div>
                  ) : (
                    displayedMessages.map((msg, idx) => {
                      const isAgent = msg.senderType === "agent" || msg.senderType === "bot";
                      const curDateKey = getMessageDateKey(msg.sentAt);
                      const prevDateKey =
                        idx > 0 ? getMessageDateKey(displayedMessages[idx - 1].sentAt) : "";
                      const showDateSep = Boolean(curDateKey && curDateKey !== prevDateKey);
                      const dateLabel = showDateSep
                        ? formatMessageDateSeparator(msg.sentAt)
                        : null;

                      return (
                        <React.Fragment key={msg.id}>
                          {dateLabel && (
                            <div className="flex items-center justify-center my-3 select-none">
                              <span className="px-3 py-0.5 rounded-full bg-muted/70 border border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                {dateLabel}
                              </span>
                            </div>
                          )}
                          <LiveMessageBubble
                            msg={msg}
                            isAgent={isAgent}
                            contactPhone={selectedConv.contactPhone}
                          />
                        </React.Fragment>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Footer Modo Supervisor + Chips Rápidos + Barra de Sussurro */}
              <div className="px-5 py-3 border-t border-line bg-card flex flex-col gap-2 shrink-0">
                {!demoMode && (
                  <>
                    {/* Chips rápidos de Sussurro da Supervisão */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1 mr-1">
                        <Zap className="h-2.5 w-2.5 text-primary" />
                        Sussurro rápido:
                      </span>
                      {SUPERVISOR_WHISPER_TEMPLATES.map((tpl) => (
                        <motion.button
                          key={tpl}
                          type="button"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                          onClick={() =>
                            setWhisperText((prev) => (prev ? `${prev} · ${tpl}` : tpl))
                          }
                          className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-muted/60 hover:bg-primary/10 text-muted-foreground hover:text-primary border border-border hover:border-primary/30 transition-all cursor-pointer"
                        >
                          {tpl}
                        </motion.button>
                      ))}
                    </div>

                    <form onSubmit={handleSendWhisper} className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Lock className="h-3.5 w-3.5 text-primary absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={whisperText}
                          onChange={(e) => setWhisperText(e.target.value)}
                          placeholder={`Enviar orientação interna (sussurro) para ${
                            selectedOpName || "o consultor"
                          }...`}
                          className="w-full bg-muted/50 border border-border rounded-xl pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                      <motion.button
                        type="submit"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.96 }}
                        disabled={!whisperText.trim() || sendingWhisper}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition cursor-pointer disabled:opacity-40 shrink-0"
                      >
                        {sendingWhisper ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Sussurrar
                      </motion.button>
                    </form>
                  </>
                )}

                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                    </span>
                    <span>
                      Modo Supervisor · Espiando em tempo real ({displayedMessages.length}{" "}
                      mensagens) · O cliente nunca vê os sussurros internos
                    </span>
                  </div>
                  {fullHistoryConvId === selectedConvId && (
                    <span className="text-primary font-semibold">Histórico completo ativo</span>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="cockpit-overview"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="flex-1 flex flex-col min-h-0 overflow-hidden"
            >
              <LiveExecutiveOverview
                liveData={liveData}
                loading={loading}
                aiPersonaName={aiPersona.name}
                onSelectConversation={(convId) => setSelectedConvId(convId)}
                onFilterOperator={(opId) => {
                  setOpIdFilter(opId === opIdFilter ? "" : opId);
                  setSidebarFilter("active");
                }}
                selectedOpId={opIdFilter}
                onSelectSidebarFilter={(f) => setSidebarFilter(f)}
                onIntervene={handleSupervisoryIntervention}
                interveningConvId={interveningConvId}
                onInspectDeal={(dealId) => setInspectDealId(dealId)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modal de Inspeção Direta do Card CRM sem sair da aba Ao Vivo */}
      <DealDetailModal
        dealId={inspectDealId}
        isOpen={Boolean(inspectDealId)}
        onClose={() => setInspectDealId(null)}
        onDealUpdated={() => {
          fetchLive();
        }}
        onOpenConversation={(convId) => {
          setInspectDealId(null);
          setSelectedConvId(convId);
        }}
        onOpenDeal={(targetDealId) => setInspectDealId(targetDealId)}
        pipelineStages={[]}
        operatorsMap={operatorsMapForDeal}
        operators={operatorsListForDeal}
        backLabel="Voltar para Operação Ao Vivo"
      />
    </div>
  );
}

type LiveRadarMode = "waiting" | "failed" | "expiring";

/**
 * Cockpit Executivo da Operação Ao Vivo (Exibido na área principal quando nenhum chat está aberto).
 * 100% paleta do sistema, animações Framer Motion, Radar Multi-Modo (Espera & Fila, Falhas de Entrega, Janela 24h & Tarefas)
 * e Matriz de Produtividade Real do Dia por Consultor.
 */
function LiveExecutiveOverview({
  liveData,
  loading,
  aiPersonaName,
  onSelectConversation,
  onFilterOperator,
  selectedOpId,
  onSelectSidebarFilter,
  onIntervene,
  interveningConvId,
  onInspectDeal,
}: {
  liveData: LiveData | null;
  loading: boolean;
  aiPersonaName: string;
  onSelectConversation: (convId: string) => void;
  onFilterOperator: (opId: string) => void;
  selectedOpId: string;
  onSelectSidebarFilter: (f: LiveSidebarFilter) => void;
  onIntervene: (
    conversationId: string,
    action: "transfer" | "return_to_queue" | "close",
    targetOperatorId?: string
  ) => Promise<void>;
  interveningConvId: string | null;
  onInspectDeal: (dealId: string) => void;
}) {
  const [radarMode, setRadarMode] = useState<LiveRadarMode>("waiting");

  if (loading && !liveData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <RefreshCw className="h-6 w-6 animate-spin text-primary/50" />
        <span className="text-xs font-semibold">Carregando Cockpit Executivo da Operação...</span>
      </div>
    );
  }

  const operators = liveData?.operators ?? [];
  const unassigned = liveData?.unassigned ?? [];
  const automation = liveData?.automation ?? [];
  const summary = liveData?.summary;

  const allEnrichedConvs = [
    ...unassigned.map((c) => ({ ...c, isQueue: true })),
    ...operators.flatMap((op) =>
      op.conversations.map((c) => ({
        ...c,
        operatorName: op.operatorName,
        isQueue: false,
      }))
    ),
    ...automation.map((c) => ({
      ...c,
      operatorName: `${aiPersonaName} (IA)`,
      isQueue: false,
    })),
  ];

  // Modo 1: Clientes aguardando resposta + Fila sem consultor
  const waitingConvs = allEnrichedConvs
    .filter((c) => c.isQueue || c.isUnanswered)
    .sort((a, b) => b.waitingMinutes - a.waitingMinutes);

  // Modo 2: Falhas de Entrega Meta WhatsApp (#131026, #130472, #131049)
  const failedConvs = allEnrichedConvs
    .filter((c) => (c.failedMessagesCount ?? 0) > 0)
    .sort((a, b) => (b.failedMessagesCount ?? 0) - (a.failedMessagesCount ?? 0));

  // Modo 3: Janela 24h expirando (<= 120m) ou Tarefas CRM em atraso
  const expiringOrOverdueConvs = allEnrichedConvs
    .filter(
      (c) =>
        (Boolean(c.metaWindowOpen) &&
          typeof c.metaWindowRemainingMinutes === "number" &&
          c.metaWindowRemainingMinutes <= 120) ||
        (c.overdueTasksCount ?? 0) > 0
    )
    .sort((a, b) => {
      const aRem = a.metaWindowRemainingMinutes ?? 9999;
      const bRem = b.metaWindowRemainingMinutes ?? 9999;
      return aRem - bRem;
    });

  const waitingCount =
    summary?.waitingReplyCount ?? waitingConvs.filter((c) => !c.isQueue).length;
  const criticalWaitCount =
    summary?.criticalWaitCount ?? waitingConvs.filter((c) => c.waitingMinutes >= 15).length;
  const maxWaitMinutes =
    summary?.maxWaitMinutes ??
    waitingConvs.reduce((m, c) => (c.waitingMinutes > m ? c.waitingMinutes : m), 0);
  const activeTodayCount =
    summary?.activeTodayCount ??
    operators.reduce((acc, op) => acc + (op.activeTodayCount ?? 0), 0);
  const totalSentToday =
    summary?.totalSentMessagesToday ??
    operators.reduce((acc, op) => acc + (op.sentMessagesToday ?? 0), 0);
  const onlineOpsCount =
    summary?.onlineOperators ?? operators.filter((o) => o.isOnline).length;
  const awaitingFirstCount =
    summary?.awaitingFirstContactCount ??
    operators.reduce((acc, op) => acc + (op.awaitingFirstContactCount ?? 0), 0);
  const activePipelineValue = summary?.activePipelineValue ?? 0;
  const openDealsCount = summary?.openDealsInLiveCount ?? 0;

  const radarList =
    radarMode === "waiting"
      ? waitingConvs
      : radarMode === "failed"
      ? failedConvs
      : expiringOrOverdueConvs;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-5">
      {/* Cabeçalho do Cockpit */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold text-foreground">
              Cockpit Executivo · Operação Ao Vivo
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-extrabold">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
              TEMPO REAL
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Inspecione atendimentos em tempo real, intervenha na fila e acompanhe a produtividade do dia por consultor
          </p>
        </div>

        <div className="flex items-center gap-2 text-[10px]">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-muted/60 border border-border text-muted-foreground font-semibold">
            <Send className="h-3 w-3 text-primary" />
            <strong className="text-foreground">{totalSentToday}</strong> envios hoje pela equipe
          </span>
        </div>
      </div>

      {/* Linha 1: 4 Cards de Pulso Executivo com animações Framer Motion */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {/* Card 1: Aguardando Resposta */}
        <motion.button
          type="button"
          whileHover={{ y: -2, scale: 1.005 }}
          whileTap={{ scale: 0.985 }}
          onClick={() => {
            onSelectSidebarFilter("waiting");
            setRadarMode("waiting");
          }}
          className="text-left bg-card rounded-2xl p-4 border border-border hover:border-primary/40 shadow-soft transition-colors cursor-pointer flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Esperando Resposta
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Clock className={`h-4 w-4 ${waitingCount > 0 ? "animate-pulse" : ""}`} />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-foreground">
              {waitingCount + unassigned.length}
            </span>
            {criticalWaitCount > 0 && (
              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/25">
                {criticalWaitCount} &gt; 15m
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {maxWaitMinutes > 0
              ? `Maior espera agora: ${formatWaitDuration(maxWaitMinutes)}`
              : "Nenhum cliente aguardando resposta"}
          </p>
        </motion.button>

        {/* Card 2: Em Atendimento Hoje + Fila/IA */}
        <motion.button
          type="button"
          whileHover={{ y: -2, scale: 1.005 }}
          whileTap={{ scale: 0.985 }}
          onClick={() => onSelectSidebarFilter("active")}
          className="text-left bg-card rounded-2xl p-4 border border-border hover:border-primary/40 shadow-soft transition-colors cursor-pointer flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Conversando Hoje
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <MessageSquare className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-foreground">{activeTodayCount}</span>
            <span className="text-[10px] font-semibold text-muted-foreground">
              com interação hoje
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Fila: <strong className="text-foreground">{unassigned.length}</strong> · Triagem{" "}
            {aiPersonaName}: <strong className="text-foreground">{automation.length}</strong>
          </p>
        </motion.button>

        {/* Card 3: Equipe Conectada & Carteira Sem Início (100% paleta do sistema) */}
        <motion.button
          type="button"
          whileHover={{ y: -2, scale: 1.005 }}
          whileTap={{ scale: 0.985 }}
          onClick={() => onSelectSidebarFilter("unstarted")}
          className="text-left bg-card rounded-2xl p-4 border border-border hover:border-primary/40 shadow-soft transition-colors cursor-pointer flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Equipe Online Agora
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-foreground">
              {onlineOpsCount}
              <span className="text-sm font-bold text-muted-foreground">
                /{operators.length}
              </span>
            </span>
            <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
              conectados
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            <strong className="text-foreground">{awaitingFirstCount}</strong> contatos aguardando 1º
            contato
          </p>
        </motion.button>

        {/* Card 4: Pipeline em Atendimento Ao Vivo */}
        <motion.div
          whileHover={{ y: -2 }}
          className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Pipeline em Atendimento
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Briefcase className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-black text-foreground truncate">
              {activePipelineValue.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
                maximumFractionDigits: 0,
              })}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            <strong className="text-foreground">{openDealsCount}</strong> negociações abertas
            vinculadas
          </p>
        </motion.div>
      </div>

      {/* Linha 2: Radar Executivo Multi-Modo + Produtividade Real por Consultor */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Coluna 1 (7 cols): Radar Executivo Multi-Modo */}
        <div className="xl:col-span-7 bg-card rounded-2xl border border-border shadow-soft flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-primary" />
              <span className="text-xs font-extrabold text-foreground">
                Radar Executivo de Prioridade
              </span>
            </div>

            {/* Seletor de Modo do Radar */}
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border">
              {(
                [
                  {
                    id: "waiting",
                    label: "Espera & Fila",
                    count: waitingConvs.length,
                    icon: Clock,
                  },
                  {
                    id: "failed",
                    label: "Falhas Entrega",
                    count: failedConvs.length,
                    icon: AlertTriangle,
                  },
                  {
                    id: "expiring",
                    label: "Janela 24h & Tarefas",
                    count: expiringOrOverdueConvs.length,
                    icon: Timer,
                  },
                ] as const
              ).map((tab) => {
                const active = radarMode === tab.id;
                const TabIcon = tab.icon;
                return (
                  <motion.button
                    key={tab.id}
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setRadarMode(tab.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                      active
                        ? "bg-card text-primary shadow-xs border border-primary/25"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <TabIcon className="h-3 w-3 shrink-0" />
                    <span>{tab.label}</span>
                    <span
                      className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full ${
                        active
                          ? "bg-primary/15 text-primary"
                          : tab.count > 0
                          ? "bg-muted text-foreground"
                          : "bg-muted/50 text-muted-foreground"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </div>

          <div className="divide-y divide-line max-h-[410px] overflow-y-auto scrollbar-thin">
            <AnimatePresence mode="wait">
              {radarList.length === 0 ? (
                <motion.div
                  key={`empty-${radarMode}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2 px-4 text-center"
                >
                  <CheckCircle2 className="h-8 w-8 text-primary/70" />
                  <p className="text-xs font-bold text-foreground">
                    {radarMode === "waiting"
                      ? "Nenhum cliente aguardando resposta agora!"
                      : radarMode === "failed"
                      ? "Nenhuma conversa com falha de entrega no WhatsApp!"
                      : "Nenhuma janela 24h crítica nem tarefa atrasada nos chats ativos!"}
                  </p>
                  <p className="text-[11px]">
                    {radarMode === "waiting"
                      ? "Todos os clientes que enviaram mensagem já foram respondidos."
                      : radarMode === "failed"
                      ? "Todas as mensagens enviadas pelos consultores foram entregues normalmente."
                      : "As janelas de conversação da Meta e tarefas do CRM estão em dia."}
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key={`list-${radarMode}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                  className="divide-y divide-line"
                >
                  {radarList.slice(0, 18).map((conv) => {
                    const isCrit = conv.waitingMinutes >= 15;
                    return (
                      <div
                        key={conv.id}
                        onClick={() => onSelectConversation(conv.id)}
                        className="px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Avatar
                            name={conv.contactName}
                            avatar={conv.contactAvatar}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-foreground truncate">
                                {conv.contactName}
                              </span>
                              {conv.accountName && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[140px]">
                                  {conv.accountName}
                                </span>
                              )}
                              {conv.activeDeal && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onInspectDeal(conv.activeDeal!.id);
                                  }}
                                  className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 truncate max-w-[165px] inline-flex items-center gap-1 cursor-pointer transition"
                                >
                                  <Briefcase className="h-2.5 w-2.5 shrink-0" />
                                  <span className="truncate">
                                    {conv.activeDeal.stageName || conv.activeDeal.title}
                                  </span>
                                </button>
                              )}
                            </div>

                            <p className="text-[11px] text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                              {getLiveMessageMediaIcon(
                                conv.lastMessage,
                                "h-3 w-3 text-primary shrink-0"
                              )}
                              <span className="truncate">
                                "{formatLiveMessagePreview(conv.lastMessage)}"
                              </span>
                            </p>

                            <div className="flex items-center gap-2 flex-wrap text-[9px] text-muted-foreground/80 mt-0.5">
                              {conv.isQueue ? (
                                <span className="text-primary font-extrabold">
                                  Na Fila (Sem consultor)
                                </span>
                              ) : (
                                <span>
                                  Consultor:{" "}
                                  <strong className="text-foreground">
                                    {conv.operatorName || "Atribuído"}
                                  </strong>
                                </span>
                              )}

                              {radarMode === "failed" && (conv.failedMessagesCount ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-1 text-primary font-bold">
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  {conv.failedMessagesCount} falha(s) de envio
                                </span>
                              )}

                              {radarMode === "expiring" && (
                                <>
                                  {conv.metaWindowOpen &&
                                    typeof conv.metaWindowRemainingMinutes === "number" &&
                                    conv.metaWindowRemainingMinutes <= 120 && (
                                      <span className="inline-flex items-center gap-1 text-primary font-bold">
                                        <Timer className="h-2.5 w-2.5" />
                                        Janela fecha em{" "}
                                        {formatWaitDuration(conv.metaWindowRemainingMinutes)}
                                      </span>
                                    )}
                                  {(conv.overdueTasksCount ?? 0) > 0 && (
                                    <span className="inline-flex items-center gap-1 text-primary font-bold">
                                      <ClipboardCheck className="h-2.5 w-2.5" />
                                      {conv.overdueTasksCount} tarefa(s) atrasada(s)
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {radarMode === "waiting" && (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-extrabold border ${
                                isCrit
                                  ? "bg-primary text-primary-foreground border-primary animate-pulse"
                                  : "bg-primary/10 text-primary border-primary/20"
                              }`}
                            >
                              <Clock className="h-3 w-3" />
                              {formatWaitDuration(conv.waitingMinutes)}
                            </span>
                          )}

                          <LiveSupervisorInterventionPopover
                            conv={conv}
                            operators={operators}
                            onIntervene={onIntervene}
                            busy={interveningConvId === conv.id}
                            compact
                          />

                          <motion.button
                            type="button"
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.96 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectConversation(conv.id);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-muted hover:bg-primary hover:text-primary-foreground text-foreground text-[10px] font-bold transition-colors cursor-pointer border border-border"
                          >
                            Espiar
                          </motion.button>
                        </div>
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Coluna 2 (5 cols): Carga Real & Produtividade Hoje por Consultor */}
        <div className="xl:col-span-5 bg-card rounded-2xl border border-border shadow-soft flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-xs font-extrabold text-foreground">
                Equipe & Produtividade Hoje ({operators.length})
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              Clique para filtrar consultor
            </span>
          </div>

          <div className="divide-y divide-line max-h-[410px] overflow-y-auto scrollbar-thin">
            {operators.map((op) => {
              const isSelectedOp = selectedOpId === op.operatorId;
              const waiting = op.waitingReplyCount ?? 0;
              const activeToday = op.activeTodayCount ?? 0;
              const unstarted = op.awaitingFirstContactCount ?? 0;
              const total = op.conversations.length;
              const sentToday = op.sentMessagesToday ?? 0;
              const usageStr = formatUsageHoursShort(op.usageSecondsToday);
              const avgResp = op.avgResponseMinutesToday;

              return (
                <motion.div
                  key={op.operatorId}
                  whileHover={{ backgroundColor: "rgba(0,0,0,0.015)" }}
                  onClick={() => onFilterOperator(op.operatorId)}
                  className={`px-4 py-3 transition-colors cursor-pointer flex flex-col gap-2 ${
                    isSelectedOp ? "bg-primary/10" : "hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative">
                        <Avatar name={op.operatorName} avatar={op.operatorAvatar} size="sm" />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${
                            op.isOnline ? "bg-primary" : "bg-muted-foreground/40"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">
                          {op.operatorName}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {op.isOnline
                            ? "Online agora"
                            : op.lastSeenAt
                            ? `Visto às ${new Date(op.lastSeenAt).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}`
                            : "Offline"}
                          {(op.activeDealsValue ?? 0) > 0 && (
                            <>
                              {" · "}
                              <strong className="text-foreground">
                                {(op.activeDealsValue ?? 0).toLocaleString("pt-BR", {
                                  style: "currency",
                                  currency: "BRL",
                                  maximumFractionDigits: 0,
                                })}
                              </strong>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 text-[10px]">
                      <SystemTooltip content="Clientes aguardando resposta deste consultor agora">
                        <span
                          className={`px-2 py-0.5 rounded-md font-extrabold border ${
                            waiting > 0
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted/50 text-muted-foreground border-border"
                          }`}
                        >
                          {waiting} esp.
                        </span>
                      </SystemTooltip>
                      <SystemTooltip content="Conversas com interação real hoje">
                        <span className="px-2 py-0.5 rounded-md font-bold bg-card text-foreground border border-border">
                          {activeToday} hoje
                        </span>
                      </SystemTooltip>
                      <SystemTooltip
                        content={`${unstarted} aguardando 1º contato · ${total} total não finalizados na carteira`}
                      >
                        <span className="px-2 py-0.5 rounded-md font-medium bg-muted/40 text-muted-foreground border border-border">
                          {total} cart.
                        </span>
                      </SystemTooltip>
                    </div>
                  </div>

                  {/* Sub-linha de Produtividade do Dia (Tempo Ativo, Mensagens Enviadas e TMR Hoje) */}
                  <div className="flex items-center justify-between gap-2 pl-9 text-[9px] text-muted-foreground">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <SystemTooltip content="Tempo ativo acumulado no sistema hoje">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5 text-primary" />
                          Ativo: <strong className="text-foreground">{usageStr}</strong>
                        </span>
                      </SystemTooltip>
                      <SystemTooltip content="Total de mensagens enviadas pelo consultor hoje">
                        <span className="inline-flex items-center gap-1">
                          <Send className="h-2.5 w-2.5 text-primary" />
                          Envios: <strong className="text-foreground">{sentToday}</strong>
                        </span>
                      </SystemTooltip>
                      <SystemTooltip content="Tempo médio de resposta do consultor hoje">
                        <span className="inline-flex items-center gap-1">
                          <Timer className="h-2.5 w-2.5 text-primary" />
                          TMR:{" "}
                          <strong className="text-foreground">
                            {avgResp !== null && avgResp !== undefined
                              ? `${avgResp}m`
                              : "—"}
                          </strong>
                        </span>
                      </SystemTooltip>
                    </div>

                    {(op.failedDeliveriesCount ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 text-primary font-bold">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {op.failedDeliveriesCount} falha(s)
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Card de conversa na sidebar com animações Framer Motion, ícones Lucide e indicador de digitação ao vivo */
function LiveConvCard({
  conv,
  isSelected,
  onClick,
  isAiTriage = false,
  isClientTyping = false,
  isOperatorTyping = false,
}: {
  conv: LiveConversation;
  isSelected: boolean;
  onClick: () => void;
  isAiTriage?: boolean;
  isClientTyping?: boolean;
  isOperatorTyping?: boolean;
}) {
  const isUnstarted =
    conv.activityCategory === "awaiting_first_contact" || conv.hasRealInteraction === false;
  const hasFailed = (conv.failedMessagesCount ?? 0) > 0;
  const mediaIcon = getLiveMessageMediaIcon(
    conv.lastMessage,
    `h-3 w-3 shrink-0 ${isSelected ? "text-primary-foreground/90" : "text-primary"}`
  );

  return (
    <motion.button
      type="button"
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={`w-full text-left p-2.5 rounded-xl transition-colors duration-150 flex flex-col gap-1 cursor-pointer border relative ${
        isSelected
          ? "bg-primary text-primary-foreground border-primary shadow-xs"
          : conv.isUnanswered && conv.waitingMinutes >= 15
          ? "bg-primary/5 border-primary/30 hover:bg-primary/10 text-foreground"
          : isUnstarted
          ? "bg-muted/20 border-border/70 hover:bg-muted/40 text-foreground opacity-85"
          : "bg-card border-border hover:bg-muted/40 text-foreground"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0 pr-1">
          {isAiTriage && (
            <Bot
              className={`h-3 w-3 shrink-0 ${
                isSelected ? "text-primary-foreground" : "text-primary"
              }`}
            />
          )}
          <span className="text-xs font-bold truncate">{conv.contactName}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {hasFailed && (
            <SystemTooltip content="Há mensagem com falha de entrega nesta conversa">
              <AlertTriangle
                className={`h-3 w-3 ${isSelected ? "text-white" : "text-primary"}`}
              />
            </SystemTooltip>
          )}
          {conv.isUnanswered ? (
            <span
              className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 ${
                isSelected
                  ? "bg-white/20 text-white"
                  : conv.waitingMinutes >= 15
                  ? "bg-primary text-primary-foreground animate-pulse"
                  : "bg-primary/10 text-primary border border-primary/20"
              }`}
            >
              <Clock className="h-2.5 w-2.5" />
              {formatWaitDuration(conv.waitingMinutes)}
            </span>
          ) : isUnstarted ? (
            <span
              className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${
                isSelected
                  ? "bg-white/15 text-white/90"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              S/ 1º contato
            </span>
          ) : null}
        </div>
      </div>

      {isClientTyping || isOperatorTyping ? (
        <p
          className={`text-[10px] font-bold truncate flex items-center gap-1 ${
            isSelected ? "text-primary-foreground" : "text-primary"
          }`}
        >
          <PenTool className="h-2.5 w-2.5 animate-bounce shrink-0" />
          <span>
            {isClientTyping ? "Cliente digitando..." : "Consultor digitando..."}
          </span>
        </p>
      ) : (
        <p
          className={`text-[10px] truncate flex items-center gap-1 ${
            isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
          }`}
        >
          {mediaIcon}
          <span className="truncate">{formatLiveMessagePreview(conv.lastMessage)}</span>
        </p>
      )}

      {(conv.activeDeal || conv.accountName) && (
        <div className="flex items-center gap-1.5 mt-0.5 overflow-hidden">
          {conv.accountName && (
            <span
              className={`text-[9px] font-semibold truncate max-w-[110px] ${
                isSelected ? "text-primary-foreground/90" : "text-foreground/80"
              }`}
            >
              {conv.accountName}
            </span>
          )}
          {conv.activeDeal && (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.2 rounded truncate inline-flex items-center gap-1 ${
                isSelected
                  ? "bg-white/20 text-white"
                  : "bg-primary/10 text-primary"
              }`}
            >
              <Briefcase className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">
                {conv.activeDeal.value
                  ? conv.activeDeal.value.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                      maximumFractionDigits: 0,
                    })
                  : conv.activeDeal.stageName || conv.activeDeal.title}
              </span>
            </span>
          )}
        </div>
      )}
    </motion.button>
  );
}

function PlaceholderTab({ icon: Icon, title, description }: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Icon className="h-8 w-8 text-primary/50" />
      </div>
      <div className="text-center max-w-sm">
        <p className="font-bold text-foreground mb-1">{title}</p>
        <p className="text-sm">{description}</p>
      </div>
    </div>
  );
}

// ── GlobalTasksTab (Cockpit Executivo 360º da Diretoria) ─────────────────────

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type GlobalTaskViewMode = "queue" | "month" | "week" | "day";
type GlobalTaskQueueSubTab = "overdue" | "today" | "upcoming7d" | "open_deals" | "completed" | "all";
type GlobalTaskSortBy = "value_desc" | "overdue_desc" | "due_asc" | "operator_asc";

const GLOBAL_TASK_TYPE_META: Record<string, { label: string; shortLabel: string }> = {
  call:     { label: "Ligação",  shortLabel: "Ligação" },
  whatsapp: { label: "WhatsApp", shortLabel: "WhatsApp" },
  meeting:  { label: "Reunião",  shortLabel: "Reunião" },
  visit:    { label: "Visita",   shortLabel: "Visita" },
  email:    { label: "E-mail",   shortLabel: "E-mail" },
  lunch:    { label: "Almoço",   shortLabel: "Almoço" },
  task:     { label: "Tarefa",   shortLabel: "Tarefa" },
};

const TASK_SUPERVISOR_WHISPER_PRESETS = [
  {
    label: "Cobrar execução imediata",
    buildText: (t: GlobalTaskItem) =>
      `[Diretoria • Cobrança de Tarefa] Priorize agora a atividade "${t.name}" com ${t.client.name || "o cliente"}${t.deal?.name ? ` (${t.deal.name})` : ""} e atualize o retorno no CRM.`,
  },
  {
    label: "Pedir status da negociação",
    buildText: (t: GlobalTaskItem) =>
      `[Diretoria • Alinhamento Comercial] Qual o status atualizado da tarefa "${t.name}"${t.deal?.name ? ` na oportunidade "${t.deal.name}"` : ""}? Precisamos de visibilidade hoje.`,
  },
  {
    label: "Solicitar reagendamento formal",
    buildText: (t: GlobalTaskItem) =>
      `[Diretoria • Higiene de Agenda] A atividade "${t.name}" está vencida. Conclua com registro do que foi feito ou reagende para o próximo passo real com o cliente.`,
  },
];

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDay = firstDay.getDay();
  for (let i = startDay - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push(new Date(year, month + 1, i));
  }
  return days;
}

function getWeekDays(anchorDate: Date): Date[] {
  const start = new Date(anchorDate);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, idx) => {
    const d = new Date(start);
    d.setDate(start.getDate() + idx);
    return d;
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getTaskTypeIcon(type: string, className = "h-3.5 w-3.5") {
  switch ((type || "task").toLowerCase()) {
    case "call":     return <Phone className={className} />;
    case "email":    return <Mail className={className} />;
    case "meeting":  return <Users className={className} />;
    case "whatsapp": return <MessageSquare className={className} />;
    case "visit":    return <MapPin className={className} />;
    case "lunch":    return <Utensils className={className} />;
    default:         return <ClipboardCheck className={className} />;
  }
}

function getTaskTypeLabel(type: string): string {
  const key = (type || "task").toLowerCase();
  return GLOBAL_TASK_TYPE_META[key]?.label || "Tarefa";
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatPhone(phone: string | null): string {
  if (!phone) return "—";
  const clean = phone.replace(/\D/g, "");
  if (clean.length === 13) return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`;
  if (clean.length === 11) return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  return phone;
}

function formatBrlCompact(val: number | null | undefined): string {
  const num = Number(val || 0);
  if (!Number.isFinite(num) || num <= 0) return "R$ 0";
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function formatRelativeDueBadge(dueDateStr: string | null, isCompleted: boolean): { label: string; isOverdue: boolean; overdueMinutes: number } {
  if (!dueDateStr) return { label: "Sem prazo definido", isOverdue: false, overdueMinutes: 0 };
  const due = new Date(dueDateStr);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffMin = Math.round(Math.abs(diffMs) / 60_000);
  if (isCompleted) {
    return {
      label: `${due.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${formatTime(dueDateStr)}`,
      isOverdue: false,
      overdueMinutes: 0,
    };
  }
  if (diffMs < 0) {
    const overdueLabel = diffMin < 60
      ? `Atrasada há ${Math.max(1, diffMin)}min`
      : diffMin < 1440
        ? `Atrasada há ${Math.floor(diffMin / 60)}h ${diffMin % 60}m`
        : `Atrasada há ${Math.floor(diffMin / 1440)}d ${Math.floor((diffMin % 1440) / 60)}h`;
    return { label: overdueLabel, isOverdue: true, overdueMinutes: diffMin };
  }
  if (isSameDay(due, now)) {
    const inLabel = diffMin < 60 ? `Em ${Math.max(1, diffMin)}min` : `Hoje às ${formatTime(dueDateStr)}`;
    return { label: inLabel, isOverdue: false, overdueMinutes: 0 };
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(due, tomorrow)) {
    return { label: `Amanhã às ${formatTime(dueDateStr)}`, isOverdue: false, overdueMinutes: 0 };
  }
  return {
    label: `${due.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${formatTime(dueDateStr)}`,
    isOverdue: false,
    overdueMinutes: 0,
  };
}

function buildQuickReschedulePresetIso(preset: "plus_1h" | "today_16h" | "tomorrow_9h" | "next_mon_9h"): string {
  const now = new Date();
  if (preset === "plus_1h") {
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  }
  if (preset === "today_16h") {
    const d = new Date(now);
    d.setHours(16, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (preset === "tomorrow_9h") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  const d = new Date(now);
  const day = d.getDay();
  const daysUntilMon = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + daysUntilMon);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function taskMatchesOperatorFilter(task: GlobalTaskItem, opFilter: string): boolean {
  if (!opFilter || opFilter === "all") return true;
  if (task.operatorId === opFilter) return true;
  if (Array.isArray(task.assignedOperatorIds) && task.assignedOperatorIds.includes(opFilter)) return true;
  if (Array.isArray(task.assignedOperators) && task.assignedOperators.some((op) => op.id === opFilter)) return true;
  return false;
}

// ── GLOBAL TASK CARD 360º ──
function GlobalTaskCard360({
  task,
  compact = false,
  peekConvId,
  peekMessages,
  loadingPeekId,
  whisperTaskId,
  whisperText,
  sendingWhisper,
  startingChatTaskId,
  reschedulingTaskId,
  onToggleComplete,
  onEditTask,
  onRescheduleTask,
  onCancelTask,
  onDeleteTask,
  onTogglePeek,
  onToggleWhisper,
  onChangeWhisperText,
  onSendWhisper,
  onOpenOrStartChat,
  onNavigateDeal,
}: {
  task: GlobalTaskItem;
  compact?: boolean;
  peekConvId: string | null;
  peekMessages: LiveMessage[];
  loadingPeekId: string | null;
  whisperTaskId: string | null;
  whisperText: string;
  sendingWhisper: boolean;
  startingChatTaskId: string | null;
  reschedulingTaskId: string | null;
  onToggleComplete: (task: GlobalTaskItem) => void;
  onEditTask: (task: GlobalTaskItem) => void;
  onRescheduleTask: (task: GlobalTaskItem, newIso: string) => void;
  onCancelTask: (task: GlobalTaskItem) => void;
  onDeleteTask: (task: GlobalTaskItem) => void;
  onTogglePeek: (task: GlobalTaskItem) => void;
  onToggleWhisper: (task: GlobalTaskItem) => void;
  onChangeWhisperText: (text: string) => void;
  onSendWhisper: (task: GlobalTaskItem, textOverride?: string) => void;
  onOpenOrStartChat: (task: GlobalTaskItem) => void;
  onNavigateDeal: (dealId: string) => void;
}) {
  const [customRescheduleDate, setCustomRescheduleDate] = useState<string>(task.dueDate || new Date().toISOString());
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const isCompleted = task.status === "done" || task.status === "completed";
  const dueBadge = formatRelativeDueBadge(task.dueDate, isCompleted);
  const isOverdue = !isCompleted && dueBadge.isOverdue;
  const isPeekOpen = Boolean(task.chatConversationId && peekConvId === task.chatConversationId);
  const isWhisperOpen = whisperTaskId === task.id;
  const dealValue = Number(task.deal?.numericValue || 0);
  const dealStatus = (task.deal?.status || "open").toLowerCase();
  const isZombieTask = isOverdue && (dealStatus === "won" || dealStatus === "lost");
  const assignedList = Array.isArray(task.assignedOperators) && task.assignedOperators.length > 0
    ? task.assignedOperators
    : [{ id: task.operatorId || "unassigned", name: task.operatorName, email: task.operatorEmail, avatar: task.operatorAvatar }];

  const peekMessagesToRender = useMemo(() => {
    if (!isPeekOpen) return [];
    if (peekMessages.length > 0) return peekMessages;
    return (task.recentMessages || []) as LiveMessage[];
  }, [isPeekOpen, peekMessages, task.recentMessages]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className={`group rounded-2xl border transition-all ${
        isOverdue
          ? "border-primary/40 bg-primary/5 shadow-sm"
          : isCompleted
            ? "border-border/60 bg-card/70 opacity-80"
            : "border-border bg-card hover:border-primary/30 hover:shadow-sm"
      } ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <SystemTooltip content={isCompleted ? "Tarefa concluída" : "Concluir tarefa"}>
            <button
              type="button"
              onClick={() => onToggleComplete(task)}
              className="mt-0.5 shrink-0 cursor-pointer text-muted-foreground hover:text-primary transition-colors"
            >
              {isCompleted ? (
                <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
              ) : (
                <Circle className="h-4.5 w-4.5" />
              )}
            </button>
          </SystemTooltip>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className="inline-flex items-center gap-1 rounded-lg bg-primary/15 text-primary border border-primary/25 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider">
                {getTaskTypeIcon(task.type, "h-3 w-3")}
                {getTaskTypeLabel(task.type)}
              </span>

              <span
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold border ${
                  isOverdue
                    ? "bg-primary text-primary-foreground border-primary shadow-xs"
                    : isCompleted
                      ? "bg-muted text-muted-foreground border-border"
                      : "bg-muted/60 text-foreground border-border"
                }`}
              >
                <Clock className="h-2.5 w-2.5" />
                {dueBadge.label}
              </span>

              {isZombieTask && (
                <SystemTooltip content="Esta tarefa está pendente em uma oportunidade já encerrada (Ganha ou Perdida). Recomendado concluir ou cancelar.">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 text-primary border border-primary/30 px-2 py-0.5 text-[9px] font-extrabold uppercase">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    Negócio {dealStatus === "won" ? "Ganho" : "Perdido"}
                  </span>
                </SystemTooltip>
              )}
            </div>

            <p className={`${compact ? "text-xs" : "text-sm"} font-extrabold leading-snug ${isCompleted ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {task.name}
            </p>

            {task.description && (
              <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                {task.description}
              </p>
            )}
          </div>
        </div>

        {/* Ações Rápidas da Diretoria */}
        <div className="flex items-center gap-1 shrink-0">
          {!isCompleted && (
            <Popover open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
              <SystemTooltip content="Reagendar tarefa com 1 clique">
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={reschedulingTaskId === task.id}
                    className="h-7 w-7 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-primary flex items-center justify-center transition cursor-pointer disabled:opacity-50"
                  >
                    {reschedulingTaskId === task.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
                  </button>
                </PopoverTrigger>
              </SystemTooltip>
              <PopoverContent align="end" className="w-72 p-3 rounded-2xl bg-card border border-border shadow-card space-y-2.5 z-50">
                <p className="text-[11px] font-extrabold text-foreground flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 text-primary" />
                  Reagendamento Rápido
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: "plus_1h" as const, label: "+1 Hora" },
                    { id: "today_16h" as const, label: "Hoje 16:00" },
                    { id: "tomorrow_9h" as const, label: "Amanhã 09:00" },
                    { id: "next_mon_9h" as const, label: "Próx. Seg 09:00" },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        onRescheduleTask(task, buildQuickReschedulePresetIso(preset.id));
                        setRescheduleOpen(false);
                      }}
                      className="rounded-xl border border-border bg-muted/40 hover:bg-primary/10 hover:border-primary/30 hover:text-primary px-2.5 py-1.5 text-[10px] font-bold text-foreground transition cursor-pointer text-left"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="pt-1.5 border-t border-border space-y-1.5">
                  <span className="text-[10px] font-bold text-muted-foreground block">Data e hora personalizada</span>
                  <SystemDateTimePicker
                    value={customRescheduleDate}
                    onChange={(iso) => setCustomRescheduleDate(iso)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customRescheduleDate) {
                        onRescheduleTask(task, customRescheduleDate);
                        setRescheduleOpen(false);
                      }
                    }}
                    className="w-full rounded-xl bg-primary text-primary-foreground py-1.5 text-[11px] font-bold hover:opacity-90 transition cursor-pointer"
                  >
                    Salvar Novo Prazo
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          )}

          <SystemTooltip content="Editar ou reatribuir responsável">
            <button
              type="button"
              onClick={() => onEditTask(task)}
              className="h-7 w-7 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-primary flex items-center justify-center transition cursor-pointer"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </SystemTooltip>

          {!isCompleted && (
            <SystemTooltip content="Cancelar tarefa">
              <button
                type="button"
                onClick={() => onCancelTask(task)}
                className="h-7 w-7 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-primary flex items-center justify-center transition cursor-pointer"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          )}

          <SystemTooltip content="Excluir tarefa permanentemente">
            <button
              type="button"
              onClick={() => onDeleteTask(task)}
              className="h-7 w-7 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-primary flex items-center justify-center transition cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Deal & Client Strip */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-xl bg-muted/35 border border-border/60 px-3 py-2 flex items-center justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <User className="h-3 w-3 text-primary shrink-0" />
              <p className="text-[11px] font-bold text-foreground truncate">
                {task.client.name || "Cliente sem nome"}
              </p>
            </div>
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
              {task.client.companyName ? `${task.client.companyName} · ` : ""}
              {formatPhone(task.client.phone)}
            </p>
          </div>
          {task.unreadCount > 0 && (
            <span className="shrink-0 rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[9px] font-extrabold">
              {task.unreadCount} não lida{task.unreadCount > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {task.deal ? (
          <button
            type="button"
            onClick={() => onNavigateDeal(task.deal!.id)}
            className="rounded-xl bg-primary/5 hover:bg-primary/10 border border-primary/20 px-3 py-2 flex items-center justify-between gap-2 text-left transition cursor-pointer min-w-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Briefcase className="h-3 w-3 text-primary shrink-0" />
                <p className="text-[11px] font-extrabold text-foreground truncate">
                  {task.deal.name || "Oportunidade CRM"}
                </p>
                <ExternalLink className="h-2.5 w-2.5 text-primary shrink-0" />
              </div>
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                {[task.deal.pipelineName, task.deal.stageName].filter(Boolean).join(" · ") || "Funil Comercial"}
              </p>
            </div>
            <div className="text-right shrink-0">
              {dealValue > 0 && (
                <p className="text-xs font-extrabold text-primary leading-none">
                  {formatBrlCompact(dealValue)}
                </p>
              )}
              <span className="inline-block mt-0.5 rounded px-1.5 py-0.2 text-[8px] font-extrabold uppercase bg-card border border-border text-muted-foreground">
                {dealStatus === "won" ? "Ganha" : dealStatus === "lost" ? "Perdida" : "Em Aberto"}
              </span>
            </div>
          </button>
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 px-3 py-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <Briefcase className="h-3 w-3 text-muted-foreground/60 shrink-0" />
            <span>Sem oportunidade CRM vinculada</span>
          </div>
        )}
      </div>

      {/* Última mensagem / Áudio / Transcrição */}
      {(task.lastMessagePreview || task.lastMessageMediaType === "audio") && !isPeekOpen && (
        <div className="mt-2.5 rounded-xl bg-muted/25 border border-border/50 px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <MessageSquare className="h-2.5 w-2.5 text-primary" />
              Última Interação ({task.lastMessageSenderType === "client" ? "Cliente" : "Consultor"})
            </span>
          </div>
          {task.lastMessageMediaType === "audio" && task.lastMessageMediaId ? (
            <div className="space-y-1">
              <AudioWithSpeed src={`${LIVE_BACKEND_URL}/api/whatsapp/media/${task.lastMessageMediaId}`} />
              {task.lastMessageTranscription && (
                <p className="text-[10px] italic text-muted-foreground bg-card/80 rounded-lg px-2 py-1 border border-border/40">
                  "{task.lastMessageTranscription}"
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-foreground/90 line-clamp-2">{task.lastMessagePreview}</p>
          )}
        </div>
      )}

      {/* Rodapé: Consultores Responsáveis + Ações de Supervisão */}
      <div className="mt-3 pt-2.5 border-t border-border/60 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex -space-x-1.5 shrink-0">
            {assignedList.slice(0, 3).map((op, idx) => {
              const initials = (op.name || "OP").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
              return (
                <SystemTooltip key={`${op.id}-${idx}`} content={`Responsável: ${op.name}`}>
                  <div className="h-6 w-6 rounded-full bg-primary/15 text-primary border border-card flex items-center justify-center text-[8px] font-extrabold overflow-hidden">
                    {op.avatar ? (
                      <img src={op.avatar} alt={op.name} className="h-full w-full object-cover" />
                    ) : (
                      <span>{initials}</span>
                    )}
                  </div>
                </SystemTooltip>
              );
            })}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  task.operatorIsOnline ? "bg-primary" : "bg-muted-foreground/40"
                }`}
              />
              <span className="text-[11px] font-bold text-foreground truncate">
                {assignedList.map((o) => o.name).join(", ")}
              </span>
            </div>
            {task.delegatedBy && (
              <p className="text-[9px] text-muted-foreground truncate">
                Delegada por {task.delegatedBy}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {task.chatConversationId && (
            <>
              <button
                type="button"
                onClick={() => onTogglePeek(task)}
                className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-bold border transition cursor-pointer ${
                  isPeekOpen
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:bg-muted"
                }`}
              >
                <Eye className="h-3 w-3" />
                {isPeekOpen ? "Fechar Conversa" : "Espiar Conversa"}
              </button>

              <button
                type="button"
                onClick={() => onToggleWhisper(task)}
                className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-bold border transition cursor-pointer ${
                  isWhisperOpen
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-primary/10 text-primary border-primary/25 hover:bg-primary/15"
                }`}
              >
                <Lock className="h-3 w-3" />
                Cobrar Consultor
              </button>
            </>
          )}

          {(task.chatConversationId || task.chatContactId) && (
            <button
              type="button"
              disabled={startingChatTaskId === task.id}
              onClick={() => onOpenOrStartChat(task)}
              className="inline-flex items-center gap-1 rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-[10px] font-extrabold shadow-xs hover:opacity-90 transition cursor-pointer disabled:opacity-50"
            >
              {startingChatTaskId === task.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <MessageSquare className="h-3 w-3" />
              )}
              {task.chatConversationId ? "Abrir Atendimento" : "Iniciar Atendimento"}
            </button>
          )}
        </div>
      </div>

      {/* Gaveta Inline: Sussurro / Cobrança da Diretoria */}
      <AnimatePresence>
        {isWhisperOpen && task.chatConversationId && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <Lock className="h-3 w-3" />
                  Orientação Interna para {task.operatorName} (Invisível ao cliente)
                </span>
                <button
                  type="button"
                  onClick={() => onToggleWhisper(task)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {TASK_SUPERVISOR_WHISPER_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={sendingWhisper}
                    onClick={() => onSendWhisper(task, preset.buildText(task))}
                    className="rounded-lg border border-primary/25 bg-card hover:bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary transition cursor-pointer disabled:opacity-50"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={whisperText}
                  onChange={(e) => onChangeWhisperText(e.target.value)}
                  placeholder="Escreva uma cobrança ou orientação interna sobre esta tarefa..."
                  className="h-8 flex-1 rounded-xl bg-card border border-border px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  disabled={sendingWhisper || !whisperText.trim()}
                  onClick={() => onSendWhisper(task)}
                  className="inline-flex items-center gap-1 rounded-xl bg-primary text-primary-foreground px-3 h-8 text-[11px] font-bold hover:opacity-90 transition cursor-pointer disabled:opacity-50"
                >
                  {sendingWhisper ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Enviar
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gaveta Inline: Espiar Conversa Completa */}
      <AnimatePresence>
        {isPeekOpen && task.chatConversationId && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-2xl border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <Eye className="h-3 w-3 text-primary" />
                  Histórico Recente do Atendimento
                </span>
                {loadingPeekId === task.chatConversationId && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Carregando histórico...
                  </span>
                )}
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                {peekMessagesToRender.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-4">
                    Nenhuma mensagem registrada nesta conversa.
                  </p>
                ) : (
                  peekMessagesToRender.map((msg, idx) => {
                    const prev = idx > 0 ? peekMessagesToRender[idx - 1] : null;
                    const showSep = !prev || getMessageDateKey(prev.sentAt) !== getMessageDateKey(msg.sentAt);
                    return (
                      <React.Fragment key={msg.id}>
                        {showSep && (
                          <div className="flex justify-center my-1.5">
                            <span className="rounded-full bg-card border border-border px-2.5 py-0.5 text-[9px] font-bold text-muted-foreground">
                              {formatMessageDateSeparator(msg.sentAt)}
                            </span>
                          </div>
                        )}
                        <LiveMessageBubble msg={msg} />
                      </React.Fragment>
                    );
                  })
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function GlobalTasksTab({
  demoMode,
  refreshTick,
  onOverdueCountChange,
}: {
  demoMode?: boolean;
  refreshTick?: number;
  onOverdueCountChange?: (count: number) => void;
}) {
  const { tenant, setSelectedChatId, setActiveView } = useChat();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<GlobalTaskItem[]>([]);
  const [summary, setSummary] = useState<GlobalTasksExecutiveSummary | null>(null);
  const [operatorBreakdown, setOperatorBreakdown] = useState<GlobalTaskOperatorBreakdown[]>([]);
  const [pipelines, setPipelines] = useState<Array<{ id: string; name: string }>>([]);
  const [operatorsCatalog, setOperatorsCatalog] = useState<Array<{ id: string; name: string; email: string | null; avatar: string | null; isOnline: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modos de Visão & Filtros Globais
  const [viewMode, setViewMode] = useState<GlobalTaskViewMode>("queue");
  const [queueSubTab, setQueueSubTab] = useState<GlobalTaskQueueSubTab>("overdue");
  const [sortBy, setSortBy] = useState<GlobalTaskSortBy>("value_desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("all");
  const [pipelineFilter, setPipelineFilter] = useState("all");
  const [dealStatusFilter, setDealStatusFilter] = useState<"all" | "open" | "won" | "lost">("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showOperatorMatrix, setShowOperatorMatrix] = useState(true);

  // Estados do Modal "Lista Completa"
  const [isAllTasksModalOpen, setIsAllTasksModalOpen] = useState(false);
  const [modalStatusFilter, setModalStatusFilter] = useState<"all" | "open" | "completed">("all");
  const [modalDateFilter, setModalDateFilter] = useState("");

  // Navegação Temporal (Mês / Semana / Dia)
  const today = useMemo(() => new Date(), []);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date>(today);

  const days = useMemo(() => getDaysInMonth(currentYear, currentMonth), [currentYear, currentMonth]);
  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);

  // Modais de Criação / Edição / Conclusão
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingTaskData, setEditingTaskData] = useState<EditingTaskData | null>(null);
  const [taskToComplete, setTaskToComplete] = useState<GlobalTaskItem | null>(null);
  const [completionNote, setCompletionNote] = useState("");
  const [scheduleNextFollowUp, setScheduleNextFollowUp] = useState(false);
  const [nextFollowUpDate, setNextFollowUpDate] = useState<string>(() => buildQuickReschedulePresetIso("tomorrow_9h"));
  const [isConfirmingComplete, setIsConfirmingComplete] = useState(false);

  // Interações de Supervisão Inline
  const [peekConvId, setPeekConvId] = useState<string | null>(null);
  const [peekMessages, setPeekMessages] = useState<LiveMessage[]>([]);
  const [loadingPeekId, setLoadingPeekId] = useState<string | null>(null);
  const [whisperTaskId, setWhisperTaskId] = useState<string | null>(null);
  const [whisperText, setWhisperText] = useState("");
  const [sendingWhisper, setSendingWhisper] = useState(false);
  const [startingChatTaskId, setStartingChatTaskId] = useState<string | null>(null);
  const [reschedulingTaskId, setReschedulingTaskId] = useState<string | null>(null);
  const [bulkRescheduling, setBulkRescheduling] = useState(false);

  // ─── Carregar Tarefas Globais ──────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (demoMode) {
      setTasks(MOCK_GLOBAL_TASKS_RESPONSE.tasks);
      setSummary(MOCK_GLOBAL_TASKS_RESPONSE.summary);
      setOperatorBreakdown(MOCK_GLOBAL_TASKS_RESPONSE.operatorBreakdown);
      setPipelines(MOCK_GLOBAL_TASKS_RESPONSE.pipelines);
      setOperatorsCatalog(MOCK_GLOBAL_TASKS_RESPONSE.operators);
      onOverdueCountChange?.(MOCK_GLOBAL_TASKS_RESPONSE.summary.overdueTasksCount);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/gestao/tasks?tenantId=${tenant}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Não foi possível carregar as tarefas globais.");
        setTasks([]);
      } else {
        const fetchedTasks: GlobalTaskItem[] = Array.isArray(data.tasks) ? data.tasks : [];
        setTasks(fetchedTasks);
        setSummary(data.summary ?? null);
        setOperatorBreakdown(Array.isArray(data.operatorBreakdown) ? data.operatorBreakdown : []);
        setPipelines(Array.isArray(data.pipelines) ? data.pipelines : []);
        setOperatorsCatalog(Array.isArray(data.operators) ? data.operators : []);
        const overdueCnt =
          data.summary?.overdueTasksCount ??
          fetchedTasks.filter((t) => t.status !== "done" && t.status !== "completed" && t.dueDate && new Date(t.dueDate) < new Date()).length;
        onOverdueCountChange?.(overdueCnt);
      }
    } catch (e: any) {
      setError(e.message || "Erro ao carregar tarefas globais.");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [tenant, demoMode, onOverdueCountChange]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks, refreshTick]);

  // ─── Conclusão de Tarefa com Observação e Próximo Follow-up ─────────────
  const toggleTaskStatus = (task: GlobalTaskItem) => {
    if (task.status === "done" || task.status === "completed") {
      toast.info("Esta tarefa já foi concluída.");
      return;
    }
    setCompletionNote("");
    setScheduleNextFollowUp(false);
    setNextFollowUpDate(buildQuickReschedulePresetIso("tomorrow_9h"));
    setTaskToComplete(task);
  };

  const confirmCompleteGlobalTask = async () => {
    if (!taskToComplete) return;
    setIsConfirmingComplete(true);
    const target = taskToComplete;
    try {
      const updatedDescription = completionNote.trim()
        ? `${target.description ? `${target.description}\n\n` : ""}[Concluída pela Supervisão: ${completionNote.trim()}]`
        : target.description;

      if (!demoMode) {
        const response = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant,
            taskId: target.id,
            status: "done",
            description: updatedDescription,
          }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "Não foi possível concluir a tarefa.");
        }

        if (scheduleNextFollowUp && nextFollowUpDate) {
          await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenantId: tenant,
              title: `Follow-up: ${target.name}`,
              type: target.type || "whatsapp",
              dueAt: nextFollowUpDate,
              dealId: target.deal?.id || null,
              contactId: target.chatContactId || null,
              conversationId: target.chatConversationId || null,
              assignedOperatorIds:
                target.assignedOperatorIds?.length > 0
                  ? target.assignedOperatorIds
                  : target.operatorId
                    ? [target.operatorId]
                    : [],
              notes: `Continuidade agendada após conclusão de "${target.name}".`,
            }),
          });
        }
      }

      toast.success(
        scheduleNextFollowUp
          ? "Tarefa concluída e próximo follow-up agendado!"
          : "Tarefa concluída com sucesso!"
      );
      setTaskToComplete(null);
      await fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível atualizar a tarefa.");
    } finally {
      setIsConfirmingComplete(false);
    }
  };

  // ─── Reagendamento Rápido (1 Clique) ────────────────────────────────────
  const handleRescheduleTask = async (task: GlobalTaskItem, newIso: string) => {
    setReschedulingTaskId(task.id);
    try {
      if (!demoMode) {
        const res = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant,
            taskId: task.id,
            dueAt: newIso,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Erro ao reagendar tarefa.");
        }
      } else {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, dueDate: newIso } : t)));
      }
      toast.success("Prazo da tarefa atualizado!");
      if (!demoMode) await fetchTasks();
    } catch (err: any) {
      toast.error(err.message || "Não foi possível reagendar.");
    } finally {
      setReschedulingTaskId(null);
    }
  };

  // ─── Reagendamento em Lote (Bulk Reschedule) ────────────────────────────
  const handleBulkReschedule = async (targetTasks: GlobalTaskItem[], preset: "today_16h" | "tomorrow_9h" | "next_mon_9h") => {
    if (targetTasks.length === 0) return;
    setBulkRescheduling(true);
    const newIso = buildQuickReschedulePresetIso(preset);
    try {
      if (!demoMode) {
        const res = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant,
            action: "bulk_reschedule",
            taskIds: targetTasks.map((t) => t.id),
            dueAt: newIso,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Falha ao reagendar lote.");
        }
      } else {
        const idSet = new Set(targetTasks.map((t) => t.id));
        setTasks((prev) => prev.map((t) => (idSet.has(t.id) ? { ...t, dueDate: newIso } : t)));
      }
      toast.success(`${targetTasks.length} tarefa(s) reagendada(s) com sucesso!`);
      if (!demoMode) await fetchTasks();
    } catch (err: any) {
      toast.error(err.message || "Falha ao reagendar tarefas em lote.");
    } finally {
      setBulkRescheduling(false);
    }
  };

  // ─── Cancelar / Excluir / Editar Tarefa ─────────────────────────────────
  const handleCancelTask = async (task: GlobalTaskItem) => {
    try {
      if (!demoMode) {
        const res = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant,
            taskId: task.id,
            action: "cancel",
          }),
        });
        if (!res.ok) throw new Error("Não foi possível cancelar a tarefa.");
      } else {
        setTasks((prev) => prev.filter((t) => t.id !== task.id));
      }
      toast.success("Tarefa cancelada.");
      if (!demoMode) await fetchTasks();
    } catch (err: any) {
      toast.error(err.message || "Erro ao cancelar tarefa.");
    }
  };

  const handleDeleteTask = async (task: GlobalTaskItem) => {
    try {
      if (!demoMode) {
        const res = await fetch(`/api/tasks?id=${encodeURIComponent(task.id)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Não foi possível excluir a tarefa.");
      } else {
        setTasks((prev) => prev.filter((t) => t.id !== task.id));
      }
      toast.success("Tarefa excluída permanentemente.");
      if (!demoMode) await fetchTasks();
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir tarefa.");
    }
  };

  const handleEditTask = (task: GlobalTaskItem) => {
    setEditingTaskData({
      id: task.id,
      name: task.name,
      title: task.name,
      type: task.type || "task",
      dueDate: task.dueDate,
      description: task.description,
      dealId: task.deal?.id || null,
      dealTitle: task.deal?.name || null,
      dealName: task.deal?.name || null,
      accountName: task.client?.companyName || task.client?.name || null,
      contactId: task.chatContactId || null,
      contactName: task.client?.name || null,
      conversationId: task.chatConversationId || null,
      assignedOperatorId: task.operatorId || null,
      assignedOperatorIds:
        task.assignedOperatorIds?.length > 0
          ? task.assignedOperatorIds
          : task.operatorId
            ? [task.operatorId]
            : [],
    });
    setIsCreateModalOpen(true);
  };

  // ─── Espiar Conversa Inline ─────────────────────────────────────────────
  const handleTogglePeek = async (task: GlobalTaskItem) => {
    if (!task.chatConversationId) return;
    if (peekConvId === task.chatConversationId) {
      setPeekConvId(null);
      setPeekMessages([]);
      return;
    }
    setPeekConvId(task.chatConversationId);
    setPeekMessages((task.recentMessages || []) as LiveMessage[]);
    if (demoMode) return;
    setLoadingPeekId(task.chatConversationId);
    try {
      const res = await fetch(`/api/gestao/messages?conversationId=${encodeURIComponent(task.chatConversationId)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.messages)) {
          setPeekMessages(data.messages);
        }
      }
    } catch {
      // Fallback silencioso para recentMessages
    } finally {
      setLoadingPeekId(null);
    }
  };

  // ─── Enviar Sussurro / Cobrança ao Consultor ────────────────────────────
  const handleToggleWhisper = (task: GlobalTaskItem) => {
    if (whisperTaskId === task.id) {
      setWhisperTaskId(null);
      setWhisperText("");
    } else {
      setWhisperTaskId(task.id);
      setWhisperText("");
    }
  };

  const handleSendWhisper = async (task: GlobalTaskItem, textOverride?: string) => {
    if (!task.chatConversationId) return;
    const content = (textOverride ?? whisperText).trim();
    if (!content) return;
    setSendingWhisper(true);
    try {
      if (!demoMode) {
        const res = await fetch("/api/gestao/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: task.chatConversationId,
            content,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Não foi possível enviar a orientação.");
        }
      }
      toast.success(`Orientação interna enviada para ${task.operatorName}!`);
      setWhisperText("");
      setWhisperTaskId(null);
    } catch (err: any) {
      toast.error(err.message || "Falha ao enviar orientação.");
    } finally {
      setSendingWhisper(false);
    }
  };

  // ─── Abrir ou Iniciar Atendimento WhatsApp ──────────────────────────────
  const handleOpenOrStartChat = async (task: GlobalTaskItem) => {
    if (task.chatConversationId) {
      setSelectedChatId(task.chatConversationId);
      setActiveView("chat");
      return;
    }
    if (!task.chatContactId) return;
    setStartingChatTaskId(task.id);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(task.chatContactId)}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "whatsapp" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.conversation?.id) {
        throw new Error(data.error || "Não foi possível iniciar o atendimento.");
      }
      setSelectedChatId(data.conversation.id);
      setActiveView("chat");
    } catch (err: any) {
      toast.error(err.message || "Erro ao iniciar conversa.");
    } finally {
      setStartingChatTaskId(null);
    }
  };

  const handleNavigateDeal = (dealId: string) => {
    navigate({ to: "/crm/deals/$dealId", params: { dealId } });
  };

  // ─── Navegação de Calendário (Mês / Semana / Dia) ───────────────────────
  const prevPeriod = () => {
    if (viewMode === "month") {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear((y) => y - 1);
      } else {
        setCurrentMonth((m) => m - 1);
      }
    } else if (viewMode === "week") {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - 7);
      setSelectedDate(d);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
    } else {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - 1);
      setSelectedDate(d);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
    }
  };

  const nextPeriod = () => {
    if (viewMode === "month") {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear((y) => y + 1);
      } else {
        setCurrentMonth((m) => m + 1);
      }
    } else if (viewMode === "week") {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 7);
      setSelectedDate(d);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
    } else {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 1);
      setSelectedDate(d);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
    }
  };

  const goToday = () => {
    const now = new Date();
    setCurrentMonth(now.getMonth());
    setCurrentYear(now.getFullYear());
    setSelectedDate(now);
  };

  // ─── Lista Unificada de Consultores (por operatorId) ────────────────────
  const uniqueOperatorsList = useMemo(() => {
    if (operatorsCatalog.length > 0) {
      return operatorsCatalog;
    }
    const map = new Map<string, { id: string; name: string; email: string | null; avatar: string | null; isOnline: boolean }>();
    for (const t of tasks) {
      const ops = t.assignedOperators?.length
        ? t.assignedOperators
        : [{ id: t.operatorId || "unassigned", name: t.operatorName, email: t.operatorEmail, avatar: t.operatorAvatar }];
      for (const op of ops) {
        if (!map.has(op.id)) {
          map.set(op.id, {
            id: op.id,
            name: op.name,
            email: op.email,
            avatar: op.avatar,
            isOnline: Boolean(t.operatorIsOnline),
          });
        }
      }
    }
    return Array.from(map.values());
  }, [operatorsCatalog, tasks]);

  const taskModalOperators = useMemo(
    () => uniqueOperatorsList.map((op) => ({ id: op.id, name: op.name })),
    [uniqueOperatorsList],
  );

  // ─── Filtragem Global Base (respeitada por TODAS as visões e calendário) ─
  const filteredBaseTasks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return tasks.filter((t) => {
      if (!taskMatchesOperatorFilter(t, operatorFilter)) return false;
      if (pipelineFilter !== "all") {
        if (pipelineFilter === "__with_deal__" && !t.deal) return false;
        if (pipelineFilter === "__without_deal__" && t.deal) return false;
        if (pipelineFilter !== "__with_deal__" && pipelineFilter !== "__without_deal__" && t.deal?.pipelineId !== pipelineFilter) {
          return false;
        }
      }
      if (dealStatusFilter !== "all") {
        if (!t.deal) return false;
        if ((t.deal.status || "open").toLowerCase() !== dealStatusFilter) return false;
      }
      if (typeFilter !== "all" && (t.type || "task").toLowerCase() !== typeFilter) return false;
      if (q) {
        const matchTitle = (t.name || "").toLowerCase().includes(q);
        const matchDesc = t.description?.toLowerCase().includes(q) || false;
        const matchClient = t.client?.name?.toLowerCase().includes(q) || false;
        const matchCompany = t.client?.companyName?.toLowerCase().includes(q) || false;
        const matchPhone = t.client?.phone?.toLowerCase().includes(q) || false;
        const matchDeal = t.deal?.name?.toLowerCase().includes(q) || false;
        const matchOp = (t.operatorName || "").toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchClient && !matchCompany && !matchPhone && !matchDeal && !matchOp) {
          return false;
        }
      }
      return true;
    });
  }, [tasks, operatorFilter, pipelineFilter, dealStatusFilter, typeFilter, searchQuery]);

  // ─── Tarefas da Visão "Fila & Risco" + Ordenação ────────────────────────
  const queueTasks = useMemo(() => {
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const subFiltered = filteredBaseTasks.filter((t) => {
      const isDone = t.status === "done" || t.status === "completed";
      const due = t.dueDate ? new Date(t.dueDate) : null;
      const isOverdue = !isDone && Boolean(due && due < now);
      const isTodayTask = Boolean(due && isSameDay(due, now));

      if (queueSubTab === "overdue") return isOverdue;
      if (queueSubTab === "today") return !isDone && isTodayTask;
      if (queueSubTab === "upcoming7d") return !isDone && Boolean(due && due >= now && due <= in7d);
      if (queueSubTab === "open_deals") return !isDone && Boolean(t.deal && (t.deal.status || "open") === "open");
      if (queueSubTab === "completed") return isDone;
      return true;
    });

    return [...subFiltered].sort((a, b) => {
      if (sortBy === "value_desc") {
        const valDiff = Number(b.deal?.numericValue || 0) - Number(a.deal?.numericValue || 0);
        if (valDiff !== 0) return valDiff;
      }
      if (sortBy === "overdue_desc") {
        const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        return aDue - bDue;
      }
      if (sortBy === "operator_asc") {
        return a.operatorName.localeCompare(b.operatorName, "pt-BR");
      }
      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });
  }, [filteredBaseTasks, queueSubTab, sortBy]);

  const getTasksForDate = useCallback(
    (date: Date) =>
      filteredBaseTasks.filter((t) => {
        if (!t.dueDate) return false;
        return isSameDay(new Date(t.dueDate), date);
      }),
    [filteredBaseTasks]
  );

  const selectedDateTasks = useMemo(() => getTasksForDate(selectedDate), [getTasksForDate, selectedDate]);

  const overdueCount = summary?.overdueTasksCount ?? filteredBaseTasks.filter((t) => t.status !== "done" && t.status !== "completed" && t.dueDate && new Date(t.dueDate) < new Date()).length;

  return (
    <div className="flex flex-col flex-1 overflow-y-auto pr-1 space-y-4 scrollbar-thin">
      {/* 1. COCKPIT EXECUTIVO DE DISCIPLINA COMERCIAL (4 KPIs) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 shrink-0">
        {/* Card 1: Atrasadas & Risco no Pipeline */}
        <motion.button
          type="button"
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => {
            setViewMode("queue");
            setQueueSubTab("overdue");
            setSortBy("value_desc");
          }}
          className={`text-left rounded-2xl border p-3.5 transition-all cursor-pointer ${
            viewMode === "queue" && queueSubTab === "overdue"
              ? "border-primary bg-primary/10 shadow-sm"
              : "border-border bg-card hover:border-primary/40"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Atrasadas & Risco Pipeline
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <AlertTriangle className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-xl font-black text-foreground">{overdueCount}</span>
            <span className="text-xs font-extrabold text-primary">
              {formatBrlCompact(summary?.overduePipelineValueAtRisk || 0)} em risco
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{summary?.overdueOpenDealsTasksCount ?? 0} em negócios abertos</span>
            <span>Média: {summary?.avgOverdueHours ?? 0}h atraso</span>
          </div>
        </motion.button>

        {/* Card 2: Execução da Agenda de Hoje */}
        <motion.button
          type="button"
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => {
            goToday();
            setViewMode("day");
          }}
          className={`text-left rounded-2xl border p-3.5 transition-all cursor-pointer ${
            viewMode === "day" && isSameDay(selectedDate, today)
              ? "border-primary bg-primary/10 shadow-sm"
              : "border-border bg-card hover:border-primary/40"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Execução da Agenda de Hoje
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-xl font-black text-foreground">
              {summary?.todayCompletedCount ?? 0}/{summary?.todayTotalCount ?? 0}
            </span>
            <span className="text-xs font-extrabold text-primary">
              {summary?.todayExecutionRatePct ?? 0}% concluído
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${Math.min(100, summary?.todayExecutionRatePct ?? 0)}%` }}
            />
          </div>
        </motion.button>

        {/* Card 3: Saúde de Agendamento da Carteira */}
        <motion.button
          type="button"
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => {
            setViewMode("queue");
            setQueueSubTab("upcoming7d");
          }}
          className={`text-left rounded-2xl border p-3.5 transition-all cursor-pointer ${
            viewMode === "queue" && queueSubTab === "upcoming7d"
              ? "border-primary bg-primary/10 shadow-sm"
              : "border-border bg-card hover:border-primary/40"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Cobertura de Follow-up
            </span>
            <div className="h-7 w-7 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <Target className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-xl font-black text-foreground">
              {summary?.openDealsWithoutTasksCount ?? 0}
            </span>
            <span className="text-[11px] font-bold text-primary">
              deals abertos s/ tarefa
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{summary?.consultantsWithoutFutureTasksCount ?? 0} consultor(es) s/ agenda</span>
            <span>Próx. 7d: {summary?.upcoming7dCount ?? 0}</span>
          </div>
        </motion.button>

        {/* Card 4: Mix de Atividades da Operação */}
        <div className="rounded-2xl border border-border bg-card p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Mix de Atividades Pendentes
            </span>
            {typeFilter !== "all" && (
              <button
                type="button"
                onClick={() => setTypeFilter("all")}
                className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
              >
                Limpar tipo
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {(["call", "whatsapp", "meeting", "visit", "email", "lunch", "task"] as const).map((tKey) => {
              const count = summary?.byType?.[tKey] ?? 0;
              const isSelected = typeFilter === tKey;
              return (
                <button
                  key={tKey}
                  type="button"
                  onClick={() => setTypeFilter(isSelected ? "all" : tKey)}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold border transition cursor-pointer ${
                    isSelected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/50 text-foreground border-border hover:border-primary/30"
                  }`}
                >
                  {getTaskTypeIcon(tKey, "h-2.5 w-2.5")}
                  <span>{GLOBAL_TASK_TYPE_META[tKey]?.shortLabel}</span>
                  <span className="opacity-80">({count})</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. MATRIZ EXECUTIVA DE DISCIPLINA POR CONSULTOR */}
      {operatorBreakdown.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-3.5 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h3 className="text-xs font-extrabold text-foreground">
                Disciplina & Cobertura de Agenda por Consultor
              </h3>
              {operatorFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => setOperatorFilter("all")}
                  className="rounded-lg bg-primary/10 text-primary border border-primary/25 px-2 py-0.5 text-[10px] font-bold cursor-pointer"
                >
                  Filtro ativo · Mostrar todos
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowOperatorMatrix((v) => !v)}
              className="text-[11px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {showOperatorMatrix ? "Recolher matriz" : "Expandir matriz"}
            </button>
          </div>

          {showOperatorMatrix && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {operatorBreakdown.map((op) => {
                const isSelected = operatorFilter === op.operatorId;
                const initials = op.operatorName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
                return (
                  <button
                    key={op.operatorId}
                    type="button"
                    onClick={() => setOperatorFilter(isSelected ? "all" : op.operatorId)}
                    className={`text-left rounded-xl border p-2.5 transition-all cursor-pointer ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-xs"
                        : "border-border bg-muted/20 hover:bg-muted/40 hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="relative h-7 w-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-extrabold shrink-0 overflow-hidden">
                          {op.operatorAvatar ? (
                            <img src={op.operatorAvatar} alt={op.operatorName} className="h-full w-full object-cover" />
                          ) : (
                            <span>{initials}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full shrink-0 ${op.isOnline ? "bg-primary" : "bg-muted-foreground/40"}`} />
                            <p className="text-xs font-extrabold text-foreground truncate">{op.operatorName}</p>
                          </div>
                          <p className="text-[9px] text-muted-foreground truncate">
                            Hoje: {op.todayDone}/{op.todayTotal} ({op.executionRatePct}%)
                          </p>
                        </div>
                      </div>

                      {op.overdueCount > 0 ? (
                        <span className="shrink-0 rounded-lg bg-primary text-primary-foreground px-2 py-0.5 text-[10px] font-extrabold">
                          {op.overdueCount} atrasada{op.overdueCount > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-lg bg-muted text-muted-foreground px-2 py-0.5 text-[9px] font-bold">
                          Em dia
                        </span>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-1 text-[9px] text-muted-foreground border-t border-border/50 pt-1.5">
                      <div>
                        <span className="block text-[8px] uppercase">Risco R$</span>
                        <span className="font-extrabold text-foreground">{formatBrlCompact(op.overdueValueAtRisk)}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] uppercase">Próx. 7d</span>
                        <span className={`font-extrabold ${op.upcoming7dCount === 0 ? "text-primary" : "text-foreground"}`}>
                          {op.upcoming7dCount === 0 ? "Sem agenda" : `${op.upcoming7dCount} ativ.`}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[8px] uppercase">Deals s/ Task</span>
                        <span className="font-extrabold text-foreground">
                          {op.openDealsWithoutTaskCount}/{op.openDealsCount}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. BARRA DE CONTROLES UNIFICADA (4 VISÕES + FILTROS + DELEGAR TAREFA) */}
      <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shrink-0">
        {/* Seletor de Modo de Visão */}
        <div className="flex items-center gap-1 bg-muted p-1 rounded-xl shrink-0 overflow-x-auto">
          {([
            { id: "queue" as const, label: "Fila & Risco", icon: ListTodo },
            { id: "month" as const, label: "Mês", icon: Calendar },
            { id: "week" as const, label: "Semana", icon: Columns3 },
            { id: "day" as const, label: "Dia / Turnos", icon: Clock },
          ]).map((mode) => {
            const Icon = mode.icon;
            const active = viewMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setViewMode(mode.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer whitespace-nowrap ${
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* Filtros Globais */}
        <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
          {/* Busca Rápida */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar tarefa, cliente, negócio..."
              className="h-9 w-full rounded-xl bg-muted/60 border border-border pl-8 pr-7 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Consultor */}
          <Select value={operatorFilter} onValueChange={setOperatorFilter}>
            <SelectTrigger className="h-9 w-[160px] rounded-xl bg-card border border-border px-3 text-xs text-foreground">
              <SelectValue placeholder="Todos Consultores" />
            </SelectTrigger>
            <SelectContent className="bg-card border-line rounded-xl text-xs shadow-soft z-50">
              <SelectItem value="all" className="cursor-pointer text-xs">Todos Consultores</SelectItem>
              {uniqueOperatorsList.map((op) => (
                <SelectItem key={op.id} value={op.id} className="cursor-pointer text-xs">
                  {op.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Funil CRM */}
          <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
            <SelectTrigger className="h-9 w-[150px] rounded-xl bg-card border border-border px-3 text-xs text-foreground">
              <SelectValue placeholder="Todos os Funis" />
            </SelectTrigger>
            <SelectContent className="bg-card border-line rounded-xl text-xs shadow-soft z-50">
              <SelectItem value="all" className="cursor-pointer text-xs">Todos os Funis</SelectItem>
              <SelectItem value="__with_deal__" className="cursor-pointer text-xs">Com Oportunidade</SelectItem>
              <SelectItem value="__without_deal__" className="cursor-pointer text-xs">Sem Oportunidade</SelectItem>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id} className="cursor-pointer text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status do Negócio */}
          <Select value={dealStatusFilter} onValueChange={(v) => setDealStatusFilter(v as any)}>
            <SelectTrigger className="h-9 w-[140px] rounded-xl bg-card border border-border px-3 text-xs text-foreground">
              <SelectValue placeholder="Status Deal" />
            </SelectTrigger>
            <SelectContent className="bg-card border-line rounded-xl text-xs shadow-soft z-50">
              <SelectItem value="all" className="cursor-pointer text-xs">Todos Negócios</SelectItem>
              <SelectItem value="open" className="cursor-pointer text-xs">Deals em Aberto</SelectItem>
              <SelectItem value="won" className="cursor-pointer text-xs">Deals Ganhos</SelectItem>
              <SelectItem value="lost" className="cursor-pointer text-xs">Deals Perdidos</SelectItem>
            </SelectContent>
          </Select>

          <button
            type="button"
            onClick={() => setIsAllTasksModalOpen(true)}
            className="h-9 rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted/50 flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Filter className="h-3.5 w-3.5" />
            Lista Completa
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingTaskData(null);
              setIsCreateModalOpen(true);
            }}
            className="h-9 rounded-xl bg-primary text-primary-foreground px-3.5 text-xs font-extrabold flex items-center gap-1.5 shadow-xs hover:opacity-90 transition cursor-pointer shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Nova / Delegar
          </button>

          <SystemTooltip content="Atualizar tarefas globais">
            <button
              type="button"
              onClick={fetchTasks}
              disabled={loading}
              className="h-9 w-9 rounded-xl border border-border bg-card hover:bg-muted text-foreground flex items-center justify-center transition cursor-pointer shrink-0 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </SystemTooltip>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-3 text-xs text-primary shrink-0">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 4A. VISÃO: FILA & RISCO (TRIAGEM EXECUTIVA) */}
      {viewMode === "queue" && (
        <div className="flex flex-col space-y-3">
          {/* Sub-abas da Fila + Ordenação + Ações em Lote */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {([
                { id: "overdue" as const, label: "Atrasadas Críticas" },
                { id: "today" as const, label: "Vencem Hoje" },
                { id: "upcoming7d" as const, label: "Próximos 7 Dias" },
                { id: "open_deals" as const, label: "Negócios Abertos" },
                { id: "completed" as const, label: "Concluídas" },
                { id: "all" as const, label: "Todas" },
              ]).map((sub) => {
                const active = queueSubTab === sub.id;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setQueueSubTab(sub.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      active
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-muted/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {sub.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {queueSubTab === "overdue" && queueTasks.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={bulkRescheduling}
                      className="h-8 rounded-xl bg-primary/15 text-primary border border-primary/30 px-3 text-[11px] font-extrabold flex items-center gap-1.5 hover:bg-primary/20 transition cursor-pointer disabled:opacity-50"
                    >
                      {bulkRescheduling ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarClock className="h-3 w-3" />}
                      Reagendar {queueTasks.length} em lote
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-60 p-2.5 rounded-2xl bg-card border border-border shadow-card space-y-1.5 z-50">
                    <p className="text-[10px] font-extrabold text-muted-foreground px-1">
                      Reagendar {queueTasks.length} tarefas listadas para:
                    </p>
                    {[
                      { id: "today_16h" as const, label: "Hoje às 16:00" },
                      { id: "tomorrow_9h" as const, label: "Amanhã às 09:00" },
                      { id: "next_mon_9h" as const, label: "Próxima Segunda às 09:00" },
                    ].map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleBulkReschedule(queueTasks, preset.id)}
                        className="w-full text-left rounded-xl px-2.5 py-1.5 text-xs font-bold text-foreground hover:bg-primary/10 hover:text-primary transition cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}

              <Select value={sortBy} onValueChange={(v) => setSortBy(v as GlobalTaskSortBy)}>
                <SelectTrigger className="h-8 w-[195px] rounded-xl bg-muted/50 border border-border px-2.5 text-[11px] font-bold text-foreground">
                  <SelectValue placeholder="Ordenar por" />
                </SelectTrigger>
                <SelectContent className="bg-card border-line rounded-xl text-xs shadow-soft z-50">
                  <SelectItem value="value_desc" className="cursor-pointer text-xs">Maior Valor R$ em Risco</SelectItem>
                  <SelectItem value="overdue_desc" className="cursor-pointer text-xs">Maior Tempo de Atraso</SelectItem>
                  <SelectItem value="due_asc" className="cursor-pointer text-xs">Prazo Mais Próximo</SelectItem>
                  <SelectItem value="operator_asc" className="cursor-pointer text-xs">Consultor (A-Z)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {queueTasks.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card py-14 px-4 flex flex-col items-center justify-center text-center">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                <ClipboardCheck className="h-6 w-6" />
              </div>
              <p className="text-sm font-extrabold text-foreground">
                Nenhuma tarefa nesta visão
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                Não há atividades correspondentes aos filtros atuais. Você pode alternar a sub-aba ou delegar uma nova tarefa para a equipe.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {queueTasks.map((task) => (
                <GlobalTaskCard360
                  key={task.id}
                  task={task}
                  peekConvId={peekConvId}
                  peekMessages={peekMessages}
                  loadingPeekId={loadingPeekId}
                  whisperTaskId={whisperTaskId}
                  whisperText={whisperText}
                  sendingWhisper={sendingWhisper}
                  startingChatTaskId={startingChatTaskId}
                  reschedulingTaskId={reschedulingTaskId}
                  onToggleComplete={toggleTaskStatus}
                  onEditTask={handleEditTask}
                  onRescheduleTask={handleRescheduleTask}
                  onCancelTask={handleCancelTask}
                  onDeleteTask={handleDeleteTask}
                  onTogglePeek={handleTogglePeek}
                  onToggleWhisper={handleToggleWhisper}
                  onChangeWhisperText={setWhisperText}
                  onSendWhisper={handleSendWhisper}
                  onOpenOrStartChat={handleOpenOrStartChat}
                  onNavigateDeal={handleNavigateDeal}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4B. VISÃO: MÊS (CALENDÁRIO ENRIQUECIDO + PAINEL LATERAL 360º) */}
      {viewMode === "month" && (
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 rounded-2xl border border-border bg-card p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={prevPeriod}
                  className="rounded-xl p-1.5 hover:bg-muted transition-colors cursor-pointer border border-border bg-card"
                >
                  <ChevronLeft className="h-4 w-4 text-foreground" />
                </button>
                <h3 className="text-sm font-extrabold text-foreground min-w-[140px] text-center">
                  {MONTHS[currentMonth]} {currentYear}
                </h3>
                <button
                  type="button"
                  onClick={nextPeriod}
                  className="rounded-xl p-1.5 hover:bg-muted transition-colors cursor-pointer border border-border bg-card"
                >
                  <ChevronRight className="h-4 w-4 text-foreground" />
                </button>
              </div>
              <button
                type="button"
                onClick={goToday}
                className="rounded-xl border border-border bg-muted/40 hover:bg-muted px-3 py-1.5 text-xs font-bold text-foreground cursor-pointer"
              >
                Ir para Hoje
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1.5 mb-2 border-b border-border pb-2 bg-muted/20 rounded-xl px-2 py-1">
              {WEEKDAYS.map((day) => (
                <div key={day} className="text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5 flex-1 min-h-[420px]">
              {days.map((date, i) => {
                const isCurrentMonth = date.getMonth() === currentMonth;
                const isTodayDate = isSameDay(date, today);
                const isSelected = isSameDay(date, selectedDate);
                const dayTasks = getTasksForDate(date);
                const doneCount = dayTasks.filter((t) => t.status === "done" || t.status === "completed").length;
                const overdueDayCount = dayTasks.filter(
                  (t) => t.status !== "done" && t.status !== "completed" && t.dueDate && new Date(t.dueDate) < new Date()
                ).length;

                const uniqueOpsMap = new Map<string, { id: string; name: string; avatar: string | null }>();
                for (const t of dayTasks) {
                  const ops = t.assignedOperators?.length
                    ? t.assignedOperators
                    : [{ id: t.operatorId || t.operatorName, name: t.operatorName, email: t.operatorEmail, avatar: t.operatorAvatar }];
                  for (const op of ops) {
                    if (!uniqueOpsMap.has(op.id)) {
                      uniqueOpsMap.set(op.id, { id: op.id, name: op.name, avatar: op.avatar });
                    }
                  }
                }
                const uniqueOps = Array.from(uniqueOpsMap.values());

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedDate(date)}
                    className={`relative flex flex-col justify-between rounded-xl p-2 transition-all min-h-[78px] border w-full overflow-hidden cursor-pointer ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : isTodayDate
                          ? "bg-primary/10 text-foreground border-primary/40 border-2"
                          : "bg-card text-foreground border-border hover:border-primary/30"
                    } ${isCurrentMonth ? "opacity-100" : "opacity-45"}`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className={`text-[11px] font-extrabold ${isSelected ? "text-primary-foreground" : "text-foreground"}`}>
                        {date.getDate()}
                      </span>
                      {dayTasks.length > 0 && (
                        <span
                          className={`rounded-md px-1.5 py-0.2 text-[9px] font-extrabold ${
                            isSelected
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : overdueDayCount > 0
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground"
                          }`}
                        >
                          {dayTasks.length}
                        </span>
                      )}
                    </div>

                    {uniqueOps.length > 0 && (
                      <div className="flex flex-wrap items-center justify-center gap-0.5 my-1 w-full">
                        {uniqueOps.slice(0, 3).map((op, j) => {
                          const initials = op.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
                          return (
                            <SystemTooltip key={j} content={op.name}>
                              <div
                                className={`h-5 w-5 rounded-full border flex items-center justify-center text-[7px] font-extrabold shrink-0 overflow-hidden ${
                                  isSelected
                                    ? "bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30"
                                    : "bg-primary/15 text-primary border-card"
                                }`}
                              >
                                {op.avatar ? (
                                  <img src={op.avatar} alt={op.name} className="h-full w-full object-cover" />
                                ) : (
                                  <span>{initials}</span>
                                )}
                              </div>
                            </SystemTooltip>
                          );
                        })}
                        {uniqueOps.length > 3 && (
                          <span className={`text-[8px] font-bold ml-0.5 ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                            +{uniqueOps.length - 3}
                          </span>
                        )}
                      </div>
                    )}

                    {dayTasks.length > 0 && (
                      <div className="w-full h-1 rounded-full bg-muted/60 overflow-hidden mt-0.5">
                        <div
                          className={`h-full rounded-full ${isSelected ? "bg-primary-foreground" : "bg-primary"}`}
                          style={{ width: `${Math.round((doneCount / dayTasks.length) * 100)}%` }}
                        />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Painel Lateral do Dia Selecionado */}
          <div className="w-full lg:w-[430px] rounded-2xl border border-border bg-card p-4 flex flex-col max-h-[640px]">
            <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
              <div>
                <h4 className="text-xs font-extrabold text-foreground capitalize">
                  {selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                </h4>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {selectedDateTasks.length === 0
                    ? "Nenhuma atividade agendada"
                    : `${selectedDateTasks.length} atividade(s) neste dia`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewMode("day")}
                className="rounded-xl bg-primary/10 text-primary border border-primary/25 px-2.5 py-1 text-[10px] font-extrabold hover:bg-primary/15 cursor-pointer"
              >
                Abrir Turnos do Dia
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
              {selectedDateTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                  <Calendar className="h-10 w-10 text-muted-foreground/30 mb-2" />
                  <p className="text-xs font-semibold">Nenhuma tarefa para esta data</p>
                </div>
              ) : (
                selectedDateTasks.map((task) => (
                  <GlobalTaskCard360
                    key={task.id}
                    task={task}
                    compact
                    peekConvId={peekConvId}
                    peekMessages={peekMessages}
                    loadingPeekId={loadingPeekId}
                    whisperTaskId={whisperTaskId}
                    whisperText={whisperText}
                    sendingWhisper={sendingWhisper}
                    startingChatTaskId={startingChatTaskId}
                    reschedulingTaskId={reschedulingTaskId}
                    onToggleComplete={toggleTaskStatus}
                    onEditTask={handleEditTask}
                    onRescheduleTask={handleRescheduleTask}
                    onCancelTask={handleCancelTask}
                    onDeleteTask={handleDeleteTask}
                    onTogglePeek={handleTogglePeek}
                    onToggleWhisper={handleToggleWhisper}
                    onChangeWhisperText={setWhisperText}
                    onSendWhisper={handleSendWhisper}
                    onOpenOrStartChat={handleOpenOrStartChat}
                    onNavigateDeal={handleNavigateDeal}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4C. VISÃO: SEMANA (GRADE DE 7 COLUNAS DE CARGA SEMANAL) */}
      {viewMode === "week" && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={prevPeriod}
                className="rounded-xl p-1.5 hover:bg-muted border border-border bg-card cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4 text-foreground" />
              </button>
              <h3 className="text-sm font-extrabold text-foreground">
                Semana de {weekDays[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} a{" "}
                {weekDays[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
              </h3>
              <button
                type="button"
                onClick={nextPeriod}
                className="rounded-xl p-1.5 hover:bg-muted border border-border bg-card cursor-pointer"
              >
                <ChevronRight className="h-4 w-4 text-foreground" />
              </button>
            </div>
            <button
              type="button"
              onClick={goToday}
              className="rounded-xl border border-border bg-muted/40 hover:bg-muted px-3 py-1.5 text-xs font-bold text-foreground cursor-pointer"
            >
              Semana Atual
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-7 gap-2.5">
            {weekDays.map((d, idx) => {
              const dayTasks = getTasksForDate(d);
              const isTodayDate = isSameDay(d, today);
              return (
                <div
                  key={idx}
                  className={`rounded-2xl border p-2.5 flex flex-col min-h-[340px] ${
                    isTodayDate ? "border-primary bg-primary/5" : "border-border bg-muted/15"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDate(d);
                      setViewMode("day");
                    }}
                    className="flex items-center justify-between pb-2 mb-2 border-b border-border/60 text-left cursor-pointer"
                  >
                    <div>
                      <p className="text-[10px] font-extrabold uppercase text-muted-foreground">
                        {WEEKDAYS[d.getDay()]}
                      </p>
                      <p className="text-sm font-black text-foreground">
                        {d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                      </p>
                    </div>
                    <span className="rounded-lg bg-card border border-border px-2 py-0.5 text-[10px] font-extrabold text-foreground">
                      {dayTasks.length}
                    </span>
                  </button>

                  <div className="flex-1 space-y-2 overflow-y-auto max-h-[420px] pr-0.5 scrollbar-thin">
                    {dayTasks.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground text-center py-8">Livre</p>
                    ) : (
                      dayTasks.map((t) => {
                        const isDone = t.status === "done" || t.status === "completed";
                        const isOv = !isDone && t.dueDate && new Date(t.dueDate) < new Date();
                        return (
                          <div
                            key={t.id}
                            onClick={() => {
                              setSelectedDate(d);
                              setViewMode("day");
                            }}
                            className={`rounded-xl border p-2 text-left transition cursor-pointer ${
                              isOv
                                ? "border-primary/40 bg-primary/10"
                                : isDone
                                  ? "border-border/50 bg-card/60 opacity-75"
                                  : "border-border bg-card hover:border-primary/30"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="inline-flex items-center gap-1 text-[9px] font-extrabold text-primary uppercase">
                                {getTaskTypeIcon(t.type, "h-2.5 w-2.5")}
                                {formatTime(t.dueDate)}
                              </span>
                              <span className="text-[9px] font-bold text-muted-foreground truncate max-w-[70px]">
                                {t.operatorName.split(" ")[0]}
                              </span>
                            </div>
                            <p className={`text-[11px] font-bold mt-1 line-clamp-2 ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}>
                              {t.name}
                            </p>
                            {t.client.name && (
                              <p className="text-[9px] text-muted-foreground truncate mt-0.5">
                                {t.client.name}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4D. VISÃO: DIA / TURNOS (MANHÃ, TARDE, NOITE & CONCLUÍDAS) */}
      {viewMode === "day" && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={prevPeriod}
                className="rounded-xl p-1.5 hover:bg-muted border border-border bg-card cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4 text-foreground" />
              </button>
              <div>
                <h3 className="text-sm font-extrabold text-foreground capitalize">
                  {selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  {selectedDateTasks.length} atividade(s) programada(s) para o dia
                </p>
              </div>
              <button
                type="button"
                onClick={nextPeriod}
                className="rounded-xl p-1.5 hover:bg-muted border border-border bg-card cursor-pointer"
              >
                <ChevronRight className="h-4 w-4 text-foreground" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goToday}
                className="rounded-xl border border-border bg-muted/40 hover:bg-muted px-3 py-1.5 text-xs font-bold text-foreground cursor-pointer"
              >
                Hoje
              </button>
              {selectedDateTasks.some((t) => t.status !== "done" && t.status !== "completed") && (
                <button
                  type="button"
                  disabled={bulkRescheduling}
                  onClick={() =>
                    handleBulkReschedule(
                      selectedDateTasks.filter((t) => t.status !== "done" && t.status !== "completed"),
                      "tomorrow_9h"
                    )
                  }
                  className="rounded-xl bg-primary/15 text-primary border border-primary/30 px-3 py-1.5 text-xs font-extrabold hover:bg-primary/20 cursor-pointer disabled:opacity-50"
                >
                  Mover Pendentes p/ Amanhã 09h
                </button>
              )}
            </div>
          </div>

          {(() => {
            const pendingDay = selectedDateTasks.filter((t) => t.status !== "done" && t.status !== "completed");
            const doneDay = selectedDateTasks.filter((t) => t.status === "done" || t.status === "completed");
            const morning = pendingDay.filter((t) => !t.dueDate || new Date(t.dueDate).getHours() < 12);
            const afternoon = pendingDay.filter((t) => t.dueDate && new Date(t.dueDate).getHours() >= 12 && new Date(t.dueDate).getHours() < 18);
            const evening = pendingDay.filter((t) => t.dueDate && new Date(t.dueDate).getHours() >= 18);

            const shifts = [
              { id: "morning", label: "Turno da Manhã (até 12h)", items: morning },
              { id: "afternoon", label: "Turno da Tarde (12h às 18h)", items: afternoon },
              { id: "evening", label: "Turno da Noite (após 18h)", items: evening },
              { id: "done", label: "Concluídas no Dia", items: doneDay },
            ];

            return (
              <div className="space-y-4">
                {shifts.map((shift) => (
                  <div key={shift.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        {shift.label} ({shift.items.length})
                      </h4>
                    </div>
                    {shift.items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 py-4 text-center text-xs text-muted-foreground">
                        Sem atividades neste bloco
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {shift.items.map((task) => (
                          <GlobalTaskCard360
                            key={task.id}
                            task={task}
                            peekConvId={peekConvId}
                            peekMessages={peekMessages}
                            loadingPeekId={loadingPeekId}
                            whisperTaskId={whisperTaskId}
                            whisperText={whisperText}
                            sendingWhisper={sendingWhisper}
                            startingChatTaskId={startingChatTaskId}
                            reschedulingTaskId={reschedulingTaskId}
                            onToggleComplete={toggleTaskStatus}
                            onEditTask={handleEditTask}
                            onRescheduleTask={handleRescheduleTask}
                            onCancelTask={handleCancelTask}
                            onDeleteTask={handleDeleteTask}
                            onTogglePeek={handleTogglePeek}
                            onToggleWhisper={handleToggleWhisper}
                            onChangeWhisperText={setWhisperText}
                            onSendWhisper={handleSendWhisper}
                            onOpenOrStartChat={handleOpenOrStartChat}
                            onNavigateDeal={handleNavigateDeal}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* MODAL 1: LISTA COMPLETA DE TAREFAS (COM CRMDATEPICKER CUSTOMIZADO) */}
      <AnimatePresence>
        {isAllTasksModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 280 }}
              className="w-full max-w-4xl rounded-3xl bg-card border border-border shadow-card flex flex-col max-h-[90vh] overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-line px-6 py-4">
                <div>
                  <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                    Auditoria & Lista Completa de Tarefas Globais
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Consulte, filtre por data específica e execute ações diretas em qualquer atividade do tenant.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAllTasksModalOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              <div className="p-4 border-b border-line bg-muted/20 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Pesquisar por título, cliente, empresa ou oportunidade..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 w-full rounded-xl bg-card pl-10 pr-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                  />
                </div>

                <Select value={operatorFilter} onValueChange={setOperatorFilter}>
                  <SelectTrigger className="h-10 w-48 shrink-0 rounded-xl bg-card px-3 text-xs text-foreground border border-border">
                    <SelectValue placeholder="Todos Consultores" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-line rounded-xl text-xs shadow-soft z-[120]">
                    <SelectItem value="all" className="cursor-pointer text-xs">Todos Consultores</SelectItem>
                    {uniqueOperatorsList.map((op) => (
                      <SelectItem key={op.id} value={op.id} className="cursor-pointer text-xs">
                        {op.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex bg-muted rounded-xl p-1 shrink-0">
                  {(["all", "open", "completed"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setModalStatusFilter(status)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        modalStatusFilter === status
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {status === "all" ? "Todas" : status === "open" ? "Em Aberto" : "Concluídas"}
                    </button>
                  ))}
                </div>

                <div className="w-48 shrink-0">
                  <CrmDatePicker
                    value={modalDateFilter}
                    onChange={setModalDateFilter}
                    placeholder="Filtrar por data"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin">
                {(() => {
                  const modalFiltered = filteredBaseTasks.filter((t) => {
                    const isDone = t.status === "done" || t.status === "completed";
                    if (modalStatusFilter === "open" && isDone) return false;
                    if (modalStatusFilter === "completed" && !isDone) return false;
                    if (modalDateFilter) {
                      if (!t.dueDate) return false;
                      const localDateStr = new Date(t.dueDate).toLocaleDateString("sv-SE");
                      if (localDateStr !== modalDateFilter) return false;
                    }
                    return true;
                  });

                  if (modalFiltered.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-14 text-center">
                        <Filter className="h-10 w-10 text-muted-foreground/30 mb-2" />
                        <p className="text-sm font-bold text-foreground">Nenhuma tarefa encontrada</p>
                        <p className="text-xs text-muted-foreground mt-1">Ajuste os filtros acima para visualizar outras atividades.</p>
                      </div>
                    );
                  }

                  return modalFiltered.map((task) => (
                    <GlobalTaskCard360
                      key={task.id}
                      task={task}
                      peekConvId={peekConvId}
                      peekMessages={peekMessages}
                      loadingPeekId={loadingPeekId}
                      whisperTaskId={whisperTaskId}
                      whisperText={whisperText}
                      sendingWhisper={sendingWhisper}
                      startingChatTaskId={startingChatTaskId}
                      reschedulingTaskId={reschedulingTaskId}
                      onToggleComplete={toggleTaskStatus}
                      onEditTask={(t) => {
                        setIsAllTasksModalOpen(false);
                        handleEditTask(t);
                      }}
                      onRescheduleTask={handleRescheduleTask}
                      onCancelTask={handleCancelTask}
                      onDeleteTask={handleDeleteTask}
                      onTogglePeek={handleTogglePeek}
                      onToggleWhisper={handleToggleWhisper}
                      onChangeWhisperText={setWhisperText}
                      onSendWhisper={handleSendWhisper}
                      onOpenOrStartChat={(t) => {
                        setIsAllTasksModalOpen(false);
                        handleOpenOrStartChat(t);
                      }}
                      onNavigateDeal={(dealId) => {
                        setIsAllTasksModalOpen(false);
                        handleNavigateDeal(dealId);
                      }}
                    />
                  ));
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL 2: CONFIRMAÇÃO DE CONCLUSÃO + AGENDAMENTO DO PRÓXIMO PASSO */}
      <AnimatePresence>
        {taskToComplete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
            onClick={() => !isConfirmingComplete && setTaskToComplete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl bg-card border border-border shadow-2xl overflow-hidden"
            >
              <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-primary/5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-foreground">
                      Concluir Atividade
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Registre o desfecho e mantenha o negócio ativo
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isConfirmingComplete}
                  onClick={() => setTaskToComplete(null)}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Confirmar conclusão da tarefa <strong className="text-foreground">"{taskToComplete.name}"</strong> ({taskToComplete.operatorName})?
                </p>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-foreground block">
                    Observação de Conclusão (Opcional)
                  </label>
                  <textarea
                    rows={2}
                    value={completionNote}
                    onChange={(e) => setCompletionNote(e.target.value)}
                    placeholder="Ex.: Cliente confirmou recebimento da proposta..."
                    className="w-full rounded-xl bg-muted/50 border border-border p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                </div>

                <div className="rounded-2xl border border-border bg-muted/20 p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="schedule-next-followup"
                      checked={scheduleNextFollowUp}
                      onCheckedChange={(v) => setScheduleNextFollowUp(Boolean(v))}
                    />
                    <label
                      htmlFor="schedule-next-followup"
                      className="text-xs font-extrabold text-foreground cursor-pointer select-none"
                    >
                      Agendar próximo follow-up automaticamente
                    </label>
                  </div>

                  {scheduleNextFollowUp && (
                    <div className="pt-1">
                      <SystemDateTimePicker
                        value={nextFollowUpDate}
                        onChange={setNextFollowUpDate}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 bg-muted/30 border-t border-border flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={isConfirmingComplete}
                  onClick={() => setTaskToComplete(null)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-card transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isConfirmingComplete}
                  onClick={confirmCompleteGlobalTask}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 text-xs font-bold shadow-sm transition cursor-pointer disabled:opacity-60"
                >
                  {isConfirmingComplete && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Concluir Tarefa
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL 3: CRIAR / DELEGAR OU EDITAR TAREFA */}
      <CreateTaskModal
        isOpen={isCreateModalOpen}
        open={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingTaskData(null);
        }}
        onTaskCreated={fetchTasks}
        onCreated={fetchTasks}
        operators={taskModalOperators}
        editingTask={editingTaskData}
      />
    </div>
  );
}

function formatAiFeatureBadgeLabel(feature: string, tenant: string): string {
  switch (feature) {
    case "sdr_agent":
      return "SDR Bot (Triagem)";
    case "conversation_audit":
      return "Auditoria QA";
    case "supervisor_chat":
      return tenant === "tecfag" ? "Fagner Supervisor" : "Valentina Supervisor";
    case "valentina_chat":
      return "Valentina Chat";
    case "fagner_chat":
      return "Fagner Chat";
    case "operator_assistant":
      return "Assistente Inline";
    case "sla_advisor":
      return "Análise SLA";
    case "executive_reports":
      return "Relatórios Executivos";
    case "crm_ai_priority":
      return "Priorização CRM";
    case "call_transcription":
      return "Transcrição Áudio/Voz";
    case "sentiment_analysis":
      return "Análise Sentimento";
    case "knowledge_rag":
      return "Base RAG";
    default:
      return feature || "Geral Vertex AI";
  }
}

// ── Aba de Custos & Telemetria (Vertex AI + WhatsApp Meta Oficial API) ──────
export function CostsTab({
  tenant,
  costViewMode: externalCostViewMode,
  onChangeCostViewMode,
}: {
  tenant: string;
  costViewMode?: "ai" | "meta";
  onChangeCostViewMode?: (mode: "ai" | "meta") => void;
}) {
  const [internalCostMode, setInternalCostMode] = useState<"ai" | "meta">("ai");
  const activeCostMode = externalCostViewMode ?? internalCostMode;
  const handleSetCostMode = useCallback(
    (nextMode: "ai" | "meta") => {
      if (onChangeCostViewMode) {
        onChangeCostViewMode(nextMode);
      } else {
        setInternalCostMode(nextMode);
      }
    },
    [onChangeCostViewMode],
  );

  // ── Estados do Painel Vertex AI ──
  const [period, setPeriod] = useState<"today" | "7d" | "30d" | "month">("7d");
  const [featureFilter, setFeatureFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  // ── Estados do Painel Meta Oficial API ──
  const [metaPeriod, setMetaPeriod] = useState<"today" | "7d" | "30d" | "month">("7d");
  const [metaCategoryFilter, setMetaCategoryFilter] = useState<string>("all");
  const [metaBillingFilter, setMetaBillingFilter] = useState<string>("all");
  const [metaOriginFilter, setMetaOriginFilter] = useState<string>("all");
  const [metaSearchQuery, setMetaSearchQuery] = useState("");
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaData, setMetaData] = useState<any>(null);

  const fetchCosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/gestao/costs?tenantId=${tenant}&period=${period}&feature=${featureFilter}&model=${modelFilter}`,
      );
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("[CostsTab] Erro ao buscar custos de IA:", e);
    } finally {
      setLoading(false);
    }
  }, [tenant, period, featureFilter, modelFilter]);

  const fetchMetaCosts = useCallback(async () => {
    setMetaLoading(true);
    try {
      const res = await fetch(
        `/api/gestao/meta-costs?tenantId=${tenant}&period=${metaPeriod}&category=${metaCategoryFilter}&billing=${metaBillingFilter}&origin=${metaOriginFilter}`,
      );
      if (res.ok) {
        const json = await res.json();
        setMetaData(json);
      }
    } catch (e) {
      console.error("[CostsTab] Erro ao buscar custos Meta API:", e);
    } finally {
      setMetaLoading(false);
    }
  }, [tenant, metaPeriod, metaCategoryFilter, metaBillingFilter, metaOriginFilter]);

  useEffect(() => {
    if (activeCostMode === "ai") {
      fetchCosts();
    } else {
      fetchMetaCosts();
    }
  }, [activeCostMode, fetchCosts, fetchMetaCosts]);

  // ═══════════════════════════════════════════════════════════════════════════
  // MODO 2: PAINEL DE CUSTOS & TARIFAÇÃO WHATSAPP — META OFICIAL API
  // ═══════════════════════════════════════════════════════════════════════════
  if (activeCostMode === "meta") {
    if (metaLoading && !metaData) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 py-20 text-muted-foreground gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-xs font-semibold">
            Calculando disparos, templates, tarifas e bônus da Meta Oficial Cloud API...
          </p>
        </div>
      );
    }

    const metaSummary = metaData?.summary || {
      totalMessages: 0,
      billableMessages: 0,
      freeBonusMessages: 0,
      failedMessages: 0,
      deliveredOrReadCount: 0,
      deliveryRatePct: 100,
      templatesSent: 0,
      serviceMessagesSent: 0,
      operatorMessages: 0,
      botMessages: 0,
      activeConversationsCount: 0,
      activeServiceWindowsCount: 0,
      totalCostUsd: 0,
      totalCostBrl: 0,
      totalSavedUsd: 0,
      totalSavedBrl: 0,
      avgCostPerMessageBrl: 0,
      avgCostPerBillableBrl: 0,
      registeredTemplatesCount: 0,
    };

    const monthlyBonus = metaData?.monthlyBonus || {
      allowanceConversationsLimit: 1000,
      usedConversations: 0,
      remainingConversations: 1000,
      usagePercentage: 0,
      freeMessagesInMonth: 0,
      isWithinFreeTier: true,
    };

    const tariffSchedule = metaData?.tariffSchedule || {
      usdToBrl: 5.6,
      rates: [],
    };

    const categoryBreakdown = metaData?.categoryBreakdown || [];
    const templateBreakdown = metaData?.templateBreakdown || [];
    const metaTimeline = metaData?.timeline || [];
    const metaLogs = (metaData?.logs || []).filter((log: any) => {
      if (!metaSearchQuery) return true;
      const q = metaSearchQuery.toLowerCase();
      return (
        log.contactName?.toLowerCase().includes(q) ||
        log.contactPhone?.toLowerCase().includes(q) ||
        log.templateName?.toLowerCase().includes(q) ||
        log.categoryLabel?.toLowerCase().includes(q) ||
        log.billingRuleLabel?.toLowerCase().includes(q) ||
        log.contentPreview?.toLowerCase().includes(q) ||
        log.senderName?.toLowerCase().includes(q)
      );
    });

    return (
      <div className="flex flex-col flex-1 overflow-y-auto pr-1 space-y-4 pb-4">
        {/* Top Header & Filters — Meta Oficial API */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/20 p-3.5 rounded-2xl border border-line">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold shadow-xs">
              <WhatsappLogo className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-foreground flex flex-wrap items-center gap-2">
                Gestão de Custos & Tarifação WhatsApp
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold border border-primary/20">
                  <ShieldCheck className="h-3 w-3" />
                  Meta Oficial Cloud API
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-foreground text-[10px] font-bold border border-border">
                  <Sparkles className="h-3 w-3 text-primary" />
                  Bônus Mensal: {monthlyBonus.remainingConversations}/
                  {monthlyBonus.allowanceConversationsLimit} conversas grátis disponíveis
                </span>
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Contabilização oficial de templates (Marketing, Utilidade, Autenticação), mensagens de serviço e isenção da Janela 24h
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-card rounded-xl p-1 border border-line shadow-xs">
              <button
                type="button"
                onClick={() => setMetaPeriod("today")}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                  metaPeriod === "today"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => setMetaPeriod("7d")}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                  metaPeriod === "7d"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                7 Dias
              </button>
              <button
                type="button"
                onClick={() => setMetaPeriod("30d")}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                  metaPeriod === "30d"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                30 Dias
              </button>
              <button
                type="button"
                onClick={() => setMetaPeriod("month")}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                  metaPeriod === "month"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Mês Atual
              </button>
            </div>

            <Select value={metaCategoryFilter} onValueChange={setMetaCategoryFilter}>
              <SelectTrigger className="w-auto h-8 text-xs font-semibold rounded-xl bg-card border-line px-3 py-1.5 focus:ring-primary/20">
                <SelectValue placeholder="Todas Categorias Meta" />
              </SelectTrigger>
              <SelectContent className="bg-card border-line rounded-xl text-xs shadow-soft z-50">
                <SelectItem value="all" className="cursor-pointer text-xs">
                  Todas Categorias Meta
                </SelectItem>
                <SelectItem value="MARKETING" className="cursor-pointer text-xs">
                  Marketing (Templates)
                </SelectItem>
                <SelectItem value="UTILITY" className="cursor-pointer text-xs">
                  Utilidade (Pós-Venda / Avisos)
                </SelectItem>
                <SelectItem value="AUTHENTICATION" className="cursor-pointer text-xs">
                  Autenticação (OTP)
                </SelectItem>
                <SelectItem value="SERVICE" className="cursor-pointer text-xs">
                  Serviço (Janela 24h Gratuita)
                </SelectItem>
              </SelectContent>
            </Select>

            <Select value={metaBillingFilter} onValueChange={setMetaBillingFilter}>
              <SelectTrigger className="w-auto h-8 text-xs font-semibold rounded-xl bg-card border-line px-3 py-1.5 focus:ring-primary/20">
                <SelectValue placeholder="Todas Cobranças & Bônus" />
              </SelectTrigger>
              <SelectContent className="bg-card border-line rounded-xl text-xs shadow-soft z-50">
                <SelectItem value="all" className="cursor-pointer text-xs">
                  Todas Cobranças & Bônus
                </SelectItem>
                <SelectItem value="billable" className="cursor-pointer text-xs">
                  Apenas Tarifados (Pagos)
                </SelectItem>
                <SelectItem value="free" className="cursor-pointer text-xs">
                  Grátis (Bônus Janela 24h & Franquia)
                </SelectItem>
                <SelectItem value="templates" className="cursor-pointer text-xs">
                  Apenas Templates Oficiais
                </SelectItem>
                <SelectItem value="failed" className="cursor-pointer text-xs">
                  Falhas (Não Cobrados)
                </SelectItem>
              </SelectContent>
            </Select>

            <Select value={metaOriginFilter} onValueChange={setMetaOriginFilter}>
              <SelectTrigger className="w-auto h-8 text-xs font-semibold rounded-xl bg-card border-line px-3 py-1.5 focus:ring-primary/20">
                <SelectValue placeholder="Todas Origens" />
              </SelectTrigger>
              <SelectContent className="bg-card border-line rounded-xl text-xs shadow-soft z-50">
                <SelectItem value="all" className="cursor-pointer text-xs">
                  Todas Origens
                </SelectItem>
                <SelectItem value="agent" className="cursor-pointer text-xs">
                  Operador Humano
                </SelectItem>
                <SelectItem value="bot" className="cursor-pointer text-xs">
                  Bot IA (SDR / Follow-up)
                </SelectItem>
              </SelectContent>
            </Select>

            <SystemTooltip content="Voltar para Custos de I.A. (Vertex AI)" side="bottom">
              <button
                type="button"
                onClick={() => handleSetCostMode("ai")}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-card border border-line rounded-xl text-[11px] font-bold text-muted-foreground hover:text-primary hover:border-primary/30 transition cursor-pointer"
              >
                <Cpu className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Ver I.A.</span>
              </button>
            </SystemTooltip>

            <SystemTooltip content="Atualizar custos Meta API" side="bottom">
              <button
                type="button"
                onClick={fetchMetaCosts}
                className="p-1.5 bg-card border border-line rounded-xl text-muted-foreground hover:text-primary transition cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${metaLoading ? "animate-spin" : ""}`} />
              </button>
            </SystemTooltip>
          </div>
        </div>

        {/* 4 KPI Cards — Meta Oficial API */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Card 1: Custo Total Meta API */}
          <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between relative overflow-hidden group">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider">
                Custo Total Meta API
              </span>
              <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
                <DollarSign className="h-4 w-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-black text-foreground tracking-tight flex items-baseline gap-1.5">
                R${" "}
                {metaSummary.totalCostBrl.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span className="text-xs font-semibold text-muted-foreground">
                  (US$ {metaSummary.totalCostUsd.toFixed(2)})
                </span>
              </div>
              <p className="text-[11px] text-primary font-semibold mt-1 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {metaSummary.billableMessages} disparos tarifados • Brasil (+55)
              </p>
            </div>
          </div>

          {/* Card 2: Bônus & Economia (Janela 24h + Franquia 1.000 conversas) */}
          <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between relative overflow-hidden group">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider">
                Bônus Meta & Economia (Janela 24h)
              </span>
              <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-black text-foreground tracking-tight flex items-baseline gap-1.5">
                R${" "}
                {metaSummary.totalSavedBrl.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span className="text-xs font-semibold text-primary">economizados</span>
              </div>
              <div className="mt-1.5 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
                  <span>
                    Franquia Mensal: {monthlyBonus.usedConversations} /{" "}
                    {monthlyBonus.allowanceConversationsLimit} janelas grátis
                  </span>
                  <span className="text-foreground font-bold">{monthlyBonus.usagePercentage}%</span>
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(monthlyBonus.usagePercentage, 3)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Mensagens & Templates Enviados */}
          <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between relative overflow-hidden group">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider">
                Disparos & Templates Meta
              </span>
              <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
                <MessageSquare className="h-4 w-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-black text-foreground tracking-tight">
                {metaSummary.totalMessages}
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  mensagens enviadas
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground font-semibold mt-1">
                <span className="text-foreground">
                  Grátis (24h): {metaSummary.freeBonusMessages}
                </span>
                <span>•</span>
                <span className="text-primary">Templates: {metaSummary.templatesSent}</span>
                <span>•</span>
                <span>Pagas: {metaSummary.billableMessages}</span>
              </div>
            </div>
          </div>

          {/* Card 4: Custo Médio & Taxa de Entrega */}
          <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between relative overflow-hidden group">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider">
                Custo Médio / Disparo
              </span>
              <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
                <BarChart2 className="h-4 w-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-black text-foreground tracking-tight flex items-baseline gap-1.5">
                R$ {metaSummary.avgCostPerMessageBrl.toFixed(3)}
                <span className="text-[10px] font-semibold text-muted-foreground">
                  (Tarifado: R$ {metaSummary.avgCostPerBillableBrl.toFixed(3)})
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground font-semibold mt-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-primary" />
                Entrega: {metaSummary.deliveryRatePct}% • Op: {metaSummary.operatorMessages} / IA:{" "}
                {metaSummary.botMessages}
              </p>
            </div>
          </div>
        </div>

        {/* Middle Section: Evolution Chart + Category & Official Tariff Schedule */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-primary" />
                    Evolução Diária de Custos Meta (R$) & Volume de Mensagens (Pagas vs. Bônus 24h)
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    Comparativo diário entre tarifação efetiva e mensagens isentas pela janela gratuita de 24h
                  </p>
                </div>
              </div>

              <div className="h-60 w-full">
                {metaTimeline.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={metaTimeline}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                      <XAxis
                        dataKey="dateFormatted"
                        tick={{ fontSize: 10 }}
                        stroke="var(--muted-foreground)"
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 10 }}
                        stroke="var(--muted-foreground)"
                        tickFormatter={(v) => `R$${v}`}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10 }}
                        stroke="var(--muted-foreground)"
                        tickFormatter={(v) => `${v}`}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: "var(--card)",
                          borderColor: "var(--border)",
                          borderRadius: "12px",
                          color: "var(--foreground)",
                          fontSize: "11px",
                        }}
                        formatter={(value: any, name: any) => {
                          if (name === "Custo Meta (R$)")
                            return [`R$ ${Number(value).toFixed(2)}`, name];
                          return [`${Number(value)} msgs`, name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "5px" }} />
                      <Bar
                        yAxisId="left"
                        dataKey="costBrl"
                        name="Custo Meta (R$)"
                        fill="var(--primary)"
                        radius={[6, 6, 0, 0]}
                        barSize={22}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="freeMessages"
                        name="Grátis (Bônus 24h)"
                        stroke="var(--foreground)"
                        strokeWidth={2}
                        dot={{ r: 3, fill: "var(--foreground)" }}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="billableMessages"
                        name="Disparos Tarifados"
                        stroke="var(--muted-foreground)"
                        strokeDasharray="4 4"
                        strokeWidth={2}
                        dot={{ r: 2.5, fill: "var(--muted-foreground)" }}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                    Sem disparos via Meta Oficial API para os filtros selecionados
                  </div>
                )}
              </div>
            </div>

            {/* Resumo de Templates Disparados */}
            <div className="mt-3 pt-3 border-t border-line/60">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-extrabold text-foreground flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  Templates Oficiais Disparados no Período ({templateBreakdown.length})
                </span>
                <span className="text-[10px] text-muted-foreground font-semibold">
                  {metaSummary.registeredTemplatesCount} templates sincronizados na conta
                </span>
              </div>
              {templateBreakdown.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {templateBreakdown.slice(0, 6).map((tpl: any) => (
                    <div
                      key={tpl.templateName}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-muted/40 border border-line text-[11px]"
                    >
                      <span className="font-bold text-foreground truncate max-w-[160px]">
                        {tpl.templateName}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-[9px] font-bold uppercase">
                        {tpl.category}
                      </span>
                      <span className="text-muted-foreground font-mono text-[10px]">
                        {tpl.sentCount}x
                      </span>
                      <span className="font-mono font-bold text-foreground text-[10px]">
                        R$ {tpl.costBrl.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Nenhum template disparado no período — 100% das mensagens enviadas foram respostas livres de atendimento (Janela 24h Gratuita).
                </p>
              )}
            </div>
          </div>

          {/* Right Column: Category Breakdown & Official Meta Tariff Table */}
          <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5 mb-1">
                <Layers className="h-3.5 w-3.5 text-primary" />
                Categorias & Tabela de Tarifas Meta (+55)
              </h3>
              <p className="text-[10px] text-muted-foreground mb-3.5">
                Tarifação oficial por categoria e volume de mensagens gratuitas
              </p>

              <div className="space-y-3">
                {categoryBreakdown.map((item: any) => (
                  <div key={item.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-foreground text-[11px] truncate flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        {item.categoryName}
                      </span>
                      <span className="text-muted-foreground font-mono text-[11px]">
                        R$ {item.costBrl.toFixed(2)} ({item.percentageOfVolume}% vol)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max(
                            item.percentageOfCost > 0
                              ? item.percentageOfCost
                              : item.percentageOfVolume,
                            4,
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {item.totalMessages} envios ({item.billableMessages} pagos •{" "}
                        {item.freeMessages} grátis)
                      </span>
                      <span className="font-mono">
                        {item.unitRateUsd > 0
                          ? `Tarifa: US$ ${item.unitRateUsd.toFixed(4)} (R$ ${item.unitRateBrl.toFixed(3)})`
                          : "Tarifa: R$ 0,00 (Grátis)"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 p-2.5 rounded-xl bg-primary/5 border border-primary/10 text-[10px] text-muted-foreground space-y-1.5">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <span className="font-extrabold text-foreground block">
                    Regra de Bônus & Isenção Meta Oficial:
                  </span>
                  Respostas livres de atendimento (<strong className="text-foreground">SERVICE</strong>) e
                  templates de <strong className="text-foreground">UTILITY</strong> enviados dentro da{" "}
                  <strong className="text-foreground">Janela de 24h</strong> aberta pelo cliente têm{" "}
                  <strong className="text-primary">custo R$ 0,00</strong>, além da franquia mensal de{" "}
                  <strong className="text-foreground">1.000 conversas de serviço gratuitas</strong>.
                </div>
              </div>
              {tariffSchedule.rates?.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-primary/10 text-[9.5px]">
                  {tariffSchedule.rates.map((r: any) => (
                    <div
                      key={r.category}
                      className="flex items-center justify-between bg-card/80 px-2 py-1 rounded-lg border border-line/60"
                    >
                      <span className="font-bold text-foreground">{r.category}</span>
                      <span className="font-mono text-primary font-bold">
                        {r.usd > 0 ? `R$ ${r.brl.toFixed(3)}` : "GRÁTIS"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Real-time Meta API Billing Logs Table */}
        <div className="bg-card rounded-2xl border border-line shadow-soft overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-line flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-primary" />
                Logs de Tarifação & Disparos Meta Oficial API em Tempo Real
              </h3>
              <p className="text-[10px] text-muted-foreground">
                Auditoria individual de cada mensagem enviada, template utilizado, janela 24h e tarifa aplicada
              </p>
            </div>

            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filtrar contato, template, regra..."
                value={metaSearchQuery}
                onChange={(e) => setMetaSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 bg-muted/40 border border-line rounded-xl text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary w-60 transition"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/30 border-b border-line text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                <tr>
                  <th className="py-2 px-3.5">Horário</th>
                  <th className="py-2 px-3.5">Destinatário / Origem</th>
                  <th className="py-2 px-3.5">Categoria Meta</th>
                  <th className="py-2 px-3.5">Tipo / Template</th>
                  <th className="py-2 px-3.5">Regra de Cobrança / Bônus</th>
                  <th className="py-2 px-3.5">Custo USD</th>
                  <th className="py-2 px-3.5">Custo BRL</th>
                  <th className="py-2 px-3.5 text-center">Entrega</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {metaLogs.length > 0 ? (
                  metaLogs.map((log: any) => {
                    const dateFormatted = log.sentAt
                      ? new Date(log.sentAt).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })
                      : "--";
                    const dateDay = log.sentAt
                      ? new Date(log.sentAt).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                        })
                      : "";

                    return (
                      <tr key={log.id} className="hover:bg-muted/20 transition">
                        <td className="py-2 px-3.5 font-mono text-[11px] text-foreground whitespace-nowrap">
                          <span className="font-bold">{dateFormatted}</span>
                          <span className="text-[9px] text-muted-foreground ml-1.5">{dateDay}</span>
                        </td>
                        <td className="py-2 px-3.5">
                          <div className="flex flex-col">
                            <span className="font-bold text-[11px] text-foreground truncate max-w-[170px]">
                              {log.contactName}
                            </span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                              <span className="font-mono">{log.contactPhone}</span>
                              <span>•</span>
                              <span className="font-semibold text-primary">{log.originLabel}</span>
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-3.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                              log.category === "MARKETING" || log.category === "AUTHENTICATION"
                                ? "bg-primary/10 text-primary border border-primary/20"
                                : "bg-muted/60 text-foreground border border-border"
                            }`}
                          >
                            {log.category}
                          </span>
                        </td>
                        <td className="py-2 px-3.5">
                          <div className="flex flex-col max-w-[220px]">
                            <span className="font-semibold text-[11px] text-foreground truncate">
                              {log.isTemplate
                                ? `Template: ${log.templateName}`
                                : log.messageFormatLabel}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate">
                              {log.contentPreview}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-3.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                              log.billable
                                ? "bg-muted text-foreground border border-border"
                                : "bg-primary/10 text-primary border border-primary/20"
                            }`}
                          >
                            {log.billingRuleLabel}
                          </span>
                        </td>
                        <td className="py-2 px-3.5 font-mono text-[11px] font-semibold text-foreground whitespace-nowrap">
                          $ {Number(log.costUsd || 0).toFixed(4)}
                        </td>
                        <td className="py-2 px-3.5 font-mono text-[11px] font-bold whitespace-nowrap">
                          {log.billable ? (
                            <span className="text-foreground">
                              R$ {Number(log.costBrl || 0).toFixed(4)}
                            </span>
                          ) : (
                            <span className="text-primary">
                              GRÁTIS{" "}
                              {log.savedBrl > 0 ? (
                                <span className="text-[9px] text-muted-foreground font-normal">
                                  (-R$ {Number(log.savedBrl).toFixed(3)})
                                </span>
                              ) : null}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3.5 text-center whitespace-nowrap">
                          {!log.isFailed ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-extrabold">
                              <CheckCircle2 className="h-3 w-3" /> {log.statusLabel}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 text-[10px] font-extrabold">
                              <XCircle className="h-3 w-3" /> FALHA
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                      Nenhum disparo da Meta Oficial API encontrado para os filtros selecionados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODO 1 (PADRÃO): PAINEL DE CUSTOS & TELEMETRIA VERTEX AI
  // ═══════════════════════════════════════════════════════════════════════════
  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-20 text-muted-foreground gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-xs font-semibold">Carregando telemetria e dados financeiros da Vertex AI...</p>
      </div>
    );
  }

  const summary = data?.summary || {
    totalCalls: 0,
    totalCostUsd: 0,
    totalCostBrl: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    avgLatencyMs: 0,
    avgCostPerCallBrl: 0,
    successCount: 0,
    errorCount: 0,
  };

  const featureBreakdown = data?.featureBreakdown || [];
  const timeline = data?.timeline || [];
  const logs = (data?.logs || []).filter((log: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const label = formatAiFeatureBadgeLabel(log.feature, tenant).toLowerCase();
    return (
      log.feature?.toLowerCase().includes(q) ||
      label.includes(q) ||
      log.model?.toLowerCase().includes(q) ||
      log.status?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col flex-1 overflow-y-auto pr-1 space-y-4 pb-4">
      {/* Top Header & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/20 p-3.5 rounded-2xl border border-line">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold shadow-xs">
            <Coins className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-foreground flex items-center gap-2">
              Gestão de Custos & Telemetria Vertex AI
              {data?.isSimulated ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold border border-border">
                  <Sparkles className="h-3 w-3" />
                  Demonstrativo Dev
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold border border-primary/20">
                  <ShieldCheck className="h-3 w-3" />
                  Telemetria Real Vertex AI
                </span>
              )}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Monitoramento financeiro e consumo de tokens do Google Gemini em produção
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-card rounded-xl p-1 border border-line shadow-xs">
            <button
              type="button"
              onClick={() => setPeriod("today")}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                period === "today" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setPeriod("7d")}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                period === "7d" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              7 Dias
            </button>
            <button
              type="button"
              onClick={() => setPeriod("30d")}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                period === "30d" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              30 Dias
            </button>
            <button
              type="button"
              onClick={() => setPeriod("month")}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                period === "month" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Mês Atual
            </button>
          </div>

          <Select value={featureFilter} onValueChange={setFeatureFilter}>
            <SelectTrigger className="w-auto h-8 text-xs font-semibold rounded-xl bg-card border-line px-3 py-1.5 focus:ring-primary/20">
              <SelectValue placeholder="Todas Funcionalidades" />
            </SelectTrigger>
            <SelectContent className="bg-card border-line rounded-xl text-xs shadow-soft z-50">
              <SelectItem value="all" className="cursor-pointer text-xs">Todas Funcionalidades</SelectItem>
              <SelectItem value="sdr_agent" className="cursor-pointer text-xs">SDR Bot (Triagem de Leads)</SelectItem>
              {tenant === "tecfag" ? (
                <SelectItem value="fagner_chat" className="cursor-pointer text-xs">Fagner Chat do Operador</SelectItem>
              ) : (
                <SelectItem value="valentina_chat" className="cursor-pointer text-xs">Valentina Chat do Operador</SelectItem>
              )}
              <SelectItem value="operator_assistant" className="cursor-pointer text-xs">Assistente Inline (Gramática / Resposta / Resumo)</SelectItem>
              <SelectItem value="supervisor_chat" className="cursor-pointer text-xs">Supervisor Chat (Gestão)</SelectItem>
              <SelectItem value="conversation_audit" className="cursor-pointer text-xs">Auditoria de Atendimento QA</SelectItem>
              <SelectItem value="sla_advisor" className="cursor-pointer text-xs">Análise SLA & Alertas</SelectItem>
              <SelectItem value="executive_reports" className="cursor-pointer text-xs">Relatórios Executivos IA</SelectItem>
              <SelectItem value="crm_ai_priority" className="cursor-pointer text-xs">Priorização IA de Negócios (CRM)</SelectItem>
              <SelectItem value="call_transcription" className="cursor-pointer text-xs">Transcrição de Áudio & Ligações</SelectItem>
              <SelectItem value="sentiment_analysis" className="cursor-pointer text-xs">Análise de Sentimento (Clientes)</SelectItem>
              <SelectItem value="knowledge_rag" className="cursor-pointer text-xs">Base de Conhecimento RAG</SelectItem>
            </SelectContent>
          </Select>

          <Select value={modelFilter} onValueChange={setModelFilter}>
            <SelectTrigger className="w-auto h-8 text-xs font-semibold rounded-xl bg-card border-line px-3 py-1.5 focus:ring-primary/20">
              <SelectValue placeholder="Todos os Modelos" />
            </SelectTrigger>
            <SelectContent className="bg-card border-line rounded-xl text-xs shadow-soft z-50">
              <SelectItem value="all" className="cursor-pointer text-xs">Todos os Modelos</SelectItem>
              <SelectItem value="gemini-2.5-pro" className="cursor-pointer text-xs">Gemini 2.5 Pro</SelectItem>
              <SelectItem value="gemini-2.5-flash" className="cursor-pointer text-xs">Gemini 2.5 Flash</SelectItem>
              <SelectItem value="gemini-2.0-flash" className="cursor-pointer text-xs">Gemini 2.0 Flash</SelectItem>
              <SelectItem value="gemini-1.5-flash" className="cursor-pointer text-xs">Gemini 1.5 Flash</SelectItem>
            </SelectContent>
          </Select>

          <SystemTooltip content="Atualizar custos" side="bottom">
            <button
              type="button"
              onClick={fetchCosts}
              className="p-1.5 bg-card border border-line rounded-xl text-muted-foreground hover:text-primary transition cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Custo Total Estimado</span>
            <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-foreground tracking-tight flex items-baseline gap-1.5">
              R$ {summary.totalCostBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-semibold text-muted-foreground">
                (US$ {summary.totalCostUsd.toFixed(2)})
              </span>
            </div>
            <p className="text-[11px] text-primary font-semibold mt-1 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Preços Oficiais Vertex AI Rest API
            </p>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Tokens Processados</span>
            <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-foreground tracking-tight">
              {(summary.totalTokens / 1_000_000).toFixed(2)} M
              <span className="text-xs font-normal text-muted-foreground ml-1">tokens</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-semibold mt-1">
              <span className="text-foreground">Prompt: {(summary.promptTokens / 1_000_000).toFixed(2)}M</span>
              <span>•</span>
              <span className="text-muted-foreground">Resp: {(summary.completionTokens / 1000).toFixed(0)}k</span>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Requisições à IA</span>
            <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-foreground tracking-tight">
              {summary.totalCalls}
              <span className="text-xs font-normal text-muted-foreground ml-1">chamadas</span>
            </div>
            <p className="text-[11px] text-muted-foreground font-semibold mt-1 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-primary" />
              Sucesso: {summary.totalCalls > 0 ? ((summary.successCount / summary.totalCalls) * 100).toFixed(1) : 100}%
            </p>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Custo Médio / Interação</span>
            <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
              <BarChart2 className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-foreground tracking-tight">
              R$ {summary.avgCostPerCallBrl.toFixed(3)}
            </div>
            <p className="text-[11px] text-muted-foreground font-semibold mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3 text-primary" />
              Latência média: {summary.avgLatencyMs} ms
            </p>
          </div>
        </div>
      </div>

      {/* Chart & Feature Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
                Evolução Diária de Custos (R$) & Volume de Tokens
              </h3>
              <p className="text-[10px] text-muted-foreground">Gastos e consumo acumulado por dia de operação</p>
            </div>
          </div>

          <div className="h-60 w-full">
            {timeline.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={timeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                  <XAxis dataKey="dateFormatted" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `R$${v}`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "var(--card)", borderColor: "var(--border)", borderRadius: "12px", color: "var(--foreground)", fontSize: "11px" }}
                    formatter={(value: any, name: any) => {
                      if (name === "Custo (R$)") return [`R$ ${Number(value).toFixed(2)}`, name];
                      if (name === "Tokens") return [`${Number(value).toLocaleString()} tokens`, name];
                      return [value, name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "5px" }} />
                  <Bar yAxisId="left" dataKey="costBrl" name="Custo (R$)" fill="var(--primary)" radius={[6, 6, 0, 0]} barSize={22} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="tokens" name="Tokens" stroke="var(--muted-foreground)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--foreground)", stroke: "var(--muted-foreground)" }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                Sem histórico para os filtros selecionados
              </div>
            )}
          </div>
        </div>

        <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5 mb-1">
              <Layers className="h-3.5 w-3.5 text-primary" />
              Custo por Funcionalidade
            </h3>
            <p className="text-[10px] text-muted-foreground mb-3.5">Proporção de uso e gastos da I.A.</p>

            <div className="space-y-3">
              {featureBreakdown.map((item: any) => (
                <div key={item.feature} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-foreground text-[11px] truncate flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      {item.featureName}
                    </span>
                    <span className="text-muted-foreground font-mono text-[11px]">
                      R$ {item.costBrl.toFixed(2)} ({item.percentage}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(item.percentage, 4)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{item.calls} chamadas</span>
                    <span>{(item.tokens / 1000).toFixed(0)}k tokens</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 p-2.5 rounded-xl bg-primary/5 border border-primary/10 text-[10px] text-muted-foreground flex items-start gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <span className="font-extrabold text-foreground block">Otimização Recorrente:</span>
              Garante transparência nos custos por triagem, assistente do operador, CRM, voz e supervisão.
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Telemetry Table */}
      <div className="bg-card rounded-2xl border border-line shadow-soft overflow-hidden flex flex-col">
        <div className="p-3.5 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-primary" />
              Logs de Telemetria Vertex AI em Tempo Real
            </h3>
            <p className="text-[10px] text-muted-foreground">Registro detalhado de cada consumo de tokens e latência</p>
          </div>

          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filtrar logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 bg-muted/40 border border-line rounded-xl text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary w-56 transition"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/30 border-b border-line text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
              <tr>
                <th className="py-2 px-3.5">Horário</th>
                <th className="py-2 px-3.5">Funcionalidade</th>
                <th className="py-2 px-3.5">Modelo Vertex</th>
                <th className="py-2 px-3.5">Tokens (In/Out)</th>
                <th className="py-2 px-3.5">Latência</th>
                <th className="py-2 px-3.5">Custo USD</th>
                <th className="py-2 px-3.5">Custo BRL</th>
                <th className="py-2 px-3.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {logs.length > 0 ? (
                logs.map((log: any) => {
                  const dateFormatted = log.createdAt
                    ? new Date(log.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                    : "--";
                  const dateDay = log.createdAt
                    ? new Date(log.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
                    : "";

                  return (
                    <tr key={log.id} className="hover:bg-muted/20 transition">
                      <td className="py-2 px-3.5 font-mono text-[11px] text-foreground">
                        <span className="font-bold">{dateFormatted}</span>
                        <span className="text-[9px] text-muted-foreground ml-1.5">{dateDay}</span>
                      </td>
                      <td className="py-2 px-3.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                          log.feature === "supervisor_chat" ||
                          log.feature === "valentina_chat" ||
                          log.feature === "fagner_chat" ||
                          log.feature === "operator_assistant"
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : "bg-muted/60 text-foreground border border-border"
                        }`}>
                          {formatAiFeatureBadgeLabel(log.feature, tenant)}
                        </span>
                      </td>
                      <td className="py-2 px-3.5 font-semibold text-[11px] text-foreground">
                        {log.model}
                      </td>
                      <td className="py-2 px-3.5 font-mono text-[11px] text-muted-foreground">
                        <span className="text-foreground font-bold">{log.totalTokens}</span>
                        <span className="text-[10px] ml-1">({log.promptTokens}/{log.completionTokens})</span>
                      </td>
                      <td className="py-2 px-3.5 font-mono text-[11px] text-muted-foreground">
                        {log.latencyMs} ms
                      </td>
                      <td className="py-2 px-3.5 font-mono text-[11px] font-semibold text-foreground">
                        $ {parseFloat(log.costUsd || "0").toFixed(5)}
                      </td>
                      <td className="py-2 px-3.5 font-mono text-[11px] font-bold text-primary">
                        R$ {parseFloat(log.costBrl || "0").toFixed(4)}
                      </td>
                      <td className="py-2 px-3.5 text-center">
                        {log.status === "success" ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-extrabold">
                            <CheckCircle2 className="h-3 w-3" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 text-[10px] font-extrabold">
                            <XCircle className="h-3 w-3" /> ERRO
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                    Nenhum registro de telemetria encontrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import { getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";

// ── Componente Principal ─────────────────────────────────────────────────────
export function MonitorView() {
  const { tenant } = useChat();
  const { canAccessMonitorTab } = usePermissions();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertsSummary, setAlertsSummary] = useState<AlertsExecutiveSummary | null>(null);
  const [alertBottlenecks, setAlertBottlenecks] = useState<AlertOperatorBottleneck[]>([]);
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [loadingAudits, setLoadingAudits] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [historyModalOperator, setHistoryModalOperator] = useState<{ id: string; name: string } | null>(null);
  const [overdueGlobalTasksBadge, setOverdueGlobalTasksBadge] = useState<number>(DEMO_MODE ? 5 : 0);

  const allTabs: { id: MonitorTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "live",      label: "Ao Vivo",        icon: Activity, badge: DEMO_MODE ? 4 : undefined },
    { id: "alerts",    label: "Alertas",         icon: Bell, badge: alerts.filter((a: AlertItem) => a.isOverdue).length },
    { id: "operators", label: "Operadores",      icon: Users },
    { id: "audits",    label: "Auditorias IA",   icon: Zap },
    { id: "tasks",     label: "Tarefas Globais", icon: ClipboardCheck, badge: overdueGlobalTasksBadge > 0 ? overdueGlobalTasksBadge : undefined },
    { id: "site",      label: "Visitantes",      icon: Globe },
  ];

  const allowedTabs = allTabs.filter(t => canAccessMonitorTab(t.id));
  const allowedTabIds = useMemo(() => allowedTabs.map((t) => t.id), [allowedTabs]);
  const [activeTab, setActiveTab] = useState<MonitorTab>(() =>
    getInitialTabFromUrl("monitor", allowedTabs[0]?.id || "live", allowedTabIds),
  );

  useTabNavigation({
    tabs: allowedTabIds,
    activeTab,
    onChange: setActiveTab,
  });

  useSyncModuleTabWithUrl({
    viewId: "monitor",
    activeTab,
    setActiveTab,
    allowedTabs: allowedTabIds,
  });

  useEffect(() => {
    if (!allowedTabs.some(t => t.id === activeTab)) {
      if (allowedTabs.length > 0) {
        setActiveTab(allowedTabs[0].id);
      }
    }
  }, [allowedTabs, activeTab]);

  const fetchData = useCallback(async () => {
    // ── DEMO MODE: usa dados simulados sem chamar a API ────────────────────────
    if (DEMO_MODE) {
      setOverview(MOCK_OVERVIEW as any);
      setAlerts(MOCK_ALERTS as any);
      setAudits(MOCK_AUDITS as any);
      setLastRefresh(new Date());
      setLoadingAlerts(false);
      setLoadingAudits(false);
      return;
    }
    // ── MODO REAL: busca da API ────────────────────────────────────────────────
    try {
      const [ovRes, alRes, auRes] = await Promise.all([
        fetch(`/api/gestao/overview?tenantId=${tenant}`),
        fetch(`/api/gestao/alerts?tenantId=${tenant}&summary=1`),
        fetch(`/api/gestao/audits?tenantId=${tenant}&limit=50`),
      ]);
      if (ovRes.ok) setOverview(await ovRes.json());
      if (alRes.ok) {
        const alData = await alRes.json();
        if (Array.isArray(alData)) {
          setAlerts(alData);
        } else if (alData && typeof alData === "object") {
          setAlerts(Array.isArray(alData.alerts) ? alData.alerts : []);
          setAlertsSummary(alData.summary ?? null);
          setAlertBottlenecks(
            Array.isArray(alData.operatorBottlenecks) ? alData.operatorBottlenecks : []
          );
        }
      }
      if (auRes.ok) setAudits(await auRes.json());
      setLastRefresh(new Date());
    } catch (e) {
      console.error("[MonitorView] Erro ao buscar dados:", e);
    } finally {
      setLoadingAlerts(false);
      setLoadingAudits(false);
    }
  }, [tenant]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000); // Auto-refresh 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
        <div>
          <h1 className="text-base font-extrabold text-foreground flex items-center gap-2">
            <Eye className="h-4.5 w-4.5 text-primary" />
            Monitoramento da Operação
            {DEMO_MODE && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary/10 text-primary text-[10px] font-extrabold border border-primary/30 animate-pulse">
                <FlaskConical className="h-3 w-3" />
                MODO DEMO
              </span>
            )}
          </h1>
          <p className="text-[11px] text-muted-foreground capitalize mt-0.5">{today}</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Atualizar agora</TooltipContent>
        </Tooltip>
      </div>

      {/* Internal Tab Bar */}
      <div className="flex items-center gap-1 px-3 md:px-5 py-2.5 border-b border-line bg-muted/30 shrink-0 overflow-x-auto scrollbar-none">
        {allowedTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-3 md:px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={`ml-0.5 h-4 min-w-4 px-1 rounded-full text-[9px] font-extrabold flex items-center justify-center ${
                  isActive ? "bg-white/30 text-white" : "bg-primary text-primary-foreground"
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className={`flex-1 ${activeTab === "operators" ? "overflow-y-auto min-h-0" : "overflow-hidden"} px-5 py-4 flex flex-col`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className={`flex flex-col flex-1 ${activeTab === "operators" ? "min-h-0 overflow-visible" : "overflow-hidden"}`}
          >
            {activeTab === "live" && (
              <LiveTab demoMode={DEMO_MODE} />
            )}
            {activeTab === "alerts" && (
              <AlertsTab
                alerts={alerts}
                summary={alertsSummary}
                operatorBottlenecks={alertBottlenecks}
                operators={overview?.operators ?? []}
                loading={loadingAlerts}
                onRefresh={fetchData}
              />
            )}
            {activeTab === "operators" && (
              <OperatorsRankingTab 
                overview={overview} 
                audits={audits}
                onSelectAudit={(auditId) => {
                  setSelectedAuditId(auditId);
                  setActiveTab("audits");
                }}
                onOpenHistory={(opId, opName) => {
                  setHistoryModalOperator({ id: opId, name: opName });
                }}
              />
            )}
            {activeTab === "audits" && (
              <AuditsTab 
                selectedAuditId={selectedAuditId}
                onSelectAudit={setSelectedAuditId}
                operators={overview?.operators ?? []}
              />
            )}
            {activeTab === "tasks" && (
              <GlobalTasksTab
                demoMode={DEMO_MODE}
                refreshTick={lastRefresh.getTime()}
                onOverdueCountChange={setOverdueGlobalTasksBadge}
              />
            )}
            {activeTab === "site" && <SiteVisitorsTab tenantId={tenant} />}


          </motion.div>
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {historyModalOperator && (
          <OperatorHistoryModal
            operatorId={historyModalOperator.id}
            operatorName={historyModalOperator.name}
            onClose={() => setHistoryModalOperator(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function OperatorHistoryModal({
  operatorId,
  operatorName,
  onClose,
}: {
  operatorId: string;
  operatorName: string;
  onClose: () => void;
}) {
  const { tenant } = useChat();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");

  useEffect(() => {
    const fetchHistory = async () => {
      if (DEMO_MODE) {
        // Gerar histórico simulado de 10 dias consistentes com o operador
        const mockHistory = Array.from({ length: 10 }).map((_, idx) => {
          const d = new Date();
          d.setDate(d.getDate() - idx);
          const dateString = d.toISOString().split("T")[0];
          
          const charSum = operatorName.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
          const score = Math.max(50, Math.min(100, 82 + ((charSum + idx * 7) % 21) - 10));
          const respSeconds = Math.max(45, 210 + ((charSum * (idx + 1)) % 320) - 120);
          const respFormatted = respSeconds >= 60 
            ? `${Math.floor(respSeconds / 60)}min ${respSeconds % 60}s` 
            : `${respSeconds}s`;
          const totalConversations = Math.max(2, 6 + ((charSum + idx) % 12));
          const overdueCount = (charSum + idx) % 4 === 0 ? 1 : 0;
          const satisfiedPct = Math.max(55, Math.min(100, 84 + ((charSum - idx * 4) % 18)));

          return {
            id: `hist-${idx}`,
            date: dateString,
            totalConversations,
            avgResponseTimeFormatted: respFormatted,
            overdueCount,
            avgPerformanceScore: score,
            satisfiedPct,
          };
        });
        setHistory(mockHistory);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/gestao/operator-history?operatorId=${operatorId}&tenantId=${tenant}`);
        if (res.ok) {
          const data = await res.json();
          setHistory(data);
        }
      } catch (e) {
        console.error("Erro ao buscar histórico:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [operatorId, tenant, operatorName]);

  // Filtragem por data
  const filteredHistory = history.filter((item) => {
    if (!filterDate) return true;
    return item.date.includes(filterDate);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-card w-full max-w-3xl rounded-2xl border border-border shadow-soft flex flex-col max-h-[85vh] overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b border-line flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-foreground">Histórico Completo</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Métricas diárias consolidadas de {operatorName}</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filter Bar */}
        <div className="p-4 bg-muted/20 border-b border-line flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filtrar por data (Ex: 2026-07)..."
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          {filterDate && (
            <button
              onClick={() => setFilterDate("")}
              className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
            >
              Limpar
            </button>
          )}
          <div className="ml-auto text-xs text-muted-foreground">
            {filteredHistory.length} dia(s) encontrado(s)
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Carregando logs históricos...</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <ClipboardCheck className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="font-semibold text-sm">Nenhum registro encontrado</p>
              <p className="text-xs mt-1">Tente ajustar o filtro de busca ou data.</p>
            </div>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/40 border-b border-border font-bold text-muted-foreground">
                    <th className="p-3">Data</th>
                    <th className="p-3 text-center">Atendimentos</th>
                    <th className="p-3">T. Médio Resposta</th>
                    <th className="p-3 text-center">Atrasados</th>
                    <th className="p-3 text-center">Score IA</th>
                    <th className="p-3 text-center">Sentimento Satisf.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredHistory.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-semibold text-foreground">{row.date}</td>
                      <td className="p-3 text-center font-medium text-foreground">{row.totalConversations}</td>
                      <td className="p-3 font-medium text-foreground">{row.avgResponseTimeFormatted}</td>
                      <td className={`p-3 text-center font-bold ${row.overdueCount > 0 ? "text-primary" : "text-foreground"}`}>
                        {row.overdueCount}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                          row.avgPerformanceScore >= 75 ? "text-primary bg-primary/10 border border-primary/20" :
                          "text-muted-foreground bg-muted border border-border"
                        }`}>
                          {row.avgPerformanceScore ?? "–"}
                        </span>
                      </td>
                      <td className="p-3 text-center font-bold text-foreground">
                        <span className="inline-flex items-center gap-1 justify-center">
                          <span>{row.satisfiedPct}%</span>
                          <Smile className="h-3 w-3 text-primary" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
