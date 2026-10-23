import fs from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { apiRequest, loadAccessSource, routeStub } from "./helpers/access-harness.mjs";

const { DEFAULT_ADMIN_PERMISSIONS, requireCrmPermission } = loadAccessSource("src/lib/rbac.ts");
const directory = new URL("../src/routes/api/crm/deals/", import.meta.url);

describe("cada operação de subrecurso valida o acesso à negociação pai", () => {
  const routes = [];
  for (const file of fs.readdirSync(directory, { recursive: true })) {
    if (!file.startsWith("$dealId") || !file.endsWith(".ts")) continue;
    const source = fs.readFileSync(new URL(file.replaceAll("\\", "/"), directory), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isPropertyAssignment(node) && /^(GET|POST|PATCH|DELETE)$/.test(node.name.getText(ast))) {
        routes.push({ file, method: node.name.getText(ast), handler: node.initializer.getText(ast) });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  it("cobre todas as operações atuais", () => assert.ok(routes.length >= 34));
  for (const { file, method, handler } of routes) it(`${file} ${method} nega antes de carregar/alterar conteúdo`, async () => {
    let checked = 0;
    const module = { exports: {} };
    const js = ts.transpileModule(`export const handler = ${handler}`, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    new Function("module", "exports", "requireSession", "requireCrmDealAccess", js)(module, module.exports,
      async () => ({ session: { tenantId: "fixture", operator: { id: "a" } } }),
      async (session, dealId) => {
        assert.equal(session.tenantId, "fixture"); assert.equal(dealId, "foreign"); checked++;
        return Response.json({ error: "Não encontrado" }, { status: 404 });
      });
    const response = await module.exports.handler({ request: apiRequest(method === "GET" || method === "DELETE" ? undefined : {}, method), params: { dealId: "foreign", fileId: "file", activityId: "activity" } });
    assert.equal(response.status, 404); assert.equal(checked, 1);
  });
});

function bulkHarness() {
  const calls = [];
  const session = { tenantId: "tenant-a", operator: { id: "a", role: "agent", name: "A" }, permissions: structuredClone(DEFAULT_ADMIN_PERMISSIONS) };
  session.permissions.crm.canViewAllDeals = false;
  const handler = loadAccessSource("src/routes/api/crm/deals/bulk.ts", {
    "@tanstack/react-router": routeStub,
    "../../../../lib/auth-session": { requireSession: async () => ({ session }) },
    "../../../../lib/access-control/crm-record-access": { requireCrmTransitionAccess: async () => null },
    "../../../../lib/crm/crm-service": { crmService: {
      bulkUpdateDeals: async (...args) => { calls.push(args); return { success: true }; },
      exportDealsRD: async (...args) => { calls.push(args); return { count: 0, filename: "test.csv", format: "csv", dealIds: [] }; },
    }, handleCrmError: (error) => { throw error; } },
    "../../../../db": { db: { insert: () => ({ values: async () => {} }) } },
    "../../../../db/schema": { crmActionHistory: {} },
  }).Route.server.handlers.POST;
  return { session, calls, run: (body) => handler({ request: apiRequest(body) }) };
}

describe("ações em massa usam capacidades próprias e escopo da sessão", () => {
  it("edição não autoriza lixeira ou exclusão permanente", async () => {
    for (const action of ["delete_trash", "delete_permanent"]) {
      const h = bulkHarness(); h.session.permissions.crm.canDeleteDeals = false;
      assert.equal((await h.run({ action, dealIds: ["b"] })).status, 403); assert.equal(h.calls.length, 0);
    }
  });
  it("leitura não autoriza exportação", async () => {
    const h = bulkHarness(); h.session.permissions.crm.canExportDeals = false;
    assert.equal((await h.run({ action: "export", allFiltered: true })).status, 403); assert.equal(h.calls.length, 0);
  });
  it("filtro arbitrário não altera a identidade autorizada na exportação", async () => {
    const h = bulkHarness(); assert.equal((await h.run({ action: "export", allFiltered: true, authorizedOperatorId: "b", filterParams: { operatorIds: ["b"] } })).status, 200);
    assert.equal(h.calls[0][1].authorizedOperatorId, "a");
  });
  it("edição em massa também entrega recorte obrigatório ao serviço", async () => {
    const h = bulkHarness(); assert.equal((await h.run({ allFiltered: true, filterParams: {}, rating: 2 })).status, 200);
    assert.equal(h.calls[0][4], "a");
  });
  it("ganhar/perder exige fechamento mesmo quando pode editar", async () => {
    const h = bulkHarness(); h.session.permissions.crm.canCloseDeals = false;
    assert.equal((await h.run({ dealIds: ["a"], status: "won" })).status, 403); assert.equal(h.calls.length, 0);
  });
  it("criação derivada exige criar negociações", async () => {
    const h = bulkHarness(); h.session.permissions.crm.canCreateDeals = false;
    assert.equal((await h.run({ dealIds: ["a"], action: "create_deals_for_companies" })).status, 403); assert.equal(h.calls.length, 0);
  });
});

describe("proposta deve pertencer ao negócio autorizado no endereço", () => {
  it("repassa o dealId esperado à atualização transacional", async () => {
    const calls = [];
    const session = { tenantId: "tenant-a", operator: { id: "a", role: "agent" }, permissions: DEFAULT_ADMIN_PERMISSIONS };
    const route = loadAccessSource("src/routes/api/crm/deals/$dealId/proposals.ts", {
      "@tanstack/react-router": routeStub,
      "../../../../../lib/auth-session": { requireSession: async () => ({ session }) },
      "../../../../../lib/access-control/crm-record-access": { requireCrmDealAccess: async () => null },
      "../../../../../lib/crm/crm-service": { crmService: { updateProposalStatus: async (...args) => { calls.push(args); return {}; } }, handleCrmError: (error) => { throw error; } },
      "../../../../../db": {}, "../../../../../db/schema": {}, "drizzle-orm": {},
    }).Route.server.handlers;
    assert.equal((await route.PATCH({ request: apiRequest({ proposalId: "foreign-proposal", status: "sent" }, "PATCH"), params: { dealId: "allowed-deal" } })).status, 200);
    assert.equal(calls[0][5], "allowed-deal");
  });
});

describe("controle de acesso e visibilidade por funil (pipelineScope / allowedPipelineIds)", () => {
  it("GET /api/crm/pipelines filtra apenas funis autorizados quando pipelineScope === 'selected'", async () => {
    const session = {
      tenantId: "tenant-a",
      operator: { id: "op-1", role: "agent" },
      permissions: structuredClone(DEFAULT_ADMIN_PERMISSIONS),
    };
    session.permissions.crm.pipelineScope = "selected";
    session.permissions.crm.allowedPipelineIds = ["pipe-maquinas"];
    session.permissions.crm.canManagePipelines = false;
    session.permissions.security.canManageAccessGroups = false;

    const handlers = loadAccessSource("src/routes/api/crm/pipelines.ts", {
      "@tanstack/react-router": routeStub,
      "../../../lib/auth-session": { requireSession: async () => ({ session }) },
      "../../../lib/crm/crm-service": {
        crmService: {
          getPipelines: async () => [
            { id: "pipe-maquinas", name: "Máquinas", stages: [] },
            { id: "pipe-pecas", name: "Peças", stages: [] },
          ],
        },
        handleCrmError: (err) => { throw err; },
      },
      "../../../lib/http-cache": {
        handleConditionalResponse: (_req, payload) => Response.json(payload),
      },
    }).Route.server.handlers;

    const res = await handlers.GET({ request: apiRequest(undefined, "GET", "http://test/api/crm/pipelines") });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.pipelines.map((p) => p.id), ["pipe-maquinas"]);
  });

  it("GET /api/crm/deals e POST /api/crm/deals bloqueiam funil fora de allowedPipelineIds", async () => {
    const calls = [];
    const session = {
      tenantId: "tenant-a",
      operator: { id: "op-1", role: "agent" },
      permissions: structuredClone(DEFAULT_ADMIN_PERMISSIONS),
    };
    session.permissions.crm.pipelineScope = "selected";
    session.permissions.crm.allowedPipelineIds = ["pipe-maquinas"];

    const handlers = loadAccessSource("src/routes/api/crm/deals.ts", {
      "@tanstack/react-router": routeStub,
      "../../../lib/auth-session": { requireSession: async () => ({ session }) },
      "../../../lib/crm/crm-service": {
        crmService: {
          getDeals: async (...args) => { calls.push(["getDeals", args]); return { deals: [], total: 0 }; },
          createDeal: async (...args) => { calls.push(["createDeal", args]); return { id: "d1" }; },
        },
        parseExtraDealFilters: () => ({}),
        handleCrmError: (err) => { throw err; },
      },
    }).Route.server.handlers;

    // Tentativa de consultar funil não autorizado -> 403
    const deniedGet = await handlers.GET({
      request: apiRequest(undefined, "GET", "http://test/api/crm/deals?pipelineId=pipe-pecas"),
    });
    assert.equal(deniedGet.status, 403);
    assert.equal(calls.length, 0);

    // Consulta no funil autorizado -> 200 e repassa allowedPipelineIds
    const allowedGet = await handlers.GET({
      request: apiRequest(undefined, "GET", "http://test/api/crm/deals?pipelineId=pipe-maquinas"),
    });
    assert.equal(allowedGet.status, 200);
    assert.deepEqual(calls[0][1][1].allowedPipelineIds, ["pipe-maquinas"]);

    // Tentativa de criar negociação em funil não autorizado -> 403
    const deniedPost = await handlers.POST({
      request: apiRequest({ title: "Teste", pipelineId: "pipe-pecas", stageId: "stg-1" }, "POST"),
    });
    assert.equal(deniedPost.status, 403);
    assert.equal(calls.length, 1);
  });

  it("bulk repassa authorizedPipelineIds quando grupo restringe funis", async () => {
    const h = bulkHarness();
    h.session.permissions.crm.pipelineScope = "selected";
    h.session.permissions.crm.allowedPipelineIds = ["pipe-unico"];
    const res = await h.run({ allFiltered: true, filterParams: {}, rating: 4 });
    assert.equal(res.status, 200);
    assert.deepEqual(h.calls[0][2].authorizedPipelineIds, ["pipe-unico"]);
  });
});

