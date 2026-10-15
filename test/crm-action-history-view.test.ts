import { describe, expect, it } from "bun:test";
import {
  type ActionHistoryEntry,
  extractAffectedItems,
  findMatchingActionCodes,
  findMatchingEntityTypes,
  formatActionSummary,
  getActionCategory,
  matchesActionHistoryFilters,
  sortActionHistoryEntries,
} from "../src/lib/crm/action-history-meta";

describe("CRM Action History Dedicated Screen & Filters", () => {
  const sampleEntries: ActionHistoryEntry[] = [
    {
      id: "act-1",
      action: "delete_permanent",
      entityType: "deal",
      operatorName: "Tarcisio Pereira",
      itemCount: 5466,
      details: {
        deals: [
          { id: "d-1", title: "giulia" },
          { id: "d-2", title: "Marcio Aquino de almeida" },
          { id: "d-3", title: "Alessandro" },
          ...Array.from({ length: 97 }, (_, idx) => ({
            id: `d-${idx + 4}`,
            title: `Cliente ${idx + 4}`,
          })),
        ],
        totalCount: 5466,
        allFiltered: true,
      },
      createdAt: "2026-10-13T18:19:43.000Z",
    },
    {
      id: "act-2",
      action: "delete_operator",
      entityType: "operator",
      operatorName: "Tarcisio Pereira",
      itemCount: 1,
      details: { id: "op-99", name: "Operador Teste" },
      createdAt: "2026-10-09T16:26:59.000Z",
    },
    {
      id: "act-3",
      action: "delete_pipeline",
      entityType: "pipeline",
      operatorName: "Tarcisio Pereira",
      itemCount: 1,
      details: { id: "pip-1", name: "FUNIL PERSONNALITÉ" },
      createdAt: "2026-10-09T16:05:51.000Z",
    },
    {
      id: "act-4",
      action: "bulk_update",
      entityType: "deal",
      operatorName: "Denise Gomes",
      itemCount: 25,
      details: {
        updates: { stageId: "stg-2", operatorId: "op-2" },
        deals: [{ id: "d-10", title: "Padaria Central" }],
      },
      createdAt: "2026-10-14T12:00:00.000Z",
    },
    {
      id: "act-5",
      action: "export",
      entityType: "deal",
      operatorName: "Denise Gomes",
      itemCount: 120,
      details: { filename: "negociacoes-outubro.csv", format: "csv" },
      createdAt: "2026-10-15T09:00:00.000Z",
    },
  ];

  it("calculates total remaining deals using itemCount instead of capped sample length (5466 -> e mais 5.463)", () => {
    const summary = formatActionSummary(sampleEntries[0]);
    expect(summary).toBe("giulia, Marcio Aquino de almeida, Alessandro e mais 5.463");
  });

  it("classifies actions into deletion, bulk, and export categories", () => {
    expect(getActionCategory("delete_permanent")).toBe("deletion");
    expect(getActionCategory("archive_account")).toBe("deletion");
    expect(getActionCategory("bulk_update")).toBe("bulk");
    expect(getActionCategory("create_tasks")).toBe("bulk");
    expect(getActionCategory("export")).toBe("export");
  });

  it("filters by search query across deal titles, pipeline names, operators, and Portuguese labels (accent-insensitive)", () => {
    // Busca por nome do funil sem acento
    const byPipeline = sampleEntries.filter((e) =>
      matchesActionHistoryFilters(e, { search: "personalite" }),
    );
    expect(byPipeline).toHaveLength(0); // "personnalite" tem dois 'n'
    const byPersonnalite = sampleEntries.filter((e) =>
      matchesActionHistoryFilters(e, { search: "personnalite" }),
    );
    expect(byPersonnalite.map((e) => e.id)).toEqual(["act-3"]);

    // Busca por nome de negócio dentro de details.deals
    const byDealName = sampleEntries.filter((e) =>
      matchesActionHistoryFilters(e, { search: "Marcio Aquino" }),
    );
    expect(byDealName.map((e) => e.id)).toEqual(["act-1"]);

    // Busca pelo rótulo em português da ação
    const byLabel = sampleEntries.filter((e) =>
      matchesActionHistoryFilters(e, { search: "exclusao definitiva" }),
    );
    expect(byLabel.map((e) => e.id)).toEqual(["act-1"]);
  });

  it("filters by kind, specific action, entityGroup, operator, and date range", () => {
    const onlyPipelines = sampleEntries.filter((e) =>
      matchesActionHistoryFilters(e, { entityGroup: "pipelines" }),
    );
    expect(onlyPipelines.map((e) => e.id)).toEqual(["act-3"]);

    const onlyTeam = sampleEntries.filter((e) =>
      matchesActionHistoryFilters(e, { entityGroup: "team" }),
    );
    expect(onlyTeam.map((e) => e.id)).toEqual(["act-2"]);

    const onlyDenise = sampleEntries.filter((e) =>
      matchesActionHistoryFilters(e, { operator: "Denise Gomes" }),
    );
    expect(onlyDenise.map((e) => e.id)).toEqual(["act-4", "act-5"]);

    const customDate = sampleEntries.filter((e) =>
      matchesActionHistoryFilters(e, {
        period: "custom",
        dateFrom: "2026-10-13",
        dateTo: "2026-10-14",
      }),
    );
    expect(customDate.map((e) => e.id)).toEqual(["act-1", "act-4"]);
  });

  it("sorts entries by newest, oldest, most_items, and least_items", () => {
    const mostItems = sortActionHistoryEntries(sampleEntries, "most_items");
    expect(mostItems[0].id).toBe("act-1");
    expect(mostItems[1].id).toBe("act-5");

    const leastItems = sortActionHistoryEntries(sampleEntries, "least_items");
    expect(leastItems[0].itemCount).toBe(1);

    const oldest = sortActionHistoryEntries(sampleEntries, "oldest");
    expect(oldest[0].id).toBe("act-3");
  });

  it("extracts affected items for drawer inspection and maps Portuguese terms to SQL codes", () => {
    const items = extractAffectedItems(sampleEntries[0]);
    expect(items).toHaveLength(100);
    expect(items[0]).toEqual({ id: "d-1", label: "giulia", kind: "Negociação" });

    expect(findMatchingActionCodes("lixeira")).toContain("delete_trash");
    expect(findMatchingEntityTypes("funil")).toContain("pipeline");
  });
});
