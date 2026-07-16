// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALENTINA CHAT TAB — Chat interativo com a assistente Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Bot, Send, Sparkles, ArrowRight, AlertTriangle, User as UserIcon,
  Clock, Users, Award, Globe, Plus, Image as ImageIcon, ChevronDown, RefreshCw 
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import {
  ValentinaChatMessage,
  VALENTINA_WELCOME_MESSAGES,
  VALENTINA_MOCK_RESPONSES,
} from "./valentina-mock-data";

// ── Componente de card especial (lead transferido) ──────────────────────────
function LeadCard({ data }: { data: Record<string, any> }) {
  return (
    <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
        <span className="font-extrabold text-emerald-700">Lead Qualificado</span>
      </div>
      <div className="space-y-1 text-emerald-900/80">
        <p><span className="font-semibold">Nome:</span> {data.name || "—"}</p>
        <p><span className="font-semibold">Empresa:</span> {data.company || "—"}</p>
        <p><span className="font-semibold">Score:</span> {data.score || "—"}/100</p>
      </div>
      <button className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 transition cursor-pointer">
        <ArrowRight className="h-3 w-3" />
        Ver Detalhes
      </button>
    </div>
  );
}

function SlaAlertCard({ data }: { data: Record<string, any> }) {
  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        <span className="font-extrabold text-amber-700">Alerta SLA</span>
      </div>
      <p className="text-amber-900/80">{data.description || "SLA em risco."}</p>
    </div>
  );
}

// ── Componente principal ────────────────────────────────────────────────────

