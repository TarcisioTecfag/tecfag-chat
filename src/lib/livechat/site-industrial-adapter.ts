/**
 * Adaptador de entrada do widget do site para o núcleo de triagem industrial.
 *
 * O visitante (resolvido no servidor por tenant + cookie) vira um contato/conversa do canal
 * `livechat` no módulo de Conversas. As mensagens seguem o mesmo SdrDebouncer → SdrEngine →
 * handoff transacional usados pelo WhatsApp: não existe um segundo motor de regras para o site.
 * Tenants sem perfil industrial (Valem) não passam por aqui.
 */
import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { agentConfigs, contacts, conversations, mediaFiles, messages } from "../../db/schema";
import type { LcVisitor } from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";
import { SdrDebouncer } from "../valentina/sdr-debouncer";
import { reopenIndustrialSiteConversation } from "./site-conversation-store";
import {
  SITE_CHANNEL,
  SITE_PROVIDER,
  parseSiteChannelSettings,
  sanitizeSiteIdentity,
  siteIdentityIds,
  type SiteChannelSettings,
} from "./site-channel-policy";

export function usesIndustrialSiteCore(tenantId: string): boolean {
  return getAiPersona(tenantId).triagePolicy === "industrial";
}

export async function loadSiteChannelSettings(tenantId: string): Promise<SiteChannelSettings> {
  const [config] = await db
    .select({ enabled: agentConfigs.enabled, config: agentConfigs.config })
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr")))
    .limit(1);
  return parseSiteChannelSettings(config?.enabled === 1, config?.config as Record<string, unknown>);
}

