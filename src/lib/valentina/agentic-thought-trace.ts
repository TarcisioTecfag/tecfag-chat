// ══════════════════════════════════════════════════════════════════════════════
// 🧠 AGENTIC THOUGHT TRACE & INTENT ROUTER — Estilo Antigravity
// Compartilhado entre o Backend (/api/valentina/messages) e o Frontend
// (ValentinaChatTab, ChatPanel, ChatMessageBubble, CrmChatWidget e useChatState).
// ══════════════════════════════════════════════════════════════════════════════

export type AgenticStepKind =
  | "thought"
  | "analyze"
  | "search"
  | "query"
  | "extract"
  | "synthesize"
  | "read";

export type AgenticBadgeType =
  | "sql"
  | "crm"
  | "sla"
  | "sdr"
  | "chat"
  | "ai"
  | "file"
  | "kb"
  | "team"
  | "bi"
  | "vision";

export interface AgenticThoughtStep {
  id: string;
  kind: AgenticStepKind;
  /** Ex: "Analisou", "Consultou", "Buscou", "Cruzou", "Sintetizou" ou "Pensou por 2s" */
  actionVerb: string;
  /** Nome técnico ou módulo alvo (ex: "response_time_logs", "crm_deals", "gemini-2.5-pro") */
  targetLabel: string;
  /** Escopo / âncora estilo código (ex: "#alertas-hoje", "#L1-250", "#9-funis") */
  scopeTag?: string;
  /** Tipo de ícone/badge ao lado do recurso */
  badgeType?: AgenticBadgeType;
  /** Detalhe expansível quando o usuário clica na linha com seta › */
  detailText?: string;
  /** Segundos gastos na etapa de raciocínio */
  durationSeconds?: number;
  /** Momento (ms) em que a etapa aparece durante o progresso ao vivo */
  revealAfterMs?: number;
}

export interface AgenticThoughtTraceData {
  taskTitle: string;
  finishedTitle: string;
  totalDurationSeconds: number;
  scope: "admin" | "operator";
  steps: AgenticThoughtStep[];
  /** Quando true, as etapas estão sendo transmitidas ao vivo pelo backend via SSE conforme executam */
  isRealTimeStream?: boolean;
  /** Quando true, está no tempo de espera inicial antes da pesquisa/coleta (exibe apenas "Trabalhando" shimmer) */
  isWaitingPhase?: boolean;
  /** Quando true, é uma interação simples/casual que não exige árvore de pesquisa (exibe apenas "Trabalhando" shimmer) */
  isMinimalWorking?: boolean;
}

export interface BuildTraceOptions {
  userQuery: string;
  scope: "admin" | "operator";
  personaName?: string;
  knowledgeBase?: string;
  attachedFileName?: string | null;
  hasAttachedImage?: boolean;
  totalDurationMs?: number;
  contextDurationMs?: number;
  aiDurationMs?: number;
  /** Etapas reais medidas no servidor durante a execução das queries */
  executedSteps?: AgenticThoughtStep[];
  customTaskTitle?: string;
  customFinishedTitle?: string;
  extraSummary?: {
    dealsCount?: number;
    waitingCount?: number;
    callsCount?: number;
    searchTerms?: string[];
  };
}

