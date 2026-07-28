import React, { useState } from "react";
import { Search, SlidersHorizontal, ArrowLeft } from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { MobileActionsModal } from "./MobileActionsModal";

interface MobileHeaderProps {
  onSearchClick?: () => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({ onSearchClick }) => {
  const { selectedChatId, setSelectedChatId, activeChat } = useChat();
  const [isActionsModalOpen, setIsActionsModalOpen] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-card/95 backdrop-blur-md px-3 flex items-center justify-between border-b border-border shadow-2xs transition-all">
        {/* Esquerda: Botão de voltar aos atendimentos (<) */}
        <button
          onClick={() => setSelectedChatId(null)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-foreground hover:bg-muted transition-colors active:scale-95 cursor-pointer shrink-0"
          title="Voltar aos atendimentos"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
        </button>

        {/* Centro: Nome do Cliente + Avatar + Informação do Atendimento */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0 mx-2">
          {activeChat ? (
            <>
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
              <div className="flex flex-col min-w-0 flex-1">
                <h2 className="text-xs font-bold text-foreground leading-tight truncate">
                  {activeChat.name}
                </h2>
                <span className="text-[10px] font-bold text-primary tracking-wider uppercase truncate">
                  {activeChat.phone || activeChat.sectorName || "WhatsApp"}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground">
                Atendimento
              </span>
            </div>
          )}
        </div>

        {/* Direita: Busca e Ações Rápidas do Atendimento */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onSearchClick}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground bg-muted/60 hover:bg-muted hover:text-foreground transition-colors active:scale-95 cursor-pointer"
            aria-label="Buscar"
          >
            <Search className="w-4 h-4 stroke-[2.2]" />
          </button>
          <button
            onClick={() => setIsActionsModalOpen(true)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-primary-foreground bg-primary shadow-soft hover:opacity-90 transition-all active:scale-95 cursor-pointer"
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
