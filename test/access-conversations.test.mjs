import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { apiRequest, loadAccessSource, routeStub } from "./helpers/access-harness.mjs";

const { canReadConversation, conversationReadRules, OWN_CONVERSATIONS_PRESET } = loadAccessSource("src/lib/access-control/conversation-policy.ts");
const { normalizeGroupPermissions } = loadAccessSource("src/lib/rbac.ts");
const { canManageWhatsappConnection, canMonitorAllSiteVisitors } = loadAccessSource("src/lib/access-control/channel-permissions.ts");
const principal = (chat = {}, patch = {}) => ({ tenantId: "tenant-a", operator: { id: "agent-a", role: "agent" },
  permissions: { views: { chat: true }, chat: { canViewAllChats: false, ...chat } }, accessGroup: { allowedChannels: ["whatsapp", "livechat"] }, ...patch });
const record = (patch = {}) => ({ id: "conv-a", tenantId: "tenant-a", operatorId: "agent-a", queueState: "meus", mainChannel: "whatsapp", ...patch });

test("legacy queue settings remain visible until explicitly configured", () => {
  const p = normalizeGroupPermissions({ permissions: { views: { chat: true }, chat: { canViewAllChats: false } } });
  for (const key of ["canViewQueueMine", "canViewQueueWaiting", "canViewQueueBot", "canViewQueueClosed"]) assert.equal(p.chat[key], true);
  assert.equal(p.chat.restrictToOwnChats, false);
});
test("only Mine preset denies unassigned, other owners and all other queues", () => {
  const p = principal(OWN_CONVERSATIONS_PRESET);
  assert.equal(canReadConversation(p, record()), true);
  for (const owner of [null, "other"]) assert.equal(canReadConversation(p, record({ operatorId: owner })), false);
  for (const queue of ["fila", "automacao", "finalizados"]) assert.equal(canReadConversation(p, record({ queueState: queue })), false);
});
test("own-only restriction wins over global read and administrator role", () => {
  const p = principal({ restrictToOwnChats: true, canViewAllChats: true }, { operator: { id: "agent-a", role: "admin" } });
  assert.equal(canReadConversation(p, record({ operatorId: "other" })), false);
  assert.equal(canReadConversation(p, record()), true);
});
test("module, tenant and channel are mandatory regardless of role", () => {
  assert.equal(canReadConversation(principal({}, { permissions: { views: { chat: false } }, operator: { id: "agent-a", role: "admin" } }), record()), false);
  assert.equal(canReadConversation(principal(), record({ tenantId: "tenant-b" })), false);
  assert.equal(canReadConversation(principal({}, { accessGroup: { allowedChannels: [] } }), record()), false);
  assert.equal(canReadConversation(principal(), record({ mainChannel: "messenger" })), false);
});
test("malformed queue and restriction flags do not widen visibility", () => {
  assert.equal(canReadConversation(principal({ canViewQueueMine: "true" }), record()), false);
  assert.equal(canReadConversation(principal({ restrictToOwnChats: "false", canViewAllChats: true }), record({ operatorId: "other" })), false);
});
test("legacy global site monitoring requires full site visibility and its own module capability", () => {
  const p = principal({ canViewAllChats: true });
  p.permissions.views.monitor = true; p.permissions.monitor = { canAccessSiteVisitors: true };
  assert.equal(canMonitorAllSiteVisitors(p), true);
  assert.equal(canMonitorAllSiteVisitors({ ...p, permissions: { ...p.permissions, chat: { ...p.permissions.chat, restrictToOwnChats: true } } }), false);
  assert.equal(canMonitorAllSiteVisitors({ ...p, accessGroup: { allowedChannels: ["whatsapp"] } }), false);
  p.permissions.chat.canViewQueueBot = false;
  assert.equal(canMonitorAllSiteVisitors(p), false);
});

