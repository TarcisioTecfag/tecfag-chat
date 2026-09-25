import { WhatsAppAdapter, UniversalOutboundMessage, DeliveryStatus, ChannelSettings } from "../types";
import { SessionManager, resolveRealJid } from "../../baileys/session-manager";
import { db } from "../../../db";
import { contacts, conversations } from "../../../db/schema";
import { eq, and } from "drizzle-orm";

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
            if (message.mediaType === "image") {
              sentMsg = await sock.sendMessage(jid, { image: { url: message.mediaUrl }, caption }, options);
            } else if (message.mediaType === "audio") {
              sentMsg = await sock.sendMessage(jid, { audio: { url: message.mediaUrl }, mimetype: "audio/mp4", ptt: true }, options);
            } else if (message.mediaType === "video") {
              sentMsg = await sock.sendMessage(jid, { video: { url: message.mediaUrl }, caption }, options);
            } else {
              sentMsg = await sock.sendMessage(
                jid,
                {
                  document: { url: message.mediaUrl },
                  mimetype: "application/octet-stream",
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

  async disconnect(tenantId: string): Promise<void> {
    const sessionManager = SessionManager.getInstance();
    await sessionManager.disconnectSession(tenantId);
  }
}

export const baileysAdapter = new BaileysAdapter();
