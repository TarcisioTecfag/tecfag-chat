// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALENTINA CHAT TAB — Chat interativo com a assistente Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Bot, Send, Sparkles, ArrowRight, AlertTriangle, User as UserIcon,
  Clock, Users, Award, Globe, Plus, Image as ImageIcon, ChevronDown, RefreshCw, Loader2
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import {
  ValentinaChatMessage,
  VALENTINA_WELCOME_MESSAGES,
} from "./valentina-mock-data";

// ── Componente de card especial (lead transferido) ──────────────────────────
function LeadCard({ data }: { data: Record<string, any> }) {
  return (
    <div className="mt-2 rounded-xl border border-primary/20 bg-primary-soft p-3 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="font-extrabold text-primary">Lead Qualificado</span>
      </div>
      <div className="space-y-1 text-foreground/80">
        <p><span className="font-semibold">Nome:</span> {data.name || "—"}</p>
        <p><span className="font-semibold">Empresa:</span> {data.company || "—"}</p>
        <p><span className="font-semibold">Score:</span> {data.score || "—"}/100</p>
      </div>
      <button className="mt-2 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90 transition cursor-pointer">
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
  const { operatorProfile, currentOperatorId } = useChat();
  const [messages, setMessages] = useState<ValentinaChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Abort controller: cancela a IA em voo quando o operador digita mais
  const abortCtrl = useRef<AbortController | null>(null);

  const operatorFirstName = operatorProfile?.name?.split(" ")[0] || "Operador";

  // ── Debounce de 15s: acumula mensagens antes de enviar à IA ─────────────────
  const pendingMessages  = useRef<string[]>([]);
  const debounceTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [waitSecondsLeft, setWaitSecondsLeft] = useState<number | null>(null);
  const countdownTimer   = useRef<ReturnType<typeof setInterval> | null>(null);

  const suggestions = [
    {
      text: "Como está o tempo médio de atendimento (TMA) geral?",
      icon: Clock,
      iconColor: "text-primary",
    },
    {
      text: "Quem são os operadores com mais gargalo de fila?",
      icon: Users,
      iconColor: "text-blue-500",
    },
    {
      text: "Qual é a taxa de conversão do SDR de hoje?",
      icon: Award,
      iconColor: "text-amber-500",
    },
    {
      text: "Quantos alertas de estouro de SLA tivemos hoje?",
      icon: AlertTriangle,
      iconColor: "text-red-500",
    },
  ];

  // ── Carrega histórico persistente do banco na montagem ────────────────────
  useEffect(() => {
    if (!currentOperatorId) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/valentina/messages?tenantId=valem&operatorId=${currentOperatorId}`
        );
        if (!res.ok) throw new Error("fetch failed");
        const rows: any[] = await res.json();
        if (rows.length > 0) {
          const mapped: ValentinaChatMessage[] = rows.map((r) => ({
            id: r.id,
            sender: r.direction === "to_agent" ? "operator" : "valentina",
            content: r.content,
            timestamp: r.createdAt || new Date().toISOString(),
            type: (r.metadata?.type as any) || "text",
            cardData: r.metadata?.cardData,
          }));
          setMessages(mapped);
        } else {
          // Sem histórico: exibe mensagens de boas-vindas
          setMessages([...VALENTINA_WELCOME_MESSAGES]);
        }
      } catch {
        setMessages([...VALENTINA_WELCOME_MESSAGES]);
      } finally {
        setHistoryLoaded(true);
      }
    })();
  }, [currentOperatorId]);

  // Auto-scroll quando novas mensagens chegam
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isTyping]);

  // ── Dispara a IA com todas as mensagens acumuladas ───────────────────────
  const flushToAI = async (batch: string[]) => {
    const combinedContent = batch.join("\n");

    // Aborta qualquer requisição em voo anterior
    abortCtrl.current?.abort();
    const ctrl = new AbortController();
    abortCtrl.current = ctrl;

    setIsTyping(true);
    setWaitSecondsLeft(null);

    try {
      const res = await fetch("/api/valentina/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal, // abort quando operação cancelada
        body: JSON.stringify({
          tenantId: "valem",
          operatorId: currentOperatorId || "system",
          content: combinedContent,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const fragments = data.fragments || [];

      // Processar fragmentos com delays para simular digitação
      for (let i = 0; i < fragments.length; i++) {
        const frag = fragments[i];
        const delay = frag.delay || (i * 800);

        if (i > 0) setIsTyping(true); // mantém digitando entre fragmentos
        await new Promise((r) => setTimeout(r, Math.max(delay, 400)));

        const valentinaMsg: ValentinaChatMessage = {
          id: frag.id || `val-${Date.now()}-${i}`,
          sender: "valentina",
          content: frag.content || frag.text || "",
          timestamp: new Date().toISOString(),
          type: "text",
        };

        setMessages((prev) => [...prev, valentinaMsg]);
      }

      // Alertas são mostrados separadamente (não misturar com respostas)
      const alerts = data.alerts || [];
      for (const alert of alerts) {
        const alertMsg: ValentinaChatMessage = {
          id: `val-alert-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          sender: "valentina",
          content: `${alert.clientName || "Cliente"} está aguardando há ${alert.waitMinutes || "?"} minutos`,
          timestamp: new Date().toISOString(),
          type: "sla_card",
          cardData: {
            description: `${alert.clientName || "Cliente"} aguardando há ${alert.waitMinutes || "?"} minutos. ${alert.lastMessage || ""}`,
          },
        };
        setMessages((prev) => [...prev, alertMsg]);
      }

      if (fragments.length === 0 && alerts.length === 0) {
        throw new Error("Nenhum fragmento recebido");
      }
    } catch (err: any) {
      // Ignora silenciosamente se foi um abort intencional (operador enviou nova mensagem)
      if (err?.name === "AbortError") return;
      console.error("[ValentinaChatTab] Erro:", err);
      const errorMsg: ValentinaChatMessage = {
        id: `val-err-${Date.now()}`,
        sender: "valentina",
        content: "Ops, tive um problema pra processar. Pode tentar de novo? 😅",
        timestamp: new Date().toISOString(),
        type: "text",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  // ── Envia mensagem do operador com debounce de 15s ────────────────────
  const handleSendWithText = (textToSend: string) => {
    if (!textToSend.trim()) return;

    // Se Valentina está processando, cancela e repensa tudo do zero
    if (isTyping) {
      abortCtrl.current?.abort();
      setIsTyping(false);
    }

    // Adiciona mensagem do operador visualmente de imediato
    const operatorMsg: ValentinaChatMessage = {
      id: `op-${Date.now()}`,
      sender: "operator",
      content: textToSend,
      timestamp: new Date().toISOString(),
      type: "text",
    };
    setMessages((prev) => [...prev, operatorMsg]);
    setInput("");

    // Acumula no batch
    pendingMessages.current.push(textToSend);

    // Limpa timers anteriores
    if (debounceTimer.current)  clearTimeout(debounceTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);

    // Inicia countdown visual de 15s
    const WAIT_SEC = 15;
    setWaitSecondsLeft(WAIT_SEC);
    let remaining = WAIT_SEC;
    countdownTimer.current = setInterval(() => {
      remaining -= 1;
      setWaitSecondsLeft(remaining > 0 ? remaining : null);
      if (remaining <= 0 && countdownTimer.current) {
        clearInterval(countdownTimer.current);
        countdownTimer.current = null;
      }
    }, 1000);

    // Agenda o envio para daqui 15s
    debounceTimer.current = setTimeout(() => {
      const batch = [...pendingMessages.current];
      pendingMessages.current = [];
      setWaitSecondsLeft(null);
      if (countdownTimer.current) { clearInterval(countdownTimer.current); countdownTimer.current = null; }
      flushToAI(batch);
    }, WAIT_SEC * 1000);
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

  // Animações
  const containerVariants: any = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.1 }
    }
  };

  const itemVariants: any = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] } }
  };

  if (!hasChatted) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 overflow-y-auto scrollbar-thin select-none">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="text-center max-w-2xl w-full flex flex-col items-center"
        >
          {/* Welcome Text */}
          <h2 className="text-3xl font-extrabold text-foreground leading-tight">
            Olá, <span className="text-primary">{operatorFirstName}</span>
          </h2>
          <h3 className="text-2xl font-bold text-foreground/80 mt-1">
            O que você gostaria de saber hoje?
          </h3>
          <p className="text-xs text-muted-foreground mt-3">
            Use uma das sugestões mais comuns abaixo ou faça sua própria pergunta para iniciar
          </p>

          {/* Grid of 4 suggestions */}
          <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 w-full">
            {suggestions.map((sug, idx) => {
              const SugIcon = sug.icon;
              return (
                <motion.button
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  key={idx}
                  onClick={() => handleSendWithText(sug.text)}
                  className="flex flex-col justify-between items-start text-left p-4 rounded-2xl border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-colors duration-150 cursor-pointer shadow-soft group min-h-[120px]"
                >
                  <span className="text-xs font-semibold text-foreground leading-snug group-hover:text-primary transition-colors">
                    {sug.text}
                  </span>
                  <div className={`mt-4 p-2 rounded-xl bg-muted group-hover:bg-primary-soft transition-colors`}>
                    <SugIcon className={`h-4 w-4 ${sug.iconColor}`} />
                  </div>
                </motion.button>
              );
            })}
          </motion.div>

          <motion.button 
            variants={itemVariants}
            whileHover={{ scale: 1.05 }}
            className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            Atualizar Sugestões
          </motion.button>
        </motion.div>

        {/* Centered Large Input Field */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="mt-12 w-full max-w-2xl"
        >
          <div className="flex flex-col gap-2 rounded-2xl bg-card border border-border px-4 py-3 shadow-soft focus-within:border-primary transition duration-150">
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
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted text-muted-foreground text-[10px] font-bold cursor-pointer hover:bg-muted/80 transition-colors">
                <Globe className="h-3 w-3 text-primary" />
                <span>Toda a Base</span>
                <ChevronDown className="h-2.5 w-2.5" />
              </div>
            </div>

            {/* Bottom Actions Row */}
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-line">
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer">
                  <Plus className="h-3.5 w-3.5 text-primary" />
                  <span>Anexar arquivo</span>
                </button>
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer">
                  <ImageIcon className="h-3.5 w-3.5 text-primary" />
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
                      ? "bg-primary text-primary-foreground hover:opacity-95 shadow-soft"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Área de mensagens */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin"
      >
        <div className="max-w-2xl mx-auto w-full space-y-6">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className={`flex gap-4 items-start ${m.sender === "operator" ? "justify-end" : "justify-start"}`}
              >
                {/* Avatar da Valentina */}
                {m.sender === "valentina" && (
                  <img src="/valentina.png" alt="Valentina" className="h-8 w-8 rounded-full object-cover border border-border shrink-0 shadow-soft mt-0.5" />
                )}

                {/* Conteúdo da mensagem */}
                <div className="flex-1 min-w-0 max-w-[85%] space-y-1">
                  {m.sender === "valentina" ? (
                    <div className="space-y-3">
                      {/* Texto puro da Valentina */}
                      <div className="text-xs text-foreground leading-relaxed pr-6">
                        {m.content}
                      </div>

                      {/* Cards especiais */}
                      {m.type === "lead_card" && m.cardData && <LeadCard data={m.cardData} />}
                      {m.type === "sla_card" && m.cardData && <SlaAlertCard data={m.cardData} />}
                    </div>
                  ) : (
                    /* Balão suave para o operador */
                    <div className="flex justify-end">
                      <div className="bg-primary-soft border border-primary/20 text-foreground px-4 py-3 rounded-2xl rounded-tr-[4px] text-xs leading-relaxed shadow-soft">
                        {m.content}
                      </div>
                    </div>
                  )}

                  {/* Horário */}
                  <span className={`block text-[9px] text-muted-foreground/60 font-semibold mt-1 ${m.sender === "operator" ? "text-right mr-1" : "text-left ml-0.5"}`}>
                    {formatTime(m.timestamp)}
                  </span>
                </div>

                {/* Avatar do operador */}
                {m.sender === "operator" && (
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft border border-primary/20 text-primary shrink-0 shadow-soft mt-0.5">
                    <UserIcon className="h-4 w-4" />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Indicador de digitação (IA processando) */}
          <AnimatePresence>
            {isTyping && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex gap-4 items-start"
              >
                <img src="/valentina.png" alt="Valentina" className="h-8 w-8 rounded-full object-cover border border-border shrink-0 shadow-soft mt-0.5" />
                <div className="rounded-2xl rounded-bl-[5px] bg-primary-soft border border-primary/20 px-4 py-2.5 text-xs text-primary font-medium shadow-soft">
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

          {/* Countdown: aguardando mais mensagens antes de enviar à IA */}
          <AnimatePresence>
            {waitSecondsLeft !== null && !isTyping && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex gap-4 items-center"
              >
                <img src="/valentina.png" alt="Valentina" className="h-8 w-8 rounded-full object-cover border border-border shrink-0 shadow-soft opacity-60" />
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-[5px] bg-muted border border-border px-4 py-2.5 text-xs text-muted-foreground shadow-soft">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  >
                    <Clock className="h-3 w-3 text-primary" />
                  </motion.div>
                  <span>
                    Valentina aguardando mais mensagens
                    <span className="font-black text-primary ml-1">{waitSecondsLeft}s</span>
                    <span className="text-[10px] ml-1 text-muted-foreground/60">— envie mais ou aguarde</span>
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Barra de input centralizada no rodapé */}
      <div className="shrink-0 border-t border-line px-4 py-4 bg-background">
        <div className="max-w-2xl mx-auto w-full">
          <div className="flex flex-col gap-2 rounded-2xl bg-card border border-border px-4 py-3 shadow-soft focus-within:border-primary transition duration-150">
            {/* Input field row */}
            <div className="flex items-center justify-between">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pergunte algo à Valentina..."
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none pr-4"
              />
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted text-muted-foreground text-[10px] font-bold cursor-pointer hover:bg-muted/80 transition-colors">
                <Globe className="h-3 w-3 text-primary" />
                <span>Toda a Base</span>
                <ChevronDown className="h-2.5 w-2.5" />
              </div>
            </div>

            {/* Bottom Actions Row */}
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-line">
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer">
                  <Plus className="h-3.5 w-3.5 text-primary" />
                  <span>Anexar arquivo</span>
                </button>
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer">
                  <ImageIcon className="h-3.5 w-3.5 text-primary" />
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
                      ? "bg-primary text-primary-foreground hover:opacity-95 shadow-soft"
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
    </div>
  );
}
