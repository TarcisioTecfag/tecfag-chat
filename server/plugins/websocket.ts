import { WebSocketServer } from "ws";
import { MediaStreamHandler } from "../src/lib/voice/media-streams-handler";
import type { Server } from "http";

export default function websocketPlugin(nitroApp: any) {
  let wss: WebSocketServer | null = null;

  nitroApp.hooks.hook("request", (event: any) => {
    // Intercepta e associa o WebSocketServer na primeira requisição se o servidor HTTP Node estiver acessível
    if (!wss && event.node?.res?.socket?.server) {
      const server: Server = event.node.res.socket.server;
      wss = new WebSocketServer({ noServer: true });

      server.on("upgrade", (request, socket, head) => {
        const url = request.url || "";
        if (url.startsWith("/api/voice-stream")) {
          wss?.handleUpgrade(request, socket, head, (ws) => {
            console.log("[Nitro WebSocket] Novo cliente Twilio Media Stream conectado!");
            new MediaStreamHandler(ws);
          });
        }
      });

      console.log("[Nitro WebSocket Plugin] Interceptor de upgrade WebSocket ativado para /api/voice-stream");
    }
  });
}
