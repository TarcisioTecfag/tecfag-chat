import crypto from "crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import { contacts, conversations, crmConversationDeals, crmDeals, internalMessages } from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";

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
  temperature?: "quente" | "morno" | "frio";
  transferSource?: "sdr_auto" | "manual_transfer" | "rodizio_reassignment";
  transferredBy?: string | null;
  cycle?: string | null;
  triageBriefing?: string;
}

/**
 * Registra no banco (internal_messages) e transmite em tempo real via SSE
 * o aviso proativo do Fagner / Valentina quando um cliente é transferido para o vendedor.
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

    // Enriquecer dados do cliente e negociação caso não tenham sido passados completos
    let clientName = params.clientName?.trim() || "";
    let company = params.company?.trim() || "";
    let interest = params.interest?.trim() || "";
    let dealId = params.dealId || null;
    let dealTitle = params.dealTitle || null;
    const targetFunnel = params.targetFunnel || null;

    if (!clientName || !interest) {
      const [convRow] = await db
        .select({
          contactName: contacts.name,
          lastMessageText: conversations.lastMessageText,
        })
        .from(conversations)
        .leftJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)))
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .limit(1);

      if (!clientName && convRow?.contactName) {
        clientName = convRow.contactName;
      }
      if (!interest && convRow?.lastMessageText) {
        interest = convRow.lastMessageText.slice(0, 140);
      }
    }

    if (!dealId || !dealTitle) {
      const [linkedDeal] = await db
        .select({
          id: crmDeals.id,
          title: crmDeals.title,
          value: crmDeals.value,
        })
        .from(crmConversationDeals)
        .innerJoin(crmDeals, and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId)))
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

    const displayClient = clientName || "Cliente";
    const companySuffix =
      company && !company.toLowerCase().includes("não informada") ? ` (${company})` : "";
    const funnelLabel = targetFunnel ? ` • Funil: *${targetFunnel}*` : "";
    const dealLabel = dealTitle ? ` • Card: *${dealTitle}*` : "";

    let content = "";
    if (transferSource === "manual_transfer") {
      const byText = transferredBy ? ` por ${transferredBy}` : "";
      content = `*Novo cliente transferido para você${byText}!*\nO atendimento de *${displayClient}*${companySuffix} já está na sua fila *Meus Atendimentos*${dealLabel}.`;
    } else if (transferSource === "rodizio_reassignment") {
      content = `*Lead atribuído para você no Rodízio!*\nO cliente *${displayClient}*${companySuffix}${funnelLabel}${dealLabel} foi direcionado para a sua carteira.`;
    } else {
      content = `*Novo lead qualificado por ${persona.name} e transferido para você!*\nCliente: *${displayClient}*${companySuffix}${funnelLabel}${dealLabel}. Já está em *Meus Atendimentos* aguardando seu contato!`;
    }

    if (params.triageBriefing) content += `\n\n${params.triageBriefing.slice(0, 10_000)}`;

    const interestDisplay =
      [
        targetFunnel ? `Setor/Funil: ${targetFunnel}` : null,
        dealTitle ? `Negociação: ${dealTitle}` : null,
        interest && interest !== dealTitle ? interest : null,
      ]
        .filter(Boolean)
        .join(" | ") || "Atendimento comercial transferido para sua fila";

    const deterministicId = cycle
      ? `notif-transfer-${crypto.createHash("sha256").update(`${tenantId}:${conversationId}:${operatorId}:${cycle}`).digest("hex").slice(0, 24)}`
      : null;

    if (deterministicId) {
      const [byId] = await db
        .select({ id: internalMessages.id })
        .from(internalMessages)
        .where(
          and(
            eq(internalMessages.tenantId, tenantId),
            eq(internalMessages.id, deterministicId),
          ),
        )
        .limit(1);
      if (byId) return true;
    }

    // Evitar duplicação se o mesmo aviso de transferência já foi gerado nos últimos 2 minutos
    const recentWindow = new Date(Date.now() - 2 * 60 * 1000);
    const existing = await db
      .select({ id: internalMessages.id })
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

    if (existing.length > 0) return true;

    const now = new Date();
    const notifId =
      deterministicId || `notif-transfer-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
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
      targetFunnel,
      transferSource,
      transferredBy,
      ...(cycle ? { cycle } : {}),
    };

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
        warningMetadata: {
          clientId: conversationId,
          clientName: displayClient,
          interest: interestDisplay,
          temperature,
        },
        metadata,
      },
      notification: {
        id: notifId,
        author: persona.name,
        content,
        createdAt: now.toISOString(),
        isWarning: true,
        warningType: "new_lead",
        warningMetadata: {
          clientId: conversationId,
          clientName: displayClient,
          interest: interestDisplay,
          temperature,
        },
      },
    });
    return true;
  } catch (err: any) {
    console.error("[notifyOperatorLeadTransferred] Erro ao notificar transferência:", err?.message || err);
    return false;
  }
}
