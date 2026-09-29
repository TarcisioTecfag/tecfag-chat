/**
 * Runner de Regressão Completa do CRM (E0 até E8)
 * Executa todas as suítes de teste ponta a ponta em valemchat_test e compila o placar geral.
 */
import { execSync } from "child_process";

const suites = [
  { name: "E0: Contratos de Segurança, Isolamento Multi-Tenant e RBAC", file: "test/verify-e0-security-contracts.ts" },
  { name: "E1: Criação de Negócios e DTO Estrito", file: "test/verify-e1-deal-creation-dto.ts" },
  { name: "E2: Contas, Contatos e Participantes Vinculados", file: "test/verify-e2-accounts-contacts-participants.ts" },
  { name: "E3: Atividades de Negócio e Próxima Tarefa Operacional", file: "test/verify-e3-deal-activities-next-task.ts" },
  { name: "E4: Kanban, Estágios e Volumetria por Fase", file: "test/verify-e4-kanban-volume-stages.ts" },
  { name: "E5: Filtros Avançados, Visualização em Lista e Resumo", file: "test/verify-e5-filters-and-list.ts" },
  { name: "E6: Ficha Unificada de Negócio e Navegação Integrada", file: "test/verify-e6-deal-detail-navigation.ts" },
  { name: "E7: Migração de Dados Legados, Concorrência e Bloqueios", file: "test/verify-e7-data-migration-concurrency.ts" },
  { name: "E8: Paridade Funcional Ampliada (Propostas, Arquivos, E-mails, Forms, IA)", file: "test/verify-e8-extended-parity.ts" }
];

console.log("═════════════════════════════════════════════════════════════════════");
console.log("🚀 INICIANDO REGRESSÃO COMPLETA DO CRM (E0 até E8)");
console.log("   Ambiente: valemchat_test (PostgreSQL isolado)");
console.log("═════════════════════════════════════════════════════════════════════\n");

let passedSuites = 0;
let failedSuites = 0;
const results: { name: string; status: "PASS" | "FAIL"; durationMs: number }[] = [];

const startTime = Date.now();

for (const suite of suites) {
  const suiteStart = Date.now();
  console.log(`▶ Executando [${suite.name}]...`);
  try {
    const output = execSync(`npx tsx ${suite.file}`, {
      env: {
        ...process.env,
        DATABASE_URL: "postgres://postgres:123@localhost:5432/valemchat_test",
        TEST_DATABASE_URL: "postgres://postgres:123@localhost:5432/valemchat_test"
      },
      encoding: "utf-8",
      stdio: "pipe"
    });
    const durationMs = Date.now() - suiteStart;
    console.log(`  ✅ ${suite.name} - Concluído com sucesso (${durationMs}ms)`);
    passedSuites++;
    results.push({ name: suite.name, status: "PASS", durationMs });
  } catch (err: any) {
    const durationMs = Date.now() - suiteStart;
    console.error(`  ❌ ${suite.name} - FALHOU (${durationMs}ms)`);
    if (err.stdout) console.error(err.stdout);
    if (err.stderr) console.error(err.stderr);
    failedSuites++;
    results.push({ name: suite.name, status: "FAIL", durationMs });
    break; // interrompe na primeira falha para triagem imediata
  }
}

const totalDurationMs = Date.now() - startTime;

console.log("\n═════════════════════════════════════════════════════════════════════");
console.log("📊 PLACAR CONSOLIDADO DA REGRESSÃO CRM (E0 a E8)");
console.log(`   Tempo Total: ${(totalDurationMs / 1000).toFixed(2)}s`);
console.log(`   Suítes Aprovadas: ${passedSuites} / ${suites.length}`);
console.log(`   Suítes Falhadas:  ${failedSuites} / ${suites.length}`);
console.log("═════════════════════════════════════════════════════════════════════");
for (const res of results) {
  console.log(`  ${res.status === "PASS" ? "✅" : "❌"} ${res.name.padEnd(65)} [${res.status}] (${res.durationMs}ms)`);
}
console.log("═════════════════════════════════════════════════════════════════════\n");

if (failedSuites > 0) {
  console.error("❌ Regressão finalizada com falhas!");
  process.exit(1);
} else {
  console.log("🎉 TODAS AS SUÍTES DO CRM (E0 A E8) PASSARAM COM 100% DE SUCESSO!");
  process.exit(0);
}
