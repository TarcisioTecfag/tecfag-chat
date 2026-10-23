/** Regras de triagem industrial compartilháveis por Site e WhatsApp. Sem IO. */
export const INDUSTRIAL_POLICY_VERSION = "industrial-v3";
export const INDUSTRIAL_REVIEW_FUNNEL = "Análise e revisão humana";
export type TriageStage =
  | "triagem"
  | "assistencia_tecnica"
  | "pos_venda"
  | "maquinas"
  | "personalite"
  | "financeiro"
  | "pecas"
  | "outros"
  | "sem_resposta";
export type CollectedFields = Record<string, { value?: string; status?: string }>;

export const INDUSTRIAL_ROUTES = {
  MAQUINAS: {
    stage: "maquinas",
    funnel: "Máquinas",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request", "application", "production"],
  },
  PERSONNALITE: {
    stage: "personalite",
    funnel: "Personnalité",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request", "application", "production"],
  },
  PECAS: {
    stage: "pecas",
    funnel: "Peças",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  "2A_BOLETO": {
    stage: "financeiro",
    funnel: "Financeiro",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  "2B_NF": {
    stage: "financeiro",
    funnel: "Financeiro",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  "2C_OUTROS": {
    stage: "financeiro",
    funnel: "Financeiro",
    createsDeal: false,
    action: "handoff",
    fields: ["name", "request"],
  },
  "3_AT": {
    stage: "assistencia_tecnica",
    funnel: "Assistência Técnica",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "request"],
  },
  "4A_RASTREAR": {
    stage: "pos_venda",
    funnel: "Pós-Venda",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  "4B_NF": {
    stage: "pos_venda",
    funnel: "Pós-Venda",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  POS_VENDA: {
    stage: "pos_venda",
    funnel: "Pós-Venda",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  "5A_CLIENTE": {
    stage: "outros",
    funnel: INDUSTRIAL_REVIEW_FUNNEL,
    createsDeal: false,
    action: "review",
    fields: [],
  },
  "5B_CURRICULO": {
    stage: "outros",
    funnel: "Currículos",
    createsDeal: false,
    action: "inform",
    fields: [],
  },
  "5C_COMPRAS": {
    stage: "outros",
    funnel: "Compras / Fornecedores",
    createsDeal: false,
    action: "inform",
    fields: [],
  },
} as const;

export type IndustrialSubflow = keyof typeof INDUSTRIAL_ROUTES;
export type IndustrialFunnel = (typeof INDUSTRIAL_ROUTES)[IndustrialSubflow]["funnel"];
export const INDUSTRIAL_FUNNELS = [
  ...new Set(
    Object.values(INDUSTRIAL_ROUTES)
      .filter((route) => route.action !== "inform")
      .map((route) => route.funnel),
  ),
];

/** Compatibilidade somente do núcleo industrial; não altera a política dos demais tenants. */
const LEGACY_INDUSTRIAL_FUNNELS: Record<string, string> = {
  "Fin. Boleto": "Financeiro",
  "Fin. Nota Fiscal": "Financeiro",
  "Fin. Outros": "Financeiro",
  "Pós-Venda Rastreio": "Pós-Venda",
  "Pós-Venda - NF do Pedido": "Pós-Venda",
  "Pós-Venda Geral": "Pós-Venda",
  "Atendimento Geral": INDUSTRIAL_REVIEW_FUNNEL,
};
export function normalizeIndustrialFunnel(value: string): string {
  const normalized = normalizeTriageText(value);
  return (
    Object.entries(LEGACY_INDUSTRIAL_FUNNELS).find(
      ([name]) => normalizeTriageText(name) === normalized,
    )?.[1] ||
    INDUSTRIAL_FUNNELS.find((name) => normalizeTriageText(name) === normalized) ||
    value
  );
}
export function normalizeIndustrialFunnels(values: readonly string[]): string[] {
  return [
    ...new Set(values.filter((value) => typeof value === "string").map(normalizeIndustrialFunnel)),
  ];
}
export type RequiredField = "name" | "document" | "request" | "application" | "production";
export interface SystemOperatorCandidate {
  id: string;
  name: string;
  email?: string;
  funnels?: string[];
  sectorName?: string;
  isOnLeave?: boolean;
  status?: string;
}
export type DirectOperatorIntent =
  | "direct_transfer"
  | "past_reference_only"
  | "ambiguous_homonym"
  | "not_found";
export interface DirectOperatorAiDecision {
  intent?: DirectOperatorIntent | null;
  citedName?: string | null;
  matchedOperatorId?: string | null;
  matchedOperatorName?: string | null;
}
export interface DirectOperatorTarget {
  id: string;
  name: string;
  isAbsent: boolean;
  primaryFunnel: IndustrialFunnel | null;
}
export interface ResolvedDirectOperator {
  status: "matched" | "past_reference_only" | "ambiguous_homonym" | "not_found" | "none";
  citedName: string | null;
  operator: DirectOperatorTarget | null;
  homonyms?: Array<{ id: string; name: string; funnels: string[] }>;
}
export interface IndustrialRoute {
  subflow: IndustrialSubflow | null;
  funnelStage: TriageStage;
  targetFunnel: IndustrialFunnel | null;
  needsReview: boolean;
  reason:
    | "intent"
    | "declared_route"
    | "previous_route"
    | "unknown"
    | "human_requested"
    | "direct_operator_requested"
    | "specialist_review"
    | "classification_pending";
  targetOperator?: DirectOperatorTarget | null;
}

export function normalizeTriageText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function collectedValue(data: CollectedFields, ...keys: string[]): string {
  for (const key of keys) {
    const entry = data[key];
    if (entry?.status === "pending" || typeof entry?.value !== "string") continue;
    const value = entry.value.trim();
    const normalized = normalizeTriageText(value);
    if (
      normalized &&
      !/^(?:aguardando.*|nao informado|nao informada|mantem.*|n\/a|nenhum|nenhuma|true|false|sim|nao)$/i.test(
        normalized,
      )
    )
      return value;
  }
  return "";
}

export function isIndustrialSubflow(value: unknown): value is IndustrialSubflow {
  return typeof value === "string" && Object.hasOwn(INDUSTRIAL_ROUTES, value);
}

function declaredSubflow(value?: string | null): IndustrialSubflow | null {
  if (isIndustrialSubflow(value)) return value;
  const normalized = normalizeTriageText(value || "");
  // Rótulos antigos preservam o assunto específico; o destino novo continua unificado.
  const legacy: Record<string, IndustrialSubflow> = {
    "Fin. Boleto": "2A_BOLETO",
    "Fin. Nota Fiscal": "2B_NF",
    "Fin. Outros": "2C_OUTROS",
    "Pós-Venda Rastreio": "4A_RASTREAR",
    "Pós-Venda - NF do Pedido": "4B_NF",
    "Pós-Venda Geral": "POS_VENDA",
    "Atendimento Geral": "5A_CLIENTE",
    Financeiro: "2C_OUTROS",
    "Pós-Venda": "POS_VENDA",
  };
  const old = Object.entries(legacy).find(([name]) => normalizeTriageText(name) === normalized);
  if (old) return old[1];
  return (
    (Object.keys(INDUSTRIAL_ROUTES) as IndustrialSubflow[]).find(
      (key) => normalizeTriageText(INDUSTRIAL_ROUTES[key].funnel) === normalized,
    ) || null
  );
}

/** Não confundir solicitação de manual com compra de "seladora manual". */
function isTechnicalDocument(text: string): boolean {
  if (/\b(?:esquema|diagrama) eletric\w*\b/.test(text)) return true;
  return (
    /\bmanua(?:l|is)\b/.test(text) &&
    (/\b(?:do|da|o|um|seu|pdf|copia|instrucoes|tecnico) manual\b/.test(text) ||
      /\bmanual (?:d[aoe]|de instrucoes|tecnico)\b/.test(text) ||
      (/\b(?:preciso|quero|envia|enviar|manda|mandar|perdi|solicito)\b/.test(text) &&
        !/\b(?:seladora|envasadora|dosadora|rotuladora|maquina|arqueadora|embaladora) manual\b/.test(
          text,
        )))
  );
}

function textSubflow(raw: string): IndustrialSubflow | null {
  const text = normalizeTriageText(raw);
  if (!text) return null;
  if (/\b(?:curriculo|vaga de emprego|vagas|trabalhar (?:na|com) voces)\b/.test(text))
    return "5B_CURRICULO";
  if (
    /\b(?:sou fornecedor|somos fornecedores|oferecer (?:produtos|servicos)|fornecer para voces|proposta de parceria)\b/.test(
      text,
    )
  )
    return "5C_COMPRAS";

  const pendingReturn =
    /\b(?:quero|queria|preciso|vou|gostaria de|como faco para) (?:fazer (?:a |uma )?)?(?:devolver|devolucao|cancelar)\b/.test(
      text,
    );
  const returned = /\b(?:devolvi|devolvemos|devolvid[oa]s?|ja devol\w*)\b/.test(text);
  if (
    /\b(?:estorn\w*|reembols\w*|ressarc\w*|restituicao|dinheiro de volta)\b/.test(text) ||
    (returned && /\b(?:dinheiro|valor|pagamento|credito)\b/.test(text))
  ) {
    return pendingReturn && !returned ? "POS_VENDA" : "2C_OUTROS";
  }
  if (pendingReturn || /\b(?:devolucao|cancelamento (?:do|de) pedido)\b/.test(text))
    return "POS_VENDA";
  if (/\b(?:boleto|cobranca|inadimplencia)\b/.test(text)) return "2A_BOLETO";
  if (/\b(?:nota fiscal|nf|danfe|xml)\b/.test(text)) {
    return /\b(?:pedido|compra|entrega|rastre\w*)\b/.test(text) ? "4B_NF" : "2B_NF";
  }
  if (/\b(?:financeiro|pagamento|comprovante|fatura|prorrogacao)\b/.test(text)) return "2C_OUTROS";
  if (isTechnicalDocument(text)) return "3_AT";
  if (
    /\b(?:defeito|conserto|manutencao|garantia|assistencia|suporte tecnico|nao (?:liga|funciona|sela|corta)|maquina parada)\b/.test(
      text,
    )
  ) {
    if (!/\b(?:quero comprar|gostaria de comprar|quero adquirir)\b/.test(text)) return "3_AT";
  }
  if (
    /\b(?:rastre\w*|transportadora|entrega|pedido (?:chegou|existente)|proposta \d+)\b/.test(text)
  )
    return "4A_RASTREAR";
  if (/\b(?:pos venda|comprei|compramos|efetuamos um pedido|fizemos um pedido)\b/.test(text))
    return "POS_VENDA";
  if (
    /\b(?:pecas?|insumos?|consumiveis|reposicao|ribbon|ink ?roll|teflon|resistencia|correias?|roletes?|sensor|clp)\b/.test(
      text,
    )
  )
    return "PECAS";
  if (
    /\b(?:maquinas?|seladoras?|envasadoras?|dosadoras?|empacotadoras?|rotuladoras?|embaladoras?|datador\w*|encapsuladoras?|tuneis|tunel|personnalite|personalite|orcamento|cotacao|quero comprar)\b/.test(
      text,
    )
  )
    return "MAQUINAS";
  return null;
}

export function isPastPersonReference(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (!text) return false;
  return (
    /\b(?:ja|eu ja|cheguei a|costumava|vivia) (?:falei|conversei|falar|conversar|tratei|negociei) (?:antes |uma vez |outra vez )?(?:com|pelo|pela)\b/.test(
      text,
    ) ||
    /\b(?:falei|conversei|comprei|fechei|negociei|tratei) (?:com|pelo|pela) (?:o |a )?[a-z]{3,}\b.*\b(?:ontem|antes|passad[oa]|semana|mes|ano|uma vez|outra vez|da ultima vez|anteriormente)\b/.test(
      text,
    ) ||
    /\b(?:ontem|antes|semana passada|mes passado|ano passado|uma vez|da ultima vez) (?:eu )?(?:falei|conversei|comprei|tratei|falar|conversar) com\b/.test(
      text,
    )
  );
}

/** Detecta pedido genérico de atendimento humano (sem citar nome de pessoa específica). */
export function requestsGenericHuman(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (/\bnao (?:quero|preciso|desejo) (?:falar|conversar|ser transferido)\b/.test(text))
    return false;
  return (
    /\b(?:quero|prefiro|preciso|posso|gostaria de|pode me|me) (?:falar|conversar|passar|transferir|transfere|passa|conecte|conectar)\b.*\b(?:humano|humana|atendente|alguem|equipe)\b/.test(
      text,
    ) || /\b(?:nao quero|pare de) (?:falar|conversar) com (?:robo|ia|bot)\b/.test(text)
  );
}

export function requestsHuman(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (/\bnao (?:quero|preciso|desejo) (?:falar|conversar|ser transferido)\b/.test(text))
    return false;
  if (isPastPersonReference(text)) return false;
  return (
    requestsGenericHuman(raw) ||
    /\b(?:quero|prefiro|preciso|posso|gostaria de|pode me|me) (?:falar|conversar|passar|transferir|transfere|passa|conecte|conectar)\b.*\b(?:pessoa)\b/.test(
      text,
    ) ||
    /\b(?:falar|conversar|transfere|transferir|passa) (?:diretamente )?(?:com|para|pra) (?:o |a |um |uma )?(?!(?:vendedor|consultor|especialista|suporte|financeiro|pos|fagner|valentina)\b)[a-z]{3,}(?:\b|$)/.test(
      text,
    )
  );
}

const STOPWORDS_PERSON_NAME = new Set(["sr", "sra", "dr", "dra", "de", "da", "do", "dos", "das", "o", "a"]);

function extractNameTokens(rawName: string): string[] {
  return normalizeTriageText(rawName)
    .replace(/\s*-\s*\d+\s*$/, "")
    .split(" ")
    .filter((token) => token.length >= 2 && !STOPWORDS_PERSON_NAME.has(token));
}

/**
 * Cruza a interpretação contextual do Gemini (`directOperatorRequest`) com a lista
 * real de todos os usuários/operadores cadastrados no tenant (`operators` + `flowOperators`).
 */
export function resolveDirectOperatorRequest(
  aiDecision: DirectOperatorAiDecision | null | undefined,
  systemOperators: readonly SystemOperatorCandidate[],
): ResolvedDirectOperator {
  if (!aiDecision || !aiDecision.intent) {
    return { status: "none", citedName: null, operator: null };
  }
  const rawCited = (aiDecision.citedName || aiDecision.matchedOperatorName || "").trim();
  if (aiDecision.intent === "past_reference_only") {
    return {
      status: "past_reference_only",
      citedName: rawCited || null,
      operator: null,
    };
  }

  const citedTokens = extractNameTokens(rawCited);
  const normCitedFull = citedTokens.join(" ");

  const nameMatches =
    citedTokens.length > 0
      ? systemOperators.filter((op) => {
          const opTokens = extractNameTokens(op.name);
          if (opTokens.length === 0) return false;
          const normOpFull = opTokens.join(" ");
          if (normOpFull === normCitedFull) return true;
          if (citedTokens.length === 1) {
            return opTokens[0] === citedTokens[0];
          }
          return citedTokens.every((token) => opTokens.includes(token));
        })
      : [];

  const exactFullMatches =
    citedTokens.length > 1
      ? nameMatches.filter((op) => extractNameTokens(op.name).join(" ") === normCitedFull)
      : [];

  const effectiveNameMatches = exactFullMatches.length === 1 ? exactFullMatches : nameMatches;

  // Se o cliente citou apenas o primeiro nome (ex: "João") e há múltiplos "João" no sistema, é homônimo ambíguo
  if (effectiveNameMatches.length > 1) {
    return {
      status: "ambiguous_homonym",
      citedName: rawCited || null,
      operator: null,
      homonyms: effectiveNameMatches.map((op) => ({
        id: op.id,
        name: op.name,
        funnels: normalizeIndustrialFunnels(op.funnels || []),
      })),
    };
  }

  const idMatch = aiDecision.matchedOperatorId
    ? systemOperators.find((op) => op.id === aiDecision.matchedOperatorId) || null
    : null;

  const chosen =
    effectiveNameMatches.length === 1
      ? effectiveNameMatches[0]
      : aiDecision.intent === "direct_transfer"
        ? idMatch
        : null;

  if (!chosen) {
    return {
      status: "not_found",
      citedName: rawCited || null,
      operator: null,
    };
  }

  const normalizedFunnels = normalizeIndustrialFunnels(chosen.funnels || []);
  const primaryFunnel =
    (normalizedFunnels.find((f) =>
      (INDUSTRIAL_FUNNELS as readonly string[]).includes(f),
    ) as IndustrialFunnel | undefined) || null;
  const isAbsent = Boolean(
    chosen.isOnLeave === true || normalizeTriageText(chosen.status || "") === "ausente",
  );

  return {
    status: "matched",
    citedName: rawCited || chosen.name,
    operator: {
      id: chosen.id,
      name: chosen.name,
      isAbsent,
      primaryFunnel,
    },
  };
}

/** Autorização por destino unificado, incluindo os nomes industriais anteriores. */
export function isEligibleIndustrialOperator(
  operator: {
    id: string;
    funnels: string[];
    isParticipating: boolean;
    isOnLeave: boolean;
    isPenalized?: boolean;
  },
  target: string,
  systemOperatorIds: ReadonlySet<string>,
): boolean {
  const normalized = normalizeTriageText(normalizeIndustrialFunnel(target));
  return (
    Boolean(normalized) &&
    systemOperatorIds.has(operator.id) &&
    operator.isParticipating === true &&
    operator.isOnLeave === false &&
    operator.isPenalized !== true &&
    Array.isArray(operator.funnels) &&
    operator.funnels.some(
      (funnel) =>
        typeof funnel === "string" &&
        normalizeTriageText(normalizeIndustrialFunnel(funnel)) === normalized,
    )
  );
}

export interface ResolveIndustrialRouteInput {
  text?: string;
  aiSubflow?: string | null;
  aiFunnelStage?: string | null;
  aiTargetFunnel?: string | null;
  collectedData: CollectedFields;
  existingSubflow?: string | null;
  existingStage?: string | null;
  existingFunnel?: string | null;
  /** Evidência produzida pelo servidor/catálogo ou revisão, nunca copiada do JSON do LLM. */
  machineEvidence?: {
    source: "catalog" | "manual_review";
    group: "PERSONNALITE" | "SEMI-INDUSTRIAL";
    confidence: number;
  };
  /** Resolução validada pelo servidor de pedido nominal de transferência direta. */
  directOperator?: ResolvedDirectOperator | null;
}

export function resolveIndustrialRoute(input: ResolveIndustrialRouteInput): IndustrialRoute {
  if (input.directOperator?.status === "matched" && input.directOperator.operator) {
    const targetOp = input.directOperator.operator;
    const subflowFromFunnel = targetOp.primaryFunnel ? declaredSubflow(targetOp.primaryFunnel) : null;
    const effectiveSubflow: IndustrialSubflow = subflowFromFunnel || "5A_CLIENTE";
    return {
      subflow: effectiveSubflow,
      funnelStage: INDUSTRIAL_ROUTES[effectiveSubflow].stage,
      targetFunnel: targetOp.primaryFunnel || INDUSTRIAL_ROUTES[effectiveSubflow].funnel,
      needsReview: false,
      reason: "direct_operator_requested",
      targetOperator: targetOp,
    };
  }
  const suppressNominalHumanRegex =
    input.directOperator?.status === "past_reference_only" ||
    input.directOperator?.status === "not_found" ||
    input.directOperator?.status === "ambiguous_homonym";
  if (
    suppressNominalHumanRegex
      ? requestsGenericHuman(input.text || "")
      : requestsHuman(input.text || "")
  ) {
    return routeFor("5A_CLIENTE", "human_requested", true);
  }
  const interest = collectedValue(
    input.collectedData,
    "MÁQUINA / PEÇA / INTERESSE",
    "SOLICITAÇÃO",
    "QUAL O TIPO DE PRODUTO?",
    "PRODUTO DE INTERESSE",
  );
  const fromCurrentText = textSubflow(input.text || "");
  const declared = declaredSubflow(input.aiSubflow) || declaredSubflow(input.aiTargetFunnel);
  const fromFields = textSubflow(interest);
  // Uma intenção específica é soberana sobre a linha/produto comercial declarado pelo LLM.
  const commercial = new Set<IndustrialSubflow>(["MAQUINAS", "PERSONNALITE"]);
  const specificFieldIntent = fromFields && !commercial.has(fromFields) ? fromFields : null;
  let subflow = fromCurrentText || specificFieldIntent || declared || fromFields;
  let reason: IndustrialRoute["reason"] =
    fromCurrentText || specificFieldIntent || fromFields ? "intent" : "declared_route";
  if (!subflow) {
    subflow =
      declaredSubflow(collectedValue(input.collectedData, "SETOR / FUNIL DE DESTINO", "SETOR")) ||
      declaredSubflow(input.existingSubflow) ||
      declaredSubflow(input.existingFunnel);
    reason = "previous_route";
  }
  if (input.aiFunnelStage === "sem_resposta" && !fromCurrentText && !declared && !fromFields) {
    return {
      subflow: null,
      funnelStage: "sem_resposta",
      targetFunnel: null,
      needsReview: false,
      reason: "unknown",
    };
  }
  if (!subflow) {
    const other = input.aiFunnelStage === "outros" && !suppressNominalHumanRegex;
    if (other) return routeFor("5A_CLIENTE", "unknown", true);
    return {
      subflow: null,
      funnelStage: other ? "outros" : "triagem",
      targetFunnel: null,
      needsReview: other,
      reason: "unknown",
    };
  }
  if (commercial.has(subflow)) {
    const evidence = input.machineEvidence;
    const trusted =
      evidence &&
      ["catalog", "manual_review"].includes(evidence.source) &&
      Number.isFinite(evidence.confidence) &&
      evidence.confidence >= 0.7 &&
      evidence.confidence <= 1;
    if (trusted)
      return routeFor(evidence.group === "PERSONNALITE" ? "PERSONNALITE" : "MAQUINAS", reason);
    const mentionsPremium =
      subflow === "PERSONNALITE" ||
      /\b(?:personnalite|personalite)\b/.test(
        normalizeTriageText(`${input.text || ""} ${interest}`),
      );
    return routeFor(
      "MAQUINAS",
      mentionsPremium ? "classification_pending" : reason,
      mentionsPremium,
    );
  }
  return routeFor(subflow, reason);
}

function routeFor(
  subflow: IndustrialSubflow,
  reason: IndustrialRoute["reason"],
  needsReview = false,
): IndustrialRoute {
  return {
    subflow,
    funnelStage: INDUSTRIAL_ROUTES[subflow].stage,
    targetFunnel: INDUSTRIAL_ROUTES[subflow].funnel,
    needsReview: needsReview || subflow === "5A_CLIENTE",
    reason,
  };
}

/** Validação local de CPF/CNPJ; não prova titularidade nem situação cadastral. */
export function isValidTriageDocument(raw: string): boolean {
  if (!/^[\d.\s/()-]+$/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  if (![11, 14].includes(digits.length) || /^(\d)\1+$/.test(digits)) return false;
  const check = (body: string, weights: number[]) => {
    const sum = [...body].reduce(
      (total, digit, index) => total + Number(digit) * weights[index],
      0,
    );
    return sum % 11 < 2 ? 0 : 11 - (sum % 11);
  };
  const weights =
    digits.length === 11 ? [10, 9, 8, 7, 6, 5, 4, 3, 2] : [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const body = digits.slice(0, -2);
  const first = check(body, weights);
  const second = check(body + first, digits.length === 11 ? [11, ...weights] : [6, ...weights]);
  return digits.endsWith(`${first}${second}`);
}

export const INDUSTRIAL_ALL_DISPLAY_FIELDS = [
  "NOME COMPLETO",
  "EMPRESA",
  "CNPJ OU CPF",
  "RAMO / O QUE EMBALA",
  "MÁQUINA / PEÇA / INTERESSE",
  "VOLUME / PRODUÇÃO",
  "SETOR / FUNIL DE DESTINO",
] as const;

export type IndustrialDisplayField = (typeof INDUSTRIAL_ALL_DISPLAY_FIELDS)[number];

export interface AdaptiveIndustrialFieldContext {
  subflow?: string | null;
  funnelStage?: string | null;
  targetFunnel?: string | null;
  collectedData?: CollectedFields | null;
  company?: string | null;
  document?: string | null;
  isCompleted?: boolean;
  text?: string;
}

export function resolveEffectiveIndustrialSubflow(
  ctx: AdaptiveIndustrialFieldContext,
): IndustrialSubflow | null {
  const data = ctx.collectedData || {};
  const fromExplicit = declaredSubflow(ctx.subflow);
  if (fromExplicit) return fromExplicit;

  const fromDataSector = declaredSubflow(
    collectedValue(data, "SETOR / FUNIL DE DESTINO", "SETOR"),
  );
  if (fromDataSector) return fromDataSector;

  const fromTargetFunnel = declaredSubflow(ctx.targetFunnel);
  if (fromTargetFunnel) return fromTargetFunnel;

  const stage = normalizeTriageText(ctx.funnelStage || "");
  if (stage === "maquinas") return "MAQUINAS";
  if (stage === "personalite") return "PERSONNALITE";
  if (stage === "pecas") return "PECAS";
  if (stage === "assistencia tecnica") return "3_AT";
  if (stage === "pos venda") return "POS_VENDA";
  if (stage === "financeiro") {
    const hasDoc = Boolean(
      collectedValue(data, "CNPJ OU CPF", "CNPJ", "CPF") ||
        (ctx.document && ctx.document.trim()) ||
        data._KNOWN_COMPANY_CONFIRMED?.status === "filled",
    );
    return hasDoc ? "2A_BOLETO" : "2C_OUTROS";
  }
  if (stage === "outros") return "5A_CLIENTE";

  return resolveIndustrialRoute({
    text: ctx.text,
    collectedData: data,
    existingSubflow: ctx.subflow,
    existingStage: ctx.funnelStage,
    existingFunnel: ctx.targetFunnel,
  }).subflow;
}

/**
 * Retorna a lista de campos do painel "Dados Coletados" adaptada ao setor/subfluxo da triagem.
 * Setores não-comerciais (Peças, Assistência Técnica, Financeiro, Pós-Venda, Outros) exibem
 * apenas os campos pertinentes ao seu fluxo (mais quaisquer campos extras já preenchidos).
 */
export function getIndustrialTargetFields(
  ctx: AdaptiveIndustrialFieldContext,
): IndustrialDisplayField[] {
  const data = ctx.collectedData || {};
  const subflow = resolveEffectiveIndustrialSubflow(ctx);

  if (!subflow || subflow === "MAQUINAS" || subflow === "PERSONNALITE") {
    return [...INDUSTRIAL_ALL_DISPLAY_FIELDS];
  }

  const policyFields = new Set<RequiredField>(
    INDUSTRIAL_ROUTES[subflow].fields as readonly RequiredField[],
  );

  const hasCompanyValue = Boolean(
    collectedValue(data, "EMPRESA") || (ctx.company && ctx.company.trim()),
  );
  const hasDocValue = Boolean(
    collectedValue(data, "CNPJ OU CPF", "CNPJ", "CPF") ||
      (ctx.document && ctx.document.trim()) ||
      data._KNOWN_COMPANY_CONFIRMED?.status === "filled",
  );
  const hasApplicationValue = Boolean(collectedValue(data, "RAMO / O QUE EMBALA"));
  const hasProductionValue = Boolean(collectedValue(data, "VOLUME / PRODUÇÃO"));
  const hasNameValue = Boolean(collectedValue(data, "NOME COMPLETO"));
  const hasRequestValue = Boolean(
    collectedValue(
      data,
      "MÁQUINA / PEÇA / INTERESSE",
      "SOLICITAÇÃO",
      "QUAL O TIPO DE PRODUTO?",
      "PRODUTO DE INTERESSE",
    ),
  );

  const result: IndustrialDisplayField[] = [];

  if (policyFields.has("name") || hasNameValue || (!ctx.isCompleted && policyFields.size === 0)) {
    result.push("NOME COMPLETO");
  }

  if (policyFields.has("document") || hasCompanyValue) {
    result.push("EMPRESA");
  }

  if (policyFields.has("document") || hasDocValue) {
    result.push("CNPJ OU CPF");
  }

  if (policyFields.has("application") || hasApplicationValue) {
    result.push("RAMO / O QUE EMBALA");
  }

  if (
    policyFields.has("request") ||
    hasRequestValue ||
    (!ctx.isCompleted && policyFields.size === 0)
  ) {
    result.push("MÁQUINA / PEÇA / INTERESSE");
  }

  if (policyFields.has("production") || hasProductionValue) {
    result.push("VOLUME / PRODUÇÃO");
  }

  result.push("SETOR / FUNIL DE DESTINO");
  return result;
}

/**
 * Normaliza o dicionário `collectedData` para exibição e cálculo de progresso:
 * - Remove chaves internas iniciadas por `_`
 * - Preenche `EMPRESA` quando já conhecida no cadastro/sessão (ou "Pessoa Física (CPF)" quando CPF válido sem empresa)
 * - Preenche `CNPJ OU CPF` quando já conhecido no vínculo ou confirmado pelo cadastro
 * - Preenche `SETOR / FUNIL DE DESTINO` a partir da rota identificada
 */
export function getAdaptiveIndustrialCollectedData(
  ctx: AdaptiveIndustrialFieldContext,
): CollectedFields {
  const raw = ctx.collectedData || {};
  const subflow = resolveEffectiveIndustrialSubflow(ctx);
  const targetFields = getIndustrialTargetFields(ctx);

  const normalized: CollectedFields = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    normalized[key] = entry ? { ...entry } : { value: "Aguardando...", status: "pending" };
  }

  const nameVal = collectedValue(raw, "NOME COMPLETO");
  const companyVal =
    collectedValue(raw, "EMPRESA") || (ctx.company && ctx.company.trim() ? ctx.company.trim() : "");
  const docVal =
    collectedValue(raw, "CNPJ OU CPF", "CNPJ", "CPF") ||
    (ctx.document && ctx.document.trim() ? ctx.document.trim() : "");
  const appVal = collectedValue(raw, "RAMO / O QUE EMBALA");
  const reqVal = collectedValue(
    raw,
    "MÁQUINA / PEÇA / INTERESSE",
    "SOLICITAÇÃO",
    "QUAL O TIPO DE PRODUTO?",
    "PRODUTO DE INTERESSE",
  );
  const prodVal = collectedValue(raw, "VOLUME / PRODUÇÃO");
  const routeFunnel =
    collectedValue(raw, "SETOR / FUNIL DE DESTINO", "SETOR") ||
    (ctx.targetFunnel && ctx.targetFunnel.trim() ? ctx.targetFunnel.trim() : "") ||
    (subflow ? INDUSTRIAL_ROUTES[subflow].funnel : "");

  const isCpfOnly =
    Boolean(docVal) &&
    docVal.replace(/\D/g, "").length === 11 &&
    isValidTriageDocument(docVal) &&
    !companyVal;

  const isKnownCompanyConfirmed =
    raw._KNOWN_COMPANY_CONFIRMED?.status === "filled" && Boolean(companyVal);

  const resolvedValues: Record<IndustrialDisplayField, string> = {
    "NOME COMPLETO": nameVal,
    EMPRESA: companyVal || (isCpfOnly && ctx.isCompleted ? "Pessoa Física (CPF)" : ""),
    "CNPJ OU CPF": docVal || (isKnownCompanyConfirmed ? "Vinculado ao cadastro" : ""),
    "RAMO / O QUE EMBALA": appVal,
    "MÁQUINA / PEÇA / INTERESSE": reqVal,
    "VOLUME / PRODUÇÃO": prodVal,
    "SETOR / FUNIL DE DESTINO": routeFunnel,
  };

  const result: CollectedFields = {};
  for (const field of targetFields) {
    const val = resolvedValues[field];
    if (val) {
      result[field] = { value: val, status: "filled" };
    } else {
      result[field] = { value: "Aguardando...", status: "pending" };
    }
  }

  return result;
}

export function computeIndustrialTriageProgress(ctx: AdaptiveIndustrialFieldContext): {
  filledCount: number;
  totalCount: number;
  percentage: number;
  targetFields: IndustrialDisplayField[];
  adaptiveData: CollectedFields;
} {
  const targetFields = getIndustrialTargetFields(ctx);
  const adaptiveData = getAdaptiveIndustrialCollectedData(ctx);
  const totalCount = targetFields.length || 1;
  const filledCount = targetFields.filter((key) =>
    Boolean(collectedValue(adaptiveData, key)),
  ).length;

  const subflow = resolveEffectiveIndustrialSubflow(ctx);
  const readiness = subflow
    ? assessIndustrialReadiness(routeFor(subflow, "declared_route"), {
        ...(ctx.collectedData || {}),
        ...adaptiveData,
        ...(ctx.collectedData?._KNOWN_COMPANY_CONFIRMED
          ? { _KNOWN_COMPANY_CONFIRMED: ctx.collectedData._KNOWN_COMPANY_CONFIRMED }
          : {}),
      })
    : null;

  const isRouteFullyReady = Boolean(
    ctx.isCompleted || (readiness?.ready && Boolean(collectedValue(adaptiveData, "SETOR / FUNIL DE DESTINO"))),
  );

  const percentage = isRouteFullyReady
    ? 100
    : Math.min(100, Math.round((filledCount / totalCount) * 100));

  return {
    filledCount: ctx.isCompleted && filledCount === 0 ? totalCount : filledCount,
    totalCount,
    percentage,
    targetFields,
    adaptiveData,
  };
}

export function assessIndustrialReadiness(
  route: IndustrialRoute,
  data: CollectedFields,
): {
  ready: boolean;
  missing: RequiredField[];
  action: "collect" | "handoff" | "inform" | "review";
  createsDeal: boolean;
} {
  if (route.reason === "direct_operator_requested" && route.targetOperator?.id) {
    return { ready: true, missing: [], action: "handoff", createsDeal: false };
  }
  if (!route.subflow)
    return {
      ready: false,
      missing: [],
      action: route.needsReview ? "review" : "collect",
      createsDeal: false,
    };
  const policy = INDUSTRIAL_ROUTES[route.subflow];
  const hasVerifiedKnownCompany =
    data._KNOWN_COMPANY_CONFIRMED?.status === "filled" &&
    Boolean(collectedValue(data, "EMPRESA"));
  const available: Record<RequiredField, boolean> = {
    name: Boolean(collectedValue(data, "NOME COMPLETO")),
    document:
      isValidTriageDocument(collectedValue(data, "CNPJ OU CPF", "CNPJ", "CPF")) ||
      hasVerifiedKnownCompany,
    request: Boolean(
      collectedValue(
        data,
        "MÁQUINA / PEÇA / INTERESSE",
        "SOLICITAÇÃO",
        "QUAL O TIPO DE PRODUTO?",
        "PRODUTO DE INTERESSE",
      ),
    ),
    application: Boolean(collectedValue(data, "RAMO / O QUE EMBALA")),
    production: Boolean(collectedValue(data, "VOLUME / PRODUÇÃO")),
  };
  const missing = (policy.fields as readonly RequiredField[]).filter((key) => !available[key]);
  if (route.reason === "human_requested" || route.reason === "specialist_review")
    return { ready: true, missing: [], action: "review", createsDeal: false };
  return {
    ready: missing.length === 0,
    missing,
    action: missing.length ? "collect" : route.needsReview ? "review" : policy.action,
    createsDeal: policy.createsDeal && !route.needsReview,
  };
}

/** Critérios de conclusão separados das palavras de despedida produzidas pelo modelo. */
export function canFinishIndustrialTriage(params: {
  route: IndustrialRoute;
  data: CollectedFields;
  isCompleted?: boolean;
  hasPendingQuestion?: boolean;
}): boolean {
  const ready = assessIndustrialReadiness(params.route, params.data);
  if (
    params.route.reason === "human_requested" ||
    params.route.reason === "specialist_review" ||
    (params.route.reason === "direct_operator_requested" && Boolean(params.route.targetOperator?.id))
  )
    return true;
  return ready.ready && params.isCompleted === true && !params.hasPendingQuestion;
}

export function hasPendingTriageQuestion(messages: string[]): boolean {
  return messages.some((message) => {
    const text = normalizeTriageText(message);
    if (/^(?:ok|certo|combinado|tudo bem|ne)\?$/.test(text)) return false;
    return (
      text.includes("?") ||
      /\b(?:pode me (?:informar|confirmar|passar)|me (?:informe|confirme|passe|envie|conta)|qual (?:seu|sua|o|a)|esta correto)\b/.test(
        text,
      )
    );
  });
}
