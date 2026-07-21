import { vertexAi } from "../src/lib/vertex-ai";

async function runTest() {
  console.log("=== TESTANDO CHAMADA AO VIVO AO GEMINI 2.5 PRO (VERTEX AI) ===");

  console.log("Is ready?", vertexAi.isReady());
  console.log("Config error?", vertexAi.getError());

  if (!vertexAi.isReady()) {
    console.error("❌ Vertex AI não está configurado corretamente.");
    process.exit(1);
  }

  console.log("Enviando requisição de teste para o Gemini 2.5 Pro...");
  const text = await vertexAi.generateText("Diga 'Olá! O Agente Valentina SDR está ativo no Vertex AI Gemini 2.5 Pro!' em uma frase curta.", "gemini-2.5-pro");

  console.log("\nResposta do Gemini 2.5 Pro:");
  console.log(text);
}

runTest().catch((err) => {
  console.error("Erro na chamada:", err);
  process.exit(1);
});
