import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gte, inArray, ne, or, sql, desc, isNull } from "drizzle-orm";
import {
  dispatchRdSdrTemplatePostCommit,
  type RdTemplateDispatchJob,
} from "./sdr-template-dispatch";
import {
  acquireCwrContactLock,
  ensureCwrDealOnContacting,
} from "../triage/industrial-cwr-crm";

import { db } from "../../db";
import {
  contactPhones,
  contacts,
  conversations,
  crmAccounts,
  crmConversationDeals,
  crmDealContacts,
  crmDealEvents,
  crmDeals,
  crmStages,
  crmPipelines,
  messages,
  operators,
  rdMarketingFlows,
  rdMarketingReceipts,
  rdMarketingLogs,
} from "../../db/schema";
import {
  crmService,
  CrmValidationError,
  parseMoneyValue,
  validateDocument,
} from "../crm/crm-service";
import {
  listCustomFields,
  validateFieldValues,
  missingStageFields,
  type CustomFieldValues,
} from "../crm/custom-fields";
import { buildPhoneSearchTerms, normalizeCanonicalPhone, phoneRegistrationError } from "../utils";
import {
  buildContactExactEmailSql,
  extractContactEmails,
  mergeContactEmails,
} from "../crm/contact-emails";
import { resolveOrEnsureContactPhoneRow } from "../crm/contact-phones";
import { recordRdDiagnostic } from "./diagnostic-store";
import { isRdActivityLead } from "./activity-events";
import {
  availablePaths,
  conversionForLead,
  deliveryIdentity,
  extractLeads,
  flowSettingsSchema,
  mapLead,
  readPath,
  type FlowSettings,
} from "./mapping";
import { extractDetailedConversionUtm } from "./attribution";
import { isTestEntityTitle, normalizeRdDealSource } from "../marketing/crm-attribution";
import {
  buildFlowWebhookUrl,
  decodeFlowWebhookToken,
  encodeFlowWebhookToken,
} from "./api-crypto";

export { buildFlowWebhookUrl, decodeFlowWebhookToken, encodeFlowWebhookToken };
export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
export const newWebhookToken = () => randomBytes(32).toString("hex");
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Flow = typeof rdMarketingFlows.$inferSelect;

export async function flowOptions(tenantId: string) {
  const [pipelines, stages, owners, contactFields, companyFields, dealFields] = await Promise.all([
    db
      .select({ id: crmPipelines.id, name: crmPipelines.name })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId)),
    db
      .select({ id: crmStages.id, name: crmStages.name, pipelineId: crmStages.pipelineId })
      .from(crmStages)
      .where(eq(crmStages.tenantId, tenantId)),
    db
      .select({ id: operators.id, name: operators.name })
      .from(operators)
      .where(eq(operators.tenantId, tenantId)),
    listCustomFields(tenantId, "contact"),
    listCustomFields(tenantId, "company"),
    listCustomFields(tenantId, "deal"),
  ]);
  return {
    pipelines,
    stages,
    owners,
    fields: { contact: contactFields, company: companyFields, deal: dealFields },
  };
}

export async function validateFlow(tenantId: string, input: unknown) {
  const parsed = flowSettingsSchema.safeParse(input);
  if (!parsed.success)
    throw new CrmValidationError(parsed.error.issues.map((issue) => issue.message).join(" "));
  const settings = parsed.data;
  const options = await flowOptions(tenantId);
  if (
    !options.pipelines.some((p) => p.id === settings.pipelineId) ||
    !options.stages.some((s) => s.id === settings.stageId && s.pipelineId === settings.pipelineId)
  ) {
    throw new CrmValidationError("Escolha um funil e uma etapa válidos da empresa atual.");
  }
  if (settings.operatorId && !options.owners.some((o) => o.id === settings.operatorId))
    throw new CrmValidationError("Responsável inválido.");
  for (const mapping of settings.mappings) {
    const [entity, field, id] = mapping.target.split(".");
    if (
      field === "customFields" &&
      !options.fields[entity as keyof typeof options.fields]?.some(
        (definition) => definition.id === id,
      )
    ) {
      throw new CrmValidationError(
        "Campo personalizado não pertence à empresa atual ou foi arquivado.",
      );
    }
  }
  if (
    !["contact.name", "deal.title"].every((target) =>
      settings.mappings.some(
        (mapping) => mapping.target === target && (mapping.source || mapping.fallback),
      ),
    )
  ) {
    throw new CrmValidationError("Mapeie nome do contato e título da negociação.");
  }
  return settings;
}

