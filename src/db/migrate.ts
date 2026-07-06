/**
 * Script de migração automática.
 * Executado antes do servidor subir para garantir que todas as tabelas
 * existem no banco de dados de produção (Railway).
 *
 * Usa drizzle-orm/migrator que aplica apenas as migrations pendentes.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "migrations");

const connectionString =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

console.log("[migrate] Aplicando migrations pendentes...");

try {
  await migrate(db, { migrationsFolder });
  console.log("[migrate] ✓ Banco atualizado com sucesso.");
} catch (e) {
  console.error("[migrate] Erro ao aplicar migrations:", e);
  // Não lança o erro — o servidor continua mesmo se a migration falhar
  // (evita crash total em caso de conflito de schema já existente)
} finally {
  await client.end();
}
