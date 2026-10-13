import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { rdMarketingLogs } from "../../db/schema";
import { buildRdDiagnostic, type RdDiagnostic } from "./diagnostics";
import type { FlowSettings } from "./mapping";

// Reutiliza o histórico existente, guardando somente amostras mascaradas e separadas da auditoria.
export async function recordRdDiagnostic(
  flow: { id: string; tenantId: string; settings: FlowSettings },
  payload: unknown,
) {
  const { tenantId } = flow;
  const message = JSON.stringify(buildRdDiagnostic(payload, flow.settings));
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${"rd-diagnostic:" + flow.id}))`,
      );
      await tx
        .insert(rdMarketingLogs)
        .values({ id: randomUUID(), tenantId, flowId: flow.id, status: "diagnostic", message });
      // Somente amostras desta integração/tenant: nunca remover os logs de criação ou erro.
      await tx.execute(sql`DELETE FROM rd_marketing_logs
        WHERE tenant_id = ${tenantId} AND flow_id = ${flow.id} AND status = 'diagnostic'
        AND id IN (SELECT id FROM rd_marketing_logs
          WHERE tenant_id = ${tenantId} AND flow_id = ${flow.id} AND status = 'diagnostic'
          ORDER BY created_at DESC, id DESC OFFSET 20)`);
    });
  } catch {
    console.error("[RD Marketing] Não foi possível guardar a amostra de diagnóstico.");
  }
}

export async function listRdDiagnostics(tenantId: string, flowId?: string) {
  const rows = await db
    .select({
      id: rdMarketingLogs.id,
      flowId: rdMarketingLogs.flowId,
      createdAt: rdMarketingLogs.createdAt,
      message: rdMarketingLogs.message,
    })
    .from(rdMarketingLogs)
    .where(
      and(
        eq(rdMarketingLogs.tenantId, tenantId),
        eq(rdMarketingLogs.status, "diagnostic"),
        flowId ? eq(rdMarketingLogs.flowId, flowId) : undefined,
      ),
    )
    .orderBy(desc(rdMarketingLogs.createdAt), desc(rdMarketingLogs.id))
    .limit(20);
  return rows.flatMap(({ message, ...row }) => {
    try {
      const diagnostic = JSON.parse(message) as RdDiagnostic;
      return diagnostic.version === 1 ? [{ ...row, diagnostic }] : [];
    } catch {
      return [];
    }
  });
}
