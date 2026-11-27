export type IndustrialQuoteReason = "unanswered_question" | "client_question" | "client_media";

export interface IndustrialMessageQuote {
  messageIndex: number;
  quoteMessageId: string;
  reason?: IndustrialQuoteReason | null;
}

export interface QuotableMessageRef {
  id: string;
  senderType: string;
  senderName?: string | null;
  content?: string | null;
  provider?: string | null;
  externalId?: string | null;
  mediaType?: string | null;
  status?: string | null;
  isInternalNote?: boolean | null;
  /** True quando a mensagem chegou no lote atual (já garantidamente entregue no canal). */
  isCurrentBatch?: boolean;
}

const FAILED_STATUSES = new Set(["failed", "error"]);

const STANDALONE_GREETING_RE =
  /^(?:(?:bom\s+dia|boa\s+tarde|boa\s+noite|ol[aá]|oi)[!.,\s😊👋]*(?:(?:eu\s+)?sou\s+(?:(?:a|o)\s+)?\S+[^?!]*)?|(?:eu\s+)?sou\s+(?:(?:a|o)\s+)?\S+[^?!]*)$/iu;

const REASK_CUE_RE =
  /(?:s[oó]\s+me\s+respond|me\s+respond(?:e|er)\s+isso|me\s+passa\s+isso|me\s+confirma\s+isso|antes\s*,?\s*(?:poderia|consegue|pode|me\s+diz|me\s+passa|s[oó])|isso\s+(?:aqui\s+)?rapidinho|essa\s+informa[cç][aã]o\s+rapidinho|s[oó]\s+essa\s+parte\s+rapidinho)/i;

/**
 * Resolve o `message_id` real aceito pelo endpoint Meta Cloud API (`context.message_id`),
 * bloqueando IDs de canal Site/interno/órfão para nunca quebrar envios na Meta.
 */
export function resolveMetaReplyContextMessageId(
  externalId: string | null | undefined,
  tenantId: string,
  provider?: string | null,
): string | null {
  if (!externalId) return null;
  const prov = String(provider || "")
    .trim()
    .toLowerCase();
  if (prov === "livechat" || prov === "internal") return null;

  const raw = String(externalId).trim();
  if (!raw) return null;
  if (raw.includes(":orphan:") || raw.includes(":mismatch:")) return null;

  const inboundPrefix = `meta:${tenantId}:`;
  const stripped = raw.startsWith(inboundPrefix) ? raw.slice(inboundPrefix.length).trim() : raw;
  if (!stripped) return null;

  if (
    stripped.endsWith("-widget") ||
    stripped.startsWith("lc-") ||
    stripped.startsWith("lcx-") ||
    stripped.startsWith("usr_") ||
    stripped.startsWith("bot-durable-")
  ) {
    return null;
  }

  return stripped;
}

/**
 * Determina se uma mensagem do histórico/lote pode ser citada com segurança no canal ativo.
 * - No Site (`conv-lc-*`): qualquer mensagem pública não-sistema e não-falha da conversa.
 * - No WhatsApp (`meta`/`baileys`): exclui mensagens espelhadas do Site (`provider="livechat"`)
 *   e notas/sistema/falhas; mensagens históricas de bot/agente exigem `externalId` válido no canal.
 */
export function isMessageQuotableOnChannel(
  msg: QuotableMessageRef,
  channel: "whatsapp" | "site",
  tenantId: string,
): boolean {
  const id = String(msg.id || "").trim();
  if (!id) return false;
  if (msg.isInternalNote) return false;
  if (msg.senderType === "system") return false;
  const status = String(msg.status || "")
    .trim()
    .toLowerCase();
  if (FAILED_STATUSES.has(status)) return false;

  if (channel === "site") {
    return true;
  }

  const prov = String(msg.provider || "")
    .trim()
    .toLowerCase();
  if (prov === "livechat" || prov === "internal") return false;
  if (id.startsWith("lcx-") || id.startsWith("lc-")) return false;

  // Mensagem do lote atual recebida no WhatsApp já é válida (mesmo se externalId não veio no item)
  if (msg.isCurrentBatch && msg.senderType === "client") {
    return true;
  }

  // No histórico do WhatsApp, quando o provedor for Meta, garantir que há externalId real
  if (prov === "meta") {
    return Boolean(resolveMetaReplyContextMessageId(msg.externalId, tenantId, prov));
  }

  // Para Baileys (ou mensagens antigas sem provider explícito), basta não ser espelho de site
  return true;
}

