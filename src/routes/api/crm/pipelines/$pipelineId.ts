import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../lib/crm/crm-service";
import { recordCrmAction } from "../../../../lib/crm/action-history";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/pipelines/$pipelineId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/pipelines/:pipelineId
       * Retorna um funil específico com suas etapas ordenadas.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { pipelineId } = params as unknown as { pipelineId: string };
          const pipeline = await crmService.getPipelineById(tenantId, pipelineId);

          return new Response(JSON.stringify({ pipeline }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Pipeline API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * PATCH /api/crm/pipelines/:pipelineId
       * Atualiza configurações de um funil de vendas.
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

          const updated = await crmService.updatePipeline(tenantId, pipelineId, {
            name: body.name,
            orderIndex: body.orderIndex,
            isDefault: body.isDefault,
            color: body.color,
            coolingDays: body.coolingDays,
          });

          return new Response(JSON.stringify({ pipeline: updated }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Pipeline API] Erro no PATCH:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/pipelines/:pipelineId
       * Exclui um funil. Rejeita se houver negociações associadas.
       * Exige canManagePipelines.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canManagePipelines");
          if (permError) return permError;

          const { pipelineId } = params as unknown as { pipelineId: string };
          const pipeline = await crmService.getPipelineById(tenantId, pipelineId);
          const result = await crmService.deletePipeline(tenantId, pipelineId);
          await recordCrmAction({ tenantId, operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_pipeline", entityType: "pipeline", itemCount: 1,
            details: { pipelineId, name: pipeline.name } });

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Pipeline API] Erro no DELETE:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
