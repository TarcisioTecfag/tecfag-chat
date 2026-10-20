import test from "node:test";
import assert from "node:assert/strict";
import {
  parseIndustrialScheduleConfig,
  isWithinIndustrialSchedule,
  getNextIndustrialOpenInfo,
  buildIndustrialOffHoursClosingNotice,
  parseIndustrialSilenceConfig,
  evaluateIndustrialSilence,
  buildIndustrialFollowUpText,
  buildIndustrialReactivationPatch,
  deterministicIndustrialFollowUpMessageId,
  deterministicIndustrialHandoffConfirmMessageId,
  selectRecentCycleMessages,
  evaluateIndustrialTurnRecovery,
} from "../src/lib/triage/industrial-silence-policy.ts";

test("E5 Schedule: horario de expediente comercial (8h-18h seg-sex BRT) e aviso fora do expediente", () => {
  const cfg = parseIndustrialScheduleConfig({});
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.startHour, 8);
  assert.equal(cfg.endHour, 18);
  assert.deepEqual(cfg.workDays, [1, 2, 3, 4, 5]);

  // Terça-feira 14:30 BRT (17:30 UTC)
  const tueAfternoon = new Date("2026-10-20T17:30:00.000Z");
  assert.equal(isWithinIndustrialSchedule(tueAfternoon, cfg), true);

  // Terça-feira 19:15 BRT (22:15 UTC) -> fora do expediente
  const tueNight = new Date("2026-10-20T22:15:00.000Z");
  assert.equal(isWithinIndustrialSchedule(tueNight, cfg), false);
  const nextTue = getNextIndustrialOpenInfo(tueNight, cfg);
  assert.equal(nextTue.label, "amanhã a partir das 8h");

  // Sexta-feira 18:30 BRT (21:30 UTC) -> fora do expediente, próximo dia útil é segunda-feira
  const friNight = new Date("2026-10-23T21:30:00.000Z");
  assert.equal(isWithinIndustrialSchedule(friNight, cfg), false);
  const nextFri = getNextIndustrialOpenInfo(friNight, cfg);
  assert.equal(nextFri.label, "na segunda-feira a partir das 8h");

  const closingNotice = buildIndustrialOffHoursClosingNotice(friNight, cfg, "Carlos Silva");
  assert.match(closingNotice, /Carlos/);
  assert.match(closingNotice, /na segunda-feira a partir das 8h/);
});

