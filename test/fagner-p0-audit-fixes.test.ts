import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateIndustrialSdrOwnershipGuard,
  isIndustrialOwnerStillValidForSend,
} from "../src/lib/triage/industrial-ownership-guard";
import {
  claimsIndustrialHandoffEffect,
  industrialClientMessages,
} from "../src/lib/triage/industrial-handoff";
import { resolveIndustrialRoute } from "../src/lib/triage/industrial-policy";
import { deriveVtexQuery } from "../src/lib/vtex/turn";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import { getAiPersona } from "../src/lib/ai-persona";

describe("Correções P0 — Auditoria das 70 triagens do Fagner (20–23/11/2026)", () => {
  describe("P0.1 — Bloqueio de colisão em queueState=fila e AGENT externo ativo", () => {
    it("bloqueia SDR interno quando a conversa está em queueState='fila' (casos Bruno, Jaqueline, Yanny, Mauro, Rafael)", () => {
      const decision = evaluateIndustrialSdrOwnershipGuard({
        queueState: "fila",
        operatorId: null,
        flowOutcome: "in_progress",
        flowMetadata: {},
      });
      expect(decision.blocked).toBe(true);
      expect(decision.reason).toBe("non_automacao_queue:fila");
    });

    it("bloqueia SDR interno mesmo em 'automacao' se um AGENT externo/humano falou por último após o início do ciclo", () => {
      const now = new Date("2026-11-23T12:46:00.000Z");
      const decision = evaluateIndustrialSdrOwnershipGuard({
        queueState: "automacao",
        operatorId: null,
        flowOutcome: "in_progress",
        flowMetadata: {},
        flowStartedAt: new Date("2026-11-23T11:50:00.000Z"),
        latestOutbound: {
          senderType: "agent",
          sentAt: new Date("2026-11-23T12:45:00.000Z"),
          isInternalNote: false,
        },
        now,
      });
      expect(decision.blocked).toBe(true);
      expect(decision.reason).toBe("external_agent_active");
    });

    it("permite SDR interno em 'automacao' no resgate proativo (bot falou por último) e em leads orgânicos", () => {
      const now = new Date("2026-11-23T12:46:00.000Z");

      // Resgate proativo: bot falou por último
      const rescueDecision = evaluateIndustrialSdrOwnershipGuard({
        queueState: "automacao",
        operatorId: null,
        flowOutcome: "in_progress",
        flowMetadata: {},
        flowStartedAt: new Date("2026-11-22T22:00:00.000Z"),
        latestOutbound: {
          senderType: "bot",
          sentAt: new Date("2026-11-22T22:01:00.000Z"),
          isInternalNote: false,
        },
        now,
      });
      expect(rescueDecision.blocked).toBe(false);

      // Reabertura em automação: última mensagem de agent é antiga (antes de flowStartedAt)
      const reopenedDecision = evaluateIndustrialSdrOwnershipGuard({
        queueState: "automacao",
        operatorId: null,
        flowOutcome: "in_progress",
        flowMetadata: {},
        flowStartedAt: new Date("2026-11-23T12:00:00.000Z"),
        latestOutbound: {
          senderType: "agent",
          sentAt: new Date("2026-11-06T15:00:00.000Z"),
          isInternalNote: false,
        },
        now,
      });
      expect(reopenedDecision.blocked).toBe(false);
    });

    it("isIndustrialOwnerStillValidForSend rejeita envio em fila/finalizados e aceita automacao ou meus do operador alocado", () => {
      expect(isIndustrialOwnerStillValidForSend({ queueState: "fila", operatorId: null, expectedOperatorId: null })).toBe(false);
      expect(isIndustrialOwnerStillValidForSend({ queueState: "finalizados", operatorId: null, expectedOperatorId: null })).toBe(false);
      expect(isIndustrialOwnerStillValidForSend({ queueState: "meus", operatorId: null, expectedOperatorId: null })).toBe(false);
      expect(isIndustrialOwnerStillValidForSend({ queueState: "automacao", operatorId: null, expectedOperatorId: null })).toBe(true);
      expect(isIndustrialOwnerStillValidForSend({ queueState: "meus", operatorId: "op-1", expectedOperatorId: "op-1" })).toBe(true);
    });

    it("inbound.ts e sdr-engine.ts aplicam evaluateIndustrialSdrOwnershipGuard e isIndustrialOwnerStillValidForSend", () => {
      const inboundSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/whatsapp/inbound.ts"), "utf8");
      const sdrEngineSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/valentina/sdr-engine.ts"), "utf8");
      expect(inboundSrc).toContain("evaluateIndustrialSdrOwnershipGuard");
      expect(sdrEngineSrc).toContain("evaluateIndustrialSdrOwnershipGuard");
      expect(sdrEngineSrc).toContain("isIndustrialOwnerStillValidForSend");
    });
  });

  describe("P0.2 — Eliminação do falso encaminhamento em collecting", () => {
    it("intercepta promessas de encaminhamento em Pós-Venda sem nome (casos Bruna Fernandes e Pinguim) e pede o nome", () => {
      const route = resolveIndustrialRoute({
        text: "Fiz uma compra pelo site dia 12 e não recebi e-mail sobre a entrega",
        collectedData: {
          "CNPJ OU CPF": { value: "07155274100", status: "filled" },
          "MÁQUINA / PEÇA / INTERESSE": { value: "Compra no site em 12/11/2026", status: "filled" },
          "SETOR / FUNIL DE DESTINO": { value: "Pós-Venda", status: "filled" },
        },
      });
      const data = {
        "CNPJ OU CPF": { value: "07155274100", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Compra no site em 12/11/2026", status: "filled" },
        "SETOR / FUNIL DE DESTINO": { value: "Pós-Venda", status: "filled" },
      };

      const falsePromises = [
        ["Já estou direcionando sua solicitação para a nossa equipe de Pós-Venda. Eles darão continuidade."],
        ["Nossa equipe de Pós-Venda já recebeu sua solicitação e entrará em contato em breve com as informações."],
        ["Sua solicitação foi direcionada à equipe de Pós-Venda às 08:20."],
        ["A equipe de Pós-Venda já foi acionada e entrará em contato em breve com as informações sobre o seu envio."],
        ["A solicitação já está com a equipe responsável, que dará prioridade ao seu contato."],
      ];

      for (const msgs of falsePromises) {
        expect(claimsIndustrialHandoffEffect(msgs)).toBe(true);
        const sanitized = industrialClientMessages({
          result: { status: "collecting", operator: null, deal: null },
          route,
          data,
          messages: msgs,
        });
        expect(sanitized).toEqual(["Pode me informar seu nome?"]);
      }
    });

    it("intercepta promessas de encaminhamento sem documento (casos Glaucio, Roselio, Mauro) e pede o dado faltante", () => {
      const routeMaq = resolveIndustrialRoute({
        text: "Quero uma envasadora para galões",
        collectedData: {
          "NOME COMPLETO": { value: "Roselio Machado", status: "filled" },
          "MÁQUINA / PEÇA / INTERESSE": { value: "Envasadora", status: "filled" },
          "RAMO / O QUE EMBALA": { value: "Água", status: "filled" },
          "VOLUME / PRODUÇÃO": { value: "700 galões", status: "filled" },
        },
      });
      const dataMaq = {
        "NOME COMPLETO": { value: "Roselio Machado", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Envasadora", status: "filled" },
        "RAMO / O QUE EMBALA": { value: "Água", status: "filled" },
        "VOLUME / PRODUÇÃO": { value: "700 galões", status: "filled" },
      };

      for (const msg of [
        "Vou direcionar seu atendimento a um de nossos especialistas em linhas de envase.",
        "Seu contato já foi encaminhado. Em breve, um de nossos especialistas entrará em contato.",
        "Em instantes, um especialista retornará o contato com essa informação para você.",
      ]) {
        expect(claimsIndustrialHandoffEffect([msg])).toBe(true);
        const sanitized = industrialClientMessages({
          result: { status: "collecting", operator: null, deal: null },
          route: routeMaq,
          data: dataMaq,
          messages: [msg],
        });
        expect(sanitized).toEqual(["Pode me informar o CNPJ ou CPF para localizar o cadastro?"]);
      }
    });

    it("NÃO bloqueia perguntas legítimas de coleta que apenas explicam o objetivo do dado pedido", () => {
      const normalQuestion = [
        "Para que eu possa direcionar sua solicitação ao especialista de peças, poderia me informar seu nome completo e CNPJ ou CPF?",
      ];
      expect(claimsIndustrialHandoffEffect(normalQuestion)).toBe(false);
    });
  });

  describe("P0.3 — Bloqueio de gatilho residual VTEX (Bruno, luizrufino670, Gabriel)", () => {
    it("NÃO dispara consulta VTEX em frases consultivas com 'especificações', 'acima', 'ficha técnica' sem produto/SKU nem em links sociais", () => {
      expect(deriveVtexQuery("Quero comprar uma seladora nestas especificações", null)).toBeNull();
      expect(deriveVtexQuery("Ola fagner preciso comprar seladora nas especificações acima", null)).toBeNull();
      expect(deriveVtexQuery("me mande a ficha técnica", null)).toBeNull();
      expect(deriveVtexQuery("https://www.instagram.com/reel/Df9_21GRhRJ/?knvt=Nmdzam9kZGRraHU3", null)).toBeNull();
      expect(deriveVtexQuery("https://www.facebook.com/share/r/1XFk5GvzJo/", null)).toBeNull();
    });

    it("mantém funcionamento para URL real da loja Tecfag, SKU explícito e consulta de ficha técnica com modelo nomeado", () => {
      const storeUrl = deriveVtexQuery("https://www.tecfag.com.br/seladora-s100/p", null);
      expect(storeUrl?.query).toMatchObject({ kind: "url", value: "https://www.tecfag.com.br/seladora-s100/p" });

      const skuQuery = deriveVtexQuery("Qual a ficha técnica do SKU 417?", null);
      expect(skuQuery?.query).toMatchObject({ kind: "sku", value: "417" });

      const namedSpecs = deriveVtexQuery("Qual a ficha técnica da seladora DZ500?", null);
      expect(namedSpecs?.query).toMatchObject({ kind: "term", value: "seladora DZ500" });
    });
  });

  describe("P0.4 — Prompt anti-falso-encaminhamento e limites reais de capacidade/dimensão", () => {
    it("reforça no prompt do Fagner proibição de prometer solução acima da capacidade do catálogo e falso encaminhamento", () => {
      const prompt = buildTecfagFagnerPrompt({
        aiPersona: getAiPersona("tecfag"),
        knowledgeContext: "",
        conversationHistoryText: "",
        batchSummary: "Preciso envasar galões de 20L",
        currentDataSummary: {},
        cnpjDirective: "",
        firstMessageRule: "",
        hasPreviousEmoji: false,
        hasPreviousAudio: false,
      });

      expect(prompt).toContain("galões de 20L");
      expect(prompt).toContain("PROIBIÇÃO DE FALSO ENCAMINHAMENTO EM COLETA");
    });
  });
});
