import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  Gauge,
  Star,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  PacingGlobalKpis,
  PacingSellerRow,
  PacingViewMode,
  TeamPacingData,
  formatPacingCurrency,
} from "@/lib/commercial/pacing-data";

interface CommercialPacingTableViewProps {
  globalKpis: PacingGlobalKpis;
  personnaliteData: TeamPacingData;
  semiMaquinasData: TeamPacingData;
  viewMode?: PacingViewMode;
  onToggleViewMode?: (mode: PacingViewMode) => void;
  onSellerClick: (seller: PacingSellerRow) => void;
  tenantId?: string | null;
}

export function CommercialPacingTableView({
  globalKpis,
  personnaliteData,
  semiMaquinasData,
  viewMode: controlledViewMode,
  onToggleViewMode,
  onSellerClick,
  tenantId,
}: CommercialPacingTableViewProps) {
  const [internalViewMode, setInternalViewMode] = useState<PacingViewMode>("daily");
  const viewMode = controlledViewMode ?? internalViewMode;

  const handleToggle = (mode: PacingViewMode) => {
    setInternalViewMode(mode);
    onToggleViewMode?.(mode);
  };

  const totalSellers = personnaliteData.sellers.length + semiMaquinasData.sellers.length;

  const density = useMemo(() => {
    if (totalSellers <= 10) {
      return {
        rowPy: "py-1 sm:py-1.5 xl:py-2",
        headerPy: "py-1.5 sm:py-2",
        sellerText: "text-xs sm:text-xs xl:text-sm font-bold",
        metaSubText: "text-[9px] sm:text-[9.5px] xl:text-[10px]",
        pacingBarH: "h-2.5",
        tableSpace: "space-y-1 sm:space-y-1.5",
        avatarSize: "h-8 w-8 sm:h-9 sm:w-9 xl:h-10 xl:w-10",
        teamTitle: "text-xs sm:text-xs xl:text-sm font-black",
        teamSummary: "text-[10px] sm:text-xs xl:text-sm",
      };
    }
    if (totalSellers <= 16) {
      return {
        rowPy: "py-0.5 sm:py-1",
        headerPy: "py-1 sm:py-1.5",
        sellerText: "text-xs font-bold",
        metaSubText: "text-[8.5px] sm:text-[9px]",
        pacingBarH: "h-2",
        tableSpace: "space-y-0.5 sm:space-y-1",
        avatarSize: "h-7 w-7 sm:h-8 sm:w-8",
        teamTitle: "text-xs font-bold",
        teamSummary: "text-[10px] sm:text-xs",
      };
    }
    return {
      rowPy: "py-0.5 px-2",
      headerPy: "py-1 px-2",
      sellerText: "text-[11px] font-semibold",
      metaSubText: "text-[8px] leading-tight",
      pacingBarH: "h-1.5",
      tableSpace: "space-y-0.5",
      avatarSize: "h-6 w-6",
      teamTitle: "text-[11px] font-bold",
      teamSummary: "text-[10px]",
    };
  }, [totalSellers]);

  const companyLabel = tenantId === "valem" ? "VALEM" : "TECFAG";

  const renderTeamSection = (team: TeamPacingData) => {
    return (
      <div className={density.tableSpace} key={team.division}>
        {/* Cabeçalho da Equipe */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div
            className={`flex items-center gap-1.5 ${density.teamTitle} uppercase tracking-wider text-red-600 dark:text-red-400 font-mono`}
          >
            <Star className="h-3.5 w-3.5 fill-red-600 text-red-600 dark:fill-red-400 dark:text-red-400" />
            <span>{team.teamName}</span>
          </div>

          <div className={`flex items-center gap-2 font-mono ${density.teamSummary}`}>
            <span className="text-slate-500 dark:text-zinc-400">Meta:</span>
            <span className="font-bold text-slate-900 dark:text-white">
              {formatPacingCurrency(team.metaTotal)}
            </span>
            <span className="text-slate-400 dark:text-zinc-600">-</span>
            <span className="text-slate-500 dark:text-zinc-400">Fechado:</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {formatPacingCurrency(team.fechadoTotal)} ({team.fechadoPercent}%)
            </span>
            <span className="text-slate-400 dark:text-zinc-600">-</span>
            <span className="text-slate-500 dark:text-zinc-400">Ritmo:</span>
            <span className="font-bold text-slate-700 dark:text-zinc-200">
              {formatPacingCurrency(team.ritmoDiarioTotal)}/dia
            </span>
          </div>
        </div>

        {/* Tabela de Pacing com colunas proporcionais */}
        <div className="overflow-x-auto rounded-[4px] border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 scrollbar-none">
          <table className="table-fixed w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/90 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-400">
                <th
                  className={`${density.headerPy} px-2 sm:px-3 font-semibold text-slate-700 dark:text-zinc-300 w-[13%] min-w-[125px]`}
                >
                  VENDEDOR / RITMO
                </th>
                <th
                  className={`${density.headerPy} px-3 text-left font-semibold text-slate-700 dark:text-zinc-300 w-[62%]`}
                >
                  PROGRESSO DA META MENSAL
                </th>
                <th
                  className={`${density.headerPy} px-2 text-right font-mono font-semibold text-slate-700 dark:text-zinc-300 w-[11%] min-w-[105px]`}
                >
                  {viewMode === "daily" ? "META DO DIA (RECÁLCULO)" : "META DA SEMANA"}
                </th>
                <th
                  className={`${density.headerPy} px-2 text-center font-mono font-bold text-emerald-700 bg-emerald-50 border-l border-slate-200 dark:text-emerald-300 dark:bg-emerald-950/20 dark:border-zinc-800 w-[14%] min-w-[130px]`}
                >
                  OPORTUNIDADES DO DIA (DE-PARA)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60 font-mono">
              {team.sellers.map((seller) => {
                // Cálculo das cores da barra de progresso por status
                const barColor =
                  seller.pacingStatus === "acelerado"
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                    : seller.pacingStatus === "alvo"
                      ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]"
                      : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]";

                const badgeClass =
                  seller.pacingStatus === "acelerado"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/50 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : seller.pacingStatus === "alvo"
                      ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/50 dark:bg-blue-950/40 dark:text-blue-300"
                      : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-300";

                const clampedWidth = Math.min(100, Math.max(0, seller.realizedPercent));

                return (
                  <tr
                    key={seller.sellerId}
                    className="hover:bg-slate-50/80 dark:hover:bg-zinc-900/40 transition-colors"
                  >
                    {/* Coluna 1: Vendedor e Ritmo */}
                    <td
                      onClick={() => onSellerClick(seller)}
                      className={`${density.rowPy} px-2 sm:px-3 cursor-pointer hover:bg-slate-100/60 dark:hover:bg-zinc-800/30 transition-colors w-[13%] min-w-[125px]`}
                    >
                      <div className="flex items-center gap-2">
                        {/* Avatar */}
                        <div
                          className={`relative ${density.avatarSize} shrink-0 overflow-hidden rounded-[2px] border border-slate-200 bg-slate-100 dark:border-zinc-800 dark:bg-zinc-900`}
                        >
                          {seller.avatarUrl ? (
                            <img
                              src={seller.avatarUrl}
                              alt={seller.sellerName}
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center font-mono font-bold text-[10px] text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30">
                              {seller.sellerName.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                        </div>

                        {/* Nome e Badge de Ritmo */}
                        <div className="min-w-0 flex-1">
                          <span
                            className={`font-sans ${density.sellerText} text-slate-900 hover:text-red-600 dark:text-white dark:hover:text-red-400 transition-colors truncate block`}
                          >
                            {seller.sellerName}
                          </span>
                          <div className="mt-0.5">
                            <span
                              className={`inline-flex items-center gap-1 rounded-[2px] border font-mono font-bold text-[9px] px-1.5 py-0.2 uppercase ${badgeClass}`}
                            >
                              {seller.pacingStatus === "acelerado" && (
                                <TrendingUp className="h-2.5 w-2.5" />
                              )}
                              {seller.pacingStatus === "alvo" && <Target className="h-2.5 w-2.5" />}
                              {seller.pacingStatus === "recuperar" && (
                                <AlertTriangle className="h-2.5 w-2.5" />
                              )}
                              <span>{seller.statusLabel}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Coluna 2: Progresso da Meta Mensal */}
                    <td className={`${density.rowPy} px-3 w-[62%] align-middle`}>
                      <div className="flex flex-col justify-center gap-1">
                        {/* Valores superior: R$ X de R$ Y | Falta: R$ Z | % */}
                        <div className="flex items-center justify-between text-[11px] font-mono leading-none">
                          <div className="text-slate-800 dark:text-zinc-200 font-bold">
                            <span>{formatPacingCurrency(seller.realizedMonthly)}</span>
                            <span className="text-slate-400 dark:text-zinc-500 font-normal mx-1">
                              de
                            </span>
                            <span className="text-slate-500 dark:text-zinc-400 font-medium">
                              {formatPacingCurrency(seller.metaMonthly)}
                            </span>
                          </div>

                          <div className="text-[10px] text-slate-500 dark:text-zinc-400 font-mono">
                            <span>Falta: </span>
                            <span className="text-slate-700 dark:text-zinc-300 font-semibold">
                              {formatPacingCurrency(seller.remainingMonthly)}
                            </span>
                          </div>

                          <div className="text-slate-900 dark:text-zinc-100 font-black text-xs">
                            {seller.realizedPercent.toFixed(1)}%
                          </div>
                        </div>

                        {/* Barra de Progresso com marcador de Run Rate */}
                        <div
                          className={`relative w-full ${density.pacingBarH} rounded-full bg-slate-200 border border-slate-300 dark:bg-zinc-900 dark:border-zinc-800/80 overflow-visible`}
                        >
                          {/* Barra preenchida animada */}
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${clampedWidth}%` }}
                            transition={{ duration: 0.55, ease: "easeOut" }}
                            className={`h-full rounded-full ${barColor}`}
                          />

                          {/* Marcador vertical de Run Rate (Dia Atual do Mês) */}
                          <div
                            className="absolute -top-1 -bottom-1 w-[2.5px] bg-slate-800 shadow-[0_0_6px_rgba(0,0,0,0.4)] dark:bg-white rounded-full dark:shadow-[0_0_8px_rgba(255,255,255,0.9)] z-10 pointer-events-none"
                            style={{ left: `${globalKpis.elapsedPercent}%` }}
                            title={`Run Rate Hoje: ${globalKpis.elapsedPercent.toFixed(1)}% do mês`}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Coluna 3: Meta do Dia / Meta da Semana */}
                    <td
                      className={`${density.rowPy} px-2 text-right font-mono align-middle w-[11%] min-w-[105px]`}
                    >
                      {viewMode === "daily" ? (
                        <div className="flex flex-col items-end leading-tight">
                          <div className="text-[9.5px] text-slate-500 dark:text-zinc-400">
                            Meta Hoje:{" "}
                            <span className="text-slate-900 dark:text-white font-bold text-xs">
                              {formatPacingCurrency(seller.dailyGoal)}
                            </span>
                          </div>
                          <div className="text-[9px] text-amber-700 dark:text-amber-400 font-semibold mt-0.5">
                            Fechou: {formatPacingCurrency(seller.dailyRealized)} (
                            {seller.dailyRealizedPercent}%)
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end leading-tight">
                          <div className="text-[9.5px] text-slate-500 dark:text-zinc-400">
                            Meta Semana:{" "}
                            <span className="text-slate-900 dark:text-white font-bold text-xs">
                              {formatPacingCurrency(seller.weeklyGoal)}
                            </span>
                          </div>
                          <div className="text-[9px] text-amber-700 dark:text-amber-400 font-semibold mt-0.5">
                            Semana: {formatPacingCurrency(seller.weeklyRealized)} (
                            {seller.weeklyRealizedPercent}%)
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Coluna 4: Oportunidades do Dia (De-Para) */}
                    <td
                      onClick={() => onSellerClick(seller)}
                      className={`${density.rowPy} px-2 text-center align-middle bg-emerald-50/50 border-l border-slate-200 dark:bg-emerald-950/10 dark:border-zinc-800 w-[14%] min-w-[130px]`}
                    >
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        className="w-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 dark:border-emerald-500/60 rounded-[3px] py-1 px-1.5 text-center transition-all cursor-pointer shadow-xs dark:shadow-[0_0_8px_rgba(16,185,129,0.15)]"
                      >
                        <div className="text-emerald-700 dark:text-emerald-300 font-bold text-xs font-mono leading-none">
                          {seller.habeisCount} Hábeis Hoje
                        </div>
                        <div className="text-emerald-600/90 dark:text-emerald-400/80 font-mono text-[9px] mt-0.5 leading-none">
                          {formatPacingCurrency(seller.habeisValue)} no De-Para
                        </div>
                      </motion.button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col justify-between py-1 select-none">
      {/* ─── BARRA SUPERIOR: TAG DA TELA 4 + 3 CARDS DE KPI + TOGGLE DIÁRIA/SEMANAL ─── */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-1 pt-0.5 pb-1">
        {/* Tag da Tela */}
        <div className="flex items-center gap-2">
          <span className="flex h-4 w-4 items-center justify-center rounded-[2px] bg-red-50 border border-red-300 text-red-600 dark:bg-red-950/40 dark:border-red-500/30 dark:text-red-500 font-mono text-[10px] font-black">
            <Gauge className="h-2.5 w-2.5" />
          </span>
          <h2 className="text-[11px] sm:text-xs xl:text-sm font-black uppercase tracking-wider text-red-600 dark:text-[#df3d3d] font-mono leading-normal">
            COCKPIT DE METAS & PACING DIÁRIO (RUN RATE & OPORTUNIDADES)
          </h2>
        </div>

        {/* Centro / Direita: 3 Cards de KPI + Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* KPI 1: Dias Restantes */}
          <motion.div
            whileHover={{ y: -1.5, scale: 1.01 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1.5 rounded-[2px] border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/70 px-2 py-0.5 font-mono text-[10px] shadow-xs"
          >
            <Calendar className="h-3 w-3 text-slate-400 dark:text-zinc-400" />
            <div>
              <div className="text-[8px] uppercase tracking-wider text-slate-500 dark:text-zinc-400 leading-none">
                Dias Restantes
              </div>
              <div className="font-bold text-slate-900 dark:text-white leading-none mt-0.5">
                {globalKpis.businessDaysRemaining} de {globalKpis.businessDaysTotal} dias úteis
              </div>
            </div>
          </motion.div>

          {/* KPI 2: Meta Global */}
          <motion.div
            whileHover={{ y: -1.5, scale: 1.01 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1.5 rounded-[2px] border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/70 px-2 py-0.5 font-mono text-[10px] shadow-xs"
          >
            <Target className="h-3 w-3 text-red-600 dark:text-red-500" />
            <div>
              <div className="text-[8px] uppercase tracking-wider text-slate-500 dark:text-zinc-400 leading-none">
                Meta Global {companyLabel}
              </div>
              <div className="font-bold text-slate-900 dark:text-white leading-none mt-0.5">
                {formatPacingCurrency(globalKpis.metaGlobal)}{" "}
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                  ({globalKpis.globalPercent}% batida)
                </span>
              </div>
            </div>
          </motion.div>

          {/* KPI 3: Pacing da Empresa */}
          <motion.div
            whileHover={{ y: -1.5, scale: 1.01 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1.5 rounded-[2px] border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/70 px-2 py-0.5 font-mono text-[10px] shadow-xs"
          >
            <Zap className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="text-[8px] uppercase tracking-wider text-slate-500 dark:text-zinc-400 leading-none">
                Pacing da Empresa
              </div>
              <div className="font-bold text-slate-900 dark:text-white leading-none mt-0.5">
                {formatPacingCurrency(globalKpis.companyPacingDaily)}/dia{" "}
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  • Hoje: {formatPacingCurrency(globalKpis.companyRealizedToday)}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Alternador Diária / Semanal */}
          <div className="flex items-center rounded-[2px] border border-slate-200 bg-slate-100 dark:border-zinc-800 dark:bg-zinc-950 p-0.5 font-mono text-[10px]">
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => handleToggle("daily")}
              className={`flex items-center gap-1 rounded-[2px] px-2 py-1 font-bold transition-colors cursor-pointer ${
                viewMode === "daily"
                  ? "bg-[#df3d3d] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
              }`}
            >
              <Gauge className="h-3 w-3" />
              <span>Meta Diária</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => handleToggle("weekly")}
              className={`flex items-center gap-1 rounded-[2px] px-2 py-1 font-bold transition-colors cursor-pointer ${
                viewMode === "weekly"
                  ? "bg-[#df3d3d] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
              }`}
            >
              <CalendarDays className="h-3 w-3" />
              <span>Meta Semanal</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* ─── TABELA 1: TIME PERSONNALITÉ ─── */}
      {renderTeamSection(personnaliteData)}

      {/* ─── TABELA 2: TIME SEMI (MÁQUINAS) ─── */}
      {renderTeamSection(semiMaquinasData)}
    </div>
  );
}
