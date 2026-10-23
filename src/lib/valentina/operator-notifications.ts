import crypto from "crypto";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  agentFlowStates,
  contacts,
  conversations,
  crmConversationDeals,
  crmDeals,
  internalMessages,
  messages,
  operators,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";
import {
  ensureLeadTransferTaskOnDeal,
  ensureLocalCrmDealBeforeTransfer,
  LEAD_TRANSFER_TASK_TITLE,
} from "./sdr-crm-local";

export interface LeadTransferNotificationParams {
  tenantId: string;
  operatorId: string;
  operatorName?: string | null;
  conversationId: string;
  clientName?: string | null;
  company?: string | null;
  interest?: string | null;
  targetFunnel?: string | null;
  dealId?: string | null;
  dealTitle?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  temperature?: "quente" | "morno" | "frio";
  transferSource?: "sdr_auto" | "manual_transfer" | "rodizio_reassignment";
  transferredBy?: string | null;
  cycle?: string | null;
  triageBriefing?: string;
  collectedData?: Record<string, { value?: string; status?: string }> | null;
}

function normalizeCollectedMap(
  raw: Record<string, any> | null | undefined,
): Record<string, { value: string; status: "filled" | "pending" }> {
  const result: Record<string, { value: string; status: "filled" | "pending" }> = {};
  if (!raw || typeof raw !== "object") return result;
  for (const [key, val] of Object.entries(raw)) {
    if (key.startsWith("_")) {
      (result as any)[key] = val;
      continue;
    }
    if (val && typeof val === "object" && "value" in val) {
      const strVal = String(val.value ?? "").trim();
      const isFilled =
        val.status === "filled" || (Boolean(strVal) && strVal !== "Aguardando...");
      result[key] = {
        value: strVal,
        status: isFilled ? "filled" : "pending",
      };
    } else if (typeof val === "string" && val.trim()) {
      result[key] = {
        value: val.trim(),
        status: "filled",
      };
    }
  }
  return result;
}

function summarizeConversationMessages(
  rows: Array<{
    senderType: string;
    senderName: string | null;
    content: string | null;
    mediaType: string | null;
    mediaInterpretation: string | null;
  }>,
  personaName: string,
): string[] {
  const clientPoints: string[] = [];
  const dialogueLines: string[] = [];

  for (const row of rows) {
    const rawContent = (row.content || "").trim();
    const mediaInterp = (row.mediaInterpretation || "").trim();
    const effectiveText =
      rawContent && !/^\[(áudio|audio|imagem|documento|vídeo|video)\]/i.test(rawContent)
        ? rawContent
        : mediaInterp || rawContent;
    const clean = effectiveText.replace(/\s+/g, " ").trim();
    if (!clean) continue;

    if (row.senderType === "client") {
      clientPoints.push(clean.slice(0, 220));
      dialogueLines.push(`- *Cliente:* ${clean.slice(0, 220)}`);
    } else if (row.senderType === "bot" || row.senderType === "agent") {
      const speaker = row.senderType === "bot" ? personaName : row.senderName || "Atendente";
      dialogueLines.push(`- *${speaker}:* ${clean.slice(0, 180)}`);
    }
  }

  if (dialogueLines.length === 0 && clientPoints.length === 0) {
    return [];
  }

  return dialogueLines.slice(-6);
}

/**
 * Registra no banco (internal_messages) e transmite em tempo real via SSE
 * o aviso proativo do Fagner / Valentina quando um cliente é transferido para o vendedor,
 * garantindo que a negociação possua a tarefa "Responder o contato" atribuída ao recebedor
 * e incluindo o resumo completo do que foi tratado no atendimento.
 */
