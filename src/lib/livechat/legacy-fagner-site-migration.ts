/**
 * Motor ETL idempotente para migração completa do histórico "Fagner Site" (sistema legado)
 * para o padrão nativo do Valem Chat (multi-tenant, estritamente isolado por `tenantId`).
 *
 * Princípios invioláveis:
 * - Isolamento estrito em `tenantId` (padrão: "tecfag") — nunca toca no tenant "valem".
 * - Dupla camada nativa:
 *   1) 100% dos visitantes, pageviews, cliques, chats e mensagens em `lc_*` (preservando `cookie_id`
 *      `"tecfag_visitor_id"`, idêntico entre o widget legado e o widget v2, com merge automático
 *      para visitantes que já retornaram após a virada).
 *   2) Conversas reais do site (`lc_messages` > 0) materializadas em `conversations`
 *      (`conv-lc-<visitorId>`, `queue_state = 'finalizados'`, `unread_count = 0`) + `messages`
 *      (`provider = 'livechat'`), preservando datas originais.
 * - ZERO escrita em `agent_flow_states` → o Kanban da aba `Site` permanece 100% limpo.
 * - Match em 4 camadas (`contact_phone_identity` → CPF/CNPJ/`crm_accounts` → `rd_deal_id` → e-mail único),
 *   com enriquecimento estritamente não-destrutivo e dossiê completo em `custom_fields.legacyFagnerSite`.
 */
import crypto from "node:crypto";
import { computeContactPhoneIdentity, inferContactPhoneType } from "../contact-phone-types";

// ─── Tipos de Executor SQL (compatível com postgres.js, pg e PGlite) ─────────

export interface SqlExecutor {
  query<T = Record<string, any>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface LegacyMigrationOptions {
  tenantId: string;
  dryRun: boolean;
  batchSize?: number;
  includeConversations?: boolean;
  onProgress?: (stage: string, detail: string) => void;
}

export type MatchTier =
  | "phone"
  | "document"
  | "rd_deal"
  | "email"
  | "new_identified"
  | "new_chat_anonymous"
  | "anonymous_only";

export interface AmbiguousMatchItem {
  legacyVisitorId: string;
  cookieId: string;
  reason: string;
  candidateValue: string;
  candidateContactIds: string[];
}

export interface MigrationReport {
  tenantId: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sourceCounts: {
    lcVisitors: number;
    lcPageviews: number;
    lcClickEvents: number;
    lcChats: number;
    lcMessages: number;
    ucBridgeSiteRows: number;
  };
  deduplication: {
    canonicalVisitors: number;
    mergedIntoExistingActiveV2Cookie: number;
    mergedDuplicateLegacyCookies: number;
    visitorsWithChats: number;
    visitorsWithMessages: number;
  };
  matching: {
    matchedByPhone: number;
    matchedByDocument: number;
    matchedByRdDeal: number;
    matchedByEmail: number;
    totalMatchedExistingContacts: number;
    uniqueExistingContactsEnriched: number;
    newIdentifiedContacts: number;
    newAnonymousChatContacts: number;
    anonymousVisitorsWithoutContact: number;
    linkedToWhatsAppConversation: number;
    ambiguousMatchesCount: number;
    ambiguousMatches: AmbiguousMatchItem[];
  };
  targetPlannedOrWritten: {
    lcVisitorsInserted: number;
    lcVisitorsMerged: number;
    lcPageviewsInserted: number;
    lcClickEventsInserted: number;
    lcChatsInserted: number;
    lcMessagesInserted: number;
    contactsCreated: number;
    contactsUpdated: number;
    contactPhonesInserted: number;
    conversationsInserted: number;
    messagesInserted: number;
    agentFlowStatesInserted: 0;
  };
  warnings: string[];
}

// ─── Constantes & Helpers Puros ──────────────────────────────────────────────

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const GENERIC_EMAIL_DOMAINS_BLOCKLIST = new Set([
  "teste.com",
  "teste.com.br",
  "test.com",
  "example.com",
  "nao.com",
  "naoinformado.com",
  "sememail.com",
]);
const GENERIC_EMAIL_EXACT_BLOCKLIST = new Set([
  "teste@teste.com",
  "teste@gmail.com",
  "nao@informado.com",
  "naotem@gmail.com",
  "sem@email.com",
  "n/a",
]);

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sanitizeVisitorId(rawId: string): string {
  const clean = String(rawId || "").trim();
  if (SAFE_ID_RE.test(clean)) return clean;
  return `legv-${sha256Hex(clean || crypto.randomUUID()).slice(0, 32)}`;
}

export function deterministicLegacyId(prefix: string, seed: string): string {
  return `${prefix}-${sha256Hex(seed).slice(0, 36)}`;
}

export function parseLegacyTimestamp(raw: unknown, fallback?: Date): Date {
  const safeFallback = fallback && !Number.isNaN(fallback.getTime()) ? fallback : new Date();
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? safeFallback : raw;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? safeFallback : d;
  }
  if (typeof raw !== "string") return safeFallback;
  const trimmed = raw.trim();
  if (!trimmed) return safeFallback;

  // Normaliza formato PostgreSQL "YYYY-MM-DD HH:mm:ss.sss+00" ou sem TZ para ISO
  let normalized = trimmed;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(normalized)) {
    normalized = normalized.replace(/\s+/, "T");
    if (!/[zZ]$|[+-]\d{2}(:?\d{2})?$/.test(normalized)) {
      normalized += "Z";
    } else if (/[+-]\d{2}$/.test(normalized)) {
      normalized += ":00";
    }
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return safeFallback;
  // Rejeita datas absurdas (< 2018 ou > 2100)
  const year = parsed.getUTCFullYear();
  if (year < 2018 || year > 2100) return safeFallback;
  return parsed;
}

export function normalizeLegacyPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8) return null;

  // Remove zero à esquerda de DDD (ex.: 014999999999)
  if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1);
  }
  // Número brasileiro sem DDI 55 (10 ou 11 dígitos)
  if (digits.length === 10 || digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);
    if (/^[1-9][1-9]$/.test(ddd) && !/^(\d)\1+$/.test(local)) {
      return `55${digits}`;
    }
    return null;
  }
  // Número brasileiro com DDI 55 (12 ou 13 dígitos)
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    if (/^[1-9][1-9]$/.test(ddd) && !/^(\d)\1+$/.test(local)) {
      return digits;
    }
    return null;
  }
  // Internacional explícito
  if (digits.length >= 10 && digits.length <= 15 && !/^(\d)\1+$/.test(digits)) {
    return trimmed.startsWith("+") ? `+${digits}` : digits;
  }
  return null;
}

export function isValidCpf(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === Number(digits[10]);
}

export function isValidCnpj(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, idx) => acc + Number(base[idx]) * w, 0);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  const d1 = calc(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== Number(digits[12])) return false;
  const d2 = calc(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === Number(digits[13]);
}

export function extractValidDocument(
  ...candidates: Array<unknown>
): { cpf: string | null; cnpj: string | null; digits: string | null } {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const digits = candidate.replace(/\D/g, "");
    if (digits.length === 14 && isValidCnpj(digits)) {
      return { cpf: null, cnpj: digits, digits };
    }
    if (digits.length === 11 && isValidCpf(digits)) {
      return { cpf: digits, cnpj: null, digits };
    }
  }
  return { cpf: null, cnpj: null, digits: null };
}

export function normalizeLegacyEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.trim().toLowerCase().slice(0, 160);
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) return null;
  if (GENERIC_EMAIL_EXACT_BLOCKLIST.has(clean)) return null;
  const domain = clean.split("@")[1];
  if (!domain || GENERIC_EMAIL_DOMAINS_BLOCKLIST.has(domain)) return null;
  return clean;
}

export function isGenericName(name: string | null | undefined, phone?: string | null): boolean {
  const value = (name || "").trim();
  if (!value) return true;
  const lower = value.toLowerCase();
  if (
    lower === "visitante" ||
    lower === "visitante do site" ||
    lower === "visitante anônimo" ||
    lower === "visitante anonimo" ||
    lower === "contato whatsapp" ||
    lower === "sem nome" ||
    lower === "desconhecido" ||
    lower === "cliente" ||
    lower.startsWith("visitante #")
  ) {
    return true;
  }
  if (/^[\d\s()+-]+$/.test(value)) return true;
  const phoneDigits = (phone || "").replace(/\D/g, "");
  if (phoneDigits && value.replace(/\D/g, "") === phoneDigits && !/[a-z]/i.test(value)) {
    return true;
  }
  return false;
}

export function normalizeLegacyClickType(rawType?: string | null): string {
  const clean = String(rawType || "").trim().toLowerCase();
  const valid = new Set([
    "whatsapp_click",
    "phone_click",
    "cta_click",
    "widget_open",
    "add_to_cart",
    "product_view",
    "chat_sent",
  ]);
  if (valid.has(clean)) return clean;
  if (clean.includes("whatsapp") || clean.includes("whats") || clean.includes("wpp")) {
    return "whatsapp_click";
  }
  if (clean.includes("phone") || clean.includes("tel") || clean.includes("ligar")) {
    return "phone_click";
  }
  if (clean.includes("cart") || clean.includes("comprar") || clean.includes("checkout")) {
    return "add_to_cart";
  }
  if (clean.includes("product") || clean.includes("equipamento") || clean.includes("maquina")) {
    return "product_view";
  }
  if (clean.includes("widget") || clean.includes("chat")) return "widget_open";
  return "cta_click";
}

export function normalizeLegacyLcSender(raw: unknown): "visitor" | "ai" | "operator" | "system" {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "visitor" || s === "client" || s === "user") return "visitor";
  if (s === "ai" || s === "bot" || s === "fagner" || s === "assistant") return "ai";
  if (s === "agent" || s === "operator" || s === "human" || s === "consultor") return "operator";
  if (s === "system") return "system";
  return "visitor";
}

