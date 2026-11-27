import {
  assessIndustrialReadiness,
  hasPendingTriageQuestion,
  INDUSTRIAL_CURRICULUM_SOLIDES_URL,
  INDUSTRIAL_REVIEW_FUNNEL,
  INDUSTRIAL_SUPPLIERS_EMAIL,
  isPendingTriageQuestionBubble,
  normalizeIndustrialFunnel,
  type CollectedFields,
  type IndustrialRoute,
} from "./industrial-policy.ts";
import {
  messagesCoverIndustrialBusinessHoursNotice,
  type IndustrialBusinessHoursEvaluation,
} from "./industrial-business-hours.ts";

export interface HandoffOperator {
  id: string;
  name: string;
  isAbsent?: boolean;
}
export interface HandoffDeal {
  dealId: string;
  dealTitle: string;
  action: "reused_within_3h" | "created_new";
  funnelId: string;
  stageId: string;
}
export type IndustrialHandoffStatus =
  | "collecting"
  | "awaiting_approval"
  | "resolved"
  | "waiting_for_team"
  | "handoff_failed"
  | "transferred";

/**
 * Fallbacks de último recurso caso o LLM não produza nenhuma mensagem aproveitável ao entrar
 * em `awaiting_approval` (ex.: retornou apenas pergunta de coleta ou array vazio).
 * NUNCA são anexados quando o próprio Fagner já respondeu ao cliente de forma contextualizada.
 */
export const INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE =
  "Obrigado pelas informações! Já vou direcionar seu atendimento para a equipe responsável dar continuidade por aqui.";

export const INDUSTRIAL_HUMAN_REQUEST_APPROVAL_MESSAGE =
  "Entendido! Já vou direcionar seu atendimento para a nossa equipe dar continuidade por aqui.";

/**
 * Detecta apenas falsas alegações de efeitos internos do servidor (card/negociação já criado,
 * transferência já efetivada ou nominal antes da aprovação SDR) e a antiga frase robótica banida
 * ("já coletei tudo" / "estou validando"), preservando respostas naturais e contextualizadas do Fagner.
 */
export const INDUSTRIAL_FALSE_SYSTEM_CLAIM_PATTERN =
  /(?:j[aá]\s+(?:criei|vinculei|transferi)\b|(?:card|negocia[cç][aã]o)\s+(?:j[aá]\s+)?(?:criad[oa]|vinculad[oa]|foi\s+criad[oa]|foi\s+vinculad[oa])|(?:estou|te)\s+(?:te\s+)?transferindo(?:\s+agora)?\s+para\s+(?!(?:a|o|um|uma|noss[oa]|equipe|setor|time|especialista|atendimento|comercial|suporte|financeiro|p[oó]s[\s-]?venda|pe[cç]as|consultor)\b)[a-zà-ú]{2,}|j[aá]\s+coletei\s+tudo|estou\s+validando)/i;

/**
 * Detecta balões genéricos de despedida/agradecimento/confirmação curta redundantes gerados
 * pelo LLM no turno final de `awaiting_approval`/`transferred`, preservando apenas respostas
 * informativas reais ao cliente (ex.: cidade/sede, origem/importação, garantia, vídeo/condições).
 */
