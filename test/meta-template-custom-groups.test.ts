import { describe, expect, it } from "bun:test";
import {
  collectTemplateCustomGroups,
  matchesMetaTemplateFilter,
  normalizeTemplateCustomGroups,
} from "../src/lib/whatsapp/meta-template-common";
import { validateMetaTemplateInput } from "../src/lib/whatsapp/meta-templates";

describe("Meta Template Custom Groups & Filtering", () => {
  it("normalizes and deduplicates custom group names case-insensitively and accent-insensitively", () => {
    const result = normalizeTemplateCustomGroups([
      "  Assistência Técnica  ",
      "assistencia tecnica",
      "Pós-Venda",
      "POS-VENDA",
      "Comercial",
      "",
      "   ",
    ]);

    expect(result).toEqual(["Assistência Técnica", "Pós-Venda", "Comercial"]);
  });

  it("collects and sorts registered groups and template-assigned groups without duplicates", () => {
    const collected = collectTemplateCustomGroups(
      [
        { customGroups: ["assistencia tecnica", "Financeiro"] },
        { customGroups: ["Comercial"] },
      ],
      ["Pós-Venda", "Assistência Técnica"],
    );

    expect(collected).toEqual([
      "Assistência Técnica",
      "Comercial",
      "Financeiro",
      "Pós-Venda",
    ]);
  });

  it("filters templates by category, custom group, ungrouped, and search query", () => {
    const tplAssistencia = {
      name: "retorno_assistencia_tecnica",
      category: "UTILITY",
      bodyText: "Olá {{1}}, seu equipamento está pronto.",
      customGroups: ["Assistência Técnica", "Pós-Venda"],
    };

    const tplMarketing = {
      name: "oferta_feira_industrial",
      category: "MARKETING",
      bodyText: "Visite nosso estande na feira!",
      customGroups: ["Comercial"],
    };

    const tplSemGrupo = {
      name: "aviso_geral",
      category: "UTILITY",
      bodyText: "Comunicado importante.",
      customGroups: [],
    };

    // ALL filter
    expect(matchesMetaTemplateFilter(tplAssistencia, { selectedFilter: "ALL", search: "" })).toBe(true);
    expect(matchesMetaTemplateFilter(tplMarketing, { selectedFilter: "ALL", search: "" })).toBe(true);

    // Category filter
    expect(matchesMetaTemplateFilter(tplAssistencia, { selectedFilter: "CAT:UTILITY", search: "" })).toBe(true);
    expect(matchesMetaTemplateFilter(tplMarketing, { selectedFilter: "CAT:UTILITY", search: "" })).toBe(false);
    expect(matchesMetaTemplateFilter(tplMarketing, { selectedFilter: "CAT:MARKETING", search: "" })).toBe(true);

    // Custom group filter (accent-insensitive match)
    expect(
      matchesMetaTemplateFilter(tplAssistencia, { selectedFilter: "GRP:Assistência Técnica", search: "" }),
    ).toBe(true);
    expect(
      matchesMetaTemplateFilter(tplAssistencia, { selectedFilter: "GRP:assistencia tecnica", search: "" }),
    ).toBe(true);
    expect(
      matchesMetaTemplateFilter(tplMarketing, { selectedFilter: "GRP:Assistência Técnica", search: "" }),
    ).toBe(false);

    // Ungrouped filter
    expect(matchesMetaTemplateFilter(tplSemGrupo, { selectedFilter: "UNGROUPED", search: "" })).toBe(true);
    expect(matchesMetaTemplateFilter(tplAssistencia, { selectedFilter: "UNGROUPED", search: "" })).toBe(false);

    // Search query matching template name, body text, or group name
    expect(matchesMetaTemplateFilter(tplAssistencia, { selectedFilter: "ALL", search: "equipamento" })).toBe(true);
    expect(matchesMetaTemplateFilter(tplAssistencia, { selectedFilter: "ALL", search: "pos-venda" })).toBe(true);
    expect(matchesMetaTemplateFilter(tplAssistencia, { selectedFilter: "ALL", search: "inexistente" })).toBe(false);
  });

  it("validates customGroups in validateMetaTemplateInput", () => {
    const validated = validateMetaTemplateInput({
      name: "atendimento_pos_venda",
      language: "pt_BR",
      category: "UTILITY",
      bodyText: "Olá {{1}}, tudo bem com sua máquina {{2}}?",
      examples: ["João", "Seladora FR900"],
      bindings: { "1": "customer_name", "2": "manual" },
      customGroups: ["Pós-Venda", "Assistência Técnica", "pos-venda"],
    });

    expect(validated.customGroups).toEqual([
      "Pós-Venda",
      "Assistência Técnica",
    ]);
  });
});
