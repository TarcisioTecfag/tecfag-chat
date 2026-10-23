/**
 * Contratos de DTO compartilhados para o Módulo Conversas + CRM.
 * Padroniza os dados de negociações, compradores, contatos e atividades
 * entre o servidor (API) e a interface (Cards, Listas, Modais).
 */

export interface CrmAccountDTO {
  id: string;
  tenantId: string;
  type: "person" | "company";
  name: string;
  tradeName?: string | null;
  segment?: string | null;
  documentType?: "cpf" | "cnpj" | "foreign" | "other" | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: Record<string, any> | null;
  notes?: string | null;
  customFields?: Record<string, unknown>;
}

export interface CrmDealContactDTO {
  id: string;
  dealId: string;
  contactId: string;
  role: string;
  isPrimary: boolean;
  contact?: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    avatar?: string | null;
  };
}

export interface CrmDealActivityDTO {
  id: string;
  dealId: string;
  type: "note" | "task" | "call" | "meeting";
  title: string;
  description?: string | null;
  status: "pending" | "completed" | "cancelled";
  dueDate?: string | null;
  completedAt?: string | null;
  operatorId?: string | null;
  createdAt: string;
}

export interface CrmDealDTO {
  id: string;
  tenantId: string;
  title: string;
  pipelineId: string;
  stageId: string;
  status: "open" | "won" | "lost" | "paused";
  value: string | null; // null = não informado, "0.00" = zero reais, "1500.50" = valor positivo
  currency: string;
  expectedCloseDate?: string | null;
  operatorId: string | null;
  ownerId?: string | null; // Alias para compatibilidade
  accountId: string | null;
  source?: string | null;
  campaign?: string | null;
  rating?: number | null;
  customFields?: Record<string, unknown>;
  lossReason?: string | null;
  pausedReason?: string | null;
  version: number;
  lastActivityAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;

  // Relações embutidas (DTO padronizado)
  account?: CrmAccountDTO | null;
  contacts?: CrmDealContactDTO[];
  contactsCount: number;
  conversationsCount: number;
  nextTask?: {
    id: string;
    title: string;
    type: string;
    dueDate: string | null;
    isOverdue: boolean;
  } | null;
}

export interface CreateDealPayload {
  title: string;
  pipelineId: string;
  stageId: string;
  accountId?: string | null;
  account?: {
    name: string;
    type?: "person" | "company";
    document?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  value?: number | string | null;
  currency?: string;
  expectedCloseDate?: string | null;
  operatorId?: string | null;
  ownerId?: string | null;
  source?: string;
  campaign?: string;
  rating?: number;
  contactId?: string;
  conversationId?: string;
  initialNote?: string | null;
}

export interface CrmContactSummaryDTO {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  avatar?: string | null;
  accountId?: string | null;
  role?: string | null;
  isPrimary?: boolean;
}

export interface CrmAccountConversationDTO {
  id: string;
  accountId: string;
  conversationId: string;
  contextNote?: string | null;
  createdByOperatorId?: string | null;
  operatorName?: string | null;
  createdAt: string;
  conversation?: {
    id: string;
    channel: string;
    status: string;
    contactName?: string | null;
    lastMessageAt?: string | null;
  } | null;
}

export interface CrmContactAccountHistoryDTO {
  id: string;
  contactId: string;
  contactName?: string | null;
  accountId: string | null;
  accountName?: string | null;
  reason?: string | null;
  changedByOperatorId?: string | null;
  operatorName?: string | null;
  createdAt: string;
}

export interface CrmAccountDetailDTO extends CrmAccountDTO {
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  contacts: CrmContactSummaryDTO[];
  deals: CrmDealDTO[];
  conversations: CrmAccountConversationDTO[];
  history: CrmContactAccountHistoryDTO[];
}

export type CrmDealEventType =
  | "conversation_context_changed"
  | "conversation_action"
  | "created"
  | "title_changed"
  | "value_changed"
  | "rating_changed"
  | "owner_changed"
  | "expected_close_date_changed"
  | "source_changed"
  | "campaign_changed"
  | "pipeline_changed"
  | "stage_changed"
  | "status_changed"
  | "bulk_updated"
  | "custom_fields_changed"
  | "account_linked"
  | "account_unlinked"
  | "account_changed"
  | "account_updated"
  | "account_archived"
  | "participant_added"
  | "participant_removed"
  | "participant_role_changed"
  | "primary_contact_changed"
  | "contact_updated"
  | "conversation_linked"
  | "conversation_unlinked"
  | "activity_created"
  | "note_created"
  | "activity_completed"
  | "activity_reopened"
  | "activity_cancelled"
  | "activity_rescheduled"
  | "activity_updated"
  | "activity_deleted"
  | "message_marked_as_evidence"
  | "message_evidence_removed"
  | "product_added"
  | "product_removed"
  | "proposal_created"
  | "proposal_status_changed"
  | "deal_file_uploaded"
  | "deal_file_deleted"
  | "deal_questionnaire_saved"
  | "deal_email_logged"
  | "deal_ai_priority_calculated";

export interface CrmDealEventFieldDiff {
  fieldLabel: string;
  fromValue: string | null;
  toValue: string | null;
}

export interface CrmDealCustomFieldDiff {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  fromValue: unknown;
  toValue: unknown;
  fromLabel: string | null;
  toLabel: string | null;
}

