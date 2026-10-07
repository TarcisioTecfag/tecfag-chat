import React, { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatList } from "@/components/chat/ChatList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SharedFiles } from "@/components/chat/SharedFiles";
import { useChat } from "@/hooks/useChatState";
import { Login } from "@/components/chat/Login";
import { motion, AnimatePresence } from "framer-motion";

import { useIsMobile } from "@/hooks/use-mobile";
import { MobileLayout } from "@/components/mobile/MobileLayout";
import { PushNotificationPrompt } from "@/components/chat/PushNotificationPrompt";
import { getChatLinkKey } from "@/lib/chat-link";
import { useGlobalKeyboardNavigation } from "@/hooks/useGlobalKeyboardNavigation";
import { usePermissions } from "@/hooks/usePermissions";
import { Loader2 } from "lucide-react";

const SettingsView = lazy(() => import("@/components/chat/SettingsView").then((module) => ({ default: module.SettingsView })));
const ContactsView = lazy(() => import("@/components/chat/ContactsView").then((module) => ({ default: module.ContactsView })));
const WalletView = lazy(() => import("@/components/chat/WalletView").then((module) => ({ default: module.WalletView })));
const GroupsView = lazy(() => import("@/components/chat/GroupsView").then((module) => ({ default: module.GroupsView })));
const ProfileModal = lazy(() => import("@/components/chat/ProfileModal").then((module) => ({ default: module.ProfileModal })));
const MonitorView = lazy(() => import("@/components/chat/MonitorView").then((module) => ({ default: module.MonitorView })));
const AnalyticsView = lazy(() => import("@/components/chat/AnalyticsView").then((module) => ({ default: module.AnalyticsView })));
const TasksView = lazy(() => import("@/components/chat/TasksView").then((module) => ({ default: module.TasksView })));
const ValentinaView = lazy(() => import("@/components/valentina/ValentinaView").then((module) => ({ default: module.ValentinaView })));
const LigacoesView = lazy(() => import("@/components/voice/LigacoesView").then((module) => ({ default: module.LigacoesView })));
const CrmView = lazy(() => import("@/components/crm/CrmView").then((module) => ({ default: module.CrmView })));
const CommercialHomeView = lazy(() => import("@/components/commercial/CommercialHomeView").then((module) => ({ default: module.CommercialHomeView })));
const CommercialManagementView = lazy(() => import("@/components/commercial/CommercialManagementView").then((module) => ({ default: module.CommercialManagementView })));
const CommercialBiView = lazy(() => import("@/components/commercial/CommercialBiView").then((module) => ({ default: module.CommercialBiView })));

function ViewFallback() {
  return <div className="flex h-full flex-1 items-center justify-center text-primary"><Loader2 className="h-6 w-6 animate-spin" /></div>;
}

const subscribeHydration = () => () => {};
const getClientMounted = () => true;
const getServerMounted = () => false;

export const Route = createFileRoute("/")({
  ssr: true,
  component: Index,
});

export function Index() {
  const { tenant, activeView, setActiveView, sessionRole, rightSidebarOpen, selectedChatId, isAuthenticated, isRestoringSession, isProfileModalOpen, activeChat, conversations } = useChat();
  const { canAccessView } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isMounted = useSyncExternalStore(subscribeHydration, getClientMounted, getServerMounted);

  useGlobalKeyboardNavigation({
    tenant,
    sessionRole,
    activeView,
    setActiveView,
    canAccessView,
    enabled: isAuthenticated && !isMobile,
  });

  useEffect(() => {
    if (location.pathname !== "/" || !isAuthenticated || activeView !== "chat" || !activeChat || activeChat.id === "valentina") return;
    navigate({ to: "/chat/$chatKey", params: { chatKey: getChatLinkKey(activeChat, conversations) }, replace: true });
  }, [activeChat, activeView, conversations, isAuthenticated, location.pathname, navigate]);

  if (!isMounted || isRestoringSession) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-primary"><Loader2 className="h-7 w-7 animate-spin" aria-label="Abrindo atendimento" /></div>;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  // Estilos de tema dinâmicos para harmonia de cores
  const themeStyles = tenant === "tecfag"
    ? ({
        "--primary": "#df3d3d", // Vermelho Tecfag
        "--primary-soft": "rgba(223, 61, 61, 0.15)",
      } as React.CSSProperties)
    : ({
        "--primary": "#2dc4a0", // Verde Esmeralda Valem
        "--primary-soft": "rgba(45, 196, 160, 0.15)",
      } as React.CSSProperties);

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background" style={themeStyles}>
        <MobileLayout />
        <AnimatePresence>
          {isProfileModalOpen && <ProfileModal />}
        </AnimatePresence>
        <PushNotificationPrompt />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-500 ease-in-out" style={themeStyles}>
      <div className={`flex h-screen w-full gap-5 ${activeView === "crm" ? "pl-5 pt-5 pb-0 pr-0" : "p-5"} overflow-hidden`}>
        <Sidebar />
        <div className="flex flex-1 h-full overflow-hidden relative">
          <Suspense fallback={<ViewFallback />}>
          <AnimatePresence mode="wait">
            {activeView === "commercialHome" && tenant === "tecfag" ? (
              <motion.div
                key="commercialHome"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full w-full overflow-hidden"
              >
                <CommercialHomeView />
              </motion.div>
            ) : activeView === "commercialManagement" && tenant === "tecfag" ? (
              <motion.div key="commercialManagement" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }} className="flex-1 h-full w-full overflow-hidden">
                <CommercialManagementView />
              </motion.div>
            ) : activeView === "commercialBi" && tenant === "tecfag" ? (
              <motion.div key="commercialBi" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }} className="flex-1 h-full w-full overflow-hidden">
                <CommercialBiView />
              </motion.div>
            ) : activeView === "chat" ? (
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
                  {rightSidebarOpen && selectedChatId !== "valentina" && (
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
            ) : activeView === "crm" ? (
              <motion.div
                key="crm"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full w-full overflow-hidden"
              >
                <CrmView />
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
            ) : activeView === "tasks" ? (
              <motion.div
                key="tasks"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full overflow-hidden"
              >
                <TasksView />
              </motion.div>
            ) : activeView === "valentina" ? (
              <motion.div
                key="valentina"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full overflow-hidden"
              >
                <ValentinaView />
              </motion.div>
            ) : activeView === "ligacoes" ? (
              <motion.div
                key="ligacoes"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex-1 h-full overflow-hidden"
              >
                <LigacoesView />
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
          </Suspense>
        </div>
      </div>
      <Suspense fallback={null}><AnimatePresence>
        {isProfileModalOpen && <ProfileModal />}
      </AnimatePresence></Suspense>
      <PushNotificationPrompt />
    </div>
  );
}

