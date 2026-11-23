import { resolveRequiredLossReason } from "./loss-reason-policy";
import { isCurrentDealEligible } from "./conversation-deal-policy";
import type { ConversationDealContext } from "./conversation-deal-client";
import type { CustomFieldValues } from "./custom-fields";

export type ChatTransferDealMode =
  | "none"
  | "mark_won"
  | "mark_lost"
  | "mark_paused"
  | "transfer_deal";

export interface TransferPipelineStageOption {
  id: string;
  name: string;
  pipelineId?: string;
  orderIndex?: number;
  isWinStage?: boolean | null;
  isLossStage?: boolean | null;
  isVisible?: boolean;
  requiredFields?: string[] | null;
}

export interface TransferPipelineOption {
  id: string;
  name: string;
  isVisible?: boolean;
  stages?: TransferPipelineStageOption[];
  allStages?: TransferPipelineStageOption[];
  hasHiddenStages?: boolean;
}

export interface CurrentDealSummary {
  id: string;
  title: string;
  status: string;
  pipelineId?: string | null;
  pipelineName?: string | null;
  stageId?: string | null;
  stageName?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
  isLinked?: boolean;
}

export interface CrmDealActionPermissions {
  canViewCrm: boolean;
  canCloseDeals: boolean;
  canEditDeals: boolean;
  canMoveStages: boolean;
  canSendToHiddenStagesOrPipelines?: boolean;
}

export interface PermittedDealActions {
  canMarkWon: boolean;
  canMarkLost: boolean;
  canMarkPaused: boolean;
  canTransferDeal: boolean;
  canChangePipelineOrOwner: boolean;
  canChangeStage: boolean;
  hasAnyAction: boolean;
}

/**
 * Resolve exclusivamente o card vinculado como Atual da conversa.
 * Regra de negócio: ações e transferências no pop-up de transferência sempre atuam
 * sobre o card marcado como Atual (elegível: em andamento ou pausado e vinculado).
 */
export function resolveTransferTargetDeal(
  dealContext: ConversationDealContext | null | undefined,
): CurrentDealSummary | null {
  if (!dealContext?.hasCurrentDeal || !dealContext.currentDeal?.id) {
    return null;
  }
  const current = dealContext.currentDeal;
  const status = current.status || "open";
  const matchedInList = dealContext.deals?.find((d) => d.id === current.id);
  const isLinked = matchedInList?.isLinked ?? true;
  if (!isCurrentDealEligible({ status, isLinked })) {
    return null;
  }

  return {
    id: current.id,
    title: current.title,
    status,
    pipelineId: current.pipelineId ?? matchedInList?.pipelineId ?? null,
    pipelineName: current.pipelineName ?? matchedInList?.pipelineName ?? null,
    stageId: current.stageId ?? matchedInList?.stageId ?? null,
    stageName: current.stageName ?? matchedInList?.stageName ?? null,
    operatorId: current.operatorId ?? matchedInList?.operatorId ?? null,
    operatorName: current.operatorName ?? matchedInList?.operatorName ?? null,
    isLinked,
  };
}

/**
 * Avalia quais ações no card Atual o operador tem permissão de executar.
 */
export function getPermittedDealActions(
  permissions: CrmDealActionPermissions,
  dealStatus?: string | null,
): PermittedDealActions {
  const status = dealStatus || "open";
  const isOpen = status === "open";
  const isOpenOrPaused = status === "open" || status === "paused";

  const canMarkWon = Boolean(permissions.canViewCrm && permissions.canCloseDeals && isOpenOrPaused);
  const canMarkLost = Boolean(permissions.canViewCrm && permissions.canCloseDeals && isOpenOrPaused);
  const canMarkPaused = Boolean(permissions.canViewCrm && permissions.canEditDeals && isOpen);
  const canChangePipelineOrOwner = Boolean(permissions.canViewCrm && permissions.canEditDeals);
  const canChangeStage = Boolean(permissions.canViewCrm && permissions.canMoveStages);
  const canTransferDeal = Boolean(canChangePipelineOrOwner || canChangeStage);

  return {
    canMarkWon,
    canMarkLost,
    canMarkPaused,
    canTransferDeal,
    canChangePipelineOrOwner,
    canChangeStage,
    hasAnyAction: canMarkWon || canMarkLost || canMarkPaused || canTransferDeal,
  };
}

