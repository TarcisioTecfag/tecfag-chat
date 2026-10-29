// ══════════════════════════════════════════════════════════════════════════════
// 🏢 CONFIGURAÇÃO DO COPILOTO (FAGNER / VALENTINA) POR SETOR
// Define a mensagem de boas-vindas inicial e as sugestões de perguntas rápidas
// personalizadas para cada setor da operação (pré-configuradas por padrão e
// editáveis por qualquer administrador na aba Setores Ativos).
// ══════════════════════════════════════════════════════════════════════════════

import { getAiPersona } from "../ai-persona";

export interface SectorCopilotPreset {
  key: string;
  label: string;
  welcomeMessage: string;
  suggestions: string[];
}

function normalizeSectorKey(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Presets inteligentes pré-configurados para todos os setores ativos da operação.
 * Suporta variáveis dinâmicas na mensagem inicial:
 * - {{saudacao}} -> "Bom dia" | "Boa tarde" | "Boa noite"
 * - {{nome}} / {{operador}} -> Nome do operador logado
 * - {{ia}} -> Nome da persona de IA do tenant ("Fagner" ou "Valentina")
 * - {{setor}} -> Nome do setor
 */
export const SECTOR_COPILOT_PRESETS: Record<string, SectorCopilotPreset> = {
  projetos: {
    key: "projetos",
    label: "Projetos",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto do setor de Projetos. Acompanho o andamento das suas negociações de linhas industriais, especificações técnicas nos manuais, tarefas agendadas e clientes aguardando retorno. Como posso te apoiar agora?",
    suggestions: [
      "Quais projetos e negociações minhas estão em andamento ou parados?",
      "Quais clientes de projetos estão aguardando minha resposta agora?",
      "Quais são minhas tarefas e reuniões de projetos agendadas para hoje?",
      "Consultar especificações técnicas ou manual de um equipamento para projeto",
    ],
  },
  suporte_tecnico: {
    key: "suporte_tecnico",
    label: "Suporte Técnico",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto de Suporte e Assistência Técnica. Consulto manuais técnicos em PDF, regulagens, esquemas elétricos/pneumáticos, fila de chamados aguardando retorno e tarefas técnicas do dia. Como posso te ajudar agora?",
    suggestions: [
      "Quais clientes estão aguardando suporte técnico na minha fila agora?",
      "Quais são minhas tarefas e atendimentos técnicos agendados para hoje?",
      "Consultar manual técnico, regulagem ou código de peça de uma máquina",
      "Avalie meu último atendimento técnico e sugira próximos passos",
    ],
  },
  financeiro: {
    key: "financeiro",
    label: "Financeiro",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto do setor Financeiro. Acompanho os atendimentos de boletos, 2ª via de Nota Fiscal, cobranças, tarefas do dia e clientes aguardando retorno na sua fila. Como posso te ajudar agora?",
    suggestions: [
      "Quais clientes estão aguardando retorno financeiro ou 2ª via de NF agora?",
      "Quais são minhas tarefas e compromissos financeiros agendados para hoje?",
      "Localizar CNPJ, cadastro ou histórico de atendimento de um cliente",
      "Como estão minhas métricas de atendimento e tempo de resposta hoje?",
    ],
  },
  comercial: {
    key: "comercial",
    label: "Comercial Tecfag",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto comercial. Acompanho suas metas, tarefas, ligações agendadas, negociações paradas, catálogo de máquinas e te aviso sempre que um cliente for transferido ou passar do SLA. Como posso te ajudar agora?",
    suggestions: [
      "Como está minha meta do mês e meu ritmo hoje?",
      "Quais são minhas tarefas e ligações agendadas para hoje?",
      "Quais negociações minhas estão paradas ou esfriando?",
      "Quais clientes estão aguardando minha resposta agora?",
    ],
  },
  administradores: {
    key: "administradores",
    label: "Administradores",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto executivo e operacional. Acompanho indicadores de atendimento, SLA, funis do CRM, metas da equipe, tarefas do dia e especificações técnicas do catálogo. O que vamos analisar agora?",
    suggestions: [
      "Quais clientes estão aguardando resposta na fila de atendimento agora?",
      "Como estão minhas negociações, metas e prioridades da operação hoje?",
      "Quais são minhas tarefas e compromissos agendados para hoje?",
      "Como estão minhas métricas de atendimento e SLA de hoje?",
    ],
  },
  personnalite: {
    key: "personnalite",
    label: "Personnalité",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto comercial da linha Personnalité. Acompanho sua meta mensal, negociações de alto valor, ligações agendadas, clientes na fila e especificações técnicas das linhas industriais. Como posso te ajudar agora?",
    suggestions: [
      "Como está minha meta do mês e meu ritmo na linha Personnalité?",
      "Quais negociações minhas estão paradas ou precisam de follow-up hoje?",
      "Quais clientes estão aguardando minha resposta agora?",
      "Consultar especificações técnicas e fotos de equipamentos da linha Personnalité",
    ],
  },
  pecas: {
    key: "pecas",
    label: "Peças",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto comercial do setor de Peças e Insumos. Acompanho sua carteira de cotações, clientes aguardando retorno, tarefas de follow-up e consultas técnicas de peças de reposição nos manuais. Como posso te ajudar agora?",
    suggestions: [
      "Quais clientes de peças estão aguardando minha resposta agora?",
      "Quais cotações e negociações de peças estão abertas ou paradas?",
      "Quais são minhas tarefas e ligações agendadas para hoje?",
      "Como está minha meta do mês e meu ritmo de vendas de peças hoje?",
    ],
  },
  sdr: {
    key: "sdr",
    label: "SDR",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto de Triagem e SDR. Auxilio na qualificação rápida de leads, identificação da máquina ou setor ideal, fila de clientes aguardando atendimento e acompanhamento dos cards recém-criados. Como posso te ajudar agora?",
    suggestions: [
      "Quais leads estão aguardando triagem ou resposta na minha fila agora?",
      "Quais atendimentos e leads chegaram para mim hoje?",
      "Me ajude a identificar a máquina ou setor ideal para a demanda de um cliente",
      "Quais são minhas tarefas e retornos pendentes para hoje?",
    ],
  },
  pos_venda: {
    key: "pos_venda",
    label: "Pós-venda",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto de Pós-Venda e Relacionamento. Acompanho seus clientes em atendimento, status de solicitações, histórico de negociações, tarefas de acompanhamento e dúvidas técnicas. Como posso te ajudar agora?",
    suggestions: [
      "Quais clientes de pós-venda estão aguardando minha resposta agora?",
      "Quais são minhas tarefas e acompanhamentos agendados para hoje?",
      "Localizar histórico, contato ou negociação de um cliente para atendimento",
      "Como estão minhas métricas de atendimento e tempo de resposta hoje?",
    ],
  },
  maquinas: {
    key: "maquinas",
    label: "Máquinas",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto comercial do setor de Máquinas. Acompanho sua meta do mês, negociações no funil, ligações agendadas, clientes na fila e especificações técnicas no catálogo e loja VTEX. Como posso te ajudar agora?",
    suggestions: [
      "Como está minha meta do mês e meu ritmo de vendas de máquinas?",
      "Quais negociações de máquinas estão paradas ou esfriando no meu funil?",
      "Quais clientes estão aguardando minha resposta agora?",
      "Quais são minhas tarefas e ligações agendadas para hoje?",
    ],
  },
  recepcao: {
    key: "recepcao",
    label: "Recepção",
    welcomeMessage:
      "Olá! {{saudacao}} {{nome}}, sou seu copiloto da Recepção e Atendimento Inicial. Auxilio na identificação rápida de clientes, consulta de consultores responsáveis por carteira/setor, fila de espera no WhatsApp e recados do dia. Como posso te ajudar agora?",
    suggestions: [
      "Quais clientes estão aguardando atendimento na minha fila agora?",
      "Quem é o consultor responsável ou qual o histórico de um cliente?",
      "Quais são minhas tarefas e recados pendentes para hoje?",
      "Como transferir um atendimento ou localizar um setor no sistema?",
    ],
  },
};

/**
 * Identifica a chave de preset correspondente ao nome de um setor ou grupo de acesso.
 */
export function matchSectorPresetKey(sectorOrGroupName: string | null | undefined): string {
  const norm = normalizeSectorKey(sectorOrGroupName);
  if (!norm) return "comercial";

  if (/\b(?:projeto|projetos|engenharia)\b/.test(norm)) return "projetos";
  if (/\b(?:suporte|assistencia|tecnic[oa]|manutencao)\b/.test(norm)) return "suporte_tecnico";
  if (/\b(?:financeiro|faturamento|cobranca|fiscal|contas|boleto)\b/.test(norm)) return "financeiro";
  if (/\b(?:personnalite|personalite)\b/.test(norm)) return "personnalite";
  if (/\b(?:peca|pecas|insumo|insumos|reposicao)\b/.test(norm)) return "pecas";
  if (/\b(?:sdr|triagem|qualificacao|pre\s*venda)\b/.test(norm)) return "sdr";
  if (/\b(?:pos\s*venda|pos\s*vendas|relacionamento|entrega|rastreio)\b/.test(norm)) return "pos_venda";
  if (/\b(?:maquina|maquinas|equipamento|equipamentos)\b/.test(norm)) return "maquinas";
  if (/\b(?:recepcao|secretaria|portaria|telefonista)\b/.test(norm)) return "recepcao";
  if (/\b(?:admin|administrador|administradores|diretoria|gestao|gerencia)\b/.test(norm)) {
    return "administradores";
  }
  if (/\b(?:comercial|venda|vendas|vendedor|vendedores|consultor)\b/.test(norm)) {
    return "comercial";
  }

  return "comercial";
}

/**
 * Retorna a configuração padrão recomendada para um setor pelo nome.
 */
export function getDefaultSectorCopilotConfig(
  sectorName: string | null | undefined,
  tenantId?: string | null
): { welcomeMessage: string; suggestions: string[] } {
  const key = matchSectorPresetKey(sectorName);
  const preset = SECTOR_COPILOT_PRESETS[key] || SECTOR_COPILOT_PRESETS.comercial;

  // Para o tenant Valem no preset comercial/máquinas, adapta termos de máquinas/VTEX para embalagens/válvulas
  if (tenantId === "valem" && (key === "comercial" || key === "maquinas")) {
    return {
      welcomeMessage:
        "Olá! {{saudacao}} {{nome}}, sou sua copiloto comercial. Acompanho suas metas, tarefas, ligações agendadas, negociações paradas, catálogo de produtos e te aviso sempre que um cliente for transferido ou passar do SLA. Como posso te ajudar agora?",
      suggestions: [...preset.suggestions],
    };
  }

  return {
    welcomeMessage: preset.welcomeMessage,
    suggestions: [...preset.suggestions],
  };
}

/**
 * Resolve a configuração efetiva de um setor (usando o valor customizado salvo no banco
 * ou preenchendo automaticamente com o preset inteligente do setor).
 */
export function resolveSectorCopilotConfig(
  sector:
    | {
        name?: string | null;
        copilotWelcomeMessage?: string | null;
        copilotSuggestions?: string[] | null;
      }
    | null
    | undefined,
  tenantId?: string | null
): { welcomeMessage: string; suggestions: string[] } {
  const defaults = getDefaultSectorCopilotConfig(sector?.name, tenantId);

  const customWelcome =
    typeof sector?.copilotWelcomeMessage === "string" && sector.copilotWelcomeMessage.trim().length > 0
      ? sector.copilotWelcomeMessage.trim()
      : defaults.welcomeMessage;

  const validCustomSuggestions = Array.isArray(sector?.copilotSuggestions)
    ? sector.copilotSuggestions
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
    : [];

  const suggestions =
    validCustomSuggestions.length > 0 ? validCustomSuggestions : defaults.suggestions;

  return {
    welcomeMessage: customWelcome,
    suggestions,
  };
}

export interface SectorLike {
  id: string;
  name: string;
  operatorIds: string[];
  copilotWelcomeMessage?: string | null;
  copilotSuggestions?: string[] | null;
}

/**
 * Determina o setor principal do operador logado para exibir a mensagem inicial e as sugestões
 * do Fagner/Valentina:
 * 1. Filtra os setores onde `operatorIds` inclui o `operatorId`.
 * 2. Se o operador pertence a mais de um setor (ex: "Administradores" + "Projetos"),
 *    prioriza primeiro o setor que bate com seu Grupo de Acesso (`operatorGroupName`),
 *    ou o setor operacional específico (Projetos, Suporte Técnico, Financeiro, Peças,
 *    Personnalité, SDR, Pós-venda, Máquinas, Recepção) antes do setor genérico "Administradores".
 * 3. Se o operador não estiver marcado em nenhum `sector.operatorIds`, faz fallback pelo nome
 *    do seu Grupo de Acesso (`operatorGroupName`).
 */
export function resolveOperatorPrimarySector(params: {
  operatorId?: string | null;
  operatorGroupName?: string | null;
  operatorRole?: string | null;
  sectors?: SectorLike[] | null;
}): SectorLike | null {
  const { operatorId, operatorGroupName, operatorRole, sectors } = params;
  const list = Array.isArray(sectors) ? sectors : [];
  if (list.length === 0) return null;

  const memberSectors = operatorId
    ? list.filter((s) => Array.isArray(s.operatorIds) && s.operatorIds.includes(operatorId))
    : [];

  const groupPresetKey = operatorGroupName ? matchSectorPresetKey(operatorGroupName) : null;

  if (memberSectors.length === 1) {
    return memberSectors[0];
  }

  if (memberSectors.length > 1) {
    // 1º: Se algum dos setores dos quais ele é membro bate com o grupo de acesso dele (e não é só admin genérico quando ele tem outro setor operacional)
    if (groupPresetKey && groupPresetKey !== "administradores") {
      const matchedByGroup = memberSectors.find(
        (s) => matchSectorPresetKey(s.name) === groupPresetKey
      );
      if (matchedByGroup) return matchedByGroup;
    }

    // 2º: Prioriza setores operacionais específicos sobre "Administradores" ou "Comercial Tecfag" genérico
    const specificOperationalOrder = [
      "projetos",
      "suporte_tecnico",
      "financeiro",
      "pos_venda",
      "sdr",
      "pecas",
      "personnalite",
      "maquinas",
      "recepcao",
      "comercial",
      "administradores",
    ];
    for (const key of specificOperationalOrder) {
      const found = memberSectors.find((s) => matchSectorPresetKey(s.name) === key);
      if (found) return found;
    }

    return memberSectors[0];
  }

  // Fallback: Operador ainda não vinculado em `operatorIds`, tenta localizar setor correspondente ao grupo de acesso
  if (groupPresetKey) {
    const matchedSector = list.find((s) => matchSectorPresetKey(s.name) === groupPresetKey);
    if (matchedSector) return matchedSector;
  }

  if (operatorRole === "admin") {
    const adminSector = list.find((s) => matchSectorPresetKey(s.name) === "administradores");
    if (adminSector) return adminSector;
  }

  return null;
}

/**
 * Interpola as variáveis dinâmicas da mensagem inicial do Copiloto.
 */
export function interpolateCopilotWelcomeMessage(
  template: string,
  params: {
    greeting?: string;
    operatorName: string;
    aiName: string;
    sectorName?: string | null;
    nowDate?: Date;
  }
): string {
  const { operatorName, aiName, sectorName, nowDate = new Date() } = params;
  const resolvedGreeting =
    params.greeting ||
    (() => {
      const brtHourStr = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "numeric",
        hour12: false,
      }).format(nowDate);
      const hour = parseInt(brtHourStr, 10);
      return hour >= 5 && hour < 12
        ? "Bom dia"
        : hour >= 12 && hour < 18
        ? "Boa tarde"
        : "Boa noite";
    })();
  const cleanName =
    operatorName && operatorName.trim() && operatorName.trim() !== "Operador"
      ? operatorName.trim()
      : "consultor";
  const cleanSector = sectorName?.trim() || "seu setor";

  return (template || "")
    .replace(/\{\{\s*saudacao\s*\}\}/gi, resolvedGreeting)
    .replace(/\{\{\s*sauda[cç][aã]o\s*\}\}/gi, resolvedGreeting)
    .replace(/\{\{\s*(?:nome|operador)\s*\}\}/gi, cleanName)
    .replace(/\{\{\s*ia\s*\}\}/gi, aiName)
    .replace(/\{\{\s*setor\s*\}\}/gi, cleanSector)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Constrói o texto final de boas-vindas e a lista de sugestões para o operador.
 */
