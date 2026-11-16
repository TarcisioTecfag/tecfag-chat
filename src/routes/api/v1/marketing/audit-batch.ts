import { createFileRoute } from "@tanstack/react-router";
import {
  auditMarketingApiCall,
  jsonMarketingResponse,
  optionsMarketingResponse,
  requireMarketingApiAccess,
} from "../../../../lib/marketing/api-auth";
import {
  clampPageLimit,
  getMarketingAuditBatch,
  parseBoolParam,
} from "../../../../lib/marketing/crm-reporting-service";

export const Route = createFileRoute("/api/v1/marketing/audit-batch")({
  server: {
    handlers: {
      OPTIONS: async () => optionsMarketingResponse(),

      GET: async ({ request }) => {
        const auth = await requireMarketingApiAccess(request);
        if ("response" in auth) return auth.response;

        try {
          const url = new URL(request.url);
          const sp = url.searchParams;

          const rawDealIds = sp.get("deal_ids") || sp.get("dealIds") || "";
          const dealIds = rawDealIds
            ? rawDealIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined;

          const filters = {
            dealIds,
            campaign: sp.get("campaign") || sp.get("campaign_name"),
            utmCampaign: sp.get("utm_campaign") || sp.get("utmCampaign"),
            source: sp.get("source") || sp.get("deal_source_name"),
            sectorOrigin: sp.get("sector_origin") || sp.get("sectorOrigin"),
            sectorCurrent: sp.get("sector_current") || sp.get("sectorCurrent") || sp.get("sector"),
            operatorId: sp.get("operator_id") || sp.get("user_id") || sp.get("operatorId"),
            pipelineId: sp.get("pipeline_id") || sp.get("pipelineId"),
            status: sp.get("status"),
            createdFrom: sp.get("created_from") || sp.get("createdFrom"),
            createdTo: sp.get("created_to") || sp.get("createdTo"),
            includeTests: parseBoolParam(sp.get("include_tests") ?? sp.get("includeTests"), false),
            maxMessagesPerConversation: clampPageLimit(
              sp.get("max_messages") || sp.get("maxMessages"),
              80,
              200,
            ),
            limit: clampPageLimit(sp.get("limit"), 20, 50),
          };

          const result = await getMarketingAuditBatch(auth.tenantId, filters);

          await auditMarketingApiCall({
            auth,
            endpointName: "audit_batch",
            endpointLabel: "Auditoria em Lote (15–50 Leads)",
            queryArgs: Object.fromEntries(sp.entries()),
            returnedCount: result.items.length,
          });

          return jsonMarketingResponse(result);
        } catch (err: any) {
          await auditMarketingApiCall({
            auth,
            endpointName: "audit_batch",
            endpointLabel: "Auditoria em Lote (15–50 Leads)",
            queryArgs: {},
            returnedCount: 0,
            status: "error",
            errorMessage: err?.message,
          });
          return jsonMarketingResponse(
            { error: err?.message || "Erro ao gerar lote de auditoria.", code: "INTERNAL_ERROR" },
            500,
          );
        }
      },
    },
  },
});
