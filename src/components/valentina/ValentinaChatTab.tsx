// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALENTINA CHAT TAB — Chat interativo com a assistente Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Send, Sparkles, ArrowRight, AlertTriangle, User as UserIcon } from "lucide-react";
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
  const [messages, setMessages] = useState<ValentinaChatMessage[]>([...VALENTINA_WELCOME_MESSAGES]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const responseIndex = useRef(0);

  // Auto-scroll quando novas mensagens chegam
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isTyping]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    // Adiciona mensagem do operador
    const operatorMsg: ValentinaChatMessage = {
      id: `op-${Date.now()}`,
      sender: "operator",
      content: text,
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

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
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
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
