import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/** Explicit, read-only backup of access settings. Never imported by application startup. */
export async function captureAccessSnapshot(sql, tenantId) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(tenantId)) throw new Error("Tenant inválido.");
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    const columns = await tx`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='access_groups' AND column_name='permissions'`;
    const hasGranularPermissions = columns.length > 0;
    const groups = hasGranularPermissions ? await tx`SELECT id, tenant_id AS "tenantId", name,
      allowed_tenants AS "allowedTenants", allowed_channels AS "allowedChannels",
      can_create_user AS "canCreateUser", can_reset_password AS "canResetPassword",
      can_edit_profile AS "canEditProfile", can_capture_chat AS "canCaptureChat",
      can_transfer_chat AS "canTransferChat", can_finish_chat AS "canFinishChat",
      can_view_all_chats AS "canViewAllChats", can_override_chat AS "canOverrideChat",
      permissions, created_at AS "createdAt" FROM access_groups WHERE tenant_id = ${tenantId} ORDER BY id`
      : await tx`SELECT id, tenant_id AS "tenantId", name,
      allowed_tenants AS "allowedTenants", allowed_channels AS "allowedChannels",
      can_create_user AS "canCreateUser", can_reset_password AS "canResetPassword",
      can_edit_profile AS "canEditProfile", can_capture_chat AS "canCaptureChat",
      can_transfer_chat AS "canTransferChat", can_finish_chat AS "canFinishChat",
      can_view_all_chats AS "canViewAllChats", can_override_chat AS "canOverrideChat",
      created_at AS "createdAt" FROM access_groups WHERE tenant_id = ${tenantId} ORDER BY id`;
    // Membership recovery does not need names, emails, password hashes or tokens.
    const members = await tx`SELECT id, tenant_id AS "tenantId", role, group_id AS "groupId"
      FROM operators WHERE tenant_id = ${tenantId} ORDER BY id`;
    const sectors = await tx`SELECT id, tenant_id AS "tenantId", name, operator_ids AS "operatorIds"
      FROM sectors WHERE tenant_id = ${tenantId} ORDER BY id`;
    const groupIds = new Set(groups.map((group) => group.id));
    const orphanIds = members.filter((member) => !member.groupId || !groupIds.has(member.groupId)).map((member) => member.id);
    const payload = { tenantId, groups: [...groups], members: [...members], sectors: [...sectors] };
    return {
      format: "access-control-snapshot", version: 1, capturedAt: new Date().toISOString(),
      schemaCapabilities: { granularPermissions: hasGranularPermissions },
      sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      ...payload, review: { orphanOperatorIds: orphanIds, groupsWithoutGranularPermissions: groups.filter((g) =>
        !g.permissions?.views && !g.permissions?.chat).map((g) => g.id) },
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Uso: node --env-file=.env scripts/access-control-snapshot.mjs --tenant=<id> --output=<caminho-privado-fora-do-repositorio.json>");
    console.log("Somente leitura; arquivo novo, sem sobrescrever. Credenciais não são exportadas.");
    return;
  }
  const tenantId = args.find((arg) => arg.startsWith("--tenant="))?.slice(9);
  const output = args.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (!tenantId || !output) throw new Error("Informe --tenant e --output explicitamente. Use --help.");
  const absolute = path.resolve(output), repository = path.resolve(import.meta.dirname, "..");
  const relative = path.relative(repository, absolute);
  if (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) throw new Error("Grave o backup em uma pasta privada fora do repositório.");
  const connection = process.env.ACCESS_SNAPSHOT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connection) throw new Error("Conexão de leitura não configurada.");
  const { default: postgres } = await import("postgres");
  const sql = postgres(connection, { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 2 });
  try {
    const snapshot = await captureAccessSnapshot(sql, tenantId);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ file: absolute, tenantId, groups: snapshot.groups.length, members: snapshot.members.length, sha256: snapshot.sha256 }));
  } finally { await sql.end({ timeout: 5 }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    const code = error?.code || error?.cause?.code || error?.errors?.[0]?.code || "SNAPSHOT_FAILED";
    console.error(`Não foi possível gerar o backup de acessos (${code}). Confira conexão e destino privado; o arquivo existente nunca é substituído.`);
    process.exitCode = 1;
  });
}
