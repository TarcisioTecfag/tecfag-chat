import crypto from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import {
  tenants,
  operators,
  authSessions,
  contacts,
  conversations,
  messages,
  channelConfigs,
  pendingInbounds,
} from "../src/db/schema";
import { eq, and, inArray } from "drizzle-orm";

// Rotas a serem testadas diretamente
import { Route as ProfileRoute } from "../src/routes/api/operators/profile";
import { Route as OperatorsRoute } from "../src/routes/api/operators";
import { Route as ContactsRoute } from "../src/routes/api/contacts";
import { Route as TagTaskRoute } from "../src/routes/api/chats/tag-task";
import { Route as SendRoute } from "../src/routes/api/whatsapp/send";
import { Route as MetaWebhookRoute } from "../src/routes/api/webhooks/meta";

// =====================================================================
// TRAVA DE SEGURANÇA MANDATÓRIA: BANCO EXCLUSIVO DE TESTE
// =====================================================================
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error("\n🛑 ERRO CRÍTICO DE SEGURANÇA: TEST_DATABASE_URL NÃO CONFIGURADA!");
  console.error("Esta suíte de testes de integração manipula esquemas e dados de teste,");
  console.error("e é ESTRITAMENTE PROIBIDA de rodar contra o banco operacional ou de desenvolvimento.\n");
  console.error("Para executar, configure um banco dedicado de testes na variável de ambiente:");
  console.error("Exemplo: TEST_DATABASE_URL=postgres://postgres:123@localhost:5432/valemchat_test\n");
  process.exit(1);
}

