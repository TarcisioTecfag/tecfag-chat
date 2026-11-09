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
  conversations,
  messages,
  operators,
  crmDeals,
  crmDealContacts,
  crmConversationDeals,
  crmPipelines,
  crmStages,
  LcVisitor,
  LcChat,
  LcMessage,
  LcPageview,
  LcClickEvent,
} from "../../db/schema";
import { eq, and, desc, asc, gte, count, sql, inArray, or } from "drizzle-orm";
import crypto from "crypto";
import { canPerformSiteAction } from "../access-control/site-actions";
import type { SiteOperatorAction } from "../access-control/site-actions";
import type { ChatPermissions } from "../rbac";
import { siteGateway } from "./site-gateway";

const uuid = () => crypto.randomUUID();

// ── Sessão TTL (4h) ───────────────────────────────────────────────────────────
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

const DDD_LOCATION_MAP: Record<string, { city: string; region: string }> = {
  "11": { city: "São Paulo", region: "SP" },
  "12": { city: "São José dos Campos", region: "SP" },
  "13": { city: "Santos", region: "SP" },
  "14": { city: "Marília / Bauru", region: "SP" },
  "15": { city: "Sorocaba", region: "SP" },
  "16": { city: "Ribeirão Preto", region: "SP" },
  "17": { city: "São José do Rio Preto", region: "SP" },
  "18": { city: "Presidente Prudente", region: "SP" },
  "19": { city: "Campinas", region: "SP" },
  "21": { city: "Rio de Janeiro", region: "RJ" },
  "22": { city: "Campos dos Goytacazes", region: "RJ" },
  "24": { city: "Volta Redonda", region: "RJ" },
  "27": { city: "Vitória", region: "ES" },
  "28": { city: "Cachoeiro de Itapemirim", region: "ES" },
  "31": { city: "Belo Horizonte", region: "MG" },
  "32": { city: "Juiz de Fora", region: "MG" },
  "33": { city: "Governador Valadares", region: "MG" },
  "34": { city: "Uberlândia", region: "MG" },
  "35": { city: "Poços de Caldas", region: "MG" },
  "37": { city: "Divinópolis", region: "MG" },
  "38": { city: "Montes Claros", region: "MG" },
  "41": { city: "Curitiba", region: "PR" },
  "42": { city: "Ponta Grossa", region: "PR" },
  "43": { city: "Londrina", region: "PR" },
  "44": { city: "Maringá", region: "PR" },
  "45": { city: "Cascavel", region: "PR" },
  "46": { city: "Francisco Beltrão", region: "PR" },
  "47": { city: "Joinville / Blumenau", region: "SC" },
  "48": { city: "Florianópolis", region: "SC" },
  "49": { city: "Chapecó", region: "SC" },
  "51": { city: "Porto Alegre", region: "RS" },
  "53": { city: "Pelotas", region: "RS" },
  "54": { city: "Caxias do Sul", region: "RS" },
  "55": { city: "Santa Maria", region: "RS" },
  "61": { city: "Brasília", region: "DF" },
  "62": { city: "Goiânia", region: "GO" },
  "63": { city: "Palmas", region: "TO" },
  "64": { city: "Rio Verde", region: "GO" },
  "65": { city: "Cuiabá", region: "MT" },
  "66": { city: "Rondonópolis", region: "MT" },
  "67": { city: "Campo Grande", region: "MS" },
  "68": { city: "Rio Branco", region: "AC" },
  "69": { city: "Porto Velho", region: "RO" },
  "71": { city: "Salvador", region: "BA" },
  "73": { city: "Itabuna", region: "BA" },
  "74": { city: "Juazeiro", region: "BA" },
  "75": { city: "Feira de Santana", region: "BA" },
  "77": { city: "Vitória da Conquista", region: "BA" },
  "79": { city: "Aracaju", region: "SE" },
  "81": { city: "Recife", region: "PE" },
  "82": { city: "Maceió", region: "AL" },
  "83": { city: "João Pessoa", region: "PB" },
  "84": { city: "Natal", region: "RN" },
  "85": { city: "Fortaleza", region: "CE" },
  "86": { city: "Teresina", region: "PI" },
  "87": { city: "Petrolina", region: "PE" },
  "88": { city: "Juazeiro do Norte", region: "CE" },
  "89": { city: "Picos", region: "PI" },
  "91": { city: "Belém", region: "PA" },
  "92": { city: "Manaus", region: "AM" },
  "93": { city: "Santarém", region: "PA" },
  "94": { city: "Marabá", region: "PA" },
  "95": { city: "Boa Vista", region: "RR" },
  "96": { city: "Macapá", region: "AP" },
  "97": { city: "Coari", region: "AM" },
  "98": { city: "São Luís", region: "MA" },
  "99": { city: "Imperatriz", region: "MA" },
};

function parseUserAgentDetails(ua?: string | null): {
  device: "mobile" | "tablet" | "desktop";
  browser: string;
  os: string;
} {
  if (!ua) {
    return { device: "desktop", browser: "Web", os: "Web" };
  }
  const device: "mobile" | "tablet" | "desktop" = /ipad|tablet/i.test(ua)
    ? "tablet"
    : /mobile|android|iphone|ipod/i.test(ua)
      ? "mobile"
      : "desktop";

  let browser = "Web";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";

  let os = "Web";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Macintosh|Mac OS X/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  return { device, browser, os };
}

function extractUtmParams(
  ...urls: Array<string | null | undefined>
): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
} {
  let utmSource: string | null = null;
  let utmMedium: string | null = null;
  let utmCampaign: string | null = null;

  for (const rawUrl of urls) {
    if (!rawUrl) continue;
    try {
      const parsed = new URL(rawUrl, "https://site.local");
      const src = parsed.searchParams.get("utm_source");
      const med = parsed.searchParams.get("utm_medium");
      const cmp = parsed.searchParams.get("utm_campaign");
      const gclid = parsed.searchParams.get("gclid");
      const fbclid = parsed.searchParams.get("fbclid");
      if (!utmSource && src) utmSource = src;
      if (!utmSource && gclid) utmSource = "google";
      if (!utmSource && fbclid) utmSource = "meta";
      if (!utmMedium && med) utmMedium = med;
      if (!utmMedium && (gclid || fbclid)) utmMedium = "cpc";
      if (!utmCampaign && cmp) utmCampaign = cmp;
    } catch {
      // ignore invalid URL
    }
  }

  return { utmSource, utmMedium, utmCampaign };
}

