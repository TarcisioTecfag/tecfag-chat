import { describe, expect, it } from "bun:test";
import {
  categorize,
  categorizeLossReason,
  DEFAULT_LOSS_REASON_CATEGORIES,
  getLossCategoryMeta,
  normalizeLossReason,
  OFFICIAL_LOSS_CATEGORIES,
} from "../src/lib/commercial/perdas-data";
import { toLossPresentation } from "../src/lib/commercial/presentation-data";

describe("Motor de Classificação de Motivos de Perda (War Room & CRM Tecfag)", () => {
  describe("Estrutura das 5 Categorias Oficiais e dos 26 Motivos Mapeados", () => {
    it("deve conter exatamente as 5 categorias oficiais", () => {
      expect(DEFAULT_LOSS_REASON_CATEGORIES).toHaveLength(5);
      const names = DEFAULT_LOSS_REASON_CATEGORIES.map((c) => c.name);
      expect(names).toContain("Comportamento / Cliente");
      expect(names).toContain("Outros Motivos");
      expect(names).toContain("Concorrência / Solução");
      expect(names).toContain("Preço / Financeiro");
      expect(names).toContain("Processo / Prazos");
    });

    it("deve totalizar exatamente 26 motivos reais mapeados sem duplicidades", () => {
      const allReasons = DEFAULT_LOSS_REASON_CATEGORIES.flatMap((c) => c.reasons);
      expect(allReasons).toHaveLength(26);
      const uniqueReasons = new Set(allReasons.map((r) => r.toLowerCase().trim()));
      expect(uniqueReasons.size).toBe(26);
    });

    it("deve mapear corretamente os motivos da Categoria 1 (Comportamento / Cliente - 10 motivos)", () => {
      const cat = DEFAULT_LOSS_REASON_CATEGORIES.find((c) => c.name === "Comportamento / Cliente")!;
      expect(cat.reasons).toHaveLength(10);
      expect(cat.reasons).toContain("Cliente não atende/responde aos contatos");
      expect(cat.reasons).toContain("Cliente desistiu do investimento");
      expect(cat.reasons).toContain("Lead desqualificado - Cliente fora do perfil");
      expect(cat.reasons).toContain("Cliente migrou para compra direta no site tecfag");
      expect(cat.reasons).toContain("Condições de pagamento incompatíveis ao esperado pelo cliente");
      expect(cat.reasons).toContain("Mudança estratégica da empresa do cliente");
      expect(cat.reasons).toContain("Layout / estrutura do cliente incompatível com o apresentado");
      expect(cat.reasons).toContain("Problemas com assistência técnica");
      expect(cat.reasons).toContain("Cliente não cumpriu com acordo de pagamento firmado");
      expect(cat.reasons).toContain("Empresa do cliente encerrou atividades");
    });

    it("deve mapear corretamente os motivos da Categoria 2 (Outros Motivos - 9 motivos)", () => {
      const cat = DEFAULT_LOSS_REASON_CATEGORIES.find((c) => c.name === "Outros Motivos")!;
      expect(cat.reasons).toHaveLength(9);
      expect(cat.reasons).toContain("Negociação parada sem interação");
      expect(cat.reasons).toContain("Oportunidade em duplicidade / outra oportunidade em andamento");
      expect(cat.reasons).toContain("Fornecedor");
      expect(cat.reasons).toContain("Negociação parada há muito tempo");
      expect(cat.reasons).toContain("Contato inexistente / número errado");
      expect(cat.reasons).toContain("Não gostou do atendimento");
      expect(cat.reasons).toContain("Problemas com frete / logística regional");
      expect(cat.reasons).toContain("Crédito não aprovado por bancos externos");
      expect(cat.reasons).toContain("Outros motivos / não especificado");
    });

    it("deve mapear corretamente os motivos da Categoria 3 (Concorrência / Solução - 3 motivos)", () => {
      const cat = DEFAULT_LOSS_REASON_CATEGORIES.find((c) => c.name === "Concorrência / Solução")!;
      expect(cat.reasons).toHaveLength(3);
      expect(cat.reasons).toContain("Solução não atende totalmente a necessidade do cliente");
      expect(cat.reasons).toContain("Concorrente com melhor custo benefício");
      expect(cat.reasons).toContain("Não gostou do produto / solução apresentada");
    });

    it("deve mapear corretamente os motivos da Categoria 4 (Preço / Financeiro - 2 motivos)", () => {
      const cat = DEFAULT_LOSS_REASON_CATEGORIES.find((c) => c.name === "Preço / Financeiro")!;
      expect(cat.reasons).toHaveLength(2);
      expect(cat.reasons).toContain("Valor do investimento acima do esperado pelo cliente");
      expect(cat.reasons).toContain("Crédito não aprovado — financeiro Tecfag");
    });

    it("deve mapear corretamente os motivos da Categoria 5 (Processo / Prazos - 2 motivos)", () => {
      const cat = DEFAULT_LOSS_REASON_CATEGORIES.find((c) => c.name === "Processo / Prazos")!;
      expect(cat.reasons).toHaveLength(2);
      expect(cat.reasons).toContain("Prazo de entrega incompatível");
      expect(cat.reasons).toContain("Demora na elaboração da proposta comercial");
    });
  });

  describe("Motor de Categorização Automática categorize() & Precedência Estrita", () => {
    it("deve classificar os 26 motivos reais em suas categorias esperadas", () => {
      // 1. Comportamento / Cliente
      expect(categorize("Cliente não atende/responde aos contatos")).toBe("Comportamento / Cliente");
      expect(categorize("Cliente desistiu do investimento")).toBe("Comportamento / Cliente");
      expect(categorize("Lead desqualificado - Cliente fora do perfil")).toBe("Comportamento / Cliente");
      expect(categorize("Cliente migrou para compra direta no site tecfag")).toBe("Comportamento / Cliente");
      expect(categorize("Condições de pagamento incompatíveis ao esperado pelo cliente")).toBe("Comportamento / Cliente");
      expect(categorize("Mudança estratégica da empresa do cliente")).toBe("Comportamento / Cliente");
      expect(categorize("Layout / estrutura do cliente incompatível com o apresentado")).toBe("Comportamento / Cliente");
      expect(categorize("Problemas com assistência técnica")).toBe("Comportamento / Cliente");
      expect(categorize("Cliente não cumpriu com acordo de pagamento firmado")).toBe("Comportamento / Cliente");
      expect(categorize("Empresa do cliente encerrou atividades")).toBe("Comportamento / Cliente");

      // 2. Outros Motivos
      expect(categorize("Negociação parada sem interação")).toBe("Outros Motivos");
      expect(categorize("Oportunidade em duplicidade / outra oportunidade em andamento")).toBe("Outros Motivos");
      expect(categorize("Fornecedor")).toBe("Outros Motivos");
      expect(categorize("Negociação parada há muito tempo")).toBe("Outros Motivos");
      expect(categorize("Contato inexistente / número errado")).toBe("Outros Motivos");
      expect(categorize("Não gostou do atendimento")).toBe("Outros Motivos");
      expect(categorize("Problemas com frete / logística regional")).toBe("Outros Motivos");
      expect(categorize("Crédito não aprovado por bancos externos")).toBe("Outros Motivos");
      expect(categorize("Outros motivos / não especificado")).toBe("Outros Motivos");

      // 3. Concorrência / Solução
      expect(categorize("Solução não atende totalmente a necessidade do cliente")).toBe("Concorrência / Solução");
      expect(categorize("Concorrente com melhor custo benefício")).toBe("Concorrência / Solução");
      expect(categorize("Não gostou do produto / solução apresentada")).toBe("Concorrência / Solução");

      // 4. Preço / Financeiro
      expect(categorize("Valor do investimento acima do esperado pelo cliente")).toBe("Preço / Financeiro");
      expect(categorize("Crédito não aprovado — financeiro Tecfag")).toBe("Preço / Financeiro");

      // 5. Processo / Prazos
      expect(categorize("Prazo de entrega incompatível")).toBe("Processo / Prazos");
      expect(categorize("Demora na elaboração da proposta comercial")).toBe("Processo / Prazos");
    });

    it("deve respeitar a ordem estrita de precedência", () => {
      // 1. Concorrência tem precedência sobre Preço e Cliente
      expect(categorize("Concorrente com melhor preço e produto")).toBe("Concorrência / Solução");
      expect(categorize("Solução cara para o cliente")).toBe("Concorrência / Solução");

      // 2. Preço tem precedência sobre Processo e Cliente
      expect(categorize("Valor do investimento acima do esperado pelo cliente")).toBe("Preço / Financeiro");
      expect(categorize("Orçamento com prazo longo")).toBe("Preço / Financeiro");
      expect(categorize("Financeiro do cliente")).toBe("Preço / Financeiro");

      // 3. Processo tem precedência sobre Cliente
      expect(categorize("Prazo não atende o cliente")).toBe("Processo / Prazos");
      expect(categorize("Demora na entrega para o cliente")).toBe("Processo / Prazos");

      // 4. Comportamento / Cliente
      expect(categorize("Cliente desistiu")).toBe("Comportamento / Cliente");
      expect(categorize("Especificação técnica incompatível")).toBe("Comportamento / Cliente");

      // 5. Fallback geral
      expect(categorize("Negociação parada")).toBe("Outros Motivos");
      expect(categorize("Desconhecido")).toBe("Outros Motivos");
      expect(categorize("")).toBe("Outros Motivos");
      expect(categorize(null)).toBe("Outros Motivos");
    });

    it("deve funcionar com variações ortográficas e minúsculas/maiúsculas sem acento", () => {
      expect(normalizeLossReason("Preço & Solução TéCnica")).toBe("preco & solucao tecnica");
      expect(categorize("PRECO ELEVADO")).toBe("Preço / Financeiro");
      expect(categorize("solucao nao atende")).toBe("Concorrência / Solução");
      expect(categorize("PRAZO INCOMPATIVEL")).toBe("Processo / Prazos");
      expect(categorize("CLIENTE SUMIU")).toBe("Comportamento / Cliente");
    });
  });

  describe("Metadados Visuais de Categorias (Cores, Ícones e Classes)", () => {
    it("deve retornar metadados oficiais consistentes por categoria", () => {
      const comp = getLossCategoryMeta("Comportamento / Cliente");
      expect(comp.key).toBe("comportamento");
      expect(comp.colorHex).toBe("#3b82f6");
      expect(comp.iconName).toBe("users");

      const conc = getLossCategoryMeta("Concorrência / Solução");
      expect(conc.key).toBe("concorrencia");
      expect(conc.colorHex).toBe("#f59e0b");
      expect(conc.iconName).toBe("zap");

      const outros = getLossCategoryMeta("Outros Motivos");
      expect(outros.key).toBe("outros");
      expect(outros.colorHex).toBe("#06b6d4");
      expect(outros.iconName).toBe("layers");

      const preco = getLossCategoryMeta("Preço / Financeiro");
      expect(preco.key).toBe("preco");
      expect(preco.colorHex).toBe("#ef4444");
      expect(preco.iconName).toBe("dollar");

      const proc = getLossCategoryMeta("Processo / Prazos");
      expect(proc.key).toBe("processo");
      expect(proc.colorHex).toBe("#a855f7");
      expect(proc.iconName).toBe("clock");
    });

    it("toLossPresentation deve manter cores e ícones oficiais mesmo com ordem de categorias alterada", () => {
      // Simula mês passado onde Outros Motivos foi o 1º colocado (89.6%)
      const presentation = toLossPresentation({
        periods: [
          {
            period: "2026-09",
            count: 6183,
            value: 5000000,
            reasons: [],
            categories: [
              {
                name: "Outros Motivos",
                count: 5540,
                value: 4500000,
                percent: 89.6,
                subreasons: [{ reason: "Negociação parada sem interação", count: 5287, value: 4000000 }],
              },
              {
                name: "Comportamento / Cliente",
                count: 481,
                value: 300000,
                percent: 7.8,
                subreasons: [{ reason: "Cliente não atende/responde aos contatos", count: 304, value: 200000 }],
              },
            ],
          },
          { period: "2026-08", count: 0, value: 0, reasons: [], categories: [] },
          { period: "all", count: 6183, value: 5000000, reasons: [], categories: [] },
        ],
      } as any);

      const mesPassado = presentation.mes_atual.categories;
      const outros = mesPassado.find((c) => c.key === "outros")!;
      expect(outros.colorHex).toBe("#06b6d4"); // Ciano oficial, NUNCA azul de index 0
      expect(outros.iconName).toBe("layers");

      const comp = mesPassado.find((c) => c.key === "comportamento")!;
      expect(comp.colorHex).toBe("#3b82f6"); // Azul oficial
      expect(comp.iconName).toBe("users");
    });
  });
});