export async function notifyOperatorLeadTransferred(
  params: LeadTransferNotificationParams,
): Promise<boolean> {
  const {
    tenantId,
    operatorId,
    conversationId,
    temperature = "quente",
    transferSource = "sdr_auto",
    transferredBy = null,
    cycle = null,
  } = params;

  if (!tenantId || !operatorId || !conversationId) return false;

  try {
    const persona = getAiPersona(tenantId);

    // 1. Enriquecer dados do operador, cliente, conversa e estado da triagem
    let operatorName = params.operatorName?.trim() || "";
    let clientName = params.clientName?.trim() || "";
    let company = params.company?.trim() || "";
    let interest = params.interest?.trim() || "";
    let dealId = params.dealId || null;
    let dealTitle = params.dealTitle || null;
    let taskId = params.taskId || null;
    let taskTitle = params.taskTitle || LEAD_TRANSFER_TASK_TITLE;
    let targetFunnel = params.targetFunnel || null;
    let contactId: string | null = null;
    let contactPhone = "";

    const [convRow] = await db
      .select({
        contactId: conversations.contactId,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        contactCompany: contacts.company,
        lastMessageText: conversations.lastMessageText,
      })
      .from(conversations)
      .leftJoin(
        contacts,
        and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)),
      )
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
      .limit(1);

    if (convRow) {
      contactId = convRow.contactId || null;
      contactPhone = convRow.contactPhone || "";
      if (!clientName && convRow.contactName) {
        clientName = convRow.contactName;
      }
      if (!company && convRow.contactCompany) {
        company = convRow.contactCompany;
      }
      if (!interest && convRow.lastMessageText) {
        interest = convRow.lastMessageText.slice(0, 140);
      }
    }

    if (!operatorName) {
      const [opRow] = await db
        .select({ name: operators.name })
        .from(operators)
        .where(and(eq(operators.id, operatorId), eq(operators.tenantId, tenantId)))
        .limit(1);
      if (opRow?.name) {
        operatorName = opRow.name;
      }
    }

    // Buscar dados coletados da triagem (agentFlowStates) se não fornecidos
    let collectedData = normalizeCollectedMap(params.collectedData);
    let flowRouteReason: string | null = null;
    const [latestFlow] = await db
      .select({
        collectedData: agentFlowStates.collectedData,
        metadata: agentFlowStates.metadata,
      })
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.conversationId, conversationId),
        ),
      )
      .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
      .limit(1);

    if (latestFlow) {
      const flowCollected = normalizeCollectedMap(
        (latestFlow.collectedData as Record<string, any>) || {},
      );
      collectedData = { ...flowCollected, ...collectedData };
      const flowMeta = (latestFlow.metadata as Record<string, any>) || {};
      if (!targetFunnel && typeof flowMeta.targetFunnel === "string") {
        targetFunnel = flowMeta.targetFunnel;
      }
      if (typeof flowMeta.routeReason === "string") {
        flowRouteReason = flowMeta.routeReason;
      }
      if (!dealId && typeof flowMeta.localCrmDealId === "string" && flowMeta.localCrmDealId) {
        dealId = flowMeta.localCrmDealId;
      }
      if (!dealTitle && typeof flowMeta.localCrmDealTitle === "string" && flowMeta.localCrmDealTitle) {
        dealTitle = flowMeta.localCrmDealTitle;
      }
    }

    const filledEntries = Object.entries(collectedData).filter(
      ([k, v]) =>
        !k.startsWith("_") &&
        v &&
        v.status === "filled" &&
        v.value &&
        v.value !== "Aguardando...",
    );

    if (!clientName) {
      const nameEntry = filledEntries.find(([k]) => /nome/i.test(k));
      if (nameEntry?.[1]?.value) clientName = nameEntry[1].value;
    }
    if (!company) {
      const compEntry = filledEntries.find(([k]) => /empresa|razao/i.test(k));
      if (compEntry?.[1]?.value) company = compEntry[1].value;
    }
    if (!interest) {
      const intEntry = filledEntries.find(([k]) =>
        /maquina|peca|interesse|produto|equipamento|assunto/i.test(k),
      );
      if (intEntry?.[1]?.value) interest = intEntry[1].value;
    }

    // 2. Localizar negociação vinculada ativa ou criar se ainda não existir
    if (!dealId || !dealTitle) {
      const [linkedDeal] = await db
        .select({
          id: crmDeals.id,
          title: crmDeals.title,
          value: crmDeals.value,
        })
        .from(crmConversationDeals)
        .innerJoin(
          crmDeals,
          and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId)),
        )
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(crmConversationDeals.conversationId, conversationId),
            eq(crmConversationDeals.isActive, true),
          ),
        )
        .orderBy(desc(crmConversationDeals.createdAt))
        .limit(1);

      if (linkedDeal) {
        dealId = dealId || linkedDeal.id;
        dealTitle = dealTitle || linkedDeal.title;
      }
    }

    if (!dealId) {
      const ensuredDeal = await ensureLocalCrmDealBeforeTransfer({
        tenantId,
        conversationId,
        contactId,
        contactPhone,
        clientName: clientName || "Cliente WhatsApp",
        companyName: company || undefined,
        targetOperatorId: operatorId,
        targetOperatorName: operatorName || null,
        targetFunnel: targetFunnel || "Atendimento Geral",
        funnelStage: "Qualificação",
        collectedData,
        requireConfiguredPipeline: false,
      });

      if (ensuredDeal.success && ensuredDeal.dealId) {
        dealId = ensuredDeal.dealId;
        dealTitle = ensuredDeal.dealTitle || dealTitle;
        taskId = ensuredDeal.taskId || taskId;
        taskTitle = ensuredDeal.taskTitle || taskTitle;
      }
    }

    // 3. Garantir que a tarefa "Responder o contato" exista na negociação com responsável = recebedor do lead
    if (dealId) {
      const ensuredTask = await ensureLeadTransferTaskOnDeal({
        tenantId,
        dealId,
        conversationId,
        operatorId,
        operatorName: operatorName || null,
        clientName: clientName || "Cliente",
        contactPhone: contactPhone || null,
        targetFunnel: targetFunnel || null,
      });
      if (ensuredTask) {
        taskId = ensuredTask.taskId;
        taskTitle = ensuredTask.taskTitle;
      }
    }

    // 4. Buscar últimas mensagens da conversa para montar o resumo do que foi tratado
    const recentMsgs = await db
      .select({
        senderType: messages.senderType,
        senderName: messages.senderName,
        content: messages.content,
        mediaType: messages.mediaType,
        mediaInterpretation: messages.mediaInterpretation,
      })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.conversationId, conversationId),
          eq(messages.isInternalNote, false),
        ),
      )
      .orderBy(desc(messages.sentAt), desc(messages.id))
      .limit(10);

    const chronologicalMsgs = [...recentMsgs].reverse();
    const dialogueSummaryLines = summarizeConversationMessages(chronologicalMsgs, persona.name);

    const displayClient = clientName || "Cliente";
    const companySuffix =
      company && !company.toLowerCase().includes("não informada") ? ` (${company})` : "";
    const funnelLabel = targetFunnel ? ` • Funil: *${targetFunnel}*` : "";
    const dealLabel = dealTitle ? ` • Negociação: *${dealTitle}*` : "";

    let headerLine = "";
    if (transferSource === "manual_transfer") {
      const byText = transferredBy ? ` por ${transferredBy}` : "";
      headerLine = `*Novo cliente transferido para você${byText}!*\nO atendimento de *${displayClient}*${companySuffix} já está na sua fila *Meus Atendimentos*${dealLabel}.`;
    } else if (transferSource === "rodizio_reassignment") {
      headerLine = `*Lead atribuído para você no Rodízio!*\nO cliente *${displayClient}*${companySuffix}${funnelLabel}${dealLabel} foi direcionado para a sua carteira.`;
    } else {
      headerLine = `*Novo lead transferido por ${persona.name} para você!*\nCliente: *${displayClient}*${companySuffix}${funnelLabel}${dealLabel}. Já está em *Meus Atendimentos* aguardando seu contato.`;
    }

    // 5. Construir o Resumo do que foi tratado no atendimento
    const summarySections: string[] = [];

    if (params.triageBriefing && params.triageBriefing.trim()) {
      summarySections.push(params.triageBriefing.trim().slice(0, 8_000));
      if (dialogueSummaryLines.length > 0) {
        summarySections.push(
          ["*Histórico recente do que foi conversado:*", ...dialogueSummaryLines].join("\n"),
        );
      }
    } else {
      const summaryLines: string[] = ["*Resumo do que foi tratado no atendimento*"];
      summaryLines.push(`- *Cliente:* ${displayClient}${companySuffix}`);
      if (contactPhone) {
        summaryLines.push(`- *Contato:* ${contactPhone}`);
      }
      if (targetFunnel) {
        summaryLines.push(`- *Setor / Funil:* ${targetFunnel}`);
      }
      if (interest) {
        summaryLines.push(`- *Demanda / Interesse principal:* ${interest}`);
      }
      if (flowRouteReason === "direct_operator_requested") {
        summaryLines.push(
          `- *Motivo do direcionamento:* Cliente solicitou falar diretamente com o vendedor/atendente.`,
        );
      }

      if (filledEntries.length > 0) {
        summaryLines.push("", "*Dados levantados pelo atendimento:*");
        for (const [key, val] of filledEntries) {
          summaryLines.push(`- *${key}:* ${val.value}`);
        }
      }

      if (dialogueSummaryLines.length > 0) {
        summaryLines.push("", "*Histórico recente do que foi conversado:*");
        summaryLines.push(...dialogueSummaryLines);
      }

      summarySections.push(summaryLines.join("\n"));
    }

    // Bloco explícito da Negociação + Tarefa criada para o operador
    const actionLines: string[] = ["*Ação registrada na Negociação*"];
    if (dealTitle) {
      actionLines.push(`- *Negociação vinculada:* ${dealTitle}`);
    }
    actionLines.push(
      `- *Tarefa criada:* ${taskTitle} (Responsável: ${operatorName || "Você"})`,
    );
    summarySections.push(actionLines.join("\n"));

    const content = `${headerLine}\n\n${summarySections.join("\n\n")}`;

    const interestDisplay =
      [
        targetFunnel ? `Setor/Funil: ${targetFunnel}` : null,
        dealTitle ? `Negociação: ${dealTitle}` : null,
        `Tarefa: ${taskTitle}`,
        interest && interest !== dealTitle ? interest : null,
      ]
        .filter(Boolean)
        .join(" | ") || "Atendimento comercial transferido para sua fila";

    const deterministicId = cycle
      ? `notif-transfer-${crypto.createHash("sha256").update(`${tenantId}:${conversationId}:${operatorId}:${cycle}`).digest("hex").slice(0, 24)}`
      : null;

    const now = new Date();
    const metadata = {
      type: "lead_transfer",
      scope: "operator",
      isWarning: true,
      warningType: "new_lead" as const,
      conversationId,
      clientId: conversationId,
      clientName: displayClient,
      contactName: displayClient,
      company: company || null,
      interest: interestDisplay,
      temperature,
      dealId,
      dealTitle,
      taskId,
      taskTitle,
      targetFunnel,
      transferSource,
      transferredBy,
      hasAttendanceSummary: true,
      ...(cycle ? { cycle } : {}),
    };

    const warningMetadata = {
      clientId: conversationId,
      clientName: displayClient,
      interest: interestDisplay,
      temperature,
      dealId: dealId || undefined,
      dealTitle: dealTitle || undefined,
      taskId: taskId || undefined,
      taskTitle,
    };

    if (deterministicId) {
      const [byId] = await db
        .select({
          id: internalMessages.id,
          content: internalMessages.content,
          metadata: internalMessages.metadata,
        })
        .from(internalMessages)
        .where(
          and(
            eq(internalMessages.tenantId, tenantId),
            eq(internalMessages.id, deterministicId),
          ),
        )
        .limit(1);

      if (byId) {
        const existingMeta = (byId.metadata as Record<string, any>) || {};
        const needsUpdate =
          !existingMeta.hasAttendanceSummary ||
          (!existingMeta.taskId && Boolean(taskId)) ||
          (Boolean(params.triageBriefing) && !byId.content.includes(params.triageBriefing.slice(0, 60)));

        if (needsUpdate) {
          await db
            .update(internalMessages)
            .set({
              content,
              metadata,
              lastFiredAt: now,
            })
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.id, deterministicId),
              ),
            );

          SessionManager.getInstance().notifyPublic(tenantId, {
            type: "operator_ai_notification" as any,
            operatorId,
            message: {
              id: deterministicId,
              direction: "from_agent",
              author: persona.name,
              content,
              createdAt: now.toISOString(),
              isWarning: true,
              warningType: "new_lead",
              warningMetadata,
              metadata,
            },
            notification: {
              id: deterministicId,
              author: persona.name,
              content,
              createdAt: now.toISOString(),
              isWarning: true,
              warningType: "new_lead",
              warningMetadata,
            },
          });
        }
        return true;
      }
    }

    // Evitar duplicação se o mesmo aviso de transferência já foi gerado nos últimos 2 minutos
    const recentWindow = new Date(Date.now() - 2 * 60 * 1000);
    const existing = await db
      .select({
        id: internalMessages.id,
        content: internalMessages.content,
        metadata: internalMessages.metadata,
      })
      .from(internalMessages)
      .where(
        and(
          eq(internalMessages.tenantId, tenantId),
          eq(internalMessages.operatorId, operatorId),
          sql`${internalMessages.metadata}->>'type' = 'lead_transfer'`,
          sql`${internalMessages.metadata}->>'conversationId' = ${conversationId}`,
          gte(internalMessages.createdAt, recentWindow),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const existingRow = existing[0];
      const existingMeta = (existingRow.metadata as Record<string, any>) || {};
      if (!existingMeta.hasAttendanceSummary || (!existingMeta.taskId && Boolean(taskId))) {
        await db
          .update(internalMessages)
          .set({
            content,
            metadata,
            lastFiredAt: now,
          })
          .where(
            and(
              eq(internalMessages.tenantId, tenantId),
              eq(internalMessages.id, existingRow.id),
            ),
          );
      }
      return true;
    }

    const notifId =
      deterministicId || `notif-transfer-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;

    const inserted = await db
      .insert(internalMessages)
      .values({
        id: notifId,
        tenantId,
        operatorId,
        direction: "from_agent",
        agentType: "supervisor",
        content,
        metadata,
        read: 0,
        createdAt: now,
        repeatCount: 1,
        lastFiredAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: internalMessages.id });

    if (inserted.length === 0) return true;

    SessionManager.getInstance().notifyPublic(tenantId, {
      type: "operator_ai_notification" as any,
      operatorId,
      message: {
        id: notifId,
        direction: "from_agent",
        author: persona.name,
        content,
        createdAt: now.toISOString(),
        isWarning: true,
        warningType: "new_lead",
        warningMetadata,
        metadata,
      },
      notification: {
        id: notifId,
        author: persona.name,
        content,
        createdAt: now.toISOString(),
        isWarning: true,
        warningType: "new_lead",
        warningMetadata,
      },
    });
    return true;
  } catch (err: any) {
    console.error("[notifyOperatorLeadTransferred] Erro ao notificar transferência:", err?.message || err);
    return false;
  }
}
