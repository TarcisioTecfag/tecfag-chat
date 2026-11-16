import { createFileRoute } from "@tanstack/react-router";
import {
  auditMarketingApiCall,
  jsonMarketingResponse,
  optionsMarketingResponse,
  requireMarketingApiAccess,
} from "../../../../lib/marketing/api-auth";
import {
  clampPageLimit,
  listMarketingDeals,
  parseBoolParam,
} from "../../../../lib/marketing/crm-reporting-service";

export const Route = createFileRoute("/api/v1/marketing/deals")({
  server: {
    handlers: {
      OPTIONS: async () => optionsMarketingResponse(),

      GET: async ({ request }) => {
        const auth = await requireMarketingApiAccess(request);
        if ("response" in auth) return auth.response;

        try {
          const url = new URL(request.url);
          const sp = url.searchParams;
          const winRaw = sp.get("win");
          const winFilter =
            winRaw === null || winRaw === ""
              ? null
              : parseBoolParam(winRaw, false);

          const filters = {
            id: sp.get("id") || sp.get("deal_id"),
            idRd: sp.get("id_rd") || sp.get("rd_deal_id"),
            pipelineId: sp.get("pipeline_id") || sp.get("pipelineId"),
            stageId: sp.get("stage_id") || sp.get("stageId"),
            operatorId: sp.get("operator_id") || sp.get("user_id") || sp.get("operatorId"),
            status: sp.get("status"),
            win: winFilter,
            sectorOrigin: sp.get("sector_origin") || sp.get("sectorOrigin"),
            sectorCurrent: sp.get("sector_current") || sp.get("sectorCurrent") || sp.get("sector"),
            source: sp.get("source") || sp.get("deal_source_name"),
            campaign: sp.get("campaign") || sp.get("campaign_name"),
            utmCampaign: sp.get("utm_campaign") || sp.get("utmCampaign"),
            query: sp.get("q") || sp.get("query"),
            createdFrom: sp.get("created_from") || sp.get("createdFrom"),
            createdTo: sp.get("created_to") || sp.get("createdTo"),
            wonFrom: sp.get("won_from") || sp.get("win_from") || sp.get("wonFrom"),
            wonTo: sp.get("won_to") || sp.get("win_to") || sp.get("wonTo"),
            lostFrom: sp.get("lost_from") || sp.get("lostFrom"),
            lostTo: sp.get("lost_to") || sp.get("lostTo"),
            updatedSince: sp.get("updated_since") || sp.get("updatedSince"),
            includeTests: parseBoolParam(sp.get("include_tests") ?? sp.get("includeTests"), false),
            includeLegacy: parseBoolParam(sp.get("include_legacy") ?? sp.get("includeLegacy"), true),
            order: (sp.get("order") === "desc" ? "desc" : "asc") as "asc" | "desc",
            limit: clampPageLimit(sp.get("limit"), 200, 1000),
            cursor: sp.get("cursor"),
          };

          const result = await listMarketingDeals(auth.tenantId, filters);

          await auditMarketingApiCall({
            auth,
            endpointName: "deals",
            endpointLabel: "Negociações (Deals)",
            queryArgs: Object.fromEntries(sp.entries()),
            returnedCount: result.items.length,
          });

          return jsonMarketingResponse(result);
        } catch (err: any) {
          await auditMarketingApiCall({
            auth,
            endpointName: "deals",
            endpointLabel: "Negociações (Deals)",
            queryArgs: {},
            returnedCount: 0,
            status: "error",
            errorMessage: err?.message,
          });
          return jsonMarketingResponse(
            { error: err?.message || "Erro ao listar negociações.", code: "INTERNAL_ERROR" },
            500,
          );
        }
      },
    },
  },
});
