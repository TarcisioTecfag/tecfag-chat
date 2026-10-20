import { and, asc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { agentConfigs, crmPipelines, crmStages, sectors } from "../../db/schema";
import {
  industrialSettingsSchema,
  emptyIndustrialSettings,
  INDUSTRIAL_SETTINGS_AGENT,
  type IndustrialSettings,
  type IndustrialDestination,
} from "./industrial-settings";
import type { IndustrialDatabase, IndustrialTransaction } from "./industrial-rodizio-store";

export class IndustrialSettingsError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function readIndustrialSettings(
  tx: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
  lock = false,
) {
  const query = tx
    .select()
    .from(agentConfigs)
    .where(
      and(
        eq(agentConfigs.tenantId, tenantId),
        eq(agentConfigs.agentType, INDUSTRIAL_SETTINGS_AGENT),
      ),
    );
  const rows = lock ? await query.for("share") : await query;
  if (rows.length > 1)
    throw new IndustrialSettingsError(
      "Configuração de triagem duplicada; revisão administrativa necessária",
      409,
    );
  const row = rows[0];
  if (
    row &&
    (!Number.isSafeInteger((row.config as Record<string, unknown>)?.revision) ||
      Number((row.config as Record<string, unknown>).revision) < 1)
  )
    throw new IndustrialSettingsError("Revisão da configuração industrial inválida", 409);
  const parsed = row
    ? industrialSettingsSchema.safeParse((row.config as Record<string, unknown>)?.settings)
    : null;
  if (row && !parsed?.success)
    throw new IndustrialSettingsError(
      "Configuração industrial inválida; revise antes de encaminhar",
      409,
    );
  const settings = parsed?.success ? parsed.data : emptyIndustrialSettings();
  const catalogFingerprint = createHash("sha256")
    .update(
      JSON.stringify({ catalog: settings.catalog, blockedFamilies: settings.blockedFamilies }),
    )
    .digest("hex");
  return {
    row,
    revision: row ? Number((row.config as Record<string, unknown>).revision) : 0,
    settings,
    catalogFingerprint,
  };
}
export async function validateIndustrialDestination(
  tx: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
  destination: IndustrialDestination,
) {
  const [sector] = await tx
    .select()
    .from(sectors)
    .where(and(eq(sectors.tenantId, tenantId), eq(sectors.id, destination.sectorId)))
    .for("share");
  if (!sector)
    throw new IndustrialSettingsError("Setor de destino não pertence à empresa ou foi removido");
  if (destination.pipelineId || destination.stageId) {
    const [pipeline] = await tx
      .select()
      .from(crmPipelines)
      .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, destination.pipelineId!)))
      .for("share");
    const [stage] = await tx
      .select()
      .from(crmStages)
      .where(
        and(
          eq(crmStages.tenantId, tenantId),
          eq(crmStages.id, destination.stageId!),
          eq(crmStages.pipelineId, destination.pipelineId!),
        ),
      )
      .for("share");
    if (!pipeline || !stage || stage.isWinStage || stage.isLossStage)
      throw new IndustrialSettingsError("Funil/etapa de entrada inválidos para esta empresa");
  }
  return sector;
}
export async function saveIndustrialSettings(
  database: IndustrialDatabase,
  tenantId: string,
  expectedRevision: number,
  input: unknown,
  operatorId: string,
) {
  const settings = industrialSettingsSchema.parse(input);
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('industrial-settings-v1'))`,
    );
    const current = await readIndustrialSettings(tx, tenantId);
    if (current.revision !== expectedRevision)
      throw new IndustrialSettingsError(
        "A configuração mudou em outra sessão. Recarregue antes de salvar.",
        409,
      );
    for (const destination of Object.values(settings.destinations))
      await validateIndustrialDestination(tx, tenantId, destination);
    const config = { settings, revision: current.revision + 1, updatedBy: operatorId };
    if (current.row)
      await tx
        .update(agentConfigs)
        .set({ config, updatedAt: new Date() })
        .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.id, current.row.id)));
    else
      await tx.insert(agentConfigs).values({
        id: `cfg-industrial-${crypto.randomUUID()}`,
        tenantId,
        agentType: INDUSTRIAL_SETTINGS_AGENT,
        enabled: 0,
        config,
      });
    return { revision: config.revision, settings };
  });
}
export async function industrialSettingsChoices(database: IndustrialDatabase, tenantId: string) {
  const [sectorRows, pipelineRows, stageRows] = await Promise.all([
    database
      .select({ id: sectors.id, name: sectors.name })
      .from(sectors)
      .where(eq(sectors.tenantId, tenantId))
      .orderBy(asc(sectors.name)),
    database
      .select({ id: crmPipelines.id, name: crmPipelines.name })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId))
      .orderBy(asc(crmPipelines.orderIndex)),
    database
      .select({
        id: crmStages.id,
        name: crmStages.name,
        pipelineId: crmStages.pipelineId,
        isWinStage: crmStages.isWinStage,
        isLossStage: crmStages.isLossStage,
      })
      .from(crmStages)
      .where(eq(crmStages.tenantId, tenantId))
      .orderBy(asc(crmStages.orderIndex)),
  ]);
  return {
    sectors: sectorRows,
    pipelines: pipelineRows,
    stages: stageRows.filter((stage) => !stage.isWinStage && !stage.isLossStage),
  };
}
