import crypto from "node:crypto";

function isSiteConversationId(conversationId: string): boolean {
  return typeof conversationId === "string" && conversationId.startsWith("site-");
}

export interface IndustrialScheduleConfig {
  enabled: boolean;
  /** 0 = Domingo, 1 = Segunda ... 6 = Sábado */
  workDays: number[];
  weekdays: number[];
  /** Hora inicial (0..23) no fuso configurado */
  startHour: number;
  /** Hora final (1..24) no fuso configurado */
  endHour: number;
  timezone: string;
}

export const DEFAULT_INDUSTRIAL_SCHEDULE: IndustrialScheduleConfig = {
  enabled: true,
  workDays: [1, 2, 3, 4, 5],
  weekdays: [1, 2, 3, 4, 5],
  startHour: 8,
  endHour: 18,
  timezone: "America/Sao_Paulo",
};

export interface IndustrialSilenceConfig {
  enabled: boolean;
  followUpEnabled: boolean;
  followUp1Minutes: number;
  followUp2Minutes: number;
  noResponseAfterFollowUp2Minutes: number;
  noResponseMinutesAfterFollowUp2: number;
  endOfDayHour: number;
  endOfDayHourBrt: number;
  sitePartialRescueMinutes: number;
  pauseOutsideSchedule: boolean;
  pauseFollowUpOutsideSchedule: boolean;
}

export const DEFAULT_INDUSTRIAL_SILENCE_CONFIG: IndustrialSilenceConfig = {
  enabled: true,
  followUpEnabled: true,
  followUp1Minutes: 25,
  followUp2Minutes: 20,
  noResponseAfterFollowUp2Minutes: 30,
  noResponseMinutesAfterFollowUp2: 30,
  endOfDayHour: 20,
  endOfDayHourBrt: 20,
  sitePartialRescueMinutes: 10,
  pauseOutsideSchedule: true,
  pauseFollowUpOutsideSchedule: true,
};

const WEEKDAY_NAMES_PT = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

export function parseIndustrialScheduleConfig(
  raw?: Record<string, unknown> | null,
): IndustrialScheduleConfig {
  const source =
    raw && typeof raw.industrialSchedule === "object" && raw.industrialSchedule !== null
      ? (raw.industrialSchedule as Record<string, unknown>)
      : raw || {};

  const enabled =
    typeof source.enabled === "boolean" ? source.enabled : DEFAULT_INDUSTRIAL_SCHEDULE.enabled;

  const rawDays = Array.isArray(source.workDays)
    ? source.workDays
    : Array.isArray(source.weekdays)
      ? source.weekdays
      : null;

  const days = rawDays
    ? Array.from(
        new Set(
          rawDays
            .map((d) => Number(d))
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        ),
      ).sort((a, b) => a - b)
    : DEFAULT_INDUSTRIAL_SCHEDULE.workDays;

  const normalizedDays = days.length > 0 ? days : DEFAULT_INDUSTRIAL_SCHEDULE.workDays;
  const startHour = clampInt(source.startHour, DEFAULT_INDUSTRIAL_SCHEDULE.startHour, 0, 23);
  const rawEnd = clampInt(source.endHour, DEFAULT_INDUSTRIAL_SCHEDULE.endHour, 1, 24);
  const endHour = rawEnd > startHour ? rawEnd : Math.min(24, startHour + 1);
  const timezone =
    typeof source.timezone === "string" && source.timezone.trim()
      ? source.timezone.trim()
      : DEFAULT_INDUSTRIAL_SCHEDULE.timezone;

  return {
    enabled,
    workDays: normalizedDays,
    weekdays: normalizedDays,
    startHour,
    endHour,
    timezone,
  };
}

