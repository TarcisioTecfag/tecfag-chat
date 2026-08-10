import React, { useState } from "react";
import { PhoneCall, History, Users, Megaphone, Settings } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardTab } from "./DashboardTab";
import { HistoricoTab } from "./HistoricoTab";
import { ClientesTab } from "./ClientesTab";
import { CampanhasTab } from "./CampanhasTab";
import { ConfiguracaoTab } from "./ConfiguracaoTab";

type VoiceTab = "dashboard" | "historico" | "clientes" | "campanhas" | "configuracao";

export function LigacoesView() {
  const [activeTab, setActiveTab] = useState<VoiceTab>("dashboard");

  const tabs = [
    { id: "dashboard", label: "Dashboard ao Vivo", icon: PhoneCall },
    { id: "historico", label: "Histórico & Transcrições", icon: History },
    { id: "clientes", label: "Base de Clientes", icon: Users },
    { id: "campanhas", label: "Campanhas em Massa", icon: Megaphone },
    { id: "configuracao", label: "Configurações", icon: Settings },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 overflow-hidden">
      {/* Header com Tabs */}
      <header className="h-16 shrink-0 border-b border-slate-800/80 px-6 flex items-center justify-between bg-slate-900/60 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <PhoneCall className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100">Módulo de Voz & Ligações</h1>
            <p className="text-[11px] text-slate-400">Gestão de chamadas telefônicas automatizadas com Valentina IA</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 p-1 rounded-xl">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as VoiceTab)}
                className={`relative px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-2 ${
                  isActive
                    ? "text-white font-semibold"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeVoiceTabIndicator"
                    className="absolute inset-0 bg-blue-600 rounded-lg shadow-sm"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>
      </header>

      {/* Conteúdo Principal da Tab Ativa */}
      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="h-full w-full"
          >
            {activeTab === "dashboard" && <DashboardTab />}
            {activeTab === "historico" && <HistoricoTab />}
            {activeTab === "clientes" && <ClientesTab />}
            {activeTab === "campanhas" && <CampanhasTab />}
            {activeTab === "configuracao" && <ConfiguracaoTab />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
