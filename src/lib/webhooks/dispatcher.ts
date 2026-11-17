import { db } from "@/db";
import { webhookSubscriptions } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { signPayload } from "./crypto";

export async function dispatchWebhook(tenantId: string, event: string, data: any) {
  // 1. Busca todas as subscrições ativas para este tenant e este evento
  const subscriptions = await db
    .select()
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.tenantId, tenantId),
        eq(webhookSubscriptions.isActive, true),
        sql`${event} = ANY(${webhookSubscriptions.events})`
      )
    );

  if (subscriptions.length === 0) return;

  const payload = {
    event,
    created_at: new Date().toISOString(),
    data,
    metadata: { source: "valem-tecfag-hub", version: "1.0" }
  };

  // 2. Dispara assincronamente (em produção idealmente usaria uma fila, ex: BullMQ)
  for (const sub of subscriptions) {
    const signature = signPayload(payload, sub.secret);
    
    // Dispara "fire-and-forget"
    fetch(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
      },
      body: JSON.stringify(payload),
    }).catch(err => {
      console.error(`Falha ao disparar webhook ${sub.id}:`, err);
      // Aqui entraria a lógica de retry
    });
  }
}
