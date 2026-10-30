import { attendanceEventLabels } from "../attendance-event-types";

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

const formatDatePtBr = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) return null;
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[3]}/${dateOnlyMatch[2]}/${dateOnlyMatch[1]}`;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("pt-BR");
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

const roleLabel = (value: unknown): string | null => {
  const role = text(value);
  if (!role) return null;
  return (
    (
      {
        decisor: "Decisor",
        comprador: "Comprador",
        influenciador: "Influenciador",
        financeiro: "Financeiro",
        operacional: "Operacional",
        outro: "Outro",
      } as Record<string, string>
    )[role.toLowerCase()] || role
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

const formatFieldChangesList = (changesRaw: unknown): string | null => {
  if (!Array.isArray(changesRaw) || changesRaw.length === 0) return null;
  const lines = changesRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const label = text(obj.fieldName) || text(obj.fieldLabel) || "Campo";
      const fromStr = text(obj.fromLabel) ?? text(obj.fromValue) ?? "vazio";
      const toStr = text(obj.toLabel) ?? text(obj.toValue) ?? "vazio";
      return `${label}: "${fromStr}" → "${toStr}"`;
    })
    .filter(Boolean);
  return lines.length > 0 ? lines.join(" · ") : null;
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
  const reason =
    text(meta.lossReason) ||
    text(meta.pausedReason) ||
    text(meta.winReason) ||
    text(meta.reason);

  switch (event.eventType) {
    case "conversation_context_changed":
      return { title: meta.toDealId ? (meta.direction === "released" ? "Atendimento direcionado a outra negociação" : "Negociação do atendimento definida") : "Atendimento aguardando nova negociação",
        description: meta.reason === "automatic" ? "Selecionada automaticamente por ser a única negociação em andamento." : "A alteração vale apenas para as próximas ações do atendimento." };
    case "conversation_action": {
      const actionType = text(meta.attendanceEventType) || text(meta.actionType);
      const rawDesc = text(meta.description);
      const cleanDesc = rawDesc
        ? rawDesc
            .replace(/registrou uma mensagem \([^)]+\):/gi, "enviou uma mensagem:")
            .replace(/\(pending\)/gi, "(enviada)")
            .replace(/\(sending\)/gi, "(enviada)")
            .replace(/\(accepted\)/gi, "(enviada)")
            .replace(/\(sent\)/gi, "(enviada)")
            .replace(/\(delivered\)/gi, "(entregue)")
            .replace(/\(read\)/gi, "(lida)")
            .replace(/\(received\)/gi, "(recebida)")
        : null;
      return {
        title:
          (actionType ? attendanceEventLabels[actionType] : null) ||
          (actionType === "note" || actionType === "note.created"
            ? "Nota do atendimento"
            : "Ação no atendimento"),
        description: cleanDesc,
      };
    }
    case "created":
      return { title: "Negociação criada", description: null };

    case "title_changed": {
      const fromTitle = text(meta.fromTitle);
      const toTitle = text(meta.toTitle);
      return {
        title: toTitle ? `Título alterado para "${toTitle}"` : "Título da negociação alterado",
        description: fromTitle ? `Antes: "${fromTitle}"` : null,
      };
    }

    case "rating_changed": {
      const fromRating =
        meta.fromRating !== null && meta.fromRating !== undefined && meta.fromRating !== ""
          ? `${Number(meta.fromRating)}★`
          : "Sem avaliação";
      const toRating =
        meta.toRating !== null && meta.toRating !== undefined && meta.toRating !== ""
          ? `${Number(meta.toRating)}★`
          : "Sem avaliação";
      return {
        title: `Qualificação alterada para ${toRating}`,
        description: `Antes: ${fromRating}`,
      };
    }

    case "owner_changed": {
      const toOp =
        text(meta.toOperatorName) || operator(meta.toOperatorId) || "Sem responsável";
      const fromOp =
        text(meta.fromOperatorName) || operator(meta.fromOperatorId) || "Sem responsável";
      return {
        title:
          toOp === "Sem responsável"
            ? "Responsável removido da negociação"
            : `Responsável alterado para ${toOp}`,
        description: `Antes: ${fromOp}`,
      };
    }

    case "expected_close_date_changed": {
      const fromDate = formatDatePtBr(meta.fromDate);
      const toDate = formatDatePtBr(meta.toDate);
      return {
        title: toDate
          ? `Previsão de fechamento alterada para ${toDate}`
          : "Previsão de fechamento removida",
        description: fromDate ? `Antes: ${fromDate}` : "Antes: Não definida",
      };
    }

    case "source_changed": {
      const fromSource = text(meta.fromSource) || "Não informada";
      const toSource = text(meta.toSource);
      return {
        title: toSource ? `Origem alterada para "${toSource}"` : "Origem removida",
        description: `Antes: ${fromSource}`,
      };
    }

    case "campaign_changed": {
      const fromCampaign = text(meta.fromCampaign) || "Não informada";
      const toCampaign = text(meta.toCampaign);
      return {
        title: toCampaign ? `Campanha alterada para "${toCampaign}"` : "Campanha removida",
        description: `Antes: ${fromCampaign}`,
      };
    }

    case "pipeline_changed": {
      const toPipeline = text(meta.toPipelineName);
      const fromPipeline = text(meta.fromPipelineName);
      const toStage =
        text(meta.toStageName) || stage(meta.toStageId || event.toStageId);
      const fromStage =
        text(meta.fromStageName) || stage(meta.fromStageId || event.fromStageId);
      const descParts = [
        fromPipeline ? `Funil anterior: ${fromPipeline}` : null,
        fromStage && toStage
          ? `Etapa: ${fromStage} → ${toStage}`
          : toStage
            ? `Nova etapa: ${toStage}`
            : null,
      ].filter(Boolean);
      return {
        title: toPipeline
          ? `Funil alterado para ${toPipeline}`
          : "Funil da negociação alterado",
        description: descParts.join(" · ") || null,
      };
    }

    case "stage_changed":
    case "stage_change": {
      const next =
        text(meta.toStageName) ||
        text(meta.stageName) ||
        stage(meta.toStageId || meta.newStageId || event.toStageId);
      const previous =
        text(meta.fromStageName) ||
        stage(meta.fromStageId || meta.oldStageId || event.fromStageId);
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
      return {
        title: "Negociação atualizada em lote",
        description: changes.join(" · ") || null,
      };
    }

    case "custom_fields_changed": {
      const desc = formatFieldChangesList(meta.changes);
      const count = Array.isArray(meta.changes) ? meta.changes.length : 0;
      return {
        title:
          count === 1
            ? "Campo personalizado da negociação atualizado"
            : "Campos personalizados da negociação atualizados",
        description: desc,
      };
    }

    case "account_linked": {
      const name = text(meta.accountName) || text(meta.toAccountName);
      const doc = text(meta.accountDocument);
      return {
        title: name ? `Comprador vinculado: ${name}` : "Comprador vinculado à negociação",
        description: doc ? `Documento: ${doc}` : null,
      };
    }

    case "account_unlinked": {
      const name = text(meta.accountName) || text(meta.fromAccountName);
      return {
        title: name
          ? `Comprador desvinculado: ${name}`
          : "Comprador desvinculado da negociação",
        description: null,
      };
    }

    case "account_changed": {
      const fromName = text(meta.fromAccountName) || "Anterior";
      const toName = text(meta.toAccountName) || text(meta.accountName);
      return {
        title: toName
          ? `Comprador alterado para ${toName}`
          : "Comprador da negociação alterado",
        description: `Antes: ${fromName}`,
      };
    }

    case "account_updated": {
      const name = text(meta.accountName);
      const desc = formatFieldChangesList(meta.changes);
      return {
        title: name ? `Dados do comprador atualizados (${name})` : "Dados do comprador atualizados",
        description: desc,
      };
    }

    case "account_archived": {
      const name = text(meta.accountName);
      return {
        title: name ? `Comprador arquivado: ${name}` : "Comprador arquivado",
        description: null,
      };
    }

    case "participant_added": {
      const name = text(meta.contactName);
      const role = roleLabel(meta.role);
      const phone = text(meta.contactPhone);
      const descParts = [
        role ? `Papel: ${role}` : null,
        meta.isPrimary ? "Contato principal" : null,
        phone ? `Tel: ${phone}` : null,
      ].filter(Boolean);
      return {
        title: name
          ? `Participante vinculado: ${name}`
          : "Participante vinculado à negociação",
        description: descParts.join(" · ") || null,
      };
    }

    case "participant_removed": {
      const name = text(meta.contactName);
      const role = roleLabel(meta.role);
      return {
        title: name
          ? `Participante removido: ${name}`
          : "Participante removido da negociação",
        description: role ? `Papel anterior: ${role}` : null,
      };
    }

    case "participant_role_changed": {
      const name = text(meta.contactName);
      const fromRole = roleLabel(meta.fromRole) || "Anterior";
      const toRole = roleLabel(meta.toRole) || "Novo";
      return {
        title: name
          ? `Papel do participante ${name} alterado para ${toRole}`
          : `Papel de participante alterado para ${toRole}`,
        description: `Antes: ${fromRole}`,
      };
    }

    case "primary_contact_changed": {
      const toName = text(meta.toContactName) || text(meta.contactName);
      const fromName = text(meta.fromContactName);
      return {
        title: toName
          ? `Contato principal alterado para ${toName}`
          : "Contato principal da negociação alterado",
        description: fromName ? `Antes: ${fromName}` : null,
      };
    }

    case "contact_updated": {
      const name = text(meta.contactName);
      const desc = formatFieldChangesList(meta.changes);
      return {
        title: name ? `Dados do contato atualizados (${name})` : "Dados do contato atualizados",
        description: desc,
      };
    }

    case "conversation_linked": {
      const contactName = text(meta.contactName);
      const contactPhone = text(meta.contactPhone);
      const descParts = [
        contactName ? `Contato: ${contactName}` : null,
        contactPhone ? `Tel: ${contactPhone}` : null,
      ].filter(Boolean);
      return {
        title: "Conversa vinculada à negociação",
        description: descParts.join(" · ") || null,
      };
    }

    case "conversation_unlinked": {
      const contactName = text(meta.contactName);
      return {
        title: "Conversa desvinculada da negociação",
        description: contactName ? `Contato: ${contactName}` : null,
      };
    }

    case "value_changed":
    case "value_change": {
      const value = currency(meta.newValue);
      const prev = currency(meta.previousValue);
      const isProductsSync = meta.reason === "products_sync";
      const descParts = [
        prev ? `Antes: ${prev}` : meta.previousValue === null ? "Antes: Não informado" : null,
        isProductsSync ? "Sincronizado via produtos" : null,
      ].filter(Boolean);
      return {
        title: value ? `Valor atualizado para ${value}` : "Valor da negociação removido",
        description: descParts.join(" · ") || null,
      };
    }

    case "activity_created":
      return {
        title: `Tarefa criada${text(meta.activityTitle) ? `: ${text(meta.activityTitle)}` : ""}`,
        description: formatDatePtBr(meta.dueDate)
          ? `Prazo: ${formatDatePtBr(meta.dueDate)}`
          : null,
      };

    case "note_created":
      return { title: "Nota comercial registrada", description: text(meta.activityTitle) };

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

    case "activity_rescheduled": {
      const fromDue = formatDatePtBr(meta.previousDueDate);
      const toDue = formatDatePtBr(meta.dueDate);
      return {
        title: `Tarefa reagendada${text(meta.activityTitle) ? `: ${text(meta.activityTitle)}` : ""}`,
        description:
          fromDue && toDue
            ? `Prazo: ${fromDue} → ${toDue}`
            : toDue
              ? `Novo prazo: ${toDue}`
              : null,
      };
    }

    case "activity_updated":
      return {
        title: `Tarefa atualizada${text(meta.activityTitle) ? `: ${text(meta.activityTitle)}` : ""}`,
        description: formatFieldChangesList(meta.changes),
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

    case "proposal_status_changed": {
      const prevStatus = proposalStatusLabel(meta.previousStatus);
      return {
        title: `Proposta ${text(meta.proposalNumber) || "comercial"} alterada para ${proposalStatusLabel(meta.newStatus) || "outro status"}`,
        description: prevStatus ? `Antes: ${prevStatus}` : null,
      };
    }

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

    case "deal_ai_priority_calculated": {
      const scoreVal =
        typeof meta.score === "number" || typeof meta.score === "string"
          ? `${Number(meta.score)} pts`
          : null;
      const lvlRaw = text(meta.level)?.toLowerCase();
      const lvlLabel = lvlRaw
        ? ({
            critica: "Crítica",
            alta: "Alta",
            media: "Média",
            baixa: "Baixa",
          } as Record<string, string>)[lvlRaw] || lvlRaw
        : null;
      const msgCount =
        typeof meta.analyzedMessagesCount === "number" && meta.analyzedMessagesCount > 0
          ? `${meta.analyzedMessagesCount} msg(s) analisada(s)`
          : null;
      const badgeSuffix = [scoreVal, lvlLabel ? `(${lvlLabel})` : null, msgCount ? `· ${msgCount}` : null]
        .filter(Boolean)
        .join(" ");
      return {
        title: badgeSuffix
          ? `Avaliação comercial IA: ${badgeSuffix}`
          : "Prioridade comercial atualizada",
        description:
          text(meta.reason)
            ?.replace(/^\[(IA Vertex|Critério Comercial Heurístico)\]:?\s*/i, "") || null,
      };
    }

    default:
      return { title: "Alteração registrada na negociação", description: null };
  }
}

