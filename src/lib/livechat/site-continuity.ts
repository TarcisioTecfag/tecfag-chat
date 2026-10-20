/**
 * Continuidade segura site → WhatsApp (Etapa E4 do porte).
 *
 * 1. O visitante pede "Continuar no WhatsApp" no widget: o servidor gera um código de uso único
 *    (30 min) e guarda apenas o hash no contato do site.
 * 2. O cliente envia o código pelo WhatsApp. A mensagem prova posse do telefone; o código prova
 *    posse da sessão do site. Só então as duas conversas são vinculadas, dentro do mesmo tenant.
 * 3. O histórico do site é copiado para a conversa do WhatsApp. Se a triagem ainda estava com a IA,
 *    ela continua de onde parou (dados coletados preservados, sem nova saudação). Se já havia
 *    responsável, a conversa do WhatsApp vai para o mesmo operador e card, sem novo rodízio.
 */
import crypto from "crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  agentFlowStates,
  contacts,
  conversations,
  crmConversationDeals,
  messages,
} from "../../db/schema";
import type { LcVisitor } from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";
import { getOrCreateActiveChat, saveMessage } from "./livechatStorage";
import { siteGateway } from "./site-gateway";
import {
  CONTINUITY_TTL_MS,
  SITE_CHANNEL,
  buildContinuationUrl,
  extractContinuityCode,
  generateContinuityCode,
  hashContinuityCode,
  isSiteConversationId,
  isUsableContinuityRecord,
  siteIdentityIds,
  stripHandoffState,
} from "./site-channel-policy";
import { ensureSiteConversation, loadSiteChannelSettings, usesIndustrialSiteCore } from "./site-industrial-adapter";
import { readSiteContinuationHistory } from "./site-conversation-store";
import { appendIndustrialJournal } from "../triage/industrial-triage-journal-store";

const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export type ContinuationRequestResult =
  | { ok: true; code: string; url: string; expiresAt: string }
  | { ok: false; reason: "disabled" | "no_whatsapp_number"; message: string };

