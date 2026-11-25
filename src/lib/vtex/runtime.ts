import type { IndustrialDatabase } from "../triage/industrial-rodizio-store";
import { readVtexConfig, credentialsForVtex } from "./store";
import { queryVtex } from "./client";
import {
  deriveVtexQuery,
  formatVtexAnswer,
  formatVtexAiContext,
  blockedVtexAnswer,
  safeVtexEvidence,
} from "./turn";
import type { VtexChannel } from "./contract";
export async function runVtexStoreTurn(
  database: IndustrialDatabase,
  tenantId: string,
  input: {
    text: string;
    channel: VtexChannel;
    siteContext: unknown;
    previous?: { selectedSkuId?: string | null; status?: string };
    signal?: AbortSignal;
    fetch?: typeof fetch;
  },
) {
  const request = deriveVtexQuery(input.text, input.siteContext, input.previous);
  if (!request) return null;
  const state = await readVtexConfig(database, tenantId);
  if (!state.settings.enabled || state.row?.enabled !== 1) return null;
  const policy = state.settings.channels[input.channel];
  if (
    !policy.catalog ||
    (request.intent === "price" && !policy.price) ||
    (request.intent === "shipping" && !policy.shipping)
  ) {
    if (
      input.channel === "whatsapp" &&
      policy.catalog &&
      (request.intent === "price" || request.intent === "shipping")
    ) {
      const blockedTopic =
        request.intent === "price"
          ? "valores, preços ou condições comerciais"
          : "frete e prazo de entrega";
      return {
        messages: [blockedVtexAnswer(input.channel, request.intent)],
        evidence: null,
        mode: "ai_context" as const,
        aiContext: [
          `DIRETRIZ DE POLÍTICA COMERCIAL NO WHATSAPP (${request.intent.toUpperCase()} RESTRITO):`,
          `- O cliente perguntou sobre ${blockedTopic}.`,
          `- NUNCA informe, estime ou invente valores em R$, descontos, frete ou prazo de entrega.`,
          `- Explique de forma breve, natural e humana que o especialista comercial confirma ${blockedTopic} aqui mesmo no WhatsApp assim que receber os detalhes do projeto (NUNCA repita frases robóticas idênticas se você já explicou isso em turno anterior).`,
          `- Responda também quaisquer outras solicitações feitas na mesma mensagem (ex.: pedido de vídeo, dúvida técnica ou aplicação) e dê continuidade natural à próxima pergunta pendente da triagem.`,
        ].join("\n"),
      };
    }
    return {
      messages: [blockedVtexAnswer(input.channel, request.intent)],
      evidence: null,
      mode: "direct_reply" as const,
    };
  }
  if (!request.query)
    return {
      messages: [
        "Pode enviar o link do produto ou informar o SKU para eu consultar a referência correta?",
      ],
      evidence: null,
      mode: "direct_reply" as const,
    };
  try {
    const result = await queryVtex(state.settings, request.query, input.channel, {
      signal: input.signal,
      fetch: input.fetch,
      intent: request.intent,
      shippingRequested: request.intent === "shipping",
      credentials: credentialsForVtex(tenantId, state),
    });
    // Consulta livre por termo (sem SKU ou URL explícitos) que não encontra produto na loja
    // nunca deve sequestrar a triagem consultiva (WhatsApp ou Site) com "envie link ou SKU".
    if (
      request.query.kind === "term" &&
      (result.status === "not_found" || result.status === "unavailable")
    ) {
      return null;
    }
    if (
      request.isImplicitSitePage &&
      (result.status === "not_found" ||
        result.status === "unavailable" ||
        result.status === "policy_blocked")
    ) {
      return null;
    }
    // Em consultas de detalhes/link/ficha do produto (tanto no WhatsApp quanto no Site/LiveChat),
    // entrega os dados oficiais limpos para o Fagner (Gemini) responder de forma curta, consultiva
    // e obrigatoriamente com uma pergunta de continuidade da triagem (evitando texto truncado sem gancho).
    const shouldFeedAiContext =
      (input.channel === "whatsapp" || input.channel === "livechat") &&
      request.intent === "details" &&
      (result.status === "matched" ||
        (result.status === "choices" && result.products.length === 1));
    const aiContext = shouldFeedAiContext
      ? formatVtexAiContext(result, input.channel, input.text)
      : null;
    const baseMessages = formatVtexAnswer(result, request.intent);
    const livechatNeedsHook =
      input.channel === "livechat" &&
      !aiContext &&
      result.status === "matched" &&
      !(request.intent === "shipping" && result.shippingStatus === "needs_postal_code");
    const messages = livechatNeedsHook
      ? [
          ...baseMessages,
          "Para eu confirmar se este equipamento atende bem a sua operação, o que você pretende embalar/processar e qual a produção aproximada?",
        ]
      : baseMessages;
    return {
      messages,
      evidence: safeVtexEvidence(result),
      mode: aiContext ? ("ai_context" as const) : ("direct_reply" as const),
      ...(aiContext ? { aiContext } : {}),
    };
  } catch {
    if (request.isImplicitSitePage) {
      return null;
    }
    return {
      messages: [
        "A consulta da loja está indisponível agora. A equipe responsável pode conferir os dados.",
      ],
      evidence: null,
      mode: "direct_reply" as const,
    };
  }
}
