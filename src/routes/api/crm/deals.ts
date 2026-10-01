import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import { crmService, handleCrmError } from "../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals
       * Lista negociações paginadas com filtros por funil, etapa, status, vendedor e busca.
       * Exige permissão canViewCrm. Se não tiver canViewAllDeals, restringe aos próprios negócios.
       */
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const url = new URL(request.url);
          const pipelineId = url.searchParams.get("pipelineId") || undefined;
          const stageId = url.searchParams.get("stageId") || undefined;
          const stageIdsParam = url.searchParams.get("stageIds");
          const stageIds = stageIdsParam ? stageIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
          const status = (url.searchParams.get("status") as any) || undefined;
          const accountId = url.searchParams.get("accountId") || undefined;
          const search = url.searchParams.get("search") || undefined;
          const sortBy = url.searchParams.get("sortBy") || undefined;
          const limit = parseInt(url.searchParams.get("limit") || "50", 10);
          const offset = parseInt(url.searchParams.get("offset") || "0", 10);
          const perStageLimitRaw = url.searchParams.get("perStageLimit");
          const perStageLimit = perStageLimitRaw ? parseInt(perStageLimitRaw, 10) : undefined;

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

          // Restrição de escopo e multi-vendedor
          let operatorIds: string[] | undefined = undefined;
          let operatorId = url.searchParams.get("operatorId") || undefined;

          if (session.operator.role !== "admin" && !session.permissions?.crm?.canViewAllDeals) {
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

          const result = await crmService.getDeals(tenantId, {
            pipelineId,
            stageId,
            stageIds,
            status,
            operatorId,
            operatorIds,
            accountId,
            search,
            sortBy,
            minValue,
            maxValue,
            createdAfter,
            createdBefore,
            hasOverdueTask: hasOverdueTask || undefined,
            coolingOnly: coolingOnly || undefined,
            coolingDays,
            limit,
            offset,
            perStageLimit,
          });

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deals API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * POST /api/crm/deals
       * Cria uma nova negociação comercial com auditoria e vínculo opcional.
       * Exige permissão canCreateDeals.
       */
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canCreateDeals");
          if (permError) return permError;

          const body = await request.json();

          const targetOperatorId = body.operatorId !== undefined ? body.operatorId : (body.ownerId !== undefined ? body.ownerId : session.operator.id);

          const deal = await crmService.createDeal(tenantId, session.operator.id, {
            title: body.title,
            pipelineId: body.pipelineId,
            stageId: body.stageId,
            accountId: body.accountId,
            account: body.account,
            value: body.value,
            currency: body.currency,
            expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
            operatorId: targetOperatorId,
            source: body.source,
            campaign: body.campaign,
            rating: body.rating,
            contactId: body.contactId,
            conversationId: body.conversationId,
            initialNote: body.initialNote,
            customFields: body.customFields,
          });

          return new Response(JSON.stringify({ deal }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deals API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
