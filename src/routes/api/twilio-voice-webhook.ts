// src/routes/api/twilio-voice-webhook.ts
//
// Webhook TwiML para Twilio — "Pensar enquanto fala"
//
// ARQUITETURA:
//   1. Usuário fala → Twilio STT → POST aqui
//   2. Iniciamos streaming Gemini Flash em background (não-awaited)
//   3. Aguardamos APENAS a 1ª frase (geralmente pronta em ~0.8-1.5s)
//   4. Retornamos TwiML com 1ª frase + <Redirect> para /api/voice-buffer
//   5. Enquanto Twilio FALA a 1ª frase (~2-3s de áudio), Gemini termina de gerar
//   6. Twilio busca /api/voice-buffer → buffer já pronto → continua conversa

import { createFileRoute } from "@tanstack/react-router";
import {
  buildVoicePrompt,
  cleanVoiceResponse,
} from "../../lib/valentina/voice-engine";
import type { VoiceMessage } from "../../lib/valentina/voice-types";
import { vertexAi } from "../../lib/vertex-ai";

const TENANT_ID = "valem";
const VOICE = "Google.pt-BR-Neural2-C";
const LANGUAGE = "pt-BR";
const BASE_URL = "https://tecfagchat.up.railway.app";
const WEBHOOK_PATH = "/api/twilio-voice-webhook";
const BUFFER_PATH = "/api/voice-buffer";

// ── Estado global em memória (persiste no processo Node.js) ──────────────────

/** Histórico de conversa por CallSid */
const conversations = new Map<
  string,
  Array<{ role: "user" | "assistant"; content: string }>
>();

/** Contador de timeouts do Gather por chamada */
const gatherTimeouts = new Map<string, number>();

/** Buffer de streaming: callSid → { texto acumulado, promise de conclusão } */
export interface StreamBuffer {
  accumulated: string;
  firstSentence: string;
  done: boolean;
  completionResolvers: Array<() => void>;
  /** Sinaliza conclusão do stream para waiters externos */
  notifyDone: () => void;
  /** Aguarda o stream completar (com timeout externo) */
  waitUntilDone: (timeoutMs: number) => Promise<void>;
}

export const streamBuffers = new Map<string, StreamBuffer>();

function createStreamBuffer(): StreamBuffer {
  const resolvers: Array<() => void> = [];
  const buffer: StreamBuffer = {
    accumulated: "",
    firstSentence: "",
    done: false,
    completionResolvers: resolvers,
    notifyDone() {
      this.done = true;
      resolvers.forEach((r) => r());
      resolvers.length = 0;
    },
    waitUntilDone(timeoutMs: number): Promise<void> {
      if (this.done) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          // Remove do array e resolve por timeout
          const idx = resolvers.indexOf(resolve);
          if (idx !== -1) resolvers.splice(idx, 1);
          resolve();
        }, timeoutMs);

        resolvers.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
  return buffer;
}

// ── Helpers TwiML ─────────────────────────────────────────────────────────────

