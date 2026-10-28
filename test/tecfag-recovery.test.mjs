import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { loadAccessSource, routeStub, apiRequest } from "./helpers/access-harness.mjs";

// This suite cannot import operational DB modules, credentials or network transports.
const schema = loadAccessSource("src/db/schema.ts", { "drizzle-orm": orm, "drizzle-orm/pg-core": pg });
const industrialPolicy = loadAccessSource("src/lib/triage/industrial-policy.ts");
const sitePolicy = loadAccessSource("src/lib/livechat/site-channel-policy.ts", {
  "../triage/industrial-policy.ts": industrialPolicy,
});
const { persistSiteOperatorMessage } = loadAccessSource("src/lib/livechat/site-message-store.ts", {
  "../../db/schema": schema, "drizzle-orm": orm, "./site-channel-policy": sitePolicy,
});
const { WidgetMessageOutbox } = loadAccessSource("tecfag-widget/src/lib/message-outbox.ts");
const structural = loadAccessSource("src/lib/operational-schema.ts");
let client, db;
const tenantId = "recovery-company-a", otherTenant = "recovery-company-b";
const conversationId = "conv-lc-visitor-a";
const input = (key) => ({ tenantId, conversationId, operatorId: "operator-a", operatorName: "Operador teste", text: "Resposta preservada", idempotencyKey: key });

before(async () => {
  client = new PGlite(); db = drizzle(client);
  for (const table of [schema.conversations, schema.contacts, schema.messages, schema.lcChats,
    schema.lcMessages, schema.lcVisitors, schema.tenants, schema.agentConfigs]) {
    const config = pg.getTableConfig(table);
    await client.exec(`CREATE TABLE "${config.name}" (${config.columns.map((column) =>
      `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${["sent_at", "started_at", "created_at", "updated_at"].includes(column.name) ? " DEFAULT CURRENT_TIMESTAMP" : ""}`,
    ).join(",")})`);
  }
  await client.exec("CREATE UNIQUE INDEX idx_messages_tenant_idempotency_uniq ON messages(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL");
  await client.query("INSERT INTO contacts (id,tenant_id,main_channel) VALUES ('contact-a',$1,'livechat')", [tenantId]);
  await client.query("INSERT INTO conversations (id,tenant_id,contact_id,queue_state,operator_id) VALUES ($1,$2,'contact-a','meus','operator-a')", [conversationId, tenantId]);
  await client.query("INSERT INTO lc_visitors (id,tenant_id,cookie_id) VALUES ('visitor-a',$1,'cookie-a')", [tenantId]);
  await client.query("INSERT INTO lc_chats (id,tenant_id,visitor_id,status,operator_id) VALUES ('chat-a',$1,'visitor-a','operator_took_over','operator-a')", [tenantId]);
});
after(async () => { await client?.close(); });

