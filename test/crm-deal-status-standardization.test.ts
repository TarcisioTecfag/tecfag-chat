import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CRM_STATUS_FILTER_MAP,
  CRM_STATUS_FILTER_OPTIONS,
  DEAL_STATUS_MAP,
  DEAL_STATUS_OPTIONS,
  getDealStatusFilterMeta,
  getDealStatusMeta,
} from "../src/components/crm/deal-status-config";

describe("Padronização Global de Ícones e Rótulos de Status de Negociação", () => {
  it("garante que cada um dos 6 filtros de status possui um ícone exclusivo e rótulo padronizado", () => {
    expect(CRM_STATUS_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      "all",
      "open",
      "won",
      "lost",
      "paused",
      "not_paused",
    ]);

    expect(CRM_STATUS_FILTER_MAP.all.label).toBe("Todos os status");
    expect(CRM_STATUS_FILTER_MAP.open.label).toBe("Em andamento");
    expect(CRM_STATUS_FILTER_MAP.won.label).toBe("Vendido");
    expect(CRM_STATUS_FILTER_MAP.lost.label).toBe("Perdido");
    expect(CRM_STATUS_FILTER_MAP.paused.label).toBe("Pausado");
    expect(CRM_STATUS_FILTER_MAP.not_paused.label).toBe("Não pausado");

    const uniqueFilterIcons = new Set(CRM_STATUS_FILTER_OPTIONS.map((o) => o.icon));
    expect(uniqueFilterIcons.size).toBe(6);

    const uniqueDealIcons = new Set(DEAL_STATUS_OPTIONS.map((o) => o.icon));
    expect(uniqueDealIcons.size).toBe(4);
  });

  it("getDealStatusMeta e getDealStatusFilterMeta retornam metadados corretos e fallback seguro", () => {
    expect(getDealStatusMeta("open").label).toBe("Em andamento");
    expect(getDealStatusMeta("won").label).toBe("Vendido");
    expect(getDealStatusMeta("lost").label).toBe("Perdido");
    expect(getDealStatusMeta("paused").label).toBe("Pausado");
    expect(getDealStatusMeta(undefined).value).toBe("open");
    expect(getDealStatusMeta("unknown").value).toBe("open");

    expect(getDealStatusFilterMeta("all").label).toBe("Todos os status");
    expect(getDealStatusFilterMeta("not_paused").label).toBe("Não pausado");
    expect(getDealStatusFilterMeta(undefined).value).toBe("all");
    expect(DEAL_STATUS_MAP.open.icon).toBe(CRM_STATUS_FILTER_MAP.open.icon);
  });

  it("todos os pontos de exibição e seleção de status consomem deal-status-config", () => {
    const filesToCheck = [
      "src/components/crm/CrmToolbar.tsx",
      "src/components/crm/AdvancedFiltersModal.tsx",
      "src/components/crm/DealCard.tsx",
      "src/components/crm/DealList.tsx",
      "src/components/crm/DealDetailModal.tsx",
      "src/components/crm/ConversationDealsPanel.tsx",
      "src/components/crm/BulkActionsSuite.tsx",
      "src/components/crm/BulkActionsDialog.tsx",
      "src/components/crm/AccountDetailModal.tsx",
      "src/components/crm/CrmSearchModal.tsx",
      "src/components/crm/RdMarketingJourneyControls.tsx",
      "src/components/commercial/CommercialAnalysisPanels.tsx",
      "src/components/crm/ContactDealPicker.tsx",
    ];

    for (const relPath of filesToCheck) {
      const fullPath = path.resolve(import.meta.dir, "..", relPath);
      const source = readFileSync(fullPath, "utf8");
      expect(source).toContain("deal-status-config");
    }
  });

  it("garante ausência de caracteres quebrados (Mojibake), uso de Radix Select e validação de ContactDealModal", async () => {
    const { isContactDealInputComplete } = await import("../src/lib/crm/contact-deal-input");
    const { parseExtraDealFilters } = await import("../src/lib/crm/crm-service");

    expect(isContactDealInputComplete(undefined)).toBe(false);
    expect(isContactDealInputComplete({})).toBe(false);
    expect(isContactDealInputComplete({ dealId: "deal-123" })).toBe(true);
    expect(
      isContactDealInputComplete({
        newDeal: { title: "Nova", pipelineId: "pipe-1", stageId: "stage-1" },
      }),
    ).toBe(true);
    expect(
      isContactDealInputComplete({
        newDeal: { title: "   ", pipelineId: "pipe-1", stageId: "stage-1" },
      }),
    ).toBe(false);

    const parsed = parseExtraDealFilters(
      new URLSearchParams("contactId=contact-99&rating=4"),
    );
    expect(parsed.contactId).toBe("contact-99");
    expect(parsed.rating).toBe(4);

    const uiFiles = [
      "src/components/crm/ContactDealPicker.tsx",
      "src/components/crm/ContactDealResolutionDialog.tsx",
      "src/components/crm/PhoneContactSuggestions.tsx",
      "src/components/chat/ContactsView.tsx",
      "src/components/crm/CrmQuickCreateDialog.tsx",
    ];
    const mojibakeRegex = /Ã§|Ã£|Ã³|Ã­|Ãª|Ã¡|Ã©|Ãº/;
    for (const relPath of uiFiles) {
      const fullPath = path.resolve(import.meta.dir, "..", relPath);
      const source = readFileSync(fullPath, "utf8");
      expect(mojibakeRegex.test(source)).toBe(false);
    }

    const pickerSource = readFileSync(
      path.resolve(import.meta.dir, "..", "src/components/crm/ContactDealPicker.tsx"),
      "utf8",
    );
    expect(pickerSource).not.toContain("<select");
    expect(pickerSource).toContain("ContactDealModal");
  });
});

