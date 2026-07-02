import React, { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatList } from "@/components/chat/ChatList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SharedFiles } from "@/components/chat/SharedFiles";
import { SettingsView } from "@/components/chat/SettingsView";
import { ContactsView } from "@/components/chat/ContactsView";
import { GroupsView } from "@/components/chat/GroupsView";
import { ProfileModal } from "@/components/chat/ProfileModal";
import { useChat } from "@/hooks/useChatState";
import { Login } from "@/components/chat/Login";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Index,
});

function Index() {
  const { tenant, activeView, rightSidebarOpen, isAuthenticated } = useChat();
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
    <div className="min-h-screen bg-background transition-colors duration-300" style={themeStyles}>
      <div className="flex h-screen w-full gap-5 p-5">
        <Sidebar />
        {activeView === "chat" && <ChatList />}
        {activeView === "chat" ? (
          <>
            <ChatPanel />
            {rightSidebarOpen && <SharedFiles />}
          </>
        ) : activeView === "contacts" ? (
          <ContactsView />
        ) : activeView === "groups" ? (
          <GroupsView />
        ) : (
          <SettingsView />
        )}
      </div>
      <ProfileModal />
    </div>
  );
}