const counts = async () => ({
  canonical: (await db.select({ n: orm.count() }).from(schema.messages))[0].n,
  widget: (await db.select({ n: orm.count() }).from(schema.lcMessages))[0].n,
});
function failInsert(table) {
  return { transaction: (callback) => db.transaction((tx) => callback(new Proxy(tx, {
    get(target, key) {
      if (key === "insert") return (candidate) => {
        if (candidate === table) throw Error("Injected persistence failure");
        return target.insert(candidate);
      };
      const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
    },
  }))) };
}
describe("site: dois historicos atomicos e recuperacao de retry", () => {
  it("falha em qualquer historico nao confirma nem deixa persistencia parcial", async () => {
    const before = await counts();
    for (const table of [schema.messages, schema.lcMessages]) {
      await assert.rejects(persistSiteOperatorMessage(failInsert(table), input(`fail-${pg.getTableConfig(table).name}`)), /Injected persistence failure/);
      assert.deepEqual(await counts(), before);
    }
  });
  it("commit e retry usam os mesmos IDs, conteudo original e chat ja tomado", async () => {
    const first = await persistSiteOperatorMessage(db, input("atomic-a"));
    const before = await counts();
    const retry = await persistSiteOperatorMessage(db, { ...input("atomic-a"), text: "Texto do retry nao substitui original" });
    assert.equal(first.message.id, retry.message.id);
    assert.equal(first.widgetMessage.id, retry.widgetMessage.id);
    assert.equal(retry.widgetMessage.chatId, "chat-a");
    assert.equal(retry.message.status, "accepted");
    assert.equal(retry.widgetMessage.content, "Resposta preservada");
    assert.equal(retry.message.externalId, retry.widgetMessage.id);
    assert.deepEqual(await counts(), before);
  });
  it("linha legada accepted sem historico do widget e reparada", async () => {
    await client.query("INSERT INTO messages (id,tenant_id,conversation_id,provider,sender_type,sender_name,content,status,idempotency_key) VALUES ('legacy-a',$1,$2,'livechat','agent','Operador','Texto legado','accepted','legacy-key')", [tenantId, conversationId]);
    const repaired = await persistSiteOperatorMessage(db, input("legacy-key"));
    assert.equal(repaired.message.id, "legacy-a");
    assert.equal(repaired.widgetMessage.id, "legacy-a-widget");
    assert.equal(repaired.widgetMessage.content, "Texto legado");
    const before = await counts();
    await persistSiteOperatorMessage(db, input("legacy-key"));
    assert.deepEqual(await counts(), before);
  });
  it("retry antigo nao sobrescreve preview recente", async () => {
    await client.query("UPDATE conversations SET last_message_text='Mensagem mais nova' WHERE tenant_id=$1 AND id=$2", [tenantId, conversationId]);
    await persistSiteOperatorMessage(db, input("atomic-a"));
    const [conv] = await db.select().from(schema.conversations).where(orm.and(orm.eq(schema.conversations.tenantId, tenantId), orm.eq(schema.conversations.id, conversationId)));
    assert.equal(conv.lastMessageText, "Mensagem mais nova");
  });
  it("outro tenant ou responsavel alterado nao grava historicos", async () => {
    const before = await counts();
    await assert.rejects(persistSiteOperatorMessage(db, { ...input("foreign"), tenantId: otherTenant }));
    await assert.rejects(persistSiteOperatorMessage(db, { ...input("owner-changed"), operatorId: "operator-b" }));
    assert.deepEqual(await counts(), before);
  });
  it("repeticao concorrente da mesma intencao so cria um par", async () => {
    const before = await counts();
    const results = await Promise.all([persistSiteOperatorMessage(db, input("parallel-key")), persistSiteOperatorMessage(db, input("parallel-key"))]);
    assert.equal(results[0].message.id, results[1].message.id);
    assert.deepEqual(await counts(), { canonical: before.canonical + 1, widget: before.widget + 1 });
  });
});

