import { AsyncLocalStorage } from "node:async_hooks";
import { getAiPersona } from "../ai-persona";
import { runtimeSingleton } from "../runtime-singleton";

export const AUDIT_ACTOR_TYPES = ["human", "ai", "system"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_SOURCE_CHANNELS = ["crm_ui", "api", "mcp", "webhook", "import"] as const;
export type AuditSourceChannel = (typeof AUDIT_SOURCE_CHANNELS)[number];

export interface AuditOriginContext {
  actorType: AuditActorType;
  sourceChannel: AuditSourceChannel;
  actorOperatorId?: string | null;
  actorName?: string | null;
  clientIp?: string | null;
  mcpKeyId?: string | null;
  mcpKeyLabel?: string | null;
  mcpToolName?: string | null;
}

export interface ResolvedAuditOrigin {
  actorType: AuditActorType;
  sourceChannel: AuditSourceChannel;
  actorOperatorId: string | null;
  actorName: string;
  clientIp: string | null;
  mcpKeyId: string | null;
  mcpKeyLabel: string | null;
  mcpToolName: string | null;
}

const auditStorage = runtimeSingleton(
  "AuditOriginAsyncLocalStorage",
  () => new AsyncLocalStorage<AuditOriginContext>(),
);

export function getAuditContext(): AuditOriginContext | undefined {
  return auditStorage.getStore();
}

export function runWithAuditContext<T>(ctx: AuditOriginContext, fn: () => T): T {
  return auditStorage.run(ctx, fn);
}

export function enterAuditContext(ctx: AuditOriginContext): void {
  auditStorage.enterWith(ctx);
}

export function normalizeAuditActorType(raw: unknown): AuditActorType | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "human" || v === "humano" || v === "operator" || v === "user") return "human";
  if (v === "ai" || v === "ia" || v === "ai_sdr" || v === "bot" || v === "fagner" || v === "valentina") {
    return "ai";
  }
  if (v === "system" || v === "sistema" || v === "automation" || v === "cron") return "system";
  return null;
}

export function normalizeAuditSourceChannel(raw: unknown): AuditSourceChannel | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "crm_ui" || v === "ui" || v === "crm" || v === "web" || v === "interface") return "crm_ui";
  if (v === "api" || v === "rest" || v === "http_api") return "api";
  if (v === "mcp") return "mcp";
  if (v === "webhook" || v === "rd_webhook" || v === "rd_marketing" || v === "meta_webhook") return "webhook";
  if (v === "import" || v === "importacao" || v === "migration" || v === "rd_import") return "import";
  return null;
}

export function extractAuditClientIp(request?: Request | null): string | null {
  if (!request) return null;
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp.slice(0, 64);

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);

  const clientIp = request.headers.get("x-client-ip")?.trim();
  if (clientIp) return clientIp.slice(0, 64);

  return null;
}

