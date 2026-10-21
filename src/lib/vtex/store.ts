import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { agentConfigs } from "../../db/schema";
import type { IndustrialDatabase, IndustrialTransaction } from "../triage/industrial-rodizio-store";
import { VTEX_AGENT, defaultVtexSettings, vtexSettingsSchema, type VtexSettings } from "./contract";
import { decryptVtexCredentials, encryptVtexCredentials, vtexEncryptionReady } from "./crypto";
export class VtexConfigError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const vtexSaveSchema = z
  .object({
    action: z.literal("save"),
    expectedRevision: z.number().int().nonnegative(),
    settings: vtexSettingsSchema,
    appKey: z
      .string()
      .trim()
      .max(500)
      .refine((value) => !/\p{Cc}/u.test(value))
      .optional(),
    appToken: z
      .string()
      .trim()
      .max(4000)
      .refine((value) => !/\p{Cc}/u.test(value))
      .optional(),
    clearCredentials: z.boolean().optional(),
  })
  .strict();
export async function readVtexConfig(
  database: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
) {
  const rows = await database
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, VTEX_AGENT)));
  if (rows.length > 1)
    throw new VtexConfigError("Configuração VTEX duplicada; revisão necessária.", 409);
  const row = rows[0],
    raw = (row?.config || {}) as Record<string, unknown>;
  if (row && (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1))
    throw new VtexConfigError("Revisão VTEX inválida.", 409);
  const parsed = row ? vtexSettingsSchema.safeParse(raw.settings) : null;
  if (row && !parsed?.success) throw new VtexConfigError("Configuração VTEX inválida.", 409);
  return {
    row,
    revision: row ? Number(raw.revision) : 0,
    settings: parsed?.success ? parsed.data : defaultVtexSettings(),
    credentialsEncrypted:
      typeof raw.credentialsEncrypted === "string" ? raw.credentialsEncrypted : null,
  };
}
export function publicVtexConfig(state: Awaited<ReturnType<typeof readVtexConfig>>) {
  return {
    revision: state.revision,
    settings: state.settings,
    hasCredentials: Boolean(state.credentialsEncrypted),
    encryptionReady: vtexEncryptionReady(),
  };
}
export function credentialsForVtex(
  tenantId: string,
  state: Awaited<ReturnType<typeof readVtexConfig>>,
  settings = state.settings,
) {
  if (!settings.useCredentials) return undefined;
  if (!state.credentialsEncrypted || settings.account !== state.settings.account)
    throw new VtexConfigError("Salve as credenciais desta conta antes de testar.");
  try {
    return decryptVtexCredentials(tenantId, settings.account, state.credentialsEncrypted);
  } catch {
    throw new VtexConfigError(
      "Credenciais indisponíveis. Confira a chave de criptografia e salve novamente.",
    );
  }
}
export async function saveVtexConfig(
  database: IndustrialDatabase,
  tenantId: string,
  input: unknown,
  operatorId: string,
) {
  const body = vtexSaveSchema.parse(input);
  if (Boolean(body.appKey) !== Boolean(body.appToken))
    throw new VtexConfigError("Informe AppKey e AppToken juntos.");
  if (body.clearCredentials && body.appKey)
    throw new VtexConfigError("Escolha substituir ou remover as credenciais.");
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('vtex-store-v1'))`,
    );
    const previous = await readVtexConfig(tx, tenantId);
    if (previous.revision !== body.expectedRevision)
      throw new VtexConfigError("A configuração mudou. Recarregue antes de salvar.", 409);
    let encrypted = body.clearCredentials ? null : previous.credentialsEncrypted;
    if (body.appKey && body.appToken) {
      if (!vtexEncryptionReady())
        throw new VtexConfigError(
          "Configure a chave de criptografia no servidor antes de salvar credenciais.",
        );
      encrypted = encryptVtexCredentials(tenantId, body.settings.account, {
        appKey: body.appKey,
        appToken: body.appToken,
      });
    } else if (encrypted && previous.settings.account !== body.settings.account) {
      throw new VtexConfigError(
        "Ao trocar a conta, substitua ou remova as credenciais anteriores.",
      );
    }
    if (body.settings.useCredentials && !encrypted)
      throw new VtexConfigError("Informe as credenciais ou use consultas públicas.");
    const config = {
      revision: previous.revision + 1,
      settings: body.settings,
      credentialsEncrypted: encrypted,
      updatedBy: operatorId,
    };
    if (previous.row) {
      await tx
        .update(agentConfigs)
        .set({ enabled: body.settings.enabled ? 1 : 0, config, updatedAt: new Date() })
        .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.id, previous.row.id)));
    } else {
      await tx.insert(agentConfigs).values({
        id: `cfg-vtex-${crypto.randomUUID()}`,
        tenantId,
        agentType: VTEX_AGENT,
        enabled: body.settings.enabled ? 1 : 0,
        config,
      });
    }
    return publicVtexConfig({
      ...previous,
      revision: config.revision,
      settings: body.settings,
      credentialsEncrypted: encrypted,
    });
  });
}
