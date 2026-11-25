import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../db";
import { crmCustomFieldDefinitions, crmStages } from "../../db/schema";

import {
  isCustomFieldInactive,
  isCustomFieldStatusFilter,
  normalizePipelineId,
  type CustomFieldEntity,
  type CustomFieldStatusFilter,
  type CustomFieldType,
} from "./custom-field-common";
export {
  isCustomFieldInactive,
  isCustomFieldStatusFilter,
  normalizePipelineId,
  type CustomFieldEntity,
  type CustomFieldStatusFilter,
  type CustomFieldType,
} from "./custom-field-common";
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

export function parseJsonArray<T>(raw: unknown): T[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      return [];
    }
  }
  return [];
}

export async function listCustomFields(
  tenantId: string,
  entityType: CustomFieldEntity,
  executor: Pick<typeof db, "select"> = db,
  options: { includeArchived?: boolean; status?: CustomFieldStatusFilter } = {},
): Promise<CustomFieldDefinition[]> {
  const conditions = [
    eq(crmCustomFieldDefinitions.tenantId, tenantId),
    eq(crmCustomFieldDefinitions.entityType, entityType),
  ];

  if (options.status === "inactive") {
    conditions.push(isNotNull(crmCustomFieldDefinitions.archivedAt));
  } else if (!options.includeArchived && options.status !== "all") {
    conditions.push(isNull(crmCustomFieldDefinitions.archivedAt));
  }

  const rows = await executor
    .select()
    .from(crmCustomFieldDefinitions)
    .where(and(...conditions))
    .orderBy(asc(crmCustomFieldDefinitions.sortOrder), asc(crmCustomFieldDefinitions.createdAt));

  return rows.map((row) => ({
    ...row,
    options: parseJsonArray<{ id: string; label: string }>(row.options),
    pipelineIds: parseJsonArray<string>(row.pipelineIds),
  }));
}

export function normalizeCustomFieldDefinition(row: CustomFieldDefinition): CustomFieldDefinition {
  return {
    ...row,
    options: parseJsonArray<{ id: string; label: string }>(row.options),
    pipelineIds: parseJsonArray<string>(row.pipelineIds),
  };
}

export async function resolveBulkCustomFieldTargetIds(
  tenantId: string,
  entityType: CustomFieldEntity,
  input: { fieldIds?: unknown; keepActiveIds?: unknown; active: boolean },
  executor: Pick<typeof db, "select"> = db,
): Promise<string[]> {
  const allFields = await listCustomFields(tenantId, entityType, executor, { includeArchived: true });
  const allIds = new Set(allFields.map((f) => f.id));

  if (!input.active && Array.isArray(input.keepActiveIds)) {
    if (
      input.keepActiveIds.length > 200 ||
      input.keepActiveIds.some((id) => typeof id !== "string" || !id.trim())
    ) {
      throw new CustomFieldError("Lista de campos a manter ativos inválida.");
    }
    const keepSet = new Set(input.keepActiveIds.map((id) => id.trim()));
    for (const id of keepSet) {
      if (!allIds.has(id)) {
        throw new CustomFieldError("Um ou mais campos informados para manter ativos são inválidos.");
      }
    }
    return allFields.filter((f) => !isCustomFieldInactive(f) && !keepSet.has(f.id)).map((f) => f.id);
  }

  if (
    !Array.isArray(input.fieldIds) ||
    input.fieldIds.length === 0 ||
    input.fieldIds.length > 200 ||
    input.fieldIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    throw new CustomFieldError("Selecione ao menos um campo personalizado.");
  }

  const uniqueIds = Array.from(new Set(input.fieldIds.map((id) => id.trim())));
  for (const id of uniqueIds) {
    if (!allIds.has(id)) {
      throw new CustomFieldError("Um ou mais campos selecionados não foram encontrados.");
    }
  }
  return uniqueIds;
}

