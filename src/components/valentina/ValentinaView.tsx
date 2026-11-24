// ══════════════════════════════════════════════════════════════════════════════
// 🤖 VALENTINA VIEW — Container principal do módulo de agentes IA
// Segue exatamente o padrão do MonitorView.tsx (shell, tabs, content)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import {
  Bot,
  MessageCircle,
  UserPlus,
  Globe,
  Eye,
  ShoppingBag,
  Database,
  Shuffle,
  Power,
  Sparkles,
  Workflow,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ValentinaTab } from "./valentina-mock-data";
import { ValentinaChatTab } from "./ValentinaChatTab";
import { SdrTab } from "./SdrTab";
import { RodizioTab } from "./RodizioTab";
import { FluxosTab } from "./FluxosTab";
import { SupervisorTab } from "./SupervisorTab";
import { VendedorTab } from "./VendedorTab";
import { KnowledgeTab } from "./KnowledgeTab";
import { SdrHeaderControls } from "./SdrHeaderControls";
import {
  SdrFilterState,
  DEFAULT_SDR_FILTER_STATE,
  SdrViewMode,
} from "./sdr-kanban-data";
import { SystemTooltip } from "@/components/ui/tooltip";
import { usePermissions } from "@/hooks/usePermissions";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { ValentinaFeed } from "@/components/mobile/ValentinaFeed";
import { toast } from "sonner";
import { buildAppRoutePath, getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";
import { AppNavLink } from "@/components/ui/AppNavLink";
import { parseSdrTargetFromSearch, type SdrTargetLookup } from "@/lib/rodizio-external-links";
import { isSiteConversationId } from "@/lib/livechat/site-channel-policy";

// ── Definição das tabs ──────────────────────────────────────────────────────

const allTabs: { id: ValentinaTab; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "sdr", label: "SDR", icon: UserPlus },
  { id: "site", label: "Site", icon: Globe },
  { id: "rodizio", label: "Rodízio", icon: Shuffle },
  { id: "fluxos", label: "Fluxos", icon: Workflow },
  { id: "supervisor", label: "Supervisor", icon: Eye },
  { id: "vendedor", label: "Vendedor", icon: ShoppingBag },
  { id: "knowledge", label: "Base de Conhecimento", icon: Database },
];

// ── Componente principal ────────────────────────────────────────────────────

