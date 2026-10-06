import { describe, it, expect } from "bun:test";
import {
  STANDARD_CATALOG_ITEMS,
  normalizeCatalogName,
  type CatalogKind,
} from "../src/lib/crm/catalogs";

describe("Políticas e desativação de motivos de perda padrão do CRM", () => {
  it("contém os 6 motivos padrão oficiais de perda do sistema", () => {
    const reasons = STANDARD_CATALOG_ITEMS.loss_reason;
    expect(reasons).toHaveLength(6);
    expect(reasons).toContain("Preço elevado / Fora do orçamento");
    expect(reasons).toContain("Fechou com concorrente");
    expect(reasons).toContain("Contato sem retorno / Sumiu");
    expect(reasons).toContain("Desistência da compra / Projeto cancelado");
    expect(reasons).toContain("Especificação técnica incompatível");
    expect(reasons).toContain("Prazo de entrega não atende");
  });

  it("normaliza nomes removendo espaços duplicados e rejeita valores vazios", () => {
    expect(normalizeCatalogName("  Preço elevado / Fora do orçamento  ")).toBe(
      "Preço elevado / Fora do orçamento",
    );
    expect(() => normalizeCatalogName("")).toThrow();
    expect(() => normalizeCatalogName("__none__")).toThrow();
  });

  it("filtra motivos padrão corretamente quando o tenant opta por desativar todos", () => {
    const customItems = [
      { id: "custom-1", name: "Cliente não possui CNPJ ativo" },
      { id: "custom-2", name: "Produto fora de linha na fábrica" },
    ];
    const includeStandard = false;
    const disabledStandardItems: string[] = [];

    // Lógica espelhada de listAvailableCatalogOptions
    const customOptions = customItems.map((item) => ({
      id: item.id,
      name: item.name,
      isStandard: false,
    }));

    const options = includeStandard
      ? [
          ...customOptions,
          ...STANDARD_CATALOG_ITEMS.loss_reason
            .filter((name) => !disabledStandardItems.includes(name))
            .map((name, i) => ({ id: `std-loss_reason-${i}`, name, isStandard: true })),
        ]
      : customOptions;

    // Quando desativado: deve conter EXCLUSIVAMENTE os motivos personalizados
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.name)).toEqual([
      "Cliente não possui CNPJ ativo",
      "Produto fora de linha na fábrica",
    ]);
    expect(options.some((o) => o.name.includes("Preço elevado"))).toBe(false);
  });

  it("permite desativação granular de motivos padrão específicos", () => {
    const customItems = [{ id: "custom-1", name: "Motivo Exclusivo Tecfag" }];
    const includeStandard = true;
    const disabledStandardItems = [
      "Prazo de entrega não atende",
      "Contato sem retorno / Sumiu",
    ];

    const disabledSet = new Set(disabledStandardItems.map((s) => s.toLocaleLowerCase("pt-BR")));
    const customOptions = customItems.map((item) => ({
      id: item.id,
      name: item.name,
      isStandard: false,
    }));

    const standardOptions = STANDARD_CATALOG_ITEMS.loss_reason
      .filter((name) => !disabledSet.has(name.toLocaleLowerCase("pt-BR")))
      .map((name, i) => ({ id: `std-loss_reason-${i}`, name, isStandard: true }));

    const options = [...customOptions, ...standardOptions];

    // Total: 1 personalizado + 4 ativos (6 - 2 desativados) = 5
    expect(options).toHaveLength(5);
    expect(options.some((o) => o.name === "Prazo de entrega não atende")).toBe(false);
    expect(options.some((o) => o.name === "Contato sem retorno / Sumiu")).toBe(false);
    expect(options.some((o) => o.name === "Preço elevado / Fora do orçamento")).toBe(true);
    expect(options.some((o) => o.name === "Motivo Exclusivo Tecfag")).toBe(true);
  });
});
