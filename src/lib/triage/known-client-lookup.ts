/**
 * Lógica pura (sem IO/banco) para identificação, confirmação de empresa
 * ("Sua empresa é a 'xxx', certo?") e vínculo de clientes recorrentes na triagem.
 */
import {
  collectedValue,
  INDUSTRIAL_ROUTES,
  isValidTriageDocument,
  normalizeTriageText,
  resolveEffectiveIndustrialSubflow,
  type CollectedFields,
  type RequiredField,
} from "./industrial-policy.ts";

export interface KnownClientProfile {
  companyName: string;
  document?: string | null;
  contactName?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  lastSector?: string | null;
  lastInterest?: string | null;
  source: "crm_account" | "contact_cnpj" | "contact_company" | "previous_triage";
}

export function isValidKnownCompanyName(value?: string | null): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  const normalized = normalizeTriageText(trimmed);
  if (!normalized) return false;
  if (
    /^(?:aguardando.*|nao informado|nao informada|pessoa fisica.*|vinculado ao cadastro|mantem.*|n\/a|nenhum|nenhuma|cliente|visitante|sem empresa|particular|autonomo)$/i.test(
      normalized,
    )
  ) {
    return false;
  }
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length >= 8 && digitsOnly.length === trimmed.replace(/[\s.()/+-]/g, "").length) {
    return false;
  }
  return true;
}

export function isValidKnownContactName(value?: string | null): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  const normalized = normalizeTriageText(trimmed);
  if (
    !normalized ||
    /^(?:cliente|visitante|lead|contato|whatsapp|sem nome|nao informado|aguardando.*)$/i.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/^\+?\d[\d\s().-]{6,}$/.test(trimmed)) return false;
  return true;
}

export function didBotAskCompanyConfirmation(
  botMessages: readonly string[],
  companyName: string,
): boolean {
  if (!Array.isArray(botMessages) || botMessages.length === 0) return false;
  const normCompany = normalizeTriageText(companyName);
  const companyTokens = normCompany
    .split(" ")
    .filter((token) => token.length >= 3 && !/^(?:ltda|eireli|me|epp|s\/a|sa|comercio|industria)$/.test(token));
  const primaryToken = companyTokens[0] || normCompany;

  return botMessages.some((msg) => {
    const normMsg = normalizeTriageText(msg || "");
    if (!normMsg) return false;
    const mentionsCompanyPhrase =
      /\b(?:sua empresa e a|continua sendo da empresa|voce fala da empresa|ainda e da empresa|empresa cadastrada e|vinculad[oa] a empresa|fala pela empresa)\b/.test(
        normMsg,
      );
    const mentionsCompanyName = Boolean(primaryToken && normMsg.includes(primaryToken));
    const hasConfirmationCue =
      (msg || "").includes("?") ||
      /\b(?:certo|correto|isso mesmo|confirma|pode confirmar)\b/.test(normMsg);
    return (mentionsCompanyPhrase || mentionsCompanyName) && hasConfirmationCue;
  });
}

export function evaluateKnownCompanyConfirmation(params: {
  clientText: string;
  recentBotMessages?: readonly string[];
  knownClient: KnownClientProfile | null | undefined;
  currentData?: CollectedFields | null;
}): "confirmed" | "rejected" | "pending" {
  const { knownClient, currentData } = params;
  if (!knownClient || !isValidKnownCompanyName(knownClient.companyName)) {
    return "pending";
  }

  if (
    currentData?._KNOWN_COMPANY_CONFIRMED?.status === "filled" &&
    Boolean(collectedValue(currentData, "EMPRESA"))
  ) {
    return "confirmed";
  }

  const text = normalizeTriageText(params.clientText || "");
  if (!text) return "pending";

  const botAsked = didBotAskCompanyConfirmation(
    params.recentBotMessages || [],
    knownClient.companyName,
  );

  const explicitCompanyRejection =
    /\b(?:nao e essa empresa|outra empresa|mudou de empresa|mudei de empresa|nao sou mais da|nao trabalho mais na|empresa errada)\b/.test(
      text,
    );
  if (explicitCompanyRejection) return "rejected";

  if (botAsked) {
    const startsWithNo =
      /^(?:nao|não|negativo|errado|incorreto|opa nao|na verdade nao)\b/.test(text) &&
      !/\b(?:nao tenho duvida|nao precisa mudar)\b/.test(text);
    if (startsWithNo) return "rejected";

    const isAffirmative =
      /^(?:sim|isso|isso mesmo|certo|correto|exato|exatamente|positivo|confirmo|confirmado|essa mesma|sou sim|e sim|é sim|uhum|aham|ok|perfeito|pode prosseguir|prossegue|claro|com certeza)\b/.test(
        text,
      ) ||
      /\b(?:sim senhor|isso mesmo|esta correto|esta certo|e essa mesma|sou dessa empresa|pode seguir|pode prosseguir)\b/.test(
        text,
      );
    if (isAffirmative) return "confirmed";
  }

  const normCompany = normalizeTriageText(knownClient.companyName);
  const firstToken = normCompany.split(" ").find((w) => w.length >= 3);
  if (
    firstToken &&
    text.includes(firstToken) &&
    /\b(?:sim|isso|certo|correto|sou da|falo da|trabalho na)\b/.test(text) &&
    !/\b(?:nao sou|nao e)\b/.test(text)
  ) {
    return "confirmed";
  }

  return "pending";
}

