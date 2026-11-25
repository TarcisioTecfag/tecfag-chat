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

const INTERNAL_DEAL_TITLE_PREFIX_PATTERN =
  /^(?:fagner|valentina|sdr|lead|triagem|atendimento)\s*[|\-–—:]\s*/i;

const CORPORATE_NAME_MARKER_PATTERN =
  /\b(?:ltda|eireli|me|epp|s\/a|s\.a\.|sa|industria|comercio|distribuidora|alimentos|embalagens|produtos|servicos|solucoes|equipamentos|maquinas|metalurgica|plasticos|quimica|farmaceutica|cosmeticos|frigorifico|laticinios|supermercado|atacadista|atacado|importacao|exportacao|engenharia|tecnologia|automacao|grupo|holding|coop|cooperativa|fazenda|agro|agropecuaria|padaria|panificadora|confeitaria|sorveteria|acaiteria|lavanderia|hotel|restaurante|clinica|hospital|laboratorio|oficina|assistencia)\b/i;

export function isValidKnownCompanyName(value?: string | null): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  // Nunca vazar prefixos internos de título de card ("FAGNER | ...", "VALENTINA | ...") como razão social.
  if (INTERNAL_DEAL_TITLE_PREFIX_PATTERN.test(trimmed)) return false;
  const normalized = normalizeTriageText(trimmed);
  if (!normalized) return false;
  if (
    /^(?:aguardando.*|nao informado|nao informada|pessoa fisica.*|vinculado ao cadastro|mantem.*|n\/a|nenhum|nenhuma|cliente|visitante|sem empresa|particular|autonomo|nao tenho|formulario contato|lead sem cadastro)$/i.test(
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

export function looksLikePersonalNameUsedAsCompany(
  companyName?: string | null,
  contactName?: string | null,
): boolean {
  if (!companyName || !contactName) return false;
  const normCompany = normalizeTriageText(companyName);
  const normContact = normalizeTriageText(contactName);
  if (!normCompany || !normContact) return false;
  if (CORPORATE_NAME_MARKER_PATTERN.test(normCompany)) return false;
  if (/^\d{2}\.\d{3}\.\d{3}\b/.test(companyName.trim())) return false; // MEI com CNPJ no nome
  return normCompany === normContact;
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
      /^(?:sim|isso|isso mesmo|certo|correto|exato|exatamente|positivo|confirmo|confirmado|essa mesma|esse mesmo|aquela mesma|aquele mesmo|sou sim|e sim|é sim|uhum|aham|ok|perfeito|pode prosseguir|prossegue|claro|com certeza)\b/.test(
        text,
      ) ||
      /\b(?:sim senhor|isso mesmo|esta correto|esta certo|e essa mesma|e esse mesmo|e aquela mesma|e aquele mesmo|e a mesma|e o mesmo|sou dessa empresa|pode seguir|pode prosseguir)\b/.test(
        text,
      );
    if (isAffirmative) return "confirmed";
  }

  const normCompany = normalizeTriageText(knownClient.companyName);
  const companyStopwords =
    /^(?:ltda|eireli|me|epp|s\/a|sa|comercio|industria|servicos|produtos|distribuidora|solucoes|grupo|holding|de|da|do|das|dos|e)$/;
  const significantTokens = normCompany
    .split(" ")
    .filter((w) => w.length >= 3 && !companyStopwords.test(w))
    .slice(0, 2);
  const escapeRegexToken = (token: string) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentionsKnownToken = significantTokens.some((tok) =>
    new RegExp(`\\b${escapeRegexToken(tok)}\\b`).test(text),
  );
  const hasCompanyConfirmCue =
    /\b(?:sim|isso|certo|correto|sou d[aoe]|falo d[aoe]|trabalho n[ao]|somos d[ao]|represento [ao]|aqui e d[ao]|minha empresa|nossa empresa|meu cnpj|nosso cnpj|ja tem meu cnpj|esse mesmo|essa mesma|aquele mesmo|aquela mesma|a mesma|o mesmo)\b/.test(
      text,
    ) ||
    (significantTokens.length > 0 &&
      new RegExp(`\\be\\s+(?:a\\s+|o\\s+)?${escapeRegexToken(significantTokens[0])}\\b`).test(
        text,
      ));
  if (
    mentionsKnownToken &&
    hasCompanyConfirmCue &&
    !/\b(?:nao sou|nao e|outra empresa|empresa errada)\b/.test(text)
  ) {
    return "confirmed";
  }

  return "pending";
}

/**
 * Verifica se o nome da empresa extraído pelo LLM corresponde à empresa já cadastrada
 * para o telefone/contato — proteção em profundidade para garantir que `_KNOWN_COMPANY_CONFIRMED`
 * e o CNPJ/CPF cadastrados sejam vinculados mesmo diante de confirmações informais/retratações.
 */
export function doesExtractedCompanyMatchKnownClient(
  extractedCompany?: string | null,
  knownClient?: KnownClientProfile | null,
): boolean {
  if (!extractedCompany || !knownClient || !isValidKnownCompanyName(knownClient.companyName)) {
    return false;
  }
  const normExt = normalizeTriageText(extractedCompany);
  const normKnown = normalizeTriageText(knownClient.companyName);
  if (!normExt || !normKnown) return false;
  if (normExt === normKnown) return true;
  const stop =
    /^(?:ltda|eireli|me|epp|s\/a|sa|comercio|industria|servicos|produtos|distribuidora|solucoes|grupo|holding|de|da|do|das|dos|e)$/;
  const extTokens = normExt.split(" ").filter((t) => t.length >= 3 && !stop.test(t));
  const knownTokens = normKnown.split(" ").filter((t) => t.length >= 3 && !stop.test(t));
  if (extTokens.length === 0 || knownTokens.length === 0) return false;
  const overlap = extTokens.filter((t) => knownTokens.includes(t));
  return overlap.length >= Math.min(2, knownTokens.length);
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

export interface ValidatedCnpjPayload {
  valid: boolean;
  cnpjFormatted?: string | null;
  razaoSocial?: string | null;
  details?: {
    razaoSocial?: string | null;
    nomeFantasia?: string | null;
    capitalSocial?: string | null;
    porte?: string | null;
    cnaePrincipal?: string | null;
  } | null;
}

/**
 * Persiste deterministicamente em `collectedData` um CNPJ matematicamente válido
 * enviado pelo cliente no lote (e sua razão social da Receita Federal), garantindo que
 * short-circuits do turno (ex.: consulta direta VTEX de preço/frete) ou omissão do LLM
 * nunca deixem `contacts.document`/`_RECEITA_FEDERAL` dessincronizados de `missingFields`.
 */
export function applyValidatedCnpjToCollectedData(
  currentData: CollectedFields,
  cnpjInfo: ValidatedCnpjPayload | null | undefined,
): CollectedFields {
  const next: CollectedFields = { ...currentData };
  if (!cnpjInfo?.valid) return next;

  const formattedDoc = String(cnpjInfo.cnpjFormatted || "").trim();
  if (formattedDoc && isValidTriageDocument(formattedDoc)) {
    next["CNPJ OU CPF"] = {
      value: formattedDoc,
      status: "filled",
    };
  }

  const razao = String(cnpjInfo.razaoSocial || cnpjInfo.details?.razaoSocial || "").trim();
  const existingCompany = String(next["EMPRESA"]?.value || "").trim();
  const hasRealCompany =
    Boolean(existingCompany) &&
    !existingCompany.toLowerCase().includes("aguardando") &&
    !existingCompany.toLowerCase().includes("não informado") &&
    !existingCompany.toLowerCase().includes("nao informado") &&
    isValidKnownCompanyName(existingCompany);

  if (razao && !hasRealCompany && isValidKnownCompanyName(razao)) {
    next["EMPRESA"] = {
      value: razao,
      status: "filled",
    };
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
  // Evita perguntar "Sua empresa é a Valdônio/André Silva/luid, certo?" quando o cadastro
  // salvou apenas o próprio nome pessoal do contato no campo de empresa sem marcador empresarial.
  if (
    confirmationStatus === "pending" &&
    !knownClient.document &&
    looksLikePersonalNameUsedAsCompany(knownClient.companyName, knownClient.contactName)
  ) {
    return "";
  }

  const companyName = knownClient.companyName.trim();
  const docInfo = knownClient.document ? ` (CNPJ/CPF registrado: ${knownClient.document})` : "";
  const prevContext =
    knownClient.lastSector || knownClient.lastInterest
      ? ` Último atendimento registrado: ${[knownClient.lastSector, knownClient.lastInterest].filter(Boolean).join(" — ")}.`
      : "";

  if (confirmationStatus === "rejected") {
    return `\n\n[SISTEMA - VÍNCULO DE EMPRESA ANTERIOR RECUSADO PELO CLIENTE]: O telefone tinha vínculo anterior com "${companyName}", mas o cliente informou que NÃO fala por essa empresa. Caso o setor exija documento, solicite diretamente o CNPJ ou CPF atual (NUNCA peça "o nome da empresa ou o CNPJ", pois precisamos do número do CNPJ/CPF para o cadastro).`;
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
