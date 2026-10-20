import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  industrialReviewInput,
  readHumanReview,
  reviewAccess,
  reviewDataHash,
} from "../src/lib/triage/industrial-review-contract.ts";
import {
  buildJournalSnapshot,
  readJournalSnapshot,
} from "../src/lib/triage/industrial-triage-journal.ts";
import { buildIndustrialBriefing } from "../src/lib/triage/industrial-briefing.ts";
const cycle = "2026-10-20T12:00:00.000Z";
const flow = {
  id: "flow",
  conversationId: "conv",
  tenantId: "fixture",
  startedAt: cycle,
  lastInteractionAt: cycle,
  currentStep: "Pausado",
  collectedData: {},
  metadata: {},
  outcome: "stopped",
};
const actor = {
  id: "op",
  name: "Operador",
  role: "operator",
  permissions: {
    canView: true,
    canViewAll: true,
    canEditClientInfo: true,
    canSendInternalNotes: true,
    canOverrideChat: false,
  },
};
const input = {
  conversationId: "conv",
  cycleId: `flow:${cycle}`,
  expectedRevision: "a".repeat(64),
  reason: "Corrigido com o cliente",
  fields: {},
};
describe("revisão humana: contrato e autoridade", () => {
  it("aceita conferência sem alterar campos e documento matematicamente válido", () => {
    assert.equal(industrialReviewInput.safeParse(input).success, true);
    assert.equal(
      industrialReviewInput.safeParse({
        ...input,
        fields: { "CNPJ OU CPF": { value: "52998224725", status: "filled" } },
      }).success,
      true,
    );
  });
  for (const fields of [
    { tenantId: { value: "outro", status: "filled" } },
    { "SETOR / FUNIL DE DESTINO": { value: "Financeiro", status: "filled" } },
    { CPF: { value: "11111111111", status: "filled" } },
    { NOME: { value: "Maria", status: "filled" } },
    { "NOME COMPLETO": { value: "", status: "filled" } },
    { CPF: { value: "", status: "pending" }, CNPJ: { value: "", status: "pending" } },
  ])
    it("rejeita campo, documento ou estado indevido", () =>
      assert.equal(industrialReviewInput.safeParse({ ...input, fields }).success, false));
  it("não aceita tenant, ator ou classificação no body", () => {
    for (const key of [
      "tenantId",
      "operatorId",
      "machineDecision",
      "targetFunnel",
      "handoffReceipt",
    ])
      assert.equal(industrialReviewInput.safeParse({ ...input, [key]: "forjado" }).success, false);
  });
  it("administrador também precisa interromper automação e não edita ciclo encerrado", () => {
    const admin = { ...actor, role: "admin" };
    assert.equal(
      reviewAccess(
        admin,
        { operatorId: null, queueState: "automacao" },
        { ...flow, outcome: "in_progress" },
      ).editable,
      false,
    );
    assert.equal(
      reviewAccess(admin, { operatorId: null, queueState: "finalizados" }, flow).editable,
      false,
    );
    assert.equal(
      reviewAccess(admin, { operatorId: null, queueState: "fila" }, flow).editable,
      true,
    );
  });
  it("dono precisa de permissão de editar dados e notas; leitura geral não autoriza edição", () => {
    assert.equal(
      reviewAccess(actor, { operatorId: "op", queueState: "meus" }, flow).editable,
      true,
    );
    assert.equal(
      reviewAccess(actor, { operatorId: "outro", queueState: "meus" }, flow).editable,
      false,
    );
    assert.equal(
      reviewAccess(
        { ...actor, permissions: { ...actor.permissions, canSendInternalNotes: false } },
        { operatorId: "op", queueState: "meus" },
        flow,
      ).editable,
      false,
    );
    assert.equal(
      reviewAccess(
        { ...actor, permissions: { ...actor.permissions, canOverrideChat: true } },
        { operatorId: "outro", queueState: "meus" },
        flow,
      ).editable,
      true,
    );
  });
  it("encaminhamento pendente precisa ser interrompido mesmo após tomada humana", () => {
    assert.equal(
      reviewAccess(
        actor,
        { operatorId: "op", queueState: "meus" },
        { ...flow, outcome: "in_progress", metadata: { handoffRequest: { cycle } } },
      ).editable,
      false,
    );
  });
});
describe("briefing e validade da revisão", () => {
  const data = { "NOME COMPLETO": { value: "Maria", status: "filled" } };
  const review = {
    version: 1,
    cycle,
    operatorId: "op",
    operatorName: "Operador",
    reviewedAt: cycle,
    reason: "Conferido com cliente",
    dataHash: reviewDataHash(data),
  };
  it("nova extração torna a revisão anterior desatualizada, sem perder autor e motivo", () => {
    assert.equal(readHumanReview(review, cycle, data).current, true);
    assert.equal(readHumanReview(review, cycle, {}).current, false);
    assert.equal(readHumanReview(review, "outro-ciclo", data), null);
    const snapshot = buildJournalSnapshot({
      ...flow,
      collectedData: data,
      metadata: { humanReview: review },
    });
    assert.deepEqual(readJournalSnapshot(snapshot), snapshot);
  });
  it("pendência não anuncia encaminhamento e resumo usa só evidências preservadas", () => {
    const snapshot = buildJournalSnapshot({
      ...flow,
      outcome: "in_progress",
      collectedData: { ITEM: { value: "Foto", status: "pending" } },
      metadata: { allocatedOperatorName: "Antigo", systemPrompt: "SECRET" },
    });
    const briefing = buildIndustrialBriefing(snapshot);
    assert.equal(briefing.final, false);
    assert.match(briefing.text, /ITEM: Pendente/);
    assert.ok(!briefing.text.includes("Antigo"));
    assert.ok(!briefing.text.includes("SECRET"));
  });
  it("briefing final existe também sem negociação e indica revisão humana", () => {
    const briefing = buildIndustrialBriefing(
      buildJournalSnapshot({
        ...flow,
        metadata: { humanReview: { ...review, dataHash: reviewDataHash({}) } },
      }),
    );
    assert.equal(briefing.final, true);
    assert.match(briefing.text, /Revisão humana: Operador/);
    assert.match(briefing.text, /não comprova criação/);
  });
  it("texto grande tem limite e informa truncamento", () => {
    const collectedData = Object.fromEntries(
      Array.from({ length: 30 }, (_, n) => [
        `CAMPO ${n}`,
        { value: "x".repeat(2000), status: "filled" },
      ]),
    );
    const text = buildIndustrialBriefing(buildJournalSnapshot({ ...flow, collectedData })).text;
    assert.ok(text.length <= 10_000);
    assert.match(text, /Resumo truncado/);
  });
});
function api({ authenticated = true, industrial = true, permitted = true, failure = 0 } = {}) {
  let calls = 0;
  class ReviewError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  const read = async (_, tenant, conversation, receivedActor) => {
    calls++;
    assert.equal(tenant, "session-tenant");
    assert.equal(receivedActor.id, "session-op");
    if (failure) throw new ReviewError(failure, "Conflito controlado");
    return { snapshot: { cycleId: `flow:${cycle}` } };
  };
  const deps = {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    "../../../db": { db: {} },
    "../../../lib/auth-session": {
      requireSession: async () =>
        authenticated
          ? {
              session: {
                tenantId: "session-tenant",
                operator: { id: "session-op", name: "Nome", role: "operator" },
                permissions: { views: { chat: permitted } },
              },
            }
          : { response: new Response(null, { status: 401 }) },
    },
    "../../../lib/ai-persona": {
      getAiPersona: () => ({ triagePolicy: industrial ? "industrial" : undefined }),
    },
    "../../../lib/triage/industrial-review-store": {
      IndustrialReviewError: ReviewError,
      readIndustrialReview: read,
      saveIndustrialReview: (_, tenant, receivedActor, body) =>
        read(_, tenant, body.conversationId, receivedActor),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        new URL("../src/routes/api/valentina/triage-review.ts", import.meta.url),
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      module,
      exports: module.exports,
      Response,
      URL,
      console: { error() {} },
      require: (name) => {
        if (!(name in deps)) throw new Error(name);
        return deps[name];
      },
    },
  );
  return {
    calls: () => calls,
    run: (
      method = "GET",
      query = "conversationId=conv&tenantId=foreign",
      body = JSON.stringify(input),
    ) =>
      module.exports.Route.server.handlers[method]({
        request: new Request(`http://test/api?${query}`, {
          method,
          ...(method === "POST" ? { body } : {}),
        }),
      }),
  };
}
describe("API de revisão: sessão, permissões e erros", () => {
  for (const method of ["GET", "POST"])
    for (const [options, code] of [
      [{ authenticated: false }, 401],
      [{ industrial: false }, 404],
      [{ permitted: false }, 403],
    ])
      it(`${method} bloqueia antes da leitura: ${code}`, async () => {
        const harness = api(options);
        assert.equal((await harness.run(method)).status, code);
        assert.equal(harness.calls(), 0);
      });
  it("ignora tenant da query e recebe operador exclusivamente da sessão", async () => {
    const response = await api().run();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
  it("JSON malformado e excesso de tamanho são 400 antes da escrita", async () => {
    for (const body of ["{", "x".repeat(32_001)]) {
      const harness = api();
      assert.equal((await harness.run("POST", "", body)).status, 400);
      assert.equal(harness.calls(), 0);
    }
  });
  it("ciclo alterado não é editado como se ainda fosse o selecionado", async () =>
    assert.equal((await api().run("GET", "conversationId=conv&cycleId=old")).status, 409));
  for (const code of [403, 404, 409])
    it(`preserva erro controlado ${code}`, async () =>
      assert.equal((await api({ failure: code }).run("POST")).status, code));
});
