export interface McpGuardConfig {
  rateLimitPerMin: number;
  tenantRateLimitPerMin: number;
  maxConcurrentPerKey: number;
  maxConcurrentGlobal: number;
  maxHeavyConcurrentPerKey: number;
  maxHeavyConcurrentGlobal: number;
  queueTimeoutMs: number;
  maxQueue: number;
  windowMs: number;
}

export interface McpKeyLimitOverrides {
  rateLimitPerMin?: number | null;
  maxConcurrent?: number | null;
  maxHeavyConcurrent?: number | null;
}

export interface McpGuardAcquireParams {
  tenantId: "tecfag" | "valem";
  keyId: string;
  isHeavy: boolean;
  keyLimits?: McpKeyLimitOverrides;
  signal?: AbortSignal;
}

export interface McpGuardHeaders {
  "X-RateLimit-Limit": string;
  "X-RateLimit-Remaining": string;
  "X-RateLimit-Reset": string;
  "X-MCP-Concurrency-Limit": string;
  "X-MCP-Concurrency-Active": string;
  "Retry-After"?: string;
}

export type McpGuardResult =
  | {
      allowed: true;
      release: () => void;
      headers: McpGuardHeaders;
      waitedMs: number;
    }
  | {
      allowed: false;
      reason:
        | "rate_limit_key"
        | "rate_limit_tenant"
        | "concurrency_queue_full"
        | "concurrency_timeout"
        | "aborted";
      retryAfterSeconds: number;
      message: string;
      headers: McpGuardHeaders;
    };

export const HEAVY_MCP_TOOLS = new Set<string>([
  "search_conversations",
  "search_crm_deals",
  "search_crm_accounts",
  "search_contacts",
  "get_crm_deal_details",
  "get_crm_deals_batch",
  "get_operator_conversations_messages",
  "get_sales_and_commercial_metrics",
  "get_marketing_audit_batch",
  "get_fagner_triage_audit_batch",
  "get_fagner_triage_sweep",
  "batch_upsert_crm_deals",
  "query_knowledge_rag",
]);

export function normalizeMcpKeyLimitOverrides(raw: unknown): McpKeyLimitOverrides | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const parseBound = (val: unknown, min: number, max: number): number | undefined => {
    if (val === null || val === undefined || val === "") return undefined;
    const n = Number(val);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(min, Math.min(max, Math.floor(n)));
  };

  const rateLimitPerMin = parseBound(obj.rateLimitPerMin, 1, 5000);
  const maxConcurrent = parseBound(obj.maxConcurrent, 1, 50);
  const maxHeavyConcurrent = parseBound(obj.maxHeavyConcurrent, 1, 20);

  if (
    rateLimitPerMin === undefined &&
    maxConcurrent === undefined &&
    maxHeavyConcurrent === undefined
  ) {
    return undefined;
  }

  return {
    ...(rateLimitPerMin !== undefined ? { rateLimitPerMin } : {}),
    ...(maxConcurrent !== undefined ? { maxConcurrent } : {}),
    ...(maxHeavyConcurrent !== undefined ? { maxHeavyConcurrent } : {}),
  };
}

function readEnvPositiveInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function resolveDefaultMcpGuardConfig(): McpGuardConfig {
  return {
    rateLimitPerMin: readEnvPositiveInt("MCP_RATE_LIMIT_PER_MIN", 180, 10, 5000),
    tenantRateLimitPerMin: readEnvPositiveInt("MCP_TENANT_RATE_LIMIT_PER_MIN", 300, 20, 10000),
    maxConcurrentPerKey: readEnvPositiveInt("MCP_MAX_CONCURRENT_PER_KEY", 8, 1, 50),
    maxConcurrentGlobal: readEnvPositiveInt("MCP_MAX_CONCURRENT_GLOBAL", 12, 2, 60),
    maxHeavyConcurrentPerKey: readEnvPositiveInt("MCP_MAX_HEAVY_CONCURRENT_PER_KEY", 4, 1, 20),
    maxHeavyConcurrentGlobal: readEnvPositiveInt("MCP_MAX_HEAVY_CONCURRENT_GLOBAL", 6, 1, 30),
    queueTimeoutMs: readEnvPositiveInt("MCP_CONCURRENCY_QUEUE_TIMEOUT_MS", 5000, 50, 60000),
    maxQueue: readEnvPositiveInt("MCP_CONCURRENCY_MAX_QUEUE", 32, 0, 200),
    windowMs: 60_000,
  };
}

