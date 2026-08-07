import { createFileRoute } from "@tanstack/react-router";
import { MediaStreamHandler } from "../../lib/voice/media-streams-handler";
import WebSocket, { WebSocketServer } from "ws";

let wss: WebSocketServer | null = null;

export const Route = createFileRoute("/api/voice-stream")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        // Verifica se é uma requisição de Upgrade de WebSocket
        const upgradeHeader = request.headers.get("upgrade") || request.headers.get("Upgrade");
        if (upgradeHeader?.toLowerCase() === "websocket") {
          // No ambiente Node.js / TanStack Start, o upgrade é gerenciado nativamente
          return new Response("WebSocket Upgrade Endpoint Active", { status: 101 });
        }

        return new Response("Twilio Media Stream WebSocket Endpoint", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },
    },
  },
});
