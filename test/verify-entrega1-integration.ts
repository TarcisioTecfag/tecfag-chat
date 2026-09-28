import crypto from "node:crypto";
import { db } from "../src/db";
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
import { createSession } from "../src/lib/auth-session";

// Rotas a serem testadas diretamente
import { Route as ProfileRoute } from "../src/routes/api/operators/profile";
import { Route as OperatorsRoute } from "../src/routes/api/operators";
import { Route as ContactsRoute } from "../src/routes/api/contacts";
import { Route as TagTaskRoute } from "../src/routes/api/chats/tag-task";
import { Route as SendRoute } from "../src/routes/api/whatsapp/send";
import { Route as MetaWebhookRoute } from "../src/routes/api/webhooks/meta";

const TEST_ID = `test_${Date.now()}`;
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

async function main() {
  console.log("\n=======================================================");
  console.log("  SUÍTE DE TESTES DE INTEGRAÇÃO FUNCIONAL — ENTREGA 1");
  console.log(`  Identificador do lote de teste: ${TEST_ID}`);
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

  try {
    // -----------------------------------------------------------------
    // 0. SETUP: Garantir que os tenants existam e criar dados de teste
    // -----------------------------------------------------------------
    console.log("0. Configurando ambiente de teste isolado para valem e tecfag...");

    // Garantir tenants
    const existingValem = await db.query.tenants.findFirst({ where: eq(tenants.id, "valem") });
    if (!existingValem) {
      await db.insert(tenants).values({ id: "valem", name: "Valem Test" });
    }
    const existingTecfag = await db.query.tenants.findFirst({ where: eq(tenants.id, "tecfag") });
    if (!existingTecfag) {
      await db.insert(tenants).values({ id: "tecfag", name: "Tecfag Test" });
    }

    // Criar Operadores de Teste
    const valemAdminId = `${TEST_ID}_valem_admin`;
    const valemAgentId = `${TEST_ID}_valem_agent`;
    const tecfagAdminId = `${TEST_ID}_tecfag_admin`;
    const tecfagAgentId = `${TEST_ID}_tecfag_agent`;

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

    // Criar Sessões Reais
    const sessionValemAdmin = await createSession("valem", valemAdminId);
    const sessionValemAgent = await createSession("valem", valemAgentId);
    const sessionTecfagAdmin = await createSession("tecfag", tecfagAdminId);
    const sessionTecfagAgent = await createSession("tecfag", tecfagAgentId);

    // Criar Contatos e Conversas
    const valemContactId = `${TEST_ID}_valem_contact`;
    const valemConvId = `${TEST_ID}_valem_conv`;
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
      operatorId: valemAgentId, // Pertence ao atendente da Valem
      queueState: "meus",
    });
    cleanupIds.conversations.push(valemConvId);

    const tecfagContactId = `${TEST_ID}_tecfag_contact`;
    const tecfagConvId = `${TEST_ID}_tecfag_conv`;
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
      operatorId: tecfagAgentId, // Pertence ao atendente da Tecfag
      queueState: "meus",
    });
    cleanupIds.conversations.push(tecfagConvId);

    // Canal Meta de Teste para o Tenant Tecfag
    const testMetaPhoneId = `meta_phone_${Date.now()}`;
    const testMetaSecret = "test_meta_app_secret_123456";
    const [existingChannel] = await db
      .select()
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, "tecfag"));

    if (existingChannel) {
      await db
        .update(channelConfigs)
        .set({ metaPhoneNumberId: testMetaPhoneId, metaAppSecret: testMetaSecret })
        .where(eq(channelConfigs.tenantId, "tecfag"));
    } else {
      await db.insert(channelConfigs).values({
        tenantId: "tecfag",
        metaPhoneNumberId: testMetaPhoneId,
        metaAppSecret: testMetaSecret,
      });
      cleanupIds.channelConfigs.push("tecfag");
    }

    console.log("Ambiente de teste configurado com sucesso.\n");

    // Handlers
    const profileH = await getHandlers(ProfileRoute);
    const operatorsH = await getHandlers(OperatorsRoute);
    const contactsH = await getHandlers(ContactsRoute);
    const tagTaskH = await getHandlers(TagTaskRoute);
    const sendH = await getHandlers(SendRoute);
    const webhookH = await getHandlers(MetaWebhookRoute);

    // -----------------------------------------------------------------
    // 1. PATCH /api/operators/profile (Auto-edição de perfil)
    // -----------------------------------------------------------------
    console.log("--- Bloco 1: PATCH /api/operators/profile ---");

    // 1.1 Sem sessão -> 401
    {
      const req = new Request("http://localhost:3000/api/operators/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nome Invasor" }),
      });
      const res = await profileH.PATCH({ request: req });
      assert("1.1 Rejeita sem sessão com 401", res.status === 401);
    }

    // 1.2 Atendente comum edita próprio perfil -> 200, sem passwordHash no retorno
    {
      const req = new Request("http://localhost:3000/api/operators/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionValemAgent.token}`,
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
      const req = new Request("http://localhost:3000/api/operators/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionValemAgent.token}`,
        },
        body: JSON.stringify({ role: "admin", groupId: "group-admin", name: "Tentativa Escalada" }),
      });
      const res = await profileH.PATCH({ request: req });
      assert("1.3 Responde 200 na atualização", res.status === 200);

      const [dbOp] = await db.select().from(operators).where(eq(operators.id, valemAgentId));
      assert("1.3 Role permanece 'agent' inalterada no banco", dbOp.role === "agent");
    }

    // -----------------------------------------------------------------
    // 2. POST & GET /api/operators (RBAC e Sanitização)
    // -----------------------------------------------------------------
    console.log("\n--- Bloco 2: POST & GET /api/operators ---");

    // 2.1 Atendente comum tenta criar operador -> 403 Forbidden
    {
      const req = new Request("http://localhost:3000/api/operators", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionValemAgent.token}`,
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

    // 2.2 Admin cria operador com sucesso -> 201/200, senha com hash no banco
    const createdOpId = `${TEST_ID}_legal_op`;
    {
      const req = new Request("http://localhost:3000/api/operators", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionValemAdmin.token}`,
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

    // 2.3 GET /api/operators filtra estritamente por tenant da sessão e não vaza passwordHash
    {
      const reqValem = new Request("http://localhost:3000/api/operators", {
        headers: { Authorization: `Bearer ${sessionValemAdmin.token}` },
      });
      const resValem = await operatorsH.GET({ request: reqValem });
      const listValem = await resValem.json();

      assert("2.3 GET Valem retorna status 200", resValem.status === 200);
      assert("2.3 Todos os operadores retornados pertencem ao tenant 'valem'",
        listValem.every((o: any) => o.tenantId === "valem")
      );
      assert("2.3 Nenhum operador retornado possui o campo passwordHash",
        listValem.every((o: any) => o.passwordHash === undefined)
      );

      const reqTecfag = new Request("http://localhost:3000/api/operators", {
        headers: { Authorization: `Bearer ${sessionTecfagAdmin.token}` },
      });
      const resTecfag = await operatorsH.GET({ request: reqTecfag });
      const listTecfag = await resTecfag.json();

      assert("2.3 GET Tecfag retorna status 200", resTecfag.status === 200);
      assert("2.3 Todos os operadores retornados pertencem ao tenant 'tecfag'",
        listTecfag.every((o: any) => o.tenantId === "tecfag")
      );
      assert("2.3 Nenhum operador da Valem aparece na listagem da Tecfag",
        !listTecfag.some((o: any) => o.tenantId === "valem")
      );
    }

    // -----------------------------------------------------------------
    // 3. POST /api/contacts (Isolamento de Tenant)
    // -----------------------------------------------------------------
    console.log("\n--- Bloco 3: POST /api/contacts ---");

    // 3.1 Sem sessão -> 401
    {
      const req = new Request("http://localhost:3000/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Contato Anônimo", phone: "5511999990003" }),
      });
      const res = await contactsH.POST({ request: req });
      assert("3.1 Rejeita criação de contato sem sessão com 401", res.status === 401);
    }

    // 3.2 Com sessão Tecfag tentando passar tenantId: "valem" no body -> gravado em tecfag
    const injectedContactId = `${TEST_ID}_injected_contact`;
    {
      const req = new Request("http://localhost:3000/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionTecfagAgent.token}`,
        },
        body: JSON.stringify({
          name: "Contato Injetado",
          phone: "5511999990004",
          tenantId: "valem", // Tentativa de cross-tenant injection
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
    // 4. POST /api/chats/tag-task (Query atômica com id e tenantId)
    // -----------------------------------------------------------------
    console.log("\n--- Bloco 4: POST /api/chats/tag-task ---");

    // 4.1 Sessão Tecfag tenta marcar tag em conversa da Valem -> 404 Not Found
    {
      const req = new Request("http://localhost:3000/api/chats/tag-task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionTecfagAgent.token}`,
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
    // 5. POST /api/whatsapp/send (Permissão de escrita e isolamento)
    // -----------------------------------------------------------------
    console.log("\n--- Bloco 5: POST /api/whatsapp/send ---");

    // 5.1 Outro atendente tenta enviar na conversa alheia -> 403 Forbidden
    // (Tecfag agent tenta na conversa da Tecfag que pertença a outro operador se mudarmos o dono,
    // ou criamos uma segunda conversa de outro operador no mesmo tenant)
    const otherAgentConvId = `${TEST_ID}_other_conv`;
    await db.insert(conversations).values({
      id: otherAgentConvId,
      tenantId: "tecfag",
      contactId: tecfagContactId,
      operatorId: tecfagAdminId, // Pertence ao Admin da Tecfag, não ao Agent
      queueState: "meus",
    });
    cleanupIds.conversations.push(otherAgentConvId);

    {
      const req = new Request("http://localhost:3000/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionTecfagAgent.token}`,
        },
        body: JSON.stringify({
          conversationId: otherAgentConvId,
          text: "Mensagem invasora de atendente sem posse",
        }),
      });
      const res = await sendH.POST({ request: req });
      assert("5.1 Atendente comum é bloqueado com 403 ao tentar enviar em conversa de outro operador", res.status === 403);
    }

    // 5.2 Operador de outro tenant tenta enviar mensagem -> 404 Not Found
    {
      const req = new Request("http://localhost:3000/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionValemAdmin.token}`,
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
    // 6. POST /api/webhooks/meta (HMAC, não-descarte e erro recuperável)
    // -----------------------------------------------------------------
    console.log("\n--- Bloco 6: POST /api/webhooks/meta ---");

    // 6.1 Sem assinatura -> 401
    {
      const req = new Request("http://localhost:3000/api/webhooks/meta", {
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
      const req = new Request("http://localhost:3000/api/webhooks/meta", {
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

    // 6.3 Payload sem nenhum phone_number_id -> 400 (não 200 skipped)
    {
      const payload = JSON.stringify({
        entry: [{ changes: [{ value: { something: "unknown" } }] }],
      });
      const req = new Request("http://localhost:3000/api/webhooks/meta", {
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

    // 6.4 Change com mensagens mas sem phone_number_id -> Retém em pending_inbounds e responde 500 (recuperável)
    {
      const testMsgId = `wamid_err_${Date.now()}`;
      const payloadObj = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "wha_test",
            changes: [
              // Change 1: válido com phone_number_id do tenant tecfag
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: { phone_number_id: testMetaPhoneId },
                  messages: [],
                },
              },
              // Change 2: SEM phone_number_id mas COM MENSAGEM que não pode ser descartada
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  messages: [
                    {
                      id: testMsgId,
                      from: "5511988887777",
                      type: "text",
                      text: { body: "Mensagem crítica que não pode ser perdida" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const rawPayload = JSON.stringify(payloadObj);

      // Assinar com o secret real configurado no teste
      const hmac = crypto.createHmac("sha256", testMetaSecret).update(rawPayload, "utf8").digest("hex");
      const validSig = `sha256=${hmac}`;

      const req = new Request("http://localhost:3000/api/webhooks/meta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": validSig,
        },
        body: rawPayload,
      });
      const res = await webhookH.POST({ request: req });
      const resJson = await res.json();

      assert("6.4 Responde HTTP 500 (falha recuperável para retry da Meta) ao invés de 200", res.status === 500);
      assert("6.4 Indica item retido em pending_inbounds", resJson.error.includes("pending_inbounds"));

      // Verificar que foi persistido no banco na tabela pending_inbounds para análise
      const savedInbounds = await db
        .select()
        .from(pendingInbounds)
        .where(and(eq(pendingInbounds.tenantId, "tecfag"), eq(pendingInbounds.status, "failed")));

      assert("6.4 Evento foi devidamente gravado em pending_inbounds com status 'failed' para análise", savedInbounds.length > 0);
    }

  } catch (err: any) {
    console.error("ERRO INESPERADO DURANTE A EXECUÇÃO DOS TESTES:", err);
    failed++;
  } finally {
    // -----------------------------------------------------------------
    // TEARDOWN: Limpeza completa dos dados de teste
    // -----------------------------------------------------------------
    console.log("\n--- Teardown: Limpeza dos dados temporários de teste ---");

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
      if (cleanupIds.operators.length > 0) {
        await db.delete(authSessions).where(inArray(authSessions.operatorId, cleanupIds.operators));
        await db.delete(operators).where(inArray(operators.id, cleanupIds.operators));
      }
      // Limpar pending_inbounds gerados pelo teste
      await db.delete(pendingInbounds).where(eq(pendingInbounds.tenantId, "tecfag"));

      console.log("Limpeza concluída com sucesso.");
    } catch (cleanupErr) {
      console.error("Erro durante a limpeza de dados de teste:", cleanupErr);
    }

    console.log("\n=======================================================");
    console.log(`  RESULTADO FINAL: ${passed} PASSADOS | ${failed} FALHOS`);
    console.log("=======================================================\n");

    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
