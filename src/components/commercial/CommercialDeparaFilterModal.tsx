import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Phone,
  Search,
  X,
} from "lucide-react";
import {
  DEPARA_TIERS,
  DeparaDealItem,
  DeparaTierKey,
  formatDealCurrencyDetail,
  formatDeparaMeta,
} from "@/lib/commercial/depara-data";

interface CommercialDeparaFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerName?: string;
  sellerId?: string;
  division?: "personnalite" | "maquinas";
  metaValue?: number;
  initialTierKey?: DeparaTierKey | "all" | "out_of_rule";
  deals: DeparaDealItem[];
  sellerAvatar?: string;
  onOpenDeal?: (dealId: string) => void;
  onOpenProfile?: (sellerId?: string) => void;
  onCallContact?: (phone: string, dealTitle: string) => void;
}

export function CommercialDeparaFilterModal({
  isOpen,
  onClose,
  sellerName = "Diana Gimenes",
  sellerId,
  division = "personnalite",
  metaValue = 1_000_000,
  initialTierKey = "all",
  deals,
  sellerAvatar,
  onOpenDeal,
  onOpenProfile,
  onCallContact,
}: CommercialDeparaFilterModalProps) {
  const [selectedTier, setSelectedTier] = useState<DeparaTierKey | "all" | "out_of_rule">(
    initialTierKey
  );
  const [searchQuery, setSearchQuery] = useState("");

  // Atualiza a aba inicial sempre que o modal abre ou initialTierKey muda
  useMemo(() => {
    setSelectedTier(initialTierKey);
  }, [initialTierKey]);

  // Contagem de negócios por faixa
  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: deals.length,
      tier_3d: 0,
      tier_15d: 0,
      tier_30d: 0,
      tier_60d: 0,
      tier_90d: 0,
      out_of_rule: 0,
    };
    for (const deal of deals) {
      if (counts[deal.tierKey] !== undefined) {
        counts[deal.tierKey] += 1;
      }
    }
    return counts;
  }, [deals]);

  // Filtro de pesquisa e faixa
  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      if (selectedTier !== "all" && deal.tierKey !== selectedTier) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        deal.title.toLowerCase().includes(q) ||
        deal.companyName.toLowerCase().includes(q) ||
        deal.sellerName.toLowerCase().includes(q) ||
        deal.crmStage.toLowerCase().includes(q) ||
        (deal.phone && deal.phone.includes(q))
      );
    });
  }, [deals, selectedTier, searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col rounded-[4px] border border-zinc-800 bg-[#0c0d12] text-white shadow-2xl overflow-hidden animate-in zoom-in-95 duration-100">
        {/* ─── CABEÇALHO DO MODAL (FOTOS 2 E 3) ─── */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/90 p-4 shrink-0">
          <div className="flex items-center gap-3">
            {/* Avatar Angular */}
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[2px] border border-zinc-800 bg-zinc-900">
              {sellerAvatar ? (
                <img
                  src={sellerAvatar}
                  alt={sellerName}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center font-mono font-bold text-xs text-red-400 bg-red-950/30">
                  {sellerName.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            {/* Informações do Consultor */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-tight text-white font-mono">
                  {sellerName}
                </h2>

                {/* Badge Divisão */}
                <span className="rounded-[2px] border border-red-500/40 bg-red-950/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-400 font-mono">
                  {division === "personnalite" ? "PERSONNALITÉ" : "MÁQUINAS"}
                </span>

                {/* Badge Meta */}
                <span className="rounded-[2px] border border-emerald-500/40 bg-emerald-950/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 font-mono">
                  Meta: {formatDeparaMeta(metaValue)}
                </span>

                {/* Botão Abrir Perfil */}
                <button
                  type="button"
                  onClick={() => onOpenProfile?.(sellerId)}
                  className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white transition-colors cursor-pointer font-mono ml-1"
                >
                  <span>Abrir perfil</span>
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>

              {/* Subtítulo Descritivo */}
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                Oportunidades em andamento classificadas pelo De-Para de Maturidade (Tempo vs Valor)
              </p>
            </div>
          </div>

          {/* Botão Fechar Modal */}
          <button
            type="button"
            onClick={onClose}
            className="rounded-[2px] border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
            title="Fechar Modal"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* ─── ABAS DE FILTRO POR FAIXA DE-PARA (FOTOS 2 E 3) ─── */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/50 p-2 text-xs overflow-x-auto scrollbar-none shrink-0 font-mono">
          {/* Todas as Oportunidades Maduras */}
          <button
            type="button"
            onClick={() => setSelectedTier("all")}
            className={`flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 font-bold transition-all cursor-pointer ${
              selectedTier === "all"
                ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
            }`}
          >
            <span>Todas as Oportunidades Maduras</span>
            <span
              className={`rounded-[2px] px-1.5 py-0.2 text-[10px] font-mono ${
                selectedTier === "all" ? "bg-red-500/20 text-red-400" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {tierCounts.all}
            </span>
          </button>

          {/* Abas Individuais dos Tiers */}
          {DEPARA_TIERS.map((tier) => {
            const isSelected = selectedTier === tier.key;
            const count = tierCounts[tier.key] || 0;

            return (
              <button
                key={tier.key}
                type="button"
                onClick={() => setSelectedTier(tier.key)}
                className={`flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 font-bold transition-all cursor-pointer ${
                  isSelected
                    ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${tier.dotColor}`} />
                <span>{tier.daysLabel}</span>
                <span
                  className={`rounded-[2px] px-1.5 py-0.2 text-[10px] font-mono ${
                    isSelected ? "bg-zinc-700 text-white" : "bg-zinc-800/80 text-zinc-400"
                  }`}
                >
                  {count} negoc.
                </span>
              </button>
            );
          })}

          {/* Aba Fora da Régua (Se houver ou aba informativa) */}
          <button
            type="button"
            onClick={() => setSelectedTier("out_of_rule")}
            className={`flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 font-bold transition-all cursor-pointer ${
              selectedTier === "out_of_rule"
                ? "bg-zinc-800 text-amber-300 border border-amber-600/40 shadow-sm"
                : "text-zinc-400 hover:bg-zinc-800/60 hover:text-amber-400"
            }`}
          >
            <AlertTriangle className="h-3 w-3 text-amber-400" />
            <span>FORA DA RÉGUA</span>
            <span
              className={`rounded-[2px] px-1.5 py-0.2 text-[10px] font-mono ${
                selectedTier === "out_of_rule" ? "bg-amber-950/40 text-amber-400" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {tierCounts.out_of_rule || 0} negoc.
            </span>
          </button>
        </div>

        {/* ─── BARRA DE PESQUISA & CONTADOR DE NEGOCIAÇÕES HÁBEIS ─── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 bg-zinc-950/60 px-4 py-2.5 shrink-0">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Filtrar oportunidade por nome da empresa, contato ou código..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-[2px] border border-zinc-800 bg-zinc-900/90 pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none font-mono"
            />
          </div>

          <div className="text-xs font-mono font-semibold text-zinc-400">
            Exibindo{" "}
            <span className="font-bold text-white">{filteredDeals.length}</span>{" "}
            negociações hábeis
          </div>
        </div>

        {/* ─── TABELA DE NEGOCIAÇÕES MADURAS (FOTOS 2 E 3) ─── */}
        <div className="flex-1 overflow-y-auto overflow-x-auto p-4 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-900">
          {filteredDeals.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <p className="text-sm font-mono text-zinc-400">
                Nenhuma negociação encontrada para este filtro.
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80 text-[10px] uppercase tracking-wider text-zinc-400 font-bold">
                  <th className="py-2.5 px-3">NEGOCIAÇÃO / EMPRESA</th>
                  <th className="py-2.5 px-3">TELEFONE / CONTATO</th>
                  <th className="py-2.5 px-3 text-right">VALOR NEGOCIAÇÃO</th>
                  <th className="py-2.5 px-3 text-center">MATURIDADE (IDADE)</th>
                  <th className="py-2.5 px-3 text-center">FAIXA DE-PARA</th>
                  <th className="py-2.5 px-3">ETAPA CRM</th>
                  <th className="py-2.5 px-3 text-center">CARD NO CRM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredDeals.map((deal) => {
                  const tierDef = DEPARA_TIERS.find((t) => t.key === deal.tierKey);

                  return (
                    <tr
                      key={deal.id}
                      className="hover:bg-zinc-900/50 transition-colors group"
                    >
                      {/* Negociação / Empresa */}
                      <td className="py-2.5 px-3 max-w-[280px]">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-white group-hover:text-red-400 transition-colors">
                              {deal.title}
                            </span>
                            {deal.isDelayed && (
                              <span className="rounded-[2px] border border-amber-500/40 bg-amber-950/30 text-amber-400 px-1.5 py-0.2 text-[9px] font-bold inline-flex items-center gap-1">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                <span>ATRASADA NO CONSULTOR</span>
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-zinc-400 leading-tight">
                            Tempo de maturação atingido. Negociação pronta para fechamento.
                          </span>
                        </div>
                      </td>

                      {/* Telefone / Contato */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-300">
                            {deal.phone || "—"}
                          </span>
                          {deal.phone && (
                            <button
                              type="button"
                              onClick={() => onCallContact?.(deal.phone!, deal.title)}
                              className="rounded-[2px] border border-zinc-700/60 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 p-1 transition-colors cursor-pointer"
                              title={`Ligar para ${deal.phone}`}
                            >
                              <Phone className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Valor Negociação */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <span className="font-bold text-emerald-400 text-sm">
                          {formatDealCurrencyDetail(deal.value)}
                        </span>
                      </td>

                      {/* Maturidade (Idade) */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 rounded-[2px] border border-zinc-800 bg-zinc-900/90 px-2 py-0.5 text-zinc-300 text-[11px]">
                          <Clock className="h-3 w-3 text-zinc-400" />
                          <span>{deal.ageDays} dias em aberto</span>
                        </div>
                      </td>

                      {/* Faixa De-Para */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {tierDef ? (
                          <span
                            className={`inline-block rounded-[2px] border px-2 py-0.5 text-[10px] font-bold ${tierDef.badgeBg}`}
                          >
                            {tierDef.daysLabel}
                          </span>
                        ) : (
                          <span className="inline-block rounded-[2px] border border-amber-500/40 bg-amber-950/20 text-amber-400 px-2 py-0.5 text-[10px] font-bold">
                            FORA DA RÉGUA
                          </span>
                        )}
                      </td>

                      {/* Etapa CRM */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="inline-block rounded-[2px] border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300 font-semibold">
                          {deal.crmStage}
                        </span>
                      </td>

                      {/* Card no CRM */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenDeal?.(deal.id)}
                          className="inline-flex items-center gap-1.5 rounded-[2px] border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                        >
                          <ExternalLink className="h-3 w-3 text-zinc-400" />
                          <span>Abrir no CRM</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ─── RODAPÉ DO MODAL (FOTOS 2 E 3) ─── */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950/90 p-4 shrink-0 font-mono">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>
              Todas as negociações listadas atendem à regra de maturidade mínima para fechamento.
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-[2px] bg-[#df3d3d] hover:bg-[#c93434] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors cursor-pointer shadow-sm"
          >
            Concluir Visualização
          </button>
        </footer>
      </div>
    </div>
  );
}
