import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Phone,
  Search,
  Sliders,
  X,
} from "lucide-react";
import { PacingDealItem, formatPacingCurrency } from "@/lib/commercial/pacing-data";
import { getDeterministicConsultantAvatar } from "@/lib/commercial/avatar-matcher";

interface CommercialPacingFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerName?: string;
  sellerId?: string;
  division?: "personnalite" | "maquinas";
  metaValue?: number;
  deals: PacingDealItem[];
  sellerAvatar?: string;
  onOpenDeal?: (dealId: string) => void;
  onOpenProfile?: (sellerId?: string) => void;
  onCallContact?: (phone: string, dealTitle: string) => void;
}

export function CommercialPacingFilterModal({
  isOpen,
  onClose,
  sellerName = "Equipe comercial",
  sellerId,
  division = "personnalite",
  metaValue = 0,
  deals: initialDeals,
  sellerAvatar,
  onOpenDeal,
  onOpenProfile,
  onCallContact,
}: CommercialPacingFilterModalProps) {
  const [selectedHorizon, setSelectedHorizon] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dealsList, setDealsList] = useState<PacingDealItem[]>(initialDeals);

  // Sincroniza deals iniciais
  useMemo(() => {
    setDealsList(initialDeals);
    setSelectedHorizon("all");
    setSearchQuery("");
  }, [initialDeals]);

  // Contagem por aba de horizonte
  const horizonCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: dealsList.length,
      tier_3d: 0,
      tier_15d: 0,
      tier_30d: 0,
      tier_60d: 0,
      tier_90d: 0,
      fora_regua: 0,
    };
    for (const deal of dealsList) {
      if (counts[deal.horizonKey] !== undefined) {
        counts[deal.horizonKey] += 1;
      }
    }
    return counts;
  }, [dealsList]);

  // Filtro por busca e faixa
  const filteredDeals = useMemo(() => {
    return dealsList.filter((deal) => {
      if (selectedHorizon !== "all" && deal.horizonKey !== selectedHorizon) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        deal.title.toLowerCase().includes(q) ||
        deal.code.toLowerCase().includes(q) ||
        deal.companyName.toLowerCase().includes(q) ||
        deal.crmStage.toLowerCase().includes(q) ||
        (deal.phone && deal.phone.includes(q))
      );
    });
  }, [dealsList, selectedHorizon, searchQuery]);

  if (!isOpen) return null;

  const divisionBadge = division === "personnalite" ? "PERSONNALITÉ" : "MÁQUINAS";

  const getTierColorBadge = (key: string) => {
    switch (key) {
      case "tier_3d":
        return "border-red-300 text-red-700 bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:bg-red-950/20";
      case "tier_15d":
        return "border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-500/40 dark:text-amber-400 dark:bg-amber-950/20";
      case "tier_30d":
        return "border-blue-300 text-blue-700 bg-blue-50 dark:border-blue-500/40 dark:text-blue-400 dark:bg-blue-950/20";
      case "tier_60d":
        return "border-purple-300 text-purple-700 bg-purple-50 dark:border-purple-500/40 dark:text-purple-400 dark:bg-purple-950/20";
      case "tier_90d":
        return "border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400 dark:bg-emerald-950/20";
      default:
        return "border-slate-300 text-slate-600 bg-slate-100 dark:border-zinc-700 dark:text-zinc-400 dark:bg-zinc-900";
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-6xl max-h-[92vh] rounded-[4px] border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0c0d12] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── 1. CABEÇALHO DO MODAL (FOTO 2) ─── */}
        <div className="shrink-0 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-950/80 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar Angular */}
            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[2px] border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900">
                <img
                  src={sellerAvatar || getDeterministicConsultantAvatar(sellerName)}
                  alt={sellerName}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    const img = e.currentTarget;
                    const fallback = getDeterministicConsultantAvatar(sellerName);
                    if (img.src !== fallback) {
                      img.src = fallback;
                    }
                  }}
                />
            </div>

            {/* Informações do Consultor */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-sans font-black text-slate-900 dark:text-white text-base tracking-tight truncate">
                  {sellerName}
                </h3>
                <span className="rounded-[2px] border border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.2 font-mono text-[9px] font-bold uppercase tracking-wider text-red-700 dark:text-red-400">
                  {divisionBadge}
                </span>
                <span className="rounded-[2px] border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 px-1.5 py-0.2 font-mono text-[9px] font-bold text-slate-700 dark:text-zinc-300">
                  Meta: {formatPacingCurrency(metaValue)}
                </span>
                {onOpenProfile && (
                  <button
                    type="button"
                    onClick={() => onOpenProfile(sellerId)}
                    className="flex items-center gap-1 font-mono text-[10px] text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline underline-offset-2 transition-colors cursor-pointer"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>Abrir perfil</span>
                  </button>
                )}
              </div>
              <p className="font-sans text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 truncate">
                Oportunidades em andamento classificadas pelo De-Para de Maturidade [Tempo vs Valor]
              </p>
            </div>
          </div>

          {/* Botão Fechar */}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[2px] border border-slate-200 bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ─── 2. ABAS SUPERIORES POR FAIXA DE-PARA (FOTO 2) ─── */}
        <div className="shrink-0 border-b border-slate-200 dark:border-zinc-800 bg-slate-100/70 dark:bg-zinc-900/60 px-4 py-2 overflow-x-auto scrollbar-none flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedHorizon("all")}
            className={`flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              selectedHorizon === "all"
                ? "bg-white text-slate-900 border border-slate-300 shadow-sm dark:bg-zinc-800 dark:text-white dark:border-zinc-700"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/40"
            }`}
          >
            <span>Todas as Oportunidades Maduras</span>
            <span className="rounded-[2px] bg-slate-200 text-slate-700 dark:bg-black/60 dark:text-zinc-300 px-1.5 py-0.2 text-[10px] font-mono">
              {horizonCounts.all}
            </span>
          </button>

          {/* 3 DIAS */}
          <button
            type="button"
            onClick={() => setSelectedHorizon("tier_3d")}
            className={`flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              selectedHorizon === "tier_3d"
                ? "bg-red-50 text-red-700 border border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-500/50"
                : "text-slate-600 hover:text-red-600 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:text-red-400 dark:hover:bg-zinc-800/40"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            <span>3 DIAS (≤ R$ 8,5k)</span>
            <span className="font-normal text-[10px] text-slate-500 dark:text-zinc-500">
              {horizonCounts.tier_3d} negoc.
            </span>
          </button>

          {/* 15 DIAS */}
          <button
            type="button"
            onClick={() => setSelectedHorizon("tier_15d")}
            className={`flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              selectedHorizon === "tier_15d"
                ? "bg-amber-50 text-amber-700 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-500/50"
                : "text-slate-600 hover:text-amber-600 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:text-amber-400 dark:hover:bg-zinc-800/40"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>15 DIAS (≤ R$ 50k)</span>
            <span className="font-normal text-[10px] text-slate-500 dark:text-zinc-500">
              {horizonCounts.tier_15d} negoc.
            </span>
          </button>

          {/* 30 DIAS */}
          <button
            type="button"
            onClick={() => setSelectedHorizon("tier_30d")}
            className={`flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              selectedHorizon === "tier_30d"
                ? "bg-blue-50 text-blue-700 border border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-500/50"
                : "text-slate-600 hover:text-blue-600 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:text-blue-400 dark:hover:bg-zinc-800/40"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            <span>30 DIAS (≤ R$ 200k)</span>
            <span className="font-normal text-[10px] text-slate-500 dark:text-zinc-500">
              {horizonCounts.tier_30d} negoc.
            </span>
          </button>

          {/* 60 DIAS */}
          <button
            type="button"
            onClick={() => setSelectedHorizon("tier_60d")}
            className={`flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              selectedHorizon === "tier_60d"
                ? "bg-purple-50 text-purple-700 border border-purple-300 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-500/50"
                : "text-slate-600 hover:text-purple-600 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:text-purple-400 dark:hover:bg-zinc-800/40"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
            <span>60 DIAS (≤ R$ 600k)</span>
            <span className="font-normal text-[10px] text-slate-500 dark:text-zinc-500">
              {horizonCounts.tier_60d} negoc.
            </span>
          </button>

          {/* 90 DIAS */}
          <button
            type="button"
            onClick={() => setSelectedHorizon("tier_90d")}
            className={`flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              selectedHorizon === "tier_90d"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-500/50"
                : "text-slate-600 hover:text-emerald-600 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:text-emerald-400 dark:hover:bg-zinc-800/40"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>90 DIAS (&gt; R$ 600k)</span>
            <span className="font-normal text-[10px] text-slate-500 dark:text-zinc-500">
              {horizonCounts.tier_90d} negoc.
            </span>
          </button>

          {/* FORA DA RÉGUA */}
          <button
            type="button"
            onClick={() => setSelectedHorizon("fora_regua")}
            className={`flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              selectedHorizon === "fora_regua"
                ? "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-zinc-800 dark:text-yellow-300 dark:border-yellow-500/50"
                : "text-slate-600 hover:text-amber-700 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:text-yellow-400 dark:hover:bg-zinc-800/40"
            }`}
          >
            <span>⚠️ FORA DA RÉGUA</span>
          </button>
        </div>

        {/* ─── 3. BARRA DE PESQUISA & CONTADOR REATIVO ─── */}
        <div className="shrink-0 px-4 py-2.5 bg-slate-50/50 border-b border-slate-200 dark:bg-zinc-950/50 dark:border-zinc-800/80 flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por oportunidade, cliente, empresa, telefone ou equipamento..."
              className="w-full rounded-[3px] border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 font-sans focus:outline-none focus:border-red-500 dark:border-red-500/30 dark:bg-zinc-900/80 dark:text-white dark:placeholder-zinc-500 transition-colors"
            />
          </div>

          <div className="font-mono text-xs text-slate-500 dark:text-zinc-400">
            Exibindo{" "}
            <span className="font-bold text-slate-900 dark:text-white">{filteredDeals.length}</span>{" "}
            negociações hábeis
          </div>
        </div>

        {/* ─── 4. TABELA DE NEGOCIAÇÕES (FOTO 2) ─── */}
        <div className="flex-1 overflow-y-auto px-4 py-2 scrollbar-none min-h-[300px]">
          <table className="table-fixed w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600 dark:border-zinc-800 text-[10px] font-mono font-bold uppercase tracking-wider dark:text-zinc-400">
                <th className="py-2 px-2 w-[34%]">NEGOCIAÇÃO / EMPRESA</th>
                <th className="py-2 px-1 text-center w-[8%]">TELEFONE / CONTATO</th>
                <th className="py-2 px-2 text-right w-[14%]">VALOR NEGOCIAÇÃO</th>
                <th className="py-2 px-2 text-center w-[15%]">MATURIDADE (IDADE)</th>
                <th className="py-2 px-1 text-center w-[9%]">FAIXA DE-PARA</th>
                <th className="py-2 px-2 text-center w-[11%]">ETAPA CRM</th>
                <th className="py-2 px-2 text-center w-[9%]">CARD NO CRM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60 font-mono">
              {filteredDeals.map((deal) => {
                const tierBadge = getTierColorBadge(deal.horizonKey);

                return (
                  <tr
                    key={deal.id}
                    className="hover:bg-slate-50 dark:hover:bg-zinc-900/50 transition-colors group"
                  >
                    {/* Negociação / Empresa */}
                    <td className="py-2.5 px-2">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-sans font-bold text-slate-900 group-hover:text-red-600 dark:text-white text-xs dark:group-hover:text-red-400 transition-colors">
                            {deal.title}
                          </span>
                          {deal.hasDirectiveCompleted && (
                            <span className="inline-flex items-center gap-0.5 rounded-[2px] border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-950/50 px-1 py-0.2 font-mono text-[8.5px] font-bold dark:text-emerald-300">
                              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />
                              <span>DIRETRIZ CONCLUÍDA</span>
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-sans text-slate-500 dark:text-zinc-500 mt-0.5 truncate">
                          {deal.companyName}
                        </span>
                      </div>
                    </td>

                    {/* Telefone / Contato */}
                    <td className="py-2.5 px-1 text-center align-middle">
                      {deal.phone ? (
                        <button
                          type="button"
                          onClick={() => onCallContact?.(deal.phone!, deal.title)}
                          title={`Discar para ${deal.phone}`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-[2px] border border-slate-200 bg-slate-100 text-slate-500 hover:text-emerald-600 hover:border-emerald-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-emerald-400 dark:hover:border-emerald-500/50 transition-colors cursor-pointer"
                        >
                          <Phone className="h-3 w-3" />
                        </button>
                      ) : (
                        <span className="text-slate-300 dark:text-zinc-600">-</span>
                      )}
                    </td>

                    {/* Valor Negociação */}
                    <td className="py-2.5 px-2 text-right align-middle font-bold text-emerald-600 dark:text-emerald-400 text-xs">
                      {formatPacingCurrency(deal.value)}
                    </td>

                    {/* Maturidade (Idade) */}
                    <td className="py-2.5 px-2 text-center align-middle">
                      <span className="inline-flex items-center gap-1 rounded-[2px] border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/30 px-2 py-0.5 font-mono text-[10px] font-semibold dark:text-emerald-300">
                        <Clock className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        <span>{deal.ageDays} dias em aberto</span>
                      </span>
                    </td>

                    {/* Faixa De-Para */}
                    <td className="py-2.5 px-1 text-center align-middle">
                      <span
                        className={`inline-block rounded-[2px] border px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase ${tierBadge}`}
                      >
                        {deal.horizonLabel}
                      </span>
                    </td>

                    {/* Etapa CRM */}
                    <td className="py-2.5 px-2 text-center align-middle">
                      <span className="text-[11px] font-sans text-slate-700 dark:text-zinc-300">
                        {deal.crmStage}
                      </span>
                    </td>

                    {/* Card no CRM */}
                    <td className="py-2.5 px-2 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => onOpenDeal?.(deal.id)}
                        className="inline-flex items-center gap-1 rounded-[2px] border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/30 dark:hover:bg-blue-950/60 px-2 py-1 font-mono text-[10px] font-bold dark:text-blue-300 transition-colors cursor-pointer"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>Abrir no CRM</span>
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredDeals.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center text-slate-400 dark:text-zinc-500 font-sans text-xs"
                  >
                    Nenhuma oportunidade encontrada para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ─── 5. RODAPÉ (FOTO 2) ─── */}
        <div className="shrink-0 border-t border-slate-200 dark:border-zinc-800 bg-slate-50/90 dark:bg-zinc-950/90 px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-zinc-400 text-xs font-sans">
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>
              Todas as negociações listadas atendem à regra de maturidade mínima para fechamento.
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-[3px] bg-[#df3d3d] hover:bg-red-600 px-4 py-1.5 font-mono text-xs font-bold text-white shadow-sm transition-all cursor-pointer active:scale-[0.98]"
          >
            Concluir Visualização
          </button>
        </div>
      </div>
    </div>
  );
}
