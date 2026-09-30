import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreVertical,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCustomFields } from "./CustomFieldsEditor";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StageItem {
  id: string;
  name: string;
  orderIndex: number;
  isWinStage: boolean;
  isLossStage: boolean;
  requiredFields: string[];
}

interface PipelineItem {
  id: string;
  name: string;
  orderIndex: number;
  isDefault: boolean;
  coolingDays: number;
  stages: StageItem[];
}

interface StageSettings {
  stageId: string;
  abbreviation: string | null;
  objective: string | null;
  description: string | null;
  coolingEnabled: boolean;
  coolingDays: number;
}

interface StageDraft {
  id: string;
  pipelineId: string;
  name: string;
  abbreviation: string;
  objective: string;
  description: string;
  coolingEnabled: boolean;
  coolingDays: number;
  isWinStage: boolean;
  isLossStage: boolean;
  requiredFields: string[];
}

interface PipelineDraft {
  id: string | null;
  name: string;
  coolingDays: number;
  isDefault: boolean;
}

interface PipelineSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPipelinesChanged: () => void;
  selectedPipelineId?: string;
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
  return data;
}

function jsonRequest(method: string, body: object): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function PipelineSettingsModal({
  isOpen,
  onClose,
  onPipelinesChanged,
}: PipelineSettingsModalProps) {
  const [pipelines, setPipelines] = useState<PipelineItem[]>([]);
  const [settingsByStage, setSettingsByStage] = useState<Record<string, StageSettings>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pipelineDraft, setPipelineDraft] = useState<PipelineDraft | null>(null);
  const [stageDraft, setStageDraft] = useState<StageDraft | null>(null);
  const { fields: dealCustomFields } = useCustomFields("deal", isOpen);
  const [addingStageTo, setAddingStageTo] = useState<string | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [selectedStages, setSelectedStages] = useState<string[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [pipelineData, settingsData] = await Promise.all([
        requestJson("/api/crm/pipelines"),
        requestJson("/api/crm/stage-settings").catch(() => ({ settings: [] })),
      ]);
      const nextPipelines: PipelineItem[] = pipelineData.pipelines || [];
      setPipelines(nextPipelines);
      const visibleStageIds = new Set(
        nextPipelines.flatMap((pipeline) => pipeline.stages.map((stage) => stage.id)),
      );
      setSelectedStages((current) => current.filter((id) => visibleStageIds.has(id)));
      setSettingsByStage(
        Object.fromEntries(
          (settingsData.settings || []).map((item: StageSettings) => [item.stageId, item]),
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar funis.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void reload();
  }, [isOpen, reload]);

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(successMessage);
      await reload();
      onPipelinesChanged();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openStage = (pipeline: PipelineItem, stage: StageItem) => {
    const settings = settingsByStage[stage.id];
    setStageDraft({
      id: stage.id,
      pipelineId: pipeline.id,
      name: stage.name,
      abbreviation: settings?.abbreviation || "",
      objective: settings?.objective || "",
      description: settings?.description || "",
      coolingEnabled: settings?.coolingEnabled ?? true,
      coolingDays: settings?.coolingDays ?? pipeline.coolingDays,
      isWinStage: stage.isWinStage,
      isLossStage: stage.isLossStage,
      requiredFields: stage.requiredFields || [],
    });
  };

  const savePipeline = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pipelineDraft?.name.trim()) return;
    const draft = pipelineDraft;
    const success = await run(
      () =>
        draft.id
          ? requestJson(
              `/api/crm/pipelines/${draft.id}`,
              jsonRequest("PATCH", {
                name: draft.name.trim(),
                coolingDays: draft.coolingDays,
                isDefault: draft.isDefault,
              }),
            )
          : requestJson(
              "/api/crm/pipelines",
              jsonRequest("POST", {
                name: draft.name.trim(),
                orderIndex: pipelines.length,
                isDefault: pipelines.length === 0,
                coolingDays: draft.coolingDays,
                stages: [],
              }),
            ),
      draft.id ? "Funil atualizado." : "Funil criado. Adicione a primeira etapa.",
    );
    if (success) setPipelineDraft(null);
  };

  const saveStage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stageDraft?.name.trim()) return;
    const draft = stageDraft;
    const success = await run(async () => {
      await requestJson(
        "/api/crm/stage-settings",
        jsonRequest("PUT", {
          stageId: draft.id,
          abbreviation: draft.abbreviation,
          objective: draft.objective,
          description: draft.description,
          coolingEnabled: draft.coolingEnabled,
          coolingDays: draft.coolingDays,
        }),
      );
      await requestJson(
        `/api/crm/stages/${draft.id}`,
        jsonRequest("PATCH", {
          name: draft.name.trim(),
          isWinStage: draft.isWinStage,
          isLossStage: draft.isLossStage,
          requiredFields: draft.requiredFields,
        }),
      );
    }, "Etapa atualizada.");
    if (success) setStageDraft(null);
  };

  const addStage = async (event: React.FormEvent, pipelineId: string) => {
    event.preventDefault();
    if (!newStageName.trim()) return;
    const success = await run(
      () =>
        requestJson(
          `/api/crm/pipelines/${pipelineId}/stages`,
          jsonRequest("POST", { name: newStageName.trim() }),
        ),
      "Etapa adicionada.",
    );
    if (success) {
      setAddingStageTo(null);
      setNewStageName("");
    }
  };

  const moveStage = async (pipeline: PipelineItem, stageId: string, direction: -1 | 1) => {
    const ordered = [...pipeline.stages].sort((a, b) => a.orderIndex - b.orderIndex);
    const index = ordered.findIndex((stage) => stage.id === stageId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
    await run(
      () =>
        requestJson(
          `/api/crm/pipelines/${pipeline.id}/stages`,
          jsonRequest("PATCH", {
            stageOrders: ordered.map((stage, orderIndex) => ({ id: stage.id, orderIndex })),
          }),
        ),
      "Ordem das etapas atualizada.",
    );
  };

  const toggleCooling = async (pipeline: PipelineItem, stage: StageItem, enabled: boolean) => {
    const current = settingsByStage[stage.id];
    await run(
      () =>
        requestJson(
          "/api/crm/stage-settings",
          jsonRequest("PUT", {
            stageId: stage.id,
            abbreviation: current?.abbreviation || "",
            objective: current?.objective || "",
            description: current?.description || "",
            coolingEnabled: enabled,
            coolingDays: current?.coolingDays ?? pipeline.coolingDays,
          }),
        ),
      enabled ? "Alerta de esfriamento ativado." : "Alerta de esfriamento desativado.",
    );
  };

  const updateCoolingDays = async (pipeline: PipelineItem, stage: StageItem, days: number) => {
    const current = settingsByStage[stage.id];
    if (days === (current?.coolingDays ?? pipeline.coolingDays)) return;
    await run(
      () =>
        requestJson(
          "/api/crm/stage-settings",
          jsonRequest("PUT", {
            stageId: stage.id,
            abbreviation: current?.abbreviation || "",
            objective: current?.objective || "",
            description: current?.description || "",
            coolingEnabled: current?.coolingEnabled ?? true,
            coolingDays: days,
          }),
        ),
      "Prazo de esfriamento atualizado.",
    );
  };

  const deletePipeline = async (pipeline: PipelineItem) => {
    if (
      !window.confirm(
        `Excluir o funil “${pipeline.name}”? Só é possível excluir funis sem negociações.`,
      )
    )
      return;
    await run(
      () => requestJson(`/api/crm/pipelines/${pipeline.id}`, { method: "DELETE" }),
      "Funil excluído.",
    );
  };

  const deleteSelectedStages = async () => {
    if (
      !selectedStages.length ||
      !window.confirm(
        `Excluir ${selectedStages.length} etapa(s) selecionada(s)? Etapas com negociações serão preservadas.`,
      )
    )
      return;
    setBusy(true);
    const failures: string[] = [];
    for (const stageId of selectedStages) {
      try {
        await requestJson(`/api/crm/stages/${stageId}`, { method: "DELETE" });
      } catch (error) {
        const stage = pipelines
          .flatMap((pipeline) => pipeline.stages)
          .find((item) => item.id === stageId);
        failures.push(
          `${stage?.name || stageId}: ${error instanceof Error ? error.message : "falha"}`,
        );
      }
    }
    setSelectedStages([]);
    await reload();
    onPipelinesChanged();
    setBusy(false);
    if (failures.length) toast.error(failures.join(" | "));
    else toast.success("Etapas selecionadas excluídas.");
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label="Funis de vendas"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Voltar ao CRM"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-bold">Funis de vendas</h1>
            <p className="text-xs text-muted-foreground">Configurações do CRM</p>
          </div>
        </div>
        {selectedStages.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={deleteSelectedStages}
            className="inline-flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> Excluir {selectedStages.length} etapa(s) selecionada(s)
          </button>
        )}
      </header>

      <main className="flex-1 overflow-y-auto px-5 pb-12 pt-5">
        {loading && pipelines.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando funis...
          </div>
        ) : pipelines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <p className="font-semibold">Nenhum funil cadastrado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie um funil para começar a organizar as negociações.
            </p>
          </div>
        ) : (
          pipelines.map((pipeline) => {
            const stages = [...pipeline.stages].sort((a, b) => a.orderIndex - b.orderIndex);
            return (
              <section key={pipeline.id} className="mb-9 border-b border-border pb-8">
                <div className="mb-6 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold uppercase tracking-wide">{pipeline.name}</h2>
                    {pipeline.isDefault && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                        Padrão
                      </span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Opções do funil ${pipeline.name}`}
                          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onSelect={() =>
                            setPipelineDraft({
                              id: pipeline.id,
                              name: pipeline.name,
                              coolingDays: pipeline.coolingDays,
                              isDefault: pipeline.isDefault,
                            })
                          }
                        >
                          <Settings2 /> Configurar funil
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => void deletePipeline(pipeline)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 /> Excluir funil
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {stages.length} {stages.length === 1 ? "etapa" : "etapas"}
                  </span>
                </div>

                <div className="overflow-x-auto pb-3 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
                  <div className="relative flex min-w-max gap-3 pt-2 before:absolute before:left-3 before:right-3 before:top-3 before:h-0.5 before:bg-primary/70">
                    {stages.map((stage, index) => {
                      const settings = settingsByStage[stage.id];
                      const coolingEnabled = settings?.coolingEnabled ?? true;
                      const coolingDays = settings?.coolingDays ?? pipeline.coolingDays;
                      return (
                        <div key={stage.id} className="relative w-52 shrink-0 pt-9">
                          <span className="absolute left-1 top-0 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-background">
                            <span className="h-2 w-2 rounded-full bg-primary" />
                          </span>
                          <div className="mb-3 flex min-h-11 items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="break-words text-xs font-bold uppercase">
                                {stage.name}
                              </h3>
                              {settings?.abbreviation && (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  Sigla: {settings.abbreviation}
                                </p>
                              )}
                              {(stage.isWinStage || stage.isLossStage) && (
                                <p className="mt-1 text-[10px] font-semibold text-primary">
                                  {stage.isWinStage ? "Etapa de ganho" : "Etapa de perda"}
                                </p>
                              )}
                            </div>
                            <Checkbox
                              checked={selectedStages.includes(stage.id)}
                              onCheckedChange={(checked) =>
                                setSelectedStages((current) =>
                                  checked
                                    ? [...current, stage.id]
                                    : current.filter((id) => id !== stage.id),
                                )
                              }
                              aria-label={`Selecionar etapa ${stage.name}`}
                            />
                          </div>
                          <div className="flex items-start justify-between gap-2 border-t border-border/60 pt-3">
                            <span className="text-[11px] font-semibold leading-4">
                              Destacar negociações esfriando na etapa
                            </span>
                            <Switch
                              checked={coolingEnabled}
                              disabled={busy}
                              onCheckedChange={(checked) =>
                                void toggleCooling(pipeline, stage, checked)
                              }
                              aria-label={`Alerta de esfriamento em ${stage.name}`}
                            />
                          </div>
                          {coolingEnabled && (
                            <label className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                              Após
                              <input
                                key={`${stage.id}-${coolingDays}`}
                                type="number"
                                min={1}
                                max={365}
                                defaultValue={coolingDays}
                                aria-label={`Dias para esfriamento em ${stage.name}`}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") event.currentTarget.blur();
                                }}
                                onBlur={(event) => {
                                  const days = Number(event.currentTarget.value);
                                  if (!Number.isInteger(days) || days < 1 || days > 365) {
                                    event.currentTarget.value = String(coolingDays);
                                    toast.error("Informe entre 1 e 365 dias.");
                                  } else if (days !== coolingDays) {
                                    void updateCoolingDays(pipeline, stage, days);
                                  }
                                }}
                                className="h-7 w-12 rounded-md border border-border bg-background px-1 text-center text-foreground"
                              />
                              {coolingDays === 1 ? "dia" : "dias"} sem interação
                            </label>
                          )}
                          <button
                            type="button"
                            onClick={() => openStage(pipeline, stage)}
                            className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                          >
                            <Settings2 className="h-3.5 w-3.5" /> Configurar etapa
                          </button>
                          <div className="mt-3 flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busy || index === 0}
                              onClick={() => void moveStage(pipeline, stage.id, -1)}
                              aria-label={`Mover ${stage.name} para a esquerda`}
                              className="rounded-md border border-border p-1 text-muted-foreground hover:text-primary disabled:opacity-30"
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busy || index === stages.length - 1}
                              onClick={() => void moveStage(pipeline, stage.id, 1)}
                              aria-label={`Mover ${stage.name} para a direita`}
                              className="rounded-md border border-border p-1 text-muted-foreground hover:text-primary disabled:opacity-30"
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="relative w-52 shrink-0 pt-9">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setAddingStageTo(pipeline.id);
                          setNewStageName("");
                        }}
                        aria-label={`Adicionar etapa ao funil ${pipeline.name}`}
                        className="absolute left-1 top-0 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:opacity-90"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      {addingStageTo === pipeline.id ? (
                        <form
                          onSubmit={(event) => void addStage(event, pipeline.id)}
                          className="flex items-center gap-1 rounded-lg border border-border bg-card p-2"
                        >
                          <input
                            autoFocus
                            value={newStageName}
                            onChange={(event) => setNewStageName(event.target.value)}
                            maxLength={120}
                            placeholder="Nova etapa"
                            aria-label="Nome da nova etapa"
                            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                          />
                          <button
                            type="button"
                            aria-label="Cancelar"
                            onClick={() => setAddingStageTo(null)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <button
                            type="submit"
                            disabled={!newStageName.trim() || busy}
                            aria-label="Salvar etapa"
                            className="text-primary disabled:opacity-40"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </form>
                      ) : (
                        <p className="text-xs font-semibold text-muted-foreground">
                          Adicionar etapa
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            );
          })
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setPipelineDraft({ id: null, name: "", coolingDays: 10, isDefault: false })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Adicionar funil de vendas
        </button>
      </main>

      <Dialog
        open={pipelineDraft !== null}
        onOpenChange={(open) => !open && setPipelineDraft(null)}
      >
        <DialogContent className="max-w-md bg-card">
          <DialogHeader>
            <DialogTitle>
              {pipelineDraft?.id ? "Configurar funil" : "Adicionar funil de vendas"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={(event) => void savePipeline(event)} className="space-y-4 text-xs">
            <label className="block space-y-1.5 font-semibold">
              Nome do funil
              <input
                autoFocus
                required
                maxLength={120}
                value={pipelineDraft?.name || ""}
                onChange={(event) =>
                  setPipelineDraft((current) => current && { ...current, name: event.target.value })
                }
                className="h-9 w-full rounded-lg border border-input bg-background px-3 font-normal"
              />
            </label>
            <label className="block space-y-1.5 font-semibold">
              Alerta padrão de esfriamento (dias)
              <input
                type="number"
                min={1}
                max={365}
                value={pipelineDraft?.coolingDays ?? 10}
                onChange={(event) =>
                  setPipelineDraft(
                    (current) => current && { ...current, coolingDays: Number(event.target.value) },
                  )
                }
                className="h-9 w-full rounded-lg border border-input bg-background px-3 font-normal"
              />
            </label>
            {pipelineDraft?.id && (
              <label className="flex items-center gap-2 font-semibold">
                <Checkbox
                  checked={pipelineDraft.isDefault}
                  onCheckedChange={(checked) =>
                    setPipelineDraft((current) => current && { ...current, isDefault: !!checked })
                  }
                />{" "}
                Funil padrão
              </label>
            )}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setPipelineDraft(null)}
                className="rounded-lg px-3 py-2 text-muted-foreground"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || !pipelineDraft?.name.trim()}
                className="rounded-lg bg-primary px-3 py-2 font-bold text-primary-foreground disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={stageDraft !== null} onOpenChange={(open) => !open && setStageDraft(null)}>
        <SheetContent
          side="right"
          className="grid w-full max-w-[440px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-card p-0 sm:max-w-[440px]"
        >
          <SheetHeader className="border-b border-border px-5 py-5">
            <SheetTitle className="text-base">Configuração da etapa</SheetTitle>
          </SheetHeader>
          {stageDraft && (
            <form onSubmit={(event) => void saveStage(event)} className="flex min-h-0 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 text-xs">
                <label className="block space-y-1.5 font-semibold">
                  Nome da etapa *
                  <input
                    required
                    maxLength={120}
                    value={stageDraft.name}
                    onChange={(event) =>
                      setStageDraft(
                        (current) => current && { ...current, name: event.target.value },
                      )
                    }
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 font-normal"
                  />
                </label>
                <label className="block space-y-1.5 font-semibold">
                  Sigla
                  <input
                    maxLength={12}
                    value={stageDraft.abbreviation}
                    onChange={(event) =>
                      setStageDraft(
                        (current) => current && { ...current, abbreviation: event.target.value },
                      )
                    }
                    placeholder="Ex.: QLF"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 font-normal"
                  />
                </label>
                <label className="block space-y-1.5 font-semibold">
                  Objetivo da etapa
                  <textarea
                    maxLength={200}
                    rows={3}
                    value={stageDraft.objective}
                    onChange={(event) =>
                      setStageDraft(
                        (current) => current && { ...current, objective: event.target.value },
                      )
                    }
                    placeholder="O que você quer alcançar nesta etapa?"
                    className="w-full resize-y rounded-lg border border-input bg-background p-3 font-normal"
                  />
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    Até 200 caracteres.
                  </span>
                </label>
                <label className="block space-y-1.5 font-semibold">
                  Descrição da etapa
                  <textarea
                    maxLength={1500}
                    rows={6}
                    value={stageDraft.description}
                    onChange={(event) =>
                      setStageDraft(
                        (current) => current && { ...current, description: event.target.value },
                      )
                    }
                    placeholder="Orientações para o time de vendas nesta etapa"
                    className="w-full resize-y rounded-lg border border-input bg-background p-3 font-normal"
                  />
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    Até 1.500 caracteres.
                  </span>
                </label>
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <label className="flex items-center justify-between gap-3 font-semibold">
                    <span>Destacar negociações esfriando</span>
                    <Switch
                      checked={stageDraft.coolingEnabled}
                      onCheckedChange={(checked) =>
                        setStageDraft(
                          (current) => current && { ...current, coolingEnabled: checked },
                        )
                      }
                    />
                  </label>
                  {stageDraft.coolingEnabled && (
                    <label className="block space-y-1.5 font-semibold">
                      Dias sem interação
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={stageDraft.coolingDays}
                        onChange={(event) =>
                          setStageDraft(
                            (current) =>
                              current && { ...current, coolingDays: Number(event.target.value) },
                          )
                        }
                        className="h-9 w-full rounded-lg border border-input bg-background px-3 font-normal"
                      />
                    </label>
                  )}
                </div>
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <p className="font-semibold">Campos exigidos para entrar nesta etapa</p>
                  <p className="text-[11px] text-muted-foreground">Ao mover uma negociação, os campos selecionados devem estar preenchidos.</p>
                  {dealCustomFields.filter((field) => field.allPipelines || field.pipelineIds.includes(stageDraft.pipelineId)).map((field) => (
                    <label key={field.id} className="flex items-center gap-2">
                      <Checkbox checked={stageDraft.requiredFields.includes(field.id)}
                        onCheckedChange={(checked) => setStageDraft((current) => current && ({
                          ...current, requiredFields: checked
                            ? [...current.requiredFields, field.id]
                            : current.requiredFields.filter((id) => id !== field.id),
                        }))} /> {field.name}
                    </label>
                  ))}
                  {dealCustomFields.length === 0 && <p className="text-[11px] text-muted-foreground">Crie campos personalizados em Configurar campos de cadastro.</p>}
                </div>
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <p className="font-semibold">Resultado da etapa</p>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={stageDraft.isWinStage}
                      onCheckedChange={(checked) =>
                        setStageDraft(
                          (current) =>
                            current && {
                              ...current,
                              isWinStage: !!checked,
                              isLossStage: checked ? false : current.isLossStage,
                            },
                        )
                      }
                    />{" "}
                    Etapa de ganho
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={stageDraft.isLossStage}
                      onCheckedChange={(checked) =>
                        setStageDraft(
                          (current) =>
                            current && {
                              ...current,
                              isLossStage: !!checked,
                              isWinStage: checked ? false : current.isWinStage,
                            },
                        )
                      }
                    />{" "}
                    Etapa de perda
                  </label>
                </div>
              </div>
              <SheetFooter className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                <button
                  type="button"
                  onClick={() => setStageDraft(null)}
                  className="rounded-lg bg-primary/10 px-3 py-2 font-semibold text-primary"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    !stageDraft.name.trim() ||
                    stageDraft.coolingDays < 1 ||
                    stageDraft.coolingDays > 365
                  }
                  className="rounded-lg bg-primary px-3 py-2 font-bold text-primary-foreground disabled:opacity-50"
                >
                  Salvar
                </button>
              </SheetFooter>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