export function parseIndustrialSilenceConfig(
  raw?: Record<string, unknown> | null,
): IndustrialSilenceConfig {
  const source =
    raw && typeof raw.industrialSilence === "object" && raw.industrialSilence !== null
      ? (raw.industrialSilence as Record<string, unknown>)
      : raw || {};

  const enabled =
    typeof source.enabled === "boolean"
      ? source.enabled
      : typeof source.followUpEnabled === "boolean"
        ? source.followUpEnabled
        : DEFAULT_INDUSTRIAL_SILENCE_CONFIG.enabled;

  const followUp1Minutes = clampInt(
    source.followUp1Minutes,
    DEFAULT_INDUSTRIAL_SILENCE_CONFIG.followUp1Minutes,
    5,
    240,
  );
  const followUp2Minutes = clampInt(
    source.followUp2Minutes,
    DEFAULT_INDUSTRIAL_SILENCE_CONFIG.followUp2Minutes,
    5,
    240,
  );
  const noResponseAfterFollowUp2Minutes = clampInt(
    source.noResponseAfterFollowUp2Minutes ?? source.noResponseMinutesAfterFollowUp2,
    DEFAULT_INDUSTRIAL_SILENCE_CONFIG.noResponseAfterFollowUp2Minutes,
    10,
    1440,
  );
  const endOfDayHour = clampInt(
    source.endOfDayHour ?? source.endOfDayHourBrt,
    DEFAULT_INDUSTRIAL_SILENCE_CONFIG.endOfDayHour,
    0,
    23,
  );
  const sitePartialRescueMinutes = clampInt(
    source.sitePartialRescueMinutes,
    DEFAULT_INDUSTRIAL_SILENCE_CONFIG.sitePartialRescueMinutes,
    5,
    120,
  );
  const pauseOutsideSchedule =
    typeof source.pauseOutsideSchedule === "boolean"
      ? source.pauseOutsideSchedule
      : typeof source.pauseFollowUpOutsideSchedule === "boolean"
        ? source.pauseFollowUpOutsideSchedule
        : DEFAULT_INDUSTRIAL_SILENCE_CONFIG.pauseOutsideSchedule;

  return {
    enabled,
    followUpEnabled: enabled,
    followUp1Minutes,
    followUp2Minutes,
    noResponseAfterFollowUp2Minutes,
    noResponseMinutesAfterFollowUp2: noResponseAfterFollowUp2Minutes,
    endOfDayHour,
    endOfDayHourBrt: endOfDayHour,
    sitePartialRescueMinutes,
    pauseOutsideSchedule,
    pauseFollowUpOutsideSchedule: pauseOutsideSchedule,
  };
}

export function getZonedDateParts(
  now: Date,
  timezone = DEFAULT_INDUSTRIAL_SCHEDULE.timezone,
): { weekday: number; hour: number; minute: number; dateIso: string } {
  const safeTz = timezone || DEFAULT_INDUSTRIAL_SCHEDULE.timezone;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: safeTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_INDUSTRIAL_SCHEDULE.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
  }

  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  const weekday = WEEKDAY_MAP[map.weekday] ?? now.getUTCDay();
  const rawHour = Number.parseInt(map.hour ?? "0", 10);
  const hour = rawHour === 24 ? 0 : Number.isFinite(rawHour) ? rawHour : 0;
  const minute = Number.parseInt(map.minute ?? "0", 10) || 0;
  const dateIso = `${map.year || "1970"}-${map.month || "01"}-${map.day || "01"}`;
  return { weekday, hour, minute, dateIso };
}

export function isWithinIndustrialSchedule(
  now: Date,
  config?: Partial<IndustrialScheduleConfig> | null,
): boolean {
  const cfg = parseIndustrialScheduleConfig(config as Record<string, unknown>);
  if (!cfg.enabled) return true;
  const { weekday, hour } = getZonedDateParts(now, cfg.timezone);
  if (!cfg.workDays.includes(weekday)) return false;
  return hour >= cfg.startHour && hour < cfg.endHour;
}

