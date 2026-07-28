import React, { useState } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  UserPlus,
  ArrowRightLeft,
  CheckCircle,
  User,
  X,
  Bot,
  RotateCcw,
  BookOpen,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface MobileActionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MobileActionsModal: React.FC<MobileActionsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    activeChat,
    currentOperatorId,
    captureChat,
    finishChat,
    currentGroup,
    operators,
    transferChat,
    setActiveView,
  } = useChat();

  const [showTransferSelect, setShowTransferSelect] = useState(false);

  if (!isOpen || !activeChat) return null;

  const isValentina =
    activeChat.id === "valentina" ||
    activeChat.contactId === "valentina" ||
    activeChat.name.toLowerCase().includes("valentina");

  // Permissões RBAC e Estado do Chat
  const canCapture = currentGroup?.canCaptureChat ?? true;
  const canTransfer = currentGroup?.canTransferChat ?? true;
  const canFinish = currentGroup?.canFinishChat ?? true;

  // O chat pertence ao operador atual?
  const isMine =
    activeChat.operatorId === currentOperatorId || activeChat.queue === "meus";

  // O chat está na fila/bot aguardando captura?
  const isPendingInQueue =
    !isMine &&
    activeChat.queue !== "finalizados" &&
    activeChat.id !== "valentina";

  const handleCapture = () => {
    captureChat(activeChat.id);
    onClose();
  };

  const handleFinish = () => {
    finishChat(activeChat.id);
    onClose();
  };

  const handleTransfer = (targetOpId: string) => {
    transferChat(activeChat.id, targetOpId);
    setShowTransferSelect(false);
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
        {/* Backdrop overlay */}
        <div className="absolute inset-0" onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 100 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-md bg-card border border-border rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl z-10 flex flex-col gap-4"
        >
          {/* Header do Modal */}
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-soft text-primary font-bold flex items-center justify-center text-sm border border-primary/20 shrink-0">
                {activeChat.avatar ? (
                  <img
                    src={activeChat.avatar}
                    alt={activeChat.name}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  activeChat.name.charAt(0)
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <h3 className="text-sm font-bold text-foreground leading-tight truncate">
                  {activeChat.name}
                </h3>
                <span className="text-[11px] text-muted-foreground font-medium">
                  {isValentina ? "Assistente Virtual IA" : "Ações de Atendimento"}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* CASO 1: AÇÕES DA VALENTINA */}
          {isValentina ? (
            <div className="flex flex-col gap-2.5 py-1">
              <button
                onClick={() => {
                  setActiveView("valentina");
                  onClose();
                }}
                className="w-full py-3 px-4 rounded-2xl bg-primary-soft text-primary font-bold text-xs flex items-center gap-3 border border-primary/20 hover:bg-primary-soft/80 transition cursor-pointer"
              >
                <BookOpen className="w-4 h-4" />
                <span>Ver Feed & Sugestões da Valentina</span>
              </button>
            </div>
          ) : !showTransferSelect ? (
            /* CASO 2: AÇÕES DE CLIENTE REAL (PARIDADE 100% COM PC) */
            <div className="flex flex-col gap-2.5 py-1">
              {/* Capturar Atendimento (Disponível apenas se o atendimento estiver na Fila e NÃO for do operador) */}
              {isPendingInQueue && canCapture && (
                <button
                  onClick={handleCapture}
                  className="w-full py-3 px-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center gap-2.5 shadow-soft hover:opacity-90 transition active:scale-[0.98] cursor-pointer"
                >
                  <UserPlus className="w-4.5 h-4.5" />
                  <span>Capturar Atendimento para Mim</span>
                </button>
              )}

              {/* Transferir Atendimento (Se tiver permissão) */}
              {canTransfer && activeChat.queue !== "finalizados" && (
                <button
                  onClick={() => setShowTransferSelect(true)}
                  className="w-full py-3 px-4 rounded-2xl bg-primary-soft text-primary font-bold text-xs flex items-center justify-center gap-2.5 border border-primary/20 hover:bg-primary-soft/80 transition active:scale-[0.98] cursor-pointer"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>Transferir para Outro Operador</span>
                </button>
              )}

              {/* Finalizar Atendimento (APENAS se o atendimento for meu / capturado e tiver permissão) */}
              {isMine && canFinish && activeChat.queue !== "finalizados" && (
                <button
                  onClick={handleFinish}
                  className="w-full py-3 px-4 rounded-2xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-2.5 shadow-soft hover:bg-emerald-700 transition active:scale-[0.98] cursor-pointer"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>Finalizar Atendimento</span>
                </button>
              )}

              {/* Ver Ficha do Cliente */}
              <button
                onClick={() => {
                  setActiveView("contacts");
                  onClose();
                }}
                className="w-full py-3 px-4 rounded-2xl bg-muted text-foreground font-bold text-xs flex items-center justify-center gap-2.5 hover:bg-muted/80 transition active:scale-[0.98] cursor-pointer"
              >
                <User className="w-4 h-4 text-muted-foreground" />
                <span>Ver Ficha Cadastral do Cliente</span>
              </button>
            </div>
          ) : (
            /* Seleção de Operador para Transferência */
            <div className="flex flex-col gap-3 py-1">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-xs font-bold text-foreground">
                  Selecione o Destino:
                </span>
                <button
                  onClick={() => setShowTransferSelect(false)}
                  className="text-xs text-primary font-bold hover:underline cursor-pointer"
                >
                  Voltar
                </button>
              </div>

              <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5 pr-1">
                {operators.map((op) => (
                  <button
                    key={op.id}
                    onClick={() => handleTransfer(op.id)}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-muted/60 hover:bg-primary-soft text-left transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <img
                        src={op.avatar}
                        alt={op.name}
                        className="w-7 h-7 rounded-full object-cover"
                      />
                      <span className="text-xs font-bold text-foreground">
                        {op.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-primary">
                      Transferir
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
