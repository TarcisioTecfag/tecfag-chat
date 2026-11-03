import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { crmDeals, crmStages } from "../../db/schema";
import type { AuthSessionContext } from "../auth-session";
import {
  canSendDealToTarget,
  getAllowedPipelineIds,
  getAllowedStageIdsByPipelineMap,
  getVisibleStageIdsForPipeline,
  isPipelineAllowed,
  isStageVisibleToSession,
  requireCrmPermission,
} from "../rbac";

export {
  canSendDealToTarget,
  getAllowedPipelineIds,
  getAllowedStageIdsByPipelineMap,
  getVisibleStageIdsForPipeline,
  isPipelineAllowed,
  isStageVisibleToSession,
};

/** Mesma visibilidade de cards para lista do chat e seletor da negociação atual. */
export function canReadCrmDeal(
  session: AuthSessionContext,
  deal: { pipelineId: string; stageId?: string | null; operatorId: string | null },
) {
  const admin = session.operator.role === "admin";
  const pipelines = getAllowedPipelineIds(session);
  const stageVisible = !deal.stageId || isStageVisibleToSession(session, deal.pipelineId, deal.stageId);
  return (
    (admin || session.permissions?.crm?.canViewCrm === true) &&
    (pipelines === null || pipelines.includes(deal.pipelineId)) &&
    stageVisible &&
    (admin || session.permissions?.crm?.canViewAllDeals === true || deal.operatorId === session.operator.id)
  );
}

/** Shared parent-record check for every deal subresource; IDs never override tenant. */
export async function requireCrmDealAccess(session: AuthSessionContext, dealId: string): Promise<Response | null> {
  const permission = requireCrmPermission(session, "canViewCrm");
  if (permission) return permission;
  const allowedPipelines = getAllowedPipelineIds(session);
  if (allowedPipelines !== null && allowedPipelines.length === 0) {
    return Response.json({ error: "Negociação não encontrada.", code: "NOT_FOUND" }, { status: 404 });
  }
  const conditions = [eq(crmDeals.tenantId, session.tenantId), eq(crmDeals.id, dealId)];
  if (session.operator.role !== "admin" && session.permissions?.crm?.canViewAllDeals !== true) {
    conditions.push(eq(crmDeals.operatorId, session.operator.id));
  }
  if (allowedPipelines !== null && allowedPipelines.length === 1) {
    conditions.push(eq(crmDeals.pipelineId, allowedPipelines[0]));
  }
  const [deal] = await db
    .select({ id: crmDeals.id, pipelineId: crmDeals.pipelineId, stageId: crmDeals.stageId })
    .from(crmDeals)
    .where(and(...conditions))
    .limit(1);
  if (!deal) return Response.json({ error: "Negociação não encontrada.", code: "NOT_FOUND" }, { status: 404 });
  if (allowedPipelines !== null && deal.pipelineId && !allowedPipelines.includes(deal.pipelineId)) {
    return Response.json({ error: "Negociação não encontrada.", code: "NOT_FOUND" }, { status: 404 });
  }
  if (deal.pipelineId && deal.stageId && !isStageVisibleToSession(session, deal.pipelineId, deal.stageId)) {
    return Response.json({ error: "Negociação não encontrada.", code: "NOT_FOUND" }, { status: 404 });
  }
  return null;
}

