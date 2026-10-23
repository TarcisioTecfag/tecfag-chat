import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { db } from "../../db";
import {
  contacts,
  crmDealContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  operators,
  rdMarketingConnections,
  rdMarketingFlows,
  rdMarketingJourneyLinks as links,
  rdMarketingJourneyPages as pages,
  rdMarketingReceipts,
  rdMarketingJourneyNotifications,
  rdMarketingCommercialOutbox,
} from "../../db/schema";
import { CrmError } from "../crm/crm-service";
import { getContactDealRows } from "../crm/contact-deals-query";
import { parseRdEventPage, rdEventsPath, type RdFetch } from "./api-client";
import { notificationKey } from "./notifications";
import { readRdEventPage, probeRdLead } from "./api-service";
import { deliveryIdentity, flowSettingsSchema } from "./mapping";
import type { RdJourney, JourneyEvent } from "./journey-types";
import type { RdEventType } from "./api-types";

type Viewer = { operatorId: string; canViewAll: boolean; allowedPipelineIds?: string[] | null };
type Query = {
  contactId?: string;
  eventType?: RdEventType;
  page?: number;
  snapshotId?: string;
  refresh?: boolean;
};
const canRead = (owner: string | null, viewer: Viewer) =>
  viewer.canViewAll || !owner || owner === viewer.operatorId;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const rawObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function journeyEventKey(event: { id: string | null; raw: unknown }, type: RdEventType) {
  const explicitId = rawObject(event.raw).event_uuid;
  return hash(
    `${type}:${typeof explicitId === "string" && explicitId ? explicitId : stable(event.raw)}`,
  );
}
async function connectionVersion(tenantId: string, reader: Pick<typeof db, "select"> = db) {
  const [row] = await reader
    .select()
    .from(rdMarketingConnections)
    .where(eq(rdMarketingConnections.tenantId, tenantId));
  if (!row?.accessTokenEncrypted || !row.refreshTokenEncrypted)
    throw new CrmError(
      "O administrador precisa conectar a conta RD Marketing nas configurações.",
      "RD_NOT_CONNECTED",
      409,
    );
  return row.version;
}

