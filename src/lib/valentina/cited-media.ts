export type CitedMediaKind = "image" | "video" | "audio" | "document" | "sticker";

export interface CitedMessageMedia {
  type: CitedMediaKind;
  mediaId?: string | null;
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  caption?: string | null;
  transcription?: string | null;
  messageId?: string | null;
}

export interface ParsedCitedMessage {
  previewText: string;
  media: CitedMessageMedia | null;
  /** ID bruto encontrado em texto legado (ex: `[Mídia recebida] med_xxx`) mesmo quando o tipo ainda precisa de hidratação no servidor. */
  unresolvedMediaId?: string | null;
  unresolvedFileName?: string | null;
  unresolvedCaption?: string | null;
}

export interface ParseCitedMediaOptions {
  mediaInterpretation?: string | null;
  messageId?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  backendUrl?: string;
}

const VALID_CITED_MEDIA_KINDS = new Set<CitedMediaKind>([
  "image",
  "video",
  "audio",
  "document",
  "sticker",
]);

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "heic",
  "heif",
  "avif",
  "svg",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv", "3gp", "avi", "m4v"]);

const AUDIO_EXTENSIONS = new Set(["ogg", "oga", "opus", "mp3", "wav", "m4a", "aac", "amr", "flac"]);

const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "ppt",
  "pptx",
  "txt",
  "rtf",
  "zip",
  "rar",
  "7z",
  "xml",
  "json",
  "odt",
  "ods",
]);

function normalizeOptionalString(val?: string | null): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitFirstLine(raw: string): { firstLine: string; rest: string } {
  const nlIndex = raw.indexOf("\n");
  if (nlIndex === -1) {
    return { firstLine: raw.trim(), rest: "" };
  }
  return {
    firstLine: raw.slice(0, nlIndex).replace(/\r$/, "").trim(),
    rest: raw.slice(nlIndex + 1).trim(),
  };
}

export function buildCitedMediaUrl(mediaId: string, backendUrl = ""): string {
  const base = backendUrl ? backendUrl.replace(/\/+$/, "") : "";
  return `${base}/api/baileys/media?messageId=${encodeURIComponent(mediaId)}`;
}

export function inferCitedMediaKindFromMimeOrFileName(
  mimeType?: string | null,
  fileName?: string | null,
): CitedMediaKind | null {
  const normalizedMime = (mimeType || "").split(";")[0].trim().toLowerCase();
  const normalizedName = (fileName || "").trim().toLowerCase();

  if (normalizedMime) {
    if (normalizedMime === "image/webp") {
      return normalizedName.includes("sticker") || normalizedName.includes("figurinha")
        ? "sticker"
        : "image";
    }
    if (normalizedMime.startsWith("image/")) return "image";
    if (normalizedMime.startsWith("video/")) return "video";
    if (normalizedMime.startsWith("audio/") || normalizedMime === "application/ogg") return "audio";
    if (normalizedMime.startsWith("application/") || normalizedMime.startsWith("text/")) {
      return "document";
    }
  }

  if (normalizedName) {
    const dotIdx = normalizedName.lastIndexOf(".");
    if (dotIdx !== -1 && dotIdx < normalizedName.length - 1) {
      const ext = normalizedName.slice(dotIdx + 1);
      if (ext === "webp") {
        return normalizedName.includes("sticker") || normalizedName.includes("figurinha")
          ? "sticker"
          : "image";
      }
      if (IMAGE_EXTENSIONS.has(ext)) return "image";
      if (VIDEO_EXTENSIONS.has(ext)) return "video";
      if (AUDIO_EXTENSIONS.has(ext)) return "audio";
      if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
    }
  }

  return null;
}

