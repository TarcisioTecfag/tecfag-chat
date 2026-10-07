import { calculateBusinessPacing, type CommercialCalendarDay } from "./metrics";

export type CommercialDivision = "personnalite" | "maquinas" | null;
export type DirectiveState = "completed" | "pending_today" | "overdue" | "future" | "other";

export function directiveState(
  status: string,
  assignedDate: string,
  today: string,
): DirectiveState {
  if (status === "completed" || status === "done") return "completed";
  if (status !== "pending") return "other";
  if (assignedDate < today) return "overdue";
  if (assignedDate === today) return "pending_today";
  return "future";
}

export function forecastTier(daysRemaining: number, tierDays: number[]): number {
  if (daysRemaining <= 0) return 1;
  for (let index = 1; index < tierDays.length; index += 1) {
    if (daysRemaining <= tierDays[index]) return index + 1;
  }
  return tierDays.length;
}

export function tmaBucket(durationSeconds: number, boundariesMinutes: number[]): number {
  const minutes = durationSeconds / 60;
  const index = boundariesMinutes.findIndex((boundary) => minutes <= boundary);
  return index === -1 ? boundariesMinutes.length : index;
}

export function monthWindow(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mês inválido.");
  const [year, number] = month.split("-").map(Number);
  const nextMonth = `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, "0")}`;
  const previousMonth = `${number === 1 ? year - 1 : year}-${String(number === 1 ? 12 : number - 1).padStart(2, "0")}`;
  return { start: `${month}-01`, nextStart: `${nextMonth}-01`, previousMonth };
}

export function lastSixMonths(month: string): string[] {
  const [year, number] = month.split("-").map(Number);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, number - 6 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function buildGoalCurve(
  month: string,
  today: string,
  targetValue: number,
  dailyWon: Map<string, { count: number; value: number }>,
  calendarDays: CommercialCalendarDay[],
) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const overrides = new Map(
    calendarDays.filter((day) => day.affectsGoal).map((day) => [day.date, day.type]),
  );
  const businessDates: string[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    const override = overrides.get(date);
    if (override === "extra_work" || (weekday !== 0 && weekday !== 6 && !override))
      businessDates.push(date);
  }
  const businessSet = new Set(businessDates);
  const baseDaily = businessDates.length ? targetValue / businessDates.length : 0;
  let expected = 0;
  let realized = 0;
  let weekValue = 0;
  let weekCount = 0;
  const todayDate = new Date(`${today}T12:00:00Z`);
  const weekStartDate = new Date(todayDate);
  weekStartDate.setUTCDate(todayDate.getUTCDate() - ((todayDate.getUTCDay() + 6) % 7));
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekStartDate.getUTCDate() + 6);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);
  const weekTargetValue =
    businessDates.filter((date) => date >= weekStart && date <= weekEnd).length * baseDaily;
  const points = Array.from({ length: lastDay }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const sold = dailyWon.get(date) || { count: 0, value: 0 };
    if (businessSet.has(date)) expected += baseDaily;
    if (date <= today) realized += sold.value;
    if (date >= weekStart && date <= today) {
      weekValue += sold.value;
      weekCount += sold.count;
    }
    return {
      date,
      businessDay: businessSet.has(date),
      wonCount: date <= today ? sold.count : 0,
      wonValue: date <= today ? sold.value : 0,
      expectedCumulative: expected,
      realizedCumulative: date <= today ? realized : null,
    };
  });
  const pacing = calculateBusinessPacing(month, today, targetValue, realized, calendarDays);
  return {
    points,
    pacing,
    todayTargetValue: businessSet.has(today) ? baseDaily : 0,
    todayWon: dailyWon.get(today) || { count: 0, value: 0 },
    weekWon: { count: weekCount, value: weekValue },
    weekTargetValue,
    weekGapValue: Math.max(0, weekTargetValue - weekValue),
  };
}
