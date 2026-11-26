export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface MessageContextMenuState {
  messageId: string;
  x: number;
  y: number;
}

export type DownloadableMediaType = "image" | "video" | "audio" | "document" | "sticker";

export interface DownloadableMediaDescriptor {
  type: DownloadableMediaType;
  url: string;
  fallbackUrl?: string | null;
  fileName: string;
  hasExplicitFileName: boolean;
}

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/aac": "aac",
  "audio/opus": "opus",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/x-rar-compressed": "rar",
  "application/vnd.rar": "rar",
};

const DEFAULT_EXTENSION_BY_TYPE: Record<DownloadableMediaType, string> = {
  image: "jpg",
  video: "mp4",
  audio: "ogg",
  sticker: "webp",
  document: "bin",
};

const DEFAULT_PREFIX_BY_TYPE: Record<DownloadableMediaType, string> = {
  image: "imagem",
  video: "video",
  audio: "audio",
  sticker: "figurinha",
  document: "documento",
};

/**
 * Remove caracteres inválidos em sistemas de arquivos (Windows/macOS/Linux)
 * preservando nome legível e extensão original quando existir.
 */
export function sanitizeDownloadFileName(raw?: string | null): string {
  if (!raw) return "";
  const withoutControlChars = Array.from(raw)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  return withoutControlChars
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
}

function buildDefaultMediaBaseName(type: DownloadableMediaType, idHint?: string): string {
  const prefix = DEFAULT_PREFIX_BY_TYPE[type] || "midia";
  const safeHint = sanitizeDownloadFileName(idHint || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (safeHint) {
    return `${prefix}-${safeHint.slice(-12)}`;
  }
  return prefix;
}

/**
 * Extrai os metadados de mídia baixável (foto, vídeo, áudio, PDF/documento, figurinha)
 * a partir do texto padronizado da mensagem no chat. Retorna `null` para texto puro.
 */
export function extractDownloadableMediaFromMessage(
  text?: string | null,
  backendUrl = "",
): DownloadableMediaDescriptor | null {
  if (!text || typeof text !== "string") return null;

  const normalized = text.replace(/\[SEND_IMAGE:([^\]]+)\]/gi, (_m, rawUrl: string) => {
    const trimmed = String(rawUrl || "").trim();
    const kfMatch = trimmed.match(/(kf-[a-z0-9-]+)(?:\.([a-z0-9]+))?/i);
    const resolvedUrl = kfMatch
      ? `${backendUrl}/api/valentina/catalog-images?action=rawImage&fileId=${encodeURIComponent(kfMatch[1])}`
      : trimmed;
    const fName = kfMatch ? `${kfMatch[1]}.${kfMatch[2] || "png"}` : "equipamento.png";
    return `[LOCAL_MEDIA:image:${resolvedUrl}:${fName}]`;
  });

  const newlineIndex = normalized.indexOf("\n");
  const mediaTag = (newlineIndex !== -1 ? normalized.slice(0, newlineIndex) : normalized).trim();
  if (!mediaTag) return null;

  if (mediaTag.startsWith("[LOCAL_MEDIA:")) {
    const rest = mediaTag.slice("[LOCAL_MEDIA:".length);
    const typeEnd = rest.indexOf(":");
    if (typeEnd === -1) return null;
    const rawType = rest.slice(0, typeEnd).toLowerCase();
    const type: DownloadableMediaType =
      rawType === "image" ||
      rawType === "video" ||
      rawType === "audio" ||
      rawType === "document" ||
      rawType === "sticker"
        ? rawType
        : "document";
    const afterType = rest.slice(typeEnd + 1);
    const lastColon = afterType.lastIndexOf(":");
    if (lastColon === -1) return null;
    const url = afterType.slice(0, lastColon).trim();
    const rawName = afterType
      .slice(lastColon + 1)
      .replace(/\]$/, "")
      .trim();
    if (!url) return null;
    const cleanName = sanitizeDownloadFileName(rawName);
    const fallbackUrl =
      type === "image" && rawName
        ? `${backendUrl}/api/valentina/catalog-images?action=rawImage&fileName=${encodeURIComponent(rawName)}`
        : null;
    return {
      type,
      url,
      fallbackUrl,
      fileName: cleanName || buildDefaultMediaBaseName(type),
      hasExplicitFileName: Boolean(cleanName),
    };
  }

  if (mediaTag.startsWith("[MEDIA:")) {
    const match = mediaTag.match(
      /^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::(.+))?$/,
    );
    if (!match) return null;
    const [, rawType, mediaId, extra] = match;
    const type = rawType as DownloadableMediaType;
    const cleanId = mediaId.trim();
    if (!cleanId) return null;
    const url = `${backendUrl}/api/baileys/media?messageId=${encodeURIComponent(cleanId)}`;
    const rawName = extra?.trim() || "";
    const cleanName = sanitizeDownloadFileName(rawName);
    const fallbackUrl =
      type === "image" && rawName
        ? `${backendUrl}/api/valentina/catalog-images?action=rawImage&fileName=${encodeURIComponent(rawName)}`
        : null;
    return {
      type,
      url,
      fallbackUrl,
      fileName: cleanName || buildDefaultMediaBaseName(type, cleanId),
      hasExplicitFileName: Boolean(cleanName),
    };
  }

  const legacyImgTagMatch = mediaTag.match(
    /^\[(?:Arquivo|Imagem)\s+(?:anexad[oa]|enviad[oa])[^:]*:\s*([^\]]+\.(?:jpe?g|png|webp|gif|bmp))\]$/i,
  );
  if (legacyImgTagMatch) {
    const rawName = legacyImgTagMatch[1].trim();
    const cleanName = sanitizeDownloadFileName(rawName) || "imagem.jpg";
    return {
      type: "image",
      url: `${backendUrl}/api/valentina/catalog-images?action=rawImage&fileName=${encodeURIComponent(rawName)}`,
      fallbackUrl: null,
      fileName: cleanName,
      hasExplicitFileName: true,
    };
  }

  return null;
}

