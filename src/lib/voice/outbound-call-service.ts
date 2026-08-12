// src/lib/voice/outbound-call-service.ts
//
// Serviço centralizado para disparar chamadas ativas de voz (outbound call) da Valentina via Twilio API

function formatE164(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (!cleaned.startsWith("55") && cleaned.length >= 10 && cleaned.length <= 11) {
    cleaned = "55" + cleaned;
  }
  return "+" + cleaned;
}

export interface OutboundCallOptions {
  phone: string;
  fromPhone?: string;
  accountSid?: string;
  authToken?: string;
  twimlUrl?: string;
}

export async function triggerOutboundCallInternal(options: OutboundCallOptions) {
  const targetPhone = formatE164(options.phone);
  const fromPhone = options.fromPhone ? formatE164(options.fromPhone) : "+551423980186";

  const accountSid = options.accountSid || process.env.TWILIO_ACCOUNT_SID;
  const authToken = options.authToken || process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.error("[OutboundCallService] ❌ Erro: TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN não configurados!");
    return {
      success: false,
      error: "CredentialsMissing",
      message: "TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN são obrigatórios."
    };
  }

  const twimlUrl = options.twimlUrl || "https://tecfagchat.up.railway.app/api/twilio-voice-webhook";

  console.log(`[OutboundCallService] 📞 Disparando chamada ativa: From=${fromPhone} -> To=${targetPhone} | Webhook=${twimlUrl}`);

  const params = new URLSearchParams({
    To: targetPhone,
    From: fromPhone,
    Url: twimlUrl,
  });

  const authHeader = "Basic " + Buffer.from(`${accountSid.trim()}:${authToken.trim()}`).toString("base64");

  try {
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
      console.error("[OutboundCallService] ❌ Erro na API do Twilio:", twilioData);
      return {
        success: false,
        error: twilioData.message || twilioData.detail || "TwilioError",
        twilioCode: twilioData.code,
      };
    }

    console.log(`[OutboundCallService] 🎉 LIGAÇÃO DISPARADA COM SUCESSO PARA ${targetPhone}! CallSid=${twilioData.sid}`);
    return {
      success: true,
      callSid: twilioData.sid,
      status: twilioData.status,
      to: targetPhone,
      from: fromPhone,
    };
  } catch (err: any) {
    console.error("[OutboundCallService] Exceção ao chamar API do Twilio:", err?.message || err);
    return {
      success: false,
      error: "Exception",
      message: err?.message || String(err)
    };
  }
}
