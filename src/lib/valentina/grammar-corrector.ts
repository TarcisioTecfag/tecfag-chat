/**
 * grammar-corrector.ts
 *
 * Motor determinístico ultra-rápido (0ms, zero dependências de servidor) para:
 * 1. Expansão garantida de abreviações de WhatsApp/chat PT-BR (vc, pra, pro, mt, tb, pq, q, obg, blz, hj, agr, etc.)
 * 2. Correção de acentuação em vocabulário comercial/industrial frequente (máquina, orçamento, manutenção, vácuo, produção, etc.)
 * 3. Validação de fidelidade anti-alucinação (impede que o LLM reescreva ou mude o sentido do rascunho do operador)
 */

function applyCasePattern(source: string, replacement: string): string {
  if (!source) return replacement;
  if (source.length > 1 && source === source.toUpperCase() && source !== source.toLowerCase()) {
    return replacement.toUpperCase();
  }
  if (source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const WORD_REPLACEMENTS: Array<[RegExp, string | ((match: string) => string)]> = [
  // Pronomes e formas de tratamento abreviadas
  [/(?<![\p{L}\p{N}_])vc(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "você")],
  [/(?<![\p{L}\p{N}_])vcs(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "vocês")],
  [/(?<![\p{L}\p{N}_])voce(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "você")],
  [/(?<![\p{L}\p{N}_])voces(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "vocês")],

  // Preposições contraídas informais (pra, pro, pras, pros)
  [/(?<![\p{L}\p{N}_])pra(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "para")],
  [/(?<![\p{L}\p{N}_])pras(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "para as")],
  [/(?<![\p{L}\p{N}_])pro(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "para o")],
  [/(?<![\p{L}\p{N}_])pros(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "para os")],

  // Intensificadores e quantificadores
  [/(?<![\p{L}\p{N}_])(?:mt|mto)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "muito")],
  [/(?<![\p{L}\p{N}_])mta(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "muita")],
  [/(?<![\p{L}\p{N}_])(?:mts|mtos)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "muitos")],
  [/(?<![\p{L}\p{N}_])mtas(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "muitas")],
  [/(?<![\p{L}\p{N}_])(?:tb|tbm|tambem)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "também")],
  [/(?<![\p{L}\p{N}_])td(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "tudo")],
  [/(?<![\p{L}\p{N}_])tds(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "todos")],
  [/(?<![\p{L}\p{N}_])tda(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "toda")],
  [/(?<![\p{L}\p{N}_])tdas(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "todas")],

  // Conectivos, interjeições e rotina de chat
  [/(?<![\p{L}\p{N}_])oq(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "o que")],
  [/(?<![\p{L}\p{N}_])q(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "que")],
  [/(?<![\p{L}\p{N}_])(?:kd|cde)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "cadê")],
  [/(?<![\p{L}\p{N}_])blz(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "beleza")],
  [/(?<![\p{L}\p{N}_])(?:obg|obgd)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "obrigado")],
  [/(?<![\p{L}\p{N}_])hj(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "hoje")],
  [/(?<![\p{L}\p{N}_])agr(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "agora")],
  [/(?<![\p{L}\p{N}_])(?:pfv|pfvr)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "por favor")],
  [/(?<![\p{L}\p{N}_])msg(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "mensagem")],
  [/(?<![\p{L}\p{N}_])msgs(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "mensagens")],
  [/(?<![\p{L}\p{N}_])ctz(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "certeza")],
  [/(?<![\p{L}\p{N}_])vlw(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "valeu")],
  [/(?<![\p{L}\p{N}_])(?:qdo|qnd)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "quando")],
  [/(?<![\p{L}\p{N}_])qto(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "quanto")],
  [/(?<![\p{L}\p{N}_])qtos(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "quantos")],
  [/(?<![\p{L}\p{N}_])cmg(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "comigo")],
  [/(?<![\p{L}\p{N}_])ctg(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "contigo")],
  [/(?<![\p{L}\p{N}_])nd(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "nada")],
  [/(?<![\p{L}\p{N}_])ngm(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "ninguém")],
  [/(?<![\p{L}\p{N}_])algm(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "alguém")],
  [/(?<![\p{L}\p{N}_])eh(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "é")],
  [/(?<![\p{L}\p{N}_])ta(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "está")],
  [/(?<![\p{L}\p{N}_])tava(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "estava")],
  [/(?<![\p{L}\p{N}_])nao(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "não")],
  [/(?<![\p{L}\p{N}_])ja(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "já")],
  [/(?<![\p{L}\p{N}_])so(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "só")],
  [/(?<![\p{L}\p{N}_])ate(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "até")],
  [/(?<![\p{L}\p{N}_])apos(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "após")],
  [/(?<![\p{L}\p{N}_])entao(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "então")],
  [/(?<![\p{L}\p{N}_])estao(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "estão")],
  [/(?<![\p{L}\p{N}_])sao(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "são")],
  [/(?<![\p{L}\p{N}_])sera(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "será")],
  [/(?<![\p{L}\p{N}_])serao(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "serão")],
  [/(?<![\p{L}\p{N}_])tera(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "terá")],
  [/(?<![\p{L}\p{N}_])estara(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "estará")],

  // Vocabulário técnico e comercial frequente sem acento
  [/(?<![\p{L}\p{N}_])maquina(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "máquina")],
  [/(?<![\p{L}\p{N}_])maquinas(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "máquinas")],
  [/(?<![\p{L}\p{N}_])orcamento(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "orçamento")],
  [/(?<![\p{L}\p{N}_])orcamentos(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "orçamentos")],
  [/(?<![\p{L}\p{N}_])(?:manutencao|manutençao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "manutenção")],
  [/(?<![\p{L}\p{N}_])assistencia(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "assistência")],
  [/(?<![\p{L}\p{N}_])tecnico(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "técnico")],
  [/(?<![\p{L}\p{N}_])tecnica(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "técnica")],
  [/(?<![\p{L}\p{N}_])tecnicos(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "técnicos")],
  [/(?<![\p{L}\p{N}_])tecnicas(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "técnicas")],
  [/(?<![\p{L}\p{N}_])peca(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "peça")],
  [/(?<![\p{L}\p{N}_])pecas(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "peças")],
  [/(?<![\p{L}\p{N}_])video(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "vídeo")],
  [/(?<![\p{L}\p{N}_])videos(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "vídeos")],
  [/(?<![\p{L}\p{N}_])catalogo(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "catálogo")],
  [/(?<![\p{L}\p{N}_])catalogos(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "catálogos")],
  [/(?<![\p{L}\p{N}_])numero(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "número")],
  [/(?<![\p{L}\p{N}_])numeros(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "números")],
  [/(?<![\p{L}\p{N}_])horario(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "horário")],
  [/(?<![\p{L}\p{N}_])horarios(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "horários")],
  [/(?<![\p{L}\p{N}_])(?:informacao|informaçao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "informação")],
  [/(?<![\p{L}\p{N}_])(?:informacoes|informaçoes)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "informações")],
  [/(?<![\p{L}\p{N}_])(?:producao|produçao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "produção")],
  [/(?<![\p{L}\p{N}_])(?:cotacao|cotaçao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "cotação")],
  [/(?<![\p{L}\p{N}_])(?:automacao|automaçao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "automação")],
  [/(?<![\p{L}\p{N}_])(?:operacao|operaçao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "operação")],
  [/(?<![\p{L}\p{N}_])(?:solucao|soluçao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "solução")],
  [/(?<![\p{L}\p{N}_])(?:solucoes|soluçoes)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "soluções")],
  [/(?<![\p{L}\p{N}_])(?:condicao|condiçao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "condição")],
  [/(?<![\p{L}\p{N}_])(?:condicoes|condiçoes)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "condições")],
  [/(?<![\p{L}\p{N}_])(?:instalacao|instalaçao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "instalação")],
  [/(?<![\p{L}\p{N}_])(?:especificacao|especificaçao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "especificação")],
  [/(?<![\p{L}\p{N}_])(?:especificacoes|especificaçoes)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "especificações")],
  [/(?<![\p{L}\p{N}_])valvula(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "válvula")],
  [/(?<![\p{L}\p{N}_])valvulas(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "válvulas")],
  [/(?<![\p{L}\p{N}_])vacuo(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "vácuo")],
  [/(?<![\p{L}\p{N}_])(?:inducao|induçao)(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "indução")],
  [/(?<![\p{L}\p{N}_])disponivel(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "disponível")],
  [/(?<![\p{L}\p{N}_])disponiveis(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "disponíveis")],
  [/(?<![\p{L}\p{N}_])possivel(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "possível")],
  [/(?<![\p{L}\p{N}_])util(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "útil")],
  [/(?<![\p{L}\p{N}_])uteis(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "úteis")],
  [/(?<![\p{L}\p{N}_])facil(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "fácil")],
  [/(?<![\p{L}\p{N}_])rapido(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "rápido")],
  [/(?<![\p{L}\p{N}_])rapida(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "rápida")],
  [/(?<![\p{L}\p{N}_])proximo(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "próximo")],
  [/(?<![\p{L}\p{N}_])proxima(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "próxima")],
  [/(?<![\p{L}\p{N}_])duvida(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "dúvida")],
  [/(?<![\p{L}\p{N}_])duvidas(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "dúvidas")],
  [/(?<![\p{L}\p{N}_])analise(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "análise")],
  [/(?<![\p{L}\p{N}_])serie(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "série")],
  [/(?<![\p{L}\p{N}_])codigo(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "código")],
  [/(?<![\p{L}\p{N}_])codigos(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "códigos")],
  [/(?<![\p{L}\p{N}_])eletrica(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "elétrica")],
  [/(?<![\p{L}\p{N}_])eletrico(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "elétrico")],
  [/(?<![\p{L}\p{N}_])pneumatica(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "pneumática")],
  [/(?<![\p{L}\p{N}_])pneumatico(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "pneumático")],
  [/(?<![\p{L}\p{N}_])automatica(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "automática")],
  [/(?<![\p{L}\p{N}_])automatico(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "automático")],
  [/(?<![\p{L}\p{N}_])liquido(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "líquido")],
  [/(?<![\p{L}\p{N}_])liquidos(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "líquidos")],
  [/(?<![\p{L}\p{N}_])plastico(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "plástico")],
  [/(?<![\p{L}\p{N}_])plasticos(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "plásticos")],
  [/(?<![\p{L}\p{N}_])aluminio(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "alumínio")],
  [/(?<![\p{L}\p{N}_])(?:razao|raçao)(?![\p{L}\p{N}_])/giu, (m) =>
    m.toLowerCase().startsWith("raz") ? applyCasePattern(m, "razão") : applyCasePattern(m, "ração"),
  ],
  [/(?<![\p{L}\p{N}_])ola(?![\p{L}\p{N}_])/giu, (m) => applyCasePattern(m, "olá")],

  // Siglas comerciais padrão em maiúsculo
  [/(?<![\p{L}\p{N}_])cnpj(?![\p{L}\p{N}_])/giu, "CNPJ"],
  [/(?<![\p{L}\p{N}_])cpf(?![\p{L}\p{N}_])/giu, "CPF"],
  [/(?<![\p{L}\p{N}_])cep(?![\p{L}\p{N}_])/giu, "CEP"],
];

