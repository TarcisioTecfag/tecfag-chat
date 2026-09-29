import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  authSessions,
  operators,
  platformAccessGroups,
  platformAccessManagers,
  platformAccounts,
  tenants,
} from "../db/schema.js";

export async function canManagePlatformAccess(operator: {
  email: string;
  role: string;
  tenantId: string;
}): Promise<boolean> {
  if (operator.role !== "admin") return false;
  const manager = await db.query.platformAccessManagers.findFirst({
    where: and(
      eq(platformAccessManagers.email, operator.email.trim().toLowerCase()),
      eq(platformAccessManagers.tenantId, operator.tenantId),
    ),
  });
  return !!manager;
}

/** Grupos globais autorizam a entrada; a linha de operador mantém as permissões locais. */
export async function getPlatformMembership(accountId: string, tenantId: string) {
  const account = await db.query.platformAccounts.findFirst({
    where: eq(platformAccounts.id, accountId),
  });
  if (!account) return null;
  const group = account.groupId
    ? await db.query.platformAccessGroups.findFirst({
        where: eq(platformAccessGroups.id, account.groupId),
      })
    : null;
  const permitted = tenantId === account.homeTenantId || !!group?.allowedTenants.includes(tenantId);
  if (!permitted) return null;
  const operator = await db.query.operators.findFirst({
    where: and(eq(operators.accountId, accountId), eq(operators.tenantId, tenantId)),
  });
  return operator ? { account, group, operator } : null;
}

export async function getAvailableTenants(accountId: string): Promise<string[]> {
  const account = await db.query.platformAccounts.findFirst({
    where: eq(platformAccounts.id, accountId),
  });
  if (!account) return [];
  const group = account.groupId
    ? await db.query.platformAccessGroups.findFirst({
        where: eq(platformAccessGroups.id, account.groupId),
      })
    : null;
  const validTenants = await db.select({ id: tenants.id }).from(tenants);
  const validIds = new Set(validTenants.map((row) => row.id));
  const available: string[] = [];
  for (const tenantId of new Set([account.homeTenantId, ...(group?.allowedTenants ?? [])])) {
    if (!validIds.has(tenantId)) continue;
    const operator = await db.query.operators.findFirst({
      where: and(eq(operators.accountId, accountId), eq(operators.tenantId, tenantId)),
    });
    if (operator) available.push(tenantId);
  }
  return available;
}

export async function revokeAccountSessions(accountId: string): Promise<void> {
  const tenantRows = await db.select({ id: tenants.id }).from(tenants);
  for (const row of tenantRows) {
    const members = await db
      .select({ id: operators.id })
      .from(operators)
      .where(and(eq(operators.tenantId, row.id), eq(operators.accountId, accountId)));
    for (const member of members) {
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.tenantId, row.id),
            eq(authSessions.operatorId, member.id),
            isNull(authSessions.revokedAt),
          ),
        );
    }
  }
}
