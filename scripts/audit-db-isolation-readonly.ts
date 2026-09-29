/**
 * audit-db-isolation-readonly.ts
 *
 * Script de auditoria SOMENTE-LEITURA para verificação de isolamento multi-tenant.
 * Conforme o Item 4 da Entrega 2 do PLANO-CORRECAO-ISOLAMENTO-VALEM-TECFAG.md:
 * "Fazer auditoria somente de leitura para localizar dados existentes com tenant_id
 * diferente entre relações: conversa→contato/operador/setor, mensagem→conversa,
 * auditoria→conversa/operador, mídia→mensagem/conversa, card→funil/etapa/contato/conversa/operador,
 * Live Chat e voz. Emitir contagens e IDs para revisão; não corrigir registros automaticamente."
 *
 * REGRA ABSOLUTA: PROIBIDA QUALQUER MUTAÇÃO (INSERT/UPDATE/DELETE/ALTER/DROP).
 * APENAS QUERIES SELECT.
 */

import fs from "fs";
import path from "path";
import postgres from "postgres";

function getConnectionString(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // Ler do .env se existir
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.replace("DATABASE_URL=", "").trim();
      }
    }
  }

  return "postgres://postgres:postgres@localhost:5432/valemchat";
}

const connectionString = getConnectionString();
const isCloud = connectionString.includes("railway") || connectionString.includes("neon") || connectionString.includes("supabase") || connectionString.includes("render");

const sql = postgres(connectionString, {
  max: 2,
  prepare: false,
  ssl: isCloud && !connectionString.includes("localhost") ? { rejectUnauthorized: false } : false,
});

interface CheckResult {
  category: string;
  relation: string;
  status: "OK" | "ANOMALIA" | "AVISO";
  count: number;
  sampleIds: Array<{ id: string; tenantA?: string; tenantB?: string; detail?: string }>;
}