test("E5 Silence & Follow-up: 25min FU1, +20min FU2, +30min Sem Resposta e bloqueio fora do expediente", () => {
  const cfg = parseIndustrialSilenceConfig({});
  assert.equal(cfg.followUp1Minutes, 25);
  assert.equal(cfg.followUp2Minutes, 20);
  assert.equal(cfg.noResponseAfterFollowUp2Minutes, 30);
  assert.equal(cfg.endOfDayHour, 20);

  const cycleStart = new Date("2026-10-20T13:00:00.000Z"); // 10:00 BRT
  const botMsgTime = new Date("2026-10-20T13:05:00.000Z"); // 10:05 BRT

  const baseFlow = {
    id: "fs-sdr-tecfag-conv-1",
    tenantId: "tecfag",
    conversationId: "conv-1",
    startedAt: cycleStart,
    lastInteractionAt: botMsgTime,
    outcome: "in_progress",
    completedAt: null,
    followUpStage: 0,
    collectedData: {
      "NOME COMPLETO": { value: "Roberto Alves", status: "filled" },
    },
    metadata: {
      followUpStage: 0,
      funnelStage: "perguntas_contexto",
      targetFunnel: "Máquinas",
      subflow: "MAQUINAS",
    },
  };

  const baseConv = {
    id: "conv-1",
    queueState: "automacao",
    operatorId: null,
    contactId: "c-5511999990000",
  };

  const recentMessages = [
    { id: "m1", senderType: "client", sentAt: new Date("2026-10-20T13:04:00.000Z"), content: "Oi, sou Roberto" },
    { id: "m2", senderType: "bot", sentAt: botMsgTime, content: "Certo, qual máquina você procura?" },
  ];

  // 1) Aos 20 min de silêncio (< 25 min): nenhuma ação
  const at20m = new Date(botMsgTime.getTime() + 20 * 60_000);
  const dec20m = evaluateIndustrialSilence({
    now: at20m,
    withinSchedule: true,
    flow: baseFlow,
    conversation: baseConv,
    recentMessages,
    config: cfg,
  });
  assert.equal(dec20m.action, "none");

  // 2) Aos 26 min de silêncio mas FORA do expediente: bloqueia envio de follow-up
  const decOffHours = evaluateIndustrialSilence({
    now: new Date(botMsgTime.getTime() + 26 * 60_000),
    withinSchedule: false,
    flow: baseFlow,
    conversation: baseConv,
    recentMessages,
    config: cfg,
  });
  assert.equal(decOffHours.action, "none");
  assert.equal(decOffHours.reason, "outside_business_schedule");

  // 3) Aos 26 min de silêncio dentro do expediente: envia Follow-up 1
  const at26m = new Date(botMsgTime.getTime() + 26 * 60_000);
  const decFu1 = evaluateIndustrialSilence({
    now: at26m,
    withinSchedule: true,
    flow: baseFlow,
    conversation: baseConv,
    recentMessages,
    config: cfg,
  });
  assert.equal(decFu1.action, "send_followup");
  assert.equal(decFu1.nextStage, 1);

  // Deduplicação determinística por (flowId, cycle, stage)
  const decFu1Dup = evaluateIndustrialSilence({
    now: at26m,
    withinSchedule: true,
    flow: {
      ...baseFlow,
      followUpStage: 0,
      metadata: {
        ...baseFlow.metadata,
        lastFollowUpCycle: cycleStart.toISOString(),
        lastFollowUpStage: 1,
      },
    },
    conversation: baseConv,
    recentMessages,
    config: cfg,
  });
  assert.equal(decFu1Dup.action, "none");
  assert.equal(decFu1Dup.reason, "followup_1_already_sent_in_cycle");

  // 4) Após FU1 enviado (stage=1), +21 min -> Follow-up 2
  const fu1SentAt = at26m;
  const flowStage1 = {
    ...baseFlow,
    followUpStage: 1,
    lastInteractionAt: fu1SentAt,
    metadata: {
      ...baseFlow.metadata,
      followUpStage: 1,
      lastFollowUpCycle: cycleStart.toISOString(),
      lastFollowUpStage: 1,
    },
  };
  const msgsAfterFu1 = [
    ...recentMessages,
    { id: "m3", senderType: "bot", sentAt: fu1SentAt, content: "Roberto, conseguiu ver?" },
  ];
  const atFu2 = new Date(fu1SentAt.getTime() + 21 * 60_000);
  const decFu2 = evaluateIndustrialSilence({
    now: atFu2,
    withinSchedule: true,
    flow: flowStage1,
    conversation: baseConv,
    recentMessages: msgsAfterFu1,
    config: cfg,
  });
  assert.equal(decFu2.action, "send_followup");
  assert.equal(decFu2.nextStage, 2);

  // 5) Após FU2 enviado (stage=2), +31 min -> Sem Resposta (mark_no_response)
  const fu2SentAt = atFu2;
  const flowStage2 = {
    ...baseFlow,
    followUpStage: 2,
    lastInteractionAt: fu2SentAt,
    metadata: {
      ...baseFlow.metadata,
      followUpStage: 2,
      lastFollowUpCycle: cycleStart.toISOString(),
      lastFollowUpStage: 2,
    },
  };
  const msgsAfterFu2 = [
    ...msgsAfterFu1,
    { id: "m4", senderType: "bot", sentAt: fu2SentAt, content: "Vou deixar em aberto por aqui." },
  ];
  const atNoResp = new Date(fu2SentAt.getTime() + 31 * 60_000);
  const decNoResp = evaluateIndustrialSilence({
    now: atNoResp,
    withinSchedule: true,
    flow: flowStage2,
    conversation: baseConv,
    recentMessages: msgsAfterFu2,
    config: cfg,
  });
  assert.equal(decNoResp.action, "mark_no_response");
  assert.equal(decNoResp.nextStage, 3);
  assert.equal(decNoResp.reason, "no_response_timeout_after_followup_2");
});

