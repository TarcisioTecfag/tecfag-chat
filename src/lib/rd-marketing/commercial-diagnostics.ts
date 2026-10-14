import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  contacts,
  crmDealContacts,
  crmDeals,
  rdMarketingCommercialOutbox as outbox,
  rdMarketingJourneyLinks as links,
  rdMarketingReceipts,
  rdMarketingSyncSettings,
} from "../../db/schema";
import { permitsRdRecipient } from "./outbound-scope";
import { rdPhoneDigits } from "./sync-identity";
import type { RdSyncStatus } from "./sync-types";

export async function rdTestDealDiagnostics(
  tenantId: string,
  config: typeof rdMarketingSyncSettings.$inferSelect | undefined,
  version: string | undefined,
): Promise<RdSyncStatus["testDeals"]> {
  const target = config?.testContact;
  if (!target || config?.outboundScope !== "test" || config.connectionVersion !== version)
    return [];
  const phone = target.phone ? rdPhoneDigits(target.phone) : "";
  const candidates = await db
    .selectDistinct({
      id: crmDeals.id,
      title: crmDeals.title,
      status: crmDeals.status,
      value: crmDeals.value,
      currency: crmDeals.currency,
      updatedAt: crmDeals.updatedAt,
    })
    .from(crmDeals)
    .innerJoin(
      crmDealContacts,
      and(eq(crmDealContacts.dealId, crmDeals.id), eq(crmDealContacts.tenantId, tenantId)),
    )
    .innerJoin(
      contacts,
      and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, tenantId)),
    )
    .leftJoin(
      links,
      and(
        eq(links.contactId, contacts.id),
        eq(links.tenantId, tenantId),
        eq(links.connectionVersion, version || ""),
      ),
    )
    .where(
      and(
        eq(crmDeals.tenantId, tenantId),
        eq(crmDealContacts.tenantId, tenantId),
        eq(contacts.tenantId, tenantId),
        or(
          eq(links.rdUuid, target.uuid),
          target.email
            ? sql`lower(trim(${contacts.email})) = ${target.email.trim().toLowerCase()}`
            : undefined,
          phone
            ? sql`regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g') = ${phone}`
            : undefined,
        ),
      ),
    )
    .orderBy(desc(crmDeals.updatedAt), crmDeals.id)
    .limit(30);
  if (!candidates.length) return [];
  const ids = candidates.map((deal) => deal.id);
  const [participants, latest, imported] = await Promise.all([
    db
      .select({
        dealId: crmDealContacts.dealId,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        uuid: links.rdUuid,
      })
      .from(crmDealContacts)
      .innerJoin(
        contacts,
        and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, tenantId)),
      )
      .leftJoin(
        links,
        and(
          eq(links.contactId, contacts.id),
          eq(links.tenantId, tenantId),
          eq(links.connectionVersion, version || ""),
        ),
      )
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          eq(contacts.tenantId, tenantId),
          inArray(crmDealContacts.dealId, ids),
        ),
      )
      .orderBy(desc(crmDealContacts.isPrimary), asc(crmDealContacts.createdAt), crmDealContacts.id),
    db
      .selectDistinctOn([outbox.dealId], {
        dealId: outbox.dealId,
        status: outbox.status,
        eventType: outbox.eventType,
        error: outbox.lastError,
      })
      .from(outbox)
      .where(
        and(
          eq(outbox.tenantId, tenantId),
          eq(outbox.connectionVersion, version || ""),
          inArray(outbox.dealId, ids),
        ),
      )
      .orderBy(outbox.dealId, desc(outbox.createdAt), desc(outbox.dealVersion)),
    db
      .select({ dealId: rdMarketingReceipts.dealId })
      .from(rdMarketingReceipts)
      .where(
        and(eq(rdMarketingReceipts.tenantId, tenantId), inArray(rdMarketingReceipts.dealId, ids)),
      ),
  ]);
  return candidates.map((deal) => {
    const primary = participants.find((person) => person.dealId === deal.id);
    const event = latest.find((row) => row.dealId === deal.id);
    const payload = primary?.email?.trim()
      ? { email: primary.email.trim().toLowerCase() }
      : { phone: primary?.phone ? "+" + rdPhoneDigits(primary.phone) : "" };
    let reason: string;
    if (!config.outboundEnabled) reason = "Envios comerciais estão desativados.";
    else if (!primary) reason = "A negociação não possui contato vinculado.";
    else if (!permitsRdRecipient(config, payload, primary.uuid))
      reason =
        "O contato principal não corresponde ao contato de teste. Vincule o contato correto como principal antes de uma nova transição.";
    else if (event?.status === "blocked" || event?.status === "unknown")
      reason = event.error || "Confira os detalhes do envio abaixo.";
    else if (event?.status === "pending")
      reason =
        "Evento na fila. Confira tentativas, próxima tentativa e bloqueios nos detalhes abaixo.";
    else if (event?.status === "processing") reason = "Envio em processamento.";
    else if (event?.status === "sent")
      reason = `Último envio confirmado: ${event.eventType === "SALE" ? "venda" : event.eventType === "OPPORTUNITY_LOST" ? "perda da oportunidade" : "oportunidade"}. O RD apresenta eventos do lead, com representação diferente da integração nativa RD CRM.`;
    else if (deal.status === "won" && deal.value === null)
      reason = "Venda sem valor definido. O envio exige um valor válido.";
    else if (deal.status === "won" && deal.currency !== config.currency)
      reason = "Moeda da venda diferente da configuração do Marketing.";
    else if (imported.some((row) => row.dealId === deal.id))
      reason =
        "Card criado pelo RD: a criação não devolve outra oportunidade. Ganho/perda posteriores à ativação podem gerar envios.";
    else
      reason =
        "Nenhum envio registrado. São enviadas apenas novas criações manuais ou mudanças reais de status após ativar a configuração.";
    return {
      id: deal.id,
      title: deal.title,
      status: deal.status,
      primaryContact: primary?.name || null,
      reason,
      latestStatus: event?.status || null,
    };
  });
}

export async function rdQueueHeads(tenantId: string, deliveries: (typeof outbox.$inferSelect)[]) {
  const keys = [
    ...new Set(
      deliveries
        .filter((row) => row.status === "pending")
        .map((row) => row.contactId || row.dealId),
    ),
  ];
  if (!keys.length) return [];
  const key = sql<string>`coalesce(${outbox.contactId}, ${outbox.dealId})`;
  return db
    .selectDistinctOn([key], { key, id: outbox.id, status: outbox.status })
    .from(outbox)
    .where(
      and(
        eq(outbox.tenantId, tenantId),
        inArray(key, keys),
        inArray(outbox.status, ["pending", "processing", "unknown"]),
      ),
    )
    .orderBy(key, asc(outbox.createdAt), asc(outbox.dealVersion), outbox.id);
}
