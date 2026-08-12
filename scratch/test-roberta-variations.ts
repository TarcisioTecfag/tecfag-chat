import fetch from "node-fetch";

const apiKey = "sk_dd142c168bfd9061e0025a57af2361007b6e7d5947ac4168";
const voiceId = "RGymW84CSmfVugnA5tvA"; // Roberta

async function testTTS(name: string, modelId: string, stability: number, similarityBoost: number, speed: number) {
  const text = "Oii, Tarcísio! É a Valentina da Valem Válvulas! Consegui pegar aqui com o pessoal os dados da cotação das 25 mil válvulas trigger para a Tecfag!";
  
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
        speed
      }
    })
  });

  if (res.ok) {
    const buffer = await res.arrayBuffer();
    console.log(`✅ [${name}] Gerado com sucesso! Tamanho: ${buffer.byteLength} bytes (Modelo: ${modelId}, Stability: ${stability}, Speed: ${speed})`);
  } else {
    console.log(`❌ [${name}] Erro ao gerar:`, res.status, await res.text());
  }
}

async function main() {
  console.log("=== TESTANDO CONFIGURAÇÕES DA VOZ ROBERTA ===");
  await testTTS("Standard Multilingual v2", "eleven_multilingual_v2", 0.5, 0.75, 1.0);
  await testTTS("Empathetic Multilingual v2", "eleven_multilingual_v2", 0.35, 0.8, 0.96);
  await testTTS("Turbo v2.5", "eleven_turbo_v2_5", 0.5, 0.75, 1.0);
  await testTTS("Flash v2.5", "eleven_flash_v2_5", 0.5, 0.75, 1.0);
}

main();
