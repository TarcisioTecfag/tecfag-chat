import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull, notLike, or } from "drizzle-orm";
import { db } from "../../db";
import {
  agentFlowStates,
  contacts,
  conversations,
  crmConversationDeals,
  crmDealContacts,
  crmDeals,
  crmStages,
  messages,
  metaMessageTemplates,
  operators,
  rdMarketingFlows,
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
  delayEnabled?: boolean;
  delayMinutes?: number;
  dispatchContext?: {
    delayedMinutes?: number;
    manualTrigger?: boolean;
    triggeredByOperatorName?: string | null;
  };
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

export interface ResolvedRdTemplateResult {
  template: typeof metaMessageTemplates.$inferSelect | null;
  healedFromId?: string | null;
  staleRecord?: {
    id: string;
    metaTemplateId: string;
    name: string;
    language: string;
    status: string;
  } | null;
}

/**
 * Resolve o template aprovado pela Meta para um fluxo RD Marketing.
 * Se o ID configurado apontar para um template antigo (ex.: DELETED/REJECTED após recriação na Meta),
 * busca automaticamente o template APPROVED vigente com o mesmo `name` (preferindo o mesmo idioma)
 * e, se `flowId` for informado, atualiza `rd_marketing_flows.settings.whatsappTemplateId` no banco.
 */
export async function resolveApprovedRdTemplate(
  tenantId: string,
  whatsappTemplateId: string,
  options?: { flowId?: string | null; persistAutoHeal?: boolean },
): Promise<ResolvedRdTemplateResult> {
  const cleanTplKey = whatsappTemplateId.trim();
  if (!cleanTplKey) return { template: null };

  const [directApproved] = await db
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
    .orderBy(desc(metaMessageTemplates.lastSyncedAt))
    .limit(1);

  if (directApproved) {
    return { template: directApproved };
  }

  // Fallback resiliente: verifica se o ID salvo pertence a uma versão antiga (ex.: DELETED)
  const [staleRow] = await db
    .select()
    .from(metaMessageTemplates)
    .where(
      and(
        eq(metaMessageTemplates.tenantId, tenantId),
        or(
          eq(metaMessageTemplates.id, cleanTplKey),
          eq(metaMessageTemplates.metaTemplateId, cleanTplKey),
          eq(metaMessageTemplates.name, cleanTplKey),
        ),
      ),
    )
    .orderBy(desc(metaMessageTemplates.lastSyncedAt))
    .limit(1);

  if (!staleRow) {
    return { template: null, staleRecord: null };
  }

  const staleRecord = {
    id: staleRow.id,
    metaTemplateId: staleRow.metaTemplateId,
    name: staleRow.name,
    language: staleRow.language,
    status: staleRow.status,
  };

  const approvedBySameName = await db
    .select()
    .from(metaMessageTemplates)
    .where(
      and(
        eq(metaMessageTemplates.tenantId, tenantId),
        eq(metaMessageTemplates.status, "APPROVED"),
        eq(metaMessageTemplates.name, staleRow.name),
      ),
    )
    .orderBy(desc(metaMessageTemplates.lastSyncedAt));

  const replacement =
    approvedBySameName.find((row) => row.language === staleRow.language) ||
    approvedBySameName[0] ||
    null;

  if (!replacement) {
    return { template: null, staleRecord };
  }

  if (options?.flowId && options.persistAutoHeal !== false) {
    try {
      const [flow] = await db
        .select({ id: rdMarketingFlows.id, settings: rdMarketingFlows.settings })
        .from(rdMarketingFlows)
        .where(
          and(eq(rdMarketingFlows.tenantId, tenantId), eq(rdMarketingFlows.id, options.flowId)),
        )
        .limit(1);
      if (flow && flow.settings?.whatsappTemplateId === cleanTplKey) {
        await db
          .update(rdMarketingFlows)
          .set({
            settings: {
              ...flow.settings,
              whatsappTemplateId: replacement.metaTemplateId,
            },
            updatedAt: new Date(),
          })
          .where(and(eq(rdMarketingFlows.tenantId, tenantId), eq(rdMarketingFlows.id, flow.id)));
      }
    } catch (healErr) {
      console.error("[RD Marketing/SDR Template] Falha ao persistir auto-cura do template:", healErr);
    }
  }

  return {
    template: replacement,
    healedFromId: cleanTplKey,
    staleRecord,
  };
}

export const HUMAN_ACTIVE_CONVERSATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Executa o disparo PÓS-COMMIT do template WhatsApp configurado no fluxo RD Marketing:
 * - Só dispara quando o Fagner/SDR está habilitado no tenant (`sdrEnabled = true`).
 * - Respeita atendimentos humanos ativos recentes (conversa em `meus` com mensagem real nos últimos 7 dias).
 * - Contatos com carteira fixa antiga, mas sem conversa humana ativa recente (finalizada ou inativa > 7 dias),
 *   recebem normalmente a abordagem automática (preservando `walletOperatorId` intacto).
 * - Registra log claro em `rd_marketing_logs` em qualquer bloqueio para evitar falhas silenciosas.
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
      await db.insert(rdMarketingLogs).values({
        id: crypto.randomUUID(),
        tenantId,
        flowId,
        status: "warning",
        dealId,
        message: `Template WhatsApp não enviado: ${persona.name} (SDR) está desativado neste tenant.`,
      });
      return { dispatched: false, reason: "sdr_disabled" };
    }

    // 2. Carregar contato
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
      await db.insert(rdMarketingLogs).values({
        id: crypto.randomUUID(),
        tenantId,
        flowId,
        status: "warning",
        dealId,
        message: "Template WhatsApp não enviado: contato sem telefone válido.",
      });
      return { dispatched: false, reason: "missing_phone" };
    }

    // 3. Resolver template aprovado no banco (com auto-cura se o ID antigo foi substituído na Meta)
    const cleanTplKey = whatsappTemplateId.trim();
    const resolved = await resolveApprovedRdTemplate(tenantId, cleanTplKey, {
      flowId,
      persistAutoHeal: true,
    });
    const templateRow = resolved.template;

    if (!templateRow) {
      const staleSuffix = resolved.staleRecord
        ? ` (último registro: '${resolved.staleRecord.name}', status '${resolved.staleRecord.status}')`
        : "";
      await db.insert(rdMarketingLogs).values({
        id: crypto.randomUUID(),
        tenantId,
        flowId,
        status: "warning",
        dealId,
        message: `Template WhatsApp '${cleanTplKey}' não encontrado ou não aprovado na Meta${staleSuffix}.`,
      });
      return { dispatched: false, reason: "template_not_found" };
    }

    // 4. Criar ou reutilizar conversa principal sem duplicar + checar posse humana recente (7 dias)
    const activeCutoffMs = Date.now() - HUMAN_ACTIVE_CONVERSATION_WINDOW_MS;
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
              notLike(conversations.id, "conv-lc-%"),
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

        // Respeita atendimento humano ativo recente em "Meus" (últimos 7 dias).
        // Conversas finalizadas, vazias (só nota interna) ou paradas em "Meus" há > 7 dias
        // podem receber o disparo automático do SDR preservando a carteira do contato.
        if (conv.queueState === "meus") {
          const [latestRealMessage] = await tx
            .select({ id: messages.id, timestamp: messages.timestamp })
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.conversationId, conv.id),
                eq(messages.isInternalNote, false),
              ),
            )
            .orderBy(desc(messages.timestamp))
            .limit(1);

          const lastActivityTime =
            latestRealMessage?.timestamp instanceof Date
              ? latestRealMessage.timestamp.getTime()
              : conv.lastMessageTime instanceof Date
                ? conv.lastMessageTime.getTime()
                : 0;

          if (latestRealMessage && lastActivityTime >= activeCutoffMs) {
            let operatorName: string | null = null;
            const opId = conv.operatorId || contact.walletOperatorId;
            if (opId) {
              const [opRow] = await tx
                .select({ name: operators.name })
                .from(operators)
                .where(and(eq(operators.tenantId, tenantId), eq(operators.id, opId)))
                .limit(1);
              operatorName = opRow?.name || null;
            }
            return {
              blocked: true as const,
              reason: contact.walletOperatorId ? "wallet_protected" : "active_human_conversation",
              conversationId: conv.id,
              operatorName,
            };
          }
        }

        // Se estava em fila (sem operador), finalizada ou inativa > 7 dias, direciona para automacao do SDR
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
      const ownerLabel = prep.operatorName ? ` (${prep.operatorName})` : "";
      await db.insert(rdMarketingLogs).values({
        id: crypto.randomUUID(),
        tenantId,
        flowId,
        status: "warning",
        dealId,
        message:
          prep.reason === "wallet_protected"
            ? `Template '${templateRow.name}' não enviado: contato pertence à carteira ativa${ownerLabel} com conversa recente em Meus (últimos 7 dias).`
            : `Template '${templateRow.name}' não enviado: conversa humana ativa recente em Meus${ownerLabel} (últimos 7 dias).`,
      });
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

    const dispatchOriginSuffix = job.dispatchContext?.manualTrigger
      ? job.dispatchContext.triggeredByOperatorName
        ? ` manualmente por ${job.dispatchContext.triggeredByOperatorName}`
        : " manualmente"
      : job.dispatchContext?.delayedMinutes
        ? ` após atraso de ${job.dispatchContext.delayedMinutes} min`
        : "";

    await db.insert(rdMarketingLogs).values({
      id: crypto.randomUUID(),
      tenantId,
      flowId,
      status: "created",
      dealId,
      message: `Template '${templateRow.name}' enviado pelo ${persona.name}${dispatchOriginSuffix} (CWR: ${cwrResult.action}).`,
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

export interface StaleRdFlowTemplateInfo {
  flowId: string;
  flowName: string;
  enabled: boolean;
  configuredTemplateId: string;
  staleTemplateName: string | null;
  staleTemplateStatus: string | null;
  suggestedTemplate: {
    metaTemplateId: string;
    name: string;
    language: string;
  } | null;
}

export interface PendingRdTemplateDispatchItem {
  dealId: string;
  dealTitle: string;
  flowId: string;
  flowName: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  stageName: string;
  createdAt: string;
  warningMessage: string;
  flowTemplateStatus: "approved" | "auto_healable" | "missing";
  resolvedTemplateId: string | null;
  resolvedTemplateName: string | null;
}

/**
 * Inspeciona todos os fluxos RD Marketing do tenant com `whatsappTemplateId` configurado.
 * Identifica os que apontam para templates inexistentes/excluídos/não-aprovados na Meta e,
 * quando `applyAutoHeal` ou `overrides` é passado, atualiza os fluxos para o template APPROVED.
 */
export async function inspectAndRepairRdFlowTemplates(
  tenantId: string,
  opts?: { applyAutoHeal?: boolean; overrides?: Record<string, string> },
): Promise<{
  staleFlows: StaleRdFlowTemplateInfo[];
  repairedFlows: Array<{
    flowId: string;
    flowName: string;
    previousTemplateId: string;
    newTemplateId: string;
    newTemplateName: string;
  }>;
}> {
  const [flows, allTemplates] = await Promise.all([
    db
      .select({ id: rdMarketingFlows.id, settings: rdMarketingFlows.settings })
      .from(rdMarketingFlows)
      .where(eq(rdMarketingFlows.tenantId, tenantId)),
    db
      .select({
        id: metaMessageTemplates.id,
        metaTemplateId: metaMessageTemplates.metaTemplateId,
        name: metaMessageTemplates.name,
        language: metaMessageTemplates.language,
        status: metaMessageTemplates.status,
        lastSyncedAt: metaMessageTemplates.lastSyncedAt,
      })
      .from(metaMessageTemplates)
      .where(eq(metaMessageTemplates.tenantId, tenantId))
      .orderBy(desc(metaMessageTemplates.lastSyncedAt)),
  ]);

  const approvedByKey = new Map<string, (typeof allTemplates)[number]>();
  const approvedByName = new Map<string, (typeof allTemplates)[number][]>();
  const anyByKey = new Map<string, (typeof allTemplates)[number]>();

  for (const tpl of allTemplates) {
    if (!anyByKey.has(tpl.id)) anyByKey.set(tpl.id, tpl);
    if (!anyByKey.has(tpl.metaTemplateId)) anyByKey.set(tpl.metaTemplateId, tpl);
    if (!anyByKey.has(tpl.name)) anyByKey.set(tpl.name, tpl);

    if (tpl.status === "APPROVED") {
      if (!approvedByKey.has(tpl.id)) approvedByKey.set(tpl.id, tpl);
      if (!approvedByKey.has(tpl.metaTemplateId)) approvedByKey.set(tpl.metaTemplateId, tpl);
      if (!approvedByKey.has(tpl.name)) approvedByKey.set(tpl.name, tpl);
      const list = approvedByName.get(tpl.name) || [];
      list.push(tpl);
      approvedByName.set(tpl.name, list);
    }
  }

  const staleFlows: StaleRdFlowTemplateInfo[] = [];
  const repairedFlows: Array<{
    flowId: string;
    flowName: string;
    previousTemplateId: string;
    newTemplateId: string;
    newTemplateName: string;
  }> = [];

  for (const flow of flows) {
    const rawKey = String(flow.settings?.whatsappTemplateId || "").trim();
    if (!rawKey) continue;

    const overrideKey = opts?.overrides?.[flow.id]?.trim();
    if (overrideKey) {
      const targetApproved = approvedByKey.get(overrideKey);
      if (targetApproved) {
        await db
          .update(rdMarketingFlows)
          .set({
            settings: {
              ...flow.settings,
              whatsappTemplateId: targetApproved.metaTemplateId,
            },
            updatedAt: new Date(),
          })
          .where(and(eq(rdMarketingFlows.tenantId, tenantId), eq(rdMarketingFlows.id, flow.id)));
        repairedFlows.push({
          flowId: flow.id,
          flowName: flow.settings.name,
          previousTemplateId: rawKey,
          newTemplateId: targetApproved.metaTemplateId,
          newTemplateName: targetApproved.name,
        });
        continue;
      }
    }

    if (approvedByKey.has(rawKey)) continue;

    const stale = anyByKey.get(rawKey) || null;
    const candidates = stale ? approvedByName.get(stale.name) || [] : [];
    const suggested =
      (stale && candidates.find((c) => c.language === stale.language)) || candidates[0] || null;

    if (opts?.applyAutoHeal && suggested) {
      await db
        .update(rdMarketingFlows)
        .set({
          settings: {
            ...flow.settings,
            whatsappTemplateId: suggested.metaTemplateId,
          },
          updatedAt: new Date(),
        })
        .where(and(eq(rdMarketingFlows.tenantId, tenantId), eq(rdMarketingFlows.id, flow.id)));
      repairedFlows.push({
        flowId: flow.id,
        flowName: flow.settings.name,
        previousTemplateId: rawKey,
        newTemplateId: suggested.metaTemplateId,
        newTemplateName: suggested.name,
      });
      continue;
    }

    staleFlows.push({
      flowId: flow.id,
      flowName: flow.settings.name,
      enabled: Boolean(flow.settings.enabled),
      configuredTemplateId: rawKey,
      staleTemplateName: stale?.name || null,
      staleTemplateStatus: stale?.status || null,
      suggestedTemplate: suggested
        ? {
            metaTemplateId: suggested.metaTemplateId,
            name: suggested.name,
            language: suggested.language,
          }
        : null,
    });
  }

  return { staleFlows, repairedFlows };
}

/**
 * Lista negociações abertas em CONTATAR que tiveram aviso de falha no disparo do template RD
 * e ainda não receberam nenhuma mensagem real no WhatsApp.
 */
export async function listPendingRdTemplateDispatches(
  tenantId: string,
): Promise<PendingRdTemplateDispatchItem[]> {
  const [warningLogs, sentLogs, flows] = await Promise.all([
    db
      .select({
        flowId: rdMarketingLogs.flowId,
        dealId: rdMarketingLogs.dealId,
        message: rdMarketingLogs.message,
        createdAt: rdMarketingLogs.createdAt,
      })
      .from(rdMarketingLogs)
      .where(and(eq(rdMarketingLogs.tenantId, tenantId), eq(rdMarketingLogs.status, "warning")))
      .orderBy(desc(rdMarketingLogs.createdAt))
      .limit(200),
    db
      .select({
        dealId: rdMarketingLogs.dealId,
        message: rdMarketingLogs.message,
      })
      .from(rdMarketingLogs)
      .where(and(eq(rdMarketingLogs.tenantId, tenantId), eq(rdMarketingLogs.status, "created")))
      .orderBy(desc(rdMarketingLogs.createdAt))
      .limit(400),
    db
      .select({ id: rdMarketingFlows.id, settings: rdMarketingFlows.settings })
      .from(rdMarketingFlows)
      .where(eq(rdMarketingFlows.tenantId, tenantId)),
  ]);

  const alreadySentDeals = new Set<string>();
  for (const row of sentLogs) {
    if (row.dealId && /Template\s+'[^']+'\s+enviado/i.test(row.message || "")) {
      alreadySentDeals.add(row.dealId);
    }
  }

  const latestWarningByDeal = new Map<string, (typeof warningLogs)[number]>();
  for (const log of warningLogs) {
    if (!log.dealId || alreadySentDeals.has(log.dealId)) continue;
    if (!/Template WhatsApp|Falha ao enviar template/i.test(log.message || "")) continue;
    if (!latestWarningByDeal.has(log.dealId)) {
      latestWarningByDeal.set(log.dealId, log);
    }
  }

  const candidateDealIds = Array.from(latestWarningByDeal.keys());
  if (candidateDealIds.length === 0) return [];

  const dealRows = await db
    .select({
      dealId: crmDeals.id,
      title: crmDeals.title,
      status: crmDeals.status,
      createdAt: crmDeals.createdAt,
      stageName: crmStages.name,
    })
    .from(crmDeals)
    .innerJoin(
      crmStages,
      and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, crmDeals.stageId)),
    )
    .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, candidateDealIds)));

  const openContatarDeals = dealRows.filter(
    (d) =>
      d.status === "open" &&
      String(d.stageName || "")
        .trim()
        .toUpperCase() === "CONTATAR",
  );
  if (openContatarDeals.length === 0) return [];

  const openDealIds = openContatarDeals.map((d) => d.dealId);
  const participantRows = await db
    .select({
      dealId: crmDealContacts.dealId,
      contactId: contacts.id,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      walletOperatorId: contacts.walletOperatorId,
      isPrimary: crmDealContacts.isPrimary,
    })
    .from(crmDealContacts)
    .innerJoin(
      contacts,
      and(eq(contacts.tenantId, tenantId), eq(contacts.id, crmDealContacts.contactId)),
    )
    .where(
      and(eq(crmDealContacts.tenantId, tenantId), inArray(crmDealContacts.dealId, openDealIds)),
    );

  const contactByDeal = new Map<string, (typeof participantRows)[number]>();
  for (const p of participantRows) {
    const prev = contactByDeal.get(p.dealId);
    if (!prev || (p.isPrimary && !prev.isPrimary)) {
      contactByDeal.set(p.dealId, p);
    }
  }

  const contactIds = Array.from(
    new Set(Array.from(contactByDeal.values()).map((c) => c.contactId)),
  );
  const convRows =
    contactIds.length > 0
      ? await db
          .select({ id: conversations.id, contactId: conversations.contactId })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              inArray(conversations.contactId, contactIds),
            ),
          )
      : [];

  const convIds = convRows.map((c) => c.id);
  const realMsgConvs = new Set<string>();
  if (convIds.length > 0) {
    const msgRows = await db
      .select({ conversationId: messages.conversationId })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          inArray(messages.conversationId, convIds),
          eq(messages.isInternalNote, false),
        ),
      );
    for (const m of msgRows) realMsgConvs.add(m.conversationId);
  }
  const contactsWithRealMessages = new Set<string>();
  for (const c of convRows) {
    if (realMsgConvs.has(c.id)) contactsWithRealMessages.add(c.contactId);
  }

  const flowMap = new Map(flows.map((f) => [f.id, f]));
  const flowResolutionCache = new Map<
    string,
    {
      status: "approved" | "auto_healable" | "missing";
      templateId: string | null;
      templateName: string | null;
    }
  >();

  const items: PendingRdTemplateDispatchItem[] = [];
  for (const deal of openContatarDeals) {
    const contact = contactByDeal.get(deal.dealId);
    if (!contact) continue;
    const canonicalPhone = normalizeCanonicalPhone(contact.contactPhone || "");
    if (!canonicalPhone) continue;
    if (contact.walletOperatorId) continue;
    if (contactsWithRealMessages.has(contact.contactId)) continue;

    const warn = latestWarningByDeal.get(deal.dealId)!;
    const flow = flowMap.get(warn.flowId);
    const configuredTplId = String(flow?.settings?.whatsappTemplateId || "").trim();

    let resInfo = flowResolutionCache.get(warn.flowId);
    if (!resInfo) {
      if (!configuredTplId) {
        resInfo = { status: "missing", templateId: null, templateName: null };
      } else {
        const resolved = await resolveApprovedRdTemplate(tenantId, configuredTplId, {
          flowId: warn.flowId,
          persistAutoHeal: false,
        });
        if (resolved.template && !resolved.healedFromId) {
          resInfo = {
            status: "approved",
            templateId: resolved.template.metaTemplateId,
            templateName: resolved.template.name,
          };
        } else if (resolved.template && resolved.healedFromId) {
          resInfo = {
            status: "auto_healable",
            templateId: resolved.template.metaTemplateId,
            templateName: resolved.template.name,
          };
        } else {
          resInfo = { status: "missing", templateId: null, templateName: null };
        }
      }
      flowResolutionCache.set(warn.flowId, resInfo);
    }

    items.push({
      dealId: deal.dealId,
      dealTitle: deal.title,
      flowId: warn.flowId,
      flowName: flow?.settings?.name || warn.flowId,
      contactId: contact.contactId,
      contactName: contact.contactName,
      contactPhone: canonicalPhone,
      stageName: deal.stageName,
      createdAt: deal.createdAt instanceof Date ? deal.createdAt.toISOString() : String(deal.createdAt),
      warningMessage: warn.message,
      flowTemplateStatus: resInfo.status,
      resolvedTemplateId: resInfo.templateId,
      resolvedTemplateName: resInfo.templateName,
    });
  }

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Reenvia o template oficial Meta pelo Fagner e move de CONTATAR → CONTATANDO
 * para leads pendentes cujos disparos falharam anteriormente.
 */
