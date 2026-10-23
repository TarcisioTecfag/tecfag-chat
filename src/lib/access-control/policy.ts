import { z } from "zod";
import { ACCESS_ACTIONS, ACCESS_MODULES, ACTION_IDS } from "./catalog.ts";
import type { AccessAction } from "./catalog.ts";

const id = z.string().trim().min(1).max(160).refine((value) => !["__proto__", "constructor", "prototype", "*"].includes(value));
const ids = z.array(id).max(500).refine((values) => new Set(values).size === values.length, "Itens duplicados.");
export const accessGrantSchema = z.object({
  id,
  action: z.enum(ACTION_IDS),
  scope: z.enum(["own", "author", "wallet", "team", "shared", "unassigned", "all"]),
  pipelineIds: ids.optional(), sectorIds: ids.optional(), channels: z.array(z.enum(["whatsapp", "instagram", "messenger", "livechat"])).max(4).optional(),
  queues: z.array(z.enum(["meus", "fila", "automacao", "finalizados"])).max(4).optional(),
  readFields: ids.default([]), writeFields: ids.default([]), expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict();
const modules = Object.fromEntries(ACCESS_MODULES.map((name) => [name, z.boolean()])) as Record<typeof ACCESS_MODULES[number], z.ZodBoolean>;
export const accessPolicySchema = z.object({
  version: z.literal(2), tenantId: id, revision: z.number().int().positive(),
  modules: z.object(modules).strict(), grants: z.array(accessGrantSchema).max(500),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.grants.map((grant) => grant.id)).size !== value.grants.length) ctx.addIssue({ code: "custom", path: ["grants"], message: "Regras com IDs duplicados." });
});
export type AccessPolicy = z.infer<typeof accessPolicySchema>;
export type AccessGrant = z.infer<typeof accessGrantSchema>;

/** All subject/resource attributes must be resolved by the server, never from request authority. */
export interface AccessSubject {
  id: string; tenantId: string; role: string;
  teamOperatorIds?: readonly string[]; isTenantOwner?: boolean;
}
export interface ResourceContext {
  id: string; tenantId: string; resource: typeof ACCESS_ACTIONS[AccessAction]["resource"];
  ownerId?: string | null; authorId?: string | null; walletOperatorId?: string | null;
  pipelineId?: string | null; sectorId?: string | null; channel?: string | null; queue?: string | null;
  sharedActions?: Readonly<Record<string, readonly AccessAction[]>>;
}
export interface AccessRequest {
  action: AccessAction; resource: ResourceContext;
  fields?: readonly string[]; fieldOperation?: "read" | "write"; now?: Date;
}
export type AccessReason = "ALLOWED" | "POLICY_INVALID" | "TENANT_MISMATCH" | "MODULE_DISABLED" | "ADMIN_REQUIRED" | "OWNER_REQUIRED" | "RESOURCE_MISMATCH" | "NO_MATCHING_GRANT";
export interface AccessDecision { allowed: boolean; reason: AccessReason; revision: number; grantId?: string }

function matchesScope(subject: AccessSubject, grant: AccessGrant, resource: ResourceContext): boolean {
  switch (grant.scope) {
    case "own": return resource.ownerId === subject.id;
    case "author": return resource.authorId === subject.id;
    case "wallet": return resource.walletOperatorId === subject.id;
    case "team": return !!resource.ownerId && (subject.teamOperatorIds ?? []).includes(resource.ownerId);
    case "shared": return resource.sharedActions?.[subject.id]?.includes(grant.action) === true;
    case "unassigned": return resource.ownerId === null;
    case "all": return true;
    default: return false;
  }
}
function contains(allowed: readonly string[] | undefined, value: string | null | undefined): boolean {
  return allowed === undefined || (typeof value === "string" && allowed.includes(value));
}

/** No admin bypass. One whole grant must satisfy every dimension and requested field. */
export function evaluateAccess(subject: AccessSubject, policy: AccessPolicy, request: AccessRequest): AccessDecision {
  const parsed = accessPolicySchema.safeParse(policy);
  if (!parsed.success || !subject?.id?.trim()) return { allowed: false, reason: "POLICY_INVALID", revision: 0 };
  return evaluateValidatedAccess(subject, parsed.data, request);
}

function evaluateValidatedAccess(subject: AccessSubject, policy: AccessPolicy, request: AccessRequest): AccessDecision {
  const deny = (reason: AccessReason): AccessDecision => ({ allowed: false, reason, revision: policy?.revision ?? 0 });
  if (!policy || policy.version !== 2 || !policy.modules || !Array.isArray(policy.grants)) return deny("POLICY_INVALID");
  const action = Object.hasOwn(ACCESS_ACTIONS, request.action) ? ACCESS_ACTIONS[request.action] : undefined;
  if (!action) return deny("POLICY_INVALID");
  if (!subject.tenantId || policy.tenantId !== subject.tenantId || request.resource.tenantId !== subject.tenantId) return deny("TENANT_MISMATCH");
  if (policy.modules[action.module] !== true) return deny("MODULE_DISABLED");
  if (action.administrative && subject.role !== "admin") return deny("ADMIN_REQUIRED");
  if (request.action === "admin.access.assignOwner" && subject.isTenantOwner !== true) return deny("OWNER_REQUIRED");
  if (action.resource !== request.resource.resource) return deny("RESOURCE_MISMATCH");
  const now = (request.now ?? new Date()).getTime();
  if (!Number.isFinite(now)) return deny("POLICY_INVALID");
  for (const grant of policy.grants) {
    if (grant.action !== request.action) continue;
    if (grant.expiresAt && (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now)) continue;
    if (!matchesScope(subject, grant, request.resource)) continue;
    if (!contains(grant.pipelineIds, request.resource.pipelineId) || !contains(grant.sectorIds, request.resource.sectorId) ||
        !contains(grant.channels, request.resource.channel) || !contains(grant.queues, request.resource.queue)) continue;
    const fields = request.fieldOperation === "write" ? grant.writeFields : grant.readFields;
    if (request.fields?.length && !request.fields.every((field) => fields.includes(field))) continue;
    return { allowed: true, reason: "ALLOWED", revision: policy.revision, grantId: grant.id };
  }
  return deny("NO_MATCHING_GRANT");
}

/** DTO projection uses explicit field grants; a resource-read permission does not expose every key. */
export function projectReadableFields<T extends Record<string, unknown>>(
  subject: AccessSubject, policy: AccessPolicy, request: Omit<AccessRequest, "fields" | "fieldOperation">, data: T,
): Partial<T> {
  const parsed = accessPolicySchema.safeParse(policy);
  if (!parsed.success || !subject?.id?.trim()) return {};
  return Object.fromEntries(Object.entries(data).filter(([field]) => evaluateValidatedAccess(subject, parsed.data, {
    ...request, fields: [field], fieldOperation: "read",
  }).allowed)) as Partial<T>;
}
