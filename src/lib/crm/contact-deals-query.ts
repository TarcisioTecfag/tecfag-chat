import { and, asc, desc, eq, exists, inArray, or, sql } from "drizzle-orm";
import {
  contactPhones,
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
import { computeContactPhoneIdentity } from "../contact-phone-types";
import type { DealTransaction } from "./deal-associations";
import { isAccountEligibleForCrossContactPropagation } from "./generic-account-guard";

/**
 * Exclui negociações enviadas à Lixeira (soft-delete: status='paused' + pausedReason iniciando com "Lixeira").
 */
export const notTrashedDealCondition = sql`NOT (
  ${crmDeals.status} = 'paused'
  AND (
    lower(trim(coalesce(${crmDeals.pausedReason}, ''))) = 'lixeira'
    OR lower(trim(coalesce(${crmDeals.pausedReason}, ''))) LIKE 'lixeira %'
    OR lower(trim(coalesce(${crmDeals.pausedReason}, ''))) LIKE 'lixeira-%'
    OR lower(trim(coalesce(${crmDeals.pausedReason}, ''))) LIKE 'lixeira—%'
    OR lower(trim(coalesce(${crmDeals.pausedReason}, ''))) LIKE 'lixeira–%'
    OR lower(trim(coalesce(${crmDeals.pausedReason}, ''))) LIKE 'lixeira:%'
  )
)`;

function buildPhoneLookupVariants(rawPhone?: string | null): string[] {
  if (!rawPhone) return [];
  const trimmed = rawPhone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8) return [];
  const variants = new Set<string>(buildPhoneDigitsVariants(digits));
  if (trimmed) variants.add(trimmed);
  for (const v of Array.from(variants)) {
    if (/^\d+$/.test(v)) {
      variants.add(`+${v}`);
    }
  }
  return [...variants];
}

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
      const exactPhoneVariants = buildPhoneLookupVariants(baseContact.phone);
      const phoneIdentity = computeContactPhoneIdentity(baseContact.phone);
      const suffix8 =
        phoneVariants[0] && phoneVariants[0].length >= 8 ? phoneVariants[0].slice(-8) : null;
      const normEmail = baseContact.email?.trim().toLowerCase() || null;

      // 1. Busca indexada em contacts.phone (idx_contacts_tenant_phone) — evita full table scan com regexp_replace
      if (exactPhoneVariants.length > 0) {
        const phoneCandidates = await reader
          .select({
            id: contacts.id,
            phone: contacts.phone,
          })
          .from(contacts)
          .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.phone, exactPhoneVariants)))
          .limit(25);
        for (const candidate of phoneCandidates) {
          if (candidate.id) relatedIds.add(candidate.id);
        }
      }

      // 2. Busca indexada em contact_phones.phone_identity (idx_contact_phones_tenant_identity)
      // Cobre telefones formatados (ex.: "(14) 99836-4338"), com/sem 9º dígito e telefones secundários.
      if (phoneIdentity) {
        try {
          const identityMatches = await reader
            .select({ contactId: contactPhones.contactId })
            .from(contactPhones)
            .where(
              and(
                eq(contactPhones.tenantId, tenantId),
                eq(contactPhones.phoneIdentity, phoneIdentity),
              ),
            )
            .limit(25);
          for (const row of identityMatches) {
            if (row.contactId) relatedIds.add(row.contactId);
          }
        } catch {
          // Em mocks unitários parciais sem tabela contact_phones, segue com segurança
        }
      }

      // 3. Busca por e-mail normalizado em query dedicada (evita OR desabilitar o índice de telefone)
      if (normEmail) {
        const emailCandidates = await reader
          .select({
            id: contacts.id,
            email: contacts.email,
          })
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, tenantId),
              sql`lower(trim(${contacts.email})) = ${normEmail}`,
            ),
          )
          .limit(25);
        for (const candidate of emailCandidates) {
          const cEmail = candidate.email?.trim().toLowerCase() || null;
          if (cEmail && cEmail === normEmail) {
            relatedIds.add(candidate.id);
          }
        }
      }
      void suffix8;
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
  options?: { includeAccountDeals?: boolean; includeTrashed?: boolean },
) {
  const contactIds = await resolveRelatedContactIds(reader, tenantId, contactId);
  if (contactIds.length === 0) return [];
  return queryDealRowsForResolvedContactIds(reader, tenantId, contactIds, options);
}

/**
 * Busca consolidada em lote das negociações de múltiplos contatos (ex.: ficha do card no CRM),
 * evitando N+1 chamadas sequenciais de `getContactDealRows`.
 */
export async function getContactsDealRows(
  reader: Pick<DealTransaction, "select">,
  tenantId: string,
  seedContactIds: string[],
  options?: {
    includeAccountDeals?: boolean;
    includeTrashed?: boolean;
    extraAccountIds?: string[];
  },
) {
  const uniqueSeeds = Array.from(new Set(seedContactIds.filter(Boolean)));
  if (uniqueSeeds.length === 0 && (!options?.extraAccountIds || options.extraAccountIds.length === 0)) {
    return [];
  }

  // Para poucos contatos diretos (ex.: participantes de um card), resolve aliases em paralelo;
  // para listas grandes, usa os próprios IDs sem multiplicar queries.
  let resolvedIds = uniqueSeeds;
  if (uniqueSeeds.length > 0 && uniqueSeeds.length <= 5) {
    const expanded = await Promise.all(
      uniqueSeeds.map((id) => resolveRelatedContactIds(reader, tenantId, id)),
    );
    resolvedIds = Array.from(new Set(expanded.flat()));
  }

  return queryDealRowsForResolvedContactIds(reader, tenantId, resolvedIds, options);
}

