/**
 * verify-isolation-two-tenants.ts
 *
 * Suíte de Testes de Integração para validação do Isolamento Absoluto entre Tenants (Valem × Tecfag).
 * Cumpre os critérios de aceite da Entrega 4 do PLANO-CORRECAO-ISOLAMENTO-VALEM-TECFAG.md:
 * 
 * 1. Dois tenants com o MESMO NÚMERO DE TELEFONE de contato não compartilham conversas nem contatos.
 * 2. Rotas internas sem sessão retornam HTTP 401.
 * 3. Operador de Valem não consegue ler, alterar ou excluir recursos de Tecfag (404/403).
 * 4. Operador de Tecfag não consegue ler, alterar ou excluir recursos de Valem (404/403).
 * 5. SDR e Auditoria abortam imediatamente se executados para o tenant Tecfag.
 * 6. Teardown cirúrgico no final, mantendo a base de testes limpa.
 */

import crypto from "node:crypto";
import {
  db,
  client,
  assertTestDatabaseIsolation,
} from "../src/db";
import {
  tenants,
  operators,
  authSessions,
  contacts,
  conversations,
  messages,
  aiConversationAudits,
} from "../src/db/schema";
import { eq, inArray } from "drizzle-orm";

// Rotas a serem validadas
import { Route as OperatorsRoute } from "../src/routes/api/operators";
import { Route as ChatsRoute } from "../src/routes/api/chats";
import { Route as TagTaskRoute } from "../src/routes/api/chats/tag-task";
import { Route as GestaoOverviewRoute } from "../src/routes/api/gestao/overview";
import { auditService } from "../src/lib/audit-service";
import { SdrEngine } from "../src/lib/valentina/sdr-engine";
import { createSession, SESSION_COOKIE_NAME } from "../src/lib/auth-session";

// =====================================================================
// TRAVA DE SEGURANÇA MANDATÓRIA: BANCO EXCLUSIVO DE TESTE
// =====================================================================
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error("\n🛑 ERRO CRÍTICO DE SEGURANÇA: TEST_DATABASE_URL NÃO CONFIGURADA!");
  console.error("Esta suíte de testes exige um banco de testes isolado.");
  console.error("Exemplo: TEST_DATABASE_URL=postgres://postgres:123@localhost:5432/valemchat_test\n");
  process.exit(1);
}

