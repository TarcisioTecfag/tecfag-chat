import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import {
  MCP_TOOLS,
  attachMcpSseController,
  closeMcpSession,
  processMcpJsonRpcPayload,
  pushMcpSseMessage,
  recordMcpToolAuditLog,
  registerMcpSession,
  resolveMcpAccess,
} from "../../lib/mcp/valem-tecfag-mcp-core";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-ID, x-mcp-token, x-mcp-client-name",
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
        const startedAt = Date.now();
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
        const defaultTenant: "tecfag" | "valem" =
          access.lockedTenantId || access.defaultTenantId || "tecfag";

        registerMcpSession(sessionId, access, access.clientName);

        // Suporte a execução direta de ferramenta via GET /api/mcp?token=...&tool=search_conversations&...
        const directToolName = (
          url.searchParams.get("tool") ||
          url.searchParams.get("toolName") ||
          ""
        ).trim();
        if (directToolName) {
          const toolArgs: Record<string, unknown> = {};
          for (const [k, v] of url.searchParams.entries()) {
            if (
              k === "token" ||
              k === "apiKey" ||
              k === "tool" ||
              k === "toolName" ||
              k === "sessionId" ||
              k === "client" ||
              k === "clientName"
            ) {
              continue;
            }
            if (v === "true") toolArgs[k] = true;
            else if (v === "false") toolArgs[k] = false;
            else if (v !== "" && !Number.isNaN(Number(v)) && k !== "search" && k !== "phone" && k !== "document") {
              toolArgs[k] = Number(v);
            } else {
              toolArgs[k] = v;
            }
          }

          const enrichedAccess = {
            ...access,
            sessionId,
            transport: "HTTP GET (Query Direta)",
          };
          const result = await processMcpJsonRpcPayload(
            {
              jsonrpc: "2.0",
              id: `get-${Date.now()}`,
              method: "tools/call",
              params: {
                name: directToolName,
                arguments: toolArgs,
              },
            },
            enrichedAccess,
          );

          return new Response(JSON.stringify(result.body, null, 2), {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json; charset=utf-8",
              "Mcp-Session-Id": sessionId,
            },
          });
        }

        // Suporte a clientes MCP que abrem canal SSE via GET /api/mcp
        if (accept.includes("text/event-stream")) {
          const postParams = new URLSearchParams(url.searchParams);
          postParams.set("sessionId", sessionId);
          const endpointUri = `/api/mcp?${postParams.toString()}`;

          await recordMcpToolAuditLog({
            tenantId: defaultTenant,
            access: {
              ...access,
              sessionId,
              transport: "SSE Stream (GET)",
            },
            toolName: "mcp_sse_connect",
            toolLabel: "Conexão SSE Aberta (Link Único)",
            toolArgs: {
              sessionId,
              client: access.clientName || "Cliente MCP",
            },
            argumentsSummary: `Canal SSE iniciado · Sessão ${sessionId.slice(0, 8)}`,
            resultSummary: `Stream SSE estabelecido com sucesso (${access.clientName || "Cliente IA"})`,
            status: "success",
            latencyMs: Date.now() - startedAt,
            eventType: "connection",
            transport: "SSE Stream (GET)",
            responsePreview: JSON.stringify(
              {
                event: "endpoint",
                endpointUri,
                sessionId,
                clientName: access.clientName,
                clientIp: access.clientIp,
              },
              null,
              2,
            ),
          });

          const encoder = new TextEncoder();
          let pingTimer: ReturnType<typeof setInterval> | null = null;

          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              attachMcpSseController(
                sessionId,
                { ...access, sessionId, transport: "SSE Stream" },
                controller,
              );
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
                closeMcpSession(sessionId);
                try {
                  controller.close();
                } catch {
                  // ignore
                }
              });
            },
            cancel() {
              if (pingTimer) clearInterval(pingTimer);
              closeMcpSession(sessionId);
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

        // Acesso direto via navegador ou HTTP GET para conferência rápida do link
        const infoBody = {
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
        };
        const infoJson = JSON.stringify(infoBody, null, 2);

        const isInternalProbe = request.headers.get("x-mcp-internal-probe") === "1";
        if (!isInternalProbe) {
          await recordMcpToolAuditLog({
            tenantId: defaultTenant,
            access: {
              ...access,
              sessionId,
              transport: "HTTP GET",
            },
            toolName: "mcp_http_inspect",
            toolLabel: "Verificação / Acesso ao Link Único (GET)",
            toolArgs: {
              client: access.clientName || "Navegador / HTTP Client",
            },
            argumentsSummary: `Inspeção HTTP GET (${access.clientName || "Cliente"})`,
            resultSummary: `Metadados do servidor e ${MCP_TOOLS.length} ferramentas exibidos`,
            status: "success",
            latencyMs: Date.now() - startedAt,
            eventType: "connection",
            transport: "HTTP GET",
            responseBytes: Buffer.byteLength(infoJson, "utf8"),
            responsePreview: JSON.stringify(
              {
                ok: true,
                server: infoBody.server,
                version: infoBody.version,
                lockedTenantId: infoBody.lockedTenantId,
                toolsCount: infoBody.toolsCount,
              },
              null,
              2,
            ),
          });
        }

        return new Response(infoJson, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Mcp-Session-Id": sessionId,
          },
        });
      },

      POST: async ({ request }) => {
        const access = await resolveMcpAccess(request);
        if (!access.authorized) {
          return unauthorizedResponse();
        }

        const url = new URL(request.url);
        const querySessionId = url.searchParams.get("sessionId") || "";
        const headerSessionId = request.headers.get("mcp-session-id") || "";
        const sessionId = (headerSessionId || querySessionId || crypto.randomUUID()).trim();
        const isSseSession = Boolean(querySessionId);
        const bridgeHeader = request.headers.get("x-mcp-bridge") || "";
        const transportLabel = bridgeHeader
          ? `Stdio Bridge → Link Único (${bridgeHeader})`
          : isSseSession
            ? "SSE + HTTP POST"
            : "HTTP POST (JSON-RPC)";

        const enrichedAccess = {
          ...access,
          sessionId,
          transport: transportLabel,
        };
        registerMcpSession(sessionId, enrichedAccess, enrichedAccess.clientName);

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

        const result = await processMcpJsonRpcPayload(payload, enrichedAccess);

        if (result.body !== null && result.body !== undefined) {
          pushMcpSseMessage(sessionId, result.body);
        }

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
        const url = new URL(request.url);
        const sessionId =
          request.headers.get("mcp-session-id") || url.searchParams.get("sessionId") || "";
        if (sessionId) {
          closeMcpSession(sessionId);
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
