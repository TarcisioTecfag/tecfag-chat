import React, { Suspense, useEffect } from "react";
import { useChat } from "@/hooks/useChatState";
import { MobileBottomNav } from "./MobileBottomNav";
import { ChatList } from "@/components/chat/ChatList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SharedFiles } from "@/components/chat/SharedFiles";
import { motion, AnimatePresence } from "framer-motion";
import { BriefcaseBusiness, Loader2 } from "lucide-react";
import { lazyWithRetry } from "@/lib/lazy-retry";

const SettingsView = lazyWithRetry(() => import("@/components/chat/SettingsView"), "SettingsView");
const ContactsView = lazyWithRetry(() => import("@/components/chat/ContactsView"), "ContactsView");
const WalletView = lazyWithRetry(() => import("@/components/chat/WalletView"), "WalletView");
const GroupsView = lazyWithRetry(() => import("@/components/chat/GroupsView"), "GroupsView");
const MonitorView = lazyWithRetry(() => import("@/components/chat/MonitorView"), "MonitorView");
const AnalyticsView = lazyWithRetry(() => import("@/components/chat/AnalyticsView"), "AnalyticsView");
const TasksView = lazyWithRetry(() => import("@/components/chat/TasksView"), "TasksView");
const ValentinaView = lazyWithRetry(() => import("@/components/valentina/ValentinaView"), "ValentinaView");
const LigacoesView = lazyWithRetry(() => import("@/components/voice/LigacoesView"), "LigacoesView");
const CrmView = lazyWithRetry(() => import("@/components/crm/CrmView"), "CrmView");
const CommercialHomeView = lazyWithRetry(() => import("@/components/commercial/CommercialHomeView"), "CommercialHomeView");
const CommercialManagementView = lazyWithRetry(() => import("@/components/commercial/CommercialManagementView"), "CommercialManagementView");
const CommercialBiView = lazyWithRetry(() => import("@/components/commercial/CommercialBiView"), "CommercialBiView");

export const MobileLayout: React.FC = () => {
  const {
    tenant,
    activeView,
    selectedChatId,
    rightSidebarOpen,
    setRightSidebarOpen,
    isCommercialConsultant,
  } = useChat();

  const isInsideChat = activeView === "chat" && selectedChatId !== null;

  // No mobile, o painel lateral de informações do cliente (SharedFiles) inicia recolhido ao trocar de conversa
  useEffect(() => {
    setRightSidebarOpen(false);
  }, [selectedChatId, setRightSidebarOpen]);

  const viewKey = isInsideChat
    ? `chat-room-${selectedChatId}`
    : `view-${activeView}-${tenant}`;

  const renderMobileView = () => {
    if (activeView === "commercialHome") {
      if (tenant !== "tecfag" || !isCommercialConsultant) {
        return (
          <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center bg-background">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3 text-primary">
              <BriefcaseBusiness className="w-7 h-7" />
            </div>
            <h2 className="text-base font-bold font-mono text-foreground mb-1.5">
              Acesso Restrito a Consultores Comerciais
            </h2>
            <p className="text-xs text-muted-foreground max-w-xs">
              A tela de Início é exclusiva para consultores cadastrados e ativos no Gestão Comercial.
            </p>
          </div>
        );
      }
      return <CommercialHomeView />;
    }
    if (activeView === "commercialManagement" && tenant === "tecfag") {
      return <CommercialManagementView />;
    }
    if (activeView === "commercialBi" && tenant === "tecfag") {
      return <CommercialBiView />;
    }
    if (activeView === "chat") {
      if (selectedChatId) {
        return (
          <div className="relative flex flex-col h-full w-full min-h-0 overflow-hidden">
            <ChatPanel />
            <AnimatePresence>
              {rightSidebarOpen && selectedChatId !== "valentina" && (
                <motion.div
                  key="mobile-shared-files-drawer"
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="fixed inset-0 z-[70] bg-background p-2 flex flex-col overflow-hidden"
                >
                  <SharedFiles />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      }
      return (
        <div className="h-full w-full p-2 overflow-hidden flex flex-col">
          <ChatList />
        </div>
      );
    }
    if (activeView === "crm") {
      return (
        <div className="h-full w-full overflow-hidden flex flex-col">
          <CrmView />
        </div>
      );
    }
    if (activeView === "tasks") {
      return (
        <div className="h-full w-full p-2 overflow-hidden flex flex-col">
          <TasksView />
        </div>
      );
    }
    if (activeView === "contacts") {
      return (
        <div className="h-full w-full p-2 overflow-hidden flex flex-col">
          <ContactsView />
        </div>
      );
    }
    if (activeView === "wallet") {
      return (
        <div className="h-full w-full p-2 overflow-hidden flex flex-col">
          <WalletView />
        </div>
      );
    }
    if (activeView === "valentina") {
      return (
        <div className="h-full w-full p-2 overflow-hidden flex flex-col">
          <ValentinaView />
        </div>
      );
    }
    if (activeView === "ligacoes") {
      return (
        <div className="h-full w-full p-2 overflow-hidden flex flex-col">
          <LigacoesView />
        </div>
      );
    }
    if (activeView === "monitor") {
      return (
        <div className="h-full w-full p-2 overflow-hidden flex flex-col">
          <MonitorView />
        </div>
      );
    }
    if (activeView === "analytics") {
      return (
        <div className="h-full w-full p-2 overflow-hidden flex flex-col">
          <AnalyticsView />
        </div>
      );
    }
    if (activeView === "groups") {
      return (
        <div className="h-full w-full p-2 overflow-hidden flex flex-col">
          <GroupsView />
        </div>
      );
    }
    return (
      <div className="h-full w-full p-2 overflow-hidden flex flex-col">
        <SettingsView />
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full max-h-full w-full max-w-full bg-background text-foreground font-sans selection:bg-primary/20 relative overflow-hidden touch-manipulation">
      {/* Conteúdo Dinâmico com base na View Ativa */}
      <main
        className={`flex-1 min-h-0 w-full overflow-hidden ${
          isInsideChat ? "p-1.5" : "pb-16"
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={viewKey}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="h-full w-full overflow-hidden flex flex-col"
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-primary">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              }
            >
              {renderMobileView()}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Navegação Inferior Fixa */}
      <AnimatePresence>
        {!isInsideChat && (
          <motion.div
            key="mobile-bottom-nav"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.15 }}
          >
            <MobileBottomNav />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
