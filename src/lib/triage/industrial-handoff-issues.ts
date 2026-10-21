/** Códigos controlados: nunca persistir mensagens de exceção, SQL, credenciais ou prompts. */
export const HANDOFF_ISSUES = {
  sdr_disabled: [
    "Triagem automática desativada",
    "Confira a habilitação do SDR nas configurações antes de retomar.",
  ],
  site_channel_disabled: [
    "Canal do site desativado",
    "Confira a habilitação do atendimento pelo site.",
  ],
  whitelist_restricted: [
    "Atendimento fora da lista de teste",
    "Confira o telefone autorizado e a restrição de teste do SDR.",
  ],
  contact_missing: [
    "Contato indisponível",
    "Confira o vínculo entre o contato e a conversa nesta empresa.",
  ],
  settings_invalid: [
    "Configuração industrial inválida",
    "Revise e salve novamente o catálogo e os destinos em Fluxos.",
  ],
  destination_unconfigured: [
    "Destino não configurado",
    "Vincule setor, funil e etapa exigidos pelo destino em Fluxos.",
  ],
  destination_conflict: [
    "Destinos anteriores com vínculos diferentes",
    "Escolha uma única equipe, funil e etapa para o destino unificado em Fluxos e salve.",
  ],
  destination_sector_invalid: [
    "Setor de destino indisponível",
    "Selecione um setor existente nesta empresa em Fluxos.",
  ],
  destination_pipeline_invalid: [
    "Funil ou etapa de entrada inválidos",
    "Confira o funil e uma etapa aberta pertencente a ele em Fluxos.",
  ],
  rodizio_unconfigured: [
    "Escala não configurada",
    "Configure a escala de atendimento do destino em Fluxos.",
  ],
  rodizio_invalid: [
    "Escala inconsistente",
    "Revise os operadores duplicados ou inválidos na escala.",
  ],
  no_eligible_operator: [
    "Nenhum responsável elegível",
    "Confira participação, folga, autorização do destino e vínculo ao setor na escala.",
  ],
  crm_failed: [
    "Negociação não confirmada",
    "Confira a disponibilidade do CRM e seus vínculos. O encaminhamento permanece pendente.",
  ],
  assignment_failed: [
    "Atribuição não confirmada",
    "Confira o responsável atual da conversa antes de retomar.",
  ],
  transaction_failed: [
    "Falha ao gravar o encaminhamento",
    "Confira a disponibilidade do serviço. A transação foi revertida; a pendência será reavaliada.",
  ],
  processing_cancelled: [
    "Processamento interrompido",
    "Confira se houve intervenção humana ou nova mensagem antes de retomar.",
  ],
  operator_notification_failed: [
    "Aviso ao responsável não confirmado",
    "Confira as notificações internas. A atribuição já concluída não será sorteada novamente.",
  ],
  client_confirmation_failed: [
    "Confirmação ao cliente não enviada",
    "Confira a conexão do canal e a fila de mensagens. O responsável e o card já atribuídos serão preservados.",
  ],
} as const;
export type HandoffIssueCode = keyof typeof HANDOFF_ISSUES;
export interface HandoffIssue {
  version: 1;
  cycle: string;
  code: HandoffIssueCode;
  occurredAt: string;
  occurrences: number;
}
export class HandoffOperationalError extends Error {
  readonly issueCode: HandoffIssueCode;
  constructor(issueCode: HandoffIssueCode) {
    super(issueCode);
    this.issueCode = issueCode;
  }
}
export function readHandoffIssue(value: unknown, cycle: string): HandoffIssue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.version !== 1 ||
    row.cycle !== cycle ||
    typeof row.code !== "string" ||
    !Object.hasOwn(HANDOFF_ISSUES, row.code) ||
    typeof row.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(row.occurredAt))
  )
    return null;
  return {
    version: 1,
    cycle,
    code: row.code as HandoffIssueCode,
    occurredAt: row.occurredAt,
    occurrences:
      typeof row.occurrences === "number" &&
      Number.isSafeInteger(row.occurrences) &&
      row.occurrences > 0
        ? row.occurrences
        : 1,
  };
}
export function createHandoffIssue(
  code: HandoffIssueCode,
  cycle: string,
  previous?: unknown,
): HandoffIssue {
  const old = readHandoffIssue(previous, cycle);
  return {
    version: 1,
    cycle,
    code,
    occurredAt: new Date().toISOString(),
    occurrences: old?.code === code ? Math.min(old.occurrences + 1, 1_000_000) : 1,
  };
}
export function recordHandoffIssue(
  metadata: Record<string, unknown>,
  cycle: string,
  code: HandoffIssueCode,
) {
  const issue = createHandoffIssue(code, cycle, metadata.handoffIssue);
  const history = Array.isArray(metadata.handoffIssueHistory)
    ? metadata.handoffIssueHistory
        .map((row) => readHandoffIssue(row, cycle))
        .filter((row): row is HandoffIssue => Boolean(row))
    : [];
  if (history.at(-1)?.code === code) history.pop();
  return { handoffIssue: issue, handoffIssueHistory: [...history, issue].slice(-20) };
}
export function describeHandoffIssue(value: unknown, cycle: string) {
  const issue = readHandoffIssue(value, cycle);
  return issue
    ? { ...issue, title: HANDOFF_ISSUES[issue.code][0], action: HANDOFF_ISSUES[issue.code][1] }
    : null;
}
