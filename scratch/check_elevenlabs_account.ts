async function checkAccount() {
  const apiKey = process.env.ELEVENLABS_API_KEY || "sk_f4b5e613103e040403bf5ca43ffc46a1b08c774d5d9fa2fd";
  
  console.log("Checking user subscription & voices with API key:", apiKey ? apiKey.slice(0, 8) + "..." : "none");
  
  const userRes = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": apiKey }
  });
  console.log("User Status:", userRes.status);
  const userData = await userRes.json();
  console.log("User Subscription:", JSON.stringify(userData.subscription || userData, null, 2));

  const voicesRes = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey }
  });
  console.log("Voices Status:", voicesRes.status);
  const voicesData = await voicesRes.json();
  console.log("Available Voices:", voicesData.voices?.map((v: any) => ({ id: v.voice_id, name: v.name, category: v.category })));
}

checkAccount();
