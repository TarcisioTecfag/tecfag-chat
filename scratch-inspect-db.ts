import { db } from "./src/db";
import { channelConfigs, conversations, contacts, agentConfigs, agentFlowStates, messages } from "./src/db/schema";

async function inspectDbDetails() {
  console.log("=== DETAILED DB INSPECTION ===");

  const configs = await db.select().from(channelConfigs);
  console.log("Channel Configs:");
  for (const c of configs) {
    console.log(`Config: id=${c.id}, tenantId=${c.tenantId}, status=${c.baileysSessionStatus}, pairedPhone=${c.baileysPairedPhone}`);
  }

  const agentCfgs = await db.select().from(agentConfigs);
  console.log("\nAgent Configs (SDR):");
  for (const a of agentCfgs) {
    console.log(`AgentConfig: id=${a.id}, tenantId=${a.tenantId}, agentType=${a.agentType}, enabled=${a.enabled}, config=${JSON.stringify(a.config)}`);
  }

  const convs = await db.select().from(conversations);
  console.log(`\nAll Conversations (${convs.length}):`);
  for (const cv of convs) {
    console.log(`Conv: id=${cv.id}, tenant=${cv.tenantId}, contactId=${cv.contactId}, queue=${cv.queueState}, opId=${cv.operatorId}, lastMsg=${cv.lastMessageText}`);
  }

  const cts = await db.select().from(contacts);
  console.log(`\nAll Contacts (${cts.length}):`);
  for (const ct of cts) {
    console.log(`Contact: id=${ct.id}, tenant=${ct.tenantId}, name=${ct.name}, phone=${ct.phone}, walletOpId=${ct.walletOperatorId}`);
  }

  process.exit(0);
}

inspectDbDetails().catch(e => {
  console.error(e);
  process.exit(1);
});
