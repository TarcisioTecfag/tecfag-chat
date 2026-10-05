import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError, parseExtraDealFilters } from "../../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/pipelines/$pipelineId/stages-summary")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/pipelines/:pipelineId/stages-summary
       * Retorna contagem real distinta e soma de valores monetários por etapa do funil.
       * Agregação realizada puramente no banco de dados sem distorções por N:N de contatos/conversas.
       * Exige canViewCrm e respeita canViewAllDeals.
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
          const url = new URL(request.url);

          const status = url.searchParams.get("status") as any;
          const accountId = url.searchParams.get("accountId") || undefined;
          const search = url.searchParams.get("search") || undefined;

          const minValueRaw = url.searchParams.get("minValue");
          const minValue = minValueRaw !== null && minValueRaw !== "" ? parseFloat(minValueRaw) : undefined;

          const maxValueRaw = url.searchParams.get("maxValue");
          const maxValue = maxValueRaw !== null && maxValueRaw !== "" ? parseFloat(maxValueRaw) : undefined;

          const createdAfter = url.searchParams.get("createdAfter") || undefined;
          const createdBefore = url.searchParams.get("createdBefore") || undefined;
          const hasOverdueTask = url.searchParams.get("hasOverdueTask") === "true";
          const coolingOnly = url.searchParams.get("coolingOnly") === "true";
          const coolingDaysRaw = url.searchParams.get("coolingDays");
          const coolingDays = coolingDaysRaw ? parseInt(coolingDaysRaw, 10) : undefined;

          // Se operador não tiver permissão para ver todos os negócios, restringe automaticamente aos dele
          let operatorIds: string[] | undefined = undefined;
          let operatorId = url.searchParams.get("operatorId") || undefined;

          if (
            session.operator.role !== "admin" &&
            !session.permissions?.crm?.canViewAllDeals
          ) {
            operatorIds = [session.operator.id];
            operatorId = session.operator.id;
          } else {
            const rawOperatorIds = url.searchParams.get("operatorIds");
            if (rawOperatorIds) {
              operatorIds = rawOperatorIds.split(",").map((s) => s.trim()).filter(Boolean);
            } else {
              const multi = url.searchParams.getAll("operatorId");
              if (multi.length > 1) {
                operatorIds = multi;
              }
            }
          }

          const summary = await crmService.getPipelineStagesSummary(tenantId, pipelineId, {
            ...parseExtraDealFilters(url.searchParams),
            status: status || undefined,
            operatorId,
            operatorIds,
            accountId,
            search,
            minValue,
            maxValue,
            createdAfter,
            createdBefore,
            hasOverdueTask: hasOverdueTask || undefined,
            coolingOnly: coolingOnly || undefined,
            coolingDays,
          });

          return new Response(JSON.stringify(summary), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Stages Summary API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
