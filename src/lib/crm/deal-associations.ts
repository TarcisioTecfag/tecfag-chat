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

export class DealRequiredError extends Error {
  readonly code = "DEAL_REQUIRED";
  readonly statusCode = 409;
  constructor() {
    super(DEAL_REQUIRED_MESSAGE);
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
) {
  const participants = await tx
    .select({ contactId: crmDealContacts.contactId })
    .from(crmDealContacts)
    .where(and(eq(crmDealContacts.tenantId, tenantId), inArray(crmDealContacts.dealId, dealIds)));
  const linkedConvs = await tx
    .select({ contactId: conversations.contactId })
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
    if (!other) throw new DealRequiredError();
    const convs = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId)));
    for (const conv of convs) await syncConversationDeals(tx, tenantId, conv.id, contactId);
  }
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
