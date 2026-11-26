/**
 * Regras puras do canal Site (widget) quando o tenant usa o núcleo de triagem industrial.
 * Sem IO: compartilhado pelo adaptador WebSocket, pelo SdrEngine e pelos testes.
 */
import { isValidIndustrialPersonName, isValidTriageDocument } from "../triage/industrial-policy.ts";
import type { IndustrialBusinessHoursEvaluation } from "../triage/industrial-business-hours.ts";

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
  /** ID ou nome do template oficial Meta aprovado para o Fagner chamar o cliente no WhatsApp pós-triagem no site. */
  whatsappTemplateId: string;
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
  const rawTemplate = typeof raw.siteWhatsappTemplateId === "string" ? raw.siteWhatsappTemplateId.trim() : "";
  return {
    enabled: sdrEnabled && raw.siteChannelEnabled === true,
    allowedOrigins: Array.from(
      new Set(origins.filter((o): o is string => typeof o === "string").map(normalizeOrigin).filter((o): o is string => Boolean(o))),
    ),
    whatsappNumber: normalizeWhatsappNumber(raw.siteWhatsappNumber),
    whatsappTemplateId: rawTemplate.slice(0, 160),
  };
}

/**
 * Destinos operacionais com funil próprio (Pós-Venda, Assistência/Suporte Técnico, Financeiro)
 * criam card diretamente no funil do setor ao prosseguir no WhatsApp — sem poluir o FUNIL CWR.
 * Destinos comerciais (Máquinas, Personnalité, Peças, Projetos, Análise SDR) nascem no FUNIL CWR (CONTATANDO).
 */
export function isCommercialSiteDestination(destinationKey?: string | null): boolean {
  const key = String(destinationKey || "").trim().toUpperCase();
  if (!key) return true;
  if (key === "FINANCEIRO" || key === "3_AT" || key === "POS_VENDA") return false;
  return true;
}

/** Mensagem limpa exibida no chat do site após o disparo confirmado do template oficial no WhatsApp. */
export function buildSiteToWhatsappClosingMessage(
  clientName?: string | null,
  options?: {
    hasActiveHuman?: boolean;
    businessHours?: IndustrialBusinessHoursEvaluation | null;
  },
): string {
  const clean = (clientName || "").trim();
  const isGeneric =
    !clean ||
    /^(cliente|contato|visitante|lead|whatsapp|sem nome)/i.test(clean) ||
    /^\+?\d{6,20}$/.test(clean.replace(/[\s().-]/g, ""));
  const first = !isGeneric ? clean.split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "") || "" : "";
  const greeting = first.length >= 2 ? `Perfeito, ${first}!` : "Perfeito!";
  const base = options?.hasActiveHuman
    ? `${greeting} Já reuni as informações do seu atendimento e repassei tudo no seu atendimento que já está aberto no WhatsApp para darmos continuidade por lá.`
    : `${greeting} Já reuni as informações do seu atendimento e eu mesmo acabei de te chamar no seu WhatsApp para darmos continuidade por lá.`;

  const bh = options?.businessHours;
  if (bh?.enabled && bh.status === "closed") {
    return `${base} Como estamos fora do nosso horário comercial, nosso especialista dará continuidade ao seu atendimento por lá ${bh.nextOpen.label}.`;
  }
  if (bh?.enabled && bh.status === "closing_soon") {
    return `${base} Nosso expediente comercial vai até as ${bh.endTimeLabel}, então caso o especialista não consiga retornar ainda hoje, o atendimento segue por lá ${bh.nextOpen.label}.`;
  }
  return base;
}

/** Origem ausente só é aceita quando não há lista configurada. */
export function isSiteOriginAllowed(origin: string | null | undefined, allowedOrigins: string[]): boolean {
  if (!allowedOrigins.length) return true;
  const normalized = origin ? normalizeOrigin(origin) : null;
  return Boolean(normalized && allowedOrigins.includes(normalized));
}

/** Normaliza telefone informado no pré-chat do site para formato E.164 BR apenas dígitos (ex.: 5514999999999). */
export function normalizeSitePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1);
  }
  if (digits.length === 10 || digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);
    if (!/^[1-9][1-9]$/.test(ddd) || /^(\d)\1+$/.test(local)) return null;
    return `55${digits}`;
  }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    if (!/^[1-9][1-9]$/.test(ddd) || /^(\d)\1+$/.test(local)) return null;
    return digits;
  }
  if (digits.length >= 10 && digits.length <= 15 && !/^(\d)\1+$/.test(digits)) {
    return digits;
  }
  return null;
}

/** Normaliza e-mail informado no pré-chat do site. */
export function normalizeSiteEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.trim().toLowerCase().slice(0, 160);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) ? clean : null;
}

/**
 * Dados do pré-chat do widget. Documento só é guardado quando os dígitos verificadores
 * conferem — isso não comprova titularidade nem situação cadastral.
 */
export function sanitizeSiteIdentity(
  name: unknown,
  doc: unknown,
  email?: unknown,
  phone?: unknown,
) {
  const cleanName = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const validName = cleanName.length >= 2 && isValidIndustrialPersonName(cleanName) ? cleanName : "";
  const digits = typeof doc === "string" ? doc.replace(/\D/g, "") : "";
  const validDoc = digits && isValidTriageDocument(digits) ? digits : "";
  return {
    name: validName,
    cpf: validDoc.length === 11 ? validDoc : null,
    cnpj: validDoc.length === 14 ? validDoc : null,
    email: normalizeSiteEmail(email),
    phone: normalizeSitePhone(phone),
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

const SAFE_MEDIA_TENANT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/i;
const SAFE_CATALOG_FILE_ID_RE = /^(kf-[a-z0-9][a-z0-9_-]{2,120})(?:\.(png|jpe?g|webp|gif))?$/i;

export const LIVECHAT_CATALOG_MEDIA_PATH = "/api/livechat/catalog-media";

export const SITE_CATALOG_IMAGE_MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export function isValidSiteMediaTenantId(tenantId: string | null | undefined): boolean {
  return SAFE_MEDIA_TENANT_ID_RE.test(String(tenantId || "").trim());
}

export function parseCatalogMediaFileParam(raw: string | null | undefined): {
  fileId: string;
  ext: string | null;
} | null {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^\/+knowledge-media\//i, "")
    .split("?")[0]
    .split("#")[0];
  if (!cleaned || cleaned.includes("/") || cleaned.includes("\\") || cleaned.includes("..")) {
    return null;
  }
  const match = cleaned.match(SAFE_CATALOG_FILE_ID_RE);
  if (!match) return null;
  return {
    fileId: match[1],
    ext: match[2] ? match[2].toLowerCase() : null,
  };
}

/**
 * Converte uma URL interna de catálogo (`/knowledge-media/kf-...png`) em URL pública
 * servida diretamente do banco (`knowledge_files`) com isolamento por `tenantId`.
 */
export function buildSiteCatalogMediaUrl(tenantId: string, rawUrlOrFileName: string): string {
  const trimmed = String(rawUrlOrFileName || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(`${LIVECHAT_CATALOG_MEDIA_PATH}?`)) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const parsed = parseCatalogMediaFileParam(trimmed);
  if (!parsed || !isValidSiteMediaTenantId(tenantId)) {
    return trimmed;
  }
  const fileToken = parsed.ext ? `${parsed.fileId}.${parsed.ext}` : parsed.fileId;
  const params = new URLSearchParams({
    tenantId: tenantId.trim(),
    file: fileToken,
  });
  return `${LIVECHAT_CATALOG_MEDIA_PATH}?${params.toString()}`;
}
