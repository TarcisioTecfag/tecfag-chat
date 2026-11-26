import { vertexAi, type VertexCallContext } from "../vertex-ai";
import { isPrematureIndustrialHandoffBubble } from "./industrial-handoff";
import {
  buildIndustrialFollowUpText,
  formatFirstNameTitleCase,
  getZonedDateParts,
  DEFAULT_INDUSTRIAL_SCHEDULE,
} from "./industrial-silence-policy";

export const INDUSTRIAL_FOLLOWUP_AI_MODEL = "gemini-2.5-flash";

export type IndustrialFollowUpAiDecisionKind = "send" | "defer" | "skip_close";

export interface IndustrialFollowUpAiMessage {
  senderType: string;
  sentAt: Date | string;
  content?: string | null;
}

export type IndustrialFollowUpAiCaller = <T = Record<string, unknown>>(
  prompt: string,
  model?: string,
  signal?: AbortSignal,
  context?: VertexCallContext,
) => Promise<T | null>;

export interface IndustrialFollowUpAiInput {
  tenantId: string;
  conversationId: string;
  personaName: string;
  personaCompany: string;
  personaGender?: "male" | "female";
  stage: 1 | 2;
  channel: "whatsapp" | "site";
  silenceMinutes: number;
  now: Date;
  timezone?: string;
  subflow?: string | null;
  targetFunnel?: string | null;
  currentStep?: string | null;
  collectedData?: Record<string, unknown> | null;
  missingFields?: string[] | null;
  recentMessages: ReadonlyArray<IndustrialFollowUpAiMessage>;
  /** Opcional para injeção em testes unitários sem chamada externa. */
  aiCaller?: IndustrialFollowUpAiCaller;
}

export interface IndustrialFollowUpAiResult {
  decision: IndustrialFollowUpAiDecisionKind;
  message: string | null;
  deferMinutes: number | null;
  reason: string;
  source: "gemini" | "fallback";
  model: string;
}

const MISSING_FIELD_LABELS: Record<string, string> = {
  "NOME COMPLETO": "nome completo da pessoa (NÃO peça o nome da empresa)",
  name: "nome completo da pessoa (NÃO peça o nome da empresa)",
  "CNPJ OU CPF": "CNPJ ou CPF (se não tiver fácil agora, nome da empresa/cidade já ajuda)",
  document: "CNPJ ou CPF (se não tiver fácil agora, nome da empresa/cidade já ajuda)",
  EMPRESA: "nome da empresa",
  "MÁQUINA / PEÇA / INTERESSE": "máquina, peça ou interesse específico",
  request: "qual máquina, peça ou demanda específica o cliente precisa",
  "RAMO / O QUE EMBALA": "produto/aplicação",
  application: "produto ou aplicação que vai embalar/processar",
  "VOLUME / PRODUÇÃO": "estimativa de produção diária/mensal",
  production: "estimativa de produção por hora ou por dia",
  "SETOR / FUNIL DE DESTINO": "motivo do contato",
};

const GENERIC_ROBOTIC_PATTERNS = [
  /conseguiu\s+ver\s+minha\s+[uú]ltima\s+mensagem/i,
  /estou\s+passando\s+para\s+saber\s+se\s+voc[eê]\s+recebeu/i,
  /aguardo\s+seu\s+retorno\s+para\s+dar\s+continuidade/i,
];

const INVENTED_PRICE_PATTERN = /r\$\s*\d[\d.,]*/i;
const PROMISED_IMMEDIATE_CALL_PATTERN =
  /\b(?:vou\s+te\s+ligar\s+agora|te\s+ligo\s+em\s+instantes|especialista\s+est[aá]\s+entrando\s+agora|pre[cç]o\s+promocional\s+s[oó]\s+hoje)\b/i;

function getFilledCollectedString(
  collectedData: Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!collectedData || typeof collectedData !== "object") return "";
  const raw = collectedData[key];
  const val =
    typeof raw === "string"
      ? raw.trim()
      : typeof (raw as { value?: unknown } | null)?.value === "string"
        ? String((raw as { value?: unknown }).value).trim()
        : "";
  if (!val || /^(aguardando|n[aã]o informado|-|\?)$/i.test(val)) return "";
  return val;
}

