/**
 * Adaptador de entrada do widget do site para o núcleo de triagem industrial.
 *
 * O visitante (resolvido no servidor por tenant + cookie) vira um contato/conversa do canal
 * `livechat` no módulo de Conversas. As mensagens seguem o mesmo SdrDebouncer → SdrEngine →
 * handoff transacional usados pelo WhatsApp: não existe um segundo motor de regras para o site.
 * Tenants sem perfil industrial (Valem) não passam por aqui.
 */
import crypto from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { agentConfigs, agentFlowStates, contacts, conversations, mediaFiles, messages } from "../../db/schema";
import type { LcVisitor } from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";
import { SdrDebouncer } from "../valentina/sdr-debouncer";
import { reopenIndustrialSiteConversation } from "./site-conversation-store";
import { readSiteContext, type SiteContext } from "./site-context";
import { extractSiteContextAttribution } from "../marketing/crm-attribution";
import { setAttendanceActor } from "../attendance-events";
import {
  computeContactPhoneIdentity,
  findContactByAnyPhone,
  resolveOrEnsureContactPhoneRow,
} from "../crm/contact-phones";
import {
  SITE_CHANNEL,
  SITE_PROVIDER,
  parseSiteChannelSettings,
  sanitizeSiteIdentity,
  siteIdentityIds,
  type SiteChannelSettings,
} from "./site-channel-policy";
import { isValidIndustrialPersonName } from "../triage/industrial-policy";

function isGenericSiteContactName(name: string | null | undefined): boolean {
  const trimmed = (name || "").trim();
  if (!trimmed) return true;
  if (!isValidIndustrialPersonName(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  if (lower === "visitante do site" || lower === "visitante" || lower === "sem nome") return true;
  return /^[\d\s()+-]+$/.test(trimmed);
}

/**
 * Busca contato existente no mesmo tenant pelo telefone informado no pré-chat.
 * Usa `findContactByAnyPhone` (índice `contact_phones` + `contacts`) com fallback seguro
 * para bancos de teste sem a função SQL `contact_phone_identity`.
 */
async function findMatchedContactByPhoneInTx(
  tx: any,
  tenantId: string,
  phone: string | null,
): Promise<typeof contacts.$inferSelect | null> {
  if (!phone) return null;
  try {
    const matched = await findContactByAnyPhone(tx, tenantId, phone);
    if (matched?.contact && matched.contact.tenantId === tenantId) {
      return matched.contact;
    }
  } catch {
    // Fallback em ambientes de teste (PGlite) sem função contact_phone_identity ou tabela contact_phones
    try {
      const targetIdentity = computeContactPhoneIdentity(phone);
      if (!targetIdentity) return null;
      const tenantContacts: Array<typeof contacts.$inferSelect> = await tx
        .select()
        .from(contacts)
        .where(eq(contacts.tenantId, tenantId));
      const found = tenantContacts.find(
        (c) => c.phone && computeContactPhoneIdentity(c.phone) === targetIdentity,
      );
      if (found) return found;
    } catch {}
  }
  return null;
}

/** Enriquecimento não-destrutivo de contato já existente (preenche apenas lacunas sem sobrescrever). */
async function enrichExistingContactInTx(
  tx: any,
  tenantId: string,
  existing: typeof contacts.$inferSelect,
  identity: ReturnType<typeof sanitizeSiteIdentity>,
) {
  const patch: Partial<typeof contacts.$inferInsert> = {};
  if (identity.email && !existing.email?.trim()) patch.email = identity.email;
  if (identity.name && isGenericSiteContactName(existing.name)) patch.name = identity.name;
  if (identity.cpf && !existing.cpf) patch.cpf = identity.cpf;
  if (identity.cnpj && !existing.cnpj) patch.cnpj = identity.cnpj;
  if (Object.keys(patch).length > 0) {
    await tx
      .update(contacts)
      .set(patch)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, existing.id)));
  }
}

