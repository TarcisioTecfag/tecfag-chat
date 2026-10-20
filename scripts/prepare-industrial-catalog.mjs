/** Offline: prepara rascunho e relatório de um JSON local; não importa banco/provedor nem lê .env. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  convertLegacyMachineCatalog,
  emptyIndustrialSettings,
  industrialSettingsSchema,
  findCatalogConflicts,
} from "../src/lib/triage/industrial-settings.ts";
const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--"))
    throw new Error(`Informe ${name}`);
  return args[index + 1];
};
const input = path.resolve(value("--input"));
const output = path.resolve(value("--out"));
const data = fs.readFileSync(input);
const raw = JSON.parse(data.toString("utf8"));
const catalog = convertLegacyMachineCatalog(Array.isArray(raw) ? raw : raw.catalog || raw.machines);
const settings = { ...emptyIndustrialSettings(), catalog };
const checked = industrialSettingsSchema.safeParse(settings);
const duplicateCodes = findCatalogConflicts(catalog);
const draft = {
  format: "industrial-catalog-draft-v1",
  provenance: {
    input,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
    preparedAt: new Date().toISOString(),
    note: "Snapshot de arquivo local. Não comprova o catálogo atual do banco do legado. Importação administrativa explícita após revisão.",
  },
  catalog,
  review: {
    readyToSave: checked.success,
    total: catalog.length,
    semiIndustrial: catalog.filter((machine) => machine.line === "SEMI-INDUSTRIAL").length,
    personnalite: catalog.filter((machine) => machine.line === "PERSONNALITE").length,
    duplicateCodes,
    issues: checked.success ? [] : checked.error.issues,
    destinationsConfigured: false,
    importedIntoDatabase: false,
  },
};
fs.writeFileSync(output, JSON.stringify(draft, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, ...draft.review }));