function summarizeCollectedData(collectedData?: Record<string, unknown> | null): string {
  if (!collectedData || typeof collectedData !== "object") return "Nenhum dado coletado ainda.";
  const lines: string[] = [];
  for (const key of Object.keys(collectedData)) {
    if (key.startsWith("_")) continue;
    const val = getFilledCollectedString(collectedData, key);
    if (!val) continue;
    const displayVal = key === "NOME COMPLETO" ? formatFirstNameTitleCase(val) || val : val;
    lines.push(`- ${key}: ${displayVal.slice(0, 120)}`);
  }
  return lines.length > 0 ? lines.join("\n") : "Nenhum dado coletado ainda.";
}

function isPendingFieldAlreadyCollected(
  field: string,
  collectedData?: Record<string, unknown> | null,
): boolean {
  if (!collectedData) return false;
  const norm = field.trim().toLowerCase();
  if (norm === "name" || norm === "nome completo") {
    return Boolean(getFilledCollectedString(collectedData, "NOME COMPLETO"));
  }
  if (norm === "empresa") {
    return Boolean(getFilledCollectedString(collectedData, "EMPRESA"));
  }
  if (norm === "document" || norm === "cnpj ou cpf" || norm === "cnpj" || norm === "cpf") {
    const hasDoc = Boolean(
      getFilledCollectedString(collectedData, "CNPJ OU CPF") ||
        getFilledCollectedString(collectedData, "CNPJ") ||
        getFilledCollectedString(collectedData, "CPF"),
    );
    const hasConfirmedCompany =
      Boolean(getFilledCollectedString(collectedData, "_KNOWN_COMPANY_CONFIRMED")) &&
      Boolean(getFilledCollectedString(collectedData, "EMPRESA"));
    return hasDoc || hasConfirmedCompany;
  }
  if (norm === "request" || norm === "máquina / peça / interesse" || norm === "maquina / peca / interesse") {
    return Boolean(
      getFilledCollectedString(collectedData, "MÁQUINA / PEÇA / INTERESSE") ||
        getFilledCollectedString(collectedData, "SOLICITAÇÃO") ||
        getFilledCollectedString(collectedData, "PRODUTO DE INTERESSE"),
    );
  }
  if (norm === "application" || norm === "ramo / o que embala") {
    return Boolean(getFilledCollectedString(collectedData, "RAMO / O QUE EMBALA"));
  }
  if (norm === "production" || norm === "volume / produção" || norm === "volume / producao") {
    return Boolean(getFilledCollectedString(collectedData, "VOLUME / PRODUÇÃO"));
  }
  return Boolean(getFilledCollectedString(collectedData, field));
}

function summarizeMissingFields(
  missingFields?: string[] | null,
  collectedData?: Record<string, unknown> | null,
): string {
  if (!Array.isArray(missingFields) || missingFields.length === 0) {
    return "Nenhum campo formal listado (avaliar última pergunta aberta na conversa).";
  }
  const remaining = missingFields
    .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
    .filter((f) => !isPendingFieldAlreadyCollected(f, collectedData))
    .slice(0, 8);
  if (remaining.length === 0) {
    return "Nenhum campo formal pendente (avaliar última pergunta aberta na conversa).";
  }
  return remaining.map((f) => `- ${MISSING_FIELD_LABELS[f] || f}`).join("\n");
}

function formatRecentTranscript(
  messages: ReadonlyArray<IndustrialFollowUpAiMessage>,
  personaName: string,
  timezone: string,
): string {
  const slice = messages.slice(-12);
  if (slice.length === 0) return "(sem mensagens)";
  return slice
    .map((m) => {
      const dt = m.sentAt instanceof Date ? m.sentAt : new Date(String(m.sentAt));
      const timeLabel = Number.isFinite(dt.getTime())
        ? (() => {
            const p = getZonedDateParts(dt, timezone);
            return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
          })()
        : "--:--";
      const speaker = m.senderType === "client" ? "Cliente" : personaName;
      const content = String(m.content || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 320);
      return `[${timeLabel}] ${speaker}: ${content || "(mídia/sem texto)"}`;
    })
    .join("\n");
}

function extractRawFirstName(collectedData?: Record<string, unknown> | null): string | null {
  if (!collectedData || typeof collectedData !== "object") return null;
  const entry = collectedData["NOME COMPLETO"] as { value?: unknown } | undefined;
  const raw = typeof entry?.value === "string" ? entry.value.trim() : "";
  if (!raw || /aguardando|n[aã]o informado|visitante|cliente/i.test(raw)) return null;
  const first = raw.split(/\s+/)[0]?.replace(/[^\p{L}-]/gu, "") || "";
  return first.length >= 2 ? first : null;
}

