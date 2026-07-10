import React, { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/useChatState";
import { motion, AnimatePresence } from "framer-motion";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Calendar,
  CheckCircle2,
  Circle,
  MessageSquare,
  ExternalLink,
  Clock,
  AlertTriangle,
  Loader2,
  ClipboardCheck,
  Users,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TaskData {
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Preencher dias anteriores para alinhar com o dia da semana
  const startDay = firstDay.getDay();
  for (let i = startDay - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }

  // Dias do mês
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }

  // Preencher dias seguintes para completar a grade
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
    case "call": return "var(--primary)";
    case "email": return "#6366f1";
    case "meeting": return "#f59e0b";
    case "whatsapp": return "#25d366";
    default: return "#8b5cf6";
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

// ─── Component ───────────────────────────────────────────────────────────────

export function TasksView() {
  const { tenant, setSelectedChatId, setActiveView, setActiveQueue, operatorProfile } = useChat();

  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date>(today);

  const days = getDaysInMonth(currentYear, currentMonth);

  // ─── Check if RD CRM is configured ──────────────────────────────────────
  useEffect(() => {
    fetch(`/api/settings/rd-crm?tenantId=${tenant}`)
      .then((r) => r.json())
      .then((data) => setConfigured(data.configured ?? false))
      .catch(() => setConfigured(false));
  }, [tenant]);

  // ─── Fetch tasks from API ───────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const emailParam = operatorProfile?.email ? `&email=${encodeURIComponent(operatorProfile.email)}` : "";
      const res = await fetch(`/api/tasks?tenantId=${tenant}${emailParam}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setTasks([]);
      } else {
        setTasks(data.tasks || []);
      }
    } catch (e: any) {
      setError(e.message || "Erro ao carregar tarefas");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [tenant, operatorProfile]);

  // Auto-fetch on mount if configured
  useEffect(() => {
    if (configured === true) {
      fetchTasks();
    }
  }, [configured, fetchTasks]);

  // ─── Task completion toggle ─────────────────────────────────────────────
  const toggleTaskStatus = async (task: TaskData) => {
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
  const openChat = (task: TaskData) => {
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

  const selectedTasks = getTasksForDate(selectedDate);
  const pendingCount = tasks.filter((t) => t.status !== "done").length;

  // ─── Not Configured State ──────────────────────────────────────────────
  if (configured === false) {
    return (
      <section className="flex h-full flex-col rounded-3xl bg-chat-panel shadow-soft overflow-hidden">
        <div className="flex flex-1 items-center justify-center p-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-md"
          >
            <div
              className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl"
              style={{ background: "var(--primary-soft)" }}
            >
              <ClipboardCheck className="h-10 w-10" style={{ color: "var(--primary)" }} />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-3">Integração RD Station CRM</h2>
            <p className="text-muted-foreground mb-6 leading-relaxed">
              Conecte seu RD Station CRM para visualizar suas tarefas em um calendário inteligente,
              com acesso direto aos atendimentos dos clientes.
            </p>
            <button
              onClick={() => setActiveView("settings")}
              className="inline-flex items-center gap-2 rounded-2xl px-6 py-3 font-semibold text-white transition-all hover:scale-105 active:scale-95"
              style={{ background: "var(--primary)" }}
            >
              <ExternalLink className="h-4 w-4" />
              Configurar nas Ajustes
            </button>
          </motion.div>
        </div>
      </section>
    );
  }

  // ─── Main Render ────────────────────────────────────────────────────────
  return (
    <section className="flex h-full flex-col rounded-3xl bg-chat-panel shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-8 py-5">
        <div className="flex items-center gap-4">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-2xl"
            style={{ background: "var(--primary-soft)" }}
          >
            <ClipboardCheck className="h-5 w-5" style={{ color: "var(--primary)" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Tarefas CRM</h1>
            <p className="text-xs text-muted-foreground">
              {pendingCount > 0 ? `${pendingCount} tarefa${pendingCount > 1 ? "s" : ""} pendente${pendingCount > 1 ? "s" : ""}` : "Nenhuma tarefa pendente"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={goToday}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-all hover:bg-card hover:shadow-sm"
          >
            Hoje
          </button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={fetchTasks}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: "var(--primary)" }}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Atualizar
          </motion.button>
        </div>
      </div>

      {/* Content Grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Calendar */}
        <div className="flex-1 flex flex-col p-6 overflow-auto border-r border-border">
          {/* Month Navigation */}
          <div className="flex items-center justify-between mb-5">
            <motion.button whileTap={{ scale: 0.9 }} onClick={prevMonth} className="rounded-xl p-2 hover:bg-card transition-colors">
              <ChevronLeft className="h-5 w-5 text-foreground" />
            </motion.button>
            <h2 className="text-lg font-bold text-foreground">
              {MONTHS[currentMonth]} {currentYear}
            </h2>
            <motion.button whileTap={{ scale: 0.9 }} onClick={nextMonth} className="rounded-xl p-2 hover:bg-card transition-colors">
              <ChevronRight className="h-5 w-5 text-foreground" />
            </motion.button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAYS.map((day) => (
              <div key={day} className="text-center text-xs font-semibold text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Day Grid */}
          <div className="grid grid-cols-7 gap-1 flex-1">
            {days.map((date, i) => {
              const isCurrentMonth = date.getMonth() === currentMonth;
              const isToday = isSameDay(date, today);
              const isSelected = isSameDay(date, selectedDate);
              const dayTasks = getTasksForDate(date);
              const hasTasks = dayTasks.length > 0;
              const pendingDayTasks = dayTasks.filter((t) => t.status !== "done");

              return (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSelectedDate(date)}
                  className="relative flex flex-col items-center justify-center rounded-2xl py-3 transition-all min-h-[60px]"
                  style={{
                    background: isSelected
                      ? "var(--primary)"
                      : isToday
                        ? "var(--primary-soft)"
                        : "transparent",
                    color: isSelected
                      ? "white"
                      : isCurrentMonth
                        ? "var(--foreground)"
                        : "var(--muted-foreground)",
                    opacity: isCurrentMonth ? 1 : 0.35,
                    border: isToday && !isSelected ? "2px solid var(--primary)" : "2px solid transparent",
                  }}
                >
                  <span className={`text-sm font-semibold ${isSelected ? "text-white" : ""}`}>
                    {date.getDate()}
                  </span>

                  {/* Task indicators */}
                  {hasTasks && (
                    <div className="flex items-center gap-0.5 mt-1">
                      {dayTasks.slice(0, 3).map((t, j) => (
                        <div
                          key={j}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: isSelected ? "rgba(255,255,255,0.8)" : getTaskTypeColor(t.type),
                          }}
                        />
                      ))}
                      {dayTasks.length > 3 && (
                        <span
                          className="text-[9px] font-bold ml-0.5"
                          style={{ color: isSelected ? "rgba(255,255,255,0.8)" : "var(--muted-foreground)" }}
                        >
                          +{dayTasks.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Task Details Panel */}
        <div className="w-[380px] flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-sm font-bold text-foreground">
              {selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {selectedTasks.length === 0 ? "Nenhuma tarefa" : `${selectedTasks.length} tarefa${selectedTasks.length > 1 ? "s" : ""}`}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-2xl bg-red-50 dark:bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            <AnimatePresence mode="popLayout">
              {selectedTasks.length === 0 && !error && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-12 text-center"
                >
                  <Calendar className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Nenhuma tarefa nesta data</p>
                </motion.div>
              )}

              {selectedTasks.map((task, index) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ delay: index * 0.05, type: "spring", damping: 20 }}
                  className="group rounded-2xl border border-border bg-card p-4 transition-all hover:shadow-md hover:border-primary/30"
                  style={{
                    borderLeft: `3px solid ${getTaskTypeColor(task.type)}`,
                  }}
                >
                  {/* Task Header */}
                  <div className="flex items-start gap-3">
                    <motion.button
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => toggleTaskStatus(task)}
                      className="mt-0.5 shrink-0"
                    >
                      {task.status === "done" ? (
                        <CheckCircle2 className="h-5 w-5" style={{ color: "var(--primary)" }} />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
                      )}
                    </motion.button>

                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-semibold leading-tight ${
                          task.status === "done" ? "line-through text-muted-foreground" : "text-foreground"
                        }`}
                      >
                        {task.name}
                      </p>

                      {/* Type & Time */}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                          style={{ background: getTaskTypeColor(task.type) }}
                        >
                          {getTaskTypeIcon(task.type)}
                          {task.type}
                        </span>
                        {task.dueDate && (() => {
                          const isOverdue = task.status !== "done" && new Date(task.dueDate) < new Date();
                          return (
                            <span className={`flex items-center gap-1 text-[11px] ${isOverdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                              <Clock className="h-3 w-3" />
                              {formatTime(task.dueDate)} {isOverdue && "(Atrasada)"}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Client Info */}
                  {(task.client.name || task.client.phone) && (
                    <div className="mt-3 rounded-xl bg-background/60 p-3">
                      {task.client.name && (
                        <p className="text-xs font-semibold text-foreground">{task.client.name}</p>
                      )}
                      {task.client.phone && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{formatPhone(task.client.phone)}</p>
                      )}
                    </div>
                  )}

                  {/* Deal Info */}
                  {task.deal?.name && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <ExternalLink className="h-3 w-3" />
                      <span className="truncate">{task.deal.name}</span>
                    </div>
                  )}

                  {/* Description */}
                  {task.description && (
                    <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                      {task.description}
                    </p>
                  )}

                  {/* Action Button */}
                  {task.chatConversationId ? (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => openChat(task)}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold text-white transition-all"
                      style={{ background: "var(--primary)" }}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Abrir Atendimento
                    </motion.button>
                  ) : (
                    <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-xs text-muted-foreground">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Sem conversa ativa
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
