import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Briefcase,
  CheckCircle2,
  Columns3,
  EyeOff,
  Info,
  Loader2,
  PauseCircle,
  Send,
  UserCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";
import { CatalogSelect } from "@/components/crm/CatalogSelect";
import { CustomFieldsEditor, useCustomFields } from "@/components/crm/CustomFieldsEditor";
import { useChat } from "@/hooks/useChatState";
import { usePermissions } from "@/hooks/usePermissions";
import { invalidateDealCache } from "@/lib/crm/deal-prefetch";
import {
  fetchDealContext,
  invalidateDealContextCache,
} from "@/lib/crm/conversation-deal-client";
import { sortAlphabeticallyByName } from "@/lib/operator-initial-navigation";
import {
  fieldAppliesToPipeline,
  isFieldRequiredForStage,
  type CustomFieldValues,
} from "@/lib/crm/custom-fields";
import {
  buildDealActionPatchPayload,
  getPermittedDealActions,
  getSelectableStagesForPipeline,
  isHiddenTransferTarget,
  mergeAvailableTransferPipelines,
  requiresHiddenStageReassignment,
  type ChatTransferDealMode,
  type CurrentDealSummary,
  type TransferPipelineOption,
} from "@/lib/crm/chat-transfer-deal-action";

export interface PendingChatTransferIntent {
  conversationId: string;
  contactName?: string | null;
  sectorName: string | null;
  targetOperatorId: string;
  targetLabel: string;
  dealSelection?: { dealId: string; expectedVersion: number };
  currentDeal: CurrentDealSummary;
}

interface ChatTransferDealActionModalProps {
  open: boolean;
  intent: PendingChatTransferIntent | null;
  onClose: () => void;
  onCompleted?: (result: { dealAction: ChatTransferDealMode }) => void;
}

interface LoadedDealDetail {
  id: string;
  title: string;
  status: string;
  pipelineId: string | null;
  stageId: string | null;
  operatorId: string | null;
  lossReason?: string | null;
  version?: number;
  customFields?: CustomFieldValues;
  pipeline?: { id: string; name: string } | null;
  stage?: { id: string; name: string } | null;
  operator?: { id: string; name: string } | null;
}

const UNASSIGNED_OPERATOR_VALUE = "__unassigned__";

