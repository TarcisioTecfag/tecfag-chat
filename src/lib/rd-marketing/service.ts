import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, ne, or, sql, desc, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  contacts,
  crmAccounts,
  crmStages,
  crmPipelines,
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
import { buildPhoneSearchTerms, normalizeCanonicalPhone } from "../utils";
import { recordRdDiagnostic } from "./diagnostic-store";
import {
  availablePaths,
  deliveryIdentity,
  extractLeads,
  flowSettingsSchema,
  mapLead,
  type FlowSettings,
} from "./mapping";

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

export async function previewFlow(tenantId: string, input: unknown, payload: unknown) {
  const settings = await validateFlow(tenantId, input);
  const leads = extractLeads(payload);
  const results = [];
  for (const lead of leads) {
    deliveryIdentity(lead, settings);
    results.push(await prepareLead(tenantId, lead, settings));
  }
  return { paths: availablePaths(leads[0]), results };
}

async function resolveContact(
  tenantId: string,
  mapped: Awaited<ReturnType<typeof prepareLead>>,
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
          email ? sql`lower(${contacts.email}) = ${email}` : undefined,
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
    const aHasPhone = Boolean(aDigits && phoneSet.has(aDigits));
    const bHasPhone = Boolean(bDigits && phoneSet.has(bDigits));
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
      for (const [key, value] of Object.entries((candidate.customFields || {}) as Record<string, unknown>)) {
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
      phone && matches.some((m) => m.id !== existing.id && cleanDigits(m.phone) === phone),
    );
    const nextPhone = existing.phone || (!phoneOwnedByOther && phone ? phone : null);
    const nextEmail = existing.email || email || sortedMatches.find((m) => m.email)?.email || null;
    const nextAccountId =
      existing.accountId || sortedMatches.find((m) => m.accountId)?.accountId || null;
    await tx
      .update(contacts)
      .set({
        phone: nextPhone,
        email: nextEmail,
        accountId: nextAccountId,
        customFields,
      })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, existing.id)));
    return {
      ...existing,
      phone: nextPhone,
      email: nextEmail,
      accountId: nextAccountId,
      customFields,
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
  const leads = extractLeads(payload);
  // Rejeitar problemas do payload antes de reservar conexões ou abrir uma transação.
  for (const lead of leads) {
    deliveryIdentity(lead, parsed.data);
    mapLead(lead, parsed.data);
  }
  const settings = await validateFlow(tenantId, parsed.data);
  // Card, contato e recibo são confirmados juntos. Reenvios simultâneos aguardam o índice único.
  return db.transaction(async (tx) => {
    const outcomes = [];
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
        outcomes.push({ status: "duplicate", dealId: previous?.dealId });
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
      const contact = await resolveContact(tenantId, mapped, tx);
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
      const deal = await crmService.createDeal(
        tenantId,
        null,
        {
          title: String(mapped.deal.title),
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
          source: mapped.deal.source ? String(mapped.deal.source) : "Não informada",
          campaign: mapped.deal.campaign ? String(mapped.deal.campaign) : undefined,
          value: mapped.deal.value ? String(mapped.deal.value) : null,
          initialNote: mapped.deal.initialNote ? String(mapped.deal.initialNote) : null,
          customFields: mapped.deal.customFields as CustomFieldValues,
        },
        tx,
      );
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
        message: "Contato vinculado e card criado no CRM.",
      });
      outcomes.push({ status: "created", dealId: deal.id });
    }
    return outcomes;
  });
}

export async function listFlows(tenantId: string) {
  const [flows, logs] = await Promise.all([
    db
      .select({ id: rdMarketingFlows.id, settings: rdMarketingFlows.settings })
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
  return { flows, logs };
}
