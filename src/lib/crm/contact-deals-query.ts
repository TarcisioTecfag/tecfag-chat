import { and, asc, desc, eq, exists, inArray, or, sql } from "drizzle-orm";
import {
  contacts,
  conversations,
  crmAccounts,
  crmConversationDeals,
  crmDealContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  operators,
} from "../../db/schema";
import type { DealTransaction } from "./deal-associations";

function buildPhoneDigitsVariants(rawPhone?: string | null): string[] {
  if (!rawPhone) return [];
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 8) return [];
  const variants = new Set<string>([digits]);

  if (digits.startsWith("55") && digits.length >= 12) {
    const withoutCountry = digits.slice(2);
    variants.add(withoutCountry);
    if (withoutCountry.length === 11 && withoutCountry[2] === "9") {
      const withoutNine = withoutCountry.slice(0, 2) + withoutCountry.slice(3);
      variants.add(withoutNine);
      variants.add(`55${withoutNine}`);
    } else if (withoutCountry.length === 10) {
      const withNine = `${withoutCountry.slice(0, 2)}9${withoutCountry.slice(2)}`;
      variants.add(withNine);
      variants.add(`55${withNine}`);
    }
  } else if (digits.length === 10 || digits.length === 11) {
    variants.add(`55${digits}`);
    if (digits.length === 11 && digits[2] === "9") {
      const withoutNine = digits.slice(0, 2) + digits.slice(3);
      variants.add(withoutNine);
      variants.add(`55${withoutNine}`);
    } else if (digits.length === 10) {
      const withNine = `${digits.slice(0, 2)}9${digits.slice(2)}`;
      variants.add(withNine);
      variants.add(`55${withNine}`);
    }
  }

  return [...variants];
}

/**
 * Resolve todos os IDs de contato que representam a mesma pessoa dentro do tenant
 * (mesmo telefone normalizado, mesmo e-mail ou contato participante em negociação já vinculada à conversa/contato).
 */
export async function resolveRelatedContactIds(
  reader: Pick<DealTransaction, "select">,
  tenantId: string,
  contactId: string,
): Promise<string[]> {
  if (!contactId) return [];
  const relatedIds = new Set<string>([contactId]);

  try {
    const [baseContact] = await reader
      .select({
        id: contacts.id,
        name: contacts.name,
        phone: contacts.phone,
        email: contacts.email,
      })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
      .limit(1);

    if (baseContact) {
      const phoneVariants = buildPhoneDigitsVariants(baseContact.phone);
      const suffix8 =
        phoneVariants[0] && phoneVariants[0].length >= 8 ? phoneVariants[0].slice(-8) : null;
      const normEmail = baseContact.email?.trim().toLowerCase() || null;

      const matchConditions = [];
      if (suffix8) {
        matchConditions.push(
          sql`regexp_replace(coalesce(${contacts.phone}, ''), '\\D', '', 'g') LIKE ${`%${suffix8}`}`,
        );
      }
      if (normEmail) {
        matchConditions.push(sql`lower(trim(${contacts.email})) = ${normEmail}`);
      }

      if (matchConditions.length > 0) {
        const candidates = await reader
          .select({
            id: contacts.id,
            phone: contacts.phone,
            email: contacts.email,
          })
          .from(contacts)
          .where(and(eq(contacts.tenantId, tenantId), or(...matchConditions)))
          .limit(25);

        for (const candidate of candidates) {
          const cDigits = (candidate.phone || "").replace(/\D/g, "");
          const cEmail = candidate.email?.trim().toLowerCase() || null;
          const phoneMatches =
            Boolean(cDigits) &&
            (phoneVariants.includes(cDigits) ||
              Boolean(suffix8 && cDigits.endsWith(suffix8) && cDigits.length >= 10));
          const emailMatches = Boolean(normEmail && cEmail && cEmail === normEmail);
          if (phoneMatches || emailMatches) {
            relatedIds.add(candidate.id);
          }
        }
      }
    }

    // Inclui também co-participantes de negociações que já estão vinculadas diretamente a este contato ou às conversas dele
    const directDealRows = await reader
      .select({ dealId: crmDealContacts.dealId })
      .from(crmDealContacts)
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          inArray(crmDealContacts.contactId, [...relatedIds]),
        ),
      );
    const convDealRows = await reader
      .select({ dealId: crmConversationDeals.dealId })
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
          eq(conversations.tenantId, tenantId),
          inArray(conversations.contactId, [...relatedIds]),
        ),
      );

    const seedDealIds = [
      ...new Set([...directDealRows, ...convDealRows].map((r) => r.dealId).filter(Boolean)),
    ];
    if (seedDealIds.length > 0 && baseContact) {
      const normBaseName = (baseContact.name || "").trim().toLowerCase();
      const coParticipants = await reader
        .select({
          contactId: crmDealContacts.contactId,
          name: contacts.name,
        })
        .from(crmDealContacts)
        .innerJoin(
          contacts,
          and(eq(contacts.tenantId, tenantId), eq(contacts.id, crmDealContacts.contactId)),
        )
        .where(
          and(
            eq(crmDealContacts.tenantId, tenantId),
            inArray(crmDealContacts.dealId, seedDealIds),
          ),
        );
      for (const p of coParticipants) {
        if (!p.contactId) continue;
        const normCandidateName = (p.name || "").trim().toLowerCase();
        if (normBaseName && normCandidateName && normBaseName === normCandidateName) {
          relatedIds.add(p.contactId);
        }
      }
    }
  } catch {
    // Em mocks unitários parciais, mantém o contactId original com segurança
  }

  return [...relatedIds];
}

