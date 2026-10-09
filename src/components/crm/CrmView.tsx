import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { CrmKanbanSkeleton } from "./CrmKanbanSkeleton";

type CrmViewSnapshot = {
  savedAt: number;
  pipelines: any[];
  pipelineId: string;
  deals: DealCardData[];
  stagesSummary: any[];
  stageSettings: Record<string, { coolingEnabled: boolean; coolingDays: number }>;
  operators: Array<{ id: string; name: string }>;
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

// Reaproveita o último funil exibido ao alternar entre Chat e CRM.
// A chave inclui tenant e operador; a tela ainda revalida os dados ao abrir.
const crmViewSnapshots = new Map<string, CrmViewSnapshot>();
const CRM_SNAPSHOT_TTL_MS = 10 * 60 * 1000;

export function CrmView() {
  const { tenant, currentOperatorId } = useChat();
  const navigate = useNavigate();
  const snapshotKey = `${tenant}:${currentOperatorId}`;
  const initialSnapshot = useRef<CrmViewSnapshot | null>(
    (() => {
      const cached = crmViewSnapshots.get(snapshotKey);
      return cached && Date.now() - cached.savedAt < CRM_SNAPSHOT_TTL_MS ? cached : null;
    })(),
  );

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

  // Filtros Globais Compartilhados entre Kanban e Lista
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [statusFilter, setStatusFilter] = useState<CrmStatusFilter>("open");

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
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string>("updated_desc");
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFiltersState>({});
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchAccountId, setSearchAccountId] = useState<string | null>(null);

  // Paginação separada para a Lista
  const [listLimit, setListLimit] = useState(50);
  const [listOffset, setListOffset] = useState(0);

  // Resumo de Etapas (Agregação Real do Servidor)
  const [stagesSummary, setStagesSummary] = useState<any[]>(initialSnapshot.current?.stagesSummary || []);
  const [stageSettings, setStageSettings] = useState<
    Record<string, { coolingEnabled: boolean; coolingDays: number }>
  >(initialSnapshot.current?.stageSettings || {});

  // Operadores
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>(initialSnapshot.current?.operators || []);

  // Modais de Ação
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [quickCreateKind, setQuickCreateKind] = useState<CrmQuickCreateKind | null>(null);
  const [createAtStageId, setCreateAtStageId] = useState<string | undefined>(undefined);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalDeal, setTaskModalDeal] = useState<DealCardData | null>(null);

  // Mapas para consulta rápida
  const operatorsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const op of operators) {
      map.set(op.id, op.name);
    }
    return map;
  }, [operators]);

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
  }, [selectedPipelineId, statusFilter, selectedOperatorIds, sortBy, advancedFilters]);

  // Carrega pipelines
  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/pipelines");
      if (!res.ok) throw new Error("Erro ao carregar funis de negociação.");
      const data = await res.json();
      const list = data.pipelines || [];
      setPipelines(list);
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
      Object.keys(advancedFilters).length) return;
    crmViewSnapshots.set(snapshotKey, {
      savedAt: Date.now(), pipelines, pipelineId: selectedPipelineId, deals,
      stagesSummary, stageSettings, operators,
    });
  }, [snapshotKey, loading, pipelines, selectedPipelineId, deals, stagesSummary, stageSettings, operators,
    viewMode, statusFilter, selectedOperatorIds, sortBy, advancedFilters]);

  useEffect(() => {
    fetchPipelines();
    fetchOperators();
    fetchStageSettings();
  }, [fetchPipelines, fetchOperators, fetchStageSettings]);

  useEffect(() => {
    fetchDeals();
    if (viewMode === "kanban") fetchStagesSummary();
  }, [fetchDeals, fetchStagesSummary, viewMode]);

  // Movimentação de Card (Kanban) com concorrência otimista
  const handleMoveDeal = async (
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
      setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, ...data.deal } : d)));
      fetchStagesSummary();
      toast.success("Negociação movida com sucesso!");
    } catch (err: any) {
      console.error("[CrmView] Falha ao mover deal:", err);
      toast.error("Falha ao mover negociação.");
      fetchDeals();
      fetchStagesSummary();
    }
  };

  const handleClearAllFilters = () => {
    setStatusFilter("all");
    setSelectedOperatorIds([]);
    setAdvancedFilters({});
    setListOffset(0);
  };

  return (
    <div className="flex flex-col h-full w-full gap-4 overflow-hidden pt-1 pb-0 pl-1 pr-0">
      {/* Barra de Ferramentas Superior */}
      <div className="pr-5 shrink-0">
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
          operators={operators}
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
        {loading && deals.length === 0 ? (
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
              onDealClick={(d) =>
                navigate({
                  to: "/crm/deals/$dealId",
                  params: { dealId: d.id },
                  search: { from: "crm" },
                })
              }
              onMoveDeal={handleMoveDeal}
              onNewDealAtStage={(stageId) => {
                setCreateAtStageId(stageId);
                setIsCreateDialogOpen(true);
              }}
              onCreateTaskClick={(deal) => {
                setTaskModalDeal(deal);
                setIsTaskModalOpen(true);
              }}
              onLoadMoreStage={handleLoadMoreStage}
              loadingMoreStages={loadingMoreStages}
            />
          </div>
        ) : (
          <div key="crm-list-view" className="h-full w-full pr-5 pb-5 animate-in fade-in-50 duration-200">
            <DealList
              deals={deals}
              stages={activeStages}
              operators={operators}
              stagesMap={stagesMap}
              operatorsMap={operatorsMap}
              pipelines={pipelines}
              currentPipelineId={selectedPipelineId}
              filterParams={Object.fromEntries(buildFilterQueryParams().entries())}
              onDealClick={(d) =>
                navigate({
                  to: "/crm/deals/$dealId",
                  params: { dealId: d.id },
                  search: { from: "crm" },
                })
              }
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
              onCreateTaskClick={(deal) => {
                setTaskModalDeal(deal);
                setIsTaskModalOpen(true);
              }}
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
        operators={operators}
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
        operators={operators}
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
        operators={operators}
        currentOperatorId={currentOperatorId}
        onTaskCreated={() => {
          fetchDeals();
          fetchStagesSummary();
        }}
      />

      <CrmSearchModal
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
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
    </div>
  );
}
