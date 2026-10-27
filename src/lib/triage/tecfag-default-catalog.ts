import defaultCatalogData from "./tecfag-default-catalog.json";
import {
  DESTINATION_KEYS,
  INDUSTRIAL_DESTINATIONS,
  resolveIndustrialDestination,
  setIndustrialDestination,
  type IndustrialDestinationKey,
  type IndustrialMachine,
  type IndustrialSettings,
} from "./industrial-settings";

export interface IndustrialChoices {
  sectors: { id: string; name: string }[];
  pipelines: { id: string; name: string }[];
  stages: { id: string; name: string; pipelineId: string }[];
}

export const TECFAG_DEFAULT_CATALOG: IndustrialMachine[] =
  defaultCatalogData as IndustrialMachine[];

export function getDefaultIndustrialCatalog(): IndustrialMachine[] {
  return TECFAG_DEFAULT_CATALOG.map((item) => ({
    ...item,
    aliases: [...(item.aliases || [])],
  }));
}

function norm(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export const MACHINE_CATEGORY_OPTIONS = [
  { value: "ALL", label: "Todas as Categorias" },
  { value: "Seladoras", label: "Seladoras" },
  { value: "Empacotadoras & Flow Pack", label: "Empacotadoras & Flow Pack" },
  { value: "Envasadoras & Dosadoras", label: "Envasadoras & Dosadoras" },
  { value: "Rotuladoras", label: "Rotuladoras" },
  { value: "Datadores & Codificadores", label: "Datadores & Codificadores" },
  { value: "Arqueadoras & Cintadoras", label: "Arqueadoras & Cintadoras" },
  { value: "Encapsuladoras & Contadoras", label: "Encapsuladoras & Contadoras" },
  { value: "Termoformadoras & Blister", label: "Termoformadoras & Blister" },
  { value: "Rosqueadeiras & Tampadoras", label: "Rosqueadeiras & Tampadoras" },
  { value: "Túneis & Encolhimento", label: "Túneis & Encolhimento" },
  { value: "Encaixotadoras & Fechadoras", label: "Encaixotadoras & Fechadoras" },
  { value: "Outros Equipamentos", label: "Outros Equipamentos" },
] as const;

export function inferMachineCategory(machine: IndustrialMachine): string {
  const n = norm(`${machine.name} ${machine.code}`);
  if (/\b(seladora|selar|selagem)\b/.test(n) || n.includes("pamqsl")) {
    return "Seladoras";
  }
  if (
    /\b(empacotadora|flow\s*pack|enfardadeira|embaladora)\b/.test(n) ||
    n.includes("pamqfp") ||
    n.includes("pamqgp")
  ) {
    return "Empacotadoras & Flow Pack";
  }
  if (
    /\b(envasadora|dosadora|enchedora|envase|dosador)\b/.test(n) ||
    n.includes("pamqev") ||
    n.includes("pamqds")
  ) {
    return "Envasadoras & Dosadoras";
  }
  if (/\b(rotuladora|rotulador|rotulagem)\b/.test(n) || n.includes("pamqrt")) {
    return "Rotuladoras";
  }
  if (/\b(datador|datadora|codificador|inkjet|laser)\b/.test(n) || n.includes("pamqdt")) {
    return "Datadores & Codificadores";
  }
  if (/\b(arqueadora|arquear|cintar|cintadora)\b/.test(n) || n.includes("pamqar")) {
    return "Arqueadoras & Cintadoras";
  }
  if (/\b(encapsuladora|contadora|drageadeira|blister)\b/.test(n)) {
    return "Encapsuladoras & Contadoras";
  }
  if (/\b(termoformadora|skin|vacuum\s*forming)\b/.test(n)) {
    return "Termoformadoras & Blister";
  }
  if (/\b(rosqueadeira|tampadora|recravadeira)\b/.test(n)) {
    return "Rosqueadeiras & Tampadoras";
  }
  if (/\b(tunel|encolhimento| Valvula|strech|stretch|envolvedora)\b/i.test(n)) {
    return "Túneis & Encolhimento";
  }
  if (/\b(encaixotadora|armadora|fechadora\s*de\s*caixa|paletizadora)\b/.test(n)) {
    return "Encaixotadoras & Fechadoras";
  }
  return "Outros Equipamentos";
}

export const DESTINATION_DETAILS: Record<
  IndustrialDestinationKey,
  {
    title: string;
    subtitle: string;
    whenTriggered: string;
    flowBadge: string;
    fluxosFolderName: string;
    sectorKeywords: string[];
    pipelineKeywords: string[];
  }
> = {
  MAQUINAS: {
    title: "Máquinas (Linha Semi-Industrial)",
    subtitle: "Demandas comerciais de equipamentos Semi-Industriais confirmados no catálogo",
    whenTriggered:
      "Acionado quando o Decisor IA confirma um equipamento ativo da linha Semi-Industrial com confiança ≥ 95% e capacidade compatível.",
    flowBadge: "Fluxo 1 • Comercial",
    fluxosFolderName: "Pasta Máquinas",
    sectorKeywords: ["comercial", "maquina", "vendas", "tecfag"],
    pipelineKeywords: ["funil maquinas", "maquinas", "semi"],
  },
  PERSONNALITE: {
    title: "Personnalité (Projetos Industriais)",
    subtitle: "Equipamentos industriais de alta capacidade e linhas completas Personnalité",
    whenTriggered:
      "Acionado quando o Decisor IA confirma um equipamento ativo da linha Personnalité com confiança ≥ 95% e capacidade compatível.",
    flowBadge: "Fluxo 1 • Industrial",
    fluxosFolderName: "Pasta Personnalité",
    sectorKeywords: ["personnalite", "personalite", "comercial", "projetos", "tecfag"],
    pipelineKeywords: ["personnalite", "personalite", "projetos"],
  },
  PECAS: {
    title: "Peças & Insumos de Reposição",
    subtitle: "Solicitações de peças, componentes, bobinas, teflon e resistência",
    whenTriggered:
      "Acionado quando o cliente solicita compra de peças de reposição ou componentes avulsos para equipamentos.",
    flowBadge: "Fluxo 1 • Peças",
    fluxosFolderName: "Pasta Peças",
    sectorKeywords: ["pecas", "comercial", "pos-venda", "assistencia", "tecfag"],
    pipelineKeywords: ["pecas", "insumos"],
  },
  FINANCEIRO: {
    title: "Financeiro (Boleto, NF e Cobrança)",
    subtitle: "2ª via de boleto, XML/Nota Fiscal financeira, renegociação e comprovantes",
    whenTriggered:
      "Unifica os assuntos 2A (Boleto), 2B (Nota Fiscal) e 2C (Outros assuntos financeiros) na Pasta Financeiro da escala de Fluxos.",
    flowBadge: "Fluxo 2 • Financeiro",
    fluxosFolderName: "Pasta Financeiro",
    sectorKeywords: ["financeiro", "cobranca", "faturamento", "administrativo", "comercial"],
    pipelineKeywords: ["financeiro", "cobranca"],
  },
  "3_AT": {
    title: "Assistência Técnica & Suporte",
    subtitle: "Manutenção, conserto, garantia, dúvidas técnicas e regulagem de máquina",
    whenTriggered:
      "Acionado quando o cliente relata defeito técnico, precisa de suporte operacional ou manutenção de máquina já adquirida.",
    flowBadge: "Fluxo 3 • Suporte Técnico",
    fluxosFolderName: "Pasta Assistência Técnica",
    sectorKeywords: ["assistencia", "tecnica", "suporte", "manutencao", "pos-venda", "comercial"],
    pipelineKeywords: ["assistencia", "suporte", "tecnica", "pos-venda", "pos venda"],
  },
  POS_VENDA: {
    title: "Pós-Venda (Rastreio, Entrega e Pedidos)",
    subtitle: "Status de entrega, rastreio de transportadora, NF de pedido e trocas",
    whenTriggered:
      "Unifica os assuntos 4A (Rastrear Pedido), 4B (NF do Pedido) e Pós-Venda geral na Pasta Pós-Venda da escala de Fluxos.",
    flowBadge: "Fluxo 4 • Pós-Venda",
    fluxosFolderName: "Pasta Pós-Venda",
    sectorKeywords: ["pos-venda", "pos venda", "logistica", "atendimento", "suporte", "comercial"],
    pipelineKeywords: ["pos-venda", "pos venda", "suporte", "entrega"],
  },
  REVIEW: {
    title: "Análise e Revisão Humana (Especialista SDR)",
    subtitle: "Triagens em análise quando o Fagner não teve certeza do destino ou que exigem validação humana",
    whenTriggered:
      "Acionado quando o Fagner não tem certeza da classificação, em casos de licitação/revenda, capital social ≥ R$ 350 mil em equipamento Semi-Industrial, máquina não comercializada, capacidade acima do catálogo ou quando o cliente pede atendente humano. Abre o card no Funil e Etapa configurados abaixo (ex: Funil SDR).",
    flowBadge: "Fluxo 5 • Revisão Humana",
    fluxosFolderName: "Pasta Análise e revisão humana",
    sectorKeywords: ["comercial", "sdr", "recepcao", "triagem", "atendimento", "tecfag"],
    pipelineKeywords: ["funil sdr", "sdr", "triagem", "analise", "revisao"],
  },
};

export function resolveAutomaticSectorId(
  key: IndustrialDestinationKey,
  sectors: { id: string; name: string }[],
  existingSectorId?: string,
): string {
  if (existingSectorId && sectors.some((s) => s.id === existingSectorId)) {
    return existingSectorId;
  }
  const meta = DESTINATION_DETAILS[key];
  const matched = sectors.find((s) => {
    const sNorm = norm(s.name);
    return meta.sectorKeywords.some((kw) => sNorm.includes(norm(kw)));
  });
  return matched?.id || sectors[0]?.id || existingSectorId || "";
}

export function autoMatchIndustrialDestinations(
  choices: IndustrialChoices,
  currentSettings: IndustrialSettings,
  overwriteExisting = false,
): IndustrialSettings {
  if (!choices.sectors.length) return currentSettings;

  let next = { ...currentSettings };

  for (const key of DESTINATION_KEYS) {
    const existing = resolveIndustrialDestination(next, key);
    const hasPipeline = Boolean(existing.destination?.pipelineId && existing.destination?.stageId);
    if (!overwriteExisting && existing.configured && !existing.conflict && existing.destination?.sectorId && hasPipeline) {
      continue;
    }

    const meta = DESTINATION_DETAILS[key];
    const policy = INDUSTRIAL_DESTINATIONS[key];

    const matchedSectorId = resolveAutomaticSectorId(key, choices.sectors, existing.destination?.sectorId);
    if (!matchedSectorId) continue;

    // 2. Encontrar melhor funil CRM
    let matchedPipeline = choices.pipelines.find((p) => {
      const pNorm = norm(p.name);
      return meta.pipelineKeywords.some((kw) => pNorm.includes(norm(kw)));
    });
    if (!matchedPipeline && choices.pipelines.length > 0) {
      matchedPipeline = choices.pipelines[0];
    }

    if (!matchedPipeline) {
      if (!policy.createsDeal) {
        next = setIndustrialDestination(next, key, {
          sectorId: matchedSectorId,
        });
      }
      continue;
    }

    // 3. Encontrar melhor etapa de entrada daquele funil
    const stagesForPipeline = choices.stages.filter((st) => st.pipelineId === matchedPipeline!.id);
    let matchedStage = stagesForPipeline.find((st) => {
      const stNorm = norm(st.name);
      if (key === "REVIEW") {
        return (
          stNorm.includes("analise") ||
          stNorm.includes("revisao") ||
          stNorm.includes("triagem") ||
          stNorm.includes("leads recebidos") ||
          stNorm.includes("recebido")
        );
      }
      return (
        stNorm.includes("leads recebidos") ||
        stNorm.includes("recebido") ||
        stNorm.includes("triagem") ||
        stNorm.includes("entrada") ||
        stNorm.includes("novo")
      );
    });
    if (!matchedStage && stagesForPipeline.length > 0) {
      matchedStage = stagesForPipeline[0];
    }

    if (matchedStage) {
      next = setIndustrialDestination(next, key, {
        sectorId: matchedSectorId,
        pipelineId: matchedPipeline.id,
        stageId: matchedStage.id,
      });
    } else if (!policy.createsDeal) {
      next = setIndustrialDestination(next, key, {
        sectorId: matchedSectorId,
      });
    }
  }

  return next;
}
