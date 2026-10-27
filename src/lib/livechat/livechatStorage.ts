// ══════════════════════════════════════════════════════════════════════════════
// 💾 LIVECHAT STORAGE — Camada de persistência do Live Chat
// Todas as queries filtram por tenantId — isolamento multi-tenant obrigatório.
// ══════════════════════════════════════════════════════════════════════════════

import { db } from "../../db";
import {
  lcVisitors,
  lcChats,
  lcMessages,
  lcPageviews,
  lcClickEvents,
  contacts,
  LcVisitor,
  LcChat,
  LcMessage,
  LcPageview,
  LcClickEvent,
} from "../../db/schema";
import { eq, and, desc, asc, gte, count, sql, inArray } from "drizzle-orm";
import crypto from "crypto";
import { canPerformSiteAction } from "../access-control/site-actions";
import type { SiteOperatorAction } from "../access-control/site-actions";
import type { ChatPermissions } from "../rbac";

const uuid = () => crypto.randomUUID();

// ── Sessão TTL (4h) ───────────────────────────────────────────────────────────
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// VISITANTES
// ═══════════════════════════════════════════════════════════════════════════

export async function upsertVisitor(
  tenantId: string,
  cookieId: string,
  data: Partial<LcVisitor> = {},
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
  data: Partial<LcVisitor>,
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

export async function getVisitorById(
  tenantId: string,
  visitorId: string,
): Promise<LcVisitor | null> {
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
  const [chat] = await db.insert(lcChats).values({ id: uuid(), tenantId, visitorId }).returning();
  return chat;
}

export async function getOrCreateActiveChat(tenantId: string, visitorId: string): Promise<LcChat> {
  const [existing] = await db
    .select()
    .from(lcChats)
    .where(
      and(
        eq(lcChats.tenantId, tenantId),
        eq(lcChats.visitorId, visitorId),
        eq(lcChats.status, "active"),
      ),
    )
    .orderBy(desc(lcChats.startedAt))
    .limit(1);

  if (existing) return existing;
  return createChat(tenantId, visitorId);
}

/** Monitoring is read-only and must never create a visitor chat. */
export async function getLatestVisitorChat(tenantId: string, visitorId: string): Promise<LcChat | null> {
  const [chat] = await db.select().from(lcChats).where(and(eq(lcChats.tenantId, tenantId), eq(lcChats.visitorId, visitorId)))
    .orderBy(desc(lcChats.startedAt)).limit(1);
  return chat ?? null;
}

export async function updateChatStatus(
  tenantId: string,
  chatId: string,
  status: LcChat["status"],
  extra: Partial<LcChat> = {},
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
  operatorId: string,
): Promise<void> {
  await updateChatStatus(tenantId, chatId, "operator_took_over", { operatorId });
}

/** Chat do tenant ou null — nunca confiar em chatId recebido sem esta verificação. */
export async function getChatById(tenantId: string, chatId: string): Promise<LcChat | null> {
  if (typeof chatId !== "string" || !chatId || chatId.length > 200) return null;
  const [chat] = await db
    .select()
    .from(lcChats)
    .where(and(eq(lcChats.tenantId, tenantId), eq(lcChats.id, chatId)))
    .limit(1);
  return chat ?? null;
}

/** Check owner and mutate under the same row lock. External deliveries happen only after commit. */
export async function applyOperatorChatAction(tenantId: string, chatId: string, operatorId: string,
  action: SiteOperatorAction, permissions: Partial<ChatPermissions>, content = "") {
  return db.transaction(async (tx) => {
    const [chat] = await tx.select().from(lcChats).where(and(eq(lcChats.tenantId, tenantId), eq(lcChats.id, chatId))).for("update").limit(1);
    if (!chat) throw Object.assign(new Error("Chat não encontrado."), { statusCode: 404, code: "NOT_FOUND" });
    if (!canPerformSiteAction(operatorId, chat, action, permissions)) throw Object.assign(new Error("Permissão insuficiente."), { statusCode: 403, code: "FORBIDDEN" });
    if (action === "operator_message") {
      if (!content.trim()) throw Object.assign(new Error("Mensagem vazia."), { statusCode: 400, code: "BAD_REQUEST" });
      const [message] = await tx.insert(lcMessages).values({ id: uuid(), tenantId, chatId, sender: "operator", content, contentType: "text" }).returning();
      return { chat, message };
    }
    const patch = action === "take_over" ? { status: "operator_took_over", operatorId } : action === "release_to_ai" ?
      { status: "active", operatorId: null } : { status: "closed", closedAt: new Date(), outcome: "resolved" };
    await tx.update(lcChats).set(patch).where(and(eq(lcChats.tenantId, tenantId), eq(lcChats.id, chatId)));
    return { chat, message: null };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MENSAGENS
// ═══════════════════════════════════════════════════════════════════════════

export async function saveMessage(
  tenantId: string,
  chatId: string,
  sender: LcMessage["sender"],
  content: string,
  extra: Partial<LcMessage> = {},
): Promise<LcMessage & { duplicate?: boolean }> {
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
    .onConflictDoNothing()
    .returning();
  if (msg) return msg;
  const [existing] = await db
    .select()
    .from(lcMessages)
    .where(and(eq(lcMessages.tenantId, tenantId), eq(lcMessages.id, extra.id!)));
  if (!existing) throw new Error("Mensagem não persistida.");
  return Object.assign(existing, { duplicate: true });
}

export async function getChatHistory(
  tenantId: string,
  chatId: string,
  limit = 50,
): Promise<LcMessage[]> {
  return db
    .select()
    .from(lcMessages)
    .where(and(eq(lcMessages.tenantId, tenantId), eq(lcMessages.chatId, chatId)))
    .orderBy(desc(lcMessages.sentAt))
    .limit(limit)
    .then((rows) => rows.reverse());
}

export async function getVisitorAllMessages(
  tenantId: string,
  visitorId: string,
  limit = 100,
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
// PAGEVIEWS & CLIQUES
// ═══════════════════════════════════════════════════════════════════════════

export async function recordPageview(
  tenantId: string,
  visitorId: string,
  url: string,
  title?: string,
): Promise<LcPageview> {
  const [pv] = await db
    .insert(lcPageviews)
    .values({
      id: uuid(),
      tenantId,
      visitorId,
      url,
      title,
    })
    .returning();
  return pv;
}

export async function updatePageviewMetrics(
  tenantId: string,
  visitorId: string,
  params: {
    pageviewId?: string;
    url?: string;
    timeOnPage?: number;
    scrollDepth?: number;
  },
): Promise<void> {
  const safeTime = Math.max(0, Math.min(86400, Math.round(Number(params.timeOnPage) || 0)));
  const safeScroll = Math.max(0, Math.min(100, Math.round(Number(params.scrollDepth) || 0)));
  if (safeTime === 0 && safeScroll === 0) return;

  let targetId = typeof params.pageviewId === "string" && params.pageviewId ? params.pageviewId : null;

  if (!targetId && params.url) {
    const [latest] = await db
      .select({ id: lcPageviews.id })
      .from(lcPageviews)
      .where(
        and(
          eq(lcPageviews.tenantId, tenantId),
          eq(lcPageviews.visitorId, visitorId),
          eq(lcPageviews.url, params.url),
        ),
      )
      .orderBy(desc(lcPageviews.visitedAt))
      .limit(1);
    targetId = latest?.id ?? null;
  }

  if (!targetId) {
    const [latestAny] = await db
      .select({ id: lcPageviews.id })
      .from(lcPageviews)
      .where(and(eq(lcPageviews.tenantId, tenantId), eq(lcPageviews.visitorId, visitorId)))
      .orderBy(desc(lcPageviews.visitedAt))
      .limit(1);
    targetId = latestAny?.id ?? null;
  }

  if (!targetId) return;

  await db
    .update(lcPageviews)
    .set({
      timeOnPage: sql`GREATEST(COALESCE(${lcPageviews.timeOnPage}, 0), ${safeTime})`,
      scrollDepth: sql`GREATEST(COALESCE(${lcPageviews.scrollDepth}, 0), ${safeScroll})`,
    })
    .where(
      and(
        eq(lcPageviews.tenantId, tenantId),
        eq(lcPageviews.visitorId, visitorId),
        eq(lcPageviews.id, targetId),
      ),
    );

  await db
    .update(lcVisitors)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.id, visitorId)));
}

const VALID_CLICK_TYPES = new Set<LcClickEvent["eventType"]>([
  "whatsapp_click",
  "phone_click",
  "cta_click",
  "widget_open",
  "add_to_cart",
  "product_view",
  "chat_sent",
]);

export function normalizeClickEventType(rawType?: string | null): LcClickEvent["eventType"] {
  const clean = String(rawType || "").trim().toLowerCase() as LcClickEvent["eventType"];
  if (VALID_CLICK_TYPES.has(clean)) return clean;
  if (clean.includes("whatsapp")) return "whatsapp_click";
  if (clean.includes("phone") || clean.includes("tel")) return "phone_click";
  if (clean.includes("cart") || clean.includes("comprar")) return "add_to_cart";
  if (clean.includes("product") || clean.includes("equipamento")) return "product_view";
  if (clean.includes("widget")) return "widget_open";
  return "cta_click";
}

export async function recordClickEvent(
  tenantId: string,
  visitorId: string,
  rawType: string,
  eventData: {
    url?: string;
    title?: string;
    elementId?: string;
    elementText?: string;
    clickType?: string;
  },
): Promise<LcClickEvent> {
  const eventType = normalizeClickEventType(rawType || eventData.clickType);
  const [created] = await db
    .insert(lcClickEvents)
    .values({
      id: uuid(),
      tenantId,
      visitorId,
      eventType,
      eventData: {
        url: eventData.url,
        title: eventData.title,
        elementId: eventData.elementId,
        elementText: eventData.elementText,
        clickType: eventData.clickType || eventType,
      },
    })
    .returning();

  const scoreDelta =
    eventType === "whatsapp_click" || eventType === "phone_click" || eventType === "add_to_cart"
      ? 20
      : eventType === "cta_click" || eventType === "product_view" || eventType === "chat_sent"
        ? 12
        : 5;

  const current = await getVisitorById(tenantId, visitorId);
  const nextScore = Math.min(100, (current?.intentScore ?? 10) + scoreDelta);
  const nextTemp: LcVisitor["temperature"] =
    nextScore >= 60 ? "hot" : nextScore >= 30 ? "warm" : "cold";

  await db
    .update(lcVisitors)
    .set({
      intentScore: nextScore,
      temperature: nextTemp,
      lastSeenAt: new Date(),
    })
    .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.id, visitorId)));

  return created;
}

