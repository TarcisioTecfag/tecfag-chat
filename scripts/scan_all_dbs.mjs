import postgres from "postgres";

const dbs = ['valemchat', 'tecfag_ia', 'marketing_hub', 'valem_analytics', 'tecfag_analytics'];

async function checkDb(dbName) {
  const sql = postgres(`postgres://postgres:123@localhost:5432/${dbName}`);
  try {
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log(`\n=== Database: ${dbName} (${tables.length} tables) ===`);
    const tNames = tables.map(t => t.table_name);
    
    // Look for config / settings / rd tables
    const relevant = tNames.filter(t => t.includes('rd') || t.includes('setting') || t.includes('config') || t.includes('token') || t.includes('auth'));
    console.log('Relevant tables:', relevant);

    for (const t of relevant) {
      try {
        const rows = await sql.unsafe(`SELECT * FROM "${t}" LIMIT 5`);
        console.log(`  Table ${t} has ${rows.length} rows`);
        if (rows.length > 0) {
          const sample = rows[0];
          const keys = Object.keys(sample);
          console.log(`    Columns:`, keys);
          // Check for token columns
          for (const k of keys) {
            if (k.toLowerCase().includes('token') || k.toLowerCase().includes('secret') || k.toLowerCase().includes('key') || k.toLowerCase().includes('access')) {
              const val = String(sample[k]);
              console.log(`    -> ${k}: ${val.slice(0, 15)}... (len: ${val.length})`);
            }
          }
        }
      } catch (err) {
        console.log(`  Table ${t} error:`, err.message);
      }
    }
  } catch (err) {
    console.log(`Failed connecting to ${dbName}:`, err.message);
  } finally {
    await sql.end();
  }
}

async function main() {
  for (const d of dbs) {
    await checkDb(d);
  }
}

main();
