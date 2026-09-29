import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../../../db";
import { contacts } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";

export const Route = createFileRoute("/api/crm/contacts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const permissionError = requireCrmPermission(session, "canViewCrm");
        if (permissionError) return permissionError;

        const search = new URL(request.url).searchParams.get("search")?.trim().slice(0, 100) || "";
        if (search.length < 2) {
          return Response.json({ contacts: [] });
        }

        const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
        const results = await db
          .select({
            id: contacts.id,
            name: contacts.name,
            phone: contacts.phone,
            email: contacts.email,
            accountId: contacts.accountId,
          })
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, tenantId),
              or(
                ilike(contacts.name, pattern),
                ilike(contacts.phone, pattern),
                ilike(contacts.email, pattern),
              ),
            ),
          )
          .orderBy(desc(contacts.createdAt))
          .limit(10);

        return Response.json({ contacts: results });
      },
    },
  },
});
