import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { agentFlowStates, contacts, conversations, crmAccounts } from "../../db/schema";
import { collectedValue, type CollectedFields } from "./industrial-policy";
import {
  isValidKnownCompanyName,
  isValidKnownContactName,
  type KnownClientProfile,
} from "./known-client-lookup";

function buildPhoneDigitsVariants(rawPhone?: string | null): string[] {
  if (!rawPhone) return [];
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 8) return [];
  const variants = new Set<string>([digits]);

  if (digits.startsWith("55") && digits.length >= 12) {
    const withoutCountry = digits.slice(2);
    variants.add(withoutCountry);
    // Variação com/sem nono dígito após DDD (2 dígitos)
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
 * Busca no banco de dados (estritamente isolado por tenantId) se o número de telefone
 * ou contato já possui empresa/CNPJ/CPF vinculados em atendimentos ou cadastros anteriores.
 */
export async function lookupKnownClientByPhoneOrContact(
  tenantId: string,
  params: {
    contactId?: string | null;
    phone?: string | null;
    conversationId?: string | null;
    previousTriages?: Array<Record<string, any>> | null;
    currentInProgressCompany?: string | null;
  },
): Promise<KnownClientProfile | null> {
  try {
    const phoneVariants = buildPhoneDigitsVariants(params.phone);
    const suffix8 =
      phoneVariants[0] && phoneVariants[0].length >= 8 ? phoneVariants[0].slice(-8) : null;

    // 1. Buscar contatos do tenant pelo contactId ou pelo telefone
    const contactConditions = [];
    if (params.contactId) {
      contactConditions.push(eq(contacts.id, params.contactId));
    }
    if (suffix8) {
      contactConditions.push(
        sql`regexp_replace(coalesce(${contacts.phone}, ''), '\\D', '', 'g') LIKE ${`%${suffix8}`}`,
      );
    }

    const matchedContacts =
      contactConditions.length > 0
        ? await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), or(...contactConditions)))
            .orderBy(desc(contacts.createdAt))
            .limit(10)
        : [];

    // Filtra para garantir match exato de variante de telefone ou contactId
    const validContacts = matchedContacts.filter((c) => {
      if (params.contactId && c.id === params.contactId) return true;
      const cDigits = (c.phone || "").replace(/\D/g, "");
      if (!cDigits) return false;
      return (
        phoneVariants.includes(cDigits) ||
        (suffix8 && cDigits.endsWith(suffix8) && cDigits.length >= 10)
      );
    });

    // 2. Verificar se algum contato possui conta CRM vinculada (crmAccounts)
    const accountIds = [
      ...new Set(validContacts.map((c) => c.accountId).filter((id): id is string => Boolean(id))),
    ];
    const linkedAccounts =
      accountIds.length > 0
        ? await db
            .select()
            .from(crmAccounts)
            .where(and(eq(crmAccounts.tenantId, tenantId), inArray(crmAccounts.id, accountIds)))
        : [];

    for (const acc of linkedAccounts) {
      const companyName = isValidKnownCompanyName(acc.name)
        ? acc.name
        : isValidKnownCompanyName(acc.tradeName)
          ? acc.tradeName!
          : null;
      if (companyName) {
        const primaryContact =
          validContacts.find((c) => c.accountId === acc.id) || validContacts[0];
        const cnpjDetails = (primaryContact?.cnpjDetails as Record<string, any>) || null;
        const doc =
          acc.document ||
          primaryContact?.cnpj ||
          primaryContact?.cpf ||
          cnpjDetails?.cnpjFormatted ||
          cnpjDetails?.cnpj ||
          null;
        const contactName = isValidKnownContactName(primaryContact?.name)
          ? primaryContact!.name
          : null;
        return {
          companyName: companyName.trim(),
          document: doc ? String(doc).trim() : null,
          contactName,
          accountId: acc.id,
          contactId: primaryContact?.id || params.contactId || null,
          source: "crm_account",
        };
      }
    }

    // 3. Verificar dados de empresa/CNPJ diretamente nos contatos encontrados
    for (const c of validContacts) {
      const cnpjDetails = (c.cnpjDetails as Record<string, any>) || null;
      const customFields = (c.customFields as Record<string, any>) || null;
      const companyFromCnpj = isValidKnownCompanyName(cnpjDetails?.razaoSocial)
        ? String(cnpjDetails!.razaoSocial)
        : isValidKnownCompanyName(cnpjDetails?.nomeFantasia)
          ? String(cnpjDetails!.nomeFantasia)
          : null;
      const companyFromCustom = isValidKnownCompanyName(
        customFields?.company ? String(customFields.company) : null,
      )
        ? String(customFields!.company)
        : null;
      const companyName = companyFromCnpj || companyFromCustom;

      if (companyName) {
        const doc =
          c.cnpj || c.cpf || cnpjDetails?.cnpjFormatted || cnpjDetails?.cnpj || null;
        const currentCompanyNorm = params.currentInProgressCompany
          ? params.currentInProgressCompany.trim().toLowerCase()
          : "";
        const isOnlyUnverifiedCurrentCycleCompany =
          !companyFromCnpj &&
          !doc &&
          !c.accountId &&
          Boolean(currentCompanyNorm) &&
          companyName.trim().toLowerCase() === currentCompanyNorm;
        if (isOnlyUnverifiedCurrentCycleCompany) {
          continue;
        }
        const contactName = isValidKnownContactName(c.name) ? c.name : null;
        return {
          companyName: companyName.trim(),
          document: doc ? String(doc).trim() : null,
          contactName,
          accountId: c.accountId || null,
          contactId: c.id,
          source: companyFromCnpj ? "contact_cnpj" : "contact_company",
        };
      }
    }

    // 4. Verificar histórico de ciclos anteriores na mesma conversa (previousTriages)
    if (Array.isArray(params.previousTriages) && params.previousTriages.length > 0) {
      for (const prev of [...params.previousTriages].reverse()) {
        const prevCompany = isValidKnownCompanyName(prev?.company) ? String(prev.company) : null;
        if (prevCompany) {
          return {
            companyName: prevCompany.trim(),
            document: prev?.document ? String(prev.document).trim() : null,
            contactName: isValidKnownContactName(prev?.clientName) ? String(prev.clientName) : null,
            contactId: params.contactId || validContacts[0]?.id || null,
            lastSector: prev?.targetFunnel ? String(prev.targetFunnel) : null,
            lastInterest: prev?.interest ? String(prev.interest) : null,
            source: "previous_triage",
          };
        }
      }
    }

    // 5. Verificar outros agentFlowStates das conversas deste mesmo contato/telefone no tenant
    const contactIds = validContacts.map((c) => c.id);
    if (contactIds.length > 0) {
      const relatedConvs = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            inArray(conversations.contactId, contactIds),
          ),
        )
        .limit(10);

      const convIds = relatedConvs.map((c) => c.id);
      if (convIds.length > 0) {
        const previousFlows = await db
          .select()
          .from(agentFlowStates)
          .where(
            and(
              eq(agentFlowStates.tenantId, tenantId),
              inArray(agentFlowStates.conversationId, convIds),
            ),
          )
          .orderBy(desc(agentFlowStates.lastInteractionAt))
          .limit(10);

        for (const flow of previousFlows) {
          const data = (flow.collectedData as CollectedFields) || {};
          const flowMeta = (flow.metadata as Record<string, any>) || {};
          const flowCompany = collectedValue(data, "EMPRESA");
          const flowDoc = collectedValue(data, "CNPJ OU CPF", "CNPJ", "CPF");
          const flowName = collectedValue(data, "NOME COMPLETO");
          const flowInterest = collectedValue(
            data,
            "MÁQUINA / PEÇA / INTERESSE",
            "SOLICITAÇÃO",
            "QUAL O TIPO DE PRODUTO?",
          );

          const isCurrentInProgressFlow =
            Boolean(params.conversationId) &&
            flow.conversationId === params.conversationId &&
            flow.outcome === "in_progress";
          if (!isCurrentInProgressFlow && isValidKnownCompanyName(flowCompany)) {
            return {
              companyName: flowCompany.trim(),
              document: flowDoc || null,
              contactName: isValidKnownContactName(flowName)
                ? flowName
                : isValidKnownContactName(validContacts[0]?.name)
                  ? validContacts[0]!.name
                  : null,
              accountId: validContacts[0]?.accountId || null,
              contactId: validContacts[0]?.id || params.contactId || null,
              lastSector: flowMeta.targetFunnel || null,
              lastInterest: flowInterest || null,
              source: "previous_triage",
            };
          }

          const archivedList = Array.isArray(flowMeta.previousTriages)
            ? flowMeta.previousTriages
            : [];
          for (const prev of [...archivedList].reverse()) {
            if (isValidKnownCompanyName(prev?.company)) {
              return {
                companyName: String(prev.company).trim(),
                document: prev?.document ? String(prev.document).trim() : null,
                contactName: isValidKnownContactName(prev?.clientName)
                  ? String(prev.clientName)
                  : null,
                accountId: validContacts[0]?.accountId || null,
                contactId: validContacts[0]?.id || params.contactId || null,
                lastSector: prev?.targetFunnel ? String(prev.targetFunnel) : null,
                lastInterest: prev?.interest ? String(prev.interest) : null,
                source: "previous_triage",
              };
            }
          }
        }
      }
    }

    // 6. Verificar crmAccounts diretamente pelo telefone no tenant
    if (suffix8) {
      const matchedAccounts = await db
        .select()
        .from(crmAccounts)
        .where(
          and(
            eq(crmAccounts.tenantId, tenantId),
            sql`regexp_replace(coalesce(${crmAccounts.phone}, ''), '\\D', '', 'g') LIKE ${`%${suffix8}`}`,
          ),
        )
        .limit(5);

      for (const acc of matchedAccounts) {
        const companyName = isValidKnownCompanyName(acc.name)
          ? acc.name
          : isValidKnownCompanyName(acc.tradeName)
            ? acc.tradeName!
            : null;
        if (companyName) {
          return {
            companyName: companyName.trim(),
            document: acc.document ? String(acc.document).trim() : null,
            contactName: isValidKnownContactName(validContacts[0]?.name)
              ? validContacts[0]!.name
              : null,
            accountId: acc.id,
            contactId: validContacts[0]?.id || params.contactId || null,
            source: "crm_account",
          };
        }
      }
    }

    return null;
  } catch (err: any) {
    console.error("[KnownClientDb] Erro ao consultar cliente recorrente:", err?.message);
    return null;
  }
}

