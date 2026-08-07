/**
 * voice-engine.ts
 *
 * Motor de IA da Valentina para conversas de VOZ TELEFÔNICA.
 *
 * Otimizações para latência mínima:
 *  - ZERO chamadas ao banco — catálogo da Valem embutido
 *  - AbortController com timeout de 12s (Twilio corta em 15s)
 *  - Prompt compacto — menos tokens = resposta mais rápida
 *  - gemini-2.5-flash — 5x mais rápido que Pro
 *  - Respostas máximo 2 frases
 */

import { vertexAi } from "../vertex-ai";

export interface VoiceMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// Catálogo resumido da Valem — embutido para eliminar DB call em cada turno
const VALEM_CATALOG_SUMMARY = `
Valem Válvulas e Embalagens — produtos principais:
- Válvulas aerosol (spray): para cosméticos, higiene, repelentes, tintas, industriais
- Frascos PET/HDPE: higiene pessoal, limpeza, cosméticos
- Potes e embalagens rígidas: cremes, géis, alimentos
- Seladoras e embaladoras industriais
Diferenciais: entrega rápida, pedido mínimo baixo, suporte técnico, personalização de embalagens.
Contato comercial: time fecha orçamentos personalizados.
`.trim();

/**
 * Gera a resposta de voz da Valentina.
 * Timeout máximo: 12s (Twilio corta webhook em 15s).
 */
export async function generateVoiceResponse(
  messages: VoiceMessage[],
  tenantId: string = "valem",
  externalSignal?: AbortSignal
): Promise<string> {
  // AbortController com timeout de 12s para não estourar o limite do Twilio
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  // Combina o sinal externo com nosso timeout interno
  const signal = externalSignal
    ? AbortSignal.any
      ? AbortSignal.any([controller.signal, externalSignal])
      : controller.signal
    : controller.signal;

  try {
    // Histórico formatado como texto para o prompt
    const historyText = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const speaker = m.role === "user" ? "CLIENTE" : "VALENTINA";
        return `${speaker}: ${m.content}`;
      })
      .join("\n");

    const isFirstTurn =
      messages.filter((m) => m.role === "user").length === 1 &&
      messages.filter((m) => m.role === "assistant").length === 0;

    const openingInstruction = isFirstTurn
      ? `PRIMEIRA FALA: Apresente-se brevemente e pergunte se pode continuar.`
      : `RESPOSTA DIRETA: Nunca se reapresente. Responda ao que o cliente disse.`;

    const systemPrompt = `Você é Valentina, SDR da Valem Válvulas e Embalagens. Conversa por TELEFONE.

${VALEM_CATALOG_SUMMARY}

REGRAS:
- Máximo 2 frases por resposta. Seja direta e calorosa.
- Sem emojis, sem links, sem markdown.
- Tom: consultora comercial experiente e simpática.
- Se cliente pedir para ligar depois: confirme horário e encerre.
- Fluxo de triagem: interesse → produto → volume → nome → empresa.

${openingInstruction}

CONVERSA:
${historyText || "(início)"}

Responda agora como Valentina. Apenas texto puro.`;

    const response = await vertexAi.generateText(
      systemPrompt,
      "gemini-2.5-flash",
      signal,
      {
        tenantId,
        feature: "sdr_agent",
        metadata: { channel: "voice_call", isFirstTurn },
      }
    );

    clearTimeout(timeoutId);

    if (!response) {
      return "Pode repetir? Não ouvi bem.";
    }

    return response
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/#{1,6}\s/g, "")
      .trim();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError" || err?.message?.includes("abort")) {
      console.warn("[VoiceEngine] Timeout de 12s atingido — usando fallback");
      return "Desculpe, tive uma instabilidade. Pode repetir o que disse?";
    }
    console.error("[VoiceEngine] Erro:", err?.message ?? err);
    return "Peço desculpas, tive um probleminha técnico. Pode repetir?";
  }
}
