// ══════════════════════════════════════════════════════════════════════════════
// 🛡️ RBAC & PERMISSÕES GRANULARES — SISTEMA VALEM CHAT / TECFAG CHAT
// ══════════════════════════════════════════════════════════════════════════════

import { resolvePermissionAliases } from "./access-control/group-settings";

export type TenantId = "valem" | "tecfag";
export type ChannelId = "whatsapp" | "instagram" | "messenger" | "livechat";

export type ViewId =
  | "chat"
  | "commercialHome"
  | "commercialManagement"
  | "commercialBi"
  | "crm"
  | "tasks"
  | "contacts"
  | "wallet"
  | "valentina"
  | "ligacoes"
  | "monitor"
  | "analytics"
  | "groups"
  | "settings";

export type ValentinaTabId = "chat" | "sdr" | "rodizio" | "fluxos" | "supervisor" | "vendedor" | "knowledge";
export type MonitorTabId = "live" | "alerts" | "operators" | "audits" | "tasks" | "site";
export type AnalyticsTabId = "overview" | "performance" | "sla" | "contacts" | "reports" | "costs";
export type SettingsTabId = "whatsapp" | "voz" | "rd" | "crm" | "email" | "livechat";
export type LigacoesTabId =
  | "voice_equipe"
  | "voice_vendedor"
  | "voice_ligacao"
  | "dashboard"
  | "agenda"
  | "historico"
  | "clientes"
  | "campanhas"
  | "objetivos";

// ── 10 Blocos Estruturados de Permissão ─────────────────────────────────────

export interface ViewPermissions {
  chat: boolean;
  commercialHome: boolean;
  commercialManagement: boolean;
  commercialBi: boolean;
  crm: boolean;
  tasks: boolean;
  contacts: boolean;
  wallet: boolean;
  valentina: boolean;
  ligacoes: boolean;
  monitor: boolean;
  analytics: boolean;
  groups: boolean;
  settings: boolean;
}

export interface ChatPermissions {
  canViewQueueMine?: boolean;
  canViewQueueWaiting?: boolean;
  canViewQueueBot?: boolean;
  canViewQueueClosed?: boolean;
  restrictToOwnChats?: boolean;
  canCaptureChat: boolean;
  canTransferChat: boolean;
  canFinishChat: boolean;
  canViewAllChats: boolean;
  canOverrideChat: boolean;
  canSendInternalNotes: boolean;
  canEditClientInfo: boolean;
  canManageTags: boolean;
  canManageRdCrm: boolean;
  canChangeWallet: boolean;
  canDeleteMessages: boolean;
}

export interface ContactPermissions {
  contactScope: "all" | "wallet_only";
  canCreateContact: boolean;
  canEditContact: boolean;
  canDeleteContact: boolean;
  canExportContacts: boolean;
}

export interface ValentinaPermissions {
  canAccessChat: boolean;
  canAccessSdr: boolean;
  canManageSdr: boolean;
  canAccessRodizio: boolean;
  canManageRodizio: boolean;
  canAccessSupervisor: boolean;
  canAccessKnowledge: boolean;
  canManageKnowledge: boolean;
}

export interface LigacoesPermissions {
  canAccessDashboard: boolean;
  canAccessAgenda: boolean;
  canAccessHistory: boolean;
  canTriggerTestCall: boolean;
  canManageCampaigns: boolean;
  canManageObjectives: boolean;
  canAccessClients?: boolean;
}

export interface MonitorPermissions {
  canAccessLive: boolean;
  canAccessAlerts: boolean;
  canAccessRanking: boolean;
  canAccessAudits: boolean;
  canManageAudits: boolean;
  canAccessTeamTasks: boolean;
  canAccessSiteVisitors: boolean;
}

export interface AnalyticsPermissions {
  canAccessOverview: boolean;
  canAccessPerformance: boolean;
  canAccessSla: boolean;
  canAccessContacts: boolean;
  canAccessAiReports: boolean;
  canAccessCosts: boolean;
}

export interface SecurityPermissions {
  canManageUsers: boolean;
  canResetUserPasswords: boolean;
  canImpersonateUsers: boolean;
  canManageAccessGroups: boolean;
  canManageSectors: boolean;
  canManageWallets: boolean;
  canManageGlobalTemplates: boolean;
}

export interface SettingsPermissions {
  canManageWhatsapp: boolean;
  canManageVoiceSettings: boolean;
  canManageRdCrmSettings: boolean;
  canManageEmailSmtp: boolean;
  canManageLiveChatSettings: boolean;
}

export interface CrmPermissions {
  /** Escopo de visibilidade de funis: 'all' (todos os funis) | 'selected' (apenas funis selecionados) */
  pipelineScope?: "all" | "selected";
  /** Lista de IDs de funis liberados quando pipelineScope === 'selected' */
  allowedPipelineIds?: string[];
  /** Ativa ou desativa a restrição de etapas visíveis por funil sem apagar as seleções salvas */
  stageRestrictionEnabled?: boolean;
  /** Mapa de pipelineId -> stageIds visíveis quando stageRestrictionEnabled === true (chave ausente = todas as etapas visíveis) */
  allowedStageIdsByPipeline?: Record<string, string[]>;
  /** Permite enviar/transferir negociações para etapas ocultas ou funis não visíveis */
  canSendToHiddenStagesOrPipelines?: boolean;
  /** Lista opcional de funis ocultos para os quais é permitido transferir quando canSendToHiddenStagesOrPipelines === true */
  transferTargetPipelineIds?: string[];
  canViewCrm: boolean;
  canViewAllDeals: boolean;
  canCreateDeals: boolean;
  canEditDeals: boolean;
  canMoveStages: boolean;
  canCloseDeals: boolean;
  canManagePipelines: boolean;
  canManageProducts: boolean;
  canManageProposals: boolean;
  canDeleteDeals?: boolean;
  canExportDeals?: boolean;
}

