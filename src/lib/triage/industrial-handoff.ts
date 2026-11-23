import {
  assessIndustrialReadiness,
  INDUSTRIAL_REVIEW_FUNNEL,
  normalizeIndustrialFunnel,
  type CollectedFields,
  type IndustrialRoute,
} from "./industrial-policy.ts";

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

export const INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE =
  "Perfeito, já coletei tudo! Estou validando e já te encaminho para o responsável.";

export const INDUSTRIAL_HUMAN_REQUEST_APPROVAL_MESSAGE =
  "Certo! Já estou validando seu atendimento para encaminhar ao responsável.";

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
  /(?:j[aá] (?:criei|vinculei|transferi|encaminhei|direcionei|redirecionei|acionei|passei|enviei)|(?:card|negocia[cç][aã]o|atendimento|solicita[cç][aã]o|contato|pedido|caso|demanda).{0,55}(?:criad[oa]|vinculad[oa]|transferid[oa]|encaminhad[oa]|direcionad[oa]|redirecionad[oa]|j[aá] est[aá] com|foi direcionad[oa]|foi encaminhad[oa]|foi transferid[oa]|foi enviad[oa]|(?:ser[aá]|vai ser)\s+(?:verificad[oa]|analisad[oa]|avaliad[oa]|atendid[oa]|tratad[oa]|acompanhad[oa])\s+pel[oa])|(?:estou|te|vou) (?:te )?(?:transferindo|transferir|encaminhando|encaminhar|direcionando|direcionar|redirecionando|redirecionar|acionando|acionar|passando|passar)|vou\s+(?:solicitar|pedir|passar|enviar|encaminhar)\b.{0,70}\b(?:para|a|à)\s+(?:a\s+|o\s+)?(?:noss[oa]\s+)?(?:equipe|especialista|consultor(?:a|es)?|setor|time|p[oó]s[\s-]?venda|financeiro|suporte|pe[cç]as)|(?:equipe|especialista|consultor(?:a|es)?|setor|time|p[oó]s[\s-]?venda|financeiro|suporte|pe[cç]as).{0,65}(?:j[aá] (?:foi acionad[oa]|recebeu|est[aá] com|dar[aá] andamento|consegue\s+(?:preparar|elaborar|montar|verificar|analisar|avaliar|apresentar|enviar|dar)|ir[aá]|vai)|(?:ir[aá]|vai|pode|poder[aá])\s+(?:assumir|entrar em contato|retornar|dar andamento|dar continuidade|atender|verificar|analisar|avaliar|preparar|elaborar|apresentar|detalhar|cotar|cuidar|alinhar|enviar)|entrar[aá] em contato|retornar[aá](?: o contato)?|assumir[aá]|dar[aá] continuidade|dar[aá] prioridade|avaliar[aá]|analisar[aá]|verificar[aá]|preparar[aá]|elaborar[aá]|apresentar[aá]|detalhar[aá]|cotar[aá]|cuidar[aá])|\bele\s+poder[aá]\s+(?:detalhar|apresentar|alinhar|verificar|analisar|elaborar|preparar)|j[aá] coletei tudo|estou validando|j[aá]\s+s[aã]o\s+o\s+ponto\s+de\s+partida)/i;

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

export function claimsIndustrialHandoffEffect(messages: readonly string[]): boolean {
  return messages.some((text) => INDUSTRIAL_CLAIMS_EFFECT_PATTERN.test(String(text || "")));
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
  options?: { isOperatorAbsent?: boolean; offHoursNotice?: string | null; isHumanRequestOnly?: boolean },
): string | null {
  if (status === "awaiting_approval") {
    return options?.isHumanRequestOnly
      ? INDUSTRIAL_HUMAN_REQUEST_APPROVAL_MESSAGE
      : INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE;
  }
  if (status === "transferred" && operatorName) {
    const base = options?.isOperatorAbsent
      ? `Seu atendimento foi encaminhado para ${operatorName}. No momento está ausente, mas em breve entrará em contato com você por aqui.`
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

/** Evita anunciar efeitos que só o servidor pode confirmar, inclusive com coleta incompleta. */
export function industrialClientMessages(params: {
  result: IndustrialHandoffResult;
  route: IndustrialRoute;
  data: CollectedFields;
  messages: string[];
}): string[] {
  const isOperatorAbsent = Boolean(
    params.result.operator?.isAbsent || params.route.targetOperator?.isAbsent,
  );
  const isHumanRequestOnly =
    params.route.reason === "human_requested" ||
    params.route.reason === "direct_operator_requested";
  const confirmation = industrialHandoffMessage(
    params.result.status,
    params.result.operator?.name,
    { isOperatorAbsent, isHumanRequestOnly },
  );
  const claimsEffectPattern = INDUSTRIAL_CLAIMS_EFFECT_PATTERN;
  if (params.result.status === "resolved") {
    const cleaned = params.messages
      .map((m) => String(m || "").trim())
      .filter(
        (m) =>
          Boolean(m) &&
          m !== INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE &&
          m !== INDUSTRIAL_HUMAN_REQUEST_APPROVAL_MESSAGE &&
          !claimsEffectPattern.test(m),
      );
    return cleaned.length > 0
      ? cleaned
      : ["Entendido! Agradeço o retorno. Caso precise de algo no futuro, continuamos à disposição."];
  }
  if (confirmation) {
    if (params.result.status === "awaiting_approval" || params.result.status === "transferred") {
      // Preserva balões informativos gerados pelo modelo para responder perguntas finais do cliente
      // (ex.: cidade da empresa, origem da máquina, garantia), descartando promessas falsas de transferência,
      // agradecimentos/despedidas redundantes (fim da despedida dupla) ou novas perguntas de coleta.
      const informativeReplies = params.messages
        .map((m) => String(m || "").trim())
        .filter(
          (m) =>
            Boolean(m) &&
            !m.includes("?") &&
            !isRedundantIndustrialClosingMessage(m),
        )
        .slice(0, 3);
      if (informativeReplies.length > 0) {
        return [...informativeReplies, confirmation];
      }
    }
    return [confirmation];
  }
  const claimsSuccess = claimsIndustrialHandoffEffect(params.messages);
  if (!claimsSuccess) return params.messages;
  const next = assessIndustrialReadiness(params.route, params.data).missing[0];
  const questions = {
    name: "Pode me informar seu nome?",
    document: "Pode me informar o CNPJ ou CPF para localizar o cadastro?",
    request: "Pode me contar qual é sua necessidade?",
    application: "O que você produz ou pretende embalar?",
    production: "Qual é o volume aproximado da sua produção?",
  };
  return [
    next
      ? questions[next]
      : "As informações do atendimento estão registradas. A equipe responsável poderá dar continuidade por aqui.",
  ];
}