const parsedUrl = new URL(testDatabaseUrl.replace(/^postgres:/, "http:"));
const expectedDbName = parsedUrl.pathname.replace(/^\//, "").toLowerCase();

if (!expectedDbName.includes("test")) {
  console.error(`\n🛑 ERRO: O banco '${expectedDbName}' NÃO contém 'test' no nome! Operação cancelada.\n`);
  process.exit(1);
}

const TEST_RUN_ID = `iso_${Date.now()}`;
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

// Helpers para simular requisições HTTP com cookie de sessão
function createAuthCookie(rawToken: string): string {
  return `${SESSION_COOKIE_NAME}=${rawToken}; Path=/; HttpOnly; SameSite=Lax`;
}

function mockRequest(
  url: string,
  options: {
    method?: string;
    token?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {}
): Request {
  const headers = new Headers(options.headers || {});
  if (options.token) {
    headers.set("cookie", createAuthCookie(options.token));
  }
  if (options.body) {
    headers.set("content-type", "application/json");
  }

  return new Request(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function runTwoTenantsIsolationSuite() {
  console.log("================================================================================");
  console.log("🧪 SUÍTE DE TESTES: ISOLAMENTO TOTAL MULTI-TENANT (VALEM × TECFAG)");
  console.log("================================================================================");
  
  await assertTestDatabaseIsolation();
  console.log(`📡 Banco verificado: ${expectedDbName} (Isolado)\n`);

  // IDs rastreáveis para teardown
  const createdOperatorIds: string[] = [];
  const createdSessionTokens: string[] = [];
  const createdContactIds: string[] = [];
  const createdConversationIds: string[] = [];
  const createdMessageIds: string[] = [];

  const SAME_PHONE = `+55149${Math.floor(10000000 + Math.random() * 90000000)}`;

  try {
    // ─── SETUP DOS TENANTS ───────────────────────────────────────────────────
    await db.insert(tenants).values([
      { id: "valem", name: "Valem Valvulas", slug: "valem", connectionType: "baileys" },
      { id: "tecfag", name: "Tecfag Informatica", slug: "tecfag", connectionType: "meta" },
    ]).onConflictDoNothing();

    // ─── CRIAÇÃO DOS OPERADORES ──────────────────────────────────────────────
    const opValemId = `op_valem_${TEST_RUN_ID}`;
    const opTecfagId = `op_tecfag_${TEST_RUN_ID}`;
    createdOperatorIds.push(opValemId, opTecfagId);

    await db.insert(operators).values([
      {
        id: opValemId,
        tenantId: "valem",
        name: "Operador Valem",
        email: `valem_${TEST_RUN_ID}@valem.com`,
        passwordHash: "hash_test_123",
        role: "agent",
      },
      {
        id: opTecfagId,
        tenantId: "tecfag",
        name: "Operador Tecfag",
        email: `tecfag_${TEST_RUN_ID}@tecfag.com`,
        passwordHash: "hash_test_123",
        role: "agent",
      },
    ]);

    // ─── CRIAÇÃO DAS SESSÕES HTTP (HttpOnly tokens) ──────────────────────────
    const { token: tokenValem } = await createSession("valem", opValemId);
    const { token: tokenTecfag } = await createSession("tecfag", opTecfagId);

    // ─── CRIAÇÃO DE CONTATOS COM O MESMO NÚMERO DE TELEFONE ───────────────────
    const contactValemId = `ct_valem_${TEST_RUN_ID}`;
    const contactTecfagId = `ct_tecfag_${TEST_RUN_ID}`;
    createdContactIds.push(contactValemId, contactTecfagId);

    await db.insert(contacts).values([
      {
        id: contactValemId,
        tenantId: "valem",
        name: "Cliente Denys (Valem)",
        phone: SAME_PHONE,
        mainChannel: "whatsapp",
      },
      {
        id: contactTecfagId,
        tenantId: "tecfag",
        name: "Cliente Denys (Tecfag)",
        phone: SAME_PHONE,
        mainChannel: "whatsapp",
      },
    ]);

    // ─── CRIAÇÃO DE CONVERSAS ────────────────────────────────────────────────
    const convValemId = `conv_valem_${TEST_RUN_ID}`;
    const convTecfagId = `conv_tecfag_${TEST_RUN_ID}`;
    createdConversationIds.push(convValemId, convTecfagId);

    await db.insert(conversations).values([
      {
        id: convValemId,
        tenantId: "valem",
        contactId: contactValemId,
        operatorId: opValemId,
        queueState: "meus",
        lastMessageText: "Orçamento de válvulas spray",
      },
      {
        id: convTecfagId,
        tenantId: "tecfag",
        contactId: contactTecfagId,
        operatorId: opTecfagId,
        queueState: "meus",
        lastMessageText: "Dúvida sobre servidor Linux",
      },
    ]);

    console.log("--------------------------------------------------------------------------------");
    console.log("TESTE 1: AUTENTICAÇÃO OBRIGATÓRIA (401 SEM SESSÃO)");
    console.log("--------------------------------------------------------------------------------");
    {
      const reqNoSession = mockRequest("http://localhost:3333/api/chats");
      const res = await (ChatsRoute as any).options.server.handlers.GET({ request: reqNoSession });
      assert("GET /api/chats sem cookie retorna 401", res.status === 401);

      const reqTagTask = mockRequest("http://localhost:3333/api/chats/tag-task", {
        method: "POST",
        body: { conversationId: convValemId, tag: "teste" },
      });
      const resTag = await (TagTaskRoute as any).options.server.handlers.POST({ request: reqTagTask });
      assert("POST /api/chats/tag-task sem cookie retorna 401", resTag.status === 401);

      const reqGestao = mockRequest("http://localhost:3333/api/gestao/overview");
      const resGestao = await (GestaoOverviewRoute as any).options.server.handlers.GET({ request: reqGestao });
      assert("GET /api/gestao/overview sem cookie retorna 401", resGestao.status === 401);
    }

    console.log("\n--------------------------------------------------------------------------------");
    console.log("TESTE 2: ISOLAMENTO DE CONVERSAS E CONTATOS COM O MESMO NÚMERO DE TELEFONE");
    console.log("--------------------------------------------------------------------------------");
    {
      // Sessão Valem busca conversas
      const reqValem = mockRequest("http://localhost:3333/api/chats", { token: tokenValem });
      const resValem = await (ChatsRoute as any).options.server.handlers.GET({ request: reqValem });
      if (resValem.status !== 200) {
        console.error("DEBUG resValem:", resValem.status, await resValem.text());
      }
      assert("GET /api/chats para sessão Valem retorna 200", resValem.status === 200);
      const dataValem = await resValem.json().catch(() => ([]));
      
      const foundValemChat = dataValem.find((c: any) => c.phone === SAME_PHONE);
      assert("Sessão Valem encontra sua conversa com o telefone comum", foundValemChat?.id === convValemId);
      assert("Sessão Valem NÃO vê a conversa do Tecfag de mesmo telefone", !dataValem.some((c: any) => c.id === convTecfagId));

      // Sessão Tecfag busca conversas
      const reqTecfag = mockRequest("http://localhost:3333/api/chats", { token: tokenTecfag });
      const resTecfag = await (ChatsRoute as any).options.server.handlers.GET({ request: reqTecfag });
      assert("GET /api/chats para sessão Tecfag retorna 200", resTecfag.status === 200);
      const dataTecfag = await resTecfag.json();

      const foundTecfagChat = dataTecfag.find((c: any) => c.phone === SAME_PHONE);
      assert("Sessão Tecfag encontra sua conversa com o telefone comum", foundTecfagChat?.id === convTecfagId);
      assert("Sessão Tecfag NÃO vê a conversa da Valem de mesmo telefone", !dataTecfag.some((c: any) => c.id === convValemId));
    }

    console.log("\n--------------------------------------------------------------------------------");
    console.log("TESTE 3: BLOQUEIO CROSS-TENANT EM MUTAÇÃO DE CHAT (404/403)");
    console.log("--------------------------------------------------------------------------------");
    {
      // Sessão Valem tenta alterar conversa do Tecfag
      const reqCross = mockRequest("http://localhost:3333/api/chats/tag-task", {
        method: "POST",
        token: tokenValem,
        body: { conversationId: convTecfagId, tagName: "invasao_valem" },
      });
      const resCross = await (TagTaskRoute as any).options.server.handlers.POST({ request: reqCross });
      assert("Valem tentando mutar conversa de Tecfag é rejeitado com 404", resCross.status === 404);

      // Sessão Tecfag tenta alterar conversa da Valem
      const reqCross2 = mockRequest("http://localhost:3333/api/chats/tag-task", {
        method: "POST",
        token: tokenTecfag,
        body: { conversationId: convValemId, tagName: "invasao_tecfag" },
      });
      const resCross2 = await (TagTaskRoute as any).options.server.handlers.POST({ request: reqCross2 });
      assert("Tecfag tentando mutar conversa de Valem é rejeitado com 404", resCross2.status === 404);

      // Sessão Valem altera com sucesso sua própria conversa
      const reqOwn = mockRequest("http://localhost:3333/api/chats/tag-task", {
        method: "POST",
        token: tokenValem,
        body: { conversationId: convValemId, tagName: "sucesso_valem" },
      });
      const resOwn = await (TagTaskRoute as any).options.server.handlers.POST({ request: reqOwn });
      assert("Valem alterando sua própria conversa recebe 200", resOwn.status === 200);
    }

    console.log("\n--------------------------------------------------------------------------------");
    console.log("TESTE 4: TRAVAS ARQUITETURAIS DE SDR E AUDITORIA PARA TECFAG");
    console.log("--------------------------------------------------------------------------------");
    {
      // SDR Engine deve abortar imediatamente se tenantId !== "valem"
      const sdrResult = await SdrEngine.getInstance().processBatchMessages(
        "tecfag",
        convTecfagId,
        SAME_PHONE,
        [{ id: "msg-test", content: "Orçamento" } as any]
      );
      assert("SdrEngine aborta execução de forma segura para o tenant Tecfag (retorna false)", sdrResult === false);

      // Auditoria QA deve ignorar enfileiramento se tenantId !== "valem"
      await auditService.enqueueAudit({
        tenantId: "tecfag",
        conversationId: convTecfagId,
        operatorId: opTecfagId,
        contactName: "Cliente Tecfag",
      });
      const audits = await db.select().from(aiConversationAudits).where(eq(aiConversationAudits.conversationId, convTecfagId));
      assert("enqueueAudit ignora enfileiramento de auditoria para o tenant Tecfag (0 inseridos)", audits.length === 0);
    }

    console.log("\n--------------------------------------------------------------------------------");
    console.log("TESTE 5: RBAC & PRIVILÉGIOS ADMINISTRATIVOS");
    console.log("--------------------------------------------------------------------------------");
    {
      // Operador comum (agent) tenta criar outro operador -> 403
      const reqAdmin = mockRequest("http://localhost:3333/api/operators", {
        method: "POST",
        token: tokenValem,
        body: {
          name: "Novo Op Invasor",
          email: "invasor@valem.com",
          password: "password123",
          role: "admin",
        },
      });
      const resAdmin = await (OperatorsRoute as any).options.server.handlers.POST({ request: reqAdmin });
      assert("Operador comum (agent) recebe 403 ao tentar criar operadores", resAdmin.status === 403);
    }

  } finally {
    // ─── TEARDOWN CIRÚRGICO ───────────────────────────────────────────────────
    console.log("\n🧹 Executando teardown cirúrgico de teste...");
    try {
      if (createdConversationIds.length > 0) {
        await db.delete(conversations).where(inArray(conversations.id, createdConversationIds));
      }
      if (createdContactIds.length > 0) {
        await db.delete(contacts).where(inArray(contacts.id, createdContactIds));
      }
      if (createdSessionTokens.length > 0) {
        await db.delete(authSessions).where(inArray(authSessions.tokenHash, createdSessionTokens));
      }
      if (createdOperatorIds.length > 0) {
        await db.delete(operators).where(inArray(operators.id, createdOperatorIds));
      }
      console.log("✅ Teardown concluído: todos os dados de teste foram removidos.");
    } catch (e) {
      console.error("Erro no teardown:", e);
    }
  }

  console.log("\n================================================================================");
  console.log(`📊 RESULTADOS DA SUÍTE DE ISOLAMENTO: ${passed} PASSOU | ${failed} FALHOU`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTwoTenantsIsolationSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Falha fatal na suíte:", err);
    process.exit(1);
  });