export function inferHttpSourceChannel(request?: Request | null): AuditSourceChannel {
  if (!request) return "api";
  const path = (() => {
    try {
      return new URL(request.url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (path.includes("/import")) return "import";
  if (path.includes("/webhooks/")) return "webhook";
  if (path === "/api/mcp" || path.startsWith("/api/mcp/")) return "mcp";
  if (path.startsWith("/api/v1/")) return "api";

  const cookieHeader = request.headers.get("cookie") || "";
  const hasSessionCookie = cookieHeader.includes("session_token=");
  const authHeader = request.headers.get("authorization") || "";
  const hasBearer = authHeader.toLowerCase().startsWith("bearer ");
  const hasBrowserFetch =
    Boolean(request.headers.get("sec-fetch-mode")) ||
    Boolean(request.headers.get("sec-fetch-site")) ||
    Boolean(request.headers.get("referer")) ||
    Boolean(request.headers.get("origin"));

  if (hasBearer && !hasSessionCookie) return "api";
  if (hasSessionCookie || hasBrowserFetch) return "crm_ui";
  return "api";
}

export function getAuditActorTypeLabel(
  actorType: AuditActorType | string | null | undefined,
  tenantId?: string | null,
): string {
  const normalized = normalizeAuditActorType(actorType);
  if (normalized === "human") return "Humano";
  if (normalized === "ai") {
    if (tenantId === "tecfag" || tenantId === "valem") {
      return `IA (${getAiPersona(tenantId).name})`;
    }
    return "IA";
  }
  if (normalized === "system") return "Sistema";
  return "Não informado";
}

export function getAuditSourceChannelLabel(
  sourceChannel: AuditSourceChannel | string | null | undefined,
): string {
  const normalized = normalizeAuditSourceChannel(sourceChannel);
  if (normalized === "crm_ui") return "Interface do CRM";
  if (normalized === "api") return "API";
  if (normalized === "mcp") return "MCP";
  if (normalized === "webhook") return "Webhook";
  if (normalized === "import") return "Importação";
  return "Legado / Não informado";
}

export function formatAuditTimestampBrt(value: Date | string | number | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `${formatted} BRT`;
}

export function resolveAuditOrigin(params?: {
  tenantId?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
  metadata?: Record<string, unknown> | null;
  override?: Partial<AuditOriginContext> | null;
}): ResolvedAuditOrigin {
  const store = getAuditContext();
  const meta = params?.metadata && typeof params.metadata === "object" ? params.metadata : {};
  const override = params?.override || {};

  const metaActorType = normalizeAuditActorType(meta.actorType);
  const metaChannel =
    normalizeAuditSourceChannel(meta.sourceChannel) ||
    normalizeAuditSourceChannel(meta.source) ||
    normalizeAuditSourceChannel(meta.origin);

  // Detecta origem IA em metadados legados (ex: auto_sdr, ai_sdr, rodizio_reassignment)
  const metaOriginStr = String(meta.origin || meta.source || "").toLowerCase();
  const looksLikeAi =
    metaActorType === "ai" ||
    metaOriginStr.includes("auto_sdr") ||
    metaOriginStr.includes("rodizio") ||
    metaOriginStr.includes("ai_sdr");
  const looksLikeWebhook =
    metaChannel === "webhook" ||
    metaOriginStr.includes("rd_webhook") ||
    metaOriginStr.includes("rd_marketing") ||
    Boolean(meta.marketingOrigin);
  const looksLikeImport =
    metaChannel === "import" ||
    metaOriginStr.includes("import") ||
    metaOriginStr.includes("migration");

  const effectiveSourceChannel: AuditSourceChannel =
    normalizeAuditSourceChannel(override.sourceChannel) ||
    store?.sourceChannel ||
    metaChannel ||
    (looksLikeWebhook
      ? "webhook"
      : looksLikeImport
        ? "import"
        : params?.operatorId
          ? "crm_ui"
          : "api");

  const effectiveActorType: AuditActorType =
    normalizeAuditActorType(override.actorType) ||
    store?.actorType ||
    (looksLikeAi
      ? "ai"
      : metaActorType ||
        (effectiveSourceChannel === "webhook"
          ? "system"
          : params?.operatorId
            ? "human"
            : "system"));

  // Quando a origem é MCP/Webhook/IA, nunca atribuir o operatorId de destino como autor humano!
  const effectiveActorOperatorId: string | null =
    override.actorOperatorId !== undefined
      ? override.actorOperatorId
      : store !== undefined
        ? (store.actorOperatorId ?? null)
        : effectiveActorType === "human"
          ? (params?.operatorId ?? null)
          : null;

  const mcpKeyId =
    override.mcpKeyId ??
    store?.mcpKeyId ??
    (typeof meta.mcpKeyId === "string" ? meta.mcpKeyId : null);
  const mcpKeyLabel =
    override.mcpKeyLabel ??
    store?.mcpKeyLabel ??
    (typeof meta.mcpKeyLabel === "string" ? meta.mcpKeyLabel : null);
  const mcpToolName =
    override.mcpToolName ??
    store?.mcpToolName ??
    (typeof meta.mcpToolName === "string" ? meta.mcpToolName : null);
  const clientIp =
    override.clientIp ??
    store?.clientIp ??
    (typeof meta.clientIp === "string" ? meta.clientIp : null);

  const fallbackAiName =
    params?.tenantId === "tecfag" || params?.tenantId === "valem"
      ? getAiPersona(params.tenantId).name
      : "IA";

  const explicitActorName =
    (typeof override.actorName === "string" && override.actorName.trim()) ||
    (typeof store?.actorName === "string" && store.actorName.trim()) ||
    (typeof meta.actorName === "string" && meta.actorName.trim()) ||
    (effectiveActorType === "human" && typeof params?.operatorName === "string" && params.operatorName.trim()) ||
    (effectiveSourceChannel === "mcp"
      ? mcpKeyLabel
        ? `MCP (${mcpKeyLabel})`
        : "MCP"
      : effectiveActorType === "ai"
        ? fallbackAiName
        : effectiveSourceChannel === "webhook"
          ? "Webhook"
          : "Sistema");

  return {
    actorType: effectiveActorType,
    sourceChannel: effectiveSourceChannel,
    actorOperatorId: effectiveActorOperatorId,
    actorName: explicitActorName,
    clientIp: clientIp || null,
    mcpKeyId: mcpKeyId || null,
    mcpKeyLabel: mcpKeyLabel || null,
    mcpToolName: mcpToolName || null,
  };
}

export function extractAuditOriginFromStoredRecord(
  record: {
    actorType?: string | null;
    sourceChannel?: string | null;
    actorName?: string | null;
    clientIp?: string | null;
    mcpKeyId?: string | null;
    mcpKeyLabel?: string | null;
    operatorId?: string | null;
    operatorName?: string | null;
    metadata?: Record<string, unknown> | null;
    details?: Record<string, unknown> | null;
  },
  tenantId?: string | null,
): {
  actorType: AuditActorType | null;
  actorTypeLabel: string;
  sourceChannel: AuditSourceChannel | null;
  sourceChannelLabel: string;
  actorName: string | null;
  clientIp: string | null;
  mcpKeyId: string | null;
  mcpKeyLabel: string | null;
} {
  const bag =
    (record.metadata && typeof record.metadata === "object" ? record.metadata : null) ||
    (record.details && typeof record.details === "object" ? record.details : null) ||
    {};

  const originStr = String(bag.origin || bag.source || "").toLowerCase();

  let sourceChannel =
    normalizeAuditSourceChannel(record.sourceChannel) ||
    normalizeAuditSourceChannel(bag.sourceChannel) ||
    normalizeAuditSourceChannel(bag.source) ||
    normalizeAuditSourceChannel(bag.origin);

  if (!sourceChannel) {
    if (originStr.includes("rd_webhook") || originStr.includes("rd_marketing") || bag.marketingOrigin) {
      sourceChannel = "webhook";
    } else if (originStr.includes("import") || originStr.includes("migration")) {
      sourceChannel = "import";
    } else if (record.mcpKeyId || record.mcpKeyLabel || bag.mcpKeyId || bag.mcpKeyLabel) {
      sourceChannel = "mcp";
    }
  }

  let actorType =
    normalizeAuditActorType(record.actorType) ||
    normalizeAuditActorType(bag.actorType);

  if (!actorType) {
    if (
      originStr.includes("auto_sdr") ||
      originStr.includes("rodizio") ||
      originStr.includes("ai_sdr")
    ) {
      actorType = "ai";
    } else if (sourceChannel === "webhook") {
      actorType = "system";
    } else if (record.operatorId) {
      actorType = "human";
    }
  }

  const clientIp =
    record.clientIp ||
    (typeof bag.clientIp === "string" ? bag.clientIp : null) ||
    null;
  const mcpKeyId =
    record.mcpKeyId ||
    (typeof bag.mcpKeyId === "string" ? bag.mcpKeyId : null) ||
    null;
  const mcpKeyLabel =
    record.mcpKeyLabel ||
    (typeof bag.mcpKeyLabel === "string" ? bag.mcpKeyLabel : null) ||
    null;
  const actorName =
    record.actorName ||
    (typeof bag.actorName === "string" && bag.actorName.trim() ? bag.actorName.trim() : null) ||
    record.operatorName ||
    null;

  return {
    actorType,
    actorTypeLabel: getAuditActorTypeLabel(actorType, tenantId),
    sourceChannel,
    sourceChannelLabel: getAuditSourceChannelLabel(sourceChannel),
    actorName,
    clientIp,
    mcpKeyId,
    mcpKeyLabel,
  };
}
