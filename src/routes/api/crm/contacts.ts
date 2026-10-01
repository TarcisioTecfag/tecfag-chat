import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../../../db";
import { contacts } from "../../../db/schema";
import { listCustomFields, validateFieldValues } from "../../../lib/crm/custom-fields";
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
        const digits = search.replace(/\D/g, "");
        const conditions = [
          eq(contacts.tenantId, tenantId),
          or(
            ilike(contacts.name, pattern),
            ilike(contacts.phone, pattern),
            ilike(contacts.email, pattern),
            digits.length >= 4 ? sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') LIKE ${`%${digits}%`}` : undefined,
          )!,
        ];
        if (session.operator.role !== "admin" && session.permissions?.contacts?.contactScope === "wallet_only") {
          conditions.push(eq(contacts.walletOperatorId, session.operator.id));
        }
        const results = await db
          .select({
            id: contacts.id,
            name: contacts.name,
            phone: contacts.phone,
            email: contacts.email,
            accountId: contacts.accountId,
          })
          .from(contacts)
          .where(and(...conditions))
          .orderBy(desc(contacts.createdAt))
          .limit(10);

        return Response.json({ contacts: results });
      },
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const permissionError = requireCrmPermission(session, "canCreateDeals");
        if (permissionError) return permissionError;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Dados inválidos." }, { status: 400 });
        }
        if (!body || typeof body !== "object") {
          return Response.json({ error: "Dados inválidos." }, { status: 400 });
        }
        const input = body as Record<string, unknown>;
        const name = typeof input.name === "string" ? input.name.trim() : "";
        const phone = typeof input.phone === "string" ? input.phone.replace(/\D/g, "") : "";
        const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
        if (!name || name.length > 200) {
          return Response.json(
            { error: "Informe um nome de até 200 caracteres." },
            { status: 400 },
          );
        }
        if (
          (phone.length > 0 && phone.length < 8) ||
          phone.length > 40 ||
          email.length > 254 ||
          (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        ) {
          return Response.json({ error: "Telefone ou e-mail inválido." }, { status: 400 });
        }

        try {
          const customFields = validateFieldValues(await listCustomFields(tenantId, "contact"), input.customFields, { requireOnCreate: true });
          const outcome = await db.transaction(async (tx) => {
            if (phone || email) {
              await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${phone || email}))`);
            }
            const identity = phone.length >= 8
              ? sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${phone}`
              : email ? ilike(contacts.email, email) : undefined;
            if (identity) {
              const [existing] = await tx.select({ id: contacts.id, name: contacts.name })
                .from(contacts).where(and(eq(contacts.tenantId, tenantId), identity)).limit(1);
              if (existing) return { kind: "existing" as const, existing };
            }
            const [contact] = await tx.insert(contacts).values({
              id: `cont-${crypto.randomUUID()}`, tenantId, name,
              phone: phone || null, email: email || null, mainChannel: "whatsapp",
              walletOperatorId: session.permissions?.contacts?.contactScope === "wallet_only" ? session.operator.id : null,
              customFields,
            }).returning({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email });
            return { kind: "created" as const, contact };
          });
          if (outcome.kind === "existing") {
            return Response.json({ error: `Contato já cadastrado: ${outcome.existing.name}. Busque-o na base antes de criar outro.`, code: "CONTACT_EXISTS", contactId: outcome.existing.id }, { status: 409 });
          }
          const contact = outcome.contact;
          return Response.json({ contact }, { status: 201 });
        } catch (error) {
          if (error instanceof Error && "statusCode" in error) return Response.json({ error: error.message }, { status: 400 });
          console.error("[CRM Contacts API] Erro ao criar contato:", error);
          return Response.json({ error: "Não foi possível criar o contato." }, { status: 500 });
        }
      },
    },
  },
});
