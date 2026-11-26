/**
 * Espelhamento em tempo real (idempotente) de mensagens do chat do Site (`conv-lc-*`)
 * para dentro da conversa oficial de WhatsApp do mesmo contato/tenant.
 *
 * Regras:
 * - Isolamento estrito por `tenantId` (nunca mistura tenants; `valem` nunca passa por aqui).
 * - Usa o MESMO padrão de ID determinístico `lcx-${sha256(waConvId:siteMsgId)}` e
 *   `metaDetails.copiedFrom` que `site-whatsapp-handoff.ts` e `site-continuity-store.ts`,
 *   garantindo 0 duplicações mesmo se depois ocorrer ponte/encerramento definitivo.
 * - Mensagens espelhadas preservam `provider: "livechat"` para que:
 *   (a) a UI renderize automaticamente o selo `Via Site` + divisórias de canal;
 *   (b) `getMetaServiceWindow` NUNCA confunda mensagem do site com abertura da janela Meta 24h.
 */
import crypto from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { contacts, conversations, lcChats, messages } from "../../db/schema";
import type { IndustrialDatabase, IndustrialTransaction } from "../triage/industrial-rodizio-store";
import { SessionManager } from "../baileys/session-manager";
import {
  SITE_CHANNEL,
  isSiteConversationId,
  visitorIdFromSiteConversation,
} from "./site-channel-policy";
import { siteContextFromMessages } from "./site-context";
import { readSiteContinuationHistory } from "./site-conversation-store";

const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export interface SiteMirrorSourceMessage {
  id: string;
  senderType: string;
  senderName: string;
  content: string;
  mediaInterpretation?: string | null;
  provider?: string | null;
  direction: string;
  status: string;
  metaDetails?: unknown;
  sentAt: Date | string;
}

export function buildMirroredSiteMessageId(
  waConversationId: string,
  siteMessageId: string,
): string {
  return `lcx-${sha256Hex(`${waConversationId}:${siteMessageId}`).slice(0, 40)}`;
}

export function buildMirroredSiteMessageRow(params: {
  tenantId: string;
  waConversationId: string;
  siteConversationId: string;
  source: SiteMirrorSourceMessage;
  now?: Date;
}): typeof messages.$inferInsert {
  const now = params.now || new Date();
  const m = params.source;
  const sentAtDate = m.sentAt instanceof Date ? m.sentAt : new Date(m.sentAt);
  const extractedSiteCtx = siteContextFromMessages([m as { metaDetails?: unknown }]);
  return {
    id: buildMirroredSiteMessageId(params.waConversationId, m.id),
    tenantId: params.tenantId,
    conversationId: params.waConversationId,
    senderType: m.senderType,
    senderName: m.senderName,
    content: m.content,
    isInternalNote: false,
    mediaInterpretation: m.mediaInterpretation ?? null,
    provider: SITE_CHANNEL,
    direction: m.direction,
    status: m.status === "pending" || m.status === "sending" ? "accepted" : m.status,
    metaDetails: {
      ...(extractedSiteCtx ? { siteContext: extractedSiteCtx } : {}),
      copiedFrom: {
        channel: SITE_CHANNEL,
        conversationId: params.siteConversationId,
        messageId: m.id,
      },
    },
    sentAt: Number.isFinite(sentAtDate.getTime()) ? sentAtDate : now,
    updatedAt: now,
  };
}

export interface MirrorSiteToWhatsappInput {
  tenantId: string;
  siteConversationId: string;
  waConversationId: string;
  /** Quando omitido, lê automaticamente o histórico completo da conversa do site. */
  sourceMessages?: readonly SiteMirrorSourceMessage[];
  /** Nota interna opcional registrada na conversa do WhatsApp (ex.: recado para consultor). */
  internalNote?: {
    idempotencyKey: string;
    senderName: string;
    content: string;
  } | null;
  /** Quando true e a conversa do WhatsApp está em `meus` com operador humano, incrementa unreadCount. */
  bumpUnreadForHuman?: boolean;
  /** Quando true, fecha `lc_chats` como `bridge_sent`; quando false, apenas vincula `waConversationId`. */
  closeLivechatRecord?: boolean;
  /** Notifica SSE (`SessionManager.notifyPublic`) para cada mensagem inserida. Default: true. */
  notifyRealtime?: boolean;
}

export interface MirrorSiteToWhatsappResult {
  mirroredCount: number;
  noteInserted: boolean;
  insertedIds: string[];
}

