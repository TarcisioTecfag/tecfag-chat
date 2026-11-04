export type TemplateBinding = "customer_name" | "operator_name" | "manual";
export type TemplateBindings = Record<string, TemplateBinding>;

export function bodyVariableIndexes(bodyText: string): number[] {
  const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return [...new Set(matches)].sort((a, b) => a - b);
}

export function isSupportedMetaTemplate(
  components: Array<{ type?: string; format?: string; text?: string; buttons?: unknown[] }>,
  bodyText: string
): boolean {
  const indexes = bodyVariableIndexes(bodyText);
  const allPlaceholders = [...bodyText.matchAll(/\{\{([^{}]+)\}\}/g)].length;
  if (!bodyText || allPlaceholders !== [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].length) return false;
  if (!indexes.every((index, offset) => index === offset + 1)) return false;

  return components.every((component) => {
    if (component.type === "BODY" || component.type === "FOOTER") return true;
    if (component.type === "HEADER") {
      return ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(component.format || "");
    }
    if (component.type === "BUTTONS") {
      return Array.isArray(component.buttons);
    }
    return false;
  });
}

export function formatTemplateFirstName(
  rawName: string | null | undefined,
  fallback = "",
): string {
  const cleaned = String(rawName ?? "")
    .replace(/^@+/, "")
    .trim();
  const source = cleaned || String(fallback ?? "").replace(/^@+/, "").trim();
  if (!source) return "";
  const firstToken = source.split(/\s+/)[0]?.replace(/^@+/, "") || "";
  if (!firstToken) return "";
  return (
    firstToken.charAt(0).toLocaleUpperCase("pt-BR") +
    firstToken.slice(1).toLocaleLowerCase("pt-BR")
  );
}

export function resolveMetaTemplateValues(
  variableCount: number,
  bindings: TemplateBindings,
  supplied: unknown,
  names: { customerName?: string; operatorName?: string },
): string[] {
  const manual = Array.isArray(supplied) ? supplied : [];
  if (manual.length !== variableCount) throw new Error("Preencha todas as variáveis do template.");
  return Array.from({ length: variableCount }, (_, offset) => {
    const index = offset + 1;
    const binding = bindings[String(index)] || "manual";
    const raw =
      binding === "customer_name"
        ? formatTemplateFirstName(names.customerName)
        : binding === "operator_name"
          ? formatTemplateFirstName(names.operatorName)
          : manual[offset]?.text;
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) throw new Error(`Valor ausente para {{${index}}}.`);
    return value;
  });
}

