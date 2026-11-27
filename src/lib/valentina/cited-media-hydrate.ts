import { and, eq, inArray, like, or } from "drizzle-orm";
import { mediaFiles, messages } from "../../db/schema";
import {
  extractLegacyMediaRefFromPreview,
  normalizeCitedMessageMedia,
  parseCitedMessageMedia,
  type CitedMessageMedia,
} from "./cited-media";

interface MediaLookupRecord {
  id: string;
  conversationId: string | null;
  fileName: string | null;
  mimeType: string | null;
}

interface MessageLookupRecord {
  id: string;
  conversationId: string;
  content: string | null;
  mediaInterpretation: string | null;
}

interface TargetRef {
  rowId: string;
  rowIndex: number;
  kind: "warning" | "conversation_item";
  listKey?: "conversations" | "relatedConversations";
  itemIndex?: number;
  conversationId: string | null;
  rawPreview: string;
  mediaId: string;
  existingMedia: CitedMessageMedia | null;
}

interface DrizzleSelectLike {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<unknown[]>;
    };
  };
}

type JsonRecord = Record<string, unknown>;

function parseMetaObject(rawMeta: unknown): JsonRecord {
  if (!rawMeta) return {};
  if (typeof rawMeta === "string") {
    try {
      const parsed = JSON.parse(rawMeta);
      return parsed && typeof parsed === "object" ? (parsed as JsonRecord) : {};
    } catch {
      return {};
    }
  }
  return typeof rawMeta === "object" ? { ...(rawMeta as JsonRecord) } : {};
}

function findMatchingMessage(
  mediaId: string,
  conversationId: string | null,
  msgList: MessageLookupRecord[],
): MessageLookupRecord | null {
  if (!msgList.length) return null;
  if (conversationId) {
    const exactInConv = msgList.find(
      (m) =>
        m.conversationId === conversationId &&
        (m.id === mediaId || (m.content || "").includes(mediaId)),
    );
    if (exactInConv) return exactInConv;
  }
  return msgList.find((m) => m.id === mediaId || (m.content || "").includes(mediaId)) || null;
}

/**
 * Hidrata em lote (máx. 2 queries isoladas por `tenantId`) citações de mídia em
 * `internal_messages` — tanto alertas legados salvos como `"[Mídia recebida] med_..."`
 * quanto itens em `conversations` / `relatedConversations` ou áudios que ganharam
 * `mediaInterpretation` posteriormente.
 */
export async function hydrateCitedMediaForInternalRows<
  T extends { id: string; metadata: unknown },
