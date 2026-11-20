import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { buildTemplatePayloadFromRecord } from "../src/lib/rd-marketing/sdr-template-dispatch";
import {
  INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE,
  industrialHandoffMessage,
  industrialHandoffOutcome,
} from "../src/lib/triage/industrial-handoff";
import { projectIndustrialMonitoring } from "../src/lib/triage/industrial-monitor";
import {
  evaluateIndustrialSilence,
  evaluateIndustrialTurnRecovery,
} from "../src/lib/triage/industrial-silence-policy";
import { resolveFaithfulSdrStatus } from "../src/routes/api/valentina/sdr";
import {
  DEFAULT_SDR_FILTER_STATE,
  filterSdrSessions,
  hasActiveSdrFilters,
} from "../src/components/valentina/sdr-kanban-data";
import type { SdrTriageSession } from "../src/components/valentina/SdrTab";

const readRepoFile = (relPath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");

describe("Fagner SDR Go-Live — Human-in-the-Loop, Funil CWR e Template RD Marketing", () => {
  test("buildTemplatePayloadFromRecord preenche {{1}} com primeiro nome, operator_name e fallback seguro", () => {
    const withLeadName = buildTemplatePayloadFromRecord({
      template: {
        name: "apresentacao2",
        language: "pt_BR",
        bodyText: "Olá {{1}}, tudo bem? Sou o {{2}} da Tecfag e recebi seu cadastro!",
        bindings: { "1": "customer_name", "2": "operator_name" },
      },
      clientName: "João Carlos da Silva",
      personaName: "Fagner",
    });

    expect(withLeadName.templateComponents).toHaveLength(1);
    expect(withLeadName.templateComponents?.[0].parameters[0].text).toBe("João");
    expect(withLeadName.templateComponents?.[0].parameters[1].text).toBe("Fagner");
    expect(withLeadName.renderedText).toBe(
      "Olá João, tudo bem? Sou o Fagner da Tecfag e recebi seu cadastro!",
    );

    const withFallback = buildTemplatePayloadFromRecord({
      template: {
        name: "apresentacao2",
        language: "pt_BR",
        bodyText: "Olá {{1}}, tudo bem?",
      },
      clientName: "Contato WhatsApp",
      personaName: "Fagner",
    });
    expect(withFallback.templateComponents?.[0].parameters[0].text).toBe("cliente");
    expect(withFallback.renderedText).toBe("Olá cliente, tudo bem?");

    const noVariables = buildTemplatePayloadFromRecord({
      template: {
        name: "apresentacao_simples",
        language: "pt_BR",
        bodyText: "Olá! Recebemos sua solicitação na Tecfag.",
      },
      clientName: "Maria",
      personaName: "Fagner",
    });
    expect(noVariables.templateComponents).toBeUndefined();
    expect(noVariables.renderedText).toBe("Olá! Recebemos sua solicitação na Tecfag.");
  });

  test("industrialHandoffMessage suporta awaiting_approval neutro e aviso fora de horário na transferência", () => {
    const awaitingMsg = industrialHandoffMessage("awaiting_approval", "Consultor X");
    expect(awaitingMsg).toBe(INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE);
    expect(awaitingMsg).not.toContain("Consultor X");
    expect(industrialHandoffOutcome("awaiting_approval")).toBe("in_progress");

    const transferredWithOffHours = industrialHandoffMessage("transferred", "Mariana", {
      offHoursNotice:
        "Estamos fora do horário comercial no momento, mas nosso time retornará no próximo dia útil.",
    });
    expect(transferredWithOffHours).toContain("Mariana");
    expect(transferredWithOffHours).toContain("fora do horário comercial");
    expect(industrialHandoffOutcome("transferred")).toBe("transferred");
  });

  test("projectIndustrialMonitoring projeta awaiting_approval e pendingApproval sem marcar como transferido", () => {
    const monitoring = projectIndustrialMonitoring(
      {
        outcome: "in_progress",
        startedAt: "2026-11-20T12:00:00.000Z",
        metadata: {
          handoffStatus: "awaiting_approval",
          readyForHandoff: true,
          subflow: "maquinas",
          targetFunnel: "FUNIL MÁQUINAS",
          pendingApproval: {
            cycle: "2026-11-20T12:00:00.000Z",
            preparedAt: "2026-11-20T12:05:00.000Z",
            subflow: "maquinas",
            targetFunnel: "FUNIL MÁQUINAS",
            suggestedSectorId: "sec-comercial",
            suggestedSectorName: "Comercial",
            suggestedOperatorId: "op-42",
            suggestedOperatorName: "Carlos Vendedor",
            suggestedPipelineId: "pipe-maquinas",
            suggestedPipelineName: "FUNIL MÁQUINAS",
            suggestedStageId: "stage-novo",
            suggestedStageName: "ATENDER",
            suggestionReason: "rodizio_eligible",
            clientName: "Pedro Alves",
            companyName: "Indústria Alves",
          },
        },
      },
      {
        queueState: "automacao",
        operatorId: null,
      },
    );

    expect(monitoring.state).toBe("awaiting_approval");
    expect(monitoring.label).toBe("Aguardando aprovação SDR");
    expect(monitoring.operatorId).toBeNull();
    expect(monitoring.pendingApproval?.suggestedOperatorName).toBe("Carlos Vendedor");
    expect(monitoring.pendingApproval?.suggestedPipelineName).toBe("FUNIL MÁQUINAS");
    expect(monitoring.pendingApproval?.suggestedStageName).toBe("ATENDER");
  });

  test("política de silêncio e recuperação de turno pausam quando aguardando aprovação SDR e reconhecem conv-lc-", () => {
    const now = new Date("2026-11-20T18:00:00.000Z");

    const silenceDecision = evaluateIndustrialSilence({
      now,
      withinSchedule: true,
      conversation: {
        id: "conv-wa-1",
        queueState: "automacao",
        operatorId: null,
      },
      flow: {
        id: "flow-1",
        tenantId: "tenant-test",
        conversationId: "conv-wa-1",
        outcome: "in_progress",
        startedAt: new Date("2026-11-20T12:00:00.000Z"),
        lastInteractionAt: new Date("2026-11-20T12:10:00.000Z"),
        metadata: {
          handoffStatus: "awaiting_approval",
          pendingApproval: { cycle: "2026-11-20T12:00:00.000Z" },
        },
      },
      recentMessages: [
        {
          id: "msg-1",
          senderType: "bot",
          sentAt: "2026-11-20T12:10:00.000Z",
          content: INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE,
        },
      ],
      config: { enabled: true },
    });
    expect(silenceDecision.action).toBe("none");
    expect(silenceDecision.reason).toBe("handoff_committed_or_pending");

    const recoveryDecision = evaluateIndustrialTurnRecovery({
      now,
      isDebouncerBusy: false,
      conversation: {
        id: "conv-wa-1",
        queueState: "automacao",
        operatorId: null,
      },
      flow: {
        id: "flow-1",
        outcome: "in_progress",
        startedAt: new Date("2026-11-20T12:00:00.000Z"),
        metadata: {
          handoffStatus: "awaiting_approval",
          pendingApproval: { cycle: "2026-11-20T12:00:00.000Z" },
        },
      },
      recentMessages: [
        {
          id: "msg-2",
          senderType: "client",
          sentAt: "2026-11-20T12:15:00.000Z",
          content: "Obrigado!",
        },
      ],
    });
    expect(recoveryDecision.shouldRecover).toBe(false);
    expect(recoveryDecision.reason).toBe("handoff_committed_or_pending");

    // Verifica que conv-lc- é tratado como canal site (ativa resgate parcial de site)
    const siteSilenceDecision = evaluateIndustrialSilence({
      now: new Date("2026-11-20T12:40:00.000Z"),
      withinSchedule: true,
      conversation: {
        id: "conv-lc-12345678-1111-2222-3333-444444444444",
        queueState: "automacao",
        operatorId: null,
      },
      flow: {
        id: "flow-site-1",
        tenantId: "tenant-test",
        conversationId: "conv-lc-12345678-1111-2222-3333-444444444444",
        outcome: "in_progress",
        startedAt: new Date("2026-11-20T12:00:00.000Z"),
        lastInteractionAt: new Date("2026-11-20T12:05:00.000Z"),
        followUpStage: 0,
        collectedData: {
          Nome: { value: "Visitante Site", status: "filled" },
        },
        metadata: {},
      },
      recentMessages: [
        {
          id: "msg-s1",
          senderType: "bot",
          sentAt: "2026-11-20T12:05:00.000Z",
          content: "Qual sua necessidade?",
        },
      ],
      config: { enabled: true, sitePartialRescueMinutes: 20, followUp1Minutes: 60 },
    });
    expect(siteSilenceDecision.rescuePartialLead).toBe(true);
  });

  test("resolveFaithfulSdrStatus retorna awaiting_approval e Kanban oculta concluídos por padrão e prioriza aprovações", () => {
    const status = resolveFaithfulSdrStatus("in_progress", "awaiting_approval");
    expect(status).toBe("awaiting_approval");

    expect(DEFAULT_SDR_FILTER_STATE.showCompleted).toBe(false);
    expect(hasActiveSdrFilters(DEFAULT_SDR_FILTER_STATE)).toBe(false);

    const makeSession = (
      id: string,
      st: SdrTriageSession["status"],
      lastMessageAt: string,
    ): SdrTriageSession => ({
      id,
      conversationId: id,
      contactName: `Lead ${id}`,
      company: "Empresa Teste",
      phone: "5511999990000",
      currentStep: "Triagem",
      collectedData: {},
      startedAt: lastMessageAt,
      lastMessageAt,
      status: st,
      channel: "whatsapp",
      messages: [],
    });

    const sessions = [
      makeSession("s-active-new", "active", "2026-11-20T15:00:00.000Z"),
      makeSession("s-done", "completed", "2026-11-20T16:00:00.000Z"),
      makeSession("s-manual", "manual", "2026-11-20T16:30:00.000Z"),
      makeSession("s-awaiting", "awaiting_approval", "2026-11-20T14:00:00.000Z"),
    ];

    const defaultFiltered = filterSdrSessions(sessions, DEFAULT_SDR_FILTER_STATE);
    // Oculta completed e manual por padrão, e prioriza awaiting_approval no topo mesmo sendo mais antigo
    expect(defaultFiltered.map((s) => s.id)).toEqual(["s-awaiting", "s-active-new"]);

    const withCompleted = filterSdrSessions(sessions, {
      ...DEFAULT_SDR_FILTER_STATE,
      showCompleted: true,
    });
    expect(withCompleted.map((s) => s.id)).toContain("s-done");
    expect(withCompleted.map((s) => s.id)).toContain("s-manual");
    expect(withCompleted[0].id).toBe("s-awaiting");
  });

  test("contratos de segurança, isolamento multi-tenant, Design System e Go-Live", () => {
    const approvalRoute = readRepoFile("src/routes/api/valentina/triage-approval.ts");
    expect(approvalRoute).toContain("requireSession(request)");
    expect(approvalRoute).toContain("session.tenantId");
    expect(approvalRoute).toContain("canAccessSdr");
    expect(approvalRoute).not.toMatch(/["'](valem|tecfag)["']/);

    const handoffStore = readRepoFile("src/lib/triage/industrial-handoff-store.ts");
    expect(handoffStore).not.toContain("settings.whitelistEnabled === true");

    const handoffRecovery = readRepoFile("src/lib/triage/industrial-handoff-recovery.ts");
    expect(handoffRecovery).toContain("approvedBy");

    const metaWebhook = readRepoFile("src/routes/api/webhooks/meta.ts");
    const systemIdx = metaWebhook.indexOf('msg.type === "system"');
    const inboundIdx = metaWebhook.indexOf("inboundProcessor.process(");
    expect(systemIdx).toBeGreaterThan(-1);
    expect(inboundIdx).toBeGreaterThan(systemIdx);

    const sdrEngine = readRepoFile("src/lib/valentina/sdr-engine.ts");
    expect(sdrEngine).toContain("prepareIndustrialApproval");
    expect(sdrEngine).toContain("notifySdrTeamApprovalPending");
    expect(sdrEngine).toContain("ensureCwrDealOnContacting");

    const approvalPanel = readRepoFile("src/components/valentina/IndustrialApprovalPanel.tsx");
    expect(approvalPanel).not.toMatch(/<select[\s>]/);
    expect(approvalPanel).not.toMatch(/\btitle=/);
    expect(approvalPanel).toContain("SystemTooltip");
  });
});
