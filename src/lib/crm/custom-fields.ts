import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { crmCustomFieldDefinitions } from "../../db/schema";

export type CustomFieldEntity = "deal" | "company" | "contact" | "product";
export type CustomFieldType = "text" | "date" | "single" | "multiple" | "number" | "url";
export type CustomFieldValues = Record<string, unknown>;
export type CustomFieldDefinition = typeof crmCustomFieldDefinitions.$inferSelect;

export class CustomFieldError extends Error {
  statusCode = 400;
  code = "INVALID_CUSTOM_FIELD";
}

export function isCustomFieldEntity(value: unknown): value is CustomFieldEntity {
  return value === "deal" || value === "company" || value === "contact" || value === "product";
}

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return (
    value === "text" ||
    value === "date" ||
    value === "single" ||
    value === "multiple" ||
    value === "number" ||
    value === "url"
  );
}

const standardNames: Record<CustomFieldEntity, string[]> = {
  deal: [
    "nome da negociação",
    "empresa",
    "valor total",
    "qualificação",
    "previsão de fechamento",
    "fonte",
    "campanha",
    "funil",
    "etapa do funil",
  ],
  company: [
    "nome da empresa",
    "nome fantasia",
    "segmento",
    "cnpj",
    "cpf",
    "cnpj ou cpf",
    "telefone",
    "e-mail",
    "email",
    "url",
  ],
  contact: ["nome do contato", "telefone", "e-mail", "email", "empresa vinculada"],
  product: ["nome", "sku", "descrição", "valor", "unidade", "categoria"],
};

export function conflictsWithStandardField(entity: CustomFieldEntity, name: string) {
  return standardNames[entity].includes(name.trim().toLocaleLowerCase("pt-BR"));
}

export async function listCustomFields(
  tenantId: string,
  entityType: CustomFieldEntity,
  executor: Pick<typeof db, "select"> = db,
): Promise<CustomFieldDefinition[]> {
  return executor
    .select()
    .from(crmCustomFieldDefinitions)
    .where(
      and(
        eq(crmCustomFieldDefinitions.tenantId, tenantId),
        eq(crmCustomFieldDefinitions.entityType, entityType),
        isNull(crmCustomFieldDefinitions.archivedAt),
      ),
    )
    .orderBy(asc(crmCustomFieldDefinitions.sortOrder), asc(crmCustomFieldDefinitions.createdAt));
}

export function normalizePipelineId(id?: string | null): string {
  if (!id) return "";
  return id
    .toLowerCase()
    .trim()
    .replace(/-2-0$/, "")
    .replace(/^pipe-(tecfag-)?/, "");
}

export function fieldAppliesToPipeline(field: CustomFieldDefinition, pipelineId?: string | null) {
  if (field.entityType !== "deal" || field.allPipelines) return true;
  const pIds: string[] = Array.isArray(field.pipelineIds)
    ? field.pipelineIds
    : typeof (field as any).pipelineIds === "string"
      ? (() => {
          try {
            const parsed = JSON.parse((field as any).pipelineIds);
            return Array.isArray(parsed) ? parsed : [(field as any).pipelineIds];
          } catch {
            return [(field as any).pipelineIds];
          }
        })()
      : [];
  if (!pIds.length) return true;
  if (!pipelineId) return false;
  const currentNorm = normalizePipelineId(pipelineId);
  return pIds.some(
    (id) =>
      id === pipelineId ||
      (currentNorm && normalizePipelineId(id) === currentNorm) ||
      (typeof id === "string" && typeof pipelineId === "string" && (id.includes(pipelineId) || pipelineId.includes(id))),
  );
}

export function isFilled(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    (!Array.isArray(value) || value.length > 0)
  );
}

export type StageContext = {
  stageId?: string | null;
  orderIndex?: number | null;
  allStages?: Array<{ id: string; orderIndex: number; pipelineId: string }>;
};

export function isFieldRequiredForStage(
  field: CustomFieldDefinition,
  stageContext?: StageContext | null,
): boolean {
  if (!field.required) return false;
  if (field.requiredRule !== "stage_onwards" || !field.requiredFromStageId) {
    return true;
  }
  if (!stageContext || stageContext.orderIndex === undefined || stageContext.orderIndex === null) {
    return false;
  }
  if (!stageContext.allStages || !stageContext.allStages.length) {
    return stageContext.stageId === field.requiredFromStageId;
  }
  const cutoffStage = stageContext.allStages.find((s) => s.id === field.requiredFromStageId);
  if (!cutoffStage) return false;
  return stageContext.orderIndex >= cutoffStage.orderIndex;
}