export interface GroupPermissions {
  views: ViewPermissions;
  chat: ChatPermissions;
  crm: CrmPermissions;
  contacts: ContactPermissions;
  valentina: ValentinaPermissions;
  ligacoes: LigacoesPermissions;
  monitor: MonitorPermissions;
  analytics: AnalyticsPermissions;
  security: SecurityPermissions;
  settings: SettingsPermissions;
}

// ── Default / Master Admin Permissions ──────────────────────────────────────

export const DEFAULT_ADMIN_PERMISSIONS: GroupPermissions = {
  views: {
    chat: true,
    commercialHome: true,
    commercialManagement: true,
    commercialBi: true,
    crm: true,
    tasks: true,
    contacts: true,
    wallet: true,
    valentina: true,
    ligacoes: true,
    monitor: true,
    analytics: true,
    groups: true,
    settings: true,
  },
  chat: {
    canViewQueueMine: true,
    canViewQueueWaiting: true,
    canViewQueueBot: true,
    canViewQueueClosed: true,
    restrictToOwnChats: false,
    canCaptureChat: true,
    canTransferChat: true,
    canFinishChat: true,
    canViewAllChats: true,
    canOverrideChat: true,
    canSendInternalNotes: true,
    canEditClientInfo: true,
    canManageTags: true,
    canManageRdCrm: true,
    canChangeWallet: true,
    canDeleteMessages: true,
  },
  crm: {
    pipelineScope: "all",
    allowedPipelineIds: undefined,
    stageRestrictionEnabled: false,
    allowedStageIdsByPipeline: undefined,
    canSendToHiddenStagesOrPipelines: false,
    transferTargetPipelineIds: undefined,
    canViewCrm: true,
    canViewAllDeals: true,
    canCreateDeals: true,
    canEditDeals: true,
    canMoveStages: true,
    canCloseDeals: true,
    canManagePipelines: true,
    canManageProducts: true,
    canManageProposals: true,
    canDeleteDeals: true,
    canExportDeals: true,
  },
  contacts: {
    contactScope: "all",
    canCreateContact: true,
    canEditContact: true,
    canDeleteContact: true,
    canExportContacts: true,
  },
  valentina: {
    canAccessChat: true,
    canAccessSdr: true,
    canManageSdr: true,
    canAccessRodizio: true,
    canManageRodizio: true,
    canAccessSupervisor: true,
    canAccessKnowledge: true,
    canManageKnowledge: true,
  },
  ligacoes: {
    canAccessDashboard: true,
    canAccessAgenda: true,
    canAccessHistory: true,
    canTriggerTestCall: true,
    canManageCampaigns: true,
    canManageObjectives: true,
    canAccessClients: true,
  },
  monitor: {
    canAccessLive: true,
    canAccessAlerts: true,
    canAccessRanking: true,
    canAccessAudits: true,
    canManageAudits: true,
    canAccessTeamTasks: true,
    canAccessSiteVisitors: true,
  },
  analytics: {
    canAccessOverview: true,
    canAccessPerformance: true,
    canAccessSla: true,
    canAccessContacts: true,
    canAccessAiReports: true,
    canAccessCosts: true,
  },
  security: {
    canManageUsers: true,
    canResetUserPasswords: true,
    canImpersonateUsers: true,
    canManageAccessGroups: true,
    canManageSectors: true,
    canManageWallets: true,
    canManageGlobalTemplates: true,
  },
  settings: {
    canManageWhatsapp: true,
    canManageVoiceSettings: true,
    canManageRdCrmSettings: true,
    canManageEmailSmtp: true,
    canManageLiveChatSettings: true,
  },
};

// ── Presets de Papéis Comerciais ────────────────────────────────────────────

