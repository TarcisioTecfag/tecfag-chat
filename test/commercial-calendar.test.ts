import { describe, expect, it } from "bun:test";

describe("Cálculos e Regras do Cockpit de Metas e Fechamentos Diários (Calendário)", () => {
  it("calcula linearDailyTarget e dailyRequired exatamente conforme a fórmula do pacing", () => {
    const totalTarget = 4_830_000;
    const totalRealized = 1_070_000;
    const businessDays = 22;
    const elapsedDays = 5;
    const remainingDays = businessDays - elapsedDays; // 17

    const gap = Math.max(0, totalTarget - totalRealized); // 3_760_000
    expect(gap).toBe(3_760_000);

    const linearDailyTarget = totalTarget / businessDays;
    // 4.830.000 / 22 = 219.545,45...
    expect(Math.round(linearDailyTarget)).toBe(219_545);

    const dailyRequired = gap / remainingDays;
    // 3.760.000 / 17 = 221.176,47... (~221,2k - 221,3k)
    expect(Math.round(dailyRequired)).toBe(221_176);

    const attainment = (totalRealized / totalTarget) * 100;
    expect(attainment).toBeGreaterThan(22.0);
    expect(attainment).toBeLessThan(22.3);
  });

  it("calcula projeção de run rate baseada nos dias úteis decorridos", () => {
    const totalTarget = 4_830_000;
    const totalRealized = 1_070_000;
    const businessDays = 22;
    const elapsedDays = 5;

    // Run rate: (1.070.000 / 5) * 22 = 4.708.000 (~R$ 4,70M)
    const runRate = (totalRealized / elapsedDays) * businessDays;
    expect(Math.round(runRate)).toBe(4_708_000);
    expect(runRate < totalTarget).toBe(true); // Ritmo precisa acelerar
  });

  it("calcula o offset de dia da semana iniciando na Segunda-Feira (SEG a DOM)", () => {
    // 01/10/2026: Outubro de 2026 começa em uma Quinta-Feira (Thursday)
    // Date.getUTCDay(): Dom=0, Seg=1, Ter=2, Qua=3, Qui=4, Sex=5, Sab=6
    // Fórmula para início na Segunda: (getUTCDay() + 6) % 7
    // Quinta (4) -> (4 + 6) % 7 = 10 % 7 = 3 (offset de 3 células: Seg, Ter, Qua)
    const d = new Date(Date.UTC(2026, 9, 1)); // 01/10/2026
    const weekday = d.getUTCDay();
    const offsetMonday = (weekday + 6) % 7;
    expect(offsetMonday).toBe(3);
  });

  it("classifica corretamente o status do dia comercial (BATIDA, PARCIAL, ZERADO, ALVO, HOJE)", () => {
    const linearDailyTarget = 219_545;
    const today = "2026-10-07";

    function getDayStatus({
      dateStr,
      isWorkingDay,
      salesValue,
      isHoliday,
    }: {
      dateStr: string;
      isWorkingDay: boolean;
      salesValue: number;
      isHoliday?: boolean;
    }) {
      if (dateStr === today) return "HOJE";
      if (isHoliday) return "FERIADO";
      if (!isWorkingDay) return null;
      if (dateStr < today) {
        if (salesValue >= linearDailyTarget) return "BATIDA";
        if (salesValue > 0) return "PARCIAL";
        return "ZERADO";
      }
      return "ALVO";
    }

    // Dia 5: R$ 14,8k (parcial)
    expect(
      getDayStatus({ dateStr: "2026-10-05", isWorkingDay: true, salesValue: 14_800 }),
    ).toBe("PARCIAL");

    // Dia 6: R$ 854,4k (batida)
    expect(
      getDayStatus({ dateStr: "2026-10-06", isWorkingDay: true, salesValue: 854_400 }),
    ).toBe("BATIDA");

    // Dia 7: Hoje
    expect(
      getDayStatus({ dateStr: "2026-10-07", isWorkingDay: true, salesValue: 7_434 }),
    ).toBe("HOJE");

    // Dia 8: Futuro
    expect(
      getDayStatus({ dateStr: "2026-10-08", isWorkingDay: true, salesValue: 0 }),
    ).toBe("ALVO");

    // Fim de semana
    expect(
      getDayStatus({ dateStr: "2026-10-04", isWorkingDay: false, salesValue: 0 }),
    ).toBe(null);

    // Feriado
    expect(
      getDayStatus({ dateStr: "2026-10-12", isWorkingDay: false, salesValue: 0, isHoliday: true }),
    ).toBe("FERIADO");
  });

  it("gera a Curva S com meta linear acumulada crescente e realizado interrompendo após hoje", () => {
    const totalDays = 31;
    const todayDay = 7;
    const dailyTarget = 219_545;
    const dailySalesMap: Record<number, number> = {
      1: 30_300,
      2: 161_200,
      5: 14_800,
      6: 854_400,
      7: 7_434,
    };

    let accumExpected = 0;
    let accumRealized = 0;
    const points = [];

    for (let d = 1; d <= totalDays; d++) {
      accumExpected += dailyTarget;
      accumRealized += dailySalesMap[d] || 0;
      const plotRealized = d <= todayDay ? accumRealized : null;

      points.push({
        day: d,
        expected: accumExpected,
        realized: plotRealized,
      });
    }

    expect(points).toHaveLength(31);
    expect(points[6].day).toBe(7);
    expect(points[6].realized).toBe(1_068_134); // ~1,07M
    expect(points[7].day).toBe(8);
    expect(points[7].realized).toBe(null); // dias futuros ficam nulos para interromper a linha em hoje
  });
});
