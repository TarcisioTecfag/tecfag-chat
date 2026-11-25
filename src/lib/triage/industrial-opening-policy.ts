import { isOwnSdrOutboundSender } from "./industrial-ownership-guard";

export const INDUSTRIAL_RECENT_CONTEXT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface OpeningMessageSample {
  id?: string | null;
  senderType: string;
  senderName?: string | null;
  content?: string | null;
  sentAt?: Date | string | null;
  isInternalNote?: boolean | null;
  status?: string | null;
  mediaInterpretation?: string | null;
}

export interface OpeningPersonaInfo {
  name: string;
  gender: "male" | "female";
  company: string;
}

export type IndustrialOpeningMode =
  | "ongoing"
  | "active_template_continuation"
  | "fresh_inbound_first_turn";

export interface IndustrialOpeningPlan {
  mode: IndustrialOpeningMode;
  isFirstMessage: boolean;
  hasRecentOwnSdrOutbound: boolean;
  recentOwnSdrMessagePreview: string | null;
  firstMessageRule: string;
}

const FAILED_DELIVERY_STATUSES = new Set(["failed", "error"]);

const QUALIFICATION_PLACEHOLDER_RE =
  /^(?:aguardando|pendente|n[aã]o\s+informado|indefinido|n\/a|null|nenhum|-|\.+)$/i;

const SUBSTANTIVE_CLIENT_CONTEXT_RE =
  /(embalag|valv|válv|spray|frasc|pote|selad|tunel|túnel|encolhim|catal|catál|prec|preç|valor|cota|cotá|orç|orc|sab|comp|prod|inform|duvid|dúvid|maquin|máquin|equipam|envas|empacot|datador|rotulad|fechad|tampad|encapsul|dosad|peca|peça|assist|boleto|nota|nf|rastreio|pedido|manuten|personalit|personnalit|falar|atendent|vendedor|consultor|comprovante|pagamento|curriculo|currículo|caixa|comprimento|largura|altura|compressor|vacuo|vácuo|\b\d+\s*(?:mm|cm|kg|ml|un|pcs|pçs|l)\b)/i;

function toEpochMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ts = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ts) ? ts : null;
}

function isWithinRecentWindow(
  sentAt: Date | string | null | undefined,
  now: Date,
  windowMs: number,
): boolean {
  const ts = toEpochMs(sentAt);
  if (ts === null) return true;
  const ageMs = now.getTime() - ts;
  return ageMs <= windowMs;
}

/**
 * Verifica se o próprio SDR (bot ou template outbound salvo como "Fagner (SDR)" / "Valentina (SDR)")
 * já enviou alguma mensagem pública recente na conversa (incluindo mensagens anteriores ao
 * `flowState.startedAt`, que ficam em `priorRaw`).
 */
export function findRecentOwnSdrOutbound(
  messagesList: ReadonlyArray<OpeningMessageSample>,
  now: Date = new Date(),
  windowMs: number = INDUSTRIAL_RECENT_CONTEXT_WINDOW_MS,
): { found: boolean; latestMessage: OpeningMessageSample | null } {
  let latestMessage: OpeningMessageSample | null = null;
  let latestTs = -Infinity;

  for (const m of messagesList) {
    if (!m || m.isInternalNote) continue;
    const statusNorm = String(m.status || "").trim().toLowerCase();
    const isOwnBot = m.senderType === "bot" && !FAILED_DELIVERY_STATUSES.has(statusNorm);
    const isOwnTemplateAgent =
      m.senderType === "agent" &&
      isOwnSdrOutboundSender(m.senderName) &&
      !FAILED_DELIVERY_STATUSES.has(statusNorm);
    if (!isOwnBot && !isOwnTemplateAgent) continue;
    if (!isWithinRecentWindow(m.sentAt, now, windowMs)) continue;

    const ts = toEpochMs(m.sentAt) ?? 0;
    if (!latestMessage || ts >= latestTs) {
      latestMessage = m;
      latestTs = ts;
    }
  }

  return { found: Boolean(latestMessage), latestMessage };
}

/**
 * Verifica se existem mensagens recentes do cliente anteriores ao lote atual que já
 * contêm contexto de demanda (dúvida, equipamento, medidas, mídia ou texto substantivo).
 */
