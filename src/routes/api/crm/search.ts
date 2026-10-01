import { createFileRoute } from "@tanstack/react-router";
import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "../../../db";
import { contacts, crmAccounts, crmDeals, crmPipelines, crmStages } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";

const PAGE_SIZE = 8;
const MORE_PAGE_SIZE = 20;

export const Route = createFileRoute("/api/crm/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const permissionError = requireCrmPermission(session, "canViewCrm");
        if (permissionError) return permissionError;

        const url = new URL(request.url);
        const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
        const category = url.searchParams.get("category");
        if (category && !["deals", "companies", "contacts"].includes(category)) {
          return Response.json({ error: "Categoria inválida." }, { status: 400 });
        }
        if (query.length < 2) {
          return Response.json({
            deals: { items: [], total: 0 },
            companies: { items: [], total: 0 },
            contacts: { items: [], total: 0 },
          });
        }

        const rawOffset = Number(url.searchParams.get("offset"));
        const offset = category && Number.isFinite(rawOffset)
          ? Math.min(Math.max(Math.floor(rawOffset), 0), 10000)
          : 0;
        const limit = category ? MORE_PAGE_SIZE : PAGE_SIZE;
        const escaped = query.replace(/[\\%_]/g, "\\$&");
        const pattern = `%${escaped}%`;
        const digits = query.replace(/\D/g, "");
        const phonePattern = `%${digits}%`;
        const phoneMatch = (column: typeof contacts.phone | typeof crmAccounts.phone) =>
          digits.length >= 4
            ? sql`regexp_replace(${column}, '[^0-9]', '', 'g') LIKE ${phonePattern}`
            : undefined;

        const dealsWhere = and(
          eq(crmDeals.tenantId, tenantId),
          session.operator.role !== "admin" && !session.permissions?.crm?.canViewAllDeals
            ? eq(crmDeals.operatorId, session.operator.id)
            : undefined,
          or(
            ilike(crmDeals.title, pattern),
            ilike(crmDeals.id, pattern),
            sql`EXISTS (
              SELECT 1 FROM crm_accounts acc
              WHERE acc.id = ${crmDeals.accountId} AND acc.tenant_id = ${tenantId}
                AND (acc.name ILIKE ${pattern} OR acc.trade_name ILIKE ${pattern}
                  OR acc.email ILIKE ${pattern}
                  OR ${digits.length >= 4 ? sql`regexp_replace(acc.phone, '[^0-9]', '', 'g') LIKE ${phonePattern} OR acc.document LIKE ${phonePattern}` : sql`FALSE`})
            )`,
            sql`EXISTS (
              SELECT 1 FROM crm_deal_contacts dc
              JOIN contacts ct ON ct.id = dc.contact_id AND ct.tenant_id = ${tenantId}
              WHERE dc.deal_id = ${crmDeals.id} AND dc.tenant_id = ${tenantId}
                AND (ct.name ILIKE ${pattern} OR ct.email ILIKE ${pattern}
                  OR ${digits.length >= 4 ? sql`regexp_replace(ct.phone, '[^0-9]', '', 'g') LIKE ${phonePattern} OR ct.cpf LIKE ${phonePattern} OR ct.cnpj LIKE ${phonePattern}` : sql`FALSE`})
            )`,
          ),
        );
        const companiesWhere = and(
          eq(crmAccounts.tenantId, tenantId),
          eq(crmAccounts.type, "company"),
          isNull(crmAccounts.archivedAt),
          or(
            ilike(crmAccounts.name, pattern),
            ilike(crmAccounts.tradeName, pattern),
            ilike(crmAccounts.email, pattern),
            phoneMatch(crmAccounts.phone),
            digits.length >= 4 ? ilike(crmAccounts.document, phonePattern) : undefined,
          ),
        );
        const contactsWhere = and(
          eq(contacts.tenantId, tenantId),
          or(
            ilike(contacts.name, pattern),
            ilike(contacts.email, pattern),
            phoneMatch(contacts.phone),
            digits.length >= 4 ? ilike(contacts.cpf, phonePattern) : undefined,
            digits.length >= 4 ? ilike(contacts.cnpj, phonePattern) : undefined,
            sql`EXISTS (
              SELECT 1 FROM crm_accounts acc
              WHERE acc.id = ${contacts.accountId} AND acc.tenant_id = ${tenantId}
                AND acc.archived_at IS NULL
                AND (acc.name ILIKE ${pattern} OR acc.trade_name ILIKE ${pattern})
            )`,
          ),
        );

        try {
          const searchDeals = async () => {
            const [items, totals] = await Promise.all([
              db
                .select({
                  id: crmDeals.id,
                  title: crmDeals.title,
                  status: crmDeals.status,
                  value: crmDeals.value,
                  currency: crmDeals.currency,
                  accountName: crmAccounts.name,
                  stageName: crmStages.name,
                  pipelineName: crmPipelines.name,
                })
                .from(crmDeals)
                .leftJoin(
                  crmAccounts,
                  and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, tenantId)),
                )
                .leftJoin(
                  crmStages,
                  and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.tenantId, tenantId)),
                )
                .leftJoin(
                  crmPipelines,
                  and(
                    eq(crmPipelines.id, crmDeals.pipelineId),
                    eq(crmPipelines.tenantId, tenantId),
                  ),
                )
                .where(dealsWhere)
                .orderBy(desc(crmDeals.updatedAt))
                .limit(limit)
                .offset(offset),
              db.select({ total: count() }).from(crmDeals).where(dealsWhere),
            ]);
            return { items, total: totals[0]?.total || 0 };
          };
          const searchCompanies = async () => {
            const [items, totals] = await Promise.all([
              db
                .select({
                  id: crmAccounts.id,
                  name: crmAccounts.name,
                  tradeName: crmAccounts.tradeName,
                  email: crmAccounts.email,
                  phone: crmAccounts.phone,
                })
                .from(crmAccounts)
                .where(companiesWhere)
                .orderBy(desc(crmAccounts.updatedAt))
                .limit(limit)
                .offset(offset),
              db.select({ total: count() }).from(crmAccounts).where(companiesWhere),
            ]);
            return { items, total: totals[0]?.total || 0 };
          };
          const searchContacts = async () => {
            const [items, totals] = await Promise.all([
              db
                .select({
                  id: contacts.id,
                  name: contacts.name,
                  email: contacts.email,
                  phone: contacts.phone,
                  accountId: contacts.accountId,
                  accountName: crmAccounts.name,
                })
                .from(contacts)
                .leftJoin(
                  crmAccounts,
                  and(eq(crmAccounts.id, contacts.accountId), eq(crmAccounts.tenantId, tenantId)),
                )
                .where(contactsWhere)
                .orderBy(desc(contacts.createdAt))
                .limit(limit)
                .offset(offset),
              db.select({ total: count() }).from(contacts).where(contactsWhere),
            ]);
            return { items, total: totals[0]?.total || 0 };
          };

          if (category === "deals") return Response.json({ deals: await searchDeals() });
          if (category === "companies")
            return Response.json({ companies: await searchCompanies() });
          if (category === "contacts") return Response.json({ contacts: await searchContacts() });
          const [deals, companies, contactResults] = await Promise.all([
            searchDeals(),
            searchCompanies(),
            searchContacts(),
          ]);
          return Response.json({ deals, companies, contacts: contactResults });
        } catch (error) {
          console.error("[CRM Search API] Falha na busca:", error);
          return Response.json({ error: "Não foi possível pesquisar no CRM." }, { status: 500 });
        }
      },
    },
  },
});
