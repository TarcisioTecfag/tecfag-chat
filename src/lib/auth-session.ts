import { db } from "../db/index.js";
import { authSessions, operators, accessGroups } from "../db/schema.js";
import { eq, and, gt, isNull } from "drizzle-orm";
import { generateSessionToken, hashSessionToken } from "./auth-crypto.js";
import { DEFAULT_ADMIN_PERMISSIONS, normalizeGroupPermissions } from "./rbac.js";

export const SESSION_COOKIE_NAME = "session_token";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export interface SanitizedOperator {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: string;
  avatar: string | null;
  status: string;
  groupId: string | null;
  isOnline: boolean;
  createdAt: Date;
}

export interface AuthSessionContext {
  sessionId: string;
  tokenHash: string;
  tenantId: string;
  operator: SanitizedOperator;
  accessGroup: any;
  permissions: any;
  expiresAt: Date;
}

/**
 * Sanitiza o registro de operador, eliminando terminantemente o passwordHash.
 */
export function sanitizeOperator(op: any): SanitizedOperator {
  return {
    id: op.id,
    tenantId: op.tenantId,
    name: op.name,
    email: op.email,
    role: op.role,
    avatar: op.avatar ?? null,
    status: op.status ?? "disponivel",
    groupId: op.groupId ?? null,
    isOnline: !!op.isOnline,
    createdAt: op.createdAt instanceof Date ? op.createdAt : new Date(op.createdAt),
  };
}

/**
 * Cria uma nova sessão no servidor para o operador autenticado.
 */
export async function createSession(tenantId: string, operatorId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const sessionId = `sess-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  await db.insert(authSessions).values({
    id: sessionId,
    tenantId,
    operatorId,
    tokenHash,
    expiresAt,
    createdAt: new Date(),
  });

  return { token, expiresAt };
}

/**
 * Revoga uma sessão ativa por token bruto.
 */
export async function revokeSessionByToken(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)));
}

/**
 * Revoga todas as sessões de um operador (ao alterar senha ou excluir operador).
 */
export async function revokeAllOperatorSessions(operatorId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.operatorId, operatorId), isNull(authSessions.revokedAt)));
}

/**
 * Faz o parsing de cookies a partir do header da requisição.
 */
export function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get("Cookie") || request.headers.get("cookie") || "";
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(";").forEach((part) => {
    const [rawKey, ...valParts] = part.trim().split("=");
    if (rawKey) {
      cookies[rawKey.trim()] = decodeURIComponent(valParts.join("=").trim());
    }
  });

  return cookies;
}

/**
 * Extrai o token de sessão do Cookie HttpOnly ou do Header Authorization Bearer.
 */
export function extractSessionToken(request: Request): string | null {
  const cookies = parseCookies(request);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }

  const authHeader = request.headers.get("Authorization") || request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.substring(7).trim();
  }

  return null;
}

/**
 * Obtém e valida a sessão do servidor a partir da requisição.
 * Retorna o contexto completo com operador sanitizado e permissões, ou null se não autenticado.
 */
export async function getAuthSession(request: Request): Promise<AuthSessionContext | null> {
  const token = extractSessionToken(request);
  if (!token) return null;

  const tokenHash = hashSessionToken(token);

  // Buscar sessão válida (não expirada e não revogada)
  const sessionRow = await db.query.authSessions.findFirst({
    where: and(
      eq(authSessions.tokenHash, tokenHash),
      isNull(authSessions.revokedAt),
      gt(authSessions.expiresAt, new Date())
    ),
  });

  if (!sessionRow) return null;

  // Buscar operador correspondente estritamente pelo tenant da sessão
  const operatorRow = await db.query.operators.findFirst({
    where: and(
      eq(operators.id, sessionRow.operatorId),
      eq(operators.tenantId, sessionRow.tenantId)
    ),
  });

  if (!operatorRow) return null;

  // Carregar grupo de acesso e permissões
  let groupRow: any = null;
  if (operatorRow.groupId) {
    groupRow = await db.query.accessGroups.findFirst({
      where: and(
        eq(accessGroups.id, operatorRow.groupId),
        eq(accessGroups.tenantId, sessionRow.tenantId)
      ),
    });
  }

  const defaultAdmin = {
    id: "group-admin",
    name: "Administrador",
    tenantId: sessionRow.tenantId,
    allowedTenants: [sessionRow.tenantId],
    allowedChannels: ["whatsapp", "instagram", "messenger", "livechat"],
    canCreateUser: true,
    canResetPassword: true,
    canEditProfile: true,
    canCaptureChat: true,
    canTransferChat: true,
    canFinishChat: true,
    canViewAllChats: true,
    canOverrideChat: true,
    permissions: DEFAULT_ADMIN_PERMISSIONS,
  };

  const currentGroup = groupRow || defaultAdmin;
  const permissions = normalizeGroupPermissions(currentGroup);

  return {
    sessionId: sessionRow.id,
    tokenHash: sessionRow.tokenHash,
    tenantId: sessionRow.tenantId,
    operator: sanitizeOperator(operatorRow),
    accessGroup: currentGroup,
    permissions,
    expiresAt: sessionRow.expiresAt,
  };
}

/**
 * Cria o cabeçalho Set-Cookie para a sessão HttpOnly.
 */
export function buildSessionCookie(token: string, expiresAt: Date): string {
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "Secure; " : "";
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${expiresAt.toUTCString()}; ${secureFlag}`;
}

