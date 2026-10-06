import { describe, expect, it } from "bun:test";
import {
  fieldAppliesToPipeline,
  isFieldRequiredForStage,
  missingStageFields,
  validateFieldValues,
  type CustomFieldDefinition,
  type CustomFieldValues,
  type StageContext,
} from "../src/lib/crm/custom-fields";

describe("Regras de Campos Personalizados do CRM (Funil, Único e Obrigatoriedade por Etapa)", () => {
  const dummyField = (overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition => ({
    id: "cf-test-1",
    tenantId: "tecfag",
    entityType: "deal",
    name: "Código de Rastreio",
    fieldType: "text",
    options: [],
    required: false,
    requiredRule: "always",
    requiredFromStageId: null,
    isUnique: false,
    visibleOnCreate: true,
    allPipelines: true,
    pipelineIds: [],
    sortOrder: 0,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe("Visibilidade por Funil (fieldAppliesToPipeline)", () => {
    it("campo com allPipelines=true é visível em qualquer funil", () => {
      const field = dummyField({ allPipelines: true, pipelineIds: [] });
      expect(fieldAppliesToPipeline(field, "pipe-1")).toBe(true);
      expect(fieldAppliesToPipeline(field, "pipe-2")).toBe(true);
      expect(fieldAppliesToPipeline(field, null)).toBe(true);
    });

    it("campo com allPipelines=false só é visível nos funis configurados", () => {
      const field = dummyField({ allPipelines: false, pipelineIds: ["pipe-comercial", "pipe-posvendas"] });
      expect(fieldAppliesToPipeline(field, "pipe-comercial")).toBe(true);
      expect(fieldAppliesToPipeline(field, "pipe-posvendas")).toBe(true);
      expect(fieldAppliesToPipeline(field, "pipe-outro")).toBe(false);
      expect(fieldAppliesToPipeline(field, null)).toBe(false);
    });

    it("campos de outras entidades (company, contact) não são restringidos por funil", () => {
      const companyField = dummyField({ entityType: "company", allPipelines: false, pipelineIds: ["pipe-1"] });
      expect(fieldAppliesToPipeline(companyField, "pipe-2")).toBe(true);
    });
  });

  describe("Obrigatoriedade Condicional (isFieldRequiredForStage)", () => {
    const stages = [
      { id: "stage-1", orderIndex: 0, pipelineId: "pipe-1" },
      { id: "stage-2", orderIndex: 1, pipelineId: "pipe-1" },
      { id: "stage-3", orderIndex: 2, pipelineId: "pipe-1" },
    ];

    it("campo não obrigatório sempre retorna false", () => {
      const field = dummyField({ required: false });
      expect(isFieldRequiredForStage(field, { stageId: "stage-1", orderIndex: 0, allStages: stages })).toBe(false);
    });

    it("campo com requiredRule='always' é obrigatório em qualquer etapa", () => {
      const field = dummyField({ required: true, requiredRule: "always" });
      expect(isFieldRequiredForStage(field, { stageId: "stage-1", orderIndex: 0, allStages: stages })).toBe(true);
      expect(isFieldRequiredForStage(field, { stageId: "stage-3", orderIndex: 2, allStages: stages })).toBe(true);
      expect(isFieldRequiredForStage(field, null)).toBe(true);
    });

    it("campo com requiredRule='stage_onwards' só é obrigatório a partir da etapa de corte", () => {
      const field = dummyField({
        required: true,
        requiredRule: "stage_onwards",
        requiredFromStageId: "stage-2",
      });

      // Etapa 1 (orderIndex 0 < orderIndex 1 da etapa de corte) -> NÃO obrigatório
      const ctxStage1: StageContext = { stageId: "stage-1", orderIndex: 0, allStages: stages };
      expect(isFieldRequiredForStage(field, ctxStage1)).toBe(false);

      // Etapa 2 (orderIndex 1 == orderIndex 1) -> OBRIGATÓRIO
      const ctxStage2: StageContext = { stageId: "stage-2", orderIndex: 1, allStages: stages };
      expect(isFieldRequiredForStage(field, ctxStage2)).toBe(true);

      // Etapa 3 (orderIndex 2 > orderIndex 1) -> OBRIGATÓRIO
      const ctxStage3: StageContext = { stageId: "stage-3", orderIndex: 2, allStages: stages };
      expect(isFieldRequiredForStage(field, ctxStage3)).toBe(true);
    });
  });

  describe("Validação de Etapa (missingStageFields)", () => {
    const stages = [
      { id: "stage-1", orderIndex: 0, pipelineId: "pipe-1" },
      { id: "stage-2", orderIndex: 1, pipelineId: "pipe-1" },
    ];
    const fieldStage2 = dummyField({
      id: "cf-doc",
      name: "Documento Aprovado",
      required: true,
      requiredRule: "stage_onwards",
      requiredFromStageId: "stage-2",
      allPipelines: true,
    });

    it("não acusa falta se o deal está na etapa 1 antes do corte", () => {
      const missing = missingStageFields(
        [],
        [fieldStage2],
        {},
        "pipe-1",
        { stageId: "stage-1", orderIndex: 0, allStages: stages },
      );
      expect(missing).toEqual([]);
    });

    it("acusa falta se o deal avança para a etapa 2 de corte sem preencher o campo", () => {
      const missing = missingStageFields(
        [],
        [fieldStage2],
        {},
        "pipe-1",
        { stageId: "stage-2", orderIndex: 1, allStages: stages },
      );
      expect(missing).toEqual(["Documento Aprovado"]);
    });

    it("não acusa falta se o campo foi devidamente preenchido", () => {
      const missing = missingStageFields(
        [],
        [fieldStage2],
        { "cf-doc": "123.456.789-00" },
        "pipe-1",
        { stageId: "stage-2", orderIndex: 1, allStages: stages },
      );
      expect(missing).toEqual([]);
    });
  });

  describe("Validação de Entradas (validateFieldValues)", () => {
    it("não bloqueia criação se campo obrigatório a partir de etapa posterior não for preenchido no início", () => {
      const stages = [
        { id: "stage-1", orderIndex: 0, pipelineId: "pipe-1" },
        { id: "stage-2", orderIndex: 1, pipelineId: "pipe-1" },
      ];
      const field = dummyField({
        id: "cf-contrato",
        name: "Contrato Assinado",
        required: true,
        requiredRule: "stage_onwards",
        requiredFromStageId: "stage-2",
      });

      const values = validateFieldValues([field], {}, {
        pipelineId: "pipe-1",
        requireOnCreate: true,
        stageContext: { stageId: "stage-1", orderIndex: 0, allStages: stages },
      });

      expect(values).toEqual({});
    });

    it("bloqueia criação se campo for sempre obrigatório", () => {
      const field = dummyField({
        id: "cf-origem",
        name: "Origem do Lead",
        required: true,
        requiredRule: "always",
        visibleOnCreate: true,
      });

      expect(() => {
        validateFieldValues([field], {}, {
          pipelineId: "pipe-1",
          requireOnCreate: true,
        });
      }).toThrow("Preencha os campos obrigatórios: Origem do Lead.");
    });
  });
});
