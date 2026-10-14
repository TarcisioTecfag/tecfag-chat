import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { rdMarketingEvents, rdMarketingFlows, rdMarketingLogs, tenants } from "../../db/schema";
import { CrmError } from "../crm/crm-service";
import { extractLeads } from "./mapping";
import { receiveLeads } from "./service";

type Flow = typeof rdMarketingFlows.$inferSelect;
type Event = typeof rdMarketingEvents.$inferSelect;
const leaseMs = 5 * 60_000;

/** A identidade não contém o segredo da URL. ACK significa payload preservado. */
export async function storeRdWebhook(flow: Flow, payload: unknown) {
  const id = createHash("sha256")
    .update(JSON.stringify([flow.tenantId, flow.id, payload]))
    .digest("hex");
  const [created] = await db
    .insert(rdMarketingEvents)
    .values({
      id,
      tenantId: flow.tenantId,
      flowId: flow.id,
      payload,
      settings: flow.settings,
    })
    .onConflictDoNothing()
    .returning({ id: rdMarketingEvents.id });
  return { eventId: id, status: "queued", duplicate: !created };
}

function due(now: Date) {
  return or(
    and(eq(rdMarketingEvents.status, "pending"), lte(rdMarketingEvents.nextRetryAt, now)),
    and(
      eq(rdMarketingEvents.status, "processing"),
      or(isNull(rdMarketingEvents.leaseUntil), lte(rdMarketingEvents.leaseUntil, now)),
    ),
  );
}

export async function claimRdEvent(tenantId: string, id: string, now = new Date()) {
  const [claimed] = await db
    .update(rdMarketingEvents)
    .set({
      status: "processing",
      leaseToken: randomUUID(),
      leaseUntil: new Date(now.getTime() + leaseMs),
      attempts: sql`${rdMarketingEvents.attempts} + 1`,
      updatedAt: now,
    })
    .where(and(eq(rdMarketingEvents.tenantId, tenantId), eq(rdMarketingEvents.id, id), due(now)))
    .returning();
  return claimed;
}