export const ROLE_PRESETS: Record<string, { name: string; description: string; permissions: GroupPermissions }> = {
  admin: {
    name: "Administrador Master",
    description: "Acesso irrestrito a todos os módulos, custos, infraestrutura e segurança do sistema.",
    permissions: DEFAULT_ADMIN_PERMISSIONS,
  },
  supervisor: {
    name: "Supervisor / Gerente",
    description: "Acesso a monitoramento ao vivo, auditorias QA, ranking, relatórios e gestão de equipes, sem acesso a chaves de API/TI nem custos brutos.",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,
      views: {
        chat: true,
        commercialHome: true,
        commercialManagement: false,
        commercialBi: false,
        crm: true,
        tasks: true,
        contacts: true,
        wallet: true,
        valentina: true,
        ligacoes: true,
        monitor: true,
        analytics: true,
        groups: true,
        settings: false,
      },
      crm: {
        canDeleteDeals: false,
        canExportDeals: false,
        canViewCrm: true,
        canViewAllDeals: true,
        canCreateDeals: true,
        canEditDeals: true,
        canMoveStages: true,
        canCloseDeals: true,
        canManagePipelines: false,
        canManageProducts: false,
        canManageProposals: true,
      },
      analytics: {
        canAccessOverview: true,
        canAccessPerformance: true,
        canAccessSla: true,
        canAccessContacts: true,
        canAccessAiReports: true,
        canAccessCosts: false,
      },
      security: {
        canManageUsers: true,
        canResetUserPasswords: true,
        canImpersonateUsers: true,
        canManageAccessGroups: false,
        canManageSectors: true,
        canManageWallets: true,
        canManageGlobalTemplates: true,
      },
      settings: {
        canManageWhatsapp: false,
        canManageVoiceSettings: false,
        canManageRdCrmSettings: false,
        canManageEmailSmtp: false,
        canManageLiveChatSettings: false,
      },
    },
  },
  sdr: {
    name: "SDR (Pré-Vendas / Qualificação)",
    description: "Acesso ao painel SDR da Valentina, filas de triagem, captura e transferência de leads, sem acesso a Analytics gerencial nem configurações.",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,
      views: {
        chat: true,
        commercialHome: true,
        commercialManagement: false,
        commercialBi: false,
        crm: true,
        tasks: true,
        contacts: true,
        wallet: false,
        valentina: true,
        ligacoes: false,
        monitor: false,
        analytics: false,
        groups: false,
        settings: false,
      },
      crm: {
        canDeleteDeals: false,
        canExportDeals: false,
        canViewCrm: true,
        canViewAllDeals: true,
        canCreateDeals: true,
        canEditDeals: true,
        canMoveStages: true,
        canCloseDeals: false,
        canManagePipelines: false,
        canManageProducts: false,
        canManageProposals: false,
      },
      chat: {
        canCaptureChat: true,
        canTransferChat: true,
        canFinishChat: false,
        canViewAllChats: true,
        canOverrideChat: false,
        canSendInternalNotes: true,
        canEditClientInfo: true,
        canManageTags: true,
        canManageRdCrm: true,
        canChangeWallet: false,
        canDeleteMessages: false,
      },
      contacts: {
        contactScope: "all",
        canCreateContact: true,
        canEditContact: true,
        canDeleteContact: false,
        canExportContacts: false,
      },
      valentina: {
        canAccessChat: true,
        canAccessSdr: true,
        canManageSdr: true,
        canAccessRodizio: false,
        canManageRodizio: false,
        canAccessSupervisor: false,
        canAccessKnowledge: true,
        canManageKnowledge: false,
      },
      ligacoes: {
        canAccessDashboard: false,
        canAccessAgenda: false,
        canAccessHistory: false,
        canTriggerTestCall: false,
        canManageCampaigns: false,
        canManageObjectives: false,
      },
      monitor: {
        canAccessLive: false,
        canAccessAlerts: false,
        canAccessRanking: false,
        canAccessAudits: false,
        canManageAudits: false,
        canAccessTeamTasks: false,
        canAccessSiteVisitors: false,
      },
      analytics: {
        canAccessOverview: false,
        canAccessPerformance: false,
        canAccessSla: false,
        canAccessContacts: false,
        canAccessAiReports: false,
        canAccessCosts: false,
      },
      security: {
        canManageUsers: false,
        canResetUserPasswords: false,
        canImpersonateUsers: false,
        canManageAccessGroups: false,
        canManageSectors: false,
        canManageWallets: false,
        canManageGlobalTemplates: false,
      },
      settings: {
        canManageWhatsapp: false,
        canManageVoiceSettings: false,
        canManageRdCrmSettings: false,
        canManageEmailSmtp: false,
        canManageLiveChatSettings: false,
      },
    },
  },
  vendedor: {
    name: "Vendedor / Comercial",
    description: "Acesso focado em seus atendimentos, sua carteira de clientes, notas internas, templates e assistente de IA. Bloqueado de Analytics, Monitoramento e Ajustes.",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,
      views: {
        chat: true,
        commercialHome: true,
        commercialManagement: false,
        commercialBi: false,
        crm: true,
        tasks: true,
        contacts: true,
        wallet: true,
        valentina: true,
        ligacoes: false,
        monitor: false,
        analytics: false,
        groups: false,
        settings: false,
      },
      crm: {
        canDeleteDeals: false,
        canExportDeals: false,
        canViewCrm: true,
        canViewAllDeals: false,
        canCreateDeals: true,
        canEditDeals: true,
        canMoveStages: true,
        canCloseDeals: true,
        canManagePipelines: false,
        canManageProducts: false,
        canManageProposals: true,
      },
      chat: {
        canCaptureChat: true,
        canTransferChat: true,
        canFinishChat: true,
        canViewAllChats: false,
        canOverrideChat: false,
        canSendInternalNotes: true,
        canEditClientInfo: true,
        canManageTags: true,
        canManageRdCrm: true,
        canChangeWallet: false,
        canDeleteMessages: false,
      },
      contacts: {
        contactScope: "wallet_only",
        canCreateContact: true,
        canEditContact: true,
        canDeleteContact: false,
        canExportContacts: false,
      },
      valentina: {
        canAccessChat: true,
        canAccessSdr: false,
        canManageSdr: false,
        canAccessRodizio: false,
        canManageRodizio: false,
        canAccessSupervisor: false,
        canAccessKnowledge: true,
        canManageKnowledge: false,
      },
      ligacoes: {
        canAccessDashboard: false,
        canAccessAgenda: false,
        canAccessHistory: false,
        canTriggerTestCall: false,
        canManageCampaigns: false,
        canManageObjectives: false,
      },
      monitor: {
        canAccessLive: false,
        canAccessAlerts: false,
        canAccessRanking: false,
        canAccessAudits: false,
        canManageAudits: false,
        canAccessTeamTasks: false,
        canAccessSiteVisitors: false,
      },
      analytics: {
        canAccessOverview: false,
        canAccessPerformance: false,
        canAccessSla: false,
        canAccessContacts: false,
        canAccessAiReports: false,
        canAccessCosts: false,
      },
      security: {
        canManageUsers: false,
        canResetUserPasswords: false,
        canImpersonateUsers: false,
        canManageAccessGroups: false,
        canManageSectors: false,
        canManageWallets: false,
        canManageGlobalTemplates: false,
      },
      settings: {
        canManageWhatsapp: false,
        canManageVoiceSettings: false,
        canManageRdCrmSettings: false,
        canManageEmailSmtp: false,
        canManageLiveChatSettings: false,
      },
    },
  },
  suporte: {
    name: "Suporte Técnico / Pós-Venda",
    description: "Acesso a chats de suporte, base de clientes, base de conhecimento (catálogo/especificações) e tarefas. Sem SDR, Rodízio ou Analytics comercial.",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,
      views: {
        chat: true,
        commercialHome: false,
        commercialManagement: false,
        commercialBi: false,
        crm: false,
        tasks: true,
        contacts: true,
        wallet: false,
        valentina: true,
        ligacoes: false,
        monitor: false,
        analytics: false,
        groups: false,
        settings: false,
      },
      crm: {
        canDeleteDeals: false,
        canExportDeals: false,
        canViewCrm: false,
        canViewAllDeals: false,
        canCreateDeals: false,
        canEditDeals: false,
        canMoveStages: false,
        canCloseDeals: false,
        canManagePipelines: false,
        canManageProducts: false,
        canManageProposals: false,
      },
      chat: {
        canCaptureChat: true,
        canTransferChat: true,
        canFinishChat: true,
        canViewAllChats: true,
        canOverrideChat: false,
        canSendInternalNotes: true,
        canEditClientInfo: true,
        canManageTags: true,
        canManageRdCrm: false,
        canChangeWallet: false,
        canDeleteMessages: false,
      },
      contacts: {
        contactScope: "all",
        canCreateContact: true,
        canEditContact: true,
        canDeleteContact: false,
        canExportContacts: false,
      },
      valentina: {
        canAccessChat: true,
        canAccessSdr: false,
        canManageSdr: false,
        canAccessRodizio: false,
        canManageRodizio: false,
        canAccessSupervisor: false,
        canAccessKnowledge: true,
        canManageKnowledge: false,
      },
      ligacoes: {
        canAccessDashboard: false,
        canAccessAgenda: false,
        canAccessHistory: false,
        canTriggerTestCall: false,
        canManageCampaigns: false,
        canManageObjectives: false,
      },
      monitor: {
        canAccessLive: false,
        canAccessAlerts: false,
        canAccessRanking: false,
        canAccessAudits: false,
        canManageAudits: false,
        canAccessTeamTasks: false,
        canAccessSiteVisitors: false,
      },
      analytics: {
        canAccessOverview: false,
        canAccessPerformance: false,
        canAccessSla: false,
        canAccessContacts: false,
        canAccessAiReports: false,
        canAccessCosts: false,
      },
      security: {
        canManageUsers: false,
        canResetUserPasswords: false,
        canImpersonateUsers: false,
        canManageAccessGroups: false,
        canManageSectors: false,
        canManageWallets: false,
        canManageGlobalTemplates: false,
      },
      settings: {
        canManageWhatsapp: false,
        canManageVoiceSettings: false,
        canManageRdCrmSettings: false,
        canManageEmailSmtp: false,
        canManageLiveChatSettings: false,
      },
    },
  },
  marketing: {
    name: "Marketing & Growth",
    description: "Acesso a estatísticas e relatórios de IA, campanhas em massa de voz e base de conhecimento, sem acesso a chats privados ou credenciais de TI.",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,
      views: {
        chat: false,
        commercialHome: false,
        commercialManagement: false,
        commercialBi: false,
        crm: false,
        tasks: true,
        contacts: true,
        wallet: false,
        valentina: true,
        ligacoes: true,
        monitor: false,
        analytics: true,
        groups: false,
        settings: false,
      },
      crm: {
        canDeleteDeals: false,
        canExportDeals: false,
        canViewCrm: false,
        canViewAllDeals: false,
        canCreateDeals: false,
        canEditDeals: false,
        canMoveStages: false,
        canCloseDeals: false,
        canManagePipelines: false,
        canManageProducts: false,
        canManageProposals: false,
      },
      chat: {
        canCaptureChat: false,
        canTransferChat: false,
        canFinishChat: false,
        canViewAllChats: false,
        canOverrideChat: false,
        canSendInternalNotes: false,
        canEditClientInfo: false,
        canManageTags: false,
        canManageRdCrm: false,
        canChangeWallet: false,
        canDeleteMessages: false,
      },
      contacts: {
        contactScope: "all",
        canCreateContact: false,
        canEditContact: false,
        canDeleteContact: false,
        canExportContacts: true,
      },
      valentina: {
        canAccessChat: true,
        canAccessSdr: false,
        canManageSdr: false,
        canAccessRodizio: false,
        canManageRodizio: false,
        canAccessSupervisor: false,
        canAccessKnowledge: true,
        canManageKnowledge: true,
      },
      ligacoes: {
        canAccessDashboard: true,
        canAccessAgenda: true,
        canAccessHistory: true,
        canTriggerTestCall: true,
        canManageCampaigns: true,
        canManageObjectives: true,
      },
      monitor: {
        canAccessLive: false,
        canAccessAlerts: false,
        canAccessRanking: false,
        canAccessAudits: false,
        canManageAudits: false,
        canAccessTeamTasks: false,
        canAccessSiteVisitors: true,
      },
      analytics: {
        canAccessOverview: true,
        canAccessPerformance: true,
        canAccessSla: false,
        canAccessContacts: true,
        canAccessAiReports: true,
        canAccessCosts: false,
      },
      security: {
        canManageUsers: false,
        canResetUserPasswords: false,
        canImpersonateUsers: false,
        canManageAccessGroups: false,
        canManageSectors: false,
        canManageWallets: false,
        canManageGlobalTemplates: false,
      },
      settings: {
        canManageWhatsapp: false,
        canManageVoiceSettings: false,
        canManageRdCrmSettings: false,
        canManageEmailSmtp: false,
        canManageLiveChatSettings: false,
      },
    },
  },
};

