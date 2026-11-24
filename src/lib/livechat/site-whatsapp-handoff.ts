/**
 * Ponte automática Pós-Triagem: Site (`conv-lc-*`) → WhatsApp Oficial (Template Meta).
 *
 * Regras de negócio (perfil industrial — Tecfag; Valem não passa por aqui):
 * 1) Durante toda a triagem no site, NENHUM card é criado no CRM (`FUNIL CWR` ou outros).
 * 2) Somente quando o Fagner CONCLUI a triagem no site (coletou todos os campos obrigatórios),
 *    este serviço dispara automaticamente o template Meta oficial configurado para o canal Site
 *    no WhatsApp do cliente.
 * 3) Só após o envio confirmado na Meta:
 *    - Cria/reutiliza o card no CRM no funil correspondente ao tipo de triagem:
 *      • Comercial (Máquinas, Personnalité, Peças, Análise SDR): `FUNIL CWR → CONTATANDO`
 *      • Operacional com funil próprio (Pós-Venda, Assistência/Suporte Técnico, Financeiro):
 *        direto no funil e etapa do setor (sem poluir o `FUNIL CWR`).
 *    - Herda 100% dos dados coletados + histórico do site na conversa de WhatsApp e estaciona
 *      o atendimento no WhatsApp já em `awaiting_approval` (Aprovação SDR, sem repetir perguntas).
 *    - Encerra o ciclo do site com status `continued_to_whatsapp` (mantendo o registro no Kanban
 *      da aba `Site` para contagem/métricas, sem duplicar pendência de aprovação).
 * 4) Proteção contra atendimento humano ativo no WhatsApp: se o contato já estiver em `meus` com
 *    operador humano, NÃO sequestra a conversa — registra nota interna com a triagem do site e
 *    vincula o card/jornada preservando o operador.
 */
import crypto from "node:crypto";
import { and, desc, eq, isNull, notLike, sql } from "drizzle-orm";
import {
  agentConfigs,
  agentFlowStates,
  contacts,
  conversations,
  lcChats,
  messages,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { setAttendanceActor } from "../attendance-events";
import {
  findConversationForContactPhone,
  resolveOrEnsureContactPhoneRow,
} from "../crm/contact-phones";
import {
  buildTemplatePayloadFromRecord,
  resolveApprovedRdTemplate,
} from "../rd-marketing/sdr-template-dispatch";
import {
  computePendingApprovalSuggestion,
  notifySdrTeamApprovalPending,
  type PendingApprovalSuggestion,
} from "../triage/industrial-approval-store";
import { ensureSiteDealOnWhatsappHandoff } from "../triage/industrial-cwr-crm";
import type { MachineDecision } from "../triage/industrial-decisor";
import {
  INDUSTRIAL_POLICY_VERSION,
  type CollectedFields,
  type IndustrialRoute,
} from "../triage/industrial-policy";
import type { IndustrialDatabase } from "../triage/industrial-rodizio-store";
import { appendIndustrialJournal } from "../triage/industrial-triage-journal-store";
import { normalizeCanonicalPhone } from "../utils";
import { outboundQueue } from "../whatsapp/outbound";
import {
  SITE_CHANNEL,
  buildSiteToWhatsappClosingMessage,
  isSiteConversationId,
  parseSiteChannelSettings,
  visitorIdFromSiteConversation,
} from "./site-channel-policy";
import { siteContextFromMessages } from "./site-context";
import { readSiteContinuationHistory } from "./site-conversation-store";

const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export interface SiteWhatsappHandoffInput {
  tenantId: string;
  siteConversationId: string;
  siteFlowId: string;
  cycle: string;
  route: IndustrialRoute;
  data: CollectedFields;
  clientName: string;
  companyName: string;
  contactId: string | null;
  machineDecision?: MachineDecision;
  siteContext?: unknown;
}

export interface SiteWhatsappHandoffResult {
  handedOff: boolean;
  reason?: string;
  whatsappConversationId?: string;
  dealId?: string | null;
  dealTitle?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  templateName?: string;
  closingMessageForSite?: string;
  suggestion?: PendingApprovalSuggestion | null;
  preservedHumanOperator?: boolean;
}

function summarizeSiteTriageNote(input: SiteWhatsappHandoffInput, templateName: string): string {
  const lines = [
    `🌐 **Triagem concluída no Site e transferida para o WhatsApp**`,
    `• **Template enviado:** \`${templateName}\``,
    `• **Fluxo/Destino:** ${input.route.targetFunnel || input.route.subflow || "Triagem SDR"}`,
  ];
  const entries = Object.entries(input.data || {}).filter(
    ([k, v]) => !k.startsWith("_") && typeof v?.value === "string" && v.value.trim().length > 0,
  );
  if (entries.length > 0) {
    lines.push("", "**Dados coletados no site:**");
    for (const [k, v] of entries) {
      lines.push(`- **${k}:** ${v.value!.trim()}`);
    }
  }
  return lines.join("\n");
}

function resolveTemplateTopicSummary(input: SiteWhatsappHandoffInput): string {
  const candidates = [
    input.data["EQUIPAMENTO"]?.value,
    input.data["MAQUINA"]?.value,
    input.data["PECA"]?.value,
    input.data["ASSUNTO"]?.value,
    input.data["NECESSIDADE"]?.value,
    input.route.targetFunnel,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length >= 2) {
      return c.trim().slice(0, 80);
    }
  }
  return "seu atendimento";
}

