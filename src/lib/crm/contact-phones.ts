import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { contactPhones, contacts, conversations } from "../../db/schema";
import {
  computeContactPhoneIdentity,
  getContactPhoneTypeLabel,
  inferContactPhoneType,
  normalizeContactPhonesInput,
  type ContactPhoneInput,
  type ContactPhoneItem,
  type ContactPhoneType,
} from "../contact-phone-types";
import { buildPhoneSearchTerms, normalizeCanonicalPhone } from "../utils";

export {
  computeContactPhoneIdentity,
  getContactPhoneTypeLabel,
  inferContactPhoneType,
  normalizeContactPhonesInput,
  type ContactPhoneInput,
  type ContactPhoneItem,
  type ContactPhoneType,
};

function rowToItem(row: typeof contactPhones.$inferSelect): ContactPhoneItem {
  return {
    id: row.id,
    contactId: row.contactId,
    phone: row.phone,
    phoneIdentity: row.phoneIdentity,
    type: inferContactPhoneType(row.phone, row.type),
    label: row.label ?? null,
    isPrimary: Boolean(row.isPrimary),
    hasWhatsapp: row.hasWhatsapp !== false,
    whatsappJid: row.whatsappJid ?? null,
    whatsappUserId: row.whatsappUserId ?? null,
    position: Number(row.position ?? 0),
  };
}

function synthesizeFallbackItem(contact: {
  id: string;
  phone?: string | null;
  whatsappJid?: string | null;
  whatsappUserId?: string | null;
}): ContactPhoneItem | null {
  const raw = contact.phone?.trim();
  if (!raw) return null;
  const canonical = normalizeCanonicalPhone(raw) || raw;
  const identity = computeContactPhoneIdentity(canonical);
  if (!identity) return null;
  const type = inferContactPhoneType(canonical);
  return {
    id: `cph-${contact.id}-primary`,
    contactId: contact.id,
    phone: canonical,
    phoneIdentity: identity,
    type,
    label: null,
    isPrimary: true,
    hasWhatsapp: type !== "landline",
    whatsappJid: contact.whatsappJid ?? null,
    whatsappUserId: contact.whatsappUserId ?? null,
    position: 0,
  };
}

/**
 * Busca todos os telefones de uma lista de contatos do tenant, garantindo fallback
 * transparente para o campo `contacts.phone` caso a tabela ainda não possua linha.
 */
export async function getContactPhonesMap(
  dbOrTx: any,
  tenantId: string,
  contactIds: string[],
  fallbackContacts?: Array<{
    id: string;
    phone?: string | null;
    whatsappJid?: string | null;
    whatsappUserId?: string | null;
  }>,
): Promise<Map<string, ContactPhoneItem[]>> {
  const map = new Map<string, ContactPhoneItem[]>();
  const uniqueIds = Array.from(new Set(contactIds.filter(Boolean)));
  if (uniqueIds.length === 0) return map;

  try {
    const rows = await dbOrTx
      .select()
      .from(contactPhones)
      .where(
        and(
          eq(contactPhones.tenantId, tenantId),
          inArray(contactPhones.contactId, uniqueIds),
        ),
      )
      .orderBy(
        desc(contactPhones.isPrimary),
        asc(contactPhones.position),
        asc(contactPhones.createdAt),
      );

    for (const row of rows) {
      const list = map.get(row.contactId) ?? [];
      list.push(rowToItem(row));
      map.set(row.contactId, list);
    }
  } catch {
    // Em bancos de teste PGlite que não criaram contact_phones, usa o fallback de contacts.phone
  }

  if (fallbackContacts) {
    for (const c of fallbackContacts) {
      const existing = map.get(c.id);
      if (!existing || existing.length === 0) {
        const fallback = synthesizeFallbackItem(c);
        map.set(c.id, fallback ? [fallback] : []);
      } else if (c.phone?.trim()) {
        const primaryIdentity = computeContactPhoneIdentity(c.phone);
        const hasMatch = existing.some(
          (item) => (item.phoneIdentity || computeContactPhoneIdentity(item.phone)) === primaryIdentity,
        );
        if (!hasMatch && primaryIdentity) {
          const synth = synthesizeFallbackItem(c);
          if (synth) {
            existing.forEach((item) => {
              item.isPrimary = false;
            });
            existing.unshift(synth);
          }
        }
      }
    }
  }

  return map;
}

