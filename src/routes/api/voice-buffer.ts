// src/routes/api/voice-buffer.ts
//
// Endpoint de continuação do pipeline "pensar enquanto fala".
//
// Fluxo:
//  1. Twilio falou a 1ª frase
//  2. Redireciona aqui com ?sid=xxx&first=<1ª frase>
//  3. Aguardamos o stream de Gemini completar (já está ~90% pronto por causa do tempo de fala)
//  4. Retornamos o restante da resposta + Gather para próximo turno

import { createFileRoute } from "@tanstack/react-router";
import {
  streamBuffers,
  type StreamBuffer,
} from "../api/twilio-voice-webhook";
import { cleanVoiceResponse } from "../../lib/valentina/voice-engine";

const VOICE = "Google.pt-BR-Neural2-C";
const LANGUAGE = "pt-BR";
const BASE_URL = "https://tecfagchat.up.railway.app";
const WEBHOOK_PATH = "/api/twilio-voice-webhook";

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

async function handleBuffer(request: Request): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    url = new URL(request.url, BASE_URL);
  }

  const callSid = url.searchParams.get("sid") ?? "";
  const firstSentence = url.searchParams.get("first") ?? "";

  if (!callSid) {
    return twiml([say("Desculpe, ocorreu um erro técnico."), gather()].join("\n"));
  }

  const buffer: StreamBuffer | undefined = streamBuffers.get(callSid);

  if (!buffer) {
    // Buffer expirou ou não existe — apenas faz gather
    console.warn(`[VoiceBuffer] Buffer não encontrado para ${callSid}`);
    return twiml(gather());
  }

  // Aguarda o stream completar (máximo 8s — Twilio falou a 1ª frase em ~2-3s)
  // Na prática o stream já deve estar completo
  await buffer.waitUntilDone(8_000);

  const fullText = cleanVoiceResponse(buffer.accumulated);
  streamBuffers.delete(callSid); // Limpa memória

  // Remove a primeira frase do texto completo para falar apenas o restante
  let rest = fullText;
  if (firstSentence && fullText.startsWith(firstSentence)) {
    rest = fullText.slice(firstSentence.length).trim();
  } else {
    // Tenta remover primeira sentença por comprimento aproximado
    const firstLen = firstSentence.length;
    if (firstLen > 0 && fullText.length > firstLen) {
      const approxRest = fullText.slice(firstLen).trim();
      if (approxRest.length > 5) rest = approxRest;
      else rest = ""; // Nada mais a dizer
    }
  }

  console.log(
    `[VoiceBuffer] ${callSid} | total=${fullText.length} | rest="${rest.substring(0, 60)}..."`
  );

  // Detecta encerramento
  const isEnding =
    /até logo|tchau|ótimo dia|muito obrigada pelo seu tempo|encerr|finaliz/i.test(
      fullText
    );

  if (isEnding) {
    if (rest.length > 2) {
      return twiml([say(rest), "  <Hangup/>"].join("\n"));
    }
    return twiml("  <Hangup/>");
  }

  if (rest.length > 2) {
    return twiml([say(rest), gather()].join("\n"));
  }

  // Só gather, sem fala adicional
  return twiml(gather());
}

export const Route = createFileRoute("/api/voice-buffer")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => handleBuffer(request),
      POST: async ({ request }: { request: Request }) => handleBuffer(request),
    },
  },
});
