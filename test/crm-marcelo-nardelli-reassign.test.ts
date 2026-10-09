import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { MARCELO_RD_DEAL_IDS } from "../scripts/reassign-marcelo-nardelli-deals.mjs";

describe("Reatribuição de Cards do Marcelo Nardelli no CRM Tecfag", () => {
  it("deve conter exatamente 106 IDs únicos de negociações do RD CRM", () => {
    expect(MARCELO_RD_DEAL_IDS.length).toBe(106);
    const unique = new Set(MARCELO_RD_DEAL_IDS);
    expect(unique.size).toBe(106);
  });

  it("deve conter todos os 106 deals atribuídos exclusivamente ao Marcelo Nardelli no seed", () => {
    const seedPath = join(process.cwd(), "scripts/data/tecfag-crm-seed.json.gz");
    const gz = readFileSync(seedPath);
    const seed = JSON.parse(gunzipSync(gz).toString("utf8"));

    const marceloIdSet = new Set(MARCELO_RD_DEAL_IDS);
    const matchedDeals = (seed.deals || []).filter((d: any) => marceloIdSet.has(d.rd_deal_id));

    expect(matchedDeals.length).toBe(106);

    const MARCELO_OP_ID = "op-1791376825772";
    const TARCISIO_OP_ID = "38306207-265e-4cd1-b702-a78805526b94";

    for (const deal of matchedDeals) {
      expect(deal.operator_id).toBe(MARCELO_OP_ID);
      expect(deal.operator_id).not.toBe(TARCISIO_OP_ID);
    }
  });

  it("deve refletir a distribuição correta de negociações nos 4 funis de atuação", () => {
    const seedPath = join(process.cwd(), "scripts/data/tecfag-crm-seed.json.gz");
    const gz = readFileSync(seedPath);
    const seed = JSON.parse(gunzipSync(gz).toString("utf8"));

    const marceloIdSet = new Set(MARCELO_RD_DEAL_IDS);
    const matchedDeals = (seed.deals || []).filter((d: any) => marceloIdSet.has(d.rd_deal_id));

    const byPipeline: Record<string, number> = {};
    for (const d of matchedDeals) {
      byPipeline[d.pipeline_id] = (byPipeline[d.pipeline_id] || 0) + 1;
    }

    expect(byPipeline["pipe-tecfag-personnalite"]).toBe(66);
    expect(byPipeline["pipe-tecfag-externo-2-0"]).toBe(28);
    expect(byPipeline["pipe-tecfag-projetos"]).toBe(7);
    expect(byPipeline["pipe-tecfag-sdr"]).toBe(5);
  });
});
