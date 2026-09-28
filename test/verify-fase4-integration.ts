/**
 * verify-fase4-integration.ts
 * Suíte de Testes de Integração — Fase 4 (Comercial Ampliado & Autonomia Total do CRM)
 *
 * Validações Mandatórias:
 * 1. Trava de segurança mandatória (assertTestDatabaseIsolation): falha obrigatoriamente com process.exit(1) se não for banco de teste.
 * 2. Isolamento estrito de tenant: produtos e negociações de outros tenants são rejeitados com erro explícito.
 * 3. Validações comerciais: rejeição de quantidade <= 0, preço unitário negativo e desconto fora de 0-100%.
 * 4. Atomicidade e concorrência: criação simultânea de propostas com pg_advisory_xact_lock gerando numeração sequencial sem colisões.
 * 5. Ciclo de vida completo da proposta: draft -> copied -> sent -> accepted (com timestamps auditados).
 * 6. Precisão monetária em centavos e recálculo transacional no deal.
 * 7. Auditoria de eventos imutáveis (crmDealEvents).
 */

import { db, client, assertTestDatabaseIsolation } from "../src/db";
import { crmService } from "../src/lib/crm/crm-service";
import {
  tenants,
  operators,
  crmPipelines,
  crmStages,
  crmDeals,
  crmProducts,
  crmDealProducts,
  crmProposals,
  crmDealEvents,
} from "../src/db/schema";
import { eq, and } from "drizzle-orm";

