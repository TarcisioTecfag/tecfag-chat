import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTrainingSurface } from "@/hooks/useTrainingSurface";
import { useChat } from "@/hooks/useChatState";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { CrmToolbar, PipelineOption, CrmStatusFilter } from "./CrmToolbar";
import { PipelineBoard } from "./PipelineBoard";
import { DealList } from "./DealList";
import { DealCardData } from "./DealCard";
import { CreateDealDialog } from "./CreateDealDialog";
import { CreateTaskModal } from "./CreateTaskModal";
import { CrmQuickCreateDialog, CrmQuickCreateKind } from "./CrmQuickCreateDialog";
import { CrmSearchModal } from "./CrmSearchModal";
import { AccountDetailModal } from "./AccountDetailModal";
import { AdvancedFiltersModal, AdvancedFiltersState } from "./AdvancedFiltersModal";
import { SaleCelebrationModal, type SaleCelebrationData } from "./SaleCelebrationModal";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { CrmKanbanSkeleton } from "./CrmKanbanSkeleton";
import {
  invalidateDealCache,
  preloadDealRouteChunk,
  seedDealPreview,
  seedPipelinesCache,
} from "@/lib/crm/deal-prefetch";
import { getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";

type CrmViewSnapshot = {
  savedAt: number;
  pipelines: any[];
  pipelineId: string;
  deals: DealCardData[];
  stagesSummary: any[];
  stageSettings: Record<string, { coolingEnabled: boolean; coolingDays: number }>;
  operators: Array<{ id: string; name: string; avatar?: string | null }>;
};

// Armazenamento duradouro do funil ativo por tenant e operador no navegador (localStorage)
const CRM_PIPELINE_STORAGE_PREFIX = "crm_selected_pipeline";

export function getSavedCrmPipelineId(tenant?: string | null, operatorId?: string | null): string {
  if (typeof window === "undefined") return "";
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get("pipelineId") || urlParams.get("pipeline");
    if (fromUrl) return fromUrl;

    if (tenant && operatorId) {
      const savedOp = localStorage.getItem(`${CRM_PIPELINE_STORAGE_PREFIX}_${tenant}_${operatorId}`);
      if (savedOp) return savedOp;
    }

    if (tenant) {
      const savedTenant = localStorage.getItem(`${CRM_PIPELINE_STORAGE_PREFIX}_${tenant}`);
      if (savedTenant) return savedTenant;
    }

    const savedGlobal = localStorage.getItem(CRM_PIPELINE_STORAGE_PREFIX);
    if (savedGlobal) return savedGlobal;
  } catch (err) {
    console.warn("[CrmView] Falha ao recuperar funil do localStorage:", err);
  }
  return "";
}

export function saveCrmPipelineId(pipelineId: string, tenant?: string | null, operatorId?: string | null) {
  if (typeof window === "undefined" || !pipelineId) return;
  try {
    if (tenant && operatorId) {
      localStorage.setItem(`${CRM_PIPELINE_STORAGE_PREFIX}_${tenant}_${operatorId}`, pipelineId);
    }
    if (tenant) {
      localStorage.setItem(`${CRM_PIPELINE_STORAGE_PREFIX}_${tenant}`, pipelineId);
    }
    localStorage.setItem(CRM_PIPELINE_STORAGE_PREFIX, pipelineId);
  } catch (err) {
    console.warn("[CrmView] Falha ao salvar funil no localStorage:", err);
  }
}

const CRM_PREFS_STORAGE_PREFIX = "valem_crm_view_prefs";

interface CrmPersistedPrefs {
  viewMode?: "kanban" | "list";
  statusFilter?: CrmStatusFilter;
  selectedOperatorIds?: string[];
  sortBy?: string;
  advancedFilters?: AdvancedFiltersState;
  searchQuery?: string;
}

function getSavedCrmPrefs(tenant?: string | null, operatorId?: string | null): CrmPersistedPrefs {
  if (typeof window === "undefined") return {};
  try {
    const keys: string[] = [];
    if (tenant && operatorId) keys.push(`${CRM_PREFS_STORAGE_PREFIX}_${tenant}_${operatorId}`);
    if (tenant) keys.push(`${CRM_PREFS_STORAGE_PREFIX}_${tenant}`);
    keys.push(CRM_PREFS_STORAGE_PREFIX);

    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return parsed as CrmPersistedPrefs;
        }
      }
    }
  } catch (err) {
    console.warn("[CrmView] Falha ao recuperar preferências do CRM do localStorage:", err);
  }
  return {};
}

