import crypto from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import {
  agentFlowStates,
  contacts,
  conversations,
  crmConversationDeals,
  metaMessageTemplates,
  rdMarketingLogs,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { setAttendanceActor } from "../attendance-events";
import { SessionManager } from "../baileys/session-manager";
import {
  findConversationForContactPhone,
  resolveOrEnsureContactPhoneRow,
} from "../crm/contact-phones";
import { ensureCwrDealOnContacting } from "../triage/industrial-cwr-crm";
import { isSdrEnabledForTenant } from "../triage/sdr-disabled-routing";
import { normalizeCanonicalPhone } from "../utils";
import { outboundQueue } from "../whatsapp/outbound";

export interface RdTemplateDispatchJob {
  tenantId: string;
  flowId: string;
  dealId: string;
  contactId: string;
  whatsappTemplateId: string;
  clientName?: string | null;
  companyName?: string | null;
  document?: string | null;
}

export interface RdTemplateDispatchResult {
  dispatched: boolean;
  reason?: string;
  conversationId?: string;
  messageId?: string;
  templateName?: string;
  cwrAction?: string;
}

function extractCleanFirstName(rawName?: string | null): string | null {
  const clean = (rawName || "").trim();
  if (!clean) return null;
  if (/^(cliente|contato|visitante|lead|whatsapp|sem nome|sem identifica)/i.test(clean)) {
    return null;
  }
  if (/^\+?\d{6,20}$/.test(clean.replace(/[\s().-]/g, ""))) {
    return null;
  }
  const first = clean.split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "") || "";
  return first.length >= 2 ? first : null;
}

export function buildTemplatePayloadFromRecord(params: {
  template: {
    name: string;
    language: string;
    bodyText: string;
    bindings?: Record<string, "customer_name" | "operator_name" | "manual"> | null;
  };
  clientName?: string | null;
  personaName: string;
}): {
  renderedText: string;
  templateComponents: any[] | undefined;
} {
  const body = params.template.bodyText || "";
  const placeholderMatches = Array.from(body.matchAll(/\{\{(\d+)\}\}/g));
  if (placeholderMatches.length === 0) {
    return { renderedText: body, templateComponents: undefined };
  }

  const maxIdx = Math.max(...placeholderMatches.map((m) => Number(m[1]) || 0));
  const bindings = params.template.bindings || {};
  const firstName = extractCleanFirstName(params.clientName) || "cliente";

  const bodyParams: Array<{ type: "text"; text: string }> = [];
  let renderedText = body;

  for (let i = 1; i <= maxIdx; i++) {
    const key = String(i);
    const binding = bindings[key];
    const value =
      binding === "operator_name"
        ? params.personaName
        : firstName;
    bodyParams.push({ type: "text", text: value });
    renderedText = renderedText.replaceAll(`{{${key}}}`, value);
  }

  return {
    renderedText,
    templateComponents: [
      {
        type: "body",
        parameters: bodyParams,
      },
    ],
  };
}

/**
 * Executa o disparo PÓS-COMMIT do template WhatsApp configurado no fluxo RD Marketing:
 * - Só dispara quando o Fagner/SDR está habilitado no tenant (`sdrEnabled = true`).
 * - Respeita estritamente carteira fixa (`walletOperatorId`) e atendimentos humanos ativos (`meus`).
 * - Cria ou reutiliza a conversa principal em `automacao`, vincula o card CWR,
 *   envia o template aprovado pela Meta (com {{1}} preenchido), inicia o ciclo ativo do Fagner
 *   (`greetingDone: true`) e move o card CWR de `CONTATAR` → `CONTATANDO`.
 */
