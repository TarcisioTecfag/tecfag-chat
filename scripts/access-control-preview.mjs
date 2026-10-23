import fs from "node:fs/promises";
import path from "node:path";
import { previewAccessMigration } from "../src/lib/access-control/migration-preview.ts";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Uso: node --experimental-strip-types scripts/access-control-preview.mjs --snapshot=<backup.json> --output=<arquivo-novo-fora-do-repositorio.json>");
  console.log("Análise offline. Não conecta ao banco, não ativa política e não remapeia operadores.");
} else {
  try {
    const input = args.find((arg) => arg.startsWith("--snapshot="))?.slice(11);
    const output = args.find((arg) => arg.startsWith("--output="))?.slice(9);
    if (!input || !output) throw new Error("Informe --snapshot e --output explicitamente.");
    const absolute = path.resolve(output), repository = path.resolve(import.meta.dirname, "..");
    const relative = path.relative(repository, absolute);
    if (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) throw new Error("Use um destino privado fora do repositório.");
    const preview = previewAccessMigration(JSON.parse(await fs.readFile(input, "utf8")));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, JSON.stringify(preview, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ file: absolute, tenantId: preview.tenantId, groups: preview.groups.length,
      unmappedMemberships: preview.pendingMemberships.length, activationAllowed: preview.activationAllowed, blockers: preview.blockers }));
  } catch (error) {
    console.error(`Prévia não gerada: ${error?.code ?? error?.message ?? "erro desconhecido"}`);
    process.exitCode = 1;
  }
}
