import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { agentFlowStates, contacts, conversations, messages } from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { INDUSTRIAL_REVIEW_FUNNEL, type CollectedFields, type IndustrialRoute } from "./industrial-policy";
import type { IndustrialDatabase } from "./industrial-rodizio-store";
import type { PendingApprovalSuggestion } from "./industrial-approval-store";

export type IndustrialRecoveryEscalationReason =
  | "max_attempts_reached"
  | "delivery_failed_or_unknown"
  | "meta_24h_window_closed";

export interface EscalateIndustrialFlowInput {
  tenantId: string;
  conversationId: string;
  triggerMessageId?: string | null;
  reason: IndustrialRecoveryEscalationReason;
  detail?: string | null;
  now?: Date;
}

export interface EscalateIndustrialFlowResult {
  escalated: boolean;
  reason?: string;
  suggestion?: PendingApprovalSuggestion | null;
}

function buildEscalationInternalNoteContent(
  personaName: string,
  reason: IndustrialRecoveryEscalationReason,
  detail?: string | null,
): string {
  const cleanDetail = typeof detail === "string" && detail.trim() ? ` (${detail.trim()})` : "";
  switch (reason) {
    case "meta_24h_window_closed":
      return `⚠️ Janela de 24h da Meta encerrada — ${personaName} bloqueou o envio livre para evitar falha de entrega e escalou automaticamente para Análise e revisão humana. Envie um Template Meta oficial aprovado para retomar o atendimento.${cleanDetail}`;
    case "delivery_failed_or_unknown":
      return `⚠️ Falha ou status incerto na entrega da resposta automática do ${personaName} — atendimento escalado automaticamente para Análise e revisão humana para verificação.${cleanDetail}`;
    case "max_attempts_reached":
    default:
      return `⚠️ Recuperação automática esgotou as tentativas sem conseguir responder ao cliente — atendimento escalado automaticamente para Análise e revisão humana para evitar cliente sem retorno.${cleanDetail}`;
  }
}

/**
 * Escala de forma idempotente e isolada por tenant um fluxo industrial preso
 * (esgotamento de retries de recovery, falha de entrega ou janela Meta 24h expirada)
 * para `5A_CLIENTE` (`Análise e revisão humana`), notificando a equipe SDR e registrando
 * uma nota interna explicativa.
 */
