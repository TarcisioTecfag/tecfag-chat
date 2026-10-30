export const attendanceEventLabels: Record<string, string> = {
  "attendance.created": "Atendimento criado",
  "attendance.started": "Atendimento iniciado",
  "attendance.transferred": "Atendimento transferido",
  "attendance.closed": "Atendimento encerrado",
  "attendance.reopened": "Atendimento reativado",
  "attendance.context_selected": "Negociação do atendimento definida",
  "triage.started": "Triagem iniciada",
  "triage.client_recognized": "Cadastro anterior identificado",
  "triage.data_restored": "Dados recuperados",
  "triage.field_updated": "Dados da triagem atualizados",
  "triage.field_collected": "Dado coletado na triagem",
  "triage.status_changed": "Situação da triagem atualizada",
  "note.form_opened": "Formulário de nota aberto",
  "note.created": "Nota adicionada",
  "task.created": "Tarefa criada pelo atendimento",
  "call.waiting": "Ligação solicitada",
  "call.active": "Ligação conectada",
  "call.connecting": "Cliente entrou na chamada",
  "call.ended": "Ligação encerrada",
  "call.missed": "Ligação não atendida",
  "message.created": "Mensagem enviada",
  "conversation.window_24h": "Registro consolidado de conversa (24h)",
  "message.reaction_changed": "Reação à mensagem atualizada",
  "message.accepted": "Mensagem aceita pelo canal",
  "message.delivered": "Mensagem entregue",
  "message.read": "Mensagem lida",
  "message.failed": "Falha no envio",
  "message.sending": "Envio em andamento",
  "contact.updated": "Dados do cliente atualizados no atendimento",
  "system.recorded": "Registro do atendimento",
  "legacy.recorded": "Registro anterior do atendimento",
};

export type AttendanceEventDTO = {
  id: string;
  eventType: string;
  description: string;
  actorName: string;
  createdAt: string;
  pendingBinding: boolean;
  dealId: string | null;
  legacy?: boolean;
};
