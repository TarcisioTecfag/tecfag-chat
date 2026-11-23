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

/**
 * Detecta promessas/anúncios de encaminhamento, transferência ou acionamento de equipe
 * que o modelo NÃO pode emitir enquanto a triagem ainda estiver em coleta (`collecting`).
 */
export const INDUSTRIAL_CLAIMS_EFFECT_PATTERN =
  /(?:j[aá] (?:criei|vinculei|transferi|encaminhei|direcionei|redirecionei|acionei|passei|enviei)|(?:card|negocia[cç][aã]o|atendimento|solicita[cç][aã]o|contato|pedido|caso|demanda).{0,45}(?:criad[oa]|vinculad[oa]|transferid[oa]|encaminhad[oa]|direcionad[oa]|redirecionad[oa]|j[aá] est[aá] com|foi direcionad[oa]|foi encaminhad[oa]|foi transferid[oa]|foi enviad[oa])|(?:estou|te|vou) (?:te )?(?:transferindo|transferir|encaminhando|encaminhar|direcionando|direcionar|redirecionando|redirecionar|acionando|acionar|passando|passar)|(?:equipe|especialista|consultor(?:a|es)?|setor|time|p[oó]s[\s-]?venda|financeiro|suporte|pe[cç]as).{0,55}(?:j[aá] (?:foi acionad[oa]|recebeu|est[aá] com|dar[aá] andamento)|entrar[aá] em contato|retornar[aá](?: o contato)?|assumir[aá]|dar[aá] continuidade|dar[aá] prioridade|vai entrar em contato)|j[aá] coletei tudo|estou validando)/i;

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
  options?: { isOperatorAbsent?: boolean; offHoursNotice?: string | null },
): string | null {
  if (status === "awaiting_approval") {
    return INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE;
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
  const confirmation = industrialHandoffMessage(
    params.result.status,
    params.result.operator?.name,
    { isOperatorAbsent },
  );
  const claimsEffectPattern = INDUSTRIAL_CLAIMS_EFFECT_PATTERN;
  if (confirmation) {
    if (params.result.status === "awaiting_approval" || params.result.status === "transferred") {
      // Preserva balões informativos gerados pelo modelo para responder perguntas finais do cliente
      // (ex.: cidade da empresa, origem da máquina, garantia), descartando promessas falsas de transferência ou novas perguntas de coleta.
      const informativeReplies = params.messages
        .map((m) => String(m || "").trim())
        .filter((m) => Boolean(m) && !m.includes("?") && !claimsEffectPattern.test(m))
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