/**
 * Formata o nome do autor citado para exibição amigável ao visitante no Widget do Site.
 */
export function resolveSiteQuotedSenderLabel(
  quoted: { senderType?: string | null; senderName?: string | null },
  personaName: string,
): string {
  if (quoted.senderType === "client") return "Você";
  if (quoted.senderType === "bot") return personaName;
  const clean = String(quoted.senderName || "").trim();
  return clean || "Atendente";
}

/**
 * Formata o preview textual de uma mensagem citada para o Widget do Site,
 * escondendo marcadores internos como `[MEDIA:image]med_...` ou `[Anexo_Cliente: ...]`.
 */
export function formatQuotedPreviewForSite(
  rawContent: string | null | undefined,
  mediaInterpretation?: string | null,
  maxLen = 180,
): string {
  const content = String(rawContent || "").trim();
  if (!content) return "Mensagem";

  const lines = content.split(/\r?\n/);
  const firstLine = lines[0]?.trim() || "";
  const restText = lines.slice(1).join(" ").trim();

  const mediaMatch = firstLine.match(/^\[MEDIA:([a-z0-9]+)\]([^:]*)(?::(.+))?$/i);
  if (mediaMatch) {
    const kind = mediaMatch[1].toLowerCase();
    const fileName = mediaMatch[3]?.trim();
    const label =
      kind === "image" || kind === "sticker"
        ? "📷 Imagem"
        : kind === "audio"
          ? "🎤 Áudio"
          : kind === "video"
            ? "🎥 Vídeo"
            : `📄 ${fileName || "Documento"}`;
    const extra = restText || String(mediaInterpretation || "").trim();
    const combined = extra ? `${label}: ${extra}` : label;
    return combined.length > maxLen ? `${combined.slice(0, maxLen - 1).trimEnd()}…` : combined;
  }

  if (/^\[(?:Anexo_Cliente|IMAGE):/i.test(content)) {
    const stripped = content.replace(/\[(?:Anexo_Cliente|IMAGE):[^\]]+\]/gi, "").trim();
    const isPdf = /\.pdf(?:\?|\])/i.test(content);
    const label = isPdf ? "📄 Documento" : "📷 Imagem";
    const combined = stripped ? `${label}: ${stripped}` : label;
    return combined.length > maxLen ? `${combined.slice(0, maxLen - 1).trimEnd()}…` : combined;
  }

  if (/^\[AUDIO:/i.test(content)) {
    const extra = String(mediaInterpretation || "").trim();
    const combined = extra ? `🎤 Áudio: ${extra}` : "🎤 Mensagem de voz";
    return combined.length > maxLen ? `${combined.slice(0, maxLen - 1).trimEnd()}…` : combined;
  }

  const singleLine = content.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLen ? `${singleLine.slice(0, maxLen - 1).trimEnd()}…` : singleLine;
}

function normalizeTextForMatch(text: string): string {
  return String(text || "")
    .replace(/\[SEND_IMAGE:[^\]]+\]/gi, "")
    .replace(/\bHahaha+\b/gi, "kkkkk")
    .replace(/\bHaha+\b/gi, "kkkk")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isStandaloneGreetingBubble(text: string): boolean {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  if (trimmed.includes("?")) return false;
  return STANDALONE_GREETING_RE.test(trimmed);
}

