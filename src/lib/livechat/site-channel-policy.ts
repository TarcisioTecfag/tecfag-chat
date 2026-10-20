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