export async function getVisitorPageviews(
  tenantId: string,
  visitorId: string,
  limit = 100,
): Promise<LcPageview[]> {
  return db
    .select()
    .from(lcPageviews)
    .where(and(eq(lcPageviews.tenantId, tenantId), eq(lcPageviews.visitorId, visitorId)))
    .orderBy(asc(lcPageviews.visitedAt))
    .limit(limit);
}

export async function getVisitorClickEvents(
  tenantId: string,
  visitorId: string,
  limit = 100,
): Promise<LcClickEvent[]> {
  return db
    .select()
    .from(lcClickEvents)
    .where(and(eq(lcClickEvents.tenantId, tenantId), eq(lcClickEvents.visitorId, visitorId)))
    .orderBy(asc(lcClickEvents.occurredAt))
    .limit(limit);
}

export async function getAllRecentVisitors(
  tenantId: string,
  limit = 80,
): Promise<LcVisitor[]> {
  return db
    .select()
    .from(lcVisitors)
    .where(eq(lcVisitors.tenantId, tenantId))
    .orderBy(desc(lcVisitors.lastSeenAt))
    .limit(limit);
}

function inferPageIntent(url?: string | null, title?: string | null): "high" | "medium" | "low" {
  const combined = `${url || ""} ${title || ""}`.toLowerCase();
  if (
    /orcamento|cotacao|contato|checkout|carrinho|whatsapp|comprar|pedido|preco|seladora|envasadora|embaladora|empacotadeira|rotuladora|datador|valvula|frasco|pote/i.test(
      combined,
    )
  ) {
    return "high";
  }
  if (/produto|catalogo|categoria|maquina|equipamento|embalagem|linha|industrial|sobre/i.test(combined)) {
    return "medium";
  }
  return "low";
}