/** Authorize the effective transition, including terminal stages without status in the body and funnel/stage restrictions. */
export async function requireCrmTransitionAccess(
  session: AuthSessionContext,
  input: {
    stageId?: string;
    pipelineId?: string;
    status?: string;
    operatorId?: string | null;
    ownerId?: string | null;
  },
  currentDeal?: {
    dealId?: string;
    pipelineId?: string | null;
    stageId?: string | null;
    operatorId?: string | null;
  } | null,
): Promise<Response | null> {
  if (input.stageId || input.pipelineId) {
    const denied = requireCrmPermission(session, "canMoveStages");
    if (denied) return denied;
  }
  if (input.status === "won" || input.status === "lost") {
    const denied = requireCrmPermission(session, "canCloseDeals");
    if (denied) return denied;
  }
  const allowedPipelines = getAllowedPipelineIds(session);
  if (
    input.pipelineId &&
    allowedPipelines !== null &&
    !allowedPipelines.includes(input.pipelineId.trim()) &&
    !canSendDealToTarget(session, input.pipelineId.trim(), input.stageId)
  ) {
    return Response.json(
      { error: "Permissão insuficiente: seu grupo não possui acesso ao funil selecionado.", code: "FORBIDDEN" },
      { status: 403 }
    );
  }
  if (!input.stageId && !input.pipelineId) return null;
  const conditions = [eq(crmStages.tenantId, session.tenantId)];
  if (input.stageId) conditions.push(eq(crmStages.id, input.stageId));
  else conditions.push(eq(crmStages.pipelineId, input.pipelineId!));
  const [stage] = await db
    .select({
      id: crmStages.id,
      isWinStage: crmStages.isWinStage,
      isLossStage: crmStages.isLossStage,
      pipelineId: crmStages.pipelineId,
    })
    .from(crmStages)
    .where(and(...conditions))
    .orderBy(asc(crmStages.orderIndex))
    .limit(1);

  const effectivePipelineId = stage?.pipelineId || input.pipelineId?.trim() || currentDeal?.pipelineId || undefined;
  const effectiveStageId = stage?.id || input.stageId?.trim() || undefined;

  if (
    stage?.pipelineId &&
    allowedPipelines !== null &&
    !allowedPipelines.includes(stage.pipelineId) &&
    !canSendDealToTarget(session, stage.pipelineId, effectiveStageId)
  ) {
    return Response.json(
      {
        error: "Permissão insuficiente: a etapa selecionada pertence a um funil não autorizado para o seu grupo.",
        code: "FORBIDDEN",
      },
      { status: 403 }
    );
  }
  if (stage?.isWinStage || stage?.isLossStage) {
    const closeDenied = requireCrmPermission(session, "canCloseDeals");
    if (closeDenied) return closeDenied;
  }

  // Se o destino for uma etapa ou funil sem visibilidade para o operador atual:
  if (effectivePipelineId && !isStageVisibleToSession(session, effectivePipelineId, effectiveStageId)) {
    if (!canSendDealToTarget(session, effectivePipelineId, effectiveStageId)) {
      return Response.json(
        {
          error: "Permissão insuficiente: seu grupo não pode transferir negociações para esta etapa ou funil oculto.",
          code: "FORBIDDEN",
        },
        { status: 403 }
      );
    }

    // Regra de negócio: se o operador atual é o responsável pelo card e vai movê-lo para
    // uma etapa/funil onde perderá a visibilidade, ele DEVE escolher outro responsável.
    let resolvedDealOwnerId = currentDeal?.operatorId;
    if (resolvedDealOwnerId === undefined && currentDeal?.dealId) {
      const [existingDeal] = await db
        .select({ operatorId: crmDeals.operatorId })
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, session.tenantId), eq(crmDeals.id, currentDeal.dealId)))
        .limit(1);
      resolvedDealOwnerId = existingDeal?.operatorId ?? null;
    }

    const incomingOperatorId =
      input.operatorId !== undefined
        ? input.operatorId
        : input.ownerId !== undefined
          ? input.ownerId
          : undefined;
    const effectiveNextOperatorId =
      incomingOperatorId !== undefined ? incomingOperatorId : resolvedDealOwnerId;

    if (
      resolvedDealOwnerId !== undefined &&
      resolvedDealOwnerId === session.operator.id &&
      (!effectiveNextOperatorId || effectiveNextOperatorId === session.operator.id)
    ) {
      return Response.json(
        {
          error:
            "Antes de prosseguir, escolha outro responsável para a negociação, pois você não poderá mais visualizar ou atualizar este card nesta etapa/funil.",
          code: "REASSIGNMENT_REQUIRED",
        },
        { status: 400 }
      );
    }
  }

  return null;
}

