import React, { useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { MobileHeader } from "./MobileHeader";
import { MobileBottomNav } from "./MobileBottomNav";
import { ValentinaFeed } from "./ValentinaFeed";
import { MobileMessageInput } from "./MobileMessageInput";
import { ChatList } from "@/components/chat/ChatList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ContactsView } from "@/components/chat/ContactsView";
import { WalletView } from "@/components/chat/WalletView";

export const MobileLayout: React.FC = () => {
  const {
    activeView,
    selectedChatId,
    setSelectedChatId,
    sendMessage,
  } = useChat();

  const [searchOpen, setSearchOpen] = useState(false);

  const handleSendMessage = (text: string, isInternalNote: boolean) => {
    if (selectedChatId) {
      sendMessage(text, isInternalNote);
    } else {
      console.log("Enviando mensagem para Valentina:", text, isInternalNote);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground font-sans selection:bg-primary/20 relative overflow-x-hidden">
      {/* Header Mobile com navegação e acionamento de ações */}
      <MobileHeader
        onSearchClick={() => setSearchOpen(!searchOpen)}
      />

      {/* Conteúdo Dinâmico com base na View Ativa */}
      <main className="flex-1 overflow-y-auto pb-32">
        {activeView === "valentina" ? (
          <ValentinaFeed
            onOpenChat={(id) => {
              setSelectedChatId(id);
            }}
          />
        ) : activeView === "chat" ? (
          selectedChatId ? (
            /* Tela do Chat Selecionado em Tela Cheia (sem headers duplicados) */
            <div className="flex flex-col h-full w-full p-2">
              <ChatPanel />
            </div>
          ) : (
            /* Lista de Conversas do Atendimento 100% fluida */
            <div className="p-2 w-full flex justify-center">
              <ChatList />
            </div>
          )
        ) : activeView === "contacts" ? (
          /* Aba Clientes */
          <div className="p-2 w-full">
            <ContactsView />
          </div>
        ) : activeView === "wallet" ? (
          /* Aba Carteira */
          <div className="p-2 w-full">
            <WalletView />
          </div>
        ) : (
          <div className="p-2 w-full">
            <ChatList />
          </div>
        )}
      </main>

      {/* Input de Mensagem (no Feed Valentina ou em Chat Selecionado) */}
      {(activeView === "valentina" || (activeView === "chat" && selectedChatId)) && (
        <MobileMessageInput onSendMessage={handleSendMessage} />
      )}

      {/* Navegação Inferior Fixa com 4 Itens */}
      <MobileBottomNav />
    </div>
  );
};
