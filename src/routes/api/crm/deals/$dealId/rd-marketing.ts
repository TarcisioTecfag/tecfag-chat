import { requireCrmDealAccess } from "../../../../../lib/access-control/crm-record-access";
import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { dealRdJourney } from "../../../../../lib/rd-marketing/journey";
import { integrationError } from "../../../../../lib/rd-marketing/http";
import { CrmError } from "../../../../../lib/crm/crm-service";

export const Route = createFileRoute("/api/crm/deals/$dealId/rd-marketing")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const recordDenied = await requireCrmDealAccess(session, (params as { dealId: string }).dealId);
        if (recordDenied) return recordDenied;
        const denied = requireCrmPermission(session, "canViewCrm");
        if (denied) return denied;
        try {
          const url = new URL(request.url);
          const eventType = url.searchParams.get("eventType");
          if (eventType && !["CONVERSION", "OPPORTUNITY"].includes(eventType))
            throw new CrmError("Tipo de evento inválido.", "BAD_REQUEST");
          const data = await dealRdJourney(
            tenantId,
            params.dealId,
            {
              operatorId: session.operator.id,
              canViewAll:
                session.operator.role === "admin" || !!session.permissions?.crm?.canViewAllDeals,
            },
            {
              contactId: url.searchParams.get("contactId") || undefined,
              eventType: eventType as "CONVERSION" | "OPPORTUNITY" | undefined,
              page: eventType ? Number(url.searchParams.get("page")) : undefined,
              snapshotId: url.searchParams.get("snapshotId") || undefined,
              refresh: url.searchParams.get("refresh") === "true",
            },
          );
          return Response.json(data, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          return integrationError(error);
        }
      },
    },
  },
});
