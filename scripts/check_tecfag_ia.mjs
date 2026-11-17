import postgres from "postgres";

const sql = postgres("postgres://postgres:123@localhost:5432/tecfag_ia");

async function main() {
  try {
    const tables = await sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
    `;
    console.log("Tables in tecfag_ia:", tables.map(t => t.table_name));

    if (tables.some(t => t.table_name === 'settings')) {
      const rows = await sql`SELECT id, key, value FROM settings WHERE key LIKE '%rd%' OR key LIKE '%token%' OR key LIKE '%crm%';`;
      console.log("Settings rows count:", rows.length);
      for (const r of rows) {
        console.log(`Key: ${r.key} | Value: ${r.value ? r.value.slice(0, 20) + '...' : 'NULL'} (len: ${r.value?.length})`);
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await sql.end();
  }
}

main();