/**
 * Garante um nome final de download com extensão apropriada (usando o Content-Type
 * real devolvido pelo servidor quando o arquivo não trouxer extensão explícita).
 */
export function resolveDownloadFileName(
  media: DownloadableMediaDescriptor,
  contentType?: string | null,
): string {
  const baseName =
    sanitizeDownloadFileName(media.fileName) || buildDefaultMediaBaseName(media.type);
  if (/\.[a-z0-9]{2,5}$/i.test(baseName)) {
    return baseName;
  }

  const normalizedMime = (contentType || "").split(";")[0].trim().toLowerCase();
  const extFromMime = MIME_TO_EXTENSION[normalizedMime];
  const ext = extFromMime || DEFAULT_EXTENSION_BY_TYPE[media.type] || "bin";
  return `${baseName}.${ext}`;
}

/**
 * Baixa uma mídia do chat diretamente para o computador do usuário via Blob +
 * link `download` com nome e extensão corretos, suportando fallback de catálogo
 * e credenciais de sessão.
 */
export async function downloadChatMedia(
  media: DownloadableMediaDescriptor,
): Promise<{ ok: boolean; fileName: string; error?: string }> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return { ok: false, fileName: media.fileName, error: "Ambiente sem navegador." };
  }

  const triggerAnchorDownload = (href: string, fileName: string, openExternalFallback = false) => {
    const link = document.createElement("a");
    link.href = href;
    link.download = fileName;
    if (openExternalFallback) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (media.url.startsWith("blob:") || media.url.startsWith("data:")) {
    const mimeMatch = media.url.startsWith("data:")
      ? (media.url.match(/^data:([^;,]+)/i)?.[1] ?? null)
      : null;
    const finalName = resolveDownloadFileName(media, mimeMatch);
    triggerAnchorDownload(media.url, finalName);
    return { ok: true, fileName: finalName };
  }

  const candidateUrls = [media.url, ...(media.fallbackUrl ? [media.fallbackUrl] : [])];
  let lastError: string | undefined;

  for (const candidateUrl of candidateUrls) {
    try {
      const response = await fetch(candidateUrl, { credentials: "include" });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const contentType = response.headers.get("content-type");
      const blob = await response.blob();
      const finalName = resolveDownloadFileName(media, contentType || blob.type || null);
      const objectUrl = URL.createObjectURL(blob);
      try {
        triggerAnchorDownload(objectUrl, finalName);
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
      }
      return { ok: true, fileName: finalName };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Erro ao baixar mídia";
    }
  }

  if (/^https?:\/\//i.test(media.url)) {
    const finalName = resolveDownloadFileName(media, null);
    triggerAnchorDownload(media.url, finalName, true);
    return { ok: true, fileName: finalName };
  }

  return {
    ok: false,
    fileName: media.fileName,
    error: lastError || "Não foi possível baixar a mídia.",
  };
}

/**
 * Garante que o menu de contexto de mensagem nunca ultrapasse os limites visíveis
 * da viewport (ex.: mensagens enviadas coladas na borda direita ou na última linha do chat).
 */
export function clampContextMenuPosition(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
  menuWidth = 196,
  menuHeight = 48,
  padding = 8,
): ContextMenuPosition {
  const safeViewportW =
    Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : menuWidth + padding * 2;
  const safeViewportH =
    Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : menuHeight + padding * 2;
  const maxX = Math.max(padding, safeViewportW - menuWidth - padding);
  const maxY = Math.max(padding, safeViewportH - menuHeight - padding);

  return {
    x: Math.min(Math.max(clientX, padding), maxX),
    y: Math.min(Math.max(clientY, padding), maxY),
  };
}

/**
 * Resolve o rótulo do remetente exibido ao expandir as informações da mensagem,
 * garantindo fallback consistente para mídias e mensagens otimistas/legadas.
 */
export function resolveMessageInfoAuthor(params: {
  author?: string | null;
  isMe: boolean;
  operatorName?: string | null;
  chatName?: string | null;
}): string {
  const explicit = params.author?.trim();
  if (explicit) return explicit;
  if (params.isMe) {
    return params.operatorName?.trim() || "Você";
  }
  return params.chatName?.trim() || "Contato";
}
