import React from "react";
import { Zap, AlertTriangle, Trophy, Medal, Award } from "lucide-react";
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
        className="absolute -top-1.5 -left-1.5 h-4.5 w-4.5 sm:h-5 sm:w-5 rounded-[2px] bg-gradient-to-br from-amber-400 to-amber-600 text-black font-black font-mono text-[10px] sm:text-[11px] flex items-center justify-center shadow-[0_0_8px_rgba(245,158,11,0.4)] border border-amber-300"
        title="1º Lugar - Líder de Agilidade"
      >
        1
      </div>
    );
  }
  if (position === 2) {
    return (
      <div
        className="absolute -top-1.5 -left-1.5 h-4 w-4 sm:h-4.5 sm:w-4.5 rounded-[2px] bg-zinc-300 text-black font-black font-mono text-[9px] sm:text-[10px] flex items-center justify-center shadow-xs border border-zinc-200"
        title="2º Lugar"
      >
        2
      </div>
    );
  }
  if (position === 3) {
    return (
      <div
        className="absolute -top-1.5 -left-1.5 h-4 w-4 sm:h-4.5 sm:w-4.5 rounded-[2px] bg-amber-700 text-white font-black font-mono text-[9px] sm:text-[10px] flex items-center justify-center shadow-xs border border-amber-600"
        title="3º Lugar"
      >
        3
      </div>
    );
  }
  return (
    <div
      className="absolute -top-1.5 -left-1.5 h-4 w-4 sm:h-4.5 sm:w-4.5 rounded-[2px] bg-zinc-800 text-zinc-400 font-bold font-mono text-[8.5px] sm:text-[9.5px] flex items-center justify-center border border-zinc-700"
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
      <div
        key={op.operatorId}
        onClick={() => onOperatorClick?.(op)}
        className={`flex-1 w-full rounded-[4px] px-2.5 py-1.5 sm:px-3 sm:py-2 flex items-center justify-between transition-all cursor-pointer select-none group ${
          isFirst
            ? "border border-amber-500/80 shadow-[0_0_14px_rgba(245,158,11,0.18)] bg-zinc-950"
            : "border border-zinc-800/80 hover:border-zinc-700 bg-zinc-950/70"
        }`}
      >
        {/* ─── ESQUERDA: AVATAR COM BADGE DE POSIÇÃO + NOME + DIVISÃO ─── */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0 min-w-[140px] sm:min-w-[170px] xl:min-w-[200px]">
          {/* Avatar com badge de posição no topo esquerdo */}
          <div className="relative h-10 w-10 sm:h-11 sm:w-11 xl:h-12 xl:w-12 shrink-0 rounded-[4px] overflow-hidden border border-zinc-800 bg-zinc-900">
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

          {/* Nome e Equipe */}
          <div className="min-w-0 flex flex-col justify-center leading-tight">
            <span className="font-mono text-xs sm:text-sm font-bold text-white tracking-wide truncate group-hover:text-red-400 transition-colors">
              {op.name}
            </span>
            <span className="font-mono text-[9px] sm:text-[10px] text-zinc-500 mt-0.5">
              {op.division}
            </span>
          </div>
        </div>

        {/* ─── CENTRO (ESPAÇO VAZIO): MELHOR ATENDIMENTO VS PIOR ATENDIMENTO ─── */}
        <div className="flex-1 mx-2 sm:mx-3 xl:mx-4 flex items-center justify-center min-w-0">
          <div className="flex items-center gap-2 sm:gap-2.5 xl:gap-3 px-2 sm:px-2.5 py-1 rounded-[2px] bg-zinc-900/80 border border-zinc-800/80 font-mono text-[9.5px] sm:text-[10px] xl:text-[11px] shadow-inner max-w-full">
            {/* Melhor Atendimento */}
            <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
              <span className="flex items-center gap-1 text-emerald-400 font-bold shrink-0">
                <Zap className="h-3 w-3 sm:h-3.5 sm:w-3.5 fill-emerald-400 text-emerald-400" />
                <span className="text-[8.5px] sm:text-[9.5px] uppercase tracking-wide">Melhor:</span>
              </span>
              <span className="font-mono font-black text-emerald-300 shrink-0">
                {op.bestTime}
              </span>
              <span
                className="text-zinc-500 text-[8.5px] sm:text-[9px] xl:text-[10px] truncate max-w-[70px] sm:max-w-[100px] xl:max-w-[140px]"
                title={op.bestClient}
              >
                ({op.bestClient})
              </span>
            </div>

            <span className="text-zinc-700 font-light shrink-0">vs</span>

            {/* Pior Atendimento */}
            <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
              <span className="flex items-center gap-1 text-amber-400 font-bold shrink-0">
                <AlertTriangle className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-amber-400" />
                <span className="text-[8.5px] sm:text-[9.5px] uppercase tracking-wide">Pior:</span>
              </span>
              <span className="font-mono font-black text-amber-300 shrink-0">
                {op.worstTime}
              </span>
              <span
                className="text-zinc-500 text-[8.5px] sm:text-[9px] xl:text-[10px] truncate max-w-[70px] sm:max-w-[100px] xl:max-w-[140px]"
                title={op.worstClient}
              >
                ({op.worstClient})
              </span>
            </div>
          </div>
        </div>

        {/* ─── DIREITA: TMA MÉDIO + BADGE SLA ─── */}
        <div className="flex flex-col items-end justify-center shrink-0 min-w-[70px] sm:min-w-[90px] text-right leading-tight">
          <span className="font-mono text-xs sm:text-sm xl:text-base font-black text-emerald-400 tracking-tight">
            {op.averageTime}
          </span>
          <span className="font-mono text-[8.5px] sm:text-[9.5px] font-bold text-emerald-400/90 mt-0.5">
            {op.slaPercent}% no SLA
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col justify-between overflow-hidden select-none">
      {/* ─── HEADER DA SEÇÃO: RANKING GERAL DE RESPOSTA & SLA ─── */}
      <div className="mb-2 flex items-center justify-between shrink-0">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Trophy className="h-3.5 w-3.5 text-[#df3d3d]" />
            <span className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-[#df3d3d]">
              RANKING GERAL DE RESPOSTA & SLA
            </span>
          </div>
          <div className="flex items-center gap-1.5 pl-0.5">
            <Medal className="h-3 w-3 text-amber-400" />
            <span className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-amber-400">
              PÓDIO DE AGILIDADE & ÍNDICE DE RESPOSTA
            </span>
          </div>
        </div>

        <div>
          <span className="font-mono text-[9px] sm:text-[10px] text-zinc-400">
            Meta: 100% de atendimentos &lt; 15 min
          </span>
        </div>
      </div>

      {/* ─── GRID DE 10 CONSULTORES EM 2 COLUNAS DE 5 LINHAS (ZERO SCROLLBAR) ─── */}
      <div className="flex-1 min-h-0 w-full grid grid-cols-2 gap-2.5 sm:gap-3 overflow-hidden">
        {/* Coluna 1 (Ímpares: 1, 3, 5, 7, 9) */}
        <div className="flex flex-col justify-between gap-1.5 sm:gap-2 h-full min-h-0 overflow-hidden">
          {col1.map(renderOperatorCard)}
        </div>

        {/* Coluna 2 (Pares: 2, 4, 6, 8, 10) */}
        <div className="flex flex-col justify-between gap-1.5 sm:gap-2 h-full min-h-0 overflow-hidden">
          {col2.map(renderOperatorCard)}
        </div>
      </div>
    </div>
  );
}
