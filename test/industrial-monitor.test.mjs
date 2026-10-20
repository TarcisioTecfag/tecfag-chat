import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { projectIndustrialMonitoring as project } from "../src/lib/triage/industrial-monitor.ts";

const cycle = "2026-10-20T12:00:00.000Z";
const flow = (metadata = {}, outcome = "in_progress") => ({ startedAt: cycle, outcome, metadata });
const automation = { operatorId: null, queueState: "automacao" };
const owner = { operatorId: "op", queueState: "meus" };
const receipt = {
  cycle,
  committedAt: cycle,
  result: { status: "transferred", operator: { id: "op" }, sectorId: "sector" },
};

describe("monitor industrial: estado depende da persistência do ciclo", () => {
  it("checkpoint não é prova de transferência", () => {
    const value = project(
      flow({ handoffRequest: { cycle }, handoffStatus: "waiting_for_team" }),
      automation,
    );
    assert.equal(value.state, "waiting_for_team");
    assert.equal(value.committedAt, null);
    assert.equal(value.clientConfirmation, "unknown");
  });
  it("recibo e responsável atual confirmam transferência; entrega continua pendente", () => {
    const value = project(
      flow(
        { handoffReceipt: receipt, handoffOutbox: { cycle, clientConfirmationRequired: true } },
        "transferred",
      ),
      owner,
    );
    assert.equal(value.state, "transferred");
    assert.equal(value.clientConfirmation, "pending");
    assert.equal(value.sectorId, "sector");
  });
  it("troca de responsável é atendimento humano, sem atribuir o novo dono ao rodízio antigo", () => {
    assert.equal(
      project(flow({ handoffReceipt: receipt }, "transferred"), { ...owner, operatorId: "new-op" })
        .state,
      "manual",
    );
  });
  it("recibo antigo não confirma ciclo novo", () => {
    const value = project(flow({ handoffReceipt: { ...receipt, cycle: "anterior" } }), owner);
    assert.equal(value.state, "manual");
    assert.equal(value.committedAt, null);
  });
  it("encerramento sem responsável não é transferência confirmada", () => {
    assert.equal(
      project(flow({ handoffReceipt: receipt }, "transferred"), {
        operatorId: null,
        queueState: "finalizados",
      }).state,
      "closed",
    );
    assert.equal(
      project(flow({ handoffReceipt: receipt }, "transferred"), {
        ...owner,
        queueState: "finalizados",
      }).state,
      "closed",
    );
  });
  it("tomada humana prevalece sobre sem resposta e cancela indicação de retry", () => {
    const value = project(
      flow(
        { funnelStage: "sem_resposta", handoffRequest: { cycle }, handoffNextAttemptAt: cycle },
        "abandoned",
      ),
      owner,
    );
    assert.equal(value.state, "manual");
    assert.equal(value.nextAttemptAt, null);
  });
  it("continuidade conserva origem e identifica o encerramento no site", () => {
    const value = project(
      flow({ continuedTo: { conversationId: "wa", channel: "whatsapp" } }, "completed"),
      owner,
    );
    assert.equal(value.state, "continued");
    assert.equal(value.continuedTo.conversationId, "wa");
    assert.equal(
      project(flow({ continuedFrom: { conversationId: "site", channel: "livechat" } }), automation)
        .continuedFrom.channel,
      "livechat",
    );
  });
  it("sem resposta, interrupção, coleta pronta e fila humana são estados distintos", () => {
    assert.equal(project(flow({}, "abandoned"), automation).state, "no_response");
    assert.equal(project(flow({}, "stopped"), automation).state, "stopped");
    assert.equal(project(flow({ readyForHandoff: true }), automation).state, "ready");
    assert.equal(project(flow(), { ...automation, queueState: "fila" }).state, "manual_queue");
  });
  it("ack de outro ciclo não comprova entrega; ack atual distingue envio e não necessário", () => {
    const metadata = {
      handoffReceipt: receipt,
      handoffOutbox: { cycle: "antigo", clientNotifiedAt: cycle },
    };
    assert.equal(project(flow(metadata), owner).clientConfirmation, "unknown");
    metadata.handoffOutbox = {
      cycle,
      clientConfirmationRequired: true,
      clientNotifiedAt: cycle,
      operatorNotificationRequired: false,
    };
    assert.equal(project(flow(metadata), owner).clientConfirmation, "sent");
    assert.equal(project(flow(metadata), owner).operatorNotification, "not_required");
  });
  it("metadado inválido não quebra a projeção nem expõe conteúdo bruto", () => {
    for (const raw of [
      null,
      [],
      "x",
      {
        prompt: "SEGREDO",
        handoffRequest: "x",
        missingFields: [42, "document"],
        handoffAttempts: NaN,
      },
    ]) {
      const value = project(flow(raw), automation);
      assert.equal(value.state, "collecting");
      assert.ok(!JSON.stringify(value).includes("SEGREDO"));
      assert.equal(value.attempts, 0);
    }
  });
});

