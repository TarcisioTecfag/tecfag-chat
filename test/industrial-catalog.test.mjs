import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import {
  industrialSettingsSchema,
  emptyIndustrialSettings,
  convertLegacyMachineCatalog,
  industrialDestinationKey,
  DESTINATION_KEYS,
  resolveIndustrialDestination,
  consolidateIndustrialDestinations,
  setIndustrialDestination,
} from "../src/lib/triage/industrial-settings.ts";
import {
  decideIndustrialMachine,
  applyMachineDecision,
  parseIndustrialCapital,
} from "../src/lib/triage/industrial-decisor.ts";
import {
  resolveIndustrialRoute,
  assessIndustrialReadiness,
  canFinishIndustrialTriage,
} from "../src/lib/triage/industrial-policy.ts";

const settings = () =>
  industrialSettingsSchema.parse({
    ...emptyIndustrialSettings(),
    catalog: [
      {
        id: "semi",
        name: "Envasadora APF500",
        code: "APF500",
        sku: "SKU500",
        line: "SEMI-INDUSTRIAL",
        production: "500/h",
        aliases: ["APF 500"],
      },
      {
        id: "premium",
        name: "Empacotadora AFPP1328",
        code: "AFPP1328",
        line: "PERSONNALITE",
        description: "Forma, envasa e sela embalagens",
      },
    ],
  });
const input = (interest = "Quero APF500") => ({
  interest,
  application: "Doce de leite",
  production: "120kg/dia",
  customerContext: interest,
});
const decide = (options = {}) =>
  decideIndustrialMachine({
    settings: settings(),
    revision: 4,
    input: input(),
    suggest: async () => {
      throw new Error("Não deve chamar IA para match exato");
    },
    ...options,
  });

