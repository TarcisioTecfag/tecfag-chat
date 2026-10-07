// ══════════════════════════════════════════════════════════════════════════════
// 🤖 VALENTINA VIEW — Container principal do módulo de agentes IA
// Segue exatamente o padrão do MonitorView.tsx (shell, tabs, content)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from "react";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { Bot, MessageCircle, UserPlus, Eye, ShoppingBag, Database, Shuffle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ValentinaTab } from "./valentina-mock-data";
import { ValentinaChatTab } from "./ValentinaChatTab";
import { SdrTab } from "./SdrTab";
import { RodizioTab } from "./RodizioTab";
import { SupervisorTab } from "./SupervisorTab";
import { VendedorTab } from "./VendedorTab";
import { KnowledgeTab } from "./KnowledgeTab";
import { usePermissions } from "@/hooks/usePermissions";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";

// ── Definição das tabs ──────────────────────────────────────────────────────

const allTabs: { id: ValentinaTab; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "sdr", label: "SDR", icon: UserPlus },
  { id: "rodizio", label: "Rodízio", icon: Shuffle },
  { id: "supervisor", label: "Supervisor", icon: Eye },
  { id: "vendedor", label: "Vendedor", icon: ShoppingBag },
  { id: "knowledge", label: "Base de Conhecimento", icon: Database },
];

// ── Componente principal ────────────────────────────────────────────────────

export function ValentinaView() {
  const { tenant } = useChat();
  const persona = getAiPersona(tenant || "valem");
  const { canAccessValentinaTab } = usePermissions();
  const allowedTabs = allTabs.filter(tab => canAccessValentinaTab(tab.id));
  const allowedTabIds = useMemo(() => allowedTabs.map((t) => t.id), [allowedTabs]);
  const [activeTab, setActiveTab] = useState<ValentinaTab>(() => allowedTabs[0]?.id || "chat");

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

  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
        <div>
          <h1 className="text-base font-extrabold text-foreground flex items-center gap-2">
            <Bot className="h-4.5 w-4.5 text-primary" />
            {persona.name}
          </h1>
          <p className="text-[11px] text-muted-foreground capitalize mt-0.5">{today}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary-soft text-primary text-[10px] font-extrabold">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Online
          </span>
        </div>
      </div>

      {/* Internal Tab Bar */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-line bg-muted/30 shrink-0">
        {allowedTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className={`flex-1 overflow-hidden flex flex-col ${activeTab !== "chat" ? "px-5 py-4" : ""}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col flex-1 overflow-hidden"
          >
            {activeTab === "chat" && <ValentinaChatTab />}
            {activeTab === "sdr" && <SdrTab />}
            {activeTab === "rodizio" && <RodizioTab />}
            {activeTab === "supervisor" && <SupervisorTab />}
            {activeTab === "vendedor" && <VendedorTab />}
            {activeTab === "knowledge" && <KnowledgeTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
