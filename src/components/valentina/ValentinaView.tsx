// ══════════════════════════════════════════════════════════════════════════════
// 🤖 VALENTINA VIEW — Container principal do módulo de agentes IA
// Segue exatamente o padrão do MonitorView.tsx (shell, tabs, content)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from "react";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import {
  Bot,
  MessageCircle,
  UserPlus,
  Eye,
  ShoppingBag,
  Database,
  Shuffle,
  Power,
  Sparkles,
  Workflow,
  Loader2,
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
import { getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";
import { parseSdrTargetFromSearch, type SdrTargetLookup } from "@/lib/rodizio-external-links";

// ── Definição das tabs ──────────────────────────────────────────────────────

const allTabs: { id: ValentinaTab; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "sdr", label: "SDR", icon: UserPlus },
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
  const { canAccessValentinaTab } = usePermissions();
  const allowedTabs = allTabs.filter((tab) => canAccessValentinaTab(tab.id));
  const allowedTabIds = useMemo(() => allowedTabs.map((t) => t.id), [allowedTabs]);

  const [sdrTargetConversation, setSdrTargetConversation] = useState<SdrTargetLookup | null>(() =>
    typeof window !== "undefined" ? parseSdrTargetFromSearch(window.location.search) : null,
  );
  const [activeTab, setActiveTab] = useState<ValentinaTab>(() => {
    const fromSearch =
      typeof window !== "undefined" ? parseSdrTargetFromSearch(window.location.search) : null;
    if (fromSearch && allowedTabIds.includes("sdr")) {
      return "sdr";
    }
    return getInitialTabFromUrl("valentina", allowedTabs[0]?.id || "chat", allowedTabIds);
  });
  const [showMobileFeed, setShowMobileFeed] = useState(false);

  // Estado e Controle de SDR Triagem Automática (inicializado como null para não piscar "SDR Ativo")
  const [sdrEnabled, setSdrEnabled] = useState<boolean | null>(null);
  const [isSavingSdrConfig, setIsSavingSdrConfig] = useState(false);
  const [sdrFilterState, setSdrFilterState] = useState<SdrFilterState>(DEFAULT_SDR_FILTER_STATE);
  const [sdrViewMode, setSdrViewMode] = useState<SdrViewMode>(() =>
    typeof window !== "undefined" && parseSdrTargetFromSearch(window.location.search)
      ? "live"
      : "kanban",
  );
  const [sdrRefreshKey, setSdrRefreshKey] = useState(0);
  const [isSdrLoading, setIsSdrLoading] = useState(false);
  const [sdrSelectedInfo, setSdrSelectedInfo] = useState<{
    conversationId?: string;
    contactName?: string;
  }>({});
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  useEffect(() => {
    setSdrEnabled(null);
    setSdrSelectedInfo({});
  }, [tenant]);

  const handleToggleSdr = async () => {
    if (!isAdmin || sdrEnabled === null || isSavingSdrConfig) return;
    const nextState = !sdrEnabled;
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
      if (!allowedTabs.some((t) => t.id === "sdr")) return;
      setShowMobileFeed(false);
      setActiveTab("sdr");
      setSdrViewMode("live");
      if (detail?.conversationId) {
        setSdrTargetConversation({
          conversationId: String(detail.conversationId),
          leadName: detail.clientName ? String(detail.clientName) : undefined,
          ts: Date.now(),
        });
      }
    };
    window.addEventListener("sdr_approval_open", handleApprovalOpen);
    return () => window.removeEventListener("sdr_approval_open", handleApprovalOpen);
  }, [allowedTabs]);

  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  const sdrToggleTooltip = !isAdmin
    ? "Apenas administradores podem ativar ou pausar o SDR globalmente"
    : sdrEnabled === null
      ? "Carregando estado atual do SDR..."
      : sdrEnabled
        ? `Clique para pausar ${persona.gender === "female" ? "a" : "o"} ${persona.name} globalmente`
        : `Clique para ativar ${persona.gender === "female" ? "a" : "o"} ${persona.name} globalmente`;

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-line shrink-0 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-extrabold text-foreground flex items-center gap-2">
              <Bot className="h-4.5 w-4.5 text-primary" />
              {persona.name}
            </h1>
            <p className="text-[11px] text-muted-foreground capitalize mt-0.5">{today}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {activeTab === "sdr" && (
            <div className="flex items-center gap-2 animate-fadeIn flex-wrap">
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

              <SdrHeaderControls
                filterState={sdrFilterState}
                onFilterChange={setSdrFilterState}
                viewMode={sdrViewMode}
                onViewModeChange={setSdrViewMode}
                onRefresh={() => setSdrRefreshKey((k) => k + 1)}
                isLoading={isSdrLoading}
                personaName={persona.name}
                showTriageHistory={persona.triagePolicy === "industrial"}
                tenantId={tenant || undefined}
                selectedConversationId={sdrSelectedInfo.conversationId}
                selectedConversationName={sdrSelectedInfo.contactName}
                onSelectConversationFromSweep={(conversationId) => {
                  setSdrTargetConversation({
                    conversationId,
                    ts: Date.now(),
                  });
                  setSdrViewMode("live");
                }}
                onOpenChatFromSweep={(conversationId) => {
                  setSelectedChatId(conversationId);
                  setActiveView("chat");
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Internal Tab Bar */}
      <div className="flex items-center gap-1 px-3 md:px-5 py-2 md:py-2.5 border-b border-line bg-muted/30 shrink-0 overflow-x-auto scrollbar-none">
        {allowedTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = !showMobileFeed && activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
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
            </button>
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
            : activeTab === "sdr"
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
                    sdrEnabled={sdrEnabled ?? false}
                    onSdrConfigChange={setSdrEnabled}
                    filterState={sdrFilterState}
                    onFilterChange={setSdrFilterState}
                    viewMode={sdrViewMode}
                    onViewModeChange={setSdrViewMode}
                    refreshKey={sdrRefreshKey}
                    onLoadingChange={setIsSdrLoading}
                    onSelectedConversationChange={(conversationId, contactName) =>
                      setSdrSelectedInfo({ conversationId, contactName })
                    }
                    targetConversation={sdrTargetConversation}
                    onTargetConversationHandled={() => setSdrTargetConversation(null)}
                  />
                )}
                {activeTab === "rodizio" && (
                  <RodizioTab
                    onOpenTriage={(conversationId, leadName) => {
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
    </div>
  );
}