export function buildOperatorCopilotWelcome(params: {
  tenant?: string | null;
  tenantId?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
  operatorGroupName?: string | null;
  operatorRole?: string | null;
  sectors?: SectorLike[] | null;
  nowDateObj?: Date;
  nowDate?: Date;
}): {
  text: string;
  welcomeMessage: string;
  suggestions: string[];
  sectorName: string | null;
  sectorId: string | null;
} {
  const {
    operatorId,
    operatorName,
    operatorGroupName,
    operatorRole,
    sectors,
  } = params;
  const effectiveTenant = params.tenantId ?? params.tenant ?? null;
  const effectiveDate = params.nowDate ?? params.nowDateObj ?? new Date();

  const aiPersona = getAiPersona(effectiveTenant || undefined);
  const brtHourStr = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hour12: false,
  }).format(effectiveDate);
  const hour = parseInt(brtHourStr, 10);
  const greeting =
    hour >= 5 && hour < 12 ? "Bom dia" : hour >= 12 && hour < 18 ? "Boa tarde" : "Boa noite";

  const primarySector = resolveOperatorPrimarySector({
    operatorId,
    operatorGroupName,
    operatorRole,
    sectors,
  });

  const effectiveSectorName = primarySector?.name || operatorGroupName || "Comercial";
  const resolvedConfig = resolveSectorCopilotConfig(
    primarySector || { name: effectiveSectorName },
    effectiveTenant
  );

  const cleanName =
    operatorName && operatorName.trim() && operatorName.trim() !== "Operador"
      ? operatorName.trim()
      : "consultor";

  const text = interpolateCopilotWelcomeMessage(resolvedConfig.welcomeMessage, {
    greeting,
    operatorName: cleanName,
    aiName: aiPersona.name,
    sectorName: primarySector?.name || effectiveSectorName,
    nowDate: effectiveDate,
  });

  return {
    text,
    welcomeMessage: text,
    suggestions: resolvedConfig.suggestions,
    sectorName: primarySector?.name || null,
    sectorId: primarySector?.id || null,
  };
}