function twiml(inner: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${inner}\n</Response>`;
  return new Response(body, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function say(text: string): string {
  return `  <Say voice="${VOICE}" language="${LANGUAGE}">${escapeXml(text)}</Say>`;
}

function gather(): string {
  const action = `${BASE_URL}${WEBHOOK_PATH}`;
  return (
    `  <Gather input="speech" language="${LANGUAGE}" action="${action}" method="POST" ` +
    `timeout="10" speechTimeout="auto" profanityFilter="false">\n  </Gather>\n` +
    `  <Redirect method="POST">${action}</Redirect>`
  );
}

// ── Utilitários de frase ──────────────────────────────────────────────────────

/**
 * Extrai a primeira frase do texto (terminada em . ! ?).
 * Mínimo 20 chars para evitar frases muito curtas como "Ótimo!".
 * NÃO usa fallback por comprimento — evita cortes no meio da frase.
 */
function extractFirstSentence(text: string): string | null {
  // Lazy match: pega a menor string com >=20 chars que termine em .!?
  const match = text.match(/^(.{20,}?[.!?])(?:\s|$)/);
  if (match) return match[1].trim();
  return null;
}

// ── Pipeline de streaming ─────────────────────────────────────────────────────

/**
 * Inicia streaming Gemini em background.
 * Retorna uma Promise que resolve quando a primeira frase completa chegar
 * (ou timeout). O streaming continua em background mesmo após resolver.
 */
function startStreamingPipeline(
  messages: VoiceMessage[],
  callSid: string,
  firstSentenceTimeoutMs = 5_000
): Promise<string | null> {
  const prompt = buildVoicePrompt(messages, TENANT_ID);
  const buffer = createStreamBuffer();

  // Limpa qualquer buffer anterior do mesmo callSid (evita race condition)
  const oldBuffer = streamBuffers.get(callSid);
  if (oldBuffer && !oldBuffer.done) {
    oldBuffer.notifyDone(); // Libera qualquer waiter pendente
  }
  streamBuffers.set(callSid, buffer);

  let firstSentenceResolve: ((s: string | null) => void) | null = null;
  let firstSentenceResolved = false;

  const firstSentencePromise = new Promise<string | null>((resolve) => {
    firstSentenceResolve = resolve;
    // Timeout de segurança
    setTimeout(() => {
      if (!firstSentenceResolved) {
        firstSentenceResolved = true;
        resolve(buffer.accumulated.trim() || null);
      }
    }, firstSentenceTimeoutMs);
  });

  // Stream em background (não bloqueia o return abaixo)
  void (async () => {
    try {
      for await (const chunk of vertexAi.generateTextStream(
        prompt,
        "gemini-2.5-flash",
        undefined,
        { tenantId: TENANT_ID, feature: "sdr_agent", metadata: { channel: "voice_stream", callSid } }
      )) {
        buffer.accumulated += chunk;

        // Tenta resolver a primeira frase assim que tiver texto suficiente
        if (!firstSentenceResolved) {
          const sentence = extractFirstSentence(buffer.accumulated);
          if (sentence) {
            firstSentenceResolved = true;
            buffer.firstSentence = sentence;
            firstSentenceResolve?.(sentence);
          }
        }
      }
    } catch (e: any) {
      console.error("[VoiceStream] Erro no streaming:", e?.message ?? e);
      if (!firstSentenceResolved) {
        firstSentenceResolved = true;
        firstSentenceResolve?.(buffer.accumulated.trim() || null);
      }
    } finally {
      // Se nunca resolvemos a 1ª frase, resolve com o que tiver
      if (!firstSentenceResolved) {
        firstSentenceResolved = true;
        firstSentenceResolve?.(buffer.accumulated.trim() || null);
      }
      buffer.notifyDone();
      console.log(
        `[VoiceStream] Stream finalizado para ${callSid}. ` +
          `Total: ${buffer.accumulated.length} chars`
      );
    }
  })();

  return firstSentencePromise;
}

// ── Handler principal ─────────────────────────────────────────────────────────

async function handleWebhook(request: Request): Promise<Response> {
  let callSid = "unknown";
  let speechResult = "";

  try {
    const formData = await request.formData();
    callSid = (formData.get("CallSid") as string) || "unknown";
    speechResult = ((formData.get("SpeechResult") as string) || "").trim();
    const callStatus = (formData.get("CallStatus") as string) || "";

    console.log(
      `[TwilioVoice] CallSid=${callSid} | Status=${callStatus} | Speech="${speechResult}"`
    );

    // Chamada encerrada — limpar memória
    if (
      ["completed", "canceled", "failed", "busy", "no-answer"].includes(
        callStatus
      )
    ) {
      conversations.delete(callSid);
      gatherTimeouts.delete(callSid);
      streamBuffers.delete(callSid);
      return new Response("", { status: 204 });
    }

    const history = conversations.get(callSid);

    // ── PRIMEIRO TURNO (saudação hardcoded — sem IA para latência zero) ───────
    if (!history && !speechResult) {
      const greeting =
        "Olá, boa tarde! Aqui é a Valentina, da Valem Válvulas e Embalagens. " +
        "Tenho dois minutinhos com o senhor para falar sobre nossa linha. Posso continuar?";

      conversations.set(callSid, [{ role: "assistant", content: greeting }]);
      gatherTimeouts.set(callSid, 0);

      return twiml([say(greeting), gather()].join("\n"));
    }

    // ── GATHER TIMEOUT (sem fala, mas já existe histórico) ───────────────────
    if (!speechResult) {
      const timeouts = (gatherTimeouts.get(callSid) ?? 0) + 1;
      gatherTimeouts.set(callSid, timeouts);

      if (timeouts >= 3) {
        conversations.delete(callSid);
        gatherTimeouts.delete(callSid);
        return twiml(
          say(
            "Parece que a ligação está com problema de áudio. " +
              "Entrarei em contato por WhatsApp. Tenha um ótimo dia!"
          ) + "\n  <Hangup/>"
        );
      }

      const fallbacks = [
        "Ainda está na linha?",
        "Desculpe, não ouvi. Pode repetir?",
        "Continua por aí?",
      ];
      return twiml(
        [say(fallbacks[timeouts - 1] ?? "Pode repetir?"), gather()].join("\n")
      );
    }

    // ── TURNO NORMAL — streaming pipeline ────────────────────────────────────
    gatherTimeouts.set(callSid, 0);
    const currentHistory = history ?? [];
    currentHistory.push({ role: "user", content: speechResult });

    const voiceMessages: VoiceMessage[] = currentHistory.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Inicia streaming em background — aguarda APENAS a 1ª frase
    const firstSentence = await startStreamingPipeline(
      voiceMessages,
      callSid,
      5_000
    );

    if (!firstSentence) {
      // Fallback de segurança
      conversations.set(callSid, currentHistory);
      return twiml([say("Pode repetir? Não ouvi bem."), gather()].join("\n"));
    }

    // Atualiza histórico com a resposta completa futura
    // (será atualizado pelo voice-buffer quando o stream terminar)
    conversations.set(callSid, currentHistory);

    console.log(`[VoiceStream] 1ª frase (${callSid}): "${firstSentence}"`);

    // Detecta encerramento
    const isEnding =
      /até logo|tchau|ótimo dia|muito obrigada pelo seu tempo|encerr|finaliz/i.test(
        firstSentence
      );

    if (isEnding) {
      // Não precisamos do buffer — encerra direto
      conversations.delete(callSid);
      gatherTimeouts.delete(callSid);
      return twiml([say(firstSentence), "  <Hangup/>"].join("\n"));
    }

    // Verifica se a resposta já está completa (1ª frase = texto inteiro)
    const bufferEntry = streamBuffers.get(callSid);
    const hasMoreContent =
      bufferEntry && bufferEntry.accumulated.length > firstSentence.length + 5;

    if (!hasMoreContent) {
      // Resposta curta — fala tudo e coloca Gather direto
      const fullResp = cleanVoiceResponse(
        bufferEntry?.accumulated ?? firstSentence
      );
      currentHistory.push({ role: "assistant", content: fullResp });
      conversations.set(callSid, currentHistory);
      return twiml([say(fullResp), gather()].join("\n"));
    }

    // Fala 1ª frase + redireciona para buffer (onde o restante já está pronto)
    const bufferUrl = `${BASE_URL}${BUFFER_PATH}?sid=${encodeURIComponent(callSid)}&first=${encodeURIComponent(firstSentence)}`;
    return twiml(
      [
        say(firstSentence),
        `  <Redirect method="POST">${escapeXml(bufferUrl)}</Redirect>`,
      ].join("\n")
    );
  } catch (err: any) {
    console.error("[TwilioVoice] Erro:", err?.message ?? err);
    return twiml(
      [
        say(
          "Peço desculpas, tive um pequeno problema técnico. Pode repetir, por favor?"
        ),
        gather(),
      ].join("\n")
    );
  }
}

export const Route = createFileRoute("/api/twilio-voice-webhook")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://tecfagchat.up.railway.app/api/voice-stream" /></Connect></Response>',
          { headers: { "Content-Type": "text/xml" } }
        );
      },
      POST: async () => {
        // TwiML Híbrido: Valentina se apresenta via TwiML instantâneo E conecta o MediaStream para o tempo real
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR" voice="Google.pt-BR-Neural2-C">Olá! Aqui é a Valentina da Valem Válvulas. Em que posso te ajudar?</Say>
  <Connect>
    <Stream url="wss://tecfagchat.up.railway.app/api/voice-stream" />
  </Connect>
</Response>`;
        return new Response(body, {
          headers: { "Content-Type": "text/xml; charset=utf-8" },
        });
      },
    },
  },
});