export const INDUSTRIAL_GENERIC_CLOSING_PATTERN =
  /^(?:(?:(?:perfeito|certo|entendido|compreendido|obrigad[oa]|combinado|confirmado|recebido|otimo|ótimo|disponha|imagina|agrade[cç]o)(?:[\s,!.]+\p{L}+){0,3}[\s,!.]*)$|(?:(?:perfeito|certo|entendido|compreendido|obrigad[oa]|combinado|confirmado|recebido|otimo|ótimo|disponha|imagina)(?:[\s,!.]+\p{L}+){0,2}[\s,!.]*)?(?:(?:muito\s+)?obrigad[oa]|agrade[cç]o|agradecemos|todas as informa[cç][oõ]es foram registradas|dados confirmados|cadastro atualizado|j[aá] registrei|j[aá] tenho (?:todas )?as informa[cç][oõ]es|tenho a base completa|com est[ea]s dados|com esses dados|com as informa[cç][oõ]es que voc[eê]|as informa[cç][oõ]es que voc[eê] passou|tenha um [oó]timo dia|tenha uma [oó]tima (?:tarde|noite)|desejo sucesso|estamos [aà] disposi[cç][aã]o|fico [aà] disposi[cç][aã]o|ficamos [aà] disposi[cç][aã]o|permane[cç]o [aà] disposi[cç][aã]o|continuamos [aà] disposi[cç][aã]o|um momento(?:,\s*|\s+)por favor|por favor,\s*aguarde))/iu;

/**
 * Detecta promessas/anúncios de encaminhamento, transferência ou acionamento de equipe
 * que o modelo NÃO pode emitir enquanto a triagem ainda estiver em coleta (`collecting`)
 * nem duplicar antes da bolha oficial de encaminhamento em `awaiting_approval`/`transferred`.
 */
export const INDUSTRIAL_CLAIMS_EFFECT_PATTERN =
  /(?:j[aá]\s+(?:criei|vinculei|transferi|encaminhei|direcionei|redirecionei|acionei|passei|enviei|solicitei|registrei)\b|\bregistrei\s+(?:todos\s+os\s+detalhes|as\s+informa[cç][oõ]es|os\s+dados|sua\s+solicita[cç][aã]o)\b|(?:card|negocia[cç][aã]o|atendimento|solicita[cç][aã]o|contato|pedido|caso|demanda|proposta)[^.!?]{0,70}(?:criad[oa]|vinculad[oa]|transferid[oa]|encaminhad[oa]|direcionad[oa]|redirecionad[oa]|registrad[oa]|solicitad[oa]|j[aá]\s+est[aá]\s+(?:com|sendo\s+preparad[oa]|preparando)|foi\s+(?:direcionad[oa]|encaminhad[oa]|transferid[oa]|enviad[oa]|registrad[oa])|(?:ser[aá]|vai\s+ser)\s+(?:verificad[oa]|analisad[oa]|avaliad[oa]|atendid[oa]|tratad[oa]|acompanhad[oa])\s+pel[oa])|(?:estou|te|vou)\s+(?:te\s+)?(?:transferindo|transferir|encaminhando|encaminhar|direcionando|direcionar|redirecionando|redirecionar|acionando|acionar|passando|passar)|(?:j[aá]\s+)?estou\s+solicitando\s+(?:a\s+)?(?:sua\s+)?(?:proposta|cota[cç][aã]o|or[cç]amento)|(?:equipe|especialista|consultor(?:a|es)?|setor|time|p[oó]s[\s-]?venda|financeiro|suporte|pe[cç]as)[^.!?]{0,160}(?:j[aá]\s+(?:foi\s+acionad[oa]|recebeu|est[aá]\s+com|est[aá]\s+preparando|dar[aá]\s+andamento|consegue\s+(?:preparar|elaborar|montar|verificar|analisar|avaliar|apresentar|enviar|dar)|ir[aá]|vai)|(?:ir[aá]|vai|pode|poder[aá])\s+(?:assumir|entrar\s+em\s+contato|retornar|dar\s+andamento|dar\s+continuidade|atender|verificar|analisar|avaliar|preparar|elaborar|apresentar|detalhar|cotar|cuidar|alinhar|enviar|mandar|fazer\s+a\s+an[aá]lise)|entrar[aá]\s+em\s+contato|retornar[aá](?:\s+o\s+contato)?|assumir[aá]|dar[aá]\s+continuidade|dar[aá]\s+prioridade|avaliar[aá]|analisar[aá]|verificar[aá]|preparar[aá]|elaborar[aá]|apresentar[aá]|detalhar[aá]|cotar[aá]|cuidar[aá]|enviar[aá]|mandar[aá]|far[aá]\s+a\s+an[aá]lise)|\b(?:em\s+(?:instantes|breve)|logo\s+mais)[^.!?]{0,90}(?:entrar[aá]\s+em\s+contato|enviar[aá]|retornar[aá]|falar[aá]\s+com\s+voc[eê]|dar[aá]\s+continuidade)\b|\bele\s+poder[aá]\s+(?:detalhar|apresentar|alinhar|verificar|analisar|elaborar|preparar)|j[aá]\s+coletei\s+tudo|estou\s+validando|j[aá]\s+s[aã]o\s+o\s+ponto\s+de\s+partida)/i;