/**
 * Cria o cabeçalho Set-Cookie para revogar/expirar o cookie de sessão no logout.
 */
export function buildLogoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// ── Rate Limiter em Memória para Login ─────────────────────────────────────────
interface LoginAttempt {
  count: number;
  resetAt: number;
}
const loginAttempts = new Map<string, LoginAttempt>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_WINDOW_MS = 5 * 60 * 1000; // 5 minutos

export function checkLoginRateLimit(identifier: string): { allowed: boolean; remainingSeconds: number } {
  const now = Date.now();
  const entry = loginAttempts.get(identifier);

  if (!entry || now > entry.resetAt) {
    return { allowed: true, remainingSeconds: 0 };
  }

  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    const remainingSeconds = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remainingSeconds };
  }

  return { allowed: true, remainingSeconds: 0 };
}

export function recordFailedLogin(identifier: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(identifier);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(identifier, { count: 1, resetAt: now + LOGIN_LOCK_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function resetLoginRateLimit(identifier: string): void {
  loginAttempts.delete(identifier);
}

// ── Helpers Padronizados de Autorização HTTP ──────────────────────────────────

/**
 * Exige sessão ativa. Retorna Response 401 caso ausente ou inválida.
 */
export async function requireSession(request: Request): Promise<{ session: AuthSessionContext } | { response: Response }> {
  const session = await getAuthSession(request);
  if (!session) {
    return {
      response: new Response(
        JSON.stringify({
          error: "Sessão inválida ou expirada. Efetue login novamente.",
          code: "UNAUTHORIZED",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }
  return { session };
}

/**
 * Valida consistência de tenant entre a sessão e o parâmetro requisitado.
 * Caso haja divergência transversal, responde 404 (sem vazar a existência do recurso de outro tenant).
 */
export function validateTenantAccess(session: AuthSessionContext, requestedTenantId?: string | null): Response | null {
  if (requestedTenantId && requestedTenantId !== session.tenantId) {
    return new Response(
      JSON.stringify({
        error: "Recurso não encontrado.",
        code: "NOT_FOUND",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  return null;
}

/**
 * Valida uma permissão específica do operador na sessão. Retorna 403 se negado.
 */
export function requirePermission(
  session: AuthSessionContext,
  permissionCheck: (perms: any) => boolean,
  customMessage = "Permissão insuficiente para esta ação."
): Response | null {
  if (session.operator.role === "admin") return null;

  if (!permissionCheck(session.permissions)) {
    return new Response(
      JSON.stringify({
        error: customMessage,
        code: "FORBIDDEN",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  return null;
}
