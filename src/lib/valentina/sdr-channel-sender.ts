// ══════════════════════════════════════════════════════════════════════════════
// 📡 SDR CHANNEL SENDER — Despachante Universal de Bot (Meta Cloud API + Baileys)
// ══════════════════════════════════════════════════════════════════════════════
// Permite que o Fagner SDR (canal Meta) e a Valentina SDR (canal Baileys)
// enviem mensagens de texto, fotos do catálogo (Formato Real), áudios PTT e
// presença ("digitando...") de forma 100% transparente e persistida no banco.
// ══════════════════════════════════════════════════════════════════════════════

import { db } from "../../db";
import { channelConfigs, conversations, contacts, messages, mediaFiles } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { SessionManager, resolveRealJid } from "../baileys/session-manager";
import { metaAdapter } from "../whatsapp/adapters/meta";
import { sendMetaConversationPresence, resetMetaTypingThrottle } from "../whatsapp/meta-presence";
export { resetMetaTypingThrottle };
import { getAiPersona } from "../ai-persona";
import { isSiteConversationId } from "../livechat/site-channel-policy";
import { pushSiteTyping } from "../livechat/site-delivery";

export async function resolveTenantActiveProvider(tenantId: string): Promise<"baileys" | "meta"> {
  try {
    const [cfg] = await db
      .select({ activeProvider: channelConfigs.activeProvider })
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, tenantId))
      .limit(1);

    if (cfg?.activeProvider === "meta" || cfg?.activeProvider === "baileys") {
      return cfg.activeProvider;
    }
  } catch (err) {
    console.warn(`[SdrChannelSender] Erro ao consultar channelConfigs para tenant ${tenantId}:`, err);
  }
  return tenantId === "tecfag" ? "meta" : "baileys";
}

export async function sendBotPresence(
  tenantId: string,
  conversationId: string,
  phone: string,
  action: "composing" | "recording" | "paused"
): Promise<void> {
  try {
    if (isSiteConversationId(conversationId)) {
      await pushSiteTyping(tenantId, conversationId, action !== "paused");
      return;
    }
    const provider = await resolveTenantActiveProvider(tenantId);
    if (provider === "meta") {
      if (action === "composing" || action === "recording") {
        await sendMetaConversationPresence(tenantId, conversationId, "typing");
      }
      return;
    }

    const sock = SessionManager.getInstance().getSession(tenantId);
    if (sock) {
      const realJid = await resolveRealJid(sock, phone);
      await sock.sendPresenceUpdate(action, realJid);
    }
  } catch {
    // Falha silenciosa em presença
  }
}

export async function sendBotCatalogImage(params: {
  tenantId: string;
  conversationId: string;
  phone: string;
  imgBuffer: Buffer;
  mimeType: string;
  fileName: string;
  caption?: string;
}): Promise<{ sent: boolean; messageId?: string }> {
  const { tenantId, conversationId, phone, imgBuffer, mimeType, fileName, caption = "" } = params;
  const provider = await resolveTenantActiveProvider(tenantId);
  const persona = getAiPersona(tenantId);
  const botSenderName = `${persona.name} (SDR)`;
  const now = new Date();

  // 1. Persistir a imagem em mediaFiles para que /api/baileys/media?messageId=... funcione no MetaAdapter e na UI (SdrTab + ChatPanel)
  const mediaFileId = `med_bot_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  try {
    await db
      .insert(mediaFiles)
      .values({
        id: mediaFileId,
        tenantId,
        conversationId,
        fileName: fileName || "catalogo.jpg",
        mimeType: mimeType || "image/jpeg",
        fileSize: imgBuffer.length,
        base64Data: imgBuffer.toString("base64"),
        createdAt: now,
      })
      .onConflictDoNothing();
  } catch (err: any) {
    console.warn("[SdrChannelSender] Aviso ao gravar imagem do catálogo em mediaFiles:", err?.message);
  }

  let externalId: string | null = null;
  let botMessageId = `bot-img-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  if (provider === "meta") {
    await sendMetaConversationPresence(tenantId, conversationId, "typing");
    await new Promise((r) => setTimeout(r, 700));

    let recipientUserId: string | undefined;
    try {
      const [conv] = await db
        .select({ contactId: conversations.contactId })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .limit(1);
      if (conv?.contactId) {
        const [cnt] = await db
          .select({ whatsappUserId: contacts.whatsappUserId })
          .from(contacts)
          .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)))
          .limit(1);
        if (cnt?.whatsappUserId) recipientUserId = cnt.whatsappUserId;
      }
    } catch {}

    const sendRes = await metaAdapter.send(tenantId, {
      tenantId,
      conversationId,
      recipientPhone: phone,
      recipientUserId,
      text: caption,
      mediaUrl: `/api/baileys/media?messageId=${mediaFileId}`,
      mediaType: "image",
      fileName: fileName || "catalogo.jpg",
    });

    resetMetaTypingThrottle(tenantId, conversationId);

    if (sendRes.status === "failed") {
      console.error(`[SdrChannelSender] ❌ Falha ao enviar imagem via Meta (${tenantId}): ${sendRes.error}`);
      return { sent: false };
    }
    externalId = sendRes.externalId || null;
  } else {
    const sock = SessionManager.getInstance().getSession(tenantId);
    const realJid = sock ? await resolveRealJid(sock, phone) : null;
    if (!sock || !realJid) {
      console.warn(`[SdrChannelSender] ⚠️ Sessão Baileys indisponível para envio de imagem (${tenantId}).`);
      return { sent: false };
    }
    await sock.sendPresenceUpdate("composing", realJid);
    await new Promise((r) => setTimeout(r, 700));
    const sentMsg = await sock.sendMessage(realJid, {
      image: imgBuffer,
      mimetype: mimeType,
      caption,
    });
    if (sentMsg?.key?.id) {
      botMessageId = sentMsg.key.id;
      externalId = sentMsg.key.id;
    }
  }

  // 2. Persistir a mensagem de imagem no banco (messages) e notificar UI via SSE
  const contentTag = `[MEDIA:image]${mediaFileId}${caption ? `\n${caption}` : ""}`;
  try {
    await db
      .insert(messages)
      .values({
        id: botMessageId,
        tenantId,
        conversationId,
        senderType: "bot",
        senderName: botSenderName,
        content: contentTag,
        isInternalNote: false,
        direction: "outbound",
        provider,
        externalId,
        status: "sent",
        sentAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    await db
      .update(conversations)
      .set({
        lastMessageText: caption || "📷 Foto enviada",
        lastMessageTime: now,
        updatedAt: now,
      })
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));

    const currentConv = await db.query.conversations.findFirst({
      where: (t, { eq: dEq, and: dAnd }) =>
        dAnd(dEq(t.id, conversationId), dEq(t.tenantId, tenantId)),
    });

    SessionManager.getInstance().notifyPublic(tenantId, {
      type: "message",
      message: {
        id: botMessageId,
        conversationId,
        senderType: "bot",
        senderName: botSenderName,
        content: contentTag,
        mediaUrl: `/api/baileys/media?messageId=${mediaFileId}`,
        mediaType: "image",
        fileName: fileName || "catalogo.jpg",
        sentAt: now,
        queue: currentConv?.queueState || "automacao",
        operatorId: currentConv?.operatorId || null,
      },
    });
  } catch (dbErr: any) {
    console.warn("[SdrChannelSender] Erro ao registrar mensagem de imagem no banco:", dbErr?.message);
  }

  return { sent: true, messageId: botMessageId };
}
