import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const tenants = await sql`SELECT id, name FROM tenants`;
  console.log("Tenants in DB:", tenants);
  const reports = await sql`SELECT id, tenant_id, type, stage FROM ai_reports`;
  console.log("Reports in DB count:", reports.length);
  console.log("Reports:", reports);
  await sql.end();
}

main().catch(console.error);
