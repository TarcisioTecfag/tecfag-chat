import { describe, it, expect } from "bun:test";
import {
  SECTOR_CONFIGS,
  getOperatorSector,
  getBenchmarkRodizioData,
  FUNNEL_LABELS,
  FUNNEL_COLORS,
} from "../src/components/valentina/rodizio-dashboard-data";
import { getAiPersona } from "../src/lib/ai-persona";

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
  });

  it("deve carregar dados de benchmark de alta fidelidade com os 5 KPIs de topo", () => {
    const data = getBenchmarkRodizioData("tecfag");

    expect(data.stats).toBeDefined();
    expect(data.stats.totalLeads).toBe(7207);
    expect(data.stats.triageRate).toBe(82);
    expect(data.stats.syncedToCrm).toBe(6052);
    expect(data.stats.avgScore).toBe("2.6");
    expect(data.stats.activeSessions).toBe(0);

    expect(data.byDay.length).toBeGreaterThan(0);
    expect(data.byFunnel.length).toBeGreaterThan(0);
    expect(data.operators.length).toBeGreaterThan(0);
    expect(data.deals.length).toBeGreaterThan(0);
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
});
