import "./lib/error-capture";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { WebSocketServer } from "ws";
import { MediaStreamHandler } from "./lib/voice/media-streams-handler";
import type { Server } from "http";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;
let wss: WebSocketServer | null = null;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

function initWebSocketUpgradeInterceptor(request: Request) {
  if (wss) return;

  // Em ambiente Node.js Server no Nitro, extraímos o servidor HTTP do socket
  const nodeReq = (request as any).node?.req;
  const server: Server | undefined = nodeReq?.socket?.server;

  if (server) {
    wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const url = req.url || "";
      if (url.includes("/api/voice-stream")) {
        wss?.handleUpgrade(req, socket, head, (ws) => {
          console.log("[Server WebSocket] Twilio MediaStream conectado com sucesso!");
          new MediaStreamHandler(ws);
        });
      }
    });

    console.log("[Server WebSocket] Interceptor de upgrade ativado para /api/voice-stream!");
  }
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      initWebSocketUpgradeInterceptor(request);

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