/**
 * Mescla funis visíveis e funis de transferência ocultos sem duplicar IDs,
 * ordenando etapas por `orderIndex`.
 */
export function mergeAvailableTransferPipelines(
  pipelines: TransferPipelineOption[] | null | undefined,
  transferPipelines?: TransferPipelineOption[] | null | undefined,
): TransferPipelineOption[] {
  const merged = new Map<string, TransferPipelineOption>();
  const sortStages = (list?: TransferPipelineStageOption[]) =>
    [...(list || [])].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

  for (const raw of pipelines || []) {
    if (!raw?.id) continue;
    merged.set(raw.id, {
      ...raw,
      stages: sortStages(raw.stages),
      allStages: raw.allStages ? sortStages(raw.allStages) : undefined,
    });
  }

  for (const raw of transferPipelines || []) {
    if (!raw?.id || merged.has(raw.id)) continue;
    merged.set(raw.id, {
      ...raw,
      isVisible: raw.isVisible ?? false,
      stages: sortStages(raw.stages),
      allStages: raw.allStages ? sortStages(raw.allStages) : sortStages(raw.stages),
    });
  }

  return Array.from(merged.values());
}

/**
 * Retorna as etapas selecionáveis de um funil no fluxo de transferência de negociação.
 */
export function getSelectableStagesForPipeline(
  pipeline: TransferPipelineOption | null | undefined,
  canSendToHidden: boolean = false,
): TransferPipelineStageOption[] {
  if (!pipeline) return [];
  const raw =
    pipeline.isVisible === false || (canSendToHidden && pipeline.allStages?.length)
      ? pipeline.allStages || pipeline.stages || []
      : pipeline.stages || [];
  return [...raw].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
}

export function isHiddenTransferTarget(
  pipeline: TransferPipelineOption | null | undefined,
  stage: TransferPipelineStageOption | null | undefined,
): boolean {
  return Boolean(pipeline?.isVisible === false || stage?.isVisible === false);
}

/**
 * Espelha a regra de `requireCrmTransitionAccess`:
 * se o operador atual é o responsável do card e move o card para uma etapa/funil sem
 * visibilidade, ele precisa escolher outro responsável.
 */
export function requiresHiddenStageReassignment(params: {
  pipeline: TransferPipelineOption | null | undefined;
  stage: TransferPipelineStageOption | null | undefined;
  dealOwnerId: string | null | undefined;
  currentOperatorId: string | null | undefined;
}): boolean {
  if (!isHiddenTransferTarget(params.pipeline, params.stage)) return false;
  if (!params.currentOperatorId) return false;
  return Boolean(params.dealOwnerId && params.dealOwnerId === params.currentOperatorId);
}

export interface BuildDealActionPatchInput {
  mode: Exclude<ChatTransferDealMode, "none">;
  currentDeal: {
    status?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
    operatorId?: string | null;
    lossReason?: string | null;
    version?: number;
  };
  currentOperatorId?: string | null;
  winReason?: string;
  lossReason?: string;
  pauseReason?: string;
  targetPipeline?: TransferPipelineOption | null;
  targetStage?: TransferPipelineStageOption | null;
  targetOperatorId?: string | null;
  /** Quando true, mantém o responsável atual sem enviar `operatorId` no PATCH */
  keepCurrentOperator?: boolean;
  customFields?: CustomFieldValues;
}

export type BuildDealActionPatchResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string; code: string };

