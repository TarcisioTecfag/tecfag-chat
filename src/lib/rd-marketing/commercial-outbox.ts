import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../db";
import {
  contacts,
  crmDealContacts,
  rdMarketingCommercialOutbox as outbox,
  rdMarketingConnections,
  rdMarketingJourneyLinks,
  rdMarketingSyncSettings,
  type CrmDeal,
} from "../../db/schema";
import { rdPhoneDigits } from "./sync-identity";
import { permitsRdRecipient } from "./outbound-scope";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function commercialTransition(previous: string | null, status: string) {
  if (previous === status) return null;
  if (status === "won") return "SALE";
  if (status === "lost") return "OPPORTUNITY_LOST";
  if (status === "open" && (previous === null || previous === "won" || previous === "lost"))
    return "OPPORTUNITY";
  return null;
}
export async function enqueueRdCommercial(
  tx: Transaction,
  tenantId: string,
  deal: CrmDeal,
  previous: string | null,
) {
  const eventType = commercialTransition(previous, deal.status);
  if (!eventType) return;
  const [settings] = await tx
    .select()
    .from(rdMarketingSyncSettings)
    .where(eq(rdMarketingSyncSettings.tenantId, tenantId));
  if (!settings?.outboundEnabled) return;
  const [connection] = await tx
    .select()
    .from(rdMarketingConnections)
    .where(eq(rdMarketingConnections.tenantId, tenantId));
  if (
    !connection?.accessTokenEncrypted ||
    !connection.refreshTokenEncrypted ||
    settings.connectionVersion !== connection.version
  )
    return;
  const [participant] = await tx
    .select({ contact: contacts })
    .from(crmDealContacts)
    .innerJoin(
      contacts,
      and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, tenantId)),
    )
    .where(
      and(
        eq(crmDealContacts.tenantId, tenantId),
        eq(crmDealContacts.dealId, deal.id),
        eq(contacts.tenantId, tenantId),
      ),
    )
    .orderBy(desc(crmDealContacts.isPrimary), asc(crmDealContacts.createdAt), crmDealContacts.id)
    .limit(1);
  const contact = participant?.contact;
  const [link] = contact
    ? await tx
        .select()
        .from(rdMarketingJourneyLinks)
        .where(
          and(
            eq(rdMarketingJourneyLinks.tenantId, tenantId),
            eq(rdMarketingJourneyLinks.contactId, contact.id),
            eq(rdMarketingJourneyLinks.connectionVersion, connection.version),
          ),
        )
    : [];
  const phone = rdPhoneDigits(contact?.phone || "");
  const payload: Record<string, unknown> = { funnel_name: "default" };
  if (contact?.email?.trim()) payload.email = contact.email.trim().toLowerCase();
  else if (/^\d{10,15}$/.test(phone)) payload.phone = `+${phone}`;
  if (!permitsRdRecipient(settings, payload, link?.rdUuid || null)) return;
  const recipientUuid =
    link?.rdUuid || (settings.outboundScope === "test" ? settings.testContact?.uuid : null);
  if (eventType === "SALE") payload.value = deal.value === null ? null : Number(deal.value);
  const reason = !contact
    ? "Vincule o contato principal antes de enviar ao RD."
    : !payload.email && !payload.phone && !recipientUuid
      ? "Contato sem e-mail ou telefone para o RD."
      : eventType === "SALE" &&
          (payload.value === null ||
            !Number.isFinite(Number(payload.value)) ||
            Number(payload.value) < 0)
        ? "Informe um valor válido para a venda."
        : eventType === "SALE" && deal.currency !== settings.currency
          ? "Moeda da venda difere da moeda configurada no Marketing."
          : null;
  await tx
    .insert(outbox)
    .values({
      id: randomUUID(),
      tenantId,
      connectionVersion: connection.version,
      dealId: deal.id,
      contactId: contact?.id || null,
      dealVersion: deal.version,
      eventType,
      payload,
      snapshot: {
        title: deal.title,
        status: deal.status,
        previousStatus: previous,
        pipelineId: deal.pipelineId,
        stageId: deal.stageId,
        operatorId: deal.operatorId,
        source: deal.source,
        campaign: deal.campaign,
        currency: deal.currency,
        configuredCurrency: settings.currency,
        value: deal.value,
        lossReason: deal.lossReason,
        rdUuid: recipientUuid || null,
        outboundScope: settings.outboundScope,
        occurredAt: deal.updatedAt.toISOString(),
      },
      status: reason ? "blocked" : "pending",
      lastError: reason,
    })
    .onConflictDoNothing();
}