// ── Normalizador de Permissões (Retrocompatibilidade & Fallback) ─────────────

export const DEFAULT_DENY_PERMISSIONS: GroupPermissions = Object.fromEntries(
  Object.entries(DEFAULT_ADMIN_PERMISSIONS).map(([category, values]) => [category,
    Object.fromEntries(Object.keys(values).map((key) => [
      key,
      key === "contactScope"
        ? "wallet_only"
        : key === "pipelineScope"
          ? "all"
          : key === "allowedPipelineIds" ||
              key === "allowedStageIdsByPipeline" ||
              key === "transferTargetPipelineIds"
            ? undefined
            : false,
    ])),
  ]),
) as unknown as GroupPermissions;

export function normalizeGroupPermissions(rawGroup: any): GroupPermissions {
  if (!rawGroup) return structuredClone(DEFAULT_DENY_PERMISSIONS);

  // Se já tiver o objeto permissions preenchido, faz merge com os defaults
  const existingPerms = resolvePermissionAliases(rawGroup.permissions);
  const hasCustomPerms =
    existingPerms &&
    typeof existingPerms === "object" &&
    Object.keys(existingPerms).length > 0 &&
    Boolean(existingPerms.views || existingPerms.chat);

  // Inferência inteligente a partir de flags legadas ou nome do grupo se não houver permissions explícito
  const isLegacyAdmin =
    !hasCustomPerms || // Grupos existentes sem permissions granulares salvos herdam Admin por padrão
    rawGroup.id === "group-admin" ||
    rawGroup.id === "group-1" ||
    rawGroup.role === "admin" ||
    (typeof rawGroup.name === "string" && (
      rawGroup.name.toLowerCase().includes("admin") ||
      rawGroup.name.toLowerCase().includes("gerent") ||
      rawGroup.name.toLowerCase().includes("master")
    )) ||
    rawGroup.canCreateUser === true ||
    rawGroup.canResetPassword === true ||
    rawGroup.canOverrideChat === true;

  const baseFallback = isLegacyAdmin ? DEFAULT_ADMIN_PERMISSIONS : (ROLE_PRESETS.vendedor?.permissions || DEFAULT_ADMIN_PERMISSIONS);

  const normalizedPipelineScope: "all" | "selected" =
    existingPerms.crm?.pipelineScope === "selected" ? "selected" : "all";
  const normalizedAllowedPipelineIds: string[] | undefined = Array.isArray(existingPerms.crm?.allowedPipelineIds)
    ? Array.from(
        new Set<string>(
          existingPerms.crm.allowedPipelineIds
            .filter((id: unknown): id is string => typeof id === "string")
            .map((id: string) => id.trim())
            .filter(Boolean)
        )
      )
    : undefined;

  const normalizedStageRestrictionEnabled = Boolean(existingPerms.crm?.stageRestrictionEnabled);
  let normalizedAllowedStageIdsByPipeline: Record<string, string[]> | undefined = undefined;
  if (
    existingPerms.crm?.allowedStageIdsByPipeline &&
    typeof existingPerms.crm.allowedStageIdsByPipeline === "object" &&
    !Array.isArray(existingPerms.crm.allowedStageIdsByPipeline)
  ) {
    const map: Record<string, string[]> = {};
    for (const [pipeId, stageList] of Object.entries(existingPerms.crm.allowedStageIdsByPipeline)) {
      const cleanPipeId = typeof pipeId === "string" ? pipeId.trim() : "";
      if (!cleanPipeId || !Array.isArray(stageList)) continue;
      map[cleanPipeId] = Array.from(
        new Set<string>(
          stageList
            .filter((s: unknown): s is string => typeof s === "string")
            .map((s: string) => s.trim())
            .filter(Boolean)
        )
      );
    }
    normalizedAllowedStageIdsByPipeline = map;
  }

  const normalizedCanSendToHidden = Boolean(existingPerms.crm?.canSendToHiddenStagesOrPipelines);
  const normalizedTransferTargetPipelineIds: string[] | undefined = Array.isArray(existingPerms.crm?.transferTargetPipelineIds)
    ? Array.from(
        new Set<string>(
          existingPerms.crm.transferTargetPipelineIds
            .filter((id: unknown): id is string => typeof id === "string")
            .map((id: string) => id.trim())
            .filter(Boolean)
        )
      )
    : undefined;

  return {
    views: {
      chat: existingPerms.views?.chat ?? baseFallback.views.chat,
      commercialHome: existingPerms.views?.commercialHome ?? baseFallback.views.commercialHome,
      commercialManagement: existingPerms.views?.commercialManagement ?? baseFallback.views.commercialManagement,
      commercialBi: existingPerms.views?.commercialBi ?? baseFallback.views.commercialBi,
      crm: existingPerms.views?.crm ?? (isLegacyAdmin || Boolean(baseFallback.views.crm)),
      tasks: existingPerms.views?.tasks ?? baseFallback.views.tasks,
      contacts: existingPerms.views?.contacts ?? baseFallback.views.contacts,
      wallet: existingPerms.views?.wallet ?? baseFallback.views.wallet,
      valentina: existingPerms.views?.valentina ?? baseFallback.views.valentina,
      ligacoes: existingPerms.views?.ligacoes ?? baseFallback.views.ligacoes,
      monitor: existingPerms.views?.monitor ?? baseFallback.views.monitor,
      analytics: existingPerms.views?.analytics ?? baseFallback.views.analytics,
      groups: existingPerms.views?.groups ?? (rawGroup.canCreateUser || baseFallback.views.groups),
      settings: existingPerms.views?.settings ?? (isLegacyAdmin || baseFallback.views.settings),
    },
    chat: {
      canViewQueueMine: existingPerms.chat?.canViewQueueMine ?? true,
      canViewQueueWaiting: existingPerms.chat?.canViewQueueWaiting ?? true,
      canViewQueueBot: existingPerms.chat?.canViewQueueBot ?? true,
      canViewQueueClosed: existingPerms.chat?.canViewQueueClosed ?? true,
      restrictToOwnChats: existingPerms.chat?.restrictToOwnChats ?? false,
      canCaptureChat: existingPerms.chat?.canCaptureChat ?? rawGroup.canCaptureChat ?? baseFallback.chat.canCaptureChat,
      canTransferChat: existingPerms.chat?.canTransferChat ?? rawGroup.canTransferChat ?? baseFallback.chat.canTransferChat,
      canFinishChat: existingPerms.chat?.canFinishChat ?? rawGroup.canFinishChat ?? baseFallback.chat.canFinishChat,
      canViewAllChats: existingPerms.chat?.canViewAllChats ?? rawGroup.canViewAllChats ?? baseFallback.chat.canViewAllChats,
      canOverrideChat: existingPerms.chat?.canOverrideChat ?? rawGroup.canOverrideChat ?? baseFallback.chat.canOverrideChat,
      canSendInternalNotes: existingPerms.chat?.canSendInternalNotes ?? baseFallback.chat.canSendInternalNotes,
      canEditClientInfo: existingPerms.chat?.canEditClientInfo ?? rawGroup.canEditProfile ?? baseFallback.chat.canEditClientInfo,
      canManageTags: existingPerms.chat?.canManageTags ?? baseFallback.chat.canManageTags,
      canManageRdCrm: existingPerms.chat?.canManageRdCrm ?? baseFallback.chat.canManageRdCrm,
      canChangeWallet: existingPerms.chat?.canChangeWallet ?? baseFallback.chat.canChangeWallet,
      canDeleteMessages: existingPerms.chat?.canDeleteMessages ?? isLegacyAdmin,
    },
    crm: {
      pipelineScope: normalizedPipelineScope,
      allowedPipelineIds: normalizedAllowedPipelineIds,
      stageRestrictionEnabled: normalizedStageRestrictionEnabled,
      allowedStageIdsByPipeline: normalizedAllowedStageIdsByPipeline,
      canSendToHiddenStagesOrPipelines: normalizedCanSendToHidden,
      transferTargetPipelineIds: normalizedTransferTargetPipelineIds,
      canViewCrm: existingPerms.crm?.canViewCrm ?? (isLegacyAdmin || Boolean(baseFallback.crm.canViewCrm)),
      canViewAllDeals: existingPerms.crm?.canViewAllDeals ?? (isLegacyAdmin || baseFallback.crm.canViewAllDeals),
      canCreateDeals: existingPerms.crm?.canCreateDeals ?? (isLegacyAdmin || baseFallback.crm.canCreateDeals),
      canEditDeals: existingPerms.crm?.canEditDeals ?? (isLegacyAdmin || baseFallback.crm.canEditDeals),
      canMoveStages: existingPerms.crm?.canMoveStages ?? (isLegacyAdmin || baseFallback.crm.canMoveStages),
      canCloseDeals: existingPerms.crm?.canCloseDeals ?? (isLegacyAdmin || baseFallback.crm.canCloseDeals),
      canManagePipelines: existingPerms.crm?.canManagePipelines ?? (isLegacyAdmin || baseFallback.crm.canManagePipelines),
      canManageProducts: existingPerms.crm?.canManageProducts ?? (isLegacyAdmin || baseFallback.crm.canManageProducts),
      canManageProposals: existingPerms.crm?.canManageProposals ?? (isLegacyAdmin || baseFallback.crm.canManageProposals),
      // New destructive/export actions are opt-in for existing non-admin groups.
      canDeleteDeals: existingPerms.crm?.canDeleteDeals ?? false,
      canExportDeals: existingPerms.crm?.canExportDeals ?? false,
    },
    contacts: {
      contactScope: existingPerms.contacts?.contactScope ?? baseFallback.contacts.contactScope,
      canCreateContact: existingPerms.contacts?.canCreateContact ?? baseFallback.contacts.canCreateContact,
      canEditContact: existingPerms.contacts?.canEditContact ?? baseFallback.contacts.canEditContact,
      canDeleteContact: existingPerms.contacts?.canDeleteContact ?? isLegacyAdmin,
      canExportContacts: existingPerms.contacts?.canExportContacts ?? baseFallback.contacts.canExportContacts,
    },
    valentina: {
      canAccessChat: existingPerms.valentina?.canAccessChat ?? baseFallback.valentina.canAccessChat,
      canAccessSdr: existingPerms.valentina?.canAccessSdr ?? (isLegacyAdmin || baseFallback.valentina.canAccessSdr),
      canManageSdr: existingPerms.valentina?.canManageSdr ?? (isLegacyAdmin || baseFallback.valentina.canManageSdr),
      canAccessRodizio: existingPerms.valentina?.canAccessRodizio ?? (isLegacyAdmin || baseFallback.valentina.canAccessRodizio),
      canManageRodizio: existingPerms.valentina?.canManageRodizio ?? (isLegacyAdmin || baseFallback.valentina.canManageRodizio),
      canAccessSupervisor: existingPerms.valentina?.canAccessSupervisor ?? (isLegacyAdmin || baseFallback.valentina.canAccessSupervisor),
      canAccessKnowledge: existingPerms.valentina?.canAccessKnowledge ?? baseFallback.valentina.canAccessKnowledge,
      canManageKnowledge: existingPerms.valentina?.canManageKnowledge ?? (isLegacyAdmin || baseFallback.valentina.canManageKnowledge),
    },
    ligacoes: {
      canAccessDashboard: existingPerms.ligacoes?.canAccessDashboard ?? baseFallback.ligacoes.canAccessDashboard,
      canAccessAgenda: existingPerms.ligacoes?.canAccessAgenda ?? baseFallback.ligacoes.canAccessAgenda,
      canAccessHistory: existingPerms.ligacoes?.canAccessHistory ?? baseFallback.ligacoes.canAccessHistory,
      canTriggerTestCall: existingPerms.ligacoes?.canTriggerTestCall ?? (isLegacyAdmin || baseFallback.ligacoes.canTriggerTestCall),
      canManageCampaigns: existingPerms.ligacoes?.canManageCampaigns ?? (isLegacyAdmin || baseFallback.ligacoes.canManageCampaigns),
      canManageObjectives: existingPerms.ligacoes?.canManageObjectives ?? (isLegacyAdmin || baseFallback.ligacoes.canManageObjectives),
      canAccessClients: existingPerms.ligacoes?.canAccessClients ?? true,
    },
    monitor: {
      canAccessLive: existingPerms.monitor?.canAccessLive ?? (isLegacyAdmin || baseFallback.monitor.canAccessLive),
      canAccessAlerts: existingPerms.monitor?.canAccessAlerts ?? (isLegacyAdmin || baseFallback.monitor.canAccessAlerts),
      canAccessRanking: existingPerms.monitor?.canAccessRanking ?? (isLegacyAdmin || baseFallback.monitor.canAccessRanking),
      canAccessAudits: existingPerms.monitor?.canAccessAudits ?? (isLegacyAdmin || baseFallback.monitor.canAccessAudits),
      canManageAudits: existingPerms.monitor?.canManageAudits ?? (isLegacyAdmin || baseFallback.monitor.canManageAudits),
      canAccessTeamTasks: existingPerms.monitor?.canAccessTeamTasks ?? (isLegacyAdmin || baseFallback.monitor.canAccessTeamTasks),
      canAccessSiteVisitors: existingPerms.monitor?.canAccessSiteVisitors ?? (isLegacyAdmin || baseFallback.monitor.canAccessSiteVisitors),
    },
    analytics: {
      canAccessOverview: existingPerms.analytics?.canAccessOverview ?? (isLegacyAdmin || baseFallback.analytics.canAccessOverview),
      canAccessPerformance: existingPerms.analytics?.canAccessPerformance ?? (isLegacyAdmin || baseFallback.analytics.canAccessPerformance),
      canAccessSla: existingPerms.analytics?.canAccessSla ?? (isLegacyAdmin || baseFallback.analytics.canAccessSla),
      canAccessContacts: existingPerms.analytics?.canAccessContacts ?? (isLegacyAdmin || baseFallback.analytics.canAccessContacts),
      canAccessAiReports: existingPerms.analytics?.canAccessAiReports ?? (isLegacyAdmin || baseFallback.analytics.canAccessAiReports),
      canAccessCosts: existingPerms.analytics?.canAccessCosts ?? (isLegacyAdmin || false),
    },
    security: {
      canManageUsers: existingPerms.security?.canManageUsers ?? rawGroup.canCreateUser ?? (isLegacyAdmin || baseFallback.security.canManageUsers),
      canResetUserPasswords: existingPerms.security?.canResetUserPasswords ?? rawGroup.canResetPassword ?? (isLegacyAdmin || baseFallback.security.canResetUserPasswords),
      canImpersonateUsers: existingPerms.security?.canImpersonateUsers ?? isLegacyAdmin,
      canManageAccessGroups: existingPerms.security?.canManageAccessGroups ?? isLegacyAdmin,
      canManageSectors: existingPerms.security?.canManageSectors ?? (isLegacyAdmin || baseFallback.security.canManageSectors),
      canManageWallets: existingPerms.security?.canManageWallets ?? (isLegacyAdmin || baseFallback.security.canManageWallets),
      canManageGlobalTemplates: existingPerms.security?.canManageGlobalTemplates ?? (isLegacyAdmin || baseFallback.security.canManageGlobalTemplates),
    },
    settings: {
      canManageWhatsapp: existingPerms.settings?.canManageWhatsapp ?? isLegacyAdmin,
      canManageVoiceSettings: existingPerms.settings?.canManageVoiceSettings ?? isLegacyAdmin,
      canManageRdCrmSettings: existingPerms.settings?.canManageRdCrmSettings ?? isLegacyAdmin,
      canManageEmailSmtp: existingPerms.settings?.canManageEmailSmtp ?? isLegacyAdmin,
      canManageLiveChatSettings: existingPerms.settings?.canManageLiveChatSettings ?? isLegacyAdmin,
    },
  };
}