export const ChatTransferDealActionModal: React.FC<ChatTransferDealActionModalProps> = ({
  open,
  intent,
  onClose,
  onCompleted,
}) => {
  const { tenant, currentOperatorId, operators, transferChat } = useChat();
  const {
    permissions,
    canViewCrm,
    canCloseDeals,
    canEditDeals,
    canMoveStages,
  } = usePermissions();

  const [mode, setMode] = useState<ChatTransferDealMode>("none");
  const [winReason, setWinReason] = useState("");
  const [lossReason, setLossReason] = useState("");
  const [pauseReason, setPauseReason] = useState("");

  const [pipelines, setPipelines] = useState<TransferPipelineOption[]>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(false);
  const [dealDetail, setDealDetail] = useState<LoadedDealDetail | null>(null);
  const [loadingDeal, setLoadingDeal] = useState(false);

  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>(UNASSIGNED_OPERATOR_VALUE);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValues>({});

  const [submitting, setSubmitting] = useState<"none" | "chat_only" | "with_deal">("none");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dealActionCompleted, setDealActionCompleted] = useState(false);

  const canSendToHidden = Boolean(permissions?.crm?.canSendToHiddenStagesOrPipelines);

  const sortedOperators = useMemo(
    () => sortAlphabeticallyByName(operators),
    [operators],
  );

  const effectiveDeal = useMemo(() => {
    if (!intent) return null;
    const base = intent.currentDeal;
    return {
      id: base.id,
      title: dealDetail?.title || base.title,
      status: dealDetail?.status || base.status || "open",
      pipelineId: dealDetail?.pipelineId ?? base.pipelineId ?? null,
      pipelineName: dealDetail?.pipeline?.name ?? base.pipelineName ?? null,
      stageId: dealDetail?.stageId ?? base.stageId ?? null,
      stageName: dealDetail?.stage?.name ?? base.stageName ?? null,
      operatorId: dealDetail?.operatorId ?? base.operatorId ?? null,
      operatorName:
        dealDetail?.operator?.name ??
        base.operatorName ??
        (dealDetail?.operatorId
          ? operators.find((op) => op.id === dealDetail.operatorId)?.name || null
          : base.operatorId
            ? operators.find((op) => op.id === base.operatorId)?.name || null
            : null),
      lossReason: dealDetail?.lossReason ?? null,
      version: dealDetail?.version,
      customFields: dealDetail?.customFields || {},
    };
  }, [intent, dealDetail, operators]);

  const permitted = useMemo(
    () =>
      getPermittedDealActions(
        {
          canViewCrm,
          canCloseDeals,
          canEditDeals,
          canMoveStages,
          canSendToHiddenStagesOrPipelines: canSendToHidden,
        },
        effectiveDeal?.status,
      ),
    [canViewCrm, canCloseDeals, canEditDeals, canMoveStages, canSendToHidden, effectiveDeal?.status],
  );

  // Carrega definições de campos customizados apenas quando o usuário abre "Transferir Negociação"
  const customFieldsState = useCustomFields("deal", open && mode === "transfer_deal");

  // Reset de estado quando o modal abre para uma nova transferência
  useEffect(() => {
    if (!open || !intent) return;
    setMode("none");
    setWinReason("");
    setLossReason("");
    setPauseReason("");
    setErrorMessage(null);
    setSubmitting("none");
    setDealActionCompleted(false);
    setDealDetail(null);
    setCustomFieldValues({});

    const initialPipelineId = intent.currentDeal.pipelineId || "";
    const initialStageId = intent.currentDeal.stageId || "";
    // Sugere o operador destino da conversa como responsável inicial quando houver transferência direta para operador
    const suggestedOperator =
      intent.targetOperatorId || intent.currentDeal.operatorId || UNASSIGNED_OPERATOR_VALUE;

    setSelectedPipelineId(initialPipelineId);
    setSelectedStageId(initialStageId);
    setSelectedOperatorId(suggestedOperator);
  }, [open, intent]);

  // Busca detalhes atualizados do card Atual + lista de funis/etapas permitidos
  useEffect(() => {
    if (!open || !intent?.currentDeal.id) return;
    let active = true;
    const dealId = intent.currentDeal.id;

    setLoadingDeal(true);
    fetch(`/api/crm/deals/${encodeURIComponent(dealId)}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        return (data?.deal || null) as LoadedDealDetail | null;
      })
      .then((loaded) => {
        if (!active || !loaded) return;
        setDealDetail(loaded);
        const rawCf =
          typeof loaded.customFields === "string"
            ? (() => {
                try {
                  return JSON.parse(loaded.customFields) || {};
                } catch {
                  return {};
                }
              })()
            : loaded.customFields || {};
        setCustomFieldValues(rawCf);
        setSelectedPipelineId((prev) => prev || loaded.pipelineId || "");
        setSelectedStageId((prev) => prev || loaded.stageId || "");
        setSelectedOperatorId((prev) => {
          if (intent.targetOperatorId) return intent.targetOperatorId;
          if (prev !== UNASSIGNED_OPERATOR_VALUE) return prev;
          return loaded.operatorId || UNASSIGNED_OPERATOR_VALUE;
        });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingDeal(false);
      });

    if (canViewCrm) {
      setLoadingPipelines(true);
      fetch("/api/crm/pipelines", { credentials: "include" })
        .then(async (res) => {
          if (!res.ok) throw new Error("Falha ao carregar funis");
          return res.json();
        })
        .then((data) => {
          if (!active) return;
          const merged = mergeAvailableTransferPipelines(
            data?.pipelines || [],
            data?.transferPipelines || [],
          );
          setPipelines(merged);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoadingPipelines(false);
        });
    }

    return () => {
      active = false;
    };
  }, [open, intent, canViewCrm]);

  const selectedPipeline = useMemo(
    () => pipelines.find((p) => p.id === selectedPipelineId) || null,
    [pipelines, selectedPipelineId],
  );

  const selectableStages = useMemo(
    () => getSelectableStagesForPipeline(selectedPipeline, canSendToHidden),
    [selectedPipeline, canSendToHidden],
  );

  // Garante etapa válida ao trocar de funil ou ao carregar a lista de funis
  useEffect(() => {
    if (!selectedPipeline) return;
    if (selectableStages.length === 0) {
      setSelectedStageId("");
      return;
    }
    if (!selectableStages.some((st) => st.id === selectedStageId)) {
      const dealStageInPipeline =
        effectiveDeal?.pipelineId === selectedPipeline.id
          ? selectableStages.find((st) => st.id === effectiveDeal.stageId)
          : null;
      setSelectedStageId(dealStageInPipeline?.id || selectableStages[0].id);
    }
  }, [selectedPipeline, selectableStages, selectedStageId, effectiveDeal?.pipelineId, effectiveDeal?.stageId]);

  const selectedStage = useMemo(
    () => selectableStages.find((st) => st.id === selectedStageId) || null,
    [selectableStages, selectedStageId],
  );

  const targetIsHidden = useMemo(
    () => isHiddenTransferTarget(selectedPipeline, selectedStage),
    [selectedPipeline, selectedStage],
  );

  const needsHiddenReassignment = useMemo(
    () =>
      requiresHiddenStageReassignment({
        pipeline: selectedPipeline,
        stage: selectedStage,
        dealOwnerId: effectiveDeal?.operatorId,
        currentOperatorId,
      }),
    [selectedPipeline, selectedStage, effectiveDeal?.operatorId, currentOperatorId],
  );

  const availableOperatorsForDeal = useMemo(() => {
    if (!needsHiddenReassignment) return sortedOperators;
    return sortedOperators.filter((op) => op.id !== currentOperatorId);
  }, [sortedOperators, needsHiddenReassignment, currentOperatorId]);

  // Se a etapa/funil for oculta e o responsável selecionado for o próprio operador, limpa para forçar nova escolha
  useEffect(() => {
    if (
      mode === "transfer_deal" &&
      needsHiddenReassignment &&
      selectedOperatorId === currentOperatorId
    ) {
      setSelectedOperatorId("");
    }
  }, [mode, needsHiddenReassignment, selectedOperatorId, currentOperatorId]);

  // Detecta campos obrigatórios pendentes da etapa de destino (caso existam)
  const missingStageFieldDefinitions = useMemo(() => {
    if (mode !== "transfer_deal" || !selectedPipeline || !selectedStage) return [];
    const requiredIds = Array.isArray(selectedStage.requiredFields)
      ? selectedStage.requiredFields
      : [];
    const stageContext = {
      stageId: selectedStage.id,
      orderIndex: selectedStage.orderIndex ?? 0,
      allStages: selectableStages.map((s) => ({
        id: s.id,
        orderIndex: s.orderIndex ?? 0,
        pipelineId: selectedPipeline.id,
      })),
    };
    const isValFilled = (v: unknown) => {
      if (v === undefined || v === null) return false;
      if (typeof v === "string") return v.trim().length > 0;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    };
    const dealExistingCf = effectiveDeal?.customFields || {};

    return customFieldsState.fields.filter((field) => {
      if (!fieldAppliesToPipeline(field as any, selectedPipeline.id)) return false;
      const requiredHere =
        requiredIds.includes(field.id) ||
        isFieldRequiredForStage(field as any, stageContext);
      if (!requiredHere) return false;
      // Exibe campos obrigatórios que ainda não estavam preenchidos no card
      return !isValFilled(dealExistingCf[field.id] ?? dealExistingCf[field.name]);
    });
  }, [
    mode,
    selectedPipeline,
    selectedStage,
    selectableStages,
    customFieldsState.fields,
    effectiveDeal?.customFields,
  ]);

  const missingRequiredIds = useMemo(
    () => missingStageFieldDefinitions.map((f) => f.id),
    [missingStageFieldDefinitions],
  );

  const changedTransferCustomFields = useMemo(() => {
    const changed: CustomFieldValues = {};
    if (mode === "transfer_deal" && missingStageFieldDefinitions.length > 0) {
      for (const field of missingStageFieldDefinitions) {
        const val = customFieldValues[field.id];
        if (val !== undefined) {
          changed[field.id] = val;
        }
      }
    }
    return changed;
  }, [mode, missingStageFieldDefinitions, customFieldValues]);

  const transferDealPatchPreview = useMemo(() => {
    if (mode !== "transfer_deal" || !effectiveDeal) return null;
    return buildDealActionPatchPayload({
      mode: "transfer_deal",
      currentDeal: {
        status: effectiveDeal.status,
        pipelineId: effectiveDeal.pipelineId,
        stageId: effectiveDeal.stageId,
        operatorId: effectiveDeal.operatorId,
        lossReason: effectiveDeal.lossReason,
        version: effectiveDeal.version,
      },
      currentOperatorId,
      lossReason,
      targetPipeline: selectedPipeline,
      targetStage: selectedStage,
      targetOperatorId:
        selectedOperatorId === UNASSIGNED_OPERATOR_VALUE || !selectedOperatorId
          ? null
          : selectedOperatorId,
      keepCurrentOperator: !permitted.canChangePipelineOrOwner,
      customFields:
        Object.keys(changedTransferCustomFields).length > 0
          ? changedTransferCustomFields
          : undefined,
    });
  }, [
    mode,
    effectiveDeal,
    currentOperatorId,
    lossReason,
    selectedPipeline,
    selectedStage,
    selectedOperatorId,
    permitted.canChangePipelineOrOwner,
    changedTransferCustomFields,
  ]);

  const isTransferDealNoop = Boolean(
    mode === "transfer_deal" &&
      transferDealPatchPreview?.ok &&
      transferDealPatchPreview.noop,
  );

  const handlePipelineChange = (nextPipelineId: string) => {
    setErrorMessage(null);
    setSelectedPipelineId(nextPipelineId);
    const nextPipe = pipelines.find((p) => p.id === nextPipelineId) || null;
    const nextStages = getSelectableStagesForPipeline(nextPipe, canSendToHidden);
    if (nextPipe && effectiveDeal?.pipelineId === nextPipe.id && effectiveDeal.stageId) {
      const sameStage = nextStages.find((s) => s.id === effectiveDeal.stageId);
      setSelectedStageId(sameStage?.id || nextStages[0]?.id || "");
    } else {
      setSelectedStageId(nextStages[0]?.id || "");
    }
  };

  const handleTransferChatOnly = async () => {
    if (!intent || submitting !== "none") return;
    setSubmitting("chat_only");
    setErrorMessage(null);
    try {
      let nextDealSelection = intent.dealSelection;
      if (dealActionCompleted && tenant && currentOperatorId) {
        invalidateDealContextCache(intent.conversationId);
        const freshContext = await fetchDealContext(
          tenant,
          currentOperatorId,
          intent.conversationId,
        );
        nextDealSelection =
          intent.dealSelection && intent.dealSelection.dealId !== intent.currentDeal.id
            ? { dealId: intent.dealSelection.dealId, expectedVersion: freshContext.version }
            : undefined;
      }

      const ok = await transferChat(
        intent.conversationId,
        intent.sectorName,
        intent.targetOperatorId,
        nextDealSelection,
      );
      if (ok) {
        onCompleted?.({ dealAction: dealActionCompleted ? mode : "none" });
        onClose();
      }
    } finally {
      setSubmitting("none");
    }
  };

  const handleConfirmWithDealAction = async () => {
    if (!intent || !effectiveDeal || mode === "none" || submitting !== "none") return;
    setErrorMessage(null);

    let dealClosed = mode === "mark_won" || mode === "mark_lost" || Boolean(selectedStage?.isLossStage);
    let appliedDealAction: ChatTransferDealMode = mode;

    // 1. Executa a ação / transferência na negociação Atual (se ainda não concluída)
    if (!dealActionCompleted) {
      const patchResult = buildDealActionPatchPayload({
        mode,
        currentDeal: {
          status: effectiveDeal.status,
          pipelineId: effectiveDeal.pipelineId,
          stageId: effectiveDeal.stageId,
          operatorId: effectiveDeal.operatorId,
          lossReason: effectiveDeal.lossReason,
          version: effectiveDeal.version,
        },
        currentOperatorId,
        winReason,
        lossReason,
        pauseReason,
        targetPipeline: selectedPipeline,
        targetStage: selectedStage,
        targetOperatorId:
          selectedOperatorId === UNASSIGNED_OPERATOR_VALUE || !selectedOperatorId
            ? null
            : selectedOperatorId,
        keepCurrentOperator: !permitted.canChangePipelineOrOwner,
        customFields:
          Object.keys(changedTransferCustomFields).length > 0
            ? changedTransferCustomFields
            : undefined,
      });

      if (!patchResult.ok) {
        setErrorMessage(patchResult.error);
        toast.error(patchResult.error);
        return;
      }

      if (patchResult.noop) {
        // A negociação já está no funil, etapa e responsável selecionados:
        // pula o PATCH desnecessário e transfere a conversa normalmente.
        appliedDealAction = "none";
        setSubmitting("with_deal");
        try {
          const transferred = await transferChat(
            intent.conversationId,
            intent.sectorName,
            intent.targetOperatorId,
            intent.dealSelection,
          );
          if (transferred) {
            onCompleted?.({ dealAction: appliedDealAction });
            onClose();
          }
        } finally {
          setSubmitting("none");
        }
        return;
      }

      setSubmitting("with_deal");
      try {
        const res = await fetch(`/api/crm/deals/${encodeURIComponent(effectiveDeal.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(patchResult.payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data?.error || "Não foi possível atualizar a negociação atual.";
          setErrorMessage(msg);
          toast.error(msg);
          setSubmitting("none");
          return;
        }

        if (data?.deal?.status === "won" || data?.deal?.status === "lost") {
          dealClosed = true;
        }

        invalidateDealCache(effectiveDeal.id);
        invalidateDealContextCache(intent.conversationId);
        window.dispatchEvent(new Event("crm-deals-changed"));
        window.dispatchEvent(new Event("conversation-deal-context-changed"));
        setDealActionCompleted(true);

        if (mode === "mark_won") {
          toast.success("Negociação marcada como venda!");
        } else if (mode === "mark_lost") {
          toast.success("Negociação marcada como perda.");
        } else if (mode === "mark_paused") {
          toast.success("Negociação marcada como pausada.");
        } else if (mode === "transfer_deal") {
          toast.success("Negociação transferida com sucesso!");
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Erro ao atualizar a negociação atual.";
        setErrorMessage(msg);
        toast.error(msg);
        setSubmitting("none");
        return;
      }
    } else {
      setSubmitting("with_deal");
    }

    // 2. Recarrega contexto atualizado (essencial após ganho/perda para ativar carência e versão nova) e transfere a conversa
    try {
      let nextDealSelection = intent.dealSelection;
      if (tenant && currentOperatorId) {
        invalidateDealContextCache(intent.conversationId);
        const freshContext = await fetchDealContext(
          tenant,
          currentOperatorId,
          intent.conversationId,
        );
        if (dealClosed) {
          nextDealSelection =
            intent.dealSelection && intent.dealSelection.dealId !== effectiveDeal.id
              ? { dealId: intent.dealSelection.dealId, expectedVersion: freshContext.version }
              : undefined;
        } else if (intent.dealSelection) {
          nextDealSelection = {
            dealId: intent.dealSelection.dealId,
            expectedVersion: freshContext.version,
          };
        }
      }

      const transferred = await transferChat(
        intent.conversationId,
        intent.sectorName,
        intent.targetOperatorId,
        nextDealSelection,
      );

      if (transferred) {
        onCompleted?.({ dealAction: appliedDealAction });
        onClose();
      } else {
        setErrorMessage(
          "A ação na negociação já foi salva, mas houve um conflito ao transferir a conversa. Tente transferir apenas a conversa novamente.",
        );
      }
    } finally {
      setSubmitting("none");
    }
  };

  const confirmButtonLabel = useMemo(() => {
    if (submitting === "with_deal") {
      if (mode === "mark_won") return "Marcando venda...";
      if (mode === "mark_lost") return "Marcando perda...";
      if (mode === "mark_paused") return "Pausando...";
      return "Transferindo...";
    }
    if (mode === "mark_won") return "Marcar venda e transferir";
    if (mode === "mark_lost") return "Marcar perda e transferir";
    if (mode === "mark_paused") return "Pausar e transferir";
    if (mode === "transfer_deal") {
      return isTransferDealNoop ? "Transferir conversa" : "Transferir negociação e conversa";
    }
    return "Confirmar";
  }, [mode, submitting, isTransferDealNoop]);

  const isConfirmDisabled = useMemo(() => {
    if (submitting !== "none" || mode === "none") return true;
    if (mode === "mark_lost" && !lossReason.trim()) return true;
    if (mode === "transfer_deal") {
      if (!selectedPipelineId || !selectedStageId) return true;
      if (selectedStage?.isLossStage && !lossReason.trim()) return true;
      if (
        needsHiddenReassignment &&
        (!selectedOperatorId ||
          selectedOperatorId === UNASSIGNED_OPERATOR_VALUE ||
          selectedOperatorId === currentOperatorId)
      ) {
        return true;
      }
    }
    return false;
  }, [
    submitting,
    mode,
    lossReason,
    selectedPipelineId,
    selectedStageId,
    selectedStage?.isLossStage,
    needsHiddenReassignment,
    selectedOperatorId,
    currentOperatorId,
  ]);

  if (!intent || !effectiveDeal) return null;

  const dealStatusLabel =
    effectiveDeal.status === "paused"
      ? "Pausada"
      : effectiveDeal.status === "open"
        ? "Em andamento"
        : effectiveDeal.status;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submitting === "none") {
          onClose();
        }
      }}
    >
      <DialogContent className="flex flex-col sm:max-w-[580px] max-h-[90vh] overflow-hidden p-0 gap-0 bg-card text-foreground border border-border shadow-2xl">
        <DialogHeader className="shrink-0 space-y-1.5 px-5 pt-5 pb-3.5 pr-11 border-b border-border/60">
          <DialogTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <ArrowRightLeft className="h-4 w-4" />
            </div>
            <span>Transferir Conversa</span>
          </DialogTitle>
          <DialogDescription className="text-xs font-medium text-foreground/90 leading-relaxed pt-0.5">
            Gostaria de transferir ou tomar alguma ação também na negociação dessa conversa?
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4 space-y-4">
        {/* Resumo do destino da conversa + card Atual vinculado */}
        <div className="space-y-2 rounded-xl border border-border/80 bg-muted/35 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
              <Send className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span>Destino da conversa:</span>
              <span className="font-bold text-foreground truncate">{intent.targetLabel}</span>
            </div>
            {intent.contactName && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                Cliente: <strong className="text-foreground">{intent.contactName}</strong>
              </span>
            )}
          </div>

          <div className="border-t border-border/60 pt-2 flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">
                  <Columns3 className="h-3 w-3" />
                  Atual
                </span>
                <span className="font-bold text-foreground truncate">{effectiveDeal.title}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {loadingDeal && !effectiveDeal.pipelineName ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Carregando detalhes da negociação...
                  </span>
                ) : (
                  <>
                    {effectiveDeal.pipelineName && (
                      <span>
                        {effectiveDeal.pipelineName}
                        {effectiveDeal.stageName ? (
                          <>
                            {" "}
                            <ArrowRight className="inline h-3 w-3 mx-0.5 opacity-60" />{" "}
                            <strong className="text-foreground/85">{effectiveDeal.stageName}</strong>
                          </>
                        ) : null}
                      </span>
                    )}
                    {effectiveDeal.operatorName && (
                      <span>• Resp.: {effectiveDeal.operatorName}</span>
                    )}
                    <span>• Status: {dealStatusLabel}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Alerta de erro ou estado parcial */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400 flex items-start gap-2"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Seção 1: Tomar ação */}
        {(permitted.canMarkWon || permitted.canMarkLost || permitted.canMarkPaused) && (
          <div className="space-y-2">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Tomar ação na negociação atual
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {permitted.canMarkWon && (
                <SystemTooltip content="Marcar a negociação atual como venda (ganha) e transferir a conversa">
                  <button
                    type="button"
                    disabled={submitting !== "none" || dealActionCompleted}
                    onClick={() => {
                      setErrorMessage(null);
                      setMode((prev) => (prev === "mark_won" ? "none" : "mark_won"));
                    }}
                    className={`flex items-center justify-center sm:justify-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      mode === "mark_won"
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/40 shadow-xs"
                        : "border-border bg-background/70 text-foreground hover:border-emerald-500/50 hover:bg-emerald-500/5"
                    }`}
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>Marcar venda</span>
                  </button>
                </SystemTooltip>
              )}

              {permitted.canMarkLost && (
                <SystemTooltip content="Marcar a negociação atual como perdida e transferir a conversa">
                  <button
                    type="button"
                    disabled={submitting !== "none" || dealActionCompleted}
                    onClick={() => {
                      setErrorMessage(null);
                      setMode((prev) => (prev === "mark_lost" ? "none" : "mark_lost"));
                    }}
                    className={`flex items-center justify-center sm:justify-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      mode === "mark_lost"
                        ? "border-red-500 bg-red-500/15 text-red-700 dark:text-red-300 ring-1 ring-red-500/40 shadow-xs"
                        : "border-border bg-background/70 text-foreground hover:border-red-500/50 hover:bg-red-500/5"
                    }`}
                  >
                    <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    <span>Marcar perda</span>
                  </button>
                </SystemTooltip>
              )}

              {canViewCrm && canEditDeals && (
                <SystemTooltip
                  content={
                    effectiveDeal.status === "paused"
                      ? "A negociação atual já está pausada"
                      : "Marcar a negociação atual como pausada e transferir a conversa"
                  }
                >
                  <button
                    type="button"
                    disabled={
                      submitting !== "none" ||
                      dealActionCompleted ||
                      !permitted.canMarkPaused
                    }
                    onClick={() => {
                      setErrorMessage(null);
                      setMode((prev) => (prev === "mark_paused" ? "none" : "mark_paused"));
                    }}
                    className={`flex items-center justify-center sm:justify-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      mode === "mark_paused"
                        ? "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40 shadow-xs"
                        : "border-border bg-background/70 text-foreground hover:border-amber-500/50 hover:bg-amber-500/5"
                    }`}
                  >
                    <PauseCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>Marcar como pausa</span>
                  </button>
                </SystemTooltip>
              )}
            </div>

            {/* Painel contextual de Marcar venda */}
            {mode === "mark_won" && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2 animate-in fade-in duration-150">
                <label className="block text-[11px] font-semibold text-foreground">
                  Motivo do ganho <span className="text-muted-foreground font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={winReason}
                  onChange={(e) => setWinReason(e.target.value)}
                  placeholder="Ex.: Melhor condição comercial, atendimento rápido..."
                  disabled={submitting !== "none"}
                  className="h-9 w-full rounded-xl border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            )}

            {/* Painel contextual de Marcar perda */}
            {mode === "mark_lost" && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 space-y-2 animate-in fade-in duration-150">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-semibold text-foreground">
                    Motivo da perda <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">
                    Obrigatório
                  </span>
                </div>
                <CatalogSelect
                  kind="loss_reason"
                  value={lossReason}
                  onChange={(val) => {
                    setLossReason(val);
                    setErrorMessage(null);
                  }}
                  pipelineId={effectiveDeal.pipelineId}
                  stageId={effectiveDeal.stageId}
                  placeholder="Selecione o motivo de perda *"
                  className="h-9 w-full rounded-xl border-red-500/40 bg-card text-xs"
                />
              </div>
            )}

            {/* Painel contextual de Marcar como pausa */}
            {mode === "mark_paused" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2 animate-in fade-in duration-150">
                <label className="block text-[11px] font-semibold text-foreground">
                  Motivo da pausa <span className="text-muted-foreground font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value)}
                  placeholder="Ex.: Aguardando retorno/aprovação do cliente..."
                  disabled={submitting !== "none"}
                  className="h-9 w-full rounded-xl border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
            )}
          </div>
        )}

        {/* Seção 2: Transferir Negociação */}
        {permitted.canTransferDeal && (
          <div className="space-y-2">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Transferir
            </div>

            <SystemTooltip content="Alterar funil, etapa e/ou responsável da negociação atual junto com a transferência da conversa">
              <button
                type="button"
                disabled={submitting !== "none" || dealActionCompleted}
                onClick={() => {
                  setErrorMessage(null);
                  setMode((prev) => (prev === "transfer_deal" ? "none" : "transfer_deal"));
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === "transfer_deal"
                    ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30 shadow-xs"
                    : "border-border bg-background/70 text-foreground hover:border-primary/50 hover:bg-primary/5"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 shrink-0 text-primary" />
                  <span>Transferir Negociação</span>
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground">
                  {mode === "transfer_deal" ? "Selecionado" : "Funil · Etapa · Responsável"}
                </span>
              </button>
            </SystemTooltip>

            {mode === "transfer_deal" && (
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 space-y-3 animate-in fade-in duration-150">
                {loadingPipelines && pipelines.length === 0 ? (
                  <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span>Carregando funis e etapas...</span>
                  </div>
                ) : (
                  <>
                    {/* Qual funil? */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                        <span>Qual funil?</span>
                        {!permitted.canChangePipelineOrOwner && (
                          <span className="text-[10px] font-normal text-muted-foreground">
                            Sem permissão para trocar funil
                          </span>
                        )}
                      </label>
                      <Select
                        value={selectedPipelineId || undefined}
                        onValueChange={handlePipelineChange}
                        disabled={!permitted.canChangePipelineOrOwner || submitting !== "none"}
                      >
                        <SystemTooltip content="Escolha o funil de destino para a negociação atual">
                          <SelectTrigger className="h-9 text-xs bg-card border-border">
                            <SelectValue placeholder="Selecione o funil..." />
                          </SelectTrigger>
                        </SystemTooltip>
                        <SelectContent>
                          {pipelines.map((pipe) => (
                            <SelectItem key={pipe.id} value={pipe.id} className="text-xs">
                              <span className="flex items-center gap-1.5">
                                <span>{pipe.name}</span>
                                {pipe.isVisible === false && (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                                    <EyeOff className="h-2.5 w-2.5" />
                                    Sem visibilidade
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Qual etapa? */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                        <span>Qual etapa?</span>
                        {!permitted.canChangeStage && (
                          <span className="text-[10px] font-normal text-muted-foreground">
                            Sem permissão para mover etapa
                          </span>
                        )}
                      </label>
                      <Select
                        value={selectedStageId || undefined}
                        onValueChange={(val) => {
                          setErrorMessage(null);
                          setSelectedStageId(val);
                        }}
                        disabled={
                          !permitted.canChangeStage ||
                          selectableStages.length === 0 ||
                          submitting !== "none"
                        }
                      >
                        <SystemTooltip content="Escolha a etapa de destino dentro do funil selecionado">
                          <SelectTrigger className="h-9 text-xs bg-card border-border">
                            <SelectValue placeholder="Selecione a etapa..." />
                          </SelectTrigger>
                        </SystemTooltip>
                        <SelectContent>
                          {selectableStages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.id} className="text-xs">
                              <span className="flex items-center gap-1.5">
                                <span>{stage.name}</span>
                                {stage.isVisible === false && (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                                    <EyeOff className="h-2.5 w-2.5" />
                                    Sem visibilidade
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Qual responsável? */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <UserCheck className="h-3.5 w-3.5 text-primary" />
                          <span>Qual responsável?</span>
                        </span>
                        {!permitted.canChangePipelineOrOwner && (
                          <span className="text-[10px] font-normal text-muted-foreground">
                            Sem permissão para trocar responsável
                          </span>
                        )}
                      </label>
                      <Select
                        value={selectedOperatorId || undefined}
                        onValueChange={(val) => {
                          setErrorMessage(null);
                          setSelectedOperatorId(val);
                        }}
                        disabled={!permitted.canChangePipelineOrOwner || submitting !== "none"}
                      >
                        <SystemTooltip content="Escolha o novo responsável pela negociação atual">
                          <SelectTrigger className="h-9 text-xs bg-card border-border">
                            <SelectValue placeholder="Selecione o responsável..." />
                          </SelectTrigger>
                        </SystemTooltip>
                        <SelectContent>
                          {!needsHiddenReassignment && (
                            <SelectItem value={UNASSIGNED_OPERATOR_VALUE} className="text-xs text-muted-foreground">
                              Sem responsável
                            </SelectItem>
                          )}
                          {availableOperatorsForDeal.map((op) => (
                            <SelectItem key={op.id} value={op.id} className="text-xs">
                              <span className="flex items-center gap-1.5">
                                <span>{op.name}</span>
                                {intent.targetOperatorId === op.id && (
                                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                                    Destino do chat
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Aviso informativo quando a negociação já está exatamente no destino escolhido */}
                    {isTransferDealNoop && !loadingPipelines && (
                      <div
                        role="status"
                        className="rounded-xl border border-sky-500/35 bg-sky-500/10 p-2.5 text-[11px] text-sky-800 dark:text-sky-200 flex items-start gap-2"
                      >
                        <Info className="h-4 w-4 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
                        <span>
                          Esta negociação já está neste funil, etapa e responsável. Ao confirmar, apenas a conversa será transferida.
                        </span>
                      </div>
                    )}

                    {/* Aviso quando destino for etapa/funil sem visibilidade */}
                    {targetIsHidden && (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-2">
                        <EyeOff className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          {needsHiddenReassignment
                            ? "Você perderá visibilidade sobre esta negociação nesse destino. Escolha outro responsável acima para concluir."
                            : "Atenção: você não poderá mais visualizar ou atualizar esta negociação após movê-la para este destino."}
                        </span>
                      </div>
                    )}

                    {/* Motivo de perda obrigatório se a etapa de destino for etapa de perda */}
                    {selectedStage?.isLossStage && (
                      <div className="space-y-1.5 pt-1 border-t border-border/60">
                        <label className="text-[11px] font-semibold text-red-700 dark:text-red-300 block">
                          Motivo da perda (exigido pela etapa selecionada) *
                        </label>
                        <CatalogSelect
                          kind="loss_reason"
                          value={lossReason}
                          onChange={(val) => {
                            setLossReason(val);
                            setErrorMessage(null);
                          }}
                          pipelineId={selectedPipeline?.id}
                          stageId={selectedStage.id}
                          placeholder="Selecione o motivo de perda *"
                          className="h-9 w-full rounded-xl border-red-500/40 bg-card text-xs"
                        />
                      </div>
                    )}

                    {/* Campos obrigatórios pendentes da etapa de destino (se houver) */}
                    {missingStageFieldDefinitions.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-border/60">
                        <div className="text-[11px] font-semibold text-foreground">
                          Campos exigidos pela etapa de destino
                        </div>
                        <CustomFieldsEditor
                          entity="deal"
                          pipelineId={selectedPipeline?.id}
                          definitions={missingStageFieldDefinitions}
                          requiredIds={missingRequiredIds}
                          values={customFieldValues}
                          onChange={setCustomFieldValues}
                          hideTitle
                          columns={1}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        </div>

        <DialogFooter className="shrink-0 px-5 py-3.5 border-t border-border/70 bg-card flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:space-x-0">
          <button
            type="button"
            disabled={submitting !== "none"}
            onClick={onClose}
            className="min-h-9 py-2 px-3.5 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            Cancelar
          </button>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2">
            {(mode === "none" || dealActionCompleted || !isTransferDealNoop) && (
              <SystemTooltip content="Transfere apenas a conversa no chat, sem alterar a negociação atual">
                <button
                  type="button"
                  disabled={submitting !== "none"}
                  onClick={() => void handleTransferChatOnly()}
                  className={`min-h-9 py-2 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-50 ${
                    mode === "none" || dealActionCompleted
                      ? "bg-primary hover:opacity-90 text-primary-foreground shadow-sm"
                      : "border border-border bg-muted/60 text-foreground hover:bg-muted"
                  }`}
                >
                  {submitting === "chat_only" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                      <span>Transferindo...</span>
                    </>
                  ) : (
                    <span>
                      {mode === "none" || dealActionCompleted
                        ? "Transferir apenas conversa"
                        : "Apenas conversa"}
                    </span>
                  )}
                </button>
              </SystemTooltip>
            )}

            {mode !== "none" && !dealActionCompleted && (
              <button
                type="button"
                disabled={isConfirmDisabled}
                onClick={() => void handleConfirmWithDealAction()}
                className={`min-h-9 py-2 px-4 rounded-xl text-xs font-bold text-white shadow-sm transition cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === "mark_won"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : mode === "mark_lost"
                      ? "bg-red-600 hover:bg-red-700"
                      : mode === "mark_paused"
                        ? "bg-amber-600 hover:bg-amber-700"
                        : "bg-primary hover:opacity-90 text-primary-foreground"
                }`}
              >
                {submitting === "with_deal" && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
                <span>{confirmButtonLabel}</span>
              </button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
