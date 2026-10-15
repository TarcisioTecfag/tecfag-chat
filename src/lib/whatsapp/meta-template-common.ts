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

export function formatTemplateFirstName(
  rawName: string | null | undefined,
  fallback = "",
): string {
  const cleaned = String(rawName ?? "")
    .replace(/^@+/, "")
    .trim();
  const source = cleaned || String(fallback ?? "").replace(/^@+/, "").trim();
  if (!source) return "";
  const firstToken = source.split(/\s+/)[0]?.replace(/^@+/, "") || "";
  if (!firstToken) return "";
  return (
    firstToken.charAt(0).toLocaleUpperCase("pt-BR") +
    firstToken.slice(1).toLocaleLowerCase("pt-BR")
  );
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
    const raw =
      binding === "customer_name"
        ? formatTemplateFirstName(names.customerName)
        : binding === "operator_name"
          ? formatTemplateFirstName(names.operatorName)
          : manual[offset]?.text;
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) throw new Error(`Valor ausente para {{${index}}}.`);
    return value;
  });
}

export function stripTemplateAccents(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizeTemplateCustomGroups(value: unknown): string[] {
  let raw: unknown[] = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      raw = [];
    }
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const trimmed = String(item ?? "").trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const key = stripTemplateAccents(trimmed);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

export function collectTemplateCustomGroups(
  templates: Array<{ customGroups?: unknown }>,
  configuredGroups?: string[],
): string[] {
  const map = new Map<string, string>();
  for (const g of normalizeTemplateCustomGroups(configuredGroups || [])) {
    map.set(stripTemplateAccents(g), g);
  }
  for (const tpl of templates) {
    for (const g of normalizeTemplateCustomGroups(tpl.customGroups)) {
      const key = stripTemplateAccents(g);
      if (!map.has(key)) {
        map.set(key, g);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function matchesMetaTemplateFilter(
  template: {
    name: string;
    bodyText: string;
    category?: string;
    customGroups?: unknown;
  },
  options: {
    search?: string;
    selectedFilter?: string;
  },
): boolean {
  const groups = normalizeTemplateCustomGroups(template.customGroups);
  const filter = (options.selectedFilter || "ALL").trim();

  if (filter && filter !== "ALL") {
    if (filter === "UNGROUPED") {
      if (groups.length > 0) return false;
    } else if (filter.startsWith("GRP:")) {
      const targetGroup = stripTemplateAccents(filter.slice(4));
      if (!groups.some((g) => stripTemplateAccents(g) === targetGroup)) return false;
    } else {
      const targetCat = filter.startsWith("CAT:") ? filter.slice(4).toUpperCase() : filter.toUpperCase();
      if ((template.category || "").toUpperCase() !== targetCat) return false;
    }
  }

  const q = stripTemplateAccents(options.search || "");
  if (!q) return true;

  const matchesName = stripTemplateAccents(template.name).includes(q);
  const matchesBody = stripTemplateAccents(template.bodyText).includes(q);
  const matchesGroup = groups.some((g) => stripTemplateAccents(g).includes(q));

  return matchesName || matchesBody || matchesGroup;
}

