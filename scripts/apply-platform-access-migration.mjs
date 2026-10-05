import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

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
];
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[platform migration] DATABASE_URL não configurada.");
  process.exitCode = 1;
} else {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
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

      // Migração de dados de negócio da Tecfag (Planilha de Negociações do Funil Máquinas)
      const tecfagMigrationName = "import_tecfag_deals_spreadsheet_v1";
      const appliedTecfag = await tx`
        SELECT name FROM app_deploy_migrations WHERE name = ${tecfagMigrationName}
      `;
      if (appliedTecfag.length === 0) {
        console.log(`[platform migration] Iniciando execução de ${tecfagMigrationName}...`);
        const { runTecfagSpreadsheetImport } = await import("./import-tecfag-spreadsheet.mjs");
        await runTecfagSpreadsheetImport(tx);
        await tx`INSERT INTO app_deploy_migrations (name) VALUES (${tecfagMigrationName})`;
        console.log(`[platform migration] ${tecfagMigrationName} concluída e registrada com sucesso.`);
      } else {
        console.log(`[platform migration] ${tecfagMigrationName} já aplicada anteriormente.`);
      }

      // Migração de campos personalizados, catálogos e enriquecimento de cards/empresas
      const tecfagCfMigrationName = "import_tecfag_custom_fields_v2";
      const appliedTecfagCf = await tx`
        SELECT name FROM app_deploy_migrations WHERE name = ${tecfagCfMigrationName}
      `;
      if (appliedTecfagCf.length === 0) {
        console.log(`[platform migration] Iniciando execução de ${tecfagCfMigrationName}...`);
        const { runCustomFieldsMigration } = await import("./migrate-tecfag-custom-fields.mjs");
        await runCustomFieldsMigration(tx);
        await tx`INSERT INTO app_deploy_migrations (name) VALUES (${tecfagCfMigrationName})`;
        console.log(`[platform migration] ${tecfagCfMigrationName} concluída e registrada com sucesso.`);
      } else {
        console.log(`[platform migration] ${tecfagCfMigrationName} já aplicada anteriormente.`);
      }
    });
  } catch (error) {
    console.error("[platform migration] Falha ao aplicar migrações de acesso:", error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
