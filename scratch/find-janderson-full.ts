import { db } from "../src/db";
import { contacts } from "../src/db/schema";
import { like } from "drizzle-orm";

async function findJanderson() {
  console.log("Procurando Janderson...");
  const c = await db
    .select()
    .from(contacts)
    .where(like(contacts.name, "%Janderson%"));

  console.log(`Encontrados ${c.length} contatos.`);
  for(const contact of c) {
      console.log(`ID: ${contact.id} | Name: ${contact.name}`);
  }
}

findJanderson().catch(console.error);
