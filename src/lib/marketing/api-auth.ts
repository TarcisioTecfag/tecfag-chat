import { requireSession } from "../auth-session";
import {
  recordMcpToolAuditLog,
  resolveMcpAccess,
  type McpAccessContext,
} from "../mcp/valem-tecfag-mcp-core";

export const MARKETING_API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Accept, x-api-key, x-mcp-token, x-mcp-client-name",
  "Cache-Control": "no-store",
};

export interface MarketingApiAuthSuccess {
  tenantId: string;
  access: McpAccessContext;
  startedAt: number;
}

export function jsonMarketingResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...MARKETING_API_CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function optionsMarketingResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: MARKETING_API_CORS_HEADERS,
  });
}

/**
 * Autentica requisições de `/api/v1/marketing/*` aceitando:
 * - Header `Authorization: Bearer <TOKEN>` (recomendado para scripts Python `.env`)
 * - Header `x-api-key: <TOKEN>` ou `x-mcp-token: <TOKEN>`
 * - Sessão autenticada do painel (`requireSession` delegado via `resolveMcpAccess`)
 *
 * Isolamento Multi-Tenant Estrito:
 * - Tokens vinculados a um tenant (`mcp_tf_*`, `mcp_vl_*` ou chaves nomeadas do painel MCP)
 *   travam `tenantId` no servidor; tentativas de consultar outro `tenantId` na query retornam 403.
 */
export async function requireMarketingApiAccess(
  request: Request,
): Promise<MarketingApiAuthSuccess | { response: Response }> {
  const startedAt = Date.now();

  // Suporta `x-api-key` mapeando para `x-mcp-token` caso `Authorization` não esteja presente
  let normalizedReq = request;
  const xApiKey = request.headers.get("x-api-key")?.trim();
  if (xApiKey && !request.headers.get("authorization") && !request.headers.get("x-mcp-token")) {
    const headers = new Headers(request.headers);
    headers.set("x-mcp-token", xApiKey);
    normalizedReq = new Request(request.url, {
      method: request.method,
      headers,
    });
  }

  const access = await resolveMcpAccess(normalizedReq);
  if (!access.authorized) {
    return {
      response: jsonMarketingResponse(
        {
          error:
            "Não autorizado. Informe `Authorization: Bearer <CRM_API_TOKEN>` no header (configurado no .env local).",
          code: "UNAUTHORIZED",
        },
        401,
      ),
    };
  }

  // Se autenticado via sessão de operador no navegador (sem Bearer token de integração), exige papel admin
  if (access.authMode === "session") {
    const sessAuth = await requireSession(request);
    if ("response" in sessAuth) return sessAuth;
    if (sessAuth.session.operator.role !== "admin") {
      return {
        response: jsonMarketingResponse(
          {
            error: "Permissão insuficiente: endpoints em massa de Marketing exigem token de integração ou perfil Administrador.",
            code: "FORBIDDEN",
          },
          403,
        ),
      };
    }
  }

  const url = new URL(request.url);
  const requestedTenant = (
    url.searchParams.get("tenant_id") ||
    url.searchParams.get("tenantId") ||
    ""
  )
    .trim()
    .toLowerCase();

  if (access.lockedTenantId) {
    if (requestedTenant && requestedTenant !== access.lockedTenantId) {
      return {
        response: jsonMarketingResponse(
          {
            error: "Acesso negado: o token utilizado pertence exclusivamente a outra empresa (tenant).",
            code: "TENANT_FORBIDDEN",
          },
          403,
        ),
      };
    }
    return {
      tenantId: access.lockedTenantId,
      access,
      startedAt,
    };
  }

  // Apenas token_admin pode selecionar tenant explicitamente
  const resolvedTenant =
    requestedTenant === "valem" || requestedTenant === "tecfag"
      ? requestedTenant
      : access.defaultTenantId;

  return {
    tenantId: resolvedTenant,
    access,
    startedAt,
  };
}

export async function auditMarketingApiCall(params: {
  auth: MarketingApiAuthSuccess;
  endpointName: string;
  endpointLabel: string;
  queryArgs: Record<string, unknown>;
  returnedCount: number;
  status?: "success" | "error";
  errorMessage?: string;
}): Promise<void> {
  if (params.auth.tenantId !== "tecfag" && params.auth.tenantId !== "valem") return;
  try {
    await recordMcpToolAuditLog({
      tenantId: params.auth.tenantId,
      access: {
        ...params.auth.access,
        transport: "REST API v1 (/api/v1/marketing)",
      },
      toolName: `api_v1_${params.endpointName}`,
      toolLabel: `API Marketing · ${params.endpointLabel}`,
      toolArgs: params.queryArgs,
      resultSummary:
        params.status === "error"
          ? `Erro: ${params.errorMessage || "Falha na consulta"}`
          : `${params.returnedCount} registro(s) retornado(s)`,
      status: params.status || "success",
      latencyMs: Math.max(0, Date.now() - params.auth.startedAt),
      eventType: "query",
      transport: "REST API v1 (/api/v1/marketing)",
    });
  } catch {
    // Auditoria não deve interromper resposta de dados
  }
}
