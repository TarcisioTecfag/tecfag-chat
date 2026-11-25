import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { webhookDeliveries, webhookSubscriptions } from "../../db/schema";
import { runtimeSingleton } from "../runtime-singleton";
import { signPayload } from "./crypto";

export const SUPPORTED_WEBHOOK_EVENTS = [
  "conversation.created",
  "message.received",
  "deal.created",
  "deal.updated",
  "deal.won",
  "deal.lost",
  "triage.mode_changed",
] as const;

export type SupportedWebhookEvent = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

export function maskWebhookSecret(secret: string): string {
  if (!secret || secret.length <= 10) return "••••••••";
  return `${secret.slice(0, 8)}••••${secret.slice(-4)}`;
}

export function validateWebhookEvents(raw: unknown): SupportedWebhookEvent[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `Informe 'events' com ao menos um evento suportado: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}.`,
    );
  }
  const allowed = new Set<string>(SUPPORTED_WEBHOOK_EVENTS);
  const unique = Array.from(
    new Set(raw.filter((v): v is string => typeof v === "string").map((v) => v.trim())),
  );
  const invalid = unique.filter((e) => !allowed.has(e));
  if (invalid.length > 0) {
    throw new Error(
      `Eventos não suportados: ${invalid.join(", ")}. Suportados: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}.`,
    );
  }
  return unique as SupportedWebhookEvent[];
}

export interface DealWebhookData {
  dealId: string;
  title: string;
  pipelineId: string;
  stageId: string;
  status: string;
  value?: string | number | null;
  operatorId?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  source?: string | null;
  campaign?: string | null;
  entryChannel?: string | null;
  sectorCurrent?: string | null;
  previousPipelineId?: string | null;
  previousStageId?: string | null;
  previousStatus?: string | null;
  previousOperatorId?: string | null;
  changedFields?: string[];
  lossReason?: string | null;
  winReason?: string | null;
  pausedReason?: string | null;
  actorOperatorId?: string | null;
  origin?: string;
  version?: number | null;
  updatedAt?: string;
}

/**
 * Emite eventos de ciclo de vida de negociações (`deal.created`, `deal.updated`, `deal.won`, `deal.lost`)
 * de forma não-bloqueante e isolada por tenant. Sempre chamar APÓS o commit da transação.
 */
export function dispatchDealWebhook(
  tenantId: string,
  event: "deal.created" | "deal.updated" | "deal.won" | "deal.lost",
  data: DealWebhookData,
  options?: { eventId?: string; awaitDelivery?: boolean },
): Promise<{ enqueued: number; eventId: string; results?: WebhookAttemptResult[] }> {
  const nowIso = new Date().toISOString();
  const payload: Record<string, unknown> = {
    dealId: data.dealId,
    title: data.title,
    pipelineId: data.pipelineId,
    stageId: data.stageId,
    status: data.status,
    value: data.value ?? null,
    operatorId: data.operatorId ?? null,
    accountId: data.accountId ?? null,
    ...(data.contactId !== undefined ? { contactId: data.contactId } : {}),
    ...(data.source !== undefined ? { source: data.source } : {}),
    ...(data.campaign !== undefined ? { campaign: data.campaign } : {}),
    ...(data.entryChannel !== undefined ? { entryChannel: data.entryChannel } : {}),
    ...(data.sectorCurrent !== undefined ? { sectorCurrent: data.sectorCurrent } : {}),
    ...(data.previousPipelineId !== undefined ? { previousPipelineId: data.previousPipelineId } : {}),
    ...(data.previousStageId !== undefined ? { previousStageId: data.previousStageId } : {}),
    ...(data.previousStatus !== undefined ? { previousStatus: data.previousStatus } : {}),
    ...(data.previousOperatorId !== undefined ? { previousOperatorId: data.previousOperatorId } : {}),
    ...(data.changedFields && data.changedFields.length > 0 ? { changedFields: data.changedFields } : {}),
    ...(data.lossReason !== undefined ? { lossReason: data.lossReason } : {}),
    ...(data.winReason !== undefined ? { winReason: data.winReason } : {}),
    ...(data.pausedReason !== undefined ? { pausedReason: data.pausedReason } : {}),
    ...(data.actorOperatorId !== undefined ? { actorOperatorId: data.actorOperatorId } : {}),
    ...(data.origin ? { origin: data.origin } : {}),
    ...(data.version !== undefined && data.version !== null ? { version: data.version } : {}),
    updatedAt: data.updatedAt || nowIso,
    timestamp: nowIso,
  };

  const versionPart = data.version !== undefined && data.version !== null ? `v${data.version}` : String(Date.now());
  const defaultEventId =
    event === "deal.created"
      ? `deal-created:${data.dealId}`
      : `${event.replace(".", "-")}:${data.dealId}:${versionPart}`;

  return dispatchWebhook(tenantId, event, payload, {
    eventId: options?.eventId || defaultEventId,
    awaitDelivery: options?.awaitDelivery,
  });
}

