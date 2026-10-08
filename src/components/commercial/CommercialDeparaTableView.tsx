import React, { useMemo } from "react";
import { ClipboardList, Star } from "lucide-react";
import {
  DEPARA_TIERS,
  DeparaTierKey,
  formatDeparaMeta,
  SellerDeparaRow,
  TeamDeparaData,
} from "@/lib/commercial/depara-data";

interface CommercialDeparaTableViewProps {
  personnaliteData: TeamDeparaData;
  semiMaquinasData: TeamDeparaData;
  onCellClick: (seller: SellerDeparaRow, tierKey: DeparaTierKey | "all") => void;
  onTasksClick?: (seller: SellerDeparaRow) => void;
  onHeaderTierClick?: (tierKey: DeparaTierKey) => void;
}

export function CommercialDeparaTableView({
  personnaliteData,
  semiMaquinasData,
  onCellClick,
  onTasksClick,
  onHeaderTierClick,
}: CommercialDeparaTableViewProps) {
  const totalSellers = personnaliteData.sellers.length + semiMaquinasData.sellers.length;

  // Responsividade dinâmica: adapta a altura e espessura das linhas com base no número total de consultores
  // Evita vazios pretos gigantes e garante TV layout perfeito sem scrollbars
  const density = useMemo(() => {
    if (totalSellers <= 10) {
      return {
        rowPy: "py-1 sm:py-1.5 xl:py-2",
        tierPy: "py-0.5 sm:py-1 xl:py-1.5",
        headerPy: "py-1.5 sm:py-2 xl:py-2",
        sellerText: "text-xs sm:text-xs xl:text-sm font-bold",
        metaSubText: "text-[9px] sm:text-[9.5px] xl:text-[10px]",
        tierBtnPy: "py-1.5 sm:py-2 xl:py-2.5 px-1 sm:px-2",
        totalText: "text-xs sm:text-sm xl:text-base font-black",
        totalBadge: "text-[9px] sm:text-[9.5px] xl:text-[10px] px-1.5 py-0.5",
        teamTitle: "text-xs sm:text-xs xl:text-sm font-black",
        teamSummary: "text-[10px] sm:text-xs xl:text-sm",
        tableSpace: "space-y-1 sm:space-y-1.5",
        avatarSize: "h-8 w-8 sm:h-9 sm:w-9 xl:h-10 xl:w-10",
      };
    }
    if (totalSellers <= 16) {
      return {
        rowPy: "py-0.5 sm:py-1 xl:py-1.5",
        tierPy: "py-0.5 sm:py-1",
        headerPy: "py-1 sm:py-1.5",
        sellerText: "text-xs font-bold",
        metaSubText: "text-[8.5px] sm:text-[9px]",
        tierBtnPy: "py-1 sm:py-1.5 px-1",
        totalText: "text-xs sm:text-sm font-black",
        totalBadge: "text-[8.5px] px-1 py-0.5",
        teamTitle: "text-xs font-bold",
        teamSummary: "text-[10px] sm:text-xs",
        tableSpace: "space-y-0.5 sm:space-y-1",
        avatarSize: "h-7 w-7 sm:h-8 sm:w-8",
      };
    }
    return {
      rowPy: "py-0.5 px-2",
      tierPy: "py-0.5 px-1",
      headerPy: "py-1 px-2",
      sellerText: "text-[11px] font-semibold",
      metaSubText: "text-[8px] leading-tight",
      tierBtnPy: "py-0.5 px-1",
      totalText: "text-xs font-bold",
      totalBadge: "text-[8px] px-1 py-0.5",
      teamTitle: "text-[11px] font-bold",
      teamSummary: "text-[10px]",
      tableSpace: "space-y-0.5",
      avatarSize: "h-6 w-6",
    };
  }, [totalSellers]);

  const renderTeamSection = (team: TeamDeparaData) => {
    return (
      <div className={density.tableSpace} key={team.division}>
        {/* Cabeçalho da Equipe */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className={`flex items-center gap-1.5 ${density.teamTitle} uppercase tracking-wider text-red-400 font-mono`}>
            <Star className="h-3.5 w-3.5 fill-red-400 text-red-400" />
            <span>{team.teamName}</span>
          </div>

          <div className={`flex items-center gap-2 font-mono ${density.teamSummary}`}>
            <span className="text-zinc-400">Meta:</span>
            <span className="font-bold text-emerald-400">{formatDeparaMeta(team.metaTotal)}</span>
            <span className="text-zinc-600">-</span>
            <span className="text-zinc-400">Maduro:</span>
            <span className="font-bold text-emerald-400">{formatDeparaMeta(team.maduroTotal)}</span>
            <span className="text-zinc-600">-</span>
            <span className="text-zinc-400">Promessa:</span>
            <span className="font-bold text-emerald-400">{formatDeparaMeta(team.promessaTotal)}</span>
          </div>
        </div>

        {/* Tabela de Dados De-Para com larguras proporcionais escalonadas por cor */}
        <div className="overflow-x-auto rounded-[4px] border border-zinc-800 bg-zinc-950/70 shadow-sm scrollbar-none">
          <table className="table-fixed w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/90 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                <th className={`${density.headerPy} px-2 sm:px-3 font-semibold text-zinc-300 w-[11%] min-w-[120px]`}>
                  VENDEDOR / META
                </th>
                {DEPARA_TIERS.map((tier) => (
                  <th
                    key={tier.key}
                    onClick={() => onHeaderTierClick?.(tier.key)}
                    className={`${density.headerPy} px-1 text-center font-mono hover:text-white cursor-pointer transition-colors ${tier.colWidth}`}
                  >
                    <div className="font-bold text-zinc-200 tracking-wider text-[10px] sm:text-[11px] xl:text-xs">
                      {tier.daysLabel}
                    </div>
                    <div className="text-[8.5px] sm:text-[9px] font-medium text-zinc-400 tracking-normal mt-0.5">
                      {tier.thresholdLabel}
                    </div>
                  </th>
                ))}
                <th className={`${density.headerPy} px-1.5 sm:px-2 text-center font-mono font-bold text-emerald-300 bg-emerald-950/25 border-l border-zinc-800 w-[6%] min-w-[70px]`}>
                  TOTAL MADURO
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {team.sellers.map((seller) => (
                <tr key={seller.sellerId} className="hover:bg-zinc-900/40 transition-colors">
                  {/* Coluna Vendedor / Meta */}
                  <td
                    onClick={() => onCellClick(seller, "all")}
                    className={`${density.rowPy} px-2 sm:px-3 cursor-pointer hover:bg-zinc-800/30 transition-colors w-[11%] min-w-[120px]`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Avatar Angular */}
                      <div className={`relative ${density.avatarSize} shrink-0 overflow-hidden rounded-[2px] border border-zinc-800 bg-zinc-900`}>
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
                          <div className="flex h-full w-full items-center justify-center font-mono font-bold text-[10px] text-red-400 bg-red-950/30">
                            {seller.sellerName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </div>

                      {/* Nome e Metas */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`font-sans ${density.sellerText} text-white hover:text-red-400 transition-colors truncate`}>
                            {seller.sellerName}
                          </span>
                          <span className="font-mono text-[9px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-1 py-0.2 rounded-[2px]">
                            {formatDeparaMeta(seller.metaValue)}
                          </span>
                        </div>
                        <div className={`font-mono ${density.metaSubText} text-zinc-400 truncate mt-0.5`}>
                          <span>{seller.conversionPercent}%</span>
                          <span className="mx-1 text-zinc-600">·</span>
                          <span className="text-emerald-400 font-bold">
                            {formatDeparaMeta(seller.realizedValue)} ({seller.realizedPercent}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* 5 Colunas de Faixas De-Para com larguras progressivas (Vermelho menor -> Verde maior) */}
                  {DEPARA_TIERS.map((tier) => {
                    const tierData = seller.tiers[tier.key];
                    const is90d = tier.key === "tier_90d";

                    return (
                      <td
                        key={tier.key}
                        className={`${density.tierPy} px-1 text-center align-middle ${tier.colWidth}`}
                      >
                        {is90d ? (
                          /* Célula 90D: Barra Verde Maior + Botão de Tarefas */
                          <div className="flex items-center gap-1.5 w-full">
                            <button
                              type="button"
                              onClick={() => onCellClick(seller, "tier_90d")}
                              className={`flex-1 w-full bg-[#047857] hover:bg-[#059669] text-white ${density.tierBtnPy} rounded-[2px] shadow-sm font-mono font-bold text-xs xl:text-sm tracking-wide uppercase transition-transform active:scale-[0.98] cursor-pointer text-center flex items-center justify-center`}
                            >
                              {tierData.formatted}
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onTasksClick) {
                                  onTasksClick(seller);
                                } else {
                                  onCellClick(seller, "all");
                                }
                              }}
                              title={`${seller.tasksCount} tarefas em aberto`}
                              className="shrink-0 inline-flex items-center justify-center gap-1 rounded-[2px] border border-zinc-700/60 bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 px-2 py-1 sm:py-1.5 text-[10px] sm:text-xs font-mono font-bold transition-colors cursor-pointer shadow-sm"
                            >
                              <ClipboardList className="h-3 w-3 text-zinc-400" />
                              <span>{seller.tasksCount}</span>
                            </button>
                          </div>
                        ) : (
                          /* Células 3D, 15D, 30D, 60D: Barra proporcional ocupando 100% da largura da coluna */
                          <button
                            type="button"
                            onClick={() => onCellClick(seller, tier.key)}
                            className={`w-full ${tier.colorClass} ${density.tierBtnPy} rounded-[2px] shadow-sm font-mono font-bold text-xs xl:text-sm tracking-wide uppercase transition-transform active:scale-[0.98] cursor-pointer text-center flex items-center justify-center`}
                          >
                            {tierData.formatted}
                          </button>
                        )}
                      </td>
                    );
                  })}

                  {/* Coluna Total Maduro */}
                  <td
                    onClick={() => onCellClick(seller, "all")}
                    className={`${density.tierPy} px-1.5 text-center bg-emerald-950/15 border-l border-zinc-800 hover:bg-emerald-950/30 cursor-pointer transition-all align-middle w-[6%] min-w-[70px]`}
                  >
                    <div className={`font-mono font-black ${density.totalText} text-emerald-400 leading-tight`}>
                      {formatDeparaMeta(seller.totalMaduroValue)}
                    </div>
                    <div className="mt-0.5">
                      <span className={`inline-block rounded-[2px] border border-emerald-500/40 bg-emerald-950/60 font-mono font-bold text-emerald-300 ${density.totalBadge}`}>
                        {seller.totalMaduroPercent}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col justify-between py-1 select-none">
      {/* ─── TAG DA TELA 2 ─── */}
      <div className="shrink-0 flex items-center gap-2 px-1 pt-0.5 pb-0.5">
        <span className="flex h-4 w-4 items-center justify-center rounded-[2px] bg-red-950/40 border border-red-500/30 text-red-500 font-mono text-[10px] font-black">
          ⊞
        </span>
        <h2 className="text-[11px] sm:text-xs xl:text-sm font-black uppercase tracking-wider text-[#df3d3d] font-mono leading-normal">
          RESPONSABILIDADES POR DEPARA CWR
        </h2>
      </div>

      {/* ─── TABELA 1: TIME PERSONNALITÉ ─── */}
      {renderTeamSection(personnaliteData)}

      {/* ─── TABELA 2: TIME SEMI (MÁQUINAS) ─── */}
      {renderTeamSection(semiMaquinasData)}
    </div>
  );
}