function deliveryHarness({ notificationFails = false, online = false } = {}) {
  const pushed = [];
  const delivery = loadAccessSource("src/lib/livechat/site-delivery.ts", {
    crypto: { default: crypto }, "drizzle-orm": orm, "../../db": { db }, "../../db/schema": schema,
    "../baileys/session-manager": { SessionManager: { getInstance: () => ({ notifyPublic() { if (notificationFails) throw Error("SSE down"); } }) } },
    "./livechatStorage": {}, "./site-gateway": { siteGateway: { push: (_, __, payload) => { pushed.push(payload); return online; } } },
    "./site-channel-policy": sitePolicy, "./site-message-store": { persistSiteOperatorMessage },
    "../ai-persona": { getAiPersona: () => ({}) },
  });
  return { delivery, pushed };
}
describe("site: publica somente depois do commit", () => {
  it("visitante offline conserva mensagem em ambos os historicos", async () => {
    const h = deliveryHarness();
    const result = await h.delivery.sendSiteOperatorText(input("offline"));
    assert.equal(result.success, true); assert.equal(result.status, "accepted");
    assert.equal(h.pushed.length, 2);
    assert.equal(h.pushed[0].messageId, h.pushed[1].messageId);
  });
  it("queda de notificacao nao converte commit confirmado em falha", async () => {
    const h = deliveryHarness({ notificationFails: true, online: true });
    assert.equal((await h.delivery.sendSiteOperatorText(input("notify-error"))).status, "delivered");
  });
  it("rota nao retorna accepted legado antes de reparar a entrega do site", async () => {
    await client.query("INSERT INTO messages (id,tenant_id,conversation_id,provider,sender_type,sender_name,content,status,idempotency_key) VALUES ('legacy-route',$1,$2,'livechat','agent','Operador','Texto da rota','accepted','route-key')", [tenantId, conversationId]);
    const h = deliveryHarness();
    const route = loadAccessSource("src/routes/api/whatsapp/send.ts", {
      "@tanstack/react-router": routeStub, "../../../db": { db }, "../../../db/schema": schema, "drizzle-orm": orm,
      "../../../lib/auth-session": { requireSession: async () => ({ session: { tenantId, operator: { id: "operator-a", name: "Operador" }, permissions: { chat: {} } } }) },
      "../../../lib/access-control/conversation-access": { requireConversationWriteAccess: async () => null },
      "../../../lib/crm/deal-associations": { syncConversationDeals: async () => true },
      "../../../lib/whatsapp/dispatch": { storedResult() { assert.fail("Site retry must not shortcut"); } },
      "../../../lib/whatsapp/outbound": { outboundQueue: { enqueueAndSend() { assert.fail("No WhatsApp send"); } } },
      "../../../lib/whatsapp/adapters/meta": {}, "../../../lib/whatsapp/meta-template-common": {}, "../../../lib/whatsapp/audio-convert": {},
      "../../../lib/livechat/site-channel-policy": sitePolicy, "../../../lib/livechat/site-delivery": h.delivery,
      "../../../lib/valentina/sdr-debouncer": { SdrDebouncer: { getInstance: () => ({ clearSession() {} }) } },
      "../../../lib/whatsapp/connections": { resolveConversationConnection: async () => ({ provider: "livechat", status: "connected" }) },
      "../../../lib/whatsapp/connection-contacts": {}, fs: {}, path: {},
    }).Route.server.handlers.POST;
    const response = await route({ request: apiRequest({ conversationId, text: "Retry", clientMessageId: "route-key" }) });
    assert.equal(response.status, 200);
    const [widget] = await db.select().from(schema.lcMessages).where(orm.eq(schema.lcMessages.id, "legacy-route-widget"));
    assert.equal(widget.content, "Texto da rota");
  });
});

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key), key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; } };
}
const intent = (id, createdAt = 1000) => ({ id, createdAt, displayText: `Texto ${id}`, payload: { type: "CHAT_MESSAGE", messageId: id, content: `Texto ${id}` } });
describe("widget: envio persistido ate ACK", () => {
  it("offline e F5 conservam intencao e ID; send nao significa ACK", () => {
    const storage = memoryStorage(); let queue = new WidgetMessageOutbox(storage, "scope", 1000);
    queue.enqueue(intent("a"));
    queue = new WidgetMessageOutbox(storage, "scope", 1000);
    const sent = []; queue.sendNext((payload) => sent.push(payload), 1000);
    assert.equal(queue.snapshot().length, 1);
    queue.sendNext((payload) => sent.push(payload), 1001, true);
    assert.deepEqual(sent.map((item) => item.messageId), ["a", "a"]);
    assert.equal(queue.acknowledge("outro"), false);
    assert.equal(queue.acknowledge("a"), true);
    assert.deepEqual(new WidgetMessageOutbox(storage, "scope", 1000).snapshot(), []);
  });
  it("preserva ordem e limita repeticao enquanto aguarda confirmacao", () => {
    const queue = new WidgetMessageOutbox(memoryStorage(), "scope", 1000); const sent = [];
    queue.enqueue(intent("a")); queue.enqueue(intent("b"));
    queue.sendNext((payload) => sent.push(payload.messageId), 1000);
    queue.sendNext((payload) => sent.push(payload.messageId), 1001);
    assert.deepEqual(sent, ["a"]);
    queue.acknowledge("a"); queue.sendNext((payload) => sent.push(payload.messageId), 1002, true);
    assert.deepEqual(sent, ["a", "b"]);
  });
  it("send que lanca excecao mantem intencao para reconexao", () => {
    const queue = new WidgetMessageOutbox(memoryStorage(), "scope", 1000);
    queue.enqueue(intent("a")); assert.equal(queue.sendNext(() => { throw Error("closed"); }, 1000), false);
    assert.equal(queue.snapshot()[0].id, "a");
  });
  it("storage indisponivel impede enviar; expirado exige tentativa explicita", () => {
    const broken = new WidgetMessageOutbox({ ...memoryStorage(), setItem() { throw Error("quota"); } }, "scope", 1000);
    assert.throws(() => broken.enqueue(intent("a")), /quota/); assert.deepEqual(broken.snapshot(), []);
    const storage = memoryStorage(); const queue = new WidgetMessageOutbox(storage, "scope", 1000);
    queue.enqueue(intent("old", 0)); const restored = new WidgetMessageOutbox(storage, "scope", 2 * 86400000);
    assert.equal(restored.sendNext(() => assert.fail("No implicit stale send"), 2 * 86400000), false);
    restored.retry("old", 2 * 86400000); assert.equal(restored.sendNext(() => {}, 2 * 86400000), true);
  });
  it("chaves por empresa/origem/visitante nao compartilham fila", () => {
    const storage = memoryStorage(); const first = new WidgetMessageOutbox(storage, "a/site/visitor", 1000);
    first.enqueue(intent("a")); assert.deepEqual(new WidgetMessageOutbox(storage, "b/site/visitor", 1000).snapshot(), []);
    assert.deepEqual(new WidgetMessageOutbox(storage, "a/other-site/visitor", 1000).snapshot(), []);
  });
  it("duas abas conservam intencoes independentes e observam ACK sem sobrescrever fila", () => {
    const storage = memoryStorage();
    const first = new WidgetMessageOutbox(storage, "scope", 1000);
    const second = new WidgetMessageOutbox(storage, "scope", 1000);
    first.enqueue(intent("a")); second.enqueue(intent("b", 1001));
    assert.deepEqual(first.snapshot().map((entry) => entry.id), ["a", "b"]);
    second.acknowledge("a");
    assert.deepEqual(first.snapshot().map((entry) => entry.id), ["b"]);
  });
});