/** Gera (ou substitui) o código do visitante. Um novo pedido invalida o código anterior. */
export async function createSiteContinuation(
  tenantId: string,
  visitor: LcVisitor,
): Promise<ContinuationRequestResult> {
  const settings = await loadSiteChannelSettings(tenantId);
  if (!settings.enabled)
    return { ok: false, reason: "disabled", message: "Atendimento pelo site indisponível no momento." };
  if (!settings.whatsappNumber)
    return {
      ok: false,
      reason: "no_whatsapp_number",
      message: "A continuação pelo WhatsApp ainda não está disponível. Pode seguir por aqui mesmo!",
    };
  await ensureSiteConversation(tenantId, visitor);
  const { contactId } = siteIdentityIds(visitor.id);
  const code = generateContinuityCode((size) => crypto.randomBytes(size));
  const expiresAt = new Date(Date.now() + CONTINUITY_TTL_MS).toISOString();
  const continuity = {
    codeHash: hashContinuityCode(tenantId, code, sha256Hex),
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  await db
    .update(contacts)
    .set({
      customFields: sql`coalesce(${contacts.customFields}, '{}'::jsonb) || jsonb_build_object('siteContinuity', ${JSON.stringify(continuity)}::jsonb)`,
    })
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
  return {
    ok: true,
    code,
    url: buildContinuationUrl(settings.whatsappNumber, code, getAiPersona(tenantId).company),
    expiresAt,
  };
}

export type ContinuityLinkResult =
  | { linked: false; reason: "no_code" | "not_industrial" | "invalid_or_expired" | "same_channel" }
  | {
      linked: true;
      /** automation: a IA continua a triagem no WhatsApp; operator: já existe responsável humano. */
      mode: "automation" | "operator";
      siteConversationId: string;
      whatsappConversationId: string;
      operatorId: string | null;
      copiedMessages: number;
    };

function isGenericContactName(name: string | null | undefined, phone: string | null | undefined) {
  const value = (name || "").trim();
  const digits = (phone || "").replace(/\D/g, "");
  return (
    !value ||
    value === "Contato WhatsApp" ||
    value.startsWith("@") ||
    (digits.length > 0 && value.replace(/\D/g, "") === digits && !/[a-z]/i.test(value))
  );
}

/**
 * Chamado quando chega mensagem de cliente no WhatsApp de um tenant industrial.
 * Não envia nada ao cliente; apenas vincula e devolve o modo para o chamador decidir se a IA responde.
 */
export async function linkSiteContinuity(
  tenantId: string,
  whatsappConversationId: string,
  text: unknown,
): Promise<ContinuityLinkResult> {
  const code = extractContinuityCode(text);
  if (!code) return { linked: false, reason: "no_code" };
  if (!usesIndustrialSiteCore(tenantId)) return { linked: false, reason: "not_industrial" };
  if (isSiteConversationId(whatsappConversationId)) return { linked: false, reason: "same_channel" };
  const codeHash = hashContinuityCode(tenantId, code, sha256Hex);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${`site-continuity:${codeHash}`}))`);
    const [siteContact] = await tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.mainChannel, SITE_CHANNEL),
          sql`${contacts.customFields}->'siteContinuity'->>'codeHash' = ${codeHash}`,
        ),
      )
      .for("update");
    const continuity = (siteContact?.customFields as Record<string, any> | undefined)?.siteContinuity;
    if (!siteContact || !isUsableContinuityRecord(continuity))
      return { linked: false as const, reason: "invalid_or_expired" as const };

    const [siteConv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, siteContact.id)))
      .for("update");
    const [waConv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, whatsappConversationId)))
      .for("update");
    if (!siteConv || !waConv || waConv.contactId === siteContact.id)
      return { linked: false as const, reason: "invalid_or_expired" as const };
    const [waContact] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, waConv.contactId)))
      .for("update");
    if (!waContact) return { linked: false as const, reason: "invalid_or_expired" as const };

    const now = new Date();

    // 1. Código consumido (uso único) e vínculo registrado nos dois contatos.
    await tx
      .update(contacts)
      .set({
        customFields: {
          ...((siteContact.customFields as Record<string, unknown>) || {}),
          siteContinuity: { ...continuity, usedAt: now.toISOString(), whatsappConversationId: waConv.id },
          linkedWhatsappContactId: waContact.id,
        },
      })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, siteContact.id)));
    const waFields = (waContact.customFields as Record<string, any>) || {};
    const linkedSites = Array.isArray(waFields.linkedSiteContactIds) ? waFields.linkedSiteContactIds : [];
    const identity: Partial<typeof contacts.$inferInsert> = {
      customFields: { ...waFields, linkedSiteContactIds: Array.from(new Set([...linkedSites, siteContact.id])).slice(-20) },
    };
    if (isGenericContactName(waContact.name, waContact.phone) && siteContact.name && siteContact.name !== "Visitante do site")
      identity.name = siteContact.name;
    if (!waContact.cpf && siteContact.cpf) identity.cpf = siteContact.cpf;
    if (!waContact.cnpj && siteContact.cnpj) identity.cnpj = siteContact.cnpj;
    await tx.update(contacts).set(identity).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, waContact.id)));

    // 2. Histórico do site copiado (idempotente), preservando horário e interpretação de mídia.
    const siteMessages = await readSiteContinuationHistory(tx, tenantId, siteConv.id);
    if (siteMessages.length) {
      await tx
        .insert(messages)
        .values(
          siteMessages.map((m) => ({
            id: `lcx-${sha256Hex(`${waConv.id}:${m.id}`).slice(0, 40)}`,
            tenantId,
            conversationId: waConv.id,
            senderType: m.senderType,
            senderName: m.senderName,
            content: m.content,
            isInternalNote: false,
            mediaInterpretation: m.mediaInterpretation,
            provider: m.provider || SITE_CHANNEL,
            direction: m.direction,
            status: m.status === "pending" || m.status === "sending" ? "accepted" : m.status,
            metaDetails: { copiedFrom: { channel: SITE_CHANNEL, conversationId: siteConv.id, messageId: m.id } },
            sentAt: m.sentAt,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing();
    }

    // 3. Responsável humano já definido no site? Mesmo operador e card, sem novo rodízio.
    const siteFlows = await tx
      .select()
      .from(agentFlowStates)
      .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.conversationId, siteConv.id), eq(agentFlowStates.agentType, "sdr")))
      .for("update");
    const siteFlow = siteFlows.sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt))[0];
    const siteOwner = siteConv.operatorId && siteConv.queueState === "meus" ? siteConv.operatorId : null;
    const waHasOwner = Boolean(waConv.operatorId) || waConv.queueState === "meus";
    const mode: "automation" | "operator" = siteOwner || waHasOwner ? "operator" : "automation";
    let operatorId: string | null = waConv.operatorId || null;

    const siteDeals = await tx
      .select()
      .from(crmConversationDeals)
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.conversationId, siteConv.id),
          eq(crmConversationDeals.isActive, true),
        ),
      );
    if (siteDeals.length) {
      const existing = await tx
        .select({ dealId: crmConversationDeals.dealId })
        .from(crmConversationDeals)
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(crmConversationDeals.conversationId, waConv.id),
            eq(crmConversationDeals.isActive, true),
            inArray(crmConversationDeals.dealId, siteDeals.map((d) => d.dealId)),
          ),
        );
      const already = new Set(existing.map((d) => d.dealId));
      const missing = siteDeals.filter((d) => !already.has(d.dealId));
      if (missing.length)
        await tx.insert(crmConversationDeals).values(
          missing.map((d) => ({
            id: `ccd-${crypto.randomUUID()}`,
            tenantId,
            conversationId: waConv.id,
            dealId: d.dealId,
            origin: "auto_sdr",
            createdByOperatorId: d.createdByOperatorId,
            isActive: true,
            createdAt: now,
          })),
        );
    }

    if (siteOwner && !waHasOwner) {
      const [assigned] = await tx
        .update(conversations)
        .set({
          operatorId: siteOwner,
          sectorId: siteConv.sectorId ?? waConv.sectorId,
          queueState: "meus",
          version: sql`${conversations.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.id, waConv.id),
            isNull(conversations.operatorId),
            ne(conversations.queueState, "meus"),
          ),
        )
        .returning({ id: conversations.id });
      if (assigned) operatorId = siteOwner;
      await tx
        .update(contacts)
        .set({ walletOperatorId: siteOwner })
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, waContact.id), isNull(contacts.walletOperatorId)));
    }

    const waFlows = await tx
      .select()
      .from(agentFlowStates)
      .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.conversationId, waConv.id), eq(agentFlowStates.agentType, "sdr")))
      .for("update");
    const continuedFrom = { channel: SITE_CHANNEL, conversationId: siteConv.id, linkedAt: now.toISOString() };

    if (mode === "operator") {
      // IA silenciada: o atendimento humano continua no WhatsApp.
      for (const flow of waFlows.filter((f) => f.outcome === "in_progress")) {
        const [continued] = await tx
          .update(agentFlowStates)
          .set({
            outcome: "transferred",
            currentStep: "Continuado do site com responsável",
            completedAt: now,
            metadata: { ...((flow.metadata as Record<string, unknown>) || {}), continuedFrom },
          })
          .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, flow.id))).returning();
        if (continued) await appendIndustrialJournal(tx, flow, continued, "continuity", codeHash);
      }
    } else {
      // IA continua a mesma triagem: ciclo do WhatsApp recebe os dados coletados e o início do ciclo do site.
      const previousTriages: unknown[] = [];
      for (const flow of waFlows) {
        await appendIndustrialJournal(tx, null, { ...flow, completedAt: flow.completedAt || now, outcome: flow.outcome === "in_progress" ? "merged_site" : flow.outcome }, "archive", codeHash);
        const meta = (flow.metadata as Record<string, any>) || {};
        if (Array.isArray(meta.previousTriages)) previousTriages.push(...meta.previousTriages);
        previousTriages.push({
          id: flow.id,
          startedAt: flow.startedAt ? new Date(flow.startedAt).toISOString() : null,
          completedAt: (flow.completedAt || flow.lastInteractionAt || now).toISOString(),
          outcome: flow.outcome && flow.outcome !== "in_progress" ? flow.outcome : "merged_site",
          targetFunnel: meta.targetFunnel || null,
        });
      }
      if (waFlows.length)
        await tx
          .delete(agentFlowStates)
          .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.conversationId, waConv.id), eq(agentFlowStates.agentType, "sdr")));
      const firstCopied = siteMessages[0]?.sentAt ? new Date(siteMessages[0].sentAt) : now;
      const siteMeta = (siteFlow?.metadata as Record<string, unknown>) || {};
      await tx.insert(agentFlowStates).values({
        id: `fs-sdr-${tenantId}-${waConv.id}`,
        tenantId,
        conversationId: waConv.id,
        agentType: "sdr",
        currentStep: siteFlow?.currentStep || "Em Qualificação",
        collectedData: (siteFlow?.collectedData as Record<string, unknown>) || {},
        metadata: {
          stepNumber: 1,
          totalSteps: 7,
          followUpStage: 0,
          funnelStage: "triagem",
          targetFunnel: null,
          ...stripHandoffState(siteMeta),
          continuedFrom,
          previousTriages: previousTriages.slice(-20),
        },
        startedAt: siteFlow?.startedAt
          ? new Date(Math.min(new Date(siteFlow.startedAt).getTime(), firstCopied.getTime() - 1000))
          : new Date(firstCopied.getTime() - 1000),
        lastInteractionAt: now,
        outcome: "in_progress",
      });
      if (waConv.queueState !== "automacao" && !waConv.operatorId)
        await tx
          .update(conversations)
          .set({ queueState: "automacao", updatedAt: now, version: sql`${conversations.version} + 1` })
          .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, waConv.id), isNull(conversations.operatorId)));
    }

    // 4. Site encerrado: o atendimento segue em uma única conversa (WhatsApp).
    for (const flow of siteFlows.filter((f) => f.outcome === "in_progress")) {
      const [continued] = await tx
        .update(agentFlowStates)
        .set({
          outcome: "completed",
          currentStep: "Continuado no WhatsApp",
          completedAt: now,
          metadata: {
            ...((flow.metadata as Record<string, unknown>) || {}),
            continuedTo: { channel: "whatsapp", conversationId: waConv.id, linkedAt: now.toISOString() },
          },
        })
        .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, flow.id))).returning();
      if (continued) await appendIndustrialJournal(tx, flow, continued, "continuity", codeHash);
    }
    await tx
      .update(conversations)
      .set({ queueState: "finalizados", updatedAt: now, version: sql`${conversations.version} + 1` })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, siteConv.id)));

    // 5. Nota interna nas duas conversas para rastreabilidade.
    const noteBase = {
      tenantId,
      senderType: "system",
      senderName: "Sistema",
      isInternalNote: true,
      direction: "outbound",
      provider: "system",
      status: "accepted",
      sentAt: now,
      updatedAt: now,
    } as const;
    await tx
      .insert(messages)
      .values([
        {
          ...noteBase,
          id: `sys-cont-${sha256Hex(`${waConv.id}:${siteConv.id}:${codeHash}`).slice(0, 32)}`,
          conversationId: waConv.id,
          content: `Cliente continuou no WhatsApp o atendimento iniciado no chat do site (${siteMessages.length} mensagens anexadas acima). ${mode === "operator" ? "Responsável mantido, sem novo rodízio." : `${getAiPersona(tenantId).name} segue a triagem com os dados já coletados.`}`,
        },
        {
          ...noteBase,
          id: `sys-cont-${sha256Hex(`${siteConv.id}:${waConv.id}:${codeHash}`).slice(0, 32)}`,
          conversationId: siteConv.id,
          content: "Atendimento continuado no WhatsApp pelo próprio cliente (código de continuidade validado).",
        },
      ])
      .onConflictDoNothing();

    return {
      linked: true as const,
      mode,
      siteConversationId: siteConv.id,
      whatsappConversationId: waConv.id,
      operatorId,
      copiedMessages: siteMessages.length,
      visitorId: siteContact.id.replace(/^cont-lc-/, ""),
    };
  });

  if (!result.linked) return result;
  const { visitorId, ...publicResult } = result;
  await notifyContinuity(tenantId, publicResult, visitorId).catch(() => {});
  return publicResult;
}