export function buildIndustrialFollowUpJudgePrompt(input: IndustrialFollowUpAiInput): string {
  const tz = input.timezone || DEFAULT_INDUSTRIAL_SCHEDULE.timezone;
  const zonedNow = getZonedDateParts(input.now, tz);
  const nowLabel = `${zonedNow.dateIso} ${String(zonedNow.hour).padStart(2, "0")}:${String(zonedNow.minute).padStart(2, "0")} (${tz})`;
  const transcript = formatRecentTranscript(input.recentMessages, input.personaName, tz);
  const collectedBlock = summarizeCollectedData(input.collectedData);
  const missingBlock = summarizeMissingFields(input.missingFields, input.collectedData);
  const article = input.personaGender === "female" ? "a" : "o";
  const channelLabel = input.channel === "site" ? "Chat ao vivo no Site (visitante em sessão curta)" : "WhatsApp";
  const rawFirst = extractRawFirstName(input.collectedData);
  const firstNameClean = rawFirst ? formatFirstNameTitleCase(rawFirst) : "";

  const stageGuidance =
    input.stage === 1
      ? `ESTÁGIO 1 (Retomada consultiva após ${Math.round(input.silenceMinutes)} min de silêncio):
- Objetivo: destravar a conversa de forma leve, humana e específica ao assunto real que o cliente trouxe.
- Cite o equipamento, peça, produto ou necessidade concreta mencionada na conversa.
- Retome APENAS o próximo ponto pendente (ex.: se parou no CNPJ, diga que se estiver sem o CNPJ fácil agora pode passar só o nome da empresa/cidade; se parou em produção/volume, peça uma estimativa aproximada).
- NUNCA use frase genérica como "Conseguiu ver minha última mensagem?".`
      : `ESTÁGIO 2 (Encerramento elegante sem pressão após ${Math.round(input.silenceMinutes)} min do 1º toque):
- Objetivo: despedida respeitosa deixando o atendimento em aberto para não incomodar, mas referenciando o assunto específico do cliente (ex.: "vou deixar o atendimento sobre a seladora em aberto por aqui...").
- Deve conter a ideia clara de deixar o atendimento em aberto e que quando quiser retomar é só chamar.`;

  return `Você é ${article} ${input.personaName}, consultor(a) de pré-vendas / triagem da ${input.personaCompany}.
Sua tarefa tem DUAS etapas obrigatórias, retornadas em um único objeto JSON válido:

1) DECIDIR se devemos enviar um follow-up agora ("send"), adiar ("defer") ou encerrar silenciosamente sem incomodar ("skip_close").
2) Se — e SOMENTE se — a decisão for "send", redigir uma mensagem curta, natural e 100% personalizada ao histórico real da conversa.

CONTEXTO ATUAL:
- Canal: ${channelLabel}
- Horário atual: ${nowLabel}
- Silêncio desde a última mensagem do bot: ${Math.round(input.silenceMinutes)} minutos
- Subfluxo / Funil / Etapa atual: ${input.subflow || "não definido"} | ${input.targetFunnel || "não definido"} | ${input.currentStep || "Em Triagem"}
- Primeiro nome formatado (se houver): ${firstNameClean || "Não informado"}

DADOS JÁ COLETADOS:
${collectedBlock}

DADOS AINDA PENDENTES:
${missingBlock}

ÚLTIMAS MENSAGENS DA CONVERSA:
${transcript}

REGRAS ESTRITAS PARA A DECISÃO ("decision"):
- Retorne "skip_close" (NÃO enviar) quando:
  a) O cliente já recusou, desistiu, disse que já comprou, não tem interesse agora ou encerrou educadamente (ex.: "obrigado", "agora não", "já resolvi", "só pesquisando", "não precisa").
  b) O assunto não é venda/suporte pendente ou já foi resolvido (ex.: envio de currículo/RH, fornecedor/compras, endereço, dúvida pontual já respondida).
  c) A última mensagem do bot já foi uma despedida cordial, agradecimento final ou pergunta meramente protocolar ("Posso ajudar em algo mais?", "Ficamos à disposição").
  d) O cliente não demonstrou interesse real ou é mensagem automática/URA.
- Retorne "defer" (ADIAR) quando:
  a) O cliente indicou que vai responder mais tarde, em outro horário ou outro dia (ex.: "estou dirigindo", "em reunião", "vejo à tarde", "amanhã te passo", "vou ver com meu sócio") e ainda está cedo para cobrar.
  b) Informe "deferMinutes" entre 60 e 1440 (minutos para esperar antes de reavaliar).
- Retorne "send" (ENVIAR) SOMENTE quando:
  a) Existe interesse/demanda real em aberto (máquina, peça, manutenção, pós-venda, orçamento) E
  b) A última mensagem do bot deixou uma pergunta objetiva ou próximo passo claro aguardando resposta do cliente.

REGRAS PARA A MENSAGEM ("message" — obrigatório apenas se decision === "send"):
${stageGuidance}
- Escreva em português do Brasil, natural de WhatsApp, 1 a 2 frases curtas (máximo 220 caracteres).
- Se usar o nome do cliente, escreva em Title Case (ex.: "${firstNameClean || "Maria"}"), NUNCA em CAIXA ALTA.
- Sem aspas, sem markdown (sem **negrito** ou listas), no máximo 1 emoji sutil ou nenhum.
- PROIBIDO inventar preço/valor (R$), desconto, prazo de entrega ou modelos de máquinas que NÃO apareceram na conversa.
- PROIBIDO prometer ligação ou retorno humano imediato.
- PROIBIDO afirmar que a solicitação já foi registrada/encaminhada ou que um especialista entrará em contato (a triagem ainda está em coleta).
- PROIBIDO pedir qualquer dado que já conste em DADOS JÁ COLETADOS (ex.: se EMPRESA já estiver preenchida, NUNCA peça o nome da empresa novamente; se faltar apenas o nome da pessoa, pergunte como ela se chama e nunca o nome da empresa).

Responda EXCLUSIVAMENTE com JSON puro neste formato:
{
  "decision": "send" | "defer" | "skip_close",
  "deferMinutes": number | null,
  "reason": "motivo curto e objetivo em português (até 140 chars)",
  "message": "texto do follow-up quando decision === 'send', ou null nos demais casos"
}`;
}

