import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";
import { db } from "../../../../../db";
import { crmDeals, crmConversationDeals, crmDealContacts, crmAccounts, conversations, contacts, operators } from "../../../../../db/schema";
import { eq, and, desc, asc, or, ilike } from "drizzle-orm";
import { buildPhoneSearchTerms } from "../../../../../lib/utils";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/conversations")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/conversations
       * Lista os atendimentos vinculados a uma negociação (com contato, operador e datas).
       * Exige permissão canViewCrm.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };

          // Valida a negociação no tenant
          const [deal] = await db
            .select({ id: crmDeals.id, operatorId: crmDeals.operatorId })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return new Response(JSON.stringify({ error: "Negociação não encontrada.", code: "NOT_FOUND" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (
            session.operator.role !== "admin" &&
            !session.permissions?.crm?.canViewAllDeals &&
            deal.operatorId &&
            deal.operatorId !== session.operator.id
          ) {
            return new Response(
              JSON.stringify({
                error: "Acesso restrito: você não tem permissão para visualizar dados deste negócio.",
                code: "FORBIDDEN",
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Busca conversas vinculadas ativas com joins de contato e operador
          const rows = await db
            .select({
              linkId: crmConversationDeals.id,
              origin: crmConversationDeals.origin,
              linkedAt: crmConversationDeals.createdAt,
              conversation: conversations,
              contact: contacts,
              operatorName: operators.name,
            })
            .from(crmConversationDeals)
            .innerJoin(conversations, eq(crmConversationDeals.conversationId, conversations.id))
            .innerJoin(contacts, eq(conversations.contactId, contacts.id))
            .leftJoin(operators, eq(conversations.operatorId, operators.id))
            .where(
              and(
                eq(crmConversationDeals.tenantId, tenantId),
                eq(crmConversationDeals.dealId, dealId),
                eq(crmConversationDeals.isActive, true)
              )
            )
            .orderBy(desc(conversations.lastMessageTime));

          const mappedConversations = rows.map((r) => {
            const mainChan = r.contact?.mainChannel || "whatsapp";
            return {
              id: r.conversation.id,
              linkId: r.linkId,
              conversationId: r.conversation.id,
              origin: r.origin,
              linkedAt: r.linkedAt,
              queueState: r.conversation.queueState || "meus",
              lastMessageText: r.conversation.lastMessageText || null,
              lastMessageTime: r.conversation.lastMessageTime || null,
              createdAt: r.conversation.createdAt,
              contactId: r.contact?.id || r.conversation.contactId,
              contactName: r.contact?.name || "Sem nome",
              contactPhone: r.contact?.phone || null,
              contactAvatar: r.contact?.avatar || null,
              channel: mainChan,
              mainChannel: mainChan,
              operatorId: r.conversation.operatorId,
              operatorName: r.operatorName || (r.conversation.operatorId ? "Operador" : "Na Fila"),
              conversation: r.conversation,
              contact: r.contact,
            };
          });

          return new Response(JSON.stringify({ conversations: mappedConversations }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Deal Conversations API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * POST /api/crm/deals/:dealId/conversations
       * Associa uma conversa existente a esta negociação ou resolve/cria automaticamente
       * o atendimento da negociação quando `ensure: true` é informado.
       * Body: { conversationId?: string, origin?: "chat" | "crm" | "auto_sdr", ensure?: boolean, autoCapture?: boolean, phone?: string, name?: string }
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };
          let body: any = {};
          try {
            body = await request.json();
          } catch {
            body = {};
          }

          if (body?.ensure === true && !body?.conversationId) {
            const permError = requireCrmPermission(session, "canViewCrm");
            if (permError) return permError;

            const [deal] = await db
              .select({
                id: crmDeals.id,
                title: crmDeals.title,
                accountId: crmDeals.accountId,
                operatorId: crmDeals.operatorId,
              })
              .from(crmDeals)
              .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
              .limit(1);

            if (!deal) {
              return new Response(JSON.stringify({ error: "Negociação não encontrada.", code: "NOT_FOUND" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            if (
              session.operator.role !== "admin" &&
              !session.permissions?.crm?.canViewAllDeals &&
              deal.operatorId &&
              deal.operatorId !== session.operator.id
            ) {
              return new Response(
                JSON.stringify({
                  error: "Acesso restrito: você não tem permissão para visualizar dados deste negócio.",
                  code: "FORBIDDEN",
                }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            const autoCapture = body.autoCapture === true;

            const result = await db.transaction(async (tx) => {
              // 1. Verifica se já existe conversa ativa vinculada à negociação
              const [existingLinkedConv] = await tx
                .select({
                  conversation: conversations,
                })
                .from(crmConversationDeals)
                .innerJoin(
                  conversations,
                  and(
                    eq(crmConversationDeals.conversationId, conversations.id),
                    eq(conversations.tenantId, tenantId)
                  )
                )
                .where(
                  and(
                    eq(crmConversationDeals.tenantId, tenantId),
                    eq(crmConversationDeals.dealId, dealId),
                    eq(crmConversationDeals.isActive, true)
                  )
                )
                .orderBy(desc(conversations.lastMessageTime), desc(crmConversationDeals.createdAt))
                .limit(1);

              let targetConv = existingLinkedConv?.conversation || null;
              let targetContactId = targetConv?.contactId || null;
              let created = false;

              // 2. Se não há conversa vinculada, resolve ou cria o contato principal da negociação
              if (!targetContactId) {
                const [dealContactLink] = await tx
                  .select({ contactId: crmDealContacts.contactId })
                  .from(crmDealContacts)
                  .where(
                    and(
                      eq(crmDealContacts.tenantId, tenantId),
                      eq(crmDealContacts.dealId, dealId)
                    )
                  )
                  .orderBy(desc(crmDealContacts.isPrimary), asc(crmDealContacts.createdAt))
                  .limit(1);

                if (dealContactLink?.contactId) {
                  targetContactId = dealContactLink.contactId;
                }
              }

              let accountRow: { id: string; name: string; phone: string | null; email: string | null } | null = null;
              if (!targetContactId && deal.accountId) {
                const [acc] = await tx
                  .select({
                    id: crmAccounts.id,
                    name: crmAccounts.name,
                    phone: crmAccounts.phone,
                    email: crmAccounts.email,
                  })
                  .from(crmAccounts)
                  .where(and(eq(crmAccounts.id, deal.accountId), eq(crmAccounts.tenantId, tenantId)))
                  .limit(1);
                accountRow = acc || null;

                const [accContact] = await tx
                  .select({ id: contacts.id })
                  .from(contacts)
                  .where(
                    and(
                      eq(contacts.tenantId, tenantId),
                      eq(contacts.crmAccountId, deal.accountId)
                    )
                  )
                  .orderBy(desc(contacts.createdAt))
                  .limit(1);

                if (accContact?.id) {
                  targetContactId = accContact.id;
                }
              }

              const candidatePhone =
                (typeof body.phone === "string" && body.phone.trim()) ||
                accountRow?.phone ||
                "";

              if (!targetContactId && candidatePhone) {
                const terms = buildPhoneSearchTerms(candidatePhone);
                if (terms.length > 0) {
                  const phoneConditions = terms.map((term) => ilike(contacts.phone, `%${term}%`));
                  const [phoneContact] = await tx
                    .select({ id: contacts.id })
                    .from(contacts)
                    .where(and(eq(contacts.tenantId, tenantId), or(...phoneConditions)))
                    .orderBy(desc(contacts.createdAt))
                    .limit(1);
                  if (phoneContact?.id) {
                    targetContactId = phoneContact.id;
                  }
                }
              }

              if (!targetContactId) {
                const contactName =
                  (typeof body.name === "string" && body.name.trim()) ||
                  accountRow?.name ||
                  deal.title ||
                  "Contato CRM";
                const [newContact] = await tx
                  .insert(contacts)
                  .values({
                    tenantId,
                    name: contactName,
                    phone: candidatePhone || null,
                    email: accountRow?.email || null,
                    company: accountRow?.name || null,
                    crmAccountId: deal.accountId || null,
                    mainChannel: "whatsapp",
                  })
                  .returning({ id: contacts.id });
                targetContactId = newContact.id;
              }

              // Garante vínculo do contato em crm_deal_contacts
              if (targetContactId) {
                await tx
                  .insert(crmDealContacts)
                  .values({
                    tenantId,
                    dealId,
                    contactId: targetContactId,
                    isPrimary: true,
                  })
                  .onConflictDoNothing();
              }

              // 3. Resolve ou cria a conversa para targetContactId
              if (!targetConv && targetContactId) {
                const [existingConv] = await tx
                  .select()
                  .from(conversations)
                  .where(
                    and(
                      eq(conversations.tenantId, tenantId),
                      eq(conversations.contactId, targetContactId)
                    )
                  )
                  .orderBy(desc(conversations.lastMessageTime), desc(conversations.createdAt))
                  .limit(1);

                if (existingConv) {
                  targetConv = existingConv;
                } else {
                  const [contactObj] = await tx
                    .select()
                    .from(contacts)
                    .where(and(eq(contacts.id, targetContactId), eq(contacts.tenantId, tenantId)))
                    .limit(1);

                  if (contactObj?.phone) {
                    const terms = buildPhoneSearchTerms(contactObj.phone);
                    if (terms.length > 0) {
                      const phoneConditions = terms.map((term) => ilike(contacts.phone, `%${term}%`));
                      const [otherHistory] = await tx
                        .select({ conversation: conversations })
                        .from(conversations)
                        .innerJoin(
                          contacts,
                          and(
                            eq(conversations.contactId, contacts.id),
                            eq(contacts.tenantId, tenantId)
                          )
                        )
                        .where(
                          and(
                            eq(conversations.tenantId, tenantId),
                            or(...phoneConditions)
                          )
                        )
                        .orderBy(desc(conversations.lastMessageTime), desc(conversations.createdAt))
                        .limit(1);

                      if (otherHistory?.conversation) {
                        targetConv = otherHistory.conversation;
                      }
                    }
                  }
                }

                if (!targetConv) {
                  const now = new Date();
                  const [insertedConv] = await tx
                    .insert(conversations)
                    .values({
                      tenantId,
                      contactId: targetContactId,
                      operatorId: session.operator.id,
                      sectorId: session.operator.sectorId || null,
                      queueState: "meus",
                      unreadCount: 0,
                      lastMessageText: "Atendimento iniciado pelo CRM",
                      lastMessageTime: now,
                      createdAt: now,
                      updatedAt: now,
                    })
                    .returning();
                  targetConv = insertedConv;
                  created = true;
                }
              }

              if (targetConv) {
                if (
                  autoCapture &&
                  !(targetConv.queueState === "meus" && targetConv.operatorId && targetConv.operatorId !== session.operator.id) &&
                  (targetConv.queueState !== "meus" || !targetConv.operatorId)
                ) {
                  await tx
                    .update(conversations)
                    .set({
                      queueState: "meus",
                      operatorId: session.operator.id,
                      updatedAt: new Date(),
                    })
                    .where(
                      and(
                        eq(conversations.id, targetConv.id),
                        eq(conversations.tenantId, tenantId)
                      )
                    );
                }

                // Garante vínculo ativo em crm_conversation_deals
                const [existingDealConvLink] = await tx
                  .select({ id: crmConversationDeals.id, isActive: crmConversationDeals.isActive })
                  .from(crmConversationDeals)
                  .where(
                    and(
                      eq(crmConversationDeals.tenantId, tenantId),
                      eq(crmConversationDeals.conversationId, targetConv.id),
                      eq(crmConversationDeals.dealId, dealId)
                    )
                  )
                  .limit(1);

                if (!existingDealConvLink) {
                  await tx.insert(crmConversationDeals).values({
                    tenantId,
                    conversationId: targetConv.id,
                    dealId,
                    linkedByOperatorId: session.operator.id,
                    origin: "crm",
                    isActive: true,
                  });
                } else if (!existingDealConvLink.isActive) {
                  await tx
                    .update(crmConversationDeals)
                    .set({
                      isActive: true,
                      unlinkedAt: null,
                      unlinkedByOperatorId: null,
                    })
                    .where(
                      and(
                        eq(crmConversationDeals.id, existingDealConvLink.id),
                        eq(crmConversationDeals.tenantId, tenantId)
                      )
                    );
                }
              }

              return {
                conversationId: targetConv?.id || null,
                contactId: targetContactId,
                created,
              };
            });

            return new Response(
              JSON.stringify({
                success: true,
                conversationId: result.conversationId,
                contactId: result.contactId,
                created: result.created,
              }),
              {
                status: result.created ? 201 : 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          if (!body.conversationId) {
            return new Response(
              JSON.stringify({ error: "O campo conversationId é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const link = await crmService.linkConversationDeal(
            tenantId,
            body.conversationId,
            dealId,
            session.operator.id,
            body.origin || "crm"
          );

          return new Response(JSON.stringify({ success: true, link }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Deal Conversations API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/deals/:dealId/conversations
       * Desvincula uma conversa desta negociação sem exclui-la.
       * Suporta conversationId no Body JSON ou Query string (?conversationId=...).
       * Exige permissão canEditDeals.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };

          // Tenta ler conversationId da query string
          const url = new URL(request.url);
          let conversationId = url.searchParams.get("conversationId");

          // Se não estiver na query, tenta ler do body
          if (!conversationId) {
            try {
              const body = await request.json();
              conversationId = body.conversationId;
            } catch {
              // Body vazio ou inválido
            }
          }

          if (!conversationId) {
            return new Response(
              JSON.stringify({ error: "O campo conversationId é obrigatório (via body ou query string).", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await crmService.unlinkConversationDeal(
            tenantId,
            conversationId,
            dealId,
            session.operator.id
          );

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Deal Conversations API] Erro no DELETE:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
