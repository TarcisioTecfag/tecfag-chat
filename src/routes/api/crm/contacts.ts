import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../../../db";
import { contacts } from "../../../db/schema";
import { listCustomFields, validateFieldValues } from "../../../lib/crm/custom-fields";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import { normalizeCanonicalPhone, buildPhoneSearchTerms, phoneRegistrationError, localPhoneSearchTerms } from "../../../lib/utils";

import { contactDealPermission, registerContactDeal } from "../../../lib/crm/contact-registration";

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

        const identityPhone = new URL(request.url).searchParams.get("identityPhone")?.trim().slice(0, 40);
        const search = new URL(request.url).searchParams.get("search")?.trim().slice(0, 100) || "";
        if (search.length < 2 && !identityPhone) {
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
        if (identityPhone) {
          const terms = phoneRegistrationError(identityPhone) ? localPhoneSearchTerms(identityPhone) : [...buildPhoneSearchTerms(identityPhone), ...localPhoneSearchTerms(identityPhone)];
          conditions[1] = terms.length ? or(...terms.map((term) => phoneRegistrationError(identityPhone)
            ? sql`right(regexp_replace(${contacts.phone}, '[^0-9]', '', 'g'), ${term.length}) = ${term}`
            : sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}`))! : sql`false`;
        }
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
        const permissionError = requireCrmPermission(session, "canViewCrm");
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
        if (!input.existingContactId && session.operator.role !== "admin" && !session.permissions?.contacts?.canCreateContact && !session.permissions?.crm?.canCreateDeals) return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        const name = typeof input.name === "string" ? input.name.trim() : "";
        const phoneError = phoneRegistrationError(typeof input.phone === "string" ? input.phone : "");
        if (phoneError && !input.existingContactId) return Response.json({ error: phoneError, code: "PHONE_DDD_REQUIRED" }, { status: 400 });
        const phone = normalizeCanonicalPhone(typeof input.phone === "string" ? input.phone : "");
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

        const dealPermission = contactDealPermission(session, input);
        if (dealPermission) return dealPermission;
        try {
          const customFields = input.existingContactId ? {} : validateFieldValues(await listCustomFields(tenantId, "contact"), input.customFields, { requireOnCreate: true });
          const outcome = await db.transaction(async (tx) => {
            if (typeof input.existingContactId === "string" && input.existingContactId) {
              const [existing] = await tx.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, input.existingContactId))).limit(1);
              if (!existing) throw Object.assign(new Error("Contato não encontrado."), { statusCode: 404 });
              if (session.operator.role !== "admin" && session.permissions?.contacts?.contactScope === "wallet_only" && existing.walletOperatorId !== session.operator.id) throw Object.assign(new Error("Permissão insuficiente."), { statusCode: 403 });
              await registerContactDeal(tx, session, existing.id, existing.accountId, input);
              return { kind: "linked" as const, contact: { id: existing.id, name: existing.name, phone: existing.phone, email: existing.email } };
            }
            if (phone || email) {
              await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${phone || email}))`);
            }
            const phoneTerms = buildPhoneSearchTerms(phone);
            const identity = phoneTerms.length > 0
              ? or(...phoneTerms.map((term) => sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}`))
              : email ? ilike(contacts.email, email) : undefined;
            if (identity) {
              const [existing] = await tx.select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email, walletOperatorId: contacts.walletOperatorId })
                .from(contacts).where(and(eq(contacts.tenantId, tenantId), identity)).limit(1);
              if (existing) return { kind: "existing" as const, existing };
            }
            const [contact] = await tx.insert(contacts).values({
              id: `cont-${crypto.randomUUID()}`, tenantId, name,
              phone: phone || null, email: email || null, mainChannel: "whatsapp",
              walletOperatorId: session.permissions?.contacts?.contactScope === "wallet_only" ? session.operator.id : null,
              customFields,
            }).returning({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email });
            await registerContactDeal(tx, session, contact.id, null, input);
            return { kind: "created" as const, contact };
          });
          if (outcome.kind === "existing") {
            if (session.operator.role !== "admin" && session.permissions?.contacts?.contactScope === "wallet_only" && outcome.existing.walletOperatorId !== session.operator.id) return Response.json({ error: "Este telefone já está cadastrado. Solicite acesso ao contato ao administrador.", code: "CONTACT_EXISTS" }, { status: 409 });
            return Response.json({ error: `Contato já cadastrado: ${outcome.existing.name}. Selecione o cadastro existente para continuar.`, code: "CONTACT_EXISTS", contactId: outcome.existing.id, contact: outcome.existing }, { status: 409 });
          }
          const contact = outcome.contact;
          return Response.json({ contact }, { status: outcome.kind === "linked" ? 200 : 201 });
        } catch (error) {
          if (((error as any)?.constraint || (error as any)?.cause?.constraint) === "contacts_tenant_phone_identity") {
            return Response.json({ error: "Já existe um contato com este telefone.", code: "CONTACT_EXISTS" }, { status: 409 });
          }
          if (error instanceof Error && "statusCode" in error) return Response.json({ error: error.message, code: (error as any).code }, { status: Number(error.statusCode) || 400 });
          console.error("[CRM Contacts API] Erro ao criar contato:", error);
          return Response.json({ error: "Não foi possível criar o contato." }, { status: 500 });
        }
      },
    },
  },
});
