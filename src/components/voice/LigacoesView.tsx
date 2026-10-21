import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import {
  PhoneCall,
  CalendarDays,
  History,
  Users,
  Megaphone,
  Target,
  BarChart3,
  UserCheck,
  Headphones,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardTab } from "./DashboardTab";
import { AgendaTab } from "./AgendaTab";
import { HistoricoTab } from "./HistoricoTab";
import { ClientesTab } from "./ClientesTab";
import { CampanhasTab } from "./CampanhasTab";
import { ObjetivosTab } from "./ObjetivosTab";
import { TestCallButton } from "./TestCallButton";
import { VoiceScoreModule, type VoiceScoreScreen } from "./voice-score/VoiceScoreModule";
import { usePermissions } from "@/hooks/usePermissions";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";

type VoiceTab =
  | "voice_equipe"
  | "voice_vendedor"
  | "voice_ligacao"
  | "dashboard"
  | "agenda"
  | "historico"
  | "clientes"
  | "campanhas"
  | "objetivos";

const VOICE_SCORE_TABS: Array<{ id: VoiceTab; label: string; icon: React.ComponentType<{ className?: string }>; screen: VoiceScoreScreen }> = [
  { id: "voice_equipe", label: "Performance Comercial", icon: BarChart3, screen: "team" },
  { id: "voice_vendedor", label: "Por Vendedor", icon: UserCheck, screen: "seller" },
  { id: "voice_ligacao", label: "Análise da Ligação", icon: Headphones, screen: "call" },
];

import { getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";

export function LigacoesView() {
  const { canAccessLigacoesTab, canTriggerTestCall } = usePermissions();
  const { tenant } = useChat();
  const persona = getAiPersona(tenant || "valem");

  const aiVoiceTabs = useMemo(
    () => [
      { id: "dashboard" as const, label: "Dashboard ao Vivo", icon: PhoneCall },
      { id: "agenda" as const, label: "Agenda", icon: CalendarDays },
      { id: "historico" as const, label: "Histórico & Transcrições", icon: History },
      { id: "clientes" as const, label: "Base de Clientes", icon: Users },
      { id: "campanhas" as const, label: "Campanhas em Massa", icon: Megaphone },
      { id: "objetivos" as const, label: `Objetivos ${persona.gender === "M" ? "do" : "da"} ${persona.name}`, icon: Target },
    ],
    [persona.gender, persona.name]
  );

  const allowedVoiceScoreTabs = useMemo(
    () => VOICE_SCORE_TABS.filter((t) => canAccessLigacoesTab(t.id)),
    [canAccessLigacoesTab]
  );
  const allowedAiTabs = useMemo(
    () => aiVoiceTabs.filter((t) => canAccessLigacoesTab(t.id)),
    [aiVoiceTabs, canAccessLigacoesTab]
  );

  const allAllowedTabs = useMemo(
    () => [...allowedVoiceScoreTabs, ...allowedAiTabs],
    [allowedVoiceScoreTabs, allowedAiTabs]
  );
  const allowedTabIds = useMemo(() => allAllowedTabs.map((t) => t.id), [allAllowedTabs]);
  const [activeTab, setActiveTab] = useState<VoiceTab>(() =>
    getInitialTabFromUrl("ligacoes", allAllowedTabs[0]?.id || "voice_equipe", allowedTabIds),
  );

  useTabNavigation({
    tabs: allowedTabIds,
    activeTab,
    onChange: setActiveTab,
  });

  useSyncModuleTabWithUrl({
    viewId: "ligacoes",
    activeTab,
    setActiveTab,
    allowedTabs: allowedTabIds,
  });

  useEffect(() => {
    if (!allAllowedTabs.some((t) => t.id === activeTab)) {
      if (allAllowedTabs.length > 0) {
        setActiveTab(allAllowedTabs[0].id);
      }
    }
  }, [allAllowedTabs, activeTab]);

  const isVoiceScoreTab =
    activeTab === "voice_equipe" || activeTab === "voice_vendedor" || activeTab === "voice_ligacao";

  const activeVoiceScoreScreen: VoiceScoreScreen =
    activeTab === "voice_vendedor" ? "seller" : activeTab === "voice_ligacao" ? "call" : "team";

  const handleVoiceScoreScreenChange = useCallback((screen: VoiceScoreScreen) => {
    const nextTab: VoiceTab =
      screen === "seller" ? "voice_vendedor" : screen === "call" ? "voice_ligacao" : "voice_equipe";
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, []);

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-soft overflow-hidden">
      {/* Unified Top Tab Bar: Voice Score on the LEFT, Valentina/Fagner IA on the RIGHT */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30 shrink-0 overflow-x-auto">
        {/* Left side: Voice Score Tabs */}
        <div className="flex items-center gap-1.5 shrink-0">
          {allowedVoiceScoreTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-soft font-bold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Subtle divider when both groups are present */}
        {allowedVoiceScoreTabs.length > 0 && allowedAiTabs.length > 0 && (
          <div className="h-5 w-px bg-border shrink-0 mx-1" aria-hidden="true" />
        )}

        {/* Right side: Valentina / Fagner Ligações Tabs */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {allowedAiTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as VoiceTab)}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-soft font-bold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Contextual Header for Valentina / Fagner AI Voice Tabs */}
      {!isVoiceScoreTab && (
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-border shrink-0">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Atendimento Telefônico</span>
            <h1 className="text-xl font-extrabold text-foreground flex items-center gap-2 mt-0.5">
              <PhoneCall className="h-5 w-5 text-primary" />
              Módulo de Ligações ({persona.name})
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {canTriggerTestCall && <TestCallButton />}

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-primary/10 text-primary text-xs font-bold">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              Twilio Active
            </span>
          </div>
        </div>
      )}

      {/* Tab Content */}
      <div
        className={`flex-1 overflow-hidden flex flex-col ${
          isVoiceScoreTab ? "p-0 bg-background" : "p-6 bg-background/50"
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={isVoiceScoreTab ? "voice-score-suite" : activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col flex-1 overflow-hidden"
          >
            {isVoiceScoreTab && (
              <VoiceScoreModule
                activeScreen={activeVoiceScoreScreen}
                onScreenChange={handleVoiceScoreScreenChange}
              />
            )}
            {activeTab === "dashboard" && <DashboardTab />}
            {activeTab === "agenda" && <AgendaTab />}
            {activeTab === "historico" && <HistoricoTab />}
            {activeTab === "clientes" && <ClientesTab />}
            {activeTab === "campanhas" && <CampanhasTab />}
            {activeTab === "objetivos" && <ObjetivosTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}