test("E5 End-of-day & Site Partial Rescue & Human Takeover Cancellation & Reactivation", () => {
  const cfg = parseIndustrialSilenceConfig({});
  const cycleStart = new Date("2026-10-20T20:00:00.000Z"); // 17:00 BRT
  const botMsgTime = new Date("2026-10-20T20:10:00.000Z"); // 17:10 BRT

  const siteFlow = {
    id: "fs-sdr-tecfag-site-conv-9",
    tenantId: "tecfag",
    conversationId: "site-conv-9",
    startedAt: cycleStart,
    lastInteractionAt: botMsgTime,
    outcome: "in_progress",
    completedAt: null,
    followUpStage: 1,
    collectedData: {
      "NOME COMPLETO": { value: "Marina Costa", status: "filled" },
      "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora contínua", status: "filled" },
    },
    metadata: {
      followUpStage: 1,
      funnelStage: "perguntas_contexto",
      targetFunnel: "Máquinas",
      subflow: "MAQUINAS",
    },
  };

  const siteConv = {
    id: "site-conv-9",
    queueState: "automacao",
    operatorId: null,
    contactId: "site-visitor-9",
  };

  const recentMessages = [
    { id: "m1", senderType: "client", sentAt: new Date("2026-10-20T20:09:00.000Z"), content: "Quero seladora" },
    { id: "m2", senderType: "bot", sentAt: botMsgTime, content: "Qual sua empresa ou CNPJ?" },
  ];

  // Fim do dia às 20:05 BRT (23:05 UTC) após pelo menos 1 follow-up -> move para Sem Resposta e resgata lead parcial do site
  const at2005Brt = new Date("2026-10-20T23:05:00.000Z");
  const decEndOfDay = evaluateIndustrialSilence({
    now: at2005Brt,
    withinSchedule: false,
    flow: siteFlow,
    conversation: siteConv,
    recentMessages,
    config: cfg,
  });
  assert.equal(decEndOfDay.action, "mark_no_response");
  assert.equal(decEndOfDay.reason, "end_of_day_no_response");
  assert.equal(decEndOfDay.rescuePartialLead, true);

  // Captura humana ou mensagem de operador humano cancela imediatamente
  const decHumanCaptured = evaluateIndustrialSilence({
    now: new Date(botMsgTime.getTime() + 30 * 60_000),
    withinSchedule: true,
    flow: siteFlow,
    conversation: { ...siteConv, queueState: "meus", operatorId: "op-1" },
    recentMessages,
    config: cfg,
  });
  assert.equal(decHumanCaptured.action, "cancel_by_human");

  const decAgentMsg = evaluateIndustrialSilence({
    now: new Date(botMsgTime.getTime() + 30 * 60_000),
    withinSchedule: true,
    flow: siteFlow,
    conversation: siteConv,
    recentMessages: [
      ...recentMessages,
      { id: "m3", senderType: "agent", sentAt: new Date(botMsgTime.getTime() + 5 * 60_000), content: "Assumi aqui!" },
    ],
    config: cfg,
  });
  assert.equal(decAgentMsg.action, "cancel_by_human");

  // Reativação limpa quando cliente volta a falar após Sem Resposta (outcome='abandoned')
  const reactivation = buildIndustrialReactivationPatch({
    outcome: "abandoned",
    followUpStage: 3,
    metadata: {
      followUpStage: 3,
      funnelStage: "sem_resposta",
      preSilenceFunnelStage: "perguntas_contexto",
      noResponseAt: at2005Brt.toISOString(),
      noResponseReason: "end_of_day_no_response",
    },
  });
  assert.equal(reactivation.shouldReactivate, true);
  assert.equal(reactivation.outcome, "in_progress");
  assert.equal(reactivation.followUpStage, 0);
  assert.equal(reactivation.metadata.funnelStage, "perguntas_contexto");
  assert.equal(reactivation.metadata.followUpStage, 0);
  assert.equal(reactivation.metadata.noResponseAt, null);
});

test("E5 Follow-up Text & Idempotency Keys: texto natural sem fabricar dados e IDs determinísticos", () => {
  const fup1 = buildIndustrialFollowUpText({
    personaName: "Fagner",
    stage: 1,
    collectedData: {
      "NOME COMPLETO": { value: "João Mendes", status: "filled" },
    },
    metadata: {
      subflow: "MAQUINAS",
      funnelStage: "perguntas_contexto",
      targetFunnel: "Máquinas",
    },
  });
  assert.match(fup1, /João/);
  assert.ok(fup1.length > 20 && fup1.length <= 220);

  const fup2 = buildIndustrialFollowUpText({
    personaName: "Fagner",
    stage: 2,
    collectedData: {
      "NOME COMPLETO": { value: "João Mendes", status: "filled" },
    },
    metadata: {
      subflow: "MAQUINAS",
    },
  });
  assert.match(fup2, /João/);
  assert.match(fup2, /aberto/i);

  const id1 = deterministicIndustrialFollowUpMessageId("tecfag", "fs-1", "2026-10-20T12:00:00.000Z", 1);
  const id1Again = deterministicIndustrialFollowUpMessageId("tecfag", "fs-1", "2026-10-20T12:00:00.000Z", 1);
  const id2 = deterministicIndustrialFollowUpMessageId("tecfag", "fs-1", "2026-10-20T12:00:00.000Z", 2);
  assert.equal(id1, id1Again);
  assert.notEqual(id1, id2);

  const handoffId1 = deterministicIndustrialHandoffConfirmMessageId("tecfag", "fs-1", "2026-10-20T12:00:00.000Z");
  const handoffId2 = deterministicIndustrialHandoffConfirmMessageId("tecfag", "fs-1", "2026-10-20T12:00:00.000Z");
  assert.equal(handoffId1, handoffId2);
});