// Execute the real SQL builder over semantic predicates. No DB/network imports are allowed.
function databaseHarness(rows) {
  const table = (name, keys) => Object.fromEntries(keys.map((key) => [key, { table: name, column: key }]));
  const conversations = table("conversations", ["id", "tenantId", "operatorId", "queueState", "contactId"]);
  const contacts = table("contacts", ["id", "tenantId", "mainChannel"]);
  const data = { conversations: rows.map(({ mainChannel, ...row }) => ({ ...row, contactId: `contact-${row.id}` })),
    contacts: rows.map((row) => ({ id: `contact-${row.id}`, tenantId: row.tenantId, mainChannel: row.mainChannel })) };
  const expr = (op) => (...args) => ({ op, args });
  const dsl = { and: (...args) => ({ op: "and", args: args.filter(Boolean) }), or: (...args) => ({ op: "or", args: args.filter(Boolean) }),
    eq: expr("eq"), inArray: expr("in"), isNull: expr("null"), exists: expr("exists"),
    sql: (strings, ...args) => { const text = strings.join("?");
      if (text === "false") return { op: "false", args: [] };
      if (text.startsWith("coalesce(")) return { op: "coalesce", args };
      throw Error(`Unexpected SQL expression: ${text}`); } };
  function value(x, ctx) {
    if (x?.column) return ctx[x.table]?.[x.column];
    if (!x?.op) return x;
    const [a, b] = x.args;
    switch (x.op) {
      case "false": return false;
      case "eq": return value(a, ctx) === value(b, ctx);
      case "in": return b.includes(value(a, ctx));
      case "null": return value(a, ctx) === null;
      case "and": return x.args.every((item) => value(item, ctx));
      case "or": return x.args.some((item) => value(item, ctx));
      case "coalesce": return value(a, ctx) ?? "whatsapp";
      case "exists": return a.evaluate(ctx).length > 0;
      default: throw Error(x.op);
    }
  }
  const queries = [];
  const db = { select: (fields) => {
    let source, condition, limit;
    const query = { from: (t) => { source = t.id.table; return query; }, where: (x) => { condition = x; return query; },
      limit: (n) => { limit = n; return query; },
      evaluate: (ctx = {}) => data[source].filter((row) => value(condition, { ...ctx, [source]: row })).slice(0, limit)
        .map((row) => fields ? Object.fromEntries(Object.entries(fields).map(([key, col]) => [key, value(col, { ...ctx, [source]: row })])) : row),
      then: (resolve) => { queries.push({ source, condition }); return Promise.resolve(query.evaluate()).then(resolve); } };
    return query;
  } };
  const source = loadAccessSource("src/lib/access-control/conversation-access.ts", { "../../db": { db }, "../../db/schema": { conversations, contacts }, "drizzle-orm": dsl });
  return { ...source, db, conversations, contacts, dsl, queries };
}
test("SQL predicate and record evaluator agree across tenant, owner, channel and every queue", async () => {
  let next = 0;
  const rows = [];
  for (const tenantId of ["tenant-a", "tenant-b"]) for (const operatorId of ["agent-a", "other", null])
    for (const queueState of ["meus", "fila", "automacao", "finalizados"]) for (const mainChannel of [null, "whatsapp", "livechat", "messenger"])
      rows.push(record({ id: `c-${next++}`, tenantId, operatorId, queueState, mainChannel }));
  const h = databaseHarness(rows);
  for (const chat of [{}, { canViewAllChats: true }, OWN_CONVERSATIONS_PRESET, { canViewQueueBot: false }, { canViewQueueWaiting: false, canViewAllChats: true }]) {
    for (const allowedChannels of [["whatsapp"], ["livechat"], [], ["whatsapp", "livechat"]]) {
      const p = principal(chat, { accessGroup: { allowedChannels } });
      const actual = await h.db.select({ id: h.conversations.id }).from(h.conversations).where(h.conversationReadCondition(p));
      assert.deepEqual(actual.map((row) => row.id), rows.filter((row) => canReadConversation(p, row)).map((row) => row.id));
    }
  }
});
test("read and write guards distinguish visibility from capture", async () => {
  const h = databaseHarness([record(), record({ id: "other", operatorId: "other" }), record({ id: "waiting", operatorId: null, queueState: "fila" })]);
  const p = principal({ canViewAllChats: true });
  assert.equal(await h.requireConversationAccess(p, "other"), null);
  assert.equal((await h.requireConversationWriteAccess(p, "other")).status, 403);
  assert.equal((await h.requireConversationWriteAccess(p, "waiting")).status, 403);
  assert.equal(await h.requireConversationWriteAccess(p, "conv-a"), null);
  assert.equal((await h.requireConversationAccess(principal(OWN_CONVERSATIONS_PRESET), "other")).status, 404);
});

