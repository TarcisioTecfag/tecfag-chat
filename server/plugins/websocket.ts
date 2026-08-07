import { WebSocketServer } from "ws";
import type { Server } from "http";
// NÃO importamos MediaStreamHandler no topo — ele puxa db/vertex-ai que crasham no load do plugin.
// O import é feito de forma lazy dentro do handler do upgrade.

let wss: WebSocketServer | null = null;
let serverListenerAttached = false;

function attachWebSocketServer(server: Server, label: string) {
  if (serverListenerAttached) return;
  serverListenerAttached = true;

  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    const url = request.url || "";
    console.log(`[Nitro WS] Upgrade request recebido: ${url}`);

    if (url.startsWith("/api/voice-stream")) {
      wss!.handleUpgrade(request, socket, head, async (ws) => {
        console.log(`[${label}] ✅ Twilio MediaStream conectado!`);
        try {
          // Import lazy: só carrega quando o Twilio conecta, não no startup
          const { MediaStreamHandler } = await import("../../src/lib/voice/media-streams-handler.js");
          new MediaStreamHandler(ws as any);
        } catch (err: any) {
          console.error(`[${label}] ❌ Falha ao carregar MediaStreamHandler:`, err?.message || err);
          ws.close(1011, "Handler load failed");
        }
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
