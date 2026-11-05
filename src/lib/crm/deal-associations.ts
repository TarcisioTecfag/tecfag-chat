import { and, eq, inArray, notInArray, sql, asc } from "drizzle-orm";
import type { db } from "../../db";
import {
  contacts,
  conversations,
  crmDeals,
  crmDealContacts,
  crmConversationDeals,
} from "../../db/schema";
import { resolveRelatedContactIds } from "./contact-deals-query";

export type DealTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const DEAL_REQUIRED_MESSAGE =
  "Todo contato e atendimento precisa de uma negociação. Vincule uma existente ou crie uma para continuar.";

export interface BlockingConversationItem {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  channel: string;
  queueState: string;
  lastMessageText: string | null;
  lastMessageTime: string | null;
}

export interface BlockingDealItem {
  dealId: string;
  dealTitle: string;
  dealCode: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  conversations: BlockingConversationItem[];
}

export class DealRequiredError extends Error {
  readonly code = "DEAL_REQUIRED";
  readonly statusCode = 409;
  readonly blockingDeals?: BlockingDealItem[];
  readonly allTargetDealIds?: string[];
  constructor(blockingDeals?: BlockingDealItem[], allTargetDealIds?: string[]) {
    super(DEAL_REQUIRED_MESSAGE);
    if (blockingDeals && blockingDeals.length > 0) {
      this.blockingDeals = blockingDeals;
    }
    if (allTargetDealIds && allTargetDealIds.length > 0) {
      this.allTargetDealIds = allTargetDealIds;
    }
  }
}

