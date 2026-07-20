// ══════════════════════════════════════════════════════════════════════════════
// 📋 SDR TAB — Monitoramento de triagens SDR com layout em 3 painéis
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus, CheckCircle, Clock, XCircle, Bot, User as UserIcon,
  ChevronRight, Circle, Search, ExternalLink
} from "lucide-react";
import { SDR_TRIAGE_SESSIONS, SdrTriageSession } from "./valentina-mock-data";
import { useChat } from "@/hooks/useChatState";
import { toast } from "sonner";

// ── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SdrTriageSession["status"] }) {
  const styles = {
    active: "bg-primary-soft text-primary border-primary/20",
    completed: "bg-gray-100 text-gray-600 border-gray-200",
    abandoned: "bg-red-100 text-red-600 border-red-200",
  };
  const labels = { active: "Ativo", completed: "Concluído", abandoned: "Abandonado" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${styles[status]}`}>
      {status === "active" && <Circle className="h-2 w-2 fill-primary text-primary" />}
      {status === "completed" && <CheckCircle className="h-2.5 w-2.5" />}
      {status === "abandoned" && <XCircle className="h-2.5 w-2.5" />}
      {labels[status]}
    </span>
  );
}

// ── Componente principal ────────────────────────────────────────────────────

export function SdrTab() {
  const { setActiveView, setSelectedChatId } = useChat();
  const [selectedSession, setSelectedSession] = useState<SdrTriageSession>(SDR_TRIAGE_SESSIONS[0]);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSessions = SDR_TRIAGE_SESSIONS.filter((session) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    
    // 1. Nome
    const matchName = session.contactName.toLowerCase().includes(q);
    // 2. Empresa / Detalhes
    const matchCompany = session.company.toLowerCase().includes(q);
    // 3. Conversa falada até o momento (mensagens no histórico)
    const matchMessages = session.messages.some((msg) =>
      msg.text.toLowerCase().includes(q)
    );

    return matchName || matchCompany || matchMessages;
  });

  // Auto-seleciona a primeira opção filtrada caso a seleção atual suma no filtro
  useEffect(() => {
    if (filteredSessions.length > 0 && !filteredSessions.some(s => s.id === selectedSession.id)) {
      setSelectedSession(filteredSessions[0]);
    }
  }, [searchQuery, filteredSessions, selectedSession]);

  return (
    <div className="flex gap-4 h-full overflow-hidden">
      {/* ── PAINEL ESQUERDO — Lista de sessões (30%) ──────────────────────── */}
      <div className="w-[30%] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
        <div className="px-4 py-3 border-b border-line shrink-0 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
                <UserPlus className="h-3.5 w-3.5 text-primary" />
                Triagens SDR
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {SDR_TRIAGE_SESSIONS.filter((s) => s.status === "active").length} ativas de {SDR_TRIAGE_SESSIONS.length} total
              </p>
            </div>
          </div>

          {/* Barra de Pesquisa */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
            <input
              type="text"
              placeholder="Buscar por nome, empresa ou fala..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-border bg-muted/20 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50 text-foreground"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {filteredSessions.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10 italic">Nenhuma triagem encontrada.</p>
          ) : (
            filteredSessions.map((session) => {
              const isSelected = selectedSession.id === session.id;
              const completedCount = Object.values(session.collectedData).filter(d => d.status === "filled").length;
              const totalCount = Object.keys(session.collectedData).length;
              const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
              
              return (
                <button
                  key={session.id}
                  onClick={() => setSelectedSession(session)}
                  className={`w-full text-left px-4 py-3 border-b border-line transition cursor-pointer ${
                    isSelected
                      ? "bg-primary-soft border-l-2 border-l-primary"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-foreground truncate">{session.contactName}</span>
                    <StatusBadge status={session.status} />
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{session.company}</p>
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-muted-foreground">
                        Campos {completedCount}/{totalCount}
                      </span>
                      <span className="text-[10px] font-semibold text-primary">
                        {Math.round(progressPct)}%
                      </span>
                    </div>
                    <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── PAINEL CENTRAL — Preview do chat (45%) ───────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
        <div className="px-4 py-3 border-b border-line shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-extrabold text-foreground">{selectedSession.contactName}</h3>
              <p className="text-[10px] text-muted-foreground">{selectedSession.company} · {selectedSession.currentStep}</p>
            </div>
            <StatusBadge status={selectedSession.status} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 scrollbar-thin">
          <AnimatePresence initial={false}>
            {selectedSession.messages.map((msg, idx) => (
              <motion.div
                key={`${selectedSession.id}-${idx}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, delay: idx * 0.03 }}
                className={`flex ${msg.sender === "bot" ? "justify-end" : "justify-start"}`}
              >
                {msg.sender === "client" && (
                  <div className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-primary shrink-0 mr-2 self-end">
                    <UserIcon className="h-3 w-3" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed shadow-soft ${
                    msg.sender === "bot"
                      ? "bg-primary text-primary-foreground rounded-br-[5px]"
                      : "bg-muted border border-border text-foreground rounded-bl-[5px]"
                  }`}
                >
                  {msg.text}
                  <span
                    className={`block mt-1 text-[9px] ${
                      msg.sender === "bot" ? "text-white/60" : "text-muted-foreground"
                    }`}
                  >
                    {msg.time}
                  </span>
                </div>
                {msg.sender === "bot" && (
                  <div className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shrink-0 ml-2 self-end">
                    <Bot className="h-3 w-3" />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Resultado se concluído/abandonado */}
          {selectedSession.outcome && (
            <div className="flex justify-center mt-3 animate-fadeIn">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold ${
                selectedSession.status === "completed"
                  ? "bg-primary-soft text-primary"
                  : "bg-red-100 text-red-600"
              }`}>
                {selectedSession.status === "completed" ? (
                  <CheckCircle className="h-3 w-3" />
                ) : (
                  <XCircle className="h-3 w-3" />
                )}
                {selectedSession.outcome}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── PAINEL DIREITO — Dados coletados (25%) ───────────────────────── */}
      <div className="w-[25%] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
        <div className="px-4 py-3 border-b border-line shrink-0 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
              Dados Coletados
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {Object.values(selectedSession.collectedData).filter((d) => d.status === "filled").length} de{" "}
              {Object.keys(selectedSession.collectedData).length} campos
            </p>
          </div>

          <button
            onClick={() => {
              // Mapear sessões SDR para IDs de conversas reais/mockadas correspondentes no chat
              const idMap: Record<string, string> = {
                "sdr-001": "chat-mock-1",
                "sdr-002": "chat-mock-2",
                "sdr-003": "chat-mock-3",
                "sdr-004": "chat-mock-4",
              };
              const targetChatId = idMap[selectedSession.id] || "chat-mock-1";
              setSelectedChatId(targetChatId);
              setActiveView("chat");
              toast.info("Redirecionando para a conversa...");
            }}
            className="text-[10px] font-black text-primary hover:text-primary-hover bg-primary/10 hover:bg-primary/15 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer shrink-0"
            title="Abrir atendimento correspondente"
          >
            <ExternalLink className="h-3 w-3" />
            Abrir
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 scrollbar-thin">
          {Object.entries(selectedSession.collectedData).map(([key, data]) => (
            <div
              key={key}
              className={`rounded-xl border p-3 transition ${
                data.status === "filled"
                  ? "border-primary/20 bg-primary-soft/30"
                  : "border-border bg-muted/30"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {key}
                </span>
                {data.status === "filled" ? (
                  <CheckCircle className="h-3 w-3 text-primary" />
                ) : (
                  <Clock className="h-3 w-3 text-muted-foreground/50" />
                )}
              </div>
              <p className={`text-xs font-bold ${
                data.status === "filled" ? "text-foreground" : "text-muted-foreground/40 italic"
              }`}>
                {data.status === "filled" ? data.value : "Aguardando..."}
              </p>
            </div>
          ))}
        </div>

        {/* Informações extras no rodapé */}
        <div className="px-4 py-3 border-t border-line shrink-0 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            Início: {new Date(selectedSession.startedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <ChevronRight className="h-3 w-3" />
            Etapa atual: <span className="font-semibold text-foreground truncate block max-w-[150px]">{selectedSession.currentStep}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
