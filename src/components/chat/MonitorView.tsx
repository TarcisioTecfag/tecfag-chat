import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import React, { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  Eye, AlertTriangle, Clock, Users, TrendingUp, TrendingDown,
  RefreshCw, ChevronRight, Minus, CheckCircle, XCircle,
  MessageSquare, BarChart2, Bell, Zap, FlaskConical,
  Activity, Search, ClipboardCheck, ChevronLeft, Phone,
  Mail, Calendar, CheckCircle2, Circle, ExternalLink,
  Loader2, X, Filter, Coins, DollarSign, Cpu, Layers, Bot, Sparkles, ShieldCheck,
  Play, Volume2, FileText, Radio, ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MOCK_LIVE, LiveOperator, LiveConversation, LiveData, LiveMessage } from "@/lib/monitor-mock-data";
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
// 🧪 DEMO MODE — troque para false para usar dados reais da API
// ══════════════════════════════════════════════════════════════════════════════
const DEMO_MODE = false;

// ── Tipos ───────────────────────────────────────────────────────────────────
type MonitorTab = "live" | "alerts" | "operators" | "audits" | "tasks";

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

type AlertItem = {
  logId: string;
  conversationId: string;
  contactName: string;
  contactPhone: string | null;
  operatorName: string;
  waitingMinutes: number;
  waitingSeconds: number;
  isOverdue: boolean;
  isCritical: boolean;
  alertType?: "sla" | "conflict";
  lastMessagePreview?: string;
  crmCardUrl?: string | null;
  conversationStartedAt?: string;
};

