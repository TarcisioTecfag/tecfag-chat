import { WebSocketServer } from "ws";
import type { Server } from "http";

// Importação dinâmica para evitar problemas de bundling
let MediaStreamHandlerClass: any = null;
async function getMediaStreamHandler() {
  if (!MediaStreamHandlerClass) {
    const mod = await import("../../src/lib/voice/media-streams-handler.js");
    MediaStreamHandlerClass = mod.MediaStreamHandler;
  }
  return MediaStreamHandlerClass;
}

let wss: WebSocketServer | null = null;
let serverListenerAttached = false;

export default defineNitroPlugin((nitroApp: any) => {
  // Hook que roda quando o servidor HTTP Node.js começa a escutar
  nitroApp.hooks.hook("listen", (server: Server) => {
    if (serverListenerAttached) return;
    serverListenerAttached = true;

    wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", async (request, socket, head) => {
      const url = request.url || "";
      if (url.startsWith("/api/voice-stream")) {
        const Handler = await getMediaStreamHandler();
        wss?.handleUpgrade(request, socket, head, (ws: any) => {
          console.log("[Nitro WS Plugin] ✅ Twilio MediaStream conectado via WebSocket!");
          new Handler(ws);
        });
      } else {
        socket.destroy();
      }
    });

    console.log("[Nitro WS Plugin] ✅ Servidor WebSocket ativo em /api/voice-stream");
  });

  // Fallback: hook request para tentar capturar o servidor se "listen" não disparar
  nitroApp.hooks.hook("request", (event: any) => {
    if (serverListenerAttached) return;
    const server: Server | undefined = event?.node?.res?.socket?.server;
    if (!server) return;

    serverListenerAttached = true;
    wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", async (request, socket, head) => {
      const url = request.url || "";
      if (url.startsWith("/api/voice-stream")) {
        const Handler = await getMediaStreamHandler();
        wss?.handleUpgrade(request, socket, head, (ws: any) => {
          console.log("[Nitro WS Fallback] ✅ Twilio MediaStream conectado via WebSocket!");
          new Handler(ws);
        });
      } else {
        socket.destroy();
      }
    });

    console.log("[Nitro WS Fallback] ✅ Servidor WebSocket ativo via fallback request hook");
  });
});
