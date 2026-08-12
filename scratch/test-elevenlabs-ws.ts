import WebSocket from "ws";

const agentId = "agent_4401kztzk430fgrv1ac62hbbnymk";
const apiKey = "sk_dd142c168bfd9061e0025a57af2361007b6e7d5947ac4168";

console.log("🔌 Conectando ao ElevenLabs WebSocket...");
const ws = new WebSocket(`wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`, {
  headers: { "xi-api-key": apiKey }
});

ws.on("open", () => {
  console.log("✅ ElevenLabs WebSocket conectado com sucesso!");
  
  const initPayload = {
    type: "conversation_initiation_client_data",
    dynamic_variables: {
      user_name: "Tarcísio",
      company_name: "TECFAG",
      product_name: "Válvula Trigger",
      quantity: "25 mil unidades",
      cnpj: "14.050.364/0001-90"
    }
  };
  ws.send(JSON.stringify(initPayload));
  console.log("Enviado initPayload (apenas dynamic_variables)!");
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("📩 Evento recebido:", msg.type, Object.keys(msg));
  if (msg.type === "audio") {
    console.log("🔊 Chunk de áudio gerado! Tamanho base64:", msg.audio_event?.audio_base_64?.length);
  }
});

ws.on("error", (err) => {
  console.error("❌ WebSocket error:", err);
});

ws.on("close", (code, reason) => {
  console.log("🔒 WebSocket encerrado:", code, reason.toString());
});
