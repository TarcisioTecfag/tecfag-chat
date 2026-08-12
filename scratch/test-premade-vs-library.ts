import fetch from "node-fetch";

const apiKey = "sk_dd142c168bfd9061e0025a57af2361007b6e7d5947ac4168";

async function testTTS(voiceId: string, voiceName: string) {
  const text = "Oii, Tarcísio! É a Valentina!";
  
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
    })
  });

  if (res.ok) {
    console.log(`✅ [${voiceName}] Sucesso no envio API direct!`);
  } else {
    const err = await res.json();
    console.log(`❌ [${voiceName}] HTTP ${res.status}:`, err.detail?.message || err);
  }
}

async function main() {
  await testTTS("RGymW84CSmfVugnA5tvA", "Roberta (Library)");
  await testTTS("EXAVITQu4vr4xnSDxMaL", "Sarah (Premade)");
  await testTTS("Xb7hH8MSUJpSbSDYk0k2", "Alice (Premade)");
  await testTTS("cgSgspJ2msm6clMCkdW9", "Jessica (Premade)");
  await testTTS("hpp4J3VqNfWAUOO0d1Us", "Bella (Premade)");
}

main();