export async function getContactPhonesList(
  dbOrTx: any,
  tenantId: string,
  contactId: string,
  fallbackContact?: {
    phone?: string | null;
    whatsappJid?: string | null;
    whatsappUserId?: string | null;
  },
): Promise<ContactPhoneItem[]> {
  const map = await getContactPhonesMap(
    dbOrTx,
    tenantId,
    [contactId],
    fallbackContact ? [{ id: contactId, ...fallbackContact }] : undefined,
  );
  return map.get(contactId) ?? [];
}

/**
 * Sincroniza a lista de telefones de um contato na tabela `contact_phones`,
 * preservando IDs estáveis (para não quebrar `conversations.contact_phone_id`)
 * e espelhando o telefone principal em `contacts.phone`.
 */
export async function syncContactPhones(
  dbOrTx: any,
  tenantId: string,
  contactId: string,
  phonesInput: unknown,
  fallbackSinglePhone?: string | null,
): Promise<{
  phones: ContactPhoneItem[];
  primaryPhone: string | null;
  primaryPhoneItem: ContactPhoneItem | null;
}> {
  const normalized = normalizeContactPhonesInput(phonesInput, fallbackSinglePhone, contactId);
  if (normalized.validationError) {
    throw Object.assign(new Error(normalized.validationError), {
      statusCode: 400,
      code: "PHONE_DDD_REQUIRED",
    });
  }

  let existingRows: Array<typeof contactPhones.$inferSelect> = [];
  try {
    existingRows = await dbOrTx
      .select()
      .from(contactPhones)
      .where(and(eq(contactPhones.tenantId, tenantId), eq(contactPhones.contactId, contactId)));
  } catch {
    // Se a tabela contact_phones não existir no ambiente de teste isolado, atualiza apenas contacts.phone
    await dbOrTx
      .update(contacts)
      .set({ phone: normalized.primaryPhone })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
    return {
      phones: normalized.phones,
      primaryPhone: normalized.primaryPhone,
      primaryPhoneItem: normalized.phones.find((p) => p.isPrimary) ?? null,
    };
  }

  const byIdentity = new Map<string, typeof contactPhones.$inferSelect>();
  const byId = new Map<string, typeof contactPhones.$inferSelect>();
  for (const row of existingRows) {
    if (row.phoneIdentity) byIdentity.set(row.phoneIdentity, row);
    byId.set(row.id, row);
  }

  const now = new Date();
  const finalItems: ContactPhoneItem[] = normalized.phones.map((item, idx) => {
    const identity = item.phoneIdentity || computeContactPhoneIdentity(item.phone);
    const matchedExisting =
      byIdentity.get(identity) || (item.id && byId.get(item.id)) || undefined;

    return {
      id:
        matchedExisting?.id ||
        (item.id && item.id.startsWith("cph-") ? item.id : null) ||
        `cph-${contactId}-${identity.slice(-8)}-${Math.random().toString(36).slice(2, 6)}`,
      contactId,
      phone: item.phone,
      phoneIdentity: identity,
      type: item.type,
      label: item.label ?? matchedExisting?.label ?? null,
      isPrimary: item.isPrimary,
      hasWhatsapp: item.hasWhatsapp,
      whatsappJid: item.whatsappJid ?? matchedExisting?.whatsappJid ?? null,
      whatsappUserId: item.whatsappUserId ?? matchedExisting?.whatsappUserId ?? null,
      position: idx,
    };
  });

  const keptIds = finalItems.map((item) => item.id);

  // Remove telefones que foram excluídos pelo usuário
  if (keptIds.length === 0) {
    await dbOrTx
      .delete(contactPhones)
      .where(and(eq(contactPhones.tenantId, tenantId), eq(contactPhones.contactId, contactId)));
  } else {
    await dbOrTx
      .delete(contactPhones)
      .where(
        and(
          eq(contactPhones.tenantId, tenantId),
          eq(contactPhones.contactId, contactId),
          notInArray(contactPhones.id, keptIds),
        ),
      );
  }

  // Upsert de cada telefone na ordem correta
  for (const item of finalItems) {
    await dbOrTx
      .insert(contactPhones)
      .values({
        id: item.id,
        tenantId,
        contactId,
        phone: item.phone,
        phoneIdentity: item.phoneIdentity || computeContactPhoneIdentity(item.phone),
        type: item.type,
        label: item.label ?? null,
        isPrimary: item.isPrimary,
        hasWhatsapp: item.hasWhatsapp,
        whatsappJid: item.whatsappJid ?? null,
        whatsappUserId: item.whatsappUserId ?? null,
        position: item.position,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: contactPhones.id,
        set: {
          phone: item.phone,
          phoneIdentity: item.phoneIdentity || computeContactPhoneIdentity(item.phone),
          type: item.type,
          label: item.label ?? null,
          isPrimary: item.isPrimary,
          hasWhatsapp: item.hasWhatsapp,
          whatsappJid: item.whatsappJid ?? null,
          whatsappUserId: item.whatsappUserId ?? null,
          position: item.position,
          updatedAt: now,
        },
      });

    // Mantém conversations.contact_phone sincronizado caso o número formatado tenha sido atualizado
    await dbOrTx
      .update(conversations)
      .set({ contactPhone: item.phone })
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.contactId, contactId),
          eq(conversations.contactPhoneId, item.id),
        ),
      );
  }

  const primaryItem = finalItems.find((item) => item.isPrimary) ?? finalItems[0] ?? null;
  const primaryPhone = primaryItem?.phone ?? null;

  // Espelha o telefone principal em contacts.phone para compatibilidade 100% com queries legadas
  await dbOrTx
    .update(contacts)
    .set({
      phone: primaryPhone,
      ...(primaryItem?.whatsappJid ? { whatsappJid: primaryItem.whatsappJid } : {}),
      ...(primaryItem?.whatsappUserId ? { whatsappUserId: primaryItem.whatsappUserId } : {}),
    })
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));

  // Vincula conversas legadas sem contactPhoneId ao telefone principal
  if (primaryItem) {
    await dbOrTx
      .update(conversations)
      .set({
        contactPhoneId: primaryItem.id,
        contactPhone: primaryItem.phone,
      })
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.contactId, contactId),
          isNull(conversations.contactPhoneId),
        ),
      );
  }

  return {
    phones: finalItems,
    primaryPhone,
    primaryPhoneItem: primaryItem,
  };
}