export function getNextIndustrialOpenInfo(
  now: Date,
  config?: Partial<IndustrialScheduleConfig> | null,
): {
  dayName: string;
  startHour: number;
  isToday: boolean;
  isTomorrow: boolean;
  label: string;
} {
  const cfg = parseIndustrialScheduleConfig(config as Record<string, unknown>);
  const { weekday, hour } = getZonedDateParts(now, cfg.timezone);
  const startHour = cfg.startHour;

  if (cfg.workDays.includes(weekday) && hour < startHour) {
    const dayName = WEEKDAY_NAMES_PT[weekday];
    return {
      dayName,
      startHour,
      isToday: true,
      isTomorrow: false,
      label: `hoje a partir das ${startHour}h`,
    };
  }

  for (let offset = 1; offset <= 7; offset++) {
    const candidate = (weekday + offset) % 7;
    if (cfg.workDays.includes(candidate)) {
      const dayName = WEEKDAY_NAMES_PT[candidate];
      const isTomorrow = offset === 1;
      const dayPrep = candidate === 0 || candidate === 6 ? "no" : "na";
      return {
        dayName,
        startHour,
        isToday: false,
        isTomorrow,
        label: isTomorrow
          ? `amanhã a partir das ${startHour}h`
          : `${dayPrep} ${dayName.toLowerCase()} a partir das ${startHour}h`,
      };
    }
  }

  const fallbackIdx = cfg.workDays[0] ?? 1;
  const fallbackDay = WEEKDAY_NAMES_PT[fallbackIdx];
  const fallbackPrep = fallbackIdx === 0 || fallbackIdx === 6 ? "no" : "na";
  return {
    dayName: fallbackDay,
    startHour,
    isToday: false,
    isTomorrow: false,
    label: `${fallbackPrep} ${fallbackDay.toLowerCase()} a partir das ${startHour}h`,
  };
}

/**
 * Quando uma transferência ocorre fora do expediente humano, informa o próximo horário
 * real de abertura da equipe sem prometer contato imediato.
 */
export function buildIndustrialOffHoursClosingNotice(
  now: Date,
  config?: Partial<IndustrialScheduleConfig> | null,
  operatorName?: string | null,
): string {
  const nextOpen = getNextIndustrialOpenInfo(now, config);
  const firstName = operatorName ? operatorName.trim().split(/\s+/)[0] : null;
  if (firstName) {
    return `Nosso expediente comercial já encerrou por hoje, então ${firstName} dará continuidade ao seu atendimento ${nextOpen.label}.`;
  }
  return `Nosso atendimento humano retoma ${nextOpen.label}, quando a equipe dará continuidade por aqui.`;
}

export function deterministicIndustrialFollowUpMessageId(
  tenantId: string,
  flowId: string,
  cycle: string,
  stage: 1 | 2,
): string {
  const digest = crypto
    .createHash("sha256")
    .update(`fu-ind:${tenantId}:${flowId}:${cycle}:${stage}`)
    .digest("hex")
    .slice(0, 32);
  return `fu-ind-s${stage}-${digest}`;
}

export function deterministicIndustrialHandoffConfirmMessageId(
  tenantId: string,
  flowId: string,
  cycle: string,
): string {
  const digest = crypto
    .createHash("sha256")
    .update(`hconf:${tenantId}:${flowId}:${cycle}`)
    .digest("hex")
    .slice(0, 32);
  return `hconf-${digest}`;
}

function extractFirstName(collectedData?: Record<string, unknown> | null): string | null {
  if (!collectedData || typeof collectedData !== "object") return null;
  const entry = collectedData["NOME COMPLETO"] as { value?: unknown; status?: unknown } | undefined;
  const raw = typeof entry?.value === "string" ? entry.value.trim() : "";
  if (!raw || /aguardando|n[aã]o informado|visitante|cliente/i.test(raw)) return null;
  const first = raw.split(/\s+/)[0]?.replace(/[^\p{L}-]/gu, "");
  return first && first.length >= 2 ? first : null;
}

export function buildIndustrialFollowUpText(params: {
  personaName?: string;
  stage: 1 | 2;
  collectedData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  cycle?: string;
}): string {
  const firstName = extractFirstName(params.collectedData);
  if (params.stage === 1) {
    return firstName
      ? `Olá, ${firstName}! Conseguiu ver minha última mensagem? Assim que puder me responder, damos sequência no seu atendimento.`
      : "Olá! Conseguiu ver minha última mensagem? Assim que puder me responder, damos sequência no seu atendimento.";
  }
  return firstName
    ? `${firstName}, vou deixar nosso atendimento em aberto por aqui para não te incomodar. Quando quiser continuar, é só mandar mensagem!`
    : "Vou deixar nosso atendimento em aberto por aqui para não te incomodar. Quando quiser continuar, é só mandar mensagem!";
}

