// src/routes/api/twilio-voice-webhook.ts
// Webhook TwiML para Twilio — Valentina Voice via Programmable Voice
// Fluxo: Twilio chama este endpoint → retorna TwiML com voz PT-BR + Gather de fala

import { createFileRoute } from "@tanstack/react-router";
import { generateVoiceResponse } from "../../lib/valentina/voice-engine";

const TENANT_ID = "valem";
const VOICE = "Polly.Camila-Neural";
const LANGUAGE = "pt-BR";
const BASE_URL = "https://tecfagchat.up.railway.app";
const WEBHOOK_PATH = "/api/twilio-voice-webhook";

// Armazenamento em memória de conversas por CallSid
const conversations = new Map<
  string,
  Array<{ role: "user" | "assistant"; content: string }>
>();

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

function gather(prompt?: string): string {
  const action = `${BASE_URL}${WEBHOOK_PATH}`;
  const inner = prompt ? `\n${say(prompt)}\n  ` : "\n  ";
  return `  <Gather input="speech" language="${LANGUAGE}" action="${action}" method="POST" timeout="8" speechTimeout="auto" profanityFilter="false">${inner}</Gather>`;
}

async function handleWebhook(request: Request): Promise<Response> {
  let callSid = "unknown";
  let speechResult = "";

  try {
    const formData = await request.formData();
    callSid = (formData.get("CallSid") as string) || "unknown";
    speechResult = (formData.get("SpeechResult") as string) || "";
    const callStatus = (formData.get("CallStatus") as string) || "";

    console.log(
      `[TwilioVoice] CallSid=${callSid} | Status=${callStatus} | Speech="${speechResult}"`
    );

    // Chamada encerrada — limpar memória
    if (["completed", "canceled", "failed"].includes(callStatus)) {
      conversations.delete(callSid);
      return new Response("", { status: 204 });
    }

    // ── Primeiro turno (sem fala ainda) ────────────────────────────────────────
    if (!speechResult) {
      conversations.delete(callSid);
      const greeting =
        "Olá, boa tarde! Aqui é a Valentina, da Valem Válvulas e Embalagens. " +
        "Como vai? Teria 2 minutinhos? " +
        "Queria apresentar nossa linha de válvulas e embalagens industriais.";

      conversations.set(callSid, [{ role: "assistant", content: greeting }]);

      return twiml([say(greeting), gather()].join("\n"));
    }

    // ── Turnos seguintes — processa fala com Vertex AI ──────────────────────────
    const history = conversations.get(callSid) ?? [];
    history.push({ role: "user", content: speechResult });

    const responseText = await generateVoiceResponse(
      history.map((m) => ({ role: m.role, content: m.content })),
      TENANT_ID
    );

    history.push({ role: "assistant", content: responseText });
    conversations.set(callSid, history);

    console.log(
      `[TwilioVoice] Resposta: ${responseText.substring(0, 80)}...`
    );

    // Detecta encerramento educado da Valentina
    const isEnding =
      /até logo|tchau|bom dia|boa tarde|boa noite|encerrar|finalizar/i.test(
        responseText
      );

    if (isEnding) {
      return twiml([say(responseText), "  <Hangup/>"].join("\n"));
    }

    return twiml([say(responseText), gather()].join("\n"));
  } catch (err: any) {
    console.error("[TwilioVoice] Erro:", err?.message ?? err);
    return twiml(
      [
        say("Peço desculpas, tive um pequeno problema técnico. Pode repetir?"),
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
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say language="pt-BR">Valentina Voice Webhook ativo.</Say></Response>',
          { headers: { "Content-Type": "text/xml" } }
        );
      },
      POST: async ({ request }: { request: Request }) => {
        return handleWebhook(request);
      },
    },
  },
});