/**
 * Localiza um contato no tenant por QUALQUER um de seus números cadastrados (`contact_phones` ou `contacts.phone`),
 * retornando o contato e o registro exato do telefone que deu match (`matchedPhone`).
 */
export async function findContactByAnyPhone(
  dbOrTx: any,
  tenantId: string,
  rawPhone: string,
): Promise<{
  contact: typeof contacts.$inferSelect;
  matchedPhone: ContactPhoneItem | null;
} | null> {
  const trimmed = (rawPhone || "").trim();
  if (!trimmed) return null;

  const identity = computeContactPhoneIdentity(trimmed);
  const terms = buildPhoneSearchTerms(trimmed);
  if (!identity && terms.length === 0) return null;

  // 1. Busca prioritária em contact_phones
  try {
    const phoneConds = [];
    if (identity) {
      phoneConds.push(eq(contactPhones.phoneIdentity, identity));
    }
    for (const term of terms) {
      phoneConds.push(eq(contactPhones.phone, term));
      const termId = computeContactPhoneIdentity(term);
      if (termId) phoneConds.push(eq(contactPhones.phoneIdentity, termId));
    }

    if (phoneConds.length > 0) {
      const [match] = await dbOrTx
        .select({
          contact: contacts,
          phoneRow: contactPhones,
        })
        .from(contactPhones)
        .innerJoin(
          contacts,
          and(
            eq(contactPhones.contactId, contacts.id),
            eq(contacts.tenantId, tenantId),
          ),
        )
        .where(and(eq(contactPhones.tenantId, tenantId), or(...phoneConds)))
        .orderBy(desc(contactPhones.isPrimary), asc(contactPhones.position))
        .limit(1);

      if (match?.contact && match?.phoneRow) {
        return {
          contact: match.contact,
          matchedPhone: rowToItem(match.phoneRow),
        };
      }
    }
  } catch {
    // Fallback se contact_phones não estiver disponível
  }

  // 2. Fallback em contacts.phone
  const contactConds = terms.map(
    (term) => sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}`,
  );
  if (identity) {
    contactConds.push(sql`contact_phone_identity(${contacts.phone}) = ${identity}`);
  }
  if (contactConds.length === 0) return null;

  const [contactRow] = await dbOrTx
    .select()
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), or(...contactConds)))
    .orderBy(desc(contacts.createdAt))
    .limit(1);

  if (!contactRow) return null;

  const matchedPhone = await resolveOrEnsureContactPhoneRow(dbOrTx, tenantId, contactRow.id, {
    phone: contactRow.phone || trimmed,
  });

  return {
    contact: contactRow,
    matchedPhone,
  };
}

/**
 * Resolve (ou garante a criação de) um item de telefone específico para um contato.
 */
export async function resolveOrEnsureContactPhoneRow(
  dbOrTx: any,
  tenantId: string,
  contactId: string,
  options?: {
    contactPhoneId?: string | null;
    phone?: string | null;
    type?: ContactPhoneType | string | null;
    label?: string | null;
  },
): Promise<ContactPhoneItem | null> {
  const requestedId = options?.contactPhoneId?.trim() || null;
  const requestedPhone = options?.phone?.trim() || null;

  try {
    const existingRows = await dbOrTx
      .select()
      .from(contactPhones)
      .where(and(eq(contactPhones.tenantId, tenantId), eq(contactPhones.contactId, contactId)))
      .orderBy(desc(contactPhones.isPrimary), asc(contactPhones.position), asc(contactPhones.createdAt));

    if (requestedId) {
      const byId = existingRows.find((r: any) => r.id === requestedId);
      if (byId) return rowToItem(byId);
    }

    if (requestedPhone) {
      const reqIdentity = computeContactPhoneIdentity(requestedPhone);
      if (reqIdentity) {
        const byIdentity = existingRows.find((r: any) => r.phoneIdentity === reqIdentity);
        if (byIdentity) return rowToItem(byIdentity);

        // Se o número foi informado e ainda não está em contact_phones deste contato, adiciona
        const canonical = normalizeCanonicalPhone(requestedPhone) || requestedPhone;
        const isFirst = existingRows.length === 0;
        const resolvedType = inferContactPhoneType(canonical, options?.type);
        const newId = `cph-${contactId}-${reqIdentity.slice(-8)}-${Math.random().toString(36).slice(2, 6)}`;
        const now = new Date();
        const [inserted] = await dbOrTx
          .insert(contactPhones)
          .values({
            id: newId,
            tenantId,
            contactId,
            phone: canonical,
            phoneIdentity: reqIdentity,
            type: resolvedType,
            label: options?.label?.trim() || null,
            isPrimary: isFirst,
            hasWhatsapp: resolvedType !== "landline",
            position: existingRows.length,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning();

        if (inserted) {
          if (isFirst) {
            await dbOrTx
              .update(contacts)
              .set({ phone: canonical })
              .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
          }
          return rowToItem(inserted);
        }

        // Caso tenha conflitado na mesma transação, relê
        const [reread] = await dbOrTx
          .select()
          .from(contactPhones)
          .where(
            and(
              eq(contactPhones.tenantId, tenantId),
              eq(contactPhones.contactId, contactId),
              eq(contactPhones.phoneIdentity, reqIdentity),
            ),
          )
          .limit(1);
        if (reread) return rowToItem(reread);
      }
    }

    if (existingRows.length > 0) {
      return rowToItem(existingRows[0]);
    }
  } catch {
    // Fallback para bancos de teste sem a tabela contact_phones
  }

  const [contact] = await dbOrTx
    .select({
      id: contacts.id,
      phone: contacts.phone,
      whatsappJid: contacts.whatsappJid,
      whatsappUserId: contacts.whatsappUserId,
    })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
    .limit(1);

  if (!contact) return null;
  if (contact.phone) {
    try {
      const canonical = normalizeCanonicalPhone(contact.phone) || contact.phone;
      const identity = computeContactPhoneIdentity(canonical);
      if (identity) {
        const type = inferContactPhoneType(canonical);
        const [inserted] = await dbOrTx
          .insert(contactPhones)
          .values({
            id: `cph-${contact.id}-primary`,
            tenantId,
            contactId: contact.id,
            phone: canonical,
            phoneIdentity: identity,
            type,
            isPrimary: true,
            hasWhatsapp: type !== "landline",
            whatsappJid: contact.whatsappJid,
            whatsappUserId: contact.whatsappUserId,
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning();
        if (inserted) return rowToItem(inserted);
      }
    } catch {}
  }

  return synthesizeFallbackItem(contact);
}

/**
 * Busca a conversa correspondente a um `(contactId, targetPhone, whatsappConnectionId)`.
 * - Para números secundários (`!targetPhone.isPrimary`), exige correspondência exata do `contactPhoneId` (ou `contactPhone`),
 *   garantindo que cada número do contato tenha seu próprio chat separado!
 * - Para o número principal (`targetPhone.isPrimary` ou `null`), aceita tanto a conversa vinculada ao `targetPhone.id`
 *   quanto conversas legadas com `contactPhoneId IS NULL`.
 */
export async function findConversationForContactPhone(
  dbOrTx: any,
  tenantId: string,
  contactId: string,
  targetPhone: ContactPhoneItem | null,
  whatsappConnectionId: string | null = null,
): Promise<typeof conversations.$inferSelect | null> {
  const connectionCond = whatsappConnectionId
    ? eq(conversations.whatsappConnectionId, whatsappConnectionId)
    : isNull(conversations.whatsappConnectionId);

  const rows: Array<typeof conversations.$inferSelect> = await dbOrTx
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.contactId, contactId),
        connectionCond,
      ),
    )
    .orderBy(desc(conversations.lastMessageTime), desc(conversations.createdAt));

  if (rows.length === 0) return null;

  if (!targetPhone) {
    return rows[0];
  }

  const targetIdentity =
    targetPhone.phoneIdentity || computeContactPhoneIdentity(targetPhone.phone);

  // 1. Match exato por contactPhoneId
  const exactById = rows.find((r) => r.contactPhoneId === targetPhone.id);
  if (exactById) return exactById;

  // 2. Match exato por identidade do telefone gravado na conversa
  if (targetIdentity) {
    const exactByPhone = rows.find(
      (r) => r.contactPhone && computeContactPhoneIdentity(r.contactPhone) === targetIdentity,
    );
    if (exactByPhone) {
      if (!exactByPhone.contactPhoneId && targetPhone.id) {
        try {
          await dbOrTx
            .update(conversations)
            .set({ contactPhoneId: targetPhone.id, contactPhone: targetPhone.phone })
            .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, exactByPhone.id)));
          exactByPhone.contactPhoneId = targetPhone.id;
          exactByPhone.contactPhone = targetPhone.phone;
        } catch {}
      }
      return exactByPhone;
    }
  }

  // 3. Se for o telefone principal, aceita conversa legada sem contactPhoneId
  if (targetPhone.isPrimary) {
    const legacyUnbound = rows.find((r) => !r.contactPhoneId && !r.contactPhone);
    if (legacyUnbound) {
      if (targetPhone.id) {
        try {
          await dbOrTx
            .update(conversations)
            .set({ contactPhoneId: targetPhone.id, contactPhone: targetPhone.phone })
            .where(
              and(eq(conversations.tenantId, tenantId), eq(conversations.id, legacyUnbound.id)),
            );
          legacyUnbound.contactPhoneId = targetPhone.id;
          legacyUnbound.contactPhone = targetPhone.phone;
        } catch {}
      }
      return legacyUnbound;
    }
  }

  // Números secundários retornam null para que um novo chat separado seja criado!
  return null;
}