export async function dealRdJourney(
  tenantId: string,
  dealId: string,
  viewer: Viewer,
  query: Query = {},
  fetchImpl?: RdFetch,
): Promise<RdJourney> {
  const [deal] = await db
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)));
  if (!deal) throw new CrmError("Negociação não encontrada.", "NOT_FOUND", 404);
  if (!canRead(deal.operatorId, viewer))
    throw new CrmError("Permissão insuficiente para esta negociação.", "FORBIDDEN", 403);
  const participants = await db
    .select({ contact: contacts, isPrimary: crmDealContacts.isPrimary })
    .from(crmDealContacts)
    .innerJoin(
      contacts,
      and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, tenantId)),
    )
    .where(
      and(
        eq(crmDealContacts.tenantId, tenantId),
        eq(crmDealContacts.dealId, dealId),
        eq(contacts.tenantId, tenantId),
      ),
    );
  const selected = query.contactId
    ? participants.find((item) => item.contact.id === query.contactId)
    : participants.find((item) => item.isPrimary) || participants[0];
  if (!selected)
    throw new CrmError(
      "Selecione um contato vinculado a esta negociação.",
      "RD_CONTACT_REQUIRED",
      404,
    );
  const contact = selected.contact;
  const version = await connectionVersion(tenantId);
  if (query.eventType)
    rdEventsPath("00000000-0000-0000-0000-000000000000", query.eventType, query.page || 0);
  if (query.eventType && !query.snapshotId)
    throw new CrmError(
      "Atualize a jornada antes de carregar outras páginas.",
      "RD_SNAPSHOT_REQUIRED",
      409,
    );

  const [existing] = await db
    .select()
    .from(links)
    .where(and(eq(links.tenantId, tenantId), eq(links.contactId, contact.id)));
  const sameConnection = existing?.connectionVersion === version;
  if (query.eventType && (!sameConnection || query.snapshotId !== existing.snapshotId))
    throw new CrmError(
      "A jornada foi atualizada em outro card. Clique em Atualizar jornada.",
      "RD_SNAPSHOT_CHANGED",
      409,
    );
  // Saved journeys do not expire. Opening a card must not spend another RD request.
  const refresh = !query.eventType && (!sameConnection || query.refresh);
  const scope = existing
    ? and(
        eq(pages.tenantId, tenantId),
        eq(pages.linkId, existing.id),
        eq(pages.snapshotId, existing.snapshotId),
      )
    : undefined;
  let data =
    existing && sameConnection
      ? await db
          .select()
          .from(pages)
          .where(
            query.eventType
              ? and(scope, eq(pages.eventType, query.eventType), eq(pages.page, query.page!))
              : scope,
          )
      : [];
  let fetched: import("./api-types").RdEventPage[] = [];
  let uuid = sameConnection ? existing.rdUuid : "";
  const needsFetch = refresh || !data.length;
  // Provider calls run outside the cache transaction. Nested transactions could exhaust the pool.
  if (needsFetch) {
    if (query.eventType) {
      const previous = await db
        .select()
        .from(pages)
        .where(and(scope, eq(pages.eventType, query.eventType), eq(pages.page, query.page! - 1)));
      if (!previous[0] || previous[0].data.nextPage !== query.page)
        throw new CrmError("Carregue as páginas da jornada em ordem.", "RD_PAGE_INVALID", 400);
      fetched = [await readRdEventPage(tenantId, uuid, query.eventType, query.page!, fetchImpl)];
    } else if (!uuid) {
      const email = contact.email?.trim();
      const phone = contact.phone?.trim();
      const digits = phone?.replace(/\D/g, "") || "";
      const international = phone?.startsWith("+")
        ? phone
        : digits.startsWith("55") && [12, 13].includes(digits.length)
          ? "+" + digits
          : "";
      if (!email && !international)
        throw new CrmError(
          "Este contato precisa de e-mail ou telefone com código do país para localizar o lead no RD.",
          "RD_IDENTIFIER_REQUIRED",
          409,
        );
      const probe = await probeRdLead(
        tenantId,
        email ? "email" : "phone",
        email || international,
        fetchImpl,
      );
      if (email && probe.contact.email?.trim().toLowerCase() !== email.toLowerCase())
        throw new CrmError(
          "O contato retornado pelo RD não corresponde ao e-mail solicitado.",
          "RD_CONTACT_MISMATCH",
          409,
        );
      if (!email) {
        const raw = rawObject(probe.contact.raw);
        const candidates = [raw.phone, raw.personal_phone, raw.mobile_phone]
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.replace(/\D/g, ""));
        if (!candidates.includes(international.replace(/\D/g, "")))
          throw new CrmError(
            "O contato retornado pelo RD não corresponde ao telefone solicitado.",
            "RD_CONTACT_MISMATCH",
            409,
          );
      }
      uuid = probe.contact.uuid;
      fetched = probe.pages;
    } else
      fetched = await Promise.all(
        (["CONVERSION", "OPPORTUNITY"] as const).map((type) =>
          readRdEventPage(tenantId, uuid, type, 1, fetchImpl),
        ),
      );
  }
  let result = { link: existing, data, cached: !needsFetch };
  if (needsFetch)
    try {
      result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rd-journey:${tenantId}:${contact.id}`}, 0))`,
        );
        if ((await connectionVersion(tenantId, tx)) !== version)
          throw new CrmError(
            "A conta RD foi alterada durante a consulta. Atualize a jornada.",
            "RD_CONNECTION_CHANGED",
            409,
          );
        let [link] = await tx
          .select()
          .from(links)
          .where(and(eq(links.tenantId, tenantId), eq(links.contactId, contact.id)))
          .for("update");
        if (query.eventType) {
          if (!link || link.snapshotId !== query.snapshotId || link.connectionVersion !== version)
            throw new CrmError(
              "A jornada mudou. Atualize antes de carregar outras páginas.",
              "RD_SNAPSHOT_CHANGED",
              409,
            );
          await tx
            .insert(pages)
            .values({
              id: randomUUID(),
              tenantId,
              linkId: link.id,
              snapshotId: link.snapshotId,
              eventType: fetched[0].eventType,
              page: fetched[0].page,
              data: fetched[0],
            })
            .onConflictDoNothing();
          data = await tx
            .select()
            .from(pages)
            .where(
              and(
                eq(pages.tenantId, tenantId),
                eq(pages.linkId, link.id),
                eq(pages.snapshotId, link.snapshotId),
                eq(pages.eventType, query.eventType),
                eq(pages.page, query.page!),
              ),
            );
        } else if (
          link &&
          link.connectionVersion === version &&
          link.snapshotId !== existing?.snapshotId
        ) {
          // Another reader completed the same refresh; share that snapshot.
          data = await tx
            .select()
            .from(pages)
            .where(
              and(
                eq(pages.tenantId, tenantId),
                eq(pages.linkId, link.id),
                eq(pages.snapshotId, link.snapshotId),
              ),
            );
        } else {
          const values = {
            tenantId,
            contactId: contact.id,
            connectionVersion: version,
            rdUuid: uuid,
            snapshotId: randomUUID(),
            syncedAt: new Date(),
          };
          if (link) {
            [link] = await tx
              .update(links)
              .set(values)
              .where(and(eq(links.tenantId, tenantId), eq(links.id, link.id)))
              .returning();
            await tx
              .delete(pages)
              .where(and(eq(pages.tenantId, tenantId), eq(pages.linkId, link.id)));
          } else
            [link] = await tx
              .insert(links)
              .values({ id: randomUUID(), ...values })
              .returning();
          data = [];
          for (const page of fetched)
            data.push(
              ...(await tx
                .insert(pages)
                .values({
                  id: randomUUID(),
                  tenantId,
                  linkId: link.id,
                  snapshotId: link.snapshotId,
                  eventType: page.eventType,
                  page: 1,
                  data: page,
                })
                .returning()),
            );
        }
        return { link, data, cached: false };
      });
    } catch (error) {
      const cause = error as { cause?: { code?: string }; code?: string };
      if ((cause.cause?.code || cause.code) === "23505")
        throw new CrmError(
          "Este lead do RD já está vinculado a outro contato do sistema. O administrador precisa revisar o vínculo.",
          "RD_IDENTITY_CONFLICT",
          409,
        );
      throw error;
    }
  // An authorization change also invalidates cache responses, not just fresh reads.
  if ((await connectionVersion(tenantId)) !== version)
    throw new CrmError(
      "A conta RD foi alterada. Atualize a jornada.",
      "RD_CONNECTION_CHANGED",
      409,
    );
  // Reinterpret saved raw pages with the current reader; parser fixes do not require an RD call.
  const normalizedPages = result.data.map((row) => {
    const normalized = parseRdEventPage(row.data.raw, row.data.eventType, row.data.page);
    return normalized.recognized ? normalized : row.data;
  });
  const received: JourneyEvent[] = normalizedPages.flatMap((page) =>
    page.events.map((event) => ({
      ...event,
      key:
        event.date && Number.isFinite(new Date(event.date).getTime()) && event.identifier
          ? notificationKey(
              result.link.rdUuid,
              page.eventType,
              new Date(event.date),
              page.eventType === "OPPORTUNITY" && event.identifier === "OPPORTUNITY"
                ? "default"
                : event.identifier,
              event.raw,
            )
          : journeyEventKey(event, page.eventType),
      eventType: page.eventType,
      deals: [],
    })),
  );
  const events = [...new Map(received.map((event) => [event.key, event])).values()];
  const notices = await db
    .select()
    .from(rdMarketingJourneyNotifications)
    .where(
      and(
        eq(rdMarketingJourneyNotifications.tenantId, tenantId),
        eq(rdMarketingJourneyNotifications.connectionVersion, version),
        or(
          eq(rdMarketingJourneyNotifications.rdUuid, result.link.rdUuid),
          and(
            isNull(rdMarketingJourneyNotifications.rdUuid),
            eq(rdMarketingJourneyNotifications.contactId, contact.id),
          ),
        ),
      ),
    )
    .orderBy(desc(rdMarketingJourneyNotifications.receivedAt));
  for (const notice of notices) {
    const match =
      notice.occurredAt &&
      events.find(
        (event) =>
          event.eventType === notice.eventType &&
          event.date &&
          new Date(event.date).getTime() === notice.occurredAt!.getTime() &&
          (event.identifier === notice.identifier ||
            (notice.eventType === "OPPORTUNITY" &&
              event.identifier === "OPPORTUNITY" &&
              notice.identifier === "default")),
      );
    if (match) {
      match.observedSource = notice.data.observedSource;
      match.observedCampaign = notice.data.observedCampaign;
      match.observedLifecycle = notice.data.observedLifecycle;
      match.webhookRaw = notice.data.raw;
      continue;
    }
    events.push({
      id: notice.id,
      key:
        notice.occurredAt && notice.eventType !== "AUTOMATION"
          ? notificationKey(
              result.link.rdUuid,
              notice.eventType,
              notice.occurredAt,
              notice.identifier,
              notice.data.raw,
            )
          : `notice:${notice.eventKey}`,
      eventType: notice.eventType as JourneyEvent["eventType"],
      identifier: notice.identifier,
      date:
        notice.occurredAt?.toISOString() ||
        (notice.eventType === "AUTOMATION" ? notice.receivedAt.toISOString() : null),
      source: notice.data.source,
      campaign: notice.data.campaign,
      medium: notice.data.medium,
      label: notice.eventType === "AUTOMATION" ? notice.data.label : undefined,
      observedSource: notice.data.observedSource,
      observedCampaign: notice.data.observedCampaign,
      observedLifecycle: notice.data.observedLifecycle,
      receivedAt: notice.receivedAt.toISOString(),
      links: notice.data.links,
      raw: notice.data.raw,
      deals: [],
    });
  }
  const flows = await db
    .select()
    .from(rdMarketingFlows)
    .where(eq(rdMarketingFlows.tenantId, tenantId));
  const eligible = flows.flatMap((flow) => {
    const parsed = flowSettingsSchema.safeParse(flow.settings);
    return parsed.success &&
      parsed.data.deduplication === "event" &&
      parsed.data.eventIdPath === "rd_conversion.id"
      ? [{ id: flow.id, settings: parsed.data }]
      : [];
  });
  const candidates = new Map<string, Set<string>>();
  for (const event of events) {
    if (
      event.eventType !== "CONVERSION" ||
      !event.date ||
      !Number.isFinite(new Date(event.date).getTime()) ||
      !event.identifier ||
      !eligible.length
    )
      continue;
    const raw = rawObject(event.raw);
    const payload = rawObject(raw.payload || raw.contact);
    const rdEvent = { event_timestamp: event.date, event_identifier: event.identifier };
    const identities: Record<string, unknown>[] = [{ uuid: result.link.rdUuid, rd_event: rdEvent }];
    if (typeof payload.email === "string" && payload.email.trim())
      identities.push({ email: payload.email, rd_event: rdEvent });
    for (const identity of identities) {
      const digest = hash(deliveryIdentity(identity, eligible[0].settings));
      if (!candidates.has(digest)) candidates.set(digest, new Set());
      candidates.get(digest)!.add(event.key);
    }
  }
  if (candidates.size) {
    const matches = await db
      .select({
        hash: rdMarketingReceipts.identityHash,
        id: crmDeals.id,
        title: crmDeals.title,
        owner: crmDeals.operatorId,
      })
      .from(rdMarketingReceipts)
      .innerJoin(
        crmDeals,
        and(eq(crmDeals.id, rdMarketingReceipts.dealId), eq(crmDeals.tenantId, tenantId)),
      )
      .innerJoin(
        crmDealContacts,
        and(
          eq(crmDealContacts.dealId, crmDeals.id),
          eq(crmDealContacts.tenantId, tenantId),
          eq(crmDealContacts.contactId, contact.id),
        ),
      )
      .where(
        and(
          eq(rdMarketingReceipts.tenantId, tenantId),
          eq(crmDeals.tenantId, tenantId),
          eq(crmDealContacts.tenantId, tenantId),
          inArray(
            rdMarketingReceipts.flowId,
            eligible.map((flow) => flow.id),
          ),
          inArray(rdMarketingReceipts.identityHash, [...candidates.keys()]),
        ),
      );
    for (const match of matches)
      if (canRead(match.owner, viewer))
        for (const event of events) {
          if (
            candidates.get(match.hash)?.has(event.key) &&
            !event.deals.some((deal) => deal.id === match.id)
          )
            event.deals.push({ id: match.id, title: match.title });
        }
  }
  const related = await getContactDealRows(db, tenantId, contact.id);
  const commercial = await db
    .select({
      delivery: rdMarketingCommercialOutbox,
      owner: crmDeals.operatorId,
      title: crmDeals.title,
    })
    .from(rdMarketingCommercialOutbox)
    .innerJoin(
      crmDeals,
      and(eq(crmDeals.id, rdMarketingCommercialOutbox.dealId), eq(crmDeals.tenantId, tenantId)),
    )
    .where(
      and(
        eq(rdMarketingCommercialOutbox.tenantId, tenantId),
        eq(rdMarketingCommercialOutbox.connectionVersion, version),
        eq(rdMarketingCommercialOutbox.contactId, contact.id),
        eq(rdMarketingCommercialOutbox.status, "sent"),
        inArray(rdMarketingCommercialOutbox.eventType, ["OPPORTUNITY", "SALE", "OPPORTUNITY_LOST"]),
      ),
    );
  for (const { delivery, owner, title } of commercial)
    if (canRead(owner, viewer))
      events.push({
        id: delivery.externalEventId,
        key: `commercial:${delivery.id}`,
        eventType: delivery.eventType as JourneyEvent["eventType"],
        label:
          delivery.eventType === "SALE"
            ? "Venda informada ao RD Marketing"
            : delivery.eventType === "OPPORTUNITY_LOST"
              ? "Perda informada ao RD Marketing"
              : "Oportunidade informada ao RD Marketing",
        identifier: delivery.dealId,
        date: String(delivery.snapshot.occurredAt || delivery.sentAt?.toISOString() || "") || null,
        source: typeof delivery.snapshot.source === "string" ? delivery.snapshot.source : null,
        campaign:
          typeof delivery.snapshot.campaign === "string" ? delivery.snapshot.campaign : null,
        links: [],
        raw: {
          event_type: delivery.eventType,
          event_uuid: delivery.externalEventId,
          sent_at: delivery.sentAt?.toISOString(),
          payload: delivery.payload,
          negotiation: delivery.snapshot,
        },
        deals: [{ id: delivery.dealId, title }],
      });
  return {
    contactId: contact.id,
    contactName: contact.name || "Contato",
    snapshotId: result.link.snapshotId,
    syncedAt: result.link.syncedAt.toISOString(),
    cached: result.cached,
    pages: normalizedPages,
    events,
    relatedDeals: related
      .filter((deal) => (viewer.canViewAll || deal.operatorId === viewer.operatorId) &&
        (viewer.allowedPipelineIds == null || viewer.allowedPipelineIds.includes(deal.pipelineId)))
      .map(deal => ({
        id: deal.id, title: deal.title, status: deal.status, value: deal.value, currency: deal.currency,
        pipelineName: deal.pipelineName, stageName: deal.stageName, operatorName: deal.operatorName,
        createdAt: deal.createdAt.toISOString(),
      })),
  };
}
