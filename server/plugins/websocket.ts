import { WebSocketServer } from "ws";
import type { Server } from "http";
// Import ESTÁTICO — o bundler resolve o path corretamente em produção
import { MediaStreamHandler } from "../../src/lib/voice/media-streams-handler";

let wss: WebSocketServer | null = null;
let serverListenerAttached = false;

function attachWebSocketServer(server: Server, label: string) {
  if (serverListenerAttached) return;
  serverListenerAttached = true;

  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = request.url || "";
    console.log(`[Nitro WS] Upgrade request recebido: ${url}`);

    if (url.startsWith("/api/voice-stream")) {
      wss!.handleUpgrade(request, socket, head, (ws) => {
        console.log(`[${label}] ✅ Twilio MediaStream conectado!`);
        new MediaStreamHandler(ws as any);
      });
    } else {
      console.log(`[Nitro WS] URL não mapeada, destruindo socket: ${url}`);
      socket.destroy();
    }
  });

  console.log(`[${label}] ✅ Servidor WebSocket ativo em /api/voice-stream`);
}

// Nitro chama plugin(nitroApp) diretamente — exportamos a função pura.
export default function websocketPlugin(nitroApp: any) {
  // Hook que roda quando o servidor HTTP Node.js começa a escutar
  nitroApp.hooks.hook("listen", (server: Server) => {
    console.log("[Nitro WS] Hook 'listen' disparou!");
    attachWebSocketServer(server, "Nitro WS Plugin");
  });

  // Fallback: hook request para capturar o servidor se "listen" não disparar
  nitroApp.hooks.hook("request", (event: any) => {
    if (serverListenerAttached) return;
    const server: Server | undefined = event?.node?.res?.socket?.server;
    if (!server) return;
    console.log("[Nitro WS] Fallback via 'request' hook disparou!");
    attachWebSocketServer(server, "Nitro WS Fallback");
  });
}
