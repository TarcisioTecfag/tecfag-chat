// ══════════════════════════════════════════════════════════════════════════════
// 🔌 LIVECHAT WEBSOCKET — Servidor de mensageria em tempo real
// Endpoint: /ws/livechat
// Auth: ?tenantId=valem&cookieId=XXXXXXXX (identificador do visitante)
//       ?tenantId=valem&operatorToken=JWT (para painel de operador)
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
import { processVisitorMessage, generateProactiveGreeting, isNoise } from "./livechatAI";
import { bridgeLiveChatToWhatsApp } from "./livechat-bridge";
import { calculateIntentScore, scoreToTemperature, isAtacadoQualificado } from "./livechatScoring";
import { searchProducts, extractSearchTermFromUrl } from "./trayCatalogService";

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

// ── Registro de conexões ativas ───────────────────────────────────────────────

// visitorId → LcConnection
const visitorConnections = new Map<string, LcConnection>();

// operatorId → LcConnection
const operatorConnections = new Map<string, LcConnection>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(ws: WebSocket, event: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function broadcastToOperators(tenantId: string, event: object) {
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
      // TODO: validar JWT do operador
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

    let visitor;
    let chat;

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

    // Saudação proativa (após pequeno delay, não bloquear conexão)
    if (!chat.status || chat.status === "active") {
      const historyCount = (await getChatHistory(tenantId, chat.id, 1)).length;
      if (historyCount === 0) {
        // Primeira mensagem da sessão — envia proativo após 1s
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

  // ── Mensagem de texto (ou payload de visitante) ──
  const userText = content || payload.text;
  if ((type === "message" || type === "visitor_message") && userText) {
    if (isNoise(userText)) {
      send(conn.ws, { type: "pong" });
      return;
    }

    await saveMessage(tenantId, chat.id, "visitor", userText);

    broadcastToOperators(tenantId, {
      type: "new_message",
      chatId: chat.id,
      visitorId: visitor.id,
      sender: "visitor",
      content: userText,
    });

    if (chat.status === "operator_took_over") {
      return;
    }

    const aiResponse = await processVisitorMessage(tenantId, visitor, chat, userText);

    if (aiResponse.score !== undefined) {
      const temp = scoreToTemperature(aiResponse.score);
      await updateVisitorData(tenantId, visitor.id, {
        intentScore: aiResponse.score,
        temperature: temp,
        ...(aiResponse.stage ? { pipelineStage: aiResponse.stage } : {}),
      });
    }

    if (aiResponse.cnpjToCheck) {
      await updateVisitorData(tenantId, visitor.id, { cnpj: aiResponse.cnpjToCheck });
    }

    send(conn.ws, {
      type: "message",
      chatId: chat.id,
      sender: "ai",
      content: aiResponse.text,
    });

    broadcastToOperators(tenantId, {
      type: "new_message",
      chatId: chat.id,
      visitorId: visitor.id,
      sender: "ai",
      content: aiResponse.text,
    });

    if (aiResponse.trayProductId || visitor.currentUrl) {
      try {
        const searchTerm = visitor.currentUrl
          ? extractSearchTermFromUrl(visitor.currentUrl)
          : userText;
        const products = await searchProducts(tenantId, searchTerm, 1);
        if (products[0]) {
          const productCard = {
            type: "tray_product_card",
            chatId: chat.id,
            product: products[0],
          };
          send(conn.ws, productCard);
          broadcastToOperators(tenantId, { ...productCard, visitorId: visitor.id });
        }
      } catch (e) {
        console.error("[LC WS] Erro ao buscar produto Tray:", e);
      }
    }

    // Bridge para WhatsApp
    if (aiResponse.shouldBridgeToWhatsApp && visitor.phone) {
      const bridgeResult = await bridgeLiveChatToWhatsApp(
        tenantId,
        chat.id,
        visitor.id,
        visitor.phone
      );

      const bridgeEvent = {
        type: "bridge_initiated",
        chatId: chat.id,
        visitorId: visitor.id,
        phone: visitor.phone,
        success: bridgeResult.success,
        waConversationId: bridgeResult.waConversationId,
      };

      send(conn.ws, bridgeEvent);
      broadcastToOperators(tenantId, bridgeEvent);
    }
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
      const cleanBase64 = audioBase64.replace(/^data:audio\/[^;]+;base64,/, "");
      const rawTranscription = await vertexAi.generateText(
        [
          { inlineData: { mimeType, data: cleanBase64 } },
          { text: "Transcreva este áudio em português brasileiro com precisão. Retorne apenas o texto falado." },
        ],
        "gemini-2.5-flash",
        undefined,
        {
          feature: "call_transcription",
          tenantId,
          metadata: { chatId: chat.id, visitorId: visitor.id },
        }
      );
      transcribedText = (rawTranscription || "").trim();
    } catch (err: any) {
      console.error("[LC WS] Erro ao transcrever áudio do visitante:", err?.message);
    }

    const promptToProcess = transcribedText || "O cliente enviou um áudio, mas não foi possível transcrever. Peça educadamente para repetir ou escrever em texto se necessário.";
    const aiResponse = await processVisitorMessage(tenantId, visitor, chat, promptToProcess);

    send(conn.ws, {
      type: "message",
      chatId: chat.id,
      sender: "ai",
      content: aiResponse.text,
    });

    broadcastToOperators(tenantId, {
      type: "new_message",
      chatId: chat.id,
      visitorId: visitor.id,
      sender: "ai",
      content: aiResponse.text,
    });
    return;
  }

  // ── Mensagem com Anexo / Mídia (Foto, Vídeo, PDF, Planilha, RAR) ──
  if (type === "visitor_media" || type === "media") {
    const { fileBase64, fileName = "arquivo", fileType = "application/octet-stream", fileSize = 0 } = payload;
    if (!fileBase64) return;

    const isImg = fileType.startsWith("image/");
    const isVid = fileType.startsWith("video/");
    const contentType = isImg ? "image" : isVid ? "video" : "document";
    const mediaDataUrl = fileBase64.startsWith("data:") ? fileBase64 : `data:${fileType};base64,${fileBase64}`;

    await saveMessage(tenantId, chat.id, "visitor", `[Arquivo: ${fileName}]`, {
      contentType,
      mediaUrl: mediaDataUrl,
      mediaType: fileType,
      fileName,
    });

    broadcastToOperators(tenantId, {
      type: "new_message",
      chatId: chat.id,
      visitorId: visitor.id,
      sender: "visitor",
      content: `[Arquivo: ${fileName}]`,
      contentType,
      mediaUrl: mediaDataUrl,
      fileName,
      fileSize,
    });

    if (chat.status === "operator_took_over") return;

    const aiResponse = await processVisitorMessage(
      tenantId,
      visitor,
      chat,
      `O visitante enviou o arquivo: "${fileName}" (${contentType}). Confirme o recebimento cordialmente e pergunte em que pode orientar sobre esse documento ou produto.`
    );

    send(conn.ws, {
      type: "message",
      chatId: chat.id,
      sender: "ai",
      content: aiResponse.text,
    });

    broadcastToOperators(tenantId, {
      type: "new_message",
      chatId: chat.id,
      visitorId: visitor.id,
      sender: "ai",
      content: aiResponse.text,
    });
    return;
  }
}

// ── Handler de mensagens do OPERADOR ──────────────────────────────────────────

async function handleOperatorMessage(conn: LcConnection, data: string) {
  try {
    const payload = JSON.parse(data);
    const { type, chatId, visitorId, content, operatorId } = payload;
    const tenantId = conn.tenantId;

    // Operador enviando mensagem
    if (type === "operator_message" && chatId && content) {
      await saveMessage(tenantId, chatId, "operator", content);

      // Envia para o visitante
      const visitorConn = [...visitorConnections.values()].find(
        (c) => c.chatId === chatId && c.tenantId === tenantId
      );
      if (visitorConn) {
        send(visitorConn.ws, { type: "message", chatId, sender: "operator", content });
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
      await updateChatStatus(tenantId, chatId, "closed", { outcome: "resolved" });
      const visitorConn = [...visitorConnections.values()].find(
        (c) => c.chatId === chatId && c.tenantId === tenantId
      );
      if (visitorConn) {
        send(visitorConn.ws, { type: "chat_closed", chatId });
      }
      broadcastToOperators(tenantId, { type: "chat_closed", chatId, visitorId });
      return;
    }

    // Operador pedindo detalhes do visitante
    if (type === "get_visitor_details" && visitorId) {
      const { getVisitorById } = await import("./livechatStorage");
      const visitor = await getVisitorById(tenantId, visitorId);
      const pageviews = await getVisitorPageviews(tenantId, visitorId);
      send(conn.ws, { type: "visitor_details", visitor, pageviews });
      return;
    }

  } catch (e: any) {
    console.error("[LC WS] Erro ao processar mensagem do operador:", e?.message);
  }
}