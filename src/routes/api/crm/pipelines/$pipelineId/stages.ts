import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/pipelines/$pipelineId/stages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * POST /api/crm/pipelines/:pipelineId/stages
       * Cria uma nova etapa para o funil.
       * Exige canManagePipelines.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canManagePipelines");
          if (permError) return permError;

          const { pipelineId } = params as unknown as { pipelineId: string };
          const body = await request.json().catch(() => ({}));

          if (!body.name || !body.name.trim()) {
            return new Response(
              JSON.stringify({ error: "O nome da etapa é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const created = await crmService.createStage(tenantId, pipelineId, {
            name: body.name,
            orderIndex: body.orderIndex,
            isWinStage: body.isWinStage,
            isLossStage: body.isLossStage,
            requiredFields: body.requiredFields,
          });

          return new Response(JSON.stringify({ stage: created }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Pipeline Stages API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * PATCH /api/crm/pipelines/:pipelineId/stages
       * Reordena as etapas do funil de forma atômica.
       * Exige canManagePipelines.
       */
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canManagePipelines");
          if (permError) return permError;

          const { pipelineId } = params as unknown as { pipelineId: string };
          const body = await request.json().catch(() => ({}));

          if (!Array.isArray(body.stageOrders)) {
            return new Response(
              JSON.stringify({ error: "stageOrders deve ser um array com id e orderIndex.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const stages = await crmService.reorderStages(tenantId, pipelineId, body.stageOrders);

          return new Response(JSON.stringify({ stages }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Pipeline Stages API] Erro no PATCH:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
