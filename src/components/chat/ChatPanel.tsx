import React, { useState, useRef, useEffect } from "react";
import { useChat } from "@/hooks/useChatState";
import { WhatsappLogo, InstagramLogo, MessengerLogo } from "./ChatList";
import {
  Smile,
  Paperclip,
  Send,
  Lock,
  UserPlus,
  CheckCircle,
  Zap,
  Clock,
  ArrowRightLeft,
  ChevronDown,
  ChevronLeft,
  FileText,
  Download,
} from "lucide-react";
import { QUICK_RESPONSES } from "@/lib/mockData";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

function renderMessageContent(text: string) {
  if (text.startsWith("[MEDIA:")) {
    const match = text.match(/^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::(.+))?$/);
    if (match) {
      const [, type, messageId, extra] = match;
      const mediaUrl = `${BACKEND_URL}/api/baileys/media?messageId=${messageId}`;

      if (type === "image") {
        return (
          <div className="relative group max-w-sm rounded-xl overflow-hidden border border-border bg-black/5 hover:opacity-95 transition cursor-pointer">
            <img 
              src={mediaUrl} 
              alt="Imagem" 
              className="max-h-60 w-full object-contain"
              onClick={() => window.open(mediaUrl, "_blank")}
            />
          </div>
        );
      }

      if (type === "video") {
        return (
          <div className="relative max-w-sm rounded-xl overflow-hidden border border-border bg-black/5">
            <video 
              controls 
              src={mediaUrl} 
              className="max-h-60 w-full object-contain"
            />
          </div>
        );
      }

      if (type === "audio") {
        return (
          <div className="flex items-center gap-2 py-1 min-w-[260px]">
            <audio 
              controls 
              src={mediaUrl} 
              className="w-full h-8"
              preload="metadata"
            />
          </div>
        );
      }

      if (type === "document") {
        const fileName = extra || "documento";
        return (
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-muted/40 border border-border min-w-[240px] max-w-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-100 text-red-600">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-foreground">{fileName}</p>
                <p className="text-[10px] text-muted-foreground uppercase font-medium">Documento</p>
              </div>
            </div>
            <a 
              href={mediaUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              download={fileName}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card border border-border text-foreground hover:bg-muted transition"
              title="Baixar Documento"
            >
              <Download className="h-4 w-4" />
            </a>
          </div>
        );
      }

      if (type === "sticker") {
        return (
          <div className="relative max-w-[120px] overflow-hidden">
            <img 
              src={mediaUrl} 
              alt="Figurinha" 
              className="h-28 w-28 object-contain"
            />
          </div>
        );
      }
    }
  }

  // Fallback para texto plano
  return <p className="whitespace-pre-wrap">{text}</p>;
}

