// Suite offline: Node não carrega .env; imports restritos a políticas sem banco/provedor.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INDUSTRIAL_ROUTES,
  resolveIndustrialRoute,
  assessIndustrialReadiness,
  canFinishIndustrialTriage,
  isValidTriageDocument,
  hasPendingTriageQuestion,
  isEligibleIndustrialOperator,
  requestsHuman,
  requestsGenericHuman,
  isPastPersonReference,
  resolveDirectOperatorRequest,
  getIndustrialTargetFields,
  getAdaptiveIndustrialCollectedData,
  computeIndustrialTriageProgress,
} from "../src/lib/triage/industrial-policy.ts";
import {
  evaluateKnownCompanyConfirmation,
  applyKnownClientConfirmationToData,
  buildKnownClientPromptDirective,
} from "../src/lib/triage/known-client-lookup.ts";
import {
  executeIndustrialHandoff,
  industrialHandoffOutcome,
  industrialHandoffMessage,
  industrialClientMessages,
} from "../src/lib/triage/industrial-handoff.ts";
import { parseIndustrialAiResult } from "../src/lib/triage/industrial-ai-result.ts";
import {
  buildTecfagFagnerPrompt,
  resolveTecfagStageAndFunnel,
} from "../src/lib/valentina/sdr-tecfag-prompt.ts";
import { resolveLegacySdrStageAndFunnel } from "../src/lib/valentina/legacy-sdr-routing.ts";
import { getAiPersona } from "../src/lib/ai-persona.ts";
import {
  getFlowConfiguration,
  FLOW_AREAS,
  ALL_FLOW_FUNNELS,
} from "../src/lib/valentina/rodizio-types.ts";

const baseline = JSON.parse(
  readFileSync(new URL("../docs/fagner-triage-parity-2026-10-20.json", import.meta.url), "utf8"),
);
const fields = (values) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value, status: "filled" }]),
  );
const complete = fields({
  "NOME COMPLETO": "Pessoa de Teste",
  "CNPJ OU CPF": "11.222.333/0001-81",
  "MÁQUINA / PEÇA / INTERESSE": "Envasadora para cosméticos",
  "RAMO / O QUE EMBALA": "Shampoo",
  "VOLUME / PRODUÇÃO": "300 frascos/dia",
});
const route = (text, extra = {}) => resolveIndustrialRoute({ text, collectedData: {}, ...extra });

describe("roteamento industrial: regressões observadas no porte", () => {
  it("mantém 13 subfluxos explícitos", () =>
    assert.equal(Object.keys(INDUSTRIAL_ROUTES).length, 13));
  for (const sample of baseline.scenarios) {
    it(sample.id, () => {
      const result = resolveTecfagStageAndFunnel({
        collectedData: fields({ "MÁQUINA / PEÇA / INTERESSE": sample.input }),
      });
      assert.equal(result.funnelStage, sample.legacy.stage);
    });
  }
  for (const [text, subflow] of [
    ["Boleto da seladora", "2A_BOLETO"],
    ["Nota fiscal do pedido", "4B_NF"],
    ["Preciso de XML", "2B_NF"],
    ["Quero devolver e saber do reembolso", "POS_VENDA"],
    ["Já devolvi a máquina e quero meu dinheiro de volta", "2C_OUTROS"],
    ["Preciso de uma seladora manual", "MAQUINAS"],
    ["Preciso do manual da seladora", "3_AT"],
    ["Preciso de assistência técnica da linha Personnalité", "3_AT"],
    ["Quero comprar uma seladora mas deu problema no site", "MAQUINAS"],
    ["Trabalho no setor de compras e quero cotar uma máquina", "MAQUINAS"],
  ])
    it(text, () => assert.equal(route(text).subflow, subflow));
  it("nenhum fallback desconhecido vira Máquinas", () => {
    assert.deepEqual(
      resolveTecfagStageAndFunnel({
        existingStage: "invalido",
        existingFunnel: "invalido",
        collectedData: {},
      }),
      { funnelStage: "triagem", targetFunnel: null },
    );
    assert.equal(route("Oi").targetFunnel, null);
    const unclassified = route("", { aiFunnelStage: "outros" });
    assert.equal(unclassified.targetFunnel, "Análise e revisão humana");
    assert.equal(assessIndustrialReadiness(unclassified, {}).action, "review");
    assert.equal(assessIndustrialReadiness(unclassified, {}).ready, true);
    assert.equal(route("", { aiFunnelStage: "sem_resposta" }).targetFunnel, null);
  });
  it("pedido atual sobrepõe setor anterior e declaração errada do LLM", () => {
    assert.equal(
      route("Quero saber do estorno", {
        aiSubflow: "PERSONNALITE",
        existingSubflow: "MAQUINAS",
        collectedData: complete,
      }).subflow,
      "2C_OUTROS",
    );
  });
  it("intenção específica Peças não é sobreposta pela linha no interesse anterior", () => {
    assert.equal(
      route("", {
        aiTargetFunnel: "Peças",
        collectedData: fields({ "MÁQUINA / PEÇA / INTERESSE": "Máquina Personnalité" }),
      }).subflow,
      "PECAS",
    );
  });
  it("linha premium exige evidência confiável e não substitui suporte", () => {
    assert.equal(route("Quero ver soluções Personnalité").subflow, "MAQUINAS");
    assert.equal(route("Quero ver soluções Personnalité").needsReview, true);
    const evidence = { source: "catalog", group: "PERSONNALITE", confidence: 0.95 };
    assert.equal(
      route("Quero uma envasadora", { machineEvidence: evidence }).subflow,
      "PERSONNALITE",
    );
    assert.equal(
      route("Quero uma envasadora", { machineEvidence: { ...evidence, confidence: 0.5 } }).subflow,
      "MAQUINAS",
    );
    assert.equal(
      route("Manutenção na máquina Personnalité", { machineEvidence: evidence }).subflow,
      "3_AT",
    );
  });
});

