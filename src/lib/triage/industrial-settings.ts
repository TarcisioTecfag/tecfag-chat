import { z } from "zod";
import {
  INDUSTRIAL_ROUTES,
  type IndustrialRoute,
  type IndustrialSubflow,
} from "./industrial-policy.ts";

export const INDUSTRIAL_SETTINGS_AGENT = "industrial_triage";
export const DESTINATION_KEYS = [...Object.keys(INDUSTRIAL_ROUTES), "REVIEW"] as (
  IndustrialSubflow | "REVIEW"
)[];
const identifier = z.string().trim().min(1).max(160);
export const machineSchema = z
  .object({
    id: identifier,
    name: z.string().trim().min(3).max(300),
    sku: z.string().trim().max(100).default(""),
    code: z.string().trim().max(100).default(""),
    line: z.enum(["SEMI-INDUSTRIAL", "PERSONNALITE"]),
    production: z.string().max(500).default(""),
    description: z.string().max(2000).default(""),
    aliases: z.array(z.string().trim().min(3).max(200)).max(30).default([]),
    active: z.boolean().default(true),
  })
  .strict();
export const destinationSchema = z
  .object({
    sectorId: identifier,
    pipelineId: identifier.optional(),
    stageId: identifier.optional(),
  })
  .strict();
export const industrialSettingsSchema = z
  .object({
    version: z.literal(1),
    catalog: z.array(machineSchema).max(3000),
    blockedFamilies: z
      .array(
        z
          .object({
            id: identifier,
            name: z.string().trim().min(3).max(200),
            terms: z.array(z.string().trim().min(3).max(100)).min(1).max(30),
            reason: z.string().max(500),
          })
          .strict(),
      )
      .max(200),
    destinations: z.record(destinationSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value.destinations)) {
      if (!DESTINATION_KEYS.includes(key as IndustrialSubflow))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destinations", key],
          message: "Destino desconhecido",
        });
      const destination = value.destinations[key];
      const createsDeal =
        key !== "REVIEW" && INDUSTRIAL_ROUTES[key as IndustrialSubflow]?.createsDeal;
      if (createsDeal && (!destination.pipelineId || !destination.stageId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destinations", key],
          message: "Selecione funil e etapa",
        });
      if (Boolean(destination.pipelineId) !== Boolean(destination.stageId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destinations", key],
          message: "Funil e etapa devem ser informados juntos",
        });
    }
    for (const [field, entries] of [
      ["catalog", value.catalog],
      ["blockedFamilies", value.blockedFamilies],
    ] as const) {
      if (new Set(entries.map((item) => item.id)).size !== entries.length)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "IDs duplicados" });
    }
    // Código exato deve identificar uma única máquina, inclusive após normalização de caixa.
    for (const conflict of findCatalogConflicts(value.catalog))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["catalog"],
        message: `${conflict.field} ${conflict.code} ativo duplicado`,
      });
  });
export type IndustrialSettings = z.infer<typeof industrialSettingsSchema>;
export type IndustrialMachine = z.infer<typeof machineSchema>;
export function findCatalogConflicts(catalog: IndustrialMachine[]) {
  const conflicts: { field: "sku" | "code"; code: string; machineIds: string[] }[] = [];
  for (const field of ["sku", "code"] as const) {
    const values = new Map<string, string[]>();
    for (const machine of catalog.filter((item) => item.active && item[field])) {
      const code = machine[field].toUpperCase();
      values.set(code, [...(values.get(code) || []), machine.id]);
    }
    for (const [code, machineIds] of values)
      if (machineIds.length > 1) conflicts.push({ field, code, machineIds });
  }
  return conflicts;
}
export type IndustrialDestination = z.infer<typeof destinationSchema>;
export const emptyIndustrialSettings = (): IndustrialSettings => ({
  version: 1,
  catalog: [],
  blockedFamilies: [],
  destinations: {},
});
export function industrialDestinationKey(route: IndustrialRoute): string | null {
  if (!route.subflow) return null;
  if (route.needsReview || route.reason === "human_requested") return "REVIEW";
  return INDUSTRIAL_ROUTES[route.subflow].action === "inform" ? null : route.subflow;
}

/** Converte somente dados fornecidos explicitamente. Não lê arquivos/bancos nem ativa catálogo. */
export function convertLegacyMachineCatalog(input: unknown): IndustrialMachine[] {
  if (!Array.isArray(input)) throw new Error("O catálogo deve ser uma lista JSON");
  return input.map((entry, index) => {
    const row = entry as Record<string, unknown>;
    if (!row || typeof row !== "object") throw new Error(`Registro inválido: ${index + 1}`);
    const rawLine = String(row.line || row.linha || row.group || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    const line = ["SEMI", "SEMI-INDUSTRIAL", "SEMI INDUSTRIAL"].includes(rawLine)
      ? "SEMI-INDUSTRIAL"
      : ["PERSONNALITE", "PERSONALITE"].includes(rawLine)
        ? "PERSONNALITE"
        : rawLine;
    return machineSchema.parse({
      id: row.id || `catalog-${index + 1}`,
      name: row.name || row.nome || row.description,
      sku: row.sku || "",
      code: row.code || row.cod_next || "",
      line,
      production: row.production || row.produtividade || "",
      description: row.sobre || (row.nome || row.name ? row.description : "") || "",
      aliases: row.aliases || [],
      active: row.active ?? true,
    });
  });
}
