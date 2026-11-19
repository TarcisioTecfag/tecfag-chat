import crypto from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../../db";
import { mcpIdempotencyRecords } from "../../db/schema";

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias
let ensurePromise: Promise<void> | null = null;

export function ensureMcpIdempotencySchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS mcp_idempotency_records (
          id text PRIMARY KEY,
          tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          tool_name text NOT NULL,
          idempotency_key text NOT NULL,
          request_hash text,
          response_json jsonb NOT NULL,
          created_at timestamp NOT NULL DEFAULT now(),
          expires_at timestamp NOT NULL
        );
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_idempotency_tenant_tool_key_uniq
          ON mcp_idempotency_records (tenant_id, tool_name, idempotency_key);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_mcp_idempotency_expires_at
          ON mcp_idempotency_records (expires_at);
      `);
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

export function hashIdempotencyPayload(payload: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload ?? {}))
    .digest("hex");
}

export async function lookupMcpIdempotency(
  tenantId: string,
  toolName: string,
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  const key = idempotencyKey.trim();
  if (!key) return null;
  await ensureMcpIdempotencySchema();

  const [row] = await db
    .select({ responseJson: mcpIdempotencyRecords.responseJson })
    .from(mcpIdempotencyRecords)
    .where(
      and(
        eq(mcpIdempotencyRecords.tenantId, tenantId),
        eq(mcpIdempotencyRecords.toolName, toolName),
        eq(mcpIdempotencyRecords.idempotencyKey, key),
        gt(mcpIdempotencyRecords.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row?.responseJson || typeof row.responseJson !== "object") return null;
  return row.responseJson as Record<string, unknown>;
}

export async function saveMcpIdempotency(
  tenantId: string,
  toolName: string,
  idempotencyKey: string,
  responseJson: Record<string, unknown>,
  requestHash?: string | null,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  const key = idempotencyKey.trim();
  if (!key) return;
  await ensureMcpIdempotencySchema();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db
    .insert(mcpIdempotencyRecords)
    .values({
      id: `idemp-${crypto.randomUUID()}`,
      tenantId,
      toolName,
      idempotencyKey: key,
      requestHash: requestHash ?? null,
      responseJson,
      createdAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [
        mcpIdempotencyRecords.tenantId,
        mcpIdempotencyRecords.toolName,
        mcpIdempotencyRecords.idempotencyKey,
      ],
      set: {
        responseJson,
        requestHash: requestHash ?? null,
        expiresAt,
      },
    });
}
