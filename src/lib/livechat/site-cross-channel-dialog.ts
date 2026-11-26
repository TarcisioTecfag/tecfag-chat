/**
 * Conversa natural via Google Vertex AI (Gemini) na trava cross-channel Site × WhatsApp.
 *
 * Substitui a antiga mensagem fixa/scriptada quando o visitante do Site (`conv-lc-*`)
 * já possui conversa oficial ativa no WhatsApp nas últimas 24h:
 * - Explica com naturalidade o atendimento já aberto no WhatsApp (inclusive respondendo "como assim?").
 * - Pergunta se o cliente prefere continuar pelo WhatsApp para manter tudo no mesmo histórico.
 * - Interpreta a resposta do cliente em turnos seguintes:
 *   • `accept_whatsapp`: encerra o Site mantendo tudo espelhado no WhatsApp.
 *   • `decline_stay_on_site`:
 *       - se no WhatsApp estiver com a IA (`automacao`), permite seguir a triagem no Site
 *         herdando os dados já coletados no WhatsApp;
 *       - se no WhatsApp estiver com consultor humano (`meus`) ou `awaiting_approval`,
 *         acolhe o recado/dúvida no Site sem negociar por cima do consultor e avisa o consultor no WhatsApp.
 *   • `note_for_consultant`: cliente deixou recado/dúvida específica estando ciente do atendimento no WhatsApp.
 *   • `ask_or_clarify`: primeiro contato ou esclarecimento mantendo a conversa natural aberta.
 */
import { z } from "zod";
import type { AiPersona } from "../ai-persona";
import { vertexAi } from "../vertex-ai";
import { formatBrPhoneForDisplay } from "./site-channel-policy";

export type SiteCrossChannelDialogDecision =
  "ask_or_clarify" | "accept_whatsapp" | "decline_stay_on_site" | "note_for_consultant";

export interface SiteCrossChannelDialogInput {
  tenantId: string;
  siteConversationId: string;
  whatsappConversationId: string;
  aiPersona: AiPersona;
  crossChannelReason:
    "whatsapp_human_active" | "whatsapp_triage_in_progress" | "whatsapp_awaiting_approval";
  consultantName?: string | null;
  clientName?: string | null;
  contactPhone?: string | null;
  whatsappHistoryExcerpt: string;
  siteHistoryExcerpt: string;
  latestClientMessage: string;
  alreadyAskedChannelChoice: boolean;
  signal?: AbortSignal;
}

export interface SiteCrossChannelDialogOutput {
  decision: SiteCrossChannelDialogDecision;
  messagesToSend: string[];
  consultantSummaryNote: string | null;
  source: "gemini" | "fallback";
}

const VALID_DECISIONS = new Set<SiteCrossChannelDialogDecision>([
  "ask_or_clarify",
  "accept_whatsapp",
  "decline_stay_on_site",
  "note_for_consultant",
]);

const dialogSchema = z.object({
  decision: z.unknown().transform((raw): SiteCrossChannelDialogDecision => {
    const s = typeof raw === "string" ? raw.trim() : "";
    return VALID_DECISIONS.has(s as SiteCrossChannelDialogDecision)
      ? (s as SiteCrossChannelDialogDecision)
      : "ask_or_clarify";
  }),
  messagesToSend: z.unknown().transform((raw) => {
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    return list
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 1200))
      .filter((item) => item.length > 0)
      .slice(0, 2);
  }),
  consultantSummaryNote: z
    .unknown()
    .optional()
    .transform((raw) => {
      if (typeof raw !== "string") return null;
      const t = raw.trim();
      if (!t || t.toLowerCase() === "null") return null;
      return t.slice(0, 600);
    }),
});

export function parseSiteCrossChannelDialogResult(
  raw: unknown,
): Omit<SiteCrossChannelDialogOutput, "source"> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = dialogSchema.safeParse(raw);
  if (!parsed.success || parsed.data.messagesToSend.length === 0) return null;
  return parsed.data;
}