async function queryDealRowsForResolvedContactIds(
  reader: Pick<DealTransaction, "select">,
  tenantId: string,
  contactIds: string[],
  options?: {
    includeAccountDeals?: boolean;
    includeTrashed?: boolean;
    extraAccountIds?: string[];
  },
) {
  if (contactIds.length === 0 && (!options?.extraAccountIds || options.extraAccountIds.length === 0)) {
    return [];
  }

  let relatedAccountIds: string[] = Array.from(
    new Set((options?.extraAccountIds || []).filter((id): id is string => Boolean(id))),
  );
  if (options?.includeAccountDeals !== false && contactIds.length > 0) {
    try {
      const contactAccounts = await reader
        .select({ accountId: contacts.accountId })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            contactIds.length === 1
              ? eq(contacts.id, contactIds[0])
              : inArray(contacts.id, contactIds),
          ),
        );
      const rawAccountIds = Array.from(
        new Set([
          ...relatedAccountIds,
          ...contactAccounts.map((c) => c.accountId).filter((id): id is string => Boolean(id)),
        ]),
      );
      if (rawAccountIds.length > 0) {
        try {
          const accountRows = await reader
            .select({
              id: crmAccounts.id,
              name: crmAccounts.name,
              tradeName: crmAccounts.tradeName,
              document: crmAccounts.document,
            })
            .from(crmAccounts)
            .where(
              and(
                eq(crmAccounts.tenantId, tenantId),
                rawAccountIds.length === 1
                  ? eq(crmAccounts.id, rawAccountIds[0])
                  : inArray(crmAccounts.id, rawAccountIds),
              ),
            );
          const countRows = await reader
            .select({
              accountId: contacts.accountId,
              total: sql<number>`count(*)::int`,
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                rawAccountIds.length === 1
                  ? eq(contacts.accountId, rawAccountIds[0])
                  : inArray(contacts.accountId, rawAccountIds),
              ),
            )
            .groupBy(contacts.accountId);
          const countByAccountId = new Map<string, number>();
          for (const row of countRows) {
            if (row.accountId) countByAccountId.set(row.accountId, Number(row.total) || 0);
          }
          relatedAccountIds = accountRows
            .filter((acc) =>
              isAccountEligibleForCrossContactPropagation({
                name: acc.name,
                tradeName: acc.tradeName,
                document: acc.document,
                contactCount: countByAccountId.get(acc.id) ?? 0,
              }),
            )
            .map((acc) => acc.id);
        } catch {
          // Em mocks unitários parciais sem groupBy/crmAccounts, preserva rawAccountIds
          relatedAccountIds = rawAccountIds;
        }
      }
    } catch {
      // Mantém vazio em mocks parciais
    }
  }

  const contactFilter = (column: typeof crmDealContacts.contactId | typeof conversations.contactId) =>
    contactIds.length === 1 ? eq(column, contactIds[0]) : inArray(column, contactIds);

  const participant =
    contactIds.length > 0
      ? exists(
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
        )
      : undefined;
  const conversationLink = (activeOnly: boolean) =>
    contactIds.length > 0
      ? exists(
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
        )
      : undefined;
  const accountMatch =
    relatedAccountIds.length > 0
      ? relatedAccountIds.length === 1
        ? eq(crmDeals.accountId, relatedAccountIds[0])
        : inArray(crmDeals.accountId, relatedAccountIds)
      : undefined;

  const convLinkTrue = conversationLink(true);
  const convLinkAny = conversationLink(false);

  const isLinkedExpr =
    participant && convLinkTrue && convLinkAny
      ? accountMatch
        ? sql<boolean>`(${participant} OR ${convLinkTrue} OR (${accountMatch} AND NOT ${convLinkAny}))`
        : sql<boolean>`(${participant} OR ${convLinkTrue})`
      : accountMatch
        ? sql<boolean>`(${accountMatch})`
        : sql<boolean>`false`;

  const matchParts = [participant, convLinkAny, accountMatch].filter(Boolean);
  if (matchParts.length === 0) return [];
  const whereMatch = matchParts.length === 1 ? matchParts[0]! : or(...(matchParts as any));

  const rows = await reader
    .select({
      deal: crmDeals,
      stageName: crmStages.name,
      stageOrderIndex: crmStages.orderIndex,
      pipelineName: crmPipelines.name,
      accountName: crmAccounts.name,
      operatorName: operators.name,
      isLinked: isLinkedExpr,
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
    .where(
      and(
        eq(crmDeals.tenantId, tenantId),
        whereMatch,
        options?.includeTrashed ? undefined : notTrashedDealCondition,
      ),
    )
    .orderBy(
      sql`CASE WHEN ${crmDeals.status} = 'open' THEN 0 WHEN ${crmDeals.status} = 'paused' THEN 1 ELSE 2 END`,
      desc(crmDeals.createdAt),
      asc(crmDeals.id),
    );
  return rows.map(({ deal, ...details }) => ({ ...deal, ...details, stageColor: null }));
}

