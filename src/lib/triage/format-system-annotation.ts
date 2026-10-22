export interface SystemAnnotationItem {
  label: string;
  value: string;
  fullWidth?: boolean;
}

export interface FormattedSystemAnnotation {
  /** Título curto e objetivo da ação */
  badgeTitle: string;
  /** Resumo curto para tooltip do ícone discreto (?) */
  tooltipSummary: string;
  /** Se é um evento simples de 1 linha sem campos chave-valor */
  isSingleLine: boolean;
  /** Texto limpo quando isSingleLine = true */
  singleLineText: string;
  /** Lista objetiva e sem redundância de campos relevantes */
  items: SystemAnnotationItem[];
  /** Avisos complementares relevantes (ex: pendências ou revisão necessária) */
  alerts: string[];
}

const IGNORED_EXACT_LINES = new Set([
  "briefing final da triagem",
  "resumo da triagem em andamento",
  "dados ainda sem revisão humana registrada.",
  "dados ainda sem revisão humana registrada",
  "dados registrados (não comprovam validação cadastral ou titularidade):",
  "dados registrados (não comprovam validação cadastral ou titularidade)",
  "sem responsável comprovado por recibo neste ciclo.",
  "sem responsável comprovado por recibo neste ciclo",
  "este resumo não comprova criação de negociação.",
  "este resumo não comprova criação de negociação",
  "consulta de loja não confirma compra ou qualificação comercial.",
  "consulta de loja não confirma compra ou qualificação comercial",
  "navegação e consulta de produto não confirmam compra ou adequação técnica.",
  "navegação e consulta de produto não confirmam compra ou adequação técnica",
  "origem do site (declarada pelo navegador):",
  "origem do site (declarada pelo navegador)",
]);

const FIELD_LABEL_MAP: Record<string, { canonicalKey: string; label: string; order: number }> = {
  "destino": { canonicalKey: "destino", label: "Destino", order: 1 },
  "destino registrado": { canonicalKey: "destino", label: "Destino", order: 1 },
  "setor / funil de destino": { canonicalKey: "destino", label: "Destino", order: 1 },
  "funil de destino": { canonicalKey: "destino", label: "Destino", order: 1 },
  "responsável no encaminhamento": { canonicalKey: "responsavel", label: "Responsável", order: 2 },
  "responsável": { canonicalKey: "responsavel", label: "Responsável", order: 2 },
  "nome completo": { canonicalKey: "cliente", label: "Cliente", order: 3 },
  "nome": { canonicalKey: "cliente", label: "Cliente", order: 3 },
  "cliente": { canonicalKey: "cliente", label: "Cliente", order: 3 },
  "cnpj ou cpf": { canonicalKey: "documento", label: "CPF / CNPJ", order: 4 },
  "cpf/cnpj": { canonicalKey: "documento", label: "CPF / CNPJ", order: 4 },
  "cpf ou cnpj": { canonicalKey: "documento", label: "CPF / CNPJ", order: 4 },
  "cnpj": { canonicalKey: "documento", label: "CNPJ", order: 4 },
  "cpf": { canonicalKey: "documento", label: "CPF", order: 4 },
  "empresa": { canonicalKey: "empresa", label: "Empresa", order: 5 },
  "razão social": { canonicalKey: "empresa", label: "Empresa", order: 5 },
  "máquina / peça / interesse": { canonicalKey: "interesse", label: "Interesse", order: 6 },
  "máquina ou peça de interesse": { canonicalKey: "interesse", label: "Interesse", order: 6 },
  "interesse": { canonicalKey: "interesse", label: "Interesse", order: 6 },
  "solicitação": { canonicalKey: "interesse", label: "Solicitação", order: 6 },
  "aplicação / produto": { canonicalKey: "aplicacao", label: "Aplicação", order: 7 },
  "aplicação": { canonicalKey: "aplicacao", label: "Aplicação", order: 7 },
  "produto a embalar": { canonicalKey: "aplicacao", label: "Aplicação", order: 7 },
  "volume / produção": { canonicalKey: "producao", label: "Produção", order: 8 },
  "produção": { canonicalKey: "producao", label: "Produção", order: 8 },
  "cidade / uf": { canonicalKey: "localidade", label: "Localidade", order: 9 },
  "uf": { canonicalKey: "localidade", label: "UF", order: 9 },
  "estado": { canonicalKey: "localidade", label: "Estado", order: 9 },
  "produto consultado na loja": { canonicalKey: "vtex_produto", label: "Produto na Loja", order: 10 },
  "sku consultado": { canonicalKey: "vtex_sku", label: "SKU", order: 11 },
  "última consulta explícita de produto": { canonicalKey: "site_produto", label: "Produto no Site", order: 12 },
  "campanha de entrada": { canonicalKey: "campanha", label: "Campanha", order: 13 },
  "revisão humana": { canonicalKey: "revisao", label: "Revisão Humana", order: 14 },
  "motivo": { canonicalKey: "motivo_revisao", label: "Motivo da Revisão", order: 15 },
};

