import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  agentConfigs,
  agentFlowStates,
  conversations,
  contacts,
  messages,
  operators,
  crmConversationDeals,
  crmDeals,
  crmDealContacts,
} from "../../../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import { projectIndustrialMonitoring } from "../../../lib/triage/industrial-monitor";
import { readAgentMonitoringSummary, readLatestSdrFlows } from "../../../lib/triage/agent-monitor-store";
import { stopIndustrialCycle } from "../../../lib/triage/industrial-cycle-stop";
import {
  computeIndustrialTriageProgress,
  resolveEffectiveIndustrialSubflow,
} from "../../../lib/triage/industrial-policy";
import {
  applyKnownClientConfirmationToData,
  isValidKnownCompanyName,
} from "../../../lib/triage/known-client-lookup";
import { lookupKnownClientByPhoneOrContact } from "../../../lib/triage/known-client-db";
import { syncContactDataFromTriage } from "../../../lib/valentina/sdr-engine";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function safeFormatTime(dateVal: any): string {
  if (!dateVal) return "Agora";
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return "Agora";
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return "Agora";
  }
}

function safeFormatDate(dateVal: any): string {
  if (!dateVal) {
    return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) {
      return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    }
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }
}

function safeFormatIso(dateVal: any): string {
  if (!dateVal) return new Date().toISOString();
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function parseMediaInfo(content: string, mediaUrl?: string | null, mediaType?: string | null, fileName?: string | null) {
  let url = mediaUrl || undefined;
  let type = mediaType || undefined;
  let name = fileName || undefined;

  if (content) {
    const firstLine = content.split(/\r?\n/)[0].trim();
    if (firstLine.startsWith("[MEDIA:")) {
      const match = firstLine.match(/^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::(.+))?$/i);
      if (match) {
        type = match[1].toLowerCase() === "sticker" ? "image" : match[1].toLowerCase();
        const mediaId = match[2].trim();
        name = match[3] ? match[3].trim() : name;
        url = `/api/baileys/media?messageId=${mediaId}`;
      }
    }
  }

  if (url && url.includes("/api/media/")) {
    const mediaId = url.split("/api/media/")[1]?.trim();
    if (mediaId) {
      url = `/api/baileys/media?messageId=${mediaId}`;
    }
  }

  return { mediaUrl: url, mediaType: type, fileName: name };
}

