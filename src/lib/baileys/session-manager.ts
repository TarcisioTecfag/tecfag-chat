import makeWASocket, { 
  DisconnectReason, 
  WASocket, 
  initAuthCreds,
  downloadMediaMessage
} from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import path from "path";
import { useDrizzleAuthState } from "./drizzle-auth";
import { db } from "../../db";
import { channelConfigs, contacts, conversations, messages } from "../../db/schema";
import { eq } from "drizzle-orm";

export type SessionStatus = "disconnected" | "qr_ready" | "connected";

export type SessionEvent =
  | { type: "qr"; qr: string }
  | { type: "status"; status: SessionStatus; phone?: string }
  | { type: "message"; message: any };

export type SessionListener = (event: SessionEvent) => void;

export class SessionManager {
  private static instance: SessionManager;
  private sessions = new Map<string, WASocket>();
  private sessionStatuses = new Map<string, SessionStatus>();
  private sessionQrs = new Map<string, string>();
  private listeners = new Map<string, Set<SessionListener>>();

  private constructor() {}

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  public registerListener(tenantId: string, listener: SessionListener) {
    if (!this.listeners.has(tenantId)) {
      this.listeners.set(tenantId, new Set());
    }
    this.listeners.get(tenantId)!.add(listener);

    // Enviar status atual imediatamente
    const status = this.sessionStatuses.get(tenantId) || "disconnected";
    listener({ type: "status", status, phone: undefined });
    
    // Se tiver QR code guardado, enviar imediatamente
    const qr = this.sessionQrs.get(tenantId);
    if (qr && status === "qr_ready") {
      listener({ type: "qr", qr });
    }
  }

  public unregisterListener(tenantId: string, listener: SessionListener) {
    const tenantListeners = this.listeners.get(tenantId);
    if (tenantListeners) {
      tenantListeners.delete(listener);
    }
  }

  private notify(tenantId: string, event: SessionEvent) {
    const tenantListeners = this.listeners.get(tenantId);
    if (tenantListeners) {
      for (const listener of tenantListeners) {
        try {
          listener(event);
        } catch (e) {
          console.error(`Erro no listener do tenant ${tenantId}:`, e);
        }
      }
    }
  }

  public getStatus(tenantId: string): SessionStatus {
    return this.sessionStatuses.get(tenantId) || "disconnected";
  }

  public getQr(tenantId: string): string | undefined {
    return this.sessionQrs.get(tenantId);
  }

  public async initSession(tenantId: string): Promise<WASocket> {
    if (this.sessions.has(tenantId)) {
      return this.sessions.get(tenantId)!;
    }

    console.log(`Iniciando sessão do Baileys para o tenant: ${tenantId}`);
    this.sessionStatuses.set(tenantId, "disconnected");
    this.notify(tenantId, { type: "status", status: "disconnected" });

    // Criar logger silencioso para o Baileys
    const logger = pino({ level: "info" });

    // Obter estado de autenticação baseado no Drizzle
    const { state, saveCreds } = await useDrizzleAuthState(tenantId);

    // Inicializar o socket do Baileys
    const makeSocketFn = (makeWASocket as any).default || makeWASocket;
    const sock = makeSocketFn({
      auth: state,
      logger,
      printQRInTerminal: true,
    });

    this.sessions.set(tenantId, sock);

    // Salvar credenciais quando atualizadas
    sock.ev.on("creds.update", saveCreds);

    // Tratar eventos de conexão
    sock.ev.on("connection.update", async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`QR Code gerado para o tenant ${tenantId}`);
        this.sessionStatuses.set(tenantId, "qr_ready");
        this.sessionQrs.set(tenantId, qr);
        this.notify(tenantId, { type: "status", status: "qr_ready" });
        this.notify(tenantId, { type: "qr", qr });

        // Salvar status no banco
        try {
          await db
            .update(channelConfigs)
            .set({ baileysSessionStatus: "qr_ready", updatedAt: new Date() })
            .where(eq(channelConfigs.tenantId, tenantId));
        } catch (e) {
          console.error("Erro ao atualizar status do QR no DB:", e);
        }
      }

