import React, { useState } from "react";
import { PhoneCall, CalendarDays, History, Users, Megaphone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardTab } from "./DashboardTab";
import { AgendaTab } from "./AgendaTab";
import { HistoricoTab } from "./HistoricoTab";
import { ClientesTab } from "./ClientesTab";
import { CampanhasTab } from "./CampanhasTab";

type VoiceTab = "dashboard" | "agenda" | "historico" | "clientes" | "campanhas";

export function LigacoesView() {
  const [activeTab, setActiveTab] = useState<VoiceTab>("dashboard");

  const tabs = [
    { id: "dashboard", label: "Dashboard ao Vivo", icon: PhoneCall },
    { id: "agenda", label: "Agenda", icon: CalendarDays },
    { id: "historico", label: "Histórico & Transcrições", icon: History },
    { id: "clientes", label: "Base de Clientes", icon: Users },
    { id: "campanhas", label: "Campanhas em Massa", icon: Megaphone },
  ];

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

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-primary/10 text-primary text-xs font-bold">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            Twilio Active
          </span>
        </div>
      </div>

      {/* Internal Tab Bar */}
      <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-border bg-muted/30 shrink-0">
        {tabs.map((tab) => {
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
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

