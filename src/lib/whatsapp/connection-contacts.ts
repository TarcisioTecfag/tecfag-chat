import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  contacts,
  contactPhones,
  contactChannelIdentities,
  whatsappConnectionContacts,
  whatsappConnections,
} from "../../db/schema";
import { buildPhoneSearchTerms } from "../utils";
type Reader = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function computeContactPhoneIdentity(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 13 && digits.startsWith("55") && digits[4] === "9") {
    return `${digits.slice(0, 4)}${digits.slice(5)}`;
  }
  if (digits.length === 11 && digits[2] === "9") {
    return `55${digits.slice(0, 2)}${digits.slice(3)}`;
  }
  if (digits.length === 10) {
    return `55${digits}`;
  }
  return digits;
}

const GENERIC_PLACEHOLDER_NAMES = new Set([
  "contato",
  "cliente",
  "contato whatsapp",
  "lead whatsapp",
  "contato sem nome",
  "sem nome",
  "desconhecido",
  "unknown",
]);

export function isPlaceholderOrPhoneContactName(
  rawName: string | null | undefined,
  phone?: string | null,
): boolean {
  const trimmed = String(rawName || "").trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (GENERIC_PLACEHOLDER_NAMES.has(lower)) return true;
  if (/^(?:cliente|contato|lead|whatsapp)\s*\([^)]*\)$/i.test(trimmed)) return true;
  if (lower.endsWith("@lid") || lower.endsWith("@s.whatsapp.net")) return true;

  if (phone) {
    const cleanPhone = phone.trim();
    const phoneDigits = cleanPhone.replace(/\D/g, "");
    if (cleanPhone && (trimmed === cleanPhone || trimmed === `+${phoneDigits}`)) return true;
    if (phoneDigits && trimmed.replace(/\D/g, "") === phoneDigits && !/[a-zA-ZÀ-ÿ]/.test(trimmed)) {
      return true;
    }
  }

  const strippedFormatting = trimmed.replace(/[\s()+.\-/\u00A0\u200E\u200F\u202A-\u202E]/g, "");
  if (/^\d{6,20}$/.test(strippedFormatting)) return true;

  return false;
}

export function pickWhatsappContactDisplayName(
  candidates: Array<string | null | undefined>,
  phone?: string | null,
): string | null {
  for (const candidate of candidates) {
    const trimmed = String(candidate || "").trim();
    if (!trimmed) continue;
    if (!isPlaceholderOrPhoneContactName(trimmed, phone)) {
      return trimmed.slice(0, 140);
    }
  }
  return null;
}

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
  if (found[0]) return found[0];

  try {
    const identity =
      typeof computeContactPhoneIdentity === "function"
        ? computeContactPhoneIdentity(phone)
        : phone.replace(/\D/g, "");
    const cpConds = terms.map((term) => eq(contactPhones.phone, term));
    if (identity) cpConds.push(eq(contactPhones.phoneIdentity, identity));
    const cpMatches = await reader
      .select({ contact: contacts })
      .from(contactPhones)
      .innerJoin(
        contacts,
        and(eq(contactPhones.contactId, contacts.id), eq(contacts.tenantId, tenantId)),
      )
      .where(and(eq(contactPhones.tenantId, tenantId), or(...cpConds)))
      .limit(2);
    const uniqueContacts = Array.from(
      new Map(cpMatches.map((m) => [m.contact.id, m.contact])).values(),
    );
    if (uniqueContacts.length > 1) {
      throw new Error(
        "Telefone associado a contatos duplicados; revise os cadastros antes de sincronizar.",
      );
    }
    return uniqueContacts[0];
  } catch (err: any) {
    if (err?.message?.includes("contatos duplicados")) throw err;
    return undefined;
  }
}

export async function captureConnectionPeer(
  tenantId: string,
  connectionId: string,
  jid: string,
  phone?: string,
  options?: { activeFromMe?: boolean },
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
  if (config.capturePolicy === "all" || options?.activeFromMe === true) return true;
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
    .select({
      id: contactChannelIdentities.id,
      contactId: contactChannelIdentities.contactId,
      alias: contactChannelIdentities.alias,
    })
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
  if (existing) {
    const validAlias = pickWhatsappContactDisplayName([alias]);
    if (validAlias && isPlaceholderOrPhoneContactName(existing.alias)) {
      await reader
        .update(contactChannelIdentities)
        .set({ alias: validAlias })
        .where(
          and(
            eq(contactChannelIdentities.tenantId, tenantId),
            eq(contactChannelIdentities.id, existing.id),
          ),
        );
    }
    return;
  }
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

export async function resolveConnectionIdentityAlias(
  reader: Reader,
  tenantId: string,
  connectionId: string,
  externalIds: string[],
  phone?: string | null,
): Promise<string | null> {
  const validIds = [...new Set(externalIds.filter(Boolean))];
  if (!validIds.length) return null;
  const rows = await reader
    .select({ alias: contactChannelIdentities.alias })
    .from(contactChannelIdentities)
    .where(
      and(
        eq(contactChannelIdentities.tenantId, tenantId),
        eq(contactChannelIdentities.connectionId, connectionId),
        validIds.length === 1
          ? eq(contactChannelIdentities.externalId, validIds[0])
          : inArray(contactChannelIdentities.externalId, validIds),
      ),
    );
  return pickWhatsappContactDisplayName(
    rows.map((r) => r.alias),
    phone,
  );
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
): Promise<{ contactId: string; updatedName?: string } | undefined> {
  const phone = phoneJid?.endsWith("@s.whatsapp.net")
    ? phoneJid.split("@")[0].split(":")[0]
    : undefined;
  if (!(await captureConnectionPeer(tenantId, connectionId, jid, phone))) return undefined;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${phone || connectionId + jid}))`,
    );
    let contact = await findConnectionContact(tx, tenantId, connectionId, jid, phone);
    const preferredName = pickWhatsappContactDisplayName([alias], phone);
    let updatedName: string | undefined;
    if (!contact) {
      [contact] = await tx
        .insert(contacts)
        .values({
          id: randomUUID(),
          tenantId,
          name: preferredName || (phone ? `Contato (${phone})` : "Contato WhatsApp"),
          phone: phone || null,
          mainChannel: "whatsapp",
          tags: [],
        })
        .returning();
    } else if (preferredName && isPlaceholderOrPhoneContactName(contact.name, contact.phone || phone)) {
      await tx
        .update(contacts)
        .set({ name: preferredName })
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contact.id)));
      updatedName = preferredName;
    }
    await bindConnectionIdentity(tx, tenantId, connectionId, contact.id, jid, preferredName || alias);
    if (phoneJid && phoneJid !== jid)
      await bindConnectionIdentity(tx, tenantId, connectionId, contact.id, phoneJid, preferredName || alias);
    return { contactId: contact.id, updatedName };
  });
}
