/**
 * rdCrmService.ts
 * Serviço de integração com o RD Station CRM v2 para o Tecfag Chat.
 *
 * Replicado do código existente em Tecfag I.A Faggner (server/fagner/rdCrmService.ts
 * e server/livechat/rdCrmService.ts) — mesma API v2, mesmo fluxo OAuth2,
 * mesmo wrapper { data: body }, mesma lógica de phone search.
 */

import { db } from "../db";
import { channelConfigs } from "../db/schema";
import { eq } from "drizzle-orm";

// ─── Constantes (replicadas do sistema existente) ────────────────────────────
const RD_CRM_API = "https://api.rd.services/crm/v2";
const RD_AUTH_URL = "https://api.rd.services/oauth2/token";

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface RdToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // timestamp ms
}

// Cache em memória por tenant (sobrevive durante o uptime, resetado no deploy)
const _tokenCacheByTenant: Record<string, RdToken> = {};

// ─── Token Storage (persistência no banco — sobrevive a redeploys) ───────────

async function loadTokenFromDb(tenantId: string): Promise<RdToken | null> {
  try {
    const config = await db.query.channelConfigs.findFirst({
      where: eq(channelConfigs.tenantId, tenantId),
    });

    if (!config) return null;

    const at = config.rdCrmAccessToken;
    const rt = config.rdCrmRefreshToken;
    const exp = parseInt(config.rdCrmTokenExpiresAt ?? "0", 10) || Date.now();

    if (!at || !rt) return null;
    return { accessToken: at, refreshToken: rt, expiresAt: exp };
  } catch (e: any) {
    console.error(`[RD CRM] Erro ao carregar token do banco para ${tenantId}:`, e.message);
    return null;
  }
}

async function saveTokenToDb(tenantId: string, token: RdToken): Promise<void> {
  _tokenCacheByTenant[tenantId] = token;

  try {
    await db
      .update(channelConfigs)
      .set({
        rdCrmAccessToken: token.accessToken,
        rdCrmRefreshToken: token.refreshToken,
        rdCrmTokenExpiresAt: token.expiresAt.toString(),
        updatedAt: new Date(),
      })
      .where(eq(channelConfigs.tenantId, tenantId));
    console.log(`[RD CRM] Tokens persistidos no banco para tenant ${tenantId}.`);
  } catch (e: any) {
    console.warn(`[RD CRM] Falha ao persistir tokens para ${tenantId}:`, e.message);
  }
}

// ─── OAuth2 Refresh Token Flow ───────────────────────────────────────────────

async function getClientCredentials(tenantId: string): Promise<{ clientId: string; clientSecret: string } | null> {
  try {
    // Primeiro tenta variáveis de ambiente (Railway)
    const envClientId = process.env.RD_CRM_CLIENT_ID;
    const envClientSecret = process.env.RD_CRM_CLIENT_SECRET;
    if (envClientId && envClientSecret) {
      return { clientId: envClientId, clientSecret: envClientSecret };
    }

    // Fallback: busca do banco
    const config = await db.query.channelConfigs.findFirst({
      where: eq(channelConfigs.tenantId, tenantId),
    });
    if (config?.rdCrmClientId && config?.rdCrmClientSecret) {
      return { clientId: config.rdCrmClientId, clientSecret: config.rdCrmClientSecret };
    }
    return null;
  } catch {
    return null;
  }
}

