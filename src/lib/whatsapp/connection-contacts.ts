import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  contacts,
  contactChannelIdentities,
  whatsappConnectionContacts,
  whatsappConnections,
} from "../../db/schema";
import { buildPhoneSearchTerms } from "../utils";
type Reader = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function findConnectionContact(
  reader: Reader,
  tenantId: string,
  connectionId: string,
  jid: string,
  phone?: string,
) {
  const [identity] = await reader
    .select({ contactId: contactChannelIdentities.contactId })
    .from(contactChannelIdentities)
    .where(
      and(
        eq(contactChannelIdentities.tenantId, tenantId),
        eq(contactChannelIdentities.connectionId, connectionId),
        eq(contactChannelIdentities.externalId, jid),
      ),
    )
    .limit(1);
  if (identity) {
    const [contact] = await reader
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, identity.contactId)))
      .limit(1);
    return contact;
  }
  if (!phone) return undefined;
  const terms = buildPhoneSearchTerms(phone);
  if (!terms.length) return undefined;
  const found = await reader
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.tenantId, tenantId),
        or(
          ...terms.map(
            (term) => sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}`,
          ),
        ),
      ),
    )
    .limit(2);
  // Ambiguous historical duplicates require reconciliation; never pick a name or first row.
  if (found.length > 1)
    throw new Error(
      "Telefone associado a contatos duplicados; revise os cadastros antes de sincronizar.",
    );
  return found[0];
}

export async function captureConnectionPeer(
  tenantId: string,
  connectionId: string,
  jid: string,
  phone?: string,
) {
  const [config] = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.id, connectionId),
        eq(whatsappConnections.enabled, true),
      ),
    );
  if (!config) return false;
  if (config.capturePolicy === "all") return true;
  const contact = await findConnectionContact(db, tenantId, connectionId, jid, phone);
  if (!contact) return false;
  const [selected] = await db
    .select({ id: whatsappConnectionContacts.id })
    .from(whatsappConnectionContacts)
    .where(
      and(
        eq(whatsappConnectionContacts.tenantId, tenantId),
        eq(whatsappConnectionContacts.connectionId, connectionId),
        eq(whatsappConnectionContacts.contactId, contact.id),
      ),
    )
    .limit(1);
  return !!selected;
}

export async function bindConnectionIdentity(
  reader: Reader,
  tenantId: string,
  connectionId: string,
  contactId: string,
  externalId: string,
  alias?: string,
) {
  const [existing] = await reader
    .select({ contactId: contactChannelIdentities.contactId })
    .from(contactChannelIdentities)
    .where(
      and(
        eq(contactChannelIdentities.tenantId, tenantId),
        eq(contactChannelIdentities.connectionId, connectionId),
        eq(contactChannelIdentities.externalId, externalId),
      ),
    )
    .limit(1);
  if (existing && existing.contactId !== contactId)
    throw new Error("Identidade externa já associada a outro contato.");
  await reader
    .insert(contactChannelIdentities)
    .values({
      id: randomUUID(),
      tenantId,
      connectionId,
      contactId,
      externalId,
      alias: alias || null,
    })
    .onConflictDoNothing();
}

export async function connectionPeerJid(tenantId: string, connectionId: string, contactId: string) {
  const identities = await db
    .select({ externalId: contactChannelIdentities.externalId })
    .from(contactChannelIdentities)
    .where(
      and(
        eq(contactChannelIdentities.tenantId, tenantId),
        eq(contactChannelIdentities.connectionId, connectionId),
        eq(contactChannelIdentities.contactId, contactId),
      ),
    );
  return (
    identities.find((i) => i.externalId.endsWith("@lid"))?.externalId ||
    identities.find((i) => i.externalId.endsWith("@s.whatsapp.net"))?.externalId
  );
}

/** Import a permitted address-book entry without changing another number's transport identity. */
export async function syncConnectionContact(
  tenantId: string,
  connectionId: string,
  jid: string,
  phoneJid: string | undefined,
  alias?: string,
) {
  const phone = phoneJid?.endsWith("@s.whatsapp.net")
    ? phoneJid.split("@")[0].split(":")[0]
    : undefined;
  if (!(await captureConnectionPeer(tenantId, connectionId, jid, phone))) return;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${phone || connectionId + jid}))`,
    );
    let contact = await findConnectionContact(tx, tenantId, connectionId, jid, phone);
    if (!contact) {
      [contact] = await tx
        .insert(contacts)
        .values({
          id: randomUUID(),
          tenantId,
          name: alias || "Contato WhatsApp",
          phone: phone || null,
          mainChannel: "whatsapp",
          tags: [],
        })
        .returning();
    }
    await bindConnectionIdentity(tx, tenantId, connectionId, contact.id, jid, alias);
    if (phoneJid && phoneJid !== jid)
      await bindConnectionIdentity(tx, tenantId, connectionId, contact.id, phoneJid, alias);
  });
}