type AuditItem = {
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
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function TrafficDot({ light }: { light: "green" | "yellow" | "red" | "gray" }) {
  const colors = {
    green: "bg-primary",
    yellow: "bg-amber-400",
    red: "bg-red-500",
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
    score >= 75 ? "text-primary bg-primary/10" :
    score >= 50 ? "text-amber-600 bg-amber-50" :
    "text-red-600 bg-red-50";
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
    if (score >= 75) return `greenGrad-${uuid}`;
    if (score >= 50) return `yellowGrad-${uuid}`;
    return `redGrad-${uuid}`;
  };
  
  const color =
    score >= 75 ? "#10b981" :
    score >= 50 ? "#f59e0b" :
    "#ef4444";
    
  const fontSizeClass = isSmall ? "text-[13px]" : "text-[18px]";
  const indicatorRadius = isSmall ? 4.5 : 6;
  const indicatorStroke = isSmall ? 2 : 3;
    
  return (
    <div className="relative flex flex-col items-center justify-center shrink-0" style={{ width: size, height: size * 0.62 }}>
      <svg viewBox="0 0 100 52" className="w-full h-full overflow-visible">
        <defs>
          {/* Definições de Gradientes Lineares Premium */}
          <linearGradient id={`greenGrad-${uuid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#059669" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <linearGradient id={`yellowGrad-${uuid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d97706" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
          <linearGradient id={`redGrad-${uuid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#dc2626" />
            <stop offset="100%" stopColor="#f87171" />
          </linearGradient>
          
          {/* Sombra de Glow para o arco e indicador */}
          <filter id={`shadowGlow-${uuid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={color} floodOpacity="0.4" />
          </filter>
        </defs>
        
        {/* Arco de fundo (trilho cinza) */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="text-muted/15"
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
            fill="#ffffff"
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
    ? "text-red-600 bg-red-50 border border-red-200"
    : minutes >= 10
    ? "text-amber-600 bg-amber-50 border border-amber-200"
    : "text-muted-foreground bg-muted";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${color}`}>
      <Clock className="h-3 w-3" />
      {minutes < 60 ? `${minutes}min` : `${Math.floor(minutes / 60)}h${minutes % 60}m`}
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
      <img
        src={avatar}
        alt={name}
        title={name}
        className={`${sizes[size]} rounded-full object-cover shrink-0 border border-border`}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className={`${sizes[size]} rounded-full bg-primary/15 text-primary font-extrabold flex items-center justify-center shrink-0`} title={name}>
      {initials}
    </div>
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

  // Função utilitária para converter "2min 45s" ou similar em minutos decimais
  const parseTimeToMinutes = (timeStr: string): number => {
    if (!timeStr) return 0;
    const minMatch = timeStr.match(/(\d+)\s*(?:min|m)/i);
    const secMatch = timeStr.match(/(\d+)\s*(?:s)/i);
    const min = minMatch ? parseInt(minMatch[1], 10) : 0;
    const sec = secMatch ? parseInt(secMatch[1], 10) : 0;
    return Number((min + sec / 60).toFixed(2));
  };

  // 1. Dados do gráfico de performance e tempo de resposta da equipe
  const chartDataEquipe = overview.operators.map((op) => ({
    name: op.operatorName.split(" ")[0] + (op.operatorName.split(" ")[1] ? " " + op.operatorName.split(" ")[1][0] + "." : ""),
    score: op.avgPerformanceScore || 0,
    tmr: parseTimeToMinutes(op.avgResponseTimeFormatted),
  }));

  // 2. Dados do gráfico de alertas críticos
  const chartDataAlertas = alerts.slice(0, 6).map((al) => ({
    cliente: al.contactName,
    espera: Number((al.waitingMinutes + al.waitingSeconds / 60).toFixed(1)),
  }));

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
      color: overview.overdueAlerts > 0 ? "text-red-600 bg-red-50" : "text-primary bg-primary/10",
      pulse: overview.overdueAlerts > 0,
    },
    {
      label: "Tempo Médio Hoje",
      value: overview.avgResponseTimeFormatted,
      icon: Clock,
      color: "text-slate-600 bg-slate-100",
      isText: true,
    },
    {
      label: "Score da Equipe",
      value: overview.teamPerformanceScore !== null ? `${overview.teamPerformanceScore}/100` : "–",
      icon: BarChart2,
      color: "text-violet-600 bg-violet-50",
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
                <YAxis yAxisId="right" orientation="right" stroke="#ef4444" fontSize={10} tickLine={false} unit="m" />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: "var(--card)", borderColor: "var(--border)", borderRadius: "12px", fontSize: "11px" }}
                />
                <Legend verticalAlign="top" height={36} iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                <Bar yAxisId="left" dataKey="score" name="Score de Qualidade" fill="var(--primary)" radius={[4, 4, 0, 0]} barSize={16} />
                <Line yAxisId="right" type="monotone" dataKey="tmr" name="TMR Médio (min)" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
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
                <CheckCircle className="h-6 w-6 text-emerald-400" />
                <span className="text-xs">Fila zerada no momento</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartDataAlertas} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} unit=" min" />
                  <YAxis dataKey="cliente" type="category" stroke="var(--muted-foreground)" fontSize={9} tickLine={false} width={80} />
                  <RechartsTooltip contentStyle={{ backgroundColor: "var(--card)", borderColor: "var(--border)", borderRadius: "12px", fontSize: "11px" }} />
                  <Bar dataKey="espera" name="Minutos de Espera" radius={[0, 4, 4, 0]} barSize={10}>
                    {chartDataAlertas.map((entry, index) => {
                      const color = entry.espera >= 20 ? "#dc2626" : entry.espera >= 15 ? "#f97316" : "#f59e0b";
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
      <div className="grid grid-cols-5 gap-4 min-h-0">
        {/* Critical Alerts */}
        <div className="col-span-3 bg-card rounded-2xl border border-border shadow-soft flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
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
                <CheckCircle className="h-8 w-8 text-emerald-400" />
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
                    <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
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
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                    audit.clientSentiment === "satisfeito" ? "text-emerald-700 bg-emerald-50" :
                    audit.clientSentiment === "frustrado" ? "text-red-700 bg-red-50" :
                    "text-amber-700 bg-amber-50"
                  }`}>
                    {audit.clientSentiment === "satisfeito" ? "😊" : audit.clientSentiment === "frustrado" ? "😤" : "😐"}
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

function AlertsTab({ alerts, loading }: { alerts: AlertItem[]; loading: boolean }) {
  const { setActiveView, setSelectedChatId } = useChat();

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1">
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-20 text-muted-foreground gap-3">
          <CheckCircle className="h-12 w-12 text-emerald-400" />
          <p className="font-semibold text-base">Tudo em dia!</p>
          <p className="text-sm">Nenhum cliente aguardando resposta agora.</p>
        </div>
      ) : (
        alerts.map((alert) => {
          const isConflict = alert.alertType === "conflict";
          
          return (
            <div
              key={alert.logId}
              className={`bg-card rounded-2xl border shadow-soft p-5 flex flex-col gap-4 transition-all hover:border-muted-foreground/20 ${
                alert.isCritical 
                  ? "border-red-200 bg-red-50/10" 
                  : isConflict 
                  ? "border-amber-200 bg-amber-50/10" 
                  : "border-border"
              }`}
            >
              {/* Header: Status + Informações do Cliente + SLA */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Avatar name={alert.contactName} size="md" />
                  <div>
                    <div className="flex items-center flex-wrap gap-2">
                      <p className="text-sm font-bold text-foreground">{alert.contactName}</p>
                      {alert.isCritical && (
                        <span className="text-[10px] font-extrabold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md border border-red-200">
                          CRÍTICO
                        </span>
                      )}
                      
                      {/* Tipo de Alerta */}
                      {isConflict ? (
                        <span className="text-[10px] font-extrabold text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Conflito Detectado (I.A.)
                        </span>
                      ) : (
                        <span className="text-[10px] font-extrabold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                          <Clock className="h-3 w-3 shrink-0" />
                          Tempo de Resposta (SLA)
                        </span>
                      )}
                    </div>
                    {alert.contactPhone && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {alert.contactPhone}
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Tempo de Espera */}
                <WaitBadge minutes={alert.waitingMinutes} isCritical={alert.isCritical} />
              </div>

              {/* Informações Auxiliares (Operador e Início) */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-line/50 pt-3">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-[10px] uppercase tracking-wider">Operador:</span>
                  <span className="text-foreground font-medium">{alert.operatorName}</span>
                </div>
                {alert.conversationStartedAt && (
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-[10px] uppercase tracking-wider">Início:</span>
                    <span className="text-foreground font-medium">{alert.conversationStartedAt}</span>
                  </div>
                )}
              </div>

              {/* Balão de Chat Simulado */}
              {alert.lastMessagePreview && (
                <div className="flex flex-col gap-1 mt-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground ml-2">Última Mensagem do Cliente</span>
                  <div className={`rounded-xl p-3 text-sm relative max-w-[85%] border self-start ${
                    isConflict 
                      ? "bg-red-50/40 text-red-950 border-red-100" 
                      : "bg-muted/50 text-foreground border-border"
                  }`}>
                    {/* Seta do balão de chat (estilo WhatsApp) */}
                    <div className={`absolute top-3 -left-[6px] w-3 h-3 rotate-45 border-l border-b ${
                      isConflict 
                        ? "bg-red-50/40 border-red-100" 
                        : "bg-muted/50 border-border"
                    }`} style={{ borderTopColor: 'transparent', borderRightColor: 'transparent' }} />
                    <p className="font-medium relative z-10 break-words leading-relaxed select-text">
                      "{alert.lastMessagePreview}"
                    </p>
                  </div>
                </div>
              )}

              {/* Ações */}
              <div className="flex items-center gap-2 mt-2 border-t border-line/50 pt-3">
                <button
                  onClick={() => {
                    setActiveView("chat");
                    setSelectedChatId(alert.conversationId);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-primary-foreground bg-primary hover:bg-primary/90 px-4 py-2 rounded-xl transition shadow-sm hover:shadow-soft"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Abrir Conversa
                </button>
                
                {alert.crmCardUrl ? (
                  <a
                    href={alert.crmCardUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-foreground bg-secondary hover:bg-secondary-hover border border-border px-4 py-2 rounded-xl transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Ver no CRM (RD)
                  </a>
                ) : (
                  <button
                    disabled
                    title="Nenhum card do CRM vinculado a este contato"
                    className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-muted-foreground bg-muted cursor-not-allowed border border-line px-4 py-2 rounded-xl opacity-60"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    CRM Indisponível
                  </button>
                )}
              </div>
            </div>
          );
        })
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
                    op.trafficLight === "yellow" ? "bg-amber-50 text-amber-700 border border-amber-100" :
                    op.trafficLight === "red" ? "bg-red-50 text-red-700 border border-red-100" :
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
                <span className={`font-bold text-xs ${op.overdueCount > 0 ? "text-red-600 font-extrabold animate-pulse" : "text-foreground"}`}>{op.overdueCount}</span>
                <span className="font-bold text-foreground text-xs">{satisfiedPct}% 😊</span>
              </div>
              
              {/* Row 2: vs Semana */}
              <div className="col-span-3 grid grid-cols-3 items-center py-1 hover:bg-muted/30 rounded-md text-muted-foreground">
                <span className="text-[11px] font-medium" title="Média da Semana">{op.avgResponseTimeLastWeekFormatted || "–"}</span>
                <span className="text-[11px] font-medium">{op.overdueCountLastWeek ?? 0}</span>
                <span className="text-[11px] font-medium">{op.satisfiedPctLastWeek ?? 0}% 😊</span>
              </div>
              
              {/* Row 3: vs Mês */}
              <div className="col-span-3 grid grid-cols-3 items-center py-1 hover:bg-muted/30 rounded-md text-muted-foreground">
                <span className="text-[11px] font-medium" title="Média do Mês">{op.avgResponseTimeLastMonthFormatted || "–"}</span>
                <span className="text-[11px] font-medium">{op.overdueCountLastMonth ?? 0}</span>
                <span className="text-[11px] font-medium">{op.satisfiedPctLastMonth ?? 0}% 😊</span>
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
                              <div className="text-red-700 bg-red-50/50 dark:bg-red-950/10 px-2 py-1 rounded border border-red-100/50">
                                <span className="font-extrabold uppercase text-[9px] tracking-wider block mb-0.5 text-red-800">Pontos a Melhorar:</span>
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

function AuditsTab({ 
  audits, 
  loading, 
  selectedAuditId, 
  onSelectAudit 
}: { 
  audits: AuditItem[]; 
  loading: boolean; 
  selectedAuditId?: string | null;
  onSelectAudit?: (id: string | null) => void;
}) {
  const [selected, setSelected] = useState<AuditItem | null>(null);

  useEffect(() => {
    if (selectedAuditId) {
      const found = audits.find((a) => a.id === selectedAuditId);
      if (found) {
        setSelected(found);
      }
    }
  }, [selectedAuditId, audits]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  if (audits.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Zap className="h-8 w-8 text-primary/50" />
        </div>
        <div className="text-center max-w-sm">
          <p className="font-bold text-foreground mb-1">Nenhuma auditoria ainda</p>
          <p className="text-sm">As auditorias aparecem automaticamente quando atendimentos são finalizados.</p>
        </div>
      </div>
    );
  }

  const sentimentEmoji: Record<string, string> = {
    satisfeito: "😊",
    neutro: "😐",
    frustrado: "😞",
  };

  return (
    <div className="flex gap-4 h-full overflow-hidden">
      {/* Lista */}
      <div className="w-64 shrink-0 flex flex-col gap-2 overflow-y-auto scrollbar-thin pr-1">
        {audits.map((audit) => (
          <button
            key={audit.id}
            onClick={() => {
              setSelected(audit);
              if (onSelectAudit) onSelectAudit(audit.id);
            }}
            className={`w-full text-left p-3.5 rounded-2xl border transition cursor-pointer ${
              selected?.id === audit.id
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-foreground truncate">
                {audit.contactName ?? "Desconhecido"}
              </span>
              <ScoreBadge score={audit.performanceScore} />
            </div>
            <p className="text-[10px] text-muted-foreground truncate">{audit.operatorName}</p>
            <div className="flex items-center gap-1 mt-2">
              <span className="text-sm">{sentimentEmoji[audit.clientSentiment ?? ""] ?? "–"}</span>
              {audit.flagCount > 0 && (
                <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-md">
                  {audit.flagCount} falha{audit.flagCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Detalhe */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Selecione uma auditoria para ver o detalhe
          </div>
        ) : (
          <motion.div
            key={selected.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-extrabold text-foreground text-base">
                  {selected.contactName ?? "Desconhecido"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Atendente: {selected.operatorName}
                  {selected.auditedAt && ` · ${new Date(selected.auditedAt).toLocaleDateString("pt-BR")}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{sentimentEmoji[selected.clientSentiment ?? ""] ?? "–"}</span>
                <ScoreBadge score={selected.performanceScore} />
              </div>
            </div>

            {/* Insight Acionável */}
            {selected.actionableInsight && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 mb-1">⚡ Insight da IA para agir agora</p>
                <p className="text-sm font-semibold text-amber-900">{selected.actionableInsight}</p>
              </div>
            )}

            {/* Flags */}
            {selected.flagCount > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {selected.hadLongResponseGap && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <Clock className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-xs font-semibold text-red-700">Demora excessiva</span>
                  </div>
                )}
                {selected.hadMissedObjection && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-xs font-semibold text-red-700">Objeção ignorada</span>
                  </div>
                )}
                {selected.hadRudeLanguage && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-xs font-semibold text-red-700">Linguagem inadequada</span>
                  </div>
                )}
                {selected.hadNoFollowUp && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <Minus className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-xs font-semibold text-red-700">Sem próximo passo</span>
                  </div>
                )}
              </div>
            )}

            {/* Resumo */}
            {selected.summary && (
              <div className="bg-card border border-border rounded-2xl p-4">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-2">Resumo</p>
                <p className="text-sm text-foreground leading-relaxed">{selected.summary}</p>
              </div>
            )}

            {/* Pontos Fortes e Fracos */}
            <div className="grid grid-cols-2 gap-3">
              {selected.strengths && (
                <div className="bg-primary/5 border border-primary/15 rounded-2xl p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-primary mb-2">✅ Pontos Fortes</p>
                  <p className="text-xs text-foreground/80 leading-relaxed">{selected.strengths}</p>
                </div>
              )}
              {selected.weaknesses && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-red-700 mb-2">❌ Falhas</p>
                  <p className="text-xs text-red-900 leading-relaxed">{selected.weaknesses}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
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
  operators: { operatorId: string; operatorName: string; status: string }[];
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

  const options = [{ operatorId: "", operatorName: "Todos", status: "" }, ...operators];

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
        <Users className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left truncate">{selectedName}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 bg-card border border-border rounded-2xl shadow-xl py-1.5 min-w-full max-h-48 overflow-y-auto scrollbar-thin">
          {options.map((op) => {
            const isActive = op.operatorId === value;
            return (
              <button
                key={op.operatorId}
                onClick={() => { onChange(op.operatorId); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[11px] text-left transition cursor-pointer ${
                  isActive
                    ? "bg-primary/10 text-primary font-bold"
                    : "text-foreground hover:bg-muted/60"
                }`}
              >
                {op.operatorId && (
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    op.status === "disponivel" ? "bg-primary" :
                    op.status === "ocupado" ? "bg-amber-500" : "bg-muted-foreground/40"
                  }`} />
                )}
                {!op.operatorId && <Users className="h-3 w-3 text-muted-foreground" />}
                <span className="truncate">{op.operatorName}</span>
                {isActive && <CheckCircle2 className="h-3.5 w-3.5 ml-auto text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LiveTab ──────────────────────────────────────────────────────────────────

const LIVE_BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

/**
 * Renderiza o conteúdo de uma mensagem ao vivo:
 * - Suporta texto puro
 * - Suporta [MEDIA:type]messageId:caption
 * - Notas internas ficam em amarelo
 */
function LiveMessageBubble({ msg, isAgent }: { msg: LiveMessage; isAgent: boolean }) {
  const content = msg.content || "";

  // Detecta padrão [MEDIA:type]messageId
  const mediaMatch = content.match(/^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::(.+))?$/);

  const bubbleCls = `max-w-[72%] rounded-2xl px-3.5 py-2 shadow-sm text-xs leading-relaxed ${
    msg.isInternalNote
      ? "bg-amber-50 border border-amber-200 text-amber-900 italic"
      : isAgent
      ? "bg-primary text-primary-foreground rounded-tr-none"
      : "bg-card text-foreground border border-border rounded-tl-none"
  }`;

  const timeCls = `text-[9px] block text-right mt-1 select-none ${
    isAgent ? "text-primary-foreground/60" : "text-muted-foreground/60"
  }`;

  const timeStr = msg.sentAt
    ? new Date(msg.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";

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
            className="max-h-52 w-full object-contain rounded-xl cursor-pointer hover:opacity-90 transition"
          />
        </a>
      );
    } else if (mediaType === "video") {
      mediaEl = (
        <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="relative block">
          <video
            src={mediaUrl}
            className="max-h-52 w-full object-contain rounded-xl pointer-events-none"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-xl">
            <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center shadow">
              <Play className="h-5 w-5 fill-slate-800 ml-0.5" />
            </div>
          </div>
        </a>
      );
    } else if (mediaType === "audio") {
      mediaEl = (
        <div className="flex items-center gap-2 py-1">
          <Volume2 className="h-4 w-4 shrink-0" />
          <audio controls src={mediaUrl} className="h-7 w-44" />
        </div>
      );
    } else if (mediaType === "document") {
      const fileName = caption || "documento";
      mediaEl = (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 hover:underline"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="text-[11px] truncate max-w-[150px]">{fileName}</span>
        </a>
      );
    } else {
      mediaEl = (
        <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="underline text-[11px]">
          Mídia
        </a>
      );
    }

    return (
      <div className={`flex ${isAgent ? "justify-end" : "justify-start"}`}>
        <div className={bubbleCls}>
          {mediaEl}
          {caption && <p className="mt-1 text-[11px]">{caption}</p>}
          <span className={timeCls}>{timeStr} · {msg.senderName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isAgent ? "justify-end" : "justify-start"}`}>
      <div className={bubbleCls}>
        <p className="whitespace-pre-wrap break-words">{content}</p>
        <span className={timeCls}>{timeStr} · {msg.senderName}</span>
      </div>
    </div>
  );
}

function LiveTab({ demoMode }: { demoMode: boolean }) {
  const { tenant, setSelectedChatId, setActiveView } = useChat();

  // Estado principal
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Conversa selecionada
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  // Modal de confirmação para conversas da Valentina
  const [valentinaPending, setValentinaPending] = useState<LiveConversation | null>(null);

  // Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");          // YYYY-MM-DD
  const [opIdFilter, setOpIdFilter] = useState("");          // operatorId

  // Histórico completo (carregado sob demanda)
  const [fullHistory, setFullHistory] = useState<LiveMessage[]>([]);
  const [fullHistoryLoading, setFullHistoryLoading] = useState(false);
  const [fullHistoryConvId, setFullHistoryConvId] = useState<string | null>(null);

  // Quando a conversa muda, limpa histórico completo
  useEffect(() => {
    setFullHistory([]);
    setFullHistoryConvId(null);
  }, [selectedConvId]);

  const loadFullHistory = useCallback(async (convId: string) => {
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
  }, [tenant, demoMode]);

  // Fetch de dados com filtros
  const fetchLive = useCallback(async () => {
    if (demoMode) {
      setLiveData({ operators: MOCK_LIVE as LiveOperator[], unassigned: [], automation: [] });
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

  // Encontrar conversa selecionada em qualquer seção
  const allConvs = [
    ...(liveData?.operators.flatMap((op) => op.conversations) ?? []),
    ...(liveData?.unassigned ?? []),
  ];
  const selectedConv = allConvs.find((c) => c.id === selectedConvId) ?? null;
  const selectedOpName = liveData?.operators.find((op) =>
    op.conversations.some((c) => c.id === selectedConvId)
  )?.operatorName ?? null;

  // Filtro de busca local (aplicado na sidebar apenas)
  const searchLower = searchTerm.toLowerCase();
  const matchesSearch = (c: LiveConversation) =>
    !searchTerm ||
    c.contactName.toLowerCase().includes(searchLower) ||
    c.contactPhone.includes(searchTerm);

  // Lista de operadores disponíveis para o dropdown
  const allOperators = liveData?.operators ?? [];

  // Ref para auto-scroll do chat
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedConvId, selectedConv?.messages?.length]);

  // ── Renderização ────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-[500px] divide-x divide-line rounded-2xl border border-border overflow-hidden bg-card">

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <div className="w-80 flex flex-col min-h-0 bg-muted/10 shrink-0">

        {/* Barra de busca */}
        <div className="p-3 border-b border-line shrink-0 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nome ou número..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-muted/60 border border-border rounded-xl pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
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

          {/* Filtros ativos */}
          {(dateFilter || opIdFilter) && (
            <div className="flex items-center gap-1 flex-wrap">
              {dateFilter && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                  {new Date(dateFilter).toLocaleDateString("pt-BR")}
                  <button onClick={() => setDateFilter("")}><X className="h-2.5 w-2.5" /></button>
                </span>
              )}
              {opIdFilter && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                  {allOperators.find((o) => o.operatorId === opIdFilter)?.operatorName ?? "Operador"}
                  <button onClick={() => setOpIdFilter("")}><X className="h-2.5 w-2.5" /></button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Lista de conversas agrupadas */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground/40" />
            </div>
          )}

          {/* ── Seção: Na Fila (sem operador) ─────────────────────────────── */}
          {!loading && !opIdFilter && (liveData?.unassigned.filter(matchesSearch).length ?? 0) > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 px-2 py-1">
                <Clock className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-[10px] font-extrabold text-amber-600 uppercase tracking-wider">
                  Na Fila · {liveData!.unassigned.filter(matchesSearch).length}
                </span>
              </div>
              {liveData!.unassigned.filter(matchesSearch).map((conv) => (
                <LiveConvCard
                  key={conv.id}
                  conv={conv}
                  isSelected={conv.id === selectedConvId}
                  onClick={() => setSelectedConvId(conv.id)}
                />
              ))}
            </div>
          )}

          {/* ── Seção: Com Valentina (automação) ──────────────────────────── */}
          {!loading && !opIdFilter && (liveData?.automation.filter(matchesSearch).length ?? 0) > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 px-2 py-1">
                <Bot className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] font-extrabold text-primary uppercase tracking-wider">
                  Com Valentina · {liveData!.automation.filter(matchesSearch).length}
                </span>
              </div>
              {liveData!.automation.filter(matchesSearch).map((conv) => (
                <LiveConvCard
                  key={conv.id}
                  conv={conv}
                  isSelected={false}
                  locked
                  onClick={() => setValentinaPending(conv)}
                />
              ))}
            </div>
          )}

          {/* ── Seção: Operadores ─────────────────────────────────────────── */}
          {!loading && allOperators
            .filter((op) => opIdFilter ? op.operatorId === opIdFilter : true)
            .map((op) => {
              const filtered = op.conversations.filter(matchesSearch);
              if (filtered.length === 0 && searchTerm) return null;
              return (
                <div key={op.operatorId} className="space-y-1">
                  <div className="flex items-center justify-between px-2 py-1 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${
                        op.status === "disponivel" ? "bg-primary" :
                        op.status === "ocupado" ? "bg-amber-500" :
                        "bg-slate-400"
                      }`} />
                      <span className="text-[11px] font-bold text-foreground truncate max-w-[120px]">{op.operatorName}</span>
                    </div>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full uppercase ${
                      op.status === "disponivel" ? "text-primary bg-primary/10" :
                      op.status === "ocupado" ? "text-amber-700 bg-amber-50" :
                      "text-slate-600 bg-slate-100"
                    }`}>
                      {op.conversations.length} atend.
                    </span>
                  </div>
                  {filtered.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground pl-4 italic">Sem conversas ativas</p>
                  ) : (
                    filtered.map((conv) => (
                      <LiveConvCard
                        key={conv.id}
                        conv={conv}
                        isSelected={conv.id === selectedConvId}
                        onClick={() => setSelectedConvId(conv.id)}
                      />
                    ))
                  )}
                </div>
              );
            })
          }

          {!loading && !liveData?.operators.length && !liveData?.unassigned.length && !liveData?.automation.length && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <Radio className="h-8 w-8 opacity-20" />
              <span className="text-xs">Nenhum atendimento ativo agora</span>
            </div>
          )}
        </div>

        {/* Rodapé com timestamp de atualização */}
        {lastUpdated && (
          <div className="px-3 py-2 border-t border-line shrink-0 flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
            </span>
            <span className="text-[9px] text-muted-foreground">
              Atualizado às {lastUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        )}
      </div>

      {/* ── ÁREA PRINCIPAL: Chat em Tempo Real ──────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 bg-muted/5">
        {selectedConv ? (
          <>
            {/* Header da conversa */}
            <div className="px-5 py-3 border-b border-line bg-card flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Avatar name={selectedConv.contactName} size="md" />
                <div>
                  <h3 className="text-xs font-extrabold text-foreground">{selectedConv.contactName}</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {selectedConv.contactPhone}
                    {selectedOpName && (
                      <> · Operador: <span className="font-semibold text-foreground">{selectedOpName}</span></>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Botão Abrir Conversa */}
                <button
                  onClick={() => {
                    setSelectedChatId(selectedConv.id);
                    setActiveView("chat");
                  }}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/15 border border-primary/20 px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Abrir Conversa
                </button>
                {/* Badge AO VIVO */}
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-red-50 border border-red-100 text-red-600 text-[10px] font-bold">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                  </span>
                  AO VIVO
                </div>
              </div>
            </div>

            {/* Balões de Mensagem com suporte a mídia */}
            <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col">

              {/* Banner de carregar histórico completo */}
              {selectedConv.messages.length > 0 && fullHistoryConvId !== selectedConvId && (
                <div className="px-5 pt-4 pb-2 shrink-0">
                  <button
                    onClick={() => loadFullHistory(selectedConvId!)}
                    disabled={fullHistoryLoading}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-border bg-muted/30 hover:bg-muted/60 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer disabled:opacity-50 disabled:cursor-default"
                  >
                    {fullHistoryLoading ? (
                      <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando histórico...</>
                    ) : (
                      <><Clock className="h-3.5 w-3.5" /> Carregar histórico completo ({selectedConv.messages.length} recentes)
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Mensagens: histórico completo OU últimas 50 */}
              <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-2">
                {selectedConv.messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                    <MessageSquare className="h-8 w-8 opacity-20" />
                    <span className="text-xs">Nenhuma mensagem ainda</span>
                  </div>
                ) : (
                  (fullHistoryConvId === selectedConvId ? fullHistory : selectedConv.messages).map((msg) => {
                    const isAgent = msg.senderType === "agent" || msg.senderType === "bot";
                    return <LiveMessageBubble key={msg.id} msg={msg} isAgent={isAgent} />;
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Footer Modo Supervisor */}
            <div className="px-5 py-2.5 border-t border-line bg-card flex items-center justify-between shrink-0 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                {fullHistoryConvId === selectedConvId ? (
                  <>
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-amber-600 font-semibold">
                      Histórico completo · {fullHistory.length} mensagens
                    </span>
                  </>
                ) : (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                    </span>
                    Modo Supervisor · Espiando chat em tempo real
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {fullHistoryConvId === selectedConvId && (
                  <button
                    onClick={() => { setFullHistory([]); setFullHistoryConvId(null); }}
                    className="text-[9px] font-semibold text-primary bg-primary/10 hover:bg-primary/15 px-2 py-0.5 rounded-lg transition cursor-pointer"
                  >
                    Voltar ao vivo
                  </button>
                )}
                <div className="text-[9px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-lg">
                  Somente Visualização
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Eye className="h-8 w-8 text-primary/40" />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-foreground">Selecione um atendimento</p>
              <p className="text-xs mt-1">Clique em uma conversa na lista para espiá-la em tempo real</p>
            </div>
          </div>
        )}
      </div>

      {/* ── MODAL: Confirmação para ver atendimento da Valentina ─────────────── */}
      <AnimatePresence>
        {valentinaPending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setValentinaPending(null)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl shadow-xl p-7 max-w-sm w-full mx-4 flex flex-col gap-5"
            >
              {/* Ícone */}
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Bot className="h-7 w-7 text-primary" />
                </div>
                <h3 className="text-base font-black text-foreground leading-snug">
                  Atendimento em Triagem
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">{valentinaPending.contactName}</strong> está em triagem com a Valentina SDR.
                  <br />
                  Gostaria de ver esse atendimento?
                </p>
              </div>

              {/* Ações */}
              <div className="flex gap-3">
                <button
                  onClick={() => setValentinaPending(null)}
                  className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    setSelectedChatId(valentinaPending.id);
                    setActiveView("valentina");
                    setValentinaPending(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition cursor-pointer"
                >
                  Ver na Valentina
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Card de conversa na sidebar */
function LiveConvCard({
  conv,
  isSelected,
  onClick,
  locked = false,
}: {
  conv: LiveConversation;
  isSelected: boolean;
  onClick: () => void;
  locked?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-2.5 rounded-xl transition flex flex-col gap-1 cursor-pointer border relative ${
        isSelected
          ? "bg-primary text-primary-foreground border-primary"
          : locked
          ? "bg-muted/30 border-border hover:bg-muted/50 text-foreground opacity-80"
          : "bg-card border-border hover:bg-muted/40 text-foreground"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-bold truncate pr-1">{conv.contactName}</span>
        <div className="flex items-center gap-1 shrink-0">
          {locked && (
            <Bot className={`h-3 w-3 ${isSelected ? "text-primary-foreground/80" : "text-primary"}`} />
          )}
          {conv.isUnanswered && (
            <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md ${
              isSelected ? "bg-white/20 text-white" : "bg-red-50 text-red-600 border border-red-100 animate-pulse"
            }`}>
              {conv.waitingMinutes}m
            </span>
          )}
        </div>
      </div>
      <p className={`text-[10px] truncate ${
        isSelected ? "text-primary-foreground/75" : "text-muted-foreground"
      }`}>
        {conv.lastMessage}
      </p>
    </button>
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

// ── GlobalTasksTab ───────────────────────────────────────────────────────────

interface GlobalTaskData {
  id: string;
  name: string;
  type: string;
  status: string;
  dueDate: string | null;
  description: string | null;
  createdAt: string | null;
  deal: { id: string; name: string | null } | null;
  client: { name: string | null; phone: string | null };
  chatContactId: string | null;
  chatConversationId: string | null;
  operatorEmail: string | null;
  operatorName: string;
  operatorAvatar: string | null;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Preencher dias anteriores
  const startDay = firstDay.getDay();
  for (let i = startDay - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }

  // Dias do mês
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }

  // Preencher dias seguintes
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push(new Date(year, month + 1, i));
  }

  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getTaskTypeIcon(type: string) {
  switch (type) {
    case "call": return <Phone className="h-3.5 w-3.5" />;
    case "email": return <Mail className="h-3.5 w-3.5" />;
    case "meeting": return <Users className="h-3.5 w-3.5" />;
    case "whatsapp": return <MessageSquare className="h-3.5 w-3.5" />;
    default: return <ClipboardCheck className="h-3.5 w-3.5" />;
  }
}

function getTaskTypeColor(type: string): string {
  switch (type) {
    case "whatsapp": return "#128c7e";
    default: return "var(--primary)";
  }
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

function GlobalTasksTab() {
  const { tenant, setSelectedChatId, setActiveView } = useChat();

  const [tasks, setTasks] = useState<GlobalTaskData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados do Modal "Todos" (Filtro e Busca global)
  const [isAllTasksModalOpen, setIsAllTasksModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "completed">("all");
  const [dateFilter, setDateFilter] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("all");

  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date>(today);

  const days = getDaysInMonth(currentYear, currentMonth);

  // ─── Fetch tasks from local API ─────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gestao/tasks?tenantId=${tenant}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setTasks([]);
      } else {
        setTasks(data.tasks || []);
      }
    } catch (e: any) {
      setError(e.message || "Erro ao carregar tarefas globais");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  // Fetch on mount
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // ─── Task completion toggle ─────────────────────────────────────────────
  const toggleTaskStatus = async (task: GlobalTaskData) => {
    const newStatus = task.status === "done" ? "pending" : "done";
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t))
    );
    try {
      await fetch("/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant, taskId: task.id, status: newStatus }),
      });
    } catch {
      // Revert on error
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t))
      );
    }
  };

  // ─── Open chat for a task ───────────────────────────────────────────────
  const openChat = (task: GlobalTaskData) => {
    if (task.chatConversationId) {
      setSelectedChatId(task.chatConversationId);
      setActiveView("chat");
    }
  };

  // ─── Navigation ─────────────────────────────────────────────────────────
  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const goToday = () => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
    setSelectedDate(today);
  };

  // ─── Filter tasks for selected date ─────────────────────────────────────
  const getTasksForDate = (date: Date) =>
    tasks.filter((t) => {
      if (!t.dueDate) return false;
      return isSameDay(new Date(t.dueDate), date);
    });

  // Operadores únicos da lista geral para preencher o filtro
  const uniqueOperatorsList = Array.from(
    new Map(
      tasks
        .filter((t) => t.operatorEmail)
        .map((t) => [t.operatorEmail, t.operatorName])
    ).entries()
  ).map(([email, name]) => ({ email, name }));

  // Aplica filtro de operador na lista diária
  const selectedTasks = getTasksForDate(selectedDate).filter((t) => {
    if (operatorFilter !== "all" && t.operatorEmail !== operatorFilter) {
      return false;
    }
    return true;
  });

  const pendingCount = tasks.filter((t) => t.status !== "done").length;

  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
      {/* Header interno de Filtros */}
      <div className="flex flex-col md:flex-row items-center justify-between border-b border-border pb-4 mb-4 gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-foreground flex items-center gap-2">
            <ClipboardCheck className="h-4.5 w-4.5 text-primary" />
            Tarefas Globais da Operação
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {pendingCount > 0 ? `${pendingCount} tarefa${pendingCount > 1 ? "s" : ""} pendente${pendingCount > 1 ? "s" : ""}` : "Nenhuma tarefa pendente"}
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          {/* Seletor de Operador */}
          <select
            value={operatorFilter}
            onChange={(e) => setOperatorFilter(e.target.value)}
            className="h-9 rounded-xl bg-card border border-border px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer max-w-[180px]"
          >
            <option value="all">Todos Operadores</option>
            {uniqueOperatorsList.map((op) => (
              <option key={op.email} value={op.email || ""}>
                {op.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setIsAllTasksModalOpen(true)}
            className="rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-all hover:bg-muted/50 flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Filter className="h-3.5 w-3.5" />
            Todos
          </button>
          <button
            onClick={goToday}
            className="rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-all hover:bg-muted/50 cursor-pointer shrink-0"
          >
            Hoje
          </button>
          <button
            onClick={fetchTasks}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white transition-all disabled:opacity-60 cursor-pointer bg-primary shrink-0"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Atualizar
          </button>
        </div>
      </div>

      {/* Content Grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Calendar */}
        <div className="flex-1 flex flex-col overflow-auto border-r border-border pr-4">
          {/* Month Navigation */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="rounded-xl p-1.5 hover:bg-muted transition-colors cursor-pointer border border-border bg-card">
              <ChevronLeft className="h-4.5 w-4.5 text-foreground" />
            </button>
            <h3 className="text-sm font-bold text-foreground">
              {MONTHS[currentMonth]} {currentYear}
            </h3>
            <button onClick={nextMonth} className="rounded-xl p-1.5 hover:bg-muted transition-colors cursor-pointer border border-border bg-card">
              <ChevronRight className="h-4.5 w-4.5 text-foreground" />
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1.5 mb-2 border-b border-border pb-2 bg-muted/20 dark:bg-muted/5 rounded-xl px-2 py-1 shadow-xs">
            {WEEKDAYS.map((day) => (
              <div key={day} className="text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground/85">
                {day}
              </div>
            ))}
          </div>

          {/* Day Grid */}
          <div className="grid grid-cols-7 gap-1.5 flex-1 min-h-[380px]">
            {days.map((date, i) => {
              const isCurrentMonth = date.getMonth() === currentMonth;
              const isToday = isSameDay(date, today);
              const isSelected = isSameDay(date, selectedDate);
              
              // Filtra tarefas globais por dia (independentemente do filtro de operador na barra)
              const dayTasks = getTasksForDate(date);
              
              // Agrupa operadores únicos para este dia
              const uniqueOpsMap = new Map<string, { name: string; avatar: string | null }>();
              for (const t of dayTasks) {
                const email = t.operatorEmail || "";
                if (!uniqueOpsMap.has(email)) {
                  uniqueOpsMap.set(email, { name: t.operatorName, avatar: t.operatorAvatar });
                }
              }
              const uniqueOps = Array.from(uniqueOpsMap.values());

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(date)}
                  className="relative flex flex-col items-center justify-start rounded-xl p-1.5 transition-all min-h-[70px] border w-full overflow-hidden cursor-pointer"
                  style={{
                    background: isSelected
                      ? "var(--primary)"
                      : isToday
                        ? "var(--primary-soft)"
                        : "var(--card)",
                    borderColor: isSelected
                      ? "var(--primary)"
                      : isToday
                        ? "var(--primary-soft)"
                        : "var(--border)",
                    color: isSelected
                      ? "white"
                      : isCurrentMonth
                        ? "var(--foreground)"
                        : "var(--muted-foreground)",
                    opacity: isCurrentMonth ? 1 : 0.45,
                    borderWidth: isToday && !isSelected ? "2px" : "1px",
                  }}
                >
                  <span className={`text-[11px] font-bold ${isSelected ? "text-white" : "text-foreground/80"} mb-1`}>
                    {date.getDate()}
                  </span>

                  {/* Fotos dos operadores com tarefas no dia */}
                  {uniqueOps.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-0.5 mt-1 w-full max-w-full">
                      {uniqueOps.slice(0, 3).map((op, j) => {
                        const initials = op.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
                        return (
                          <div
                            key={j}
                            className="relative h-5 w-5 rounded-full border border-card flex items-center justify-center text-[7px] font-extrabold shadow-sm shrink-0"
                            style={{
                              background: isSelected ? "rgba(255,255,255,0.2)" : "var(--primary-soft)",
                              color: isSelected ? "white" : "var(--primary)",
                            }}
                            title={op.name}
                          >
                            {op.avatar ? (
                              <img
                                src={op.avatar}
                                alt={op.name}
                                className="h-full w-full rounded-full object-cover"
                              />
                            ) : (
                              <span>{initials}</span>
                            )}
                          </div>
                        );
                      })}
                      {uniqueOps.length > 3 && (
                        <span
                          className={`text-[8px] font-bold ml-0.5 shrink-0 ${
                            isSelected ? "text-white/80" : "text-muted-foreground"
                          }`}
                        >
                          +{uniqueOps.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Task Details Panel */}
        <div className="w-[320px] flex flex-col overflow-hidden shrink-0 pl-4">
          <div className="pb-3 border-b border-border mb-3">
            <h4 className="text-xs font-bold text-foreground">
              {selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </h4>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {selectedTasks.length === 0 ? "Nenhuma tarefa" : `${selectedTasks.length} tarefa${selectedTasks.length > 1 ? "s" : ""}`}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
            {error && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {selectedTasks.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                <Calendar className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <p className="text-xs">Nenhuma tarefa para esta data</p>
              </div>
            )}

            {selectedTasks.map((task) => (
              <div
                key={task.id}
                className="group rounded-xl border border-border bg-card p-3.5 transition-all hover:shadow-sm hover:border-primary/30"
                style={{
                  borderLeft: `3px solid ${getTaskTypeColor(task.type)}`,
                }}
              >
                {/* Task Header */}
                <div className="flex items-start gap-2.5">
                  <button
                    onClick={() => toggleTaskStatus(task)}
                    className="mt-0.5 shrink-0 cursor-pointer"
                  >
                    {task.status === "done" ? (
                      <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
                    ) : (
                      <Circle className="h-4.5 w-4.5 text-muted-foreground hover:text-foreground transition-colors" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-xs font-bold leading-tight ${
                        task.status === "done" ? "line-through text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {task.name}
                    </p>

                    {/* Type & Time */}
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white"
                        style={{ background: getTaskTypeColor(task.type) }}
                      >
                        {getTaskTypeIcon(task.type)}
                        {task.type}
                      </span>
                      {task.dueDate && (() => {
                        const isOverdue = task.status !== "done" && new Date(task.dueDate) < new Date();
                        return (
                          <span className={`flex items-center gap-0.5 text-[10px] ${isOverdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                            <Clock className="h-2.5 w-2.5" />
                            {formatTime(task.dueDate)} {isOverdue && "(Atrasada)"}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* Operator Assigned */}
                <div className="mt-2.5 flex items-center gap-2 bg-muted/40 dark:bg-muted/10 rounded-lg p-2 border border-border/30">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[8px] font-extrabold shrink-0">
                    {task.operatorAvatar ? (
                      <img
                        src={task.operatorAvatar}
                        alt={task.operatorName}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <span>{task.operatorName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-muted-foreground">Responsável</p>
                    <p className="text-xs font-semibold text-foreground truncate leading-tight">{task.operatorName}</p>
                  </div>
                </div>

                {/* Client Info */}
                {(task.client.name || task.client.phone) && (
                  <div className="mt-2.5 rounded-lg bg-background/50 p-2 border border-border/20">
                    {task.client.name && (
                      <p className="text-[10px] font-bold text-foreground truncate">{task.client.name}</p>
                    )}
                    {task.client.phone && (
                      <p className="text-[9px] text-muted-foreground mt-0.5">{formatPhone(task.client.phone)}</p>
                    )}
                  </div>
                )}

                {/* Deal Info */}
                {task.deal?.name && (
                  <div className="mt-2 flex items-center gap-1 text-[9px] text-muted-foreground">
                    <ExternalLink className="h-2.5 w-2.5" />
                    <span className="truncate">{task.deal.name}</span>
                  </div>
                )}

                {/* Description */}
                {task.description && (
                  <p className="mt-2 text-[10px] text-muted-foreground leading-normal line-clamp-2">
                    {task.description}
                  </p>
                )}

                {/* Action Button */}
                {task.chatConversationId ? (
                  <button
                    onClick={() => openChat(task)}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[10px] font-bold text-white bg-primary cursor-pointer shadow-xs hover:opacity-90 transition-opacity"
                  >
                    <MessageSquare className="h-3 w-3" />
                    Abrir Atendimento
                  </button>
                ) : (
                  <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-[9px] text-muted-foreground select-none">
                    <MessageSquare className="h-3 w-3" />
                    Sem conversa ativa
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MODAL: TODAS AS TAREFAS (LISTA GLOBAL) */}
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
              className="w-full max-w-3xl rounded-3xl bg-card border border-border shadow-card flex flex-col max-h-[90vh] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-line px-6 py-4.5">
                <div>
                  <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                    Lista Completa de Tarefas
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Visualize e filtre todas as tarefas cadastradas no sistema.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsAllTasksModalOpen(false);
                    setSearchQuery("");
                    setStatusFilter("all");
                    setDateFilter("");
                    setOperatorFilter("all");
                  }}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              {/* Filters Bar */}
              <div className="p-6 border-b border-line bg-background/30 flex flex-wrap md:flex-nowrap gap-4 items-center">
                {/* Search Input */}
                <div className="relative w-full md:flex-1">
                  <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Pesquisar por título ou cliente..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 w-full rounded-xl bg-muted pl-10 pr-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Operator Selector */}
                <select
                  value={operatorFilter}
                  onChange={(e) => setOperatorFilter(e.target.value)}
                  className="h-10 rounded-xl bg-muted px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent cursor-pointer w-full md:w-44 shrink-0"
                >
                  <option value="all">Todos Operadores</option>
                  {uniqueOperatorsList.map((op) => (
                    <option key={op.email} value={op.email || ""}>
                      {op.name}
                    </option>
                  ))}
                </select>

                {/* Status Toggle */}
                <div className="flex bg-muted rounded-xl p-1 shrink-0 w-full md:w-auto">
                  {(["all", "open", "completed"] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() => setStatusFilter(status)}
                      className={`flex-1 md:flex-initial px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                        statusFilter === status
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {status === "all" ? "Todas" : status === "open" ? "Em aberto" : "Concluídas"}
                    </button>
                  ))}
                </div>

                {/* Date Filter */}
                <div className="relative w-full md:w-40 shrink-0">
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="h-10 w-full rounded-xl bg-muted px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent cursor-pointer"
                  />
                  {dateFilter && (
                    <button
                      onClick={() => setDateFilter("")}
                      className="absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Tasks List */}
              <div className="flex-1 overflow-y-auto p-6 bg-background/10 space-y-3 scrollbar-thin">
                {(() => {
                  const filtered = tasks.filter((t) => {
                    if (searchQuery.trim()) {
                      const q = searchQuery.toLowerCase().trim();
                      const matchName = t.name.toLowerCase().includes(q);
                      const matchDesc = t.description?.toLowerCase().includes(q) || false;
                      const matchClient = t.client.name?.toLowerCase().includes(q) || false;
                      if (!matchName && !matchDesc && !matchClient) return false;
                    }
                    if (statusFilter === "open") {
                      if (t.status === "done" || t.status === "completed") return false;
                    } else if (statusFilter === "completed") {
                      if (t.status !== "done" && t.status !== "completed") return false;
                    }
                    if (dateFilter) {
                      if (!t.dueDate) return false;
                      const localDateStr = new Date(t.dueDate).toLocaleDateString("sv-SE");
                      if (localDateStr !== dateFilter) return false;
                    }
                    if (operatorFilter !== "all" && t.operatorEmail !== operatorFilter) {
                      return false;
                    }
                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Filter className="h-12 w-12 text-muted-foreground/30 mb-3" />
                        <p className="text-sm font-semibold text-muted-foreground">Nenhuma tarefa encontrada</p>
                        <p className="text-xs text-muted-foreground/80 mt-1">Experimente ajustar os filtros ou pesquisar outro termo.</p>
                      </div>
                    );
                  }

                  return filtered.map((task) => {
                    const isOverdue = task.status !== "done" && task.dueDate && new Date(task.dueDate) < new Date();
                    return (
                      <div
                        key={task.id}
                        className="rounded-2xl border border-border bg-card p-4 transition-all hover:shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4"
                        style={{ borderLeft: `3.5px solid ${getTaskTypeColor(task.type)}` }}
                      >
                        {/* Task Title & Time Info */}
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <button
                            onClick={() => toggleTaskStatus(task)}
                            className="mt-0.5 shrink-0 cursor-pointer"
                          >
                            {task.status === "done" || task.status === "completed" ? (
                              <CheckCircle2 className="h-5 w-5" style={{ color: "var(--primary)" }} />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm font-semibold leading-tight ${
                                task.status === "done" || task.status === "completed"
                                  ? "line-through text-muted-foreground"
                                  : "text-foreground"
                              }`}
                            >
                              {task.name}
                            </p>

                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              <span
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
                                style={{ background: getTaskTypeColor(task.type) }}
                              >
                                {getTaskTypeIcon(task.type)}
                                {task.type}
                              </span>
                              {task.dueDate && (
                                <span className={`flex items-center gap-1 text-[11px] ${isOverdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                                  <Clock className="h-3 w-3" />
                                  {new Date(task.dueDate).toLocaleDateString("pt-BR")} às {formatTime(task.dueDate)}
                                  {isOverdue && " (Atrasada)"}
                                </span>
                              )}
                              <span className="text-[11px] text-muted-foreground font-medium">
                                · Responsável: <span className="text-foreground">{task.operatorName}</span>
                              </span>
                            </div>

                            {task.description && (
                              <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-1 leading-relaxed">
                                {task.description}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Client Info & Action Button */}
                        <div className="flex items-center gap-4 shrink-0">
                          {(task.client.name || task.client.phone) && (
                            <div className="text-right hidden sm:block">
                              {task.client.name && (
                                <p className="text-xs font-semibold text-foreground">{task.client.name}</p>
                              )}
                              {task.client.phone && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">{formatPhone(task.client.phone)}</p>
                              )}
                            </div>
                          )}

                          {task.chatConversationId ? (
                            <button
                              onClick={() => {
                                openChat(task);
                                setIsAllTasksModalOpen(false);
                              }}
                              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all cursor-pointer shadow-sm bg-primary"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              Atendimento
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-2 text-xs text-muted-foreground select-none">
                              <MessageSquare className="h-3.5 w-3.5" />
                              Sem Chat
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Aba de Custos & Telemetria Vertex AI ─────────────────────────────────────
export function CostsTab({ tenant }: { tenant: string }) {
  const [period, setPeriod] = useState<"today" | "7d" | "30d">("7d");
  const [featureFilter, setFeatureFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  const fetchCosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gestao/costs?tenantId=${tenant}&period=${period}&feature=${featureFilter}&model=${modelFilter}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("[CostsTab] Erro ao buscar custos:", e);
    } finally {
      setLoading(false);
    }
  }, [tenant, period, featureFilter, modelFilter]);

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

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
    return (
      log.feature?.toLowerCase().includes(q) ||
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
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold border border-amber-500/20">
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
              onClick={() => setPeriod("today")}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                period === "today" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Hoje
            </button>
            <button
              onClick={() => setPeriod("7d")}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                period === "7d" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              7 Dias
            </button>
            <button
              onClick={() => setPeriod("30d")}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                period === "30d" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              30 Dias
            </button>
          </div>

          <select
            value={featureFilter}
            onChange={(e) => setFeatureFilter(e.target.value)}
            className="bg-card text-foreground text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-line outline-none focus:border-primary transition cursor-pointer"
          >
            <option value="all">Todas Funcionalidades</option>
            <option value="sdr_agent">SDR Bot (Triagem)</option>
            <option value="conversation_audit">Auditoria QA</option>
            <option value="supervisor_chat">Valentina Chat</option>
            <option value="sla_advisor">Análise SLA</option>
          </select>

          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="bg-card text-foreground text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-line outline-none focus:border-primary transition cursor-pointer"
          >
            <option value="all">Todos os Modelos</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
          </select>

          <button
            onClick={fetchCosts}
            className="p-1.5 bg-card border border-line rounded-xl text-muted-foreground hover:text-primary transition cursor-pointer"
            title="Atualizar custos"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
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
            <div className="p-1.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-foreground tracking-tight">
              {(summary.totalTokens / 1_000_000).toFixed(2)} M
              <span className="text-xs font-normal text-muted-foreground ml-1">tokens</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-semibold mt-1">
              <span className="text-blue-600 dark:text-blue-400">Prompt: {(summary.promptTokens / 1_000_000).toFixed(2)}M</span>
              <span>•</span>
              <span className="text-indigo-600 dark:text-indigo-400">Resp: {(summary.completionTokens / 1000).toFixed(0)}k</span>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Requisições à IA</span>
            <div className="p-1.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Bot className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-foreground tracking-tight">
              {summary.totalCalls}
              <span className="text-xs font-normal text-muted-foreground ml-1">chamadas</span>
            </div>
            <p className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold mt-1 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Sucesso: {summary.totalCalls > 0 ? ((summary.successCount / summary.totalCalls) * 100).toFixed(1) : 100}%
            </p>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-4 border border-line shadow-soft flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Custo Médio / Interação</span>
            <div className="p-1.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <BarChart2 className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-foreground tracking-tight">
              R$ {summary.avgCostPerCallBrl.toFixed(3)}
            </div>
            <p className="text-[11px] text-muted-foreground font-semibold mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3 text-amber-500" />
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
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="dateFormatted" tick={{ fontSize: 10 }} stroke="#888888" />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="#888888" tickFormatter={(v) => `R$${v}`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="#888888" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "rgba(15, 23, 42, 0.9)", borderColor: "#334155", borderRadius: "12px", color: "#fff", fontSize: "11px" }}
                    formatter={(value: any, name: any) => {
                      if (name === "Custo (R$)") return [`R$ ${Number(value).toFixed(2)}`, name];
                      if (name === "Tokens") return [`${Number(value).toLocaleString()} tokens`, name];
                      return [value, name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "5px" }} />
                  <Bar yAxisId="left" dataKey="costBrl" name="Custo (R$)" fill="#10b981" radius={[6, 6, 0, 0]} barSize={22} />
                  <Line yAxisId="right" type="monotone" dataKey="tokens" name="Tokens" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
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
              Garante transparência nos custos por triagem, auditoria de qualidade e supervisão.
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
                          log.feature === "sdr_agent" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20" :
                          log.feature === "conversation_audit" ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20" :
                          log.feature === "supervisor_chat" ? "bg-primary/10 text-primary border border-primary/20" :
                          "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                        }`}>
                          {log.feature === "sdr_agent" ? "SDR Bot" : log.feature === "conversation_audit" ? "Auditoria QA" : log.feature === "supervisor_chat" ? "Valentina Chat" : "SLA Engine"}
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
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-extrabold">
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

// ── Componente Principal ─────────────────────────────────────────────────────
export function MonitorView() {
  const { tenant } = useChat();
  const [activeTab, setActiveTab] = useState<MonitorTab>("live");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [loadingAudits, setLoadingAudits] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [historyModalOperator, setHistoryModalOperator] = useState<{ id: string; name: string } | null>(null);

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
        fetch(`/api/gestao/alerts?tenantId=${tenant}`),
        fetch(`/api/gestao/audits?tenantId=${tenant}&limit=50`),
      ]);
      if (ovRes.ok) setOverview(await ovRes.json());
      if (alRes.ok) setAlerts(await alRes.json());
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

  const tabs: { id: MonitorTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "live",      label: "Ao Vivo",        icon: Activity, badge: DEMO_MODE ? 4 : undefined },
    { id: "alerts",    label: "Alertas",         icon: Bell, badge: alerts.filter((a: AlertItem) => a.isOverdue).length },
    { id: "operators", label: "Operadores",      icon: Users },
    { id: "audits",    label: "Auditorias IA",   icon: Zap },
    { id: "tasks",     label: "Tarefas Globais", icon: ClipboardCheck },
  ];

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
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700 text-[10px] font-extrabold border border-amber-300 animate-pulse">
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
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-line bg-muted/30 shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={`ml-0.5 h-4 min-w-4 px-1 rounded-full text-[9px] font-extrabold flex items-center justify-center ${
                  isActive ? "bg-white/30 text-white" : "bg-red-500 text-white"
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden px-5 py-4 flex flex-col">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col flex-1 overflow-hidden"
          >
            {activeTab === "live" && (
              <LiveTab demoMode={DEMO_MODE} />
            )}
            {activeTab === "alerts" && (
              <AlertsTab alerts={alerts} loading={loadingAlerts} />
            )}
            {activeTab === "operators" && (
              <OperatorsTab 
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
                audits={audits} 
                loading={loadingAudits} 
                selectedAuditId={selectedAuditId}
                onSelectAudit={setSelectedAuditId}
              />
            )}
            {activeTab === "tasks" && (
              <GlobalTasksTab />
            )}


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
                      <td className={`p-3 text-center font-bold ${row.overdueCount > 0 ? "text-red-600" : "text-foreground"}`}>
                        {row.overdueCount}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                          row.avgPerformanceScore >= 75 ? "text-primary bg-primary/10 border border-primary/20" :
                          row.avgPerformanceScore >= 50 ? "text-amber-700 bg-amber-50 border border-amber-200" :
                          "text-red-700 bg-red-50 border border-red-200"
                        }`}>
                          {row.avgPerformanceScore ?? "–"}
                        </span>
                      </td>
                      <td className="p-3 text-center font-bold text-foreground">
                        {row.satisfiedPct}% 😊
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
