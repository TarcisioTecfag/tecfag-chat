/**
 * Entrega de mensagens do núcleo de atendimento para o widget do site.
 * Usado pelo SdrEngine (respostas do Fagner), pelo despachante de presença/imagem e
 * pela rota de envio do operador. Não importa o SdrEngine/SdrDebouncer (evita ciclo).
 */
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { conversations, mediaFiles, messages } from "../../db/schema";
import { SessionManager } from "../baileys/session-manager";
import { getOrCreateActiveChat, getVisitorById, saveMessage } from "./livechatStorage";
import { siteGateway } from "./site-gateway";
import { SITE_PROVIDER, visitorIdFromSiteConversation } from "./site-channel-policy";
import { persistSiteOperatorMessage } from "./site-message-store";
import { getAiPersona } from "../ai-persona";
import type { IndustrialDeliveryContext } from "../valentina/industrial-delivery-context";

async function resolveSiteVisitor(tenantId: string, conversationId: string) {
  const visitorId = visitorIdFromSiteConversation(conversationId);
  if (!visitorId) throw new Error("Conversa não pertence ao canal do site");
  const visitor = await getVisitorById(tenantId, visitorId);
  if (!visitor) throw new Error("Visitante do site não encontrado para esta empresa");
  return visitor;
}

export async function pushSiteTyping(tenantId: string, conversationId: string, isTyping: boolean) {
  const visitorId = visitorIdFromSiteConversation(conversationId);
  if (visitorId) {
    siteGateway.push(tenantId, visitorId, { type: "typing", isTyping });
    siteGateway.push(tenantId, visitorId, { type: isTyping ? "TYPING_START" : "TYPING_STOP" });
  }
}

export function pushSiteAgentJoined(
  tenantId: string,
  conversationId: string,
  operatorName: string,
  message?: string,
) {
  const visitorId = visitorIdFromSiteConversation(conversationId);
  if (!visitorId) return false;
  const text = message || `${operatorName} entrou no atendimento.`;
  const d1 = siteGateway.push(tenantId, visitorId, {
    type: "operator_joined",
    operatorName,
    message: text,
  });
  const d2 = siteGateway.push(tenantId, visitorId, {
    type: "AGENT_JOINED",
    operatorName,
    message: text,
  });
  return d1 || d2;
}

export function pushSiteChatClosed(
  tenantId: string,
  conversationId: string,
  message?: string,
) {
  const visitorId = visitorIdFromSiteConversation(conversationId);
  if (!visitorId) return false;
  const text = message || "Atendimento encerrado pelo operador. Obrigado!";
  const d1 = siteGateway.push(tenantId, visitorId, {
    type: "chat_closed",
    message: text,
  });
  const d2 = siteGateway.push(tenantId, visitorId, {
    type: "CHAT_CLOSED",
    message: text,
  });
  return d1 || d2;
}

/**
 * Grava no histórico do widget e entrega às abas conectadas.
 * `delivered=false` significa visitante desconectado: a mensagem aparece na reconexão.
 */
export async function deliverSiteText(params: {
  tenantId: string;
  conversationId: string;
  text: string;
  sender: "ai" | "operator";
  senderName?: string;
  idempotencyMessageId?: string;
}) {
  const visitor = await resolveSiteVisitor(params.tenantId, params.conversationId);
  const chat = await getOrCreateActiveChat(params.tenantId, visitor.id);
  const saved = await saveMessage(params.tenantId, chat.id, params.sender, params.text,
    params.idempotencyMessageId ? { id: `${params.idempotencyMessageId}-widget` } : {});
  const nowIso = new Date().toISOString();
  const deliveredV2 = siteGateway.push(params.tenantId, visitor.id, {
    type: "message",
    chatId: chat.id,
    messageId: saved.id,
    sender: params.sender,
    senderName: params.senderName,
    content: params.text,
  });
  const deliveredLegacy = siteGateway.push(params.tenantId, visitor.id, {
    type: "CHAT_REPLY",
    chatId: chat.id,
    messageId: saved.id,
    sender: params.sender === "operator" ? "agent" : "ai",
    senderName: params.senderName,
    content: params.text,
    timestamp: nowIso,
  });
  const delivered = deliveredV2 || deliveredLegacy;
  return { delivered, siteMessageId: saved.id };
}

