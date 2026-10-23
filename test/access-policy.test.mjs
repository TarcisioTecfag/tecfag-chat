import test from "node:test";
import assert from "node:assert/strict";
import { loadAccessSource } from "./helpers/access-harness.mjs";

const { ACCESS_ACTIONS, ACCESS_MODULES } = loadAccessSource("src/lib/access-control/catalog.ts");
const { evaluateAccess, accessPolicySchema, projectReadableFields } = loadAccessSource("src/lib/access-control/policy.ts");
const { DEFAULT_ADMIN_PERMISSIONS } = loadAccessSource("src/lib/rbac.ts");
const subject = { id: "agent-a", tenantId: "tenant-a", role: "agent", teamOperatorIds: ["agent-b"] };
const resource = { id: "deal-a", tenantId: "tenant-a", resource: "deal", ownerId: "agent-a", pipelineId: "pipeline-a", sectorId: "sector-a" };
const grant = (patch = {}) => ({ id: "grant-a", action: "crm.deals.read", scope: "own", readFields: [], writeFields: [], ...patch });
const policy = (grants = [grant()], patch = {}) => ({ version: 2, tenantId: "tenant-a", revision: 1,
  modules: Object.fromEntries(ACCESS_MODULES.map((key) => [key, true])), grants, ...patch });
const decide = (p = policy(), r = resource, action = "crm.deals.read", s = subject, extra = {}) => evaluateAccess(s, p, { resource: r, action, ...extra });

