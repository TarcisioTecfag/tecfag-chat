import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import zlib from "node:zlib";
import postgres from "postgres";
import {
  LEGACY_DEBORAH_EMAIL,
  LEGACY_DEBORAH_ID,
  REAL_DEBORAH_EMAIL,
  REAL_DEBORAH_ID,
  REAL_DEBORAH_NAME,
  runReassignDeborahAlvesOperator,
} from "../scripts/reassign-deborah-alves-operator.mjs";

function loadLocalDbUrl(): string | null {
  if (fs.existsSync(".env")) {
    const raw = fs.readFileSync(".env", "utf8");
    const m = raw.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m?.[1]) {
      try {
        const u = new URL(m[1]);
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
          return m[1];
        }
      } catch {}
    }
  }
  return null;
}

describe("Reatribuição Integral Deborah Alves (ouvidoria@tecfag.com.br) e Exclusão de vendas15@tecfag.com.br", () => {
  it("alinha ACTIVE_OPERATOR_SPECS e importers nos 6 scripts (Full, Peças e Suporte) para Deborah Alves (ouvidoria@tecfag.com.br)", () => {
    for (const scriptPath of [
      "scripts/build-tecfag-full-rd-crm.mjs",
      "scripts/build-tecfag-pecas-rd-crm.mjs",
      "scripts/build-tecfag-suporte-rd-crm.mjs",
      "scripts/import-tecfag-full-rd-crm.mjs",
      "scripts/import-tecfag-pecas-rd-crm.mjs",
      "scripts/import-tecfag-suporte-rd-crm.mjs",
    ]) {
      const content = fs.readFileSync(scriptPath, "utf8");
      expect(content).toContain(REAL_DEBORAH_ID);
      expect(content).toContain(REAL_DEBORAH_EMAIL);
      expect(content).toContain(REAL_DEBORAH_NAME);
      expect(content).not.toContain(LEGACY_DEBORAH_EMAIL);
    }
  });

  it("confirma as 896 negociações totais da Deborah nos 3 payloads de migração (795 Full + 4 Peças + 97 Suporte)", () => {
    const full = JSON.parse(
      zlib
        .gunzipSync(
          fs.readFileSync("scripts/data/tecfag-full-rd-crm-2026-11-10.json.gz"),
        )
        .toString("utf8"),
    );
    const pecas = JSON.parse(
      zlib
        .gunzipSync(
          fs.readFileSync("scripts/data/tecfag-pecas-rd-crm-2026-11-12.json.gz"),
        )
        .toString("utf8"),
    );
    const suporte = JSON.parse(
      zlib
        .gunzipSync(
          fs.readFileSync(
            "scripts/data/tecfag-suporte-rd-crm-2026-11-13.json.gz",
          ),
        )
        .toString("utf8"),
    );

    const fullCount = full.deals.filter(
      (d: any) => d.operator_key === "deborah_rayane",
    ).length;
    const pecasCount = pecas.deals.filter(
      (d: any) => d.operator_key === "deborah_rayane",
    ).length;
    const suporteCount = suporte.deals.filter(
      (d: any) => d.operator_key === "deborah_rayane",
    ).length;

    expect(fullCount).toBe(795);
    expect(pecasCount).toBe(4);
    expect(suporteCount).toBe(97);
    expect(fullCount + pecasCount + suporteCount).toBe(896);
  });

  it("transfere negociações, tarefas, contatos, conversas, setor Pós-Venda e escala Rodízio, exclui vendas15@tecfag.com.br e preserva valem intacto (idempotente)", async () => {
    const localUrl = loadLocalDbUrl();
    if (!localUrl) return;

    const schemaName = `test_deborah_${Date.now()}`;
    const sql = postgres(localUrl, {
      max: 1,
      prepare: false,
      connection: { search_path: `${schemaName},public` },
    });

    try {
      await sql.unsafe(`CREATE SCHEMA ${schemaName}`);
      await sql.unsafe(`
        CREATE TABLE ${schemaName}.tenants (id text PRIMARY KEY, name text);
        CREATE TABLE ${schemaName}.platform_accounts (id text PRIMARY KEY, email text UNIQUE, password_hash text, home_tenant_id text);
        CREATE TABLE ${schemaName}.operators (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          account_id text,
          name text NOT NULL,
          email text NOT NULL,
          password_hash text NOT NULL,
          role text NOT NULL DEFAULT 'agent',
          avatar text,
          status text NOT NULL DEFAULT 'disponivel',
          group_id text,
          is_online boolean NOT NULL DEFAULT false
        );
        CREATE TABLE ${schemaName}.crm_deals (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          title text NOT NULL,
          operator_id text,
          updated_at timestamptz NOT NULL DEFAULT NOW()
        );
        CREATE TABLE ${schemaName}.contacts (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          name text NOT NULL,
          wallet_operator_id text,
          responsible_name text NOT NULL DEFAULT 'Na Fila'
        );
        CREATE TABLE ${schemaName}.crm_deal_activities (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          deal_id text NOT NULL,
          type text NOT NULL,
          title text NOT NULL,
          operator_id text,
          assigned_to_operator_id text,
          assigned_to_operator_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
          edit_history jsonb NOT NULL DEFAULT '[]'::jsonb
        );
        CREATE TABLE ${schemaName}.conversations (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          operator_id text
        );
        CREATE TABLE ${schemaName}.sectors (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          name text NOT NULL,
          operator_ids jsonb NOT NULL DEFAULT '[]'::jsonb
        );
        CREATE TABLE ${schemaName}.agent_configs (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          agent_type text NOT NULL,
          config jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT NOW()
        );
        CREATE TABLE ${schemaName}.crm_action_history (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          operator_id text,
          operator_name text NOT NULL,
          action text NOT NULL,
          entity_type text NOT NULL,
          item_count int NOT NULL,
          details jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT NOW()
        );
      `);

      await sql`
        INSERT INTO tenants (id, name) VALUES ('tecfag', 'Tecfag'), ('valem', 'Valem')
      `;
      await sql`
        INSERT INTO platform_accounts (id, email, password_hash, home_tenant_id)
        VALUES
          ('pacc-legacy', ${LEGACY_DEBORAH_EMAIL}, 'hash-old', 'tecfag'),
          ('pacc-real', ${REAL_DEBORAH_EMAIL}, 'hash-real', 'tecfag')
      `;
      await sql`
        INSERT INTO operators (id, tenant_id, account_id, name, email, password_hash, role, avatar, status, group_id, is_online)
        VALUES
          (${LEGACY_DEBORAH_ID}, 'tecfag', 'pacc-legacy', 'Déborah Rayane', ${LEGACY_DEBORAH_EMAIL}, 'hash-old', 'agent', 'avatar-old', 'disponivel', 'grp-posvenda', false),
          (${REAL_DEBORAH_ID}, 'tecfag', 'pacc-real', ${REAL_DEBORAH_NAME}, ${REAL_DEBORAH_EMAIL}, 'hash-real-secret', 'agent', NULL, 'disponivel', NULL, true),
          ('op-valem-1', 'valem', NULL, 'Consultora Valem', 'valem@valem.com.br', 'hash-valem', 'agent', NULL, 'disponivel', 'grp-valem', true)
      `;
      await sql`
        INSERT INTO crm_deals (id, tenant_id, title, operator_id, updated_at)
        VALUES
          ('deal-sup-1', 'tecfag', 'IMPERATRIZ BEBIDAS', ${LEGACY_DEBORAH_ID}, '2026-11-09T20:19:00Z'),
          ('deal-maq-1', 'tecfag', 'SELADORA CONTINUA', ${LEGACY_DEBORAH_ID}, '2026-09-16T18:19:00Z'),
          ('deal-valem-1', 'valem', 'FRASCOS VALEM', 'op-valem-1', '2026-11-10T10:00:00Z')
      `;
      await sql`
        INSERT INTO contacts (id, tenant_id, name, wallet_operator_id, responsible_name)
        VALUES
          ('cont-1', 'tecfag', 'Cliente Pós-Venda', ${LEGACY_DEBORAH_ID}, 'Déborah Rayane'),
          ('cont-valem-1', 'valem', 'Cliente Valem', 'op-valem-1', 'Consultora Valem')
      `;
      await sql`
        INSERT INTO crm_deal_activities (id, tenant_id, deal_id, type, title, operator_id, assigned_to_operator_id, assigned_to_operator_ids, edit_history)
        VALUES (
          'act-1',
          'tecfag',
          'deal-sup-1',
          'task',
          'Retornar cliente',
          ${LEGACY_DEBORAH_ID},
          ${LEGACY_DEBORAH_ID},
          ${sql.json([LEGACY_DEBORAH_ID, "op-1791377140738"])},
          ${sql.json([{ editedAt: "2026-11-10T10:00:00Z", operatorId: LEGACY_DEBORAH_ID, operatorName: "Déborah Rayane" }])}
        )
      `;
      await sql`
        INSERT INTO conversations (id, tenant_id, operator_id)
        VALUES
          ('conv-1', 'tecfag', ${LEGACY_DEBORAH_ID}),
          ('conv-valem-1', 'valem', 'op-valem-1')
      `;
      await sql`
        INSERT INTO sectors (id, tenant_id, name, operator_ids)
        VALUES (
          'sec-1793215589140',
          'tecfag',
          'Pós venda',
          ${sql.json(["op-1791377140738", "op-1791377157191", LEGACY_DEBORAH_ID])}
        )
      `;
      await sql`
        INSERT INTO agent_configs (id, tenant_id, agent_type, config)
        VALUES (
          'cfg-rodizio-tf',
          'tecfag',
          'rodizio',
          ${sql.json({
            flowOperators: [
              {
                id: "op-1791377140738",
                name: "Lucimara Dal Mora",
                email: "sac@tecfag.com.br",
                area: "pos_venda",
                funnels: ["Pós-Venda"],
                isParticipating: true,
                leadsReceivedCount: 3,
              },
              {
                id: LEGACY_DEBORAH_ID,
                name: "Déborah Rayane",
                email: LEGACY_DEBORAH_EMAIL,
                area: "pos_venda",
                funnels: ["Pós-Venda"],
                isParticipating: true,
                leadsReceivedCount: 5,
                compensation: 1,
                recentLeads: [{ id: "lead-1" }],
              },
            ],
            operatorsMap: {
              [LEGACY_DEBORAH_ID]: {
                operatorId: LEGACY_DEBORAH_ID,
                isParticipating: true,
                leadsReceivedCount: 5,
              },
            },
          })}
        )
      `;

      // Execução #1
      const res1 = await runReassignDeborahAlvesOperator(sql, {
        tenantId: "tecfag",
      });
      expect(res1.applied).toBe(true);
      expect(res1.stats.dealsReassigned).toBe(2);
      expect(res1.stats.contactsReassigned).toBe(1);
      expect(res1.stats.activitiesReassigned).toBe(1);
      expect(res1.stats.conversationsReassigned).toBe(1);
      expect(res1.stats.sourceOperatorDeleted).toBe(true);
      expect(res1.stats.orphanPlatformAccountDeleted).toBe(true);
      expect(res1.stats.rodizioUpdated).toBe(true);

      // Execução #2 (Idempotência estrita)
      const res2 = await runReassignDeborahAlvesOperator(sql, {
        tenantId: "tecfag",
      });
      expect(res2.applied).toBe(true);
      expect(res2.deletedSourceOperator).toBeNull();
      expect(res2.stats.dealsReassigned).toBe(0);
      expect(res2.stats.sourceOperatorDeleted).toBe(false);

      // Validações de estado final
      const remainingOps = await sql`SELECT * FROM operators WHERE tenant_id = 'tecfag'`;
      expect(remainingOps.length).toBe(1);
      expect(remainingOps[0].id).toBe(REAL_DEBORAH_ID);
      expect(remainingOps[0].email).toBe(REAL_DEBORAH_EMAIL);
      expect(remainingOps[0].password_hash).toBe("hash-real-secret");
      expect(remainingOps[0].group_id).toBe("grp-posvenda");
      expect(remainingOps[0].avatar).toBe("avatar-old");

      const remainingAccounts = await sql`SELECT * FROM platform_accounts`;
      expect(remainingAccounts.map((a: any) => a.id)).toEqual(["pacc-real"]);

      const deals = await sql`SELECT * FROM crm_deals WHERE tenant_id = 'tecfag' ORDER BY id`;
      expect(deals.map((d: any) => d.operator_id)).toEqual([
        REAL_DEBORAH_ID,
        REAL_DEBORAH_ID,
      ]);
      // Preserva updated_at histórico
      expect(new Date(deals[0].updated_at).toISOString()).toBe(
        "2026-09-16T18:19:00.000Z",
      );

      const [act] = await sql`SELECT * FROM crm_deal_activities WHERE id = 'act-1'`;
      expect(act.operator_id).toBe(REAL_DEBORAH_ID);
      expect(act.assigned_to_operator_id).toBe(REAL_DEBORAH_ID);
      expect(act.assigned_to_operator_ids).toEqual([
        REAL_DEBORAH_ID,
        "op-1791377140738",
      ]);
      expect(act.edit_history[0].operatorId).toBe(REAL_DEBORAH_ID);
      expect(act.edit_history[0].operatorName).toBe(REAL_DEBORAH_NAME);

      const [sec] = await sql`SELECT * FROM sectors WHERE id = 'sec-1793215589140'`;
      expect(sec.operator_ids).toEqual([
        "op-1791377140738",
        "op-1791377157191",
        REAL_DEBORAH_ID,
      ]);

      const [rodizio] = await sql`SELECT * FROM agent_configs WHERE id = 'cfg-rodizio-tf'`;
      const debFlow = rodizio.config.flowOperators.find(
        (f: any) => f.id === REAL_DEBORAH_ID,
      );
      expect(debFlow).toBeDefined();
      expect(debFlow.email).toBe(REAL_DEBORAH_EMAIL);
      expect(debFlow.leadsReceivedCount).toBe(5);
      expect(
        rodizio.config.flowOperators.find((f: any) => f.id === LEGACY_DEBORAH_ID),
      ).toBeUndefined();
      expect(rodizio.config.operatorsMap[LEGACY_DEBORAH_ID]).toBeUndefined();
      expect(rodizio.config.operatorsMap[REAL_DEBORAH_ID].operatorId).toBe(
        REAL_DEBORAH_ID,
      );

      // Isolamento Valem 100% intocado
      const [valemDeal] = await sql`SELECT * FROM crm_deals WHERE tenant_id = 'valem'`;
      expect(valemDeal.operator_id).toBe("op-valem-1");
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await sql.end();
    }
  });
});
