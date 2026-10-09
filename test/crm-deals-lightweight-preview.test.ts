import { describe, it, expect } from "bun:test";
import { crmService } from "../src/lib/crm/crm-service";

describe("CRM Deals - Otimização de Performance & Preview Leve", () => {
  it("deve suportar previewOnly em crmService.getDeals com integridade de tipos e campos do card", async () => {
    // Consulta deals no tenant tecfag com previewOnly ativo
    const result = await crmService.getDeals("tecfag", {
      limit: 5,
      previewOnly: true,
      includeTotal: false,
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.deals)).toBe(true);

    if (result.deals.length > 0) {
      const deal = result.deals[0];
      // Campos mandatórios para a preview do card no Kanban e Lista
      expect(deal).toHaveProperty("id");
      expect(deal).toHaveProperty("title");
      expect(deal).toHaveProperty("stageId");
      expect(deal).toHaveProperty("status");
      expect(deal).toHaveProperty("version");
      expect(deal).toHaveProperty("conversationsCount");
      expect(deal).toHaveProperty("contactsCount");
      expect(typeof deal.conversationsCount).toBe("number");
      expect(typeof deal.contactsCount).toBe("number");

      // Objeto customFields existe defensivamente sem quebrar tipos
      expect(deal).toHaveProperty("customFields");
      expect(typeof deal.customFields).toBe("object");

      // Se houver conta vinculada, campos vitais de exibição presentes
      if (deal.account) {
        expect(deal.account).toHaveProperty("id");
        expect(deal.account).toHaveProperty("name");
      }
    }
  });

  it("deve particionar corretamente por etapa com lote reduzido (perStageLimit: 20)", async () => {
    const result = await crmService.getDeals("tecfag", {
      perStageLimit: 20,
      previewOnly: true,
      includeTotal: false,
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.deals)).toBe(true);

    // Contagem de negócios por etapa nunca deve ultrapassar o limite de 20
    const countsByStage: Record<string, number> = {};
    for (const d of result.deals) {
      countsByStage[d.stageId] = (countsByStage[d.stageId] || 0) + 1;
    }

    for (const [stageId, count] of Object.entries(countsByStage)) {
      expect(count).toBeLessThanOrEqual(20);
    }
  });

  it("preserva isolamento estrito de tenant (valem e tecfag não misturam dados)", async () => {
    const [tecfagDeals, valemDeals] = await Promise.all([
      crmService.getDeals("tecfag", { limit: 5, previewOnly: true, includeTotal: false }),
      crmService.getDeals("valem", { limit: 5, previewOnly: true, includeTotal: false }),
    ]);

    for (const d of tecfagDeals.deals) {
      expect(d.tenantId).toBe("tecfag");
    }

    for (const d of valemDeals.deals) {
      expect(d.tenantId).toBe("valem");
    }
  });
});
