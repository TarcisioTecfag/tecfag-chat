import { ACCESS_ACTIONS, ACCESS_MODULES } from "./catalog.ts";
import { accessPolicySchema, evaluateAccess } from "./policy.ts";
import type { AccessGrant, AccessPolicy, AccessSubject } from "./policy.ts";
import { canonicalJson } from "./group-settings.ts";

function subset(child: readonly string[] | undefined, parent: readonly string[] | undefined): boolean {
  return parent === undefined || (child !== undefined && child.every((item) => parent.includes(item)));
}
function scopeCovered(parent: AccessGrant, child: AccessGrant, actor: AccessSubject, target: AccessSubject): boolean {
  if (parent.scope === "all") return true;
  if (parent.scope === "unassigned" && child.scope === "unassigned") return true;
  if (parent.scope === "team") {
    if (child.scope === "own") return (actor.teamOperatorIds ?? []).includes(target.id);
    if (child.scope === "team") return subset(target.teamOperatorIds ?? [], actor.teamOperatorIds ?? []);
  }
  return actor.id === target.id && parent.scope === child.scope;
}
function coveredBy(parent: AccessGrant, child: AccessGrant, actor: AccessSubject, target: AccessSubject, now: Date): boolean {
  if (parent.action !== child.action || !scopeCovered(parent, child, actor, target)) return false;
  if (parent.expiresAt && (Date.parse(parent.expiresAt) <= now.getTime() || !child.expiresAt || Date.parse(child.expiresAt) > Date.parse(parent.expiresAt))) return false;
  return subset(child.pipelineIds, parent.pipelineIds) && subset(child.sectorIds, parent.sectorIds) &&
    subset(child.channels, parent.channels) && subset(child.queues, parent.queues) &&
    subset(child.readFields, parent.readFields) && subset(child.writeFields, parent.writeFields);
}

/** Validate a proposed assignment for one server-resolved target. Persist only inside a locked, audited transaction. */
export function validatePolicyDelegation(input: {
  actor: AccessSubject; target: AccessSubject; actorPolicy: AccessPolicy;
  currentPolicy: AccessPolicy; proposedPolicy: AccessPolicy; now?: Date;
}): { allowed: boolean; reason: string; action?: string } {
  const { actor, target } = input, now = input.now ?? new Date();
  const policies = [input.actorPolicy, input.currentPolicy, input.proposedPolicy].map((policy) => accessPolicySchema.safeParse(policy));
  if (!Number.isFinite(now.getTime()) || policies.some((policy) => !policy.success)) return { allowed: false, reason: "POLICY_INVALID" };
  const [actorPolicy, current, proposed] = policies.map((policy) => policy.data!) as AccessPolicy[];
  if (actor.tenantId !== target.tenantId || [actorPolicy, current, proposed].some((policy) => policy.tenantId !== actor.tenantId)) {
    return { allowed: false, reason: "TENANT_MISMATCH" };
  }
  const delegate = evaluateAccess(actor, actorPolicy, { action: "admin.access.delegate", now,
    resource: { id: actor.tenantId, tenantId: actor.tenantId, resource: "configuration" } });
  if (!delegate.allowed) return { allowed: false, reason: "DELEGATION_FORBIDDEN" };
  for (const module of ACCESS_MODULES) {
    if (proposed.modules[module] && !current.modules[module] && !actorPolicy.modules[module]) return { allowed: false, reason: "MODULE_OUTSIDE_AUTHORITY" };
  }
  for (const grant of proposed.grants) {
    const spec = ACCESS_ACTIONS[grant.action];
    if (!proposed.modules[spec.module]) continue;
    // Existing, active rules may remain byte-equivalent; enabling a dormant module is a new grant.
    if (current.modules[spec.module] && current.grants.some((old) => canonicalJson(old) === canonicalJson(grant))) continue;
    if (grant.action === "admin.access.assignOwner") return { allowed: false, reason: "OWNER_ASSIGNMENT_SEPARATE", action: grant.action };
    if (spec.administrative && target.role !== "admin") return { allowed: false, reason: "TARGET_ADMIN_REQUIRED", action: grant.action };
    if (!actorPolicy.modules[spec.module] || !actorPolicy.grants.some((parent) => coveredBy(parent, grant, actor, target, now))) {
      return { allowed: false, reason: "GRANT_OUTSIDE_AUTHORITY", action: grant.action };
    }
  }
  return { allowed: true, reason: "WITHIN_DELEGATION_BOUNDARY" };
}
