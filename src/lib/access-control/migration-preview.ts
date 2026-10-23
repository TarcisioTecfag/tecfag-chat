import { createHash } from "node:crypto";
import { ACCESS_ACTIONS, ACCESS_MODULES } from "./catalog.ts";
import { accessPolicySchema } from "./policy.ts";
import { isPlainRecord, resolvePermissionAliases } from "./group-settings.ts";
import type { AccessGrant } from "./policy.ts";
import { CONVERSATION_QUEUES, QUEUE_PERMISSION } from "./conversation-policy.ts";

export interface AccessSnapshot {
  format: string; version: number; tenantId: string; sha256: string;
  schemaCapabilities?: { granularPermissions: boolean };
  groups: Array<Record<string, any>>; members: Array<Record<string, any>>; sectors: Array<Record<string, any>>;
}
const legacyFlags: Record<string, string> = {
  "chat.canCaptureChat": "canCaptureChat", "chat.canTransferChat": "canTransferChat",
  "chat.canFinishChat": "canFinishChat", "chat.canOverrideChat": "canOverrideChat",
  "security.canManageUsers": "canCreateUser", "security.canResetUserPasswords": "canResetPassword",
};

/** Offline proposal only. Never normalizes defaults, assigns members or writes to the database. */
export function previewAccessMigration(snapshot: AccessSnapshot) {
  if (!snapshot || snapshot.format !== "access-control-snapshot" || snapshot.version !== 1 ||
      !snapshot.tenantId || !Array.isArray(snapshot.groups) || !Array.isArray(snapshot.members) || !Array.isArray(snapshot.sectors)) {
    throw new Error("Formato de backup inválido.");
  }
  const { tenantId, groups, members, sectors } = snapshot;
  const payload = { tenantId, groups, members, sectors };
  const sha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (sha256 !== snapshot.sha256) throw new Error("Integridade do backup inválida.");
  for (const row of [...groups, ...members, ...sectors]) {
    if (!row || row.tenantId !== tenantId || typeof row.id !== "string" || !row.id) throw new Error("Registro de outro tenant ou sem identidade.");
  }
  for (const rows of [groups, members, sectors]) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("IDs duplicados no backup.");
  }
  const groupIds = new Set(groups.map((row) => row.id));
  const pendingMemberships = members.filter((row) => !row.groupId || !groupIds.has(row.groupId))
    .map((row) => ({ operatorId: row.id, role: row.role, previousGroupId: row.groupId ?? null, proposedGroupId: null }));
  const proposals = groups.map((group) => {
    const raw = resolvePermissionAliases(isPlainRecord(group.permissions) ? group.permissions : {});
    const explicit = (path: string): boolean | undefined => {
      const [category, key] = path.split(".");
      if (isPlainRecord(raw[category]) && Object.hasOwn(raw[category], key)) {
        return typeof raw[category][key] === "boolean" ? raw[category][key] : undefined;
      }
      const flag = legacyFlags[path];
      return flag && typeof group[flag] === "boolean" ? group[flag] : undefined;
    };
    const unresolvedModules = ACCESS_MODULES.filter((name) => explicit(`views.${name}`) === undefined);
    const modules = Object.fromEntries(ACCESS_MODULES.map((name) => [name, explicit(`views.${name}`) === true]));
    const grants: AccessGrant[] = [];
    const pendingActions: string[] = [];
    const channels = Array.isArray(group.allowedChannels) ? group.allowedChannels.filter((value: string) =>
      ["whatsapp", "instagram", "messenger", "livechat"].includes(value)) : [];
    for (const [action, spec] of Object.entries(ACCESS_ACTIONS)) {
      if (!spec.legacy || explicit(spec.legacy) === undefined) { pendingActions.push(action); continue; }
      if (explicit(spec.legacy) !== true || modules[spec.module] !== true) continue;
      // CRM and conversations require a separately reviewed scope. Broad booleans never imply team/global writes.
      const scope = spec.resource === "deal" || spec.resource === "conversation" ? "own"
        : spec.resource === "contact" ? "wallet" : "all";
      grants.push({ id: `legacy-${grants.length + 1}`, action: action as AccessGrant["action"], scope,
        ...(spec.resource === "conversation" ? { channels: channels as AccessGrant["channels"],
          queues: CONVERSATION_QUEUES.filter((queue) => raw.chat?.[QUEUE_PERMISSION[queue]] !== false) } : {}),
        readFields: [], writeFields: [] });
    }
    const candidate = accessPolicySchema.parse({ version: 2, tenantId, revision: 1, modules, grants });
    return {
      groupId: group.id, original: structuredClone(group), candidate,
      review: { unresolvedModules, pendingActions,
        scopeReviewRequired: true, fieldReviewRequired: true, administrativeBypassReviewRequired: true },
    };
  });
  return {
    format: "access-control-migration-preview", version: 1, tenantId, sourceSha256: sha256,
    activationAllowed: false,
    blockers: ["POLICY_AND_SCOPE_REVIEW_REQUIRED", "ROUTE_COVERAGE_REQUIRED", "EXPLICIT_OPERATIONAL_ACCEPTANCE_REQUIRED",
      ...(pendingMemberships.length ? ["UNMAPPED_MEMBERSHIPS"] : []),
      ...(snapshot.schemaCapabilities?.granularPermissions !== true ? ["GRANULAR_SCHEMA_MISSING"] : [])],
    groups: proposals, pendingMemberships,
    preservedMemberships: structuredClone(members), preservedSectors: structuredClone(sectors),
  };
}
