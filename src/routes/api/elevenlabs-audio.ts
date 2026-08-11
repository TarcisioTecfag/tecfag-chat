import { createFileRoute } from "@tanstack/react-router";
import { ELEVENLABS_API_KEY, MARIANNE_VOICE_ID } from "../../lib/voice/elevenlabs-tts";

/** Cache em memória para evitar gerar a mesma frase múltiplas vezes no ElevenLabs */
const audioCache = new Map<string, { buffer: ArrayBuffer; contentType: string }>();

export const Route = createFileRoute("/api/elevenlabs-audio")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const text = url.searchParams.get("text");
        const voiceId = url.searchParams.get("voiceId") || MARIANNE_VOICE_ID;

        if (!text) {
          return new Response("Parâmetro 'text' é obrigatório", { status: 400 });
        }

        const cacheKey = `${voiceId}_${text}`;
        if (audioCache.has(cacheKey)) {
          const cached = audioCache.get(cacheKey)!;
          return new Response(cached.buffer, {
            headers: {
              "Content-Type": cached.contentType,
              "Cache-Control": "public, max-age=86400",
            },
          });
        }

        try {
          const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?optimize_streaming_latency=3`;

          const res = await fetch(elevenLabsUrl, {
            method: "POST",
            headers: {
              "Accept": "audio/mpeg",
              "Content-Type": "application/json",
              "xi-api-key": process.env.ELEVENLABS_API_KEY || ELEVENLABS_API_KEY,
            },
            body: JSON.stringify({
              text,
              model_id: "eleven_turbo_v2_5",
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
              },
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            console.error(`[ElevenLabs API Error] Status ${res.status}: ${errText}`);
            return new Response(`ElevenLabs error: ${errText}`, { status: res.status });
          }

          const arrayBuffer = await res.arrayBuffer();
          const contentType = res.headers.get("content-type") || "audio/mpeg";

          // Salva no cache
          audioCache.set(cacheKey, { buffer: arrayBuffer, contentType });

          return new Response(arrayBuffer, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=86400",
            },
          });
        } catch (err: any) {
          console.error("[ElevenLabs Audio Route] Erro:", err?.message || err);
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    },
  },
});
