// ══════════════════════════════════════════════════════════════════════════════
// 💾 LIVECHAT STORAGE — Camada de persistência do Live Chat
// Todas as queries filtram por tenantId — isolamento multi-tenant obrigatório.
// ══════════════════════════════════════════════════════════════════════════════

import { db } from "../../db";
import {
  lcVisitors, lcChats, lcMessages, lcPageviews, lcClickEvents,
  LcVisitor, LcChat, LcMessage, LcPageview,
} from "../../db/schema";
import { eq, and, desc, asc, gte, count, sql } from "drizzle-orm";
import crypto from "crypto";

const uuid = () => crypto.randomUUID();

// ── Sessão TTL (4h) ───────────────────────────────────────────────────────────
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// VISITANTES
// ═══════════════════════════════════════════════════════════════════════════

export async function upsertVisitor(
  tenantId: string,
  cookieId: string,
  data: Partial<LcVisitor> = {}
): Promise<LcVisitor> {
  const existing = await db
    .select()
    .from(lcVisitors)
    .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.cookieId, cookieId)))
    .limit(1);

  if (existing[0]) {
    const [updated] = await db
      .update(lcVisitors)
      .set({ ...data, lastSeenAt: new Date() })
      .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.cookieId, cookieId)))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(lcVisitors)
    .values({
      id: uuid(),
      tenantId,
      cookieId,
      ...data,
    })
    .returning();
  return created;
}

export async function updateVisitorData(
  tenantId: string,
  visitorId: string,
  data: Partial<LcVisitor>
): Promise<void> {
  await db
    .update(lcVisitors)
    .set({ ...data, lastSeenAt: new Date() })
    .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.id, visitorId)));
}

export async function getActiveVisitors(tenantId: string): Promise<LcVisitor[]> {
  const since = new Date(Date.now() - SESSION_TTL_MS);
  return db
    .select()
    .from(lcVisitors)
    .where(and(eq(lcVisitors.tenantId, tenantId), gte(lcVisitors.lastSeenAt, since)))
    .orderBy(desc(lcVisitors.lastSeenAt));
}

export async function getVisitorById(tenantId: string, visitorId: string): Promise<LcVisitor | null> {
  const [v] = await db
    .select()
    .from(lcVisitors)
    .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.id, visitorId)))
    .limit(1);
  return v ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHATS
// ═══════════════════════════════════════════════════════════════════════════

export async function createChat(tenantId: string, visitorId: string): Promise<LcChat> {
  const [chat] = await db
    .insert(lcChats)
    .values({ id: uuid(), tenantId, visitorId })
    .returning();
  return chat;
}

export async function getOrCreateActiveChat(
  tenantId: string,
  visitorId: string
): Promise<LcChat> {
  const [existing] = await db
    .select()
    .from(lcChats)
    .where(
      and(
        eq(lcChats.tenantId, tenantId),
        eq(lcChats.visitorId, visitorId),
        eq(lcChats.status, "active")
      )
    )
    .orderBy(desc(lcChats.startedAt))
    .limit(1);

  if (existing) return existing;
  return createChat(tenantId, visitorId);
}

export async function updateChatStatus(
  tenantId: string,
  chatId: string,
  status: LcChat["status"],
  extra: Partial<LcChat> = {}
): Promise<void> {
  await db
    .update(lcChats)
    .set({
      status,
      ...(status === "closed" ? { closedAt: new Date() } : {}),
      ...extra,
    })
    .where(and(eq(lcChats.tenantId, tenantId), eq(lcChats.id, chatId)));
}

export async function operatorTakeOver(
  tenantId: string,
  chatId: string,
  operatorId: string
): Promise<void> {
  await updateChatStatus(tenantId, chatId, "operator_took_over", { operatorId });
}

// ═══════════════════════════════════════════════════════════════════════════
// MENSAGENS
// ═══════════════════════════════════════════════════════════════════════════

export async function saveMessage(
  tenantId: string,
  chatId: string,
  sender: LcMessage["sender"],
  content: string,
  extra: Partial<LcMessage> = {}
): Promise<LcMessage> {
  const [msg] = await db
    .insert(lcMessages)
    .values({
      id: uuid(),
      tenantId,
      chatId,
      sender,
      content,
      contentType: extra.contentType ?? "text",
      ...extra,
    })
    .returning();
  return msg;
}

export async function getChatHistory(
  tenantId: string,
  chatId: string,
  limit = 50
): Promise<LcMessage[]> {
  return db
    .select()
    .from(lcMessages)
    .where(and(eq(lcMessages.tenantId, tenantId), eq(lcMessages.chatId, chatId)))
    .orderBy(asc(lcMessages.sentAt))
    .limit(limit);
}

export async function getVisitorAllMessages(
  tenantId: string,
  visitorId: string,
  limit = 100
): Promise<LcMessage[]> {
  return db
    .select({
      id: lcMessages.id,
      tenantId: lcMessages.tenantId,
      chatId: lcMessages.chatId,
      sender: lcMessages.sender,
      content: lcMessages.content,
      contentType: lcMessages.contentType,
      mediaUrl: lcMessages.mediaUrl,
      mediaType: lcMessages.mediaType,
      fileName: lcMessages.fileName,
      trayProductData: lcMessages.trayProductData,
      sentAt: lcMessages.sentAt,
    })
    .from(lcMessages)
    .innerJoin(lcChats, eq(lcMessages.chatId, lcChats.id))
    .where(and(eq(lcMessages.tenantId, tenantId), eq(lcChats.visitorId, visitorId)))
    .orderBy(asc(lcMessages.sentAt))
    .limit(limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGEVIEWS
// ═══════════════════════════════════════════════════════════════════════════

export async function recordPageview(
  tenantId: string,
  visitorId: string,
  url: string,
  title?: string
): Promise<void> {
  await db.insert(lcPageviews).values({
    id: uuid(),
    tenantId,
    visitorId,
    url,
    title,
  });
}

export async function getVisitorPageviews(
  tenantId: string,
  visitorId: string
): Promise<LcPageview[]> {
  return db
    .select()
    .from(lcPageviews)
    .where(and(eq(lcPageviews.tenantId, tenantId), eq(lcPageviews.visitorId, visitorId)))
    .orderBy(asc(lcPageviews.visitedAt))
    .limit(20);
}

// ═══════════════════════════════════════════════════════════════════════════
// MÉTRICAS (para AnalyticsView)
// ═══════════════════════════════════════════════════════════════════════════

export async function getLiveChatMetrics(tenantId: string, sinceHours = 24) {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  const [visitors] = await db
    .select({ total: count() })
    .from(lcVisitors)
    .where(and(eq(lcVisitors.tenantId, tenantId), gte(lcVisitors.sessionStart, since)));

  const [chats] = await db
    .select({ total: count() })
    .from(lcChats)
    .where(and(eq(lcChats.tenantId, tenantId), gte(lcChats.startedAt, since)));

  const [bridges] = await db
    .select({ total: count() })
    .from(lcChats)
    .where(
      and(
        eq(lcChats.tenantId, tenantId),
        eq(lcChats.outcome, "bridge_whatsapp"),
        gte(lcChats.startedAt, since)
      )
    );

  return {
    uniqueVisitors: visitors?.total ?? 0,
    chatsStarted: chats?.total ?? 0,
    bridgesToWhatsApp: bridges?.total ?? 0,
  };
}