import { isPhoneWhitelisted } from "../src/lib/valentina/sdr-engine";

console.log("=== TESTANDO ALGORITMO DE MATCHING DE WHITELIST ===");

const whitelistNumber = "14998364338";

const testCases = [
  { phone: "14998364338", expected: true, label: "Número exato igual cadastrado" },
  { phone: "5514998364338", expected: true, label: "Com DDI 55 + 9 dígitos" },
  { phone: "551498364338", expected: true, label: "Com DDI 55 sem 9º dígito (8 dígitos)" },
  { phone: "1498364338", expected: true, label: "DDD 14 sem 9º dígito" },
  { phone: "+55 (14) 99836-4338", expected: true, label: "Formatado com máscara +55 (14) 99836-4338" },
  { phone: "5511999998888", expected: false, label: "Número de outro cliente (Não autorizado)" },
  { phone: "5581987654321", expected: false, label: "Outro número qualquer (Não autorizado)" },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = isPhoneWhitelisted(tc.phone, whitelistNumber);
  const ok = result === tc.expected;
  if (ok) {
    console.log(`✅ [PASS] ${tc.label} (${tc.phone}) -> Resultado: ${result}`);
    passed++;
  } else {
    console.log(`❌ [FAIL] ${tc.label} (${tc.phone}) -> Esperado: ${tc.expected}, Recebido: ${result}`);
    failed++;
  }
}

console.log(`\nResultado Final: ${passed}/${testCases.length} testes aprovados.`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("🚀 Whitelist matching funcionando com 100% de precisão!");
}
