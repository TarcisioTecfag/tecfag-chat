import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildIndustrialFollowUpText,
  buildIndustrialReactivationPatch,
  DEFAULT_INDUSTRIAL_SILENCE_CONFIG,
  evaluateIndustrialSilence,
  formatFirstNameTitleCase,
  parseIndustrialSilenceConfig,
} from "../src/lib/triage/industrial-silence-policy";
import {
  buildIndustrialFollowUpJudgePrompt,
  decideIndustrialFollowUpWithAi,
  INDUSTRIAL_FOLLOWUP_AI_MODEL,
  sanitizeIndustrialFollowUpMessage,
} from "../src/lib/triage/industrial-followup-ai";
import { classifySweepPendingBucket } from "../src/lib/triage/sdr-sweep";

describe("Evolução dos Follow-ups Industriais — Timing Inteligente + Personalização Contextual (Vertex AI)", () => {
  describe("Camada 1 — Hard Guards determinísticos (industrial-silence-policy)", () => {
    it("bloqueia follow-up em texto livre quando o cliente NUNCA respondeu no ciclo (template frio)", () => {
      const cycleStart = new Date("2026-11-25T12:00:00.000Z"); // 09:00 BRT
      const botTemplateAt = new Date("2026-11-25T12:01:00.000Z"); // 09:01 BRT
      const now = new Date("2026-11-25T13:30:00.000Z"); // 10:30 BRT (89 min depois)

      const dec = evaluateIndustrialSilence({
        now,
        withinSchedule: true,
        scheduleStartHour: 8,
        flow: {
          id: "fs-cold-tpl",
          tenantId: "tecfag",
          conversationId: "conv-wa-cold-1",
          startedAt: cycleStart,
          lastInteractionAt: botTemplateAt,
          outcome: "in_progress",
          currentStep: "Em Triagem",
          followUpStage: 0,
          collectedData: {},
          metadata: { followUpStage: 0 },
        },
        conversation: { id: "conv-wa-cold-1", queueState: "automacao", operatorId: null },
        recentMessages: [
          {
            id: "tpl-1",
            senderType: "bot",
            sentAt: botTemplateAt,
            content: "Olá! Recebemos seu cadastro no site da Tecfag. Como posso te ajudar?",
          },
        ],
      });

      expect(dec.action).toBe("none");
      expect(dec.reason).toBe("no_client_reply_in_cycle");
    });

    it("bloqueia follow-up em texto livre no WhatsApp quando a janela de 24h da Meta já expirou", () => {
      const cycleStart = new Date("2026-11-24T12:00:00.000Z");
      const clientAt = new Date("2026-11-24T12:05:00.000Z");
      const botAt = new Date("2026-11-24T12:06:00.000Z");
      // 23h50m depois da última msg do cliente (>= 1425 min)
      const now = new Date(clientAt.getTime() + 1430 * 60_000);

      const dec = evaluateIndustrialSilence({
        now,
        withinSchedule: true,
        scheduleStartHour: 8,
        flow: {
          id: "fs-24h",
          tenantId: "tecfag",
          conversationId: "conv-wa-24h",
          startedAt: cycleStart,
          lastInteractionAt: botAt,
          outcome: "in_progress",
          followUpStage: 0,
          collectedData: {},
          metadata: { followUpStage: 0 },
        },
        conversation: { id: "conv-wa-24h", queueState: "automacao", operatorId: null },
        recentMessages: [
          { id: "m1", senderType: "client", sentAt: clientAt, content: "Preciso de seladora" },
          { id: "m2", senderType: "bot", sentAt: botAt, content: "Qual produto você vai embalar?" },
        ],
      });

      expect(dec.action).toBe("none");
      expect(dec.reason).toBe("whatsapp_24h_window_expired");
    });

    it("aplica abertura suave pós-madrugada: segura às 08:00–08:29 BRT e libera às 08:30 BRT", () => {
      const cycleStart = new Date("2026-11-25T03:20:00.000Z"); // 00:20 BRT
      const clientAt = new Date("2026-11-25T03:23:00.000Z"); // 00:23 BRT
      const botAt = new Date("2026-11-25T03:24:00.000Z"); // 00:24 BRT

      const baseInput = {
        withinSchedule: true,
        scheduleStartHour: 8,
        flow: {
          id: "fs-madrugada",
          tenantId: "tecfag",
          conversationId: "conv-wa-madrugada",
          startedAt: cycleStart,
          lastInteractionAt: botAt,
          outcome: "in_progress",
          followUpStage: 0,
          collectedData: {},
          metadata: { followUpStage: 0 },
        },
        conversation: { id: "conv-wa-madrugada", queueState: "automacao", operatorId: null },
        recentMessages: [
          { id: "m1", senderType: "client", sentAt: clientAt, content: "Preciso de uma envasadora" },
          { id: "m2", senderType: "bot", sentAt: botAt, content: "Qual líquido e qual volume por dia?" },
        ],
      };

      // 08:00 BRT (11:00 UTC) -> segurado pela abertura suave
      const dec0800 = evaluateIndustrialSilence({
        ...baseInput,
        now: new Date("2026-11-25T11:00:00.000Z"),
      });
      expect(dec0800.action).toBe("none");
      expect(dec0800.reason).toBe("morning_soft_start_window");

      // 08:29 BRT (11:29 UTC) -> ainda segurado
      const dec0829 = evaluateIndustrialSilence({
        ...baseInput,
        now: new Date("2026-11-25T11:29:00.000Z"),
      });
      expect(dec0829.action).toBe("none");
      expect(dec0829.reason).toBe("morning_soft_start_window");

      // 08:30 BRT (11:30 UTC) -> liberado para avaliação e envio
      const dec0830 = evaluateIndustrialSilence({
        ...baseInput,
        now: new Date("2026-11-25T11:30:00.000Z"),
      });
      expect(dec0830.action).toBe("send_followup");
      expect(dec0830.nextStage).toBe(1);
    });

    it("aplica regra própria de sessão curta para Site (conv-lc-*): 1 toque entre 5–15 min e NUNCA horas depois", () => {
      const cycleStart = new Date("2026-11-25T13:00:00.000Z"); // 10:00 BRT
      const clientAt = new Date("2026-11-25T13:01:00.000Z");
      const botAt = new Date("2026-11-25T13:02:00.000Z");

      const makeSiteInput = (silenceMin: number, stage = 0) => ({
        now: new Date(botAt.getTime() + silenceMin * 60_000),
        withinSchedule: true,
        scheduleStartHour: 8,
        flow: {
          id: "fs-site-short",
          tenantId: "tecfag",
          conversationId: "conv-lc-site-short-1",
          startedAt: cycleStart,
          lastInteractionAt: botAt,
          outcome: "in_progress",
          followUpStage: stage,
          collectedData: {
            "NOME COMPLETO": { value: "BRUNA GABRIELE", status: "filled" },
            "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora", status: "filled" },
          },
          metadata: { followUpStage: stage },
        },
        conversation: { id: "conv-lc-site-short-1", queueState: "automacao", operatorId: null },
        recentMessages: [
          { id: "m1", senderType: "client", sentAt: clientAt, content: "Quero saber sobre seladora" },
          { id: "m2", senderType: "bot", sentAt: botAt, content: "O que você pretende embalar?" },
        ],
      });

      // 3 min -> ainda aguardando janela de 5 min
      expect(evaluateIndustrialSilence(makeSiteInput(3)).reason).toBe("waiting_site_followup_1_window");

      // 6 min -> libera 1 toque curto no site
      const at6m = evaluateIndustrialSilence(makeSiteInput(6));
      expect(at6m.action).toBe("send_followup");
      expect(at6m.nextStage).toBe(1);
      expect(at6m.reason).toBe("site_followup_1_due");

      // 35 min -> visitante já saiu da aba: NÃO envia follow-up tardio, mas ainda resgata lead parcial
      const at35m = evaluateIndustrialSilence(makeSiteInput(35));
      expect(at35m.action).toBe("none");
      expect(at35m.reason).toBe("site_session_expired_for_followup");
      expect(at35m.rescuePartialLead).toBe(true);

      // Stage 1 no site -> nunca dispara 2º follow-up no chat do site
      const atStage1 = evaluateIndustrialSilence(makeSiteInput(125, 1));
      expect(atStage1.action).toBe("none");
      expect(atStage1.reason).toBe("site_followup_stage_limit");
    });

    it("respeita supressão (skip_close) e adiamento (defer) gravados pela IA sem entrar em loop, e destrava se cliente responder", () => {
      const cycleStart = new Date("2026-11-25T12:00:00.000Z");
      const clientAt = new Date("2026-11-25T12:05:00.000Z");
      const botAt = new Date("2026-11-25T12:06:00.000Z");
      const judgedAt = new Date("2026-11-25T13:07:00.000Z");
      const laterNow = new Date("2026-11-25T14:00:00.000Z");

      // 1) Suprimido pela IA -> bloqueado no mesmo ciclo
      const suppressed = evaluateIndustrialSilence({
        now: laterNow,
        withinSchedule: true,
        flow: {
          id: "fs-sup",
          tenantId: "tecfag",
          conversationId: "conv-wa-sup",
          startedAt: cycleStart,
          lastInteractionAt: botAt,
          outcome: "in_progress",
          followUpStage: 0,
          metadata: {
            followUpStage: 0,
            followUpSuppressedCycle: cycleStart.toISOString(),
            followUpSuppressedAt: judgedAt.toISOString(),
            followUpAiDecision: "skip_close",
          },
        },
        conversation: { id: "conv-wa-sup", queueState: "automacao", operatorId: null },
        recentMessages: [
          { id: "m1", senderType: "client", sentAt: clientAt, content: "Obrigado, já resolvi por aqui" },
          { id: "m2", senderType: "bot", sentAt: botAt, content: "Certo, qualquer coisa pode contar conosco." },
        ],
      });
      expect(suppressed.action).toBe("none");
      expect(suppressed.reason).toBe("followup_suppressed_by_ai");

      // 2) Adiado pela IA até 15:00 UTC -> bloqueado às 14:00 e liberado às 15:05
      const deferredUntil = new Date("2026-11-25T15:00:00.000Z").toISOString();
      const deferFlow = {
        id: "fs-def",
        tenantId: "tecfag",
        conversationId: "conv-wa-def",
        startedAt: cycleStart,
        lastInteractionAt: botAt,
        outcome: "in_progress",
        followUpStage: 0,
        metadata: {
          followUpStage: 0,
          followUpDeferredCycle: cycleStart.toISOString(),
          followUpDeferredAt: judgedAt.toISOString(),
          followUpDeferredUntil: deferredUntil,
        },
      };
      const deferMsgs = [
        { id: "m1", senderType: "client", sentAt: clientAt, content: "Estou dirigindo, chego às 12h e te passo o CNPJ" },
        { id: "m2", senderType: "bot", sentAt: botAt, content: "Combinado, aguardo seu retorno com o CNPJ." },
      ];

      expect(
        evaluateIndustrialSilence({
          now: laterNow,
          withinSchedule: true,
          flow: deferFlow,
          conversation: { id: "conv-wa-def", queueState: "automacao", operatorId: null },
          recentMessages: deferMsgs,
        }).reason,
      ).toBe("followup_deferred_by_ai");

      expect(
        evaluateIndustrialSilence({
          now: new Date("2026-11-25T15:05:00.000Z"),
          withinSchedule: true,
          flow: deferFlow,
          conversation: { id: "conv-wa-def", queueState: "automacao", operatorId: null },
          recentMessages: deferMsgs,
        }).action,
      ).toBe("send_followup");

      // 3) Reativação limpa flags de supressão/adiamento quando o cliente volta a responder
      const patch = buildIndustrialReactivationPatch({
        outcome: "in_progress",
        followUpStage: 0,
        metadata: {
          followUpSuppressedCycle: cycleStart.toISOString(),
          followUpDeferredUntil: deferredUntil,
        },
      });
      expect(patch.shouldReactivate).toBe(true);
      expect(patch.metadata.followUpSuppressedCycle).toBeNull();
      expect(patch.metadata.followUpDeferredUntil).toBeNull();
    });

    it("normaliza primeiro nome em Title Case (BRUNA -> Bruna) e contextualiza fallback determinístico", () => {
      expect(formatFirstNameTitleCase("BRUNA GABRIELE DA SILVA")).toBe("Bruna");
      expect(formatFirstNameTitleCase("JOÃO-PEDRO")).toBe("João-Pedro");
      expect(formatFirstNameTitleCase("carlos")).toBe("Carlos");

      const fu1Cnpj = buildIndustrialFollowUpText({
        personaName: "Fagner",
        stage: 1,
        collectedData: {
          "NOME COMPLETO": { value: "BRUNA GABRIELE", status: "filled" },
          "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora a vácuo", status: "filled" },
        },
        metadata: { missingFields: ["CNPJ OU CPF"] },
      });
      expect(fu1Cnpj).toContain("Bruna");
      expect(fu1Cnpj).not.toContain("BRUNA");
      expect(fu1Cnpj).toMatch(/CNPJ/i);
      expect(fu1Cnpj).toMatch(/seladora a vácuo/i);

      const fu2Topic = buildIndustrialFollowUpText({
        personaName: "Fagner",
        stage: 2,
        collectedData: {
          "NOME COMPLETO": { value: "MARCOS SILVA", status: "filled" },
          "MÁQUINA / PEÇA / INTERESSE": { value: "Envasadora de líquidos", status: "filled" },
        },
      });
      expect(fu2Topic).toContain("Marcos");
      expect(fu2Topic).toMatch(/envasadora de líquidos/i);
      expect(fu2Topic).toMatch(/aberto/i);

      // Sweep reconhece despedidas personalizadas de estágio 2 sem falso positivo de awaiting_ai
      expect(
        classifySweepPendingBucket({
          monitoringState: "ready",
          lastMessageSender: "bot",
          lastMessageContent: fu2Topic,
        }),
      ).toBe("awaiting_client");

      // Defaults de configuração preservados e novos campos presentes
      const cfg = parseIndustrialSilenceConfig({});
      expect(cfg.morningSoftStartMinutes).toBe(DEFAULT_INDUSTRIAL_SILENCE_CONFIG.morningSoftStartMinutes);
      expect(cfg.metaWindowMinutes).toBe(1425);
      expect(cfg.aiDecisionEnabled).toBe(true);
    });
  });

  describe("Camada 2 — Juiz + Redator Gemini 2.5 Flash (industrial-followup-ai)", () => {
    const baseAiInput = {
      tenantId: "tecfag",
      conversationId: "conv-wa-lead-42",
      personaName: "Fagner",
      personaCompany: "Grupo Tecfag",
      personaGender: "male" as const,
      stage: 1 as const,
      channel: "whatsapp" as const,
      silenceMinutes: 65,
      now: new Date("2026-11-25T14:00:00.000Z"),
      subflow: "MAQUINAS",
      targetFunnel: "Máquinas",
      currentStep: "Em Qualificação",
      collectedData: {
        "NOME COMPLETO": { value: "CARLOS ALBERTO", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora a vácuo para carnes", status: "filled" },
      },
      missingFields: ["CNPJ OU CPF"],
      recentMessages: [
        { id: "1", senderType: "client", sentAt: "2026-11-25T12:50:00.000Z", content: "Oi, sou Carlos. Preciso de uma seladora a vácuo para cortes de carne, cerca de 400 pacotes/dia." },
        { id: "2", senderType: "bot", sentAt: "2026-11-25T12:55:00.000Z", content: "Perfeito, Carlos! Para eu encaminhar ao especialista com a proposta certa, pode me informar o CNPJ da empresa?" },
      ],
    };

    it("envia prompt com contexto completo, usa gemini-2.5-flash + feature sdr_agent + tenantId e retorna follow-up personalizado", async () => {
      let capturedModel = "";
      let capturedContext: any = null;
      let capturedPrompt = "";

      const res = await decideIndustrialFollowUpWithAi({
        ...baseAiInput,
        aiCaller: async (prompt, model, _signal, ctx) => {
          capturedPrompt = prompt;
          capturedModel = model || "";
          capturedContext = ctx;
          return {
            decision: "send",
            deferMinutes: null,
            reason: "Lead comercial qualificado aguardando apenas CNPJ",
            message:
              "Oi, CARLOS! Se estiver sem o CNPJ fácil agora, pode me mandar só o nome da empresa ou cidade que eu já adianto a cotação da seladora a vácuo com o especialista.",
          } as any;
        },
      });

      expect(capturedModel).toBe(INDUSTRIAL_FOLLOWUP_AI_MODEL);
      expect(capturedContext.feature).toBe("sdr_agent");
      expect(capturedContext.tenantId).toBe("tecfag");
      expect(capturedContext.generationConfig.thinkingBudget).toBe(0);
      expect(capturedPrompt).toContain("Seladora a vácuo para carnes");
      expect(capturedPrompt).toContain("CNPJ ou CPF");

      expect(res.decision).toBe("send");
      expect(res.source).toBe("gemini");
      // Nome em CAIXA ALTA corrigido automaticamente pelo sanitizer
      expect(res.message).toContain("Carlos");
      expect(res.message).not.toContain("CARLOS");
      expect(res.message).toContain("seladora a vácuo");
    });

    it("suprime follow-up (skip_close) quando o cliente recusou ou assunto já foi encerrado", async () => {
      const res = await decideIndustrialFollowUpWithAi({
        ...baseAiInput,
        recentMessages: [
          { id: "1", senderType: "client", sentAt: "2026-11-25T12:50:00.000Z", content: "Já comprei com outro fornecedor, obrigado!" },
          { id: "2", senderType: "bot", sentAt: "2026-11-25T12:51:00.000Z", content: "Entendido, agradecemos o retorno." },
        ],
        aiCaller: async () =>
          ({
            decision: "skip_close",
            deferMinutes: null,
            reason: "Cliente informou que já fechou com outro fornecedor",
            message: null,
          }) as any,
      });

      expect(res.decision).toBe("skip_close");
      expect(res.message).toBeNull();
      expect(res.source).toBe("gemini");
      expect(res.reason).toContain("outro fornecedor");
    });

    it("adia follow-up (defer) com clamp seguro quando cliente combinou retorno depois", async () => {
      const res = await decideIndustrialFollowUpWithAi({
        ...baseAiInput,
        aiCaller: async () =>
          ({
            decision: "defer",
            deferMinutes: 5000, // será limitado a 1440 min (24h)
            reason: "Cliente pediu para falar apenas amanhã",
            message: null,
          }) as any,
      });

      expect(res.decision).toBe("defer");
      expect(res.deferMinutes).toBe(1440);
      expect(res.message).toBeNull();
      expect(res.source).toBe("gemini");
    });

    it("guardrail bloqueia preço inventado e frase clichê genérica, degradando para fallback seguro", async () => {
      const priceGuard = sanitizeIndustrialFollowUpMessage(
        "Oi Carlos! A seladora sai por R$ 14.900 hoje, pode passar seu CNPJ?",
        { collectedData: baseAiInput.collectedData, recentMessages: baseAiInput.recentMessages, stage: 1 },
      );
      expect(priceGuard.valid).toBe(false);
      expect(priceGuard.rejectReason).toBe("invented_price_blocked");

      const genericGuard = sanitizeIndustrialFollowUpMessage(
        "Olá Carlos! Conseguiu ver minha última mensagem?",
        { collectedData: baseAiInput.collectedData, recentMessages: baseAiInput.recentMessages, stage: 1 },
      );
      expect(genericGuard.valid).toBe(false);
      expect(genericGuard.rejectReason).toBe("generic_phrase_blocked");

      // Quando a IA devolve erro ou preço inventado, decideIndustrialFollowUpWithAi faz fallback contextual limpo
      const fallbackRes = await decideIndustrialFollowUpWithAi({
        ...baseAiInput,
        aiCaller: async () => {
          throw new Error("Vertex 503");
        },
      });
      expect(fallbackRes.decision).toBe("send");
      expect(fallbackRes.source).toBe("fallback");
      expect(fallbackRes.message).toContain("Carlos");
      expect(fallbackRes.message).toMatch(/CNPJ/i);
    });

    it("preserva isolamento multi-tenant: sdr-followup-engine integra juiz apenas no fluxo industrial e mantém fluxo legado intacto", () => {
      const engineSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/valentina/sdr-followup-engine.ts"),
        "utf8",
      );
      expect(engineSrc).toContain("decideIndustrialFollowUpWithAi");
      expect(engineSrc).toContain("followUpSuppressedCycle");
      expect(engineSrc).toContain("followUpDeferredUntil");
      expect(engineSrc).toContain("followUpAiDecision");
      expect(engineSrc).toContain("private async runLegacyFollowupCycle(tenantId: string)");
      const prompt = buildIndustrialFollowUpJudgePrompt(baseAiInput);
      expect(prompt).toContain("Grupo Tecfag");
      expect(prompt).not.toContain("Valem");
    });
  });
});