export async function dispatchRdSdrTemplatePostCommit(
  job: RdTemplateDispatchJob,
): Promise<RdTemplateDispatchResult> {
  const { tenantId, flowId, dealId, contactId, whatsappTemplateId } = job;
  const persona = getAiPersona(tenantId);

  try {
    // 1. Verificar se o Fagner SDR está LIGADO
    const sdrEnabled = await isSdrEnabledForTenant(db, tenantId);
    if (!sdrEnabled) {
      return { dispatched: false, reason: "sdr_disabled" };
    }

    // 2. Carregar contato e respeitar carteira fixa
    const [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
      .limit(1);

    if (!contact) {
      return { dispatched: false, reason: "contact_not_found" };
    }

    const canonicalPhone = normalizeCanonicalPhone(contact.phone || "");
    if (!canonicalPhone) {
      return { dispatched: false, reason: "missing_phone" };
    }

    if (contact.walletOperatorId) {
      return { dispatched: false, reason: "wallet_protected" };
    }

    // 3. Resolver template aprovado no banco
    const cleanTplKey = whatsappTemplateId.trim();
    const [templateRow] = await db
      .select()
      .from(metaMessageTemplates)
      .where(
        and(
          eq(metaMessageTemplates.tenantId, tenantId),
          eq(metaMessageTemplates.status, "APPROVED"),
          or(
            eq(metaMessageTemplates.id, cleanTplKey),
            eq(metaMessageTemplates.metaTemplateId, cleanTplKey),
            eq(metaMessageTemplates.name, cleanTplKey),
          ),
        ),
      )
      .limit(1);

    if (!templateRow) {
      await db.insert(rdMarketingLogs).values({
        id: crypto.randomUUID(),
        tenantId,
        flowId,
        status: "warning",
        dealId,
        message: `Template WhatsApp '${cleanTplKey}' não encontrado ou não aprovado na Meta.`,
      });
      return { dispatched: false, reason: "template_not_found" };
    }

    // 4. Criar ou reutilizar conversa principal sem duplicar + checar posse humana
    const prep = await db.transaction(async (tx) => {
      const matchedPhone = await resolveOrEnsureContactPhoneRow(tx, tenantId, contact.id, {
        phone: canonicalPhone,
      });

      let conv = await findConversationForContactPhone(tx, tenantId, contact.id, matchedPhone, null);
      if (!conv) {
        const [fallbackConv] = await tx
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              eq(conversations.contactId, contact.id),
              isNull(conversations.whatsappConnectionId),
            ),
          )
          .orderBy(desc(conversations.lastMessageTime))
          .limit(1);
        conv = fallbackConv || null;
      }

      if (conv) {
        // Sempre vincular o deal à conversa existente
        await tx
          .insert(crmConversationDeals)
          .values({
            id: `cd-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
            tenantId,
            conversationId: conv.id,
            dealId,
            origin: "auto_sdr",
            isActive: true,
            createdAt: new Date(),
          })
          .onConflictDoNothing();

        // Se já está com operador humano ativo em "Meus", respeitar e não atropelar
        if (conv.operatorId !== null || conv.queueState === "meus") {
          return { blocked: true as const, reason: "active_human_conversation", conversationId: conv.id };
        }

        // Se estava em fila (sem operador) ou finalizada, direciona para automacao do Fagner
        const now = new Date();
        await setAttendanceActor(tx, tenantId, `${persona.name} (RD Marketing Template)`, null);
        const [updated] = await tx
          .update(conversations)
          .set({
            queueState: "automacao",
            operatorId: null,
            updatedAt: now,
          })
          .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conv.id)))
          .returning();

        return { blocked: false as const, conversation: updated || conv };
      }

      const now = new Date();
      const newConvId = `conv-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
      await setAttendanceActor(tx, tenantId, `${persona.name} (RD Marketing Template)`, null);
      const [created] = await tx
        .insert(conversations)
        .values({
          id: newConvId,
          tenantId,
          contactId: contact.id,
          contactPhoneId: matchedPhone?.id || null,
          contactPhone: matchedPhone?.phone || canonicalPhone,
          whatsappConnectionId: null,
          operatorId: null,
          queueState: "automacao",
          unreadCount: 0,
          lastMessageText: "",
          version: 1,
          lastMessageTime: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await tx
        .insert(crmConversationDeals)
        .values({
          id: `cd-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
          tenantId,
          conversationId: created.id,
          dealId,
          origin: "auto_sdr",
          isActive: true,
          createdAt: now,
        })
        .onConflictDoNothing();

      return { blocked: false as const, conversation: created };
    });

    if (prep.blocked) {
      return { dispatched: false, reason: prep.reason, conversationId: prep.conversationId };
    }

    const conversationId = prep.conversation.id;

    // 5. Renderizar template e disparar pela OutboundQueue oficial
    const { renderedText, templateComponents } = buildTemplatePayloadFromRecord({
      template: {
        name: templateRow.name,
        language: templateRow.language,
        bodyText: templateRow.bodyText,
        bindings: templateRow.bindings,
      },
      clientName: job.clientName || contact.name,
      personaName: persona.name,
    });

    const sendResult = await outboundQueue.enqueueAndSend({
      tenantId,
      conversationId,
      recipientPhone: canonicalPhone,
      recipientUserId: contact.whatsappUserId || undefined,
      text: renderedText,
      templateName: templateRow.name,
      templateLanguage: templateRow.language || "pt_BR",
      templateComponents,
      senderType: "bot",
      senderName: `${persona.name} (SDR)`,
      idempotencyKey: `rd-sdr-tpl:${tenantId}:${dealId}:${templateRow.name}`,
    });

    if (!sendResult.success) {
      await db.insert(rdMarketingLogs).values({
        id: crypto.randomUUID(),
        tenantId,
        flowId,
        status: "warning",
        dealId,
        message: `Falha ao enviar template '${templateRow.name}': ${sendResult.error || sendResult.status}`,
      });
      return {
        dispatched: false,
        reason: sendResult.error || "template_send_failed",
        conversationId,
        templateName: templateRow.name,
      };
    }

    // 6. Iniciar/garantir ciclo de triagem do Fagner (greetingDone = true para continuar direto na resposta do cliente)
    const now = new Date();
    const initialCollectedData: Record<string, { value: string; status: "filled" | "pending" }> = {};
    const validName = extractCleanFirstName(job.clientName || contact.name)
      ? (job.clientName || contact.name || "").trim()
      : null;
    if (validName) {
      initialCollectedData["NOME COMPLETO"] = { value: validName, status: "filled" };
    }
    if (job.companyName && job.companyName.trim()) {
      initialCollectedData["EMPRESA"] = { value: job.companyName.trim(), status: "filled" };
    }
    if (job.document && job.document.trim()) {
      initialCollectedData["CNPJ OU CPF"] = { value: job.document.trim(), status: "filled" };
    }

    const flowIdKey = `fs-sdr-${tenantId}-${conversationId}`;
    const [existingFlow] = await db
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.conversationId, conversationId),
          eq(agentFlowStates.agentType, "sdr"),
        ),
      )
      .limit(1);

    if (existingFlow && existingFlow.outcome === "in_progress") {
      const existingMeta = (existingFlow.metadata as Record<string, unknown>) || {};
      await db
        .update(agentFlowStates)
        .set({
          collectedData: { ...initialCollectedData, ...((existingFlow.collectedData as Record<string, unknown>) || {}) },
          metadata: {
            ...existingMeta,
            greetingDone: true,
            rdTemplateSent: true,
            rdTemplateName: templateRow.name,
            rdDealId: dealId,
            localCrmDealId: dealId,
          },
          lastInteractionAt: now,
        })
        .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, existingFlow.id)));
    } else {
      if (existingFlow) {
        await db
          .delete(agentFlowStates)
          .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, existingFlow.id)));
      }
      await db
        .insert(agentFlowStates)
        .values({
          id: flowIdKey,
          tenantId,
          conversationId,
          agentType: "sdr",
          currentStep: "Em Qualificação",
          collectedData: initialCollectedData,
          metadata: {
            attendanceActorName: persona.name,
            stepNumber: Object.keys(initialCollectedData).length,
            totalSteps: 7,
            followUpStage: 0,
            funnelStage: "triagem",
            targetFunnel: null,
            greetingDone: true,
            rdTemplateSent: true,
            rdTemplateName: templateRow.name,
            rdDealId: dealId,
            localCrmDealId: dealId,
          },
          startedAt: new Date(now.getTime() - 2000),
          lastInteractionAt: now,
          outcome: "in_progress",
        })
        .onConflictDoNothing();
    }

    // 7. Mover o card do FUNIL CWR de CONTATAR -> CONTATANDO automaticamente
    const cwrResult = await ensureCwrDealOnContacting(db, {
      tenantId,
      conversationId,
      contactId: contact.id,
      dealIdHint: dealId,
      clientName: job.clientName || contact.name,
      companyName: job.companyName,
      actorName: persona.name,
    });

    await db.insert(rdMarketingLogs).values({
      id: crypto.randomUUID(),
      tenantId,
      flowId,
      status: "created",
      dealId,
      message: `Template '${templateRow.name}' enviado pelo ${persona.name} (CWR: ${cwrResult.action}).`,
    });

    try {
      SessionManager.getInstance().notifyPublic(tenantId, {
        type: "queue_update",
        conversationId,
        contactId: contact.id,
        contactName: contact.name,
        queueState: "automacao",
        operatorId: null,
        responsibleName: `${persona.name} IA`,
      });
      SessionManager.getInstance().notifyPublic(tenantId, {
        type: "sdr_flow_updated",
        conversationId,
        funnelStage: "triagem",
        targetFunnel: null,
        outcome: "in_progress",
      });
    } catch {
      // Falha de SSE não invalida envio confirmado
    }

    return {
      dispatched: true,
      conversationId,
      messageId: sendResult.messageId,
      templateName: templateRow.name,
      cwrAction: cwrResult.action,
    };
  } catch (err: any) {
    console.error("[RD Marketing/SDR Template] Erro pós-commit:", err?.message || err);
    return {
      dispatched: false,
      reason: err?.message || "unexpected_error",
    };
  }
}
