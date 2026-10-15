export type ActionHistoryKind = "all" | "deletion" | "bulk" | "export";

export type ActionEntityGroup =
  | "all"
  | "deals"
  | "pipelines"
  | "customers"
  | "catalogs"
  | "team"
  | "ai_voice";

export type ActionPeriodPreset = "all" | "today" | "7d" | "30d" | "month" | "custom";

export type ActionSortOption = "newest" | "oldest" | "most_items" | "least_items";

export interface ActionHistoryEntry {
  id: string;
  action: string;
  entityType: string;
  operatorId?: string | null;
  operatorName: string;
  itemCount: number;
  details: Record<string, unknown>;
  createdAt: string;
}

export const ACTION_HISTORY_LABELS: Record<string, string> = {
  delete_permanent: "Exclusão definitiva de negociações",
  delete_trash: "Negociações enviadas à lixeira",
  delete_contact: "Contato excluído",
  archive_account: "Empresa arquivada",
  delete_pipeline: "Funil excluído",
  delete_stage: "Etapa excluída",
  delete_product: "Produto excluído",
  delete_catalog_item: "Item de catálogo excluído",
  delete_custom_field: "Campo de cadastro excluído",
  delete_group: "Grupo de acesso excluído",
  delete_sector: "Setor excluído",
  delete_quick_response: "Resposta rápida excluída",
  delete_template: "Modelo de mensagem excluído",
  delete_operator: "Operador excluído",
  delete_voice_objective: "Objetivo de voz excluído",
  delete_voice_appointment: "Agendamento de voz excluído",
  delete_deal_activity: "Atividade de negociação excluída",
  delete_deal_product: "Produto removido da negociação",
  delete_deal_file: "Arquivo de negociação excluído",
  delete_knowledge_file: "Arquivo da base de conhecimento excluído",
  delete_knowledge_folder: "Pasta da base de conhecimento excluída",
  delete_meta_template: "Modelo da Meta excluído",
  bulk_update: "Negociações alteradas em massa",
  create_deals_for_companies: "Negociações criadas em massa",
  create_tasks: "Tarefas criadas em massa",
  reset_tenant: "Reinicialização de dados",
  bulk_voice_appointments: "Agendamentos de voz importados em massa",
  export: "Relatório exportado",
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  deal: "Negociações",
  deal_activity: "Atividade de negociação",
  deal_product: "Produto da negociação",
  deal_file: "Arquivo da negociação",
  pipeline: "Funil de vendas",
  stage: "Etapa de funil",
  contact: "Contato",
  account: "Empresa",
  company: "Empresa",
  product: "Produto / Serviço",
  catalog_item: "Item de catálogo",
  custom_field: "Campo personalizado",
  operator: "Operador",
  group: "Grupo de acesso",
  sector: "Setor",
  quick_response: "Resposta rápida",
  template: "Modelo de mensagem",
  meta_template: "Template Meta",
  knowledge_file: "Arquivo da Base IA",
  knowledge_folder: "Pasta da Base IA",
  voice_objective: "Objetivo de Voz",
  voice_appointment: "Agendamento de Voz",
  tenant: "Dados da Empresa",
};

export const ENTITY_GROUP_META: Array<{
  id: ActionEntityGroup;
  label: string;
  entityTypes: string[];
}> = [
  { id: "all", label: "Todos os módulos", entityTypes: [] },
  {
    id: "deals",
    label: "Negociações",
    entityTypes: ["deal", "deal_activity", "deal_product", "deal_file"],
  },
  {
    id: "pipelines",
    label: "Funis e etapas",
    entityTypes: ["pipeline", "stage"],
  },
  {
    id: "customers",
    label: "Contatos e empresas",
    entityTypes: ["contact", "account", "company"],
  },
  {
    id: "catalogs",
    label: "Campos, catálogos e produtos",
    entityTypes: ["custom_field", "catalog_item", "product"],
  },
  {
    id: "team",
    label: "Equipe, acessos e modelos",
    entityTypes: [
      "operator",
      "group",
      "sector",
      "quick_response",
      "template",
      "meta_template",
    ],
  },
  {
    id: "ai_voice",
    label: "IA, Voz e Base de Conhecimento",
    entityTypes: [
      "knowledge_file",
      "knowledge_folder",
      "voice_objective",
      "voice_appointment",
      "tenant",
    ],
  },
];

export const BULK_ACTION_CODES = [
  "bulk_update",
  "create_deals_for_companies",
  "create_tasks",
  "bulk_voice_appointments",
  "reset_tenant",
] as const;

export function normalizeSearchText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function getActionCategory(action: string): "deletion" | "bulk" | "export" {
  if (action === "export") return "export";
  if (action.startsWith("delete_") || action.startsWith("archive_")) return "deletion";
  return "bulk";
}

export function getActionLabel(action: string): string {
  return ACTION_HISTORY_LABELS[action] || action;
}

export function getEntityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] || entityType;
}

