// ══════════════════════════════════════════════════════════════════════════════
// 🔌 LIVECHAT WEBSOCKET — Servidor de mensageria em tempo real
// Endpoint: /ws/livechat
// Auth: ?tenantId=valem&cookieId=XXXXXXXX (identificador do visitante)
//       ?tenantId=valem&operatorToken=JWT (para painel de operador)
// Integração: LiveChatDebouncer (Acúmulo + Stop & Restart + Fragmentação)
// ══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import {
  upsertVisitor,
  updateVisitorData,
  getOrCreateActiveChat,
  updateChatStatus,
  saveMessage,
  getChatHistory,
  recordPageview,
  getActiveVisitors,
  getVisitorPageviews,
} from "./livechatStorage";
import { generateProactiveGreeting, isNoise } from "./livechatAI";
import { bridgeLiveChatToWhatsApp } from "./livechat-bridge";
import { calculateIntentScore, scoreToTemperature, isAtacadoQualificado } from "./livechatScoring";
import { searchProducts, extractSearchTermFromUrl } from "./trayCatalogService";
import { LiveChatDebouncer } from "./livechatDebouncer";

const uuid = () => crypto.randomUUID();

// ── Tipos de eventos ──────────────────────────────────────────────────────────

type ClientType = "visitor" | "operator";

interface LcConnection {
  ws: WebSocket;
  type: ClientType;
  tenantId: string;
  visitorId?: string;   // para visitors
  chatId?: string;      // chat ativo
  operatorId?: string;  // para operators
}

// Mapas de conexões ativas
const visitorConnections = new Map<string, LcConnection>();  // key: visitorId
const operatorConnections = new Map<string, LcConnection>(); // key: operatorId

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToOperators(tenantId: string, event: unknown) {
  for (const conn of operatorConnections.values()) {
    if (conn.tenantId === tenantId) {
      send(conn.ws, event);
    }
  }
}

// ── Setup do WebSocket Server ─────────────────────────────────────────────────