async function prepareLead(
  tenantId: string,
  lead: Record<string, unknown>,
  settings: FlowSettings,
  executor: Pick<typeof db, "select"> = db,
) {
  const mapped = mapLead(lead, settings);
  const phoneError = phoneRegistrationError(String(mapped.contact.phone || ""));
  if (phoneError) throw new CrmValidationError(phoneError);
  mapped.contact.phone = normalizeCanonicalPhone(String(mapped.contact.phone || ""));
  const phone = String(mapped.contact.phone);
  if (phone && (phone.length < 8 || phone.length > 15))
    throw new CrmValidationError("Telefone do contato inválido.");
  const [contactDefs, companyDefs, dealDefs, stages] = await Promise.all([
    listCustomFields(tenantId, "contact", executor),
    listCustomFields(tenantId, "company", executor),
    listCustomFields(tenantId, "deal", executor),
    executor
      .select()
      .from(crmStages)
      .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.pipelineId, settings.pipelineId))),
  ]);
  const stage = stages.find((s) => s.id === settings.stageId);
  if (!stage) throw new CrmValidationError("Etapa configurada não está disponível neste funil.");
  mapped.contact.customFields = validateFieldValues(contactDefs, mapped.contact.customFields, {
    requireOnCreate: true,
  });
  if (mapped.company.name)
    mapped.company.customFields = validateFieldValues(companyDefs, mapped.company.customFields, {
      requireOnCreate: true,
    });
  const stageContext = { stageId: stage.id, orderIndex: stage.orderIndex, allStages: stages };
  mapped.deal.customFields = validateFieldValues(dealDefs, mapped.deal.customFields, {
    pipelineId: settings.pipelineId,
    requireOnCreate: true,
    stageContext,
  });
  const missing = missingStageFields(
    stage.requiredFields,
    dealDefs,
    mapped.deal.customFields as CustomFieldValues,
    settings.pipelineId,
    stageContext,
  );
  if (missing.length)
    throw new CrmValidationError(`Campos obrigatórios da etapa: ${missing.join(", ")}.`);
  if (!mapped.contact.phone && !mapped.contact.email)
    throw new CrmValidationError("Mapeie telefone ou e-mail do contato.");
  if (mapped.company.document) {
    const document = String(mapped.company.document).replace(/\D/g, "");
    validateDocument(document.length === 11 ? "person" : "company", document);
    mapped.company.document = document;
  }
  if (
    mapped.deal.value !== undefined &&
    !Number.isFinite(parseMoneyValue(String(mapped.deal.value)))
  )
    throw new CrmValidationError("Valor da negociação inválido.");
  return mapped;
}

function normalizeMappedDealSource(
  lead: Record<string, unknown>,
  settings: FlowSettings,
  mapped: Awaited<ReturnType<typeof prepareLead>>,
) {
  const selectedConvKey =
    settings.attributionConversion === "last" ? "last_conversion" : "first_conversion";
  const detailedUtm = extractDetailedConversionUtm(readPath(lead, selectedConvKey) || lead);
  const rawMappedSource = mapped.deal.source ? String(mapped.deal.source) : null;
  const normalizedSource = normalizeRdDealSource({
    explicitSource: rawMappedSource,
    utmSource: detailedUtm.utmSource,
    utmMedium: detailedUtm.utmMedium || detailedUtm.originMedium,
    utmCampaign: detailedUtm.utmCampaign,
    clickId: detailedUtm.clickId,
    landingPage: detailedUtm.landingPage,
    channel: detailedUtm.originChannel,
    entryChannel: "rd_webhook",
  });
  const dealSource = normalizedSource || rawMappedSource || "Não informada";
  if (rawMappedSource && dealSource !== rawMappedSource) {
    mapped.deal.source = dealSource;
    if (typeof mapped.deal.initialNote === "string") {
      mapped.deal.initialNote = mapped.deal.initialNote.replace(
        `Fonte: ${rawMappedSource}`,
        `Fonte: ${dealSource}`,
      );
    }
  }
  return { detailedUtm, normalizedSource, dealSource };
}