      if (connection === "close") {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`Conexão do tenant ${tenantId} fechada devido a:`, lastDisconnect?.error, `. Tentando reconectar: ${shouldReconnect}`);
        
        this.sessions.delete(tenantId);
        this.sessionStatuses.set(tenantId, "disconnected");
        this.sessionQrs.delete(tenantId);
        this.notify(tenantId, { type: "status", status: "disconnected" });

        // Salvar status no banco
        try {
          await db
            .update(channelConfigs)
            .set({ 
              baileysSessionStatus: "disconnected", 
              baileysPairedPhone: null,
              updatedAt: new Date() 
            })
            .where(eq(channelConfigs.tenantId, tenantId));
        } catch (e) {
          console.error("Erro ao atualizar status de desconectado no DB:", e);
        }

        if (shouldReconnect) {
          // Tentar reconectar em 5 segundos
          setTimeout(() => this.initSession(tenantId), 5000);
        }
      } else if (connection === "open") {
        console.log(`Conexão do tenant ${tenantId} estabelecida com sucesso!`);
        const phone = sock.user?.id.split(":")[0];
        
        this.sessionStatuses.set(tenantId, "connected");
        this.sessionQrs.delete(tenantId);
        this.notify(tenantId, { type: "status", status: "connected", phone });

        // Salvar status e telefone no banco
        try {
          await db
            .update(channelConfigs)
            .set({ 
              baileysSessionStatus: "connected", 
              baileysPairedPhone: phone,
              updatedAt: new Date() 
            })
            .where(eq(channelConfigs.tenantId, tenantId));
        } catch (e) {
          console.error("Erro ao atualizar status de conectado no DB:", e);
        }
      }
    });

    // Tratar eventos de mensagens recebidas
    sock.ev.on("messages.upsert", async (m: any) => {
      if (m.type === "notify") {
        for (const msg of m.messages) {
          if (!msg.key.fromMe && msg.message) {
            // Processar a mensagem recebida e salvar no banco
            await this.handleIncomingMessage(tenantId, msg);
          }
        }
      }
    });

    return sock;
  }

  public async disconnectSession(tenantId: string) {
    const sock = this.sessions.get(tenantId);
    if (sock) {
      try {
        await sock.logout();
      } catch (e) {
        console.error("Erro ao dar logout no socket:", e);
      }
      try {
        sock.end(undefined);
      } catch (e) {
        console.error("Erro ao fechar conexão:", e);
      }
      this.sessions.delete(tenantId);
    }

    this.sessionStatuses.set(tenantId, "disconnected");
    this.sessionQrs.delete(tenantId);
    this.notify(tenantId, { type: "status", status: "disconnected" });

    // Atualizar no banco e deletar chaves
    try {
      await db
        .update(channelConfigs)
        .set({ 
          baileysSessionStatus: "disconnected", 
          baileysPairedPhone: null,
          baileysAuthKeys: null,
          updatedAt: new Date() 
        })
        .where(eq(channelConfigs.tenantId, tenantId));
    } catch (e) {
      console.error("Erro ao limpar dados de sessão no DB:", e);
    }
  }

  public getSession(tenantId: string): WASocket | undefined {
    return this.sessions.get(tenantId);
  }

  private async handleIncomingMessage(tenantId: string, rawMsg: any) {
    const jid = rawMsg.key.remoteJid;
    if (!jid) return;
    const phone = jid.split("@")[0];
    const name = rawMsg.pushName || `Cliente (${phone})`;
    const messageId = rawMsg.key.id || `msg-${Date.now()}`;

    // Criar a pasta media se não existir
    const mediaDir = path.join(process.cwd(), "media");
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    const messageType = Object.keys(rawMsg.message || {})[0];
    const isMedia = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(messageType) ||
                    rawMsg.message?.viewOnceMessage?.message?.imageMessage ||
                    rawMsg.message?.viewOnceMessage?.message?.videoMessage ||
                    rawMsg.message?.viewOnceMessageV2?.message?.imageMessage ||
                    rawMsg.message?.viewOnceMessageV2?.message?.videoMessage;

    // Obter texto representativo da mensagem (incluindo tratamento de mídias como áudio, imagem e vídeo)
    let text = "[Mídia/Outro]";
    if (rawMsg.message) {
      if (rawMsg.message.conversation) {
        text = rawMsg.message.conversation;
      } else if (rawMsg.message.extendedTextMessage?.text) {
        text = rawMsg.message.extendedTextMessage.text;
      } else if (rawMsg.message.imageMessage) {
        text = "📷 Foto";
      } else if (rawMsg.message.videoMessage) {
        text = "🎥 Vídeo";
      } else if (rawMsg.message.audioMessage) {
        text = "🎵 Áudio/Mensagem de voz";
      } else if (rawMsg.message.documentMessage) {
        const docTitle = rawMsg.message.documentMessage.fileName || rawMsg.message.documentMessage.title || "Documento";
        text = `📄 Documento: ${docTitle}`;
      } else if (rawMsg.message.stickerMessage) {
        text = "💟 Figurinha";
      } else if (rawMsg.message.viewOnceMessage?.message?.imageMessage || rawMsg.message.viewOnceMessageV2?.message?.imageMessage) {
        text = "📷 Foto (Visualização única)";
      } else if (rawMsg.message.viewOnceMessage?.message?.videoMessage || rawMsg.message.viewOnceMessageV2?.message?.videoMessage) {
        text = "🎥 Vídeo (Visualização única)";
      }
    }

    // Se for mídia, tentar fazer o download físico
    if (isMedia) {
      try {
        console.log(`Baixando mídia para a mensagem ${messageId}...`);
        const sock = this.sessions.get(tenantId);
        if (sock) {
          const buffer = await downloadMediaMessage(
            rawMsg,
            "buffer",
            {},
            { 
              logger: pino({ level: "silent" }), 
              reuploadRequest: sock.updateMediaMessage 
            }
          );

          if (buffer) {
            // Salvar os bytes da mídia
            fs.writeFileSync(path.join(mediaDir, messageId), buffer);

            // Identificar mimetype e formatar tag de mídia
            let mime = "application/octet-stream";
            if (rawMsg.message.imageMessage) {
              mime = rawMsg.message.imageMessage.mimetype || "image/jpeg";
              text = `[MEDIA:image]${messageId}`;
            } else if (rawMsg.message.videoMessage) {
              mime = rawMsg.message.videoMessage.mimetype || "video/mp4";
              text = `[MEDIA:video]${messageId}`;
            } else if (rawMsg.message.audioMessage) {
              mime = rawMsg.message.audioMessage.mimetype || "audio/ogg";
              text = `[MEDIA:audio]${messageId}`;
            } else if (rawMsg.message.documentMessage) {
              mime = rawMsg.message.documentMessage.mimetype || "application/octet-stream";
              const docTitle = rawMsg.message.documentMessage.fileName || rawMsg.message.documentMessage.title || "documento";
              text = `[MEDIA:document]${messageId}:${docTitle}`;
            } else if (rawMsg.message.stickerMessage) {
              mime = rawMsg.message.stickerMessage.mimetype || "image/webp";
              text = `[MEDIA:sticker]${messageId}`;
            } else {
              const viewOnceMsg = rawMsg.message.viewOnceMessage?.message || rawMsg.message.viewOnceMessageV2?.message;
              if (viewOnceMsg?.imageMessage) {
                mime = viewOnceMsg.imageMessage.mimetype || "image/jpeg";
                text = `[MEDIA:image]${messageId}`;
              } else if (viewOnceMsg?.videoMessage) {
                mime = viewOnceMsg.videoMessage.mimetype || "video/mp4";
                text = `[MEDIA:video]${messageId}`;
              }
            }

            // Salvar arquivo de mimetype
            fs.writeFileSync(path.join(mediaDir, `${messageId}.mime`), mime);
            console.log(`Mídia ${messageId} salva com sucesso! Mime: ${mime}`);
          }
        }
      } catch (err) {
        console.error(`Erro ao processar download de mídia da mensagem ${messageId}:`, err);
      }
    }

    console.log(`Mensagem recebida do tenant ${tenantId} de ${name}: ${text}`);

    try {
      // 1. Garantir que o contato existe no banco
      let contact = await db.query.contacts.findFirst({
        where: (contactsTable, { eq: dEq, and: dAnd }) => 
          dAnd(dEq(contactsTable.tenantId, tenantId), dEq(contactsTable.phone, phone))
      });

      const contactId = contact?.id || `c-${Date.now()}`;
      const profilePicUrl = contact?.avatar || "";

      if (!contact) {
        // Criar contato se não existir (inicialmente sem foto para velocidade máxima)
        await db.insert(contacts).values({
          id: contactId,
          tenantId,
          name,
          phone,
          mainChannel: "whatsapp",
          avatar: null,
          tags: [],
          createdAt: new Date(),
        });
      }

      // Buscar foto de perfil em background (sem await para não atrasar o processamento de mensagens!)
      if (jid && (!contact || !contact.avatar)) {
        const sock = this.sessions.get(tenantId);
        if (sock) {
          // Tenta obter o preview. Se falhar (ex: bloqueios ou ausência do preview), tenta a imagem em alta resolução.
          sock.profilePictureUrl(jid, "preview")
            .catch(() => sock.profilePictureUrl(jid, "image"))
            .then((picUrl) => {
              if (picUrl) {
                db.update(contacts)
                  .set({ avatar: picUrl })
                  .where(eq(contacts.id, contactId))
                  .then(() => {
                    console.log(`[Baileys] Foto de perfil obtida em background para ${phone}`);
                    // Envia um evento SSE de atualização de avatar
                    this.notify(tenantId, {
                      type: "contact_avatar",
                      contactId: contactId,
                      phone: phone,
                      avatar: picUrl,
                    });
                  })
                  .catch((err) => console.error("Erro ao salvar foto de perfil no DB:", err));
              }
            })
            .catch((err) => {
              // Silencia erros normais de privacidade/foto bloqueada
              console.log(`[Baileys] Foto de perfil não disponível para ${phone}:`, err.message);
            });
        }
      }

      // 2. Garantir que a conversa existe no banco
      let conversation = await db.query.conversations.findFirst({
        where: (convsTable, { eq: dEq, and: dAnd }) => 
          dAnd(dEq(convsTable.tenantId, tenantId), dEq(convsTable.contactId, contactId))
      });

      const convId = conversation?.id || `conv-${Date.now()}`;
      const unreadCount = conversation ? conversation.unreadCount + 1 : 1;

      if (!conversation) {
        // Criar conversa
        await db.insert(conversations).values({
          id: convId,
          tenantId,
          contactId,
          queueState: "fila",
          unreadCount,
          lastMessageText: text,
          lastMessageTime: new Date(),
          createdAt: new Date(),
        });
      } else {
        // Atualizar conversa
        await db
          .update(conversations)
          .set({
            unreadCount,
            lastMessageText: text,
            lastMessageTime: new Date(),
          })
          .where(eq(conversations.id, convId));
      }

      // 3. Salvar a mensagem
      await db.insert(messages).values({
        id: messageId,
        tenantId,
        conversationId: convId,
        senderType: "client",
        senderName: name,
        content: text,
        isInternalNote: false,
        sentAt: new Date(),
      });

      // 4. Notificar a UI via evento
      this.notify(tenantId, {
        type: "message",
        message: {
          id: messageId,
          conversationId: convId,
          senderType: "client",
          senderName: name,
          content: text,
          phone: phone, // Enviar o telefone real extraído do JID para o frontend
          avatar: profilePicUrl || null, // Enviar o avatar do contato no SSE
          sentAt: new Date(),
        }
      });

    } catch (e) {
      console.error(`Erro ao salvar mensagem recebida do Baileys no DB:`, e);
    }
  }
}
