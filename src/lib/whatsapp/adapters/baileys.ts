import { WhatsAppAdapter, UniversalOutboundMessage, DeliveryStatus, ChannelSettings } from "../types";
import { SessionManager, resolveRealJid } from "../../baileys/session-manager";
import { db } from "../../../db";
import { contacts, conversations, mediaFiles } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { convertAudioToOggOpus, metaAudioNeedsConversion } from "../audio-convert";

export class BaileysAdapter implements WhatsAppAdapter {
  readonly provider = "baileys" as const;

  async send(tenantId: string, message: UniversalOutboundMessage): Promise<{
    externalId: string;
    status: DeliveryStatus;
    error?: string;
  }> {
    try {
      const sessionManager = SessionManager.getInstance();
      const sock = sessionManager.getSession(tenantId);

      if (!sock || sessionManager.getStatus(tenantId) !== "connected") {
        return {
          externalId: "",
          status: "failed",
          error: `WhatsApp Baileys não conectado para o tenant '${tenantId}'`,
        };
      }

      // 1. Obter JID resolvido do WhatsApp
      let jid: string | null = null;
      if (message.conversationId) {
        const [conv] = await db
          .select({ contactId: conversations.contactId })
          .from(conversations)
          .where(and(eq(conversations.id, message.conversationId), eq(conversations.tenantId, tenantId)));

        if (conv?.contactId) {
          const [contact] = await db
            .select({ whatsappJid: contacts.whatsappJid })
            .from(contacts)
            .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)));

          if (contact?.whatsappJid) {
            jid = contact.whatsappJid;
          }
        }
      }

      if (!jid) {
        const cleanPhone = message.recipientPhone.replace(/\D/g, "");
        if (!cleanPhone) {
          return { externalId: "", status: "failed", error: "Telefone de destino inválido" };
        }
        jid = await resolveRealJid(sock, cleanPhone);
      }

      // 2. Opções de Citação
      const options: any = {};
      if (message.quotedMessageId) {
        options.quoted = {
          key: {
            id: message.quotedMessageId,
            remoteJid: jid,
            fromMe: false,
          },
          message: {
            conversation: "Mensagem anterior",
          },
        };
      }

      // 3. Envio de Mídia ou Texto com retry em rate-overlimit
      let sentMsg: any;
      let lastErr: any;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (message.mediaUrl && message.mediaType) {
            // Envio com mídia
            const caption = message.text || undefined;

            // Se a mediaUrl for local (/api/baileys/media?messageId=...) ou tiver cache em disco, envia direto o Buffer
            let mediaBuffer: Buffer | null = null;
            let mimeType = "application/octet-stream";
            try {
              const urlMatch = message.mediaUrl.match(/messageId=([^&]+)/);
              const messageId = urlMatch ? urlMatch[1] : (message.mediaUrl.startsWith("media-") ? message.mediaUrl : null);
              if (messageId) {
                const localPath = path.join(process.cwd(), "media", messageId);
                const mimePath = path.join(process.cwd(), "media", `${messageId}.mime`);
                if (fs.existsSync(localPath)) {
                  mediaBuffer = fs.readFileSync(localPath);
                  if (fs.existsSync(mimePath)) mimeType = fs.readFileSync(mimePath, "utf-8").trim();
                } else {
                  // Fallback para o banco
                  const [record] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, messageId));
                  if (record?.base64Data) {
                    mediaBuffer = Buffer.from(record.base64Data, "base64");
                    mimeType = record.mimeType;
                  }
                }
              }
            } catch (bufErr) {
              console.warn("[BaileysAdapter] Não foi possível obter buffer local da mídia:", bufErr);
            }

            const mediaSource = mediaBuffer || { url: message.mediaUrl };

            if (message.mediaType === "image") {
              sentMsg = await sock.sendMessage(jid, { image: mediaSource, caption }, options);
            } else if (message.mediaType === "audio") {
              let audioBuffer = mediaBuffer;
              let audioMime = mimeType;
              if (audioBuffer && (metaAudioNeedsConversion(audioMime) || audioMime.includes("webm"))) {
                try {
                  audioBuffer = await convertAudioToOggOpus(audioBuffer);
                  audioMime = "audio/ogg; codecs=opus";
                  console.log(`[BaileysAdapter] Áudio convertido com sucesso para OGG/Opus (${audioBuffer.length} bytes)`);
                } catch (convErr) {
                  console.warn("[BaileysAdapter] Falha ao converter áudio para OGG/Opus:", convErr);
                }
              }
              const finalMime = audioMime.includes("ogg")
                ? "audio/ogg; codecs=opus"
                : audioMime.startsWith("audio/") ? audioMime : "audio/ogg; codecs=opus";
              sentMsg = await sock.sendMessage(jid, { audio: audioBuffer || mediaSource, mimetype: finalMime, ptt: true }, options);
            } else if (message.mediaType === "video") {
              sentMsg = await sock.sendMessage(jid, { video: mediaSource, caption }, options);
            } else {
              sentMsg = await sock.sendMessage(
                jid,
                {
                  document: mediaSource,
                  mimetype: mimeType,
                  fileName: message.fileName || "documento",
                  caption,
                },
                options
              );
            }
          } else if (message.text) {
            // Envio de texto puro
            sentMsg = await sock.sendMessage(jid, { text: message.text }, options);
          } else {
            return { externalId: "", status: "failed", error: "Conteúdo da mensagem vazio" };
          }

          lastErr = null;
          break; // Sucesso
        } catch (sendErr: any) {
          lastErr = sendErr;
          if (sendErr?.message?.includes("rate-overlimit") && attempt < 2) {
            const delay = (attempt + 1) * 2000;
            console.warn(`[BaileysAdapter] rate-overlimit no tenant '${tenantId}' — aguardando ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
          } else {
            break;
          }
        }
      }

      if (lastErr) throw lastErr;

      const externalId = sentMsg?.key?.id || `baileys-${Date.now()}`;
      return {
        externalId,
        status: "accepted",
      };
    } catch (err: any) {
      console.error(`[BaileysAdapter] Falha ao enviar mensagem no tenant '${tenantId}':`, err);
      return {
        externalId: "",
        status: "failed",
        error: err.message || "Erro durante o envio pelo Baileys",
      };
    }
  }

  async getStatus(tenantId: string): Promise<{
    status: "disconnected" | "connecting" | "connected" | "qr_ready" | "error";
    phone?: string;
    details?: any;
  }> {
    const sessionManager = SessionManager.getInstance();
    const rawStatus = sessionManager.getStatus(tenantId);
    let mappedStatus: "disconnected" | "connecting" | "connected" | "qr_ready" | "error" = "disconnected";

    if (rawStatus === "connected") mappedStatus = "connected";
    else if (rawStatus === "qr_ready") mappedStatus = "qr_ready";
    else mappedStatus = "disconnected";

    return {
      status: mappedStatus,
    };
  }

  /**
   * Pausa a conexão socket sem apagar credenciais nem efetuar logout no WhatsApp.
   */
  async pause(tenantId: string): Promise<void> {
    const sessionManager = SessionManager.getInstance();
    await sessionManager.pauseSession(tenantId);
  }

  /**
   * Desconecta permanentemente e desvincula as chaves de sessão.
   */
  async disconnect(tenantId: string): Promise<void> {
    const sessionManager = SessionManager.getInstance();
    await sessionManager.disconnectSession(tenantId);
  }

  /**
   * Envia ou remove uma reação no WhatsApp via Baileys.
   */
  async sendReaction(
    tenantId: string,
    jid: string,
    targetExternalId: string,
    isFromMe: boolean,
    emoji: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const sessionManager = SessionManager.getInstance();
      const sock = sessionManager.getSession(tenantId);
      if (!sock || sessionManager.getStatus(tenantId) !== "connected") {
        return { success: false, error: "WhatsApp Baileys não conectado" };
      }

      const cleanExternalId = targetExternalId.replace(/^meta:[^:]+:/, "").trim();

      const key = {
        remoteJid: jid,
        id: cleanExternalId,
        fromMe: isFromMe,
      };

      await sock.sendMessage(jid, {
        react: {
          text: emoji ? emoji.trim() : "",
          key,
        },
      });

      return { success: true };
    } catch (err: any) {
      console.error(`[BaileysAdapter.sendReaction] Erro:`, err);
      return { success: false, error: err?.message || "Falha ao enviar reação no Baileys" };
    }
  }
}

export const baileysAdapter = new BaileysAdapter();
