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

          if (isValidKnownCompanyName(flowCompany)) {
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
