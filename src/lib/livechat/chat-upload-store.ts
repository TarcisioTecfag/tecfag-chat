import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface StoredChatUpload {
  fileId: string;
  url: string;
  fileName: string;
  mimeType: string;
  mediaType: "image" | "document";
  size: number;
  base64: string;
  createdAt: number;
}

const MAX_CACHE_ITEMS = 120;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const uploadCache = new Map<string, StoredChatUpload>();

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

function getUploadDir(): string {
  const dir = path.join(process.cwd(), "public", "uploads", "chat");
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Fallback to memory cache if filesystem is read-only
  }
  return dir;
}

function pruneCache() {
  const now = Date.now();
  for (const [key, item] of uploadCache.entries()) {
    if (now - item.createdAt > UPLOAD_TTL_MS) {
      uploadCache.delete(key);
    }
  }
  while (uploadCache.size > MAX_CACHE_ITEMS) {
    const oldestKey = uploadCache.keys().next().value;
    if (!oldestKey) break;
    uploadCache.delete(oldestKey);
  }
}

export function isAllowedChatUploadMime(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_TO_EXT, mimeType);
}

export function saveChatUpload(params: {
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
}): StoredChatUpload {
  const ext = MIME_TO_EXT[params.mimeType];
  if (!ext) {
    throw new Error("Tipo de arquivo não permitido. Use JPG, PNG, GIF, WEBP ou PDF.");
  }
  const randomSuffix = crypto.randomBytes(6).toString("hex");
  const fileId = `chat_${Date.now()}_${randomSuffix}${ext}`;
  const safeName = (params.originalName || fileId).replace(/[^\w.\- ()]/g, "_").slice(0, 160) || fileId;
  const base64 = params.buffer.toString("base64");
  const mediaType: "image" | "document" = params.mimeType.startsWith("image/") ? "image" : "document";
  const url = `/api/chat-upload?file=${fileId}`;

  const record: StoredChatUpload = {
    fileId,
    url,
    fileName: safeName,
    mimeType: params.mimeType,
    mediaType,
    size: params.buffer.length,
    base64,
    createdAt: Date.now(),
  };

  pruneCache();
  uploadCache.set(fileId, record);

  try {
    const filePath = path.join(getUploadDir(), fileId);
    fs.writeFileSync(filePath, params.buffer);
  } catch {
    // Kept in memory cache
  }

  return record;
}

export function getChatUpload(fileId: string): { buffer: Buffer; mimeType: string; fileName: string; base64: string; mediaType: "image" | "document" } | null {
  if (!/^chat_\d+_[a-f0-9]{8,24}\.(jpg|jpeg|png|gif|webp|pdf)$/i.test(fileId)) {
    return null;
  }

  const cached = uploadCache.get(fileId);
  if (cached) {
    return {
      buffer: Buffer.from(cached.base64, "base64"),
      mimeType: cached.mimeType,
      fileName: cached.fileName,
      base64: cached.base64,
      mediaType: cached.mediaType,
    };
  }

  try {
    const filePath = path.join(getUploadDir(), fileId);
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(fileId).toLowerCase();
      const mimeType = EXT_TO_MIME[ext] || "application/octet-stream";
      const mediaType: "image" | "document" = mimeType.startsWith("image/") ? "image" : "document";
      return {
        buffer,
        mimeType,
        fileName: fileId,
        base64: buffer.toString("base64"),
        mediaType,
      };
    }
  } catch {
    // Ignore disk read error
  }

  return null;
}

/**
 * Extrai marcador `[Anexo_Cliente: <url>]` enviado pelo `chat-widget-pro`
 * e retorna o texto limpo + metadados/base64 do arquivo caso esteja no store local.
 */
export function extractLegacyAttachmentFromText(rawText: string): {
  cleanText: string;
  attachment: {
    fileId: string;
    fileName: string;
    mimeType: string;
    mediaType: "image" | "document";
    base64: string;
  } | null;
} {
  if (!rawText || !rawText.includes("[Anexo_Cliente:")) {
    return { cleanText: rawText, attachment: null };
  }

  const regex = /\[Anexo_Cliente:\s*([^\]]+)\]/gi;
  let match: RegExpExecArray | null;
  let resolvedAttachment: {
    fileId: string;
    fileName: string;
    mimeType: string;
    mediaType: "image" | "document";
    base64: string;
  } | null = null;

  while ((match = regex.exec(rawText)) !== null) {
    const rawUrl = match[1].trim();
    const fileMatch = rawUrl.match(/(chat_\d+_[a-f0-9]{8,24}\.(?:jpg|jpeg|png|gif|webp|pdf))/i);
    if (fileMatch) {
      const found = getChatUpload(fileMatch[1]);
      if (found) {
        resolvedAttachment = {
          fileId: fileMatch[1],
          fileName: found.fileName,
          mimeType: found.mimeType,
          mediaType: found.mediaType,
          base64: found.base64,
        };
        break;
      }
    }
  }

  const cleanText = rawText.replace(/\[Anexo_Cliente:\s*[^\]]+\]/gi, "").trim();
  return { cleanText, attachment: resolvedAttachment };
}
