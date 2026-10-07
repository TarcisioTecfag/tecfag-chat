export const COMMERCIAL_TIME_ZONE = "America/Sao_Paulo";

export function saoPauloDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: COMMERCIAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export type CommercialCalendarDay = {
  date: string;
  type: "holiday" | "bridge" | "extra_work" | "suspension";
  affectsGoal: boolean;
};

export function calculateBusinessPacing(
  month: string,
  today: string,
  targetValue: number,
  realizedValue: number,
  calendarDays: CommercialCalendarDay[],
) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error("Período comercial inválido.");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const overrides = new Map(calendarDays.filter((day) => day.affectsGoal).map((day) => [day.date, day.type]));
  let businessDays = 0;
  let elapsedDays = 0;

  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    const override = overrides.get(date);
    const isBusinessDay = override === "extra_work" || (weekday !== 0 && weekday !== 6 && !override);
    if (!isBusinessDay) continue;
    businessDays += 1;
    if (date < today) elapsedDays += 1;
  }

  const remainingDays = Math.max(1, businessDays - elapsedDays);
  return {
    businessDays,
    elapsedDays,
    remainingDays,
    expectedPercent: businessDays > 0 ? (elapsedDays / businessDays) * 100 : 0,
    coveragePercent: targetValue > 0 ? (realizedValue / targetValue) * 100 : 0,
    dailyRequired: Math.max(0, targetValue - realizedValue) / remainingDays,
  };
}

export type MaturityRule = { days: number; maxValue: number | null };

export const DEFAULT_MATURITY_RULES: MaturityRule[] = [
  { days: 7, maxValue: 15_000 },
  { days: 15, maxValue: 35_000 },
  { days: 30, maxValue: 60_000 },
  { days: 60, maxValue: 100_000 },
  { days: 90, maxValue: null },
];

export function classifyMaturity(value: number, createdAt: Date, now: Date, rules: MaturityRule[] = DEFAULT_MATURITY_RULES) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(createdAt.getTime())) return null;
  const tierIndex = rules.findIndex((rule) => rule.maxValue === null || value <= rule.maxValue);
  if (tierIndex < 0) return null;
  const ageDays = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000));
  const tierDays = rules[tierIndex].days;
  return {
    tierIndex: tierIndex + 1,
    tierDays,
    ageDays,
    daysRemaining: tierDays - ageDays,
    isMature: ageDays >= tierDays,
  };
}
