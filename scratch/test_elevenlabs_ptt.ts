import { generateDynamicPttAudio } from "../src/lib/voice/elevenlabs-dynamic-tts";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🎙️ Testando síntese dinâmica PTT na ElevenLabs (com voz Premade/Roberta)...");
  const text = "Oi Tarcísio, tudo bem? Aqui é a Valentina da Valem Válvulas. Temos sim a válvula spray 24/410 pronta para envio!";
  
  // Se Roberta der 402 no tier free, testamos com Sarah / Jessica como fallback
  const testVoices = ["RGymW84CSmfVugnA5tvA", "cgSgspJ2msm6clMCkdW9", "EXAVITQu4vr4xnSDxMaL"];
  
  for (const vId of testVoices) {
    try {
      console.log(`\nTestando Voice ID: ${vId}...`);
      const result = await generateDynamicPttAudio({ text, voiceId: vId });
      console.log(`✅ Sucesso para voz ${vId}! Buffer: ${result.buffer.length} bytes | Duração: ${result.durationSeconds}s | MIME: ${result.mimeType}`);
      
      const isOgg = result.buffer[0] === 0x4F && result.buffer[1] === 0x67 && result.buffer[2] === 0x67 && result.buffer[3] === 0x53;
      console.log(`Header OGG válido para WhatsApp PTT: ${isOgg ? "SIM ✅ (OggS)" : "NÃO ❌"}`);
      
      const outputPath = path.join(process.cwd(), "scratch", `teste_valentina_${vId}.ogg`);
      fs.writeFileSync(outputPath, result.buffer);
      console.log(`📁 Arquivo salvo em: ${outputPath}`);
      break;
    } catch (err: any) {
      console.warn(`⚠️ Erro com voz ${vId}:`, err?.message);
    }
  }
}

main();
