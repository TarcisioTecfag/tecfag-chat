import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { evaluateSiteCrossChannelSuppression } from "../src/lib/livechat/site-cross-channel-guard";
import { sanitizeSiteIdentity } from "../src/lib/livechat/site-channel-policy";
import {
  canFinishIndustrialTriage,
  resolveIndustrialRoute,
} from "../src/lib/triage/industrial-policy";
import { evaluateIndustrialSilence } from "../src/lib/triage/industrial-silence-policy";
import { formatVtexAiContext } from "../src/lib/vtex/turn";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";

const readRepoFile = (relPath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");

describe("Fagner Site — Correções da Auditoria Completa (25/11/2026)", () => {
  test("1. Trava cross-channel Site×WhatsApp: bloqueia colisão simultânea (caso Denise / DENTALNEWS)", () => {
    const now = new Date("2026-11-25T12:19:00.000Z");

    // Caso 1a: Denise mandou msg no Site às 12:03, mas já concluiu no WhatsApp em awaiting_approval às 12:14
    const resApproval = evaluateSiteCrossChannelSuppression({
      siteConversationId: "conv-lc-a2680622-292c-4b38-aa97-10204fbf3e6d",
      now,
      siteLatestClientMessageAt: "2026-11-25T12:03:56.000Z",
      whatsappPeers: [
        {
          conversationId: "conv-rdc-554133248120",
          queueState: "automacao",
          operatorId: null,
          lastMessageTime: "2026-11-25T12:14:47.000Z",
          flow: {
            id: "fs-sdr-tecfag-conv-rdc-554133248120",
            outcome: "in_progress",
            completedAt: null,
            lastInteractionAt: "2026-11-25T12:14:47.000Z",
            metadata: { handoffStatus: "awaiting_approval" },
          },
        },
      ],
    });
    expect(resApproval.suppressed).toBe(true);
    expect(resApproval.reason).toBe("whatsapp_awaiting_approval");
    expect(resApproval.whatsappConversationId).toBe("conv-rdc-554133248120");
    expect(resApproval.silentClose).toBe(true);

    // Caso 1b: Cliente escreve NOVA msg no Site depois do WhatsApp já estar em aprovação -> envia 1 aviso pontual
    const resNewSiteMsg = evaluateSiteCrossChannelSuppression({
      siteConversationId: "conv-lc-a2680622-292c-4b38-aa97-10204fbf3e6d",
      now,
      siteLatestClientMessageAt: "2026-11-25T12:18:30.000Z",
      whatsappPeers: [
        {
          conversationId: "conv-rdc-554133248120",
          queueState: "automacao",
          operatorId: null,
          lastMessageTime: "2026-11-25T12:14:47.000Z",
          flow: {
            id: "fs-sdr-tecfag-conv-rdc-554133248120",
            outcome: "in_progress",
            completedAt: null,
            lastInteractionAt: "2026-11-25T12:14:47.000Z",
            metadata: { handoffStatus: "awaiting_approval" },
          },
        },
      ],
    });
    expect(resNewSiteMsg.suppressed).toBe(true);
    expect(resNewSiteMsg.silentClose).toBe(false);

    // Caso 1c: Operador humano atendendo no WhatsApp recentemente (<2h) suprime follow-up do Site
    const resHuman = evaluateSiteCrossChannelSuppression({
      siteConversationId: "conv-lc-test-human",
      now,
      whatsappPeers: [
        {
          conversationId: "conv-rdc-5511999998888",
          queueState: "meus",
          operatorId: "op-123",
          lastMessageTime: "2026-11-25T11:50:00.000Z",
          flow: null,
        },
      ],
    });
    expect(resHuman.suppressed).toBe(true);
    expect(resHuman.reason).toBe("whatsapp_human_active");

    // Caso 1d: Conversa WhatsApp antiga/finalizada NÃO bloqueia o Site
    const resFinalized = evaluateSiteCrossChannelSuppression({
      siteConversationId: "conv-lc-test-open",
      now,
      whatsappPeers: [
        {
          conversationId: "conv-rdc-5511999998888",
          queueState: "finalizados",
          operatorId: null,
          lastMessageTime: "2026-11-25T12:10:00.000Z",
          flow: null,
        },
        {
          conversationId: "conv-rdc-5511999997777",
          queueState: "meus",
          operatorId: "op-123",
          lastMessageTime: "2026-11-24T08:00:00.000Z",
          flow: null,
        },
      ],
    });
    expect(resFinalized.suppressed).toBe(false);

    // Caso 1e: Conversa que não é do Site nunca é suprimida por essa guarda
    const resWa = evaluateSiteCrossChannelSuppression({
      siteConversationId: "conv-rdc-554133248120",
      now,
      whatsappPeers: [
        {
          conversationId: "conv-rdc-other",
          queueState: "meus",
          operatorId: "op-1",
          lastMessageTime: now.toISOString(),
        },
      ],
    });
    expect(resWa.suppressed).toBe(false);
  });

  test("2. VTEX no Site (livechat): gera contexto consultivo com gancho obrigatório em details", () => {
    const mockVtexResult = {
      status: "matched" as const,
      checkedAt: "2026-11-25T12:00:00.000Z",
      channel: "livechat" as const,
      selectedSkuId: "893",
      shippingStatus: "not_requested" as const,
      shipping: [],
      quantity: 1,
      products: [
        {
          id: "893",
          name: "Dosadora com Balança Eletrônica DM5000S",
          url: "https://www.tecfag.com.br/dosadora-dm5000s/p",
          description: "Dosadora eletrônica para granulados de 200g a 5kg.",
          specifications: { Modelo: "DM5000S", Voltagem: "220V" },
          skus: [
            {
              id: "893",
              name: "220V",
              reference: "DM5000S",
              priceCents: 1500000,
              available: true,
            },
          ],
        },
      ],
    };

    const siteCtx = formatVtexAiContext(mockVtexResult, "livechat");
    expect(siteCtx).toBeTruthy();
    expect(siteCtx!).toContain("CHAT DO SITE");
    expect(siteCtx!).toContain("OBRIGATÓRIO: encerre o último balão com UMA pergunta consultiva");
    expect(siteCtx!).toContain("Dosadora com Balança Eletrônica DM5000S");

    const runtimeCode = readRepoFile("src/lib/vtex/runtime.ts");
    expect(runtimeCode).toContain('(input.channel === "whatsapp" || input.channel === "livechat")');
    expect(runtimeCode).toContain("formatVtexAiContext(result, input.channel)");
    expect(runtimeCode).toContain("livechatNeedsHook");
  });

  test("3. Pré-chat: rejeita emojis/lixo como nome (caso 🇧 🇧🇷) e melhora upgrade de contato existente", () => {
    const emojiIdentity = sanitizeSiteIdentity("🇧 🇧🇷", "", "duboff@gmail.com", "(51) 9814-7959");
    expect(emojiIdentity.name).toBe("");
    expect(emojiIdentity.email).toBe("duboff@gmail.com");
    expect(emojiIdentity.phone).toBe("555198147959");

    const placeholderIdentity = sanitizeSiteIdentity("Visitante", "", "a@b.com", "(14) 99988-7766");
    expect(placeholderIdentity.name).toBe("");

    const validIdentity = sanitizeSiteIdentity("Rafael Boff", "", "duboff@gmail.com", "(51) 9814-7959");
    expect(validIdentity.name).toBe("Rafael Boff");

    const adapterCode = readRepoFile("src/lib/livechat/site-industrial-adapter.ts");
    expect(adapterCode).toContain("if (!isValidIndustrialPersonName(trimmed)) return true;");
  });

  test("4. 5B_CURRICULO encerra limpo sem ficar em ready + resgate parcial exige dado substantivo (casos BRUNA e Guilherme)", () => {
    const curriculoRoute = resolveIndustrialRoute({
      text: "Como faço pra enviar currículo",
      collectedData: {},
    });
    expect(curriculoRoute.subflow).toBe("5B_CURRICULO");
    // Mesmo que o LLM termine com pergunta de cortesia ou isCompleted: false, encerra limpo
    expect(
      canFinishIndustrialTriage({
        route: curriculoRoute,
        data: {},
        isCompleted: false,
        hasPendingQuestion: true,
      }),
    ).toBe(true);

    // Guilherme só escreveu "Whatsapp" — apenas NOME/EMAIL/TELEFONE do pré-chat NÃO devem gerar resgate parcial/card CRM
    const now = new Date("2026-11-25T11:30:00.000Z"); // 08:30 BRT
    const botAt = new Date("2026-11-25T11:18:00.000Z"); // 12 min de silêncio
    const silenceDecision = evaluateIndustrialSilence({
      now,
      withinSchedule: true,
      flow: {
        id: "fs-sdr-tecfag-conv-lc-guilherme",
        tenantId: "tecfag",
        conversationId: "conv-lc-guilherme",
        startedAt: new Date("2026-11-25T11:15:00.000Z"),
        lastInteractionAt: botAt,
        outcome: "in_progress",
        currentStep: "Em Qualificação",
        completedAt: null,
        followUpStage: 0,
        collectedData: {
          "NOME COMPLETO": { value: "Guilherme", status: "filled" },
          EMAIL: { value: "gmenezes97@icloud.com", status: "filled" },
          TELEFONE: { value: "557999121442", status: "filled" },
        },
        metadata: { followUpStage: 0 },
      },
      conversation: {
        id: "conv-lc-guilherme",
        queueState: "automacao",
        operatorId: null,
        contactId: "cont-lc-guilherme",
      },
      recentMessages: [
        { id: "m1", senderType: "client", sentAt: "2026-11-25T11:16:00.000Z", content: "Whatsapp" },
        { id: "m2", senderType: "bot", sentAt: botAt, content: "Como posso te ajudar? Você busca por máquinas ou peças?" },
      ],
    });
    expect(silenceDecision.rescuePartialLead).toBe(false);
  });

  test("5. Debounce de 5s no Site, MCP channel='site' via conv-lc-% + ISO dates e prompt anti-gerência", () => {
    const debouncerCode = readRepoFile("src/lib/valentina/sdr-debouncer.ts");
    expect(debouncerCode).toContain("SITE_DEBOUNCE_DELAY_MS = 5000");
    expect(debouncerCode).toContain("isSiteConversationId(conversationId)");

    const mcpCode = readRepoFile("src/lib/mcp/valem-tecfag-mcp-core.ts");
    expect(mcpCode).toContain("conversation_id LIKE 'conv-lc-%' OR main_channel IN ('livechat', 'site')");
    expect(mcpCode).toContain("const startIso = dateWindow.startUtc ? dateWindow.startUtc.toISOString() : null;");
    expect(mcpCode).toContain("::timestamptz");

    const prompt = buildTecfagFagnerPrompt({
      aiPersona: {
        name: "Fagner",
        company: "Grupo Tecfag",
        segment: "Equipamentos industriais",
        tone: "consultivo",
        gender: "male",
        triagePolicy: "industrial",
      },
      knowledgeContext: "",
      conversationHistoryText: "",
      batchSummary: "preciso das peças da seladora",
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
    });
    expect(prompt).toContain("gerência comercial");
    expect(prompt).toContain("mantenha o subfluxo em PECAS");

    // Garantir que nenhuma regra de cross-channel hardcode nome de tenant
    const guardCode = readRepoFile("src/lib/livechat/site-cross-channel-guard.ts");
    expect(guardCode).not.toMatch(/["'](?:valem|tecfag)["']/);

    // Ponte Site→WhatsApp só trata como atendimento humano ativo quando NÃO estiver em `finalizados`
    // (conversas finalizadas preservam o último `operatorId` no histórico e devem receber o template Meta!)
    const handoffCode = readRepoFile("src/lib/livechat/site-whatsapp-handoff.ts");
    expect(handoffCode).toContain('if (waConv.queueState !== "finalizados" && waConv.operatorId !== null)');
  });
});
