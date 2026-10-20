/**
 * Regras puras do canal Site (widget) quando o tenant usa o núcleo de triagem industrial.
 * Sem IO: compartilhado pelo adaptador WebSocket, pelo SdrEngine e pelos testes.
 */
import { isValidTriageDocument } from "../triage/industrial-policy.ts";

/** Canal registrado em `contacts.mainChannel` — mesmo valor já reconhecido pela UI e pelo Supervisor. */
export const SITE_CHANNEL = "livechat";
/** Provedor gravado em `messages.provider`; nunca entra na fila de retry Meta/Baileys. */
export const SITE_PROVIDER = "livechat";

const CONVERSATION_PREFIX = "conv-lc-";
const CONTACT_PREFIX = "cont-lc-";
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * IDs determinísticos por visitante. O visitante é resolvido no servidor pelo cookie
 * dentro do tenant; o ID nunca vem do corpo de uma requisição autenticada.
 */
export function siteIdentityIds(visitorId: string) {
  if (!SAFE_ID.test(visitorId)) throw new Error("Identificador de visitante inválido");
  return { contactId: `${CONTACT_PREFIX}${visitorId}`, conversationId: `${CONVERSATION_PREFIX}${visitorId}` };
}

export function isSiteConversationId(conversationId: string | null | undefined): boolean {
  return typeof conversationId === "string" && conversationId.startsWith(CONVERSATION_PREFIX);
}

export function visitorIdFromSiteConversation(conversationId: string): string | null {
  if (!isSiteConversationId(conversationId)) return null;
  const visitorId = conversationId.slice(CONVERSATION_PREFIX.length);
  return SAFE_ID.test(visitorId) ? visitorId : null;
}

export interface SiteChannelSettings {
  /** SDR habilitado E canal Site explicitamente habilitado pelo administrador. */
  enabled: boolean;
  /** Origens autorizadas (scheme + host [+ porta]). Lista vazia = sem restrição de origem. */
  allowedOrigins: string[];
  /** WhatsApp da empresa para continuar o atendimento do site; vazio = recurso indisponível. */
  whatsappNumber: string;
}

function normalizeOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Lê a configuração do agente SDR (`agentConfigs` tipo `sdr`). O canal Site é desligado
 * por padrão: existir persona ou SDR habilitado não liga o atendimento no site.
 */
export function parseSiteChannelSettings(
  sdrEnabled: boolean,
  config: Record<string, unknown> | null | undefined,
): SiteChannelSettings {
  const raw = config || {};
  const origins = Array.isArray(raw.siteAllowedOrigins) ? raw.siteAllowedOrigins : [];
  return {
    enabled: sdrEnabled && raw.siteChannelEnabled === true,
    allowedOrigins: Array.from(
      new Set(origins.filter((o): o is string => typeof o === "string").map(normalizeOrigin).filter((o): o is string => Boolean(o))),
    ),
    whatsappNumber: normalizeWhatsappNumber(raw.siteWhatsappNumber),
  };
}

/** Origem ausente só é aceita quando não há lista configurada. */
export function isSiteOriginAllowed(origin: string | null | undefined, allowedOrigins: string[]): boolean {
  if (!allowedOrigins.length) return true;
  const normalized = origin ? normalizeOrigin(origin) : null;
  return Boolean(normalized && allowedOrigins.includes(normalized));
}

/**
 * Dados do pré-chat do widget. Documento só é guardado quando os dígitos verificadores
 * conferem — isso não comprova titularidade nem situação cadastral.
 */
export function sanitizeSiteIdentity(name: unknown, doc: unknown) {
  const cleanName = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const digits = typeof doc === "string" ? doc.replace(/\D/g, "") : "";
  const validDoc = digits && isValidTriageDocument(digits) ? digits : "";
  return {
    name: cleanName.length >= 2 ? cleanName : "",
    cpf: validDoc.length === 11 ? validDoc : null,
    cnpj: validDoc.length === 14 ? validDoc : null,
  };
}

/** Limite defensivo para texto livre do visitante antes de persistir/enviar à IA. */
export function clampSiteText(raw: unknown, max = 4000): string {
  return typeof raw === "string" ? raw.slice(0, max).trim() : "";
}

// ── Continuidade site → WhatsApp ──────────────────────────────────────────────
// O widget recebe um código temporário de uso único; a mensagem enviada do WhatsApp com
// esse código prova, ao mesmo tempo, posse da sessão do site e do telefone de origem.

/** Sem 0/O/1/I/L para evitar erro de digitação ao copiar o código. */
const CONTINUITY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CONTINUITY_TTL_MS = 30 * 60 * 1000;

/** Metadado inválido nunca amplia a validade do código de uso único. */
export function isUsableContinuityRecord(record: unknown, now = Date.now()): boolean {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const { expiresAt, usedAt } = record as Record<string, unknown>;
  if (usedAt !== undefined && usedAt !== null) return false;
  if (typeof expiresAt !== "string" || !Number.isFinite(now)) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

export function generateContinuityCode(randomBytes: (size: number) => Uint8Array): string {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => CONTINUITY_ALPHABET[b % CONTINUITY_ALPHABET.length]).join("");
  return `SITE-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

/** Extrai e normaliza o código de uma mensagem livre (aceita minúsculas e espaços/hífens). */
export function extractContinuityCode(text: unknown): string | null {
  if (typeof text !== "string" || text.length > 2000) return null;
  const match = text
    .toUpperCase()
    .match(/\bSITE[\s-]*([A-HJ-KM-NP-Z2-9]{4})[\s-]*([A-HJ-KM-NP-Z2-9]{4})\b/);
  return match ? `SITE-${match[1]}-${match[2]}` : null;
}

/** Só o hash fica no banco; o código em texto existe apenas no widget e na mensagem do cliente. */
export function hashContinuityCode(
  tenantId: string,
  code: string,
  sha256Hex: (value: string) => string,
): string {
  return sha256Hex(`site-continuity:${tenantId}:${code.toUpperCase()}`);
}

/** Número E.164 sem símbolos (10 a 15 dígitos) ou vazio. */
export function normalizeWhatsappNumber(raw: unknown): string {
  const digits = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

export function buildContinuationUrl(whatsappNumber: string, code: string, company: string): string {
  const text = `Olá! Estava sendo atendido(a) no site da ${company} e quero continuar por aqui. Código: ${code}`;
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
}

/** Remove do metadado copiado tudo o que é efeito do ciclo anterior (checkpoint, recibo, tentativas). */
export function stripHandoffState(metadata: Record<string, unknown> | null | undefined) {
  const copy: Record<string, unknown> = { ...(metadata || {}) };
  for (const key of Object.keys(copy)) {
    if (key.startsWith("handoff") || ["readyForHandoff", "localCrmDealId", "localCrmDealTitle", "localCrmDealAction", "allocatedOperatorId", "allocatedOperatorName", "previousTriages"].includes(key))
      delete copy[key];
  }
  return copy;
}
