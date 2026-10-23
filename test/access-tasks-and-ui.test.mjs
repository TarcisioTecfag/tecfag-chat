import fs from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { apiRequest, loadAccessSource, routeStub } from "./helpers/access-harness.mjs";

function taskHarness({ authenticated = true, moduleAllowed = true, activity = null, localTask = null } = {}) {
  const source = fs.readFileSync(new URL("../src/routes/api/tasks.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("tasks.ts", source, ts.ScriptTarget.Latest, true);
  let expression;
  function find(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "PUT") expression = node.initializer.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(expression);
  const module = { exports: {} }, calls = [];
  const session = { tenantId: "tenant-a", operator: { id: "a", email: "a@example.test", role: "agent" }, permissions: { views: { tasks: moduleAllowed } } };
  const tables = { activity: { id: "activity.id", tenantId: "activity.tenantId" }, task: { id: "task.id", tenantId: "task.tenantId", operatorEmail: "task.operatorEmail" } };
  const db = { select: () => {
    let table;
    const q = { from: (value) => { table = value; return q; }, where: (p) => { calls.push(["where", p]); return q; }, limit: async () => table === tables.activity ? (activity ? [activity] : []) : (localTask ? [localTask] : []) };
    return q;
  }, update: () => ({ set: () => ({ where: async (conditions) => calls.push(["update", conditions]) }) }) };
  const js = ts.transpileModule(`export const run = ${expression}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("module", "exports", "requireSession", "db", "crmDealActivities", "dbTasks", "and", "eq", "crmService", "isRdCrmConfigured", "rdRequest", "corsHeaders", js)(
    module, module.exports, async () => authenticated ? { session } : { response: new Response(null, { status: 401 }) },
    db, tables.activity, tables.task, (...p) => p, (...p) => p,
    { updateDealActivity: async (...args) => calls.push(["activity", args]) }, async () => false,
    async () => { throw Error("External requests forbidden"); }, {},
  );
  return { calls, run: () => module.exports.run({ request: apiRequest({ taskId: "task", status: "done", tenantId: "tenant-b" }, "PUT") }) };
}

describe("tarefas respeitam módulo, autoria e atribuição", () => {
  it("recusa sessão ausente e módulo bloqueado antes de consultar banco", async () => {
    for (const [options, status] of [[{ authenticated: false }, 401], [{ moduleAllowed: false }, 403]]) {
      const h = taskHarness(options); assert.equal((await h.run()).status, status); assert.equal(h.calls.length, 0);
    }
  });
  it("não conclui tarefa de outro operador", async () => {
    const h = taskHarness({ activity: { id: "task", dealId: "d", operatorId: "b", assignedToOperatorId: "b" } });
    assert.equal((await h.run()).status, 404); assert.ok(!h.calls.some(([name]) => name === "activity" || name === "update"));
  });
  it("responsável pela tarefa pode concluí-la", async () => {
    const h = taskHarness({ activity: { id: "task", dealId: "d", operatorId: "b", assignedToOperatorId: "a" } });
    assert.equal((await h.run()).status, 200); assert.equal(h.calls.find(([name]) => name === "activity")[1][0], "tenant-a");
  });
  it("tarefa legada alheia não gera escrita local nem externa", async () => {
    const h = taskHarness({ localTask: { operatorEmail: "b@example.test" } });
    assert.equal((await h.run()).status, 404); assert.ok(!h.calls.some(([name]) => name === "update"));
  });
  it("tarefa legada própria mantém operação com tenant da sessão", async () => {
    const h = taskHarness({ localTask: { operatorEmail: "A@example.test" } });
    assert.equal((await h.run()).status, 200);
    const conditions = h.calls.find(([name]) => name === "update")[1];
    assert.ok(conditions.some(([column, value]) => column === "task.tenantId" && value === "tenant-a"));
  });
});

describe("contrato entre painel e modelo de permissões", () => {
  it("todo checkbox de categoria usa uma chave conhecida no modelo", () => {
    const { DEFAULT_ADMIN_PERMISSIONS } = loadAccessSource("src/lib/rbac.ts");
    const source = fs.readFileSync(new URL("../src/components/chat/GroupsView.tsx", import.meta.url), "utf8");
    const ast = ts.createSourceFile("groups.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let count = 0;
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map" && ts.isArrayLiteralExpression(node.expression.expression)) {
        const category = node.getText(ast).match(/updateGroupGranular\(selectedGroupId, "(\w+)"/)?.[1];
        if (category) {
          function item(value) {
            if (ts.isObjectLiteralExpression(value)) {
              const key = value.properties.find((p) => p.name?.getText(ast) === "key");
              if (key && ts.isPropertyAssignment(key) && ts.isStringLiteral(key.initializer)) {
                assert.ok(Object.hasOwn(DEFAULT_ADMIN_PERMISSIONS[category], key.initializer.text), `${category}.${key.initializer.text}`); count++;
              }
            } else ts.forEachChild(value, item);
          }
          item(node.expression.expression);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(count >= 65);
  });
});

describe("disparo outbound autenticado", () => {
  it("não dispara sem sessão e deriva tenant da sessão para agente autorizado", async () => {
    const { DEFAULT_ADMIN_PERMISSIONS } = loadAccessSource("src/lib/rbac.ts");
    const { requirePermission } = loadAccessSource("src/lib/auth-session.ts", { "../db/index.js": {}, "../db/schema.js": {}, "drizzle-orm": {}, "./auth-crypto.js": {}, "./platform-access.js": {} });
    const calls = []; let authenticated = false;
    const session = { tenantId: "tenant-a", operator: { id: "a", role: "agent" }, permissions: DEFAULT_ADMIN_PERMISSIONS };
    const route = loadAccessSource("src/routes/api/trigger-outbound-call.ts", {
      "@tanstack/react-router": routeStub,
      "../../lib/auth-session": { requireSession: async () => authenticated ? { session } : { response: new Response(null, { status: 401 }) }, requirePermission },
      "../../lib/voice/outbound-call-service": { triggerOutboundCallInternal: async (options) => { calls.push(options); return { success: true }; } },
    }).Route.server.handlers.POST;
    const run = () => route({ request: apiRequest({ tenantId: "tenant-b", phone: "5511999990000", accountSid: "untrusted", authToken: "untrusted", twimlUrl: "https://untrusted.example.test" }) });
    assert.equal((await run()).status, 401); assert.equal(calls.length, 0);
    authenticated = true; assert.equal((await run()).status, 200);
    assert.equal(calls[0].tenantId, "tenant-a"); assert.equal(calls[0].accountSid, undefined); assert.equal(calls[0].authToken, undefined); assert.equal(calls[0].twimlUrl, undefined);
  });
});
