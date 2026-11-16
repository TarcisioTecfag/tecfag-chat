import { createFileRoute } from "@tanstack/react-router";
import {
  auditMarketingApiCall,
  jsonMarketingResponse,
  optionsMarketingResponse,
  requireMarketingApiAccess,
} from "../../../../lib/marketing/api-auth";
import {
  clampPageLimit,
  listMarketingMessages,
  parseBoolParam,
} from "../../../../lib/marketing/crm-reporting-service";

export const Route = createFileRoute("/api/v1/marketing/messages")({
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
            contactId: sp.get("contact_id") || sp.get("contactId"),
            senderType: sp.get("sender_type") || sp.get("senderType"),
            updatedSince: sp.get("updated_since") || sp.get("updatedSince"),
            sentFrom: sp.get("sent_from") || sp.get("created_from") || sp.get("sentFrom"),
            sentTo: sp.get("sent_to") || sp.get("created_to") || sp.get("sentTo"),
            includeContent: parseBoolParam(
              sp.get("include_content") ?? sp.get("includeContent"),
              false,
            ),
            includeInternalNotes: parseBoolParam(
              sp.get("include_internal_notes") ?? sp.get("includeInternalNotes"),
              false,
            ),
            limit: clampPageLimit(sp.get("limit"), 500, 1000),
            cursor: sp.get("cursor"),
          };

          const result = await listMarketingMessages(auth.tenantId, filters);

          await auditMarketingApiCall({
            auth,
            endpointName: "messages",
            endpointLabel: "Mensagens (Metadados)",
            queryArgs: Object.fromEntries(sp.entries()),
            returnedCount: result.items.length,
          });

          return jsonMarketingResponse(result);
        } catch (err: any) {
          await auditMarketingApiCall({
            auth,
            endpointName: "messages",
            endpointLabel: "Mensagens (Metadados)",
            queryArgs: {},
            returnedCount: 0,
            status: "error",
            errorMessage: err?.message,
          });
          return jsonMarketingResponse(
            { error: err?.message || "Erro ao listar mensagens.", code: "INTERNAL_ERROR" },
            500,
          );
        }
      },
    },
  },
});