export function isRedundantIndustrialClosingMessage(text: string): boolean {
  const clean = String(text || "").trim();
  if (!clean) return true;
  if (INDUSTRIAL_CLAIMS_EFFECT_PATTERN.test(clean)) return true;
  if (INDUSTRIAL_GENERIC_CLOSING_PATTERN.test(clean)) return true;
  // Detecta frases finais que apenas validam ausência de estimativa + ponto de partida / equipe
  if (
    /(?:n[aã]o ter uma estimativa|mesmo sem a estimativa|j[aá] tenho as informa[cç][oõ]es|tenho a base completa)/i.test(
      clean,
    ) &&
    /(?:ponto de partida|especialista|equipe|consultor|proposta|configura[cç][aã]o|solu[cç][oõ]es|projeto)/i.test(
      clean,
    )
  ) {
    return true;
  }
  return false;
}

export function isPrematureIndustrialHandoffBubble(text: string): boolean {
  const clean = String(text || "").trim();
  if (!clean) return false;
  // Uma pergunta legítima de coleta que apenas explica o motivo ("Para que o especialista possa...")
  // não é promessa falsa de encaminhamento, salvo se alegar ação já executada pelo servidor.
  // Perguntas meramente fáticas no fim de frases declarativas (", ok?", ", tá?", ", combinado?")
  // NÃO blindam uma promessa prematura de encaminhamento nem impedem implicitReadyHandoff.
  if (
    isPendingTriageQuestionBubble(clean) &&
    !INDUSTRIAL_FALSE_SYSTEM_CLAIM_PATTERN.test(clean)
  ) {
    return false;
  }
  return INDUSTRIAL_CLAIMS_EFFECT_PATTERN.test(clean);
}

const ORPHAN_ANAPHORIC_CONNECTOR_PATTERN =
  /^(?:enquanto\s+isso|nesse\s+meio\s+tempo|al[eé]m\s+disso|al[eé]m\s+desse|al[eé]m\s+dessa|tamb[eé]m|e\s+tamb[eé]m|mas\s+antes|por\s+isso|com\s+isso|sendo\s+assim|para\s+isso|assim\s+que\s+ele|ele\s+(?:vai|ir[aá]|pode))\b/i;

export function startsWithOrphanAnaphoricConnector(text: string): boolean {
  const clean = String(text || "").trim();
  return Boolean(clean && ORPHAN_ANAPHORIC_CONNECTOR_PATTERN.test(clean));
}

export function stripLeadingOrphanAnaphoricConnector(text: string): string {
  const clean = String(text || "").trim();
  if (!clean) return "";
  const stripped = clean
    .replace(/^(?:enquanto\s+isso|nesse\s+meio\s+tempo)[,:\-–—\s]+/i, "")
    .trim();
  if (!stripped) return clean;
  return stripped.charAt(0).toLocaleUpperCase("pt-BR") + stripped.slice(1);
}

export function claimsIndustrialHandoffEffect(messages: readonly string[]): boolean {
  return messages.some((text) => isPrematureIndustrialHandoffBubble(String(text || "")));
}
export interface IndustrialHandoffResult {
  status: IndustrialHandoffStatus;
  operator: HandoffOperator | null;
  deal: HandoffDeal | null;
}

