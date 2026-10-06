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
    url: new URL("../src/db/migrations/0025_crm_catalog_standard_items_policy.sql", import.meta.url),
  },
  {
    name: "0026_crm_custom_fields_unique_and_stage_rules",
    url: new URL("../src/db/migrations/0026_crm_custom_fields_unique_and_stage_rules.sql", import.meta.url),
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

    // 2. Migração de dados de negócio da Tecfag (Planilha de Negociações do Funil Máquinas)
    const tecfagMigrationName = "import_tecfag_deals_spreadsheet_v1";
    const [appliedTecfag] = await sql`
      SELECT name FROM app_deploy_migrations WHERE name = ${tecfagMigrationName}
    `;
    if (!appliedTecfag) {
      console.log(`[platform migration] Iniciando execução de ${tecfagMigrationName}...`);
      try {
        const { runTecfagSpreadsheetImport } = await import("./import-tecfag-spreadsheet.mjs");
        await runTecfagSpreadsheetImport(sql);
        await sql`INSERT INTO app_deploy_migrations (name) VALUES (${tecfagMigrationName}) ON CONFLICT (name) DO NOTHING`;
        console.log(`[platform migration] ${tecfagMigrationName} concluída e registrada com sucesso.`);
      } catch (importErr) {
        console.error(`[platform migration] Aviso: Falha na importação da planilha Tecfag (${tecfagMigrationName}):`, importErr);
        // Não encerra o processo: as migrações DDL estruturais já estão aplicadas com sucesso
      }
    } else {
      console.log(`[platform migration] ${tecfagMigrationName} já aplicada anteriormente.`);
    }

    // 3. Migração de campos personalizados, catálogos e enriquecimento de cards/empresas
    const tecfagCfMigrationName = "import_tecfag_custom_fields_v2";
    const [appliedTecfagCf] = await sql`
      SELECT name FROM app_deploy_migrations WHERE name = ${tecfagCfMigrationName}
    `;
    if (!appliedTecfagCf) {
      console.log(`[platform migration] Iniciando execução de ${tecfagCfMigrationName}...`);
      try {
        const { runCustomFieldsMigration } = await import("./migrate-tecfag-custom-fields.mjs");
        await runCustomFieldsMigration(sql);
        await sql`INSERT INTO app_deploy_migrations (name) VALUES (${tecfagCfMigrationName}) ON CONFLICT (name) DO NOTHING`;
        console.log(`[platform migration] ${tecfagCfMigrationName} concluída e registrada com sucesso.`);
      } catch (cfErr) {
        console.error(`[platform migration] Aviso: Falha na migração de custom fields (${tecfagCfMigrationName}):`, cfErr);
      }
    } else {
      console.log(`[platform migration] ${tecfagCfMigrationName} já aplicada anteriormente.`);
    }

    // 4. Reset pontual de dados operacionais do tenant Tecfag (executa APENAS UMA VEZ no próximo deploy)
    const tecfagResetMigrationName = "reset_tecfag_crm_chat_data_v1";
    const [appliedTecfagReset] = await sql`
      SELECT name FROM app_deploy_migrations WHERE name = ${tecfagResetMigrationName}
    `;
    if (!appliedTecfagReset) {
      console.log(`[platform migration] Iniciando execução de ${tecfagResetMigrationName}...`);
      try {
        const { runTenantReset } = await import("./reset-tenant-data.mjs");
        await runTenantReset(sql, "tecfag", { isDryRun: false });
        await sql`INSERT INTO app_deploy_migrations (name) VALUES (${tecfagResetMigrationName}) ON CONFLICT (name) DO NOTHING`;
        console.log(`[platform migration] ${tecfagResetMigrationName} concluída e registrada com sucesso.`);
      } catch (resetErr) {
        console.error(`[platform migration] Aviso: Falha no reset do tenant Tecfag (${tecfagResetMigrationName}):`, resetErr);
      }
    } else {
      console.log(`[platform migration] ${tecfagResetMigrationName} já aplicada anteriormente.`);
    }
  } catch (error) {
    console.error("[platform migration] Falha crítica ao aplicar migrações estruturais DDL:", error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
