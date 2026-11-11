import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../../../db";
import { contacts, crmAccounts, crmDealContacts, crmDeals } from "../../../db/schema";
import { listCustomFields, validateFieldValues } from "../../../lib/crm/custom-fields";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import {
  buildPhoneSearchTerms,
  buildPhoneQueryPlan,
  phoneRegistrationError,
  localPhoneSearchTerms,
} from "../../../lib/utils";
import {
  buildContactPhonesExistsSearchSql,
  buildPhoneColumnSearchSql,
} from "../../../lib/phone-search-sql";

import { contactDealPermission, registerContactDeal } from "../../../lib/crm/contact-registration";
import {
  findContactByAnyPhone,
  getContactPhonesMap,
  normalizeContactPhonesInput,
  syncContactPhones,
} from "../../../lib/crm/contact-phones";

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

        const url = new URL(request.url);
        const identityPhone = url.searchParams.get("identityPhone")?.trim().slice(0, 40);
        const identityName = url.searchParams.get("identityName")?.trim().slice(0, 100);
        const search = url.searchParams.get("search")?.trim().slice(0, 100) || "";
        if (search.length < 2 && !identityPhone && (!identityName || identityName.length < 3)) {
          return Response.json({ contacts: [] });
        }

        const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
        const digits = search.replace(/\D/g, "");
        const conditions = [eq(contacts.tenantId, tenantId)];

        if (identityPhone || identityName) {
          const identityParts = [];
          if (identityPhone) {
            const isLocalOnly = Boolean(phoneRegistrationError(identityPhone));
            const terms = isLocalOnly
              ? localPhoneSearchTerms(identityPhone)
              : [...buildPhoneSearchTerms(identityPhone), ...localPhoneSearchTerms(identityPhone)];
            if (terms.length > 0) {
              identityParts.push(
                or(
                  ...terms.map((term) =>
                    isLocalOnly
                      ? sql`(
                          right(regexp_replace(${contacts.phone}, '[^0-9]', '', 'g'), ${term.length}) = ${term}
                          OR EXISTS (
                            SELECT 1 FROM contact_phones cp
                            WHERE cp.tenant_id = ${tenantId}
                              AND cp.contact_id = ${contacts.id}
                              AND right(regexp_replace(cp.phone, '[^0-9]', '', 'g'), ${term.length}) = ${term}
                          )
                        )`
                      : sql`(
                          regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}
                          OR EXISTS (
                            SELECT 1 FROM contact_phones cp
                            WHERE cp.tenant_id = ${tenantId}
                              AND cp.contact_id = ${contacts.id}
                              AND (regexp_replace(cp.phone, '[^0-9]', '', 'g') = ${term} OR cp.phone_identity = ${term})
                          )
                        )`,
                  ),
                )!,
              );
            }
          }
          if (identityName && identityName.length >= 3) {
            const namePattern = `%${identityName.replace(/[\\%_]/g, "\\$&")}%`;
            identityParts.push(ilike(contacts.name, namePattern));
          }
          conditions.push(identityParts.length > 0 ? or(...identityParts)! : sql`false`);
        } else {
          const phonePlan = buildPhoneQueryPlan(search);
          conditions.push(
            or(
              ilike(contacts.name, pattern),
              ilike(contacts.phone, pattern),
              ilike(contacts.email, pattern),
              buildContactPhonesExistsSearchSql(tenantId, contacts.id, search, phonePlan),
              buildPhoneColumnSearchSql(contacts.phone, phonePlan),
            )!,
          );
        }

        if (
          session.operator.role !== "admin" &&
          session.permissions?.contacts?.contactScope === "wallet_only"
        ) {
          conditions.push(eq(contacts.walletOperatorId, session.operator.id));
        }
        const results = await db
          .select({
            id: contacts.id,
            name: contacts.name,
            phone: contacts.phone,
            email: contacts.email,
            accountId: contacts.accountId,
            accountName: crmAccounts.name,
            accountDocument: crmAccounts.document,
            mainChannel: contacts.mainChannel,
            responsibleName: contacts.responsibleName,
          })
          .from(contacts)
          .leftJoin(
            crmAccounts,
            and(eq(contacts.accountId, crmAccounts.id), eq(crmAccounts.tenantId, tenantId)),
          )
          .where(and(...conditions))
          .orderBy(desc(contacts.createdAt))
          .limit(10);

        const contactIds = results.map((item) => item.id);
        const phonesByContact = await getContactPhonesMap(db, tenantId, contactIds, results);
        const dealsByContact = new Map<
          string,
          Array<{
            id: string;
            title: string;
            status: string;
            value: string | null;
            pipelineId: string;
            stageId: string;
          }>
        >();
        if (contactIds.length > 0) {
          const dealLinks = await db
            .select({
              contactId: crmDealContacts.contactId,
              id: crmDeals.id,
              title: crmDeals.title,
              status: crmDeals.status,
              value: crmDeals.value,
              pipelineId: crmDeals.pipelineId,
              stageId: crmDeals.stageId,
            })
            .from(crmDealContacts)
            .innerJoin(
              crmDeals,
              and(eq(crmDeals.id, crmDealContacts.dealId), eq(crmDeals.tenantId, tenantId)),
            )
            .where(
              and(
                eq(crmDealContacts.tenantId, tenantId),
                inArray(crmDealContacts.contactId, contactIds),
              ),
            )
            .orderBy(desc(crmDeals.updatedAt), desc(crmDeals.createdAt));

          for (const link of dealLinks) {
            const existing = dealsByContact.get(link.contactId) || [];
            if (!existing.some((d) => d.id === link.id)) {
              existing.push({
                id: link.id,
                title: link.title,
                status: link.status,
                value:
                  link.value !== null && link.value !== undefined ? String(link.value) : null,
                pipelineId: link.pipelineId,
                stageId: link.stageId,
              });
              dealsByContact.set(link.contactId, existing);
            }
          }
        }

        const enrichedResults = results.map((item) => {
          const linked = dealsByContact.get(item.id) || [];
          const phones = phonesByContact.get(item.id) || [];
          return {
            ...item,
            phone: phones.find((p) => p.isPrimary)?.phone || item.phone || null,
            phones,
            dealsCount: linked.length,
            linkedDeals: linked.slice(0, 5),
          };
        });

        return Response.json({ contacts: enrichedResults });
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
        if (
          !input.existingContactId &&
          session.operator.role !== "admin" &&
          !session.permissions?.contacts?.canCreateContact &&
          !session.permissions?.crm?.canCreateDeals
        )
          return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        const name = typeof input.name === "string" ? input.name.trim() : "";
        const newContactId = `cont-${crypto.randomUUID()}`;
        const normalizedPhonesResult = normalizeContactPhonesInput(
          input.phones,
          typeof input.phone === "string" ? input.phone : "",
          newContactId,
        );
        if (normalizedPhonesResult.validationError && !input.existingContactId) {
          return Response.json(
            { error: normalizedPhonesResult.validationError, code: "PHONE_DDD_REQUIRED" },
            { status: 400 },
          );
        }
        const phone = normalizedPhonesResult.primaryPhone || "";
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
          const customFields = input.existingContactId
            ? {}
            : validateFieldValues(await listCustomFields(tenantId, "contact"), input.customFields, {
                requireOnCreate: true,
              });
          const outcome = await db.transaction(async (tx) => {
            if (typeof input.existingContactId === "string" && input.existingContactId) {
              const [existing] = await tx
                .select()
                .from(contacts)
                .where(
                  and(
                    eq(contacts.tenantId, tenantId),
                    eq(contacts.id, input.existingContactId),
                  ),
                )
                .limit(1);
              if (!existing)
                throw Object.assign(new Error("Contato não encontrado."), { statusCode: 404 });
              if (
                session.operator.role !== "admin" &&
                session.permissions?.contacts?.contactScope === "wallet_only" &&
                existing.walletOperatorId !== session.operator.id
              )
                throw Object.assign(new Error("Permissão insuficiente."), { statusCode: 403 });
              await registerContactDeal(tx, session, existing.id, existing.accountId, input);
              const existingPhones =
                (await getContactPhonesMap(tx, tenantId, [existing.id], [existing])).get(
                  existing.id,
                ) || [];
              return {
                kind: "linked" as const,
                contact: {
                  id: existing.id,
                  name: existing.name,
                  phone: existing.phone,
                  phones: existingPhones,
                  email: existing.email,
                },
              };
            }
            if (phone || email) {
              await tx.execute(
                sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${phone || email}))`,
              );
            }
            for (const p of normalizedPhonesResult.phones) {
              const found = await findContactByAnyPhone(tx, tenantId, p.phone);
              if (found?.contact) {
                return {
                  kind: "existing" as const,
                  existing: {
                    id: found.contact.id,
                    name: found.contact.name,
                    phone: found.contact.phone,
                    email: found.contact.email,
                    walletOperatorId: found.contact.walletOperatorId,
                  },
                };
              }
            }
            if (!phone && email) {
              const [existingByEmail] = await tx
                .select({
                  id: contacts.id,
                  name: contacts.name,
                  phone: contacts.phone,
                  email: contacts.email,
                  walletOperatorId: contacts.walletOperatorId,
                })
                .from(contacts)
                .where(and(eq(contacts.tenantId, tenantId), ilike(contacts.email, email)))
                .limit(1);
              if (existingByEmail) return { kind: "existing" as const, existing: existingByEmail };
            }
            const [contact] = await tx
              .insert(contacts)
              .values({
                id: newContactId,
                tenantId,
                name,
                phone: phone || null,
                email: email || null,
                mainChannel: "whatsapp",
                walletOperatorId:
                  session.permissions?.contacts?.contactScope === "wallet_only"
                    ? session.operator.id
                    : null,
                customFields,
              })
              .returning({
                id: contacts.id,
                name: contacts.name,
                phone: contacts.phone,
                email: contacts.email,
              });
            const synced = await syncContactPhones(
              tx,
              tenantId,
              contact.id,
              normalizedPhonesResult.phones,
              phone || null,
            );
            await registerContactDeal(tx, session, contact.id, null, input);
            return {
              kind: "created" as const,
              contact: {
                ...contact,
                phone: synced.primaryPhone || contact.phone,
                phones: synced.phones,
              },
            };
          });
          if (outcome.kind === "existing") {
            if (
              session.operator.role !== "admin" &&
              session.permissions?.contacts?.contactScope === "wallet_only" &&
              outcome.existing.walletOperatorId !== session.operator.id
            )
              return Response.json(
                {
                  error:
                    "Este telefone já está cadastrado. Solicite acesso ao contato ao administrador.",
                  code: "CONTACT_EXISTS",
                },
                { status: 409 },
              );
            return Response.json(
              {
                error: `Contato já cadastrado: ${outcome.existing.name}. Selecione o cadastro existente para continuar.`,
                code: "CONTACT_EXISTS",
                contactId: outcome.existing.id,
                contact: outcome.existing,
              },
              { status: 409 },
            );
          }
          const contact = outcome.contact;
          return Response.json({ contact }, { status: outcome.kind === "linked" ? 200 : 201 });
        } catch (error) {
          if (
            ((error as any)?.constraint || (error as any)?.cause?.constraint) ===
            "contacts_tenant_phone_identity"
          ) {
            return Response.json(
              { error: "Já existe um contato com este telefone.", code: "CONTACT_EXISTS" },
              { status: 409 },
            );
          }
          if (error instanceof Error && "statusCode" in error)
            return Response.json(
              { error: error.message, code: (error as any).code },
              { status: Number(error.statusCode) || 400 },
            );
          console.error("[CRM Contacts API] Erro ao criar contato:", error);
          return Response.json({ error: "Não foi possível criar o contato." }, { status: 500 });
        }
      },
    },
  },
});