function extractLocation(
  contact?: typeof contacts.$inferSelect | null,
  phone?: string | null,
): { city: string | null; region: string | null; country: string } {
  const cnpjDetails = (contact?.cnpjDetails || {}) as Record<string, any>;
  const cf = (contact?.customFields || {}) as Record<string, any>;

  const explicitCity =
    (typeof cnpjDetails.municipio === "string" && cnpjDetails.municipio.trim()) ||
    (typeof cnpjDetails.cidade === "string" && cnpjDetails.cidade.trim()) ||
    (typeof cf.city === "string" && cf.city.trim()) ||
    (typeof cf.cidade === "string" && cf.cidade.trim()) ||
    null;

  const explicitRegion =
    (typeof cnpjDetails.uf === "string" && cnpjDetails.uf.trim()) ||
    (typeof cnpjDetails.estado === "string" && cnpjDetails.estado.trim()) ||
    (typeof cf.state === "string" && cf.state.trim()) ||
    (typeof cf.uf === "string" && cf.uf.trim()) ||
    (typeof cf.region === "string" && cf.region.trim()) ||
    null;

  if (explicitCity || explicitRegion) {
    return { city: explicitCity, region: explicitRegion, country: "BR" };
  }

  const rawPhone = (phone || contact?.phone || "").replace(/\D/g, "");
  if (rawPhone.length >= 10) {
    const normalized = rawPhone.startsWith("55") && rawPhone.length >= 12 ? rawPhone.slice(2) : rawPhone;
    const ddd = normalized.slice(0, 2);
    const mapped = DDD_LOCATION_MAP[ddd];
    if (mapped) {
      return { city: mapped.city, region: mapped.region, country: "BR" };
    }
  }

  return { city: null, region: null, country: "BR" };
}

