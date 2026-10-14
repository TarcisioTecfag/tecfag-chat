import { describe, expect, test } from "bun:test";
import {
  buildDealUpdatePayload,
  doesDealFieldApplyToPipeline,
  extractDealCustomFieldsByFieldId,
  normalizeCustomFieldDefs,
  normalizeDealCustomFields,
  type CustomFieldDef,
} from "../src/components/crm/ConversationDealsPanel";
import { parseJsonArray, validateFieldValues } from "../src/lib/crm/custom-fields";

describe("ConversationDealsPanel inline edit resilience", () => {
  test("normalizes customFieldDefinitions when options and pipelineIds arrive as JSON strings from PostgreSQL", () => {
    const rawFromApi = [
      {
        id: "cf-segmento",
        name: "Segmento",
        fieldType: "single",
        options: JSON.stringify([
          { id: "opt-ind", label: "Indústria" },
          { id: "opt-com", label: "Comércio" },
        ]),
        allPipelines: false,
        pipelineIds: JSON.stringify(["pipe-tecfag-vendas"]),
      },
      {
        id: "cf-interesse",
        name: "Interesses",
        fieldType: "multiple",
        options: '[{"id":"opt-1","label":"Seladora"},{"id":"opt-2","label":"Envasadora"}]',
        allPipelines: true,
        pipelineIds: "[]",
      },
    ];

    const normalized = normalizeCustomFieldDefs(rawFromApi);
    expect(normalized).toHaveLength(2);
    expect(Array.isArray(normalized[0].options)).toBe(true);
    expect(normalized[0].options).toEqual([
      { id: "opt-ind", label: "Indústria" },
      { id: "opt-com", label: "Comércio" },
    ]);
    expect(Array.isArray(normalized[0].pipelineIds)).toBe(true);
    expect(normalized[0].pipelineIds).toEqual(["pipe-tecfag-vendas"]);

    // Verify .map() works without throwing TypeError: n.map is not a function
    const mappedLabels = (normalized[0].options as any[]).map((o) => o.label);
    expect(mappedLabels).toEqual(["Indústria", "Comércio"]);
  });

  test("doesDealFieldApplyToPipeline handles serialized pipelineIds and normalized pipeline slugs", () => {
    const def: CustomFieldDef = {
      id: "cf-1",
      name: "Origem Técnica",
      fieldType: "text",
      allPipelines: false,
      pipelineIds: JSON.stringify(["pipe-tecfag-comercial-2-0"]) as unknown as string[],
    };

    expect(doesDealFieldApplyToPipeline(def, "pipe-comercial")).toBe(true);
    expect(doesDealFieldApplyToPipeline(def, "pipe-outro")).toBe(false);
  });

  test("extractDealCustomFieldsByFieldId normalizes JSON string customFields and converts multiple fields to string arrays", () => {
    const defs: CustomFieldDef[] = [
      {
        id: "cf-1",
        name: "Urgência",
        fieldType: "single",
        options: [{ id: "alta", label: "Alta" }],
        allPipelines: true,
      },
      {
        id: "cf-2",
        name: "Máquinas",
        fieldType: "multiple",
        options: [
          { id: "m1", label: "Seladora" },
          { id: "m2", label: "Datador" },
        ],
        allPipelines: true,
      },
    ];

    const rawCustomFields = JSON.stringify({
      Urgência: "alta",
      "cf-2": "m1",
      legacy_rd_key: "ignored",
    });

    expect(normalizeDealCustomFields(rawCustomFields)).toEqual({
      Urgência: "alta",
      "cf-2": "m1",
      legacy_rd_key: "ignored",
    });

    const extracted = extractDealCustomFieldsByFieldId(rawCustomFields, defs);
    expect(extracted).toEqual({
      "cf-1": "alta",
      "cf-2": ["m1"],
    });
  });

  test("buildDealUpdatePayload sends only changed stage/pipeline/status and changed custom fields", () => {
    const defs: CustomFieldDef[] = [
      {
        id: "cf-1",
        name: "Urgência",
        fieldType: "single",
        options: [
          { id: "alta", label: "Alta" },
          { id: "baixa", label: "Baixa" },
        ],
        allPipelines: true,
      },
    ];

    const originalDeal = {
      id: "deal-1",
      title: "Negócio Antigo",
      value: "1500.00",
      pipelineId: "pipe-1",
      stageId: "stg-1",
      operatorId: "op-1",
      status: "open",
      customFields: {
        "cf-1": "alta",
        legacy_unmapped_field: "valor-antigo",
      },
    };

    // Case 1: Only title and value edited — stageId, pipelineId, status and customFields are omitted
    const payloadTitleOnly = buildDealUpdatePayload(
      originalDeal,
      {
        title: "Negócio Atualizado",
        value: "2500",
        pipelineId: "pipe-1",
        stageId: "stg-1",
        operatorId: "op-1",
        status: "open",
        customFields: { "cf-1": "alta" },
      },
      defs
    );

    expect(payloadTitleOnly).toEqual({
      title: "Negócio Atualizado",
      value: 2500,
      operatorId: "op-1",
    });
    expect(payloadTitleOnly.stageId).toBeUndefined();
    expect(payloadTitleOnly.status).toBeUndefined();
    expect(payloadTitleOnly.customFields).toBeUndefined();

    // Case 2: Custom field and stage changed — included in payload
    const payloadWithChanges = buildDealUpdatePayload(
      originalDeal,
      {
        title: "Negócio Atualizado",
        value: "2500",
        pipelineId: "pipe-1",
        stageId: "stg-2",
        operatorId: "__none__",
        status: "won",
        customFields: { "cf-1": "baixa" },
      },
      defs
    );

    expect(payloadWithChanges).toEqual({
      title: "Negócio Atualizado",
      value: 2500,
      operatorId: null,
      stageId: "stg-2",
      status: "won",
      customFields: { "cf-1": "baixa" },
    });
  });

  test("backend validateFieldValues handles definitions whose options and pipelineIds are JSON strings", () => {
    const definitions: any[] = [
      {
        id: "cf-single",
        tenantId: "tecfag",
        entityType: "deal",
        name: "Canal",
        fieldType: "single",
        options: JSON.stringify([{ id: "opt-whats", label: "WhatsApp" }]),
        required: false,
        requiredRule: "always",
        requiredFromStageId: null,
        isUnique: false,
        visibleOnCreate: true,
        allPipelines: false,
        pipelineIds: JSON.stringify(["pipe-1"]),
        sortOrder: 0,
        createdAt: new Date(),
        archivedAt: null,
      },
    ];

    expect(parseJsonArray(definitions[0].options)).toEqual([
      { id: "opt-whats", label: "WhatsApp" },
    ]);

    const validated = validateFieldValues(
      definitions,
      { "cf-single": "opt-whats" },
      { pipelineId: "pipe-1" }
    );
    expect(validated).toEqual({ "cf-single": "opt-whats" });
  });
});