export function mapLegacySenderToCoreMessage(
  lcSender: "visitor" | "ai" | "operator" | "system",
  visitorName: string | null,
): {
  senderType: "client" | "bot" | "agent" | "system";
  senderName: string;
  direction: "inbound" | "outbound";
} {
  switch (lcSender) {
    case "visitor":
      return {
        senderType: "client",
        senderName: visitorName && !isGenericName(visitorName) ? visitorName : "Visitante do site",
        direction: "inbound",
      };
    case "ai":
      return {
        senderType: "bot",
        senderName: "Fagner IA",
        direction: "outbound",
      };
    case "operator":
      return {
        senderType: "agent",
        senderName: "Consultor (Site Legado)",
        direction: "outbound",
      };
    default:
      return {
        senderType: "system",
        senderName: "Sistema",
        direction: "outbound",
      };
  }
}

export function computeLegacyTemperature(score: number, category?: string | null): "quente" | "morno" | "frio" {
  const cat = String(category || "").toLowerCase();
  if (score >= 70 || cat === "lead_hot" || cat === "customer") return "quente";
  if (score >= 40 || cat === "lead_warm" || cat === "returning") return "morno";
  return "frio";
}

export function mapLegacyPipelineStage(stage?: string | null, hasDeal?: boolean, hasChat?: boolean): string {
  const s = String(stage || "").trim().toLowerCase();
  if (s === "finalizado_com_venda" || hasDeal) return "finalizado";
  if (s === "finalizado_sem_venda" || s === "sem_resposta" || s === "outros") return "finalizado";
  if (s === "em_atendimento" || s === "pos_venda" || s === "maquinas" || s === "pecas") {
    return "qualificando";
  }
  return hasChat ? "qualificando" : "novo";
}

function safeJsonObject(value: unknown): Record<string, any> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function safeJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
}

function extractCompanyFromVisitor(v: Record<string, any>, bridge?: Record<string, any> | null): string | null {
  const cnpjData = safeJsonObject(v.posVendaCnpjData);
  const candidates = [
    bridge?.company_name,
    cnpjData?.razao_social,
    cnpjData?.razaoSocial,
    cnpjData?.nome_fantasia,
    cnpjData?.nomeFantasia,
    cnpjData?.estabelecimento?.nome_fantasia,
    safeJsonObject(v.vtexOrderData)?.companyName,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length >= 2 && !isGenericName(c)) {
      return c.trim().slice(0, 180);
    }
  }
  return null;
}

function extractProductInterest(v: Record<string, any>, chats: Array<Record<string, any>>): string | null {
  const briefing = safeJsonObject(v.aiBriefing);
  const chatProduct = chats.find((c) => typeof c.vtexProduct === "string" && c.vtexProduct.trim())?.vtexProduct;
  const candidates = [
    v.maquinaDesejada,
    v.pecaDesejada,
    chatProduct,
    briefing?.produtoInteresse,
    safeJsonObject(v.vtexOrderData)?.product,
    safeJsonObject(v.vtexOrderData)?.produto,
    v.posVendaProblema,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length >= 2) {
      return c.trim().slice(0, 240);
    }
  }
  return null;
}

function extractLegacyPhoneCandidates(
  v: Record<string, any>,
  bridge?: Record<string, any> | null,
): string[] {
  const found: string[] = [];
  const seenIdentity = new Set<string>();
  const vtex = safeJsonObject(v.vtexOrderData);
  const rawList: Array<unknown> = [
    v.posVendaTelefone,
    bridge?.phone,
    vtex?.phone,
    vtex?.telefone,
    vtex?.celular,
  ];

  for (const raw of rawList) {
    const normalized = normalizeLegacyPhone(raw);
    if (!normalized) continue;
    const identity = computeContactPhoneIdentity(normalized);
    if (identity && !seenIdentity.has(identity)) {
      seenIdentity.add(identity);
      found.push(normalized);
    }
  }
  return found;
}

function cleanRdDealId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 4) return null;
  return trimmed;
}

function buildLegacySnapshotForVisitor(
  v: Record<string, any>,
  resolvedVisitorId: string,
  bridge: Record<string, any> | null,
  chats: Array<Record<string, any>>,
): Record<string, any> {
  const vtexOrderData = safeJsonObject(v.vtexOrderData);
  const aiBriefing = safeJsonObject(v.aiBriefing);
  const cnpjData = safeJsonObject(v.posVendaCnpjData);
  const bigdata = safeJsonObject(v.bigdataRawData);
  const notes = safeJsonArray(v.notes);
  const bridgeFlowHistory = safeJsonArray(bridge?.flow_history);

  const snapshot: Record<string, any> = {
    sourceSystem: "fagner_site_legado",
    legacyVisitorId: v.id,
    resolvedVisitorId,
    cookieId: v.cookieId || null,
    firstSeenAt: v.firstSeenAt || null,
    lastSeenAt: v.lastSeenAt || null,
    pipelineStage: v.pipelineStage || null,
    category: v.category || null,
    engagementScore: Number(v.engagementScore ?? 0) || 0,
    purchaseIntentScore: Number(v.purchaseIntentScore ?? 0) || 0,
    totalVisits: Number(v.totalVisits ?? 1) || 1,
    totalPages: Number(v.totalPages ?? 0) || 0,
    totalChats: Number(v.totalChats ?? chats.length) || 0,
    totalTimeSeconds: Number(v.totalTimeSeconds ?? 0) || 0,
    source: v.source || null,
    utmSource: v.utmSource || null,
    utmMedium: v.utmMedium || null,
    utmCampaign: v.utmCampaign || null,
    city: v.city || null,
    country: v.country || null,
    browser: v.browser || null,
    deviceType: v.deviceType || null,
  };

  const qualification: Record<string, any> = {};
  if (v.maquinaDesejada) qualification.maquinaDesejada = v.maquinaDesejada;
  if (v.maquinaProdutoFabricado) qualification.maquinaProdutoFabricado = v.maquinaProdutoFabricado;
  if (v.maquinaVolumeProducao) qualification.maquinaVolumeProducao = v.maquinaVolumeProducao;
  if (v.maquinaQualificacaoSDR) qualification.maquinaQualificacaoSDR = v.maquinaQualificacaoSDR;
  if (v.maquinaClienteNovo) qualification.maquinaClienteNovo = v.maquinaClienteNovo;
  if (v.maquinaRating != null) qualification.maquinaRating = v.maquinaRating;
  if (v.pecaDesejada) qualification.pecaDesejada = v.pecaDesejada;
  if (v.pecasECliente) qualification.pecasECliente = v.pecasECliente;
  if (v.posVendaNotaPedido) qualification.posVendaNotaPedido = v.posVendaNotaPedido;
  if (v.posVendaProblema) qualification.posVendaProblema = v.posVendaProblema;
  if (Object.keys(qualification).length > 0) snapshot.qualification = qualification;

  if (v.rdCrmDealId) snapshot.rdCrmDealId = v.rdCrmDealId;
  if (aiBriefing) snapshot.aiBriefing = aiBriefing;
  if (v.vtexOrderFormId || v.vtexOrderId || v.vtexOrderStatus || vtexOrderData) {
    snapshot.vtex = {
      orderFormId: v.vtexOrderFormId || null,
      orderId: v.vtexOrderId || null,
      status: v.vtexOrderStatus || null,
      data: vtexOrderData,
    };
  }
  if (v.npsRating != null || v.npsComment || v.npsStage) {
    snapshot.nps = {
      rating: v.npsRating ?? null,
      comment: v.npsComment ?? null,
      stage: v.npsStage ?? null,
    };
  }
  if (notes.length > 0) snapshot.notes = notes;
  if (cnpjData) snapshot.cnpjRaw = cnpjData;
  if (bigdata) snapshot.bigdataRaw = bigdata;
  if (bridgeFlowHistory.length > 0) snapshot.bridgeFlowHistory = bridgeFlowHistory;

  return snapshot;
}

// ─── Leitura Defensiva de Tabelas Legadas ────────────────────────────────────

async function getTableColumns(db: SqlExecutor, tableName: string): Promise<Set<string>> {
  const res = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return new Set(res.rows.map((r) => r.column_name));
}

async function tableExists(db: SqlExecutor, tableName: string): Promise<boolean> {
  const res = await db.query<{ reg: string | null }>(`SELECT to_regclass($1) AS reg`, [
    `public.${tableName}`,
  ]);
  return Boolean(res.rows[0]?.reg);
}

function buildSafeSelectColumns(available: Set<string>, desired: string[]): string {
  return desired
    .map((col) => (available.has(col) ? `"${col}"` : `NULL AS "${col}"`))
    .join(", ");
}

// ─── Batch Helper ────────────────────────────────────────────────────────────

