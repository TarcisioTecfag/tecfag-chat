// ══════════════════════════════════════════════════════════════════════════════
// 👁️ SUPERVISOR TAB — Analytics, timeline filtrada e perguntas recentes
// Filtros: período (hoje/ontem/7d/30d/custom) + tipo de alerta
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell, MessageSquare, AlertTriangle, ArrowRight,
  Clock, Eye, BarChart2, Send as SendIcon, Zap, Users,
  Loader2, Inbox, MessageCircleQuestion, Filter, Calendar,
  ExternalLink, Star, X,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";

// ── Tipos ───────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: string;
  title: string;
  description: string;
  operatorName: string;
  operatorId: string | null;
  timestamp: string;
  priority: string;
  conversationId: string | null;
  contactName: string | null;
}

interface RecentQuestion {
  id: string;
  question: string;
  operatorId: string;
  operatorName: string;
  operatorAvatar: string | null;
  timestamp: string;
}

interface SupervisorApiData {
  kpis: {
    notificationsSent: number;
    questionsAnswered: number;
    slaAlerts: number;
    leadsTransferred: number;
  };
  notifications: Notification[];
  recentQuestions: RecentQuestion[];
}

// ── Constantes ───────────────────────────────────────────────────────────────

const ALERT_TYPES = [
  { value: "all",               label: "Todos",          color: "bg-muted text-muted-foreground" },
  { value: "sla_alert",         label: "SLA",            color: "bg-amber-100 text-amber-700" },
  { value: "lead_transfer",     label: "Leads",          color: "bg-primary-soft text-primary" },
  { value: "sentiment_alert",   label: "Sentimento",     color: "bg-rose-100 text-rose-700" },
  { value: "operator_overload", label: "Sobrecarga",     color: "bg-violet-100 text-violet-700" },
  { value: "no_response",       label: "Sem Resposta",   color: "bg-orange-100 text-orange-700" },
  { value: "rating_received",   label: "Avaliações",     color: "bg-yellow-100 text-yellow-700" },
  { value: "daily_summary",     label: "Resumo",         color: "bg-sky-100 text-sky-700" },
] as const;

type QuickPeriod = "today" | "yesterday" | "7d" | "30d" | "custom";

const QUICK_PERIODS: { value: QuickPeriod; label: string }[] = [
  { value: "today",     label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "7d",        label: "7 dias" },
  { value: "30d",       label: "30 dias" },
  { value: "custom",    label: "Período" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDateRange(period: QuickPeriod, customFrom?: string, customTo?: string): { from: Date; to: Date } {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday   = new Date(now); endOfToday.setHours(23, 59, 59, 999);

  switch (period) {
    case "today":
      return { from: startOfToday, to: endOfToday };
    case "yesterday": {
      const y = new Date(startOfToday); y.setDate(y.getDate() - 1);
      const ye = new Date(y); ye.setHours(23, 59, 59, 999);
      return { from: y, to: ye };
    }
    case "7d":
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
    case "30d":
      return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };
    case "custom":
      return {
        from: customFrom ? new Date(customFrom + "T00:00:00") : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        to:   customTo   ? new Date(customTo   + "T23:59:59") : now,
      };
  }
}


function formatRelativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  });
}

