type DealEvent = {
  eventType?: string | null;
  metadata?: Record<string, unknown> | null;
  fromStageId?: string | null;
  toStageId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
};

type EventText = { title: string; description: string | null };

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const currency = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount)
    : null;
};

const statusLabel = (value: unknown): string | null => {
  const status = text(value);
  if (!status) return null;
  return (
    (
      { open: "Em aberto", won: "Ganho", lost: "Perdido", paused: "Pausado" } as Record<
        string,
        string
      >
    )[status] || status
  );
};

const proposalStatusLabel = (value: unknown): string | null => {
  const status = text(value);
  if (!status) return null;
  return (
    (
      {
        draft: "Rascunho",
        copied: "Texto copiado",
        sent: "Enviada",
        accepted: "Aceita",
        rejected: "Recusada",
        expired: "Expirada",
      } as Record<string, string>
    )[status] || status
  );
};

export function formatDealEvent(
  event: DealEvent,
  stageNames: Map<string, string>,
  operatorNames: Map<string, string>,
): EventText {
  const meta = event.metadata || {};
  const stage = (value: unknown): string | null => {
    const id = text(value);
    return id ? stageNames.get(id) || null : null;
  };
  const operator = (value: unknown): string | null => {
    const id = text(value);
    return id ? operatorNames.get(id) || null : null;
  };
  const reason = text(meta.lossReason) || text(meta.reason);

  switch (event.eventType) {
    case "created":
      return { title: "Negociação criada", description: null };
    case "stage_changed":
    case "stage_change": {
      const next =
        text(meta.stageName) || stage(meta.toStageId || meta.newStageId || event.toStageId);
      const previous = stage(meta.fromStageId || meta.oldStageId || event.fromStageId);
      return {
        title: next ? `Etapa alterada para ${next}` : "Etapa da negociação alterada",
        description: previous ? `Etapa anterior: ${previous}` : null,
      };
    }
    case "status_changed":
    case "status_change": {
      const next = statusLabel(meta.toStatus || meta.status || event.toStatus);
      const previous = statusLabel(meta.fromStatus || event.fromStatus);
      return {
        title: next ? `Status alterado para ${next}` : "Status da negociação alterado",
        description:
          [previous ? `Antes: ${previous}` : null, reason ? `Motivo: ${reason}` : null]
            .filter(Boolean)
            .join(" · ") || null,
      };
    }
    case "bulk_updated": {
      const changes = [
        stage(meta.previousStageId) &&
        stage(meta.newStageId) &&
        meta.previousStageId !== meta.newStageId
          ? `Etapa: ${stage(meta.previousStageId)} → ${stage(meta.newStageId)}`
          : null,
        meta.previousStatus !== meta.newStatus &&
        statusLabel(meta.previousStatus) &&
        statusLabel(meta.newStatus)
          ? `Status: ${statusLabel(meta.previousStatus)} → ${statusLabel(meta.newStatus)}`
          : null,
        meta.previousOperatorId !== meta.newOperatorId && operator(meta.newOperatorId)
          ? `Responsável: ${operator(meta.newOperatorId)}`
          : null,
      ].filter(Boolean);
      return { title: "Negociação atualizada em lote", description: changes.join(" · ") || null };
    }
    case "conversation_linked":
      return { title: "Conversa vinculada à negociação", description: null };
    case "conversation_unlinked":
      return { title: "Conversa desvinculada da negociação", description: null };
    case "value_changed":
    case "value_change": {
      const value = currency(meta.newValue);
      return {
        title: value ? `Valor atualizado para ${value}` : "Valor da negociação atualizado",
        description: null,
      };
    }
    case "activity_created":
      return {
        title: `Tarefa criada${text(meta.activityTitle) ? `: ${text(meta.activityTitle)}` : ""}`,
        description: null,
      };
    case "note_created":
      return { title: "Nota comercial registrada", description: null };
    case "activity_completed":
      return {
        title: `Tarefa concluída${text(meta.activityTitle) ? `: ${text(meta.activityTitle)}` : ""}`,
        description: null,
      };
    case "activity_reopened":
      return {
        title: `Tarefa reaberta${text(meta.activityTitle) ? `: ${text(meta.activityTitle)}` : ""}`,
        description: null,
      };
    case "activity_cancelled":
      return {
        title: `Tarefa cancelada${text(meta.activityTitle) ? `: ${text(meta.activityTitle)}` : ""}`,
        description: null,
      };
    case "activity_rescheduled":
      return {
        title: `Tarefa reagendada${text(meta.activityTitle) ? `: ${text(meta.activityTitle)}` : ""}`,
        description: null,
      };
    case "activity_updated":
      return {
        title: `Tarefa atualizada${text(meta.activityTitle) ? `: ${text(meta.activityTitle)}` : ""}`,
        description: null,
      };
    case "activity_deleted":
      return {
        title: `Tarefa excluída${text(meta.activityTitle) ? `: ${text(meta.activityTitle)}` : ""}`,
        description: null,
      };
    case "message_marked_as_evidence":
      return {
        title: "Mensagem marcada como evidência",
        description: text(meta.note) || text(meta.messagePreview),
      };
    case "message_evidence_removed":
      return { title: "Marcação de evidência removida", description: null };
    case "product_added":
      return {
        title: `Produto adicionado${text(meta.name) ? `: ${text(meta.name)}` : ""}`,
        description: currency(meta.totalPrice) ? `Total: ${currency(meta.totalPrice)}` : null,
      };
    case "product_removed":
      return {
        title: `Produto removido${text(meta.name) ? `: ${text(meta.name)}` : ""}`,
        description: null,
      };
    case "proposal_created":
      return {
        title: `Proposta ${text(meta.proposalNumber) || "comercial"} criada`,
        description: currency(meta.total) ? `Valor: ${currency(meta.total)}` : null,
      };
    case "proposal_status_changed":
      return {
        title: `Proposta ${text(meta.proposalNumber) || "comercial"} alterada para ${proposalStatusLabel(meta.newStatus) || "outro status"}`,
        description: null,
      };
    case "deal_file_uploaded":
      return {
        title: `Arquivo anexado${text(meta.fileName) ? `: ${text(meta.fileName)}` : ""}`,
        description: null,
      };
    case "deal_file_deleted":
      return {
        title: `Arquivo removido${text(meta.fileName) ? `: ${text(meta.fileName)}` : ""}`,
        description: null,
      };
    case "deal_questionnaire_saved":
      return {
        title: `Questionário salvo${text(meta.formTitle) ? `: ${text(meta.formTitle)}` : ""}`,
        description: null,
      };
    case "deal_email_logged":
      return {
        title: `E-mail ${meta.direction === "inbound" ? "recebido" : "registrado"}${text(meta.subject) ? `: ${text(meta.subject)}` : ""}`,
        description: null,
      };
    case "deal_ai_priority_calculated":
      return {
        title: "Prioridade comercial atualizada",
        description: text(meta.reason)?.replace(/^\[IA Vertex\]:?\s*/i, "") || null,
      };
    default:
      return { title: "Alteração registrada na negociação", description: null };
  }
}
