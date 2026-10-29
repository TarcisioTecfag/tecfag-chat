import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Check,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  LayoutGrid,
  LayoutList,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";
import { CrmDatePicker } from "./CrmDatePicker";
import {
  ACTION_HISTORY_LABELS,
  type ActionEntityGroup,
  type ActionHistoryEntry,
  type ActionHistoryKind,
  type ActionPeriodPreset,
  type ActionSortOption,
  ENTITY_GROUP_META,
  extractAffectedItems,
  formatActionSummary,
  getActionCategory,
  getActionLabel,
  getEntityTypeLabel,
  matchesActionHistoryFilters,
  normalizeSearchText,
  resolvePeriodBounds,
  sortActionHistoryEntries,
} from "@/lib/crm/action-history-meta";

type ViewMode = "table" | "cards";

const KIND_TABS: Array<{
  id: ActionHistoryKind;
  label: string;
  description: string;
}> = [
  {
    id: "all",
    label: "Todas as ações",
    description: "Visão consolidada de exclusões, ações em massa e exportações realizadas nesta empresa.",
  },
  {
    id: "deletion",
    label: "Exclusões e arquivamentos",
    description: "Registros excluídos permanentemente, enviados à lixeira ou arquivados.",
  },
  {
    id: "bulk",
    label: "Ações em massa",
    description: "Atualizações em lote, criação em massa de negociações/tarefas e importações.",
  },
  {
    id: "export",
    label: "Exportações",
    description: "Relatórios e bases de dados exportados pelos operadores e administradores.",
  },
];

function getCategoryBadgeMeta(action: string) {
  const category = getActionCategory(action);
  if (category === "deletion") {
    return {
      label: "Exclusão",
      Icon: Trash2,
      className:
        "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      iconBoxClassName:
        "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
    };
  }
  if (category === "export") {
    return {
      label: "Exportação",
      Icon: Download,
      className:
        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      iconBoxClassName:
        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
    };
  }
  return {
    label: "Ação em massa",
    Icon: Layers,
    className:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    iconBoxClassName:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  };
}

