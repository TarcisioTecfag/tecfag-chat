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