/** Pré-preenche NOME COMPLETO / EMAIL / TELEFONE em eventual triagem aberta do site para o Fagner não repetir perguntas. */
async function preseedOpenSiteFlowIdentityInTx(
  tx: any,
  tenantId: string,
  conversationId: string,
  identity: ReturnType<typeof sanitizeSiteIdentity>,
) {
  if (!identity.name && !identity.email && !identity.phone) return;
  try {
    const [openFlow] = await tx
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.conversationId, conversationId),
          eq(agentFlowStates.agentType, "sdr"),
          eq(agentFlowStates.outcome, "in_progress"),
          isNull(agentFlowStates.completedAt),
        ),
      )
      .limit(1);
    if (!openFlow) return;
    const current =
      openFlow.collectedData && typeof openFlow.collectedData === "object"
        ? { ...(openFlow.collectedData as Record<string, { value?: string; status?: string }>) }
        : {};
    let changed = false;
    if (identity.name && !current["NOME COMPLETO"]?.value) {
      current["NOME COMPLETO"] = { value: identity.name, status: "filled" };
      changed = true;
    }
    if (identity.email && !current["EMAIL"]?.value) {
      current["EMAIL"] = { value: identity.email, status: "filled" };
      changed = true;
    }
    if (identity.phone && !current["TELEFONE"]?.value) {
      current["TELEFONE"] = { value: identity.phone, status: "filled" };
      changed = true;
    }
    if (changed) {
      await tx
        .update(agentFlowStates)
        .set({ collectedData: current })
        .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, openFlow.id)));
    }
  } catch {
    // Em mocks/testes parciais sem agent_flow_states, ignora silenciosamente
  }
}

export function usesIndustrialSiteCore(tenantId: string): boolean {
  return getAiPersona(tenantId).triagePolicy === "industrial";
}

export async function loadSiteChannelSettings(tenantId: string): Promise<SiteChannelSettings> {
  const [config] = await db
    .select({ enabled: agentConfigs.enabled, config: agentConfigs.config })
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr")))
    .limit(1);
  return parseSiteChannelSettings(config?.enabled === 1, config?.config as Record<string, unknown>);
}

/**
 * Contato e conversa do visitante. Criados somente quando ele envia a primeira mensagem.
 * Se o telefone do pré-chat já existir na base do tenant (ex.: contato do WhatsApp),
 * vincula `conv-lc-<visitorId>` ao MESMO contato existente (mantendo a conversa do site separada).
 */