/** Contato e conversa do visitante. Criados somente quando ele envia a primeira mensagem. */
export async function ensureSiteConversation(tenantId: string, visitor: LcVisitor) {
  const { contactId, conversationId } = siteIdentityIds(visitor.id);
  const identity = sanitizeSiteIdentity(visitor.name, visitor.cnpj || (visitor as { cpf?: string }).cpf);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${contactId}))`);
    await tx
      .insert(contacts)
      .values({
        id: contactId,
        tenantId,
        name: identity.name || "Visitante do site",
        mainChannel: SITE_CHANNEL,
        responsibleName: "Na Fila",
        cpf: identity.cpf,
        cnpj: identity.cnpj,
      })
      .onConflictDoNothing();
    const [contact] = await tx
      .select({ id: contacts.id, tenantId: contacts.tenantId })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
    if (!contact) throw new Error("Contato do site indisponível para esta empresa");
    const [existing] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId)))
      .for("update");
    if (existing) return existing;
    const now = new Date();
    const [created] = await tx
      .insert(conversations)
      .values({
        id: conversationId,
        tenantId,
        contactId,
        queueState: "automacao",
        unreadCount: 0,
        lastMessageText: "",
        version: 1,
        lastMessageTime: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  });
}

/** Reabre um atendimento finalizado como novo ciclo de triagem, preservando o histórico do ciclo anterior. */
async function reopenSiteConversation(tenantId: string, conversationId: string, inboundMessageId: string) {
  const reopened = await reopenIndustrialSiteConversation(db, tenantId, conversationId, inboundMessageId);
  if (!reopened) return;
  SessionManager.getInstance().notifyPublic(tenantId, {
    type: "queue_update",
    conversationId,
    queueState: reopened.queueState,
    operatorId: reopened.operatorId,
    sectorId: reopened.sectorId,
    version: reopened.version,
    responsibleName: `${getAiPersona(tenantId).name} IA`,
  });
}

/** Atualiza o contato com o pré-chat. Não cria conversa nem vincula telefone (posse não verificada). */
export async function applySiteIdentity(tenantId: string, visitorId: string, name: unknown, doc: unknown) {
  const { contactId } = siteIdentityIds(visitorId);
  const identity = sanitizeSiteIdentity(name, doc);
  const updates: Partial<typeof contacts.$inferInsert> = {};
  if (identity.name) updates.name = identity.name;
  if (identity.cpf) updates.cpf = identity.cpf;
  if (identity.cnpj) updates.cnpj = identity.cnpj;
  if (!Object.keys(updates).length) return identity;
  await db
    .update(contacts)
    .set(updates)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
  return identity;
}

export interface SiteInboundItem {
  /** ID da mensagem já persistida em `lc_messages` (deduplicada pelo widget). */
  siteMessageId: string;
  text: string;
  mediaType?: "text" | "image" | "audio" | "document";
  mimeType?: string;
  mediaBase64?: string;
  /** false = guardar o anexo para o operador sem enviar o binário à IA. */
  aiMedia?: boolean;
  fileName?: string;
}

/**
 * Registra a mensagem do visitante no atendimento comum e aciona a triagem quando a
 * conversa está com a automação. Com operador ou finalizada por humano, apenas registra.
 */
export async function handleIndustrialSiteMessage(tenantId: string, visitor: LcVisitor, item: SiteInboundItem) {
  const settings = await loadSiteChannelSettings(tenantId);
  if (!settings.enabled) return { accepted: false as const, reason: "site_channel_disabled" };

  const messageId = `lcm-${crypto.createHash("sha256").update(`${tenantId}:${item.siteMessageId}`).digest("hex").slice(0, 40)}`;
  let conv = await ensureSiteConversation(tenantId, visitor);
  if (conv.queueState === "finalizados") {
    await reopenSiteConversation(tenantId, conv.id, messageId);
    conv = (await db.query.conversations.findFirst({
      where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.tenantId, tenantId), dEq(t.id, conv.id)),
    }))!;
  }

  let content = item.text;
  if (item.mediaBase64 && item.mediaType && item.mediaType !== "text") {
    const mediaFileId = `med_lc_${messageId.slice(4)}`;
    const base64 = item.mediaBase64.replace(/^data:[^;]+;base64,/, "");
    await db
      .insert(mediaFiles)
      .values({
        id: mediaFileId,
        tenantId,
        conversationId: conv.id,
        fileName: item.fileName || item.mediaType,
        mimeType: item.mimeType || "application/octet-stream",
        fileSize: Math.floor((base64.length * 3) / 4),
        base64Data: base64,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    content = `[MEDIA:${item.mediaType}]${mediaFileId}${item.fileName ? `:${item.fileName}` : ""}${item.text ? `\n${item.text}` : ""}`;
  }

  const now = new Date();
  const [inserted] = await db
    .insert(messages)
    .values({
      id: messageId,
      tenantId,
      conversationId: conv.id,
      senderType: "client",
      senderName: visitor.name || "Visitante do site",
      content: content || "[Mensagem do visitante]",
      isInternalNote: false,
      direction: "inbound",
      provider: SITE_PROVIDER,
      externalId: item.siteMessageId,
      status: "delivered",
      sentAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) return { accepted: true as const, duplicate: true, conversationId: conv.id };

  await db
    .update(conversations)
    .set({
      lastMessageText: item.text || "[Mídia do visitante]",
      lastMessageTime: now,
      updatedAt: now,
      unreadCount: sql`${conversations.unreadCount} + 1`,
    })
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conv.id)));

  const current = await db.query.conversations.findFirst({
    where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.tenantId, tenantId), dEq(t.id, conv.id)),
  });
  SessionManager.getInstance().notifyPublic(tenantId, {
    type: "message",
    message: { ...inserted, queue: current?.queueState, operatorId: current?.operatorId || null },
  });

  // Mesma trava do WhatsApp: com responsável humano o SDR não responde.
  if (current && !current.operatorId && current.queueState === "automacao") {
    const sendMedia = item.aiMedia !== false && Boolean(item.mediaBase64);
    SdrDebouncer.getInstance().pushIncomingMessage(tenantId, conv.id, "", {
      messageId,
      text: item.text,
      mediaType: sendMedia ? item.mediaType || "text" : "text",
      mimeType: sendMedia ? item.mimeType : undefined,
      mediaBase64: sendMedia ? item.mediaBase64?.replace(/^data:[^;]+;base64,/, "") : undefined,
      receivedAt: now,
    });
  }
  return { accepted: true as const, duplicate: false, conversationId: conv.id };
}