async function touchConversation(tenantId: string, conversationId: string, preview: string) {
  const now = new Date();
  await db
    .update(conversations)
    .set({ lastMessageText: preview, lastMessageTime: now, updatedAt: now })
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)));
  return db.query.conversations.findFirst({
    where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.tenantId, tenantId), dEq(t.id, conversationId)),
  });
}

/** Balão do SDR: entrega no widget, registra em `messages` e notifica o painel. */
export async function deliverSiteBotFragment(params: {
  tenantId: string;
  conversationId: string;
  text: string;
  senderName: string;
  idempotencyMessageId?: string;
  expectedOperatorId?: string | null;
  deliveryContext?: IndustrialDeliveryContext;
}) {
  const { tenantId, conversationId, text, senderName } = params;
  if (getAiPersona(tenantId).triagePolicy === "industrial") {
    const { sendIndustrialBotBatch } = await import("../valentina/industrial-outbound");
    const result = await sendIndustrialBotBatch({ tenantId, conversationId, scope: "site-fragment", items: [{ text }],
      idempotencyMessageId: params.idempotencyMessageId, expectedOperatorId: params.expectedOperatorId, context: params.deliveryContext });
    if (!result.sent || !result.messageId) throw Error(result.reason || "Resposta do site pendente.");
    return { id: result.messageId, delivered: false, siteMessageId: `${result.messageId}-widget` };
  }
  const delivery = await deliverSiteText({ tenantId, conversationId, text, sender: "ai", senderName, idempotencyMessageId: params.idempotencyMessageId });
  const id = params.idempotencyMessageId || `bot-site-${crypto.randomUUID()}`;
  const now = new Date();
  await db.insert(messages).values({
    id,
    tenantId,
    conversationId,
    senderType: "bot",
    senderName,
    content: text,
    isInternalNote: false,
    direction: "outbound",
    provider: SITE_PROVIDER,
    externalId: delivery.siteMessageId,
    status: delivery.delivered ? "delivered" : "accepted",
    sentAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  const conv = await touchConversation(tenantId, conversationId, text);
  SessionManager.getInstance().notifyPublic(tenantId, {
    type: "message",
    message: {
      id,
      conversationId,
      senderType: "bot",
      senderName,
      content: text,
      provider: SITE_PROVIDER,
      sentAt: now,
      queue: conv?.queueState || "automacao",
      operatorId: conv?.operatorId || null,
    },
  });
  return { id, ...delivery };
}

/**
 * Foto do catálogo (`/knowledge-media/...`) para o widget. O binário também fica em
 * `mediaFiles` para o operador ver a mesma imagem no módulo de Conversas.
 */
export async function deliverSiteCatalogImage(params: {
  tenantId: string;
  conversationId: string;
  publicUrl: string;
  imgBuffer: Buffer;
  mimeType: string;
  fileName: string;
  senderName: string;
  expectedOperatorId?: string | null;
  deliveryContext?: IndustrialDeliveryContext;
}) {
  const { tenantId, conversationId, publicUrl, imgBuffer, mimeType, fileName, senderName } = params;
  if (getAiPersona(tenantId).triagePolicy === "industrial") {
    const { sendIndustrialBotBatch } = await import("../valentina/industrial-outbound");
    const result = await sendIndustrialBotBatch({ tenantId, conversationId, scope: `site-catalog-${publicUrl}`,
      expectedOperatorId: params.expectedOperatorId, context: params.deliveryContext,
      items: [{ text: "", image: { buffer: imgBuffer, mimeType, fileName, publicUrl } }] });
    if (!result.sent || !result.messageId) throw Error(result.reason || "Imagem do site pendente.");
    return { delivered: false, id: result.messageId };
  }
  const visitor = await resolveSiteVisitor(tenantId, conversationId);
  const chat = await getOrCreateActiveChat(tenantId, visitor.id);
  const saved = await saveMessage(tenantId, chat.id, "ai", `[IMAGE:${publicUrl}]`, {
    contentType: "image",
    mediaUrl: publicUrl,
    mediaType: mimeType,
    fileName,
  });
  const deliveredV2 = siteGateway.push(tenantId, visitor.id, {
    type: "send_image",
    chatId: chat.id,
    messageId: saved.id,
    imageUrl: publicUrl,
    sender: "ai",
  });
  const deliveredLegacy = siteGateway.push(tenantId, visitor.id, {
    type: "CHAT_REPLY",
    chatId: chat.id,
    messageId: saved.id,
    sender: "ai",
    content: `[Anexo_Cliente: ${publicUrl}]`,
    timestamp: new Date().toISOString(),
  });
  const delivered = deliveredV2 || deliveredLegacy;
  const mediaFileId = `med_site_${crypto.randomUUID()}`;
  const now = new Date();
  await db
    .insert(mediaFiles)
    .values({
      id: mediaFileId,
      tenantId,
      conversationId,
      fileName,
      mimeType,
      fileSize: imgBuffer.length,
      base64Data: imgBuffer.toString("base64"),
      createdAt: now,
    })
    .onConflictDoNothing();
  const id = `bot-site-img-${crypto.randomUUID()}`;
  const content = `[MEDIA:image]${mediaFileId}`;
  await db.insert(messages).values({
    id,
    tenantId,
    conversationId,
    senderType: "bot",
    senderName,
    content,
    isInternalNote: false,
    direction: "outbound",
    provider: SITE_PROVIDER,
    externalId: saved.id,
    status: delivered ? "delivered" : "accepted",
    sentAt: now,
    updatedAt: now,
  });
  const conv = await touchConversation(tenantId, conversationId, "📷 Foto enviada");
  SessionManager.getInstance().notifyPublic(tenantId, {
    type: "message",
    message: {
      id,
      conversationId,
      senderType: "bot",
      senderName,
      content,
      mediaUrl: `/api/baileys/media?messageId=${mediaFileId}`,
      mediaType: "image",
      fileName,
      sentAt: now,
      queue: conv?.queueState || "automacao",
      operatorId: conv?.operatorId || null,
    },
  });
  return { delivered, id };
}

/**
 * Resposta do operador (módulo de Conversas) para o visitante do site. A autorização
 * (sessão, tenant, posse da conversa e card) é feita pela rota antes desta chamada.
 */
export async function sendSiteOperatorText(params: {
  tenantId: string;
  conversationId: string;
  operatorId: string;
  text: string;
  operatorName: string;
  idempotencyKey?: string;
}) {
  const { tenantId, conversationId } = params;
  const { message, widgetMessage, visitorId } = await persistSiteOperatorMessage(db, params);
  // Publishing is auxiliary: the two histories already committed and survive a crash.
  const delivered = siteGateway.push(tenantId, visitorId, {
    type: "message", chatId: widgetMessage.chatId, messageId: widgetMessage.id,
    sender: "operator", senderName: message.senderName, content: message.content,
  }) || false;
  const deliveredLegacy = siteGateway.push(tenantId, visitorId, {
    type: "CHAT_REPLY", chatId: widgetMessage.chatId, messageId: widgetMessage.id,
    sender: "agent", senderName: message.senderName, content: message.content,
    timestamp: message.sentAt.toISOString(),
  });
  let status = message.status;
  if ((delivered || deliveredLegacy) && status !== "read") try {
    await db
    .update(messages)
    .set({ status: "delivered", updatedAt: new Date() })
    .where(and(eq(messages.tenantId, tenantId), eq(messages.id, message.id)));
    status = "delivered";
  } catch {
    console.error("[SiteDelivery] Histórico preservado; status do socket aguardando reconciliação.");
  }
  try { SessionManager.getInstance().notifyPublic(tenantId, {
    type: "message_status",
    conversationId,
    messageId: message.id,
    status,
  }); } catch {
    console.error("[SiteDelivery] Histórico preservado; notificação do painel indisponível.");
  }
  return { success: true, messageId: message.id, status };
}
