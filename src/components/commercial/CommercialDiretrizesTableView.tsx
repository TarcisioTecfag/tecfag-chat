import { useState } from "react";
import { Users, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  BASELINE_DIRETRIZES_KPIS,
  BASELINE_DIRETRIZES_PERSONNALITE,
  BASELINE_DIRETRIZES_MAQUINAS,
  DiretrizesConsultantRow,
  DiretrizesKpis,
  DiretrizesTeamGroup,
} from "@/lib/commercial/diretrizes-crm-data";

interface CommercialDiretrizesTableViewProps {
  kpis?: DiretrizesKpis;
  personnaliteData?: DiretrizesTeamGroup;
  semiMaquinasData?: DiretrizesTeamGroup;
  onConsultantClick?: (consultant: DiretrizesConsultantRow) => void;
  onBreakdownClick?: () => void;
}

export function CommercialDiretrizesTableView({
  kpis = BASELINE_DIRETRIZES_KPIS,
  personnaliteData = BASELINE_DIRETRIZES_PERSONNALITE,
  semiMaquinasData = BASELINE_DIRETRIZES_MAQUINAS,
  onConsultantClick,
  onBreakdownClick,
}: CommercialDiretrizesTableViewProps) {
  const [activeTab, setActiveTab] = useState<"geral" | "atrasados">("geral");

  const totalConsultants =
    personnaliteData.consultants.length + semiMaquinasData.consultants.length;

  const renderProgressBar = (consultant: DiretrizesConsultantRow) => {
    const total = consultant.totalDirectives;
    if (total === 0) {
      return (
        <div className="w-full">
          <div className="flex items-center justify-between font-mono text-xs sm:text-[13px] text-zinc-500 mb-1.5 font-semibold">
            <span>0 conc.</span>
            <span>0 hoje</span>
            <span>0 atras.</span>
          </div>
          <div className="h-3 sm:h-3.5 xl:h-4 w-full rounded-full bg-zinc-800/80 border border-zinc-700/40" />
        </div>
      );
    }

    const pctConc = (consultant.concluidas / total) * 100;
    const pctHoje = (consultant.pendenteHoje / total) * 100;
    const pctAtras = (consultant.atrasadas / total) * 100;

    return (
      <div className="w-full">
        <div className="flex items-center justify-between font-mono text-xs sm:text-[13px] mb-1.5 font-bold">
          <span className={consultant.concluidas > 0 ? "text-emerald-400 font-black" : "text-zinc-500 font-semibold"}>
            {consultant.concluidas} conc.
          </span>
          <span className={consultant.pendenteHoje > 0 ? "text-amber-400 font-black" : "text-zinc-500 font-semibold"}>
            {consultant.pendenteHoje} hoje
          </span>
          <span className={consultant.atrasadas > 0 ? "text-red-400 font-black" : "text-zinc-500 font-semibold"}>
            {consultant.atrasadas} atras.
          </span>
        </div>
        <div className="h-3 sm:h-3.5 xl:h-4 w-full overflow-hidden rounded-full bg-zinc-800/80 border border-zinc-700/50 flex shadow-inner">
          {pctConc > 0 && (
            <div
              className="h-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.35)] transition-all"
              style={{ width: `${pctConc}%` }}
            />
          )}
          {pctHoje > 0 && (
            <div
              className="h-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.35)] transition-all"
              style={{ width: `${pctHoje}%` }}
            />
          )}
          {pctAtras > 0 && (
            <div
              className="h-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.35)] transition-all"
              style={{ width: `${pctAtras}%` }}
            />
          )}
        </div>
      </div>
    );
  };

  const renderConsultantRow = (consultant: DiretrizesConsultantRow) => {
    const hasDirectives = consultant.totalDirectives > 0;

    return (
      <div
        key={consultant.consultantId}
        onClick={() => onConsultantClick?.(consultant)}
        className={`flex items-center justify-between gap-3 sm:gap-4 rounded-[4px] border border-zinc-800/80 bg-zinc-950/60 px-3 sm:px-4 py-2 sm:py-2.5 xl:py-3 transition-all cursor-pointer ${
          hasDirectives
            ? "hover:border-zinc-700 hover:bg-zinc-900/70 shadow-sm"
            : "hover:border-zinc-800 hover:bg-zinc-900/30"
        }`}
      >
        {/* Esquerda: Avatar + Nome + Quantidade de Diretrizes */}
        <div className="flex items-center gap-2.5 sm:gap-3 w-48 sm:w-56 xl:w-64 shrink-0">
          {consultant.avatarUrl ? (
            <img
              src={consultant.avatarUrl}
              alt={consultant.name}
              className="h-8 w-8 sm:h-9 sm:w-9 xl:h-10 xl:w-10 rounded-[3px] border border-zinc-700/80 object-cover shrink-0 shadow-sm"
            />
          ) : (
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 xl:h-10 xl:w-10 shrink-0 items-center justify-center rounded-[3px] border border-zinc-700/80 bg-zinc-900 font-mono text-xs font-bold text-zinc-300">
              {consultant.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="truncate">
            <span className="block font-mono text-xs sm:text-sm font-bold text-white tracking-tight truncate">
              {consultant.name}
            </span>
            <span className="block font-mono text-[10px] sm:text-[11px] text-zinc-400 mt-0.5">
              {consultant.totalDirectives} diretrizes
            </span>
          </div>
        </div>

        {/* Centro: Barra de Progresso com Contadores que se estende por quase toda a largura */}
        <div className="flex-1 px-3 sm:px-6 xl:px-8">
          {renderProgressBar(consultant)}
        </div>

        {/* Direita: Taxa de Execução + Valor */}
        <div className="w-20 sm:w-24 text-right font-mono shrink-0">
          <span
            className={`block text-xs sm:text-sm font-black ${
              hasDirectives ? "text-emerald-400" : "text-zinc-500"
            }`}
          >
            {hasDirectives ? `${consultant.taxaExecucaoPercent}%` : "—"}
          </span>
          <span
            className={`block text-[11px] sm:text-xs font-bold ${
              hasDirectives ? "text-white" : "text-zinc-500"
            }`}
          >
            {consultant.formattedValue}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col justify-between overflow-hidden gap-2.5 sm:gap-3">
      {/* ─── 1. TOP KPIS CARDS (FOTO 1) ─── */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {/* Card 1: Total Sob Gestão (Borda verde ativa) */}
        <div className="relative overflow-hidden rounded-[4px] border border-emerald-500/40 bg-[#0d1714] p-3 sm:p-4 shadow-sm before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1.5 before:bg-emerald-500">
          <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <span>◎</span>
            <span>TOTAL SOB GESTÃO</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl sm:text-3xl xl:text-4xl font-black text-emerald-400">
              {kpis.totalDeals}
            </span>
            <span className="text-xs sm:text-sm font-semibold text-emerald-400/90 font-mono">
              deals
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs sm:text-sm text-zinc-400">
            {kpis.formattedTotalValue}
          </p>
        </div>

        {/* Card 2: Taxa de Execução (Clicável: abre modal de breakdown) */}
        <button
          type="button"
          onClick={onBreakdownClick}
          className="rounded-[4px] border border-zinc-800 bg-zinc-950/70 p-3 sm:p-4 text-left shadow-sm transition-all hover:border-zinc-700 hover:bg-zinc-900/40 cursor-pointer"
        >
          <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <Clock className="h-3 w-3" />
            <span>TAXA DE EXECUÇÃO</span>
          </div>
          <div className="mt-1">
            <span className="font-mono text-2xl sm:text-3xl xl:text-4xl font-black text-emerald-400">
              {kpis.taxaExecucaoPercent}%
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs sm:text-sm text-zinc-400">
            {kpis.concluidasCount} de {kpis.totalCount} concluídas
          </p>
        </button>

        {/* Card 3: Em Atraso */}
        <div className="rounded-[4px] border border-zinc-800 bg-zinc-950/70 p-3 sm:p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <AlertCircle className="h-3 w-3" />
            <span>EM ATRASO</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl sm:text-3xl xl:text-4xl font-black text-emerald-400">
              {kpis.atrasoCount}
            </span>
            <span className="text-xs sm:text-sm font-semibold text-emerald-400/90 font-mono">
              deals
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs sm:text-sm text-zinc-400">{kpis.atrasoLabel}</p>
        </div>
      </div>

      {/* ─── 2. ABAS SUPERIORES (FOTO 1 E FOTO 4) ─── */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("geral")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-[3px] py-2 sm:py-2.5 font-mono text-xs sm:text-[13px] font-bold uppercase tracking-wide transition-all cursor-pointer ${
            activeTab === "geral"
              ? "border border-[#c53030] bg-zinc-950/90 text-white shadow-sm"
              : "border border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-white"
          }`}
        >
          <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span>GERAL DE TODOS ({totalConsultants})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("atrasados")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-[3px] py-2 sm:py-2.5 font-mono text-xs sm:text-[13px] font-bold uppercase tracking-wide transition-all cursor-pointer ${
            activeTab === "atrasados"
              ? "border border-[#c53030] bg-zinc-950/90 text-white shadow-sm"
              : "border border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-white"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span>MAIS ATRASADOS ({kpis.atrasoCount})</span>
        </button>
      </div>

      {/* ─── 3. CORPO DA SESSÃO CONFORME ABA SELECIONADA ─── */}
      {activeTab === "geral" ? (
        <div className="flex-1 flex flex-col justify-between gap-2.5 sm:gap-3 xl:gap-4 overflow-hidden">
          {/* EQUIPE 1: ★ TIME PERSONNALITÉ */}
          <div className="rounded-[4px] border border-zinc-800/80 bg-zinc-950/50 p-2.5 sm:p-3 xl:p-3.5 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className={`font-mono text-xs sm:text-sm font-bold uppercase tracking-wider ${personnaliteData.badgeColorClass}`}>
                {personnaliteData.teamLabel}
              </span>
              <div className="flex items-center gap-3 sm:gap-4 font-mono text-[11px] sm:text-xs text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Concluídas
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Pendente Hoje
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  Atrasadas
                </span>
              </div>
            </div>

            <div className="space-y-1.5 sm:space-y-2">
              {personnaliteData.consultants.map(renderConsultantRow)}
            </div>
          </div>

          {/* EQUIPE 2: 🗝 TIME MÁQUINAS / SEMI */}
          <div className="rounded-[4px] border border-zinc-800/80 bg-zinc-950/50 p-2.5 sm:p-3 xl:p-3.5 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className={`font-mono text-xs sm:text-sm font-bold uppercase tracking-wider ${semiMaquinasData.badgeColorClass}`}>
                {semiMaquinasData.teamLabel}
              </span>
              <div className="flex items-center gap-3 sm:gap-4 font-mono text-[11px] sm:text-xs text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Concluídas
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Pendente Hoje
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  Atrasadas
                </span>
              </div>
            </div>

            <div className="space-y-1.5 sm:space-y-2">
              {semiMaquinasData.consultants.map(renderConsultantRow)}
            </div>
          </div>
        </div>
      ) : (
        /* FILA DE COBRANÇA (FOTO 4) */
        <div className="flex-1 flex flex-col justify-start">
          <div className="flex items-center justify-between py-2 font-mono text-xs sm:text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="font-bold text-red-500 uppercase tracking-wider">
                FILA DE COBRANÇA
              </span>
              <span className="font-bold text-white">
                Oportunidades com Diretriz Expirada
              </span>
            </div>
            <span className="text-zinc-500 text-xs font-mono">
              Ordenado pelo maior tempo sem retorno
            </span>
          </div>

          <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-[4px] border border-dashed border-zinc-800/80 bg-zinc-950/30 p-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-950/30 text-emerald-400 shadow-sm">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h3 className="mt-4 font-mono text-base sm:text-lg font-bold text-white">
              Tudo em dia!
            </h3>
            <p className="mt-1 max-w-sm text-xs sm:text-sm text-zinc-400 font-mono">
              Nenhuma diretriz atribuída está atrasada no momento. Toda a equipe está no prazo.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
