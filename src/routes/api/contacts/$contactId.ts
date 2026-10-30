import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts, crmDealContacts, crmDealEvents } from "../../../db/schema";
import { and, eq, ilike, ne, or, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { requireConversationWriteAccess } from "../../../lib/access-control/conversation-access";
import { getDealContext, DealContextError } from "../../../lib/crm/conversation-deal-context";
import { recordAttendanceEvent } from "../../../lib/attendance-events";
import { diffCustomFieldValues, listCustomFields, validateFieldValues, type CustomFieldDefinition } from "../../../lib/crm/custom-fields";
import { normalizeCanonicalPhone, buildPhoneSearchTerms, phoneRegistrationError } from "../../../lib/utils";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Attendance-Conversation",
};

export const Route = createFileRoute("/api/contacts/$contactId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      // ── PATCH /api/contacts/:contactId ──────────────────────────────────────
      // Body: { name?, phone?, email?, cnpj?, cpf?, tags?, cnpjDetails?, accountId?, accountChangeReason? }
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;
          if (session.operator.role !== "admin" &&
              !session.permissions?.contacts?.canEditContact &&
              !session.permissions?.chat?.canEditClientInfo &&
              !session.permissions?.crm?.canEditDeals) {
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          }

          const { contactId } = params as { contactId: string };
          const attendanceConversationId = request.headers.get("X-Attendance-Conversation");
          if (attendanceConversationId) {
            const denied = await requireConversationWriteAccess(session, attendanceConversationId);
            if (denied) return denied;
          }
          const body = await request.json().catch(() => null) as {
            name?: string;
            phone?: string;
            whatsappUsername?: string | null;
            email?: string;
            cnpj?: string;
            cpf?: string;
            tags?: string[];
            cnpjDetails?: any;
            accountId?: string | null;
            accountChangeReason?: string;
            customFields?: Record<string, unknown>;
            dealId?: string;
          } | null;
          if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Dados inválidos." }, { status: 400 });

          const [currentContact] = await db.select()
            .from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId))).limit(1);
          if (!currentContact) return Response.json({ error: "Contato não encontrado." }, { status: 404 });
          if (session.operator.role !== "admin" && session.permissions?.contacts?.contactScope === "wallet_only" && currentContact.walletOperatorId !== session.operator.id) {
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          }

          // Monta apenas os demais campos enviados
          const updates: Record<string, any> = {};
          if ("name" in body) {
            if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 200) return Response.json({ error: "Nome inválido." }, { status: 400 });
            updates.name = body.name.trim();
          }
          if ("phone" in body) {
            if (body.phone != null && typeof body.phone !== "string") return Response.json({ error: "Telefone inválido." }, { status: 400 });
            const phoneError = phoneRegistrationError(body.phone);
            if (phoneError) return Response.json({ error: phoneError, code: "PHONE_DDD_REQUIRED" }, { status: 400 });
            updates.phone = body.phone ? normalizeCanonicalPhone(body.phone) || null : null;
            if (updates.phone && (updates.phone.length < 8 || updates.phone.length > 40)) return Response.json({ error: "Telefone inválido." }, { status: 400 });
          }
          if ("whatsappUsername" in body) {
            if (body.whatsappUsername != null && typeof body.whatsappUsername !== "string") return Response.json({ error: "Nome de usuário do WhatsApp inválido." }, { status: 400 });
            const username = body.whatsappUsername?.trim().replace(/^@/, "") || "";
            if (username && !/^(?=.{3,35}$)(?=.*[a-zA-Z])[a-zA-Z0-9._]+$/.test(username)) {
              return Response.json({ error: "Nome de usuário do WhatsApp inválido." }, { status: 400 });
            }
            updates.whatsappUsername = username || null;
          }
          if ("email" in body) {
            if (body.email != null && typeof body.email !== "string") return Response.json({ error: "E-mail inválido." }, { status: 400 });
            updates.email = body.email?.trim().toLowerCase() || null;
            if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) return Response.json({ error: "E-mail inválido." }, { status: 400 });
          }
          if ("cnpj" in body) {
            if (body.cnpj != null && typeof body.cnpj !== "string") return Response.json({ error: "CNPJ inválido." }, { status: 400 });
            updates.cnpj = body.cnpj ? body.cnpj.replace(/\D/g, "") || null : null;
          }
          if ("cpf" in body) {
            if (body.cpf != null && typeof body.cpf !== "string") return Response.json({ error: "CPF inválido." }, { status: 400 });
            updates.cpf = body.cpf ? body.cpf.replace(/\D/g, "") || null : null;
          }
          if ("tags" in body) {
            if (!Array.isArray(body.tags) || !body.tags.every((tag) => typeof tag === "string" && tag.length <= 100)) return Response.json({ error: "Marcadores inválidos." }, { status: 400 });
            updates.tags = body.tags;
          }
          if ("cnpjDetails" in body) updates.cnpjDetails = body.cnpjDetails;
          const prevCustomFieldsObj: Record<string, unknown> =
            typeof currentContact.customFields === "string"
              ? (() => {
                  try {
                    return JSON.parse(currentContact.customFields) || {};
                  } catch {
                    return {};
                  }
                })()
              : currentContact.customFields && typeof currentContact.customFields === "object"
              ? (currentContact.customFields as Record<string, unknown>)
              : {};
          let contactFieldDefs: CustomFieldDefinition[] = [];
          if (body.customFields !== undefined) {
            contactFieldDefs = await listCustomFields(session.tenantId, "contact");
            const patch = validateFieldValues(contactFieldDefs, body.customFields);
            updates.customFields = { ...prevCustomFieldsObj, ...patch };
          }

          if (updates.phone || (!updates.phone && updates.email)) {
            const phoneTerms = updates.phone ? buildPhoneSearchTerms(updates.phone) : [];
            const identity = phoneTerms.length > 0
              ? or(...phoneTerms.map((term) => sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}`))
              : ilike(contacts.email, updates.email);
            const [duplicate] = await db.select({ id: contacts.id, name: contacts.name }).from(contacts)
              .where(and(eq(contacts.tenantId, session.tenantId), ne(contacts.id, contactId), identity)).limit(1);
            if (duplicate) return Response.json({ error: `Outro contato já usa esses dados: ${duplicate.name}.`, code: "CONTACT_EXISTS", contactId: duplicate.id }, { status: 409 });
          }

          await db.transaction(async tx => {
            if (attendanceConversationId) {
              const state = await getDealContext(tx, session.tenantId, attendanceConversationId, session.operator.id);
              if (state.conversation.contactId !== contactId || state.conversation.operatorId !== session.operator.id || state.conversation.queueState !== "meus")
                throw new DealContextError("Contato ou responsável do atendimento mudou.", "FORBIDDEN", 403);
            }
            const [before] = await tx.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId))).for("update").limit(1);
            if (!before) throw new DealContextError("Contato não encontrado.", "NOT_FOUND", 404);
            if (body.accountId !== undefined) {
              const { crmService } = await import("../../../lib/crm/crm-service");
              await crmService.updateContactAccount(session.tenantId, contactId, body.accountId, body.accountChangeReason, session.operator.id, tx);
            }
            if (Object.keys(updates).length) await tx.update(contacts).set(updates).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId)));
            if (attendanceConversationId) {
              const changes = Object.entries({ ...updates, ...(body.accountId !== undefined ? { accountId: body.accountId } : {}) })
                .filter(([key, value]) => JSON.stringify(before[key as keyof typeof before]) !== JSON.stringify(value))
                .map(([field, to]) => ({ field, from: before[field as keyof typeof before], to }));
              if (changes.length) await recordAttendanceEvent(tx, {
                tenantId: session.tenantId, conversationId: attendanceConversationId,
                sourceKey: `contact:${crypto.randomUUID()}`, eventType: "contact.updated",
                actorName: session.operator.name, operatorId: session.operator.id,
                description: `${session.operator.name} atualizou os dados do cliente pelo atendimento: ${changes.map(change => change.field).join(", ")}.`,
                metadata: { contactId, changes },
              });
            }
          });

          const [updatedContact] = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId)))
            .limit(1);

          if (updatedContact) {
            const changes: Array<{ fieldLabel: string; fromValue: string | null; toValue: string | null }> = [];
            const pushChange = (label: string, fromVal: unknown, toVal: unknown) => {
              const f = typeof fromVal === "string" && fromVal.trim() ? fromVal.trim() : null;
              const t = typeof toVal === "string" && toVal.trim() ? toVal.trim() : null;
              if (f !== t) changes.push({ fieldLabel: label, fromValue: f, toValue: t });
            };

            if ("name" in updates) pushChange("Nome", currentContact.name, updatedContact.name);
            if ("phone" in updates) pushChange("Telefone", currentContact.phone, updatedContact.phone);
            if ("whatsappUsername" in updates) pushChange("Usuário WhatsApp", currentContact.whatsappUsername, updatedContact.whatsappUsername);
            if ("email" in updates) pushChange("E-mail", currentContact.email, updatedContact.email);
            if ("cpf" in updates) pushChange("CPF", currentContact.cpf, updatedContact.cpf);
            if ("cnpj" in updates) pushChange("CNPJ", currentContact.cnpj, updatedContact.cnpj);

            if (updates.customFields !== undefined) {
              const nextCustomFieldsObj: Record<string, unknown> =
                typeof updatedContact.customFields === "string"
                  ? (() => {
                      try {
                        return JSON.parse(updatedContact.customFields) || {};
                      } catch {
                        return {};
                      }
                    })()
                  : updatedContact.customFields && typeof updatedContact.customFields === "object"
                  ? (updatedContact.customFields as Record<string, unknown>)
                  : {};
              const cfDiffs = diffCustomFieldValues(
                contactFieldDefs,
                prevCustomFieldsObj,
                nextCustomFieldsObj,
              );
              for (const d of cfDiffs) {
                changes.push({
                  fieldLabel: d.fieldName,
                  fromValue: d.fromLabel,
                  toValue: d.toLabel,
                });
              }
            }

            if (changes.length > 0 && !attendanceConversationId) {
              const linkedDealContacts = await db
                .select({ dealId: crmDealContacts.dealId })
                .from(crmDealContacts)
                .where(
                  and(
                    eq(crmDealContacts.tenantId, session.tenantId),
                    eq(crmDealContacts.contactId, contactId),
                  ),
                );
              const extraDealIds: string[] = [];
              if (typeof body.dealId === "string" && body.dealId.trim()) {
                extraDealIds.push(body.dealId.trim());
              }
              const uniqueDealIds = Array.from(
                new Set([...linkedDealContacts.map((r) => r.dealId), ...extraDealIds])
              );
              const now = new Date();
              for (const dealId of uniqueDealIds) {
                await db.insert(crmDealEvents).values({
                  id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                  tenantId: session.tenantId,
                  dealId,
                  eventType: "contact_updated",
                  operatorId: session.operator.id,
                  metadata: {
                    contactId,
                    contactName: updatedContact.name,
                    changes,
                  },
                  createdAt: now,
                });
              }
            }
          }

          let linkedAccount = null;
          if (updatedContact?.accountId) {
            const { crmAccounts } = await import("../../../db/schema");
            const [acc] = await db
              .select()
              .from(crmAccounts)
              .where(and(eq(crmAccounts.id, updatedContact.accountId), eq(crmAccounts.tenantId, session.tenantId)))
              .limit(1);
            linkedAccount = acc || null;

            if (linkedAccount && body.cnpjDetails && typeof body.cnpjDetails === "object") {
              const { buildAccountUpdatePayloadFromCnpjDetails } = await import("../../../lib/crm/cnpj-account-mapper");
              const { crmService } = await import("../../../lib/crm/crm-service");
              const accountPatch = buildAccountUpdatePayloadFromCnpjDetails(body.cnpjDetails, linkedAccount as any);
              try {
                linkedAccount = await crmService.updateAccount(
                  session.tenantId,
                  linkedAccount.id,
                  accountPatch,
                  session.operator.id,
                );
              } catch (accErr) {
                console.warn("[PATCH /api/contacts/:contactId] Aviso ao sincronizar cnpjDetails na empresa vinculada:", accErr);
              }
            }
          }

          return new Response(JSON.stringify({ success: true, contact: updatedContact, account: linkedAccount }), {
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao atualizar contato:", e);
          const statusCode = (e?.constraint || e?.cause?.constraint) === "contacts_tenant_phone_identity" ? 409 : e?.statusCode || 500;
          return new Response(JSON.stringify({ error: e.message, code: e?.code }), {
            status: statusCode,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
      },

      // ── GET /api/contacts/:contactId ────────────────────────────────────────
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const { contactId } = params as { contactId: string };
          const [contact] = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId)));

          if (!contact) {
            return new Response(JSON.stringify({ error: "Contato não encontrado" }), {
              status: 404,
              headers: { ...CORS, "Content-Type": "application/json" },
            });
          }

          let account = null;
          if (contact.accountId) {
            const { crmAccounts } = await import("../../../db/schema");
            const [acc] = await db
              .select()
              .from(crmAccounts)
              .where(and(eq(crmAccounts.id, contact.accountId), eq(crmAccounts.tenantId, session.tenantId)))
              .limit(1);
            account = acc || null;
          } else {
            const { crmAccounts, crmDeals } = await import("../../../db/schema");
            const cleanCnpj = (contact.cnpj || "").replace(/\D/g, "");
            if (cleanCnpj.length === 14) {
              const [accByCnpj] = await db
                .select()
                .from(crmAccounts)
                .where(
                  and(
                    eq(crmAccounts.tenantId, session.tenantId),
                    sql`regexp_replace(${crmAccounts.document}, '[^0-9]', '', 'g') = ${cleanCnpj}`,
                  ),
                )
                .limit(1);
              if (accByCnpj) account = accByCnpj;
            }
            if (!account) {
              const [dealWithAcc] = await db
                .select({ account: crmAccounts })
                .from(crmDealContacts)
                .innerJoin(
                  crmDeals,
                  and(eq(crmDeals.id, crmDealContacts.dealId), eq(crmDeals.tenantId, session.tenantId)),
                )
                .innerJoin(
                  crmAccounts,
                  and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, session.tenantId)),
                )
                .where(
                  and(
                    eq(crmDealContacts.tenantId, session.tenantId),
                    eq(crmDealContacts.contactId, contact.id),
                  ),
                )
                .limit(1);
              if (dealWithAcc?.account) account = dealWithAcc.account;
            }
            if (account?.id) {
              await db
                .update(contacts)
                .set({ accountId: account.id })
                .where(and(eq(contacts.id, contact.id), eq(contacts.tenantId, session.tenantId)))
                .catch(() => {});
              contact.accountId = account.id;
            }
          }

          return new Response(JSON.stringify({ ...contact, account }), {
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
