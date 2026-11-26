import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildBusinessHoursPromptSection,
  buildFallbackIndustrialBusinessHoursClosing,
  evaluateIndustrialBusinessHours,
  getNextIndustrialOpenInfo,
  industrialScheduleSchema,
  isWithinIndustrialSchedule,
  messagesCoverIndustrialBusinessHoursNotice,
  parseIndustrialScheduleConfig,
  type NonWorkingCalendarDay,
} from "../src/lib/triage/industrial-business-hours";
import { industrialSettingsSchema } from "../src/lib/triage/industrial-settings";
import { evaluateIndustrialClientMessages } from "../src/lib/triage/industrial-handoff";
import { buildIndustrialReplyRewritePrompt } from "../src/lib/triage/industrial-reply-rewriter";
import { evaluateIndustrialSilence } from "../src/lib/triage/industrial-silence-policy";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import { buildSiteToWhatsappClosingMessage } from "../src/lib/livechat/site-channel-policy";
import { getAiPersona } from "../src/lib/ai-persona";

const FAGNER_PERSONA = getAiPersona("tecfag");

describe("Expediente Humano do Fagner — Núcleo de Horário, Transição e Feriados", () => {
  test("configuração padrão é Seg–Sex 08:00–18:00 BRT com transição de 15 min e calendário integrado", () => {
    const cfg = parseIndustrialScheduleConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(cfg.startTime).toBe("08:00");
    expect(cfg.endTime).toBe("18:00");
    expect(cfg.startHour).toBe(8);
    expect(cfg.startMinute).toBe(0);
    expect(cfg.endHour).toBe(18);
    expect(cfg.endMinute).toBe(0);
    expect(cfg.closingSoonMinutes).toBe(15);
    expect(cfg.respectCommercialCalendar).toBe(true);
    expect(cfg.timezone).toBe("America/Sao_Paulo");
  });

  test("suporta minutos HH:mm e valida encerramento posterior ao início no Zod schema", () => {
    const valid = industrialScheduleSchema.safeParse({
      enabled: true,
      workDays: [1, 2, 3, 4, 5],
      startTime: "08:30",
      endTime: "17:45",
      closingSoonMinutes: 20,
      respectCommercialCalendar: true,
      timezone: "America/Sao_Paulo",
    });
    expect(valid.success).toBe(true);

    const invalid = industrialScheduleSchema.safeParse({
      enabled: true,
      workDays: [1, 2, 3, 4, 5],
      startTime: "18:00",
      endTime: "08:00",
      closingSoonMinutes: 15,
      respectCommercialCalendar: true,
      timezone: "America/Sao_Paulo",
    });
    expect(invalid.success).toBe(false);

    // industrialSettingsSchema aceita schedule opcional e continua rejeitando chaves indevidas
    expect(
      industrialSettingsSchema.safeParse({
        version: 1,
        catalog: [],
        blockedFamilies: [],
        destinations: {},
        schedule: {
          enabled: true,
          workDays: [1, 2, 3, 4, 5],
          startTime: "08:00",
          endTime: "18:00",
          closingSoonMinutes: 15,
          respectCommercialCalendar: true,
          timezone: "America/Sao_Paulo",
        },
      }).success,
    ).toBe(true);

    expect(
      industrialSettingsSchema.safeParse({
        version: 1,
        catalog: [],
        blockedFamilies: [],
        destinations: {},
        tenantId: "valem",
      }).success,
    ).toBe(false);
  });

  test("avalia abertura, transição 17:45–17:59, pós-expediente, madrugada e fim de semana", () => {
    const cfg = parseIndustrialScheduleConfig({});

    // Quarta 06:30 BRT -> antes de abrir -> hoje a partir das 8h
    const wedEarly = new Date("2026-11-25T09:30:00.000Z");
    const evalEarly = evaluateIndustrialBusinessHours(wedEarly, cfg);
    expect(evalEarly.status).toBe("closed");
    expect(evalEarly.closedReason).toBe("before_open");
    expect(evalEarly.isWithinSchedule).toBe(false);
    expect(evalEarly.nextOpen.isToday).toBe(true);
    expect(evalEarly.nextOpen.label).toBe("hoje a partir das 8h");

    // Quinta 14:20 BRT -> aberto normal
    const thuAfternoon = new Date("2026-11-26T17:20:00.000Z");
    const evalOpen = evaluateIndustrialBusinessHours(thuAfternoon, cfg);
    expect(evalOpen.status).toBe("open");
    expect(evalOpen.isWithinSchedule).toBe(true);

    // Quinta 17:45 BRT -> transição (faltam 15 min) -> próximo retorno amanhã a partir das 8h
    const thu1745 = new Date("2026-11-26T20:45:00.000Z");
    const evalClosingThu = evaluateIndustrialBusinessHours(thu1745, cfg);
    expect(evalClosingThu.status).toBe("closing_soon");
    expect(evalClosingThu.isWithinSchedule).toBe(true);
    expect(evalClosingThu.minutesUntilClose).toBe(15);
    expect(evalClosingThu.nextOpen.label).toBe("amanhã a partir das 8h");

    // Sexta 17:55 BRT -> transição (faltam 5 min) -> próximo retorno segunda-feira a partir das 8h
    const fri1755 = new Date("2026-11-27T20:55:00.000Z");
    const evalClosingFri = evaluateIndustrialBusinessHours(fri1755, cfg);
    expect(evalClosingFri.status).toBe("closing_soon");
    expect(evalClosingFri.minutesUntilClose).toBe(5);
    expect(evalClosingFri.nextOpen.label).toBe("na segunda-feira a partir das 8h");

    // Sexta 18:00 BRT -> fechado -> segunda-feira a partir das 8h
    const fri1800 = new Date("2026-11-27T21:00:00.000Z");
    const evalFriClosed = evaluateIndustrialBusinessHours(fri1800, cfg);
    expect(evalFriClosed.status).toBe("closed");
    expect(evalFriClosed.closedReason).toBe("after_close");
    expect(evalFriClosed.nextOpen.label).toBe("na segunda-feira a partir das 8h");

    // Sábado 10:00 BRT -> fim de semana
    const satMorning = new Date("2026-11-28T13:00:00.000Z");
    const evalSat = evaluateIndustrialBusinessHours(satMorning, cfg);
    expect(evalSat.status).toBe("closed");
    expect(evalSat.closedReason).toBe("weekend");
    expect(evalSat.nextOpen.label).toBe("na segunda-feira a partir das 8h");
  });

  test("cruza feriados, emendas e suspensões de commercial_calendar_days e IGNORA extra_work de sábado", () => {
    const cfg = parseIndustrialScheduleConfig({});
    const calendarDays: NonWorkingCalendarDay[] = [
      { date: "2026-06-04", type: "holiday", description: "Corpus Christi" },
      { date: "2026-06-05", type: "bridge", description: "Emenda Corpus Christi" },
      { date: "2026-06-06", type: "extra_work", description: "Sábado de meta comercial" },
    ];

    // Quinta 04/06/2026 11:00 BRT (Corpus Christi) -> pula sexta (emenda), sábado (ignora extra_work) e domingo -> segunda 08/06
    const holidayNoon = new Date("2026-06-04T14:00:00.000Z");
    const evalHoliday = evaluateIndustrialBusinessHours(holidayNoon, cfg, calendarDays);
    expect(evalHoliday.status).toBe("closed");
    expect(evalHoliday.closedReason).toBe("holiday");
    expect(evalHoliday.todayHolidayDescription).toBe("Corpus Christi");
    expect(evalHoliday.isWithinSchedule).toBe(false);
    expect(evalHoliday.nextOpen.dateIso).toBe("2026-06-08");
    expect(evalHoliday.nextOpen.label).toBe("na segunda-feira a partir das 8h");
    expect(evalHoliday.nextOpen.skippedHolidays.length).toBe(2);

    // Sábado 06/06/2026 10:00 BRT com extra_work -> continua FECHADO por segurança!
    const satExtraWork = new Date("2026-06-06T13:00:00.000Z");
    expect(isWithinIndustrialSchedule(satExtraWork, cfg, calendarDays)).toBe(false);
    const evalSatExtra = evaluateIndustrialBusinessHours(satExtraWork, cfg, calendarDays);
    expect(evalSatExtra.status).toBe("closed");
    expect(evalSatExtra.closedReason).toBe("weekend");
    expect(evalSatExtra.nextOpen.dateIso).toBe("2026-06-08");
  });

  test("horários com minutos (08:30–17:30) funcionam com precisão em isWithin e nextOpen", () => {
    const cfg = parseIndustrialScheduleConfig({
      startTime: "08:30",
      endTime: "17:30",
      closingSoonMinutes: 15,
    });
    expect(isWithinIndustrialSchedule(new Date("2026-11-26T11:29:00.000Z"), cfg)).toBe(false); // 08:29 BRT
    expect(isWithinIndustrialSchedule(new Date("2026-11-26T11:30:00.000Z"), cfg)).toBe(true); // 08:30 BRT
    expect(getNextIndustrialOpenInfo(new Date("2026-11-26T11:15:00.000Z"), cfg).label).toBe(
      "hoje a partir das 8h30",
    );
    const eval1715 = evaluateIndustrialBusinessHours(new Date("2026-11-26T20:15:00.000Z"), cfg); // 17:15 BRT
    expect(eval1715.status).toBe("closing_soon");
    expect(eval1715.nextOpen.label).toBe("amanhã a partir das 8h30");
    expect(isWithinIndustrialSchedule(new Date("2026-11-26T20:30:00.000Z"), cfg)).toBe(false); // 17:30 BRT
  });
});

