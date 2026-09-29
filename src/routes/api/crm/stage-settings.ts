import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { crmStages, crmStageSettings } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";

export const Route = createFileRoute("/api/crm/stage-settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const tenantId = auth.session.tenantId;
        const permissionError = requireCrmPermission(auth.session, "canViewCrm");
        if (permissionError) return permissionError;
        try {
          const settings = await db
            .select()
            .from(crmStageSettings)
            .where(eq(crmStageSettings.tenantId, tenantId));
          return Response.json({ settings });
        } catch (error) {
          console.error("[CRM Stage Settings] Falha ao listar:", error);
          return Response.json(
            { error: "Configurações de etapas indisponíveis." },
            { status: 503 },
          );
        }
      },
      PUT: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const tenantId = auth.session.tenantId;
        const permissionError = requireCrmPermission(auth.session, "canManagePipelines");
        if (permissionError) return permissionError;

        let input: Record<string, unknown>;
        try {
          const parsed: unknown = await request.json();
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("body");
          input = parsed as Record<string, unknown>;
        } catch {
          return Response.json({ error: "Dados inválidos." }, { status: 400 });
        }

        const stageId = typeof input.stageId === "string" ? input.stageId : "";
        const abbreviation =
          typeof input.abbreviation === "string" ? input.abbreviation.trim() : "";
        const objective = typeof input.objective === "string" ? input.objective.trim() : "";
        const description = typeof input.description === "string" ? input.description.trim() : "";
        const coolingEnabled = input.coolingEnabled;
        const coolingDays = input.coolingDays;
        if (
          !stageId ||
          abbreviation.length > 12 ||
          objective.length > 200 ||
          description.length > 1500 ||
          typeof coolingEnabled !== "boolean" ||
          typeof coolingDays !== "number" ||
          !Number.isInteger(coolingDays) ||
          coolingDays < 1 ||
          coolingDays > 365
        ) {
          return Response.json(
            { error: "Confira os campos da etapa e o prazo de 1 a 365 dias." },
            { status: 400 },
          );
        }

        try {
          const [stage] = await db
            .select({ id: crmStages.id })
            .from(crmStages)
            .where(and(eq(crmStages.id, stageId), eq(crmStages.tenantId, tenantId)))
            .limit(1);
          if (!stage) return Response.json({ error: "Etapa não encontrada." }, { status: 404 });

          const values = {
            abbreviation: abbreviation || null,
            objective: objective || null,
            description: description || null,
            coolingEnabled,
            coolingDays,
            updatedAt: new Date(),
          };
          const [existing] = await db
            .select({ stageId: crmStageSettings.stageId })
            .from(crmStageSettings)
            .where(
              and(eq(crmStageSettings.stageId, stageId), eq(crmStageSettings.tenantId, tenantId)),
            )
            .limit(1);
          const [settings] = existing
            ? await db
                .update(crmStageSettings)
                .set(values)
                .where(
                  and(
                    eq(crmStageSettings.stageId, stageId),
                    eq(crmStageSettings.tenantId, tenantId),
                  ),
                )
                .returning()
            : await db
                .insert(crmStageSettings)
                .values({ stageId, tenantId, ...values })
                .returning();
          return Response.json({ settings });
        } catch (error) {
          console.error("[CRM Stage Settings] Falha ao salvar:", error);
          return Response.json(
            { error: "Não foi possível salvar as configurações da etapa." },
            { status: 500 },
          );
        }
      },
    },
  },
});