const RETRY_DELAYS_MS = [
  10_000, // 1ª retentativa: 10s
  60_000, // 2ª retentativa: 1 min
  5 * 60_000, // 3ª retentativa: 5 min
  15 * 60_000, // 4ª retentativa: 15 min
  60 * 60_000, // 5ª retentativa: 1 hora
];

const DELIVERY_TIMEOUT_MS = 10_000;
const webhookSchemaState = runtimeSingleton("WebhookSchemaState", () => ({
  subscriptionsPromise: null as Promise<void> | null,
  deliveriesPromise: null as Promise<void> | null,
}));

export function ensureWebhookSubscriptionsSchema(): Promise<void> {
  if (!webhookSchemaState.subscriptionsPromise) {
    webhookSchemaState.subscriptionsPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS webhook_subscriptions (
          id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
          tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name text NOT NULL,
          url text NOT NULL,
          secret text NOT NULL,
          events jsonb NOT NULL,
          is_active boolean NOT NULL DEFAULT true,
          created_at timestamp NOT NULL DEFAULT now()
        );
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant
          ON webhook_subscriptions (tenant_id);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant_active
          ON webhook_subscriptions (tenant_id, is_active);
      `);
    })().catch((err) => {
      webhookSchemaState.subscriptionsPromise = null;
      throw err;
    });
  }
  return webhookSchemaState.subscriptionsPromise;
}

export function ensureWebhookDeliveriesSchema(): Promise<void> {
  if (!webhookSchemaState.deliveriesPromise) {
    webhookSchemaState.deliveriesPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id text PRIMARY KEY,
          tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          subscription_id text NOT NULL,
          event_id text NOT NULL,
          event_type text NOT NULL,
          target_url text NOT NULL,
          payload jsonb NOT NULL,
          status text NOT NULL DEFAULT 'pending',
          attempts integer NOT NULL DEFAULT 0,
          max_attempts integer NOT NULL DEFAULT 6,
          last_status_code integer,
          last_error text,
          last_response_body text,
          next_retry_at timestamp,
          delivered_at timestamp,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        );
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_deliveries_sub_event_uniq
          ON webhook_deliveries (tenant_id, subscription_id, event_id);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status_retry
          ON webhook_deliveries (status, next_retry_at);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant_created
          ON webhook_deliveries (tenant_id, created_at DESC);
      `);
    })().catch((err) => {
      webhookSchemaState.deliveriesPromise = null;
      throw err;
    });
  }
  return webhookSchemaState.deliveriesPromise;
}

export function validateWebhookTargetUrl(
  rawUrl: string,
  options?: { allowLocalhostForTest?: boolean },
): string {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`URL de webhook inválida: '${trimmed}'.`);
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";

  if (options?.allowLocalhostForTest && isLoopback) {
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Protocolo inválido para URL de webhook.");
    }
    return parsed.toString();
  }

  if (parsed.protocol !== "https:") {
    throw new Error("URLs de webhook em produção devem usar protocolo HTTPS.");
  }

  if (
    isLoopback ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new Error("URL de webhook apontando para rede interna/privada não é permitida.");
  }

  return parsed.toString();
}

export interface WebhookAttemptResult {
  deliveryId: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  status: "delivered" | "retrying" | "failed";
  statusCode: number | null;
  attempts: number;
  nextRetryAt: string | null;
  error: string | null;
}

/**
 * Executa uma tentativa HTTP de entrega para um registro `webhook_deliveries`
 * já persistido, assinando com HMAC-SHA256 e agendando retry exponencial em caso de falha.
 */