function findMatchingFinalIndex(
  originalText: string,
  originalIndex: number,
  initialCount: number,
  finalMessages: readonly string[],
  usedFinalIndices: ReadonlySet<number>,
): number {
  const normOrig = normalizeTextForMatch(originalText);
  if (!normOrig) return -1;

  // 1. Match exato normalizado
  for (let i = 0; i < finalMessages.length; i++) {
    if (usedFinalIndices.has(i)) continue;
    if (normalizeTextForMatch(finalMessages[i]) === normOrig) {
      return i;
    }
  }

  // 2. Contenção (ex.: remoção de apresentação duplicada no início do balão)
  for (let i = 0; i < finalMessages.length; i++) {
    if (usedFinalIndices.has(i)) continue;
    const normFinal = normalizeTextForMatch(finalMessages[i]);
    if (normFinal.length >= 12 && (normOrig.includes(normFinal) || normFinal.includes(normOrig))) {
      return i;
    }
  }

  // 3. Fallback posicional quando apenas um balão de abertura foi prefixado
  const shift = finalMessages.length - initialCount;
  if (shift >= 0) {
    const shifted = originalIndex + shift;
    if (
      shifted >= 0 &&
      shifted < finalMessages.length &&
      !usedFinalIndices.has(shifted) &&
      !isStandaloneGreetingBubble(finalMessages[shifted])
    ) {
      return shifted;
    }
  }

  return -1;
}

function findFirstSubstantiveIndex(
  finalMessages: readonly string[],
  occupiedIndices?: ReadonlySet<number>,
): number {
  for (let i = 0; i < finalMessages.length; i++) {
    if (occupiedIndices?.has(i)) continue;
    if (!isStandaloneGreetingBubble(finalMessages[i])) return i;
  }
  return -1;
}

function findReaskBubbleIndex(
  finalMessages: readonly string[],
  occupiedIndices?: ReadonlySet<number>,
): number {
  // 1. Prioriza balão que contenha pista explícita de retomada curta
  for (let i = finalMessages.length - 1; i >= 0; i--) {
    if (occupiedIndices?.has(i)) continue;
    if (REASK_CUE_RE.test(finalMessages[i])) return i;
  }
  // 2. Fallback: último balão não-saudação contendo "?"
  for (let i = finalMessages.length - 1; i >= 0; i--) {
    if (occupiedIndices?.has(i)) continue;
    if (finalMessages[i].includes("?") && !isStandaloneGreetingBubble(finalMessages[i])) {
      return i;
    }
  }
  return -1;
}

export interface ResolveIndustrialBubbleQuotesInput {
  tenantId: string;
  channel: "whatsapp" | "site";
  initialAiMessages: readonly string[];
  finalMessages: readonly string[];
  aiMessageQuotes?: readonly IndustrialMessageQuote[] | null;
  legacyQuoteMessageId?: string | null;
  quotableMessages: readonly QuotableMessageRef[];
  batchMediaMessageId?: string | null;
  isGenericGreetingOnly?: boolean;
  isTerminalOrClosingTurn?: boolean;
  wasFullyRewritten?: boolean;
}

/**
 * Planeja com segurança qual mensagem cada balão final do Fagner deve citar.
 *
 * Garantias:
 * - Valida 100% dos IDs contra o catálogo de mensagens citáveis da conversa/canal.
 * - Suporta citação por balão (até 2 por turno), inclusive combinando no mesmo turno
 *   resposta a pergunta/mídia do cliente + retomada de pergunta pendente do Fagner.
 * - Nunca cita o mesmo ID duas vezes, nunca cita balão de saudação pura e nunca
 *   retoma pergunta pendente em turnos terminais/de encerramento.
 * - Se o cliente enviou mídia (foto/áudio/PDF) no lote e nenhum balão citou uma
 *   mensagem do cliente ainda, cita automaticamente a mídia no 1º balão substantivo.
 */
