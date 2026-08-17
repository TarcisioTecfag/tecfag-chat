/**
 * /api/valentina-voice/chat/completions
 *
 * Endpoint OpenAI-compatible chamado pelo ElevenLabs / Vapi a cada turno da conversa de voz.
 * Suporta respostas em JSON padrão e em SSE Event Stream (stream: true).
 */

import { createFileRoute } from "@tanstack/react-router";
import { generateVoiceResponse, VoiceMessage } from "../../../../lib/valentina/voice-engine";

const TENANT_ID = "valem";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-vapi-secret, x-api-key",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sseStream(content: string, modelName: string = "gemini-2.5-flash") {
  const streamId = `chatcmpl-valentina-${Date.now()}`;

  const chunk1 = JSON.stringify({
    id: streamId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: modelName,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content },
        finish_reason: null,
      },
    ],
  });

  const chunk2 = JSON.stringify({
    id: streamId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: modelName,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  });

  const sseBody = `data: ${chunk1}\n\ndata: ${chunk2}\n\ndata: [DONE]\n\n`;

  return new Response(sseBody, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export const Route = createFileRoute("/api/valentina-voice/chat/completions")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }: { request: Request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const isStream = body?.stream === true || request.headers.get("accept")?.includes("text/event-stream");

          const messages: VoiceMessage[] = (body?.messages ?? []).filter(
            (m: any) => m?.role && typeof m?.content === "string"
          );

          console.log(
            `[ValentinaVoice/completions] Turno recebido. ${messages.length} msgs. Stream: ${isStream}`
          );

          const defaultGreeting = "Olá, boa tarde! Aqui é a Valentina, da Valem Válvulas e Embalagens. Como posso ajudar sua empresa hoje?";

          let responseText = defaultGreeting;

          if (messages.length > 0) {
            const rawResponse = await generateVoiceResponse(messages, TENANT_ID);
            if (rawResponse && rawResponse.trim().length > 0) {
              responseText = rawResponse;
            }
          }

          console.log(
            `[ValentinaVoice/completions] ✅ Resposta (${responseText.length} chars): ${responseText.substring(0, 100)}...`
          );

          if (isStream) {
            return sseStream(responseText, body?.model);
          }

          return json(buildOpenAiResponse(responseText, body?.model));

        } catch (e: any) {
          console.error("[ValentinaVoice/completions] Erro:", e?.message ?? e);
          const fallback = "Olá! Sou a Valentina, da Valem Válvulas e Embalagens. Como posso ajudar sua empresa hoje?";
          return json(buildOpenAiResponse(fallback, "gemini-2.5-flash"));
        }
      },
    },
  },
});

// ── Helper — Formato OpenAI Chat Completions ──────────────────────────────────

function buildOpenAiResponse(content: string, modelName: string = "gemini-2.5-flash") {
  return {
    id: `chatcmpl-valentina-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelName,
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
