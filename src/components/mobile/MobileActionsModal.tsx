import React, { useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { UserPlus, ArrowRightLeft, CheckCircle, User, X, ShieldAlert } from "lucide-react";
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
    captureChat,
    finishChat,
    currentGroup,
    operators,
    transferChat,
    setIsProfileModalOpen,
  } = useChat();

  const [showTransferSelect, setShowTransferSelect] = useState(false);

  if (!isOpen || !activeChat) return null;

  const canCapture = currentGroup?.canCaptureChat ?? true;
  const canTransfer = currentGroup?.canTransferChat ?? true;
  const canFinish = currentGroup?.canFinishChat ?? true;

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
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
        {/* Backdrop overlay */}
        <div className="absolute inset-0" onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 100 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-md bg-card border border-border rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl z-10 flex flex-col gap-4"
        >
          {/* Header do Modal */}
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-soft text-primary font-bold flex items-center justify-center text-sm border border-primary/20">
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
              <div>
                <h3 className="text-sm font-bold text-foreground leading-tight">
                  {activeChat.name}
                </h3>
                <span className="text-xs text-muted-foreground font-medium">
                  Ações do Atendimento
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Lista de Ações Disponíveis */}
          {!showTransferSelect ? (
            <div className="flex flex-col gap-2.5 py-1">
              {/* Capturar Atendimento */}
              {activeChat.queue !== "meus" && activeChat.queue !== "finalizados" && canCapture && (
                <button
                  onClick={handleCapture}
                  className="w-full py-3 px-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs flex items-center gap-3 shadow-soft hover:opacity-90 transition active:scale-[0.98] cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Capturar Atendimento para Mim</span>
                </button>
              )}

              {/* Transferir Atendimento */}
              {canTransfer && (
                <button
                  onClick={() => setShowTransferSelect(true)}
                  className="w-full py-3 px-4 rounded-2xl bg-primary-soft text-primary font-bold text-xs flex items-center gap-3 border border-primary/20 hover:bg-primary-soft/80 transition active:scale-[0.98] cursor-pointer"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>Transferir para Outro Operador</span>
                </button>
              )}

              {/* Finalizar Atendimento */}
              {canFinish && activeChat.queue !== "finalizados" && (
                <button
                  onClick={handleFinish}
                  className="w-full py-3 px-4 rounded-2xl bg-emerald-500 text-white font-bold text-xs flex items-center gap-3 shadow-soft hover:bg-emerald-600 transition active:scale-[0.98] cursor-pointer"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>Finalizar Atendimento</span>
                </button>
              )}

              {/* Ver Ficha do Cliente */}
              <button
                onClick={() => {
                  onClose();
                }}
                className="w-full py-3 px-4 rounded-2xl bg-muted text-foreground font-bold text-xs flex items-center gap-3 hover:bg-muted/80 transition active:scale-[0.98] cursor-pointer"
              >
                <User className="w-4 h-4 text-muted-foreground" />
                <span>Ver Dados do Cliente</span>
              </button>
            </div>
          ) : (
            /* Seleção de Operador para Transferência */
            <div className="flex flex-col gap-3 py-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">
                  Selecione o Operador:
                </span>
                <button
                  onClick={() => setShowTransferSelect(false)}
                  className="text-xs text-primary font-bold hover:underline cursor-pointer"
                >
                  Voltar
                </button>
              </div>

              <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5 pr-1">
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
