import { describe, expect, it } from "bun:test";
import {
  resolveIndustrialRoute,
  isPrePurchaseCommercialInquiry,
  isReplacementPartsIntent,
  isExplicitReplacementPartsIntent,
} from "../src/lib/triage/industrial-policy";
import {
  decideIndustrialMachine,
  applyMachineDecision,
  resolveEffectiveCatalogLine,
} from "../src/lib/triage/industrial-decisor";
import {
  emptyIndustrialSettings,
  industrialSettingsSchema,
} from "../src/lib/triage/industrial-settings";
import { projectIndustrialMonitoring } from "../src/lib/triage/industrial-monitor";

const fields = (values: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value, status: "filled" }]),
  );

describe("Onda 1 — Elevação de assertividade do Fagner (casos reais das evidências SDR)", () => {
  describe("1. Fim do sequestro por regex (Caio/Financeiro, Jeferson/Pós-Venda, Daiane/Peças, Ângelo/AT→Peças)", () => {
    it("Caio / Farmácia Miligrama: cotação de Rotuladora MT50 perguntando condição de pagamento, PIX e prazo de entrega permanece em MAQUINAS", () => {
      const msg =
        "Bom dia, me chamo Caio, falo em nome da Farmácia Miligrama (CNPJ: 56.982.667/0001-91). Gostaria da seguinte cotação em anexo: Rotuladora Semiautomática MT50 220V. Preciso também das seguintes informações: Frete + Condição de pagamento disponível + Possibilidade de desconto via PIX + Prazo de entrega.";
      expect(isPrePurchaseCommercialInquiry(msg)).toBe(true);

      const withAi = resolveIndustrialRoute({
        text: msg,
        aiSubflow: "MAQUINAS",
        collectedData: fields({
          "MÁQUINA / PEÇA / INTERESSE": "Rotuladora Semiautomática MT50 220V",
        }),
      });
      expect(withAi.subflow).toBe("MAQUINAS");
      expect(withAi.targetFunnel).toBe("Máquinas");

      const withoutAi = resolveIndustrialRoute({
        text: msg,
        aiSubflow: null,
        collectedData: fields({
          "MÁQUINA / PEÇA / INTERESSE": "Rotuladora Semiautomática MT50 220V",
        }),
      });
      expect(withoutAi.subflow).toBe("MAQUINAS");
    });

    it("Pergunta comercial de parcelamento no boleto ('Essa semiautomática no boleto em 5x dá quanto?') permanece em MAQUINAS, mas 2ª via de boleto continua 2A_BOLETO", () => {
      const commercial = resolveIndustrialRoute({
        text: "Essa semiautomática no boleto em 5x dá quanto? Junto com o frete?",
        aiSubflow: "MAQUINAS",
        existingSubflow: "MAQUINAS",
        collectedData: fields({ "MÁQUINA / PEÇA / INTERESSE": "Seladora em L" }),
      });
      expect(commercial.subflow).toBe("MAQUINAS");

      const billing = resolveIndustrialRoute({
        text: "Preciso da segunda via do boleto vencido da seladora",
        aiSubflow: "MAQUINAS",
        collectedData: {},
      });
      expect(billing.subflow).toBe("2A_BOLETO");
      expect(billing.targetFunnel).toBe("Financeiro");
    });

    it("Jeferson: 'você tem esteira transportadora de lona com 1,50m?' e resposta 'Não recebi' sobre retorno comercial permanecem em MAQUINAS (nunca Pós-Venda)", () => {
      const turn1 = resolveIndustrialRoute({
        text: "Boa tarde tudo bem? você tem esteira transportadora de lona com 1,50m comprimento?",
        aiSubflow: "MAQUINAS",
        collectedData: {},
      });
      expect(turn1.subflow).toBe("MAQUINAS");
      expect(turn1.targetFunnel).toBe("Máquinas");

      const turn1Fallback = resolveIndustrialRoute({
        text: "você tem esteira transportadora de lona com 1,50m comprimento?",
        aiSubflow: null,
        collectedData: {},
      });
      expect(turn1Fallback.subflow).toBe("MAQUINAS");

      const turn2 = resolveIndustrialRoute({
        text: "Não recebi",
        aiSubflow: "MAQUINAS",
        existingSubflow: "MAQUINAS",
        collectedData: fields({
          "MÁQUINA / PEÇA / INTERESSE": "Esteira transportadora",
          "RAMO / O QUE EMBALA": "Transportar livros",
        }),
      });
      expect(turn2.subflow).toBe("MAQUINAS");
      expect(turn2.targetFunnel).toBe("Máquinas");
    });

    it("Rastreio explícito de pedido já comprado continua indo para 4A_RASTREAR (Pós-Venda)", () => {
      const tracking = resolveIndustrialRoute({
        text: "Comprei uma seladora semana passada, qual o código de rastreio do meu pedido?",
        aiSubflow: "MAQUINAS",
        collectedData: {},
      });
      expect(tracking.subflow).toBe("4A_RASTREAR");
      expect(tracking.targetFunnel).toBe("Pós-Venda");
    });

    it("Daiane Takahama / Autoplast: 'Preciso embalar peças de carro' e turnos de medidas permanecem em MAQUINAS (mesmo se o LLM errar aiSubflow: PECAS)", () => {
      expect(isReplacementPartsIntent("Preciso embalar peças de carro")).toBe(false);
      expect(isExplicitReplacementPartsIntent("Preciso embalar peças de carro")).toBe(false);

      const turn1 = resolveIndustrialRoute({
        text: "Preciso embalar peças de carro",
        aiSubflow: "MAQUINAS",
        existingSubflow: "MAQUINAS",
        collectedData: fields({
          "MÁQUINA / PEÇA / INTERESSE": "Solução da linha Personnalité para embalar peças de carro",
        }),
      });
      expect(turn1.subflow).toBe("MAQUINAS");

      // Mesmo se o LLM errar e devolver aiSubflow="PECAS" em um turno subsequente
      const guardedAgainstBadLlm = resolveIndustrialRoute({
        text: "14 x 14 cm, cada peça pesa 30g",
        aiSubflow: "PECAS",
        existingSubflow: "MAQUINAS",
        collectedData: fields({
          "MÁQUINA / PEÇA / INTERESSE":
            "Solução totalmente automatizada (linha Personnalité) para embalar peças de carro com 14x14x7 cm e 30g",
          "RAMO / O QUE EMBALA": "peças de carro",
        }),
      });
      expect(guardedAgainstBadLlm.subflow).toBe("MAQUINAS");
    });

    it("Ângelo: manutenção da SM10H ('Sim. Não sabemos se alguma peça danificada.') permanece em 3_AT (Assistência Técnica), nunca vira PECAS", () => {
      const turnSupport = resolveIndustrialRoute({
        text: "Sim. Não sabemos se alguma peça danificada. Tem um vídeo explicando essa regulagem?",
        aiSubflow: "PECAS",
        existingSubflow: "3_AT",
        collectedData: fields({
          "MÁQUINA / PEÇA / INTERESSE": "Manutenção da máquina SM10H - fita arrebenta na solda",
        }),
      });
      expect(turnSupport.subflow).toBe("3_AT");
      expect(turnSupport.targetFunnel).toBe("Assistência Técnica");
    });

    it("Pedido real de peças de reposição (correias, resistência, fita teflon) continua indo para PECAS", () => {
      const parts = resolveIndustrialRoute({
        text: "Preciso de cinto de teflon e correias de transmissão para seladora SF-150LW",
        aiSubflow: "PECAS",
        collectedData: {},
      });
      expect(parts.subflow).toBe("PECAS");
      expect(parts.targetFunnel).toBe("Peças");
    });
  });

  describe("2. Decisor de Catálogo — Proteção Manual/Semi, Múltiplos Modelos da Mesma Linha e Alerta Capital Social", () => {
    const buildTestCatalog = () =>
      industrialSettingsSchema.parse({
        ...emptyIndustrialSettings(),
        catalog: [
          {
            id: "catalog-532",
            name: "Seladora em L Manual",
            code: "PAMQSLAU078",
            line: "PERSONNALITE", // simulando item etiquetado errado no catálogo atual
            production: "8-12 pcs/min",
          },
          {
            id: "catalog-593",
            name: "FQS450 - SELADORA L SEMI AUTOMATICA COM TUNEL DE EMC. ACOPLADO",
            code: "PAMQSLSA103",
            line: "PERSONNALITE", // simulando item etiquetado errado no catálogo atual
            production: "",
          },
          {
            id: "semi-fech-1",
            name: "Fechadora de Caixas Semiautomática FXJ-5050",
            code: "FXJ5050",
            line: "SEMI-INDUSTRIAL",
            production: "20 caixas/min",
          },
          {
            id: "semi-fech-2",
            name: "Fechadora de Caixas Semiautomática FXJ-6050",
            code: "FXJ6050",
            line: "SEMI-INDUSTRIAL",
            production: "20 caixas/min",
          },
          {
            id: "pers-sel-auto",
            name: "Seladora em L Automática BSF-5640LG",
            code: "BSF5640LG",
            line: "PERSONNALITE",
            production: "25 pcs/min",
          },
        ],
      });

    it("Rebaixa defensivamente 'Seladora em L Manual' (Eduardo) e 'FQS450 SEMI AUTOMATICA' (Wagner/Sabrina) de PERSONNALITE para SEMI-INDUSTRIAL", async () => {
      const cfg = buildTestCatalog();
      const manualItem = cfg.catalog.find((m) => m.id === "catalog-532")!;
      const semiItem = cfg.catalog.find((m) => m.id === "catalog-593")!;
      const realPers = cfg.catalog.find((m) => m.id === "pers-sel-auto")!;

      expect(resolveEffectiveCatalogLine(manualItem)).toEqual({
        line: "SEMI-INDUSTRIAL",
        corrected: true,
      });
      expect(resolveEffectiveCatalogLine(semiItem)).toEqual({
        line: "SEMI-INDUSTRIAL",
        corrected: true,
      });
      expect(resolveEffectiveCatalogLine(realPers)).toEqual({
        line: "PERSONNALITE",
        corrected: false,
      });

      const decisionEduardo = await decideIndustrialMachine({
        settings: cfg,
        revision: 1,
        input: {
          interest: "Seladora em L",
          application: "pizzas de 35cm",
          production: "80 a 100 unidades por hora",
          customerContext: "Seladora em L para pizzas de 35cm",
        },
        suggest: async () => ({
          machineId: "catalog-532",
          confidence: 0.96,
          reason: "Seladora em L para baixo volume",
        }),
      });
      expect(decisionEduardo.status).toBe("confirmed");
      expect(decisionEduardo.line).toBe("SEMI-INDUSTRIAL");
      expect(decisionEduardo.lineCorrectedFromCatalog).toBe(true);

      const routeEduardo = applyMachineDecision(
        resolveIndustrialRoute({ aiSubflow: "MAQUINAS", collectedData: {} }),
        decisionEduardo,
      );
      expect(routeEduardo.subflow).toBe("MAQUINAS");
      expect(routeEduardo.targetFunnel).toBe("Máquinas");
    });

    it("Múltiplos modelos compatíveis da MESMA linha confirmam a linha (pré-preenche Máquinas) sem jogar para Revisão Humana", async () => {
      const cfg = buildTestCatalog();
      const decision = await decideIndustrialMachine({
        settings: cfg,
        revision: 1,
        input: {
          interest: "Fechadora de caixas",
          application: "Ferragens em caixas de papelão",
          production: "800 caixas por noite",
          customerContext: "Preciso de fechadora de caixas de papelão",
        },
        suggest: async () => ({
          machineId: null,
          candidateMachineIds: ["semi-fech-1", "semi-fech-2"],
          confidence: 0.9,
          reason: "Duas fechadoras semiautomáticas atendem dependendo da dimensão da caixa",
        }),
      });

      expect(decision.status).toBe("confirmed");
      expect(decision.method).toBe("vertex_catalog_line");
      expect(decision.line).toBe("SEMI-INDUSTRIAL");
      expect(decision.reason).toBe("catalog_line_confirmed_model_tbd");
      expect(decision.candidateMachineIds).toEqual(["semi-fech-1", "semi-fech-2"]);

      const route = applyMachineDecision(
        resolveIndustrialRoute({ aiSubflow: "MAQUINAS", collectedData: {} }),
        decision,
      );
      expect(route.subflow).toBe("MAQUINAS");
      expect(route.needsReview).toBe(false);
    });

    it("Múltiplos modelos compatíveis de LINHAS CONFLITANTES (Semi + Personnalité) mantêm Revisão Humana", async () => {
      const cfg = buildTestCatalog();
      const decision = await decideIndustrialMachine({
        settings: cfg,
        revision: 1,
        input: {
          interest: "Seladora em L",
          application: "Produtos diversos",
          production: "600 unidades/hora",
          customerContext: "Seladora em L",
        },
        suggest: async () => ({
          machineId: null,
          candidateMachineIds: ["catalog-593", "pers-sel-auto"],
          confidence: 0.9,
          reason: "Pode ser semi-automática ou automática contínua",
        }),
      });

      expect(decision.status).toBe("review");
      expect(decision.reason).toBe("ambiguous_line_conflict");
      expect(decision.line).toBeNull();
    });

    it("Capital Social >= R$ 350.000 mantém destino Máquinas (confirmed) e ativa alerta informativo para o card SDR", async () => {
      const cfg = buildTestCatalog();
      const decision = await decideIndustrialMachine({
        settings: cfg,
        revision: 1,
        input: {
          interest: "Fechadora de caixas FXJ5050",
          application: "Caixas de papelão",
          production: "200 caixas/dia",
          customerContext: "Quero a FXJ5050",
          capitalSocial: 500_000,
        },
        suggest: async () => {
          throw new Error("Match exato não chama IA");
        },
      });

      expect(decision.status).toBe("confirmed");
      expect(decision.line).toBe("SEMI-INDUSTRIAL");
      expect(decision.highCapitalSocialAlert).toBe(true);
      expect(decision.capitalSocial).toBe(500_000);
    });
  });

  describe("3. Projeção de Monitoramento & Registro Imutável de Acurácia", () => {
    it("Projeta alertas de Capital Social, modelo pendente e triageAccuracy no industrial-monitor", () => {
      const cycle = "2026-11-25T16:00:00.000Z";
      const awaiting = projectIndustrialMonitoring(
        {
          startedAt: cycle,
          outcome: "in_progress",
          metadata: {
            handoffStatus: "awaiting_approval",
            subflow: "MAQUINAS",
            targetFunnel: "Máquinas",
            pendingApproval: {
              cycle,
              preparedAt: cycle,
              subflow: "MAQUINAS",
              targetFunnel: "Máquinas",
              suggestedSectorId: "sec-1793186165115",
              suggestedSectorName: "Máquinas",
              suggestedOperatorId: "op-1",
              suggestedOperatorName: "Victor Goes",
              highCapitalSocialAlert: true,
              capitalSocial: 450000,
              modelSelectionPending: true,
              suggestedBySectorFallback: false,
            },
          },
        },
        { operatorId: null, queueState: "automacao" },
      );

      expect(awaiting.state).toBe("awaiting_approval");
      expect(awaiting.pendingApproval?.highCapitalSocialAlert).toBe(true);
      expect(awaiting.pendingApproval?.capitalSocial).toBe(450000);
      expect(awaiting.pendingApproval?.modelSelectionPending).toBe(true);

      const approved = projectIndustrialMonitoring(
        {
          startedAt: cycle,
          outcome: "transferred",
          metadata: {
            subflow: "PERSONNALITE",
            targetFunnel: "Máquinas",
            triageAccuracy: {
              version: 1,
              originalSuggestion: { targetFunnel: "Personnalité", operatorName: "Denis Menezes" },
              approvedOutcome: { targetFunnel: "Máquinas", operatorName: "Evelyn Silveira" },
              funnelMatched: false,
              sectorMatched: false,
              operatorMatched: false,
            },
          },
        },
        { operatorId: "op-evelyn", queueState: "meus" },
      );

      expect((approved.triageAccuracy as any)?.funnelMatched).toBe(false);
      expect((approved.triageAccuracy as any)?.originalSuggestion?.targetFunnel).toBe("Personnalité");
    });
  });
});
