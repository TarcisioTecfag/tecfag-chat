// ══════════════════════════════════════════════════════════════════════════════
// 👁️ SUPERVISOR TAB — Analytics e timeline de notificações
// ══════════════════════════════════════════════════════════════════════════════

import React from "react";
import { motion } from "framer-motion";
import {
  Bell, MessageSquare, AlertTriangle, ArrowRight,
  TrendingUp, Clock, Eye, BarChart2, HelpCircle,
  Send as SendIcon, Zap, Users,
} from "lucide-react";
import {
  SUPERVISOR_NOTIFICATIONS,
  TOP_QUESTIONS,
  SupervisorNotification,
} from "./valentina-mock-data";

// ── Helpers ─────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, accent }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border shadow-soft p-4 flex items-center gap-4">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${accent}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-lg font-extrabold text-foreground">{value}</p>
      </div>
    </div>
  );
}

function getNotifIcon(type: SupervisorNotification["type"]) {
  switch (type) {
    case "lead_transfer": return { icon: ArrowRight, color: "bg-violet-100 text-violet-600" };
    case "sla_alert": return { icon: AlertTriangle, color: "bg-amber-100 text-amber-600" };
    case "no_response": return { icon: Clock, color: "bg-orange-100 text-orange-600" };
    case "daily_summary": return { icon: BarChart2, color: "bg-sky-100 text-sky-600" };
    case "sentiment_alert": return { icon: Zap, color: "bg-rose-100 text-rose-600" };
    default: return { icon: Bell, color: "bg-muted text-muted-foreground" };
  }
}

function PriorityDot({ priority }: { priority: SupervisorNotification["priority"] }) {
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

// ── Componente principal ────────────────────────────────────────────────────

export function SupervisorTab() {
  // Métricas calculadas dos mocks
  const totalNotifs = SUPERVISOR_NOTIFICATIONS.length;
  const slaAlerts = SUPERVISOR_NOTIFICATIONS.filter((n) => n.type === "sla_alert").length;
  const leadsTransferred = SUPERVISOR_NOTIFICATIONS.filter((n) => n.type === "lead_transfer").length;
  const questionsAnswered = 27; // Mock fixo

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto scrollbar-thin">
      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <KpiCard
          icon={Bell}
          label="Notificações Enviadas"
          value={totalNotifs}
          accent="bg-violet-100 text-violet-600"
        />
        <KpiCard
          icon={MessageSquare}
          label="Perguntas Respondidas"
          value={questionsAnswered}
          accent="bg-sky-100 text-sky-600"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Alertas SLA"
          value={slaAlerts}
          accent="bg-amber-100 text-amber-600"
        />
        <KpiCard
          icon={SendIcon}
          label="Leads Transferidos"
          value={leadsTransferred}
          accent="bg-emerald-100 text-emerald-600"
        />
      </div>

      {/* ── Bottom row — Timeline + Top Questions ──────────────────────── */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Timeline de atividade (60%) */}
        <div className="w-[60%] flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
          <div className="px-4 py-3 border-b border-line shrink-0">
            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-violet-600" />
              Timeline de Atividade
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin">
            <div className="relative">
              {/* Linha vertical conectora */}
              <div className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-border" />

              <div className="space-y-1">
                {SUPERVISOR_NOTIFICATIONS.map((notif, idx) => {
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
          </div>
        </div>

        {/* Perguntas mais frequentes (40%) */}
        <div className="w-[40%] flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
          <div className="px-4 py-3 border-b border-line shrink-0">
            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
              <HelpCircle className="h-3.5 w-3.5 text-violet-600" />
              Perguntas Mais Frequentes
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Últimos 7 dias</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 scrollbar-thin">
            {TOP_QUESTIONS.map((q, idx) => {
              const maxCount = TOP_QUESTIONS[0].count;
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
                      {q.question}
                    </span>
                    <span className="text-xs font-extrabold text-violet-600 shrink-0">
                      {q.count}x
                    </span>
                  </div>
                  <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
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
