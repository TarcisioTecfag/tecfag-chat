import { createFileRoute } from "@tanstack/react-router";
import {
  auditMarketingApiCall,
  jsonMarketingResponse,
  optionsMarketingResponse,
  requireMarketingApiAccess,
} from "../../../../lib/marketing/api-auth";
import {
  clampPageLimit,
  listMarketingStageHistory,
  parseBoolParam,
} from "../../../../lib/marketing/crm-reporting-service";

export const Route = createFileRoute("/api/v1/marketing/deal-stage-history")({
  server: {
    handlers: {
      OPTIONS: async () => optionsMarketingResponse(),

      GET: async ({ request }) => {
        const auth = await requireMarketingApiAccess(request);
        if ("response" in auth) return auth.response;

        try {
          const url = new URL(request.url);
          const sp = url.searchParams;

          const filters = {
            dealId: sp.get("deal_id") || sp.get("dealId"),
            pipelineId: sp.get("pipeline_id") || sp.get("pipelineId"),
            sectorOrigin: sp.get("sector_origin") || sp.get("sectorOrigin"),
            sectorCurrent: sp.get("sector_current") || sp.get("sectorCurrent") || sp.get("sector"),
            updatedSince: sp.get("updated_since") || sp.get("updatedSince"),
            createdFrom: sp.get("created_from") || sp.get("createdFrom"),
            createdTo: sp.get("created_to") || sp.get("createdTo"),
            includeTests: parseBoolParam(sp.get("include_tests") ?? sp.get("includeTests"), false),
            includeLegacy: parseBoolParam(sp.get("include_legacy") ?? sp.get("includeLegacy"), true),
            limit: clampPageLimit(sp.get("limit"), 250, 1000),
            cursor: sp.get("cursor"),
          };

          const result = await listMarketingStageHistory(auth.tenantId, filters);

          await auditMarketingApiCall({
            auth,
            endpointName: "deal_stage_history",
            endpointLabel: "Histórico de Etapas",
            queryArgs: Object.fromEntries(sp.entries()),
            returnedCount: result.items.length,
          });

          return jsonMarketingResponse(result);
        } catch (err: any) {
          await auditMarketingApiCall({
            auth,
            endpointName: "deal_stage_history",
            endpointLabel: "Histórico de Etapas",
            queryArgs: {},
            returnedCount: 0,
            status: "error",
            errorMessage: err?.message,
          });
          return jsonMarketingResponse(
            { error: err?.message || "Erro ao listar histórico de etapas.", code: "INTERNAL_ERROR" },
            500,
          );
        }
      },
    },
  },
});