export function stripTemplateAccents(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizeTemplateCustomGroups(value: unknown): string[] {
  let raw: unknown[] = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      raw = [];
    }
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const trimmed = String(item ?? "").trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const key = stripTemplateAccents(trimmed);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

export function collectTemplateCustomGroups(
  templates: Array<{ customGroups?: unknown }>,
  configuredGroups?: string[],
): string[] {
  const map = new Map<string, string>();
  for (const g of normalizeTemplateCustomGroups(configuredGroups || [])) {
    map.set(stripTemplateAccents(g), g);
  }
  for (const tpl of templates) {
    for (const g of normalizeTemplateCustomGroups(tpl.customGroups)) {
      const key = stripTemplateAccents(g);
      if (!map.has(key)) {
        map.set(key, g);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function matchesMetaTemplateFilter(
  template: {
    name: string;
    bodyText: string;
    category?: string;
    customGroups?: unknown;
  },
  options: {
    search?: string;
    selectedFilter?: string;
  },
): boolean {
  const groups = normalizeTemplateCustomGroups(template.customGroups);
  const filter = (options.selectedFilter || "ALL").trim();

  if (filter && filter !== "ALL") {
    if (filter === "UNGROUPED") {
      if (groups.length > 0) return false;
    } else if (filter.startsWith("GRP:")) {
      const targetGroup = stripTemplateAccents(filter.slice(4));
      if (!groups.some((g) => stripTemplateAccents(g) === targetGroup)) return false;
    } else {
      const targetCat = filter.startsWith("CAT:") ? filter.slice(4).toUpperCase() : filter.toUpperCase();
      if ((template.category || "").toUpperCase() !== targetCat) return false;
    }
  }

  const q = stripTemplateAccents(options.search || "");
  if (!q) return true;

  const matchesName = stripTemplateAccents(template.name).includes(q);
  const matchesBody = stripTemplateAccents(template.bodyText).includes(q);
  const matchesGroup = groups.some((g) => stripTemplateAccents(g).includes(q));

  return matchesName || matchesBody || matchesGroup;
}

/**
 * Detecta se o erro retornado pela Meta Cloud API (ou webhook statuses) corresponde
 * ao bloqueio experimental de Marketing (Erro 130472: "User's number is part of an experiment").
 */
export function isMetaExperimentError(
  error?: string | null,
  code?: number | string | null,
): boolean {
  if (code !== undefined && code !== null && String(code).trim() === "130472") {
    return true;
  }
  if (!error) return false;
  return /part of an experiment|130472|grupo de experimento da meta/i.test(String(error));
}

/**
 * Detecta se o erro retornado pela Meta Cloud API (ou webhook statuses) corresponde
 * a falha de entrega por número sem WhatsApp ativo / indisponível (Erro 131026: "Message undeliverable").
 */
export function isMetaUndeliverableError(
  error?: string | null,
  code?: number | string | null,
): boolean {
  if (code !== undefined && code !== null && String(code).trim() === "131026") {
    return true;
  }
  if (!error) return false;
  return /message undeliverable|131026|incapaz de entregar|sem whatsapp ativo/i.test(String(error));
}

export interface UndeliverablePhoneAnalysis {
  rawDigits: string;
  formattedPhone: string | null;
  ddd: string | null;
  isBrazilNumber: boolean;
  isBrazilLandline: boolean;
  isMissingNinthDigit: boolean;
}

/**
 * Analisa o número de telefone do contato para diagnosticar o motivo exato
 * do erro "Message undeliverable" (ex: telefone fixo comercial [2-5]XXX-XXXX sem WhatsApp).
 */
export function analyzeContactPhoneForUndeliverable(
  phone?: string | null,
): UndeliverablePhoneAnalysis {
  const rawDigits = String(phone || "").replace(/\D/g, "");
  if (!rawDigits) {
    return {
      rawDigits: "",
      formattedPhone: null,
      ddd: null,
      isBrazilNumber: false,
      isBrazilLandline: false,
      isMissingNinthDigit: false,
    };
  }

  let national = rawDigits;
  let isBrazil = false;

  if (
    (rawDigits.length === 12 || rawDigits.length === 13) &&
    rawDigits.startsWith("55")
  ) {
    national = rawDigits.slice(2);
    isBrazil = true;
  } else if (rawDigits.length === 10 || rawDigits.length === 11) {
    // Verifica se não é NANP (+1 NXX-NXX-XXXX) quando tem 11 dígitos iniciando em 1
    const isNanp =
      rawDigits.length === 11 &&
      rawDigits.startsWith("1") &&
      /^[2-9][0-8]\d$/.test(rawDigits.slice(1, 4));
    if (!isNanp) {
      isBrazil = true;
    }
  }

  if (isBrazil && (national.length === 10 || national.length === 11)) {
    const ddd = national.slice(0, 2);
    const subscriber = national.slice(2);
    const isBrazilLandline = subscriber.length === 8 && /^[2-5]/.test(subscriber);
    const isMissingNinthDigit = subscriber.length === 8 && /^[6-9]/.test(subscriber);
    const formattedPhone =
      subscriber.length === 8
        ? `(${ddd}) ${subscriber.slice(0, 4)}-${subscriber.slice(4)}`
        : `(${ddd}) ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`;

    return {
      rawDigits,
      formattedPhone,
      ddd,
      isBrazilNumber: true,
      isBrazilLandline,
      isMissingNinthDigit,
    };
  }

  if (rawDigits.length === 11 && rawDigits.startsWith("1")) {
    return {
      rawDigits,
      formattedPhone: `+1 (${rawDigits.slice(1, 4)}) ${rawDigits.slice(4, 7)}-${rawDigits.slice(7)}`,
      ddd: null,
      isBrazilNumber: false,
      isBrazilLandline: false,
      isMissingNinthDigit: false,
    };
  }

  return {
    rawDigits,
    formattedPhone: `+${rawDigits}`,
    ddd: null,
    isBrazilNumber: false,
    isBrazilLandline: false,
    isMissingNinthDigit: false,
  };
}

/**
 * Traduz mensagens técnicas comuns da Meta Cloud API para português amigável.
 */
export function formatMetaErrorMessagePt(
  error?: string | null,
  phone?: string | null,
): string | null {
  if (!error) return null;
  if (isMetaExperimentError(error)) {
    return "Número em grupo de teste da Meta (Erro 130472): templates de Marketing estão bloqueados para este contato fora da janela de 24h. Envie um template de Utilidade.";
  }
  if (isMetaUndeliverableError(error)) {
    const info = analyzeContactPhoneForUndeliverable(phone);
    if (info.isBrazilLandline) {
      return `Não entregue (Meta #131026): O número ${info.formattedPhone || ""} é um telefone fixo sem conta de WhatsApp ativa. Contate o cliente por ligação ou e-mail.`;
    }
    return "Não entregue (Meta #131026): Este número não possui conta de WhatsApp ativa ou não consegue receber mensagens no momento.";
  }
  return error;
}

/**
 * Interpola o texto do corpo de um template Meta com os parâmetros fornecidos.
 */
export function renderMetaTemplatePreview(
  bodyText: string,
  parameters: string[],
): string {
  return String(bodyText || "").replace(/@?\{\{(\d+)\}\}/g, (_, num) => {
    const idx = Number(num) - 1;
    const val = parameters[idx]?.trim();
    return val ? val.replace(/^@+/, "") : `{{${num}}}`;
  });
}

/**
 * Preenche automaticamente todas as variáveis {{1}}..{{N}} de um template Meta
 * usando os vínculos configurados (bindings) e heurística contextual de saudação/apresentação
 * para permitir envio imediato com 1 único clique.
 */
export function buildAutoFilledTemplateParameters(
  template: {
    bodyText: string;
    variableCount: number;
    bindings?: TemplateBindings;
  },
  context: {
    customerName?: string | null;
    operatorName?: string | null;
    tenantId?: string | null;
  },
): string[] {
  const customerFirst = formatTemplateFirstName(context.customerName, "Cliente") || "Cliente";
  const operatorFirst = formatTemplateFirstName(context.operatorName, "Atendente") || "Atendente";
  const companyLabel =
    String(context.tenantId || "").trim().toLowerCase() === "valem" ? "Valem" : "TECFAG";

  const body = String(template.bodyText || "");
  return Array.from({ length: Math.max(0, template.variableCount || 0) }, (_, idx) => {
    const varNum = String(idx + 1);
    const binding = template.bindings?.[varNum];
    if (binding === "customer_name") return customerFirst;
    if (binding === "operator_name") return operatorFirst;

    // Heurística contextual quando o vínculo da variável está como "manual"
    const placeholderRegex = new RegExp(`@?\\{\\{${varNum}\\}\\}`);
    const match = placeholderRegex.exec(body);
    if (match && typeof match.index === "number") {
      const before = body.slice(Math.max(0, match.index - 45), match.index);
      if (
        /(\b(?:aqui\s+[eé]\s*(?:o|a)?|me\s+chamo|sou\s*(?:o|a)?|consultor(?:a)?|atendente|vendedor(?:a)?|com\s+(?:o|a))\s*)$/i.test(
          before,
        )
      ) {
        return operatorFirst;
      }
      if (
        /(\b(?:oi|ol[aá]|bom\s+dia|boa\s+tarde|boa\s+noite|prezado(?:a)?|caro(?:a)?|sr\.?(?:a)?|cliente)\s*[,!]?\s*)$/i.test(
          before,
        )
      ) {
        return customerFirst;
      }
      if (
        /(\b(?:canal\s+oficial\s+da|equipe\s+da|empresa|pela|da\s+empresa)\s*)$/i.test(before)
      ) {
        return companyLabel;
      }
    }

    if (idx === 0) return customerFirst;
    if (idx === 1) return operatorFirst;
    return companyLabel;
  });
}

function normalizeTemplateComparisonText(value: string): string {
  return stripTemplateAccents(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ExperimentFallbackCandidate<T> {
  template: T;
  parameters: string[];
  previewText: string;
  isUtility: boolean;
}

/**
 * Seleciona e ordena os melhores templates aprovados para contornar o erro 130472 da Meta,
 * priorizando templates de categoria UTILITY e descartando o template que acabou de falhar.
 */
export function buildExperimentFallbackCandidates<
  T extends {
    id?: string;
    name: string;
    language: string;
    category?: string;
    bodyText: string;
    variableCount: number;
    supported?: boolean;
    bindings?: TemplateBindings;
  },
>(
  templates: T[],
  context: {
    failedMessageText?: string | null;
    customerName?: string | null;
    operatorName?: string | null;
    tenantId?: string | null;
  },
): ExperimentFallbackCandidate<T>[] {
  const normalizedFailed = normalizeTemplateComparisonText(context.failedMessageText || "");
  const rawBodyFailed = String(context.failedMessageText || "").trim();
  const templateNameFromBracket = rawBodyFailed.match(/^\[Template Meta:\s*([^\]]+)\]/i)?.[1]?.trim().toLowerCase();

  const supportedList = (templates || []).filter((t) => t && t.supported !== false && t.bodyText);
  const scored: Array<{ candidate: ExperimentFallbackCandidate<T>; score: number; sameAsFailed: boolean }> = [];

  for (const tpl of supportedList) {
    const parameters = buildAutoFilledTemplateParameters(tpl, context);
    const previewText = renderMetaTemplatePreview(tpl.bodyText, parameters);
    const normalizedPreview = normalizeTemplateComparisonText(previewText);
    const sameByText = Boolean(normalizedFailed && normalizedPreview === normalizedFailed);
    const sameByName = Boolean(templateNameFromBracket && tpl.name.toLowerCase() === templateNameFromBracket);
    const sameAsFailed = sameByText || sameByName;

    const isUtility = (tpl.category || "").toUpperCase() === "UTILITY";
    let score = 0;
    if (isUtility) score += 100;
    if (/atendimento|sequ[eê]ncia|contato|solicita[cç][aã]o|or[cç]amento|conversar|retorno/i.test(tpl.bodyText)) {
      score += 25;
    }
    if (/^(?:ol[aá]|oi|bom dia|boa tarde)/i.test(tpl.bodyText.trim())) {
      score += 15;
    }
    if (tpl.variableCount <= 2) {
      score += 10;
    }

    scored.push({
      candidate: {
        template: tpl,
        parameters,
        previewText,
        isUtility,
      },
      score,
      sameAsFailed,
    });
  }

  const distinct = scored.filter((item) => !item.sameAsFailed);
  const pool = distinct.length > 0 ? distinct : scored.filter((item) => item.candidate.isUtility);
  pool.sort((a, b) => b.score - a.score || a.candidate.template.name.localeCompare(b.candidate.template.name, "pt-BR"));
  return pool.map((item) => item.candidate);
}