function getOperatorInitials(name: string) {
  const parts = name.trim().split(" ");
  const initials = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  const colors = [
    "bg-violet-100 text-violet-700", "bg-sky-100 text-sky-700",
    "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return { initials: initials.toUpperCase(), color: colors[hash % colors.length] };
}

function getNotifIcon(type: string) {
  switch (type) {
    case "lead_transfer":     return { icon: ArrowRight,    color: "bg-primary-soft text-primary" };
    case "sla_alert":         return { icon: AlertTriangle, color: "bg-amber-100 text-amber-600" };
    case "no_response":       return { icon: Clock,         color: "bg-orange-100 text-orange-600" };
    case "daily_summary":     return { icon: BarChart2,     color: "bg-sky-100 text-sky-600" };
    case "sentiment_alert":   return { icon: Zap,           color: "bg-rose-100 text-rose-600" };
    case "operator_overload": return { icon: Users,         color: "bg-violet-100 text-violet-600" };
    case "rating_received":   return { icon: Star,          color: "bg-yellow-100 text-yellow-600" };
    default:                  return { icon: Bell,          color: "bg-muted text-muted-foreground" };
  }
}

function PriorityDot({ priority }: { priority: string }) {
  const c = priority === "high" ? "bg-red-500" : priority === "medium" ? "bg-amber-400" : "bg-gray-300";
  return <span className={`inline-block h-2 w-2 rounded-full ${c} ${priority === "high" ? "animate-pulse" : ""}`} />;
}

function KpiCard({ icon: Icon, label, value, accent, loading, active, onClick }: {
  icon: React.ElementType; label: string; value: string | number; accent: string; loading?: boolean;
  active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-card rounded-2xl border shadow-soft p-4 flex items-center gap-4 text-left w-full transition-all ${
        active
          ? "border-primary ring-2 ring-primary/20 scale-[1.02]"
          : onClick ? "border-border hover:border-primary/40 cursor-pointer" : "border-border cursor-default"
      }`}
    >
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${active ? "ring-2 ring-primary/30" : ""} ${accent}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        {loading ? (
          <div className="h-6 w-10 bg-muted rounded animate-pulse mt-1" />
        ) : (
          <p className={`text-lg font-extrabold ${active ? "text-primary" : "text-foreground"}`}>{value}</p>
        )}
      </div>
      {active && onClick && (
        <div className="ml-auto">
          <X className="h-3.5 w-3.5 text-primary opacity-60" />
        </div>
      )}
    </button>
  );
}

// ── Componente de Filtros da Timeline ────────────────────────────────────────

function TimelineFilters({
  period, onPeriodChange,
  customFrom, customTo, onCustomFromChange, onCustomToChange,
  activeType, onTypeChange,
}: {
  period: QuickPeriod;
  onPeriodChange: (p: QuickPeriod) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  activeType: string;
  onTypeChange: (t: string) => void;
}) {
  return (
    <div className="px-4 py-2.5 border-b border-line shrink-0 space-y-2 bg-muted/20">
      {/* Linha 1: Período rápido */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[10px] text-muted-foreground font-medium mr-1">Período:</span>
        {QUICK_PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => onPeriodChange(p.value)}
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
              period === p.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Linha 1b: Date pickers (só aparece no modo custom) */}
      <AnimatePresence>
        {period === "custom" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 overflow-hidden"
          >
            <Calendar className="h-3 w-3 text-muted-foreground shrink-0" />
            <input
              type="date"
              value={customFrom}
              onChange={(e) => onCustomFromChange(e.target.value)}
              className="text-[10px] border border-border rounded-lg px-2 py-0.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[10px] text-muted-foreground">até</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => onCustomToChange(e.target.value)}
              className="text-[10px] border border-border rounded-lg px-2 py-0.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Linha 2: Tipo de alerta */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-muted-foreground font-medium">Tipo:</span>
        {ALERT_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => onTypeChange(t.value)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
              activeType === t.value
                ? t.value === "all"
                  ? "bg-foreground text-background border-foreground"
                  : t.color + " border-transparent"
                : "bg-card border-border text-muted-foreground hover:border-primary/40"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export function SupervisorTab() {
  const { setSelectedChatId, setActiveView } = useChat();

  const [data, setData] = useState<SupervisorApiData | null>(null);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [period, setPeriod] = useState<QuickPeriod>("7d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [activeType, setActiveType] = useState<string>("all");

  const { from, to } = useMemo(
    () => getDateRange(period, customFrom, customTo),
    [period, customFrom, customTo]
  );

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        tenantId: "valem",
        dateFrom: from.toISOString(),
        dateTo:   to.toISOString(),
      });
      if (activeType !== "all") params.set("types", activeType);

      const res = await fetch(`/api/valentina/supervisor?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error("[SupervisorTab] Erro:", err);
    } finally {
      setLoading(false);
    }
  }, [from, to, activeType]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const iv = setInterval(fetchData, 30_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const kpis          = data?.kpis          || { notificationsSent: 0, questionsAnswered: 0, slaAlerts: 0, leadsTransferred: 0 };
  const notifications = data?.notifications || [];
  const recentQuestions = data?.recentQuestions || [];

  // Abrir conversa ao clicar no botão de SLA
  const handleOpenConversation = (conversationId: string) => {
    setSelectedChatId(conversationId);
    setActiveView("chat");
  };

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto scrollbar-thin">
      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <KpiCard
          icon={Bell}         label="Notificações Enviadas" value={kpis.notificationsSent}
          accent="bg-emerald-100 text-emerald-600" loading={loading}
          active={activeType === "all" && false}
        />
        <KpiCard
          icon={MessageSquare} label="Perguntas Respondidas" value={kpis.questionsAnswered}
          accent="bg-sky-100 text-sky-600" loading={loading}
        />
        <KpiCard
          icon={AlertTriangle} label="Alertas SLA" value={kpis.slaAlerts}
          accent="bg-amber-100 text-amber-600" loading={loading}
          active={activeType === "sla_alert"}
          onClick={() => setActiveType(prev => prev === "sla_alert" ? "all" : "sla_alert")}
        />
        <KpiCard
          icon={SendIcon} label="Leads Transferidos" value={kpis.leadsTransferred}
          accent="bg-primary-soft text-primary" loading={loading}
          active={activeType === "lead_transfer"}
          onClick={() => setActiveType(prev => prev === "lead_transfer" ? "all" : "lead_transfer")}
        />
      </div>

      {/* ── Bottom row — Timeline + Perguntas Recentes ───────────────── */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Timeline (60%) */}
        <div className="w-[60%] flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-line shrink-0">
            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-primary" />
              Timeline de Atividade
              <span className="text-[9px] text-muted-foreground font-normal ml-auto">
                {notifications.length} registro{notifications.length !== 1 ? "s" : ""}
              </span>
            </h3>
          </div>

          {/* Filtros */}
          <TimelineFilters
            period={period}              onPeriodChange={setPeriod}
            customFrom={customFrom}      onCustomFromChange={setCustomFrom}
            customTo={customTo}          onCustomToChange={setCustomTo}
            activeType={activeType}      onTypeChange={setActiveType}
          />

          {/* Lista */}
          <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="ml-2 text-xs text-muted-foreground">Carregando...</span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Inbox className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-xs font-medium">Nenhuma atividade no período</p>
                <p className="text-[10px] mt-1 text-center">
                  Tente ampliar o período ou mudar o filtro de tipo
                </p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-border" />
                <div className="space-y-1">
                  {notifications.map((notif, idx) => {
                    const { icon: NotifIcon, color } = getNotifIcon(notif.type);
                    const isSla = notif.type === "sla_alert";
                    return (
                      <motion.div
                        key={notif.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.4) }}
                        className="flex gap-3 py-2.5 relative"
                      >
                        {/* Ícone */}
                        <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${color} z-10`}>
                          <NotifIcon className="h-3 w-3" />
                        </div>

                        {/* Conteúdo */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <PriorityDot priority={notif.priority} />
                            <span className="text-xs font-bold text-foreground truncate flex-1">
                              {notif.title}
                            </span>
                            {/* Botão "Ver conversa" — só em SLA alerts com conversationId */}
                            {isSla && notif.conversationId && (
                              <button
                                onClick={() => handleOpenConversation(notif.conversationId!)}
                                title="Abrir conversa"
                                className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-700 text-[9px] font-bold transition-colors"
                              >
                                <ExternalLink className="h-2.5 w-2.5" />
                                Ver
                              </button>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                            {notif.description}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] text-muted-foreground font-medium">{notif.operatorName}</span>
                            <span className="text-[9px] text-muted-foreground/60">·</span>
                            <span className="text-[9px] text-muted-foreground/60" title={formatDateTime(notif.timestamp)}>
                              {formatRelativeTime(notif.timestamp)}
                            </span>
                            {notif.contactName && (
                              <>
                                <span className="text-[9px] text-muted-foreground/60">·</span>
                                <span className="text-[9px] text-muted-foreground italic">{notif.contactName}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Perguntas Recentes (40%) */}
        <div className="w-[40%] flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
          <div className="px-4 py-3 border-b border-line shrink-0">
            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
              <MessageCircleQuestion className="h-3.5 w-3.5 text-primary" />
              Perguntas Recentes
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Últimas perguntas feitas à Valentina pelos operadores
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 scrollbar-thin">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-xl border border-border p-3 flex gap-3">
                    <div className="h-7 w-7 rounded-full bg-muted animate-pulse shrink-0" />
                    <div className="flex-1">
                      <div className="h-3 bg-muted rounded w-3/4 mb-2 animate-pulse" />
                      <div className="h-2 bg-muted rounded w-1/2 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentQuestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <MessageCircleQuestion className="h-6 w-6 mb-2 opacity-40" />
                <p className="text-xs font-medium">Nenhuma pergunta ainda</p>
                <p className="text-[10px] mt-1 text-center px-4">
                  Quando um operador perguntar algo à Valentina, aparecerá aqui
                </p>
              </div>
            ) : (
              recentQuestions.map((q, idx) => {
                const { initials, color } = getOperatorInitials(q.operatorName);
                return (
                  <motion.div
                    key={q.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: idx * 0.04 }}
                    className="rounded-xl border border-border p-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-extrabold ${color}`}>
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-foreground truncate">{q.operatorName}</span>
                          <span className="text-[9px] text-muted-foreground/70 shrink-0 ml-2" title={formatDateTime(q.timestamp)}>
                            {formatRelativeTime(q.timestamp)}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
                          {q.question.length > 80 ? q.question.slice(0, 80) + "..." : q.question}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
