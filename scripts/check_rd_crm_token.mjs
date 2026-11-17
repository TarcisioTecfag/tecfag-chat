import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

// Carrega .env
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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL não encontrada no .env!");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });

async function main() {
  try {
    const rows = await sql`
      SELECT tenant_id, rd_crm_client_id, rd_crm_client_secret, rd_crm_access_token, rd_crm_refresh_token, rd_crm_token_expires_at
      FROM channel_configs
    `;
    console.log(`Encontradas ${rows.length} configurações em channel_configs:`);
    for (const r of rows) {
      console.log(`- Tenant: ${r.tenant_id} | ClientID: ${r.rd_crm_client_id ? 'SIM' : 'NÃO'} | AccessToken: ${r.rd_crm_access_token ? r.rd_crm_access_token.slice(0, 15) + '...' : 'NÃO'} | ExpiresAt: ${r.rd_crm_token_expires_at}`);
    }

    // Também verificar se existe tabela settings ou similar em Tecfag IA Faggner se houver
    const tables = await sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('settings', 'rd_tokens', 'system_settings')
    `;
    console.log("Outras tabelas de settings:", tables.map(t => t.table_name));

  } catch (err) {
    console.error("Erro:", err);
  } finally {
    await sql.end();
  }
}

main();
