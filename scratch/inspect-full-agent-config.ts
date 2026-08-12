import fetch from "node-fetch";

const agentId = "agent_4401kztzk430fgrv1ac62hbbnymk";
const apiKey = "sk_dd142c168bfd9061e0025a57af2361007b6e7d5947ac4168";

async function main() {
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    headers: { "xi-api-key": apiKey }
  });
  const data = await res.json();
  console.log("Agent conversation_config:", JSON.stringify(data.conversation_config, null, 2));
}
main();
