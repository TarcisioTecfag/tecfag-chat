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
  List,
  Search,
  X,
  Filter,
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

// ─── Component ───────────────────────────────────────────────────────────────

export function TasksView() {
  const { tenant, setSelectedChatId, setActiveView, setActiveQueue, operatorProfile } = useChat();

  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  // Estados do Modal "Todos" (Filtro e Busca global)
  const [isAllTasksModalOpen, setIsAllTasksModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "completed">("all");
  const [dateFilter, setDateFilter] = useState("");

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
            onClick={() => setIsAllTasksModalOpen(true)}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-all hover:bg-card hover:shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <List className="h-4 w-4" />
            Todos
          </button>
          <button
            onClick={goToday}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-all hover:bg-card hover:shadow-sm cursor-pointer"
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
          <div className="grid grid-cols-7 gap-1 mb-4 border-b border-border pb-3 bg-muted/40 dark:bg-muted/10 rounded-2xl px-2 py-1.5 shadow-sm">
            {WEEKDAYS.map((day) => (
              <div key={day} className="text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground/90">
                {day}
              </div>
            ))}
          </div>

          {/* Day Grid */}
          <div className="grid grid-cols-7 gap-1.5 flex-1">
            {days.map((date, i) => {
              const isCurrentMonth = date.getMonth() === currentMonth;
              const isToday = isSameDay(date, today);
              const isSelected = isSameDay(date, selectedDate);
              const dayTasks = getTasksForDate(date);
              const hasTasks = dayTasks.length > 0;

              return (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedDate(date)}
                  className="relative flex flex-col items-center justify-start rounded-2xl p-2 transition-all min-h-[90px] border w-full overflow-hidden"
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
                    borderWidth: isToday && !isSelected ? "2.5px" : "1px",
                  }}
                >
                  <span className={`text-xs font-bold ${isSelected ? "text-white" : "text-foreground/80"} mb-1`}>
                    {date.getDate()}
                  </span>

                  {/* Task Previews */}
                  {hasTasks && (
                    <div className="flex flex-col gap-1 w-full mt-1 overflow-hidden">
                      {dayTasks.slice(0, 2).map((t, j) => {
                        const label = t.client?.name || t.name;
                        const isDone = t.status === "done";
                        return (
                          <div
                            key={j}
                            className={`text-[9px] px-1.5 py-0.5 rounded-md truncate w-full font-medium text-center border transition-all ${
                              isSelected
                                ? "bg-white/25 text-white border-white/10"
                                : "bg-muted/60 text-foreground/80 border-border/40 hover:border-primary/20"
                            } ${isDone ? "line-through opacity-50" : ""}`}
                            title={`${t.name} ${t.client?.name ? `(${t.client.name})` : ""}`}
                          >
                            {label}
                          </div>
                        );
                      })}
                      {dayTasks.length > 2 && (
                        <div
                          className={`text-[8px] font-bold text-center mt-0.5 ${
                            isSelected ? "text-white/80" : "text-muted-foreground"
                          }`}
                        >
                          +{dayTasks.length - 2} mais
                        </div>
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
                    Visualize, pesquise e gerencie todas as suas tarefas integradas do RD CRM.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsAllTasksModalOpen(false);
                    setSearchQuery("");
                    setStatusFilter("all");
                    setDateFilter("");
                  }}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              {/* Filters Bar */}
              <div className="p-6 border-b border-line bg-background/30 flex flex-col md:flex-row gap-4 items-center">
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

                {/* Status Toggle (Segmented control) */}
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

                {/* Date Input Filter */}
                <div className="relative w-full md:w-44 shrink-0">
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
              <div className="flex-1 overflow-y-auto p-6 bg-background/10 space-y-3">
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
                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.97 }}
                              onClick={() => {
                                openChat(task);
                                setIsAllTasksModalOpen(false);
                              }}
                              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all cursor-pointer shadow-sm"
                              style={{ background: "var(--primary)" }}
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              Atendimento
                            </motion.button>
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
    </section>
  );
}
