import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseIndustrialAiResult } from "../src/lib/triage/industrial-ai-result";
import {
  assessIndustrialReadiness,
  canFinishIndustrialTriage,
  resolveDirectOperatorRequest,
  resolveIndustrialRoute,
  type SystemOperatorCandidate,
} from "../src/lib/triage/industrial-policy";
import {
  industrialClientMessages,
  industrialHandoffMessage,
} from "../src/lib/triage/industrial-handoff";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import { getAiPersona } from "../src/lib/ai-persona";

const OPERATORS: SystemOperatorCandidate[] = [
  {
    id: "op-victor",
    name: "Victor Goes",
    sectorName: "Comercial",
    status: "online",
    isOnLeave: false,
    funnels: ["Máquinas"],
  },
  {
    id: "op-vini",
    name: "Vinícius Pereira",
    sectorName: "Personnalité",
    status: "online",
    isOnLeave: false,
    funnels: ["Personnalité"],
  },
  {
    id: "op-melissa-com",
    name: "Melissa Gomes",
    sectorName: "Comercial",
    status: "online",
    isOnLeave: false,
    funnels: ["Máquinas"],
  },
  {
    id: "op-melissa-pv",
    name: "Melissa Bueno",
    sectorName: "Pós-Venda",
    status: "online",
    isOnLeave: false,
    funnels: ["Pós-Venda"],
  },
  {
    id: "op-keicy-ausente",
    name: "Keicy Cardoso",
    sectorName: "Comercial",
    status: "online",
    isOnLeave: true,
    funnels: ["Máquinas"],
  },
  {
    id: "op-admin-financeiro",
    name: "Tarcisio Diretoria",
    sectorName: "Diretoria",
    status: "online",
    isOnLeave: false,
    funnels: [],
  },
];

