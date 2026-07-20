import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import React, { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  Eye, AlertTriangle, Clock, Users, TrendingUp, TrendingDown,
  RefreshCw, ChevronRight, Minus, CheckCircle, XCircle,
  MessageSquare, BarChart2, Bell, Zap, FlaskConical,
  Activity, Search, ClipboardCheck, ChevronLeft, Phone,
  Mail, Calendar, CheckCircle2, Circle, ExternalLink,
  Loader2, X, Filter
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MOCK_OVERVIEW, MOCK_ALERTS, MOCK_AUDITS, MOCK_LIVE, LiveOperator, LiveConversation } from "@/lib/monitor-mock-data";
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
const DEMO_MODE = true;

// ── Tipos ───────────────────────────────────────────────────────────────────
type MonitorTab = "overview" | "live" | "alerts" | "operators" | "audits" | "tasks";

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
  overdueCount: number;
  avgPerformanceScore: number | null;
  avgPerformanceScoreLastWeek: number | null;
  avgPerformanceScoreLastMonth: number | null;
  satisfiedCount: number;
  neutralCount: number;
  frustratedCount: number;
  trafficLight: "green" | "yellow" | "red";
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
function TrafficDot({ light }: { light: "green" | "yellow" | "red" }) {
  const colors = {
    green: "bg-emerald-500",
    yellow: "bg-amber-400",
    red: "bg-red-500",
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
    score >= 75 ? "text-emerald-600 bg-emerald-50" :
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

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const sizes = { sm: "h-7 w-7 text-[10px]", md: "h-9 w-9 text-xs", lg: "h-11 w-11 text-sm" };
  return (
    <div className={`${sizes[size]} rounded-full bg-primary/15 text-primary font-extrabold flex items-center justify-center shrink-0`}>
      {initials}
    </div>
  );
}

// ── Sub-views ────────────────────────────────────────────────────────────────

function OverviewTab({
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
      color: overview.overdueAlerts > 0 ? "text-red-600 bg-red-50" : "text-emerald-600 bg-emerald-50",
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
                  <Avatar name={op.operatorName} size="sm" />
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
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-xl transition shadow-sm hover:shadow-soft"
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

function OperatorsTab({ overview }: { overview: OverviewData | null }) {
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

        return (
          <motion.div
            key={op.operatorId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-card rounded-2xl border border-border shadow-soft p-6 flex flex-col md:grid md:grid-cols-12 md:items-center justify-between gap-6"
          >
            {/* Coluna 1: Informações do Operador */}
            <div className="flex items-center gap-4 w-full md:col-span-3">
              <Avatar name={op.operatorName} size="lg" />
              <div>
                <div className="flex items-center gap-2.5">
                  <p className="font-extrabold text-foreground text-base">{op.operatorName}</p>
                  <TrafficDot light={op.trafficLight} />
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    op.trafficLight === "green" ? "bg-emerald-50 text-emerald-700" :
                    op.trafficLight === "yellow" ? "bg-amber-50 text-amber-700" :
                    "bg-red-50 text-red-700"
                  }`}>
                    {op.trafficLight === "green" ? "No ritmo" :
                     op.trafficLight === "yellow" ? "Atenção" : "Lento"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {op.totalConversations} atendimento{op.totalConversations !== 1 ? "s" : ""} hoje
                </p>
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

            {/* Coluna 3: Métricas */}
            <div className="grid grid-cols-3 gap-6 w-full text-center md:col-span-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Tempo Médio
                </p>
                <p className="text-sm font-black text-foreground">{op.avgResponseTimeFormatted}</p>
              </div>
              <div className="border-x border-line px-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Atrasados
                </p>
                <p className={`text-sm font-black ${op.overdueCount > 0 ? "text-red-600 animate-pulse" : "text-foreground"}`}>
                  {op.overdueCount}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Sentimento
                </p>
                {total > 0 ? (
                  <p className="text-sm font-black text-foreground">
                    {satisfiedPct}% 😊
                  </p>
                ) : (
                  <p className="text-sm font-black text-muted-foreground">–</p>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function AuditsTab({ audits, loading }: { audits: AuditItem[]; loading: boolean }) {
  const [selected, setSelected] = useState<AuditItem | null>(null);

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
            onClick={() => setSelected(audit)}
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
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 mb-2">✅ Pontos Fortes</p>
                  <p className="text-xs text-emerald-900 leading-relaxed">{selected.strengths}</p>
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

function LiveTab() {
  const [selectedConvId, setSelectedConvId] = useState<string>("lconv-001");
  const [searchTerm, setSearchTerm] = useState("");

  const operators = MOCK_LIVE as LiveOperator[];
  
  let selectedConv: any = null;
  let selectedOpName = "";
  
  for (const op of operators) {
    const found = op.conversations.find((c: LiveConversation) => c.id === selectedConvId);
    if (found) {
      selectedConv = found;
      selectedOpName = op.operatorName;
      break;
    }
  }

  if (!selectedConv && operators.length > 0 && operators[0].conversations.length > 0) {
    selectedConv = operators[0].conversations[0];
    selectedOpName = operators[0].operatorName;
  }

  return (
    <div className="flex h-full min-h-[500px] divide-x divide-line rounded-2xl border border-border overflow-hidden bg-card">
      {/* Sidebar de Operadores e Conversas */}
      <div className="w-80 flex flex-col min-h-0 bg-muted/10 shrink-0">
        <div className="p-3 border-b border-line shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar operador ou cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-muted/60 border border-border rounded-xl pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-4">
          {operators.map((op: LiveOperator) => {
            const filteredConvs = op.conversations.filter((c: LiveConversation) => 
              c.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
              op.operatorName.toLowerCase().includes(searchTerm.toLowerCase())
            );

            if (filteredConvs.length === 0 && searchTerm) return null;

            return (
              <div key={op.operatorId} className="space-y-1.5">
                {/* Cabeçalho do Operador */}
                <div className="flex items-center justify-between px-2 py-1 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${
                      op.status === "disponivel" ? "bg-emerald-500" :
                      op.status === "ocupado" ? "bg-amber-500" :
                      "bg-slate-400"
                    }`} />
                    <span className="text-xs font-bold text-foreground">{op.operatorName}</span>
                  </div>
                  <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full uppercase ${
                    op.status === "disponivel" ? "text-emerald-700 bg-emerald-50" :
                    op.status === "ocupado" ? "text-amber-700 bg-amber-50" :
                    "text-slate-600 bg-slate-100"
                  }`}>
                    {op.status === "disponivel" ? "Livre" : op.status === "ocupado" ? "Ocupado" : "Pausa"}
                  </span>
                </div>

                {/* Lista de Conversas do Operador */}
                <div className="space-y-1 pl-2">
                  {filteredConvs.map((conv: LiveConversation) => {
                    const isSelected = conv.id === selectedConvId;
                    return (
                      <button
                        key={conv.id}
                        onClick={() => setSelectedConvId(conv.id)}
                        className={`w-full text-left p-2.5 rounded-xl transition flex flex-col gap-1 cursor-pointer border ${
                          isSelected 
                            ? "bg-primary text-primary-foreground border-primary" 
                            : "bg-card border-border hover:bg-muted/40 text-foreground"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold truncate pr-2">{conv.contactName}</span>
                          {conv.isUnanswered && (
                            <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md ${
                              isSelected ? "bg-white/20 text-white" : "bg-red-50 text-red-600 border border-red-100 animate-pulse"
                            }`}>
                              Aguardando {conv.waitingMinutes}m
                            </span>
                          )}
                        </div>
                        <p className={`text-[10px] truncate ${isSelected ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                          {conv.lastMessage}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Janela de Conversa em Tempo Real */}
      <div className="flex-1 flex flex-col min-h-0 bg-muted/5">
        {selectedConv ? (
          <>
            {/* Header da Conversa */}
            <div className="px-5 py-3 border-b border-line bg-card flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Avatar name={selectedConv.contactName} size="md" />
                <div>
                  <h3 className="text-xs font-extrabold text-foreground">{selectedConv.contactName}</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {selectedConv.contactPhone} · Operador: <span className="font-semibold text-foreground">{selectedOpName}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                AO VIVO
              </div>
            </div>

            {/* Balões de Mensagem */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-3 bg-slate-50/30">
              {selectedConv.messages.map((msg: any) => {
                const isAgent = msg.sender === "agent";
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isAgent ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 shadow-soft text-xs leading-relaxed ${
                      isAgent
                        ? "bg-primary text-primary-foreground rounded-tr-none"
                        : "bg-card text-foreground border border-border rounded-tl-none"
                    }`}>
                      <p>{msg.text}</p>
                      <span className={`text-[8px] block text-right mt-1.5 select-none ${
                        isAgent ? "text-primary-foreground/60" : "text-muted-foreground/60"
                      }`}>
                        {msg.time}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer de Modo Supervisor */}
            <div className="px-5 py-2.5 border-t border-line bg-card flex items-center justify-between shrink-0 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Modo Supervisor: Espiando chat em tempo real
              </div>
              <div className="text-[9px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-lg">
                Somente Visualização
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <MessageSquare className="h-8 w-8 opacity-30" />
            <span className="text-xs">Nenhum atendimento ativo selecionado</span>
          </div>
        )}
      </div>
    </div>
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

// ── Componente Principal ─────────────────────────────────────────────────────
export function MonitorView() {
  const { tenant } = useChat();
  const [activeTab, setActiveTab] = useState<MonitorTab>("overview");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [loadingAudits, setLoadingAudits] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

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
    { id: "overview", label: "Visão Geral", icon: Eye },
    { id: "live", label: "Ao Vivo", icon: Activity, badge: DEMO_MODE ? 4 : undefined },
    { id: "alerts", label: "Alertas", icon: Bell, badge: alerts.filter((a: AlertItem) => a.isOverdue).length },
    { id: "operators", label: "Operadores", icon: Users },
    { id: "audits", label: "Auditorias IA", icon: Zap },
    { id: "tasks", label: "Tarefas Globais", icon: ClipboardCheck },
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
            {activeTab === "overview" && (
              <OverviewTab
                overview={overview}
                alerts={alerts}
                audits={audits}
                onSwitchTab={setActiveTab}
              />
            )}
            {activeTab === "live" && (
              <LiveTab />
            )}
            {activeTab === "alerts" && (
              <AlertsTab alerts={alerts} loading={loadingAlerts} />
            )}
            {activeTab === "operators" && (
              <OperatorsTab overview={overview} />
            )}
            {activeTab === "audits" && (
              <AuditsTab audits={audits} loading={loadingAudits} />
            )}
            {activeTab === "tasks" && (
              <GlobalTasksTab />
            )}


          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
