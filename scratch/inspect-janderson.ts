import { db } from "../src/db";
import { messages, contacts } from "../src/db/schema";
import { and, eq, like } from "drizzle-orm";

async function inspectJandersonMessages() {
  console.log("Iniciando inspeção de mensagens do Janderson...");

  // Buscar contato Janderson
  const contact = await db
    .select()
    .from(contacts)
    .where(like(contacts.name, "%Janderson Galvão%"))
    .limit(1);

  if (contact.length === 0) {
    console.log("Contato 'Janderson Galvão' não encontrado.");
    return;
  }

  console.log(`Contato encontrado: ${contact[0].id}`);

  // Buscar mensagens desta conversa/contato
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, contact[0].id)); // Assumindo conversationId = contactId temporariamente ou buscar por conversationId

  console.log(`Encontradas ${msgs.length} mensagens para este contato.`);

  for (const msg of msgs) {
    console.log(`---`);
    console.log(`ID: ${msg.id}`);
    console.log(`Conteúdo: ${msg.content?.substring(0, 50)}...`);
    console.log(`Media Interpretation: "${msg.mediaInterpretation}"`);
  }
}

inspectJandersonMessages().catch(console.error);
