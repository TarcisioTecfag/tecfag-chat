import { and, eq, inArray } from "drizzle-orm";
import { mediaFiles } from "../../db/schema";

export type HydratableMediaType = "image" | "audio" | "document";

export interface ParsedMediaTag {
  mediaType: HydratableMediaType;
  mediaId: string;
  fileName?: string;
  caption: string;
}

export interface HydratedMediaAttachment {
  messageId: string;
  mediaId: string;
  mediaType: HydratableMediaType;
  mimeType: string;
  mediaBase64: string;
}

const MEDIA_TAG_REGEX =
  /^\[MEDIA:(image|audio|document|sticker)\]([a-zA-Z0-9._-]+)(?::([^\r\n]*))?(?:\r?\n([\s\S]*))?$/i;

/**
 * Extrai tipo e ID de mídia de conteúdos persistidos no formato `[MEDIA:image]med_xxx`
 * ou `[MEDIA:document]med_xxx:arquivo.pdf`.
 */
export function parseMediaTagFromContent(content: string | null | undefined): ParsedMediaTag | null {
  const raw = String(content || "").trim();
  if (!raw) return null;
  const match = raw.match(MEDIA_TAG_REGEX);
  if (!match) return null;
  const rawType = match[1].toLowerCase();
  const mediaType: HydratableMediaType =
    rawType === "sticker" ? "image" : (rawType as HydratableMediaType);
  const fileName = (match[3] || "").trim() || undefined;
  return {
    mediaType,
    mediaId: match[2].trim(),
    ...(fileName ? { fileName } : {}),
    caption: (match[4] || "").trim(),
  };
}

function defaultMimeForType(mediaType: HydratableMediaType): string {
  if (mediaType === "image") return "image/jpeg";
  if (mediaType === "audio") return "audio/ogg";
  return "application/pdf";
}

/**
 * Hidrata anexos de mídia (imagens, áudios e PDFs) a partir da tabela `media_files` (isolada por `tenantId`)
 * quando o turno atual (ex.: `trigger_ai` após handoff proativo, recovery ou foto em turno anterior ainda sem
 * `mediaInterpretation`) não recebeu os bytes em memória pelo webhook em tempo real.
 */
export async function hydrateMediaAttachmentsFromDb(params: {
  db: any;
  tenantId: string;
  batchItems: Array<{
    messageId?: string;
    text?: string;
    mediaType?: string;
    mediaBase64?: string;
  }>;
  historyMsgs?: Array<{
    id?: string;
    senderType?: string;
    content?: string | null;
    mediaInterpretation?: string | null;
  }>;
  maxAttachments?: number;
  maxBase64Chars?: number;
}): Promise<HydratedMediaAttachment[]> {
  const maxAttachments = params.maxAttachments ?? 3;
  const maxBase64Chars = params.maxBase64Chars ?? 8_000_000;

  const candidates: Array<{ messageId: string; mediaId: string; mediaType: HydratableMediaType }> = [];
  const seenMediaIds = new Set<string>();

  // 1) Primeiro, itens do lote atual que vieram como texto "[MEDIA:...]id" sem mediaBase64
  for (const item of params.batchItems || []) {
    if (item.mediaBase64) continue;
    const parsed = parseMediaTagFromContent(item.text);
    if (!parsed || seenMediaIds.has(parsed.mediaId)) continue;
    seenMediaIds.add(parsed.mediaId);
    candidates.push({
      messageId: item.messageId || "",
      mediaId: parsed.mediaId,
      mediaType: parsed.mediaType,
    });
  }

  // 2) Depois, mensagens recentes do cliente no ciclo atual sem mediaInterpretation (ex.: foto antes de texto)
  const recentHistory = [...(params.historyMsgs || [])].reverse();
  for (const msg of recentHistory) {
    if (candidates.length >= maxAttachments) break;
    if (msg.senderType !== "client") continue;
    if (msg.mediaInterpretation && String(msg.mediaInterpretation).trim().length > 0) continue;
    const parsed = parseMediaTagFromContent(msg.content);
    if (!parsed || seenMediaIds.has(parsed.mediaId)) continue;
    seenMediaIds.add(parsed.mediaId);
    candidates.push({
      messageId: msg.id || "",
      mediaId: parsed.mediaId,
      mediaType: parsed.mediaType,
    });
  }

  const bounded = candidates.slice(0, maxAttachments);
  if (bounded.length === 0) return [];

  const mediaIds = bounded.map((c) => c.mediaId);
  const rows = await params.db
    .select({
      id: mediaFiles.id,
      mimeType: mediaFiles.mimeType,
      base64Data: mediaFiles.base64Data,
    })
    .from(mediaFiles)
    .where(and(eq(mediaFiles.tenantId, params.tenantId), inArray(mediaFiles.id, mediaIds)));

  const byId = new Map<string, { mimeType: string; base64Data: string }>();
  for (const row of rows || []) {
    if (row?.id && row?.base64Data && String(row.base64Data).length <= maxBase64Chars) {
      byId.set(row.id, {
        mimeType: row.mimeType || "",
        base64Data: row.base64Data,
      });
    }
  }

  const hydrated: HydratedMediaAttachment[] = [];
  for (const cand of bounded) {
    const file = byId.get(cand.mediaId);
    if (!file) continue;
    hydrated.push({
      messageId: cand.messageId,
      mediaId: cand.mediaId,
      mediaType: cand.mediaType,
      mimeType: file.mimeType || defaultMimeForType(cand.mediaType),
      mediaBase64: file.base64Data,
    });
  }
  return hydrated;
}