export function buildSiteCrossChannelDialogPrompt(input: SiteCrossChannelDialogInput): string {
  const formattedPhone = formatBrPhoneForDisplay(input.contactPhone);
  const phoneLast4 = formattedPhone ? formattedPhone.slice(-4) : null;
  const statusDescription =
    input.crossChannelReason === "whatsapp_human_active"
      ? `Já existe uma conversa ATIVA no WhatsApp com o consultor/atendente humano${input.consultantName ? ` ${input.consultantName}` : ""}${phoneLast4 ? ` (telefone final ${phoneLast4})` : ""}.`
      : input.crossChannelReason === "whatsapp_awaiting_approval"
        ? `O cliente acabou de concluir uma triagem no WhatsApp e o atendimento já está sendo direcionado para o especialista responsável por lá${phoneLast4 ? ` (telefone final ${phoneLast4})` : ""}.`
        : `Você mesmo (${input.aiPersona.name}) já está com uma triagem em andamento com este cliente no WhatsApp${phoneLast4 ? ` (telefone final ${phoneLast4})` : ""}.`;

  const refuseRule =
    input.crossChannelReason === "whatsapp_triage_in_progress"
      ? `- Se o cliente recusar ir ao WhatsApp / disser que prefere falar pelo site agora (ex.: "estou sem celular", "prefiro por aqui mesmo"): use \`decision: "decline_stay_on_site"\` (o sistema vai continuar a triagem ali mesmo no site aproveitando os dados já coletados no WhatsApp).`
      : `- Se o cliente recusar ir ao WhatsApp / disser que prefere falar pelo site agora (ex.: "estou sem celular", "prefiro por aqui"): use \`decision: "decline_stay_on_site"\`. NÃO negocie preço, prazo ou condições por cima do consultor — acolha com empatia, diga que já deixou tudo registrado no mesmo histórico do WhatsApp para ${input.consultantName ? input.consultantName : "nossa equipe"} dar continuidade, e pergunte se quer deixar algum recado/detalhe adicional.`;

  return `Você é ${input.aiPersona.name}, assistente virtual de ${input.aiPersona.company}. Tom: ${input.aiPersona.tone}.
O cliente acabou de mandar mensagem no CHAT DO SITE, porém identificamos pelo cadastro dele que já existe um atendimento aberto nas últimas 24h no WHATSAPP.

SITUAÇÃO NO WHATSAPP:
- ${statusDescription}
- Nome do cliente: ${input.clientName || "não informado"}
- Já perguntou antes neste chat do site se o cliente prefere seguir no WhatsApp? ${input.alreadyAskedChannelChoice ? "SIM" : "NÃO"}

HISTÓRICO RECENTE DO WHATSAPP (use apenas para contextualizar com naturalidade se o cliente perguntar "como assim?" ou mencionar o assunto — nunca exponha dados internos do sistema):
${input.whatsappHistoryExcerpt || "(sem mensagens recentes disponíveis)"}

HISTÓRICO ATUAL NO CHAT DO SITE:
${input.siteHistoryExcerpt || "(primeira interação no site)"}

NOVA MENSAGEM DO CLIENTE NO SITE:
${input.latestClientMessage}

SUA MISSÃO (CONVERSA 100% NATURAL E HUMANA — NUNCA ROBÓTICA NEM SCRIPTADA):
1. Converse normalmente como uma pessoa prestativa, curta e educada (1 a 2 balões curtos em português).
2. ${
    input.alreadyAskedChannelChoice
      ? `Você já comentou sobre o atendimento no WhatsApp. Analise a nova resposta do cliente:
   - Se o cliente concordou em seguir no WhatsApp ("sim", "tudo bem", "pode ser", "ok", "vou lá", "sem problema"): defina \`decision: "accept_whatsapp"\` e escreva uma despedida curta e simpática confirmando que pode seguir por lá e que o histórico já ficou todo unificado.
   - Se o cliente perguntou "como assim?", "que conversa?", ou demonstrou dúvida sobre qual conversa é: defina \`decision: "ask_or_clarify"\`, explique de forma clara e natural com base no histórico do WhatsApp acima (ex.: citando ${input.consultantName ? `o atendimento com ${input.consultantName}` : "a conversa aberta hoje"} e/ou o número final ${phoneLast4 || "cadastrado"}) e pergunte com gentileza se teria problema continuar por lá.
   - ${refuseRule}
   - Se o cliente não confirmou ir ao Zap e deixou uma dúvida/recado objetivo destinado ao consultor (quando há humano/aprovação no Zap): defina \`decision: "note_for_consultant"\`, responda acolhendo a mensagem (sem negociar/inventar preço ou prazo por cima do consultor), avise que já encaminhou o recado no mesmo histórico do WhatsApp e preencha \`consultantSummaryNote\` com um resumo objetivo do recado.`
      : `Este é o primeiro aviso neste chat do site:
   - Cumprimente de forma breve e natural (sem textão nem reapresentação robótica), avise que já estamos conversando pelo WhatsApp${input.consultantName ? ` (com ${input.consultantName})` : ""}${phoneLast4 ? ` no número final ${phoneLast4}` : ""} e pergunte gentilmente se teria algum problema em continuarmos por lá para manter todo o histórico junto (ex.: "Oi! Vi aqui que já estamos em atendimento pelo WhatsApp — teria algum problema em continuarmos por lá para manter tudo junto?").
   - Se o cliente já deixou uma pergunta ou recado concreto nesta primeira mensagem (além de um simples "olá"), demonstre que leu o que ele escreveu (e se for caso humano/aprovação, preencha \`consultantSummaryNote\`).
   - Defina \`decision: "ask_or_clarify"\`.`
  }
