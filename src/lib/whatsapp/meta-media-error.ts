export type MetaMediaErrorCategory =
  "too_large" | "expired_or_missing" | "tenant_mismatch" | "transient";

export interface ClassifiedMetaMediaError {
  category: MetaMediaErrorCategory;
  permanent: boolean;
  safeReason: string;
}

export const MAX_META_MEDIA_RECOVERY_ATTEMPTS = 6;

const MEDIA_LABELS_PT: Record<string, string> = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
};

function sanitizeErrorText(raw: unknown): string {
  const rawMessage =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
        ? raw
        : raw && typeof raw === "object" && "message" in raw
          ? String((raw as { message?: unknown }).message || "")
          : "";
  const cleaned = rawMessage
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(access_token|token)=[^&\s]+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Falha no download da mídia Meta").slice(0, 280);
}

/**
 * Classifica falhas no download de mídia da Meta Cloud API entre permanentes (ex.: arquivo > 20 MB,
 * mídia expirada/404/410 ou número divergente) e transitórias (timeout, rede, 429, 5xx), evitando
 * loops infinitos de HTTP 500 no webhook e preservando o diagnóstico real.
 */
export function classifyMetaMediaDownloadError(error: unknown): ClassifiedMetaMediaError {
  const safeReason = sanitizeErrorText(error);
  const lower = safeReason.toLowerCase();

  if (
    lower.includes("excede o limite operacional") ||
    lower.includes("exceeds") ||
    lower.includes("too large") ||
    lower.includes("arquivo muito grande") ||
    /\bhttp\s*413\b/.test(lower)
  ) {
    return { category: "too_large", permanent: true, safeReason };
  }

  if (
    lower.includes("não pertence ao número configurado") ||
    lower.includes("nao pertence ao numero configurado")
  ) {
    return { category: "tenant_mismatch", permanent: true, safeReason };
  }

  if (
    /\bhttp\s*(?:400|404|410)\b/.test(lower) ||
    lower.includes("(#100)") ||
    lower.includes("does not exist") ||
    lower.includes("expired") ||
    lower.includes("expirad") ||
    lower.includes("mídia indisponível") ||
    lower.includes("midia indisponivel") ||
    lower.includes("retornou corpo vazio") ||
    lower.includes("mídia sem id") ||
    lower.includes("midia sem id")
  ) {
    return { category: "expired_or_missing", permanent: true, safeReason };
  }

  return { category: "transient", permanent: false, safeReason };
}

/**
 * Constrói um aviso visível na conversa quando uma mídia enviada pelo cliente não pôde ser baixada
 * definitivamente, preservando a legenda/nome do arquivo para o operador agir imediatamente.
 */
export function buildMetaMediaDownloadFailureNotice(input: {
  mediaType?: string | null;
  category: MetaMediaErrorCategory;
  caption?: string | null;
  fileName?: string | null;
}): string {
  const mediaLabel = MEDIA_LABELS_PT[String(input.mediaType || "").toLowerCase()] || "Mídia";
  const fileSuffix = input.fileName && input.fileName.trim() ? ` (${input.fileName.trim()})` : "";

  const notice =
    input.category === "too_large"
      ? `[${mediaLabel}${fileSuffix} enviado pelo cliente excedeu o limite de 20 MB da API — peça para reenviar um arquivo menor ou por link]`
      : `[${mediaLabel}${fileSuffix} enviado pelo cliente não pôde ser baixado da API oficial da Meta — peça para reenviar]`;

  const caption = typeof input.caption === "string" ? input.caption.trim() : "";
  return caption ? `${notice}\n${caption}` : notice;
}