/**
 * Expande abreviações ("vc", "pra", "pro", "mt", "tb", "pq", "q", "obg", "blz", "hj", "agr")
 * e corrige acentuação de forma 100% determinística, preservando URLs e códigos.
 */
export function expandPtBrAbbreviationsAndAccents(input: string): string {
  if (!input || !input.trim()) return input;

  const protectedTokens: string[] = [];
  let working = input.replace(
    /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
    (match) => {
      const idx = protectedTokens.length;
      protectedTokens.push(match);
      return `__URL_TOKEN_${idx}__`;
    },
  );

  // Tratamento contextual de "pq" ("por que" em início de pergunta vs "porque" explicativo)
  working = working.replace(/(?<![\p{L}\p{N}_])pq(?![\p{L}\p{N}_])/giu, (match, offset, fullStr) => {
    const before = fullStr.slice(0, offset).trim();
    const after = fullStr.slice(offset + match.length);
    const isStartOfClause = before.length === 0 || /[.!?\n:;]$/.test(before);
    const hasQuestionMarkAhead = /\?/.test(after);
    const target = isStartOfClause && hasQuestionMarkAhead ? "por que" : "porque";
    return applyCasePattern(match, target);
  });

  // Tratamento contextual de "n" isolado antes de verbos comuns
  working = working.replace(
    /(?<![\p{L}\p{N}_])(n)\s+(?=(?:tem|tenho|tinha|consigo|consegue|conseguiu|sei|sabe|funciona|funcionou|vai|vou|pode|podemos|da|dá|deu|chegou|recebi|recebeu|fiz|fez|quero|quer|precisa|preciso)\b)/giu,
    (fullMatch, nToken) => {
      const suffix = fullMatch.slice(nToken.length);
      return applyCasePattern(nToken, "não") + suffix;
    },
  );

  // Tratamento contextual de "to" antes de gerúndio/preposição comum
  working = working.replace(
    /(?<![\p{L}\p{N}_])(to)\s+(?=(?:vendo|mandando|enviando|verificando|olhando|falando|tentando|aguardando|esperando|fazendo|indo|saindo|chegando|no|na|com|em|por|aqui)\b)/giu,
    (fullMatch, toToken) => {
      const suffix = fullMatch.slice(toToken.length);
      return applyCasePattern(toToken, "estou") + suffix;
    },
  );

  for (const [regex, replacer] of WORD_REPLACEMENTS) {
    working = working.replace(regex, replacer as any);
  }

  // Corrige "seladora continua" -> "seladora contínua"
  working = working.replace(
    /\b(seladora|seladoras)\s+(continua|continuas)\b/giu,
    (_, noun, adj) => {
      const fixedAdj = adj.toLowerCase().endsWith("s") ? "contínuas" : "contínua";
      return `${noun} ${applyCasePattern(adj, fixedAdj)}`;
    },
  );

  // Capitaliza primeira letra do texto e após pontuação final (. ! ?)
  working = working.replace(/(^\s*|[.!?]\s+|\n\s*)([\p{Ll}])/gu, (_, prefix, letter) => {
    return `${prefix}${letter.toUpperCase()}`;
  });

  working = working.replace(/__URL_TOKEN_(\d+)__/g, (_, idxStr) => {
    return protectedTokens[Number(idxStr)] || "";
  });

  return working;
}

