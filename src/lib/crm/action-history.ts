import { db } from "../../db";
import { crmActionHistory } from "../../db/schema";

export async function recordCrmAction(input: {
  tenantId: string;
  operatorId: string | null;
  operatorName: string;
  action: string;
  entityType: string;
  itemCount: number;
  details?: Record<string, unknown>;
}) {
  await db.insert(crmActionHistory).values({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    operatorName: input.operatorName,
    action: input.action,
    entityType: input.entityType,
    itemCount: input.itemCount,
    details: input.details || {},
  });
}
