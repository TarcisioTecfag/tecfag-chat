import {
  availablePaths,
  attributionForLead,
  conversionForLead,
  extractLeads,
  hasMarketingAttribution,
  readMappingValue,
  type FlowSettings,
} from "./mapping";

export type RdDiagnostic = {
  version: 1;
  leadCount: number;
  sampledLeads: {
    index: number;
    fields: {
      target: string;
      source: string | null;
      status: "present" | "empty" | "not_mapped" | "unknown";
      usedFallback: boolean;
    }[];
    warnings: string[];
    paths: string[];
  }[];
  maskedPayload: unknown;
};

// Todos os textos e números são ocultados, inclusive campos personalizados e segredos.
// Vazio/null e a estrutura são preservados para diagnosticar mapeamentos.
export function maskRdPayload(payload: unknown): unknown {
  let budget = 300;
  const visit = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined) return value ?? null;
    if (typeof value === "string") return value.trim() ? "[texto oculto]" : "";
    if (typeof value === "number") return "[número oculto]";
    if (typeof value === "boolean") return value;
    if (depth >= 8 || budget-- <= 0) return "[amostra limitada]";
    if (Array.isArray(value)) return value.slice(0, 5).map((item) => visit(item, depth + 1));
    if (typeof value !== "object") return "[valor oculto]";
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 60)
        .map(([key, item]) => [
          /@|^\d{8,}$/.test(key) ? "[chave oculta]" : key.slice(0, 200),
          visit(item, depth + 1),
        ]),
    );
  };
  const masked = visit(payload, 0);
  return JSON.stringify(masked).length <= 32_000 ? masked : "[amostra limitada por tamanho]";
}

export function buildRdDiagnostic(payload: unknown, settings: FlowSettings): RdDiagnostic {
  let leads: Record<string, unknown>[] = [];
  try {
    leads = extractLeads(payload);
  } catch {
    /* A estrutura mascarada ainda ajuda a revisão. */
  }
  return {
    version: 1,
    leadCount: leads.length,
    sampledLeads: leads.slice(0, 5).map((lead, index) => {
      const enriched = {
        ...lead,
        rd_attribution: attributionForLead(lead, settings),
        rd_conversion: conversionForLead(lead),
      };
      const targets = [
        "contact.email",
        "contact.phone",
        "company.name",
        "company.document",
        "deal.source",
        "deal.campaign",
      ];
      const fields: RdDiagnostic["sampledLeads"][number]["fields"] = [];
      const warnings: string[] = [];
      for (const target of targets) {
        const mapping = settings.mappings.find((item) => item.target === target);
        if (!mapping) {
          fields.push({ target, source: null, status: "not_mapped", usedFallback: false });
          continue;
        }
        const selected = readMappingValue(enriched, mapping);
        const translated =
          mapping.valueMap && Object.hasOwn(mapping.valueMap, String(selected.value))
            ? mapping.valueMap[String(selected.value)]
            : selected.value;
        const present =
          translated !== undefined && translated !== null && !!String(translated).trim();
        fields.push({
          target,
          source: selected.source,
          status: !present
            ? "empty"
            : target.startsWith("deal.") && !hasMarketingAttribution(translated)
              ? "unknown"
              : "present",
          usedFallback: selected.usedFallback,
        });
        if (target.startsWith("deal.") && !hasMarketingAttribution(translated))
          warnings.push(
            target === "deal.source"
              ? "Fonte ausente ou desconhecida."
              : "Campanha ausente ou desconhecida.",
          );
      }
      const present = (target: string) =>
        fields.some((field) => field.target === target && field.status === "present");
      if (!present("contact.email"))
        warnings.push("E-mail não recebido no campo mapeado, ou não mapeado.");
      if (!present("contact.phone"))
        warnings.push("Telefone não recebido no campo mapeado, ou não mapeado.");
      if (!present("company.name"))
        warnings.push(
          "Sem nome de empresa mapeado: só poderá usar uma empresa já vinculada ao contato.",
        );
      else if (!present("company.document"))
        warnings.push(
          "Nome de empresa sem CPF/CNPJ mapeado: o nome sozinho não evita empresas duplicadas.",
        );
      for (const target of ["deal.source", "deal.campaign"])
        if (!settings.mappings.some((mapping) => mapping.target === target))
          warnings.push(target === "deal.source" ? "Fonte não mapeada." : "Campanha não mapeada.");
      return {
        index,
        fields,
        warnings,
        paths: availablePaths(lead)
          .slice(0, 50)
          .map((path) => path.slice(0, 120)),
      };
    }),
    maskedPayload: maskRdPayload(payload),
  };
}
