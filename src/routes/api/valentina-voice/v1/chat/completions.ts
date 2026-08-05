/**
 * /api/valentina-voice/v1/chat/completions
 *
 * Endpoint OpenAI-compatible chamado pelo Vapi Custom LLM a cada turno da conversa.
 * URL completa: https://tecfagchat.up.railway.app/api/valentina-voice/v1/chat/completions
 * Base URL fornecida ao Vapi: https://tecfagchat.up.railway.app/api/valentina-voice/v1
 *
 * Documentação Vapi Custom LLM: https://docs.vapi.ai/customization/custom-llm
 */

import { createFileRoute } from "@tanstack/react-router";
import { generateVoiceResponse, VoiceMessage } from "../../../../../lib/valentina/voice-engine";

const TENANT_ID = "valem";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-vapi-secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/valentina-voice/v1/chat/completions")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }: { request: Request }) => {
        try {
          const body = await request.json();

          // Vapi envia messages no formato OpenAI Chat Completions
          const messages: VoiceMessage[] = (body?.messages ?? []).filter(
            (m: any) => m?.role && typeof m?.content === "string"
          );

          console.log(
            `[ValentinaVoice] Turno recebido do Vapi — ${messages.length} msgs no histórico.`
          );

          // Fallback para caso o histórico chegue vazio (primeira chamada do Vapi)
          if (messages.length === 0) {
            return json(
              buildOpenAiResponse(
                "Olá, boa tarde! Aqui é a Valentina, da Valem Válvulas e Embalagens. Tudo bem?"
              )
            );
          }

          // Gera resposta da Valentina via Vertex AI (Gemini 2.5 Pro)
          const responseText = await generateVoiceResponse(messages, TENANT_ID);

          console.log(
            `[ValentinaVoice] ✅ Resposta: "${responseText.substring(0, 100)}..."`
          );

          return json(buildOpenAiResponse(responseText));
        } catch (e: any) {
          console.error("[ValentinaVoice] Erro ao processar turno:", e?.message ?? e);
          return json(
            buildOpenAiResponse(
              "Peço desculpas, tive uma instabilidade aqui. Pode repetir o que disse?"
            )
          );
        }
      },
    },
  },
});

// ── Formato de resposta OpenAI Chat Completions ───────────────────────────────

function buildOpenAiResponse(content: string) {
  return {
    id: `chatcmpl-valentina-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "valentina-voice-valem",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}
