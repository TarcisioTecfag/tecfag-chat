import { randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { channelConfigs, conversations, whatsappConnections } from "../../db/schema";
import { multiConnectionEnabled } from "./connection-policy";
import { encryptConnectionAuth } from "./connection-crypto";

export function conversationConnectionCondition(connectionId?: string | null) {
  return connectionId
    ? eq(conversations.whatsappConnectionId, connectionId)
    : isNull(conversations.whatsappConnectionId);
}

export async function readBaileysConfig(tenantId: string, connectionId?: string | null) {
  if (!connectionId) {
    const [cfg] = await db
      .select()
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, tenantId));
    return cfg;
  }
  if (!multiConnectionEnabled(tenantId))
    throw new Error("Múltiplas conexões não habilitadas para esta empresa.");
  const [cfg] = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.id, connectionId),
        eq(whatsappConnections.enabled, true),
      ),
    );
  if (!cfg) throw new Error("Conexão indisponível.");
  return {
    ...cfg,
    activeProvider: cfg.provider,
    connectionStatus: cfg.baileysSessionStatus,
    baileysAuthKeys: null,
  };
}

export async function updateBaileysConfig(
  tenantId: string,
  connectionId: string | null,
  values: Partial<typeof channelConfigs.$inferInsert>,
  leaseToken?: string | null,
) {
  if (!connectionId) {
    await db.update(channelConfigs).set(values).where(eq(channelConfigs.tenantId, tenantId));
    return;
  }
  const { baileysSessionStatus, baileysPairedPhone } = values;
  if (baileysPairedPhone) {
    const [original] = await db
      .select({ phone: whatsappConnections.baileysPairedPhone })
      .from(whatsappConnections)
      .where(
        and(eq(whatsappConnections.tenantId, tenantId), eq(whatsappConnections.id, connectionId)),
      );
    if (original?.phone && original.phone !== baileysPairedPhone)
      throw new Error(
        "Este atendimento pertence a outro número. Crie uma nova conexão para parear este telefone.",
      );
    const [corporate] = await db
      .select({ id: channelConfigs.id })
      .from(channelConfigs)
      .where(
        and(
          eq(channelConfigs.tenantId, tenantId),
          eq(channelConfigs.baileysPairedPhone, baileysPairedPhone),
        ),
      )
      .limit(1);
    if (corporate) throw new Error("Número já vinculado a uma conexão principal.");
  }
  const [updated] = await db
    .update(whatsappConnections)
    .set({
      ...(baileysSessionStatus != null ? { baileysSessionStatus } : {}),
      ...(baileysPairedPhone ? { baileysPairedPhone } : {}),
      ...(values.baileysAuthKeys === null ? { authEncrypted: null } : {}),
      ...(values.lastError !== undefined ? { lastError: values.lastError } : {}),
      ...(baileysSessionStatus && baileysSessionStatus !== "qr_ready"
        ? { qrEncrypted: null, qrExpiresAt: null }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.id, connectionId),
        leaseToken ? eq(whatsappConnections.leaseToken, leaseToken) : sql`false`,
        sql`${whatsappConnections.leaseUntil} > now()`,
      ),
    )
    .returning({ id: whatsappConnections.id });
  if (!updated) throw new Error("A sessão perdeu a posse da conexão.");
}

export async function storeConnectionQr(
  tenantId: string,
  connectionId: string,
  token: string,
  qr: string,
) {
  await db
    .update(whatsappConnections)
    .set({
      qrEncrypted: encryptConnectionAuth(tenantId, `${connectionId}:qr`, qr),
      qrExpiresAt: new Date(Date.now() + 45_000),
    })
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.id, connectionId),
        eq(whatsappConnections.leaseToken, token),
        sql`${whatsappConnections.leaseUntil} > now()`,
      ),
    );
}

export async function acquireConnectionLease(tenantId: string, connectionId: string) {
  const token = randomUUID();
  const [row] = await db
    .update(whatsappConnections)
    .set({ leaseToken: token, leaseUntil: new Date(Date.now() + 90_000) })
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.id, connectionId),
        eq(whatsappConnections.enabled, true),
        or(isNull(whatsappConnections.leaseUntil), sql`${whatsappConnections.leaseUntil} < now()`),
      ),
    )
    .returning({ id: whatsappConnections.id });
  if (!row)
    throw new Error("Conexão em uso por outra instância. Aguarde a sessão anterior encerrar.");
  return token;
}

export async function renewConnectionLease(tenantId: string, connectionId: string, token: string) {
  const [row] = await db
    .update(whatsappConnections)
    .set({ leaseUntil: new Date(Date.now() + 90_000) })
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.id, connectionId),
        eq(whatsappConnections.leaseToken, token),
        eq(whatsappConnections.enabled, true),
        sql`${whatsappConnections.leaseUntil} > now()`,
      ),
    )
    .returning({ id: whatsappConnections.id });
  return !!row;
}

export async function releaseConnectionLease(
  tenantId: string,
  connectionId: string,
  token: string,
  revokeAuth = false,
) {
  await db
    .update(whatsappConnections)
    .set({
      leaseToken: null,
      leaseUntil: null,
      qrEncrypted: null,
      qrExpiresAt: null,
      baileysSessionStatus: "disconnected",
      ...(revokeAuth ? { authEncrypted: null } : {}),
    })
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.id, connectionId),
        eq(whatsappConnections.leaseToken, token),
      ),
    );
}

export async function resolveConversationConnection(tenantId: string, conversationId: string) {
  const [conversation] = await db
    .select({ id: conversations.id, whatsappConnectionId: conversations.whatsappConnectionId })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
    .limit(1);
  if (!conversation) throw new Error("Conversa não encontrada.");
  const connectionId = conversation.whatsappConnectionId;
  const config = await readBaileysConfig(tenantId, connectionId);
  if (!config) throw new Error("Conexão não configurada.");
  return {
    connectionId,
    provider: config.activeProvider as "meta" | "baileys",
    status: config.connectionStatus,
    config,
  };
}
