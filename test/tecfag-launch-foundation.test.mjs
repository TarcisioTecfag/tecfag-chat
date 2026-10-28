import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as jsx from "react/jsx-runtime";
import { loadAccessSource, routeStub, apiRequest } from "./helpers/access-harness.mjs";

// Never import the operational DB, read environment files or call an external provider.
const schema = loadAccessSource("src/db/schema.ts", { "drizzle-orm": orm, "drizzle-orm/pg-core": pg });
const rbac = loadAccessSource("src/lib/rbac.ts");
const tenant = "launch-test-a";
const otherTenant = "launch-test-b";
let client, db, access, engine;
const principal = () => ({
  tenantId: tenant,
  operator: { id: "seller-a", name: "Consultor de teste", role: "agent" },
  permissions: {
    views: { chat: true, valentina: true, analytics: true, crm: true },
    chat: { canViewAllChats: false, restrictToOwnChats: true },
    valentina: { canAccessChat: true },
    analytics: { canAccessPerformance: true },
    crm: { canViewCrm: true, canViewAllDeals: false, pipelineScope: "all" },
  },
  accessGroup: { allowedChannels: ["whatsapp"] },
});

before(async () => {
  client = new PGlite();
  db = drizzle(client);
  // Real column definitions, only persistence/SELECT behavior is under test here.
  // No production migrations or foreign keys are executed by this read-only fixture.
  for (const table of [schema.conversations, schema.contacts, schema.messages, schema.sectors,
    schema.responseTimeLogs, schema.whatsappConnections, schema.whatsappConnectionGroupAccess,
    schema.crmAccounts, schema.crmConversationDeals, schema.crmDeals, schema.crmPipelines,
    schema.crmStages, schema.crmDealProducts, schema.crmDealActivities,
    schema.crmCustomFieldDefinitions, schema.agentFlowStates, schema.mediaFiles]) {
    const config = pg.getTableConfig(table);
    await client.exec(`CREATE TABLE "${config.name}" (${config.columns.map((column) => `"${column.name}" ${column.getSQLType()}`).join(",")})`);
  }
  for (const [id, t] of [["contact-a", tenant], ["contact-b", tenant], ["contact-foreign", otherTenant]]) {
    await client.query("INSERT INTO contacts (id,tenant_id,name,main_channel) VALUES ($1,$2,$3,'whatsapp')", [id, t, id]);
  }
  for (const [id, t, contact, owner] of [["chat-a", tenant, "contact-a", "seller-a"],
    ["chat-b", tenant, "contact-b", "seller-b"], ["chat-foreign", otherTenant, "contact-foreign", "seller-a"]]) {
    await client.query("INSERT INTO conversations (id,tenant_id,contact_id,operator_id,queue_state,sector_id,created_at,last_message_time) VALUES ($1,$2,$3,$4,'finalizados','sector-a',NOW(),NOW())", [id, t, contact, owner]);
  }
  await client.query("INSERT INTO sectors (id,tenant_id,name) VALUES ('sector-a',$1,'Equipe real'),('sector-empty',$1,'Sem amostra'),('foreign-sector',$2,'Outro tenant')", [tenant, otherTenant]);
  await client.query("INSERT INTO response_time_logs (id,tenant_id,conversation_id,response_time_seconds,is_overdue,created_at) VALUES ('log-a',$1,'chat-a',30,false,NOW()),('log-b',$1,'chat-a',90,true,NOW()),('log-hidden',$1,'chat-b',10000,true,NOW()),('log-foreign',$2,'chat-foreign',20000,true,NOW())", [tenant, otherTenant]);
  await client.query("INSERT INTO messages (id,tenant_id,conversation_id,content,sender_type,sender_name,is_internal_note,sent_at) VALUES ('message-a',$1,'chat-a','Preciso de uma seladora','client','Cliente',false,NOW()),('message-hidden',$1,'chat-b','CONTEUDO ALHEIO','client','Outro',false,NOW())", [tenant]);
  await client.query("INSERT INTO agent_flow_states (id,tenant_id,conversation_id,collected_data,current_step,last_interaction_at) VALUES ('flow-a',$1,'chat-a','{\"maquina\":\"Seladora de teste\"}'::jsonb,'qualificacao',NOW())", [tenant]);
  await client.query("INSERT INTO crm_pipelines (id,tenant_id,name) VALUES ('pipeline-a',$1,'Industrial')", [tenant]);
  await client.query("INSERT INTO crm_stages (id,tenant_id,pipeline_id,name) VALUES ('stage-a',$1,'pipeline-a','Orcamento')", [tenant]);
  await client.query("INSERT INTO crm_deals (id,tenant_id,pipeline_id,stage_id,operator_id,title,value,status,updated_at) VALUES ('deal-a',$1,'pipeline-a','stage-a','seller-a','Negocio autorizado',1500,'open',NOW()),('deal-hidden',$1,'pipeline-a','stage-a','seller-b','NEGOCIO ALHEIO',9999,'open',NOW())", [tenant]);
  await client.query("INSERT INTO crm_conversation_deals (id,tenant_id,conversation_id,deal_id,is_active) VALUES ('link-a',$1,'chat-a','deal-a',true),('link-hidden',$1,'chat-a','deal-hidden',true)", [tenant]);
  await client.query("INSERT INTO crm_deal_products (id,tenant_id,deal_id,name,quantity,total_price) VALUES ('product-a',$1,'deal-a','Produto real',1,1500)", [tenant]);
  await client.query("UPDATE contacts SET phone = '5511999999999' WHERE tenant_id = $1 AND id = 'contact-a'", [tenant]);
  await client.query("INSERT INTO conversations (id,tenant_id,contact_id,operator_id,queue_state,created_at,last_message_time) VALUES ('chat-upload',$1,'contact-a','seller-a','meus',NOW(),NOW())", [tenant]);
  await client.query("INSERT INTO media_files (id,tenant_id,conversation_id,file_name,file_size,base64_data,mime_type) VALUES ('media-old',$1,'chat-b','contrato.pdf',4,'QUFBQQ==','application/pdf')", [tenant]);
  access = loadAccessSource("src/lib/access-control/conversation-access.ts", {
    "../../db": { db }, "../../db/schema": schema, "drizzle-orm": orm,
  });
  const customFields = loadAccessSource("src/lib/crm/custom-fields.ts", {
    "../../db": { db }, "../../db/schema": schema, "drizzle-orm": orm,
  });
  engine = loadAccessSource("src/lib/valentina/assistant-engine.ts", {
    "../../db": { db }, "../../db/schema": schema, "drizzle-orm": orm,
    "../access-control/conversation-access": access, "../rbac": rbac,
    "../ai-persona": {}, "./knowledge-service": {}, "../crm/custom-fields": customFields,
    "./grammar-corrector": {},
  });
});
after(async () => { await client?.close(); });

