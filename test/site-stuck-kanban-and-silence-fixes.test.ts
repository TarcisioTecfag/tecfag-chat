import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  classifySessionToColumn,
  type SdrTriageSession,
} from "../src/components/valentina/sdr-kanban-data";
import {
  DEFAULT_INDUSTRIAL_SILENCE_CONFIG,
  evaluateIndustrialSilence,
  parseIndustrialSilenceConfig,
} from "../src/lib/triage/industrial-silence-policy";
import {
  SITE_WA_BRIDGE_RECOVERY_MAX_AGE_MS,
  SITE_WA_BRIDGE_RECOVERY_MIN_AGE_MS,
  isTransientPgTransactionError,
  runSiteHandoffStep6WithRetry,
  shouldRecoverPendingSiteWhatsappBridge,
} from "../src/lib/livechat/site-whatsapp-handoff";

const readRepoFile = (relPath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");

function makeSession(overrides: Partial<SdrTriageSession>): SdrTriageSession {
  return {
    id: "fs-site-test",
    conversationId: "conv-lc-test-1",
    contactName: "Visitante Teste",
    company: "Empresa Teste",
    phone: "5511999999999",
    currentStep: "Em Qualificação",
    collectedData: {},
    startedAt: "2026-11-26T15:00:00.000Z",
    status: "active",
    outcome: "in_progress",
    messages: [],
    ...overrides,
  };
}

describe("Correções de Leads Travados no Canal Site (Kanban, Silêncio Zumbi e Ponte Site→WA)", () => {
  describe("Fix 1: Precedência de SEM RESPOSTA no Kanban e cancel_by_human", () => {
    it("roteia sessões abandonadas para sem_resposta mesmo quando funnelStage anterior era maquinas/triagem/pos_venda", () => {
      // Repro exata dos cards do print: abdul (triagem), Evani Simoes (maquinas), fernando (maquinas)
      expect(
        classifySessionToColumn(
          makeSession({
            contactName: "abdul",
            status: "abandoned",
            outcome: "abandoned",
            funnelStage: "triagem",
          }),
        ),
      ).toBe("sem_resposta");

      expect(
        classifySessionToColumn(
          makeSession({
            contactName: "Evani Simoes",
            status: "abandoned",
            outcome: "abandoned",
            funnelStage: "maquinas",
          }),
        ),
      ).toBe("sem_resposta");

      expect(
        classifySessionToColumn(
          makeSession({
            contactName: "fernando",
            status: "abandoned",
            outcome: "abandoned",
            funnelStage: "maquinas",
            currentStep: "Sem Resposta",
          }),
        ),
      ).toBe("sem_resposta");

      expect(
        classifySessionToColumn(
          makeSession({
            status: "active",
            outcome: "in_progress",
            funnelStage: "pos_venda",
            currentStep: "Sem Resposta",
          }),
        ),
      ).toBe("sem_resposta");
    });

    it("preserva sessões ativas em seus funis e encerramentos informativos (5B_CURRICULO / 5C_COMPRAS) em outros", () => {
      expect(
        classifySessionToColumn(
          makeSession({
            status: "active",
            outcome: "in_progress",
            funnelStage: "maquinas",
          }),
        ),
      ).toBe("maquinas");

      expect(
        classifySessionToColumn(
          makeSession({
            contactName: "BRUNA GABRIELE DA SILVA",
            status: "completed",
            outcome: "completed",
            subflow: "5B_CURRICULO",
            currentStep: "Concluído (Informativo)",
            funnelStage: "outros",
          }),
        ),
      ).toBe("outros");
    });

    it("contrato: cancel_by_human em sdr-followup-engine atualiza funnelStage para sem_resposta quando abandonado", () => {
      const followupSrc = readRepoFile("src/lib/valentina/sdr-followup-engine.ts");
      expect(followupSrc).toContain('if (decision.action === "cancel_by_human")');
      expect(followupSrc).toContain(
        'const movedToHuman = conv?.queueState === "meus" || Boolean(conv?.operatorId);',
      );
      expect(followupSrc).toContain('currentStep: "Sem Resposta"');
      expect(followupSrc).toContain('funnelStage: "sem_resposta"');
      expect(followupSrc).toContain("preSilenceFunnelStage: preSilenceStage");
    });
  });

  describe("Fix 2: Política de Silêncio do Site (elimina sessões zumbi infinitas) e fechamento limpo", () => {
    it("expõe siteNoResponseMinutes padrão 180 min com clamp seguro [30..1440]", () => {
      expect(DEFAULT_INDUSTRIAL_SILENCE_CONFIG.siteNoResponseMinutes).toBe(180);
      expect(parseIndustrialSilenceConfig({}).siteNoResponseMinutes).toBe(180);
      expect(
        parseIndustrialSilenceConfig({ siteNoResponseMinutes: 240 }).siteNoResponseMinutes,
      ).toBe(240);
      expect(parseIndustrialSilenceConfig({ siteNoResponseMinutes: 5 }).siteNoResponseMinutes).toBe(
        30,
      );
      expect(
        parseIndustrialSilenceConfig({ siteNoResponseMinutes: 9999 }).siteNoResponseMinutes,
      ).toBe(1440);
    });

    it("encerra automaticamente sessões zumbi do Site após 180 min dentro ou fora do expediente (João Batista, Marinaldo, Leandro, Sonia)", () => {
      const makeSiteFlow = (params: {
        botAtIso: string;
        nowIso: string;
        withinSchedule: boolean;
        stage?: number;
        lastFollowUpStage?: number;
      }) => {
        const botAt = new Date(params.botAtIso);
        const cycleStart = new Date(botAt.getTime() - 2 * 60_000);
        const clientAt = new Date(botAt.getTime() - 1 * 60_000);
        return evaluateIndustrialSilence({
          now: new Date(params.nowIso),
          withinSchedule: params.withinSchedule,
          scheduleStartHour: 8,
          flow: {
            id: "fs-site-zombie",
            tenantId: "tenant-a",
            conversationId: "conv-lc-zombie-1",
            startedAt: cycleStart,
            lastInteractionAt: botAt,
            outcome: "in_progress",
            followUpStage: params.stage ?? 0,
            collectedData: {
              "NOME COMPLETO": { value: "João Batista", status: "filled" },
              "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora a vácuo", status: "filled" },
            },
            metadata: {
              followUpStage: params.stage ?? 0,
              ...(params.lastFollowUpStage
                ? {
                    lastFollowUpCycle: cycleStart.toISOString(),
                    lastFollowUpStage: params.lastFollowUpStage,
                  }
                : {}),
            },
          },
          conversation: { id: "conv-lc-zombie-1", queueState: "automacao", operatorId: null },
          recentMessages: [
            {
              id: "m1",
              senderType: "client",
              sentAt: clientAt,
              content: "Quero uma seladora a vácuo",
            },
            {
              id: "m2",
              senderType: "bot",
              sentAt: botAt,
              content: "Qual seria o seu volume diário?",
            },
          ],
        });
      };

      // 1) João Batista: 11:37 BRT → 14:38 BRT (181 min, dentro do expediente, stage=0)
      const joao = makeSiteFlow({
        botAtIso: "2026-11-26T14:37:00.000Z", // 11:37 BRT
        nowIso: "2026-11-26T17:38:00.000Z", // 14:38 BRT
        withinSchedule: true,
      });
      expect(joao.action).toBe("mark_no_response");
      expect(joao.nextStage).toBe(3);
      expect(joao.reason).toBe("site_session_no_response_timeout");
      expect(joao.rescuePartialLead).toBe(true);

      // 2) Leandro / Sonia: 20:22 BRT → 23:25 BRT (183 min, FORA do expediente, stage=0)
      const leandro = makeSiteFlow({
        botAtIso: "2026-11-26T23:22:00.000Z", // 20:22 BRT
        nowIso: "2026-11-27T02:25:00.000Z", // 23:25 BRT
        withinSchedule: false,
      });
      expect(leandro.action).toBe("mark_no_response");
      expect(leandro.reason).toBe("site_session_no_response_timeout");

      // 3) Marinaldo: recebeu FU1, respondeu, followUpStage resetou p/ 0 mas lastFollowUpStage=1, ficou 3h+ mudo
      const marinaldo = makeSiteFlow({
        botAtIso: "2026-11-26T19:15:00.000Z", // 16:15 BRT
        nowIso: "2026-11-26T22:20:00.000Z", // 19:20 BRT
        withinSchedule: false,
        stage: 0,
        lastFollowUpStage: 1,
      });
      expect(marinaldo.action).toBe("mark_no_response");
      expect(marinaldo.reason).toBe("site_session_no_response_timeout");

      // 4) Fim do dia (20:05 BRT) com 90 min de silêncio (>= followUp1Minutes) e stage=0 fecha em end_of_day
      const eodStale = makeSiteFlow({
        botAtIso: "2026-11-26T21:35:00.000Z", // 18:35 BRT
        nowIso: "2026-11-26T23:05:00.000Z", // 20:05 BRT
        withinSchedule: false,
      });
      expect(eodStale.action).toBe("mark_no_response");
      expect(eodStale.reason).toBe("end_of_day_no_response");

      // 5) Visitante que acabou de entrar às 20:05 BRT com apenas 16 min de silêncio NÃO é encerrado prematuramente
      const freshEvening = makeSiteFlow({
        botAtIso: "2026-11-26T23:05:00.000Z", // 20:05 BRT
        nowIso: "2026-11-26T23:21:00.000Z", // 20:21 BRT (16 min)
        withinSchedule: false,
      });
      expect(freshEvening.action).toBe("none");
      expect(freshEvening.reason).toBe("outside_business_schedule");

      // 6) Janela intermediária (35 min e 125 min stage=1) preserva contrato existente
      const at35m = makeSiteFlow({
        botAtIso: "2026-11-26T13:00:00.000Z",
        nowIso: "2026-11-26T13:35:00.000Z",
        withinSchedule: true,
      });
      expect(at35m.action).toBe("none");
      expect(at35m.reason).toBe("site_session_expired_for_followup");
      expect(at35m.rescuePartialLead).toBe(true);

      const at125mStage1 = makeSiteFlow({
        botAtIso: "2026-11-26T13:00:00.000Z",
        nowIso: "2026-11-26T15:05:00.000Z",
        withinSchedule: true,
        stage: 1,
      });
      expect(at125mStage1.action).toBe("none");
      expect(at125mStage1.reason).toBe("site_followup_stage_limit");
    });

    it("NÃO aplica siteNoResponseMinutes em conversas WhatsApp (comportamento WhatsApp intacto)", () => {
      const botAt = new Date("2026-11-26T21:00:00.000Z"); // 18:00 BRT
      const res = evaluateIndustrialSilence({
        now: new Date("2026-11-27T01:00:00.000Z"), // 22:00 BRT (240 min fora do expediente, stage=0)
        withinSchedule: false,
        flow: {
          id: "fs-wa-1",
          tenantId: "tenant-a",
          conversationId: "conv-1795718252393-wa1",
          startedAt: new Date("2026-11-26T20:55:00.000Z"),
          lastInteractionAt: botAt,
          outcome: "in_progress",
          followUpStage: 0,
          metadata: { followUpStage: 0 },
        },
        conversation: { id: "conv-1795718252393-wa1", queueState: "automacao", operatorId: null },
        recentMessages: [
          {
            id: "m1",
            senderType: "client",
            sentAt: new Date("2026-11-26T20:58:00.000Z"),
            content: "Olá",
          },
          { id: "m2", senderType: "bot", sentAt: botAt, content: "Qual seu CNPJ?" },
        ],
      });
      expect(res.action).toBe("none");
      expect(res.reason).toBe("outside_business_schedule");
    });

    it("contrato: markIndustrialNoResponse e sdr-engine finalizam conversa e lc_chats apenas para Site (conv-lc-*)", () => {
      const silenceStore = readRepoFile("src/lib/triage/industrial-silence-store.ts");
      expect(silenceStore).toContain("if (isSiteConversationId(conversationId))");
      expect(silenceStore).toContain('queueState: "finalizados"');
      expect(silenceStore).toContain("lcChats");
      expect(silenceStore).toContain('status: "closed"');

      const sdrEngine = readRepoFile("src/lib/valentina/sdr-engine.ts");
      expect(sdrEngine).toContain("(isClientDeclinedTurn || isCordialBotClosingTurn)");
      expect(sdrEngine).toContain("Encerramento Site");
    });
  });

  describe("Fix 3: Resiliência do Step 6 da Ponte Site → WhatsApp e auto-recuperação pós-deploy (caso Marcelo)", () => {
    it("identifica erros transitórios de transação PostgreSQL e faz retry idempotente no Step 6", async () => {
      expect(isTransientPgTransactionError({ code: "40P01" })).toBe(true);
      expect(isTransientPgTransactionError({ cause: { code: "40001" } })).toBe(true);
      expect(isTransientPgTransactionError({ code: "57P01" })).toBe(true);
      expect(isTransientPgTransactionError({ message: "deadlock detected while updating" })).toBe(
        true,
      );
      expect(isTransientPgTransactionError({ code: "23505", message: "unique violation" })).toBe(
        false,
      );
      expect(isTransientPgTransactionError(new Error("validation error"))).toBe(false);

      let attempts = 0;
      const recovered = await runSiteHandoffStep6WithRetry(
        async () => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
          }
          return "ok";
        },
        { maxAttempts: 2, retryDelayMs: 0 },
      );
      expect(recovered).toBe("ok");
      expect(attempts).toBe(2);

      let fatalAttempts = 0;
      await expect(
        runSiteHandoffStep6WithRetry(
          async () => {
            fatalAttempts += 1;
            throw new Error("constraint violation");
          },
          { maxAttempts: 3, retryDelayMs: 0 },
        ),
      ).rejects.toThrow("constraint violation");
      expect(fatalAttempts).toBe(1);
    });

    it("detecta checkpoint pendente de ponte interrompida apenas na janela segura [45s..24h] e ignora ciclos concluídos", () => {
      const nowMs = Date.parse("2026-11-26T18:40:00.000Z");
      const basePending = {
        waConversationId: "conv-1795718252393-59c5e5",
        cycle: "2026-11-26T18:30:00.000Z",
        templateName: "fagner_site_continuacao_v1",
        idempotencyKey: "site-wa-handoff:tenant-a:conv-lc-1:2026-11-26T18:30:00.000Z",
        hasActiveHuman: false,
        startedAt: new Date(nowMs - SITE_WA_BRIDGE_RECOVERY_MIN_AGE_MS - 5_000).toISOString(),
        route: {
          subflow: "POS_VENDA",
          funnelStage: "pos_venda",
          targetFunnel: "Pós-Venda",
          needsReview: false,
          reason: "pos_venda",
        },
        clientName: "MARCELO",
        companyName: "Empresa X",
        contactId: "cont-1",
      };

      // Janela válida (50s após início) -> recupera
      const detected = shouldRecoverPendingSiteWhatsappBridge(
        { handoffStatus: "collecting", siteWhatsappBridgePending: basePending },
        nowMs,
      );
      expect(detected?.waConversationId).toBe("conv-1795718252393-59c5e5");

      // Muito recente (10s) -> não disputa com requisição em andamento
      expect(
        shouldRecoverPendingSiteWhatsappBridge(
          {
            handoffStatus: "collecting",
            siteWhatsappBridgePending: {
              ...basePending,
              startedAt: new Date(nowMs - 10_000).toISOString(),
            },
          },
          nowMs,
        ),
      ).toBeNull();

      // Já concluído -> ignora
      expect(
        shouldRecoverPendingSiteWhatsappBridge(
          { handoffStatus: "continued_to_whatsapp", siteWhatsappBridgePending: basePending },
          nowMs,
        ),
      ).toBeNull();

      // Expirado (>24h) -> ignora
      expect(
        shouldRecoverPendingSiteWhatsappBridge(
          {
            handoffStatus: "collecting",
            siteWhatsappBridgePending: {
              ...basePending,
              startedAt: new Date(nowMs - SITE_WA_BRIDGE_RECOVERY_MAX_AGE_MS - 1_000).toISOString(),
            },
          },
          nowMs,
        ),
      ).toBeNull();
    });

    it("contrato: checkpoint gravado ANTES do template Meta, limpo no Step 6, e recuperado automaticamente no SdrFollowupEngine", () => {
      const handoffSrc = readRepoFile("src/lib/livechat/site-whatsapp-handoff.ts");
      const checkpointIdx = handoffSrc.indexOf("siteWhatsappBridgePending: bridgeCheckpoint");
      const sendIdx = handoffSrc.indexOf("outboundQueue.enqueueAndSend(");
      const retryIdx = handoffSrc.indexOf("runSiteHandoffStep6WithRetry(");
      const clearIdx = handoffSrc.indexOf("siteWhatsappBridgePending: null,");

      expect(checkpointIdx).toBeGreaterThan(0);
      expect(sendIdx).toBeGreaterThan(checkpointIdx);
      expect(retryIdx).toBeGreaterThan(sendIdx);
      expect(clearIdx).toBeGreaterThan(retryIdx);

      const followupSrc = readRepoFile("src/lib/valentina/sdr-followup-engine.ts");
      const recIdx = followupSrc.indexOf("recoverInterruptedSiteWhatsappBridge(");
      const crossIdx = followupSrc.indexOf("findActiveWhatsappSessionForSiteContact(");
      expect(recIdx).toBeGreaterThan(0);
      expect(crossIdx).toBeGreaterThan(recIdx);

      // Isolamento multi-tenant: nenhum dos módulos alterados hardcodeia tenant
      for (const file of [
        "src/lib/triage/industrial-silence-policy.ts",
        "src/lib/triage/industrial-silence-store.ts",
        "src/lib/livechat/site-whatsapp-handoff.ts",
      ]) {
        const code = readRepoFile(file);
        expect(code).not.toMatch(/["'](?:valem|tecfag)["']/);
      }
    });
  });
});
