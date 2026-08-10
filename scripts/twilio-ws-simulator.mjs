/**
 * Simulador de MediaStream do Twilio
 * Imita exatamente o que o Twilio envia ao nosso WebSocket durante uma chamada real.
 * 
 * Uso: node scripts/twilio-ws-simulator.mjs
 */

import WebSocket from "ws";

const WS_URL = "wss://tecfagchat.up.railway.app/api/voice-stream";
const FAKE_STREAM_SID = "MZ_SIMULADOR_" + Date.now();
const FAKE_CALL_SID   = "CA_SIMULADOR_" + Date.now();

console.log("=".repeat(60));
console.log("🔌 SIMULADOR DE CHAMADA TWILIO");
console.log("=".repeat(60));
console.log(`URL:       ${WS_URL}`);
console.log(`StreamSid: ${FAKE_STREAM_SID}`);
console.log(`CallSid:   ${FAKE_CALL_SID}`);
console.log("=".repeat(60));

const ws = new WebSocket(WS_URL, {
  headers: { "User-Agent": "TwilioSimulator/1.0" }
});

ws.on("open", () => {
  console.log("\n✅ [1/3] WebSocket CONECTADO ao servidor");

  // Passo 1: Twilio envia "connected" primeiro
  const connectedMsg = JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" });
  ws.send(connectedMsg);
  console.log("📤 [2/3] Enviado evento 'connected'");

  // Passo 2: Twilio envia "start" com metadados da chamada (após ~100ms)
  setTimeout(() => {
    const startMsg = JSON.stringify({
      event: "start",
      sequenceNumber: "1",
      start: {
        streamSid: FAKE_STREAM_SID,
        callSid: FAKE_CALL_SID,
        accountSid: "AC_SIMULADOR",
        from: "+5511999999999",
        to: "+5514998364338",
        tracks: ["inbound"],
        mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 }
      },
      streamSid: FAKE_STREAM_SID
    });

    ws.send(startMsg);
    console.log("📤 [3/3] Enviado evento 'start' — servidor deve iniciar saudação ElevenLabs...\n");
    console.log("⏳ Aguardando resposta do servidor (áudio de volta)...\n");
  }, 200);
});

ws.on("message", (data) => {
  try {
    const msg = JSON.parse(data.toString());

    if (msg.event === "media") {
      const bytes = Buffer.from(msg.media.payload, "base64").length;
      console.log(`📥 ÁUDIO RECEBIDO: ${bytes} bytes (streamSid: ${msg.streamSid})`);
    } else if (msg.event === "mark") {
      console.log(`📥 MARK recebido: ${msg.mark?.name}`);
    } else {
      console.log(`📥 Evento desconhecido recebido:`, JSON.stringify(msg).slice(0, 200));
    }
  } catch {
    console.log(`📥 Dados binários recebidos: ${data.length} bytes`);
  }
});

ws.on("close", (code, reason) => {
  const msg = reason?.toString() || "(sem motivo)";
  console.log(`\n🔴 Conexão encerrada — code=${code} reason="${msg}"`);

  if (code === 1000) {
    console.log("✅ Encerramento normal");
  } else if (code === 1011) {
    console.log("❌ Erro interno no servidor (1011)");
  } else if (code === 1006) {
    console.log("❌ Conexão caiu abruptamente (sem handshake de encerramento)");
  }
  process.exit(0);
});

ws.on("error", (err) => {
  console.error(`\n❌ ERRO WebSocket: ${err.message}`);
  process.exit(1);
});

// Fecha após 30s se não houver resposta
setTimeout(() => {
  console.log("\n⏰ Timeout de 30s — nenhuma resposta recebida");
  console.log("Isso indica que o servidor recebeu o 'start' mas não enviou áudio de volta.");
  ws.close();
}, 30_000);