function performance(session = principal(), connection = db) {
  return loadAccessSource("src/routes/api/gestao/performance.ts", {
    "@tanstack/react-router": routeStub, "../../../db": { db: connection },
    "../../../db/schema": schema, "drizzle-orm": orm,
    "../../../lib/auth-session": { requireSession: async () => ({ session }) },
    "../../../lib/access-control/conversation-access": access,
  }).Route.server.handlers.GET;
}

describe("desempenho com SQL real e sem dados fabricados", () => {
  it("calcula setores sem erro de agregacao e respeita tenant/visibilidade", async () => {
    const response = await performance()({ request: apiRequest(undefined, "GET") });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.sectors.find((item) => item.name === "Equipe real"), {
      name: "Equipe real", completed: 1, avgResponse: 60, slaPct: 50,
    });
    assert.deepEqual(result.sectors.find((item) => item.name === "Sem amostra"), {
      name: "Sem amostra", completed: 0, avgResponse: null, slaPct: null,
    });
    assert.equal(result.sectors.some((item) => item.name === "Outro tenant"), false);
  });
  it("nao cria setores ou SLA perfeito para empresa sem configuracao", async () => {
    const session = principal(); session.tenantId = "empty-test-tenant";
    const result = await (await performance(session)({ request: apiRequest(undefined, "GET") })).json();
    assert.deepEqual(result.sectors, []);
  });
  it("indisponibilidade do banco e erro, nao 200 com graficos vazios", async () => {
    const response = await performance(principal(), { select() { throw Error("isolated database outage"); } })({ request: apiRequest(undefined, "GET") });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Não foi possível carregar os indicadores de desempenho.", code: "PERFORMANCE_UNAVAILABLE" });
  });
});

