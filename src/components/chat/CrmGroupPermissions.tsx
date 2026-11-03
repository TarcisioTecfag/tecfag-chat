import React, { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Filter, Globe, Layers, Lock, CheckCircle2, Eye, EyeOff, ArrowRightLeft } from "lucide-react";
import type { CrmPermissions } from "@/lib/rbac";

type BooleanCrmPermissionKey = {
  [K in keyof CrmPermissions]: CrmPermissions[K] extends boolean | undefined ? K : never;
}[keyof CrmPermissions];

interface PipelineItem {
  id: string;
  name: string;
  color?: string | null;
  isDefault?: boolean;
  stages?: Array<{ id: string; name: string }>;
}

const controls = [
  ["canViewCrm", "Acessar negociações", "Consultar o CRM da empresa."],
  ["canViewAllDeals", "Consultar negociações de outros operadores", "Sem esta opção, a consulta é limitada ao responsável."],
  ["canCreateDeals", "Criar negociações", "Cadastrar uma nova oportunidade."],
  ["canEditDeals", "Editar informações da negociação", "Alterar os dados comerciais permitidos."],
  ["canMoveStages", "Mover etapas", "Movimentar oportunidades entre etapas."],
  ["canCloseDeals", "Fechar negociações", "Marcar como ganha ou perdida."],
  ["canManagePipelines", "Gerenciar funis e etapas", "Criar e configurar os funis da empresa."],
  ["canManageProducts", "Gerenciar catálogo de produtos", "Criar e alterar produtos do catálogo."],
  ["canManageProposals", "Gerenciar propostas", "Criar propostas e alterar seu status."],
  ["canDeleteDeals", "Excluir negociações", "Enviar à lixeira ou excluir permanentemente; editar não concede este direito."],
  ["canExportDeals", "Exportar negociações", "Exportar somente os registros que o operador pode consultar."],
] as const satisfies ReadonlyArray<readonly [BooleanCrmPermissionKey, string, string]>;