function hasPartialCollectedData(collectedData?: Record<string, unknown> | null): boolean {
  if (!collectedData || typeof collectedData !== "object") return false;
  for (const [key, raw] of Object.entries(collectedData)) {
    if (key.startsWith("_")) continue;
    const entry = raw as { value?: unknown } | null;
    const val = typeof entry?.value === "string" ? entry.value.trim() : "";
    if (val && !/^(aguardando|n[aã]o informado|-|\?)$/i.test(val)) return true;
  }
  return false;
}

function parseIsoTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function resolvePreSilenceStage(metadata?: Record<string, unknown> | null): string {
  const pre =
    typeof metadata?.preSilenceFunnelStage === "string" ? metadata.preSilenceFunnelStage.trim() : "";
  if (pre && pre !== "sem_resposta") return pre;
  const current = typeof metadata?.funnelStage === "string" ? metadata.funnelStage.trim() : "";
  if (current && current !== "sem_resposta") return current;
  return "triagem";
}

export interface IndustrialSilenceEvalInput {
  now: Date;
  withinSchedule: boolean;
  flow: {
    id: string;
    tenantId: string;
    conversationId: string;
    startedAt?: Date | null;
    lastInteractionAt?: Date | null;
    outcome?: string | null;
    completedAt?: Date | null;
    followUpStage?: number | null;
    collectedData?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  };
  conversation: {
    id: string;
    queueState: string;
    operatorId?: string | null;
    contactId?: string | null;
  } | null;
  recentMessages: ReadonlyArray<{
    id: string;
    senderType: string;
    sentAt: Date | string;
    content?: string | null;
  }>;
  config?: Partial<IndustrialSilenceConfig> | null;
}

export interface IndustrialSilenceEvalDecision {
  action: "none" | "cancel_by_human" | "reset_followup" | "send_followup" | "mark_no_response";
  reason: string;
  nextStage?: 1 | 2 | 3;
  rescuePartialLead: boolean;
}

