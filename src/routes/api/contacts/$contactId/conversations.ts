import { syncConversationDeals, DealRequiredError } from "../../../../lib/crm/deal-associations";
import { contactDealPermission, registerContactDeal } from "../../../../lib/crm/contact-registration";
import { createFileRoute } from "@tanstack/react-router";
import { isNull, and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "../../../../db";
import {
  channelConfigs,
  contacts,
  conversations,
  crmConversationDeals,
  crmDealContacts,
  crmDeals,
} from "../../../../db/schema";
import { requireSession } from "../../../../lib/auth-session";
import { buildPhoneSearchTerms } from "../../../../lib/utils";
import { conversationReadCondition } from "../../../../lib/access-control/conversation-access";
import { canReadConversation } from "../../../../lib/access-control/conversation-policy";

export const Route = createFileRoute("/api/contacts/$contactId/conversations")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.permissions?.views?.chat !== true) {
          return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        }
        const contactId = params.contactId;
        const body = await request.json().catch(() => ({} as Record<string, unknown>));
        const requestedDealId = typeof body?.dealId === "string" && body.dealId.trim() ? body.dealId.trim() : null;
        if (body?.dealId || body?.newDeal) {
          const permission = contactDealPermission(session, body);
          if (permission) return permission;
        }
        const autoCapture = Boolean(body?.autoCapture);

        try {
          const [channel] = await db.select({ activeProvider: channelConfigs.activeProvider })
            .from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId)).limit(1);
          const requiresExplicitCapture = channel?.activeProvider === "meta";
          const canCapture = session.permissions?.chat?.canCaptureChat === true;

          const result = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${contactId}))`);
            const [contact] = await tx.select({
              id: contacts.id,
              walletOperatorId: contacts.walletOperatorId,
              phone: contacts.phone,
              mainChannel: contacts.mainChannel,
            })
              .from(contacts)
              .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
              .limit(1);
            if (!contact) return null;
            if (
              session.operator.role !== "admin" &&
              session.permissions?.contacts?.contactScope === "wallet_only" &&
              contact.walletOperatorId &&
              contact.walletOperatorId !== session.operator.id
            ) {
              return { forbidden: true } as const;
            }

            const now = new Date();

            const syncConversationWithDeals = async (convId: string, actualContactId = contactId) => {
              return syncConversationDeals(tx, tenantId, convId, actualContactId, session.operator.id);
            };

            const [existing] = await tx.select({
              id: conversations.id,
              contactId: conversations.contactId,
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
            }).from(conversations)
              .where(and(eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId), eq(conversations.contactId, contactId)))
              .orderBy(
                sql`CASE WHEN ${conversations.queueState} != 'finalizados' THEN 0 ELSE 1 END`,
                desc(conversations.lastMessageTime)
              )
              .limit(1);

            let targetConv = existing || null;

            if (!targetConv) {
              const normalizedPhone = contact.phone?.replace(/\D/g, "") || "";
              if (normalizedPhone.length >= 8) {
                await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${normalizedPhone}))`);
                const phoneTerms = buildPhoneSearchTerms(normalizedPhone);
                const phoneCondition =
                  phoneTerms.length > 0
                    ? or(...phoneTerms.map((term) => sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}`))
                    : sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${normalizedPhone}`;

                const [otherHistory] = await tx.select({
                  id: conversations.id,
                  contactId: conversations.contactId,
                  operatorId: conversations.operatorId,
                  queueState: conversations.queueState,
                })
                  .from(conversations)
                  .innerJoin(contacts, and(eq(conversations.contactId, contacts.id), eq(contacts.tenantId, tenantId)))
                  .where(and(
                    eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId),
                    ne(contacts.id, contactId),
                    phoneCondition,
                  ))
                  .orderBy(
                    sql`CASE WHEN ${conversations.queueState} != 'finalizados' THEN 0 ELSE 1 END`,
                    desc(conversations.lastMessageTime)
                  )
                  .limit(1);

                if (otherHistory) {
                  targetConv = otherHistory;
                }
              }
            }

            if (targetConv) {
              const [visible] = await tx.select({ id: conversations.id }).from(conversations).where(and(
                eq(conversations.id, targetConv.id), eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId), conversationReadCondition(session),
              )).limit(1);
              if (!visible) return { forbidden: true } as const;
            }
            const actualContactId = targetConv?.contactId || contactId;
            if (requestedDealId || body?.newDeal) await registerContactDeal(tx, session, actualContactId, null, body);
            if (targetConv && !await syncConversationWithDeals(targetConv.id, actualContactId)) {
              return { conversationId: targetConv.id, created: false, readOnly: true, dealRequired: true, queueState: targetConv.queueState };
            }
            if (!targetConv) {
              const [participant] = await tx.select({ id: crmDealContacts.id }).from(crmDealContacts)
                .innerJoin(crmDeals, and(eq(crmDeals.id, crmDealContacts.dealId), eq(crmDeals.tenantId, tenantId)))
                .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.contactId, actualContactId))).limit(1);
              if (!participant) throw new DealRequiredError();
            }
            if (targetConv) {
              const isOwnedByAnotherOperator =
                targetConv.queueState === "meus" &&
                Boolean(targetConv.operatorId) &&
                targetConv.operatorId !== session.operator.id;

              const shouldAssignToCurrentOperator =
                !isOwnedByAnotherOperator && canCapture && (!requiresExplicitCapture || autoCapture);

              if (!shouldAssignToCurrentOperator) {
                if (targetConv.queueState === "finalizados") {
                  await tx.update(conversations)
                    .set({ operatorId: null, queueState: "fila", updatedAt: now })
                    .where(and(eq(conversations.id, targetConv.id), eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId)));
                }
                await syncConversationWithDeals(targetConv.id, targetConv.contactId);
                return {
                  conversationId: targetConv.id,
                  created: false,
                  readOnly:
                    targetConv.queueState === "finalizados" ||
                    targetConv.operatorId !== session.operator.id ||
                    targetConv.queueState !== "meus",
                  queueState: targetConv.queueState === "finalizados" ? "fila" : targetConv.queueState,
                };
              }

              await tx.update(conversations)
                .set({
                  operatorId: session.operator.id,
                  queueState: "meus",
                  lastMessageTime: now,
                  updatedAt: now,
                })
                .where(and(eq(conversations.id, targetConv.id), eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId)));

              await tx.update(contacts)
                .set({
                  walletOperatorId: contact.walletOperatorId || session.operator.id,
                  responsibleName: session.operator.name,
                })
                .where(and(eq(contacts.id, targetConv.contactId), eq(contacts.tenantId, tenantId)));

              await syncConversationWithDeals(targetConv.id, targetConv.contactId);
              return { conversationId: targetConv.id, created: false, readOnly: false, queueState: "meus" };
            }

            const assignNewConv = canCapture && (!requiresExplicitCapture || autoCapture);
            if (!canReadConversation(session, { tenantId, operatorId: assignNewConv ? session.operator.id : null,
              queueState: assignNewConv ? "meus" : "fila", mainChannel: contact.mainChannel })) {
              throw Object.assign(new Error("Permissão insuficiente para iniciar este atendimento."), { statusCode: 403 });
            }
            const conversationId = `conv-${crypto.randomUUID()}`;
            await tx.insert(conversations).values({
              id: conversationId,
              tenantId,
              contactId,
              operatorId: assignNewConv ? session.operator.id : null,
              queueState: assignNewConv ? "meus" : "fila",
              lastMessageText: "Atendimento iniciado.",
              lastMessageTime: now,
              createdAt: now,
              updatedAt: now,
            });

            if (assignNewConv) {
              await tx.update(contacts)
                .set({
                  walletOperatorId: contact.walletOperatorId || session.operator.id,
                  responsibleName: session.operator.name,
                })
                .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));
            }

            await syncConversationWithDeals(conversationId);
            return {
              conversationId,
              created: true,
              readOnly: !assignNewConv,
              queueState: assignNewConv ? "meus" : "fila",
            };
          });
          if (!result) return Response.json({ error: "Contato não encontrado." }, { status: 404 });
          if ("forbidden" in result) return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          return Response.json(result, { status: result.created ? 201 : 200 });
        } catch (error) {
          if (error instanceof DealRequiredError) return Response.json({ error: error.message, code: error.code, contactId }, { status: 409 });
          if (error && typeof error === "object" && "statusCode" in error) return Response.json({ error: error instanceof Error ? error.message : "Falha ao vincular negociação." }, { status: Number(error.statusCode) || 400 });
          console.error("[POST /api/contacts/:id/conversations] Falha:", error);
          return Response.json({ error: "Não foi possível iniciar o atendimento." }, { status: 500 });
        }
      },
    },
  },
});