describe("contexto real do Fagner", () => {
  it("carrega historico, triagem e produto usando o schema vigente sem revelar negocio alheio", async () => {
    const result = await engine.loadConversationRichContext({ session: principal(), conversationId: "chat-a" });
    assert.match(result.visibleTranscript, /Preciso de uma seladora/);
    assert.match(result.crmAndContactContext, /Seladora de teste/);
    assert.match(result.crmAndContactContext, /Produto real/);
    assert.match(result.crmAndContactContext, /Negocio autorizado/);
    assert.doesNotMatch(result.crmAndContactContext, /NEGOCIO ALHEIO/);
  });
  it("reaplica visibilidade na consulta e nao inclui conversa de outro dono ou tenant", async () => {
    for (const conversationId of ["chat-b", "chat-foreign"]) {
      const result = await engine.loadConversationRichContext({ session: principal(), conversationId });
      assert.equal(result.visibleTranscript, "");
      assert.equal(result.crmAndContactContext, "");
    }
  });
  it("sem acesso CRM mantem transcript autorizado e omite negocios/produtos", async () => {
    const session = principal(); session.permissions.views.crm = false;
    const result = await engine.loadConversationRichContext({ session, conversationId: "chat-a" });
    assert.match(result.visibleTranscript, /Preciso de uma seladora/);
    assert.doesNotMatch(result.crmAndContactContext, /Negocio autorizado|Produto real/);
  });
});

function assistantRoute({ session = principal(), authenticated = true } = {}) {
  const calls = [];
  const dependencies = {
    "@tanstack/react-router": routeStub,
    "../../../lib/auth-session": { requireSession: async () => authenticated ? { session } : { response: Response.json({}, { status: 401 }) } },
    "../../../lib/ai-persona": { getAiPersona: () => ({ name: "Assistente teste", chatFeatureKey: "fagner_chat" }) },
    "../../../lib/access-control/conversation-access": { requireConversationAccess: async (...args) => { calls.push("access"); return access.requireConversationAccess(...args); } },
    "../../../lib/vertex-ai": { vertexAi: { isReady: () => false, generateText: async (prompt, model, signal, context) => { calls.push({ prompt, context }); return "Sugestao autorizada"; } } },
    "../../../lib/valentina/assistant-engine": {
      loadConversationRichContext: async (params) => { calls.push("context"); return engine.loadConversationRichContext(params); },
      buildBestResponsePrompt: async ({ richContext }) => richContext.visibleTranscript + richContext.crmAndContactContext,
      buildLeadSummaryPrompt: ({ richContext }) => richContext.visibleTranscript,
      expandPtBrAbbreviationsAndAccents: (text) => text,
    },
  };
  const post = loadAccessSource("src/routes/api/valentina/assistant.ts", dependencies).Route.server.handlers.POST;
  return { calls, run: (body) => post({ request: apiRequest(body) }) };
}
describe("autorizacao do assistente antes de contexto ou IA", () => {
  it("nega sessao ausente e permissao explicita negativa inclusive para admin", async () => {
    for (const role of ["agent", "admin"]) {
      const session = principal(); session.operator.role = role; session.permissions.valentina.canAccessChat = false;
      const h = assistantRoute({ session });
      assert.equal((await h.run({ action: "best_response", conversationId: "chat-a" })).status, 403);
      assert.deepEqual(h.calls, []);
    }
    const h = assistantRoute({ authenticated: false });
    assert.equal((await h.run({ action: "grammar_fix" })).status, 401);
    assert.deepEqual(h.calls, []);
  });
  it("IDs alheios nao chegam ao contexto nem ao Vertex", async () => {
    for (const conversationId of ["chat-b", "chat-foreign"]) {
      const h = assistantRoute();
      assert.equal((await h.run({ action: "best_response", conversationId, tenantId: otherTenant })).status, 404);
      assert.deepEqual(h.calls, ["access"]);
    }
  });
  it("usa sessao, nao tenant ou nome do operador fornecidos pelo body", async () => {
    const h = assistantRoute();
    const response = await h.run({ action: "best_response", conversationId: "chat-a", tenantId: otherTenant, operatorName: "Falso" });
    assert.equal(response.status, 200);
    assert.equal(h.calls[2].context.tenantId, tenant);
    assert.match(h.calls[2].prompt, /Preciso de uma seladora/);
    assert.doesNotMatch(h.calls[2].prompt, /CONTEUDO ALHEIO|NEGOCIO ALHEIO/);
  });
  it("nao aceita contexto sem atendimento e valida parametros antes da consulta", async () => {
    for (const body of [{ action: "lead_summary" }, { action: "best_response", conversationId: "valentina" },
      { action: "grammar_fix", currentText: {} }, { action: "unknown", conversationId: "chat-a" }]) {
      const h = assistantRoute();
      assert.equal((await h.run(body)).status, 400);
      assert.deepEqual(h.calls, []);
    }
  });
});

