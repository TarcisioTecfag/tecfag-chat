import React from "react";
import { Search, SlidersHorizontal, Check } from "lucide-react";
import { useChat } from "@/hooks/useChatState";

interface MobileHeaderProps {
  onSearchClick?: () => void;
  onFilterClick?: () => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  onSearchClick,
  onFilterClick,
}) => {
  const { setActiveView } = useChat();

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between bg-white/95 backdrop-blur-md px-4 py-3 border-b border-emerald-100/60 shadow-xs">
      {/* Esquerda: Logo Valem com badge de status */}
      <div className="flex items-center gap-2">
        <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-emerald-600 text-white font-black text-xs shadow-xs tracking-tighter">
          valem
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
            <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
          </span>
        </div>
      </div>

      {/* Centro: Valentina + Status MEUS ATENDIMENTOS */}
      <button
        onClick={() => setActiveView("valentina")}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-full hover:bg-emerald-50/60 transition-colors text-left"
      >
        <div className="relative w-9 h-9 shrink-0">
          <img
            src="/valentina.png"
            alt="Valentina"
            className="w-9 h-9 rounded-full object-cover border-2 border-emerald-400/40 shadow-xs"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&auto=format&fit=crop&q=80";
            }}
          />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold text-gray-900 leading-tight">
            Valentina
          </span>
          <span className="text-[10px] font-bold text-emerald-600 tracking-wider flex items-center gap-1 uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Meus Atendimentos
          </span>
        </div>
      </button>

      {/* Direita: Busca e Filtros */}
      <div className="flex items-center gap-2">
        <button
          onClick={onSearchClick}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-600 bg-gray-50 border border-gray-100 hover:bg-emerald-50 hover:text-emerald-600 transition-colors active:scale-95 cursor-pointer"
          aria-label="Buscar"
        >
          <Search className="w-4 h-4 stroke-[2.2]" />
        </button>
        <button
          onClick={onFilterClick}
          className="w-9 h-9 rounded-full flex items-center justify-center text-white bg-emerald-500 shadow-xs hover:bg-emerald-600 transition-colors active:scale-95 cursor-pointer"
          aria-label="Filtros"
        >
          <SlidersHorizontal className="w-4 h-4 stroke-[2.2]" />
        </button>
      </div>
    </header>
  );
};
