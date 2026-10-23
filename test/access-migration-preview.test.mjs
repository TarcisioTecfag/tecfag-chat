import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadAccessSource } from "./helpers/access-harness.mjs";
const { previewAccessMigration } = loadAccessSource("src/lib/access-control/migration-preview.ts");
const { ACCESS_ACTIONS } = loadAccessSource("src/lib/access-control/catalog.ts");
function snapshot(patch = {}) {
  const payload = { tenantId: "tenant-a", groups: [{ id: "group-a", tenantId: "tenant-a", name: "Team", allowedChannels: ["whatsapp"],
    permissions: { views: { crm: true, chat: true }, crm: { canViewCrm: true, canEditDeals: true, canDeleteDeals: false },
      chat: { canViewAllChats: true }, legacyUnknown: { keep: "exact" } }, canCaptureChat: true }],
    members: [{ id: "agent-a", tenantId: "tenant-a", role: "agent", groupId: "group-a" }], sectors: [], ...patch };
  return { format: "access-control-snapshot", version: 1, schemaCapabilities: { granularPermissions: true },
    ...payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}
test("preview preserves raw fields and memberships without mutating source", () => {
  const s = snapshot(), original = structuredClone(s), p = previewAccessMigration(s);
  assert.deepEqual(p.groups[0].original, s.groups[0]);
  assert.deepEqual(p.preservedMemberships, s.members);
  assert.deepEqual(s, original);
  assert.equal(p.activationAllowed, false);
});
test("absent granular permission never becomes an inferred module grant", () => {
  const s = snapshot(); delete s.groups[0].permissions;
  const p = previewAccessMigration(snapshot({ groups: s.groups }));
  assert.ok(Object.values(p.groups[0].candidate.modules).every((v) => v === false));
  assert.equal(p.groups[0].candidate.grants.length, 0);
  assert.equal(p.groups[0].review.unresolvedModules.length, 14);
});
test("broad read flag never implies editing all records or field exposure", () => {
  const p = previewAccessMigration(snapshot()), grants = p.groups[0].candidate.grants;
  assert.ok(grants.some((g) => g.action === "crm.deals.update"));
  for (const g of grants.filter((g) => ACCESS_ACTIONS[g.action].resource === "deal")) assert.equal(g.scope, "own");
  assert.ok(grants.every((g) => !g.readFields.length && !g.writeFields.length));
  assert.ok(!grants.some((g) => g.action === "crm.deals.delete"));
});
test("explicit deny beats legacy top-level allow", () => {
  const s = snapshot(); s.groups[0].permissions.chat.canCaptureChat = false;
  assert.ok(!previewAccessMigration(snapshot({ groups: s.groups })).groups[0].candidate.grants.some((g) => g.action === "chat.capture"));
});
test("orphan memberships remain unresolved and block activation", () => {
  const s = snapshot({ members: [{ id: "agent-a", tenantId: "tenant-a", role: "admin", groupId: "missing" }] });
  const p = previewAccessMigration(s);
  assert.deepEqual(p.pendingMemberships, [{ operatorId: "agent-a", role: "admin", previousGroupId: "missing", proposedGroupId: null }]);
  assert.ok(p.blockers.includes("UNMAPPED_MEMBERSHIPS"));
});
test("missing schema is recorded as a blocker", () => {
  const s = snapshot(); s.schemaCapabilities.granularPermissions = false;
  assert.ok(previewAccessMigration(s).blockers.includes("GRANULAR_SCHEMA_MISSING"));
});
test("tampered backup is rejected before proposing policy", () => {
  const s = snapshot(); s.members[0].groupId = "tampered";
  assert.throws(() => previewAccessMigration(s), /Integridade/);
});
for (const collection of ["groups", "members", "sectors"]) test(`cross-tenant ${collection} rejected even with valid hash`, () => {
  const s = snapshot(); s[collection] = [{ id: "foreign", tenantId: "tenant-b" }];
  assert.throws(() => previewAccessMigration(snapshot({ [collection]: s[collection] })), /outro tenant/);
});
test("duplicate source identifiers are rejected", () => {
  const s = snapshot(); assert.throws(() => previewAccessMigration(snapshot({ groups: [...s.groups, ...s.groups] })), /duplicados/);
});
test("candidate conversation grants preserve explicit queue restrictions", () => {
  const s = snapshot(); Object.assign(s.groups[0].permissions.chat, { canViewQueueBot: false, canViewQueueClosed: false });
  const candidate = previewAccessMigration(snapshot({ groups: s.groups })).groups[0].candidate;
  const grants = candidate.grants.filter((grant) => ACCESS_ACTIONS[grant.action].resource === "conversation");
  assert.ok(grants.length > 0);
  for (const grant of grants) { assert.ok(!grant.queues.includes("automacao")); assert.ok(!grant.queues.includes("finalizados")); }
});
