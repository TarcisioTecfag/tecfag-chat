import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { useTrainingSurface } from "@/hooks/useTrainingSurface";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { ProfilePopover } from "@/components/chat/ProfileModal";
import { AccountDetailModal } from "@/components/crm/AccountDetailModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";
import { CommercialEvidenceDialog } from "./CommercialEvidenceDialog";
import { CommercialHomeSkeleton } from "./CommercialHomeSkeleton";
import { getDeterministicConsultantAvatar } from "@/lib/commercial/avatar-matcher";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Clock3,
  ExternalLink,
  Flame,
  ListFilter,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
  User,
  X,
} from "lucide-react";

type CommercialHome = {
  asOf: string;
  today: string;
  month: string;
  consultant: { id: string; name: string; avatar: string | null; division: string | null };
  goal: {
    configured: boolean;
    targetValue: number;
    realizedValue: number;
    conversionRate: number;
    businessDays: number;
    elapsedDays: number;
    remainingDays: number;
    expectedPercent: number;
    coveragePercent: number;
    dailyRequired: number;
  };
  deals: { openCount: number; openValue: number; wonThisMonthCount: number };
  wonDeals?: Array<{
    id: string;
    title: string;
    value: number;
    closedAt: string | null;
  }>;
  calendarDays?: Array<{
    date: string;
    type: string;
    description: string;
    affectsGoal: boolean;
  }>;
  activities: Array<{
    id: string;
    title: string;
    type?: string;
    description?: string | null;
    status?: string;
    dueDate: string | null;
    completedAt?: string | null;
    createdAt?: string | null;
    overdue?: boolean;
    dealId: string;
    dealTitle: string;
    dealValue?: number;
    pipelineId?: string | null;
    pipelineName?: string | null;
    stageId?: string | null;
    stageName?: string | null;
    accountId?: string | null;
    accountName?: string | null;
    accountDocument?: string | null;
    contactId?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    conversationId?: string | null;
    assignedByOperatorName?: string | null;
  }>;
  directives: Array<{
    id: string;
    dealId: string;
    dealTitle: string;
    dealValue: number;
    pipelineId?: string | null;
    pipelineName?: string | null;
    stageId?: string | null;
    stageName?: string | null;
    accountId?: string | null;
    accountName?: string | null;
    accountDocument?: string | null;
    contactId?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    conversationId?: string | null;
    instruction: string;
    priority: string;
    assignedDate: string;
    assignedByOperatorId?: string | null;
    assignedByOperatorName?: string | null;
    createdAt?: string | null;
    dueAt: string | null;
    status: string;
    completedAt?: string | null;
    completionNote?: string | null;
    evidenceChannel?: string | null;
    notificationReadAt?: string | null;
    overdue: boolean;
  }>;
};

type Filter = "Todas" | "Atrasadas" | "Alta" | "Hoje" | "Concluídas";
type AgendaModalFilter = "todos" | "tarefas" | "responsabilidades" | "atrasadas";

function formatTaskTypeLabel(type?: string | null): string {
  switch ((type || "task").toLowerCase()) {
    case "call":
      return "Ligação";
    case "meeting":
      return "Reunião";
    case "email":
      return "E-mail";
    case "whatsapp":
      return "WhatsApp";
    default:
      return "Tarefa";
  }
}

function formatBRL(val: number | string | null | undefined): string {
  const num = typeof val === "string" ? parseFloat(val) : Number(val || 0);
  if (isNaN(num)) return "R$ 0,00";
  return num.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "TF";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ProgressBar({
  value,
  color,
  className = "",
  delay = 0,
}: {
  value: number;
  color?: string;
  className?: string;
  delay?: number;
}) {
  return (
    <div className={`h-2 overflow-hidden rounded-[2px] bg-muted dark:bg-zinc-800 ${className}`}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.9, delay, ease: "easeOut" }}
        className="h-full"
        style={{
          backgroundColor: color || "var(--primary)",
        }}
      />
    </div>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  const norm = priority.toLowerCase();
  const isHigh = norm === "alta" || norm === "critical" || norm === "high";
  const isMed = norm === "média" || norm === "media" || norm === "medium";
  const style = isHigh
    ? "border-red-300 bg-red-50 text-red-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400"
    : isMed
      ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
      : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-cyan-900 dark:bg-emerald-950/20 dark:text-emerald-300";
  return (
    <motion.span
      whileHover={{ scale: 1.05 }}
      className={`rounded-[2px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.13em] transition-transform ${style}`}
    >
      {isHigh ? "ALTA" : isMed ? "MÉDIA" : "BAIXA"}
    </motion.span>
  );
}

