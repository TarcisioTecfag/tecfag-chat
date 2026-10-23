import test from "node:test";
import assert from "node:assert/strict";
import { loadAccessSource } from "./helpers/access-harness.mjs";
const { validatePolicyDelegation } = loadAccessSource("src/lib/access-control/delegation.ts");
const { ACCESS_MODULES } = loadAccessSource("src/lib/access-control/catalog.ts");
const grant = (patch = {}) => ({ id: "g", action: "crm.deals.read", scope: "all", readFields: [], writeFields: [], ...patch });
const policy = (grants = [], patch = {}) => ({ version: 2, tenantId: "tenant-a", revision: 1,
  modules: Object.fromEntries(ACCESS_MODULES.map((name) => [name, true])), grants, ...patch });
const actor = { id: "admin-a", tenantId: "tenant-a", role: "admin", teamOperatorIds: ["agent-b"] };
const target = { id: "agent-b", tenantId: "tenant-a", role: "agent", teamOperatorIds: [] };
const delegate = grant({ id: "delegate", action: "admin.access.delegate" });
const validate = (parent, child, patch = {}) => validatePolicyDelegation({ actor, target,
  actorPolicy: policy([delegate, ...parent]), currentPolicy: policy(), proposedPolicy: policy(child),
  now: new Date("2026-10-22T12:00:00Z"), ...patch });

test("explicit delegation capability is required even for admin", () => {
  assert.equal(validate([grant()], [grant()], { actorPolicy: policy([grant()]) }).reason, "DELEGATION_FORBIDDEN");
});
test("global authority can delegate a narrower scope", () => {
  assert.equal(validate([grant()], [grant({ scope: "own", pipelineIds: ["p1"] })]).allowed, true);
});
test("own authority does not transfer to another person's own records", () => {
  assert.equal(validate([grant({ scope: "own" })], [grant({ scope: "own" })]).allowed, false);
});
test("team authority can grant own access only to a team member", () => {
  assert.equal(validate([grant({ scope: "team" })], [grant({ scope: "own" })]).allowed, true);
  assert.equal(validate([grant({ scope: "team" })], [grant({ scope: "own" })], { target: { ...target, id: "outsider" } }).allowed, false);
});
test("team authority cannot delegate a larger team", () => {
  assert.equal(validate([grant({ scope: "team" })], [grant({ scope: "team" })], { target: { ...target, teamOperatorIds: ["outsider"] } }).allowed, false);
});
for (const dimension of ["pipelineIds", "sectorIds", "channels", "queues"]) test(`${dimension} cannot be widened or erased`, () => {
  const values = { pipelineIds: "p1", sectorIds: "s1", channels: "whatsapp", queues: "meus" };
  assert.equal(validate([grant({ [dimension]: [values[dimension]] })], [grant()]).allowed, false);
  assert.equal(validate([grant({ [dimension]: [values[dimension]] })], [grant({ [dimension]: [] })]).allowed, true);
});
test("field permissions and expiration cannot be extended", () => {
  const p = grant({ readFields: ["name"], writeFields: ["name"], expiresAt: "2026-10-23T12:00:00Z" });
  assert.equal(validate([p], [grant({ readFields: ["name", "value"], expiresAt: p.expiresAt })]).allowed, false);
  assert.equal(validate([p], [grant({ readFields: ["name"] })]).allowed, false);
  assert.equal(validate([p], [grant({ readFields: ["name"], expiresAt: "2026-10-23T11:00:00Z" })]).allowed, true);
});
test("parent rules cannot be combined into an unauthorized field patch", () => {
  assert.equal(validate([grant({ readFields: ["name"] }), grant({ id: "other", readFields: ["value"] })],
    [grant({ readFields: ["name", "value"] })]).allowed, false);
});
test("previous exact active rules survive unrelated edits", () => {
  const existing = grant({ scope: "all" });
  assert.equal(validate([], [existing], { currentPolicy: policy([existing]) }).allowed, true);
});
test("enabling a dormant module revalidates all newly active grants", () => {
  const existing = grant({ scope: "all" });
  assert.equal(validate([], [existing], { currentPolicy: policy([existing], { modules: { ...policy().modules, crm: false } }) }).allowed, false);
});
test("ordinary policy editing cannot assign tenant ownership", () => {
  assert.equal(validate([grant({ action: "admin.access.assignOwner" })], [grant({ action: "admin.access.assignOwner" })],
    { actor: { ...actor, isTenantOwner: true }, target: { ...target, role: "admin" } }).reason, "OWNER_ASSIGNMENT_SEPARATE");
});
test("delegation respects role and tenant boundaries", () => {
  assert.equal(validate([grant({ action: "admin.users.manage" })], [grant({ action: "admin.users.manage" })]).reason, "TARGET_ADMIN_REQUIRED");
  assert.equal(validate([grant()], [grant()], { target: { ...target, tenantId: "tenant-b" } }).reason, "TENANT_MISMATCH");
});
