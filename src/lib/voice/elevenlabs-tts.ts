// Usando fetch nativo do Node 18+ (não precisa de node-fetch)

export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "sk_78e73bd4e14dc41a256b44797f742dda9db5fdba2cc65c8a";
export const MARIANNE_VOICE_ID = "uYn64k2L7SzZRFmekMti"; // Valentina — voz customizada (Voice Design, plano free ✅)

/**
 * Faz streaming de áudio da ElevenLabs via API REST (eleven_turbo_v2_5)
 * Retorna chunks de buffer MP3 conforme chegam da API
 */
export async function* streamElevenLabsTts(
  text: string,
  voiceId: string = MARIANNE_VOICE_ID,
  apiKey: string = ELEVENLABS_API_KEY
): AsyncGenerator<Buffer, void, unknown> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=4&output_format=ulaw_8000`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "audio/basic",
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`[ElevenLabs TTS] Erro HTTP ${response.status}: ${errBody}`);
  }

  if (!response.body) {
    throw new Error("[ElevenLabs TTS] Resposta sem body");
  }

  // Node.js / Fetch Body Stream Reader
  for await (const chunk of response.body as any) {
    yield Buffer.from(chunk);
  }
}