export function evaluateIndustrialSilence(
  input: IndustrialSilenceEvalInput,
): IndustrialSilenceEvalDecision {
  const cfg = parseIndustrialSilenceConfig(input.config as Record<string, unknown>);
  if (!cfg.enabled) {
    return { action: "none", reason: "silence_policy_disabled", rescuePartialLead: false };
  }

  const conv = input.conversation;
  if (!conv || conv.queueState === "finalizados" || conv.queueState === "meus" || Boolean(conv.operatorId)) {
    return { action: "cancel_by_human", reason: "operator_or_queue_changed", rescuePartialLead: false };
  }

  const flow = input.flow;
  if (flow.outcome !== "in_progress" || flow.completedAt) {
    return { action: "none", reason: "flow_not_in_progress", rescuePartialLead: false };
  }

  const metadata = flow.metadata || {};
  if (Boolean(metadata.handoffRequest) || Boolean(metadata.handoffReceipt)) {
    return { action: "none", reason: "handoff_committed_or_pending", rescuePartialLead: false };
  }

  const cycleMsgs = selectRecentCycleMessages(input.recentMessages, flow.startedAt || null, 40);
  if (cycleMsgs.length === 0) {
    return { action: "none", reason: "no_cycle_messages", rescuePartialLead: false };
  }

  if (cycleMsgs.some((m) => m.senderType === "agent")) {
    return { action: "cancel_by_human", reason: "agent_message_present", rescuePartialLead: false };
  }

  const lastMsg = cycleMsgs[cycleMsgs.length - 1];
  const cycleIso = flow.startedAt ? flow.startedAt.toISOString() : "cycle-0";
  const rawStage = Number(flow.followUpStage ?? metadata.followUpStage ?? 0);
  const stage = Number.isFinite(rawStage) && rawStage >= 0 ? Math.trunc(rawStage) : 0;

  if (lastMsg.senderType === "client") {
    if (stage > 0) {
      return { action: "reset_followup", reason: "client_replied", rescuePartialLead: false };
    }
    return { action: "none", reason: "waiting_for_bot", rescuePartialLead: false };
  }

  if (lastMsg.senderType !== "bot") {
    return { action: "none", reason: "last_message_not_bot", rescuePartialLead: false };
  }

  const lastMsgMs =
    lastMsg.sentAt instanceof Date ? lastMsg.sentAt.getTime() : Date.parse(String(lastMsg.sentAt));
  const silenceMinutes = Math.max(0, (input.now.getTime() - lastMsgMs) / 60_000);

  const isSite = isSiteConversationId(flow.conversationId);
  const hasPartial = hasPartialCollectedData(flow.collectedData);
  const alreadyRescued = Boolean(metadata.partialLeadRescuedAt);
  const rescuePartialLead =
    isSite && hasPartial && !alreadyRescued && silenceMinutes >= cfg.sitePartialRescueMinutes;

  const zonedNow = getZonedDateParts(input.now, DEFAULT_INDUSTRIAL_SCHEDULE.timezone);
  const isEndOfDay = zonedNow.hour >= cfg.endOfDayHour;
  if (isEndOfDay && (stage >= 1 || silenceMinutes >= cfg.followUp1Minutes)) {
    return {
      action: "mark_no_response",
      nextStage: 3,
      reason: "end_of_day_no_response",
      rescuePartialLead: Boolean(rescuePartialLead || (isSite && hasPartial && !alreadyRescued)),
    };
  }

  if (stage >= 2) {
    if (silenceMinutes >= cfg.noResponseAfterFollowUp2Minutes) {
      return {
        action: "mark_no_response",
        nextStage: 3,
        reason: "no_response_timeout_after_followup_2",
        rescuePartialLead: Boolean(rescuePartialLead || (isSite && hasPartial && !alreadyRescued)),
      };
    }
    return { action: "none", reason: "waiting_no_response_window", rescuePartialLead };
  }

  if (cfg.pauseOutsideSchedule && !input.withinSchedule) {
    return { action: "none", reason: "outside_business_schedule", rescuePartialLead };
  }

  const lastFollowUpCycle =
    typeof metadata.lastFollowUpCycle === "string" ? metadata.lastFollowUpCycle : null;
  const lastFollowUpStage = Number(metadata.lastFollowUpStage || 0);

  if (stage === 0) {
    if (lastFollowUpCycle === cycleIso && lastFollowUpStage >= 1) {
      return { action: "none", reason: "followup_1_already_sent_in_cycle", rescuePartialLead };
    }
    if (silenceMinutes >= cfg.followUp1Minutes) {
      return {
        action: "send_followup",
        nextStage: 1,
        reason: "followup_1_due",
        rescuePartialLead,
      };
    }
    return { action: "none", reason: "waiting_followup_1_window", rescuePartialLead };
  }

  if (lastFollowUpCycle === cycleIso && lastFollowUpStage >= 2) {
    return { action: "none", reason: "followup_2_already_sent_in_cycle", rescuePartialLead };
  }

  if (silenceMinutes >= cfg.followUp2Minutes) {
    return {
      action: "send_followup",
      nextStage: 2,
      reason: "followup_2_due",
      rescuePartialLead,
    };
  }

  return { action: "none", reason: "waiting_followup_2_window", rescuePartialLead };
}

/**
 * Quando o cliente volta a responder após follow-up ou após o ciclo ter ido para Sem Resposta
 * (`abandoned`), restaura o estágio anterior à inatividade e zera os contadores de cobrança
 * sem apagar dados coletados nem abrir outro ciclo.
 */
