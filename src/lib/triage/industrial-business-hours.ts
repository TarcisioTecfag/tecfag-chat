import { z } from "zod";

export const HH_MM_START_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const HH_MM_END_RE = /^(?:([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

export const DEFAULT_BUSINESS_HOURS_TIMEZONE = "America/Sao_Paulo";

export const WEEKDAY_NAMES_PT = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

export const WEEKDAY_SHORT_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface NonWorkingCalendarDay {
  date: string; // YYYY-MM-DD
  type: "holiday" | "bridge" | "suspension" | "extra_work";
  description: string;
}

export interface IndustrialScheduleConfig {
  enabled: boolean;
  /** 0 = Domingo, 1 = Segunda ... 6 = Sábado */
  workDays: number[];
  weekdays: number[];
  /** Hora inicial (0..23) no fuso configurado */
  startHour: number;
  /** Minuto inicial (0..59) */
  startMinute: number;
  /** Hora final (1..24) no fuso configurado */
  endHour: number;
  /** Minuto final (0..59) */
  endMinute: number;
  /** Horário inicial formatado HH:mm */
  startTime: string;
  /** Horário final formatado HH:mm */
  endTime: string;
  /** Janela final de transição suave em minutos antes do encerramento (padrão 15 -> 17:45–17:59) */
  closingSoonMinutes: number;
  /** Respeita feriados, emendas e suspensões de commercial_calendar_days (ignora extra_work de sábado) */
  respectCommercialCalendar: boolean;
  timezone: string;
}

export const DEFAULT_INDUSTRIAL_SCHEDULE: IndustrialScheduleConfig = {
  enabled: true,
  workDays: [1, 2, 3, 4, 5],
  weekdays: [1, 2, 3, 4, 5],
  startHour: 8,
  startMinute: 0,
  endHour: 18,
  endMinute: 0,
  startTime: "08:00",
  endTime: "18:00",
  closingSoonMinutes: 15,
  respectCommercialCalendar: true,
  timezone: DEFAULT_BUSINESS_HOURS_TIMEZONE,
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

function pad2(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(2, "0");
}

export function formatHm(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** Formata hora humana enxuta em português ("8h", "18h", "8h30", "17h45"). */
export function formatHumanHourPt(hour: number, minute = 0): string {
  const h = Math.max(0, Math.min(24, Math.trunc(hour)));
  const m = Math.max(0, Math.min(59, Math.trunc(minute)));
  return m === 0 ? `${h}h` : `${h}h${pad2(m)}`;
}

export function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "24:00") return 24 * 60;
  const match = trimmed.match(HH_MM_START_RE);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  return hour * 60 + minute;
}

export const industrialScheduleSchema = z
  .object({
    enabled: z.boolean().default(true),
    workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
    startTime: z
      .string()
      .regex(HH_MM_START_RE, "Horário inicial inválido (HH:mm)")
      .default("08:00"),
    endTime: z.string().regex(HH_MM_END_RE, "Horário final inválido (HH:mm)").default("18:00"),
    closingSoonMinutes: z.number().int().min(0).max(120).default(15),
    respectCommercialCalendar: z.boolean().default(true),
    timezone: z.string().trim().min(1).max(80).default(DEFAULT_BUSINESS_HOURS_TIMEZONE),
  })
  .strict()
  .superRefine((val, ctx) => {
    const startMins = parseTimeToMinutes(val.startTime);
    const endMins = parseTimeToMinutes(val.endTime);
    if (startMins === null || endMins === null || endMins <= startMins) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "O horário de encerramento deve ser posterior ao horário de início",
      });
    }
  });

export type IndustrialScheduleSettings = z.infer<typeof industrialScheduleSchema>;

export function toIndustrialScheduleSettings(
  cfg: Partial<IndustrialScheduleConfig> | null | undefined,
): IndustrialScheduleSettings {
  const parsed = parseIndustrialScheduleConfig(cfg as Record<string, unknown> | null | undefined);
  return {
    enabled: parsed.enabled,
    workDays: [...parsed.workDays],
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    closingSoonMinutes: parsed.closingSoonMinutes,
    respectCommercialCalendar: parsed.respectCommercialCalendar,
    timezone: parsed.timezone,
  };
}