export async function ensureSiteConversation(tenantId: string, visitor: LcVisitor) {
  const { contactId, conversationId } = siteIdentityIds(visitor.id);
  const identity = sanitizeSiteIdentity(
    visitor.name,
    visitor.cnpj || (visitor as { cpf?: string }).cpf,
    visitor.email,
    visitor.phone,
  );
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${conversationId}))`);

    const matchedExisting = await findMatchedContactByPhoneInTx(tx, tenantId, identity.phone);
    let targetContactId = contactId;

    if (matchedExisting) {
      targetContactId = matchedExisting.id;
      await enrichExistingContactInTx(tx, tenantId, matchedExisting, identity);
    } else {
      await tx
        .insert(contacts)
        .values({
          id: contactId,
          tenantId,
          name: identity.name || "Visitante do site",
          email: identity.email,
          phone: identity.phone,
          mainChannel: SITE_CHANNEL,
          responsibleName: "Na Fila",
          cpf: identity.cpf,
          cnpj: identity.cnpj,
        })
        .onConflictDoNothing();
      const [siteContact] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
      if (!siteContact) throw new Error("Contato do site indisponível para esta empresa");
      const patch: Partial<typeof contacts.$inferInsert> = {};
      if (identity.name && isGenericSiteContactName(siteContact.name)) patch.name = identity.name;
      if (identity.email && !siteContact.email?.trim()) patch.email = identity.email;
      if (identity.phone && !siteContact.phone?.trim()) patch.phone = identity.phone;
      if (identity.cpf && !siteContact.cpf) patch.cpf = identity.cpf;
      if (identity.cnpj && !siteContact.cnpj) patch.cnpj = identity.cnpj;
      if (Object.keys(patch).length > 0) {
        await tx
          .update(contacts)
          .set(patch)
          .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
      }
      if (identity.phone) {
        try {
          await resolveOrEnsureContactPhoneRow(tx, tenantId, contactId, { phone: identity.phone });
        } catch {}
      }
    }

    const [existing] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .for("update");
    if (existing) {
      if (existing.contactId !== targetContactId && existing.contactId === contactId) {
        const [relinked] = await tx
          .update(conversations)
          .set({ contactId: targetContactId, updatedAt: new Date() })
          .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
          .returning();
        return relinked || { ...existing, contactId: targetContactId };
      }
      return existing;
    }

    await setAttendanceActor(tx, tenantId, "Automação Site (Chat Online)", null);
    const now = new Date();
    const [created] = await tx
      .insert(conversations)
      .values({
        id: conversationId,
        tenantId,
        contactId: targetContactId,
        queueState: "automacao",
        unreadCount: 0,
        lastMessageText: "",
        version: 1,
        lastMessageTime: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  });
}

/** Reabre um atendimento finalizado como novo ciclo de triagem, preservando o histórico do ciclo anterior. */
async function reopenSiteConversation(tenantId: string, conversationId: string, inboundMessageId: string) {
  const reopened = await reopenIndustrialSiteConversation(db, tenantId, conversationId, inboundMessageId);
  if (!reopened) return;
  SessionManager.getInstance().notifyPublic(tenantId, {
    type: "queue_update",
    conversationId,
    queueState: reopened.queueState,
    operatorId: reopened.operatorId,
    sectorId: reopened.sectorId,
    version: reopened.version,
    responsibleName: `${getAiPersona(tenantId).name} IA`,
  });
}

/** Encerra o ciclo atual em automação quando o visitante reinicia o chat pelo widget, sem afetar atendimento humano ativo. */
export async function restartIndustrialSiteConversation(tenantId: string, visitorId: string) {
  const { conversationId } = siteIdentityIds(visitorId);
  SdrDebouncer.getInstance().clearSession(conversationId);
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
    .limit(1);
  if (!conv || conv.operatorId || conv.queueState === "finalizados") return false;
  const now = new Date();
  await db
    .update(conversations)
    .set({
      queueState: "finalizados",
      updatedAt: now,
      version: sql`${conversations.version} + 1`,
    })
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)));
  return true;
}

/**
 * Atualiza o contato do visitante com os dados do pré-chat (nome, e-mail, telefone e documento).
 * Se o telefone bater com um contato existente no mesmo tenant, enriquece lacunas sem sobrescrever
 * e vincula eventual conversa `conv-lc-<visitorId>` já existente ao contato encontrado.
 */
export async function applySiteIdentity(
  tenantId: string,
  visitorId: string,
  name: unknown,
  doc: unknown,
  email?: unknown,
  phone?: unknown,
) {
  const { contactId, conversationId } = siteIdentityIds(visitorId);
  const identity = sanitizeSiteIdentity(name, doc, email, phone);
  if (!identity.name && !identity.cpf && !identity.cnpj && !identity.email && !identity.phone) {
    return identity;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${conversationId}))`);

    const [conv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .limit(1);

    const matchedExisting = await findMatchedContactByPhoneInTx(tx, tenantId, identity.phone);

    if (matchedExisting) {
      await enrichExistingContactInTx(tx, tenantId, matchedExisting, identity);
      if (conv && conv.contactId === contactId && matchedExisting.id !== contactId) {
        await tx
          .update(conversations)
          .set({ contactId: matchedExisting.id, updatedAt: new Date() })
          .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)));
      }
      await preseedOpenSiteFlowIdentityInTx(tx, tenantId, conversationId, identity);
      return;
    }

    const targetId = conv?.contactId || contactId;
    const [existingContact] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, targetId)))
      .limit(1);

    if (existingContact) {
      const isDedicatedSiteContact = existingContact.id === contactId;
      const updates: Partial<typeof contacts.$inferInsert> = {};
      if (identity.name && (isDedicatedSiteContact || isGenericSiteContactName(existingContact.name))) {
        updates.name = identity.name;
      }
      if (identity.email && (isDedicatedSiteContact || !existingContact.email?.trim())) {
        updates.email = identity.email;
      }
      if (identity.phone && isDedicatedSiteContact && !existingContact.phone?.trim()) {
        updates.phone = identity.phone;
      }
      if (identity.cpf && !existingContact.cpf) updates.cpf = identity.cpf;
      if (identity.cnpj && !existingContact.cnpj) updates.cnpj = identity.cnpj;
      if (Object.keys(updates).length > 0) {
        await tx
          .update(contacts)
          .set(updates)
          .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, existingContact.id)));
      }
      if (updates.phone) {
        try {
          await resolveOrEnsureContactPhoneRow(tx, tenantId, existingContact.id, {
            phone: updates.phone,
          });
        } catch {}
      }
    }

    await preseedOpenSiteFlowIdentityInTx(tx, tenantId, conversationId, identity);
  });

  return identity;
}

export interface SiteInboundItem {
  /** ID da mensagem já persistida em `lc_messages` (deduplicada pelo widget). */
  siteMessageId: string;
  text: string;
  mediaType?: "text" | "image" | "audio" | "document";
  mimeType?: string;
  mediaBase64?: string;
  /** false = guardar o anexo para o operador sem enviar o binário à IA. */
  aiMedia?: boolean;
  fileName?: string;
  siteContext?: SiteContext | null;
}

/**
 * Registra a mensagem do visitante no atendimento comum e aciona a triagem quando a
 * conversa está com a automação. Com operador ou finalizada por humano, apenas registra.
 */
