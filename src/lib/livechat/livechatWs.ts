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
  const { type, content, url, title, pageviewData } = payload;

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

  // Mensagem de texto
  if (type === "message" && content) {
    if (isNoise(content)) {
      send(conn.ws, { type: "pong" });
      return;
    }

    // Salva mensagem do visitante
    await saveMessage(tenantId, chat.id, "visitor", content);

    // Notifica operadores
    broadcastToOperators(tenantId, {
      type: "new_message",
      chatId: chat.id,
      visitorId: visitor.id,
      sender: "visitor",
      content,
    });

    // Se operador assumiu, não passa pela IA
    if (chat.status === "operator_took_over") {
      return;
    }

    // Passa pela IA
    const aiResponse = await processVisitorMessage(
      tenantId,
      visitor,
      chat,
      content
    );

    // Atualiza score do visitante
    if (aiResponse.score !== undefined) {
      const temp = scoreToTemperature(aiResponse.score);
      await updateVisitorData(tenantId, visitor.id, {
        intentScore: aiResponse.score,
        temperature: temp,
        ...(aiResponse.stage ? { pipelineStage: aiResponse.stage } : {}),
      });
    }

    // Atualiza dados coletados se CNPJ encontrado
    if (aiResponse.cnpjToCheck) {
      await updateVisitorData(tenantId, visitor.id, { cnpj: aiResponse.cnpjToCheck });
    }

    // Envia resposta da IA ao visitante
    send(conn.ws, {
      type: "message",
      chatId: chat.id,
      sender: "ai",
      content: aiResponse.text,
    });

    // Notifica operadores
    broadcastToOperators(tenantId, {
      type: "new_message",
      chatId: chat.id,
      visitorId: visitor.id,
      sender: "ai",
      content: aiResponse.text,
    });

    // Se produto identificado, busca na Tray e envia card
    if (aiResponse.trayProductId || visitor.currentUrl) {
      try {
        const searchTerm = visitor.currentUrl
          ? extractSearchTermFromUrl(visitor.currentUrl)
          : content;
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