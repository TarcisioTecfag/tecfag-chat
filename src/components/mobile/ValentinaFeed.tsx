import React from "react";
import { ArrowRight, Clock } from "lucide-react";
import { useChat } from "@/hooks/useChatState";

interface ValentinaFeedProps {
  onOpenChat?: (chatId: string) => void;
  onSendPrompt?: (promptText: string) => void;
}

export const ValentinaFeed: React.FC<ValentinaFeedProps> = ({
  onOpenChat,
  onSendPrompt,
}) => {
  const { setSelectedChatId, setActiveView, conversations } = useChat();

  const handleOpenConversa = (customerName: string) => {
    // Procura por ID existente ou usa um fallback
    const targetChat = conversations.find(
      (c) => c.name.toLowerCase().includes(customerName.toLowerCase())
    );
    if (targetChat) {
      setSelectedChatId(targetChat.id);
    }
    setActiveView("chat");
    if (onOpenChat && targetChat) {
      onOpenChat(targetChat.id);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 pb-28">
      {/* 1. Boas-vindas da Valentina */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-xs transition-all">
        <p className="text-gray-800 text-sm font-medium leading-relaxed">
          Olá! Bom dia Tarcisio Pereira, como posso te ajudar hoje?
        </p>
      </div>

      {/* 2. Chips / Perguntas Sugeridas */}
      <div className="flex items-start gap-3">
        <div className="relative w-8 h-8 shrink-0 mt-1">
          <img
            src="/valentina.png"
            alt="Valentina"
            className="w-8 h-8 rounded-full object-cover border border-emerald-300"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&auto=format&fit=crop&q=80";
            }}
          />
        </div>

        <div className="flex flex-col gap-2.5 flex-1">
          <button
            onClick={() => onSendPrompt?.("Quantos leads tenho sem resposta?")}
            className="flex items-center justify-between px-4 py-3 bg-white hover:bg-emerald-50/50 border border-emerald-100/90 rounded-full text-xs font-bold text-emerald-700 shadow-2xs transition-all active:scale-[0.98] text-left cursor-pointer"
          >
            <span>Quantos leads tenho sem resposta?</span>
            <ArrowRight className="w-4 h-4 text-emerald-500 shrink-0 ml-2" />
          </button>

          <button
            onClick={() => onSendPrompt?.("Quais são meus leads quentes?")}
            className="flex items-center justify-between px-4 py-3 bg-white hover:bg-emerald-50/50 border border-emerald-100/90 rounded-full text-xs font-bold text-emerald-700 shadow-2xs transition-all active:scale-[0.98] text-left cursor-pointer"
          >
            <span>Quais são meus leads quentes?</span>
            <ArrowRight className="w-4 h-4 text-emerald-500 shrink-0 ml-2" />
          </button>

          <button
            onClick={() =>
              onSendPrompt?.(
                "Como está a pontuação atual dos meus atendimentos?"
              )
            }
            className="flex items-center justify-between px-4 py-3 bg-white hover:bg-emerald-50/50 border border-emerald-100/90 rounded-full text-xs font-bold text-emerald-700 shadow-2xs transition-all active:scale-[0.98] text-left cursor-pointer"
          >
            <span>Como está a pontuação atual dos meus atendimentos?</span>
            <ArrowRight className="w-4 h-4 text-emerald-500 shrink-0 ml-2" />
          </button>
        </div>
      </div>

      {/* 3. CARD DE ALERTA DE ATRASO */}
      <div className="flex items-start gap-3">
        <div className="relative w-8 h-8 shrink-0 mt-2">
          <img
            src="/valentina.png"
            alt="Valentina"
            className="w-8 h-8 rounded-full object-cover border border-emerald-300"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&auto=format&fit=crop&q=80";
            }}
          />
        </div>

        <div className="flex-1 bg-emerald-50/40 border border-emerald-200/60 rounded-3xl p-4 shadow-xs">
          {/* Header do Card */}
          <div className="flex items-center gap-1.5 mb-2 text-emerald-700 font-extrabold text-[11px] tracking-wide uppercase">
            <Clock className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
            <span>AVISO DE VALENTINA</span>
          </div>

          <p className="text-gray-700 text-xs font-medium leading-relaxed mb-3">
            Alerta de Atraso! O cliente{" "}
            <strong className="text-gray-900 font-bold">Tarcisio Júnior</strong>{" "}
            está aguardando retorno há mais de 20 minutos.
          </p>

          {/* Card interno do Cliente */}
          <div className="bg-white rounded-2xl p-3.5 border border-emerald-100 shadow-2xs space-y-3">
            <div className="text-xs">
              <span className="text-gray-600 font-semibold">Cliente: </span>
              <span className="text-emerald-700 font-bold">
                Tarcisio Júnior
              </span>
            </div>

            <div className="bg-gray-50/80 rounded-xl p-3 border border-gray-100 text-xs italic text-gray-600 font-medium">
              “Bom dia! Como está a liberação da carga de embaladoras da Valem?”
            </div>

            <button
              onClick={() => handleOpenConversa("Tarcisio Júnior")}
              className="w-full py-2.5 px-4 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all active:scale-[0.98] cursor-pointer"
            >
              <span>Abrir Conversa</span>
              <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>

      {/* 4. CARD DE NOVO ATENDIMENTO / LEAD QUENTE */}
      <div className="flex items-start gap-3">
        <div className="relative w-8 h-8 shrink-0 mt-2">
          <img
            src="/valentina.png"
            alt="Valentina"
            className="w-8 h-8 rounded-full object-cover border border-emerald-300"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&auto=format&fit=crop&q=80";
            }}
          />
        </div>

        <div className="flex-1 bg-emerald-50/40 border border-emerald-200/60 rounded-3xl p-4 shadow-xs">
          {/* Header do Card */}
          <div className="flex items-center gap-1.5 mb-2 text-emerald-700 font-extrabold text-[11px] tracking-wide uppercase">
            <Clock className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
            <span>AVISO DE VALENTINA</span>
          </div>

          <p className="text-gray-700 text-xs font-medium leading-relaxed mb-3">
            Novo Atendimento! Transferi um novo cliente para a sua fila
            comercial.
          </p>

          {/* Card interno do Cliente */}
          <div className="bg-white rounded-2xl p-3.5 border border-emerald-100 shadow-2xs space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div>
                <span className="text-gray-600 font-semibold">Cliente: </span>
                <span className="text-emerald-700 font-bold">Pedro Silva</span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-200 text-[10px] font-extrabold tracking-wide uppercase">
                QUENTE
              </span>
            </div>

            <div className="bg-gray-50/80 rounded-xl p-3 border border-gray-100 text-xs space-y-1">
              <span className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">
                INTERESSE:
              </span>
              <p className="text-gray-700 font-medium">
                Válvula Reguladora de Pressão de 2 polegadas
              </p>
            </div>

            <button
              onClick={() => handleOpenConversa("Pedro Silva")}
              className="w-full py-2.5 px-4 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all active:scale-[0.98] cursor-pointer"
            >
              <span>Abrir Atendimento</span>
              <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