3. PROIBIDO:
   - NUNCA use frases robóticas como "Já estamos dando continuidade ao seu atendimento pelo WhatsApp! Pode seguir por lá com a nossa equipe para não duplicar informações."
   - NUNCA invente preço, prazo, desconto ou negocie por cima de um consultor humano.
   - NUNCA mencione "CRM", "card", "banco de dados", "sistema" ou "espelhamento".

Retorne EXCLUSIVAMENTE JSON válido:
{
  "decision": "ask_or_clarify | accept_whatsapp | decline_stay_on_site | note_for_consultant",
  "messagesToSend": ["balão 1 curto e natural"],
  "consultantSummaryNote": "resumo objetivo do recado para o consultor ou null"
}`;
}

export function buildSiteCrossChannelFallbackReply(
  input: Pick<
    SiteCrossChannelDialogInput,
    "crossChannelReason" | "consultantName" | "contactPhone" | "alreadyAskedChannelChoice"
  >,
): Omit<SiteCrossChannelDialogOutput, "source"> {
  const formattedPhone = formatBrPhoneForDisplay(input.contactPhone);
  const last4 = formattedPhone ? formattedPhone.slice(-4) : null;
  const phoneHint = last4 ? ` (final ${last4})` : "";
  const whoHint =
    input.crossChannelReason === "whatsapp_human_active" && input.consultantName
      ? ` com ${input.consultantName.split(/\s+/)[0]}`
      : "";
  return {
    decision: "ask_or_clarify",
    messagesToSend: [
      input.alreadyAskedChannelChoice
        ? `Temos um atendimento aberto hoje no WhatsApp${whoHint}${phoneHint}. Tudo bem para você continuarmos por lá para manter todo o histórico junto?`
        : `Oi! Vi aqui que já estamos conversando pelo WhatsApp${whoHint}${phoneHint}. Teria algum problema em continuarmos por lá para manter tudo junto?`,
    ],
    consultantSummaryNote: null,
  };
}

export async function evaluateSiteCrossChannelTurnWithGemini(
  input: SiteCrossChannelDialogInput,
): Promise<SiteCrossChannelDialogOutput> {
  if (!vertexAi.isReady()) {
    return {
      ...buildSiteCrossChannelFallbackReply(input),
      source: "fallback",
    };
  }

  try {
    const prompt = buildSiteCrossChannelDialogPrompt(input);
    const raw = await vertexAi.generateStructuredJson<unknown>(
      prompt,
      "gemini-2.5-flash",
      input.signal,
      {
        tenantId: input.tenantId,
        feature: "sdr_agent",
        generationConfig: { thinkingBudget: 0 },
        metadata: {
          conversationId: input.siteConversationId,
          whatsappConversationId: input.whatsappConversationId,
          mode: "site_cross_channel_dialog",
          crossChannelReason: input.crossChannelReason,
        },
      },
    );
    const parsed = parseSiteCrossChannelDialogResult(raw);
    if (parsed) {
      return { ...parsed, source: "gemini" };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[SiteCrossChannelDialog] Falha ao gerar diálogo Gemini (${input.siteConversationId}):`,
      msg,
    );
  }

  return {
    ...buildSiteCrossChannelFallbackReply(input),
    source: "fallback",
  };
}
