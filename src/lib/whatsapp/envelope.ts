import type { UniversalOutboundMessage } from "./types";

export function outboundEnvelope(payload: UniversalOutboundMessage) {
  return {
    version: 1,
    text: payload.text || "",
    mediaUrl: payload.mediaUrl || null,
    mediaType: payload.mediaType || null,
    fileName: payload.fileName || null,
    templateName: payload.templateName || null,
    templateLanguage: payload.templateLanguage || null,
    templateComponents: payload.templateComponents || null,
    quotedMessageId: payload.quotedMessageId || null,
    operatorId: payload.operatorId || null,
    recipientPhone: payload.recipientPhone,
    recipientUserId: payload.recipientUserId || null,
  };
}

/** Também restaura registros antigos sem transformar marcador de mídia em texto. */
export function restoreOutbound(
  message: {
    tenantId: string;
    conversationId: string;
    content: string;
    quotedMessageId?: string | null;
    metaDetails: Record<string, any>;
  },
  recipientPhone: string,
  recipientUserId?: string,
): UniversalOutboundMessage {
  const saved = message.metaDetails || {};
  const media = message.content.match(
    /^\[MEDIA:(image|audio|video|document|sticker)\]([^:\n]+)(?::([^\n]+))?(?:\n([\s\S]*))?$/,
  );
  if (!saved.version && !saved.mediaUrl && !saved.templateName && /^\[(Mídia:|Template Meta:)/.test(message.content)) {
    throw new Error(
      "Envio antigo sem dados completos. Revise o conteúdo antes de criar um novo envio.",
    );
  }
  return {
    tenantId: message.tenantId,
    conversationId: message.conversationId,
    recipientPhone,
    recipientUserId,
    text: saved.version ? saved.text : media ? media[4] || "" : message.content,
    mediaUrl:
      saved.mediaUrl ||
      (media ? `/api/baileys/media?messageId=${encodeURIComponent(media[2])}` : undefined),
    mediaType: saved.mediaType || media?.[1],
    fileName: saved.fileName || media?.[3],
    templateName: saved.templateName || undefined,
    templateLanguage: saved.templateLanguage || undefined,
    templateComponents: saved.templateComponents || undefined,
    quotedMessageId: saved.quotedMessageId || message.quotedMessageId || undefined,
    operatorId: saved.operatorId || undefined,
  };
}
