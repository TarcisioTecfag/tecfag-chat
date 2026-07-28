import React, { useState } from "react";
import { Search, SlidersHorizontal, ArrowLeft } from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { MobileActionsModal } from "./MobileActionsModal";

interface MobileHeaderProps {
  onSearchClick?: () => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({ onSearchClick }) => {
  const { activeView, setActiveView, selectedChatId, setSelectedChatId, activeChat } = useChat();
  const [isActionsModalOpen, setIsActionsModalOpen] = useState(false);

  const isInsideChat = activeView === "chat" && selectedChatId !== null;

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center justify-between bg-card/95 backdrop-blur-md px-4 py-3 border-b border-border shadow-2xs transition-colors">
        {/* Esquerda: Se dentro do chat, exibe botão de voltar (<). Se fora, não exibe ícone de bola Valem */}
        <div className="flex items-center gap-2 min-w-[36px]">
          {isInsideChat ? (
            <button
              onClick={() => setSelectedChatId(null)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-foreground hover:bg-muted transition-colors active:scale-95 cursor-pointer"
              title="Voltar aos atendimentos"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
            </button>
          ) : (
            <div className="w-2" />
          )}
        </div>

        {/* Centro: Nome do Cliente (se dentro do chat) OU Valentina (se fora do chat) */}
        <div className="flex items-center gap-2.5 max-w-[220px]">
          {isInsideChat && activeChat ? (
            /* Visualização do Atendimento Selecionado */
            <div className="flex items-center gap-2.5 truncate">
              <div className="relative w-9 h-9 shrink-0">
                {activeChat.avatar ? (
                  <img
                    src={activeChat.avatar}
                    alt={activeChat.name}
                    className="w-9 h-9 rounded-full object-cover border border-primary/30"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary-soft text-primary font-bold flex items-center justify-center text-xs">
                    {activeChat.name.charAt(0)}
                  </div>
                )}
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
              </div>
              <div className="flex flex-col truncate">
                <span className="text-sm font-bold text-foreground leading-tight truncate">
                  {activeChat.name}
                </span>
                <span className="text-[10px] font-bold text-primary tracking-wider uppercase truncate">
                  {activeChat.phone || activeChat.sectorName || "WhatsApp"}
                </span>
              </div>
            </div>
          ) : (
            /* Visualização Inicial com a Valentina */
            <button
              onClick={() => {
                setSelectedChatId(null);
                setActiveView("valentina");
              }}
              className="flex items-center gap-2.5 px-3 py-1 rounded-full hover:bg-muted transition-colors text-left cursor-pointer"
            >
              <div className="relative w-9 h-9 shrink-0">
                <img
                  src="/valentina.png"
                  alt="Valentina"
                  className="w-9 h-9 rounded-full object-cover border-2 border-primary/30 shadow-2xs"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&auto=format&fit=crop&q=80";
                  }}
                />
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-foreground leading-tight">
                  Valentina
                </span>
                <span className="text-[10px] font-bold text-primary tracking-wider flex items-center gap-1 uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Meus Atendimentos
                </span>
              </div>
            </button>
          )}
        </div>

        {/* Direita: Busca e Ações Rápidas (Pop-up de Ações) */}
        <div className="flex items-center gap-2">
          <button
            onClick={onSearchClick}
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground bg-muted/60 hover:bg-muted hover:text-foreground transition-colors active:scale-95 cursor-pointer"
            aria-label="Buscar"
          >
            <Search className="w-4 h-4 stroke-[2.2]" />
          </button>
          <button
            onClick={() => setIsActionsModalOpen(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-primary-foreground bg-primary shadow-soft hover:opacity-90 transition-all active:scale-95 cursor-pointer"
            aria-label="Ações do Atendimento"
            title="Ações do Atendimento"
          >
            <SlidersHorizontal className="w-4 h-4 stroke-[2.2]" />
          </button>
        </div>
      </header>

      {/* Modal de Ações Rápidas */}
      <MobileActionsModal
        isOpen={isActionsModalOpen}
        onClose={() => setIsActionsModalOpen(false)}
      />
    </>
  );
};