function extractSignificantWords(text: string): string[] {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

/**
 * Garante que a IA não reescreveu a frase, não inventou saudações e não respondeu à pergunta do vendedor.
 */
export function validateGrammarFidelity(
  preExpandedDraft: string,
  aiCandidate: string,
): { valid: boolean; reason?: string } {
  const cleanOriginal = (preExpandedDraft || "").trim();
  const cleanCandidate = (aiCandidate || "").trim();

  if (!cleanCandidate) {
    return { valid: false, reason: "empty_candidate" };
  }

  if (
    /^(?:aqui est[aá]|texto corrigido|corre[cç][aã]o:|claro[,!]|segue o texto)/i.test(
      cleanCandidate,
    )
  ) {
    return { valid: false, reason: "meta_commentary_detected" };
  }

  const greetingPattern = /^(?:ol[aá]|oi|bom dia|boa tarde|boa noite|prezado|caro cliente)\b/i;
  if (!greetingPattern.test(cleanOriginal) && greetingPattern.test(cleanCandidate)) {
    return { valid: false, reason: "unsolicited_greeting_added" };
  }

  const origHadQuestion =
    cleanOriginal.includes("?") ||
    /^(?:qual|quais|como|quando|onde|quanto|quantos|por que|voc[eê] tem|voc[eê] pode|consegue)\b/i.test(
      cleanOriginal,
    );
  const candHasQuestion = cleanCandidate.includes("?");
  if (origHadQuestion && !candHasQuestion && cleanOriginal.includes("?")) {
    return { valid: false, reason: "question_turned_into_statement" };
  }

  const origWords = cleanOriginal.split(/\s+/).filter(Boolean);
  const candWords = cleanCandidate.split(/\s+/).filter(Boolean);

  if (origWords.length >= 3) {
    const ratio = candWords.length / origWords.length;
    if (ratio < 0.55 || ratio > 1.55) {
      return { valid: false, reason: `word_count_ratio_out_of_bounds_${ratio.toFixed(2)}` };
    }
  }

  const origSig = extractSignificantWords(cleanOriginal);
  const candSig = extractSignificantWords(cleanCandidate);

  if (origSig.length >= 2) {
    let matched = 0;
    for (const w of origSig) {
      const stem = w.slice(0, Math.min(w.length, 5));
      if (candSig.some((cw) => cw.startsWith(stem) || w.startsWith(cw.slice(0, 5)))) {
        matched++;
      }
    }
    const overlap = matched / origSig.length;
    if (overlap < 0.65) {
      return { valid: false, reason: `low_lexical_fidelity_${overlap.toFixed(2)}` };
    }
  }

  return { valid: true };
}
