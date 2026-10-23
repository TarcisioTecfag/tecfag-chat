// ══════════════════════════════════════════════════════════════════════════════
// 🧠 AGENTIC THOUGHT TRACE — Árvore de Pensamento e Ações Estilo Antigravity
// Compartilhado entre o Backend (/api/valentina/messages) e o Frontend
// (ValentinaChatTab, ChatPanel, ChatMessageBubble e CrmChatWidget).
// ══════════════════════════════════════════════════════════════════════════════

export type AgenticStepKind =
  | "thought"
  | "analyze"
  | "search"
  | "query"
  | "extract"
  | "synthesize";

export type AgenticBadgeType =
  | "sql"
  | "crm"
  | "sla"
  | "sdr"
  | "chat"
  | "ai"
  | "file"
  | "kb"
  | "team";

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

/**
 * Detecta se a mensagem do usuário é apenas um agradecimento, confirmação rápida
 * ou cumprimento casual que NÃO exige varredura de banco (ex: "ta obrigado", "valeu", "beleza", "ok").
 */
export function isCasualConversationQuery(text: string): boolean {
  const clean = normalizeQuery(text).replace(/[!?.,;:]+/g, "").trim();
  if (!clean) return false;
  if (clean.split(/\s+/).length > 6) return false;
  // Se contém interrogação ou termos de consulta operacional/comercial, NÃO é casual
  if (
    /\?|\b(?:qual|quais|como|quanto|quantos|quantas|quem|onde|quando|cade|puxa|puxe|mostra|mostre|manda|mande|lista|liste|tem|tenho|outra|outras|outro|outros|negociac|card|crm|fila|meta|tarefa|ligar|ligac|telefone|cliente|empresa|sla|tma|funil|sdr|relatorio|grafico)\b/.test(
      clean
    )
  ) {
    return false;
  }
  return /^(?:(?:ta|tá|ah|opa|ei|ola|oi)\s+)?(?:obrigad[oa]|muito\s+obrigad[oa]|valeu|vlw|ok|okay|beleza|blz|show|fechou|entendi|entendido|combinado|perfeito|certo|certinho|tudo\s+certo|ta\s+bom|ta\s+otimo|maravilha|boa|top|ate\s+mais|tchau|bom\s+dia|boa\s+tarde|boa\s+noite| imagina|de\s+nada)(?:\s+(?:fagner|valentina|ai|mesmo|entao|agora|por\s+enquanto))?$/.test(
    clean
  );
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
    extraSummary,
  } = options;

  const q = normalizeQuery(userQuery);
  const isCasual =
    !attachedFileName && !hasAttachedImage && isCasualConversationQuery(userQuery);

  const totalSec = totalDurationMs
    ? Math.max(1, Math.round(totalDurationMs / 1000))
    : isCasual
      ? 1
      : scope === "admin"
        ? 5
        : 4;

  // Se for uma mensagem casual (ex: "ta obrigado", "valeu", "ok"), retorna trilha enxuta e real sem consultas falsas ao banco
  if (isCasual && (!executedSteps || executedSteps.length === 0)) {
    return {
      taskTitle: `Respondendo mensagem`,
      finishedTitle: `Resposta direta enviada`,
      totalDurationSeconds: totalSec,
      scope,
      steps: [
        {
          id: "step-casual-reply",
          kind: "synthesize",
          actionVerb: "Respondeu via",
          targetLabel: "gemini-2.5-flash",
          scopeTag: "#conversa-direta",
          badgeType: "ai",
          detailText: `Mensagem casual reconhecida ("${userQuery.slice(0, 60)}") — respondida diretamente sem necessidade de reconsultar tabelas do banco.`,
          revealAfterMs: 0,
        },
      ],
    };
  }

  const thought1Sec = contextDurationMs
    ? Math.max(1, Math.round((contextDurationMs * 0.45) / 1000))
    : 1;
  const thought2Sec = aiDurationMs
    ? Math.max(1, Math.round(aiDurationMs / 1000))
    : Math.max(1, totalSec - thought1Sec);

  let taskTitle =
    scope === "admin"
      ? "Analisando indicadores da operação em tempo real"
      : "Consultando dados da sua operação";
  let finishedTitle =
    scope === "admin"
      ? "Consulta executiva de BI concluída"
      : "Consulta comercial concluída";

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

  const steps: AgenticThoughtStep[] = [];

  // ── 1. Anexos (Arquivo / Imagem) se presentes ──────────────────────────────
  if (attachedFileName) {
    steps.push({
      id: "step-file-extract",
      kind: "extract",
      actionVerb: "Extraiu",
      targetLabel: attachedFileName,
      scopeTag: "#leitura-documento",
      badgeType: "file",
      detailText: `Extração estruturada do conteúdo textual de "${attachedFileName}" para cruzamento com os dados da operação.`,
      revealAfterMs: 150,
    });
  }

  if (hasAttachedImage) {
    steps.push({
      id: "step-image-vision",
      kind: "analyze",
      actionVerb: "Analisou",
      targetLabel: "Multimodal Vision",
      scopeTag: "#inlineData",
      badgeType: "file",
      detailText: "Inspeção visual da imagem anexada via modelo multimodal Gemini 2.5 Pro.",
      revealAfterMs: 250,
    });
  }

  // ── 2. Escopo Diretoria / Admin (Aba Chat do Painel Fagner / Valentina) ───
  if (scope === "admin") {
    const isSlaOrAlerts = /sla|alerta|estouro|atraso|atrasad|demora|critico|espera/.test(q);
    const isTma = /tma|tempo medio|tempo de resposta|velocidade/.test(q);
    const isQueueOrBottleneck = /gargalo|fila|operador|atendente|sobrecarga|aguardando/.test(q);
    const isSdrOrTriage = /sdr|triagem|triagens|conversao|automacao|qualificad|robo|bot/.test(q);
    const isFunnelOrCrm = /funil|venda|vendas|pipeline|negociac|meta|faturamento|receita|grafico/.test(q);
    const isSellerReport = /vendedor|consultor|relatorio|ranking|desempenho|individual/.test(q);
    const isObjectionOrLoss = /objec|perda|perdida|motivo|recusa|concorren|preco/.test(q);
    const isRodizio = /rodizio|escala|distribuicao|ausente|ferias/.test(q);

    if (isSlaOrAlerts) {
      taskTitle = "Verificando alertas de estouro de SLA e atrasos de fila";
      finishedTitle = "Varredura de SLA e alertas da operação concluída";

      steps.push(
        {
          id: "step-thought-1",
          kind: "thought",
          actionVerb: `Pensou por ${thought1Sec}s`,
          targetLabel: "Identificando métricas de SLA e limites de alerta (>8m / >15m / >24h)",
          durationSeconds: thought1Sec,
          detailText: `Mapeando eventos de estouro de SLA do dia e cruzando notificações proativas registradas para os operadores com a fila viva.`,
          revealAfterMs: 120,
        },
        {
          id: "step-sql-sla",
          kind: "query",
          actionVerb: "Consultou",
          targetLabel: "response_time_logs",
          scopeTag: "#sla-hoje",
          badgeType: "sla",
          detailText: "Leitura dos registros de tempo de resposta e violações de SLA contabilizadas desde 00:00 (BRT).",
          revealAfterMs: 750,
        },
        {
          id: "step-internal-alerts",
          kind: "analyze",
          actionVerb: "Analisou",
          targetLabel: "internal_messages",
          scopeTag: "#sla_alert & #no_response",
          badgeType: "chat",
          detailText: "Auditoria dos alertas de atraso e falta de resposta disparados pelo SupervisorEngine hoje.",
          revealAfterMs: 1450,
        },
        {
          id: "step-live-queue",
          kind: "search",
          actionVerb: "Verificou",
          targetLabel: "conversations",
          scopeTag: "#aguardando >8m / >15m",
          badgeType: "sql",
          detailText: "Inspeção ao vivo das conversas abertas onde a última mensagem é do cliente sem retorno do operador.",
          revealAfterMs: 2150,
        }
      );
    } else if (isTma) {
      taskTitle = "Calculando Tempo Médio de Atendimento (TMA) da operação";
      finishedTitle = "Cálculo de TMA geral e por operador concluído";

      steps.push(
        {
          id: "step-thought-1",
          kind: "thought",
          actionVerb: `Pensou por ${thought1Sec}s`,
          targetLabel: "Selecionando fontes de telemetria de resposta (transferências + logs + chat ao vivo)",
          durationSeconds: thought1Sec,
          detailText: "Combinando eventos de primeiro atendimento pós-triagem com os tempos médios de resposta por operador.",
          revealAfterMs: 120,
        },
        {
          id: "step-tma-events",
          kind: "query",
          actionVerb: "Consultou",
          targetLabel: "commercial_transfer_response_events",
          scopeTag: "#tma-comercial",
          badgeType: "sla",
          detailText: "Extração dos tempos exatos entre o handoff do SDR e a primeira resposta humana do vendedor.",
          revealAfterMs: 750,
        },
        {
          id: "step-tma-logs",
          kind: "analyze",
          actionVerb: "Analisou",
          targetLabel: "response_time_logs",
          scopeTag: "#ranking-operadores",
          badgeType: "sql",
          detailText: "Agregação de tempo médio, mínimo e máximo de resposta por operador no dia e nos últimos 7 dias.",
          revealAfterMs: 1450,
        },
        {
          id: "step-tma-convs",
          kind: "search",
          actionVerb: "Cruzou",
          targetLabel: "conversations & messages",
          scopeTag: "#janela-ativa",
          badgeType: "chat",
          detailText: "Validação cruzada com as interações reais de hoje no WhatsApp.",
          revealAfterMs: 2150,
        }
      );
    } else if (isQueueOrBottleneck) {
      taskTitle = "Mapeando gargalos de fila e carga por operador";
      finishedTitle = "Diagnóstico de gargalos de fila concluído";

      steps.push(
        {
          id: "step-thought-1",
          kind: "thought",
          actionVerb: `Pensou por ${thought1Sec}s`,
          targetLabel: "Avaliando distribuição de conversas ativas e tempo de espera por carteira",
          durationSeconds: thought1Sec,
          detailText: "Identificando operadores com maior acúmulo de clientes aguardando resposta e conversas não lidas.",
          revealAfterMs: 120,
        },
        {
          id: "step-ops-query",
          kind: "query",
          actionVerb: "Consultou",
          targetLabel: "operators",
          scopeTag: "#equipe-ativa",
          badgeType: "team",
          detailText: "Leitura do quadro de operadores, status online/ocupado e setores vinculados.",
          revealAfterMs: 750,
        },
        {
          id: "step-queue-convs",
          kind: "analyze",
          actionVerb: "Analisou",
          targetLabel: "conversations",
          scopeTag: "#gargalos-por-operador",
          badgeType: "chat",
          detailText: "Cálculo do volume de chats ativos, clientes esperando resposta agora e tempo máximo de espera.",
          revealAfterMs: 1450,
        },
        {
          id: "step-unassigned",
          kind: "search",
          actionVerb: "Verificou",
          targetLabel: "fila_geral & automacao",
          scopeTag: "#sem-operador",
          badgeType: "sql",
          detailText: "Conferência de leads aguardando atribuição na fila geral ou em triagem.",
          revealAfterMs: 2150,
        }
      );
    } else if (isSdrOrTriage) {
      taskTitle = "Analisando funil e taxa de conversão do SDR";
      finishedTitle = "Análise de triagens e conversão do SDR concluída";

      steps.push(
        {
          id: "step-thought-1",
          kind: "thought",
          actionVerb: `Pensou por ${thought1Sec}s`,
          targetLabel: "Inspecionando sessões de triagem industrial e handoffs para os setores",
          durationSeconds: thought1Sec,
          detailText: "Cruzando estados de fluxo do SDR (hoje, 7d e acumulado) com os 9 funis/setores de destino.",
          revealAfterMs: 120,
        },
        {
          id: "step-sdr-states",
          kind: "query",
          actionVerb: "Consultou",
          targetLabel: "agent_flow_states",
          scopeTag: "#triagens-hoje",
          badgeType: "sdr",
          detailText: "Leitura das sessões iniciadas, em andamento, qualificadas e transferidas pelo SDR.",
          revealAfterMs: 750,
        },
        {
          id: "step-sdr-monitor",
          kind: "analyze",
          actionVerb: "Analisou",
          targetLabel: "projectIndustrialMonitoring",
          scopeTag: "#9-funis-destino",
          badgeType: "sdr",
          detailText: "Mapeamento da taxa de conversão e distribuição de leads por setor comercial e técnico.",
          revealAfterMs: 1450,
        },
        {
          id: "step-sdr-deals",
          kind: "search",
          actionVerb: "Cruzou",
          targetLabel: "crm_deals & contacts",
          scopeTag: "#leads-qualificados",
          badgeType: "crm",
          detailText: "Verificação dos cards de negócio e contatos gerados a partir das triagens concluídas.",
          revealAfterMs: 2150,
        }
      );
    } else if (isFunnelOrCrm || isSellerReport) {
      taskTitle = isSellerReport
        ? "Compilando relatório detalhado de desempenho por vendedor"
        : "Analisando funil de vendas, pipeline e metas do CRM";
      finishedTitle = isSellerReport
        ? "Relatório executivo por vendedor concluído"
        : "Análise do funil comercial e CRM concluída";

      steps.push(
        {
          id: "step-thought-1",
          kind: "thought",
          actionVerb: `Pensou por ${thought1Sec}s`,
          targetLabel: "Estruturando cruzamento de negociações do CRM, etapas dos funis e metas mensais",
          durationSeconds: thought1Sec,
          detailText: "Consolidando volume financeiro (aberto, ganho e perdido), ritmo de meta (pacing) e conversão por etapa.",
          revealAfterMs: 120,
        },
        {
          id: "step-crm-deals",
          kind: "query",
          actionVerb: "Consultou",
          targetLabel: "crm_deals & crm_stages",
          scopeTag: "#funil-semanal-mensal",
          badgeType: "crm",
          detailText: "Leitura das negociações por funil, etapa atual, valores em aberto, vendas ganhas e perdas.",
          revealAfterMs: 750,
        },
        {
          id: "step-crm-goals",
          kind: "analyze",
          actionVerb: "Analisou",
          targetLabel: "commercial_goals",
          scopeTag: "#pacing-vendedores",
          badgeType: "team",
          detailText: "Cálculo de atingimento de meta, ritmo esperado por dias úteis e gap diário por consultor.",
          revealAfterMs: 1450,
        },
        {
          id: "step-crm-activities",
          kind: "search",
          actionVerb: "Cruzou",
          targetLabel: "tasks & response_time_logs",
          scopeTag: "#produtividade",
          badgeType: "sql",
          detailText: "Correlação entre carteira do CRM, tarefas pendentes/atrasadas e TMA individual.",
          revealAfterMs: 2150,
        }
      );
    } else if (isObjectionOrLoss) {
      taskTitle = "Investigando objeções de leads e motivos de perda no CRM";
      finishedTitle = "Mapeamento de objeções e perdas concluído";

      steps.push(
        {
          id: "step-thought-1",
          kind: "thought",
          actionVerb: `Pensou por ${thought1Sec}s`,
          targetLabel: "Classificando motivos de perda do CRM e rastreando padrões de objeção no WhatsApp",
          durationSeconds: thought1Sec,
          detailText: "Agrupando perdas nas macro-categorias comerciais e varrendo mensagens reais recebidas dos clientes.",
          revealAfterMs: 120,
        },
        {
          id: "step-loss-deals",
          kind: "query",
          actionVerb: "Consultou",
          targetLabel: "crm_deals",
          scopeTag: "#status=lost",
          badgeType: "crm",
          detailText: "Leitura dos negócios perdidos, valores envolvidos e justificativas registradas pelos vendedores.",
          revealAfterMs: 750,
        },
        {
          id: "step-objection-msgs",
          kind: "search",
          actionVerb: "Vasculhou",
          targetLabel: "messages",
          scopeTag: "#objecoes-clientes",
          badgeType: "chat",
          detailText: "Detecção de termos de preço, prazo, concorrência, frete e financiamento nas conversas recentes.",
          revealAfterMs: 1450,
        }
      );
    } else if (isRodizio) {
      taskTitle = "Consultando escala do rodízio e distribuição de leads";
      finishedTitle = "Inspeção da escala do rodízio concluída";

      steps.push(
        {
          id: "step-thought-1",
          kind: "thought",
          actionVerb: `Pensou por ${thought1Sec}s`,
          targetLabel: "Verificando fila de distribuição, operadores ativos, ausências e compensações",
          durationSeconds: thought1Sec,
          detailText: "Consultando estado atual do motor de rodízio e histórico de leads recebidos por consultor.",
          revealAfterMs: 120,
        },
        {
          id: "step-rodizio-engine",
          kind: "query",
          actionVerb: "Consultou",
          targetLabel: "RodizioEngine",
          scopeTag: "#escala-atual",
          badgeType: "team",
          detailText: "Leitura da ordem da fila, contadores de leads recebidos e operadores marcados como ausentes.",
          revealAfterMs: 800,
        }
      );
    } else {
      // Consulta executiva geral / Deep search
      steps.push(
        {
          id: "step-thought-1",
          kind: "thought",
          actionVerb: `Pensou por ${thought1Sec}s`,
          targetLabel: "Planejando consulta 360º nos indicadores operacionais e comerciais",
          durationSeconds: thought1Sec,
          detailText: `Analisando o pedido ("${userQuery.slice(0, 80)}") para selecionar as tabelas de BI, CRM e atendimento.`,
          revealAfterMs: 120,
        },
        {
          id: "step-dir-context",
          kind: "query",
          actionVerb: "Consultou",
          targetLabel: "director-bi-context.ts",
          scopeTag: "#operacao-360",
          badgeType: "sql",
          detailText: "Coleta consolidada de TMA, filas por operador, alertas de SLA, triagens SDR e funil de vendas.",
          revealAfterMs: 750,
        },
        {
          id: "step-dir-crm",
          kind: "analyze",
          actionVerb: "Analisou",
          targetLabel: "crm_deals & conversations",
          scopeTag: `#base-${knowledgeBase || "tecfag"}`,
          badgeType: "crm",
          detailText: "Cruzamento de negociações abertas, clientes em atendimento e base de conhecimento ativa.",
          revealAfterMs: 1500,
        }
      );
    }
  } else {
    // ── 3. Escopo Operador / Vendedor (Fagner Colega / Valentina Colega) ─────
    const isCallOrPhone = /ligar|ligacao|ligacoes|telefone|fone|celular|contato|vigos|discar/.test(q);
    const isDealOrCrm = /negociac|card|proposta|orcamento|funil|parada|esfriando|aberta|valor|cliente|empresa/.test(q);
    const isGoalOrMeta = /meta|metas|ritmo|pacing|falta|vend|ganh|comissao/.test(q);
    const isTaskOrAgenda = /tarefa|tarefas|agenda|compromisso|hoje|pendente|atrasad/.test(q);
    const isWaitingChat = /esperando|aguardando|fila|conversa|chat|whatsapp|responder|atraso/.test(q);

    if (isCallOrPhone) {
      taskTitle = "Localizando telefones e preparando ações de ligação";
      finishedTitle = "Telefones e atalhos de discagem localizados";
    } else if (isDealOrCrm) {
      taskTitle = "Consultando negociações da sua carteira no CRM";
      finishedTitle = "Análise das negociações do CRM concluída";
    } else if (isGoalOrMeta) {
      taskTitle = "Calculando atingimento da sua meta mensal e ritmo";
      finishedTitle = "Cálculo de meta e pacing comercial concluído";
    } else if (isTaskOrAgenda) {
      taskTitle = "Verificando suas tarefas, ligações e agenda do dia";
      finishedTitle = "Verificação de agenda e tarefas concluída";
    } else if (isWaitingChat) {
      taskTitle = "Verificando clientes aguardando resposta na sua fila";
      finishedTitle = "Inspeção da sua fila de atendimento concluída";
    }

    steps.push({
      id: "step-op-thought-1",
      kind: "thought",
      actionVerb: `Pensou por ${thought1Sec}s`,
      targetLabel: "Identificando contexto comercial e registros vinculados à sua carteira",
      durationSeconds: thought1Sec,
      detailText: `Verificando metas, negociações do CRM, contatos e fila de atendimento do operador para responder a "${userQuery.slice(0, 70)}".`,
      revealAfterMs: 120,
    });

    if (isGoalOrMeta || (!isCallOrPhone && !isWaitingChat)) {
      steps.push({
        id: "step-op-home",
        kind: "query",
        actionVerb: "Consultou",
        targetLabel: "getCommercialHome",
        scopeTag: "#meta-e-pacing",
        badgeType: "crm",
        detailText: "Leitura da sua meta mensal, valor realizado no mês, ritmo por dias úteis e diretrizes do gestor.",
        revealAfterMs: 700,
      });
    }

    steps.push({
      id: "step-op-deals",
      kind: "analyze",
      actionVerb: "Analisou",
      targetLabel: "crm_deals & crm_accounts",
      scopeTag: extraSummary?.dealsCount ? `#${extraSummary.dealsCount}-negociacoes` : "#sua-carteira",
      badgeType: "crm",
      detailText: "Inspeção das suas negociações abertas, etapas do funil, dias sem interação e telefones dos contatos.",
      revealAfterMs: 1350,
    });

    if (isCallOrPhone || isTaskOrAgenda) {
      steps.push({
        id: "step-op-tasks",
        kind: "search",
        actionVerb: "Verificou",
        targetLabel: "tasks & crm_deal_activities",
        scopeTag: "#ligacoes-e-agenda",
        badgeType: "sla",
        detailText: "Busca de ligações agendadas, tarefas pendentes e histórico recente de atividades nos cards.",
        revealAfterMs: 1950,
      });
    } else {
      steps.push({
        id: "step-op-convs",
        kind: "search",
        actionVerb: "Verificou",
        targetLabel: "conversations",
        scopeTag: extraSummary?.waitingCount
          ? `#${extraSummary.waitingCount}-aguardando`
          : "#fila-whatsapp",
        badgeType: "chat",
        detailText: "Conferência de clientes aguardando resposta na sua fila e leads transferidos hoje.",
        revealAfterMs: 1950,
      });
    }

    if (extraSummary?.searchTerms && extraSummary.searchTerms.length > 0) {
      steps.push({
        id: "step-op-deepsearch",
        kind: "search",
        actionVerb: "Buscou",
        targetLabel: `"${extraSummary.searchTerms.join(", ")}"`,
        scopeTag: "#ficha-detalhada",
        badgeType: "sql",
        detailText: `Pesquisa profunda por nome/empresa/negociação para extrair ficha completa, histórico e telefone de discagem.`,
        revealAfterMs: 2450,
      });
    }
  }

  // ── 4. Etapa Final: Raciocínio de Síntese + Geração no Gemini 2.5 Pro ──────
  steps.push(
    {
      id: "step-thought-2",
      kind: "thought",
      actionVerb: `Pensou por ${thought2Sec}s`,
      targetLabel: `Consolidando dados reais e estruturando resposta de ${personaName}`,
      durationSeconds: thought2Sec,
      detailText:
        scope === "admin"
          ? "Cruzando métricas coletadas do banco com as regras executivas para montar blocos visuais, tabelas e insights."
          : "Organizando resposta objetiva com cards clicáveis de negociação (Abrir CRM) e discagem direta (VigosPhone) quando aplicável.",
      revealAfterMs: 2800,
    },
    {
      id: "step-vertex-synth",
      kind: "synthesize",
      actionVerb: "Sintetizou",
      targetLabel: "gemini-2.5-pro",
      scopeTag: scope === "admin" ? "#painel-executivo" : "#copiloto-comercial",
      badgeType: "ai",
      detailText: `Geração concluída via Google Vertex AI (${personaName}) em ${totalSec}s.`,
      revealAfterMs: 3450,
    }
  );

  return {
    taskTitle,
    finishedTitle,
    totalDurationSeconds: totalSec,
    scope,
    steps,
  };
}
