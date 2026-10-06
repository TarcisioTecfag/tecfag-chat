import { createFileRoute } from "@tanstack/react-router";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../../../db";
import { crmAccounts } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";

export const Route = createFileRoute("/api/contacts/account-options")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin" &&
            !session.permissions?.contacts?.canCreateContact &&
            !session.permissions?.contacts?.canEditContact &&
            !session.permissions?.chat?.canEditClientInfo &&
            !session.permissions?.crm?.canViewCrm) {
          return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        }
        const tenantId = session.tenantId;
        const url = new URL(request.url);
        const id = url.searchParams.get("id")?.trim();
        const fields = {
          id: crmAccounts.id, tenantId: crmAccounts.tenantId, type: crmAccounts.type,
          name: crmAccounts.name, tradeName: crmAccounts.tradeName,
          document: crmAccounts.document, documentType: crmAccounts.documentType,
        };
        if (id) {
          const [account] = await db.select(fields).from(crmAccounts)
            .where(and(eq(crmAccounts.tenantId, tenantId), eq(crmAccounts.id, id), sql`${crmAccounts.archivedAt} IS NULL`)).limit(1);
          return account ? Response.json({ account }) : Response.json({ error: "Empresa não encontrada." }, { status: 404 });
        }
        const search = url.searchParams.get("search")?.trim().slice(0, 100) || "";
        if (search.length < 2) return Response.json({ accounts: [] });
        const escaped = search.replace(/[\\%_]/g, "\\$&");
        const digits = search.replace(/\D/g, "");
        const accounts = await db.select(fields).from(crmAccounts).where(and(
          eq(crmAccounts.tenantId, tenantId), sql`${crmAccounts.archivedAt} IS NULL`,
          or(ilike(crmAccounts.name, `%${escaped}%`), ilike(crmAccounts.tradeName, `%${escaped}%`),
            digits.length >= 4 ? sql`regexp_replace(coalesce(${crmAccounts.document}, ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}` : undefined),
        )).limit(8);
        return Response.json({ accounts });
      },
    },
  },
});