describe("coleta e conclusão por intenção", () => {
  it("suporte não exige documento, empresa ou série", () => {
    const request = fields({
      "NOME COMPLETO": "Pessoa de Teste",
      "MÁQUINA / PEÇA / INTERESSE": "Preciso do manual",
    });
    assert.equal(assessIndustrialReadiness(route("Preciso do manual"), request).ready, true);
    assert.equal(assessIndustrialReadiness(route("Preciso do manual"), {}).ready, false);
  });
  for (const request of [
    "Quero falar com um humano",
    "Prefiro falar com um atendente",
    "Pode me transferir para a Jessica",
    "Quero falar com a Jessica",
  ]) {
    it(request, () => {
      const result = route(request);
      assert.equal(result.subflow, "5A_CLIENTE");
      assert.equal(
        canFinishIndustrialTriage({
          route: result,
          data: {},
          isCompleted: false,
          hasPendingQuestion: true,
        }),
        true,
      );
      assert.equal(assessIndustrialReadiness(result, {}).createsDeal, false);
    });
  }
  it("cotação sem pedido humano continua comercial", () =>
    assert.equal(route("Quero um orçamento de seladora").subflow, "MAQUINAS"));
  it("comercial precisa de aplicação, produção e documento válido; empresa não substitui documento", () => {
    assert.equal(assessIndustrialReadiness(route("Quero uma envasadora"), complete).ready, true);
    for (const key of ["CNPJ OU CPF", "RAMO / O QUE EMBALA", "VOLUME / PRODUÇÃO"]) {
      const missing = { ...complete };
      delete missing[key];
      assert.equal(assessIndustrialReadiness(route("Quero uma envasadora"), missing).ready, false);
    }
    assert.equal(
      assessIndustrialReadiness(route("Quero uma envasadora"), {
        ...complete,
        "CNPJ OU CPF": { value: "12345678901" },
        EMPRESA: { value: "Empresa de Teste" },
      }).ready,
      false,
    );
  });
  it("Peças não exige o questionário de produção", () => {
    const parts = { ...complete };
    delete parts["RAMO / O QUE EMBALA"];
    delete parts["VOLUME / PRODUÇÃO"];
    assert.equal(assessIndustrialReadiness(route("Preciso de ribbon"), parts).ready, true);
  });
  it("campos pendentes/placeholders não concluem o atendimento", () => {
    for (const entry of [
      { value: "Aguardando..." },
      { value: "Não informado" },
      { value: "-" },
      { value: "Sim" },
      { value: "Pessoa", status: "pending" },
    ]) {
      assert.equal(
        assessIndustrialReadiness(route("Preciso de suporte técnico"), {
          ...complete,
          "NOME COMPLETO": entry,
        }).ready,
        false,
      );
    }
  });
  it("valida dígitos de CPF/CNPJ sem afirmar titularidade", () => {
    for (const doc of ["529.982.247-25", "11.222.333/0001-81"])
      assert.equal(isValidTriageDocument(doc), true);
    for (const doc of [
      "52998224726",
      "11222333000180",
      "11111111111",
      "00000000000000",
      "CPF",
      "CPF 52998224725",
      "",
    ])
      assert.equal(isValidTriageDocument(doc), false);
  });
  it("pergunta real impede concluir mesmo com dados e despedida", () => {
    assert.equal(hasPendingTriageQuestion(["Seu CNPJ é esse, está correto?"]), true);
    assert.equal(hasPendingTriageQuestion(["Certo?"]), false);
    assert.equal(
      hasPendingTriageQuestion(["Anotei seu CNPJ e encaminharei para a equipe."]),
      false,
    );
    assert.equal(
      canFinishIndustrialTriage({
        route: route("Quero uma envasadora"),
        data: complete,
        isCompleted: true,
        hasPendingQuestion: true,
      }),
      false,
    );
    assert.equal(
      canFinishIndustrialTriage({
        route: route("Quero uma envasadora"),
        data: complete,
        isCompleted: false,
      }),
      false,
    );
  });
});

