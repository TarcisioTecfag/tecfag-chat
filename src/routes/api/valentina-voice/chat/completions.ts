/**
 * /api/valentina-voice/chat/completions
 *
 * Endpoint OpenAI-compatible chamado pelo ElevenLabs a cada turno da conversa de voz.
 * Suporta respostas em JSON padrão e em SSE Event Stream (stream: true).
 *
 * PROTEÇÃO ANTI-DUPLICATA:
 * ElevenLabs pode enviar o mesmo turno múltiplas vezes (speculative_turn, retry).
 * Usamos um Map keyed pelo hash das mensagens para reutilizar a mesma Promise
 * em-flight, garantindo UMA única chamada ao Vertex AI por turno.
 */

import { createFileRoute } from "@tanstack/react-router";
import { generateVoiceResponse, VoiceMessage } from "../../../../lib/valentina/voice-engine";
import { vertexAi } from "../../../../lib/vertex-ai";
import { db } from "../../../../db";
import { voiceAgenda } from "../../../../db/schema";

const TENANT_ID = "valem";

// ── Scheduling Intent Detection ───────────────────────────────────────────────
// Roda após cada turno para detectar se o cliente pediu retorno/agendamento.
// Usa Vertex AI (flash) para análise estruturada — sem depender de tool calls.

const SCHEDULING_KEYWORDS = [
  "ligue", "me liga", "me ligue", "me contate", "me contacte",
  "pode ligar", "retorne", "retorno", "agendar", "agendamento",
  "segunda", "terça", "quarta", "quinta", "sexta", "sábado",
  "amanhã", "próxima semana", "próximo", "depois de",
  "às ", " horas", "de tarde", "de manhã", "outro momento",
  "outro horário", "melhor hora"
];

function hasSchedulingKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return SCHEDULING_KEYWORDS.some(kw => lower.includes(kw));
}

async function detectAndScheduleCallback(
  messages: VoiceMessage[],
  callerPhone: string | null
): Promise<void> {
  // Só analisa se há keywords de agendamento nas últimas 2 msgs
  const recentText = messages.slice(-2).map(m => m.content).join(" ");
  if (!hasSchedulingKeyword(recentText)) return;

  try {
    const historyText = messages.slice(-6)
      .map(m => `${m.role === "user" ? "CLIENTE" : "VALENTINA"}: ${m.content}`)
      .join("\n");

    const todayISO = new Date().toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long", day: "2-digit", month: "long", year: "numeric"
    });

    const prompt = `Hoje é ${todayISO} (fuso Brasília, UTC-3).

Analise o histórico desta conversa telefônica e determine se o CLIENTE solicitou que a Valentina ligue de volta em outro momento ou agendou um retorno.

HISTÓRICO:
${historyText}

Responda APENAS com JSON válido (sem markdown):
{
  "hasSchedulingIntent": boolean,
  "scheduledAt": "ISO 8601 com fuso -03:00 ou null se nao mencionou data/hora",
  "notes": "resumo do interesse do cliente em 1 frase ou null"
}

Se o cliente nao pediu retorno explicitamente, retorne: {"hasSchedulingIntent": false, "scheduledAt": null, "notes": null}
Se pediu mas nao especificou horario, use o proximo dia util as 14:00 (UTC-3).`;

    const result = await vertexAi.generateStructuredJson(
      prompt,
      "gemini-2.0-flash",
      undefined,
      { feature: "sdr_agent", tenantId: TENANT_ID, metadata: { source: "voice_scheduling" } }
    );

    if (!result?.hasSchedulingIntent || !result?.scheduledAt) return;

    // Persiste o agendamento no banco
    await db.insert(voiceAgenda).values({
      tenantId: TENANT_ID,
      clientName: "Cliente (via ligação)",
      clientPhone: callerPhone ?? "desconhecido",
      company: "",
      scheduledAt: new Date(result.scheduledAt),
      type: "follow_up",
      status: "scheduled",
      priority: "medium",
      notes: result.notes ?? "Retorno solicitado durante ligação Valentina",
      campaignName: "Valentina Voice",
      assignedAgent: "Valentina",
    });

    console.log(`[ValentinaVoice] 📅 Agendamento criado: ${result.scheduledAt} | ${result.notes}`);
  } catch (err: any) {
    // Não deixa erro de agendamento quebrar a resposta de voz
    console.warn("[ValentinaVoice] ⚠️ Erro ao detectar agendamento:", err?.message ?? err);
  }
}


// ── Anti-duplicate request cache ──────────────────────────────────────────────
// Key: SHA-ish hash of the conversation messages
// Value: in-flight Promise<string>
// Auto-cleared after TTL to prevent memory leaks.
const TTL_MS = 30_000; // 30s: safe window to coalesce duplicates
const inflightCache = new Map<string, { promise: Promise<string>; timer: ReturnType<typeof setTimeout> }>();

function hashMessages(messages: VoiceMessage[]): string {
  // Lightweight hash: role+content of last 6 messages (enough for uniqueness)
  return messages
    .slice(-6)
    .map((m) => `${m.role}:${m.content}`)
    .join("|");
}

function getOrFetch(messages: VoiceMessage[]): Promise<string> {
  const key = hashMessages(messages);

  if (inflightCache.has(key)) {
    console.log(`[ValentinaVoice/completions] ♻️  Reutilizando resposta em cache para ${messages.length} msgs`);
    return inflightCache.get(key)!.promise;
  }

  const promise = generateVoiceResponse(messages, TENANT_ID).finally(() => {
    // Remove entry after response (or on error) to allow fresh calls on next turn
    inflightCache.delete(key);
  });

  const timer = setTimeout(() => inflightCache.delete(key), TTL_MS);
  inflightCache.set(key, { promise, timer });
  return promise;
}

// ── CORS & helpers ────────────────────────────────────────────────────────────

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

// ── Route ─────────────────────────────────────────────────────────────────────

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

          const defaultGreeting =
            "Olá, boa tarde! Aqui é a Valentina, da Valem Válvulas e Embalagens. Como posso ajudar sua empresa hoje?";

          let responseText = defaultGreeting;

          if (messages.length > 0) {
            const rawResponse = await getOrFetch(messages);
            if (rawResponse && rawResponse.trim().length > 0) {
              responseText = rawResponse;
            }
          }

          console.log(
            `[ValentinaVoice/completions] ✅ Resposta (${responseText.length} chars): ${responseText.substring(0, 100)}...`
          );

          // 🔥 Detecção de agendamento — fire-and-forget (não bloqueia a resposta)
          const callerPhone: string | null =
            body?.metadata?.caller_phone ??
            body?.metadata?.from_number ??
            null;
          detectAndScheduleCallback(messages, callerPhone).catch(() => {});

          if (isStream) {
            return sseStream(responseText, body?.model);
          }

          return json(buildOpenAiResponse(responseText, body?.model));
        } catch (e: any) {
          console.error("[ValentinaVoice/completions] Erro:", e?.message ?? e);
          const fallback =
            "Olá! Sou a Valentina, da Valem Válvulas e Embalagens. Como posso ajudar sua empresa hoje?";
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