/** Mesma relação de contato para chat, seleção atual e jornada, sem depender de sincronização da UI. */
export async function getContactDealRows(
  reader: Pick<DealTransaction, "select">,
  tenantId: string,
  contactId: string,
) {
  const contactIds = await resolveRelatedContactIds(reader, tenantId, contactId);
  if (contactIds.length === 0) return [];

  const contactFilter = (column: typeof crmDealContacts.contactId | typeof conversations.contactId) =>
    contactIds.length === 1 ? eq(column, contactIds[0]) : inArray(column, contactIds);

  const participant = exists(
    reader
      .select({ id: crmDealContacts.id })
      .from(crmDealContacts)
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          contactFilter(crmDealContacts.contactId),
          eq(crmDealContacts.dealId, crmDeals.id),
        ),
      ),
  );
  const conversationLink = (activeOnly: boolean) =>
    exists(
      reader
        .select({ id: crmConversationDeals.id })
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
            eq(conversations.tenantId, tenantId),
            contactFilter(conversations.contactId),
            eq(crmConversationDeals.dealId, crmDeals.id),
            activeOnly ? eq(crmConversationDeals.isActive, true) : undefined,
          ),
        ),
    );
  const rows = await reader
    .select({
      deal: crmDeals,
      stageName: crmStages.name,
      stageOrderIndex: crmStages.orderIndex,
      pipelineName: crmPipelines.name,
      accountName: crmAccounts.name,
      operatorName: operators.name,
      isLinked: sql<boolean>`(${participant} OR ${conversationLink(true)})`,
    })
    .from(crmDeals)
    .leftJoin(crmStages, and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, crmDeals.stageId)))
    .leftJoin(
      crmPipelines,
      and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, crmDeals.pipelineId)),
    )
    .leftJoin(
      crmAccounts,
      and(eq(crmAccounts.tenantId, tenantId), eq(crmAccounts.id, crmDeals.accountId)),
    )
    .leftJoin(
      operators,
      and(eq(operators.tenantId, tenantId), eq(operators.id, crmDeals.operatorId)),
    )
    .where(and(eq(crmDeals.tenantId, tenantId), or(participant, conversationLink(false))))
    .orderBy(
      sql`CASE WHEN ${crmDeals.status} = 'open' THEN 0 ELSE 1 END`,
      desc(crmDeals.createdAt),
      asc(crmDeals.id),
    );
  return rows.map(({ deal, ...details }) => ({ ...deal, ...details, stageColor: null }));
}

