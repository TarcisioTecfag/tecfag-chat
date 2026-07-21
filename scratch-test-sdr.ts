import { db } from "./src/db";
import { agentConfigs, agentFlowStates, conversations, contacts, messages } from "./src/db/schema";
import { eq, desc, asc } from "drizzle-orm";

async function main() {
  console.log("=== VERIFICANDO CONTEÚDO DAS TABELAS NO BANCO ===");

  const flowStates = await db.select().from(agentFlowStates);
  console.log(`1. Total em agentFlowStates: ${flowStates.length}`);
  console.log(JSON.stringify(flowStates, null, 2));

  const convs = await db.select().from(conversations);
  console.log(`\n2. Total em conversations: ${convs.length}`);
  console.log(JSON.stringify(convs, null, 2));

  const allContacts = await db.select().from(contacts);
  console.log(`\n3. Total em contacts: ${allContacts.length}`);
  console.log(JSON.stringify(allContacts, null, 2));

  const msgs = await db.select().from(messages).limit(20);
  console.log(`\n4. Total em messages (amostra): ${msgs.length}`);
  console.log(JSON.stringify(msgs, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error("Erro ao testar query DB:", err);
  process.exit(1);
});
