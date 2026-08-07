/**
 * voice-engine.ts
 *
 * Motor de IA da Valentina para conversas de VOZ TELEFÔNICA.
 *
 * Arquitetura "pensar enquanto fala":
 *  1. Webhook inicia streaming Gemini em background
 *  2. Retorna 1ª frase para Twilio imediatamente (~1-2s)
 *  3. Enquanto Twilio fala a 1ª frase (~2-3s), restante é gerado
 *  4. Twilio busca /api/voice-buffer → buffer já está pronto
 *
 * Eliminadas queries ao banco: catálogo da Valem embutido.
 */

import { vertexAi } from "../vertex-ai";
import type { VoiceMessage } from "./voice-types";

export type { VoiceMessage };

// Catálogo resumido da Valem — embutido para eliminar DB call em cada turno
const VALEM_CATALOG_SUMMARY = `
Valem Válvulas e Embalagens — produtos principais:
- Válvulas aerosol (spray): cosméticos, higiene, repelentes, tintas, industriais
- Frascos PET/HDPE: higiene pessoal, limpeza, cosméticos
- Potes e embalagens rígidas: cremes, géis, alimentos
- Seladoras e embaladoras industriais
Diferenciais: entrega rápida, pedido mínimo baixo, suporte técnico, personalização.
`.trim();

/**
 * Constrói o prompt completo para a Valentina responder via voz.
 * Exportado para que o webhook possa usar com streaming.
 */
export function buildVoicePrompt(
  messages: VoiceMessage[],
  tenantId: string = "valem"
): string {
  const isFirstTurn =
    messages.filter((m) => m.role === "user").length === 1 &&
    messages.filter((m) => m.role === "assistant").length === 0;

  const historyText = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const speaker = m.role === "user" ? "CLIENTE" : "VALENTINA";
      return `${speaker}: ${m.content}`;
    })
    .join("\n");

  const openingInstruction = isFirstTurn
    ? `PRIMEIRA FALA: Apresente-se brevemente e pergunte se pode continuar.`
    : `RESPOSTA DIRETA: Nunca se reapresente. Responda ao que o cliente disse.`;

  return `Você é Valentina, SDR da Valem Válvulas e Embalagens. Conversa por TELEFONE.

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
}

/**
 * Limpa a resposta do Gemini removendo markdown residual.
 */
export function cleanVoiceResponse(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .trim();
}

/**
 * Versão síncrona (sem streaming) para compatibilidade com código legado.
 * Para novos usos, use a arquitetura de streaming no webhook diretamente.
 */
export async function generateVoiceResponse(
  messages: VoiceMessage[],
  tenantId: string = "valem",
  externalSignal?: AbortSignal
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  const signal =
    externalSignal && typeof AbortSignal.any !== "undefined"
      ? AbortSignal.any([controller.signal, externalSignal])
      : controller.signal;

  try {
    const prompt = buildVoicePrompt(messages, tenantId);
    const response = await vertexAi.generateText(
      prompt,
      "gemini-2.5-flash",
      signal,
      { tenantId, feature: "sdr_agent", metadata: { channel: "voice_call" } }
    );
    clearTimeout(timeoutId);
    return cleanVoiceResponse(response ?? "Pode repetir? Não ouvi bem.");
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError" || err?.message?.includes("abort")) {
      console.warn("[VoiceEngine] Timeout de 12s — usando fallback");
      return "Desculpe, tive uma instabilidade. Pode repetir o que disse?";
    }
    console.error("[VoiceEngine] Erro:", err?.message ?? err);
    return "Peço desculpas, tive um probleminha técnico. Pode repetir?";
  }
}