function normalizeQuery(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const NON_MODEL_HYPHEN_PREFIXES = new Set([
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "pre",
  "pos",
  "auto",
  "semi",
  "anti",
  "sub",
  "super",
  "bem",
  "mal",
  "nao",
  "pro",
  "dia",
  "mes",
  "ano",
  "top",
  "ate",
  "das",
  "dos",
  "nas",
  "nos",
  "por",
  "com",
  "sem",
  "follow",
  "e-mail",
  "check",
  "hands",
  "stand",
  "know",
]);

/**
 * Detecta com precisão se o texto contém um código real de modelo de máquina/equipamento
 * (ex: "VSF-30S", "APF-300", "TC-20", "DZ-400", "DCGY-F200", "PAMQGPAU079", "BSF-5040"),
 * sem gerar falsos positivos em palavras comuns seguidas de números ("dia 29", "as 14h", "top 5").
 */
export function hasExplicitMachineModelCode(text: string): boolean {
  const norm = normalizeQuery(text);
  if (!norm) return false;

  // 1. Família ou prefixo industrial conhecido da Tecfag / Valem
  if (
    /\b(?:pamq[a-z0-9]{2,}|pratic\s*seal|tc[-_\s]?20\b|vsf[-_\s]?\d+[a-z0-9-]*|apf[-_\s]?\d+[a-z0-9-]*|bsf[-_\s]?\d+[a-z0-9-]*|dzf?[-_\s]?\d+[a-z0-9-]*|dcgy[-_\s]?[a-z0-9-]+|fql[-_\s]?\d+[a-z0-9-]*|km[-_\s]?\d+[a-z0-9-]*|fxj[-_\s]?\d+[a-z0-9-]*|frp[-_\s]?\d+[a-z0-9-]*|frb[-_\s]?\d+[a-z0-9-]*|lf[-_\s]?\d+[a-z0-9-]*|dbf[-_\s]?\d+[a-z0-9-]*)\b/i.test(
      norm
    )
  ) {
    return true;
  }

  // 2. Código alfanumérico com hífen explícito entre letras e números (ex: "XYZ-100", "MOD-20A")
  const hyphenMatches = norm.match(/\b([a-z]{2,6})-(\d{2,5}[a-z0-9-]*)\b/g);
  if (hyphenMatches) {
    for (const m of hyphenMatches) {
      const prefix = m.split("-")[0];
      if (prefix && !NON_MODEL_HYPHEN_PREFIXES.has(prefix)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detecta se a mensagem do usuário é uma saudação, cumprimento, agradecimento,
 * confirmação rápida ou conversa social que NÃO exige varredura de banco, CRM, VTEX ou manuais
 * (ex: "boa tarde", "bom dia fagner, tudo bem?", "oi", "valeu", "beleza", "ok", "obrigado").
 */
export function isCasualConversationQuery(text: string): boolean {
  const clean = normalizeQuery(text)
    .replace(/[!?.,;:"'()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return false;

  const words = clean.split(" ");
  if (words.length > 9) return false;

  // Se contém termos operacionais de consulta de atendimento, CRM, metas, tarefas ou máquinas, NÃO é casual
  if (
    /\b(?:negociac\w*|card\w*|crm|fila|meta|metas|tarefa\w*|agenda|compromisso\w*|ligar|ligac\w*|telefone\w*|cliente\w*|empresa\w*|cnpj|cpf|sla|tma|funil|pipeline|sdr|relatorio\w*|grafico\w*|orcamento\w*|proposta\w*|venda\w*|vendi\w*|faturamento|comissa\w*|maquina\w*|equipamento\w*|manual|manuais|catalogo|vtex|sku|estoque|frete|preco\w*|valor\w*|custa|seladora\w*|envasadora\w*|rotuladora\w*|datador\w*|empacotadora\w*|dosadora\w*|arqueadora\w*|encapsuladora\w*|peca\w*|suporte|projeto\w*|aguardando|esperando|parada\w*|parado\w*|esfriando|atendimento\w*|conversa\w*|chat\w*|avali\w*|analis\w*|audit\w*|puxa|puxe|mostra|mostre|lista|liste|resumo|prioridade\w*)\b/.test(
      clean
    )
  ) {
    return false;
  }

  if (hasExplicitMachineModelCode(clean)) {
    return false;
  }

  // Padrões diretos de saudação, cortesia, confirmação e conversa social
  if (
    /^(?:(?:oi+|ola+|opa+|ei+|e\s+ai|eai|fala|salve|alo|hey|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|tudo\s+bom|tudo\s+certo|tudo\s+joia|tudo\s+tranquilo|tudo\s+otimo|como\s+vai|como\s+voce\s+esta|como\s+vc\s+esta|como\s+vc\s+ta|como\s+esta|beleza|blz|ok|okay|show|fechou|entendi|entendido|combinado|perfeito|certo|certinho|ta\s+bom|ta\s+otimo|ta\s+certo|maravilha|boa|top|obrigad[oa]|muito\s+obrigad[oa]|valeu|vlw|agradecid[oa]|ate\s+mais|ate\s+logo|tchau|imagina|de\s+nada|por\s+nada|disponha|ta\s+ai|voce\s+ta\s+ai|vc\s+ta\s+ai|pode\s+me\s+ajudar|me\s+ajuda|era\s+so\s+isso|so\s+isso|por\s+enquanto\s+e\s+so|nada\s+nao|tudo\s+em\s+paz|bem\s+tambem|tudo\s+bem\s+por\s+aqui|comigo\s+tudo\s+bem|e\s+com\s+voce|e\s+com\s+vc|e\s+voce|e\s+vc|fagner|valentina|amigo|parceiro|colega|chefe|ai|mesmo|entao|agora|por\s+enquanto|hoje)\s*)+$/.test(
      clean
    )
  ) {
    return true;
  }

  return false;
}

export interface CopilotIntentClassification {
  isCasual: boolean;
  isConversationalAdvice: boolean;
  /** Quando true, não executa varredura de CRM/VTEX/Manuais e exibe apenas o indicador "Trabalhando" */
  isMinimalWorking: boolean;
  domains: {
    attendance: boolean;
    metrics: boolean;
    crmDeals: boolean;
    goals: boolean;
    tasks: boolean;
    technicalKb: boolean;
    vtex: boolean;
    systemGuide: boolean;
    overview360: boolean;
  };
  primaryDomain:
    | "casual"
    | "conversational"
    | "attendance"
    | "metrics"
    | "crm_deals"
    | "goals"
    | "tasks"
    | "technical_kb"
    | "vtex"
    | "system_guide"
    | "overview_360";
  taskTitle: string;
  finishedTitle: string;
}

/**
 * Classifica de forma estrita e modular a intenção da mensagem enviada ao Fagner/Valentina
 * para que APENAS as ferramentas e tabelas pertinentes àquele assunto sejam acionadas.
 * - Saudação / conversa casual -> apenas "Trabalhando", 0 consultas ao banco/VTEX/manuais
 * - Dúvida de atendimento -> apenas conversas/atendimento (não olha manuais de máquina nem VTEX)
 * - Dúvida técnica / máquina -> apenas manuais/catálogo/VTEX (não olha todas as negociações/atendimentos)
 * - Dúvida de negociação / CRM -> apenas negociações/CRM (não olha manuais de máquina nem VTEX)
 * - Dúvida de tarefas / agenda -> apenas tarefas e compromissos
 * - Dúvida de metas -> apenas metas e ritmo comercial
 */
export function classifyCopilotIntent(
  userQuery: string,
  options?: {
    hasAttachedImage?: boolean;
    hasAttachedFile?: boolean;
    recentAiContextText?: string;
    isSystemHowTo?: boolean;
    hasCandidateEntityTerms?: boolean;
  }
): CopilotIntentClassification {
  const hasAttachedImage = Boolean(options?.hasAttachedImage);
  const hasAttachedFile = Boolean(options?.hasAttachedFile);
  const isSystemHowTo = Boolean(options?.isSystemHowTo);
  const recentAiNorm = normalizeQuery(options?.recentAiContextText || "");
  const q = normalizeQuery(userQuery);

  // 1. Mensagem casual / saudação ("boa tarde", "oi", "tudo bem", "obrigado", "valeu")
  if (!hasAttachedImage && !hasAttachedFile && isCasualConversationQuery(userQuery)) {
    return {
      isCasual: true,
      isConversationalAdvice: false,
      isMinimalWorking: true,
      domains: {
        attendance: false,
        metrics: false,
        crmDeals: false,
        goals: false,
        tasks: false,
        technicalKb: false,
        vtex: false,
        systemGuide: false,
        overview360: false,
      },
      primaryDomain: "casual",
      taskTitle: "Trabalhando",
      finishedTitle: "Resposta enviada",
    };
  }

  // 2. Identificação de domínios específicos na mensagem atual
  const isConversationEval =
    /\b(?:avaliar|avalia|avaliacao|analisar|analisa|analise|auditar|audita|olhar|olha|ver|veja)\b.*\b(?:minha\s+conversa|meu\s+atendimento|conversa\s+com|chat\s+com|atendimento\s+com|atendimento\s+do|atendimento\s+da|ultimo\s+atendimento)\b/.test(
      q
    );

  const hasAttendanceKeywords =
    isConversationEval ||
    (!isSystemHowTo &&
      /\b(?:atendimento|atendimentos|conversa|conversas|chat|chats|whatsapp|fila|aguardando|esperando|sem\s+resposta|caixa\s+de\s+entrada|responder|respondi|chamado|chamados|triagem|triagens|lead\s+chegou|leads\s+chegaram|chegaram\s+hoje|transferido|transferidos|mensagem\s+do\s+cliente|mensagens\s+do\s+cliente)\b/.test(
        q
      ));

  const hasMetricsKeywords =
    !isSystemHowTo &&
    /\b(?:tma|tempo\s+medio|tempo\s+de\s+resposta|sla|estouro|estouros|metrica|metricas|score|nota\s+de\s+atendimento|meu\s+desempenho|indicadores\s+de\s+hoje)\b/.test(
      q
    );

  const hasTasksKeywords =
    !isSystemHowTo &&
    /\b(?:tarefa|tarefas|agenda|compromisso|compromissos|reuniao|reunioes|ligacao\s+agendada|ligacoes\s+agendadas|agendado|agendados|agendada|agendadas|follow\s*up|followup|pendente|pendentes|atrasada|atrasadas|atrasado|atrasados|recado|recados|acompanhamento|acompanhamentos)\b/.test(
      q
    );

  const hasGoalsKeywords =
    !isSystemHowTo &&
    /\b(?:meta|metas|ritmo|pacing|quanto\s+falta|bater\s+a\s+meta|vendi\s+no\s+mes|vendas\s+ganhas|ganhei\s+no\s+mes|comissao|diretriz|diretrizes)\b/.test(
      q
    );

  const hasCallOrPhoneKeywords =
    !isSystemHowTo &&
    /\b(?:ligar|ligacao|ligacoes|telefone|telefones|fone|celular|vigos|discar)\b/.test(q);

  // Detecção estrita de contexto técnico / máquina / peça / manual
  const hasExplicitMachineOrPartKeyword =
    hasAttachedImage ||
    hasExplicitMachineModelCode(userQuery) ||
    /\b(?:maquina|maquinas|equipamento|equipamentos|manual|manuais|especificac\w*|catalogo|ficha\s+tecnica|voltagem|potencia|seladora|selar|selagem|envasadora|envasar|envase|rotuladora|rotular|rotulagem|datador|datar|datacao|empacotadora|empacotar|dosadora|dosar|valvula|frasco|frascos|pote|potes|garrafa|garrafas|tampa|tampas|alicate|arqueadora|arquear|arqueacao|fita\s+de\s+arquear|peca|pecas|reposicao|insumo|insumos|tunel\s+de\s+encolhimento|encolhimento|vacuo|sache|saches|encapsuladora|encapsular|blister|cartonadora|enfardad\w*|fechadora|stretch|inkjet|laser|ribbon|teflon|resistencia|ihm|clp|inversor|bomba|rotor|pistao|bico|bicos|dosagem|velocidade\s+da\s+esteira|temperatura\s+de\s+selagem|compressor|pneumatic\w*|esquema\s+eletrico|dimensao|dimensoes|salgadinho|salgadinhos|embalar|embalagem|embalagens|por\s+minuto|ciclos|vtex|sku\s*\d+|tecfag\.com\.br)\b/.test(
      q
    );

  // Follow-up pronominal técnico ("qual a voltagem dela?", "me manda foto dela", "quanto ela custa?")
  // SÓ herda o contexto de máquina do turno anterior se a pergunta atual NÃO for sobre atendimento/CRM/tarefas/metas
  const isTechnicalPronounFollowUp =
    !hasAttendanceKeywords &&
    !hasTasksKeywords &&
    !hasGoalsKeywords &&
    /\b(?:dela|dele|dessa\s+maquina|desse\s+modelo|desse\s+equipamento|esse\s+modelo|essa\s+maquina|foto\s+dela|codigo\s+dela|link\s+dela|preco\s+dela|valor\s+dela|manual\s+dela)\b/.test(
      q
    ) &&
    /\b(?:envasadora|seladora|dosadora|rotuladora|datador|empacotadora|arqueadora|encapsuladora|pamq[a-z0-9]+|tecfag\.com\.br|manual\s+tecnico|faixa\s+de\s+dosagem)\b/.test(
      recentAiNorm
    );

  const isTechnicalKb =
    !isConversationEval &&
    !isSystemHowTo &&
    (hasExplicitMachineOrPartKeyword || isTechnicalPronounFollowUp);

  const isVtex =
    isTechnicalKb &&
    /\b(?:vtex|site|loja|link|url|pagina|sku|quanto\s+custa|qual\s+o\s+preco|qual\s+o\s+valor|preco\s+no\s+site|estoque|disponivel|disponibilidade|frete|tecfag\.com\.br)\b/.test(
      q
    );

  // Detecção estrita de CRM / Negociações
  const hasExplicitCrmWords =
    !isSystemHowTo &&
    /\b(?:negociac\w*|card|cards|crm|proposta|propostas|orcamento|orcamentos|funil|funis|pipeline|etapa|etapas|carteira|parada|paradas|parado|parados|esfriando|aberta|abertas|perdida|perdidas|ganha|ganhas|pausada|pausadas|cnpj|cpf|empresa|empresas|conta|contas|campo\s+personalizado|campos\s+personalizados|campo\s+customizado|campos\s+customizados|comprador|decisor|ficha|fechamento|previsao)\b/.test(
      q
    );

  const hasCommercialValueOrListQuestion =
    !isSystemHowTo &&
    !isTechnicalKb &&
    !hasAttendanceKeywords &&
    !hasTasksKeywords &&
    /\b(?:qual\s+o\s+valor|quais\s+os\s+valores|valor\s+da|valor\s+do|cotacao|cotacoes|projeto|projetos|cliente|clientes|responsavel)\b/.test(
      q
    );

  const isOverview360 =
    !isSystemHowTo &&
    !isTechnicalKb &&
    /\b(?:resumo\s+do\s+(?:meu\s+)?dia|resumo\s+geral|panorama\s+geral|como\s+esta\s+meu\s+dia|minhas\s+prioridades|prioridades\s+de\s+hoje|prioridades\s+agora|visao\s+geral\s+de\s+hoje)\b/.test(
      q
    );

  let crmDeals =
    hasExplicitCrmWords ||
    hasCommercialValueOrListQuestion ||
    (hasCallOrPhoneKeywords && !hasTasksKeywords) ||
    isOverview360;

  let attendance = hasAttendanceKeywords || isOverview360;
  const metrics = hasMetricsKeywords || isOverview360;
  const tasks = hasTasksKeywords || (hasCallOrPhoneKeywords && /\b(?:hoje|agendad\w*)\b/.test(q)) || isOverview360;
  const goals = hasGoalsKeywords || isOverview360;
  const technicalKb = isTechnicalKb;
  const vtex = isVtex;
  const systemGuide = isSystemHowTo && !isTechnicalKb;

  // Se o operador perguntou especificamente por um nome próprio / empresa ("e sobre o Alvaro?", "puxa os dados da Metalúrgica X")
  // sem citar palavras-chave de máquina ou guia do sistema, busca apenas em CRM Deals + Conversas daquele nome
  const hasAnyDomainSoFar =
    attendance || metrics || crmDeals || goals || tasks || technicalKb || vtex || systemGuide || isOverview360;

  const isConversationalDraftOrTip =
    !hasAnyDomainSoFar &&
    !hasAttachedImage &&
    !hasAttachedFile &&
    /\b(?:escrev\w*|redig\w*|crie\s+uma\s+mensagem|monta\s+uma\s+mensagem|dica\w*|como\s+responder|como\s+contornar|argumento\w*|quem\s+e\s+voce|o\s+que\s+voce\s+faz|como\s+voce\s+funciona)\b/.test(
      q
    );

  if (!hasAnyDomainSoFar && !isConversationalDraftOrTip && options?.hasCandidateEntityTerms) {
    crmDeals = true;
    attendance = true;
  }

  const finalHasAnyDomain =
    attendance ||
    metrics ||
    crmDeals ||
    goals ||
    tasks ||
    technicalKb ||
    vtex ||
    systemGuide ||
    isOverview360 ||
    hasAttachedFile ||
    hasAttachedImage;

  if (!finalHasAnyDomain) {
    return {
      isCasual: false,
      isConversationalAdvice: true,
      isMinimalWorking: true,
      domains: {
        attendance: false,
        metrics: false,
        crmDeals: false,
        goals: false,
        tasks: false,
        technicalKb: false,
        vtex: false,
        systemGuide: false,
        overview360: false,
      },
      primaryDomain: "conversational",
      taskTitle: "Trabalhando",
      finishedTitle: "Resposta enviada",
    };
  }

  let primaryDomain: CopilotIntentClassification["primaryDomain"] = "crm_deals";
  let taskTitle = "Consultando dados da sua operação";
  let finishedTitle = "Consulta concluída";

  if (isOverview360) {
    primaryDomain = "overview_360";
    taskTitle = "Compilando resumo de prioridades do seu dia";
    finishedTitle = "Resumo operacional do dia concluído";
  } else if (systemGuide) {
    primaryDomain = "system_guide";
    taskTitle = "Consultando Guia Oficial do Sistema (Onboarding Wizard)";
    finishedTitle = "Passo a passo de navegação do sistema carregado";
  } else if (vtex) {
    primaryDomain = "vtex";
    taskTitle = "Consultando Loja VTEX ao vivo e especificações do equipamento";
    finishedTitle = "Leitura da loja VTEX e especificações concluída";
  } else if (technicalKb) {
    primaryDomain = "technical_kb";
    taskTitle = hasAttachedImage
      ? "Inspecionando visualmente a foto enviada e consultando catálogo técnico"
      : "Consultando manuais técnicos e catálogo na Base de Conhecimento";
    finishedTitle = hasAttachedImage
      ? "Inspeção visual e consulta técnica concluídas"
      : "Consulta aos manuais técnicos e catálogo concluída";
  } else if (attendance && !crmDeals) {
    primaryDomain = "attendance";
    taskTitle = isConversationEval
      ? "Carregando mensagens do atendimento para avaliação"
      : "Verificando atendimentos e fila de espera no WhatsApp";
    finishedTitle = isConversationEval
      ? "Histórico do atendimento avaliado"
      : "Inspeção da sua fila de atendimento concluída";
  } else if (metrics && !crmDeals && !attendance) {
    primaryDomain = "metrics";
    taskTitle = "Consultando suas métricas de atendimento e SLA de hoje";
    finishedTitle = "Métricas de atendimento e SLA carregadas";
  } else if (tasks && !crmDeals && !goals) {
    primaryDomain = "tasks";
    taskTitle = "Verificando suas tarefas, ligações e compromissos agendados";
    finishedTitle = "Verificação de agenda e tarefas concluída";
  } else if (goals && !crmDeals) {
    primaryDomain = "goals";
    taskTitle = "Calculando atingimento da sua meta mensal e ritmo";
    finishedTitle = "Cálculo de meta e ritmo comercial concluído";
  } else if (hasCallOrPhoneKeywords) {
    primaryDomain = "crm_deals";
    taskTitle = "Localizando telefones e preparando ações de ligação";
    finishedTitle = "Telefones e atalhos de discagem localizados";
  } else {
    primaryDomain = "crm_deals";
    taskTitle = "Consultando negociações e ficha da sua carteira no CRM";
    finishedTitle = "Análise das negociações do CRM concluída";
  }

  return {
    isCasual: false,
    isConversationalAdvice: false,
    isMinimalWorking: false,
    domains: {
      attendance,
      metrics,
      crmDeals,
      goals,
      tasks,
      technicalKb,
      vtex,
      systemGuide,
      overview360: isOverview360,
    },
    primaryDomain,
    taskTitle,
    finishedTitle,
  };
}

/**
 * Gera a trilha inicial ao vivo no frontend (após o tempo de espera inicial)
 * refletindo ESTRITAMENTE os domínios acionados pela pergunta — sem inventar etapas de CRM ou VTEX.
 */
export function buildInitialLiveTraceForIntent(params: {
  userQuery: string;
  scope: "admin" | "operator";
  personaName?: string;
  knowledgeBase?: string;
  attachedFileName?: string | null;
  hasAttachedImage?: boolean;
}): AgenticThoughtTraceData {
  const {
    userQuery,
    scope,
    personaName = "Fagner",
    knowledgeBase,
    attachedFileName,
    hasAttachedImage,
  } = params;

  const intent = classifyCopilotIntent(userQuery, {
    hasAttachedImage,
    hasAttachedFile: Boolean(attachedFileName),
    hasCandidateEntityTerms: normalizeQuery(userQuery).split(/\s+/).some((w) => w.length >= 3),
  });

  if (intent.isMinimalWorking) {
    return {
      taskTitle: "Trabalhando",
      finishedTitle: "Resposta enviada",
      totalDurationSeconds: 1,
      scope,
      isRealTimeStream: true,
      isMinimalWorking: true,
      steps: [],
    };
  }

  const steps: AgenticThoughtStep[] = [];

  if (attachedFileName) {
    steps.push({
      id: "step-init-file",
      kind: "extract",
      actionVerb: "Lendo",
      targetLabel: attachedFileName,
      scopeTag: "#anexo",
      badgeType: "file",
      detailText: `Extraindo conteúdo de "${attachedFileName}".`,
    });
  }

  if (hasAttachedImage) {
    steps.push({
      id: "step-init-image",
      kind: "analyze",
      actionVerb: "Inspecionando",
      targetLabel: "Multimodal Vision",
      scopeTag: "#imagem",
      badgeType: "vision",
      detailText: "Analisando visualmente a imagem enviada.",
    });
  }

  if (scope === "admin") {
    steps.push({
      id: "step-admin-thought-1",
      kind: "thought",
      actionVerb: "Pensou por 1s",
      targetLabel: `Selecionando indicadores executivos para responder à sua consulta`,
      detailText: `Identificando as fontes necessárias para "${userQuery.slice(0, 80)}".`,
    });
    if (intent.domains.technicalKb || intent.domains.vtex) {
      steps.push({
        id: "step-admin-kb",
        kind: "search",
        actionVerb: "Consultando",
        targetLabel: intent.domains.vtex ? "knowledge_base & VTEX Store" : "knowledge_base",
        scopeTag: "#catalogo-tecnico",
        badgeType: "kb",
        detailText: "Consultando manuais técnicos e catálogo oficial de equipamentos.",
      });
    } else {
      steps.push({
        id: "step-admin-bi",
        kind: "query",
        actionVerb: "Consultando",
        targetLabel: "director_bi_context",
        scopeTag: `#${knowledgeBase || "tecfag"} • em execução`,
        badgeType: "bi",
        detailText: "Consultando métricas operacionais e comerciais pertinentes à pergunta.",
      });
    }
    return {
      taskTitle: intent.taskTitle,
      finishedTitle: intent.finishedTitle,
      totalDurationSeconds: 1,
      scope: "admin",
      isRealTimeStream: true,
      steps,
    };
  }

  // Escopo Operador: adiciona APENAS as etapas dos domínios realmente ativados!
  steps.push({
    id: "step-op-thought-1",
    kind: "thought",
    actionVerb: "Pensou por 1s",
    targetLabel: intent.taskTitle,
    detailText: `Selecionando apenas as funções necessárias para "${userQuery.slice(0, 80)}".`,
  });

  if (intent.domains.systemGuide) {
    steps.push({
      id: "step-op-wizard-guide",
      kind: "read",
      actionVerb: "Consultando",
      targetLabel: "Guia Oficial do Sistema",
      scopeTag: "#onboarding-wizard",
      badgeType: "sla",
      detailText: "Localizando instruções passo a passo de navegação do sistema.",
    });
  }

  if (intent.domains.goals) {
    steps.push({
      id: "step-op-home",
      kind: "query",
      actionVerb: "Consultando",
      targetLabel: "getCommercialHome",
      scopeTag: "#meta-e-pacing",
      badgeType: "crm",
      detailText: "Verificando sua meta mensal, realizado e ritmo comercial.",
    });
  }

  if (intent.domains.crmDeals) {
    steps.push({
      id: "step-op-deals",
      kind: "analyze",
      actionVerb: "Analisando",
      targetLabel: "crm_deals & crm_accounts",
      scopeTag: "#sua-carteira",
      badgeType: "crm",
      detailText: "Verificando negociações e contatos vinculados à sua carteira no CRM.",
    });
  }

  if (intent.domains.tasks) {
    steps.push({
      id: "step-op-tasks",
      kind: "search",
      actionVerb: "Verificando",
      targetLabel: "crm_deal_activities",
      scopeTag: "#tarefas-e-agenda",
      badgeType: "sla",
      detailText: "Consultando suas tarefas, compromissos e ligações agendadas.",
    });
  }

  if (intent.domains.attendance) {
    steps.push({
      id: "step-op-convs",
      kind: "search",
      actionVerb: "Verificando",
      targetLabel: "conversations",
      scopeTag: "#atendimentos",
      badgeType: "chat",
      detailText: "Consultando seus atendimentos e fila de espera no WhatsApp.",
    });
  }

  if (intent.domains.metrics) {
    steps.push({
      id: "step-op-metrics",
      kind: "query",
      actionVerb: "Consultando",
      targetLabel: "operator_daily_metrics",
      scopeTag: "#tma-e-sla",
      badgeType: "sla",
      detailText: "Verificando seu TMA e indicadores de atendimento de hoje.",
    });
  }

  if (intent.domains.technicalKb) {
    steps.push({
      id: "step-op-kb",
      kind: "search",
      actionVerb: "Consultando",
      targetLabel: intent.domains.vtex ? "knowledge_base & loja VTEX" : "knowledge_base",
      scopeTag: "#catalogo-tecnico",
      badgeType: "kb",
      detailText: "Consultando manuais técnicos em PDF e Catálogo Oficial de Equipamentos.",
    });
  }

  steps.push({
    id: "step-vertex-synthesize",
    kind: "synthesize",
    actionVerb: "Sintetizando",
    targetLabel: `resposta com ${personaName}`,
    scopeTag: "#em-execucao",
    badgeType: "ai",
    detailText: `Estruturando resposta objetiva de ${personaName}.`,
  });

  return {
    taskTitle: intent.taskTitle,
    finishedTitle: intent.finishedTitle,
    totalDurationSeconds: 1,
    scope: "operator",
    isRealTimeStream: true,
    steps,
  };
}

/**
 * Gera a árvore de ações e raciocínio contextualizada para a pergunta do usuário.
 * Quando `executedSteps` é fornecido pelo servidor, usa 100% as etapas reais executadas no banco.
 */
export function buildAgenticThoughtTrace(options: BuildTraceOptions): AgenticThoughtTraceData {
  const {
    userQuery,
    scope,
    personaName = "Fagner",
    knowledgeBase,
    attachedFileName,
    hasAttachedImage,
    totalDurationMs,
    contextDurationMs,
    aiDurationMs,
    executedSteps,
    customTaskTitle,
    customFinishedTitle,
    extraSummary,
  } = options;

  const intent = classifyCopilotIntent(userQuery, {
    hasAttachedImage,
    hasAttachedFile: Boolean(attachedFileName),
    hasCandidateEntityTerms: Boolean(
      extraSummary?.searchTerms && extraSummary.searchTerms.length > 0
    ),
  });

  const totalSec = totalDurationMs
    ? Math.max(1, Math.round(totalDurationMs / 1000))
    : intent.isMinimalWorking
    ? 1
    : scope === "admin"
    ? 4
    : 3;

  // Se for uma mensagem casual/simples (ex: "boa tarde", "ta obrigado", "valeu", "ok") sem etapas de pesquisa no banco:
  // retorna isMinimalWorking: true e steps: [] para NÃO exibir árvore pesada de ações nem poluir acima da resposta!
  if (intent.isMinimalWorking && (!executedSteps || executedSteps.length === 0)) {
    return {
      taskTitle: "Trabalhando",
      finishedTitle: "Resposta direta enviada",
      totalDurationSeconds: totalSec,
      scope,
      isMinimalWorking: true,
      steps: [],
    };
  }

  const taskTitle =
    (typeof customTaskTitle === "string" && customTaskTitle.trim()) || intent.taskTitle;
  const finishedTitle =
    (typeof customFinishedTitle === "string" && customFinishedTitle.trim()) || intent.finishedTitle;

  // Se o servidor já mediu e executou as etapas reais, usa exatamente as etapas reais!
  if (executedSteps && executedSteps.length > 0) {
    return {
      taskTitle,
      finishedTitle,
      totalDurationSeconds: totalSec,
      scope,
      isRealTimeStream: true,
      steps: executedSteps,
    };
  }

  return buildInitialLiveTraceForIntent({
    userQuery,
    scope,
    personaName,
    knowledgeBase,
    attachedFileName,
    hasAttachedImage,
  });
}