export async function previewFlow(tenantId: string, input: unknown, payload: unknown) {
  const settings = await validateFlow(tenantId, input);
  const leads = extractLeads(payload);
  const results = [];
  for (const lead of leads) {
    deliveryIdentity(lead, settings);
    const mapped = await prepareLead(tenantId, lead, settings);
    normalizeMappedDealSource(lead, settings, mapped);
    results.push(mapped);
  }
  return { paths: availablePaths(leads[0]), results };
}

async function resolveContact(
  tenantId: string,
  mapped: Awaited<ReturnType<typeof prepareLead>>,
  leadUtm: {
    firstSource: string | null;
    firstCampaign: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    clickId: string | null;
    landingPage: string | null;
  },
  tx: Executor,
) {
  const phone = String(mapped.contact.phone || "");
  const email = String(mapped.contact.email || "");
  const phoneTerms = buildPhoneSearchTerms(phone);
  // Mesma chave da proteção de identidade existente, com ordem determinística.
  for (const identity of [...new Set([...phoneTerms, email].filter(Boolean))].sort()) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${identity}))`,
    );
  }
  const phoneMatchedContactIds = new Set<string>();
  if (phoneTerms.length > 0) {
    const phoneRows = await tx
      .select({ contactId: contactPhones.contactId })
      .from(contactPhones)
      .where(
        and(
          eq(contactPhones.tenantId, tenantId),
          or(
            inArray(contactPhones.phoneIdentity, phoneTerms),
            ...phoneTerms.map(
              (term) => sql`regexp_replace(${contactPhones.phone}, '[^0-9]', '', 'g') = ${term}`,
            ),
          ),
        ),
      );
    for (const row of phoneRows) phoneMatchedContactIds.add(row.contactId);
  }
  const phoneMatchedIdsList = Array.from(phoneMatchedContactIds);

  const matches = await tx
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.tenantId, tenantId),
        or(
          ...phoneTerms.map(
            (term) => sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}`,
          ),
          phoneMatchedIdsList.length > 0 ? inArray(contacts.id, phoneMatchedIdsList) : undefined,
          email ? buildContactExactEmailSql(contacts.email, contacts.customFields, email) : undefined,
          sql`FALSE`,
        ),
      ),
    )
    .for("update");
  const cleanDigits = (val: string | null | undefined) => (val || "").replace(/\D/g, "");
  const phoneSet = new Set(phoneTerms);
  const sortedMatches = [...matches].sort((a, b) => {
    const aDigits = cleanDigits(a.phone);
    const bDigits = cleanDigits(b.phone);
    const aExactPhone = Boolean(phone && aDigits === phone);
    const bExactPhone = Boolean(phone && bDigits === phone);
    if (aExactPhone !== bExactPhone) return aExactPhone ? -1 : 1;
    const aHasPhone = Boolean((aDigits && phoneSet.has(aDigits)) || phoneMatchedContactIds.has(a.id));
    const bHasPhone = Boolean((bDigits && phoneSet.has(bDigits)) || phoneMatchedContactIds.has(b.id));
    if (aHasPhone !== bHasPhone) return aHasPhone ? -1 : 1;
    const aHasWhatsapp = Boolean(a.whatsappJid || a.whatsappUserId);
    const bHasWhatsapp = Boolean(b.whatsappJid || b.whatsappUserId);
    if (aHasWhatsapp !== bHasWhatsapp) return aHasWhatsapp ? -1 : 1;
    const aHasAccount = Boolean(a.accountId);
    const bHasAccount = Boolean(b.accountId);
    if (aHasAccount !== bHasAccount) return aHasAccount ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const existing = sortedMatches[0];
  if (existing) {
    // Enriquecer campos vazios; preservar alterações feitas pela equipe comercial.
    const customFields: Record<string, unknown> = {};
    for (const candidate of [...sortedMatches].reverse()) {
      for (const [key, value] of Object.entries(
        (candidate.customFields || {}) as Record<string, unknown>,
      )) {
        if (value !== undefined && value !== null && value !== "") customFields[key] = value;
      }
    }
    for (const [key, value] of Object.entries(
      mapped.contact.customFields as Record<string, unknown>,
    )) {
      if (customFields[key] === undefined || customFields[key] === null || customFields[key] === "")
        customFields[key] = value;
    }
    const phoneOwnedByOther = Boolean(
      phone &&
      (matches.some((m) => m.id !== existing.id && cleanDigits(m.phone) === phone) ||
        Array.from(phoneMatchedContactIds).some((cid) => cid !== existing.id)),
    );
    const nextPhone = existing.phone || (!phoneOwnedByOther && phone ? phone : null);
    const emailOwnedByOther = Boolean(
      email &&
      matches.some((candidate) => {
        if (candidate.id === existing.id) return false;
        const candidateEmails = extractContactEmails(
          candidate.email,
          candidate.customFields as Record<string, unknown>,
        ).allEmails;
        return candidateEmails.includes(email);
      }),
    );
    // Nunca descartar e-mails novos: mantém o principal e acumula os demais em customFields.secondaryEmails
    const mergedEmails = mergeContactEmails(
      existing.email,
      customFields,
      !emailOwnedByOther && email ? email : null,
    );
    const nextEmail = mergedEmails.primaryEmail;
    const nextCustomFields = mergedEmails.customFields;
    const nextAccountId =
      existing.accountId || sortedMatches.find((m) => m.accountId)?.accountId || null;
    const nextEntryChannel = existing.entryChannel || "rd_webhook";
    const nextFirstSource = existing.firstSource || leadUtm.firstSource || null;
    const nextFirstCampaign = existing.firstCampaign || leadUtm.firstCampaign || null;
    const nextUtmSource = existing.utmSource || leadUtm.utmSource || null;
    const nextUtmMedium = existing.utmMedium || leadUtm.utmMedium || null;
    const nextUtmCampaign = existing.utmCampaign || leadUtm.utmCampaign || null;
    const nextUtmContent = existing.utmContent || leadUtm.utmContent || null;
    const nextUtmTerm = existing.utmTerm || leadUtm.utmTerm || null;
    const nextClickId = existing.clickId || leadUtm.clickId || null;
    const nextLandingPage = existing.landingPage || leadUtm.landingPage || null;
    await tx
      .update(contacts)
      .set({
        phone: nextPhone,
        email: nextEmail,
        accountId: nextAccountId,
        customFields: nextCustomFields,
        entryChannel: nextEntryChannel,
        firstSource: nextFirstSource,
        firstCampaign: nextFirstCampaign,
        utmSource: nextUtmSource,
        utmMedium: nextUtmMedium,
        utmCampaign: nextUtmCampaign,
        utmContent: nextUtmContent,
        utmTerm: nextUtmTerm,
        clickId: nextClickId,
        landingPage: nextLandingPage,
      })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, existing.id)));
    if (phone && !phoneOwnedByOther && cleanDigits(nextPhone) !== phone) {
      await resolveOrEnsureContactPhoneRow(tx, tenantId, existing.id, { phone }).catch(() => {});
    }
    return {
      ...existing,
      phone: nextPhone,
      email: nextEmail,
      accountId: nextAccountId,
      customFields: nextCustomFields,
      entryChannel: nextEntryChannel,
      firstSource: nextFirstSource,
      firstCampaign: nextFirstCampaign,
      utmSource: nextUtmSource,
      utmMedium: nextUtmMedium,
      utmCampaign: nextUtmCampaign,
      utmContent: nextUtmContent,
      utmTerm: nextUtmTerm,
      clickId: nextClickId,
      landingPage: nextLandingPage,
    };
  }
  const [created] = await tx
    .insert(contacts)
    .values({
      id: `cont-${randomUUID()}`,
      tenantId,
      name: String(mapped.contact.name),
      phone: phone || null,
      email: email || null,
      mainChannel: "whatsapp",
      entryChannel: "rd_webhook",
      firstSource: leadUtm.firstSource || null,
      firstCampaign: leadUtm.firstCampaign || null,
      utmSource: leadUtm.utmSource || null,
      utmMedium: leadUtm.utmMedium || null,
      utmCampaign: leadUtm.utmCampaign || null,
      utmContent: leadUtm.utmContent || null,
      utmTerm: leadUtm.utmTerm || null,
      clickId: leadUtm.clickId || null,
      landingPage: leadUtm.landingPage || null,
      isTest: isTestEntityTitle(String(mapped.contact.name)),
      customFields: mapped.contact.customFields as Record<string, unknown>,
    })
    .returning();
  return created;
}

