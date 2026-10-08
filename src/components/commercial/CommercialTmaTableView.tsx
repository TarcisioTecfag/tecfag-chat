import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, Target, Zap, CheckCircle2 } from "lucide-react";
import { getAiPersona } from "@/lib/ai-persona";
import {
  TmaConsultantRow,
  TmaKpis,
  TmaTeamGroup,
  TmaWaitingChatItem,
} from "@/lib/commercial/tma-whatsapp-data";
import { getDeterministicConsultantAvatar } from "@/lib/commercial/avatar-matcher";

interface CommercialTmaTableViewProps {
  kpis: TmaKpis;
  personnaliteData: TmaTeamGroup;
  semiMaquinasData: TmaTeamGroup;
  waitingChats?: TmaWaitingChatItem[];
  tenantId?: string | null;
  onConsultantClick?: (consultant: TmaConsultantRow) => void;
  onOpenChat?: (conversationId: string) => void;
}

export function CommercialTmaTableView({
  kpis,
  personnaliteData,
  semiMaquinasData,
  waitingChats = [],
  tenantId = "",
  onConsultantClick,
  onOpenChat,
}: CommercialTmaTableViewProps) {
  const [activeTab, setActiveTab] = useState<"contato" | "aguardando">("contato");

  const aiName = getAiPersona(tenantId || "").name;

  const renderProgressBar = (consultant: TmaConsultantRow) => {
    const total = consultant.totalAnswered;
    const { under5m, between5and15m, between15and30m, over30m } = consultant.buckets;

    const pctUnder5m = total > 0 ? (under5m / total) * 100 : 0;
    const pct5to15m = total > 0 ? (between5and15m / total) * 100 : 0;
    const pct15to30m = total > 0 ? (between15and30m / total) * 100 : 0;
    const pctOver30m = total > 0 ? (over30m / total) * 100 : 0;

    return (
      <div className="w-full">
        {/* 4 Buckets Labels com números e contraste nítido */}
        <div className="grid grid-cols-4 font-mono text-xs sm:text-[13px] mb-1.5 font-bold">
          <span
            className={
              under5m > 0
                ? "text-emerald-700 dark:text-emerald-400 font-black"
                : "text-slate-400 dark:text-zinc-500 font-semibold"
            }
          >
            {under5m} ≤ 5m
          </span>
          <span
            className={`text-center ${between5and15m > 0 ? "text-cyan-700 dark:text-cyan-400 font-black" : "text-slate-400 dark:text-zinc-500 font-semibold"}`}
          >
            {between5and15m} 5-15m
          </span>
          <span
            className={`text-center ${between15and30m > 0 ? "text-amber-700 dark:text-amber-400 font-black" : "text-slate-400 dark:text-zinc-500 font-semibold"}`}
          >
            {between15and30m} 15-30m
          </span>
          <span
            className={`text-right ${over30m > 0 ? "text-red-700 dark:text-red-400 font-black" : "text-slate-400 dark:text-zinc-500 font-semibold"}`}
          >
            {over30m} &gt; 30m
          </span>
        </div>

        {/* Trilha horizontal contínua de largura total */}
        <div className="h-3 sm:h-3.5 xl:h-4 w-full overflow-hidden rounded-full bg-slate-200 border border-slate-300 dark:bg-zinc-800/80 dark:border-zinc-700/50 flex shadow-inner">
          {total > 0 ? (
            <>
              {pctUnder5m > 0 && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pctUnder5m}%` }}
                  transition={{ duration: 0.55, ease: "easeOut" }}
                  className="h-full bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.35)]"
                />
              )}
              {pct5to15m > 0 && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct5to15m}%` }}
                  transition={{ duration: 0.55, ease: "easeOut" }}
                  className="h-full bg-cyan-500 dark:bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.35)]"
                />
              )}
              {pct15to30m > 0 && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct15to30m}%` }}
                  transition={{ duration: 0.55, ease: "easeOut" }}
                  className="h-full bg-amber-500 dark:bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.35)]"
                />
              )}
              {pctOver30m > 0 && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pctOver30m}%` }}
                  transition={{ duration: 0.55, ease: "easeOut" }}
                  className="h-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.35)]"
                />
              )}
            </>
          ) : null}
        </div>
      </div>
    );
  };

  const renderConsultantRow = (consultant: TmaConsultantRow) => {
    return (
      <motion.div
        key={consultant.consultantId}
        whileHover={{ scale: 1.003 }}
        whileTap={{ scale: 0.995 }}
        transition={{ duration: 0.12 }}
        onClick={() => onConsultantClick?.(consultant)}
        className="flex items-center justify-between gap-3 sm:gap-4 rounded-[4px] border border-slate-200 bg-white hover:bg-slate-50 dark:border-zinc-800/80 dark:bg-zinc-950/60 dark:hover:bg-zinc-900/60 px-3 sm:px-4 py-2 sm:py-2.5 xl:py-3 transition-colors cursor-pointer shadow-sm"
      >
        {/* Esquerda: Avatar + Nome */}
        <div className="flex items-center gap-2.5 sm:gap-3 w-48 sm:w-56 xl:w-64 shrink-0">
          <img
            src={consultant.avatarUrl || getDeterministicConsultantAvatar(consultant.name)}
            alt={consultant.name}
            className="h-8 w-8 sm:h-9 sm:w-9 xl:h-10 xl:w-10 rounded-[3px] border border-slate-200 dark:border-zinc-700/80 object-cover shrink-0 shadow-sm"
            onError={(e) => {
              const img = e.currentTarget;
              const fallback = getDeterministicConsultantAvatar(consultant.name);
              if (img.src !== fallback) {
                img.src = fallback;
              }
            }}
          />
          <div className="truncate">
            <span className="block font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-white tracking-tight truncate">
              {consultant.name}
            </span>
          </div>
        </div>

        {/* Centro: Barra de Distribuição de Tempo */}
        <div className="flex-1 px-3 sm:px-6 xl:px-8">{renderProgressBar(consultant)}</div>

        {/* Direita: Total de Atendimentos */}
        <div className="w-16 sm:w-20 text-right font-mono shrink-0">
          <span className="block text-xs sm:text-sm font-black text-slate-900 dark:text-white">
            {consultant.totalAnswered}
          </span>
          <span className="block text-[10px] sm:text-[11px] font-semibold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
            TOTAL
          </span>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col justify-between overflow-hidden gap-2.5 sm:gap-3">
      {/* ─── 1. TOP KPIS CARDS (FOTO 1) ─── */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {/* Card 1: TMA Médio Hoje (Borda e Glow Esmeralda) */}
        <motion.div
          whileHover={{ y: -2, scale: 1.008 }}
          transition={{ duration: 0.15 }}
          className="relative overflow-hidden rounded-[4px] border border-emerald-300 bg-emerald-50/70 dark:border-emerald-500/40 dark:bg-[#0d1714] p-3 sm:p-4 shadow-sm before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1.5 before:bg-emerald-500"
        >
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-zinc-400 font-mono text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <Clock className="h-3 w-3 text-slate-500 dark:text-zinc-400" />
            <span>TMA MÉDIO HOJE</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl sm:text-3xl xl:text-4xl font-black text-emerald-700 dark:text-emerald-400">
              {kpis.averageMinutes}
            </span>
            <span className="text-sm sm:text-base font-semibold text-emerald-700/90 dark:text-emerald-400/90 font-mono">
              min
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs sm:text-sm text-slate-600 dark:text-zinc-400">
            Dentro da meta de {kpis.targetMinutes} min
          </p>
        </motion.div>

        {/* Card 2: Taxa no SLA */}
        <motion.div
          whileHover={{ y: -2, scale: 1.008 }}
          transition={{ duration: 0.15 }}
          className="rounded-[4px] border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/70 p-3 sm:p-4 shadow-sm"
        >
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-zinc-400 font-mono text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <Target className="h-3 w-3 text-slate-500 dark:text-zinc-400" />
            <span>TAXA NO SLA</span>
          </div>
          <div className="mt-1">
            <span className="font-mono text-2xl sm:text-3xl xl:text-4xl font-black text-slate-900 dark:text-white">
              {kpis.slaPercent}%
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs sm:text-sm text-slate-500 dark:text-zinc-400">
            Respondidos no prazo
          </p>
        </motion.div>

        {/* Card 3: Total Transferências */}
        <motion.div
          whileHover={{ y: -2, scale: 1.008 }}
          transition={{ duration: 0.15 }}
          className="rounded-[4px] border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/70 p-3 sm:p-4 shadow-sm"
        >
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-zinc-400 font-mono text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <Zap className="h-3 w-3 text-slate-500 dark:text-zinc-400" />
            <span>TOTAL TRANSFERÊNCIAS</span>
          </div>
          <div className="mt-1">
            <span className="font-mono text-2xl sm:text-3xl xl:text-4xl font-black text-slate-900 dark:text-white">
              {kpis.totalTransfers}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs sm:text-sm text-slate-500 dark:text-zinc-400">
            Hoje pelo {aiName}
          </p>
        </motion.div>
      </div>

      {/* ─── 2. ABAS SUPERIORES (FOTO 1 E FOTO 2) ─── */}
      <div className="flex items-center gap-2">
        <motion.button
          type="button"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setActiveTab("contato")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-[3px] py-2 sm:py-2.5 font-mono text-xs sm:text-[13px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${
            activeTab === "contato"
              ? "border border-[#c53030] bg-red-50 text-red-700 dark:bg-zinc-950/90 dark:text-white shadow-sm"
              : "border border-slate-200 bg-slate-100 text-slate-600 hover:text-slate-900 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400 dark:hover:text-white"
          }`}
        >
          <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span>TEMPO DE PRIMEIRO CONTATO ({kpis.firstContactCount})</span>
        </motion.button>

        <motion.button
          type="button"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setActiveTab("aguardando")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-[3px] py-2 sm:py-2.5 font-mono text-xs sm:text-[13px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${
            activeTab === "aguardando"
              ? "border border-[#c53030] bg-red-50 text-red-700 dark:bg-zinc-950/90 dark:text-white shadow-sm"
              : "border border-slate-200 bg-slate-100 text-slate-600 hover:text-slate-900 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400 dark:hover:text-white"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span>AGUARDANDO RESPOSTA ({kpis.waitingResponseCount})</span>
        </motion.button>
      </div>

      {/* ─── 3. CORPO CONFORME ABA SELECIONADA ─── */}
      {activeTab === "contato" ? (
        <div className="flex-1 flex flex-col justify-between gap-2.5 sm:gap-3 xl:gap-4 overflow-hidden">
          {/* EQUIPE 1: ★ TIME PERSONNALITÉ */}
          <div className="rounded-[4px] border border-slate-200 bg-slate-50/60 dark:border-zinc-800/80 dark:bg-zinc-950/50 p-2.5 sm:p-3 xl:p-3.5 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span
                className={`font-mono text-xs sm:text-sm font-bold uppercase tracking-wider ${personnaliteData.badgeColorClass}`}
              >
                {personnaliteData.teamLabel}
              </span>
              <div className="flex items-center gap-3 sm:gap-4 font-mono text-[11px] sm:text-xs text-slate-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />≤ 5m
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  5-15m
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  15-30m
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  &gt; 30m
                </span>
              </div>
            </div>

            <div className="space-y-1.5 sm:space-y-2">
              {personnaliteData.consultants.map(renderConsultantRow)}
            </div>
          </div>

          {/* EQUIPE 2: ⚍ TIME SEMI (MÁQUINAS) */}
          <div className="rounded-[4px] border border-slate-200 bg-slate-50/60 dark:border-zinc-800/80 dark:bg-zinc-950/50 p-2.5 sm:p-3 xl:p-3.5 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span
                className={`font-mono text-xs sm:text-sm font-bold uppercase tracking-wider ${semiMaquinasData.badgeColorClass}`}
              >
                {semiMaquinasData.teamLabel}
              </span>
              <div className="flex items-center gap-3 sm:gap-4 font-mono text-[11px] sm:text-xs text-slate-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />≤ 5m
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  5-15m
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  15-30m
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  &gt; 30m
                </span>
              </div>
            </div>

            <div className="space-y-1.5 sm:space-y-2">
              {semiMaquinasData.consultants.map(renderConsultantRow)}
            </div>
          </div>
        </div>
      ) : (
        /* FILA EM TEMPO REAL (FOTO 2) */
        <div className="flex-1 flex flex-col justify-start">
          <div className="flex items-center justify-between py-2 font-mono text-xs sm:text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="font-bold text-red-600 uppercase tracking-wider">
                FILA EM TEMPO REAL
              </span>
              <span className="font-bold text-slate-900 dark:text-white">
                Atendimentos Aguardando Primeira Resposta
              </span>
            </div>
            <span className="text-slate-400 dark:text-zinc-500 text-xs font-mono">
              Ordenado por maior tempo de espera
            </span>
          </div>

          {waitingChats.length === 0 ? (
            <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-[4px] border border-dashed border-slate-300 bg-white dark:border-zinc-800/80 dark:bg-zinc-950/30 p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-400 shadow-sm">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="mt-4 font-mono text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Fila zerada!
              </h3>
              <p className="mt-1 max-w-sm text-xs sm:text-sm text-slate-600 dark:text-zinc-400 font-mono">
                Nenhum atendimento aguardando primeira resposta neste momento.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2 overflow-y-auto">
              {waitingChats.map((chat) => (
                <div
                  key={chat.id}
                  onClick={() => onOpenChat?.(chat.conversationId)}
                  className="flex items-center justify-between rounded-[3px] border border-slate-200 bg-white hover:border-slate-300 dark:border-zinc-800 dark:bg-zinc-950/60 p-3 dark:hover:border-zinc-700 cursor-pointer transition-colors shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                      {chat.clientName}
                    </span>
                    <span className="font-mono text-xs text-slate-500 dark:text-zinc-400">
                      {chat.phone}
                    </span>
                    <span className="rounded-[2px] bg-slate-100 text-slate-700 dark:bg-zinc-800 px-2 py-0.5 font-mono text-[10px] dark:text-zinc-300">
                      Resp: {chat.consultantName}
                    </span>
                  </div>
                  <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">
                    Aguardando há {chat.waitingFormatted}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
