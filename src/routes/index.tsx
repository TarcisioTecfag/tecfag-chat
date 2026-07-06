import React, { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatList } from "@/components/chat/ChatList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SharedFiles } from "@/components/chat/SharedFiles";
import { SettingsView } from "@/components/chat/SettingsView";
import { ContactsView } from "@/components/chat/ContactsView";
import { WalletView } from "@/components/chat/WalletView";
import { GroupsView } from "@/components/chat/GroupsView";
import { ProfileModal } from "@/components/chat/ProfileModal";
import { MonitorView } from "@/components/chat/MonitorView";
import { AnalyticsView } from "@/components/chat/AnalyticsView";
import { useChat } from "@/hooks/useChatState";
import { Login } from "@/components/chat/Login";
import { motion, AnimatePresence } from "framer-motion";

export const Route = createFileRoute("/")({
  ssr: true,
  component: Index,
});

function Index() {
  const { tenant, activeView, rightSidebarOpen, isAuthenticated, isProfileModalOpen } = useChat();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null; // Retorna null no primeiro render para bater com o HTML vazio do servidor (ssr: false)
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  // Estilos de tema dinâmicos para harmonia de cores
  const themeStyles = tenant === "tecfag"
    ? ({
        "--primary": "#df3d3d", // Vermelho Tecfag
        "--primary-soft": "#fde8e8",
      } as React.CSSProperties)
    : ({
        "--primary": "#2dc4a0", // Verde Esmeralda Valem
        "--primary-soft": "#d8f1ea",
      } as React.CSSProperties);

  return (
    <div className="min-h-screen bg-background transition-colors duration-500 ease-in-out" style={themeStyles}>
      <div className="flex h-screen w-full gap-5 p-5 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 h-full overflow-hidden relative">
          <AnimatePresence mode="wait">
            {activeView === "chat" ? (
              <motion.div
                key="chat"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex flex-1 gap-5 h-full w-full overflow-hidden"
              >
                <ChatList />
                <ChatPanel />
                <AnimatePresence>
                  {rightSidebarOpen && (
                    <motion.div
                      key="shared-files"
                      initial={{ opacity: 0, x: 40, width: 0 }}
                      animate={{ opacity: 1, x: 0, width: "auto" }}
                      exit={{ opacity: 0, x: 40, width: 0 }}
                      transition={{ type: "spring", damping: 25, stiffness: 180 }}
                      className="h-full shrink-0 overflow-hidden"
                    >
                      <SharedFiles />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ) : activeView === "contacts" ? (
              <motion.div
                key="contacts"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full overflow-hidden"
              >
                <ContactsView />
              </motion.div>
            ) : activeView === "wallet" ? (
              <motion.div
                key="wallet"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full overflow-hidden"
              >
                <WalletView />
              </motion.div>
            ) : activeView === "groups" ? (
              <motion.div
                key="groups"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full overflow-hidden"
              >
                <GroupsView />
              </motion.div>
            ) : activeView === "monitor" ? (
              <motion.div
                key="monitor"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full overflow-hidden"
              >
                <MonitorView />
              </motion.div>
            ) : activeView === "analytics" ? (
              <motion.div
                key="analytics"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full overflow-hidden"
              >
                <AnalyticsView />
              </motion.div>
            ) : (
              <motion.div
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full overflow-hidden"
              >
                <SettingsView />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>
        {isProfileModalOpen && <ProfileModal />}
      </AnimatePresence>
    </div>
  );
}

