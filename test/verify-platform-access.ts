/** Execute apenas com TEST_DATABASE_URL apontando para um banco dedicado e migrado. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, client, assertTestDatabaseIsolation } from "../src/db/index";
import {
  accessGroups,
  authSessions,
  operators,
  platformAccessGroups,
  platformAccounts,
  tenants,
} from "../src/db/schema";
import { createSession, getAuthSession, SESSION_COOKIE_NAME } from "../src/lib/auth-session";
import { hashPassword } from "../src/lib/auth-crypto";
import { Route as SwitchRoute } from "../src/routes/api/auth/switch-tenant";

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL é obrigatório.");
await assertTestDatabaseIsolation();

const suffix = randomUUID().slice(0, 8);
const home = `access-test-${suffix}-a`;
const target = `access-test-${suffix}-b`;
const groupId = `access-test-group-${suffix}`;
const accountId = `access-test-account-${suffix}`;
const homeOpId = `access-test-op-a-${suffix}`;
const targetOpId = `access-test-op-b-${suffix}`;
const homeGroupId = `access-test-local-a-${suffix}`;
const targetGroupId = `access-test-local-b-${suffix}`;
const email = `access-${suffix}@example.test`;

try {
  await db.insert(tenants).values([
    { id: home, slug: home, name: "Home test", connectionType: "meta" },
    { id: target, slug: target, name: "Target test", connectionType: "meta" },
  ]);
  await db.insert(accessGroups).values([
    { id: homeGroupId, tenantId: home, name: "Home", allowedTenants: [home] },
    { id: targetGroupId, tenantId: target, name: "Target", allowedTenants: [target] },
  ]);
  await db
    .insert(platformAccessGroups)
    .values({ id: groupId, name: "Ambos", allowedTenants: [home, target] });
  await db.insert(platformAccounts).values({
    id: accountId,
    email,
    passwordHash: hashPassword("test-password"),
    homeTenantId: home,
    groupId,
  });
  await db.insert(operators).values([
    {
      id: homeOpId,
      tenantId: home,
      accountId,
      name: "Test",
      email,
      passwordHash: hashPassword("unused"),
      role: "admin",
      groupId: homeGroupId,
    },
    {
      id: targetOpId,
      tenantId: target,
      accountId,
      name: "Test",
      email,
      passwordHash: hashPassword("unused"),
      role: "agent",
      groupId: targetGroupId,
    },
  ]);

  const { token } = await createSession(home, homeOpId);
  const request = new Request("http://localhost/api/auth/switch-tenant", {
    method: "POST",
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: target }),
  });
  const handler = (
    SwitchRoute.options.server as unknown as {
      handlers: { POST: (args: { request: Request }) => Promise<Response> };
    }
  ).handlers.POST;
  const switched = await handler({ request });
  if (switched.status !== 200) throw new Error(`Troca autorizada retornou ${switched.status}`);
  const newCookie = switched.headers.get("Set-Cookie")?.split(";")[0];
  if (!newCookie) throw new Error("A troca não emitiu uma nova sessão.");
  const oldSession = await getAuthSession(
    new Request("http://localhost", { headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` } }),
  );
  if (oldSession) throw new Error("A sessão anterior permaneceu ativa.");
  const targetSession = await getAuthSession(
    new Request("http://localhost", { headers: { Cookie: newCookie } }),
  );
  if (targetSession?.tenantId !== target || targetSession.operator.id !== targetOpId) {
    throw new Error("A sessão nova não pertence ao operador do tenant de destino.");
  }

  await db
    .update(platformAccessGroups)
    .set({ allowedTenants: [home] })
    .where(eq(platformAccessGroups.id, groupId));
  const revokedTarget = await getAuthSession(
    new Request("http://localhost", { headers: { Cookie: newCookie } }),
  );
  if (revokedTarget) throw new Error("O acesso ao destino persistiu após remoção do grupo.");
  const { token: homeToken } = await createSession(home, homeOpId);
  const blocked = await handler({
    request: new Request("http://localhost/api/auth/switch-tenant", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${homeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenantId: target }),
    }),
  });
  if (blocked.status !== 403) throw new Error(`Troca sem autorização retornou ${blocked.status}`);
  console.log(
    "PASS: sessão trocada, sessão antiga revogada e acesso ao destino bloqueado após retirada do grupo.",
  );
} finally {
  for (const tenantId of [home, target]) {
    await db.delete(authSessions).where(eq(authSessions.tenantId, tenantId));
    await db.delete(operators).where(eq(operators.tenantId, tenantId));
  }
  await db.delete(platformAccounts).where(eq(platformAccounts.id, accountId));
  await db.delete(platformAccessGroups).where(eq(platformAccessGroups.id, groupId));
  for (const [tenantId, id] of [
    [home, homeGroupId],
    [target, targetGroupId],
  ]) {
    await db
      .delete(accessGroups)
      .where(and(eq(accessGroups.tenantId, tenantId), eq(accessGroups.id, id)));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
  await client.end();
}