export const Route = createFileRoute('/api/valentina/sdr')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Configurações do SDR + Lista de Triagens Reais do Banco ─────────
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const persona = getAiPersona(tenantId);

        let config = {
          enabled: false,
        };

        const sessions: any[] = [];
        const addedConvIds = new Set<string>();
        const sessionsByConvId = new Map<string, any>();

        // Mapa de operadores do tenant para identificar nome e foto nas mensagens de operador
        const operatorsById = new Map<string, { id: string; name: string; avatar: string | null }>();
        const operatorsByName = new Map<string, { id: string; name: string; avatar: string | null }>();
        try {
          const tenantOps = await db
            .select({
              id: operators.id,
              name: operators.name,
              avatar: operators.avatar,
            })
            .from(operators)
            .where(eq(operators.tenantId, tenantId));

          for (const op of tenantOps) {
            operatorsById.set(op.id, op);
            if (op.name) {
              operatorsByName.set(op.name.trim().toLowerCase(), op);
            }
          }
        } catch (err) {
          console.warn("[api/valentina/sdr] Erro ao carregar operadores do tenant:", err);
        }

        const currentSessionOp = session.operator?.id
          ? operatorsById.get(session.operator.id) || {
              id: session.operator.id,
              name: session.operator.name,
              avatar: (session.operator as any).avatar || null,
            }
          : null;

        const resolveLinkedDeal = async (
          conversationId: string,
          contactId?: string | null,
          meta?: Record<string, any>,
        ) => {
          if (persona.triagePolicy !== "industrial" && meta?.localCrmDealId) {
            return {
              dealId: String(meta.localCrmDealId),
              dealTitle: String(meta.localCrmDealTitle || "Negociação CRM Local"),
              action: String(meta.localCrmDealAction || "created_new"),
              operatorId: meta.allocatedOperatorId ? String(meta.allocatedOperatorId) : null,
            };
          }

          const [convDealRow] = await db
            .select({
              dealId: crmDeals.id,
              dealTitle: crmDeals.title,
              createdAt: crmDeals.createdAt,
              operatorId: crmDeals.operatorId,
            })
            .from(crmConversationDeals)
            .innerJoin(
              crmDeals,
              and(
                eq(crmConversationDeals.dealId, crmDeals.id),
                eq(crmDeals.tenantId, tenantId),
              ),
            )
            .where(
              and(
                eq(crmConversationDeals.tenantId, tenantId),
                eq(crmConversationDeals.conversationId, conversationId),
                eq(crmConversationDeals.isActive, true),
              ),
            )
            .orderBy(desc(crmDeals.createdAt))
            .limit(1);

          if (convDealRow) {
            return {
              dealId: convDealRow.dealId,
              dealTitle: convDealRow.dealTitle,
              createdAt: safeFormatIso(convDealRow.createdAt),
              operatorId: convDealRow.operatorId || null,
            };
          }

          if (contactId && persona.triagePolicy !== "industrial") {
            const [contactDealRow] = await db
              .select({
                dealId: crmDeals.id,
                dealTitle: crmDeals.title,
                createdAt: crmDeals.createdAt,
                operatorId: crmDeals.operatorId,
              })
              .from(crmDeals)
              .innerJoin(crmDealContacts, and(eq(crmDealContacts.dealId, crmDeals.id), eq(crmDealContacts.tenantId, tenantId)))
              .where(
                and(
                  eq(crmDeals.tenantId, tenantId),
                  eq(crmDealContacts.contactId, contactId),
                ),
              )
              .orderBy(desc(crmDeals.createdAt))
              .limit(1);

            if (contactDealRow) {
              return {
                dealId: contactDealRow.dealId,
                dealTitle: contactDealRow.dealTitle,
                createdAt: safeFormatIso(contactDealRow.createdAt),
                operatorId: contactDealRow.operatorId || null,
              };
            }
          }

          return null;
        };

        const resolveConversationOperator = (
          convOperatorId?: string | null,
          meta?: Record<string, any>,
          walletOperatorId?: string | null,
          dealOperatorId?: string | null,
          rawMsgs?: any[],
        ) => {
          if (persona.triagePolicy === "industrial") {
            return convOperatorId ? operatorsById.get(convOperatorId) || null : null;
          }
          const candidateIds = [
            convOperatorId,
            meta?.allocatedOperatorId,
            dealOperatorId,
            walletOperatorId,
          ].filter(Boolean) as string[];

          for (const cid of candidateIds) {
            const found = operatorsById.get(String(cid));
            if (found) return found;
          }

          if (meta?.allocatedOperatorName) {
            const byAllocName = operatorsByName.get(String(meta.allocatedOperatorName).trim().toLowerCase());
            if (byAllocName) return byAllocName;
          }

          if (Array.isArray(rawMsgs)) {
            for (let i = rawMsgs.length - 1; i >= 0; i--) {
              const m = rawMsgs[i];
              if (m?.senderType !== "agent") continue;
              const mOpId = (m.metaDetails as any)?.operatorId;
              if (mOpId && operatorsById.has(String(mOpId))) {
                return operatorsById.get(String(mOpId))!;
              }
              if (m?.senderName && m.senderName !== "Operador") {
                const byMsgName = operatorsByName.get(String(m.senderName).trim().toLowerCase());
                if (byMsgName) return byMsgName;
              }
            }
          }

          return currentSessionOp;
        };

        const formatConversationMessages = (
          rawMsgs: any[],
          defaultOperator: { id: string; name: string; avatar: string | null } | null,
          contactName: string,
        ) => {
          return rawMsgs.map((m: any) => {
            const mediaInfo = parseMediaInfo(m.content, m.mediaUrl, m.mediaType, m.fileName);
            const rawText = (m.content || "").trim();
            const isSystemResetMsg =
              m.senderType === "system" ||
              rawText.toLowerCase() === "!reset" ||
              rawText.includes("Fluxo de triagem reiniciado") ||
              rawText.includes("Triagem anterior encerrada");

            let sender: "client" | "bot" | "agent" | "system" = "bot";
            if (isSystemResetMsg) {
              sender = "system";
            } else if (m.senderType === "client") {
              sender = "client";
            } else if (m.senderType === "agent") {
              sender = "agent";
            } else {
              sender = "bot";
            }

            let senderName = persona.name;
            let senderAvatar: string | null = null;

            if (sender === "client") {
              senderName = contactName;
            } else if (sender === "system") {
              senderName = "Sistema";
            } else if (sender === "agent") {
              const metaOpId = (m.metaDetails as any)?.operatorId;
              const byId = metaOpId ? operatorsById.get(String(metaOpId)) : undefined;
              const byName =
                m.senderName && m.senderName !== "Operador"
                  ? operatorsByName.get(String(m.senderName).trim().toLowerCase())
                  : undefined;
              const resolvedOp = byId || byName || defaultOperator || currentSessionOp;

              const cleanMsgSenderName =
                m.senderName && String(m.senderName).trim().toLowerCase() !== "operador"
                  ? String(m.senderName).trim()
                  : null;

              senderName = resolvedOp?.name || cleanMsgSenderName || "Operador";
              senderAvatar = resolvedOp?.avatar || null;
            }

            return {
              id: m.id,
              sender,
              senderName,
              senderAvatar,
              text: m.content,
              time: safeFormatTime(m.sentAt),
              date: safeFormatDate(m.sentAt),
              sentAt: safeFormatIso(m.sentAt),
              isInternalNote: Boolean(m.isInternalNote),
              mediaUrl: mediaInfo.mediaUrl,
              mediaType: mediaInfo.mediaType,
              fileName: mediaInfo.fileName,
            };
          });
        };

        // 1. Tentar buscar Config do SDR no banco de forma segura
        try {
          const dbConfig = await db.query.agentConfigs.findFirst({
            where: (table, { eq: dEq, and: dAnd }) =>
              dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
          });

          if (dbConfig) {
            config = {
              enabled: dbConfig.enabled === 1,
            };
          }
        } catch (err) {
          console.warn("[api/valentina/sdr] Erro ao buscar agentConfigs:", err);
        }

        // 2. Buscar sessões registradas em agentFlowStates do tenant
        try {
          const flowStates = persona.triagePolicy === "industrial"
            ? await readLatestSdrFlows(db, tenantId)
            : await db.select()
            .from(agentFlowStates)
            .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.agentType, "sdr")))
            .orderBy(desc(agentFlowStates.lastInteractionAt))
            .limit(50);

          for (const fs of flowStates) {
            try {
              // Evitar duplicar cards/chats para o mesmo cliente: compilar ciclos anteriores na mesma sessão
              if (addedConvIds.has(fs.conversationId)) {
                const existingSession = sessionsByConvId.get(fs.conversationId);
                if (existingSession) {
                  const fsMeta = (fs.metadata as Record<string, any>) || {};
                  const fsData = (fs.collectedData as Record<string, any>) || {};
                  const alreadyAdded = existingSession.previousTriages.some((p: any) => p.id === fs.id);
                  if (!alreadyAdded) {
                    existingSession.previousTriages.push({
                      id: fs.id,
                      startedAt: safeFormatIso(fs.startedAt),
                      completedAt: fs.completedAt ? safeFormatIso(fs.completedAt) : safeFormatIso(fs.lastInteractionAt),
                      outcome: fs.outcome || "completed",
                      targetFunnel: fsMeta.targetFunnel || undefined,
                      subflow: fsMeta.subflow || undefined,
                      company: fsData["EMPRESA"]?.value || undefined,
                      document: fsData["CNPJ OU CPF"]?.value || fsData["CNPJ"]?.value || undefined,
                      clientName: fsData["NOME COMPLETO"]?.value || undefined,
                      interest: fsData["MÁQUINA / PEÇA / INTERESSE"]?.value || undefined,
                      responsibleName: fsMeta.allocatedOperatorName || undefined,
                    });
                  }
                }
                continue;
              }

              addedConvIds.add(fs.conversationId);

              const conv = await db.query.conversations.findFirst({
                where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, fs.conversationId), dEq(t.tenantId, tenantId)),
              });

              const contact = conv
                ? await db.query.contacts.findFirst({
                    where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, conv.contactId), dEq(t.tenantId, tenantId)),
                  })
                : null;

              const recentMsgsDesc = await db
                .select()
                .from(messages)
                .where(and(eq(messages.conversationId, fs.conversationId), eq(messages.tenantId, tenantId), persona.triagePolicy === "industrial" ? sql`${messages.metaDetails}->'industrialTriage' IS NULL` : undefined))
                .orderBy(desc(messages.sentAt))
                .limit(200);
              const realMsgs = recentMsgsDesc.reverse();

              const meta = (fs.metadata as Record<string, any>) || {};
              const linkedDealRow = await resolveLinkedDeal(fs.conversationId, conv?.contactId, meta);
              const linkedDeal = linkedDealRow
                ? {
                    dealId: linkedDealRow.dealId,
                    dealTitle: linkedDealRow.dealTitle,
                    ...(linkedDealRow.action ? { action: linkedDealRow.action } : {}),
                    ...(linkedDealRow.createdAt ? { createdAt: linkedDealRow.createdAt } : {}),
                  }
                : null;

              const operator = resolveConversationOperator(
                conv?.operatorId,
                meta,
                contact?.walletOperatorId,
                linkedDealRow?.operatorId,
                realMsgs,
              );

              const collectedData = (fs.collectedData as any) || {};
              const resolvedContactName =
                contact?.name || collectedData["NOME COMPLETO"]?.value || "Contato WhatsApp";

              const formattedMessages = formatConversationMessages(realMsgs, operator, resolvedContactName);

              let status: "active" | "completed" | "abandoned" = "active";
              if (fs.outcome === "completed" || fs.outcome === "transferred") status = "completed";
              if (fs.outcome === "abandoned" || fs.outcome === "stopped") status = "abandoned";

              const monitoring = persona.triagePolicy === "industrial" ? projectIndustrialMonitoring(fs, conv || null) : undefined;
              if (monitoring) {
                status = ["transferred", "resolved", "closed", "continued", "manual", "manual_queue"].includes(monitoring.state)
                  ? "completed" : ["stopped", "no_response"].includes(monitoring.state) ? "abandoned" : "active";
              }

              let responsibleName = "IA (Em Triagem)";
              if (status === "completed") {
                responsibleName = operator?.name || meta.allocatedOperatorName || "Vendedor Alocado (Rodízio)";
              } else if (fs.outcome === "stopped") {
                responsibleName = operator?.name || "Interrompido (Atendimento Manual)";
              }
              if (monitoring) responsibleName = operator?.name || (monitoring.state === "collecting" || monitoring.state === "ready" ? `${persona.name} IA` : "Sem responsável atribuído");

              const previousTriages = Array.isArray(meta.previousTriages) ? [...meta.previousTriages] : [];
              const knownClient =
                persona.triagePolicy === "industrial"
                  ? meta.knownClient ||
                    (await lookupKnownClientByPhoneOrContact(tenantId, {
                      contactId: conv?.contactId || null,
                      phone: contact?.phone || null,
                      conversationId: fs.conversationId,
                      previousTriages,
                    }))
                  : null;

              const companyVal =
                collectedData["EMPRESA"]?.value ||
                collectedData["empresa"]?.value ||
                (typeof collectedData["EMPRESA"] === "string" ? collectedData["EMPRESA"] : "") ||
                (contact?.cnpjDetails as any)?.razaoSocial ||
                (contact?.customFields as any)?.company ||
                knownClient?.companyName ||
                "Empresa não informada";

              const resolvedSubflow =
                persona.triagePolicy === "industrial"
                  ? resolveEffectiveIndustrialSubflow({
                      subflow: meta.subflow || null,
                      funnelStage: meta.funnelStage || meta.targetArea || null,
                      targetFunnel:
                        meta.targetFunnel ||
                        collectedData["SETOR / FUNIL DE DESTINO"]?.value ||
                        null,
                      collectedData,
                      company: companyVal !== "Empresa não informada" ? companyVal : null,
                      document:
                        collectedData["CNPJ OU CPF"]?.value ||
                        contact?.cnpj ||
                        contact?.cpf ||
                        knownClient?.document ||
                        null,
                      isCompleted: status === "completed",
                    })
                  : undefined;

              const industrialProgress =
                persona.triagePolicy === "industrial"
                  ? computeIndustrialTriageProgress({
                      subflow: resolvedSubflow || null,
                      funnelStage: meta.funnelStage || meta.targetArea || null,
                      targetFunnel:
                        meta.targetFunnel ||
                        collectedData["SETOR / FUNIL DE DESTINO"]?.value ||
                        null,
                      collectedData,
                      company: companyVal !== "Empresa não informada" ? companyVal : null,
                      document:
                        collectedData["CNPJ OU CPF"]?.value ||
                        contact?.cnpj ||
                        contact?.cpf ||
                        knownClient?.document ||
                        null,
                      isCompleted: status === "completed",
                    })
                  : null;

              const effectiveCollectedData = industrialProgress
                ? industrialProgress.adaptiveData
                : collectedData;

              const lastClientMsg = [...formattedMessages].reverse().find((m) => m.sender === "client");
              const lastAnyMsg = formattedMessages[formattedMessages.length - 1];
              const lastMessageAtIso =
                lastAnyMsg?.sentAt ||
                (conv?.lastMessageTime ? safeFormatIso(conv.lastMessageTime) : safeFormatIso(fs.lastInteractionAt || fs.startedAt));
              const lastClientMessageAtIso = lastClientMsg?.sentAt || lastMessageAtIso;

              const sessionObj = {
                id: fs.id,
                conversationId: fs.conversationId,
                contactName: resolvedContactName,
                contactAvatar: contact?.avatar || null,
                company: companyVal,
                phone: contact?.phone || "",
                currentStep: fs.currentStep,
                collectedData: effectiveCollectedData,
                startedAt: safeFormatIso(fs.startedAt),
                completedAt: fs.completedAt ? safeFormatIso(fs.completedAt) : null,
                lastClientMessageAt: lastClientMessageAtIso,
                lastMessageAt: lastMessageAtIso,
                status,
                outcome: fs.outcome || undefined,
                responsibleName,
                unreadCount: conv?.unreadCount || 0,
                channel: contact?.mainChannel || "whatsapp",
                subflow: resolvedSubflow || meta.subflow || undefined,
                funnelStage: meta.funnelStage || meta.targetArea || undefined,
                targetFunnel: meta.targetFunnel || effectiveCollectedData["SETOR / FUNIL DE DESTINO"]?.value || undefined,
                ...(industrialProgress
                  ? {
                      triageProgress: {
                        filledCount: industrialProgress.filledCount,
                        totalCount: industrialProgress.totalCount,
                        percentage: industrialProgress.percentage,
                        targetFields: industrialProgress.targetFields,
                      },
                    }
                  : {}),
                ...(knownClient ? { knownClient } : {}),
                linkedDeal,
                ...(monitoring ? { monitoring } : {}),
                previousTriages,
                messages: formattedMessages,
              };

              sessions.push(sessionObj);
              sessionsByConvId.set(fs.conversationId, sessionObj);
            } catch (innerErr) {
              console.warn("[api/valentina/sdr] Erro ao processar flowState individual:", innerErr);
            }
          }
        } catch (err) {
          console.warn("[api/valentina/sdr] Erro ao buscar agentFlowStates:", err);
        }

        // 3. Buscar conversas que estão em queueState === "automacao" mas ainda não geraram agentFlowStates
        try {
          const allConvs = await db
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                eq(conversations.queueState, "automacao"),
              ),
            )
            .orderBy(desc(conversations.lastMessageTime))
            .limit(30);

          for (const c of allConvs) {
            if (c.id === "tec-1" || c.id === "tec-2" || c.id === "val-1" || c.id === "val-2") continue;

            if (!addedConvIds.has(c.id)) {
              try {
                addedConvIds.add(c.id);

                const contact = await db.query.contacts.findFirst({
                  where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, c.contactId), dEq(t.tenantId, tenantId)),
                });

                const recentMsgsDesc = await db
                  .select()
                  .from(messages)
                  .where(and(eq(messages.conversationId, c.id), eq(messages.tenantId, tenantId), persona.triagePolicy === "industrial" ? sql`${messages.metaDetails}->'industrialTriage' IS NULL` : undefined))
                  .orderBy(desc(messages.sentAt))
                  .limit(200);
                const realMsgs = recentMsgsDesc.reverse();

                const linkedDealRow = await resolveLinkedDeal(c.id, c.contactId);
                const linkedDeal = linkedDealRow
                  ? {
                      dealId: linkedDealRow.dealId,
                      dealTitle: linkedDealRow.dealTitle,
                      ...(linkedDealRow.createdAt ? { createdAt: linkedDealRow.createdAt } : {}),
                    }
                  : null;

                const operator = resolveConversationOperator(
                  c.operatorId,
                  undefined,
                  contact?.walletOperatorId,
                  linkedDealRow?.operatorId,
                  realMsgs,
                );

                const resolvedContactName = contact?.name || "Contato WhatsApp";
                const formattedMessages = formatConversationMessages(realMsgs, operator, resolvedContactName);

                const isFinished = c.queueState === "finalizados";
                const lastClientMsg = [...formattedMessages].reverse().find((m) => m.sender === "client");
                const lastAnyMsg = formattedMessages[formattedMessages.length - 1];
                const lastMessageAtIso =
                  lastAnyMsg?.sentAt || safeFormatIso(c.lastMessageTime || c.createdAt);
                const lastClientMessageAtIso = lastClientMsg?.sentAt || lastMessageAtIso;

                const knownClient =
                  persona.triagePolicy === "industrial"
                    ? await lookupKnownClientByPhoneOrContact(tenantId, {
                        contactId: c.contactId,
                        phone: contact?.phone || null,
                        conversationId: c.id,
                      })
                    : null;

                const sessionObj = {
                  id: `fs-auto-${c.id}`,
                  conversationId: c.id,
                  contactName: resolvedContactName,
                  contactAvatar: contact?.avatar || null,
                  company:
                    (contact?.cnpjDetails as any)?.razaoSocial ||
                    (contact?.customFields as any)?.company ||
                    knownClient?.companyName ||
                    "Empresa não informada",
                  phone: contact?.phone || "",
                  currentStep: isFinished ? "Concluído" : "Em Qualificação",
                  collectedData: {},
                  startedAt: safeFormatIso(c.createdAt),
                  completedAt: null,
                  lastClientMessageAt: lastClientMessageAtIso,
                  lastMessageAt: lastMessageAtIso,
                  status: isFinished ? "completed" : "active",
                  outcome: isFinished ? "completed" : "in_progress",
                  responsibleName: operator?.name || "IA (Em Triagem)",
                  unreadCount: c.unreadCount || 0,
                  channel: contact?.mainChannel || "whatsapp",
                  funnelStage: "triagem",
                  ...(knownClient ? { knownClient } : {}),
                  linkedDeal,
                  ...(persona.triagePolicy === "industrial" ? { monitoring: projectIndustrialMonitoring({ startedAt: c.createdAt, outcome: "in_progress", metadata: {} }, c) } : {}),
                  previousTriages: [],
                  messages: formattedMessages,
                };

                sessions.push(sessionObj);
                sessionsByConvId.set(c.id, sessionObj);
              } catch (innerErr) {
                console.warn("[api/valentina/sdr] Erro ao processar conversa individual:", innerErr);
              }
            }
          }
        } catch (err) {
          console.warn("[api/valentina/sdr] Erro ao buscar conversations:", err);
        }

        // Ordenar todas as sessões SDR da mais recente para a mais antiga com base na última mensagem do cliente
        sessions.sort((a, b) => {
          const tsA = Date.parse(a.lastClientMessageAt || a.lastMessageAt || a.startedAt || "") || 0;
          const tsB = Date.parse(b.lastClientMessageAt || b.lastMessageAt || b.startedAt || "") || 0;
          return tsB - tsA;
        });

        let monitoringSummary;
        try {
          monitoringSummary = await readAgentMonitoringSummary(db, tenantId);
        } catch (error) {
          console.error("[api/valentina/sdr] Métricas indisponíveis:", error);
          monitoringSummary = { available: false, reason: "Métricas temporariamente indisponíveis." };
        }
        return new Response(JSON.stringify({ config, sessions, monitoringSummary }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },

      // ── POST: Salvar configurações do SDR, Vincular Cliente Recorrente ou Interromper IA ──
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        try {
          const body = await request.json();
          const { action, conversationId, enabled, testMode, whitelistPhone } = body;

          // Ação de vincular/confirmar dados de cliente recorrente na triagem atual
          if (action === "link_known_client" && conversationId) {
            const [conv] = await db
              .select()
              .from(conversations)
              .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
              .limit(1);

            if (!conv) {
              return new Response(
                JSON.stringify({ error: "Conversa não encontrada ou não pertence a este tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            const contact = await db.query.contacts.findFirst({
              where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, conv.contactId), dEq(t.tenantId, tenantId)),
            });

            const flowState = await db.query.agentFlowStates.findFirst({
              where: (t, { eq: dEq, and: dAnd }) =>
                dAnd(dEq(t.tenantId, tenantId), dEq(t.conversationId, conversationId), dEq(t.agentType, "sdr")),
            });

            const meta = (flowState?.metadata as Record<string, any>) || {};
            const knownClient =
              (body.companyName && isValidKnownCompanyName(body.companyName)
                ? {
                    companyName: String(body.companyName).trim(),
                    document: body.document ? String(body.document).trim() : null,
                    contactName: body.contactName ? String(body.contactName).trim() : contact?.name || null,
                    accountId: body.accountId || contact?.accountId || null,
                    contactId: conv.contactId,
                    source: "contact_company" as const,
                  }
                : null) ||
              (await lookupKnownClientByPhoneOrContact(tenantId, {
                contactId: conv.contactId,
                phone: contact?.phone || null,
                conversationId,
                previousTriages: Array.isArray(meta.previousTriages) ? meta.previousTriages : null,
              }));

            if (!knownClient) {
              return new Response(
                JSON.stringify({
                  error: "Nenhum cadastro ou triagem anterior com empresa foi encontrado para este telefone.",
                  code: "NOT_FOUND",
                }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            const existingData = (flowState?.collectedData as Record<string, any>) || {};
            const enrichedData = applyKnownClientConfirmationToData(existingData, knownClient);

            const progress = computeIndustrialTriageProgress({
              subflow: meta.subflow || null,
              funnelStage: meta.funnelStage || null,
              targetFunnel: meta.targetFunnel || null,
              collectedData: enrichedData,
              company: knownClient.companyName,
              document: knownClient.document || null,
              isCompleted: flowState?.outcome === "completed" || flowState?.outcome === "transferred",
            });

            if (flowState) {
              const updatedMeta = {
                ...meta,
                stepNumber: progress.filledCount,
                totalSteps: progress.totalCount,
                knownClient: {
                  ...knownClient,
                  confirmed: true,
                },
              };
              await db
                .update(agentFlowStates)
                .set({
                  collectedData: enrichedData,
                  metadata: updatedMeta,
                  lastInteractionAt: new Date(),
                })
                .where(and(eq(agentFlowStates.id, flowState.id), eq(agentFlowStates.tenantId, tenantId)));
            }

            if (conv.contactId) {
              await syncContactDataFromTriage(
                tenantId,
                conv.contactId,
                enrichedData,
                undefined,
                knownClient.accountId || null,
              );
            }

            return new Response(
              JSON.stringify({
                success: true,
                knownClient: { ...knownClient, confirmed: true },
                collectedData: progress.adaptiveData,
                triageProgress: {
                  filledCount: progress.filledCount,
                  totalCount: progress.totalCount,
                  percentage: progress.percentage,
                  targetFields: progress.targetFields,
                },
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // Ação de Parar a IA instantaneamente para uma conversa específica do tenant
          if (action === "stop" && conversationId) {
            const [conv] = await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
              .limit(1);

            if (!conv) {
              return new Response(
                JSON.stringify({ error: "Conversa não encontrada ou não pertence a este tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            try {
              const { SdrDebouncer } = await import("../../../lib/valentina/sdr-debouncer");
              SdrDebouncer.getInstance().clearSession(conversationId);
            } catch (err) {
              console.warn("[api/valentina/sdr] Erro ao limpar debouncer no stop:", err);
            }

            if (getAiPersona(tenantId).triagePolicy === "industrial") {
              await stopIndustrialCycle(db, tenantId, conversationId, session.operator.id);
            } else {
            await db
              .update(agentFlowStates)
              .set({
                outcome: "stopped",
                currentStep: "Interrompido Manualmente",
                lastInteractionAt: new Date(),
              })
              .where(and(eq(agentFlowStates.conversationId, conversationId), eq(agentFlowStates.tenantId, tenantId)));

            await db
              .update(conversations)
              .set({
                queueState: "fila",
              })
              .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
            }

            return new Response(JSON.stringify({ success: true, message: "IA de triagem interrompida para esta conversa." }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Apenas administradores podem salvar/alterar configurações globais de SDR
          if (session.operator.role !== "admin") {
            return new Response(
              JSON.stringify({ error: "Permissão insuficiente. Apenas administradores podem alterar configurações do SDR.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const existingConfig = await db.query.agentConfigs.findFirst({
            where: (table, { eq: dEq, and: dAnd }) =>
              dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
          });

          const currentJson = (existingConfig?.config as Record<string, any>) || {};
          const updatedJson = {
            ...currentJson,
          };
          if (testMode !== undefined) updatedJson.testMode = Boolean(testMode);
          if (whitelistPhone !== undefined) updatedJson.whitelistPhone = String(whitelistPhone).trim();

          if (existingConfig) {
            await db
              .update(agentConfigs)
              .set({
                enabled: enabled !== undefined ? (enabled ? 1 : 0) : existingConfig.enabled,
                config: updatedJson,
                updatedAt: new Date(),
              })
              .where(and(eq(agentConfigs.id, existingConfig.id), eq(agentConfigs.tenantId, tenantId)));
          } else {
            await db.insert(agentConfigs).values({
              id: `cfg-sdr-${tenantId}-${Date.now()}`,
              tenantId,
              agentType: "sdr",
              enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1,
              config: updatedJson,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          return new Response(JSON.stringify({ success: true, enabled: enabled !== undefined ? Boolean(enabled) : true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        } catch (e: any) {
          console.error("[api/valentina/sdr] Erro ao processar POST no SDR:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
