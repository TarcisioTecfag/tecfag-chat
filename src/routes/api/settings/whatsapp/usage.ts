import { createFileRoute } from "@tanstack/react-router";
import { and, eq, gte } from "drizzle-orm";
import { db } from "../../../../db";
import { messages } from "../../../../db/schema";
import { requireSession } from "../../../../lib/auth-session";

export const Route = createFileRoute("/api/settings/whatsapp/usage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin") {
          return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
        }

        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const rows = await db.select({ status: messages.status, pricing: messages.metaPricing })
          .from(messages)
          .where(and(
            eq(messages.tenantId, session.tenantId),
            eq(messages.provider, "meta"),
            eq(messages.direction, "outbound"),
            gte(messages.sentAt, monthStart)
          ));

        const totals = { sent: rows.length, delivered: 0, serviceFree: 0, serviceBillable: 0, serviceUnclassified: 0, otherCategories: 0 };
        for (const row of rows) {
          if (row.status !== "delivered" && row.status !== "read") continue;
          totals.delivered++;
          const pricing = row.pricing || {};
          const category = String(pricing.category || "").toLowerCase();
          const type = String(pricing.type || "").toLowerCase();
          if (category === "service") {
            if (type === "free_customer_service" || pricing.billable === false) totals.serviceFree++;
            else if (type === "regular" || pricing.billable === true) totals.serviceBillable++;
            else totals.serviceUnclassified++;
          } else if (category) totals.otherCategories++;
          else totals.serviceUnclassified++;
        }

        return Response.json({ monthStart: monthStart.toISOString(), timezone: "UTC", ...totals });
      },
    },
  },
});