/** Serializa também a chegada fora de ordem de card e mensagem para um contato. */
export async function lockContactDeals(tx: DealTransaction, tenantId: string, contactId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${"contact-deals:" + contactId}))`,
  );
}

export async function conversationHasDeal(
  executor: Pick<DealTransaction, "select">,
  tenantId: string,
  conversationId: string,
  contactId: string,
) {
  const contactIds = await resolveRelatedContactIds(executor, tenantId, contactId);
  if (contactIds.length > 0) {
    const [participant] = await executor
      .select({ id: crmDealContacts.id })
      .from(crmDealContacts)
      .innerJoin(
        crmDeals,
        and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, crmDealContacts.dealId)),
      )
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          contactIds.length === 1
            ? eq(crmDealContacts.contactId, contactIds[0])
            : inArray(crmDealContacts.contactId, contactIds),
        ),
      )
      .limit(1);
    if (participant) return true;
  }
  const [link] = await executor
    .select({ id: crmConversationDeals.id })
    .from(crmConversationDeals)
    .innerJoin(
      crmDeals,
      and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, crmConversationDeals.dealId)),
    )
    .where(
      and(
        eq(crmConversationDeals.tenantId, tenantId),
        eq(crmConversationDeals.conversationId, conversationId),
        eq(crmConversationDeals.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(link);
}


/** Exclusões em lote também não podem retirar o último card de um contato/atendimento. */
export async function assertDealsCanBeRemoved(
  tx: DealTransaction,
  tenantId: string,
  dealIds: string[],
  options?: {
    deleteConversationIds?: string[];
    deleteContactIds?: string[];
  },
): Promise<{
  conversationIdsToDelete: string[];
  contactIdsToDelete: string[];
}> {
  const participants = await tx
    .select({
      dealId: crmDealContacts.dealId,
      contactId: crmDealContacts.contactId,
    })
    .from(crmDealContacts)
    .where(and(eq(crmDealContacts.tenantId, tenantId), inArray(crmDealContacts.dealId, dealIds)));
  const linkedConvs = await tx
    .select({
      dealId: crmConversationDeals.dealId,
      contactId: conversations.contactId,
      conversationId: conversations.id,
    })
    .from(crmConversationDeals)
    .innerJoin(
      conversations,
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.id, crmConversationDeals.conversationId),
      ),
    )
    .where(
      and(
        eq(crmConversationDeals.tenantId, tenantId),
        inArray(crmConversationDeals.dealId, dealIds),
        eq(crmConversationDeals.isActive, true),
      ),
    );

  const contactToDealIds = new Map<string, Set<string>>();
  for (const p of participants) {
    if (!contactToDealIds.has(p.contactId)) contactToDealIds.set(p.contactId, new Set());
    contactToDealIds.get(p.contactId)!.add(p.dealId);
  }
  for (const lc of linkedConvs) {
    if (!contactToDealIds.has(lc.contactId)) contactToDealIds.set(lc.contactId, new Set());
    contactToDealIds.get(lc.contactId)!.add(lc.dealId);
  }

  const requestedConvDeleteSet = new Set(options?.deleteConversationIds || []);
  const requestedContactDeleteSet = new Set(options?.deleteContactIds || []);
  const conversationIdsToDelete = new Set<string>();
  const contactIdsToDelete = new Set<string>();

  const blockingContactEntries: Array<{
    contactId: string;
    dealIds: Set<string>;
    convs: Array<{
      id: string;
      contactId: string;
      queueState: string;
      lastMessageText: string | null;
      lastMessageTime: Date | null;
    }>;
  }> = [];

  for (const contactId of [
    ...new Set([...participants, ...linkedConvs].map((p) => p.contactId)),
  ].sort()) {
    await lockContactDeals(tx, tenantId, contactId);
    const [other] = await tx
      .select({ id: crmDealContacts.id })
      .from(crmDealContacts)
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          eq(crmDealContacts.contactId, contactId),
          notInArray(crmDealContacts.dealId, dealIds),
        ),
      )
      .limit(1);

    const convs = await tx
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        queueState: conversations.queueState,
        lastMessageText: conversations.lastMessageText,
        lastMessageTime: conversations.lastMessageTime,
      })
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId)));

    if (!other) {
      if (convs.length > 0) {
        const selectedConvsForContact = convs.filter((c) => requestedConvDeleteSet.has(c.id));
        if (requestedContactDeleteSet.has(contactId) || selectedConvsForContact.length === convs.length) {
          for (const c of convs) conversationIdsToDelete.add(c.id);
          contactIdsToDelete.add(contactId);
          continue;
        }
        if (selectedConvsForContact.length > 0) {
          for (const c of selectedConvsForContact) conversationIdsToDelete.add(c.id);
          continue;
        }
      } else {
        if (
          requestedContactDeleteSet.has(contactId) ||
          requestedConvDeleteSet.has(`contact:${contactId}`)
        ) {
          contactIdsToDelete.add(contactId);
          continue;
        }
      }

      blockingContactEntries.push({
        contactId,
        dealIds: contactToDealIds.get(contactId) || new Set(),
        convs,
      });
      continue;
    }

    for (const conv of convs) {
      if (requestedConvDeleteSet.has(conv.id)) {
        conversationIdsToDelete.add(conv.id);
      } else {
        await syncConversationDeals(tx, tenantId, conv.id, contactId);
      }
    }
  }

  if (blockingContactEntries.length > 0) {
    const blockingContactIds = blockingContactEntries.map((e) => e.contactId);
    const blockingDealIdsSet = new Set<string>();
    for (const entry of blockingContactEntries) {
      for (const dId of entry.dealIds) blockingDealIdsSet.add(dId);
    }
    const blockingDealIds = [...blockingDealIdsSet];

    const contactRows =
      blockingContactIds.length > 0
        ? await tx
            .select({
              id: contacts.id,
              name: contacts.name,
              phone: contacts.phone,
              mainChannel: contacts.mainChannel,
            })
            .from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, blockingContactIds)))
        : [];
    const contactMap = new Map(contactRows.map((c) => [c.id, c]));

    const dealRows =
      blockingDealIds.length > 0
        ? await tx
            .select({
              id: crmDeals.id,
              title: crmDeals.title,
            })
            .from(crmDeals)
            .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, blockingDealIds)))
        : [];
    const dealMap = new Map(dealRows.map((d) => [d.id, d]));

    const blockingByDeal = new Map<string, BlockingDealItem>();

    for (const entry of blockingContactEntries) {
      const contactInfo = contactMap.get(entry.contactId);
      const contactName = contactInfo?.name || "Contato sem nome";
      const contactPhone = contactInfo?.phone || null;
      const channel = contactInfo?.mainChannel || "whatsapp";

      const convItems: BlockingConversationItem[] =
        entry.convs.length > 0
          ? entry.convs.map((c) => ({
              id: c.id,
              contactId: entry.contactId,
              contactName,
              contactPhone,
              channel,
              queueState: c.queueState,
              lastMessageText: c.lastMessageText,
              lastMessageTime: c.lastMessageTime ? c.lastMessageTime.toISOString() : null,
            }))
          : [
              {
                id: `contact:${entry.contactId}`,
                contactId: entry.contactId,
                contactName,
                contactPhone,
                channel,
                queueState: "contato",
                lastMessageText: "Contato vinculado sem histórico de mensagens",
                lastMessageTime: null,
              },
            ];

      for (const dId of entry.dealIds) {
        const dealInfo = dealMap.get(dId);
        const existing = blockingByDeal.get(dId);
        if (!existing) {
          blockingByDeal.set(dId, {
            dealId: dId,
            dealTitle: dealInfo?.title || dId,
            dealCode: `#${dId.slice(-5)}`,
            contactId: entry.contactId,
            contactName,
            contactPhone,
            conversations: [...convItems],
          });
        } else {
          for (const ci of convItems) {
            if (!existing.conversations.some((x) => x.id === ci.id)) {
              existing.conversations.push(ci);
            }
          }
        }
      }
    }

    const orderedBlockingDeals = dealIds
      .filter((id) => blockingByDeal.has(id))
      .map((id) => blockingByDeal.get(id)!);

    throw new DealRequiredError(orderedBlockingDeals, dealIds);
  }

  return {
    conversationIdsToDelete: [...conversationIdsToDelete],
    contactIdsToDelete: [...contactIdsToDelete],
  };
}

