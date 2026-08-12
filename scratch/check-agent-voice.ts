import fetch from "node-fetch";

const agentId = "agent_4401kztzk430fgrv1ac62hbbnymk";
const apiKey = "sk_dd142c168bfd9061e0025a57af2361007b6e7d5947ac4168";

async function main() {
  // 1. Inspect agent config
  const agentRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    headers: { "xi-api-key": apiKey }
  });
  const agentData: any = await agentRes.json();
  const tts = agentData.conversation_config?.tts;

  console.log("=== AGENT TTS CONFIG ===");
  console.log("Model ID:", tts?.model_id);
  console.log("Voice ID:", tts?.voice_id);
  console.log("Audio Format:", tts?.agent_output_audio_format);
  console.log("Stability:", tts?.stability);
  console.log("Similarity Boost:", tts?.similarity_boost);
  console.log("Speed:", tts?.speed);

  // 2. Fetch details of this voice_id
  const voiceRes = await fetch(`https://api.elevenlabs.io/v1/voices/${tts?.voice_id}`, {
    headers: { "xi-api-key": apiKey }
  });
  if (voiceRes.ok) {
    const voiceData: any = await voiceRes.json();
    console.log("\n=== VOICE DETAILS ===");
    console.log("Voice Name:", voiceData.name);
    console.log("Category:", voiceData.category);
    console.log("Description:", voiceData.description || voiceData.labels);
  } else {
    console.log("\n=== VOICE DETAILS ===");
    console.log("Could not fetch voice details from API:", voiceRes.status, await voiceRes.text());
  }

  // 3. List all voices in user's library
  const allVoicesRes = await fetch(`https://api.elevenlabs.io/v1/voices`, {
    headers: { "xi-api-key": apiKey }
  });
  if (allVoicesRes.ok) {
    const allVoicesData: any = await allVoicesRes.json();
    console.log("\n=== USER VOICE LIBRARY ===");
    allVoicesData.voices.forEach((v: any) => {
      console.log(`- ${v.name} (ID: ${v.voice_id}, Category: ${v.category})`);
    });
  }
}

main();
