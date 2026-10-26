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
import { BriefcaseBusiness, Loader2 } from "lucide-react";

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

import { buildAppRoutePath, parseAppRoute } from "@/lib/app-routes";
import { isModuleAuthorized, resolveAuthorizedActiveView } from "@/lib/module-catalog";

export const Route = createFileRoute("/")({
  ssr: true,
  component: () => null,
});

export function Index() {
  const { tenant, activeView, setActiveView, sessionRole, rightSidebarOpen, selectedChatId, setSelectedChatId, isAuthenticated, isRestoringSession, isProfileModalOpen, activeChat, conversations, isCommercialConsultant, currentGroup } = useChat();
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

  // Guard compartilhado de permissão de módulo (atua em desktop e mobile, mesmo sem Sidebar montada)
  useEffect(() => {
    if (!isAuthenticated || isRestoringSession) return;
    const resolved = resolveAuthorizedActiveView(activeView, {
      tenant,
      sessionRole,
      isCommercialConsultant,
      canAccessView,
    });
    if (resolved && resolved !== activeView) {
      setActiveView(resolved);
    }
  }, [activeView, canAccessView, currentGroup, isAuthenticated, isCommercialConsultant, isRestoringSession, sessionRole, setActiveView, tenant]);

  const prevPathRef = React.useRef(location.pathname);
  const prevViewRef = React.useRef(activeView);
  const prevChatIdRef = React.useRef(selectedChatId);

  useEffect(() => {
    if (!isAuthenticated || isRestoringSession) return;

    const pathnameChanged = prevPathRef.current !== location.pathname;
    const viewChanged = prevViewRef.current !== activeView;
    const chatIdChanged = prevChatIdRef.current !== selectedChatId;

    prevPathRef.current = location.pathname;
    prevViewRef.current = activeView;
    prevChatIdRef.current = selectedChatId;

    const parsed = parseAppRoute(location.pathname);
    if (!parsed.isAppShell) return;

    const accessCtx = {
      tenant,
      sessionRole,
      isCommercialConsultant,
      canAccessView,
    };

    // 1. Mudança externa da URL (botões Voltar/Avançar do navegador ou acesso via link direto)
    if (pathnameChanged && !viewChanged && parsed.viewId) {
      if (parsed.viewId !== activeView) {
        if (isModuleAuthorized(parsed.viewId, accessCtx)) {
          prevViewRef.current = parsed.viewId;
          setActiveView(parsed.viewId);
          return;
        }
        const fallbackView = resolveAuthorizedActiveView(parsed.viewId, accessCtx);
        if (fallbackView) {
          const fallbackPath = buildAppRoutePath(fallbackView);
          prevViewRef.current = fallbackView;
          prevPathRef.current = fallbackPath;
          setActiveView(fallbackView);
          if (location.pathname !== fallbackPath) {
            navigate({ to: fallbackPath as any, replace: true });
          }
          return;
        }
      }
      if (parsed.viewId === "chat") {
        if (parsed.isAiAssistantChat && selectedChatId !== "valentina") {
          prevChatIdRef.current = "valentina";
          setSelectedChatId("valentina");
          return;
        }
        if (!parsed.chatKey && !parsed.isAiAssistantChat && selectedChatId && activeChat) {
          const chatKey = getChatLinkKey(activeChat, conversations);
          const nextPath = `/chat/${encodeURIComponent(chatKey)}`;
          if (location.pathname !== nextPath && location.pathname !== `/chat/${chatKey}`) {
            prevPathRef.current = `/chat/${chatKey}`;
            navigate({ to: "/chat/$chatKey", params: { chatKey }, replace: true });
          }
          return;
        }
      }
      return;
    }

    // 2. Módulo Chat ativo: sincronizar /chat, /chat/assistente e /chat/$chatKey
    if (activeView === "chat") {
      if (selectedChatId === "valentina") {
        const target = "/chat/assistente";
        if (location.pathname !== target) {
          prevPathRef.current = target;
          navigate({ to: "/chat/$chatKey", params: { chatKey: "assistente" }, replace: parsed.isRoot });
        }
        return;
      }

      if (activeChat && selectedChatId === activeChat.id && activeChat.id !== "valentina") {
        const chatKey = getChatLinkKey(activeChat, conversations);
        const target = `/chat/${encodeURIComponent(chatKey)}`;
        if (location.pathname !== target && location.pathname !== `/chat/${chatKey}`) {
          prevPathRef.current = `/chat/${chatKey}`;
          navigate({ to: "/chat/$chatKey", params: { chatKey }, replace: parsed.isRoot });
        }
        return;
      }

      if (!selectedChatId && (parsed.isRoot || viewChanged || chatIdChanged || parsed.viewId !== "chat")) {
        const target = "/chat";
        if (location.pathname !== target) {
          prevPathRef.current = target;
          navigate({ to: target as any, replace: parsed.isRoot });
        }
      }
      return;
    }

    // 3. Demais 13 módulos: sincronizar com a rota dedicada do módulo e sua aba
    if (parsed.isRoot || parsed.viewId !== activeView) {
      const targetPath = buildAppRoutePath(activeView);
      if (location.pathname !== targetPath) {
        prevPathRef.current = targetPath;
        navigate({ to: targetPath as any, replace: parsed.isRoot });
      }
    }
  }, [
    activeChat,
    activeView,
    canAccessView,
    conversations,
    isAuthenticated,
    isCommercialConsultant,
    isRestoringSession,
    location.pathname,
    navigate,
    selectedChatId,
    sessionRole,
    setActiveView,
    setSelectedChatId,
    tenant,
  ]);

  if (!isMounted || isRestoringSession) {
    return <div className="fixed inset-0 flex h-full w-full items-center justify-center bg-background text-primary"><Loader2 className="h-7 w-7 animate-spin" aria-label="Abrindo atendimento" /></div>;
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
      <div
        className="fixed inset-0 w-full bg-background overflow-hidden"
        style={{ ...themeStyles, height: "var(--mobile-app-height, 100dvh)" }}
      >
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
      if (!isCommercialConsultant) {
        return (
          <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center bg-background">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 text-primary">
              <BriefcaseBusiness className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold font-mono text-foreground mb-2">
              Acesso Restrito a Consultores Comerciais
            </h2>
            <p className="text-sm text-muted-foreground max-w-md">
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
      return (
        <div className="flex flex-1 gap-3 md:gap-5 h-full w-full overflow-hidden">
          <ChatList />
          <ChatPanel />
          <AnimatePresence initial={false}>
            {rightSidebarOpen && selectedChatId !== "valentina" && (
              <motion.div
                key="shared-files-wrapper"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "auto", opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="h-full shrink-0 overflow-hidden"
              >
                <motion.div
                  initial={{ x: 28, opacity: 0.6 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 28, opacity: 0 }}
                  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full w-[340px] md:w-[380px] xl:w-[430px] 2xl:w-[460px] shrink-0"
                >
                  <SharedFiles />
                </motion.div>
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
    <div className="fixed inset-0 h-full w-full overflow-hidden bg-background transition-colors duration-500 ease-in-out" style={themeStyles}>
      <div className={`flex h-full w-full gap-3 md:gap-5 ${activeView === "crm" ? "pl-3 pt-3 md:pl-5 md:pt-5 pb-0 pr-0" : "p-3 md:p-5"} overflow-hidden`}>
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