/** Orquestração testável sem banco/provedor. O adaptador confirma a atribuição persistida. */
export async function executeIndustrialHandoff(params: {
  route: IndustrialRoute;
  data: CollectedFields;
  allocate: (
    funnel: string,
    beforeTransfer: (operator: HandoffOperator) => Promise<void>,
  ) => Promise<HandoffOperator | null>;
  ensureDeal: (operator: HandoffOperator) => Promise<HandoffDeal>;
  verifyAssignment: (operator: HandoffOperator) => Promise<boolean>;
}): Promise<IndustrialHandoffResult> {
  const readiness = assessIndustrialReadiness(params.route, params.data);
  const empty = { operator: null, deal: null };
  if (!readiness.ready) return { status: "collecting", ...empty };
  if (readiness.action === "inform") return { status: "resolved", ...empty };
  // Pedidos de humano e classificação incerta chegam à equipe de revisão, sem negociação fictícia.
  const funnel =
    readiness.action === "review"
      ? INDUSTRIAL_REVIEW_FUNNEL
      : params.route.targetFunnel && normalizeIndustrialFunnel(params.route.targetFunnel);
  if (!funnel) return { status: "waiting_for_team", ...empty };
  let deal: HandoffDeal | null = null;
  let beforeTransferFailed = false;
  try {
    const operator = await params.allocate(funnel, async (chosen) => {
      if (!readiness.createsDeal) return;
      try {
        deal = await params.ensureDeal(chosen);
        if (!deal?.dealId) throw new Error("Negociação não confirmada");
      } catch (error) {
        beforeTransferFailed = true;
        throw error;
      }
    });
    if (beforeTransferFailed) return { status: "handoff_failed", operator: null, deal };
    if (!operator)
      return { status: deal ? "handoff_failed" : "waiting_for_team", operator: null, deal };
    if ((readiness.createsDeal && !deal) || !(await params.verifyAssignment(operator)))
      return { status: "handoff_failed", operator: null, deal };
    return { status: "transferred", operator, deal };
  } catch {
    return { status: "handoff_failed", operator: null, deal };
  }
}

export function industrialHandoffOutcome(
  status: IndustrialHandoffStatus,
): "completed" | "transferred" | "in_progress" {
  return status === "resolved"
    ? "completed"
    : status === "transferred"
      ? "transferred"
      : "in_progress";
}

export function industrialHandoffMessage(
  status: IndustrialHandoffStatus,
  operatorName?: string,
  options?: {
    isOperatorAbsent?: boolean;
    offHoursNotice?: string | null;
    isHumanRequestOnly?: boolean;
    isDirectOperatorTransfer?: boolean;
  },
): string | null {
  if (status === "awaiting_approval") {
    // Em awaiting_approval não há bolha fixa do servidor; o próprio Fagner entrega
    // a conclusão contextualizada (e o fallback só entra se o LLM não devolver nada aproveitável).
    return null;
  }
  if (status === "transferred" && operatorName) {
    const base = options?.isOperatorAbsent
      ? `Seu atendimento foi encaminhado para ${operatorName}. No momento está ausente, mas em breve entrará em contato com você por aqui.`
      : options?.isDirectOperatorTransfer
        ? `Claro! Já estou te transferindo para ${operatorName}, que dará continuidade ao seu atendimento por aqui.`
        : `Seu atendimento foi encaminhado para ${operatorName}. A equipe dará continuidade por aqui.`;
    const offHours = options?.offHoursNotice?.trim();
    return offHours ? `${base}\n\n${offHours}` : base;
  }
  if (status === "waiting_for_team")
    return "Seu atendimento está aguardando a equipe responsável. Assim que houver um atendente disponível, ele poderá dar continuidade por aqui.";
  if (status === "handoff_failed")
    return "Ainda não consegui concluir o encaminhamento para a equipe. Seu atendimento continua pendente de encaminhamento.";
  return null;
}

