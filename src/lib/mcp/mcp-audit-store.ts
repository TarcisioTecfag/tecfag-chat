import { client as defaultSqlClient } from "../../db";

export type McpAuditEventType = "query" | "action" | "connection" | "config_change";

export interface McpAuditLogRecord {
  id: string;
  timestamp: string;
  keyId: string;
  keyLabel: string;
  toolName: string;
  toolLabel: string;
  argumentsSummary: string;
  argumentsRaw: Record<string, unknown>;
  resultSummary: string;
  status: "success" | "error";
  latencyMs: number;
  eventType?: McpAuditEventType;
  transport?: string;
  clientName?: string;
  clientIp?: string;
  responseBytes?: number;
  responsePreview?: string;
}

const MAX_CONCURRENT_AUDIT_WRITES = 3;
const MAX_QUEUED_AUDIT_WRITES = 500;
const PRUNE_EVERY_N_WRITES = 100;
const MAX_RETAINED_AUDIT_ROWS_PER_TENANT = 2000;

const schemaEnsuredByClient = new WeakMap<object, Promise<void>>();
const writeCountByTenant = new Map<string, number>();

interface QueuedAuditTask {
  tenantId: "tecfag" | "valem";
  entry: McpAuditLogRecord;
  sqlClient: any;
}

const auditQueue: QueuedAuditTask[] = [];
let activeAuditWrites = 0;
let droppedAuditWrites = 0;
const flushWaiters: Array<() => void> = [];

function resolveFlushWaitersIfIdle(): void {
  if (activeAuditWrites === 0 && auditQueue.length === 0 && flushWaiters.length > 0) {
    const waiters = flushWaiters.splice(0, flushWaiters.length);
    for (const resolve of waiters) {
      resolve();
    }
  }
}

export function ensureMcpAuditLogsSchema(sqlClient: any = defaultSqlClient): Promise<void> {
  const key = (sqlClient && typeof sqlClient === "object" ? sqlClient : defaultSqlClient) as object;
  let existing = schemaEnsuredByClient.get(key);
  if (!existing) {
    existing = (async () => {
      await sqlClient`
        CREATE TABLE IF NOT EXISTS mcp_audit_logs (
          id text PRIMARY KEY,
          tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          key_id text NOT NULL DEFAULT 'primary',
          key_label text NOT NULL DEFAULT 'Link Principal',
          tool_name text NOT NULL,
          tool_label text NOT NULL,
          arguments_summary text NOT NULL DEFAULT '',
          arguments_raw jsonb NOT NULL DEFAULT '{}'::jsonb,
          result_summary text NOT NULL DEFAULT '',
          status text NOT NULL DEFAULT 'success',
          latency_ms integer NOT NULL DEFAULT 0,
          event_type text NOT NULL DEFAULT 'query',
          transport text,
          client_name text,
          client_ip text,
          response_bytes integer,
          response_preview text,
          created_at timestamp NOT NULL DEFAULT now()
        )
      `;
      await sqlClient`
        CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_tenant_created
          ON mcp_audit_logs (tenant_id, created_at DESC)
      `;
      await sqlClient`
        CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_tenant_key_created
          ON mcp_audit_logs (tenant_id, key_id, created_at DESC)
      `;
    })().catch((err) => {
      schemaEnsuredByClient.delete(key);
      throw err;
    });
    schemaEnsuredByClient.set(key, existing);
  }
  return existing;
}

export async function insertMcpAuditLogRow(
  tenantId: "tecfag" | "valem",
  entry: McpAuditLogRecord,
  sqlClient: any = defaultSqlClient,
): Promise<void> {
  await ensureMcpAuditLogsSchema(sqlClient);
  const argsJson = JSON.stringify(entry.argumentsRaw || {});
  const createdAtIso = entry.timestamp || new Date().toISOString();
  const latencyInt = Math.max(0, Math.round(Number(entry.latencyMs || 0)));
  const responseBytesInt =
    typeof entry.responseBytes === "number" && Number.isFinite(entry.responseBytes)
      ? Math.max(0, Math.round(entry.responseBytes))
      : null;

  await sqlClient`
    INSERT INTO mcp_audit_logs (
      id,
      tenant_id,
      key_id,
      key_label,
      tool_name,
      tool_label,
      arguments_summary,
      arguments_raw,
      result_summary,
      status,
      latency_ms,
      event_type,
      transport,
      client_name,
      client_ip,
      response_bytes,
      response_preview,
      created_at
    )
    VALUES (
      ${entry.id},
      ${tenantId},
      ${entry.keyId || "primary"},
      ${entry.keyLabel || "Link Principal"},
      ${entry.toolName},
      ${entry.toolLabel || entry.toolName},
      ${entry.argumentsSummary || ""},
      ${argsJson}::jsonb,
      ${entry.resultSummary || ""},
      ${entry.status === "error" ? "error" : "success"},
      ${latencyInt},
      ${entry.eventType || "query"},
      ${entry.transport ?? null},
      ${entry.clientName ?? null},
      ${entry.clientIp ?? null},
      ${responseBytesInt},
      ${entry.responsePreview ?? null},
      ${createdAtIso}::timestamp
    )
    ON CONFLICT (id) DO NOTHING
  `;

  const count = (writeCountByTenant.get(tenantId) || 0) + 1;
  writeCountByTenant.set(tenantId, count);
  if (count % PRUNE_EVERY_N_WRITES === 0) {
    try {
      await sqlClient`
        DELETE FROM mcp_audit_logs
        WHERE tenant_id = ${tenantId}
          AND id IN (
            SELECT id FROM mcp_audit_logs
            WHERE tenant_id = ${tenantId}
            ORDER BY created_at DESC, id DESC
            OFFSET ${MAX_RETAINED_AUDIT_ROWS_PER_TENANT}
          )
      `;
    } catch {
      // Prune silencioso — nunca interrompe fluxo
    }
  }
}

