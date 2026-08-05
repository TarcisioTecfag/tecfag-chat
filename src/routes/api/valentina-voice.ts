/**
 * /api/valentina-voice
 *
 * Endpoints para integração com Vapi.ai — Valentina Voice SDR.
 *
 * POST /api/valentina-voice/chat      → Custom LLM (OpenAI-compatible) chamado pelo Vapi a cada turno
 * POST /api/valentina-voice/outbound  → Dispara uma ligação outbound via Vapi API
 *
 * Segurança:
 *  - Em produção, validar o header "x-vapi-secret" com VAPI_WEBHOOK_SECRET.
 *  - tenantId fixo em "valem" — endpoint exclusivo da Valentina.
 *
 * Documentação Vapi Custom LLM:
 *  https://docs.vapi.ai/customization/custom-llm
 */

import { createFileRoute } from "@tanstack/react-router";
import { generateVoiceResponse, VoiceMessage } from "../../lib/valentina/voice-engine";

const TENANT_ID = "valem";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-vapi-secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/valentina-voice")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action");

        if (action === "outbound") return handleOutbound(request);

        // Default: endpoint Custom LLM para o Vapi
        return handleChat(request);
      },
    },
  },
});

// ── Custom LLM — Chamado pelo Vapi a cada turno da conversa ──────────────────
// POST /api/valentina-voice
// Body: OpenAI Chat Completions format { model, messages: [{role, content}] }

async function handleChat(request: Request): Promise<Response> {
  try {
    const body = await request.json();

    // Vapi envia um array de messages no formato OpenAI
    const messages: VoiceMessage[] = (body?.messages ?? []).filter(
      (m: any) => m?.role && m?.content
    );

    if (messages.length === 0) {
      return json(
        buildOpenAiResponse(
          "Olá! Aqui é a Valentina, da Valem Válvulas e Embalagens. Tudo bem?"
        )
      );
    }

    // Gera resposta da Valentina via Vertex AI
    const responseText = await generateVoiceResponse(messages, TENANT_ID);

    console.log(
      `[ValentinaVoice] Turno processado. Resposta (${responseText.length} chars): ${responseText.substring(0, 80)}...`
    );

    return json(buildOpenAiResponse(responseText));
  } catch (e: any) {
    console.error("[ValentinaVoice] Erro no handler /chat:", e?.message ?? e);
    return json(
      buildOpenAiResponse(
        "Peço desculpas, tive um problema técnico aqui. Pode aguardar um instante?"
      )
    );
  }
}

// ── Disparo de Ligação Outbound ───────────────────────────────────────────────
// POST /api/valentina-voice?action=outbound
// Body: { phoneNumber: "+5511999999999", name?: "Diretor Fulano" }

async function handleOutbound(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { phoneNumber, name } = body;

    if (!phoneNumber) {
      return json({ error: "phoneNumber é obrigatório. Exemplo: +5511999999999" }, 400);
    }

    const vapiApiKey = process.env.VAPI_API_KEY;
    const assistantId = process.env.VAPI_ASSISTANT_ID;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

    if (!vapiApiKey || !assistantId || !phoneNumberId) {
      return json(
        {
          error:
            "Variáveis de ambiente do Vapi não configuradas. Verifique VAPI_API_KEY, VAPI_ASSISTANT_ID e VAPI_PHONE_NUMBER_ID no Railway.",
        },
        500
      );
    }

    console.log(`[ValentinaVoice] Disparando ligação outbound para ${phoneNumber}...`);

    const vapiRes = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vapiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: {
          number: phoneNumber,
          name: name ?? "Cliente Valem",
        },
        // Contexto injetado no início da chamada para personalizar a abertura
        assistantOverrides: {
          variableValues: {
            customerName: name ?? "Cliente",
            tenantId: TENANT_ID,
          },
        },
      }),
    });

    const vapiData = await vapiRes.json();

    if (!vapiRes.ok) {
      console.error("[ValentinaVoice] Erro ao disparar ligação via Vapi:", vapiData);
      return json(
        { error: "Erro ao disparar ligação", details: vapiData },
        vapiRes.status
      );
    }

    console.log(`[ValentinaVoice] ✅ Ligação disparada! Call ID: ${vapiData?.id}`);

    return json({
      success: true,
      callId: vapiData?.id,
      phoneNumber,
      status: vapiData?.status ?? "queued",
      message: `Ligação da Valentina disparada para ${phoneNumber}. O celular irá tocar em alguns segundos.`,
    });
  } catch (e: any) {
    console.error("[ValentinaVoice] Erro no handler /outbound:", e?.message ?? e);
    return json({ error: e?.message ?? "Erro interno" }, 500);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Constrói resposta no formato OpenAI Chat Completions
 * que o Vapi espera do Custom LLM.
 */
function buildOpenAiResponse(content: string) {
  return {
    id: `chatcmpl-valentina-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "valentina-voice-valem",
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
