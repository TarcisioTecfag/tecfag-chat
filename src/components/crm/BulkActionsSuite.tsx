import React, { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Search,
  ArrowRightLeft,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ThumbsDown,
  ThumbsUp,
  Pause,
  Activity,
  Star,
  Tag,
  Compass,
  Package,
  Calendar,
  Trash2,
  X,
  Download,
  Building2,
  CheckSquare,
} from "lucide-react";
import { DealCardData } from "./DealCard";

export interface BulkActionsSuiteProps {
  selectedIds: Set<string>;
  onClearSelection: () => void;
  isAllFilterSelected: boolean;
  onToggleAllFilter: () => void;
  total: number;
  deals: DealCardData[];
  operators: Array<{ id: string; name: string }>;
  pipelines: Array<{
    id: string;
    name: string;
    stages: Array<{
      id: string;
      name: string;
      isWinStage?: boolean;
      isLossStage?: boolean;
      orderIndex?: number;
    }>;
  }>;
  currentPipelineId?: string;
  filterParams?: Record<string, any>;
  onSuccess: () => void;
}

export function BulkActionsSuite({
  selectedIds,
  onClearSelection,
  isAllFilterSelected,
  onToggleAllFilter,
  total,
  deals,
  operators,
  pipelines,
  currentPipelineId,
  filterParams,
  onSuccess,
}: BulkActionsSuiteProps) {
  const [loading, setLoading] = useState(false);

  // Contagem efetiva
  const effectiveCount = isAllFilterSelected ? total : selectedIds.size;

  // Estados dos Popovers
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSearch, setTransferSearch] = useState("");

  const [statusOpen, setStatusOpen] = useState(false);
  const [lossReasonModalOpen, setLossReasonModalOpen] = useState(false);
  const [lossReasonText, setLossReasonText] = useState("");

  const [addOrChangeOpen, setAddOrChangeOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);

  // Gavetas (Sheets)
  const [isMoveSheetOpen, setIsMoveSheetOpen] = useState(false);
  const [targetMovePipelineId, setTargetMovePipelineId] = useState<string>("");
  const [targetMoveStageId, setTargetMoveStageId] = useState<string>("");

  const [isExportSheetOpen, setIsExportSheetOpen] = useState(false);
  const [exportDataType, setExportDataType] = useState("deals");
  const [exportFormat, setExportFormat] = useState("csv");

  // Modais de Criação
  const [isCreateCompanyDealsOpen, setIsCreateCompanyDealsOpen] = useState(false);
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskType, setTaskType] = useState("task");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskDescription, setTaskDescription] = useState("");

  // Modais de Atributos (Qualificação, Campanha, Fonte, Produto)
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [selectedRating, setSelectedRating] = useState<number>(3);

  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [campaignInput, setCampaignInput] = useState("");
  const [catalogCampaigns, setCatalogCampaigns] = useState<Array<{ id: string; name: string }>>([]);

  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [sourceInput, setSourceInput] = useState("");
  const [catalogSources, setCatalogSources] = useState<Array<{ id: string; name: string }>>([]);

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedProductId, setSelectedProductId] = useState("");

  // Modal de Exclusão
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteCountInput, setDeleteCountInput] = useState("");
  const [deleteConfirmCheckbox, setDeleteConfirmCheckbox] = useState(false);

  // Inicializa o pipeline de destino no Sheet de Mover
  useEffect(() => {
    if (isMoveSheetOpen) {
      const initialPipeId = currentPipelineId || (pipelines.length > 0 ? pipelines[0].id : "");
      setTargetMovePipelineId(initialPipeId);
      const pipe = pipelines.find((p) => p.id === initialPipeId);
      if (pipe && pipe.stages.length > 0) {
        setTargetMoveStageId(pipe.stages[0].id);
      } else {
        setTargetMoveStageId("");
      }
    }
  }, [isMoveSheetOpen, currentPipelineId, pipelines]);

  // Atualiza etapas quando o funil de destino muda no Sheet
  const targetMovePipeline = useMemo(() => {
    return pipelines.find((p) => p.id === targetMovePipelineId);
  }, [pipelines, targetMovePipelineId]);

  const targetMoveStages = useMemo(() => {
    return targetMovePipeline?.stages || [];
  }, [targetMovePipeline]);

  // Operadores filtrados na busca do popover
  const filteredOperators = useMemo(() => {
    if (!transferSearch.trim()) return operators;
    const term = transferSearch.toLowerCase();
    return operators.filter((op) => op.name.toLowerCase().includes(term));
  }, [operators, transferSearch]);

  // Executa requisição genérica para /api/crm/deals/bulk
  const executeBulkRequest = async (payload: Record<string, any>, successMsg: string) => {
    setLoading(true);
    try {
      const body = {
        ...payload,
        dealIds: Array.from(selectedIds),
        allFiltered: isAllFilterSelected,
        filterParams: isAllFilterSelected ? filterParams : undefined,
      };

      const res = await fetch("/api/crm/deals/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Falha ao executar ação em massa.");
      }

      const data = await res.json();
      toast.success(data.message || successMsg);
      onSuccess();
      return true;
    } catch (err: any) {
      console.error("[BulkActionsSuite] Erro:", err);
      toast.error(err.message || "Erro ao processar ação em massa.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  // 1. AÇÃO: Transferir Operador
  const handleExecuteTransfer = async (opId: string, opName: string) => {
    const ok = await executeBulkRequest(
      { operatorId: opId },
      `Negociações transferidas para ${opName} com sucesso!`
    );
    if (ok) setTransferOpen(false);
  };

  // 2. AÇÃO: Alterar Status
  const handleExecuteStatus = async (status: "open" | "won" | "lost" | "paused") => {
    if (status === "lost") {
      setStatusOpen(false);
      setLossReasonModalOpen(true);
      return;
    }

    const labels: Record<string, string> = {
      open: "Em andamento",
      won: "Vendido",
      paused: "Pausado",
    };

    const ok = await executeBulkRequest(
      { status },
      `Status alterado para "${labels[status]}" com sucesso!`
    );
    if (ok) setStatusOpen(false);
  };

  const handleConfirmLossReason = async () => {
    const ok = await executeBulkRequest(
      { status: "lost", lossReason: lossReasonText.trim() || undefined },
      `Negociações marcadas como Perdidas!`
    );
    if (ok) {
      setLossReasonModalOpen(false);
      setLossReasonText("");
    }
  };

  // 3. AÇÃO: Mover Funil & Etapa
  const handleExecuteMove = async () => {
    if (!targetMoveStageId) {
      toast.error("Selecione a etapa de destino.");
      return;
    }
    const ok = await executeBulkRequest(
      {
        pipelineId: targetMovePipelineId,
        stageId: targetMoveStageId,
      },
      `${effectiveCount} negociações movidas com sucesso!`
    );
    if (ok) setIsMoveSheetOpen(false);
  };

  // 4. AÇÃO: Criar Negociações para Empresas
  const handleExecuteCreateCompanyDeals = async () => {
    const ok = await executeBulkRequest(
      { action: "create_deals_for_companies" },
      "Novas negociações criadas para empresas vinculadas!"
    );
    if (ok) setIsCreateCompanyDealsOpen(false);
  };

  // 5. AÇÃO: Criar Tarefa
  const handleExecuteCreateTask = async () => {
    if (!taskTitle.trim()) {
      toast.error("Informe o título da tarefa.");
      return;
    }
    const ok = await executeBulkRequest(
      {
        action: "create_tasks",
        taskData: {
          title: taskTitle.trim(),
          type: taskType,
          dueDate: taskDueDate || null,
          description: taskDescription.trim() || null,
        },
      },
      "Tarefa criada com sucesso para as negociações selecionadas!"
    );
    if (ok) {
      setIsCreateTaskModalOpen(false);
      setTaskTitle("");
      setTaskDescription("");
      setTaskDueDate("");
    }
  };

  // 6. AÇÃO: Alterar Atributos (Qualificação, Campanha, Fonte, Produto)
  const openRatingModal = () => {
    setAddOrChangeOpen(false);
    setRatingModalOpen(true);
  };

  const handleSaveRating = async () => {
    const ok = await executeBulkRequest(
      { rating: selectedRating },
      `Qualificação atualizada para ${selectedRating} estrela(s)!`
    );
    if (ok) setRatingModalOpen(false);
  };

  const openCampaignModal = async () => {
    setAddOrChangeOpen(false);
    setCampaignModalOpen(true);
    try {
      const res = await fetch("/api/crm/catalogs?kind=campaign");
      if (res.ok) {
        const data = await res.json();
        setCatalogCampaigns(data.items || []);
      }
    } catch (e) {
      console.warn("Falha ao carregar campanhas:", e);
    }
  };

  const handleSaveCampaign = async () => {
    if (!campaignInput.trim()) {
      toast.error("Informe ou selecione uma campanha.");
      return;
    }
    const ok = await executeBulkRequest(
      { campaign: campaignInput.trim() },
      `Campanha atualizada com sucesso!`
    );
    if (ok) setCampaignModalOpen(false);
  };

  const openSourceModal = async () => {
    setAddOrChangeOpen(false);
    setSourceModalOpen(true);
    try {
      const res = await fetch("/api/crm/catalogs?kind=source");
      if (res.ok) {
        const data = await res.json();
        setCatalogSources(data.items || []);
      }
    } catch (e) {
      console.warn("Falha ao carregar fontes:", e);
    }
  };

  const handleSaveSource = async () => {
    if (!sourceInput.trim()) {
      toast.error("Informe ou selecione uma fonte.");
      return;
    }
    const ok = await executeBulkRequest(
      { source: sourceInput.trim() },
      `Fonte atualizada com sucesso!`
    );
    if (ok) setSourceModalOpen(false);
  };

  const openProductModal = async () => {
    setAddOrChangeOpen(false);
    setProductModalOpen(true);
    try {
      const res = await fetch("/api/crm/products?isActive=true");
      if (res.ok) {
        const data = await res.json();
        setCatalogProducts(data.products || []);
      }
    } catch (e) {
      console.warn("Falha ao carregar produtos:", e);
    }
  };

  const handleSaveProduct = async () => {
    if (!selectedProductId) {
      toast.error("Selecione um produto ou serviço.");
      return;
    }
    const ok = await executeBulkRequest(
      { productId: selectedProductId },
      `Produto/Serviço adicionado com sucesso!`
    );
    if (ok) setProductModalOpen(false);
  };

  // 7. AÇÃO: Exportar Dados (CSV com cabeçalho UTF-8 BOM e pontuação brasileira)
  const handleExecuteExport = () => {
    try {
      // Exporta os itens da seleção atual
      const itemsToExport = isAllFilterSelected
        ? deals // Na seleção de filtro, exporta a lista carregada
        : deals.filter((d) => selectedIds.has(d.id));

      if (itemsToExport.length === 0) {
        toast.error("Nenhuma negociação para exportar.");
        return;
      }

      const headers = [
        "Negociação",
        "Código",
        "Cliente/Empresa",
        "Responsável",
        "Qualificação",
        "Etapa do Funil",
        "Valor Total",
        "Data de Criação",
        "Status",
      ];

      const rows = itemsToExport.map((d) => {
        const val = d.value !== null && d.value !== undefined ? String(d.value) : "";
        const clientName = d.account ? (d.account.name || d.account.tradeName || "") : "";
        const sellerId = d.operatorId || d.ownerId;
        const opName = sellerId ? operators.find((o) => o.id === sellerId)?.name || "" : "";
        const stageName =
          targetMoveStages.find((s) => s.id === d.stageId)?.name || "Etapa";
        const dateStr = new Date(d.createdAt).toLocaleDateString("pt-BR");
        const statusMap: Record<string, string> = {
          open: "Em andamento",
          won: "Vendido",
          lost: "Perdido",
          paused: "Pausado",
        };
        const statusLabel = statusMap[d.status] || d.status;

        return [
          `"${(d.title || "").replace(/"/g, '""')}"`,
          `"#${d.id.slice(-6)}"`,
          `"${clientName.replace(/"/g, '""')}"`,
          `"${opName.replace(/"/g, '""')}"`,
          `"${d.rating || 0}"`,
          `"${stageName.replace(/"/g, '""')}"`,
          `"${val}"`,
          `"${dateStr}"`,
          `"${statusLabel}"`,
        ].join(";");
      });

      const csvContent = "\uFEFF" + headers.join(";") + "\n" + rows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `negociacoes_exportadas_${new Date().toISOString().slice(0, 10)}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Exportação concluída! Planilha CSV baixada.");
      setIsExportSheetOpen(false);
    } catch (e: any) {
      console.error("[Export] Erro:", e);
      toast.error("Falha ao exportar dados.");
    }
  };

  // 8. AÇÃO: Exclusão (Lixeira vs Permanente)
  const handleDeleteTrash = async () => {
    const ok = await executeBulkRequest(
      { action: "delete_trash" },
      `${effectiveCount} negociação(ões) enviada(s) para a lixeira.`
    );
    if (ok) {
      setIsDeleteModalOpen(false);
      setDeleteCountInput("");
      setDeleteConfirmCheckbox(false);
      onClearSelection();
    }
  };

  const handleDeletePermanent = async () => {
    if (deleteCountInput.trim() !== String(effectiveCount)) {
      toast.error(`Digite exatamente "${effectiveCount}" para confirmar.`);
      return;
    }
    if (!deleteConfirmCheckbox) {
      toast.error("Marque a caixa de confirmação de exclusão.");
      return;
    }

    const ok = await executeBulkRequest(
      { action: "delete_permanent" },
      `${effectiveCount} negociação(ões) excluída(s) permanentemente.`
    );
    if (ok) {
      setIsDeleteModalOpen(false);
      setDeleteCountInput("");
      setDeleteConfirmCheckbox(false);
      onClearSelection();
    }
  };

  return (
    <>
      {/* ──────────────────────────────────────────────────────────────────────────
          BARRA DE AÇÕES EM MASSA ESCURA SUPERIOR (IDÊNTICA AO RD CRM / SCREENSHOTS)
          ────────────────────────────────────────────────────────────────────────── */}
      <div className="w-full bg-[#0a2333] dark:bg-[#071926] text-white px-4 py-2.5 flex items-center justify-between border-b border-border/40 select-none shadow-sm transition-all duration-200">
        {/* Esquerda: Contador & Link Limpar Seleção */}
        <div className="flex items-center gap-3">
          <span className="font-bold text-sm tracking-tight text-white whitespace-nowrap">
            {effectiveCount} selecionado{effectiveCount !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 dark:text-cyan-400 hover:underline cursor-pointer transition"
          >
            Limpar seleção
          </button>
        </div>

        {/* Direita: Menus de Ações */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* 1. Transferir (Popover com busca e lista de operadores) */}
          <Popover open={transferOpen} onOpenChange={setTransferOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-slate-200 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                Transferir
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-64 p-2 shadow-2xl rounded-xl border border-border bg-popover text-popover-foreground animate-in fade-in-50 zoom-in-95 duration-150"
            >
              <div className="relative mb-2">
                <Input
                  placeholder="Buscar"
                  value={transferSearch}
                  onChange={(e) => setTransferSearch(e.target.value)}
                  className="h-8 pl-8 text-xs bg-muted/40 border-border/60 rounded-lg focus-visible:ring-1 focus-visible:ring-cyan-500"
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
              <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase px-2 py-1">
                TRANSFERIR
              </div>
              <ScrollArea className="max-h-56">
                <div className="space-y-0.5">
                  {filteredOperators.length === 0 ? (
                    <div className="p-3 text-center text-xs text-muted-foreground">
                      Nenhum operador encontrado
                    </div>
                  ) : (
                    filteredOperators.map((op) => (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => handleExecuteTransfer(op.id, op.name)}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-accent text-xs font-medium text-foreground transition truncate cursor-pointer flex items-center justify-between"
                      >
                        <span className="truncate">{op.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          {/* 2. Alterar status (Popover com ícones) */}
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-slate-200 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                Alterar status
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-56 p-2 shadow-2xl rounded-xl border border-border bg-popover text-popover-foreground animate-in fade-in-50 zoom-in-95 duration-150"
            >
              <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase px-2 py-1">
                ALTERAR STATUS
              </div>
              <div className="space-y-0.5 pt-1">
                <button
                  type="button"
                  onClick={() => handleExecuteStatus("open")}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent text-xs font-semibold text-foreground transition cursor-pointer"
                >
                  <Activity className="h-4 w-4 text-sky-500 shrink-0" />
                  <span>Em andamento</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExecuteStatus("lost")}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent text-xs font-semibold text-foreground transition cursor-pointer"
                >
                  <ThumbsDown className="h-4 w-4 text-red-500 shrink-0" />
                  <span>Perdido</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExecuteStatus("paused")}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent text-xs font-semibold text-foreground transition cursor-pointer"
                >
                  <Pause className="h-4 w-4 text-amber-500 shrink-0" />
                  <span>Pausado</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExecuteStatus("won")}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent text-xs font-semibold text-foreground transition cursor-pointer"
                >
                  <ThumbsUp className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Vendido</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>

          {/* 3. Adicionar ou Alterar */}
          <Popover open={addOrChangeOpen} onOpenChange={setAddOrChangeOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-slate-200 hover:text-white hover:bg-white/10 transition cursor-pointer whitespace-nowrap"
              >
                Adicionar ou Alterar
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-56 p-2 shadow-2xl rounded-xl border border-border bg-popover text-popover-foreground animate-in fade-in-50 zoom-in-95 duration-150"
            >
              <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase px-2 py-1">
                ADICIONAR OU ALTERAR
              </div>
              <div className="space-y-0.5 pt-1">
                <button
                  type="button"
                  onClick={openRatingModal}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent text-xs font-medium text-foreground transition cursor-pointer"
                >
                  <Star className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span>Qualificação</span>
                </button>
                <button
                  type="button"
                  onClick={openCampaignModal}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent text-xs font-medium text-foreground transition cursor-pointer"
                >
                  <Tag className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span>Campanha</span>
                </button>
                <button
                  type="button"
                  onClick={openSourceModal}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent text-xs font-medium text-foreground transition cursor-pointer"
                >
                  <Compass className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                  <span>Fonte</span>
                </button>
                <button
                  type="button"
                  onClick={openProductModal}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent text-xs font-medium text-foreground transition cursor-pointer"
                >
                  <Package className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Produto ou Serviço</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>

          {/* 4. Criar */}
          <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-slate-200 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                Criar
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-60 p-2 shadow-2xl rounded-xl border border-border bg-popover text-popover-foreground animate-in fade-in-50 zoom-in-95 duration-150"
            >
              <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase px-2 py-1">
                CRIAR
              </div>
              <div className="space-y-0.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setIsCreateCompanyDealsOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent text-xs font-medium text-foreground transition cursor-pointer"
                >
                  <Building2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                  <span>Negociações para Empresas</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setIsCreateTaskModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent text-xs font-medium text-foreground transition cursor-pointer"
                >
                  <Calendar className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span>Tarefa</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>

          {/* 5. Mover (Sheet Lateral) */}
          <button
            type="button"
            onClick={() => setIsMoveSheetOpen(true)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-slate-200 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            Mover
          </button>

          {/* 6. Exportar (Sheet Lateral) */}
          <button
            type="button"
            onClick={() => setIsExportSheetOpen(true)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-slate-200 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            Exportar
          </button>

          {/* 7. Excluir (Modal de Confirmação com Contagem) */}
          <button
            type="button"
            onClick={() => {
              setDeleteCountInput("");
              setDeleteConfirmCheckbox(false);
              setIsDeleteModalOpen(true);
            }}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition cursor-pointer"
          >
            Excluir
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────
          SUB-BARRA DE SELEÇÃO GLOBAL DO FILTRO ("Selecionar todos os X itens")
          ────────────────────────────────────────────────────────────────────────── */}
      <div className="w-full bg-muted/40 dark:bg-muted/20 border-b border-border/40 px-4 py-1.5 flex items-center gap-2 text-xs text-muted-foreground select-none">
        <Checkbox
          checked={isAllFilterSelected}
          onCheckedChange={onToggleAllFilter}
          id="bulk-select-all-filter"
          className="data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500 rounded-sm"
        />
        <label
          htmlFor="bulk-select-all-filter"
          className="cursor-pointer font-medium text-foreground/80 hover:text-foreground"
        >
          Selecionar todos os {total} itens deste filtro
        </label>
        {isAllFilterSelected && (
          <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400 ml-1">
            (Todos os {total} itens selecionados)
          </span>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────
          DRAWER / SHEET 1: MOVER NEGOCIAÇÕES (SCREENSHOTS 7 & 8)
          ────────────────────────────────────────────────────────────────────────── */}
      <Sheet open={isMoveSheetOpen} onOpenChange={setIsMoveSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col justify-between">
          <div>
            <SheetHeader className="pb-4 border-b border-border">
              <SheetTitle className="text-base font-bold text-foreground">
                Mover negociações
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4 py-5">
              {/* Funil de vendas */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Funil de vendas <span className="text-rose-500">*</span>
                </Label>
                <Select
                  value={targetMovePipelineId}
                  onValueChange={(val) => {
                    setTargetMovePipelineId(val);
                    const pipe = pipelines.find((p) => p.id === val);
                    if (pipe && pipe.stages.length > 0) {
                      setTargetMoveStageId(pipe.stages[0].id);
                    } else {
                      setTargetMoveStageId("");
                    }
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Etapa do funil de vendas */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Etapa do funil de vendas <span className="text-rose-500">*</span>
                </Label>
                <Select
                  value={targetMoveStageId}
                  onValueChange={setTargetMoveStageId}
                  disabled={targetMoveStages.length === 0}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {targetMoveStages.map((stg) => (
                      <SelectItem key={stg.id} value={stg.id} className="text-xs">
                        {stg.name} {stg.isWinStage ? "(Ganho)" : ""}{" "}
                        {stg.isLossStage ? "(Perda)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <SheetFooter className="pt-4 border-t border-border flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsMoveSheetOpen(false)}
              className="text-xs cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleExecuteMove}
              disabled={loading || !targetMoveStageId}
              className="text-xs font-bold bg-[#0b3346] hover:bg-[#0e4058] text-cyan-300 dark:bg-cyan-600 dark:hover:bg-cyan-500 dark:text-white cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Movendo...
                </>
              ) : (
                "Mover negociações"
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ──────────────────────────────────────────────────────────────────────────
          DRAWER / SHEET 2: EXPORTAR DADOS (SCREENSHOT 9)
          ────────────────────────────────────────────────────────────────────────── */}
      <Sheet open={isExportSheetOpen} onOpenChange={setIsExportSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col justify-between">
          <div>
            <SheetHeader className="pb-4 border-b border-border">
              <SheetTitle className="text-base font-bold text-foreground">
                Exportar dados
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4 py-5">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Exportar dados de
                </Label>
                <Select value={exportDataType} onValueChange={setExportDataType}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deals" className="text-xs">
                      Negociações
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Formato do arquivo
                </Label>
                <Select value={exportFormat} onValueChange={setExportFormat}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv" className="text-xs">
                      Planilha CSV
                    </SelectItem>
                    <SelectItem value="xlsx" className="text-xs">
                      Planilha Excel (XLSX)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <SheetFooter className="pt-4 border-t border-border flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsExportSheetOpen(false)}
              className="text-xs cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleExecuteExport}
              className="text-xs font-bold bg-[#0b3346] hover:bg-[#0e4058] text-cyan-300 dark:bg-cyan-600 dark:hover:bg-cyan-500 dark:text-white cursor-pointer"
            >
              Exportar dados
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 1: CRIAÇÃO DE NEGOCIAÇÕES PARA EMPRESAS (SCREENSHOT 6)
          ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={isCreateCompanyDealsOpen} onOpenChange={setIsCreateCompanyDealsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Criação de Negociações
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 text-xs text-muted-foreground leading-relaxed">
            As{" "}
            <strong className="text-foreground">
              negociações selecionadas sem empresa vinculada
            </strong>{" "}
            não serão levadas em conta ao criar novas negociações. Quer seguir em frente e
            criar novas negociações mesmo assim?
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsCreateCompanyDealsOpen(false)}
              className="text-xs cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleExecuteCreateCompanyDeals}
              disabled={loading}
              className="text-xs font-bold bg-cyan-500 hover:bg-cyan-600 text-white cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Criando...
                </>
              ) : (
                "Continuar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 2: EXCLUSÃO DE NEGOCIAÇÕES (LIXEIRA VS PERMANENTE) (SCREENSHOT 10)
          ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Deseja excluir as negociações?
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1 text-xs">
            <p className="text-foreground">
              Você está excluindo{" "}
              <strong className="font-bold text-foreground">
                {effectiveCount} Negociações
              </strong>
              .
            </p>

            <p className="text-muted-foreground leading-relaxed">
              Escolha entre enviar para a lixeira ou excluir permanentemente da sua conta. Se
              optar por excluir, lembre-se que não será possível recuperar a informação.
            </p>

            <p className="text-muted-foreground">
              Preencha o campo abaixo com a quantidade de itens a serem excluídos para
              confirmar a exclusão.
            </p>

            <div className="space-y-1.5 pt-1">
              <Label className="text-xs font-bold text-foreground">
                Quantas negociações serão excluídas?
              </Label>
              <Input
                placeholder="Preencha para confirmar a ação"
                value={deleteCountInput}
                onChange={(e) => setDeleteCountInput(e.target.value)}
                className="h-8 text-xs bg-card"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                checked={deleteConfirmCheckbox}
                onCheckedChange={(val) => setDeleteConfirmCheckbox(Boolean(val))}
                id="delete-perm-checkbox"
                className="rounded-sm"
              />
              <label
                htmlFor="delete-perm-checkbox"
                className="text-xs text-muted-foreground select-none cursor-pointer"
              >
                Entendo que ao excluir não conseguirei recuperar a informação.
              </label>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <Button
              type="button"
              size="sm"
              onClick={handleDeleteTrash}
              disabled={loading}
              className="text-xs font-bold bg-cyan-500 hover:bg-cyan-600 text-white cursor-pointer"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                "Enviar para lixeira"
              )}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDeletePermanent}
              disabled={
                loading ||
                deleteCountInput.trim() !== String(effectiveCount) ||
                !deleteConfirmCheckbox
              }
              className="text-xs font-bold cursor-pointer disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                "Excluir permanentemente"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 3: MOTIVO DA PERDA (QUANDO STATUS FOR 'PERDIDO')
          ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={lossReasonModalOpen} onOpenChange={setLossReasonModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <ThumbsDown className="h-4 w-4 text-red-500" />
              <span>Marcar como Perdido</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <p className="text-muted-foreground">
              Você está alterando o status de{" "}
              <strong className="text-foreground">{effectiveCount} negociações</strong> para
              Perdido.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Motivo da Perda (Opcional)</Label>
              <Input
                placeholder="Ex: Preço elevado, sem orçamento, optou por concorrente..."
                value={lossReasonText}
                onChange={(e) => setLossReasonText(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLossReasonModalOpen(false)}
              className="text-xs cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmLossReason}
              disabled={loading}
              className="text-xs font-bold cursor-pointer"
            >
              Confirmar Perda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 4: QUALIFICAÇÃO (ESTRELAS)
          ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={ratingModalOpen} onOpenChange={setRatingModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-400" />
              <span>Alterar Qualificação em Massa</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-4 text-center space-y-3">
            <p className="text-xs text-muted-foreground">
              Selecione o nível de qualificação para as {effectiveCount} negociações:
            </p>
            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setSelectedRating(star)}
                  className="p-1.5 rounded-lg hover:bg-muted transition cursor-pointer"
                >
                  <Star
                    className={`h-6 w-6 transition ${
                      star <= selectedRating
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/30"
                    }`}
                  />
                </button>
              ))}
            </div>
            <p className="text-xs font-bold text-foreground">
              {selectedRating} estrela{selectedRating > 1 ? "s" : ""}
            </p>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRatingModalOpen(false)}
              className="text-xs cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveRating}
              disabled={loading}
              className="text-xs font-bold bg-primary text-primary-foreground cursor-pointer"
            >
              Salvar Qualificação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 5: CAMPANHA
          ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={campaignModalOpen} onOpenChange={setCampaignModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Tag className="h-4 w-4 text-blue-500" />
              <span>Definir Campanha</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-3 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Nome da Campanha</Label>
              <Input
                placeholder="Ex: Google Ads 2026, Black Friday..."
                value={campaignInput}
                onChange={(e) => setCampaignInput(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            {catalogCampaigns.length > 0 && (
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Ou selecione do catálogo:</span>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pt-1">
                  {catalogCampaigns.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCampaignInput(c.name)}
                      className="px-2 py-0.5 rounded-md bg-muted hover:bg-accent text-[11px] text-foreground transition cursor-pointer"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCampaignModalOpen(false)}
              className="text-xs cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveCampaign}
              disabled={loading}
              className="text-xs font-bold bg-primary text-primary-foreground cursor-pointer"
            >
              Salvar Campanha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 6: FONTE
          ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={sourceModalOpen} onOpenChange={setSourceModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Compass className="h-4 w-4 text-purple-500" />
              <span>Definir Fonte / Origem</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-3 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Nome da Fonte</Label>
              <Input
                placeholder="Ex: WhatsApp Orgânico, Indicação, Instagram..."
                value={sourceInput}
                onChange={(e) => setSourceInput(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            {catalogSources.length > 0 && (
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Ou selecione do catálogo:</span>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pt-1">
                  {catalogSources.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSourceInput(s.name)}
                      className="px-2 py-0.5 rounded-md bg-muted hover:bg-accent text-[11px] text-foreground transition cursor-pointer"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSourceModalOpen(false)}
              className="text-xs cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveSource}
              disabled={loading}
              className="text-xs font-bold bg-primary text-primary-foreground cursor-pointer"
            >
              Salvar Fonte
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 7: PRODUTO OU SERVIÇO
          ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={productModalOpen} onOpenChange={setProductModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Package className="h-4 w-4 text-emerald-500" />
              <span>Adicionar Produto ou Serviço</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-3 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Produto do Catálogo</Label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione um produto..." />
                </SelectTrigger>
                <SelectContent>
                  {catalogProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setProductModalOpen(false)}
              className="text-xs cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveProduct}
              disabled={loading || !selectedProductId}
              className="text-xs font-bold bg-primary text-primary-foreground cursor-pointer"
            >
              Adicionar Produto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 8: CRIAR TAREFA EM MASSA
          ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={isCreateTaskModalOpen} onOpenChange={setIsCreateTaskModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4 text-amber-500" />
              <span>Criar Tarefa para Negociações Selecionadas</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Título da Tarefa *</Label>
              <Input
                placeholder="Ex: Ligar para confirmar proposta, Enviar catálogo..."
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Tipo</Label>
                <Select value={taskType} onValueChange={setTaskType}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task" className="text-xs">
                      Tarefa
                    </SelectItem>
                    <SelectItem value="call" className="text-xs">
                      Ligação
                    </SelectItem>
                    <SelectItem value="meeting" className="text-xs">
                      Reunião
                    </SelectItem>
                    <SelectItem value="whatsapp" className="text-xs">
                      WhatsApp
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Data de Vencimento</Label>
                <Input
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Descrição / Observações</Label>
              <Input
                placeholder="Detalhes adicionais da tarefa..."
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsCreateTaskModalOpen(false)}
              className="text-xs cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleExecuteCreateTask}
              disabled={loading || !taskTitle.trim()}
              className="text-xs font-bold bg-primary text-primary-foreground cursor-pointer"
            >
              Criar Tarefas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
