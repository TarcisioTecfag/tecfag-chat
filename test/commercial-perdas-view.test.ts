import { describe, expect, it } from "bun:test";
import {
  ALL_PERDAS_PERIODS,
  BASELINE_PERDAS_MES_ATUAL,
  BASELINE_PERDAS_MES_PASSADO,
  BASELINE_PERDAS_GERAL_HISTORICO,
} from "../src/lib/commercial/perdas-data";

describe("Commercial Perdas & Motivos de Perda (Slide 5 - War Room)", () => {
  describe("Mês Atual (Foto 1 - 55 Perdas)", () => {
    it("deve conter metadados e totalizador de 55 perdas", () => {
      expect(BASELINE_PERDAS_MES_ATUAL.key).toBe("mes_atual");
      expect(BASELINE_PERDAS_MES_ATUAL.title).toBe("MÊS ATUAL");
      expect(BASELINE_PERDAS_MES_ATUAL.totalCount).toBe(55);
      expect(BASELINE_PERDAS_MES_ATUAL.subtitlePeriod).toBe("outubro de 2026");
      expect(BASELINE_PERDAS_MES_ATUAL.subtitleMetric).toBe("-99% vs mês anterior");
      expect(BASELINE_PERDAS_MES_ATUAL.headerFilterLabel).toBe("outubro de 2026");
    });

    it("deve conter as 5 categorias mapeadas ordenadas por relevância", () => {
      const cats = BASELINE_PERDAS_MES_ATUAL.categories;
      expect(cats).toHaveLength(5);

      // Comportamento / Cliente (40 perdas - 72.7%)
      const comp = cats.find((c) => c.key === "comportamento")!;
      expect(comp).toBeDefined();
      expect(comp.count).toBe(40);
      expect(comp.percent).toBe(72.7);
      expect(comp.colorHex).toBe("#3b82f6");
      expect(comp.iconName).toBe("users");
      const sumSubComp = comp.subReasons.reduce((acc, s) => acc + s.count, 0);
      expect(sumSubComp).toBe(40);
      expect(comp.subReasons[0].label).toBe("Cliente não atende/responde ao contados");
      expect(comp.subReasons[0].count).toBe(26);

      // Concorrência / Solução (6 perdas - 10.9%)
      const conc = cats.find((c) => c.key === "concorrencia")!;
      expect(conc).toBeDefined();
      expect(conc.count).toBe(6);
      expect(conc.percent).toBe(10.9);
      expect(conc.colorHex).toBe("#f59e0b");
      const sumSubConc = conc.subReasons.reduce((acc, s) => acc + s.count, 0);
      expect(sumSubConc).toBe(6);

      // Outros Motivos (4 perdas - 7.3%)
      const out = cats.find((c) => c.key === "outros")!;
      expect(out).toBeDefined();
      expect(out.count).toBe(4);
      expect(out.percent).toBe(7.3);
      expect(out.colorHex).toBe("#06b6d4");

      // Preço / Financeiro (3 perdas - 5.5%)
      const preco = cats.find((c) => c.key === "preco")!;
      expect(preco).toBeDefined();
      expect(preco.count).toBe(3);
      expect(preco.percent).toBe(5.5);
      expect(preco.colorHex).toBe("#ef4444");

      // Processo / Prazos (2 perdas - 3.6%)
      const proc = cats.find((c) => c.key === "processo")!;
      expect(proc).toBeDefined();
      expect(proc.count).toBe(2);
      expect(proc.percent).toBe(3.6);
      expect(proc.colorHex).toBe("#a855f7");

      // Soma total de categorias = 55
      const totalCategorias = cats.reduce((acc, c) => acc + c.count, 0);
      expect(totalCategorias).toBe(55);
    });
  });

  describe("Mês Passado (Foto 2 - 6183 Perdas)", () => {
    it("deve conter metadados e totalizador de 6183 perdas", () => {
      expect(BASELINE_PERDAS_MES_PASSADO.key).toBe("mes_passado");
      expect(BASELINE_PERDAS_MES_PASSADO.title).toBe("MÊS PASSADO");
      expect(BASELINE_PERDAS_MES_PASSADO.totalCount).toBe(6183);
      expect(BASELINE_PERDAS_MES_PASSADO.subtitlePeriod).toBe("setembro de 2026");
      expect(BASELINE_PERDAS_MES_PASSADO.subtitleMetric).toBe("6183 perdas fechadas");
      expect(BASELINE_PERDAS_MES_PASSADO.headerFilterLabel).toBe("setembro de 2026");
    });

    it("deve conter as 5 categorias e submotivos com contagens exatas da foto 2", () => {
      const cats = BASELINE_PERDAS_MES_PASSADO.categories;
      expect(cats).toHaveLength(5);

      // Outros Motivos (5540 perdas - 89.6%)
      const out = cats.find((c) => c.key === "outros")!;
      expect(out.count).toBe(5540);
      expect(out.percent).toBe(89.6);
      const negParada = out.subReasons.find((s) => s.label === "Negociação parada sem interação")!;
      expect(negParada.count).toBe(5287);
      expect(out.subReasons.reduce((acc, s) => acc + s.count, 0)).toBe(5540);

      // Comportamento / Cliente (481 perdas - 7.8%)
      const comp = cats.find((c) => c.key === "comportamento")!;
      expect(comp.count).toBe(481);
      expect(comp.percent).toBe(7.8);
      expect(comp.subReasons.reduce((acc, s) => acc + s.count, 0)).toBe(481);

      // Concorrência / Solução (102 perdas - 1.6%)
      const conc = cats.find((c) => c.key === "concorrencia")!;
      expect(conc.count).toBe(102);
      expect(conc.percent).toBe(1.6);
      expect(conc.subReasons.reduce((acc, s) => acc + s.count, 0)).toBe(102);

      // Preço / Financeiro (54 perdas - 0.9%)
      const preco = cats.find((c) => c.key === "preco")!;
      expect(preco.count).toBe(54);
      expect(preco.percent).toBe(0.9);
      expect(preco.subReasons.reduce((acc, s) => acc + s.count, 0)).toBe(54);

      // Processo / Prazos (6 perdas - 0.1%)
      const proc = cats.find((c) => c.key === "processo")!;
      expect(proc.count).toBe(6);
      expect(proc.percent).toBe(0.1);
      expect(proc.subReasons.reduce((acc, s) => acc + s.count, 0)).toBe(6);

      // Soma total de categorias = 6183
      const totalCategorias = cats.reduce((acc, c) => acc + c.count, 0);
      expect(totalCategorias).toBe(6183);
    });
  });

  describe("Geral Histórico (Foto 3 - 8599 Perdas)", () => {
    it("deve conter metadados e totalizador de 8599 perdas", () => {
      expect(BASELINE_PERDAS_GERAL_HISTORICO.key).toBe("geral_historico");
      expect(BASELINE_PERDAS_GERAL_HISTORICO.title).toBe("GERAL HISTÓRICO");
      expect(BASELINE_PERDAS_GERAL_HISTORICO.totalCount).toBe(8599);
      expect(BASELINE_PERDAS_GERAL_HISTORICO.subtitlePeriod).toBe("Média: 573.3/mês");
      expect(BASELINE_PERDAS_GERAL_HISTORICO.subtitleMetric).toBe("Desde ago/2024 (15 meses)");
      expect(BASELINE_PERDAS_GERAL_HISTORICO.headerFilterLabel).toBe("Média: 573.3/mês");
    });

    it("deve conter as 5 categorias e submotivos com contagens exatas da foto 3", () => {
      const cats = BASELINE_PERDAS_GERAL_HISTORICO.categories;
      expect(cats).toHaveLength(5);

      // Outros Motivos (6520 perdas - 75.8%)
      const out = cats.find((c) => c.key === "outros")!;
      expect(out.count).toBe(6520);
      expect(out.percent).toBe(75.8);
      expect(out.subReasons.reduce((acc, s) => acc + s.count, 0)).toBe(6520);

      // Comportamento / Cliente (1546 perdas - 18.0%)
      const comp = cats.find((c) => c.key === "comportamento")!;
      expect(comp.count).toBe(1546);
      expect(comp.percent).toBe(18.0);
      expect(comp.subReasons.reduce((acc, s) => acc + s.count, 0)).toBe(1546);

      // Concorrência / Solução (343 perdas - 4.0%)
      const conc = cats.find((c) => c.key === "concorrencia")!;
      expect(conc.count).toBe(343);
      expect(conc.percent).toBe(4.0);
      expect(conc.subReasons.reduce((acc, s) => acc + s.count, 0)).toBe(343);

      // Preço / Financeiro (150 perdas - 1.7%)
      const preco = cats.find((c) => c.key === "preco")!;
      expect(preco.count).toBe(150);
      expect(preco.percent).toBe(1.7);
      expect(preco.subReasons.reduce((acc, s) => acc + s.count, 0)).toBe(150);

      // Processo / Prazos (40 perdas - 0.5%)
      const proc = cats.find((c) => c.key === "processo")!;
      expect(proc.count).toBe(40);
      expect(proc.percent).toBe(0.5);
      expect(proc.subReasons.reduce((acc, s) => acc + s.count, 0)).toBe(40);

      // Soma total de categorias = 8599
      const totalCategorias = cats.reduce((acc, c) => acc + c.count, 0);
      expect(totalCategorias).toBe(8599);
    });
  });

  describe("Coleção Global de Períodos", () => {
    it("deve exportar ALL_PERDAS_PERIODS com os 3 horizontes temporais", () => {
      expect(ALL_PERDAS_PERIODS.mes_atual).toBe(BASELINE_PERDAS_MES_ATUAL);
      expect(ALL_PERDAS_PERIODS.mes_passado).toBe(BASELINE_PERDAS_MES_PASSADO);
      expect(ALL_PERDAS_PERIODS.geral_historico).toBe(BASELINE_PERDAS_GERAL_HISTORICO);
    });
  });
});