function eventHarness() {
  let visible = true, queries = 0;
  const q = { from: () => q, innerJoin: () => q, where: () => q, limit: async () => { queries++; return visible ? [{ id: "visible" }] : []; } };
  const table = new Proxy({}, { get: (_, key) => key });
  const sources = loadAccessSource("src/lib/access-control/conversation-events.ts", {
    "../../db": { db: { select: () => q } }, "../../db/schema": { contacts: table, conversations: table },
    "drizzle-orm": { eq: (...x) => x, and: (...x) => x },
    "./conversation-access": { conversationReadCondition: () => ({}), requireConversationAccess: async (_, id) => id === "conv-a" ? null : new Response(null, { status: 404 }) },
  });
  return { ...sources, setVisible: (v) => { visible = v; }, queries: () => queries };
}
test("events authorize server resource, never forged queue or operator values", async () => {
  const h = eventHarness(), p = principal(OWN_CONVERSATIONS_PRESET);
  const forbidden = { type: "message", message: { conversationId: "other", operatorId: "agent-a", queue: "meus", content: "secret" } };
  assert.equal(await h.filterConversationEvent(p, forbidden), null);
  const allowed = { type: "message", message: { conversationId: "conv-a", content: "allowed" } };
  assert.deepEqual(await h.filterConversationEvent(p, allowed), allowed);
});
test("events drop unknown kinds, cross-tenant content and inaccessible contacts", async () => {
  const h = eventHarness(), p = principal();
  assert.equal(await h.filterConversationEvent(p, { type: "new_unknown", content: "secret" }), null);
  assert.equal(await h.filterConversationEvent(p, { type: "message", tenantId: "tenant-b", message: { conversationId: "conv-a" } }), null);
  h.setVisible(false);
  assert.equal(await h.filterConversationEvent(p, { type: "contact_updated", contactId: "contact-a" }), null);
  assert.ok(h.queries() > 0);
});
test("QR, connection phone and personal AI notifications have separate rights", async () => {
  const h = eventHarness(), p = principal();
  assert.equal(await h.filterConversationEvent(p, { type: "qr", qr: "secret" }), null);
  assert.deepEqual(await h.filterConversationEvent(p, { type: "status", status: "connected", phone: "private" }), { type: "status", status: "connected" });
  const admin = { ...p, operator: { id: "agent-a", role: "admin" }, permissions: { views: { settings: true }, settings: { canManageWhatsapp: true } } };
  assert.equal((await h.filterConversationEvent(admin, { type: "qr", qr: "secret" })).qr, "secret");
  admin.permissions.views.settings = false;
  assert.equal(await h.filterConversationEvent(admin, { type: "qr", qr: "secret" }), null);
  const ai = { ...p, permissions: { views: { valentina: true }, valentina: { canAccessChat: true } } };
  assert.equal(await h.filterConversationEvent(ai, { type: "operator_ai_notification", operatorId: "other", message: { content: "secret" } }), null);
});

test("SSE rechecks policy before delivery and closes with a content-free invalidation", async () => {
  const initial = principal(), h = eventHarness();
  let fresh = structuredClone(initial), listener, unregistered = 0;
  const manager = { registerListener: (_, cb) => { listener = cb; }, unregisterListener: () => { unregistered++; } };
  const route = loadAccessSource("src/routes/api/events.ts", {
    "@tanstack/react-router": routeStub,
    "../../lib/auth-session": { requireSession: async () => ({ session: initial }), getAuthSession: async () => fresh },
    "../../lib/baileys/session-manager": { SessionManager: { getInstance: () => manager } },
    "../../lib/access-control/conversation-events": h,
  }).Route.server.handlers;
  const response = await route.GET({ request: new Request("http://test/api/events") });
  const reader = response.body.getReader(); await reader.read();
  fresh.permissions.views.chat = false;
  listener({ type: "message", message: { conversationId: "conv-a", content: "never deliver" } });
  const chunk = new TextDecoder().decode((await reader.read()).value);
  assert.ok(chunk.includes('"type":"access_changed"')); assert.ok(!chunk.includes("never deliver"));
  assert.equal((await reader.read()).done, true); assert.equal(unregistered, 1);
});

test("connection management denies admin without explicit settings and action rights", () => {
  for (const permissions of [{}, { views: { settings: true }, settings: { canManageWhatsapp: false } }, { views: { settings: false }, settings: { canManageWhatsapp: true } }]) {
    assert.equal(canManageWhatsappConnection({ operator: { role: "admin" }, permissions }), false);
  }
  assert.equal(canManageWhatsappConnection({ operator: { role: "agent" }, permissions: { views: { settings: true }, settings: { canManageWhatsapp: true } } }), false);
  assert.equal(canManageWhatsappConnection({ operator: { role: "admin" }, permissions: { views: { settings: true }, settings: { canManageWhatsapp: true } } }), true);
});

