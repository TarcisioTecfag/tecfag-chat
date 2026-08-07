import { db } from "../src/db/index";
import { contacts, conversations } from "../src/db/schema";
import { eq } from "drizzle-orm";

const all = await db.select().from(contacts).where(eq(contacts.tenantId, "valem"));
const tarcisios = all.filter((c: any) => 
  c.name?.toLowerCase().includes("tarcisio") || 
  c.name?.toLowerCase().includes("silva") ||
  c.phone?.includes("99836") || 
  c.phone?.includes("9836")
);
for (const c of tarcisios) {
  const convs = await db.select().from(conversations).where(eq(conversations.contactId, c.id));
  console.log(JSON.stringify({ id: c.id, name: c.name, phone: c.phone, jid: c.whatsappJid, cnpj: c.cnpj, conversations: convs.length }));
}
process.exit(0);