export async function setCustomFieldsActiveState(
  tenantId: string,
  entityType: CustomFieldEntity,
  fieldIds: string[],
  active: boolean,
  executor: Pick<typeof db, "select" | "update"> = db,
): Promise<{ updatedFields: CustomFieldDefinition[] }> {
  const uniqueIds = Array.from(new Set(fieldIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { updatedFields: [] };
  }

  const matched = await executor
    .select()
    .from(crmCustomFieldDefinitions)
    .where(
      and(
        eq(crmCustomFieldDefinitions.tenantId, tenantId),
        eq(crmCustomFieldDefinitions.entityType, entityType),
        inArray(crmCustomFieldDefinitions.id, uniqueIds),
      ),
    );

  if (matched.length !== uniqueIds.length) {
    throw new CustomFieldError("Um ou mais campos não foram encontrados nesta empresa.");
  }

  const now = new Date();

  if (!active) {
    const toInactivate = matched.filter((row) => !row.archivedAt).map((row) => row.id);
    if (toInactivate.length === 0) {
      return { updatedFields: [] };
    }
    const updated = await executor
      .update(crmCustomFieldDefinitions)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(crmCustomFieldDefinitions.tenantId, tenantId),
          eq(crmCustomFieldDefinitions.entityType, entityType),
          inArray(crmCustomFieldDefinitions.id, toInactivate),
          isNull(crmCustomFieldDefinitions.archivedAt),
        ),
      )
      .returning();

    return { updatedFields: updated.map(normalizeCustomFieldDefinition) };
  }

  const toReactivate = matched.filter((row) => Boolean(row.archivedAt));
  if (toReactivate.length === 0) {
    return { updatedFields: [] };
  }

  const activeFields = await listCustomFields(tenantId, entityType, executor, { status: "active" });
  const activeNames = new Set(activeFields.map((f) => f.name.toLocaleLowerCase("pt-BR")));
  const batchNames = new Set<string>();

  for (const row of toReactivate) {
    const normalizedName = row.name.toLocaleLowerCase("pt-BR");
    if (activeNames.has(normalizedName)) {
      throw new CustomFieldError(
        `Já existe um campo ativo com o nome "${row.name}". Renomeie o campo antes de reativar.`,
      );
    }
    if (batchNames.has(normalizedName)) {
      throw new CustomFieldError(
        `Não é possível reativar dois campos com o mesmo nome "${row.name}" simultaneamente.`,
      );
    }
    batchNames.add(normalizedName);
  }

  const stageIdsToCheck = Array.from(
    new Set(
      toReactivate
        .filter((r) => r.requiredRule === "stage_onwards" && r.requiredFromStageId)
        .map((r) => r.requiredFromStageId as string),
    ),
  );
  const validStageIds = new Set<string>();
  if (stageIdsToCheck.length > 0) {
    const existingStages = await executor
      .select({ id: crmStages.id })
      .from(crmStages)
      .where(and(eq(crmStages.tenantId, tenantId), inArray(crmStages.id, stageIdsToCheck)));
    for (const st of existingStages) validStageIds.add(st.id);
  }

  const staleStageFieldIds = toReactivate
    .filter((r) => r.requiredRule === "stage_onwards" && r.requiredFromStageId && !validStageIds.has(r.requiredFromStageId))
    .map((r) => r.id);
  const normalFieldIds = toReactivate
    .filter((r) => !staleStageFieldIds.includes(r.id))
    .map((r) => r.id);

  const updatedRows: CustomFieldDefinition[] = [];
  if (normalFieldIds.length > 0) {
    const rows = await executor
      .update(crmCustomFieldDefinitions)
      .set({ archivedAt: null, updatedAt: now })
      .where(
        and(
          eq(crmCustomFieldDefinitions.tenantId, tenantId),
          eq(crmCustomFieldDefinitions.entityType, entityType),
          inArray(crmCustomFieldDefinitions.id, normalFieldIds),
        ),
      )
      .returning();
    updatedRows.push(...rows);
  }
  if (staleStageFieldIds.length > 0) {
    const rows = await executor
      .update(crmCustomFieldDefinitions)
      .set({
        archivedAt: null,
        requiredRule: "always",
        requiredFromStageId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(crmCustomFieldDefinitions.tenantId, tenantId),
          eq(crmCustomFieldDefinitions.entityType, entityType),
          inArray(crmCustomFieldDefinitions.id, staleStageFieldIds),
        ),
      )
      .returning();
    updatedRows.push(...rows);
  }

  return { updatedFields: updatedRows.map(normalizeCustomFieldDefinition) };
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
    const normalizedOptions = parseJsonArray<{ id: string; label: string }>(field.options);
    const optionsById = new Set(normalizedOptions.map((option) => option.id));
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
      case "number": {
        if (typeof value !== "number" && typeof value !== "string")
          throw new CustomFieldError(`${field.name}: número inválido.`);
        const rawStr = typeof value === "string" ? value.trim().replace(",", ".") : String(value);
        if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(rawStr))
          throw new CustomFieldError(`${field.name}: número inválido.`);
        const numericVal = Number(rawStr);
        if (!Number.isFinite(numericVal))
          throw new CustomFieldError(`${field.name}: número inválido.`);
        result[id] =
          typeof value === "string" && /^-?0\d/.test(rawStr) ? rawStr : numericVal;
        break;
      }
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

export function formatCustomFieldLabel(
  field: CustomFieldDefinition,
  value: unknown,
): string | null {
  if (!isFilled(value)) return null;
  const options = parseJsonArray<{ id: string; label: string }>(field.options);
  const optionMap = new Map(options.map((o) => [o.id, o.label]));

  if (field.fieldType === "single" && typeof value === "string") {
    return optionMap.get(value) || value;
  }
  if (field.fieldType === "multiple" && Array.isArray(value)) {
    const labels = value
      .map((item) => (typeof item === "string" ? optionMap.get(item) || item : String(item)))
      .filter(Boolean);
    return labels.length > 0 ? labels.join(", ") : null;
  }
  if (field.fieldType === "date" && typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return value;
  }
  return String(value).trim() || null;
}

export function diffCustomFieldValues(
  definitions: CustomFieldDefinition[],
  oldValues: Record<string, unknown> | null | undefined,
  newValues: Record<string, unknown> | null | undefined,
): Array<{
  fieldId: string;
  fieldName: string;
  fieldType: string;
  fromValue: unknown;
  toValue: unknown;
  fromLabel: string | null;
  toLabel: string | null;
}> {
  const prev = oldValues && typeof oldValues === "object" ? oldValues : {};
  const next = newValues && typeof newValues === "object" ? newValues : {};
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const diffs: Array<{
    fieldId: string;
    fieldName: string;
    fieldType: string;
    fromValue: unknown;
    toValue: unknown;
    fromLabel: string | null;
    toLabel: string | null;
  }> = [];

  for (const key of allKeys) {
    const field = byId.get(key);
    if (!field) continue;
    const rawFrom = prev[key];
    const rawTo = next[key];
    const fromFilled = isFilled(rawFrom);
    const toFilled = isFilled(rawTo);
    if (!fromFilled && !toFilled) continue;

    const fromLabel = formatCustomFieldLabel(field, rawFrom);
    const toLabel = formatCustomFieldLabel(field, rawTo);
    if (fromLabel === toLabel) continue;

    diffs.push({
      fieldId: field.id,
      fieldName: field.name,
      fieldType: field.fieldType,
      fromValue: fromFilled ? rawFrom : null,
      toValue: toFilled ? rawTo : null,
      fromLabel,
      toLabel,
    });
  }

  return diffs;
}