export async function linkContactToDeal(
  tx: DealTransaction,
  tenantId: string,
  contactId: string,
  dealId: string,
  operatorId: string | null,
) {
  await lockContactDeals(tx, tenantId, contactId);
  const [contact] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
    .limit(1);
  const [deal] = await tx
    .select({ id: crmDeals.id })
    .from(crmDeals)
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)))
    .limit(1);
  if (!contact || !deal)
    throw Object.assign(new Error("Contato ou negociação indisponível nesta empresa."), {
      statusCode: 404,
    });
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${"deal-participants:" + dealId}))`,
  );
  const participants = await tx
    .select({ contactId: crmDealContacts.contactId, isPrimary: crmDealContacts.isPrimary })
    .from(crmDealContacts)
    .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, dealId)));
  if (!participants.some((p) => p.contactId === contactId)) {
    await tx.insert(crmDealContacts).values({
      id: `dc-${crypto.randomUUID()}`,
      tenantId,
      dealId,
      contactId,
      role: "buyer",
      isPrimary: !participants.some((p) => p.isPrimary),
    });
  }
  const convs = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId)));
  for (const conv of convs)
    await syncConversationDeals(tx, tenantId, conv.id, contactId, operatorId);
}

/** Ao selecionar uma empresa, inclui seus contatos sem substituir participantes anteriores. */
export async function syncAccountDealContacts(
  tx: DealTransaction,
  tenantId: string,
  dealId: string,
  accountId: string,
  operatorId: string | null,
) {
  const companyContacts = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.accountId, accountId)))
    .orderBy(asc(contacts.id));
  for (const contact of companyContacts)
    await linkContactToDeal(tx, tenantId, contact.id, dealId, operatorId);
}

/** Card antes da mensagem e mensagem antes do card convergem para a mesma relação N:N. */
export async function syncConversationDeals(
  tx: DealTransaction,
  tenantId: string,
  conversationId: string,
  contactId: string,
  operatorId: string | null = null,
): Promise<boolean> {
  await lockContactDeals(tx, tenantId, contactId);
  const [conversation] = await tx
    .select({ contactId: conversations.contactId })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
    .limit(1);
  if (!conversation || conversation.contactId !== contactId)
    throw Object.assign(new Error("Conversa e contato não correspondem nesta empresa."), {
      statusCode: 409,
      code: "CONTACT_CONVERSATION_MISMATCH",
    });
  const participantDeals = await tx
    .select({ id: crmDeals.id })
    .from(crmDealContacts)
    .innerJoin(
      crmDeals,
      and(eq(crmDeals.id, crmDealContacts.dealId), eq(crmDeals.tenantId, tenantId)),
    )
    .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.contactId, contactId)));
  const ids = [...new Set(participantDeals.map((d) => d.id))];
  if (ids.length) {
    const existing = await tx
      .select()
      .from(crmConversationDeals)
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.conversationId, conversationId),
          inArray(crmConversationDeals.dealId, ids),
        ),
      );
    for (const dealId of ids) {
      const link =
        existing.find((l) => l.dealId === dealId && l.isActive) ||
        existing.find((l) => l.dealId === dealId);
      if (!link)
        await tx.insert(crmConversationDeals).values({
          id: `cd-${crypto.randomUUID()}`,
          tenantId,
          conversationId,
          dealId,
          origin: "crm",
          createdByOperatorId: operatorId,
          isActive: true,
        });
      else if (!link.isActive)
        await tx
          .update(crmConversationDeals)
          .set({ isActive: true, unlinkedAt: null, unlinkedByOperatorId: null })
          .where(
            and(eq(crmConversationDeals.tenantId, tenantId), eq(crmConversationDeals.id, link.id)),
          );
    }
  }
  const [linked] = await tx
    .select({ id: crmConversationDeals.id })
    .from(crmConversationDeals)
    .innerJoin(
      crmDeals,
      and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId)),
    )
    .where(
      and(
        eq(crmConversationDeals.tenantId, tenantId),
        eq(crmConversationDeals.conversationId, conversationId),
        eq(crmConversationDeals.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(linked);
}
