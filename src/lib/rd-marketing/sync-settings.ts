import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../db";
import {
  contacts,
  crmDealContacts,
  crmDeals,
  rdMarketingCommercialOutbox as outbox,
  rdMarketingConnections as connections,
  rdMarketingJourneyEndpoints as endpoints,
  rdMarketingSyncSettings as settings,
} from "../../db/schema";
import { CrmError } from "../crm/crm-service";
import { decryptRdSecret, encryptRdSecret } from "./api-crypto";
import { listRdWebhooks, readRdContact, writeRd } from "./api-service";
import { rdIdentityHash } from "./notifications";
import { rdPhoneDigits } from "./sync-identity";
import { normalizeRdContactUuid, rdTestContactUuidError } from "./outbound-scope";
import type { RdOutboundScope, RdSyncStatus, RdTestContact } from "./sync-types";
import { rdCommercialRecovery } from "./commercial-recovery";
import { rdQueueHeads, rdTestDealDiagnostics } from "./commercial-diagnostics";

export function rdJourneyEndpointUrl(requestUrl: string, token: string) {
  const url = new URL(requestUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
    throw new CrmError("Webhook requer HTTPS.", "BAD_REQUEST", 400);
  return `${url.origin}/api/webhooks/rd-marketing/journey/${token}`;
}
async function connected(tenantId: string) {
  const [row] = await db.select().from(connections).where(eq(connections.tenantId, tenantId));
  if (!row?.accessTokenEncrypted || !row.refreshTokenEncrypted)
    throw new CrmError("Autorize a conta RD Marketing primeiro.", "RD_NOT_CONNECTED", 409);
  return row;
}
export async function rdSyncStatus(tenantId: string, requestUrl: string): Promise<RdSyncStatus> {
  const [row] = await db.select().from(connections).where(eq(connections.tenantId, tenantId));
  const [config] = await db.select().from(settings).where(eq(settings.tenantId, tenantId));
  const hooks = await db
    .select()
    .from(endpoints)
    .where(eq(endpoints.tenantId, tenantId))
    .orderBy(desc(endpoints.createdAt));
  const deliveries = await db
    .select()
    .from(outbox)
    .where(eq(outbox.tenantId, tenantId))
    .orderBy(desc(outbox.createdAt))
    .limit(30);
  const [testDeals, heads] = await Promise.all([
    rdTestDealDiagnostics(tenantId, config, row?.version),
    rdQueueHeads(tenantId, deliveries),
  ]);
  const missingHeads = heads
    .filter((head) => !deliveries.some((item) => item.id === head.id))
    .map((head) => head.id);
  if (missingHeads.length)
    deliveries.push(
      ...(await db
        .select()
        .from(outbox)
        .where(and(eq(outbox.tenantId, tenantId), inArray(outbox.id, missingHeads)))),
    );
  return {
    worker: rdCommercialRecovery.status(tenantId),
    testDeals,
    connected: !!(row?.accessTokenEncrypted && row.refreshTokenEncrypted),
    outboundEnabled: !!config?.outboundEnabled && config.connectionVersion === row?.version,
    outboundScope: config?.outboundScope || "test",
    testContact: config?.connectionVersion === row?.version ? config?.testContact || null : null,
    currency: config?.currency || "BRL",
    endpoints: hooks.map((hook) => ({
      id: hook.id,
      kind: hook.kind,
      label: hook.label,
      enabled: hook.enabled,
      currentConnection: hook.connectionVersion === row?.version,
      registrationStatus: hook.registrationStatus,
      lastError: hook.lastError,
      url: rdJourneyEndpointUrl(
        requestUrl,
        decryptRdSecret(tenantId, "journey-webhook", hook.tokenEncrypted),
      ),
    })),
    deliveries: deliveries.map((item) => ({
      id: item.id,
      dealId: item.dealId,
      title: String(item.snapshot.title || "Negociação"),
      eventType: item.eventType,
      status: item.status,
      lastError: item.lastError,
      createdAt: item.createdAt.toISOString(),
      attempts: item.attempts,
      nextRetryAt: item.status === "pending" ? item.nextRetryAt.toISOString() : null,
      sentAt: item.sentAt?.toISOString() || null,
      externalEventId: item.externalEventId,
      waitsFor: (() => {
        const first = heads.find((head) => head.key === (item.contactId || item.dealId));
        return item.status === "pending" && first && first.id !== item.id
          ? { id: first.id, status: first.status }
          : null;
      })(),
    })),
  };
}
export async function saveRdSyncSettings(
  tenantId: string,
  outboundEnabled: boolean,
  currency: string,
  scope: { outboundScope: RdOutboundScope; testContactUuid?: string | null },
  fetchImpl?: typeof fetch,
) {
  if (!/^[A-Z]{3}$/.test(currency))
    throw new CrmError("Informe a moeda utilizada no Marketing.", "BAD_REQUEST", 400);
  if (!["test", "all"].includes(scope.outboundScope))
    throw new CrmError("Escolha o destino dos envios.", "BAD_REQUEST", 400);
  const uuid = normalizeRdContactUuid(scope.testContactUuid || "");
  const uuidError =
    scope.outboundScope === "test" ? rdTestContactUuidError(uuid, outboundEnabled) : null;
  if (uuidError) throw new CrmError(uuidError, "BAD_REQUEST", 400);
  const connection =
    outboundEnabled || (scope.outboundScope === "test" && uuid) ? await connected(tenantId) : null;
  let testContact: RdTestContact | null = null;
  if (scope.outboundScope === "test" && uuid) {
    const contact = await readRdContact(tenantId, "uuid", uuid, fetchImpl);
    if (contact.uuid.toLowerCase() !== uuid)
      throw new CrmError(
        "O RD retornou outro contato. Confira o UUID de teste.",
        "BAD_REQUEST",
        400,
      );
    const [current] = await db.select().from(connections).where(eq(connections.tenantId, tenantId));
    if (current?.version !== connection?.version)
      throw new CrmError(
        "A conta RD mudou. Salve a configuração novamente.",
        "RD_CONNECTION_CHANGED",
        409,
      );
    testContact = { uuid, name: contact.name, email: contact.email, phone: contact.phone };
  }
  const values = {
    tenantId,
    outboundEnabled,
    outboundScope: scope.outboundScope,
    testContact,
    currency,
    connectionVersion: connection?.version || null,
    updatedAt: new Date(),
  };
  await db
    .insert(settings)
    .values(values)
    .onConflictDoUpdate({ target: settings.tenantId, set: values });
}
export async function createRdJourneyEndpoint(
  tenantId: string,
  kind: "CONVERSION" | "OPPORTUNITY" | "AUTOMATION",
  label: string,
) {
  const connection = await connected(tenantId);
  label = label.trim();
  if (!label || label.length > 160)
    throw new CrmError("Nome do ponto deve ter de 1 a 160 caracteres.", "BAD_REQUEST", 400);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rd-endpoints:${tenantId}`}, 0))`,
    );
    if (kind !== "AUTOMATION") {
      const [existing] = await tx
        .select()
        .from(endpoints)
        .where(
          and(
            eq(endpoints.tenantId, tenantId),
            eq(endpoints.connectionVersion, connection.version),
            eq(endpoints.kind, kind),
          ),
        );
      if (existing) return existing;
    }
    const token = randomBytes(32).toString("hex");
    const [hook] = await tx
      .insert(endpoints)
      .values({
        id: randomUUID(),
        tenantId,
        connectionVersion: connection.version,
        kind,
        label,
        tokenHash: rdIdentityHash(token),
        tokenEncrypted: encryptRdSecret(tenantId, "journey-webhook", token),
      })
      .returning();
    return hook;
  });
}
export async function registerRdJourneyEndpoint(
  tenantId: string,
  id: string,
  requestUrl: string,
  fetchImpl?: typeof fetch,
) {
  const connection = await connected(tenantId);
  const [hook] = await db
    .select()
    .from(endpoints)
    .where(and(eq(endpoints.tenantId, tenantId), eq(endpoints.id, id)));
  if (!hook || hook.connectionVersion !== connection.version || hook.kind === "AUTOMATION")
    throw new CrmError("Webhook não pertence à conexão atual.", "BAD_REQUEST", 400);
  const scope = and(eq(endpoints.tenantId, tenantId), eq(endpoints.id, id));
  const url = rdJourneyEndpointUrl(
    requestUrl,
    decryptRdSecret(tenantId, "journey-webhook", hook.tokenEncrypted),
  );
  const eventType = hook.kind === "CONVERSION" ? "WEBHOOK.CONVERTED" : "WEBHOOK.MARKED_OPPORTUNITY";
  await db
    .update(endpoints)
    .set({ registrationStatus: "registering", lastError: null, enabled: true })
    .where(scope);
  try {
    // Recover a subscription whose POST response was lost before attempting another POST.
    const raw = (await listRdWebhooks(tenantId, fetchImpl)) as
      { webhooks?: unknown[]; data?: unknown[] } | unknown[];
    const list = Array.isArray(raw) ? raw : raw?.webhooks || raw?.data;
    if (!Array.isArray(list))
      throw new CrmError(
        "Formato de lista de webhooks não reconhecido.",
        "RD_RESPONSE_INVALID",
        502,
      );
    const match = list.find(
      (value): value is Record<string, unknown> =>
        !!value &&
        typeof value === "object" &&
        (value as Record<string, unknown>).url === url &&
        (value as Record<string, unknown>).event_type === eventType,
    );
    const result =
      match ||
      ((await writeRd(
        tenantId,
        "/integrations/webhooks",
        {
          event_type: eventType,
          entity_type: "CONTACT",
          event_identifiers: [],
          url,
          http_method: "POST",
          include_relations: ["COMPANY", "CONTACT_FUNNEL"],
        },
        connection.version,
        fetchImpl,
      )) as Record<string, unknown>);
    const remoteId =
      typeof result.uuid === "string"
        ? result.uuid
        : typeof result.id === "string"
          ? result.id
          : null;
    if (!remoteId)
      throw new CrmError(
        "RD respondeu sem identificar a assinatura. Verifique o registro novamente.",
        "RD_RESPONSE_INVALID",
        502,
      );
    await db
      .update(endpoints)
      .set({ remoteId, registrationStatus: "registered", lastError: null })
      .where(scope);
  } catch (error) {
    const known = error as { message?: string; statusCode?: number };
    await db
      .update(endpoints)
      .set({
        registrationStatus: "error",
        lastError:
          known.statusCode && known.statusCode < 500
            ? known.message
            : "Não foi possível confirmar a assinatura no RD. Tente registrar novamente.",
      })
      .where(scope);
    throw error;
  }
}
export async function setRdJourneyEndpointEnabled(tenantId: string, id: string, enabled: boolean) {
  const [hook] = await db
    .update(endpoints)
    .set({ enabled })
    .where(and(eq(endpoints.tenantId, tenantId), eq(endpoints.id, id)))
    .returning();
  if (!hook) throw new CrmError("Webhook não encontrado.", "NOT_FOUND", 404);
}
export async function reviewRdDelivery(
  tenantId: string,
  id: string,
  operatorId: string,
  outcome: "retry" | "confirmed" | "not_recorded",
) {
  const connection = await connected(tenantId);
  await db.transaction(async (tx) => {
    const scope = and(eq(outbox.tenantId, tenantId), eq(outbox.id, id));
    const [row] = await tx.select().from(outbox).where(scope).for("update");
    if (!row) throw new CrmError("Envio não encontrado.", "NOT_FOUND", 404);
    if (row.connectionVersion !== connection.version)
      throw new CrmError(
        "Evento pertence à conexão anterior. Não pode ser enviado para outra conta.",
        "RD_CONNECTION_CHANGED",
        409,
      );
    if (
      row.status === "unknown"
        ? outcome === "retry"
        : !["blocked", "failed"].includes(row.status) || outcome !== "retry"
    )
      throw new CrmError(
        "Confira o resultado no RD antes de revisar este envio.",
        "BAD_REQUEST",
        400,
      );
    const payload = { ...row.payload };
    let contactId = row.contactId;
    if (outcome === "retry") {
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, row.dealId)));
      if (!deal) throw new CrmError("Negociação indisponível.", "NOT_FOUND", 404);
      if (!contactId) {
        const [primary] = await tx
          .select()
          .from(crmDealContacts)
          .where(
            and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, row.dealId)),
          )
          .orderBy(desc(crmDealContacts.isPrimary), crmDealContacts.createdAt)
          .limit(1);
        contactId = primary?.contactId || null;
      }
      const [contact] = contactId
        ? await tx
            .select()
            .from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
        : [];
      if (contact?.email) payload.email = contact.email.trim().toLowerCase();
      else if (contact?.phone && !payload.email) payload.phone = "+" + rdPhoneDigits(contact.phone);
      if (row.eventType === "SALE" && payload.value === null && deal.value !== null)
        payload.value = Number(deal.value);
      const [config] = await tx.select().from(settings).where(eq(settings.tenantId, tenantId));
      if (
        row.eventType === "SALE" &&
        (config?.currency !== row.snapshot.currency ||
          payload.value === null ||
          !Number.isFinite(Number(payload.value)) ||
          Number(payload.value) < 0)
      )
        throw new CrmError("Revise valor e moeda antes de tentar novamente.", "BAD_REQUEST", 400);
    }
    const reviews = Array.isArray(row.snapshot.reviews) ? row.snapshot.reviews : [];
    await tx
      .update(outbox)
      .set({
        status: outcome === "confirmed" ? "sent" : "pending",
        contactId,
        payload,
        sentAt: outcome === "confirmed" ? new Date() : null,
        nextRetryAt: new Date(),
        attempts: 0,
        leaseToken: null,
        leaseUntil: null,
        lastError: outcome === "confirmed" ? "Registro confirmado manualmente no RD." : null,
        snapshot: {
          ...row.snapshot,
          reviews: [...reviews.slice(-19), { operatorId, outcome, date: new Date().toISOString() }],
        },
      })
      .where(scope);
  });
}
