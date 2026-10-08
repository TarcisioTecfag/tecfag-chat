import React from "react";
import { motion } from "framer-motion";
import { Zap, AlertTriangle, Trophy, Medal, Clock, ShieldCheck } from "lucide-react";
import {
  BASELINE_RANKING_OPERATORS,
  RankingOperatorRow,
} from "@/lib/commercial/ranking-data";

export interface CommercialRankingTableViewProps {
  operators?: RankingOperatorRow[];
  onOperatorClick?: (operator: RankingOperatorRow) => void;
}

function PositionBadge({ position }: { position: number }) {
  if (position === 1) {
    return (
      <div
        className="absolute -top-1.5 -left-1.5 h-5 w-5 rounded-[2px] bg-gradient-to-br from-amber-300 via-amber-500 to-amber-600 text-black font-black font-mono text-[10px] flex items-center justify-center shadow-[0_0_10px_rgba(245,158,11,0.5)] border border-amber-200"
        title="1º Lugar - Líder de Agilidade"
      >
        1
      </div>
    );
  }
  if (position === 2) {
    return (
      <div
        className="absolute -top-1.5 -left-1.5 h-4.5 w-4.5 rounded-[2px] bg-gradient-to-br from-zinc-200 to-zinc-400 text-black font-black font-mono text-[9.5px] flex items-center justify-center shadow-xs border border-zinc-200"
        title="2º Lugar"
      >
        2
      </div>
    );
  }
  if (position === 3) {
    return (
      <div
        className="absolute -top-1.5 -left-1.5 h-4.5 w-4.5 rounded-[2px] bg-gradient-to-br from-amber-700 to-amber-900 text-amber-200 font-black font-mono text-[9.5px] flex items-center justify-center shadow-xs border border-amber-600"
        title="3º Lugar"
      >
        3
      </div>
    );
  }
  return (
    <div
      className="absolute -top-1.5 -left-1.5 h-4 w-4 sm:h-4.5 sm:w-4.5 rounded-[2px] bg-zinc-850 text-zinc-400 font-bold font-mono text-[8.5px] sm:text-[9.5px] flex items-center justify-center border border-zinc-700 bg-zinc-900"
      title={`${position}º Lugar`}
    >
      {position}
    </div>
  );
}