export function hasPriorRecentClientContext(
  messagesList: ReadonlyArray<OpeningMessageSample>,
  currentBatchIds: ReadonlySet<string>,
  now: Date = new Date(),
  windowMs: number = INDUSTRIAL_RECENT_CONTEXT_WINDOW_MS,
): boolean {
  const priorClientTexts: string[] = [];

  for (const m of messagesList) {
    if (!m || m.isInternalNote || m.senderType !== "client") continue;
    if (m.id && currentBatchIds.has(m.id)) continue;
    if (!isWithinRecentWindow(m.sentAt, now, windowMs)) continue;

    if (m.mediaInterpretation && String(m.mediaInterpretation).trim().length > 0) {
      return true;
    }
    const content = String(m.content || "").trim();
    if (!content) continue;
    if (/^\[MEDIA:/i.test(content)) return true;
    priorClientTexts.push(content);
  }

  if (priorClientTexts.length === 0) return false;
  const combined = priorClientTexts.join(" ").toLowerCase();
  if (SUBSTANTIVE_CLIENT_CONTEXT_RE.test(combined)) return true;
  if (combined.replace(/[^a-z0-9]/g, "").length >= 25) return true;
  return false;
}

/**
 * Verifica se a IA já extraiu demanda/assunto concreto no turno atual.
 */
export function hasMeaningfulExtractedDemand(
  extractedData?: Record<string, unknown> | null,
  subflow?: string | null,
): boolean {
  if (typeof subflow === "string" && subflow.trim().length > 0) {
    return true;
  }
  if (!extractedData || typeof extractedData !== "object") return false;
  const demandKeys = [
    "MÁQUINA / PEÇA / INTERESSE",
    "RAMO / O QUE EMBALA",
    "VOLUME / PRODUÇÃO",
  ];
  for (const key of demandKeys) {
    const rawVal = extractedData[key];
    const str =
      typeof rawVal === "string"
        ? rawVal.trim()
        : rawVal && typeof rawVal === "object" && typeof (rawVal as { value?: unknown }).value === "string"
          ? String((rawVal as { value?: string }).value || "").trim()
          : "";
    if (str.length >= 2 && !QUALIFICATION_PLACEHOLDER_RE.test(str)) {
      return true;
    }
  }
  return false;
}

export function buildIndustrialPresentationLine(
  persona: OpeningPersonaInfo,
  options?: { includeGreeting?: string },
): string {
  const article = persona.gender === "female" ? "a" : "o";
  const companyPrep = /^grupo\b/i.test(persona.company) ? "do" : "da";
  if (options?.includeGreeting) {
    return `${options.includeGreeting} Sou ${article} ${persona.name}, assistente virtual ${companyPrep} ${persona.company} 😊`;
  }
  return `Eu sou ${article} ${persona.name}, assistente virtual ${companyPrep} ${persona.company} 😊`;
}

/**
 * Avalia o plano de abertura do SDR industrial (Fagner) antes de montar o prompt do Gemini:
 * - `ongoing`: o bot/widget já interagiu ou `greetingDone` já foi confirmado neste ciclo.
 * - `active_template_continuation`: não houve turno do bot neste ciclo, mas já existe
 *   mensagem/template ativo recente (<= 7 dias) enviado pelo próprio SDR (ex.: `apresentacao6`,
 *   resgate ou campanha). Nunca reapresenta nem pergunta "Como posso te ajudar?".
 * - `fresh_inbound_first_turn`: primeiro contato receptivo real do cliente.
 */
export function evaluateIndustrialOpeningPlan(input: {
  greetingAlreadyDone: boolean;
  siteWidgetAlreadyGreeted: boolean;
  historyMessages: ReadonlyArray<OpeningMessageSample>;
  priorMessages: ReadonlyArray<OpeningMessageSample>;
  now?: Date;
  aiPersona: OpeningPersonaInfo;
  greeting: string;
}): IndustrialOpeningPlan {
  const now = input.now || new Date();
  const article = input.aiPersona.gender === "female" ? "a" : "o";
  const companyPrep = /^grupo\b/i.test(input.aiPersona.company) ? "do" : "da";

  const hasBotInCurrentCycle = input.historyMessages.some((m) => {
    if (!m || m.isInternalNote || m.senderType !== "bot") return false;
    const statusNorm = String(m.status || "").trim().toLowerCase();
    return !FAILED_DELIVERY_STATUSES.has(statusNorm);
  });

  const combinedMessages = [...input.priorMessages, ...input.historyMessages];
  const recentOwnSdr = findRecentOwnSdrOutbound(combinedMessages, now);

  if (input.siteWidgetAlreadyGreeted && !hasBotInCurrentCycle && !input.greetingAlreadyDone) {
    return {
      mode: "ongoing",
      isFirstMessage: false,
      hasRecentOwnSdrOutbound: recentOwnSdr.found,
      recentOwnSdrMessagePreview: recentOwnSdr.latestMessage?.content
        ? String(recentOwnSdr.latestMessage.content).trim().slice(0, 180)
        : null,
      firstMessageRule: `🛑 ATENÇÃO CRÍTICA (CHAT DO SITE — VOCÊ JÁ SE APRESENTOU NA TELA DO VISITANTE!):
   - O widget do chat no site JÁ exibiu automaticamente na tela do cliente sua saudação e apresentação ("Sou ${article} ${input.aiPersona.name}, assistente virtual da Tecfag! Como posso te ajudar hoje?"), mesmo que essas mensagens iniciais do widget não apareçam no histórico acima.
   - 🛑 PROIBIDO se reapresentar ("Olá, [Nome]. Sou ${input.aiPersona.name}...", "Eu sou ${article} ${input.aiPersona.name}, assistente virtual...", "Aqui é ${article} ${input.aiPersona.name}...").
   - Responda DIRETO ao que o cliente disse de forma fluida e conversacional!`,
    };
  }

  if (input.greetingAlreadyDone || input.siteWidgetAlreadyGreeted || hasBotInCurrentCycle) {
    return {
      mode: "ongoing",
      isFirstMessage: false,
      hasRecentOwnSdrOutbound: recentOwnSdr.found,
      recentOwnSdrMessagePreview: recentOwnSdr.latestMessage?.content
        ? String(recentOwnSdr.latestMessage.content).trim().slice(0, 180)
        : null,
      firstMessageRule: `🛑 ATENÇÃO CRÍTICA (ESTA NÃO É A PRIMEIRA MENSAGEM DO ATENDIMENTO! A CONVERSA JÁ ESTÁ EM ANDAMENTO!):
   - Você (${input.aiPersona.name}) JÁ se apresentou anteriormente nesta conversa. PROIBIDO se reapresentar ("Sou ${article} ${input.aiPersona.name}", "assistente virtual", "Aqui é ${article} ${input.aiPersona.name}")!
   - Responda DIRETO ao que o cliente disse de forma fluida e conversacional!`,
    };
  }

  if (recentOwnSdr.found) {
    const preview = recentOwnSdr.latestMessage?.content
      ? String(recentOwnSdr.latestMessage.content).trim().slice(0, 180)
      : null;
    const previewClause = preview ? ` ("${preview}")` : "";
    return {
      mode: "active_template_continuation",
      isFirstMessage: false,
      hasRecentOwnSdrOutbound: true,
      recentOwnSdrMessagePreview: preview,
      firstMessageRule: `🟢 ATENÇÃO — CONTINUAÇÃO DE ABORDAGEM ATIVA RECENTE (CONTATO INICIADO POR VOCÊ):
   - Você (${input.aiPersona.name}) JÁ iniciou esta conversa recentemente com uma mensagem/template ativo${previewClause}.
   - 🛑 PROIBIDO se reapresentar ("Eu sou ${article} ${input.aiPersona.name}..."), PROIBIDO perguntar "Como posso te ajudar?" e PROIBIDO ignorar o tema/equipamento citado no template!
   - LEIA TODO o histórico recente (o template enviado por você + todas as mensagens anteriores do cliente + as novas mensagens recebidas agora) antes de formular a resposta.
   - ✅ Se o cliente apenas concordou ou cumprimentou (ex.: "Sim, podemos!", "Pode sim", "Boa tarde") sem detalhar ainda: dê continuidade direta ao assunto/máquina do template e faça a próxima pergunta de qualificação de forma natural.
   - ✅ Se o cliente já mandou dúvidas, medidas, produto ou contexto (nesta mensagem ou nas anteriores recentes): responda considerando TUDO que ele já informou e peça apenas o próximo dado pendente da triagem.
   - 🛑 PROIBIDO: "tudo bem por aqui?", "tudo joia?", frases de checagem de bem-estar.`,
    };
  }

  return {
    mode: "fresh_inbound_first_turn",
    isFirstMessage: true,
    hasRecentOwnSdrOutbound: false,
    recentOwnSdrMessagePreview: null,
    firstMessageRule: `🟢 ATENÇÃO — PRIMEIRA MENSAGEM DO ATENDIMENTO (CONTATO RECEPTIVO):
   - LEIA TODO O CONTEXTO ANTES DE RESPONDER (todas as mensagens recebidas agora + eventual histórico recente sem resposta).
   - ✅ Se o cliente APENAS SAUDOU (ex.: "Oi", "Bom dia", "Olá") sem informar necessidade, equipamento ou dúvida:
      - Responda de forma breve; o sistema garantirá saudação, apresentação oficial e "Como posso te ajudar?".
   - ✅ Se o cliente JÁ TROUXE CONTEXTO (equipamento, peça, dúvida, foto, áudio, medidas ou histórico recente):
      - NÃO pergunte "Como posso te ajudar?" — ele já disse o que precisa!
      - Abra o 1º balão de forma natural e conectada ao contexto com saudação breve + apresentação como assistente virtual (ex.: "${input.greeting} Sou ${article} ${input.aiPersona.name}, assistente virtual ${companyPrep} ${input.aiPersona.company} 😊") e já responda/conduza a triagem a partir do que o cliente trouxe nos balões seguintes.
   - ✅ Se o cliente JÁ PEDIU LIGAÇÃO: reconheça e continue coletando dados.
   - 🛑 PROIBIDO: "tudo bem por aqui?", "tudo joia?", frases de checagem de bem-estar.`,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLeadingPersonaIntroRegex(personaName: string): RegExp {
  const escapedName = escapeRegExp(personaName);
  // Cobre aberturas opcionais como "Olá, Tarcisio. ", "Boa tarde, João! ", "Oi, tudo bem? "
  // seguidas de apresentação explícita: "Sou (o) Fagner...", "Eu sou o Fagner...", "Aqui é o Fagner...", "Me chamo Fagner..."
  // Não cruza "?" para nunca engolir a pergunta real do balão.
  const optionalGreeting =
    "(?:(?:boa\\s*(?:tarde|noite)|bom\\s*dia|ol[aá]|oi)(?:[\\s,]+[\\p{L}'-]{2,25}){0,2}[!.,\\s]*)?";
  const optionalWellbeing = "(?:tudo\\s+bem\\??\\s*)?";
  const selfIntro =
    `(?:(?:eu\\s+)?sou\\s+(?:(?:a|o)\\s+)?|aqui\\s+[eé]\\s+(?:(?:a|o)\\s+)?|me\\s+chamo\\s+)${escapedName}\\b[^?!.\\n]*`;
  const trailingPunct = "(?:[!.,\\s\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}])*";
  return new RegExp(`^${optionalGreeting}${optionalWellbeing}${selfIntro}${trailingPunct}`, "iu");
}

export function isStandaloneGreetingOrPresentation(msg: string, personaName: string): boolean {
  const trimmed = msg.trim();
  if (!trimmed) return true;
  if (/^(?:boa\s*(?:tarde|noite)|bom\s*dia|ol[aá]|oi)[!.,\s]*$/i.test(trimmed)) {
    return true;
  }
  const introRe = buildLeadingPersonaIntroRegex(personaName);
  if (!introRe.test(trimmed)) return false;
  const remainder = trimmed.replace(introRe, "").trim();
  // Se nada substancial sobrou depois da apresentação, o balão inteiro era reapresentação.
  return remainder.length === 0;
}

/**
 * Remove reapresentação redundante da persona ("Olá, Tarcisio. Sou Fagner, assistente virtual do Grupo Tecfag.")
 * quando a sessão já foi aberta (ex.: widget do site ou turno em andamento).
 * - Se o balão inteiro for só saudação/apresentação, retorna "" (para ser descartado).
 * - Se houver conteúdo/pergunta depois no mesmo balão, remove apenas a frase de apresentação e preserva o restante.
 */
export function stripDuplicatePersonaIntroduction(msg: string, personaName: string): string {
  const trimmed = String(msg || "").trim();
  if (!trimmed) return "";
  if (isStandaloneGreetingOrPresentation(trimmed, personaName)) {
    return "";
  }
  const introRe = buildLeadingPersonaIntroRegex(personaName);
  if (!introRe.test(trimmed)) {
    return trimmed;
  }
  const remainder = trimmed.replace(introRe, "").trim();
  return remainder.length >= 4 ? remainder : "";
}

function alreadyMentionsPersonaIntro(messages: ReadonlyArray<string>, personaName: string): boolean {
  const escapedName = escapeRegExp(personaName);
  const nameRe = new RegExp(`\\b${escapedName}\\b`, "i");
  return messages.slice(0, 2).some((m) => nameRe.test(String(m || "")));
}

/**
 * Finaliza os balões de abertura no modo industrial (Fagner), substituindo a antiga trava cega
 * `isGenericGreetingOnly` + injeção dupla hardcoded que desconectava o fluxo de comunicação.
 */
export function finalizeIndustrialOpeningMessages(input: {
  plan: IndustrialOpeningPlan;
  aiMessages: ReadonlyArray<string>;
  batchTexts: ReadonlyArray<string>;
  batchMessageIds?: ReadonlyArray<string | undefined>;
  hasMediaInBatch: boolean;
  hasStoreTurn: boolean;
  isClientDeclinedTurn: boolean;
  directOperatorStatus?: string | null;
  historyMessages: ReadonlyArray<OpeningMessageSample>;
  priorMessages: ReadonlyArray<OpeningMessageSample>;
  extractedData?: Record<string, unknown> | null;
  subflow?: string | null;
  now?: Date;
  aiPersona: OpeningPersonaInfo;
  greeting: string;
}): {
  messagesToSend: string[];
  isGenericGreetingOnly: boolean;
} {
  const now = input.now || new Date();
  const cleanAiMessages = input.aiMessages.map((m) => String(m || "").trim()).filter(Boolean);
  const { plan } = input;

  if (plan.mode === "ongoing" || plan.mode === "active_template_continuation") {
    const cleaned = cleanAiMessages
      .map((msg) => stripDuplicatePersonaIntroduction(msg, input.aiPersona.name))
      .filter(Boolean);
    return {
      messagesToSend: cleaned.length > 0 ? cleaned : cleanAiMessages,
      isGenericGreetingOnly: false,
    };
  }

  // mode === "fresh_inbound_first_turn"
  const batchIds = new Set(
    (input.batchMessageIds || []).filter((id): id is string => Boolean(id)),
  );
  const combinedBatch = input.batchTexts.join(" ").toLowerCase();
  const hasBatchContext =
    combinedBatch.replace(/[^a-z0-9]/g, "").length >= 25 ||
    SUBSTANTIVE_CLIENT_CONTEXT_RE.test(combinedBatch);

  const hasPriorContext = hasPriorRecentClientContext(
    [...input.priorMessages, ...input.historyMessages],
    batchIds,
    now,
  );
  const hasExtractedDemand = hasMeaningfulExtractedDemand(input.extractedData, input.subflow);

  const isGenericGreetingOnly =
    !input.hasStoreTurn &&
    !input.hasMediaInBatch &&
    !input.isClientDeclinedTurn &&
    (!input.directOperatorStatus || input.directOperatorStatus === "none") &&
    !hasBatchContext &&
    !hasPriorContext &&
    !hasExtractedDemand;

  if (isGenericGreetingOnly) {
    return {
      messagesToSend: [
        input.greeting,
        buildIndustrialPresentationLine(input.aiPersona),
        "Como posso te ajudar?",
      ],
      isGenericGreetingOnly: true,
    };
  }

  // Cliente já trouxe contexto (neste lote, em mensagens recentes anteriores, em mídia ou extraído pela IA):
  // preserva 100% do raciocínio contextual do Gemini; se ele já se apresentou, mantém natural;
  // caso contrário, adiciona 1 único balão curto e consistente de apresentação como assistente virtual.
  if (alreadyMentionsPersonaIntro(cleanAiMessages, input.aiPersona.name)) {
    return {
      messagesToSend: cleanAiMessages,
      isGenericGreetingOnly: false,
    };
  }

  // Remove eventual saudação solta duplicada ("Boa tarde!") antes de prefixar a linha combinada
  const withoutBareGreeting = cleanAiMessages.filter(
    (msg, idx) =>
      !(idx === 0 && /^(?:boa\s*(?:tarde|noite)|bom\s*dia|ol[aá]|oi)[!.,\s]*$/i.test(msg)),
  );
  const bodyMessages = withoutBareGreeting.length > 0 ? withoutBareGreeting : cleanAiMessages;

  return {
    messagesToSend: [
      buildIndustrialPresentationLine(input.aiPersona, { includeGreeting: input.greeting }),
      ...bodyMessages,
    ],
    isGenericGreetingOnly: false,
  };
}
