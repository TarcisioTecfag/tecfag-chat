/**
 * Auditoria OFFLINE dos classificadores locais do legado e da v2.
 * Não importa o aplicativo, não lê .env, não conecta banco e não chama IA/APIs.
 * O fallback textual do legado e o pós-processador da v2 têm entradas distintas:
 * isto caracteriza regras locais; NÃO mede a qualidade do LLM nem o fluxo inteiro.
 *
 * node scripts/audit-fagner-triage-parity.mjs --legacy-root "C:/.../Tecfag I.A Faggner"
 * Acrescente --out docs/<novo-relatorio>.json para salvar evidências.
 * --check-parity faz divergências encerrarem com código 1 (por padrão, só relata).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function argument(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error(`Informe um valor para ${name}.`);
  }
  return args[index + 1];
}
const legacyRootArg = argument("--legacy-root");
if (!legacyRootArg) throw new Error("Informe --legacy-root com o checkout local do legado.");
const legacyRoot = path.resolve(legacyRootArg);
const outArg = argument("--out");
const evidence = [];

// Allowlist fechada: nenhuma dependência do aplicativo pode ser executada.
function loadPure(relativePath, base, dependencies = {}) {
  const absolute = path.resolve(base, relativePath);
  const source = fs.readFileSync(absolute, "utf8");
  evidence.push({
    project: base === root ? "v2" : "legacy",
    path: relativePath,
    sha256: crypto.createHash("sha256").update(source).digest("hex"),
  });
  const compiled = ts.transpileModule(source, {
    fileName: absolute,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics || []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(errors, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => root,
        getNewLine: () => "\n",
      }),
    );
  const module = { exports: {} };
  const blockedRequire = (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Import bloqueado na auditoria offline: ${name}`);
  };
  vm.runInNewContext(
    compiled.outputText,
    {
      module,
      exports: module.exports,
      require: blockedRequire,
      console: { log() {}, warn() {}, error() {} },
    },
    { filename: absolute, timeout: 2000 },
  );
  return module.exports;
}

const routes = loadPure("server/fagner/routingConfig.ts", legacyRoot);
const old = loadPure("server/fagner/flowEngine.ts", legacyRoot, {
  "./routingConfig.js": routes,
  "./rdCrmService.js": {
    getNextOperator() {
      throw new Error("Seleção de operador proibida nesta auditoria.");
    },
  },
});
const industrialPolicy = loadPure("src/lib/triage/industrial-policy.ts", root);
const current = loadPure("src/lib/valentina/sdr-tecfag-prompt.ts", root, {
  "../triage/industrial-policy.ts": industrialPolicy,
});
const columns = {
  "assistencia-tecnica": "assistencia_tecnica",
  "pos-venda": "pos_venda",
  "sem-resposta": "sem_resposta",
};
const scenarios = [
  ["comercial-maquina", "Quero comprar uma seladora"],
  ["comercial-envasadora", "Preciso de uma envasadora"],
  ["comercial-personnalite-campanha", "Quero ver soluções Personnalité"],
  ["pecas-teflon", "Preciso de fita de teflon para reposição"],
  ["pecas-ribbon", "Quero cotar ribbon"],
  ["pecas-inkroll", "Preciso de ink roll"],
  ["financeiro-boleto-maquina", "Preciso da segunda via do boleto da seladora"],
  ["financeiro-nf", "Preciso da segunda via da nota fiscal"],
  ["financeiro-estorno", "Quero saber do estorno da máquina que devolvi"],
  ["financeiro-reembolso", "Preciso de reembolso"],
  ["tecnica-defeito", "Minha seladora está com defeito"],
  ["tecnica-manual", "Preciso do manual da seladora"],
  ["tecnica-esquema", "Pode enviar o esquema elétrico da máquina?"],
  ["tecnica-manutencao-personnalite", "Preciso de manutenção na máquina Personnalité"],
  ["posvenda-rastreio", "Preciso do rastreio da entrega"],
  ["posvenda-nf-pedido", "Preciso da nota fiscal do pedido"],
  ["posvenda-devolucao", "Quero devolver a máquina"],
  ["outros-curriculo", "Quero enviar meu currículo"],
  ["outros-fornecedor", "Sou fornecedor e quero oferecer produtos para compras"],
  ["saudacao", "Olá, bom dia"],
];
const rows = scenarios.map(([id, input]) => {
  const detected = old.detectFlowFromText(input);
  const route = detected?.sub ? routes.getRoute(detected.sub) : undefined;
  const legacyStage = route ? columns[route.kanbanLane] || route.kanbanLane : "triagem";
  const resolved = current.resolveTecfagStageAndFunnel({
    collectedData: { "MÁQUINA / PEÇA / INTERESSE": { value: input } },
  });
  return {
    id,
    input,
    legacy: { flow: detected?.flow ?? null, subflow: detected?.sub ?? null, stage: legacyStage },
    v2: resolved,
    sameStage: legacyStage === resolved.funnelStage,
  };
});
// Entradas adicionais exercitam o contrato do pós-processador, sem inferência de LLM.
const metadataCases = [
  {
    id: "other-stage-has-no-sales-default",
    params: { aiFunnelStage: "outros", collectedData: {} },
  },
  {
    id: "no-response-has-no-sales-default",
    params: { aiFunnelStage: "sem_resposta", collectedData: {} },
  },
  {
    id: "unknown-stage-validation",
    params: { existingStage: "valor_invalido", collectedData: {} },
  },
  {
    id: "specific-parts-target-vs-prior-product",
    params: {
      aiTargetFunnel: "Peças",
      collectedData: { "MÁQUINA / PEÇA / INTERESSE": { value: "Máquina Personnalité" } },
    },
  },
].map(({ id, params }) => ({ id, input: params, v2: current.resolveTecfagStageAndFunnel(params) }));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: "Classificação determinística offline; não executa IA, banco, rede ou orquestração.",
  limitation:
    "O legado recebe texto bruto; a v2 recebe um campo que pode ser resumido pelo LLM. Igualdade de coluna não comprova paridade de subfluxo, coleta, CRM ou transferência. O legado também contém regras conflitantes e não é um oráculo automático.",
  evidence,
  summary: {
    scenarios: rows.length,
    sameStage: rows.filter((r) => r.sameStage).length,
    differentStage: rows.filter((r) => !r.sameStage).length,
    metadataCases: metadataCases.length,
  },
  scenarios: rows,
  metadataCases,
};
if (outArg) {
  const output = path.resolve(root, outArg);
  if (
    output === root ||
    !output.startsWith(`${root}${path.sep}`) ||
    path.extname(output) !== ".json"
  ) {
    throw new Error("--out deve apontar para um arquivo .json dentro do checkout da v2.");
  }
  // Evidência anterior nunca é substituída silenciosamente.
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (args.includes("--check-parity") && report.summary.differentStage) process.exitCode = 1;
