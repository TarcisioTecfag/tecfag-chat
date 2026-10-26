import React from "react";
import { X, RotateCcw } from "lucide-react";
import { AVATAR_URL } from "../../config";

interface ChatHeaderProps {
  onClose: () => void;
  onRestart: () => void;
  isOnline?: boolean;
  operatorName?: string | null;
  onDragStart?: (e: React.MouseEvent<HTMLDivElement>) => void;
  isDragging?: boolean;
  onAvatarClick?: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onClose,
  onRestart,
  isOnline = true,
  operatorName,
  onDragStart,
  isDragging = false,
  onAvatarClick,
}) => {
  return (
    <div
      onMouseDown={onDragStart}
      className={`relative overflow-hidden text-white p-4 rounded-t-2xl shadow-lg flex items-center justify-between select-none ${
        isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      style={{
        background: "linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 50%, #E50914 100%)",
      }}
    >
      {/* Subtle Background Pattern */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div
          className="absolute -right-8 -top-8 w-36 h-36 rounded-full blur-2xl"
          style={{ background: "#E50914" }}
        />
        <div
          className="absolute -left-8 -bottom-8 w-28 h-28 rounded-full blur-xl"
          style={{ background: "#E50914" }}
        />
      </div>

      {/* Red Accent Bar at Top */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: "linear-gradient(90deg, #E50914, #ff4d4d, #E50914)" }}
      />

      <div className="flex items-center gap-3.5 relative z-10">
        <div className="relative">
          {/* Fagner Photo Avatar */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (onAvatarClick) onAvatarClick();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-11 h-11 rounded-full overflow-hidden shadow-lg border-2 border-[#E50914] flex-shrink-0 cursor-pointer hover:scale-105 transition-transform"
            title="Ver foto em tamanho real"
          >
            <img
              src={AVATAR_URL}
              alt="Fagner - Assistente Tecfag"
              className="w-full h-full object-cover"
            />
          </div>
          {/* Online Indicator */}
          {isOnline && (
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 border-2 border-[#1a1a1a] rounded-full shadow-sm tecfag-online-badge"></span>
          )}
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-[15px] leading-tight tracking-wide text-white">
              Fagner • Tecfag
            </h3>
            <span
              className="px-1.5 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider border"
              style={{
                background: "rgba(229, 9, 20, 0.25)",
                color: "#ff6b6b",
                borderColor: "rgba(229, 9, 20, 0.4)",
              }}
            >
              IA
            </span>
          </div>
          <p className="text-xs text-neutral-300 font-medium mt-0.5 flex items-center gap-1.5">
            {operatorName ? (
              <span className="text-emerald-300 font-semibold">👤 {operatorName}</span>
            ) : isOnline ? (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>Consultor Técnico Online</span>
              </>
            ) : (
              "Deixe sua mensagem"
            )}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-1 relative z-10">
        <button
          onClick={onRestart}
          onMouseDown={(e) => e.stopPropagation()}
          title="Reiniciar conversa"
          className="p-2 text-neutral-300 hover:text-white hover:bg-white/10 rounded-xl transition-all duration-200 active:scale-95"
          aria-label="Reiniciar conversa"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          title="Fechar chat"
          className="p-2 text-neutral-300 hover:text-white hover:bg-white/10 rounded-xl transition-all duration-200 active:scale-95"
          aria-label="Fechar chat"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