export function buildIndustrialReactivationPatch(input: {
  outcome?: string | null;
  followUpStage?: number | null;
  metadata?: Record<string, unknown> | null;
}): {
  shouldReactivate: boolean;
  outcome: "in_progress";
  followUpStage: 0;
  metadata: Record<string, unknown>;
} {
  const currentMeta = input.metadata || {};
  const restoredFunnelStage = resolvePreSilenceStage(currentMeta);
  const shouldReactivate =
    input.outcome === "abandoned" ||
    Number(input.followUpStage || 0) > 0 ||
    Number(currentMeta.followUpStage || 0) > 0 ||
    currentMeta.funnelStage === "sem_resposta";

  return {
    shouldReactivate,
    outcome: "in_progress",
    followUpStage: 0,
    metadata: {
      ...currentMeta,
      funnelStage: restoredFunnelStage,
      followUpStage: 0,
      noResponseAt: null,
      noResponseReason: null,
      turnRecoveryMessageId: null,
      turnRecoveryAttempts: 0,
      turnRecoveryNextAttemptAt: null,
    },
  };
}

/**
 * Seleciona as últimas `limit` mensagens pertencentes ao ciclo atual (`sentAt >= startedAt`)
 * e devolve-as em ordem cronológica ascendente (B17 / H20).
 */
export function selectRecentCycleMessages<
  T extends { id: string; sentAt: Date | string; content?: string | null },
>(items: readonly T[], startedAt?: Date | null, limit = 80): T[] {
  const maxItems = Math.max(1, Math.trunc(limit));
  const minMs = startedAt ? startedAt.getTime() : null;
  const filtered = items.filter((item) => {
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (content.toLowerCase() === "!reset") return false;
    const ms = item.sentAt instanceof Date ? item.sentAt.getTime() : Date.parse(String(item.sentAt));
    if (!Number.isFinite(ms)) return false;
    return minMs === null || ms >= minMs;
  });

  filtered.sort((a, b) => {
    const msA = a.sentAt instanceof Date ? a.sentAt.getTime() : Date.parse(String(a.sentAt));
    const msB = b.sentAt instanceof Date ? b.sentAt.getTime() : Date.parse(String(b.sentAt));
    if (msA !== msB) return msA - msB;
    return String(a.id).localeCompare(String(b.id));
  });

  return filtered.length > maxItems ? filtered.slice(filtered.length - maxItems) : filtered;
}

export interface IndustrialTurnRecoveryEvalInput {
  now: Date;
  isDebouncerBusy: boolean;
  conversation: {
    id: string;
    queueState: string;
    operatorId?: string | null;
  } | null;
  flow: {
    id: string;
    startedAt?: Date | null;
    outcome?: string | null;
    completedAt?: Date | null;
    metadata?: Record<string, unknown> | null;
  } | null;
  recentMessages: ReadonlyArray<{
    id: string;
    senderType: string;
    sentAt: Date | string;
    content?: string | null;
  }>;
  minAgeMs?: number;
  maxAgeMs?: number;
  maxAttemptsPerMessage?: number;
}

export interface IndustrialTurnRecoveryEvalDecision {
  shouldRecover: boolean;
  reason: string;
  lastClientMessageId: string | null;
  nextAttemptNumber: number;
  nextAttemptAtIso: string | null;
}

/**
 * Avalia se um turno de entrada (Meta, Baileys ou Site) ficou sem resposta do bot após
 * reinício, timeout ou 429, aplicando janela mínima (para não disputar com o debounce de 15s),
 * backoff exponencial e limite de tentativas por mensagem (B16 / C04 / H19).
 */