export function formatCitedMediaPreviewText(media: {
  type: CitedMediaKind;
  fileName?: string | null;
  caption?: string | null;
  transcription?: string | null;
}): string {
  const caption = normalizeOptionalString(media.caption);
  const fileName = normalizeOptionalString(media.fileName);
  const transcription = normalizeOptionalString(media.transcription);

  switch (media.type) {
    case "image":
      return caption ? `Foto: ${caption}` : "Foto enviada pelo cliente";
    case "video":
      return caption ? `Vídeo: ${caption}` : "Vídeo enviado pelo cliente";
    case "audio":
      return transcription ? `Áudio: ${transcription}` : "Áudio enviado pelo cliente";
    case "sticker":
      return "Figurinha enviada pelo cliente";
    case "document":
      if (fileName && caption) return `Arquivo (${fileName}): ${caption}`;
      if (fileName) return `Arquivo: ${fileName}`;
      if (caption) return `Arquivo: ${caption}`;
      return "Arquivo enviado pelo cliente";
  }
}

/**
 * Extrai ID de mídia em alertas legados persistidos no formato
 * `"[Mídia recebida] med_..."` ou `"[Mídia] med_..."` ou `"[MEDIA:...]med_..."`.
 */
export function extractLegacyMediaRefFromPreview(text?: string | null): {
  mediaId: string;
  fileName: string | null;
  caption: string | null;
  explicitType: CitedMediaKind | null;
} | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const { firstLine, rest } = splitFirstLine(trimmed);

  // 1) Tag [MEDIA:type]id(:fileName)?
  if (firstLine.startsWith("[MEDIA:")) {
    const m = firstLine.match(
      /^\[MEDIA:(image|video|audio|document|sticker)\]([^:\s\]]+)(?::(.+))?$/i,
    );
    if (m) {
      const explicitType = m[1].toLowerCase() as CitedMediaKind;
      const mediaId = m[2].trim();
      const fileName = normalizeOptionalString(m[3]);
      if (mediaId) {
        return {
          mediaId,
          fileName,
          caption: normalizeOptionalString(rest),
          explicitType,
        };
      }
    }
  }

  // 2) Legado gerado pelo regex antigo: "[Mídia recebida] med_xxx" ou "[Mídia] med_xxx:arquivo.pdf"
  const legacyPrefixMatch = firstLine.match(
    /^\[M[íi]dia(?:\s+recebida)?\]\s+([^\s]+)(?:\s+([\s\S]*))?$/i,
  );
  if (legacyPrefixMatch) {
    const token = legacyPrefixMatch[1].trim();
    const inlineTail = normalizeOptionalString(legacyPrefixMatch[2]);
    const colonIdx = token.indexOf(":");
    const rawId = (colonIdx !== -1 ? token.slice(0, colonIdx) : token).trim();
    const rawFileFromToken = colonIdx !== -1 ? token.slice(colonIdx + 1).trim() : "";

    const looksLikeMediaId =
      rawId.length <= 256 &&
      /^(?:med_[a-zA-Z0-9._-]{6,180}|wamid\.[a-zA-Z0-9._=-]{6,220}|3EB0[a-zA-Z0-9]{6,64}|[a-f0-9]{20,128})$/i.test(
        rawId,
      );

    if (looksLikeMediaId) {
      let fileName: string | null = null;
      let caption: string | null = normalizeOptionalString(rest);

      if (rawFileFromToken) {
        fileName = inlineTail ? `${rawFileFromToken} ${inlineTail}`.trim() : rawFileFromToken;
      } else if (inlineTail) {
        caption = caption ? `${inlineTail}\n${caption}` : inlineTail;
      }

      return {
        mediaId: rawId,
        fileName: normalizeOptionalString(fileName),
        caption,
        explicitType: null,
      };
    }
  }

  return null;
}

/**
 * Converte o conteúdo bruto de uma mensagem de cliente (ou preview legado salvo em alerta)
 * em um par `{ previewText, media }` seguro para UI, SSE, prompt de IA e notificações.
 * Nunca vaza tags `[MEDIA:...]` nem hashes `med_...` no `previewText`.
 */
