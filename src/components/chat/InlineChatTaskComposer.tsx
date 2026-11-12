import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useConversationDealContext } from "@/components/crm/ConversationDealContext";
import {
  AlertCircle,
  AtSign,
  Briefcase,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListTodo,
  MapPin,
  MessageSquare,
  PhoneCall,
  Plus,
  RefreshCw,
  Users,
  UtensilsCrossed,
} from "lucide-react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

export const CHAT_TASK_TYPES = [
  { value: "task", label: "Tarefa", Icon: CheckSquare },
  { value: "call", label: "Ligação", Icon: PhoneCall },
  { value: "whatsapp", label: "WhatsApp", Icon: MessageSquare },
  { value: "meeting", label: "Reunião", Icon: Users },
  { value: "email", label: "E-mail", Icon: AtSign },
  { value: "lunch", label: "Almoço", Icon: UtensilsCrossed },
  { value: "visit", label: "Visita", Icon: MapPin },
] as const;

export type ChatTaskTypeValue = (typeof CHAT_TASK_TYPES)[number]["value"];

const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const WEEKDAY_NAMES_PT = ["D", "S", "T", "Q", "Q", "S", "S"];
const HOURS_LIST = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES_LIST = [
  "00",
  "05",
  "10",
  "15",
  "20",
  "25",
  "30",
  "35",
  "40",
  "45",
  "50",
  "55",
];

function formatYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getRelativeDateYMD(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return formatYMD(d);
}

interface TransientTaskDraft {
  subject: string;
  taskType: ChatTaskTypeValue;
  dueDate: string;
  dueTime: string;
}

const transientTaskDraftCache = new Map<string, TransientTaskDraft>();

export interface InlineChatTaskComposerProps {
  conversationId: string;
  tags?: string[];
  onUpdateTags?: (conversationId: string, tags: string[]) => void;
  compact?: boolean;
  autoFocus?: boolean;
}