function buildSiteTemplatePayload(params: {
  template: {
    name: string;
    language: string;
    bodyText: string;
    bindings?: Record<string, "customer_name" | "operator_name" | "manual"> | null;
  };
  clientName: string;
  personaName: string;
  topicSummary: string;
}): { renderedText: string; templateComponents: any[] | undefined } {
  const base = buildTemplatePayloadFromRecord({
    template: params.template,
    clientName: params.clientName,
    personaName: params.personaName,
  });

  const body = params.template.bodyText || "";
  const matches = Array.from(body.matchAll(/\{\{(\d+)\}\}/g));
  const maxIdx = matches.length ? Math.max(...matches.map((m) => Number(m[1]) || 0)) : 0;
  const bindings = params.template.bindings || {};

  // Se o template tiver {{2}} (ou mais) sem binding explícito de operator_name, preenche com o assunto da triagem
  if (maxIdx >= 2 && base.templateComponents?.[0]?.parameters) {
    const paramsArr = [...base.templateComponents[0].parameters];
    let rendered = body;
    for (let i = 1; i <= maxIdx; i++) {
      const key = String(i);
      const binding = bindings[key];
      let val = paramsArr[i - 1]?.text || "";
      if (i >= 2 && binding !== "operator_name" && binding !== "customer_name") {
        val = params.topicSummary;
        paramsArr[i - 1] = { type: "text", text: val };
      }
      rendered = rendered.replaceAll(`{{${key}}}`, val);
    }
    return {
      renderedText: rendered,
      templateComponents: [{ type: "body", parameters: paramsArr }],
    };
  }

  return base;
}