export function sanitizeIndustrialFollowUpMessage(
  rawMessage: unknown,
  ctx: {
    collectedData?: Record<string, unknown> | null;
    recentMessages: ReadonlyArray<IndustrialFollowUpAiMessage>;
    stage: 1 | 2;
  },
): { valid: boolean; text: string | null; rejectReason?: string } {
  if (typeof rawMessage !== "string") {
    return { valid: false, text: null, rejectReason: "non_string_message" };
  }

  let text = rawMessage
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\*\*/g, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();

  if (text.length < 18) {
    return { valid: false, text: null, rejectReason: "too_short" };
  }

  // Corrige eventual nome em CAIXA ALTA copiado do cadastro (ex.: "BRUNA" -> "Bruna")
  const rawFirst = extractRawFirstName(ctx.collectedData);
  if (rawFirst && rawFirst === rawFirst.toLocaleUpperCase("pt-BR") && rawFirst.length >= 2) {
    const titleCase = formatFirstNameTitleCase(rawFirst);
    if (titleCase && titleCase !== rawFirst) {
      const escaped = rawFirst.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`\\b${escaped}\\b`, "g"), titleCase);
    }
  }

  // Rejeita preço inventado que não apareceu no histórico
  if (INVENTED_PRICE_PATTERN.test(text)) {
    const historyHasPrice = ctx.recentMessages.some((m) =>
      INVENTED_PRICE_PATTERN.test(String(m.content || "")),
    );
    if (!historyHasPrice) {
      return { valid: false, text: null, rejectReason: "invented_price_blocked" };
    }
  }

  if (PROMISED_IMMEDIATE_CALL_PATTERN.test(text)) {
    return { valid: false, text: null, rejectReason: "forbidden_promise_blocked" };
  }

  if (
    isPrematureIndustrialHandoffBubble(text) ||
    /\b(?:foi\s+(?:registrad[ao]|encaminhad[ao]|direcionad[ao]|transferid[ao])|j[aá]\s+(?:registrei|encaminhei|direcionei|transferi))\b/i.test(
      text,
    )
  ) {
    return { valid: false, text: null, rejectReason: "false_handoff_or_registration_blocked" };
  }

  // No estágio 1, rejeita frases clichês genéricas se o modelo ignorou a instrução de personalização
  if (ctx.stage === 1 && GENERIC_ROBOTIC_PATTERNS.some((re) => re.test(text))) {
    return { valid: false, text: null, rejectReason: "generic_phrase_blocked" };
  }

  if (text.length > 260) {
    // Tenta cortar na última pontuação de frase até 260 chars
    const cut = text.slice(0, 260);
    const lastPunct = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    if (lastPunct >= 60) {
      text = cut.slice(0, lastPunct + 1).trim();
    } else {
      text = `${cut.slice(0, 250).trim()}...`;
    }
  }

  return { valid: true, text };
}