export async function mirrorSiteMessagesToWhatsappInTx(
  tx: IndustrialDatabase | IndustrialTransaction,
  input: MirrorSiteToWhatsappInput,
): Promise<{
  insertedMessages: Array<typeof messages.$inferSelect>;
  insertedNote: typeof messages.$inferSelect | null;
  waConvMeta: { queueState: string | null; operatorId: string | null; unreadCount: number } | null;
}> {
  const { tenantId, siteConversationId, waConversationId } = input;
  if (!isSiteConversationId(siteConversationId) || isSiteConversationId(waConversationId)) {
    return { insertedMessages: [], insertedNote: null, waConvMeta: null };
  }

  const [waConv] = await tx
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      queueState: conversations.queueState,
      operatorId: conversations.operatorId,
      unreadCount: conversations.unreadCount,
    })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, waConversationId)))
    .limit(1);

  if (!waConv) {
    return { insertedMessages: [], insertedNote: null, waConvMeta: null };
  }

  const now = new Date();
  const sourceMsgs =
    input.sourceMessages && input.sourceMessages.length > 0
      ? input.sourceMessages
      : await readSiteContinuationHistory(tx, tenantId, siteConversationId);

  const rowsToInsert = sourceMsgs
    .filter((m) => Boolean(m?.id) && typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) =>
      buildMirroredSiteMessageRow({
        tenantId,
        waConversationId,
        siteConversationId,
        source: m,
        now,
      }),
    );

  let insertedMessages: Array<typeof messages.$inferSelect> = [];
  if (rowsToInsert.length > 0) {
    insertedMessages = await tx
      .insert(messages)
      .values(rowsToInsert)
      .onConflictDoNothing()
      .returning();
  }

  let insertedNote: typeof messages.$inferSelect | null = null;
  if (input.internalNote && input.internalNote.content.trim()) {
    const noteId = `note-sxch-${sha256Hex(`${tenantId}:${waConversationId}:${input.internalNote.idempotencyKey}`).slice(0, 32)}`;
    const [noteRow] = await tx
      .insert(messages)
      .values({
        id: noteId,
        tenantId,
        conversationId: waConversationId,
        senderType: "system",
        senderName: input.internalNote.senderName,
        content: input.internalNote.content.trim(),
        isInternalNote: true,
        provider: "internal",
        direction: "outbound",
        status: "delivered",
        sentAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    insertedNote = noteRow || null;
  }

  // Vincular jornada do site ao contato e `lc_chats.wa_conversation_id`
  const visitorId = visitorIdFromSiteConversation(siteConversationId);
  if (visitorId) {
    if (waConv.contactId) {
      const [contactRow] = await tx
        .select({
          id: contacts.id,
          customFields: contacts.customFields,
        })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, waConv.contactId)))
        .limit(1);
      if (contactRow) {
        const existingCf = (contactRow.customFields as Record<string, unknown>) || {};
        const prevLinked = Array.isArray(existingCf.linkedSiteContactIds)
          ? existingCf.linkedSiteContactIds.filter((x): x is string => typeof x === "string")
          : [];
        const siteContactRef = `cont-lc-${visitorId}`;
        if (existingCf.siteVisitorId !== visitorId || !prevLinked.includes(siteContactRef)) {
          const nextLinked = Array.from(new Set([...prevLinked, siteContactRef])).slice(-20);
          await tx
            .update(contacts)
            .set({
              customFields: {
                ...existingCf,
                siteVisitorId: visitorId,
                linkedSiteContactIds: nextLinked,
              },
            })
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactRow.id)));
        }
      }
    }

    await tx
      .update(lcChats)
      .set(
        input.closeLivechatRecord
          ? {
              waConversationId,
              status: "bridge_sent",
              outcome: "bridge_whatsapp",
              closedAt: now,
            }
          : {
              waConversationId,
            },
      )
      .where(
        and(
          eq(lcChats.tenantId, tenantId),
          eq(lcChats.visitorId, visitorId),
          ...(input.closeLivechatRecord
            ? [inArray(lcChats.status, ["active", "operator_took_over", "bridge_sent"])]
            : []),
        ),
      );
  }

  // Atualizar preview/unread na conversa do WhatsApp quando houver novos espelhos de cliente
  const hasNewClientMirror = insertedMessages.some((m) => m.senderType === "client");
  let nextUnread = waConv.unreadCount || 0;
  if (insertedMessages.length > 0 || insertedNote) {
    const latestExternal = [...insertedMessages]
      .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
      .at(-1);
    const shouldBumpUnread =
      Boolean(input.bumpUnreadForHuman) &&
      waConv.queueState === "meus" &&
      Boolean(waConv.operatorId) &&
      (hasNewClientMirror || Boolean(insertedNote));
    if (shouldBumpUnread) {
      nextUnread += 1;
    }
    await tx
      .update(conversations)
      .set({
        ...(latestExternal
          ? {
              lastMessageText: `🌐 ${String(latestExternal.content || "").slice(0, 95)}`,
              lastMessageTime: latestExternal.sentAt,
            }
          : {}),
        ...(shouldBumpUnread ? { unreadCount: sql`${conversations.unreadCount} + 1` } : {}),
        updatedAt: now,
      })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, waConversationId)));
  }

  return {
    insertedMessages,
    insertedNote,
    waConvMeta: {
      queueState: waConv.queueState,
      operatorId: waConv.operatorId,
      unreadCount: nextUnread,
    },
  };
}

export async function mirrorSiteMessagesToWhatsapp(
  database: IndustrialDatabase,
  input: MirrorSiteToWhatsappInput,
): Promise<MirrorSiteToWhatsappResult> {
  const txRes = await mirrorSiteMessagesToWhatsappInTx(database, input);

  if (input.notifyRealtime !== false && txRes.waConvMeta) {
    try {
      const sm = SessionManager.getInstance();
      for (const msg of txRes.insertedMessages) {
        sm.notifyPublic(input.tenantId, {
          type: "message",
          message: {
            ...msg,
            queue: txRes.waConvMeta.queueState,
            operatorId: txRes.waConvMeta.operatorId,
          },
        });
      }
      if (txRes.insertedNote) {
        sm.notifyPublic(input.tenantId, {
          type: "message",
          message: {
            ...txRes.insertedNote,
            queue: txRes.waConvMeta.queueState,
            operatorId: txRes.waConvMeta.operatorId,
          },
        });
      }
    } catch {
      // Falha silenciosa em SSE nunca bloqueia persistência
    }
  }

  return {
    mirroredCount: txRes.insertedMessages.length,
    noteInserted: Boolean(txRes.insertedNote),
    insertedIds: txRes.insertedMessages.map((m) => m.id),
  };
}