describe("catálogo e Decisor industrial sem provedor", () => {
  it("pedido de envase busca envasadora sem confundir subprocesso de empacotadora", async () => {
    const result = await decide({
      input: input("Quero envasar doce de leite"),
      suggest: async (candidates) => {
        assert.deepEqual(
          candidates.map((machine) => machine.id),
          ["semi"],
        );
        return { machineId: "semi", confidence: 0.96, reason: "Envase dedicado" };
      },
    });
    assert.equal(result.status, "confirmed");
  });
  it("família bloqueada permite especialista sem questionário comercial", async () => {
    const config = settings();
    config.blockedFamilies = [{ id: "b", name: "Forno", terms: ["forno"], reason: "Revisão" }];
    const decision = await decide({ settings: config, input: input("Quero forno") });
    const route = applyMachineDecision(
      resolveIndustrialRoute({ aiSubflow: "MAQUINAS", collectedData: {} }),
      decision,
    );
    assert.equal(route.reason, "specialist_review");
    assert.equal(assessIndustrialReadiness(route, {}).ready, true);
    assert.equal(
      canFinishIndustrialTriage({ route, data: {}, isCompleted: false, hasPendingQuestion: true }),
      true,
    );
  });
  it("extração do bot não é evidência de referência exata pelo cliente", async () => {
    let invoked = false;
    const result = await decide({
      input: { ...input(), customerContext: "Preciso de uma máquina" },
      suggest: async () => {
        invoked = true;
        return null;
      },
    });
    assert.equal(invoked, true);
    assert.equal(result.status, "review");
  });
  it("número de produção não é interpretado como SKU numérico", async () => {
    const config = settings();
    config.catalog[0].sku = "123";
    assert.equal(
      (await decide({ settings: config, input: input("Quero produzir 123 unidades") })).status,
      "review",
    );
    assert.equal(
      (await decide({ settings: config, input: input("Quero o SKU 123") })).machineId,
      "semi",
    );
  });
  it("produção acima da capacidade catalogada exige revisão, mesmo com código exato", async () => {
    assert.equal(
      (await decide({ input: { ...input(), production: "1000 unidades/hora" } })).reason,
      "capacity_requires_review",
    );
  });
  it("compara minutos e horas sem inferir horas trabalhadas por dia", async () => {
    const config = settings();
    config.catalog[0].production = "30-50 emb/min";
    assert.equal(
      (
        await decide({
          settings: config,
          input: { ...input(), production: "4000 embalagens/hora" },
        })
      ).reason,
      "capacity_requires_review",
    );
    assert.equal(
      (await decide({ settings: config, input: { ...input(), production: "4000 embalagens/dia" } }))
        .status,
      "confirmed",
    );
  });
  it("modelo exato confirma Semi sem chamada de IA", async () => {
    const result = await decide();
    assert.equal(result.status, "confirmed");
    assert.equal(result.machineId, "semi");
    assert.equal(result.method, "exact_catalog");
  });
  it("SKU e alias identificam a máquina sem aceitar substring", async () => {
    assert.equal((await decide({ input: input("SKU500") })).machineId, "semi");
    assert.equal((await decide({ input: input("Quero APF 500") })).machineId, "semi");
    assert.equal((await decide({ input: input("APF5000") })).status, "review");
  });
  it("Personnalité confirmada no catálogo roteia direto para Personnalité sem revisão forçada", async () => {
    const result = await decide({ input: input("AFPP1328") });
    assert.equal(result.status, "confirmed");
    assert.equal(result.reason, "catalog_confirmed");
    assert.equal(result.line, "PERSONNALITE");
    const route = applyMachineDecision(
      resolveIndustrialRoute({ text: "Quero uma empacotadora", collectedData: {} }),
      result,
    );
    assert.equal(route.subflow, "PERSONNALITE");
    assert.equal(route.targetFunnel, "Personnalité");
    assert.equal(route.needsReview, false);
    assert.equal(industrialDestinationKey(route), "PERSONNALITE");
  });
  it("categoria ampla (>100 itens) ranqueia e filtra top 100 candidatos para a IA em vez de falhar", async () => {
    const config = settings();
    for (let i = 1; i <= 150; i++) {
      config.catalog.push({
        id: `sel-${i}`,
        name: i === 42 ? "Seladora a Vácuo de Bancada DZ400" : `Seladora Manual SM-${i}`,
        code: `CODE-SEL-${i}`,
        sku: `SKU-SEL-${i}`,
        line: i === 42 ? "PERSONNALITE" : "SEMI-INDUSTRIAL",
        production: "200/h",
        description: i === 42 ? "Ideal para vácuo de carnes e queijos" : "Seladora simples",
        aliases: [],
        active: true,
      });
    }
    const result = await decide({
      settings: config,
      input: {
        interest: "Quero uma seladora a vácuo de bancada",
        application: "Carnes e queijos",
        production: "100 unidades/hora",
        customerContext: "Quero uma seladora a vácuo de bancada para carnes e queijos",
      },
      suggest: async (candidates) => {
        assert.equal(candidates.length, 100);
        assert.equal(candidates[0].id, "sel-42");
        return { machineId: "sel-42", confidence: 0.98, reason: "Seladora a vácuo compatível" };
      },
    });
    assert.equal(result.status, "confirmed");
    assert.equal(result.machineId, "sel-42");
    assert.equal(result.line, "PERSONNALITE");
  });
  for (const term of ["revenda", "licitação", "edital", "pregão"])
    it(`${term} exige revisão antes de IA`, async () => {
      assert.equal(
        (await decide({ input: { ...input(), customerContext: `APF500 para ${term}` } })).reason,
        "resale_or_tender",
      );
    });
  it("capital cadastral é promotor de revisão e não comprova linha da máquina", async () => {
    const result = await decide({ input: { ...input(), capitalSocial: 350000 } });
    assert.equal(result.reason, "capital_requires_review");
    assert.equal(result.line, "SEMI-INDUSTRIAL");
  });
  for (const [raw, expected] of [
    ["R$ 350.000,00", 350000],
    ["350.000", 350000],
    ["350000.50", 350000.5],
    [350000, 350000],
    ["desconhecido", undefined],
    [-1, undefined],
  ])
    it(`capital válido: ${raw}`, () => assert.equal(parseIndustrialCapital(raw), expected));
  it("bloqueio explícito usa limites de palavras", async () => {
    const config = settings();
    config.blockedFamilies = [
      { id: "b", name: "Forno", terms: ["forno"], reason: "Não comercializado" },
    ];
    assert.equal(
      (await decide({ settings: config, input: input("Preciso de forno") })).status,
      "not_offered",
    );
    assert.notEqual(
      (await decide({ settings: config, input: input("fornecedor de APF500") })).status,
      "not_offered",
    );
  });
  it("catálogo vazio e modelo inativo não confirmam classificação", async () => {
    assert.equal((await decide({ settings: emptyIndustrialSettings() })).reason, "catalog_empty");
    const config = settings();
    config.catalog[0].active = false;
    assert.equal((await decide({ settings: config })).status, "review");
  });
  it("não substitui envasadora por empacotadora, apesar da descrição de envase", async () => {
    const result = await decide({
      input: input("Envasadora de pastosos"),
      suggest: async (candidates) => {
        assert.deepEqual(
          candidates.map((item) => item.id),
          ["semi"],
        );
        return { machineId: "premium", confidence: 1, reason: "Envase" };
      },
    });
    assert.equal(result.status, "review");
    assert.equal(result.machineId, null);
  });
  it("contradição de categoria prevalece até sobre código exato", async () => {
    assert.equal(
      (await decide({ input: input("Envasadora AFPP1328") })).reason,
      "category_conflict",
    );
  });
  for (const raw of [
    null,
    { machineId: "inventado", confidence: 1, reason: "" },
    { machineId: "semi", confidence: 0.94, reason: "" },
    { machineId: "semi", confidence: "1", reason: "" },
    { machineId: "semi", confidence: 1, reason: "", line: "PERSONNALITE" },
  ])
    it(`resposta não confirmada: ${JSON.stringify(raw)}`, async () =>
      assert.equal(
        (await decide({ input: input("Envasadora"), suggest: async () => raw })).status,
        "review",
      ));
  it("sugestão válida de ID concreto e confiança >=95% confirma Semi", async () => {
    assert.equal(
      (
        await decide({
          input: input("Envasadora"),
          suggest: async () => ({
            machineId: "semi",
            confidence: 0.95,
            reason: "Modelo compatível",
          }),
        })
      ).status,
      "confirmed",
    );
  });
  it("timeout/falha técnica conduz à revisão", async () =>
    assert.equal((await decide({ input: input("Envasadora") })).reason, "decisor_unavailable"));
  it("dois modelos exatos na solicitação exigem revisão", async () =>
    assert.equal(
      (await decide({ input: input("APF500 e AFPP1328") })).reason,
      "ambiguous_exact_match",
    ));
  it("Decisor comercial não substitui intenção de suporte, financeiro ou peças", async () => {
    const result = await decide();
    for (const text of [
      "Preciso de manutenção na envasadora",
      "Quero boleto da máquina",
      "Preciso de peça",
    ]) {
      const route = resolveIndustrialRoute({ text, collectedData: {} });
      assert.deepEqual(applyMachineDecision(route, result), route);
    }
  });
  it("converte campos antigos sem aceitar linha desconhecida nem repetir SKU ativo", () => {
    const catalog = convertLegacyMachineCatalog([
      {
        cod_next: "APF500",
        nome: "Envasadora APF500",
        linha: "Semi",
        produtividade: "500/h",
        sobre: "Dados técnicos",
      },
    ]);
    assert.equal(catalog[0].line, "SEMI-INDUSTRIAL");
    assert.equal(catalog[0].code, "APF500");
    assert.throws(() => convertLegacyMachineCatalog([{ nome: "Máquina", linha: "desconhecida" }]));
    const config = settings();
    config.catalog.push({ ...config.catalog[0], id: "other" });
    assert.equal(industrialSettingsSchema.safeParse(config).success, false);
  });
  it("destino desconhecido, etapa ausente e tenant/ativação no JSON são rejeitados", () => {
    for (const extra of [
      { tenantId: "outro" },
      { enabled: 1 },
      { destinations: { INVALIDO: { sectorId: "s" } } },
      { destinations: { MAQUINAS: { sectorId: "s", pipelineId: "p" } } },
    ])
      assert.equal(industrialSettingsSchema.safeParse({ ...settings(), ...extra }).success, false);
  });
});

