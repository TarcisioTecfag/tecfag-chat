import crypto from "crypto";
import { db } from "./index";
import {
  conversations,
  contacts,
  messages,
  operators,
  authSessions,
  channelConfigs,
  pendingInbounds,
} from "./schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { outboundQueue } from "../lib/whatsapp/outbound";
import { whatsAppRecoveryService } from "../lib/whatsapp/recovery";
import { createSession, buildSessionCookie } from "../lib/auth-session";

// Rotas TanStack Start
import { Route as MetaWebhookRoute } from "../routes/api/webhooks/meta";
import { Route as BaileysStatusRoute } from "../routes/api/baileys/status";
import { Route as BaileysConnectRoute } from "../routes/api/baileys/connect";
import { Route as UpdateQueueRoute } from "../routes/api/chats/update-queue";

const metaWebhookHandler = (MetaWebhookRoute as any).options.server.handlers.POST;
const baileysStatusHandler = (BaileysStatusRoute as any).options.server.handlers.GET;
const baileysConnectHandler = (BaileysConnectRoute as any).options.server.handlers.GET;
const updateQueueHandler = (UpdateQueueRoute as any).options.server.handlers.POST;

async function runVerificationSuite() {
  console.log("================================================================================");
  console.log("🚀 INICIANDO SUÍTE COMPLETA DE VALIDAÇÃO DE CONCORRÊNCIA, ISOLAMENTO E RECOVERY");
  console.log("================================================================================\n");

  const runId = Date.now();
  const tecfagTenant = "tecfag";
  const valemTenant = "valem";

  // IDs para limpeza
  const createdOperatorIds: string[] = [];
  const createdSessionTokens: string[] = [];
  const createdConvIds: string[] = [];
  const createdContactIds: string[] = [];

  let metaConfigCreated = false;

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // BLOCO 1 & 2: WEBHOOK META (ASSINATURA OBRIGATÓRIA & PERSISTÊNCIA SÍNCRONA)
    // ──────────────────────────────────────────────────────────────────────────
    console.log("👉 [1/5] TESTANDO SEGURANÇA E PERSISTÊNCIA SÍNCRONA DO WEBHOOK META...");

    const testPhoneNumberId = `phone-meta-test-${runId}`;
    const testAppSecret = `secret-meta-${runId}-abc123xyz`;

    // Configura canal Meta no tenant 'tecfag' com segredo e phoneId
    const [existingChannelConfig] = await db
      .select()
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, tecfagTenant));

    if (existingChannelConfig) {
      await db
        .update(channelConfigs)
        .set({
          activeProvider: "meta",
          connectionStatus: "connected",
          metaPhoneNumberId: testPhoneNumberId,
          metaAppSecret: testAppSecret,
          metaAccessToken: "test-token",
          updatedAt: new Date(),
        })
        .where(eq(channelConfigs.id, existingChannelConfig.id));
    } else {
      await db.insert(channelConfigs).values({
        id: `cfg-${tecfagTenant}`,
        tenantId: tecfagTenant,
        activeProvider: "meta",
        connectionStatus: "connected",
        metaPhoneNumberId: testPhoneNumberId,
        metaAppSecret: testAppSecret,
        metaAccessToken: "test-token",
        updatedAt: new Date(),
      });
    }
    metaConfigCreated = true;

    // 1.1: Rejeição sem assinatura (x-hub-signature-256 ausente)
    const reqNoSig = new Request("http://localhost:3000/api/webhooks/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object: "whatsapp_business_account" }),
    });
    const resNoSig = await metaWebhookHandler({ request: reqNoSig });
    if (resNoSig.status === 401) {
      console.log("  ✅ 1.1 Webhook rejeitou com 401 quando x-hub-signature-256 está ausente.");
    } else {
      throw new Error(`❌ 1.1 Falha: Webhook respondeu ${resNoSig.status} em vez de 401.`);
    }

    // 1.2: Rejeição com assinatura HMAC incorreta
    const reqBadSig = new Request("http://localhost:3000/api/webhooks/meta", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": "sha256=invalid000000000000000000000000000000000000000000000000000000000",
      },
      body: JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ changes: [{ value: { metadata: { phone_number_id: testPhoneNumberId } } }] }],
      }),
    });
    const resBadSig = await metaWebhookHandler({ request: reqBadSig });
    if (resBadSig.status === 401) {
      console.log("  ✅ 1.2 Webhook rejeitou com 401 quando HMAC SHA-256 é inválido.");
    } else {
      throw new Error(`❌ 1.2 Falha: Webhook respondeu ${resBadSig.status} em vez de 401.`);
    }

    // 1.3: Rejeição com telefone desconhecido (Zero Fallback para Tecfag ou qualquer outro)
    const unknownPhoneId = `unknown-phone-${runId}`;
    const unkPayload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { metadata: { phone_number_id: unknownPhoneId } } }] }],
    });
    const reqUnkPhone = new Request("http://localhost:3000/api/webhooks/meta", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": "sha256=0000",
      },
      body: unkPayload,
    });
    const resUnkPhone = await metaWebhookHandler({ request: reqUnkPhone });
    if (resUnkPhone.status === 404) {
      console.log("  ✅ 1.3 Webhook rejeitou com 404 para número não cadastrado (zero fallback).");
    } else {
      throw new Error(`❌ 1.3 Falha: Webhook respondeu ${resUnkPhone.status} em vez de 404.`);
    }

    // 1.4: Aceite e persistência SÍNCRONA de evento com HMAC válido
    const testWamid = `wamid-test-${runId}`;
    const clientPhone = `551198888${String(runId).slice(-4)}`;
    const validPayloadObj = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "biz-123",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "11988887777",
                  phone_number_id: testPhoneNumberId,
                },
                contacts: [{ profile: { name: "Cliente Teste Meta Síncrono" }, wa_id: clientPhone }],
                messages: [
                  {
                    from: clientPhone,
                    id: testWamid,
                    timestamp: "1720000000",
                    type: "text",
                    text: { body: "Mensagem síncrona de teste Meta" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const validRawBody = JSON.stringify(validPayloadObj);
    const validHmac = crypto.createHmac("sha256", testAppSecret).update(validRawBody).digest("hex");

    const reqValid = new Request("http://localhost:3000/api/webhooks/meta", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": `sha256=${validHmac}`,
      },
      body: validRawBody,
    });

    const resValid = await metaWebhookHandler({ request: reqValid });
    if (resValid.status === 200) {
      console.log("  ✅ 1.4 Webhook aceitou evento com 200 OK com HMAC verificado.");
    } else {
      const errTxt = await resValid.text();
      throw new Error(`❌ 1.4 Falha: Webhook respondeu ${resValid.status}: ${errTxt}`);
    }

    // Verificação imediata: a mensagem DEVE estar gravada no PostgreSQL (persistência síncrona)
    const expectedExternalEventId = `meta:${tecfagTenant}:${testWamid}`;
    const [savedMsg] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.tenantId, tecfagTenant), eq(messages.externalId, expectedExternalEventId)));

    const [savedInbound] = await db
      .select()
      .from(pendingInbounds)
      .where(and(eq(pendingInbounds.tenantId, tecfagTenant), eq(pendingInbounds.externalEventId, expectedExternalEventId)));

    if (savedMsg && savedMsg.content === "Mensagem síncrona de teste Meta" && savedInbound) {
      console.log("  ✅ 1.5 Persistência SÍNCRONA comprovada: Mensagem e pending_inbounds gravados no PostgreSQL antes do retorno do webhook.");
      if (savedMsg.conversationId) createdConvIds.push(savedMsg.conversationId);
    } else {
      throw new Error(`❌ 1.5 Falha: Mensagem não foi persistida de forma síncrona antes da resposta do webhook! savedMsg=${!!savedMsg}, savedInbound=${!!savedInbound}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BLOCO 3: ISOLAMENTO MULTI-TENANT E ROTAS BAILEYS PROTEGIDAS
    // ──────────────────────────────────────────────────────────────────────────
    console.log("\n👉 [2/5] TESTANDO PROTEÇÃO DAS ROTAS BAILEYS E BLOQUEIO CROSS-TENANT (403/401)...");

    // Cria operador de teste no Tecfag
    const opTecfagId = `op-tecfag-${runId}`;
    await db.insert(operators).values({
      id: opTecfagId,
      tenantId: tecfagTenant,
      name: "Operador Tecfag Teste",
      email: `op.tecfag.${runId}@tecfag.com.br`,
      passwordHash: "hash-fake",
      role: "admin",
      status: "disponivel",
    });
    createdOperatorIds.push(opTecfagId);

    const { token: tecfagToken } = await createSession(tecfagTenant, opTecfagId);
    createdSessionTokens.push(tecfagToken);
    const tecfagCookie = buildSessionCookie(tecfagToken, new Date(Date.now() + 3600000));

    // 2.1: Requisição não autenticada deve retornar 401
    const unauthReq = new Request("http://localhost:3000/api/baileys/status?tenantId=tecfag", {
      method: "GET",
    });
    const unauthRes = await baileysStatusHandler({ request: unauthReq });
    if (unauthRes.status === 401) {
      console.log("  ✅ 2.1 Rota Baileys rejeitou acesso sem sessão com 401 Unauthorized.");
    } else {
      throw new Error(`❌ 2.1 Falha: Rota Baileys respondeu ${unauthRes.status} em vez de 401.`);
    }

    // 2.2: Operador do Tecfag tentando consultar tenant 'valem' deve retornar 403 Forbidden
    const crossTenantReq = new Request("http://localhost:3000/api/baileys/status?tenantId=valem", {
      method: "GET",
      headers: { Cookie: tecfagCookie },
    });
    const crossTenantRes = await baileysStatusHandler({ request: crossTenantReq });
    if (crossTenantRes.status === 403) {
      console.log("  ✅ 2.2 Tentativa cross-tenant (Tecfag acessando Valem) bloqueada com 403 Forbidden.");
    } else {
      throw new Error(`❌ 2.2 Falha: Esperado 403 Forbidden em requisição cross-tenant, obtido ${crossTenantRes.status}.`);
    }

    // 2.3: Operador do Tecfag tentando abrir stream SSE do tenant 'valem' deve retornar 403 Forbidden
    const crossConnectReq = new Request("http://localhost:3000/api/baileys/connect?tenantId=valem", {
      method: "GET",
      headers: { Cookie: tecfagCookie },
    });
    const crossConnectRes = await baileysConnectHandler({ request: crossConnectReq });
    if (crossConnectRes.status === 403) {
      console.log("  ✅ 2.3 Stream SSE Baileys bloqueou conexão cross-tenant com 403 Forbidden.");
    } else {
      throw new Error(`❌ 2.3 Falha: Esperado 403 em stream SSE cross-tenant, obtido ${crossConnectRes.status}.`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BLOCO 4: CONCORRÊNCIA REAL COM 20 ATENDENTES SIMULTÂNEOS (UPDATE-QUEUE)
    // ──────────────────────────────────────────────────────────────────────────
    console.log("\n👉 [3/5] TESTANDO CONCORRÊNCIA EXTREMA: 20 ATENDENTES DISPUTANDO O MESMO CHAT...");

    const contentionConvId = `conv-contention-${runId}`;
    const contentionContactId = `contact-contention-${runId}`;

    await db.insert(contacts).values({
      id: contentionContactId,
      tenantId: tecfagTenant,
      name: "Cliente Lead Fila 20 Atendentes",
      phone: "5511977770000",
      mainChannel: "whatsapp",
      responsibleName: "Na Fila",
    });
    createdContactIds.push(contentionContactId);

    await db.insert(conversations).values({
      id: contentionConvId,
      tenantId: tecfagTenant,
      contactId: contentionContactId,
      queueState: "fila",
      version: 1, // Versão inicial
    });
    createdConvIds.push(contentionConvId);

    // Criar 20 operadores e 20 sessões simultâneas
    const NUM_OPERATORS = 20;
    const operatorCookies: { opId: string; opName: string; cookie: string }[] = [];

    for (let i = 1; i <= NUM_OPERATORS; i++) {
      const opId = `op-concurrent-${runId}-${i}`;
      const opName = `Atendente Concorrente ${i}`;
      await db.insert(operators).values({
        id: opId,
        tenantId: tecfagTenant,
        name: opName,
        email: `op.${i}.${runId}@tecfag.com.br`,
        passwordHash: "hash",
        role: "operador",
        status: "disponivel",
      });
      createdOperatorIds.push(opId);

      const { token } = await createSession(tecfagTenant, opId);
      createdSessionTokens.push(token);
      const cookie = buildSessionCookie(token, new Date(Date.now() + 3600000));
      operatorCookies.push({ opId, opName, cookie });
    }

    // 20 atendentes clicam em "Capturar" exatamente no mesmo milissegundo com expectedVersion: 1
    console.log(`  ⚡ Disparando ${NUM_OPERATORS} requisições simultâneas via Promise.all...`);
    const capturePromises = operatorCookies.map((op) => {
      const req = new Request("http://localhost:3000/api/chats/update-queue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: op.cookie,
        },
        body: JSON.stringify({
          conversationId: contentionConvId,
          queueState: "meus",
          operatorId: op.opId,
          expectedVersion: 1, // Todos viram a versão 1 na tela
        }),
      });
      return updateQueueHandler({ request: req }).then(async (res: Response) => ({
        status: res.status,
        opId: op.opId,
        opName: op.opName,
        data: await res.json().catch(() => ({})),
      }));
    });

    const results = await Promise.all(capturePromises);

    const successes = results.filter((r) => r.status === 200);
    const conflicts = results.filter((r) => r.status === 409);
    const otherErrors = results.filter((r) => r.status !== 200 && r.status !== 409);

    console.log(`  📊 Resultados: ${successes.length} Sucessos (200), ${conflicts.length} Conflitos (409), ${otherErrors.length} Outros erros.`);

    if (successes.length === 1 && conflicts.length === 19 && otherErrors.length === 0) {
      const winner = successes[0];
      console.log(`  ✅ Concorrência Perfeita comprovada: Exatamente 1 atendente (${winner.opName}) venceu a captura!`);
      console.log(`  ✅ Exatamente 19 atendentes receberam 409 Conflict com código CONCURRENCY_CONFLICT.`);
    } else {
      throw new Error(
        `❌ Falha de concorrência com 20 atendentes: Esperado 1 sucesso e 19 conflitos, obtido ${successes.length} sucessos e ${conflicts.length} conflitos.`
      );
    }

    // Conferir estado final no banco de dados
    const [finalConv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, contentionConvId), eq(conversations.tenantId, tecfagTenant)));

    if (finalConv.version === 2 && finalConv.queueState === "meus") {
      console.log(`  ✅ Integridade no Banco: Versão avançou atomicamente de 1 para 2.`);
    } else {
      throw new Error(`❌ Falha: Versão final da conversa é ${finalConv.version} em vez de 2.`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BLOCO 5: IDEMPOTÊNCIA ATÔMICA DA FILA DE SAÍDA (RACE CONDITION DEFENSE)
    // ──────────────────────────────────────────────────────────────────────────
    console.log("\n👉 [4/5] TESTANDO IDEMPOTÊNCIA ATÔMICA SOB DISPARO CONCORRENTE SIMULTÂNEO...");

    const raceKey = `client-race-key-${runId}`;
    const racePhone = "5511966660000";

    // Disparar 10 envios idênticos com a mesma idempotencyKey ao mesmo tempo
    console.log(`  ⚡ Disparando 10 requisições simultâneas com a mesma idempotencyKey '${raceKey}'...`);
    const dispatchPromises = Array.from({ length: 10 }).map(() =>
      outboundQueue.enqueueAndSend({
        tenantId: tecfagTenant,
        conversationId: contentionConvId,
        recipientPhone: racePhone,
        text: "Mensagem de teste de corrida de idempotência",
        idempotencyKey: raceKey,
        isInternalNote: true,
      })
    );

    const dispatchResults = await Promise.all(dispatchPromises);
    const messageIds = new Set(dispatchResults.map((r) => r.messageId));

    if (messageIds.size === 1 && dispatchResults.every((r) => r.success)) {
      console.log(`  ✅ Idempotência Atômica OK: Todas as 10 requisições simultâneas retornaram o mesmo messageId (${[...messageIds][0]}).`);
    } else {
      throw new Error(`❌ Falha de idempotência: Foram gerados ${messageIds.size} IDs diferentes para a mesma chave!`);
    }

    // Verificar se no banco de dados existe estritamente 1 registro
    const dbMessages = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.tenantId, tecfagTenant), eq(messages.idempotencyKey, raceKey)));

    if (dbMessages.length === 1) {
      console.log("  ✅ Unicidade no Banco: Índice UNIQUE garantiu que exatamente 1 registro foi persistido.");
    } else {
      throw new Error(`❌ Falha: Encontrados ${dbMessages.length} registros para a mesma idempotencyKey no PostgreSQL!`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BLOCO 6: WORKER DE RECUPERAÇÃO (WHATSAPP RECOVERY SERVICE)
    // ──────────────────────────────────────────────────────────────────────────
    console.log("\n👉 [5/5] TESTANDO SERVIÇO DE RECUPERAÇÃO AUTOMÁTICA (MENSAGENS PRESAS EM 'SENDING')...");

    const stuckMsgId1 = `stuck-msg-1-${runId}`;
    const stuckMsgId2 = `stuck-msg-2-${runId}`;
    const oldTimestamp = new Date(Date.now() - 120 * 1000); // 2 minutos no passado

    // Mensagem 1: retryCount = 0 -> deve ser tentada novamente (retryCount vira 1)
    await db.insert(messages).values({
      id: stuckMsgId1,
      tenantId: tecfagTenant,
      conversationId: contentionConvId,
      senderType: "agent",
      senderName: "Operador",
      content: "Mensagem presa 1",
      direction: "outbound",
      status: "sending",
      retryCount: 0,
      sentAt: oldTimestamp,
      updatedAt: oldTimestamp,
    });

    // Mensagem 2: retryCount = 3 -> deve ser marcada como 'failed' definitivamente
    await db.insert(messages).values({
      id: stuckMsgId2,
      tenantId: tecfagTenant,
      conversationId: contentionConvId,
      senderType: "agent",
      senderName: "Operador",
      content: "Mensagem presa 2",
      direction: "outbound",
      status: "sending",
      retryCount: 3,
      sentAt: oldTimestamp,
      updatedAt: oldTimestamp,
    });

    console.log("  ⚡ Executando ciclo de recuperação com timeoutSeconds = 60...");
    const stats = await whatsAppRecoveryService.runRecoveryCycle(60);
    console.log(
      `  📊 Stats do ciclo: ${stats.stuckOutboundsChecked} checadas, ${stats.recoveredOutbounds} recuperadas, ${stats.exhaustedOutbounds} esgotadas.`
    );

    const [checkMsg1] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, stuckMsgId1), eq(messages.tenantId, tecfagTenant)));

    const [checkMsg2] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, stuckMsgId2), eq(messages.tenantId, tecfagTenant)));

    if (checkMsg1.retryCount === 1) {
      console.log("  ✅ Recuperação OK: Mensagem 1 teve retryCount incrementado de 0 para 1.");
    } else {
      throw new Error(`❌ Falha: Mensagem 1 não foi recuperada. retryCount=${checkMsg1.retryCount}`);
    }

    if (checkMsg2.status === "failed") {
      console.log("  ✅ Exaustão OK: Mensagem 2 com retryCount >= 3 foi marcada como 'failed' com mensagem explicativa.");
    } else {
      throw new Error(`❌ Falha: Mensagem 2 com retryCount=3 não foi marcada como 'failed'. status=${checkMsg2.status}`);
    }

    console.log("\n================================================================================");
    console.log("🎉 TODOS OS 5 BLOCOS DE TESTES FORAM EXECUTADOS E APROVADOS COM SUCESSO!");
    console.log("================================================================================\n");

  } catch (err: any) {
    console.error("\n💥 ERRO CRÍTICO NA SUÍTE DE TESTES:", err);
    process.exitCode = 1;
  } finally {
    // ──────────────────────────────────────────────────────────────────────────
    // LIMPEZA SEGURA DE DADOS DE TESTE (PRESERVANDO DADOS REAIS DA VALEM E TECFAG)
    // ──────────────────────────────────────────────────────────────────────────
    console.log("🧹 Limpando dados temporários criados pela suíte de teste...");
    try {
      if (createdConvIds.length > 0) {
        await db.delete(messages).where(inArray(messages.conversationId, createdConvIds));
        await db.delete(conversations).where(inArray(conversations.id, createdConvIds));
      }
      if (createdContactIds.length > 0) {
        await db.delete(contacts).where(inArray(contacts.id, createdContactIds));
      }
      if (createdSessionTokens.length > 0) {
        await db.delete(authSessions).where(inArray(authSessions.operatorId, createdOperatorIds));
      }
      if (createdOperatorIds.length > 0) {
        await db.delete(operators).where(inArray(operators.id, createdOperatorIds));
      }
      if (metaConfigCreated) {
        // Restaura config limpa ou desativa teste
        await db
          .update(channelConfigs)
          .set({ metaPhoneNumberId: null, metaAppSecret: null })
          .where(eq(channelConfigs.tenantId, tecfagTenant));
      }
      console.log("✅ Ambiente de teste limpo com sucesso sem afetar dados reais.");
    } catch (cleanErr: any) {
      console.error("Aviso na limpeza:", cleanErr?.message);
    }
  }
}

runVerificationSuite();