describe("contrato da resposta estruturada e persona", () => {
  it("rejeita respostas malformadas e flags textuais", () => {
    for (const invalid of [
      null,
      {},
      { messagesToSend: [] },
      { messagesToSend: [42] },
      { messagesToSend: [" "] },
      { messagesToSend: ["ok"], isCompleted: "false" },
      { messagesToSend: ["ok"], subflow: "INVALID" },
      { messagesToSend: ["ok"], extractedData: { EMPRESA: true } },
    ])
      assert.equal(parseIndustrialAiResult(invalid), null);
  });
  it("não permite que LLM injete metadados de classificação ou saída de áudio", () => {
    const parsed = parseIndustrialAiResult({
      messagesToSend: ["Tudo certo"],
      extractedData: {
        "NOME COMPLETO": "Pessoa",
        _RECEITA_FEDERAL: "inventado",
        constructor: "inventado",
      },
      machineEvidence: { source: "catalog" },
      audioMessage: { text: "Fale" },
    });
    assert.deepEqual(parsed.extractedData, { "NOME COMPLETO": "Pessoa" });
    assert.equal(parsed.audioMessage, null);
    assert.equal(parsed.machineEvidence, undefined);
  });
  it("gera regras a partir da política e da persona recebidas", () => {
    const prompt = buildTecfagFagnerPrompt({
      aiPersona: getAiPersona("tecfag"),
      knowledgeContext: "",
      conversationHistoryText: "",
      batchSummary: "",
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
      policyInstructions: "Orientação de teste",
    });
    for (const code of Object.keys(INDUSTRIAL_ROUTES)) assert.ok(prompt.includes(code));
    assert.ok(prompt.includes("Fagner"));
    assert.ok(prompt.includes("Orientação de teste"));
    assert.ok(!prompt.includes("Valentina"));
    assert.equal(getAiPersona("valem").triagePolicy, undefined);
  });
});

