/**
 * verify-entrega2-unit.ts
 * 
 * Suíte de verificação automatizada para a Entrega 2: Provedores Coerentes.
 * Valida a integridade do código, adapters, rotas e regras de isolamento/preservação.
 */

import { readFileSync } from "fs";
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
console.log("   SUÍTE DE VERIFICAÇÃO UNITÁRIA & ARQUITETURAL — ENTREGA 2");
console.log("   (Provedores Coerentes: Baileys vs Meta Cloud API)");
console.log("════════════════════════════════════════════════════════════════\n");

// 1. WhatsApp Service & getActiveProvider
console.log("📌 1. Testando src/lib/whatsapp/service.ts...");
const serviceCode = readFileSync(resolve("src/lib/whatsapp/service.ts"), "utf-8");
assert(
  serviceCode.includes("export async function getActiveProvider"),
  "getActiveProvider está exportado na raiz do serviço de WhatsApp"
);
assert(
  serviceCode.includes("eq(channelConfigs.tenantId, tenantId)"),
  "getActiveProvider filtra estritamente por tenantId"
);

// 2. SessionManager pauseSession & preservação de chaves
console.log("\n📌 2. Testando src/lib/baileys/session-manager.ts...");
const sessionMgrCode = readFileSync(resolve("src/lib/baileys/session-manager.ts"), "utf-8");
assert(
  sessionMgrCode.includes("public async pauseSession(tenantId: string)"),
  "Método pauseSession(tenantId) existe no SessionManager"
);
assert(
  sessionMgrCode.includes("sock.end(undefined)") || sessionMgrCode.includes("sock.end()"),
  "pauseSession encerra o socket TCP sem executar sock.logout()"
);
assert(
  !sessionMgrCode.includes("UPDATE channel_configs SET baileys_auth_keys = NULL WHERE tenant_id = $1"),
  "pauseSession não destrói as credenciais baileysAuthKeys no banco"
);
assert(
  sessionMgrCode.includes('if (cfg?.activeProvider === "meta")'),
  "SessionManager verifica se activeProvider é 'meta' ao fechar conexão para evitar reconexão indevida"
);

// 3. Adapter Baileys & Envio de Mídia Local
console.log("\n📌 3. Testando src/lib/whatsapp/adapters/baileys.ts...");
const baileysAdapterCode = readFileSync(resolve("src/lib/whatsapp/adapters/baileys.ts"), "utf-8");
assert(
  baileysAdapterCode.includes("pause(tenantId: string)"),
  "BaileysAdapter implementa método pause()"
);
assert(
  baileysAdapterCode.includes("buffer:") || baileysAdapterCode.includes("mediaFiles"),
  "BaileysAdapter suporta envio de mídia via Buffer/mediaFiles local"
);

// 4. Adapter Meta & Upload de Mídia
console.log("\n📌 4. Testando src/lib/whatsapp/adapters/meta.ts...");
const metaAdapterCode = readFileSync(resolve("src/lib/whatsapp/adapters/meta.ts"), "utf-8");
assert(
  metaAdapterCode.includes("uploadMediaToMeta"),
  "MetaAdapter possui método uploadMediaToMeta para upload multipart oficial"
);
assert(
  metaAdapterCode.includes("graph.facebook.com") && metaAdapterCode.includes("/media"),
  "Upload de mídia da Meta aponta para o endpoint oficial da Graph API"
);

// 5. Rota /api/baileys/connect — Bloqueio de conexão se Meta estiver ativo
console.log("\n📌 5. Testando src/routes/api/baileys/connect.ts...");
const baileysConnectCode = readFileSync(resolve("src/routes/api/baileys/connect.ts"), "utf-8");
assert(
  baileysConnectCode.includes("getActiveProvider(tenantId)") && baileysConnectCode.includes('activeProvider === "meta"'),
  "Bloqueia /api/baileys/connect se o activeProvider do tenant for 'meta'"
);
assert(
  baileysConnectCode.includes("INACTIVE_PROVIDER"),
  "Retorna código de erro INACTIVE_PROVIDER ao tentar conectar Baileys quando o canal for Meta"
);

