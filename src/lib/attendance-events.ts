import { sql } from "drizzle-orm";
import type { DealTransaction } from "./crm/deal-associations";

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
  await tx.execute(sql`SELECT record_attendance_event(
    ${input.tenantId}, ${input.conversationId}, ${input.sourceKey}, ${input.eventType},
    ${input.description}, ${input.actorName}, ${input.operatorId},
    ${JSON.stringify(input.metadata || {})}::jsonb
  )`);
}
