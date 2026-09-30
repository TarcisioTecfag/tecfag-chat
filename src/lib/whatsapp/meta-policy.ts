import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { messages } from "../../db/schema";

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A janela da Meta reinicia somente com mensagem recebida do cliente no número da Meta. */
export async function getMetaServiceWindow(tenantId: string, conversationId: string, now = new Date()) {
  const [lastInbound] = await db
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(and(
      eq(messages.tenantId, tenantId),
      eq(messages.conversationId, conversationId),
      eq(messages.provider, "meta"),
      eq(messages.direction, "inbound"),
      eq(messages.senderType, "client")
    ))
    .orderBy(desc(messages.sentAt))
    .limit(1);

  const expiresAt = lastInbound ? new Date(lastInbound.sentAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS) : null;
  return {
    open: !!expiresAt && expiresAt.getTime() > now.getTime(),
    expiresAt: expiresAt?.toISOString() || null,
  };
}