function inferTrafficSource(referrer?: string | null, firstUrl?: string | null): string {
  const urlStr = firstUrl || "";
  const refStr = (referrer || "").toLowerCase();
  try {
    if (urlStr) {
      const parsed = new URL(urlStr, "https://site.local");
      const utmSource = (parsed.searchParams.get("utm_source") || "").toLowerCase();
      const utmMedium = (parsed.searchParams.get("utm_medium") || "").toLowerCase();
      if (parsed.searchParams.get("gclid") || (utmSource.includes("google") && /cpc|paid|ads/.test(utmMedium))) {
        return "Google Ads";
      }
      if (parsed.searchParams.get("fbclid") || /meta|facebook|instagram/.test(utmSource)) {
        return "Meta Ads";
      }
      if (utmSource) {
        return utmSource.charAt(0).toUpperCase() + utmSource.slice(1);
      }
    }
  } catch {}
  if (refStr.includes("google.")) return "Google Orgânico";
  if (refStr.includes("bing.") || refStr.includes("yahoo.")) return "Busca Orgânica";
  if (refStr.includes("instagram.") || refStr.includes("facebook.") || refStr.includes("fb.")) return "Redes Sociais";
  if (refStr.includes("whatsapp") || refStr.includes("wa.me")) return "WhatsApp";
  if (refStr && !refStr.includes("tecfag") && !refStr.includes("valem")) return "Referência Externa";
  return "Acesso Direto";
}

