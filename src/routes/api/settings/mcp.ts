import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import {
  MCP_SERVER_INFO,
  MCP_TOOLS,
  generateMcpTokenForTenant,
  getDefaultPrimaryToken,
  getMcpTenantSettings,
  processMcpJsonRpcPayload,
  saveMcpTenantSettings,
  type McpAccessContext,
  type McpNamedKey,
} from "../../../lib/mcp/valem-tecfag-mcp-core";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/settings/mcp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId === "valem" ? "valem" : "tecfag";

        const settings = await getMcpTenantSettings(tenantId);

        return jsonResponse({
          ok: true,
          tenantId,
          serverInfo: MCP_SERVER_INFO,
          enabled: settings.enabled,
          primaryToken: settings.primaryToken,
          primaryTokenUpdatedAt: settings.primaryTokenUpdatedAt,
          isDefaultPrimaryToken: settings.primaryToken === getDefaultPrimaryToken(tenantId),
          namedKeys: settings.namedKeys,
          auditLogs: settings.auditLogs,
          tools: MCP_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
          })),
        });
      },

      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId === "valem" ? "valem" : "tecfag";

        const isAdmin =
          session.operator.role === "admin" ||
          Boolean(session.permissions?.settings?.canManageWhatsapp);

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonResponse({ error: "Corpo JSON inválido.", code: "INVALID_JSON" }, 400);
        }

        const action = String(body.action || "").trim();

        if (action === "test_connection") {
          const startedAt = Date.now();
          const access: McpAccessContext = {
            authorized: true,
            lockedTenantId: tenantId,
            defaultTenantId: tenantId,
            authMode: "session",
            keyId: "diagnostic",
            keyLabel: `Diagnóstico (${session.operator.name || "Admin"})`,
          };

          const initRes = (await processMcpJsonRpcPayload(
            { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
            access,
          )) as Record<string, any>;

          const toolsRes = (await processMcpJsonRpcPayload(
            { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
            access,
          )) as Record<string, any>;

          const overviewRes = (await processMcpJsonRpcPayload(
            {
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: {
                name: "get_fagner_triage_overview",
                arguments: { tenantId, daysBack: 7 },
              },
            },
            access,
          )) as Record<string, any>;

          const latencyMs = Date.now() - startedAt;
          let sampleOverview: Record<string, unknown> | null = null;
          try {
            const rawText = overviewRes?.result?.content?.[0]?.text;
            if (rawText) {
              const parsed = JSON.parse(rawText);
              sampleOverview = parsed?.summary || null;
            }
          } catch {
            sampleOverview = null;
          }

          // Pequena pausa para garantir que o log assíncrono foi persistido antes de devolver a lista atualizada
          await new Promise((r) => setTimeout(r, 80));
          const refreshed = await getMcpTenantSettings(tenantId);

          return jsonResponse({
            ok: true,
            latencyMs,
            protocolVersion: initRes?.result?.protocolVersion || "2024-11-05",
            toolsCount: Array.isArray(toolsRes?.result?.tools)
              ? toolsRes.result.tools.length
              : MCP_TOOLS.length,
            sampleOverview,
            auditLogs: refreshed.auditLogs,
          });
        }

        if (!isAdmin) {
          return jsonResponse(
            { error: "Permissão insuficiente para alterar chaves do Conector MCP.", code: "FORBIDDEN" },
            403,
          );
        }

        const current = await getMcpTenantSettings(tenantId);

        if (action === "toggle_enabled") {
          const enabled = Boolean(body.enabled);
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            enabled,
          });
          return jsonResponse({
            ok: true,
            settings: updated,
          });
        }

        if (action === "rotate_primary_token") {
          const newToken = generateMcpTokenForTenant(tenantId);
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            primaryToken: newToken,
            primaryTokenUpdatedAt: new Date().toISOString(),
          });
          return jsonResponse({
            ok: true,
            settings: updated,
          });
        }

        if (action === "restore_default_token") {
          const defaultToken = getDefaultPrimaryToken(tenantId);
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            primaryToken: defaultToken,
            primaryTokenUpdatedAt: new Date().toISOString(),
          });
          return jsonResponse({
            ok: true,
            settings: updated,
          });
        }

        if (action === "create_named_key") {
          const label = String(body.label || "").trim();
          if (!label) {
            return jsonResponse(
              { error: "Informe um nome ou identificação para o link (ex: João - Comercial)." },
              400,
            );
          }
          const newKey: McpNamedKey = {
            id: `mcp-key-${crypto.randomBytes(6).toString("hex")}`,
            label: label.slice(0, 80),
            token: generateMcpTokenForTenant(tenantId),
            createdBy: session.operator.name || "Administrador",
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            usageCount: 0,
            active: true,
          };
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            namedKeys: [newKey, ...current.namedKeys],
          });
          return jsonResponse({
            ok: true,
            createdKey: newKey,
            settings: updated,
          });
        }

        if (action === "toggle_named_key") {
          const keyId = String(body.keyId || "").trim();
          const active = Boolean(body.active);
          const updatedKeys = current.namedKeys.map((k) =>
            k.id === keyId ? { ...k, active } : k,
          );
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            namedKeys: updatedKeys,
          });
          return jsonResponse({
            ok: true,
            settings: updated,
          });
        }

        if (action === "delete_named_key") {
          const keyId = String(body.keyId || "").trim();
          const updatedKeys = current.namedKeys.filter((k) => k.id !== keyId);
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            namedKeys: updatedKeys,
          });
          return jsonResponse({
            ok: true,
            settings: updated,
          });
        }

        if (action === "clear_audit_logs") {
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            auditLogs: [],
          });
          return jsonResponse({
            ok: true,
            settings: updated,
          });
        }

        return jsonResponse({ error: `Ação desconhecida: '${action}'.` }, 400);
      },
    },
  },
});
