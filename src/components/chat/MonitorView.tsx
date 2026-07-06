import React, { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  Eye, AlertTriangle, Clock, Users, TrendingUp, TrendingDown,
  RefreshCw, ChevronRight, Minus, CheckCircle, XCircle,
  MessageSquare, BarChart2, FileText, Bell, Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Tipos ───────────────────────────────────────────────────────────────────
type MonitorTab = "overview" | "alerts" | "operators" | "audits" | "reports";

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
  onSwitchTab,
}: {
  overview: OverviewData | null;
  alerts: AlertItem[];
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

      {/* Auditorias Feed Placeholder */}
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
        <div className="flex items-center justify-center py-10 text-muted-foreground gap-3">
          <Zap className="h-5 w-5 text-primary/40" />
          <span className="text-sm">
            Aguardando configuração da API de IA para gerar auditorias automáticas
          </span>
        </div>
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
  const { tenant, operatorProfile } = useChat();
  const [activeTab, setActiveTab] = useState<MonitorTab>("overview");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchData = useCallback(async () => {
    try {
      const [ovRes, alRes] = await Promise.all([
        fetch(`/api/gestao/overview?tenantId=${tenant}`),
        fetch(`/api/gestao/alerts?tenantId=${tenant}`),
      ]);
      if (ovRes.ok) setOverview(await ovRes.json());
      if (alRes.ok) setAlerts(await alRes.json());
      setLastRefresh(new Date());
    } catch (e) {
      console.error("[MonitorView] Erro ao buscar dados:", e);
    } finally {
      setLoadingAlerts(false);
    }
  }, [tenant]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000); // Auto-refresh 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const tabs: { id: MonitorTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "overview", label: "Visão Geral", icon: Eye },
    { id: "alerts", label: "Alertas", icon: Bell, badge: alerts.filter((a) => a.isOverdue).length },
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
                onSwitchTab={setActiveTab}
              />
            )}
            {activeTab === "alerts" && (
              <AlertsTab alerts={alerts} loading={loadingAlerts} />
            )}
            {activeTab === "operators" && (
              <OperatorsTab overview={overview} />
            )}
            {activeTab === "audits" && (
              <PlaceholderTab
                icon={Zap}
                title="Auditorias IA em breve"
                description="Configure a GOOGLE_AI_API_KEY e defina o playbook de vendas para ativar as auditorias automáticas de todos os atendimentos."
              />
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
