import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  UserCheck,
  Sparkles,
  Building2,
  Kanban,
  Layers,
  User,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";
import type { SdrTriageSession } from "./SdrTab";

export interface ApprovalOptionsPayload {
  sectors: Array<{ id: string; name: string; operatorIds: string[] }>;
  operators: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    avatar: string | null;
    funnels: string[];
    isParticipating: boolean;
    isOnLeave: boolean;
    leadsReceivedCount: number;
    compensation: number;
    activeChatsNow: number;
  }>;
  pipelines: Array<{ id: string; name: string; color?: string | null }>;
  stages: Array<{ id: string; name: string; pipelineId: string; orderIndex: number }>;
  destinations: Record<
    string,
    {
      key: string;
      label: string;
      sectorId: string | null;
      pipelineId: string | null;
      stageId: string | null;
    }
  >;
}

const optionsCacheByTenant = new Map<string, { data: ApprovalOptionsPayload; fetchedAt: number }>();
const OPTIONS_CACHE_TTL_MS = 60_000;

export interface IndustrialApprovalPanelProps {
  tenantId: string;
  personaName: string;
  session: SdrTriageSession;
  onActionCompleted: (kind: "approved" | "dismissed" | "assumed", conversationId: string) => void;
  className?: string;
}

export function IndustrialApprovalPanel({
  tenantId,
  personaName,
  session,
  onActionCompleted,
  className,
}: IndustrialApprovalPanelProps) {
  const isAwaitingApproval =
    session.status === "awaiting_approval" || session.monitoring?.state === "awaiting_approval";
  const isAlreadyDone =
    session.status === "completed" ||
    session.status === "manual" ||
    session.monitoring?.state === "transferred" ||
    session.monitoring?.state === "closed";

  const [expanded, setExpanded] = useState(isAwaitingApproval);
  const [options, setOptions] = useState<ApprovalOptionsPayload | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const pending = session.pendingApproval || session.monitoring?.pendingApproval || null;

  const [sectorId, setSectorId] = useState<string>(pending?.suggestedSectorId || "");
  const [operatorId, setOperatorId] = useState<string>(pending?.suggestedOperatorId || "");
  const [pipelineId, setPipelineId] = useState<string>(pending?.suggestedPipelineId || "");
  const [stageId, setStageId] = useState<string>(pending?.suggestedStageId || "");

  const [showDismissBox, setShowDismissBox] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  const [dismissFinishConv, setDismissFinishConv] = useState(true);
  const [dismissDealAction, setDismissDealAction] = useState<"keep" | "mark_lost">("mark_lost");

  const [submittingAction, setSubmittingAction] = useState<"approve" | "dismiss" | "assume" | null>(
    null,
  );

  useEffect(() => {
    setExpanded(isAwaitingApproval);
    setShowDismissBox(false);
    setDismissReason("");
  }, [session.conversationId, isAwaitingApproval]);

  useEffect(() => {
    setSectorId(pending?.suggestedSectorId || "");
    setOperatorId(pending?.suggestedOperatorId || "");
    setPipelineId(pending?.suggestedPipelineId || "");
    setStageId(pending?.suggestedStageId || "");
  }, [
    session.conversationId,
    pending?.suggestedSectorId,
    pending?.suggestedOperatorId,
    pending?.suggestedPipelineId,
    pending?.suggestedStageId,
  ]);

  useEffect(() => {
    if (isAlreadyDone || (!expanded && !isAwaitingApproval)) return;
    const cached = optionsCacheByTenant.get(tenantId);
    if (cached && Date.now() - cached.fetchedAt < OPTIONS_CACHE_TTL_MS) {
      setOptions(cached.data);
      return;
    }

    let cancelled = false;
    setLoadingOptions(true);
    fetch("/api/valentina/triage-approval", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ApprovalOptionsPayload | null) => {
        if (cancelled || !data) return;
        optionsCacheByTenant.set(tenantId, { data, fetchedAt: Date.now() });
        setOptions(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, expanded, isAwaitingApproval, isAlreadyDone]);

  const stagesForSelectedPipeline = useMemo(() => {
    if (!options || !pipelineId) return [];
    return options.stages.filter((s) => s.pipelineId === pipelineId);
  }, [options, pipelineId]);

  const sortedOperators = useMemo(() => {
    if (!options) return [];
    const selectedSector = options.sectors.find((s) => s.id === sectorId);
    const sectorOpSet = new Set(selectedSector?.operatorIds || []);
    return [...options.operators].sort((a, b) => {
      const aSuggested = a.id === pending?.suggestedOperatorId ? 0 : 1;
      const bSuggested = b.id === pending?.suggestedOperatorId ? 0 : 1;
      if (aSuggested !== bSuggested) return aSuggested - bSuggested;
      const aInSector = sectorOpSet.has(a.id) ? 0 : 1;
      const bInSector = sectorOpSet.has(b.id) ? 0 : 1;
      if (aInSector !== bInSector) return aInSector - bInSector;
      return a.name.localeCompare(b.name);
    });
  }, [options, sectorId, pending?.suggestedOperatorId]);

  const selectedSectorOps = useMemo(() => {
    const sec = options?.sectors.find((s) => s.id === sectorId);
    return new Set(sec?.operatorIds || []);
  }, [options, sectorId]);

  if (isAlreadyDone) return null;

  const handleSectorChange = (nextSectorId: string) => {
    setSectorId(nextSectorId);
    if (!options) return;
    // Se houver destino configurado em Fluxos para esse setor, atualiza Funil e Etapa padrão
    const matchedDest = Object.values(options.destinations).find(
      (d) => d.sectorId === nextSectorId,
    );
    if (matchedDest?.pipelineId) {
      setPipelineId(matchedDest.pipelineId);
      if (matchedDest.stageId) {
        setStageId(matchedDest.stageId);
      } else {
        const firstStage = options.stages.find((s) => s.pipelineId === matchedDest.pipelineId);
        setStageId(firstStage?.id || "");
      }
    }
    // Se operador atual não está no novo setor, sugere o próximo elegível desse setor
    const sec = options.sectors.find((s) => s.id === nextSectorId);
    if (sec && sec.operatorIds.length > 0 && !sec.operatorIds.includes(operatorId)) {
      const candidates = options.operators
        .filter((op) => sec.operatorIds.includes(op.id) && !op.isOnLeave)
        .sort(
          (a, b) =>
            a.leadsReceivedCount - a.compensation - (b.leadsReceivedCount - b.compensation) ||
            a.name.localeCompare(b.name),
        );
      if (candidates[0]) {
        setOperatorId(candidates[0].id);
      }
    }
  };

  const handlePipelineChange = (nextPipelineId: string) => {
    setPipelineId(nextPipelineId);
    if (!options) return;
    const firstStage = options.stages.find((s) => s.pipelineId === nextPipelineId);
    setStageId(firstStage?.id || "");
  };

  const handleApprove = async () => {
    if (!operatorId) {
      toast.error("Selecione o operador responsável antes de aprovar.");
      return;
    }
    if ((pipelineId && !stageId) || (!pipelineId && stageId)) {
      toast.error("Selecione tanto o Funil CRM quanto a Etapa de destino.");
      return;
    }

    setSubmittingAction("approve");
    try {
      const selectedSectorName = options?.sectors.find((s) => s.id === sectorId)?.name || null;
      const res = await fetch("/api/valentina/triage-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "approve",
          conversationId: session.conversationId,
          sectorId: sectorId || null,
          operatorId,
          pipelineId: pipelineId || null,
          stageId: stageId || null,
          targetFunnel: selectedSectorName || pending?.targetFunnel || session.targetFunnel || null,
          sendClientConfirmation: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Não foi possível aprovar e transferir.");
        return;
      }
      const opName = data?.operator?.name || "operador selecionado";
      toast.success(`Triagem aprovada! Lead encaminhado para ${opName} e card movido no CRM.`);
      onActionCompleted("approved", session.conversationId);
    } catch {
      toast.error("Erro de conexão ao aprovar triagem.");
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleDismiss = async () => {
    setSubmittingAction("dismiss");
    try {
      const res = await fetch("/api/valentina/triage-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "dismiss",
          conversationId: session.conversationId,
          reason: dismissReason.trim() || "Concluído sem transferência pelo SDR",
          finishConversation: dismissFinishConv,
          dealAction: dismissDealAction,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Não foi possível concluir a triagem.");
        return;
      }
      toast.success("Triagem concluída sem transferência e ocultada do Kanban ativo.");
      setShowDismissBox(false);
      onActionCompleted("dismissed", session.conversationId);
    } catch {
      toast.error("Erro de conexão ao concluir triagem.");
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleAssume = async () => {
    setSubmittingAction("assume");
    try {
      const res = await fetch("/api/valentina/triage-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "assume",
          conversationId: session.conversationId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Não foi possível assumir o atendimento.");
        return;
      }
      toast.success("Atendimento assumido! Agora está na sua aba Meus Atendimentos.");
      onActionCompleted("assumed", session.conversationId);
    } catch {
      toast.error("Erro de conexão ao assumir atendimento.");
    } finally {
      setSubmittingAction(null);
    }
  };

  return (
    <section
      className={`rounded-2xl border p-3 sm:p-3.5 space-y-3 transition ${
        isAwaitingApproval
          ? "border-amber-500/50 bg-amber-500/8 shadow-sm ring-1 ring-amber-500/20"
          : "border-border bg-card/80"
      } ${className ?? ""}`}
      aria-label="Aprovação Human-in-the-Loop SDR"
    >
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-7 w-7 rounded-xl flex items-center justify-center shrink-0 ${
              isAwaitingApproval
                ? "bg-amber-500/20 text-amber-600 dark:text-amber-300"
                : "bg-primary/10 text-primary"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-extrabold text-foreground truncate">
              {isAwaitingApproval ? "Aguardando Aprovação SDR" : "Decisão & Encaminhamento SDR"}
            </h4>
            <p className="text-[10px] text-muted-foreground truncate">
              {isAwaitingApproval
                ? `${personaName} concluiu a triagem e aguarda seu OK`
                : "Você pode aprovar, concluir ou assumir agora"}
            </p>
          </div>
        </div>

        {!isAwaitingApproval && (
          <SystemTooltip content={expanded ? "Recolher controles de encaminhamento" : "Expandir controles de encaminhamento"}>
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </SystemTooltip>
        )}
      </div>

      {expanded && (
        <div className="space-y-3 pt-1">
          {pending?.needsReview && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {personaName} sinalizou revisão humana para confirmar o setor/funil ideal antes do
                envio.
              </span>
            </div>
          )}

          {loadingOptions && !options ? (
            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando setores, operadores e funis...
            </div>
          ) : (
            <>
              {/* Seletores editáveis pré-preenchidos com a sugestão do Fagner */}
              <div className="space-y-2.5">
                {/* Setor */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3 w-3 text-primary shrink-0" />
                      Setor de Destino
                    </span>
                    {pending?.suggestedSectorName && (
                      <span className="ml-auto text-[10px] sm:text-[9px] font-semibold text-amber-600 dark:text-amber-300 normal-case truncate max-w-full">
                        Sugestão: {pending.suggestedSectorName}
                      </span>
                    )}
                  </label>
                  <Select value={sectorId} onValueChange={handleSectorChange}>
                    <SelectTrigger className="h-10 sm:h-8.5 text-xs rounded-xl">
                      <SelectValue placeholder="Selecione o setor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(options?.sectors || []).map((sec) => (
                        <SelectItem key={sec.id} value={sec.id} className="text-xs py-2 sm:py-1.5">
                          {sec.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Operador */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3 text-primary shrink-0" />
                      Operador (Rodízio)
                    </span>
                    {pending?.suggestedOperatorName && (
                      <span className="ml-auto text-[10px] sm:text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 normal-case truncate max-w-full">
                        Próx. Rodízio: {pending.suggestedOperatorName}
                      </span>
                    )}
                  </label>
                  <Select value={operatorId} onValueChange={setOperatorId}>
                    <SelectTrigger className="h-10 sm:h-8.5 text-xs rounded-xl">
                      <SelectValue placeholder="Selecione o responsável..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedOperators.map((op) => {
                        const isSuggested = op.id === pending?.suggestedOperatorId;
                        const inSector = selectedSectorOps.has(op.id);
                        const badgeParts: string[] = [];
                        if (isSuggested) badgeParts.push("Sugerido");
                        if (op.isOnLeave) badgeParts.push("Ausente");
                        else if (inSector) badgeParts.push(`${op.activeChatsNow} chats`);
                        return (
                          <SelectItem key={op.id} value={op.id} className="text-xs py-2 sm:py-1.5">
                            {op.name}
                            {badgeParts.length > 0 ? ` (${badgeParts.join(" · ")})` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Funil CRM */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <Kanban className="h-3 w-3 text-primary shrink-0" />
                    Mover Card para Funil CRM
                  </label>
                  <Select value={pipelineId} onValueChange={handlePipelineChange}>
                    <SelectTrigger className="h-10 sm:h-8.5 text-xs rounded-xl">
                      <SelectValue placeholder="Selecione o funil de destino..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(options?.pipelines || []).map((pipe) => (
                        <SelectItem key={pipe.id} value={pipe.id} className="text-xs py-2 sm:py-1.5">
                          {pipe.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Etapa CRM */}
                {pipelineId && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                      <Layers className="h-3 w-3 text-primary shrink-0" />
                      Etapa de Entrada
                    </label>
                    <Select value={stageId} onValueChange={setStageId}>
                      <SelectTrigger className="h-10 sm:h-8.5 text-xs rounded-xl">
                        <SelectValue placeholder="Selecione a etapa..." />
                      </SelectTrigger>
                      <SelectContent>
                        {stagesForSelectedPipeline.map((st) => (
                          <SelectItem key={st.id} value={st.id} className="text-xs py-2 sm:py-1.5">
                            {st.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Ação 1: Aprovar e Transferir */}
              <SystemTooltip content="Consome a vez do rodízio, move o card do CWR para o funil escolhido, transfere o chat e oculta do Kanban ativo">
                <button
                  type="button"
                  disabled={submittingAction !== null || !operatorId}
                  onClick={handleApprove}
                  className="w-full py-3 sm:py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  {submittingAction === "approve" ? (
                    <Loader2 className="h-4 w-4 sm:h-3.5 sm:w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  )}
                  <span>
                    {submittingAction === "approve" ? "Aprovando..." : "Aprovar e Transferir"}
                  </span>
                </button>
              </SystemTooltip>

              {/* Ações 2 e 3: Concluir sem Transferir & Assumir Manualmente */}
              <div className="grid grid-cols-2 gap-2">
                <SystemTooltip content="Encerrar triagem para currículos, fornecedores ou desqualificados e ocultar do Kanban">
                  <button
                    type="button"
                    disabled={submittingAction !== null}
                    onClick={() => setShowDismissBox((prev) => !prev)}
                    className="py-2.5 sm:py-2 px-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15 active:scale-[0.99] text-rose-700 dark:text-rose-300 text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Concluir s/ Enviar</span>
                  </button>
                </SystemTooltip>

                <SystemTooltip content="Assumir este atendimento diretamente na sua aba Meus Atendimentos">
                  <button
                    type="button"
                    disabled={submittingAction !== null}
                    onClick={handleAssume}
                    className="py-2.5 sm:py-2 px-2.5 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/15 active:scale-[0.99] text-primary text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50"
                  >
                    {submittingAction === "assume" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    ) : (
                      <UserCheck className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">Assumir Chat</span>
                  </button>
                </SystemTooltip>
              </div>

              {/* Gaveta rápida: Concluir sem Transferir */}
              {showDismissBox && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 space-y-2.5">
                  <p className="text-[11px] font-bold text-foreground">
                    Concluir triagem sem transferir
                  </p>
                  <input
                    type="text"
                    value={dismissReason}
                    onChange={(e) => setDismissReason(e.target.value)}
                    placeholder="Motivo (ex.: Currículo, Fornecedor, Desqualificado)"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                  />
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground">
                      Ação no card CWR
                    </label>
                    <Select
                      value={dismissDealAction}
                      onValueChange={(v) => setDismissDealAction(v as "keep" | "mark_lost")}
                    >
                      <SelectTrigger className="h-8 text-xs rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mark_lost" className="text-xs">
                          Marcar card como perdido / desqualificado
                        </SelectItem>
                        <SelectItem value="keep" className="text-xs">
                          Manter card no CRM sem alterar
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dismissFinishConv}
                      onChange={(e) => setDismissFinishConv(e.target.checked)}
                      className="rounded border-border accent-rose-600"
                    />
                    Finalizar conversa no WhatsApp
                  </label>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={submittingAction !== null}
                      onClick={handleDismiss}
                      className="flex-1 py-1.5 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50"
                    >
                      {submittingAction === "dismiss" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <XCircle className="h-3 w-3" />
                      )}
                      Confirmar Conclusão
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDismissBox(false)}
                      className="px-2.5 py-1.5 rounded-lg border border-border text-[11px] font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
