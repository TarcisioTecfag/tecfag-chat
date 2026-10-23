import test from "node:test";
import assert from "node:assert/strict";
import { loadAccessSource } from "./helpers/access-harness.mjs";

const { canPerformSiteAction } = loadAccessSource("src/lib/access-control/site-actions.ts");
test("legacy site write actions distinguish capture, takeover, release, response and finish", () => {
  const own = { operatorId: "agent-a", status: "operator_took_over" }, other = { ...own, operatorId: "other" };
  assert.equal(canPerformSiteAction("agent-a", own, "operator_message", {}), true);
  assert.equal(canPerformSiteAction("agent-a", other, "operator_message", {}), false);
  assert.equal(canPerformSiteAction("agent-a", other, "take_over", { canCaptureChat: true }), false);
  assert.equal(canPerformSiteAction("agent-a", other, "take_over", { canOverrideChat: true }), true);
  assert.equal(canPerformSiteAction("agent-a", own, "release_to_ai", { canFinishChat: true }), false);
  assert.equal(canPerformSiteAction("agent-a", own, "close_chat", { canTransferChat: true }), false);
  assert.equal(canPerformSiteAction("agent-a", own, "close_chat", { canFinishChat: true }), true);
});
function storageHarness() {
  let row = { id: "chat-a", tenantId: "tenant-a", operatorId: "other", visitorId: "visitor-a", status: "operator_took_over" };
  const writes = [], locks = [];
  const table = (name) => ({ name, id: `${name}.id`, tenantId: `${name}.tenantId` });
  const schema = { lcChats: table("chats"), lcMessages: table("messages") };
  const db = { transaction: async (fn) => fn(db),
    select: () => { let conditions; const q = { from: () => q, where: (c) => { conditions = c; return q; },
      for: (kind) => { locks.push(kind); return q; }, limit: async () => conditions.all.every((c) => row[c.column.split(".").at(-1)] === c.value) ? [structuredClone(row)] : [] }; return q; },
    update: () => ({ set: (patch) => ({ where: async (where) => { writes.push({ patch, where }); row = { ...row, ...patch }; } }) }),
    insert: () => ({ values: (message) => ({ returning: async () => { writes.push(message); return [message]; } }) }),
  };
  const storage = loadAccessSource("src/lib/livechat/livechatStorage.ts", {
    "../../db": { db }, "../../db/schema": schema,
    "drizzle-orm": { eq: (column, value) => ({ column, value }), and: (...all) => ({ all }) },
    "crypto": { default: { randomUUID: () => "message-a" } },
  });
  return { ...storage, writes, locks, setRow: (patch) => { row = { ...row, ...patch }; } };
}
test("site actions recheck the row owner under lock before writing", async () => {
  const h = storageHarness();
  await assert.rejects(() => h.applyOperatorChatAction("tenant-a", "chat-a", "agent-a", "operator_message", {}, "attempt"), { code: "FORBIDDEN" });
  assert.deepEqual(h.locks, ["update"]); assert.equal(h.writes.length, 0);
  h.setRow({ operatorId: "agent-a" });
  const result = await h.applyOperatorChatAction("tenant-a", "chat-a", "agent-a", "operator_message", {}, "allowed");
  assert.equal(result.message.content, "allowed"); assert.equal(h.writes.length, 1);
});
test("site action rejects a different tenant and clears owner explicitly when returning to AI", async () => {
  const h = storageHarness();
  await assert.rejects(() => h.applyOperatorChatAction("tenant-b", "chat-a", "agent-a", "take_over", { canOverrideChat: true }), { code: "NOT_FOUND" });
  assert.equal(h.writes.length, 0);
  h.setRow({ operatorId: "agent-a" });
  await h.applyOperatorChatAction("tenant-a", "chat-a", "agent-a", "release_to_ai", { canTransferChat: true });
  assert.equal(h.writes[0].patch.operatorId, null); assert.equal(h.writes[0].patch.status, "active");
});
function pushHarness({ allowed = false, operatorExists = true } = {}) {
  let sent = 0, subscriptionsRead = 0, principalReads = 0;
  const q = { from: () => q, where: async () => { subscriptionsRead++; return [{ id: "sub", endpoint: "https://push.test/a", p256dh: "x", auth: "y" }]; } };
  const source = loadAccessSource("src/lib/push-notifications.ts", {
    "web-push": { default: { generateVAPIDKeys: () => ({ publicKey: "public", privateKey: "private" }), setVapidDetails: () => {}, sendNotification: async () => { sent++; } } },
    "@/db": { db: { select: () => q } }, "@/db/schema": { pushSubscriptions: {} }, "drizzle-orm": { eq: (...x) => x, and: (...x) => x },
    "./access-control/operator-context": { loadOperatorAccess: async () => { principalReads++; return operatorExists ? {} : null; } },
    "./access-control/conversation-access": { requireConversationAccess: async () => allowed ? null : new Response(null, { status: 404 }) },
  });
  return { ...source, counts: () => ({ sent, subscriptionsRead, principalReads }) };
}
test("push checks current conversation visibility before subscriptions or external delivery", async () => {
  const h = pushHarness();
  const result = await h.sendPushToOperator("tenant-a", "agent-a", { tenantId: "tenant-a", conversationId: "other", title: "private", body: "secret" });
  assert.equal(result.sentCount, 0); assert.deepEqual(h.counts(), { sent: 0, subscriptionsRead: 0, principalReads: 1 });
});
test("push rejects cross-tenant payload or missing operator, while authorized delivery continues", async () => {
  const h = pushHarness({ allowed: true });
  await h.sendPushToOperator("tenant-a", "agent-a", { tenantId: "tenant-b", conversationId: "conv", title: "x", body: "x" });
  assert.equal(h.counts().principalReads, 0);
  assert.equal((await h.sendPushToOperator("tenant-a", "agent-a", { tenantId: "tenant-a", conversationId: "conv", title: "x", body: "x" })).sentCount, 1);
  const missing = pushHarness({ allowed: true, operatorExists: false });
  assert.equal((await missing.sendPushToOperator("tenant-a", "missing", { tenantId: "tenant-a", conversationId: "conv", title: "x", body: "x" })).sentCount, 0);
  assert.equal(missing.counts().sent, 0);
});
