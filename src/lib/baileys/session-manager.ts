import makeWASocket, { 
  DisconnectReason, 
  WASocket, 
  initAuthCreds,
  downloadMediaMessage,
  proto
} from "@whiskeysockets/baileys";
import NodeCache from "node-cache";
import pino from "pino";
import fs from "fs";
import path from "path";
import { useDrizzleAuthState } from "./drizzle-auth";
import { db } from "../../db";
import { channelConfigs, contacts, conversations, messages, mediaFiles } from "../../db/schema";
import { eq } from "drizzle-orm";

export type SessionStatus = "disconnected" | "qr_ready" | "connected";

export type SessionEvent =
  | { type: "qr"; qr: string }
  | { type: "status"; status: SessionStatus; phone?: string }
  | { type: "message"; message: any }
  | { type: "contact_avatar"; contactId: string; phone: string; avatar: string };

export type SessionListener = (event: SessionEvent) => void;

export class SessionManager {
  private static instance: SessionManager;
  private sessions = new Map<string, WASocket>();
  private sessionStatuses = new Map<string, SessionStatus>();
  private sessionQrs = new Map<string, string>();
  private listeners = new Map<string, Set<SessionListener>>();
  // Cache de mensagens para permitir retransmissão (obrigatório para evitar timeouts no sendMessage)
  private msgRetryCounterCaches = new Map<string, NodeCache>();

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