export function parseCitedMessageMedia(
  rawContent?: string | null,
  options: ParseCitedMediaOptions = {},
): ParsedCitedMessage {
  const backendUrl = options.backendUrl || "";
  const transcription = normalizeOptionalString(options.mediaInterpretation);
  const messageId = normalizeOptionalString(options.messageId);
  const hintMime = normalizeOptionalString(options.mimeType);
  const hintFileName = normalizeOptionalString(options.fileName);

  const trimmed = typeof rawContent === "string" ? rawContent.trim() : "";
  if (!trimmed) {
    return {
      previewText: transcription || "",
      media: null,
    };
  }

  const { firstLine, rest } = splitFirstLine(trimmed);
  const caption = normalizeOptionalString(rest);

  // 1) Formato padrão persistido: [MEDIA:type]mediaId(:fileName)?(\ncaption)?
  if (firstLine.startsWith("[MEDIA:")) {
    const match = firstLine.match(
      /^\[MEDIA:(image|video|audio|document|sticker)\]([^:\s\]]+)(?::(.+))?$/i,
    );
    if (match) {
      const type = match[1].toLowerCase() as CitedMediaKind;
      const mediaId = match[2].trim();
      const fileName = normalizeOptionalString(match[3]) || hintFileName;
      const media: CitedMessageMedia = {
        type,
        mediaId,
        url: buildCitedMediaUrl(mediaId, backendUrl),
        fileName,
        mimeType: hintMime,
        caption,
        transcription: type === "audio" ? transcription : null,
        messageId,
      };
      return {
        previewText: formatCitedMediaPreviewText(media),
        media,
      };
    }
  }

  // 2) Formato [LOCAL_MEDIA:type:url:fileName](\ncaption)?
  if (firstLine.startsWith("[LOCAL_MEDIA:") && firstLine.endsWith("]")) {
    const inner = firstLine.slice("[LOCAL_MEDIA:".length, -1);
    const typeEnd = inner.indexOf(":");
    if (typeEnd !== -1) {
      const rawType = inner.slice(0, typeEnd).toLowerCase() as CitedMediaKind;
      const type: CitedMediaKind = VALID_CITED_MEDIA_KINDS.has(rawType) ? rawType : "document";
      const afterType = inner.slice(typeEnd + 1);
      const lastColon = afterType.lastIndexOf(":");
      const url = lastColon !== -1 ? afterType.slice(0, lastColon).trim() : afterType.trim();
      const fileName =
        (lastColon !== -1 ? normalizeOptionalString(afterType.slice(lastColon + 1)) : null) ||
        hintFileName;

      if (url) {
        const media: CitedMessageMedia = {
          type,
          mediaId: null,
          url,
          fileName,
          mimeType: hintMime,
          caption,
          transcription: type === "audio" ? transcription : null,
          messageId,
        };
        return {
          previewText: formatCitedMediaPreviewText(media),
          media,
        };
      }
    }
  }

  // 3) Formato [MEDIA_URL:type:url(:fileName)?](\ncaption)?
  if (firstLine.startsWith("[MEDIA_URL:") && firstLine.endsWith("]")) {
    const inner = firstLine.slice("[MEDIA_URL:".length, -1);
    const typeEnd = inner.indexOf(":");
    if (typeEnd !== -1) {
      const rawType = inner.slice(0, typeEnd).toLowerCase() as CitedMediaKind;
      const type: CitedMediaKind = VALID_CITED_MEDIA_KINDS.has(rawType) ? rawType : "document";
      const afterType = inner.slice(typeEnd + 1);
      const lastColon = afterType.lastIndexOf(":");
      const hasHttpAfterLastColon =
        lastColon !== -1 && /^\/\//.test(afterType.slice(lastColon + 1));
      const url =
        lastColon !== -1 && !hasHttpAfterLastColon
          ? afterType.slice(0, lastColon).trim()
          : afterType.trim();
      const fileName =
        (lastColon !== -1 && !hasHttpAfterLastColon
          ? normalizeOptionalString(afterType.slice(lastColon + 1))
          : null) || hintFileName;

      if (url) {
        const media: CitedMessageMedia = {
          type,
          mediaId: null,
          url,
          fileName,
          mimeType: hintMime,
          caption,
          transcription: type === "audio" ? transcription : null,
          messageId,
        };
        return {
          previewText: formatCitedMediaPreviewText(media),
          media,
        };
      }
    }
  }

  // 4) Alertas legados já gravados como "[Mídia recebida] med_..." ou "[Mídia] med_..."
  const legacyRef = extractLegacyMediaRefFromPreview(trimmed);
  if (legacyRef) {
    const resolvedFileName = legacyRef.fileName || hintFileName;
    const resolvedCaption = legacyRef.caption;
    const inferredKind =
      legacyRef.explicitType || inferCitedMediaKindFromMimeOrFileName(hintMime, resolvedFileName);

    if (inferredKind) {
      const media: CitedMessageMedia = {
        type: inferredKind,
        mediaId: legacyRef.mediaId,
        url: buildCitedMediaUrl(legacyRef.mediaId, backendUrl),
        fileName: resolvedFileName,
        mimeType: hintMime,
        caption: resolvedCaption,
        transcription: inferredKind === "audio" ? transcription : null,
        messageId,
      };
      return {
        previewText: formatCitedMediaPreviewText(media),
        media,
      };
    }

    // Legado ainda sem MIME/tipo resolvido: oculta o hash med_... na UI e preserva o ID para hidratação.
    const cleanFallback = resolvedFileName
      ? `Arquivo: ${resolvedFileName}`
      : resolvedCaption
        ? `Mídia recebida: ${resolvedCaption}`
        : "Mídia recebida";
    return {
      previewText: cleanFallback,
      media: null,
      unresolvedMediaId: legacyRef.mediaId,
      unresolvedFileName: resolvedFileName,
      unresolvedCaption: resolvedCaption,
    };
  }

  return {
    previewText: trimmed,
    media: null,
  };
}

