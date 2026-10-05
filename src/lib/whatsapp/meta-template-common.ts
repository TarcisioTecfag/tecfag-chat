export type TemplateBinding = "customer_name" | "operator_name" | "manual";
export type TemplateBindings = Record<string, TemplateBinding>;

export function bodyVariableIndexes(bodyText: string): number[] {
  const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return [...new Set(matches)].sort((a, b) => a - b);
}

export function isSupportedMetaTemplate(
  components: Array<{ type?: string; format?: string; text?: string; buttons?: unknown[] }>,
  bodyText: string
): boolean {
  const indexes = bodyVariableIndexes(bodyText);
  const allPlaceholders = [...bodyText.matchAll(/\{\{([^{}]+)\}\}/g)].length;
  if (!bodyText || allPlaceholders !== [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].length) return false;
  if (!indexes.every((index, offset) => index === offset + 1)) return false;

  return components.every((component) => {
    if (component.type === "BODY" || component.type === "FOOTER") return true;
    if (component.type === "HEADER") {
      return ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(component.format || "");
    }
    if (component.type === "BUTTONS") {
      return Array.isArray(component.buttons);
    }
    return false;
  });
}

export function resolveMetaTemplateValues(
  variableCount: number,
  bindings: TemplateBindings,
  supplied: unknown,
  names: { customerName?: string; operatorName?: string },
): string[] {
  const manual = Array.isArray(supplied) ? supplied : [];
  if (manual.length !== variableCount) throw new Error("Preencha todas as variáveis do template.");
  return Array.from({ length: variableCount }, (_, offset) => {
    const index = offset + 1;
    const binding = bindings[String(index)] || "manual";
    const raw = binding === "customer_name" ? names.customerName : binding === "operator_name" ? names.operatorName : manual[offset]?.text;
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) throw new Error(`Valor ausente para {{${index}}}.`);
    return value;
  });
}