function compileClassMethods(methodNames, prefix, bindings, file = "src/lib/baileys/session-manager.ts", className = "SessionManager") {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile("session-manager.ts", source, ts.ScriptTarget.Latest, true);
  const members = ast.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === className).members;
  const methods = methodNames.map((name) => { const method = members.find((node) => node.name?.getText(ast) === name); assert.ok(method, name); return method.getText(ast); });
  const code = ts.transpileModule(`export class Subject { ${prefix}\n${methods.join("\n")} }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", ...Object.keys(bindings), code)(module, module.exports, ...Object.values(bindings));
  return module.exports.Subject;
}
function leaseHarness() {
  const timers = [], calls = []; let config = { enabled: true, provider: "baileys", authEncrypted: "test-only" }, failInit = false;
  const fakeTimer = (fn) => { const timer = { fn, cleared: false, unref() {} }; timers.push(timer); return timer; };
  const methods = ["cancelLeaseRecovery", "scheduleLeaseRecovery", "checkConnectionLease", "stopLease", "pauseSession", "initSession"];
  const Subject = compileClassMethods(methods, "", {
    multiConnectionEnabled: () => true, db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => config ? [config] : [] }) }) }) },
    whatsappConnections: schema.whatsappConnections, eq: orm.eq, and: orm.and,
    renewConnectionLease: async () => { calls.push("renew"); throw Error("temporary db outage"); },
    releaseConnectionLease: async () => { calls.push("release"); },
    setTimeout: fakeTimer, clearTimeout: (timer) => { timer.cleared = true; }, clearInterval: () => calls.push("clearLeaseTimer"),
    console: { log() {}, warn() {}, error() {} },
  });
  const subject = Object.assign(new Subject(), {
    connectionId: "connection-a", leaseToken: "old-token", leaseRecoveryVersion: 0, leaseRecoveryTimer: null,
    leaseCheckRunning: false, isShuttingDown: false, leaseTimer: {}, reconnectAttempts: new Map(), initMutex: new Map(),
    sessions: new Map([[tenantId, { end: () => calls.push("closeSocket") }]]), sessionStatuses: new Map([[tenantId, "connected"]]), sessionQrs: new Map(),
    updateConfig: async () => {}, notify() {},
    _doInitSession: async () => { calls.push("acquireBeforeSocket"); if (failInit) throw Error("lease busy"); subject.leaseToken = "new-token"; return {}; },
  });
  return { subject, timers, calls, setConfig: (value) => { config = value; }, setFailInit: (value) => { failInit = value; } };
}
describe("conexao pessoal: recuperacao da posse sem disputa", () => {
  it("falha de renovacao fecha socket e agenda retomada que readquire lease", async () => {
    const h = leaseHarness(); await h.subject.checkConnectionLease(tenantId);
    assert.ok(h.calls.includes("closeSocket")); assert.equal(h.subject.leaseToken, null); assert.equal(h.timers.length, 1);
    await h.timers[0].fn(); assert.equal(h.subject.leaseToken, "new-token"); assert.ok(h.calls.includes("acquireBeforeSocket"));
  });
  it("posse ocupada ou banco ainda indisponivel agenda nova tentativa", async () => {
    const h = leaseHarness(); await h.subject.checkConnectionLease(tenantId); h.setFailInit(true);
    await h.timers[0].fn(); assert.equal(h.timers.length, 2);
    h.setFailInit(false); await h.timers[1].fn(); assert.equal(h.subject.leaseToken, "new-token");
  });
  it("conexao desativada, sem credencial ou Meta nao abre socket", async () => {
    for (const config of [null, { enabled: false }, { enabled: true, provider: "meta", authEncrypted: "x" }, { enabled: true, provider: "baileys", authEncrypted: null }]) {
      const h = leaseHarness(); await h.subject.checkConnectionLease(tenantId); h.setConfig(config); await h.timers[0].fn();
      assert.equal(h.calls.includes("acquireBeforeSocket"), false);
    }
  });
  it("pausa intencional cancela retomada, sessao oficial nao entra neste ciclo", async () => {
    const h = leaseHarness(); await h.subject.checkConnectionLease(tenantId);
    await h.subject.pauseSession(tenantId); await h.timers[0].fn();
    assert.equal(h.calls.includes("acquireBeforeSocket"), false); assert.equal(h.timers[0].cleared, true);
    const official = leaseHarness(); official.subject.connectionId = null; await official.subject.checkConnectionLease(tenantId);
    assert.deepEqual(official.calls, []); assert.deepEqual(official.timers, []);
  });
});

describe("readiness: schema incompleto nao fica verde", () => {
  it("catalogo exigido corresponde a colunas reais do schema", () => {
    for (const [tableName, columnName] of structural.REQUIRED_OPERATIONAL_COLUMNS) {
      const table = Object.values(schema).find((value) => orm.is(value, pg.PgTable) && pg.getTableConfig(value).name === tableName);
      assert.ok(table, tableName); assert.ok(pg.getTableConfig(table).columns.some((column) => column.name === columnName), `${tableName}.${columnName}`);
    }
  });
  it("aceita minimo estrutural, rejeita coluna ausente mesmo com tabelas/indices antigos", async () => {
    const isolated = new PGlite();
    try {
      const grouped = new Map();
      for (const [table, column] of structural.REQUIRED_OPERATIONAL_COLUMNS) grouped.set(table, [...(grouped.get(table) || []), column]);
      for (const [table, columns] of grouped) await isolated.exec(`CREATE TABLE ${table} (${columns.map((column) => `${column} text`).join(",")})`);
      await isolated.exec("CREATE INDEX idx_messages_tenant_idempotency_uniq ON messages (id); CREATE INDEX idx_pending_inbounds_tenant_event_uniq ON pending_inbounds (id)");
      assert.equal((await isolated.query(structural.OPERATIONAL_READINESS_SQL)).rows[0].ready, false);
      await isolated.exec("DROP INDEX idx_messages_tenant_idempotency_uniq; DROP INDEX idx_pending_inbounds_tenant_event_uniq; CREATE UNIQUE INDEX idx_messages_tenant_idempotency_uniq ON messages (tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL; CREATE UNIQUE INDEX idx_pending_inbounds_tenant_event_uniq ON pending_inbounds (tenant_id,external_event_id) WHERE external_event_id IS NOT NULL");
      assert.equal((await isolated.query(structural.OPERATIONAL_READINESS_SQL)).rows[0].ready, true);
      await isolated.exec("ALTER TABLE conversations DROP COLUMN whatsapp_connection_id");
      assert.equal((await isolated.query(structural.OPERATIONAL_READINESS_SQL)).rows[0].ready, false);
    } finally { await isolated.close(); }
  });
});

const drain = () => new Promise((resolve) => setImmediate(resolve));

function widgetHarness(storage = memoryStorage()) {
  const effects = [], states = [], sockets = [], timers = [];
  const session = memoryStorage();
  session.setItem("tecfag_name_confirmed", "true"); session.setItem("tecfag_chat_is_open", "true");
  const react = {
    default: { Fragment: jsx.Fragment },
    useState(initial) {
      const index = states.length; states.push(typeof initial === "function" ? initial() : initial);
      return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useEffect(callback) { effects.push(callback); }, useRef: (value) => ({ current: value }), useCallback: (callback) => callback,
  };
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 0; sent = [];
    constructor() { sockets.push(this); }
    send(value) { if (this.readyState !== 1) throw Error("offline"); this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(payload) { this.onmessage?.({ data: JSON.stringify(payload) }); }
  }
  const noop = () => {}; const Input = () => null;
  const imports = {
    react, "react/jsx-runtime": jsx, "lucide-react": { X: noop, ArrowRight: noop },
    "./ChatHeader": { ChatHeader: noop }, "./ChatBubble": { ChatBubble: noop },
    "./ChatInput": { ChatInput: Input }, "./TypingIndicator": { TypingIndicator: noop },
    "./notifications": { playNotificationSound: noop, requestNotificationPermission: noop, showBrowserNotification: noop },
    "../../config": { BACKEND_URL: "https://backend.test", TENANT_ID: tenantId, buildLiveChatWsUrl: () => "wss://test" },
    "../../lib/message-outbox": { WidgetMessageOutbox },
  };
  const windowStub = { location: { href: "https://shop.test/product-a", search: "" }, addEventListener: noop, removeEventListener: noop };
  const documentStub = { title: "Produto A", referrer: "", addEventListener: noop, removeEventListener: noop, getElementById: () => null };
  const bindings = { localStorage: storage, sessionStorage: session, WebSocket: Socket, window: windowStub, document: documentStub,
    crypto, setInterval: (callback) => { const timer = { callback, cleared: false }; timers.push(timer); return timer; },
    setTimeout: (callback) => { const timer = { callback, cleared: false }; timers.push(timer); return timer; },
    clearInterval: (timer) => { timer.cleared = true; }, clearTimeout: (timer) => { timer.cleared = true; },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(new URL("../tecfag-widget/src/components/ChatWidget/ChatWidget.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", ...Object.keys(bindings), code)((name) => {
    assert.ok(Object.hasOwn(imports, name), name); return imports[name];
  }, module, module.exports, ...Object.values(bindings));
  const tree = module.exports.ChatWidget();
  const find = (value) => {
    if (!value || typeof value !== "object") return null;
    if (value.type === Input) return value;
    for (const child of [value.props?.children].flat(Infinity)) { const found = find(child); if (found) return found; }
    return null;
  };
  const input = find(tree); assert.ok(input);
  const cleanup = effects.map((effect) => effect()).filter((value) => typeof value === "function");
  return { sockets, timers, storage, states, send: input.props.onSendMessage,
    messages: () => states.find((value) => Array.isArray(value) && value.some((item) => item?.id === "welcome-msg")),
    unmount: () => cleanup.reverse().forEach((callback) => callback()) };
}

describe("widget real: socket, confirmacao e remontagem", () => {
  it("offline antes do clique, ACK perdido e remontagem reenviam mesmo ID; ACK limpa intencao", async () => {
    const h = widgetHarness();
    await h.send("Preciso de uma maquina");
    const local = h.messages().find((message) => message.sender === "visitor");
    assert.equal(local.deliveryState, "pending"); assert.deepEqual(h.sockets[0].sent, []);
    h.sockets[0].open();
    const outgoing = h.sockets[0].sent.find((item) => item.type === "CHAT_MESSAGE");
    assert.equal(outgoing.messageId, local.id); assert.equal(outgoing.currentPage, "https://shop.test/product-a");
    h.unmount(); assert.equal(h.sockets.length, 1); assert.ok(h.timers.every((timer) => timer.cleared));
    const restored = widgetHarness(h.storage);
    try {
      restored.sockets[0].open();
      const replay = restored.sockets[0].sent.find((item) => item.type === "CHAT_MESSAGE");
      assert.deepEqual(replay, outgoing);
      restored.sockets[0].receive({ type: "message_ack", messageId: local.id });
      assert.equal(restored.messages().find((message) => message.id === local.id).deliveryState, "confirmed");
      assert.equal([...Array(restored.storage.length)].map((_, index) => restored.storage.key(index)).some((key) => key.startsWith("[\"site-message-outbox-v1\"")), false);
    } finally { restored.unmount(); }
  });
});

describe("worker industrial: ciclo unico, encerramento e opt-in", () => {
  it("registro duplicado nao sobrepoe ciclos; shutdown para novas execucoes", async () => {
    const runtime = loadAccessSource("src/lib/runtime-singleton.ts");
    const worker = loadAccessSource("src/lib/periodic-worker.ts", { "./runtime-singleton": runtime });
    let release, calls = 0;
    const pending = new Promise((resolve) => { release = resolve; });
    const stop = worker.startPeriodicWorker("recovery-test", async () => { calls++; await pending; }, 1);
    try {
      assert.equal(worker.startPeriodicWorker("recovery-test", async () => assert.fail("Duplicate worker"), 1), stop);
      await new Promise((resolve) => setTimeout(resolve, 15));
      assert.equal(calls, 1); assert.equal(worker.getPeriodicWorkerState("recovery-test").running, true);
      stop(); release(); await drain();
      assert.equal(worker.getPeriodicWorkerState("recovery-test"), null);
      const again = worker.startPeriodicWorker("recovery-test", async () => { calls++; }, 10000);
      stop(); // An old close callback must not delete a new registration.
      assert.ok(worker.getPeriodicWorkerState("recovery-test")); again();
      await drain(); assert.equal(calls, 2);
    } finally { stop(); release(); }
  });
  it("falha de ciclo fica observavel sem apagar trabalho nem impedir proximo tick", async () => {
    const runtime = loadAccessSource("src/lib/runtime-singleton.ts");
    const worker = loadAccessSource("src/lib/periodic-worker.ts", { "./runtime-singleton": runtime });
    let calls = 0;
    const stop = worker.startPeriodicWorker("recovery-failure-test", async () => { if (++calls === 1) throw Error("injected"); }, 1);
    try {
      await drain(); assert.ok(worker.getPeriodicWorkerState("recovery-failure-test").lastFailedAt);
      await new Promise((resolve) => setTimeout(resolve, 15));
      assert.ok(calls >= 2); assert.ok(worker.getPeriodicWorkerState("recovery-failure-test").lastSucceededAt);
    } finally { stop(); }
  });
  it("followup seleciona apenas persona industrial com SDR explicitamente habilitado", async () => {
    for (const [id, kind, enabled] of [[tenantId, "industrial", 1], [otherTenant, "legacy", 1], ["disabled-company", "industrial", 0]]) {
      await client.query("INSERT INTO tenants (id,name) VALUES ($1,$1)", [id]);
      await client.query("INSERT INTO agent_configs (id,tenant_id,agent_type,enabled,config) VALUES ($1,$2,'sdr',$3,$4::jsonb)", [`cfg-${id}`, id, enabled, JSON.stringify({ scope: id })]);
    }
    const Subject = compileClassMethods(["runIndustrialFollowupCycle"], "isRunning = false;", {
      db, tenants: schema.tenants, agentConfigs: schema.agentConfigs, eq: orm.eq, and: orm.and,
      getAiPersona: (id) => ({ triagePolicy: id === otherTenant ? "legacy" : "industrial" }),
    }, "src/lib/valentina/sdr-followup-engine.ts", "SdrFollowupEngine");
    const subject = new Subject(); const seen = [];
    subject.runIndustrialSilenceCycle = async (id, config) => seen.push([id, config.scope]);
    await subject.runIndustrialFollowupCycle(); assert.deepEqual(seen, [[tenantId, tenantId]]);
  });
  it("varredura de turnos consulta configuracoes e conversas somente no tenant industrial habilitado", async () => {
    const queries = [];
    const tracedDb = drizzle(client, { logger: { logQuery(query, params) { queries.push({ query, params }); } } });
    const recovery = loadAccessSource("src/lib/valentina/sdr-recovery.ts", {
      "../ai-persona": { isSdrTenant: () => true, getAiPersona: (id) => ({ triagePolicy: id === otherTenant ? "legacy" : "industrial" }) },
      "../../db": { db: tracedDb }, "../../db/schema": schema, "drizzle-orm": orm,
      "./sdr-engine": { SdrEngine: { getInstance() { assert.fail("No eligible conversation"); } } },
      "./sdr-debouncer": {}, "../livechat/site-channel-policy": sitePolicy,
      "../triage/industrial-silence-policy": loadAccessSource("src/lib/triage/industrial-silence-policy.ts"),
    });
    assert.equal(await recovery.recoverIndustrialInterruptedTurns(), 0);
    const configs = queries.filter(({ query }) => query.includes('from "agent_configs"'));
    assert.equal(configs.length, 2);
    assert.ok(configs.every(({ query, params }) => query.includes('"agent_configs"."tenant_id" =') && params[0] !== otherTenant));
    const conversations = queries.filter(({ query }) => query.includes('from "conversations"'));
    assert.equal(conversations.length, 1); assert.equal(conversations[0].params[0], tenantId);
  });
  it("plugin executa recuperacoes e followup, e close durante importacao impede inicio", async () => {
    const runtime = loadAccessSource("src/lib/runtime-singleton.ts");
    const worker = loadAccessSource("src/lib/periodic-worker.ts", { "./runtime-singleton": runtime });
    const calls = []; let close;
    const plugin = loadAccessSource("server/plugins/industrial-triage-recovery.ts", {
      "../../src/db/index": { db }, "../../src/db/schema": schema, "drizzle-orm": orm,
      "../../src/lib/ai-persona": {}, "../../src/lib/valentina/sdr-crm-local": {},
      "../../src/lib/triage/industrial-handoff-store": { createIndustrialHandoffStore: () => ({}) },
      "../../src/lib/triage/industrial-handoff-recovery": {
        recoverIndustrialHandoffs: async () => calls.push("handoff"), recoverIndustrialPostCommitOutbox: async () => calls.push("outbox"),
      },
      "../../src/lib/triage/industrial-post-commit-delivery": {}, "../../src/lib/valentina/sdr-channel-sender": {},
      "../../src/lib/valentina/sdr-recovery": { recoverIndustrialInterruptedTurns: async () => calls.push("turn") },
      "../../src/lib/valentina/industrial-outbound": { recoverIndustrialBotOutbounds: async () => calls.push("bot") },
      "../../src/lib/baileys/session-manager": {}, "../../src/lib/valentina/operator-notifications": {},
      "../../src/lib/valentina/sdr-followup-engine": { SdrFollowupEngine: { getInstance: () => ({ runIndustrialFollowupCycle: async () => calls.push("followup") }) } },
      "../../src/lib/periodic-worker": worker,
    }).default;
    plugin({ hooks: { hook: (name, callback) => { assert.equal(name, "close"); close = callback; } } });
    await drain(); assert.deepEqual(calls, ["handoff", "outbox", "bot", "turn", "followup"]);
    close(); assert.equal(worker.getPeriodicWorkerState("industrial-triage-recovery"), null);
    calls.length = 0;
    plugin({ hooks: { hook: (_, callback) => { close = callback; } } });
    close(); await drain(); assert.deepEqual(calls, []);
    const vite = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    assert.match(vite, /"server\/plugins\/industrial-triage-recovery.ts"/);
    assert.doesNotMatch(vite, /"server\/plugins\/sdr-followup.ts"/);
  });
});
