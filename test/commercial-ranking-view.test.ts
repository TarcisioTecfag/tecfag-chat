import { describe, expect, it } from "bun:test";
import {
  BASELINE_RANKING_OPERATORS,
  RankingOperatorRow,
} from "../src/lib/commercial/ranking-data";

describe("Commercial Ranking Geral de Resposta & SLA (Slide 6 - War Room)", () => {
  it("deve conter exatamente os 10 consultores da foto de referência nas posições de 1 a 10", () => {
    expect(BASELINE_RANKING_OPERATORS).toHaveLength(10);

    const positions = BASELINE_RANKING_OPERATORS.map((op) => op.position);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Pos 1: Andreia Camargo (Máquinas)
    expect(BASELINE_RANKING_OPERATORS[0].name).toBe("Andreia Camargo");
    expect(BASELINE_RANKING_OPERATORS[0].division).toBe("Máquinas");
    expect(BASELINE_RANKING_OPERATORS[0].position).toBe(1);

    // Pos 2: Beatriz Ribeiro (Máquinas)
    expect(BASELINE_RANKING_OPERATORS[1].name).toBe("Beatriz Ribeiro");
    expect(BASELINE_RANKING_OPERATORS[1].division).toBe("Máquinas");

    // Pos 3: Denise Gomes (Máquinas)
    expect(BASELINE_RANKING_OPERATORS[2].name).toBe("Denise Gomes");
    expect(BASELINE_RANKING_OPERATORS[2].division).toBe("Máquinas");

    // Pos 4: Diana Gimenes (Personnalité)
    expect(BASELINE_RANKING_OPERATORS[3].name).toBe("Diana Gimenes");
    expect(BASELINE_RANKING_OPERATORS[3].division).toBe("Personnalité");

    // Pos 5: Jhordan Rueda (Personnalité)
    expect(BASELINE_RANKING_OPERATORS[4].name).toBe("Jhordan Rueda");
    expect(BASELINE_RANKING_OPERATORS[4].division).toBe("Personnalité");

    // Pos 6: Marcelo Nardelli (Personnalité)
    expect(BASELINE_RANKING_OPERATORS[5].name).toBe("Marcelo Nardelli");
    expect(BASELINE_RANKING_OPERATORS[5].division).toBe("Personnalité");

    // Pos 7: Melissa Gomes (Máquinas)
    expect(BASELINE_RANKING_OPERATORS[6].name).toBe("Melissa Gomes");
    expect(BASELINE_RANKING_OPERATORS[6].division).toBe("Máquinas");

    // Pos 8: MERCADO LIVRE / Deborah (Máquinas)
    expect(BASELINE_RANKING_OPERATORS[7].name).toBe("MERCADO LIVRE / Deborah");
    expect(BASELINE_RANKING_OPERATORS[7].division).toBe("Máquinas");

    // Pos 9: Rosenvaldo Lucas (Personnalité)
    expect(BASELINE_RANKING_OPERATORS[8].name).toBe("Rosenvaldo Lucas");
    expect(BASELINE_RANKING_OPERATORS[8].division).toBe("Personnalité");

    // Pos 10: Victor Goes (Máquinas)
    expect(BASELINE_RANKING_OPERATORS[9].name).toBe("Victor Goes");
    expect(BASELINE_RANKING_OPERATORS[9].division).toBe("Máquinas");
  });

  it("deve conter métricas válidas de Melhor e Pior Atendimento para cada consultor", () => {
    for (const op of BASELINE_RANKING_OPERATORS) {
      expect(op.bestTime).toBeDefined();
      expect(op.bestTime.length).toBeGreaterThan(0);
      expect(op.bestClient).toBeDefined();
      expect(op.bestClient.length).toBeGreaterThan(0);

      expect(op.worstTime).toBeDefined();
      expect(op.worstTime.length).toBeGreaterThan(0);
      expect(op.worstClient).toBeDefined();
      expect(op.worstClient.length).toBeGreaterThan(0);

      expect(op.slaPercent).toBe(100);
      expect(op.averageTime).toBeDefined();
    }
  });

  it("deve dividir adequadamente as colunas em Ímpares (Coluna 1) e Pares (Coluna 2)", () => {
    const col1 = BASELINE_RANKING_OPERATORS.filter((_, idx) => idx % 2 === 0);
    const col2 = BASELINE_RANKING_OPERATORS.filter((_, idx) => idx % 2 !== 0);

    expect(col1).toHaveLength(5);
    expect(col2).toHaveLength(5);

    expect(col1.map((c) => c.position)).toEqual([1, 3, 5, 7, 9]);
    expect(col2.map((c) => c.position)).toEqual([2, 4, 6, 8, 10]);

    // Coluna 1 inicia com Andreia (1º lugar)
    expect(col1[0].name).toBe("Andreia Camargo");
    // Coluna 2 inicia com Beatriz (2º lugar)
    expect(col2[0].name).toBe("Beatriz Ribeiro");
  });
});
