import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key() {
  const raw = process.env.VTEX_CREDENTIALS_ENCRYPTION_KEY || "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error("VTEX_ENCRYPTION_UNAVAILABLE");
  const value = Buffer.from(raw, "base64");
  if (value.length !== 32) throw new Error("VTEX_ENCRYPTION_UNAVAILABLE");
  return value;
}
export function vtexEncryptionReady() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
export function encryptVtexCredentials(
  tenantId: string,
  account: string,
  value: { appKey: string; appToken: string },
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`vtex:${tenantId}:${account}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}
export function decryptVtexCredentials(tenantId: string, account: string, envelope: string) {
  const [version, iv, tag, data, extra] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra)
    throw new Error("VTEX_CREDENTIALS_INVALID");
  const decode = (raw: string, length?: number) => {
    const decoded = Buffer.from(raw, "base64");
    if (
      raw.length > 40_000 ||
      decoded.toString("base64") !== raw ||
      (length && decoded.length !== length)
    )
      throw new Error("VTEX_CREDENTIALS_INVALID");
    return decoded;
  };
  const decipher = createDecipheriv("aes-256-gcm", key(), decode(iv, 12));
  decipher.setAAD(Buffer.from(`vtex:${tenantId}:${account}`));
  decipher.setAuthTag(decode(tag, 16));
  const value = JSON.parse(
    Buffer.concat([decipher.update(decode(data)), decipher.final()]).toString("utf8"),
  );
  if (typeof value.appKey !== "string" || typeof value.appToken !== "string")
    throw new Error("VTEX_CREDENTIALS_INVALID");
  return value as { appKey: string; appToken: string };
}
