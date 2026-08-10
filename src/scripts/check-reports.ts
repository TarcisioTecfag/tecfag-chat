import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const reports = await sql`SELECT id, tenant_id, type, period, stage, generated_at FROM ai_reports`;
  console.log("Reports in DB:", JSON.stringify(reports, null, 2));
  await sql.end();
}

main().catch(console.error);
