import { ELEVENLABS_API_KEY, MARIANNE_VOICE_ID } from "./elevenlabs-tts";

/** Cache LRU em memória para evitar gastar caracteres com a mesma frase */
const pttAudioCache = new Map<string, { buffer: Buffer; durationSeconds: number; timestamp: number }>();
const MAX_CACHE_ENTRIES = 150;

export interface GeneratePttOptions {
  text: string;
  voiceId?: string;
  modelId?: "eleven_v3" | "eleven_multilingual_v2" | "eleven_flash_v2_5" | "eleven_turbo_v2_5";
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PttAudioResult {
  buffer: Buffer;
  durationSeconds: number;
  mimeType: string;
  cached: boolean;
}

/**
 * Estima a duração de uma fala em português com base na contagem de caracteres e palavras.
 * Média natural em PT-BR: ~14 caracteres por segundo ou ~2.5 palavras por segundo.
 */
export function estimateTextSpeechDurationSeconds(text: string): number {
  const clean = text.trim();
  if (!clean) return 2;
  const wordCount = clean.split(/\s+/).length;
  const byWords = wordCount / 2.6;
  const byChars = clean.length / 14;
  const estimated = (byWords + byChars) / 2;
  return Math.min(60, Math.max(2, Math.round(estimated * 10) / 10));
}

/**
 * Gera um áudio dinâmico nativo em formato Opus/OGG (48kHz @ 32kbps) via ElevenLabs TTS API.
 * Este formato é 100% compatível com o player PTT de mensagem de voz do WhatsApp.
 */
export async function generateDynamicPttAudio(options: GeneratePttOptions): Promise<PttAudioResult> {
  const {
    text,
    voiceId = MARIANNE_VOICE_ID,
    modelId = "eleven_v3",   // Máxima expressão humana — ok usar pq PTT é pré-gerado (não real-time)
    signal,
    timeoutMs = 12000,       // eleven_v3 é maior, precisa de mais tempo de geração
  } = options;

  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error("[ElevenLabs Dynamic PTT] Texto vazio fornecido para síntese de áudio");
  }

  const cacheKey = `${voiceId}:${modelId}:${cleanText}`;

  // 1. Checar cache em memória
  if (pttAudioCache.has(cacheKey)) {
    const item = pttAudioCache.get(cacheKey)!;
    console.log(`[ElevenLabs Dynamic PTT] ⚡ Áudio recuperado do cache LRU (${item.durationSeconds}s): "${cleanText.slice(0, 40)}..."`);
    return {
      buffer: item.buffer,
      durationSeconds: item.durationSeconds,
      mimeType: "audio/ogg; codecs=opus",
      cached: true,
    };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY || ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("[ElevenLabs Dynamic PTT] Chave de API ELEVENLABS_API_KEY não configurada");
  }

  // 2. Timeout e AbortController combinado
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const onParentAbort = () => controller.abort();
  if (signal) {
    signal.addEventListener("abort", onParentAbort);
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=opus_48000_32`;

  try {
    const startTime = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "audio/ogg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: modelId,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.80,
          style: 0.05,
          use_speaker_boost: true,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status} ao sintetizar áudio na ElevenLabs: ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const elapsedMs = Date.now() - startTime;
    const durationSeconds = estimateTextSpeechDurationSeconds(cleanText);

    console.log(`[ElevenLabs Dynamic PTT] 🎙️ Áudio gerado com sucesso em ${elapsedMs}ms (${buffer.length} bytes, ~${durationSeconds}s): "${cleanText.slice(0, 45)}..."`);

    // 3. Salvar no cache LRU
    if (pttAudioCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = pttAudioCache.keys().next().value;
      if (oldestKey) pttAudioCache.delete(oldestKey);
    }
    pttAudioCache.set(cacheKey, { buffer, durationSeconds, timestamp: Date.now() });

    return {
      buffer,
      durationSeconds,
      mimeType: "audio/ogg; codecs=opus",
      cached: false,
    };
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", onParentAbort);
    }
  }
}