export function ValentinaView() {
  const { tenant, sessionRole, setActiveView, setSelectedChatId } = useChat();
  const isAdmin = sessionRole === "admin";
  const persona = getAiPersona(tenant || "");
  const isIndustrial = persona.triagePolicy === "industrial";
  const { canAccessValentinaTab } = usePermissions();
  const allowedTabIdsKey = allTabs
    .filter((tab) => {
      if (tab.id === "site" && !isIndustrial) return false;
      return canAccessValentinaTab(tab.id);
    })
    .map((t) => t.id)
    .join(",");
  const allowedTabs = useMemo(() => {
    const allowedSet = new Set(allowedTabIdsKey ? allowedTabIdsKey.split(",") : []);
    return allTabs.filter((tab) => allowedSet.has(tab.id));
  }, [allowedTabIdsKey]);
  const allowedTabIds = useMemo(() => allowedTabs.map((t) => t.id), [allowedTabs]);

  const initialSearchTarget =
    typeof window !== "undefined" ? parseSdrTargetFromSearch(window.location.search) : null;
  const initialTargetIsSite = Boolean(
    initialSearchTarget &&
      isSiteConversationId(initialSearchTarget.conversationId) &&
      allowedTabIds.includes("site"),
  );

  const [sdrTargetConversation, setSdrTargetConversation] = useState<SdrTargetLookup | null>(() =>
    initialSearchTarget && !initialTargetIsSite ? initialSearchTarget : null,
  );
  const [siteTargetConversation, setSiteTargetConversation] = useState<SdrTargetLookup | null>(() =>
    initialSearchTarget && initialTargetIsSite ? initialSearchTarget : null,
  );
  const [activeTab, setActiveTab] = useState<ValentinaTab>(() => {
    if (initialSearchTarget) {
      if (initialTargetIsSite) return "site";
      if (allowedTabIds.includes("sdr")) return "sdr";
    }
    return getInitialTabFromUrl("valentina", allowedTabs[0]?.id || "chat", allowedTabIds);
  });
  const [showMobileFeed, setShowMobileFeed] = useState(false);

  // Estado e Controle de SDR Triagem Automática (inicializado como null para não piscar "SDR Ativo")
  const [sdrEnabled, setSdrEnabled] = useState<boolean | null>(null);
  const [isSavingSdrConfig, setIsSavingSdrConfig] = useState(false);
  const [showDisableSdrConfirm, setShowDisableSdrConfirm] = useState(false);
  const [sdrFilterState, setSdrFilterState] = useState<SdrFilterState>(DEFAULT_SDR_FILTER_STATE);
  const [sdrViewMode, setSdrViewMode] = useState<SdrViewMode>(() =>
    initialSearchTarget && !initialTargetIsSite ? "live" : "kanban",
  );
  const [sdrRefreshKey, setSdrRefreshKey] = useState(0);
  const [isSdrLoading, setIsSdrLoading] = useState(false);
  const [sdrSelectedInfo, setSdrSelectedInfo] = useState<{
    conversationId?: string;
    contactName?: string;
  }>({});

  // Estado e Controle independente da aba Site (apenas clientes do site `conv-lc-*`)
  const [siteChannelEnabled, setSiteChannelEnabled] = useState<boolean | null>(null);
  const [siteChannelMeta, setSiteChannelMeta] = useState<{
    allowedOrigins: string[];
    whatsappNumber: string;
  } | null>(null);
  const [isSavingSiteChannel, setIsSavingSiteChannel] = useState(false);
  const [showDisableSiteConfirm, setShowDisableSiteConfirm] = useState(false);
  const [siteFilterState, setSiteFilterState] = useState<SdrFilterState>(DEFAULT_SDR_FILTER_STATE);
  const [siteViewMode, setSiteViewMode] = useState<SdrViewMode>(() =>
    initialTargetIsSite ? "live" : "kanban",
  );
  const [siteRefreshKey, setSiteRefreshKey] = useState(0);
  const [isSiteLoading, setIsSiteLoading] = useState(false);
  const [siteSelectedInfo, setSiteSelectedInfo] = useState<{
    conversationId?: string;
    contactName?: string;
  }>({});
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  useEffect(() => {
    setSdrEnabled(null);
    setSdrSelectedInfo({});
    setSiteChannelEnabled(null);
    setSiteChannelMeta(null);
    setSiteSelectedInfo({});
  }, [tenant]);

  // Carrega metadados do canal do Site (origens e WhatsApp de continuidade) para permitir toggle seguro pelo admin
  useEffect(() => {
    if (!tenant || !isIndustrial || !isAdmin) return;
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/valentina/site-channel`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setSiteChannelEnabled(Boolean(data.siteChannelEnabled));
        setSiteChannelMeta({
          allowedOrigins: Array.isArray(data.siteAllowedOrigins) ? data.siteAllowedOrigins : [],
          whatsappNumber: typeof data.siteWhatsappNumber === "string" ? data.siteWhatsappNumber : "",
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tenant, isIndustrial, isAdmin, BACKEND_URL]);

  const executeToggleSiteChannel = async (nextState: boolean) => {
    if (!isAdmin || !isIndustrial || siteChannelEnabled === null || isSavingSiteChannel) return;
    setSiteChannelEnabled(nextState);
    setIsSavingSiteChannel(true);
    try {
      let meta = siteChannelMeta;
      if (!meta) {
        const metaRes = await fetch(`${BACKEND_URL}/api/valentina/site-channel`);
        if (metaRes.ok) {
          const metaData = await metaRes.json();
          meta = {
            allowedOrigins: Array.isArray(metaData.siteAllowedOrigins)
              ? metaData.siteAllowedOrigins
              : [],
            whatsappNumber:
              typeof metaData.siteWhatsappNumber === "string" ? metaData.siteWhatsappNumber : "",
          };
          setSiteChannelMeta(meta);
        }
      }
      if (!meta) {
        setSiteChannelEnabled(!nextState);
        toast.error("Não foi possível carregar as origens autorizadas do Site.");
        return;
      }

      const res = await fetch(`${BACKEND_URL}/api/valentina/site-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteChannelEnabled: nextState,
          siteAllowedOrigins: meta.allowedOrigins,
          siteWhatsappNumber: meta.whatsappNumber,
        }),
      });

      if (res.ok) {
        toast.success(
          nextState
            ? `Atendimento do ${persona.name} no Site ativado!`
            : `Atendimento do ${persona.name} no Site pausado com sucesso!`,
        );
        setSiteRefreshKey((prev) => prev + 1);
      } else {
        const err = await res.json().catch(() => ({}));
        setSiteChannelEnabled(!nextState);
        toast.error(err.error || "Erro ao alternar status do canal Site.");
      }
    } catch (e) {
      console.error("Erro ao alternar status do canal Site:", e);
      setSiteChannelEnabled(!nextState);
      toast.error("Erro de comunicação com o servidor.");
    } finally {
      setIsSavingSiteChannel(false);
    }
  };

  const handleToggleSiteChannel = () => {
    if (!isAdmin || !isIndustrial || siteChannelEnabled === null || isSavingSiteChannel) return;
    if (siteChannelEnabled === true) {
      setShowDisableSiteConfirm(true);
      return;
    }
    void executeToggleSiteChannel(true);
  };

  const executeToggleSdr = async (nextState: boolean) => {
    if (!isAdmin || sdrEnabled === null || isSavingSdrConfig) return;
    setSdrEnabled(nextState);
    setIsSavingSdrConfig(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: nextState,
        }),
      });

      if (res.ok) {
        toast.success(
          nextState
            ? `SDR ${persona.name} ativado para todos os contatos!`
            : `SDR ${persona.name} pausado com sucesso!`,
        );
        if (nextState) {
          setSdrRefreshKey((prev) => prev + 1);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setSdrEnabled(!nextState);
        toast.error(err.error || "Erro ao alternar status do SDR.");
      }
    } catch (e) {
      console.error("Erro ao alternar status do SDR:", e);
      setSdrEnabled(!nextState);
      toast.error("Erro de comunicação com o servidor.");
    } finally {
      setIsSavingSdrConfig(false);
    }
  };

  const handleToggleSdr = () => {
    if (!isAdmin || sdrEnabled === null || isSavingSdrConfig) return;
    if (sdrEnabled === true) {
      // Exige confirmação explícita antes de desativar para evitar cliques acidentais
      setShowDisableSdrConfirm(true);
      return;
    }
    void executeToggleSdr(true);
  };

  useTabNavigation({
    tabs: allowedTabIds,
    activeTab,
    onChange: setActiveTab,
  });

  useSyncModuleTabWithUrl({
    viewId: "valentina",
    activeTab,
    setActiveTab,
    allowedTabs: allowedTabIds,
  });

  useEffect(() => {
    if (!allowedTabs.some((t) => t.id === activeTab)) {
      if (allowedTabs.length > 0) {
        setActiveTab(allowedTabs[0].id);
      }
    }
  }, [allowedTabs, activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleApprovalOpen = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      const targetConvId = detail?.conversationId ? String(detail.conversationId) : "";
      const routeToSite =
        Boolean(targetConvId) &&
        isSiteConversationId(targetConvId) &&
        allowedTabs.some((t) => t.id === "site");
      if (!routeToSite && !allowedTabs.some((t) => t.id === "sdr")) return;
      setShowMobileFeed(false);
      if (routeToSite) {
        setActiveTab("site");
        setSiteViewMode("live");
        setSiteTargetConversation({
          conversationId: targetConvId,
          leadName: detail.clientName ? String(detail.clientName) : undefined,
          ts: Date.now(),
        });
      } else {
        setActiveTab("sdr");
        setSdrViewMode("live");
        if (targetConvId) {
          setSdrTargetConversation({
            conversationId: targetConvId,
            leadName: detail.clientName ? String(detail.clientName) : undefined,
            ts: Date.now(),
          });
        }
      }
    };
    window.addEventListener("sdr_approval_open", handleApprovalOpen);
    return () => window.removeEventListener("sdr_approval_open", handleApprovalOpen);
  }, [allowedTabs]);

  const handleSelectedConversationChange = useCallback(
    (conversationId: string | undefined, contactName?: string) => {
      setSdrSelectedInfo((prev) =>
        prev.conversationId === conversationId && prev.contactName === contactName
          ? prev
          : { conversationId, contactName },
      );
    },
    [],
  );

  const handleSiteSelectedConversationChange = useCallback(
    (conversationId: string | undefined, contactName?: string) => {
      setSiteSelectedInfo((prev) =>
        prev.conversationId === conversationId && prev.contactName === contactName
          ? prev
          : { conversationId, contactName },
      );
    },
    [],
  );

  const handleTargetConversationHandled = useCallback(() => {
    setSdrTargetConversation(null);
  }, []);

  const handleSiteTargetConversationHandled = useCallback(() => {
    setSiteTargetConversation(null);
  }, []);

  const handleRefreshSdr = useCallback(() => {
    setSdrRefreshKey((k) => k + 1);
  }, []);

  const handleRefreshSite = useCallback(() => {
    setSiteRefreshKey((k) => k + 1);
  }, []);

  const handleSelectConversationFromSweep = useCallback((conversationId: string) => {
    setSdrTargetConversation({
      conversationId,
      ts: Date.now(),
    });
    setSdrViewMode("live");
  }, []);

  const handleSelectSiteConversationFromSweep = useCallback((conversationId: string) => {
    setSiteTargetConversation({
      conversationId,
      ts: Date.now(),
    });
    setSiteViewMode("live");
  }, []);

  const handleOpenChatFromSweep = useCallback(
    (conversationId: string) => {
      setSelectedChatId(conversationId);
      setActiveView("chat");
    },
    [setSelectedChatId, setActiveView],
  );

  const today = useMemo(
    () =>
      new Date().toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      }),
    [],
  );

  const sdrToggleTooltip = !isAdmin
    ? "Apenas administradores podem ativar ou pausar o SDR globalmente"
    : sdrEnabled === null
      ? "Carregando estado atual do SDR..."
      : sdrEnabled
        ? `Clique para pausar ${persona.gender === "female" ? "a" : "o"} ${persona.name} globalmente`
        : `Clique para ativar ${persona.gender === "female" ? "a" : "o"} ${persona.name} globalmente`;

  const siteToggleTooltip = !isAdmin
    ? "Apenas administradores podem ativar ou pausar o atendimento do Site"
    : siteChannelEnabled === null
      ? "Carregando estado atual do canal Site..."
      : siteChannelEnabled
        ? `Clique para pausar o atendimento do ${persona.name} no Site (não afeta o WhatsApp)`
        : `Clique para ativar o atendimento do ${persona.name} no Site`;

  return (
    <div className="flex flex-col h-full bg-card rounded-2xl md:rounded-3xl border border-border shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between px-3.5 py-2.5 md:px-6 md:py-3.5 border-b border-line shrink-0 gap-2 md:gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm md:text-base font-extrabold text-foreground flex items-center gap-2 truncate">
              <Bot className="h-4 w-4 md:h-4.5 md:w-4.5 text-primary shrink-0" />
              <span className="truncate">{persona.name}</span>
            </h1>
            <p className="hidden sm:block text-[11px] text-muted-foreground capitalize mt-0.5">
              {today}
            </p>
          </div>

          {activeTab === "sdr" && (
            <div className="md:hidden shrink-0">
              <SystemTooltip content={sdrToggleTooltip}>
                <button
                  type="button"
                  onClick={handleToggleSdr}
                  disabled={!isAdmin || sdrEnabled === null || isSavingSdrConfig}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1.5 shadow-soft border ${
                    sdrEnabled === true
                      ? "bg-primary text-primary-foreground border-primary hover:bg-primary-hover"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  } ${
                    !isAdmin || sdrEnabled === null || isSavingSdrConfig
                      ? "opacity-70 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  {sdrEnabled === null || isSavingSdrConfig ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Power className="h-3 w-3" />
                  )}
                  <span>
                    {sdrEnabled === null
                      ? "Carregando..."
                      : sdrEnabled
                        ? "SDR Ativo"
                        : "SDR Inativo"}
                  </span>
                </button>
              </SystemTooltip>
            </div>
          )}

          {activeTab === "site" && (
            <div className="md:hidden shrink-0">
              <SystemTooltip content={siteToggleTooltip}>
                <button
                  type="button"
                  onClick={handleToggleSiteChannel}
                  disabled={!isAdmin || siteChannelEnabled === null || isSavingSiteChannel}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1.5 shadow-soft border ${
                    siteChannelEnabled === true
                      ? "bg-primary text-primary-foreground border-primary hover:bg-primary-hover"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  } ${
                    !isAdmin || siteChannelEnabled === null || isSavingSiteChannel
                      ? "opacity-70 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  {siteChannelEnabled === null || isSavingSiteChannel ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Globe className="h-3 w-3" />
                  )}
                  <span>
                    {siteChannelEnabled === null
                      ? "Carregando..."
                      : siteChannelEnabled
                        ? "Site Ativo"
                        : "Site Inativo"}
                  </span>
                </button>
              </SystemTooltip>
            </div>
          )}
        </div>

        {activeTab === "sdr" && (
          <div className="flex items-center gap-2 md:gap-2.5 flex-wrap w-full md:w-auto animate-fadeIn">
            <div className="hidden md:block">
              <SystemTooltip content={sdrToggleTooltip}>
                <button
                  type="button"
                  onClick={handleToggleSdr}
                  disabled={!isAdmin || sdrEnabled === null || isSavingSdrConfig}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1.5 shadow-soft border ${
                    sdrEnabled === true
                      ? "bg-primary text-primary-foreground border-primary hover:bg-primary-hover"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  } ${
                    !isAdmin || sdrEnabled === null || isSavingSdrConfig
                      ? "opacity-70 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  {sdrEnabled === null || isSavingSdrConfig ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Power className="h-3 w-3" />
                  )}
                  <span>
                    {sdrEnabled === null
                      ? "Carregando..."
                      : sdrEnabled
                        ? "SDR Ativo"
                        : "SDR Inativo"}
                  </span>
                </button>
              </SystemTooltip>
            </div>

            <SdrHeaderControls
              filterState={sdrFilterState}
              onFilterChange={setSdrFilterState}
              viewMode={sdrViewMode}
              onViewModeChange={setSdrViewMode}
              onRefresh={handleRefreshSdr}
              isLoading={isSdrLoading}
              personaName={persona.name}
              channelScope={isIndustrial ? "whatsapp" : undefined}
              showTriageHistory={isIndustrial}
              tenantId={tenant || undefined}
              selectedConversationId={sdrSelectedInfo.conversationId}
              selectedConversationName={sdrSelectedInfo.contactName}
              onSelectConversationFromSweep={handleSelectConversationFromSweep}
              onOpenChatFromSweep={handleOpenChatFromSweep}
            />
          </div>
        )}

        {activeTab === "site" && (
          <div className="flex items-center gap-2 md:gap-2.5 flex-wrap w-full md:w-auto animate-fadeIn">
            <div className="hidden md:block">
              <SystemTooltip content={siteToggleTooltip}>
                <button
                  type="button"
                  onClick={handleToggleSiteChannel}
                  disabled={!isAdmin || siteChannelEnabled === null || isSavingSiteChannel}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1.5 shadow-soft border ${
                    siteChannelEnabled === true
                      ? "bg-primary text-primary-foreground border-primary hover:bg-primary-hover"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  } ${
                    !isAdmin || siteChannelEnabled === null || isSavingSiteChannel
                      ? "opacity-70 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  {siteChannelEnabled === null || isSavingSiteChannel ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Globe className="h-3 w-3" />
                  )}
                  <span>
                    {siteChannelEnabled === null
                      ? "Carregando..."
                      : siteChannelEnabled
                        ? "Site Ativo"
                        : "Site Inativo"}
                  </span>
                </button>
              </SystemTooltip>
            </div>

            <SdrHeaderControls
              filterState={siteFilterState}
              onFilterChange={setSiteFilterState}
              viewMode={siteViewMode}
              onViewModeChange={setSiteViewMode}
              onRefresh={handleRefreshSite}
              isLoading={isSiteLoading}
              personaName={persona.name}
              channelScope="site"
              showTriageHistory={isIndustrial}
              tenantId={tenant || undefined}
              selectedConversationId={siteSelectedInfo.conversationId}
              selectedConversationName={siteSelectedInfo.contactName}
              onSelectConversationFromSweep={handleSelectSiteConversationFromSweep}
              onOpenChatFromSweep={handleOpenChatFromSweep}
            />
          </div>
        )}
      </div>

      {/* Internal Tab Bar */}
      <div className="flex items-center gap-1 px-3 md:px-5 py-2 md:py-2.5 border-b border-line bg-muted/30 shrink-0 overflow-x-auto scrollbar-none">
        {allowedTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = !showMobileFeed && activeTab === tab.id;
          return (
            <AppNavLink
              key={tab.id}
              href={buildAppRoutePath("valentina", { tabId: tab.id })}
              onNavigate={() => {
                setShowMobileFeed(false);
                setActiveTab(tab.id);
              }}
              className={`relative flex items-center gap-1.5 px-3 md:px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {tab.label}
            </AppNavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setShowMobileFeed((prev) => !prev)}
          className={`md:hidden relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            showMobileFeed
              ? "bg-primary text-primary-foreground shadow-soft"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          Resumo Rápido
        </button>
      </div>

      {/* Tab Content */}
      <div
        className={`flex-1 overflow-hidden flex flex-col ${
          showMobileFeed || activeTab === "chat"
            ? ""
            : activeTab === "sdr" || activeTab === "site"
              ? "px-2 md:px-4 py-2.5"
              : "px-3 md:px-5 py-3 md:py-4"
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={showMobileFeed ? "mobile-feed" : activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col flex-1 overflow-hidden"
          >
            {showMobileFeed ? (
              <div className="flex-1 overflow-y-auto">
                <ValentinaFeed
                  onOpenChat={(id) => {
                    setSelectedChatId(id);
                    setActiveView("chat");
                  }}
                />
              </div>
            ) : (
              <>
                {activeTab === "chat" && <ValentinaChatTab />}
                {activeTab === "sdr" && (
                  <SdrTab
                    key="sdr-whatsapp"
                    channelScope={isIndustrial ? "whatsapp" : undefined}
                    sdrEnabled={sdrEnabled ?? false}
                    onSdrConfigChange={setSdrEnabled}
                    onSiteChannelEnabledChange={setSiteChannelEnabled}
                    filterState={sdrFilterState}
                    onFilterChange={setSdrFilterState}
                    viewMode={sdrViewMode}
                    onViewModeChange={setSdrViewMode}
                    refreshKey={sdrRefreshKey}
                    onLoadingChange={setIsSdrLoading}
                    onSelectedConversationChange={handleSelectedConversationChange}
                    targetConversation={sdrTargetConversation}
                    onTargetConversationHandled={handleTargetConversationHandled}
                  />
                )}
                {activeTab === "site" && (
                  <SdrTab
                    key="sdr-site"
                    channelScope="site"
                    sdrEnabled={siteChannelEnabled ?? false}
                    onSdrConfigChange={setSdrEnabled}
                    onSiteChannelEnabledChange={setSiteChannelEnabled}
                    filterState={siteFilterState}
                    onFilterChange={setSiteFilterState}
                    viewMode={siteViewMode}
                    onViewModeChange={setSiteViewMode}
                    refreshKey={siteRefreshKey}
                    onLoadingChange={setIsSiteLoading}
                    onSelectedConversationChange={handleSiteSelectedConversationChange}
                    targetConversation={siteTargetConversation}
                    onTargetConversationHandled={handleSiteTargetConversationHandled}
                  />
                )}
                {activeTab === "rodizio" && (
                  <RodizioTab
                    onOpenTriage={(conversationId, leadName) => {
                      if (
                        isSiteConversationId(conversationId) &&
                        allowedTabIds.includes("site")
                      ) {
                        setSiteTargetConversation({
                          conversationId,
                          leadName,
                          ts: Date.now(),
                        });
                        setSiteViewMode("live");
                        setActiveTab("site");
                        return;
                      }
                      setSdrTargetConversation({
                        conversationId,
                        leadName,
                        ts: Date.now(),
                      });
                      setSdrViewMode("live");
                      setActiveTab("sdr");
                    }}
                  />
                )}
                {activeTab === "fluxos" && <FluxosTab />}
                {activeTab === "supervisor" && <SupervisorTab />}
                {activeTab === "vendedor" && <VendedorTab />}
                {activeTab === "knowledge" && <KnowledgeTab />}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Modal de confirmação antes de desativar o SDR global (proteção contra clique acidental) */}
      <AnimatePresence>
        {showDisableSdrConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setShowDisableSdrConfirm(false)}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.16 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-destructive/15 border border-destructive/25 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold text-foreground">
                    Tem certeza que deseja parar {persona.gender === "female" ? "a" : "o"} {persona.name} (SDR)?
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Ao desativar, {persona.gender === "female" ? "a" : "o"} {persona.name} deixará de atender novos contatos e as triagens abertas em automação serão interrompidas e encaminhadas para a fila humana.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowDisableSdrConfirm(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold border border-border bg-muted/40 text-foreground hover:bg-muted transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDisableSdrConfirm(false);
                    void executeToggleSdr(false);
                  }}
                  className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-destructive text-destructive-foreground hover:opacity-90 transition cursor-pointer shadow-soft"
                >
                  Sim, desativar SDR
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Modal de confirmação antes de desativar o atendimento do Site */}
      <AnimatePresence>
        {showDisableSiteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setShowDisableSiteConfirm(false)}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.16 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-destructive/15 border border-destructive/25 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold text-foreground">
                    Tem certeza que deseja pausar {persona.gender === "female" ? "a" : "o"} {persona.name} no Site?
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Ao desativar, o widget da loja virtual deixará de aceitar novos atendimentos pelo {persona.name}. O atendimento SDR no WhatsApp continuará funcionando normalmente.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowDisableSiteConfirm(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold border border-border bg-muted/40 text-foreground hover:bg-muted transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDisableSiteConfirm(false);
                    void executeToggleSiteChannel(false);
                  }}
                  className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-destructive text-destructive-foreground hover:opacity-90 transition cursor-pointer shadow-soft"
                >
                  Sim, desativar Site
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
