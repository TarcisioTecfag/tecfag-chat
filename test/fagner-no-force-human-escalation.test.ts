import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  botAlreadyAskedMissingField,
  isClientRefusingAdditionalQualification,
  isClientUnableOrRefusingProduction,
  isVagueIndustrialProductionValue,
  resolveIndustrialRoute,
} from "../src/lib/triage/industrial-policy";
import {
  claimsIndustrialHandoffEffect,
  evaluateIndustrialClientMessages,
  isPrematureIndustrialHandoffBubble,
} from "../src/lib/triage/industrial-handoff";
import { parseIndustrialAiResult } from "../src/lib/triage/industrial-ai-result";
import { isClientReschedulingTurn } from "../src/lib/triage/industrial-silence-policy";
import { sanitizeIndustrialFollowUpMessage } from "../src/lib/triage/industrial-followup-ai";
import { parseMediaTagFromContent } from "../src/lib/valentina/media-hydration";
import { extractValidCnpjFromDocumentText } from "../src/lib/valentina/cnpj-service";

describe("Fim do travamento e falso encaminhamento na triagem industrial do Fagner", () => {
  it("1. Caso Giovane / BIOSYN (SP600L): aceita desconhecimento de produção e bloqueia afirmação de registro sem aprovação", () => {
    expect(isClientUnableOrRefusingProduction("Ainda não tenho essa informação")).toBe(true);
    expect(isClientUnableOrRefusingProduction("não sei informar a média")).toBe(true);
    expect(isClientUnableOrRefusingProduction("300 pacotes por hora")).toBe(false);

    expect(isVagueIndustrialProductionValue("A definir com especialista")).toBe(false);
    expect(isVagueIndustrialProductionValue("Ainda não tenho essa informação")).toBe(false);
    expect(isVagueIndustrialProductionValue("muito trigo")).toBe(true);

    const botFalseClaim = [
      "Obrigado, Giovane. Já registrei todos os detalhes da sua solicitação para o equipamento SP600L.",
    ];
    expect(claimsIndustrialHandoffEffect(botFalseClaim)).toBe(true);

    const route = resolveIndustrialRoute({
      text: "Gostaria de um orçamento do equipamento SP600L",
      collectedData: {
        "NOME COMPLETO": { value: "Giovane", status: "filled" },
        EMPRESA: { value: "BIOSYN TECNOLOGIA E NUTRICAO ANIMAL LTDA", status: "filled" },
        "CNPJ OU CPF": { value: "07.683.465/0001-33", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Equipamento SP600L", status: "filled" },
        "RAMO / O QUE EMBALA": { value: "Selar sacos de 25kg", status: "filled" },
      },
    });
    const evaluated = evaluateIndustrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data: {
        "NOME COMPLETO": { value: "Giovane", status: "filled" },
        EMPRESA: { value: "BIOSYN TECNOLOGIA E NUTRICAO ANIMAL LTDA", status: "filled" },
        "CNPJ OU CPF": { value: "07.683.465/0001-33", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Equipamento SP600L", status: "filled" },
        "RAMO / O QUE EMBALA": { value: "Selar sacos de 25kg", status: "filled" },
      },
      messages: botFalseClaim,
    });
    expect(evaluated.needsGeminiRewrite).toBe(true);
    expect(evaluated.rewriteMode).toBe("collecting_missing_fields");
    expect(evaluated.missingFields).toEqual(["production"]);

    const followUpGuard = sanitizeIndustrialFollowUpMessage(
      "Giovane, sua solicitação para o equipamento SP600L foi registrada. Posso te ajudar com mais alguma informação ou dúvida sobre ele?",
      { recentMessages: [], stage: 1 },
    );
    expect(followUpGuard.valid).toBe(false);
    expect(followUpGuard.rejectReason).toBe("false_handoff_or_registration_blocked");
  });

  it("2. Caso Ricardo Wennek / MAXI HAIR (A-03): detecta pedido de chave Pix e intercepta promessas de proposta/consultor em collecting", () => {
    expect(isClientRefusingAdditionalQualification("Já me manda a chave Pix, que já faço")).toBe(true);
    expect(isClientRefusingAdditionalQualification("manda o pix pra pagar agora")).toBe(true);

    const falseProposalClaim1 = [
      "Confirmado, Ricardo.",
      "Já estou solicitando sua proposta comercial para a Envasadora Manual A-03. Em instantes, um de nossos consultores enviará o documento com todos os detalhes para pagamento e o prazo de embarque.",
    ];
    expect(claimsIndustrialHandoffEffect(falseProposalClaim1)).toBe(true);
    expect(isPrematureIndustrialHandoffBubble(falseProposalClaim1[1])).toBe(true);

    const falseProposalClaim2 = [
      "Ricardo, o valor exato e atualizado do equipamento, junto com as condições de pagamento, virá detalhado na proposta comercial que nosso consultor já está preparando para você.",
    ];
    expect(claimsIndustrialHandoffEffect(falseProposalClaim2)).toBe(true);
    expect(isPrematureIndustrialHandoffBubble(falseProposalClaim2[0])).toBe(true);
  });

  it("3. Caso Rafael Vieira / Magic Berry (BS6535LA + PDF CNPJ): lê tag com :fileName, extrai CNPJ válido do texto do PDF e bloqueia falsa análise técnica", () => {
    const parsedTag = parseMediaTagFromContent(
      "[MEDIA:document]med_a36f9ec1ad099c9a9e7860ea40fc0e43:cartao cnpj.pdf",
    );
    expect(parsedTag).toEqual({
      mediaType: "document",
      mediaId: "med_a36f9ec1ad099c9a9e7860ea40fc0e43",
      fileName: "cartao cnpj.pdf",
      caption: "",
    });

    const parsedImageTag = parseMediaTagFromContent("[MEDIA:image]med_12345\nSegue foto");
    expect(parsedImageTag).toEqual({
      mediaType: "image",
      mediaId: "med_12345",
      caption: "Segue foto",
    });

    const extractedCnpj = extractValidCnpjFromDocumentText(
      "PROTOCOLO REDESIM 99999999999999\nCOMPROVANTE DE INSCRIÇÃO\nCNPJ: 11.222.333/0001-81\nMAGIC BERRY",
    );
    expect(extractedCnpj).toBe("11.222.333/0001-81");

    const extractedRawDigits = extractValidCnpjFromDocumentText(
      "Chave invalida 12345678901234 e CNPJ valido 11222333000181 no documento",
    );
    expect(extractedRawDigits).toBe("11.222.333/0001-81");

    expect(
      isPrematureIndustrialHandoffBubble("Perfeito, Rafael. Registrei as informações da Magic Berry."),
    ).toBe(true);
    expect(
      isPrematureIndustrialHandoffBubble(
        "Um de nossos especialistas fará a análise técnica para o seu projeto de embalar os packs de sorvete e entrará em contato em breve com a solução ideal.",
      ),
    ).toBe(true);
  });

  it("4. Caso Paulo / DB DISTRIBUIDORA (FRP400): detecta cliente recorrente dispensando questionário sem afetar suporte técnico", () => {
    expect(
      isClientRefusingAdditionalQualification("tenho várias seladoras de vcs, já conheço o produto"),
    ).toBe(true);
    expect(
      isClientRefusingAdditionalQualification("desculpe, mais tenho 9 seladoras, já conheço o produto"),
    ).toBe(true);
    expect(
      isClientRefusingAdditionalQualification("tenho uma seladora da Tecfag e ela não liga, preciso de manutenção"),
    ).toBe(false);
  });

  it("5. Caso Luiz Ernani (Site): detecta pedido de ligação via celular e garante execução de rescuePartialLead + aprovação SDR no SdrFollowupEngine", () => {
    expect(isClientRefusingAdditionalQualification("poderia me chamar via celular...")).toBe(true);

    const followupSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/valentina/sdr-followup-engine.ts"),
      "utf8",
    );
    const rescueIdx = followupSrc.indexOf("if (decision.rescuePartialLead)");
    const noneSkipIdx = followupSrc.indexOf('if (decision.action === "none" && !decision.rescuePartialLead)');
    const noneAfterRescueIdx = followupSrc.indexOf('if (decision.action === "none") {', rescueIdx);
    expect(noneSkipIdx).toBeGreaterThan(0);
    expect(rescueIdx).toBeGreaterThan(noneSkipIdx);
    expect(noneAfterRescueIdx).toBeGreaterThan(rescueIdx);
    expect(followupSrc).toContain("prepareIndustrialApproval");
    expect(followupSrc).toContain("notifySdrTeamApprovalPending");
  });

  it("6. Zero-Question Guard & Reschedule: bloqueia resposta afirmativa sem pergunta em collecting, exceto quando cliente reagendou", () => {
    const route = resolveIndustrialRoute({
      text: "Quero comprar uma envasadora",
      collectedData: {
        "NOME COMPLETO": { value: "Marcos", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Envasadora", status: "filled" },
      },
    });
    const incompleteData = {
      "NOME COMPLETO": { value: "Marcos", status: "filled" },
      "MÁQUINA / PEÇA / INTERESSE": { value: "Envasadora", status: "filled" },
    };

    const noQuestionEval = evaluateIndustrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data: incompleteData,
      messages: ["Excelente escolha, a envasadora atende cosméticos e líquidos."],
    });
    expect(noQuestionEval.needsGeminiRewrite).toBe(true);
    expect(noQuestionEval.rewriteMode).toBe("collecting_missing_fields");

    expect(isClientReschedulingTurn("amanhã te mando os dados da empresa")).toBe(true);
    const rescheduledEval = evaluateIndustrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data: incompleteData,
      messages: ["Combinado, Marcos. Aguardo seu retorno amanhã para seguirmos."],
      clientRescheduled: true,
    });
    expect(rescheduledEval.needsGeminiRewrite).toBe(false);

    const legitimateQuestion = ["Para que o especialista possa preparar a proposta, qual o seu CNPJ?"];
    expect(claimsIndustrialHandoffEffect(legitimateQuestion)).toBe(false);
    const questionEval = evaluateIndustrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data: incompleteData,
      messages: legitimateQuestion,
    });
    expect(questionEval.needsGeminiRewrite).toBe(false);

    expect(
      botAlreadyAskedMissingField(
        ["Certo. E qual seria o volume de produção? Quantos frascos por dia ou por hora?"],
        "production",
      ),
    ).toBe(true);
    expect(
      botAlreadyAskedMissingField(
        ["Nosso principal modelo é a Envasadora Manual A-03 com volume ajustável de 5 a 50 ml."],
        "production",
      ),
    ).toBe(false);
  });

  it("7. Contrato parseIndustrialAiResult aceita escalateToHumanReview e preserva validação estrita", () => {
    const parsed = parseIndustrialAiResult({
      subflow: "5A_CLIENTE",
      messagesToSend: ["Já estou direcionando seu atendimento para nossa equipe dar continuidade."],
      escalateToHumanReview: true,
      escalationReason: "client_refused_production",
      isCompleted: true,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.escalateToHumanReview).toBe(true);
    expect(parsed?.escalationReason).toBe("client_refused_production");

    const parsedDefault = parseIndustrialAiResult({
      messagesToSend: ["Qual o seu nome?"],
    });
    expect(parsedDefault?.escalateToHumanReview).toBe(false);
    expect(parsedDefault?.escalationReason).toBeNull();

    expect(parseIndustrialAiResult(null)).toBeNull();
    expect(parseIndustrialAiResult({ messagesToSend: [] })).toBeNull();
  });

  it("8. Isolamento multi-tenant: SdrEngine mantém regras novas estritamente em industrialTriage sem alterar Valem", () => {
    const engineSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
      "utf8",
    );
    expect(engineSrc).toContain("isClientUnableOrRefusingProduction");
    expect(engineSrc).toContain("isClientRefusingAdditionalQualification");
    expect(engineSrc).toContain("extractCnpjFromPdfBase64");
    expect(engineSrc).toContain("hasActiveCommercialLead");
    expect(engineSrc).toContain("isSitePartialCommercialClosing");
    expect(engineSrc).toContain("Encerrado (Lead Parcial Site)");

    const valemBlockStart = engineSrc.indexOf("🏢 FLUXO VALENTINA SDR (VALEM) — INALTERADO");
    const valemBlockEnd = engineSrc.indexOf("// 10. Se a qualificação foi concluída agora");
    expect(valemBlockStart).toBeGreaterThan(0);
    expect(valemBlockEnd).toBeGreaterThan(valemBlockStart);
    const valemSection = engineSrc.slice(valemBlockStart, valemBlockEnd);
    expect(valemSection).not.toContain("tecfag");
    expect(valemSection).not.toContain("escalateToHumanReview");
  });
});
