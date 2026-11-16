import { createFileRoute } from "@tanstack/react-router";
import {
  auditMarketingApiCall,
  jsonMarketingResponse,
  optionsMarketingResponse,
  requireMarketingApiAccess,
} from "../../../../lib/marketing/api-auth";
import { listMarketingGoals } from "../../../../lib/marketing/crm-reporting-service";

export const Route = createFileRoute("/api/v1/marketing/goals")({
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
            month: sp.get("month"),
            division: sp.get("division") || sp.get("sector"),
            operatorId: sp.get("operator_id") || sp.get("user_id") || sp.get("operatorId"),
          };

          const result = await listMarketingGoals(auth.tenantId, filters);

          await auditMarketingApiCall({
            auth,
            endpointName: "goals",
            endpointLabel: "Metas por Consultor",
            queryArgs: Object.fromEntries(sp.entries()),
            returnedCount: result.items.length,
          });

          return jsonMarketingResponse(result);
        } catch (err: any) {
          await auditMarketingApiCall({
            auth,
            endpointName: "goals",
            endpointLabel: "Metas por Consultor",
            queryArgs: {},
            returnedCount: 0,
            status: "error",
            errorMessage: err?.message,
          });
          return jsonMarketingResponse(
            { error: err?.message || "Erro ao listar metas.", code: "INTERNAL_ERROR" },
            500,
          );
        }
      },
    },
  },
});
