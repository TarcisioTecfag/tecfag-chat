import React, { useState, useEffect } from "react";
import { X, Plus, Trash2, ArrowUp, ArrowDown, Settings2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { SystemTooltip } from "@/components/ui/tooltip";

interface StageItem {
  id: string;
  name: string;
  orderIndex: number;
  isWinStage?: boolean;
  isLossStage?: boolean;
}

interface PipelineItem {
  id: string;
  name: string;
  orderIndex: number;
  isDefault: boolean;
  color: string;
  coolingDays: number;
  stages: StageItem[];
}

interface PipelineSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPipelinesChanged: () => void;
  selectedPipelineId?: string;
}

export function PipelineSettingsModal({
  isOpen,
  onClose,
  onPipelinesChanged,
  selectedPipelineId,
}: PipelineSettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [pipelines, setPipelines] = useState<PipelineItem[]>([]);
  const [activePipeId, setActivePipeId] = useState<string>("");

  // Edição do Funil Ativo
  const [pipeName, setPipeName] = useState("");
  const [coolingDays, setCoolingDays] = useState(10);
  const [isDefault, setIsDefault] = useState(false);

  // Nova Etapa
  const [newStageName, setNewStageName] = useState("");
  const [newStageIsWin, setNewStageIsWin] = useState(false);
  const [newStageIsLoss, setNewStageIsLoss] = useState(false);

  // Criação de Novo Funil
  const [isCreatingNewPipe, setIsCreatingNewPipe] = useState(false);
  const [newPipeName, setNewPipeName] = useState("");

  const fetchPipelines = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/crm/pipelines");
      if (!res.ok) throw new Error("Erro ao carregar funis.");
      const data = await res.json();
      const list: PipelineItem[] = data.pipelines || [];
      setPipelines(list);
      if (list.length > 0) {
        const target = list.find((p) => p.id === activePipeId) || list.find((p) => p.id === selectedPipelineId) || list[0];
        setActivePipeId(target.id);
        setPipeName(target.name);
        setCoolingDays(target.coolingDays ?? 10);
        setIsDefault(target.isDefault ?? false);
      }
    } catch (err: any) {
      toast.error(err.message || "Falha ao listar funis.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchPipelines();
    }
  }, [isOpen]);

  const activePipe = pipelines.find((p) => p.id === activePipeId);

  // Salvar alterações no Funil
  const handleSavePipeline = async () => {
    if (!activePipeId) return;
    try {
      const res = await fetch(`/api/crm/pipelines/${activePipeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pipeName,
          coolingDays,
          isDefault,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao salvar funil.");
      }
      toast.success("Funil atualizado com sucesso!");
      fetchPipelines();
      onPipelinesChanged();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar funil.");
    }
  };

  // Excluir Funil
  const handleDeletePipeline = async () => {
    if (!activePipeId) return;
    if (!window.confirm("Deseja realmente excluir este funil? (Não pode conter negociações)")) return;
    try {
      const res = await fetch(`/api/crm/pipelines/${activePipeId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Não foi possível excluir o funil.");
      }
      toast.success("Funil excluído!");
      fetchPipelines();
      onPipelinesChanged();
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir funil.");
    }
  };

  // Criar Novo Funil
  const handleCreateNewPipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPipeName.trim()) return;
    try {
      const res = await fetch("/api/crm/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPipeName.trim(),
          coolingDays: 10,
          stages: [
            { name: "Primeiro Contato", orderIndex: 0 },
            { name: "Proposta", orderIndex: 1 },
            { name: "Vendido", orderIndex: 2, isWinStage: true },
            { name: "Perdido", orderIndex: 3, isLossStage: true },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao criar funil.");
      }
      toast.success("Novo funil criado!");
      setNewPipeName("");
      setIsCreatingNewPipe(false);
      fetchPipelines();
      onPipelinesChanged();
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar funil.");
    }
  };

  // Adicionar Nova Etapa
  const handleAddStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStageName.trim() || !activePipeId) return;
    try {
      const res = await fetch(`/api/crm/pipelines/${activePipeId}/stages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newStageName.trim(),
          isWinStage: newStageIsWin,
          isLossStage: newStageIsLoss,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao criar etapa.");
      }
      toast.success("Etapa adicionada!");
      setNewStageName("");
      setNewStageIsWin(false);
      setNewStageIsLoss(false);
      fetchPipelines();
      onPipelinesChanged();
    } catch (err: any) {
      toast.error(err.message || "Erro ao adicionar etapa.");
    }
  };

  // Atualizar Etapa Existente
  const handleUpdateStage = async (stageId: string, updates: Partial<StageItem>) => {
    try {
      const res = await fetch(`/api/crm/stages/${stageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao atualizar etapa.");
      }
      toast.success("Etapa atualizada!");
      fetchPipelines();
      onPipelinesChanged();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar etapa.");
    }
  };

  // Excluir Etapa
  const handleDeleteStage = async (stageId: string) => {
    if (!window.confirm("Deseja realmente remover esta etapa? (Não pode conter negociações)")) return;
    try {
      const res = await fetch(`/api/crm/stages/${stageId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Não foi possível excluir a etapa.");
      }
      toast.success("Etapa removida!");
      fetchPipelines();
      onPipelinesChanged();
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir etapa.");
    }
  };

  // Reordenar Etapa
  const handleMoveStage = async (stageId: string, direction: "up" | "down") => {
    if (!activePipe) return;
    const stages = [...activePipe.stages].sort((a, b) => a.orderIndex - b.orderIndex);
    const index = stages.findIndex((s) => s.id === stageId);
    if (index === -1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= stages.length) return;

    // Inverte posições
    const temp = stages[index];
    stages[index] = stages[targetIndex];
    stages[targetIndex] = temp;

    const stageOrders = stages.map((s, idx) => ({ id: s.id, orderIndex: idx }));
    try {
      const res = await fetch(`/api/crm/pipelines/${activePipe.id}/stages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageOrders }),
      });
      if (!res.ok) throw new Error("Erro ao reordenar etapas.");
      fetchPipelines();
      onPipelinesChanged();
    } catch (err: any) {
      toast.error(err.message || "Erro ao reordenar.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in">
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col h-[85vh] w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-bold text-foreground">Gestão de Funis e Etapas do CRM</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Corpo com Split: Funis à esquerda, Etapas à direita */}
        <div className="flex flex-1 overflow-hidden">
          {/* Coluna Esquerda: Lista de Funis */}
          <div className="w-1/3 border-r border-border/60 p-3 overflow-y-auto space-y-2 bg-muted/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-muted-foreground uppercase">Funis</span>
              <button
                type="button"
                onClick={() => setIsCreatingNewPipe(!isCreatingNewPipe)}
                className="text-[11px] font-bold text-primary hover:underline cursor-pointer flex items-center gap-1"
              >
                <Plus className="h-3 w-3" />
                Novo
              </button>
            </div>

            {isCreatingNewPipe && (
              <form onSubmit={handleCreateNewPipeline} className="mb-3 space-y-1.5 p-2 rounded-xl bg-card border border-border">
                <input
                  type="text"
                  placeholder="Nome do funil..."
                  value={newPipeName}
                  onChange={(e) => setNewPipeName(e.target.value)}
                  required
                  className="w-full text-xs rounded-lg border border-input p-1.5 bg-background"
                />
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setIsCreatingNewPipe(false)}
                    className="text-[10px] text-muted-foreground px-2 py-1"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="text-[10px] font-bold bg-primary text-primary-foreground px-2.5 py-1 rounded-lg"
                  >
                    Criar
                  </button>
                </div>
              </form>
            )}

            {pipelines.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActivePipeId(p.id);
                  setPipeName(p.name);
                  setCoolingDays(p.coolingDays ?? 10);
                  setIsDefault(p.isDefault ?? false);
                }}
                className={`w-full text-left p-2.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer flex items-center justify-between ${
                  p.id === activePipeId
                    ? "border-primary bg-primary/10 text-primary font-bold"
                    : "border-border/60 bg-card hover:bg-muted/30 text-foreground"
                }`}
              >
                <span className="truncate">{p.name}</span>
                {p.isDefault && (
                  <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded font-normal text-muted-foreground">
                    Padrão
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Coluna Direita: Detalhes do Funil e Gestão de Etapas */}
          <div className="flex-1 p-4 overflow-y-auto space-y-5">
            {activePipe ? (
              <>
                {/* Configurações Gerais do Funil */}
                <div className="space-y-3 p-3.5 rounded-xl border border-border/60 bg-muted/20">
                  <h3 className="text-xs font-bold text-foreground">Configurações do Funil</h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                        Nome do Funil
                      </label>
                      <input
                        type="text"
                        value={pipeName}
                        onChange={(e) => setPipeName(e.target.value)}
                        className="w-full rounded-lg border border-input bg-background p-1.5 text-xs text-foreground"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                        Alerta de Esfriamento (dias)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="90"
                        value={coolingDays}
                        onChange={(e) => setCoolingDays(Number(e.target.value))}
                        className="w-full rounded-lg border border-input bg-background p-1.5 text-xs text-foreground"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                      <Checkbox
                        checked={isDefault}
                        onCheckedChange={(checked) => setIsDefault(!!checked)}
                      />
                      <span>Definir como funil padrão do tenant</span>
                    </label>

                    <div className="flex items-center gap-2">
                      {pipelines.length > 1 && (
                        <button
                          type="button"
                          onClick={handleDeletePipeline}
                          className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded cursor-pointer"
                        >
                          Excluir Funil
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleSavePipeline}
                        className="text-xs font-bold bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:opacity-90 cursor-pointer"
                      >
                        Salvar Alterações
                      </button>
                    </div>
                  </div>
                </div>

                {/* Lista de Etapas do Funil */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-foreground">Etapas ({activePipe.stages.length})</h3>
                  </div>

                  <div className="space-y-2">
                    {activePipe.stages
                      .slice()
                      .sort((a, b) => a.orderIndex - b.orderIndex)
                      .map((stage, idx, arr) => (
                        <div
                          key={stage.id}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-border bg-card text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                              {idx + 1}
                            </span>
                            <input
                              type="text"
                              defaultValue={stage.name}
                              onBlur={(e) => {
                                if (e.target.value.trim() && e.target.value !== stage.name) {
                                  handleUpdateStage(stage.id, { name: e.target.value.trim() });
                                }
                              }}
                              className="font-semibold text-foreground bg-transparent border-b border-transparent hover:border-input focus:border-primary outline-none px-1 text-xs flex-1 truncate"
                            />

                            {stage.isWinStage && (
                              <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                Ganho
                              </span>
                            )}
                            {stage.isLossStage && (
                              <span className="text-[10px] font-bold bg-red-500/10 text-red-600 px-2 py-0.5 rounded-full border border-red-500/20">
                                Perda
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Flags terminais toggle */}
                            <SystemTooltip content="Marcar como etapa de fechamento/ganho">
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateStage(stage.id, {
                                    isWinStage: !stage.isWinStage,
                                    isLossStage: false,
                                  })
                                }
                                className={`p-1 rounded text-[10px] cursor-pointer ${
                                  stage.isWinStage ? "bg-emerald-600 text-white font-bold" : "text-muted-foreground hover:bg-muted"
                                }`}
                              >
                                🏆 Ganho
                              </button>
                            </SystemTooltip>
                            <SystemTooltip content="Marcar como etapa de perda">
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateStage(stage.id, {
                                    isLossStage: !stage.isLossStage,
                                    isWinStage: false,
                                  })
                                }
                                className={`p-1 rounded text-[10px] cursor-pointer ${
                                  stage.isLossStage ? "bg-red-600 text-white font-bold" : "text-muted-foreground hover:bg-muted"
                                }`}
                              >
                                ❌ Perda
                              </button>
                            </SystemTooltip>

                            {/* Reordenação */}
                            <SystemTooltip content="Mover para cima">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMoveStage(stage.id, "up")}
                                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                            </SystemTooltip>
                            <SystemTooltip content="Mover para baixo">
                              <button
                                type="button"
                                disabled={idx === arr.length - 1}
                                onClick={() => handleMoveStage(stage.id, "down")}
                                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                            </SystemTooltip>

                            {/* Excluir Etapa */}
                            <SystemTooltip content="Excluir etapa">
                              <button
                                type="button"
                                onClick={() => handleDeleteStage(stage.id)}
                                className="p-1 text-muted-foreground hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </SystemTooltip>
                          </div>
                        </div>
                      ))}
                  </div>

                  {/* Adicionar Nova Etapa */}
                  <form onSubmit={handleAddStage} className="flex items-center gap-2 pt-2">
                    <input
                      type="text"
                      placeholder="Nome da nova etapa..."
                      value={newStageName}
                      onChange={(e) => setNewStageName(e.target.value)}
                      required
                      className="flex-1 rounded-xl border border-input bg-background p-2 text-xs text-foreground"
                    />
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={newStageIsWin}
                        onCheckedChange={(checked) => {
                          const val = !!checked;
                          setNewStageIsWin(val);
                          if (val) setNewStageIsLoss(false);
                        }}
                      />
                      <span>Ganho</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={newStageIsLoss}
                        onCheckedChange={(checked) => {
                          const val = !!checked;
                          setNewStageIsLoss(val);
                          if (val) setNewStageIsWin(false);
                        }}
                      />
                      <span>Perda</span>
                    </label>
                    <button
                      type="submit"
                      className="flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Adicionar Etapa</span>
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Selecione ou crie um funil para gerenciar.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