export async function attemptWebhookDelivery(
  deliveryId: string,
  tenantId: string,
): Promise<WebhookAttemptResult | null> {
  await ensureWebhookSubscriptionsSchema();
  await ensureWebhookDeliveriesSchema();

  const [row] = await db
    .select({
      delivery: webhookDeliveries,
      secret: webhookSubscriptions.secret,
      subActive: webhookSubscriptions.isActive,
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookSubscriptions,
      and(
        sql`${webhookSubscriptions.id}::text = ${webhookDeliveries.subscriptionId}`,
        eq(webhookSubscriptions.tenantId, webhookDeliveries.tenantId),
      ),
    )
    .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.tenantId, tenantId)))
    .limit(1);

  if (!row) return null;
  const { delivery, secret } = row;
  const nextAttempt = delivery.attempts + 1;
  const now = new Date();
  const payload = delivery.payload;
  const signature = signPayload(payload, secret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let errorMsg: string | null = null;
  let ok = false;

  try {
    const res = await fetch(delivery.targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": delivery.eventType,
        "X-Webhook-Event-Id": delivery.eventId,
        "X-Webhook-Delivery-Id": delivery.id,
        "X-Webhook-Attempt": String(nextAttempt),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    statusCode = res.status;
    const rawText = await res.text().catch(() => "");
    responseBody = rawText ? rawText.slice(0, 1000) : null;
    if (res.ok) {
      ok = true;
    } else {
      errorMsg = `HTTP ${res.status}${responseBody ? `: ${responseBody.slice(0, 200)}` : ""}`;
    }
  } catch (err: any) {
    errorMsg =
      err?.name === "AbortError"
        ? `Timeout após ${DELIVERY_TIMEOUT_MS / 1000}s`
        : String(err?.message || err || "Erro de rede ao entregar webhook");
  } finally {
    clearTimeout(timer);
  }

  if (ok) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "delivered",
        attempts: nextAttempt,
        lastStatusCode: statusCode,
        lastError: null,
        lastResponseBody: responseBody,
        nextRetryAt: null,
        deliveredAt: now,
        updatedAt: now,
      })
      .where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.tenantId, tenantId)));

    return {
      deliveryId: delivery.id,
      subscriptionId: delivery.subscriptionId,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      status: "delivered",
      statusCode,
      attempts: nextAttempt,
      nextRetryAt: null,
      error: null,
    };
  }

  const exhausted = nextAttempt >= delivery.maxAttempts;
  const delayMs = RETRY_DELAYS_MS[Math.min(nextAttempt - 1, RETRY_DELAYS_MS.length - 1)];
  const nextRetryAt = exhausted ? null : new Date(now.getTime() + delayMs);
  const nextStatus: "retrying" | "failed" = exhausted ? "failed" : "retrying";

  await db
    .update(webhookDeliveries)
    .set({
      status: nextStatus,
      attempts: nextAttempt,
      lastStatusCode: statusCode,
      lastError: errorMsg,
      lastResponseBody: responseBody,
      nextRetryAt,
      updatedAt: now,
    })
    .where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.tenantId, tenantId)));

  return {
    deliveryId: delivery.id,
    subscriptionId: delivery.subscriptionId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    status: nextStatus,
    statusCode,
    attempts: nextAttempt,
    nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : null,
    error: errorMsg,
  };
}

/**
 * Enfileira e tenta entregar um evento para todas as subscrições ativas do tenant.
 * Persiste antes de tentar enviar (garantia contra perda se o receptor estiver fora do ar).
 */
