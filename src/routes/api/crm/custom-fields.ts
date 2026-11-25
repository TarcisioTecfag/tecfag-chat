import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { crmCustomFieldDefinitions, crmPipelines, crmStages } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import {
  conflictsWithStandardField,
  isCustomFieldEntity,
  isCustomFieldInactive,
  isCustomFieldStatusFilter,
  isCustomFieldType,
  listCustomFields,
  resolveBulkCustomFieldTargetIds,
  setCustomFieldsActiveState,
  type CustomFieldEntity,
} from "../../../lib/crm/custom-fields";
import { recordCrmAction } from "../../../lib/crm/action-history";
import { handleConditionalResponse } from "../../../lib/http-cache";

async function checkPipelines(tenantId: string, pipelineIds: unknown): Promise<string[]> {
  if (
    !Array.isArray(pipelineIds) ||
    pipelineIds.length > 100 ||
    pipelineIds.some((id) => typeof id !== "string")
  ) {
    throw new Error("Seleção de funis inválida.");
  }
  const ids = [...new Set(pipelineIds as string[])];
  if (ids.length) {
    const pipelines = await db
      .select({ id: crmPipelines.id })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId));
    const allowed = new Set(pipelines.map((pipeline) => pipeline.id));
    if (ids.some((id) => !allowed.has(id)))
      throw new Error("Um dos funis selecionados é inválido.");
  }
  return ids;
}

function normalizeOptions(input: unknown, existingIds: string[] = []) {
  if (!Array.isArray(input) || input.length > 100) throw new Error("Opções inválidas.");
  const options = input.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.label !== "string" ||
      !entry.label.trim() ||
      entry.label.length > 120
    ) {
      throw new Error("Cada opção precisa de um nome de até 120 caracteres.");
    }
    return {
      id: typeof entry.id === "string" && entry.id ? entry.id : `opt-${crypto.randomUUID()}`,
      label: entry.label.trim(),
    };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length)
    throw new Error("Opções duplicadas.");
  if (existingIds.some((id) => !options.some((option) => option.id === id))) {
    throw new Error(
      "Opções existentes não podem ser removidas porque podem conter respostas. Renomeie a opção.",
    );
  }
  return options;
}