function extractedHandler(file, method, bindings) {
  const source = fs.readFileSync(file, "utf8"), tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let initializer;
  function walk(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === method && ts.isArrowFunction(node.initializer)) initializer = node.initializer.getText(tree);
    ts.forEachChild(node, walk);
  }
  walk(tree); assert.ok(initializer, `${file}:${method}`);
  const compiled = ts.transpileModule(`const handler = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return handler;`)(...Object.values(bindings));
}
for (const [file, method, body, params] of [
  ["chats/$chatId/messages.ts", "GET", undefined, { chatId: "other" }],
  ["whatsapp/send.ts", "POST", { conversationId: "other", text: "attempt" }],
  ["baileys/send.ts", "POST", { conversationId: "other", text: "attempt" }],
  ["whatsapp/react.ts", "POST", { conversationId: "other", messageId: "msg", emoji: "x" }],
  ["whatsapp/presence.ts", "POST", { conversationId: "other", action: "typing" }],
  ["chats/tag-task.ts", "POST", { conversationId: "other", tagName: "tag" }],
  ["chats/update-queue.ts", "POST", { conversationId: "other", queueState: "fila", expectedVersion: 1 }],
]) test(`${file} rejects invisible resources before operational side effects`, async () => {
  const denied = new Response(null, { status: 404 });
  const bindings = { requireSession: async () => ({ session: principal() }), requireConversationAccess: async () => denied,
    requireConversationWriteAccess: async () => denied, json: (data, status) => Response.json(data, { status }), corsHeaders: {} };
  const handler = extractedHandler(`src/routes/api/${file}`, method, bindings);
  assert.equal((await handler({ request: apiRequest(body, method), params })).status, 404);
});

test("media route cannot read filesystem or bytes without authorized conversation", async () => {
  let reads = 0;
  const handler = extractedHandler("src/routes/api/baileys/media.ts", "GET", {
    requireSession: async () => ({ session: principal() }),
    db: { query: { mediaFiles: { findFirst: async () => ({ id: "media", conversationId: "other", base64Data: "secret" }) } } },
    requireConversationAccess: async () => new Response(null, { status: 404 }),
    fs: new Proxy({}, { get: () => { reads++; throw Error("Filesystem must remain untouched"); } }),
  });
  assert.equal((await handler({ request: apiRequest(undefined, "GET", "http://test/api/baileys/media?messageId=media") })).status, 404);
  assert.equal(reads, 0);
});
for (const [file, method] of [["baileys/connect.ts", "GET"], ["baileys/disconnect.ts", "POST"],
  ["livechat/visitors.ts", "GET"], ["livechat/metrics.ts", "GET"], ["livechat/visitor/$visitorId.ts", "GET"]]) {
  test(`${file} denies restricted profile before opening transport or loading monitoring data`, async () => {
    const handler = extractedHandler(`src/routes/api/${file}`, method, {
      requireSession: async () => ({ session: principal() }), canManageWhatsappConnection, canMonitorAllSiteVisitors,
    });
    assert.equal((await handler({ request: apiRequest(undefined, method), params: { visitorId: "visitor-a" } })).status, 403);
  });
}
test("cached-ID authorization endpoint returns only visible IDs, without loading messages", async () => {
  const h = databaseHarness([record(), record({ id: "other", operatorId: "other" })]);
  const handler = extractedHandler("src/routes/api/chats.ts", "POST", {
    requireSession: async () => ({ session: principal(OWN_CONVERSATIONS_PRESET) }), db: h.db, conversations: h.conversations,
    ...h.dsl, conversationReadCondition: h.conversationReadCondition,
  });
  const response = await handler({ request: apiRequest({ checkAccessIds: ["conv-a", "other", "foreign"], tenantId: "tenant-b" }) });
  assert.deepEqual(await response.json(), { operatorId: "agent-a", visibleConversationIds: ["conv-a"] });
  assert.equal(h.queries.every((query) => query.source === "conversations"), true);
  assert.equal((await handler({ request: apiRequest({ checkAccessIds: Array(101).fill("conv-a") }) })).status, 400);
});
test("persisting a chat note rechecks capture inside the transaction before any write", async () => {
  for (const stillOwner of [false, true]) {
    let writes = 0, locked = false;
    const session = principal({ canSendInternalNotes: true });
    const query = { from: () => query, where: () => query, then: (resolve) => resolve([{ operatorId: "agent-a", queueState: "meus" }]) };
    const lock = { from: () => lock, where: () => lock, for: (kind) => { locked = kind === "update"; return lock; }, limit: async () => stillOwner ? [{ id: "conv-a" }] : [] };
    const tx = { select: () => lock, insert: () => ({ values: async () => { writes++; } }), update: () => ({ set: () => ({ where: async () => { writes++; } }) }) };
    const handler = extractedHandler("src/routes/api/chats.ts", "POST", {
      requireSession: async () => ({ session }), requireConversationWriteAccess: async () => null,
      db: { select: () => query, transaction: async (fn) => fn(tx) }, conversations: {}, messages: {},
      eq: (...x) => x, and: (...x) => x, conversationReadCondition: () => ({}),
    });
    const response = await handler({ request: apiRequest({ conversationId: "conv-a", content: "internal note", isInternalNote: true }) });
    assert.equal(response.status, stillOwner ? 200 : 403); assert.equal(locked, true); assert.equal(writes, stillOwner ? 2 : 0);
  }
});
test("public CRM detail getters pass the conversation predicate to the actual service call", () => {
  for (const file of ["crm/deals/$dealId.ts", "crm/accounts/$accountId.ts", "crm/accounts/$accountId/conversations.ts"]) {
    const source = fs.readFileSync(`src/routes/api/${file}`, "utf8");
    assert.match(source, /crmService\.(getDealById|getAccountById|getAccountConversations)\(tenantId, \w+, conversationReadCondition\(session\)\)/);
  }
});