export function applyKnownClientConfirmationToData(
  data: CollectedFields,
  knownClient: KnownClientProfile,
  options?: { fillNameIfEmpty?: boolean },
): CollectedFields {
  const next: CollectedFields = { ...data };
  if (isValidKnownCompanyName(knownClient.companyName)) {
    next.EMPRESA = {
      value: knownClient.companyName.trim(),
      status: "filled",
    };
    next._KNOWN_COMPANY_CONFIRMED = {
      value: "true",
      status: "filled",
    };
  }

  const existingDoc = collectedValue(next, "CNPJ OU CPF", "CNPJ", "CPF");
  if (!existingDoc && knownClient.document && knownClient.document.trim()) {
    next["CNPJ OU CPF"] = {
      value: knownClient.document.trim(),
      status: "filled",
    };
  }

  if (options?.fillNameIfEmpty !== false) {
    const existingName = collectedValue(next, "NOME COMPLETO");
    if (!existingName && isValidKnownContactName(knownClient.contactName)) {
      next["NOME COMPLETO"] = {
        value: knownClient.contactName!.trim(),
        status: "filled",
      };
    }
  }

  return next;
}

export function buildKnownClientPromptDirective(params: {
  knownClient: KnownClientProfile | null | undefined;
  confirmationStatus: "confirmed" | "rejected" | "pending";
  currentData: CollectedFields;
  subflow?: string | null;
  funnelStage?: string | null;
  targetFunnel?: string | null;
}): string {
  const { knownClient, confirmationStatus, currentData } = params;
  if (!knownClient || !isValidKnownCompanyName(knownClient.companyName)) {
    return "";
  }

  const companyName = knownClient.companyName.trim();
  const docInfo = knownClient.document ? ` (CNPJ/CPF registrado: ${knownClient.document})` : "";
  const prevContext =
    knownClient.lastSector || knownClient.lastInterest
      ? ` Último atendimento registrado: ${[knownClient.lastSector, knownClient.lastInterest].filter(Boolean).join(" — ")}.`
      : "";

  if (confirmationStatus === "rejected") {
    return `\n\n[SISTEMA - VÍNCULO DE EMPRESA ANTERIOR RECUSADO PELO CLIENTE]: O telefone tinha vínculo anterior com "${companyName}", mas o cliente informou que NÃO fala por essa empresa. Solicite o CNPJ ou CPF atual caso o setor exija documento.`;
  }

  const alreadyConfirmed =
    confirmationStatus === "confirmed" ||
    currentData._KNOWN_COMPANY_CONFIRMED?.status === "filled" ||
    isValidTriageDocument(collectedValue(currentData, "CNPJ OU CPF", "CNPJ", "CPF"));

  if (alreadyConfirmed) {
    return `\n\n[SISTEMA - EMPRESA DO CLIENTE JÁ CONFIRMADA E VINCULADA]: Empresa confirmada: "${companyName}"${docInfo}.${prevContext}
REGRA ABSOLUTA: NÃO pergunte o CNPJ/CPF nem o nome da empresa novamente! Considere os campos "EMPRESA" ("${companyName}") e "CNPJ OU CPF" ("${knownClient.document || "Vinculado ao cadastro"}") como 100% preenchidos e validados. Prossiga imediatamente apenas com as perguntas restantes do setor (ou conclua a triagem se os demais campos do setor já foram respondidos).`;
  }

  const effectiveSubflow = resolveEffectiveIndustrialSubflow({
    subflow: params.subflow,
    funnelStage: params.funnelStage,
    targetFunnel: params.targetFunnel,
    collectedData: currentData,
    company: companyName,
    document: knownClient.document,
  });
  const policyFields = effectiveSubflow
    ? new Set<RequiredField>(INDUSTRIAL_ROUTES[effectiveSubflow].fields as readonly RequiredField[])
    : null;
  const requiresDocument = !policyFields || policyFields.has("document");

  if (!requiresDocument) {
    return `\n\n[SISTEMA - CLIENTE JÁ CADASTRADO NA BASE]: Este número pertence a um cliente recorrente da empresa "${companyName}"${docInfo}.${prevContext} Como o setor atual não exige CNPJ, não peça CNPJ; mantenha a cordialidade e colete apenas nome e solicitação do setor.`;
  }

  return `\n\n[SISTEMA - CLIENTE JÁ CADASTRADO NA BASE (NÃO PEDIR CNPJ)]: Este número de telefone já existe em nosso banco de dados vinculado à empresa "${companyName}"${docInfo}.${prevContext}
REGRA OBRIGATÓRIA DE CONFIRMAÇÃO RÁPIDA:
1. Você NÃO precisa pedir o CNPJ para este cliente!
2. Em vez de pedir o CNPJ, apenas confirme a empresa dizendo exatamente: "Sua empresa é a ${companyName}, certo?"
3. Assim que o cliente responder "sim" (ou confirmar), prossiga imediatamente com o atendimento sem pedir CNPJ!`;
}
