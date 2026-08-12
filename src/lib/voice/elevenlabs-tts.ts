// Usando fetch nativo do Node 18+ (não precisa de node-fetch)

export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "sk_78e73bd4e14dc41a256b44797f742dda9db5fdba2cc65c8a";
export const MARIANNE_VOICE_ID = "RGymW84CSmfVugnA5tvA"; // Valentina — nova voz ultra-humana ElevenLabs

/**
 * Twilio Media Stream exige chunks de exatamente 160 bytes (20ms @ 8000Hz mu-law).
 * Esta função garante que os chunks da ElevenLabs sejam rechunkeados no tamanho correto.
 */
const TWILIO_CHUNK_SIZE = 160; // 20ms de áudio mu-law 8000Hz

/**
 * Faz streaming de áudio da ElevenLabs via API REST (eleven_turbo_v2_5)
 * Retorna chunks de EXATAMENTE 160 bytes (mu-law 8000Hz) para compatibilidade com Twilio
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

  // Acumula bytes e emite chunks de exatamente 160 bytes (exigido pelo Twilio)
  let leftover = Buffer.alloc(0);

  for await (const rawChunk of response.body as any) {
    const combined = Buffer.concat([leftover, Buffer.from(rawChunk)]);
    let offset = 0;

    while (offset + TWILIO_CHUNK_SIZE <= combined.length) {
      yield combined.subarray(offset, offset + TWILIO_CHUNK_SIZE);
      offset += TWILIO_CHUNK_SIZE;
    }

    // Guarda o restante para o próximo chunk
    leftover = combined.subarray(offset);
  }

  // Emite o último chunk (pode ser menor que 160 bytes — padding com silêncio mu-law = 0x7F)
  if (leftover.length > 0) {
    const padded = Buffer.alloc(TWILIO_CHUNK_SIZE, 0x7f); // silêncio mu-law
    leftover.copy(padded, 0);
    yield padded;
  }
}
