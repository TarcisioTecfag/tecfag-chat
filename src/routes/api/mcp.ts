import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import {
  MCP_TOOLS,
  processMcpJsonRpcPayload,
  resolveMcpAccess,
} from "../../lib/mcp/valem-tecfag-mcp-core";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-ID, x-mcp-token",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Cache-Control": "no-store",
};

function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Não autorizado. Informe o token do conector MCP (?token=...) ou autentique-se na sessão.",
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      },

      GET: async ({ request }) => {
        const access = await resolveMcpAccess(request);
        if (!access.authorized) {
          return unauthorizedResponse();
        }

        const accept = (request.headers.get("accept") || "").toLowerCase();
        const url = new URL(request.url);
        const sessionId =
          request.headers.get("mcp-session-id") ||
          url.searchParams.get("sessionId") ||
          crypto.randomUUID();

        // Suporte a clientes MCP que abrem canal SSE via GET /api/mcp
        if (accept.includes("text/event-stream")) {
          const postParams = new URLSearchParams(url.searchParams);
          postParams.set("sessionId", sessionId);
          const endpointUri = `/api/mcp?${postParams.toString()}`;

          const encoder = new TextEncoder();
          let pingTimer: ReturnType<typeof setInterval> | null = null;

          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(`event: endpoint\ndata: ${endpointUri}\n\n`),
              );
              pingTimer = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
                } catch {
                  if (pingTimer) clearInterval(pingTimer);
                }
              }, 15_000);

              request.signal.addEventListener("abort", () => {
                if (pingTimer) clearInterval(pingTimer);
                try {
                  controller.close();
                } catch {
                  // ignore
                }
              });
            },
            cancel() {
              if (pingTimer) clearInterval(pingTimer);
            },
          });

          return new Response(stream, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "text/event-stream; charset=utf-8",
              Connection: "keep-alive",
              "Mcp-Session-Id": sessionId,
            },
          });
        }

        // Acesso direto via navegador para conferência rápida do link
        return new Response(
          JSON.stringify(
            {
              ok: true,
              server: "valem-tecfag-mcp",
              version: "1.0.0",
              transport: "Streamable HTTP (POST /api/mcp) + SSE (GET /api/mcp)",
              authMode: access.authMode,
              lockedTenantId: access.lockedTenantId || "multi-tenant (default: tecfag)",
              toolsCount: MCP_TOOLS.length,
              tools: MCP_TOOLS.map((t) => ({
                name: t.name,
                description: t.description,
              })),
            },
            null,
            2,
          ),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json; charset=utf-8",
              "Mcp-Session-Id": sessionId,
            },
          },
        );
      },

      POST: async ({ request }) => {
        const access = await resolveMcpAccess(request);
        if (!access.authorized) {
          return unauthorizedResponse();
        }

        const sessionId =
          request.headers.get("mcp-session-id") || crypto.randomUUID();

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32700, message: "Parse error: invalid JSON body" },
              id: null,
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Mcp-Session-Id": sessionId,
              },
            },
          );
        }

        const result = await processMcpJsonRpcPayload(payload, access);
        if (result.status === 202 || result.body === null) {
          return new Response(null, {
            status: 202,
            headers: {
              ...corsHeaders,
              "Mcp-Session-Id": sessionId,
            },
          });
        }

        return new Response(JSON.stringify(result.body), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Mcp-Session-Id": sessionId,
          },
        });
      },

      DELETE: async ({ request }) => {
        const access = await resolveMcpAccess(request);
        if (!access.authorized) {
          return unauthorizedResponse();
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        });
      },
    },
  },
});