function clampDeferMinutes(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 120;
  return Math.min(1440, Math.max(30, Math.trunc(num)));
}

function normalizeDecisionKind(raw: unknown): IndustrialFollowUpAiDecisionKind | null {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase();
  if (normalized === "send") return "send";
  if (normalized === "defer" || normalized === "postpone" || normalized === "wait") return "defer";
  if (
    normalized === "skip_close" ||
    normalized === "skip" ||
    normalized === "close" ||
    normalized === "do_not_send" ||
    normalized === "none"
  ) {
    return "skip_close";
  }
  return null;
}

/**
 * Executa em 1 única chamada ao Google Vertex AI (gemini-2.5-flash) o juiz de timing
 * ("send" | "defer" | "skip_close") e a redação contextualizada do follow-up industrial.
 * Em caso de falha/timeout da Vertex AI, degrada de forma segura para fallback determinístico.
 */
export async function decideIndustrialFollowUpWithAi(
  input: IndustrialFollowUpAiInput,
): Promise<IndustrialFollowUpAiResult> {
  const fallbackText = buildIndustrialFollowUpText({
    personaName: input.personaName,
    stage: input.stage,
    collectedData: input.collectedData,
    metadata: {
      missingFields: input.missingFields,
      subflow: input.subflow,
      targetFunnel: input.targetFunnel,
    },
  });

  const prompt = buildIndustrialFollowUpJudgePrompt(input);
  const caller: IndustrialFollowUpAiCaller =
    input.aiCaller ||
    ((p, model, signal, ctx) => vertexAi.generateStructuredJson(p, model, signal, ctx));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let raw: Record<string, unknown> | null = null;
    try {
      raw = await caller<Record<string, unknown>>(
        prompt,
        INDUSTRIAL_FOLLOWUP_AI_MODEL,
        controller.signal,
        {
          feature: "sdr_agent",
          tenantId: input.tenantId,
          metadata: {
            conversationId: input.conversationId,
            followupStage: input.stage,
            channel: input.channel,
            kind: "industrial_followup_judge",
          },
          generationConfig: {
            temperature: 0.35,
            maxOutputTokens: 320,
            thinkingBudget: 0,
          },
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!raw || typeof raw !== "object") {
      return {
        decision: "send",
        message: fallbackText,
        deferMinutes: null,
        reason: "ai_empty_response_fallback",
        source: "fallback",
        model: INDUSTRIAL_FOLLOWUP_AI_MODEL,
      };
    }

    const decision = normalizeDecisionKind(raw.decision);
    const reason =
      typeof raw.reason === "string" && raw.reason.trim()
        ? raw.reason.trim().slice(0, 180)
        : "ai_evaluated";

    if (!decision) {
      return {
        decision: "send",
        message: fallbackText,
        deferMinutes: null,
        reason: "ai_invalid_decision_fallback",
        source: "fallback",
        model: INDUSTRIAL_FOLLOWUP_AI_MODEL,
      };
    }

    if (decision === "skip_close") {
      return {
        decision: "skip_close",
        message: null,
        deferMinutes: null,
        reason,
        source: "gemini",
        model: INDUSTRIAL_FOLLOWUP_AI_MODEL,
      };
    }

    if (decision === "defer") {
      return {
        decision: "defer",
        message: null,
        deferMinutes: clampDeferMinutes(raw.deferMinutes),
        reason,
        source: "gemini",
        model: INDUSTRIAL_FOLLOWUP_AI_MODEL,
      };
    }

    const sanitized = sanitizeIndustrialFollowUpMessage(raw.message, {
      collectedData: input.collectedData,
      recentMessages: input.recentMessages,
      stage: input.stage,
    });

    if (!sanitized.valid || !sanitized.text) {
      return {
        decision: "send",
        message: fallbackText,
        deferMinutes: null,
        reason: `${reason} (fallback:${sanitized.rejectReason || "invalid"})`.slice(0, 180),
        source: "fallback",
        model: INDUSTRIAL_FOLLOWUP_AI_MODEL,
      };
    }

    return {
      decision: "send",
      message: sanitized.text,
      deferMinutes: null,
      reason,
      source: "gemini",
      model: INDUSTRIAL_FOLLOWUP_AI_MODEL,
    };
  } catch (err: any) {
    return {
      decision: "send",
      message: fallbackText,
      deferMinutes: null,
      reason: `ai_error_fallback:${String(err?.message || "unknown").slice(0, 120)}`,
      source: "fallback",
      model: INDUSTRIAL_FOLLOWUP_AI_MODEL,
    };
  }
}
