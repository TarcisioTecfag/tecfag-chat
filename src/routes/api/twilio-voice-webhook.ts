// src/routes/api/twilio-voice-webhook.ts
// Webhook TwiML para Twilio — Valentina Voice via Programmable Voice
// Fluxo: Twilio chama este endpoint → retorna TwiML com voz PT-BR + Gather de fala

import { createFileRoute } from "@tanstack/react-router";
import { generateVoiceResponse } from "../../lib/valentina/voice-engine";

const TENANT_ID = "valem";

// Google Neural2 voices são MUITO mais naturais que Polly.
// pt-BR-Neural2-C = feminino (melhor opção para Valentina)
const VOICE = "Google.pt-BR-Neural2-C";
const LANGUAGE = "pt-BR";
const BASE_URL = "https://tecfagchat.up.railway.app";
const WEBHOOK_PATH = "/api/twilio-voice-webhook";

// Armazenamento em memória de conversas por CallSid
const conversations = new Map<
  string,
  Array<{ role: "user" | "assistant"; content: string }>
>();

// Contador de timeouts do Gather por chamada (para encerrar se silêncio persistente)
const gatherTimeouts = new Map<string, number>();

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

// Gather com Redirect de fallback: se não houver fala, Twilio volta ao webhook
function gather(): string {
  const action = `${BASE_URL}${WEBHOOK_PATH}`;
  return `  <Gather input="speech" language="${LANGUAGE}" action="${action}" method="POST" timeout="10" speechTimeout="auto" profanityFilter="false">
  </Gather>
  <Redirect method="POST">${action}</Redirect>`;
}

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
    if (["completed", "canceled", "failed", "busy", "no-answer"].includes(callStatus)) {
      conversations.delete(callSid);
      gatherTimeouts.delete(callSid);
      return new Response("", { status: 204 });
    }

    const history = conversations.get(callSid);

    // ── PRIMEIRO TURNO (sem histórico E sem fala — início da chamada) ─────────
    if (!history && !speechResult) {
      const greeting =
        "Olá, boa tarde! Aqui é a Valentina, da Valem Válvulas e Embalagens. " +
        "Tudo bem? Tenho dois minutinhos com o senhor para falar sobre nossa linha " +
        "de embalagens e válvulas. Posso continuar?";

      conversations.set(callSid, [{ role: "assistant", content: greeting }]);
      gatherTimeouts.set(callSid, 0);

      return twiml([say(greeting), gather()].join("\n"));
    }

    // ── GATHER TIMEOUT (sem fala, mas já existe histórico) ───────────────────
    if (!speechResult) {
      const timeouts = (gatherTimeouts.get(callSid) ?? 0) + 1;
      gatherTimeouts.set(callSid, timeouts);

      if (timeouts >= 3) {
        // Silêncio persistente — encerrar com educação
        conversations.delete(callSid);
        gatherTimeouts.delete(callSid);
        return twiml(
          say(
            "Parece que a ligação está com problema de áudio. " +
            "Entrarei em contato por WhatsApp. Tenha um ótimo dia!"
          ) + "\n  <Hangup/>"
        );
      }

      // Pergunta se o cliente ainda está na linha
      const fallbacks = [
        "Ainda está na linha?",
        "Desculpe, não ouvi. Pode repetir?",
        "Continua por aí?",
      ];
      return twiml([say(fallbacks[timeouts - 1] ?? "Pode repetir?"), gather()].join("\n"));
    }

    // ── TURNO NORMAL — processa fala com Vertex AI ───────────────────────────
    gatherTimeouts.set(callSid, 0); // reset timeout counter
    const currentHistory = history ?? [];
    currentHistory.push({ role: "user", content: speechResult });

    const responseText = await generateVoiceResponse(
      currentHistory.map((m) => ({ role: m.role, content: m.content })),
      TENANT_ID
    );

    currentHistory.push({ role: "assistant", content: responseText });
    conversations.set(callSid, currentHistory);

    console.log(
      `[TwilioVoice] Resposta: ${responseText.substring(0, 100)}...`
    );

    // Detecta encerramento educado da Valentina
    const isEnding =
      /até logo|tchau|tenha um ótimo dia|muito obrigada pelo seu tempo|encerr|finaliz/i.test(
        responseText
      );

    if (isEnding) {
      conversations.delete(callSid);
      gatherTimeouts.delete(callSid);
      return twiml([say(responseText), "  <Hangup/>"].join("\n"));
    }

    return twiml([say(responseText), gather()].join("\n"));
  } catch (err: any) {
    console.error("[TwilioVoice] Erro:", err?.message ?? err);
    return twiml(
      [
        say(
          "Peço desculpas, tive um pequeno problema técnico. " +
          "Pode repetir o que disse, por favor?"
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
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say language="pt-BR" voice="Google.pt-BR-Neural2-C">Valentina Voice Webhook ativo.</Say></Response>',
          { headers: { "Content-Type": "text/xml" } }
        );
      },
      POST: async ({ request }: { request: Request }) => {
        return handleWebhook(request);
      },
    },
  },
});