async function refreshAccessToken(tenantId: string): Promise<RdToken> {
  const current = await loadTokenFromDb(tenantId);
  const creds = await getClientCredentials(tenantId);

  if (!creds) {
    throw new Error(`[RD CRM] Credenciais OAuth2 não configuradas para tenant ${tenantId}. Configure RD_CRM_CLIENT_ID e RD_CRM_CLIENT_SECRET.`);
  }

  const refreshToken = current?.refreshToken;
  if (!refreshToken) {
    throw new Error(`[RD CRM] Nenhum refresh_token disponível para tenant ${tenantId}. Autorize o app via OAuth callback.`);
  }

  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(RD_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[RD CRM] Falha ao renovar token: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const token: RdToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // Token rotativo! O RD CRM retorna um NOVO refresh_token.
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await saveTokenToDb(tenantId, token);
  console.log(`[RD CRM] Token renovado e persistido para tenant ${tenantId}.`);
  return token;
}

/** Retorna um access_token válido, renovando se necessário. */
export async function getValidToken(tenantId: string): Promise<string> {
  if (!_tokenCacheByTenant[tenantId]) {
    const fromDb = await loadTokenFromDb(tenantId);
    if (fromDb) _tokenCacheByTenant[tenantId] = fromDb;
  }

  const cached = _tokenCacheByTenant[tenantId];
  // Renova se expirar em menos de 5 minutos ou se não existe
  if (!cached || cached.expiresAt - Date.now() < 5 * 60_000) {
    _tokenCacheByTenant[tenantId] = await refreshAccessToken(tenantId);
  }

  return _tokenCacheByTenant[tenantId].accessToken;
}

/** Limpa o cache em memória — chamar após salvar novos tokens via OAuth callback */
export function clearTokenCache(tenantId: string): void {
  delete _tokenCacheByTenant[tenantId];
  console.log(`[RD CRM] 🔄 Token cache limpo para ${tenantId}. Próxima chamada carrega do banco.`);
}

// ─── Request Helper (replicado do sistema existente) ─────────────────────────

export async function rdRequest<T = any>(
  tenantId: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: object,
  retried = false
): Promise<T> {
  const token = await getValidToken(tenantId);
  const bodyStr: string | undefined = body ? JSON.stringify({ data: body }) : undefined;

  const res = await fetch(`${RD_CRM_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: bodyStr,
  });

  // Token expirado: força refresh e tenta de novo (uma vez)
  if (res.status === 401 && !retried) {
    delete _tokenCacheByTenant[tenantId];
    return rdRequest<T>(tenantId, method, path, body, true);
  }

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`[RD CRM] ${method} ${path} → ${res.status}: ${errBody}`);
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return json.data as T;
}

// ─── OAuth2 Authorization Code Exchange ──────────────────────────────────────

/** Troca o authorization code por access_token + refresh_token (usado no callback OAuth) */
export async function exchangeCodeForTokens(
  tenantId: string,
  code: string,
  redirectUri: string
): Promise<RdToken> {
  const creds = await getClientCredentials(tenantId);
  if (!creds) {
    throw new Error(`[RD CRM] Credenciais OAuth2 não configuradas para tenant ${tenantId}.`);
  }

  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(RD_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[RD CRM] Falha ao trocar code por tokens: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const token: RdToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  await saveTokenToDb(tenantId, token);
  console.log(`[RD CRM] ✅ Tokens obtidos via OAuth callback para tenant ${tenantId}.`);
  return token;
}

// ─── Phone Search Helper (cópia exata do fagner/rdCrmService.ts:86-116) ──────
//
// Problema real: o WhatsApp envia sempre COM o nono dígito (ex: 75 9 9233-9733),
// mas o CRM pode ter o contato salvo SEM o nono dígito (75 9233-9733), ou vice-versa.
// Geramos até 4 variantes para cobrir ambas as direções.

export function buildPhoneSearchTerms(rawPhone: string): string[] {
  const clean = rawPhone.replace(/\D/g, "");
  if (!clean) return [];

  // Normaliza para sem DDI
  const withoutDDI = clean.startsWith("55") && clean.length >= 12 ? clean.slice(2) : clean;
  const withDDI = withoutDDI.startsWith("55") ? withoutDDI : `55${withoutDDI}`;

  // Gera variante com/sem o nono dígito
  let withoutDDI_alt: string | null = null;
  if (withoutDDI.length === 11 && withoutDDI[2] === "9") {
    // 11 dígitos → remove o 9: 75 9 9233-9733 → 75 9233-9733
    withoutDDI_alt = withoutDDI.slice(0, 2) + withoutDDI.slice(3);
  } else if (withoutDDI.length === 10) {
    // 10 dígitos → insere 9: 75 9233-9733 → 75 9 9233-9733
    withoutDDI_alt = withoutDDI.slice(0, 2) + "9" + withoutDDI.slice(2);
  }

  const terms = new Set<string>();
  terms.add(withoutDDI);
  terms.add(withDDI);
  if (withoutDDI_alt) {
    terms.add(withoutDDI_alt);
    terms.add(`55${withoutDDI_alt}`);
  }

  return Array.from(terms);
}

// ─── Verificação de Configuração ─────────────────────────────────────────────

export async function isRdCrmConfigured(tenantId: string): Promise<boolean> {
  const creds = await getClientCredentials(tenantId);
  if (!creds) return false;

  const token = await loadTokenFromDb(tenantId);
  return !!(token?.accessToken && token?.refreshToken);
}