function saveCrmPrefs(prefs: CrmPersistedPrefs, tenant?: string | null, operatorId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(prefs);
    if (tenant && operatorId) {
      localStorage.setItem(`${CRM_PREFS_STORAGE_PREFIX}_${tenant}_${operatorId}`, serialized);
    }
    if (tenant) {
      localStorage.setItem(`${CRM_PREFS_STORAGE_PREFIX}_${tenant}`, serialized);
    }
    localStorage.setItem(CRM_PREFS_STORAGE_PREFIX, serialized);
  } catch (err) {
    console.warn("[CrmView] Falha ao salvar preferências do CRM no localStorage:", err);
  }
}

// Reaproveita o último funil exibido ao alternar entre Chat e CRM.
// A chave inclui tenant e operador; a tela ainda revalida os dados ao abrir.
const crmViewSnapshots = new Map<string, CrmViewSnapshot>();
const CRM_SNAPSHOT_TTL_MS = 10 * 60 * 1000;

export function CrmView() {
  const {
    tenant,
    currentOperatorId,
    operators: globalOperators,
    operatorProfile,
    refreshConversations,
    setActiveView,
    setSelectedChatId,
  } = useChat();
  const navigate = useNavigate();
  const snapshotKey = `${tenant}:${currentOperatorId}`;
  const initialSnapshot = useRef<CrmViewSnapshot | null>(
    (() => {
      const cached = crmViewSnapshots.get(snapshotKey);
      return cached && Date.now() - cached.savedAt < CRM_SNAPSHOT_TTL_MS ? cached : null;
    })(),
  );
  const initialPrefs = useRef<CrmPersistedPrefs>(getSavedCrmPrefs(tenant, currentOperatorId));

  const [loading, setLoading] = useState(!initialSnapshot.current);
  const [error, setError] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<any[]>(initialSnapshot.current?.pipelines || []);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(() => {
    return initialSnapshot.current?.pipelineId || getSavedCrmPipelineId(tenant, currentOperatorId) || "";
  });
  const [deals, setDeals] = useState<DealCardData[]>(initialSnapshot.current?.deals || []);
  const [totalDeals, setTotalDeals] = useState(0);
  const [loadingMoreStages, setLoadingMoreStages] = useState<Record<string, boolean>>({});

  // Refs para controle atômico de concorrência e paginação por etapa sem stale closure
  const dealsRef = useRef<DealCardData[]>([]);
  dealsRef.current = deals;
  const loadingStagesRef = useRef<Set<string>>(new Set());

  // Painel de filtros
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);

  // Filtros Globais Compartilhados entre Kanban e Lista (persistidos em localStorage)
  const [viewMode, setViewMode] = useState<"kanban" | "list">(() => {
    const savedMode = initialPrefs.current.viewMode;
    if (savedMode === "kanban" || savedMode === "list") {
      return savedMode;
    }
    return getInitialTabFromUrl("crm", "kanban", ["kanban", "list"] as const);
  });
  const [statusFilter, setStatusFilter] = useState<CrmStatusFilter>(() => {
    const saved = initialPrefs.current.statusFilter;
    if (saved === "all" || saved === "open" || saved === "won" || saved === "lost" || saved === "paused") {
      return saved;
    }
    return "open";
  });

  useSyncModuleTabWithUrl({
    viewId: "crm",
    activeTab: viewMode,
    setActiveTab: setViewMode,
    allowedTabs: ["kanban", "list"] as const,
  });

  // Troca de funil unificada com persistência imediata no localStorage
  const handlePipelineChange = useCallback(
    (newPipelineId: string) => {
      setSelectedPipelineId(newPipelineId);
      setListOffset(0);
      saveCrmPipelineId(newPipelineId, tenant, currentOperatorId);
    },
    [tenant, currentOperatorId],
  );

  // Alternância ágil por setas (Left / Right): entre funis (quando houver múltiplos) ou entre Quadro / Lista
  const crmTabs: readonly string[] = useMemo(() => {
    if (pipelines.length > 1) {
      return pipelines.map((p) => p.id);
    }
    return ["kanban", "list"] as const;
  }, [pipelines]);

  useTabNavigation({
    tabs: crmTabs,
    activeTab: pipelines.length > 1 ? selectedPipelineId : viewMode,
    onChange: (val) => {
      if (pipelines.length > 1) {
        handlePipelineChange(val as string);
      } else {
        setViewMode(val as "kanban" | "list");
      }
    },
  });
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<string[]>(() =>
    Array.isArray(initialPrefs.current.selectedOperatorIds)
      ? initialPrefs.current.selectedOperatorIds
      : [],
  );
  const [sortBy, setSortBy] = useState<string>(() =>
    typeof initialPrefs.current.sortBy === "string" && initialPrefs.current.sortBy
      ? initialPrefs.current.sortBy
      : "updated_desc",
  );
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFiltersState>(() =>
    initialPrefs.current.advancedFilters && typeof initialPrefs.current.advancedFilters === "object"
      ? initialPrefs.current.advancedFilters
      : {},
  );
  const [searchQuery, setSearchQuery] = useState(() =>
    typeof initialPrefs.current.searchQuery === "string" ? initialPrefs.current.searchQuery : "",
  );
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(() =>
    typeof initialPrefs.current.searchQuery === "string"
      ? initialPrefs.current.searchQuery.trim()
      : "",
  );
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchAccountId, setSearchAccountId] = useState<string | null>(null);
  const [celebrationData, setCelebrationData] = useState<SaleCelebrationData | null>(null);

  // Salva automaticamente em memória/localStorage o modo (Quadro/Lista) e os últimos filtros usados
  useEffect(() => {
    saveCrmPrefs(
      {
        viewMode,
        statusFilter,
        selectedOperatorIds,
        sortBy,
        advancedFilters,
        searchQuery,
      },
      tenant,
      currentOperatorId,
    );
  }, [viewMode, statusFilter, selectedOperatorIds, sortBy, advancedFilters, searchQuery, tenant, currentOperatorId]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setDebouncedSearchQuery("");
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(trimmed);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  // Paginação separada para a Lista
  const [listLimit, setListLimit] = useState(50);
  const [listOffset, setListOffset] = useState(0);

  // Resumo de Etapas (Agregação Real do Servidor)
  const [stagesSummary, setStagesSummary] = useState<any[]>(initialSnapshot.current?.stagesSummary || []);
  const [stageSettings, setStageSettings] = useState<
    Record<string, { coolingEnabled: boolean; coolingDays: number }>
  >(initialSnapshot.current?.stageSettings || {});

  // Operadores
  const [operators, setOperators] = useState<Array<{ id: string; name: string; avatar?: string | null }>>(
    initialSnapshot.current?.operators || [],
  );

  const effectiveOperators = useMemo(() => {
    const globalById = new Map<string, { name: string; avatar?: string | null }>();
    for (const gOp of globalOperators || []) {
      globalById.set(gOp.id, { name: gOp.name, avatar: gOp.avatar || null });
    }
    if (currentOperatorId && operatorProfile?.avatar) {
      globalById.set(currentOperatorId, {
        name: operatorProfile.name,
        avatar: operatorProfile.avatar,
      });
    }

    const baseList = operators.length > 0 ? operators : globalOperators || [];
    return baseList.map((op) => {
      const globalMatch = globalById.get(op.id);
      return {
        ...op,
        name: globalMatch?.name || op.name,
        avatar: globalMatch?.avatar || op.avatar || null,
      };
    });
  }, [operators, globalOperators, currentOperatorId, operatorProfile]);

  // Modais de Ação
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [quickCreateKind, setQuickCreateKind] = useState<CrmQuickCreateKind | null>(null);
  const [createAtStageId, setCreateAtStageId] = useState<string | undefined>(undefined);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalDeal, setTaskModalDeal] = useState<DealCardData | null>(null);
  useTrainingSurface("crm", (step) => {
    if (loading || !pipelines.length) return false;
    const id = step.id;
    setIsCreateDialogOpen(id.startsWith("crm.new-deal-"));
    setIsAdvancedFiltersOpen(id.startsWith("crm.advanced-"));
    setAdvancedFilters(id === "crm.filter-chips" ? { hasOverdueTask: true } : {});
    setIsSearchOpen(id === "crm.global-search");
    setQuickCreateKind(id === "crm.quick-company" ? "company" : id === "crm.quick-contact" ? "contact" : null);
    setIsTaskModalOpen(false);
    if (step.surface === "crm.list" || step.surface === "crm.bulk-suite") setViewMode("list");
    else if ((step.surface === "crm.board" || step.surface === "crm.terminal-dialog") && id !== "crm.views") setViewMode("kanban");
    return true;
  });

  // Mapas para consulta rápida (referência estabilizada para não invalidar React.memo a cada heartbeat SSE)
  const prevOperatorsMapRef = useRef<Map<string, string>>(new Map());
  const operatorsMap = useMemo(() => {
    const prev = prevOperatorsMapRef.current;
    if (
      prev.size === effectiveOperators.length &&
      effectiveOperators.every((op) => prev.get(op.id) === op.name)
    ) {
      return prev;
    }
    const next = new Map<string, string>();
    for (const op of effectiveOperators) {
      next.set(op.id, op.name);
    }
    prevOperatorsMapRef.current = next;
    return next;
  }, [effectiveOperators]);

  // Funil ativo
  const activePipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const activeStages = activePipeline?.stages || [];

  // Mapa de etapas
  const stagesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of activeStages) {
      map.set(s.id, s.name);
    }
    return map;
  }, [activeStages]);

  // Mapa de resumo de etapas
  const stagesSummaryMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of stagesSummary) {
      map.set(s.stageId, s);
    }
    return map;
  }, [stagesSummary]);

  // Helper para construir query params padronizados
  const buildFilterQueryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedPipelineId) {
      params.set("pipelineId", selectedPipelineId);
    }
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    if (selectedOperatorIds.length > 0) {
      params.set("operatorIds", selectedOperatorIds.join(","));
    }
    if (sortBy) {
      params.set("sortBy", sortBy);
    }
    if (debouncedSearchQuery) {
      params.set("dealSearch", debouncedSearchQuery);
    }

    // Filtros Avançados
    if (advancedFilters.stageIds && advancedFilters.stageIds.length > 0) {
      params.set("stageIds", advancedFilters.stageIds.join(","));
    }
    if (advancedFilters.minValue !== undefined) {
      params.set("minValue", String(advancedFilters.minValue));
    }
    if (advancedFilters.maxValue !== undefined) {
      params.set("maxValue", String(advancedFilters.maxValue));
    }
    if (advancedFilters.createdAfter) {
      params.set("createdAfter", advancedFilters.createdAfter);
    }
    if (advancedFilters.createdBefore) {
      params.set("createdBefore", advancedFilters.createdBefore);
    }
    if (advancedFilters.hasOverdueTask) {
      params.set("hasOverdueTask", "true");
    }
    if (advancedFilters.coolingOnly) {
      params.set("coolingOnly", "true");
      if (advancedFilters.coolingDays) {
        params.set("coolingDays", String(advancedFilters.coolingDays));
      }
    }
    if (advancedFilters.withoutTask) params.set("withoutTask", "true");
    if (advancedFilters.rdStationOnly) params.set("rdStationOnly", "true");
    if (advancedFilters.emptyFields?.length) params.set("emptyFields", advancedFilters.emptyFields.join(","));
    for (const key of ["title", "rating", "companyId", "campaign", "source", "productId",
      "lastContactFrom", "lastContactTo", "nextTaskFrom", "nextTaskTo", "closedFrom", "closedTo",
      "expectedCloseFrom", "expectedCloseTo"] as const) {
      const value = advancedFilters[key];
      if (value !== undefined && value !== "") params.set(key, String(value));
    }

    return params;
  }, [selectedPipelineId, statusFilter, selectedOperatorIds, sortBy, debouncedSearchQuery, advancedFilters]);

  // Carrega pipelines
  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/pipelines");
      if (!res.ok) throw new Error("Erro ao carregar funis de negociação.");
      const data = await res.json();
      const list = data.pipelines || [];
      setPipelines(list);
      seedPipelinesCache(list);
      preloadDealRouteChunk();
      if (list.length > 0) {
        setSelectedPipelineId((current) => {
          // 1. Se o funil em estado for válido na lista recebida, mantém e persiste
          if (current && list.some((p: any) => p.id === current)) {
            saveCrmPipelineId(current, tenant, currentOperatorId);
            return current;
          }
          // 2. Se houver um funil gravado no localStorage deste operador/tenant, restaura
          const saved = getSavedCrmPipelineId(tenant, currentOperatorId);
          if (saved && list.some((p: any) => p.id === saved)) {
            return saved;
          }
          // 3. Fallback neutro: primeiro funil retornado pela API (sem impor funil padrão fixo)
          const fallbackId = list[0].id;
          saveCrmPipelineId(fallbackId, tenant, currentOperatorId);
          return fallbackId;
        });
      } else {
        setSelectedPipelineId("");
        setDeals([]);
        setStagesSummary([]);
        setLoading(false);
      }
    } catch (err: any) {
      console.error("[CrmView] Erro pipelines:", err);
      toast.error("Falha ao carregar funis comerciais.");
      setLoading(false);
    }
  }, [tenant, currentOperatorId]);

  // Carrega operadores
  const fetchOperators = useCallback(async () => {
    try {
      const res = await fetch("/api/operators");
      if (res.ok) {
        const data = await res.json();
        setOperators(Array.isArray(data) ? data : data.operators || []);
      }
    } catch (e) {
      console.warn("[CrmView] Falha ao listar operadores:", e);
    }
  }, []);

  const fetchStageSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/crm/stage-settings");
      if (!response.ok) return;
      const data = await response.json();
      const settings: Array<{ stageId: string; coolingEnabled: boolean; coolingDays: number }> =
        data.settings || [];
      setStageSettings(
        Object.fromEntries(
          settings.map((item) => [
            item.stageId,
            { coolingEnabled: item.coolingEnabled, coolingDays: item.coolingDays },
          ]),
        ),
      );
    } catch (error) {
      console.warn("[CrmView] Falha ao carregar configurações das etapas:", error);
    }
  }, [tenant]);

  // Carrega resumo de etapas (agregação real no servidor)
  const fetchStagesSummary = useCallback(async () => {
    if (!selectedPipelineId) return;
    try {
      const params = buildFilterQueryParams();
      const res = await fetch(
        `/api/crm/pipelines/${selectedPipelineId}/stages-summary?${params.toString()}`,
      );
      if (res.ok) {
        const data = await res.json();
        setStagesSummary(data.stages || []);
      }
    } catch (err) {
      console.warn("[CrmView] Falha ao buscar resumo de etapas:", err);
    }
  }, [selectedPipelineId, buildFilterQueryParams]);

  // Carrega deals com os filtros ativos
  const fetchDeals = useCallback(async () => {
    if (!selectedPipelineId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = buildFilterQueryParams();

      if (viewMode === "list") {
        params.set("limit", String(listLimit));
        params.set("offset", String(listOffset));
        params.set("previewOnly", "true");
      } else {
        // No modo kanban traz fatia equilibrada particionada por etapa (20 cards/etapa para alta performance)
        params.set("perStageLimit", "20");
        params.set("previewOnly", "true");
        params.set("includeTotal", "false");
      }

      const res = await fetch(`/api/crm/deals?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Erro ao carregar negociações.");
      }
      const data = await res.json();
      setDeals(data.deals || []);
      if (viewMode === "list") setTotalDeals(data.total || 0);
    } catch (err: any) {
      console.error("[CrmView] Erro deals:", err);
      setError(err.message || "Falha ao carregar negociações.");
      toast.error("Falha ao carregar negociações.");
    } finally {
      setLoading(false);
    }
  }, [selectedPipelineId, buildFilterQueryParams, viewMode, listLimit, listOffset]);

  // Carrega mais negociações de uma etapa específica sob demanda (Kanban)
  const handleLoadMoreStage = useCallback(
    async (stageId: string) => {
      if (loadingStagesRef.current.has(stageId)) return;
      loadingStagesRef.current.add(stageId);
      setLoadingMoreStages((prev) => ({ ...prev, [stageId]: true }));
      try {
        const stageDealsCount = dealsRef.current.filter((d) => d.stageId === stageId).length;
        const params = buildFilterQueryParams();
        params.set("stageId", stageId);
        params.set("limit", "20");
        params.set("offset", String(stageDealsCount));
        params.set("previewOnly", "true");
        params.set("includeTotal", "false");

        const res = await fetch(`/api/crm/deals?${params.toString()}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Erro ao carregar mais negociações.");
        }
        const data = await res.json();
        const incomingDeals: DealCardData[] = data.deals || [];
        if (incomingDeals.length > 0) {
          setDeals((prev) => {
            const existingIds = new Set(prev.map((d) => d.id));
            const uniqueIncoming = incomingDeals.filter((d) => !existingIds.has(d.id));
            return [...prev, ...uniqueIncoming];
          });
        }
      } catch (err: any) {
        console.error("[CrmView] Erro ao carregar mais cards da etapa:", err);
        toast.error("Não foi possível carregar mais negociações desta etapa.");
      } finally {
        loadingStagesRef.current.delete(stageId);
        setLoadingMoreStages((prev) => ({ ...prev, [stageId]: false }));
      }
    },
    [buildFilterQueryParams],
  );

  // Inicialização & troca de tenant
  const previousTenantRef = useRef(tenant);
  useEffect(() => {
    if (previousTenantRef.current === tenant) return;
    previousTenantRef.current = tenant;
    setDeals([]);
    setStageSettings({});
    const saved = getSavedCrmPipelineId(tenant, currentOperatorId);
    setSelectedPipelineId(saved || "");
  }, [tenant, currentOperatorId]);

  // Reavalia funil gravado se o operador terminar de carregar da sessão assíncrona
  useEffect(() => {
    if (!pipelines.length) return;
    const saved = getSavedCrmPipelineId(tenant, currentOperatorId);
    if (saved && saved !== selectedPipelineId && pipelines.some((p) => p.id === saved)) {
      setSelectedPipelineId(saved);
    }
  }, [tenant, currentOperatorId, pipelines, selectedPipelineId]);

  // Salva no localStorage sempre que o selectedPipelineId mudar e for válido
  useEffect(() => {
    if (selectedPipelineId) {
      saveCrmPipelineId(selectedPipelineId, tenant, currentOperatorId);
    }
  }, [selectedPipelineId, tenant, currentOperatorId]);

  useEffect(() => {
    if (loading || !selectedPipelineId || !pipelines.length || viewMode !== "kanban" ||
      statusFilter !== "open" || selectedOperatorIds.length || sortBy !== "updated_desc" ||
      debouncedSearchQuery || Object.keys(advancedFilters).length) return;
    crmViewSnapshots.set(snapshotKey, {
      savedAt: Date.now(), pipelines, pipelineId: selectedPipelineId, deals,
      stagesSummary, stageSettings, operators: effectiveOperators,
    });
  }, [snapshotKey, loading, pipelines, selectedPipelineId, deals, stagesSummary, stageSettings, effectiveOperators,
    viewMode, statusFilter, selectedOperatorIds, sortBy, debouncedSearchQuery, advancedFilters]);

  useEffect(() => {
    fetchPipelines();
    fetchOperators();
    fetchStageSettings();
  }, [fetchPipelines, fetchOperators, fetchStageSettings]);

  useEffect(() => {
    fetchDeals();
    if (viewMode === "kanban") fetchStagesSummary();
  }, [fetchDeals, fetchStagesSummary, viewMode]);

  // Movimentação de Card (Kanban) com concorrência otimista (Estabilizado com useCallback)
  const handleMoveDeal = useCallback(
    async (
      dealId: string,
      newStageId: string,
      currentVersion: number,
      terminalData?: { status: "won" | "lost"; lossReason?: string; value?: string | number | null },
    ) => {
      // Atualização otimista imediata na UI
      setDeals((prev) =>
        prev.map((d) =>
          d.id === dealId
            ? {
                ...d,
                stageId: newStageId,
                version: d.version + 1,
                status: terminalData?.status || d.status,
                value: terminalData?.value !== undefined ? terminalData.value : d.value,
              }
            : d,
        ),
      );

      try {
        const payload: Record<string, any> = {
          stageId: newStageId,
          expectedVersion: currentVersion,
        };

        if (terminalData) {
          if (terminalData.status) payload.status = terminalData.status;
          if (terminalData.lossReason) payload.lossReason = terminalData.lossReason;
          if (terminalData.value !== undefined) payload.value = terminalData.value;
        }

        const res = await fetch(`/api/crm/deals/${dealId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.status === 409) {
          toast.error(
            "Conflito: esta negociação foi alterada por outro usuário. Atualizando quadro...",
          );
          fetchDeals();
          fetchStagesSummary();
          return;
        }

        if (!res.ok) {
          throw new Error("Erro ao atualizar etapa.");
        }

        const data = await res.json();
        invalidateDealCache(dealId);
        setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, ...data.deal } : d)));
        fetchStagesSummary();
        const targetStage = activePipeline?.stages?.find((s: any) => s.id === newStageId);
        if (terminalData?.status === "won" || data.deal?.status === "won" || targetStage?.isWinStage) {
          setCelebrationData({
            dealTitle: data.deal?.title || "Negociação",
            value: data.deal?.value ?? terminalData?.value ?? null,
            sellerName:
              (data.deal?.operatorId && operatorsMap.get(data.deal.operatorId)) || null,
            accountName: data.deal?.account?.name || null,
          });
        } else {
          toast.success("Negociação movida com sucesso!");
        }
      } catch (err: any) {
        console.error("[CrmView] Falha ao mover deal:", err);
        toast.error("Falha ao mover negociação.");
        fetchDeals();
        fetchStagesSummary();
      }
    },
    [fetchDeals, fetchStagesSummary, activePipeline?.stages, operatorsMap],
  );

  const handleDealClick = useCallback(
    (d: DealCardData) => {
      seedDealPreview(d);
      navigate({
        to: "/crm/deals/$dealId",
        params: { dealId: d.id },
        search: { from: "crm" },
      });
    },
    [navigate],
  );

  const handleNewDealAtStage = useCallback((stageId: string) => {
    setCreateAtStageId(stageId);
    setIsCreateDialogOpen(true);
  }, []);

  const handleCreateTaskClick = useCallback((deal: DealCardData) => {
    setTaskModalDeal(deal);
    setIsTaskModalOpen(true);
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setStatusFilter("all");
    setSelectedOperatorIds([]);
    setAdvancedFilters({});
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setListOffset(0);
  }, []);

  // Listener centralizado para abrir conversa completa no Chat (evita assinar useChat em cada DealCard)
  useEffect(() => {
    const handleOpenFullChatEvent = async (ev: Event) => {
      const customEv = ev as CustomEvent<DealCardData>;
      const deal = customEv.detail;
      if (!deal) return;
      try {
        let targetConversationId = deal.primaryConversationId || null;

        if (!targetConversationId && deal.primaryContactId) {
          const res = await fetch(
            `/api/contacts/${encodeURIComponent(deal.primaryContactId)}/conversations`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ dealId: deal.id, autoCapture: true }),
            },
          );
          if (res.ok) {
            const data = await res.json();
            targetConversationId = data?.conversationId || null;
          }
        }

        if (!targetConversationId) {
          const res = await fetch(`/api/crm/deals/${encodeURIComponent(deal.id)}/conversations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              ensure: true,
              autoCapture: true,
              phone: deal.account?.phone || undefined,
              name: deal.account?.name || deal.title,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            targetConversationId = data?.conversationId || null;
          }
        }

        if (targetConversationId) {
          await refreshConversations(targetConversationId);
          setSelectedChatId(targetConversationId);
        }
      } catch {
        // prossegue para tela de chat
      }
      setActiveView("chat");
      if (window.location.pathname !== "/") navigate({ to: "/" });
    };

    window.addEventListener("crm:open-full-chat", handleOpenFullChatEvent);
    return () => window.removeEventListener("crm:open-full-chat", handleOpenFullChatEvent);
  }, [refreshConversations, setSelectedChatId, setActiveView, navigate]);

  useEffect(() => {
    const handleDealValueUpdated = (ev: Event) => {
      const customEv = ev as CustomEvent<{
        dealId: string;
        stageId: string;
        value: number;
        previousValue: number;
      }>;
      const { dealId, stageId, value, previousValue } = customEv.detail || {};
      if (!dealId) return;
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, value, updatedAt: new Date().toISOString() } : d)),
      );
      if (stageId && Number.isFinite(value)) {
        const diff = value - (Number(previousValue) || 0);
        setStagesSummary((prev) =>
          prev.map((st) =>
            st.stageId === stageId
              ? { ...st, totalValue: Math.max(0, (Number(st.totalValue) || 0) + diff) }
              : st,
          ),
        );
      }
    };

    const handleDealTaskCompleted = (ev: Event) => {
      const customEv = ev as CustomEvent<{ dealId: string; activityId: string }>;
      const { dealId, activityId } = customEv.detail || {};
      if (!dealId) return;
      setDeals((prev) =>
        prev.map((d) =>
          d.id === dealId && (!activityId || d.nextTask?.id === activityId)
            ? { ...d, nextTask: null, lastActivityAt: new Date().toISOString() }
            : d,
        ),
      );
      void fetchDeals();
    };

    window.addEventListener("crm:deal-value-updated", handleDealValueUpdated);
    window.addEventListener("crm:deal-task-completed", handleDealTaskCompleted);
    return () => {
      window.removeEventListener("crm:deal-value-updated", handleDealValueUpdated);
      window.removeEventListener("crm:deal-task-completed", handleDealTaskCompleted);
    };
  }, [fetchDeals]);

  return (
    <div
      className={`flex flex-col h-full w-full ${
        viewMode === "kanban" ? "gap-0" : "gap-3 md:gap-4"
      } overflow-hidden pt-1.5 md:pt-1 pb-0 px-2 md:pl-1 md:pr-0`}
    >
      {/* Barra de Ferramentas Superior */}
      <div className="pr-0 md:pr-5 shrink-0">
        <CrmToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          pipelines={pipelines}
          selectedPipelineId={selectedPipelineId}
          onPipelineChange={handlePipelineChange}
          statusFilter={statusFilter}
          onStatusFilterChange={(st) => {
            setStatusFilter(st);
            setListOffset(0);
          }}
          operators={effectiveOperators}
          currentOperatorId={currentOperatorId}
          selectedOperatorIds={selectedOperatorIds}
          onOperatorIdsChange={(opIds) => {
            setSelectedOperatorIds(opIds);
            setListOffset(0);
          }}
          sortBy={sortBy}
          onSortByChange={(sb) => {
            setSortBy(sb);
            setListOffset(0);
          }}
          advancedFilters={advancedFilters}
          stages={activeStages}
          onAdvancedFiltersChange={(filters) => {
            setAdvancedFilters(filters);
            setListOffset(0);
          }}
          onOpenAdvancedFilters={() => setIsAdvancedFiltersOpen(true)}
          onClearFilters={handleClearAllFilters}
          searchQuery={searchQuery}
          onSearchQueryChange={(val) => {
            setSearchQuery(val);
            setListOffset(0);
          }}
          onOpenSearch={() => setIsSearchOpen(true)}
          onNewDealClick={() => {
            setCreateAtStageId(undefined);
            setIsCreateDialogOpen(true);
          }}
          onCreateCompanyClick={() => setQuickCreateKind("company")}
          onCreateContactClick={() => setQuickCreateKind("contact")}
          onCreateTaskClick={() => {
            setTaskModalDeal(null);
            setIsTaskModalOpen(true);
          }}
        />
      </div>

      {/* Conteúdo Principal */}
      <div className="min-h-0 flex-1 overflow-hidden relative">
        {loading && deals.length === 0 && !debouncedSearchQuery ? (
          <CrmKanbanSkeleton />
        ) : !activePipeline ? (
          <div className="flex h-full w-full items-center justify-center p-8 text-center pr-5">
            <div className="max-w-md space-y-3">
              <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-bold text-foreground">Nenhum funil disponível</h3>
              <p className="text-xs text-muted-foreground">
                Nenhum funil comercial foi detectado para o seu tenant ou as informações ainda estão
                sendo sincronizadas.
              </p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  fetchPipelines();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Inicializar / Recarregar Funil</span>
              </button>
            </div>
          </div>
        ) : viewMode === "kanban" ? (
          <div key="crm-kanban-view" className="h-full w-full animate-in fade-in-50 duration-200">
            <PipelineBoard
              pipeline={activePipeline}
              deals={deals}
              stageSettings={stageSettings}
              stagesSummaryMap={stagesSummaryMap}
              operatorsMap={operatorsMap}
              onDealClick={handleDealClick}
              onMoveDeal={handleMoveDeal}
              onNewDealAtStage={handleNewDealAtStage}
              onCreateTaskClick={handleCreateTaskClick}
              onLoadMoreStage={handleLoadMoreStage}
              loadingMoreStages={loadingMoreStages}
            />
          </div>
        ) : (
          <div key="crm-list-view" className="h-full w-full pr-5 pb-5 animate-in fade-in-50 duration-200">
            <DealList
              deals={deals}
              stages={activeStages}
              operators={effectiveOperators}
              stagesMap={stagesMap}
              operatorsMap={operatorsMap}
              pipelines={pipelines}
              currentPipelineId={selectedPipelineId}
              filterParams={Object.fromEntries(buildFilterQueryParams().entries())}
              onDealClick={handleDealClick}
              total={totalDeals}
              limit={listLimit}
              offset={listOffset}
              onPageChange={setListOffset}
              onLimitChange={(newLimit) => {
                setListLimit(newLimit);
                setListOffset(0);
              }}
              loading={loading}
              error={error}
              onRetry={fetchDeals}
              onClearFilters={handleClearAllFilters}
              onRefreshData={() => {
                fetchDeals();
                fetchStagesSummary();
              }}
              onCreateTaskClick={handleCreateTaskClick}
            />
          </div>
        )}
      </div>

      {/* Modal de Filtros Avançados */}
      <AdvancedFiltersModal
        isOpen={isAdvancedFiltersOpen}
        onClose={() => setIsAdvancedFiltersOpen(false)}
        stages={activeStages}
        filters={advancedFilters}
        statusFilter={statusFilter}
        onApply={(newFilters, newStatus) => {
          setAdvancedFilters(newFilters);
          setStatusFilter(newStatus);
          setListOffset(0);
        }}
      />

      {/* Modal de Criação de Negociação */}
      <CreateDealDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onSuccess={(newDeal, createAnother) => {
          fetchDeals();
          fetchStagesSummary();
          if (!createAnother)
            navigate({
              to: "/crm/deals/$dealId",
              params: { dealId: newDeal.id },
              search: { from: "crm" },
            });
        }}
        pipelines={pipelines}
        operators={effectiveOperators}
        defaultPipelineId={selectedPipelineId}
        defaultStageId={createAtStageId}
        currentOperatorId={currentOperatorId}
      />

      <CrmQuickCreateDialog
        kind={quickCreateKind}
        onClose={() => setQuickCreateKind(null)}
        onCreated={() => {
          fetchDeals();
          fetchStagesSummary();
        }}
        operators={effectiveOperators}
        currentOperatorId={currentOperatorId}
      />

      {/* Modal Criar Tarefa Idêntico ao RD Station CRM */}
      <CreateTaskModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setTaskModalDeal(null);
        }}
        dealId={taskModalDeal?.id}
        dealTitle={taskModalDeal?.title}
        accountId={taskModalDeal?.accountId || taskModalDeal?.account?.id}
        accountName={taskModalDeal?.account?.name}
        operators={effectiveOperators}
        currentOperatorId={taskModalDeal?.operatorId || currentOperatorId}
        onTaskCreated={() => {
          fetchDeals();
          fetchStagesSummary();
        }}
      />

      <CrmSearchModal
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        initialQuery={searchQuery}
        onOpenDeal={(dealId) => {
          setIsSearchOpen(false);
          navigate({ to: "/crm/deals/$dealId", params: { dealId }, search: { from: "crm" } });
        }}
        onOpenCompany={(accountId) => {
          setIsSearchOpen(false);
          setSearchAccountId(accountId);
        }}
      />
      <AccountDetailModal
        accountId={searchAccountId}
        isOpen={searchAccountId !== null}
        onClose={() => setSearchAccountId(null)}
        onAccountUpdated={() => {
          fetchDeals();
          fetchStagesSummary();
        }}
        onOpenDeal={(dealId) => {
          setSearchAccountId(null);
          navigate({ to: "/crm/deals/$dealId", params: { dealId }, search: { from: "crm" } });
        }}
      />
      <SaleCelebrationModal
        data={celebrationData}
        onClose={() => setCelebrationData(null)}
      />
    </div>
  );
}
