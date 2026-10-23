import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { crmDeals, crmStages } from "../../db/schema";
import type { AuthSessionContext } from "../auth-session";
import { requireCrmPermission } from "../rbac";

/** Shared parent-record check for every deal subresource; IDs never override tenant. */
export async function requireCrmDealAccess(session: AuthSessionContext, dealId: string): Promise<Response | null> {
  const permission = requireCrmPermission(session, "canViewCrm");
  if (permission) return permission;
  const conditions = [eq(crmDeals.tenantId, session.tenantId), eq(crmDeals.id, dealId)];
  if (session.operator.role !== "admin" && session.permissions?.crm?.canViewAllDeals !== true) {
    conditions.push(eq(crmDeals.operatorId, session.operator.id));
  }
  const [deal] = await db.select({ id: crmDeals.id }).from(crmDeals).where(and(...conditions)).limit(1);
  return deal ? null : Response.json({ error: "Negociação não encontrada.", code: "NOT_FOUND" }, { status: 404 });
}

/** Authorize the effective transition, including terminal stages without status in the body. */
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
  if (!input.stageId && !input.pipelineId) return null;
  const conditions = [eq(crmStages.tenantId, session.tenantId)];
  if (input.stageId) conditions.push(eq(crmStages.id, input.stageId));
  else conditions.push(eq(crmStages.pipelineId, input.pipelineId!));
  const [stage] = await db.select({ isWinStage: crmStages.isWinStage, isLossStage: crmStages.isLossStage })
    .from(crmStages).where(and(...conditions)).orderBy(asc(crmStages.orderIndex)).limit(1);
  if (stage?.isWinStage || stage?.isLossStage) return requireCrmPermission(session, "canCloseDeals");
  return null;
}
