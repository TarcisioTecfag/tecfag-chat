import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import {
  canSendDealToTarget,
  getAllowedPipelineIds,
  getVisibleStageIdsForPipeline,
  requireCrmPermission,
} from "../../../lib/rbac";
import { crmService, handleCrmError } from "../../../lib/crm/crm-service";
import { handleConditionalResponse } from "../../../lib/http-cache";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/pipelines")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/pipelines
       * Lista os funis de vendas com suas etapas ordenadas para o tenant ativo.
       * Respeita o escopo de funis do grupo do operador (`pipelineScope` / `allowedPipelineIds`),
       * exceto quando consultado pelo painel administrativo de grupos (`?forPermissions=true`).
       */
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const url = new URL(request.url);
          const forPermissions =
            url.searchParams.get("forPermissions") === "true" ||
            url.searchParams.get("scope") === "admin";
          const canManageGroupsOrPipelines =
            session.operator.role === "admin" ||
            Boolean(session.permissions?.security?.canManageAccessGroups) ||
            Boolean(session.permissions?.crm?.canManagePipelines);

          if (!forPermissions || !canManageGroupsOrPipelines) {
            const permError = requireCrmPermission(session, "canViewCrm");
            if (permError) return permError;
          }

          const allPipelines = await crmService.getPipelines(tenantId);
          const bypassRestrictions = forPermissions && canManageGroupsOrPipelines;
          const allowedPipelineIds = bypassRestrictions ? null : getAllowedPipelineIds(session);
          const visiblePipelines =
            allowedPipelineIds === null
              ? allPipelines
              : allPipelines.filter((p) => allowedPipelineIds.includes(p.id));

          const pipelines = bypassRestrictions
            ? visiblePipelines
            : visiblePipelines.map((p) => {
                const visibleStageIds = getVisibleStageIdsForPipeline(session, p.id);
                if (visibleStageIds === null) {
                  return p;
                }
                const allStagesWithVisibility = (p.stages || []).map((s: any) => ({
                  ...s,
                  isVisible: visibleStageIds.includes(s.id),
                }));
                const filteredStages = (p.stages || []).filter((s: any) => visibleStageIds.includes(s.id));
                return {
                  ...p,
                  stages: filteredStages,
                  allStages: allStagesWithVisibility,
                  hasHiddenStages: filteredStages.length < (p.stages || []).length,
                };
              });

          const transferPipelines =
            !bypassRestrictions && session.permissions?.crm?.canSendToHiddenStagesOrPipelines === true
              ? allPipelines
                  .filter((p) => !visiblePipelines.some((vp) => vp.id === p.id) && canSendDealToTarget(session, p.id))
                  .map((p) => ({
                    ...p,
                    isVisible: false,
                    allStages: (p.stages || []).map((s: any) => ({ ...s, isVisible: false })),
                  }))
              : undefined;

          return handleConditionalResponse(
            request,
            transferPipelines && transferPipelines.length > 0
              ? { pipelines, transferPipelines }
              : { pipelines },
            { headers: corsHeaders }
          );
        } catch (err: any) {
          console.error("[CRM Pipelines API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * POST /api/crm/pipelines
       * Cria um novo funil ou inicializa o funil padrão (ação administrativa explícita).
       * Exige canManagePipelines.
       */
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canManagePipelines");
          if (permError) return permError;

          const body = await request.json().catch(() => ({}));

          // Ação administrativa explícita de inicializar funil comercial padrão
          if (body.action === "init-default") {
            const pipeline = await crmService.initDefaultPipeline(tenantId, session.operator.id);
            return new Response(JSON.stringify({ pipeline }), {
              status: 201,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (!body.name || !body.name.trim()) {
            return new Response(
              JSON.stringify({ error: "O nome do funil é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const created = await crmService.createPipeline(tenantId, {
            name: body.name,
            orderIndex: body.orderIndex,
            isDefault: body.isDefault,
            color: body.color,
            coolingDays: body.coolingDays,
            stages: body.stages,
          });

          return new Response(JSON.stringify({ pipeline: created }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Pipelines API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
