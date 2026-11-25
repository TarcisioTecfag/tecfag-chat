import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as pg from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";
import {
  isCustomFieldInactive,
  listCustomFields,
  resolveBulkCustomFieldTargetIds,
  setCustomFieldsActiveState,
} from "../src/lib/crm/custom-fields";
import {
  buildDealUpdatePayload,
  normalizeCustomFieldDefs,
} from "../src/components/crm/ConversationDealsPanel";
import {
  TECFAG_KEEP_ACTIVE_DEAL_FIELD_IDS,
  TECFAG_LEGACY_DEAL_FIELD_IDS_TO_INACTIVATE,
  runInactivateTecfagLegacyDealFields,
} from "../scripts/inactivate-tecfag-legacy-deal-fields.mjs";

function createPgTaggedSql(client: PGlite) {
  return async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
    let text = strings[0];
    const params: unknown[] = [];
    for (let i = 0; i < values.length; i++) {
      text += `$${i + 1}${strings[i + 1]}`;
      params.push(values[i]);
    }
    const res = await client.query(text, params);
    return res.rows as any[];
  };
}

describe("Campos Personalizados — Inativação, Reativação, Histórico e Migração Tecfag", () => {
  let pgClient: PGlite;
  let testDb: any;
  let sql: ReturnType<typeof createPgTaggedSql>;

  beforeAll(async () => {
    pgClient = new PGlite();
    testDb = drizzle(pgClient, { schema });
    sql = createPgTaggedSql(pgClient);

    await pgClient.exec(`
      CREATE TABLE tenants (
        id text PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE crm_pipelines (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        name text NOT NULL
      );
      CREATE TABLE crm_stages (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        pipeline_id text NOT NULL,
        name text NOT NULL,
        order_index integer NOT NULL DEFAULT 0
      );
      CREATE TABLE crm_custom_field_definitions (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        entity_type text NOT NULL,
        name text NOT NULL,
        field_type text NOT NULL,
        options jsonb NOT NULL DEFAULT '[]'::jsonb,
        required boolean NOT NULL DEFAULT false,
        required_rule text NOT NULL DEFAULT 'always',
        required_from_stage_id text,
        is_unique boolean NOT NULL DEFAULT false,
        visible_on_create boolean NOT NULL DEFAULT true,
        all_pipelines boolean NOT NULL DEFAULT true,
        pipeline_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        sort_order integer NOT NULL DEFAULT 0,
        archived_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX idx_crm_custom_fields_tenant_entity_name_active
        ON crm_custom_field_definitions (tenant_id, entity_type, lower(name))
        WHERE archived_at IS NULL;
      CREATE TABLE crm_deals (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        title text NOT NULL,
        custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    await pgClient.exec(`
      INSERT INTO tenants (id, name) VALUES ('tecfag', 'Tecfag'), ('valem', 'Valem');
      INSERT INTO crm_pipelines (id, tenant_id, name) VALUES ('pipe-1', 'tecfag', 'Funil 1');
      INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index)
        VALUES ('stg-existing', 'tecfag', 'pipe-1', 'Etapa 1', 0);
    `);
  });

  afterAll(async () => {
    await pgClient.close();
  });

  it("filtra listCustomFields por status (active, inactive, all) e suporta inativar/reativar preservando isolamento multi-tenant", async () => {
    await testDb.insert(schema.crmCustomFieldDefinitions).values([
      {
        id: "cf-a1",
        tenantId: "tecfag",
        entityType: "deal",
        name: "Campo A1",
        fieldType: "text",
        sortOrder: 0,
      },
      {
        id: "cf-a2",
        tenantId: "tecfag",
        entityType: "deal",
        name: "Campo A2",
        fieldType: "text",
        required: true,
        requiredRule: "stage_onwards",
        requiredFromStageId: "stg-deleted-in-past",
        sortOrder: 1,
      },
      {
        id: "cf-valem-1",
        tenantId: "valem",
        entityType: "deal",
        name: "Campo Valem",
        fieldType: "text",
        sortOrder: 0,
      },
    ]);

    const targets = await resolveBulkCustomFieldTargetIds(
      "tecfag",
      "deal",
      { keepActiveIds: ["cf-a1"], active: false },
      testDb,
    );
    expect(targets).toEqual(["cf-a2"]);

    const { updatedFields } = await setCustomFieldsActiveState(
      "tecfag",
      "deal",
      targets,
      false,
      testDb,
    );
    expect(updatedFields).toHaveLength(1);
    expect(updatedFields[0].id).toBe("cf-a2");
    expect(isCustomFieldInactive(updatedFields[0])).toBe(true);

    // Padrão (sem options) retorna apenas ativos
    const activeOnly = await listCustomFields("tecfag", "deal", testDb);
    expect(activeOnly.map((f) => f.id)).toEqual(["cf-a1"]);

    // status: 'inactive' e 'all'
    const inactiveOnly = await listCustomFields("tecfag", "deal", testDb, { status: "inactive" });
    expect(inactiveOnly.map((f) => f.id)).toEqual(["cf-a2"]);

    const allTecfag = await listCustomFields("tecfag", "deal", testDb, { includeArchived: true });
    expect(allTecfag.map((f) => f.id)).toEqual(["cf-a1", "cf-a2"]);

    // Tenant Valem não pode sofrer mutação por Tecfag
    await expect(
      setCustomFieldsActiveState("tecfag", "deal", ["cf-valem-1"], false, testDb),
    ).rejects.toThrow("não foram encontrados");

    const valemActive = await listCustomFields("valem", "deal", testDb);
    expect(valemActive.map((f) => f.id)).toEqual(["cf-valem-1"]);

    // Bloqueia reativação se já existir outro campo ativo com mesmo nome
    await testDb.insert(schema.crmCustomFieldDefinitions).values({
      id: "cf-a2-dup",
      tenantId: "tecfag",
      entityType: "deal",
      name: "campo a2",
      fieldType: "text",
      sortOrder: 2,
    });
    await expect(
      setCustomFieldsActiveState("tecfag", "deal", ["cf-a2"], true, testDb),
    ).rejects.toThrow("Já existe um campo ativo");

    // Inativa o duplicado e reativa cf-a2 — etapa removida deve ser saneada para 'always'
    await setCustomFieldsActiveState("tecfag", "deal", ["cf-a2-dup"], false, testDb);
    const { updatedFields: reactivated } = await setCustomFieldsActiveState(
      "tecfag",
      "deal",
      ["cf-a2"],
      true,
      testDb,
    );
    expect(reactivated).toHaveLength(1);
    expect(reactivated[0].archivedAt).toBeNull();
    expect(reactivated[0].requiredRule).toBe("always");
    expect(reactivated[0].requiredFromStageId).toBeNull();
  });

  it("script de deploy da Tecfag inativa apenas os 29 legados RD, mantém os 6 do print + 4 da Black ativos e preserva 100% dos valores em crm_deals", async () => {
    await pgClient.exec("DELETE FROM crm_custom_field_definitions; DELETE FROM crm_deals;");

    for (let i = 0; i < TECFAG_KEEP_ACTIVE_DEAL_FIELD_IDS.length; i++) {
      const id = TECFAG_KEEP_ACTIVE_DEAL_FIELD_IDS[i];
      await testDb.insert(schema.crmCustomFieldDefinitions).values({
        id,
        tenantId: "tecfag",
        entityType: "deal",
        name: `Keep ${id}`,
        fieldType: "text",
        sortOrder: i,
      });
    }

    for (let i = 0; i < TECFAG_LEGACY_DEAL_FIELD_IDS_TO_INACTIVATE.length; i++) {
      const id = TECFAG_LEGACY_DEAL_FIELD_IDS_TO_INACTIVATE[i];
      await testDb.insert(schema.crmCustomFieldDefinitions).values({
        id,
        tenantId: "tecfag",
        entityType: "deal",
        name: `Legacy ${id}`,
        fieldType: "text",
        sortOrder: 100 + i,
      });
    }

    // Campo de outra entidade e de outro tenant não podem ser afetados
    await testDb.insert(schema.crmCustomFieldDefinitions).values([
      {
        id: "cf-company-tecfag",
        tenantId: "tecfag",
        entityType: "company",
        name: "TIPO DE EMPRESA",
        fieldType: "text",
        sortOrder: 0,
      },
      {
        id: TECFAG_LEGACY_DEAL_FIELD_IDS_TO_INACTIVATE[0],
        tenantId: "valem",
        entityType: "deal",
        name: "Campo Valem Mesmo ID?",
        fieldType: "text",
        sortOrder: 0,
      },
    ]).onConflictDoNothing();

    await pgClient.query(
      `INSERT INTO crm_deals (id, tenant_id, title, custom_fields) VALUES ($1, $2, $3, $4::jsonb)`,
      [
        "deal-historico-1",
        "tecfag",
        "Negociação Histórica",
        JSON.stringify({
          "cf-tf-deal-produtos": "Seladora FX-800",
          "cf-tf-deal-equipamento": "DK50Z",
          black_maquina: "FX-800",
        }),
      ],
    );

    const firstRun = await runInactivateTecfagLegacyDealFields(sql, "tecfag");
    expect(firstRun.inactivatedCount).toBe(29);
    expect(new Set(firstRun.inactivatedIds)).toEqual(
      new Set(TECFAG_LEGACY_DEAL_FIELD_IDS_TO_INACTIVATE),
    );

    const activeDeals = await listCustomFields("tecfag", "deal", testDb, { status: "active" });
    expect(activeDeals.map((f) => f.id).sort()).toEqual(
      [...TECFAG_KEEP_ACTIVE_DEAL_FIELD_IDS].sort(),
    );

    const inactiveDeals = await listCustomFields("tecfag", "deal", testDb, { status: "inactive" });
    expect(inactiveDeals).toHaveLength(29);

    const activeCompany = await listCustomFields("tecfag", "company", testDb, { status: "active" });
    expect(activeCompany.map((f) => f.id)).toEqual(["cf-company-tecfag"]);

    // Valores históricos na negociação continuam intactos
    const dealRows = await sql`SELECT custom_fields FROM crm_deals WHERE id = ${"deal-historico-1"}`;
    expect(dealRows[0].custom_fields).toEqual({
      "cf-tf-deal-produtos": "Seladora FX-800",
      "cf-tf-deal-equipamento": "DK50Z",
      black_maquina: "FX-800",
    });

    // Segunda execução é idempotente (0 alterados)
    const secondRun = await runInactivateTecfagLegacyDealFields(sql, "tecfag");
    expect(secondRun.inactivatedCount).toBe(0);
  });

  it("ConversationDealsPanel preserva archivedAt, exibe histórico e exclui campos inativos do payload de edição inline", () => {
    const defs = normalizeCustomFieldDefs([
      { id: "cf-active", name: "Ativo", fieldType: "text", allPipelines: true, archivedAt: null },
      {
        id: "cf-inactive",
        name: "Legado",
        fieldType: "text",
        allPipelines: true,
        archivedAt: "2026-11-25T15:00:00.000Z",
      },
    ]);

    expect(defs[0].archivedAt).toBeNull();
    expect(defs[1].archivedAt).toBe("2026-11-25T15:00:00.000Z");

    const payload = buildDealUpdatePayload(
      {
        id: "deal-1",
        title: "Deal",
        value: "100",
        pipelineId: "p1",
        stageId: "s1",
        operatorId: "op1",
        status: "open",
        customFields: { "cf-active": "v1", "cf-inactive": "hist" },
      },
      {
        title: "Deal",
        value: "100",
        pipelineId: "p1",
        stageId: "s1",
        operatorId: "op1",
        status: "open",
        customFields: { "cf-active": "v2", "cf-inactive": "tentativa-alterar" },
      },
      defs,
    );

    expect(payload.customFields).toEqual({ "cf-active": "v2" });
  });

  it("CustomFieldsSettingsModal segue Design System (sem confirm/select/radio/title nativos) e expõe Inativar/Reativar/Em massa", () => {
    const modalSource = readFileSync(
      path.resolve(import.meta.dir, "..", "src/components/crm/CustomFieldsSettingsModal.tsx"),
      "utf8",
    );
    const editorSource = readFileSync(
      path.resolve(import.meta.dir, "..", "src/components/crm/CustomFieldsEditor.tsx"),
      "utf8",
    );

    expect(modalSource).not.toMatch(/\bconfirm\s*\(/);
    expect(modalSource).not.toMatch(/<select[\s>]/);
    expect(modalSource).not.toMatch(/type\s*=\s*["']radio["']/i);
    expect(modalSource).not.toMatch(/\btitle\s*=/);
    expect(modalSource).toContain("Inativar selecionados");
    expect(modalSource).toContain("Manter marcados e inativar os outros");
    expect(modalSource).toContain("Reativar selecionados");
    expect(modalSource).toContain("Inativos");

    expect(editorSource).toContain("Histórico de campos inativos");
    expect(editorSource).toContain("Inativo");
  });
});
