import { createFileRoute } from "@tanstack/react-router";
import {
  auditMarketingApiCall,
  jsonMarketingResponse,
  optionsMarketingResponse,
  requireMarketingApiAccess,
} from "../../../../lib/marketing/api-auth";
import {
  clampPageLimit,
  listMarketingActivities,
  parseBoolParam,
} from "../../../../lib/marketing/crm-reporting-service";

export const Route = createFileRoute("/api/v1/marketing/activities")({
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
            operatorId: sp.get("operator_id") || sp.get("user_id") || sp.get("operatorId"),
            type: sp.get("type"),
            status: sp.get("status"),
            updatedSince: sp.get("updated_since") || sp.get("updatedSince"),
            createdFrom: sp.get("created_from") || sp.get("createdFrom"),
            createdTo: sp.get("created_to") || sp.get("createdTo"),
            dueFrom: sp.get("due_from") || sp.get("dueFrom"),
            dueTo: sp.get("due_to") || sp.get("dueTo"),
            includeTests: parseBoolParam(sp.get("include_tests") ?? sp.get("includeTests"), false),
            limit: clampPageLimit(sp.get("limit"), 250, 1000),
            cursor: sp.get("cursor"),
          };

          const result = await listMarketingActivities(auth.tenantId, filters);

          await auditMarketingApiCall({
            auth,
            endpointName: "activities",
            endpointLabel: "Atividades Comerciais",
            queryArgs: Object.fromEntries(sp.entries()),
            returnedCount: result.items.length,
          });

          return jsonMarketingResponse(result);
        } catch (err: any) {
          await auditMarketingApiCall({
            auth,
            endpointName: "activities",
            endpointLabel: "Atividades Comerciais",
            queryArgs: {},
            returnedCount: 0,
            status: "error",
            errorMessage: err?.message,
          });
          return jsonMarketingResponse(
            { error: err?.message || "Erro ao listar atividades.", code: "INTERNAL_ERROR" },
            500,
          );
        }
      },
    },
  },
});