export async function processRdEvent(event: Event, receive = receiveLeads) {
  const owned = and(
    eq(rdMarketingEvents.tenantId, event.tenantId),
    eq(rdMarketingEvents.id, event.id),
    eq(rdMarketingEvents.leaseToken, event.leaseToken!),
  );
  const outcomes = [...event.outcomes];
  try {
    const [liveFlow] = await db
      .select()
      .from(rdMarketingFlows)
      .where(
        and(eq(rdMarketingFlows.tenantId, event.tenantId), eq(rdMarketingFlows.id, event.flowId)),
      );
    if (!liveFlow)
      throw new CrmError("Fluxo removido; evento preservado para revisão.", "FLOW_REMOVED", 400);
    if (!liveFlow.settings.enabled) {
      await db
        .update(rdMarketingEvents)
        .set({
          status: "pending",
          nextRetryAt: new Date(Date.now() + 60_000),
          leaseToken: null,
          leaseUntil: null,
        })
        .where(owned);
      return;
    }
    const leads = extractLeads(event.payload);
    for (const [index, lead] of leads.entries()) {
      if (outcomes.some((result) => result.index === index)) continue;
      const renewed = await db
        .update(rdMarketingEvents)
        .set({ leaseUntil: new Date(Date.now() + leaseMs) })
        .where(owned)
        .returning({ id: rdMarketingEvents.id });
      if (!renewed.length) return;
      try {
        // Card e recibo continuam atômicos; cada item é uma transação independente.
        const [result] = await receive(
          { ...liveFlow, settings: event.settings },
          { leads: [lead] },
        );
        outcomes.push({ index, status: result.status, dealId: result.dealId });
      } catch (error) {
        const known = error as { statusCode?: number; message?: string };
        if (!known.statusCode || known.statusCode >= 500 || known.statusCode === 409) throw error;
        outcomes.push({ index, status: "error", error: known.message || "Item inválido." });
      }
      await db.update(rdMarketingEvents).set({ outcomes, updatedAt: new Date() }).where(owned);
    }
    const failed = outcomes.filter((result) => result.status === "error");
    const reasons = failed
      .map((item) => item.error)
      .filter(Boolean)
      .join(" | ");
    await db
      .update(rdMarketingEvents)
      .set({
        status: failed.length ? "error" : "processed",
        outcomes,
        errorMessage: failed.length
          ? reasons || `${failed.length} item(ns) aguardando revisão.`
          : null,
        leaseToken: null,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(owned);
    if (failed.length)
      await db.insert(rdMarketingLogs).values({
        id: randomUUID(),
        tenantId: event.tenantId,
        flowId: event.flowId,
        status: "error",
        message: `Evento ${event.id.slice(0, 12)}: ${failed.length} item(ns) preservado(s) para reprocessamento.${reasons ? ` Motivo: ${reasons}` : ""}`,
      });
  } catch (error) {
    const known = error as { statusCode?: number; message?: string };
    const permanent = Boolean(
      known.statusCode && known.statusCode < 500 && known.statusCode !== 409,
    );
    await db
      .update(rdMarketingEvents)
      .set({
        status: permanent ? "error" : "pending",
        outcomes,
        errorMessage: permanent
          ? known.message || "Evento inválido."
          : "Falha temporária; nova tentativa programada.",
        nextRetryAt: new Date(
          Date.now() + Math.min(30_000 * 2 ** Math.min(event.attempts, 6), 30 * 60_000),
        ),
        leaseToken: null,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(owned);
    if (permanent) {
      await db.insert(rdMarketingLogs).values({
        id: randomUUID(),
        tenantId: event.tenantId,
        flowId: event.flowId,
        status: "error",
        message: `Evento ${event.id.slice(0, 12)}: ${known.message || "Evento inválido."}`,
      });
    }
  }
}

let running = false;
export async function runRdMarketingRecovery() {
  if (running) return;
  running = true;
  try {
    const companies = await db.select({ id: tenants.id }).from(tenants);
    for (const { id: tenantId } of companies) {
      const rows = await db
        .select({ id: rdMarketingEvents.id })
        .from(rdMarketingEvents)
        .where(and(eq(rdMarketingEvents.tenantId, tenantId), due(new Date())))
        .orderBy(asc(rdMarketingEvents.createdAt))
        .limit(10);
      for (const row of rows) {
        const claimed = await claimRdEvent(tenantId, row.id);
        if (claimed) await processRdEvent(claimed);
      }
    }
  } finally {
    running = false;
  }
}

export async function listRdEvents(tenantId: string) {
  return db
    .select({
      id: rdMarketingEvents.id,
      flowId: rdMarketingEvents.flowId,
      status: rdMarketingEvents.status,
      outcomes: rdMarketingEvents.outcomes,
      attempts: rdMarketingEvents.attempts,
      errorMessage: rdMarketingEvents.errorMessage,
      createdAt: rdMarketingEvents.createdAt,
      nextRetryAt: rdMarketingEvents.nextRetryAt,
    })
    .from(rdMarketingEvents)
    .where(eq(rdMarketingEvents.tenantId, tenantId))
    .orderBy(sql`${rdMarketingEvents.createdAt} DESC`)
    .limit(50);
}

export async function replayRdEvent(
  tenantId: string,
  id: string,
  operatorId: string,
  useCurrentSettings = false,
) {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(rdMarketingEvents)
      .where(and(eq(rdMarketingEvents.tenantId, tenantId), eq(rdMarketingEvents.id, id)))
      .for("update");
    if (!event) throw new CrmError("Evento não encontrado.", "NOT_FOUND", 404);
    if (!["error", "pending"].includes(event.status))
      throw new CrmError("Evento concluído ou em processamento.", "CONFLICT", 409);
    const [flow] = await tx
      .select()
      .from(rdMarketingFlows)
      .where(and(eq(rdMarketingFlows.tenantId, tenantId), eq(rdMarketingFlows.id, event.flowId)));
    if (!flow?.settings.enabled)
      throw new CrmError("Ative o fluxo antes de reprocessar.", "FLOW_DISABLED", 409);
    await tx
      .update(rdMarketingEvents)
      .set({
        status: "pending",
        outcomes: event.outcomes.filter((result) => result.status !== "error"),
        settings: useCurrentSettings ? flow.settings : event.settings,
        nextRetryAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(and(eq(rdMarketingEvents.tenantId, tenantId), eq(rdMarketingEvents.id, id)));
    await tx.insert(rdMarketingLogs).values({
      id: randomUUID(),
      tenantId,
      flowId: event.flowId,
      status: "queued",
      message: `Reprocessamento solicitado por ${operatorId}: ${id.slice(0, 12)}.`,
    });
    return { eventId: id, status: "queued" };
  });
}
