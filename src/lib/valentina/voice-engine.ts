/**
 * voice-engine.ts
 *
 * Motor de IA da Valentina para conversas de VOZ TELEFÔNICA.
 * Diferente do sdr-engine.ts (WhatsApp / JSON), este motor:
 *  - Retorna TEXTO PURO (sem JSON estruturado)
 *  - Gera respostas CURTAS (máx. 2-3 sentenças por turno)
 *  - Sem emojis, sem links, sem gírias do WhatsApp
 *  - Tom profissional de SDR fazendo cold call por telefone
 *  - Fluxo de triagem idêntico: Produto → Volume → Empresa → Nome → CNPJ
 *
 * Consumido por: src/routes/api/valentina-voice.ts (Custom LLM do Vapi)
 */

import { vertexAi } from "../vertex-ai";
import { getKnowledgeBaseContext } from "./knowledge-service";

export interface VoiceMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Gera a resposta de voz da Valentina com base no histórico da conversa.
 * @param messages Histórico completo de mensagens (OpenAI format)
 * @param tenantId Sempre "valem" para Valentina
 * @param signal AbortSignal opcional para cancelamento
 * @returns Texto puro para o TTS do Vapi falar no telefone
 */
export async function generateVoiceResponse(
  messages: VoiceMessage[],
  tenantId: string = "valem",
  signal?: AbortSignal
): Promise<string> {
  // Busca base de conhecimento do catálogo Valem
  const knowledgeContext = await getKnowledgeBaseContext(tenantId);

  // Reconstrói o histórico como texto legível para o prompt
  const historyText = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const speaker = m.role === "user" ? "CLIENTE" : "VALENTINA";
      return `${speaker}: ${m.content}`;
    })
    .join("\n");

  // Detecta se é o primeiro turno (apenas system + um user)
  const isFirstTurn =
    messages.filter((m) => m.role === "user").length === 1 &&
    messages.filter((m) => m.role === "assistant").length === 0;

  const openingScript = isFirstTurn
    ? `
SCRIPT DE ABERTURA OBRIGATÓRIO (PRIMEIRA FALA — COLD CALL):
Como esta é a primeira fala da conversa, você DEVE se apresentar imediatamente com este script natural:
"Olá, boa tarde! Aqui é a Valentina, da Valem Válvulas e Embalagens. Tudo bem? Tenho 2 minutinhos com o senhor para falar sobre nossa linha de embalagens e válvulas para produtos de higiene, cosméticos e industriais. Posso continuar?"
Se o cliente der qualquer sinal positivo (sim, pode, fala, oi), inicie a triagem imediatamente sem repetir a apresentação.
`
    : `
Esta NÃO é a primeira fala. A conversa já está em andamento. NUNCA se reapresente.
Responda de forma direta e fluida ao que o cliente acabou de dizer.
`;

  const systemPrompt = `Você é a Valentina, consultora comercial de pré-vendas (SDR) da Valem Válvulas e Embalagens, falando por TELEFONE.

${knowledgeContext}

REGRAS ABSOLUTAS PARA CONVERSA DE VOZ:
1. RESPOSTAS CURTAS: Máximo 2 a 3 sentenças por turno. Em telefone, frases longas perdem o cliente.
2. SEM EMOJIS: Você está falando, não escrevendo. Emojis não existem em áudio.
3. SEM LINKS: Não mencione URLs ou sites por telefone.
4. SEM GÍRIAS DE TEXTO: Proibido usar "kkkk", "hahaha", asteriscos para ênfase (*palavra*).
5. TOM TELEFÔNICO PROFISSIONAL: Seja direta, calorosa e confiante. Como uma consultora humana experiente.
6. PAUSAS NATURAIS: Use vírgulas e pontos para criar ritmo natural de fala.
7. NUNCA use "Opa!" — comece com "Claro!", "Com certeza!", "Entendi,", "Perfeito,".
8. Se o cliente pedir para ligar depois ou disser que está ocupado: agradeça o tempo, confirme quando pode ligar de volta, e encerre cordialmente.

FLUXO DE TRIAGEM SDR (colete nesta ordem, de forma natural):
1. Confirmar interesse → "Posso continuar?"
2. Produto de interesse → "Qual produto ou embalagem o senhor está buscando?"
3. Volume mensal estimado → "Tem uma estimativa do volume mensal que precisaria?"
4. Nome completo → "Com quem tenho o prazer?"
5. Empresa / CNPJ → "Qual o nome da sua empresa, por favor?"

Quando tiver coletado Produto + Volume + Nome + Empresa, encerre com:
"Perfeito! Vou passar essas informações para nosso time comercial e eles entrarão em contato com um orçamento personalizado. Muito obrigada pelo seu tempo. Tenha um ótimo dia!"

${openingScript}

HISTÓRICO DA CONVERSA ATÉ AGORA:
${historyText || "(conversa iniciando agora)"}

Responda AGORA como Valentina. Apenas texto puro, sem formatação, sem aspas externas.`;

  const response = await vertexAi.generateText(
    systemPrompt,
    "gemini-2.5-pro",
    signal,
    {
      tenantId,
      feature: "sdr_agent",
      metadata: { channel: "voice_call", isFirstTurn },
    }
  );

  if (!response) {
    // Fallback gracioso se Vertex AI não responder
    return "Peço desculpas, tive uma pequena instabilidade aqui. Pode repetir o que disse, por favor?";
  }

  // Limpa qualquer formatação residual (asteriscos, markdown)
  return response
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .trim();
}