export const Route = createFileRoute("/api/crm/custom-fields")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const permission = requireCrmPermission(session, "canViewCrm");
        if (permission) return permission;
        const url = new URL(request.url);
        const entity = url.searchParams.get("entity");
        if (!isCustomFieldEntity(entity))
          return Response.json({ error: "Cadastro inválido." }, { status: 400 });

        const rawStatus = url.searchParams.get("status");
        const includeArchivedParam = url.searchParams.get("includeArchived");
        const includeArchived =
          includeArchivedParam === "true" || includeArchivedParam === "1";

        const statusFilter = isCustomFieldStatusFilter(rawStatus)
          ? rawStatus
          : includeArchived
            ? "all"
            : "active";

        const allFields = await listCustomFields(session.tenantId, entity, db, {
          includeArchived: true,
        });
        const inactiveCount = allFields.filter((f) => isCustomFieldInactive(f)).length;
        const activeCount = allFields.length - inactiveCount;
        const fields =
          statusFilter === "all"
            ? allFields
            : statusFilter === "inactive"
              ? allFields.filter((f) => isCustomFieldInactive(f))
              : allFields.filter((f) => !isCustomFieldInactive(f));

        return handleConditionalResponse(request, {
          fields,
          counts: { active: activeCount, inactive: inactiveCount, total: allFields.length },
          isAdmin: session.operator.role === "admin",
        });
      },
      PATCH: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin")
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
          );
        try {
          const body = await request.json();
          const entityType = body.entityType as CustomFieldEntity;
          if (!isCustomFieldEntity(entityType)) {
            throw new Error("Cadastro inválido.");
          }

          let active: boolean;
          if (body.action === "inactivate" || body.active === false || body.isActive === false) {
            active = false;
          } else if (body.action === "reactivate" || body.active === true || body.isActive === true) {
            active = true;
          } else {
            throw new Error("Ação inválida. Use 'inactivate' ou 'reactivate'.");
          }

          const { updatedFields } = await db.transaction(async (tx) => {
            const targetIds = await resolveBulkCustomFieldTargetIds(
              session.tenantId,
              entityType,
              {
                fieldIds: body.fieldIds,
                keepActiveIds: body.keepActiveIds,
                active,
              },
              tx,
            );
            const result = await setCustomFieldsActiveState(
              session.tenantId,
              entityType,
              targetIds,
              active,
              tx,
            );
            if (result.updatedFields.length > 0) {
              await recordCrmAction(
                {
                  tenantId: session.tenantId,
                  operatorId: session.operator.id,
                  operatorName: session.operator.name,
                  action: active ? "reactivate_custom_fields_bulk" : "inactivate_custom_fields_bulk",
                  entityType,
                  itemCount: result.updatedFields.length,
                  details: {
                    fieldIds: result.updatedFields.map((f) => f.id),
                    names: result.updatedFields.map((f) => f.name),
                  },
                },
                tx,
              );
            }
            return result;
          });

          return Response.json({
            updatedCount: updatedFields.length,
            fields: updatedFields,
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Dados inválidos." },
            { status: 400 },
          );
        }
      },
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin")
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
          );
        try {
          const body = await request.json();
          const entityType = body.entityType as CustomFieldEntity;
          if (!isCustomFieldEntity(entityType) || !isCustomFieldType(body.fieldType))
            throw new Error("Cadastro ou tipo de campo inválido.");
          const name = typeof body.name === "string" ? body.name.trim() : "";
          if (!name || name.length > 120) throw new Error("Informe um nome de até 120 caracteres.");
          if (conflictsWithStandardField(entityType, name))
            throw new Error("Este campo já existe como campo padrão do sistema.");
          const options =
            body.fieldType === "single" || body.fieldType === "multiple"
              ? normalizeOptions(body.options)
              : [];
          if ((body.fieldType === "single" || body.fieldType === "multiple") && !options.length)
            throw new Error("Adicione ao menos uma opção.");
          const allPipelines = entityType !== "deal" || body.allPipelines !== false;
          const pipelineIds = allPipelines
            ? []
            : await checkPipelines(session.tenantId, body.pipelineIds);
          if (!allPipelines && !pipelineIds.length) throw new Error("Selecione ao menos um funil.");
          if (body.required === true && body.visibleOnCreate === false)
            throw new Error("Um campo obrigatório deve aparecer no cadastro.");

          let isUnique = false;
          let requiredRule = "always";
          let requiredFromStageId: string | null = null;

          if (entityType === "deal") {
            isUnique = body.isUnique === true;
            if (body.required === true) {
              requiredRule = body.requiredRule === "stage_onwards" ? "stage_onwards" : "always";
              if (requiredRule === "stage_onwards") {
                const stageId =
                  typeof body.requiredFromStageId === "string"
                    ? body.requiredFromStageId.trim()
                    : "";
                if (!stageId) {
                  throw new Error("Selecione a partir de qual etapa o campo é obrigatório.");
                }
                const [stage] = await db
                  .select({ id: crmStages.id })
                  .from(crmStages)
                  .where(and(eq(crmStages.id, stageId), eq(crmStages.tenantId, session.tenantId)))
                  .limit(1);
                if (!stage) throw new Error("A etapa selecionada é inválida.");
                requiredFromStageId = stageId;
              }
            }
          }

          const allExisting = await listCustomFields(session.tenantId, entityType, db, {
            includeArchived: true,
          });
          if (
            allExisting
              .filter((field) => !isCustomFieldInactive(field))
              .some(
                (field) => field.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
              )
          )
            throw new Error("Já existe um campo ativo com esse nome.");
          const [field] = await db
            .insert(crmCustomFieldDefinitions)
            .values({
              id: `cf-${crypto.randomUUID()}`,
              tenantId: session.tenantId,
              entityType,
              name,
              fieldType: body.fieldType,
              options,
              required: body.required === true,
              requiredRule,
              requiredFromStageId,
              isUnique,
              visibleOnCreate: body.visibleOnCreate !== false,
              allPipelines,
              pipelineIds,
              sortOrder: allExisting.length
                ? Math.max(...allExisting.map((item) => item.sortOrder)) + 1
                : 0,
            })
            .returning();
          return Response.json({ field }, { status: 201 });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Dados inválidos." },
            { status: 400 },
          );
        }
      },
    },
  },
});
