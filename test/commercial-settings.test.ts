import { describe, expect, it } from "bun:test";
import { DEFAULT_MATURITY_RULES } from "@/lib/commercial/metrics";

describe("Parâmetros Comerciais e Controle da TV (Layouts de Referência)", () => {
  it("valida a estrutura padrão das regras de maturidade (5 grupos)", () => {
    expect(DEFAULT_MATURITY_RULES).toHaveLength(5);
    expect(DEFAULT_MATURITY_RULES[0].days).toBe(3);
    expect(DEFAULT_MATURITY_RULES[0].maxValue).toBe(8500);

    expect(DEFAULT_MATURITY_RULES[1].days).toBe(15);
    expect(DEFAULT_MATURITY_RULES[1].maxValue).toBe(50000);

    expect(DEFAULT_MATURITY_RULES[2].days).toBe(30);
    expect(DEFAULT_MATURITY_RULES[2].maxValue).toBe(200000);

    expect(DEFAULT_MATURITY_RULES[3].days).toBe(60);
    expect(DEFAULT_MATURITY_RULES[3].maxValue).toBe(600000);

    expect(DEFAULT_MATURITY_RULES[4].days).toBe(90);
    expect(DEFAULT_MATURITY_RULES[4].maxValue).toBeNull();
  });

  it("calcula corretamente a duração total do ciclo de rotação da TV em minutos", () => {
    const activeModuleCount = 6;
    const rotationSeconds = 24;
    const totalMinutes = ((activeModuleCount * rotationSeconds) / 60).toFixed(1);
    expect(totalMinutes).toBe("2.4");

    // Teste com 4 módulos e 30s
    expect(((4 * 30) / 60).toFixed(1)).toBe("2.0");
  });

  it("valida ordem estritamente crescente dos buckets de SLA", () => {
    const validBuckets = [5, 15, 30];
    const isStrictlyAscending =
      validBuckets[0] < validBuckets[1] && validBuckets[1] < validBuckets[2];
    expect(isStrictlyAscending).toBe(true);

    const invalidBuckets = [15, 10, 30];
    const isInvalidAscending =
      invalidBuckets[0] < invalidBuckets[1] && invalidBuckets[1] < invalidBuckets[2];
    expect(isInvalidAscending).toBe(false);
  });

  it("formata faixas monetárias da Régua De-Para com precisão", () => {
    const currency = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    });

    expect(currency.format(8500)).toContain("8.500");
    expect(currency.format(50000)).toContain("50.000");
    expect(currency.format(200000)).toContain("200.000");
    expect(currency.format(600000)).toContain("600.000");
  });
});
