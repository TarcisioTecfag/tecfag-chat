import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const migrationName = "0011_platform_access";
const migrationUrl = new URL("../src/db/migrations/0011_platform_access.sql", import.meta.url);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[platform migration] DATABASE_URL não configurada.");
  process.exitCode = 1;
} else {
  const migrationSql = await readFile(fileURLToPath(migrationUrl), "utf8");
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

      const applied = await tx`
        SELECT name FROM app_deploy_migrations WHERE name = ${migrationName}
      `;
      if (applied.length > 0) {
        console.log(`[platform migration] ${migrationName} já aplicada.`);
        return;
      }

      await tx.unsafe(migrationSql);
      await tx`INSERT INTO app_deploy_migrations (name) VALUES (${migrationName})`;
      console.log(`[platform migration] ${migrationName} aplicada com sucesso.`);
    });
  } catch (error) {
    console.error(`[platform migration] Falha ao aplicar ${migrationName}:`, error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
