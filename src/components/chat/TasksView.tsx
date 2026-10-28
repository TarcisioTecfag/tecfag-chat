import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTrainingSurface } from "@/hooks/useTrainingSurface";
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
  Pencil,
  Trash2,
  Ban,
  CalendarClock,
  ChevronDown,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { CreateTaskModal, type EditingTaskData } from "../crm/CreateTaskModal";
import { CrmDatePicker } from "../crm/CrmDatePicker";
import { SystemDateTimePicker } from "@/components/ui/system-date-time-picker";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TaskData {
  id: string;
  name: string;
  type: string;
  status: string;
  dueDate: string | null;
  completedAt?: string | null;
  description: string | null;
  createdAt: string | null;
  deal: { id: string; name: string | null; value?: string | null; stageName?: string | null } | null;
  client: { name: string | null; phone: string | null };
  chatContactId: string | null;
  chatConversationId: string | null;
  source?: "kanban";
  operatorId?: string | null;
  assignedOperatorId?: string | null;
  creatorOperatorId?: string | null;
  dealOperatorId?: string | null;
  operatorName?: string | null;
  operatorEmail?: string | null;
  operatorAvatar?: string | null;
}

const ALL_TASK_TYPES = ["call", "whatsapp", "meeting", "email", "task", "lunch", "visit"] as const;

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

  const startDay = firstDay.getDay();
  for (let i = startDay - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }

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
  const day = d.getDay();
  const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const nextDay = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
    days.push(nextDay);
  }
  return days;
}

function isTaskDone(task: TaskData): boolean {
  return task.status === "done" || task.status === "completed";
}