export function extractMcpPayloadInspection(payload: unknown): {
  isNotificationOnly: boolean;
  toolNames: string[];
  isHeavy: boolean;
  requestCount: number;
} {
  const items = Array.isArray(payload) ? payload : [payload];
  const toolNames: string[] = [];
  let nonNotificationCount = 0;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const msg = item as Record<string, unknown>;
    const method = typeof msg.method === "string" ? msg.method : "";
    const isDirectTool =
      !method && (typeof msg.tool === "string" || typeof msg.toolName === "string");
    const hasId = msg.id !== undefined && msg.id !== null;

    if (method.startsWith("notifications/") || (!isDirectTool && !hasId && method !== "tools/call" && method !== "initialize" && method !== "tools/list")) {
      continue;
    }

    nonNotificationCount += 1;

    if (isDirectTool) {
      const name = String(msg.tool || msg.toolName || "").trim();
      if (name) toolNames.push(name);
    } else if (method === "tools/call") {
      const params = msg.params && typeof msg.params === "object" ? (msg.params as Record<string, unknown>) : {};
      const name = String(params.name || "").trim();
      if (name) toolNames.push(name);
    }
  }

  const isHeavy = toolNames.some((n) => HEAVY_MCP_TOOLS.has(n)) || toolNames.length > 3;
  return {
    isNotificationOnly: nonNotificationCount === 0,
    toolNames,
    isHeavy,
    requestCount: Math.max(1, nonNotificationCount),
  };
}

interface ResolvedKeyLimits {
  rateLimitPerMin: number;
  maxConcurrent: number;
  maxHeavyConcurrent: number;
}

interface PendingWaiter {
  keyScope: string;
  isHeavy: boolean;
  limits: ResolvedKeyLimits;
  enqueuedAt: number;
  resolve: (granted: boolean, reason?: "concurrency_timeout" | "aborted") => void;
  timer: ReturnType<typeof setTimeout>;
  cleanupAbort?: () => void;
}

export class McpTrafficGuard {
  private readonly cfg: McpGuardConfig;
  private readonly keyHits = new Map<string, number[]>();
  private readonly tenantHits = new Map<string, number[]>();

  private activeGlobal = 0;
  private activeHeavyGlobal = 0;
  private readonly activeByKey = new Map<string, number>();
  private readonly activeHeavyByKey = new Map<string, number>();
  private readonly waitQueue: PendingWaiter[] = [];

  constructor(overrides?: Partial<McpGuardConfig>) {
    this.cfg = {
      ...resolveDefaultMcpGuardConfig(),
      ...(overrides || {}),
    };
  }

  getConfig(): McpGuardConfig {
    return { ...this.cfg };
  }

  getSnapshot() {
    return {
      limits: {
        rateLimitPerMinPerKey: this.cfg.rateLimitPerMin,
        rateLimitPerMinPerTenant: this.cfg.tenantRateLimitPerMin,
        maxConcurrentPerKey: this.cfg.maxConcurrentPerKey,
        maxConcurrentGlobal: this.cfg.maxConcurrentGlobal,
        maxHeavyConcurrentPerKey: this.cfg.maxHeavyConcurrentPerKey,
        maxHeavyConcurrentGlobal: this.cfg.maxHeavyConcurrentGlobal,
        queueTimeoutMs: this.cfg.queueTimeoutMs,
      },
      active: {
        global: this.activeGlobal,
        heavyGlobal: this.activeHeavyGlobal,
        queued: this.waitQueue.length,
      },
      heavyTools: Array.from(HEAVY_MCP_TOOLS),
    };
  }

  private pruneWindow(bucket: number[], now: number): number[] {
    const cutoff = now - this.cfg.windowMs;
    let firstValidIdx = 0;
    while (firstValidIdx < bucket.length && bucket[firstValidIdx] <= cutoff) {
      firstValidIdx += 1;
    }
    return firstValidIdx > 0 ? bucket.slice(firstValidIdx) : bucket;
  }

