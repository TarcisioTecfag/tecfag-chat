import { describe, expect, it } from "bun:test";
import {
  fieldAppliesToPipeline,
  normalizePipelineId,
} from "../src/lib/crm/custom-fields";
import {
  normalizeFieldOptions,
  normalizePipelineIds,
} from "../src/components/crm/CustomFieldsEditor";

describe("Blindagem e Tolerância de Campos Personalizados e Funis no CRM", () => {
  it("normalizePipelineId deve normalizar IDs com e sem sufixo 2.0 e prefixo pipe-", () => {
    expect(normalizePipelineId("pipe-tecfag-maquinas-2-0")).toBe("maquinas");
    expect(normalizePipelineId("pipe-tecfag-maquinas")).toBe("maquinas");
    expect(normalizePipelineId("pipe-maquinas")).toBe("maquinas");
    expect(normalizePipelineId("maquinas")).toBe("maquinas");
    expect(normalizePipelineId("pipe-tecfag-externo-2-0")).toBe("externo");
    expect(normalizePipelineId("pipe-tecfag-externo")).toBe("externo");
    expect(normalizePipelineId("pipe-tecfag-personnalite")).toBe("personnalite");
    expect(normalizePipelineId(null)).toBe("");
    expect(normalizePipelineId(undefined)).toBe("");
  });

  it("normalizeFieldOptions deve converter arrays, strings JSON ou fallbacks com segurança sem quebrar", () => {
    // Array legítimo
    const opts = [{ id: "opt-1", label: "Opção 1" }];
    expect(normalizeFieldOptions(opts)).toEqual(opts);

    // String JSON válida (comum em deserialização de Postgres)
    const jsonStr = JSON.stringify([{ id: "opt-2", label: "Opção 2" }]);
    expect(normalizeFieldOptions(jsonStr)).toEqual([{ id: "opt-2", label: "Opção 2" }]);

    // Null, undefined ou valor inválido (previne TypeError: options.map is not a function)
    expect(normalizeFieldOptions(null)).toEqual([]);
    expect(normalizeFieldOptions(undefined)).toEqual([]);
    expect(normalizeFieldOptions("invalid-json")).toEqual([]);
    expect(normalizeFieldOptions(123)).toEqual([]);
    expect(normalizeFieldOptions({})).toEqual([]);
  });

  it("normalizePipelineIds deve converter strings JSON ou arrays para lista de strings", () => {
    expect(normalizePipelineIds(["pipe-1", "pipe-2"])).toEqual(["pipe-1", "pipe-2"]);
    expect(normalizePipelineIds('["pipe-1","pipe-2"]')).toEqual(["pipe-1", "pipe-2"]);
    expect(normalizePipelineIds(null)).toEqual([]);
    expect(normalizePipelineIds(undefined)).toEqual([]);
    expect(normalizePipelineIds("pipe-single")).toEqual(["pipe-single"]);
  });

  it("fieldAppliesToPipeline deve aprovar match direto e normalizado entre funis", () => {
    const field: any = {
      entityType: "deal",
      allPipelines: false,
      pipelineIds: ["pipe-tecfag-maquinas-2-0"],
    };

    // Match direto
    expect(fieldAppliesToPipeline(field, "pipe-tecfag-maquinas-2-0")).toBe(true);

    // Match normalizado (versão sem 2.0)
    expect(fieldAppliesToPipeline(field, "pipe-tecfag-maquinas")).toBe(true);

    // Funil diferente não deve ter match
    expect(fieldAppliesToPipeline(field, "pipe-tecfag-personnalite")).toBe(false);

    // Se allPipelines for true, deve aplicar a qualquer funil
    const fieldAll: any = {
      entityType: "deal",
      allPipelines: true,
      pipelineIds: [],
    };
    expect(fieldAppliesToPipeline(fieldAll, "pipe-tecfag-personnalite")).toBe(true);
    expect(fieldAppliesToPipeline(fieldAll, null)).toBe(true);
  });

  it("fieldAppliesToPipeline deve ser tolerante a pipelineIds em formato string JSON", () => {
    const fieldWithJsonString: any = {
      entityType: "deal",
      allPipelines: false,
      pipelineIds: '["pipe-tecfag-maquinas-2-0"]',
    };

    expect(fieldAppliesToPipeline(fieldWithJsonString, "pipe-tecfag-maquinas-2-0")).toBe(true);
    expect(fieldAppliesToPipeline(fieldWithJsonString, "pipe-tecfag-maquinas")).toBe(true);
    expect(fieldAppliesToPipeline(fieldWithJsonString, "pipe-tecfag-pecas")).toBe(false);
  });
});
