import { count, eq } from "drizzle-orm";
import { db } from "../../db";
import { commercialCalendarDays } from "../../db/schema";

export type BrazilianHolidayTemplate = {
  date: string;
  type: "holiday" | "bridge" | "extra_work" | "suspension";
  description: string;
  affectsGoal: boolean;
};

/**
 * Calcula o Domingo de Páscoa para um dado ano (Algoritmo de Meeus/Jones/Butcher)
 */
function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addUtcDays(baseDate: Date, deltaDays: number): string {
  const d = new Date(baseDate.getTime() + deltaDays * 86_400_000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Gera todos os feriados nacionais brasileiros (fixos e móveis) para um determinado ano.
 */
export function getBrazilianHolidaysForYear(year: number): BrazilianHolidayTemplate[] {
  const easter = getEasterSunday(year);

  const holidays: BrazilianHolidayTemplate[] = [
    {
      date: `${year}-01-01`,
      type: "holiday",
      description: "Confraternização Universal (Ano Novo)",
      affectsGoal: true,
    },
    {
      date: addUtcDays(easter, -48),
      type: "holiday",
      description: "Carnaval (Segunda-feira)",
      affectsGoal: true,
    },
    {
      date: addUtcDays(easter, -47),
      type: "holiday",
      description: "Carnaval (Terça-feira)",
      affectsGoal: true,
    },
    {
      date: addUtcDays(easter, -2),
      type: "holiday",
      description: "Paixão de Cristo (Sexta-feira Santa)",
      affectsGoal: true,
    },
    {
      date: `${year}-04-21`,
      type: "holiday",
      description: "Tiradentes",
      affectsGoal: true,
    },
    {
      date: `${year}-05-01`,
      type: "holiday",
      description: "Dia Mundial do Trabalho",
      affectsGoal: true,
    },
    {
      date: addUtcDays(easter, 60),
      type: "holiday",
      description: "Corpus Christi",
      affectsGoal: true,
    },
    {
      date: `${year}-09-07`,
      type: "holiday",
      description: "Independência do Brasil",
      affectsGoal: true,
    },
    {
      date: `${year}-10-12`,
      type: "holiday",
      description: "Nossa Senhora Aparecida",
      affectsGoal: true,
    },
    {
      date: `${year}-11-02`,
      type: "holiday",
      description: "Finados",
      affectsGoal: true,
    },
    {
      date: `${year}-11-15`,
      type: "holiday",
      description: "Proclamação da República",
      affectsGoal: true,
    },
    {
      date: `${year}-11-20`,
      type: "holiday",
      description: "Dia Nacional de Zumbi e da Consciência Negra",
      affectsGoal: true,
    },
    {
      date: `${year}-12-25`,
      type: "holiday",
      description: "Natal",
      affectsGoal: true,
    },
  ];

  // Se cair dois feriados no mesmo dia (ex: Tiradentes e Sexta-feira Santa), unifica a descrição
  const byDate = new Map<string, BrazilianHolidayTemplate>();
  for (const h of holidays) {
    const existing = byDate.get(h.date);
    if (existing) {
      existing.description = `${existing.description} / ${h.description}`;
    } else {
      byDate.set(h.date, { ...h });
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Gera a lista completa de feriados brasileiros de startYear até endYear (padrão: 2024 até 2030).
 */
export function getBrazilianHolidaysRange(
  startYear = 2024,
  endYear = 2030,
): BrazilianHolidayTemplate[] {
  const all: BrazilianHolidayTemplate[] = [];
  for (let y = startYear; y <= endYear; y++) {
    all.push(...getBrazilianHolidaysForYear(y));
  }
  return all;
}

const seededTenantsCache = new Set<string>();

/**
 * Garante que todos os feriados nacionais brasileiros até 2030 estejam populados
 * no banco de dados para o tenant informado, sem sobrescrever edições manuais.
 */
export async function ensureBrazilianHolidaysSeeded(tenantId: string): Promise<void> {
  if (!tenantId || seededTenantsCache.has(tenantId)) return;

  try {
    const [existingCountRow] = await db
      .select({ total: count() })
      .from(commercialCalendarDays)
      .where(eq(commercialCalendarDays.tenantId, tenantId));

    const existingCount = Number(existingCountRow?.total ?? 0);
    // 2024..2030 possui ~91 feriados nacionais. Se houver menos de 40 cadastrados, fazemos o seed até 2030.
    if (existingCount < 40) {
      const templates = getBrazilianHolidaysRange(2024, 2030);
      const valuesToInsert = templates.map((item) => ({
        id: `br-holiday-${tenantId}-${item.date}`,
        tenantId,
        date: item.date,
        type: item.type,
        scope: "internal",
        description: item.description,
        affectsGoal: item.affectsGoal,
        createdByOperatorId: null,
      }));

      await db
        .insert(commercialCalendarDays)
        .values(valuesToInsert)
        .onConflictDoNothing({
          target: [commercialCalendarDays.tenantId, commercialCalendarDays.date],
        });
    }

    seededTenantsCache.add(tenantId);
  } catch (err) {
    console.error("[brazilian-holidays] Falha não-bloqueante ao semear feriados até 2030:", err);
  }
}
