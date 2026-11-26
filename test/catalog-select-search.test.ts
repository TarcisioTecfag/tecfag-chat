import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  filterCatalogSearchOptions,
  normalizeCatalogSearchText,
} from "../src/lib/crm/catalog-search";

describe("CRM CatalogSelect & Filtro de Fonte — Pesquisa instantânea", () => {
  const sampleSources = [
    { id: "1", name: "Busca Paga | meta-SiteLink" },
    { id: "2", name: "Busca Paga | metaads" },
    { id: "3", name: "chat" },
    { id: "4", name: "Chat Site" },
    { id: "5", name: "Contato pelo Site" },
    { id: "6", name: "Contato por E-mail" },
    { id: "7", name: "Contato por Telefone" },
    { id: "8", name: "Desconhecido" },
    { id: "9", name: "direct" },
    { id: "10", name: "E-mail — ORÇAMENTO SELADORA (25/11/2026)" },
    { id: "11", name: "E-mail — Orçamento Veolia Blumenau SC (25/11/2026)" },
  ];

  it("normaliza acentos, caixa e espaços corretamente em PT-BR", () => {
    expect(normalizeCatalogSearchText("  Orçamento SELADORA  ")).toBe("orcamento seladora");
    expect(normalizeCatalogSearchText("Indicação de Cliente")).toBe("indicacao de cliente");
  });

  it("preserva todas as opções na ordem original quando a pesquisa está vazia", () => {
    const result = filterCatalogSearchOptions(sampleSources, "   ", (item) => item.name);
    expect(result.map((item) => item.id)).toEqual(sampleSources.map((item) => item.id));
  });

  it("encontra itens com hífen mesmo digitando sem hífen (ex: 'email' -> 'E-mail')", () => {
    const result = filterCatalogSearchOptions(sampleSources, "email", (item) => item.name);
    expect(result.map((item) => item.name)).toEqual([
      "E-mail — ORÇAMENTO SELADORA (25/11/2026)",
      "E-mail — Orçamento Veolia Blumenau SC (25/11/2026)",
      "Contato por E-mail",
    ]);
  });

  it("suporta busca por múltiplos termos sem acento e fora de ordem", () => {
    const result = filterCatalogSearchOptions(sampleSources, "orcamento veolia", (item) => item.name);
    expect(result.map((item) => item.name)).toEqual([
      "E-mail — Orçamento Veolia Blumenau SC (25/11/2026)",
    ]);

    const metaSite = filterCatalogSearchOptions(sampleSources, "meta sitelink", (item) => item.name);
    expect(metaSite.map((item) => item.name)).toEqual(["Busca Paga | meta-SiteLink"]);
  });

  it("prioriza correspondência exata e prefixo antes de substring", () => {
    const result = filterCatalogSearchOptions(sampleSources, "chat", (item) => item.name);
    expect(result.map((item) => item.name)).toEqual(["chat", "Chat Site"]);
  });

  it("CatalogSelect usa Popover + SystemTooltip + busca instantânea sem controles nativos proibidos", () => {
    const catalogSelectPath = path.resolve(
      import.meta.dir,
      "..",
      "src/components/crm/CatalogSelect.tsx",
    );
    const source = readFileSync(catalogSelectPath, "utf8");

    expect(source).toContain("PopoverContent");
    expect(source).toContain("SystemTooltip");
    expect(source).toContain("filterCatalogSearchOptions");
    expect(source).toContain("Pesquisar fonte...");
    expect(source).toContain("h-9 w-full rounded-[8px]");
    expect(source).not.toMatch(/<select[\s>]/i);
    expect(source).not.toMatch(/\stitle=/);
  });

  it("AdvancedFiltersModal e BulkActionsSuite habilitam pesquisa nos seletores de Fonte e Campanha", () => {
    const filtersPath = path.resolve(
      import.meta.dir,
      "..",
      "src/components/crm/AdvancedFiltersModal.tsx",
    );
    const bulkPath = path.resolve(
      import.meta.dir,
      "..",
      "src/components/crm/BulkActionsSuite.tsx",
    );
    const filtersSource = readFileSync(filtersPath, "utf8");
    const bulkSource = readFileSync(bulkPath, "utf8");

    expect(filtersSource).toContain('searchPlaceholder="Pesquisar fonte..."');
    expect(filtersSource).toContain('searchPlaceholder="Pesquisar campanha..."');
    expect(filtersSource).toContain("filterCatalogSearchOptions");
    expect(bulkSource).toContain('kind="source"');
    expect(bulkSource).toContain('kind="campaign"');
  });
});
