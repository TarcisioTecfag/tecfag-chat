import { and, eq, gt, lt, sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "../../db";
import {
  rdMarketingConnections as connections,
  rdMarketingOAuthStates as states,
} from "../../db/schema";
import type { AuthSessionContext } from "../auth-session";
import { CrmError } from "../crm/crm-service";
import { decryptRdSecret, encryptRdSecret, rdEncryptionReady } from "./api-crypto";
import {
  parseRdContact,
  parseRdEventPage,
  rdContactPath,
  rdEventsPath,
  rdRequest,
  type RdFetch,
} from "./api-client";
import type { RdApiStatus, RdEventType, RdIdentifier, RdProbe } from "./api-types";

type Session = Pick<AuthSessionContext, "tenantId" | "tokenHash" | "operator">;
type Connection = typeof connections.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const whereTenant = (tenantId: string) => eq(connections.tenantId, tenantId);
const clearTokens = {
  accessTokenEncrypted: null,
  refreshTokenEncrypted: null,
  tokenExpiresAt: null,
  connectedAt: null,
};
function requireKey() {
  if (!rdEncryptionReady())
    throw new CrmError(
      "Configure a chave de criptografia no servidor antes de conectar o RD Marketing.",
      "RD_ENCRYPTION_REQUIRED",
      409,
    );
}
async function lock(tx: Transaction, tenantId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rd-api:${tenantId}`}, 0))`);
}
async function current(tx: Transaction, tenantId: string): Promise<Connection> {
  const [row] = await tx.select().from(connections).where(whereTenant(tenantId)).for("update");
  if (!row)
    throw new CrmError(
      "Salve as credenciais do aplicativo RD Marketing.",
      "RD_NOT_CONFIGURED",
      409,
    );
  return row;
}