export function parseIndustrialScheduleConfig(
  raw?: Record<string, unknown> | null,
): IndustrialScheduleConfig {
  const source =
    raw && typeof raw.schedule === "object" && raw.schedule !== null
      ? (raw.schedule as Record<string, unknown>)
      : raw && typeof raw.industrialSchedule === "object" && raw.industrialSchedule !== null
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
          rawDays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        ),
      ).sort((a, b) => a - b)
    : DEFAULT_INDUSTRIAL_SCHEDULE.workDays;

  const normalizedDays = days.length > 0 ? days : DEFAULT_INDUSTRIAL_SCHEDULE.workDays;

  const parsedStartMins = parseTimeToMinutes(source.startTime);
  const parsedEndMins = parseTimeToMinutes(source.endTime);

  const startHour =
    parsedStartMins !== null
      ? Math.floor(parsedStartMins / 60)
      : clampInt(source.startHour, DEFAULT_INDUSTRIAL_SCHEDULE.startHour, 0, 23);
  const startMinute =
    parsedStartMins !== null
      ? parsedStartMins % 60
      : clampInt(source.startMinute, DEFAULT_INDUSTRIAL_SCHEDULE.startMinute, 0, 59);

  let endHour =
    parsedEndMins !== null
      ? Math.floor(parsedEndMins / 60)
      : clampInt(source.endHour, DEFAULT_INDUSTRIAL_SCHEDULE.endHour, 1, 24);
  let endMinute =
    parsedEndMins !== null
      ? parsedEndMins % 60
      : endHour === 24
        ? 0
        : clampInt(source.endMinute, DEFAULT_INDUSTRIAL_SCHEDULE.endMinute, 0, 59);

  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  if (endTotal <= startTotal) {
    const safeEnd = Math.min(24 * 60, startTotal + 60);
    endHour = Math.floor(safeEnd / 60);
    endMinute = safeEnd % 60;
  }

  const closingSoonMinutes = clampInt(
    source.closingSoonMinutes,
    DEFAULT_INDUSTRIAL_SCHEDULE.closingSoonMinutes,
    0,
    120,
  );
  const respectCommercialCalendar =
    typeof source.respectCommercialCalendar === "boolean"
      ? source.respectCommercialCalendar
      : DEFAULT_INDUSTRIAL_SCHEDULE.respectCommercialCalendar;

  const timezone =
    typeof source.timezone === "string" && source.timezone.trim()
      ? source.timezone.trim()
      : DEFAULT_INDUSTRIAL_SCHEDULE.timezone;

  return {
    enabled,
    workDays: normalizedDays,
    weekdays: normalizedDays,
    startHour,
    startMinute,
    endHour,
    endMinute,
    startTime: formatHm(startHour, startMinute),
    endTime: formatHm(endHour, endMinute),
    closingSoonMinutes,
    respectCommercialCalendar,
    timezone,
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

function buildClosedCalendarMap(
  nonWorkingDays?: readonly NonWorkingCalendarDay[] | null,
  respectCommercialCalendar = true,
): Map<string, NonWorkingCalendarDay> {
  const map = new Map<string, NonWorkingCalendarDay>();
  if (!respectCommercialCalendar || !Array.isArray(nonWorkingDays)) return map;
  for (const day of nonWorkingDays) {
    if (!day || typeof day.date !== "string") continue;
    // Ignora intencionalmente `extra_work` (ex.: sábado comercial de meta) por segurança operacional:
    // o expediente humano só fecha em `holiday`, `bridge` ou `suspension` e nunca abre sábado automaticamente.
    if (day.type === "holiday" || day.type === "bridge" || day.type === "suspension") {
      map.set(day.date.slice(0, 10), day);
    }
  }
  return map;
}

function addCalendarDaysIso(
  baseDateIso: string,
  deltaDays: number,
): { dateIso: string; weekday: number } {
  const baseNoonUtc = new Date(`${baseDateIso}T12:00:00.000Z`);
  const target = new Date(baseNoonUtc.getTime() + deltaDays * 86_400_000);
  return {
    dateIso: target.toISOString().slice(0, 10),
    weekday: target.getUTCDay(),
  };
}

function formatDayMonthPt(dateIso: string): string {
  const [, mm, dd] = dateIso.split("-");
  if (!dd || !mm) return dateIso;
  return `${dd}/${mm}`;
}

export function formatWorkDaysSummaryPt(workDays: readonly number[]): string {
  const sorted = Array.from(new Set(workDays)).sort((a, b) => a - b);
  if (sorted.length === 5 && sorted.join(",") === "1,2,3,4,5") {
    return "segunda a sexta-feira";
  }
  if (sorted.length === 6 && sorted.join(",") === "1,2,3,4,5,6") {
    return "segunda a sábado";
  }
  if (sorted.length === 7) {
    return "todos os dias";
  }
  return sorted.map((d) => WEEKDAY_NAMES_PT[d]?.toLowerCase() || String(d)).join(", ");
}

export function formatScheduleSummaryPt(cfg: IndustrialScheduleConfig): string {
  const days = formatWorkDaysSummaryPt(cfg.workDays);
  const start = formatHumanHourPt(cfg.startHour, cfg.startMinute);
  const end = formatHumanHourPt(cfg.endHour, cfg.endMinute);
  return `${days}, das ${start} às ${end}`;
}

export interface NextIndustrialOpenInfo {
  dateIso: string;
  dayName: string;
  startHour: number;
  startMinute: number;
  startTimeLabel: string;
  isToday: boolean;
  isTomorrow: boolean;
  daysAhead: number;
  skippedHolidays: Array<{
    date: string;
    description: string;
    type: "holiday" | "bridge" | "suspension";
  }>;
  label: string;
}

export function isWithinIndustrialSchedule(
  now: Date,
  config?: Partial<IndustrialScheduleConfig> | null,
  nonWorkingDays?: readonly NonWorkingCalendarDay[] | null,
): boolean {
  const cfg = parseIndustrialScheduleConfig(config as Record<string, unknown>);
  if (!cfg.enabled) return true;
  const { weekday, hour, minute, dateIso } = getZonedDateParts(now, cfg.timezone);
  if (!cfg.workDays.includes(weekday)) return false;
  const closedCalendar = buildClosedCalendarMap(nonWorkingDays, cfg.respectCommercialCalendar);
  if (closedCalendar.has(dateIso)) return false;
  const nowMinutes = hour * 60 + minute;
  const startMinutes = cfg.startHour * 60 + cfg.startMinute;
  const endMinutes = cfg.endHour * 60 + cfg.endMinute;
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

export function getNextIndustrialOpenInfo(
  now: Date,
  config?: Partial<IndustrialScheduleConfig> | null,
  nonWorkingDays?: readonly NonWorkingCalendarDay[] | null,
): NextIndustrialOpenInfo {
  const cfg = parseIndustrialScheduleConfig(config as Record<string, unknown>);
  const { weekday, hour, minute, dateIso } = getZonedDateParts(now, cfg.timezone);
  const startHour = cfg.startHour;
  const startMinute = cfg.startMinute;
  const startTimeLabel = formatHumanHourPt(startHour, startMinute);
  const startTotal = startHour * 60 + startMinute;
  const nowTotal = hour * 60 + minute;
  const closedCalendar = buildClosedCalendarMap(nonWorkingDays, cfg.respectCommercialCalendar);

  const todayClosed = closedCalendar.get(dateIso);
  if (cfg.workDays.includes(weekday) && !todayClosed && nowTotal < startTotal) {
    return {
      dateIso,
      dayName: WEEKDAY_NAMES_PT[weekday],
      startHour,
      startMinute,
      startTimeLabel,
      isToday: true,
      isTomorrow: false,
      daysAhead: 0,
      skippedHolidays: [],
      label: `hoje a partir das ${startTimeLabel}`,
    };
  }

  const skippedHolidays: Array<{
    date: string;
    description: string;
    type: "holiday" | "bridge" | "suspension";
  }> = [];
  if (
    todayClosed &&
    (todayClosed.type === "holiday" ||
      todayClosed.type === "bridge" ||
      todayClosed.type === "suspension")
  ) {
    skippedHolidays.push({
      date: todayClosed.date,
      description: todayClosed.description,
      type: todayClosed.type,
    });
  }

  for (let offset = 1; offset <= 30; offset++) {
    const candidate = addCalendarDaysIso(dateIso, offset);
    const calEntry = closedCalendar.get(candidate.dateIso);
    if (
      calEntry &&
      (calEntry.type === "holiday" || calEntry.type === "bridge" || calEntry.type === "suspension")
    ) {
      if (cfg.workDays.includes(candidate.weekday)) {
        skippedHolidays.push({
          date: calEntry.date,
          description: calEntry.description,
          type: calEntry.type,
        });
      }
      continue;
    }
    if (cfg.workDays.includes(candidate.weekday)) {
      const dayName = WEEKDAY_NAMES_PT[candidate.weekday];
      const isTomorrow = offset === 1;
      const dayPrep = candidate.weekday === 0 || candidate.weekday === 6 ? "no" : "na";
      const label = isTomorrow
        ? `amanhã a partir das ${startTimeLabel}`
        : offset <= 6
          ? `${dayPrep} ${dayName.toLowerCase()} a partir das ${startTimeLabel}`
          : `${dayPrep} ${dayName.toLowerCase()} (${formatDayMonthPt(candidate.dateIso)}) a partir das ${startTimeLabel}`;
      return {
        dateIso: candidate.dateIso,
        dayName,
        startHour,
        startMinute,
        startTimeLabel,
        isToday: false,
        isTomorrow,
        daysAhead: offset,
        skippedHolidays,
        label,
      };
    }
  }

  const fallbackIdx = cfg.workDays[0] ?? 1;
  const fallbackDay = WEEKDAY_NAMES_PT[fallbackIdx];
  const fallbackPrep = fallbackIdx === 0 || fallbackIdx === 6 ? "no" : "na";
  return {
    dateIso,
    dayName: fallbackDay,
    startHour,
    startMinute,
    startTimeLabel,
    isToday: false,
    isTomorrow: false,
    daysAhead: 7,
    skippedHolidays,
    label: `${fallbackPrep} ${fallbackDay.toLowerCase()} a partir das ${startTimeLabel}`,
  };
}

export type IndustrialBusinessHoursStatus = "open" | "closing_soon" | "closed";
export type IndustrialBusinessHoursClosedReason =
  "before_open" | "after_close" | "weekend" | "holiday" | "bridge" | "suspension" | null;

export interface IndustrialBusinessHoursEvaluation {
  enabled: boolean;
  status: IndustrialBusinessHoursStatus;
  isWithinSchedule: boolean;
  closedReason: IndustrialBusinessHoursClosedReason;
  todayHolidayDescription: string | null;
  currentDateIso: string;
  currentTimeLabel: string;
  currentWeekdayName: string;
  startTimeLabel: string;
  endTimeLabel: string;
  scheduleSummaryLabel: string;
  closingSoonMinutes: number;
  minutesUntilClose: number | null;
  nextOpen: NextIndustrialOpenInfo;
  config: IndustrialScheduleConfig;
}

export function evaluateIndustrialBusinessHours(
  now: Date,
  config?: Partial<IndustrialScheduleConfig> | null,
  nonWorkingDays?: readonly NonWorkingCalendarDay[] | null,
): IndustrialBusinessHoursEvaluation {
  const cfg = parseIndustrialScheduleConfig(config as Record<string, unknown>);
  const { weekday, hour, minute, dateIso } = getZonedDateParts(now, cfg.timezone);
  const currentTimeLabel = formatHm(hour, minute);
  const currentWeekdayName = WEEKDAY_NAMES_PT[weekday] || "";
  const startTimeLabel = formatHumanHourPt(cfg.startHour, cfg.startMinute);
  const endTimeLabel = formatHumanHourPt(cfg.endHour, cfg.endMinute);
  const scheduleSummaryLabel = formatScheduleSummaryPt(cfg);
  const nextOpen = getNextIndustrialOpenInfo(now, cfg, nonWorkingDays);

  if (!cfg.enabled) {
    return {
      enabled: false,
      status: "open",
      isWithinSchedule: true,
      closedReason: null,
      todayHolidayDescription: null,
      currentDateIso: dateIso,
      currentTimeLabel,
      currentWeekdayName,
      startTimeLabel,
      endTimeLabel,
      scheduleSummaryLabel,
      closingSoonMinutes: cfg.closingSoonMinutes,
      minutesUntilClose: null,
      nextOpen,
      config: cfg,
    };
  }

  const closedCalendar = buildClosedCalendarMap(nonWorkingDays, cfg.respectCommercialCalendar);
  const todayCal = closedCalendar.get(dateIso);
  const nowMinutes = hour * 60 + minute;
  const startMinutes = cfg.startHour * 60 + cfg.startMinute;
  const endMinutes = cfg.endHour * 60 + cfg.endMinute;

  if (
    todayCal &&
    (todayCal.type === "holiday" || todayCal.type === "bridge" || todayCal.type === "suspension")
  ) {
    return {
      enabled: true,
      status: "closed",
      isWithinSchedule: false,
      closedReason: todayCal.type,
      todayHolidayDescription: todayCal.description || null,
      currentDateIso: dateIso,
      currentTimeLabel,
      currentWeekdayName,
      startTimeLabel,
      endTimeLabel,
      scheduleSummaryLabel,
      closingSoonMinutes: cfg.closingSoonMinutes,
      minutesUntilClose: null,
      nextOpen,
      config: cfg,
    };
  }

  if (!cfg.workDays.includes(weekday)) {
    return {
      enabled: true,
      status: "closed",
      isWithinSchedule: false,
      closedReason: "weekend",
      todayHolidayDescription: null,
      currentDateIso: dateIso,
      currentTimeLabel,
      currentWeekdayName,
      startTimeLabel,
      endTimeLabel,
      scheduleSummaryLabel,
      closingSoonMinutes: cfg.closingSoonMinutes,
      minutesUntilClose: null,
      nextOpen,
      config: cfg,
    };
  }

  if (nowMinutes < startMinutes) {
    return {
      enabled: true,
      status: "closed",
      isWithinSchedule: false,
      closedReason: "before_open",
      todayHolidayDescription: null,
      currentDateIso: dateIso,
      currentTimeLabel,
      currentWeekdayName,
      startTimeLabel,
      endTimeLabel,
      scheduleSummaryLabel,
      closingSoonMinutes: cfg.closingSoonMinutes,
      minutesUntilClose: null,
      nextOpen,
      config: cfg,
    };
  }

  if (nowMinutes >= endMinutes) {
    return {
      enabled: true,
      status: "closed",
      isWithinSchedule: false,
      closedReason: "after_close",
      todayHolidayDescription: null,
      currentDateIso: dateIso,
      currentTimeLabel,
      currentWeekdayName,
      startTimeLabel,
      endTimeLabel,
      scheduleSummaryLabel,
      closingSoonMinutes: cfg.closingSoonMinutes,
      minutesUntilClose: null,
      nextOpen,
      config: cfg,
    };
  }

  const minutesUntilClose = endMinutes - nowMinutes;
  const isClosingSoon = cfg.closingSoonMinutes > 0 && minutesUntilClose <= cfg.closingSoonMinutes;

  return {
    enabled: true,
    status: isClosingSoon ? "closing_soon" : "open",
    isWithinSchedule: true,
    closedReason: null,
    todayHolidayDescription: null,
    currentDateIso: dateIso,
    currentTimeLabel,
    currentWeekdayName,
    startTimeLabel,
    endTimeLabel,
    scheduleSummaryLabel,
    closingSoonMinutes: cfg.closingSoonMinutes,
    minutesUntilClose,
    nextOpen,
    config: cfg,
  };
}

function describeClosedReasonPt(evaluation: IndustrialBusinessHoursEvaluation): string {
  switch (evaluation.closedReason) {
    case "holiday":
      return evaluation.todayHolidayDescription
        ? `feriado (${evaluation.todayHolidayDescription})`
        : "feriado";
    case "bridge":
      return evaluation.todayHolidayDescription
        ? `emenda de feriado (${evaluation.todayHolidayDescription})`
        : "emenda de feriado";
    case "suspension":
      return evaluation.todayHolidayDescription
        ? `recesso/suspensão de expediente (${evaluation.todayHolidayDescription})`
        : "suspensão de expediente";
    case "weekend":
      return "fim de semana";
    case "before_open":
      return `antes da abertura das ${evaluation.startTimeLabel}`;
    case "after_close":
      return `após o encerramento das ${evaluation.endTimeLabel}`;
    default:
      return "fora do horário comercial";
  }
}

/**
 * Monta o bloco estruturado de diretriz de expediente humano para injeção nos prompts
 * do Gemini (`sdr-tecfag-prompt.ts` e `industrial-reply-rewriter.ts`).
 */
export function buildBusinessHoursPromptSection(
  evaluation: IndustrialBusinessHoursEvaluation | null | undefined,
  options?: {
    context?: "main_triage" | "closing_rewrite" | "direct_transfer";
    operatorName?: string | null;
  },
): string {
  if (!evaluation || !evaluation.enabled) return "";

  const ctx = options?.context || "main_triage";
  const skippedHolidayNote =
    evaluation.nextOpen.skippedHolidays.length > 0
      ? ` (considerando feriado/emenda: ${evaluation.nextOpen.skippedHolidays.map((h) => h.description).join(", ")})`
      : "";

  if (evaluation.status === "open") {
    return `EXPEDIENTE HUMANO DA EQUIPE (STATUS ATUAL: DENTRO DO HORÁRIO COMERCIAL):
- Nosso horário comercial humano é ${evaluation.scheduleSummaryLabel} (Horário de Brasília).
- Estamos operando normalmente agora (${evaluation.currentWeekdayName}, ${evaluation.currentTimeLabel} BRT). Só informe o horário comercial se o cliente perguntar.`;
  }

  if (evaluation.status === "closing_soon") {
    const mins = evaluation.minutesUntilClose ?? evaluation.closingSoonMinutes;
    const targetPerson = options?.operatorName
      ? `${options.operatorName.trim().split(/\s+/)[0]}`
      : "nosso especialista/equipe";
    const collectionRule =
      ctx === "main_triage"
        ? `\n- DURANTE A COLETA (\`isCompleted: false\`): NÃO mencione o encerramento do expediente espontaneamente no "Oi" nem nas perguntas normais de triagem (não esfrie o cliente). Só mencione nosso horário comercial se o próprio cliente perguntar.`
        : "";
    return `EXPEDIENTE HUMANO DA EQUIPE (STATUS ATUAL: ÚLTIMOS ${mins} MIN DE EXPEDIENTE — TRANSIÇÃO):
- Nosso horário comercial humano é ${evaluation.scheduleSummaryLabel} (Horário de Brasília). Agora são ${evaluation.currentTimeLabel} BRT (faltam ${mins} min para encerrar às ${evaluation.endTimeLabel}).
- Próximo expediente útil: ${evaluation.nextOpen.label}${skippedHolidayNote}.${collectionRule}
- NA CONCLUSÃO / ENCAMINHAMENTO (\`isCompleted: true\`, EXCETO desistência, \`5B_CURRICULO\` e \`5C_COMPRAS\`):
  * Agradeça naturalmente, confirme que já está direcionando o atendimento para ${targetPerson} e dê um aviso suave e elegante de que nosso expediente comercial vai até as ${evaluation.endTimeLabel} — então, caso não consigam retornar ainda hoje, o atendimento terá continuidade ${evaluation.nextOpen.label}.
  * Redija de forma humana, natural e fluida (sem texto robótico colado).`;
  }

  const closedReasonPt = describeClosedReasonPt(evaluation);
  const targetPerson = options?.operatorName
    ? `${options.operatorName.trim().split(/\s+/)[0]}`
    : "nosso especialista";
  const collectionRule =
    ctx === "main_triage"
      ? `\n- DURANTE A COLETA (\`isCompleted: false\`): NÃO mencione espontaneamente que estamos fora do horário no "Oi" nem nas perguntas de triagem (mantenha a triagem leve e acolhedora). SÓ informe o horário comercial (${evaluation.scheduleSummaryLabel}) e o retorno (${evaluation.nextOpen.label}) durante a coleta se o próprio cliente perguntar se há alguém online, se estamos abertos ou quando um consultor vai atender.`
      : "";

  const directNote = options?.operatorName
    ? `\n  * Como se trata de transferência direta para ${options.operatorName}, informe naturalmente que já está deixando o atendimento encaminhado para ${targetPerson} e que, por estarmos fora do horário comercial, ${targetPerson} dará continuidade ${evaluation.nextOpen.label}.`
    : `\n  * Exemplo de referência de tom (adapte ao assunto do cliente, sem copiar literalmente igual robô): "Obrigado pelas informações! Já vou deixar tudo encaminhado para o nosso especialista. Como estamos fora do nosso horário comercial, ele dará continuidade ao seu atendimento ${evaluation.nextOpen.label}."`;

  return `EXPEDIENTE HUMANO DA EQUIPE (STATUS ATUAL: FORA DO HORÁRIO COMERCIAL — ${closedReasonPt.toUpperCase()}):
- Nosso horário comercial humano é ${evaluation.scheduleSummaryLabel} (Horário de Brasília). Agora é ${evaluation.currentWeekdayName}, ${evaluation.currentTimeLabel} BRT (${closedReasonPt}).
- Próximo retorno humano real: **${evaluation.nextOpen.label}**${skippedHolidayNote}.${collectionRule}
- NA CONCLUSÃO / ENCAMINHAMENTO (\`isCompleted: true\` — ANTES DA APROVAÇÃO SDR OU NA TRANSFERÊNCIA DIRETA; EXCETO desistência, \`5B_CURRICULO\` e \`5C_COMPRAS\`):
  * OBRIGATÓRIO avisar claramente ao cliente, em tom cordial, natural e elegante (1 a 2 balões curtos), que você já está deixando o atendimento encaminhado para ${targetPerson} e que, como estamos fora do nosso horário comercial, o atendimento humano terá continuidade **${evaluation.nextOpen.label}**.${directNote}
  * PROIBIDO contradizer o horário fechado: NUNCA escreva "agora mesmo", "em instantes", "dentro de instantes", "já vai falar com você agora" ou "dará continuidade em breve" sem deixar explícito o retorno ${evaluation.nextOpen.label}.`;
}

const IMMEDIATE_HUMAN_PROMISE_RE =
  /\b(?:agora\s+mesmo|neste\s+exato\s+momento|em\s+instantes|dentro\s+de\s+instantes|em\s+poucos\s+minutos|j[aá]\s+vai\s+te\s+(?:chamar|atender|responder)\s+agora)\b/i;

const OFF_HOURS_CONTEXT_CUE_RE =
  /\b(?:hor[aá]rio\s+comercial|fora\s+do\s+(?:nosso\s+)?(?:hor[aá]rio|expediente)|expediente|feriado|recesso|fim\s+de\s+semana|encerr(?:ou|ado|amos|a\s+[aà]s)|retoma(?:mos|r[aá])?|pr[oó]ximo\s+dia\s+[uú]til|logo\s+cedo|cedinho|primeira\s+hora|amanh[aã]|segunda[\s-]?feira|ter[cç]a[\s-]?feira|quarta[\s-]?feira|quinta[\s-]?feira|sexta[\s-]?feira|a\s+partir\s+das\s+\d{1,2}h|[aà]s\s+0?\d{1,2}h)\b/i;

const CLOSING_SOON_CUE_RE =
  /\b(?:expediente|hor[aá]rio\s+comercial|at[eé]\s+(?:as\s+)?\d{1,2}h|caso\s+n[aã]o\s+consig|se\s+n[aã]o\s+conseguir|pr[oó]ximo\s+dia\s+[uú]til|amanh[aã]|segunda[\s-]?feira|a\s+partir\s+das\s+\d{1,2}h)\b/i;

/**
 * Verifica se a resposta gerada pelo Gemini na conclusão/encaminhamento já cobre
 * adequadamente o status atual do expediente humano sem contradição.
 */
export function messagesCoverIndustrialBusinessHoursNotice(
  messages: readonly string[],
  evaluation: IndustrialBusinessHoursEvaluation | null | undefined,
): boolean {
  if (!evaluation || !evaluation.enabled || evaluation.status === "open") return true;
  const combined = messages
    .map((m) => String(m || "").trim())
    .filter(Boolean)
    .join(" ");
  if (!combined) return false;

  if (evaluation.status === "closed") {
    if (IMMEDIATE_HUMAN_PROMISE_RE.test(combined)) return false;
    const hasOffHoursMention =
      /\b(?:hor[aá]rio\s+comercial|fora\s+do\s+(?:nosso\s+)?(?:hor[aá]rio|expediente)|expediente|feriado|recesso|fim\s+de\s+semana|encerr(?:ou|ado|amos))\b/i.test(
        combined,
      );
    const hasNextOpenCue =
      /\b(?:hoje\s+(?:a\s+partir\s+das|[aà]s)|amanh[aã]|segunda[\s-]?feira|ter[cç]a[\s-]?feira|quarta[\s-]?feira|quinta[\s-]?feira|sexta[\s-]?feira|pr[oó]ximo\s+dia\s+[uú]til|a\s+partir\s+das\s+\d{1,2}h|logo\s+cedo|cedinho|primeira\s+hora)\b/i.test(
        combined,
      );
    return (
      (hasOffHoursMention && hasNextOpenCue) ||
      (hasOffHoursMention && OFF_HOURS_CONTEXT_CUE_RE.test(combined))
    );
  }

  // closing_soon
  return CLOSING_SOON_CUE_RE.test(combined);
}

/**
 * Fallback de último recurso caso o Vertex AI esteja indisponível ao compor a frase de
 * fora do horário / transição — redação natural, sem texto robótico antigo.
 */
export function buildFallbackIndustrialBusinessHoursClosing(
  evaluation: IndustrialBusinessHoursEvaluation,
  options?: {
    operatorName?: string | null;
    isOperatorAbsent?: boolean;
    mode?: "awaiting_approval" | "transferred" | "site_bridge_ack";
  },
): string {
  const firstName = options?.operatorName?.trim().split(/\s+/)[0] || null;
  const mode = options?.mode || "awaiting_approval";

  if (mode === "site_bridge_ack") {
    if (evaluation.status === "closed") {
      return `Perfeito! Confirmação recebida por aqui. Já deixei todos os detalhes da sua triagem encaminhados para a nossa equipe e, como estamos fora do horário comercial, nosso especialista dará continuidade ${evaluation.nextOpen.label}.`;
    }
    if (evaluation.status === "closing_soon") {
      return `Perfeito! Confirmação recebida por aqui. Já deixei os detalhes da sua triagem com a equipe — nosso expediente vai até as ${evaluation.endTimeLabel}, então caso não consigam retornar ainda hoje, o atendimento segue ${evaluation.nextOpen.label}.`;
    }
    return "Perfeito! Confirmação recebida por aqui. Nossa equipe já está com todos os detalhes da sua triagem do site e dará continuidade em breve.";
  }

  if (mode === "transferred" && firstName) {
    if (evaluation.status === "closed") {
      return `Já deixei seu atendimento encaminhado para ${firstName}. Como estamos fora do nosso horário comercial, ${firstName} dará continuidade por aqui ${evaluation.nextOpen.label}.`;
    }
    if (evaluation.status === "closing_soon") {
      return `Já encaminhei seu atendimento para ${firstName}. Nosso expediente vai até as ${evaluation.endTimeLabel}, então caso não consiga retornar ainda hoje, ${firstName} dará continuidade ${evaluation.nextOpen.label}.`;
    }
    if (options?.isOperatorAbsent) {
      return `Seu atendimento foi encaminhado para ${firstName}. No momento está ausente, mas assim que retornar dará continuidade por aqui.`;
    }
    return `Seu atendimento foi encaminhado para ${firstName}, que dará continuidade por aqui.`;
  }

  if (evaluation.status === "closed") {
    return `Obrigado pelas informações! Já vou deixar tudo encaminhado para o nosso especialista. Como estamos fora do nosso horário comercial, ele dará continuidade ao seu atendimento ${evaluation.nextOpen.label}.`;
  }
  if (evaluation.status === "closing_soon") {
    return `Obrigado pelas informações! Já vou direcionar seu atendimento para o nosso especialista. Nosso expediente comercial vai até as ${evaluation.endTimeLabel}, então caso não consigam retornar ainda hoje, o atendimento segue ${evaluation.nextOpen.label}.`;
  }
  return "Obrigado pelas informações! Já vou direcionar seu atendimento para a equipe responsável dar continuidade por aqui.";
}

/**
 * Helper retrocompatível mantido para testes/chamadores legados.
 */
export function buildIndustrialOffHoursClosingNotice(
  now: Date,
  config?: Partial<IndustrialScheduleConfig> | null,
  operatorName?: string | null,
  nonWorkingDays?: readonly NonWorkingCalendarDay[] | null,
): string {
  const nextOpen = getNextIndustrialOpenInfo(now, config, nonWorkingDays);
  const firstName = operatorName ? operatorName.trim().split(/\s+/)[0] : null;
  if (firstName) {
    return `Nosso expediente comercial já encerrou por hoje, então ${firstName} dará continuidade ao seu atendimento ${nextOpen.label}.`;
  }
  return `Nosso atendimento humano retoma ${nextOpen.label}, quando a equipe dará continuidade por aqui.`;
}
