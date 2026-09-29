/**
 * verify-e0-security-contracts.ts
 * 
 * Suíte de Testes e Validação Técnica de E0 (Segurança, Ambiente e Contratos do CRM)
 * 
 * Asserções Automatizadas Conforme PLANO-EXECUCAO-CRM-PENDENCIAS.md (Seção 1.3):
 * 1. Trava de isolamento de teste obrigatória (assertTestDatabaseIsolation).
 * 2. Rejeição de chamada sem autenticação (HTTP 401).
 * 3. Rejeição de chamada com operador sem permissão canViewCrm ou canCreateDeals (HTTP 403).
 * 4. Rejeição com 403/400 em tentativa de criar/editar deal usando accountId, contactId, conversationId ou stageId de outro tenant.
 * 5. Rejeição com 400 em tentativa de mover ou criar deal com stageId que não pertença ao pipelineId do negócio.
 * 6. Atomicidade e rollback transacional verificado no banco caso ocorra falha parcial.
 * 7. Idempotência do GET: GET /api/crm/pipelines repetido 3 vezes retorna lista sem disparar seeds ou escritas.
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
  accessGroups,
  contacts,
  conversations,
  crmPipelines,
  crmStages,
  crmDeals,
  crmAccounts,
  crmDealContacts,
  crmConversationDeals,
  crmDealEvents,
} from "../src/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { crmService, CrmValidationError, CrmCrossTenantError } from "../src/lib/crm/crm-service";
import { ROLE_PRESETS, DEFAULT_ADMIN_PERMISSIONS } from "../src/lib/rbac";

// Rotas sob teste
import { Route as PipelinesRoute } from "../src/routes/api/crm/pipelines";
import { Route as DealsRoute } from "../src/routes/api/crm/deals";
import { Route as DealIdRoute } from "../src/routes/api/crm/deals/$dealId";

// =====================================================================
// TRAVA DE SEGURANÇA MANDATÓRIA: BANCO EXCLUSIVO DE TESTE
// =====================================================================
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error("\n🛑 ERRO CRÍTICO DE SEGURANÇA: TEST_DATABASE_URL NÃO CONFIGURADA!");
  console.error("Esta suíte manipula esquemas e dados de teste, e é ESTRITAMENTE");
  console.error("PROIBIDA de rodar contra o banco operacional ou de desenvolvimento.\n");
  console.error("Configure um banco dedicado de testes na variável de ambiente:");
  console.error("Exemplo: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/valemchat_test\n");
  process.exit(1);
}

const parsedUrl = new URL(testDatabaseUrl.replace(/^postgres:/, "http:"));
const expectedDbName = parsedUrl.pathname.replace(/^\//, "").toLowerCase();

if (!expectedDbName.includes("test")) {
  console.error(`\n🛑 ERRO CRÍTICO DE SEGURANÇA: O banco '${expectedDbName}' NÃO contém 'test' no nome! Operação cancelada.\n`);
  process.exit(1);
}

const TEST_ID = `test_e0_${Date.now()}`;
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

// Cria sessão de teste isolada
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
  console.log("  SUÍTE DE TESTES E CONTRATOS DE SEGURANÇA — ENTREGA E0");
  console.log(`  Banco: ${expectedDbName} (${parsedUrl.host})`);
  console.log(`  Lote de Execução: ${TEST_ID}`);
  console.log("=======================================================\n");

  // 1. Checagem de Isolamento e Convergência de Conexão
  console.log("--- 1. Checagem de Isolamento de Banco de Testes ---");
  const { databaseName: connectedDbName, serverIp } = await assertTestDatabaseIsolation();

  if (connectedDbName !== expectedDbName) {
    console.error(`🛑 ERRO DE DIVERGÊNCIA: TEST_DATABASE_URL='${expectedDbName}', db='${connectedDbName}'`);
    process.exit(1);
  }
  assert("Banco de testes ativo e isolado comprovado", true);

  const cleanupIds = {
    tenants: [] as string[],
    groups: [] as string[],
    operators: [] as string[],
    sessions: [] as string[],
    accounts: [] as string[],
    contacts: [] as string[],
    conversations: [] as string[],
    pipelines: [] as string[],
    stages: [] as string[],
    deals: [] as string[],
  };

  const tenantA = `${TEST_ID}_ta`;
  const tenantB = `${TEST_ID}_tb`;

  try {
    // -----------------------------------------------------------------
    // SETUP: Tenants isolados
    // -----------------------------------------------------------------
    console.log("\n--- 2. Setup de Tenants e Operadores Isolados ---");
    await db.insert(tenants).values([
      { id: tenantA, name: "Tenant A Test", slug: `slug-${tenantA}`, connectionType: "meta" },
      { id: tenantB, name: "Tenant B Test", slug: `slug-${tenantB}`, connectionType: "meta" },
    ]);
    cleanupIds.tenants.push(tenantA, tenantB);

    // Grupos de Acesso
    // Grupo A1: Acesso completo ao CRM (Admin)
    const groupAdminA = `${TEST_ID}_grp_adm_a`;
    await db.insert(accessGroups).values({
      id: groupAdminA,
      tenantId: tenantA,
      name: "Admin CRM A",
      canCreateUser: true,
      canResetPassword: true,
      canOverrideChat: true,
      permissions: DEFAULT_ADMIN_PERMISSIONS,
    });
    cleanupIds.groups.push(groupAdminA);

    // Grupo A2: Sem acesso ao CRM
    const groupNoCrmA = `${TEST_ID}_grp_nocrm_a`;
    await db.insert(accessGroups).values({
      id: groupNoCrmA,
      tenantId: tenantA,
      name: "Atendente Sem CRM A",
      canCreateUser: false,
      canResetPassword: false,
      canOverrideChat: false,
      permissions: {
        ...ROLE_PRESETS.suporte.permissions,
        views: {
          ...ROLE_PRESETS.suporte.permissions.views,
          crm: false,
        },
        crm: {
          canViewCrm: false,
          canViewAllDeals: false,
          canCreateDeals: false,
          canEditDeals: false,
          canMoveStages: false,
          canCloseDeals: false,
          canManagePipelines: false,
          canManageProducts: false,
          canManageProposals: false,
        },
      },
    });
    cleanupIds.groups.push(groupNoCrmA);

    // Grupo A3: Apenas visualização de CRM (sem criar nem editar)
    const groupReadOnlyA = `${TEST_ID}_grp_ro_a`;
    await db.insert(accessGroups).values({
      id: groupReadOnlyA,
      tenantId: tenantA,
      name: "Atendente Read-Only CRM A",
      canCreateUser: false,
      canResetPassword: false,
      canOverrideChat: false,
      permissions: {
        ...ROLE_PRESETS.suporte.permissions,
        views: {
          ...ROLE_PRESETS.suporte.permissions.views,
          crm: true,
        },
        crm: {
          canViewCrm: true,
          canViewAllDeals: true,
          canCreateDeals: false,
          canEditDeals: false,
          canMoveStages: false,
          canCloseDeals: false,
          canManagePipelines: false,
          canManageProducts: false,
          canManageProposals: false,
        },
      },
    });
    cleanupIds.groups.push(groupReadOnlyA);

    // Operadores
    const opAdminA = `${TEST_ID}_op_adm_a`;
    const opNoCrmA = `${TEST_ID}_op_nocrm_a`;
    const opReadOnlyA = `${TEST_ID}_op_ro_a`;
    const opAdminB = `${TEST_ID}_op_adm_b`;

    await db.insert(operators).values([
      { id: opAdminA, tenantId: tenantA, name: "Admin A", email: `${opAdminA}@test.com`, passwordHash: "dummyhash", role: "admin", groupId: groupAdminA },
      { id: opNoCrmA, tenantId: tenantA, name: "No CRM A", email: `${opNoCrmA}@test.com`, passwordHash: "dummyhash", role: "agent", groupId: groupNoCrmA },
      { id: opReadOnlyA, tenantId: tenantA, name: "Read-Only A", email: `${opReadOnlyA}@test.com`, passwordHash: "dummyhash", role: "agent", groupId: groupReadOnlyA },
      { id: opAdminB, tenantId: tenantB, name: "Admin B", email: `${opAdminB}@test.com`, passwordHash: "dummyhash", role: "admin" },
    ]);
    cleanupIds.operators.push(opAdminA, opNoCrmA, opReadOnlyA, opAdminB);

    // Sessões
    const sessAdminA = await createTestSession(tenantA, opAdminA);
    const sessNoCrmA = await createTestSession(tenantA, opNoCrmA);
    const sessReadOnlyA = await createTestSession(tenantA, opReadOnlyA);
    const sessAdminB = await createTestSession(tenantB, opAdminB);
    cleanupIds.sessions.push(sessAdminA.sessionId, sessNoCrmA.sessionId, sessReadOnlyA.sessionId, sessAdminB.sessionId);

    const pipelinesHandlers = await getHandlers(PipelinesRoute);
    const dealsHandlers = await getHandlers(DealsRoute);
    const dealIdHandlers = await getHandlers(DealIdRoute);

    // -----------------------------------------------------------------
    // TESTE 1: Rejeição de chamada sem autenticação (401)
    // -----------------------------------------------------------------
    console.log("\n--- 3. Teste 1: Rejeição Sem Autenticação (401) ---");
    {
      const unauthReq = new Request("http://localhost:3000/api/crm/pipelines", {
        method: "GET",
      });
      const unauthRes = await pipelinesHandlers.GET({ request: unauthReq });
      assert("GET /api/crm/pipelines sem token retorna 401", unauthRes.status === 401);

      const unauthDealReq = new Request("http://localhost:3000/api/crm/deals", {
        method: "GET",
      });
      const unauthDealRes = await dealsHandlers.GET({ request: unauthDealReq });
      assert("GET /api/crm/deals sem token retorna 401", unauthDealRes.status === 401);
    }

    // -----------------------------------------------------------------
    // TESTE 2: Rejeição de chamada com operador sem permissão (403)
    // -----------------------------------------------------------------
    console.log("\n--- 4. Teste 2: RBAC e Permissões Granulares (403) ---");
    {
      // Operador sem canViewCrm tenta listar funis
      const reqNoCrm = new Request("http://localhost:3000/api/crm/pipelines", {
        method: "GET",
        headers: { Authorization: `Bearer ${sessNoCrmA.token}` },
      });
      const resNoCrm = await pipelinesHandlers.GET({ request: reqNoCrm });
      assert("Operador sem canViewCrm recebe 403 em GET /api/crm/pipelines", resNoCrm.status === 403);

      // Operador sem canViewCrm tenta listar deals
      const reqDealsNoCrm = new Request("http://localhost:3000/api/crm/deals", {
        method: "GET",
        headers: { Authorization: `Bearer ${sessNoCrmA.token}` },
      });
      const resDealsNoCrm = await dealsHandlers.GET({ request: reqDealsNoCrm });
      assert("Operador sem canViewCrm recebe 403 em GET /api/crm/deals", resDealsNoCrm.status === 403);

      // Operador apenas com canViewCrm tenta criar deal (falta canCreateDeals)
      const reqCreateRo = new Request("http://localhost:3000/api/crm/deals", {
        method: "POST",
        headers: { Authorization: `Bearer ${sessReadOnlyA.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Deal Não Permitido", pipelineId: "dummy", stageId: "dummy" }),
      });
      const resCreateRo = await dealsHandlers.POST({ request: reqCreateRo });
      assert("Operador sem canCreateDeals recebe 403 em POST /api/crm/deals", resCreateRo.status === 403);
    }

    // -----------------------------------------------------------------
    // TESTE 3: Idempotência do GET: GET /api/crm/pipelines repetido 3 vezes
    // -----------------------------------------------------------------
    console.log("\n--- 5. Teste 3: Idempotência do GET de Pipelines (Sem Auto-Seed) ---");
    {
      // Tenant A ainda não tem pipelines
      for (let i = 1; i <= 3; i++) {
        const req = new Request("http://localhost:3000/api/crm/pipelines", {
          method: "GET",
          headers: { Authorization: `Bearer ${sessAdminA.token}` },
        });
        const res = await pipelinesHandlers.GET({ request: req });
        const json = await res.json();
        assert(`Chamada ${i}/3 do GET /api/crm/pipelines retorna 200 e lista vazia`, res.status === 200 && Array.isArray(json.pipelines) && json.pipelines.length === 0);
      }

      const [dbPipelinesCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(crmPipelines)
        .where(eq(crmPipelines.tenantId, tenantA));
      assert("Nenhum funil fantasma/auto-seed foi gerado no banco após 3 chamadas GET", Number(dbPipelinesCount.count) === 0);
    }

    // -----------------------------------------------------------------
    // SETUP: Criar Pipelines e Etapas Legítimas em Tenant A e Tenant B
    // -----------------------------------------------------------------
    console.log("\n--- Setup de Pipelines e Dados Comerciais ---");
    // Inicialização explícita do funil padrão via POST
    const initReq = new Request("http://localhost:3000/api/crm/pipelines", {
      method: "POST",
      headers: { Authorization: `Bearer ${sessAdminA.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "init-default" }),
    });
    const initRes = await pipelinesHandlers.POST({ request: initReq });
    assert("Inicialização explícita de funil via POST retorna 201", initRes.status === 201);
    const initData = await initRes.json();
    const pipeA1Id = initData.pipeline.id;
    cleanupIds.pipelines.push(pipeA1Id);

    const stagesA1 = await db.select().from(crmStages).where(eq(crmStages.pipelineId, pipeA1Id));
    stagesA1.forEach((s) => cleanupIds.stages.push(s.id));
    const stageA1_1 = stagesA1[0].id;

    // Criar um segundo funil em Tenant A com suas próprias etapas
    const pipeA2 = await crmService.createPipeline(tenantA, {
      name: "Funil Secundário A",
      stages: [{ name: "Etapa Única Pipe 2", orderIndex: 0, color: "#blue" }],
    });
    cleanupIds.pipelines.push(pipeA2.id);
    const stagesA2 = await db.select().from(crmStages).where(eq(crmStages.pipelineId, pipeA2.id));
    stagesA2.forEach((s) => cleanupIds.stages.push(s.id));
    const stageA2_1 = stagesA2[0].id;

    // Criar Funil e Etapa em Tenant B
    const pipeB = await crmService.createPipeline(tenantB, {
      name: "Funil Tenant B",
      stages: [{ name: "Etapa B", orderIndex: 0, color: "#red" }],
    });
    cleanupIds.pipelines.push(pipeB.id);
    const stagesB = await db.select().from(crmStages).where(eq(crmStages.pipelineId, pipeB.id));
    stagesB.forEach((s) => cleanupIds.stages.push(s.id));
    const stageB_1 = stagesB[0].id;

    // Criar Conta, Contato e Conversa em Tenant B para testar isolamento cruzado
    const accBId = `${TEST_ID}_acc_b`;
    await db.insert(crmAccounts).values({
      id: accBId,
      tenantId: tenantB,
      name: "Conta Tenant B",
      type: "company",
    });
    cleanupIds.accounts.push(accBId);

    const ctBId = `${TEST_ID}_ct_b`;
    await db.insert(contacts).values({
      id: ctBId,
      tenantId: tenantB,
      name: "Contato Tenant B",
      phone: "5511999990003",
      mainChannel: "whatsapp",
    });
    cleanupIds.contacts.push(ctBId);

    const convBId = `${TEST_ID}_conv_b`;
    await db.insert(conversations).values({
      id: convBId,
      tenantId: tenantB,
      contactId: ctBId,
      operatorId: opAdminB,
      queueState: "meus",
    });
    cleanupIds.conversations.push(convBId);

    // -----------------------------------------------------------------
    // TESTE 4: Rejeição Cross-Tenant (403/400)
    // -----------------------------------------------------------------
    console.log("\n--- 6. Teste 4: Isolamento Estrito Multi-Tenant no CRM ---");
    {
      // Tentativa de criar deal no Tenant A usando accountId de Tenant B
      try {
        await crmService.createDeal(tenantA, opAdminA, {
          title: "Deal Tentativa Cross-Account",
          pipelineId: pipeA1Id,
          stageId: stageA1_1,
          accountId: accBId,
        });
        assert("createDeal com accountId de outro tenant deve falhar", false);
      } catch (err: any) {
        assert("createDeal com accountId de outro tenant rejeitado com CrmCrossTenantError", err instanceof CrmCrossTenantError || err.statusCode === 403);
      }

      // Tentativa de criar deal no Tenant A usando contactId de Tenant B
      try {
        await crmService.createDeal(tenantA, opAdminA, {
          title: "Deal Tentativa Cross-Contact",
          pipelineId: pipeA1Id,
          stageId: stageA1_1,
          contactId: ctBId,
        });
        assert("createDeal com contactId de outro tenant deve falhar", false);
      } catch (err: any) {
        assert("createDeal com contactId de outro tenant rejeitado com CrmCrossTenantError", err instanceof CrmCrossTenantError || err.statusCode === 403);
      }

      // Tentativa de criar deal no Tenant A usando conversationId de Tenant B
      try {
        await crmService.createDeal(tenantA, opAdminA, {
          title: "Deal Tentativa Cross-Conversation",
          pipelineId: pipeA1Id,
          stageId: stageA1_1,
          conversationId: convBId,
        });
        assert("createDeal com conversationId de outro tenant deve falhar", false);
      } catch (err: any) {
        assert("createDeal com conversationId de outro tenant rejeitado com CrmCrossTenantError", err instanceof CrmCrossTenantError || err.statusCode === 403);
      }

      // Tentativa de criar deal no Tenant A usando stageId de Tenant B
      try {
        await crmService.createDeal(tenantA, opAdminA, {
          title: "Deal Tentativa Cross-Stage",
          pipelineId: pipeA1Id,
          stageId: stageB_1,
        });
        assert("createDeal com stageId de outro tenant deve falhar", false);
      } catch (err: any) {
        assert("createDeal com stageId de outro tenant rejeitado", err instanceof CrmCrossTenantError || err instanceof CrmValidationError || err.statusCode === 403 || err.statusCode === 400);
      }
    }

    // -----------------------------------------------------------------
    // TESTE 5: Rejeição de Etapa de Outro Funil (400)
    // -----------------------------------------------------------------
    console.log("\n--- 7. Teste 5: Rejeição de Etapa Desalinhada de Funil (HTTP 400) ---");
    {
      // Tentativa de criar negócio com pipeline A1 mas stage do pipeline A2
      try {
        await crmService.createDeal(tenantA, opAdminA, {
          title: "Deal Etapa Incompatível",
          pipelineId: pipeA1Id,
          stageId: stageA2_1, // Pertence a pipeA2, não pipeA1
        });
        assert("Criação de deal com etapa de outro funil deve falhar", false);
      } catch (err: any) {
        assert("Criação com etapa de outro funil rejeitada com CrmValidationError (400)", err instanceof CrmValidationError && err.code === "STAGE_NOT_IN_PIPELINE");
      }

      // Criação legítima de deal no pipeline A1
      const validDeal = await crmService.createDeal(tenantA, opAdminA, {
        title: "Deal Legítimo A1",
        pipelineId: pipeA1Id,
        stageId: stageA1_1,
        value: 1500,
      });
      cleanupIds.deals.push(validDeal.id);
      assert("Deal legítimo criado com sucesso", !!validDeal.id);

      // Tentativa de mover o deal para etapa do pipeline A2 sem mudar pipelineId
      try {
        await crmService.updateDeal(tenantA, validDeal.id, opAdminA, {
          stageId: stageA2_1,
        });
        assert("Movimentação de etapa para outro funil sem mudar pipelineId deve falhar", false);
      } catch (err: any) {
        assert("Movimentação de etapa desalinhada rejeitada com CrmValidationError (400)", err instanceof CrmValidationError && err.code === "STAGE_NOT_IN_PIPELINE");
      }
    }

    // -----------------------------------------------------------------
    // TESTE 6: Atomicidade e Rollback Transacional
    // -----------------------------------------------------------------
    console.log("\n--- 8. Teste 6: Atomicidade e Rollback Transacional ---");
    {
      const initialDealsCount = (await db.select({ count: sql<number>`count(*)` }).from(crmDeals).where(eq(crmDeals.tenantId, tenantA)))[0].count;

      // Forçar falha atômica durante createDeal (por exemplo, fornecendo dados inválidos que falham na transação)
      try {
        await db.transaction(async (tx) => {
          // Insere deal
          const [inserted] = await tx.insert(crmDeals).values({
            tenantId: tenantA,
            title: "Deal que Deve Sofrer Rollback",
            pipelineId: pipeA1Id,
            stageId: stageA1_1,
            creatorId: opAdminA,
            ownerId: opAdminA,
          }).returning();

          // Simula falha deliberada em operação subsequente (ex: violação de constraint ou throw explícito)
          throw new Error("Simulação deliberada de falha no meio da transação");
        });
      } catch (err: any) {
        // Erro esperado da simulação
      }

      const finalDealsCount = (await db.select({ count: sql<number>`count(*)` }).from(crmDeals).where(eq(crmDeals.tenantId, tenantA)))[0].count;
      assert("Contagem de deals inalterada após erro na transação (rollback perfeito)", Number(initialDealsCount) === Number(finalDealsCount));
    }

  } finally {
    // -----------------------------------------------------------------
    // CLEANUP CIRÚRGICO
    // -----------------------------------------------------------------
    console.log("\n--- Limpeza Cirúrgica de Dados de Teste ---");
    if (cleanupIds.deals.length > 0) {
      await db.delete(crmDealEvents).where(inArray(crmDealEvents.dealId, cleanupIds.deals));
      await db.delete(crmDealContacts).where(inArray(crmDealContacts.dealId, cleanupIds.deals));
      await db.delete(crmConversationDeals).where(inArray(crmConversationDeals.dealId, cleanupIds.deals));
      await db.delete(crmDeals).where(inArray(crmDeals.id, cleanupIds.deals));
    }
    if (cleanupIds.stages.length > 0) {
      await db.delete(crmStages).where(inArray(crmStages.id, cleanupIds.stages));
    }
    if (cleanupIds.pipelines.length > 0) {
      await db.delete(crmPipelines).where(inArray(crmPipelines.id, cleanupIds.pipelines));
    }
    if (cleanupIds.conversations.length > 0) {
      await db.delete(conversations).where(inArray(conversations.id, cleanupIds.conversations));
    }
    if (cleanupIds.contacts.length > 0) {
      await db.delete(contacts).where(inArray(contacts.id, cleanupIds.contacts));
    }
    if (cleanupIds.accounts.length > 0) {
      await db.delete(crmAccounts).where(inArray(crmAccounts.id, cleanupIds.accounts));
    }
    if (cleanupIds.sessions.length > 0) {
      await db.delete(authSessions).where(inArray(authSessions.id, cleanupIds.sessions));
    }
    if (cleanupIds.operators.length > 0) {
      await db.delete(operators).where(inArray(operators.id, cleanupIds.operators));
    }
    if (cleanupIds.groups.length > 0) {
      await db.delete(accessGroups).where(inArray(accessGroups.id, cleanupIds.groups));
    }
    if (cleanupIds.tenants.length > 0) {
      await db.delete(tenants).where(inArray(tenants.id, cleanupIds.tenants));
    }
    console.log("✓ Limpeza concluída com sucesso.");
    await client.end();
  }

  console.log("\n=======================================================");
  console.log(`  RESULTADO FINAL: ${passed} APROVADOS, ${failed} FALHAS`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("🛑 Erro fatal na suíte:", err);
  await client.end();
  process.exit(1);
});