export function rdCallbackUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
    throw new CrmError("A conexão com RD requer HTTPS.", "RD_HTTPS_REQUIRED", 400);
  return `${url.origin}/api/settings/rd-marketing/callback`;
}
export async function rdConnectionStatus(
  tenantId: string,
  requestUrl: string,
): Promise<RdApiStatus> {
  const [row] = await db.select().from(connections).where(whereTenant(tenantId));
  return {
    encryptionReady: rdEncryptionReady(),
    configured: !!row,
    connected: !!(row?.accessTokenEncrypted && row.refreshTokenEncrypted),
    clientId: row?.clientId || "",
    callbackUrl: rdCallbackUrl(requestUrl),
    connectedAt: row?.connectedAt?.toISOString() || null,
  };
}
export async function saveRdCredentials(tenantId: string, clientId: string, secret: string) {
  requireKey();
  clientId = clientId.trim();
  secret = secret.trim();
  if (!clientId || clientId.length > 512 || secret.length > 4096)
    throw new CrmError("Informe as credenciais válidas do aplicativo Marketing.", "BAD_REQUEST");
  await db.transaction(async (tx) => {
    await lock(tx, tenantId);
    const [row] = await tx.select().from(connections).where(whereTenant(tenantId)).for("update");
    if (!secret && (!row || row.clientId !== clientId))
      throw new CrmError(
        "Informe o Client Secret ao cadastrar ou trocar o aplicativo.",
        "BAD_REQUEST",
      );
    if (
      row &&
      row.clientId === clientId &&
      (!secret || decryptRdSecret(tenantId, "client-secret", row.clientSecretEncrypted) === secret)
    )
      return;
    const values = {
      tenantId,
      clientId,
      clientSecretEncrypted: encryptRdSecret(tenantId, "client-secret", secret),
      ...clearTokens,
      version: randomUUID(),
      updatedAt: new Date(),
    };
    if (row) await tx.update(connections).set(values).where(whereTenant(tenantId));
    else await tx.insert(connections).values(values);
    await tx.delete(states).where(eq(states.tenantId, tenantId));
  });
}
export async function disconnectRd(tenantId: string) {
  await db.transaction(async (tx) => {
    await lock(tx, tenantId);
    await tx
      .update(connections)
      .set({ ...clearTokens, version: randomUUID(), updatedAt: new Date() })
      .where(whereTenant(tenantId));
    await tx.delete(states).where(eq(states.tenantId, tenantId));
  });
}
export async function beginRdAuthorization(session: Session, requestUrl: string): Promise<string> {
  requireKey();
  const redirectUri = rdCallbackUrl(requestUrl),
    nonce = randomBytes(32).toString("hex");
  return db.transaction(async (tx) => {
    await lock(tx, session.tenantId);
    const row = await current(tx, session.tenantId);
    await tx
      .delete(states)
      .where(and(eq(states.tenantId, session.tenantId), lt(states.expiresAt, new Date())));
    await tx
      .delete(states)
      .where(and(eq(states.tenantId, session.tenantId), eq(states.sessionHash, session.tokenHash)));
    await tx.insert(states).values({
      stateHash: hash(nonce),
      tenantId: session.tenantId,
      operatorId: session.operator.id,
      sessionHash: session.tokenHash,
      connectionVersion: row.version,
      redirectUri,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    const url = new URL("https://api.rd.services/auth/dialog");
    url.search = new URLSearchParams({
      client_id: row.clientId,
      redirect_uri: redirectUri,
      state: nonce,
    }).toString();
    return url.toString();
  });
}
function tokenValues(tenantId: string, raw: unknown, previousRefresh?: string) {
  const token = raw as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  } | null;
  const refresh =
    typeof token?.refresh_token === "string" && token.refresh_token
      ? token.refresh_token
      : previousRefresh;
  const seconds = Number(token?.expires_in);
  if (
    !token ||
    typeof token.access_token !== "string" ||
    !token.access_token ||
    !refresh ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 365 * 86400
  )
    throw new CrmError("O RD retornou uma autorização incompleta.", "RD_TOKEN_INVALID", 502);
  return {
    accessTokenEncrypted: encryptRdSecret(tenantId, "access-token", token.access_token),
    refreshTokenEncrypted: encryptRdSecret(tenantId, "refresh-token", refresh),
    tokenExpiresAt: new Date(Date.now() + seconds * 1000),
    updatedAt: new Date(),
  };
}
export async function finishRdAuthorization(
  session: Session,
  requestUrl: string,
  nonce: string,
  code: string,
  fetchImpl?: RdFetch,
) {
  requireKey();
  if (!/^[a-f0-9]{64}$/.test(nonce) || !code || code.length > 4096)
    throw new CrmError(
      "Autorização inválida. Inicie a conexão novamente.",
      "RD_STATE_INVALID",
      400,
    );
  // Commit consumption before contacting the provider: failures cannot reuse a code/state.
  const credentials = await db.transaction(async (tx) => {
    await lock(tx, session.tenantId);
    const [pending] = await tx
      .delete(states)
      .where(
        and(
          eq(states.stateHash, hash(nonce)),
          eq(states.tenantId, session.tenantId),
          eq(states.operatorId, session.operator.id),
          eq(states.sessionHash, session.tokenHash),
          gt(states.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!pending || pending.redirectUri !== rdCallbackUrl(requestUrl))
      throw new CrmError(
        "Autorização expirada ou de outra sessão. Reconecte o RD.",
        "RD_STATE_INVALID",
        400,
      );
    const row = await current(tx, session.tenantId);
    if (row.version !== pending.connectionVersion)
      throw new CrmError(
        "As credenciais foram alteradas. Reconecte o RD.",
        "RD_STATE_INVALID",
        400,
      );
    return row;
  });
  const raw = await rdRequest(
    "/auth/token?token_by=code",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: credentials.clientId,
        client_secret: decryptRdSecret(
          session.tenantId,
          "client-secret",
          credentials.clientSecretEncrypted,
        ),
        code,
      }),
    },
    fetchImpl,
  );
  const values = tokenValues(session.tenantId, raw);
  await db.transaction(async (tx) => {
    await lock(tx, session.tenantId);
    const row = await current(tx, session.tenantId);
    if (row.version !== credentials.version)
      throw new CrmError(
        "A conexão foi alterada durante a autorização. Reconecte.",
        "RD_STATE_INVALID",
        409,
      );
    await tx
      .update(connections)
      .set({ ...values, connectedAt: new Date(), version: randomUUID() })
      .where(whereTenant(session.tenantId));
    await tx.delete(states).where(eq(states.tenantId, session.tenantId));
  });
}
async function accessToken(
  tenantId: string,
  fetchImpl?: RdFetch,
  rejected?: string,
): Promise<string> {
  requireKey();
  // Serialize refreshes, including refresh-token rotation, across server replicas.
  return db.transaction(async (tx) => {
    await lock(tx, tenantId);
    const row = await current(tx, tenantId);
    if (!row.accessTokenEncrypted || !row.refreshTokenEncrypted)
      throw new CrmError(
        "Autorize a conta RD Marketing antes de consultar.",
        "RD_NOT_CONNECTED",
        409,
      );
    const token = decryptRdSecret(tenantId, "access-token", row.accessTokenEncrypted);
    if (
      row.tokenExpiresAt &&
      row.tokenExpiresAt.getTime() > Date.now() + 60000 &&
      (!rejected || rejected !== token)
    )
      return token;
    const refresh = decryptRdSecret(tenantId, "refresh-token", row.refreshTokenEncrypted);
    const raw = await rdRequest(
      "/auth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: row.clientId,
          client_secret: decryptRdSecret(tenantId, "client-secret", row.clientSecretEncrypted),
          refresh_token: refresh,
        }),
      },
      fetchImpl,
    );
    const values = tokenValues(tenantId, raw, refresh);
    await tx.update(connections).set(values).where(whereTenant(tenantId));
    return decryptRdSecret(tenantId, "access-token", values.accessTokenEncrypted);
  });
}
async function readRd(tenantId: string, path: string, fetchImpl?: RdFetch) {
  let token = await accessToken(tenantId, fetchImpl);
  const read = () =>
    rdRequest(path, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, fetchImpl);
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof CrmError) || error.code !== "RD_HTTP_401") throw error;
    token = await accessToken(tenantId, fetchImpl, token);
    return read();
  }
}
export async function probeRdLead(
  tenantId: string,
  identifier: RdIdentifier,
  value: string,
  fetchImpl?: RdFetch,
): Promise<RdProbe> {
  const contact = parseRdContact(
    await readRd(tenantId, rdContactPath(identifier, value), fetchImpl),
  );
  const pages = await Promise.all(
    (["CONVERSION", "OPPORTUNITY"] as const).map((type) =>
      readRdEventPage(tenantId, contact.uuid, type, 1, fetchImpl),
    ),
  );
  return { contact, pages };
}
export async function readRdEventPage(
  tenantId: string,
  uuid: string,
  type: RdEventType,
  page: number,
  fetchImpl?: RdFetch,
) {
  const raw = await readRd(tenantId, rdEventsPath(uuid, type, page), fetchImpl);
  return parseRdEventPage(raw, type, page);
}
