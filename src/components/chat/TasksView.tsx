import React, { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/useChatState";
import { useTabNavigation } from "@/hooks/useTabNavigation";
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
  Plus,
  Utensils,
  MapPin,
  Columns3,
  ListTodo,
  Check,
} from "lucide-react";
import { CreateTaskModal } from "../crm/CreateTaskModal";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TaskData {
  id: string;
  name: string;
  type: string;
  status: string;
  dueDate: string | null;
  description: string | null;
  createdAt: string | null;
  deal: { id: string; name: string | null; value?: string | null; stageName?: string | null } | null;
  client: { name: string | null; phone: string | null };
  chatContactId: string | null;
  chatConversationId: string | null;
  source?: "kanban" | "rd";
  operatorId?: string | null;
  operatorName?: string | null;
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

function getWeekDays(referenceDate: Date): Date[] {
  const d = new Date(referenceDate);
  const day = d.getDay(); // 0 = Domingo
  const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const nextDay = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
    days.push(nextDay);
  }
  return days;
}

function isTaskOverdue(task: TaskData): boolean {
  if (task.status === "done" || task.status === "completed") return false;
  if (!task.dueDate) return false;
  return new Date(task.dueDate) < new Date();
}

function sortTasksByTime(list: TaskData[]): TaskData[] {
  return [...list].sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });
}

function groupTasksByTimeBlock(dayTasks: TaskData[]) {
  const sorted = sortTasksByTime(dayTasks);
  const now = new Date();

  const overdue: TaskData[] = [];
  const morning: TaskData[] = [];
  const afternoon: TaskData[] = [];
  const eveningOrNoTime: TaskData[] = [];
  const completed: TaskData[] = [];

  for (const t of sorted) {
    if (t.status === "done" || t.status === "completed") {
      completed.push(t);
      continue;
    }
    if (t.dueDate && new Date(t.dueDate) < now) {
      overdue.push(t);
      continue;
    }
    if (!t.dueDate) {
      eveningOrNoTime.push(t);
      continue;
    }
    const d = new Date(t.dueDate);
    const hour = d.getHours();
    if (hour < 12) {
      morning.push(t);
    } else if (hour < 18) {
      afternoon.push(t);
    } else {
      eveningOrNoTime.push(t);
    }
  }

  return { overdue, morning, afternoon, eveningOrNoTime, completed };
}

function getTaskTypeIcon(type: string) {
  switch (type) {
    case "call": return <Phone className="h-3.5 w-3.5" />;
    case "email": return <Mail className="h-3.5 w-3.5" />;
    case "meeting": return <Users className="h-3.5 w-3.5" />;
    case "whatsapp": return <MessageSquare className="h-3.5 w-3.5" />;
    case "lunch": return <Utensils className="h-3.5 w-3.5" />;
    case "visit": return <MapPin className="h-3.5 w-3.5" />;
    default: return <ClipboardCheck className="h-3.5 w-3.5" />;
  }
}

function getTaskTypeLabel(type: string): string {
  switch (type) {
    case "call": return "Ligação";
    case "email": return "E-mail";
    case "meeting": return "Reunião";
    case "whatsapp": return "WhatsApp";
    case "lunch": return "Almoço";
    case "visit": return "Visita";
    case "task": return "Tarefa";
    default: return type;
  }
}