// Validar que a URL realmente aponta para um banco de teste
const parsedUrl = new URL(testDatabaseUrl.replace(/^postgres:/, "http:"));
const dbName = parsedUrl.pathname.replace(/^\//, "");
if (!dbName.toLowerCase().includes("test")) {
  console.error(`\n🛑 ERRO CRÍTICO DE SEGURANÇA: O banco '${dbName}' NÃO parece ser um banco exclusivo de teste!`);
  console.error("O nome da base de dados DEVE conter a palavra 'test' (ex: valemchat_test). Operação cancelada.\n");
  process.exit(1);
}

// Conectar exclusivamente à base de teste
const sqlClient = postgres(testDatabaseUrl, { max: 5, prepare: false });
const db = drizzle(sqlClient, { schema });

const TEST_ID = `test_e1_${Date.now()}`;
let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean, details?: any) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`, details ? details : "");
    failed++;
  }
}

async function getHandlers(route: any) {
  return route.options.server.handlers;
}

// Função auxiliar para criar sessão de teste isolada
async function createTestSession(tenantId: string, operatorId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const sessionId = `sess-${TEST_ID}-${Math.random().toString(36).substring(2, 8)}`;

  await db.insert(authSessions).values({
    id: sessionId,
    tenantId,
    operatorId,
    tokenHash,
    expiresAt,
    createdAt: new Date(),
  });

  return { sessionId, token, expiresAt };
}

async function main() {
  console.log("\n=======================================================");
  console.log("  SUÍTE DE TESTES DE INTEGRAÇÃO FUNCIONAL — ENTREGA 1");
  console.log(`  Banco de Testes: ${dbName} (${parsedUrl.host})`);
  console.log(`  Lote de Execução: ${TEST_ID}`);
  console.log("=======================================================\n");

  const cleanupIds = {
    operators: [] as string[],
    sessions: [] as string[],
    contacts: [] as string[],
    conversations: [] as string[],
    messages: [] as string[],
    pendingInbounds: [] as string[],
    channelConfigs: [] as string[],
  };

  // Snapshot do canal pré-existente para restauração exata
  let originalTecfagChannelSnapshot: any = null;

  try {
    // -----------------------------------------------------------------
    // 0. SETUP: Garantir tenants e operadores isolados na base de teste
    // -----------------------------------------------------------------
    console.log("0. Configurando dados isolados na base de testes...");

    // Garantir existência dos tenants
    const [valemT] = await db.select().from(tenants).where(eq(tenants.id, "valem"));
    if (!valemT) await db.insert(tenants).values({ id: "valem", name: "Valem Test" });

    const [tecfagT] = await db.select().from(tenants).where(eq(tenants.id, "tecfag"));
    if (!tecfagT) await db.insert(tenants).values({ id: "tecfag", name: "Tecfag Test" });

    // Operadores
    const valemAdminId = `${TEST_ID}_valem_adm`;
    const valemAgentId = `${TEST_ID}_valem_agt`;
    const tecfagAdminId = `${TEST_ID}_tecfag_adm`;
    const tecfagAgentId = `${TEST_ID}_tecfag_agt`;

    await db.insert(operators).values([
      {
        id: valemAdminId,
        tenantId: "valem",
        name: "Valem Admin Test",
        email: `${valemAdminId}@test.com`,
        role: "admin",
        passwordHash: "hash_admin_valem",
      },
      {
        id: valemAgentId,
        tenantId: "valem",
        name: "Valem Agent Test",
        email: `${valemAgentId}@test.com`,
        role: "agent",
        passwordHash: "hash_agent_valem",
      },
      {
        id: tecfagAdminId,
        tenantId: "tecfag",
        name: "Tecfag Admin Test",
        email: `${tecfagAdminId}@test.com`,
        role: "admin",
        passwordHash: "hash_admin_tecfag",
      },
      {
        id: tecfagAgentId,
        tenantId: "tecfag",
        name: "Tecfag Agent Test",
        email: `${tecfagAgentId}@test.com`,
        role: "agent",
        passwordHash: "hash_agent_tecfag",
      },
    ]);
    cleanupIds.operators.push(valemAdminId, valemAgentId, tecfagAdminId, tecfagAgentId);

    // Sessões
    const sValemAdmin = await createTestSession("valem", valemAdminId);
    const sValemAgent = await createTestSession("valem", valemAgentId);
    const sTecfagAdmin = await createTestSession("tecfag", tecfagAdminId);
    const sTecfagAgent = await createTestSession("tecfag", tecfagAgentId);
    cleanupIds.sessions.push(sValemAdmin.sessionId, sValemAgent.sessionId, sTecfagAdmin.sessionId, sTecfagAgent.sessionId);

    // Contatos e Conversas
    const valemContactId = `${TEST_ID}_valem_ct`;
    const valemConvId = `${TEST_ID}_valem_cv`;
    await db.insert(contacts).values({
      id: valemContactId,
      tenantId: "valem",
      name: "Cliente Valem Test",
      phone: "5511999990001",
      mainChannel: "whatsapp",
      rdCrmDealId: "deal_valem_123",
    });
    cleanupIds.contacts.push(valemContactId);

    await db.insert(conversations).values({
      id: valemConvId,
      tenantId: "valem",
      contactId: valemContactId,
      operatorId: valemAgentId,
      queueState: "meus",
    });
    cleanupIds.conversations.push(valemConvId);

    const tecfagContactId = `${TEST_ID}_tecfag_ct`;
    const tecfagConvId = `${TEST_ID}_tecfag_cv`;
    await db.insert(contacts).values({
      id: tecfagContactId,
      tenantId: "tecfag",
      name: "Cliente Tecfag Test",
      phone: "5511999990002",
      mainChannel: "whatsapp",
      rdCrmDealId: "deal_tecfag_456",
    });
    cleanupIds.contacts.push(tecfagContactId);

    await db.insert(conversations).values({
      id: tecfagConvId,
      tenantId: "tecfag",
      contactId: tecfagContactId,
      operatorId: tecfagAgentId,
      queueState: "meus",
    });
    cleanupIds.conversations.push(tecfagConvId);

    // Snapshot e Configuração do Canal Meta de Teste
    const testMetaPhoneId = `meta_pid_${TEST_ID}`;
    const testMetaSecret = `secret_${TEST_ID}`;
    const [existingChannel] = await db
      .select()
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, "tecfag"));

    if (existingChannel) {
      originalTecfagChannelSnapshot = { ...existingChannel };
      await db
        .update(channelConfigs)
        .set({ metaPhoneNumberId: testMetaPhoneId, metaAppSecret: testMetaSecret })
        .where(eq(channelConfigs.id, existingChannel.id));
    } else {
      const newCfgId = `cfg_${TEST_ID}`;
      await db.insert(channelConfigs).values({
        id: newCfgId,
        tenantId: "tecfag",
        metaPhoneNumberId: testMetaPhoneId,
        metaAppSecret: testMetaSecret,
      });
      cleanupIds.channelConfigs.push(newCfgId);
    }

    console.log("Setup inicial da base de teste concluído com sucesso.\n");

    // Obter handlers
    const profileH = await getHandlers(ProfileRoute);
    const operatorsH = await getHandlers(OperatorsRoute);
    const contactsH = await getHandlers(ContactsRoute);
    const tagTaskH = await getHandlers(TagTaskRoute);
    const sendH = await getHandlers(SendRoute);
    const webhookH = await getHandlers(MetaWebhookRoute);

    // -----------------------------------------------------------------
    // 1. PATCH /api/operators/profile
    // -----------------------------------------------------------------
    console.log("--- Bloco 1: PATCH /api/operators/profile ---");

    // 1.1 Sem sessão -> 401
    {
      const req = new Request("http://localhost/api/operators/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nome Invasor" }),
      });
      const res = await profileH.PATCH({ request: req });
      assert("1.1 Rejeita sem sessão com 401", res.status === 401);
    }

    // 1.2 Atendente comum edita próprio perfil -> 200, sem passwordHash no retorno
    {
      const req = new Request("http://localhost/api/operators/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sValemAgent.token}`,
        },
        body: JSON.stringify({ name: "Nome Atualizado pelo Atendente", status: "ocupado" }),
      });
      const res = await profileH.PATCH({ request: req });
      const data = await res.json();
      assert("1.2 Atendente comum edita perfil próprio com 200 OK", res.status === 200);
      assert("1.2 Nome atualizado corretamente", data.name === "Nome Atualizado pelo Atendente");
      assert("1.2 Status atualizado corretamente", data.status === "ocupado");
      assert("1.2 passwordHash NÃO está presente na resposta", data.passwordHash === undefined);

      const [dbOp] = await db.select().from(operators).where(eq(operators.id, valemAgentId));
      assert("1.2 Registro alterado no banco de dados", dbOp.name === "Nome Atualizado pelo Atendente");
    }

    // 1.3 Tentativa de elevação de privilégio (role ou groupId) -> ignorado
    {
      const req = new Request("http://localhost/api/operators/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sValemAgent.token}`,
        },
        body: JSON.stringify({ role: "admin", groupId: "group-admin", name: "Tentativa Escalada" }),
      });
      const res = await profileH.PATCH({ request: req });
      assert("1.3 Responde 200 na atualização", res.status === 200);

      const [dbOp] = await db.select().from(operators).where(eq(operators.id, valemAgentId));
      assert("1.3 Role permanece 'agent' inalterada no banco", dbOp.role === "agent");
    }

    // -----------------------------------------------------------------
    // 2. POST & GET /api/operators
    // -----------------------------------------------------------------
    console.log("\n--- Bloco 2: POST & GET /api/operators ---");

    // 2.1 Atendente comum tenta criar operador -> 403 Forbidden
    {
      const req = new Request("http://localhost/api/operators", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sValemAgent.token}`,
        },
        body: JSON.stringify({
          id: `${TEST_ID}_illegal_op`,
          name: "Operador Ilegal",
          email: "illegal@test.com",
          password: "plain_password",
        }),
      });
      const res = await operatorsH.POST({ request: req });
      assert("2.1 Atendente comum é bloqueado com 403 ao tentar criar operador", res.status === 403);
    }

    // 2.2 Admin cria operador com sucesso
    const createdOpId = `${TEST_ID}_legal_op`;
    {
      const req = new Request("http://localhost/api/operators", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sValemAdmin.token}`,
        },
        body: JSON.stringify({
          id: createdOpId,
          name: "Novo Atendente Valem",
          email: `${createdOpId}@test.com`,
          password: "senha_segura_123",
          role: "agent",
        }),
      });
      const res = await operatorsH.POST({ request: req });
      assert("2.2 Admin cria operador com sucesso", res.status === 200 || res.status === 201);
      cleanupIds.operators.push(createdOpId);

      const [createdInDb] = await db.select().from(operators).where(eq(operators.id, createdOpId));
      assert("2.2 Operador gravado no tenant correto", createdInDb?.tenantId === "valem");
      assert("2.2 Senha gravada como hash e não em texto plano", createdInDb?.passwordHash !== "senha_segura_123");
    }

    // 2.3 GET /api/operators filtra por tenant e não vaza passwordHash
    {
      const reqValem = new Request("http://localhost/api/operators", {
        headers: { Authorization: `Bearer ${sValemAdmin.token}` },
      });
      const resValem = await operatorsH.GET({ request: reqValem });
      const listValem = await resValem.json();

      assert("2.3 GET Valem retorna status 200", resValem.status === 200);
      assert("2.3 Operadores retornados pertencem ao tenant 'valem'",
        listValem.every((o: any) => o.tenantId === "valem")
      );
      assert("2.3 Nenhum operador retornado possui o campo passwordHash",
        listValem.every((o: any) => o.passwordHash === undefined)
      );

      const reqTecfag = new Request("http://localhost/api/operators", {
        headers: { Authorization: `Bearer ${sTecfagAdmin.token}` },
      });
      const resTecfag = await operatorsH.GET({ request: reqTecfag });
      const listTecfag = await resTecfag.json();

      assert("2.3 GET Tecfag retorna status 200", resTecfag.status === 200);
      assert("2.3 Operadores retornados pertencem ao tenant 'tecfag'",
        listTecfag.every((o: any) => o.tenantId === "tecfag")
      );
      assert("2.3 Nenhum operador da Valem aparece na listagem da Tecfag",
        !listTecfag.some((o: any) => o.tenantId === "valem")
      );
    }

    // -----------------------------------------------------------------
    // 3. POST /api/contacts
    // -----------------------------------------------------------------
    console.log("\n--- Bloco 3: POST /api/contacts ---");

    // 3.1 Sem sessão -> 401
    {
      const req = new Request("http://localhost/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Contato Anônimo", phone: "5511999990003" }),
      });
      const res = await contactsH.POST({ request: req });
      assert("3.1 Rejeita criação de contato sem sessão com 401", res.status === 401);
    }

    // 3.2 Com sessão Tecfag tentando passar tenantId: "valem" no body -> gravado em tecfag
    {
      const req = new Request("http://localhost/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sTecfagAgent.token}`,
        },
        body: JSON.stringify({
          name: "Contato Injetado",
          phone: "5511999990004",
          tenantId: "valem",
        }),
      });
      const res = await contactsH.POST({ request: req });
      const data = await res.json();
      assert("3.2 Contato criado com 201", res.status === 201);
      if (data?.contactId) cleanupIds.contacts.push(data.contactId);
      if (data?.conversationId) cleanupIds.conversations.push(data.conversationId);

      const [createdContact] = await db.select().from(contacts).where(eq(contacts.id, data.contactId));
      assert("3.2 Contato gravado estritamente no tenant da sessão ('tecfag')", createdContact?.tenantId === "tecfag");
    }

    // -----------------------------------------------------------------
    // 4. POST /api/chats/tag-task
    // -----------------------------------------------------------------
    console.log("\n--- Bloco 4: POST /api/chats/tag-task ---");

    // 4.1 Sessão Tecfag tenta marcar tag em conversa da Valem -> 404 Not Found
    {
      const req = new Request("http://localhost/api/chats/tag-task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sTecfagAgent.token}`,
        },
        body: JSON.stringify({
          conversationId: valemConvId,
          tagName: "Negociação",
        }),
      });
      const res = await tagTaskH.POST({ request: req });
      assert("4.1 Conversa de outro tenant é rejeitada com 404 (query com id AND tenantId)", res.status === 404);
    }

    // -----------------------------------------------------------------
    // 5. POST /api/whatsapp/send
    // -----------------------------------------------------------------
    console.log("\n--- Bloco 5: POST /api/whatsapp/send ---");

    // 5.1 Outro atendente tenta enviar na conversa alheia -> 403 Forbidden
    const otherAgentConvId = `${TEST_ID}_other_conv`;
    await db.insert(conversations).values({
      id: otherAgentConvId,
      tenantId: "tecfag",
      contactId: tecfagContactId,
      operatorId: tecfagAdminId, // Pertence ao Admin, não ao Agent
      queueState: "meus",
    });
    cleanupIds.conversations.push(otherAgentConvId);

    {
      const req = new Request("http://localhost/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sTecfagAgent.token}`,
        },
        body: JSON.stringify({
          conversationId: otherAgentConvId,
          text: "Mensagem invasora de atendente sem posse",
        }),
      });
      const res = await sendH.POST({ request: req });
      assert("5.1 Atendente comum é bloqueado com 403 ao tentar enviar em conversa de outro operador", res.status === 403);
    }

    // 5.2 Conversa de outro tenant -> 404
    {
      const req = new Request("http://localhost/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sValemAdmin.token}`,
        },
        body: JSON.stringify({
          conversationId: tecfagConvId,
          text: "Tentativa de envio cross-tenant",
        }),
      });
      const res = await sendH.POST({ request: req });
      assert("5.2 Conversa de outro tenant não é encontrada para envio (404)", res.status === 404);
    }

    // -----------------------------------------------------------------
    // 6. POST /api/webhooks/meta (HMAC, IDs Determinísticos & Recuperação)
    // -----------------------------------------------------------------
    console.log("\n--- Bloco 6: POST /api/webhooks/meta ---");

    // 6.1 Sem assinatura -> 401
    {
      const req = new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry: [] }),
      });
      const res = await webhookH.POST({ request: req });
      assert("6.1 Rejeita webhook sem assinatura com 401", res.status === 401);
    }

    // 6.2 Assinatura inválida -> 401
    {
      const payload = JSON.stringify({
        entry: [{ changes: [{ value: { metadata: { phone_number_id: testMetaPhoneId } } }] }],
      });
      const req = new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": "sha256=assinatura_forjada_invalida",
        },
        body: payload,
      });
      const res = await webhookH.POST({ request: req });
      assert("6.2 Rejeita assinatura inválida com 401", res.status === 401);
    }

    // 6.3 Payload sem nenhum phone_number_id -> 400
    {
      const payload = JSON.stringify({
        entry: [{ changes: [{ value: { something: "unknown" } }] }],
      });
      const req = new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": "sha256=qualquer_hash",
        },
        body: payload,
      });
      const res = await webhookH.POST({ request: req });
      assert("6.3 Lote sem phone_number_id retorna 400 (impossível validar assinatura)", res.status === 400);
    }

    // 6.4 Change com mensagens mas sem phone_number_id:
    // Status 'pending' (para o recovery worker), ID determinístico (sem multiplicação em retries) e resposta 500
    {
      const testMsgId = `wamid_det_${TEST_ID}`;
      const payloadObj = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "wha_test",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: { phone_number_id: testMetaPhoneId },
                  messages: [],
                },
              },
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  messages: [
                    {
                      id: testMsgId,
                      from: "5511988887777",
                      type: "text",
                      text: { body: "Mensagem que deve ir para recovery" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const rawPayload = JSON.stringify(payloadObj);
      const hmac = crypto.createHmac("sha256", testMetaSecret).update(rawPayload, "utf8").digest("hex");
      const validSig = `sha256=${hmac}`;

      // Primeira tentativa
      const req1 = new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": validSig },
        body: rawPayload,
      });
      const res1 = await webhookH.POST({ request: req1 });
      assert("6.4 Responde HTTP 500 (falha recuperável para retry da Meta)", res1.status === 500);

      const expectedOrphanEventId = `meta:tecfag:orphan:msg:${testMsgId}`;
      const [savedInbound1] = await db
        .select()
        .from(pendingInbounds)
        .where(
          and(
            eq(pendingInbounds.tenantId, "tecfag"),
            eq(pendingInbounds.externalEventId, expectedOrphanEventId)
          )
        );

      assert("6.4 Evento foi gravado em pending_inbounds", savedInbound1 !== undefined);
      assert("6.4 Evento gravado com status 'pending' para o recovery worker reprocessar", savedInbound1?.status === "pending");
      assert("6.4 Contagem inicial de tentativas é 1", savedInbound1?.attempts === 1);
      if (savedInbound1?.id) cleanupIds.pendingInbounds.push(savedInbound1.id);

      // Segunda tentativa (Simulando Retry da Meta com mesmo payload)
      const req2 = new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": validSig },
        body: rawPayload,
      });
      const res2 = await webhookH.POST({ request: req2 });
      assert("6.4 Retentativa Meta responde HTTP 500", res2.status === 500);

      const allMatchingOrphans = await db
        .select()
        .from(pendingInbounds)
        .where(
          and(
            eq(pendingInbounds.tenantId, "tecfag"),
            eq(pendingInbounds.externalEventId, expectedOrphanEventId)
          )
        );

      assert("6.4 Idempotência: retentativa NÃO multiplicou registros (apenas 1 existente)", allMatchingOrphans.length === 1);
      assert("6.4 Idempotência: tentativas incrementadas para 2", allMatchingOrphans[0]?.attempts === 2);
    }

  } catch (err: any) {
    console.error("ERRO INESPERADO DURANTE A EXECUÇÃO DOS TESTES:", err);
    failed++;
  } finally {
    // -----------------------------------------------------------------
    // TEARDOWN CIRÚRGICO: Limpeza ESTRITA dos IDs gerados por esta execução
    // -----------------------------------------------------------------
    console.log("\n--- Teardown Cirúrgico: Limpeza apenas dos dados gerados por este teste ---");

    try {
      if (cleanupIds.messages.length > 0) {
        await db.delete(messages).where(inArray(messages.id, cleanupIds.messages));
      }
      if (cleanupIds.conversations.length > 0) {
        await db.delete(conversations).where(inArray(conversations.id, cleanupIds.conversations));
      }
      if (cleanupIds.contacts.length > 0) {
        await db.delete(contacts).where(inArray(contacts.id, cleanupIds.contacts));
      }
      if (cleanupIds.sessions.length > 0) {
        await db.delete(authSessions).where(inArray(authSessions.id, cleanupIds.sessions));
      }
      if (cleanupIds.operators.length > 0) {
        await db.delete(operators).where(inArray(operators.id, cleanupIds.operators));
      }
      if (cleanupIds.pendingInbounds.length > 0) {
        // NUNCA fazer delete por tenantId genérico — deleta exclusivamente os IDs registrados
        await db.delete(pendingInbounds).where(inArray(pendingInbounds.id, cleanupIds.pendingInbounds));
      }

      // Restaurar snapshot original do canal Tecfag
      if (originalTecfagChannelSnapshot) {
        await db
          .update(channelConfigs)
          .set({
            metaPhoneNumberId: originalTecfagChannelSnapshot.metaPhoneNumberId,
            metaAppSecret: originalTecfagChannelSnapshot.metaAppSecret,
          })
          .where(eq(channelConfigs.id, originalTecfagChannelSnapshot.id));
        console.log("Configuração original de channelConfigs restaurada com sucesso.");
      } else if (cleanupIds.channelConfigs.length > 0) {
        await db.delete(channelConfigs).where(inArray(channelConfigs.id, cleanupIds.channelConfigs));
      }

      console.log("Limpeza cirúrgica concluída com sucesso.");
    } catch (cleanupErr: any) {
      console.error("ERRO CRÍTICO NO TEARDOWN:", cleanupErr?.message);
      failed++; // Falha no teardown acarreta falha geral da suíte
    } finally {
      await sqlClient.end();
    }

    console.log("\n=======================================================");
    console.log(`  RESULTADO FINAL: ${passed} PASSADOS | ${failed} FALHOS`);
    console.log("=======================================================\n");

    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