describe("Transferência direta nominal inteligente do Fagner", () => {
  it("aceita matching inteligente via Gemini para apelidos e variações de grafia (Vitor -> Victor Goes, Vini -> Vinícius)", () => {
    const parsedVitor = parseIndustrialAiResult({
      messagesToSend: ["Claro! Já estou te transferindo para o Victor."],
      isCompleted: true,
      directOperatorRequest: {
        intent: "direct_transfer",
        citedName: "Vitor",
        matchedOperatorId: "op-victor",
        matchedOperatorName: "Victor Goes",
      },
    });
    expect(parsedVitor?.directOperatorRequest?.intent).toBe("direct_transfer");
    const resolvedVitor = resolveDirectOperatorRequest(
      parsedVitor?.directOperatorRequest,
      OPERATORS,
    );
    expect(resolvedVitor.status).toBe("matched");
    expect(resolvedVitor.operator?.id).toBe("op-victor");

    // Também funciona por fallback aproximado mesmo sem matchedOperatorId
    const fallbackVitor = resolveDirectOperatorRequest(
      {
        intent: "direct_transfer",
        citedName: "Vitor",
        matchedOperatorId: null,
        matchedOperatorName: null,
      },
      OPERATORS,
    );
    expect(fallbackVitor.status).toBe("matched");
    expect(fallbackVitor.operator?.id).toBe("op-victor");

    const fallbackVini = resolveDirectOperatorRequest(
      {
        intent: "direct_transfer",
        citedName: "Vini",
        matchedOperatorId: null,
        matchedOperatorName: null,
      },
      OPERATORS,
    );
    expect(fallbackVini.status).toBe("matched");
    expect(fallbackVini.operator?.id).toBe("op-vini");
  });

  it("permite transferir para qualquer usuário do tenant mesmo fora dos funis de rodízio", () => {
    const resolved = resolveDirectOperatorRequest(
      {
        intent: "direct_transfer",
        citedName: "Tarcisio",
        matchedOperatorId: "op-admin-financeiro",
        matchedOperatorName: "Tarcisio Diretoria",
      },
      OPERATORS,
    );
    expect(resolved.status).toBe("matched");
    expect(resolved.operator?.id).toBe("op-admin-financeiro");
    expect(resolved.operator?.primaryFunnel).toBeNull();

    const route = resolveIndustrialRoute({
      text: "Pode me transferir para o Tarcisio por favor",
      collectedData: {},
      directOperator: resolved,
    });
    expect(route.reason).toBe("direct_operator_requested");
    expect(route.targetOperator?.id).toBe("op-admin-financeiro");
    expect(assessIndustrialReadiness(route, {}).ready).toBe(true);
    expect(
      canFinishIndustrialTriage({
        route,
        data: {},
        isCompleted: true,
        hasPendingQuestion: false,
      }),
    ).toBe(true);
  });

  it("rejeita ID inventado ou de outro tenant (segurança multi-tenant)", () => {
    const spoofed = resolveDirectOperatorRequest(
      {
        intent: "direct_transfer",
        citedName: "Pessoa Outro Tenant",
        matchedOperatorId: "op-valem-externo",
        matchedOperatorName: "Pessoa Outro Tenant",
      },
      OPERATORS,
    );
    expect(spoofed.status).toBe("not_found");
    expect(spoofed.operator).toBeNull();
  });

  it("oferece transferência quando o cliente deixa no ar ('estava falando com o Victor') sem transferir antes da confirmação", () => {
    const parsedOffer = parseIndustrialAiResult({
      messagesToSend: [
        "Gostaria que eu te transferisse para o Victor para continuar de onde pararam?",
      ],
      isCompleted: false,
      directOperatorRequest: {
        intent: "offer_transfer",
        citedName: "Victor",
        matchedOperatorId: "op-victor",
        matchedOperatorName: "Victor Goes",
      },
    });
    expect(parsedOffer?.directOperatorRequest?.intent).toBe("offer_transfer");

    const resolved = resolveDirectOperatorRequest(
      parsedOffer?.directOperatorRequest,
      OPERATORS,
    );
    expect(resolved.status).toBe("offer_transfer");
    expect(resolved.operator?.id).toBe("op-victor");

    // Não deve disparar human_requested nem direct_operator_requested ainda
    const route = resolveIndustrialRoute({
      text: "Boa tarde Fagner, estava falando com o Victor",
      collectedData: {},
      directOperator: resolved,
    });
    expect(route.reason).not.toBe("direct_operator_requested");
    expect(route.reason).not.toBe("human_requested");
  });

  it("quando operador está ausente, pergunta primeiro se quer falar com outro e só transfere com confirm_absent_transfer", () => {
    const absentAttempt = resolveDirectOperatorRequest(
      {
        intent: "direct_transfer",
        citedName: "Keicy",
        matchedOperatorId: "op-keicy-ausente",
        matchedOperatorName: "Keicy Cardoso",
      },
      OPERATORS,
    );
    expect(absentAttempt.status).toBe("operator_absent");
    expect(absentAttempt.operator?.id).toBe("op-keicy-ausente");
    expect(absentAttempt.operator?.isAbsent).toBe(true);

    // Oferta para operador ausente também avisa ausência primeiro
    const absentOffer = resolveDirectOperatorRequest(
      {
        intent: "offer_transfer",
        citedName: "Keicy",
        matchedOperatorId: "op-keicy-ausente",
        matchedOperatorName: "Keicy Cardoso",
      },
      OPERATORS,
    );
    expect(absentOffer.status).toBe("operator_absent");

    // Se o cliente responde "prefiro aguardar a Keicy mesmo", confirm_absent_transfer efetiva
    const parsedConfirm = parseIndustrialAiResult({
      messagesToSend: ["Combinado! Já vou deixar encaminhado para a Keicy."],
      isCompleted: true,
      directOperatorRequest: {
        intent: "confirm_absent_transfer",
        citedName: "Keicy",
        matchedOperatorId: "op-keicy-ausente",
        matchedOperatorName: "Keicy Cardoso",
      },
    });
    const confirmed = resolveDirectOperatorRequest(
      parsedConfirm?.directOperatorRequest,
      OPERATORS,
    );
    expect(confirmed.status).toBe("matched");
    expect(confirmed.operator?.isAbsent).toBe(true);
  });

  it("respeita homônimos sem sobrenome e permite desambiguação semântica pelo Gemini no turno seguinte", () => {
    const amb = resolveDirectOperatorRequest(
      {
        intent: "ambiguous_homonym",
        citedName: "Melissa",
        matchedOperatorId: null,
        matchedOperatorName: null,
      },
      OPERATORS,
    );
    expect(amb.status).toBe("ambiguous_homonym");
    expect(amb.homonyms?.length).toBe(2);

    // Turno 2: cliente diz "a do pós-venda" -> Gemini envia matchedOperatorId de Melissa Bueno
    const disambiguated = resolveDirectOperatorRequest(
      {
        intent: "direct_transfer",
        citedName: "Melissa",
        matchedOperatorId: "op-melissa-pv",
        matchedOperatorName: "Melissa Bueno",
      },
      OPERATORS,
    );
    expect(disambiguated.status).toBe("matched");
    expect(disambiguated.operator?.id).toBe("op-melissa-pv");
  });

  it("para a triagem em revisão humana quando não consegue localizar o usuário apontado (não força barra)", () => {
    const notFound = resolveDirectOperatorRequest(
      {
        intent: "not_found",
        citedName: "Claudio",
        matchedOperatorId: null,
        matchedOperatorName: null,
      },
      OPERATORS,
    );
    expect(notFound.status).toBe("not_found");

    const route = resolveIndustrialRoute({
      text: "Pode me transferir para o Claudio?",
      collectedData: {},
      directOperator: notFound,
    });
    expect(route.reason).toBe("direct_operator_not_found");
    expect(route.needsReview).toBe(true);
    expect(assessIndustrialReadiness(route, {}).ready).toBe(true);
    expect(assessIndustrialReadiness(route, {}).action).toBe("review");
    expect(
      canFinishIndustrialTriage({
        route,
        data: {},
        isCompleted: false,
        hasPendingQuestion: false,
      }),
    ).toBe(true);
  });

  it("gera confirmação natural para transferência direta nominal disponível", () => {
    const msg = industrialHandoffMessage("transferred", "Victor Goes", {
      isDirectOperatorTransfer: true,
    });
    expect(msg).toContain("Victor Goes");
    expect(msg?.toLowerCase()).toContain("transferindo");

    const route = resolveIndustrialRoute({
      text: "Pode me transferir para o Victor",
      collectedData: {},
      directOperator: resolveDirectOperatorRequest(
        {
          intent: "direct_transfer",
          citedName: "Victor",
          matchedOperatorId: "op-victor",
          matchedOperatorName: "Victor Goes",
        },
        OPERATORS,
      ),
    });
    const clientMsgs = industrialClientMessages({
      result: {
        status: "transferred",
        operator: { id: "op-victor", name: "Victor Goes", isAbsent: false },
        deal: null,
      },
      route,
      data: {},
      messages: ["Claro! Já estou te transferindo para o Victor."],
    });
    expect(clientMsgs.length).toBe(1);
    expect(clientMsgs[0]).toContain("Victor Goes");
  });

  it("injeta diretrizes completas de transferência direta, oferta, ausente e parada segura no prompt do Fagner", () => {
    const prompt = buildTecfagFagnerPrompt({
      aiPersona: getAiPersona("tecfag"),
      knowledgeContext: "",
      conversationHistoryText: "",
      batchSummary: "boa tarde fagner, estava falando com o victor",
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
      systemOperators: OPERATORS,
    });
    expect(prompt).toContain("Victor Goes");
    expect(prompt).toContain("Setor: Comercial");
    expect(prompt).toContain("offer_transfer");
    expect(prompt).toContain("confirm_absent_transfer");
    expect(prompt).toContain("Status: Ausente no momento");
    expect(prompt).toContain("PARAR SEM FORÇAR BARRA");
  });

  it("garante execução direta imediata com pontuação no rodízio e fallback para parada segura em sdr-engine + handoff-store (preservando valem)", () => {
    const sdrEngineSrc = readFileSync(
      path.join(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
      "utf8",
    );
    const handoffStoreSrc = readFileSync(
      path.join(process.cwd(), "src/lib/triage/industrial-handoff-store.ts"),
      "utf8",
    );
    expect(sdrEngineSrc).toContain("handledByDirectOperatorTransfer");
    expect(sdrEngineSrc).toContain('industrialRoute.reason === "direct_operator_requested"');
    expect(sdrEngineSrc).toContain("directStore.prepare(directKey");
    expect(sdrEngineSrc).toContain("directStore.execute(directKey");
    expect(sdrEngineSrc).toContain('resolvedDirectOperator.status === "operator_absent"');
    expect(sdrEngineSrc).toContain('resolvedDirectOperator.status === "offer_transfer"');
    expect(handoffStoreSrc).toContain("leadsReceivedCount: (op.leadsReceivedCount || 0) + 1");
    expect(handoffStoreSrc).toContain("isOperatorOnLeaveToday(flowOp, todayBrt)");
    expect(handoffStoreSrc).toContain("transferiu o atendimento diretamente para");
  });
});
