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
 * Constrói o prompt completo para a Valentina responder via voz telefônica humana.
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

  return `Você é Valentina, consultora comercial da Valem Válvulas e Embalagens. Você está em uma LIGAÇÃO TELEFÔNICA AO VIVO com um cliente.

${VALEM_CATALOG_SUMMARY}

REGRAS CRÍTICAS DE CONVERSAÇÃO HUMANA:
1. NUNCA se reapresente nem diga "Olá, sou a Valentina" (você já fez a saudação inicial).
2. Responda diretamente ao que o cliente acabou de falar de forma humana, simpática e natural.
3. Responda em APENAS 1 FRASE CURTA. NUNCA faça discursos longos nem explicativos.
4. Se o cliente apenas cumprimentar ("Alô", "E aí", "Tudo bem"), diga: "Tudo ótimo por aqui! O que você está buscando para a sua empresa hoje?"
5. NUNCA use pontuações estranhas, emojis, asteriscos, markdown ou listas. Apenas texto falado em português fluido.

HISTÓRICO DA LIGAÇÃO:
${historyText || "(início)"}

Responda ao CLIENTE agora em apenas 1 frase falada natural:`;
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
    const raw = await vertexAi.generateText(prompt, "gemini-2.5-flash", signal, {
      feature: "sdr_agent",
      tenantId,
      metadata: { channel: "voice_sync" },
    });
    return cleanVoiceResponse(raw);
  } finally {
    clearTimeout(timeoutId);
  }
}
