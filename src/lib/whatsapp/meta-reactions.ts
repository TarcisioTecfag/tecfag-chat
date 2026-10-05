import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { messages } from "../../db/schema";
import { SessionManager } from "../baileys/session-manager";

export interface MessageReaction {
  emoji: string;
  /** Quem reagiu: "client" (cliente via WhatsApp) ou "operator" (atendente). */
  from: "client" | "operator";
  at: string;
  operatorId?: string;
  operatorName?: string;
}

/**
 * Reações ficam em `messages.metaDetails.reactions` (jsonb já existente), indexadas por autor.
 * Não exige migração de schema e acompanha a mensagem-alvo.
 */
export function readReactions(metaDetails: unknown): MessageReaction[] {
  const raw = (metaDetails as { reactions?: Record<string, { emoji?: string; at?: string; operatorId?: string; operatorName?: string }> } | null)?.reactions;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw)
    .filter(([, value]) => typeof value?.emoji === "string" && value.emoji.length > 0)
    .map(([from, value]) => ({
      emoji: value.emoji as string,
      from: (from === "operator" ? "operator" : "client") as "client" | "operator",
      at: value.at || "",
      operatorId: value.operatorId,
      operatorName: value.operatorName,
    }));
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

  const cleanEmoji = emoji?.trim() || "";
  if (cleanEmoji) {
    reactions.client = { emoji: cleanEmoji, at: timestamp.toISOString() };
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

/**
 * Aplica (ou remove, se `emoji` vier vazio) a reação do operador sobre a mensagem.
 * Atualiza `messages.metaDetails.reactions.operator` e emite SSE `message_reaction`.
 */
export async function applyOperatorReaction(
  tenantId: string,
  input: {
    messageId: string;
    emoji: string | null | undefined;
    operatorId: string;
    operatorName?: string;
  }
): Promise<{ success: boolean; reactions: MessageReaction[]; conversationId?: string; externalId?: string; error?: string }> {
  const { messageId, emoji, operatorId, operatorName } = input;

  const [target] = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      externalId: messages.externalId,
      metaDetails: messages.metaDetails,
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId)))
    .limit(1);

  if (!target) {
    return { success: false, reactions: [], error: "Mensagem não encontrada." };
  }

  const details = { ...((target.metaDetails as Record<string, unknown>) || {}) };
  const reactions = { ...((details.reactions as Record<string, unknown>) || {}) };

  const cleanEmoji = emoji?.trim() || "";

  if (cleanEmoji) {
    reactions.operator = {
      emoji: cleanEmoji,
      at: new Date().toISOString(),
      operatorId,
      operatorName: operatorName || "Operador",
    };
  } else {
    delete reactions.operator; // remove reação do operador
  }
  details.reactions = reactions;

  await db
    .update(messages)
    .set({ metaDetails: details })
    .where(and(eq(messages.id, target.id), eq(messages.tenantId, tenantId)));

  const updatedReactions = readReactions(details);

  SessionManager.getInstance().notifyPublic(tenantId, {
    type: "message_reaction",
    conversationId: target.conversationId,
    messageId: target.id,
    reactions: updatedReactions,
  });

  return {
    success: true,
    reactions: updatedReactions,
    conversationId: target.conversationId,
    externalId: target.externalId || undefined,
  };
}