// Executa os handlers reais com sessão e persistência simuladas; imports fora da allowlist falham.
function apiHarness({
  role = "admin",
  authenticated = true,
  industrial = true,
  conflict = false,
} = {}) {
  let calls = 0;
  class SettingsError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const dependencies = {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    zod: { z },
    "../../../db": { db: {} },
    "../../../lib/auth-session": {
      requireSession: async () =>
        authenticated
          ? { session: { tenantId: "session-tenant", operator: { id: "admin", role } } }
          : { response: new Response(null, { status: 401 }) },
    },
    "../../../lib/ai-persona": {
      getAiPersona: () => ({ triagePolicy: industrial ? "industrial" : undefined }),
    },
    "../../../lib/triage/industrial-settings-store": {
      IndustrialSettingsError: SettingsError,
      readIndustrialSettings: async (_, tenantId) => {
        assert.equal(tenantId, "session-tenant");
        calls++;
        return { revision: 0, settings: emptyIndustrialSettings() };
      },
      industrialSettingsChoices: async (_, tenantId) => {
        assert.equal(tenantId, "session-tenant");
        calls++;
        return {};
      },
      saveIndustrialSettings: async (_, tenantId, revision, input, operatorId) => {
        assert.equal(tenantId, "session-tenant");
        assert.equal(operatorId, "admin");
        calls++;
        if (conflict) throw new SettingsError("Conflito de revisão", 409);
        return { revision: revision + 1, settings: industrialSettingsSchema.parse(input) };
      },
    },
  };
  const code = ts.transpileModule(
    fs.readFileSync(
      new URL("../src/routes/api/valentina/industrial-settings.ts", import.meta.url),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Response,
    Request,
    console: { error() {} },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Import não permitido: ${name}`);
      return dependencies[name];
    },
  });
  const handlers = module.exports.Route.server.handlers;
  return {
    calls: () => calls,
    get: () => handlers.GET({ request: new Request("http://test/api?tenantId=outro") }),
    post: (body) =>
      handlers.POST({
        request: new Request("http://test/api?tenantId=outro", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      }),
  };
}
describe("destinos unificados e compatibilidade de configuração", () => {
  const binding = { sectorId: "finance", pipelineId: "pipeline", stageId: "entry" };
  it("mantém os assuntos específicos com um destino por equipe", () => {
    for (const [text, subflow, destination] of [
      ["Preciso de boleto", "2A_BOLETO", "FINANCEIRO"],
      ["Preciso de XML", "2B_NF", "FINANCEIRO"],
      ["Preciso de estorno", "2C_OUTROS", "FINANCEIRO"],
      ["Quero rastrear meu pedido", "4A_RASTREAR", "POS_VENDA"],
      ["Nota fiscal do pedido", "4B_NF", "POS_VENDA"],
      ["Quero devolver a compra", "POS_VENDA", "POS_VENDA"],
      ["Quero falar com humano", "5A_CLIENTE", "REVIEW"],
    ]) {
      const route = resolveIndustrialRoute({ text, collectedData: {} });
      assert.equal(route.subflow, subflow, text);
      assert.equal(industrialDestinationKey(route), destination, text);
    }
    assert.equal(DESTINATION_KEYS.length, 7);
    assert.equal(DESTINATION_KEYS.includes("5A_CLIENTE"), false);
  });
  it("lê vínculos antigos iguais e consolida sem duplicar destinos", () => {
    const input = {
      ...emptyIndustrialSettings(),
      destinations: {
        "2A_BOLETO": binding,
        "2B_NF": { ...binding },
        "2C_OUTROS": { ...binding },
        "4A_RASTREAR": binding,
        "4B_NF": { ...binding },
        POS_VENDA: { ...binding },
        "5A_CLIENTE": { sectorId: "review" },
        REVIEW: { sectorId: "review" },
      },
    };
    assert.equal(industrialSettingsSchema.safeParse(input).success, true);
    assert.deepEqual(consolidateIndustrialDestinations(input).destinations, {
      FINANCEIRO: binding,
      POS_VENDA: binding,
      REVIEW: { sectorId: "review" },
    });
    assert.ok(input.destinations["2A_BOLETO"]); // consulta não modifica o JSON original
  });
  it("vínculos divergentes não escolhem equipe, funil ou etapa arbitrariamente", () => {
    for (const patch of [{ sectorId: "other" }, { pipelineId: "other" }, { stageId: "other" }]) {
      const input = {
        ...emptyIndustrialSettings(),
        destinations: {
          "2A_BOLETO": binding,
          "2B_NF": { ...binding, ...patch },
        },
      };
      const resolved = resolveIndustrialDestination(input, "FINANCEIRO");
      assert.equal(resolved.conflict, true);
      assert.equal(resolved.destination, undefined);
      assert.throws(() => consolidateIndustrialDestinations(input), /Financeiro/);
      const corrected = setIndustrialDestination(input, "FINANCEIRO", binding);
      assert.deepEqual(consolidateIndustrialDestinations(corrected).destinations, {
        FINANCEIRO: binding,
      });
      assert.deepEqual(setIndustrialDestination(input, "FINANCEIRO").destinations, {});
    }
  });
  it("Atendimento Geral e revisão humana convergem sem perder divergência de configuração", () => {
    const input = {
      ...emptyIndustrialSettings(),
      destinations: {
        "5A_CLIENTE": { sectorId: "old" },
        REVIEW: { sectorId: "review" },
      },
    };
    assert.equal(resolveIndustrialDestination(input, "REVIEW").conflict, true);
    const corrected = setIndustrialDestination(input, "REVIEW", { sectorId: "review" });
    assert.deepEqual(consolidateIndustrialDestinations(corrected).destinations, {
      REVIEW: { sectorId: "review" },
    });
    const withFunnel = setIndustrialDestination(corrected, "REVIEW", {
      sectorId: "review",
      pipelineId: "pipe-sdr",
      stageId: "stage-analise",
    });
    assert.equal(industrialSettingsSchema.safeParse(withFunnel).success, true);
    assert.deepEqual(consolidateIndustrialDestinations(withFunnel).destinations, {
      REVIEW: { sectorId: "review", pipelineId: "pipe-sdr", stageId: "stage-analise" },
    });
  });
  it("nomes antigos preservam o assunto e apontam para o destino novo", () => {
    for (const [name, subflow, targetFunnel] of [
      ["Fin. Boleto", "2A_BOLETO", "Financeiro"],
      ["Fin. Nota Fiscal", "2B_NF", "Financeiro"],
      ["Pós-Venda Rastreio", "4A_RASTREAR", "Pós-Venda"],
      ["Pós-Venda - NF do Pedido", "4B_NF", "Pós-Venda"],
      ["Atendimento Geral", "5A_CLIENTE", "Análise e revisão humana"],
    ]) {
      const route = resolveIndustrialRoute({ existingFunnel: name, collectedData: {} });
      assert.equal(route.subflow, subflow);
      assert.equal(route.targetFunnel, targetFunnel);
    }
  });
});

describe("configuração industrial autenticada", () => {
  for (const [options, expected] of [
    [{ authenticated: false }, 401],
    [{ role: "agent" }, 403],
    [{ industrial: false }, 404],
  ])
    it(`nega leitura e escrita antes da persistência: ${expected}`, async () => {
      const api = apiHarness(options);
      assert.equal((await api.get()).status, expected);
      assert.equal((await api.post({})).status, expected);
      assert.equal(api.calls(), 0);
    });
  it("tenant e operador vêm apenas da sessão", async () => {
    const api = apiHarness();
    assert.equal((await api.get()).status, 200);
    assert.equal(
      (await api.post({ expectedRevision: 0, settings: emptyIndustrialSettings() })).status,
      200,
    );
  });
  it("body não pode informar tenant ou habilitar SDR", async () => {
    const api = apiHarness();
    assert.equal(
      (
        await api.post({
          tenantId: "outro",
          expectedRevision: 0,
          settings: emptyIndustrialSettings(),
        })
      ).status,
      400,
    );
    assert.equal(api.calls(), 0);
  });
  it("conflito de revisão retorna 409", async () => {
    const api = apiHarness({ conflict: true });
    assert.equal(
      (await api.post({ expectedRevision: 0, settings: emptyIndustrialSettings() })).status,
      409,
    );
  });
});