test("catalogue uses valid modules and actual legacy permission keys", () => {
  for (const [action, spec] of Object.entries(ACCESS_ACTIONS)) {
    assert.ok(ACCESS_MODULES.includes(spec.module), action);
    if (spec.legacy) {
      const [category, key] = spec.legacy.split(".");
      assert.equal(typeof DEFAULT_ADMIN_PERMISSIONS[category]?.[key], "boolean", `${action}: ${spec.legacy}`);
    }
  }
});
test("read team and edit own remain independent", () => {
  const p = policy([grant({ scope: "team" }), grant({ id: "edit", action: "crm.deals.update" })]);
  assert.equal(decide(p, { ...resource, ownerId: "agent-b" }).allowed, true);
  assert.equal(decide(p, { ...resource, ownerId: "agent-b" }, "crm.deals.update").allowed, false);
  assert.equal(decide(p, resource, "crm.deals.update").allowed, true);
});
test("admin and tenant owner cannot bypass disabled modules", () => {
  assert.equal(decide(policy([], { modules: { ...policy().modules, crm: false } }), resource, "crm.deals.read",
    { ...subject, role: "admin", isTenantOwner: true }).reason, "MODULE_DISABLED");
});
for (const mismatch of ["subject", "policy", "resource"]) test(`tenant mismatch in ${mismatch} always denies`, () => {
  const p = policy([grant({ scope: "all" })]);
  const s = { ...subject, role: "admin", isTenantOwner: true }, r = { ...resource };
  ({ subject: s, policy: p, resource: r })[mismatch].tenantId = "tenant-b";
  assert.equal(decide(p, r, "crm.deals.read", s).reason, "TENANT_MISMATCH");
});
test("rules do not combine pipeline and sector permissions across grants", () => {
  const p = policy([grant({ pipelineIds: ["pipeline-a"], sectorIds: ["sector-a"] }),
    grant({ id: "other", pipelineIds: ["pipeline-b"], sectorIds: ["sector-b"] })]);
  assert.equal(decide(p).allowed, true);
  assert.equal(decide(p, { ...resource, sectorId: "sector-b" }).allowed, false);
});
test("empty restrictions deny, omitted restrictions accept", () => {
  for (const field of ["pipelineIds", "sectorIds", "channels", "queues"]) assert.equal(decide(policy([grant({ [field]: [] })])).allowed, false, field);
  assert.equal(decide().allowed, true);
});
test("own, author and wallet identify different relationships", () => {
  const r = { ...resource, ownerId: "agent-b", authorId: "agent-a", walletOperatorId: "agent-c" };
  assert.equal(decide(policy([grant({ scope: "own" })]), r).allowed, false);
  assert.equal(decide(policy([grant({ scope: "author" })]), r).allowed, true);
  assert.equal(decide(policy([grant({ scope: "wallet" })]), r).allowed, false);
});
test("unassigned requires a known null owner", () => {
  const p = policy([grant({ scope: "unassigned" })]);
  assert.equal(decide(p, { ...resource, ownerId: null }).allowed, true);
  assert.equal(decide(p, { ...resource, ownerId: undefined }).allowed, false);
});
test("sharing is limited to the server-resolved action", () => {
  const r = { ...resource, ownerId: "agent-b", sharedActions: { "agent-a": ["crm.deals.read"] } };
  const p = policy([grant({ scope: "shared" }), grant({ id: "edit", action: "crm.deals.update", scope: "shared" })]);
  assert.equal(decide(p, r).allowed, true);
  assert.equal(decide(p, r, "crm.deals.update").allowed, false);
});
test("queue and channel filters both apply", () => {
  const p = policy([grant({ action: "chat.read", queues: ["meus"], channels: ["whatsapp"] })]);
  const r = { ...resource, resource: "conversation", queue: "meus", channel: "whatsapp" };
  assert.equal(decide(p, r, "chat.read").allowed, true);
  assert.equal(decide(p, { ...r, queue: "fila" }, "chat.read").allowed, false);
  assert.equal(decide(p, { ...r, channel: "livechat" }, "chat.read").allowed, false);
});
test("expired grants deny at their expiration instant", () => {
  const p = policy([grant({ expiresAt: "2026-10-22T12:00:00Z" })]);
  assert.equal(decide(p, resource, "crm.deals.read", subject, { now: new Date("2026-10-22T11:59:59Z") }).allowed, true);
  assert.equal(decide(p, resource, "crm.deals.read", subject, { now: new Date("2026-10-22T12:00:00Z") }).allowed, false);
});
test("field writes require one complete grant covering the patch", () => {
  const p = policy([grant({ writeFields: ["name"] }), grant({ id: "other", writeFields: ["value"] })]);
  assert.equal(decide(p, resource, "crm.deals.read", subject, { fields: ["name"], fieldOperation: "write" }).allowed, true);
  assert.equal(decide(p, resource, "crm.deals.read", subject, { fields: ["name", "value"], fieldOperation: "write" }).allowed, false);
  assert.equal(decide(p, resource, "crm.deals.read", subject, { fields: ["name"], fieldOperation: "read" }).allowed, false);
});
test("read projection removes every ungranted property", () => {
  const p = policy([grant({ readFields: ["id", "name"] })]);
  assert.deepEqual(projectReadableFields(subject, p, { resource, action: "crm.deals.read" },
    { id: "deal-a", name: "Deal", value: 100, secret: "private" }), { id: "deal-a", name: "Deal" });
  assert.deepEqual(projectReadableFields(subject, policy(), { resource, action: "crm.deals.read" }, { id: "deal-a" }), {});
});
test("administrative action requires both role and explicit grant", () => {
  const r = { ...resource, resource: "operator" }, p = policy([grant({ action: "admin.users.manage", scope: "all" })]);
  assert.equal(decide(p, r, "admin.users.manage").reason, "ADMIN_REQUIRED");
  assert.equal(decide(p, r, "admin.users.manage", { ...subject, role: "admin" }).allowed, true);
  assert.equal(decide(policy([]), r, "admin.users.manage", { ...subject, role: "admin" }).allowed, false);
});
test("only explicit tenant owner may assign ownership", () => {
  const p = policy([grant({ action: "admin.access.assignOwner", scope: "all" })]), r = { ...resource, resource: "configuration" };
  assert.equal(decide(p, r, "admin.access.assignOwner", { ...subject, role: "admin" }).reason, "OWNER_REQUIRED");
  assert.equal(decide(p, r, "admin.access.assignOwner", { ...subject, role: "admin", isTenantOwner: true }).allowed, true);
});
test("resource kinds cannot be substituted", () => {
  assert.equal(decide(policy(), { ...resource, resource: "contact" }).reason, "RESOURCE_MISMATCH");
});
test("invalid policies fail closed without throwing", () => {
  for (const value of [null, {}, policy([{}]), policy([grant({ action: "unknown" })]), policy([grant({ readFields: ["*"] })]),
    policy([grant(), grant()]), policy([], { extra: true }), policy([], { modules: { crm: true } }), policy([grant({ expiresAt: "bad" })])]) {
    assert.equal(accessPolicySchema.safeParse(value).success, false);
    assert.equal(decide(value).reason, "POLICY_INVALID");
  }
  assert.equal(decide(policy(), resource, "crm.deals.read", { ...subject, id: "" }).reason, "POLICY_INVALID");
});
