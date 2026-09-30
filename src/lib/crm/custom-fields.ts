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

export function fieldAppliesToPipeline(field: CustomFieldDefinition, pipelineId?: string | null) {
  return (
    field.entityType !== "deal" ||
    field.allPipelines ||
    (pipelineId != null && field.pipelineIds.includes(pipelineId))
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

export function validateFieldValues(
  definitions: CustomFieldDefinition[],
  input: unknown,
  options: { pipelineId?: string | null; requireOnCreate?: boolean } = {},
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
      if (field.required) throw new CustomFieldError(`O campo ${field.name} é obrigatório.`);
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
      (field) => field.required && field.visibleOnCreate && !isFilled(result[field.id]),
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
): string[] {
  const byId = new Map(
    definitions
      .filter((field) => fieldAppliesToPipeline(field, pipelineId))
      .map((field) => [field.id, field]),
  );
  return requiredIds.flatMap((id) => {
    const field = byId.get(id);
    return field && !isFilled(values[id]) ? [field.name] : [];
  });
}
