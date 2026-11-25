import crypto from "node:crypto";
import { db } from "../../db";
import { crmActionHistory } from "../../db/schema";
import {
  type AuditOriginContext,
  resolveAuditOrigin,
} from "../audit/audit-context";
import { ensureAuditOriginSchema } from "../audit/audit-schema";

export async function recordCrmAction(
  input: {
    tenantId: string;
    operatorId: string | null;
    operatorName: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    itemCount: number;
    details?: Record<string, unknown>;
    originOverride?: Partial<AuditOriginContext> | null;
  },
  executor: Pick<typeof db, "insert"> = db,
) {
  await ensureAuditOriginSchema().catch(() => {});

  const baseDetails = input.details ? { ...input.details } : {};
  const origin = resolveAuditOrigin({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    operatorName: input.operatorName,
    metadata: baseDetails,
    override: input.originOverride,
  });

  const inferredEntityId =
    input.entityId ||
    (typeof baseDetails.entityId === "string" && baseDetails.entityId) ||
    (typeof baseDetails.dealId === "string" && baseDetails.dealId) ||
    (typeof baseDetails.contactId === "string" && baseDetails.contactId) ||
    (typeof baseDetails.accountId === "string" && baseDetails.accountId) ||
    (typeof baseDetails.taskId === "string" && baseDetails.taskId) ||
    (typeof baseDetails.activityId === "string" && baseDetails.activityId) ||
    (typeof baseDetails.conversationId === "string" && baseDetails.conversationId) ||
    null;

  const enrichedDetails: Record<string, unknown> = {
    ...baseDetails,
    actorType: origin.actorType,
    sourceChannel: origin.sourceChannel,
    actorName: origin.actorName,
    ...(origin.clientIp ? { clientIp: origin.clientIp } : {}),
    ...(origin.mcpKeyId ? { mcpKeyId: origin.mcpKeyId } : {}),
    ...(origin.mcpKeyLabel ? { mcpKeyLabel: origin.mcpKeyLabel } : {}),
    ...(origin.mcpToolName ? { mcpToolName: origin.mcpToolName } : {}),
  };

  await executor.insert(crmActionHistory).values({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    operatorId: origin.actorOperatorId,
    operatorName: origin.actorName || input.operatorName || "Sistema",
    action: input.action,
    entityType: input.entityType,
    entityId: inferredEntityId,
    actorType: origin.actorType,
    sourceChannel: origin.sourceChannel,
    clientIp: origin.clientIp,
    mcpKeyId: origin.mcpKeyId,
    mcpKeyLabel: origin.mcpKeyLabel,
    itemCount: input.itemCount,
    details: enrichedDetails,
  });
}
