import { linkSiteContinuityInDatabase } from "./site-continuity-store";
/**
 * Continuidade segura site → WhatsApp (Etapa E4 do porte).
 *
 * 1. O visitante pede "Continuar no WhatsApp" no widget: o servidor gera um código de uso único
 *    (30 min) e guarda apenas o hash no contato do site.
 * 2. O cliente envia o código pelo WhatsApp. A mensagem prova posse do telefone; o código prova
 *    posse da sessão do site. Só então as duas conversas são vinculadas, dentro do mesmo tenant.
 * 3. O histórico do site é copiado para a conversa do WhatsApp. Se a triagem ainda estava com a IA,
 *    ela continua de onde parou (dados coletados preservados, sem nova saudação). Se já havia
 *    responsável, a conversa do WhatsApp vai para o mesmo operador e card, sem novo rodízio.
 */
import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { contacts, conversations } from "../../db/schema";
import type { LcVisitor } from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";
import { getOrCreateActiveChat, saveMessage } from "./livechatStorage";
import { siteGateway } from "./site-gateway";
import {
  CONTINUITY_TTL_MS,
  buildContinuationUrl,
  extractContinuityCode,
  generateContinuityCode,
  hashContinuityCode,
  isSiteConversationId,
  siteIdentityIds,
} from "./site-channel-policy";
import {
  ensureSiteConversation,
  loadSiteChannelSettings,
  usesIndustrialSiteCore,
} from "./site-industrial-adapter";

const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export type ContinuationRequestResult =
  | { ok: true; code: string; url: string; expiresAt: string }
  | { ok: false; reason: "disabled" | "no_whatsapp_number"; message: string };

/** Gera (ou substitui) o código do visitante. Um novo pedido invalida o código anterior. */
export async function createSiteContinuation(
  tenantId: string,
  visitor: LcVisitor,
): Promise<ContinuationRequestResult> {
  const settings = await loadSiteChannelSettings(tenantId);
  if (!settings.enabled)
    return {
      ok: false,
      reason: "disabled",
      message: "Atendimento pelo site indisponível no momento.",
    };
  if (!settings.whatsappNumber)
    return {
      ok: false,
      reason: "no_whatsapp_number",
      message: "A continuação pelo WhatsApp ainda não está disponível. Pode seguir por aqui mesmo!",
    };
  await ensureSiteConversation(tenantId, visitor);
  const { contactId } = siteIdentityIds(visitor.id);
  const code = generateContinuityCode((size) => crypto.randomBytes(size));
  const expiresAt = new Date(Date.now() + CONTINUITY_TTL_MS).toISOString();
  const continuity = {
    codeHash: hashContinuityCode(tenantId, code, sha256Hex),
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  await db
    .update(contacts)
    .set({
      customFields: sql`coalesce(${contacts.customFields}, '{}'::jsonb) || jsonb_build_object('siteContinuity', ${JSON.stringify(continuity)}::jsonb)`,
    })
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
  return {
    ok: true,
    code,
    url: buildContinuationUrl(settings.whatsappNumber, code, getAiPersona(tenantId).company),
    expiresAt,
  };
}

export type ContinuityLinkResult =
  | { linked: false; reason: "no_code" | "not_industrial" | "invalid_or_expired" | "same_channel" }
  | {
      linked: true;
      /** automation: a IA continua a triagem no WhatsApp; operator: já existe responsável humano. */
      mode: "automation" | "operator";
      siteConversationId: string;
      whatsappConversationId: string;
      operatorId: string | null;
      copiedMessages: number;
    };

/**
 * Chamado quando chega mensagem de cliente no WhatsApp de um tenant industrial.
 * Não envia nada ao cliente; apenas vincula e devolve o modo para o chamador decidir se a IA responde.
 */
export async function linkSiteContinuity(
  tenantId: string,
  whatsappConversationId: string,
  text: unknown,
): Promise<ContinuityLinkResult> {
  const code = extractContinuityCode(text);
  if (!code) return { linked: false, reason: "no_code" };
  if (!usesIndustrialSiteCore(tenantId)) return { linked: false, reason: "not_industrial" };
  if (isSiteConversationId(whatsappConversationId))
    return { linked: false, reason: "same_channel" };
  const codeHash = hashContinuityCode(tenantId, code, sha256Hex);

  const result = await linkSiteContinuityInDatabase(db, tenantId, whatsappConversationId, codeHash);
  if (!result.linked) return result;
  const { visitorId, ...publicResult } = result;
  await notifyContinuity(tenantId, publicResult, visitorId).catch(() => {});
  return publicResult;
}

async function notifyContinuity(
  tenantId: string,
  result: Extract<ContinuityLinkResult, { linked: true }>,
  visitorId: string,
) {
  const session = SessionManager.getInstance();
  const [waConv, siteConv] = await Promise.all([
    db.query.conversations.findFirst({
      where: (t, { eq: dEq, and: dAnd }) =>
        dAnd(dEq(t.tenantId, tenantId), dEq(t.id, result.whatsappConversationId)),
    }),
    db.query.conversations.findFirst({
      where: (t, { eq: dEq, and: dAnd }) =>
        dAnd(dEq(t.tenantId, tenantId), dEq(t.id, result.siteConversationId)),
    }),
  ]);
  for (const conv of [waConv, siteConv]) {
    if (!conv) continue;
    session.notifyPublic(tenantId, {
      type: "queue_update",
      conversationId: conv.id,
      queueState: conv.queueState,
      operatorId: conv.operatorId,
      sectorId: conv.sectorId,
      version: conv.version,
    });
  }
  // Widget: aviso persistido no histórico do visitante.
  const chat = await getOrCreateActiveChat(tenantId, visitorId);
  const text = "Pronto! Seu atendimento continua no WhatsApp. Pode seguir a conversa por lá.";
  const saved = await saveMessage(tenantId, chat.id, "system", text);
  siteGateway.push(tenantId, visitorId, {
    type: "whatsapp_continued",
    chatId: chat.id,
    messageId: saved.id,
    content: text,
  });
}
