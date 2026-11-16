import { createFileRoute } from "@tanstack/react-router";
import {
  auditMarketingApiCall,
  jsonMarketingResponse,
  optionsMarketingResponse,
  requireMarketingApiAccess,
} from "../../../../lib/marketing/api-auth";
import {
  clampPageLimit,
  listMarketingTriages,
  parseBoolParam,
} from "../../../../lib/marketing/crm-reporting-service";

export const Route = createFileRoute("/api/v1/marketing/triages")({
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
            conversationId: sp.get("conversation_id") || sp.get("conversationId"),
            outcome: sp.get("outcome"),
            updatedSince: sp.get("updated_since") || sp.get("updatedSince"),
            startedFrom: sp.get("started_from") || sp.get("created_from") || sp.get("startedFrom"),
            startedTo: sp.get("started_to") || sp.get("created_to") || sp.get("startedTo"),
            includeTests: parseBoolParam(sp.get("include_tests") ?? sp.get("includeTests"), false),
            limit: clampPageLimit(sp.get("limit"), 200, 1000),
            cursor: sp.get("cursor"),
          };

          const result = await listMarketingTriages(auth.tenantId, filters);

          await auditMarketingApiCall({
            auth,
            endpointName: "triages",
            endpointLabel: "Triagens do Bot (SDR)",
            queryArgs: Object.fromEntries(sp.entries()),
            returnedCount: result.items.length,
          });

          return jsonMarketingResponse(result);
        } catch (err: any) {
          await auditMarketingApiCall({
            auth,
            endpointName: "triages",
            endpointLabel: "Triagens do Bot (SDR)",
            queryArgs: {},
            returnedCount: 0,
            status: "error",
            errorMessage: err?.message,
          });
          return jsonMarketingResponse(
            { error: err?.message || "Erro ao listar triagens.", code: "INTERNAL_ERROR" },
            500,
          );
        }
      },
    },
  },
});
