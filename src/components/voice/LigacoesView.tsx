import React, { useState, useEffect, useMemo } from "react";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { PhoneCall, CalendarDays, History, Users, Megaphone, Target } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardTab } from "./DashboardTab";
import { AgendaTab } from "./AgendaTab";
import { HistoricoTab } from "./HistoricoTab";
import { ClientesTab } from "./ClientesTab";
import { CampanhasTab } from "./CampanhasTab";
import { ObjetivosTab } from "./ObjetivosTab";
import { TestCallButton } from "./TestCallButton";
import { usePermissions } from "@/hooks/usePermissions";

type VoiceTab = "dashboard" | "agenda" | "historico" | "clientes" | "campanhas" | "objetivos";

export function LigacoesView() {
  const { canAccessLigacoesTab, canTriggerTestCall } = usePermissions();

  const allTabs = [
    { id: "dashboard" as const, label: "Dashboard ao Vivo", icon: PhoneCall },
    { id: "agenda" as const, label: "Agenda", icon: CalendarDays },
    { id: "historico" as const, label: "Histórico & Transcrições", icon: History },
    { id: "clientes" as const, label: "Base de Clientes", icon: Users },
    { id: "campanhas" as const, label: "Campanhas em Massa", icon: Megaphone },
    { id: "objetivos" as const, label: "Objetivos da Valentina", icon: Target },
  ];

  const allowedTabs = allTabs.filter(t => canAccessLigacoesTab(t.id));
  const allowedTabIds = useMemo(() => allowedTabs.map((t) => t.id), [allowedTabs]);
  const [activeTab, setActiveTab] = useState<VoiceTab>(() => allowedTabs[0]?.id || "dashboard");

  useTabNavigation({
    tabs: allowedTabIds,
    activeTab,
    onChange: setActiveTab,
  });

  useEffect(() => {
    if (!allowedTabs.some(t => t.id === activeTab)) {
      if (allowedTabs.length > 0) {
        setActiveTab(allowedTabs[0].id);
      }
    }
  }, [allowedTabs, activeTab]);

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Atendimento Telefônico</span>
          <h1 className="text-xl font-extrabold text-foreground flex items-center gap-2 mt-0.5">
            <PhoneCall className="h-5 w-5 text-primary" />
            Módulo de Ligações (Valentina)
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

      {/* Internal Tab Bar */}
      <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-border bg-muted/30 shrink-0">
        {allowedTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as VoiceTab)}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
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

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden p-6 flex flex-col bg-background/50">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col flex-1 overflow-hidden"
          >
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

