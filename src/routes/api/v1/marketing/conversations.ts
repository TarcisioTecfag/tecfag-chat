import { createFileRoute } from "@tanstack/react-router";
import {
  auditMarketingApiCall,
  jsonMarketingResponse,
  optionsMarketingResponse,
  requireMarketingApiAccess,
} from "../../../../lib/marketing/api-auth";
import {
  clampPageLimit,
  listMarketingConversations,
  parseBoolParam,
} from "../../../../lib/marketing/crm-reporting-service";

export const Route = createFileRoute("/api/v1/marketing/conversations")({
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
            id: sp.get("id") || sp.get("conversation_id"),
            contactId: sp.get("contact_id") || sp.get("contactId"),
            operatorId: sp.get("operator_id") || sp.get("user_id") || sp.get("operatorId"),
            sectorId: sp.get("sector_id") || sp.get("sectorId"),
            queueState: sp.get("queue_state") || sp.get("queueState"),
            updatedSince: sp.get("updated_since") || sp.get("updatedSince"),
            createdFrom: sp.get("created_from") || sp.get("createdFrom"),
            createdTo: sp.get("created_to") || sp.get("createdTo"),
            includeTests: parseBoolParam(sp.get("include_tests") ?? sp.get("includeTests"), false),
            limit: clampPageLimit(sp.get("limit"), 200, 1000),
            cursor: sp.get("cursor"),
          };

          const result = await listMarketingConversations(auth.tenantId, filters);

          await auditMarketingApiCall({
            auth,
            endpointName: "conversations",
            endpointLabel: "Conversas & SLA",
            queryArgs: Object.fromEntries(sp.entries()),
            returnedCount: result.items.length,
          });

          return jsonMarketingResponse(result);
        } catch (err: any) {
          await auditMarketingApiCall({
            auth,
            endpointName: "conversations",
            endpointLabel: "Conversas & SLA",
            queryArgs: {},
            returnedCount: 0,
            status: "error",
            errorMessage: err?.message,
          });
          return jsonMarketingResponse(
            { error: err?.message || "Erro ao listar conversas.", code: "INTERNAL_ERROR" },
            500,
          );
        }
      },
    },
  },
});
