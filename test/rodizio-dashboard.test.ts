import { describe, it, expect } from "bun:test";
import {
  SECTOR_CONFIGS,
  getOperatorSector,
  getBenchmarkRodizioData,
  FUNNEL_LABELS,
  FUNNEL_COLORS,
} from "../src/components/valentina/rodizio-dashboard-data";
import { getAiPersona } from "../src/lib/ai-persona";
import { resolveRodizioOpTimeWindow } from "../src/lib/valentina/rodizio-types";

describe("Dashboard de Rodízio de IA (Fagner / Valentina)", () => {
  it("deve conter a configuração visual oficial dos 6 setores", () => {
    const requiredSectors = ["sdr", "personalite", "maquinas", "pos venda", "financeiro", "pecas"];
    for (const key of requiredSectors) {
      expect(SECTOR_CONFIGS[key]).toBeDefined();
      expect(SECTOR_CONFIGS[key].label).toBeDefined();
      expect(SECTOR_CONFIGS[key].accent).toBeDefined();
      expect(SECTOR_CONFIGS[key].color).toBeDefined();
    }
  });

  it("deve mapear corretamente operadores para seus respectivos setores", () => {
    // SDR
    expect(getOperatorSector({ name: "Rafaela Lima", is_sdr: true })).toBe("sdr");
    expect(getOperatorSector({ name: "Triagem Bot", sector: "triagem" })).toBe("sdr");

    // Personnalité
    expect(getOperatorSector({ name: "Diana Gimenes - 93" })).toBe("personalite");
    expect(getOperatorSector({ name: "Jhordan Rueda - 102" })).toBe("personalite");
    expect(getOperatorSector({ name: "Rosenvaldo Lucas - 121" })).toBe("personalite");
    expect(getOperatorSector({ name: "Consultor X", allowed_subflows: ["personalite"] })).toBe("personalite");

    // Máquinas
    expect(getOperatorSector({ name: "Denise Gomes - 34" })).toBe("maquinas");
    expect(getOperatorSector({ name: "Beatriz Ribeiro - 96" })).toBe("maquinas");
    expect(getOperatorSector({ name: "Victor Goes - 95" })).toBe("maquinas");
    expect(getOperatorSector({ name: "Vendedor Y", sector: "maquinas industriais" })).toBe("maquinas");

    // Pós Venda
    expect(getOperatorSector({ name: "Deborah Alves - 94" })).toBe("pos venda");
    expect(getOperatorSector({ name: "Raiane Aguiar - 114" })).toBe("pos venda");
    expect(getOperatorSector({ name: "Lucimara Dal Mora" })).toBe("pos venda");

    // Financeiro
    expect(getOperatorSector({ name: "Jessica Pimentel" })).toBe("financeiro");
    expect(getOperatorSector({ name: "Cobrança", sector: "financeiro" })).toBe("financeiro");

    // Peças
    expect(getOperatorSector({ name: "Guilherme Bertola - 115" })).toBe("pecas");
    expect(getOperatorSector({ name: "Keicy Cardoso" })).toBe("pecas");

    // Precedência soberana da área configurada na escala (rawArea)
    expect(getOperatorSector({ name: "Isabella Inhesta", rawArea: "outros" })).toBe("sdr");
    expect(getOperatorSector({ name: "Cesar Trassatte", rawArea: "outros" })).toBe("sdr");
    expect(getOperatorSector({ name: "Operador Escala Peças", rawArea: "pecas", is_sdr: true })).toBe("pecas");
  });

  it("deve retornar estrutura zerada sem mocks em getBenchmarkRodizioData", () => {
    const data = getBenchmarkRodizioData("tecfag");

    expect(data.stats).toBeDefined();
    expect(data.stats.totalLeads).toBe(0);
    expect(data.stats.triageRate).toBe(0);
    expect(data.stats.syncedToCrm).toBe(0);
    expect(data.stats.avgScore).toBe("0.0");
    expect(data.stats.activeSessions).toBe(0);

    expect(data.byDay).toEqual([]);
    expect(data.byFunnel).toEqual([]);
    expect(data.operators).toEqual([]);
    expect(data.deals).toEqual([]);
  });

  it("deve ancorar o filtro padrão de Leads por Operador no dia civil de Hoje em Brasília (00:00 às 23:59)", () => {
    const nowMorningBrt = new Date("2026-11-10T09:30:00.000-03:00");

    // Padrão (sem opDays informado) -> Hoje estrito
    const defaultWin = resolveRodizioOpTimeWindow({}, nowMorningBrt);
    expect(defaultWin.startDate?.toISOString()).toBe(new Date("2026-11-10T00:00:00.000-03:00").toISOString());
    expect(defaultWin.endDate?.toISOString()).toBe(new Date("2026-11-10T23:59:59.999-03:00").toISOString());

    // Lead de ontem às 18:00 BRT NÃO entra no filtro Hoje às 09:30 BRT
    const yesterdayAfternoonMs = new Date("2026-11-09T18:00:00.000-03:00").getTime();
    expect(yesterdayAfternoonMs < (defaultWin.startMs ?? 0)).toBe(true);

    // 3 dias civis (08/11 00:00 até 10/11 23:59:59.999 BRT)
    const threeDaysWin = resolveRodizioOpTimeWindow({ opDays: 3 }, nowMorningBrt);
    expect(threeDaysWin.startDate?.toISOString()).toBe(new Date("2026-11-08T00:00:00.000-03:00").toISOString());
    expect(threeDaysWin.endDate?.toISOString()).toBe(new Date("2026-11-10T23:59:59.999-03:00").toISOString());

    // Tudo (3650) -> sem limite
    const allTimeWin = resolveRodizioOpTimeWindow({ opDays: 3650 }, nowMorningBrt);
    expect(allTimeWin.startMs).toBeNull();
    expect(allTimeWin.endMs).toBeNull();
  });

  it("deve conter rótulos e cores válidas para o gráfico de funil", () => {
    const expectedFunnels = ["maquinas", "sem-resposta", "pecas", "pos-venda", "personalite", "comercial"];
    for (const f of expectedFunnels) {
      expect(FUNNEL_LABELS[f]).toBeDefined();
      expect(FUNNEL_COLORS[f]).toBeDefined();
    }
  });

  it("deve adaptar a persona dinamicamente conforme o tenant (Fagner vs Valentina)", () => {
    const personaFagner = getAiPersona("tecfag");
    expect(personaFagner.name).toBe("Fagner");
    expect(personaFagner.gender).toBe("male");

    const personaValem = getAiPersona("valem");
    expect(personaValem.name).toBe("Valentina");
    expect(personaValem.gender).toBe("female");
  });

  it("não deve conter emojis nos rótulos dos setores (deve usar estritamente ícones vetoriais)", () => {
    const emojiRegex = /(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u;
    for (const key of Object.keys(SECTOR_CONFIGS)) {
      expect(emojiRegex.test(SECTOR_CONFIGS[key].label)).toBe(false);
      expect(emojiRegex.test(SECTOR_CONFIGS[key].shortLabel)).toBe(false);
    }
  });
});