export function validateFieldValues(
  definitions: CustomFieldDefinition[],
  input: unknown,
  options: {
    pipelineId?: string | null;
    requireOnCreate?: boolean;
    stageContext?: StageContext | null;
  } = {},
): CustomFieldValues {
  if (input === undefined || input === null) input = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CustomFieldError("Os campos personalizados devem ser um objeto.");
  }
  const raw = input as CustomFieldValues;
  const applicable = definitions.filter((field) =>
    fieldAppliesToPipeline(field, options.pipelineId),
  );
  const byId = new Map(applicable.map((field) => [field.id, field]));
  const result: CustomFieldValues = {};
  for (const [id, value] of Object.entries(raw)) {
    const field = byId.get(id);
    if (!field) throw new CustomFieldError(`Campo personalizado inválido: ${id}.`);
    if (!isFilled(value)) {
      if (field.required && isFieldRequiredForStage(field, options.stageContext)) {
        throw new CustomFieldError(`O campo ${field.name} é obrigatório.`);
      }
      result[id] = null;
      continue;
    }
    const optionsById = new Set(field.options.map((option) => option.id));
    switch (field.fieldType) {
      case "text":
        if (typeof value !== "string" || value.length > 5000)
          throw new CustomFieldError(`${field.name}: texto inválido.`);
        result[id] = value.trim();
        break;
      case "url":
        if (typeof value !== "string" || value.length > 2048)
          throw new CustomFieldError(`${field.name}: URL inválida.`);
        try {
          const url = new URL(value);
          if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
        } catch {
          throw new CustomFieldError(`${field.name}: URL inválida.`);
        }
        result[id] = value;
        break;
      case "date": {
        const parsedDate = typeof value === "string" ? new Date(`${value}T12:00:00Z`) : null;
        if (
          typeof value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !parsedDate ||
          Number.isNaN(parsedDate.getTime()) ||
          parsedDate.toISOString().slice(0, 10) !== value
        ) {
          throw new CustomFieldError(`${field.name}: data inválida.`);
        }
        result[id] = value;
        break;
      }
      case "number":
        if (typeof value !== "number" && typeof value !== "string")
          throw new CustomFieldError(`${field.name}: número inválido.`);
        if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value.trim()))
          throw new CustomFieldError(`${field.name}: número inválido.`);
        if (!Number.isFinite(Number(value)))
          throw new CustomFieldError(`${field.name}: número inválido.`);
        result[id] = Number(value);
        break;
      case "single":
        if (typeof value !== "string" || !optionsById.has(value))
          throw new CustomFieldError(`${field.name}: opção inválida.`);
        result[id] = value;
        break;
      case "multiple":
        if (
          !Array.isArray(value) ||
          value.some((item) => typeof item !== "string" || !optionsById.has(item))
        ) {
          throw new CustomFieldError(`${field.name}: opções inválidas.`);
        }
        result[id] = [...new Set(value)];
        break;
    }
  }
  if (options.requireOnCreate) {
    const missing = applicable.filter(
      (field) =>
        field.required &&
        field.visibleOnCreate &&
        isFieldRequiredForStage(field, options.stageContext) &&
        !isFilled(result[field.id]),
    );
    if (missing.length)
      throw new CustomFieldError(
        `Preencha os campos obrigatórios: ${missing.map((field) => field.name).join(", ")}.`,
      );
  }
  return result;
}

export function missingStageFields(
  requiredIds: string[],
  definitions: CustomFieldDefinition[],
  values: CustomFieldValues,
  pipelineId: string,
  stageContext?: StageContext | null,
): string[] {
  const applicable = definitions.filter((field) => fieldAppliesToPipeline(field, pipelineId));
  const byId = new Map(applicable.map((field) => [field.id, field]));
  const missingNames = new Set<string>();

  for (const id of requiredIds) {
    const field = byId.get(id);
    if (field && !isFilled(values[field.id] ?? values[field.name])) {
      missingNames.add(field.name);
    }
  }

  for (const field of applicable) {
    if (
      isFieldRequiredForStage(field, stageContext) &&
      !isFilled(values[field.id] ?? values[field.name])
    ) {
      missingNames.add(field.name);
    }
  }

  return Array.from(missingNames);
}