export async function retryPendingRdTemplateDispatches(
  tenantId: string,
  dealIds?: string[],
): Promise<{
  totalAttempted: number;
  dispatchedCount: number;
  failedCount: number;
  results: Array<{
    dealId: string;
    contactName: string;
    flowName: string;
    dispatched: boolean;
    templateName?: string;
    cwrAction?: string;
    reason?: string;
  }>;
}> {
  const pending = await listPendingRdTemplateDispatches(tenantId);
  const filterSet =
    Array.isArray(dealIds) && dealIds.length > 0 ? new Set(dealIds.map((id) => id.trim())) : null;
  const targets = filterSet ? pending.filter((item) => filterSet.has(item.dealId)) : pending;

  const results: Array<{
    dealId: string;
    contactName: string;
    flowName: string;
    dispatched: boolean;
    templateName?: string;
    cwrAction?: string;
    reason?: string;
  }> = [];

  for (const item of targets) {
    if (!item.resolvedTemplateId) {
      results.push({
        dealId: item.dealId,
        contactName: item.contactName,
        flowName: item.flowName,
        dispatched: false,
        reason: "flow_template_not_configured",
      });
      continue;
    }

    const res = await dispatchRdSdrTemplatePostCommit({
      tenantId,
      flowId: item.flowId,
      dealId: item.dealId,
      contactId: item.contactId,
      whatsappTemplateId: item.resolvedTemplateId,
      clientName: item.contactName,
    });

    results.push({
      dealId: item.dealId,
      contactName: item.contactName,
      flowName: item.flowName,
      dispatched: res.dispatched,
      templateName: res.templateName,
      cwrAction: res.cwrAction,
      reason: res.reason,
    });
  }

  return {
    totalAttempted: results.length,
    dispatchedCount: results.filter((r) => r.dispatched).length,
    failedCount: results.filter((r) => !r.dispatched).length,
    results,
  };
}