function formatDocumentValue(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  // Apenas formata se a string original era composta essencialmente pelo documento numérico
  if (digits.length === 11 && /^[\d.\-\s]+$/.test(raw.trim())) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
  }
  if (digits.length === 14 && /^[\d./\-\s]+$/.test(raw.trim())) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
  }
  return raw.trim();
}

function extractTimeShort(rawDateStr: string): string | null {
  const match = rawDateStr.match(/(\d{2}:\d{2})(?::\d{2})?/);
  return match ? match[1] : null;
}

function toTitleCaseLabel(rawKey: string): string {
  const clean = rawKey.trim().toLowerCase();
  if (!clean) return rawKey;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Converte textos brutos de anotações do sistema / triagem em uma estrutura
 * limpa, objetiva e sem redundâncias para exibição recolhida (?) ou expandida.
 */
export function formatSystemAnnotation(rawText: string): FormattedSystemAnnotation {
  const trimmed = (rawText || "").trim();
  if (!trimmed) {
    return {
      badgeTitle: "Registro do Sistema",
      tooltipSummary: "Registro do sistema",
      isSingleLine: true,
      singleLineText: "",
      items: [],
      alerts: [],
    };
  }

  const rawLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const firstLineLower = (rawLines[0] || "").toLowerCase();

  // Eventos simples de 1 linha (ex: "Novo ciclo de triagem iniciado", "Atendimento capturado por...")
  if (rawLines.length === 1 && !firstLineLower.includes("resumo legado preservado")) {
    let badgeTitle = "Registro do Sistema";
    if (firstLineLower.includes("novo ciclo de triagem")) {
      badgeTitle = "Novo Ciclo de Triagem";
    } else if (firstLineLower.includes("transferid")) {
      badgeTitle = "Atendimento Transferido";
    } else if (firstLineLower.includes("capturad") || firstLineLower.includes("iniciad")) {
      badgeTitle = "Atendimento Iniciado";
    } else if (firstLineLower.includes("finalizad") || firstLineLower.includes("encerrad")) {
      badgeTitle = "Atendimento Encerrado";
    } else if (firstLineLower.includes("continuidade")) {
      badgeTitle = "Continuidade no WhatsApp";
    }

    return {
      badgeTitle,
      tooltipSummary: rawLines[0],
      isSingleLine: true,
      singleLineText: rawLines[0],
      items: [],
      alerts: [],
    };
  }

  // Identificar o título principal da ação
  let badgeTitle = "Relatório da Triagem";
  let isCollectionOnly = false;
  let isLegacySummary = false;

  if (firstLineLower.startsWith("coleta atualizada")) {
    badgeTitle = "Coleta da Triagem";
    isCollectionOnly = true;
  } else if (firstLineLower.startsWith("situação do encaminhamento atualizada")) {
    badgeTitle = "Encaminhamento Concluído";
  } else if (firstLineLower.startsWith("ciclo de triagem arquivado")) {
    badgeTitle = "Ciclo de Triagem Arquivado";
  } else if (firstLineLower.startsWith("resumo legado preservado")) {
    badgeTitle = "Ciclo Anterior Preservado";
    isLegacySummary = true;
  } else if (firstLineLower.startsWith("dados revisados por operador")) {
    badgeTitle = "Revisão Humana da Triagem";
  } else if (firstLineLower.startsWith("triagem interrompida pelo operador")) {
    badgeTitle = "Triagem Interrompida";
  } else if (firstLineLower.startsWith("continuidade entre canais registrada")) {
    badgeTitle = "Continuidade entre Canais";
  } else if (firstLineLower.startsWith("situação do ciclo atualizada")) {
    badgeTitle = "Status da Triagem";
  } else if (firstLineLower.startsWith("briefing final da triagem")) {
    badgeTitle = "Resumo Final da Triagem";
  } else if (firstLineLower.startsWith("resumo da triagem em andamento")) {
    badgeTitle = "Triagem em Andamento";
  }

  const collectedMap = new Map<
    string,
    { label: string; value: string; order: number; fullWidth?: boolean }
  >();
  const alerts: string[] = [];
  let startTimeShort: string | null = null;
  let endTimeShort: string | null = null;
  let cycleStatus: string | null = null;
  let nonDestFieldsCount = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const lower = line.toLowerCase();

    // Ignorar primeira linha se for o cabeçalho da ação já mapeado
    if (
      i === 0 &&
      (lower.startsWith("coleta atualizada") ||
        lower.startsWith("situação do encaminhamento atualizada") ||
        lower.startsWith("ciclo de triagem arquivado") ||
        lower.startsWith("resumo legado preservado") ||
        lower.startsWith("dados revisados por operador") ||
        lower.startsWith("triagem interrompida pelo operador") ||
        lower.startsWith("continuidade entre canais registrada") ||
        lower.startsWith("situação do ciclo atualizada"))
    ) {
      continue;
    }

    if (IGNORED_EXACT_LINES.has(lower)) {
      continue;
    }

    // Avisos importantes sem chave-valor
    if (lower.startsWith("revisão humana necessária") || lower.startsWith("revisão especializada necessária")) {
      if (!alerts.includes("Revisão humana recomendada")) {
        alerts.push("Revisão humana recomendada");
      }
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }

    const rawKey = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    const keyLower = rawKey.toLowerCase();

    if (!rawVal || rawVal.toLowerCase() === "não definido" || rawVal.toLowerCase() === "ainda não definido") {
      continue;
    }

    // Ignorar códigos internos e IDs técnicos redundantes
    if (
      keyLower === "subfluxo" ||
      keyLower === "negociação vinculada no encaminhamento" ||
      keyLower === "consulta vtex" ||
      keyLower === "página de entrada" ||
      keyLower === "página no atendimento" ||
      keyLower === "referência de origem" ||
      keyLower === "decisão de catálogo"
    ) {
      continue;
    }

    if (keyLower === "início") {
      startTimeShort = extractTimeShort(rawVal);
      continue;
    }
    if (keyLower === "registro do ciclo") {
      endTimeShort = extractTimeShort(rawVal);
      continue;
    }

    if (keyLower === "situação do ciclo") {
      cycleStatus = rawVal;
      if (rawVal.toLowerCase().includes("sem resposta") && badgeTitle === "Status da Triagem") {
        badgeTitle = "Encerrado · Sem Resposta";
      } else if (rawVal.toLowerCase().includes("interrompid") && badgeTitle === "Status da Triagem") {
        badgeTitle = "Triagem Interrompida";
      }
      continue;
    }

    if (keyLower === "dados pendentes") {
      alerts.push(`Pendente: ${rawVal}`);
      continue;
    }

    const mapped = FIELD_LABEL_MAP[keyLower] || {
      canonicalKey: keyLower,
      label: toTitleCaseLabel(rawKey),
      order: 20,
    };

    let cleanValue = rawVal;
    if (mapped.canonicalKey === "documento") {
      cleanValue = formatDocumentValue(rawVal);
    } else if (mapped.canonicalKey === "revisao") {
      // Remove "(Brasília)" verboso da linha de revisão
      cleanValue = rawVal.replace(/\s*\(Brasília\)/gi, "");
    }

    if (mapped.canonicalKey !== "destino") {
      nonDestFieldsCount++;
    }

    // Se já existe e o novo valor for "Pendente", não sobrescreve um valor preenchido
    const existing = collectedMap.get(mapped.canonicalKey);
    if (existing && cleanValue.toLowerCase().startsWith("pendente")) {
      continue;
    }

    collectedMap.set(mapped.canonicalKey, {
      label: mapped.label,
      value: cleanValue,
      order: mapped.order,
      fullWidth: cleanValue.length > 34 || mapped.canonicalKey === "revisao" || mapped.canonicalKey === "interesse",
    });
  }

  // Em notas de "Coleta da Triagem", se houve coleta de outro campo (ex: Nome, CPF),
  // e "Destino" foi apenas anexado automaticamente ao final, mantemos foco no dado coletado
  if (isCollectionOnly && nonDestFieldsCount > 0 && collectedMap.has("destino")) {
    // Só mantém Destino na coleta se o único campo alterado na rodada tiver sido o próprio destino
    const hadExplicitSectorField = rawLines.some((l) =>
      l.toLowerCase().startsWith("setor / funil de destino:")
    );
    if (!hadExplicitSectorField) {
      collectedMap.delete("destino");
    }
  }

  // Se o ciclo terminou sem resposta ou interrompido e não tem responsável, exibe a situação de forma objetiva
  if (
    cycleStatus &&
    !collectedMap.has("responsavel") &&
    !cycleStatus.toLowerCase().includes("encaminhamento registrado") &&
    !cycleStatus.toLowerCase().includes("coleta em andamento")
  ) {
    collectedMap.set("status_ciclo", {
      label: "Status",
      value: cycleStatus,
      order: 0,
    });
  }

  // Em resumo legado, deixar o rótulo claro
  if (isLegacySummary && collectedMap.has("destino")) {
    const dest = collectedMap.get("destino")!;
    collectedMap.set("destino", {
      ...dest,
      label: "Destino anterior",
    });
  }

  // Se houver horário de início e fim diferentes em um encerramento/arquivamento, adiciona duração enxuta
  if (!isCollectionOnly && startTimeShort && endTimeShort && startTimeShort !== endTimeShort) {
    collectedMap.set("periodo", {
      label: "Período",
      value: `${startTimeShort} às ${endTimeShort}`,
      order: 30,
    });
  }

  const items = Array.from(collectedMap.values())
    .sort((a, b) => a.order - b.order)
    .map(({ label, value, fullWidth }) => ({ label, value, fullWidth }));

  // Caso seja uma nota sem nenhum item extraído, trata como linha única
  if (items.length === 0 && alerts.length === 0) {
    return {
      badgeTitle,
      tooltipSummary: badgeTitle,
      isSingleLine: true,
      singleLineText: badgeTitle,
      items: [],
      alerts: [],
    };
  }

  const summaryParts = items.slice(0, 2).map((it) => `${it.label}: ${it.value}`);
  const tooltipSummary =
    summaryParts.length > 0 ? `${badgeTitle} · ${summaryParts.join(" | ")}` : badgeTitle;

  return {
    badgeTitle,
    tooltipSummary,
    isSingleLine: false,
    singleLineText: `${badgeTitle} — ${summaryParts.join(" · ")}`,
    items,
    alerts,
  };
}
