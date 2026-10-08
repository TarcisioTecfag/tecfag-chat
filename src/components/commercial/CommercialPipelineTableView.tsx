import React from "react";
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

  return (
    <div className="w-full h-full flex flex-col justify-around py-0.5 space-y-2 select-none">
      {/* ─── TAG DA TELA 1 ─── */}
      <div className="flex items-center gap-2 px-1">
        <span className="flex h-4 w-4 items-center justify-center rounded-[2px] bg-red-950/40 border border-red-500/30 text-red-500 font-mono text-[10px] font-black">
          ⊞
        </span>
        <h2 className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-[#df3d3d] font-mono">
          OPORTUNIDADES & PIPELINE POR FASE (RD CRM)
        </h2>
      </div>

      {/* ─── TABELA 1: TIME PERSONNALITÉ ─── */}
      <div className="space-y-1">
        {/* Cabeçalho da Equipe */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-red-400 font-mono">
            <Star className="h-3 w-3 fill-red-400 text-red-400" />
            <span>TIME PERSONNALITÉ</span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[10px]">
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
                <th className="py-1.5 px-3 font-semibold text-zinc-300">VENDEDOR</th>
                {PIPELINE_STAGES.map((stage) => (
                  <th
                    key={stage.key}
                    onClick={() => onHeaderStageClick(stage.key)}
                    className="py-1.5 px-2 text-center font-mono hover:text-white cursor-pointer transition-colors"
                  >
                    {stage.bracketLabel}
                  </th>
                ))}
                <th className="py-1.5 px-3 text-center font-mono font-bold text-emerald-300 bg-emerald-950/25 border-l border-zinc-800">
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
                    className="py-1.5 px-3 font-sans font-bold text-xs text-white hover:text-red-400 cursor-pointer transition-colors whitespace-nowrap"
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
                        className="py-1 px-1.5 text-center hover:bg-zinc-800/60 hover:ring-1 hover:ring-red-500/40 cursor-pointer transition-all rounded-[2px]"
                      >
                        <div className="font-sans font-black text-xs text-white leading-tight">
                          {data.count}
                        </div>
                        <div className="text-[9.5px] text-emerald-400 font-medium leading-none mt-0.5">
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
                    className="py-1 px-2.5 text-center bg-emerald-950/15 border-l border-zinc-800 hover:bg-emerald-950/30 cursor-pointer transition-all"
                  >
                    <div className="font-sans font-black text-xs text-white leading-tight">
                      {seller.totalCards}
                    </div>
                    <div className="text-[9.5px] text-emerald-400 font-bold leading-none mt-0.5">
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
                  className="py-1.5 px-3 font-sans font-black text-white uppercase text-[11px] tracking-wider hover:text-red-400 cursor-pointer"
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
                      className="py-1 px-1.5 text-center hover:bg-zinc-800/60 cursor-pointer"
                    >
                      <div className="font-sans font-black text-xs text-white leading-tight">
                        {data.count}
                      </div>
                      <div className="text-[9.5px] text-emerald-400 font-bold leading-none mt-0.5">
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
                  className="py-1.5 px-2.5 text-center bg-emerald-950/30 border-l border-zinc-800 font-black hover:bg-emerald-950/50 cursor-pointer"
                >
                  <div className="font-sans font-black text-xs text-white leading-tight">
                    {personnaliteData.totalCards}
                  </div>
                  <div className="text-[9.5px] text-emerald-400 font-extrabold leading-none mt-0.5">
                    {formatAbbreviatedCurrency(personnaliteData.totalValue, true)}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── TABELA 2: TIME SEMI (MÁQUINAS) ─── */}
      <div className="space-y-1">
        {/* Cabeçalho da Equipe */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-red-400 font-mono">
            <Flag className="h-3 w-3 fill-red-400 text-red-400" />
            <span>TIME SEMI (MÁQUINAS)</span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[10px]">
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
                <th className="py-1.5 px-3 font-semibold text-zinc-300">VENDEDOR</th>
                {PIPELINE_STAGES.map((stage) => (
                  <th
                    key={stage.key}
                    onClick={() => onHeaderStageClick(stage.key)}
                    className="py-1.5 px-2 text-center font-mono hover:text-white cursor-pointer transition-colors"
                  >
                    {stage.bracketLabel}
                  </th>
                ))}
                <th className="py-1.5 px-3 text-center font-mono font-bold text-emerald-300 bg-emerald-950/25 border-l border-zinc-800">
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
                    className="py-1.5 px-3 font-sans font-bold text-xs text-white hover:text-red-400 cursor-pointer transition-colors whitespace-nowrap"
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
                        className="py-1 px-1.5 text-center hover:bg-zinc-800/60 hover:ring-1 hover:ring-red-500/40 cursor-pointer transition-all rounded-[2px]"
                      >
                        <div className="font-sans font-black text-xs text-white leading-tight">
                          {data.count}
                        </div>
                        <div className="text-[9.5px] text-emerald-400 font-medium leading-none mt-0.5">
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
                    className="py-1 px-2.5 text-center bg-emerald-950/15 border-l border-zinc-800 hover:bg-emerald-950/30 cursor-pointer transition-all"
                  >
                    <div className="font-sans font-black text-xs text-white leading-tight">
                      {seller.totalCards}
                    </div>
                    <div className="text-[9.5px] text-emerald-400 font-bold leading-none mt-0.5">
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
                  className="py-1.5 px-3 font-sans font-black text-white uppercase text-[11px] tracking-wider hover:text-red-400 cursor-pointer"
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
                      className="py-1 px-1.5 text-center hover:bg-zinc-800/60 cursor-pointer"
                    >
                      <div className="font-sans font-black text-xs text-white leading-tight">
                        {data.count}
                      </div>
                      <div className="text-[9.5px] text-emerald-400 font-bold leading-none mt-0.5">
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
                  className="py-1.5 px-2.5 text-center bg-emerald-950/30 border-l border-zinc-800 font-black hover:bg-emerald-950/50 cursor-pointer"
                >
                  <div className="font-sans font-black text-xs text-white leading-tight">
                    {semiMaquinasData.totalCards}
                  </div>
                  <div className="text-[9.5px] text-emerald-400 font-extrabold leading-none mt-0.5">
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