export async function dispatchSiteTriageToWhatsApp(
  database: IndustrialDatabase,
  input: SiteWhatsappHandoffInput,
): Promise<SiteWhatsappHandoffResult> {
  const { tenantId, siteConversationId, siteFlowId, cycle } = input;
  if (!isSiteConversationId(siteConversationId)) {
    return { handedOff: false, reason: "not_site_conversation" };
  }

  const persona = getAiPersona(tenantId);
  if (persona.triagePolicy !== "industrial") {
    return { handedOff: false, reason: "non_industrial_tenant" };
  }

  // 1. Ler configuração do canal Site (template oficial Meta configurado)
  const [sdrConfigRow] = await database
    .select({ enabled: agentConfigs.enabled, config: agentConfigs.config })
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr")))
    .limit(1);

  const siteSettings = parseSiteChannelSettings(
    sdrConfigRow?.enabled === 1,
    sdrConfigRow?.config as Record<string, unknown>,
  );

  if (!siteSettings.whatsappTemplateId) {
    return { handedOff: false, reason: "site_whatsapp_template_not_configured" };
  }

  // 2. Resolver template aprovado na Meta (com auto-cura se ID mudou)
  const resolvedTemplate = await resolveApprovedRdTemplate(tenantId, siteSettings.whatsappTemplateId, {
    persistAutoHeal: false,
  });
  const templateRow = resolvedTemplate.template;
  if (!templateRow) {
    return { handedOff: false, reason: "site_whatsapp_template_not_approved" };
  }

  // 3. Carregar conversa do site + contato + telefone válido
  const [siteConv] = await database
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, siteConversationId)))
    .limit(1);

  if (!siteConv || siteConv.operatorId || siteConv.queueState === "finalizados") {
    return { handedOff: false, reason: "site_conversation_unavailable" };
  }

  const resolvedContactId = input.contactId || siteConv.contactId;
  const [contact] = resolvedContactId
    ? await database
        .select()
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, resolvedContactId)))
        .limit(1)
    : [];

  if (!contact) {
    return { handedOff: false, reason: "contact_not_found" };
  }

  const rawPhone =
    contact.phone ||
    input.data["TELEFONE"]?.value ||
    siteConv.contactPhone ||
    "";
  const canonicalPhone = normalizeCanonicalPhone(rawPhone);
  if (!canonicalPhone) {
    return { handedOff: false, reason: "missing_phone" };
  }

  // 4. Localizar ou criar conversa oficial de WhatsApp (nunca `conv-lc-*` e nunca Baileys de vendedor)
  const waPrep = await database.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${`site_wa_handoff:${contact.id}`}))`,
    );

    const matchedPhone = await resolveOrEnsureContactPhoneRow(tx, tenantId, contact.id, {
      phone: canonicalPhone,
    });

    let waConv = await findConversationForContactPhone(tx, tenantId, contact.id, matchedPhone, null);
    if (waConv && isSiteConversationId(waConv.id)) {
      waConv = null;
    }
    if (!waConv) {
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
      waConv = fallbackConv || null;
    }

    const now = new Date();
    if (waConv) {
      // Proteção: se já existe atendimento humano ativo no WhatsApp, NÃO sequestra!
      if (waConv.operatorId !== null) {
        return { conversation: waConv, hasActiveHuman: true };
      }
      if (waConv.queueState === "meus") {
        const [realMsg] = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, tenantId),
              eq(messages.conversationId, waConv.id),
              eq(messages.isInternalNote, false),
            ),
          )
          .limit(1);
        if (realMsg) {
          return { conversation: waConv, hasActiveHuman: true };
        }
      }

      await setAttendanceActor(tx, tenantId, `${persona.name} (Site → WhatsApp)`, null);
      const [updated] = await tx
        .update(conversations)
        .set({
          queueState: "automacao",
          operatorId: null,
          updatedAt: now,
        })
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, waConv.id)))
        .returning();
      return { conversation: updated || waConv, hasActiveHuman: false };
    }

    const newWaConvId = `conv-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    await setAttendanceActor(tx, tenantId, `${persona.name} (Site → WhatsApp)`, null);
    const [created] = await tx
      .insert(conversations)
      .values({
        id: newWaConvId,
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

    return { conversation: created, hasActiveHuman: false };
  });

  const waConversationId = waPrep.conversation.id;

  // 5. Disparar o template Meta oficial ANTES de criar o card no CRM (garante 0 cards se envio falhar)
  const payload = buildSiteTemplatePayload({
    template: {
      name: templateRow.name,
      language: templateRow.language,
      bodyText: templateRow.bodyText,
      bindings: templateRow.bindings,
    },
    clientName: input.clientName || contact.name,
    personaName: persona.name,
    topicSummary: resolveTemplateTopicSummary(input),
  });

  if (!waPrep.hasActiveHuman) {
    const sendResult = await outboundQueue.enqueueAndSend({
      tenantId,
      conversationId: waConversationId,
      recipientPhone: canonicalPhone,
      recipientUserId: contact.whatsappUserId || undefined,
      text: payload.renderedText,
      templateName: templateRow.name,
      templateLanguage: templateRow.language || "pt_BR",
      templateComponents: payload.templateComponents,
      senderType: "bot",
      senderName: `${persona.name} (Site → WhatsApp)`,
      idempotencyKey: `site-wa-handoff:${tenantId}:${siteConversationId}:${cycle}`,
    });

    if (!sendResult.success) {
      return {
        handedOff: false,
        reason: sendResult.error || "meta_template_send_failed",
        whatsappConversationId: waConversationId,
        templateName: templateRow.name,
      };
    }
  }

  // 6. Pós-envio confirmado: copiar histórico do site, criar card no funil correto,
  //    estacionar WhatsApp em `awaiting_approval` herdando 100% da triagem e concluir ciclo do site.
  const committed = await database.transaction(async (tx) => {
    const now = new Date();

    // 6.1 Copiar mensagens do site para a conversa de WhatsApp (idempotente) + nota interna de resumo
    const siteMsgs = await readSiteContinuationHistory(tx, tenantId, siteConversationId);
    if (siteMsgs.length > 0) {
      await tx
        .insert(messages)
        .values(
          siteMsgs.map((m) => ({
            id: `lcx-${sha256Hex(`${waConversationId}:${m.id}`).slice(0, 40)}`,
            tenantId,
            conversationId: waConversationId,
            senderType: m.senderType,
            senderName: m.senderName,
            content: m.content,
            isInternalNote: false,
            mediaInterpretation: m.mediaInterpretation,
            provider: m.provider || SITE_CHANNEL,
            direction: m.direction,
            status: m.status === "pending" || m.status === "sending" ? "accepted" : m.status,
            metaDetails: {
              ...(siteContextFromMessages([m]) ? { siteContext: siteContextFromMessages([m]) } : {}),
              copiedFrom: { channel: SITE_CHANNEL, conversationId: siteConversationId, messageId: m.id },
            },
            sentAt: m.sentAt,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing();
    }

    const summaryNoteId = `note-swa-${sha256Hex(`${tenantId}:${siteConversationId}:${cycle}`).slice(0, 32)}`;
    await tx
      .insert(messages)
      .values({
        id: summaryNoteId,
        tenantId,
        conversationId: waConversationId,
        senderType: "system",
        senderName: `${persona.name} (Site → WhatsApp)`,
        content: summarizeSiteTriageNote(input, templateRow.name),
        isInternalNote: true,
        provider: "internal",
        direction: "outbound",
        status: "delivered",
        sentAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // 6.2 Vincular jornada do site ao contato e `lc_chats.wa_conversation_id`
    const visitorId = visitorIdFromSiteConversation(siteConversationId);
    if (visitorId) {
      const existingCf = ((contact.customFields as Record<string, unknown>) || {}) as Record<string, any>;
      const prevLinked = Array.isArray(existingCf.linkedSiteContactIds)
        ? existingCf.linkedSiteContactIds
        : [];
      const nextLinked = Array.from(new Set([...prevLinked, `cont-lc-${visitorId}`])).slice(-20);
      await tx
        .update(contacts)
        .set({
          ...(contact.mainChannel === "livechat" ? { mainChannel: "whatsapp" } : {}),
          customFields: {
            ...existingCf,
            siteVisitorId: visitorId,
            linkedSiteContactIds: nextLinked,
          },
        })
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contact.id)));

      await tx
        .update(lcChats)
        .set({
          waConversationId,
          status: "bridge_sent",
          outcome: "bridge_whatsapp",
          closedAt: now,
        })
        .where(and(eq(lcChats.tenantId, tenantId), eq(lcChats.visitorId, visitorId)));
    }

    // 6.3 Calcular sugestão de destino/operador (somente leitura, sem consumir rodízio)
    const rawSuggestion = await computePendingApprovalSuggestion(tx, {
      tenantId,
      conversationId: waConversationId,
      cycle,
      route: input.route,
      data: input.data,
      clientName: input.clientName,
      companyName: input.companyName,
      machineDecision: input.machineDecision,
    });

    // 6.4 Criar/reutilizar o card no funil correspondente (CWR para comercial; funil próprio p/ Pós-Venda/Suporte/Financeiro)
    const dealResult = await ensureSiteDealOnWhatsappHandoff(tx, {
      tenantId,
      whatsappConversationId: waConversationId,
      siteConversationId,
      contactId: contact.id,
      destinationKey: rawSuggestion.destinationKey,
      targetPipelineId: rawSuggestion.suggestedPipelineId,
      targetStageId: rawSuggestion.suggestedStageId,
      clientName: input.clientName,
      companyName: input.companyName,
      actorName: persona.name,
    });

    const suggestion: PendingApprovalSuggestion = {
      ...rawSuggestion,
      dealId: dealResult.dealId || rawSuggestion.dealId || null,
    };

    // 6.5 Criar/atualizar ciclo SDR na conversa do WhatsApp já em `awaiting_approval` (herdando 100% da triagem!)
    if (!waPrep.hasActiveHuman) {
      const waFlowId = `fs-sdr-${tenantId}-${waConversationId}`;
      const [existingWaFlow] = await tx
        .select()
        .from(agentFlowStates)
        .where(
          and(
            eq(agentFlowStates.tenantId, tenantId),
            eq(agentFlowStates.conversationId, waConversationId),
            eq(agentFlowStates.agentType, "sdr"),
          ),
        )
        .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
        .limit(1);

      const waFlowMetadata: Record<string, unknown> = {
        ...((existingWaFlow?.metadata as Record<string, unknown>) || {}),
        triagePolicyVersion: INDUSTRIAL_POLICY_VERSION,
        greetingDone: true,
        subflow: input.route.subflow,
        funnelStage: input.route.funnelStage,
        targetFunnel: suggestion.targetFunnel,
        needsReview: suggestion.needsReview,
        routeReason: input.route.reason,
        missingFields: [],
        readyForHandoff: true,
        handoffStatus: "awaiting_approval",
        pendingApproval: suggestion,
        originatedFromSiteConversationId: siteConversationId,
        siteWhatsappTemplateSent: true,
        siteWhatsappTemplateName: templateRow.name,
        ...(input.siteContext ? { siteContext: input.siteContext } : {}),
        ...(input.machineDecision ? { machineDecision: input.machineDecision } : {}),
        ...(suggestion.dealId ? { localCrmDealId: suggestion.dealId } : {}),
        ...(dealResult.dealTitle ? { localCrmDealTitle: dealResult.dealTitle } : {}),
        ...(suggestion.suggestedOperatorId ? { suggestedOperatorId: suggestion.suggestedOperatorId } : {}),
        ...(suggestion.suggestedOperatorName ? { suggestedOperatorName: suggestion.suggestedOperatorName } : {}),
      };

      if (existingWaFlow && existingWaFlow.outcome === "in_progress") {
        await tx
          .update(agentFlowStates)
          .set({
            collectedData: input.data,
            currentStep: "Aguardando Aprovação SDR",
            outcome: "in_progress",
            completedAt: null,
            lastInteractionAt: now,
            metadata: waFlowMetadata,
          })
          .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, existingWaFlow.id)));
      } else {
        if (existingWaFlow) {
          await tx
            .delete(agentFlowStates)
            .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, existingWaFlow.id)));
        }
        await tx.insert(agentFlowStates).values({
          id: waFlowId,
          tenantId,
          conversationId: waConversationId,
          agentType: "sdr",
          currentStep: "Aguardando Aprovação SDR",
          collectedData: input.data,
          metadata: waFlowMetadata,
          startedAt: now,
          lastInteractionAt: now,
          completedAt: null,
          outcome: "in_progress",
        });
      }
    }

    // 6.6 Concluir ciclo no Kanban do Site (`conv-lc-*`) sem duplicar aprovação pendente
    const [siteFlow] = await tx
      .select()
      .from(agentFlowStates)
      .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, siteFlowId)))
      .for("update")
      .limit(1);

    if (siteFlow) {
      const nextSiteMeta: Record<string, unknown> = {
        ...((siteFlow.metadata as Record<string, unknown>) || {}),
        triagePolicyVersion: INDUSTRIAL_POLICY_VERSION,
        subflow: input.route.subflow,
        funnelStage: input.route.funnelStage,
        targetFunnel: suggestion.targetFunnel,
        routeReason: input.route.reason,
        missingFields: [],
        readyForHandoff: true,
        handoffStatus: "continued_to_whatsapp",
        whatsappConversationId: waConversationId,
        siteWhatsappTemplateSent: true,
        siteWhatsappTemplateName: templateRow.name,
        ...(suggestion.dealId ? { localCrmDealId: suggestion.dealId } : {}),
        ...(dealResult.dealTitle ? { localCrmDealTitle: dealResult.dealTitle } : {}),
        ...(input.machineDecision ? { machineDecision: input.machineDecision } : {}),
      };

      const [updatedSiteFlow] = await tx
        .update(agentFlowStates)
        .set({
          collectedData: input.data,
          currentStep: "Enviado p/ WhatsApp",
          outcome: "transferred",
          completedAt: now,
          lastInteractionAt: now,
          metadata: nextSiteMeta,
        })
        .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, siteFlow.id)))
        .returning();

      if (updatedSiteFlow) {
        await appendIndustrialJournal(tx, siteFlow, updatedSiteFlow, "handoff", `site-wa:${cycle}`);
      }
    }

    // Marca a conversa do site como finalizada após concluir o encaminhamento para o WhatsApp
    await tx
      .update(conversations)
      .set({
        queueState: "finalizados",
        updatedAt: now,
        version: sql`${conversations.version} + 1`,
      })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, siteConversationId)));

    return { suggestion, dealResult };
  });

  // 7. Notificar setor SDR apontando para a conversa do WhatsApp (onde já aguarda aprovação)
  if (!waPrep.hasActiveHuman) {
    void notifySdrTeamApprovalPending(database, {
      tenantId,
      conversationId: waConversationId,
      suggestion: committed.suggestion,
    }).catch((err: any) =>
      console.warn("[Site→WhatsApp] Aviso ao notificar SDR sobre aprovação pendente:", err?.message),
    );
  }

  return {
    handedOff: true,
    whatsappConversationId: waConversationId,
    dealId: committed.dealResult.dealId || null,
    dealTitle: committed.dealResult.dealTitle || null,
    pipelineId: committed.dealResult.pipelineId || null,
    stageId: committed.dealResult.stageId || null,
    templateName: templateRow.name,
    closingMessageForSite: buildSiteToWhatsappClosingMessage(input.clientName || contact.name),
    suggestion: committed.suggestion,
    preservedHumanOperator: waPrep.hasActiveHuman,
  };
}
