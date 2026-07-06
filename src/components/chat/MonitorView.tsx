import React, { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  Eye, AlertTriangle, Clock, Users, TrendingUp, TrendingDown,
  RefreshCw, ChevronRight, Minus, CheckCircle, XCircle,
  MessageSquare, BarChart2, FileText, Bell, Zap, FlaskConical,
  Activity, Search,
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
type MonitorTab = "overview" | "live" | "alerts" | "operators" | "audits" | "reports";

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
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto scrollbar-thin pr-1">
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-20 text-muted-foreground gap-3">
          <CheckCircle className="h-12 w-12 text-emerald-400" />
          <p className="font-semibold text-base">Tudo em dia!</p>
          <p className="text-sm">Nenhum cliente aguardando resposta agora.</p>
        </div>
      ) : (
        alerts.map((alert) => (
          <div
            key={alert.logId}
            className={`bg-card rounded-2xl border shadow-soft p-4 flex items-center gap-4 ${
              alert.isCritical ? "border-red-200" : "border-border"
            }`}
          >
            {alert.isCritical && (
              <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
            )}
            <Avatar name={alert.contactName} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-foreground">{alert.contactName}</p>
                {alert.isCritical && (
                  <span className="text-[10px] font-extrabold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md">
                    CRÍTICO
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Operador: <span className="font-semibold text-foreground">{alert.operatorName}</span>
                {alert.contactPhone && ` · ${alert.contactPhone}`}
              </p>
            </div>
            <WaitBadge minutes={alert.waitingMinutes} isCritical={alert.isCritical} />
          </div>
        ))
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
        const neutralPct = total > 0 ? Math.round((op.neutralCount / total) * 100) : 0;
        const frustratedPct = total > 0 ? Math.round((op.frustratedCount / total) * 100) : 0;

        return (
          <motion.div
            key={op.operatorId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-card rounded-2xl border border-border shadow-soft p-5"
          >
            <div className="flex items-center gap-4">
              <Avatar name={op.operatorName} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <p className="font-extrabold text-foreground">{op.operatorName}</p>
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
                <p className="text-xs text-muted-foreground mt-0.5">
                  {op.totalConversations} atendimento{op.totalConversations !== 1 ? "s" : ""} hoje
                </p>
              </div>
              <ScoreBadge score={op.avgPerformanceScore} />
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-line">
              <div className="text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Tempo Médio
                </p>
                <p className="text-sm font-extrabold text-foreground">{op.avgResponseTimeFormatted}</p>
              </div>
              <div className="text-center border-x border-line">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Atrasados
                </p>
                <p className={`text-sm font-extrabold ${op.overdueCount > 0 ? "text-red-600" : "text-foreground"}`}>
                  {op.overdueCount}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Sentimento
                </p>
                {total > 0 ? (
                  <p className="text-sm font-extrabold text-foreground">
                    {satisfiedPct}% 😊
                  </p>
                ) : (
                  <p className="text-sm font-extrabold text-muted-foreground">–</p>
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
    { id: "reports", label: "Relatórios", icon: FileText },
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
        <button
          onClick={fetchData}
          title="Atualizar agora"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </button>
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

            {activeTab === "reports" && (
              <PlaceholderTab
                icon={FileText}
                title="Relatórios automáticos em breve"
                description="Após a ativação das auditorias IA, relatórios diários e semanais serão gerados automaticamente e exibidos aqui."
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
