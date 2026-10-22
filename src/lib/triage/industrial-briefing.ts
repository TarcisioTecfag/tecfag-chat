import type { JournalSnapshot } from "./industrial-triage-journal.ts";

const missingLabels: Record<string, string> = {
  name: "Nome",
  document: "CPF/CNPJ",
  request: "Solicitação",
  application: "Aplicação",
  production: "Produção",
};
const formatTime = (value: string) =>
  `${new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília)`;
export function buildIndustrialBriefing(snapshot: JournalSnapshot) {
  const terminal = Boolean(
    snapshot.completedAt || (snapshot.outcome && snapshot.outcome !== "in_progress"),
  );
  const status =
    snapshot.outcome === "transferred" && snapshot.responsible
      ? "Encaminhamento registrado"
      : snapshot.outcome === "stopped"
        ? "Triagem interrompida"
        : snapshot.outcome === "abandoned"
          ? "Sem resposta"
          : terminal
            ? "Ciclo concluído/arquivado"
            : "Coleta em andamento";
  const lines = [
    terminal ? "BRIEFING FINAL DA TRIAGEM" : "RESUMO DA TRIAGEM EM ANDAMENTO",
    `Situação do ciclo: ${status}`,
    `Início: ${formatTime(snapshot.startedAt)}`,
    snapshot.lastInteractionAt && snapshot.lastInteractionAt !== snapshot.startedAt
      ? `Registro do ciclo: ${formatTime(snapshot.lastInteractionAt)}`
      : "",
    snapshot.targetFunnel ? `Destino: ${snapshot.targetFunnel}` : "",
    ...(snapshot.vtexLookup
      ? [
          `CONSULTA VTEX: ${snapshot.vtexLookup.status} · ${formatTime(snapshot.vtexLookup.checkedAt)}`,
          snapshot.vtexLookup.productName
            ? `Produto consultado na loja: ${snapshot.vtexLookup.productName}`
            : "",
          snapshot.vtexLookup.selectedSkuId
            ? `SKU consultado: ${snapshot.vtexLookup.selectedSkuId}`
            : "",
        ]
      : []),
    ...(snapshot.siteContext
      ? [
          "ORIGEM DO SITE:",
          `Página de entrada: ${snapshot.siteContext.entry.url}`,
          `Página no atendimento: ${snapshot.siteContext.page.url}`,
          snapshot.siteContext.entry.referrer
            ? `Referência de origem: ${snapshot.siteContext.entry.referrer}`
            : "",
          Object.keys(snapshot.siteContext.entry.utm).length
            ? `Campanha de entrada: ${Object.entries(snapshot.siteContext.entry.utm)
                .map(([key, value]) => `${key}=${value}`)
                .join(" · ")}`
            : "",
          snapshot.siteContext.product
            ? `Última consulta explícita de produto: ${snapshot.siteContext.product.name || "Nome não informado"} · ${snapshot.siteContext.product.url}${snapshot.siteContext.product.sku ? ` · SKU informado: ${snapshot.siteContext.product.sku}` : ""}`
            : "",
        ]
      : []),
    snapshot.responsible
      ? `Responsável: ${snapshot.responsible.name || snapshot.responsible.id}`
      : "",
    snapshot.dealId
      ? ""
      : "Este resumo não comprova criação de negociação.",
    snapshot.needsReview
      ? "Revisão especializada necessária."
      : "",
    snapshot.missingFields.length
      ? `Dados pendentes: ${snapshot.missingFields.map((field) => missingLabels[field] || field).join(", ")}`
      : "",
    snapshot.machine
      ? `Decisão de catálogo: ${snapshot.machine.status || "Não confirmada"}${snapshot.machine.line ? ` · Linha: ${snapshot.machine.line}` : ""}${snapshot.machine.machineId ? ` · Referência: ${snapshot.machine.machineId}` : ""}`
      : "",
    snapshot.humanReview
      ? `Revisão humana: ${snapshot.humanReview.operatorName} · ${formatTime(snapshot.humanReview.reviewedAt)}${snapshot.humanReview.current ? "" : " · A coleta mudou após a revisão"}\nMotivo: ${snapshot.humanReview.reason}`
      : "",
    ...Object.entries(snapshot.collectedData)
      .filter(
        ([key]) =>
          !key.startsWith("_") &&
          !(snapshot.targetFunnel && key.trim().toLowerCase() === "setor / funil de destino"),
      )
      .map(
        ([key, field]) =>
          `${key}: ${field.status === "filled" ? field.value : `Pendente${field.value ? ` — ${field.value}` : ""}`}`,
      ),
  ]
    .filter((line) => line !== "")
    .join("\n");
  return {
    version: 1 as const,
    final: terminal,
    text:
      lines.length > 10_000
        ? `${lines.slice(0, 9800)}\n[Resumo truncado. Consulte os dados completos do ciclo.]`
        : lines,
  };
}
