import { before, beforeEach, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { loadAccessSource } from "./helpers/access-harness.mjs";

// Real PostgreSQL semantics; no operational DB, credentials, AI or transport imports.
const schema = loadAccessSource("src/db/schema.ts", { "drizzle-orm": orm, "drizzle-orm/pg-core": pg });
const industrialPolicy = loadAccessSource("src/lib/triage/industrial-policy.ts");
const sitePolicy = loadAccessSource("src/lib/livechat/site-channel-policy.ts", { "../triage/industrial-policy.ts": industrialPolicy });
const schedule = loadAccessSource("src/lib/triage/industrial-silence-policy.ts");
const envelope = loadAccessSource("src/lib/whatsapp/envelope.ts");
const tenantId = "delivery-company-a", otherTenant = "delivery-company-b";
const persona = { getAiPersona: (id) => id === tenantId ? { name: "Assistente teste", triagePolicy: "industrial" } : { name: "Outro" } };
let client, db, delivery, context, dispatch, providerCalls, socketEvents, notifyFails, sendImpl;
let rejectAcceptedWrite = false;
let conversationId = "conversation-a";
const tables = [schema.tenants, schema.agentConfigs, schema.agentFlowStates, schema.channelConfigs, schema.contacts,
  schema.conversations, schema.messages, schema.mediaFiles, schema.lcVisitors, schema.lcChats, schema.lcMessages];
const list = () => db.select().from(schema.messages).where(orm.and(orm.eq(schema.messages.tenantId, tenantId), orm.eq(schema.messages.senderType, "bot"))).orderBy(orm.asc(schema.messages.sentAt));
const batch = (extra = {}) => ({ tenantId, conversationId, scope: "reply", items: [{ text: "Primeiro fragmento" }, { text: "Segundo fragmento" }], ...extra });

before(async () => {
  client = new PGlite(); db = drizzle(client);
  await client.exec("SET TIME ZONE 'UTC'");
  for (const table of tables) {
    const config = pg.getTableConfig(table);
    await client.exec(`CREATE TABLE "${config.name}" (${config.columns.map((column) =>
      `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${["created_at", "started_at", "sent_at", "updated_at"].includes(column.name) ? " DEFAULT CURRENT_TIMESTAMP" : ""}`,
    ).join(",")})`);
  }
  await client.exec("CREATE UNIQUE INDEX idx_messages_tenant_idempotency_uniq ON messages(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL");
  const metaPolicy = loadAccessSource("src/lib/whatsapp/meta-policy.ts", { "../../db": { db }, "../../db/schema": schema, "drizzle-orm": orm });
  context = loadAccessSource("src/lib/valentina/industrial-delivery-context.ts", {
    "../../db": { db }, "../../db/schema": schema, "drizzle-orm": orm, "../ai-persona": persona,
    "../livechat/site-channel-policy": sitePolicy, "../whatsapp/meta-policy": metaPolicy, "../triage/industrial-silence-policy": schedule,
  });
  const manager = { SessionManager: { getInstance: () => ({ notifyPublic() { if (notifyFails) throw Error("SSE unavailable"); } }) } };
  const adapter = { send: async (_, payload) => {
    const [stored] = await db.select().from(schema.messages).where(orm.and(orm.eq(schema.messages.tenantId, tenantId), orm.eq(schema.messages.status, "sending")));
    assert.ok(stored, "Provider must see a persisted claimed envelope");
    assert.equal(stored.metaDetails.version, 1); assert.equal(stored.metaDetails.industrialDelivery.version, 1);
    if (payload.mediaUrl) assert.equal((await db.select().from(schema.mediaFiles)).length, 1, "Image bytes persisted before send");
    providerCalls.push({ payload, stored });
    return sendImpl(payload);
  } };
  const dispatchDb = new Proxy(db, { get(target, key) {
    if (key === "update") return (table) => ({ set: (values) => {
      if (rejectAcceptedWrite && values.status === "accepted") throw Error("DB failed after external acceptance");
      return target.update(table).set(values);
    } });
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  dispatch = loadAccessSource("src/lib/whatsapp/dispatch.ts", {
    "../../db": { db: dispatchDb }, "../../db/schema": schema, "drizzle-orm": orm,
    "./adapters/meta": { metaAdapter: adapter }, "./adapters/baileys": { baileysAdapter: adapter }, "./envelope": envelope,
    "./meta-status": { replayPendingMetaStatuses: async () => {} }, "./meta-presence": { resetMetaTypingThrottle() {} },
    "../commercial/tma": { recordCommercialFirstResponse() { assert.fail("Bot must not record human TMA"); } },
    "../baileys/session-manager": manager, "./connection-policy": { baileysStanzaId: (value) => value },
    "./connections": { resolveConversationConnection: async () => {
      const [channel] = await db.select().from(schema.channelConfigs).where(orm.eq(schema.channelConfigs.tenantId, tenantId));
      return { provider: channel.activeProvider, connectionId: null, status: "connected" };
    } }, "../valentina/industrial-delivery-context": context,
  });
  delivery = loadDelivery(db, manager);
});
function loadDelivery(database, manager = { SessionManager: { getInstance: () => ({ notifyPublic() {} }) } }) {
  return loadAccessSource("src/lib/valentina/industrial-outbound.ts", {
    "../../db": { db: database }, "../../db/schema": schema, "drizzle-orm": orm, "../ai-persona": persona,
    "../livechat/site-gateway": { siteGateway: { push: (_, __, payload) => { socketEvents.push(payload); return false; } } },
    "../livechat/site-channel-policy": sitePolicy, "../baileys/session-manager": manager,
    "../whatsapp/dispatch": dispatch, "../whatsapp/envelope": envelope, "./industrial-delivery-context": context,
  });
}
beforeEach(async () => {
  conversationId = "conversation-a"; providerCalls = []; socketEvents = []; notifyFails = false;
  rejectAcceptedWrite = false;
  sendImpl = async () => ({ status: "accepted", externalId: `external-${providerCalls.length}` });
  for (const table of tables.toReversed()) await client.exec(`TRUNCATE "${pg.getTableConfig(table).name}"`);
  await client.query("INSERT INTO tenants(id,name) VALUES ($1,'Empresa teste'),($2,'Outra empresa')", [tenantId, otherTenant]);
  await client.query("INSERT INTO channel_configs(id,tenant_id,active_provider) VALUES ('channel-a',$1,'meta')", [tenantId]);
  await client.query("INSERT INTO agent_configs(id,tenant_id,agent_type,enabled,config) VALUES ('config-a',$1,'sdr',1,$2::jsonb)",
    [tenantId, JSON.stringify({ industrialSchedule: { enabled: false }, siteChannelEnabled: true })]);
  await client.query("INSERT INTO contacts(id,tenant_id,phone,main_channel) VALUES ('contact-a',$1,'5511999999999','whatsapp')", [tenantId]);
  await client.query("INSERT INTO conversations(id,tenant_id,contact_id,queue_state) VALUES ($1,$2,'contact-a','automacao')", [conversationId, tenantId]);
  await client.query("INSERT INTO agent_flow_states(id,tenant_id,conversation_id,agent_type,outcome,started_at) VALUES ('flow-a',$1,$2,'sdr','in_progress',NOW()-INTERVAL '30 minutes')", [tenantId, conversationId]);
  await client.query("INSERT INTO messages(id,tenant_id,conversation_id,sender_type,sender_name,content,is_internal_note,provider,direction,status,meta_details,sent_at) VALUES ('in-a',$1,$2,'client','Cliente','Pergunta',false,'meta','inbound','accepted','{}',NOW()-INTERVAL '1 minute')", [tenantId, conversationId]);
});
after(async () => { await client?.close(); });

async function park(extra = {}) {
  await assert.rejects(delivery.sendIndustrialBotBatch(batch({ ...extra, beforeSend: async () => { throw Error("Crash before dispatch"); } })), /Crash before dispatch/);
  assert.equal(providerCalls.length, 0); return list();
}
async function useSite() {
  conversationId = "conv-lc-visitor-a";
  await client.query("UPDATE conversations SET id=$1 WHERE tenant_id=$2", [conversationId, tenantId]);
  await client.query("UPDATE agent_flow_states SET conversation_id=$1 WHERE tenant_id=$2", [conversationId, tenantId]);
  await client.query("UPDATE messages SET conversation_id=$1,provider='livechat' WHERE tenant_id=$2", [conversationId, tenantId]);
  await client.query("INSERT INTO lc_visitors(id,tenant_id,cookie_id) VALUES ('visitor-a',$1,'visitor-cookie')", [tenantId]);
  await client.query("INSERT INTO lc_chats(id,tenant_id,visitor_id,status) VALUES ('chat-a',$1,'visitor-a','active')", [tenantId]);
}

describe("bot industrial: intencao antes de qualquer despacho", () => {
  it("falha ao persistir lote/imagem nao envia nem deixa bytes orfaos", async () => {
    const broken = new Proxy(db, { get(target, key) {
      if (key === "transaction") return (callback) => db.transaction((tx) => callback(new Proxy(tx, { get(transaction, method) {
        if (method === "insert") return (table) => { if (table === schema.messages) throw Error("Injected DB failure"); return transaction.insert(table); };
        const value = transaction[method]; return typeof value === "function" ? value.bind(transaction) : value;
      } })));
      const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
    } });
    const subject = loadDelivery(broken);
    await assert.rejects(subject.sendIndustrialBotBatch(batch({ items: [{ text: "Foto", image: { buffer: Buffer.from("image-test"), mimeType: "image/png", fileName: "foto.png" } }] })), /Injected DB failure/);
    assert.equal(providerCalls.length, 0); assert.deepEqual(await list(), []); assert.deepEqual(await db.select().from(schema.mediaFiles), []);
  });
  it("reinicio antes do primeiro despacho recupera todos os fragmentos na ordem", async () => {
    const rows = await park(); assert.equal(rows.length, 2);
    await delivery.recoverIndustrialBotOutbounds();
    assert.deepEqual(providerCalls.map(({ payload }) => payload.text), ["Primeiro fragmento", "Segundo fragmento"]);
    assert.ok((await list()).every((row) => row.status === "accepted"));
  });
  it("queda entre fragmentos recupera somente o restante e conserva primeira confirmacao", async () => {
    let calls = 0;
    await assert.rejects(delivery.sendIndustrialBotBatch(batch({ beforeSend: async () => { if (++calls === 2) throw Error("Crash between fragments"); } })), /Crash between fragments/);
    assert.deepEqual((await list()).map((row) => row.status), ["accepted", "pending"]);
    await delivery.recoverIndustrialBotOutbounds();
    assert.deepEqual(providerCalls.map(({ payload }) => payload.text), ["Primeiro fragmento", "Segundo fragmento"]);
  });
  it("saudacao, resposta e imagem do mesmo turno ja estao persistidas antes do primeiro envio", async () => {
    const items = [{ text: "Ola" }, { text: "Sou o assistente" }, { text: "Segue a resposta" },
      { text: "", image: { buffer: Buffer.from("catalog"), mimeType: "image/png", fileName: "foto.png" } }];
    await park({ items });
    assert.equal((await list()).length, 4); assert.equal((await db.select().from(schema.mediaFiles)).length, 1);
    await delivery.recoverIndustrialBotOutbounds();
    assert.equal(providerCalls.length, 4); assert.equal(providerCalls[3].payload.mediaType, "image");
  });
  it("retry/reclassificacao reutiliza conteudo e grupo originais sem criar fragmentos extras", async () => {
    const first = await delivery.sendIndustrialBotBatch(batch()); assert.equal(first.sent, true);
    const ids = (await list()).map((row) => row.id);
    assert.equal((await delivery.sendIndustrialBotBatch(batch({ items: [{ text: "Resposta nova" }, { text: "Extra" }, { text: "Mais" }] }))).sent, true);
    assert.deepEqual((await list()).map((row) => row.id), ids); assert.equal(providerCalls.length, 2);
  });
  it("aceitacao externa perdida fica desconhecida e cancela continuacao sem repetir envio", async () => {
    sendImpl = async () => { throw Error("Connection lost after acceptance"); };
    assert.equal((await delivery.sendIndustrialBotBatch(batch())).sent, false);
    assert.equal((await list())[0].status, "unknown");
    await delivery.recoverIndustrialBotOutbounds(); await delivery.sendIndustrialBotBatch(batch());
    assert.equal(providerCalls.length, 1); assert.equal((await list())[1].status, "failed");
  });
  it("falha de banco depois da aceitacao externa conserva identidade e exige revisao", async () => {
    rejectAcceptedWrite = true;
    assert.equal((await delivery.sendIndustrialBotBatch(batch())).sent, false);
    assert.equal((await list())[0].status, "unknown");
    rejectAcceptedWrite = false; await delivery.recoverIndustrialBotOutbounds();
    assert.equal(providerCalls.length, 1); assert.equal((await list()).length, 2);
    assert.deepEqual((await list()).map((row) => row.status), ["unknown", "failed"]);
  });
  it("lease expirada de envio interrompido nao vira retry cego", async () => {
    const rows = await park();
    await client.query("UPDATE messages SET status='sending',lease_token='abandoned',lease_until=NOW()-INTERVAL '1 minute',updated_at=NOW()-INTERVAL '6 minutes' WHERE id=$1", [rows[0].id]);
    await delivery.recoverIndustrialBotOutbounds(); assert.equal(providerCalls.length, 0);
    assert.deepEqual((await list()).map((row) => row.status), ["unknown", "failed"]);
  });
  it("duas tentativas simultaneas mantem uma identidade por fragmento", async () => {
    await Promise.all([delivery.sendIndustrialBotBatch(batch()), delivery.sendIndustrialBotBatch(batch())]);
    await delivery.recoverIndustrialBotOutbounds();
    assert.equal((await list()).length, 2); assert.equal(providerCalls.length, 2);
  });
  it("imagem WhatsApp persiste bytes e envelope antes da chamada externa", async () => {
    assert.equal((await delivery.sendIndustrialBotBatch(batch({ items: [{ text: "Catalogo", image: { buffer: Buffer.from("image-test"), mimeType: "image/png", fileName: "foto.png" } }] }))).sent, true);
    assert.equal(providerCalls[0].payload.mediaType, "image"); assert.match(providerCalls[0].payload.mediaUrl, /messageId=bot-durable-/);
    assert.equal(providerCalls[0].stored.senderType, "bot");
  });
  it("SSE indisponivel nao converte aceitacao confirmada em resultado desconhecido", async () => {
    notifyFails = true;
    assert.equal((await delivery.sendIndustrialBotBatch(batch())).sent, true);
    assert.ok((await list()).every((row) => row.status === "accepted")); assert.equal(providerCalls.length, 2);
  });
  it("interrupcao apos persistencia cancela fragmentos ainda nao despachados", async () => {
    const controller = new AbortController();
    assert.equal((await delivery.sendIndustrialBotBatch(batch({ signal: controller.signal, beforeSend: async () => controller.abort() }))).sent, false);
    assert.equal(providerCalls.length, 0); assert.ok((await list()).every((row) => row.status === "failed"));
  });
});

describe("bot industrial: contexto revalidado ao retomar", () => {
  for (const [name, mutate] of [
    ["responsavel mudou", () => client.query("UPDATE conversations SET operator_id='human-a',queue_state='meus' WHERE tenant_id=$1", [tenantId])],
    ["ciclo mudou", () => client.query("UPDATE agent_flow_states SET started_at=NOW() WHERE tenant_id=$1", [tenantId])],
    ["canal mudou", () => client.query("UPDATE channel_configs SET active_provider='baileys' WHERE tenant_id=$1", [tenantId])],
    ["SDR desativado", () => client.query("UPDATE agent_configs SET enabled=0 WHERE tenant_id=$1", [tenantId])],
    ["conversa finalizada", () => client.query("UPDATE conversations SET queue_state='finalizados' WHERE tenant_id=$1", [tenantId])],
    ["fila mudou sem atribuir operador", () => client.query("UPDATE conversations SET queue_state='fila' WHERE tenant_id=$1", [tenantId])],
    ["telefone do contato mudou", () => client.query("UPDATE contacts SET phone='5511888888888' WHERE tenant_id=$1", [tenantId])],
    ["identidade Meta mudou", () => client.query("UPDATE contacts SET whatsapp_user_id='another-user' WHERE tenant_id=$1", [tenantId])],
    ["janela Meta fechou", () => client.query("UPDATE messages SET sent_at=NOW()-INTERVAL '25 hours' WHERE sender_type='client' AND tenant_id=$1", [tenantId])],
    ["cliente mandou nova mensagem", () => client.query("INSERT INTO messages(id,tenant_id,conversation_id,sender_type,is_internal_note,sent_at) VALUES ('in-new',$1,$2,'client',false,NOW())", [tenantId, conversationId])],
    ["humano ja respondeu", () => client.query("INSERT INTO messages(id,tenant_id,conversation_id,sender_type,is_internal_note,sent_at) VALUES ('human-new',$1,$2,'agent',false,NOW()+INTERVAL '1 minute')", [tenantId, conversationId])],
  ]) it(`${name}: preserva registros e nao despacha resposta antiga`, async () => {
    await park(); await mutate(); await delivery.recoverIndustrialBotOutbounds();
    assert.equal(providerCalls.length, 0, JSON.stringify((await db.select({ id: schema.messages.id, time: schema.messages.sentAt, sender: schema.messages.senderType }).from(schema.messages)))); assert.ok((await list()).every((row) => row.status === "failed"));
  });
  it("outro tenant nao encontra contexto nem despacha uma identidade alheia", async () => {
    const rows = await park();
    assert.equal(await delivery.dispatchIndustrialMessage(otherTenant, rows[0].id), null);
    assert.equal((await delivery.sendIndustrialBotBatch(batch({ tenantId: otherTenant }))).sent, false);
    assert.equal(providerCalls.length, 0); assert.equal((await list()).length, 2);
  });
  it("recuperacao fora do expediente adia e mantem intencao, sem enviar", async () => {
    const rows = await park();
    await client.query("UPDATE agent_configs SET config=$1::jsonb WHERE tenant_id=$2", [JSON.stringify({ industrialSchedule: { enabled: true, workDays: [0], startHour: 1, endHour: 2, timezone: "UTC" } }), tenantId]);
    const result = await context.validateIndustrialDelivery({ ...rows[0], retryCount: 1 }, new Date("2026-10-27T12:00:00Z"));
    assert.equal(result.decision, "defer"); assert.equal(providerCalls.length, 0);
  });
  it("turno ja obsoleto antes de persistir nao ganha identidade da mensagem nova", async () => {
    const [flow] = await db.select().from(schema.agentFlowStates);
    const result = await delivery.sendIndustrialBotBatch(batch({ context: { flowId: flow.id, cycle: flow.startedAt.toISOString(), triggerId: "old-trigger" } }));
    assert.equal(result.sent, false); assert.deepEqual(await list(), []); assert.equal(providerCalls.length, 0);
  });
  it("mensagens do mesmo lote com timestamp empatado usam identidade canonica sem rejeitar o turno", async () => {
    const [flow] = await db.select().from(schema.agentFlowStates);
    await client.query("INSERT INTO messages(id,tenant_id,conversation_id,sender_type,is_internal_note,provider,direction,sent_at) SELECT 'in-z',tenant_id,conversation_id,'client',false,'meta','inbound',sent_at FROM messages WHERE id='in-a'");
    const result = await delivery.sendIndustrialBotBatch(batch({ context: { flowId: flow.id, cycle: flow.startedAt.toISOString(), triggerIds: ["in-z", "in-a"] } }));
    assert.equal(result.sent, true); assert.equal((await list())[0].metaDetails.industrialDelivery.triggerId, "in-z");
  });
});

function realMethod(file, className, methodName, bindings) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const type = ast.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === className);
  const method = type.members.find((node) => node.name?.getText(ast) === methodName); assert.ok(method);
  const code = ts.transpileModule(`export class Subject { ${method.getText(ast)} }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", ...Object.keys(bindings), code)(module, module.exports, ...Object.values(bindings));
  return new module.exports.Subject();
}
describe("integracao com engine e silencio", () => {
  it("metodo real da engine entrega grupo completo e contexto ao caminho duravel", async () => {
    const calls = [];
    const subject = realMethod("src/lib/valentina/sdr-engine.ts", "SdrEngine", "sendHumanizedBotMessages", {
      getAiPersona: persona.getAiPersona, sendBotPresence: async () => {},
      require: (name) => { assert.equal(name, "./industrial-outbound"); return { sendIndustrialBotBatch: async (input) => { calls.push(input); return { sent: false, reason: "unknown" }; } }; },
    });
    const snapshot = { flowId: "flow-a", cycle: "2026-10-27T12:00:00.000Z", triggerId: "in-a", scope: "greeting" };
    await assert.rejects(subject.sendHumanizedBotMessages(tenantId, conversationId, "phone", [" Um ", "Dois"], undefined, null, "in-a", null, snapshot), /unknown/);
    assert.deepEqual(calls[0].items, [{ text: "Um", quotedMessageId: "in-a" }, { text: "Dois", quotedMessageId: undefined }]);
    assert.equal(calls[0].scope, "greeting"); assert.equal(calls[0].context, snapshot);
  });
  it("silencio nao progride enquanto a resposta do turno aguarda entrega ou revisao", async () => {
    await park();
    let evaluated = false; const errors = [], queries = [];
    const tracedDb = drizzle(client, { logger: { logQuery(query) { queries.push(query); } } });
    const subject = realMethod("src/lib/valentina/sdr-followup-engine.ts", "SdrFollowupEngine", "runIndustrialSilenceCycle", {
      db: tracedDb, ...schema, ...orm, ...schedule, getAiPersona: persona.getAiPersona,
      SdrDebouncer: { getInstance: () => ({ isBusy: () => false }) },
      console: { log() {}, error: (...args) => errors.push(args) },
      evaluateIndustrialSilence() { evaluated = true; return { action: "none" }; },
    });
    await subject.runIndustrialSilenceCycle(tenantId, { industrialSchedule: { enabled: false } });
    assert.equal(evaluated, false); assert.deepEqual(errors, []); assert.ok(queries.some((query) => query.includes("industrialDelivery")));
    assert.equal(providerCalls.length, 0);
  });
  for (const changed of [false, true]) it(`rollback de followup ${changed ? "preserva interacao concorrente" : "restaura claim sem alteracao concorrente"}`, async () => {
    const now = new Date(), previous = new Date(now.getTime() - 25 * 60_000), newer = new Date(now.getTime() + 1000);
    const original = { followUpStage: 0, clientField: "original" };
    await client.query("UPDATE agent_flow_states SET metadata=$1::jsonb,last_interaction_at=$2", [JSON.stringify(original), previous.toISOString()]);
    let called = false; const errors = [];
    const subject = realMethod("src/lib/valentina/sdr-followup-engine.ts", "SdrFollowupEngine", "runIndustrialSilenceCycle", {
      db, ...schema, ...orm, ...schedule, getAiPersona: persona.getAiPersona,
      SdrDebouncer: { getInstance: () => ({ isBusy: () => false }) },
      console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
      evaluateIndustrialSilence: () => ({ action: "send_followup", nextStage: 1 }),
      deterministicIndustrialFollowUpMessageId: () => "followup-test",
      sendSdrChannelText: async (input) => {
        called = true; assert.equal(input.deliveryContext.triggerId, "in-a");
        if (changed) await client.query("UPDATE agent_flow_states SET metadata=$1::jsonb,last_interaction_at=$2", [JSON.stringify({ followUpStage: 0, clientField: "new-value" }), newer.toISOString()]);
        return { sent: false };
      },
    });
    await subject.runIndustrialSilenceCycle(tenantId, { industrialSchedule: { enabled: false } }, now);
    assert.equal(called, true); assert.deepEqual(errors, []);
    const [flow] = await db.select().from(schema.agentFlowStates);
    assert.deepEqual(flow.metadata, changed ? { followUpStage: 0, clientField: "new-value" } : original);
    assert.equal(flow.lastInteractionAt.toISOString(), (changed ? newer : previous).toISOString());
  });
});

describe("site industrial: commit antes do socket", () => {
  it("texto offline grava ambos os historicos e retry nao duplica", async () => {
    await useSite(); assert.equal((await delivery.sendIndustrialBotBatch(batch())).sent, true);
    assert.equal(providerCalls.length, 0); assert.equal((await db.select().from(schema.lcMessages)).length, 2);
    assert.ok((await list()).every((row) => row.status === "accepted" && row.externalId));
    await delivery.sendIndustrialBotBatch(batch()); assert.equal(socketEvents.length, 4);
  });
  it("falha na segunda persistencia preserva pending e recovery conclui sem duplicar", async () => {
    await useSite(); await park();
    await client.exec("DROP TABLE lc_messages");
    await assert.rejects(delivery.recoverIndustrialBotOutbounds()); assert.equal(socketEvents.length, 0);
    assert.ok((await list()).every((row) => row.status === "pending"));
    const config = pg.getTableConfig(schema.lcMessages);
    await client.exec(`CREATE TABLE lc_messages (${config.columns.map((column) => `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`).join(",")})`);
    await delivery.recoverIndustrialBotOutbounds(); assert.equal(socketEvents.length, 4);
  });
  it("imagem conserva bytes, historico canonico e widget antes da publicacao", async () => {
    await useSite();
    const result = await delivery.sendIndustrialBotBatch(batch({ items: [{ text: "", image: { buffer: Buffer.from("site-image"), mimeType: "image/png", fileName: "foto.png", publicUrl: "/knowledge-media/foto.png" } }] }));
    assert.equal(result.sent, true); assert.equal((await db.select().from(schema.mediaFiles))[0].base64Data, Buffer.from("site-image").toString("base64"));
    assert.equal(socketEvents[0].imageUrl, "/knowledge-media/foto.png");
    assert.equal(socketEvents[1].content, "[Anexo_Cliente: /knowledge-media/foto.png]");
    assert.equal((await db.select().from(schema.lcMessages))[0].id, (await list())[0].externalId);
  });
});