/**
 * Normaliza um `CitedMessageMedia` vindo de API/SSE/metadata garantindo `url` preenchida
 * e descartando payloads malformados.
 */
export function normalizeCitedMessageMedia(
  raw: unknown,
  backendUrl = "",
): CitedMessageMedia | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rawType = typeof obj.type === "string" ? obj.type.toLowerCase().trim() : "";
  if (!VALID_CITED_MEDIA_KINDS.has(rawType as CitedMediaKind)) return null;
  const type = rawType as CitedMediaKind;
  const mediaId = normalizeOptionalString(typeof obj.mediaId === "string" ? obj.mediaId : null);
  const rawUrl = normalizeOptionalString(typeof obj.url === "string" ? obj.url : null);
  const url = rawUrl || (mediaId ? buildCitedMediaUrl(mediaId, backendUrl) : null);
  if (!url && !mediaId) return null;

  return {
    type,
    mediaId,
    url,
    fileName: normalizeOptionalString(typeof obj.fileName === "string" ? obj.fileName : null),
    mimeType: normalizeOptionalString(typeof obj.mimeType === "string" ? obj.mimeType : null),
    caption: normalizeOptionalString(typeof obj.caption === "string" ? obj.caption : null),
    transcription: normalizeOptionalString(
      typeof obj.transcription === "string" ? obj.transcription : null,
    ),
    messageId: normalizeOptionalString(typeof obj.messageId === "string" ? obj.messageId : null),
  };
}

/**
 * Retorna texto limpo para contextos puramente textuais (prompt IA, toasts, resumos),
 * sem nunca expor tags `[MEDIA:...]` ou IDs `med_...`.
 */
export function sanitizeCitedTextPreview(
  rawContent?: string | null,
  maxLength = 180,
  options?: ParseCitedMediaOptions,
): string {
  const parsed = parseCitedMessageMedia(rawContent, options);
  const text = parsed.previewText.trim();
  if (!text) return "";
  if (maxLength > 0 && text.length > maxLength) {
    return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
  }
  return text;
}