function normalizeTemperature(
  rawTemp?: string | null,
  score = 0,
): { temperature: "hot" | "warm" | "cold"; temperaturePt: "quente" | "morno" | "frio" } {
  const clean = String(rawTemp || "").trim().toLowerCase();
  if (score >= 60 || clean === "hot" || clean === "quente") {
    return { temperature: "hot", temperaturePt: "quente" };
  }
  if (score >= 30 || clean === "warm" || clean === "morno") {
    return { temperature: "warm", temperaturePt: "morno" };
  }
  return { temperature: "cold", temperaturePt: "frio" };
}

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

  // Dynamic passive navigation scoring
  try {
    const intent = inferPageIntent(url, title);
    const delta = intent === "high" ? 12 : intent === "medium" ? 6 : 3;
    const current = await getVisitorById(tenantId, visitorId);
    if (current) {
      const nextScore = Math.min(100, Math.max(current.intentScore ?? 0, 5) + delta);
      const { temperaturePt } = normalizeTemperature(current.temperature, nextScore);
      await db
        .update(lcVisitors)
        .set({
          currentUrl: url,
          ...(title ? { currentTitle: title } : {}),
          intentScore: nextScore,
          temperature: temperaturePt,
          lastSeenAt: new Date(),
        })
        .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.id, visitorId)));
    }
  } catch {
    // Non-blocking enrichment
  }

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

  // Reward deep reading & scroll depth in intentScore
  try {
    const current = await getVisitorById(tenantId, visitorId);
    if (current) {
      const bonus = (safeTime >= 45 ? 4 : 0) + (safeScroll >= 60 ? 4 : 0);
      const nextScore = Math.min(100, (current.intentScore ?? 0) + bonus);
      const { temperaturePt } = normalizeTemperature(current.temperature, nextScore);
      await db
        .update(lcVisitors)
        .set({
          intentScore: nextScore,
          temperature: temperaturePt,
          lastSeenAt: new Date(),
        })
        .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.id, visitorId)));
    }
  } catch {
    await db
      .update(lcVisitors)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(lcVisitors.tenantId, tenantId), eq(lcVisitors.id, visitorId)));
  }
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
  const { temperaturePt } = normalizeTemperature(current?.temperature, nextScore);

  await db
    .update(lcVisitors)
    .set({
      intentScore: nextScore,
      temperature: temperaturePt,
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

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW 360º DE VISITANTES PARA DIRETORIA (SiteVisitorsTab)
// ═══════════════════════════════════════════════════════════════════════════

export type VisitorAttendanceStatus =
  | "browsing"
  | "ai_triage"
  | "waiting_queue"
  | "in_service"
  | "whatsapp_continued"
  | "finished";

export interface VisitorCrmDealSummary {
  id: string;
  title: string;
  value: number;
  status: string;
  pipelineName: string | null;
  stageName: string | null;
  operatorName: string | null;
}

export interface EnrichedSiteVisitorRow {
  id: string;
  tenantId: string;
  cookieId: string;
  contactId: string | null;
  conversationId: string | null;
  hasConversation: boolean;
  name: string | null;
  company: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  productInterest: string | null;
  quantityInterest: string | null;
  city: string | null;
  region: string | null;
  country: string;
  device: "mobile" | "tablet" | "desktop";
  browser: string;
  os: string;
  userAgent: string | null;
  ipAddress: string | null;
  currentUrl: string | null;
  currentTitle: string | null;
  currentPage: string | null;
  currentPageTitle: string | null;
  entryPage: string | null;
  referrer: string | null;
  source: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  isOnline: boolean;
  intentScore: number;
  engagementScore: number;
  temperature: "hot" | "warm" | "cold";
  temperaturePt: "quente" | "morno" | "frio";
  pipelineStage: string;
  visitCount: number;
  pageviewsCount: number;
  highIntentPagesCount: number;
  clicksCount: number;
  chatsCount: number;
  totalTimeOnSite: number;
  avgScrollDepth: number;
  lastClickType: string | null;
  lastClickText: string | null;
  attendanceStatus: VisitorAttendanceStatus;
  operatorId: string | null;
  operatorName: string | null;
  linkedWhatsApp: boolean;
  siteContinuityCode: string | null;
  crmDeal: VisitorCrmDealSummary | null;
  sessionStart: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SiteVisitorsExecutiveSummary {
  onlineNow: number;
  totalVisitors: number;
  hotVisitors: number;
  warmVisitors: number;
  coldVisitors: number;
  avgTimeOnSiteSec: number;
  avgScrollDepth: number;
  totalPageviews: number;
  totalClicks: number;
  visitorsWithChat: number;
  inAiTriage: number;
  inHumanService: number;
  waitingInQueue: number;
  continuedOnWhatsApp: number;
  visitorsWithCrmDeal: number;
  crmPipelineValue: number;
  crmWonValue: number;
  topPages: Array<{
    url: string;
    title: string;
    views: number;
    uniqueVisitors: number;
    avgTimeSec: number;
    avgScroll: number;
    intent: "high" | "medium" | "low";
  }>;
  trafficSources: Array<{
    source: string;
    count: number;
    hotCount: number;
    chatCount: number;
    dealCount: number;
    percentage: number;
  }>;
  conversionFunnel: {
    visitors: number;
    highIntent: number;
    chatStarted: number;
    whatsappOrDeal: number;
  };
}

export async function getEnrichedSiteVisitorsOverview(
  tenantId: string,
  options: {
    includeRecent?: boolean;
    period?: string | null;
    limit?: number;
  } = {},
): Promise<{
  visitors: EnrichedSiteVisitorRow[];
  summary: SiteVisitorsExecutiveSummary;
}> {
  const limit = Math.max(10, Math.min(200, options.limit || 100));
  const period = (options.period || (options.includeRecent ? "all" : "live")).toLowerCase();

  let sinceDate: Date | null = null;
  const nowMs = Date.now();
  if (period === "live") {
    sinceDate = new Date(nowMs - SESSION_TTL_MS);
  } else if (period === "24h" || period === "today") {
    sinceDate = new Date(nowMs - 24 * 60 * 60 * 1000);
  } else if (period === "7d") {
    sinceDate = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
  } else if (period === "30d") {
    sinceDate = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  }

  const rawVisitors = await db
    .select()
    .from(lcVisitors)
    .where(
      sinceDate
        ? and(eq(lcVisitors.tenantId, tenantId), gte(lcVisitors.lastSeenAt, sinceDate))
        : eq(lcVisitors.tenantId, tenantId),
    )
    .orderBy(desc(lcVisitors.lastSeenAt))
    .limit(limit);

  const emptySummary: SiteVisitorsExecutiveSummary = {
    onlineNow: 0,
    totalVisitors: 0,
    hotVisitors: 0,
    warmVisitors: 0,
    coldVisitors: 0,
    avgTimeOnSiteSec: 0,
    avgScrollDepth: 0,
    totalPageviews: 0,
    totalClicks: 0,
    visitorsWithChat: 0,
    inAiTriage: 0,
    inHumanService: 0,
    waitingInQueue: 0,
    continuedOnWhatsApp: 0,
    visitorsWithCrmDeal: 0,
    crmPipelineValue: 0,
    crmWonValue: 0,
    topPages: [],
    trafficSources: [],
    conversionFunnel: {
      visitors: 0,
      highIntent: 0,
      chatStarted: 0,
      whatsappOrDeal: 0,
    },
  };

  if (rawVisitors.length === 0) {
    return { visitors: [], summary: emptySummary };
  }

  const visitorIds = rawVisitors.map((v) => v.id);
  const lcContactIds = rawVisitors.map((v) => `cont-lc-${v.id}`);
  const lcConvIds = rawVisitors.map((v) => `conv-lc-${v.id}`);
  const nonEmptyPhones = Array.from(
    new Set(rawVisitors.map((v) => (v.phone || "").trim()).filter((p) => p.length >= 8)),
  );

  const [allPageviews, allClicks, allChats, tenantOperators, matchedContacts] = await Promise.all([
    db
      .select()
      .from(lcPageviews)
      .where(and(eq(lcPageviews.tenantId, tenantId), inArray(lcPageviews.visitorId, visitorIds)))
      .orderBy(asc(lcPageviews.visitedAt)),
    db
      .select()
      .from(lcClickEvents)
      .where(and(eq(lcClickEvents.tenantId, tenantId), inArray(lcClickEvents.visitorId, visitorIds)))
      .orderBy(asc(lcClickEvents.occurredAt)),
    db
      .select()
      .from(lcChats)
      .where(and(eq(lcChats.tenantId, tenantId), inArray(lcChats.visitorId, visitorIds)))
      .orderBy(desc(lcChats.startedAt)),
    db
      .select({
        id: operators.id,
        name: operators.name,
      })
      .from(operators)
      .where(eq(operators.tenantId, tenantId)),
    db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          nonEmptyPhones.length > 0
            ? or(
                inArray(contacts.id, lcContactIds),
                inArray(contacts.phone, nonEmptyPhones),
                eq(contacts.mainChannel, "livechat"),
              )
            : or(inArray(contacts.id, lcContactIds), eq(contacts.mainChannel, "livechat")),
        ),
      ),
  ]);

  const operatorMap = new Map<string, string>();
  for (const op of tenantOperators) {
    operatorMap.set(op.id, op.name);
  }

  // Index contacts by visitorId
  const contactByVisitorId = new Map<string, typeof contacts.$inferSelect>();
  const allRelevantContactIds = new Set<string>(lcContactIds);

  for (const c of matchedContacts) {
    allRelevantContactIds.add(c.id);
    if (c.id.startsWith("cont-lc-")) {
      const vid = c.id.slice("cont-lc-".length);
      if (!contactByVisitorId.has(vid)) {
        contactByVisitorId.set(vid, c);
      }
    }
    const cf = (c.customFields || {}) as Record<string, any>;
    if (typeof cf.siteVisitorId === "string" && cf.siteVisitorId) {
      contactByVisitorId.set(cf.siteVisitorId, c);
    }
    if (Array.isArray(cf.linkedSiteContactIds)) {
      for (const linked of cf.linkedSiteContactIds) {
        if (typeof linked === "string" && linked.startsWith("cont-lc-")) {
          const vid = linked.slice("cont-lc-".length);
          contactByVisitorId.set(vid, c);
        }
      }
    }
  }

  // Fallback match by phone if visitor isn't mapped yet
  for (const v of rawVisitors) {
    if (!contactByVisitorId.has(v.id) && v.phone) {
      const byPhone = matchedContacts.find((c) => c.phone === v.phone);
      if (byPhone) contactByVisitorId.set(v.id, byPhone);
    }
  }

  // Candidate conversation IDs (conv-lc-<visitorId> + waConversationId from lcChats + siteContinuity)
  const candidateConvIds = new Set<string>(lcConvIds);
  for (const chat of allChats) {
    if (chat.waConversationId) candidateConvIds.add(chat.waConversationId);
  }
  for (const c of matchedContacts) {
    const cf = (c.customFields || {}) as Record<string, any>;
    if (typeof cf.siteContinuity?.whatsappConversationId === "string") {
      candidateConvIds.add(cf.siteContinuity.whatsappConversationId);
    }
  }

  const contactIdList = Array.from(allRelevantContactIds);
  const convIdList = Array.from(candidateConvIds);

  const matchedConversations =
    contactIdList.length > 0 || convIdList.length > 0
      ? await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              contactIdList.length > 0 && convIdList.length > 0
                ? or(
                    inArray(conversations.contactId, contactIdList),
                    inArray(conversations.id, convIdList),
                  )
                : contactIdList.length > 0
                  ? inArray(conversations.contactId, contactIdList)
                  : inArray(conversations.id, convIdList),
            ),
          )
          .orderBy(desc(conversations.lastMessageTime))
      : [];

  const foundConvIds = matchedConversations.map((c) => c.id);

  // Query CRM Links (Conversation <-> Deal and Contact <-> Deal)
  const [convDealLinks, contactDealLinks] = await Promise.all([
    foundConvIds.length > 0
      ? db
          .select()
          .from(crmConversationDeals)
          .where(
            and(
              eq(crmConversationDeals.tenantId, tenantId),
              eq(crmConversationDeals.isActive, true),
              inArray(crmConversationDeals.conversationId, foundConvIds),
            ),
          )
      : Promise.resolve([]),
    contactIdList.length > 0
      ? db
          .select()
          .from(crmDealContacts)
          .where(
            and(
              eq(crmDealContacts.tenantId, tenantId),
              inArray(crmDealContacts.contactId, contactIdList),
            ),
          )
      : Promise.resolve([]),
  ]);

  const dealIds = Array.from(
    new Set([
      ...convDealLinks.map((l) => l.dealId),
      ...contactDealLinks.map((l) => l.dealId),
    ]),
  );

  const [dealsRows, pipelinesRows, stagesRows] =
    dealIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(crmDeals)
            .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, dealIds)))
            .orderBy(desc(crmDeals.updatedAt)),
          db.select().from(crmPipelines).where(eq(crmPipelines.tenantId, tenantId)),
          db.select().from(crmStages).where(eq(crmStages.tenantId, tenantId)),
        ])
      : [[], [], []];

  const pipelineMap = new Map(pipelinesRows.map((p) => [p.id, p.name]));
  const stageMap = new Map(stagesRows.map((s) => [s.id, s.name]));
  const dealMap = new Map<string, VisitorCrmDealSummary>();
  for (const d of dealsRows) {
    dealMap.set(d.id, {
      id: d.id,
      title: d.title,
      value: Number(d.value || 0),
      status: d.status,
      pipelineName: pipelineMap.get(d.pipelineId) || null,
      stageName: stageMap.get(d.stageId) || null,
      operatorName: (d.operatorId && operatorMap.get(d.operatorId)) || null,
    });
  }

  // Group pageviews, clicks, and chats by visitorId
  const pvByVisitor = new Map<string, LcPageview[]>();
  for (const pv of allPageviews) {
    const arr = pvByVisitor.get(pv.visitorId) || [];
    arr.push(pv);
    pvByVisitor.set(pv.visitorId, arr);
  }

  const clicksByVisitor = new Map<string, LcClickEvent[]>();
  for (const cl of allClicks) {
    const arr = clicksByVisitor.get(cl.visitorId) || [];
    arr.push(cl);
    clicksByVisitor.set(cl.visitorId, arr);
  }

  const chatsByVisitor = new Map<string, LcChat[]>();
  for (const ch of allChats) {
    const arr = chatsByVisitor.get(ch.visitorId) || [];
    arr.push(ch);
    chatsByVisitor.set(ch.visitorId, arr);
  }

  // Cookie visit count within loaded set
  const cookieCountMap = new Map<string, number>();
  for (const v of rawVisitors) {
    cookieCountMap.set(v.cookieId, (cookieCountMap.get(v.cookieId) || 0) + 1);
  }

  const enrichedVisitors: EnrichedSiteVisitorRow[] = rawVisitors.map((v) => {
    const vPageviews = pvByVisitor.get(v.id) || [];
    const vClicks = clicksByVisitor.get(v.id) || [];
    const vChats = chatsByVisitor.get(v.id) || [];
    const latestChat = vChats[0] ?? null;

    const matchedContact = contactByVisitorId.get(v.id) ?? null;
    const cf = ((matchedContact?.customFields || {}) as Record<string, any>) || {};
    const siteContext = cf.siteContext || null;

    const entryPv = vPageviews[0] ?? null;
    const latestPv = vPageviews[vPageviews.length - 1] ?? null;

    const currentPage =
      v.currentUrl || latestPv?.url || siteContext?.page?.url || entryPv?.url || "/";
    const currentPageTitle =
      v.currentTitle || latestPv?.title || siteContext?.page?.title || entryPv?.title || null;
    const entryPage = entryPv?.url || siteContext?.entry?.url || v.currentUrl || "/";
    const referrer =
      v.referrer || siteContext?.entry?.referrer || siteContext?.page?.referrer || null;

    const utmFromUrls = extractUtmParams(entryPage, currentPage);
    const utmSource = utmFromUrls.utmSource || siteContext?.entry?.utm?.utm_source || null;
    const utmMedium = utmFromUrls.utmMedium || siteContext?.entry?.utm?.utm_medium || null;
    const utmCampaign = utmFromUrls.utmCampaign || siteContext?.entry?.utm?.utm_campaign || null;

    const source = inferTrafficSource(referrer, entryPage);
    const uaDetails = parseUserAgentDetails(v.userAgent);
    const location = extractLocation(matchedContact, v.phone);

    const isOnline =
      siteGateway.isOnline(tenantId, v.id) ||
      Date.now() - new Date(v.lastSeenAt).getTime() < ONLINE_WINDOW_MS;

    const sumPageTime = vPageviews.reduce((acc, pv) => acc + (pv.timeOnPage || 0), 0);
    const sessionSpanSec = Math.max(
      0,
      Math.round((new Date(v.lastSeenAt).getTime() - new Date(v.sessionStart).getTime()) / 1000),
    );
    const totalTimeOnSite = sumPageTime > 0 ? sumPageTime : Math.min(3600, sessionSpanSec);

    const pagesWithScroll = vPageviews.filter((pv) => (pv.scrollDepth || 0) > 0);
    const avgScrollDepth =
      pagesWithScroll.length > 0
        ? Math.round(
            pagesWithScroll.reduce((acc, pv) => acc + (pv.scrollDepth || 0), 0) /
              pagesWithScroll.length,
          )
        : 0;

    const highIntentPages = vPageviews.filter(
      (pv) => inferPageIntent(pv.url, pv.title) === "high",
    );
    const highIntentPagesCount = highIntentPages.length;

    const computedIntentScore = Math.min(
      100,
      Math.max(
        v.intentScore ?? 0,
        Math.min(35, vPageviews.length * 8) +
          highIntentPagesCount * 15 +
          vClicks.length * 14 +
          (vChats.length > 0 ? 25 : 0) +
          (totalTimeOnSite >= 45 ? 8 : 0) +
          (avgScrollDepth >= 50 ? 6 : 0),
      ),
    );

    const computedEngagementScore = Math.min(
      100,
      Math.min(30, vPageviews.length * 8) +
        Math.min(25, Math.round(totalTimeOnSite / 12)) +
        Math.min(20, Math.round(avgScrollDepth / 5)) +
        Math.min(25, vClicks.length * 10 + vChats.length * 15),
    );

    const { temperature, temperaturePt } = normalizeTemperature(
      v.temperature,
      computedIntentScore,
    );

    // Resolve conversation & attendance state
    const siteConvId = `conv-lc-${v.id}`;
    const siteContactId = `cont-lc-${v.id}`;
    const waConvIdFromChat = latestChat?.waConversationId || cf.siteContinuity?.whatsappConversationId || null;

    const siteConv = matchedConversations.find((c) => c.id === siteConvId) || null;
    const waConv =
      (waConvIdFromChat && matchedConversations.find((c) => c.id === waConvIdFromChat)) ||
      (matchedContact &&
        matchedContact.id !== siteContactId &&
        matchedConversations.find((c) => c.contactId === matchedContact.id)) ||
      null;
    const activeConv = waConv || siteConv || null;

    const linkedWhatsApp = Boolean(
      waConv ||
        latestChat?.waConversationId ||
        latestChat?.outcome === "bridge_whatsapp" ||
        cf.siteContinuityCode ||
        (Array.isArray(cf.linkedSiteContactIds) && cf.linkedSiteContactIds.length > 0) ||
        (matchedContact && matchedContact.mainChannel === "whatsapp"),
    );

    const operatorId =
      activeConv?.operatorId ||
      latestChat?.operatorId ||
      matchedContact?.walletOperatorId ||
      null;

    const operatorName =
      (operatorId && operatorMap.get(operatorId)) ||
      (matchedContact?.responsibleName &&
      matchedContact.responsibleName !== "Na Fila" &&
      matchedContact.responsibleName !== "Automação"
        ? matchedContact.responsibleName
        : null);

    let attendanceStatus: VisitorAttendanceStatus = "browsing";
    if (linkedWhatsApp) {
      attendanceStatus = "whatsapp_continued";
    } else if (
      activeConv?.queueState === "meus" ||
      latestChat?.status === "operator_took_over" ||
      (operatorId && activeConv && activeConv.queueState !== "finalizados")
    ) {
      attendanceStatus = "in_service";
    } else if (activeConv?.queueState === "fila") {
      attendanceStatus = "waiting_queue";
    } else if (
      activeConv?.queueState === "automacao" ||
      (latestChat && latestChat.status === "active")
    ) {
      attendanceStatus = "ai_triage";
    } else if (activeConv?.queueState === "finalizados" || latestChat?.status === "closed") {
      attendanceStatus = "finished";
    }

    // Resolve CRM Deal (from activeConv, siteConv, or matchedContact)
    let crmDeal: VisitorCrmDealSummary | null = null;
    const convLinksForVisitor = convDealLinks.filter(
      (l) => l.conversationId === activeConv?.id || l.conversationId === siteConvId,
    );
    for (const link of convLinksForVisitor) {
      const found = dealMap.get(link.dealId);
      if (found) {
        crmDeal = found;
        break;
      }
    }
    if (!crmDeal) {
      const contactLinksForVisitor = contactDealLinks.filter(
        (l) => l.contactId === matchedContact?.id || l.contactId === siteContactId,
      );
      for (const link of contactLinksForVisitor) {
        const found = dealMap.get(link.dealId);
        if (found) {
          crmDeal = found;
          break;
        }
      }
    }

    const latestClick = vClicks[vClicks.length - 1] ?? null;
    const detectedProduct =
      v.productInterest ||
      siteContext?.product?.name ||
      (typeof cf.productInterest === "string" ? cf.productInterest : null) ||
      (highIntentPages[highIntentPages.length - 1]?.title &&
      highIntentPages[highIntentPages.length - 1]?.title !== currentPage
        ? highIntentPages[highIntentPages.length - 1]?.title
        : null) ||
      null;

    const cleanContactName =
      matchedContact?.name &&
      !matchedContact.name.startsWith("Visitante #") &&
      matchedContact.name !== "Visitante do Site"
        ? matchedContact.name
        : null;

    return {
      id: v.id,
      tenantId: v.tenantId,
      cookieId: v.cookieId,
      contactId: matchedContact?.id || siteContactId,
      conversationId: activeConv?.id || null,
      hasConversation: Boolean(activeConv),
      name: cleanContactName || v.name || null,
      company: v.company || (matchedContact?.cnpjDetails as any)?.razao_social || null,
      cnpj: v.cnpj || matchedContact?.cnpj || matchedContact?.cpf || null,
      email: v.email || matchedContact?.email || null,
      phone: v.phone || matchedContact?.phone || null,
      productInterest: detectedProduct,
      quantityInterest: v.quantityInterest || null,
      city: location.city,
      region: location.region,
      country: location.country,
      device: uaDetails.device,
      browser: uaDetails.browser,
      os: uaDetails.os,
      userAgent: v.userAgent || null,
      ipAddress: v.ipAddress || null,
      currentUrl: currentPage,
      currentTitle: currentPageTitle,
      currentPage,
      currentPageTitle,
      entryPage,
      referrer,
      source,
      utmSource,
      utmMedium,
      utmCampaign,
      isOnline,
      intentScore: computedIntentScore,
      engagementScore: computedEngagementScore,
      temperature,
      temperaturePt,
      pipelineStage:
        v.pipelineStage && v.pipelineStage !== "novo"
          ? v.pipelineStage
          : crmDeal
            ? "converted"
            : vChats.length > 0 || activeConv
              ? "attending"
              : computedIntentScore >= 60
                ? "interested"
                : "new_visitor",
      visitCount: Math.max(1, cookieCountMap.get(v.cookieId) || 1),
      pageviewsCount: Math.max(1, vPageviews.length),
      highIntentPagesCount,
      clicksCount: vClicks.length,
      chatsCount: Math.max(vChats.length, activeConv ? 1 : 0),
      totalTimeOnSite,
      avgScrollDepth,
      lastClickType: latestClick ? latestClick.eventData?.clickType || latestClick.eventType : null,
      lastClickText: latestClick?.eventData?.elementText || null,
      attendanceStatus,
      operatorId,
      operatorName,
      linkedWhatsApp,
      siteContinuityCode: cf.siteContinuityCode || null,
      crmDeal,
      sessionStart:
        v.sessionStart instanceof Date ? v.sessionStart.toISOString() : String(v.sessionStart),
      firstSeenAt:
        v.sessionStart instanceof Date ? v.sessionStart.toISOString() : String(v.sessionStart),
      lastSeenAt: v.lastSeenAt instanceof Date ? v.lastSeenAt.toISOString() : String(v.lastSeenAt),
    };
  });

  // Compute Executive Summary
  const totalVisitors = enrichedVisitors.length;
  const onlineNow = enrichedVisitors.filter((v) => v.isOnline).length;
  const hotVisitors = enrichedVisitors.filter((v) => v.temperature === "hot").length;
  const warmVisitors = enrichedVisitors.filter((v) => v.temperature === "warm").length;
  const coldVisitors = enrichedVisitors.filter((v) => v.temperature === "cold").length;

  const avgTimeOnSiteSec =
    totalVisitors > 0
      ? Math.round(
          enrichedVisitors.reduce((acc, v) => acc + v.totalTimeOnSite, 0) / totalVisitors,
        )
      : 0;

  const visitorsWithScroll = enrichedVisitors.filter((v) => v.avgScrollDepth > 0);
  const avgScrollDepth =
    visitorsWithScroll.length > 0
      ? Math.round(
          visitorsWithScroll.reduce((acc, v) => acc + v.avgScrollDepth, 0) /
            visitorsWithScroll.length,
        )
      : 0;

  const totalPageviews = enrichedVisitors.reduce((acc, v) => acc + v.pageviewsCount, 0);
  const totalClicks = enrichedVisitors.reduce((acc, v) => acc + v.clicksCount, 0);

  const visitorsWithChat = enrichedVisitors.filter(
    (v) => v.chatsCount > 0 || v.attendanceStatus !== "browsing",
  ).length;
  const inAiTriage = enrichedVisitors.filter((v) => v.attendanceStatus === "ai_triage").length;
  const inHumanService = enrichedVisitors.filter((v) => v.attendanceStatus === "in_service").length;
  const waitingInQueue = enrichedVisitors.filter(
    (v) => v.attendanceStatus === "waiting_queue",
  ).length;
  const continuedOnWhatsApp = enrichedVisitors.filter((v) => v.linkedWhatsApp).length;

  const uniqueDeals = new Map<string, VisitorCrmDealSummary>();
  let visitorsWithCrmDeal = 0;
  for (const v of enrichedVisitors) {
    if (v.crmDeal) {
      visitorsWithCrmDeal++;
      uniqueDeals.set(v.crmDeal.id, v.crmDeal);
    }
  }
  let crmPipelineValue = 0;
  let crmWonValue = 0;
  for (const d of uniqueDeals.values()) {
    if (d.status !== "lost") {
      crmPipelineValue += d.value;
    }
    if (d.status === "won") {
      crmWonValue += d.value;
    }
  }

  // Top Pages aggregation
  const pageAgg = new Map<
    string,
    {
      url: string;
      title: string;
      views: number;
      visitorIds: Set<string>;
      totalTime: number;
      totalScroll: number;
      scrollCount: number;
    }
  >();

  for (const pv of allPageviews) {
    let cleanKey = pv.url;
    try {
      const u = new URL(pv.url, "https://site.local");
      cleanKey = u.pathname || "/";
    } catch {}
    const entry = pageAgg.get(cleanKey) || {
      url: cleanKey,
      title: pv.title || cleanKey,
      views: 0,
      visitorIds: new Set<string>(),
      totalTime: 0,
      totalScroll: 0,
      scrollCount: 0,
    };
    entry.views += 1;
    entry.visitorIds.add(pv.visitorId);
    if (pv.title && (entry.title === entry.url || entry.title.length < pv.title.length)) {
      entry.title = pv.title;
    }
    entry.totalTime += pv.timeOnPage || 0;
    if ((pv.scrollDepth || 0) > 0) {
      entry.totalScroll += pv.scrollDepth || 0;
      entry.scrollCount += 1;
    }
    pageAgg.set(cleanKey, entry);
  }

  // If no rows in lc_pageviews yet, fallback to visitor currentPage
  if (pageAgg.size === 0) {
    for (const v of enrichedVisitors) {
      if (!v.currentPage) continue;
      let cleanKey = v.currentPage;
      try {
        const u = new URL(v.currentPage, "https://site.local");
        cleanKey = u.pathname || "/";
      } catch {}
      const entry = pageAgg.get(cleanKey) || {
        url: cleanKey,
        title: v.currentPageTitle || cleanKey,
        views: 0,
        visitorIds: new Set<string>(),
        totalTime: 0,
        totalScroll: 0,
        scrollCount: 0,
      };
      entry.views += 1;
      entry.visitorIds.add(v.id);
      pageAgg.set(cleanKey, entry);
    }
  }

  const topPages = Array.from(pageAgg.values())
    .sort((a, b) => b.views - a.views)
    .slice(0, 6)
    .map((p) => ({
      url: p.url,
      title: p.title,
      views: p.views,
      uniqueVisitors: p.visitorIds.size,
      avgTimeSec: p.views > 0 ? Math.round(p.totalTime / p.views) : 0,
      avgScroll: p.scrollCount > 0 ? Math.round(p.totalScroll / p.scrollCount) : 0,
      intent: inferPageIntent(p.url, p.title),
    }));

  // Traffic sources aggregation
  const sourceAgg = new Map<
    string,
    { source: string; count: number; hotCount: number; chatCount: number; dealCount: number }
  >();
  for (const v of enrichedVisitors) {
    const key = v.source || "Acesso Direto";
    const entry = sourceAgg.get(key) || {
      source: key,
      count: 0,
      hotCount: 0,
      chatCount: 0,
      dealCount: 0,
    };
    entry.count += 1;
    if (v.temperature === "hot") entry.hotCount += 1;
    if (v.chatsCount > 0 || v.attendanceStatus !== "browsing") entry.chatCount += 1;
    if (v.crmDeal) entry.dealCount += 1;
    sourceAgg.set(key, entry);
  }

  const trafficSources = Array.from(sourceAgg.values())
    .sort((a, b) => b.count - a.count)
    .map((s) => ({
      ...s,
      percentage: totalVisitors > 0 ? Math.round((s.count / totalVisitors) * 100) : 0,
    }));

  const whatsappOrDealCount = enrichedVisitors.filter(
    (v) => v.linkedWhatsApp || Boolean(v.crmDeal),
  ).length;

  return {
    visitors: enrichedVisitors,
    summary: {
      onlineNow,
      totalVisitors,
      hotVisitors,
      warmVisitors,
      coldVisitors,
      avgTimeOnSiteSec,
      avgScrollDepth,
      totalPageviews,
      totalClicks,
      visitorsWithChat,
      inAiTriage,
      inHumanService,
      waitingInQueue,
      continuedOnWhatsApp,
      visitorsWithCrmDeal,
      crmPipelineValue,
      crmWonValue,
      topPages,
      trafficSources,
      conversionFunnel: {
        visitors: totalVisitors,
        highIntent: hotVisitors,
        chatStarted: visitorsWithChat,
        whatsappOrDeal: whatsappOrDealCount,
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DETALHE DA JORNADA INDIVIDUAL (CustomerJourneyModal)
// ═══════════════════════════════════════════════════════════════════════════

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

  // Resolve real conversationId, operator, and CRM Deal
  const candidateConvIds = new Set<string>();
  const candidateContactIds = new Set<string>();
  if (primaryVisitor) {
    candidateConvIds.add(`conv-lc-${primaryVisitor.id}`);
    candidateContactIds.add(`cont-lc-${primaryVisitor.id}`);
  }
  if (contactRecord) {
    candidateContactIds.add(contactRecord.id);
  }
  for (const ch of rawChats) {
    if (ch.waConversationId) candidateConvIds.add(ch.waConversationId);
  }
  if (typeof cf.siteContinuity?.whatsappConversationId === "string") {
    candidateConvIds.add(cf.siteContinuity.whatsappConversationId);
  }

  const convIdArr = Array.from(candidateConvIds);
  const contactIdArr = Array.from(candidateContactIds);

  const foundConversations =
    convIdArr.length > 0 || contactIdArr.length > 0
      ? await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              convIdArr.length > 0 && contactIdArr.length > 0
                ? or(
                    inArray(conversations.id, convIdArr),
                    inArray(conversations.contactId, contactIdArr),
                  )
                : convIdArr.length > 0
                  ? inArray(conversations.id, convIdArr)
                  : inArray(conversations.contactId, contactIdArr),
            ),
          )
          .orderBy(desc(conversations.lastMessageTime))
      : [];

  const activeConversation = foundConversations[0] ?? null;

  // Fetch operator name if assigned
  let operatorName: string | null = null;
  const resolvedOperatorId =
    activeConversation?.operatorId || rawChats[0]?.operatorId || contactRecord?.walletOperatorId || null;
  if (resolvedOperatorId) {
    const [op] = await db
      .select({ name: operators.name })
      .from(operators)
      .where(and(eq(operators.tenantId, tenantId), eq(operators.id, resolvedOperatorId)))
      .limit(1);
    if (op) operatorName = op.name;
  }

  // Fetch CRM deal if linked
  let crmDeal: VisitorCrmDealSummary | null = null;
  const foundConvIdList = foundConversations.map((c) => c.id);
  const [cDeals, ctDeals] = await Promise.all([
    foundConvIdList.length > 0
      ? db
          .select()
          .from(crmConversationDeals)
          .where(
            and(
              eq(crmConversationDeals.tenantId, tenantId),
              eq(crmConversationDeals.isActive, true),
              inArray(crmConversationDeals.conversationId, foundConvIdList),
            ),
          )
      : Promise.resolve([]),
    contactIdArr.length > 0
      ? db
          .select()
          .from(crmDealContacts)
          .where(
            and(
              eq(crmDealContacts.tenantId, tenantId),
              inArray(crmDealContacts.contactId, contactIdArr),
            ),
          )
      : Promise.resolve([]),
  ]);

  const linkedDealIds = Array.from(
    new Set([...cDeals.map((d) => d.dealId), ...ctDeals.map((d) => d.dealId)]),
  );
  if (linkedDealIds.length > 0) {
    const [dealRow] = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, linkedDealIds)))
      .orderBy(desc(crmDeals.updatedAt))
      .limit(1);
    if (dealRow) {
      const [[pipeRow], [stageRow]] = await Promise.all([
        db
          .select({ name: crmPipelines.name })
          .from(crmPipelines)
          .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, dealRow.pipelineId)))
          .limit(1),
        db
          .select({ name: crmStages.name })
          .from(crmStages)
          .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, dealRow.stageId)))
          .limit(1),
      ]);
      crmDeal = {
        id: dealRow.id,
        title: dealRow.title,
        value: Number(dealRow.value || 0),
        status: dealRow.status,
        pipelineName: pipeRow?.name || null,
        stageName: stageRow?.name || null,
        operatorName,
      };
    }
  }

  // Fetch conversation messages (from both lcMessages and messages table)
  const [lcMsgRows, convMsgRows] = await Promise.all([
    primaryVisitor
      ? getVisitorAllMessages(tenantId, primaryVisitor.id, 80)
      : Promise.resolve([]),
    foundConvIdList.length > 0
      ? db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, tenantId),
              inArray(messages.conversationId, foundConvIdList),
              eq(messages.isInternalNote, false),
            ),
          )
          .orderBy(asc(messages.sentAt))
          .limit(80)
      : Promise.resolve([]),
  ]);

  const unifiedMessages: Array<{
    id: string;
    sender: "visitor" | "ai" | "operator" | "system";
    senderName: string;
    content: string;
    timestamp: string;
  }> = [];

  if (convMsgRows.length > 0) {
    for (const m of convMsgRows) {
      unifiedMessages.push({
        id: m.id,
        sender:
          m.senderType === "client"
            ? "visitor"
            : m.senderType === "bot"
              ? "ai"
              : m.senderType === "agent"
                ? "operator"
                : "system",
        senderName: m.senderName,
        content: m.content,
        timestamp: m.sentAt instanceof Date ? m.sentAt.toISOString() : String(m.sentAt),
      });
    }
  } else {
    for (const m of lcMsgRows) {
      unifiedMessages.push({
        id: m.id,
        sender: (m.sender as any) || "visitor",
        senderName:
          m.sender === "visitor"
            ? primaryVisitor?.name || "Visitante"
            : m.sender === "operator"
              ? operatorName || "Consultor"
              : "Assistente IA",
        content: m.content,
        timestamp: m.sentAt instanceof Date ? m.sentAt.toISOString() : String(m.sentAt),
      });
    }
  }

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
          const nowIso =
            contactRecord?.createdAt instanceof Date
              ? contactRecord.createdAt.toISOString()
              : new Date().toISOString();
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

  const timeline: Array<{
    type: string;
    timestamp: string;
    data: Record<string, any>;
  }> = [];

  const firstSessionStart =
    matchedVisitors.length > 0
      ? matchedVisitors[matchedVisitors.length - 1].sessionStart
      : contactRecord?.createdAt || new Date();
  const lastSeenAt = primaryVisitor?.lastSeenAt || contactRecord?.updatedAt || new Date();

  const referrer =
    primaryVisitor?.referrer ||
    siteContext?.entry?.referrer ||
    siteContext?.page?.referrer ||
    null;
  const firstUrl = pageviews[0]?.url || primaryVisitor?.currentUrl || siteContext?.page?.url || null;
  const source = inferTrafficSource(referrer, firstUrl);
  const uaDetails = parseUserAgentDetails(primaryVisitor?.userAgent);
  const location = extractLocation(contactRecord, primaryVisitor?.phone);

  timeline.push({
    type: "session_start",
    timestamp:
      firstSessionStart instanceof Date ? firstSessionStart.toISOString() : String(firstSessionStart),
    data: {
      source,
      referrer,
      device: uaDetails.device,
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
        summary: (chat as any).aiSummary || null,
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
        contactRecord?.createdAt instanceof Date
          ? contactRecord.createdAt.toISOString()
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
        (rawChats.length > 0 || activeConversation ? 25 : 0),
    ),
  );

  const computedEngagementScore = Math.min(
    100,
    Math.min(30, pageviews.length * 8) +
      Math.min(25, Math.round(totalTimeOnSite / 12)) +
      Math.min(20, Math.round(avgScrollDepth / 5)) +
      Math.min(25, clickEvents.length * 10 + (rawChats.length > 0 || activeConversation ? 15 : 0)),
  );

  const isOnline = primaryVisitor
    ? siteGateway.isOnline(tenantId, primaryVisitor.id) ||
      Date.now() - new Date(primaryVisitor.lastSeenAt).getTime() < ONLINE_WINDOW_MS
    : false;

  const { temperature } = normalizeTemperature(primaryVisitor?.temperature, computedIntentScore);

  const visitorProfile = {
    id: primaryVisitor?.id || (contactRecord ? `cont-${contactRecord.id}` : "unknown"),
    contactId: contactRecord?.id || (primaryVisitor ? `cont-lc-${primaryVisitor.id}` : null),
    conversationId: activeConversation?.id || null,
    operatorName,
    crmDeal,
    cookieId: primaryVisitor?.cookieId || cf.siteCookieId || "",
    name: contactRecord?.name || primaryVisitor?.name || "Visitante do Site",
    email: contactRecord?.email || primaryVisitor?.email || null,
    phone: contactRecord?.phone || primaryVisitor?.phone || null,
    cpfCnpj: contactRecord?.cnpj || contactRecord?.cpf || primaryVisitor?.cnpj || null,
    company:
      primaryVisitor?.company ||
      (contactRecord?.cnpjDetails as any)?.razao_social ||
      null,
    productInterest:
      primaryVisitor?.productInterest ||
      siteContext?.product?.name ||
      cf.productInterest ||
      null,
    currentPage:
      primaryVisitor?.currentUrl ||
      siteContext?.page?.url ||
      pageviews[pageviews.length - 1]?.url ||
      null,
    currentPageTitle:
      primaryVisitor?.currentTitle ||
      siteContext?.page?.title ||
      pageviews[pageviews.length - 1]?.pageTitle ||
      null,
    referrer,
    source,
    device: uaDetails.device,
    userAgent: primaryVisitor?.userAgent || null,
    ipAddress: primaryVisitor?.ipAddress || null,
    city: location.city,
    region: location.region,
    country: location.country,
    isOnline,
    visitCount: Math.max(1, matchedVisitors.length),
    totalTimeOnSite,
    avgScrollDepth,
    leadScore: computedIntentScore,
    engagementScore: computedEngagementScore,
    pipelineStage:
      crmDeal
        ? "converted"
        : rawChats.length > 0 || activeConversation
          ? "attending"
          : computedIntentScore >= 60
            ? "interested"
            : "new_visitor",
    temperature,
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
      aiSummary: (c as any).aiSummary || null,
      startedAt: c.startedAt instanceof Date ? c.startedAt.toISOString() : String(c.startedAt),
      closedAt:
        c.closedAt instanceof Date
          ? c.closedAt.toISOString()
          : c.closedAt
            ? String(c.closedAt)
            : null,
    })),
    messages: unifiedMessages,
    timeline,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MÉTRICAS (para AnalyticsView)
