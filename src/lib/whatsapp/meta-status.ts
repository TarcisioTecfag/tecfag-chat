import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { messages, pendingInbounds } from "../../db/schema";

type MetaStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  pricing?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  recipient_id?: string;
  errors?: Array<{ message?: string }>;
};

const statusRank: Record<string, number> = { sending: 0, accepted: 1, delivered: 2, read: 3 };

export async function applyMetaStatus(tenantId: string, statusObj: MetaStatus, persistUnmatched = true): Promise<boolean> {
  if (!statusObj.id || !statusObj.status) return false;
  if (!["sent", "delivered", "read", "failed"].includes(statusObj.status)) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [existing] = await db.select({
      id: messages.id,
      status: messages.status,
      metaPricing: messages.metaPricing,
      metaStatusAt: messages.metaStatusAt,
    }).from(messages).where(and(
      eq(messages.tenantId, tenantId),
      eq(messages.provider, "meta"),
      eq(messages.direction, "outbound"),
      eq(messages.externalId, statusObj.id)
    ));

    if (!existing) {
    if (persistUnmatched) {
      const eventId = `meta:${tenantId}:status:${statusObj.id}:${statusObj.status}`;
      await db.insert(pendingInbounds).values({
        id: `inb_status_${crypto.createHash("sha256").update(eventId).digest("hex").slice(0, 24)}`,
        tenantId,
        provider: "meta",
        externalEventId: eventId,
        payload: { kind: "meta_status", statusObj },
        status: "pending",
        attempts: 0,
        createdAt: new Date(),
      }).onConflictDoNothing();
    }
      return false;
    }

    const receivedStatus = statusObj.status === "sent" ? "accepted" : statusObj.status;
    const nextStatus = receivedStatus === "failed"
      ? ((statusRank[existing.status] || 0) >= 2 ? existing.status : "failed")
      : existing.status === "failed" && receivedStatus === "accepted" ? "failed"
      : (statusRank[receivedStatus] || 0) >= (statusRank[existing.status] || 0)
        ? receivedStatus : existing.status;
    const statusAt = statusObj.timestamp && /^\d+$/.test(statusObj.timestamp)
      ? new Date(Number(statusObj.timestamp) * 1000) : new Date();
    const pricing = statusObj.pricing
      ? { ...statusObj.pricing, conversation: statusObj.conversation || null, recipientId: statusObj.recipient_id || null }
      : existing.metaPricing;

    const updated = await db.update(messages).set({
      status: nextStatus,
      metaPricing: pricing,
      metaStatusAt: nextStatus !== existing.status ? statusAt : existing.metaStatusAt,
      errorMessage: nextStatus === "failed" ? statusObj.errors?.[0]?.message || "Falha informada pela Meta" : null,
      updatedAt: new Date(),
    }).where(and(eq(messages.id, existing.id), eq(messages.tenantId, tenantId), eq(messages.status, existing.status)))
      .returning({ id: messages.id });
    if (updated.length > 0) return true;
  }
  throw new Error("Status Meta alterado simultaneamente; solicitar retentativa do webhook");
}

export async function replayPendingMetaStatuses(tenantId: string, externalId: string): Promise<void> {
  const rows = await db.select().from(pendingInbounds).where(and(
    eq(pendingInbounds.tenantId, tenantId),
    eq(pendingInbounds.provider, "meta"),
    eq(pendingInbounds.status, "pending")
  ));
  for (const row of rows) {
    const payload = row.payload as { kind?: string; statusObj?: MetaStatus };
    if (payload.kind !== "meta_status" || payload.statusObj?.id !== externalId) continue;
    if (await applyMetaStatus(tenantId, payload.statusObj, false)) {
      await db.update(pendingInbounds).set({ status: "processed", processedAt: new Date() })
        .where(and(eq(pendingInbounds.id, row.id), eq(pendingInbounds.tenantId, tenantId)));
    }
  }
}