export function setupLiveChatWebSocket(wss: WebSocketServer) {
  console.log("[LC WS] Servidor WebSocket Live Chat inicializado em /ws/livechat");

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "/", "http://localhost");
    const tenantId = url.searchParams.get("tenantId") || "";
    const cookieId = url.searchParams.get("cookieId") || "";
    const operatorToken = url.searchParams.get("operatorToken") || "";
    const currentUrl = url.searchParams.get("currentUrl") || "";
    const currentTitle = url.searchParams.get("currentTitle") || "";

    if (!tenantId) {
      ws.close(1008, "tenantId obrigatório");
      return;
    }

    // ── Conexão de OPERADOR ────────────────────────────────────────────────
    if (operatorToken) {
      const operatorId = `op_${operatorToken.slice(0, 8)}`;
      const conn: LcConnection = { ws, type: "operator", tenantId, operatorId };
      operatorConnections.set(operatorId, conn);

      console.log(`[LC WS] Operador ${operatorId} conectado (tenant: ${tenantId})`);

      // Envia snapshot dos visitantes ativos
      try {
        const visitors = await getActiveVisitors(tenantId);
        send(ws, { type: "visitors_snapshot", visitors });
      } catch (e) {
        console.error("[LC WS] Erro ao carregar visitantes:", e);
      }

      ws.on("message", (data) => handleOperatorMessage(conn, data.toString()));
      ws.on("close", () => {
        operatorConnections.delete(operatorId);
        console.log(`[LC WS] Operador ${operatorId} desconectado`);
      });
      return;
    }

    // ── Conexão de VISITANTE ───────────────────────────────────────────────
    if (!cookieId) {
      ws.close(1008, "cookieId obrigatório para visitante");
      return;
    }

    let visitor: any;
    let chat: any;

    try {
      // Cria/atualiza visitante
      visitor = await upsertVisitor(tenantId, cookieId, {
        currentUrl: currentUrl || undefined,
        currentTitle: currentTitle || undefined,
        ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
                   req.socket.remoteAddress,
        userAgent: req.headers["user-agent"] || undefined,
      });

      // Cria/recupera chat ativo
      chat = await getOrCreateActiveChat(tenantId, visitor.id);

      // Registra pageview de entrada
      if (currentUrl) {
        await recordPageview(tenantId, visitor.id, currentUrl, currentTitle);
      }
    } catch (e: any) {
      console.error("[LC WS] Erro ao criar visitante:", e?.message);
      ws.close(1011, "Erro interno");
      return;
    }

    const conn: LcConnection = {
      ws,
      type: "visitor",
      tenantId,
      visitorId: visitor.id,
      chatId: chat.id,
    };
    visitorConnections.set(visitor.id, conn);

    console.log(`[LC WS] Visitante ${visitor.id} conectado (tenant: ${tenantId})`);

    // Envia histórico do chat atual
    try {
      const history = await getChatHistory(tenantId, chat.id, 30);
      send(ws, { type: "chat_history", chatId: chat.id, messages: history });
    } catch (e) {
      console.error("[LC WS] Erro ao carregar histórico:", e);
    }

    // Notifica operadores do novo visitante
    broadcastToOperators(tenantId, {
      type: "visitor_connected",
      visitor,
      chatId: chat.id,
    });

    // Saudação proativa
    if (!chat.status || chat.status === "active") {
      const historyCount = (await getChatHistory(tenantId, chat.id, 1)).length;
      if (historyCount === 0) {
        setTimeout(async () => {
          try {
            const greeting = await generateProactiveGreeting(
              tenantId,
              currentUrl,
              currentTitle
            );
            await saveMessage(tenantId, chat.id, "ai", greeting);
            send(ws, { type: "message", chatId: chat.id, sender: "ai", content: greeting });
            broadcastToOperators(tenantId, {
              type: "new_message",
              chatId: chat.id,
              visitorId: visitor.id,
              sender: "ai",
              content: greeting,
            });
          } catch (e) {
            console.error("[LC WS] Erro na saudação proativa:", e);
          }
        }, 1000);
      }
    }

    // ── Listener de mensagens do visitante ──────────────────────────────────
    ws.on("message", async (data) => {
      try {
        const payload = JSON.parse(data.toString());
        await handleVisitorMessage(conn, visitor, chat, payload, tenantId);
      } catch (e: any) {
        console.error("[LC WS] Erro ao processar mensagem do visitante:", e?.message);
      }
    });

    ws.on("close", async () => {
      LiveChatDebouncer.getInstance().clearSession(visitor.id);
      visitorConnections.delete(visitor.id);
      console.log(`[LC WS] Visitante ${visitor.id} desconectado`);
      broadcastToOperators(tenantId, {
        type: "visitor_disconnected",
        visitorId: visitor.id,
        chatId: chat.id,
      });
    });
  });
}

// ── Handler de mensagens do VISITANTE ─────────────────────────────────────────