export async function receiveLeads(flow: Flow, payload: unknown) {
  const tenantId = flow.tenantId;
  const parsed = flowSettingsSchema.safeParse(flow.settings);
  if (!parsed.success) throw new CrmValidationError("Configuração do fluxo inválida.");
  if (!parsed.data.enabled) throw new CrmValidationError("Fluxo desativado.", "FLOW_DISABLED");
  await recordRdDiagnostic({ ...flow, settings: parsed.data }, payload);
  const leads = extractLeads(payload).filter((lead) => !isRdActivityLead(lead));
  if (isRdActivityLead(payload as Record<string, unknown>) || !leads.length) return [];
  // Rejeitar problemas do payload antes de reservar conexões ou abrir uma transação.
  for (const lead of leads) {
    deliveryIdentity(lead, parsed.data);
    mapLead(lead, parsed.data);
  }
  const settings = await validateFlow(tenantId, parsed.data);
  const templateJobs: RdTemplateDispatchJob[] = [];
  // Card, contato e recibo são confirmados juntos. Reenvios simultâneos aguardam o índice único.
  const outcomes = await db.transaction(async (tx) => {
    const txOutcomes = [];
    for (const lead of leads) {
      const identityHash = hashToken(deliveryIdentity(lead, settings));
      const [receipt] = await tx
        .insert(rdMarketingReceipts)
        .values({ id: randomUUID(), tenantId, flowId: flow.id, identityHash })
        .onConflictDoNothing()
        .returning();
      if (!receipt) {
        const [previous] = await tx
          .select()
          .from(rdMarketingReceipts)
          .where(
            and(
              eq(rdMarketingReceipts.tenantId, tenantId),
              eq(rdMarketingReceipts.flowId, flow.id),
              eq(rdMarketingReceipts.identityHash, identityHash),
            ),
          );
        txOutcomes.push({ status: "duplicate", dealId: previous?.dealId });
        await tx.insert(rdMarketingLogs).values({
          id: randomUUID(),
          tenantId,
          flowId: flow.id,
          status: "duplicate",
          dealId: previous?.dealId,
          message: "Reenvio reconhecido; card existente preservado.",
        });
        continue;
      }
      const mapped = await prepareLead(tenantId, lead, settings, tx);
      const { detailedUtm, normalizedSource, dealSource } = normalizeMappedDealSource(
        lead,
        settings,
        mapped,
      );
      const convMeta = conversionForLead(lead);
      const conversionPointLabel =
        detailedUtm.conversionIdentifier ||
        convMeta.identifier ||
        settings.name ||
        (mapped.deal.campaign ? String(mapped.deal.campaign) : null);
      const contact = await resolveContact(
        tenantId,
        mapped,
        {
          firstSource: normalizedSource,
          firstCampaign: conversionPointLabel,
          utmSource: detailedUtm.utmSource,
          utmMedium: detailedUtm.utmMedium,
          utmCampaign: detailedUtm.utmCampaign,
          utmContent: detailedUtm.utmContent,
          utmTerm: detailedUtm.utmTerm,
          clickId: detailedUtm.clickId,
          landingPage: detailedUtm.landingPage,
        },
        tx,
      );
      let accountId = contact.accountId;
      if (accountId) {
        const [account] = await tx
          .select()
          .from(crmAccounts)
          .where(
            and(
              eq(crmAccounts.tenantId, tenantId),
              eq(crmAccounts.id, accountId),
              isNull(crmAccounts.archivedAt),
            ),
          );
        if (!account)
          throw new CrmValidationError("Empresa do contato indisponível. Revise o cadastro.");
        if (
          mapped.company.document &&
          account.document &&
          mapped.company.document !== account.document
        )
          throw new CrmValidationError(
            "O documento recebido difere da empresa vinculada ao contato.",
          );
      }
      if (mapped.company.name && !accountId) {
        const document = String(mapped.company.document || "").replace(/\D/g, "");
        if (document) {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${document}))`,
          );
          const [account] = await tx
            .select({ id: crmAccounts.id })
            .from(crmAccounts)
            .where(
              and(
                eq(crmAccounts.tenantId, tenantId),
                eq(crmAccounts.document, document),
                isNull(crmAccounts.archivedAt),
              ),
            );
          accountId = account?.id || null;
        }
      }
      if (accountId && mapped.company.name) {
        const [account] = await tx
          .select()
          .from(crmAccounts)
          .where(and(eq(crmAccounts.tenantId, tenantId), eq(crmAccounts.id, accountId)))
          .for("update");
        const customFields = { ...(account.customFields as Record<string, unknown>) };
        for (const [key, value] of Object.entries(
          mapped.company.customFields as Record<string, unknown>,
        )) {
          if (
            customFields[key] === undefined ||
            customFields[key] === null ||
            customFields[key] === ""
          )
            customFields[key] = value;
        }
        await tx
          .update(crmAccounts)
          .set({
            email: account.email || (mapped.company.email ? String(mapped.company.email) : null),
            phone:
              account.phone ||
              (mapped.company.phone ? normalizeCanonicalPhone(String(mapped.company.phone)) : null),
            customFields,
            updatedAt: new Date(),
          })
          .where(and(eq(crmAccounts.tenantId, tenantId), eq(crmAccounts.id, accountId)));
      }
      // Serializa com ensureCwrDealOnContacting (Fagner SDR) para impedir card duplicado em condição de corrida
      await acquireCwrContactLock(tx, tenantId, contact.id);

      const recentThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [existingSdrDealRow] = await tx
        .select({ deal: crmDeals })
        .from(crmDealContacts)
        .innerJoin(
          crmDeals,
          and(eq(crmDeals.id, crmDealContacts.dealId), eq(crmDeals.tenantId, tenantId)),
        )
        .where(
          and(
            eq(crmDealContacts.tenantId, tenantId),
            eq(crmDealContacts.contactId, contact.id),
            eq(crmDeals.tenantId, tenantId),
            eq(crmDeals.pipelineId, settings.pipelineId),
            eq(crmDeals.status, "open"),
            ne(crmDeals.entryChannel, "rd_webhook"),
            gte(crmDeals.createdAt, recentThreshold),
          ),
        )
        .orderBy(desc(crmDeals.createdAt))
        .limit(1);

      let deal: { id: string; accountId: string | null };
      let dealActionMessage = "Contato vinculado e card criado no CRM.";

      if (existingSdrDealRow?.deal) {
        const existingDeal = existingSdrDealRow.deal;
        let enrichedAccountId = existingDeal.accountId || accountId || null;
        if (mapped.company.name && !enrichedAccountId) {
          const newAccId = `acc-${Date.now()}-${randomUUID().slice(0, 6)}`;
          await tx.insert(crmAccounts).values({
            id: newAccId,
            tenantId,
            name: String(mapped.company.name),
            document: mapped.company.document ? String(mapped.company.document) : null,
            type: String(mapped.company.document || "").length === 11 ? "person" : "company",
            email: mapped.company.email ? String(mapped.company.email) : null,
            phone: mapped.company.phone ? normalizeCanonicalPhone(String(mapped.company.phone)) : null,
            customFields: (mapped.company.customFields as CustomFieldValues) || {},
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          enrichedAccountId = newAccId;
        }

        const existingTitleClean = String(existingDeal.title || "").trim();
        const isWeakTitle =
          !existingTitleClean ||
          existingTitleClean.length <= 2 ||
          /^(cliente|contato|lead|whatsapp|lead whatsapp|contato whatsapp|\.+)$/i.test(
            existingTitleClean,
          ) ||
          /^\+?\d{8,20}$/.test(existingTitleClean.replace(/[\s().-]/g, ""));
        const incomingTitle = String(mapped.deal.title || "").trim();
        const mergedCustomFields: Record<string, unknown> = {
          ...((existingDeal.customFields as Record<string, unknown>) || {}),
        };
        for (const [cfKey, cfVal] of Object.entries(
          (mapped.deal.customFields as Record<string, unknown>) || {},
        )) {
          if (
            mergedCustomFields[cfKey] === undefined ||
            mergedCustomFields[cfKey] === null ||
            mergedCustomFields[cfKey] === ""
          ) {
            mergedCustomFields[cfKey] = cfVal;
          }
        }

        const nowEnrich = new Date();
        await tx
          .update(crmDeals)
          .set({
            title: isWeakTitle && incomingTitle ? incomingTitle : existingDeal.title,
            accountId: enrichedAccountId,
            operatorId: existingDeal.operatorId || settings.operatorId,
            entryChannel: "rd_webhook",
            source: dealSource || existingDeal.source,
            campaign: mapped.deal.campaign ? String(mapped.deal.campaign) : existingDeal.campaign,
            utmSource: detailedUtm.utmSource || existingDeal.utmSource,
            utmMedium: detailedUtm.utmMedium || existingDeal.utmMedium,
            utmCampaign: detailedUtm.utmCampaign || existingDeal.utmCampaign,
            utmContent: detailedUtm.utmContent || existingDeal.utmContent,
            utmTerm: detailedUtm.utmTerm || existingDeal.utmTerm,
            clickId: detailedUtm.clickId || existingDeal.clickId,
            landingPage: detailedUtm.landingPage || existingDeal.landingPage,
            value: existingDeal.value || (mapped.deal.value ? String(mapped.deal.value) : null),
            customFields: mergedCustomFields,
            version: sql`${crmDeals.version} + 1`,
            lastActivityAt: nowEnrich,
            updatedAt: nowEnrich,
          })
          .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, existingDeal.id)));

        await tx.insert(crmDealEvents).values({
          id: `ev-rd-merge-${Date.now()}-${randomUUID().slice(0, 6)}`,
          tenantId,
          dealId: existingDeal.id,
          eventType: "note_added",
          operatorId: settings.operatorId || null,
          metadata: {
            origin: "rd_webhook_dedup_sdr",
            flowId: flow.id,
            text:
              (mapped.deal.initialNote ? `${String(mapped.deal.initialNote)}\n` : "") +
              `Lead RD Marketing vinculado ao card já aberto pelo atendimento WhatsApp/SDR (evitada duplicação).`,
          },
          createdAt: nowEnrich,
        });

        deal = { id: existingDeal.id, accountId: enrichedAccountId };
        dealActionMessage =
          "Contato vinculado ao card já aberto no funil pelo WhatsApp/SDR (duplicação evitada e dados RD enriquecidos).";
      } else {
        deal = await crmService.createDeal(
          tenantId,
          null,
          {
            title: String(mapped.deal.title),
            marketingOrigin: true,
            pipelineId: settings.pipelineId,
            stageId: settings.stageId,
            operatorId: settings.operatorId,
            contactId: contact.id,
            accountId,
            account:
              mapped.company.name && !accountId
                ? {
                    name: String(mapped.company.name),
                    document: mapped.company.document ? String(mapped.company.document) : null,
                    type: String(mapped.company.document || "").length === 11 ? "person" : "company",
                    email: mapped.company.email ? String(mapped.company.email) : null,
                    phone: mapped.company.phone ? String(mapped.company.phone) : null,
                    customFields: mapped.company.customFields as CustomFieldValues,
                  }
                : null,
            source: dealSource,
            campaign: mapped.deal.campaign ? String(mapped.deal.campaign) : undefined,
            entryChannel: "rd_webhook",
            utmSource: detailedUtm.utmSource,
            utmMedium: detailedUtm.utmMedium,
            utmCampaign: detailedUtm.utmCampaign,
            utmContent: detailedUtm.utmContent,
            utmTerm: detailedUtm.utmTerm,
            clickId: detailedUtm.clickId,
            landingPage: detailedUtm.landingPage,
            value: mapped.deal.value ? String(mapped.deal.value) : null,
            initialNote: mapped.deal.initialNote ? String(mapped.deal.initialNote) : null,
            customFields: mapped.deal.customFields as CustomFieldValues,
          },
          tx,
        );

        // Se o contato já possui conversa ativa em automação onde o SDR já respondeu, vincula o card e avança para CONTATANDO
        const [activeAutoConv] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              eq(conversations.contactId, contact.id),
              eq(conversations.queueState, "automacao"),
            ),
          )
          .orderBy(desc(conversations.lastMessageTime), desc(conversations.createdAt))
          .limit(1);

        if (activeAutoConv) {
          await tx
            .insert(crmConversationDeals)
            .values({
              id: `cd-${Date.now()}-${randomUUID().slice(0, 8)}`,
              tenantId,
              conversationId: activeAutoConv.id,
              dealId: deal.id,
              origin: "crm",
              createdByOperatorId: settings.operatorId || null,
              isActive: true,
              createdAt: new Date(),
            })
            .onConflictDoNothing();

          const [botMsg] = await tx
            .select({ id: messages.id })
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.conversationId, activeAutoConv.id),
                eq(messages.senderType, "bot"),
              ),
            )
            .limit(1);

          if (botMsg) {
            await ensureCwrDealOnContacting(tx, {
              tenantId,
              conversationId: activeAutoConv.id,
              contactId: contact.id,
              dealIdHint: deal.id,
            });
          }
        }
      }
      if (deal.accountId && !contact.accountId)
        await tx
          .update(contacts)
          .set({ accountId: deal.accountId })
          .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contact.id)));
      await tx
        .update(rdMarketingReceipts)
        .set({ dealId: deal.id })
        .where(
          and(eq(rdMarketingReceipts.tenantId, tenantId), eq(rdMarketingReceipts.id, receipt.id)),
        );
      await tx.insert(rdMarketingLogs).values({
        id: randomUUID(),
        tenantId,
        flowId: flow.id,
        status: "created",
        dealId: deal.id,
        message: dealActionMessage,
      });
      if (settings.whatsappTemplateId) {
        templateJobs.push({
          tenantId,
          flowId: flow.id,
          dealId: deal.id,
          contactId: contact.id,
          whatsappTemplateId: settings.whatsappTemplateId,
          clientName: contact.name,
          companyName: mapped.company.name ? String(mapped.company.name) : null,
          document: mapped.company.document ? String(mapped.company.document) : null,
        });
      }
      txOutcomes.push({ status: "created", dealId: deal.id });
    }
    return txOutcomes;
  });

  // Disparo pós-commit do template WhatsApp pelo Fagner/SDR + movimentação CONTATAR -> CONTATANDO no CWR
  for (const job of templateJobs) {
    try {
      await dispatchRdSdrTemplatePostCommit(job);
    } catch (err) {
      console.error("[RD Marketing] Erro ao disparar template pós-commit:", err);
    }
  }

  return outcomes;
}

export async function listFlows(tenantId: string, origin?: string) {
  const [rawFlows, logs] = await Promise.all([
    db
      .select({
        id: rdMarketingFlows.id,
        settings: rdMarketingFlows.settings,
        tokenEncrypted: rdMarketingFlows.tokenEncrypted,
      })
      .from(rdMarketingFlows)
      .where(eq(rdMarketingFlows.tenantId, tenantId))
      .orderBy(desc(rdMarketingFlows.createdAt)),
    db
      .select({
        id: rdMarketingLogs.id,
        flowId: rdMarketingLogs.flowId,
        status: rdMarketingLogs.status,
        dealId: rdMarketingLogs.dealId,
        message: rdMarketingLogs.message,
        createdAt: rdMarketingLogs.createdAt,
      })
      .from(rdMarketingLogs)
      .where(and(eq(rdMarketingLogs.tenantId, tenantId), ne(rdMarketingLogs.status, "diagnostic")))
      .orderBy(desc(rdMarketingLogs.createdAt))
      .limit(50),
  ]);
  const flows = rawFlows.map(({ id, settings, tokenEncrypted }) => {
    const token = decodeFlowWebhookToken(tenantId, tokenEncrypted);
    return {
      id,
      settings,
      webhookUrl: token && origin ? buildFlowWebhookUrl(origin, token) : null,
    };
  });
  return { flows, logs };
}
