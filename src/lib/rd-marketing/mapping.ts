import { z } from "zod";
import { conversionAttribution } from "./attribution";

export class MappingError extends Error {
  readonly statusCode = 400;
  readonly code = "INVALID_MAPPING_PAYLOAD";
}

export const standardTargets = {
  "contact.name": "Contato · Nome",
  "contact.email": "Contato · E-mail",
  "contact.phone": "Contato · Telefone",
  "company.name": "Empresa · Nome",
  "company.document": "Empresa · CNPJ / CPF",
  "company.email": "Empresa · E-mail",
  "company.phone": "Empresa · Telefone",
  "deal.title": "Negociação · Título",
  "deal.value": "Negociação · Valor",
  "deal.source": "Negociação · Fonte",
  "deal.campaign": "Negociação · Campanha",
  "deal.initialNote": "Negociação · Nota inicial",
} as const;

const safePath = z
  .string()
  .max(200)
  .refine(
    (value) =>
      !value ||
      value
        .split(".")
        .every(
          (part) =>
            part.length > 0 &&
            Array.from(part).every((character) => character.charCodeAt(0) >= 32) &&
            !["__proto__", "prototype", "constructor"].includes(part),
        ),
    "Caminho de campo inválido.",
  );
export const flowSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(false),
    pipelineId: z.string().min(1).max(200),
    stageId: z.string().min(1).max(200),
    operatorId: z.string().max(200).nullable().default(null),
    deduplication: z.enum(["lead", "event"]).default("event"),
    eventIdPath: safePath.default("rd_conversion.id"),
    attributionConversion: z.enum(["first", "last"]).optional(),
    campaignFromFlow: z.boolean().optional(),
    requireAttribution: z.boolean().optional(),
    mappings: z
      .array(
        z.object({
          source: safePath,
          sourceAlternatives: z
            .array(safePath.refine((path) => !!path))
            .max(10)
            .optional(),
          target: z.string().min(1).max(250),
          fallback: z
            .union([z.string().max(5000), z.number(), z.array(z.string().max(200))])
            .optional(),
          valueMap: z.record(z.string().max(200)).optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((settings, ctx) => {
    if (settings.deduplication === "event" && !settings.eventIdPath)
      ctx.addIssue({ code: "custom", message: "Informe o campo que identifica cada evento." });
    const targets = new Set<string>();
    for (const mapping of settings.mappings) {
      if (
        !Object.hasOwn(standardTargets, mapping.target) &&
        !/^(contact|company|deal)\.customFields\.[\w-]+$/.test(mapping.target)
      ) {
        ctx.addIssue({ code: "custom", message: "Campo de destino inválido." });
      }
      if (targets.has(mapping.target))
        ctx.addIssue({
          code: "custom",
          message: "Cada campo de destino só pode ser mapeado uma vez.",
        });
      targets.add(mapping.target);
    }
  });
export type FlowSettings = z.infer<typeof flowSettingsSchema>;
export type Mapping = FlowSettings["mappings"][number];
export const defaultMappings: Mapping[] = [
  { source: "name", target: "contact.name" },
  { source: "email", target: "contact.email" },
  {
    source: "mobile_phone",
    sourceAlternatives: ["personal_phone", "phone"],
    target: "contact.phone",
  },
  { source: "name", target: "deal.title" },
  { source: "rd_attribution.source", target: "deal.source", fallback: "Não informada" },
  { source: "rd_attribution.campaign", target: "deal.campaign" },
];

export function attributionForLead(lead: Record<string, unknown>, settings: FlowSettings) {
  const conversion =
    settings.attributionConversion === "last" ? "last_conversion" : "first_conversion";
  const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const selectedConversion = readPath(lead, conversion);
  const attribution = conversionAttribution(selectedConversion);
  // Fonte e campanha pertencem à mesma conversão: nunca completar a última com a primeira.
  const source =
    attribution.source ||
    (conversion === "first_conversion" && !selectedConversion
      ? asText(readPath(lead, "funnel.origin"))
      : "");
  const campaign = settings.campaignFromFlow ? settings.name : attribution.campaign || "";
  return { source, campaign };
}

export function conversionForLead(lead: Record<string, unknown>) {
  const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const occurredAt =
    asText(readPath(lead, "rd_event.event_timestamp")) ||
    asText(readPath(lead, "last_conversion.created_at"));
  const identifier =
    asText(readPath(lead, "rd_event.event_identifier")) ||
    asText(readPath(lead, "last_conversion.content.identificador"));
  const time = occurredAt ? new Date(occurredAt).getTime() : NaN;
  // A data de entrega muda a cada tentativa e não identifica uma nova conversão.
  return {
    id: Number.isFinite(time) ? JSON.stringify([new Date(time).toISOString(), identifier]) : "",
    occurredAt,
    identifier,
  };
}

export function buildMarketingNote(deal: Record<string, unknown>, settings: FlowSettings): string {
  const source = String(deal.source || "Não informada");
  const campaign = String(deal.campaign || "Não informada");
  const lines = [
    "Negociação criada automaticamente pelo RD Station Marketing.",
    `Fluxo de integração: ${settings.name}`,
    `Fonte: ${source}`,
    `Campanha: ${campaign}`,
  ];
  if (deal.initialNote) lines.push("", "Informações adicionais:", String(deal.initialNote));
  return lines.join("\n");
}

export function readPath(object: unknown, path: string): unknown {
  if (!path) return undefined;
  let value = object;
  for (const part of path.split(".")) {
    if (
      ["__proto__", "prototype", "constructor"].includes(part) ||
      !value ||
      typeof value !== "object" ||
      !Object.hasOwn(value, part)
    )
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function readMappingValue(lead: Record<string, unknown>, mapping: Mapping) {
  for (const source of [mapping.source, ...mappingSourceAlternatives(mapping)]) {
    const value = readPath(lead, source);
    if (value !== undefined && value !== null && !(typeof value === "string" && !value.trim()))
      return { value, source, usedFallback: false };
  }
  return { value: mapping.fallback, source: null, usedFallback: mapping.fallback !== undefined };
}

export function mappingSourceAlternatives(mapping: Mapping): string[] {
  // Fluxos antigos que usavam o padrão recebem a mesma melhoria; [] desativa explicitamente.
  return (
    mapping.sourceAlternatives ??
    (mapping.target === "contact.phone" && mapping.source === "mobile_phone"
      ? ["personal_phone", "phone"]
      : [])
  );
}

export function hasMarketingAttribution(value: unknown): boolean {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (
    !!text &&
    !text.startsWith("encoded_") &&
    ![
      "unknown",
      "undefined",
      "null",
      "não informada",
      "não informado",
      "desconhecido",
      "desconhecida",
      "rd station marketing",
    ].includes(text)
  );
}

export function extractLeads(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new MappingError("Envie um objeto JSON do RD Marketing.");
  const root = payload as Record<string, unknown>;
  const leads = Object.hasOwn(root, "leads")
    ? root.leads
    : Object.hasOwn(root, "contact")
      ? [root.contact]
      : Object.hasOwn(root, "document")
        ? [root.document]
        : [root];
  if (
    !Array.isArray(leads) ||
    !leads.length ||
    leads.length > 100 ||
    leads.some((lead) => !lead || typeof lead !== "object" || Array.isArray(lead))
  ) {
    throw new MappingError("O lote deve conter de 1 a 100 leads válidos.");
  }
  if (Object.hasOwn(root, "contact") && !Object.hasOwn(root, "leads")) {
    return [
      {
        ...(leads[0] as Record<string, unknown>),
        rd_event: {
          event_type: root.event_type,
          event_identifier: root.event_identifier,
          event_timestamp: root.event_timestamp,
          timestamp: root.timestamp,
        },
      },
    ];
  }
  return leads as Record<string, unknown>[];
}

export function availablePaths(object: unknown, prefix = "", depth = 0): string[] {
  if (!object || typeof object !== "object" || Array.isArray(object) || depth > 8) return [];
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" && !Array.isArray(value)
      ? availablePaths(value, path, depth + 1)
      : [path];
  });
}

export function mapLead(lead: Record<string, unknown>, settings: FlowSettings) {
  const sourceLead = {
    ...lead,
    rd_attribution: attributionForLead(lead, settings),
    rd_conversion: conversionForLead(lead),
  };
  const result: Record<"contact" | "company" | "deal", Record<string, unknown>> = {
    contact: { customFields: {} },
    company: { customFields: {} },
    deal: { customFields: {} },
  };
  for (const mapping of settings.mappings) {
    let value: unknown = readMappingValue(sourceLead, mapping).value;
    if (value === undefined || value === null || value === "") continue;
    if (mapping.valueMap) {
      const translate = (entry: unknown) =>
        Object.hasOwn(mapping.valueMap!, String(entry)) ? mapping.valueMap![String(entry)] : entry;
      value = Array.isArray(value) ? value.map(translate) : translate(value);
    }
    const [entity, field, customId] = mapping.target.split(".");
    if (!Object.hasOwn(result, entity)) throw new MappingError("Campo de destino inválido.");
    const target = result[entity as keyof typeof result];
    if (field === "customFields") {
      if (!customId || ["__proto__", "prototype", "constructor"].includes(customId))
        throw new MappingError("Campo personalizado inválido.");
      (target.customFields as Record<string, unknown>)[customId] = value;
    } else {
      if (
        !Object.hasOwn(standardTargets, mapping.target) ||
        (typeof value !== "string" && typeof value !== "number")
      )
        throw new MappingError(`O campo ${mapping.target} deve receber texto ou número.`);
      target[field] = String(value).trim();
    }
  }
  if (!result.contact.name || !result.deal.title)
    throw new MappingError("Mapeie o nome do contato e o título da negociação.");
  const email = String(result.contact.email || "")
    .trim()
    .toLowerCase();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    throw new MappingError("E-mail do contato inválido.");
  result.contact.email = email;
  if (String(result.contact.name).length > 200 || String(result.deal.title).length > 300)
    throw new MappingError("Nome ou título excede o limite permitido.");
  if (Object.keys(result.company).length > 1 && !result.company.name)
    throw new MappingError("Mapeie o nome da empresa para importar seus dados.");
  if (
    settings.requireAttribution &&
    (!hasMarketingAttribution(result.deal.source) || !hasMarketingAttribution(result.deal.campaign))
  ) {
    throw new MappingError(
      "Fonte e Campanha são obrigatórias neste fluxo. Revise os campos enviados pelo RD e os mapeamentos de marketing.",
    );
  }
  result.deal.initialNote = buildMarketingNote(result.deal, settings);
  return result;
}

// UUID identifica o lead, não o evento. O modo por evento exige um identificador separado.
export function leadIdentity(lead: Record<string, unknown>): string {
  const uuid = typeof lead.uuid === "string" ? lead.uuid.trim() : "";
  const email = typeof lead.email === "string" ? lead.email.trim().toLowerCase() : "";
  if (!uuid && !email)
    throw new MappingError(
      "O lead precisa de uuid ou e-mail para identificação e proteção contra duplicação.",
    );
  return uuid ? `uuid:${uuid}` : `email:${email}`;
}
export function deliveryIdentity(lead: Record<string, unknown>, settings: FlowSettings): string {
  const identity = leadIdentity(lead);
  if (settings.deduplication === "lead") return identity;
  const event =
    settings.eventIdPath === "rd_conversion.id"
      ? conversionForLead(lead).id
      : readPath(lead, settings.eventIdPath);
  if ((typeof event !== "string" && typeof event !== "number") || !String(event).trim())
    throw new MappingError("O lead não contém o identificador do evento configurado.");
  return JSON.stringify([identity, String(event)]);
}
