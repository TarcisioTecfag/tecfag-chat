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
