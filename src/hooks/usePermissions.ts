// ══════════════════════════════════════════════════════════════════════════════
// 🛡️ HOOK usePermissions — Acesso Reativo a Permissões no Frontend
// ══════════════════════════════════════════════════════════════════════════════

import { useMemo } from "react";
import { useChat } from "./useChatState";
import {
  GroupPermissions,
  ViewId,
  ValentinaTabId,
  MonitorTabId,
  AnalyticsTabId,
  SettingsTabId,
  LigacoesTabId,
  normalizeGroupPermissions,
} from "@/lib/rbac";

export function usePermissions() {
  const { currentGroup, operatorProfile, tenant } = useChat();

  // Proteção Master: Dono da conta / Suporte Tecfag nunca pode ser trancado fora das telas de gestão
  const isMasterAccount = Boolean(
    operatorProfile?.email?.toLowerCase() === "suporte2@tecfag.com.br" ||
    operatorProfile?.email?.toLowerCase().includes("admin@") ||
    operatorProfile?.name?.toLowerCase().includes("tarcisio")
  );

  const permissions: GroupPermissions = useMemo(() => {
    const norm = normalizeGroupPermissions(currentGroup);
    if (isMasterAccount) {
      return {
        ...norm,
        views: {
          ...norm.views,
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
        security: {
          ...norm.security,
          canManageUsers: true,
          canResetUserPasswords: true,
          canImpersonateUsers: true,
          canManageAccessGroups: true,
          canManageSectors: true,
          canManageWallets: true,
          canManageGlobalTemplates: true,
        },
        settings: {
          ...norm.settings,
          canManageWhatsapp: true,
          canManageVoiceSettings: true,
          canManageRdCrmSettings: true,
          canManageEmailSmtp: true,
          canManageLiveChatSettings: true,
        },
      };
    }
    return norm;
  }, [currentGroup, isMasterAccount]);

  // Checagem de Módulos (Menu Lateral)
  const canAccessView = (viewId: ViewId): boolean => {
    if (!permissions?.views) return true;
    return !!permissions.views[viewId];
  };

  // Checagem de Sub-abas da Valentina IA
  const canAccessValentinaTab = (tabId: ValentinaTabId): boolean => {
    if (!canAccessView("valentina")) return false;
    const v = permissions.valentina;
    if (!v) return true;
    switch (tabId) {
      case "chat": return v.canAccessChat;
      case "sdr": return v.canAccessSdr;
      case "rodizio": return v.canAccessRodizio;
      case "supervisor": return v.canAccessSupervisor;
      case "vendedor": return v.canAccessChat; // assistente do vendedor usa canAccessChat
      case "knowledge": return v.canAccessKnowledge;
      default: return true;
    }
  };

  // Checagem de Sub-abas do Monitoramento
  const canAccessMonitorTab = (tabId: MonitorTabId): boolean => {
    if (!canAccessView("monitor")) return false;
    const m = permissions.monitor;
    if (!m) return true;
    switch (tabId) {
      case "live": return m.canAccessLive;
      case "alerts": return m.canAccessAlerts;
      case "operators": return m.canAccessRanking;
      case "audits": return m.canAccessAudits;
      case "tasks": return m.canAccessTeamTasks;
      case "site": return m.canAccessSiteVisitors;
      default: return true;
    }
  };

  // Checagem de Sub-abas de Estatísticas / Analytics
  const canAccessAnalyticsTab = (tabId: AnalyticsTabId): boolean => {
    if (!canAccessView("analytics")) return false;
    const a = permissions.analytics;
    if (!a) return true;
    switch (tabId) {
      case "overview": return a.canAccessOverview;
      case "performance": return a.canAccessPerformance;
      case "sla": return a.canAccessSla;
      case "contacts": return a.canAccessContacts;
      case "reports": return a.canAccessAiReports;
      case "costs": return a.canAccessCosts;
      default: return true;
    }
  };

  // Checagem de Sub-abas de Ajustes / Configurações
  const canAccessSettingsTab = (tabId: SettingsTabId): boolean => {
    if (!canAccessView("settings")) return false;
    const s = permissions.settings;
    if (!s) return true;
    switch (tabId) {
      case "whatsapp": return s.canManageWhatsapp;
      case "voz": return s.canManageVoiceSettings;
      case "rd": return s.canManageRdCrmSettings;
      case "email": return s.canManageEmailSmtp;
      case "livechat": return s.canManageLiveChatSettings;
      default: return true;
    }
  };

  // Checagem de Sub-abas de Ligações / Voz
  const canAccessLigacoesTab = (tabId: LigacoesTabId): boolean => {
    if (!canAccessView("ligacoes")) return false;
    const l = permissions.ligacoes;
    if (!l) return true;
    switch (tabId) {
      case "dashboard": return l.canAccessDashboard;
      case "agenda": return l.canAccessAgenda;
      case "historico": return l.canAccessHistory;
      case "clientes": return true;
      case "campanhas": return l.canManageCampaigns;
      case "objetivos": return l.canManageObjectives;
      default: return true;
    }
  };

  return {
    permissions,
    canAccessView,
    canAccessValentinaTab,
    canAccessMonitorTab,
    canAccessAnalyticsTab,
    canAccessSettingsTab,
    canAccessLigacoesTab,

    // Atalhos diretos de Chat
    canCaptureChat: permissions.chat.canCaptureChat,
    canTransferChat: permissions.chat.canTransferChat,
    canFinishChat: permissions.chat.canFinishChat,
    canViewAllChats: permissions.chat.canViewAllChats,
    canOverrideChat: permissions.chat.canOverrideChat,
    canSendInternalNotes: permissions.chat.canSendInternalNotes,
    canEditClientInfo: permissions.chat.canEditClientInfo,
    canManageTags: permissions.chat.canManageTags,
    canManageRdCrm: permissions.chat.canManageRdCrm,
    canChangeWallet: permissions.chat.canChangeWallet,
    canChangeWalletOperator: permissions.chat.canChangeWallet,
    canDeleteMessages: permissions.chat.canDeleteMessages,

    // Atalhos de Contatos
    contactScope: permissions.contacts.contactScope,
    canCreateContact: permissions.contacts.canCreateContact,
    canEditContact: permissions.contacts.canEditContact,
    canDeleteContact: permissions.contacts.canDeleteContact,
    canExportContacts: permissions.contacts.canExportContacts,

    // Atalhos de Gestão de Usuários
    canManageUsers: permissions.security.canManageUsers,
    canResetUserPasswords: permissions.security.canResetUserPasswords,
    canImpersonateUsers: permissions.security.canImpersonateUsers,
    canManageAccessGroups: permissions.security.canManageAccessGroups,
    canManageSectors: permissions.security.canManageSectors,
    canManageWallets: permissions.security.canManageWallets,
    canManageGlobalTemplates: permissions.security.canManageGlobalTemplates,

    // Atalhos da Valentina
    canManageSdr: permissions.valentina.canManageSdr,
    canManageRodizio: permissions.valentina.canManageRodizio,
    canManageKnowledge: permissions.valentina.canManageKnowledge,

    // Atalhos de Ligações
    canTriggerTestCall: permissions.ligacoes.canTriggerTestCall,
    canManageCampaigns: permissions.ligacoes.canManageCampaigns,
    canManageObjectives: permissions.ligacoes.canManageObjectives,
  };
}