export async function dispatchWebhook(
  tenantId: string,
  event: string,
  data: Record<string, unknown>,
  options?: { eventId?: string; awaitDelivery?: boolean },
): Promise<{ enqueued: number; eventId: string; results?: WebhookAttemptResult[] }> {
  await ensureWebhookSubscriptionsSchema();
  const eventId = options?.eventId?.trim() || `evt-${crypto.randomUUID()}`;

  const subscriptions = await db
    .select()
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.tenantId, tenantId),
        eq(webhookSubscriptions.isActive, true),
        sql`${webhookSubscriptions.events} ? ${event}`,
      ),
    );

  if (subscriptions.length === 0) {
    return { enqueued: 0, eventId };
  }

  await ensureWebhookDeliveriesSchema();
  const now = new Date();
  const payload: Record<string, unknown> = {
    event_id: eventId,
    event,
    tenant_id: tenantId,
    created_at: now.toISOString(),
    data,
    metadata: { source: "valem-tecfag-hub", version: "2.0" },
  };

  const createdDeliveryIds: string[] = [];
  for (const sub of subscriptions) {
    const deliveryId = `whd-${crypto.randomUUID()}`;
    const inserted = await db
      .insert(webhookDeliveries)
      .values({
        id: deliveryId,
        tenantId,
        subscriptionId: sub.id,
        eventId,
        eventType: event,
        targetUrl: sub.url,
        payload,
        status: "pending",
        attempts: 0,
        maxAttempts: 6,
        nextRetryAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });
    if (inserted[0]?.id) {
      createdDeliveryIds.push(inserted[0].id);
    }
  }

  if (options?.awaitDelivery) {
    const results: WebhookAttemptResult[] = [];
    for (const delId of createdDeliveryIds) {
      const r = await attemptWebhookDelivery(delId, tenantId);
      if (r) results.push(r);
    }
    return { enqueued: createdDeliveryIds.length, eventId, results };
  }

  for (const delId of createdDeliveryIds) {
    void attemptWebhookDelivery(delId, tenantId).catch((err) => {
      console.error(`[WebhookDispatcher] Erro assíncrono na entrega ${delId}:`, err);
    });
  }

  return { enqueued: createdDeliveryIds.length, eventId };
}

/**
 * Reenvia imediatamente uma entrega específica (pendente, retrying ou failed) dentro do tenant.
 */
export async function retryWebhookDelivery(
  tenantId: string,
  deliveryId: string,
): Promise<WebhookAttemptResult> {
  await ensureWebhookDeliveriesSchema();

  const [existing] = await db
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.tenantId, tenantId)))
    .limit(1);

  if (!existing) {
    throw new Error(`Entrega de webhook '${deliveryId}' não encontrada no tenant '${tenantId}'.`);
  }

  if (existing.attempts >= existing.maxAttempts) {
    await db
      .update(webhookDeliveries)
      .set({
        maxAttempts: existing.attempts + 1,
        status: "retrying",
        nextRetryAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.tenantId, tenantId)));
  }

  const res = await attemptWebhookDelivery(deliveryId, tenantId);
  if (!res) {
    throw new Error(`Subscrição associada à entrega '${deliveryId}' não encontrada.`);
  }
  return res;
}

/**
 * Processa entregas pendentes ou em retry cujo `next_retry_at <= now()`.
 */
export async function processDueWebhookDeliveries(limit: number = 30): Promise<number> {
  await ensureWebhookDeliveriesSchema();
  const now = new Date();
  const dueRows = await db
    .select({ id: webhookDeliveries.id, tenantId: webhookDeliveries.tenantId })
    .from(webhookDeliveries)
    .where(
      and(
        inArray(webhookDeliveries.status, ["pending", "retrying"]),
        or(lte(webhookDeliveries.nextRetryAt, now), sql`${webhookDeliveries.nextRetryAt} IS NULL`),
      ),
    )
    .orderBy(asc(webhookDeliveries.nextRetryAt), asc(webhookDeliveries.createdAt))
    .limit(limit);

  let processed = 0;
  for (const row of dueRows) {
    await attemptWebhookDelivery(row.id, row.tenantId);
    processed++;
  }
  return processed;
}

export async function listTenantWebhookDeliveries(
  tenantId: string,
  filters?: {
    subscriptionId?: string;
    eventType?: string;
    status?: string;
    limit?: number;
  },
) {
  await ensureWebhookDeliveriesSchema();
  const limit = Math.min(Math.max(Number(filters?.limit || 30), 1), 100);
  const conditions = [eq(webhookDeliveries.tenantId, tenantId)];
  if (filters?.subscriptionId) {
    conditions.push(eq(webhookDeliveries.subscriptionId, filters.subscriptionId));
  }
  if (filters?.eventType) {
    conditions.push(eq(webhookDeliveries.eventType, filters.eventType));
  }
  if (filters?.status) {
    conditions.push(eq(webhookDeliveries.status, filters.status));
  }

  return db
    .select()
    .from(webhookDeliveries)
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
}

class WebhookDeliveryWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(intervalMs: number = 15_000): void {
    if (this.timer) return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await processDueWebhookDeliveries(25);
      } catch (err) {
        console.error("[WebhookWorker] Falha no ciclo de retentativas:", err);
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const webhookDeliveryWorker = runtimeSingleton(
  "WebhookDeliveryWorker",
  () => new WebhookDeliveryWorker(),
);
