import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildIndustrialPostCloseReopenPatch,
  computeIndustrialReopenStartedAt,
} from "../src/lib/triage/industrial-ownership-guard";
import {
  evaluateIndustrialMetaWindowGuard,
  evaluateIndustrialTurnRecovery,
  shouldEscalateExhaustedIndustrialTurnRecovery,
} from "../src/lib/triage/industrial-silence-policy";

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

describe("Fagner P0 Wave 2 — JSONB 'null'::jsonb, Recovery Escalation, MARCELO context_changed e Hard Guard Meta 24h", () => {
  describe("1. Fix JSONB 'null'::jsonb + startedAt de reabertura (caso Edmo Luís)", () => {
    it("buildIndustrialPostCloseReopenPatch remove chaves handoffRequest/pendingApproval/turnRecovery do JSONB em vez de gravar null", () => {
      const patch = buildIndustrialPostCloseReopenPatch({
        collectedData: {
          "NOME COMPLETO": { value: "Edmo Luís", status: "filled" },
          EMPRESA: { value: "FORNECEDOR LTDA", status: "filled" },
          "MÁQUINA / PEÇA / INTERESSE": { value: "Parceria comercial", status: "filled" },
        },
        metadata: {
          targetFunnel: "Compras / Fornecedores",
          subflow: "5C_COMPRAS",
          handoffStatus: "resolved",
          handoffRequest: null,
          handoffReceipt: null,
          handoffOutbox: null,
          pendingApproval: { version: 1 },
          turnRecoveryMessageId: "msg-old",
          turnRecoveryAttempts: 3,
          turnRecoveryNextAttemptAt: "2026-11-26T18:10:00.000Z",
          turnRecoveryEscalatedMessageId: "msg-old",
          turnRecoveryEscalatedAt: "2026-11-26T18:12:00.000Z",
          turnRecoveryEscalationReason: "max_attempts_reached",
          metaWindowBlockedAt: "2026-11-26T18:12:00.000Z",
          metaWindowBlockedMessageId: "msg-old",
        },
        currentStep: "Concluído (Informativo)",
        startedAt: new Date("2026-11-26T17:49:29.000Z"),
        completedAt: new Date("2026-11-26T17:50:15.000Z"),
        now: new Date("2026-11-26T18:06:46.455Z"),
      });

      expect("handoffRequest" in patch.metadata).toBe(false);
      expect("handoffReceipt" in patch.metadata).toBe(false);
      expect("handoffOutbox" in patch.metadata).toBe(false);
      expect("pendingApproval" in patch.metadata).toBe(false);
      expect("turnRecoveryMessageId" in patch.metadata).toBe(false);
      expect("turnRecoveryAttempts" in patch.metadata).toBe(false);
      expect("turnRecoveryNextAttemptAt" in patch.metadata).toBe(false);
      expect("turnRecoveryEscalatedMessageId" in patch.metadata).toBe(false);
      expect("turnRecoveryEscalatedAt" in patch.metadata).toBe(false);
      expect("turnRecoveryEscalationReason" in patch.metadata).toBe(false);
      expect("metaWindowBlockedAt" in patch.metadata).toBe(false);
      expect("metaWindowBlockedMessageId" in patch.metadata).toBe(false);
      expect(patch.metadata.handoffStatus).toBe("collecting");
      expect(patch.collectedData["NOME COMPLETO"]?.value).toBe("Edmo Luís");
      expect(patch.collectedData["MÁQUINA / PEÇA / INTERESSE"]).toBeUndefined();
    });

    it("computeIndustrialReopenStartedAt preserva 1a msg do cliente mesmo com truncamento de segundo da Meta", () => {
      // Caso real Edmo Luís: completedAt 17:50:15, msg_in DB sentAt 18:06:45.000Z, receivedAt 18:06:47.455Z
      const edmoStart = computeIndustrialReopenStartedAt({
        batchEarliestMs: Date.parse("2026-11-26T18:06:47.455Z"),
        dbEarliestSentAtMs: Date.parse("2026-11-26T18:06:45.000Z"),
        previousCompletedAt: new Date("2026-11-26T17:50:15.000Z"),
      });
      expect(edmoStart.getTime()).toBeLessThanOrEqual(Date.parse("2026-11-26T18:06:45.000Z"));
      expect(edmoStart.getTime()).toBeGreaterThan(Date.parse("2026-11-26T17:50:15.000Z"));

      // Reabertura rápida 1s após encerramento: não invade o ciclo encerrado anterior, mas mantém <= sentAt
      const fastStart = computeIndustrialReopenStartedAt({
        batchEarliestMs: Date.parse("2026-11-26T18:06:46.200Z"),
        dbEarliestSentAtMs: Date.parse("2026-11-26T18:06:45.000Z"),
        previousCompletedAt: new Date("2026-11-26T18:06:44.000Z"),
      });
      expect(fastStart.toISOString()).toBe("2026-11-26T18:06:44.001Z");
      expect(fastStart.getTime()).toBeLessThanOrEqual(Date.parse("2026-11-26T18:06:45.000Z"));

      // Truncamento sub-segundo da Meta (sentAt 18:06:45.000 <= completedAt 18:06:45.300)
      const subSecStart = computeIndustrialReopenStartedAt({
        batchEarliestMs: Date.parse("2026-11-26T18:06:46.100Z"),
        dbEarliestSentAtMs: Date.parse("2026-11-26T18:06:45.000Z"),
        previousCompletedAt: new Date("2026-11-26T18:06:45.300Z"),
      });
      expect(subSecStart.toISOString()).toBe("2026-11-26T18:06:45.000Z");
    });
  });

  describe("2. Escalação automática ao esgotar tentativas no Recovery", () => {
    it("escala uma única vez por mensagem quando atinge max_attempts_reached e destrava se cliente mandar nova msg", () => {
      const now = new Date("2026-11-26T18:20:00.000Z");
      const exhaustedDecision = evaluateIndustrialTurnRecovery({
        now,
        isDebouncerBusy: false,
        conversation: { id: "conv-1", queueState: "automacao", operatorId: null },
        flow: {
          id: "fs-1",
          startedAt: new Date("2026-11-26T18:06:40.000Z"),
          outcome: "in_progress",
          completedAt: null,
          metadata: {
            turnRecoveryMessageId: "msg-client-1",
            turnRecoveryAttempts: 3,
            turnRecoveryNextAttemptAt: "2026-11-26T18:10:00.000Z",
          },
        },
        recentMessages: [
          {
            id: "msg-client-1",
            senderType: "client",
            sentAt: new Date("2026-11-26T18:06:45.000Z"),
            content: "Comercial",
          },
        ],
      });

      expect(exhaustedDecision.shouldRecover).toBe(false);
      expect(exhaustedDecision.reason).toBe("max_attempts_reached");

      expect(
        shouldEscalateExhaustedIndustrialTurnRecovery(exhaustedDecision, {
          handoffStatus: "collecting",
          turnRecoveryMessageId: "msg-client-1",
          turnRecoveryAttempts: 3,
        }),
      ).toBe(true);

      // Idempotência para a mesma mensagem já escalada
      expect(
        shouldEscalateExhaustedIndustrialTurnRecovery(exhaustedDecision, {
          handoffStatus: "collecting",
          turnRecoveryEscalatedMessageId: "msg-client-1",
        }),
      ).toBe(false);

      // Nunca escala se já está em awaiting_approval
      expect(
        shouldEscalateExhaustedIndustrialTurnRecovery(exhaustedDecision, {
          handoffStatus: "awaiting_approval",
          pendingApproval: { version: 1 },
        }),
      ).toBe(false);

      // Se uma nova mensagem do cliente chegar depois, volta a recuperar normalmente (attempt 1)
      const nextMsgDecision = evaluateIndustrialTurnRecovery({
        now,
        isDebouncerBusy: false,
        conversation: { id: "conv-1", queueState: "automacao", operatorId: null },
        flow: {
          id: "fs-1",
          startedAt: new Date("2026-11-26T18:06:40.000Z"),
          outcome: "in_progress",
          completedAt: null,
          metadata: {
            turnRecoveryMessageId: "msg-client-1",
            turnRecoveryAttempts: 3,
            turnRecoveryEscalatedMessageId: "msg-client-1",
          },
        },
        recentMessages: [
          {
            id: "msg-client-1",
            senderType: "client",
            sentAt: new Date("2026-11-26T18:06:45.000Z"),
            content: "Comercial",
          },
          {
            id: "msg-client-2",
            senderType: "client",
            sentAt: new Date("2026-11-26T18:18:00.000Z"),
            content: "Alguem ai?",
          },
        ],
      });
      expect(nextMsgDecision.shouldRecover).toBe(true);
      expect(nextMsgDecision.lastClientMessageId).toBe("msg-client-2");
      expect(nextMsgDecision.nextAttemptNumber).toBe(1);
    });
  });

  describe("3. Hard Guard Pré-IA para Janela de 24h Meta (isolado por tenant/canal)", () => {
    it("bloqueia apenas WhatsApp Meta fora da janela 24h em tenant industrial, preservando Valem/Site/Baileys", () => {
      expect(
        evaluateIndustrialMetaWindowGuard({
          isIndustrial: true,
          isSiteConversation: false,
          activeProvider: "meta",
          metaWindowOpen: false,
          metaWindowExpiresAt: "2026-11-20T12:00:00.000Z",
        }),
      ).toEqual({ blocked: true, reason: "meta_24h_window_closed" });

      expect(
        evaluateIndustrialMetaWindowGuard({
          isIndustrial: true,
          isSiteConversation: false,
          activeProvider: "meta",
          metaWindowOpen: true,
        }),
      ).toEqual({ blocked: false, reason: null });

      expect(
        evaluateIndustrialMetaWindowGuard({
          isIndustrial: true,
          isSiteConversation: true,
          activeProvider: "meta",
          metaWindowOpen: false,
        }),
      ).toEqual({ blocked: false, reason: null });

      expect(
        evaluateIndustrialMetaWindowGuard({
          isIndustrial: true,
          isSiteConversation: false,
          activeProvider: "baileys",
          metaWindowOpen: false,
        }),
      ).toEqual({ blocked: false, reason: null });

      expect(
        evaluateIndustrialMetaWindowGuard({
          isIndustrial: false,
          isSiteConversation: false,
          activeProvider: "meta",
          metaWindowOpen: false,
        }),
      ).toEqual({ blocked: false, reason: null });
    });
  });

  describe("4. Invariantes estruturais nos módulos do servidor", () => {
    it("queries JSONB tratam 'null'::jsonb com segurança e prepareIndustrialApproval não grava handoffRequest: null", () => {
      const sdrEngineSrc = readSource("src/lib/valentina/sdr-engine.ts");
      const handoffRecoverySrc = readSource("src/lib/triage/industrial-handoff-recovery.ts");
      const monitorStoreSrc = readSource("src/lib/triage/agent-monitor-store.ts");
      const approvalStoreSrc = readSource("src/lib/triage/industrial-approval-store.ts");

      expect(sdrEngineSrc).toContain("->'handoffRequest' = 'null'::jsonb");
      expect(sdrEngineSrc).toContain("persistCollection não atualizou agentFlowStates");
      expect(handoffRecoverySrc).toContain("jsonb_typeof(");
      expect(handoffRecoverySrc).toContain("->'handoffReceipt' = 'null'::jsonb");
      expect(handoffRecoverySrc).toContain("<> 'null'::jsonb");
      expect(monitorStoreSrc).toContain("->'dismissedBy' = 'null'::jsonb");
      expect(approvalStoreSrc).not.toMatch(/handoffRequest:\s*null/);
    });

    it("sdr-engine.ts e industrial-outbound.ts previnem context_changed em turno terminal e ordenam agentFlowStates", () => {
      const sdrEngineSrc = readSource("src/lib/valentina/sdr-engine.ts");
      const outboundSrc = readSource("src/lib/valentina/industrial-outbound.ts");

      expect(sdrEngineSrc).toContain("[dDesc(t.startedAt), dDesc(t.id)]");
      expect(sdrEngineSrc).toContain("computeIndustrialReopenStartedAt");
      expect(sdrEngineSrc).toContain("evaluateIndustrialMetaWindowGuard");
      expect(sdrEngineSrc).toContain("isTerminalIndustrialTurn");
      expect(sdrEngineSrc).toContain("escalateIndustrialFlowToHumanReview");
      expect(outboundSrc).toContain("input.context.triggerIds.length > 0");
    });

    it("sdr-recovery.ts ordena flow mais recente, encerra Site órfão, escala failed/max_attempts e checa janela Meta 24h", () => {
      const sdrRecoverySrc = readSource("src/lib/valentina/sdr-recovery.ts");

      expect(sdrRecoverySrc).toContain("[dDesc(t.startedAt), dDesc(t.id)]");
      expect(sdrRecoverySrc).toContain("findActiveWhatsappSessionForSiteContact");
      expect(sdrRecoverySrc).toContain("delivery_failed_or_unknown");
      expect(sdrRecoverySrc).toContain("shouldEscalateExhaustedIndustrialTurnRecovery");
      expect(sdrRecoverySrc).toContain("max_attempts_reached");
      expect(sdrRecoverySrc).toContain("meta_24h_window_closed");
      expect(sdrRecoverySrc).toContain("escalateIndustrialFlowToHumanReview");
    });

    it("industrial-recovery-escalation.ts respeita estritamente triagePolicy === 'industrial' e tenantId sem hardcode", () => {
      const escalationSrc = readSource("src/lib/triage/industrial-recovery-escalation.ts");

      expect(escalationSrc).toContain('triagePolicy !== "industrial"');
      expect(escalationSrc).toContain("eq(conversations.tenantId, tenantId)");
      expect(escalationSrc).toContain("eq(agentFlowStates.tenantId, tenantId)");
      expect(escalationSrc).not.toMatch(/["']tecfag["']|["']valem["']/);
    });
  });
});
