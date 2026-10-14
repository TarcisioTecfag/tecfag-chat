import { describe, expect, test } from "bun:test";
import { buildRdDiagnostic, maskRdPayload } from "../src/lib/rd-marketing/diagnostics";
import {
  defaultMappings,
  flowSettingsSchema,
  mapLead,
  type FlowSettings,
} from "../src/lib/rd-marketing/mapping";

const settings: FlowSettings = {
  name: "Fluxo",
  enabled: true,
  pipelineId: "pipe",
  stageId: "stage",
  operatorId: null,
  deduplication: "lead",
  eventIdPath: "",
  attributionConversion: "last",
  mappings: defaultMappings,
};
const lead = {
  name: "Pessoa",
  email: "pessoa@example.com",
  mobile_phone: "",
  personal_phone: "11987654321",
  last_conversion: { conversion_origin: { source: "Google", campaign: "Campanha A" } },
};

describe("RD Marketing: qualidade e diagnóstico", () => {
  test("prioriza celular, depois telefone, depois alternativas configuradas e valor padrão", () => {
    expect(mapLead(lead, settings).contact.phone).toBe(lead.personal_phone);
    expect(mapLead({ ...lead, mobile_phone: "11999999999" }, settings).contact.phone).toBe(
      "11999999999",
    );
    const custom = {
      ...settings,
      mappings: defaultMappings.map((mapping) =>
        mapping.target === "contact.phone"
          ? {
              ...mapping,
              source: "cf_whatsapp",
              sourceAlternatives: ["personal_phone"],
              fallback: "11888888888",
            }
          : mapping,
      ),
    };
    expect(mapLead({ ...lead, cf_whatsapp: "11777777777" }, custom).contact.phone).toBe(
      "11777777777",
    );
    expect(mapLead({ ...lead, cf_whatsapp: " ", personal_phone: null }, custom).contact.phone).toBe(
      "11888888888",
    );
    const explicit = {
      ...settings,
      mappings: defaultMappings.map((mapping) =>
        mapping.target === "contact.phone"
          ? { source: "mobile_phone", sourceAlternatives: [], target: "contact.phone" }
          : mapping,
      ),
    };
    expect(mapLead(lead, explicit).contact.phone).toBeUndefined();
    const legacy = {
      ...settings,
      mappings: explicit.mappings.map((mapping) =>
        mapping.target === "contact.phone"
          ? { source: "mobile_phone", target: "contact.phone" }
          : mapping,
      ),
    };
    expect(mapLead(lead, legacy).contact.phone).toBe(lead.personal_phone);
    const phoneOnly = { ...lead, personal_phone: null, phone: "+551177777777" };
    expect(mapLead(phoneOnly, settings).contact.phone).toBe(phoneOnly.phone);
    expect(mapLead(phoneOnly, legacy).contact.phone).toBe(phoneOnly.phone);
    expect(mapLead(phoneOnly, explicit).contact.phone).toBeUndefined();
  });

  test("não aceita placeholders como Fonte ou Campanha obrigatórias, sem misturar conversões", () => {
    for (const placeholder of [
      "unknown",
      " UNKNOWN ",
      "null",
      "undefined",
      "Não informada",
      "desconhecida",
    ]) {
      for (const field of ["source", "campaign"]) {
        const invalid = {
          ...lead,
          last_conversion: {
            conversion_origin: { source: "Google", campaign: "Campanha A", [field]: placeholder },
          },
        };
        expect(() => mapLead(invalid, { ...settings, requireAttribution: true })).toThrow(
          "Fonte e Campanha",
        );
        expect(() => mapLead(invalid, { ...settings, requireAttribution: false })).not.toThrow();
      }
    }
    expect(mapLead(lead, { ...settings, requireAttribution: true }).deal.campaign).toBe(
      "Campanha A",
    );
  });

  test("valida caminhos alternativos e não permite propriedades herdadas", () => {
    const config = {
      ...settings,
      mappings: [
        { source: "name", sourceAlternatives: ["__proto__.email"], target: "contact.name" },
      ],
    };
    expect(flowSettingsSchema.safeParse(config).success).toBe(false);
    expect(flowSettingsSchema.safeParse(settings).success).toBe(true);
  });

  test("diagnostica origem usada, falta de e-mail e atribuição desconhecida", () => {
    const payload = {
      leads: [
        {
          ...lead,
          email: "",
          last_conversion: { conversion_origin: { source: "unknown", campaign: "" } },
        },
      ],
    };
    const diagnostic = buildRdDiagnostic(payload, settings);
    expect(
      diagnostic.sampledLeads[0].fields.find((field) => field.target === "contact.phone")?.source,
    ).toBe("personal_phone");
    expect(diagnostic.sampledLeads[0].warnings).toContain("Fonte ausente ou desconhecida.");
    expect(diagnostic.sampledLeads[0].warnings).toContain("Campanha ausente ou desconhecida.");
    expect(
      diagnostic.sampledLeads[0].fields.find((field) => field.target === "contact.email")?.status,
    ).toBe("empty");
    expect(
      diagnostic.sampledLeads[0].fields.find((field) => field.target === "company.name")?.status,
    ).toBe("not_mapped");
  });

  test("oculta identidade, campos livres, números e credenciais sem alterar entrada", () => {
    const payload = {
      leads: [
        {
          ...lead,
          uuid: "uuid-secret",
          custom_fields: {
            Nome: "Nome pessoal",
            cpf: 12345678901,
            token: "private-token",
            vazio: null,
          },
        },
      ],
      secret: "segredo",
      flag: false,
    };
    const original = JSON.stringify(payload);
    const result = JSON.stringify(buildRdDiagnostic(payload, settings));
    for (const privateValue of [
      "pessoa@example.com",
      "11987654321",
      "uuid-secret",
      "Nome pessoal",
      "12345678901",
      "private-token",
      "segredo",
    ])
      expect(result).not.toContain(privateValue);
    expect(JSON.stringify(payload)).toBe(original);
    expect(result).toContain("custom_fields");
    expect(result).toContain('"vazio":null');
  });

  test("amostra limitada mantém JSON válido e suporta payload inválido", () => {
    const diagnostic = buildRdDiagnostic(
      { leads: Array.from({ length: 100 }, () => lead) },
      settings,
    );
    expect(diagnostic.leadCount).toBe(100);
    expect(diagnostic.sampledLeads).toHaveLength(5);
    expect((diagnostic.maskedPayload as { leads: unknown[] }).leads).toHaveLength(5);
    expect(buildRdDiagnostic(null, settings).leadCount).toBe(0);
    const deep: Record<string, unknown> = {};
    deep.loop = deep;
    expect(() => JSON.stringify(maskRdPayload(deep))).not.toThrow();
    expect(maskRdPayload({ [String("x").repeat(500)]: "a" })).toBeDefined();
  });
});
