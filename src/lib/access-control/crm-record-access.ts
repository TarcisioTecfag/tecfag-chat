import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { crmDeals, crmStages } from "../../db/schema";
import type { AuthSessionContext } from "../auth-session";
import { getAllowedPipelineIds, isPipelineAllowed, requireCrmPermission } from "../rbac";

export { getAllowedPipelineIds, isPipelineAllowed };

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
    .select({ id: crmDeals.id, pipelineId: crmDeals.pipelineId })
    .from(crmDeals)
    .where(and(...conditions))
    .limit(1);
  if (!deal) return Response.json({ error: "Negociação não encontrada.", code: "NOT_FOUND" }, { status: 404 });
  if (allowedPipelines !== null && deal.pipelineId && !allowedPipelines.includes(deal.pipelineId)) {
    return Response.json({ error: "Negociação não encontrada.", code: "NOT_FOUND" }, { status: 404 });
  }
  return null;
}

/** Authorize the effective transition, including terminal stages without status in the body and funnel restrictions. */
export async function requireCrmTransitionAccess(
  session: AuthSessionContext,
  input: { stageId?: string; pipelineId?: string; status?: string },
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
  if (input.pipelineId && allowedPipelines !== null && !allowedPipelines.includes(input.pipelineId.trim())) {
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
      isWinStage: crmStages.isWinStage,
      isLossStage: crmStages.isLossStage,
      pipelineId: crmStages.pipelineId,
    })
    .from(crmStages)
    .where(and(...conditions))
    .orderBy(asc(crmStages.orderIndex))
    .limit(1);
  if (stage?.pipelineId && allowedPipelines !== null && !allowedPipelines.includes(stage.pipelineId)) {
    return Response.json(
      {
        error: "Permissão insuficiente: a etapa selecionada pertence a um funil não autorizado para o seu grupo.",
        code: "FORBIDDEN",
      },
      { status: 403 }
    );
  }
  if (stage?.isWinStage || stage?.isLossStage) return requireCrmPermission(session, "canCloseDeals");
  return null;
}