export function getEntityTypesForGroup(group: ActionEntityGroup): string[] {
  const found = ENTITY_GROUP_META.find((item) => item.id === group);
  return found ? found.entityTypes : [];
}

export function findMatchingActionCodes(searchQuery: string): string[] {
  const normalized = normalizeSearchText(searchQuery);
  if (!normalized) return [];
  return Object.entries(ACTION_HISTORY_LABELS)
    .filter(
      ([code, label]) =>
        normalizeSearchText(code).includes(normalized) ||
        normalizeSearchText(label).includes(normalized),
    )
    .map(([code]) => code);
}

export function findMatchingEntityTypes(searchQuery: string): string[] {
  const normalized = normalizeSearchText(searchQuery);
  if (!normalized) return [];
  return Object.entries(ENTITY_TYPE_LABELS)
    .filter(
      ([code, label]) =>
        normalizeSearchText(code).includes(normalized) ||
        normalizeSearchText(label).includes(normalized),
    )
    .map(([code]) => code);
}

export function formatActionSummary(entry: Pick<ActionHistoryEntry, "itemCount" | "details">): string | null {
  const details = entry.details || {};
  if (typeof details.filename === "string" && details.filename.trim()) {
    return details.filename.trim();
  }
  if (Array.isArray(details.deals) && details.deals.length > 0) {
    const preview = details.deals
      .slice(0, 3)
      .map((deal: any) => deal?.title || deal?.name || deal?.id || "")
      .filter(Boolean);
    const totalCount = Math.max(
      Number(entry.itemCount) || 0,
      typeof details.totalCount === "number" ? details.totalCount : 0,
      details.deals.length,
    );
    const remaining = Math.max(0, totalCount - preview.length);
    return (
      preview.join(", ") +
      (remaining > 0 ? ` e mais ${remaining.toLocaleString("pt-BR")}` : "")
    );
  }
  if (typeof details.name === "string" && details.name.trim()) {
    return details.name.trim();
  }
  if (typeof details.title === "string" && details.title.trim()) {
    return details.title.trim();
  }
  if (Array.isArray(details.folders) && details.folders.length > 0) {
    const names = details.folders
      .slice(0, 3)
      .map((f: any) => f?.name || f?.id)
      .filter(Boolean);
    if (names.length > 0) return `Pasta(s): ${names.join(", ")}`;
  }
  if (Array.isArray(details.files) && details.files.length > 0) {
    const names = details.files
      .slice(0, 3)
      .map((f: any) => f?.name || f?.id)
      .filter(Boolean);
    const remaining = Math.max(0, details.files.length - names.length);
    if (names.length > 0) {
      return `Arquivo(s): ${names.join(", ")}${remaining > 0 ? ` e mais ${remaining}` : ""}`;
    }
  }
  if (Array.isArray(details.appointments) && details.appointments.length > 0) {
    const names = details.appointments
      .slice(0, 3)
      .map((a: any) => a?.name || a?.clientName || a?.id)
      .filter(Boolean);
    const remaining = Math.max(0, details.appointments.length - names.length);
    if (names.length > 0) {
      return `${names.join(", ")}${remaining > 0 ? ` e mais ${remaining}` : ""}`;
    }
  }
  if (details.taskData && typeof details.taskData === "object") {
    const taskTitle = (details.taskData as Record<string, unknown>).title;
    if (typeof taskTitle === "string" && taskTitle.trim()) {
      return `Tarefa: ${taskTitle.trim()}`;
    }
  }
  if (details.updates && typeof details.updates === "object") {
    const updates = details.updates as Record<string, unknown>;
    const changedKeys: string[] = [];
    if (updates.stageId) changedKeys.push("Etapa");
    if (updates.pipelineId) changedKeys.push("Funil");
    if (updates.operatorId) changedKeys.push("Responsável");
    if (updates.status) changedKeys.push(`Status (${updates.status})`);
    if (updates.lossReason) changedKeys.push(`Motivo de perda (${updates.lossReason})`);
    if (updates.source) changedKeys.push(`Fonte (${updates.source})`);
    if (updates.campaign) changedKeys.push(`Campanha (${updates.campaign})`);
    if (changedKeys.length > 0) {
      return `Campos alterados: ${changedKeys.join(", ")}`;
    }
  }
  if (typeof details.id === "string" && details.id.trim()) {
    return `ID: ${details.id.trim()}`;
  }
  return null;
}

export interface AffectedItemPreview {
  id: string;
  label: string;
  kind: string;
}