  private resolveEffectiveKeyLimits(overrides?: McpKeyLimitOverrides): ResolvedKeyLimits {
    const normalized = normalizeMcpKeyLimitOverrides(overrides);
    const rateLimitPerMin = normalized?.rateLimitPerMin ?? this.cfg.rateLimitPerMin;
    const maxConcurrent = Math.min(
      normalized?.maxConcurrent ?? this.cfg.maxConcurrentPerKey,
      this.cfg.maxConcurrentGlobal,
    );
    const maxHeavyConcurrent = Math.min(
      normalized?.maxHeavyConcurrent ?? this.cfg.maxHeavyConcurrentPerKey,
      maxConcurrent,
      this.cfg.maxHeavyConcurrentGlobal,
    );
    return {
      rateLimitPerMin,
      maxConcurrent: Math.max(1, maxConcurrent),
      maxHeavyConcurrent: Math.max(1, maxHeavyConcurrent),
    };
  }

  private canAcquire(keyScope: string, isHeavy: boolean, limits: ResolvedKeyLimits): boolean {
    if (this.activeGlobal >= this.cfg.maxConcurrentGlobal) return false;
    const keyActive = this.activeByKey.get(keyScope) || 0;
    if (keyActive >= limits.maxConcurrent) return false;
    if (isHeavy) {
      if (this.activeHeavyGlobal >= this.cfg.maxHeavyConcurrentGlobal) return false;
      const keyHeavy = this.activeHeavyByKey.get(keyScope) || 0;
      if (keyHeavy >= limits.maxHeavyConcurrent) return false;
    }
    return true;
  }

  private occupySlot(keyScope: string, isHeavy: boolean): void {
    this.activeGlobal += 1;
    this.activeByKey.set(keyScope, (this.activeByKey.get(keyScope) || 0) + 1);
    if (isHeavy) {
      this.activeHeavyGlobal += 1;
      this.activeHeavyByKey.set(keyScope, (this.activeHeavyByKey.get(keyScope) || 0) + 1);
    }
  }

  private releaseSlot(keyScope: string, isHeavy: boolean): void {
    this.activeGlobal = Math.max(0, this.activeGlobal - 1);
    const nextKey = Math.max(0, (this.activeByKey.get(keyScope) || 1) - 1);
    if (nextKey === 0) this.activeByKey.delete(keyScope);
    else this.activeByKey.set(keyScope, nextKey);

    if (isHeavy) {
      this.activeHeavyGlobal = Math.max(0, this.activeHeavyGlobal - 1);
      const nextHeavy = Math.max(0, (this.activeHeavyByKey.get(keyScope) || 1) - 1);
      if (nextHeavy === 0) this.activeHeavyByKey.delete(keyScope);
      else this.activeHeavyByKey.set(keyScope, nextHeavy);
    }

    this.promoteWaiters();
  }

  private promoteWaiters(): void {
    for (let i = 0; i < this.waitQueue.length; ) {
      const waiter = this.waitQueue[i];
      if (this.canAcquire(waiter.keyScope, waiter.isHeavy, waiter.limits)) {
        this.waitQueue.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.cleanupAbort?.();
        this.occupySlot(waiter.keyScope, waiter.isHeavy);
        waiter.resolve(true);
      } else {
        i += 1;
      }
    }
  }

  private buildHeaders(
    keyScope: string,
    keyRemaining: number,
    resetEpochSeconds: number,
    isHeavy: boolean,
    limits: ResolvedKeyLimits,
    retryAfterSeconds?: number,
  ): McpGuardHeaders {
    const concurrencyLimit = isHeavy ? limits.maxHeavyConcurrent : limits.maxConcurrent;
    const concurrencyActive = isHeavy
      ? this.activeHeavyByKey.get(keyScope) || 0
      : this.activeByKey.get(keyScope) || 0;

    const headers: McpGuardHeaders = {
      "X-RateLimit-Limit": String(limits.rateLimitPerMin),
      "X-RateLimit-Remaining": String(Math.max(0, keyRemaining)),
      "X-RateLimit-Reset": String(resetEpochSeconds),
      "X-MCP-Concurrency-Limit": String(concurrencyLimit),
      "X-MCP-Concurrency-Active": String(concurrencyActive),
    };
    if (retryAfterSeconds !== undefined) {
      headers["Retry-After"] = String(Math.max(1, Math.ceil(retryAfterSeconds)));
    }
    return headers;
  }