export async function runRdCommercialWorker(tenantId: string, fetchImpl?: typeof fetch) {
  const { readRdContact, writeRd } = await import("./api-service");
  const [settings] = await db
    .select()
    .from(rdMarketingSyncSettings)
    .where(eq(rdMarketingSyncSettings.tenantId, tenantId));
  if (!settings?.outboundEnabled) return { sent: 0 };
  const now = new Date();
  await db
    .update(outbox)
    .set({
      status: "unknown",
      leaseToken: null,
      leaseUntil: null,
      lastError: "Envio interrompido sem confirmação. Confira o histórico RD antes de reenviar.",
    })
    .where(
      and(
        eq(outbox.tenantId, tenantId),
        eq(outbox.status, "processing"),
        lte(outbox.leaseUntil, now),
      ),
    );
  let sent = 0;
  for (let count = 0; count < 10; count++) {
    const lease = randomUUID();
    const row = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rd-commercial:${tenantId}`}, 0))`,
      );
      const [item] = await tx
        .select()
        .from(outbox)
        .where(
          and(
            eq(outbox.tenantId, tenantId),
            eq(outbox.status, "pending"),
            lte(outbox.nextRetryAt, new Date()),
            sql`NOT EXISTS (SELECT 1 FROM rd_marketing_commercial_outbox earlier WHERE earlier.tenant_id = ${tenantId}
          AND coalesce(earlier.contact_id, earlier.deal_id) = coalesce(${outbox.contactId}, ${outbox.dealId})
          AND earlier.status IN ('pending', 'processing', 'unknown')
          AND (earlier.created_at, earlier.deal_version, earlier.id) < (${outbox.createdAt}, ${outbox.dealVersion}, ${outbox.id}))`,
          ),
        )
        .orderBy(asc(outbox.createdAt), asc(outbox.dealVersion), outbox.id)
        .for("update", { skipLocked: true })
        .limit(1);
      if (!item) return null;
      const [claimed] = await tx
        .update(outbox)
        .set({
          status: "processing",
          attempts: item.attempts + 1,
          leaseToken: lease,
          leaseUntil: new Date(Date.now() + 90_000),
        })
        .where(and(eq(outbox.tenantId, tenantId), eq(outbox.id, item.id)))
        .returning();
      return claimed;
    });
    if (!row) break;
    const scope = and(
      eq(outbox.tenantId, tenantId),
      eq(outbox.id, row.id),
      eq(outbox.leaseToken, lease),
    );
    try {
      const [connection] = await db
        .select()
        .from(rdMarketingConnections)
        .where(eq(rdMarketingConnections.tenantId, tenantId));
      if (
        connection?.version !== row.connectionVersion ||
        !connection.accessTokenEncrypted ||
        !connection.refreshTokenEncrypted
      ) {
        await db
          .update(outbox)
          .set({
            status: "blocked",
            lastError: "A conta RD mudou. Este evento pertence à conexão anterior.",
            leaseToken: null,
            leaseUntil: null,
          })
          .where(scope);
        continue;
      }
      const [deliveryConfig] = await db
        .select()
        .from(rdMarketingSyncSettings)
        .where(eq(rdMarketingSyncSettings.tenantId, tenantId));
      if (
        !deliveryConfig?.outboundEnabled ||
        deliveryConfig.connectionVersion !== row.connectionVersion
      ) {
        await db
          .update(outbox)
          .set({ status: "pending", leaseToken: null, leaseUntil: null })
          .where(scope);
        break;
      }
      const savedUuid = typeof row.snapshot.rdUuid === "string" ? row.snapshot.rdUuid : null;
      if (!permitsRdRecipient(deliveryConfig, row.payload, savedUuid))
        throw Object.assign(
          new Error("Envio bloqueado: fora do contato autorizado para teste isolado."),
          { code: "RD_TEST_RECIPIENT_BLOCKED" },
        );
      const rdUuid =
        savedUuid ||
        (deliveryConfig.outboundScope === "test" ? deliveryConfig.testContact?.uuid || null : null);
      const identity = rdUuid || String(row.payload.email || row.payload.phone || "");
      const contact = await readRdContact(
        tenantId,
        rdUuid ? "uuid" : row.payload.email ? "email" : "phone",
        identity,
        fetchImpl,
      );
      if (rdUuid && contact.uuid !== rdUuid)
        throw Object.assign(new Error("Lead RD não corresponde ao vínculo salvo."), {
          code: "RD_CONTACT_MISMATCH",
        });
      const payload = { ...row.payload };
      const root = contact.raw as Record<string, unknown>;
      const profile = (root.uuid ? root : root.contact || root.data || {}) as Record<
        string,
        unknown
      >;
      // Only `phone` is an RD identifier; personal/mobile numbers are profile information.
      const identifierPhone = typeof profile.phone === "string" ? rdPhoneDigits(profile.phone) : "";
      // UUID binds the person even after an email edit; use the current identifier of that lead.
      if (contact.email) {
        payload.email = contact.email.trim().toLowerCase();
        delete payload.phone;
      } else if (/^\d{10,15}$/.test(identifierPhone)) {
        payload.phone = `+${identifierPhone}`;
        delete payload.email;
      } else
        throw Object.assign(new Error("Lead RD sem identificador de envio."), {
          code: "RD_IDENTIFIER_REQUIRED",
        });
      if (
        !rdUuid &&
        row.payload.email &&
        contact.email?.trim().toLowerCase() !== String(row.payload.email).trim().toLowerCase()
      )
        throw Object.assign(new Error("Lead RD não corresponde ao contato."), {
          code: "RD_CONTACT_MISMATCH",
        });
      if (!rdUuid && !row.payload.email) {
        if (identifierPhone !== rdPhoneDigits(String(row.payload.phone || "")))
          throw Object.assign(new Error("Lead RD não corresponde ao telefone solicitado."), {
            code: "RD_CONTACT_MISMATCH",
          });
      }
      const [currentOptIn] = await db
        .select()
        .from(rdMarketingSyncSettings)
        .where(eq(rdMarketingSyncSettings.tenantId, tenantId));
      if (
        !currentOptIn?.outboundEnabled ||
        currentOptIn.connectionVersion !== row.connectionVersion
      ) {
        await db
          .update(outbox)
          .set({ status: "pending", leaseToken: null, leaseUntil: null })
          .where(scope);
        break;
      }
      const result = (await writeRd(
        tenantId,
        "/platform/events",
        { event_type: row.eventType, event_family: "CDP", payload },
        row.connectionVersion,
        fetchImpl,
        async () => {
          // Recheck the restriction for every POST, including a retry after token refresh.
          const [latest] = await db
            .select()
            .from(rdMarketingSyncSettings)
            .where(eq(rdMarketingSyncSettings.tenantId, tenantId));
          if (!latest?.outboundEnabled || latest.connectionVersion !== row.connectionVersion)
            throw Object.assign(new Error("Envio comercial desativado ou conexão alterada."), {
              code: "RD_OUTBOUND_PAUSED",
            });
          if (!permitsRdRecipient(latest, payload, contact.uuid))
            throw Object.assign(
              new Error("Envio bloqueado: fora do contato autorizado para teste isolado."),
              { code: "RD_TEST_RECIPIENT_BLOCKED" },
            );
        },
      )) as { event_uuid?: unknown };
      if (typeof result?.event_uuid !== "string" || !result.event_uuid)
        throw Object.assign(
          new Error(
            "RD respondeu sem identificação do evento. Confira o histórico antes de reenviar.",
          ),
          { code: "RD_CONFIRMATION_MISSING", rdPostStarted: true },
        );
      await db
        .update(outbox)
        .set({
          status: "sent",
          sentAt: new Date(),
          externalEventId: result.event_uuid,
          leaseToken: null,
          leaseUntil: null,
          lastError: null,
        })
        .where(scope);
      sent++;
    } catch (error) {
      const failure = error as { code?: string; rdPostStarted?: boolean; message?: string };
      const rejected = /^RD_HTTP_(400|401|403|404|409|422|429)$/.test(failure.code || "");
      const ambiguous = failure.rdPostStarted && !rejected;
      const retry =
        !ambiguous &&
        (failure.code === "RD_HTTP_429" ||
          failure.code === "RD_UNAVAILABLE" ||
          failure.code === "RD_HTTP_503");
      await db
        .update(outbox)
        .set({
          status: ambiguous ? "unknown" : retry && row.attempts < 8 ? "pending" : "blocked",
          lastError: ambiguous
            ? "Envio sem confirmação. Confira o histórico RD antes de reenviar."
            : failure.message || "Não foi possível enviar ao RD.",
          nextRetryAt: new Date(
            Date.now() + Math.min(60_000 * 2 ** Math.min(row.attempts, 6), 60 * 60_000),
          ),
          leaseToken: null,
          leaseUntil: null,
        })
        .where(scope);
    }
  }
  return { sent };
}
