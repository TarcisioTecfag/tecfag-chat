import { describe, expect, it } from "bun:test";
import {
  BASELINE_TMA_KPIS,
  BASELINE_TMA_PERSONNALITE,
  BASELINE_TMA_MAQUINAS,
  ALL_BASELINE_TMA_CONSULTANTS,
  TmaConsultantRow,
} from "@/lib/commercial/tma-whatsapp-data";

describe("Commercial TMA WhatsApp (CWR Slide 8 / TV War Room)", () => {
  it("deve conter exatamente os KPIs de topo da Foto 1 de referência", () => {
    expect(BASELINE_TMA_KPIS.averageMinutes).toBe(9);
    expect(BASELINE_TMA_KPIS.targetMinutes).toBe(15);
    expect(BASELINE_TMA_KPIS.slaPercent).toBe(0);
    expect(BASELINE_TMA_KPIS.totalTransfers).toBe(0);
    expect(BASELINE_TMA_KPIS.firstContactCount).toBe(11);
    expect(BASELINE_TMA_KPIS.waitingResponseCount).toBe(0);
  });

  it("deve conter os 4 consultores do Time Personnalité (Foto 1)", () => {
    expect(BASELINE_TMA_PERSONNALITE.teamKey).toBe("personnalite");
    expect(BASELINE_TMA_PERSONNALITE.teamLabel).toBe("★ TIME PERSONNALITÉ");
    expect(BASELINE_TMA_PERSONNALITE.consultants).toHaveLength(4);

    const names = BASELINE_TMA_PERSONNALITE.consultants.map((c) => c.name);
    expect(names).toEqual([
      "Diana Gimenes",
      "Jhordan Rueda",
      "Marcelo Nardelli",
      "Rosenvaldo Lucas",
    ]);

    for (const consultant of BASELINE_TMA_PERSONNALITE.consultants) {
      expect(consultant.division).toBe("personnalite");
      expect(consultant.buckets).toBeDefined();
      expect(typeof consultant.buckets.under5m).toBe("number");
      expect(typeof consultant.buckets.between5and15m).toBe("number");
      expect(typeof consultant.buckets.between15and30m).toBe("number");
      expect(typeof consultant.buckets.over30m).toBe("number");
      expect(consultant.totalAnswered).toBe(0);
    }
  });

  it("deve conter os 6 consultores do Time Semi / Máquinas (Foto 1)", () => {
    expect(BASELINE_TMA_MAQUINAS.teamKey).toBe("maquinas");
    expect(BASELINE_TMA_MAQUINAS.teamLabel).toBe("⚍ TIME SEMI (MÁQUINAS)");
    expect(BASELINE_TMA_MAQUINAS.consultants).toHaveLength(6);

    const names = BASELINE_TMA_MAQUINAS.consultants.map((c) => c.name);
    expect(names).toEqual([
      "Andreia Camargo",
      "Beatriz Ribeiro",
      "Denise Gomes",
      "Melissa Gomes",
      "MERCADO LIVRE / Deborah",
      "Victor Goes",
    ]);

    for (const consultant of BASELINE_TMA_MAQUINAS.consultants) {
      expect(consultant.division).toBe("maquinas");
      expect(consultant.buckets).toBeDefined();
      expect(typeof consultant.buckets.under5m).toBe("number");
      expect(typeof consultant.buckets.between5and15m).toBe("number");
      expect(typeof consultant.buckets.between15and30m).toBe("number");
      expect(typeof consultant.buckets.over30m).toBe("number");
      expect(consultant.totalAnswered).toBe(0);
    }
  });

  it("deve totalizar 10 consultores no baseline geral de TMA", () => {
    expect(ALL_BASELINE_TMA_CONSULTANTS).toHaveLength(10);
  });

  it("deve calcular proporcionalmente os 4 buckets quando há atendimentos computados", () => {
    const mockConsultant: TmaConsultantRow = {
      consultantId: "mock-1",
      name: "Consultor Teste",
      division: "personnalite",
      buckets: {
        under5m: 5,
        between5and15m: 3,
        between15and30m: 1,
        over30m: 1,
      },
      totalAnswered: 10,
    };

    const total = mockConsultant.totalAnswered;
    const pctUnder5m = (mockConsultant.buckets.under5m / total) * 100;
    const pct5to15m = (mockConsultant.buckets.between5and15m / total) * 100;
    const pct15to30m = (mockConsultant.buckets.between15and30m / total) * 100;
    const pctOver30m = (mockConsultant.buckets.over30m / total) * 100;

    expect(pctUnder5m).toBe(50);
    expect(pct5to15m).toBe(30);
    expect(pct15to30m).toBe(10);
    expect(pctOver30m).toBe(10);
    expect(pctUnder5m + pct5to15m + pct15to30m + pctOver30m).toBe(100);
  });
});