export function CommercialRankingTableView({
  operators = BASELINE_RANKING_OPERATORS,
  onOperatorClick,
}: CommercialRankingTableViewProps) {
  // Separa em 2 colunas de 5 linhas conforme a foto de referência:
  // Coluna 1 (Esquerda): posições 1, 3, 5, 7, 9
  // Coluna 2 (Direita): posições 2, 4, 6, 8, 10
  const col1 = operators.filter((_, idx) => idx % 2 === 0);
  const col2 = operators.filter((_, idx) => idx % 2 !== 0);

  const renderOperatorCard = (op: RankingOperatorRow) => {
    const isFirst = op.position === 1;

    return (
      <motion.div
        key={op.operatorId}
        whileHover={{
          y: -2,
          scale: 1.005,
          borderColor: isFirst ? "rgba(245, 158, 11, 1)" : "rgba(161, 161, 170, 0.4)",
        }}
        whileTap={{ scale: 0.992 }}
        transition={{ duration: 0.15 }}
        onClick={() => onOperatorClick?.(op)}
        className={`flex-1 w-full rounded-[4px] px-3 py-2 sm:px-3.5 sm:py-2.5 xl:px-4 xl:py-3 flex items-center justify-between transition-colors cursor-pointer select-none group ${
          isFirst
            ? "border border-amber-500/80 shadow-[0_0_16px_rgba(245,158,11,0.2)] bg-zinc-950/90"
            : "border border-zinc-800/80 bg-zinc-950/70 hover:bg-zinc-900/50"
        }`}
      >
        {/* ─── ESQUERDA: AVATAR COM BADGE DE POSIÇÃO + NOME + DIVISÃO ─── */}
        <div className="flex items-center gap-3 shrink-0 min-w-[150px] sm:min-w-[180px] xl:min-w-[210px]">
          {/* Avatar com badge de posição no topo esquerdo */}
          <div className="relative h-11 w-11 sm:h-12 sm:w-12 xl:h-13 xl:w-13 shrink-0 rounded-[4px] overflow-hidden border border-zinc-800 bg-zinc-900 shadow-sm">
            {op.avatarUrl ? (
              <img
                src={op.avatarUrl}
                alt={op.name}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-mono font-bold text-[10px] text-zinc-400 bg-zinc-800">
                {op.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <PositionBadge position={op.position} />
          </div>

          {/* Nome e Divisão */}
          <div className="min-w-0 flex flex-col justify-center leading-tight">
            <span className="font-mono text-xs sm:text-sm xl:text-[14px] font-bold text-white tracking-wide truncate group-hover:text-red-400 transition-colors">
              {op.name}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="font-mono text-[9px] sm:text-[9.5px] uppercase tracking-wider text-zinc-400">
                {op.division}
              </span>
            </div>
          </div>
        </div>

        {/* ─── CENTRO: DUAL TELEMETRY MODULES (MELHOR VS PIOR) PREENCHENDO O ESPAÇO HARMONIOSAMENTE ─── */}
        <div className="flex-1 mx-2 sm:mx-3 xl:mx-5 flex items-center justify-center min-w-0">
          <div className="flex items-center gap-2 sm:gap-2.5 xl:gap-3.5 w-full max-w-[540px] justify-center">
            {/* Bloco 1: Melhor Atendimento (Recorde de Agilidade) */}
            <div className="flex-1 min-w-[125px] max-w-[245px] rounded-[3px] bg-emerald-950/20 border border-emerald-500/30 px-2 sm:px-2.5 py-1 sm:py-1.5 flex flex-col justify-center shadow-xs">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 text-[8.5px] sm:text-[9.5px] font-mono font-bold uppercase tracking-wide text-emerald-400">
                  <Zap className="h-3 w-3 fill-emerald-400 text-emerald-400" />
                  <span>MELHOR</span>
                </span>
                <span className="font-mono text-xs sm:text-[13px] xl:text-sm font-black text-emerald-300">
                  {op.bestTime}
                </span>
              </div>
              <span
                className="font-mono text-[8.5px] sm:text-[9.5px] text-zinc-400 truncate mt-0.5"
                title={op.bestClient}
              >
                {op.bestClient}
              </span>
            </div>

            {/* Divisor Visual Tático */}
            <div className="flex flex-col items-center justify-center shrink-0">
              <span className="font-mono text-[8.5px] sm:text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
                VS
              </span>
            </div>

            {/* Bloco 2: Pior Atendimento (Maior Tempo de Espera) */}
            <div className="flex-1 min-w-[125px] max-w-[245px] rounded-[3px] bg-amber-950/20 border border-amber-500/30 px-2 sm:px-2.5 py-1 sm:py-1.5 flex flex-col justify-center shadow-xs">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 text-[8.5px] sm:text-[9.5px] font-mono font-bold uppercase tracking-wide text-amber-400">
                  <AlertTriangle className="h-3 w-3 text-amber-400" />
                  <span>PIOR</span>
                </span>
                <span className="font-mono text-xs sm:text-[13px] xl:text-sm font-black text-amber-300">
                  {op.worstTime}
                </span>
              </div>
              <span
                className="font-mono text-[8.5px] sm:text-[9.5px] text-zinc-400 truncate mt-0.5"
                title={op.worstClient}
              >
                {op.worstClient}
              </span>
            </div>
          </div>
        </div>

        {/* ─── DIREITA: TMA MÉDIO + BADGE SLA ─── */}
        <div className="flex flex-col items-end justify-center shrink-0 min-w-[75px] sm:min-w-[95px] text-right leading-tight">
          <span className="font-mono text-sm sm:text-base xl:text-lg font-black text-emerald-400 tracking-tight">
            {op.averageTime}
          </span>
          <div className="mt-1 rounded-[2px] bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5">
            <span className="font-mono text-[9px] sm:text-[10px] font-bold text-emerald-400">
              {op.slaPercent}% no SLA
            </span>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col justify-between overflow-hidden select-none">
      {/* ─── HEADER DA SEÇÃO: RANKING GERAL DE RESPOSTA & SLA ─── */}
      <div className="mb-2 flex items-center justify-between shrink-0 border-b border-zinc-800/80 pb-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-[#df3d3d]" />
            <span className="text-[10px] sm:text-[11px] font-mono font-bold uppercase tracking-[.18em] text-[#df3d3d]">
              RANKING GERAL DE RESPOSTA & SLA
            </span>
          </div>
          <div className="flex items-center gap-1.5 pl-0.5">
            <Medal className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[9.5px] sm:text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">
              PÓDIO DE AGILIDADE & ÍNDICE DE RESPOSTA
            </span>
          </div>
        </div>

        {/* Telemetria Global do Topo */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:flex items-center gap-1.5 rounded-[2px] bg-zinc-900 border border-zinc-800/80 px-2.5 py-1 text-[9.5px] sm:text-[10px] font-mono text-zinc-300">
            <span className="text-zinc-500">MÉDIA EQUIPE:</span>
            <span className="font-bold text-white">3m 12s</span>
          </div>

          <div className="hidden md:flex items-center gap-1.5 rounded-[2px] bg-emerald-950/30 border border-emerald-500/30 px-2.5 py-1 text-[9.5px] sm:text-[10px] font-mono text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-bold">100% NO SLA</span>
          </div>

          <div className="rounded-[2px] bg-zinc-900 border border-zinc-800 px-2.5 py-1 text-[9.5px] sm:text-[10px] font-mono text-zinc-400">
            <span>Meta: 100% &lt; 15 min</span>
          </div>
        </div>
      </div>

      {/* ─── GRID DE 10 CONSULTORES EM 2 COLUNAS DE 5 LINHAS (ZERO SCROLLBAR) ─── */}
      <div className="flex-1 min-h-0 w-full grid grid-cols-2 gap-2.5 sm:gap-3 xl:gap-3.5 overflow-hidden">
        {/* Coluna 1 (Ímpares: 1, 3, 5, 7, 9) */}
        <div className="flex flex-col justify-between gap-1.5 sm:gap-2 xl:gap-2.5 h-full min-h-0 overflow-hidden">
          {col1.map(renderOperatorCard)}
        </div>

        {/* Coluna 2 (Pares: 2, 4, 6, 8, 10) */}
        <div className="flex flex-col justify-between gap-1.5 sm:gap-2 xl:gap-2.5 h-full min-h-0 overflow-hidden">
          {col2.map(renderOperatorCard)}
        </div>
      </div>
    </div>
  );
}
