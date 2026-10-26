// ══════════════════════════════════════════════════════════════════════════════
// 🤖 VALENTINA VIEW — Container principal do módulo de agentes IA
// Segue exatamente o padrão do MonitorView.tsx (shell, tabs, content)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { Bot, MessageCircle, UserPlus, Eye, ShoppingBag, Database, Shuffle, Power, Sparkles } from "lucide-react";
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
import { SdrFilterState, DEFAULT_SDR_FILTER_STATE } from "./sdr-kanban-data";
import { SystemTooltip } from "@/components/ui/tooltip";
import { usePermissions } from "@/hooks/usePermissions";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { ValentinaFeed } from "@/components/mobile/ValentinaFeed";
import { Workflow } from "lucide-react";
import { toast } from "sonner";

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

import { getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";

export function ValentinaView() {
  const { tenant, setActiveView, setSelectedChatId } = useChat();
  const persona = getAiPersona(tenant || "valem");
  const { canAccessValentinaTab } = usePermissions();
  const allowedTabs = allTabs.filter(tab => canAccessValentinaTab(tab.id));
  const allowedTabIds = useMemo(() => allowedTabs.map((t) => t.id), [allowedTabs]);
  const [activeTab, setActiveTab] = useState<ValentinaTab>(() =>
    getInitialTabFromUrl("valentina", allowedTabs[0]?.id || "chat", allowedTabIds),
  );
  const [showMobileFeed, setShowMobileFeed] = useState(false);

  // Estado e Controle de SDR Triagem Automática (elevado ao Header para maximizar espaço de tela)
  const [sdrEnabled, setSdrEnabled] = useState(true);
  const [isSavingSdrConfig, setIsSavingSdrConfig] = useState(false);
  const [sdrFilterState, setSdrFilterState] = useState<SdrFilterState>(DEFAULT_SDR_FILTER_STATE);
  const [sdrRefreshKey, setSdrRefreshKey] = useState(0);
  const [isSdrLoading, setIsSdrLoading] = useState(false);
  const [sdrSelectedConversationId, setSdrSelectedConversationId] = useState<string | undefined>(undefined);
  const [sdrTargetConversation, setSdrTargetConversation] = useState<{
    conversationId: string;
    leadName?: string;
    ts: number;
  } | null>(null);
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  useEffect(() => {
    if (!canAccessValentinaTab("sdr")) return;
    async function loadSdrConfig() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/valentina/sdr?tenantId=${tenant || "valem"}`);
        if (res.ok) {
          const data = await res.json();
          if (data.config) {
            setSdrEnabled(Boolean(data.config.enabled));
          }
        }
      } catch (e) {
        console.warn("[ValentinaView] Erro ao carregar status do SDR:", e);
      }
    }
    loadSdrConfig();
  }, [tenant, BACKEND_URL]);

  const handleToggleSdr = async () => {
    const nextState = !sdrEnabled;
    setSdrEnabled(nextState);
    setIsSavingSdrConfig(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant || "valem",
          enabled: nextState,
        }),
      });

      if (res.ok) {
        toast.success(
          nextState
            ? `SDR ${persona.name} ativado para todos os contatos!`
            : `SDR ${persona.name} pausado com sucesso!`
        );
      } else {
        setSdrEnabled(!nextState); // rollback
        toast.error("Erro ao alternar status do SDR.");
      }
    } catch (e) {
      console.error("Erro ao alternar status do SDR:", e);
      setSdrEnabled(!nextState); // rollback
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
    if (!allowedTabs.some(t => t.id === activeTab)) {
      if (allowedTabs.length > 0) {
        setActiveTab(allowedTabs[0].id);
      }
    }
  }, [allowedTabs, activeTab]);

  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

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

        <div className="flex items-center gap-2.5">
          {activeTab === "sdr" && (
            <div className="flex items-center gap-2 animate-fadeIn flex-wrap">
              <SystemTooltip
                content={
                  sdrEnabled
                    ? `Clique para pausar ${persona.gender === "female" ? "a" : "o"} ${persona.name} globalmente`
                    : `Clique para ativar ${persona.gender === "female" ? "a" : "o"} ${persona.name} globalmente`
                }
              >
                <button
                  onClick={handleToggleSdr}
                  disabled={isSavingSdrConfig}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1.5 cursor-pointer shadow-soft border ${
                    sdrEnabled
                      ? "bg-primary text-primary-foreground border-primary hover:bg-primary-hover"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  } ${isSavingSdrConfig ? "opacity-70 cursor-not-allowed" : ""}`}
                >
                  <Power className="h-3 w-3" />
                  <span>{sdrEnabled ? "SDR Ativo" : "SDR Inativo"}</span>
                </button>
              </SystemTooltip>

              {/* Controles de Busca, Filtros Avançados, Varredura, Histórico e notas e Atualizar */}
              <SdrHeaderControls
                filterState={sdrFilterState}
                onFilterChange={setSdrFilterState}
                onRefresh={() => setSdrRefreshKey((k) => k + 1)}
                isLoading={isSdrLoading}
                personaName={persona.name}
                onVarredura={() => {
                  toast.info(`Varredura ativa: ${persona.name} está monitorando 100% das mensagens recebidas.`);
                  setSdrRefreshKey((k) => k + 1);
                }}
                showTriageHistory={persona.triagePolicy === "industrial"}
                tenantId={tenant || "valem"}
                selectedConversationId={sdrSelectedConversationId}
              />

              <div className="h-4 w-px bg-border mx-0.5" />
            </div>
          )}

          <SystemTooltip content={`Serviço de inteligência artificial de ${persona.name} conectado e operando em tempo real`}>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary-soft text-primary text-[10px] font-extrabold cursor-default">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              Online
            </span>
          </SystemTooltip>
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
      <div className={`flex-1 overflow-hidden flex flex-col ${showMobileFeed || activeTab === "chat" ? "" : activeTab === "sdr" ? "px-2 md:px-4 py-2" : "px-3 md:px-5 py-3 md:py-4"}`}>
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
                    sdrEnabled={sdrEnabled}
                    onSdrConfigChange={setSdrEnabled}
                    filterState={sdrFilterState}
                    refreshKey={sdrRefreshKey}
                    onLoadingChange={setIsSdrLoading}
                    onSelectedConversationChange={setSdrSelectedConversationId}
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
