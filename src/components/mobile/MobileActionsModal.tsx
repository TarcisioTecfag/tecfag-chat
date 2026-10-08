import React, { useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { usePermissions } from "@/hooks/usePermissions";
import {
  UserPlus,
  ArrowRightLeft,
  CheckCircle,
  User,
  X,
  BookOpen,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SharedFiles } from "@/components/chat/SharedFiles";
import { getAiPersona } from "@/lib/ai-persona";
import { AiAvatar } from "@/components/ui/AiAvatar";

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
    operators,
    transferChat,
    setActiveView,
    tenant,
  } = useChat();
  const { canCaptureChat, canOverrideChat, canTransferChat, canFinishChat } = usePermissions();

  const persona = getAiPersona(tenant || "valem");

  const [showTransferSelect, setShowTransferSelect] = useState(false);
  const [showCustomerFile, setShowCustomerFile] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);

  if (!isOpen || !activeChat) return null;

  const isAiChat =
    activeChat.id === "valentina" ||
    activeChat.id === "fagner" ||
    activeChat.contactId === "valentina" ||
    activeChat.contactId === "fagner" ||
    activeChat.name.toLowerCase().includes(persona.name.toLowerCase()) ||
    activeChat.name.toLowerCase().includes("valentina") ||
    activeChat.name.toLowerCase().includes("fagner");

  // Permissões RBAC e Estado do Chat
  const canCapture = canCaptureChat;
  const canTransfer = canTransferChat;
  const canFinish = canFinishChat;

  // O chat pertence ao operador atual?
  const isMine = activeChat.operatorId === currentOperatorId && activeChat.queue === "meus";

  // O chat está na fila/bot aguardando captura?
  const isPendingInQueue =
    !activeChat.operatorId &&
    activeChat.queue !== "finalizados" &&
    !isAiChat;
  const canTakeFromOther = !!activeChat.operatorId && !isMine && canOverrideChat && activeChat.queue === "meus";

  const handleCapture = () => {
    captureChat(activeChat.id);
    onClose();
  };

  const handleFinish = () => {
    finishChat(activeChat.id);
    onClose();
  };

  const handleTransfer = async (targetOpId: string) => {
    if (await transferChat(activeChat.id, null, targetOpId)) {
      setShowTransferSelect(false);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {/* ── MODAL PRINCIPAL: AÇÕES DE ATENDIMENTO ── */}
      {!showCustomerFile ? (
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
                <div className="w-10 h-10 rounded-full bg-primary-soft text-primary font-bold flex items-center justify-center text-sm border border-primary/20 shrink-0 overflow-hidden">
                  {isAiChat ? (
                    <AiAvatar tenantId={tenant} className="w-full h-full rounded-full" />
                  ) : activeChat.avatar ? (
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
                    {isAiChat ? "Assistente Virtual IA" : "Ações de Atendimento"}
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

            {/* CASO 1: AÇÕES DA IA */}
            {isAiChat ? (
              <div className="flex flex-col gap-2.5 py-1">
                <button
                  onClick={() => {
                    setActiveView("valentina");
                    onClose();
                  }}
                  className="w-full py-3 px-4 rounded-2xl bg-primary-soft text-primary font-bold text-xs flex items-center gap-3 border border-primary/20 hover:bg-primary-soft/80 transition cursor-pointer"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Ver Feed & Sugestões {persona.gender === "female" ? "da" : "do"} {persona.name}</span>
                </button>
              </div>
            ) : showFinishConfirm ? (
              /* CASO 2.5: CONFIRMAÇÃO DE FINALIZAÇÃO */
              <div className="flex flex-col gap-3.5 py-1">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-extrabold text-foreground">Finalizar Atendimento?</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Encerrar a conversa com <strong className="text-foreground">{activeChat.name}</strong> e mover para Finalizados?
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowFinishConfirm(false)}
                    className="flex-1 py-2.5 rounded-xl border border-border bg-card text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleFinish}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 shadow-soft transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Sim, Finalizar
                  </button>
                </div>
              </div>
            ) : !showTransferSelect ? (
              /* CASO 2: AÇÕES DE CLIENTE REAL (PARIDADE 100% COM PC) */
              <div className="flex flex-col gap-2.5 py-1">
                {/* Capturar Atendimento (Disponível apenas se o atendimento estiver na Fila e NÃO for do operador) */}
                {isPendingInQueue && canCapture && (
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={handleCapture}
                    className="w-full py-3 px-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center gap-2.5 shadow-soft hover:opacity-90 transition cursor-pointer"
                  >
                    <UserPlus className="w-4.5 h-4.5" />
                    <span>Capturar Atendimento para Mim</span>
                  </motion.button>
                )}
                {canTakeFromOther && (
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={handleCapture}
                    className="w-full py-3 px-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center gap-2.5 shadow-soft hover:opacity-90 transition cursor-pointer"
                  >
                    <UserPlus className="w-4.5 h-4.5" />
                    <span>Assumir Atendimento</span>
                  </motion.button>
                )}

                {/* Transferir Atendimento (Se tiver permissão) */}
                {canTransfer && (isMine || canOverrideChat || !activeChat.operatorId) && activeChat.queue !== "finalizados" && (
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setShowTransferSelect(true)}
                    className="w-full py-3 px-4 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center justify-center gap-2.5 border border-emerald-500/20 hover:bg-emerald-500/20 transition cursor-pointer"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    <span>Transferir para Outro Operador</span>
                  </motion.button>
                )}

                {/* Finalizar Atendimento (Verde Padrão do Sistema - Emerald 500/600) */}
                {isMine && canFinish && activeChat.queue !== "finalizados" && (
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setShowFinishConfirm(true)}
                    className="w-full py-3 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-2.5 shadow-soft transition cursor-pointer"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>Finalizar Atendimento</span>
                  </motion.button>
                )}

                {/* Ver Ficha Cadastral do Cliente (Abre as 3 Abas: Dados / Arquivos / Eventos) */}
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setShowCustomerFile(true)}
                  className="w-full py-3 px-4 rounded-2xl bg-muted text-foreground font-bold text-xs flex items-center justify-center gap-2.5 hover:bg-muted/80 transition cursor-pointer"
                >
                  <User className="w-4 h-4 text-muted-foreground" />
                  <span>Ver Ficha Cadastral do Cliente</span>
                </motion.button>
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
                  {operators.filter((op) => op.id !== currentOperatorId).map((op) => (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
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
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      ) : (
        /* ── MODAL FULLSCREEN / DRAWER: FICHA CADASTRAL DO CLIENTE (DADOS / ARQUIVOS / EVENTOS) ── */
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4">
          <div className="absolute inset-0" onClick={() => setShowCustomerFile(false)} />

          <motion.div
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{ type: "spring", damping: 26, stiffness: 280 }}
            className="relative w-full max-w-lg h-[92dvh] bg-card border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl z-10 flex flex-col overflow-hidden"
          >
            {/* Header Ficha Cadastral */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-muted/40 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-soft text-primary font-bold flex items-center justify-center text-sm border border-primary/20 shrink-0 overflow-hidden">
                  {isAiChat ? (
                    <AiAvatar tenantId={tenant} className="w-full h-full rounded-full" />
                  ) : activeChat.avatar ? (
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
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    Ficha Cadastral Completa
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowCustomerFile(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conteúdo Ficha Cadastral: SharedFiles (Dados, Arquivos, Eventos) */}
            <div className="flex-1 overflow-y-auto p-2">
              <SharedFiles />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