export const InlineChatTaskComposer: React.FC<InlineChatTaskComposerProps> = ({
  conversationId,
  tags,
  onUpdateTags,
  compact = false,
  autoFocus = true,
}) => {
  const cachedDraft = conversationId ? transientTaskDraftCache.get(conversationId) : undefined;

  const [taskSubject, setTaskSubject] = useState<string>(cachedDraft?.subject ?? "");
  const [taskType, setTaskType] = useState<ChatTaskTypeValue>(cachedDraft?.taskType ?? "task");
  const [taskDueDate, setTaskDueDate] = useState<string>(
    cachedDraft?.dueDate ?? getRelativeDateYMD(1),
  );
  const [taskDueTime, setTaskDueTime] = useState<string>(cachedDraft?.dueTime ?? "09:00");
  const [taskCreating, setTaskCreating] = useState(false);

  const [isTypeOpen, setIsTypeOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isTimeOpen, setIsTimeOpen] = useState(false);
  const [showDealTasksList, setShowDealTasksList] = useState(false);

  const [calendarMonth, setCalendarMonth] = useState<number>(() => {
    const base = cachedDraft?.dueDate;
    if (base) {
      const m = parseInt(base.split("-")[1] || "", 10);
      if (!Number.isNaN(m)) return m - 1;
    }
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.getMonth();
  });
  const [calendarYear, setCalendarYear] = useState<number>(() => {
    const base = cachedDraft?.dueDate;
    if (base) {
      const y = parseInt(base.split("-")[0] || "", 10);
      if (!Number.isNaN(y)) return y;
    }
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.getFullYear();
  });

  const inputRef = useRef<HTMLInputElement | null>(null);
  const prevConvIdRef = useRef<string>(conversationId);

  useEffect(() => {
    if (prevConvIdRef.current !== conversationId) {
      prevConvIdRef.current = conversationId;
      const saved = conversationId ? transientTaskDraftCache.get(conversationId) : undefined;
      setTaskSubject(saved?.subject ?? "");
      setTaskType(saved?.taskType ?? "task");
      setTaskDueDate(saved?.dueDate ?? getRelativeDateYMD(1));
      setTaskDueTime(saved?.dueTime ?? "09:00");
      setShowDealTasksList(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    transientTaskDraftCache.set(conversationId, {
      subject: taskSubject,
      taskType,
      dueDate: taskDueDate,
      dueTime: taskDueTime,
    });
  }, [conversationId, taskSubject, taskType, taskDueDate, taskDueTime]);

  useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocus, conversationId]);

  useEffect(() => {
    if (taskDueDate) {
      const [y, m] = taskDueDate.split("-");
      if (y && m) {
        setCalendarYear(parseInt(y, 10));
        setCalendarMonth(parseInt(m, 10) - 1);
      }
    }
  }, [taskDueDate]);

  const taskDealContext = useConversationDealContext(conversationId);
  const openLinkedDeals = useMemo(
    () => (taskDealContext.data?.deals || []).filter((d) => d.status === "open" && d.isLinked),
    [taskDealContext.data?.deals],
  );
  const pausedLinkedDeals = useMemo(
    () => (taskDealContext.data?.deals || []).filter((d) => d.status === "paused" && d.isLinked),
    [taskDealContext.data?.deals],
  );

  const effectiveDeal = useMemo(() => {
    if (taskDealContext.data?.currentDeal) return taskDealContext.data.currentDeal;
    if (taskDealContext.data?.gracePeriodActive && taskDealContext.data?.previousDeal) {
      return taskDealContext.data.previousDeal;
    }
    if (openLinkedDeals.length === 1) return openLinkedDeals[0];
    if (openLinkedDeals.length === 0 && pausedLinkedDeals.length === 1) return pausedLinkedDeals[0];
    return null;
  }, [
    taskDealContext.data?.currentDeal,
    taskDealContext.data?.gracePeriodActive,
    taskDealContext.data?.previousDeal,
    openLinkedDeals,
    pausedLinkedDeals,
  ]);

  const canResolveDeal = Boolean(
    taskDealContext.data?.hasCurrentDeal ||
      taskDealContext.data?.gracePeriodActive ||
      taskDealContext.data?.previousDeal ||
      openLinkedDeals.length === 1 ||
      (openLinkedDeals.length === 0 && pausedLinkedDeals.length === 1),
  );

  const currentDealId = effectiveDeal?.id || null;
  const currentDealTitle = effectiveDeal?.title || null;

  const [currentDealActivities, setCurrentDealActivities] = useState<any[]>([]);
  const [loadingDealTasks, setLoadingDealTasks] = useState(false);

  const fetchCurrentDealTasks = useCallback(
    async (signal?: AbortSignal) => {
      if (!currentDealId) {
        setCurrentDealActivities([]);
        setLoadingDealTasks(false);
        return;
      }
      setLoadingDealTasks(true);
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/crm/deals/${encodeURIComponent(currentDealId)}/activities`,
          { credentials: "include", signal },
        );
        if (!res.ok) {
          if (!signal?.aborted) setCurrentDealActivities([]);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!signal?.aborted) {
          setCurrentDealActivities(Array.isArray(data?.activities) ? data.activities : []);
        }
      } catch {
        if (!signal?.aborted) setCurrentDealActivities([]);
      } finally {
        if (!signal?.aborted) setLoadingDealTasks(false);
      }
    },
    [currentDealId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchCurrentDealTasks(controller.signal);
    const refreshTasks = () => {
      void fetchCurrentDealTasks();
    };
    window.addEventListener("crm-deals-changed", refreshTasks);
    window.addEventListener("conversation-deal-context-changed", refreshTasks);
    return () => {
      controller.abort();
      window.removeEventListener("crm-deals-changed", refreshTasks);
      window.removeEventListener("conversation-deal-context-changed", refreshTasks);
    };
  }, [fetchCurrentDealTasks]);

  const currentDealTasks = useMemo(() => {
    if (!currentDealId) return [];
    return currentDealActivities
      .filter(
        (act) =>
          act &&
          (!act.dealId || act.dealId === currentDealId) &&
          act.type !== "note" &&
          act.type !== "system_event" &&
          act.status !== "cancelled",
      )
      .sort((a, b) => {
        const aDone = a.status === "completed" || Boolean(a.completedAt) ? 1 : 0;
        const bDone = b.status === "completed" || Boolean(b.completedAt) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        const safeA = Number.isNaN(aTime) ? Number.MAX_SAFE_INTEGER : aTime;
        const safeB = Number.isNaN(bTime) ? Number.MAX_SAFE_INTEGER : bTime;
        if (safeA !== safeB) return safeA - safeB;
        const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aCreated - bCreated;
      });
  }, [currentDealActivities, currentDealId]);

  const formattedDateBR = useMemo(() => {
    if (!taskDueDate) return "Selecione data";
    const [y, m, d] = taskDueDate.split("-");
    if (y && m && d) return `${d}/${m}/${y}`;
    return taskDueDate;
  }, [taskDueDate]);

  const [currentHour, currentMin] = (taskDueTime || "09:00").split(":");
  const selectedHour = currentHour || "09";
  const selectedMin = currentMin || "00";

  const prevMonth = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear((y) => y - 1);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  };

  const nextMonth = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear((y) => y + 1);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number, monthOffset: number = 0) => {
    let targetMonth = calendarMonth + monthOffset;
    let targetYear = calendarYear;

    if (targetMonth < 0) {
      targetMonth = 11;
      targetYear -= 1;
    } else if (targetMonth > 11) {
      targetMonth = 0;
      targetYear += 1;
    }

    const yStr = String(targetYear);
    const mStr = String(targetMonth + 1).padStart(2, "0");
    const dStr = String(day).padStart(2, "0");
    setTaskDueDate(`${yStr}-${mStr}-${dStr}`);
    setIsCalendarOpen(false);
  };

  const renderCalendarDays = () => {
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInCurrentMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();

    const cells: React.ReactNode[] = [];

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      cells.push(
        <button
          key={`prev-${dayNum}`}
          type="button"
          onClick={() => handleSelectDay(dayNum, -1)}
          className="h-7 w-7 text-[11px] text-muted-foreground/35 hover:bg-muted/40 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          {dayNum}
        </button>,
      );
    }

    for (let day = 1; day <= daysInCurrentMonth; day++) {
      const dayYMD = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const isSelected = taskDueDate === dayYMD;
      const formattedDayTooltip = `${String(day).padStart(2, "0")}/${String(calendarMonth + 1).padStart(2, "0")}/${calendarYear}`;

      cells.push(
        <SystemTooltip key={`cur-${day}`} content={formattedDayTooltip}>
          <button
            type="button"
            onClick={() => handleSelectDay(day, 0)}
            className={`h-7 w-7 text-xs font-semibold rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              isSelected
                ? "bg-primary text-primary-foreground font-bold shadow-xs hover:bg-primary/90"
                : "text-foreground hover:bg-muted hover:text-primary"
            }`}
          >
            {day}
          </button>
        </SystemTooltip>,
      );
    }

    const totalFilled = cells.length;
    const remaining = (7 - (totalFilled % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
      cells.push(
        <button
          key={`next-${day}`}
          type="button"
          onClick={() => handleSelectDay(day, 1)}
          className="h-7 w-7 text-[11px] text-muted-foreground/35 hover:bg-muted/40 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          {day}
        </button>,
      );
    }

    return cells;
  };

  const selectedTypeMeta =
    CHAT_TASK_TYPES.find((t) => t.value === taskType) ?? CHAT_TASK_TYPES[0];
  const SelectedTypeIcon = selectedTypeMeta.Icon;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const label = taskSubject.trim();
    if (!label || taskCreating) {
      inputRef.current?.focus();
      return;
    }

    const freshContext = (await taskDealContext.refresh()) ?? taskDealContext.data;
    const freshOpenLinked = (freshContext?.deals || []).filter(
      (d) => d.status === "open" && d.isLinked,
    );
    const freshPausedLinked = (freshContext?.deals || []).filter(
      (d) => d.status === "paused" && d.isLinked,
    );
    const canResolveFresh = Boolean(
      freshContext?.hasCurrentDeal ||
        freshContext?.gracePeriodActive ||
        freshContext?.previousDeal ||
        freshOpenLinked.length === 1 ||
        (freshOpenLinked.length === 0 && freshPausedLinked.length === 1),
    );

    if (!canResolveFresh) {
      toast.error("Selecione a negociação deste atendimento antes de criar a tarefa.");
      return;
    }

    setTaskCreating(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/chats/tag-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          conversationId,
          tagName: label,
          expectedContextVersion: freshContext?.version,
          taskType,
          dueDate: taskDueDate,
          dueTime: taskDueTime,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "Não foi possível criar a tarefa.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a tarefa.");
      setTaskCreating(false);
      void taskDealContext.refresh();
      return;
    }

    if (
      typeof document !== "undefined" &&
      document.documentElement.dataset.trainingInstalled &&
      Array.isArray(tags) &&
      onUpdateTags &&
      !tags.includes(label)
    ) {
      onUpdateTags(conversationId, [...tags, label]);
    }

    setTaskSubject("");
    setTaskType("task");
    setTaskDueDate(getRelativeDateYMD(1));
    setTaskDueTime("09:00");
    if (conversationId) {
      transientTaskDraftCache.delete(conversationId);
    }
    setTaskCreating(false);

    void taskDealContext.refresh();
    void fetchCurrentDealTasks();
    window.dispatchEvent(new Event("crm-deals-changed"));
    window.dispatchEvent(new Event("chat:reconnected"));

    toast.success("Tarefa criada com sucesso!");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  return (
    <form
      data-chat-task-inline="true"
      onSubmit={handleSubmit}
      className={`rounded-2xl border border-primary/35 bg-primary/[0.06] dark:bg-primary/10 dark:border-primary/40 backdrop-blur-md transition-all duration-200 ${
        compact ? "px-3 py-2 space-y-2" : "px-3.5 py-2.5 space-y-2.5"
      }`}
    >
      {/* Gaveta opcional de tarefas já criadas na negociação atual */}
      {showDealTasksList && (
        <div className="rounded-xl border border-border/70 bg-card/90 p-2.5 space-y-1.5 animate-in fade-in slide-in-from-bottom-1 duration-150">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Tarefas da negociação atual
            </span>
            {currentDealTitle && (
              <span className="text-[10px] font-semibold text-primary truncate max-w-[220px]">
                {currentDealTitle}
              </span>
            )}
          </div>
          {!currentDealId ? (
            <p className="text-[11px] text-muted-foreground italic">
              Nenhuma negociação marcada como atual neste atendimento.
            </p>
          ) : loadingDealTasks ? (
            <p className="text-[11px] text-muted-foreground italic">Carregando tarefas...</p>
          ) : currentDealTasks.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">
              Nenhuma tarefa criada nesta negociação.
            </p>
          ) : (
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1 scrollbar-thin">
              {currentDealTasks.map((task) => {
                const meta =
                  CHAT_TASK_TYPES.find((item) => item.value === task.type) ?? CHAT_TASK_TYPES[0];
                const TaskIcon = meta.Icon;
                const isCompleted = task.status === "completed" || Boolean(task.completedAt);
                const dueObj = task.dueDate ? new Date(task.dueDate) : null;
                const hasValidDue = Boolean(dueObj && !Number.isNaN(dueObj.getTime()));
                const isOverdue = !isCompleted && hasValidDue && dueObj!.getTime() < Date.now();
                const dueDateLabel = hasValidDue
                  ? `${String(dueObj!.getDate()).padStart(2, "0")}/${String(
                      dueObj!.getMonth() + 1,
                    ).padStart(2, "0")}/${dueObj!.getFullYear()} às ${String(
                      dueObj!.getHours(),
                    ).padStart(2, "0")}:${String(dueObj!.getMinutes()).padStart(2, "0")}`
                  : "Sem vencimento";

                return (
                  <div
                    key={task.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                      isCompleted
                        ? "border-border/50 bg-muted/30 opacity-70"
                        : isOverdue
                          ? "border-red-500/30 bg-red-500/5"
                          : "border-primary/20 bg-primary/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <TaskIcon
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isCompleted
                            ? "text-emerald-500"
                            : isOverdue
                              ? "text-red-500"
                              : "text-primary"
                        }`}
                      />
                      <span
                        className={`truncate text-[11px] font-bold ${
                          isCompleted ? "line-through text-muted-foreground" : "text-foreground"
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                      <span className="font-bold uppercase text-primary/80">{meta.label}</span>
                      <span className="text-muted-foreground">•</span>
                      <span
                        className={`font-semibold ${
                          isCompleted
                            ? "text-emerald-500"
                            : isOverdue
                              ? "text-red-500"
                              : "text-muted-foreground"
                        }`}
                      >
                        {dueDateLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Linha 1: Controles rápidos de Tipo, Data, Horário & Vínculo CRM */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-primary/15">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Tipo da Tarefa (Popover customizado) */}
          <Popover open={isTypeOpen} onOpenChange={setIsTypeOpen}>
            <SystemTooltip content="Tipo da atividade comercial no CRM">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-lg bg-card/90 hover:bg-card text-[11px] font-semibold text-foreground border border-border/70 hover:border-primary/40 flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                >
                  <SelectedTypeIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>{selectedTypeMeta.label}</span>
                  <ChevronDown
                    className={`h-3 w-3 text-muted-foreground transition-transform duration-150 ${
                      isTypeOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </PopoverTrigger>
            </SystemTooltip>
            <PopoverContent
              align="start"
              side="top"
              className="w-44 p-1 rounded-xl bg-card border border-border shadow-xl z-50"
            >
              {CHAT_TASK_TYPES.map(({ value, label, Icon }) => {
                const isActive = taskType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setTaskType(value);
                      setIsTypeOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                      isActive
                        ? "bg-primary/10 text-primary font-bold"
                        : "text-foreground hover:bg-muted font-medium"
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isActive ? "text-primary" : "text-muted-foreground"
                      }`}
                    />
                    <span className="flex-1 text-left">{label}</span>
                    {isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>

          {/* Seletor Customizado de Data */}
          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
            <SystemTooltip content="Selecione a data de vencimento da tarefa">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-lg bg-card/90 hover:bg-card text-[11px] font-semibold text-foreground border border-border/70 hover:border-primary/40 flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="tabular-nums">{formattedDateBR}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground opacity-70 shrink-0" />
                </button>
              </PopoverTrigger>
            </SystemTooltip>
            <PopoverContent
              side="top"
              align="start"
              className="w-[260px] p-2.5 rounded-2xl border border-border shadow-xl bg-card z-50"
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="h-6 w-6 flex items-center justify-center rounded-lg text-primary hover:bg-muted transition-colors cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs font-bold text-foreground">
                  {MONTH_NAMES_PT[calendarMonth]} de {calendarYear}
                </span>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="h-6 w-6 flex items-center justify-center rounded-lg text-primary hover:bg-muted transition-colors cursor-pointer"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-1 text-center">
                {WEEKDAY_NAMES_PT.map((w, idx) => (
                  <span key={idx} className="text-[10px] font-bold text-muted-foreground">
                    {w}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 text-center">{renderCalendarDays()}</div>

              <div className="flex items-center justify-between pt-2 mt-2 border-t border-border/50 text-[10px]">
                <button
                  type="button"
                  onClick={() => {
                    setTaskDueDate(getRelativeDateYMD(0));
                    setIsCalendarOpen(false);
                  }}
                  className="font-semibold text-primary hover:underline cursor-pointer"
                >
                  Hoje
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTaskDueDate(getRelativeDateYMD(1));
                    setIsCalendarOpen(false);
                  }}
                  className="font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Amanhã
                </button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Atalhos Rápidos de Data */}
          <div className="hidden sm:flex items-center gap-1">
            {[
              { label: "Hoje", offset: 0 },
              { label: "Amanhã", offset: 1 },
              { label: "+2d", offset: 2 },
              { label: "+7d", offset: 7 },
            ].map(({ label, offset }) => {
              const targetYMD = getRelativeDateYMD(offset);
              const isSelected = taskDueDate === targetYMD;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setTaskDueDate(targetYMD)}
                  className={`h-7 px-2 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "bg-card/70 text-muted-foreground hover:text-foreground hover:bg-card border border-border/50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Seletor Customizado de Hora */}
          <Popover open={isTimeOpen} onOpenChange={setIsTimeOpen}>
            <SystemTooltip content="Selecione o horário da tarefa">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-lg bg-card/90 hover:bg-card text-[11px] font-semibold text-foreground border border-border/70 hover:border-primary/40 flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                >
                  <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="tabular-nums">{taskDueTime || "09:00"}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground opacity-70 shrink-0" />
                </button>
              </PopoverTrigger>
            </SystemTooltip>
            <PopoverContent
              side="top"
              align="start"
              className="w-[180px] p-2 rounded-xl shadow-xl border border-border bg-card z-50"
            >
              <div className="grid grid-cols-2 gap-1.5 text-center text-xs">
                <div>
                  <div className="text-[10px] font-bold text-muted-foreground uppercase pb-1 border-b border-border/60 mb-1">
                    Hora
                  </div>
                  <div className="h-40 overflow-y-auto space-y-0.5 scrollbar-thin pr-0.5">
                    {HOURS_LIST.map((h) => {
                      const isSelected = selectedHour === h;
                      return (
                        <button
                          type="button"
                          key={h}
                          onClick={() => setTaskDueTime(`${h}:${selectedMin}`)}
                          className={`w-full py-0.5 rounded text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-primary text-primary-foreground font-bold shadow-xs"
                              : "text-foreground hover:bg-muted font-medium"
                          }`}
                        >
                          {h}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted-foreground uppercase pb-1 border-b border-border/60 mb-1">
                    Minuto
                  </div>
                  <div className="h-40 overflow-y-auto space-y-0.5 scrollbar-thin pr-0.5">
                    {MINUTES_LIST.map((m) => {
                      const isSelected = selectedMin === m;
                      return (
                        <button
                          type="button"
                          key={m}
                          onClick={() => {
                            setTaskDueTime(`${selectedHour}:${m}`);
                            setIsTimeOpen(false);
                          }}
                          className={`w-full py-0.5 rounded text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-primary text-primary-foreground font-bold shadow-xs"
                              : "text-foreground hover:bg-muted font-medium"
                          }`}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Atalhos Rápidos de Horário */}
          {!compact && (
            <div className="hidden lg:flex items-center gap-1">
              {["09:00", "11:00", "14:00", "16:00", "18:00"].map((timeStr) => {
                const isSelected = taskDueTime === timeStr;
                return (
                  <button
                    key={timeStr}
                    type="button"
                    onClick={() => setTaskDueTime(timeStr)}
                    className={`h-7 px-1.5 rounded-lg text-[10px] font-semibold transition cursor-pointer tabular-nums ${
                      isSelected
                        ? "bg-primary/15 text-primary font-bold border border-primary/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-card/80"
                    }`}
                  >
                    {timeStr}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Lado direito: Indicador de Negociação Vinculada + Botão de Tarefas Atuais */}
        <div className="flex items-center gap-1.5 min-w-0">
          {effectiveDeal ? (
            <SystemTooltip content={`Tarefa será vinculada à negociação "${effectiveDeal.title}"`}>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-card/80 border border-border/60 px-2 py-1 text-[10px] font-semibold text-foreground max-w-[180px] md:max-w-[220px]">
                <Briefcase className="h-3 w-3 text-primary shrink-0" />
                <span className="truncate">{effectiveDeal.title}</span>
              </span>
            </SystemTooltip>
          ) : !canResolveDeal ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span>Selecione a negociação acima</span>
            </span>
          ) : null}

          {currentDealId && (
            <SystemTooltip
              content={
                showDealTasksList
                  ? "Ocultar lista de tarefas desta negociação"
                  : "Ver tarefas já criadas nesta negociação"
              }
            >
              <button
                type="button"
                onClick={() => setShowDealTasksList((prev) => !prev)}
                className={`h-7 px-2 rounded-lg text-[10px] font-bold border flex items-center gap-1 transition cursor-pointer ${
                  showDealTasksList
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card/80 hover:bg-card text-foreground border-border/60"
                }`}
              >
                <ListTodo className="h-3 w-3 shrink-0" />
                <span>{currentDealTasks.length}</span>
              </button>
            </SystemTooltip>
          )}
        </div>
      </div>

      {/* Linha 2: Campo de escrita inline + Botão Criar Tarefa (mesma ergonomia da Nota Interna) */}
      <div className="flex items-center gap-2.5">
        <input
          ref={inputRef}
          type="text"
          value={taskSubject}
          onChange={(e) => setTaskSubject(e.target.value)}
          placeholder="Descreva a tarefa vinculada ao CRM... (pressione Enter para criar)"
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none py-1.5 min-h-[34px]"
        />

        <SystemTooltip content="Criar tarefa vinculada à negociação no CRM (Enter)">
          <button
            type="submit"
            disabled={!taskSubject.trim() || taskCreating}
            className="h-9 px-3.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center gap-1.5 hover:opacity-90 transition shadow-soft shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {taskCreating ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span>{taskCreating ? "Criando..." : "Criar Tarefa"}</span>
          </button>
        </SystemTooltip>
      </div>
    </form>
  );
};
