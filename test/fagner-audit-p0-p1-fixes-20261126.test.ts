import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  shouldPreserveExistingWhatsappHumanOwner,
  summarizeSiteTriageNote,
} from "../src/lib/livechat/site-whatsapp-handoff";
import {
  isAutomatedBotOrUraMessage,
  isClientResistingProductionQuestion,
  isPostCloseCourtesyOnlyMessage,
  isTerseProductionFrustrationTurn,
  isValidIndustrialPersonName,
  isVagueIndustrialProductionValue,
  resolveIndustrialRoute,
} from "../src/lib/triage/industrial-policy";
import {
  buildKnownClientPromptDirective,
  isValidKnownCompanyName,
} from "../src/lib/triage/known-client-lookup";

describe("Pacote P0/P1 Auditoria Fagner 25/11–26/11/2026", () => {
  it("P0 — InboundProcessor usa `text` (não `rawText` indefinido) e loga exceção real na transação", () => {
    const inboundSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/whatsapp/inbound.ts"),
      "utf8",
    );
    expect(inboundSrc).not.toContain("isPostCloseCourtesyOnlyMessage(rawText)");
    expect(inboundSrc).toContain('isPostCloseCourtesyOnlyMessage(text || "")');
    expect(inboundSrc).toContain("[InboundProcessor] Falha na transação de entrada");
  });

  it("P0 — SlaEngine.updateResponseMetrics usa `date: today` (corrige ReferenceError: date is not defined)", () => {
    const slaSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/sla-engine.ts"), "utf8");
    const methodIdx = slaSrc.indexOf("async updateResponseMetrics(");
    expect(methodIdx).toBeGreaterThan(0);
    const methodBody = slaSrc.slice(methodIdx);
    expect(methodBody).toContain("date: today,");
    expect(methodBody).not.toMatch(/^\s+date,\s*$/m);
  });

  it("P0 — Ponte Site→WhatsApp não silencia triagem comercial atrás de operador fora dos setores/rodízio (ex.: Roseli Costa / Recepção)", () => {
    // Caso Fabio / Minas Gourmet: conversa aberta atribuída à Recepção (fora de setores e fora do rodízio)
    expect(
      shouldPreserveExistingWhatsappHumanOwner({
        queueState: "meus",
        operatorId: "op-roseli-recepcao",
        operatorHasSectorOrRodizio: false,
      }),
    ).toBe(false);

    // Operador real de setor/rodízio (ex.: Denise Gomes / Keicy / Pamela): continua preservado!
    expect(
      shouldPreserveExistingWhatsappHumanOwner({
        queueState: "meus",
        operatorId: "op-denise-maquinas",
        operatorHasSectorOrRodizio: true,
      }),
    ).toBe(true);

    // Conversa finalizada nunca bloqueia reabertura
    expect(
      shouldPreserveExistingWhatsappHumanOwner({
        queueState: "finalizados",
        operatorId: "op-denise-maquinas",
        operatorHasSectorOrRodizio: true,
      }),
    ).toBe(false);

    // Nota interna documenta a promoção da Recepção para SDR
    const note = summarizeSiteTriageNote(
      {
        tenantId: "tecfag",
        siteConversationId: "conv-lc-test",
        siteFlowId: "fs-test",
        cycle: "2026-11-26T11:00:00.000Z",
        route: {
          subflow: "MAQUINAS",
          funnelStage: "maquinas",
          targetFunnel: "Máquinas",
          needsReview: false,
          reason: "intent",
        },
        data: {},
        clientName: "Fabio",
        companyName: "Minas Gourmet",
        contactId: "cont-1",
      },
      "fagner_site_continuacao_v1",
      true,
      "Roseli Costa",
    );
    expect(note).toContain("Roseli Costa");
    expect(note).toContain("promovida automaticamente para aprovação SDR");
  });

  it("P1 — Escape hatch de produtividade detecta resistência (casos André/INBELL e Marcos/Nutracêuticos) sem falso positivo em produção real", () => {
    expect(
      isClientResistingProductionQuestion(
        "me passa as opções e suas capacidades\nque vejo a que melhor me atende",
      ),
    ).toBe(true);
    expect(isClientResistingProductionQuestion("Sem mais perguntas")).toBe(true);
    expect(isClientResistingProductionQuestion("Não importa a produção")).toBe(true);

    // Respostas reais com número/cadência NUNCA disparam resistência
    expect(isClientResistingProductionQuestion("1000 pacotes por dia")).toBe(false);
    expect(isClientResistingProductionQuestion("500 unidades/hora")).toBe(false);
    expect(isClientResistingProductionQuestion("geleia, são 1000 frascos por dia")).toBe(false);

    // Turnos frustrados curtos após incerteza prévia
    expect(isTerseProductionFrustrationTurn(".")).toBe(true);
    expect(isTerseProductionFrustrationTurn("...")).toBe(true);
    expect(isTerseProductionFrustrationTurn("não sei")).toBe(true);
    expect(isTerseProductionFrustrationTurn("500 pacotes por dia")).toBe(false);

    // "não tenho uma média" / "A definir com especialista" não são tratados como vagos vazios
    expect(isVagueIndustrialProductionValue("A definir com especialista")).toBe(false);
    expect(isVagueIndustrialProductionValue("não tenho uma média")).toBe(false);
    expect(isVagueIndustrialProductionValue("muito trigo")).toBe(true);
  });

  it("P1 — Mensagem automática de ausência (Betec Manutenção Técnica / horário comercial) é detectada como bot/auto-reply e NÃO roteia para Assistência Técnica", () => {
    const betecAutoReply =
      "A Betec Manutenção Técnica agradece seu contato!! Assim que possível responderei sua mensagem ✍🏼";
    const marcosAutoReply =
      "Mensagem Automática ⚠️\nAgradecemos seu contato. Nosso retorno será realizado em horário comercial.\nContamos com sua compreensão.";

    expect(isAutomatedBotOrUraMessage({ text: betecAutoReply })).toBe(true);
    expect(isAutomatedBotOrUraMessage({ text: marcosAutoReply })).toBe(true);

    // Mesmo se chegasse ao roteador de texto, NÃO pode classificar como 3_AT
    const route = resolveIndustrialRoute({ text: betecAutoReply, collectedData: {} });
    expect(route.subflow).not.toBe("3_AT");

    // Defeito real de máquina continua indo para 3_AT e NÃO é tratado como auto-reply
    const realSupport = "Minha seladora parou de funcionar e precisa de manutenção técnica";
    expect(isAutomatedBotOrUraMessage({ text: realSupport })).toBe(false);
    expect(resolveIndustrialRoute({ text: realSupport, collectedData: {} }).subflow).toBe("3_AT");
  });

  it("P1 — Rejeita apelidos com emojis/lemas (DEUS NO CONTROLE 😎) e não pede confirmação de empresa usando nome pessoal com apenas CPF (Marcos Rogério)", () => {
    expect(isValidIndustrialPersonName("DEUS NO CONTROLE 😎")).toBe(false);
    expect(isValidIndustrialPersonName("DEUS NO CONTROLE")).toBe(false);
    expect(isValidIndustrialPersonName("Bem Natural 💚")).toBe(false);
    expect(isValidIndustrialPersonName("Gilberto")).toBe(true);
    expect(isValidIndustrialPersonName("Hércules Moreira")).toBe(true);

    expect(isValidKnownCompanyName("DEUS NO CONTROLE 😎")).toBe(false);
    expect(isValidKnownCompanyName("DEUS NO CONTROLE")).toBe(false);
    expect(isValidKnownCompanyName("INDUSTRIA & CO LIBIA LTDA")).toBe(true);

    // Marcos Rogério: CPF (11 dígitos) + nome pessoal igual ao nome da empresa -> NÃO gerar diretriz "Sua empresa é a Marcos Rogério, certo?"
    const directiveCpf = buildKnownClientPromptDirective({
      knownClient: {
        companyName: "Marcos Rogério",
        contactName: "Marcos Rogério",
        document: "34298115895",
        source: "contact_company",
      },
      confirmationStatus: "pending",
      currentData: {},
    });
    expect(directiveCpf).toBe("");

    // Empresa real com CNPJ (14 dígitos) continua gerando diretriz normalmente
    const directiveCnpj = buildKnownClientPromptDirective({
      knownClient: {
        companyName: "Taça Legal Sorvet",
        contactName: "Gerson",
        document: "12345678000199",
        source: "crm_account",
      },
      confirmationStatus: "pending",
      currentData: {},
    });
    expect(directiveCnpj).toContain("Sua empresa é a Taça Legal Sorvet, certo?");
  });

  it("P2 — Telemetria MCP audit_batch deriva channel de isSiteConversationId e triageAccuracy trata 'Análise e revisão humana' ↔ 'Sdr' como equivalentes", () => {
    const mcpTriageSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/mcp/valem-tecfag-mcp-triage-tools.ts"),
      "utf8",
    );
    expect(mcpTriageSrc).toContain('channel: isSiteConversationId(flow.conversationId) ? "site" : "whatsapp"');

    const approvalSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/triage/industrial-approval-store.ts"),
      "utf8",
    );
    expect(approvalSrc).toContain('norm === "sdr" || norm === normalizeTriageText(INDUSTRIAL_REVIEW_FUNNEL)');
  });

  it("P0 — isPostCloseCourtesyOnlyMessage roda em tempo linear O(N) sem backtracking/ReDoS em entradas repetitivas", () => {
    expect(isPostCloseCourtesyOnlyMessage("Ok")).toBe(true);
    expect(isPostCloseCourtesyOnlyMessage("Ah, tá joia! Muito obrigado pelo retorno, tenha um ótimo dia!")).toBe(true);
    expect(isPostCloseCourtesyOnlyMessage("👍")).toBe(true);
    expect(isPostCloseCourtesyOnlyMessage("Ok, mas preciso de uma seladora a vácuo")).toBe(false);
    expect(isPostCloseCourtesyOnlyMessage("Ta bom?")).toBe(false);

    // Entrada adversarial que causava ReDoS exponencial O(2^N) na regex anterior com `ta|t[aá]` dentro de `(...)+$`
    const adversarial = `${"ta ".repeat(28)}x`;
    const startedAt = performance.now();
    expect(isPostCloseCourtesyOnlyMessage(adversarial)).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(20);
  });
});
