import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { messages } from "../../db/schema";
import { metaAdapter } from "./adapters/meta";

/**
 * Presença oficial da Meta Cloud API, no sentido EMPRESA → CLIENTE:
 *  - "read":   cliente vê ✓✓ azul nas mensagens dele (confirmação de leitura).
 *  - "typing": cliente vê "digitando..." no WhatsApp por até 25s (a Meta marca como lida junto).
 *
 * Limites da plataforma (não contornáveis pela API oficial):
 *  - não existe webhook de "cliente digitando/gravando";
 *  - não existe indicador de "gravando áudio" no sentido empresa → cliente.
 *
 * Reutilizável por qualquer módulo (operador humano hoje; IA quando responder pelo canal Meta).
 */

export type MetaPresenceAction = "read" | "typing";

/** A Meta encerra o indicador em 25s; renovamos com folga, sem martelar a API a cada tecla. */
const TYPING_REFRESH_MS = 20_000;
const MAX_TRACKED = 5_000;

const lastReadWamid = new Map<string, string>();
const lastTypingAt = new Map<string, number>();

function remember<T>(map: Map<string, T>, key: string, value: T) {
  if (map.size >= MAX_TRACKED) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.delete(key);
  map.set(key, value);
}

/** Último wamid recebido do cliente nesta conversa (inbound gravado como `meta:<tenant>:<wamid>`). */
export async function findLastInboundWamid(tenantId: string, conversationId: string): Promise<string | null> {
  const [last] = await db
    .select({ externalId: messages.externalId })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "inbound"),
        eq(messages.provider, "meta")
      )
    )
    .orderBy(desc(messages.sentAt))
    .limit(1);

  const prefix = `meta:${tenantId}:`;
  const externalId = last?.externalId;
  if (!externalId || !externalId.startsWith(prefix)) return null;
  const wamid = externalId.slice(prefix.length);
  return wamid || null;
}

export async function sendMetaConversationPresence(
  tenantId: string,
  conversationId: string,
  action: MetaPresenceAction
): Promise<{ sent: boolean; reason?: string }> {
  const key = `${tenantId}:${conversationId}`;

  if (action === "typing") {
    const last = lastTypingAt.get(key) || 0;
    if (Date.now() - last < TYPING_REFRESH_MS) return { sent: false, reason: "throttled" };
  }

  const wamid = await findLastInboundWamid(tenantId, conversationId);
  if (!wamid) return { sent: false, reason: "no_inbound" };

  // "lido" é idempotente: só chama a Meta quando chega mensagem nova do cliente.
  if (action === "read" && lastReadWamid.get(key) === wamid) return { sent: false, reason: "already_read" };

  if (action === "typing") remember(lastTypingAt, key, Date.now());

  const result = await metaAdapter.markInboundRead(tenantId, wamid, action === "typing");
  if (!result.ok) {
    if (action === "typing") lastTypingAt.delete(key);
    console.warn(`[MetaPresence] Falha em '${action}' (tenant: ${tenantId}, conversa: ${conversationId}): ${result.error}`);
    return { sent: false, reason: result.error };
  }

  // Typing também marca como lida na Meta.
  remember(lastReadWamid, key, wamid);
  return { sent: true };
}

/** Ao enviar mensagem, o "digitando" some na Meta; permite reativá-lo logo na próxima digitação. */
export function resetMetaTypingThrottle(tenantId: string, conversationId: string) {
  lastTypingAt.delete(`${tenantId}:${conversationId}`);
}
