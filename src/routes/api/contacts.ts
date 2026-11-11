import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db/index.js";
import {
  channelConfigs,
  contacts,
  conversations,
  crmAccounts,
  crmContactAccountHistory,
  crmDealContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  operators,
} from "../../db/schema.js";
import { eq, and, count, desc, ilike, inArray, or, sql } from "drizzle-orm";
import { shouldIgnoreJid } from "../../lib/baileys/jid-validator.js";
import { requireSession } from "../../lib/auth-session.js";
import {
  normalizeCanonicalPhone,
  buildPhoneSearchTerms,
  buildPhoneQueryPlan,
  phoneRegistrationError,
  localPhoneSearchTerms,
} from "../../lib/utils.js";
import {
  buildContactPhonesExistsSearchSql,
  buildPhoneColumnSearchSql,
} from "../../lib/phone-search-sql";

import { contactDealPermission, registerContactDeal } from "../../lib/crm/contact-registration";
import {
  findContactByAnyPhone,
  getContactPhonesMap,
  normalizeContactPhonesInput,
  syncContactPhones,
} from "../../lib/crm/contact-phones";
import { syncConversationDeals } from "../../lib/crm/deal-associations";
import { listCustomFields, validateFieldValues } from "../../lib/crm/custom-fields";
import { setAttendanceActor } from "../../lib/attendance-events";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/contacts")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin" && !session.permissions?.views?.contacts) {
          return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        }

        const url = new URL(request.url);
        const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
        const identityPhone = url.searchParams.get("identityPhone")?.trim().slice(0, 40);
        const identityName = url.searchParams.get("identityName")?.trim().slice(0, 100);
        const channel = url.searchParams.get("channel");
        if (channel && !["whatsapp", "instagram", "messenger", "livechat"].includes(channel)) {
          return Response.json({ error: "Canal inválido." }, { status: 400 });
        }
        const rawLimit = Number(url.searchParams.get("limit"));
        const rawOffset = Number(url.searchParams.get("offset"));
        const limit =
          Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 100) : 50;
        const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
        const conditions = [eq(contacts.tenantId, tenantId)];
        if (
          session.operator.role !== "admin" &&
          session.permissions?.contacts?.contactScope === "wallet_only"
        ) {
          conditions.push(eq(contacts.walletOperatorId, session.operator.id));
        }
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
        }
        if (channel) conditions.push(eq(contacts.mainChannel, channel));
        if (search) {
          const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
          const phonePlan = buildPhoneQueryPlan(search);
          conditions.push(
            or(
              ilike(contacts.name, pattern),
              ilike(contacts.email, pattern),
              ilike(contacts.whatsappUsername, pattern),
              ilike(contacts.phone, pattern),
              ilike(crmAccounts.name, pattern),
              ilike(crmAccounts.document, pattern),
              ilike(contacts.responsibleName, pattern),
              sql`${contacts.tags}::text ILIKE ${pattern}`,
              buildContactPhonesExistsSearchSql(tenantId, contacts.id, search, phonePlan),
              buildPhoneColumnSearchSql(contacts.phone, phonePlan),
            )!,
          );
        }
        const where = and(...conditions);
        try {
          const [items, totals] = await Promise.all([
            db
              .select({
                id: contacts.id,
                name: contacts.name,
                phone: contacts.phone,
                whatsappUsername: contacts.whatsappUsername,
                email: contacts.email,
                cnpj: contacts.cnpj,
                cpf: contacts.cpf,
                accountId: contacts.accountId,
                accountName: crmAccounts.name,
                accountDocument: crmAccounts.document,
                accountType: crmAccounts.type,
                avatar: contacts.avatar,
                tags: contacts.tags,
                mainChannel: contacts.mainChannel,
                walletOperatorId: contacts.walletOperatorId,
                responsibleName: contacts.responsibleName,
                customFields: contacts.customFields,
                latestConversationId: sql<string | null>`(
                  SELECT conv.id FROM conversations conv
                  WHERE conv.contact_id = ${contacts.id} AND conv.tenant_id = ${tenantId}
                  ORDER BY conv.last_message_time DESC, conv.created_at DESC LIMIT 1
                )`,
                latestOperatorId: sql<string | null>`(
                  SELECT conv.operator_id FROM conversations conv
                  WHERE conv.contact_id = ${contacts.id} AND conv.tenant_id = ${tenantId}
                  ORDER BY conv.last_message_time DESC, conv.created_at DESC LIMIT 1
                )`,
              })
              .from(contacts)
              .leftJoin(
                crmAccounts,
                and(eq(contacts.accountId, crmAccounts.id), eq(crmAccounts.tenantId, tenantId)),
              )
              .where(where)
              .orderBy(desc(contacts.createdAt), desc(contacts.id))
              .limit(limit)
              .offset(offset),
            db
              .select({ total: count() })
              .from(contacts)
              .leftJoin(
                crmAccounts,
                and(eq(contacts.accountId, crmAccounts.id), eq(crmAccounts.tenantId, tenantId)),
              )
              .where(where),
          ]);

          const contactIds = items.map((item) => item.id);
          const dealsByContact = new Map<
            string,
            Array<{
              id: string;
              title: string;
              status: string;
              value: string | null;
              pipelineId: string;
              stageId: string;
              pipelineName: string | null;
              stageName: string | null;
              operatorId: string | null;
              operatorName: string | null;
              accountId: string | null;
              accountName: string | null;
              lossReason: string | null;
              pausedReason: string | null;
              rating: number;
              source: string | null;
              campaign: string | null;
              closedAt: string | null;
              createdAt: string | null;
              updatedAt: string | null;
            }>
          >();
          const fallbackAccountByContact = new Map<
            string,
            {
              accountId: string;
              accountName: string | null;
              accountDocument: string | null;
              accountType: string | null;
            }
          >();

          const phonesByContact = await getContactPhonesMap(db, tenantId, contactIds, items);

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
                pipelineName: crmPipelines.name,
                stageName: crmStages.name,
                operatorId: crmDeals.operatorId,
                operatorName: operators.name,
                accountId: crmDeals.accountId,
                accountName: crmAccounts.name,
                accountDocument: crmAccounts.document,
                accountType: crmAccounts.type,
                lossReason: crmDeals.lossReason,
                pausedReason: crmDeals.pausedReason,
                rating: crmDeals.rating,
                source: crmDeals.source,
                campaign: crmDeals.campaign,
                closedAt: crmDeals.closedAt,
                createdAt: crmDeals.createdAt,
                updatedAt: crmDeals.updatedAt,
              })
              .from(crmDealContacts)
              .innerJoin(
                crmDeals,
                and(eq(crmDeals.id, crmDealContacts.dealId), eq(crmDeals.tenantId, tenantId)),
              )
              .leftJoin(
                crmPipelines,
                and(eq(crmPipelines.id, crmDeals.pipelineId), eq(crmPipelines.tenantId, tenantId)),
              )
              .leftJoin(
                crmStages,
                and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.tenantId, tenantId)),
              )
              .leftJoin(
                operators,
                and(eq(operators.id, crmDeals.operatorId), eq(operators.tenantId, tenantId)),
              )
              .leftJoin(
                crmAccounts,
                and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, tenantId)),
              )
              .where(
                and(
                  eq(crmDealContacts.tenantId, tenantId),
                  inArray(crmDealContacts.contactId, contactIds),
                ),
              )
              .orderBy(
                sql`CASE WHEN ${crmDeals.status} = 'open' THEN 0 ELSE 1 END`,
                desc(crmDeals.createdAt),
                desc(crmDeals.updatedAt),
              );

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
                  pipelineName: link.pipelineName || null,
                  stageName: link.stageName || null,
                  operatorId: link.operatorId || null,
                  operatorName: link.operatorName || null,
                  accountId: link.accountId || null,
                  accountName: link.accountName || null,
                  lossReason: link.lossReason || null,
                  pausedReason: link.pausedReason || null,
                  rating: Number(link.rating || 0),
                  source: link.source || null,
                  campaign: link.campaign || null,
                  closedAt: link.closedAt ? new Date(link.closedAt).toISOString() : null,
                  createdAt: link.createdAt ? new Date(link.createdAt).toISOString() : null,
                  updatedAt: link.updatedAt ? new Date(link.updatedAt).toISOString() : null,
                });
                dealsByContact.set(link.contactId, existing);
              }
              if (
                link.accountId &&
                link.accountName &&
                !fallbackAccountByContact.has(link.contactId)
              ) {
                fallbackAccountByContact.set(link.contactId, {
                  accountId: link.accountId,
                  accountName: link.accountName,
                  accountDocument: link.accountDocument || null,
                  accountType: link.accountType || null,
                });
              }
            }
          }

          const enrichedItems = items.map((item) => {
            const linked = dealsByContact.get(item.id) || [];
            const fallbackAcc = !item.accountId ? fallbackAccountByContact.get(item.id) : undefined;
            const phones = phonesByContact.get(item.id) || [];
            const primaryPhone = phones.find((p) => p.isPrimary)?.phone || item.phone || null;
            const cf = ((item.customFields || {}) as Record<string, any>) || {};
            const siteVisitorId =
              typeof cf.siteVisitorId === "string" && cf.siteVisitorId
                ? cf.siteVisitorId
                : item.id.startsWith("cont-lc-")
                  ? item.id.slice("cont-lc-".length)
                  : Array.isArray(cf.linkedSiteContactIds) &&
                      typeof cf.linkedSiteContactIds[0] === "string" &&
                      cf.linkedSiteContactIds[0].startsWith("cont-lc-")
                    ? cf.linkedSiteContactIds[0].slice("cont-lc-".length)
                    : null;
            const hasSiteJourney = Boolean(
              siteVisitorId ||
                item.mainChannel === "livechat" ||
                cf.siteContext ||
                cf.siteContinuityCode ||
                (Array.isArray(cf.linkedSiteContactIds) && cf.linkedSiteContactIds.length > 0),
            );
            return {
              ...item,
              phone: primaryPhone,
              phones,
              accountId: item.accountId || fallbackAcc?.accountId || null,
              accountName: item.accountName || fallbackAcc?.accountName || null,
              accountDocument: item.accountDocument || fallbackAcc?.accountDocument || null,
              accountType: item.accountType || fallbackAcc?.accountType || null,
              siteVisitorId,
              hasSiteJourney,
              dealsCount: linked.length,
              linkedDeals: linked.slice(0, 20),
            };
          });

          return Response.json({
            contacts: enrichedItems,
            total: totals[0]?.total || 0,
            limit,
            offset,
          });
        } catch (error) {
          console.error("[GET /api/contacts] Erro ao listar contatos:", error);
          return Response.json(
            { error: "Não foi possível listar os contatos." },
            { status: 500 },
          );
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId; // SEMPRE da sessão — nunca do body
          if (
            session.operator.role !== "admin" &&
            !session.permissions?.contacts?.canCreateContact
          ) {
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          }

          const body = await request.json().catch(() => ({}));
          const { name, phone, phones: rawPhones, email, accountId, channel } = body;

          if (typeof name !== "string" || !name.trim() || name.trim().length > 200) {
            return new Response(JSON.stringify({ error: "Campo obrigatório ausente: name." }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const finalContactId = `cont-${crypto.randomUUID()}`;
          const finalConversationId = `conv-${crypto.randomUUID()}`;

          const normalizedPhonesResult = normalizeContactPhonesInput(
            rawPhones,
            typeof phone === "string" ? phone : "",
            finalContactId,
          );
          if (normalizedPhonesResult.validationError) {
            return Response.json(
              { error: normalizedPhonesResult.validationError, code: "PHONE_DDD_REQUIRED" },
              { status: 400 },
            );
          }

          const normalizedPhone = normalizedPhonesResult.primaryPhone || "";
          const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
          if (
            (phone && (typeof phone !== "string" || phone.length > 40)) ||
            (normalizedPhone && normalizedPhone.length < 8) ||
            (email != null && typeof email !== "string") ||
            normalizedEmail.length > 254 ||
            (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) ||
            (channel && !["whatsapp", "instagram", "messenger", "livechat"].includes(channel)) ||
            (accountId !== undefined && accountId !== null && typeof accountId !== "string")
          ) {
            return Response.json({ error: "Dados do contato inválidos." }, { status: 400 });
          }
          if (accountId) {
            const [account] = await db
              .select({ id: crmAccounts.id })
              .from(crmAccounts)
              .where(
                and(
                  eq(crmAccounts.tenantId, tenantId),
                  eq(crmAccounts.id, accountId),
                  sql`${crmAccounts.archivedAt} IS NULL`,
                ),
              )
              .limit(1);
            if (!account)
              return Response.json(
                { error: "Empresa não encontrada neste tenant." },
                { status: 404 },
              );
          }

          for (const p of normalizedPhonesResult.phones) {
            if (shouldIgnoreJid(p.phone)) {
              return new Response(
                JSON.stringify({
                  error:
                    "Telefone inválido: grupos, status e listas de transmissão não são aceitos como contato.",
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
          }

          const dealPermission = contactDealPermission(session, body);
          if (dealPermission) return dealPermission;
          const customFields = validateFieldValues(
            await listCustomFields(tenantId, "contact"),
            body.customFields,
            { requireOnCreate: true },
          );

          const [channelConfig] = await db
            .select({ activeProvider: channelConfigs.activeProvider })
            .from(channelConfigs)
            .where(eq(channelConfigs.tenantId, tenantId))
            .limit(1);
          const requiresExplicitCapture = channelConfig?.activeProvider === "meta";

          const duplicate = await db.transaction(async (tx) => {
            if (normalizedPhone || normalizedEmail) {
              await tx.execute(
                sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${normalizedPhone || normalizedEmail}))`,
              );
            }

            // Verifica se QUALQUER um dos números informados já pertence a um contato existente no tenant
            for (const p of normalizedPhonesResult.phones) {
              const found = await findContactByAnyPhone(tx, tenantId, p.phone);
              if (found?.contact) {
                return {
                  id: found.contact.id,
                  name: found.contact.name,
                  phone: found.contact.phone,
                  email: found.contact.email,
                  walletOperatorId: found.contact.walletOperatorId,
                };
              }
            }

            if (!normalizedPhone && normalizedEmail) {
              const [existingByEmail] = await tx
                .select({
                  id: contacts.id,
                  name: contacts.name,
                  phone: contacts.phone,
                  email: contacts.email,
                  walletOperatorId: contacts.walletOperatorId,
                })
                .from(contacts)
                .where(
                  and(eq(contacts.tenantId, tenantId), ilike(contacts.email, normalizedEmail)),
                )
                .limit(1);
              if (existingByEmail) return existingByEmail;
            }

            const now = new Date();
            await tx.insert(contacts).values({
              id: finalContactId,
              tenantId,
              name: name.trim(),
              phone: normalizedPhone || null,
              email: normalizedEmail || null,
              accountId: accountId || null,
              mainChannel: channel || "whatsapp",
              walletOperatorId: requiresExplicitCapture ? null : session.operator.id,
              responsibleName: requiresExplicitCapture ? "Na Fila" : session.operator.name,
              customFields,
              createdAt: now,
            });

            const syncedPhones = await syncContactPhones(
              tx,
              tenantId,
              finalContactId,
              normalizedPhonesResult.phones,
              normalizedPhone || null,
            );

            if (accountId) {
              await tx.insert(crmContactAccountHistory).values({
                id: `cah-${crypto.randomUUID()}`,
                tenantId,
                contactId: finalContactId,
                accountId,
                reason: "Vínculo definido no cadastro do contato",
                changedByOperatorId: session.operator.id,
                createdAt: now,
              });
            }
            await registerContactDeal(tx, session, finalContactId, accountId || null, body);
            await setAttendanceActor(tx, tenantId, session.operator.name, session.operator.id);
            await tx.insert(conversations).values({
              id: finalConversationId,
              tenantId,
              contactId: finalContactId,
              contactPhoneId: syncedPhones.primaryPhoneItem?.id || null,
              contactPhone: syncedPhones.primaryPhone || null,
              operatorId: requiresExplicitCapture ? null : session.operator.id,
              queueState: requiresExplicitCapture ? "fila" : "meus",
              lastMessageText: requiresExplicitCapture
                ? "Contato criado. Aguardando captura do atendimento."
                : "Contato criado e atendimento iniciado.",
              lastMessageTime: now,
              version: 1,
              updatedAt: now,
              createdAt: now,
            });
            await syncConversationDeals(
              tx,
              tenantId,
              finalConversationId,
              finalContactId,
              session.operator.id,
            );
            return null;
          });
          if (duplicate) {
            if (
              session.operator.role !== "admin" &&
              session.permissions?.contacts?.contactScope === "wallet_only" &&
              duplicate.walletOperatorId !== session.operator.id
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
                error: `Contato já cadastrado: ${duplicate.name}.`,
                code: "CONTACT_EXISTS",
                contactId: duplicate.id,
                contact: duplicate,
              },
              { status: 409 },
            );
          }

          return new Response(
            JSON.stringify({
              success: true,
              contactId: finalContactId,
              conversationId: finalConversationId,
              queueState: requiresExplicitCapture ? "fila" : "meus",
            }),
            {
              status: 201,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        } catch (e: any) {
          console.error("[POST /api/contacts] Erro ao criar contato e conversa no DB:", e);
          if ((e?.constraint || e?.cause?.constraint) === "contacts_tenant_phone_identity") {
            return Response.json(
              { error: "Já existe um contato com este telefone.", code: "CONTACT_EXISTS" },
              { status: 409 },
            );
          }
          return new Response(JSON.stringify({ error: e.message, code: e.code }), {
            status: e.statusCode || 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
