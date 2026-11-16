import { createFileRoute } from "@tanstack/react-router";
import {
  auditMarketingApiCall,
  jsonMarketingResponse,
  optionsMarketingResponse,
  requireMarketingApiAccess,
} from "../../../../lib/marketing/api-auth";
import {
  clampPageLimit,
  listMarketingContacts,
  parseBoolParam,
} from "../../../../lib/marketing/crm-reporting-service";

export const Route = createFileRoute("/api/v1/marketing/contacts")({
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
            id: sp.get("id") || sp.get("contact_id"),
            email: sp.get("email"),
            phone: sp.get("phone"),
            document: sp.get("document") || sp.get("cnpj") || sp.get("cpf"),
            sectorOrigin: sp.get("sector_origin") || sp.get("sectorOrigin") || sp.get("sector"),
            query: sp.get("q") || sp.get("query"),
            updatedSince: sp.get("updated_since") || sp.get("updatedSince"),
            createdFrom: sp.get("created_from") || sp.get("createdFrom"),
            createdTo: sp.get("created_to") || sp.get("createdTo"),
            includeTests: parseBoolParam(sp.get("include_tests") ?? sp.get("includeTests"), false),
            includeLegacy: parseBoolParam(sp.get("include_legacy") ?? sp.get("includeLegacy"), true),
            limit: clampPageLimit(sp.get("limit"), 200, 1000),
            cursor: sp.get("cursor"),
          };

          const result = await listMarketingContacts(auth.tenantId, filters);

          await auditMarketingApiCall({
            auth,
            endpointName: "contacts",
            endpointLabel: "Contatos (Leads)",
            queryArgs: Object.fromEntries(sp.entries()),
            returnedCount: result.items.length,
          });

          return jsonMarketingResponse(result);
        } catch (err: any) {
          await auditMarketingApiCall({
            auth,
            endpointName: "contacts",
            endpointLabel: "Contatos (Leads)",
            queryArgs: {},
            returnedCount: 0,
            status: "error",
            errorMessage: err?.message,
          });
          return jsonMarketingResponse(
            { error: err?.message || "Erro ao listar contatos.", code: "INTERNAL_ERROR" },
            500,
          );
        }
      },
    },
  },
});
