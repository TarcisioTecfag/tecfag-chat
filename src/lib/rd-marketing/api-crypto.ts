import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const encoded = process.env.RD_MARKETING_ENCRYPTION_KEY || "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("RD_MARKETING_ENCRYPTION_KEY_INVALID");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("RD_MARKETING_ENCRYPTION_KEY_INVALID");
  return key;
}
export function rdEncryptionReady(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
export function encryptRdSecret(tenantId: string, purpose: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`rd-marketing:${tenantId}:${purpose}`));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}
export function decryptRdSecret(tenantId: string, purpose: string, envelope: string): string {
  const [version, iv, tag, encrypted, extra] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || extra)
    throw new Error("RD_MARKETING_ENCRYPTED_VALUE_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(`rd-marketing:${tenantId}:${purpose}`));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
