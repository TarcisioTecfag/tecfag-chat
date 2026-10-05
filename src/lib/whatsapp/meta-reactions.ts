import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { messages } from "../../db/schema";
import { SessionManager } from "../baileys/session-manager";

export interface MessageReaction {
  emoji: string;
  /** Quem reagiu. Hoje apenas "client" (reação do cliente vinda do webhook). */
  from: "client";
  at: string;
}

/**
 * Reações ficam em `messages.metaDetails.reactions` (jsonb já existente), indexadas por autor.
 * Não exige migração de schema e acompanha a mensagem-alvo.
 */
export function readReactions(metaDetails: unknown): MessageReaction[] {
  const raw = (metaDetails as { reactions?: Record<string, { emoji?: string; at?: string }> } | null)?.reactions;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw)
    .filter(([, value]) => typeof value?.emoji === "string" && value.emoji.length > 0)
    .map(([from, value]) => ({ emoji: value.emoji as string, from: from as "client", at: value.at || "" }));
}

/**
 * Aplica (ou remove, se `emoji` vier vazio) a reação do cliente sobre a mensagem identificada
 * pelo wamid. Sempre filtrado por tenant. Retorna `false` se a mensagem-alvo não existe.
 */
export async function applyMetaReaction(
  tenantId: string,
  input: { targetWamid: string; emoji: string | null | undefined; timestamp: Date }
): Promise<boolean> {
  const { targetWamid, emoji, timestamp } = input;
  if (!targetWamid) return false;

  // Mensagens enviadas guardam o wamid puro; as recebidas guardam `meta:<tenant>:<wamid>`.
  const [target] = await db
    .select({ id: messages.id, conversationId: messages.conversationId, metaDetails: messages.metaDetails })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        inArray(messages.externalId, [targetWamid, `meta:${tenantId}:${targetWamid}`])
      )
    )
    .limit(1);

  if (!target) {
    console.warn(`[Meta Reaction] Mensagem-alvo '${targetWamid}' não encontrada no tenant '${tenantId}'.`);
    return false;
  }

  const details = { ...((target.metaDetails as Record<string, unknown>) || {}) };
  const reactions = { ...((details.reactions as Record<string, unknown>) || {}) };

  if (emoji) {
    reactions.client = { emoji, at: timestamp.toISOString() };
  } else {
    delete reactions.client; // emoji vazio = cliente removeu a reação
  }
  details.reactions = reactions;

  await db
    .update(messages)
    .set({ metaDetails: details })
    .where(and(eq(messages.id, target.id), eq(messages.tenantId, tenantId)));

  SessionManager.getInstance().notifyPublic(tenantId, {
    type: "message_reaction",
    conversationId: target.conversationId,
    messageId: target.id,
    reactions: readReactions(details),
  });

  return true;
}