function harness({ authenticated = true, fail = false } = {}) {
  let calls = 0;
  const dependencies = {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    "drizzle-orm": { eq: () => true },
    "../../../db/schema": { agentConfigs: { tenantId: "tenant" } },
    "../../../db": {
      db: {
        select: () => ({
          from: () => ({
            where: async () => {
              calls++;
              return [];
            },
          }),
        }),
      },
    },
    "../../../lib/auth-session": {
      requireSession: async () =>
        authenticated
          ? { session: { tenantId: "session-tenant", operator: { role: "agent" } } }
          : { response: new Response(null, { status: 401 }) },
    },
    "../../../lib/ai-persona": { getAiPersona: () => ({ name: "Assistente", company: "Empresa" }) },
    "../../../lib/triage/agent-monitor-store": {
      readAgentMonitoringSummary: async (_, tenantId) => {
        calls++;
        assert.equal(tenantId, "session-tenant");
        if (fail) throw new Error("SECRET_DATABASE_DETAILS");
        return { available: true, byAgent: {}, scope: "current_cycles" };
      },
    },
  };
  const code = ts.transpileModule(
    fs.readFileSync(new URL("../src/routes/api/valentina/agents.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Response,
    console: { error() {} },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Import não permitido: ${name}`);
      return dependencies[name];
    },
  });
  return {
    calls: () => calls,
    get: () =>
      module.exports.Route.server.handlers.GET({
        request: new Request("http://test/api?tenantId=estrangeiro"),
      }),
  };
}
describe("métricas autenticadas", () => {
  it("sem sessão não consulta dados", async () => {
    const api = harness({ authenticated: false });
    assert.equal((await api.get()).status, 401);
    assert.equal(api.calls(), 0);
  });
  it("usa tenant da sessão, mede zero real e não inventa conversão", async () => {
    const response = await harness().get();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.agents[0].activeFlows, 0);
    assert.equal(body.agents[0].enabled, false);
    assert.equal(body.agents[0].metrics.taxaConversao, null);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
  it("falha de consulta retorna indisponibilidade, sem zeros ou erro interno", async () => {
    const response = await harness({ fail: true }).get();
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(body.includes("METRICS_UNAVAILABLE"));
    assert.ok(!body.includes("SECRET_DATABASE_DETAILS"));
  });
});

function sdrHarness({ authenticated = true, failSummary = false } = {}) {
  let calls = 0;
  const chain = new Proxy(
    {},
    { get: (_, key) => (key === "then" ? (resolve) => resolve([]) : () => chain) },
  );
  const tables = Object.fromEntries(
    [
      "agentConfigs",
      "agentFlowStates",
      "conversations",
      "contacts",
      "messages",
      "operators",
      "crmConversationDeals",
      "crmDeals",
      "crmDealContacts",
    ].map((name) => [name, new Proxy({}, { get: (_, key) => `${name}.${String(key)}` })]),
  );
  const dependencies = {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    "drizzle-orm": { eq: () => true, and: () => true, desc: () => true, sql: () => true },
    "../../../db/schema": tables,
    "../../../db": {
      db: {
        select: () => {
          calls++;
          return chain;
        },
        query: {
          agentConfigs: { findFirst: async () => undefined },
          conversations: {
            findFirst: async () => ({ id: "conv", contactId: "contact", ...automation }),
          },
          contacts: {
            findFirst: async () => ({
              name: "Cliente",
              mainChannel: "livechat",
              walletOperatorId: "antigo",
            }),
          },
        },
      },
    },
    "../../../lib/auth-session": {
      requireSession: async () =>
        authenticated
          ? {
              session: {
                tenantId: "session-tenant",
                operator: { id: "logado", name: "Operador Logado" },
              },
            }
          : { response: new Response(null, { status: 401 }) },
    },
    "../../../lib/ai-persona": {
      getAiPersona: () => ({ name: "Assistente", triagePolicy: "industrial" }),
    },
    "../../../lib/triage/industrial-monitor": { projectIndustrialMonitoring: project },
    "../../../lib/triage/industrial-cycle-stop": { stopIndustrialCycle: async () => true },
    "../../../lib/triage/agent-monitor-store": {
      readLatestSdrFlows: async (_, tenantId) => {
        assert.equal(tenantId, "session-tenant");
        return [
          {
            id: "flow",
            conversationId: "conv",
            currentStep: "Encaminhamento pendente",
            ...flow({
              localCrmDealId: "fantasma",
              allocatedOperatorName: "Antigo",
              handoffRequest: { cycle },
            }),
          },
        ];
      },
      readAgentMonitoringSummary: async (_, tenantId) => {
        assert.equal(tenantId, "session-tenant");
        if (failSummary) throw new Error("db indisponível");
        return { available: true, byAgent: {} };
      },
    },
  };
  const code = ts.transpileModule(
    fs.readFileSync(new URL("../src/routes/api/valentina/sdr.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Response,
    console: { error() {}, warn() {} },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Import não permitido: ${name}`);
      return dependencies[name];
    },
  });
  return {
    calls: () => calls,
    get: () =>
      module.exports.Route.server.handlers.GET({
        request: new Request("http://test/api?tenantId=estrangeiro"),
      }),
  };
}
describe("monitor SDR: leitura autenticada sem sucesso presumido", () => {
  it("sem sessão não consulta o monitor", async () => {
    const api = sdrHarness({ authenticated: false });
    assert.equal((await api.get()).status, 401);
    assert.equal(api.calls(), 0);
  });
  it("pendência não herda dono, card fantasma, ativação ou mensagem fabricada", async () => {
    const response = await sdrHarness().get();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.config.enabled, false);
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].monitoring.state, "handoff_pending");
    assert.equal(body.sessions[0].monitoring.operatorId, null);
    assert.equal(body.sessions[0].linkedDeal, null);
    assert.deepEqual(body.sessions[0].messages, []);
    assert.equal(body.sessions[0].responsibleName, "Sem responsável atribuído");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
  it("falha de métricas não produz zero nem impede a inspeção da sessão", async () => {
    const body = await (await sdrHarness({ failSummary: true }).get()).json();
    assert.equal(body.monitoringSummary.available, false);
    assert.equal(body.sessions.length, 1);
  });
});