export function extractAffectedItems(entry: Pick<ActionHistoryEntry, "details" | "entityType">): AffectedItemPreview[] {
  const details = entry.details || {};
  const results: AffectedItemPreview[] = [];

  if (Array.isArray(details.deals)) {
    for (const deal of details.deals) {
      if (deal && typeof deal === "object") {
        const id = String((deal as any).id || "");
        const label = String((deal as any).title || (deal as any).name || id || "Negociação");
        results.push({ id, label, kind: "Negociação" });
      }
    }
  }
  if (Array.isArray(details.folders)) {
    for (const folder of details.folders) {
      if (folder && typeof folder === "object") {
        const id = String((folder as any).id || "");
        const label = String((folder as any).name || id || "Pasta");
        results.push({ id, label, kind: "Pasta" });
      }
    }
  }
  if (Array.isArray(details.files)) {
    for (const file of details.files) {
      if (file && typeof file === "object") {
        const id = String((file as any).id || "");
        const label = String((file as any).name || id || "Arquivo");
        results.push({ id, label, kind: "Arquivo" });
      }
    }
  }
  if (Array.isArray(details.appointments)) {
    for (const appt of details.appointments) {
      if (appt && typeof appt === "object") {
        const id = String((appt as any).id || "");
        const label = String((appt as any).name || (appt as any).clientName || id || "Agendamento");
        results.push({ id, label, kind: "Agendamento" });
      }
    }
  }
  if (results.length === 0 && (typeof details.name === "string" || typeof details.id === "string")) {
    results.push({
      id: typeof details.id === "string" ? details.id : "",
      label:
        typeof details.name === "string" && details.name.trim()
          ? details.name.trim()
          : typeof details.filename === "string" && details.filename.trim()
            ? details.filename.trim()
            : String(details.id || "Item"),
      kind: getEntityTypeLabel(entry.entityType),
    });
  }

  return results;
}

export interface ActionHistoryFilterCriteria {
  kind?: ActionHistoryKind;
  search?: string;
  action?: string;
  entityGroup?: ActionEntityGroup;
  operator?: string;
  period?: ActionPeriodPreset;
  dateFrom?: string;
  dateTo?: string;
  now?: Date;
}

export function resolvePeriodBounds(
  period: ActionPeriodPreset = "all",
  dateFrom?: string,
  dateTo?: string,
  now: Date = new Date(),
): { from: Date | null; to: Date | null } {
  if (period === "all") return { from: null, to: null };

  if (period === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { from: start, to: end };
  }

  if (period === "7d") {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: start, to: now };
  }

  if (period === "30d") {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: start, to: now };
  }

  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { from: start, to: now };
  }

  if (period === "custom") {
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;
    return {
      from: from && !Number.isNaN(from.getTime()) ? from : null,
      to: to && !Number.isNaN(to.getTime()) ? to : null,
    };
  }

  return { from: null, to: null };
}

export function matchesActionHistoryFilters(
  entry: ActionHistoryEntry,
  criteria: ActionHistoryFilterCriteria,
): boolean {
  const {
    kind = "all",
    search = "",
    action = "all",
    entityGroup = "all",
    operator = "all",
    period = "all",
    dateFrom,
    dateTo,
    now,
  } = criteria;

  if (kind !== "all" && getActionCategory(entry.action) !== kind) {
    return false;
  }

  if (action && action !== "all" && entry.action !== action) {
    return false;
  }

  if (entityGroup && entityGroup !== "all") {
    const groupTypes = getEntityTypesForGroup(entityGroup);
    if (groupTypes.length > 0 && !groupTypes.includes(entry.entityType)) {
      return false;
    }
  }

  if (operator && operator !== "all" && entry.operatorName !== operator) {
    return false;
  }

  if (period !== "all" || dateFrom || dateTo) {
    const effectivePeriod = period === "all" && (dateFrom || dateTo) ? "custom" : period;
    const { from, to } = resolvePeriodBounds(effectivePeriod, dateFrom, dateTo, now);
    const createdDate = new Date(entry.createdAt);
    if (!Number.isNaN(createdDate.getTime())) {
      if (from && createdDate < from) return false;
      if (to && createdDate > to) return false;
    }
  }

  const normalizedQuery = normalizeSearchText(search);
  if (normalizedQuery) {
    const summaryText = formatActionSummary(entry) || "";
    const actionLabel = getActionLabel(entry.action);
    const entityLabel = getEntityTypeLabel(entry.entityType);
    const detailsText = JSON.stringify(entry.details || {});

    const haystack = normalizeSearchText(
      `${entry.operatorName} ${entry.action} ${actionLabel} ${entry.entityType} ${entityLabel} ${summaryText} ${detailsText}`,
    );

    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (!haystack.includes(token)) {
        return false;
      }
    }
  }

  return true;
}

export function sortActionHistoryEntries(
  entries: ActionHistoryEntry[],
  sortBy: ActionSortOption = "newest",
): ActionHistoryEntry[] {
  const copy = [...entries];
  copy.sort((a, b) => {
    if (sortBy === "most_items") {
      if (b.itemCount !== a.itemCount) return b.itemCount - a.itemCount;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    if (sortBy === "least_items") {
      if (a.itemCount !== b.itemCount) return a.itemCount - b.itemCount;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    if (sortBy === "oldest") {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return copy;
}
