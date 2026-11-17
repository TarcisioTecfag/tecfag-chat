import postgres from "postgres";

const sql = postgres("postgres://postgres:123@localhost:5432/postgres");

async function main() {
  try {
    const dbs = await sql`SELECT datname FROM pg_database WHERE datistemplate = false;`;
    console.log("Databases found:", dbs.map(d => d.datname));
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await sql.end();
  }
}

main();