async function insertBatch(
  target: SqlExecutor,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictClause: string,
  batchSize: number,
): Promise<number> {
  if (rows.length === 0) return 0;
  let affected = 0;
  const safeBatch = Math.max(1, Math.min(batchSize, Math.floor(55000 / Math.max(1, columns.length))));

  for (let i = 0; i < rows.length; i += safeBatch) {
    const chunk = rows.slice(i, i + safeBatch);
    const params: unknown[] = [];
    const valueTuples: string[] = [];

    for (const row of chunk) {
      const placeholders: string[] = [];
      for (const val of row) {
        params.push(val);
        placeholders.push(`$${params.length}`);
      }
      valueTuples.push(`(${placeholders.join(", ")})`);
    }

    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${valueTuples.join(", ")} ${conflictClause} RETURNING id`;
    const res = await target.query<{ id: string }>(sql, params);
    affected += res.rows.length;
  }
  return affected;
}

// ─── Motor Principal de Migração ─────────────────────────────────────────────

interface CanonicalVisitorBundle {
  resolvedVisitorId: string;
  cookieId: string;
  existingTargetVisitor: Record<string, any> | null;
  legacyVisitors: Array<Record<string, any>>;
  primaryLegacy: Record<string, any>;
  bridgeRow: Record<string, any> | null;
  chats: Array<Record<string, any>>;
  messagesByChatId: Map<string, Array<Record<string, any>>>;
  allMessagesSorted: Array<{ chat: Record<string, any>; msg: Record<string, any>; sentAt: Date }>;
  sessionStart: Date;
  lastSeenAt: Date;
  name: string | null;
  company: string | null;
  email: string | null;
  phones: string[];
  primaryPhone: string | null;
  phoneIdentities: string[];
  cpf: string | null;
  cnpj: string | null;
  docDigits: string | null;
  rdDealIds: string[];
  productInterest: string | null;
  quantityInterest: string | null;
  intentScore: number;
  temperature: "quente" | "morno" | "frio";
  pipelineStage: string;
  currentUrl: string | null;
  currentTitle: string | null;
  referrer: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  firstSource: string | null;
  landingPage: string | null;
  cnpjData: Record<string, any> | null;
  snapshots: Array<Record<string, any>>;
  // Resultado do Match
  matchTier: MatchTier;
  resolvedContactId: string | null;
  matchedExistingContact: Record<string, any> | null;
  matchedAccountId: string | null;
  matchedWaConversationId: string | null;
}

export async function runLegacyFagnerSiteMigration(
  legacyDb: SqlExecutor,
  targetDb: SqlExecutor,
  options: LegacyMigrationOptions,
): Promise<MigrationReport> {
  const startedAt = new Date();
  const tenantId = (options.tenantId || "").trim();
  if (!tenantId) {
    throw new Error("tenantId é obrigatório para isolamento multi-tenant.");
  }
  const dryRun = options.dryRun !== false;
  const batchSize = Math.max(50, Math.min(1000, options.batchSize ?? 500));
  const includeConversations = options.includeConversations !== false;
  const progress = options.onProgress ?? (() => {});
  const warnings: string[] = [];

  // ── 0. Validar tenant destino ──────────────────────────────────────────────
  progress("init", `Validando tenant destino "${tenantId}" (modo: ${dryRun ? "DRY-RUN" : "APPLY"})`);
  const tenantCheck = await targetDb.query<{ id: string }>(`SELECT id FROM tenants WHERE id = $1 LIMIT 1`, [
    tenantId,
  ]);
  if (tenantCheck.rows.length === 0) {
    throw new Error(`Tenant "${tenantId}" não encontrado no banco destino.`);
  }

  // ── 1. Extração completa do legado (somente leitura) ───────────────────────
  progress("extract", "Lendo tabelas lc_* e uc_bridge do banco legado...");

  const visitorCols = await getTableColumns(legacyDb, "lc_visitors");
  const desiredVisitorCols = [
    "id",
    "cookieId",
    "ip",
    "city",
    "country",
    "browser",
    "deviceType",
    "userAgent",
    "currentPage",
    "currentPageTitle",
    "source",
    "utmSource",
    "utmMedium",
    "utmCampaign",
    "referrer",
    "totalVisits",
    "totalPages",
    "totalChats",
    "category",
    "engagementScore",
    "purchaseIntentScore",
    "totalTimeSeconds",
    "aiBriefing",
    "isOnline",
    "pipelineStage",
    "firstSeenAt",
    "lastSeenAt",
    "name",
    "notes",
    "posVendaNome",
    "posVendaTelefone",
    "posVendaEmail",
    "posVendaCnpjCpf",
    "posVendaNotaPedido",
    "posVendaProblema",
    "posVendaCnpjData",
    "pecaDesejada",
    "pecasECliente",
    "maquinaDesejada",
    "maquinaProdutoFabricado",
    "maquinaVolumeProducao",
    "maquinaQualificacaoSDR",
    "maquinaClienteNovo",
    "maquinaRating",
    "rdCrmDealId",
    "vtexOrderFormId",
    "vtexOrderId",
    "vtexOrderStatus",
    "vtexOrderData",
    "npsRating",
    "npsComment",
    "npsStage",
    "bigdataRawData",
  ];
  const legacyVisitorsRes = await legacyDb.query(
    `SELECT ${buildSafeSelectColumns(visitorCols, desiredVisitorCols)} FROM lc_visitors ORDER BY "firstSeenAt" ASC, "id" ASC`,
  );

  const pageviewCols = await getTableColumns(legacyDb, "lc_pageviews");
  const legacyPageviewsRes = (await tableExists(legacyDb, "lc_pageviews"))
    ? await legacyDb.query(
        `SELECT ${buildSafeSelectColumns(pageviewCols, ["id", "visitorId", "url", "pageTitle", "scrollDepth", "timeSpent", "intentTag", "visitedAt"])} FROM lc_pageviews ORDER BY "visitedAt" ASC`,
      )
    : { rows: [] };

  const hasClickTable = await tableExists(legacyDb, "lc_click_events");
  const clickCols = hasClickTable ? await getTableColumns(legacyDb, "lc_click_events") : new Set<string>();
  const legacyClicksRes = hasClickTable
    ? await legacyDb.query(
        `SELECT ${buildSafeSelectColumns(clickCols, ["id", "visitorId", "url", "elementId", "elementText", "clickType", "clickedAt"])} FROM lc_click_events ORDER BY "clickedAt" ASC`,
      )
    : { rows: [] };

  const chatCols = await getTableColumns(legacyDb, "lc_chats");
  const legacyChatsRes = (await tableExists(legacyDb, "lc_chats"))
    ? await legacyDb.query(
        `SELECT ${buildSafeSelectColumns(chatCols, [
          "id",
          "visitorId",
          "agentId",
          "status",
          "startedAt",
          "endedAt",
          "visitorName",
          "visitorEmail",
          "source",
          "aiHandled",
          "needsHuman",
          "proactiveApproach",
          "mood",
          "closeReason",
          "engagementScore",
          "vtexProduct",
          "noiseFiltered",
        ])} FROM lc_chats ORDER BY "startedAt" ASC`,
      )
    : { rows: [] };

  const msgCols = await getTableColumns(legacyDb, "lc_messages");
  const legacyMessagesRes = (await tableExists(legacyDb, "lc_messages"))
    ? await legacyDb.query(
        `SELECT ${buildSafeSelectColumns(msgCols, ["id", "chatId", "sender", "content", "read", "sentAt"])} FROM lc_messages ORDER BY "sentAt" ASC`,
      )
    : { rows: [] };

  let ucBridgeRows: Array<Record<string, any>> = [];
  if (await tableExists(legacyDb, "uc_bridge")) {
    const bCols = await getTableColumns(legacyDb, "uc_bridge");
    const bridgeRes = await legacyDb.query(
      `SELECT ${buildSafeSelectColumns(bCols, [
        "id",
        "phone",
        "email",
        "cnpj_cpf",
        "display_name",
        "company_name",
        "lc_cookie_id",
        "wa_contact_id",
        "rd_crm_deal_id",
        "site_profile",
        "collected_data",
        "flow_history",
        "channels_used",
      ])} FROM uc_bridge WHERE 'site' = ANY(channels_used) OR lc_cookie_id IS NOT NULL`,
    );
    ucBridgeRows = bridgeRes.rows;
  }

  const bridgeByCookie = new Map<string, Record<string, any>>();
  const bridgeByPhoneIdentity = new Map<string, Record<string, any>>();
  for (const row of ucBridgeRows) {
    if (typeof row.lc_cookie_id === "string" && row.lc_cookie_id.trim()) {
      bridgeByCookie.set(row.lc_cookie_id.trim(), row);
    }
    const norm = normalizeLegacyPhone(row.phone);
    if (norm) {
      const ident = computeContactPhoneIdentity(norm);
      if (ident) bridgeByPhoneIdentity.set(ident, row);
    }
  }

  // Indexar chats e mensagens por visitorId / chatId
  const chatsByLegacyVisitor = new Map<string, Array<Record<string, any>>>();
  const chatById = new Map<string, Record<string, any>>();
  for (const ch of legacyChatsRes.rows) {
    chatById.set(ch.id, ch);
    const list = chatsByLegacyVisitor.get(ch.visitorId) ?? [];
    list.push(ch);
    chatsByLegacyVisitor.set(ch.visitorId, list);
  }

  const messagesByChatId = new Map<string, Array<Record<string, any>>>();
  for (const m of legacyMessagesRes.rows) {
    const list = messagesByChatId.get(m.chatId) ?? [];
    list.push(m);
    messagesByChatId.set(m.chatId, list);
  }

  // ── 2. Carregar índices do banco destino (tenantId isolado) ────────────────
  progress("target_index", "Carregando índices de visitantes, contatos, contas CRM e WhatsApp do destino...");

  const [
    targetVisitorsRes,
    targetContactsRes,
    targetContactPhonesRes,
    targetAccountsRes,
    targetDealsRes,
    targetDealContactsRes,
    targetWaConvsRes,
    targetSiteConvsRes,
  ] = await Promise.all([
    targetDb.query(
      `SELECT id, cookie_id, session_start, last_seen_at, name, company, cnpj, phone, email,
              product_interest, quantity_interest, intent_score, pipeline_stage, temperature,
              current_url, current_title, referrer, user_agent, ip_address
       FROM lc_visitors WHERE tenant_id = $1`,
      [tenantId],
    ),
    targetDb.query(
      `SELECT id, account_id, name, phone, email, cnpj, cpf, main_channel, wallet_operator_id,
              responsible_name, rd_crm_deal_id, cnpj_details, custom_fields,
              first_source, first_campaign, utm_source, utm_medium, utm_campaign, landing_page,
              is_legacy, created_at
       FROM contacts WHERE tenant_id = $1`,
      [tenantId],
    ),
    targetDb.query(
      `SELECT id, contact_id, phone, phone_identity, is_primary
       FROM contact_phones WHERE tenant_id = $1`,
      [tenantId],
    ),
    targetDb.query(
      `SELECT id, document, name, trade_name FROM crm_accounts WHERE tenant_id = $1`,
      [tenantId],
    ),
    targetDb.query(
      `SELECT id, rd_deal_id, account_id FROM crm_deals WHERE tenant_id = $1 AND rd_deal_id IS NOT NULL AND rd_deal_id <> ''`,
      [tenantId],
    ),
    targetDb.query(
      `SELECT deal_id, contact_id, is_primary FROM crm_deal_contacts WHERE tenant_id = $1`,
      [tenantId],
    ),
    targetDb.query(
      `SELECT id, contact_id, last_message_time FROM conversations
       WHERE tenant_id = $1 AND whatsapp_connection_id IS NULL AND id NOT LIKE 'conv-lc-%'
       ORDER BY last_message_time DESC`,
      [tenantId],
    ),
    targetDb.query(
      `SELECT id, contact_id, queue_state FROM conversations
       WHERE tenant_id = $1 AND id LIKE 'conv-lc-%'`,
      [tenantId],
    ),
  ]);

  // Mapas de lookup O(1) do destino
  const targetVisitorByCookie = new Map<string, Record<string, any>>();
  const targetVisitorById = new Map<string, Record<string, any>>();
  for (const tv of targetVisitorsRes.rows) {
    targetVisitorById.set(tv.id, tv);
    if (tv.cookie_id && !targetVisitorByCookie.has(tv.cookie_id)) {
      targetVisitorByCookie.set(tv.cookie_id, tv);
    }
  }

  const targetContactById = new Map<string, Record<string, any>>();
  const targetContactByPhoneIdentity = new Map<string, Record<string, any>>();
  const targetContactsByDoc = new Map<string, Array<Record<string, any>>>();
  const targetContactsByEmail = new Map<string, Array<Record<string, any>>>();
  const targetContactByRdDeal = new Map<string, Record<string, any>>();
  const targetContactsByAccount = new Map<string, Array<Record<string, any>>>();

  // Prioriza contatos WhatsApp / não-legados no índice quando houver mais de um
  const sortedTargetContacts = [...targetContactsRes.rows].sort((a, b) => {
    const score = (c: Record<string, any>) =>
      (c.main_channel === "whatsapp" ? 4 : 0) +
      (c.wallet_operator_id ? 2 : 0) +
      (!c.is_legacy ? 1 : 0);
    return score(b) - score(a);
  });

  for (const c of sortedTargetContacts) {
    targetContactById.set(c.id, c);
    if (c.phone) {
      const ident = computeContactPhoneIdentity(c.phone);
      if (ident && !targetContactByPhoneIdentity.has(ident)) {
        targetContactByPhoneIdentity.set(ident, c);
      }
    }
    for (const docField of [c.cnpj, c.cpf]) {
      if (typeof docField === "string") {
        const digits = docField.replace(/\D/g, "");
        if (digits.length === 11 || digits.length === 14) {
          const list = targetContactsByDoc.get(digits) ?? [];
          if (!list.some((x) => x.id === c.id)) list.push(c);
          targetContactsByDoc.set(digits, list);
        }
      }
    }
    const normEmail = normalizeLegacyEmail(c.email);
    if (normEmail) {
      const list = targetContactsByEmail.get(normEmail) ?? [];
      if (!list.some((x) => x.id === c.id)) list.push(c);
      targetContactsByEmail.set(normEmail, list);
    }
    const rdId = cleanRdDealId(c.rd_crm_deal_id);
    if (rdId && !targetContactByRdDeal.has(rdId)) {
      targetContactByRdDeal.set(rdId, c);
    }
    if (c.account_id) {
      const list = targetContactsByAccount.get(c.account_id) ?? [];
      list.push(c);
      targetContactsByAccount.set(c.account_id, list);
    }
  }

  for (const cp of targetContactPhonesRes.rows) {
    const contact = targetContactById.get(cp.contact_id);
    if (!contact) continue;
    const ident = cp.phone_identity || computeContactPhoneIdentity(cp.phone);
    if (ident && !targetContactByPhoneIdentity.has(ident)) {
      targetContactByPhoneIdentity.set(ident, contact);
    }
  }

  const targetAccountByDoc = new Map<string, Record<string, any>>();
  for (const acc of targetAccountsRes.rows) {
    if (typeof acc.document === "string") {
      const digits = acc.document.replace(/\D/g, "");
      if (digits.length === 11 || digits.length === 14) {
        targetAccountByDoc.set(digits, acc);
      }
    }
  }

  const dealContactsByDealId = new Map<string, Array<{ contact_id: string; is_primary: boolean }>>();
  for (const dc of targetDealContactsRes.rows) {
    const list = dealContactsByDealId.get(dc.deal_id) ?? [];
    list.push({ contact_id: dc.contact_id, is_primary: Boolean(dc.is_primary) });
    dealContactsByDealId.set(dc.deal_id, list);
  }

  const targetRdDealToContact = new Map<string, { contact: Record<string, any>; accountId: string | null }>();
  for (const deal of targetDealsRes.rows) {
    const rdId = cleanRdDealId(deal.rd_deal_id);
    if (!rdId) continue;
    const linked = (dealContactsByDealId.get(deal.id) ?? []).sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary),
    );
    for (const dc of linked) {
      const contact = targetContactById.get(dc.contact_id);
      if (contact) {
        targetRdDealToContact.set(rdId, { contact, accountId: deal.account_id || null });
        break;
      }
    }
  }

  const waConvIdByContactId = new Map<string, string>();
  for (const conv of targetWaConvsRes.rows) {
    if (!waConvIdByContactId.has(conv.contact_id)) {
      waConvIdByContactId.set(conv.contact_id, conv.id);
    }
  }

  const existingSiteConvIds = new Set<string>(targetSiteConvsRes.rows.map((r) => r.id));

  // ── 3. Agrupamento e deduplicação por `cookieId` ───────────────────────────
  progress("dedup", "Agrupando visitantes legados por cookieId e reconciliando com v2 ativo...");

  const legacyGroupsByCookie = new Map<string, Array<Record<string, any>>>();
  for (const v of legacyVisitorsRes.rows) {
    const cookieKey =
      typeof v.cookieId === "string" && v.cookieId.trim()
        ? v.cookieId.trim()
        : `legacy-nocookie-${v.id}`;
    const list = legacyGroupsByCookie.get(cookieKey) ?? [];
    list.push(v);
    legacyGroupsByCookie.set(cookieKey, list);
  }

  const legacyVisitorIdToResolved = new Map<string, string>();
  const bundles: CanonicalVisitorBundle[] = [];
  let mergedIntoExistingActiveV2Cookie = 0;
  let mergedDuplicateLegacyCookies = 0;

  for (const [cookieId, group] of legacyGroupsByCookie.entries()) {
    // Ordena do mais antigo para o mais recente
    const sortedGroup = [...group].sort((a, b) => {
      const da = parseLegacyTimestamp(a.firstSeenAt).getTime();
      const db = parseLegacyTimestamp(b.firstSeenAt).getTime();
      return da - db;
    });
    if (sortedGroup.length > 1) {
      mergedDuplicateLegacyCookies += sortedGroup.length - 1;
    }

    const existingTargetVisitor = targetVisitorByCookie.get(cookieId) ?? null;
    if (existingTargetVisitor) {
      mergedIntoExistingActiveV2Cookie++;
    }

    // Escolhe ID canônico: se já existe no destino (v2 ativo), usa o ID ativo;
    // senão, usa o ID sanitizado do primeiro visitante legado (garantindo que não colida com outro cookie)
    let resolvedVisitorId = existingTargetVisitor
      ? existingTargetVisitor.id
      : sanitizeVisitorId(sortedGroup[0].id);

    if (!existingTargetVisitor && targetVisitorById.has(resolvedVisitorId)) {
      const existingSameId = targetVisitorById.get(resolvedVisitorId)!;
      if (existingSameId.cookie_id !== cookieId) {
        resolvedVisitorId = deterministicLegacyId("legv", `${cookieId}:${sortedGroup[0].id}`);
      }
    }

    for (const v of sortedGroup) {
      legacyVisitorIdToResolved.set(v.id, resolvedVisitorId);
    }

    // Coleta chats e mensagens de todos os visitantes desse cookie
    const allChats: Array<Record<string, any>> = [];
    const bundleMessagesByChat = new Map<string, Array<Record<string, any>>>();
    const allMessagesSorted: Array<{ chat: Record<string, any>; msg: Record<string, any>; sentAt: Date }> = [];

    for (const v of sortedGroup) {
      const vChats = chatsByLegacyVisitor.get(v.id) ?? [];
      for (const ch of vChats) {
        allChats.push(ch);
        const msgs = messagesByChatId.get(ch.id) ?? [];
        bundleMessagesByChat.set(ch.id, msgs);
        for (const msg of msgs) {
          allMessagesSorted.push({
            chat: ch,
            msg,
            sentAt: parseLegacyTimestamp(msg.sentAt, parseLegacyTimestamp(ch.startedAt)),
          });
        }
      }
    }
    allMessagesSorted.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

    // Encontra bridge row (por cookie ou por telefone)
    let bridgeRow: Record<string, any> | null = bridgeByCookie.get(cookieId) ?? null;

    // Consolida dados cadastrais e comportamentais do grupo
    const primaryLegacy = sortedGroup[sortedGroup.length - 1]; // mais recente para estado atual
    let sessionStart = parseLegacyTimestamp(sortedGroup[0].firstSeenAt);
    let lastSeenAt = parseLegacyTimestamp(primaryLegacy.lastSeenAt, sessionStart);

    const phones: string[] = [];
    const phoneIdentities: string[] = [];
    const seenPhoneIdent = new Set<string>();
    const rdDealIds: string[] = [];
    const seenRd = new Set<string>();

    let bestName: string | null = null;
    let bestEmail: string | null = null;
    let bestCompany: string | null = null;
    let bestCpf: string | null = null;
    let bestCnpj: string | null = null;
    let bestCnpjData: Record<string, any> | null = null;
    let bestProduct: string | null = null;
    let bestQuantity: string | null = null;
    let bestScore = 0;
    let bestCategory: string | null = null;
    let bestStage: string | null = null;
    let utmSource: string | null = null;
    let utmMedium: string | null = null;
    let utmCampaign: string | null = null;
    let firstSource: string | null = null;
    let landingPage: string | null = null;

    for (const v of sortedGroup) {
      const fs = parseLegacyTimestamp(v.firstSeenAt, sessionStart);
      const ls = parseLegacyTimestamp(v.lastSeenAt, fs);
      if (fs < sessionStart) sessionStart = fs;
      if (ls > lastSeenAt) lastSeenAt = ls;

      for (const ph of extractLegacyPhoneCandidates(v, bridgeRow)) {
        const ident = computeContactPhoneIdentity(ph);
        if (ident && !seenPhoneIdent.has(ident)) {
          seenPhoneIdent.add(ident);
          phones.push(ph);
          phoneIdentities.push(ident);
          if (!bridgeRow && bridgeByPhoneIdentity.has(ident)) {
            bridgeRow = bridgeByPhoneIdentity.get(ident)!;
          }
        }
      }

      const nameCand = [v.posVendaNome, v.name, bridgeRow?.display_name].find(
        (n) => typeof n === "string" && !isGenericName(n),
      );
      if (nameCand) bestName = String(nameCand).trim().slice(0, 140);

      const emailCand = normalizeLegacyEmail(v.posVendaEmail) || normalizeLegacyEmail(bridgeRow?.email);
      if (emailCand) bestEmail = emailCand;

      const doc = extractValidDocument(
        v.posVendaCnpjCpf,
        safeJsonObject(v.posVendaCnpjData)?.cnpj,
        safeJsonObject(v.posVendaCnpjData)?.estabelecimento?.cnpj,
        safeJsonObject(v.vtexOrderData)?.document,
        safeJsonObject(v.vtexOrderData)?.cnpj,
        safeJsonObject(v.vtexOrderData)?.cpf,
        bridgeRow?.cnpj_cpf,
      );
      if (doc.cnpj) bestCnpj = doc.cnpj;
      if (doc.cpf && !bestCpf) bestCpf = doc.cpf;

      const cnpjObj = safeJsonObject(v.posVendaCnpjData);
      if (cnpjObj) bestCnpjData = cnpjObj;

      const comp = extractCompanyFromVisitor(v, bridgeRow);
      if (comp) bestCompany = comp;

      const prod = extractProductInterest(v, chatsByLegacyVisitor.get(v.id) ?? []);
      if (prod) bestProduct = prod;

      if (typeof v.maquinaVolumeProducao === "string" && v.maquinaVolumeProducao.trim()) {
        bestQuantity = v.maquinaVolumeProducao.trim().slice(0, 120);
      }

      const score = Math.max(
        Number(v.purchaseIntentScore ?? 0) || 0,
        Number(v.engagementScore ?? 0) || 0,
      );
      if (score > bestScore) bestScore = Math.min(100, score);
      if (v.category) bestCategory = v.category;
      if (v.pipelineStage) bestStage = v.pipelineStage;

      const rd = cleanRdDealId(v.rdCrmDealId) || cleanRdDealId(bridgeRow?.rd_crm_deal_id);
      if (rd && !seenRd.has(rd)) {
        seenRd.add(rd);
        rdDealIds.push(rd);
      }

      if (!utmSource && v.utmSource) utmSource = String(v.utmSource).trim();
      if (!utmMedium && v.utmMedium) utmMedium = String(v.utmMedium).trim();
      if (!utmCampaign && v.utmCampaign) utmCampaign = String(v.utmCampaign).trim();
      if (!firstSource && v.source) firstSource = String(v.source).trim();
      if (!landingPage && v.currentPage) landingPage = String(v.currentPage).trim();
    }

    // Fallback de nome e e-mail nos `lc_chats`
    for (const ch of allChats) {
      if (!bestName && typeof ch.visitorName === "string" && !isGenericName(ch.visitorName)) {
        bestName = ch.visitorName.trim().slice(0, 140);
      }
      if (!bestEmail) {
        const chEmail = normalizeLegacyEmail(ch.visitorEmail);
        if (chEmail) bestEmail = chEmail;
      }
    }

    const snapshots = sortedGroup.map((v) =>
      buildLegacySnapshotForVisitor(v, resolvedVisitorId, bridgeRow, chatsByLegacyVisitor.get(v.id) ?? []),
    );

    bundles.push({
      resolvedVisitorId,
      cookieId,
      existingTargetVisitor,
      legacyVisitors: sortedGroup,
      primaryLegacy,
      bridgeRow,
      chats: allChats,
      messagesByChatId: bundleMessagesByChat,
      allMessagesSorted,
      sessionStart,
      lastSeenAt,
      name: bestName,
      company: bestCompany,
      email: bestEmail,
      phones,
      primaryPhone: phones[0] ?? null,
      phoneIdentities,
      cpf: bestCpf,
      cnpj: bestCnpj,
      docDigits: bestCnpj || bestCpf || null,
      rdDealIds,
      productInterest: bestProduct,
      quantityInterest: bestQuantity,
      intentScore: bestScore,
      temperature: computeLegacyTemperature(bestScore, bestCategory),
      pipelineStage: mapLegacyPipelineStage(bestStage, rdDealIds.length > 0, allChats.length > 0),
      currentUrl: primaryLegacy.currentPage || null,
      currentTitle: primaryLegacy.currentPageTitle || null,
      referrer: sortedGroup.find((v) => v.referrer)?.referrer || null,
      userAgent: primaryLegacy.userAgent || sortedGroup.find((v) => v.userAgent)?.userAgent || null,
      ipAddress: primaryLegacy.ip || sortedGroup.find((v) => v.ip)?.ip || null,
      utmSource,
      utmMedium,
      utmCampaign,
      firstSource,
      landingPage,
      cnpjData: bestCnpjData,
      snapshots,
      matchTier: "anonymous_only",
      resolvedContactId: null,
      matchedExistingContact: null,
      matchedAccountId: null,
      matchedWaConversationId: null,
    });
  }

  // ── 4. Motor de Match em 4 Camadas + Deduplicação Intra-Legado ─────────────
  progress("match", `Executando motor de match em 4 camadas para ${bundles.length} visitantes canônicos...`);

  const ambiguousMatches: AmbiguousMatchItem[] = [];
  const newContactByPhoneIdentity = new Map<string, string>();
  const newContactByDoc = new Map<string, string>();
  const newContactSpecs = new Map<
    string,
    {
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
      cpf: string | null;
      cnpj: string | null;
      accountId: string | null;
      rdCrmDealId: string | null;
      cnpjDetails: Record<string, any>;
      firstSource: string | null;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      landingPage: string | null;
      createdAt: Date;
      phonesToInsert: Set<string>;
      bundles: CanonicalVisitorBundle[];
    }
  >();

  const existingContactEnrichments = new Map<
    string,
    {
      contact: Record<string, any>;
      bundles: CanonicalVisitorBundle[];
      accountIdCandidate: string | null;
    }
  >();

  let matchedByPhone = 0;
  let matchedByDocument = 0;
  let matchedByRdDeal = 0;
  let matchedByEmail = 0;
  let newIdentifiedContacts = 0;
  let newAnonymousChatContacts = 0;
  let anonymousVisitorsWithoutContact = 0;
  let linkedToWhatsAppConversation = 0;

  for (const b of bundles) {
    let matchedContact: Record<string, any> | null = null;
    let matchedAccountId: string | null = null;
    let tier: MatchTier | null = null;

    // Resolve conta CRM por documento (independente de achar contato)
    if (b.docDigits && targetAccountByDoc.has(b.docDigits)) {
      matchedAccountId = targetAccountByDoc.get(b.docDigits)!.id;
    }

    // Tier 1: Telefone canônico (contact_phones + contacts)
    for (const ident of b.phoneIdentities) {
      const hit = targetContactByPhoneIdentity.get(ident);
      if (hit) {
        matchedContact = hit;
        tier = "phone";
        break;
      }
    }

    // Tier 2: Documento validado (CPF/CNPJ → contacts ou crm_accounts com 1 contato)
    if (!matchedContact && b.docDigits) {
      const docHits = targetContactsByDoc.get(b.docDigits) ?? [];
      if (docHits.length === 1) {
        matchedContact = docHits[0];
        tier = "document";
      } else if (docHits.length > 1) {
        // Se há vários contatos com mesmo CNPJ, desempata por e-mail se bater
        const byEmail = b.email
          ? docHits.find((c) => normalizeLegacyEmail(c.email) === b.email)
          : null;
        if (byEmail) {
          matchedContact = byEmail;
          tier = "document";
        } else {
          ambiguousMatches.push({
            legacyVisitorId: b.primaryLegacy.id,
            cookieId: b.cookieId,
            reason: "multiple_contacts_same_document",
            candidateValue: b.docDigits,
            candidateContactIds: docHits.map((c) => c.id),
          });
        }
      } else if (matchedAccountId) {
        const accContacts = targetContactsByAccount.get(matchedAccountId) ?? [];
        if (accContacts.length === 1) {
          matchedContact = accContacts[0];
          tier = "document";
        }
      }
    }

    // Tier 3: RD CRM Deal ID
    if (!matchedContact && b.rdDealIds.length > 0) {
      for (const rdId of b.rdDealIds) {
        const byDeal = targetRdDealToContact.get(rdId);
        if (byDeal) {
          matchedContact = byDeal.contact;
          if (!matchedAccountId && byDeal.accountId) matchedAccountId = byDeal.accountId;
          tier = "rd_deal";
          break;
        }
        const byContactRd = targetContactByRdDeal.get(rdId);
        if (byContactRd) {
          matchedContact = byContactRd;
          tier = "rd_deal";
          break;
        }
      }
    }

    // Tier 4: E-mail normalizado (somente se único e inequívoco)
    if (!matchedContact && b.email) {
      const emailHits = targetContactsByEmail.get(b.email) ?? [];
      if (emailHits.length === 1) {
        matchedContact = emailHits[0];
        tier = "email";
      } else if (emailHits.length > 1) {
        ambiguousMatches.push({
          legacyVisitorId: b.primaryLegacy.id,
          cookieId: b.cookieId,
          reason: "multiple_contacts_same_email",
          candidateValue: b.email,
          candidateContactIds: emailHits.map((c) => c.id),
        });
      }
    }

    // Caso 1: Match em contato já existente no Valem Chat!
    if (matchedContact && tier) {
      b.matchTier = tier;
      b.matchedExistingContact = matchedContact;
      b.resolvedContactId = matchedContact.id;
      b.matchedAccountId = matchedContact.account_id || matchedAccountId;
      b.matchedWaConversationId = waConvIdByContactId.get(matchedContact.id) ?? null;

      if (tier === "phone") matchedByPhone++;
      else if (tier === "document") matchedByDocument++;
      else if (tier === "rd_deal") matchedByRdDeal++;
      else if (tier === "email") matchedByEmail++;
      if (b.matchedWaConversationId) linkedToWhatsAppConversation++;

      const entry = existingContactEnrichments.get(matchedContact.id) ?? {
        contact: matchedContact,
        bundles: [],
        accountIdCandidate: matchedAccountId,
      };
      entry.bundles.push(b);
      if (!entry.accountIdCandidate && matchedAccountId) entry.accountIdCandidate = matchedAccountId;
      existingContactEnrichments.set(matchedContact.id, entry);
      continue;
    }

    // Caso 2: Não deu match no destino, mas o visitante tem dados de identificação OU teve chat real
    const isIdentified = Boolean(b.primaryPhone || b.docDigits || b.email);
    const hasMessages = b.allMessagesSorted.length > 0;

    if (!isIdentified && !hasMessages) {
      b.matchTier = "anonymous_only";
      anonymousVisitorsWithoutContact++;
      continue;
    }

    // Verifica se já planejamos criar um novo contato para esse mesmo telefone ou documento dentro deste lote legado
    let plannedContactId: string | null = null;
    for (const ident of b.phoneIdentities) {
      if (newContactByPhoneIdentity.has(ident)) {
        plannedContactId = newContactByPhoneIdentity.get(ident)!;
        break;
      }
    }
    if (!plannedContactId && b.docDigits && newContactByDoc.has(b.docDigits)) {
      plannedContactId = newContactByDoc.get(b.docDigits)!;
    }

    // Se já existe `cont-lc-<resolvedVisitorId>` no banco destino (ex.: re-execução ou v2 ativo)
    const defaultSiteContactId = `cont-lc-${b.resolvedVisitorId}`;
    if (!plannedContactId && targetContactById.has(defaultSiteContactId)) {
      const existingSiteContact = targetContactById.get(defaultSiteContactId)!;
      b.matchTier = isIdentified ? "new_identified" : "new_chat_anonymous";
      b.matchedExistingContact = existingSiteContact;
      b.resolvedContactId = existingSiteContact.id;
      b.matchedAccountId = existingSiteContact.account_id || matchedAccountId;
      b.matchedWaConversationId = waConvIdByContactId.get(existingSiteContact.id) ?? null;

      const entry = existingContactEnrichments.get(existingSiteContact.id) ?? {
        contact: existingSiteContact,
        bundles: [],
        accountIdCandidate: matchedAccountId,
      };
      entry.bundles.push(b);
      existingContactEnrichments.set(existingSiteContact.id, entry);
      continue;
    }

    if (plannedContactId) {
      const spec = newContactSpecs.get(plannedContactId)!;
      spec.bundles.push(b);
      if (isGenericName(spec.name, spec.phone) && b.name) spec.name = b.name;
      if (!spec.email && b.email) spec.email = b.email;
      if (!spec.cpf && b.cpf) spec.cpf = b.cpf;
      if (!spec.cnpj && b.cnpj) spec.cnpj = b.cnpj;
      if (!spec.accountId && matchedAccountId) spec.accountId = matchedAccountId;
      if (!spec.rdCrmDealId && b.rdDealIds[0]) spec.rdCrmDealId = b.rdDealIds[0];
      for (const ph of b.phones) spec.phonesToInsert.add(ph);
      if (b.sessionStart < spec.createdAt) spec.createdAt = b.sessionStart;
      b.resolvedContactId = plannedContactId;
      b.matchTier = isIdentified ? "new_identified" : "new_chat_anonymous";
    } else {
      const newId = defaultSiteContactId;
      b.resolvedContactId = newId;
      b.matchTier = isIdentified ? "new_identified" : "new_chat_anonymous";
      if (isIdentified) newIdentifiedContacts++;
      else newAnonymousChatContacts++;

      for (const ident of b.phoneIdentities) newContactByPhoneIdentity.set(ident, newId);
      if (b.docDigits) newContactByDoc.set(b.docDigits, newId);

      newContactSpecs.set(newId, {
        id: newId,
        name: b.name || "Visitante do site",
        phone: b.primaryPhone,
        email: b.email,
        cpf: b.cpf,
        cnpj: b.cnpj,
        accountId: matchedAccountId,
        rdCrmDealId: b.rdDealIds[0] ?? null,
        cnpjDetails: b.cnpjData || {},
        firstSource: b.firstSource,
        utmSource: b.utmSource,
        utmMedium: b.utmMedium,
        utmCampaign: b.utmCampaign,
        landingPage: b.landingPage,
        createdAt: b.sessionStart,
        phonesToInsert: new Set(b.phones),
        bundles: [b],
      });
    }
  }

  // ── 5. Preparar payloads de escrita ────────────────────────────────────────
  progress("plan", "Montando lotes idempotentes de lc_*, contacts, conversations e messages...");

  const lcVisitorInsertRows: unknown[][] = [];
  const lcVisitorMergeUpdates: Array<{ id: string; bundle: CanonicalVisitorBundle }> = [];
  const lcChatInsertRows: unknown[][] = [];
  const lcMessageInsertRows: unknown[][] = [];
  const conversationInsertRows: unknown[][] = [];
  const coreMessageInsertRows: unknown[][] = [];

  for (const b of bundles) {
    // Alinha lc_visitors.phone ao contacts.phone do contato casado para match exato em getVisitorJourneyDetail
    const effectivePhone = b.matchedExistingContact?.phone || b.primaryPhone || null;

    if (b.existingTargetVisitor) {
      lcVisitorMergeUpdates.push({ id: b.resolvedVisitorId, bundle: b });
    } else {
      lcVisitorInsertRows.push([
        b.resolvedVisitorId,
        tenantId,
        b.cookieId,
        b.sessionStart,
        b.lastSeenAt,
        b.name,
        b.company,
        b.cnpj || b.cpf,
        effectivePhone,
        b.email,
        b.productInterest,
        b.quantityInterest,
        b.intentScore,
        b.pipelineStage,
        b.temperature,
        b.currentUrl,
        b.currentTitle,
        b.referrer,
        b.userAgent,
        b.ipAddress,
      ]);
    }

    // Chats do site (sempre encerrados `status = 'closed'`)
    for (const ch of b.chats) {
      const startedAt = parseLegacyTimestamp(ch.startedAt, b.sessionStart);
      const chatMsgs = b.messagesByChatId.get(ch.id) ?? [];
      const lastMsgDate =
        chatMsgs.length > 0
          ? parseLegacyTimestamp(chatMsgs[chatMsgs.length - 1].sentAt, startedAt)
          : startedAt;
      const closedAt = ch.endedAt ? parseLegacyTimestamp(ch.endedAt, lastMsgDate) : lastMsgDate;
      const outcome = b.matchedWaConversationId
        ? "bridge_whatsapp"
        : ch.closeReason
          ? String(ch.closeReason).slice(0, 80)
          : "resolved";

      lcChatInsertRows.push([
        ch.id,
        tenantId,
        b.resolvedVisitorId,
        "livechat",
        "closed",
        null, // operator_id legado não corresponde aos IDs do Valem Chat
        startedAt,
        closedAt,
        outcome,
        b.matchedWaConversationId,
      ]);

      for (const m of chatMsgs) {
        const sender = normalizeLegacyLcSender(m.sender);
        const sentAt = parseLegacyTimestamp(m.sentAt, startedAt);
        lcMessageInsertRows.push([
          m.id,
          tenantId,
          ch.id,
          sender,
          typeof m.content === "string" ? m.content : "",
          "text",
          null,
          null,
          null,
          null,
          sentAt,
        ]);
      }
    }

    // Conversa unificada `conv-lc-<visitorId>` (somente se houve mensagem real de chat)
    if (includeConversations && b.allMessagesSorted.length > 0 && b.resolvedContactId) {
      const convId = `conv-lc-${b.resolvedVisitorId}`;
      const firstMsg = b.allMessagesSorted[0];
      const lastMsg = b.allMessagesSorted[b.allMessagesSorted.length - 1];

      if (!existingSiteConvIds.has(convId)) {
        conversationInsertRows.push([
          convId,
          tenantId,
          b.resolvedContactId,
          null, // contact_phone_id
          effectivePhone,
          null, // whatsapp_connection_id
          null, // operator_id
          null, // sector_id
          "finalizados", // SEMPRE finalizado — nunca cai em fila/automação/meus!
          0, // unread_count
          1, // version
          lastMsg.sentAt,
          String(lastMsg.msg.content || "").slice(0, 500),
          lastMsg.sentAt,
          firstMsg.sentAt,
        ]);
      }

      for (const item of b.allMessagesSorted) {
        const lcSender = normalizeLegacyLcSender(item.msg.sender);
        const mapped = mapLegacySenderToCoreMessage(lcSender, b.name);
        const coreMsgId = deterministicLegacyId("leg-lcm", `${tenantId}:${item.msg.id}`);
        const metaDetails = {
          legacyFagnerSite: {
            chatId: item.chat.id,
            visitorId: b.resolvedVisitorId,
            vtexProduct: item.chat.vtexProduct || null,
          },
        };
        coreMessageInsertRows.push([
          coreMsgId,
          tenantId,
          convId,
          mapped.senderType,
          mapped.senderName,
          typeof item.msg.content === "string" ? item.msg.content : "",
          false, // is_internal_note
          item.msg.id, // external_id
          "livechat", // provider
          mapped.direction,
          "delivered",
          JSON.stringify(metaDetails),
          item.sentAt,
          item.sentAt,
        ]);
      }
    }
  }

  // Pageviews & Click Events (mapeando visitorId legado -> resolvedVisitorId)
  const lcPageviewInsertRows: unknown[][] = [];
  for (const pv of legacyPageviewsRes.rows) {
    const resolvedVid = legacyVisitorIdToResolved.get(pv.visitorId);
    if (!resolvedVid) continue;
    lcPageviewInsertRows.push([
      pv.id,
      tenantId,
      resolvedVid,
      pv.url || "/",
      pv.pageTitle || null,
      Math.max(0, Math.min(86400, Number(pv.timeSpent ?? 0) || 0)),
      Math.max(0, Math.min(100, Number(pv.scrollDepth ?? 0) || 0)),
      parseLegacyTimestamp(pv.visitedAt),
    ]);
  }

  const lcClickInsertRows: unknown[][] = [];
  for (const ck of legacyClicksRes.rows) {
    const resolvedVid = legacyVisitorIdToResolved.get(ck.visitorId);
    if (!resolvedVid) continue;
    const eventType = normalizeLegacyClickType(ck.clickType);
    const eventData = {
      url: ck.url || null,
      elementId: ck.elementId || null,
      elementText: ck.elementText || null,
      clickType: ck.clickType || eventType,
    };
    lcClickInsertRows.push([
      `leg-clk-${ck.id}`,
      tenantId,
      resolvedVid,
      eventType,
      JSON.stringify(eventData),
      parseLegacyTimestamp(ck.clickedAt),
    ]);
  }

  // ── 6. Execução (se --apply) ou Simulação Completa (se --dry-run) ──────────
  const stats = {
    lcVisitorsInserted: 0,
    lcVisitorsMerged: 0,
    lcPageviewsInserted: 0,
    lcClickEventsInserted: 0,
    lcChatsInserted: 0,
    lcMessagesInserted: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    contactPhonesInserted: 0,
    conversationsInserted: 0,
    messagesInserted: 0,
    agentFlowStatesInserted: 0 as const,
  };

  if (dryRun) {
    stats.lcVisitorsInserted = lcVisitorInsertRows.length;
    stats.lcVisitorsMerged = lcVisitorMergeUpdates.length;
    stats.lcPageviewsInserted = lcPageviewInsertRows.length;
    stats.lcClickEventsInserted = lcClickInsertRows.length;
    stats.lcChatsInserted = lcChatInsertRows.length;
    stats.lcMessagesInserted = lcMessageInsertRows.length;
    stats.contactsCreated = newContactSpecs.size;
    stats.contactsUpdated = existingContactEnrichments.size;
    stats.contactPhonesInserted = Array.from(newContactSpecs.values()).reduce(
      (acc, s) => acc + s.phonesToInsert.size,
      0,
    );
    stats.conversationsInserted = conversationInsertRows.length;
    stats.messagesInserted = coreMessageInsertRows.length;
  } else {
    // 6.1 Inserir novos `lc_visitors`
    progress("write_lc_visitors", `Inserindo ${lcVisitorInsertRows.length} visitantes em lc_visitors...`);
    stats.lcVisitorsInserted = await insertBatch(
      targetDb,
      "lc_visitors",
      [
        "id",
        "tenant_id",
        "cookie_id",
        "session_start",
        "last_seen_at",
        "name",
        "company",
        "cnpj",
        "phone",
        "email",
        "product_interest",
        "quantity_interest",
        "intent_score",
        "pipeline_stage",
        "temperature",
        "current_url",
        "current_title",
        "referrer",
        "user_agent",
        "ip_address",
      ],
      lcVisitorInsertRows,
      "ON CONFLICT (id) DO NOTHING",
      batchSize,
    );

    // 6.2 Merge não-destrutivo de cookies que já voltaram no v2
    for (const item of lcVisitorMergeUpdates) {
      const b = item.bundle;
      const effectivePhone = b.matchedExistingContact?.phone || b.primaryPhone || null;
      await targetDb.query(
        `UPDATE lc_visitors
         SET session_start = LEAST(session_start, $3::timestamp),
             name = COALESCE(NULLIF(TRIM(name), ''), $4),
             company = COALESCE(NULLIF(TRIM(company), ''), $5),
             cnpj = COALESCE(NULLIF(TRIM(cnpj), ''), $6),
             phone = COALESCE(NULLIF(TRIM(phone), ''), $7),
             email = COALESCE(NULLIF(TRIM(email), ''), $8),
             product_interest = COALESCE(NULLIF(TRIM(product_interest), ''), $9),
             quantity_interest = COALESCE(NULLIF(TRIM(quantity_interest), ''), $10),
             intent_score = GREATEST(COALESCE(intent_score, 0), $11)
         WHERE tenant_id = $1 AND id = $2`,
        [
          tenantId,
          item.id,
          b.sessionStart,
          b.name,
          b.company,
          b.cnpj || b.cpf,
          effectivePhone,
          b.email,
          b.productInterest,
          b.quantityInterest,
          b.intentScore,
        ],
      );
      stats.lcVisitorsMerged++;
    }

    // 6.3 Inserir `lc_pageviews`, `lc_click_events`, `lc_chats`, `lc_messages`
    progress("write_lc_pageviews", `Inserindo ${lcPageviewInsertRows.length} pageviews...`);
    stats.lcPageviewsInserted = await insertBatch(
      targetDb,
      "lc_pageviews",
      ["id", "tenant_id", "visitor_id", "url", "title", "time_on_page_sec", "scroll_depth_pct", "visited_at"],
      lcPageviewInsertRows,
      "ON CONFLICT (id) DO NOTHING",
      batchSize,
    );

    progress("write_lc_clicks", `Inserindo ${lcClickInsertRows.length} eventos de clique...`);
    stats.lcClickEventsInserted = await insertBatch(
      targetDb,
      "lc_click_events",
      ["id", "tenant_id", "visitor_id", "event_type", "event_data", "occurred_at"],
      lcClickInsertRows,
      "ON CONFLICT (id) DO NOTHING",
      batchSize,
    );

    progress("write_lc_chats", `Inserindo ${lcChatInsertRows.length} sessões em lc_chats...`);
    stats.lcChatsInserted = await insertBatch(
      targetDb,
      "lc_chats",
      [
        "id",
        "tenant_id",
        "visitor_id",
        "channel",
        "status",
        "operator_id",
        "started_at",
        "closed_at",
        "outcome",
        "wa_conversation_id",
      ],
      lcChatInsertRows,
      "ON CONFLICT (id) DO NOTHING",
      batchSize,
    );

    progress("write_lc_messages", `Inserindo ${lcMessageInsertRows.length} mensagens em lc_messages...`);
    stats.lcMessagesInserted = await insertBatch(
      targetDb,
      "lc_messages",
      [
        "id",
        "tenant_id",
        "chat_id",
        "sender",
        "content",
        "content_type",
        "media_url",
        "media_type",
        "file_name",
        "tray_product_data",
        "sent_at",
      ],
      lcMessageInsertRows,
      "ON CONFLICT (id) DO NOTHING",
      batchSize,
    );

    // 6.4 Criar novos `contacts` (`is_legacy = true`) + `contact_phones`
    progress("write_contacts", `Criando ${newContactSpecs.size} novos contatos legados do site...`);
    const contactPhoneRows: unknown[][] = [];

    for (const spec of newContactSpecs.values()) {
      const latestBundle = spec.bundles[spec.bundles.length - 1];
      const linkedSiteContactIds = Array.from(
        new Set(spec.bundles.map((b) => `cont-lc-${b.resolvedVisitorId}`)),
      );
      const customFields = {
        siteVisitorId: latestBundle.resolvedVisitorId,
        siteCookieId: latestBundle.cookieId,
        linkedSiteContactIds,
        legacyFagnerSite: {
          migratedAt: new Date().toISOString(),
          visitorIds: Array.from(new Set(spec.bundles.map((b) => b.resolvedVisitorId))),
          sessions: spec.bundles.flatMap((b) => b.snapshots),
        },
      };

      try {
        const ins = await targetDb.query<{ id: string }>(
          `INSERT INTO contacts (
            id, tenant_id, account_id, name, phone, email, cnpj, cpf,
            main_channel, responsible_name, rd_crm_deal_id, cnpj_details, custom_fields,
            entry_channel, first_source, utm_source, utm_medium, utm_campaign, landing_page,
            is_legacy, is_test, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            'livechat', 'Na Fila', $9, $10::jsonb, $11::jsonb,
            'site_legado', $12, $13, $14, $15, $16,
            true, false, $17, $18
          )
          ON CONFLICT (id) DO NOTHING
          RETURNING id`,
          [
            spec.id,
            tenantId,
            spec.accountId,
            spec.name,
            spec.phone,
            spec.email,
            spec.cnpj,
            spec.cpf,
            spec.rdCrmDealId,
            JSON.stringify(spec.cnpjDetails || {}),
            JSON.stringify(customFields),
            spec.firstSource,
            spec.utmSource,
            spec.utmMedium,
            spec.utmCampaign,
            spec.landingPage,
            spec.createdAt,
            latestBundle.lastSeenAt,
          ],
        );
        if (ins.rows.length > 0) stats.contactsCreated++;

        let pos = 0;
        for (const ph of spec.phonesToInsert) {
          const ident = computeContactPhoneIdentity(ph);
          if (!ident) continue;
          const pType = inferContactPhoneType(ph);
          contactPhoneRows.push([
            deterministicLegacyId("cph-leg", `${tenantId}:${spec.id}:${ident}`),
            tenantId,
            spec.id,
            ph,
            ident,
            pType,
            pos === 0,
            pType !== "landline",
            pos,
            spec.createdAt,
            latestBundle.lastSeenAt,
          ]);
          pos++;
        }
      } catch (err: any) {
        warnings.push(`Falha ao criar contato ${spec.id} (phone=${spec.phone || "none"}): ${err?.message}`);
      }
    }

    if (contactPhoneRows.length > 0) {
      stats.contactPhonesInserted = await insertBatch(
        targetDb,
        "contact_phones",
        [
          "id",
          "tenant_id",
          "contact_id",
          "phone",
          "phone_identity",
          "type",
          "is_primary",
          "has_whatsapp",
          "position",
          "created_at",
          "updated_at",
        ],
        contactPhoneRows,
        "ON CONFLICT DO NOTHING",
        batchSize,
      );
    }

    // 6.5 Enriquecer `contacts` existentes (estritamente não-destrutivo!)
    progress(
      "enrich_contacts",
      `Vinculando e enriquecendo ${existingContactEnrichments.size} contatos já existentes no Valem Chat...`,
    );

    for (const { contact, bundles: matchedBundles, accountIdCandidate } of existingContactEnrichments.values()) {
      const latestBundle = matchedBundles[matchedBundles.length - 1];
      const existingCf = safeJsonObject(contact.custom_fields) || {};
      const existingLinked = Array.isArray(existingCf.linkedSiteContactIds)
        ? existingCf.linkedSiteContactIds.filter((x: unknown): x is string => typeof x === "string")
        : [];
      const newLinked = matchedBundles.map((b) => `cont-lc-${b.resolvedVisitorId}`);
      const mergedLinked = Array.from(new Set([...existingLinked, ...newLinked]));

      const existingLegacy = safeJsonObject(existingCf.legacyFagnerSite) || {};
      const existingVisitorIds = Array.isArray(existingLegacy.visitorIds)
        ? existingLegacy.visitorIds
        : [];
      const mergedVisitorIds = Array.from(
        new Set([...existingVisitorIds, ...matchedBundles.map((b) => b.resolvedVisitorId)]),
      );

      // Evita duplicar snapshots por legacyVisitorId em re-execuções idempotentes
      const existingSessions = Array.isArray(existingLegacy.sessions) ? existingLegacy.sessions : [];
      const sessionsByLegacyId = new Map<string, any>();
      for (const s of existingSessions) {
        if (s?.legacyVisitorId) sessionsByLegacyId.set(s.legacyVisitorId, s);
      }
      for (const b of matchedBundles) {
        for (const snap of b.snapshots) {
          sessionsByLegacyId.set(snap.legacyVisitorId, snap);
        }
      }

      const mergedCustomFields = {
        ...existingCf,
        siteVisitorId: existingCf.siteVisitorId || latestBundle.resolvedVisitorId,
        siteCookieId: existingCf.siteCookieId || latestBundle.cookieId,
        linkedSiteContactIds: mergedLinked,
        legacyFagnerSite: {
          ...existingLegacy,
          migratedAt: existingLegacy.migratedAt || new Date().toISOString(),
          lastSyncedAt: new Date().toISOString(),
          visitorIds: mergedVisitorIds,
          sessions: Array.from(sessionsByLegacyId.values()),
        },
      };

      const bestName = matchedBundles.find((b) => b.name && !isGenericName(b.name))?.name || null;
      const bestEmail = matchedBundles.find((b) => b.email)?.email || null;
      const bestCpf = matchedBundles.find((b) => b.cpf)?.cpf || null;
      const bestCnpj = matchedBundles.find((b) => b.cnpj)?.cnpj || null;
      const bestCnpjData = matchedBundles.find((b) => b.cnpjData)?.cnpjData || null;
      const bestRdDeal = matchedBundles.find((b) => b.rdDealIds.length > 0)?.rdDealIds[0] || null;
      const bestFirstSource = matchedBundles.find((b) => b.firstSource)?.firstSource || null;
      const bestUtmSource = matchedBundles.find((b) => b.utmSource)?.utmSource || null;
      const bestUtmMedium = matchedBundles.find((b) => b.utmMedium)?.utmMedium || null;
      const bestUtmCampaign = matchedBundles.find((b) => b.utmCampaign)?.utmCampaign || null;
      const bestLandingPage = matchedBundles.find((b) => b.landingPage)?.landingPage || null;

      const shouldUpgradeName = Boolean(bestName && isGenericName(contact.name, contact.phone));
      const existingCnpjDetails = safeJsonObject(contact.cnpj_details) || {};
      const shouldFillCnpjDetails =
        Boolean(bestCnpjData) && Object.keys(existingCnpjDetails).length === 0;

      await targetDb.query(
        `UPDATE contacts
         SET name = CASE WHEN $3 THEN $4 ELSE name END,
             email = COALESCE(NULLIF(TRIM(email), ''), $5),
             cpf = COALESCE(NULLIF(TRIM(cpf), ''), $6),
             cnpj = COALESCE(NULLIF(TRIM(cnpj), ''), $7),
             account_id = COALESCE(account_id, $8),
             rd_crm_deal_id = COALESCE(NULLIF(TRIM(rd_crm_deal_id), ''), $9),
             cnpj_details = CASE WHEN $10 THEN $11::jsonb ELSE cnpj_details END,
             first_source = COALESCE(NULLIF(TRIM(first_source), ''), $12),
             utm_source = COALESCE(NULLIF(TRIM(utm_source), ''), $13),
             utm_medium = COALESCE(NULLIF(TRIM(utm_medium), ''), $14),
             utm_campaign = COALESCE(NULLIF(TRIM(utm_campaign), ''), $15),
             landing_page = COALESCE(NULLIF(TRIM(landing_page), ''), $16),
             custom_fields = $17::jsonb
         WHERE tenant_id = $1 AND id = $2`,
        [
          tenantId,
          contact.id,
          shouldUpgradeName,
          bestName,
          bestEmail,
          bestCpf,
          bestCnpj,
          accountIdCandidate,
          bestRdDeal,
          shouldFillCnpjDetails,
          JSON.stringify(bestCnpjData || {}),
          bestFirstSource,
          bestUtmSource,
          bestUtmMedium,
          bestUtmCampaign,
          bestLandingPage,
          JSON.stringify(mergedCustomFields),
        ],
      );
      stats.contactsUpdated++;
    }

    // 6.6 Materializar `conversations` (`conv-lc-*` em `finalizados`) + `messages` (`provider = 'livechat'`)
    if (includeConversations && conversationInsertRows.length > 0) {
      progress(
        "write_conversations",
        `Inserindo ${conversationInsertRows.length} conversas finalizadas do site (conv-lc-*)...`,
      );
      stats.conversationsInserted = await insertBatch(
        targetDb,
        "conversations",
        [
          "id",
          "tenant_id",
          "contact_id",
          "contact_phone_id",
          "contact_phone",
          "whatsapp_connection_id",
          "operator_id",
          "sector_id",
          "queue_state",
          "unread_count",
          "version",
          "updated_at",
          "last_message_text",
          "last_message_time",
          "created_at",
        ],
        conversationInsertRows,
        "ON CONFLICT (id) DO NOTHING",
        batchSize,
      );
    }

    if (includeConversations && coreMessageInsertRows.length > 0) {
      progress(
        "write_messages",
        `Inserindo ${coreMessageInsertRows.length} mensagens históricas do site em messages...`,
      );
      stats.messagesInserted = await insertBatch(
        targetDb,
        "messages",
        [
          "id",
          "tenant_id",
          "conversation_id",
          "sender_type",
          "sender_name",
          "content",
          "is_internal_note",
          "external_id",
          "provider",
          "direction",
          "status",
          "meta_details",
          "updated_at",
          "sent_at",
        ],
        coreMessageInsertRows,
        "ON CONFLICT (id) DO NOTHING",
        batchSize,
      );
    }
  }

  const finishedAt = new Date();
  return {
    tenantId,
    dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    sourceCounts: {
      lcVisitors: legacyVisitorsRes.rows.length,
      lcPageviews: legacyPageviewsRes.rows.length,
      lcClickEvents: legacyClicksRes.rows.length,
      lcChats: legacyChatsRes.rows.length,
      lcMessages: legacyMessagesRes.rows.length,
      ucBridgeSiteRows: ucBridgeRows.length,
    },
    deduplication: {
      canonicalVisitors: bundles.length,
      mergedIntoExistingActiveV2Cookie,
      mergedDuplicateLegacyCookies,
      visitorsWithChats: bundles.filter((b) => b.chats.length > 0).length,
      visitorsWithMessages: bundles.filter((b) => b.allMessagesSorted.length > 0).length,
    },
    matching: {
      matchedByPhone,
      matchedByDocument,
      matchedByRdDeal,
      matchedByEmail,
      totalMatchedExistingContacts: matchedByPhone + matchedByDocument + matchedByRdDeal + matchedByEmail,
      uniqueExistingContactsEnriched: existingContactEnrichments.size,
      newIdentifiedContacts,
      newAnonymousChatContacts,
      anonymousVisitorsWithoutContact,
      linkedToWhatsAppConversation,
      ambiguousMatchesCount: ambiguousMatches.length,
      ambiguousMatches: ambiguousMatches.slice(0, 200),
    },
    targetPlannedOrWritten: stats,
    warnings,
  };
}
