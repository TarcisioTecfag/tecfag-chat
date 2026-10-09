import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../../db";
import { crmDeals } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import { handleConditionalResponse } from "../../../lib/http-cache";

export const Route = createFileRoute("/api/crm/deal-filter-options")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const denied = requireCrmPermission(session, "canViewCrm");
        if (denied) return denied;

        const ownDealsOnly =
          session.operator.role !== "admin" && !session.permissions?.crm?.canViewAllDeals;
        const scope = ownDealsOnly ? eq(crmDeals.operatorId, session.operator.id) : undefined;
        const [sources, campaigns] = await Promise.all([
          db
            .selectDistinct({ value: crmDeals.source })
            .from(crmDeals)
            .where(and(eq(crmDeals.tenantId, tenantId), scope, isNotNull(crmDeals.source))),
          db
            .selectDistinct({ value: crmDeals.campaign })
            .from(crmDeals)
            .where(and(eq(crmDeals.tenantId, tenantId), scope, isNotNull(crmDeals.campaign))),
        ]);
        return handleConditionalResponse(request, {
          sources: sources.map((item) => item.value?.trim()).filter(Boolean),
          campaigns: campaigns.map((item) => item.value?.trim()).filter(Boolean),
        });
      },
    },
  },
});