function isTaskOverdue(task: TaskData): boolean {
  if (isTaskDone(task) || task.status === "cancelled") return false;
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

/**
 * Agrupa as tarefas do dia mantendo cada compromisso em seu turno cronológico
 * (Manhã, Tarde, Noite/Sem horário) mesmo quando atrasado, além de listar as concluídas.
 */
function groupTasksByTimeBlock(dayTasks: TaskData[]) {
  const sorted = sortTasksByTime(dayTasks);

  const overdue: TaskData[] = [];
  const morning: TaskData[] = [];
  const afternoon: TaskData[] = [];
  const eveningOrNoTime: TaskData[] = [];
  const completed: TaskData[] = [];

  for (const t of sorted) {
    if (isTaskDone(t)) {
      completed.push(t);
      continue;
    }
    if (isTaskOverdue(t)) {
      overdue.push(t);
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

function getTaskTypeColor(_type: string): string {
  return "var(--primary)";
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

function buildQuickRescheduleDate(preset: "plus1h" | "today16" | "tomorrow9" | "nextMonday9"): Date {
  const now = new Date();
  if (preset === "plus1h") {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
  if (preset === "today16") {
    const d = new Date(now);
    d.setHours(16, 0, 0, 0);
    if (d <= now) d.setTime(now.getTime() + 60 * 60 * 1000);
    return d;
  }
  if (preset === "tomorrow9") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  const d = new Date(now);
  const day = d.getDay();
  const diffToMonday = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(9, 0, 0, 0);
  return d;
}

function getDefaultFollowUpDateTimeStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T09:00`;
}

const TASK_VIEW_MODES = ["month", "week", "day"] as const;

export function TasksView() {
  const navigate = useNavigate();
  const {
    tenant,
    setSelectedChatId,
    setActiveView,
    setActiveQueue,
    currentOperatorId,
    sessionRole,
    refreshConversations,
  } = useChat();

  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<EditingTaskData | null>(null);
  const [operatorsList, setOperatorsList] = useState<Array<{ id: string; name: string }>>([]);

  // Escopo de visualização e filtro de operador (Admin)
  const [taskScope, setTaskScope] = useState<"all" | "mine" | "delegated">("all");
  const [selectedOperatorFilter, setSelectedOperatorFilter] = useState<string>("all");
  const [isOperatorPopoverOpen, setIsOperatorPopoverOpen] = useState(false);

  // Modal de Confirmação de Conclusão de Tarefa (OBRIGATÓRIO)
  const [taskToComplete, setTaskToComplete] = useState<TaskData | null>(null);
  const [completionNote, setCompletionNote] = useState("");
  const [scheduleNextFollowUp, setScheduleNextFollowUp] = useState(false);
  const [nextFollowUpTitle, setNextFollowUpTitle] = useState("");
  const [nextFollowUpType, setNextFollowUpType] = useState<string>("task");
  const [nextFollowUpDateTime, setNextFollowUpDateTime] = useState<string>(() => getDefaultFollowUpDateTimeStr());
  const [isSubmittingCompletion, setIsSubmittingCompletion] = useState(false);

  // Modal de Confirmação de Cancelamento / Exclusão
  const [taskActionConfirm, setTaskActionConfirm] = useState<{
    task: TaskData;
    action: "cancel" | "delete";
  } | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Popover de reagendamento rápido
  const [rescheduleTaskId, setRescheduleTaskId] = useState<string | null>(null);
  const [customRescheduleValue, setCustomRescheduleValue] = useState<string>("");

  // Modo de visualização: Mês | Semana | Dia
  const [viewMode, setViewMode] = useState<"month" | "week" | "day">(() =>
    getInitialTabFromUrl("tasks", "month", TASK_VIEW_MODES),
  );

  useTabNavigation({
    tabs: TASK_VIEW_MODES,
    activeTab: viewMode,
    onChange: setViewMode,
  });

  useSyncModuleTabWithUrl({
    viewId: "tasks",
    activeTab: viewMode,
    setActiveTab: setViewMode,
    allowedTabs: TASK_VIEW_MODES,
  });

  // Filtros internos do painel diário
  const [selectedDaySearch, setSelectedDaySearch] = useState("");
  const [selectedDayStatus, setSelectedDayStatus] = useState<"all" | "pending" | "overdue" | "done">("all");
  const [selectedDayType, setSelectedDayType] = useState<string>("all");

  // Estados do Modal "Todas" (Filtro e Busca global)
  const [isAllTasksModalOpen, setIsAllTasksModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "overdue" | "completed">("all");
  const [typeFilterGlobal, setTypeFilterGlobal] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState("");
  const [isBulkRescheduling, setIsBulkRescheduling] = useState(false);

  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date>(today);

  const notifiedTasksRef = useRef<Set<string>>(new Set());

  useTrainingSurface("tasks", (step) => {
    if (loading) return false;
    setIsCreateTaskModalOpen(step.surface === "tasks.create-modal");
    setIsAllTasksModalOpen(step.id === "tasks.all");
    if (["tasks.item", "tasks.chat", "tasks.day-filters", "tasks.day"].includes(step.id)) setViewMode("day");
    else if (step.id === "tasks.week") setViewMode("week");
    else if (step.id === "tasks.month") setViewMode("month");
    return true;
  });

  const days = getDaysInMonth(currentYear, currentMonth);
  const weekDays = getWeekDays(selectedDate);
  const startWeekDay = weekDays[0];
  const endWeekDay = weekDays[6];

  // ─── Carrega operadores para CreateTaskModal e filtro Admin ──────────────
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

  // ─── Fetch tasks from API (100% Kanban CRM Local) ───────────────────────
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tenant) params.set("tenantId", tenant);
      params.set("scope", taskScope);
      if (sessionRole === "admin" && selectedOperatorFilter !== "all") {
        params.set("operatorFilterId", selectedOperatorFilter);
      } else if (sessionRole === "admin" && selectedOperatorFilter === "all" && taskScope === "all") {
        params.set("all", "true");
      }
      const res = await fetch(`/api/tasks?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setTasks([]);
      } else {
        setTasks(data.tasks || []);
      }
    } catch (e: any) {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [tenant, taskScope, sessionRole, selectedOperatorFilter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // ─── Alerta de Compromisso Próximo (15 minutos antes) ───────────────────
  useEffect(() => {
    const checkUpcomingTasks = () => {
      const now = Date.now();
      const fifteenMinutesMs = 15 * 60 * 1000;
      for (const t of tasks) {
        if (isTaskDone(t) || !t.dueDate) continue;
        if (notifiedTasksRef.current.has(t.id)) continue;
        const dueMs = new Date(t.dueDate).getTime();
        const diff = dueMs - now;
        if (diff > 0 && diff <= fifteenMinutesMs) {
          notifiedTasksRef.current.add(t.id);
          const mins = Math.max(1, Math.round(diff / 60000));
          toast.info(`Compromisso em ${mins} min: ${t.name}`, {
            description: t.client?.name
              ? `Cliente: ${t.client.name} às ${formatTime(t.dueDate)}`
              : `Horário: ${formatTime(t.dueDate)}`,
            duration: 8000,
          });
        }
      }
    };

    checkUpcomingTasks();
    const timer = window.setInterval(checkUpcomingTasks, 60000);
    return () => window.clearInterval(timer);
  }, [tasks]);

  // ─── Abrir Modal de Confirmação para Concluir Tarefa (Sem Reativação!) ──
  const handleRequestCompleteTask = (task: TaskData) => {
    if (isTaskDone(task)) {
      // Tarefas já concluídas NUNCA são reativadas ao clicar novamente
      toast.info("Esta tarefa já foi concluída e não pode ser reativada.");
      return;
    }
    setTaskToComplete(task);
    setCompletionNote("");
    setScheduleNextFollowUp(false);
    setNextFollowUpTitle(`Follow-up: ${task.name}`);
    setNextFollowUpType(task.type || "task");
    setNextFollowUpDateTime(getDefaultFollowUpDateTimeStr());
  };

  const handleConfirmCompleteTask = async () => {
    if (!taskToComplete) return;
    setIsSubmittingCompletion(true);
    const targetTask = taskToComplete;

    try {
      const payload: Record<string, any> = {
        tenantId: tenant,
        taskId: targetTask.id,
        status: "done",
      };

      if (completionNote.trim()) {
        payload.completionNote = completionNote.trim();
      }

      if (scheduleNextFollowUp && targetTask.deal?.id && nextFollowUpTitle.trim()) {
        const parsedNextDate = nextFollowUpDateTime ? new Date(nextFollowUpDateTime) : null;
        payload.nextTask = {
          title: nextFollowUpTitle.trim(),
          type: nextFollowUpType || "task",
          dueDate:
            parsedNextDate && !Number.isNaN(parsedNextDate.getTime())
              ? parsedNextDate.toISOString()
              : null,
          assignedToOperatorId: targetTask.assignedOperatorId || currentOperatorId || null,
        };
      }

      const response = await fetch("/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "Não foi possível concluir a tarefa.");
      }

      setTasks((prev) =>
        prev.map((t) =>
          t.id === targetTask.id
            ? { ...t, status: "done", completedAt: new Date().toISOString() }
            : t,
        ),
      );
      toast.success(
        scheduleNextFollowUp && targetTask.deal?.id
          ? "Tarefa concluída e próximo follow-up agendado!"
          : "Tarefa concluída com sucesso!",
      );
      setTaskToComplete(null);
      if (scheduleNextFollowUp) {
        fetchTasks();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao concluir a tarefa.");
    } finally {
      setIsSubmittingCompletion(false);
    }
  };

  // ─── Reagendar Tarefa ───────────────────────────────────────────────────
  const handleRescheduleTask = async (task: TaskData, newDate: Date) => {
    if (Number.isNaN(newDate.getTime())) {
      toast.error("Data inválida para reagendamento.");
      return;
    }
    const iso = newDate.toISOString();
    const prevDueDate = task.dueDate;

    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, dueDate: iso } : t)));
    setRescheduleTaskId(null);

    try {
      const res = await fetch("/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          taskId: task.id,
          dueDate: iso,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao reagendar tarefa.");
      }
      toast.success(
        `Tarefa reagendada para ${newDate.toLocaleDateString("pt-BR")} às ${newDate.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })}`,
      );
    } catch (err: any) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, dueDate: prevDueDate } : t)));
      toast.error(err?.message || "Não foi possível reagendar a tarefa.");
    }
  };

  // ─── Reagendar Atrasadas em Lote ────────────────────────────────────────
  const handleBulkRescheduleOverdue = async (taskIds: string[], targetDate: Date) => {
    if (taskIds.length === 0) return;
    setIsBulkRescheduling(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_reschedule",
          taskIds,
          dueDate: targetDate.toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Não foi possível reagendar as tarefas atrasadas.");
      }
      toast.success(`${taskIds.length} tarefa(s) reagendada(s) com sucesso!`);
      await fetchTasks();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao reagendar tarefas em lote.");
    } finally {
      setIsBulkRescheduling(false);
    }
  };

  // ─── Cancelar ou Excluir Tarefa ─────────────────────────────────────────
  const handleConfirmCancelOrDelete = async () => {
    if (!taskActionConfirm) return;
    const { task, action } = taskActionConfirm;
    setIsSubmittingAction(true);
    try {
      if (action === "cancel") {
        const res = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant,
            taskId: task.id,
            status: "cancelled",
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Não foi possível cancelar a tarefa.");
        }
        setTasks((prev) => prev.filter((t) => t.id !== task.id));
        toast.success("Tarefa cancelada.");
      } else {
        const res = await fetch(`/api/tasks?taskId=${encodeURIComponent(task.id)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Não foi possível excluir a tarefa.");
        }
        setTasks((prev) => prev.filter((t) => t.id !== task.id));
        toast.success("Tarefa excluída permanentemente.");
      }
      setTaskActionConfirm(null);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao processar ação na tarefa.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // ─── Abrir Modal de Edição ──────────────────────────────────────────────
  const handleOpenEditTask = (task: TaskData) => {
    if (isTaskDone(task)) {
      toast.info("Tarefas concluídas não podem ser editadas.");
      return;
    }
    setEditingTask({
      id: task.id,
      name: task.name,
      type: task.type,
      dueDate: task.dueDate,
      description: task.description,
      assignedOperatorId: task.assignedOperatorId || task.operatorId || currentOperatorId,
      dealId: task.deal?.id || "",
      dealTitle: task.deal?.name || null,
      accountName: task.client?.name || null,
      deal: task.deal ? { id: task.deal.id, name: task.deal.name } : null,
      client: task.client,
    });
    setIsCreateTaskModalOpen(true);
  };

  // ─── Navegação SPA para Negociação no Kanban ────────────────────────────
  const handleNavigateToDeal = (dealId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    navigate({
      to: "/crm/deals/$dealId",
      params: { dealId },
      search: { from: "tasks" } as any,
    });
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
  const pendingCount = tasks.filter((t) => !isTaskDone(t)).length;
  const globalOverdueTasks = tasks.filter((t) => isTaskOverdue(t));

  // ─── Subcomponente de Ações Rápidas da Tarefa (Reagendar, Editar, Cancelar, Excluir) ──
  const renderTaskQuickActions = (task: TaskData, compact = false) => {
    const isDone = isTaskDone(task);

    if (isDone) {
      return (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <SystemTooltip content="Excluir tarefa">
            <button
              type="button"
              onClick={() => setTaskActionConfirm({ task, action: "delete" })}
              className="p-1 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </SystemTooltip>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        {/* Popover de Reagendamento Rápido */}
        <Popover
          open={rescheduleTaskId === task.id}
          onOpenChange={(open) => {
            setRescheduleTaskId(open ? task.id : null);
            if (open && task.dueDate) {
              const d = new Date(task.dueDate);
              if (!Number.isNaN(d.getTime())) {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const day = String(d.getDate()).padStart(2, "0");
                const hh = String(d.getHours()).padStart(2, "0");
                const mm = String(Math.floor(d.getMinutes() / 5) * 5).padStart(2, "0");
                setCustomRescheduleValue(`${y}-${m}-${day}T${hh}:${mm}`);
              }
            }
          }}
        >
          <SystemTooltip content="Reagendar tarefa">
            <PopoverTrigger asChild>
              <button
                type="button"
                className="p-1 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition cursor-pointer"
              >
                <CalendarClock className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
              </button>
            </PopoverTrigger>
          </SystemTooltip>
          <PopoverContent align="end" className="w-72 p-3 rounded-2xl space-y-2.5 z-[10100]">
            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-primary" />
              Reagendar Compromisso
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => handleRescheduleTask(task, buildQuickRescheduleDate("plus1h"))}
                className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-muted/70 hover:bg-primary/15 hover:text-primary text-foreground transition text-left cursor-pointer"
              >
                +1 hora
              </button>
              <button
                type="button"
                onClick={() => handleRescheduleTask(task, buildQuickRescheduleDate("today16"))}
                className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-muted/70 hover:bg-primary/15 hover:text-primary text-foreground transition text-left cursor-pointer"
              >
                Hoje às 16:00
              </button>
              <button
                type="button"
                onClick={() => handleRescheduleTask(task, buildQuickRescheduleDate("tomorrow9"))}
                className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-muted/70 hover:bg-primary/15 hover:text-primary text-foreground transition text-left cursor-pointer"
              >
                Amanhã 09:00
              </button>
              <button
                type="button"
                onClick={() => handleRescheduleTask(task, buildQuickRescheduleDate("nextMonday9"))}
                className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-muted/70 hover:bg-primary/15 hover:text-primary text-foreground transition text-left cursor-pointer"
              >
                Próx. Seg 09:00
              </button>
            </div>
            <div className="pt-1.5 border-t border-border/60 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                Ou escolher data e hora:
              </span>
              <SystemDateTimePicker
                mode="datetime"
                value={customRescheduleValue}
                onChange={(val) => setCustomRescheduleValue(val)}
                placeholder="Data e hora"
              />
              <button
                type="button"
                disabled={!customRescheduleValue}
                onClick={() => {
                  if (!customRescheduleValue) return;
                  handleRescheduleTask(task, new Date(customRescheduleValue));
                }}
                className="w-full py-1.5 rounded-xl text-xs font-bold text-white bg-primary hover:opacity-95 disabled:opacity-50 transition cursor-pointer"
              >
                Salvar Nova Data
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Botão Editar */}
        <SystemTooltip content="Editar tarefa">
          <button
            type="button"
            onClick={() => handleOpenEditTask(task)}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          >
            <Pencil className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        </SystemTooltip>

        {/* Botão Cancelar */}
        {!compact && (
          <SystemTooltip content="Cancelar tarefa">
            <button
              type="button"
              onClick={() => setTaskActionConfirm({ task, action: "cancel" })}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            >
              <Ban className="h-4 w-4" />
            </button>
          </SystemTooltip>
        )}

        {/* Botão Excluir */}
        <SystemTooltip content="Excluir tarefa">
          <button
            type="button"
            onClick={() => setTaskActionConfirm({ task, action: "delete" })}
            className="p-1 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition cursor-pointer"
          >
            <Trash2 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        </SystemTooltip>
      </div>
    );
  };

  const renderDayAgendaCard = (task: TaskData, forceOverdue = false) => {
    const isDone = isTaskDone(task);
    const isOverdue = forceOverdue || isTaskOverdue(task);

    return (
      <div
        key={task.id}
        data-tour="tasks.item"
        className={`rounded-2xl border p-4 transition-all hover:shadow-xs flex flex-col justify-between ${
          isDone
            ? "border-border/60 bg-muted/20 opacity-75"
            : isOverdue
              ? "border-red-500/40 bg-card hover:border-red-500/80"
              : "border-border bg-card hover:border-primary/40"
        }`}
        style={{ borderLeft: `4px solid ${getTaskTypeColor(task.type)}` }}
      >
        <div>
          <div className="flex items-start gap-3">
            <SystemTooltip
              content={
                isDone
                  ? "Tarefa concluída (não pode ser reativada)"
                  : "Clique para concluir a tarefa"
              }
            >
              <button
                type="button"
                onClick={() => handleRequestCompleteTask(task)}
                className={`mt-0.5 shrink-0 ${isDone ? "cursor-default" : "cursor-pointer"}`}
              >
                {isDone ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground hover:text-primary transition-colors" />
                )}
              </button>
            </SystemTooltip>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
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
                        isOverdue && !isDone ? "text-red-500" : "text-muted-foreground"
                      }`}
                    >
                      <Clock className="h-3 w-3" />
                      {formatTime(task.dueDate)}
                      {isOverdue && !isDone && " (Atrasada)"}
                    </span>
                  )}
                  {isDone && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 text-[9px] font-bold">
                      Concluída
                    </span>
                  )}
                </div>
                {renderTaskQuickActions(task)}
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
                <button
                  type="button"
                  onClick={(e) => handleNavigateToDeal(task.deal!.id, e)}
                  className="inline-flex items-center gap-1 text-primary hover:underline font-medium text-[11px] truncate max-w-[200px] cursor-pointer"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{task.deal.name}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Rodapé / Ação de Chat */}
        <div className="mt-3 pt-2">
          {task.chatConversationId ? (
            <button
              type="button"
              data-tour="tasks.chat"
              onClick={() => openChat(task)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-semibold text-white transition-all cursor-pointer shadow-2xs"
              style={{ background: "var(--primary)" }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Abrir Atendimento
            </button>
          ) : task.chatContactId ? (
            <button
              type="button"
              data-tour="tasks.chat"
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

  return (
    <section className="flex h-full flex-col rounded-3xl bg-chat-panel shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 md:gap-3 border-b border-border px-3.5 md:px-8 py-3 md:py-5">
        <div className="flex items-center gap-2.5 md:gap-4 min-w-0">
          <div
            className="flex h-9 w-9 md:h-11 md:w-11 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: "var(--primary-soft)" }}
          >
            <ClipboardCheck className="h-4.5 w-4.5 md:h-5 md:w-5" style={{ color: "var(--primary)" }} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-sm sm:text-base md:text-xl font-bold text-foreground truncate">
                Tarefas e Compromissos
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                Kanban CRM
              </span>
              {globalOverdueTasks.length > 0 && (
                <SystemTooltip content="Ver todas as tarefas em atraso e reagendar">
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter("overdue");
                      setIsAllTasksModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/25 transition cursor-pointer"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {globalOverdueTasks.length} atrasada{globalOverdueTasks.length > 1 ? "s" : ""}
                  </button>
                </SystemTooltip>
              )}
            </div>
            <p className="text-[11px] md:text-xs text-muted-foreground mt-0.5 truncate">
               Agenda comercial sincronizada com as negociações do Kanban
              {" • "}
              {pendingCount > 0
                ? `${pendingCount} pendente${pendingCount > 1 ? "s" : ""}`
                : "Nenhuma tarefa pendente"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full md:w-auto">
          {/* Seletor de Escopo: Todas / Minhas / Delegadas */}
          <div className="hidden xl:flex bg-muted rounded-xl p-1 shrink-0 border border-border/60">
            {(
              [
                { id: "all", label: "Todas" },
                { id: "mine", label: "Minhas" },
                { id: "delegated", label: "Delegadas" },
              ] as const
            ).map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => setTaskScope(sc.id)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  taskScope === sc.id
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {sc.label}
              </button>
            ))}
          </div>

          {/* Seletor de Operador para Admins */}
          {sessionRole === "admin" && operatorsList.length > 0 && (
            <Popover open={isOperatorPopoverOpen} onOpenChange={setIsOperatorPopoverOpen}>
              <SystemTooltip content="Filtrar agenda por operador">
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-xl border border-border px-2.5 py-2 text-xs font-semibold text-foreground hover:bg-card transition cursor-pointer"
                  >
                    <UserCheck className="h-3.5 w-3.5 text-primary" />
                    <span className="max-w-[110px] truncate">
                      {selectedOperatorFilter === "all"
                        ? "Equipe"
                        : operatorsList.find((o) => o.id === selectedOperatorFilter)?.name || "Operador"}
                    </span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
              </SystemTooltip>
              <PopoverContent align="end" className="w-56 p-1.5 rounded-2xl max-h-72 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOperatorFilter("all");
                    setIsOperatorPopoverOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                    selectedOperatorFilter === "all"
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span>Toda a Equipe</span>
                  {selectedOperatorFilter === "all" && <Check className="h-3.5 w-3.5" />}
                </button>
                {operatorsList.map((op) => (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => {
                      setSelectedOperatorFilter(op.id);
                      setIsOperatorPopoverOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                      selectedOperatorFilter === op.id
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="truncate">{op.name}</span>
                    {selectedOperatorFilter === op.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}

          {/* Seletor de Modo de Visualização: Mês / Semana / Dia */}
          <div className="flex bg-muted rounded-xl p-1 shrink-0 border border-border/60">
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={`flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === "month"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              Mês
            </button>
            <button
              type="button"
              onClick={() => setViewMode("week")}
              className={`flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === "week"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" />
              Semana
            </button>
            <button
              type="button"
              onClick={() => setViewMode("day")}
              className={`flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
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
            type="button"
            onClick={() => {
              setStatusFilter("all");
              setIsAllTasksModalOpen(true);
            }}
            className="rounded-xl border border-border px-2.5 sm:px-3 py-2 text-xs font-semibold text-foreground transition-all hover:bg-card hover:shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <List className="h-3.5 w-3.5" />
            Todas
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-xl border border-border px-2.5 sm:px-3 py-2 text-xs font-semibold text-foreground transition-all hover:bg-card hover:shadow-xs cursor-pointer"
          >
            Hoje
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingTask(null);
              setIsCreateTaskModalOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-xl px-3 sm:px-3.5 py-2 text-xs font-semibold text-white transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-xs"
            style={{ background: "var(--primary)" }}
          >
            <Plus className="h-4 w-4" />
            Nova Tarefa
          </button>

          <SystemTooltip content="Atualizar lista de tarefas">
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={fetchTasks}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl border border-border px-2.5 sm:px-3 py-2 text-xs font-semibold text-foreground transition-all hover:bg-card disabled:opacity-60 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Atualizar</span>
            </motion.button>
          </SystemTooltip>
        </div>
      </div>

      {/* Barra de Navegação Temporal Unificada */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 md:px-8 py-2.5 md:py-3 border-b border-border/80 bg-muted/20">
        <div className="flex items-center gap-2 md:gap-3">
          <SystemTooltip content="Período anterior">
            <motion.button
              type="button"
              whileTap={{ scale: 0.9 }}
              onClick={handlePrev}
              className="rounded-xl p-1.5 md:p-2 hover:bg-card transition-colors border border-border/50 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4 text-foreground" />
            </motion.button>
          </SystemTooltip>
          <h2 className="text-sm md:text-base font-bold text-foreground capitalize">
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
          <SystemTooltip content="Próximo período">
            <motion.button
              type="button"
              whileTap={{ scale: 0.9 }}
              onClick={handleNext}
              className="rounded-xl p-1.5 md:p-2 hover:bg-card transition-colors border border-border/50 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4 text-foreground" />
            </motion.button>
          </SystemTooltip>
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
        <div className="flex flex-col lg:flex-row flex-1 overflow-y-auto lg:overflow-hidden">
          {/* Calendário Mensal */}
          <div className="flex-1 flex flex-col p-2.5 sm:p-4 md:p-6 overflow-visible lg:overflow-auto border-b lg:border-b-0 lg:border-r border-border">
            {/* Cabeçalho dos Dias da Semana */}
            <div className="grid grid-cols-7 gap-1 mb-2 md:mb-3 border-b border-border pb-2 md:pb-2.5 bg-muted/40 dark:bg-muted/10 rounded-xl md:rounded-2xl px-1.5 md:px-2 py-1 md:py-1.5 shadow-2xs">
              {WEEKDAYS.map((day) => (
                <div key={day} className="text-center text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-muted-foreground/90">
                  {day}
                </div>
              ))}
            </div>

            {/* Grade de Dias do Mês */}
            <div data-tour="tasks.month-grid" className="grid grid-cols-7 gap-1 md:gap-1.5 flex-1">
              {days.map((date, i) => {
                const isCurrentMonth = date.getMonth() === currentMonth;
                const isToday = isSameDay(date, today);
                const isSelected = isSameDay(date, selectedDate);
                const dayTasks = getTasksForDate(date);
                const total = dayTasks.length;
                const completed = dayTasks.filter((t) => isTaskDone(t)).length;
                const overdue = dayTasks.filter((t) => isTaskOverdue(t)).length;

                const calls = dayTasks.filter((t) => t.type === "call").length;
                const whats = dayTasks.filter((t) => t.type === "whatsapp").length;
                const meetings = dayTasks.filter((t) => t.type === "meeting").length;
                const emails = dayTasks.filter((t) => t.type === "email").length;
                const lunches = dayTasks.filter((t) => t.type === "lunch").length;
                const visits = dayTasks.filter((t) => t.type === "visit").length;
                const others = total - (calls + whats + meetings + emails + lunches + visits);

                return (
                  <motion.button
                    type="button"
                    key={i}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedDate(date)}
                    className="relative flex flex-col items-center justify-start rounded-xl md:rounded-2xl p-1.5 md:p-2 transition-all min-h-[46px] sm:min-h-[68px] md:min-h-[95px] border w-full overflow-hidden cursor-pointer text-left"
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
                    <div className="w-full flex items-center justify-between mb-0.5 md:mb-1">
                      <span className={`text-[11px] md:text-xs font-extrabold ${isSelected ? "text-white" : "text-foreground/90"}`}>
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
                          const isDone = isTaskDone(t);
                          return (
                            <SystemTooltip
                              key={j}
                              content={`${t.name}${t.client?.name ? ` (${t.client.name})` : ""}`}
                            >
                              <div
                                className={`text-[9px] px-1.5 py-0.5 rounded-md truncate w-full font-medium flex items-center gap-1 border transition-all ${
                                  isSelected
                                    ? "bg-white/25 text-white border-white/10"
                                    : "bg-muted/60 text-foreground/80 border-border/40 hover:border-primary/20"
                                } ${isDone ? "line-through opacity-50" : ""}`}
                              >
                                <span className="shrink-0">{getTaskTypeIcon(t.type)}</span>
                                <span className="truncate">{label}</span>
                              </div>
                            </SystemTooltip>
                          );
                        })}
                      </div>
                    )}

                    {/* Alto Volume (3+ tarefas): Painel Resumo de Carga */}
                    {total > 2 && (
                      <div className="flex flex-col gap-1.5 w-full mt-1 overflow-hidden">
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

                        <div className="flex flex-wrap items-center gap-1 w-full justify-center">
                          {calls > 0 && (
                            <SystemTooltip content={`${calls} ligação(ões)`}>
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                  isSelected
                                    ? "bg-white/25 text-white"
                                    : "bg-primary/10 text-primary border border-primary/20"
                                }`}
                              >
                                <Phone className="h-2.5 w-2.5" />
                                {calls}
                              </span>
                            </SystemTooltip>
                          )}
                          {whats > 0 && (
                            <SystemTooltip content={`${whats} WhatsApp(s)`}>
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                  isSelected
                                    ? "bg-white/25 text-white"
                                    : "bg-primary/10 text-primary border border-primary/20"
                                }`}
                              >
                                <MessageSquare className="h-2.5 w-2.5" />
                                {whats}
                              </span>
                            </SystemTooltip>
                          )}
                          {meetings > 0 && (
                            <SystemTooltip content={`${meetings} reunião(ões)`}>
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                  isSelected
                                    ? "bg-white/25 text-white"
                                    : "bg-primary/10 text-primary border border-primary/20"
                                }`}
                              >
                                <Users className="h-2.5 w-2.5" />
                                {meetings}
                              </span>
                            </SystemTooltip>
                          )}
                          {emails > 0 && (
                            <SystemTooltip content={`${emails} e-mail(s)`}>
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                  isSelected
                                    ? "bg-white/25 text-white"
                                    : "bg-primary/10 text-primary border border-primary/20"
                                }`}
                              >
                                <Mail className="h-2.5 w-2.5" />
                                {emails}
                              </span>
                            </SystemTooltip>
                          )}
                          {lunches > 0 && (
                            <SystemTooltip content={`${lunches} almoço(s)`}>
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                  isSelected
                                    ? "bg-white/25 text-white"
                                    : "bg-primary/10 text-primary border border-primary/20"
                                }`}
                              >
                                <Utensils className="h-2.5 w-2.5" />
                                {lunches}
                              </span>
                            </SystemTooltip>
                          )}
                          {visits > 0 && (
                            <SystemTooltip content={`${visits} visita(s)`}>
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                  isSelected
                                    ? "bg-white/25 text-white"
                                    : "bg-primary/10 text-primary border border-primary/20"
                                }`}
                              >
                                <MapPin className="h-2.5 w-2.5" />
                                {visits}
                              </span>
                            </SystemTooltip>
                          )}
                          {others > 0 && (
                            <SystemTooltip content={`${others} tarefa(s)`}>
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                  isSelected
                                    ? "bg-white/25 text-white"
                                    : "bg-muted text-muted-foreground border border-border/50"
                                }`}
                              >
                                <ClipboardCheck className="h-2.5 w-2.5" />
                                {others}
                              </span>
                            </SystemTooltip>
                          )}
                        </div>

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

          {/* Painel Lateral com Filtros Rápidos */}
          <div className="w-full lg:w-[410px] min-h-[280px] lg:min-h-0 flex flex-col overflow-visible lg:overflow-hidden bg-card/40 shrink-0">
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
                  type="button"
                  onClick={() => {
                    setEditingTask(null);
                    setIsCreateTaskModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 transition cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nova
                </button>
              </div>

              {/* Filtros em Abas de Status */}
              {selectedTasks.length > 0 && (
                <div data-tour="tasks.day-filters" className="mt-3 flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setSelectedDayStatus("all")}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer shrink-0 ${
                      selectedDayStatus === "all" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Todas ({selectedTasks.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDayStatus("pending")}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer shrink-0 ${
                      selectedDayStatus === "pending" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Pendentes ({selectedTasks.filter((t) => !isTaskDone(t)).length})
                  </button>
                  {selectedTasks.filter((t) => isTaskOverdue(t)).length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDayStatus("overdue")}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer shrink-0 ${
                        selectedDayStatus === "overdue" ? "bg-red-500/15 text-red-600 shadow-2xs" : "text-red-500/80 hover:text-red-600"
                      }`}
                    >
                      Atrasadas ({selectedTasks.filter((t) => isTaskOverdue(t)).length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedDayStatus("done")}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer shrink-0 ${
                      selectedDayStatus === "done" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Feitas ({selectedTasks.filter((t) => isTaskDone(t)).length})
                  </button>
                </div>
              )}

              {/* Busca e Filtro de Tipo (Todos os 7 tipos) */}
              {selectedTasks.length > 1 && (
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
                        type="button"
                        onClick={() => setSelectedDaySearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                    {["all", ...ALL_TASK_TYPES].map((tType) => {
                      const count = tType === "all" ? selectedTasks.length : selectedTasks.filter((t) => t.type === tType).length;
                      if (tType !== "all" && count === 0) return null;
                      return (
                        <button
                          type="button"
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
                  if (selectedDayStatus === "pending" && isTaskDone(t)) return false;
                  if (selectedDayStatus === "done" && !isTaskDone(t)) return false;
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

                if (loading && tasks.length === 0) {
                  return (
                    <div className="space-y-3 animate-in fade-in duration-150">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="rounded-2xl border border-border bg-card p-4 space-y-2.5 shadow-xs">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-5 w-5 rounded-full shrink-0" />
                            <div className="flex-1 space-y-1.5">
                              <Skeleton className="h-3.5 w-4/5 rounded" />
                              <Skeleton className="h-2.5 w-1/3 rounded" />
                            </div>
                          </div>
                          <Skeleton className="h-8 w-full rounded-xl bg-muted/40" />
                        </div>
                      ))}
                    </div>
                  );
                }

                if (dayFilteredTasks.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Calendar className="h-10 w-10 text-muted-foreground/30 mb-2.5" />
                      <p className="text-sm font-semibold text-muted-foreground">
                        {selectedTasks.length === 0 ? "Nenhuma tarefa nesta data" : "Nenhuma tarefa com estes filtros"}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTask(null);
                          setIsCreateTaskModalOpen(true);
                        }}
                        className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 transition cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Nova Tarefa
                      </button>
                    </div>
                  );
                }

                return dayFilteredTasks.map((task, index) => {
                  const isDone = isTaskDone(task);
                  const isOverdue = isTaskOverdue(task);

                  return (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className={`group rounded-2xl border p-4 transition-all hover:shadow-md ${
                        isDone
                          ? "border-border/60 bg-muted/20 opacity-75"
                          : isOverdue
                            ? "border-red-500/40 bg-card hover:border-red-500"
                            : "border-border bg-card hover:border-primary/40"
                      }`}
                      style={{ borderLeft: `4px solid ${getTaskTypeColor(task.type)}` }}
                    >
                      {/* Linha Superior: Checkbox + Título + Ações */}
                      <div className="flex items-start gap-3">
                        <SystemTooltip
                          content={
                            isDone
                              ? "Tarefa concluída (não pode ser reativada)"
                              : "Clique para concluir a tarefa"
                          }
                        >
                          <button
                            type="button"
                            onClick={() => handleRequestCompleteTask(task)}
                            className={`mt-0.5 shrink-0 ${isDone ? "cursor-default" : "cursor-pointer"}`}
                          >
                            {isDone ? (
                              <CheckCircle2 className="h-5 w-5 text-primary" />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground hover:text-primary transition-colors" />
                            )}
                          </button>
                        </SystemTooltip>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className={`text-sm font-semibold leading-snug ${
                                isDone ? "line-through text-muted-foreground" : "text-foreground"
                              }`}
                            >
                              {task.name}
                            </p>
                            {renderTaskQuickActions(task, true)}
                          </div>

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
                                  isOverdue && !isDone ? "text-red-500 font-semibold" : "text-muted-foreground"
                                }`}
                              >
                                <Clock className="h-3 w-3" />
                                {formatTime(task.dueDate)}
                                {isOverdue && !isDone && " (Atrasada)"}
                              </span>
                            )}

                            {task.operatorName && (
                              <span className="text-[10px] text-muted-foreground font-medium bg-muted/60 px-1.5 py-0.5 rounded-md border border-border/40">
                                {task.operatorName}
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
                        <SystemTooltip content="Abrir negociação no Kanban">
                          <button
                            type="button"
                            onClick={(e) => handleNavigateToDeal(task.deal!.id, e)}
                            className="mt-2.5 flex items-center gap-1.5 text-[11px] text-primary hover:underline font-semibold cursor-pointer text-left max-w-full"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{task.deal.name}</span>
                            {task.deal.stageName && (
                              <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/40 ml-1 shrink-0">
                                {task.deal.stageName}
                              </span>
                            )}
                          </button>
                        </SystemTooltip>
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
                          type="button"
                          data-tour="tasks.chat"
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
                          type="button"
                          data-tour="tasks.chat"
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
        <div data-tour="tasks.week-grid" className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5 p-3 md:p-4 overflow-y-auto lg:overflow-hidden bg-muted/10">
          {weekDays.map((wDate, idx) => {
            const isColToday = isSameDay(wDate, today);
            const isColSelected = isSameDay(wDate, selectedDate);
            const colTasks = sortTasksByTime(getTasksForDate(wDate));
            const colTotal = colTasks.length;
            const colCompleted = colTasks.filter((t) => isTaskDone(t)).length;
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
                      const isDone = isTaskDone(t);
                      const isOverdue = isTaskOverdue(t);
                      return (
                        <div
                          key={t.id}
                          className={`rounded-xl border p-2.5 transition-all text-left relative ${
                            isDone
                              ? "border-border/60 bg-muted/20 opacity-65"
                              : isOverdue
                                ? "border-red-500/40 bg-red-500/5 hover:border-red-500"
                                : "border-border bg-card hover:border-primary/40 hover:shadow-2xs"
                          }`}
                          style={{ borderLeftWidth: "3.5px", borderLeftColor: getTaskTypeColor(t.type) }}
                        >
                          <div className="flex items-start gap-2">
                            <SystemTooltip
                              content={
                                isDone
                                  ? "Tarefa concluída (não pode ser reativada)"
                                  : "Clique para concluir a tarefa"
                              }
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRequestCompleteTask(t);
                                }}
                                className={`mt-0.5 shrink-0 ${isDone ? "cursor-default" : "cursor-pointer"}`}
                              >
                                {isDone ? (
                                  <CheckCircle2 className="h-4 w-4 text-primary" />
                                ) : (
                                  <Circle className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
                                )}
                              </button>
                            </SystemTooltip>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1 flex-wrap">
                                  {t.dueDate && (
                                    <span
                                      className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${
                                        isOverdue && !isDone ? "text-red-500" : "text-muted-foreground"
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
                                {renderTaskQuickActions(t, true)}
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
                                <button
                                  type="button"
                                  onClick={(e) => handleNavigateToDeal(t.deal!.id, e)}
                                  className="text-[9px] text-primary truncate hover:underline flex items-center gap-1 mt-0.5 font-medium cursor-pointer max-w-full"
                                >
                                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                  <span className="truncate">{t.deal.name}</span>
                                </button>
                              )}
                            </div>
                          </div>

                          {t.chatConversationId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openChat(t);
                              }}
                              className="mt-2 w-full py-1 text-[10px] font-bold rounded-lg bg-primary text-white hover:opacity-95 transition flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <MessageSquare className="h-3 w-3" />
                              Abrir Atendimento
                            </button>
                          ) : t.chatContactId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartChatWithContact(t.chatContactId!);
                              }}
                              className="mt-2 w-full py-1 text-[10px] font-bold rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <MessageSquare className="h-3 w-3" />
                              Iniciar Atendimento
                            </button>
                          ) : null}
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
        <div data-tour="tasks.day-agenda" className="flex-1 flex flex-col overflow-y-auto p-6 bg-muted/10 space-y-6">
          {(() => {
            const dayTasks = getTasksForDate(selectedDate);
            const blocks = groupTasksByTimeBlock(dayTasks);
            const dayTotal = dayTasks.length;
            const dayCompleted = dayTasks.filter((t) => isTaskDone(t)).length;
            const dayOverdue = blocks.overdue.length;
            const dayPending = dayTotal - dayCompleted;

            return (
              <>
                {/* Cards de Resumo no Topo */}
                <div data-tour="tasks.day-filters" className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total do Dia</span>
                    <p className="text-2xl font-extrabold text-foreground mt-1">{dayTotal}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Pendentes</span>
                    <p className="text-2xl font-extrabold text-primary mt-1">{dayPending}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Atrasadas</span>
                      <p className={`text-2xl font-extrabold mt-1 ${dayOverdue > 0 ? "text-red-600" : "text-foreground"}`}>
                        {dayOverdue}
                      </p>
                    </div>
                    {dayOverdue > 0 && (
                      <button
                        type="button"
                        disabled={isBulkRescheduling}
                        onClick={() =>
                          handleBulkRescheduleOverdue(
                            blocks.overdue.map((t) => t.id),
                            buildQuickRescheduleDate("plus1h"),
                          )
                        }
                        className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-red-500/15 text-red-600 hover:bg-red-500/25 transition cursor-pointer"
                      >
                        Adiar +1h
                      </button>
                    )}
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Concluídas</span>
                    <p className="text-2xl font-extrabold text-primary mt-1">
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
                      type="button"
                      onClick={() => {
                        setEditingTask(null);
                        setIsCreateTaskModalOpen(true);
                      }}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-xs cursor-pointer"
                      style={{ background: "var(--primary)" }}
                    >
                      <Plus className="h-4 w-4" />
                      Criar Tarefa
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Bloco Manhã (até 12h) */}
                    {blocks.morning.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-foreground font-bold">
                          <Clock className="h-4 w-4 text-primary shrink-0" />
                          <h4 className="text-sm font-bold uppercase tracking-wider">
                            Manhã — até 12:00 ({blocks.morning.length})
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {blocks.morning.map((t) => renderDayAgendaCard(t))}
                        </div>
                      </div>
                    )}

                    {/* Bloco Tarde (12h às 18h) */}
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

                    {/* Bloco Noite ou Sem Horário */}
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

                    {/* Bloco Concluídas do Dia */}
                    {blocks.completed.length > 0 && (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center gap-2 text-primary font-bold">
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
            data-tour="tasks.all-dialog"
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
              className="w-full max-w-4xl rounded-3xl bg-card border border-border shadow-card flex flex-col max-h-[90vh] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-line px-6 py-4.5">
                <div>
                  <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                    Lista Completa de Tarefas e Compromissos
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Visualize, pesquise, reagende e gerencie todas as suas tarefas do Kanban CRM.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {globalOverdueTasks.length > 0 && (
                    <button
                      type="button"
                      disabled={isBulkRescheduling}
                      onClick={() => {
                        const target = new Date();
                        target.setHours(target.getHours() + 1, 0, 0, 0);
                        handleBulkRescheduleOverdue(
                          globalOverdueTasks.map((t) => t.id),
                          target,
                        );
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 px-3 py-1.5 text-xs font-bold hover:bg-red-500/25 transition cursor-pointer disabled:opacity-50"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Reagendar {globalOverdueTasks.length} atrasada(s) para Hoje
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIsAllTasksModalOpen(false);
                      setSearchQuery("");
                      setStatusFilter("all");
                      setTypeFilterGlobal("all");
                      setDateFilter("");
                    }}
                    className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer"
                  >
                    <X className="h-4.5 w-4.5" />
                  </button>
                </div>
              </div>

              {/* Filters Bar */}
              <div className="p-5 border-b border-line bg-background/30 space-y-3">
                <div className="flex flex-col md:flex-row gap-3 items-center">
                  {/* Search Input */}
                  <div className="relative w-full md:flex-1">
                    <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Pesquisar por título, cliente ou negociação..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-10 w-full rounded-xl bg-muted pl-10 pr-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Status Toggle */}
                  <div className="flex bg-muted rounded-xl p-1 shrink-0 w-full md:w-auto">
                    {(["all", "open", "overdue", "completed"] as const).map((status) => (
                      <button
                        type="button"
                        key={status}
                        onClick={() => setStatusFilter(status)}
                        className={`flex-1 md:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                          statusFilter === status
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {status === "all"
                          ? "Todas"
                          : status === "open"
                            ? "Em aberto"
                            : status === "overdue"
                              ? `Atrasadas (${globalOverdueTasks.length})`
                              : "Concluídas"}
                      </button>
                    ))}
                  </div>

                  {/* Seletor de Data do Design System */}
                  <div className="w-full md:w-48 shrink-0">
                    <CrmDatePicker
                      value={dateFilter || null}
                      onChange={(val) => setDateFilter(val || "")}
                      placeholder="Filtrar por data..."
                      tooltipText="Filtrar tarefas por data"
                    />
                  </div>
                </div>

                {/* Chips de Tipo (Todos os 7 tipos) */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  {["all", ...ALL_TASK_TYPES].map((tType) => (
                    <button
                      type="button"
                      key={tType}
                      onClick={() => setTypeFilterGlobal(tType)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 transition cursor-pointer ${
                        typeFilterGlobal === tType
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tType !== "all" && getTaskTypeIcon(tType)}
                      <span>{tType === "all" ? "Todos os tipos" : getTaskTypeLabel(tType)}</span>
                    </button>
                  ))}
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
                      const matchDeal = t.deal?.name?.toLowerCase().includes(q) || false;
                      if (!matchName && !matchDesc && !matchClient && !matchDeal) return false;
                    }
                    if (statusFilter === "open") {
                      if (isTaskDone(t)) return false;
                    } else if (statusFilter === "overdue") {
                      if (!isTaskOverdue(t)) return false;
                    } else if (statusFilter === "completed") {
                      if (!isTaskDone(t)) return false;
                    }
                    if (typeFilterGlobal !== "all" && t.type !== typeFilterGlobal) return false;
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
                        <p className="text-xs text-muted-foreground/80 mt-1">
                          Experimente ajustar os filtros ou pesquisar outro termo.
                        </p>
                      </div>
                    );
                  }

                  return filtered.map((task) => {
                    const isDone = isTaskDone(task);
                    const isOverdue = isTaskOverdue(task);
                    return (
                      <div
                        key={task.id}
                        className="rounded-2xl border border-border bg-card p-4 transition-all hover:shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4"
                        style={{ borderLeft: `3.5px solid ${getTaskTypeColor(task.type)}` }}
                      >
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <SystemTooltip
                            content={
                              isDone
                                ? "Tarefa concluída (não pode ser reativada)"
                                : "Clique para concluir a tarefa"
                            }
                          >
                            <button
                              type="button"
                              onClick={() => handleRequestCompleteTask(task)}
                              className={`mt-0.5 shrink-0 ${isDone ? "cursor-default" : "cursor-pointer"}`}
                            >
                              {isDone ? (
                                <CheckCircle2 className="h-5 w-5 text-primary" />
                              ) : (
                                <Circle className="h-5 w-5 text-muted-foreground hover:text-primary transition-colors" />
                              )}
                            </button>
                          </SystemTooltip>

                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm font-semibold leading-tight ${
                                isDone ? "line-through text-muted-foreground" : "text-foreground"
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
                                <span
                                  className={`flex items-center gap-1 text-[11px] ${
                                    isOverdue ? "text-red-500 font-semibold" : "text-muted-foreground"
                                  }`}
                                >
                                  <Clock className="h-3 w-3" />
                                  {new Date(task.dueDate).toLocaleDateString("pt-BR")} às {formatTime(task.dueDate)}
                                  {isOverdue && " (Atrasada)"}
                                </span>
                              )}
                            </div>

                            {task.deal?.name && (
                              <SystemTooltip content="Abrir negociação no Kanban">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    setIsAllTasksModalOpen(false);
                                    handleNavigateToDeal(task.deal!.id, e);
                                  }}
                                  className="mt-1.5 flex items-center gap-1 text-[11px] text-primary hover:underline font-medium cursor-pointer"
                                >
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{task.deal.name}</span>
                                </button>
                              </SystemTooltip>
                            )}

                            {task.description && (
                              <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-1 leading-relaxed">
                                {task.description}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {(task.client.name || task.client.phone) && (
                            <div className="text-right hidden sm:block">
                              {task.client.name && (
                                <p className="text-xs font-semibold text-foreground">{task.client.name}</p>
                              )}
                              {task.client.phone && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  {formatPhone(task.client.phone)}
                                </p>
                              )}
                            </div>
                          )}

                          {renderTaskQuickActions(task)}

                          {task.chatConversationId ? (
                            <motion.button
                              type="button"
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
                              type="button"
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

      {/* MODAL OBRIGATÓRIO DE CONFIRMAÇÃO DE CONCLUSÃO DE TAREFA */}
      <AnimatePresence>
        {taskToComplete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
            onClick={() => !isSubmittingCompletion && setTaskToComplete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl bg-card border border-border shadow-2xl overflow-hidden"
            >
              <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-primary/5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-foreground">
                      Concluir Tarefa?
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Confirme a conclusão desta atividade comercial
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isSubmittingCompletion}
                  onClick={() => setTaskToComplete(null)}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Tem certeza que deseja marcar esta tarefa como <strong>concluída</strong>? Uma vez concluída, ela ficará registrada no histórico e <strong>não poderá ser reativada</strong>.
                </p>

                {/* Resumo da Tarefa */}
                <div
                  className="rounded-2xl border border-border bg-muted/30 p-3.5 space-y-1.5"
                  style={{ borderLeft: `4px solid ${getTaskTypeColor(taskToComplete.type)}` }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
                      style={{ background: getTaskTypeColor(taskToComplete.type) }}
                    >
                      {getTaskTypeIcon(taskToComplete.type)}
                      {getTaskTypeLabel(taskToComplete.type)}
                    </span>
                    {taskToComplete.dueDate && (
                      <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(taskToComplete.dueDate).toLocaleDateString("pt-BR")} às {formatTime(taskToComplete.dueDate)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-foreground">{taskToComplete.name}</p>
                  {(taskToComplete.client?.name || taskToComplete.deal?.name) && (
                    <p className="text-xs text-muted-foreground">
                      {taskToComplete.client?.name}
                      {taskToComplete.client?.name && taskToComplete.deal?.name ? " • " : ""}
                      {taskToComplete.deal?.name}
                    </p>
                  )}
                </div>

                {/* Observação de Conclusão (opcional) */}
                <div>
                  <label className="text-xs font-bold text-foreground block mb-1.5">
                    Observação / Resultado da atividade (opcional)
                  </label>
                  <textarea
                    rows={2}
                    value={completionNote}
                    onChange={(e) => setCompletionNote(e.target.value)}
                    placeholder="Ex: Cliente confirmou interesse e pediu proposta atualizada..."
                    className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary resize-none"
                  />
                </div>

                {/* Agendar próximo Follow-up se houver Negociação */}
                {taskToComplete.deal?.id && (
                  <div className="rounded-2xl border border-border/80 bg-background/50 p-3.5 space-y-3">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={scheduleNextFollowUp}
                        onChange={(e) => setScheduleNextFollowUp(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        Agendar próximo follow-up para esta negociação
                      </span>
                    </label>

                    {scheduleNextFollowUp && (
                      <div className="space-y-2.5 pt-1 border-t border-border/50">
                        <input
                          type="text"
                          value={nextFollowUpTitle}
                          onChange={(e) => setNextFollowUpTitle(e.target.value)}
                          placeholder="Título do próximo compromisso..."
                          className="w-full rounded-xl bg-muted/60 border border-border px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
                        />
                        <div className="flex flex-wrap gap-1">
                          {ALL_TASK_TYPES.map((tType) => (
                            <button
                              key={tType}
                              type="button"
                              onClick={() => setNextFollowUpType(tType)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                                nextFollowUpType === tType
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {getTaskTypeIcon(tType)}
                              {getTaskTypeLabel(tType)}
                            </button>
                          ))}
                        </div>
                        <SystemDateTimePicker
                          mode="datetime"
                          value={nextFollowUpDateTime}
                          onChange={(val) => setNextFollowUpDateTime(val)}
                          placeholder="Data e hora do follow-up"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-muted/30 border-t border-border flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={isSubmittingCompletion}
                  onClick={() => setTaskToComplete(null)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-card transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSubmittingCompletion}
                  onClick={handleConfirmCompleteTask}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 text-xs font-bold shadow-sm transition cursor-pointer disabled:opacity-60"
                >
                  {isSubmittingCompletion ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Sim, concluir tarefa
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL DE CONFIRMAÇÃO DE CANCELAMENTO OU EXCLUSÃO */}
      <AnimatePresence>
        {taskActionConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
            onClick={() => !isSubmittingAction && setTaskActionConfirm(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-3xl bg-card border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
                      taskActionConfirm.action === "delete"
                        ? "bg-red-500/15 text-red-600"
                        : "bg-primary/15 text-primary"
                    }`}
                  >
                    {taskActionConfirm.action === "delete" ? (
                      <Trash2 className="h-5 w-5" />
                    ) : (
                      <Ban className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-foreground">
                      {taskActionConfirm.action === "delete" ? "Excluir Tarefa?" : "Cancelar Tarefa?"}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {taskActionConfirm.action === "delete"
                        ? "Esta ação removerá a tarefa permanentemente."
                        : "A tarefa sairá da sua lista de pendências."}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl bg-muted/40 border border-border/60 p-3 text-xs font-semibold text-foreground">
                  {taskActionConfirm.task.name}
                </div>
              </div>
              <div className="px-6 py-3.5 bg-muted/30 border-t border-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isSubmittingAction}
                  onClick={() => setTaskActionConfirm(null)}
                  className="rounded-xl border border-border px-3.5 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-card transition cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={isSubmittingAction}
                  onClick={handleConfirmCancelOrDelete}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-60 ${
                    taskActionConfirm.action === "delete"
                      ? "bg-red-600 hover:bg-red-500 text-white"
                      : "bg-primary hover:bg-primary/90 text-primary-foreground"
                  }`}
                >
                  {isSubmittingAction && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {taskActionConfirm.action === "delete" ? "Confirmar Exclusão" : "Confirmar Cancelamento"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal para criar ou editar tarefa no Kanban */}
      <CreateTaskModal
        isOpen={isCreateTaskModalOpen}
        onClose={() => {
          setIsCreateTaskModalOpen(false);
          setEditingTask(null);
        }}
        onTaskCreated={fetchTasks}
        operators={operatorsList}
        currentOperatorId={currentOperatorId}
        defaultDate={selectedDate}
        editingTask={editingTask}
      />
    </section>
  );
}
