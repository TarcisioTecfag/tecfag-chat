import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const migrationName = "0014_crm_migration_and_sync_policy";
const migrationUrl = new URL("../src/db/migrations/0014_crm_migration_and_sync_policy.sql", import.meta.url);
const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  console.error("[crm migration] DATABASE_URL ou TEST_DATABASE_URL não configurada.");
  process.exitCode = 1;
} else {
  const migrationSql = await readFile(fileURLToPath(migrationUrl), "utf8");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(1650547787, 14)`;
      await tx`
        CREATE TABLE IF NOT EXISTS app_deploy_migrations (
          name text PRIMARY KEY,
          applied_at timestamp DEFAULT now() NOT NULL
        )
      `;

      const applied = await tx`
        SELECT name FROM app_deploy_migrations WHERE name = ${migrationName}
      `;
      if (applied.length > 0) {
        console.log(`[crm migration] ${migrationName} já aplicada.`);
        return;
      }

      await tx.unsafe(migrationSql);
      await tx`INSERT INTO app_deploy_migrations (name) VALUES (${migrationName})`;
      console.log(`[crm migration] ${migrationName} aplicada com sucesso.`);
    });
  } catch (error) {
    console.error(`[crm migration] Falha ao aplicar ${migrationName}:`, error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
