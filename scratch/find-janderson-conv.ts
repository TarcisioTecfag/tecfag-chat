import { db } from "../src/db";
import { conversations, messages, contacts } from "../src/db/schema";
import { and, eq, like } from "drizzle-orm";

async function findJandersonConversation() {
  console.log("Procurando conversa do Janderson...");

  // 1. Achar o contato
  const contact = await db
    .select()
    .from(contacts)
    .where(like(contacts.name, "%Janderson Galvão%"))
    .limit(1);

  if (contact.length === 0) {
    console.log("Contato não encontrado.");
    return;
  }

  const contactId = contact[0].id;
  console.log(`Contato: ${contact[0].name} (${contactId})`);

  // 2. Achar a conversa vinculada a esse contato
  const convs = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contactId));

  console.log(`Conversas encontradas: ${convs.length}`);

  for (const conv of convs) {
    console.log(`Conversa ID: ${conv.id}`);
    
    // 3. Buscar mensagens dessa conversa
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(messages.createdAt);

    console.log(`Mensagens na conversa ${conv.id}: ${msgs.length}`);
    for (const msg of msgs) {
      if (msg.content?.includes("[MEDIA:audio]")) {
        console.log(`---`);
        console.log(`Msg ID: ${msg.id}`);
        console.log(`Interpret: "${msg.mediaInterpretation}"`);
      }
    }
  }
}

findJandersonConversation().catch(console.error);
