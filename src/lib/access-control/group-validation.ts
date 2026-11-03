import { DEFAULT_ADMIN_PERMISSIONS } from "../rbac";
import { canonicalJson, isPlainRecord, PERMISSION_KEY_ALIASES } from "./group-settings";

/** Validate new writes; existing unknown fields are preserved, never reset on read. */
export function validatePermissionPatch(patch: unknown, current?: unknown): string | null {
  if (!isPlainRecord(patch)) return "Permissões devem ser um objeto.";
  for (const [category, values] of Object.entries(patch)) {
    const known = Object.hasOwn(DEFAULT_ADMIN_PERMISSIONS, category)
      ? DEFAULT_ADMIN_PERMISSIONS[category as keyof typeof DEFAULT_ADMIN_PERMISSIONS] : undefined;
    const previous = isPlainRecord(current) ? current[category] : undefined;
    if (!known) {
      if (previous !== undefined && canonicalJson(previous) === canonicalJson(values)) continue;
      return `Categoria de permissão inválida: ${category}.`;
    }
    if (!isPlainRecord(values)) return `Categoria de permissão inválida: ${category}.`;
    const aliases = PERMISSION_KEY_ALIASES[category as keyof typeof PERMISSION_KEY_ALIASES] ?? {};
    for (const [key, value] of Object.entries(values)) {
      if (!Object.hasOwn(known, key) && !Object.hasOwn(aliases, key)) {
        if (isPlainRecord(previous) && Object.hasOwn(previous, key) && canonicalJson(previous[key]) === canonicalJson(value)) continue;
        return `Permissão desconhecida: ${category}.${key}.`;
      }
      if (category === "contacts" && key === "contactScope") {
        if (value !== "all" && value !== "wallet_only") return "Escopo de contatos inválido.";
      } else if (category === "crm" && key === "pipelineScope") {
        if (value !== "all" && value !== "selected") return "Escopo de funis inválido.";
      } else if (category === "crm" && (key === "allowedPipelineIds" || key === "transferTargetPipelineIds")) {
        if (
          value !== undefined &&
          (!Array.isArray(value) ||
            value.length > 200 ||
            value.some((item) => typeof item !== "string" || !item.trim() || item.length > 160))
        ) {
          return "Lista de funis permitidos inválida.";
        }
      } else if (category === "crm" && key === "allowedStageIdsByPipeline") {
        if (value !== undefined) {
          if (!isPlainRecord(value) || Object.keys(value).length > 200) {
            return "Mapa de etapas visíveis por funil inválido.";
          }
          for (const [pipeId, stageIds] of Object.entries(value)) {
            if (!pipeId.trim() || pipeId.length > 160) {
              return "Identificador de funil inválido no mapa de etapas.";
            }
            if (
              !Array.isArray(stageIds) ||
              stageIds.length > 300 ||
              stageIds.some((item) => typeof item !== "string" || !item.trim() || item.length > 160)
            ) {
              return "Lista de etapas visíveis inválida.";
            }
          }
        }
      } else if (typeof value !== "boolean") return `Permissão ${category}.${key} deve ser verdadeira ou falsa.`;
    }
  }
  return null;
}