/**
 * Retorna os IDs dos funis autorizados para a sessão quando o grupo restringe por funil (`pipelineScope === "selected"`).
 * Retorna `null` quando o operador possui acesso a todos os funis da empresa (`pipelineScope !== "selected"`).
 */
export function getAllowedPipelineIds(session?: {
  permissions?: { crm?: Partial<CrmPermissions> } | null;
  operator?: { role?: string } | null;
} | null): string[] | null {
  const crm = session?.permissions?.crm;
  if (crm?.pipelineScope !== "selected") {
    return null;
  }
  const raw = crm.allowedPipelineIds;
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(
    new Set(
      raw
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );
}

/**
 * Verifica se um funil específico (`pipelineId`) está autorizado para o operador na sessão atual.
 */
export function isPipelineAllowed(
  session: {
    permissions?: { crm?: Partial<CrmPermissions> } | null;
    operator?: { role?: string } | null;
  } | null | undefined,
  pipelineId: string | null | undefined
): boolean {
  const allowed = getAllowedPipelineIds(session);
  if (allowed === null) return true;
  if (!pipelineId) return false;
  return allowed.includes(pipelineId.trim());
}

/**
 * Retorna os IDs das etapas visíveis de um funil para a sessão atual quando `stageRestrictionEnabled === true`
 * e o funil possui configuração explícita em `allowedStageIdsByPipeline`.
 * Retorna `null` quando todas as etapas do funil são visíveis.
 * Retorna `[]` quando o funil não é visível ou quando nenhuma etapa foi liberada para visualização.
 */
export function getVisibleStageIdsForPipeline(
  session: {
    permissions?: { crm?: Partial<CrmPermissions> } | null;
    operator?: { role?: string } | null;
  } | null | undefined,
  pipelineId: string | null | undefined
): string[] | null {
  if (!pipelineId) return [];
  const cleanPipelineId = pipelineId.trim();
  if (!isPipelineAllowed(session, cleanPipelineId)) {
    return [];
  }
  const crm = session?.permissions?.crm;
  if (crm?.stageRestrictionEnabled !== true) {
    return null;
  }
  const map = crm.allowedStageIdsByPipeline;
  if (!map || typeof map !== "object" || !Object.hasOwn(map, cleanPipelineId)) {
    return null;
  }
  const raw = map[cleanPipelineId];
  if (!Array.isArray(raw)) {
    return null;
  }
  return Array.from(
    new Set(
      raw
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );
}

/**
 * Retorna o mapa completo de restrições de etapas visíveis por funil quando `stageRestrictionEnabled === true`.
 * Retorna `null` quando não há restrição por etapa ativa na sessão.
 */
export function getAllowedStageIdsByPipelineMap(
  session: {
    permissions?: { crm?: Partial<CrmPermissions> } | null;
    operator?: { role?: string } | null;
  } | null | undefined
): Record<string, string[]> | null {
  const crm = session?.permissions?.crm;
  if (crm?.stageRestrictionEnabled !== true) return null;
  const map = crm.allowedStageIdsByPipeline;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const result: Record<string, string[]> = {};
  for (const [pipeId, list] of Object.entries(map)) {
    const cleanPipeId = pipeId.trim();
    if (!cleanPipeId || !Array.isArray(list)) continue;
    result[cleanPipeId] = Array.from(
      new Set(
        list
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean)
      )
    );
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Verifica se o operador na sessão atual tem visibilidade sobre uma etapa específica (`stageId`) de um funil (`pipelineId`).
 */
export function isStageVisibleToSession(
  session: {
    permissions?: { crm?: Partial<CrmPermissions> } | null;
    operator?: { role?: string } | null;
  } | null | undefined,
  pipelineId: string | null | undefined,
  stageId: string | null | undefined
): boolean {
  if (!pipelineId) return false;
  if (!isPipelineAllowed(session, pipelineId)) return false;
  if (!stageId) return true;
  const visibleStageIds = getVisibleStageIdsForPipeline(session, pipelineId);
  if (visibleStageIds === null) return true;
  return visibleStageIds.includes(stageId.trim());
}

/**
 * Verifica se o operador na sessão atual pode enviar/transferir um card para o funil/etapa de destino,
 * mesmo quando não possui visibilidade sobre a etapa ou funil de destino.
 */
export function canSendDealToTarget(
  session: {
    permissions?: { crm?: Partial<CrmPermissions> } | null;
    operator?: { role?: string } | null;
  } | null | undefined,
  targetPipelineId: string | null | undefined,
  targetStageId?: string | null
): boolean {
  if (!targetPipelineId) return false;
  const cleanPipelineId = targetPipelineId.trim();
  const crm = session?.permissions?.crm;
  if (session?.operator?.role !== "admin" && !crm?.canMoveStages) {
    return false;
  }
  const pipelineVisible = isPipelineAllowed(session, cleanPipelineId);
  if (pipelineVisible) {
    const stageVisible = !targetStageId || isStageVisibleToSession(session, cleanPipelineId, targetStageId);
    if (stageVisible) return true;
    // Etapa oculta dentro de um funil visível: permitido quando canSendToHiddenStagesOrPipelines !== false (ou stageRestrictionEnabled ativo)
    return crm?.canSendToHiddenStagesOrPipelines !== false || crm?.stageRestrictionEnabled === true;
  }
  // Funil oculto (fora de allowedPipelineIds): permitido somente quando canSendToHiddenStagesOrPipelines === true
  if (crm?.canSendToHiddenStagesOrPipelines !== true) {
    return false;
  }
  if (Array.isArray(crm.transferTargetPipelineIds) && crm.transferTargetPipelineIds.length > 0) {
    return crm.transferTargetPipelineIds.includes(cleanPipelineId);
  }
  return true;
}

/**
 * Verifica se um conjunto de permissões ou papel de operador autoriza uma ação de CRM.
 */
export function hasCrmPermission(
  permissions: GroupPermissions | undefined | null,
  permission: keyof CrmPermissions,
  operatorRole?: string
): boolean {
  if (operatorRole === "admin") return true;
  if (!permissions?.crm) return false;
  return Boolean(permissions.crm[permission]);
}

/**
 * Validador para rotas de API do servidor. Retorna Response 403 se não autorizado, ou null se permitido.
 */
export function requireCrmPermission(
  session: { permissions?: GroupPermissions; operator: { role: string } },
  permission: keyof CrmPermissions
): Response | null {
  if (session.operator.role === "admin") return null;
  const crm = session.permissions?.crm;
  if (!crm || !crm[permission]) {
    return new Response(
      JSON.stringify({
        error: `Permissão insuficiente: seu perfil não possui autorização para '${permission}'.`,
        code: "FORBIDDEN",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  return null;
}
