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

import { ProfileModal } from "@/components/chat/ProfileModal";
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

import { ModuleSkeleton } from "@/components/ui/ModuleSkeleton";

function ViewFallback({ activeView }: { activeView?: string }) {
  const variant = activeView === "chat" ? "chat" : "dashboard";
  return <ModuleSkeleton variant={variant} />;
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

  const renderActiveView = () => {
    if (activeView === "commercialHome" && tenant === "tecfag") {
      return <CommercialHomeView />;
    }
    if (activeView === "commercialManagement" && tenant === "tecfag") {
      return <CommercialManagementView />;
    }
    if (activeView === "commercialBi" && tenant === "tecfag") {
      return <CommercialBiView />;
    }
    if (activeView === "chat") {
      return (
        <div className="flex flex-1 gap-5 h-full w-full overflow-hidden">
          <ChatList />
          <ChatPanel />
          <AnimatePresence>
            {rightSidebarOpen && selectedChatId !== "valentina" && (
              <motion.div
                key="shared-files"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="h-full w-[360px] shrink-0 overflow-hidden"
              >
                <SharedFiles />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }
    if (activeView === "crm") return <CrmView />;
    if (activeView === "contacts") return <ContactsView />;
    if (activeView === "wallet") return <WalletView />;
    if (activeView === "groups") return <GroupsView />;
    if (activeView === "monitor") return <MonitorView />;
    if (activeView === "analytics") return <AnalyticsView />;
    if (activeView === "tasks") return <TasksView />;
    if (activeView === "valentina") return <ValentinaView />;
    if (activeView === "ligacoes") return <LigacoesView />;
    return <SettingsView />;
  };

  return (
    <div className="min-h-screen bg-background transition-colors duration-500 ease-in-out" style={themeStyles}>
      <div className={`flex h-screen w-full gap-5 ${activeView === "crm" ? "pl-5 pt-5 pb-0 pr-0" : "p-5"} overflow-hidden`}>
        <Sidebar />
        <div className="flex flex-1 h-full overflow-hidden relative">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${activeView}-${tenant}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 h-full w-full overflow-hidden"
            >
              <Suspense fallback={<ViewFallback activeView={activeView} />}>
                {renderActiveView()}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <Suspense fallback={null}><AnimatePresence>
        {isProfileModalOpen && <ProfileModal />}
      </AnimatePresence></Suspense>
      <PushNotificationPrompt />
    </div>
  );
}