export function resolveIndustrialBubbleQuotes(
  input: ResolveIndustrialBubbleQuotesInput,
): Array<string | undefined> {
  const result: Array<string | undefined> = input.finalMessages.map(() => undefined);
  if (input.finalMessages.length === 0 || input.isGenericGreetingOnly) {
    return result;
  }

  const allowedById = new Map<string, QuotableMessageRef>();
  for (const msg of input.quotableMessages) {
    if (isMessageQuotableOnChannel(msg, input.channel, input.tenantId)) {
      allowedById.set(msg.id, msg);
    }
  }

  const MAX_QUOTES_PER_TURN = 2;
  const usedQuoteIds = new Set<string>();
  const usedFinalIndices = new Set<number>();
  let hasClientMessageQuote = false;
  let assignedCount = 0;

  const tryAssign = (
    finalIdx: number,
    quoteId: string,
    reason?: IndustrialQuoteReason | null,
  ): boolean => {
    if (assignedCount >= MAX_QUOTES_PER_TURN) return false;
    if (finalIdx < 0 || finalIdx >= input.finalMessages.length) return false;
    if (usedFinalIndices.has(finalIdx)) return false;
    if (usedQuoteIds.has(quoteId)) return false;
    if (isStandaloneGreetingBubble(input.finalMessages[finalIdx])) return false;

    const target = allowedById.get(quoteId);
    if (!target) return false;

    const isBotTarget = target.senderType === "bot";
    const isClientTarget = target.senderType === "client";

    // Turnos terminais/encerramento não retomam pergunta anterior do bot
    if (input.isTerminalOrClosingTurn && (reason === "unanswered_question" || isBotTarget)) {
      return false;
    }
    // Se reason for unanswered_question, exige que o alvo seja mensagem do próprio bot (ou agente SDR)
    if (reason === "unanswered_question" && isClientTarget) {
      return false;
    }
    // Se reason for client_question/client_media, exige que o alvo seja do cliente
    if ((reason === "client_question" || reason === "client_media") && !isClientTarget) {
      return false;
    }

    result[finalIdx] = quoteId;
    usedFinalIndices.add(finalIdx);
    usedQuoteIds.add(quoteId);
    assignedCount += 1;
    if (isClientTarget) hasClientMessageQuote = true;
    return true;
  };

  // 1. Citações explícitas por balão retornadas pela IA (`messageQuotes`)
  if (!input.wasFullyRewritten && input.aiMessageQuotes && input.aiMessageQuotes.length > 0) {
    for (const q of input.aiMessageQuotes) {
      if (assignedCount >= MAX_QUOTES_PER_TURN) break;
      const quoteId = String(q.quoteMessageId || "").trim();
      if (!quoteId || !allowedById.has(quoteId)) continue;

      const target = allowedById.get(quoteId)!;
      const origText = input.initialAiMessages[q.messageIndex];
      let finalIdx =
        typeof origText === "string"
          ? findMatchingFinalIndex(
              origText,
              q.messageIndex,
              input.initialAiMessages.length,
              input.finalMessages,
              usedFinalIndices,
            )
          : -1;

      if (finalIdx === -1) {
        finalIdx =
          q.reason === "unanswered_question" || target.senderType === "bot"
            ? findReaskBubbleIndex(input.finalMessages, usedFinalIndices)
            : findFirstSubstantiveIndex(input.finalMessages, usedFinalIndices);
      }

      tryAssign(finalIdx, quoteId, q.reason ?? null);
    }
  }

  // 2. Fallback compatível com `quoteMessageId` único da IA
  if (
    !input.wasFullyRewritten &&
    assignedCount === 0 &&
    input.legacyQuoteMessageId &&
    allowedById.has(input.legacyQuoteMessageId.trim())
  ) {
    const quoteId = input.legacyQuoteMessageId.trim();
    const target = allowedById.get(quoteId)!;
    const finalIdx =
      target.senderType === "bot"
        ? findReaskBubbleIndex(input.finalMessages, usedFinalIndices)
        : findFirstSubstantiveIndex(input.finalMessages, usedFinalIndices);
    tryAssign(
      finalIdx,
      quoteId,
      target.senderType === "bot" ? "unanswered_question" : "client_question",
    );
  }

  // 3. Garantia programática de citação de mídia (foto/áudio/PDF) no lote atual
  if (
    !hasClientMessageQuote &&
    input.batchMediaMessageId &&
    allowedById.has(input.batchMediaMessageId)
  ) {
    const firstSubstantive = findFirstSubstantiveIndex(input.finalMessages, usedFinalIndices);
    if (firstSubstantive !== -1) {
      tryAssign(firstSubstantive, input.batchMediaMessageId, "client_media");
    }
  }

  return result;
}