function drainAuditQueue(): void {
  while (activeAuditWrites < MAX_CONCURRENT_AUDIT_WRITES && auditQueue.length > 0) {
    const task = auditQueue.shift()!;
    activeAuditWrites += 1;
    insertMcpAuditLogRow(task.tenantId, task.entry, task.sqlClient)
      .catch((err) => {
        console.error("[MCP Audit] Erro ao inserir log em mcp_audit_logs:", err);
      })
      .finally(() => {
        activeAuditWrites -= 1;
        drainAuditQueue();
        resolveFlushWaitersIfIdle();
      });
  }
  resolveFlushWaitersIfIdle();
}

export function enqueueMcpAuditLog(
  tenantId: "tecfag" | "valem",
  entry: McpAuditLogRecord,
  sqlClient: any = defaultSqlClient,
): void {
  if (auditQueue.length >= MAX_QUEUED_AUDIT_WRITES) {
    auditQueue.shift();
    droppedAuditWrites += 1;
  }
  auditQueue.push({ tenantId, entry, sqlClient });
  drainAuditQueue();
}

export function flushPendingMcpAuditLogs(): Promise<void> {
  if (activeAuditWrites === 0 && auditQueue.length === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    flushWaiters.push(resolve);
    drainAuditQueue();
  });
}

export async function listMcpAuditLogs(
  tenantId: "tecfag" | "valem",
  limit = 500,
  sqlClient: any = defaultSqlClient,
): Promise<McpAuditLogRecord[]> {
  await ensureMcpAuditLogsSchema(sqlClient);
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 500)));
  const rows = await sqlClient<Array<Record<string, any>>>`
    SELECT
      id,
      key_id,
      key_label,
      tool_name,
      tool_label,
      arguments_summary,
      arguments_raw,
      result_summary,
      status,
      latency_ms,
      event_type,
      transport,
      client_name,
      client_ip,
      response_bytes,
      response_preview,
      created_at
    FROM mcp_audit_logs
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${safeLimit}
  `;

  return rows.map((r: any) => {
    let parsedArgs: Record<string, unknown> = {};
    if (r.arguments_raw && typeof r.arguments_raw === "object" && !Array.isArray(r.arguments_raw)) {
      parsedArgs = r.arguments_raw as Record<string, unknown>;
    } else if (typeof r.arguments_raw === "string") {
      try {
        const tmp = JSON.parse(r.arguments_raw);
        if (tmp && typeof tmp === "object" && !Array.isArray(tmp)) {
          parsedArgs = tmp as Record<string, unknown>;
        }
      } catch {
        parsedArgs = {};
      }
    }

    const createdAt =
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : typeof r.created_at === "string"
          ? r.created_at
          : new Date().toISOString();

    const rawEventType = String(r.event_type || "query");
    const eventType: McpAuditEventType =
      rawEventType === "action" ||
      rawEventType === "connection" ||
      rawEventType === "config_change"
        ? rawEventType
        : "query";

    return {
      id: String(r.id),
      timestamp: createdAt,
      keyId: String(r.key_id || "primary"),
      keyLabel: String(r.key_label || "Link Principal"),
      toolName: String(r.tool_name || ""),
      toolLabel: String(r.tool_label || r.tool_name || ""),
      argumentsSummary: String(r.arguments_summary || "Consulta geral"),
      argumentsRaw: parsedArgs,
      resultSummary: String(r.result_summary || ""),
      status: r.status === "error" ? ("error" as const) : ("success" as const),
      latencyMs: Number(r.latency_ms || 0),
      eventType,
      transport: typeof r.transport === "string" ? r.transport : undefined,
      clientName: typeof r.client_name === "string" ? r.client_name : undefined,
      clientIp: typeof r.client_ip === "string" ? r.client_ip : undefined,
      responseBytes: typeof r.response_bytes === "number" ? r.response_bytes : undefined,
      responsePreview: typeof r.response_preview === "string" ? r.response_preview : undefined,
    };
  });
}

export async function clearMcpAuditLogs(
  tenantId: "tecfag" | "valem",
  sqlClient: any = defaultSqlClient,
): Promise<void> {
  await ensureMcpAuditLogsSchema(sqlClient);
  await sqlClient`
    DELETE FROM mcp_audit_logs
    WHERE tenant_id = ${tenantId}
  `;
}

export function getMcpAuditQueueStats(): {
  queued: number;
  inFlight: number;
  dropped: number;
  maxConcurrent: number;
  maxQueue: number;
} {
  return {
    queued: auditQueue.length,
    inFlight: activeAuditWrites,
    dropped: droppedAuditWrites,
    maxConcurrent: MAX_CONCURRENT_AUDIT_WRITES,
    maxQueue: MAX_QUEUED_AUDIT_WRITES,
  };
}
