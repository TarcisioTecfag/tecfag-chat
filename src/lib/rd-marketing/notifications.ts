import { and, eq, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { db } from "../../db";
import {
  contacts,
  rdMarketingConnections,
  rdMarketingJourneyEndpoints as endpoints,
  rdMarketingJourneyLinks,
  rdMarketingJourneyNotifications as notifications,
} from "../../db/schema";
import { CrmError } from "../crm/crm-service";
import { rdPhoneDigits } from "./sync-identity";
import { extractLeads, conversionForLead } from "./mapping";
import { conversionAttribution } from "./attribution";
import { sanitizeRdResponse } from "./api-client";
import type { RdNotificationData } from "./sync-types";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const date = (value: unknown) =>
  typeof value === "string" && Number.isFinite(new Date(value).getTime()) ? new Date(value) : null;
export const rdIdentityHash = (value: string) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export function notificationKey(
  uuid: string,
  type: string,
  time: Date | null,
  identifier: string | null,
  fallback: unknown,
) {
  return rdIdentityHash(
    JSON.stringify([
      uuid,
      type,
      time?.toISOString(),
      identifier,
      time ? null : canonical(fallback),
    ]),
  );
}
type Endpoint = typeof endpoints.$inferSelect;
export function parseRdNotification(
  raw: unknown,
  endpoint: Pick<Endpoint, "id" | "kind" | "label">,
) {
  const root = object(raw);
  const actualType = text(root.event_type);
  const expected =
    endpoint.kind === "CONVERSION"
      ? ["WEBHOOK.CONVERTED", "CONVERSION"]
      : ["WEBHOOK.MARKED_OPPORTUNITY", "OPPORTUNITY"];
  if (endpoint.kind !== "AUTOMATION" && actualType && !expected.includes(actualType))
    throw new CrmError(
      "Evento não corresponde a este webhook de jornada.",
      "RD_EVENT_TYPE_INVALID",
      400,
    );
  return extractLeads(raw).map((lead) => {
    const uuid = text(lead.uuid);
    if (uuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))
      throw new CrmError("UUID RD inválido.", "RD_CONTACT_INVALID", 400);
    const email = text(lead.email)?.toLowerCase() || null;
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
      throw new CrmError("E-mail inválido.", "BAD_REQUEST", 400);
    const phone =
      rdPhoneDigits(
        text(lead.mobile_phone) || text(lead.personal_phone) || text(lead.phone) || "",
      ) || null;
    if (!uuid && !email && !phone)
      throw new CrmError("Aviso sem identificação do contato.", "RD_IDENTIFIER_REQUIRED", 400);
    const conversion = conversionForLead(lead);
    // Automation points prove a delivery at a configured point, not a native enter/exit event.
    const occurredAt =
      endpoint.kind === "AUTOMATION"
        ? null
        : date(root.event_timestamp) || date(conversion.occurredAt);
    const identifier =
      endpoint.kind === "AUTOMATION"
        ? endpoint.id
        : text(root.event_identifier) ||
          text(conversion.identifier) ||
          (endpoint.kind === "OPPORTUNITY" ? "default" : null);
    const identityTime =
      occurredAt ||
      (endpoint.kind === "AUTOMATION"
        ? date(root.event_timestamp) || date(conversion.occurredAt)
        : null);
    const identityLead = {
      ...lead,
      rd_event: { ...object(lead.rd_event), timestamp: undefined },
      timestamp: undefined,
    };
    const last = object(lead.last_conversion);
    const lastIdentity = conversionForLead({ last_conversion: last });
    const matched =
      endpoint.kind === "CONVERSION" &&
      occurredAt &&
      date(lastIdentity.occurredAt)?.getTime() === occurredAt.getTime() &&
      lastIdentity.identifier === identifier;
    const attribution = matched
      ? conversionAttribution(last)
      : { source: null, campaign: null, medium: null };
    const funnel = object(lead.funnel);
    const data: RdNotificationData = {
      label: endpoint.label,
      ...attribution,
      observedSource: text(funnel.origin) || text(lead.cf_utm_source),
      observedCampaign: text(lead.cf_utm_campaign),
      observedLifecycle: text(funnel.lifecycle_stage),
      links: [],
      raw: sanitizeRdResponse(raw),
    };
    return {
      rdUuid: uuid?.toLowerCase() || null,
      email,
      phone,
      occurredAt,
      identifier,
      eventType: endpoint.kind,
      eventKey: notificationKey(
        uuid?.toLowerCase() || email || phone!,
        endpoint.kind,
        identityTime,
        identifier,
        endpoint.kind === "AUTOMATION"
          ? [endpoint.id, sanitizeRdResponse(identityLead)]
          : sanitizeRdResponse(identityLead),
      ),
      data,
    };
  });
}
export async function journeyEndpointForToken(token: string, acknowledgeRetired = false) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new CrmError("Webhook inválido.", "UNAUTHORIZED", 401);
  // Public route authority: a random secret uniquely resolves tenant and account version.
  const [row] = await db
    .select({ endpoint: endpoints, connection: rdMarketingConnections })
    .from(endpoints)
    .leftJoin(
      rdMarketingConnections,
      and(
        eq(rdMarketingConnections.tenantId, endpoints.tenantId),
        eq(rdMarketingConnections.version, endpoints.connectionVersion),
      ),
    )
    .where(eq(endpoints.tokenHash, rdIdentityHash(token)));
  if (!row) throw new CrmError("Webhook inválido.", "UNAUTHORIZED", 401);
  if (!row.connection?.accessTokenEncrypted || !row.connection.refreshTokenEncrypted) {
    if (acknowledgeRetired) return { ...row.endpoint, enabled: false };
    throw new CrmError("Webhook inválido ou conexão alterada.", "UNAUTHORIZED", 401);
  }
  return row.endpoint;
}
export async function storeJourneyNotification(endpoint: Endpoint, raw: unknown) {
  if (!endpoint.enabled) return { accepted: true, paused: true, stored: 0 };
  // RD validates a new subscription before registering it. Accept a validation probe only
  // during the server-controlled registration window, never as a journey occurrence.
  const root = object(raw);
  if (
    endpoint.registrationStatus === "registering" &&
    !(text(root.event_type) && date(root.event_timestamp) && root.contact)
  )
    return { accepted: true, validation: true, stored: 0 };
  const inputs = parseRdNotification(raw, endpoint);
  return db.transaction(async (tx) => {
    const [active] = await tx
      .select()
      .from(rdMarketingConnections)
      .where(
        and(
          eq(rdMarketingConnections.tenantId, endpoint.tenantId),
          eq(rdMarketingConnections.version, endpoint.connectionVersion),
        ),
      );
    if (!active?.accessTokenEncrypted || !active.refreshTokenEncrypted)
      throw new CrmError("Conexão alterada.", "RD_CONNECTION_CHANGED", 409);
    let stored = 0;
    for (const input of inputs) {
      let contactId: string | null = null;
      if (input.rdUuid) {
        const [link] = await tx
          .select()
          .from(rdMarketingJourneyLinks)
          .where(
            and(
              eq(rdMarketingJourneyLinks.tenantId, endpoint.tenantId),
              eq(rdMarketingJourneyLinks.connectionVersion, endpoint.connectionVersion),
              eq(rdMarketingJourneyLinks.rdUuid, input.rdUuid),
            ),
          );
        contactId = link?.contactId || null;
      }
      if (!contactId && (input.email || input.phone)) {
        const matches = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, endpoint.tenantId),
              or(
                input.email ? sql`lower(trim(${contacts.email})) = ${input.email}` : undefined,
                input.phone
                  ? sql`regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g') = ${input.phone}`
                  : undefined,
              ),
            ),
          )
          .limit(2);
        if (matches.length === 1) contactId = matches[0].id;
      }
      const result = await tx
        .insert(notifications)
        .values({
          id: randomUUID(),
          tenantId: endpoint.tenantId,
          connectionVersion: endpoint.connectionVersion,
          endpointId: endpoint.id,
          contactId,
          ...input,
        })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      stored += result.length;
    }
    return { accepted: true, stored, duplicates: inputs.length - stored };
  });
}