export interface BatchKnownClientInput {
  key: string;
  contactId?: string | null;
  phone?: string | null;
  conversationId?: string | null;
  previousTriages?: Array<Record<string, any>> | null;
}

export interface BatchKnownClientContactSnapshot {
  id: string;
  name?: string | null;
  phone?: string | null;
  accountId?: string | null;
  cnpj?: string | null;
  cpf?: string | null;
  cnpjDetails?: unknown;
  customFields?: unknown;
}

function extractKnownClientFromContactRow(
  c: BatchKnownClientContactSnapshot,
): KnownClientProfile | null {
  const cnpjDetails = (c.cnpjDetails as Record<string, any>) || null;
  const customFields = (c.customFields as Record<string, any>) || null;
  const companyFromCnpj = isValidKnownCompanyName(cnpjDetails?.razaoSocial)
    ? String(cnpjDetails!.razaoSocial)
    : isValidKnownCompanyName(cnpjDetails?.nomeFantasia)
      ? String(cnpjDetails!.nomeFantasia)
      : null;
  const companyFromCustom = isValidKnownCompanyName(
    customFields?.company ? String(customFields.company) : null,
  )
    ? String(customFields!.company)
    : null;
  const companyName = companyFromCnpj || companyFromCustom;
  if (!companyName) return null;

  const doc = c.cnpj || c.cpf || cnpjDetails?.cnpjFormatted || cnpjDetails?.cnpj || null;
  const contactName = isValidKnownContactName(c.name) ? String(c.name) : null;
  return {
    companyName: companyName.trim(),
    document: doc ? String(doc).trim() : null,
    contactName,
    accountId: c.accountId || null,
    contactId: c.id,
    source: companyFromCnpj ? "contact_cnpj" : "contact_company",
  };
}