  async acquire(params: McpGuardAcquireParams): Promise<McpGuardResult> {
    const now = Date.now();
    const keyScope = `${params.tenantId}:${params.keyId || "primary"}`;
    const tenantScope = params.tenantId;
    const keyLimits = this.resolveEffectiveKeyLimits(params.keyLimits);

    const keyWindow = this.pruneWindow(this.keyHits.get(keyScope) || [], now);
    const tenantWindow = this.pruneWindow(this.tenantHits.get(tenantScope) || [], now);

    const oldestKeyTs = keyWindow[0] ?? now;
    const resetEpochSeconds = Math.ceil((oldestKeyTs + this.cfg.windowMs) / 1000);

    if (keyWindow.length >= keyLimits.rateLimitPerMin) {
      this.keyHits.set(keyScope, keyWindow);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((keyWindow[0] + this.cfg.windowMs - now) / 1000),
      );
      return {
        allowed: false,
        reason: "rate_limit_key",
        retryAfterSeconds,
        message: `Rate limit excedido para esta chave MCP (${keyLimits.rateLimitPerMin} req/min). Aguarde ${retryAfterSeconds}s e tente novamente.`,
        headers: this.buildHeaders(
          keyScope,
          0,
          resetEpochSeconds,
          params.isHeavy,
          keyLimits,
          retryAfterSeconds,
        ),
      };
    }

