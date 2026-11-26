import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateSiteCrossChannelSuppression,
  SITE_CROSS_CHANNEL_WA_APPROVAL_WINDOW_MS,
  SITE_CROSS_CHANNEL_WA_FLOW_WINDOW_MS,
  SITE_CROSS_CHANNEL_WA_HUMAN_WINDOW_MS,
} from "../src/lib/livechat/site-cross-channel-guard";
import {
  buildSiteCrossChannelDialogPrompt,
  buildSiteCrossChannelFallbackReply,
  parseSiteCrossChannelDialogResult,
} from "../src/lib/livechat/site-cross-channel-dialog";
import {
  DEFAULT_MID_TRIAGE_TEMPLATE_NAME,
  extractSitePhoneCandidate,
  isExplicitPhoneCallInsistence,
  isExplicitWhatsappMigrationConfirmation,
  isSiteChannelMigrationOrCallRequest,
} from "../src/lib/livechat/site-mid-triage-whatsapp";
import {
  buildMirroredSiteMessageId,
  buildMirroredSiteMessageRow,
} from "../src/lib/livechat/site-whatsapp-mirror";
import {
  formatBrPhoneForDisplay,
  parseSiteChannelSettings,
} from "../src/lib/livechat/site-channel-policy";
import {
  computeChannelBoundaryMarkers,
  isSiteOriginMessage,
} from "../src/lib/chat/message-channel-origin";
import { parseIndustrialAiResult } from "../src/lib/triage/industrial-ai-result";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";