// ═══════════════════════════════════════════════════════════════════════════

export async function getLiveChatMetrics(tenantId: string, sinceHours = 24) {
  const nowMs = Date.now();
  const since = new Date(nowMs - sinceHours * 60 * 60 * 1000);
  const onlineThreshold = new Date(nowMs - ONLINE_WINDOW_MS);

  const [visitorsRows, chatsRows] = await Promise.all([
    db
      .select({
        id: lcVisitors.id,
        intentScore: lcVisitors.intentScore,
        lastSeenAt: lcVisitors.lastSeenAt,
      })
      .from(lcVisitors)
      .where(and(eq(lcVisitors.tenantId, tenantId), gte(lcVisitors.lastSeenAt, since)))
      .catch(() => []),
    db
      .select({
        id: lcChats.id,
        status: lcChats.status,
        outcome: lcChats.outcome,
        waConversationId: lcChats.waConversationId,
      })
      .from(lcChats)
      .where(and(eq(lcChats.tenantId, tenantId), gte(lcChats.startedAt, since)))
      .catch(() => []),
  ]);

  const uniqueVisitors = visitorsRows.length;
  const chatsStarted = chatsRows.length;
  const bridgesToWhatsApp = chatsRows.filter(
    (c) => c.outcome === "bridge_whatsapp" || Boolean(c.waConversationId)
  ).length;

  const activeVisitorsOnline = visitorsRows.filter(
    (v) =>
      siteGateway.isOnline(tenantId, v.id) ||
      (v.lastSeenAt && new Date(v.lastSeenAt).getTime() >= onlineThreshold.getTime())
  ).length;
  const activeOpenChats = chatsRows.filter((c) => c.status !== "closed").length;
  const activeSessions = Math.max(activeVisitorsOnline, activeOpenChats);

  const validScores = visitorsRows
    .map((v) => Number(v.intentScore ?? 0))
    .filter((s) => Number.isFinite(s) && s > 0);
  const avgScore =
    validScores.length > 0
      ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
      : 0;

  const totalSessionsOrChats = Math.max(uniqueVisitors, chatsStarted);
  const conversionBase = uniqueVisitors > 0 ? uniqueVisitors : chatsStarted;
  const convertedCount = uniqueVisitors > 0 ? Math.max(chatsStarted, bridgesToWhatsApp) : bridgesToWhatsApp;
  const conversionRate =
    conversionBase > 0 ? Math.min(100, Math.round((convertedCount / conversionBase) * 100)) : 0;

  return {
    uniqueVisitors,
    chatsStarted,
    bridgesToWhatsApp,
    totalChats: totalSessionsOrChats,
    activeSessions,
    bridgesWhatsapp: bridgesToWhatsApp,
    avgScore,
    conversionRate,
  };
}
