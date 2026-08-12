import fetch from "node-fetch";

const agentId = "agent_4401kztzk430fgrv1ac62hbbnymk";
const apiKey = "sk_dd142c168bfd9061e0025a57af2361007b6e7d5947ac4168";

async function main() {
  const updatePayload = {
    conversation_config: {
      agent: {
        first_message: "Oii, {{user_name}}! É a Valentina da Valem Válvulas! Consegui pegar aqui os dados da cotação!"
      }
    }
  };

  const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    method: "PATCH",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(updatePayload)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("❌ Erro ao atualizar agente:", res.status, errText);
    return;
  }

  const data = await res.json();
  console.log("✅ Agente atualizado com sucesso! first_message:", data.conversation_config?.agent?.first_message);
}

main();