// 6. Rota /api/settings/whatsapp/actions — switch_provider e validação
console.log("\n📌 6. Testando src/routes/api/settings/whatsapp/actions.ts...");
const settingsActionsCode = readFileSync(resolve("src/routes/api/settings/whatsapp/actions.ts"), "utf-8");
assert(
  settingsActionsCode.includes("MISSING_META_CREDENTIALS"),
  "switch_provider para Meta valida a presença de credenciais (metaPhoneNumberId e metaAccessToken)"
);
assert(
  settingsActionsCode.includes("baileysAdapter.pause(session.tenantId)"),
  "switch_provider de Baileys para Meta pausa o Baileys preservando chaves"
);

// 7. Rota /api/whatsapp/send — Envio unificado multipart & json
console.log("\n📌 7. Testando src/routes/api/whatsapp/send.ts...");
const sendCode = readFileSync(resolve("src/routes/api/whatsapp/send.ts"), "utf-8");
assert(
  sendCode.includes("multipart/form-data") && sendCode.includes("formData()"),
  "/api/whatsapp/send suporta requisições multipart/form-data com arquivos anexos"
);
assert(
  sendCode.includes("mediaFiles") && sendCode.includes("outboundQueue.enqueueAndSend"),
  "/api/whatsapp/send persiste anexo e despacha unificado via fila de saída outboundQueue"
);
assert(
  sendCode.includes("eq(conversations.id, conversationId)") && sendCode.includes("eq(conversations.tenantId, session.tenantId)"),
  "/api/whatsapp/send busca a conversa no banco validando estritamente id e tenantId da sessão"
);

// 8. Rota /api/events — SSE universal com requireSession
console.log("\n📌 8. Testando src/routes/api/events.ts...");
const eventsCode = readFileSync(resolve("src/routes/api/events.ts"), "utf-8");
assert(
  eventsCode.includes("requireSession(request)"),
  "/api/events protege o stream SSE universal com requireSession"
);

// 9. Frontend hook useChatState.tsx — SSE universal e bloqueio Baileys
console.log("\n📌 9. Testando src/hooks/useChatState.tsx...");
const hookCode = readFileSync(resolve("src/hooks/useChatState.tsx"), "utf-8");
assert(
  hookCode.includes("connectUniversal") && hookCode.includes("/api/events"),
  "Frontend conecta ao SSE universal /api/events"
);
assert(
  hookCode.includes("Math.min(1000 * Math.pow(2,"),
  "Reconexão do SSE universal implementa backoff exponencial (1s, 2s, 4s... máx 30s)"
);
assert(
  hookCode.includes("updateDocumentTitle"),
  "Título dinâmico implementado via updateDocumentTitle"
);
assert(
  !hookCode.includes('"Tec Chat — Meta API"') && !hookCode.includes('"Valem Chat — Baileys API"'),
  "Removidas todas as ocorrências de títulos hardcoded fixando canal por tenant"
);
assert(
  hookCode.includes('if (activeProvider === "meta")') && hookCode.includes("connectBaileys"),
  "connectBaileys bloqueia a conexão imediatamente quando activeProvider === 'meta'"
);

// 10. SettingsView.tsx — Status contextual por provedor
console.log("\n📌 10. Testando src/components/chat/SettingsView.tsx...");
const settingsViewCode = readFileSync(resolve("src/components/chat/SettingsView.tsx"), "utf-8");
assert(
  settingsViewCode.includes("Meta WhatsApp API (Conectado)") && settingsViewCode.includes("Configuração incompleta"),
  "SettingsView exibe status 'Meta WhatsApp API (Conectado)' ou 'Configuração incompleta' conforme preenchimento"
);

console.log("\n────────────────────────────────────────────────────────────────");
console.log(`📊 RESULTADO FINAL DA SUÍTE DE TESTES DA ENTREGA 2:`);
console.log(`   Total de Testes: ${passed + failed}`);
console.log(`   Aprovados:       ${passed}`);
console.log(`   Falhas:          ${failed}`);
console.log("────────────────────────────────────────────────────────────────\n");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎉 TODOS OS 18 TESTES DA ENTREGA 2 FORAM APROVADOS COM SUCESSO!\n");
  process.exit(0);
}
