import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { apiRequest, loadAccessSource, routeStub } from "./helpers/access-harness.mjs";

const { DEFAULT_ADMIN_PERMISSIONS, requireCrmPermission } = loadAccessSource("src/lib/rbac.ts");
const { requirePermission } = loadAccessSource("src/lib/auth-session.ts", {
  "../db/index.js": {}, "../db/schema.js": {}, "drizzle-orm": {}, "./auth-crypto.js": {}, "./platform-access.js": {},
});
function fixtures({ authenticated = true, role = "admin", rows = [] } = {}) {
  const calls = [];
  const session = { tenantId: "tenant-a", operator: { id: "operator-a", role, name: "Teste" }, permissions: structuredClone(DEFAULT_ADMIN_PERMISSIONS) };
  const chain = (name) => {
    const query = { then: (resolve) => resolve(rows) };
    for (const step of ["from", "where", "set", "values", "returning", "limit", "orderBy"])
      query[step] = (...args) => { calls.push({ name: `${name}.${step}`, args }); return query; };
    return query;
  };
  const db = Object.fromEntries(["select", "insert", "update", "delete"].map((name) => [name, (...args) => { calls.push({ name, args }); return chain(name); }]));
  const schema = new Proxy({}, { get: (_, table) => new Proxy({}, { get: (_, key) => `${String(table)}.${String(key)}` }) });
  const drizzle = { eq: (...args) => ({ eq: args }), and: (...args) => ({ and: args }), asc: (value) => value };
  const auth = { requireSession: async () => authenticated ? { session } : { response: new Response(null, { status: 401 }) }, requirePermission };
  return { session, calls, db, schema, drizzle, auth };
}
function voiceRoute(file, fixture) {
  return loadAccessSource(`src/routes/api/${file}.ts`, {
    "@tanstack/react-router": routeStub, "../../db": { db: fixture.db }, "../../db/schema": fixture.schema,
    "drizzle-orm": fixture.drizzle, "../../lib/auth-session": fixture.auth,
    "../../lib/ai-persona": { getAiPersona: () => ({ name: "Teste" }) },
    "../../lib/crm/action-history": { recordCrmAction: async () => {} },
    "../../lib/rdCrmService": { rdRequest: async () => { throw Error("External send forbidden"); } },
  }).Route.server.handlers;
}

describe("rotas urgentes de voz e isolamento", () => {
  for (const [file, methods] of [["voice-objectives", ["GET", "POST", "PUT", "DELETE"]], ["voice-agenda", ["GET", "POST", "PUT", "DELETE"]], ["voice-enrich-contact", ["POST"]]]) {
    for (const method of methods) it(`${file} ${method}: sem sessão não consulta nem grava`, async () => {
      const f = fixtures({ authenticated: false }), route = voiceRoute(file, f);
      const response = await route[method]({ request: apiRequest(method === "GET" || method === "DELETE" ? undefined : {}, method) });
      assert.equal(response.status, 401); assert.equal(f.calls.length, 0);
    });
  }
  it("GET de objetivos é leitura pura e usa tenant da sessão", async () => {
    const f = fixtures(); const response = await voiceRoute("voice-objectives", f).GET({ request: apiRequest(undefined, "GET", "http://test/api?tenantId=tenant-b") });
    assert.equal(response.status, 200);
    assert.ok(f.calls.every((call) => !["insert", "update", "delete"].includes(call.name)));
    const where = f.calls.find((call) => call.name === "select.where");
    assert.deepEqual(where.args, [{ eq: ["voiceObjectives.tenantId", "tenant-a"] }]);
  });
  it("agenda ignora tenant do body e não aceita campos administrativos", async () => {
    const f = fixtures(), route = voiceRoute("voice-agenda", f);
    const response = await route.PUT({ request: apiRequest({ id: "ag", tenantId: "tenant-b", status: "completed" }, "PUT") });
    assert.equal(response.status, 200);
    const payload = f.calls.find((call) => call.name === "update.set").args[0];
    assert.equal(payload.tenantId, undefined); assert.equal(payload.status, "completed");
    assert.equal((await route.PUT({ request: apiRequest({ id: "ag", createdAt: "2000-01-01" }, "PUT") })).status, 400);
  });
  it("objetivos preservam o tenant e rejeitam alteração de isTemplate", async () => {
    const f = fixtures(), route = voiceRoute("voice-objectives", f);
    assert.equal((await route.PUT({ request: apiRequest({ id: "o", tenantId: "tenant-b", isActive: false }, "PUT") })).status, 200);
    const payload = f.calls.find((call) => call.name === "update.set").args[0];
    assert.equal(payload.tenantId, undefined); assert.equal(payload.isActive, false);
    assert.equal((await route.PUT({ request: apiRequest({ id: "o", isTemplate: true }, "PUT") })).status, 400);
  });
  it("enriquecimento não altera contato ausente/fora do tenant nem cria tarefa", async () => {
    const f = fixtures(); const response = await voiceRoute("voice-enrich-contact", f).POST({ request: apiRequest({ contactId: "foreign", tenantId: "tenant-b", extractedInfo: { proximo_passo: "Ligar" } }) });
    assert.equal(response.status, 404);
    assert.ok(!f.calls.some((call) => ["insert", "update"].includes(call.name)));
    assert.ok(JSON.stringify(f.calls).includes('"tenant-a"'));
  });
  it("agenda e objetivos negados pelo grupo não acessam banco", async () => {
    const f = fixtures({ role: "agent" }); f.session.permissions.views.ligacoes = false;
    for (const name of ["voice-agenda", "voice-objectives"]) {
      assert.equal((await voiceRoute(name, f).GET({ request: apiRequest(undefined, "GET") })).status, 403);
    }
    assert.equal(f.calls.length, 0);
  });
});