describe("handoff: sucesso depende do que foi efetivamente persistido", () => {
  function setup(overrides = {}) {
    const events = [];
    const operator = { id: "operator-test", name: "Equipe de Teste" };
    const deal = {
      dealId: "deal-test",
      dealTitle: "Negociação de Teste",
      action: "created_new",
      funnelId: "pipeline-test",
      stageId: "stage-test",
    };
    return {
      events,
      params: {
        route: route("Quero uma envasadora"),
        data: complete,
        allocate: async (funnel, before) => {
          events.push(["allocate", funnel]);
          await before(operator);
          events.push(["assigned"]);
          return operator;
        },
        ensureDeal: async () => {
          events.push(["deal"]);
          return deal;
        },
        verifyAssignment: async () => {
          events.push(["verified"]);
          return true;
        },
        ...overrides,
      },
    };
  }
  it("cria/vincula card antes de atribuir e só confirma depois de verificar", async () => {
    const { events, params } = setup();
    const result = await executeIndustrialHandoff(params);
    assert.equal(result.status, "transferred");
    assert.deepEqual(
      events.map(([event]) => event),
      ["allocate", "deal", "assigned", "verified"],
    );
    assert.equal(industrialHandoffOutcome(result.status), "transferred");
  });
  it("sem operador não cria card nem declara transferência", async () => {
    const { events, params } = setup({ allocate: async () => null });
    const result = await executeIndustrialHandoff(params);
    assert.equal(result.status, "waiting_for_team");
    assert.deepEqual(events, []);
    assert.equal(industrialHandoffOutcome(result.status), "in_progress");
  });
  it("falha de CRM, mesmo engolida pelo alocador, mantém pendência", async () => {
    const { params } = setup({
      ensureDeal: async () => {
        throw new Error("offline");
      },
      allocate: async (_, before) => {
        try {
          await before({ id: "test", name: "Test" });
        } catch {
          return null;
        }
        return null;
      },
    });
    assert.equal((await executeIndustrialHandoff(params)).status, "handoff_failed");
  });
  it("resultado de CRM sem dealId não confirma atribuição", async () => {
    const { params } = setup({ ensureDeal: async () => ({ dealId: "" }) });
    assert.equal((await executeIndustrialHandoff(params)).status, "handoff_failed");
  });
  it("retorno de operador sem prova de atribuição não é sucesso", async () => {
    const { params } = setup({ verifyAssignment: async () => false });
    assert.equal((await executeIndustrialHandoff(params)).status, "handoff_failed");
  });
  it("alocador que não executou pré-vínculo não confirma transferência comercial", async () => {
    const { params } = setup({ allocate: async () => ({ id: "test", name: "Test" }) });
    assert.equal((await executeIndustrialHandoff(params)).status, "handoff_failed");
  });
  it("informações administrativas não geram card nem rodízio", async () => {
    for (const text of ["Quero enviar meu currículo", "Sou fornecedor e quero oferecer produtos"]) {
      const { events, params } = setup({ route: route(text), data: {} });
      assert.equal((await executeIndustrialHandoff(params)).status, "resolved");
      assert.deepEqual(events, []);
    }
  });
  it("pedido de humano e financeiro geral usam equipe correta sem card", async () => {
    for (const [text, funnel] of [
      ["Quero falar com a Jessica", "Análise e revisão humana"],
      ["Preciso de reembolso", "Financeiro"],
    ]) {
      const { events, params } = setup({ route: route(text) });
      assert.equal((await executeIndustrialHandoff(params)).status, "transferred");
      assert.equal(events[0][1], funnel);
      assert.equal(
        events.some(([event]) => event === "deal"),
        false,
      );
    }
  });
  it("mensagens de pendência não anunciam transferência ou criação de card", () => {
    for (const status of ["waiting_for_team", "handoff_failed"]) {
      const message = industrialHandoffMessage(status);
      assert.ok(!/foi encaminhado|transferido|card criado/i.test(message));
      assert.equal(industrialHandoffOutcome(status), "in_progress");
    }
  });
});

describe("isolamento de comportamento do classificador anterior", () => {
  for (const sample of baseline.scenarios)
    it(`compatibilidade: ${sample.id}`, () => {
      assert.deepEqual(
        resolveLegacySdrStageAndFunnel({
          collectedData: fields({ "MÁQUINA / PEÇA / INTERESSE": sample.input }),
        }),
        sample.v2,
      );
    });
});

