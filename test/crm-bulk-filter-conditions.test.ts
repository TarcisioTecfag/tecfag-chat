import { describe, it, expect } from "bun:test";
import { buildDealFilterConditions } from "../src/lib/crm/crm-service";
import { and } from "drizzle-orm";
import { db } from "../src/db";
import { crmDeals } from "../src/db/schema";

describe("CRM Deals - Normalização de Filtros em Massa (buildDealFilterConditions)", () => {
  it("deve normalizar stageIds enviado como string única (URLSearchParams) para igualdade SQL direta", () => {
    const conditions = buildDealFilterConditions("tecfag", {
      pipelineId: "pipe-tecfag-sdr",
      stageIds: "stg-tf-sdr-para-analise" as any,
      status: "open",
    });

    const query = db
      .select()
      .from(crmDeals)
      .where(and(...conditions))
      .toSQL();

    // SQL não pode conter 'stage_id in $X' sem parênteses
    expect(query.sql).not.toContain('"stage_id" in $');
    expect(query.sql).toContain('"stage_id" = $');
    expect(query.params).toContain("stg-tf-sdr-para-analise");
    expect(query.params).toContain("pipe-tecfag-sdr");
    expect(query.params).toContain("open");
    expect(query.params).toContain("tecfag");
  });

  it("deve normalizar stageIds enviado como string separada por vírgula para tupla IN válida", () => {
    const conditions = buildDealFilterConditions("tecfag", {
      pipelineId: "pipe-tecfag-sdr",
      stageIds: "stg-1,stg-2,stg-3" as any,
    });

    const query = db
      .select()
      .from(crmDeals)
      .where(and(...conditions))
      .toSQL();

    expect(query.sql).toContain('"stage_id" in ($');
    expect(query.params).toContain("stg-1");
    expect(query.params).toContain("stg-2");
    expect(query.params).toContain("stg-3");
  });

  it("deve suportar stageIds enviado como array nativo de strings", () => {
    const conditions = buildDealFilterConditions("tecfag", {
      stageIds: ["stg-a", "stg-b"],
    });

    const query = db
      .select()
      .from(crmDeals)
      .where(and(...conditions))
      .toSQL();

    expect(query.sql).toContain('"stage_id" in ($');
    expect(query.params).toContain("stg-a");
    expect(query.params).toContain("stg-b");
  });

  it("deve normalizar operatorIds enviado como string única ou separada por vírgula", () => {
    const conditionsSingle = buildDealFilterConditions("tecfag", {
      operatorIds: "op-123" as any,
    });
    const querySingle = db.select().from(crmDeals).where(and(...conditionsSingle)).toSQL();
    expect(querySingle.sql).toContain('"operator_id" = $');
    expect(querySingle.params).toContain("op-123");

    const conditionsMulti = buildDealFilterConditions("tecfag", {
      operatorIds: "op-1,op-2" as any,
    });
    const queryMulti = db.select().from(crmDeals).where(and(...conditionsMulti)).toSQL();
    expect(queryMulti.sql).toContain('"operator_id" in ($');
    expect(queryMulti.params).toContain("op-1");
    expect(queryMulti.params).toContain("op-2");
  });

  it("deve normalizar emptyFields enviado como string sem lançar TypeError", () => {
    const conditions = buildDealFilterConditions("tecfag", {
      emptyFields: "rating,company" as any,
    });

    const query = db
      .select()
      .from(crmDeals)
      .where(and(...conditions))
      .toSQL();

    expect(query.sql).toContain('"rating" = 0');
    expect(query.sql).toContain('"account_id" IS NULL');
  });

  it("deve normalizar rating enviado como string numérica", () => {
    const conditions = buildDealFilterConditions("tecfag", {
      rating: "3" as any,
    });

    const query = db
      .select()
      .from(crmDeals)
      .where(and(...conditions))
      .toSQL();

    expect(query.sql).toContain('"rating" = $');
    expect(query.params).toContain(3);
  });

  it("deve gerar condições SQL válidas para todos os 5 filtros de data e filtro de Empresa (companyId)", () => {
    const conditions = buildDealFilterConditions("tecfag", {
      createdAfter: "2026-10-01",
      createdBefore: "2026-10-14",
      lastContactFrom: "2026-10-01",
      lastContactTo: "2026-10-14",
      nextTaskFrom: "2026-10-14",
      nextTaskTo: "2026-10-31",
      closedFrom: "2026-09-01",
      closedTo: "2026-09-30",
      expectedCloseFrom: "2026-10-15",
      expectedCloseTo: "2026-11-15",
      companyId: "acc-tecfag-001",
    });

    const query = db
      .select()
      .from(crmDeals)
      .where(and(...conditions))
      .toSQL();

    expect(query.sql).toContain("created_at");
    expect(query.sql).toContain("COALESCE");
    expect(query.sql).toContain("closed_at");
    expect(query.sql).toContain("expected_close_date");
    expect(query.sql).toContain('"account_id" = $');
    expect(query.params).toContain("acc-tecfag-001");
  });

  it("deve executar a query reproduzida no banco real sem erro de sintaxe SQL", async () => {
    const conditions = buildDealFilterConditions("tecfag", {
      pipelineId: "pipe-tecfag-sdr",
      stageIds: "stg-tf-sdr-para-analise" as any,
      status: "open",
    });

    // Executa no banco com limit 1 apenas para validar que o PostgreSQL compila e roda a query com 100% de sucesso
    const rows = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(...conditions))
      .limit(1);

    expect(Array.isArray(rows)).toBe(true);
  });
});
