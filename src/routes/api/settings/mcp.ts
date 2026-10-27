import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import {
  MCP_SERVER_INFO,
  MCP_TOOLS,
  extractRequestClientIp,
  generateMcpTokenForTenant,
  getDefaultPrimaryToken,
  getMcpTenantSettings,
  processMcpJsonRpcPayload,
  saveMcpTenantSettings,
  type McpAccessContext,
  type McpAuditLogEntry,
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

function buildConfigAuditEntry(params: {
  operatorName: string;
  clientIp: string;
  toolName: string;
  toolLabel: string;
  argumentsSummary: string;
  argumentsRaw: Record<string, unknown>;
  resultSummary: string;
  responsePreview: Record<string, unknown>;
}): McpAuditLogEntry {
  const previewText = JSON.stringify(params.responsePreview, null, 2);
  return {
    id: `mcp-log-${crypto.randomBytes(6).toString("hex")}`,
    timestamp: new Date().toISOString(),
    keyId: "admin_panel",
    keyLabel: `Painel Admin (${params.operatorName})`,
    toolName: params.toolName,
    toolLabel: params.toolLabel,
    argumentsSummary: params.argumentsSummary,
    argumentsRaw: params.argumentsRaw,
    resultSummary: params.resultSummary,
    status: "success",
    latencyMs: 1,
    eventType: "config_change",
    transport: "Painel Admin Web",
    clientName: `Operador: ${params.operatorName}`,
    clientIp: params.clientIp,
    responseBytes: Buffer.byteLength(previewText, "utf8"),
    responsePreview: previewText,
  };
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
        const operatorName = session.operator.name || "Administrador";
        const clientIp = extractRequestClientIp(request);

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
          const silentAccess: McpAccessContext = {
            authorized: true,
            lockedTenantId: tenantId,
            defaultTenantId: tenantId,
            authMode: "session",
            keyId: "diagnostic",
            keyLabel: `Diagnóstico (${operatorName})`,
            clientIp,
            clientName: `Diagnóstico Web (${operatorName})`,
            transport: "Painel Admin (Teste)",
            skipAuditLog: true,
          };
          const loggedAccess: McpAccessContext = {
            ...silentAccess,
            skipAuditLog: false,
          };

          const initRes = (await processMcpJsonRpcPayload(
            { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
            silentAccess,
          )) as Record<string, any>;

          const toolsRes = (await processMcpJsonRpcPayload(
            { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
            silentAccess,
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
            loggedAccess,
          )) as Record<string, any>;

          const latencyMs = Date.now() - startedAt;
          let sampleOverview: Record<string, unknown> | null = null;
          try {
            const rawText = overviewRes?.body?.result?.content?.[0]?.text;
            if (rawText) {
              const parsed = JSON.parse(rawText);
              sampleOverview = parsed?.summary || null;
            }
          } catch {
            sampleOverview = null;
          }

          const refreshed = await getMcpTenantSettings(tenantId);

          return jsonResponse({
            ok: true,
            latencyMs,
            protocolVersion: initRes?.body?.result?.protocolVersion || "2024-11-05",
            toolsCount: Array.isArray(toolsRes?.body?.result?.tools)
              ? toolsRes.body.result.tools.length
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
          const logEntry = buildConfigAuditEntry({
            operatorName,
            clientIp,
            toolName: "config_toggle_enabled",
            toolLabel: "Alteração de Status do Conector",
            argumentsSummary: `Conector ${enabled ? "ATIVADO" : "PAUSADO"} por ${operatorName}`,
            argumentsRaw: { action, previousEnabled: current.enabled, newEnabled: enabled },
            resultSummary: enabled
              ? "Conector MCP ativado para consultas externas"
              : "Conector MCP pausado temporariamente",
            responsePreview: {
              action: "toggle_enabled",
              operator: operatorName,
              previousEnabled: current.enabled,
              newEnabled: enabled,
            },
          });
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            enabled,
            auditLogs: [logEntry, ...current.auditLogs],
          });
          return jsonResponse({
            ok: true,
            settings: updated,
          });
        }

        if (action === "rotate_primary_token") {
          const newToken = generateMcpTokenForTenant(tenantId);
          const nowIso = new Date().toISOString();
          const logEntry = buildConfigAuditEntry({
            operatorName,
            clientIp,
            toolName: "config_rotate_primary_token",
            toolLabel: "Rotação do Link Único Principal",
            argumentsSummary: `Rotação de chave principal por ${operatorName}`,
            argumentsRaw: { action, rotatedBy: operatorName },
            resultSummary: `Novo token principal gerado (${newToken.slice(0, 12)}...)`,
            responsePreview: {
              action: "rotate_primary_token",
              operator: operatorName,
              previousTokenPrefix: `${current.primaryToken.slice(0, 12)}...`,
              newTokenPrefix: `${newToken.slice(0, 12)}...`,
              rotatedAt: nowIso,
            },
          });
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            primaryToken: newToken,
            primaryTokenUpdatedAt: nowIso,
            auditLogs: [logEntry, ...current.auditLogs],
          });
          return jsonResponse({
            ok: true,
            settings: updated,
          });
        }

        if (action === "restore_default_token") {
          const defaultToken = getDefaultPrimaryToken(tenantId);
          const nowIso = new Date().toISOString();
          const logEntry = buildConfigAuditEntry({
            operatorName,
            clientIp,
            toolName: "config_restore_default_token",
            toolLabel: "Restauração do Link Oficial Padrão",
            argumentsSummary: `Restaurado para o token oficial padrão por ${operatorName}`,
            argumentsRaw: { action, restoredBy: operatorName },
            resultSummary: `Link Principal restaurado (${defaultToken.slice(0, 12)}...)`,
            responsePreview: {
              action: "restore_default_token",
              operator: operatorName,
              restoredTokenPrefix: `${defaultToken.slice(0, 12)}...`,
              restoredAt: nowIso,
            },
          });
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            primaryToken: defaultToken,
            primaryTokenUpdatedAt: nowIso,
            auditLogs: [logEntry, ...current.auditLogs],
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
            createdBy: operatorName,
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            usageCount: 0,
            active: true,
          };
          const logEntry = buildConfigAuditEntry({
            operatorName,
            clientIp,
            toolName: "config_create_named_key",
            toolLabel: "Criação de Link Individual",
            argumentsSummary: `Novo link criado para "${newKey.label}"`,
            argumentsRaw: { action, label: newKey.label, keyId: newKey.id },
            resultSummary: `Chave individual "${newKey.label}" gerada por ${operatorName}`,
            responsePreview: {
              action: "create_named_key",
              operator: operatorName,
              keyId: newKey.id,
              label: newKey.label,
              tokenPrefix: `${newKey.token.slice(0, 12)}...`,
              createdAt: newKey.createdAt,
            },
          });
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            namedKeys: [newKey, ...current.namedKeys],
            auditLogs: [logEntry, ...current.auditLogs],
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
          const targetKey = current.namedKeys.find((k) => k.id === keyId);
          const updatedKeys = current.namedKeys.map((k) =>
            k.id === keyId ? { ...k, active } : k,
          );
          const logEntry = buildConfigAuditEntry({
            operatorName,
            clientIp,
            toolName: "config_toggle_named_key",
            toolLabel: "Alteração de Status de Link Individual",
            argumentsSummary: `Link "${targetKey?.label || keyId}" ${active ? "ATIVADO" : "PAUSADO"}`,
            argumentsRaw: { action, keyId, label: targetKey?.label, active },
            resultSummary: `Link "${targetKey?.label || keyId}" foi ${active ? "ativado" : "pausado"} por ${operatorName}`,
            responsePreview: {
              action: "toggle_named_key",
              operator: operatorName,
              keyId,
              label: targetKey?.label || keyId,
              active,
            },
          });
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            namedKeys: updatedKeys,
            auditLogs: [logEntry, ...current.auditLogs],
          });
          return jsonResponse({
            ok: true,
            settings: updated,
          });
        }

        if (action === "delete_named_key") {
          const keyId = String(body.keyId || "").trim();
          const targetKey = current.namedKeys.find((k) => k.id === keyId);
          const updatedKeys = current.namedKeys.filter((k) => k.id !== keyId);
          const logEntry = buildConfigAuditEntry({
            operatorName,
            clientIp,
            toolName: "config_delete_named_key",
            toolLabel: "Revogação de Link Individual",
            argumentsSummary: `Link "${targetKey?.label || keyId}" revogado/excluído`,
            argumentsRaw: { action, keyId, label: targetKey?.label },
            resultSummary: `Link individual "${targetKey?.label || keyId}" revogado permanentemente por ${operatorName}`,
            responsePreview: {
              action: "delete_named_key",
              operator: operatorName,
              keyId,
              revokedLabel: targetKey?.label || keyId,
              previousUsageCount: targetKey?.usageCount ?? 0,
            },
          });
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            namedKeys: updatedKeys,
            auditLogs: [logEntry, ...current.auditLogs],
          });
          return jsonResponse({
            ok: true,
            settings: updated,
          });
        }

        if (action === "clear_audit_logs") {
          const clearedCount = current.auditLogs.length;
          const logEntry = buildConfigAuditEntry({
            operatorName,
            clientIp,
            toolName: "config_clear_audit_logs",
            toolLabel: "Limpeza do Histórico de Auditoria",
            argumentsSummary: `${clearedCount} registro(s) anterior(es) limpo(s) por ${operatorName}`,
            argumentsRaw: { action, clearedCount, clearedBy: operatorName },
            resultSummary: `Histórico reiniciado (${clearedCount} eventos anteriores arquivados/limpos)`,
            responsePreview: {
              action: "clear_audit_logs",
              operator: operatorName,
              clearedEntriesCount: clearedCount,
              clearedAt: new Date().toISOString(),
            },
          });
          const updated = await saveMcpTenantSettings(tenantId, {
            ...current,
            auditLogs: [logEntry],
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