describe("equipes autorizadas e comunicação de pendências", () => {
  const operator = {
    id: "own-operator",
    funnels: ["Fin. Boleto"],
    isParticipating: true,
    isOnLeave: false,
    isPenalized: false,
  };
  const ids = new Set([operator.id]);
  it("autorizações anteriores do Financeiro valem para o destino unificado, sem liberar outras equipes", () => {
    assert.equal(isEligibleIndustrialOperator(operator, "Fin. Boleto", ids), true);
    assert.equal(isEligibleIndustrialOperator(operator, "Fin. Outros", ids), true);
    assert.equal(isEligibleIndustrialOperator(operator, "Financeiro", ids), true);
    assert.equal(isEligibleIndustrialOperator(operator, "Pós-Venda", ids), false);
    assert.equal(isEligibleIndustrialOperator(operator, "Análise e revisão humana", ids), false);
    assert.equal(isEligibleIndustrialOperator(operator, "", ids), false);
  });
  it("ID inexistente no tenant não participa mesmo se configurado no JSON", () => {
    assert.equal(
      isEligibleIndustrialOperator(operator, "Fin. Boleto", new Set(["foreign-operator"])),
      false,
    );
  });
  it("folga, penalização e saída da escala impedem atribuição", () => {
    for (const patch of [{ isOnLeave: true }, { isPenalized: true }, { isParticipating: false }])
      assert.equal(
        isEligibleIndustrialOperator({ ...operator, ...patch }, "Fin. Boleto", ids),
        false,
      );
  });
  it("Fluxos industrial expõe sete destinos unificados e preserva as opções da Valem", () => {
    const modern = getFlowConfiguration("tecfag");
    assert.deepEqual(modern.funnels, [
      "Máquinas",
      "Personnalité",
      "Peças",
      "Financeiro",
      "Assistência Técnica",
      "Pós-Venda",
      "Análise e revisão humana",
    ]);
    assert.deepEqual(getFlowConfiguration("valem"), {
      areas: FLOW_AREAS,
      funnels: ALL_FLOW_FUNNELS,
    });
  });
  it("pedido negado de humano não provoca transferência", () =>
    assert.equal(requestsHuman("Não quero falar com um humano"), false));
  it("mensagem do modelo não anuncia efeito que ainda não aconteceu", () => {
    const messages = industrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route: route("Quero uma seladora"),
      data: {},
      messages: ["Já criei seu card e estou te transferindo agora."],
    });
    assert.deepEqual(messages, ["Pode me informar seu nome?"]);
  });
});