function getTaskTypeColor(type: string): string {
  switch (type) {
    case "whatsapp": return "#128c7e";
    case "call": return "#2563eb";
    case "meeting": return "#7c3aed";
    case "email": return "#ea580c";
    case "visit": return "#059669";
    case "lunch": return "#d97706";
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
  const {
    tenant,
    setSelectedChatId,
    setActiveView,
    setActiveQueue,
    operatorProfile,
    currentOperatorId,
    sessionRole,
    refreshConversations,
  } = useChat();

  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [operatorsList, setOperatorsList] = useState<Array<{ id: string; name: string }>>([]);

  // Modo de visualização: Mês | Semana | Dia
  const [viewMode, setViewMode] = useState<"month" | "week" | "day">("month");

  useTabNavigation({
    tabs: ["month", "week", "day"] as const,
    activeTab: viewMode,
    onChange: setViewMode,
  });

  // Filtros internos do painel diário
  const [selectedDaySearch, setSelectedDaySearch] = useState("");
  const [selectedDayStatus, setSelectedDayStatus] = useState<"all" | "pending" | "overdue" | "done">("all");
  const [selectedDayType, setSelectedDayType] = useState<string>("all");

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
  const weekDays = getWeekDays(selectedDate);
  const startWeekDay = weekDays[0];
  const endWeekDay = weekDays[6];

  // ─── Carrega operadores para CreateTaskModal ─────────────────────────────
  useEffect(() => {
    fetch("/api/operators")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setOperatorsList(data.map((op: any) => ({ id: op.id, name: op.name })));
        }
      })
      .catch((err) => console.warn("[TasksView] Erro ao carregar operadores:", err));
  }, [tenant]);

  // ─── Check if RD CRM is configured ──────────────────────────────────────
  useEffect(() => {
    fetch(`/api/settings/rd-crm?tenantId=${tenant}`)
      .then((r) => r.json())
      .then((data) => setConfigured(data.configured ?? false))
      .catch(() => setConfigured(false));
  }, [tenant]);

  // ─── Fetch tasks from API (Escopo estrito do operador logado) ───────────
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks?tenantId=${tenant}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setTasks([]);
      } else {
        setTasks(data.tasks || []);
        if (data.configured !== undefined && configured === null) {
          setConfigured(data.configured);
        }
      }
    } catch (e: any) {
      setError(e.message || "Erro ao carregar tarefas");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [tenant, configured]);

  // Busca sempre que montar ou alternar filtros
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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

  // ─── Iniciar chat com o contato quando ainda não há conversa vinculada ──
  const handleStartChatWithContact = async (contactId: string) => {
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/conversations`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Não foi possível abrir o atendimento.");
      if (refreshConversations) {
        await refreshConversations(data.conversationId);
      }
      const queue = data.readOnly
        ? data.queueState === "fila" ? "fila" : data.queueState === "automacao" ? "automacao" : "todos"
        : "meus";
      setActiveQueue(queue);
      setSelectedChatId(data.conversationId);
      setActiveView("chat");
    } catch (err: any) {
      console.error("[TasksView] Erro ao iniciar chat:", err);
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

  const prevWeek = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 7);
    setSelectedDate(d);
    setCurrentMonth(d.getMonth());
    setCurrentYear(d.getFullYear());
  };

  const nextWeek = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 7);
    setSelectedDate(d);
    setCurrentMonth(d.getMonth());
    setCurrentYear(d.getFullYear());
  };

  const prevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d);
    setCurrentMonth(d.getMonth());
    setCurrentYear(d.getFullYear());
  };

  const nextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d);
    setCurrentMonth(d.getMonth());
    setCurrentYear(d.getFullYear());
  };

  const handlePrev = () => {
    if (viewMode === "month") prevMonth();
    else if (viewMode === "week") prevWeek();
    else prevDay();
  };

  const handleNext = () => {
    if (viewMode === "month") nextMonth();
    else if (viewMode === "week") nextWeek();
    else nextDay();
  };

  const goToday = () => {
    const now = new Date();
    setCurrentMonth(now.getMonth());
    setCurrentYear(now.getFullYear());
    setSelectedDate(now);
  };

  // ─── Filter tasks for selected date ─────────────────────────────────────
  const getTasksForDate = (date: Date) =>
    tasks.filter((t) => {
      if (!t.dueDate) return false;
      return isSameDay(new Date(t.dueDate), date);
    });

  const selectedTasks = getTasksForDate(selectedDate);
  const pendingCount = tasks.filter((t) => t.status !== "done" && t.status !== "completed").length;

  const renderDayAgendaCard = (task: TaskData, forceOverdue = false) => {
    const isDone = task.status === "done" || task.status === "completed";
    const isOverdue = forceOverdue || isTaskOverdue(task);

    return (
      <div
        key={task.id}
        className={`rounded-2xl border p-4 transition-all hover:shadow-xs flex flex-col justify-between ${
          isDone
            ? "border-border/60 bg-muted/20 opacity-70"
            : isOverdue
              ? "border-red-500/40 bg-card hover:border-red-500/80"
              : "border-border bg-card hover:border-primary/40"
        }`}
        style={{ borderLeft: `4px solid ${getTaskTypeColor(task.type)}` }}
      >
        <div>
          <div className="flex items-start gap-3">
            <button
              onClick={() => toggleTaskStatus(task)}
              className="mt-0.5 shrink-0 cursor-pointer"
              title={isDone ? "Marcar como pendente" : "Concluir tarefa"}
            >
              {isDone ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
              )}
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
                  style={{ background: getTaskTypeColor(task.type) }}
                >
                  {getTaskTypeIcon(task.type)}
                  {getTaskTypeLabel(task.type)}
                </span>
                {task.dueDate && (
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                      isOverdue ? "text-red-500" : "text-muted-foreground"
                    }`}
                  >
                    <Clock className="h-3 w-3" />
                    {formatTime(task.dueDate)}
                    {isOverdue && !isDone && " (Atrasada)"}
                  </span>
                )}
              </div>

              <p
                className={`text-sm font-semibold leading-snug mt-1.5 ${
                  isDone ? "line-through text-muted-foreground" : "text-foreground"
                }`}
              >
                {task.name}
              </p>

              {task.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {task.description}
                </p>
              )}
            </div>
          </div>

          {(task.client?.name || task.client?.phone || task.deal?.name) && (
            <div className="mt-3 pt-2.5 border-t border-border/50 flex flex-wrap items-center justify-between gap-2 text-xs">
              {task.client?.name && (
                <span className="font-semibold text-foreground/80 truncate max-w-[200px]">
                  {task.client.name}
                </span>
              )}
              {task.deal?.name && (
                <a
                  href={`/crm/deals/${task.deal.id}?from=tasks`}
                  className="inline-flex items-center gap-1 text-primary hover:underline font-medium text-[11px] truncate max-w-[200px]"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{task.deal.name}</span>
                </a>
              )}
            </div>
          )}
        </div>

        {/* Rodapé / Ação de Chat */}
        <div className="mt-3 pt-2">
          {task.chatConversationId ? (
            <button
              onClick={() => openChat(task)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-semibold text-white transition-all cursor-pointer shadow-2xs"
              style={{ background: "var(--primary)" }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Abrir Atendimento
            </button>
          ) : task.chatContactId ? (
            <button
              onClick={() => handleStartChatWithContact(task.chatContactId!)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-semibold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-all cursor-pointer"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Iniciar Atendimento
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  // ─── Main Render (Sem bloqueio: reconhece e usa Kanban nativo se RD não integrado) ─
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
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-foreground">Tarefas e Compromissos</h1>
              {configured === false && (
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                  Kanban CRM
                </span>
              )}
              {configured === true && (
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  RD Station CRM
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {configured === false
                ? "Tarefas e compromissos sincronizados com o Kanban do sistema"
                : "Tarefas integradas ao RD Station CRM"}
              {" • "}
              {pendingCount > 0
                ? `${pendingCount} pendente${pendingCount > 1 ? "s" : ""}`
                : "Nenhuma tarefa pendente"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Seletor de Modo de Visualização: Mês / Semana / Dia */}
          <div className="flex bg-muted rounded-xl p-1 shrink-0 border border-border/60">
            <button
              onClick={() => setViewMode("month")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === "month"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              Mês
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === "week"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" />
              Semana
            </button>
            <button
              onClick={() => setViewMode("day")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === "day"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ListTodo className="h-3.5 w-3.5" />
              Dia
            </button>
          </div>

          <button
            onClick={() => setIsAllTasksModalOpen(true)}
            className="rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-foreground transition-all hover:bg-card hover:shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <List className="h-3.5 w-3.5" />
            Todas
          </button>
          <button
            onClick={goToday}
            className="rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-foreground transition-all hover:bg-card hover:shadow-xs cursor-pointer"
          >
            Hoje
          </button>

          <button
            onClick={() => setIsCreateTaskModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-xs"
            style={{ background: "var(--primary)" }}
          >
            <Plus className="h-4 w-4" />
            Nova Tarefa
          </button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={fetchTasks}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-foreground transition-all hover:bg-card disabled:opacity-60 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Atualizar
          </motion.button>
        </div>
      </div>

      {/* Barra de Navegação Temporal Unificada */}
      <div className="flex items-center justify-between px-8 py-3.5 border-b border-border/80 bg-muted/20">
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handlePrev}
            className="rounded-xl p-2 hover:bg-card transition-colors border border-border/50 cursor-pointer"
            title="Anterior"
          >
            <ChevronLeft className="h-4 w-4 text-foreground" />
          </motion.button>
          <h2 className="text-base font-bold text-foreground capitalize">
            {viewMode === "month" && `${MONTHS[currentMonth]} ${currentYear}`}
            {viewMode === "week" &&
              `Semana de ${startWeekDay.getDate()} ${MONTHS[startWeekDay.getMonth()].slice(0, 3)} a ${endWeekDay.getDate()} ${MONTHS[endWeekDay.getMonth()].slice(0, 3)} de ${endWeekDay.getFullYear()}`}
            {viewMode === "day" &&
              selectedDate.toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
          </h2>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleNext}
            className="rounded-xl p-2 hover:bg-card transition-colors border border-border/50 cursor-pointer"
            title="Próximo"
          >
            <ChevronRight className="h-4 w-4 text-foreground" />
          </motion.button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground">
            {viewMode === "month" && `${getTasksForDate(selectedDate).length} tarefa(s) em ${selectedDate.getDate()}/${selectedDate.getMonth() + 1}`}
            {viewMode === "week" && `${weekDays.reduce((acc, d) => acc + getTasksForDate(d).length, 0)} tarefa(s) na semana`}
            {viewMode === "day" && `${getTasksForDate(selectedDate).length} tarefa(s) nesta data`}
          </span>
        </div>
      </div>

      {/* Conteúdo Dinâmico por Modo de Visualização */}
      {viewMode === "month" && (
        <div className="flex flex-1 overflow-hidden">
          {/* Calendário Mensal */}
          <div className="flex-1 flex flex-col p-6 overflow-auto border-r border-border">
            {/* Cabeçalho dos Dias da Semana */}
            <div className="grid grid-cols-7 gap-1 mb-3 border-b border-border pb-2.5 bg-muted/40 dark:bg-muted/10 rounded-2xl px-2 py-1.5 shadow-2xs">
              {WEEKDAYS.map((day) => (
                <div key={day} className="text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground/90">
                  {day}
                </div>
              ))}
            </div>

            {/* Grade de Dias do Mês */}
            <div className="grid grid-cols-7 gap-1.5 flex-1">
              {days.map((date, i) => {
                const isCurrentMonth = date.getMonth() === currentMonth;
                const isToday = isSameDay(date, today);
                const isSelected = isSameDay(date, selectedDate);
                const dayTasks = getTasksForDate(date);
                const total = dayTasks.length;
                const completed = dayTasks.filter((t) => t.status === "done" || t.status === "completed").length;
                const overdue = dayTasks.filter((t) => isTaskOverdue(t)).length;

                const calls = dayTasks.filter((t) => t.type === "call").length;
                const whats = dayTasks.filter((t) => t.type === "whatsapp").length;
                const meetings = dayTasks.filter((t) => t.type === "meeting").length;
                const emails = dayTasks.filter((t) => t.type === "email").length;
                const others = total - (calls + whats + meetings + emails);

                return (
                  <motion.button
                    key={i}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedDate(date)}
                    className="relative flex flex-col items-center justify-start rounded-2xl p-2 transition-all min-h-[95px] border w-full overflow-hidden cursor-pointer text-left"
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
                    <div className="w-full flex items-center justify-between mb-1">
                      <span className={`text-xs font-extrabold ${isSelected ? "text-white" : "text-foreground/90"}`}>
                        {date.getDate()}
                      </span>
                      {total > 0 && (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                            isSelected
                              ? "bg-white/20 text-white"
                              : overdue > 0
                                ? "bg-red-500/15 text-red-600 dark:text-red-400"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {total}
                        </span>
                      )}
                    </div>

                    {/* Poucas tarefas (1 a 2): pílulas detalhadas */}
                    {total > 0 && total <= 2 && (
                      <div className="flex flex-col gap-1 w-full mt-0.5 overflow-hidden">
                        {dayTasks.map((t, j) => {
                          const label = t.client?.name || t.name;
                          const isDone = t.status === "done" || t.status === "completed";
                          return (
                            <div
                              key={j}
                              className={`text-[9px] px-1.5 py-0.5 rounded-md truncate w-full font-medium flex items-center gap-1 border transition-all ${
                                isSelected
                                  ? "bg-white/25 text-white border-white/10"
                                  : "bg-muted/60 text-foreground/80 border-border/40 hover:border-primary/20"
                              } ${isDone ? "line-through opacity-50" : ""}`}
                              title={`${t.name} ${t.client?.name ? `(${t.client.name})` : ""}`}
                            >
                              <span className="shrink-0">{getTaskTypeIcon(t.type)}</span>
                              <span className="truncate">{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Alto Volume (3+ tarefas até 30): Painel Resumo de Carga */}
                    {total > 2 && (
                      <div className="flex flex-col gap-1.5 w-full mt-1 overflow-hidden">
                        {/* Alerta de Atrasadas */}
                        {overdue > 0 && (
                          <div
                            className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md w-full justify-center ${
                              isSelected
                                ? "bg-white text-red-600 shadow-2xs"
                                : "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30"
                            }`}
                          >
                            <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                            <span>{overdue} atrasada{overdue > 1 ? "s" : ""}</span>
                          </div>
                        )}

                        {/* Chips de canais/tipos com ícones */}
                        <div className="flex flex-wrap items-center gap-1 w-full justify-center">
                          {calls > 0 && (
                            <span
                              title={`${calls} ligações`}
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                isSelected
                                  ? "bg-white/25 text-white"
                                  : "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                              }`}
                            >
                              <Phone className="h-2.5 w-2.5" />
                              {calls}
                            </span>
                          )}
                          {whats > 0 && (
                            <span
                              title={`${whats} WhatsApps`}
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                isSelected
                                  ? "bg-white/25 text-white"
                                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                              }`}
                            >
                              <MessageSquare className="h-2.5 w-2.5" />
                              {whats}
                            </span>
                          )}
                          {meetings > 0 && (
                            <span
                              title={`${meetings} reuniões`}
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                isSelected
                                  ? "bg-white/25 text-white"
                                  : "bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                              }`}
                            >
                              <Users className="h-2.5 w-2.5" />
                              {meetings}
                            </span>
                          )}
                          {emails > 0 && (
                            <span
                              title={`${emails} e-mails`}
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                isSelected
                                  ? "bg-white/25 text-white"
                                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                              }`}
                            >
                              <Mail className="h-2.5 w-2.5" />
                              {emails}
                            </span>
                          )}
                          {others > 0 && (
                            <span
                              title={`${others} outras tarefas`}
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                isSelected
                                  ? "bg-white/25 text-white"
                                  : "bg-muted text-muted-foreground border border-border/50"
                              }`}
                            >
                              <ClipboardCheck className="h-2.5 w-2.5" />
                              {others}
                            </span>
                          )}
                        </div>

                        {/* Mini Barra de Progresso */}
                        <div className="w-full mt-0.5">
                          <div className={`w-full h-1 rounded-full overflow-hidden ${isSelected ? "bg-white/30" : "bg-muted"}`}>
                            <div
                              className={`h-full rounded-full transition-all ${isSelected ? "bg-white" : "bg-primary"}`}
                              style={{ width: `${Math.round((completed / total) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Painel Lateral com Filtros Rápidos (Otimizado para até 30 tarefas) */}
          <div className="w-[400px] flex flex-col overflow-hidden bg-card/40">
            {/* Cabeçalho do dia selecionado */}
            <div className="px-5 py-4 border-b border-border bg-card">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-foreground capitalize">
                    {selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedTasks.length === 0
                      ? "Nenhuma tarefa nesta data"
                      : `${selectedTasks.length} tarefa(s) vinculada(s)`}
                  </p>
                </div>
                <button
                  onClick={() => setIsCreateTaskModalOpen(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 transition cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nova
                </button>
              </div>

              {/* Filtros em Abas de Status */}
              {selectedTasks.length > 0 && (
                <div className="mt-3 flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl overflow-x-auto">
                  <button
                    onClick={() => setSelectedDayStatus("all")}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer shrink-0 ${
                      selectedDayStatus === "all" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Todas ({selectedTasks.length})
                  </button>
                  <button
                    onClick={() => setSelectedDayStatus("pending")}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer shrink-0 ${
                      selectedDayStatus === "pending" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Pendentes ({selectedTasks.filter((t) => t.status !== "done" && t.status !== "completed").length})
                  </button>
                  {selectedTasks.filter((t) => isTaskOverdue(t)).length > 0 && (
                    <button
                      onClick={() => setSelectedDayStatus("overdue")}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer shrink-0 ${
                        selectedDayStatus === "overdue" ? "bg-red-500/15 text-red-600 shadow-2xs" : "text-red-500/80 hover:text-red-600"
                      }`}
                    >
                      Atrasadas ({selectedTasks.filter((t) => isTaskOverdue(t)).length})
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedDayStatus("done")}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer shrink-0 ${
                      selectedDayStatus === "done" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Feitas ({selectedTasks.filter((t) => t.status === "done" || t.status === "completed").length})
                  </button>
                </div>
              )}

              {/* Busca e Filtro de Tipo */}
              {selectedTasks.length > 3 && (
                <div className="mt-2.5 space-y-2">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Pesquisar por título, cliente ou negócio..."
                      value={selectedDaySearch}
                      onChange={(e) => setSelectedDaySearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-background border border-border focus:outline-hidden focus:border-primary"
                    />
                    {selectedDaySearch && (
                      <button
                        onClick={() => setSelectedDaySearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* Chips de filtro por tipo */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                    {["all", "call", "whatsapp", "meeting", "email", "task"].map((tType) => {
                      const count = tType === "all" ? selectedTasks.length : selectedTasks.filter((t) => t.type === tType).length;
                      if (tType !== "all" && count === 0) return null;
                      return (
                        <button
                          key={tType}
                          onClick={() => setSelectedDayType(tType)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold shrink-0 transition cursor-pointer ${
                            selectedDayType === tType
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {tType !== "all" && getTaskTypeIcon(tType)}
                          <span>{tType === "all" ? "Todos tipos" : getTaskTypeLabel(tType)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Lista de tarefas do dia com ordenação temporal */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(() => {
                const dayAllTasks = sortTasksByTime(selectedTasks);
                const dayFilteredTasks = dayAllTasks.filter((t) => {
                  if (selectedDayStatus === "pending" && (t.status === "done" || t.status === "completed")) return false;
                  if (selectedDayStatus === "done" && t.status !== "done" && t.status !== "completed") return false;
                  if (selectedDayStatus === "overdue" && !isTaskOverdue(t)) return false;

                  if (selectedDayType !== "all" && t.type !== selectedDayType) return false;

                  if (selectedDaySearch.trim()) {
                    const q = selectedDaySearch.toLowerCase();
                    const matchName = t.name.toLowerCase().includes(q);
                    const matchClient = t.client?.name?.toLowerCase().includes(q);
                    const matchDeal = t.deal?.name?.toLowerCase().includes(q);
                    const matchDesc = t.description?.toLowerCase().includes(q);
                    if (!matchName && !matchClient && !matchDeal && !matchDesc) return false;
                  }
                  return true;
                });

                if (dayFilteredTasks.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Calendar className="h-10 w-10 text-muted-foreground/30 mb-2.5" />
                      <p className="text-sm font-semibold text-muted-foreground">
                        {selectedTasks.length === 0 ? "Nenhuma tarefa nesta data" : "Nenhuma tarefa com estes filtros"}
                      </p>
                      <button
                        onClick={() => setIsCreateTaskModalOpen(true)}
                        className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 transition cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Nova Tarefa
                      </button>
                    </div>
                  );
                }

                return dayFilteredTasks.map((task, index) => {
                  const isDone = task.status === "done" || task.status === "completed";
                  const isOverdue = isTaskOverdue(task);

                  return (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className={`group rounded-2xl border p-4 transition-all hover:shadow-md ${
                        isDone
                          ? "border-border/60 bg-muted/20 opacity-70"
                          : isOverdue
                            ? "border-red-500/40 bg-card hover:border-red-500"
                            : "border-border bg-card hover:border-primary/40"
                      }`}
                      style={{ borderLeft: `4px solid ${getTaskTypeColor(task.type)}` }}
                    >
                      {/* Linha Superior: Checkbox + Título + Horário */}
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleTaskStatus(task)}
                          className="mt-0.5 shrink-0 cursor-pointer"
                          title={isDone ? "Marcar como pendente" : "Concluir tarefa"}
                        >
                          {isDone ? (
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-semibold leading-snug ${
                              isDone ? "line-through text-muted-foreground" : "text-foreground"
                            }`}
                          >
                            {task.name}
                          </p>

                          {/* Tipo e Horário */}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <span
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                              style={{ background: getTaskTypeColor(task.type) }}
                            >
                              {getTaskTypeIcon(task.type)}
                              {getTaskTypeLabel(task.type)}
                            </span>

                            {task.dueDate && (
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                                  isOverdue ? "text-red-500 font-semibold" : "text-muted-foreground"
                                }`}
                              >
                                <Clock className="h-3 w-3" />
                                {formatTime(task.dueDate)}
                                {isOverdue && " (Atrasada)"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Informações do Cliente */}
                      {(task.client.name || task.client.phone) && (
                        <div className="mt-3 rounded-xl bg-background/60 p-2.5 border border-border/40">
                          {task.client.name && (
                            <p className="text-xs font-semibold text-foreground">{task.client.name}</p>
                          )}
                          {task.client.phone && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {formatPhone(task.client.phone)}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Informações da Negociação */}
                      {task.deal?.name && (
                        <a
                          href={`/crm/deals/${task.deal.id}?from=tasks`}
                          className="mt-2.5 flex items-center gap-1.5 text-[11px] text-primary hover:underline font-semibold cursor-pointer"
                          title="Abrir negociação no Kanban"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{task.deal.name}</span>
                          {task.deal.stageName && (
                            <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/40 ml-1">
                              {task.deal.stageName}
                            </span>
                          )}
                        </a>
                      )}

                      {/* Descrição */}
                      {task.description && (
                        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                          {task.description}
                        </p>
                      )}

                      {/* Botão de Atendimento */}
                      {task.chatConversationId ? (
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => openChat(task)}
                          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold text-white transition-all cursor-pointer shadow-xs"
                          style={{ background: "var(--primary)" }}
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          Abrir Atendimento
                        </motion.button>
                      ) : task.chatContactId ? (
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleStartChatWithContact(task.chatContactId!)}
                          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-all cursor-pointer"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          Iniciar Atendimento
                        </motion.button>
                      ) : null}
                    </motion.div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Visão Semana (7 Colunas com Scroll Vertical) */}
      {viewMode === "week" && (
        <div className="flex-1 grid grid-cols-7 gap-2.5 p-4 overflow-hidden bg-muted/10">
          {weekDays.map((wDate, idx) => {
            const isColToday = isSameDay(wDate, today);
            const isColSelected = isSameDay(wDate, selectedDate);
            const colTasks = sortTasksByTime(getTasksForDate(wDate));
            const colTotal = colTasks.length;
            const colCompleted = colTasks.filter((t) => t.status === "done" || t.status === "completed").length;
            const colOverdue = colTasks.filter((t) => isTaskOverdue(t)).length;

            return (
              <div
                key={idx}
                onClick={() => setSelectedDate(wDate)}
                className={`flex flex-col rounded-2xl border transition-all overflow-hidden ${
                  isColSelected
                    ? "border-primary shadow-sm bg-card ring-2 ring-primary/20"
                    : isColToday
                      ? "border-primary/50 bg-card/90"
                      : "border-border bg-card/60 hover:bg-card"
                }`}
              >
                {/* Cabeçalho da coluna */}
                <div
                  className={`p-3 border-b border-border flex items-center justify-between ${
                    isColSelected
                      ? "bg-primary/10"
                      : isColToday
                        ? "bg-primary-soft/50"
                        : "bg-muted/40"
                  }`}
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                      {WEEKDAYS[wDate.getDay()]}
                    </span>
                    <span className={`text-base font-extrabold ${isColSelected ? "text-primary" : "text-foreground"}`}>
                      {wDate.getDate()}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {MONTHS[wDate.getMonth()].slice(0, 3)}
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        colOverdue > 0
                          ? "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20"
                          : colTotal > 0
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {colTotal}
                    </span>
                    {colTotal > 0 && (
                      <span className="text-[9px] text-muted-foreground font-semibold">
                        {colCompleted}/{colTotal}
                      </span>
                    )}
                  </div>
                </div>

                {/* Lista scrollável da coluna */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[calc(100vh-270px)]">
                  {colTasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 text-center opacity-40">
                      <Calendar className="h-6 w-6 text-muted-foreground mb-1" />
                      <span className="text-[11px] text-muted-foreground">Sem tarefas</span>
                    </div>
                  ) : (
                    colTasks.map((t) => {
                      const isDone = t.status === "done" || t.status === "completed";
                      const isOverdue = isTaskOverdue(t);
                      return (
                        <div
                          key={t.id}
                          className={`rounded-xl border p-2.5 transition-all text-left relative ${
                            isDone
                              ? "border-border/60 bg-muted/20 opacity-60"
                              : isOverdue
                                ? "border-red-500/40 bg-red-500/5 hover:border-red-500"
                                : "border-border bg-card hover:border-primary/40 hover:shadow-2xs"
                          }`}
                          style={{ borderLeftWidth: "3.5px", borderLeftColor: getTaskTypeColor(t.type) }}
                        >
                          <div className="flex items-start gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTaskStatus(t);
                              }}
                              className="mt-0.5 shrink-0 cursor-pointer"
                              title={isDone ? "Marcar como pendente" : "Concluir tarefa"}
                            >
                              {isDone ? (
                                <CheckCircle2 className="h-4 w-4 text-primary" />
                              ) : (
                                <Circle className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {t.dueDate && (
                                  <span
                                    className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${
                                      isOverdue ? "text-red-500" : "text-muted-foreground"
                                    }`}
                                  >
                                    <Clock className="h-2.5 w-2.5" />
                                    {formatTime(t.dueDate)}
                                  </span>
                                )}
                                <span
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider text-white"
                                  style={{ background: getTaskTypeColor(t.type) }}
                                >
                                  {getTaskTypeIcon(t.type)}
                                  {getTaskTypeLabel(t.type)}
                                </span>
                              </div>
                              <p
                                className={`text-xs font-semibold leading-tight mt-1 line-clamp-2 ${
                                  isDone ? "line-through text-muted-foreground" : "text-foreground"
                                }`}
                              >
                                {t.name}
                              </p>
                              {t.client?.name && (
                                <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                                  {t.client.name}
                                </p>
                              )}
                              {t.deal?.name && (
                                <a
                                  href={`/crm/deals/${t.deal.id}?from=tasks`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[9px] text-primary truncate hover:underline flex items-center gap-1 mt-0.5 font-medium"
                                >
                                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                  <span className="truncate">{t.deal.name}</span>
                                </a>
                              )}
                            </div>
                          </div>

                          {t.chatConversationId && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openChat(t);
                              }}
                              className="mt-2 w-full py-1 text-[10px] font-bold rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <MessageSquare className="h-3 w-3" />
                              Atendimento
                            </button>
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
      )}

      {/* Visão Dia (Agenda por Blocos de Horário) */}
      {viewMode === "day" && (
        <div className="flex-1 flex flex-col overflow-y-auto p-6 bg-muted/10 space-y-6">
          {(() => {
            const dayTasks = getTasksForDate(selectedDate);
            const blocks = groupTasksByTimeBlock(dayTasks);
            const dayTotal = dayTasks.length;
            const dayCompleted = dayTasks.filter((t) => t.status === "done" || t.status === "completed").length;
            const dayOverdue = dayTasks.filter((t) => isTaskOverdue(t)).length;
            const dayPending = dayTotal - dayCompleted;

            return (
              <>
                {/* Cards de Resumo no Topo */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total do Dia</span>
                    <p className="text-2xl font-extrabold text-foreground mt-1">{dayTotal}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Pendentes</span>
                    <p className="text-2xl font-extrabold text-primary mt-1">{dayPending}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Atrasadas</span>
                    <p className={`text-2xl font-extrabold mt-1 ${dayOverdue > 0 ? "text-red-600" : "text-foreground"}`}>
                      {dayOverdue}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Concluídas</span>
                    <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
                      {dayCompleted}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({dayTotal > 0 ? Math.round((dayCompleted / dayTotal) * 100) : 0}%)
                      </span>
                    </p>
                  </div>
                </div>

                {dayTotal === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center bg-card rounded-3xl border border-border">
                    <Calendar className="h-12 w-12 text-muted-foreground/30 mb-3" />
                    <h3 className="text-base font-bold text-foreground">Nenhuma tarefa nesta data</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Você não tem compromissos agendados para este dia.
                    </p>
                    <button
                      onClick={() => setIsCreateTaskModalOpen(true)}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-xs cursor-pointer"
                      style={{ background: "var(--primary)" }}
                    >
                      <Plus className="h-4 w-4" />
                      Criar Tarefa
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Bloco 1: Atrasadas */}
                    {blocks.overdue.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <h4 className="text-sm font-bold uppercase tracking-wider">
                            Atrasadas ({blocks.overdue.length})
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {blocks.overdue.map((t) => renderDayAgendaCard(t, true))}
                        </div>
                      </div>
                    )}

                    {/* Bloco 2: Manhã (até 12h) */}
                    {blocks.morning.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-foreground font-bold">
                          <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                          <h4 className="text-sm font-bold uppercase tracking-wider">
                            Manhã — até 12:00 ({blocks.morning.length})
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {blocks.morning.map((t) => renderDayAgendaCard(t))}
                        </div>
                      </div>
                    )}

                    {/* Bloco 3: Tarde (12h às 18h) */}
                    {blocks.afternoon.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-foreground font-bold">
                          <Clock className="h-4 w-4 text-primary shrink-0" />
                          <h4 className="text-sm font-bold uppercase tracking-wider">
                            Tarde — 12:00 às 18:00 ({blocks.afternoon.length})
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {blocks.afternoon.map((t) => renderDayAgendaCard(t))}
                        </div>
                      </div>
                    )}

                    {/* Bloco 4: Noite ou Sem Horário */}
                    {blocks.eveningOrNoTime.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-foreground font-bold">
                          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                          <h4 className="text-sm font-bold uppercase tracking-wider">
                            Noite / Sem Horário Fixo ({blocks.eveningOrNoTime.length})
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {blocks.eveningOrNoTime.map((t) => renderDayAgendaCard(t))}
                        </div>
                      </div>
                    )}

                    {/* Bloco 5: Concluídas do Dia */}
                    {blocks.completed.length > 0 && (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          <h4 className="text-sm font-bold uppercase tracking-wider">
                            Concluídas do Dia ({blocks.completed.length})
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {blocks.completed.map((t) => renderDayAgendaCard(t))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

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
                    {configured
                      ? "Visualize, pesquise e gerencie todas as suas tarefas integradas do RD CRM."
                      : "Visualize, pesquise e gerencie todas as suas tarefas e compromissos do Kanban / CRM."}
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
                    const isOverdue =
                      task.status !== "done" &&
                      task.status !== "completed" &&
                      task.dueDate &&
                      new Date(task.dueDate) < new Date();
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
                                {getTaskTypeLabel(task.type)}
                              </span>
                              {task.operatorName && (
                                <span className="text-[10px] text-muted-foreground font-medium bg-muted/60 px-1.5 py-0.5 rounded-md border border-border/40">
                                  {task.operatorName}
                                </span>
                              )}
                              {task.dueDate && (
                                <span className={`flex items-center gap-1 text-[11px] ${isOverdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                                  <Clock className="h-3 w-3" />
                                  {new Date(task.dueDate).toLocaleDateString("pt-BR")} às {formatTime(task.dueDate)}
                                  {isOverdue && " (Atrasada)"}
                                </span>
                              )}
                            </div>

                            {task.deal?.name && (
                              <a
                                href={`/crm/deals/${task.deal.id}?from=tasks`}
                                className="mt-1.5 flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                                title="Abrir negociação no Kanban"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                <span className="truncate">{task.deal.name}</span>
                              </a>
                            )}

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
                          ) : task.chatContactId ? (
                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.97 }}
                              onClick={() => {
                                handleStartChatWithContact(task.chatContactId!);
                                setIsAllTasksModalOpen(false);
                              }}
                              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-all cursor-pointer shadow-sm"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              Iniciar Atendimento
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

      {/* Drawer lateral para criar nova tarefa no Kanban */}
      <CreateTaskModal
        isOpen={isCreateTaskModalOpen}
        onClose={() => setIsCreateTaskModalOpen(false)}
        onTaskCreated={fetchTasks}
        operators={operatorsList}
        currentOperatorId={currentOperatorId}
      />
    </section>
  );
}
