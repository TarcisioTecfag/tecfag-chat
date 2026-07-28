// ══════════════════════════════════════════════════════════════════════════════
// 👁️ SUPERVISOR TAB — Analytics e timeline REAL de notificações
// Consome /api/valentina/supervisor para KPIs, timeline e perguntas frequentes
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Bell, MessageSquare, AlertTriangle, ArrowRight,
  TrendingUp, Clock, Eye, BarChart2, HelpCircle,
  Send as SendIcon, Zap, Users, Loader2, Inbox,
} from "lucide-react";

// ── Helpers ─────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, accent, loading }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border shadow-soft p-4 flex items-center gap-4">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${accent}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        {loading ? (
          <div className="h-6 w-10 bg-muted rounded animate-pulse mt-1" />
        ) : (
          <p className="text-lg font-extrabold text-foreground">{value}</p>
        )}
      </div>
    </div>
  );
}

function getNotifIcon(type: string) {
  switch (type) {
    case "lead_transfer": return { icon: ArrowRight, color: "bg-primary-soft text-primary" };
    case "sla_alert": return { icon: AlertTriangle, color: "bg-amber-100 text-amber-600" };
    case "no_response": return { icon: Clock, color: "bg-orange-100 text-orange-600" };
    case "daily_summary": return { icon: BarChart2, color: "bg-sky-100 text-sky-600" };
    case "sentiment_alert": return { icon: Zap, color: "bg-rose-100 text-rose-600" };
    case "operator_overload": return { icon: Users, color: "bg-violet-100 text-violet-600" };
    default: return { icon: Bell, color: "bg-muted text-muted-foreground" };
  }
}

function PriorityDot({ priority }: { priority: string }) {
  const c = priority === "high" ? "bg-red-500" : priority === "medium" ? "bg-amber-400" : "bg-gray-300";
  return <span className={`inline-block h-2 w-2 rounded-full ${c} ${priority === "high" ? "animate-pulse" : ""}`} />;
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

// ── Tipos da API ────────────────────────────────────────────────────────────

interface SupervisorApiData {
  kpis: {
    notificationsSent: number;
    questionsAnswered: number;
    slaAlerts: number;
    leadsTransferred: number;
  };
  notifications: {
    id: string;
    type: string;
    title: string;
    description: string;
    operatorName: string;
    timestamp: string;
    priority: string;
    conversationId: string | null;
  }[];
  topQuestions: {
    question: string;
    count: number;
  }[];
}

// ── Componente principal ────────────────────────────────────────────────────

export function SupervisorTab() {
  const [data, setData] = useState<SupervisorApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/valentina/supervisor?tenantId=valem");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      console.error("[SupervisorTab] Erro ao carregar dados:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Carrega na montagem e atualiza a cada 30 segundos
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const kpis = data?.kpis || { notificationsSent: 0, questionsAnswered: 0, slaAlerts: 0, leadsTransferred: 0 };
  const notifications = data?.notifications || [];
  const topQuestions = data?.topQuestions || [];

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto scrollbar-thin">
      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <KpiCard
          icon={Bell}
          label="Notificações Enviadas"
          value={kpis.notificationsSent}
          accent="bg-emerald-100 text-emerald-600"
          loading={loading}
        />
        <KpiCard
          icon={MessageSquare}
          label="Perguntas Respondidas"
          value={kpis.questionsAnswered}
          accent="bg-sky-100 text-sky-600"
          loading={loading}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Alertas SLA"
          value={kpis.slaAlerts}
          accent="bg-amber-100 text-amber-600"
          loading={loading}
        />
        <KpiCard
          icon={SendIcon}
          label="Leads Transferidos"
          value={kpis.leadsTransferred}
          accent="bg-primary-soft text-primary"
          loading={loading}
        />
      </div>

      {/* ── Bottom row — Timeline + Top Questions ──────────────────────── */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Timeline de atividade (60%) */}
        <div className="w-[60%] flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
          <div className="px-4 py-3 border-b border-line shrink-0">
            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-primary" />
              Timeline de Atividade
              {!loading && notifications.length > 0 && (
                <span className="text-[9px] text-muted-foreground font-normal ml-auto">
                  Atualiza a cada 30s
                </span>
              )}
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="ml-2 text-xs text-muted-foreground">Carregando atividades...</span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Inbox className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-xs font-medium">Nenhuma atividade registrada</p>
                <p className="text-[10px] mt-1">As notificações aparecerão aqui em tempo real</p>
              </div>
            ) : (
              <div className="relative">
                {/* Linha vertical conectora */}
                <div className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-border" />

                <div className="space-y-1">
                  {notifications.map((notif, idx) => {
                    const { icon: NotifIcon, color } = getNotifIcon(notif.type);
                    return (
                      <motion.div
                        key={notif.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2, delay: idx * 0.04 }}
                        className="flex gap-3 py-2.5 relative"
                      >
                        {/* Ícone do tipo */}
                        <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${color} z-10`}>
                          <NotifIcon className="h-3 w-3" />
                        </div>

                        {/* Conteúdo */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <PriorityDot priority={notif.priority} />
                            <span className="text-xs font-bold text-foreground truncate">{notif.title}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                            {notif.description}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] text-muted-foreground font-medium">
                              {notif.operatorName}
                            </span>
                            <span className="text-[9px] text-muted-foreground/60">·</span>
                            <span className="text-[9px] text-muted-foreground/60">
                              {formatRelativeTime(notif.timestamp)}
                            </span>
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

        {/* Perguntas mais frequentes (40%) */}
        <div className="w-[40%] flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
          <div className="px-4 py-3 border-b border-line shrink-0">
            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
              <HelpCircle className="h-3.5 w-3.5 text-primary" />
              Perguntas Mais Frequentes
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Últimos 7 dias</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 scrollbar-thin">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-xl border border-border p-3">
                    <div className="h-3 bg-muted rounded w-3/4 mb-2 animate-pulse" />
                    <div className="h-1 bg-muted rounded w-full animate-pulse" />
                  </div>
                ))}
              </div>
            ) : topQuestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <HelpCircle className="h-6 w-6 mb-2 opacity-40" />
                <p className="text-xs font-medium">Sem perguntas registradas</p>
                <p className="text-[10px] mt-1">Quando operadores interagirem com a Valentina, as perguntas mais frequentes aparecerão aqui</p>
              </div>
            ) : (
              topQuestions.map((q, idx) => {
                const maxCount = topQuestions[0]?.count || 1;
                const pct = (q.count / maxCount) * 100;
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: idx * 0.05 }}
                    className="rounded-xl border border-border p-3"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-foreground font-semibold leading-snug flex-1 mr-2">
                        {q.question.length > 60 ? q.question.slice(0, 60) + "..." : q.question}
                      </span>
                      <span className="text-xs font-extrabold text-primary shrink-0">
                        {q.count}x
                      </span>
                    </div>
                    <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
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
