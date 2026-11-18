import { db } from "../src/db";
import { conversations } from "../src/db/schema";
import { desc } from "drizzle-orm";

async function listRecentConversations() {
  console.log("Listando conversas recentes...");
  const convs = await db
    .select()
    .from(conversations)
    .orderBy(desc(conversations.updatedAt))
    .limit(5);

  for (const conv of convs) {
    console.log(`Conv ID: ${conv.id} | Contact ID: ${conv.contactId} | Updated: ${conv.updatedAt}`);
  }
}

listRecentConversations().catch(console.error);