export async function escalateIndustrialFlowToHumanReview(
  database: IndustrialDatabase,
  params: EscalateIndustrialFlowInput,
): Promise<EscalateIndustrialFlowResult> {
  const { tenantId, conversationId, triggerMessageId = null, reason, detail = null } = params;
  const now = params.now || new Date();
  const persona = getAiPersona(tenantId);

  if (persona.triagePolicy !== "industrial") {
    return { escalated: false, reason: "non_industrial_tenant" };
  }

  const [conv] = await database
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      queueState: conversations.queueState,
      operatorId: conversations.operatorId,
    })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
    .limit(1);

  if (!conv || conv.operatorId || conv.queueState !== "automacao") {
    return { escalated: false, reason: "not_automacao" };
  }

  let [flow] = await database
    .select()
    .from(agentFlowStates)
    .where(
      and(
        eq(agentFlowStates.tenantId, tenantId),
        eq(agentFlowStates.conversationId, conversationId),
        eq(agentFlowStates.agentType, "sdr"),
      ),
    )
    .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
    .limit(1);

  if (!flow) {
    const newFlowId = `fs-sdr-${tenantId}-${conversationId}`;
    await database
      .insert(agentFlowStates)
      .values({
        id: newFlowId,
        tenantId,
        conversationId,
        agentType: "sdr",
        currentStep: "Em Qualificação",
        collectedData: {},
        metadata: {
          attendanceActorName: persona.name,
          stepNumber: 1,
          totalSteps: 7,
          followUpStage: 0,
          funnelStage: "triagem",
          targetFunnel: null,
        },
        startedAt: new Date(now.getTime() - 60_000),
        lastInteractionAt: now,
        outcome: "in_progress",
      })
      .onConflictDoNothing();

    [flow] = await database
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.id, newFlowId),
          eq(agentFlowStates.agentType, "sdr"),
        ),
      )
      .limit(1);
  }

  if (!flow) {
    return { escalated: false, reason: "flow_not_found" };
  }

  const meta = ((flow.metadata as Record<string, unknown>) || {}) as Record<string, unknown>;
  if (
    flow.outcome !== "in_progress" ||
    flow.completedAt ||
    meta.handoffStatus === "awaiting_approval" ||
    Boolean(meta.pendingApproval) ||
    Boolean(meta.handoffRequest) ||
    (triggerMessageId && meta.turnRecoveryEscalatedMessageId === triggerMessageId)
  ) {
    return { escalated: false, reason: "already_handled" };
  }

  const [contact] = conv.contactId
    ? await database
        .select({ name: contacts.name })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, conv.contactId)))
        .limit(1)
    : [];

  const collectedData = ((flow.collectedData as CollectedFields) || {}) as CollectedFields;
  const clientName =
    collectedData["NOME COMPLETO"]?.value || contact?.name || "Cliente WhatsApp";
  const companyName = collectedData["EMPRESA"]?.value || "Empresa não informada";

  const reviewRoute: IndustrialRoute = {
    subflow: "5A_CLIENTE",
    funnelStage: "outros",
    targetFunnel: INDUSTRIAL_REVIEW_FUNNEL,
    needsReview: true,
    reason: "specialist_review",
  };

  const { prepareIndustrialApproval, notifySdrTeamApprovalPending } = await import(
    "./industrial-approval-store"
  );

  const prep = await prepareIndustrialApproval(
    database,
    {
      tenantId,
      conversationId,
      flowId: flow.id,
      cycle: flow.startedAt.toISOString(),
    },
    {
      route: reviewRoute,
      data: collectedData,
      clientName,
      companyName,
      contactId: conv.contactId || null,
    },
  );

  if (!prep.prepared || !prep.suggestion) {
    return { escalated: false, reason: "prepare_failed" };
  }

  const escalationMetaPatch: Record<string, unknown> = {
    turnRecoveryEscalatedMessageId: triggerMessageId || null,
    turnRecoveryEscalatedAt: now.toISOString(),
    turnRecoveryEscalationReason: reason,
    ...(reason === "meta_24h_window_closed"
      ? {
          metaWindowBlockedAt: now.toISOString(),
          ...(triggerMessageId ? { metaWindowBlockedMessageId: triggerMessageId } : {}),
        }
      : {}),
  };

  await database
    .update(agentFlowStates)
    .set({
      metadata: sql`${agentFlowStates.metadata} || ${JSON.stringify(escalationMetaPatch)}::jsonb`,
      lastInteractionAt: now,
    })
    .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, flow.id)));

  const noteKey = `${tenantId}:${conversationId}:${flow.startedAt.toISOString()}:${reason}:${triggerMessageId || "cycle"}`;
  const noteId = `note-esc-${crypto.createHash("sha256").update(noteKey).digest("hex").slice(0, 32)}`;
  const noteContent = buildEscalationInternalNoteContent(persona.name, reason, detail);

  await database
    .insert(messages)
    .values({
      id: noteId,
      tenantId,
      conversationId,
      senderType: "system",
      senderName: `${persona.name} (Alerta de Triagem)`,
      content: noteContent,
      isInternalNote: true,
      provider: "internal",
      direction: "outbound",
      status: "delivered",
      sentAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  try {
    await notifySdrTeamApprovalPending(database, {
      tenantId,
      conversationId,
      suggestion: prep.suggestion,
    });
  } catch (notifyErr: any) {
    console.warn(
      `[IndustrialEscalation][${tenantId}] Aviso ao notificar equipe SDR (${conversationId}):`,
      notifyErr?.message || notifyErr,
    );
  }

  try {
    const { SessionManager } = await import("../baileys/session-manager");
    SessionManager.getInstance().notifyPublic(tenantId, {
      type: "sdr_flow_updated",
      conversationId,
      funnelStage: "outros",
      targetFunnel: INDUSTRIAL_REVIEW_FUNNEL,
      outcome: "in_progress",
      handoffStatus: "awaiting_approval",
      subflow: "5A_CLIENTE",
    });
  } catch {
    // SSE não crítico em contextos headless/teste
  }

  return { escalated: true, suggestion: prep.suggestion };
}