export function ChatPanel() {
  const {
    activeChat,
    sendMessage,
    captureChat,
    transferChat,
    finishChat,
    rightSidebarOpen,
    setRightSidebarOpen,
  } = useChat();

  const [text, setText] = useState("");
  const [msgMode, setMsgMode] = useState<"client" | "internal">("client");
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [showTransferDropdown, setShowTransferDropdown] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages]);

  if (!activeChat) {
    return (
      <section className="flex h-full min-w-0 flex-1 flex-col items-center justify-center rounded-3xl bg-chat-panel border border-border shadow-soft text-muted-foreground select-none">
        <div className="text-center max-w-sm p-6">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-muted mx-auto mb-4">
            <Zap className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Nenhum Atendimento Ativo</h3>
          <p className="text-sm mt-2">
            Selecione uma conversa na barra lateral esquerda ou capture uma da Fila de Espera para iniciar o atendimento.
          </p>
        </div>
      </section>
    );
  }

  const handleSend = () => {
    if (!text.trim()) return;
    sendMessage(text, msgMode === "internal");
    setText("");
    setShowQuickMenu(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setText(val);
    
    // Show quick replies menu if text starts with "/"
    if (val.startsWith("/")) {
      setShowQuickMenu(true);
    } else {
      setShowQuickMenu(false);
    }
  };

  const selectQuickResponse = (response: string) => {
    setText(response);
    setShowQuickMenu(false);
    inputRef.current?.focus();
  };

  const departments = ["Comercial Valem", "Comercial Tecfag", "Faturamento", "Suporte Técnico", "Financeiro"];

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-chat-panel border border-border shadow-soft relative">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between px-6 py-4 border-b border-border bg-card rounded-t-3xl">
        <div className="flex items-center gap-3">
          {/* Avatar & Channel Badge */}
          <div className="relative">
            {activeChat.avatar ? (
              <img src={activeChat.avatar} alt={activeChat.name} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div
                className="grid h-10 w-10 place-items-center rounded-full text-xs font-bold text-foreground"
                style={{ background: activeChat.initialsBg || "#eee" }}
              >
                {activeChat.initials || "U"}
              </div>
            )}
            <span className={`absolute -bottom-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-card text-white ${
              activeChat.channel === "whatsapp"
                ? "bg-emerald-500"
                : activeChat.channel === "instagram"
                ? "bg-gradient-to-tr from-yellow-500 to-purple-600"
                : "bg-blue-600"
            }`}>
              {activeChat.channel === "whatsapp" && <WhatsappLogo className="h-2.5 w-2.5" />}
              {activeChat.channel === "instagram" && <InstagramLogo className="h-2.5 w-2.5" />}
              {activeChat.channel === "messenger" && <MessengerLogo className="h-2.5 w-2.5" />}
            </span>
          </div>

          <div>
            <h2 className="text-sm font-bold text-foreground">{activeChat.name}</h2>
            <span className="text-[10px] text-muted-foreground font-semibold uppercase flex items-center gap-1.5 mt-0.5">
              {activeChat.queue === "meus" && (
                <span className="flex items-center gap-1 text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Meus Atendimentos
                </span>
              )}
              {activeChat.queue === "fila" && (
                <span className="flex items-center gap-1 text-amber-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Fila de Espera
                </span>
              )}
              {activeChat.queue === "automacao" && (
                <span className="flex items-center gap-1 text-blue-500 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Automação (I.A)
                </span>
              )}
              {activeChat.queue === "finalizados" && (
                <span className="flex items-center gap-1 text-gray-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> Atendimento Finalizado
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Handover Operations Actions */}
        <div className="flex items-center gap-2 relative">
          {!rightSidebarOpen && (
            <button
              onClick={() => setRightSidebarOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              title="Mostrar Painel de Informações"
            >
              <ChevronLeft className="h-4.5 w-4.5" strokeWidth={2.5} />
            </button>
          )}
          {activeChat.queue === "meus" ? (
            <>
              {/* Transfer Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowTransferDropdown(!showTransferDropdown)}
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-4 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Transferir
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showTransferDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowTransferDropdown(false)} />
                    <div className="absolute right-0 mt-1.5 z-50 w-48 rounded-xl bg-card p-1 border border-border shadow-card animate-in fade-in duration-100">
                      {departments.map((dept) => (
                        <button
                          key={dept}
                          onClick={() => {
                            transferChat(activeChat.id, dept);
                            setShowTransferDropdown(false);
                          }}
                          className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted transition"
                        >
                          {dept}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Finish Chat */}
              <button
                onClick={() => finishChat(activeChat.id)}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Finalizar
              </button>
            </>
          ) : (
            /* Claim Chat */
            activeChat.queue !== "finalizados" && (
              <button
                onClick={() => captureChat(activeChat.id)}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Capturar Atendimento
              </button>
            )
          )}
        </div>
      </header>

      {/* Messages Window */}
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 scrollbar-thin">
        {activeChat.messages.length > 0 ? (
          activeChat.messages.map((m) => {
            const isMe = m.author === "Você" || m.author === "Vendedor" || m.author === "Atendente Valem" || m.author === "Vendedor Humano";
            const isSystem = m.author === "Sistema";

            if (isSystem) {
              return (
                <div key={m.id} className="flex justify-center my-2">
                  <span className="rounded-full bg-muted px-4 py-1 text-[10px] font-semibold text-muted-foreground uppercase border border-border">
                    {m.text} — {m.time}
                  </span>
                </div>
              );
            }

            if (m.isInternalNote) {
              // YELLOW ALERTS STYLE FOR INTERNAL NOTES (RD Conversas style)
              return (
                <div key={m.id} className="flex flex-col items-center my-3 w-full">
                  <div className="max-w-[85%] rounded-2xl bg-amber-50 border border-amber-200 px-5 py-3 shadow-soft text-left">
                    <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-amber-700 uppercase mb-1">
                      <Lock className="h-3 w-3" />
                      Anotação Interna — {m.author} às {m.time}
                    </div>
                    <p className="text-xs text-amber-900 leading-relaxed font-medium">{m.text}</p>
                  </div>
                </div>
              );
            }

            const isSticker = m.text.startsWith("[MEDIA:sticker]");

            if (isMe) {
              return (
                <div key={m.id} className="flex flex-col items-end">
                  <span className="mb-0.5 text-[10px] text-muted-foreground font-medium">{m.author}, {m.time}</span>
                  {isSticker ? (
                    <div className="max-w-[70%] leading-relaxed">
                      {renderMessageContent(m.text)}
                    </div>
                  ) : (
                    <div className="max-w-[70%] rounded-2xl rounded-tr-md bg-bubble-out px-4 py-2.5 text-xs text-foreground leading-relaxed shadow-soft">
                      {renderMessageContent(m.text)}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={m.id} className="flex items-end gap-2.5">
                {activeChat.avatar ? (
                  <img src={activeChat.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover border border-border" />
                ) : (
                  <div
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-foreground"
                    style={{ background: activeChat.initialsBg || "#eee" }}
                  >
                    {activeChat.initials || "U"}
                  </div>
                )}
                <div className="min-w-0 max-w-[70%]">
                  <span className="mb-0.5 block text-[10px] text-muted-foreground font-medium">{m.author}, {m.time}</span>
                  {isSticker ? (
                    <div className="inline-block leading-relaxed">
                      {renderMessageContent(m.text)}
                    </div>
                  ) : (
                    <div className="inline-block rounded-2xl rounded-tl-md bg-card border border-border px-4 py-2.5 text-xs text-foreground leading-relaxed shadow-soft">
                      {renderMessageContent(m.text)}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground py-16">
            <Clock className="h-8 w-8 text-muted-foreground/30 mb-2" />
            <p className="text-xs">Nenhuma mensagem registrada.</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Quick Replies Menu */}
      {showQuickMenu && (
        <div className="absolute bottom-20 left-6 right-6 z-50 rounded-2xl bg-card p-2 border border-border shadow-card animate-in slide-in-from-bottom-2 duration-150 max-h-48 overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-line">
            Respostas Rápidas
          </div>
          {QUICK_RESPONSES.map((qr) => (
            <button
              key={qr.shortcut}
              onClick={() => selectQuickResponse(qr.text)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-muted transition cursor-pointer"
            >
              <span className="text-xs font-bold text-primary font-mono">{qr.shortcut}</span>
              <span className="truncate text-xs text-foreground/80 max-w-[280px] font-medium ml-2">{qr.text}</span>
              <span className="text-[10px] text-muted-foreground italic shrink-0">{qr.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Message Composer */}
      {activeChat.queue !== "finalizados" ? (
        <div className="px-5 pb-5">
          {/* Double Mode Selector (Mensagem vs Nota) */}
          <div className="flex gap-2 pl-2 mb-1.5 text-[11px] font-bold">
            <button
              onClick={() => setMsgMode("client")}
              className={`pb-1 border-b-2 px-1 transition ${
                msgMode === "client" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
              }`}
            >
              Enviar Mensagem
            </button>
            <button
              onClick={() => setMsgMode("internal")}
              className={`pb-1 border-b-2 px-1 transition ${
                msgMode === "internal" ? "border-amber-500 text-amber-600" : "border-transparent text-muted-foreground"
              }`}
            >
              Nota Interna
            </button>
          </div>

          <div
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 shadow-soft border transition-all duration-200 ${
              msgMode === "internal"
                ? "bg-amber-50/70 border-amber-200"
                : "bg-card border-border"
            }`}
          >
            <input
              ref={inputRef}
              placeholder={
                msgMode === "internal"
                  ? "Escreva uma nota interna (visível apenas para vendedores)..."
                  : "Escreva sua mensagem... (digite '/' para respostas rápidas)"
              }
              value={text}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />

            {/* Quick Template Icon */}
            <button
              onClick={() => setShowQuickMenu(!showQuickMenu)}
              className={`transition cursor-pointer ${
                msgMode === "internal" ? "text-amber-500 hover:text-amber-700" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Respostas Rápidas"
            >
              <Zap className="h-4.5 w-4.5" strokeWidth={2} />
            </button>

            <button className="text-muted-foreground hover:text-foreground cursor-pointer">
              <Smile className="h-4.5 w-4.5" strokeWidth={1.75} />
            </button>
            <button className="text-muted-foreground hover:text-foreground cursor-pointer">
              <Paperclip className="h-4.5 w-4.5" strokeWidth={1.75} />
            </button>

            <button
              onClick={handleSend}
              className={`grid h-9 w-9 place-items-center rounded-xl transition cursor-pointer text-white hover:opacity-90 ${
                msgMode === "internal" ? "bg-amber-500" : "bg-primary"
              }`}
            >
              {msgMode === "internal" ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 pb-5 text-center text-xs text-muted-foreground italic py-3 border-t border-line">
          Este atendimento foi encerrado. Mova-o de volta para "Meus Atendimentos" ou reative-o para enviar mensagens.
        </div>
      )}
    </section>
  );
}