async function handleVisitorMessage(
  conn: LcConnection,
  visitor: any,
  chat: any,
  payload: any,
  tenantId: string
) {
  const { type, content, url, title } = payload;

  // Identificação do visitante (Onboarding Pré-Chat com Nome + CPF/CNPJ)
  if (type === "visitor_identify") {
    const { name, doc } = payload;
    const cleanDoc = (doc || "").replace(/\D/g, "");
    const isCpf = cleanDoc.length === 11;
    const isCnpj = cleanDoc.length === 14;

    await updateVisitorData(tenantId, visitor.id, {
      name: name || visitor.name,
      cpf: isCpf ? doc : visitor.cpf,
      cnpj: isCnpj ? doc : visitor.cnpj,
      ...(url ? { currentUrl: url, currentTitle: title } : {}),
    });

    broadcastToOperators(tenantId, {
      type: "visitor_updated",
      visitorId: visitor.id,
      name,
      cpf: isCpf ? doc : undefined,
      cnpj: isCnpj ? doc : undefined,
    });
    return;
  }

  // Pageview update
  if (type === "pageview") {
    if (url) {
      await recordPageview(tenantId, visitor.id, url, title);
      await updateVisitorData(tenantId, visitor.id, {
        currentUrl: url,
        currentTitle: title,
      });
      broadcastToOperators(tenantId, {
        type: "visitor_updated",
        visitorId: visitor.id,
        currentUrl: url,
        currentTitle: title,
      });
    }
    return;
  }

  // ── Mensagem de texto (com Debounce, Stop & Restart e Fragmentação) ──
  const userText = content || payload.text;
  if ((type === "message" || type === "visitor_message") && userText) {
    if (isNoise(userText)) {
      send(conn.ws, { type: "pong" });
      return;
    }

    // Salva imediatamente no banco para o histórico
    const savedMsg = await saveMessage(tenantId, chat.id, "visitor", userText);

    // Notifica operadores em tempo real
    broadcastToOperators(tenantId, {
      type: "new_message",
      chatId: chat.id,
      visitorId: visitor.id,
      messageId: savedMsg.id,
      sender: "visitor",
      content: userText,
    });

    // Se operador já assumiu, não acionar IA
    if (chat.status === "operator_took_over") {
      return;
    }

    // Encaminha para o motor de Debounce & Stop-and-Restart da Valentina
    LiveChatDebouncer.getInstance().pushIncomingMessage(
      tenantId,
      visitor,
      chat,
      {
        type: "text",
        content: userText,
        receivedAt: new Date(),
      },
      (p) => send(conn.ws, p),
      (p) => broadcastToOperators(tenantId, p)
    );
    return;
  }

  // ── Mensagem de Áudio ──────────────────────────────
  if (type === "visitor_audio" || type === "audio") {
    const { audioBase64, mimeType = "audio/webm", durationSec = 0 } = payload;
    if (!audioBase64) return;

    const mediaDataUrl = audioBase64.startsWith("data:")
      ? audioBase64
      : `data:${mimeType};base64,${audioBase64}`;

    await saveMessage(tenantId, chat.id, "visitor", "[Áudio do visitante]", {
      contentType: "audio",
      mediaUrl: mediaDataUrl,
      mediaType: mimeType,
    });

    broadcastToOperators(tenantId, {
      type: "new_message",
      chatId: chat.id,
      visitorId: visitor.id,
      sender: "visitor",
      content: "[Áudio do visitante]",
      contentType: "audio",
      mediaUrl: mediaDataUrl,
      durationSec,
    });

    if (chat.status === "operator_took_over") return;

    // Transcreve áudio com Vertex AI Gemini Flash
    let transcribedText = "";
    try {
      const { vertexAi } = await import("../vertex-ai");
      const cleanMimeType = (mimeType || "audio/webm").split(";")[0].trim() || "audio/webm";
      const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, "");
      const rawTranscription = await vertexAi.generateText(
        [
          { inlineData: { mimeType: cleanMimeType, data: cleanBase64 } },
          { text: "Você é um transcritor de áudio em português brasileiro. Transcreva fielmente o que a pessoa falou. Se o áudio for inaudível, vazio ou puro ruído, responda apenas: [INAUDIVEL]" },
        ],
        "gemini-2.5-flash",
        undefined,
        {
          feature: "call_transcription",
          tenantId,
          metadata: { chatId: chat.id, visitorId: visitor.id },
        }
      );
      const cleaned = (rawTranscription || "").trim();
      if (cleaned && !cleaned.includes("[INAUDIVEL]")) {
        transcribedText = cleaned;
      }
    } catch (err: any) {
      console.error("[LC WS] Erro ao transcrever áudio do visitante:", err?.message);
    }

    const promptToProcess = transcribedText 
      ? `[Áudio transcrito do visitante]: "${transcribedText}"`
      : "[O visitante enviou uma mensagem de áudio curta]";

    LiveChatDebouncer.getInstance().pushIncomingMessage(
      tenantId,
      visitor,
      chat,
      {
        type: "audio",
        content: promptToProcess,
        mediaUrl: mediaDataUrl,
        durationSec,
        receivedAt: new Date(),
      },
      (p) => send(conn.ws, p),
      (p) => broadcastToOperators(tenantId, p)
    );
    return;
  }

  // ── Mensagem com Anexo / Mídia (Foto, Vídeo, PDF, Planilha, RAR) ──
  if (type === "visitor_media" || type === "media") {
    const { fileBase64, fileName = "arquivo", fileType = "application/octet-stream", fileSize = 0 } = payload;
    if (!fileBase64) return;

    const isImg = fileType.startsWith("image/");
    const isVid = fileType.startsWith("video/");
    const contentType = isImg ? "image" : isVid ? "video" : "document";

    await saveMessage(tenantId, chat.id, "visitor", payload.text || `[Arquivo: ${fileName}]`, {
      contentType,
      mediaUrl: fileBase64,
      fileName,
      fileSize,
      mediaType: fileType,
    });

    broadcastToOperators(tenantId, {
      type: "new_message",
      chatId: chat.id,
      visitorId: visitor.id,
      sender: "visitor",
      content: payload.text || `[Arquivo: ${fileName}]`,
      contentType,
      mediaUrl: fileBase64,
      fileName,
      fileSize,
    });

    if (chat.status === "operator_took_over") return;

    const mediaPrompt = `[O visitante enviou um anexo: "${fileName}"] ${payload.text ? `com a mensagem: "${payload.text}"` : ""}`;

    LiveChatDebouncer.getInstance().pushIncomingMessage(
      tenantId,
      visitor,
      chat,
      {
        type: "media",
        content: mediaPrompt,
        mediaUrl: fileBase64,
        fileName,
        fileSize,
        receivedAt: new Date(),
      },
      (p) => send(conn.ws, p),
      (p) => broadcastToOperators(tenantId, p)
    );
    return;
  }
}