export function buildDealActionPatchPayload(
  input: BuildDealActionPatchInput,
): BuildDealActionPatchResult {
  const baseVersion =
    typeof input.currentDeal.version === "number"
      ? { expectedVersion: input.currentDeal.version }
      : {};

  if (input.mode === "mark_won") {
    return {
      ok: true,
      payload: {
        ...baseVersion,
        status: "won",
        winReason: input.winReason?.trim() || undefined,
        pausedReason: null,
      },
    };
  }

  if (input.mode === "mark_lost") {
    const lossCheck = resolveRequiredLossReason({
      currentStatus: input.currentDeal.status,
      currentLossReason: input.currentDeal.lossReason,
      nextStatus: "lost",
      explicitStatus: "lost",
      incomingLossReason: input.lossReason ?? "",
    });
    if (!lossCheck.ok) {
      return { ok: false, error: lossCheck.error, code: lossCheck.code };
    }
    return {
      ok: true,
      payload: {
        ...baseVersion,
        status: "lost",
        lossReason: lossCheck.lossReason,
        pausedReason: null,
      },
    };
  }

  if (input.mode === "mark_paused") {
    if (input.currentDeal.status === "paused") {
      return {
        ok: false,
        error: "A negociação atual já está pausada.",
        code: "ALREADY_PAUSED",
      };
    }
    return {
      ok: true,
      payload: {
        ...baseVersion,
        status: "paused",
        pausedReason: input.pauseReason?.trim() || undefined,
      },
    };
  }

  // mode === "transfer_deal"
  if (!input.targetPipeline?.id) {
    return {
      ok: false,
      error: "Selecione o funil de destino da negociação.",
      code: "PIPELINE_REQUIRED",
    };
  }
  if (!input.targetStage?.id) {
    return {
      ok: false,
      error: "Selecione a etapa de destino da negociação.",
      code: "STAGE_REQUIRED",
    };
  }

  const effectiveOperatorId = input.keepCurrentOperator
    ? (input.currentDeal.operatorId ?? null)
    : (input.targetOperatorId ?? null);

  if (
    requiresHiddenStageReassignment({
      pipeline: input.targetPipeline,
      stage: input.targetStage,
      dealOwnerId: input.currentDeal.operatorId,
      currentOperatorId: input.currentOperatorId,
    }) &&
    (!effectiveOperatorId || effectiveOperatorId === input.currentOperatorId)
  ) {
    return {
      ok: false,
      error:
        "Para transferir a negociação para uma etapa/funil sem visibilidade, escolha outro responsável.",
      code: "REASSIGNMENT_REQUIRED",
    };
  }

  let validatedLossReason: string | null | undefined;
  if (input.targetStage.isLossStage) {
    const lossCheck = resolveRequiredLossReason({
      currentStatus: input.currentDeal.status,
      currentLossReason: input.currentDeal.lossReason,
      nextStatus: "lost",
      explicitStatus: undefined,
      incomingLossReason: input.lossReason ?? "",
    });
    if (!lossCheck.ok) {
      return { ok: false, error: lossCheck.error, code: lossCheck.code };
    }
    validatedLossReason = lossCheck.lossReason;
  }

  const payload: Record<string, unknown> = {
    ...baseVersion,
  };

  if (input.targetPipeline.id !== input.currentDeal.pipelineId) {
    payload.pipelineId = input.targetPipeline.id;
  }
  if (
    input.targetStage.id !== input.currentDeal.stageId ||
    input.targetPipeline.id !== input.currentDeal.pipelineId
  ) {
    payload.stageId = input.targetStage.id;
  }
  if (!input.keepCurrentOperator && effectiveOperatorId !== (input.currentDeal.operatorId ?? null)) {
    payload.operatorId = effectiveOperatorId;
  }
  if (validatedLossReason) {
    payload.lossReason = validatedLossReason;
  }
  if (input.customFields && Object.keys(input.customFields).length > 0) {
    payload.customFields = input.customFields;
  }

  // Se nada mudou na negociação, evita PATCH vazio desnecessário mas alerta o operador
  const hasAnyMutation =
    payload.pipelineId !== undefined ||
    payload.stageId !== undefined ||
    payload.operatorId !== undefined ||
    payload.lossReason !== undefined ||
    payload.customFields !== undefined;

  if (!hasAnyMutation) {
    return {
      ok: false,
      error:
        "Altere o funil, a etapa ou o responsável para transferir a negociação, ou clique em \"Transferir apenas conversa\".",
      code: "NO_DEAL_CHANGES",
    };
  }

  return { ok: true, payload };
}
