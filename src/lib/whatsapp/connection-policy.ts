/** A null ID is the existing corporate connection; never substitute another connection. */
export const CORPORATE_CONNECTION = "corporate";

/** Messages from a linked device do not claim an attendance on behalf of its owner. */
export function personalAttendanceState(
  previous: { queueState: string; operatorId: string | null } | undefined,
  event: { historical: boolean; fromMe: boolean },
) {
  const keepClosed = previous?.queueState === "finalizados" && (event.historical || event.fromMe);
  const keepCapture = previous?.queueState === "meus" && !!previous.operatorId;
  return {
    queueState: keepCapture ? "meus" : keepClosed ? "finalizados" : "fila",
    operatorId: keepCapture || keepClosed ? (previous?.operatorId ?? null) : null,
  };
}

export function baileysStanzaId(externalId: string): string {
  return externalId.startsWith("baileys:")
    ? externalId.slice(externalId.lastIndexOf(":") + 1)
    : externalId;
}

export function multiConnectionEnabled(tenantId: string): boolean {
  return (process.env.WHATSAPP_MULTI_CONNECTION_TENANTS || "")
    .split(",")
    .map((s) => s.trim())
    .includes(tenantId);
}

export function connectionScope(tenantId: string, connectionId?: string | null): string {
  return JSON.stringify([tenantId, connectionId || null]);
}

export function baileysEventId(
  tenantId: string,
  connectionId: string | null | undefined,
  key: { id: string; remoteJid: string; fromMe?: boolean | null },
): string {
  // Keep the legacy ID stable so replays do not duplicate old history.
  if (!connectionId) return `baileys:${tenantId}:${key.id}`;
  return `baileys:${connectionScope(tenantId, connectionId)}:${key.remoteJid}:${key.fromMe ? "out" : "in"}:${key.id}`;
}

export type ConnectionPrincipal = { tenantId: string; operator: { id: string; role?: string } };
export type ConnectionResource = { tenantId: string; ownerOperatorId: string | null };

export function ownsConnection(
  session: ConnectionPrincipal,
  connection: ConnectionResource,
): boolean {
  return (
    connection.tenantId === session.tenantId &&
    (session.operator.role === "admin" || connection.ownerOperatorId === session.operator.id)
  );
}
