// ══════════════════════════════════════════════════════════════════════════════
// 🛡️ RBAC & PERMISSÕES GRANULARES — SISTEMA VALEM CHAT / TECFAG CHAT
// ══════════════════════════════════════════════════════════════════════════════

export type TenantId = "valem" | "tecfag";
export type ChannelId = "whatsapp" | "instagram" | "messenger" | "livechat";

export type ViewId =
  | "chat"
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

export type ValentinaTabId = "chat" | "sdr" | "rodizio" | "supervisor" | "vendedor" | "knowledge";
export type MonitorTabId = "live" | "alerts" | "operators" | "audits" | "tasks" | "site";
export type AnalyticsTabId = "overview" | "performance" | "sla" | "contacts" | "reports" | "costs";
export type SettingsTabId = "whatsapp" | "voz" | "rd" | "email" | "livechat";
export type LigacoesTabId = "dashboard" | "agenda" | "historico" | "clientes" | "campanhas" | "objetivos";

// ── 10 Blocos Estruturados de Permissão ─────────────────────────────────────

export interface ViewPermissions {
  chat: boolean;
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

export interface GroupPermissions {
  views: ViewPermissions;
  chat: ChatPermissions;
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

export function normalizeGroupPermissions(rawGroup: any): GroupPermissions {
  if (!rawGroup) return DEFAULT_ADMIN_PERMISSIONS;

  // Se já tiver o objeto permissions preenchido, faz merge com os defaults
  const existingPerms = rawGroup.permissions || {};
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

  return {
    views: {
      chat: existingPerms.views?.chat ?? baseFallback.views.chat,
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
