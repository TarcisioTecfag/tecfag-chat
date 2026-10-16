export const RD_ACTIVITY_EVENTS: Record<string, { identifier: string; label: string }> = {
  DETAIL_OPPORTUNITY: {
    identifier: "tecfag-chat-negociacao-criada",
    label: "Negociação criada ou reaberta",
  },
  DETAIL_SALE: { identifier: "tecfag-chat-negociacao-ganha", label: "Negociação ganha" },
  DETAIL_OPPORTUNITY_LOST: {
    identifier: "tecfag-chat-negociacao-perdida",
    label: "Negociação perdida",
  },
  TASK_CREATED: { identifier: "tecfag-chat-tarefa-criada", label: "Tarefa criada" },
  TASK_COMPLETED: { identifier: "tecfag-chat-tarefa-concluida", label: "Tarefa concluída" },
  CHAT_STARTED: { identifier: "tecfag-chat-conversa-iniciada", label: "Conversa iniciada" },
  CHAT_FINISHED: { identifier: "tecfag-chat-conversa-finalizada", label: "Conversa finalizada" },
};
export const RD_ACTIVITY_FIELDS = [
  {
    api_identifier: "cf_tecfag_chat_evento_id",
    label: "Tecfag Chat · ID do evento",
    presentation_type: "TEXT_INPUT",
  },
  {
    api_identifier: "cf_tecfag_chat_registro_url",
    label: "Tecfag Chat · Link do registro",
    presentation_type: "TEXT_INPUT",
  },
  {
    api_identifier: "cf_tecfag_chat_detalhes",
    label: "Tecfag Chat · Detalhes da ação",
    presentation_type: "TEXT_AREA",
  },
] as const;
export function isRdActivity(type: string) {
  return Object.hasOwn(RD_ACTIVITY_EVENTS, type);
}
export function rdEventLabel(type: string) {
  return (
    RD_ACTIVITY_EVENTS[type]?.label ||
    (
      { SALE: "Venda", OPPORTUNITY_LOST: "Perda", OPPORTUNITY: "Oportunidade" } as Record<
        string,
        string
      >
    )[type] ||
    type
  );
}
export function rdActivityOrigin(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === "http:"))
  )
    throw new Error("Informe a URL HTTPS pública deste sistema.");
  return url.origin;
}
export function rdActivityUrl(snapshot: Record<string, unknown>) {
  const base = rdActivityOrigin(String(snapshot.publicBaseUrl || ""));
  return snapshot.subjectType === "conversation"
    ? `${base}/chat/${encodeURIComponent(String(snapshot.conversationId))}`
    : `${base}/crm/deals/${encodeURIComponent(String(snapshot.dealId))}`;
}
export function rdActivityPayload(row: {
  id: string;
  eventType: string;
  snapshot: Record<string, unknown>;
  payload: Record<string, unknown>;
  parentId?: string | null;
}) {
  const definition = RD_ACTIVITY_EVENTS[row.eventType];
  if (!definition) throw new Error("Evento complementar inválido.");
  const s = row.snapshot,
    url = rdActivityUrl(s);
  const lines = [`Ação: ${definition.label}`, `ID do evento: ${row.id}`, `URL do registro: ${url}`];
  if (row.parentId) lines.push(`Evento padrão relacionado: ${row.parentId}`);
  const labels: Record<string, string> = {
    occurredAt: "Data da ação",
    contactName: "Contato",
    contactEmail: "E-mail",
    dealId: "ID da negociação",
    dealTitle: "Negociação",
    status: "Status da negociação",
    previousStatus: "Status anterior da negociação",
    pipeline: "Funil",
    stage: "Etapa",
    company: "Empresa",
    owner: "Responsável pela negociação/atendimento",
    value: "Valor",
    currency: "Moeda",
    rating: "Qualificação",
    source: "Fonte",
    campaign: "Campanha",
    lossReason: "Motivo da perda",
    taskId: "ID da tarefa",
    taskTitle: "Tarefa",
    taskType: "Tipo da tarefa",
    taskStatus: "Status da tarefa",
    taskOwner: "Responsável pela tarefa",
    actor: "Autor da ação",
    dueDate: "Prazo",
    completedAt: "Concluída em",
    description: "Descrição",
    conversationId: "ID da conversa",
    sector: "Setor",
    queue: "Fila",
  };
  const display: Record<string, string> = {
    open: "Em andamento",
    won: "Ganha",
    lost: "Perdida",
    paused: "Pausada",
    pending: "Pendente",
    completed: "Concluída",
    cancelled: "Cancelada",
    fila: "Fila de espera",
    meus: "Em atendimento",
    automacao: "Automação",
    finalizados: "Finalizada",
    task: "Tarefa",
    call: "Ligação",
    meeting: "Reunião",
    whatsapp: "WhatsApp",
  };
  for (const [key, label] of Object.entries(labels))
    if (s[key] !== undefined && s[key] !== null && s[key] !== "")
      lines.push(
        `${label}: ${["status", "previousStatus", "taskStatus", "queue", "taskType"].includes(key) ? display[String(s[key])] || String(s[key]) : String(s[key])}`,
      );
  if (Array.isArray(s.deals))
    for (const d of s.deals as Record<string, unknown>[])
      lines.push(
        `Negociação vinculada: ${d.dealTitle || ""} · ${d.dealId}\n${String(s.publicBaseUrl)}/crm/deals/${encodeURIComponent(String(d.dealId))}`,
      );
  const text = lines.join("\n");
  return {
    ...(row.payload.email ? { email: row.payload.email } : { phone: row.payload.phone }),
    conversion_identifier: definition.identifier,
    cf_tecfag_chat_evento_id: row.id,
    cf_tecfag_chat_registro_url: url,
    cf_tecfag_chat_detalhes:
      text.length > 14000
        ? text.slice(0, 13900) + "\n[Detalhes abreviados. Consulte o registro pelo link acima.]"
        : text,
  };
}

// Match conversion identity, never a profile field copied from a previous conversion.
export function isRdActivityLead(lead: Record<string, unknown>, depth = 0): boolean {
  if (depth > 8) return false;
  const objects = [lead, lead.rd_event, lead.payload, lead.last_conversion];
  for (const entry of objects) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    for (const value of [
      e.event_identifier,
      e.conversion_identifier,
      e.identifier,
      e.identificador,
    ])
      if (typeof value === "string" && value.toLowerCase().startsWith("tecfag-chat-")) return true;
    for (const nested of [e.content, e.conversion_origin])
      if (
        nested &&
        typeof nested === "object" &&
        isRdActivityLead(nested as Record<string, unknown>, depth + 1)
      )
        return true;
  }
  return false;
}