function StatCard({
  label,
  value,
  meta,
  icon: Icon,
  accent,
  progress,
  delay = 0,
}: {
  label: string;
  value: string;
  meta: string;
  icon: any;
  accent: string;
  progress?: {
    valuePct: number;
    color: string;
    leftLabel?: string;
    rightLabel?: string;
  };
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className="group border border-border/80 bg-card p-4 transition-all duration-300 hover:border-primary/50 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-950/70 dark:hover:border-zinc-700 flex flex-col justify-between rounded-[4px]"
    >
      <div>
        <div className="mb-3 flex items-start justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground dark:text-zinc-400 group-hover:text-foreground transition-colors">
            {label}
          </span>
          <motion.span
            whileHover={{ scale: 1.15, rotate: 6 }}
            className="border border-border bg-muted/60 p-1.5 rounded-[4px] dark:border-zinc-800 dark:bg-zinc-900 shadow-sm transition-transform"
            style={{ color: accent }}
          >
            <Icon size={15} strokeWidth={1.8} />
          </motion.span>
        </div>
        <div className="font-mono text-2xl font-semibold tracking-[-.04em] text-foreground dark:text-zinc-100 group-hover:text-primary transition-colors">
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground dark:text-zinc-400">{meta}</p>
      </div>

      {progress && (
        <div className="mt-3.5 pt-3 border-t border-border/80 dark:border-zinc-800/80">
          <div className="h-1.5 w-full bg-muted dark:bg-zinc-900 border border-border/60 dark:border-zinc-800/80 rounded-[2px] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, Math.max(0, progress.valuePct))}%` }}
              transition={{ duration: 0.9, delay: delay + 0.15, ease: "easeOut" }}
              className={`h-full ${progress.color}`}
            />
          </div>
          {(progress.leftLabel || progress.rightLabel) && (
            <div className="mt-1.5 flex justify-between text-[10px] font-mono text-muted-foreground dark:text-zinc-500">
              <span>{progress.leftLabel}</span>
              <span>{progress.rightLabel}</span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

import { getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";

const HOME_FILTER_TABS: readonly Filter[] = ["Todas", "Atrasadas", "Alta", "Hoje", "Concluídas"];

export interface CommercialHomeViewProps {
  operatorId?: string;
  isManagementPreview?: boolean;
  onBack?: () => void;
}

export function CommercialHomeView({
  operatorId,
  isManagementPreview = false,
  onBack,
}: CommercialHomeViewProps = {}) {
  const {
    tenant,
    setActiveView,
    setSelectedChatId,
    setActiveQueue,
    refreshConversations,
    operatorProfile,
  } = useChat();
  const navigate = useNavigate();
  const [data, setData] = useState<CommercialHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(() =>
    isManagementPreview ? "Todas" : getInitialTabFromUrl("commercialHome", "Todas", HOME_FILTER_TABS),
  );
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>("");
  const [selectedDirective, setSelectedDirective] = useState<
    CommercialHome["directives"][number] | null
  >(null);
  const [isAgendaModalOpen, setIsAgendaModalOpen] = useState(false);
  const [agendaModalFilter, setAgendaModalFilter] = useState<AgendaModalFilter>("todos");
  const [agendaSearch, setAgendaSearch] = useState("");
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [startingChatKey, setStartingChatKey] = useState<string | null>(null);

  const readStorageKey = useMemo(
    () => `valem_home_read_directives_${tenant || "tecfag"}_${operatorId || "self"}`,
    [tenant, operatorId],
  );

  const [readDirectiveIds, setReadDirectiveIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(
        `valem_home_read_directives_${tenant || "tecfag"}_${operatorId || "self"}`,
      );
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed.filter((x) => typeof x === "string"));
      }
    } catch {
      // ignore storage errors
    }
    return new Set();
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(readStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setReadDirectiveIds(new Set(parsed.filter((x) => typeof x === "string")));
          return;
        }
      }
      setReadDirectiveIds(new Set());
    } catch {
      setReadDirectiveIds(new Set());
    }
  }, [readStorageKey]);

  useTrainingSurface("home", (step) => {
    if (loading || !data) return false;
    setIsAgendaModalOpen(step.id === "home.agenda-modal");
    setSelectedDirective(step.surface === "home.evidence-dialog" ? data.directives[0] || null : null);
    setFilter(step.id === "home.overdue" ? "Atrasadas" : "Todas");
    return true;
  });

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const url = operatorId
        ? `/api/commercial/home?operatorId=${encodeURIComponent(operatorId)}`
        : "/api/commercial/home";
      const response = await fetch(url, { credentials: "same-origin", signal });
      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(
          errPayload.error ||
            (response.status === 403
              ? "Você não tem acesso ao Início Comercial."
              : "Falha ao carregar seus indicadores comerciais."),
        );
      }
      const home = (await response.json()) as CommercialHome;
      if (!signal?.aborted) {
        setData(home);
        if (!selectedCalendarDate) {
          setSelectedCalendarDate(home.today);
        }
      }
    } catch (cause) {
      if (!signal?.aborted)
        setError(
          cause instanceof Error ? cause.message : "Falha ao carregar seus indicadores comerciais.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [operatorId, selectedCalendarDate]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, tenant, operatorId]);

  const handleRefreshPage = useCallback(() => {
    if (
      (typeof document !== "undefined" && document.documentElement.dataset.trainingInstalled) ||
      isManagementPreview
    ) {
      void load();
      return;
    }
    setLoading(true);
    window.location.reload();
  }, [isManagementPreview, load]);

  const openDeal = (dealId: string) =>
    navigate({ to: "/crm/deals/$dealId", params: { dealId }, search: { from: "crm" } });

  const openCrm = () => {
    setActiveView("crm");
    navigate({ to: "/negociacoes/quadro" as any });
  };

  const handleOpenCompany = (accountId?: string | null) => {
    if (accountId) {
      setSelectedAccountId(accountId);
      return;
    }
    toast.info("Esta negociação ainda não possui empresa vinculada. Abrindo lista de empresas...");
    setActiveView("contacts");
    navigate({ to: "/clientes/empresas" as any });
  };

  const handleOpenChatForItem = async (item: {
    id: string;
    dealId: string;
    conversationId?: string | null;
    contactId?: string | null;
  }) => {
    if (item.conversationId) {
      setIsAgendaModalOpen(false);
      setIsNotificationsOpen(false);
      setSelectedChatId(item.conversationId);
      setActiveView("chat");
      navigate({ to: "/conversas" as any });
      return;
    }

    if (item.contactId) {
      try {
        setStartingChatKey(item.id);
        const res = await fetch(
          `/api/contacts/${encodeURIComponent(item.contactId)}/conversations`,
          {
            method: "POST",
            credentials: "include",
          },
        );
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.conversationId) {
          throw new Error(payload.error || "Não foi possível abrir o atendimento deste contato.");
        }
        if (refreshConversations) {
          await refreshConversations(payload.conversationId);
        }
        const queue = payload.readOnly
          ? payload.queueState === "fila"
            ? "fila"
            : payload.queueState === "automacao"
              ? "automacao"
              : "todos"
          : "meus";
        setIsAgendaModalOpen(false);
        setIsNotificationsOpen(false);
        setActiveQueue(queue);
        setSelectedChatId(payload.conversationId);
        setActiveView("chat");
        navigate({ to: "/conversas" as any });
        return;
      } catch (err: any) {
        toast.error(err?.message || "Não foi possível iniciar o chat com este contato.");
      } finally {
        setStartingChatKey(null);
      }
      return;
    }

    toast.info("Nenhum contato com WhatsApp/Chat vinculado a esta negociação. Abrindo no CRM...");
    setIsAgendaModalOpen(false);
    setIsNotificationsOpen(false);
    openDeal(item.dealId);
  };

  // Dados calculados para exibição
  const now = useMemo(() => new Date(), []);
  const weekdayName = useMemo(
    () => now.toLocaleDateString("pt-BR", { weekday: "long" }).toUpperCase(),
    [now],
  );
  const dateLongFormatted = useMemo(() => {
    const day = now.getDate();
    const month = now.toLocaleDateString("pt-BR", { month: "long" }).toUpperCase();
    const year = now.getFullYear();
    return `${day} DE ${month} DE ${year}`;
  }, [now]);

  const hour = useMemo(() => {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        hour12: false,
      }).format(now),
    );
  }, [now]);

  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const consultantName =
    (!isManagementPreview && operatorProfile?.name) || data?.consultant.name || "Consultor";
  const consultantAvatar =
    (!isManagementPreview && operatorProfile?.avatar) ||
    data?.consultant.avatar ||
    getDeterministicConsultantAvatar(consultantName);
  const consultantFirstName = consultantName.trim().split(/\s+/)[0];

  const directives = useMemo(() => data?.directives || [], [data?.directives]);
  const completedDirectives = useMemo(
    () => directives.filter((d) => d.status === "completed"),
    [directives],
  );
  const pendingDirectives = useMemo(
    () => directives.filter((d) => d.status === "pending"),
    [directives],
  );
  const openActionsCount = pendingDirectives.length;
  const overdueActionsCount = pendingDirectives.filter((d) => d.overdue).length;

  const totalActionsCount = openActionsCount + completedDirectives.length;
  const progressRatio =
    totalActionsCount > 0 ? (completedDirectives.length / totalActionsCount) * 100 : 0;

  // Notificações reais das responsabilidades alocadas pelo gestor
  const isDirectiveNotificationRead = useCallback(
    (dir: CommercialHome["directives"][number]) => {
      return (
        dir.status === "completed" ||
        Boolean(dir.notificationReadAt) ||
        readDirectiveIds.has(dir.id)
      );
    },
    [readDirectiveIds],
  );

  const unreadDirectives = useMemo(
    () => directives.filter((d) => !isDirectiveNotificationRead(d)),
    [directives, isDirectiveNotificationRead],
  );
  const unreadNotificationsCount = unreadDirectives.length;

  const sortedNotificationDirectives = useMemo(() => {
    return [...directives].sort((a, b) => {
      const aUnread = !isDirectiveNotificationRead(a) ? 1 : 0;
      const bUnread = !isDirectiveNotificationRead(b) ? 1 : 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      const aTime = a.createdAt || a.assignedDate || "";
      const bTime = b.createdAt || b.assignedDate || "";
      return bTime.localeCompare(aTime);
    });
  }, [directives, isDirectiveNotificationRead]);

  const markNotificationsRead = useCallback(
    async (targetIds?: string[], markAll = false) => {
      const idsToMark = markAll
        ? directives.map((d) => d.id)
        : (targetIds || []).filter(Boolean);
      if (idsToMark.length === 0) return;

      const nowIso = new Date().toISOString();
      setReadDirectiveIds((prev) => {
        const next = new Set(prev);
        for (const id of idsToMark) next.add(id);
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(readStorageKey, JSON.stringify(Array.from(next)));
          } catch {
            // ignore storage errors
          }
        }
        return next;
      });

      setData((prev) => {
        if (!prev) return prev;
        const idSet = new Set(idsToMark);
        return {
          ...prev,
          directives: prev.directives.map((d) =>
            markAll || idSet.has(d.id) ? { ...d, notificationReadAt: nowIso } : d,
          ),
        };
      });

      try {
        await fetch("/api/commercial/home", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            operatorId,
            directiveIds: idsToMark,
            markAll,
          }),
        });
      } catch {
        // Persistência local já garante feedback imediato
      }
    },
    [directives, operatorId, readStorageKey],
  );

  // Abas de diretrizes com suporte a navegação rápida por teclado
  const directiveTabs = useMemo<Filter[]>(() => {
    const tabs: Filter[] = ["Todas"];
    if (overdueActionsCount > 0) tabs.push("Atrasadas");
    tabs.push("Alta", "Hoje");
    if (completedDirectives.length > 0) tabs.push("Concluídas");
    return tabs;
  }, [completedDirectives.length, overdueActionsCount]);

  useTabNavigation({
    tabs: directiveTabs,
    activeTab: filter,
    onChange: setFilter,
    enabled: !isManagementPreview,
  });

  useSyncModuleTabWithUrl({
    viewId: "commercialHome",
    activeTab: filter,
    setActiveTab: setFilter,
    allowedTabs: HOME_FILTER_TABS,
    enabled: !isManagementPreview,
  });

  // Filtragem de diretrizes
  const visibleDirectives = useMemo(() => {
    if (filter === "Atrasadas") return pendingDirectives.filter((d) => d.overdue);
    if (filter === "Alta")
      return pendingDirectives.filter(
        (d) =>
          d.priority.toLowerCase() === "alta" ||
          d.priority.toLowerCase() === "high" ||
          d.priority.toLowerCase() === "critical",
      );
    if (filter === "Hoje")
      return pendingDirectives.filter((d) => d.assignedDate === (data?.today || ""));
    if (filter === "Concluídas") return completedDirectives;
    return pendingDirectives;
  }, [completedDirectives, data?.today, filter, pendingDirectives]);

  // Itens unificados para a Agenda de Hoje (Tarefas + Responsabilidades)
  const unifiedAgendaItems = useMemo(() => {
    const acts = (data?.activities || []).map((act) => ({
      uid: `task-${act.id}`,
      id: act.id,
      kind: "task" as const,
      title: act.title,
      subtitle: act.description || null,
      taskType: act.type || "task",
      status: act.status || "pending",
      overdue: Boolean(act.overdue),
      priority: act.overdue ? "high" : "normal",
      dueDate: act.dueDate,
      assignedDate: act.dueDate ? act.dueDate.slice(0, 10) : data?.today || "",
      dealId: act.dealId,
      dealTitle: act.dealTitle,
      dealValue: Number(act.dealValue ?? 0),
      pipelineName: act.pipelineName ?? null,
      stageName: act.stageName ?? null,
      accountId: act.accountId ?? null,
      accountName: act.accountName ?? null,
      accountDocument: act.accountDocument ?? null,
      contactId: act.contactId ?? null,
      contactName: act.contactName ?? null,
      contactPhone: act.contactPhone ?? null,
      conversationId: act.conversationId ?? null,
      assignedByOperatorName: act.assignedByOperatorName ?? null,
      rawDirective: null as CommercialHome["directives"][number] | null,
    }));

    const dirs = directives.map((dir) => ({
      uid: `dir-${dir.id}`,
      id: dir.id,
      kind: "directive" as const,
      title: dir.instruction || "GESTOR PONTUOU ATENÇÃO E EXECUÇÃO NESSA NEGOCIAÇÃO",
      subtitle: dir.completionNote || null,
      taskType: "directive",
      status: dir.status,
      overdue: Boolean(dir.overdue),
      priority: dir.priority || "normal",
      dueDate: dir.dueAt,
      assignedDate: dir.assignedDate,
      dealId: dir.dealId,
      dealTitle: dir.dealTitle,
      dealValue: Number(dir.dealValue ?? 0),
      pipelineName: dir.pipelineName ?? null,
      stageName: dir.stageName ?? null,
      accountId: dir.accountId ?? null,
      accountName: dir.accountName ?? null,
      accountDocument: dir.accountDocument ?? null,
      contactId: dir.contactId ?? null,
      contactName: dir.contactName ?? null,
      contactPhone: dir.contactPhone ?? null,
      conversationId: dir.conversationId ?? null,
      assignedByOperatorName: dir.assignedByOperatorName || "Gestão Comercial",
      rawDirective: dir,
    }));

    return [...acts, ...dirs];
  }, [data?.activities, data?.today, directives]);

  const filteredAgendaItems = useMemo(() => {
    const q = agendaSearch.trim().toLowerCase();
    return unifiedAgendaItems.filter((item) => {
      if (agendaModalFilter === "tarefas" && item.kind !== "task") return false;
      if (agendaModalFilter === "responsabilidades" && item.kind !== "directive") return false;
      if (agendaModalFilter === "atrasadas" && !item.overdue) return false;
      if (!q) return true;
      return (
        item.dealTitle.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        (item.accountName && item.accountName.toLowerCase().includes(q)) ||
        (item.contactName && item.contactName.toLowerCase().includes(q)) ||
        (item.stageName && item.stageName.toLowerCase().includes(q))
      );
    });
  }, [agendaModalFilter, agendaSearch, unifiedAgendaItems]);

  const totalAgendaValue = useMemo(() => {
    const seenDeals = new Set<string>();
    let sum = 0;
    for (const item of unifiedAgendaItems) {
      if (!seenDeals.has(item.dealId)) {
        seenDeals.add(item.dealId);
        sum += Number(item.dealValue || 0);
      }
    }
    return sum;
  }, [unifiedAgendaItems]);

  const overdueAgendaCount = useMemo(
    () => unifiedAgendaItems.filter((i) => i.overdue && i.status !== "completed").length,
    [unifiedAgendaItems],
  );

  // Cálculos do Calendário Comercial
  const calendarData = useMemo(() => {
    const monthKey = data?.month || data?.today?.slice(0, 7) || "2026-10";
    const [yearStr, monthStr] = monthKey.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const totalDays = new Date(year, month, 0).getDate();
    const firstDayWeekIndex = new Date(year, month - 1, 1).getDay(); // 0 = Dom, 1 = Seg...

    const wonMap = new Map<string, Array<NonNullable<CommercialHome["wonDeals"]>[number]>>();
    (data?.wonDeals || []).forEach((deal) => {
      if (!deal.closedAt) return;
      const dStr = deal.closedAt.slice(0, 10);
      if (!wonMap.has(dStr)) wonMap.set(dStr, []);
      wonMap.get(dStr)!.push(deal);
    });

    const holidaysMap = new Map<string, NonNullable<CommercialHome["calendarDays"]>[number]>();
    (data?.calendarDays || []).forEach((h) => {
      if (h.type === "holiday" || h.type === "bridge" || h.type === "suspension") {
        holidaysMap.set(h.date, h);
      }
    });

    const todayStr = data?.today || new Date().toISOString().slice(0, 10);

    const days: Array<{
      dayNumber: number;
      dateStr: string;
      dayOfWeek: number;
      isWeekend: boolean;
      isToday: boolean;
      deals: Array<NonNullable<CommercialHome["wonDeals"]>[number]>;
      totalSold: number;
      holiday: NonNullable<CommercialHome["calendarDays"]>[number] | null;
    }> = [];

    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dObj = new Date(year, month - 1, d);
      const dayOfWeek = dObj.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const deals = wonMap.get(dateStr) || [];
      const totalSold = deals.reduce((acc, deal) => acc + (deal.value || 0), 0);
      const holiday = holidaysMap.get(dateStr) || null;

      days.push({
        dayNumber: d,
        dateStr,
        dayOfWeek,
        isWeekend,
        isToday: dateStr === todayStr,
        deals,
        totalSold,
        holiday,
      });
    }

    return { firstDayWeekIndex, days, year, month, totalDays, todayStr };
  }, [data?.calendarDays, data?.month, data?.today, data?.wonDeals]);

  // Informações do dia selecionado no calendário
  const selectedDayInfo = useMemo(() => {
    const targetDate = selectedCalendarDate || data?.today || "";
    return calendarData.days.find((d) => d.dateStr === targetDate) || null;
  }, [calendarData.days, data?.today, selectedCalendarDate]);

  const selectedDayFormatted = useMemo(() => {
    const targetDate = selectedCalendarDate || data?.today;
    if (!targetDate) return "";
    const [y, m, d] = targetDate.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }, [data?.today, selectedCalendarDate]);

  const monthNameFormatted = useMemo(() => {
    const monthKey = data?.month || data?.today?.slice(0, 7) || "2026-10";
    const [y, m] = monthKey.split("-").map(Number);
    const dateObj = new Date(y, m - 1, 1);
    const mStr = dateObj.toLocaleDateString("pt-BR", { month: "long" });
    return `${mStr.charAt(0).toUpperCase() + mStr.slice(1)} ${y}`;
  }, [data?.month, data?.today]);

  const coveragePct = data?.goal.coveragePercent ?? 0;
  const expectedPct = data?.goal.expectedPercent ?? 23;
  const targetValueFormatted = formatBRL(data?.goal.targetValue ?? 0);
  const realizedValueFormatted = formatBRL(data?.goal.realizedValue ?? 0);
  const dailyRequiredFormatted = data?.goal.configured
    ? formatBRL(data?.goal.dailyRequired ?? 0)
    : "—";
  const wonDealsCount = data?.wonDeals?.length ?? data?.deals.wonThisMonthCount ?? 0;
  const wonDealsCountFormatted = String(wonDealsCount).padStart(2, "0");
  const conversionRate = data?.goal.conversionRate ?? 10.0;
  const remainingWorkdays = data?.goal.remainingDays ?? 17;
  const businessDays = data?.goal.businessDays ?? 22;
  const elapsedDays = data?.goal.elapsedDays ?? 5;

  const ticketMedio =
    wonDealsCount > 0 ? (data?.goal.realizedValue || 0) / wonDealsCount : 0;

  return (
    <section className="h-full min-w-0 flex-1 overflow-y-auto bg-background px-3 py-4 text-foreground sm:px-6 sm:py-6 lg:px-8">
      {/* Background aurora sutil para profundidade de cockpit */}
      <div
        className="pointer-events-none fixed inset-0 opacity-30 dark:opacity-40"
        style={{
          background:
            "radial-gradient(circle at 76% 0%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 28%), radial-gradient(circle at 5% 75%, rgba(16,185,129,.05), transparent 28%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-[2400px]">
        {/* HEADER EXECUTIVO IDÊNTICO À REFERÊNCIA COM ANIMAÇÃO */}
        <motion.header
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="border-b border-border/80 pb-5 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-4">
            {/* Logomarca Oficial da Empresa com Micro-animação no Hover */}
            <div className="flex items-center gap-2.5 sm:gap-3 group">
              <motion.div
                whileHover={{ scale: 1.08, rotate: 2 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
                className="flex size-9 sm:size-10 items-center justify-center border border-border bg-card p-1 rounded-[4px] dark:border-zinc-800 dark:bg-zinc-950 shadow-sm overflow-hidden cursor-pointer"
              >
                <img
                  src={tenant === "tecfag" ? "/logo_tecfag.png" : "/logo_valem.jpg"}
                  alt={tenant === "tecfag" ? "Tecfag" : "Valem"}
                  className="h-full w-full object-contain"
                />
              </motion.div>
              <div>
                <div className="font-mono text-[15px] sm:text-[17px] font-bold tracking-[-.03em] text-foreground dark:text-zinc-50 flex items-center">
                  {tenant === "tecfag" ? "TECFAG" : "VALEM"}
                  <span className="text-primary animate-pulse ml-0.5">.</span>
                </div>
                <div className="mt-0.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-[.18em] sm:tracking-[.22em] text-muted-foreground dark:text-zinc-500">
                  PORTAL DO CONSULTOR
                </div>
              </div>
            </div>

            {/* Ações Rápidas de Topo com Animações Fluidas */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <SystemTooltip content="Recarregar página">
                <motion.button
                  type="button"
                  data-tour="home.refresh"
                  whileHover={{ scale: 1.08, rotate: 60 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ duration: 0.2 }}
                  onClick={handleRefreshPage}
                  disabled={loading}
                  aria-label="Recarregar página"
                  className="border border-border bg-card p-2 text-muted-foreground hover:border-primary/40 hover:text-foreground cursor-pointer rounded-[4px] dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400 dark:hover:text-zinc-50 transition-colors shadow-sm"
                >
                  <RefreshCw size={15} className={loading ? "animate-spin text-primary" : ""} />
                </motion.button>
              </SystemTooltip>

              {/* Sino de Notificações Reais (Responsabilidades alocadas pelo gestor) */}
              <Popover open={isNotificationsOpen} onOpenChange={setIsNotificationsOpen}>
                <SystemTooltip
                  content={
                    unreadNotificationsCount > 0
                      ? `${unreadNotificationsCount} responsabilidade(s) não lida(s)`
                      : "Notificações recentes"
                  }
                >
                  <PopoverTrigger asChild>
                    <motion.button
                      type="button"
                      data-tour="home.overdue"
                      whileHover={{
                        scale: 1.08,
                        rotate: unreadNotificationsCount > 0 ? [0, -8, 8, -4, 0] : 0,
                      }}
                      whileTap={{ scale: 0.92 }}
                      transition={{ duration: 0.25 }}
                      onClick={() => {
                        if (
                          typeof document !== "undefined" &&
                          document.documentElement.dataset.trainingInstalled
                        ) {
                          setFilter("Atrasadas");
                        }
                      }}
                      aria-label="Notificações recentes"
                      className={`relative border p-2 cursor-pointer rounded-[4px] transition-colors shadow-sm ${
                        unreadNotificationsCount > 0
                          ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 dark:border-rose-700/80 dark:bg-rose-950/35 dark:text-rose-300"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400 dark:hover:text-zinc-50"
                      }`}
                    >
                      <Bell
                        size={16}
                        strokeWidth={1.8}
                        className={unreadNotificationsCount > 0 ? "text-primary" : ""}
                      />
                      {unreadNotificationsCount > 0 && (
                        <span className=" -right-1.5 -top-1.5 absolute inline-flex min-w-[20px] h-[17px] items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-bold leading-none text-primary-foreground shadow-sm ring-2 ring-background">
                          +{unreadNotificationsCount}
                        </span>
                      )}
                    </motion.button>
                  </PopoverTrigger>
                </SystemTooltip>

                <PopoverContent
                  align="end"
                  sideOffset={8}
                  collisionPadding={16}
                  className="w-[400px] max-w-[calc(100vw-24px)] p-0 rounded-xl bg-card/95 backdrop-blur-xl border border-border shadow-2xl z-[180] overflow-hidden text-foreground select-none"
                >
                  <div className="flex items-center justify-between border-b border-border/80 bg-muted/30 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-[4px] border border-primary/30 bg-primary/10 text-primary">
                        <Bell size={14} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-foreground">
                            Notificações Recentes
                          </span>
                          {unreadNotificationsCount > 0 && (
                            <span className="rounded-full bg-primary/15 border border-primary/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                              +{unreadNotificationsCount} nova(s)
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">
                          Responsabilidades alocadas pela Gestão Comercial
                        </p>
                      </div>
                    </div>

                    {unreadNotificationsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void markNotificationsRead(undefined, true)}
                        className="shrink-0 inline-flex items-center gap-1 rounded-[4px] border border-border bg-card px-2 py-1 text-[10px] font-bold text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors cursor-pointer"
                      >
                        <CheckCheck size={12} />
                        Marcar todas como lidas
                      </button>
                    )}
                  </div>

                  <div className="max-h-[410px] overflow-y-auto divide-y divide-border/70 dark:divide-zinc-800/80">
                    {sortedNotificationDirectives.length > 0 ? (
                      sortedNotificationDirectives.map((notif) => {
                        const isRead = isDirectiveNotificationRead(notif);
                        const isDone = notif.status === "completed";
                        const dateLabel = notif.assignedDate
                          ? `${notif.assignedDate.slice(8, 10)}/${notif.assignedDate.slice(5, 7)}/${notif.assignedDate.slice(0, 4)}`
                          : "Hoje";

                        return (
                          <div
                            key={notif.id}
                            className={`p-3.5 transition-colors ${
                              !isRead
                                ? "bg-primary/5 hover:bg-primary/10 dark:bg-rose-950/15 dark:hover:bg-rose-950/25"
                                : "bg-card hover:bg-muted/40 dark:bg-zinc-950/40"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {!isRead && (
                                  <span className="size-2 shrink-0 rounded-full bg-primary animate-pulse" />
                                )}
                                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-primary truncate">
                                  Responsabilidade Alocada
                                </span>
                                <span className="text-[10px] text-muted-foreground">·</span>
                                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                  {dateLabel}
                                </span>
                              </div>
                              <PriorityPill priority={notif.priority} />
                            </div>

                            <div className="mt-1.5 flex items-baseline justify-between gap-2">
                              <h4 className="text-xs font-bold text-foreground truncate">
                                {notif.dealTitle}
                              </h4>
                              <span className="font-mono text-xs font-bold text-emerald-500 shrink-0">
                                {formatBRL(notif.dealValue)}
                              </span>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                              {notif.stageName && (
                                <span className="font-medium text-foreground/80">
                                  Etapa: {notif.stageName}
                                </span>
                              )}
                              {notif.accountName && (
                                <>
                                  <span>·</span>
                                  <span className="truncate max-w-[180px]">
                                    Empresa: {notif.accountName}
                                  </span>
                                </>
                              )}
                              {notif.assignedByOperatorName && (
                                <>
                                  <span>·</span>
                                  <span>Por: {notif.assignedByOperatorName}</span>
                                </>
                              )}
                            </div>

                            <p className="mt-2 rounded-[4px] border border-border/60 bg-muted/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground dark:border-zinc-800 dark:bg-zinc-900/60">
                              {notif.instruction ||
                                "GESTOR PONTUOU ATENÇÃO E EXECUÇÃO NESSA NEGOCIAÇÃO"}
                            </p>

                            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!isRead) void markNotificationsRead([notif.id], false);
                                    setIsNotificationsOpen(false);
                                    openDeal(notif.dealId);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-[4px] border border-border bg-card px-2 py-1 text-[10px] font-bold text-foreground hover:border-primary/40 hover:text-primary transition-colors cursor-pointer"
                                >
                                  <ExternalLink size={11} />
                                  Abrir CRM
                                </button>
                                <button
                                  type="button"
                                  disabled={startingChatKey === notif.id}
                                  onClick={() => {
                                    if (!isRead) void markNotificationsRead([notif.id], false);
                                    void handleOpenChatForItem(notif);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-[4px] border border-border bg-card px-2 py-1 text-[10px] font-bold text-foreground hover:border-primary/40 hover:text-primary transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  {startingChatKey === notif.id ? (
                                    <Loader2 size={11} className="animate-spin" />
                                  ) : (
                                    <MessageSquare size={11} />
                                  )}
                                  Chat
                                </button>
                                {!isDone && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!isRead) void markNotificationsRead([notif.id], false);
                                      setIsNotificationsOpen(false);
                                      setSelectedDirective(notif);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-[4px] bg-[#00a868] hover:bg-[#00965d] px-2 py-1 text-[10px] font-bold text-white transition-colors cursor-pointer"
                                  >
                                    <Check size={11} />
                                    Concluir
                                  </button>
                                )}
                              </div>

                              {!isRead ? (
                                <button
                                  type="button"
                                  onClick={() => void markNotificationsRead([notif.id], false)}
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-primary hover:underline cursor-pointer"
                                >
                                  <CheckCheck size={12} />
                                  Marcar como lida
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                                  <Check size={11} className="text-emerald-500" />
                                  {isDone ? "Concluída" : "Lida"}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
                        <div className="flex size-10 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground">
                          <Bell size={18} />
                        </div>
                        <p className="mt-3 font-mono text-xs font-bold text-foreground">
                          Nenhuma notificação recente
                        </p>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          Quando o gestor alocar responsabilidades para você, elas aparecerão aqui
                          em tempo real.
                        </p>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Chip do Consultor — Abre o mesmo ProfilePopover da barra lateral */}
              {!isManagementPreview ? (
                <ProfilePopover side="bottom" align="end" sideOffset={8}>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.03, y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    aria-label="Editar Meu Perfil"
                    className="group/profile flex items-center gap-2 border border-border bg-card px-2 sm:px-2.5 py-1.5 text-left rounded-[4px] hover:border-primary/50 dark:border-zinc-800 dark:bg-zinc-950/70 dark:hover:border-zinc-700 shadow-sm cursor-pointer transition-colors"
                  >
                    <div className="relative shrink-0">
                      <img
                        src={consultantAvatar}
                        alt={consultantName}
                        className="size-6 rounded-[2px] object-cover border border-border dark:border-zinc-700"
                        onError={(e) => {
                          const img = e.currentTarget;
                          const fallback = getDeterministicConsultantAvatar(consultantName);
                          if (img.src !== fallback) {
                            img.src = fallback;
                          }
                        }}
                      />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-card ${
                          operatorProfile?.status === "disponivel"
                            ? "bg-primary"
                            : operatorProfile?.status === "pausa"
                              ? "bg-amber-500"
                              : "bg-zinc-400"
                        }`}
                      />
                    </div>
                    <span className="hidden text-xs font-semibold text-foreground group-hover/profile:text-primary dark:text-zinc-300 sm:inline transition-colors">
                      {consultantName}
                    </span>
                  </motion.button>
                </ProfilePopover>
              ) : (
                <motion.div
                  whileHover={{ scale: 1.03, y: -1 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-2 border border-border bg-card px-2 sm:px-2.5 py-1.5 text-left rounded-[4px] dark:border-zinc-800 dark:bg-zinc-950/70 shadow-sm cursor-default"
                >
                  <img
                    src={consultantAvatar}
                    alt={consultantName}
                    className="size-6 rounded-[2px] object-cover border border-border dark:border-zinc-700"
                    onError={(e) => {
                      const img = e.currentTarget;
                      const fallback = getDeterministicConsultantAvatar(consultantName);
                      if (img.src !== fallback) {
                        img.src = fallback;
                      }
                    }}
                  />
                  <span className="hidden text-xs font-semibold text-foreground dark:text-zinc-300 sm:inline">
                    {consultantName}
                  </span>
                </motion.div>
              )}

              {/* Botão Vermelho Oficial "Abrir CRM" */}
              <motion.button
                data-tour="home.open-crm"
                whileHover={{
                  scale: 1.04,
                  y: -1,
                  boxShadow: "0 6px 20px color-mix(in srgb, var(--primary) 40%, transparent)",
                }}
                whileTap={{ scale: 0.96 }}
                transition={{ duration: 0.15 }}
                onClick={openCrm}
                className="flex items-center gap-1.5 sm:gap-2 bg-primary px-2.5 sm:px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-95 cursor-pointer rounded-[4px] shadow-sm transition-all whitespace-nowrap"
              >
                <ExternalLink size={13} strokeWidth={2.4} />
                Abrir CRM
              </motion.button>
            </div>
          </div>

          {/* Subheader: Data por extenso, Saudação e Atalho de Agenda */}
          <div className="mt-5 sm:mt-7 flex flex-wrap items-end justify-between gap-3.5 sm:gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-muted-foreground dark:text-zinc-400">
                <span>{weekdayName}</span>
                <span className="h-1 w-1 rounded-full bg-primary" />
                <span>{dateLongFormatted}</span>
              </div>
              <h1 className="mt-2 font-mono text-2xl sm:text-4xl font-semibold tracking-[-.06em] text-foreground dark:text-zinc-50">
                {greeting}, {consultantFirstName}
                <span className="text-primary">.</span>
              </h1>
              <p className="mt-1.5 sm:mt-2 max-w-xl text-xs sm:text-sm text-muted-foreground dark:text-zinc-400">
                Seu foco de hoje está aqui: acompanhe o ritmo, execute as diretrizes e mova as
                oportunidades certas.
              </p>
            </div>

            <motion.button
              data-tour="home.today-agenda"
              whileHover={{ x: 4, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
              onClick={() => setIsAgendaModalOpen(true)}
              className="group flex items-center gap-2 border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground hover:border-primary hover:text-primary cursor-pointer rounded-[4px] transition-colors dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300 dark:hover:border-rose-400 dark:hover:text-zinc-50 shadow-sm"
            >
              <CalendarDays size={15} className="text-primary group-hover:scale-110 transition-transform" />
              Ver agenda de hoje
              {unifiedAgendaItems.length > 0 && (
                <span className="rounded-[2px] bg-primary/15 border border-primary/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                  {unifiedAgendaItems.length}
                </span>
              )}
              <ArrowUpRight size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </motion.button>
          </div>
        </motion.header>

        {loading && !data ? (
          <CommercialHomeSkeleton />
        ) : error ? (
          <div
            role="alert"
            className="mt-6 rounded-[4px] border border-red-300 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            {error}
          </div>
        ) : data ? (
          /* GRID PRINCIPAL EM 2 COLUNAS: ESQUERDA (COCKPIT & DIRETRIZES 65%) + DIREITA (CALENDÁRIO & DOSSIÊ 35%) */
          <div className="mt-5 sm:mt-6 grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,1fr)] 2xl:grid-cols-[minmax(0,1.65fr)_minmax(420px,1fr)] items-start">
            {/* COLUNA ESQUERDA: COCKPIT OPERACIONAL & DIRETRIZES TÁTICAS */}
            <div className="space-y-4">
              {/* BLOCO 1: 3 CARDS DE TOPO (Ritmo de Hoje + KPIs com Barras de Progresso) */}
              <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr_1fr]">
                {/* CARD 1: RITMO DE HOJE COM HOVER & ANIMAÇÃO */}
                <motion.section
                  data-tour="home.rhythm-card"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.05, ease: "easeOut" }}
                  whileHover={{ y: -4, transition: { duration: 0.2 } }}
                  className="group relative overflow-hidden border border-primary/40 bg-card p-4 sm:p-6 flex flex-col justify-between dark:border-rose-800/80 dark:bg-zinc-950/70 rounded-[4px] shadow-sm hover:shadow-lg hover:border-primary/70 transition-all duration-300"
                >
                  <div className="pointer-events-none absolute -right-8 -top-14 h-48 w-48 rounded-full border-[26px] border-primary/10 group-hover:scale-110 group-hover:opacity-80 transition-all duration-500" />
                  <div className="relative">
                    <div className="flex items-start justify-between gap-3 sm:gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                          <Flame size={14} className="group-hover:scale-125 group-hover:rotate-12 transition-transform duration-300" />
                          Ritmo de hoje
                        </div>
                        <h2 className="mt-2.5 sm:mt-3 max-w-[320px] font-mono text-xl sm:text-2xl font-semibold leading-[1.12] sm:leading-[1.08] tracking-[-.05em] text-foreground dark:text-zinc-50 group-hover:text-primary transition-colors">
                          Você precisa fechar o próximo passo.
                        </h2>
                      </div>
                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        className="shrink-0 border border-primary/40 bg-primary/10 px-2.5 sm:px-3 py-1.5 sm:py-2 text-right rounded-[4px] dark:border-rose-800 dark:bg-rose-950/30 transition-transform"
                      >
                        <div className="font-mono text-lg sm:text-xl font-bold text-primary dark:text-rose-400">
                          {openActionsCount}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-[.15em] text-primary/90 dark:text-rose-300">
                          ações abertas
                        </div>
                        {overdueActionsCount > 0 && (
                          <div className="mt-1 font-mono text-[9px] font-bold text-red-600 dark:text-red-400 uppercase tracking-[.08em] animate-pulse">
                            {overdueActionsCount} em atraso
                          </div>
                        )}
                      </motion.div>
                    </div>
                    <div className="mt-7 flex items-end justify-between gap-5">
                      <div>
                        <div className="font-mono text-4xl font-bold tracking-[-.07em] text-primary dark:text-rose-400">
                          {completedDirectives.length} / {totalActionsCount}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground dark:text-zinc-400">
                          diretrizes já concluídas
                        </div>
                      </div>
                      <div className="min-w-[130px] flex-1 pb-2">
                        <ProgressBar value={progressRatio} delay={0.2} />
                        <div className="mt-2 flex justify-between text-[10px] font-mono text-muted-foreground dark:text-zinc-500">
                          <span>08:30</span>
                          <span>18:00</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.section>

                {/* CARD 2: FATURADO ACUMULADO */}
                <StatCard
                  label="Faturado acumulado"
                  value={realizedValueFormatted}
                  meta={`${coveragePct.toFixed(2)}% da meta mensal`}
                  icon={TrendingUp}
                  accent="#10b981"
                  delay={0.1}
                  progress={{
                    valuePct: coveragePct,
                    color: "bg-emerald-500",
                    leftLabel: `Realizado: ${coveragePct.toFixed(1)}%`,
                    rightLabel: `Meta: ${targetValueFormatted}`,
                  }}
                />

                {/* CARD 3: RITMO NECESSÁRIO / DIA */}
                <StatCard
                  label="Ritmo necessário / dia"
                  value={dailyRequiredFormatted}
                  meta={`${remainingWorkdays} dias úteis restantes`}
                  icon={Clock3}
                  accent="#f59e0b"
                  delay={0.15}
                  progress={{
                    valuePct: businessDays > 0 ? (elapsedDays / businessDays) * 100 : 0,
                    color: "bg-amber-500",
                    leftLabel: `${elapsedDays} dias decorridos`,
                    rightLabel: `${remainingWorkdays} restantes`,
                  }}
                />
              </div>

              {/* BLOCO 2: PROGRESSO DA META & AGENDA DE HOJE */}
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,.7fr)]">
                {/* PROGRESSO DA META */}
                <motion.section data-tour="home.goal"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
                  whileHover={{ y: -3, transition: { duration: 0.2 } }}
                  className="group border border-border/80 bg-card p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950/70 rounded-[4px] shadow-sm hover:shadow-lg hover:border-primary/40 transition-all duration-300"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground dark:text-zinc-400">
                        <Target size={14} className="text-primary group-hover:scale-120 group-hover:rotate-12 transition-transform duration-300" />
                        Progresso da meta
                      </div>
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="font-mono text-4xl font-bold tracking-[-.07em] text-foreground dark:text-zinc-50 group-hover:text-primary transition-colors">
                          {coveragePct.toFixed(2)}%
                        </span>
                        <span className="text-xs font-semibold text-emerald-500 dark:text-emerald-400">
                          {coveragePct >= expectedPct ? "ritmo acelerado" : "meta em curso"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground dark:text-zinc-400">Meta mensal</div>
                      <div className="mt-1 font-mono text-lg font-semibold text-foreground dark:text-zinc-300">
                        {targetValueFormatted}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="relative">
                      <ProgressBar value={coveragePct} color="#10b981" className="h-3" delay={0.3} />
                      <SystemTooltip content={`Esperado hoje: ${expectedPct.toFixed(0)}%`}>
                        <span
                          className="absolute -top-1.5 h-6 w-0.5 bg-primary"
                          style={{ left: `${Math.min(96, Math.max(4, expectedPct))}%` }}
                        />
                      </SystemTooltip>
                    </div>
                    <div className="mt-3 flex justify-between text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-500">
                      <span>Realizado · {realizedValueFormatted}</span>
                      <span className="text-primary font-bold">Esperado hoje · {expectedPct.toFixed(0)}%</span>
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-3 divide-x divide-border border-t border-border pt-5 dark:divide-zinc-800 dark:border-zinc-800">
                    <motion.div whileHover={{ scale: 1.04, y: -1 }} className="cursor-default">
                      <div className="text-[10px] uppercase tracking-[.13em] text-muted-foreground dark:text-zinc-400">
                        Vendas
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold text-foreground dark:text-zinc-50">
                        {wonDealsCountFormatted}
                      </div>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.04, y: -1 }} className="pl-4 cursor-default">
                      <div className="text-[10px] uppercase tracking-[.13em] text-muted-foreground dark:text-zinc-400">
                        Oportunidades
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold text-foreground dark:text-zinc-50">
                        {String(data.deals.openCount).padStart(2, "0")}
                      </div>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.04, y: -1 }} className="pl-4 cursor-default">
                      <div className="text-[10px] uppercase tracking-[.13em] text-muted-foreground dark:text-zinc-400">
                        Conversão
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold text-emerald-500 dark:text-emerald-400">
                        {conversionRate.toFixed(1)}%
                      </div>
                    </motion.div>
                  </div>
                </motion.section>

                {/* AGENDA DE HOJE (TAREFAS + RESPONSABILIDADES) */}
                <motion.section
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.25, ease: "easeOut" }}
                  whileHover={{ y: -3, transition: { duration: 0.2 } }}
                  className="group border border-border/80 bg-card p-5 sm:p-6 flex flex-col justify-between dark:border-zinc-800 dark:bg-zinc-950/70 rounded-[4px] shadow-sm hover:shadow-lg hover:border-primary/40 transition-all duration-300"
                >
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground dark:text-zinc-400">
                          <CalendarDays size={14} className="text-primary group-hover:scale-110 transition-transform" />
                          Agenda de hoje
                        </div>
                        <div className="mt-3 font-mono text-3xl font-bold tracking-[-.06em] text-foreground dark:text-zinc-50 group-hover:text-primary transition-colors">
                          {String(unifiedAgendaItems.length).padStart(2, "0")}{" "}
                          <span className="text-base font-medium tracking-normal text-muted-foreground dark:text-zinc-400">
                            compromissos
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                          <span className="rounded-[2px] border border-border bg-muted/50 px-1.5 py-0.5">
                            {data.activities.length} tarefa(s)
                          </span>
                          <span className="rounded-[2px] border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary">
                            {directives.length} responsabilidade(s)
                          </span>
                        </div>
                      </div>
                      <SystemTooltip content="Abrir agenda completa de hoje">
                        <motion.button
                          whileHover={{ scale: 1.15, rotate: 15 }}
                          whileTap={{ scale: 0.9 }}
                          transition={{ duration: 0.15 }}
                          onClick={() => setIsAgendaModalOpen(true)}
                          className="border border-border p-2 text-muted-foreground hover:border-primary hover:text-primary cursor-pointer rounded-[4px] dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-rose-400 dark:hover:text-rose-400 shadow-sm"
                        >
                          <ArrowUpRight size={15} />
                        </motion.button>
                      </SystemTooltip>
                    </div>

                    <div className="mt-4 space-y-2.5">
                      {unifiedAgendaItems.length > 0 ? (
                        unifiedAgendaItems.slice(0, 3).map((item) => {
                          const timeStr =
                            item.kind === "task" && item.dueDate
                              ? new Date(item.dueDate).toLocaleTimeString("pt-BR", {
                                  timeZone: "America/Sao_Paulo",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : item.kind === "directive"
                                ? "RESP."
                                : "HOJE";
                          return (
                            <motion.button
                              key={item.uid}
                              whileHover={{ x: 5, scale: 1.01 }}
                              whileTap={{ scale: 0.98 }}
                              transition={{ duration: 0.15 }}
                              onClick={() => setIsAgendaModalOpen(true)}
                              className="group/item flex w-full items-center gap-3 border-b border-border/80 pb-2.5 text-left last:border-0 last:pb-0 cursor-pointer dark:border-zinc-800 hover:bg-muted/40 p-1 rounded-[2px]"
                            >
                              <span
                                className={`w-12 shrink-0 font-mono text-[10px] font-bold ${
                                  item.kind === "directive"
                                    ? "text-primary"
                                    : "text-emerald-500 dark:text-emerald-400"
                                }`}
                              >
                                {timeStr}
                              </span>
                              <div className="min-w-0 flex-1 border-l border-border pl-3 dark:border-zinc-700">
                                <div className="truncate text-xs font-semibold text-foreground dark:text-zinc-300 group-hover/item:text-primary transition-colors">
                                  {item.dealTitle}
                                </div>
                                <div className="truncate text-[11px] text-muted-foreground dark:text-zinc-500">
                                  {item.title}
                                </div>
                              </div>
                            </motion.button>
                          );
                        })
                      ) : (
                        <div className="py-5 text-center text-xs text-muted-foreground dark:text-zinc-500 italic">
                          Nenhuma tarefa ou responsabilidade para hoje.
                        </div>
                      )}
                    </div>
                  </div>
                </motion.section>
              </div>

              {/* BLOCO 3: DIRETRIZES DO GESTOR ("O que move o ponteiro hoje") */}
              <motion.section
                data-tour="home.directives"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.3, ease: "easeOut" }}
                className="border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 rounded-[4px] shadow-sm"
              >
                <div className="border-b border-border px-5 pb-4 pt-5 sm:px-6 dark:border-zinc-800">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                        <BriefcaseBusiness size={14} />
                        Diretrizes do gestor
                      </div>
                      <h2 className="mt-2 font-mono text-2xl font-semibold tracking-[-.05em] text-foreground dark:text-zinc-50">
                        O que move o ponteiro hoje
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground dark:text-zinc-400">
                        Prioridades encaminhadas pela Gestão Comercial no Cronograma CRM.
                      </p>
                    </div>

                    <div data-tour="home.directive-filters" className="flex flex-wrap items-center gap-1.5">
                      <ListFilter size={15} className="text-muted-foreground dark:text-zinc-500 mr-1" />
                      {directiveTabs.map((item) => {
                        const isActive = filter === item;
                        const isAtrasadas = item === "Atrasadas";
                        const isConcluidas = item === "Concluídas";
                        return (
                          <motion.button
                            key={item}
                            whileHover={{ scale: 1.05, y: -1 }}
                            whileTap={{ scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            onClick={() => setFilter(item)}
                            className={`border px-3 py-1 text-[11px] font-bold cursor-pointer rounded-[4px] transition-all shadow-sm ${
                              isActive
                                ? isAtrasadas
                                  ? "border-red-600 bg-red-600 text-white shadow-red-600/30"
                                  : isConcluidas
                                    ? "border-emerald-600 bg-emerald-600 text-white shadow-emerald-600/30"
                                    : "border-primary bg-primary text-primary-foreground shadow-primary/30"
                                : isAtrasadas
                                  ? "border-red-300 bg-red-50 text-red-700 hover:border-red-500 dark:border-red-900/80 dark:bg-red-950/40 dark:text-red-300"
                                  : isConcluidas
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-500 dark:border-emerald-900/80 dark:bg-emerald-950/30 dark:text-emerald-300"
                                    : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-50"
                            }`}
                          >
                            {item}{" "}
                            {item === "Atrasadas"
                              ? `(${overdueActionsCount})`
                              : item === "Concluídas"
                                ? `(${completedDirectives.length})`
                                : ""}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-border/80 dark:divide-zinc-800">
                  {visibleDirectives.length ? (
                    visibleDirectives.map((item) => {
                      const isDone = item.status === "completed";
                      return (
                        <motion.article
                          key={item.id}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          whileHover={{ x: 4, transition: { duration: 0.15 } }}
                          className={`group px-5 py-4 transition-colors hover:bg-muted/40 sm:px-6 dark:hover:bg-zinc-900/70 ${
                            item.overdue && !isDone
                              ? "border-l-4 border-l-red-500 bg-red-50/30 dark:bg-red-950/15"
                              : ""
                          }`}
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              {/* Caixa de Iniciais */}
                              <motion.div
                                whileHover={{ scale: 1.08 }}
                                className={`flex h-10 w-10 shrink-0 items-center justify-center border font-mono text-xs font-bold rounded-[4px] transition-transform ${
                                  item.overdue && !isDone
                                    ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                                    : "border-primary/40 bg-primary/10 text-primary dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300"
                                }`}
                              >
                                {getInitials(item.dealTitle)}
                              </motion.div>

                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-semibold text-foreground dark:text-zinc-50 group-hover:text-primary transition-colors">
                                    {item.dealTitle}
                                  </h3>
                                  {item.overdue && !isDone && (
                                    <span className="inline-flex items-center gap-1 rounded-[2px] border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-bold font-mono uppercase tracking-[.12em] text-red-700 dark:border-red-700 dark:bg-red-950/80 dark:text-red-300 animate-pulse">
                                      <AlertTriangle size={10} className="stroke-[2.5]" />
                                      ATRASADA
                                    </span>
                                  )}
                                  <PriorityPill priority={item.priority} />
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground dark:text-zinc-300">
                                  <span>
                                    Executar diretriz -{" "}
                                    {item.stageName || "Leads Recebidos (Faltam 90d p/ maturar)"}
                                  </span>
                                  {item.accountName && (
                                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                      · <Building2 size={11} className="text-primary" />{" "}
                                      {item.accountName}
                                    </span>
                                  )}
                                  {item.contactName && (
                                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                      · <User size={11} /> {item.contactName}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1.5 max-w-2xl text-[11px] font-semibold uppercase tracking-wide text-zinc-400 bg-muted/30 dark:bg-zinc-900/40 p-2 border border-border/40 dark:border-zinc-800/60 rounded-[4px] group-hover:border-primary/30 transition-colors">
                                  {item.instruction || "GESTOR PONTUOU ATENÇÃO E EXECUÇÃO NESSA NEGOCIAÇÃO"}
                                </p>
                              </div>
                            </div>

                            {/* Informações da Direita & Ações */}
                            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-3 lg:min-w-[440px] lg:border-t-0 lg:pt-0 dark:border-zinc-800">
                              <div>
                                <div
                                  className={`text-[10px] font-bold uppercase tracking-[.15em] font-mono ${
                                    item.overdue && !isDone
                                      ? "text-[#ff4d6d] dark:text-[#ff4d6d]"
                                      : "text-muted-foreground dark:text-zinc-400"
                                  }`}
                                >
                                  {item.overdue && !isDone
                                    ? `ATRASADA · ${item.assignedDate ? `${item.assignedDate.slice(8, 10)}/${item.assignedDate.slice(5, 7)}` : "08/10"}`
                                    : `HOJE · ${item.assignedDate ? `${item.assignedDate.slice(8, 10)}/${item.assignedDate.slice(5, 7)}` : "08/10"}`}
                                </div>
                                <div className="mt-0.5 font-mono text-base font-bold text-foreground dark:text-white tracking-tight">
                                  {formatBRL(item.dealValue)}
                                </div>
                                <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-zinc-400 font-mono truncate max-w-[200px]">
                                  {item.stageName ? item.stageName.toUpperCase() : "LEADS RECEBIDOS"}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                {isDone ? (
                                  <>
                                    <span className="rounded-[4px] bg-muted dark:bg-zinc-800/80 border border-border dark:border-zinc-700 px-2.5 py-1 text-[11px] font-bold text-foreground dark:text-zinc-300 flex items-center gap-1.5 shadow-xs">
                                      {item.evidenceChannel === "whatsapp" ? (
                                        <>
                                          <MessageSquare size={13} className="text-emerald-400" />
                                          <span>WhatsApp</span>
                                        </>
                                      ) : item.evidenceChannel === "call" ? (
                                        <>
                                          <Phone size={13} className="text-emerald-400" />
                                          <span>Ligação</span>
                                        </>
                                      ) : item.evidenceChannel === "email" ? (
                                        <>
                                          <Mail size={13} className="text-emerald-400" />
                                          <span>E-mail</span>
                                        </>
                                      ) : (
                                        <>
                                          <Check size={13} className="text-emerald-400" strokeWidth={2.5} />
                                          <span>Concluído</span>
                                        </>
                                      )}
                                    </span>
                                    <motion.button
                                      whileHover={{ scale: 1.04, y: -1 }}
                                      whileTap={{ scale: 0.96 }}
                                      onClick={() => openDeal(item.dealId)}
                                      className="flex items-center gap-1.5 border border-border bg-card hover:border-primary/40 px-3 py-2 text-xs font-bold text-foreground cursor-pointer rounded-[4px] shadow-sm transition-all dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:text-zinc-200"
                                    >
                                      <ExternalLink size={13} strokeWidth={2} />
                                      Abrir CRM
                                    </motion.button>
                                  </>
                                ) : (
                                  <>
                                    <motion.button
                                      whileHover={{ scale: 1.04, y: -1 }}
                                      whileTap={{ scale: 0.96 }}
                                      transition={{ duration: 0.15 }}
                                      data-tour="home.directive-actions"
                                      onClick={() => setSelectedDirective(item)}
                                      className="flex items-center gap-1.5 bg-[#00a868] hover:bg-[#00965d] active:bg-[#008f57] px-3.5 py-2 text-xs font-bold text-white cursor-pointer rounded-[4px] shadow-sm transition-all"
                                    >
                                      <Check size={14} strokeWidth={2.8} />
                                      Concluir
                                    </motion.button>
                                    <motion.button
                                      whileHover={{ scale: 1.04, y: -1 }}
                                      whileTap={{ scale: 0.96 }}
                                      transition={{ duration: 0.15 }}
                                      onClick={() => openDeal(item.dealId)}
                                      className="flex items-center gap-1.5 border border-border bg-card hover:border-primary/40 px-3 py-2 text-xs font-bold text-foreground cursor-pointer rounded-[4px] transition-all shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:text-zinc-100"
                                    >
                                      <ExternalLink size={13} strokeWidth={2} />
                                      Abrir CRM
                                    </motion.button>
                                    <SystemTooltip content="Abrir Chat">
                                      <motion.button
                                        whileHover={{ scale: 1.04, y: -1 }}
                                        whileTap={{ scale: 0.96 }}
                                        transition={{ duration: 0.15 }}
                                        disabled={startingChatKey === item.id}
                                        onClick={() => void handleOpenChatForItem(item)}
                                        className="flex items-center gap-1.5 border border-border bg-card hover:border-primary/40 px-2.5 py-2 text-xs font-bold text-foreground cursor-pointer rounded-[4px] transition-all shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:text-zinc-100 disabled:opacity-50"
                                      >
                                        {startingChatKey === item.id ? (
                                          <Loader2 size={13} className="animate-spin" />
                                        ) : (
                                          <MessageSquare size={13} />
                                        )}
                                      </motion.button>
                                    </SystemTooltip>
                                    <SystemTooltip content="Abrir Empresa">
                                      <motion.button
                                        whileHover={{ scale: 1.04, y: -1 }}
                                        whileTap={{ scale: 0.96 }}
                                        transition={{ duration: 0.15 }}
                                        onClick={() => handleOpenCompany(item.accountId)}
                                        className="flex items-center gap-1.5 border border-border bg-card hover:border-primary/40 px-2.5 py-2 text-xs font-bold text-foreground cursor-pointer rounded-[4px] transition-all shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:text-zinc-100"
                                      >
                                        <Building2 size={13} />
                                      </motion.button>
                                    </SystemTooltip>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.article>
                      );
                    })
                  ) : (
                    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                      <div className="flex h-12 w-12 items-center justify-center border border-border bg-muted/60 text-muted-foreground rounded-[4px] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                        <CheckCircle2 size={24} />
                      </div>
                      <h3 className="mt-4 font-mono text-lg font-semibold text-foreground dark:text-zinc-100">
                        {filter === "Concluídas"
                          ? "Nenhuma diretriz concluída hoje"
                          : "Nenhuma diretriz pendente"}
                      </h3>
                      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground dark:text-zinc-400">
                        {filter === "Concluídas"
                          ? "Assim que você concluir responsabilidades comerciais com evidência, elas aparecerão aqui."
                          : "A Gestão Comercial ainda não encaminhou diretrizes táticas para sua carteira hoje. Suas oportunidades em andamento continuam sincronizadas no CRM."}
                      </p>
                      <motion.button
                        whileHover={{ scale: 1.04, y: -1 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={openCrm}
                        className="mt-4 flex items-center gap-2 bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer rounded-[4px] shadow-sm"
                      >
                        <ExternalLink size={13} />
                        Acessar Minhas Oportunidades no CRM
                      </motion.button>
                    </div>
                  )}
                </div>
              </motion.section>
            </div>

            {/* COLUNA DIREITA: CALENDÁRIO COMERCIAL DO VENDEDOR & DOSSIÊ DO DIA */}
            <div className="space-y-4">
              {/* CARD 1: CALENDÁRIO COMERCIAL INTERATIVO COM HOVER EM TODOS OS DIAS */}
              <motion.section
                data-tour="home.calendar"
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="group border border-border/80 bg-card p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-950/70 rounded-[4px] shadow-sm hover:shadow-lg hover:border-primary/40 transition-all duration-300"
              >
                <div className="flex items-center justify-between border-b border-border/80 pb-3 dark:border-zinc-800">
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                      <Calendar size={13} className="group-hover:scale-115 transition-transform" />
                      Calendário Comercial
                    </div>
                    <h3 className="mt-1 font-mono text-lg font-semibold text-foreground dark:text-zinc-100">
                      {monthNameFormatted}
                    </h3>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[.12em] text-muted-foreground dark:text-zinc-500">
                      Dias Úteis
                    </div>
                    <div className="font-mono text-xs font-semibold text-foreground dark:text-zinc-300">
                      {elapsedDays} / {businessDays} decorridos
                    </div>
                  </div>
                </div>

                {/* Dias da semana */}
                <div className="mt-3 grid grid-cols-7 gap-1 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground dark:text-zinc-500 pb-1">
                  <span>Dom</span>
                  <span>Seg</span>
                  <span>Ter</span>
                  <span>Qua</span>
                  <span>Qui</span>
                  <span>Sex</span>
                  <span>Sáb</span>
                </div>

                {/* Grade dos Dias do Mês */}
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: calendarData.firstDayWeekIndex }).map((_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="h-12 border border-border/30 bg-muted/20 dark:border-zinc-900/30 dark:bg-zinc-950/30 rounded-[2px]"
                    />
                  ))}
                  {calendarData.days.map((d) => {
                    const isSelected = d.dateStr === (selectedCalendarDate || data?.today);
                    const isHoliday = !!d.holiday;
                    return (
                      <motion.button
                        key={d.dateStr}
                        whileHover={{ scale: 1.14, zIndex: 30, y: -2 }}
                        whileTap={{ scale: 0.94 }}
                        transition={{ type: "spring", stiffness: 450, damping: 20 }}
                        onClick={() => setSelectedCalendarDate(d.dateStr)}
                        className={`group/day relative flex flex-col justify-between p-1.5 h-12 text-left border rounded-[2px] transition-colors cursor-pointer ${
                          isSelected
                            ? "border-primary bg-primary/10 ring-1 ring-primary dark:border-rose-500 dark:bg-rose-950/40 dark:ring-rose-500 shadow-sm"
                            : d.isToday
                              ? "border-foreground/40 bg-muted/80 dark:border-zinc-500 dark:bg-zinc-900/70"
                              : isHoliday
                                ? "border-amber-300 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-950/20"
                                : d.isWeekend
                                  ? "border-border/40 bg-muted/20 opacity-40 dark:border-zinc-900/60 dark:bg-zinc-950/40"
                                  : "border-border/70 bg-card hover:border-primary/60 hover:bg-muted/30 dark:border-zinc-800/80 dark:bg-zinc-950/80 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/40"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              isSelected
                                ? "text-primary font-bold dark:text-rose-400"
                                : isHoliday
                                  ? "text-amber-600 font-bold dark:text-amber-400"
                                  : d.isToday
                                    ? "text-foreground font-bold dark:text-zinc-100"
                                    : "text-muted-foreground dark:text-zinc-400"
                            }`}
                          >
                            {d.dayNumber}
                          </span>
                          {d.isToday ? (
                            <span className="size-1.5 rounded-full bg-primary" />
                          ) : isHoliday ? (
                            <span className="size-1.5 rounded-full bg-amber-500" />
                          ) : null}
                        </div>

                        <div className="mt-auto flex items-center justify-between w-full gap-1">
                          {d.deals.length > 0 ? (
                            <span className="inline-flex items-center px-1 rounded-[1px] text-[9px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/60 group-hover/day:scale-110 transition-transform">
                              +{d.deals.length}
                            </span>
                          ) : isHoliday ? (
                            <span className="truncate text-[8px] font-mono font-bold uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-300 px-0.5 rounded-[1px] dark:text-amber-300/90 dark:bg-amber-950/60 dark:border-amber-800/50">
                              Feriado
                            </span>
                          ) : null}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Legenda do Calendário */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/80 pt-2 text-[10px] text-muted-foreground dark:text-zinc-500 font-mono dark:border-zinc-800/80">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary inline-block" />
                    <span>Hoje</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-[1px] bg-emerald-500 inline-block" />
                    <span>Venda fechada</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-[1px] bg-amber-500 inline-block" />
                    <span>Feriado</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-[1px] border border-primary inline-block" />
                    <span>Selecionado</span>
                  </div>
                </div>
              </motion.section>

              {/* CARD 2: DOSSIÊ DO DIA SELECIONADO */}
              <motion.section
                data-tour="home.day-dossier"
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.25, ease: "easeOut" }}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="group border border-border/80 bg-card p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-950/70 rounded-[4px] shadow-sm hover:shadow-lg hover:border-primary/40 transition-all duration-300"
              >
                <div className="flex items-start justify-between border-b border-border/80 pb-3 dark:border-zinc-800">
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground dark:text-zinc-400">
                      <CalendarDays size={13} className="text-primary group-hover:scale-115 transition-transform" />
                      Dossiê do Dia
                      {selectedDayInfo?.holiday && (
                        <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.12em] bg-amber-100 text-amber-800 border border-amber-300 rounded-[2px] dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/70">
                          Feriado
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1 font-mono text-base font-semibold text-foreground dark:text-zinc-100 capitalize">
                      {selectedDayFormatted}
                    </h3>
                    {selectedDayInfo?.holiday && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300/90 font-medium">
                        {selectedDayInfo.holiday.description} — descontado do cálculo de metas e
                        dias úteis.
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[.12em] text-muted-foreground dark:text-zinc-500">
                      Vendido no Dia
                    </div>
                    <div className="font-mono text-sm font-bold text-emerald-500 dark:text-emerald-400">
                      {formatBRL(selectedDayInfo?.totalSold || 0)}
                    </div>
                  </div>
                </div>

                {/* Lista de Vendas do Dia Selecionado */}
                <div className="mt-4">
                  {selectedDayInfo && selectedDayInfo.deals.length > 0 ? (
                    <div className="space-y-2.5">
                      {selectedDayInfo.deals.map((deal) => (
                        <motion.div
                          key={deal.id}
                          whileHover={{ x: 4, scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          transition={{ duration: 0.15 }}
                          className="border border-border/80 bg-muted/30 p-3 hover:border-primary/50 transition-all rounded-[4px] dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold text-xs text-foreground dark:text-zinc-200">
                                {deal.title}
                              </div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground dark:text-zinc-400">
                                Venda Concluída
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono text-xs font-bold text-emerald-500 dark:text-emerald-400">
                                {formatBRL(deal.value)}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2.5 flex items-center justify-between border-t border-border/60 pt-2 dark:border-zinc-800/80">
                            <span className="text-[9px] font-mono text-muted-foreground dark:text-zinc-500">
                              {deal.closedAt
                                ? new Date(deal.closedAt).toLocaleTimeString("pt-BR", {
                                    timeZone: "America/Sao_Paulo",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : ""}
                            </span>
                            <motion.button
                              whileHover={{ x: 2 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => openDeal(deal.id)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-primary hover:underline cursor-pointer"
                            >
                              Abrir no CRM <ExternalLink size={10} />
                            </motion.button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  ) : selectedDayInfo?.holiday ? (
                    <div className="py-6 text-center">
                      <CalendarDays size={22} className="mx-auto text-amber-500 mb-2" />
                      <p className="text-xs text-amber-700 dark:text-amber-300 font-semibold">
                        Feriado: {selectedDayInfo.holiday.description}
                      </p>
                      <p className="text-[11px] text-muted-foreground dark:text-zinc-500 mt-1">
                        Dia sem expediente comercial obrigatório. Descontado do ritmo de metas.
                      </p>
                    </div>
                  ) : (
                    <div className="py-6 text-center">
                      <Clock3 size={22} className="mx-auto text-muted-foreground/60 dark:text-zinc-600 mb-2" />
                      <p className="text-xs text-muted-foreground dark:text-zinc-400 font-medium">
                        Nenhum fechamento registrado nesta data.
                      </p>
                      <p className="text-[11px] text-muted-foreground/80 dark:text-zinc-500 mt-1">
                        Clique nos dias marcados em verde no calendário para inspecionar as vendas
                        ganhas.
                      </p>
                    </div>
                  )}
                </div>

                {/* CARD 3: RESUMO CONSOLIDADO DO MÊS */}
                <div className="mt-5 border-t border-border/80 pt-4 dark:border-zinc-800">
                  <div className="text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground dark:text-zinc-400 mb-3">
                    Resumo do Mês
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <motion.div
                      whileHover={{ y: -2, scale: 1.02 }}
                      transition={{ duration: 0.15 }}
                      className="border border-border/80 bg-muted/30 p-2.5 rounded-[4px] dark:border-zinc-800/80 dark:bg-zinc-900/40 hover:border-primary/40 transition-colors shadow-sm cursor-default"
                    >
                      <div className="text-[9px] uppercase tracking-[.12em] text-muted-foreground dark:text-zinc-500">
                        Vendas no Mês
                      </div>
                      <div className="mt-1 font-mono text-base font-bold text-foreground dark:text-zinc-100">
                        {wonDealsCountFormatted}
                      </div>
                    </motion.div>
                    <motion.div
                      whileHover={{ y: -2, scale: 1.02 }}
                      transition={{ duration: 0.15 }}
                      className="border border-border/80 bg-muted/30 p-2.5 rounded-[4px] dark:border-zinc-800/80 dark:bg-zinc-900/40 hover:border-emerald-500/40 transition-colors shadow-sm cursor-default"
                    >
                      <div className="text-[9px] uppercase tracking-[.12em] text-muted-foreground dark:text-zinc-500">
                        Ticket Médio
                      </div>
                      <div className="mt-1 font-mono text-xs font-bold text-emerald-500 dark:text-emerald-400 truncate">
                        {formatBRL(ticketMedio)}
                      </div>
                    </motion.div>
                  </div>
                </div>
              </motion.section>
            </div>
          </div>
        ) : null}
      </div>

      {/* MODAL DE EVIDÊNCIA AO CONCLUIR DIRETRIZ */}
      {selectedDirective && (
        <CommercialEvidenceDialog
          directive={{
            id: selectedDirective.id,
            dealId: selectedDirective.dealId,
            dealTitle: selectedDirective.dealTitle,
            dealValue: selectedDirective.dealValue,
            stageName: selectedDirective.stageName,
            instruction: selectedDirective.instruction,
            priority: selectedDirective.priority,
          }}
          onClose={() => setSelectedDirective(null)}
          onOpenDeal={() => {
            const dealId = selectedDirective.dealId;
            setSelectedDirective(null);
            void openDeal(dealId);
          }}
          onCompleted={() => {
            setSelectedDirective(null);
            void load();
          }}
        />
      )}

      {/* MODAL DE AGENDA COMPLETA DO DIA (TAREFAS + RESPONSABILIDADES DETALHADAS) */}
      <AnimatePresence>
        {isAgendaModalOpen && (
          <div
            data-tour="home.agenda-dialog"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 sm:p-5"
            onClick={() => setIsAgendaModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-[6px] border border-border bg-card shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
            >
              {/* Cabeçalho do Modal */}
              <div className="flex items-start justify-between gap-4 border-b border-border bg-muted/20 px-5 py-4 sm:px-6 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                    <CalendarDays size={14} />
                    <span>{weekdayName}</span>
                    <span>·</span>
                    <span>{dateLongFormatted}</span>
                  </div>
                  <h3 className="mt-1 font-mono text-lg sm:text-xl font-bold text-foreground dark:text-zinc-50">
                    Agenda & Responsabilidades de Hoje
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Acompanhe seus compromissos agendados e as responsabilidades alocadas pelo
                    gestor com acesso rápido ao CRM, Chat e Empresa.
                  </p>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsAgendaModalOpen(false)}
                  aria-label="Fechar agenda"
                  className="rounded-[4px] border border-border bg-card p-1.5 text-muted-foreground hover:border-primary/40 hover:text-foreground dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 cursor-pointer"
                >
                  <X size={16} />
                </motion.button>
              </div>

              {/* Faixa de Indicadores Rápidos da Agenda */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 border-b border-border bg-card px-5 py-3.5 sm:px-6 dark:border-zinc-800">
                <div className="rounded-[4px] border border-border/80 bg-muted/30 px-3 py-2 dark:border-zinc-800/80 dark:bg-zinc-900/50">
                  <div className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                    Total na Agenda
                  </div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-foreground">
                    {String(unifiedAgendaItems.length).padStart(2, "0")}
                  </div>
                </div>
                <div className="rounded-[4px] border border-border/80 bg-muted/30 px-3 py-2 dark:border-zinc-800/80 dark:bg-zinc-900/50">
                  <div className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                    Tarefas do Dia
                  </div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-emerald-500">
                    {String(data?.activities.length || 0).padStart(2, "0")}
                  </div>
                </div>
                <div className="rounded-[4px] border border-border/80 bg-muted/30 px-3 py-2 dark:border-zinc-800/80 dark:bg-zinc-900/50">
                  <div className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                    Responsabilidades
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="font-mono text-lg font-bold text-primary">
                      {String(directives.length).padStart(2, "0")}
                    </span>
                    {overdueAgendaCount > 0 && (
                      <span className="font-mono text-[10px] font-bold text-red-500">
                        ({overdueAgendaCount} atrasada{overdueAgendaCount > 1 ? "s" : ""})
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-[4px] border border-border/80 bg-muted/30 px-3 py-2 dark:border-zinc-800/80 dark:bg-zinc-900/50">
                  <div className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                    Valor em Negociação
                  </div>
                  <div className="mt-0.5 font-mono text-sm sm:text-base font-bold text-foreground truncate">
                    {formatBRL(totalAgendaValue)}
                  </div>
                </div>
              </div>

              {/* Barra de Filtros e Pesquisa */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border bg-muted/15 px-5 py-3 sm:px-6 dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: "todos", label: `Todos (${unifiedAgendaItems.length})` },
                      { id: "tarefas", label: `Tarefas (${data?.activities.length || 0})` },
                      {
                        id: "responsabilidades",
                        label: `Responsabilidades (${directives.length})`,
                      },
                      ...(overdueAgendaCount > 0
                        ? [{ id: "atrasadas", label: `Atrasadas (${overdueAgendaCount})` }]
                        : []),
                    ] as Array<{ id: AgendaModalFilter; label: string }>
                  ).map((tab) => {
                    const active = agendaModalFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setAgendaModalFilter(tab.id)}
                        className={`rounded-[4px] border px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                          active
                            ? "border-primary bg-primary text-primary-foreground shadow-xs"
                            : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground dark:border-zinc-800 dark:bg-zinc-900"
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    value={agendaSearch}
                    onChange={(e) => setAgendaSearch(e.target.value)}
                    placeholder="Filtrar por negociação, empresa, contato..."
                    className="w-full rounded-[4px] border border-border bg-card py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none dark:border-zinc-800 dark:bg-zinc-900"
                  />
                </div>
              </div>

              {/* Lista Detalhada de Tarefas e Responsabilidades */}
              <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6">
                {filteredAgendaItems.length > 0 ? (
                  filteredAgendaItems.map((item) => {
                    const isDirective = item.kind === "directive";
                    const isCompleted = item.status === "completed";
                    const timeStr =
                      item.kind === "task" && item.dueDate
                        ? new Date(item.dueDate).toLocaleTimeString("pt-BR", {
                            timeZone: "America/Sao_Paulo",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : null;
                    const dateStr = item.assignedDate
                      ? `${item.assignedDate.slice(8, 10)}/${item.assignedDate.slice(5, 7)}/${item.assignedDate.slice(0, 4)}`
                      : "Hoje";

                    return (
                      <motion.div
                        key={item.uid}
                        whileHover={{ y: -1 }}
                        transition={{ duration: 0.15 }}
                        className={`rounded-[4px] border p-4 transition-colors shadow-sm ${
                          item.overdue && !isCompleted
                            ? "border-l-4 border-l-red-500 border-red-300/80 bg-red-50/20 dark:border-zinc-800 dark:border-l-red-500 dark:bg-red-950/15"
                            : "border-border/80 bg-muted/20 hover:border-primary/40 dark:border-zinc-800 dark:bg-zinc-900/50"
                        }`}
                      >
                        {/* Linha 1: Tipo (Negociação / Responsabilidade / Tarefa), Status e Valor */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 rounded-[2px] border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                                isDirective
                                  ? "border-primary/40 bg-primary/15 text-primary"
                                  : "border-emerald-500/40 bg-emerald-500/15 text-emerald-500"
                              }`}
                            >
                              {isDirective ? (
                                <>
                                  <BriefcaseBusiness size={11} />
                                  Responsabilidade do Gestor
                                </>
                              ) : (
                                <>
                                  <ClipboardList size={11} />
                                  {formatTaskTypeLabel(item.taskType)}
                                </>
                              )}
                            </span>

                            {timeStr && (
                              <span className="inline-flex items-center gap-1 rounded-[2px] border border-border bg-card px-2 py-0.5 font-mono text-[10px] font-bold text-foreground dark:border-zinc-700 dark:bg-zinc-900">
                                <Clock3 size={10} className="text-emerald-500" />
                                {timeStr}
                              </span>
                            )}

                            <span className="inline-flex items-center gap-1 rounded-[2px] border border-border bg-card px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground dark:border-zinc-800 dark:bg-zinc-900">
                              {dateStr}
                            </span>

                            {item.overdue && !isCompleted && (
                              <span className="inline-flex items-center gap-1 rounded-[2px] border border-red-400/60 bg-red-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-red-500">
                                <AlertTriangle size={10} />
                                Atrasada
                              </span>
                            )}

                            {isCompleted && (
                              <span className="inline-flex items-center gap-1 rounded-[2px] border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-emerald-500">
                                <Check size={10} />
                                Concluída
                              </span>
                            )}

                            {isDirective && <PriorityPill priority={item.priority} />}
                          </div>

                          <div className="font-mono text-sm sm:text-base font-bold text-foreground">
                            {formatBRL(item.dealValue)}
                          </div>
                        </div>

                        {/* Linha 2: Negociação & Título da Tarefa/Instrução */}
                        <div className="mt-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                              Negociação:
                            </span>
                            <h4 className="text-sm font-bold text-foreground dark:text-zinc-100">
                              {item.dealTitle}
                            </h4>
                          </div>

                          <div className="mt-1.5 rounded-[4px] border border-border/60 bg-card/80 p-2.5 text-xs font-medium text-foreground/90 dark:border-zinc-800 dark:bg-zinc-950/60">
                            <span className="mr-1.5 font-mono text-[10px] font-bold uppercase text-primary">
                              {isDirective ? "Diretriz:" : "Compromisso:"}
                            </span>
                            {item.title}
                            {item.subtitle && (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {item.subtitle}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Linha 3: Metadados Detalhados (Etapa/Funil, Empresa, Contato, Alocado por) */}
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-[4px] border border-border/50 bg-card/50 p-2.5 text-[11px] dark:border-zinc-800/70 dark:bg-zinc-950/40">
                          <div className="min-w-0">
                            <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                              Funil / Etapa
                            </span>
                            <span className="mt-0.5 block truncate font-semibold text-foreground">
                              {item.pipelineName ? `${item.pipelineName} › ` : ""}
                              {item.stageName || "Em andamento"}
                            </span>
                          </div>

                          <div className="min-w-0">
                            <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                              Empresa Vinculada
                            </span>
                            <span className="mt-0.5 block truncate font-semibold text-foreground">
                              {item.accountName || "Não vinculada"}
                              {item.accountDocument ? ` (${item.accountDocument})` : ""}
                            </span>
                          </div>

                          <div className="min-w-0">
                            <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                              Contato / Cliente
                            </span>
                            <span className="mt-0.5 block truncate font-semibold text-foreground">
                              {item.contactName || "Não informado"}
                              {item.contactPhone ? ` · ${item.contactPhone}` : ""}
                            </span>
                          </div>
                        </div>

                        {/* Linha 4: Ações Diretas (Abrir CRM, Abrir Chat, Abrir Empresa + Concluir) */}
                        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 dark:border-zinc-800/80">
                          <div className="text-[10px] font-mono text-muted-foreground">
                            {isDirective
                              ? `Alocada por: ${item.assignedByOperatorName || "Gestão Comercial"}`
                              : item.assignedByOperatorName
                                ? `Criada por: ${item.assignedByOperatorName}`
                                : "Agenda Comercial"}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {isDirective && !isCompleted && item.rawDirective && (
                              <motion.button
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.96 }}
                                onClick={() => {
                                  setIsAgendaModalOpen(false);
                                  setSelectedDirective(item.rawDirective);
                                }}
                                className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#00a868] hover:bg-[#00965d] px-3 py-1.5 text-xs font-bold text-white shadow-xs transition-all cursor-pointer"
                              >
                                <Check size={13} strokeWidth={2.5} />
                                Concluir
                              </motion.button>
                            )}

                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.96 }}
                              onClick={() => {
                                setIsAgendaModalOpen(false);
                                openDeal(item.dealId);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-[4px] bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-95 shadow-xs transition-all cursor-pointer"
                            >
                              <ExternalLink size={13} />
                              Abrir CRM
                            </motion.button>

                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.96 }}
                              disabled={startingChatKey === item.id}
                              onClick={() => void handleOpenChatForItem(item)}
                              className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:border-primary/50 hover:text-primary transition-all cursor-pointer dark:border-zinc-700 dark:bg-zinc-900 disabled:opacity-50"
                            >
                              {startingChatKey === item.id ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <MessageSquare size={13} />
                              )}
                              Abrir Chat
                            </motion.button>

                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.96 }}
                              onClick={() => {
                                setIsAgendaModalOpen(false);
                                handleOpenCompany(item.accountId);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:border-primary/50 hover:text-primary transition-all cursor-pointer dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              <Building2 size={13} />
                              Abrir Empresa
                            </motion.button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground">
                      <CalendarDays size={22} />
                    </div>
                    <p className="mt-3 font-mono text-sm font-bold text-foreground">
                      Nenhum compromisso ou responsabilidade encontrado
                    </p>
                    <p className="mt-1 max-w-md text-xs text-muted-foreground">
                      Não há tarefas agendadas nem responsabilidades para o filtro selecionado hoje.
                    </p>
                  </div>
                )}
              </div>

              {/* Rodapé do Modal */}
              <div className="flex items-center justify-between border-t border-border bg-muted/20 px-5 py-3.5 sm:px-6 dark:border-zinc-800 dark:bg-zinc-900/40">
                <span className="text-[11px] text-muted-foreground">
                  Exibindo {filteredAgendaItems.length} de {unifiedAgendaItems.length} item(ns) do
                  dia
                </span>
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setIsAgendaModalOpen(false)}
                  className="border border-border bg-card px-4 py-2 text-xs font-bold text-foreground hover:bg-muted dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 rounded-[4px] cursor-pointer"
                >
                  Fechar
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL DETALHADO DA EMPRESA (ACIONADO POR "ABRIR EMPRESA") */}
      <AccountDetailModal
        accountId={selectedAccountId}
        isOpen={selectedAccountId !== null}
        onClose={() => setSelectedAccountId(null)}
        onAccountUpdated={() => {
          void load();
        }}
        onOpenDeal={(dealId) => {
          setSelectedAccountId(null);
          openDeal(dealId);
        }}
        onOpenChat={(conversationId) => {
          setSelectedAccountId(null);
          setActiveQueue("todos");
          setSelectedChatId(conversationId);
          setActiveView("chat");
          navigate({ to: "/conversas" as any });
        }}
      />
    </section>
  );
}
