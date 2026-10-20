import { and, eq, sql } from "drizzle-orm";
import { agentConfigs } from "../../db/schema";
import type { db } from "../../db";
import type { FlowOperator } from "../valentina/rodizio-types";

export type IndustrialDatabase = typeof db;
export type IndustrialTransaction = Parameters<Parameters<IndustrialDatabase["transaction"]>[0]>[0];
export type RodizioConfig = Record<string, unknown> & { flowOperators?: FlowOperator[] };

/** Mesmo lock em distribuição e administração, inclusive quando a configuração ainda não existe. */
export async function lockIndustrialRodizio(tx: IndustrialTransaction, tenantId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('industrial-rodizio-v1'))`,
  );
  const [row] = await tx
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "rodizio")))
    .for("update");
  return row;
}

export async function writeIndustrialRodizio(
  tx: IndustrialTransaction,
  tenantId: string,
  rowId: string,
  config: RodizioConfig,
) {
  const operatorsMap = { ...((config.operatorsMap || {}) as Record<string, unknown>) };
  for (const op of config.flowOperators || []) {
    operatorsMap[op.id] = {
      operatorId: op.id,
      isParticipating: op.isParticipating,
      isOnLeave: op.isOnLeave,
      isPenalized: Boolean(op.isPenalized),
      leadsReceivedCount: op.leadsReceivedCount,
      recentLeads: op.recentLeads || [],
    };
  }
  await tx
    .update(agentConfigs)
    .set({ config: { ...config, operatorsMap }, updatedAt: new Date() })
    .where(and(eq(agentConfigs.id, rowId), eq(agentConfigs.tenantId, tenantId)));
}

/** Mutação lê o estado atual dentro do lock; snapshots antigos da UI não apagam contadores. */
export async function mutateIndustrialRodizio(
  database: IndustrialDatabase,
  tenantId: string,
  mutate: (ops: FlowOperator[], config: RodizioConfig) => FlowOperator[],
): Promise<FlowOperator[]> {
  return database.transaction(async (tx) => {
    const row = await lockIndustrialRodizio(tx, tenantId);
    const config = (row?.config || {}) as RodizioConfig;
    const next = mutate(Array.isArray(config.flowOperators) ? config.flowOperators : [], config);
    if (row) await writeIndustrialRodizio(tx, tenantId, row.id, { ...config, flowOperators: next });
    else
      await tx.insert(agentConfigs).values({
        id: `cfg-rodizio-${crypto.randomUUID()}`,
        tenantId,
        agentType: "rodizio",
        enabled: 0,
        config: { ...config, flowOperators: next },
      });
    return next;
  });
}

export function mergeIndustrialOperatorSettings(
  current: FlowOperator,
  patch: Partial<FlowOperator>,
): FlowOperator {
  return {
    ...current,
    ...patch,
    id: current.id,
    // Alterações de contagem e saldo usam ações explícitas calculadas sob lock.
    leadsReceivedCount: current.leadsReceivedCount,
    recentLeads: current.recentLeads,
    compensation: current.compensation,
  };
}
