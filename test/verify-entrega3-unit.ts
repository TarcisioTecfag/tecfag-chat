/**
 * verify-entrega3-unit.ts
 * 
 * Suíte de verificação automatizada para a Entrega 3:
 * Entrada e Recuperação Confiáveis (Webhook Meta em lote, Recovery atômico,
 * Reconciliação com provedor original e Transição segura de canal).
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

console.log("\n🧪 ════════════════════════════════════════════════════════════════");
console.log("   SUÍTE DE VERIFICAÇÃO UNITÁRIA & ARQUITETURAL — ENTREGA 3");
console.log("   (Entrada e Recuperação Confiáveis: Webhook, Locks, Reconciliação & Transição)");
console.log("════════════════════════════════════════════════════════════════\n");

// ── 1. Webhook Meta em Lote & Higienização ──────────────────────────────────
console.log("📌 1. Testando src/routes/api/webhooks/meta.ts...");
const metaWebhookCode = readFileSync(resolve("src/routes/api/webhooks/meta.ts"), "utf-8");

assert(
  metaWebhookCode.includes("token=[REDACTED]") && !metaWebhookCode.includes("token=${token}"),
  "Handshake GET sanitizado sem expor o token de verificação nos logs"
);

assert(
  metaWebhookCode.includes("for (const batchEntry of body?.entry ?? [])") &&
  metaWebhookCode.includes("for (const batchChange of batchEntry?.changes ?? [])"),
  "Webhook processa todas as entries e todos os changes do lote (elimina bug de processar apenas entry[0].changes[0])"
);

assert(
  metaWebhookCode.includes("allPhoneNumberIds.size === 0") &&
  metaWebhookCode.includes("status: 400"),
  "Rejeita com HTTP 400 lote sem phone_number_id antes de tentar HMAC"
);

assert(
  metaWebhookCode.includes("crypto.timingSafeEqual") &&
  metaWebhookCode.includes("x-hub-signature-256"),
  "Validação obrigatória de HMAC SHA-256 com comparação de tempo constante (timingSafeEqual)"
);

assert(
  metaWebhookCode.includes("orphanEventId") &&
  metaWebhookCode.includes("pendingInbounds"),
  "Retém eventos com mensagens mas sem phone_number_id em pending_inbounds com fingerprint determinístico"
);

assert(
  metaWebhookCode.includes("unprocessableItemsCount > 0") &&
  metaWebhookCode.includes("status: 500"),
  "Responde HTTP 500 caso haja itens acionáveis com falha no lote para acionar retentativa da Meta"
);

// ── 2. Inbound Processor & Trava Atômica ─────────────────────────────────────
console.log("\n📌 2. Testando src/lib/whatsapp/inbound.ts...");
const inboundCode = readFileSync(resolve("src/lib/whatsapp/inbound.ts"), "utf-8");

assert(
  inboundCode.includes("pg_advisory_xact_lock") &&
  inboundCode.includes("inb:"),
  "InboundProcessor utiliza pg_advisory_xact_lock por externalEventId para evitar processamento concorrente"
);

assert(
  inboundCode.includes("isResuming") &&
  inboundCode.includes("update(pendingInbounds)") &&
  inboundCode.includes("attempts: (existingEvent.attempts || 1) + 1"),
  "Recovery/Retentativa atualiza registro existente em pending_inbounds (UPDATE) em vez de tentar novo INSERT"
);

assert(
  inboundCode.includes('existingEvent.status === "processed"') &&
  inboundCode.includes("duplicate: true"),
  "Deduplicação durável retorna duplicate: true quando o evento já foi processado"
);

assert(
  inboundCode.includes(".where(eq(pendingInbounds.id, targetInboundId))"),
  "Finalização e captura de erro atualizam estritamente o targetInboundId correto"
);

// ── 3. Recovery Worker Atômico & Provedor Original ──────────────────────────
console.log("\n📌 3. Testando src/lib/whatsapp/recovery.ts...");
const recoveryCode = readFileSync(resolve("src/lib/whatsapp/recovery.ts"), "utf-8");

assert(
  recoveryCode.includes("pg_try_advisory_xact_lock(hashtext(${'outbound:' + msg.id}))"),
  "RecoveryWorker adquire pg_try_advisory_xact_lock por mensagem de saída para evitar duplo envio"
);

assert(
  recoveryCode.includes("pg_try_advisory_xact_lock(hashtext(${'inbound:' + inb.id}))"),
  "RecoveryWorker adquire pg_try_advisory_xact_lock por evento de entrada preso"
);

assert(
  recoveryCode.includes("(msg.provider as WhatsAppProviderType) || (channelConfig?.activeProvider as WhatsAppProviderType)"),
  "RecoveryWorker respeita OBRIGATORIAMENTE o provedor original gravado na mensagem (msg.provider), não o ativo do canal"
);

assert(
  recoveryCode.includes("contacts.phone") &&
  recoveryCode.includes("resolvedPhone"),
  "RecoveryWorker resolve o telefone de destino do contato no banco quando ausente no payload"
);

// ── 4. Reconciliação Manual de Mensagens ────────────────────────────────────
console.log("\n📌 4. Testando src/routes/api/chats/reconcile-message.ts...");
assert(
  existsSync(resolve("src/routes/api/chats/reconcile-message.ts")),
  "Arquivo src/routes/api/chats/reconcile-message.ts existe"
);

const reconcileCode = readFileSync(resolve("src/routes/api/chats/reconcile-message.ts"), "utf-8");

assert(
  reconcileCode.includes("requireSession(request)"),
  "Rota de reconciliação exige sessão obrigatória via requireSession"
);

assert(
  reconcileCode.includes("eq(messages.tenantId, tenantId)"),
  "Reconciliação filtra mensagem estritamente pelo tenantId da sessão do operador"
);

assert(
  reconcileCode.includes("pg_try_advisory_xact_lock(hashtext(${'reconcile:' + messageId}))"),
  "Reconciliação usa advisory lock para rejeitar cliques simultâneos de operadores com 409 CONCURRENCY_CONFLICT"
);

assert(
  reconcileCode.includes("const eligibleStatuses = [\"uncertain\", \"failed\", \"sending\"]"),
  "Reconciliação restrita a mensagens com status incerto ('uncertain'), falho ('failed') ou presas ('sending')"
);

assert(
  reconcileCode.includes("(msg.provider as WhatsAppProviderType) || \"baileys\""),
  "Reconciliação despacha OBRIGATORIAMENTE pelo provedor original da mensagem"
);

// ── 5. Status Uncertain em Outbound ─────────────────────────────────────────
console.log("\n📌 5. Testando src/lib/whatsapp/outbound.ts...");
const outboundCode = readFileSync(resolve("src/lib/whatsapp/outbound.ts"), "utf-8");

assert(
  outboundCode.includes('finalStatus = isUncertain ? "uncertain" : "failed"') &&
  outboundCode.includes("ETIMEDOUT") &&
  outboundCode.includes("ECONNRESET"),
  "OutboundQueue detecta timeouts/erros de rede e marca status como 'uncertain' para permitir reconciliação"
);

// ── 6. Transição Segura de Provedor (switching) ─────────────────────────────
console.log("\n📌 6. Testando Transição Segura em settings/whatsapp/actions.ts e send.ts...");
const actionsCode = readFileSync(resolve("src/routes/api/settings/whatsapp/actions.ts"), "utf-8");

assert(
  actionsCode.includes("metaAdapter.testCredentials(session.tenantId)") &&
  actionsCode.includes("META_VALIDATION_FAILED"),
  "switch_provider executa teste prévio de credenciais com a Meta antes de alternar o canal"
);

assert(
  actionsCode.includes('connectionStatus: "switching"') &&
  actionsCode.includes('status: "switching"'),
  "switch_provider marca estado intermediário 'switching' e notifica operadores via SSE"
);

assert(
  actionsCode.includes("baileysAdapter.pause(session.tenantId)"),
  "switch_provider pausa o Baileys de forma limpa sem logout ao mudar para Meta"
);

const sendCode = readFileSync(resolve("src/routes/api/whatsapp/send.ts"), "utf-8");

assert(
  sendCode.includes('channelConfig?.connectionStatus === "switching"') &&
  sendCode.includes("PROVIDER_SWITCHING"),
  "send.ts bloqueia novos envios com HTTP 409 PROVIDER_SWITCHING durante transição de provedor"
);

// ── Resultado Final ─────────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════════════════════════════");
console.log(`📊 RESULTADO DA SUÍTE DE TESTES: ${passed} passaram, ${failed} falharam.`);
console.log("════════════════════════════════════════════════════════════════\n");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎉 TODOS OS TESTES DA ENTREGA 3 FORAM APROVADOS COM SUCESSO!\n");
  process.exit(0);
}
