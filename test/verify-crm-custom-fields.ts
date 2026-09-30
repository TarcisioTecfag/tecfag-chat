import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CustomFieldError,
  missingStageFields,
  validateFieldValues,
  type CustomFieldDefinition,
} from "../src/lib/crm/custom-fields";

const fields = [
  {
    id: "f-required",
    entityType: "deal",
    name: "Cliente novo?",
    fieldType: "single",
    options: [
      { id: "yes", label: "Sim" },
      { id: "no", label: "Não" },
    ],
    required: true,
    visibleOnCreate: true,
    allPipelines: false,
    pipelineIds: ["pipeline-a"],
  },
  {
    id: "f-number",
    entityType: "deal",
    name: "Volume",
    fieldType: "number",
    options: [],
    required: false,
    visibleOnCreate: true,
    allPipelines: true,
    pipelineIds: [],
  },
  {
    id: "f-date",
    entityType: "deal",
    name: "Data de teste",
    fieldType: "date",
    options: [],
    required: false,
    visibleOnCreate: true,
    allPipelines: true,
    pipelineIds: [],
  },
] as CustomFieldDefinition[];

test("campos obrigatórios respeitam o funil", () => {
  assert.throws(
    () => validateFieldValues(fields, {}, { pipelineId: "pipeline-a", requireOnCreate: true }),
    CustomFieldError,
  );
  assert.deepEqual(
    validateFieldValues(fields, {}, { pipelineId: "pipeline-b", requireOnCreate: true }),
    {},
  );
  assert.deepEqual(
    validateFieldValues(
      fields,
      { "f-required": "yes", "f-number": "12.5" },
      { pipelineId: "pipeline-a", requireOnCreate: true },
    ),
    {
      "f-required": "yes",
      "f-number": 12.5,
    },
  );
});

test("valores inválidos e campos de outro funil são rejeitados", () => {
  assert.throws(
    () => validateFieldValues(fields, { "f-required": null }, { pipelineId: "pipeline-a" }),
    CustomFieldError,
  );
  assert.throws(
    () => validateFieldValues(fields, { "f-required": "unknown" }, { pipelineId: "pipeline-a" }),
    CustomFieldError,
  );
  assert.throws(
    () => validateFieldValues(fields, { "f-required": "yes" }, { pipelineId: "pipeline-b" }),
    CustomFieldError,
  );
  assert.throws(
    () => validateFieldValues(fields, { "f-number": "1e999" }, { pipelineId: "pipeline-a" }),
    CustomFieldError,
  );
  assert.throws(
    () => validateFieldValues(fields, { "f-date": "2026-02-31" }, { pipelineId: "pipeline-a" }),
    CustomFieldError,
  );
});

test("a exigência por etapa usa o ID estável do campo", () => {
  assert.deepEqual(missingStageFields(["f-required"], fields, {}, "pipeline-a"), ["Cliente novo?"]);
  assert.deepEqual(
    missingStageFields(["f-required"], fields, { "f-required": "no" }, "pipeline-a"),
    [],
  );
  assert.deepEqual(missingStageFields(["f-required"], fields, {}, "pipeline-b"), []);
});