for (const [file, method, body] of [
  ["gestao/overview.ts", "GET"],
  ["gestao/alerts.ts", "GET"],
  ["gestao/audits.ts", "GET"],
  ["gestao/audits.ts", "PATCH", { action: "retry_all" }],
  ["gestao/performance.ts", "GET"],
  ["gestao/sla.ts", "GET"],
  ["gestao/contacts-analytics.ts", "GET"],
  ["gestao/costs.ts", "GET"],
  ["gestao/reports.ts", "GET"],
  ["gestao/reports-v2.ts", "GET"],
  ["gestao/report-workflow.ts", "POST", { reportId: "rep-1", action: "advance-stage" }],
]) {
  test(`${file} (${method}) denies restricted admin lacking explicit module/action capability before touching DB`, async () => {
    const restrictedAdmin = {
      ...principal(),
      operator: { ...principal().operator, role: "admin" },
      permissions: {
        views: { chat: true, monitor: false, analytics: false },
        monitor: { canAccessRanking: false, canAccessAlerts: false, canAccessAudits: false, canManageAudits: false },
        analytics: {
          canAccessOverview: false,
          canAccessPerformance: false,
          canAccessSla: false,
          canAccessContacts: false,
          canAccessCosts: false,
          canAccessAiReports: false,
        },
      },
    };
    const handler = extractedHandler(`src/routes/api/${file}`, method, {
      requireSession: async () => ({ session: restrictedAdmin }),
      corsHeaders: {},
      json: (data, status = 200) => Response.json(data, { status }),
      db: new Proxy({}, { get: () => { throw new Error("DB must not be touched when capability is denied"); } }),
    });
    const res = await handler({ request: apiRequest(body, method, `http://test/api/${file}`) });
    assert.equal(res.status, 403);
  });
}

for (const file of ["gestao/my-metrics.ts", "gestao/operator-history.ts"]) {
  test(`${file} denies cross-operator inspection when ownOnly is active or ranking/overview is disabled`, async () => {
    const restrictedAdmin = {
      ...principal(OWN_CONVERSATIONS_PRESET),
      operator: { ...principal().operator, role: "admin" },
    };
    const handler = extractedHandler(`src/routes/api/${file}`, "GET", {
      requireSession: async () => ({ session: restrictedAdmin }),
      conversationReadRules,
      conversationReadCondition: () => ({}),
      corsHeaders: {},
      db: new Proxy({}, { get: () => { throw new Error("DB must not be touched on unauthorized cross-operator query"); } }),
    });
    const res = await handler({ request: apiRequest(undefined, "GET", `http://test/api/${file}?operatorId=other-op`) });
    assert.equal(res.status, 403);
  });
}

test("consolidated gestao panels enforce conversationReadCondition on conversation-backed queries", () => {
  for (const file of [
    "gestao/overview.ts",
    "gestao/alerts.ts",
    "gestao/audits.ts",
    "gestao/performance.ts",
    "gestao/sla.ts",
    "gestao/contacts-analytics.ts",
    "gestao/my-metrics.ts",
  ]) {
    const source = fs.readFileSync(`src/routes/api/${file}`, "utf8");
    assert.match(source, /conversationReadCondition\(session\)/, `${file} must apply conversationReadCondition(session)`);
  }
});
