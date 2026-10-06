import React, { lazy, Suspense, useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { MobileHeader } from "./MobileHeader";
import { MobileBottomNav } from "./MobileBottomNav";
import { ValentinaFeed } from "./ValentinaFeed";
import { MobileMessageInput } from "./MobileMessageInput";
import { ChatList } from "@/components/chat/ChatList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";

const ContactsView = lazy(() => import("@/components/chat/ContactsView").then((module) => ({ default: module.ContactsView })));
const WalletView = lazy(() => import("@/components/chat/WalletView").then((module) => ({ default: module.WalletView })));

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

  const viewKey = isInsideChat
    ? `chat-room-${selectedChatId}`
    : `view-${activeView}`;

  return (
    <div className="flex flex-col h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] bg-background text-foreground font-sans selection:bg-primary/20 relative overflow-hidden touch-manipulation">
      {/* O menu de cima (MobileHeader) SÓ APARECE no mobile quando estivermos DENTRO de um chat */}
      <AnimatePresence mode="wait">
        {isInsideChat && (
          <motion.div
            key="mobile-header"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            <MobileHeader onSearchClick={() => setSearchOpen(!searchOpen)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conteúdo Dinâmico com base na View Ativa */}
      <main
        className={`flex-1 min-h-0 overflow-y-auto w-full ${
          isInsideChat ? "pt-14 pb-20" : "pb-16"
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={viewKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="h-full w-full"
          >
            <Suspense fallback={<div className="flex h-full items-center justify-center text-primary"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
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
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Input de Mensagem (Apenas quando estiver DENTRO de um Chat selecionado) */}
      <AnimatePresence>
        {activeView === "chat" && selectedChatId && (
          <motion.div
            key="mobile-input"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.15 }}
          >
            <MobileMessageInput onSendMessage={handleSendMessage} />
          </motion.div>
        )}
      </AnimatePresence>

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