export async function getVisitorJourneyDetail(
  tenantId: string,
  params: { visitorId?: string | null; contactId?: string | null },
) {
  let contactRecord: typeof contacts.$inferSelect | null = null;
  const candidateVisitorIds = new Set<string>();
  const candidateCookieIds = new Set<string>();

  if (params.visitorId && typeof params.visitorId === "string") {
    const clean = params.visitorId.startsWith("cont-lc-")
      ? params.visitorId.slice("cont-lc-".length)
      : params.visitorId;
    if (clean) candidateVisitorIds.add(clean);
  }

  if (params.contactId && typeof params.contactId === "string") {
    const [foundContact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, params.contactId)))
      .limit(1);
    if (foundContact) {
      contactRecord = foundContact;
      if (foundContact.id.startsWith("cont-lc-")) {
        candidateVisitorIds.add(foundContact.id.slice("cont-lc-".length));
      }
      const cf = (foundContact.customFields || {}) as Record<string, any>;
      if (typeof cf.siteVisitorId === "string" && cf.siteVisitorId) {
        candidateVisitorIds.add(cf.siteVisitorId);
      }
      if (typeof cf.siteCookieId === "string" && cf.siteCookieId) {
        candidateCookieIds.add(cf.siteCookieId);
      }
      if (Array.isArray(cf.linkedSiteContactIds)) {
        for (const linkedId of cf.linkedSiteContactIds) {
          if (typeof linkedId === "string" && linkedId.startsWith("cont-lc-")) {
            candidateVisitorIds.add(linkedId.slice("cont-lc-".length));
          }
        }
      }
    }
  }

  let matchedVisitors: LcVisitor[] = [];
  if (candidateVisitorIds.size > 0) {
    matchedVisitors = await db
      .select()
      .from(lcVisitors)
      .where(
        and(
          eq(lcVisitors.tenantId, tenantId),
          inArray(lcVisitors.id, Array.from(candidateVisitorIds)),
        ),
      )
      .orderBy(desc(lcVisitors.lastSeenAt));
  }

  if (matchedVisitors.length === 0 && candidateCookieIds.size > 0) {
    matchedVisitors = await db
      .select()
      .from(lcVisitors)
      .where(
        and(
          eq(lcVisitors.tenantId, tenantId),
          inArray(lcVisitors.cookieId, Array.from(candidateCookieIds)),
        ),
      )
      .orderBy(desc(lcVisitors.lastSeenAt));
  }

  if (matchedVisitors.length === 0 && contactRecord) {
    const digitsPhone = (contactRecord.phone || "").replace(/\D/g, "");
    if (digitsPhone.length >= 10) {
      const byPhone = await db
        .select()
        .from(lcVisitors)
        .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.phone, contactRecord.phone!)))
        .orderBy(desc(lcVisitors.lastSeenAt))
        .limit(5);
      if (byPhone.length > 0) matchedVisitors = byPhone;
    }
    if (matchedVisitors.length === 0 && contactRecord.email) {
      const byEmail = await db
        .select()
        .from(lcVisitors)
        .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.email, contactRecord.email)))
        .orderBy(desc(lcVisitors.lastSeenAt))
        .limit(5);
      if (byEmail.length > 0) matchedVisitors = byEmail;
    }
  }

  // If we found a visitor first and didn't have contactRecord, try finding its contactRecord
  const primaryVisitor = matchedVisitors[0] ?? null;
  if (!contactRecord && primaryVisitor) {
    const lcContactId = `cont-lc-${primaryVisitor.id}`;
    const [foundContact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, lcContactId)))
      .limit(1);
    if (foundContact) contactRecord = foundContact;
  }

  const allVisitorIds = matchedVisitors.map((v) => v.id);

  const [rawPageviews, rawClicks, rawChats] =
    allVisitorIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(lcPageviews)
            .where(and(eq(lcPageviews.tenantId, tenantId), inArray(lcPageviews.visitorId, allVisitorIds)))
            .orderBy(asc(lcPageviews.visitedAt))
            .limit(150),
          db
            .select()
            .from(lcClickEvents)
            .where(and(eq(lcClickEvents.tenantId, tenantId), inArray(lcClickEvents.visitorId, allVisitorIds)))
            .orderBy(asc(lcClickEvents.occurredAt))
            .limit(150),
          db
            .select()
            .from(lcChats)
            .where(and(eq(lcChats.tenantId, tenantId), inArray(lcChats.visitorId, allVisitorIds)))
            .orderBy(desc(lcChats.startedAt))
            .limit(30),
        ])
      : [[], [], []];

  const cf = ((contactRecord?.customFields || {}) as Record<string, any>) || {};
  const siteContext = cf.siteContext || null;

  // Fallback pageviews from siteContext if lc_pageviews is empty
  const pageviews =
    rawPageviews.length > 0
      ? rawPageviews.map((pv) => ({
          id: pv.id,
          url: pv.url,
          pageTitle: pv.title || pv.url,
          timestamp: pv.visitedAt instanceof Date ? pv.visitedAt.toISOString() : String(pv.visitedAt),
          timeOnPage: pv.timeOnPage ?? 0,
          scrollDepth: pv.scrollDepth ?? 0,
          intent: inferPageIntent(pv.url, pv.title),
        }))
      : (() => {
          const fallback: Array<{
            id: string;
            url: string;
            pageTitle: string;
            timestamp: string;
            timeOnPage: number;
            scrollDepth: number;
            intent: "high" | "medium" | "low";
          }> = [];
          const nowIso = (contactRecord?.createdAt instanceof Date
            ? contactRecord.createdAt.toISOString()
            : new Date().toISOString());
          if (siteContext?.entry?.url) {
            fallback.push({
              id: "pv-entry",
              url: siteContext.entry.url,
              pageTitle: siteContext.entry.title || siteContext.entry.url,
              timestamp: siteContext.entry.enteredAt || nowIso,
              timeOnPage: 0,
              scrollDepth: 0,
              intent: inferPageIntent(siteContext.entry.url, siteContext.entry.title),
            });
          }
          if (siteContext?.page?.url && siteContext.page.url !== siteContext?.entry?.url) {
            fallback.push({
              id: "pv-current",
              url: siteContext.page.url,
              pageTitle: siteContext.page.title || siteContext.page.url,
              timestamp: siteContext.capturedAt || nowIso,
              timeOnPage: 0,
              scrollDepth: 0,
              intent: inferPageIntent(siteContext.page.url, siteContext.page.title),
            });
          }
          return fallback;
        })();

  const clickEvents = rawClicks.map((ce) => ({
    id: ce.id,
    clickType: ce.eventData?.clickType || ce.eventType,
    eventType: ce.eventType,
    url: ce.eventData?.url || primaryVisitor?.currentUrl || "",
    pageTitle: ce.eventData?.title || primaryVisitor?.currentTitle || "",
    elementId: ce.eventData?.elementId,
    elementText: ce.eventData?.elementText,
    timestamp: ce.occurredAt instanceof Date ? ce.occurredAt.toISOString() : String(ce.occurredAt),
  }));

  // Build unified chronological timeline
  const timeline: Array<{
    type: string;
    timestamp: string;
    data: Record<string, any>;
  }> = [];

  const firstSessionStart =
    matchedVisitors.length > 0
      ? matchedVisitors[matchedVisitors.length - 1].sessionStart
      : contactRecord?.createdAt || new Date();
  const lastSeenAt =
    primaryVisitor?.lastSeenAt || contactRecord?.updatedAt || new Date();

  const referrer =
    primaryVisitor?.referrer ||
    siteContext?.entry?.referrer ||
    siteContext?.page?.referrer ||
    null;
  const firstUrl = pageviews[0]?.url || primaryVisitor?.currentUrl || siteContext?.page?.url || null;
  const source = inferTrafficSource(referrer, firstUrl);

  timeline.push({
    type: "session_start",
    timestamp:
      firstSessionStart instanceof Date ? firstSessionStart.toISOString() : String(firstSessionStart),
    data: {
      source,
      referrer,
      device:
        primaryVisitor?.userAgent && /mobile|android|iphone/i.test(primaryVisitor.userAgent)
          ? "mobile"
          : "desktop",
      browser: primaryVisitor?.userAgent || undefined,
    },
  });

  for (const pv of pageviews) {
    timeline.push({
      type: "pageview",
      timestamp: pv.timestamp,
      data: {
        url: pv.url,
        pageTitle: pv.pageTitle,
        intent: pv.intent,
        timeOnPage: pv.timeOnPage,
        scrollDepth: pv.scrollDepth,
      },
    });
  }

  for (const ce of clickEvents) {
    timeline.push({
      type: "click_event",
      timestamp: ce.timestamp,
      data: {
        clickType: ce.clickType,
        elementText: ce.elementText,
        elementId: ce.elementId,
        url: ce.url,
        pageTitle: ce.pageTitle,
      },
    });
  }

  for (const chat of rawChats) {
    timeline.push({
      type: "chat_start",
      timestamp: chat.startedAt instanceof Date ? chat.startedAt.toISOString() : String(chat.startedAt),
      data: {
        chatId: chat.id,
        status: chat.status,
        summary: chat.aiSummary,
      },
    });
    if (chat.closedAt) {
      timeline.push({
        type: "chat_closed",
        timestamp: chat.closedAt instanceof Date ? chat.closedAt.toISOString() : String(chat.closedAt),
        data: {
          chatId: chat.id,
          outcome: chat.outcome,
        },
      });
    }
  }

  if (cf.siteContinuityCode || (Array.isArray(cf.linkedSiteContactIds) && cf.linkedSiteContactIds.length > 0)) {
    timeline.push({
      type: "whatsapp_continuity",
      timestamp:
        contactRecord?.updatedAt instanceof Date
          ? contactRecord.updatedAt.toISOString()
          : new Date().toISOString(),
      data: {
        code: cf.siteContinuityCode,
        phone: contactRecord?.phone,
      },
    });
  }

  timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const sumPageTime = pageviews.reduce((acc, pv) => acc + (pv.timeOnPage || 0), 0);
  const sessionSpanSec = Math.max(
    0,
    Math.round(
      (new Date(lastSeenAt).getTime() - new Date(firstSessionStart).getTime()) / 1000,
    ),
  );
  const totalTimeOnSite = sumPageTime > 0 ? sumPageTime : Math.min(3600, sessionSpanSec);

  const pagesWithScroll = pageviews.filter((pv) => (pv.scrollDepth || 0) > 0);
  const avgScrollDepth =
    pagesWithScroll.length > 0
      ? Math.round(
          pagesWithScroll.reduce((acc, pv) => acc + (pv.scrollDepth || 0), 0) /
            pagesWithScroll.length,
        )
      : 0;

  const highIntentPages = pageviews.filter((pv) => pv.intent === "high").length;
  const computedIntentScore = Math.min(
    100,
    Math.max(
      primaryVisitor?.intentScore ?? 0,
      Math.min(40, pageviews.length * 10) +
        highIntentPages * 15 +
        clickEvents.length * 15 +
        (rawChats.length > 0 ? 25 : 0),
    ),
  );

  const computedEngagementScore = Math.min(
    100,
    Math.min(30, pageviews.length * 8) +
      Math.min(25, Math.round(totalTimeOnSite / 12)) +
      Math.min(20, Math.round(avgScrollDepth / 5)) +
      Math.min(25, clickEvents.length * 10 + rawChats.length * 15),
  );

  const isOnline =
    primaryVisitor?.lastSeenAt
      ? Date.now() - new Date(primaryVisitor.lastSeenAt).getTime() < 5 * 60 * 1000
      : false;

  const visitorProfile = {
    id: primaryVisitor?.id || (contactRecord ? `cont-${contactRecord.id}` : "unknown"),
    contactId: contactRecord?.id || (primaryVisitor ? `cont-lc-${primaryVisitor.id}` : null),
    cookieId: primaryVisitor?.cookieId || cf.siteCookieId || "",
    name:
      contactRecord?.name ||
      primaryVisitor?.name ||
      "Visitante do Site",
    email: contactRecord?.email || primaryVisitor?.email || null,
    phone: contactRecord?.phone || primaryVisitor?.phone || null,
    cpfCnpj: contactRecord?.cnpj || primaryVisitor?.cnpj || null,
    company: contactRecord?.company || primaryVisitor?.company || null,
    productInterest:
      primaryVisitor?.productInterest ||
      siteContext?.product?.name ||
      cf.productInterest ||
      null,
    currentPage: primaryVisitor?.currentUrl || siteContext?.page?.url || pageviews[pageviews.length - 1]?.url || null,
    currentPageTitle:
      primaryVisitor?.currentTitle ||
      siteContext?.page?.title ||
      pageviews[pageviews.length - 1]?.pageTitle ||
      null,
    referrer,
    source,
    device:
      primaryVisitor?.userAgent && /mobile|android|iphone/i.test(primaryVisitor.userAgent)
        ? "mobile"
        : "desktop",
    userAgent: primaryVisitor?.userAgent || null,
    ipAddress: primaryVisitor?.ipAddress || null,
    city: contactRecord?.city || null,
    region: contactRecord?.state || null,
    country: "BR",
    isOnline,
    visitCount: Math.max(1, matchedVisitors.length),
    totalTimeOnSite,
    avgScrollDepth,
    leadScore: computedIntentScore,
    engagementScore: computedEngagementScore,
    pipelineStage:
      primaryVisitor?.pipelineStage ||
      (rawChats.length > 0 ? "attending" : computedIntentScore >= 60 ? "interested" : "new_visitor"),
    temperature:
      primaryVisitor?.temperature ||
      (computedIntentScore >= 60 ? "hot" : computedIntentScore >= 30 ? "warm" : "cold"),
    firstSeenAt:
      firstSessionStart instanceof Date ? firstSessionStart.toISOString() : String(firstSessionStart),
    lastSeenAt: lastSeenAt instanceof Date ? lastSeenAt.toISOString() : String(lastSeenAt),
    linkedWhatsApp: Boolean(
      cf.siteContinuityCode ||
        (Array.isArray(cf.linkedSiteContactIds) && cf.linkedSiteContactIds.length > 0) ||
        (contactRecord && contactRecord.mainChannel === "whatsapp"),
    ),
    siteContinuityCode: cf.siteContinuityCode || null,
    siteContext,
  };

  return {
    visitor: visitorProfile,
    pageviews,
    clickEvents,
    chats: rawChats.map((c) => ({
      id: c.id,
      status: c.status,
      outcome: c.outcome,
      aiSummary: c.aiSummary,
      startedAt: c.startedAt instanceof Date ? c.startedAt.toISOString() : String(c.startedAt),
      closedAt: c.closedAt instanceof Date ? c.closedAt.toISOString() : c.closedAt ? String(c.closedAt) : null,
    })),
    timeline,
  };
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
        gte(lcChats.startedAt, since),
      ),
    );

  return {
    uniqueVisitors: visitors?.total ?? 0,
    chatsStarted: chats?.total ?? 0,
    bridgesToWhatsApp: bridges?.total ?? 0,
  };
}