export function evaluateIndustrialTurnRecovery(
  input: IndustrialTurnRecoveryEvalInput,
): IndustrialTurnRecoveryEvalDecision {
  const conv = input.conversation;
  if (!conv || Boolean(conv.operatorId) || conv.queueState !== "automacao") {
    return {
      shouldRecover: false,
      reason: "handled_by_operator_or_not_automacao",
      lastClientMessageId: null,
      nextAttemptNumber: 0,
      nextAttemptAtIso: null,
    };
  }

  if (input.isDebouncerBusy) {
    return {
      shouldRecover: false,
      reason: "debouncer_busy",
      lastClientMessageId: null,
      nextAttemptNumber: 0,
      nextAttemptAtIso: null,
    };
  }

  const flow = input.flow;
  if (
    flow &&
    (flow.completedAt ||
      flow.outcome === "completed" ||
      flow.outcome === "transferred" ||
      flow.outcome === "stopped")
  ) {
    return {
      shouldRecover: false,
      reason: "flow_already_finished",
      lastClientMessageId: null,
      nextAttemptNumber: 0,
      nextAttemptAtIso: null,
    };
  }

  const metadata = flow?.metadata || {};
  if (Boolean(metadata.handoffRequest) || Boolean(metadata.handoffReceipt)) {
    return {
      shouldRecover: false,
      reason: "handoff_committed_or_pending",
      lastClientMessageId: null,
      nextAttemptNumber: 0,
      nextAttemptAtIso: null,
    };
  }

  const ordered = selectRecentCycleMessages(input.recentMessages, flow?.startedAt || null, 80);
  if (ordered.length === 0) {
    return {
      shouldRecover: false,
      reason: "no_cycle_messages",
      lastClientMessageId: null,
      nextAttemptNumber: 0,
      nextAttemptAtIso: null,
    };
  }

  if (ordered.some((m) => m.senderType === "agent")) {
    return {
      shouldRecover: false,
      reason: "agent_message_present",
      lastClientMessageId: null,
      nextAttemptNumber: 0,
      nextAttemptAtIso: null,
    };
  }

  const latest = ordered[ordered.length - 1];
  if (latest.senderType !== "client") {
    return {
      shouldRecover: false,
      reason: "last_message_not_client",
      lastClientMessageId: null,
      nextAttemptNumber: 0,
      nextAttemptAtIso: null,
    };
  }

  const latestMs =
    latest.sentAt instanceof Date ? latest.sentAt.getTime() : Date.parse(String(latest.sentAt));
  const minAgeMs = input.minAgeMs ?? 45_000;
  const maxAgeMs = input.maxAgeMs ?? 24 * 60 * 60_000;
  const ageMs = input.now.getTime() - latestMs;

  if (ageMs < minAgeMs) {
    return {
      shouldRecover: false,
      reason: "within_debounce_grace_period",
      lastClientMessageId: latest.id,
      nextAttemptNumber: 0,
      nextAttemptAtIso: null,
    };
  }

  if (ageMs > maxAgeMs) {
    return {
      shouldRecover: false,
      reason: "outside_recovery_window",
      lastClientMessageId: latest.id,
      nextAttemptNumber: 0,
      nextAttemptAtIso: null,
    };
  }

  const maxAttempts = input.maxAttemptsPerMessage ?? 3;
  const recordedTargetId =
    typeof metadata.turnRecoveryMessageId === "string" ? metadata.turnRecoveryMessageId : null;
  const recordedAttempts =
    recordedTargetId === latest.id ? Number(metadata.turnRecoveryAttempts || 0) : 0;
  const attempts =
    Number.isFinite(recordedAttempts) && recordedAttempts >= 0 ? Math.trunc(recordedAttempts) : 0;

  if (attempts >= maxAttempts) {
    return {
      shouldRecover: false,
      reason: "max_attempts_reached",
      lastClientMessageId: latest.id,
      nextAttemptNumber: attempts,
      nextAttemptAtIso: null,
    };
  }

  if (recordedTargetId === latest.id) {
    const nextAttemptMs = parseIsoTimestamp(metadata.turnRecoveryNextAttemptAt);
    if (nextAttemptMs !== null && nextAttemptMs > input.now.getTime()) {
      return {
        shouldRecover: false,
        reason: "backoff_pending",
        lastClientMessageId: latest.id,
        nextAttemptNumber: attempts,
        nextAttemptAtIso: metadata.turnRecoveryNextAttemptAt as string,
      };
    }
  }

  const nextAttemptNumber = attempts + 1;
  const backoffMs = Math.min(15 * 60_000, 60_000 * 2 ** Math.min(attempts, 4));
  const nextAttemptAtIso = new Date(input.now.getTime() + backoffMs).toISOString();

  return {
    shouldRecover: true,
    reason: "client_turn_unanswered",
    lastClientMessageId: latest.id,
    nextAttemptNumber,
    nextAttemptAtIso,
  };
}
