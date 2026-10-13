import { spawn } from "node:child_process";
import { open, mkdir, stat } from "node:fs/promises";
import path from "node:path";

// Execução explícita, sem carregar .env operacional e sem imprimir credenciais.
const outputArg = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
const testMode = process.argv.includes("--test");
const connection = testMode ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!outputArg || !connection) {
  console.error("Informe --output=<arquivo.dump> e DATABASE_URL, ou --test com TEST_DATABASE_URL.");
  process.exitCode = 1;
} else {
  try {
    const database = new URL(connection);
    if (
      testMode &&
      (!["127.0.0.1", "localhost"].includes(database.hostname) || !/test/i.test(database.pathname))
    )
      throw new Error("Backup de teste exige banco local isolado com 'test' no nome.");
    const output = path.resolve(outputArg);
    await mkdir(path.dirname(output), { recursive: true });
    // Recusa sobrescrita de um backup existente.
    const reserved = await open(output, "wx", 0o600);
    await reserved.close();
    const executable = process.env.PG_BIN
      ? path.join(process.env.PG_BIN, process.platform === "win32" ? "pg_dump.exe" : "pg_dump")
      : "pg_dump";
    const child = spawn(
      executable,
      ["--format=custom", "--no-owner", "--no-password", "--file", output],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          PGHOST: database.hostname,
          PGPORT: database.port || "5432",
          PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
          PGUSER: decodeURIComponent(database.username),
          PGPASSWORD: decodeURIComponent(database.password),
          PGSSLMODE: database.searchParams.get("sslmode") || "prefer",
        },
      },
    );
    child.stderr.resume();
    const exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    if (exitCode !== 0)
      throw new Error("pg_dump falhou; arquivo não deve ser considerado um backup válido.");
    const result = await stat(output);
    if (!result.size) throw new Error("Backup vazio.");
    console.log(
      `Backup concluído: ${output} (${result.size} bytes). Valide a restauração em outro banco.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
