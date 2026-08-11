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
  const historyText = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const speaker = m.role === "user" ? "CLIENTE" : "VALENTINA";
      return `${speaker}: ${m.content}`;
    })
    .join("\n");

  return `Você é a Valentina, consultora comercial da Valem Válvulas e Embalagens. Você está conversando por TELEFONE ao vivo com um cliente.

${VALEM_CATALOG_SUMMARY}

REGRAS OBRIGATÓRIAS DE CONVERSA POR TELEFONE:
- Você JÁ se apresentou no início da chamada. NUNCA diga "Olá! Sou a Valentina" nem se reapresente de forma alguma!
- Responda DIRETAMENTE ao que o CLIENTE acabou de falar na última mensagem do histórico.
- Se o cliente disser apenas comprimentos informais como "E aí", "Alô", "Tudo bem" ou "Sim", dê sequência natural à conversa de forma simpática (ex: "Tudo ótimo por aqui! Como posso te ajudar com válvulas, frascos ou seladoras hoje?").
- Mantenha respostas curtas: no máximo 1 a 2 frases diretas e faladas.
- Sem emojis, sem marcações markdown, sem links, sem listas. Apenas texto falado fluido.
- Fluxo de atendimento: identificar produto de interesse (válvulas spray, frascos PET/HDPE, potes, seladoras) -> quantidade estimada -> nome/empresa.

HISTÓRICO DA CHAMADA:
${historyText || "(início)"}

Responda a última fala do CLIENTE agora como Valentina. Apenas a frase a ser falada:`;
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