function extractKnownClientFromPreviousTriages(
  previousTriages: Array<Record<string, any>> | null | undefined,
  fallbackContactId: string | null,
): KnownClientProfile | null {
  if (!Array.isArray(previousTriages) || previousTriages.length === 0) return null;
  for (let i = previousTriages.length - 1; i >= 0; i--) {
    const prev = previousTriages[i];
    const prevCompany = isValidKnownCompanyName(prev?.company) ? String(prev.company) : null;
    if (prevCompany) {
      return {
        companyName: prevCompany.trim(),
        document: prev?.document ? String(prev.document).trim() : null,
        contactName: isValidKnownContactName(prev?.clientName) ? String(prev.clientName) : null,
        contactId: fallbackContactId,
        lastSector: prev?.targetFunnel ? String(prev.targetFunnel) : null,
        lastInterest: prev?.interest ? String(prev.interest) : null,
        source: "previous_triage",
      };
    }
  }
  return null;
}

/**
 * Versão em lote (Zero N+1) de `lookupKnownClientByPhoneOrContact`, estritamente isolada por `tenantId`.
 * Resolve até 100+ sessões em 1–3 queries SQL agregadas em vez de ~500 queries sequenciais.
 */
export async function batchLookupKnownClientsByPhoneOrContact(
  tenantId: string,
  items: BatchKnownClientInput[],
  existingContactsById: Map<string, BatchKnownClientContactSnapshot>,
): Promise<Map<string, KnownClientProfile>> {
  const result = new Map<string, KnownClientProfile>();
  if (items.length === 0) return result;

  try {
    // 1. Coletar accountIds já conhecidos nos contatos pré-carregados
    const initialAccountIds = new Set<string>();
    const suffixByKey = new Map<string, string>();
    const variantsByKey = new Map<string, string[]>();

    for (const item of items) {
      const c = item.contactId ? existingContactsById.get(item.contactId) : undefined;
      if (c?.accountId) initialAccountIds.add(c.accountId);
      const variants = buildPhoneDigitsVariants(item.phone || c?.phone || null);
      if (variants.length > 0) {
        variantsByKey.set(item.key, variants);
        const s8 = variants[0].length >= 8 ? variants[0].slice(-8) : "";
        if (s8) suffixByKey.set(item.key, s8);
      }
    }

    // 2. Buscar em lote as crmAccounts já vinculadas por accountId
    const accountsById = new Map<
      string,
      { id: string; name: string; tradeName: string | null; document: string | null }
    >();
    if (initialAccountIds.size > 0) {
      const accRows = await db
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
            inArray(crmAccounts.id, [...initialAccountIds]),
          ),
        );
      for (const acc of accRows) {
        accountsById.set(acc.id, acc);
      }
    }

    // 3. Resolver em memória tudo que já tem crmAccount vinculada, empresa/CNPJ no contato ou previousTriages
    const unresolved: BatchKnownClientInput[] = [];
    for (const item of items) {
      const c = item.contactId ? existingContactsById.get(item.contactId) : undefined;

      // 3a. Conta CRM vinculada ao contato
      if (c?.accountId) {
        const acc = accountsById.get(c.accountId);
        if (acc) {
          const companyName = isValidKnownCompanyName(acc.name)
            ? acc.name
            : isValidKnownCompanyName(acc.tradeName)
              ? acc.tradeName!
              : null;
          if (companyName) {
            const cnpjDetails = (c.cnpjDetails as Record<string, any>) || null;
            const doc =
              acc.document ||
              c.cnpj ||
              c.cpf ||
              cnpjDetails?.cnpjFormatted ||
              cnpjDetails?.cnpj ||
              null;
            result.set(item.key, {
              companyName: companyName.trim(),
              document: doc ? String(doc).trim() : null,
              contactName: isValidKnownContactName(c.name) ? String(c.name) : null,
              accountId: acc.id,
              contactId: c.id,
              source: "crm_account",
            });
            continue;
          }
        }
      }

      // 3b. Empresa/CNPJ no próprio contato
      if (c) {
        const fromContact = extractKnownClientFromContactRow(c);
        if (fromContact) {
          result.set(item.key, fromContact);
          continue;
        }
      }

      // 3c. Histórico de previousTriages já carregado no metadata
      const fromPrev = extractKnownClientFromPreviousTriages(
        item.previousTriages,
        item.contactId || null,
      );
      if (fromPrev) {
        result.set(item.key, fromPrev);
        continue;
      }

      unresolved.push(item);
    }

    if (unresolved.length === 0) return result;

    // 4. Para os poucos itens ainda sem match, executar NO MÁXIMO 2–3 queries em lote em paralelo
    const unresolvedSuffixes = [
      ...new Set(
        unresolved
          .map((item) => suffixByKey.get(item.key))
          .filter((s): s is string => Boolean(s && s.length === 8)),
      ),
    ];
    const unresolvedContactIds = [
      ...new Set(
        unresolved
          .map((item) => item.contactId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const [extraContactsBySuffix, prevFlowsByContact, accountsByPhone] = await Promise.all([
      unresolvedSuffixes.length > 0
        ? db
            .select({
              id: contacts.id,
              name: contacts.name,
              phone: contacts.phone,
              accountId: contacts.accountId,
              cnpj: contacts.cnpj,
              cpf: contacts.cpf,
              cnpjDetails: contacts.cnpjDetails,
              customFields: contacts.customFields,
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                sql`right(regexp_replace(coalesce(${contacts.phone}, ''), '\\D', '', 'g'), 8) IN (${sql.join(
                  unresolvedSuffixes.map((s) => sql`${s}`),
                  sql`, `,
                )})`,
              ),
            )
            .orderBy(desc(contacts.createdAt))
            .limit(Math.min(unresolvedSuffixes.length * 4, 250))
        : Promise.resolve([]),
      unresolvedContactIds.length > 0
        ? db
            .select({
              contactId: conversations.contactId,
              collectedData: agentFlowStates.collectedData,
              metadata: agentFlowStates.metadata,
              lastInteractionAt: agentFlowStates.lastInteractionAt,
            })
            .from(agentFlowStates)
            .innerJoin(
              conversations,
              and(
                eq(agentFlowStates.conversationId, conversations.id),
                eq(conversations.tenantId, tenantId),
              ),
            )
            .where(
              and(
                eq(agentFlowStates.tenantId, tenantId),
                inArray(conversations.contactId, unresolvedContactIds),
              ),
            )
            .orderBy(desc(agentFlowStates.lastInteractionAt))
            .limit(Math.min(unresolvedContactIds.length * 4, 250))
        : Promise.resolve([]),
      unresolvedSuffixes.length > 0
        ? db
            .select({
              id: crmAccounts.id,
              name: crmAccounts.name,
              tradeName: crmAccounts.tradeName,
              document: crmAccounts.document,
              phone: crmAccounts.phone,
            })
            .from(crmAccounts)
            .where(
              and(
                eq(crmAccounts.tenantId, tenantId),
                sql`right(regexp_replace(coalesce(${crmAccounts.phone}, ''), '\\D', '', 'g'), 8) IN (${sql.join(
                  unresolvedSuffixes.map((s) => sql`${s}`),
                  sql`, `,
                )})`,
              ),
            )
            .limit(Math.min(unresolvedSuffixes.length * 3, 200))
        : Promise.resolve([]),
    ]);

    // Buscar eventuais accountIds descobertos nos contatos extras por telefone
    const extraAccountIds = [
      ...new Set(
        extraContactsBySuffix
          .map((c) => c.accountId)
          .filter((id): id is string => Boolean(id) && !accountsById.has(id)),
      ),
    ];
    if (extraAccountIds.length > 0) {
      const moreAccs = await db
        .select({
          id: crmAccounts.id,
          name: crmAccounts.name,
          tradeName: crmAccounts.tradeName,
          document: crmAccounts.document,
        })
        .from(crmAccounts)
        .where(and(eq(crmAccounts.tenantId, tenantId), inArray(crmAccounts.id, extraAccountIds)));
      for (const acc of moreAccs) {
        accountsById.set(acc.id, acc);
      }
    }

    // Indexar contatos extras por suffix8
    const extraContactsMap = new Map<string, typeof extraContactsBySuffix>();
    for (const c of extraContactsBySuffix) {
      const digits = (c.phone || "").replace(/\D/g, "");
      if (digits.length < 8) continue;
      const s8 = digits.slice(-8);
      const list = extraContactsMap.get(s8) || [];
      list.push(c);
      extraContactsMap.set(s8, list);
    }

    // Indexar fluxos anteriores por contactId
    const flowsByContactMap = new Map<string, typeof prevFlowsByContact>();
    for (const f of prevFlowsByContact) {
      if (!f.contactId) continue;
      const list = flowsByContactMap.get(f.contactId) || [];
      list.push(f);
      flowsByContactMap.set(f.contactId, list);
    }

    // Indexar contas CRM por suffix8
    const accountsBySuffixMap = new Map<string, typeof accountsByPhone>();
    for (const acc of accountsByPhone) {
      const digits = (acc.phone || "").replace(/\D/g, "");
      if (digits.length < 8) continue;
      const s8 = digits.slice(-8);
      const list = accountsBySuffixMap.get(s8) || [];
      list.push(acc);
      accountsBySuffixMap.set(s8, list);
    }

    // Resolver cada item restante em memória
    for (const item of unresolved) {
      const s8 = suffixByKey.get(item.key);
      const variants = variantsByKey.get(item.key) || [];
      const matchingContacts = (s8 ? extraContactsMap.get(s8) || [] : []).filter((c) => {
        if (item.contactId && c.id === item.contactId) return true;
        const cDigits = (c.phone || "").replace(/\D/g, "");
        if (!cDigits) return false;
        return variants.includes(cDigits) || (Boolean(s8) && cDigits.endsWith(s8!) && cDigits.length >= 10);
      });

      // 4a. crmAccount via contato irmão de mesmo telefone
      let matched: KnownClientProfile | null = null;
      for (const c of matchingContacts) {
        if (!c.accountId) continue;
        const acc = accountsById.get(c.accountId);
        if (!acc) continue;
        const companyName = isValidKnownCompanyName(acc.name)
          ? acc.name
          : isValidKnownCompanyName(acc.tradeName)
            ? acc.tradeName!
            : null;
        if (companyName) {
          const cnpjDetails = (c.cnpjDetails as Record<string, any>) || null;
          const doc =
            acc.document ||
            c.cnpj ||
            c.cpf ||
            cnpjDetails?.cnpjFormatted ||
            cnpjDetails?.cnpj ||
            null;
          matched = {
            companyName: companyName.trim(),
            document: doc ? String(doc).trim() : null,
            contactName: isValidKnownContactName(c.name) ? String(c.name) : null,
            accountId: acc.id,
            contactId: c.id,
            source: "crm_account",
          };
          break;
        }
      }

      // 4b. Empresa/CNPJ em contato irmão de mesmo telefone
      if (!matched) {
        for (const c of matchingContacts) {
          const fromContact = extractKnownClientFromContactRow(c);
          if (fromContact) {
            matched = fromContact;
            break;
          }
        }
      }

      // 4c. Fluxos anteriores das conversas deste contato
      if (!matched && item.contactId) {
        const primaryContact = existingContactsById.get(item.contactId) || matchingContacts[0];
        const prevFlows = flowsByContactMap.get(item.contactId) || [];
        for (const flow of prevFlows) {
          const data = (flow.collectedData as CollectedFields) || {};
          const flowMeta = (flow.metadata as Record<string, any>) || {};
          const flowCompany = collectedValue(data, "EMPRESA");
          const flowDoc = collectedValue(data, "CNPJ OU CPF", "CNPJ", "CPF");
          const flowName = collectedValue(data, "NOME COMPLETO");
          const flowInterest = collectedValue(
            data,
            "MÁQUINA / PEÇA / INTERESSE",
            "SOLICITAÇÃO",
            "QUAL O TIPO DE PRODUTO?",
          );
          if (isValidKnownCompanyName(flowCompany)) {
            matched = {
              companyName: flowCompany.trim(),
              document: flowDoc || null,
              contactName: isValidKnownContactName(flowName)
                ? flowName
                : isValidKnownContactName(primaryContact?.name)
                  ? String(primaryContact!.name)
                  : null,
              accountId: primaryContact?.accountId || null,
              contactId: primaryContact?.id || item.contactId,
              lastSector: flowMeta.targetFunnel || null,
              lastInterest: flowInterest || null,
              source: "previous_triage",
            };
            break;
          }
          const archivedList = Array.isArray(flowMeta.previousTriages)
            ? flowMeta.previousTriages
            : [];
          const fromArchived = extractKnownClientFromPreviousTriages(
            archivedList,
            primaryContact?.id || item.contactId,
          );
          if (fromArchived) {
            matched = {
              ...fromArchived,
              accountId: primaryContact?.accountId || null,
            };
            break;
          }
        }
      }

      // 4d. crmAccounts diretamente por telefone
      if (!matched && s8) {
        const primaryContact =
          (item.contactId ? existingContactsById.get(item.contactId) : undefined) ||
          matchingContacts[0];
        const accMatches = accountsBySuffixMap.get(s8) || [];
        for (const acc of accMatches) {
          const companyName = isValidKnownCompanyName(acc.name)
            ? acc.name
            : isValidKnownCompanyName(acc.tradeName)
              ? acc.tradeName!
              : null;
          if (companyName) {
            matched = {
              companyName: companyName.trim(),
              document: acc.document ? String(acc.document).trim() : null,
              contactName: isValidKnownContactName(primaryContact?.name)
                ? String(primaryContact!.name)
                : null,
              accountId: acc.id,
              contactId: primaryContact?.id || item.contactId || null,
              source: "crm_account",
            };
            break;
          }
        }
      }

      if (matched) {
        result.set(item.key, matched);
      }
    }

    return result;
  } catch (err: any) {
    console.error("[KnownClientDb] Erro no batch lookup de clientes recorrentes:", err?.message);
    return result;
  }
}
