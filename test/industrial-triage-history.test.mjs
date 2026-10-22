import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  buildJournalEntry,
  buildJournalSnapshot,
  readJournalSnapshot,
} from "../src/lib/triage/industrial-triage-journal.ts";
import {
  HistoryInputError,
  historyPageInput,
  historyNextCursor,
} from "../src/lib/triage/triage-history-pagination.ts";
import { formatSystemAnnotation } from "../src/lib/triage/format-system-annotation.ts";

const startedAt = "2026-10-10T12:00:00.000Z";
const flow = {
  id: "flow",
  tenantId: "fixture",
  conversationId: "conversation",
  startedAt,
  lastInteractionAt: startedAt,
  currentStep: "Coleta",
  outcome: "in_progress",
  collectedData: {},
  metadata: {},
};
describe("notas progressivas de triagem", () => {
  it("registra mudança real e não cria nota por alteração de relógio", () => {
    assert.equal(
      buildJournalEntry(flow, { ...flow, lastInteractionAt: new Date() }, "collection", "msg"),
      null,
    );
    const changed = { ...flow, collectedData: { NOME: { value: "Maria", status: "filled" } } };
    const note = buildJournalEntry(flow, changed, "collection", "msg");
    assert.deepEqual(note.metadata.changedFields, ["NOME"]);
    assert.match(note.content, /NOME: Maria/);
    assert.equal(note.id, buildJournalEntry(flow, changed, "collection", "msg").id);
    assert.notEqual(
      note.id,
      buildJournalEntry(flow, { ...changed, tenantId: "outro" }, "collection", "msg").id,
    );
  });
  it("arquivo preserva dados completos, sem copiar prompts, códigos ou metadados arbitrários", () => {
    const note = buildJournalEntry(
      null,
      {
        ...flow,
        metadata: { systemPrompt: "SECRET", continuityCode: "SECRET" },
        collectedData: {
          DOC: { value: "123", status: "filled" },
          BAD: { value: "x", status: "inventado" },
        },
      },
      "archive",
      "reset",
    );
    assert.deepEqual(Object.keys(note.metadata.snapshot.collectedData), ["DOC"]);
    assert.ok(!JSON.stringify(note).includes("SECRET"));
    assert.deepEqual(readJournalSnapshot(note.metadata.snapshot), note.metadata.snapshot);
  });
  it("responsável exige recibo do próprio ciclo, sem reaproveitar nome antigo", () => {
    const receipt = {
      cycle: startedAt,
      result: { status: "transferred", operator: { id: "op", name: "Operador" } },
    };
    assert.equal(
      buildJournalSnapshot({
        ...flow,
        metadata: {
          allocatedOperatorName: "Antigo",
          handoffReceipt: { ...receipt, cycle: "outro" },
        },
      }).responsible,
      null,
    );
    assert.equal(
      buildJournalSnapshot({ ...flow, metadata: { handoffReceipt: receipt } }).responsible.id,
      "op",
    );
  });
  it("recusa snapshot de ciclo inválido", () => {
    assert.equal(readJournalSnapshot({ ...buildJournalSnapshot(flow), cycleId: "outro" }), null);
    assert.equal(readJournalSnapshot(null), null);
  });
  it("formata relatórios de triagem de forma objetiva e sem duplicidade de campos ou destino", () => {
    const rawArchive = [
      "Ciclo de triagem arquivado",
      "CNPJ OU CPF: 48391558878",
      "MÁQUINA / PEÇA / INTERESSE: Nota fiscal",
      "NOME COMPLETO: Tarcisio Pereira do nascimento",
      "SETOR / FUNIL DE DESTINO: Financeiro",
      "Destino: Financeiro",
      "",
      "BRIEFING FINAL DA TRIAGEM",
      "Situação do ciclo: Encaminhamento registrado",
      "Início: 22/10/2026, 13:14:03 (Brasília)",
      "Registro do ciclo: 22/10/2026, 13:17:26 (Brasília)",
      "Destino registrado: Financeiro",
      "Subfluxo: 2B_NF",
      "Responsável no encaminhamento: Jessica Pimentel",
      "Negociação vinculada no encaminhamento: deal-1792685846905-xwik5",
      "Dados ainda sem revisão humana registrada.",
      "",
      "DADOS REGISTRADOS (não comprovam validação cadastral ou titularidade):",
      "CNPJ OU CPF: 48391558878",
      "MÁQUINA / PEÇA / INTERESSE: Nota fiscal",
      "NOME COMPLETO: Tarcisio Pereira do nascimento",
      "SETOR / FUNIL DE DESTINO: Financeiro",
    ].join("\n");

    const parsed = formatSystemAnnotation(rawArchive);
    assert.equal(parsed.badgeTitle, "Ciclo de Triagem Arquivado");
    assert.equal(parsed.isSingleLine, false);
    assert.deepEqual(
      parsed.items.map((item) => [item.label, item.value]),
      [
        ["Destino", "Financeiro"],
        ["Responsável", "Jessica Pimentel"],
        ["Cliente", "Tarcisio Pereira do nascimento"],
        ["CPF / CNPJ", "483.915.588-78"],
        ["Interesse", "Nota fiscal"],
        ["Período", "13:14 às 13:17"],
      ],
    );
  });
});
describe("paginação com contexto", () => {
  it("preserva âncora e recusa uso do cursor em outro tenant, ciclo ou consulta", () => {
    const cursor = historyNextCursor("cycles", "tenant/conv", startedAt, {
      time: startedAt,
      id: "flow",
    });
    assert.equal(historyPageInput("cycles", "tenant/conv", cursor, "2").asOf, startedAt);
    assert.throws(() => historyPageInput("cycles", "outro/conv", cursor, null), HistoryInputError);
    assert.throws(() => historyPageInput("events", "tenant/conv", cursor, null), HistoryInputError);
  });
  for (const value of ["0", "51", "1.5", "NaN", ""])
    it(`rejeita limite ${JSON.stringify(value)}`, () =>
      assert.throws(() => historyPageInput("cycles", "s", null, value), HistoryInputError));
  for (const cursor of ["!", "x".repeat(3001), Buffer.from("null").toString("base64url")])
    it("rejeita cursor malformado", () =>
      assert.throws(() => historyPageInput("cycles", "s", cursor, null), HistoryInputError));
});

