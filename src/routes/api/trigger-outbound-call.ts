// src/routes/api/trigger-outbound-call.ts
//
// Endpoint REST para iniciar chamada de voz ativa (outbound call) da Valentina via Twilio REST API
//

import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatE164(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (!cleaned.startsWith("55") && cleaned.length >= 10 && cleaned.length <= 11) {
    cleaned = "55" + cleaned;
  }
  return "+" + cleaned;
}

export const Route = createFileRoute("/api/trigger-outbound-call" as any)({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const targetPhone = body.phone ? formatE164(body.phone) : "+5514998364338";
          const fromPhone = body.fromPhone ? formatE164(body.fromPhone) : "+55143980186";

          const accountSid = body.accountSid || process.env.TWILIO_ACCOUNT_SID;
          const authToken = body.authToken || process.env.TWILIO_AUTH_TOKEN;

          if (!accountSid || !authToken) {
            return jsonResponse(
              {
                error: "CredentialsMissing",
                message:
                  "TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN não foram encontrados no ambiente. " +
                  "Por favor, insira o Account SID e Auth Token da Twilio.",
              },
              400
            );
          }

          const twimlUrl =
            body.twimlUrl || "https://tecfagchat.up.railway.app/api/twilio-voice-webhook";

          console.log(
            `[OutboundCall] Disparando chamada: From=${fromPhone} -> To=${targetPhone} | Webhook=${twimlUrl}`
          );

          const params = new URLSearchParams({
            To: targetPhone,
            From: fromPhone,
            Url: twimlUrl,
          });

          const authHeader = "Basic " + Buffer.from(`${accountSid.trim()}:${authToken.trim()}`).toString("base64");

          const twilioRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid.trim()}/Calls.json`,
            {
              method: "POST",
              headers: {
                Authorization: authHeader,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: params.toString(),
            }
          );

          const twilioData = await twilioRes.json();

          if (!twilioRes.ok) {
            console.error("[OutboundCall] Erro na API do Twilio:", twilioData);
            return jsonResponse(
              {
                error: "TwilioError",
                message: twilioData.message || twilioData.detail || "Erro ao conectar com Twilio",
                twilioCode: twilioData.code,
              },
              twilioRes.status
            );
          }

          console.log(`[OutboundCall] ✅ Chamada iniciada! CallSid=${twilioData.sid}`);

          return jsonResponse({
            success: true,
            callSid: twilioData.sid,
            status: twilioData.status,
            to: targetPhone,
            from: fromPhone,
          });
        } catch (err: any) {
          console.error("[OutboundCall] Exceção:", err?.message || err);
          return jsonResponse({ error: "Exception", message: err?.message || String(err) }, 500);
        }
      },
    },
  },
});