export async function handleIndustrialSiteMessage(tenantId: string, visitor: LcVisitor, item: SiteInboundItem) {
  const settings = await loadSiteChannelSettings(tenantId);
  if (!settings.enabled) return { accepted: false as const, reason: "site_channel_disabled" };

  const messageId = `lcm-${crypto.createHash("sha256").update(`${tenantId}:${item.siteMessageId}`).digest("hex").slice(0, 40)}`;
  let conv = await ensureSiteConversation(tenantId, visitor);
  if (conv.queueState === "finalizados") {
    await reopenSiteConversation(tenantId, conv.id, messageId);
    conv = (await db.query.conversations.findFirst({
      where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.tenantId, tenantId), dEq(t.id, conv.id)),
    }))!;
  }

  let content = item.text;
  if (item.mediaBase64 && item.mediaType && item.mediaType !== "text") {
    const mediaFileId = `med_lc_${messageId.slice(4)}`;
    const base64 = item.mediaBase64.replace(/^data:[^;]+;base64,/, "");
    await db
      .insert(mediaFiles)
      .values({
        id: mediaFileId,
        tenantId,
        conversationId: conv.id,
        fileName: item.fileName || item.mediaType,
        mimeType: item.mimeType || "application/octet-stream",
        fileSize: Math.floor((base64.length * 3) / 4),
        base64Data: base64,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    content = `[MEDIA:${item.mediaType}]${mediaFileId}${item.fileName ? `:${item.fileName}` : ""}${item.text ? `\n${item.text}` : ""}`;
  }

  const now = new Date();
  const siteContext = readSiteContext(item.siteContext);
  const siteAttribution = extractSiteContextAttribution(siteContext, "Chat Site");
  const [inserted] = await db
    .insert(messages)
    .values({
      id: messageId,
      tenantId,
      conversationId: conv.id,
      senderType: "client",
      senderName: visitor.name || "Visitante do site",
      content: content || "[Mensagem do visitante]",
      isInternalNote: false,
      direction: "inbound",
      provider: SITE_PROVIDER,
      externalId: item.siteMessageId,
      status: "delivered",
      ...(siteContext
        ? {
            metaDetails: {
              siteContext,
              ...(siteAttribution ? { marketingAttribution: siteAttribution } : {}),
            },
          }
        : {}),
      sentAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) return { accepted: true as const, duplicate: true, conversationId: conv.id };

  if (siteAttribution) {
    try {
      await db
        .update(contacts)
        .set({
          firstSource: siteAttribution.source,
          firstCampaign: siteAttribution.campaign,
          utmSource: siteAttribution.utmSource,
          utmMedium: siteAttribution.utmMedium,
          utmCampaign: siteAttribution.utmCampaign,
          utmContent: siteAttribution.utmContent,
          utmTerm: siteAttribution.utmTerm,
          clickId: siteAttribution.clickId,
          landingPage: siteAttribution.landingPage,
          sectorOrigin: sql`COALESCE(${contacts.sectorOrigin}, 'pre_venda')`,
        })
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            eq(contacts.id, conv.contactId),
            sql`${contacts.firstSource} IS NULL`,
          ),
        );
    } catch {
      // Ignora em mocks parciais
    }
  }

  await db
    .update(conversations)
    .set({
      lastMessageText: item.text || "[Mídia do visitante]",
      lastMessageTime: now,
      updatedAt: now,
      unreadCount: sql`${conversations.unreadCount} + 1`,
    })
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conv.id)));

  const current = await db.query.conversations.findFirst({
    where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.tenantId, tenantId), dEq(t.id, conv.id)),
  });
  SessionManager.getInstance().notifyPublic(tenantId, {
    type: "message",
    message: { ...inserted, queue: current?.queueState, operatorId: current?.operatorId || null },
  });

  // Mesma trava do WhatsApp: com responsável humano o SDR não responde.
  if (current && !current.operatorId && current.queueState === "automacao") {
    let resolvedPhone = visitor.phone || "";
    try {
      const [linkedContact] = await db
        .select({ phone: contacts.phone })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, current.contactId)))
        .limit(1);
      if (linkedContact?.phone) resolvedPhone = linkedContact.phone;
    } catch {}
    const sendMedia = item.aiMedia !== false && Boolean(item.mediaBase64);
    SdrDebouncer.getInstance().pushIncomingMessage(tenantId, conv.id, resolvedPhone, {
      messageId,
      text: item.text,
      mediaType: sendMedia ? item.mediaType || "text" : "text",
      mimeType: sendMedia ? item.mimeType : undefined,
      mediaBase64: sendMedia ? item.mediaBase64?.replace(/^data:[^;]+;base64,/, "") : undefined,
      receivedAt: now,
    });
  }
  return { accepted: true as const, duplicate: false, conversationId: conv.id };
}
