import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useChat } from "@/hooks/useChatState";
import { CrmToolbar, PipelineOption } from "./CrmToolbar";
import { PipelineBoard } from "./PipelineBoard";
import { DealList } from "./DealList";
import { DealCardData } from "./DealCard";
import { CreateDealDialog } from "./CreateDealDialog";
import { DealDetailModal } from "./DealDetailModal";
import { toast } from "sonner";
import { Loader2, Plus, AlertCircle, RefreshCw } from "lucide-react";

export function CrmView() {
  const { tenant, currentOperatorId } = useChat();

  const [loading, setLoading] = useState(true);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [deals, setDeals] = useState<DealCardData[]>([]);
  const [totalDeals, setTotalDeals] = useState(0);

  // Filtros
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "won" | "lost" | "paused">("open");
  const [onlyMyDeals, setOnlyMyDeals] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  // Operadores
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([]);

  // Modais
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedDealForDetail, setSelectedDealForDetail] = useState<DealCardData | null>(null);
  const [createAtStageId, setCreateAtStageId] = useState<string | undefined>(undefined);

  // Mapas para consulta rápida
  const operatorsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const op of operators) {
      map.set(op.id, op.name);
    }
    return map;
  }, [operators]);

  // Carrega pipelines
  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/pipelines");
      if (!res.ok) throw new Error("Erro ao carregar funis de negociação.");
      const data = await res.json();
      const list = data.pipelines || [];
      setPipelines(list);
      if (list.length > 0 && !selectedPipelineId) {
        const defaultPipe = list.find((p: any) => p.isDefault) || list[0];
        setSelectedPipelineId(defaultPipe.id);
      }
    } catch (err: any) {
      console.error("[CrmView] Erro pipelines:", err);
      toast.error("Falha ao carregar funis comerciais.");
    }
  }, [selectedPipelineId]);

  // Carrega operadores para os selects e badges
  const fetchOperators = useCallback(async () => {
    try {
      const res = await fetch("/api/operators");
      if (res.ok) {
        const data = await res.json();
        setOperators(data.operators || []);
      }
    } catch (e) {
      console.warn("[CrmView] Falha ao listar operadores:", e);
    }
  }, []);

  // Carrega deals com os filtros ativos
  const fetchDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("pipelineId", selectedPipelineId);
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (onlyMyDeals && currentOperatorId) {
        params.set("operatorId", currentOperatorId);
      }
      if (searchQuery.trim()) {
        params.set("search", searchQuery.trim());
      }
      params.set("limit", String(limit));
      params.set("offset", String(offset));

      const res = await fetch(`/api/crm/deals?${params.toString()}`);
      if (!res.ok) throw new Error("Erro ao carregar negociações.");
      const data = await res.json();
      setDeals(data.deals || []);
      setTotalDeals(data.total || 0);
    } catch (err: any) {
      console.error("[CrmView] Erro deals:", err);
      toast.error("Falha ao carregar negociações.");
    } finally {
      setLoading(false);
    }
  }, [selectedPipelineId, statusFilter, onlyMyDeals, currentOperatorId, searchQuery, limit, offset]);

  // Inicialização
  useEffect(() => {
    fetchPipelines();
    fetchOperators();
  }, [fetchPipelines, fetchOperators]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  // Movimentação de Card (Kanban) com concorrência otimista
  const handleMoveDeal = async (dealId: string, newStageId: string, currentVersion: number) => {
    // Atualização otimista imediata na UI
    setDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, stageId: newStageId, version: d.version + 1 } : d))
    );

    try {
      const res = await fetch(`/api/crm/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageId: newStageId,
          expectedVersion: currentVersion,
        }),
      });

      if (res.status === 409) {
        toast.error("Conflito: esta negociação foi alterada por outro usuário. Atualizando quadro...");
        fetchDeals();
        return;
      }

      if (!res.ok) {
        throw new Error("Erro ao atualizar etapa.");
      }

      const data = await res.json();
      // Atualiza com dados oficiais do servidor
      setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, ...data.deal } : d)));
      toast.success("Negociação movida com sucesso!");
    } catch (err: any) {
      console.error("[CrmView] Falha ao mover deal:", err);
      toast.error("Falha ao mover negociação.");
      fetchDeals();
    }
  };

  // Funil ativo
  const activePipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const activeStages = activePipeline?.stages || [];

  // Mapeamento de id -> nome de etapa para a visão em lista
  const stagesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of activeStages) {
      map.set(s.id, s.name);
    }
    return map;
  }, [activeStages]);

  return (
    <div className="flex flex-col h-full w-full gap-4 overflow-hidden p-1">
      {/* Barra de Ferramentas Superior */}
      <CrmToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        pipelines={pipelines}
        selectedPipelineId={selectedPipelineId}
        onPipelineChange={(id) => {
          setSelectedPipelineId(id);
          setOffset(0);
        }}
        statusFilter={statusFilter}
        onStatusFilterChange={(st) => {
          setStatusFilter(st);
          setOffset(0);
        }}
        onlyMyDeals={onlyMyDeals}
        onToggleOnlyMyDeals={setOnlyMyDeals}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onNewDealClick={() => {
          setCreateAtStageId(undefined);
          setIsCreateDialogOpen(true);
        }}
      />

      {/* Conteúdo Principal */}
      <div className="flex-1 overflow-hidden relative">
        {loading && deals.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-xs font-semibold">Carregando funil comercial...</p>
            </div>
          </div>
        ) : !activePipeline ? (
          <div className="flex h-full w-full items-center justify-center p-8 text-center">
            <div className="max-w-md space-y-3">
              <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-bold text-foreground">Nenhum funil selecionado</h3>
              <p className="text-xs text-muted-foreground">
                Crie um novo funil ou selecione um funil existente na barra superior para acompanhar suas negociações.
              </p>
            </div>
          </div>
        ) : viewMode === "kanban" ? (
          <PipelineBoard
            pipeline={activePipeline}
            deals={deals}
            operatorsMap={operatorsMap}
            onDealClick={(d) => setSelectedDealForDetail(d)}
            onMoveDeal={handleMoveDeal}
            onNewDealAtStage={(stageId) => {
              setCreateAtStageId(stageId);
              setIsCreateDialogOpen(true);
            }}
          />
        ) : (
          <DealList
            deals={deals}
            stagesMap={stagesMap}
            operatorsMap={operatorsMap}
            onDealClick={(d) => setSelectedDealForDetail(d)}
            total={totalDeals}
            limit={limit}
            offset={offset}
            onPageChange={setOffset}
          />
        )}
      </div>

      {/* Modal de Criação de Negociação */}
      <CreateDealDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onSuccess={() => fetchDeals()}
        pipelines={pipelines}
        operators={operators}
        defaultPipelineId={selectedPipelineId}
        defaultStageId={createAtStageId}
        currentOperatorId={currentOperatorId}
      />

      {/* Modal de Detalhes da Negociação */}
      <DealDetailModal
        isOpen={!!selectedDealForDetail}
        dealId={selectedDealForDetail?.id || null}
        onClose={() => setSelectedDealForDetail(null)}
        onDealUpdated={() => fetchDeals()}
        pipelineStages={activeStages}
        operatorsMap={operatorsMap}
      />
    </div>
  );
}