    if (tenantWindow.length >= this.cfg.tenantRateLimitPerMin) {
      this.tenantHits.set(tenantScope, tenantWindow);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((tenantWindow[0] + this.cfg.windowMs - now) / 1000),
      );
      return {
        allowed: false,
        reason: "rate_limit_tenant",
        retryAfterSeconds,
        message: `Rate limit global do tenant '${params.tenantId}' excedido (${this.cfg.tenantRateLimitPerMin} req/min). Aguarde ${retryAfterSeconds}s.`,
        headers: this.buildHeaders(
          keyScope,
          0,
          resetEpochSeconds,
          params.isHeavy,
          keyLimits,
          retryAfterSeconds,
        ),
      };
    }

    // Registra timestamp na janela antes da fila de concorrência apenas se puder entrar ou enfileirar
    if (!this.canAcquire(keyScope, params.isHeavy, keyLimits)) {
      if (params.signal?.aborted) {
        return {
          allowed: false,
          reason: "aborted",
          retryAfterSeconds: 1,
          message: "Requisição cancelada pelo cliente enquanto aguardava slot de concorrência.",
          headers: this.buildHeaders(
            keyScope,
            keyLimits.rateLimitPerMin - keyWindow.length,
            resetEpochSeconds,
            params.isHeavy,
            keyLimits,
            1,
          ),
        };
      }

      if (this.waitQueue.length >= this.cfg.maxQueue) {
        return {
          allowed: false,
          reason: "concurrency_queue_full",
          retryAfterSeconds: 2,
          message: `Servidor MCP com concorrência máxima ativa (fila de espera cheia: ${this.cfg.maxQueue}). Reduza o paralelismo e tente novamente.`,
          headers: this.buildHeaders(
            keyScope,
            keyLimits.rateLimitPerMin - keyWindow.length,
            resetEpochSeconds,
            params.isHeavy,
            keyLimits,
            2,
          ),
        };
      }

      const waitResult = await new Promise<
        { granted: true; waitedMs: number } | { granted: false; reason: "concurrency_timeout" | "aborted" }
      >((resolve) => {
        const enqueuedAt = Date.now();
        const waiter: PendingWaiter = {
          keyScope,
          isHeavy: params.isHeavy,
          limits: keyLimits,
          enqueuedAt,
          resolve: (granted, reason) => {
            if (granted) {
              resolve({ granted: true, waitedMs: Date.now() - enqueuedAt });
            } else {
              resolve({ granted: false, reason: reason || "concurrency_timeout" });
            }
          },
          timer: setTimeout(() => {
            const idx = this.waitQueue.indexOf(waiter);
            if (idx >= 0) this.waitQueue.splice(idx, 1);
            waiter.cleanupAbort?.();
            waiter.resolve(false, "concurrency_timeout");
          }, this.cfg.queueTimeoutMs),
        };

        if (params.signal) {
          const onAbort = () => {
            const idx = this.waitQueue.indexOf(waiter);
            if (idx >= 0) this.waitQueue.splice(idx, 1);
            clearTimeout(waiter.timer);
            waiter.resolve(false, "aborted");
          };
          params.signal.addEventListener("abort", onAbort, { once: true });
          waiter.cleanupAbort = () => params.signal?.removeEventListener("abort", onAbort);
        }

        this.waitQueue.push(waiter);
      });

      if (!waitResult.granted) {
        const retrySec = 2;
        return {
          allowed: false,
          reason: waitResult.reason,
          retryAfterSeconds: retrySec,
          message:
            waitResult.reason === "aborted"
              ? "Requisição cancelada pelo cliente."
              : `Limite de chamadas simultâneas do MCP atingido (${params.isHeavy ? keyLimits.maxHeavyConcurrent : keyLimits.maxConcurrent} paralelas para esta chave). Reduza a concorrência e tente novamente.`,
          headers: this.buildHeaders(
            keyScope,
            keyLimits.rateLimitPerMin - keyWindow.length,
            resetEpochSeconds,
            params.isHeavy,
            keyLimits,
            retrySec,
          ),
        };
      }

      // Slot já foi ocupado dentro de promoteWaiters()
      const hitAt = Date.now();
      const updatedKeyWindow = this.pruneWindow(this.keyHits.get(keyScope) || [], hitAt);
      updatedKeyWindow.push(hitAt);
      this.keyHits.set(keyScope, updatedKeyWindow);

      const updatedTenantWindow = this.pruneWindow(this.tenantHits.get(tenantScope) || [], hitAt);
      updatedTenantWindow.push(hitAt);
      this.tenantHits.set(tenantScope, updatedTenantWindow);

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.releaseSlot(keyScope, params.isHeavy);
      };

      return {
        allowed: true,
        release,
        waitedMs: waitResult.waitedMs,
        headers: this.buildHeaders(
          keyScope,
          keyLimits.rateLimitPerMin - updatedKeyWindow.length,
          Math.ceil(((updatedKeyWindow[0] ?? hitAt) + this.cfg.windowMs) / 1000),
          params.isHeavy,
          keyLimits,
        ),
      };
    }

    // Caminho rápido: slot disponível imediatamente
    this.occupySlot(keyScope, params.isHeavy);
    keyWindow.push(now);
    tenantWindow.push(now);
    this.keyHits.set(keyScope, keyWindow);
    this.tenantHits.set(tenantScope, tenantWindow);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.releaseSlot(keyScope, params.isHeavy);
    };

    return {
      allowed: true,
      release,
      waitedMs: 0,
      headers: this.buildHeaders(
        keyScope,
        keyLimits.rateLimitPerMin - keyWindow.length,
        Math.ceil(((keyWindow[0] ?? now) + this.cfg.windowMs) / 1000),
        params.isHeavy,
        keyLimits,
      ),
    };
  }
}

export const defaultMcpGuard = new McpTrafficGuard();

export function buildMcpRateLimitedResponse(
  result: Extract<McpGuardResult, { allowed: false }>,
  corsHeaders: Record<string, string>,
  sessionId?: string,
  rpcId: unknown = null,
): Response {
  const headers: Record<string, string> = {
    ...corsHeaders,
    ...result.headers,
    "Content-Type": "application/json; charset=utf-8",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32029,
        message: result.message,
        data: {
          reason: result.reason,
          retryAfterSeconds: result.retryAfterSeconds,
        },
      },
      id: rpcId,
    }),
    {
      status: 429,
      headers,
    },
  );
}