export interface EvaluatedIndustrialClientMessages {
  messages: string[];
  needsGeminiRewrite: boolean;
  rewriteMode:
    | "collecting_missing_fields"
    | "awaiting_approval"
    | "resolved"
    | "direct_operator_transferred"
    | null;
  missingFields: import("./industrial-policy.ts").RequiredField[];
  safeBubbles: string[];
}

/**
 * Avalia e sanitiza as mensagens geradas pelo Gemini sem NUNCA injetar perguntas prontas/robóticas
 * hardcoded durante a coleta.
 * Quando uma promessa prematura de encaminhamento é removida durante `collecting` ou quando não
 * sobra nenhum balão aproveitável em `awaiting_approval`/`resolved` (ou quando falta o aviso real
 * de expediente/feriado fora do horário), sinaliza `needsGeminiRewrite: true` para que o Gemini
 * redija a continuação 100% contextualizada.
 */
export function evaluateIndustrialClientMessages(params: {
  result: IndustrialHandoffResult;
  route: IndustrialRoute;
  data: CollectedFields;
  messages: string[];
  knownCompanyToConfirm?: string | null;
  businessHours?: IndustrialBusinessHoursEvaluation | null;
  clientRescheduled?: boolean;
}): EvaluatedIndustrialClientMessages {
  const isOperatorAbsent = Boolean(
    params.result.operator?.isAbsent || params.route.targetOperator?.isAbsent,
  );
  const isDirectOperatorTransfer = params.route.reason === "direct_operator_requested";
  const isHumanRequestOnly =
    params.route.reason === "human_requested" ||
    params.route.reason === "direct_operator_requested" ||
    params.route.reason === "direct_operator_not_found";
  const confirmation = industrialHandoffMessage(
    params.result.status,
    params.result.operator?.name,
    { isOperatorAbsent, isHumanRequestOnly, isDirectOperatorTransfer },
  );
  const claimsEffectPattern = INDUSTRIAL_CLAIMS_EFFECT_PATTERN;

  if (params.result.status === "resolved") {
    const subflow = params.route.subflow;
    const isCurriculum = subflow === "5B_CURRICULO";
    const isSuppliers = subflow === "5C_COMPRAS";
    const curriculumHost = INDUSTRIAL_CURRICULUM_SOLIDES_URL.replace(/^https?:\/\//i, "").toLowerCase();
    const suppliersEmail = INDUSTRIAL_SUPPLIERS_EMAIL.toLowerCase();
    const hasCurriculumLink = (text: string) => text.toLowerCase().includes(curriculumHost);
    const hasSuppliersEmail = (text: string) => text.toLowerCase().includes(suppliersEmail);

    const cleaned = params.messages
      .map((m) => String(m || "").trim())
      .filter((m) => {
        if (!m) return false;
        if (
          m === INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE ||
          m === INDUSTRIAL_HUMAN_REQUEST_APPROVAL_MESSAGE ||
          INDUSTRIAL_FALSE_SYSTEM_CLAIM_PATTERN.test(m)
        ) {
          return false;
        }
        // Em 5B_CURRICULO / 5C_COMPRAS, balões que entregam o link oficial do Sólides ou o e-mail
        // adm@tecfag.com.br podem mencionar naturalmente "nosso RH pode analisar e dar retorno" ou
        // "setor que cuida disso" — não podem ser bloqueados pelo filtro de promessa de handoff!
        if (isCurriculum && hasCurriculumLink(m)) {
          return !/\b(?:estou\s+te\s+transferindo|vou\s+te\s+transferir|j[aá]\s+encaminhei\s+por\s+aqui)\b/i.test(
            m,
          );
        }
        if (isSuppliers && hasSuppliersEmail(m)) {
          return !/\b(?:estou\s+te\s+transferindo|vou\s+te\s+transferir|j[aá]\s+encaminhei\s+por\s+aqui)\b/i.test(
            m,
          );
        }
        return !claimsEffectPattern.test(m);
      });

    const joinedCleaned = cleaned.join("\n");
    const missingRequiredInformativeTarget =
      (isCurriculum && !hasCurriculumLink(joinedCleaned)) ||
      (isSuppliers && !hasSuppliersEmail(joinedCleaned));

    const needsRewrite = cleaned.length === 0 || missingRequiredInformativeTarget;

    return {
      messages: cleaned,
      needsGeminiRewrite: needsRewrite,
      rewriteMode: needsRewrite ? "resolved" : null,
      missingFields: [],
      safeBubbles: cleaned,
    };
  }

  if (params.result.status === "awaiting_approval") {
    // Preserva integralmente as mensagens naturais e contextualizadas do Fagner (ex.: explicação
    // técnica + aviso natural de encaminhamento ao setor + aviso de expediente fora do horário),
    // SEM anexar nenhuma bolha genérica fixa.
    // Remove apenas perguntas pendentes (que deixariam o cliente no vácuo na pausa de aprovação)
    // e falsas alegações de efeitos internos/transferência nominal ou a antiga frase banida.
    const cleanedReplies = params.messages
      .map((m) => String(m || "").trim())
      .filter(
        (m) =>
          Boolean(m) &&
          !isPendingTriageQuestionBubble(m) &&
          !INDUSTRIAL_FALSE_SYSTEM_CLAIM_PATTERN.test(m),
      )
      .slice(0, 4);
    const coversBusinessHours = messagesCoverIndustrialBusinessHoursNotice(
      cleanedReplies,
      params.businessHours,
    );
    const needsRewrite = cleanedReplies.length === 0 || !coversBusinessHours;
    return {
      messages: cleanedReplies,
      needsGeminiRewrite: needsRewrite,
      rewriteMode: needsRewrite ? "awaiting_approval" : null,
      missingFields: [],
      safeBubbles: cleanedReplies,
    };
  }

  if (
    params.result.status === "transferred" &&
    params.result.operator?.name &&
    params.businessHours?.enabled &&
    params.businessHours.status !== "open"
  ) {
    // Fora do expediente ou na janela de transição: 100% redigido pelo Gemini (sem balão fixo
    // colado pelo servidor). Se o próprio Gemini já citou o consultor e explicou o expediente
    // sem contradição, preserva; caso contrário solicita reescrita contextual via Gemini.
    const operatorFirstName = params.result.operator.name.trim().split(/\s+/)[0] || "";
    const cleanedDirect = params.messages
      .map((m) => String(m || "").trim())
      .filter(
        (m) =>
          Boolean(m) &&
          !isPendingTriageQuestionBubble(m) &&
          !/(?:j[aá]\s+(?:criei|vinculei)\b|(?:card|negocia[cç][aã]o)\s+(?:j[aá]\s+)?(?:criad[oa]|vinculad[oa])|j[aá]\s+coletei\s+tudo|estou\s+validando)/i.test(
            m,
          ),
      )
      .slice(0, 4);
    const mentionsOperator =
      Boolean(operatorFirstName) &&
      cleanedDirect.some((m) =>
        m.toLocaleLowerCase("pt-BR").includes(operatorFirstName.toLocaleLowerCase("pt-BR")),
      );
    const coversBusinessHours = messagesCoverIndustrialBusinessHoursNotice(
      cleanedDirect,
      params.businessHours,
    );
    const needsRewrite = cleanedDirect.length === 0 || !mentionsOperator || !coversBusinessHours;
    return {
      messages: cleanedDirect,
      needsGeminiRewrite: needsRewrite,
      rewriteMode: needsRewrite ? "direct_operator_transferred" : null,
      missingFields: [],
      safeBubbles: cleanedDirect,
    };
  }

  if (confirmation) {
    if (params.result.status === "transferred") {
      // Preserva balões informativos gerados pelo modelo para responder perguntas finais do cliente
      // (ex.: cidade da empresa, origem da máquina, garantia), descartando promessas falsas de transferência,
      // agradecimentos/despedidas redundantes (fim da despedida dupla) ou novas perguntas de coleta.
      const informativeReplies = params.messages
        .map((m) => String(m || "").trim())
        .filter(
          (m) =>
            Boolean(m) &&
            !isPendingTriageQuestionBubble(m) &&
            !isRedundantIndustrialClosingMessage(m),
        )
        .slice(0, 3);
      if (informativeReplies.length > 0) {
        return {
          messages: [...informativeReplies, confirmation],
          needsGeminiRewrite: false,
          rewriteMode: null,
          missingFields: [],
          safeBubbles: informativeReplies,
        };
      }
    }
    return {
      messages: [confirmation],
      needsGeminiRewrite: false,
      rewriteMode: null,
      missingFields: [],
      safeBubbles: [],
    };
  }

  const claimsSuccess = claimsIndustrialHandoffEffect(params.messages);
  if (!claimsSuccess) {
    const cleanMessages = params.messages.map((m) => String(m || "").trim()).filter(Boolean);
    const missingFields = assessIndustrialReadiness(params.route, params.data).missing;
    const hasQuestion = hasPendingTriageQuestion(cleanMessages);
    if (
      cleanMessages.length > 0 &&
      (startsWithOrphanAnaphoricConnector(cleanMessages[0]) ||
        (!hasQuestion && !params.clientRescheduled && missingFields.length > 0))
    ) {
      return {
        messages: cleanMessages,
        needsGeminiRewrite: true,
        rewriteMode: "collecting_missing_fields",
        missingFields,
        safeBubbles: cleanMessages,
      };
    }
    return {
      messages: params.messages,
      needsGeminiRewrite: false,
      rewriteMode: null,
      missingFields: [],
      safeBubbles: params.messages,
    };
  }

  const missingFields = assessIndustrialReadiness(params.route, params.data).missing;

  // Filtragem cirúrgica por balão: remove APENAS o(s) balão(ões) com promessa prematura de
  // encaminhamento, preservando integralmente empatia, respostas técnicas e perguntas contextuais
  // já geradas pela IA. NUNCA cola pergunta pronta/robótica hardcoded!
  const safeBubbles = params.messages
    .map((m) => String(m || "").trim())
    .filter((m) => Boolean(m) && !isPrematureIndustrialHandoffBubble(m));

  const alreadyAsksQuestion = hasPendingTriageQuestion(safeBubbles);
  const firstBubbleIsOrphan =
    safeBubbles.length > 0 && startsWithOrphanAnaphoricConnector(safeBubbles[0]);
  if (safeBubbles.length > 0 && alreadyAsksQuestion && !firstBubbleIsOrphan) {
    return {
      messages: safeBubbles,
      needsGeminiRewrite: false,
      rewriteMode: null,
      missingFields,
      safeBubbles,
    };
  }

  return {
    messages: safeBubbles,
    needsGeminiRewrite: true,
    rewriteMode: "collecting_missing_fields",
    missingFields,
    safeBubbles,
  };
}

/**
 * Versão síncrona pura (sem chamadas externas): devolve apenas balões seguros produzidos pela IA,
 * sem nunca injetar perguntas prontas hardcoded durante a coleta.
 */
export function industrialClientMessages(params: {
  result: IndustrialHandoffResult;
  route: IndustrialRoute;
  data: CollectedFields;
  messages: string[];
  knownCompanyToConfirm?: string | null;
}): string[] {
  const evaluated = evaluateIndustrialClientMessages(params);
  if (
    evaluated.messages.length > 0 &&
    startsWithOrphanAnaphoricConnector(evaluated.messages[0])
  ) {
    const [first, ...rest] = evaluated.messages;
    return [stripLeadingOrphanAnaphoricConnector(first), ...rest];
  }
  return evaluated.messages;
}
