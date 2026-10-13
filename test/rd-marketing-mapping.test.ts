import { describe, expect, test } from "bun:test";
import {
  defaultMappings,
  deliveryIdentity,
  extractLeads,
  flowSettingsSchema,
  mapLead,
  readPath,
  availablePaths,
  type FlowSettings,
} from "../src/lib/rd-marketing/mapping";

const settings: FlowSettings = {
  name: "Orçamento",
  enabled: false,
  pipelineId: "pipeline",
  stageId: "stage",
  operatorId: null,
  deduplication: "lead",
  eventIdPath: "",
  mappings: defaultMappings,
};
const lead = {
  uuid: "lead-1",
  name: "Pessoa",
  email: "Pessoa@example.com",
  mobile_phone: "11999990000",
  cf_product: "Seladora",
  custom_fields: { interesse: "Alto" },
};

describe("RD Marketing: entrada, campos e identidade", () => {
  test("normaliza o webhook novo com contact e preserva metadados para distinguir eventos", () => {
    const payload = {
      event_type: "WEBHOOK.CONVERTED",
      event_identifier: "orcamento",
      event_timestamp: "2026-10-13T10:00:00-03:00",
      timestamp: "2026-10-13T10:01:00-03:00",
      contact: { ...lead, company: { name: "Empresa" } },
    };
    const normalized = extractLeads(payload)[0];
    expect(mapLead(normalized, settings).contact.email).toBe("pessoa@example.com");
    expect(readPath(normalized, "company.name")).toBe("Empresa");
    expect(availablePaths(normalized)).toContain("rd_event.event_timestamp");
    const config: FlowSettings = {
      ...settings,
      deduplication: "event",
      eventIdPath: "rd_event.event_timestamp",
    };
    const resend = extractLeads({ ...payload, timestamp: "2026-10-13T11:00:00-03:00" })[0];
    expect(deliveryIdentity(normalized, config)).toBe(deliveryIdentity(resend, config));
    const next = extractLeads({ ...payload, event_timestamp: "2026-10-13T12:00:00-03:00" })[0];
    expect(deliveryIdentity(normalized, config)).not.toBe(deliveryIdentity(next, config));
    expect(() => extractLeads({ contact: null })).toThrow();
  });

  test("aceita lote legado, documento e contato direto", () => {
    expect(extractLeads({ leads: [lead, { ...lead, uuid: "lead-2" }] })).toHaveLength(2);
    expect(extractLeads({ document: lead })).toEqual([lead]);
    expect(extractLeads(lead)).toEqual([lead]);
    expect(() => extractLeads({ leads: [] })).toThrow();
    expect(() => extractLeads({ leads: [lead, null] })).toThrow();
    expect(() => extractLeads({ leads: Array(101).fill(lead) })).toThrow();
  });
  test("importa apenas os campos selecionados e usa valores padrão", () => {
    const mapped = mapLead(lead, settings);
    expect(mapped.contact.email).toBe("pessoa@example.com");
    expect(mapped.deal.source).toBe("Não informada");
    expect(mapped.deal.customFields).toEqual({});
    expect(mapped.contact.cf_product).toBeUndefined();
  });
  test("mapeia campos personalizados antigos e cf_, traduzindo opções", () => {
    const mapped = mapLead(lead, {
      ...settings,
      mappings: [
        ...defaultMappings,
        { source: "cf_product", target: "deal.customFields.product" },
        {
          source: "custom_fields.interesse",
          target: "contact.customFields.interesse",
          valueMap: { Alto: "option-high" },
        },
      ],
    });
    expect(mapped.deal.customFields).toEqual({ product: "Seladora" });
    expect(mapped.contact.customFields).toEqual({ interesse: "option-high" });
  });
  test("preserva Fonte e Campanha da mesma conversão, com atribuição configurável", () => {
    const attributed = {
      ...lead,
      first_conversion: { conversion_origin: { source: "Google", campaign: "Notebooks" } },
      last_conversion: { conversion_origin: { source: "E-mail", campaign: "Oferta outubro" } },
    };
    const first = mapLead(attributed, {
      ...settings,
      attributionConversion: "first",
      requireAttribution: true,
    });
    const last = mapLead(attributed, {
      ...settings,
      attributionConversion: "last",
      requireAttribution: true,
    });
    expect(first.deal.source).toBe("Google");
    expect(first.deal.campaign).toBe("Notebooks");
    expect(last.deal.source).toBe("E-mail");
    expect(last.deal.campaign).toBe("Oferta outubro");
  });
  test("não mistura a fonte da última conversão com a campanha da primeira", () => {
    const attributed = {
      ...lead,
      first_conversion: { conversion_origin: { source: "Google", campaign: "Notebooks" } },
      last_conversion: { conversion_origin: { source: "E-mail" } },
    };
    const mapped = mapLead(attributed, { ...settings, attributionConversion: "last" });
    expect(mapped.deal.source).toBe("E-mail");
    expect(mapped.deal.campaign).toBeUndefined();
    expect(() =>
      mapLead(attributed, { ...settings, attributionConversion: "last", requireAttribution: true }),
    ).toThrow("Fonte e Campanha");
  });
  test("webhook novo não inventa campanha a partir do identificador do formulário", () => {
    const normalized = extractLeads({
      event_identifier: "formulario-orcamento",
      contact: { ...lead, funnel: { origin: "Busca Paga | Google" } },
    })[0];
    const mapped = mapLead(normalized, settings);
    expect(mapped.deal.source).toBe("Busca Paga | Google");
    expect(mapped.deal.campaign).toBeUndefined();
    expect(() => mapLead(normalized, { ...settings, requireAttribution: true })).toThrow();
    const fromFlow = mapLead(normalized, {
      ...settings,
      campaignFromFlow: true,
      requireAttribution: true,
    });
    expect(fromFlow.deal.campaign).toBe(settings.name);
    expect(mapLead(normalized, { ...settings, attributionConversion: "last" }).deal.source).toBe(
      "Não informada",
    );
  });
  test("campos mapeados explicitamente podem trazer campanha coletada no RD", () => {
    const mapped = mapLead(
      { ...lead, cf_fonte: "Meta", cf_campanha: "Campanha A" },
      {
        ...settings,
        requireAttribution: true,
        mappings: defaultMappings.map((mapping) =>
          mapping.target === "deal.source"
            ? { ...mapping, source: "cf_fonte" }
            : mapping.target === "deal.campaign"
              ? { ...mapping, source: "cf_campanha" }
              : mapping,
        ),
      },
    );
    expect(mapped.deal.source).toBe("Meta");
    expect(mapped.deal.campaign).toBe("Campanha A");
  });
  test("todo card recebe anotação automática, preservando a nota mapeada", () => {
    const mapped = mapLead(
      { ...lead, message: "Solicita orçamento." },
      {
        ...settings,
        mappings: [...defaultMappings, { source: "message", target: "deal.initialNote" }],
      },
    );
    expect(mapped.deal.initialNote).toContain(
      "Negociação criada automaticamente pelo RD Station Marketing.",
    );
    expect(mapped.deal.initialNote).toContain(`Fluxo de integração: ${settings.name}`);
    expect(mapped.deal.initialNote).toContain("Campanha: Não informada");
    expect(mapped.deal.initialNote).toContain("Solicita orçamento.");
  });
  test("preserva zero e traduz arrays de múltipla escolha", () => {
    const mapped = mapLead(
      { ...lead, value: 0, choices: ["A", "B"] },
      {
        ...settings,
        mappings: [
          ...defaultMappings,
          { source: "value", target: "deal.value", fallback: 100 },
          {
            source: "choices",
            target: "deal.customFields.choices",
            valueMap: { A: "id-a", B: "id-b" },
          },
        ],
      },
    );
    expect(mapped.deal.value).toBe("0");
    expect(mapped.deal.customFields).toEqual({ choices: ["id-a", "id-b"] });
  });
  test("bloqueia acesso a propriedades herdadas e poluição de protótipo", () => {
    expect(readPath({}, "constructor.prototype")).toBeUndefined();
    expect(readPath(Object.create({ secret: "private" }), "secret")).toBeUndefined();
    expect(
      flowSettingsSchema.safeParse({
        ...settings,
        mappings: [{ source: "__proto__.polluted", target: "contact.name" }],
      }).success,
    ).toBe(false);
    expect(
      flowSettingsSchema.safeParse({
        ...settings,
        mappings: [{ source: "name", target: "toString" }],
      }).success,
    ).toBe(false);
  });
  test("rejeita duplicação de destinos e valores inválidos", () => {
    expect(
      flowSettingsSchema.safeParse({
        ...settings,
        mappings: [...defaultMappings, defaultMappings[0]],
      }).success,
    ).toBe(false);
    expect(() => mapLead({ ...lead, email: "invalid" }, settings)).toThrow("E-mail");
    expect(() => mapLead({ ...lead, name: { secret: "x" } }, settings)).toThrow();
    expect(() => mapLead({ ...lead, name: "" }, settings)).toThrow();
  });
  test("o mesmo lead mantém identidade mesmo se os dados mudarem", () => {
    expect(deliveryIdentity(lead, settings)).toBe(
      deliveryIdentity({ ...lead, name: "Outro nome", updated_at: "outro" }, settings),
    );
    expect(deliveryIdentity({ email: "USER@EXAMPLE.COM" }, settings)).toBe(
      deliveryIdentity({ email: "user@example.com" }, settings),
    );
    expect(() => deliveryIdentity({}, settings)).toThrow();
  });
  test("o padrão distingue conversões e reconhece reenvios sem usar data de entrega", () => {
    const defaults = flowSettingsSchema.parse({
      ...settings,
      deduplication: undefined,
      eventIdPath: undefined,
    });
    expect(defaults.deduplication).toBe("event");
    expect(defaults.eventIdPath).toBe("rd_conversion.id");
    const first = {
      ...lead,
      last_conversion: {
        created_at: "2026-10-13T10:00:00-03:00",
        content: { identificador: "orcamento" },
      },
    };
    const same = {
      ...first,
      last_conversion: { ...first.last_conversion, created_at: "2026-10-13T13:00:00Z" },
    };
    const next = {
      ...first,
      last_conversion: { ...first.last_conversion, created_at: "2026-10-13T11:00:00-03:00" },
    };
    expect(deliveryIdentity(first, defaults)).toBe(deliveryIdentity(same, defaults));
    expect(deliveryIdentity(first, defaults)).not.toBe(deliveryIdentity(next, defaults));
    const modern = extractLeads({
      event_timestamp: "2026-10-13T10:00:00-03:00",
      event_identifier: "orcamento",
      timestamp: "2026-10-13T11:00:00-03:00",
      contact: lead,
    })[0];
    const resend = extractLeads({
      event_timestamp: "2026-10-13T10:00:00-03:00",
      event_identifier: "orcamento",
      timestamp: "2026-10-13T12:00:00-03:00",
      contact: lead,
    })[0];
    expect(deliveryIdentity(modern, defaults)).toBe(deliveryIdentity(resend, defaults));
    expect(deliveryIdentity(first, defaults)).toBe(deliveryIdentity(modern, defaults));
    expect(() => deliveryIdentity(lead, defaults)).toThrow("identificador");
  });

  test("por evento exige identidade explícita e distingue conversões", () => {
    const config: FlowSettings = {
      ...settings,
      deduplication: "event",
      eventIdPath: "last_conversion.created_at",
    };
    expect(() => deliveryIdentity(lead, config)).toThrow("evento");
    expect(deliveryIdentity({ ...lead, last_conversion: { created_at: "A" } }, config)).not.toBe(
      deliveryIdentity({ ...lead, last_conversion: { created_at: "B" } }, config),
    );
    expect(flowSettingsSchema.safeParse({ ...config, eventIdPath: "" }).success).toBe(false);
  });
  test("descobre caminhos de campos para configurar o formulário", () => {
    expect(availablePaths(lead)).toContain("custom_fields.interesse");
    expect(availablePaths({ choices: ["A"] })).toEqual(["choices"]);
  });
});