const readRepoFile = (relPath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");

const INDUSTRIAL_PERSONA = {
  name: "Fagner",
  company: "Grupo Tecfag",
  segment: "Máquinas industriais de embalagem",
  tone: "técnico, consultivo e cordial",
  gender: "male" as const,
  triagePolicy: "industrial" as const,
};

describe("Fagner Site × WhatsApp — Unificação Real-Time, Gemini Cross-Channel 24h e Migração Mid-Triage", () => {
  test("1. Janela unificada de 24h na trava cross-channel (meus, automacao e awaiting_approval)", () => {
    expect(SITE_CROSS_CHANNEL_WA_HUMAN_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(SITE_CROSS_CHANNEL_WA_FLOW_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(SITE_CROSS_CHANNEL_WA_APPROVAL_WINDOW_MS).toBe(24 * 60 * 60 * 1000);

    const now = new Date("2026-11-26T18:00:00.000Z");

    // Consultor humano falou há 6h (< 24h) -> reconhecido e preserva nome do consultor
    const human6h = evaluateSiteCrossChannelSuppression({
      siteConversationId: "conv-lc-vis-1",
      now,
      siteLatestClientMessageAt: "2026-11-26T17:59:55.000Z",
      whatsappPeers: [
        {
          conversationId: "conv-wa-1",
          queueState: "meus",
          operatorId: "op-tarcisio",
          operatorName: "Tarcísio",
          lastMessageTime: "2026-11-26T12:00:00.000Z",
          flow: null,
        },
      ],
    });
    expect(human6h.suppressed).toBe(true);
    expect(human6h.reason).toBe("whatsapp_human_active");
    expect(human6h.whatsappOperatorName).toBe("Tarcísio");

    // Triagem Fagner no WhatsApp há 10h (< 24h) -> reconhecido e expõe collectedData p/ herança
    const triage10h = evaluateSiteCrossChannelSuppression({
      siteConversationId: "conv-lc-vis-2",
      now,
      siteLatestClientMessageAt: "2026-11-26T17:59:55.000Z",
      whatsappPeers: [
        {
          conversationId: "conv-wa-2",
          queueState: "automacao",
          operatorId: null,
          lastMessageTime: "2026-11-26T08:00:00.000Z",
          flow: {
            id: "fs-wa-2",
            outcome: "in_progress",
            completedAt: null,
            lastInteractionAt: "2026-11-26T08:00:00.000Z",
            collectedData: {
              "NOME COMPLETO": { value: "Carlos Lima", status: "filled" },
              "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora a vácuo", status: "filled" },
            },
            metadata: { subflow: "MAQUINAS" },
          },
        },
      ],
    });
    expect(triage10h.suppressed).toBe(true);
    expect(triage10h.reason).toBe("whatsapp_triage_in_progress");
    expect(triage10h.whatsappFlowCollectedData?.["NOME COMPLETO"]?.value).toBe("Carlos Lima");
    expect(triage10h.whatsappFlowSubflow).toBe("MAQUINAS");

    // Conversa aberta mas parada há >24h (25h) -> NÃO aciona cross-channel
    const stale25h = evaluateSiteCrossChannelSuppression({
      siteConversationId: "conv-lc-vis-3",
      now,
      whatsappPeers: [
        {
          conversationId: "conv-wa-3",
          queueState: "meus",
          operatorId: "op-1",
          lastMessageTime: "2026-11-25T17:00:00.000Z",
          flow: null,
        },
      ],
    });
    expect(stale25h.suppressed).toBe(false);
  });

  test("2. Espelhamento real-time gera lcx-* idempotente compatível com selo Via Site e divisórias (sem abrir Meta 24h)", () => {
    const idA = buildMirroredSiteMessageId("conv-wa-100", "lcm-abc");
    const idB = buildMirroredSiteMessageId("conv-wa-100", "lcm-abc");
    expect(idA).toBe(idB);
    expect(idA.startsWith("lcx-")).toBe(true);

    const row = buildMirroredSiteMessageRow({
      tenantId: "tenant-x",
      waConversationId: "conv-wa-100",
      siteConversationId: "conv-lc-vis-100",
      source: {
        id: "lcm-abc",
        senderType: "client",
        senderName: "Tarcísio",
        content: "ola tem alguem ai",
        direction: "inbound",
        status: "delivered",
        sentAt: new Date("2026-11-26T15:30:00.000Z"),
      },
    });

    // Nunca usa provider "meta" (jamais falsifica janela 24h da Meta)
    expect(row.provider).toBe("livechat");
    expect(row.isInternalNote).toBe(false);
    expect((row.metaDetails as any)?.copiedFrom).toEqual({
      channel: "livechat",
      conversationId: "conv-lc-vis-100",
      messageId: "lcm-abc",
    });

    // Reconhecido nativamente pelo renderizador de selo Via Site e divisórias de canal
    expect(isSiteOriginMessage(row)).toBe(true);
    const markers = computeChannelBoundaryMarkers(
      [
        { id: "wa-1", provider: "meta", senderType: "client" },
        row,
        { id: "wa-2", provider: "meta", senderType: "agent" },
      ],
      { id: "conv-wa-100", channel: "whatsapp" },
    );
    expect(markers[1].isSiteOriginInWhatsapp).toBe(true);
    expect(markers[1].beforeDivider).toBe("site_start");
    expect(markers[2].beforeDivider).toBe("whatsapp_start");
  });

  test("3. Diálogo natural Gemini cross-channel substitui mensagem scriptada e parseia os 4 desfechos", () => {
    const prompt = buildSiteCrossChannelDialogPrompt({
      tenantId: "tenant-x",
      siteConversationId: "conv-lc-1",
      whatsappConversationId: "conv-wa-1",
      aiPersona: INDUSTRIAL_PERSONA,
      crossChannelReason: "whatsapp_human_active",
      consultantName: "Tarcísio",
      clientName: "Tarcísio Pereira",
      contactPhone: "5514998364338",
      whatsappHistoryExcerpt: "[Tarcísio]: Oi, aqui é Tarcisio, aproveite os últimos dias da Black!",
      siteHistoryExcerpt: "[Cliente]: ola\n[Fagner]: Vi que já estamos no WhatsApp...",
      latestClientMessage: "como assim",
      alreadyAskedChannelChoice: true,
    });

    expect(prompt).toContain("Tarcísio");
    expect(prompt).toContain("4338");
    expect(prompt).toContain("como assim");
    expect(prompt).toContain("NUNCA use frases robóticas");
    expect(prompt).toContain("accept_whatsapp");
    expect(prompt).toContain("decline_stay_on_site");
    expect(prompt).toContain("note_for_consultant");

    const parsedAccept = parseSiteCrossChannelDialogResult({
      decision: "accept_whatsapp",
      messagesToSend: ["Perfeito! Pode continuar por lá no WhatsApp que já deixei tudo no mesmo histórico."],
      consultantSummaryNote: null,
    });
    expect(parsedAccept?.decision).toBe("accept_whatsapp");
    expect(parsedAccept?.messagesToSend.length).toBe(1);

    const parsedNote = parseSiteCrossChannelDialogResult({
      decision: "note_for_consultant",
      messagesToSend: ["Sem problema! Já deixei seu recado no histórico do WhatsApp para o Tarcísio."],
      consultantSummaryNote: "Cliente perguntou sobre a proposta da seladora automática.",
    });
    expect(parsedNote?.decision).toBe("note_for_consultant");
    expect(parsedNote?.consultantSummaryNote).toContain("seladora");

    const fallback = buildSiteCrossChannelFallbackReply({
      crossChannelReason: "whatsapp_human_active",
      consultantName: "Tarcísio Pereira",
      contactPhone: "5514998364338",
      alreadyAskedChannelChoice: false,
    });
    expect(fallback.messagesToSend[0]).toContain("Teria algum problema em continuarmos por lá");
    expect(fallback.messagesToSend[0]).not.toContain("para não duplicar informações");
  });

  test("4. Detecção de gatilhos, confirmação, insistência em ligação e extração de telefone na migração mid-triage", () => {
    // Gatilhos do pedido do usuário
    expect(isSiteChannelMigrationOrCallRequest("Podemos falar no whatsapp")).toBe(true);
    expect(isSiteChannelMigrationOrCallRequest("podemos falar no zap")).toBe(true);
    expect(isSiteChannelMigrationOrCallRequest("Pode me chamar no telefone")).toBe(true);
    expect(isSiteChannelMigrationOrCallRequest("pode me ligar")).toBe(true);
    expect(isSiteChannelMigrationOrCallRequest("me chama no zap por favor")).toBe(true);
    expect(isSiteChannelMigrationOrCallRequest("quero continuar pelo whatsapp")).toBe(true);

    // Falsos positivos que NÃO devem disparar migração
    expect(isSiteChannelMigrationOrCallRequest("preciso de uma seladora a vácuo para 500 pacotes por dia")).toBe(false);
    expect(isSiteChannelMigrationOrCallRequest("qual o valor da FRP400?")).toBe(false);
    expect(isSiteChannelMigrationOrCallRequest("meu cnpj é 51.770.747/0001-60")).toBe(false);

    // Confirmações após oferta
    expect(isExplicitWhatsappMigrationConfirmation("sim")).toBe(true);
    expect(isExplicitWhatsappMigrationConfirmation("pode mandar")).toBe(true);
    expect(isExplicitWhatsappMigrationConfirmation("pode chamar no zap por favor")).toBe(true);
    expect(isExplicitWhatsappMigrationConfirmation("claro, manda lá")).toBe(true);
    expect(isExplicitWhatsappMigrationConfirmation("não, prefiro por aqui mesmo")).toBe(false);
    expect(isExplicitWhatsappMigrationConfirmation("não, quero que me ligue")).toBe(false);

    // Insistência em ligação telefônica por voz
    expect(isExplicitPhoneCallInsistence("não, prefiro ligação telefônica mesmo")).toBe(true);
    expect(isExplicitPhoneCallInsistence("não uso whatsapp, me liga")).toBe(true);
    expect(isExplicitPhoneCallInsistence("pode me ligar?")).toBe(false);

    // Extração de telefone (sem confundir com CNPJ!)
    expect(extractSitePhoneCandidate("pode mandar no (14) 99836-4338")).toBe("5514998364338");
    expect(extractSitePhoneCandidate("meu numero é 11 987654321")).toBe("5511987654321");
    expect(extractSitePhoneCandidate("cnpj 51.770.747/0001-60")).toBeNull();
    expect(formatBrPhoneForDisplay("5514998364338")).toBe("(14) 99836-4338");
    expect(formatBrPhoneForDisplay("1431615000")).toBe("(14) 3161-5000");
  });

  test("5. Schema parseIndustrialAiResult + prompt buildTecfagFagnerPrompt suportam siteWhatsappMigration e continuidade no WhatsApp", () => {
    const parsedOffer = parseIndustrialAiResult({
      subflow: "MAQUINAS",
      extractedData: { "MÁQUINA / PEÇA / INTERESSE": "Seladora" },
      funnelStage: "maquinas",
      targetFunnel: "Máquinas",
      messagesToSend: ["Claro! Posso te chamar no WhatsApp (14) 99836-4338 agora mesmo, pode ser?"],
      siteWhatsappMigration: {
        intent: "offer_whatsapp",
        providedPhone: null,
      },
      isCompleted: false,
    });
    expect(parsedOffer?.siteWhatsappMigration?.intent).toBe("offer_whatsapp");

    // Retrocompatível quando omitido
    const parsedLegacy = parseIndustrialAiResult({
      subflow: "MAQUINAS",
      extractedData: {},
      messagesToSend: ["Qual produto você vai embalar?"],
      isCompleted: false,
    });
    expect(parsedLegacy?.siteWhatsappMigration).toBeNull();

    // Prompt no Site inclui bloco de migração com telefone conhecido
    const sitePrompt = buildTecfagFagnerPrompt({
      aiPersona: INDUSTRIAL_PERSONA,
      knowledgeContext: "",
      conversationHistoryText: "",
      batchSummary: "podemos falar no zap",
      currentDataSummary: { "NOME COMPLETO": "Tarcísio" },
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
      siteMigrationContext: {
        isSiteChannel: true,
        knownPhoneFormatted: "(14) 99836-4338",
        offerPending: false,
      },
    });
    expect(sitePrompt).toContain("MIGRAÇÃO SOB DEMANDA SITE → WHATSAPP");
    expect(sitePrompt).toContain("(14) 99836-4338");
    expect(sitePrompt).toContain("siteWhatsappMigration");

    // Prompt no WhatsApp pós-migração mid-triage instrui retomar exatamente de onde parou
    const waMidPrompt = buildTecfagFagnerPrompt({
      aiPersona: INDUSTRIAL_PERSONA,
      knowledgeContext: "",
      conversationHistoryText: "[Cliente]: Quero uma seladora a vácuo",
      batchSummary: "Oi, podemos seguir sim",
      currentDataSummary: {
        "NOME COMPLETO": "Tarcísio",
        "MÁQUINA / PEÇA / INTERESSE": "Seladora a vácuo",
      },
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
      migratedFromSiteMidTriage: true,
    });
    expect(waMidPrompt).toContain("CONTINUIDADE SITE → WHATSAPP (TRIAGEM EM ANDAMENTO MIGRADA DO SITE)");
    expect(waMidPrompt).toContain("NUNCA se reapresente e NUNCA repita nenhuma pergunta já respondida no site");
  });

  test("6. Config Canal Site, Design System, isolamento multi-tenant e contratos de integração", () => {
    // parseSiteChannelSettings suporta siteWhatsappMidTriageTemplateId
    const cfg = parseSiteChannelSettings(true, {
      siteChannelEnabled: true,
      siteWhatsappTemplateId: "fagner_site_continuacao_v1",
      siteWhatsappMidTriageTemplateId: DEFAULT_MID_TRIAGE_TEMPLATE_NAME,
    });
    expect(cfg.whatsappTemplateId).toBe("fagner_site_continuacao_v1");
    expect(cfg.whatsappMidTriageTemplateId).toBe("fagner_site_continuacao_triagem_v1");

    // Design System em SiteChannelCard.tsx: ZERO <select> nativo e ZERO title=
    const cardCode = readRepoFile("src/components/chat/SiteChannelCard.tsx");
    expect(cardCode).not.toMatch(/<select[\s>]/i);
    expect(cardCode).not.toMatch(/\btitle="/);
    expect(cardCode).toContain("SimpleSelect");
    expect(cardCode).toContain("siteWhatsappMidTriageTemplateId");

    // Isolamento multi-tenant estrito: nenhum dos novos módulos hardcodeia 'valem' ou 'tecfag'
    for (const file of [
      "src/lib/livechat/site-whatsapp-mirror.ts",
      "src/lib/livechat/site-cross-channel-dialog.ts",
      "src/lib/livechat/site-mid-triage-whatsapp.ts",
      "src/lib/livechat/site-cross-channel-guard.ts",
    ]) {
      const code = readRepoFile(file);
      expect(code).not.toMatch(/["'](?:valem|tecfag)["']/);
    }

    // Contratos críticos de integração:
    const sdrEngine = readRepoFile("src/lib/valentina/sdr-engine.ts");
    expect(sdrEngine).not.toContain(
      "Já estamos dando continuidade ao seu atendimento pelo WhatsApp! Pode seguir por lá com a nossa equipe para não duplicar informações.",
    );
    expect(sdrEngine).toContain("evaluateSiteCrossChannelTurnWithGemini");
    expect(sdrEngine).toContain("executeMidTriageSiteToWhatsApp");
    expect(sdrEngine).toContain("mirrorSiteMessagesToWhatsapp");

    const adapter = readRepoFile("src/lib/livechat/site-industrial-adapter.ts");
    expect(adapter).toContain("mirrorSiteMessagesToWhatsapp");

    const outbound = readRepoFile("src/lib/valentina/industrial-outbound.ts");
    expect(outbound).toContain("mirrorSiteMessagesToWhatsapp");
    expect(outbound).toContain("isAlreadyClosedBridgeReply");

    const deliveryCtx = readRepoFile("src/lib/valentina/industrial-delivery-context.ts");
    expect(deliveryCtx).toContain("migratedMidTriage === true");
    expect(deliveryCtx).toContain("crossChannelAcceptedWhatsapp === true");

    const followup = readRepoFile("src/lib/valentina/sdr-followup-engine.ts");
    expect(followup).toContain("getMetaServiceWindow");
    expect(followup).toContain("mirrorSiteMessagesToWhatsapp");

    const midTriageCode = readRepoFile("src/lib/livechat/site-mid-triage-whatsapp.ts");
    expect(midTriageCode).toContain("ensureCwrDealOnContacting");
    expect(midTriageCode).toContain("shouldPreserveExistingWhatsappHumanOwner");
    expect(midTriageCode).toContain('handoffStatus: "collecting"');
    expect(midTriageCode).toContain("migratedFromSiteMidTriage: true");
  });
});
