import { generateDynamicPttAudio } from "../src/lib/voice/elevenlabs-dynamic-tts";

async function testCache() {
  const text = "Oi Tarcísio, tudo bem? Aqui é a Valentina da Valem Válvulas. Temos sim a válvula spray 24/410 pronta para envio!";
  
  console.log("Chamada 1 (API ElevenLabs):");
  const t1 = Date.now();
  const res1 = await generateDynamicPttAudio({ text });
  console.log(`Resultado 1: ${Date.now() - t1}ms | Cached: ${res1.cached}`);

  console.log("\nChamada 2 (Mesmo texto - Deve vir do Cache):");
  const t2 = Date.now();
  const res2 = await generateDynamicPttAudio({ text });
  console.log(`Resultado 2: ${Date.now() - t2}ms | Cached: ${res2.cached}`);
}

testCache();