describe("transferência direta nominal por contexto (directOperatorRequest)", () => {
  const systemOperators = [
    {
      id: "op-jhordan",
      name: "Jhordan Silva",
      role: "operator",
      status: "online",
      isOnLeave: false,
      funnels: ["Máquinas"],
    },
    {
      id: "op-jessica-ausente",
      name: "Jessica Oliveira",
      role: "operator",
      status: "ausente",
      isOnLeave: true,
      funnels: ["Peças"],
    },
    {
      id: "op-joao-1",
      name: "João Pedro",
      role: "operator",
      status: "online",
      isOnLeave: false,
      funnels: ["Máquinas"],
    },
    {
      id: "op-joao-2",
      name: "João Marcos",
      role: "operator",
      status: "online",
      isOnLeave: false,
      funnels: ["Assistência Técnica"],
    },
  ];

  it("cruza nome citado com operadores do sistema e pula todas as etapas da triagem quando direct_transfer", () => {
    const parsed = parseIndustrialAiResult({
      messagesToSend: ["Perfeito! Já estou te encaminhando para o Jhordan."],
      isCompleted: true,
      directOperatorRequest: {
        intent: "direct_transfer",
        citedName: "Jhordan",
        matchedOperatorId: "op-jhordan",
        matchedOperatorName: "Jhordan Silva",
      },
    });
    const resolved = resolveDirectOperatorRequest(parsed?.directOperatorRequest, systemOperators);
    assert.equal(resolved.status, "matched");
    assert.equal(resolved.operator?.id, "op-jhordan");
    assert.equal(resolved.operator?.isAbsent, false);

    const directRoute = resolveIndustrialRoute({
      text: "Preciso falar com o Jhordan",
      collectedData: {},
      directOperator: resolved,
    });
    assert.equal(directRoute.reason, "direct_operator_requested");
    assert.equal(directRoute.targetOperator?.id, "op-jhordan");
    assert.equal(directRoute.targetFunnel, "Máquinas");
    assert.equal(directRoute.needsReview, false);

    const readiness = assessIndustrialReadiness(directRoute, {});
    assert.equal(readiness.ready, true);
    assert.deepEqual(readiness.missing, []);
    assert.equal(
      canFinishIndustrialTriage({
        route: directRoute,
        data: {},
        isCompleted: true,
        hasPendingQuestion: false,
      }),
      true,
    );
  });

  it("diferencia menção histórica (já falei / um dia falei) de pedido atual e não transfere", () => {
    assert.equal(isPastPersonReference("Já falei com o Jhordan antes sobre uma seladora"), true);
    assert.equal(isPastPersonReference("Um dia falei com a Jessica ano passado"), true);
    assert.equal(requestsHuman("Já falei com o Jhordan antes sobre uma seladora"), false);
    assert.equal(requestsGenericHuman("Preciso falar com o Jhordan"), false);
    assert.equal(requestsGenericHuman("Quero falar com um atendente humano"), true);

    const resolved = resolveDirectOperatorRequest(
      {
        intent: "past_reference_only",
        citedName: "Jhordan",
        matchedOperatorId: null,
        matchedOperatorName: null,
      },
      systemOperators,
    );
    assert.equal(resolved.status, "past_reference_only");

    const normalRoute = resolveIndustrialRoute({
      text: "Já falei com o Jhordan semana passada, agora quero cotar uma seladora",
      collectedData: {},
      directOperator: resolved,
    });
    assert.equal(normalRoute.subflow, "MAQUINAS");
    assert.notEqual(normalRoute.reason, "direct_operator_requested");
    assert.notEqual(normalRoute.reason, "human_requested");
  });

  it("bloqueia transferência quando o nome citado não existe no sistema ou é homônimo ambíguo", () => {
    const notFound = resolveDirectOperatorRequest(
      {
        intent: "direct_transfer",
        citedName: "Roberto Carlos",
        matchedOperatorId: null,
        matchedOperatorName: null,
      },
      systemOperators,
    );
    assert.equal(notFound.status, "not_found");
    const routeAfterNotFound = resolveIndustrialRoute({
      text: "Preciso falar com o Roberto Carlos",
      collectedData: {},
      directOperator: notFound,
    });
    assert.notEqual(routeAfterNotFound.reason, "direct_operator_requested");
    assert.notEqual(routeAfterNotFound.reason, "human_requested");

    const homonym = resolveDirectOperatorRequest(
      {
        intent: "direct_transfer",
        citedName: "João",
        matchedOperatorId: null,
        matchedOperatorName: null,
      },
      systemOperators,
    );
    assert.equal(homonym.status, "ambiguous_homonym");
    assert.equal(homonym.homonyms.length, 2);
  });

  it("transfere mesmo quando operador está ausente e avisa que está ausente no momento e em breve entrará em contato", () => {
    const resolved = resolveDirectOperatorRequest(
      {
        intent: "direct_transfer",
        citedName: "Jessica",
        matchedOperatorId: "op-jessica-ausente",
        matchedOperatorName: "Jessica Oliveira",
      },
      systemOperators,
    );
    assert.equal(resolved.status, "matched");
    assert.equal(resolved.operator?.id, "op-jessica-ausente");
    assert.equal(resolved.operator?.isAbsent, true);

    const directRoute = resolveIndustrialRoute({
      text: "Preciso falar com a Jessica",
      collectedData: {},
      directOperator: resolved,
    });
    const handoffResult = {
      status: "transferred",
      operator: {
        id: "op-jessica-ausente",
        name: "Jessica Oliveira",
        isAbsent: true,
      },
      deal: null,
    };
    const msg = industrialHandoffMessage("transferred", "Jessica Oliveira", {
      isOperatorAbsent: true,
    });
    assert.match(msg || "", /Jessica Oliveira/);
    assert.match(msg || "", /No momento está ausente/i);
    assert.match(msg || "", /em breve entrará em contato/i);

    const clientMsgs = industrialClientMessages({
      result: handoffResult,
      route: directRoute,
      data: {},
      messages: [],
    });
    assert.equal(clientMsgs.length, 1);
    assert.match(clientMsgs[0], /No momento está ausente/i);
  });
});

