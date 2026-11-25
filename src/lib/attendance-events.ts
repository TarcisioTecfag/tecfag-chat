import { sql } from "drizzle-orm";
import type { DealTransaction } from "./crm/deal-associations";
import { resolveAuditOrigin } from "./audit/audit-context";

export async function setAttendanceActor(
  tx: DealTransaction,
  tenantId: string,
  name: string,
  operatorId: string | null,
) {
  await tx.execute(
    sql`SELECT set_config('attendance.actor', ${JSON.stringify({ tenantId, name, operatorId })}, true)`,
  );
}

/** Usar dentro da transação da ação; o banco resolve e preserva o card atual. */
export async function recordAttendanceEvent(
  tx: DealTransaction,
  input: {
    tenantId: string;
    conversationId: string;
    sourceKey: string;
    eventType: string;
    description: string;
    actorName: string;
    operatorId: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const origin = resolveAuditOrigin({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    operatorName: input.actorName,
    metadata: input.metadata || null,
  });
  const enrichedMetadata: Record<string, unknown> = {
    ...(input.metadata || {}),
    actorType: origin.actorType,
    sourceChannel: origin.sourceChannel,
    actorName: origin.actorName,
    ...(origin.clientIp ? { clientIp: origin.clientIp } : {}),
    ...(origin.mcpKeyId ? { mcpKeyId: origin.mcpKeyId } : {}),
    ...(origin.mcpKeyLabel ? { mcpKeyLabel: origin.mcpKeyLabel } : {}),
  };

  await tx.execute(sql`SELECT record_attendance_event(
    ${input.tenantId}, ${input.conversationId}, ${input.sourceKey}, ${input.eventType},
    ${input.description}, ${origin.actorName || input.actorName}, ${origin.actorOperatorId},
    ${JSON.stringify(enrichedMetadata)}::jsonb
  )`);
}
