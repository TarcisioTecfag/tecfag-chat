import { describe, expect, it } from "bun:test";
import {
  BASELINE_DIRETRIZES_KPIS,
  BASELINE_DIRETRIZES_PERSONNALITE,
  BASELINE_DIRETRIZES_MAQUINAS,
  ALL_BASELINE_DIRETRIZES_CONSULTANTS,
  getAllDiretrizesDeals,
  getConsultantDiretrizes,
} from "../src/lib/commercial/diretrizes-crm-data";

describe("Commercial Diretrizes CRM (CWR Slide 7 & Gestão Comercial)", () => {
  it("deve conter exatamente os KPIs de topo da Foto 1 de referência", () => {
    expect(BASELINE_DIRETRIZES_KPIS.totalDeals).toBe(14);
    expect(BASELINE_DIRETRIZES_KPIS.totalValue).toBe(455_000);
    expect(BASELINE_DIRETRIZES_KPIS.formattedTotalValue).toBe("R$ 455.000");
    expect(BASELINE_DIRETRIZES_KPIS.taxaExecucaoPercent).toBe(100);
    expect(BASELINE_DIRETRIZES_KPIS.concluidasCount).toBe(14);
    expect(BASELINE_DIRETRIZES_KPIS.totalCount).toBe(14);
    expect(BASELINE_DIRETRIZES_KPIS.atrasoCount).toBe(0);
    expect(BASELINE_DIRETRIZES_KPIS.atrasoLabel).toBe("Tudo no prazo");
  });

  it("deve conter os 4 consultores do Time Personnalité com Diana Gimenes ativa (Foto 1)", () => {
    const consultants = BASELINE_DIRETRIZES_PERSONNALITE.consultants;
    expect(consultants).toHaveLength(4);

    const names = consultants.map((c) => c.name);
    expect(names).toEqual([
      "Diana Gimenes",
      "Jhordan Rueda",
      "Marcelo Nardelli",
      "Rosenvaldo Lucas",
    ]);

    // Diana Gimenes
    const diana = consultants[0];
    expect(diana.totalDirectives).toBe(2);
    expect(diana.concluidas).toBe(2);
    expect(diana.pendenteHoje).toBe(0);
    expect(diana.atrasadas).toBe(0);
    expect(diana.taxaExecucaoPercent).toBe(100);
    expect(diana.totalValue).toBe(22_000);
    expect(diana.formattedValue).toBe("R$ 22k");
    expect(diana.deals).toHaveLength(2);

    // Os outros 3 devem ter 0 diretrizes e taxa nula ("—")
    for (let i = 1; i < 4; i++) {
      expect(consultants[i].totalDirectives).toBe(0);
      expect(consultants[i].concluidas).toBe(0);
      expect(consultants[i].taxaExecucaoPercent).toBeNull();
      expect(consultants[i].totalValue).toBe(0);
      expect(consultants[i].formattedValue).toBe("R$ 0");
    }
  });

  it("deve conter os 6 consultores do Time Máquinas / Semi com Melissa e Victor ativos (Foto 1)", () => {
    const consultants = BASELINE_DIRETRIZES_MAQUINAS.consultants;
    expect(consultants).toHaveLength(6);

    const names = consultants.map((c) => c.name);
    expect(names).toEqual([
      "Andreia Camargo",
      "Beatriz Ribeiro",
      "Denise Gomes",
      "Melissa Gomes",
      "MERCADO LIVRE / Deborah",
      "Victor Goes",
    ]);

    // Melissa Gomes (4 diretrizes = R$ 86k)
    const melissa = consultants[3];
    expect(melissa.totalDirectives).toBe(4);
    expect(melissa.concluidas).toBe(4);
    expect(melissa.pendenteHoje).toBe(0);
    expect(melissa.atrasadas).toBe(0);
    expect(melissa.taxaExecucaoPercent).toBe(100);
    expect(melissa.totalValue).toBe(86_000);
    expect(melissa.formattedValue).toBe("R$ 86k");
    expect(melissa.deals).toHaveLength(4);

    // Victor Goes (8 diretrizes = R$ 347k)
    const victor = consultants[5];
    expect(victor.totalDirectives).toBe(8);
    expect(victor.concluidas).toBe(8);
    expect(victor.pendenteHoje).toBe(0);
    expect(victor.atrasadas).toBe(0);
    expect(victor.taxaExecucaoPercent).toBe(100);
    expect(victor.totalValue).toBe(347_000);
    expect(victor.formattedValue).toBe("R$ 347k");
    expect(victor.deals).toHaveLength(8);

    // Demais com 0 diretrizes
    const zeros = [consultants[0], consultants[1], consultants[2], consultants[4]];
    for (const c of zeros) {
      expect(c.totalDirectives).toBe(0);
      expect(c.taxaExecucaoPercent).toBeNull();
      expect(c.formattedValue).toBe("R$ 0");
    }
  });

  it("deve validar a integridade matemática global (14 deals e R$ 455.000 exatos)", () => {
    const allConsultants = ALL_BASELINE_DIRETRIZES_CONSULTANTS;
    expect(allConsultants).toHaveLength(10);

    const sumDeals = allConsultants.reduce((acc, c) => acc + c.totalDirectives, 0);
    expect(sumDeals).toBe(14);

    const sumConcluidas = allConsultants.reduce((acc, c) => acc + c.concluidas, 0);
    expect(sumConcluidas).toBe(14);

    const sumValue = allConsultants.reduce((acc, c) => acc + c.totalValue, 0);
    expect(sumValue).toBe(455_000);

    const allDeals = getAllDiretrizesDeals();
    expect(allDeals).toHaveLength(14);

    const sumDealsValues = allDeals.reduce((acc, d) => acc + d.value, 0);
    expect(sumDealsValues).toBe(455_000);
  });

  it("deve conter os detalhes dos deals de Diana Gimenes idênticos à Foto 2 de referência", () => {
    const diana = getConsultantDiretrizes("diana-gimenes");
    expect(diana).toBeDefined();
    if (!diana) return;

    expect(diana.deals).toHaveLength(2);

    const deal1 = diana.deals[0];
    expect(deal1.title).toBe("(Cópia) Tarcísio Silva — triagem nova TESTE");
    expect(deal1.status).toBe("concluida");
    expect(deal1.value).toBe(12_000);
    expect(deal1.formattedValue).toBe("R$ 12.000,00");
    expect(deal1.crmStage).toBe("Leads Recebidos (Faltam 15d p/ maturar)");
    expect(deal1.assignedAt).toBe("2026-10-01");
    expect(deal1.gestorDirective).toBe("GESTOR PONTUOU ATENÇÃO E EXECUÇÃO NESSA NEGOCIAÇÃO");
    expect(deal1.consultantResponse).toBe("EXECUÇÃO CONCLUÍDA PELO DIANA VIA LIGAÇÃO: responsavel");

    const deal2 = diana.deals[1];
    expect(deal2.title).toBe("Tarcísio Silva — triagem nova TESTE");
    expect(deal2.status).toBe("concluida");
    expect(deal2.value).toBe(10_000);
    expect(deal2.formattedValue).toBe("R$ 10.000,00");
    expect(deal2.crmStage).toBe("Leads Recebidos (Faltam 10d p/ maturar)");
    expect(deal2.assignedAt).toBe("2026-10-01");
    expect(deal2.gestorDirective).toBe("GESTOR PONTUOU ATENÇÃO E EXECUÇÃO NESSA NEGOCIAÇÃO");
    expect(deal2.consultantResponse).toBe("EXECUÇÃO CONCLUÍDA PELO DIANA VIA E-MAIL: Tratativa finalizada. Evidência arquivada no portal.");
  });

  it("deve conter tratativas e diretrizes do gestor preenchidas em 100% dos deals", () => {
    const allDeals = getAllDiretrizesDeals();
    for (const d of allDeals) {
      expect(d.gestorDirective.length).toBeGreaterThan(10);
      expect(d.consultantResponse.length).toBeGreaterThan(10);
      expect(d.status).toBe("concluida");
      expect(d.formattedValue).toMatch(/^R\$ /);
    }
  });
});