  /** Expõe o notify para uso externo (ex: endpoints de sync) */
  public notifyPublic(tenantId: string, event: SessionEvent) {
    this.notify(tenantId, event);
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

    // Cache de retry de mensagens — necessário para que o WA possa pedir retransmissão
    const msgRetryCounterCache = new NodeCache({ stdTTL: 60, useClones: false });
    this.msgRetryCounterCaches.set(tenantId, msgRetryCounterCache);

    // Inicializar o socket do Baileys
    const makeSocketFn = (makeWASocket as any).default || makeWASocket;
    const sock = makeSocketFn({
      auth: state,
      logger,
      printQRInTerminal: false,
      msgRetryCounterCache,
      // Permite que o Baileys reenvie mensagens quando o WA pede retransmissão (retry)
      getMessage: async (key: proto.IMessageKey) => {
        // Tenta buscar a mensagem do banco para permitir reenvio
        try {
          const stored = await db.query.messages.findFirst({
            where: (t, { eq: dEq }) => dEq(t.id, key.id ?? "")
          });
          if (stored?.content) {
            return { conversation: stored.content } as proto.IMessage;
          }
        } catch (e) {
          // silencia erros de lookup
        }
        return undefined;
      },
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

    const sock = this.sessions.get(tenantId);

    // Extrair informações de resposta (quoted/citar)
    const contextInfo = rawMsg.message?.extendedTextMessage?.contextInfo ||
                        rawMsg.message?.imageMessage?.contextInfo ||
                        rawMsg.message?.videoMessage?.contextInfo ||
                        rawMsg.message?.audioMessage?.contextInfo ||
                        rawMsg.message?.documentMessage?.contextInfo ||
                        rawMsg.message?.stickerMessage?.contextInfo;

    let quotedMessageId: string | null = null;
    let quotedMessageSender: string | null = null;
    let quotedMessageContent: string | null = null;

    if (contextInfo?.quotedMessage) {
      quotedMessageId = contextInfo.stanzaId || null;
      
      const qMsg = contextInfo.quotedMessage;
      quotedMessageContent = qMsg.conversation ||
                             qMsg.extendedTextMessage?.text ||
                             qMsg.imageMessage?.caption ||
                             qMsg.videoMessage?.caption ||
                             (qMsg.imageMessage ? "📷 Foto" : null) ||
                             (qMsg.videoMessage ? "🎥 Vídeo" : null) ||
                             (qMsg.audioMessage ? "🎵 Áudio/Mensagem de voz" : null) ||
                             (qMsg.documentMessage ? "📄 Documento" : null) ||
                             (qMsg.stickerMessage ? "💟 Figurinha" : null) ||
                             "Mensagem";

      if (contextInfo.participant) {
        const cleanParticipant = contextInfo.participant.split("@")[0].split(":")[0];
        const cleanBot = sock?.user?.id.split("@")[0].split(":")[0];
        if (cleanParticipant === cleanBot) {
          quotedMessageSender = "Você";
        } else {
          try {
            const quotedContact = await db.query.contacts.findFirst({
              where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.tenantId, tenantId), dEq(t.phone, cleanParticipant))
            });
            quotedMessageSender = quotedContact ? quotedContact.name : `+${cleanParticipant}`;
          } catch {
            quotedMessageSender = `+${cleanParticipant}`;
          }
        }
      }
    }

    // Se for mídia, tentar fazer o download físico
    if (isMedia) {
      try {
        console.log(`Baixando mídia para a mensagem ${messageId}...`);
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
            let fileName: string | undefined = undefined;
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
              fileName = rawMsg.message.documentMessage.fileName || rawMsg.message.documentMessage.title || "documento";
              text = `[MEDIA:document]${messageId}:${fileName}`;
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

            // Salvar arquivo de mimetype no cache local
            fs.writeFileSync(path.join(mediaDir, `${messageId}.mime`), mime);

            // Persistir a mídia permanentemente no banco de dados (Base64)
            try {
              const base64Data = buffer.toString("base64");
              await db.insert(mediaFiles).values({
                id: messageId,
                fileName: fileName || null,
                mimeType: mime,
                base64Data,
                createdAt: new Date(),
              }).onConflictDoNothing();
              console.log(`Mídia ${messageId} persistida no banco com sucesso!`);
            } catch (dbErr) {
              console.error(`Erro ao salvar mídia no banco ${messageId}:`, dbErr);
            }
            console.log(`Mídia ${messageId} salva com sucesso no disco! Mime: ${mime}`);
          }
        }
      } catch (err) {
        console.error(`Erro ao processar download de mídia da mensagem ${messageId}:`, err);
      }
    }

    console.log(`Mensagem recebida do tenant ${tenantId} de ${name}: ${text}`);

    try {
      // 1. Garantir que o contato existe no banco
      // Busca PRIMEIRO pelo JID exato (mais confiável), depois pelo phone
      let contact = await db.query.contacts.findFirst({
        where: (contactsTable, { eq: dEq, and: dAnd, or: dOr }) =>
          dAnd(
            dEq(contactsTable.tenantId, tenantId),
            dOr(dEq(contactsTable.whatsappJid, jid), dEq(contactsTable.phone, phone))
          )
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
          whatsappJid: jid, // Salva o JID real para envio confiável
          mainChannel: "whatsapp",
          avatar: null,
          tags: [],
          createdAt: new Date(),
        });
      } else if (contact && !contact.whatsappJid) {
        // Atualiza o JID em contatos já existentes que não o tinham
        await db.update(contacts)
          .set({ whatsappJid: jid })
          .where(eq(contacts.id, contactId));
      }

      // Buscar foto de perfil em background (sem await para não atrasar o processamento de mensagens!)
      if (jid && (!contact || !contact.avatar)) {
        const sock = this.sessions.get(tenantId);
        if (sock) {
          // Monta lista de JIDs a tentar em ordem de preferência
          const cleanPhone = phone.replace(/\D/g, "");
          const jidsToTry: string[] = [
            jid,                                          // JID real (pode ser @lid ou @s.whatsapp.net)
            `${cleanPhone}@s.whatsapp.net`,               // phone direto
          ];
          // Se o phone não começa com 55, tenta com DDI
          if (!cleanPhone.startsWith("55") && cleanPhone.length <= 11) {
            jidsToTry.push(`55${cleanPhone}@s.whatsapp.net`);
          }
          // Se começa com 55 (Brasil), tenta a variação com ou sem o 9º dígito
          if (cleanPhone.startsWith("55")) {
            const ddd = cleanPhone.slice(2, 4);
            const rest = cleanPhone.slice(4);
            if (rest.length === 9 && rest.startsWith("9")) {
              // 9-digit -> tenta também o de 8 dígitos
              jidsToTry.push(`55${ddd}${rest.slice(1)}@s.whatsapp.net`);
            } else if (rest.length === 8) {
              // 8-digit -> tenta também o de 9 dígitos
              jidsToTry.push(`55${ddd}9${rest}@s.whatsapp.net`);
            }
          }

          const tryGetPic = async (): Promise<string | undefined> => {
            for (const tryJid of jidsToTry) {
              try {
                const url = await sock.profilePictureUrl(tryJid, "preview")
                  .catch(() => sock.profilePictureUrl(tryJid, "image"));
                if (url) {
                  console.log(`[Baileys] Foto obtida para ${phone} via JID: ${tryJid}`);
                  return url;
                }
              } catch { /* tenta próximo */ }
            }
            return undefined;
          };

          tryGetPic().then((picUrl) => {
            if (picUrl) {
              db.update(contacts)
                .set({ avatar: picUrl })
                .where(eq(contacts.id, contactId))
                .then(() => {
                  this.notify(tenantId, {
                    type: "contact_avatar",
                    contactId: contactId,
                    phone: phone,
                    avatar: picUrl,
                  });
                })
                .catch((err) => console.error("Erro ao salvar foto de perfil no DB:", err));
            } else {
              console.log(`[Baileys] Foto não disponível para ${phone} (todos os JIDs tentados)`);
            }
          }).catch(() => {});
        }
      }

      // 2. Garantir que a conversa existe no banco
      let conversation = await db.query.conversations.findFirst({
        where: (convsTable, { eq: dEq, and: dAnd }) => 
          dAnd(dEq(convsTable.tenantId, tenantId), dEq(convsTable.contactId, contactId))
      });

      const convId = conversation?.id || `conv-${Date.now()}`;
      const isFromMe = !!rawMsg.key.fromMe;

      // Se a mensagem veio do próprio operador/WhatsApp conectado (fromMe), zera as mensagens não lidas.
      // Se veio do cliente, incrementa as não lidas.
      const unreadCount = isFromMe ? 0 : (conversation ? conversation.unreadCount + 1 : 1);

      // Regra de reabertura automática de filas:
      // - Se o cliente mandar mensagem e a conversa estava finalizada, reabre para a fila geral de espera
      // - Se o operador mandar mensagem e a conversa estava na fila, captura para 'meus'
      let targetQueue = conversation?.queueState || "fila";
      if (!isFromMe && conversation?.queueState === "finalizados") {
        targetQueue = "fila";
      } else if (isFromMe && conversation?.queueState === "fila") {
        targetQueue = "meus";
      }

      if (!conversation) {
        // Criar conversa
        await db.insert(conversations).values({
          id: convId,
          tenantId,
          contactId,
          queueState: isFromMe ? "meus" : "fila", // Se iniciamos contato, move para a fila do operador
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
            queueState: targetQueue,
          })
          .where(eq(conversations.id, convId));
      }

      const finalSenderType = isFromMe ? "agent" : "client";
      const finalSenderName = isFromMe ? "Operador" : name;

      // 3. Salvar a mensagem (onConflictDoNothing evita erro de chave duplicada
      // quando o WA entrega a mesma mensagem mais de uma vez)
      await db.insert(messages).values({
        id: messageId,
        tenantId,
        conversationId: convId,
        senderType: finalSenderType,
        senderName: finalSenderName,
        content: text,
        isInternalNote: false,
        quotedMessageId,
        quotedMessageSender,
        quotedMessageContent,
        sentAt: new Date(),
      }).onConflictDoNothing();

      // 4. Notificar a UI via evento SSE
      this.notify(tenantId, {
        type: "message",
        message: {
          id: messageId,
          conversationId: convId,
          senderType: finalSenderType,
          senderName: finalSenderName,
          content: text,
          phone: phone, // Enviar o telefone real extraído do JID para o frontend
          avatar: isFromMe ? null : (profilePicUrl || null), // O avatar no SSE é do contato se for do cliente
          sentAt: new Date(),
          quotedMessageId,
          quotedMessageSender,
          quotedMessageContent,
        }
      });

    } catch (e) {
      console.error(`Erro ao salvar mensagem recebida do Baileys no DB:`, e);
    }
  }
}