export function CrmGroupPermissions({
  permissions,
  search,
  onChange,
  onPatch,
}: {
  permissions: CrmPermissions;
  search: string;
  onChange: (key: keyof CrmPermissions, value: any) => void;
  onPatch?: (patch: Partial<CrmPermissions>) => void;
}) {
  const [pipelines, setPipelines] = useState<PipelineItem[]>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingPipelines(true);
    fetch("/api/crm/pipelines?forPermissions=true")
      .then((res) => (res.ok ? res.json() : { pipelines: [] }))
      .then((data) => {
        if (!active) return;
        setPipelines(Array.isArray(data?.pipelines) ? data.pipelines : []);
      })
      .catch(() => {
        if (active) setPipelines([]);
      })
      .finally(() => {
        if (active) setLoadingPipelines(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const applyPatch = (patch: Partial<CrmPermissions>) => {
    if (onPatch) {
      onPatch(patch);
      return;
    }
    const entries = Object.entries(patch) as Array<[keyof CrmPermissions, any]>;
    for (const [k, v] of entries) {
      onChange(k, v);
    }
  };

  const pipelineScope: "all" | "selected" =
    permissions.pipelineScope === "selected" ? "selected" : "all";
  const allowedPipelineIds = Array.isArray(permissions.allowedPipelineIds)
    ? permissions.allowedPipelineIds
    : [];
  const stageRestrictionEnabled = Boolean(permissions.stageRestrictionEnabled);
  const allowedStageIdsByPipeline: Record<string, string[]> =
    permissions.allowedStageIdsByPipeline &&
    typeof permissions.allowedStageIdsByPipeline === "object" &&
    !Array.isArray(permissions.allowedStageIdsByPipeline)
      ? permissions.allowedStageIdsByPipeline
      : {};
  const canSendToHidden = Boolean(permissions.canSendToHiddenStagesOrPipelines);

  const handleToggleStageRestrictionMaster = (enabled: boolean) => {
    applyPatch({
      stageRestrictionEnabled: enabled,
      ...(enabled && permissions.canSendToHiddenStagesOrPipelines === undefined
        ? { canSendToHiddenStagesOrPipelines: true }
        : {}),
    });
  };

  const handleTogglePipelineStageMode = (pipeline: PipelineItem, restrictStages: boolean) => {
    const nextMap = { ...allowedStageIdsByPipeline };
    if (!restrictStages) {
      delete nextMap[pipeline.id];
    } else {
      const allStageIds = (pipeline.stages || []).map((s) => s.id);
      nextMap[pipeline.id] = allStageIds;
    }
    applyPatch({
      stageRestrictionEnabled: true,
      allowedStageIdsByPipeline: nextMap,
    });
  };

  const handleToggleVisibleStage = (pipeline: PipelineItem, stageId: string) => {
    const allStageIds = (pipeline.stages || []).map((s) => s.id);
    const currentList = Object.hasOwn(allowedStageIdsByPipeline, pipeline.id)
      ? allowedStageIdsByPipeline[pipeline.id]
      : allStageIds;
    const set = new Set(currentList);
    if (set.has(stageId)) {
      set.delete(stageId);
    } else {
      set.add(stageId);
    }
    applyPatch({
      stageRestrictionEnabled: true,
      allowedStageIdsByPipeline: {
        ...allowedStageIdsByPipeline,
        [pipeline.id]: Array.from(set),
      },
    });
  };

  const handleScopeChange = (newScope: "all" | "selected") => {
    if (newScope === "all") {
      applyPatch({ pipelineScope: "all" });
    } else {
      // Se ainda não havia funis selecionados, pré-seleciona o primeiro funil para facilitar
      const initialIds =
        allowedPipelineIds.length > 0
          ? allowedPipelineIds
          : pipelines.length > 0
            ? [pipelines[0].id]
            : [];
      applyPatch({
        pipelineScope: "selected",
        allowedPipelineIds: initialIds,
      });
    }
  };

  const handleTogglePipeline = (pipelineId: string, checked: boolean) => {
    const currentSet = new Set(allowedPipelineIds);
    if (checked) {
      currentSet.add(pipelineId);
    } else {
      currentSet.delete(pipelineId);
    }
    applyPatch({
      pipelineScope: "selected",
      allowedPipelineIds: Array.from(currentSet),
    });
  };

  const handleSelectOnlyPipeline = (pipelineId: string) => {
    applyPatch({
      pipelineScope: "selected",
      allowedPipelineIds: [pipelineId],
    });
  };

  const handleSelectAllPipelines = () => {
    applyPatch({
      pipelineScope: "selected",
      allowedPipelineIds: pipelines.map((p) => p.id),
    });
  };

  const query = search.trim().toLocaleLowerCase("pt-BR");
  const matchesFunnelSearch =
    !query ||
    "funil funis visibilidade acesso específico selecionar".includes(query) ||
    pipelines.some((p) => p.name.toLocaleLowerCase("pt-BR").includes(query));
  const visible = controls.filter(([, label, description]) =>
    `${label} ${description}`.toLocaleLowerCase("pt-BR").includes(query)
  );
  if (!visible.length && !matchesFunnelSearch) return null;

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 bg-muted/20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-black uppercase tracking-wide text-foreground">
            Negociações e funis (CRM)
          </h3>
        </div>
        <span
          className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
            pipelineScope === "selected"
              ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
              : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
          }`}
        >
          {pipelineScope === "selected"
            ? allowedPipelineIds.length === 1
              ? "1 funil específico liberado"
              : `${allowedPipelineIds.length} funis liberados`
            : "Todos os funis liberados"}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Controle de Acesso por Funil */}
        {matchesFunnelSearch && (
          <div className="p-3.5 rounded-xl border border-border bg-muted/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-[11px] font-extrabold text-foreground flex items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5 text-primary" />
                  Controle de Acesso e Visibilidade por Funil
                </span>
                <span className="text-[10px] text-muted-foreground block">
                  Defina se os operadores deste grupo podem acessar todos os funis da empresa ou apenas funis específicos.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleScopeChange("all")}
                className={`flex items-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  pipelineScope === "all"
                    ? "bg-primary text-primary-foreground border-primary shadow-soft"
                    : "bg-card text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <div className="text-left">
                  <span className="block leading-tight">Todos os Funis da Empresa</span>
                  <span
                    className={`text-[9px] font-normal block ${
                      pipelineScope === "all" ? "text-primary-foreground/80" : "text-muted-foreground"
                    }`}
                  >
                    Visibilidade completa de todos os funis atuais e futuros
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleScopeChange("selected")}
                className={`flex items-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  pipelineScope === "selected"
                    ? "bg-primary text-primary-foreground border-primary shadow-soft"
                    : "bg-card text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <div className="text-left">
                  <span className="block leading-tight">Apenas Funis Selecionados</span>
                  <span
                    className={`text-[9px] font-normal block ${
                      pipelineScope === "selected" ? "text-primary-foreground/80" : "text-muted-foreground"
                    }`}
                  >
                    Restringe o operador a 1 funil específico ou lista escolhida
                  </span>
                </div>
              </button>
            </div>

            {pipelineScope === "selected" && (
              <div className="pt-2 border-t border-border/60 space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Selecione qual(is) funil(is) este grupo pode visualizar e operar:
                  </span>
                  {pipelines.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleSelectAllPipelines}
                        className="text-[10px] font-bold px-2 py-0.5 rounded bg-muted hover:bg-border text-foreground transition cursor-pointer"
                      >
                        Marcar todos ({pipelines.length})
                      </button>
                    </div>
                  )}
                </div>

                {loadingPipelines ? (
                  <div className="text-xs text-muted-foreground py-2">Carregando funis cadastrados...</div>
                ) : pipelines.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">
                    Nenhum funil cadastrado nesta empresa.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {pipelines.map((pipeline) => {
                      const isChecked = allowedPipelineIds.includes(pipeline.id);
                      const isOnlySelected =
                        allowedPipelineIds.length === 1 && allowedPipelineIds[0] === pipeline.id;

                      return (
                        <div
                          key={pipeline.id}
                          className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 transition ${
                            isChecked
                              ? "border-primary/50 bg-primary/5"
                              : "border-border bg-card opacity-75 hover:opacity-100"
                          }`}
                        >
                          <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={(val) =>
                                handleTogglePipeline(pipeline.id, val === true)
                              }
                            />
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: pipeline.color || "#0284c7" }}
                            />
                            <div className="min-w-0 flex-1">
                              <span className="text-xs font-bold text-foreground truncate block">
                                {pipeline.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground block">
                                {pipeline.stages?.length ?? 0} etapa(s)
                                {isOnlySelected ? " • Funil exclusivo deste grupo" : ""}
                              </span>
                            </div>
                          </label>

                          {!isOnlySelected ? (
                            <SystemTooltip content="Restringir grupo para usar apenas este funil">
                              <button
                                type="button"
                                onClick={() => handleSelectOnlyPipeline(pipeline.id)}
                                className="text-[10px] font-bold px-2 py-1 rounded-md border border-border bg-muted/60 hover:bg-primary hover:text-primary-foreground hover:border-primary transition shrink-0 cursor-pointer"
                              >
                                Apenas este
                              </button>
                            </SystemTooltip>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 px-2 py-1 rounded-md shrink-0">
                              <CheckCircle2 className="h-3 w-3" />
                              Exclusivo
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {allowedPipelineIds.length === 0 && (
                  <p className="text-[10px] font-semibold text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                    Atenção: Nenhum funil está selecionado. Os operadores deste grupo não verão nenhum funil no CRM até que ao menos um funil seja marcado.
                  </p>
                )}
              </div>
            )}

            {/* Visibilidade de Etapas por Funil + Transferência para Etapas/Funis Ocultos */}
            <div className="pt-3 border-t border-border/60 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[11px] font-extrabold text-foreground flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5 text-primary" />
                    Restringir Etapas Visíveis por Funil
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    Permite escolher quais etapas de cada funil este grupo enxerga no Kanban (podendo ser ligado/desligado sem perder a seleção).
                  </span>
                </div>
                <Switch
                  checked={stageRestrictionEnabled}
                  onCheckedChange={handleToggleStageRestrictionMaster}
                />
              </div>

              {stageRestrictionEnabled && (
                <div className="space-y-2.5 pt-1">
                  {(pipelineScope === "all"
                    ? pipelines
                    : pipelines.filter((p) => allowedPipelineIds.includes(p.id))
                  ).map((pipeline) => {
                    const stages = pipeline.stages || [];
                    const isStageRestricted = Object.hasOwn(allowedStageIdsByPipeline, pipeline.id);
                    const visibleStageIds = isStageRestricted
                      ? allowedStageIdsByPipeline[pipeline.id] || []
                      : stages.map((s) => s.id);

                    return (
                      <div
                        key={`stage-vis-${pipeline.id}`}
                        className="rounded-xl border border-border bg-card p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: pipeline.color || "#0284c7" }}
                            />
                            <span className="text-xs font-bold text-foreground">
                              {pipeline.name}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              ({visibleStageIds.length}/{stages.length} etapas visíveis)
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleTogglePipelineStageMode(pipeline, false)}
                              className={`text-[10px] font-bold px-2 py-1 rounded-md border transition cursor-pointer ${
                                !isStageRestricted
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/50 text-muted-foreground border-border hover:text-foreground"
                              }`}
                            >
                              Todas as etapas
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTogglePipelineStageMode(pipeline, true)}
                              className={`text-[10px] font-bold px-2 py-1 rounded-md border transition cursor-pointer ${
                                isStageRestricted
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/50 text-muted-foreground border-border hover:text-foreground"
                              }`}
                            >
                              Escolher etapas
                            </button>
                          </div>
                        </div>

                        {isStageRestricted && stages.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {stages.map((stage) => {
                              const checked = visibleStageIds.includes(stage.id);
                              return (
                                <button
                                  key={stage.id}
                                  type="button"
                                  onClick={() => handleToggleVisibleStage(pipeline, stage.id)}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                                    checked
                                      ? "border-primary/50 bg-primary/10 text-primary"
                                      : "border-border bg-muted/40 text-muted-foreground opacity-70 hover:opacity-100"
                                  }`}
                                >
                                  {checked ? (
                                    <Eye className="h-3 w-3 shrink-0" />
                                  ) : (
                                    <EyeOff className="h-3 w-3 shrink-0" />
                                  )}
                                  <span>{stage.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {(stageRestrictionEnabled || pipelineScope === "selected") && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                      <ArrowRightLeft className="h-3.5 w-3.5 text-primary shrink-0" />
                      Permitir enviar negociações para etapas ou funis ocultos
                    </span>
                    <span className="text-[10px] text-muted-foreground block leading-relaxed">
                      O operador poderá transferir um card para uma etapa ou funil que ele não enxerga. O sistema exibirá um aviso de confirmação e exigirá a escolha de outro responsável caso ele seja o dono atual.
                    </span>
                  </div>
                  <Switch
                    checked={canSendToHidden}
                    onCheckedChange={(val) =>
                      applyPatch({ canSendToHiddenStagesOrPipelines: val === true })
                    }
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Permissões de Ações no CRM */}
        {visible.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {visible.map(([key, label, description]) => (
              <label
                key={key}
                className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 cursor-pointer"
              >
                <Checkbox
                  checked={permissions[key] === true}
                  onCheckedChange={(value) => onChange(key, value === true)}
                />
                <span>
                  <span className="text-xs font-bold block">{label}</span>
                  <span className="text-[10px] text-muted-foreground block">{description}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

