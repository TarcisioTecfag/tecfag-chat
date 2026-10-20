import { and, asc, eq, sql } from "drizzle-orm";
import { agentFlowStates, tenants } from "../../db/schema";
import type { IndustrialDatabase } from "./industrial-rodizio-store";
import type {
  createIndustrialHandoffStore,
  IndustrialFlowKey,
  IndustrialStoredResult,
} from "./industrial-handoff-store";

/** Recupera só checkpoints industriais prontos. Não refaz classificação nem envia mensagens ao cliente. */
export async function recoverIndustrialHandoffs(params: {
  database: IndustrialDatabase;
  store: ReturnType<typeof createIndustrialHandoffStore>;
  isIndustrialTenant: (tenantId: string) => boolean;
  onCommitted?: (key: IndustrialFlowKey, result: IndustrialStoredResult) => Promise<void>;
}) {
  const tenantRows = await params.database.select({ id: tenants.id }).from(tenants);
  let recovered = 0;
  for (const tenant of tenantRows) {
    if (!params.isIndustrialTenant(tenant.id)) continue;
    const flows = await params.database
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenant.id),
          eq(agentFlowStates.agentType, "sdr"),
          eq(agentFlowStates.outcome, "in_progress"),
          sql`${agentFlowStates.metadata}->'handoffRequest' IS NOT NULL`,
          sql`${agentFlowStates.metadata}->'handoffReceipt' IS NULL`,
          // Comparação textual ISO evita cast de JSON antigo/malformado a timestamp.
          sql`coalesce(${agentFlowStates.metadata}->>'handoffNextAttemptAt', '') <= ${new Date().toISOString()}`,
        ),
      )
      .orderBy(asc(agentFlowStates.lastInteractionAt))
      .limit(20);
    for (const flow of flows) {
      const key = {
        tenantId: tenant.id,
        conversationId: flow.conversationId,
        flowId: flow.id,
        cycle: flow.startedAt.toISOString(),
      };
      const result = await params.store.execute(key, { recovery: true });
      if (
        result.replayed ||
        result.superseded ||
        !["transferred", "resolved"].includes(result.status)
      )
        continue;
      recovered++;
      // Commit já concluído; falhas de atualização visual não repetem a distribuição.
      try {
        await params.onCommitted?.(key, result);
      } catch {
        console.error("[IndustrialRecovery] Atribuição concluída; falha ao notificar interface.");
      }
    }
  }
  return recovered;
}