async function notifyContinuity(
  tenantId: string,
  result: Extract<ContinuityLinkResult, { linked: true }>,
  visitorId: string,
) {
  const session = SessionManager.getInstance();
  const [waConv, siteConv] = await Promise.all([
    db.query.conversations.findFirst({
      where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.tenantId, tenantId), dEq(t.id, result.whatsappConversationId)),
    }),
    db.query.conversations.findFirst({
      where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.tenantId, tenantId), dEq(t.id, result.siteConversationId)),
    }),
  ]);
  for (const conv of [waConv, siteConv]) {
    if (!conv) continue;
    session.notifyPublic(tenantId, {
      type: "queue_update",
      conversationId: conv.id,
      queueState: conv.queueState,
      operatorId: conv.operatorId,
      sectorId: conv.sectorId,
      version: conv.version,
    });
  }
  // Widget: aviso persistido no histórico do visitante.
  const chat = await getOrCreateActiveChat(tenantId, visitorId);
  const text = "Pronto! Seu atendimento continua no WhatsApp. Pode seguir a conversa por lá.";
  const saved = await saveMessage(tenantId, chat.id, "system", text);
  siteGateway.push(tenantId, visitorId, {
    type: "whatsapp_continued",
    chatId: chat.id,
    messageId: saved.id,
    content: text,
  });
}
