import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { agentConfigs, commercialCalendarDays } from "../../db/schema";
import {
  ensureBrazilianHolidaysSeeded,
  getBrazilianHolidaysForYear,
} from "../commercial/brazilian-holidays";
import type { IndustrialDatabase, IndustrialTransaction } from "./industrial-rodizio-store";
import { INDUSTRIAL_SETTINGS_AGENT } from "./industrial-settings";
import {
  evaluateIndustrialBusinessHours,
  getZonedDateParts,
  parseIndustrialScheduleConfig,
  type IndustrialBusinessHoursEvaluation,
  type IndustrialScheduleConfig,
  type NonWorkingCalendarDay,
} from "./industrial-business-hours";

function addDaysIso(baseDateIso: string, deltaDays: number): string {
  const baseNoonUtc = new Date(`${baseDateIso}T12:00:00.000Z`);
  return new Date(baseNoonUtc.getTime() + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

function fallbackNationalHolidaysInRange(
  fromDateIso: string,
  toDateIso: string,
): NonWorkingCalendarDay[] {
  const startYear = Number.parseInt(fromDateIso.slice(0, 4), 10);
  const endYear = Number.parseInt(toDateIso.slice(0, 4), 10);
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return [];
  const results: NonWorkingCalendarDay[] = [];
  for (let year = startYear; year <= endYear; year++) {
    for (const h of getBrazilianHolidaysForYear(year)) {
      if (h.date >= fromDateIso && h.date <= toDateIso) {
        results.push({
          date: h.date,
          type: h.type,
          description: h.description,
        });
      }
    }
  }
  return results;
}

/**
 * Carrega os dias sem expediente humano (`holiday`, `bridge`, `suspension`) cadastrados em
 * `commercial_calendar_days` estritamente isolados por `tenantId`.
 * Ignora `extra_work` (ex.: sábado de meta comercial) por segurança operacional.
 */
export async function loadTenantNonWorkingCalendarDays(
  database: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
  fromDateIso: string,
  toDateIso: string,
): Promise<NonWorkingCalendarDay[]> {
  if (!tenantId) return [];

  // Garante seed idempotente dos feriados nacionais até 2030 para este tenant
  await ensureBrazilianHolidaysSeeded(tenantId).catch(() => {});

  try {
    const rows = await database
      .select({
        date: commercialCalendarDays.date,
        type: commercialCalendarDays.type,
        description: commercialCalendarDays.description,
      })
      .from(commercialCalendarDays)
      .where(
        and(
          eq(commercialCalendarDays.tenantId, tenantId),
          gte(commercialCalendarDays.date, fromDateIso),
          lte(commercialCalendarDays.date, toDateIso),
          inArray(commercialCalendarDays.type, ["holiday", "bridge", "suspension"]),
        ),
      )
      .orderBy(asc(commercialCalendarDays.date));

    return rows.map((row) => ({
      date: String(row.date).slice(0, 10),
      type: row.type === "bridge" || row.type === "suspension" ? row.type : "holiday",
      description: String(row.description || "Feriado"),
    }));
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[IndustrialBusinessHours] Falha ao consultar commercial_calendar_days (${tenantId}), usando feriados nacionais como fallback:`,
      errMsg,
    );
    return fallbackNationalHolidaysInRange(fromDateIso, toDateIso);
  }
}

/**
 * Lê a configuração de expediente humano do tenant priorizando `industrial_triage.settings.schedule`
 * e fazendo fallback para `sdr.config.industrialSchedule` (e por fim `DEFAULT_INDUSTRIAL_SCHEDULE`).
 */
export async function loadIndustrialScheduleConfigForTenant(
  database: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
  sdrConfigFallback?: Record<string, unknown> | null,
): Promise<IndustrialScheduleConfig> {
  try {
    const [industrialRow] = await database
      .select({ config: agentConfigs.config })
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.tenantId, tenantId),
          eq(agentConfigs.agentType, INDUSTRIAL_SETTINGS_AGENT),
        ),
      )
      .limit(1);

    const industrialSettingsObj = (
      industrialRow?.config as Record<string, unknown> | null | undefined
    )?.settings as Record<string, unknown> | null | undefined;

    if (
      industrialSettingsObj &&
      typeof industrialSettingsObj.schedule === "object" &&
      industrialSettingsObj.schedule !== null
    ) {
      return parseIndustrialScheduleConfig(industrialSettingsObj);
    }

    if (
      sdrConfigFallback &&
      typeof sdrConfigFallback.industrialSchedule === "object" &&
      sdrConfigFallback.industrialSchedule !== null
    ) {
      return parseIndustrialScheduleConfig(sdrConfigFallback);
    }

    const [sdrRow] = await database
      .select({ config: agentConfigs.config })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr")))
      .limit(1);

    const sdrCfg = (sdrRow?.config as Record<string, unknown> | null | undefined) || {};
    return parseIndustrialScheduleConfig(sdrCfg);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[IndustrialBusinessHours] Falha ao carregar schedule do tenant ${tenantId}, usando fallback:`,
      errMsg,
    );
    return parseIndustrialScheduleConfig(sdrConfigFallback || {});
  }
}

export interface LoadedIndustrialBusinessHours {
  config: IndustrialScheduleConfig;
  nonWorkingDays: NonWorkingCalendarDay[];
  evaluation: IndustrialBusinessHoursEvaluation;
}

/**
 * Carrega configuração + feriados reais do banco para o `tenantId` e devolve a avaliação completa
 * do expediente humano no instante `now`.
 */
export async function loadIndustrialBusinessHoursForTenant(
  database: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
  now: Date = new Date(),
  sdrConfigFallback?: Record<string, unknown> | null,
  windowDaysAhead = 35,
): Promise<LoadedIndustrialBusinessHours> {
  const config = await loadIndustrialScheduleConfigForTenant(database, tenantId, sdrConfigFallback);
  const { dateIso } = getZonedDateParts(now, config.timezone);
  const fromDateIso = addDaysIso(dateIso, -1);
  const toDateIso = addDaysIso(dateIso, Math.max(30, windowDaysAhead));

  const nonWorkingDays = config.respectCommercialCalendar
    ? await loadTenantNonWorkingCalendarDays(database, tenantId, fromDateIso, toDateIso)
    : [];

  const evaluation = evaluateIndustrialBusinessHours(now, config, nonWorkingDays);
  return { config, nonWorkingDays, evaluation };
}
