import crypto from "node:crypto";
import { db, assertTestDatabaseIsolation } from "../src/db";
import { operators, authSessions } from "../src/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE_URL = process.env.TEST_SERVER_URL || "http://localhost:3333";
const TEST_ID = `http_test_${Date.now()}`;

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

async function main() {
  console.log("\n=======================================================");
  console.log("  TESTE HTTP REAL PONTA A PONTA (REDE TCP) — PROFILE");
  console.log(`  Alvo: ${BASE_URL}/api/operators/profile`);
  console.log(`  Identificador do teste: ${TEST_ID}`);
  console.log("=======================================================\n");

  // -----------------------------------------------------------------
  // 0. VERIFICAÇÃO MANDATÓRIA DE ISOLAMENTO LOCAL E REMOTO (HTTP)
  // -----------------------------------------------------------------
  console.log("0. Validando isolamento da base local e do servidor HTTP...");
  const { databaseName: localDbName, serverIp } = await assertTestDatabaseIsolation();
  console.log(`  Banco de Testes Local: '${localDbName}' (${serverIp})`);

  // Verificar se o servidor HTTP alvo está ativo e conectado ao MESMO banco
  let serverDbName: string | null = null;
  try {
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    if (!healthRes.ok) {
      throw new Error(`Health check respondeu HTTP ${healthRes.status}`);
    }
    const healthData = await healthRes.json();
    serverDbName = (healthData.dbName || "").toLowerCase();
  } catch (netErr: any) {
    console.error(`\n🛑 ERRO: Não foi possível conectar ao servidor de teste em ${BASE_URL}/api/health:`, netErr.message);
    console.error("Inicie o servidor de teste antes de executar esta suíte (ex: NODE_ENV=test PORT=3333 npm run dev).\n");
    process.exit(1);
  }

  if (serverDbName !== localDbName) {
    console.error("\n🛑 ERRO CRÍTICO DE DIVERGÊNCIA DE BANCO:");
    console.error(`  Cliente local de teste aponta para: '${localDbName}'`);
    console.error(`  Servidor HTTP (${BASE_URL}) conectado em: '${serverDbName}'`);
    console.error("  O servidor HTTP está rodando contra uma base diferente! Execução abortada.\n");
    process.exit(1);
  }
  console.log(`✅ Conexão comprovada: Servidor HTTP e Cliente de Teste utilizam o banco '${localDbName}'.\n`);

  const cleanupIds = {
    operators: [] as string[],
    sessions: [] as string[],
  };

  const testOperatorId = `${TEST_ID}_agent`;
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const sessionId = `sess_${TEST_ID}`;

  try {
    // 1. Criar operador comum e sessão válida no banco para o teste
    console.log("1. Inserindo operador comum temporário e sessão...");
    await db.insert(operators).values({
      id: testOperatorId,
      tenantId: "valem",
      name: "Nome Antes do Teste HTTP",
      email: `${testOperatorId}@valem.com.br`,
      role: "agent",
      status: "disponivel",
      passwordHash: "hash_protegido_123",
    });
    cleanupIds.operators.push(testOperatorId);

    await db.insert(authSessions).values({
      id: sessionId,
      tenantId: "valem",
      operatorId: testOperatorId,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    });
    cleanupIds.sessions.push(sessionId);

    // 2. Teste HTTP 1: PATCH sem autenticação -> Deve responder 401
    console.log("\n2. Executando requisição HTTP real sem autenticação...");
    const resUnauth = await fetch(`${BASE_URL}/api/operators/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Invasor Sem Sessao" }),
    });
    assert("HTTP 401 retornado para requisição sem sessão", resUnauth.status === 401);

    // 3. Teste HTTP 2: PATCH autenticado com Bearer Token -> Deve responder 200 e atualizar
    console.log("\n3. Executando requisição HTTP real com Bearer Token de operador comum...");
    const resAuth = await fetch(`${BASE_URL}/api/operators/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: "Nome Alterado via HTTP Real",
        status: "ocupado",
        avatar: "https://avatar.test/pic.png",
      }),
    });

    assert("HTTP 200 retornado para atualização de perfil por atendente comum", resAuth.status === 200);

    const dataAuth = await resAuth.json();
    assert("Nome atualizado retornado no corpo da resposta HTTP", dataAuth.name === "Nome Alterado via HTTP Real");
    assert("Status atualizado retornado", dataAuth.status === "ocupado");
    assert("Avatar atualizado retornado", dataAuth.avatar === "https://avatar.test/pic.png");
    assert("passwordHash NÃO foi exposto na resposta HTTP", dataAuth.passwordHash === undefined);

    // 4. Teste HTTP 3: Confirmação no Banco de Dados
    console.log("\n4. Confirmando persistência e integridade no banco de dados...");
    const [dbOp] = await db.select().from(operators).where(eq(operators.id, testOperatorId));
    assert("Nome persistido no banco corresponde ao enviado", dbOp.name === "Nome Alterado via HTTP Real");
    assert("Status persistido no banco é 'ocupado'", dbOp.status === "ocupado");
    assert("Role do operador permaneceu inalterada ('agent')", dbOp.role === "agent");
    assert("Senha original permaneceu intacta no banco", dbOp.passwordHash === "hash_protegido_123");

    // 5. Teste HTTP 4: Tentativa de elevação de privilégio via HTTP (enviando role: 'admin')
    console.log("\n5. Testando bloqueio de elevação de privilégio via HTTP...");
    const resPrivEsc = await fetch(`${BASE_URL}/api/operators/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: "Nome Atendente Legítimo",
        role: "admin", // Tentativa maliciosa de se tornar admin
        groupId: "group-admin-hack",
      }),
    });

    assert("HTTP 200 na requisição", resPrivEsc.status === 200);
    const [dbOpAfter] = await db.select().from(operators).where(eq(operators.id, testOperatorId));
    assert("Role permanece estritamente 'agent' no banco (priv-esc bloqueada)", dbOpAfter.role === "agent");
    assert("groupId não foi alterado no banco", dbOpAfter.groupId === null);

  } catch (err: any) {
    console.error("ERRO DURANTE O TESTE HTTP:", err);
    failed++;
  } finally {
    console.log("\n--- Teardown: Limpeza dos dados temporários criados pelo teste ---");
    try {
      if (cleanupIds.sessions.length > 0) {
        await db.delete(authSessions).where(inArray(authSessions.id, cleanupIds.sessions));
      }
      if (cleanupIds.operators.length > 0) {
        await db.delete(operators).where(inArray(operators.id, cleanupIds.operators));
      }
      console.log("Limpeza cirúrgica concluída.");
    } catch (cleanErr: any) {
      console.error("Erro na limpeza:", cleanErr?.message);
      failed++;
    }

    console.log("\n=======================================================");
    console.log(`  RESULTADO: ${passed} PASSADOS | ${failed} FALHOS`);
    console.log("=======================================================\n");

    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
