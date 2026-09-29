import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const migrations = [
  {
    name: "0011_platform_access",
    url: new URL("../src/db/migrations/0011_platform_access.sql", import.meta.url),
  },
  {
    name: "bootstrap_platform_manager_existing_operator",
    url: new URL("./migrations/bootstrap-platform-manager-existing-operator.sql", import.meta.url),
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
    });
  } catch (error) {
    console.error("[platform migration] Falha ao aplicar migrações de acesso:", error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
