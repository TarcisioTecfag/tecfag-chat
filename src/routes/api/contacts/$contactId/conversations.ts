import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
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

export const Route = createFileRoute("/api/contacts/$contactId/conversations")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin" && !session.permissions?.views?.chat) {
          return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        }
        const contactId = params.contactId;
        const body = await request.json().catch(() => ({} as Record<string, unknown>));
        const requestedDealId = typeof body?.dealId === "string" && body.dealId.trim() ? body.dealId.trim() : null;
        const autoCapture = Boolean(body?.autoCapture);

        try {
          const [channel] = await db.select({ activeProvider: channelConfigs.activeProvider })
            .from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId)).limit(1);
          const requiresExplicitCapture = channel?.activeProvider === "meta";
          const canCapture = session.operator.role === "admin" || session.permissions?.chat?.canCaptureChat !== false;

          const result = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${contactId}))`);
            const [contact] = await tx.select({
              id: contacts.id,
              walletOperatorId: contacts.walletOperatorId,
              phone: contacts.phone,
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

            const syncConversationWithDeals = async (convId: string) => {
              const dealContactRows = await tx
                .select({ dealId: crmDealContacts.dealId })
                .from(crmDealContacts)
                .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.contactId, contactId)));

              const targetDealIds = new Set<string>(dealContactRows.map((r) => r.dealId));
              if (requestedDealId) {
                const [validDeal] = await tx
                  .select({ id: crmDeals.id })
                  .from(crmDeals)
                  .where(and(eq(crmDeals.id, requestedDealId), eq(crmDeals.tenantId, tenantId)))
                  .limit(1);
                if (validDeal) targetDealIds.add(validDeal.id);
              }

              if (targetDealIds.size === 0) return;

              const dealIdArray = Array.from(targetDealIds);
              const existingLinks = await tx
                .select({
                  id: crmConversationDeals.id,
                  dealId: crmConversationDeals.dealId,
                  isActive: crmConversationDeals.isActive,
                })
                .from(crmConversationDeals)
                .where(
                  and(
                    eq(crmConversationDeals.tenantId, tenantId),
                    eq(crmConversationDeals.conversationId, convId),
                    inArray(crmConversationDeals.dealId, dealIdArray)
                  )
                );

              const existingByDeal = new Map(existingLinks.map((l) => [l.dealId, l]));
              for (const dId of dealIdArray) {
                const existingLink = existingByDeal.get(dId);
                if (existingLink) {
                  if (!existingLink.isActive) {
                    await tx
                      .update(crmConversationDeals)
                      .set({ isActive: true })
                      .where(and(eq(crmConversationDeals.id, existingLink.id), eq(crmConversationDeals.tenantId, tenantId)));
                  }
                } else {
                  await tx.insert(crmConversationDeals).values({
                    id: `cd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                    tenantId,
                    conversationId: convId,
                    dealId: dId,
                    origin: "crm",
                    createdByOperatorId: session.operator.id,
                    isActive: true,
                    createdAt: now,
                  });
                }
              }
            };

            const [existing] = await tx.select({
              id: conversations.id,
              contactId: conversations.contactId,
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
            }).from(conversations)
              .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId)))
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
                    eq(conversations.tenantId, tenantId),
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
              const isOwnedByAnotherOperator =
                targetConv.queueState === "meus" &&
                Boolean(targetConv.operatorId) &&
                targetConv.operatorId !== session.operator.id;

              const shouldAssignToCurrentOperator =
                !requiresExplicitCapture || (autoCapture && !isOwnedByAnotherOperator && canCapture);

              if (!shouldAssignToCurrentOperator) {
                if (targetConv.queueState === "finalizados") {
                  await tx.update(conversations)
                    .set({ operatorId: null, queueState: "fila", updatedAt: now })
                    .where(and(eq(conversations.id, targetConv.id), eq(conversations.tenantId, tenantId)));
                }
                await syncConversationWithDeals(targetConv.id);
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
                .where(and(eq(conversations.id, targetConv.id), eq(conversations.tenantId, tenantId)));

              await tx.update(contacts)
                .set({
                  walletOperatorId: contact.walletOperatorId || session.operator.id,
                  responsibleName: session.operator.name,
                })
                .where(and(eq(contacts.id, targetConv.contactId), eq(contacts.tenantId, tenantId)));

              await syncConversationWithDeals(targetConv.id);
              return { conversationId: targetConv.id, created: false, readOnly: false, queueState: "meus" };
            }

            const assignNewConv = !requiresExplicitCapture || (autoCapture && canCapture);
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
          console.error("[POST /api/contacts/:id/conversations] Falha:", error);
          return Response.json({ error: "Não foi possível iniciar o atendimento." }, { status: 500 });
        }
      },
    },
  },
});