function harness({ authenticated = true, industrial = true, fail = false } = {}) {
  const calls = [];
  class NotFound extends Error {}
  const read = async (_, tenant, ...args) => {
    calls.push({ tenant, args });
    if (fail) throw new Error("SECRET_SQL");
    if (args[0] === "foreign") throw new NotFound();
    return { items: [], pageInfo: {} };
  };
  const deps = {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    "../../../db": { db: {} },
    "../../../lib/auth-session": {
      requireSession: async () =>
        authenticated
          ? { session: { tenantId: "session-tenant" } }
          : { response: new Response(null, { status: 401 }) },
    },
    "../../../lib/ai-persona": {
      getAiPersona: () => ({ triagePolicy: industrial ? "industrial" : undefined }),
    },
    "../../../lib/triage/triage-history-pagination": { HistoryInputError, historyPageInput },
    "../../../lib/triage/triage-history-store": {
      HistoryNotFoundError: NotFound,
      historyQueryScope: (tenant, input) =>
        JSON.stringify([tenant, input.conversationId || input.query || ""]),
      listHistoryConversations: read,
      listHistoryCycles: read,
      listHistoryEvents: read,
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        new URL("../src/routes/api/valentina/triage-history.ts", import.meta.url),
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
    calls,
    get: (query = "") =>
      module.exports.Route.server.handlers.GET({
        request: new Request(`http://fixture/api?${query}`),
      }),
  };
}
describe("consulta de histórico autenticada", () => {
  it("401 antes de qualquer leitura", async () => {
    const api = harness({ authenticated: false });
    assert.equal((await api.get()).status, 401);
    assert.equal(api.calls.length, 0);
  });
  it("não disponibiliza fluxo industrial para outro perfil", async () => {
    const api = harness({ industrial: false });
    assert.equal((await api.get()).status, 404);
    assert.equal(api.calls.length, 0);
  });
  it("tenant vem somente da sessão e respostas não podem ser cacheadas", async () => {
    const api = harness();
    const response = await api.get("tenantId=foreign");
    assert.equal(response.status, 200);
    assert.equal(api.calls[0].tenant, "session-tenant");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
  for (const query of [
    "mode=unknown",
    "mode=cycles",
    "mode=events&conversationId=conv",
    "limit=51",
    "cursor=!",
  ])
    it(`400 sem leitura para ${query}`, async () => {
      const api = harness();
      assert.equal((await api.get(query)).status, 400);
      assert.equal(api.calls.length, 0);
    });
  it("conversa fora do tenant retorna 404", async () =>
    assert.equal((await harness().get("mode=cycles&conversationId=foreign")).status, 404));
  it("erro interno retorna 503 sem vazar SQL", async () => {
    const response = await harness({ fail: true }).get();
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("SECRET_SQL"));
  });
});
