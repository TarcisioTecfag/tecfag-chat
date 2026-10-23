import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { accessGroups, operators } from "../../db/schema";
import { normalizeGroupPermissions } from "../rbac";
import { effectiveLegacyGroup } from "./legacy-session-group";

/** For server producers without a browser session. Identity is never taken from notification payload. */
export async function loadOperatorAccess(tenantId: string, operatorId: string) {
  const [operator] = await db.select({ id: operators.id, role: operators.role, groupId: operators.groupId }).from(operators)
    .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId))).limit(1);
  if (!operator) return null;
  const [group] = operator.groupId ? await db.select().from(accessGroups).where(and(
    eq(accessGroups.tenantId, tenantId), eq(accessGroups.id, operator.groupId),
  )).limit(1) : [];
  const accessGroup = effectiveLegacyGroup(group, operator.role, tenantId);
  return { tenantId, operator, accessGroup, permissions: normalizeGroupPermissions(accessGroup) };
}
