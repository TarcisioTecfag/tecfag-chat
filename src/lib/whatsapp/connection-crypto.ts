import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { connectionScope } from "./connection-policy";

function key() {
  const value = process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(value))
    throw new Error("Configure WHATSAPP_CONNECTION_ENCRYPTION_KEY com 32 bytes em hexadecimal.");
  return Buffer.from(value, "hex");
}
export function connectionEncryptionReady() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
export function encryptConnectionAuth(tenantId: string, connectionId: string, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(connectionScope(tenantId, connectionId)));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}
export function decryptConnectionAuth(tenantId: string, connectionId: string, envelope: string) {
  const [version, iv, tag, ciphertext, extra] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra)
    throw new Error("Credencial de conexão inválida.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(connectionScope(tenantId, connectionId)));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