export function ValentinaChatTab() {
  const { operatorProfile } = useChat();
  const [messages, setMessages] = useState<ValentinaChatMessage[]>([...VALENTINA_WELCOME_MESSAGES]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const responseIndex = useRef(0);

  const operatorFirstName = operatorProfile?.name?.split(" ")[0] || "Operador";

  const suggestions = [
    {
      text: "Qual o meu tempo médio de resposta hoje?",
      icon: Clock,
      iconColor: "text-emerald-500",
    },
    {
      text: "Quantos leads recebi hoje na minha carteira?",
      icon: Users,
      iconColor: "text-blue-500",
    },
    {
      text: "Como está meu desempenho e ranking hoje?",
      icon: Award,
      iconColor: "text-amber-500",
    },
    {
      text: "Quem está há mais tempo sem resposta na fila?",
      icon: AlertTriangle,
      iconColor: "text-red-500",
    },
  ];

  // Auto-scroll quando novas mensagens chegam
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isTyping]);

  const handleSendWithText = (textToSend: string) => {
    if (!textToSend.trim()) return;

    // Adiciona mensagem do operador
    const operatorMsg: ValentinaChatMessage = {
      id: `op-${Date.now()}`,
      sender: "operator",
      content: textToSend,
      timestamp: new Date().toISOString(),
      type: "text",
    };
    setMessages((prev) => [...prev, operatorMsg]);
    setInput("");
    setIsTyping(true);

    // Simula resposta da Valentina após delay
    setTimeout(() => {
      const response = VALENTINA_MOCK_RESPONSES[responseIndex.current % VALENTINA_MOCK_RESPONSES.length];
      responseIndex.current++;

      const valentinaMsg: ValentinaChatMessage = {
        id: `val-${Date.now()}`,
        sender: "valentina",
        content: response,
        timestamp: new Date().toISOString(),
        // A cada 4 respostas, envia um card especial
        ...(responseIndex.current % 4 === 0
          ? {
              type: "lead_card" as const,
              cardData: {
                name: "Carlos Mendes",
                company: "Indústria SM Ltda",
                score: 87,
              },
            }
          : responseIndex.current % 7 === 0
          ? {
              type: "sla_card" as const,
              cardData: {
                description: "Conversa #4821 — Marcos Vieira aguardando há 9 minutos. SLA crítico!",
              },
            }
          : { type: "text" as const }),
      };

      setMessages((prev) => [...prev, valentinaMsg]);
      setIsTyping(false);
    }, 1500);
  };

  const handleSend = () => {
    handleSendWithText(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const hasChatted = messages.some((m) => m.sender === "operator");

  if (!hasChatted) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 overflow-y-auto scrollbar-thin select-none">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-2xl w-full flex flex-col items-center"
        >
          {/* Welcome Text */}
          <h2 className="text-3xl font-extrabold text-foreground leading-tight">
            Olá, <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">{operatorFirstName}</span>
          </h2>
          <h3 className="text-2xl font-bold text-foreground/80 mt-1">
            O que você gostaria de saber hoje?
          </h3>
          <p className="text-xs text-muted-foreground mt-3">
            Use uma das sugestões mais comuns abaixo ou faça sua própria pergunta para iniciar
          </p>

          {/* Grid of 4 suggestions */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 w-full">
            {suggestions.map((sug, idx) => {
              const SugIcon = sug.icon;
              return (
                <button
                  key={idx}
                  onClick={() => handleSendWithText(sug.text)}
                  className="flex flex-col justify-between items-start text-left p-4 rounded-2xl border border-border bg-card hover:bg-muted/40 hover:border-emerald-200 transition duration-150 cursor-pointer shadow-soft group min-h-[120px]"
                >
                  <span className="text-xs font-semibold text-foreground leading-snug group-hover:text-emerald-700 transition">
                    {sug.text}
                  </span>
                  <div className={`mt-4 p-2 rounded-xl bg-muted group-hover:bg-emerald-50 transition`}>
                    <SugIcon className={`h-4 w-4 ${sug.iconColor}`} />
                  </div>
                </button>
              );
            })}
          </div>

          <button className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition cursor-pointer">
            <RefreshCw className="h-3 w-3" />
            Atualizar Sugestões
          </button>
        </motion.div>

        {/* Centered Large Input Field */}
        <div className="mt-12 w-full max-w-2xl">
          <div className="flex flex-col gap-2 rounded-2xl bg-card border border-border px-4 py-3 shadow-soft focus-within:border-emerald-500 transition duration-150">
            {/* Input field row */}
            <div className="flex items-center justify-between">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pergunte o que quiser..."
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none pr-4"
              />
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted text-muted-foreground text-[10px] font-bold cursor-pointer hover:bg-muted/80 transition">
                <Globe className="h-3 w-3 text-emerald-600" />
                <span>Toda a Base</span>
                <ChevronDown className="h-2.5 w-2.5" />
              </div>
            </div>

            {/* Bottom Actions Row */}
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-line">
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer">
                  <Plus className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Anexar arquivo</span>
                </button>
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer">
                  <ImageIcon className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Usar imagem</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[10px] font-medium text-muted-foreground/60">
                  {input.length}/1000
                </span>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className={`grid h-8 w-8 place-items-center rounded-xl transition cursor-pointer ${
                    input.trim() && !isTyping
                      ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-soft"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Área de mensagens */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin"
      >
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className={`flex ${m.sender === "operator" ? "justify-end" : "justify-start"}`}
            >
              {/* Avatar da Valentina */}
              {m.sender === "valentina" && (
                <div className="flex items-end mr-2 shrink-0">
                  <div className="grid h-7 w-7 place-items-center rounded-full bg-emerald-600 text-white">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                </div>
              )}

              {/* Balão */}
              <div className="max-w-[75%] min-w-0">
                <div
                  className={`rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-soft ${
                    m.sender === "valentina"
                      ? "bg-emerald-600 text-white rounded-bl-[5px]"
                      : "bg-primary text-primary-foreground rounded-br-[5px]"
                  }`}
                >
                  {m.content}

                  {/* Cards especiais */}
                  {m.type === "lead_card" && m.cardData && <LeadCard data={m.cardData} />}
                  {m.type === "sla_card" && m.cardData && <SlaAlertCard data={m.cardData} />}
                </div>

                {/* Horário */}
                <span
                  className={`mt-1 block text-[10px] text-muted-foreground font-medium ${
                    m.sender === "operator" ? "text-right" : "text-left"
                  }`}
                >
                  {formatTime(m.timestamp)}
                </span>
              </div>

              {/* Avatar do operador */}
              {m.sender === "operator" && (
                <div className="flex items-end ml-2 shrink-0">
                  <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary">
                    <UserIcon className="h-3.5 w-3.5" />
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Indicador de digitação */}
        <AnimatePresence>
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-2"
            >
              <div className="grid h-7 w-7 place-items-center rounded-full bg-emerald-600 text-white shrink-0">
                <Bot className="h-3.5 w-3.5" />
              </div>
              <div className="rounded-2xl rounded-bl-[5px] bg-emerald-100 px-4 py-2.5 text-xs text-emerald-700 font-medium">
                <span className="inline-flex items-center gap-1">
                  Valentina está digitando
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  >
                    ...
                  </motion.span>
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Barra de input */}
      <div className="shrink-0 border-t border-line px-4 py-3">
        <div className="flex items-center gap-3 rounded-2xl bg-muted border border-border px-4 py-2.5 shadow-soft">
          <Sparkles className="h-4 w-4 text-emerald-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte algo à Valentina..."
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none pr-4"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className={`grid h-8 w-8 place-items-center rounded-xl transition cursor-pointer ${
              input.trim() && !isTyping
                ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-soft"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            }`}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
