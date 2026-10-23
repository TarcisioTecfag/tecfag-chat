import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { apiRequest, loadAccessSource, routeStub } from "./helpers/access-harness.mjs";

const { groupRevision } = loadAccessSource("src/lib/access-control/group-revision.ts");
const table = (name) => Object.fromEntries(["id", "tenantId", "groupId"].map((key) => [key, `${name}.${key}`]).concat([["name", name]]));
const schema = { accessGroups: table("groups"), operators: table("members"), crmActionHistory: table("history") };
const eq = (column, value) => ({ column, value });
const and = (...all) => ({ all });
const matches = (row, predicate) => !predicate || (predicate.all
  ? predicate.all.every((condition) => matches(row, condition)) : row[predicate.column.split(".").at(-1)] === predicate.value);

function harness({ authenticated = true, role = "admin", auditFails = false } = {}) {
  let state = { groups: [], members: [], history: [] };
  const locks = [];
  const db = {
    transaction: async (fn) => {
      const backup = structuredClone(state);
      try { return await fn(db); } catch (error) { state = backup; throw error; }
    },
    select: () => {
      let source, predicate, limit;
      const query = {
        from: (t) => { source = t.name; return query; },
        where: (p) => { predicate = p; return query; },
        for: (kind) => { locks.push(kind); return query; },
        limit: (value) => { limit = value; return query; },
        then: (resolve) => resolve(structuredClone(state[source].filter((row) => matches(row, predicate)).slice(0, limit))),
      };
      return query;
    },
    insert: (t) => ({ values: (value) => {
      if (t.name === "history" && auditFails) throw Error("Simulated audit write failure");
      const row = structuredClone(value);
      if (t.name === "groups") row.createdAt ??= new Date("2026-01-01");
      state[t.name].push(row);
      return { returning: async () => [structuredClone(row)], then: (resolve) => resolve() };
    } }),
    update: (t) => ({ set: (values) => ({ where: (predicate) => ({ returning: async () => {
      const rows = state[t.name].filter((row) => matches(row, predicate));
      rows.forEach((row) => Object.assign(row, structuredClone(values)));
      return structuredClone(rows);
    } }) }) }),
    delete: (t) => ({ where: async (p) => { state[t.name] = state[t.name].filter((row) => !matches(row, p)); } }),
  };
  const session = { tenantId: "tenant-a", operator: { id: "admin-a", role, name: "Administrador" } };
  const route = loadAccessSource("src/routes/api/groups.ts", {
    "@tanstack/react-router": routeStub,
    "../../db/index.js": { db }, "../../db/schema.js": schema, "drizzle-orm": { eq, and },
    "../../lib/auth-session.js": { requireSession: async () => authenticated ? { session } : { response: new Response(null, { status: 401 }) } },
    "../../lib/http-cache.js": { handleConditionalResponse: (_, data) => Response.json(data) },
  }).Route.server.handlers;
  const group = { id: "restricted", tenantId: "tenant-a", name: "Vendedores", allowedTenants: ["tenant-a"], allowedChannels: ["whatsapp"],
    permissions: { views: { chat: true, analytics: false }, chat: { canCaptureChat: true, canViewAllChats: false },
      extension: { custom: "keep" } }, createdAt: new Date("2026-01-01") };
  state.groups.push(structuredClone(group), { ...structuredClone(group), id: "foreign", tenantId: "tenant-b" });
  return { state: () => state, locks, group, route,
    post: (body) => route.POST({ request: apiRequest(body) }),
    remove: (id = group.id, revision = groupRevision(group)) => route.DELETE({ request: apiRequest(undefined, "DELETE", `http://test/api/groups?id=${id}&revision=${revision}`) }),
  };
}

describe("grupos: preservação, concorrência, exclusão e auditoria", () => {
  it("recusa sessão ausente e agente sem executar mutações", async () => {
    for (const options of [{ authenticated: false }, { role: "agent" }]) {
      const h = harness(options), before = structuredClone(h.state());
      assert.equal((await h.post({ id: "g", name: "Teste" })).status, options.authenticated === false ? 401 : 403);
      assert.deepEqual(h.state(), before);
    }
  });
  it("GET expõe revisão e somente os grupos do tenant", async () => {
    const h = harness(); const response = await h.route.GET({ request: apiRequest(undefined, "GET") });
    const rows = await response.json();
    assert.equal(rows.length, 1); assert.equal(rows[0].revision, groupRevision(h.group));
  });
  it("salva campo isolado e guarda cópia exata do estado anterior na mesma transação", async () => {
    const h = harness(); const response = await h.post({ id: h.group.id, name: h.group.name,
      expectedRevision: groupRevision(h.group), permissions: { chat: { canCaptureChat: false } }, tenantId: "tenant-b" });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.tenantId, "tenant-a");
    assert.deepEqual(saved.permissions.extension, { custom: "keep" });
    assert.equal(saved.permissions.chat.canViewAllChats, false);
    assert.equal(saved.permissions.views.analytics, false);
    assert.deepEqual(h.state().history[0].details.before, h.group);
    assert.notEqual(saved.revision, groupRevision(h.group));
    assert.ok(h.locks.includes("update"));
  });
  it("edição concorrente retorna o estado confirmado e não apaga configurações", async () => {
    const h = harness(); h.state().groups[0].allowedChannels.push("livechat");
    const response = await h.post({ id: h.group.id, name: h.group.name, expectedRevision: groupRevision(h.group), permissions: { views: { chat: false } } });
    assert.equal(response.status, 409);
    assert.deepEqual((await response.json()).group.allowedChannels, ["whatsapp", "livechat"]);
    assert.equal(h.state().history.length, 0);
    assert.equal(h.state().groups[0].permissions.views.chat, true);
  });
  it("falha ao gravar histórico desfaz alteração do grupo", async () => {
    const h = harness({ auditFails: true }), before = structuredClone(h.state());
    assert.equal((await h.post({ id: h.group.id, name: "Mudança", revision: groupRevision(h.group) })).status, 500);
    assert.deepEqual(h.state(), before);
  });
  it("bloqueia exclusão de grupo com membros e preserva todos os vínculos", async () => {
    const h = harness(); h.state().members.push({ id: "op", tenantId: "tenant-a", groupId: h.group.id });
    const before = structuredClone(h.state());
    assert.equal((await h.remove()).status, 409); assert.deepEqual(h.state(), before);
  });
  it("exclui grupo vazio com snapshot e sem tocar grupo de outra empresa", async () => {
    const h = harness(); assert.equal((await h.remove()).status, 200);
    assert.equal(h.state().groups.length, 1); assert.equal(h.state().groups[0].tenantId, "tenant-b");
    assert.deepEqual(h.state().history[0].details.before, h.group);
  });
  it("recusa exclusão com revisão antiga e ID de outro tenant", async () => {
    const h = harness(); assert.equal((await h.remove(h.group.id, "old")).status, 409);
    assert.equal((await h.remove("foreign")).status, 404);
    assert.equal(h.state().history.length, 0);
  });
  it("criação de grupo novo não depende de defaults administrativos", async () => {
    const h = harness(); const response = await h.post({ id: "new", name: "Novo", permissions: {} });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.permissions.security.canManageUsers, false);
    assert.equal(saved.permissions.crm.canDeleteDeals, false);
    assert.equal(saved.canCreateUser, false);
  });
});