describe("adaptação dinâmica de campos por setor e confirmação de empresa recorrente", () => {
  it("setor de Peças adapta os campos exibidos (sem Ramo/Volume) e calcula 100% de conclusão", () => {
    const pecasData = fields({
      "NOME COMPLETO": "Matheus",
      "CNPJ OU CPF": "48391558878",
      "MÁQUINA / PEÇA / INTERESSE": "cabeça de impressão da sua datadora",
      "SETOR / FUNIL DE DESTINO": "Peças",
    });

    const targetFields = getIndustrialTargetFields({
      subflow: "PECAS",
      funnelStage: "pecas",
      targetFunnel: "Peças",
      collectedData: pecasData,
      company: "TECFAG COMERCIO E IMPORTACAO LTDA",
      isCompleted: true,
    });

    assert.equal(targetFields.includes("RAMO / O QUE EMBALA"), false);
    assert.equal(targetFields.includes("VOLUME / PRODUÇÃO"), false);
    assert.deepEqual(targetFields, [
      "NOME COMPLETO",
      "EMPRESA",
      "CNPJ OU CPF",
      "MÁQUINA / PEÇA / INTERESSE",
      "SETOR / FUNIL DE DESTINO",
    ]);

    const progress = computeIndustrialTriageProgress({
      subflow: "PECAS",
      funnelStage: "pecas",
      targetFunnel: "Peças",
      collectedData: pecasData,
      company: "TECFAG COMERCIO E IMPORTACAO LTDA",
      isCompleted: true,
    });

    assert.equal(progress.percentage, 100);
    assert.equal(progress.filledCount, 5);
    assert.equal(progress.totalCount, 5);
    assert.equal(
      progress.adaptiveData["EMPRESA"]?.value,
      "TECFAG COMERCIO E IMPORTACAO LTDA",
    );
  });

  it("setor de Assistência Técnica (3_AT) exibe apenas os 3 campos pertinentes quando sem CNPJ", () => {
    const atData = fields({
      "NOME COMPLETO": "Carlos",
      "MÁQUINA / PEÇA / INTERESSE": "Minha seladora não aquece",
      "SETOR / FUNIL DE DESTINO": "Assistência Técnica",
    });

    const progress = computeIndustrialTriageProgress({
      subflow: "3_AT",
      funnelStage: "assistencia_tecnica",
      targetFunnel: "Assistência Técnica",
      collectedData: atData,
      isCompleted: false,
    });

    assert.deepEqual(progress.targetFields, [
      "NOME COMPLETO",
      "MÁQUINA / PEÇA / INTERESSE",
      "SETOR / FUNIL DE DESTINO",
    ]);
    assert.equal(progress.filledCount, 3);
    assert.equal(progress.totalCount, 3);
    assert.equal(progress.percentage, 100);
  });

  it("cliente recorrente no banco confirma 'Sua empresa é a XXX, certo?' com 'sim' e prossegue sem precisar informar CNPJ", () => {
    const knownClient = {
      companyName: "TECFAG COMERCIO E IMPORTACAO LTDA",
      document: "07.765.657/0001-00",
      contactName: "Matheus",
      source: "crm_account",
    };

    const directive = buildKnownClientPromptDirective({
      knownClient,
      confirmationStatus: "pending",
      currentData: {},
      subflow: "PECAS",
    });
    assert.match(directive, /NÃO precisa pedir o CNPJ/i);
    assert.match(
      directive,
      /Sua empresa é a TECFAG COMERCIO E IMPORTACAO LTDA, certo\?/,
    );

    const status = evaluateKnownCompanyConfirmation({
      clientText: "Sim, isso mesmo",
      recentBotMessages: [
        "Sua empresa é a TECFAG COMERCIO E IMPORTACAO LTDA, certo?",
      ],
      knownClient,
      currentData: {},
    });
    assert.equal(status, "confirmed");

    const enriched = applyKnownClientConfirmationToData(
      fields({
        "MÁQUINA / PEÇA / INTERESSE": "Resistência para seladora",
      }),
      knownClient,
    );

    const pecasRoute = resolveIndustrialRoute({
      text: "Resistência para seladora",
      aiSubflow: "PECAS",
      collectedData: enriched,
    });
    const readiness = assessIndustrialReadiness(pecasRoute, enriched);
    assert.equal(readiness.ready, true);
    assert.deepEqual(readiness.missing, []);
  });
});