function getInitials(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "OP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function CrmActionHistoryModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ActionHistoryKind>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityGroup, setEntityGroup] = useState<ActionEntityGroup>("all");
  const [operatorFilter, setOperatorFilter] = useState<string>("all");
  const [period, setPeriod] = useState<ActionPeriodPreset>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortBy, setSortBy] = useState<ActionSortOption>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  const [entries, setEntries] = useState<ActionHistoryEntry[]>([]);
  const [knownOperators, setKnownOperators] = useState<string[]>([]);
  const [knownActions, setKnownActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  const [selectedEntry, setSelectedEntry] = useState<ActionHistoryEntry | null>(null);
  const [detailItemSearch, setDetailItemSearch] = useState("");
  const [copiedJson, setCopiedJson] = useState(false);

  // Debounce para consulta no servidor
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Reset de detalhes internos ao trocar registro selecionado
  useEffect(() => {
    setDetailItemSearch("");
    setCopiedJson(false);
  }, [selectedEntry?.id]);

  const load = useCallback(
    async (offset: number, append: boolean) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          offset: String(offset),
          limit: "100",
        });
        if (kind !== "all") params.set("kind", kind);
        if (actionFilter !== "all") params.set("action", actionFilter);
        if (entityGroup !== "all") params.set("entityGroup", entityGroup);
        if (operatorFilter !== "all") params.set("operator", operatorFilter);
        if (debouncedSearch) params.set("q", debouncedSearch);

        if (period !== "all") {
          const bounds = resolvePeriodBounds(period, dateFrom, dateTo);
          if (bounds.from) params.set("dateFrom", bounds.from.toISOString());
          if (bounds.to) params.set("dateTo", bounds.to.toISOString());
        }

        const response = await fetch(`/api/crm/action-history?${params}`, {
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error("Não foi possível carregar o histórico.");
        }
        const data = await response.json();
        const incoming: ActionHistoryEntry[] = Array.isArray(data.entries)
          ? data.entries
          : [];

        setEntries((current) => (append ? [...current, ...incoming] : incoming));
        setHasMore(Boolean(data.hasMore));

        if (Array.isArray(data.operators) && data.operators.length > 0) {
          setKnownOperators(data.operators);
        }
        if (Array.isArray(data.actions) && data.actions.length > 0) {
          setKnownActions(data.actions);
        }
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Erro ao carregar o histórico.",
        );
      } finally {
        setLoading(false);
      }
    },
    [
      kind,
      actionFilter,
      entityGroup,
      operatorFilter,
      debouncedSearch,
      period,
      dateFrom,
      dateTo,
    ],
  );

  useEffect(() => {
    if (isOpen) {
      void load(0, false);
    }
  }, [isOpen, load]);

  // Se a aba principal mudar e o actionFilter atual não pertencer à categoria, reseta actionFilter
  useEffect(() => {
    if (actionFilter !== "all" && kind !== "all") {
      if (getActionCategory(actionFilter) !== kind) {
        setActionFilter("all");
      }
    }
  }, [kind, actionFilter]);

  const operatorOptions = useMemo(() => {
    const set = new Set<string>(knownOperators);
    for (const entry of entries) {
      if (entry.operatorName) set.add(entry.operatorName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [knownOperators, entries]);

  const actionOptions = useMemo(() => {
    const codes = new Set<string>([
      ...knownActions,
      ...entries.map((e) => e.action),
      ...Object.keys(ACTION_HISTORY_LABELS),
    ]);
    return Array.from(codes)
      .filter((code) => (kind === "all" ? true : getActionCategory(code) === kind))
      .map((code) => ({
        code,
        label: getActionLabel(code),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [knownActions, entries, kind]);

  const visibleEntries = useMemo(() => {
    const filtered = entries.filter((entry) =>
      matchesActionHistoryFilters(entry, {
        kind,
        search,
        action: actionFilter,
        entityGroup,
        operator: operatorFilter,
        period,
        dateFrom,
        dateTo,
      }),
    );
    return sortActionHistoryEntries(filtered, sortBy);
  }, [
    entries,
    kind,
    search,
    actionFilter,
    entityGroup,
    operatorFilter,
    period,
    dateFrom,
    dateTo,
    sortBy,
  ]);

  const stats = useMemo(() => {
    let totalItems = 0;
    let deletions = 0;
    let bulkOps = 0;
    let exportsCount = 0;
    const operators = new Set<string>();

    for (const entry of visibleEntries) {
      totalItems += Number(entry.itemCount) || 0;
      if (entry.operatorName) operators.add(entry.operatorName);
      const cat = getActionCategory(entry.action);
      if (cat === "deletion") deletions += 1;
      else if (cat === "bulk") bulkOps += 1;
      else if (cat === "export") exportsCount += 1;
    }

    return {
      totalEvents: visibleEntries.length,
      totalItems,
      deletions,
      bulkOps,
      exportsCount,
      uniqueOperators: operators.size,
    };
  }, [visibleEntries]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count += 1;
    if (actionFilter !== "all") count += 1;
    if (entityGroup !== "all") count += 1;
    if (operatorFilter !== "all") count += 1;
    if (period !== "all") count += 1;
    return count;
  }, [search, actionFilter, entityGroup, operatorFilter, period]);

  const clearAllFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setActionFilter("all");
    setEntityGroup("all");
    setOperatorFilter("all");
    setPeriod("all");
    setDateFrom("");
    setDateTo("");
    setSortBy("newest");
  };

  const handleExportCsv = () => {
    if (visibleEntries.length === 0 || typeof window === "undefined") return;
    const header = [
      "Data/Hora",
      "Ação",
      "Código da Ação",
      "Módulo/Entidade",
      "Operador",
      "Quantidade de Itens",
      "Resumo",
    ];
    const escapeCsv = (val: unknown) => {
      const str = String(val ?? "").replace(/"/g, '""');
      return `"${str}"`;
    };
    const rows = visibleEntries.map((entry) => [
      new Date(entry.createdAt).toLocaleString("pt-BR"),
      getActionLabel(entry.action),
      entry.action,
      getEntityTypeLabel(entry.entityType),
      entry.operatorName,
      entry.itemCount,
      formatActionSummary(entry) || "",
    ]);
    const csvContent =
      "\uFEFF" +
      [header.map(escapeCsv).join(";"), ...rows.map((r) => r.map(escapeCsv).join(";"))].join(
        "\r\n",
      );
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `historico-acoes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const selectedEntryAffectedItems = useMemo(() => {
    if (!selectedEntry) return [];
    const allItems = extractAffectedItems(selectedEntry);
    const q = normalizeSearchText(detailItemSearch);
    if (!q) return allItems;
    return allItems.filter(
      (item) =>
        normalizeSearchText(item.label).includes(q) ||
        normalizeSearchText(item.id).includes(q) ||
        normalizeSearchText(item.kind).includes(q),
    );
  }, [selectedEntry, detailItemSearch]);

  if (!isOpen) return null;

  const currentTabMeta = KIND_TABS.find((t) => t.id === kind) || KIND_TABS[0];

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label="Histórico de ações"
    >
      {/* HEADER NO PADRÃO DAS DEMAIS TELAS DE CONFIGURAÇÕES DO CRM */}
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Voltar ao CRM"
            className="rounded-lg p-2 text-primary hover:bg-primary/10 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium">
              Configurações do CRM
            </p>
            <h2 className="text-lg font-bold text-foreground">
              Histórico de ações
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={visibleEntries.length === 0}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition disabled:opacity-50 cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
            Exportar CSV
          </button>
          <button
            type="button"
            onClick={() => void load(0, false)}
            aria-label="Atualizar histórico"
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ÁREA PRINCIPAL */}
      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* ABAS NO MESMO PADRÃO DE CATÁLOGOS E CAMPOS PERSONALIZADOS */}
          <nav
            className="flex gap-6 border-b border-border overflow-x-auto scrollbar-none"
            aria-label="Categorias do histórico de ações"
          >
            {KIND_TABS.map((tab) => {
              const active = kind === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setKind(tab.id)}
                  className={`relative pb-3 text-xs font-semibold whitespace-nowrap transition-colors duration-200 cursor-pointer ${
                    active
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                  {active && (
                    <motion.div
                      layoutId="action-history-active-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                      transition={{ type: "spring", stiffness: 450, damping: 32 }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* CABEÇALHO DA SEÇÃO + INDICADORES RÁPIDOS */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">
                {currentTabMeta.label}{" "}
                <span className="text-muted-foreground">
                  ({stats.totalEvents.toLocaleString("pt-BR")})
                </span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {currentTabMeta.description}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-xl border border-border bg-card px-3.5 py-2 shadow-2xs">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Ações listadas
                </span>
                <strong className="text-sm font-extrabold text-foreground">
                  {stats.totalEvents.toLocaleString("pt-BR")}
                </strong>
              </div>
              <div className="rounded-xl border border-border bg-card px-3.5 py-2 shadow-2xs">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Itens afetados
                </span>
                <strong className="text-sm font-extrabold text-primary">
                  {stats.totalItems.toLocaleString("pt-BR")}
                </strong>
              </div>
              <div className="rounded-xl border border-border bg-card px-3.5 py-2 shadow-2xs">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Exclusões
                </span>
                <strong className="text-sm font-extrabold text-rose-600 dark:text-rose-400">
                  {stats.deletions.toLocaleString("pt-BR")}
                </strong>
              </div>
              <div className="rounded-xl border border-border bg-card px-3.5 py-2 shadow-2xs">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Operadores
                </span>
                <strong className="text-sm font-extrabold text-foreground">
                  {stats.uniqueOperators.toLocaleString("pt-BR")}
                </strong>
              </div>
            </div>
          </div>

          {/* PAINEL DE BUSCA E FILTROS AVANÇADOS */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-soft space-y-3">
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
              {/* Barra de Pesquisa Principal */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por negociação, empresa, funil, operador, arquivo, ID ou tipo de ação..."
                  aria-label="Buscar no histórico de ações"
                  className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-9 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Limpar busca"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Alternador de modo de visualização (Tabela vs Cards) */}
              <div className="flex items-center justify-between md:justify-end gap-2">
                <div className="inline-flex items-center rounded-lg border border-border bg-background p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode("table")}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      viewMode === "table"
                        ? "bg-primary text-primary-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <LayoutList className="h-3.5 w-3.5" />
                    Tabela
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("cards")}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      viewMode === "cards"
                        ? "bg-primary text-primary-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Cards
                  </button>
                </div>

                {activeFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15 transition cursor-pointer whitespace-nowrap"
                  >
                    <X className="h-3.5 w-3.5" />
                    Limpar filtros ({activeFiltersCount})
                  </button>
                )}
              </div>
            </div>

            {/* Linha de Filtros */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-1">
              {/* Filtro 1: Categoria */}
              <div className="space-y-1">
                <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Filter className="h-3 w-3" /> Categoria
                </label>
                <Select
                  value={kind}
                  onValueChange={(val) => setKind(val as ActionHistoryKind)}
                >
                  <SystemTooltip content="Filtrar histórico por categoria de ação">
                    <SelectTrigger
                      aria-label="Filtrar histórico"
                      className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:border-primary"
                    >
                      <SelectValue />
                    </SelectTrigger>
                  </SystemTooltip>
                  <SelectContent className="z-[150]">
                    <SelectItem value="all" className="text-xs">Todas as categorias</SelectItem>
                    <SelectItem value="deletion" className="text-xs">Exclusões e arquivamentos</SelectItem>
                    <SelectItem value="bulk" className="text-xs">Ações em massa</SelectItem>
                    <SelectItem value="export" className="text-xs">Exportações</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro 2: Tipo de Ação Específico */}
              <div className="space-y-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Ação específica
                </label>
                <Select
                  value={actionFilter}
                  onValueChange={(val) => setActionFilter(val)}
                >
                  <SystemTooltip content="Filtrar por tipo específico de ação">
                    <SelectTrigger
                      aria-label="Filtrar por ação específica"
                      className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:border-primary"
                    >
                      <SelectValue />
                    </SelectTrigger>
                  </SystemTooltip>
                  <SelectContent className="z-[150]">
                    <SelectItem value="all" className="text-xs">Todas as ações</SelectItem>
                    {actionOptions.map((opt) => (
                      <SelectItem key={opt.code} value={opt.code} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro 3: Módulo / Entidade */}
              <div className="space-y-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Módulo do sistema
                </label>
                <Select
                  value={entityGroup}
                  onValueChange={(val) => setEntityGroup(val as ActionEntityGroup)}
                >
                  <SystemTooltip content="Filtrar por módulo/entidade do CRM">
                    <SelectTrigger
                      aria-label="Filtrar por módulo"
                      className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:border-primary"
                    >
                      <SelectValue />
                    </SelectTrigger>
                  </SystemTooltip>
                  <SelectContent className="z-[150]">
                    {ENTITY_GROUP_META.map((group) => (
                      <SelectItem key={group.id} value={group.id} className="text-xs">
                        {group.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro 4: Operador */}
              <div className="space-y-1">
                <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <User className="h-3 w-3" /> Operador
                </label>
                <Select
                  value={operatorFilter}
                  onValueChange={(val) => setOperatorFilter(val)}
                >
                  <SystemTooltip content="Filtrar por operador responsável pela ação">
                    <SelectTrigger
                      aria-label="Filtrar por operador"
                      className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:border-primary"
                    >
                      <SelectValue />
                    </SelectTrigger>
                  </SystemTooltip>
                  <SelectContent className="z-[150]">
                    <SelectItem value="all" className="text-xs">Todos os operadores</SelectItem>
                    {operatorOptions.map((op) => (
                      <SelectItem key={op} value={op} className="text-xs">
                        {op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro 5: Período e Ordenação */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Calendar className="h-3 w-3" /> Período
                  </label>
                  <Select
                    value={period}
                    onValueChange={(val) => setPeriod(val as ActionPeriodPreset)}
                  >
                    <SystemTooltip content="Filtrar por período de realização da ação">
                      <SelectTrigger
                        aria-label="Filtrar por período"
                        className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:border-primary"
                      >
                        <SelectValue />
                      </SelectTrigger>
                    </SystemTooltip>
                    <SelectContent className="z-[150]">
                      <SelectItem value="all" className="text-xs">Qualquer data</SelectItem>
                      <SelectItem value="today" className="text-xs">Hoje</SelectItem>
                      <SelectItem value="7d" className="text-xs">Últimos 7 dias</SelectItem>
                      <SelectItem value="30d" className="text-xs">Últimos 30 dias</SelectItem>
                      <SelectItem value="month" className="text-xs">Este mês</SelectItem>
                      <SelectItem value="custom" className="text-xs">Personalizado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Ordenar por
                  </label>
                  <Select
                    value={sortBy}
                    onValueChange={(val) => setSortBy(val as ActionSortOption)}
                  >
                    <SystemTooltip content="Ordenar registros do histórico">
                      <SelectTrigger
                        aria-label="Ordenar histórico"
                        className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:border-primary"
                      >
                        <SelectValue />
                      </SelectTrigger>
                    </SystemTooltip>
                    <SelectContent className="z-[150]">
                      <SelectItem value="newest" className="text-xs">Mais recentes</SelectItem>
                      <SelectItem value="oldest" className="text-xs">Mais antigos</SelectItem>
                      <SelectItem value="most_items" className="text-xs">Maior volume</SelectItem>
                      <SelectItem value="least_items" className="text-xs">Menor volume</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Datas personalizadas quando period === "custom" */}
            {period === "custom" && (
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span>De:</span>
                  <div className="w-44">
                    <CrmDatePicker
                      value={dateFrom || null}
                      onChange={(val) => setDateFrom(val || "")}
                      placeholder="Data inicial..."
                      tooltipText="Selecionar data inicial do histórico"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span>Até:</span>
                  <div className="w-44">
                    <CrmDatePicker
                      value={dateTo || null}
                      onChange={(val) => setDateTo(val || "")}
                      placeholder="Data final..."
                      tooltipText="Selecionar data final do histórico"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* MENSAGEM DE ERRO */}
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs font-semibold text-destructive"
            >
              {error}
            </div>
          )}

          {/* LISTAGEM PRINCIPAL (TABELA OU CARDS) */}
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-xs text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Carregando histórico de ações...
            </div>
          ) : !loading && !error && visibleEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center space-y-2">
              <p className="text-sm font-semibold text-foreground">
                Nenhuma ação registrada.
              </p>
              <p className="text-xs text-muted-foreground">
                {activeFiltersCount > 0
                  ? "Nenhum registro corresponde aos filtros e termos de pesquisa selecionados."
                  : "Exclusões, ações em massa e exportações aparecerão aqui automaticamente."}
              </p>
              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          ) : viewMode === "table" ? (
            /* VISÃO EM TABELA (PADRÃO VISUAL DAS OUTRAS TELAS DE CONFIGURAÇÕES DO CRM) */
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="border-b border-border bg-muted/30 text-[10px] uppercase text-muted-foreground font-semibold">
                  <tr>
                    <th className="p-3.5">Ação realizada</th>
                    <th className="p-3.5">Módulo</th>
                    <th className="p-3.5">Registros / Resumo</th>
                    <th className="p-3.5">Operador</th>
                    <th className="p-3.5">Itens</th>
                    <th className="p-3.5">Data e hora</th>
                    <th className="p-3.5 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((entry) => {
                    const badge = getCategoryBadgeMeta(entry.action);
                    const BadgeIcon = badge.Icon;
                    const itemSummary = formatActionSummary(entry);

                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-border/60 last:border-0 hover:bg-muted/15 transition-colors"
                      >
                        <td className="p-3.5">
                          <div className="flex items-start gap-2.5">
                            <div
                              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${badge.iconBoxClassName}`}
                            >
                              <BadgeIcon className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <strong className="block font-bold text-foreground">
                                {getActionLabel(entry.action)}
                              </strong>
                              <span
                                className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="p-3.5">
                          <span className="inline-flex items-center rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-foreground">
                            {getEntityTypeLabel(entry.entityType)}
                          </span>
                        </td>

                        <td className="p-3.5 max-w-xs">
                          {itemSummary ? (
                            <SystemTooltip content={itemSummary}>
                              <p className="line-clamp-2 break-words text-xs text-foreground cursor-default">
                                {itemSummary}
                              </p>
                            </SystemTooltip>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                              {getInitials(entry.operatorName)}
                            </span>
                            <span className="font-medium text-foreground">
                              {entry.operatorName}
                            </span>
                          </div>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-foreground border border-border">
                            {entry.itemCount.toLocaleString("pt-BR")}{" "}
                            {entry.itemCount === 1 ? "item" : "itens"}
                          </span>
                        </td>

                        <td className="p-3.5 whitespace-nowrap text-muted-foreground">
                          <time dateTime={entry.createdAt} className="block text-foreground font-medium">
                            {new Date(entry.createdAt).toLocaleDateString("pt-BR")}
                          </time>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleTimeString("pt-BR")}
                          </span>
                        </td>

                        <td className="p-3.5 whitespace-nowrap text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedEntry(entry)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 hover:border-primary/30 transition cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Ver detalhes
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* VISÃO EM CARDS DETALHADOS */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {visibleEntries.map((entry) => {
                const badge = getCategoryBadgeMeta(entry.action);
                const BadgeIcon = badge.Icon;
                const itemSummary = formatActionSummary(entry);

                return (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-border bg-card p-4 text-sm shadow-soft flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${badge.iconBoxClassName}`}
                          >
                            <BadgeIcon className="h-4 w-4" />
                          </div>
                          <div>
                            <strong className="block text-xs font-bold text-foreground">
                              {getActionLabel(entry.action)}
                            </strong>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {getEntityTypeLabel(entry.entityType)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <time className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleString("pt-BR")}
                        </time>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {entry.operatorName}
                        </span>{" "}
                        · {entry.itemCount.toLocaleString("pt-BR")}{" "}
                        {entry.itemCount === 1 ? "item" : "itens"}
                      </p>

                      {itemSummary && (
                        <p className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2 break-words text-xs text-foreground">
                          {itemSummary}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
                      <details className="text-xs w-full">
                        <summary className="cursor-pointer font-semibold text-primary flex items-center justify-between">
                          <span>Ver detalhes rápidos</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setSelectedEntry(entry);
                            }}
                            className="text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                          >
                            Abrir painel lateral
                          </button>
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2.5 text-[11px] font-mono">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* PAGINAÇÃO / CARREGAR MAIS */}
          {loading && entries.length > 0 && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}

          {hasMore && !loading && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => void load(entries.length, true)}
                className="rounded-xl border border-border bg-card px-6 py-2.5 text-xs font-bold text-foreground shadow-soft hover:bg-muted transition cursor-pointer"
              >
                Carregar mais registros
              </button>
            </div>
          )}
        </div>
      </main>

      {/* GAVETA LATERAL DE AUDITORIA E DETALHES (PADRÃO CRMCATALOGSETTINGSMODAL) */}
      <AnimatePresence>
        {selectedEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[110] flex justify-end bg-black/50 backdrop-blur-xs"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedEntry(null);
            }}
          >
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="flex h-full w-full max-w-[540px] flex-col bg-card shadow-2xl border-l border-border"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                    Detalhes da Auditoria
                  </p>
                  <h3 className="text-sm font-bold text-foreground mt-0.5">
                    {getActionLabel(selectedEntry.action)}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEntry(null)}
                  aria-label="Fechar detalhes"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
                {/* Metadados Principais */}
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/20 p-3.5">
                  <div>
                    <span className="block text-[10px] uppercase text-muted-foreground font-semibold">
                      Operador responsável
                    </span>
                    <strong className="mt-0.5 block text-foreground">
                      {selectedEntry.operatorName}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-muted-foreground font-semibold">
                      Data e horário
                    </span>
                    <strong className="mt-0.5 block text-foreground">
                      {new Date(selectedEntry.createdAt).toLocaleString("pt-BR")}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-muted-foreground font-semibold">
                      Módulo / Entidade
                    </span>
                    <strong className="mt-0.5 block text-foreground">
                      {getEntityTypeLabel(selectedEntry.entityType)}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-muted-foreground font-semibold">
                      Volume impactado
                    </span>
                    <strong className="mt-0.5 block text-primary">
                      {selectedEntry.itemCount.toLocaleString("pt-BR")}{" "}
                      {selectedEntry.itemCount === 1 ? "item" : "itens"}
                    </strong>
                  </div>
                </div>

                {/* Lista Estruturada de Itens Afetados (com busca interna!) */}
                {extractAffectedItems(selectedEntry).length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-bold text-foreground">
                        Itens registrados na amostra (
                        {selectedEntryAffectedItems.length.toLocaleString("pt-BR")})
                      </h4>
                      {selectedEntry.itemCount >
                        extractAffectedItems(selectedEntry).length && (
                        <span className="text-[10px] text-muted-foreground">
                          Exibindo amostra de{" "}
                          {extractAffectedItems(selectedEntry).length} de{" "}
                          {selectedEntry.itemCount.toLocaleString("pt-BR")}
                        </span>
                      )}
                    </div>

                    {extractAffectedItems(selectedEntry).length > 5 && (
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          value={detailItemSearch}
                          onChange={(e) => setDetailItemSearch(e.target.value)}
                          placeholder="Filtrar item dentro desta ação..."
                          className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                        />
                      </div>
                    )}

                    <div className="max-h-64 overflow-y-auto rounded-xl border border-border bg-background divide-y divide-border/60">
                      {selectedEntryAffectedItems.map((item, idx) => (
                        <div
                          key={`${item.id || idx}-${idx}`}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-muted/20"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground truncate">
                              {item.label}
                            </p>
                            {item.id && (
                              <p className="text-[10px] font-mono text-muted-foreground truncate">
                                ID: {item.id}
                              </p>
                            )}
                          </div>
                          <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {item.kind}
                          </span>
                        </div>
                      ))}
                      {selectedEntryAffectedItems.length === 0 && (
                        <p className="p-4 text-center text-xs text-muted-foreground">
                          Nenhum item correspondente a &quot;{detailItemSearch}&quot;.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Payload Técnico JSON */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-foreground">
                      Registro técnico completo (JSON)
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.clipboard) {
                          void navigator.clipboard.writeText(
                            JSON.stringify(selectedEntry.details, null, 2),
                          );
                          setCopiedJson(true);
                          setTimeout(() => setCopiedJson(false), 2000);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                    >
                      {copiedJson ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-500" />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copiar JSON
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-muted/40 p-3 text-[11px] font-mono text-foreground">
                    {JSON.stringify(selectedEntry.details, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="flex justify-end border-t border-border p-4 bg-card">
                <button
                  type="button"
                  onClick={() => setSelectedEntry(null)}
                  className="rounded-lg border border-border bg-muted/50 px-4 py-2 font-semibold text-xs text-foreground hover:bg-muted transition cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