test("E5 B17 / H20: selectRecentCycleMessages retorna as últimas 80 mensagens do ciclo atual em ordem cronológica", () => {
  const cycleStart = new Date("2026-10-20T10:00:00.000Z");
  const allMessages = [];
  // 5 mensagens antigas antes do ciclo atual
  for (let i = 1; i <= 5; i++) {
    allMessages.push({
      id: `old-${i}`,
      senderType: "client",
      sentAt: new Date(cycleStart.getTime() - (10 - i) * 60_000),
      content: `antiga ${i}`,
    });
  }
  // 105 mensagens dentro do ciclo atual
  for (let i = 1; i <= 105; i++) {
    allMessages.push({
      id: `msg-${String(i).padStart(3, "0")}`,
      senderType: i % 2 === 1 ? "client" : "bot",
      sentAt: new Date(cycleStart.getTime() + i * 1000),
      content: `mensagem ${i}`,
    });
  }

  // Simulando retorno DESC do banco e normalização para as 80 mais recentes em ordem ASC
  const descFromDb = [...allMessages].reverse().slice(0, 80);
  const recent80 = selectRecentCycleMessages(descFromDb, cycleStart, 80);

  assert.equal(recent80.length, 80);
  assert.equal(recent80[0].id, "msg-026");
  assert.equal(recent80[79].id, "msg-105");
  // Ordem estritamente cronológica
  for (let i = 1; i < recent80.length; i++) {
    assert.ok(new Date(recent80[i].sentAt).getTime() >= new Date(recent80[i - 1].sentAt).getTime());
  }
});

test("E5 B16 / H19: evaluateIndustrialTurnRecovery respeita janela de debounce, backoff e limite de 3 tentativas", () => {
  const now = new Date("2026-10-20T15:00:00.000Z");
  const clientMsgRecent = {
    id: "c-msg-1",
    senderType: "client",
    sentAt: new Date(now.getTime() - 20_000), // 20s atrás (< 45s de janela de debounce)
    content: "Preciso de cotação",
  };

  // 1) Dentro da janela de debounce (20s < 45s): não interfere
  const decGrace = evaluateIndustrialTurnRecovery({
    now,
    isDebouncerBusy: false,
    conversation: { id: "conv-1", queueState: "automacao", operatorId: null },
    flow: { id: "fs-1", startedAt: new Date(now.getTime() - 120_000), outcome: "in_progress", completedAt: null, metadata: {} },
    recentMessages: [clientMsgRecent],
  });
  assert.equal(decGrace.shouldRecover, false);
  assert.equal(decGrace.reason, "within_debounce_grace_period");

  // 2) Após 50s sem resposta do bot e debouncer livre: recupera (tentativa 1)
  const clientMsgStuck = {
    id: "c-msg-2",
    senderType: "client",
    sentAt: new Date(now.getTime() - 50_000),
    content: "Preciso de cotação",
  };
  const decAttempt1 = evaluateIndustrialTurnRecovery({
    now,
    isDebouncerBusy: false,
    conversation: { id: "conv-1", queueState: "automacao", operatorId: null },
    flow: { id: "fs-1", startedAt: new Date(now.getTime() - 120_000), outcome: "in_progress", completedAt: null, metadata: {} },
    recentMessages: [clientMsgStuck],
  });
  assert.equal(decAttempt1.shouldRecover, true);
  assert.equal(decAttempt1.lastClientMessageId, "c-msg-2");
  assert.equal(decAttempt1.nextAttemptNumber, 1);

  // 3) Enquanto estiver em backoff da tentativa 1: aguarda
  const decBackoff = evaluateIndustrialTurnRecovery({
    now,
    isDebouncerBusy: false,
    conversation: { id: "conv-1", queueState: "automacao", operatorId: null },
    flow: {
      id: "fs-1",
      startedAt: new Date(now.getTime() - 120_000),
      outcome: "in_progress",
      completedAt: null,
      metadata: {
        turnRecoveryMessageId: "c-msg-2",
        turnRecoveryAttempts: 1,
        turnRecoveryNextAttemptAt: decAttempt1.nextAttemptAtIso,
      },
    },
    recentMessages: [clientMsgStuck],
  });
  assert.equal(decBackoff.shouldRecover, false);
  assert.equal(decBackoff.reason, "backoff_pending");

  // 4) Após atingir 3 tentativas na mesma mensagem: para de tentar para não criar loop infinito
  const decExhausted = evaluateIndustrialTurnRecovery({
    now: new Date(now.getTime() + 10 * 60_000),
    isDebouncerBusy: false,
    conversation: { id: "conv-1", queueState: "automacao", operatorId: null },
    flow: {
      id: "fs-1",
      startedAt: new Date(now.getTime() - 120_000),
      outcome: "in_progress",
      completedAt: null,
      metadata: {
        turnRecoveryMessageId: "c-msg-2",
        turnRecoveryAttempts: 3,
      },
    },
    recentMessages: [clientMsgStuck],
  });
  assert.equal(decExhausted.shouldRecover, false);
  assert.equal(decExhausted.reason, "max_attempts_reached");
});