async function runReadOnlyAudit() {
  const [dbInfo] = await sql`SELECT current_database() as db_name, inet_server_addr()::text as server_ip`;
  const dbName = (dbInfo as any)?.db_name || "unknown";
  const serverIp = (dbInfo as any)?.server_ip || "local";
  const maskedConn = connectionString.replace(/:([^:@]+)@/, ":****@");

  console.log("================================================================================");
  console.log("🔍 AUDITORIA SOMENTE-LEITURA DE ISOLAMENTO MULTI-TENANT (VALEM × TECFAG)");
  console.log("================================================================================");
  console.log(`📡 Banco Conectado: ${dbName} (${serverIp})`);
  console.log(`🔗 URL Mascarada:   ${maskedConn}`);
  console.log(`🛡️  Modo de Execução: SOMENTE LEITURA (Zero mutações no banco)`);
  console.log("================================================================================\n");

  const results: CheckResult[] = [];

  // Helper para checagem genérica
  async function checkCrossTenant(
    category: string,
    relation: string,
    query: string
  ) {
    try {
      const rows = await sql.unsafe(query);
      const count = rows.length;
      const sample = rows.slice(0, 5).map((r: any) => ({
        id: String(r.id || r.deal_id || r.conv_id || "n/a"),
        tenantA: r.tenant_a || r.t1 || r.item_tenant,
        tenantB: r.tenant_b || r.t2 || r.parent_tenant,
        detail: r.detail || "",
      }));

      results.push({
        category,
        relation,
        status: count === 0 ? "OK" : "ANOMALIA",
        count,
        sampleIds: sample,
      });
    } catch (err: any) {
      results.push({
        category,
        relation,
        status: "AVISO",
        count: -1,
        sampleIds: [{ id: "ERRO", detail: err.message }],
      });
    }
  }

  // ─── 1. CONTAGENS GERAIS POR TENANT ──────────────────────────────────────────
  console.log("📊 1. INVENTÁRIO GERAL DE REGISTROS POR TENANT:\n");
  const countTables = [
    "operators",
    "access_groups",
    "sectors",
    "contacts",
    "conversations",
    "messages",
    "media_files",
    "ai_conversation_audits",
    "crm_accounts",
    "crm_deals",
    "crm_deal_activities",
    "call_sessions",
  ];

  console.log("| Tabela | Valem | Tecfag | Outros/Null | Total |");
  console.log("|---|---|---|---|---|");

  for (const tbl of countTables) {
    try {
      const rows = await sql.unsafe(`
        SELECT 
          COUNT(*) FILTER (WHERE tenant_id = 'valem') as valem_count,
          COUNT(*) FILTER (WHERE tenant_id = 'tecfag') as tecfag_count,
          COUNT(*) FILTER (WHERE tenant_id IS NULL OR (tenant_id != 'valem' AND tenant_id != 'tecfag')) as other_count,
          COUNT(*) as total_count
        FROM ${tbl};
      `);
      const r = rows[0] as any;
      console.log(`| ${tbl.padEnd(23)} | ${String(r.valem_count).padStart(5)} | ${String(r.tecfag_count).padStart(6)} | ${String(r.other_count).padStart(11)} | ${String(r.total_count).padStart(5)} |`);
    } catch (e: any) {
      console.log(`| ${tbl.padEnd(23)} | (tabela não encontrada ou erro: ${e.message}) |`);
    }
  }
  console.log("\n");

  // ─── 2. VERIFICAÇÃO DE REGISTROS COM TENANT_ID NULO ──────────────────────────
  console.log("🔍 2. CHECAGEM DE REGISTROS ORFÃOS DE TENANT (tenant_id IS NULL):\n");
  for (const tbl of countTables) {
    await checkCrossTenant(
      "Nulidade de Tenant",
      `${tbl}.tenant_id IS NULL`,
      `SELECT id, tenant_id as item_tenant FROM ${tbl} WHERE tenant_id IS NULL LIMIT 10;`
    );
  }

  // ─── 3. CHECAGENS RELACIONAIS DE ATENDIMENTO & CHAT ──────────────────────────
  console.log("🔍 3. CHECAGEM DE ASSOCIAÇÕES CRUZADAS: CHAT & ATENDIMENTO:\n");

  // Conversa -> Contato
  await checkCrossTenant(
    "Chat",
    "conversations → contacts",
    `SELECT c.id, c.tenant_id as tenant_a, ct.tenant_id as tenant_b 
     FROM conversations c 
     INNER JOIN contacts ct ON c.contact_id = ct.id 
     WHERE c.tenant_id != ct.tenant_id;`
  );

  // Conversa -> Operador
  await checkCrossTenant(
    "Chat",
    "conversations → operators",
    `SELECT c.id, c.tenant_id as tenant_a, op.tenant_id as tenant_b 
     FROM conversations c 
     INNER JOIN operators op ON c.operator_id = op.id 
     WHERE c.tenant_id != op.tenant_id;`
  );

  // Conversa -> Setor
  await checkCrossTenant(
    "Chat",
    "conversations → sectors",
    `SELECT c.id, c.tenant_id as tenant_a, s.tenant_id as tenant_b 
     FROM conversations c 
     INNER JOIN sectors s ON c.sector_id = s.id 
     WHERE c.tenant_id != s.tenant_id;`
  );

  // Mensagem -> Conversa
  await checkCrossTenant(
    "Chat",
    "messages → conversations",
    `SELECT m.id, m.tenant_id as tenant_a, c.tenant_id as tenant_b 
     FROM messages m 
     INNER JOIN conversations c ON m.conversation_id = c.id 
     WHERE m.tenant_id != c.tenant_id;`
  );

  // Mídia -> Conversa
  await checkCrossTenant(
    "Mídia",
    "media_files → conversations",
    `SELECT mf.id, mf.tenant_id as tenant_a, c.tenant_id as tenant_b 
     FROM media_files mf 
     INNER JOIN conversations c ON mf.conversation_id = c.id 
     WHERE mf.tenant_id IS NOT NULL AND mf.tenant_id != c.tenant_id;`
  );

  // Auditoria IA -> Conversa
  await checkCrossTenant(
    "Auditoria IA",
    "ai_conversation_audits → conversations",
    `SELECT a.id, a.tenant_id as tenant_a, c.tenant_id as tenant_b 
     FROM ai_conversation_audits a 
     INNER JOIN conversations c ON a.conversation_id = c.id 
     WHERE a.tenant_id != c.tenant_id;`
  );

  // Auditoria IA -> Operador
  await checkCrossTenant(
    "Auditoria IA",
    "ai_conversation_audits → operators",
    `SELECT a.id, a.tenant_id as tenant_a, op.tenant_id as tenant_b 
     FROM ai_conversation_audits a 
     INNER JOIN operators op ON a.operator_id = op.id 
     WHERE a.tenant_id != op.tenant_id;`
  );

  // Resposta SLA -> Conversa
  await checkCrossTenant(
    "SLA Engine",
    "response_time_logs → conversations",
    `SELECT r.id, r.tenant_id as tenant_a, c.tenant_id as tenant_b 
     FROM response_time_logs r 
     INNER JOIN conversations c ON r.conversation_id = c.id 
     WHERE r.tenant_id != c.tenant_id;`
  );

  // ─── 4. CHECAGENS RELACIONAIS DE CRM & NEGOCIAÇÕES ───────────────────────────
  console.log("🔍 4. CHECAGEM DE ASSOCIAÇÕES CRUZADAS: CRM & NEGOCIAÇÕES:\n");

  // Deal -> Pipeline
  await checkCrossTenant(
    "CRM",
    "crm_deals → crm_pipelines",
    `SELECT d.id, d.tenant_id as tenant_a, p.tenant_id as tenant_b 
     FROM crm_deals d 
     INNER JOIN crm_pipelines p ON d.pipeline_id = p.id 
     WHERE d.tenant_id != p.tenant_id;`
  );

  // Deal -> Stage
  await checkCrossTenant(
    "CRM",
    "crm_deals → crm_stages",
    `SELECT d.id, d.tenant_id as tenant_a, s.tenant_id as tenant_b 
     FROM crm_deals d 
     INNER JOIN crm_stages s ON d.stage_id = s.id 
     WHERE d.tenant_id != s.tenant_id;`
  );

  // Deal -> Conta
  await checkCrossTenant(
    "CRM",
    "crm_deals → crm_accounts",
    `SELECT d.id, d.tenant_id as tenant_a, a.tenant_id as tenant_b 
     FROM crm_deals d 
     INNER JOIN crm_accounts a ON d.account_id = a.id 
     WHERE d.tenant_id != a.tenant_id;`
  );

  // Deal -> Operador
  await checkCrossTenant(
    "CRM",
    "crm_deals → operators",
    `SELECT d.id, d.tenant_id as tenant_a, op.tenant_id as tenant_b 
     FROM crm_deals d 
     INNER JOIN operators op ON d.operator_id = op.id 
     WHERE d.tenant_id != op.tenant_id;`
  );

  // Atividade -> Deal
  await checkCrossTenant(
    "CRM",
    "crm_deal_activities → crm_deals",
    `SELECT act.id, act.tenant_id as tenant_a, d.tenant_id as tenant_b 
     FROM crm_deal_activities act 
     INNER JOIN crm_deals d ON act.deal_id = d.id 
     WHERE act.tenant_id != d.tenant_id;`
  );

  // Arquivo do Deal -> Deal
  await checkCrossTenant(
    "CRM",
    "crm_deal_files → crm_deals",
    `SELECT f.id, f.tenant_id as tenant_a, d.tenant_id as tenant_b 
     FROM crm_deal_files f 
     INNER JOIN crm_deals d ON f.deal_id = d.id 
     WHERE f.tenant_id != d.tenant_id;`
  );

  // Questionário -> Deal
  await checkCrossTenant(
    "CRM",
    "crm_deal_questionnaires → crm_deals",
    `SELECT q.id, q.tenant_id as tenant_a, d.tenant_id as tenant_b 
     FROM crm_deal_questionnaires q 
     INNER JOIN crm_deals d ON q.deal_id = d.id 
     WHERE q.tenant_id != d.tenant_id;`
  );

  // E-mail -> Deal
  await checkCrossTenant(
    "CRM",
    "crm_deal_emails → crm_deals",
    `SELECT e.id, e.tenant_id as tenant_a, d.tenant_id as tenant_b 
     FROM crm_deal_emails e 
     INNER JOIN crm_deals d ON e.deal_id = d.id 
     WHERE e.tenant_id != d.tenant_id;`
  );

  // Vínculo Conversa ↔ Deal
  await checkCrossTenant(
    "CRM",
    "crm_conversation_deals → crm_deals",
    `SELECT cd.id, cd.tenant_id as tenant_a, d.tenant_id as tenant_b 
     FROM crm_conversation_deals cd 
     INNER JOIN crm_deals d ON cd.deal_id = d.id 
     WHERE cd.tenant_id != d.tenant_id;`
  );

  await checkCrossTenant(
    "CRM",
    "crm_conversation_deals → conversations",
    `SELECT cd.id, cd.tenant_id as tenant_a, c.tenant_id as tenant_b 
     FROM crm_conversation_deals cd 
     INNER JOIN conversations c ON cd.conversation_id = c.id 
     WHERE cd.tenant_id != c.tenant_id;`
  );

  // ─── 5. CHECAGENS RELACIONAIS DE VOZ & WEBRTC ────────────────────────────────
  console.log("🔍 5. CHECAGEM DE ASSOCIAÇÕES CRUZADAS: VOZ & WEBRTC:\n");

  await checkCrossTenant(
    "Voz",
    "call_sessions → conversations",
    `SELECT cs.id, cs.tenant_id as tenant_a, c.tenant_id as tenant_b 
     FROM call_sessions cs 
     INNER JOIN conversations c ON cs.conversation_id = c.id 
     WHERE cs.tenant_id != c.tenant_id;`
  );

  await checkCrossTenant(
    "Voz",
    "call_sessions → operators",
    `SELECT cs.id, cs.tenant_id as tenant_a, op.tenant_id as tenant_b 
     FROM call_sessions cs 
     INNER JOIN operators op ON cs.operator_id = op.id 
     WHERE cs.tenant_id != op.tenant_id;`
  );

  // ─── 6. TABELA CONSOLIDADA DE RESULTADOS ──────────────────────────────────────
  console.log("📋 TABELA CONSOLIDADA DE AUDITORIA DE ISOLAMENTO:\n");
  console.log("| Categoria | Relação Auditada | Status | Violações | Amostras |");
  console.log("|---|---|---|---|---|");

  let totalAnomalias = 0;

  for (const res of results) {
    const statusIcon = res.status === "OK" ? "✅ OK" : res.status === "ANOMALIA" ? "❌ ANOMALIA" : "⚠️ AVISO";
    const violationsStr = res.count >= 0 ? String(res.count) : "Erro";
    if (res.status === "ANOMALIA") totalAnomalias += res.count;

    const samplesStr = res.sampleIds.length > 0
      ? res.sampleIds.map((s) => `${s.id} (${s.tenantA || "?"}≠${s.tenantB || "?"})`).join(", ")
      : "—";

    console.log(`| ${res.category.padEnd(16)} | ${res.relation.padEnd(38)} | ${statusIcon.padEnd(11)} | ${violationsStr.padStart(9)} | ${samplesStr} |`);
  }

  console.log("\n================================================================================");
  if (totalAnomalias === 0) {
    console.log("🎉 RESULTADO: ISOLAMENTO ÍNTEGRO! Zero associações cruzadas encontradas.");
  } else {
    console.log(`⚠️ RESULTADO: ${totalAnomalias} REGISTRO(S) COM DISCREPÂNCIA DE TENANT ENCONTRADOS.`);
    console.log("   (Nenhum dado foi alterado; a resolução deve ser feita via migração planejada).");
  }
  console.log("================================================================================\n");

  await sql.end();
}

runReadOnlyAudit().catch((e) => {
  console.error("Erro fatal na auditoria:", e);
  process.exit(1);
});