>(params: {
  db: DrizzleSelectLike;
  tenantId: string;
  rows: T[];
}): Promise<Array<{ id: string; metadata: JsonRecord }>> {
  const { db, tenantId, rows } = params;
  if (!tenantId || !Array.isArray(rows) || rows.length === 0) return [];

  const targets: TargetRef[] = [];
  const mediaIdsSet = new Set<string>();
  const convIdsSet = new Set<string>();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const meta = parseMetaObject(row.metadata);

    const existingTopMedia = normalizeCitedMessageMedia(meta.lastMessageMedia);
    const topConvId =
      (typeof meta.conversationId === "string" && meta.conversationId.trim()) ||
      (typeof meta.clientId === "string" && meta.clientId.trim()) ||
      null;

    if (typeof meta.lastMessage === "string" && meta.lastMessage.trim()) {
      const ref = extractLegacyMediaRefFromPreview(meta.lastMessage);
      const needsTopHydration =
        (!existingTopMedia && Boolean(ref)) ||
        Boolean(
          existingTopMedia &&
          existingTopMedia.mediaId &&
          (ref ||
            (existingTopMedia.type === "audio" && !existingTopMedia.transcription) ||
            (existingTopMedia.type === "document" && !existingTopMedia.fileName)),
        );

      const resolvedMediaId = existingTopMedia?.mediaId || ref?.mediaId || null;
      if (needsTopHydration && resolvedMediaId) {
        targets.push({
          rowId: row.id,
          rowIndex,
          kind: "warning",
          conversationId: topConvId,
          rawPreview: meta.lastMessage,
          mediaId: resolvedMediaId,
          existingMedia: existingTopMedia,
        });
        mediaIdsSet.add(resolvedMediaId);
        if (topConvId) convIdsSet.add(topConvId);
      }
    }

    for (const listKey of ["conversations", "relatedConversations"] as const) {
      const list = Array.isArray(meta[listKey]) ? meta[listKey] : null;
      if (!list || list.length === 0) continue;

      for (let itemIndex = 0; itemIndex < list.length; itemIndex++) {
        const rawItem = list[itemIndex];
        if (!rawItem || typeof rawItem !== "object") continue;
        const item = rawItem as JsonRecord;
        const itemLastMsg = typeof item.lastMessage === "string" ? item.lastMessage.trim() : "";
        const existingItemMedia = normalizeCitedMessageMedia(item.lastMessageMedia);
        const ref = itemLastMsg ? extractLegacyMediaRefFromPreview(itemLastMsg) : null;
        const resolvedMediaId = existingItemMedia?.mediaId || ref?.mediaId || null;

        const needsItemHydration =
          (!existingItemMedia && Boolean(ref)) ||
          Boolean(
            existingItemMedia &&
            existingItemMedia.mediaId &&
            (ref ||
              (existingItemMedia.type === "audio" && !existingItemMedia.transcription) ||
              (existingItemMedia.type === "document" && !existingItemMedia.fileName)),
          );

        if (needsItemHydration && resolvedMediaId) {
          const itemConvId = (typeof item.clientId === "string" && item.clientId.trim()) || null;
          targets.push({
            rowId: row.id,
            rowIndex,
            kind: "conversation_item",
            listKey,
            itemIndex,
            conversationId: itemConvId,
            rawPreview: itemLastMsg,
            mediaId: resolvedMediaId,
            existingMedia: existingItemMedia,
          });
          mediaIdsSet.add(resolvedMediaId);
          if (itemConvId) convIdsSet.add(itemConvId);
        }
      }
    }
  }

  if (targets.length === 0 || mediaIdsSet.size === 0) return [];

  // Limite defensivo para manter o IN / OR sempre leve
  const mediaIds = Array.from(mediaIdsSet).slice(0, 60);
  const mediaById = new Map<string, MediaLookupRecord>();

  try {
    const mediaRows = (await db
      .select({
        id: mediaFiles.id,
        conversationId: mediaFiles.conversationId,
        fileName: mediaFiles.fileName,
        mimeType: mediaFiles.mimeType,
      })
      .from(mediaFiles)
      .where(
        and(eq(mediaFiles.tenantId, tenantId), inArray(mediaFiles.id, mediaIds)),
      )) as MediaLookupRecord[];

    for (const mr of mediaRows || []) {
      if (!mr?.id) continue;
      mediaById.set(mr.id, mr);
      if (mr.conversationId) convIdsSet.add(mr.conversationId);
    }
  } catch (err) {
    console.warn("[cited-media-hydrate] Falha ao consultar media_files:", err);
  }

  const matchedMessages: MessageLookupRecord[] = [];
  const convIds = Array.from(convIdsSet).slice(0, 80);

  if (convIds.length > 0 && mediaIds.length > 0) {
    try {
      const contentMatchers = mediaIds
        .slice(0, 40)
        .map((mid) => like(messages.content, `%${mid}%`));
      const msgRows = (await db
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          content: messages.content,
          mediaInterpretation: messages.mediaInterpretation,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            inArray(messages.conversationId, convIds),
            or(inArray(messages.id, mediaIds), ...contentMatchers),
          ),
        )) as MessageLookupRecord[];

      if (Array.isArray(msgRows)) {
        matchedMessages.push(...msgRows);
      }
    } catch (err) {
      console.warn("[cited-media-hydrate] Falha ao consultar messages:", err);
    }
  }

  const repairedByRowId = new Map<string, { rowIndex: number; metadata: JsonRecord }>();

  const getMutableMeta = (rowId: string, rowIndex: number): JsonRecord => {
    const existing = repairedByRowId.get(rowId);
    if (existing) return existing.metadata;
    const cloned = parseMetaObject(rows[rowIndex].metadata);
    repairedByRowId.set(rowId, { rowIndex, metadata: cloned });
    return cloned;
  };

  for (const target of targets) {
    const mediaRec = mediaById.get(target.mediaId) || null;
    const resolvedConvId = target.conversationId || mediaRec?.conversationId || null;
    const msgRec = findMatchingMessage(target.mediaId, resolvedConvId, matchedMessages);

    const sourceContent =
      msgRec?.content && msgRec.content.trim().length > 0 ? msgRec.content : target.rawPreview;

    const parsed = parseCitedMessageMedia(sourceContent, {
      mediaInterpretation:
        msgRec?.mediaInterpretation || target.existingMedia?.transcription || null,
      messageId: msgRec?.id || target.existingMedia?.messageId || null,
      mimeType: mediaRec?.mimeType || target.existingMedia?.mimeType || null,
      fileName: mediaRec?.fileName || target.existingMedia?.fileName || null,
    });

    const nextMedia: CitedMessageMedia | null = parsed.media
      ? {
          ...parsed.media,
          fileName:
            parsed.media.fileName || mediaRec?.fileName || target.existingMedia?.fileName || null,
          mimeType:
            parsed.media.mimeType || mediaRec?.mimeType || target.existingMedia?.mimeType || null,
          transcription:
            parsed.media.type === "audio"
              ? parsed.media.transcription ||
                msgRec?.mediaInterpretation ||
                target.existingMedia?.transcription ||
                null
              : null,
          messageId:
            parsed.media.messageId || msgRec?.id || target.existingMedia?.messageId || null,
        }
      : target.existingMedia;

    const nextPreview = parsed.previewText ? parsed.previewText.slice(0, 180) : target.rawPreview;

    const changedPreview = nextPreview !== target.rawPreview;
    const changedMedia =
      JSON.stringify(nextMedia || null) !== JSON.stringify(target.existingMedia || null);

    if (!changedPreview && !changedMedia) continue;

    const mutableMeta = getMutableMeta(target.rowId, target.rowIndex);

    if (target.kind === "warning") {
      mutableMeta.lastMessage = nextPreview;
      if (nextMedia) {
        mutableMeta.lastMessageMedia = nextMedia;
      }
    } else if (target.listKey && typeof target.itemIndex === "number") {
      const rawList = mutableMeta[target.listKey];
      const list = Array.isArray(rawList) ? [...rawList] : [];
      const currentItem = list[target.itemIndex];
      if (currentItem && typeof currentItem === "object") {
        list[target.itemIndex] = {
          ...(currentItem as JsonRecord),
          lastMessage: nextPreview,
          ...(nextMedia ? { lastMessageMedia: nextMedia } : {}),
        };
        mutableMeta[target.listKey] = list;
      }
    }
  }

  const repaired: Array<{ id: string; metadata: JsonRecord }> = [];
  for (const [rowId, entry] of repairedByRowId.entries()) {
    rows[entry.rowIndex].metadata = entry.metadata;
    repaired.push({ id: rowId, metadata: entry.metadata });
  }

  return repaired;
}
