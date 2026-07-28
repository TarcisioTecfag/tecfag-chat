import React, { useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { MobileHeader } from "./MobileHeader";
import { MobileBottomNav } from "./MobileBottomNav";
import { ValentinaFeed } from "./ValentinaFeed";
import { MobileMessageInput } from "./MobileMessageInput";
import { ChatList } from "@/components/chat/ChatList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ContactsView } from "@/components/chat/ContactsView";
import { TasksView } from "@/components/chat/TasksView";
import { AnalyticsView } from "@/components/chat/AnalyticsView";
import { SettingsView } from "@/components/chat/SettingsView";
import { ArrowLeft } from "lucide-react";

export const MobileLayout: React.FC = () => {
  const {
    activeView,
    selectedChatId,
    setSelectedChatId,
    sendMessage,
    activeChat,
  } = useChat();

  const [searchOpen, setSearchOpen] = useState(false);

  const handleSendMessage = (text: string, isInternalNote: boolean) => {
    if (selectedChatId) {
      sendMessage(text, isInternalNote);
    } else {
      // Se estiver no feed da Valentina, envia para a Valentina ou abre um aviso
      console.log("Enviando mensagem para Valentina:", text, isInternalNote);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50/70 text-gray-900 font-sans selection:bg-emerald-100 relative overflow-x-hidden">
      {/* Top Header Mobile */}
      <MobileHeader
        onSearchClick={() => setSearchOpen(!searchOpen)}
        onFilterClick={() => console.log("Abrir filtros mobile")}
      />

      {/* Conteúdo Dinâmico com base na View Ativa */}
      <main className="flex-1 overflow-y-auto pb-36">
        {activeView === "valentina" ? (
          <ValentinaFeed
            onOpenChat={(id) => {
              setSelectedChatId(id);
            }}
          />
        ) : activeView === "chat" ? (
          selectedChatId ? (
            /* Tela do Chat Selecionado em Tela Cheia no Mobile */
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-3 bg-white px-4 py-2.5 border-b border-gray-100 shadow-2xs sticky top-0 z-30">
                <button
                  onClick={() => setSelectedChatId(null)}
                  className="p-1.5 rounded-full hover:bg-gray-100 text-gray-600 cursor-pointer"
                  title="Voltar para a lista"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-xs">
                    {activeChat?.name?.charAt(0) || "C"}
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-900 leading-tight">
                      {activeChat?.name || "Atendimento"}
                    </h3>
                    <span className="text-[10px] text-gray-500 font-medium">
                      {activeChat?.phone || "WhatsApp"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Chat Panel nativo adaptado */}
              <div className="flex-1 overflow-y-auto p-2">
                <ChatPanel />
              </div>
            </div>
          ) : (
            /* Lista de Atendimentos no Mobile */
            <div className="p-2">
              <ChatList />
            </div>
          )
        ) : activeView === "contacts" || activeView === "wallet" ? (
          <div className="p-3">
            <ContactsView />
          </div>
        ) : activeView === "tasks" ? (
          <div className="p-3">
            <TasksView />
          </div>
        ) : activeView === "analytics" ? (
          <div className="p-3">
            <AnalyticsView />
          </div>
        ) : (
          <div className="p-3">
            <SettingsView />
          </div>
        )}
      </main>

      {/* Caixa de Entrada de Mensagem (quando estiver no Valentina Feed ou no Chat) */}
      {(activeView === "valentina" || (activeView === "chat" && selectedChatId)) && (
        <MobileMessageInput onSendMessage={handleSendMessage} />
      )}

      {/* Navegação Inferior Fixa */}
      <MobileBottomNav />
    </div>
  );
};
