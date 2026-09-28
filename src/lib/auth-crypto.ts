import crypto from "node:crypto";

/**
 * Utilitários criptográficos para autenticação segura com scrypt e sessões via token hash.
 */

const SCRYPT_KEYLEN = 64;

/**
 * Gera hash seguro usando scrypt com salt aleatório.
 * Formato persistido: scrypt:<salt_hex>:<derived_key_hex>
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Verifica senha contra hash scrypt ou transição segura de hash/senha legada em texto simples.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;

  if (storedHash.startsWith("scrypt:")) {
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const [, salt, expectedHashHex] = parts;
    const actualKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const expectedKey = Buffer.from(expectedHashHex, "hex");
    if (actualKey.length !== expectedKey.length) return false;
    return crypto.timingSafeEqual(actualKey, expectedKey);
  }

  // Transição de senhas legadas (texto simples armazenado no passado)
  // Usamos comparação segura contra timing attacks
  const actualBuf = Buffer.from(password);
  const storedBuf = Buffer.from(storedHash);
  if (actualBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, storedBuf);
}

/**
 * Indica se a senha precisa ser migrada para scrypt
 */
export function needsPasswordMigration(storedHash: string): boolean {
  return !storedHash || !storedHash.startsWith("scrypt:");
}

/**
 * Gera um token de sessão criptograficamente aleatório (64 caracteres hexadecimais = 256 bits).
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Gera o hash SHA-256 do token para persistência segura no banco.
 * Apenas o hash é salvo no banco de dados. O token bruto fica exclusivamente no cookie HttpOnly.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Assina um estado OAuth para associar tenantId e operatorId de forma criptograficamente inviolável.
 * Formato: <tenantId>.<operatorId>.<timestamp>.<hmacSignature>
 */
export function createSignedOAuthState(tenantId: string, operatorId: string): string {
  const timestamp = Date.now().toString();
  const payload = `${tenantId}.${operatorId}.${timestamp}`;
  const secret = process.env.SESSION_SECRET || "valem-oauth-session-secret-key";
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

/**
 * Valida o estado OAuth assinado e recupera o tenantId e operatorId.
 * Validade máxima: 15 minutos (900.000 ms).
 */
export function verifySignedOAuthState(state: string): { valid: boolean; tenantId?: string; operatorId?: string; error?: string } {
  if (!state || typeof state !== "string") {
    return { valid: false, error: "Estado de autorização ausente." };
  }
  const parts = state.split(".");
  if (parts.length !== 4) {
    return { valid: false, error: "Formato de estado de autorização inválido." };
  }
  const [tenantId, operatorId, timestampStr, providedSignature] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp) || Date.now() - timestamp > 15 * 60 * 1000 || timestamp > Date.now() + 60 * 1000) {
    return { valid: false, error: "Estado de autorização expirado (limite de 15 minutos)." };
  }

  const payload = `${tenantId}.${operatorId}.${timestampStr}`;
  const secret = process.env.SESSION_SECRET || "valem-oauth-session-secret-key";
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const providedBuf = Buffer.from(providedSignature, "hex");
  const expectedBuf = Buffer.from(expectedSignature, "hex");

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, error: "Assinatura do estado de autorização inválida." };
  }

  return { valid: true, tenantId, operatorId };
}
