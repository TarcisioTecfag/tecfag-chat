// Compatibilidade do classificador anterior usado pela operação existente.
// A política industrial nova não altera esta projeção para outros perfis.

export type TecfagKanbanStageId =
  | "triagem"
  | "assistencia_tecnica"
  | "pos_venda"
  | "maquinas"
  | "personalite"
  | "financeiro"
  | "pecas"
  | "outros"
  | "sem_resposta";

export type TecfagFlowFunnelName =
  | "Máquinas"
  | "Personnalité"
  | "Peças"
  | "Assistência Técnica"
  | "Pós-Venda Rastreio"
  | "Pós-Venda - NF do Pedido"
  | "Pós-Venda Geral"
  | "Fin. Boleto"
  | "Fin. Nota Fiscal";

/**
 * Resolve de forma determinística a coluna do Kanban SDR (9 colunas) e o sub-funil
 * da aba Fluxos (9 sub-funis) a partir da resposta da IA e dos dados coletados.
 */
export function resolveLegacySdrStageAndFunnel(params: {
  aiFunnelStage?: string | null;
  aiTargetFunnel?: string | null;
  collectedData: Record<string, { value?: string; status?: string }>;
  existingStage?: string | null;
  existingFunnel?: string | null;
}): { funnelStage: TecfagKanbanStageId; targetFunnel: TecfagFlowFunnelName } {
  const rawSector =
    params.aiTargetFunnel ||
    params.collectedData["SETOR / FUNIL DE DESTINO"]?.value ||
    params.collectedData["SETOR"]?.value ||
    params.existingFunnel ||
    "";

  const rawInterest =
    params.collectedData["MÁQUINA / PEÇA / INTERESSE"]?.value ||
    params.collectedData["QUAL O TIPO DE PRODUTO?"]?.value ||
    params.collectedData["PRODUTO DE INTERESSE"]?.value ||
    "";

  const combined = `${params.aiFunnelStage || ""} ${rawSector} ${rawInterest}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // 1. Personnalité (Regra Soberana)
  if (
    combined.includes("personalit") ||
    combined.includes("personnalit") ||
    combined.includes("personalizad")
  ) {
    return { funnelStage: "personalite", targetFunnel: "Personnalité" };
  }

  // 2. Assistência Técnica
  if (
    combined.includes("assistencia") ||
    combined.includes("manutencao") ||
    combined.includes("conserto") ||
    combined.includes("defeito") ||
    combined.includes("garantia") ||
    combined.includes("suporte tecnico")
  ) {
    return { funnelStage: "assistencia_tecnica", targetFunnel: "Assistência Técnica" };
  }

  // 3. Financeiro (Boleto vs Nota Fiscal)
  if (
    combined.includes("financeiro") ||
    combined.includes("boleto") ||
    combined.includes("fatura") ||
    combined.includes("pagamento") ||
    combined.includes("2a via")
  ) {
    if (
      combined.includes("nota") ||
      combined.includes("nf") ||
      combined.includes("xml") ||
      combined.includes("danfe")
    ) {
      return { funnelStage: "financeiro", targetFunnel: "Fin. Nota Fiscal" };
    }
    return { funnelStage: "financeiro", targetFunnel: "Fin. Boleto" };
  }

  // 4. Pós-Venda (Rastreio / NF do Pedido / Geral)
  if (
    combined.includes("pos-venda") ||
    combined.includes("pos venda") ||
    combined.includes("pos_venda") ||
    combined.includes("rastreio") ||
    combined.includes("rastreamento") ||
    combined.includes("entrega") ||
    combined.includes("transportadora") ||
    combined.includes("nf do pedido")
  ) {
    if (
      combined.includes("rastreio") ||
      combined.includes("rastreamento") ||
      combined.includes("transportadora") ||
      combined.includes("entrega")
    ) {
      return { funnelStage: "pos_venda", targetFunnel: "Pós-Venda Rastreio" };
    }
    if (combined.includes("nf") || combined.includes("nota")) {
      return { funnelStage: "pos_venda", targetFunnel: "Pós-Venda - NF do Pedido" };
    }
    return { funnelStage: "pos_venda", targetFunnel: "Pós-Venda Geral" };
  }

  // 5. Peças de Reposição
  if (
    combined.includes("peca") ||
    combined.includes("reposicao") ||
    combined.includes("resistencia") ||
    combined.includes("teflon") ||
    combined.includes("correia") ||
    combined.includes("sensor") ||
    combined.includes("clp")
  ) {
    return { funnelStage: "pecas", targetFunnel: "Peças" };
  }

  // 6. Máquinas Industriais
  if (
    combined.includes("maquina") ||
    combined.includes("seladora") ||
    combined.includes("envasadora") ||
    combined.includes("empacotadora") ||
    combined.includes("datador") ||
    combined.includes("dosadora") ||
    combined.includes("encapsuladora") ||
    combined.includes("rotuladora") ||
    combined.includes("tunel") ||
    combined.includes("embaladora")
  ) {
    return { funnelStage: "maquinas", targetFunnel: "Máquinas" };
  }

  // 7. Outros
  if (
    params.aiFunnelStage === "outros" ||
    combined.includes("fornecedor") ||
    combined.includes("curriculo") ||
    combined.includes("parceria")
  ) {
    return { funnelStage: "outros", targetFunnel: "Máquinas" };
  }

  // 8. Sem resposta
  if (params.aiFunnelStage === "sem_resposta") {
    return { funnelStage: "sem_resposta", targetFunnel: "Máquinas" };
  }

  // Default inicial enquanto ainda está descobrindo a demanda
  return {
    funnelStage: (params.existingStage as TecfagKanbanStageId) || "triagem",
    targetFunnel: (params.existingFunnel as TecfagFlowFunnelName) || "Máquinas",
  };
}