/**
 * Resolve o JID real registrado no WhatsApp para um dado telefone.
 * Lida com o problema de 8 vs 9 dígitos no Brasil usando o método sock.onWhatsApp.
 */
export async function resolveRealJid(sock: any, phone: string, fallbackJid?: string): Promise<string> {
  const cleanPhone = phone.replace(/\D/g, "");
  if (!cleanPhone) return fallbackJid || `${phone}@s.whatsapp.net`;

  const numbersToTry: string[] = [];

  // Se já tiver um fallbackJid, tenta extrair o número
  if (fallbackJid) {
    const fallbackNum = fallbackJid.split("@")[0];
    if (fallbackNum) numbersToTry.push(fallbackNum);
  }

  // Adiciona o telefone limpo
  numbersToTry.push(cleanPhone);

  // Tratamento específico para números do Brasil (DDI 55)
  if (cleanPhone.startsWith("55")) {
    const ddd = cleanPhone.slice(2, 4);
    const rest = cleanPhone.slice(4);

    if (rest.length === 9 && rest.startsWith("9")) {
      // É formato de 9 dígitos. Tenta também o de 8 dígitos.
      const eightDigit = `55${ddd}${rest.slice(1)}`;
      numbersToTry.push(eightDigit);
    } else if (rest.length === 8) {
      // É formato de 8 dígitos. Tenta também o de 9 dígitos.
      const nineDigit = `55${ddd}9${rest}`;
      numbersToTry.push(nineDigit);
    }
  } else {
    // Se não tem DDI 55, mas parece brasileiro (10 ou 11 dígitos)
    if (cleanPhone.length === 11 && cleanPhone.startsWith("9")) {
      const withDdi = `55${cleanPhone}`;
      numbersToTry.push(withDdi);
      const ddd = cleanPhone.slice(0, 2);
      const rest = cleanPhone.slice(2);
      const eightDigit = `55${ddd}${rest.slice(1)}`;
      numbersToTry.push(eightDigit);
    } else if (cleanPhone.length === 10) {
      const withDdi = `55${cleanPhone}`;
      numbersToTry.push(withDdi);
      const ddd = cleanPhone.slice(0, 2);
      const rest = cleanPhone.slice(2);
      const nineDigit = `55${ddd}9${rest}`;
      numbersToTry.push(nineDigit);
    } else if (cleanPhone.length === 11) {
      numbersToTry.push(`55${cleanPhone}`);
    }
  }

  // Remove duplicados mantendo a ordem
  const uniqueNumbers = Array.from(new Set(numbersToTry));

  // Tenta consultar no WhatsApp qual número existe e obter seu JID correto
  for (const num of uniqueNumbers) {
    try {
      const results = await sock.onWhatsApp(num);
      if (results && results.length > 0) {
        const res = results[0];
        if (res && res.exists && res.jid) {
          console.log(`[JID Resolver] JID real resolvido para ${phone}: ${res.jid}`);
          return res.jid;
        }
      }
    } catch (err: any) {
      console.log(`[JID Resolver] Falha ao consultar onWhatsApp para ${num}:`, err.message);
    }
  }

  // Se nada funcionou, retorna o fallback ou constrói o JID padrão
  if (fallbackJid) return fallbackJid;
  return cleanPhone.startsWith("55") ? `${cleanPhone}@s.whatsapp.net` : `55${cleanPhone}@s.whatsapp.net`;
}
