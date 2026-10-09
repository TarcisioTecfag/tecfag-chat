import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../../../db";
import { crmCustomFieldDefinitions, crmPipelines, crmStages } from "../../../../db/schema";
import { requireSession } from "../../../../lib/auth-session";
import { conflictsWithStandardField, listCustomFields } from "../../../../lib/crm/custom-fields";
import { recordCrmAction } from "../../../../lib/crm/action-history";

export const Route = createFileRoute("/api/crm/custom-fields/$fieldId")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin")
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
          );
        const fieldId = (params as unknown as { fieldId: string }).fieldId;
        const [current] = await db
          .select()
          .from(crmCustomFieldDefinitions)
          .where(
            and(
              eq(crmCustomFieldDefinitions.id, fieldId),
              eq(crmCustomFieldDefinitions.tenantId, session.tenantId),
              isNull(crmCustomFieldDefinitions.archivedAt),
            ),
          )
          .limit(1);
        if (!current) return Response.json({ error: "Campo não encontrado." }, { status: 404 });
        try {
          const body = await request.json();
          const updates: Partial<typeof crmCustomFieldDefinitions.$inferInsert> = {
            updatedAt: new Date(),
          };
          if (body.name !== undefined) {
            if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120)
              throw new Error("Nome inválido.");
            const nextName = body.name.trim() as string;
            updates.name = nextName;
            if (
              conflictsWithStandardField(
                current.entityType as "deal" | "company" | "contact" | "product",
                nextName,
              )
            )
              throw new Error("Este campo já existe como campo padrão do sistema.");
            const siblings = await listCustomFields(
              session.tenantId,
              current.entityType as "deal" | "company" | "contact" | "product",
            );
            if (
              siblings.some(
                (field) =>
                  field.id !== current.id &&
                  field.name.toLocaleLowerCase("pt-BR") === nextName.toLocaleLowerCase("pt-BR"),
              )
            )
              throw new Error("Já existe um campo com esse nome.");
          }
          if (body.fieldType !== undefined && body.fieldType !== current.fieldType)
            throw new Error("O tipo do campo não pode ser alterado após a criação.");
          if (body.options !== undefined) {
            if (current.fieldType !== "single" && current.fieldType !== "multiple")
              throw new Error("Este campo não possui opções.");
            if (!Array.isArray(body.options) || !body.options.length || body.options.length > 100)
              throw new Error("Opções inválidas.");
            const options = body.options.map((option: { id?: string; label?: string }) => ({
              id: option?.id || `opt-${crypto.randomUUID()}`,
              label: typeof option?.label === "string" ? option.label.trim() : "",
            }));
            if (
              options.some(
                (option: { label: string }) => !option.label || option.label.length > 120,
              ) ||
              new Set(options.map((option: { id: string }) => option.id)).size !== options.length
            )
              throw new Error("Opções inválidas.");
            const currentOptions: Array<{ id: string; label: string }> = Array.isArray(current.options)
              ? current.options
              : typeof current.options === "string"
                ? (() => { try { const p = JSON.parse(current.options); return Array.isArray(p) ? p : []; } catch { return []; } })()
                : [];
            if (
              currentOptions.some(
                (option) => !options.some((next: { id: string }) => next.id === option.id),
              )
            )
              throw new Error(
                "Opções existentes não podem ser removidas; elas podem conter respostas.",
              );
            updates.options = options;
          }
          if (current.entityType === "deal" && body.isUnique !== undefined) {
            updates.isUnique = body.isUnique === true;
          }

          if (body.required !== undefined || body.requiredRule !== undefined || body.requiredFromStageId !== undefined) {
            const nextRequired = body.required !== undefined ? body.required === true : current.required;
            updates.required = nextRequired;

            if (nextRequired && current.entityType === "deal") {
              const nextRule = body.requiredRule !== undefined ? body.requiredRule : current.requiredRule;
              updates.requiredRule = nextRule === "stage_onwards" ? "stage_onwards" : "always";
              if (updates.requiredRule === "stage_onwards") {
                const nextStageId = body.requiredFromStageId !== undefined ? body.requiredFromStageId : current.requiredFromStageId;
                const stageId = typeof nextStageId === "string" ? nextStageId.trim() : "";
                if (!stageId) {
                  throw new Error("Selecione a partir de qual etapa o campo é obrigatório.");
                }
                const [stage] = await db
                  .select({ id: crmStages.id })
                  .from(crmStages)
                  .where(and(eq(crmStages.id, stageId), eq(crmStages.tenantId, session.tenantId)))
                  .limit(1);
                if (!stage) throw new Error("A etapa selecionada é inválida.");
                updates.requiredFromStageId = stageId;
              } else {
                updates.requiredFromStageId = null;
              }
            } else {
              updates.requiredRule = "always";
              updates.requiredFromStageId = null;
            }
          }

          if (body.visibleOnCreate !== undefined)
            updates.visibleOnCreate = body.visibleOnCreate === true;
          if (
            (updates.required ?? current.required) &&
            !(updates.visibleOnCreate ?? current.visibleOnCreate)
          )
            throw new Error("Um campo obrigatório deve aparecer no cadastro.");
          if (body.sortOrder !== undefined) {
            if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0 || body.sortOrder > 10000)
              throw new Error("Ordem inválida.");
            updates.sortOrder = body.sortOrder;
          }
          if (
            current.entityType === "deal" &&
            (body.allPipelines !== undefined || body.pipelineIds !== undefined)
          ) {
            const allPipelines =
              body.allPipelines !== undefined ? body.allPipelines === true : current.allPipelines;
            updates.allPipelines = allPipelines;
            if (allPipelines) updates.pipelineIds = [];
            else {
              const currentPids: string[] = Array.isArray(current.pipelineIds)
                ? current.pipelineIds
                : typeof (current as any).pipelineIds === "string"
                  ? (() => { try { const p = JSON.parse((current as any).pipelineIds); return Array.isArray(p) ? p : []; } catch { return []; } })()
                  : [];
              const ids = body.pipelineIds ?? currentPids;
              if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string"))
                throw new Error("Selecione ao menos um funil.");
              const pipelines = await db
                .select({ id: crmPipelines.id })
                .from(crmPipelines)
                .where(eq(crmPipelines.tenantId, session.tenantId));
              if (ids.some((id: string) => !pipelines.some((pipeline) => pipeline.id === id)))
                throw new Error("Funil inválido.");
              updates.pipelineIds = [...new Set(ids)];
            }
          }
          if (body.archive === true) updates.archivedAt = new Date();
          const [field] = await db
            .update(crmCustomFieldDefinitions)
            .set(updates)
            .where(
              and(
                eq(crmCustomFieldDefinitions.id, fieldId),
                eq(crmCustomFieldDefinitions.tenantId, session.tenantId),
              ),
            )
            .returning();
          if (body.archive === true && field && !current.archivedAt) {
            await recordCrmAction({ tenantId: session.tenantId,
              operatorId: session.operator.id, operatorName: session.operator.name,
              action: "delete_custom_field", entityType: current.entityType, itemCount: 1,
              details: { fieldId, name: current.name } });
          }
          return Response.json({ field });
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
