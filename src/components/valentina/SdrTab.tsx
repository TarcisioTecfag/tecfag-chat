// ══════════════════════════════════════════════════════════════════════════════
// 📋 SDR TAB — Monitoramento de triagens SDR com layout em 3 painéis
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus, CheckCircle, Clock, XCircle, Bot, User as UserIcon,
  ChevronRight, Circle,
} from "lucide-react";
import { SDR_TRIAGE_SESSIONS, SdrTriageSession } from "./valentina-mock-data";

// ── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SdrTriageSession["status"] }) {
  const styles = {
    active: "bg-emerald-100 text-emerald-700 border-emerald-200",
    completed: "bg-gray-100 text-gray-600 border-gray-200",
    abandoned: "bg-red-100 text-red-600 border-red-200",
  };
  const labels = { active: "Ativo", completed: "Concluído", abandoned: "Abandonado" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${styles[status]}`}>
      {status === "active" && <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />}
      {status === "completed" && <CheckCircle className="h-2.5 w-2.5" />}
      {status === "abandoned" && <XCircle className="h-2.5 w-2.5" />}
      {labels[status]}
    </span>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.min((current / total) * 100, 100);
  return (
    <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-emerald-600 transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Componente principal ────────────────────────────────────────────────────

export function SdrTab() {
  const [selectedSession, setSelectedSession] = useState<SdrTriageSession>(SDR_TRIAGE_SESSIONS[0]);

  return (
    <div className="flex gap-4 h-full overflow-hidden">
      {/* ── PAINEL ESQUERDO — Lista de sessões (30%) ──────────────────────── */}
      <div className="w-[30%] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
        <div className="px-4 py-3 border-b border-line shrink-0">
          <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
            <UserPlus className="h-3.5 w-3.5 text-emerald-600" />
            Triagens SDR
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {SDR_TRIAGE_SESSIONS.filter((s) => s.status === "active").length} ativas de {SDR_TRIAGE_SESSIONS.length} total
          </p>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {SDR_TRIAGE_SESSIONS.map((session) => {
            const isSelected = selectedSession.id === session.id;
            return (
              <button
                key={session.id}
                onClick={() => setSelectedSession(session)}
                className={`w-full text-left px-4 py-3 border-b border-line transition cursor-pointer ${
                  isSelected
                    ? "bg-emerald-50 border-l-2 border-l-emerald-600"
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
                      Etapa {session.stepNumber}/{session.totalSteps}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-600">
                      {Math.round((session.stepNumber / session.totalSteps) * 100)}%
                    </span>
                  </div>
                  <ProgressBar current={session.stepNumber} total={session.totalSteps} />
                </div>
              </button>
            );
          })}
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
                className={`flex ${msg.sender === "client" ? "justify-end" : "justify-start"}`}
              >
                {msg.sender === "bot" && (
                  <div className="grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-white shrink-0 mr-2 self-end">
                    <Bot className="h-3 w-3" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed shadow-soft ${
                    msg.sender === "bot"
                      ? "bg-emerald-600 text-white rounded-bl-[5px]"
                      : "bg-muted border border-border text-foreground rounded-br-[5px]"
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
                {msg.sender === "client" && (
                  <div className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-primary shrink-0 ml-2 self-end">
                    <UserIcon className="h-3 w-3" />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Resultado se concluído/abandonado */}
          {selectedSession.outcome && (
            <div className="flex justify-center mt-3">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold ${
                selectedSession.status === "completed"
                  ? "bg-emerald-100 text-emerald-700"
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
        <div className="px-4 py-3 border-b border-line shrink-0">
          <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
            Dados Coletados
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {Object.values(selectedSession.collectedData).filter((d) => d.status === "filled").length} de{" "}
            {Object.keys(selectedSession.collectedData).length} campos
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 scrollbar-thin">
          {Object.entries(selectedSession.collectedData).map(([key, data]) => (
            <div
              key={key}
              className={`rounded-xl border p-3 transition ${
                data.status === "filled"
                  ? "border-emerald-200 bg-emerald-50/50"
                  : "border-border bg-muted/30"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {key}
                </span>
                {data.status === "filled" ? (
                  <CheckCircle className="h-3 w-3 text-emerald-500" />
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
            Etapa atual: <span className="font-semibold text-foreground">{selectedSession.currentStep}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
