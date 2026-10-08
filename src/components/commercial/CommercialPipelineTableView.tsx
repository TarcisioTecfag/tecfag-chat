import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { Flag, Star } from "lucide-react";
import {
  formatAbbreviatedCurrency,
  formatPercentage,
  formatTeamSummary,
  PipelineStageKey,
  PIPELINE_STAGES,
  SellerPipelineRow,
  TeamPipelineData,
} from "@/lib/commercial/pipeline-data";

interface CommercialPipelineTableViewProps {
  personnaliteData: TeamPipelineData;
  semiMaquinasData: TeamPipelineData;
  onCellClick: (
    seller: SellerPipelineRow | null,
    stageKey: PipelineStageKey | "all",
    division?: "personnalite" | "maquinas",
  ) => void;
  onHeaderStageClick: (stageKey: PipelineStageKey) => void;
}

export function CommercialPipelineTableView({
  personnaliteData,
  semiMaquinasData,
  onCellClick,
  onHeaderStageClick,
}: CommercialPipelineTableViewProps) {
  const pSummary = formatTeamSummary(personnaliteData.totalCards, personnaliteData.totalValue);
  const mSummary = formatTeamSummary(semiMaquinasData.totalCards, semiMaquinasData.totalValue);

  const totalSellers = personnaliteData.sellers.length + semiMaquinasData.sellers.length;

  // Responsividade dinâmica: adapta a altura e espessura das linhas com base no número total de consultores
  // Evita vazios pretos gigantes quando há poucos consultores e comprime proporcionalmente quando a equipe cresce
  const density = useMemo(() => {
    // Modo Amplo & Robusto (<= 10 consultores, estado atual com 4 + 6 = 10)
    // Linhas encorpadas e robustas, perfeitamente calibradas para não estourar a viewport
    if (totalSellers <= 10) {
      return {
        rowPy: "py-1.5 sm:py-2 xl:py-2.5",
        stagePy: "py-1 sm:py-1.5 xl:py-2",
        headerPy: "py-1.5 sm:py-2 xl:py-2",
        sellerText: "text-xs sm:text-xs xl:text-sm font-bold",
        countText: "text-xs sm:text-sm xl:text-base font-black",
        subText: "text-[9.5px] sm:text-[10px] xl:text-[11px] font-semibold",
        teamTitle: "text-xs sm:text-xs xl:text-sm font-black",
        teamSummary: "text-[10px] sm:text-xs xl:text-sm",
        gap: "gap-2 sm:gap-2.5 xl:gap-3",
        tableSpace: "space-y-1 sm:space-y-1.5",
      };
    }
    // Modo Intermediário (11 a 16 consultores)
    if (totalSellers <= 16) {
      return {
        rowPy: "py-1 sm:py-1.5 xl:py-2",
        stagePy: "py-0.5 sm:py-1 xl:py-1.5",
        headerPy: "py-1 sm:py-1.5",
        sellerText: "text-xs font-bold",
        countText: "text-xs sm:text-sm font-black",
        subText: "text-[9px] sm:text-[9.5px] xl:text-[10px] font-medium",
        teamTitle: "text-xs font-bold",
        teamSummary: "text-[10px] sm:text-xs",
        gap: "gap-1.5 sm:gap-2",
        tableSpace: "space-y-0.5 sm:space-y-1",
      };
    }
    // Modo Compacto (> 16 consultores)
    return {
      rowPy: "py-0.5 px-2",
      stagePy: "py-0.5 px-1.5",
      headerPy: "py-1 px-2",
      sellerText: "text-[11px] font-semibold",
      countText: "text-xs font-bold",
      subText: "text-[9px] font-normal leading-none",
      teamTitle: "text-[11px] font-bold",
      teamSummary: "text-[10px]",
      gap: "gap-1",
      tableSpace: "space-y-0.5",
    };
  }, [totalSellers]);

  return (
    <div className="w-full h-full flex flex-col justify-between py-1 select-none">
      {/* ─── TAG DA TELA 1 ─── */}
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25 }}
        className="shrink-0 flex items-center gap-2 px-1 pt-0.5 pb-0.5"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-[2px] bg-red-950/40 border border-red-500/30 text-red-500 font-mono text-[10px] font-black">
          ⊞
        </span>
        <h2 className="text-[11px] sm:text-xs xl:text-sm font-black uppercase tracking-wider text-[#df3d3d] font-mono leading-normal">
          OPORTUNIDADES & PIPELINE POR FASE (CRM)
        </h2>
      </motion.div>

      {/* ─── TABELA 1: TIME PERSONNALITÉ ─── */}
      <div className={density.tableSpace}>
        {/* Cabeçalho da Equipe */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className={`flex items-center gap-1.5 ${density.teamTitle} uppercase tracking-wider text-red-400 font-mono`}>
            <Star className="h-3.5 w-3.5 fill-red-400 text-red-400" />
            <span>TIME PERSONNALITÉ</span>
          </div>

          <div className={`flex items-center gap-2 font-mono ${density.teamSummary}`}>
            <span className="text-zinc-400">{pSummary.cards}</span>
            <span className="text-zinc-600">-</span>
            <span className="font-bold text-emerald-400">{pSummary.value}</span>
          </div>
        </div>

        {/* Tabela de Dados */}
        <div className="overflow-x-auto rounded-[4px] border border-zinc-800 bg-zinc-950/70 shadow-sm scrollbar-none">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/90 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                <th className={`${density.headerPy} px-3 sm:px-4 font-semibold text-zinc-300`}>VENDEDOR</th>
                {PIPELINE_STAGES.map((stage) => (
                  <th
                    key={stage.key}
                    onClick={() => onHeaderStageClick(stage.key)}
                    className={`${density.headerPy} px-2 text-center font-mono hover:text-white cursor-pointer transition-colors`}
                  >
                    {stage.bracketLabel}
                  </th>
                ))}
                <th className={`${density.headerPy} px-3 text-center font-mono font-bold text-emerald-300 bg-emerald-950/25 border-l border-zinc-800`}>
                  TOTAL FUNIL
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {personnaliteData.sellers.map((seller) => (
                <tr key={seller.sellerId} className="hover:bg-zinc-900/40 transition-colors">
                  {/* Nome do Vendedor */}
                  <td
                    onClick={() => onCellClick(seller, "all", "personnalite")}
                    className={`${density.rowPy} px-3 sm:px-4 font-sans ${density.sellerText} text-white hover:text-red-400 cursor-pointer transition-colors whitespace-nowrap`}
                  >
                    {seller.sellerName}
                  </td>

                  {/* Células das Fases */}
                  {PIPELINE_STAGES.map((stage) => {
                    const data = seller.stages[stage.key];
                    const hasValue = data.value > 0;
                    return (
                      <td
                        key={stage.key}
                        onClick={() => onCellClick(seller, stage.key, "personnalite")}
                        className={`${density.stagePy} px-1.5 sm:px-2 text-center hover:bg-zinc-800/60 hover:ring-1 hover:ring-red-500/40 cursor-pointer transition-all rounded-[2px]`}
                      >
                        <div className={`font-sans font-black ${density.countText} text-white leading-tight`}>
                          {data.count}
                        </div>
                        <div className={`${density.subText} text-emerald-400 font-medium leading-none mt-0.5`}>
                          {hasValue ? (
                            <span>
                              {formatAbbreviatedCurrency(data.value)}{" "}
                              <span className="text-emerald-400/80">{formatPercentage(data.percent)}</span>
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </div>
                      </td>
                    );
                  })}

                  {/* Coluna Total Funil do Vendedor */}
                  <td
                    onClick={() => onCellClick(seller, "all", "personnalite")}
                    className={`${density.stagePy} px-2.5 text-center bg-emerald-950/15 border-l border-zinc-800 hover:bg-emerald-950/30 cursor-pointer transition-all`}
                  >
                    <div className={`font-sans font-black ${density.countText} text-white leading-tight`}>
                      {seller.totalCards}
                    </div>
                    <div className={`${density.subText} text-emerald-400 font-bold leading-none mt-0.5`}>
                      {formatAbbreviatedCurrency(seller.totalValue, true)}{" "}
                      <span className="text-emerald-300">{seller.teamSharePercent}%</span>
                    </div>
                  </td>
                </tr>
              ))}

              {/* Linha Total da Equipe */}
              <tr className="border-t-2 border-zinc-700 bg-zinc-900/90 font-bold">
                <td
                  onClick={() => onCellClick(null, "all", "personnalite")}
                  className={`${density.rowPy} px-3 sm:px-4 font-sans font-black text-white uppercase ${density.sellerText} tracking-wider hover:text-red-400 cursor-pointer`}
                >
                  TOTAL PERSONNALITÉ
                </td>

                {PIPELINE_STAGES.map((stage) => {
                  const data = personnaliteData.stageTotals[stage.key];
                  const hasValue = data.value > 0;
                  return (
                    <td
                      key={stage.key}
                      onClick={() => onCellClick(null, stage.key, "personnalite")}
                      className={`${density.stagePy} px-1.5 sm:px-2 text-center hover:bg-zinc-800/60 cursor-pointer`}
                    >
                      <div className={`font-sans font-black ${density.countText} text-white leading-tight`}>
                        {data.count}
                      </div>
                      <div className={`${density.subText} text-emerald-400 font-bold leading-none mt-0.5`}>
                        {hasValue ? (
                          <span>
                            {formatAbbreviatedCurrency(data.value)}{" "}
                            <span className="text-emerald-300">{formatPercentage(data.percent)}</span>
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </div>
                    </td>
                  );
                })}

                {/* Total Global da Equipe */}
                <td
                  onClick={() => onCellClick(null, "all", "personnalite")}
                  className={`${density.stagePy} px-2.5 text-center bg-emerald-950/30 border-l border-zinc-800 font-black hover:bg-emerald-950/50 cursor-pointer`}
                >
                  <div className={`font-sans font-black ${density.countText} text-white leading-tight`}>
                    {personnaliteData.totalCards}
                  </div>
                  <div className={`${density.subText} text-emerald-400 font-extrabold leading-none mt-0.5`}>
                    {formatAbbreviatedCurrency(personnaliteData.totalValue, true)}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── TABELA 2: TIME SEMI (MÁQUINAS) ─── */}
      <div className={density.tableSpace}>
        {/* Cabeçalho da Equipe */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className={`flex items-center gap-1.5 ${density.teamTitle} uppercase tracking-wider text-red-400 font-mono`}>
            <Flag className="h-3.5 w-3.5 fill-red-400 text-red-400" />
            <span>TIME SEMI (MÁQUINAS)</span>
          </div>

          <div className={`flex items-center gap-2 font-mono ${density.teamSummary}`}>
            <span className="text-zinc-400">{mSummary.cards}</span>
            <span className="text-zinc-600">-</span>
            <span className="font-bold text-emerald-400">{mSummary.value}</span>
          </div>
        </div>

        {/* Tabela de Dados */}
        <div className="overflow-x-auto rounded-[4px] border border-zinc-800 bg-zinc-950/70 shadow-sm scrollbar-none">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/90 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                <th className={`${density.headerPy} px-3 sm:px-4 font-semibold text-zinc-300`}>VENDEDOR</th>
                {PIPELINE_STAGES.map((stage) => (
                  <th
                    key={stage.key}
                    onClick={() => onHeaderStageClick(stage.key)}
                    className={`${density.headerPy} px-2 text-center font-mono hover:text-white cursor-pointer transition-colors`}
                  >
                    {stage.bracketLabel}
                  </th>
                ))}
                <th className={`${density.headerPy} px-3 text-center font-mono font-bold text-emerald-300 bg-emerald-950/25 border-l border-zinc-800`}>
                  TOTAL FUNIL
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {semiMaquinasData.sellers.map((seller) => (
                <tr key={seller.sellerId} className="hover:bg-zinc-900/40 transition-colors">
                  {/* Nome do Vendedor */}
                  <td
                    onClick={() => onCellClick(seller, "all", "maquinas")}
                    className={`${density.rowPy} px-3 sm:px-4 font-sans ${density.sellerText} text-white hover:text-red-400 cursor-pointer transition-colors whitespace-nowrap`}
                  >
                    {seller.sellerName}
                  </td>

                  {/* Células das Fases */}
                  {PIPELINE_STAGES.map((stage) => {
                    const data = seller.stages[stage.key];
                    const hasValue = data.value > 0;
                    return (
                      <td
                        key={stage.key}
                        onClick={() => onCellClick(seller, stage.key, "maquinas")}
                        className={`${density.stagePy} px-1.5 sm:px-2 text-center hover:bg-zinc-800/60 hover:ring-1 hover:ring-red-500/40 cursor-pointer transition-all rounded-[2px]`}
                      >
                        <div className={`font-sans font-black ${density.countText} text-white leading-tight`}>
                          {data.count}
                        </div>
                        <div className={`${density.subText} text-emerald-400 font-medium leading-none mt-0.5`}>
                          {hasValue ? (
                            <span>
                              {formatAbbreviatedCurrency(data.value)}{" "}
                              <span className="text-emerald-400/80">{formatPercentage(data.percent)}</span>
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </div>
                      </td>
                    );
                  })}

                  {/* Coluna Total Funil do Vendedor */}
                  <td
                    onClick={() => onCellClick(seller, "all", "maquinas")}
                    className={`${density.stagePy} px-2.5 text-center bg-emerald-950/15 border-l border-zinc-800 hover:bg-emerald-950/30 cursor-pointer transition-all`}
                  >
                    <div className={`font-sans font-black ${density.countText} text-white leading-tight`}>
                      {seller.totalCards}
                    </div>
                    <div className={`${density.subText} text-emerald-400 font-bold leading-none mt-0.5`}>
                      {formatAbbreviatedCurrency(seller.totalValue, true)}{" "}
                      <span className="text-emerald-300">{seller.teamSharePercent}%</span>
                    </div>
                  </td>
                </tr>
              ))}

              {/* Linha Total da Equipe */}
              <tr className="border-t-2 border-zinc-700 bg-zinc-900/90 font-bold">
                <td
                  onClick={() => onCellClick(null, "all", "maquinas")}
                  className={`${density.rowPy} px-3 sm:px-4 font-sans font-black text-white uppercase ${density.sellerText} tracking-wider hover:text-red-400 cursor-pointer`}
                >
                  TOTAL SEMI
                </td>

                {PIPELINE_STAGES.map((stage) => {
                  const data = semiMaquinasData.stageTotals[stage.key];
                  const hasValue = data.value > 0;
                  return (
                    <td
                      key={stage.key}
                      onClick={() => onCellClick(null, stage.key, "maquinas")}
                      className={`${density.stagePy} px-1.5 sm:px-2 text-center hover:bg-zinc-800/60 cursor-pointer`}
                    >
                      <div className={`font-sans font-black ${density.countText} text-white leading-tight`}>
                        {data.count}
                      </div>
                      <div className={`${density.subText} text-emerald-400 font-bold leading-none mt-0.5`}>
                        {hasValue ? (
                          <span>
                            {formatAbbreviatedCurrency(data.value)}{" "}
                            <span className="text-emerald-300">{formatPercentage(data.percent)}</span>
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </div>
                    </td>
                  );
                })}

                {/* Total Global da Equipe */}
                <td
                  onClick={() => onCellClick(null, "all", "maquinas")}
                  className={`${density.stagePy} px-2.5 text-center bg-emerald-950/30 border-l border-zinc-800 font-black hover:bg-emerald-950/50 cursor-pointer`}
                >
                  <div className={`font-sans font-black ${density.countText} text-white leading-tight`}>
                    {semiMaquinasData.totalCards}
                  </div>
                  <div className={`${density.subText} text-emerald-400 font-extrabold leading-none mt-0.5`}>
                    {formatAbbreviatedCurrency(semiMaquinasData.totalValue, true)}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
