import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Carrega .env nativamente se existir no ambiente de execução
if (typeof process.loadEnvFile === "function") {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
  } catch (e) {}
} else if (existsSync(".env")) {
  try {
    const envContent = readFileSync(".env", "utf8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || "").trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (e) {}
}

const migrations = [
  {
    name: "0008_mvp_idempotency_unique_and_recovery",
    url: new URL(
      "../src/db/migrations/0008_mvp_idempotency_unique_and_recovery.sql",
      import.meta.url,
    ),
  },
  {
    name: "0009_crm_core_foundation",
    url: new URL("../src/db/migrations/0009_crm_core_foundation.sql", import.meta.url),
  },
  {
    name: "0010_crm_products_proposals",
    url: new URL("../src/db/migrations/0010_crm_products_proposals.sql", import.meta.url),
  },
  {
    name: "0011_platform_access",
    url: new URL("../src/db/migrations/0011_platform_access.sql", import.meta.url),
  },
  {
    name: "bootstrap_platform_manager_existing_operator",
    url: new URL("./migrations/bootstrap-platform-manager-existing-operator.sql", import.meta.url),
  },
  {
    name: "0012_crm_deal_value_nullable",
    url: new URL("../src/db/migrations/0012_crm_deal_value_nullable.sql", import.meta.url),
  },
  {
    name: "0013_platform_access",
    url: new URL("../src/db/migrations/0013_platform_access.sql", import.meta.url),
  },
  {
    name: "0014_crm_migration_and_sync_policy",
    url: new URL("../src/db/migrations/0014_crm_migration_and_sync_policy.sql", import.meta.url),
  },
  {
    name: "0015_crm_extended_parity",
    url: new URL("../src/db/migrations/0015_crm_extended_parity.sql", import.meta.url),
  },
  {
    name: "0016_crm_stage_settings",
    url: new URL("../src/db/migrations/0016_crm_stage_settings.sql", import.meta.url),
  },
  {
    name: "0017_crm_custom_fields",
    url: new URL("../src/db/migrations/0017_crm_custom_fields.sql", import.meta.url),
  },
  {
    name: "0018_crm_catalogs",
    url: new URL("../src/db/migrations/0018_crm_catalogs.sql", import.meta.url),
  },
  {
    name: "0019_meta_message_tracking",
    url: new URL("../src/db/migrations/0019_meta_message_tracking.sql", import.meta.url),
  },
  {
    name: "0020_whatsapp_user_identity",
    url: new URL("../src/db/migrations/0020_whatsapp_user_identity.sql", import.meta.url),
  },
  {
    name: "0021_conversation_contact_unique",
    url: new URL("../src/db/migrations/0021_conversation_contact_unique.sql", import.meta.url),
  },
  {
    name: "0022_meta_message_templates",
    url: new URL("../src/db/migrations/0022_meta_message_templates.sql", import.meta.url),
  },
  {
    name: "0023_crm_action_history",
    url: new URL("../src/db/migrations/0023_crm_action_history.sql", import.meta.url),
  },
  {
    name: "0024_customer_identity_guards",
    url: new URL("../src/db/migrations/0024_customer_identity_guards.sql", import.meta.url),
  },
  {
    name: "0025_crm_catalog_standard_items_policy",
    url: new URL(
      "../src/db/migrations/0025_crm_catalog_standard_items_policy.sql",
      import.meta.url,
    ),
  },
  {
    name: "0026_crm_custom_fields_unique_and_stage_rules",
    url: new URL(
      "../src/db/migrations/0026_crm_custom_fields_unique_and_stage_rules.sql",
      import.meta.url,
    ),
  },
  {
    name: "0027_commercial_war_room_foundation",
    url: new URL("../src/db/migrations/0027_commercial_war_room_foundation.sql", import.meta.url),
  },
  {
    name: "0028_canonical_phone_ddi55_and_auto_link",
    url: new URL(
      "../src/db/migrations/0028_canonical_phone_ddi55_and_auto_link.sql",
      import.meta.url,
    ),
  },
  {
    name: "0029_commercial_directive_snapshot",
    url: new URL("../src/db/migrations/0029_commercial_directive_snapshot.sql", import.meta.url),
  },
  {
    name: "0030_commercial_loss_taxonomy",
    url: new URL("../src/db/migrations/0030_commercial_loss_taxonomy.sql", import.meta.url),
  },
  {
    name: "0031_commercial_consultant_rd_link",
    url: new URL("../src/db/migrations/0031_commercial_consultant_rd_link.sql", import.meta.url),
  },
  {
    name: "0032_commercial_pipeline_by_division",
    url: new URL("../src/db/migrations/0032_commercial_pipeline_by_division.sql", import.meta.url),
  },
  {
    name: "0034_performance_indexes",
    url: new URL("../src/db/migrations/0034_performance_indexes.sql", import.meta.url),
  },
  {
    name: "0035_rd_marketing",
    url: new URL("../src/db/migrations/0035_rd_marketing.sql", import.meta.url),
  },
  {
    name: "0036_durable_recovery",
    url: new URL("../src/db/migrations/0036_durable_recovery.sql", import.meta.url),
  },
  {
    name: "0037_rd_marketing_oauth",
    url: new URL("../src/db/migrations/0037_rd_marketing_oauth.sql", import.meta.url),
  },
  {
    name: "0038_rd_marketing_journey",
    url: new URL("../src/db/migrations/0038_rd_marketing_journey.sql", import.meta.url),
  },
  {
    name: "0039_rd_marketing_sync",
    url: new URL("../src/db/migrations/0039_rd_marketing_sync.sql", import.meta.url),
  },
  {
    name: "0040_knowledge_and_media_indexes",
    url: new URL("../src/db/migrations/0040_knowledge_and_media_indexes.sql", import.meta.url),
  },
  {
    name: "0041_rd_marketing_outbound_test",
    url: new URL("../src/db/migrations/0041_rd_marketing_outbound_test.sql", import.meta.url),
  },
  {
    name: "0042_meta_template_custom_groups",
    url: new URL("../src/db/migrations/0042_meta_template_custom_groups.sql", import.meta.url),
  },
  {
    name: "0043_contact_phone_mobile_identity",
    url: new URL("../src/db/migrations/0043_contact_phone_mobile_identity.sql", import.meta.url),
  },
  {
    name: "0044_rd_marketing_activity_events",
    url: new URL("../src/db/migrations/0044_rd_marketing_activity_events.sql", import.meta.url),
  },
  {
    name: "0045_conversation_deal_context",
    url: new URL("../src/db/migrations/0045_conversation_deal_context.sql", import.meta.url),
  },
  {
    name: "0046_attendance_events",
    url: new URL("../src/db/migrations/0046_attendance_events.sql", import.meta.url),
  },
  {
    name: "0047_whatsapp_multi_connection",
    url: new URL("../src/db/migrations/0047_whatsapp_multi_connection.sql", import.meta.url),
  },
  {
    name: "0048_whatsapp_connection_group_access",
    url: new URL("../src/db/migrations/0048_whatsapp_connection_group_access.sql", import.meta.url),
  },
  {
    name: "0049_operator_onboarding",
    url: new URL("../src/db/migrations/0049_operator_onboarding.sql", import.meta.url),
  },
  {
    name: "0050_attendance_event_actors",
    url: new URL("../src/db/migrations/0050_attendance_event_actors.sql", import.meta.url),
  },
  {
    name: "0051_operator_presence_and_password_reset",
    url: new URL(
      "../src/db/migrations/0051_operator_presence_and_password_reset.sql",
      import.meta.url,
    ),
  },
  {
    name: "0052_sector_copilot_config",
    url: new URL(
      "../src/db/migrations/0052_sector_copilot_config.sql",
      import.meta.url,
    ),
  },
  {
    name: "0053_shared_deal_activities",
    url: new URL(
      "../src/db/migrations/0053_shared_deal_activities.sql",
      import.meta.url,
    ),
  },
];
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[platform migration] DATABASE_URL não configurada.");
  process.exitCode = 1;
} else {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    // 1. Migrações estruturais DDL (tabelas, colunas, índices, constraints)
    await sql.begin(async (tx) => {
      // Serializa startups simultâneos para não executar a mesma migração duas vezes.
      await tx`SELECT pg_advisory_xact_lock(1650547787, 11)`;
      await tx`
        CREATE TABLE IF NOT EXISTS app_deploy_migrations (
          name text PRIMARY KEY,
          applied_at timestamp DEFAULT now() NOT NULL
        )
      `;

      for (const migration of migrations) {
        const applied = await tx`
          SELECT name FROM app_deploy_migrations WHERE name = ${migration.name}
        `;
        if (applied.length > 0) {
          console.log(`[platform migration] ${migration.name} já aplicada.`);
          continue;
        }

        const migrationSql = await readFile(fileURLToPath(migration.url), "utf8");
        await tx.unsafe(migrationSql);
        await tx`INSERT INTO app_deploy_migrations (name) VALUES (${migration.name})`;
        console.log(`[platform migration] ${migration.name} aplicada com sucesso.`);
      }
    });

    // 2. Reset Zero-Day operacional do tenant Tecfag (Negociações, Contatos, Empresas, Tarefas e Conversas)
    // Executa APENAS UMA VEZ por ambiente (controlado via app_deploy_migrations)
    const tecfagZeroDayResetName = "reset_tecfag_zero_day_2026_10_28";
    const [appliedZeroDayReset] = await sql`
      SELECT name FROM app_deploy_migrations WHERE name = ${tecfagZeroDayResetName}
    `;
    if (!appliedZeroDayReset) {
      console.log(`[platform migration] Iniciando execução única de ${tecfagZeroDayResetName}...`);
      const { runTenantReset } = await import("./reset-tenant-data.mjs");
      await runTenantReset(sql, "tecfag", { isDryRun: false });
      await sql`
        INSERT INTO app_deploy_migrations (name)
        VALUES (${tecfagZeroDayResetName})
        ON CONFLICT (name) DO NOTHING
      `;
      console.log(`[platform migration] ${tecfagZeroDayResetName} concluída e registrada com sucesso.`);
    } else {
      console.log(`[platform migration] ${tecfagZeroDayResetName} já aplicada anteriormente.`);
    }

    // 3. Backfill único de carteira (wallet_operator_id) para contatos já capturados/transferidos
    const walletBackfillName = "backfill_wallet_operator_from_active_chats_2026_10_28";
    const [appliedWalletBackfill] = await sql`
      SELECT name FROM app_deploy_migrations WHERE name = ${walletBackfillName}
    `;
    if (!appliedWalletBackfill) {
      await sql.begin(async (tx) => {
        const res = await tx`
          UPDATE contacts c
          SET wallet_operator_id = sub.operator_id
          FROM (
            SELECT DISTINCT ON (contact_id, tenant_id) contact_id, tenant_id, operator_id
            FROM conversations
            WHERE operator_id IS NOT NULL AND queue_state = 'meus'
            ORDER BY contact_id, tenant_id, updated_at DESC
          ) sub
          WHERE c.id = sub.contact_id
            AND c.tenant_id = sub.tenant_id
            AND c.wallet_operator_id IS NULL
        `;
        await tx`
          INSERT INTO app_deploy_migrations (name)
          VALUES (${walletBackfillName})
          ON CONFLICT (name) DO NOTHING
        `;
        console.log(`[platform migration] ${walletBackfillName} aplicada (${res.count ?? 0} contatos vinculados à carteira).`);
      });
    }

    // 4. Carga automática de todos os produtos da loja VTEX (Nome, Descrição, Valor, SKU, Categoria) em crm_products (tenant tecfag)
    const vtexProductsSeedName = "seed_tecfag_vtex_crm_products_2026_10_29";
    const [appliedVtexProductsSeed] = await sql`
      SELECT name FROM app_deploy_migrations WHERE name = ${vtexProductsSeedName}
    `;
    if (!appliedVtexProductsSeed) {
      const seedUrl = new URL("./data/tecfag-vtex-products-seed.json", import.meta.url);
      const seedPath = fileURLToPath(seedUrl);
      if (existsSync(seedPath)) {
        const rawJson = await readFile(seedPath, "utf8");
        const parsed = JSON.parse(rawJson);
        const items = Array.isArray(parsed?.products) ? parsed.products : [];
        if (items.length > 0) {
          await sql.begin(async (tx) => {
            const now = new Date();
            const BATCH = 200;
            for (let i = 0; i < items.length; i += BATCH) {
              const slice = items.slice(i, i + BATCH).map((p) => ({
                id: String(p.id),
                tenant_id: "tecfag",
                name: String(p.name || "").trim(),
                sku: p.sku ? String(p.sku).trim() : null,
                description: p.description ? String(p.description).trim() : null,
                unit_price: String(p.unitPrice || "0.00"),
                unit: String(p.unit || "UN"),
                category: p.category ? String(p.category).trim() : null,
                custom_fields: {},
                is_active: p.isActive !== false,
                created_at: now,
                updated_at: now,
              }));
              await tx`
                INSERT INTO crm_products ${tx(
                  slice,
                  "id",
                  "tenant_id",
                  "name",
                  "sku",
                  "description",
                  "unit_price",
                  "unit",
                  "category",
                  "custom_fields",
                  "is_active",
                  "created_at",
                  "updated_at",
                )}
                ON CONFLICT (id) DO UPDATE SET
                  name = EXCLUDED.name,
                  sku = COALESCE(EXCLUDED.sku, crm_products.sku),
                  description = COALESCE(EXCLUDED.description, crm_products.description),
                  unit_price = EXCLUDED.unit_price,
                  category = COALESCE(EXCLUDED.category, crm_products.category),
                  updated_at = NOW()
              `;
            }
            await tx`
              INSERT INTO app_deploy_migrations (name)
              VALUES (${vtexProductsSeedName})
              ON CONFLICT (name) DO NOTHING
            `;
          });
          console.log(`[platform migration] ${vtexProductsSeedName} aplicada (${items.length} produtos VTEX carregados em crm_products).`);
        }
      } else {
        console.warn(`[platform migration] Arquivo ${seedPath} não encontrado para ${vtexProductsSeedName}.`);
      }
    } else {
      console.log(`[platform migration] ${vtexProductsSeedName} já aplicada anteriormente.`);
    }
  } catch (error) {
    console.error(
      "[platform migration] Falha crítica ao aplicar migrações estruturais DDL:",
      error,
    );
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
