import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE,
  industrialClientMessages,
  isRedundantIndustrialClosingMessage,
} from "../src/lib/triage/industrial-handoff";
import {
  hasClientFactualQuestionInDecline,
  isAutomatedBotOrUraMessage,
  isClientDecliningTriage,
  isPostCloseCourtesyOnlyMessage,
  resolveIndustrialRoute,
} from "../src/lib/triage/industrial-policy";
import {
  buildIndustrialPostCloseReopenPatch,
  evaluateIndustrialSdrOwnershipGuard,
} from "../src/lib/triage/industrial-ownership-guard";

describe("Auditoria Fagner 23/11 — Item 2 (Despedida dupla & bolha fixa) + Item 3 (Desistência, Bot NPS & Reabertura pós-encerramento)", () => {
  describe("Item 2 — Eliminação de despedida dupla e bolha fixa em encerramentos sem transferência", () => {
    it("remove balões redundantes reais de 23/11 (Manoel, Maria Eduarda, Luiz Lopes, José Carlos, Marcelo Macool, Anatiele, Gerson, Lucas Goettems, Kassia) deixando apenas 1 bolha oficial", () => {
      const route = resolveIndustrialRoute({ text: "seladora industrial", collectedData: {} });
      const realDoubleFarewells: string[][] = [
        [
          "Um especialista de nossa equipe comercial já irá verificar as melhores condições para você, incluindo os detalhes de pagamento.",
        ],
        [
          "Com estes dados, nossa equipe de especialistas já consegue preparar uma proposta comercial completa para você.",
        ],
        [
          "Com base nas dimensões de 900mm que você precisa, nossa equipe técnica avaliará a melhor configuração de seladora.",
        ],
        [
          "Já tenho as informações necessárias. Nosso especialista comercial analisará a viabilidade técnica para sua demanda.",
        ],
        [
          "Não ter uma estimativa de produção agora não é um problema, é comum em projetos novos. As informações que você passou sobre a necessidade de empacotamento e datação completa já são o ponto de partida.",
        ],
        [
          "Entendido, Anatiele.",
          "Não se preocupe. Mesmo sem a estimativa de produção, nosso especialista pode apresentar as soluções técnicas para as duas faixas de dosagem.",
          "Ele poderá detalhar as características de cada equipamento e alinhar a melhor configuração para o projeto da Secretaria.",
        ],
        [
          "Entendido, Gerson. Vou solicitar a localização do seu pedido para a nossa equipe.",
        ],
        [
          "Sua solicitação sobre o status da compra da seladora será verificada pela nossa equipe de Pós-Venda. Por favor, aguarde.",
        ],
        ["Obrigado, Kassia."],
        ["Recebido, Ricardo.", "Certo, um momento por favor."],
      ];

      for (const messages of realDoubleFarewells) {
        const result = industrialClientMessages({
          result: { status: "awaiting_approval", operator: null, deal: null },
          route,
          data: {},
          messages,
        });
        expect(result).toEqual([INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE]);
      }
    });

    it("preserva respostas informativas reais (ex.: vídeo no Ricardo Couto e cidade Bauru) removendo apenas o cumprimento redundante", () => {
      const route = resolveIndustrialRoute({ text: "seladora contínua", collectedData: {} });
      const ricardo = industrialClientMessages({
        result: { status: "awaiting_approval", operator: null, deal: null },
        route,
        data: {},
        messages: [
          "Recebido, Ricardo.",
          "Eu, como assistente virtual, não consigo enviar vídeos por aqui, mas nossos especialistas têm acesso a esses materiais.",
        ],
      });
      expect(ricardo).toEqual([
        "Eu, como assistente virtual, não consigo enviar vídeos por aqui, mas nossos especialistas têm acesso a esses materiais.",
        INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE,
      ]);

      expect(isRedundantIndustrialClosingMessage("Nossa matriz fica em Bauru/SP com atendimento para todo o Brasil.")).toBe(false);
    });

    it("em status 'resolved' (sem transferência), NUNCA vaza a bolha fixa nem promessas de encaminhamento", () => {
      const route = resolveIndustrialRoute({ text: "Segue meu currículo", collectedData: {} });
      const result = industrialClientMessages({
        result: { status: "resolved", operator: null, deal: null },
        route,
        data: {},
        messages: [
          "Certo. Agradecemos o seu contato. Tenha um ótimo dia!",
          INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE,
          "Nossa equipe entrará em contato em breve.",
        ],
      });
      expect(result).toEqual(["Certo. Agradecemos o seu contato. Tenha um ótimo dia!"]);
    });
  });

  describe("Item 3A — Desistência, 'já comprei' (Abimael, Jose Edio, Fabrício, Jeovanei, Hesttéfani) e Bot NPS (Flávia)", () => {
    it("detecta todos os casos reais de desistência / compra na concorrência / já atendido sem falso positivo em novas demandas", () => {
      // Casos reais de 23/11 que DEVEM encerrar limpo (resolved)
      expect(isClientDecliningTriage("já fui atendido\ne já comprei\nobrigado")).toBe(true);
      expect(isClientDecliningTriage("Ja comprei na shopee,não consegui negociar com vocês.")).toBe(true);
      expect(
        isClientDecliningTriage("Obrigado mas já comprei eu não sabia desse problema do sistema seus"),
      ).toBe(true);
      expect(
        isClientDecliningTriage("Agora não mais\nJá fiz a compra com outra empresa\nVcs são de onde"),
      ).toBe(true);
      expect(
        hasClientFactualQuestionInDecline("Agora não mais\nJá fiz a compra com outra empresa\nVcs são de onde"),
      ).toBe(true);
      expect(isClientDecliningTriage("No momento não")).toBe(true);
      expect(isClientDecliningTriage("no momento não possuo nenhuma solicitação em andamento")).toBe(true);
      expect(isClientDecliningTriage("deixa quieto")).toBe(true);

      // Casos reais que NÃO podem ser tratados como desistência (demandas ativas!)
      expect(
        isClientDecliningTriage("Oi Fagner, manda a foto pra mim dessas máquinas, mas a seladora eu já comprei"),
      ).toBe(false);
      expect(
        isClientDecliningTriage("Do equipamento que comprei com vocês preciso da borracha de vedação do pistão"),
      ).toBe(false);
      expect(
        isClientDecliningTriage("Não, obrigada. Aproveitando, ainda não recebi as seladoras, consegue verificar?"),
      ).toBe(false);
      expect(isClientDecliningTriage("Vcs vendem oq tanto no segmento de padaria??")).toBe(false);
    });

    it("não classifica compra na Shopee/concorrente como Pós-Venda da Tecfag", () => {
      const shopeeRoute = resolveIndustrialRoute({
        text: "Ja comprei na shopee,não consegui negociar com vocês.",
        collectedData: {},
      });
      expect(shopeeRoute.targetFunnel).not.toBe("Pós-Venda");

      const reciRoute = resolveIndustrialRoute({
        text: "aproveitando, ainda não recebi as seladoras, consegue verificar?",
        collectedData: {},
      });
      expect(reciRoute.subflow).toBe("4A_RASTREAR");
      expect(reciRoute.targetFunnel).toBe("Pós-Venda");
    });

    it("detecta bots de pesquisa NPS / URA de encerramento automático (caso Flávia DSM)", () => {
      expect(
        isAutomatedBotOrUraMessage({
          phone: "5511999998888",
          text: "Como você avalia o atendimento recebido?\n(Sendo, 1 = Péssimo a 5 = Excelente)\n5– Excelente\n1– Péssimo",
        }),
      ).toBe(true);
      expect(
        isAutomatedBotOrUraMessage({
          phone: "5511999998888",
          text: "Desculpe, não entendi sua resposta, digite um número entre 1 e 5",
        }),
      ).toBe(true);
      expect(
        isAutomatedBotOrUraMessage({
          phone: "5511999998888",
          text: "Foi um prazer atender você! Vou encerrar seu atendimento por aqui, tudo certo? Se puder, deixe sua avaliação.",
        }),
      ).toBe(true);
      expect(
        isAutomatedBotOrUraMessage({
          phone: "5511999998888",
          text: "Boa tarde, queria saber quanto custa a seladora SF150",
        }),
      ).toBe(false);
    });
  });

  describe("Item 3B — Reabertura automática pós-encerramento sem transferência (caso FELIPE/Joana Reci e Jeovanei)", () => {
    it("reabre fluxo 'Encerrado (Sem interesse)' em automação quando cliente envia nova demanda real", () => {
      const reciDecision = evaluateIndustrialSdrOwnershipGuard({
        queueState: "automacao",
        operatorId: null,
        flowOutcome: "completed",
        flowCurrentStep: "Encerrado (Sem interesse)",
        flowMetadata: { handoffStatus: "resolved" },
        incomingText: "aproveitando, ainda não recebi as seladoras, consegue verificar?",
      });
      expect(reciDecision.blocked).toBe(false);
      expect(reciDecision.reopenCompletedFlow).toBe(true);

      const jeovaneiDecision = evaluateIndustrialSdrOwnershipGuard({
        queueState: "automacao",
        operatorId: null,
        flowOutcome: "completed",
        flowCurrentStep: "Encerrado (Sem interesse)",
        flowMetadata: { handoffStatus: "resolved" },
        incomingText: "Vcs vendem oq tanto no segmento de padaria??",
      });
      expect(jeovaneiDecision.blocked).toBe(false);
      expect(jeovaneiDecision.reopenCompletedFlow).toBe(true);
    });

    it("NÃO reabre após encerramento quando cliente manda apenas cortesia (Stéffany, Julia) ou quando houve ação humana", () => {
      const courtesies = ["Ok", "Obrigada!", "Ah ta joia", "Obrigada pelo retorno, tenha um bom dia!", "👍"];
      for (const text of courtesies) {
        expect(isPostCloseCourtesyOnlyMessage(text)).toBe(true);
        const decision = evaluateIndustrialSdrOwnershipGuard({
          queueState: "automacao",
          operatorId: null,
          flowOutcome: "completed",
          flowCurrentStep: "Encerrado (Sem interesse)",
          flowMetadata: { handoffStatus: "resolved" },
          incomingText: text,
        });
        expect(decision.blocked).toBe(true);
        expect(decision.reason).toBe("flow_outcome:completed");
      }

      // Se SDR humano dispensou (dismissedBy), NÃO reabre automaticamente
      const dismissedByHuman = evaluateIndustrialSdrOwnershipGuard({
        queueState: "automacao",
        operatorId: null,
        flowOutcome: "completed",
        flowCurrentStep: "Concluído (Sem Transferência)",
        flowMetadata: { handoffStatus: "resolved", dismissedBy: { operatorId: "op-1", operatorName: "Isabella" } },
        incomingText: "aproveitando, ainda não recebi as seladoras",
      });
      expect(dismissedByHuman.blocked).toBe(true);

      // Se já foi movido para finalizados ou tem operador, continua bloqueado
      const finalized = evaluateIndustrialSdrOwnershipGuard({
        queueState: "finalizados",
        operatorId: null,
        flowOutcome: "completed",
        flowCurrentStep: "Encerrado (Sem interesse)",
        flowMetadata: { handoffStatus: "resolved" },
        incomingText: "quero ver uma seladora",
      });
      expect(finalized.blocked).toBe(true);
    });

    it("buildIndustrialPostCloseReopenPatch preserva identidade, limpa intenção anterior, arquiva ciclo e mantém greetingDone=true", () => {
      const patch = buildIndustrialPostCloseReopenPatch({
        collectedData: {
          "NOME COMPLETO": { value: "Joana", status: "filled" },
          EMPRESA: { value: "RECI EMBALAGENS", status: "filled" },
          "MÁQUINA / PEÇA / INTERESSE": { value: "DGYF500A", status: "filled" },
          "SETOR / FUNIL DE DESTINO": { value: "Máquinas", status: "filled" },
        },
        metadata: { targetFunnel: "Máquinas", subflow: "MAQUINAS", handoffStatus: "resolved" },
        currentStep: "Encerrado (Sem interesse)",
        startedAt: new Date("2026-11-23T17:32:00.000Z"),
        completedAt: new Date("2026-11-23T17:39:51.000Z"),
      });

      expect(patch.collectedData["NOME COMPLETO"]?.value).toBe("Joana");
      expect(patch.collectedData.EMPRESA?.value).toBe("RECI EMBALAGENS");
      expect(patch.collectedData["MÁQUINA / PEÇA / INTERESSE"]).toBeUndefined();
      expect(patch.collectedData["SETOR / FUNIL DE DESTINO"]).toBeUndefined();
      expect(patch.metadata.handoffStatus).toBe("collecting");
      expect(patch.metadata.targetFunnel).toBeNull();
      expect(patch.metadata.subflow).toBeNull();
      expect(patch.metadata.greetingDone).toBe(true);
      expect(Array.isArray(patch.metadata.previousTriages)).toBe(true);
      expect((patch.metadata.previousTriages as any[]).length).toBe(1);
    });

    it("inbound.ts e sdr-engine.ts propagam incomingText/flowCurrentStep para permitir reabertura limpa", () => {
      const inboundSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/whatsapp/inbound.ts"),
        "utf8",
      );
      const sdrEngineSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
        "utf8",
      );
      expect(inboundSrc).toContain("reopenCompletedFlow");
      expect(inboundSrc).toContain("flowCurrentStep:");
      expect(sdrEngineSrc).toContain("buildIndustrialPostCloseReopenPatch");
      expect(sdrEngineSrc).toContain("hasClientFactualQuestionInDecline");
    });
  });
});