describe("push vinculado à sessão", () => {
  const pushRoute = (f) => loadAccessSource("src/routes/api/push.ts", {
    "@tanstack/react-router": routeStub, "@/db": { db: f.db }, "@/db/schema": f.schema,
    "@/lib/push-notifications": { getVapidPublicKey: () => "public-key" }, "@/lib/auth-session": f.auth, "drizzle-orm": f.drizzle,
  }).Route.server.handlers;
  it("não permite cadastro/remoção sem login", async () => {
    const f = fixtures({ authenticated: false }), route = pushRoute(f);
    assert.equal((await route.POST({ request: apiRequest({}) })).status, 401);
    assert.equal((await route.DELETE({ request: apiRequest(undefined, "DELETE") })).status, 401);
    assert.equal(f.calls.length, 0);
  });
  it("tenant e operador arbitrários são ignorados no cadastro", async () => {
    const f = fixtures(), route = pushRoute(f);
    const response = await route.POST({ request: apiRequest({ tenantId: "tenant-b", operatorId: "operator-b", subscription: {
      endpoint: "https://push.example.test/sub", keys: { p256dh: "key", auth: "auth" },
    } }) });
    assert.equal(response.status, 200);
    const saved = f.calls.find((call) => call.name === "insert.values").args[0];
    assert.equal(saved.tenantId, "tenant-a"); assert.equal(saved.operatorId, "operator-a");
  });
  it("remoção filtra empresa e dono da assinatura", async () => {
    const f = fixtures(), route = pushRoute(f);
    assert.equal((await route.DELETE({ request: apiRequest(undefined, "DELETE", "http://test/api?endpoint=https://push.example.test/sub&tenantId=tenant-b") })).status, 200);
    const conditions = f.calls.find((call) => call.name === "delete.where").args[0].and;
    assert.ok(conditions.some((p) => p.eq[0] === "pushSubscriptions.tenantId" && p.eq[1] === "tenant-a"));
    assert.ok(conditions.some((p) => p.eq[0] === "pushSubscriptions.operatorId" && p.eq[1] === "operator-a"));
  });
});

describe("negociações: autorização do pai e transição efetiva", () => {
  function guard(f) { return loadAccessSource("src/lib/access-control/crm-record-access.ts", {
    "../../db": { db: f.db }, "../../db/schema": f.schema, "drizzle-orm": f.drizzle,
  }); }
  it("ação sem leitura CRM é negada antes de consulta", async () => {
    const f = fixtures({ role: "agent" }); f.session.permissions.crm.canViewCrm = false;
    assert.equal((await guard(f).requireCrmDealAccess(f.session, "deal")).status, 403); assert.equal(f.calls.length, 0);
  });
  it("negócio alheio é buscado com tenant e responsável obrigatórios", async () => {
    const f = fixtures({ role: "agent" }); f.session.permissions.crm.canViewAllDeals = false;
    assert.equal((await guard(f).requireCrmDealAccess(f.session, "foreign")).status, 404);
    const conditions = f.calls.find((c) => c.name === "select.where").args[0].and;
    assert.ok(conditions.some((p) => p.eq[0] === "crmDeals.operatorId" && p.eq[1] === "operator-a"));
    assert.ok(conditions.some((p) => p.eq[0] === "crmDeals.tenantId" && p.eq[1] === "tenant-a"));
  });
  it("etapa terminal exige fechamento mesmo sem status no body", async () => {
    const f = fixtures({ role: "agent", rows: [{ isWinStage: true, isLossStage: false }] });
    f.session.permissions.crm.canCloseDeals = false;
    assert.equal((await guard(f).requireCrmTransitionAccess(f.session, { stageId: "win" })).status, 403);
  });
  it("trocar funil também exige mover etapas", async () => {
    const f = fixtures({ role: "agent" }); f.session.permissions.crm.canMoveStages = false;
    assert.equal((await guard(f).requireCrmTransitionAccess(f.session, { pipelineId: "p" })).status, 403);
    assert.equal(f.calls.length, 0);
  });
  it("excluir/exportar não são herdados da edição de grupo legado", () => {
    const f = fixtures({ role: "agent" }); delete f.session.permissions.crm.canDeleteDeals; delete f.session.permissions.crm.canExportDeals;
    assert.equal(requireCrmPermission(f.session, "canDeleteDeals").status, 403);
    assert.equal(requireCrmPermission(f.session, "canExportDeals").status, 403);
    assert.equal(requireCrmPermission(f.session, "canEditDeals"), null);
  });
});
