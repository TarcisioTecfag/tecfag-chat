import { sql } from "drizzle-orm";
import { db } from "../db";

const PRESENCE_THROTTLE_MS = 15_000;
const ONLINE_HEARTBEAT_WINDOW_MS = 90_000;
const MAX_CONTINUOUS_DELTA_SECONDS = 120;

const lastPresenceWriteByOperator = new Map<string, number>();
const activeSseConnectionsByOperator = new Map<string, number>();

function makeOperatorKey(tenantId: string, operatorId: string): string {
  return `${tenantId}:${operatorId}`;
}

export function getBrtDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function registerOperatorSseOpen(tenantId: string, operatorId: string): void {
  if (!tenantId || !operatorId) return;
  const key = makeOperatorKey(tenantId, operatorId);
  const current = activeSseConnectionsByOperator.get(key) ?? 0;
  activeSseConnectionsByOperator.set(key, current + 1);
}

export function registerOperatorSseClose(tenantId: string, operatorId: string): void {
  if (!tenantId || !operatorId) return;
  const key = makeOperatorKey(tenantId, operatorId);
  const current = activeSseConnectionsByOperator.get(key) ?? 0;
  if (current <= 1) {
    activeSseConnectionsByOperator.delete(key);
  } else {
    activeSseConnectionsByOperator.set(key, current - 1);
  }
}

export function clearOperatorSseConnections(tenantId: string, operatorId: string): void {
  if (!tenantId || !operatorId) return;
  activeSseConnectionsByOperator.delete(makeOperatorKey(tenantId, operatorId));
}

export function isOperatorSseConnected(tenantId: string, operatorId: string): boolean {
  if (!tenantId || !operatorId) return false;
  return (activeSseConnectionsByOperator.get(makeOperatorKey(tenantId, operatorId)) ?? 0) > 0;
}

export async function touchOperatorPresence(
  tenantId: string,
  operatorId: string,
  options?: { force?: boolean },
): Promise<void> {
  if (!tenantId || !operatorId) return;
  const key = makeOperatorKey(tenantId, operatorId);
  const nowMs = Date.now();
  const lastWriteMs = lastPresenceWriteByOperator.get(key) ?? 0;

  if (!options?.force && nowMs - lastWriteMs < PRESENCE_THROTTLE_MS) {
    return;
  }
  lastPresenceWriteByOperator.set(key, nowMs);

  const nowIso = new Date(nowMs).toISOString();
  const todayBrt = getBrtDateKey(new Date(nowMs));

  try {
    await db.execute(sql`
      UPDATE operators
      SET
        usage_seconds_today = CASE
          WHEN usage_date = ${todayBrt} THEN
            COALESCE(usage_seconds_today, 0) + CASE
              WHEN last_seen_at IS NOT NULL
                   AND EXTRACT(EPOCH FROM (${nowIso}::timestamp - last_seen_at)) BETWEEN 1 AND ${MAX_CONTINUOUS_DELTA_SECONDS}
              THEN ROUND(EXTRACT(EPOCH FROM (${nowIso}::timestamp - last_seen_at)))::integer
              ELSE 0
            END
          ELSE 0
        END,
        usage_date = ${todayBrt},
        last_seen_at = ${nowIso}::timestamp,
        is_online = true
      WHERE tenant_id = ${tenantId}
        AND id = ${operatorId}
    `);
  } catch (err) {
    // Falha silenciosa para não impactar requisições autenticadas
    console.warn("[operator-presence] Falha ao atualizar presença:", (err as Error)?.message ?? err);
  }
}

export async function markOperatorOffline(tenantId: string, operatorId: string): Promise<void> {
  if (!tenantId || !operatorId) return;
  const key = makeOperatorKey(tenantId, operatorId);
  lastPresenceWriteByOperator.delete(key);
  activeSseConnectionsByOperator.delete(key);

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const todayBrt = getBrtDateKey(new Date(nowMs));

  try {
    await db.execute(sql`
      UPDATE operators
      SET
        usage_seconds_today = CASE
          WHEN usage_date = ${todayBrt} THEN
            COALESCE(usage_seconds_today, 0) + CASE
              WHEN last_seen_at IS NOT NULL
                   AND EXTRACT(EPOCH FROM (${nowIso}::timestamp - last_seen_at)) BETWEEN 1 AND ${MAX_CONTINUOUS_DELTA_SECONDS}
              THEN ROUND(EXTRACT(EPOCH FROM (${nowIso}::timestamp - last_seen_at)))::integer
              ELSE 0
            END
          ELSE 0
        END,
        usage_date = ${todayBrt},
        last_seen_at = ${nowIso}::timestamp,
        is_online = false
      WHERE tenant_id = ${tenantId}
        AND id = ${operatorId}
    `);
  } catch (err) {
    console.warn("[operator-presence] Falha ao marcar operador offline:", (err as Error)?.message ?? err);
  }
}

export function computeOperatorPresenceSnapshot(
  op: {
    id: string;
    isOnline?: boolean | null;
    lastSeenAt?: Date | string | null;
    usageDate?: string | null;
    usageSecondsToday?: number | null;
  },
  tenantId: string,
  currentViewerOperatorId?: string | null,
): {
  isOnline: boolean;
  lastSeenAt: string | null;
  usageSecondsToday: number;
} {
  const nowMs = Date.now();
  const todayBrt = getBrtDateKey(new Date(nowMs));
  const parsedLastSeen =
    op.lastSeenAt instanceof Date
      ? op.lastSeenAt
      : typeof op.lastSeenAt === "string" && op.lastSeenAt
        ? new Date(op.lastSeenAt)
        : null;
  const validLastSeen =
    parsedLastSeen && !Number.isNaN(parsedLastSeen.getTime()) ? parsedLastSeen : null;

  const isSelf = Boolean(currentViewerOperatorId && op.id === currentViewerOperatorId);
  const sseConnected = isOperatorSseConnected(tenantId, op.id);
  const hasRecentHeartbeat = Boolean(
    validLastSeen && nowMs - validLastSeen.getTime() <= ONLINE_HEARTBEAT_WINDOW_MS,
  );

  const isOnline = Boolean(
    isSelf || sseConnected || (op.isOnline !== false && hasRecentHeartbeat),
  );

  const baseSeconds =
    op.usageDate === todayBrt ? Math.max(0, Number(op.usageSecondsToday ?? 0)) : 0;

  // Se o operador estiver online agora e o último heartbeat foi há poucos segundos hoje,
  // soma a fração em aberto para exibir o contador sempre atualizado em tempo real.
  const inFlightDelta =
    isOnline &&
    op.usageDate === todayBrt &&
    validLastSeen &&
    nowMs > validLastSeen.getTime() &&
    nowMs - validLastSeen.getTime() <= MAX_CONTINUOUS_DELTA_SECONDS * 1000
      ? Math.round((nowMs - validLastSeen.getTime()) / 1000)
      : 0;

  return {
    isOnline,
    lastSeenAt: isSelf
      ? new Date(nowMs).toISOString()
      : validLastSeen
        ? validLastSeen.toISOString()
        : null,
    usageSecondsToday: baseSeconds + inFlightDelta,
  };
}
