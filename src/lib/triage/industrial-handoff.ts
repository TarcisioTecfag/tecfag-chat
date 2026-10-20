import {
  assessIndustrialReadiness,
  type CollectedFields,
  type IndustrialRoute,
} from "./industrial-policy.ts";

export interface HandoffOperator {
  id: string;
  name: string;
}
export interface HandoffDeal {
  dealId: string;
  dealTitle: string;
  action: "reused_within_3h" | "created_new";
  funnelId: string;
  stageId: string;
}
export type IndustrialHandoffStatus =
  "collecting" | "resolved" | "waiting_for_team" | "handoff_failed" | "transferred";
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
  const funnel = readiness.action === "review" ? "Atendimento Geral" : params.route.targetFunnel;
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
): string | null {
  if (status === "transferred" && operatorName)
    return `Seu atendimento foi encaminhado para ${operatorName}. A equipe dará continuidade por aqui.`;
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
  const confirmation = industrialHandoffMessage(params.result.status, params.result.operator?.name);
  if (confirmation) return [confirmation];
  const claimsSuccess = params.messages.some((text) =>
    /(?:j[aá] (?:criei|vinculei|transferi)|(?:card|negocia[cç][aã]o|atendimento).{0,40}(?:criad[oa]|vinculad[oa]|transferid[oa]|encaminhad[oa])|(?:estou|te) transferindo)/i.test(
      text,
    ),
  );
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