function extracted(relative, predicate) {
  const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) { if (!found && predicate(node)) found = node; ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(found, `Nao encontrou comportamento em ${relative}`);
  return found.getText(ast);
}
function compileExpression(expression, bindings) {
  const js = ts.transpileModule(`export const run = ${expression};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", ...Object.keys(bindings), js)(module, module.exports,
    (name) => { assert.equal(name, "react/jsx-runtime"); return jsx; }, ...Object.values(bindings));
  return module.exports.run;
}

describe("respostas rapidas nos chamadores desktop e mobile", () => {
  for (const relative of ["src/components/chat/ChatPanel.tsx", "src/components/mobile/MobileMessageInput.tsx"]) {
    it(`${relative}: selecao, filtro e CRUD usam os callbacks operacionais`, async () => {
      const calls = [];
      let text = "/orc";
      const spy = (name) => async (...args) => { calls.push([name, ...args]); };
      const element = extracted(relative, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === "QuickResponsesPopover");
      const render = compileExpression(`() => (${element})`, {
        QuickResponsesPopover: () => null, showQuickMenu: true, showQuickTemplates: true,
        quickResponses: [], templates: [], text, canManageGlobalTemplates: true,
        operatorProfile: { name: "Consultor" }, activeChat: { name: "Cliente" },
        setText: (update) => { text = update(text); }, setShowQuickMenu() {}, setShowQuickTemplates() {},
        selectQuickResponse: spy("select"), createTemplate: spy("createPersonal"), updateTemplate: spy("updatePersonal"), deleteTemplate: spy("deletePersonal"),
        createQuickResponse: spy("createGlobal"), updateQuickResponse: spy("updateGlobal"), deleteQuickResponse: spy("deleteGlobal"),
      });
      const { props } = render();
      assert.equal(props.slashFilterText, "orc");
      assert.equal(props.operatorName, "Consultor");
      await props.onSelectResponse("Resposta <<1>> para <<2>>");
      if (relative.includes("mobile")) assert.equal(text, "Resposta Consultor para Cliente");
      else assert.deepEqual(calls[0], ["select", "Resposta <<1>> para <<2>>"]);
      for (const [name, args] of [["onCreateGlobal", [{ shortcut: "/x", text: "Texto" }]], ["onUpdateGlobal", ["qr", { text: "Editado" }]],
        ["onDeleteGlobal", ["qr"]], ["onCreateIndividual", ["Titulo", "Texto"]], ["onUpdateIndividual", ["tpl", "Novo", "Texto"]], ["onDeleteIndividual", ["tpl"]]]) {
        await props[name](...args);
      }
      assert.deepEqual(calls.slice(-6).map((item) => item[0]), ["createGlobal", "updateGlobal", "deleteGlobal", "createPersonal", "updatePersonal", "deletePersonal"]);
    });
  }
});

describe("tarefas nao confirmam falha HTTP", () => {
  for (const relative of ["src/components/chat/TasksView.tsx", "src/components/chat/MonitorView.tsx"]) {
    for (const status of [403, 404, 500]) it(`${relative}: HTTP ${status} reverte conclusao e informa erro`, async () => {
      const task = { id: "task-a", status: "pending" };
      let tasks = [task]; const errors = [];
      const expression = extracted(relative, (node) => ts.isVariableDeclaration(node) && node.name.getText() === "toggleTaskStatus");
      const fn = compileExpression(expression.slice(expression.indexOf("=") + 1), {
        tenant, setTasks: (update) => { tasks = update(tasks); },
        fetch: async () => Response.json({ error: "Falha controlada" }, { status }),
        toast: { error: (message) => errors.push(message) },
      });
      await fn(task);
      assert.equal(tasks[0].status, "pending");
      assert.deepEqual(errors, ["Falha controlada"]);
    });
    it(`${relative}: completed reabre como pending com persistencia confirmada`, async () => {
      const task = { id: "task-a", status: "completed" }; let tasks = [task], payload;
      const expression = extracted(relative, (node) => ts.isVariableDeclaration(node) && node.name.getText() === "toggleTaskStatus");
      const fn = compileExpression(expression.slice(expression.indexOf("=") + 1), {
        tenant, setTasks: (update) => { tasks = update(tasks); },
        fetch: async (_, options) => { payload = JSON.parse(options.body); return Response.json({ success: true }); },
        toast: { error() { assert.fail("Nao deveria apresentar erro"); } },
      });
      await fn(task); assert.equal(tasks[0].status, "pending"); assert.equal(payload.status, "pending");
    });
  }
});

describe("consulta CNPJ da conta", () => {
  it("aceita o contrato valid/details, preenche ficha e preserva dados ja digitados", async () => {
    const state = {}; const messages = [];
    const expression = extracted("src/components/crm/AccountDetailModal.tsx", (node) => ts.isVariableDeclaration(node) && node.name.getText() === "handleQueryReceita");
    const details = { telefone: "11999999999", email: "cnpj@example.test", atividadesSecundarias: "Atividade secundaria", qsa: "Socio", municipio: "Sao Paulo" };
    const fn = compileExpression(expression.slice(expression.indexOf("=") + 1), {
      document: "11222333000181", phone: "Telefone digitado", email: "",
      fetchCnpjInfo: async () => ({ valid: true, cleanCnpj: "11222333000181", cnpjFormatted: "11.222.333/0001-81", razaoSocial: "Empresa teste", nomeFantasia: "Fantasia", details }),
      maskPhone: (phone) => phone,
      setIsSearchingCnpj: (value) => { state.loading = value; }, setName: (value) => { state.name = value; }, setTradeName: (value) => { state.tradeName = value; },
      setPhone: () => assert.fail("Nao sobrescrever telefone digitado"), setEmail: (value) => { state.email = value; },
      setCnpjDetails: (update) => { state.details = update({ capitalSocial: "100" }); },
      toast: { error: (value) => messages.push(["error", value]), warning: (value) => messages.push(["warning", value]), success: (value) => messages.push(["success", value]) },
    });
    await fn();
    assert.equal(state.name, "Empresa teste"); assert.equal(state.email, details.email);
    assert.equal(state.details.qsa, "Socio"); assert.equal(state.details.capitalSocial, "100");
    assert.equal(state.details.municipio, "Sao Paulo"); assert.equal(state.loading, false);
    assert.equal(messages.length, 1); assert.equal(messages[0][0], "success");
  });
});

function uploadRoute() {
  const sent = [];
  const post = loadAccessSource("src/routes/api/whatsapp/send.ts", {
    "@tanstack/react-router": routeStub,
    "../../../lib/crm/deal-associations": { syncConversationDeals: async () => true },
    "../../../lib/whatsapp/outbound": { outboundQueue: { enqueueAndSend: async (payload) => { sent.push(payload); return { success: true, status: "accepted", messageId: "uploaded-message" }; } } },
    "../../../lib/whatsapp/dispatch": { storedResult: (row) => ({ success: true, status: row.status, messageId: row.id }) },
    "../../../lib/auth-session": { requireSession: async () => ({ session: principal() }) },
    "../../../db": { db }, "../../../db/schema": schema, "drizzle-orm": orm,
    "../../../lib/whatsapp/adapters/meta": {}, "../../../lib/whatsapp/meta-template-common": {},
    "../../../lib/whatsapp/audio-convert": {}, "../../../lib/livechat/site-channel-policy": { SITE_CHANNEL: "livechat" },
    "../../../lib/livechat/site-delivery": {},
    "../../../lib/valentina/sdr-debouncer": { SdrDebouncer: { getInstance: () => ({ clearSession() {} }) } },
    "../../../lib/access-control/conversation-access": access,
    "../../../lib/whatsapp/connections": { resolveConversationConnection: async () => ({ provider: "meta", status: "connected" }) },
    "../../../lib/whatsapp/connection-contacts": {},
    fs: { default: { existsSync: () => true } }, path: { default: { join: (...parts) => parts.join("/") } },
  }).Route.server.handlers.POST;
  return {
    sent,
    async upload(conversationId, content, clientMessageId) {
      const data = new FormData();
      data.set("conversationId", conversationId);
      data.set("file", new Blob([content], { type: "application/pdf" }), "contrato.pdf");
      if (clientMessageId) data.set("clientMessageId", clientMessageId);
      return post({ request: new Request("http://test.local/api/whatsapp/send", { method: "POST", body: data }) });
    },
    async reuse(mediaUrl) {
      return post({ request: apiRequest({ conversationId: "chat-upload", mediaUrl, mediaType: "document" }) });
    },
  };
}
describe("anexo correto, sem deduplicacao por nome/tamanho", () => {
  it("novo PDF com mesmo nome/tamanho de outra conversa preserva ambos os conteudos", async () => {
    const h = uploadRoute();
    const response = await h.upload("chat-upload", "BBBB");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.notEqual(body.mediaId, "media-old");
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].tenantId, tenant);
    assert.equal(h.sent[0].mediaUrl, `/api/baileys/media?messageId=${body.mediaId}`);
    const [fresh] = await db.select().from(schema.mediaFiles).where(orm.eq(schema.mediaFiles.id, body.mediaId));
    const [old] = await db.select().from(schema.mediaFiles).where(orm.eq(schema.mediaFiles.id, "media-old"));
    assert.equal(fresh.conversationId, "chat-upload");
    assert.equal(Buffer.from(fresh.base64Data, "base64").toString(), "BBBB");
    assert.equal(Buffer.from(old.base64Data, "base64").toString(), "AAAA");
  });
  it("sem acesso ao atendimento nao grava o upload nem enfileira envio", async () => {
    const h = uploadRoute();
    const before = await db.select({ total: orm.count() }).from(schema.mediaFiles);
    assert.equal((await h.upload("chat-b", "CCCC")).status, 404);
    assert.deepEqual(await db.select({ total: orm.count() }).from(schema.mediaFiles), before);
    assert.equal(h.sent.length, 0);
  });
  it("URL de anexo de conversa alheia continua bloqueada", async () => {
    const h = uploadRoute();
    assert.equal((await h.reuse("/api/baileys/media?messageId=media-old")).status, 404);
    assert.equal(h.sent.length, 0);
  });
  it("retry de mensagem ja persistida nao cria nova midia nem envia novamente", async () => {
    await client.query("INSERT INTO messages (id,tenant_id,conversation_id,idempotency_key,status) VALUES ('stored-upload',$1,'chat-upload','upload-key','accepted')", [tenant]);
    const h = uploadRoute();
    const before = await db.select({ total: orm.count() }).from(schema.mediaFiles);
    const response = await h.upload("chat-upload", "DDDD", "upload-key");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).messageId, "stored-upload");
    assert.deepEqual(await db.select({ total: orm.count() }).from(schema.mediaFiles), before);
    assert.equal(h.sent.length, 0);
  });
});