describe("Expediente Humano do Fagner — Prompt, Rewriter, Awaiting Approval (ANTES do SDR) e Exceções", () => {
  const closedEval = evaluateIndustrialBusinessHours(
    new Date("2026-11-28T13:00:00.000Z"), // Sábado 10:00 BRT -> segunda 8h
    parseIndustrialScheduleConfig({}),
  );
  const closingSoonEval = evaluateIndustrialBusinessHours(
    new Date("2026-11-26T20:50:00.000Z"), // Quinta 17:50 BRT -> amanhã 8h
    parseIndustrialScheduleConfig({}),
  );

  test("buildTecfagFagnerPrompt injeta contexto real de expediente sem esfriar coleta e obrigando aviso antes da aprovação SDR", () => {
    const prompt = buildTecfagFagnerPrompt({
      aiPersona: FAGNER_PERSONA,
      knowledgeContext: "",
      conversationHistoryText: "Cliente: Oi",
      currentDateTimeBrt: "28/11/2026 10:00 BRT",
      batchSummary: "Quero uma seladora",
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
      businessHours: closedEval,
    });
    expect(prompt).toContain("EXPEDIENTE HUMANO DA EQUIPE (STATUS ATUAL: FORA DO HORÁRIO COMERCIAL");
    expect(prompt).toContain("na segunda-feira a partir das 8h");
    expect(prompt).toContain("NÃO mencione espontaneamente");
    expect(prompt).toContain("ANTES DA APROVAÇÃO SDR");
    expect(prompt).toContain("PROIBIDO contradizer o horário fechado");
  });

  test("messagesCoverIndustrialBusinessHoursNotice aprova redação natural e rejeita promessa imediata contraditória", () => {
    expect(
      messagesCoverIndustrialBusinessHoursNotice(
        [
          "Obrigado pelas informações! Já vou deixar tudo encaminhado para o nosso especialista. Como estamos fora do nosso horário comercial, ele dará continuidade ao seu atendimento na segunda-feira a partir das 8h.",
        ],
        closedEval,
      ),
    ).toBe(true);

    // Faltou mencionar fora do expediente
    expect(
      messagesCoverIndustrialBusinessHoursNotice(
        ["Obrigado pelas informações! Já vou direcionar seu atendimento para a equipe responsável."],
        closedEval,
      ),
    ).toBe(false);

    // Contradição: disse "agora mesmo" estando fechado
    expect(
      messagesCoverIndustrialBusinessHoursNotice(
        [
          "Vou te transferir agora mesmo para um especialista, mas estamos fora do horário comercial e ele atende na segunda-feira às 8h.",
        ],
        closedEval,
      ),
    ).toBe(false);

    // Transição 17:50: aceita aviso suave
    expect(
      messagesCoverIndustrialBusinessHoursNotice(
        [
          "Perfeito! Já estou encaminhando para o especialista. Nosso expediente vai até as 18h, então caso não consigam retornar ainda hoje, ele continua amanhã a partir das 8h.",
        ],
        closingSoonEval,
      ),
    ).toBe(true);
  });

  test("evaluateIndustrialClientMessages em awaiting_approval exige cobertura de expediente (aciona Gemini rewrite se omitido) e NÃO aplica em 5B_CURRICULO/5C_COMPRAS", () => {
    const machineRoute = {
      subflow: "MAQUINAS" as const,
      funnelStage: "maquinas" as const,
      targetFunnel: "Máquinas" as const,
      needsReview: false,
      reason: "subflow_matched" as const,
    };

    // Gemini já avisou naturalmente fora do horário -> passa direto SEM balão fixo
    const okEval = evaluateIndustrialClientMessages({
      result: { status: "awaiting_approval", operator: null, deal: null },
      route: machineRoute,
      data: {},
      messages: [
        "Obrigado pelos detalhes! Já vou deixar tudo encaminhado para o nosso especialista em seladoras. Como estamos fora do nosso horário comercial, ele dará continuidade ao seu atendimento na segunda-feira a partir das 8h.",
      ],
      businessHours: closedEval,
    });
    expect(okEval.needsGeminiRewrite).toBe(false);
    expect(okEval.messages.length).toBe(1);

    // Gemini esqueceu de avisar fora do horário -> aciona rewriter Gemini
    const missingNoticeEval = evaluateIndustrialClientMessages({
      result: { status: "awaiting_approval", operator: null, deal: null },
      route: machineRoute,
      data: {},
      messages: ["Obrigado! Já vou encaminhar seu atendimento para nossa equipe."],
      businessHours: closedEval,
    });
    expect(missingNoticeEval.needsGeminiRewrite).toBe(true);
    expect(missingNoticeEval.rewriteMode).toBe("awaiting_approval");

    // 5B_CURRICULO fora do horário -> NÃO exige aviso de expediente de consultor
    const curriculumEval = evaluateIndustrialClientMessages({
      result: { status: "resolved", operator: null, deal: null },
      route: {
        subflow: "5B_CURRICULO",
        funnelStage: "outros",
        targetFunnel: "Currículos",
        needsReview: false,
        reason: "subflow_matched",
      },
      data: {},
      messages: [
        "Para enviar seu currículo, acesse nosso portal no Sólides: https://grupotecfag.vagas.solides.com.br — assim nosso RH analisa com calma e retorna para você.",
      ],
      businessHours: closedEval,
    });
    expect(curriculumEval.needsGeminiRewrite).toBe(false);
  });

  test("transferência direta nominal fora do horário passa 100% pelo Gemini (sem balão fixo antigo)", () => {
    const directRoute = {
      subflow: "5A_CLIENTE" as const,
      funnelStage: "outros" as const,
      targetFunnel: "Análise e revisão humana" as const,
      needsReview: false,
      reason: "direct_operator_requested" as const,
      targetOperator: { id: "op-1", name: "Victor Goes", isAbsent: false },
    };

    // Gemini já citou Victor e avisou fora do horário -> preserva sem balão fixo
    const okDirect = evaluateIndustrialClientMessages({
      result: {
        status: "transferred",
        operator: { id: "op-1", name: "Victor Goes", isAbsent: false },
        deal: null,
      },
      route: directRoute,
      data: {},
      messages: [
        "Claro! Já deixei seu atendimento encaminhado para o Victor. Como estamos fora do nosso horário comercial, ele dará continuidade por aqui na segunda-feira a partir das 8h.",
      ],
      businessHours: closedEval,
    });
    expect(okDirect.needsGeminiRewrite).toBe(false);
    expect(okDirect.messages[0]).toContain("Victor");

    // Gemini não mencionou expediente -> aciona rewriteMode direct_operator_transferred
    const needsDirectRewrite = evaluateIndustrialClientMessages({
      result: {
        status: "transferred",
        operator: { id: "op-1", name: "Victor Goes", isAbsent: false },
        deal: null,
      },
      route: directRoute,
      data: {},
      messages: ["Claro! Já estou te transferindo para o Victor."],
      businessHours: closedEval,
    });
    expect(needsDirectRewrite.needsGeminiRewrite).toBe(true);
    expect(needsDirectRewrite.rewriteMode).toBe("direct_operator_transferred");

    // Prompt de reescrita inclui bloco de expediente para direct_operator_transferred e omite para 5C_COMPRAS
    const directPrompt = buildIndustrialReplyRewritePrompt({
      tenantId: "tecfag",
      conversationId: "conv-1",
      aiPersona: FAGNER_PERSONA,
      rewriteMode: "direct_operator_transferred",
      conversationHistoryText: "Cliente: Me passa pro Victor",
      batchSummary: "Me passa pro Victor",
      collectedData: {},
      businessHours: closedEval,
      directOperatorContext: { operatorName: "Victor Goes" },
    });
    expect(directPrompt).toContain("FORA DO HORÁRIO COMERCIAL");
    expect(directPrompt).toContain("Victor");

    const supplierPrompt = buildIndustrialReplyRewritePrompt({
      tenantId: "tecfag",
      conversationId: "conv-2",
      aiPersona: FAGNER_PERSONA,
      rewriteMode: "resolved",
      subflow: "5C_COMPRAS",
      conversationHistoryText: "Cliente: Quero oferecer frete",
      batchSummary: "Quero oferecer frete",
      collectedData: {},
      businessHours: closedEval,
    });
    expect(supplierPrompt).not.toContain("EXPEDIENTE HUMANO DA EQUIPE");
  });

  test("ponte Site→WhatsApp e fallbacks incluem aviso natural fora do horário e na transição", () => {
    const siteClosed = buildSiteToWhatsappClosingMessage("Tarcisio Pereira", {
      businessHours: closedEval,
    });
    expect(siteClosed).toContain("Perfeito, Tarcisio!");
    expect(siteClosed).toContain("WhatsApp");
    expect(siteClosed).toContain("fora do nosso horário comercial");
    expect(siteClosed).toContain("na segunda-feira a partir das 8h");

    const siteClosingSoon = buildSiteToWhatsappClosingMessage("Maria", {
      businessHours: closingSoonEval,
    });
    expect(siteClosingSoon).toContain("18h");
    expect(siteClosingSoon).toContain("amanhã a partir das 8h");

    const ackClosed = buildFallbackIndustrialBusinessHoursClosing(closedEval, {
      mode: "site_bridge_ack",
    });
    expect(ackClosed).toContain("fora do horário comercial");
    expect(ackClosed).toContain("na segunda-feira a partir das 8h");
  });

  test("SdrFollowupEngine (evaluateIndustrialSilence) bloqueia em feriado e respeita scheduleStartMinute na abertura suave", () => {
    const baseInput = {
      flow: {
        id: "fs-1",
        tenantId: "tecfag",
        conversationId: "conv-wa-1",
        startedAt: new Date("2026-06-03T23:00:00.000Z"), // 20:00 BRT
        lastInteractionAt: new Date("2026-06-03T23:05:00.000Z"),
        outcome: "in_progress",
        completedAt: null,
        followUpStage: 0,
        collectedData: {},
        metadata: { followUpStage: 0 },
      },
      conversation: {
        id: "conv-wa-1",
        queueState: "automacao",
        operatorId: null,
        contactId: "c-1",
      },
      recentMessages: [
        {
          id: "m1",
          senderType: "client",
          sentAt: new Date("2026-06-03T23:00:00.000Z"),
          content: "Quero uma seladora",
        },
        {
          id: "m2",
          senderType: "bot",
          senderName: "Fagner",
          sentAt: new Date("2026-06-03T23:05:00.000Z"),
          content: "Qual o seu nome?",
        },
      ],
    };

    // Feriado -> withinSchedule = false -> bloqueia follow-up
    const onHoliday = evaluateIndustrialSilence({
      ...baseInput,
      now: new Date("2026-06-04T14:00:00.000Z"), // 11:00 BRT feriado
      withinSchedule: false,
      scheduleStartHour: 8,
      scheduleStartMinute: 30,
    });
    expect(onHoliday.action).toBe("none");
    expect(onHoliday.reason).toBe("outside_business_schedule");

    // Dia útil com abertura às 08:30 + 30min soft start = 09:00 -> às 08:50 ainda segura!
    const softStartHold = evaluateIndustrialSilence({
      ...baseInput,
      now: new Date("2026-06-04T11:50:00.000Z"), // 08:50 BRT
      withinSchedule: true,
      scheduleStartHour: 8,
      scheduleStartMinute: 30,
    });
    expect(softStartHold.action).toBe("none");
    expect(softStartHold.reason).toBe("morning_soft_start_window");
  });

  test("UI da aba Expediente (IndustrialBusinessHoursTab.tsx) cumpre 100% Design System sem controles nativos", () => {
    const filePath = path.resolve(
      process.cwd(),
      "src/components/valentina/IndustrialBusinessHoursTab.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/<select[\s>]/i);
    expect(source).not.toMatch(/<option[\s>]/i);
    expect(source).not.toMatch(/type=["'](?:time|date|datetime-local)["']/i);
    expect(source).not.toMatch(/\btitle\s*=/);
    expect(source).toContain("SystemTooltip");
    expect(source).toContain("SimpleSelect");
  });

  test("buildBusinessHoursPromptSection não gera diretriz quando desativado", () => {
    const disabledEval = evaluateIndustrialBusinessHours(
      new Date("2026-11-28T13:00:00.000Z"),
      parseIndustrialScheduleConfig({ enabled: false }),
    );
    expect(disabledEval.status).toBe("open");
    expect(disabledEval.isWithinSchedule).toBe(true);
    expect(buildBusinessHoursPromptSection(disabledEval)).toBe("");
  });
});
