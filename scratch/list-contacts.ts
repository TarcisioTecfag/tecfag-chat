import { db } from "../src/db";
import { contacts } from "../src/db/schema";
import { sql } from "drizzle-orm";

async function listAllContacts() {
  console.log("Listando contatos...");
  const allContacts = await db
    .select()
    .from(contacts)
    .limit(20);

  for (const c of allContacts) {
    console.log(`ID: ${c.id} | Name: ${c.name}`);
  }
}

listAllContacts().catch(console.error);
