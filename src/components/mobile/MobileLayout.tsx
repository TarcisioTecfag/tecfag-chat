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

  const isInsideChat = activeView === "chat" && selectedChatId !== null;
  const [searchOpen, setSearchOpen] = useState(false);

  const handleSendMessage = (text: string, isInternalNote: boolean) => {
    if (selectedChatId) {
      sendMessage(text, isInternalNote);
    } else {
      console.log("Enviando mensagem para Valentina:", text, isInternalNote);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] bg-background text-foreground font-sans selection:bg-primary/20 relative overflow-hidden touch-manipulation">
      {/* O menu de cima (MobileHeader) SÓ APARECE no mobile quando estivermos DENTRO de um chat */}
      {isInsideChat && (
        <MobileHeader onSearchClick={() => setSearchOpen(!searchOpen)} />
      )}

      {/* Conteúdo Dinâmico com base na View Ativa */}
      <main
        className={`flex-1 min-h-0 overflow-y-auto w-full ${
          isInsideChat ? "pt-14 pb-20" : "pb-16"
        }`}
      >
        {activeView === "valentina" ? (
          <ValentinaFeed
            onOpenChat={(id) => {
              setSelectedChatId(id);
            }}
          />
        ) : activeView === "chat" ? (
          selectedChatId ? (
            /* Tela do Chat Selecionado em Tela Cheia no Mobile */
            <div className="flex flex-col h-full w-full min-h-0 p-0 sm:p-1 overflow-hidden">
              <ChatPanel />
            </div>
          ) : (
            /* Lista de Conversas do Atendimento 100% fluida */
            <div className="p-2 w-full">
              <ChatList />
            </div>
          )
        ) : activeView === "contacts" ? (
          /* Aba Clientes (Mobile Native) */
          <div className="p-2.5 w-full">
            <ContactsView />
          </div>
        ) : activeView === "wallet" ? (
          /* Aba Carteira (Mobile Native) */
          <div className="p-2.5 w-full">
            <WalletView />
          </div>
        ) : (
          <div className="p-2 w-full">
            <ChatList />
          </div>
        )}
      </main>

      {/* Input de Mensagem (Apenas quando estiver DENTRO de um Chat selecionado) */}
      {activeView === "chat" && selectedChatId && (
        <MobileMessageInput onSendMessage={handleSendMessage} />
      )}

      {/* Navegação Inferior Fixa (Oculta quando estiver DENTRO de um chat ativo para dar 100% de foco no teclado/envio) */}
      {!isInsideChat && <MobileBottomNav />}
    </div>
  );
};