// ── Handler de mensagens do OPERADOR ─────────────────────────────────────────

async function handleOperatorMessage(conn: LcConnection, rawData: string) {
  try {
    const payload = JSON.parse(rawData);
    const { type, chatId, visitorId, content, messageId } = payload;
    const { tenantId } = conn;

    // Operador enviando mensagem ao visitante
    if (type === "operator_message" && chatId && content) {
      const savedMsg = await saveMessage(tenantId, chatId, "operator", content, {
        operatorId: conn.operatorId,
      });

      // Envia ao visitante
      const visitorConn = [...visitorConnections.values()].find(
        (c) => c.chatId === chatId && c.tenantId === tenantId
      );
      if (visitorConn) {
        send(visitorConn.ws, {
          type: "message",
          chatId,
          messageId: savedMsg.id,
          sender: "operator",
          content,
        });
      }

      // Broadcast para outros operadores
      broadcastToOperators(tenantId, {
        type: "new_message",
        chatId,
        visitorId,
        sender: "operator",
        content,
      });
      return;
    }

    // Operador assumindo conversa
    if (type === "take_over" && chatId && conn.operatorId) {
      if (visitorId) {
        LiveChatDebouncer.getInstance().clearSession(visitorId);
      }

      await updateChatStatus(tenantId, chatId, "operator_took_over", {
        operatorId: conn.operatorId,
      });
      broadcastToOperators(tenantId, {
        type: "operator_took_over",
        chatId,
        visitorId,
        operatorId: conn.operatorId,
      });

      // Notifica o visitante
      const visitorConn = [...visitorConnections.values()].find(
        (c) => c.chatId === chatId && c.tenantId === tenantId
      );
      if (visitorConn) {
        send(visitorConn.ws, {
          type: "operator_joined",
          message: "Um de nossos especialistas entrou na conversa.",
        });
      }
      return;
    }

    // Operador devolvendo para IA
    if (type === "release_to_ai" && chatId) {
      await updateChatStatus(tenantId, chatId, "active", { operatorId: undefined });
      broadcastToOperators(tenantId, { type: "released_to_ai", chatId, visitorId });
      return;
    }

    // Operador encerrando chat
    if (type === "close_chat" && chatId) {
      if (visitorId) {
        LiveChatDebouncer.getInstance().clearSession(visitorId);
      }

      await updateChatStatus(tenantId, chatId, "closed", { outcome: "resolved" });
      const visitorConn = [...visitorConnections.values()].find(
        (c) => c.chatId === chatId && c.tenantId === tenantId
      );
      if (visitorConn) {
        send(visitorConn.ws, {
          type: "chat_closed",
          message: "Atendimento encerrado pelo operador. Obrigado!",
        });
      }
      broadcastToOperators(tenantId, { type: "chat_closed", chatId, visitorId });
      return;
    }
  } catch (e: any) {
    console.error("[LC WS] Erro ao processar mensagem do operador:", e?.message);
  }
}