async function runFase4Tests() {
  console.log("=== INICIANDO VERIFICAÇÃO DE INTEGRAÇÃO — FASE 4 (COMERCIAL CRM & PROPOSTAS) ===");

  // 1. Trava de Isolamento de Banco — NUNCA retornar 0 se falhar
  console.log("\n[1/7] Validando isolamento do banco de teste...");
  try {
    const dbInfo = await assertTestDatabaseIsolation();
    console.log(`✓ Conectado com segurança ao banco de teste: ${dbInfo.databaseName}`);
  } catch (err: any) {
    console.error(`🛑 Falha na trava de segurança: ${err.message}`);
    console.error("ℹ️ Conforme regra mandatória, o teste foi abortado com código não-zero (exit 1) para proteger bancos operacionais.");
    await client.end();
    process.exit(1);
  }

  const testTenantId = `test-tenant-f4-${Date.now()}`;
  const otherTenantId = `other-tenant-f4-${Date.now()}`;
  const opId = `op-f4-${Date.now()}`;

  try {
    // 2. Setup de dados de teste (Tenant Principal e Tenant Secundário para teste de isolamento)
    console.log("\n[2/7] Criando massa de teste com tenants isolados...");
    await db.insert(tenants).values([
      {
        id: testTenantId,
        name: "Tenant Principal Fase 4",
        slug: `test-fase4-main-${Date.now()}`,
        connectionType: "meta",
      },
      {
        id: otherTenantId,
        name: "Tenant Invasor Fase 4",
        slug: `test-fase4-invader-${Date.now()}`,
        connectionType: "baileys",
      },
    ]);

    await db.insert(operators).values({
      id: opId,
      tenantId: testTenantId,
      name: "Operador Comercial Teste",
      email: `op.fase4.${Date.now()}@tecfag.com.br`,
      passwordHash: "hash_de_teste",
      role: "admin",
    });

    const [pipeline] = await db
      .insert(crmPipelines)
      .values({
        id: `pipe-f4-${Date.now()}`,
        tenantId: testTenantId,
        name: "Funil Comercial de Teste",
        color: "#4f46e5",
        orderIndex: 0,
        isDefault: true,
      })
      .returning();

    const [stage] = await db
      .insert(crmStages)
      .values({
        id: `stage-f4-${Date.now()}`,
        tenantId: testTenantId,
        pipelineId: pipeline.id,
        name: "Proposta Enviada",
        orderIndex: 0,
      })
      .returning();

    // 3. Cadastrar Produtos nos Dois Tenants
    console.log("\n[3/7] Cadastrando produtos no catálogo comercial e criando Deal...");
    const deal = await crmService.createDeal(testTenantId, opId, {
      title: "Negociação de Embalagens e Válvulas",
      pipelineId: pipeline.id,
      stageId: stage.id,
      value: "0.00",
    });

    const prod1 = await crmService.createProduct(testTenantId, {
      name: "Válvula Spray 24/410 Prata",
      sku: "VALV-24410-PRT",
      unitPrice: 1.50,
      unit: "UN",
      category: "Válvulas",
    });

    const prod2 = await crmService.createProduct(testTenantId, {
      name: "Frasco PET 500ml Âmbar",
      sku: "FRASC-500-AMB",
      unitPrice: 3.20,
      unit: "UN",
      category: "Frascos",
    });

    // Produto pertencente estritamente ao OUTRO tenant
    const foreignProd = await crmService.createProduct(otherTenantId, {
      name: "Produto Privado do Outro Tenant",
      sku: "FOREIGN-PROD-001",
      unitPrice: 99.00,
      unit: "UN",
      category: "Privado",
    });

    console.log(`✓ Produtos criados:`);
    console.log(`  - Tenant Principal: ${prod1.name} (R$ ${prod1.unitPrice}) e ${prod2.name} (R$ ${prod2.unitPrice})`);
    console.log(`  - Outro Tenant: ${foreignProd.name} (R$ ${foreignProd.unitPrice})`);

    // 4. Testar Isolamento de Tenant e Validações Comerciais
    console.log("\n[4/7] Testando isolamento estrito de tenant e regras de validação...");

    // Tentativa 1: Injetar produto do outro tenant no deal do tenant principal
    let crossTenantBlocked = false;
    try {
      await crmService.addDealProduct(testTenantId, deal.id, opId, {
        productId: foreignProd.id,
        name: foreignProd.name,
        quantity: 10,
        unitPrice: 99.00,
        discountPercent: 0,
      });
    } catch (err: any) {
      crossTenantBlocked = true;
      console.log(`✓ Injeção cross-tenant bloqueada com sucesso: "${err.message}"`);
    }
    if (!crossTenantBlocked) {
      throw new Error("FALHA DE SEGURANÇA: Produto de outro tenant foi inserido no deal!");
    }

    // Tentativa 2: Quantidade zero ou negativa
    let invalidQtyBlocked = false;
    try {
      await crmService.addDealProduct(testTenantId, deal.id, opId, {
        productId: prod1.id,
        name: prod1.name,
        quantity: 0,
        unitPrice: 1.50,
        discountPercent: 0,
      });
    } catch (err: any) {
      invalidQtyBlocked = true;
      console.log(`✓ Quantidade inválida (0) bloqueada: "${err.message}"`);
    }
    if (!invalidQtyBlocked) throw new Error("FALHA: Quantidade zero foi aceita!");

    // Tentativa 3: Preço negativo
    let invalidPriceBlocked = false;
    try {
      await crmService.addDealProduct(testTenantId, deal.id, opId, {
        productId: prod1.id,
        name: prod1.name,
        quantity: 10,
        unitPrice: -5.00,
        discountPercent: 0,
      });
    } catch (err: any) {
      invalidPriceBlocked = true;
      console.log(`✓ Preço negativo bloqueado: "${err.message}"`);
    }
    if (!invalidPriceBlocked) throw new Error("FALHA: Preço negativo foi aceito!");

    // Tentativa 4: Desconto > 100%
    let invalidDiscountBlocked = false;
    try {
      await crmService.addDealProduct(testTenantId, deal.id, opId, {
        productId: prod1.id,
        name: prod1.name,
        quantity: 10,
        unitPrice: 1.50,
        discountPercent: 120,
      });
    } catch (err: any) {
      invalidDiscountBlocked = true;
      console.log(`✓ Desconto > 100% bloqueado: "${err.message}"`);
    }
    if (!invalidDiscountBlocked) throw new Error("FALHA: Desconto de 120% foi aceito!");

    // 5. Adição de Itens Válidos & Recálculo em Centavos
    console.log("\n[5/7] Adicionando itens válidos e validando recálculo monetário exato...");

    // Item 1: 1.000 un a R$ 1.50 com 10% de desconto -> 1.000 * 1.50 = 1500 -> 10% desc = 1350.00
    const dealItem1 = await crmService.addDealProduct(testTenantId, deal.id, opId, {
      productId: prod1.id,
      name: prod1.name,
      quantity: 1000,
      unitPrice: prod1.unitPrice,
      discountPercent: 10,
    });
    console.log(`✓ Item 1 adicionado: Total = R$ ${dealItem1.totalPrice}`);

    let dealAfterItem1 = await crmService.getDealById(testTenantId, deal.id);
    if (!dealAfterItem1) throw new Error("Deal não localizado após item 1");
    if (parseFloat(dealAfterItem1.value) !== 1350.00) {
      throw new Error(`Recálculo falhou: esperado 1350.00, obtido ${dealAfterItem1.value}`);
    }
    console.log(`✓ Valor do Deal recalculado automaticamente: R$ ${dealAfterItem1.value}`);

    // Item 2: 500 un a R$ 3.20 sem desconto -> 500 * 3.20 = 1600.00
    const dealItem2 = await crmService.addDealProduct(testTenantId, deal.id, opId, {
      productId: prod2.id,
      name: prod2.name,
      quantity: 500,
      unitPrice: prod2.unitPrice,
      discountPercent: 0,
    });
    console.log(`✓ Item 2 adicionado: Total = R$ ${dealItem2.totalPrice}`);

    let dealAfterItem2 = await crmService.getDealById(testTenantId, deal.id);
    if (!dealAfterItem2) throw new Error("Deal não localizado após item 2");
    // 1350.00 + 1600.00 = 2950.00
    if (parseFloat(dealAfterItem2.value) !== 2950.00) {
      throw new Error(`Recálculo somado falhou: esperado 2950.00, obtido ${dealAfterItem2.value}`);
    }
    console.log(`✓ Valor do Deal recalculado após Item 2: R$ ${dealAfterItem2.value}`);

    // Remover Item 2 e validar recálculo subtrativo
    await crmService.removeDealProduct(testTenantId, deal.id, dealItem2.id, opId);
    let dealAfterRemoval = await crmService.getDealById(testTenantId, deal.id);
    if (!dealAfterRemoval) throw new Error("Deal não localizado após remoção");
    if (parseFloat(dealAfterRemoval.value) !== 1350.00) {
      throw new Error(`Recálculo subtrativo falhou: esperado 1350.00, obtido ${dealAfterRemoval.value}`);
    }
    console.log(`✓ Item 2 removido e valor do Deal reajustado para R$ ${dealAfterRemoval.value}`);

    // 6. Teste de Concorrência e Ciclo de Vida da Proposta (draft -> copied -> sent -> accepted)
    console.log("\n[6/7] Testando emissão concorrente (pg_advisory_xact_lock) e ciclo de vida de propostas...");

    // Criar duas propostas concorrentemente para garantir ausência de colisão no sequencial
    const [propA, propB] = await Promise.all([
      crmService.createProposal(testTenantId, deal.id, opId, {
        title: "Orçamento Concorrente A",
        paymentTerms: "30 dias",
        deliveryTerms: "FOB",
        validityDays: 15,
      }),
      crmService.createProposal(testTenantId, deal.id, opId, {
        title: "Orçamento Concorrente B",
        paymentTerms: "À vista",
        deliveryTerms: "CIF",
        validityDays: 10,
      }),
    ]);

    console.log(`✓ Numerações sequenciais geradas concorrentemente:`);
    console.log(`  - Proposta A: ${propA.proposalNumber}`);
    console.log(`  - Proposta B: ${propB.proposalNumber}`);

    if (propA.proposalNumber === propB.proposalNumber) {
      throw new Error(`COLISÃO CONCORRENTE: Ambas propostas receberam o mesmo número: ${propA.proposalNumber}`);
    }

    // Ciclo de vida da Proposta A: draft -> copied -> sent -> accepted
    console.log("\n  -> Testando ciclo de vida da proposta A (draft -> copied -> sent -> accepted):");
    
    // Transição 1: copied (quando operador copia texto para WhatsApp)
    const copiedProp = await crmService.updateProposalStatus(testTenantId, propA.id, opId, "copied");
    if (copiedProp.status !== "copied" || !copiedProp.copiedAt) {
      throw new Error("Falha na transição de status para 'copied' ou falta de copiedAt");
    }
    console.log(`  ✓ Status avançado para 'copied' (copiedAt: ${copiedProp.copiedAt.toISOString()})`);

    // Transição 2: sent (quando operador confirma envio)
    const sentProp = await crmService.updateProposalStatus(testTenantId, propA.id, opId, "sent");
    if (sentProp.status !== "sent" || !sentProp.sentAt) {
      throw new Error("Falha na transição de status para 'sent' ou falta de sentAt");
    }
    console.log(`  ✓ Status avançado para 'sent' (sentAt: ${sentProp.sentAt.toISOString()})`);

    // Transição 3: accepted
    const acceptedProp = await crmService.updateProposalStatus(testTenantId, propA.id, opId, "accepted");
    if (acceptedProp.status !== "accepted" || !acceptedProp.acceptedAt) {
      throw new Error("Falha na transição de status para 'accepted' ou falta de acceptedAt");
    }
    console.log(`  ✓ Status avançado para 'accepted' (acceptedAt: ${acceptedProp.acceptedAt.toISOString()})`);

    // 7. Validar Auditoria Imutável de Eventos
    console.log("\n[7/7] Verificando eventos de auditoria imutáveis...");
    const events = await db
      .select()
      .from(crmDealEvents)
      .where(and(eq(crmDealEvents.tenantId, testTenantId), eq(crmDealEvents.dealId, deal.id)));

    const eventTypes = events.map((e) => e.eventType);
    console.log(`✓ Eventos registrados no deal: ${eventTypes.join(" -> ")}`);

    const requiredEvents = [
      "product_added",
      "value_changed",
      "product_removed",
      "proposal_created",
      "proposal_status_changed",
    ];
    for (const req of requiredEvents) {
      if (!eventTypes.includes(req)) {
        throw new Error(`Evento obrigatório ausente na auditoria: ${req}`);
      }
    }
    console.log("✓ Todos os eventos de auditoria exigidos foram confirmados!");

    console.log("\n==========================================================");
    console.log("🎉 TODOS OS TESTES DA FASE 4 PASSARAM COM 100% DE SUCESSO!");
    console.log("==========================================================");
  } finally {
    // Limpeza em cascata pelo delete dos tenants de teste
    console.log("\n🧹 Limpando dados dos tenants de teste...");
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    console.log("✓ Tenants e registros em cascata limpos.");
    await client.end();
  }
}

runFase4Tests().catch((err) => {
  console.error("❌ Falha fatal no teste da Fase 4:", err);
  process.exit(1);
});
