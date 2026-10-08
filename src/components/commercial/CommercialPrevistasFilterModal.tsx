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
import { formatDealCurrencyDetail, formatDeparaMeta } from "@/lib/commercial/depara-data";
import {
  PREVISTAS_TIERS,
  PrevistasDealItem,
  PrevistasTierKey,
} from "@/lib/commercial/previstas-data";

interface CommercialPrevistasFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerName?: string;
  sellerId?: string;
  division?: "personnalite" | "maquinas";
  metaValue?: number;
  initialHorizonKey?: PrevistasTierKey | "all";
  deals: PrevistasDealItem[];
  sellerAvatar?: string;
  onOpenDeal?: (dealId: string) => void;
  onOpenProfile?: (sellerId?: string) => void;
  onCallContact?: (phone: string, dealTitle: string) => void;
  onSaveDirectives?: (selectedDealIds: string[]) => void;
}

export function CommercialPrevistasFilterModal({
  isOpen,
  onClose,
  sellerName = "Diana Gimenes",
  sellerId,
  division = "personnalite",
  metaValue = 1_000_000,
  initialHorizonKey = "all",
  deals: initialDeals,
  sellerAvatar,
  onOpenDeal,
  onOpenProfile,
  onCallContact,
  onSaveDirectives,
}: CommercialPrevistasFilterModalProps) {
  const [selectedHorizon, setSelectedHorizon] = useState<PrevistasTierKey | "all">(
    initialHorizonKey
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(new Set());
  const [dealsList, setDealsList] = useState<PrevistasDealItem[]>(initialDeals);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sincroniza deals iniciais e aba
  useMemo(() => {
    setSelectedHorizon(initialHorizonKey);
    setDealsList(initialDeals);
    setSelectedDealIds(new Set());
  }, [initialHorizonKey, initialDeals]);

  // Contagem por aba de horizonte
  const horizonCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: dealsList.length,
      tier_hoje: 0,
      tier_15d: 0,
      tier_30d: 0,
      tier_60d: 0,
      tier_90d: 0,
    };
    for (const deal of dealsList) {
      if (counts[deal.horizonKey] !== undefined) {
        counts[deal.horizonKey] += 1;
      }
    }
    return counts;
  }, [dealsList]);

  // Filtro de pesquisa e horizonte
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

  // Lógica de seleção por checkbox
  const handleToggleSelectDeal = (id: string) => {
    setSelectedDealIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedDealIds.size === filteredDeals.length && filteredDeals.length > 0) {
      setSelectedDealIds(new Set());
    } else {
      setSelectedDealIds(new Set(filteredDeals.map((d) => d.id)));
    }
  };

  // Cálculo da soma das oportunidades selecionadas
  const selectedTotalValue = useMemo(() => {
    let sum = 0;
    for (const deal of dealsList) {
      if (selectedDealIds.has(deal.id)) {
        sum += deal.value;
      }
    }
    return sum;
  }, [dealsList, selectedDealIds]);

  // Ação de Salvar Diretrizes
  const handleExecuteSaveDirectives = () => {
    if (selectedDealIds.size === 0) return;

    // Atualiza status local para 'hasDirectiveCompleted'
    setDealsList((prev) =>
      prev.map((deal) =>
        selectedDealIds.has(deal.id) ? { ...deal, hasDirectiveCompleted: true, isDelayed: false } : deal
      )
    );

    const count = selectedDealIds.size;
    onSaveDirectives?.(Array.from(selectedDealIds));

    setToastMessage(`✓ ${count} diretriz(es) de faturamento concluída(s) e salva(s) com sucesso!`);
    setTimeout(() => setToastMessage(null), 3500);
    setSelectedDealIds(new Set());
  };

  if (!isOpen) return null;

  const isAllSelected =
    filteredDeals.length > 0 && selectedDealIds.size === filteredDeals.length;

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
                Cronograma e previsão de fechamento de pipeline por horizonte temporal
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

        {/* ─── ABAS DE HORIZONTES TEMPORAIS (FOTOS 2 E 3) ─── */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/50 p-2 text-xs overflow-x-auto scrollbar-none shrink-0 font-mono">
          {/* Todas as Oportunidades a Faturar */}
          <button
            type="button"
            onClick={() => setSelectedHorizon("all")}
            className={`flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 font-bold transition-all cursor-pointer ${
              selectedHorizon === "all"
                ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
            }`}
          >
            <span>Todas as Oportunidades a Faturar</span>
            <span
              className={`rounded-[2px] px-1.5 py-0.2 text-[10px] font-mono ${
                selectedHorizon === "all" ? "bg-red-500/20 text-red-400" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {horizonCounts.all}
            </span>
          </button>

          {/* Abas dos 5 Horizontes */}
          {PREVISTAS_TIERS.map((tier) => {
            const isSelected = selectedHorizon === tier.key;
            const count = horizonCounts[tier.key] || 0;
            const isHoje = tier.key === "tier_hoje";
            const tabLabel = isHoje
              ? "HOJE (Prontos / Atrasados)"
              : `${tier.daysLabel} (A Faturar)`;

            return (
              <button
                key={tier.key}
                type="button"
                onClick={() => setSelectedHorizon(tier.key)}
                className={`flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 font-bold transition-all cursor-pointer ${
                  isSelected
                    ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${tier.dotColor}`} />
                <span>{tabLabel}</span>
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
        </div>

        {/* ─── BARRA DE PESQUISA & CONTADOR DE NEGOCIAÇÕES ─── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 bg-zinc-950/60 px-4 py-2.5 shrink-0">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por oportunidade, cliente, empresa, telefone ou equipamento..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-[2px] border border-zinc-800 bg-zinc-900/90 pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none font-mono"
            />
          </div>

          <div className="text-xs font-mono font-semibold text-zinc-400">
            Exibindo{" "}
            <span className="font-bold text-white">{filteredDeals.length}</span>{" "}
            negociações a faturar
          </div>
        </div>

        {/* ─── FEEDBACK TOAST DE DIRETRIZES SALVAS ─── */}
        {toastMessage && (
          <div className="bg-emerald-950/80 border-b border-emerald-500/40 text-emerald-300 font-mono text-xs px-4 py-2 flex items-center gap-2 animate-in fade-in duration-150">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* ─── TABELA DE NEGOCIAÇÕES COM SELEÇÃO MÚLTIPLA ─── */}
        <div className="flex-1 overflow-y-auto overflow-x-auto p-4 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-900">
          {filteredDeals.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <p className="text-sm font-mono text-zinc-400">
                Nenhuma oportunidade prevista encontrada para este horizonte.
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80 text-[10px] uppercase tracking-wider text-zinc-400 font-bold">
                  {/* Checkbox Geral de Seleção */}
                  <th className="py-2.5 px-3 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleToggleSelectAll}
                      aria-label="Selecionar todas as oportunidades"
                      className="rounded-[2px] border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0 cursor-pointer h-3.5 w-3.5"
                    />
                  </th>
                  <th className="py-2.5 px-3">NEGOCIAÇÃO / EMPRESA</th>
                  <th className="py-2.5 px-3 text-center">TELEFONE / CONTATO</th>
                  <th className="py-2.5 px-3 text-right">VALOR NEGOCIAÇÃO</th>
                  <th className="py-2.5 px-3 text-center">HORIZONTE / IDADE</th>
                  <th className="py-2.5 px-3 text-center">FAIXA PREVISÃO</th>
                  <th className="py-2.5 px-3">ETAPA CRM</th>
                  <th className="py-2.5 px-3 text-center">CARD NO CRM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredDeals.map((deal) => {
                  const isChecked = selectedDealIds.has(deal.id);

                  return (
                    <tr
                      key={deal.id}
                      className={`hover:bg-zinc-900/50 transition-colors group ${
                        isChecked ? "bg-emerald-950/15" : ""
                      }`}
                    >
                      {/* Checkbox da Linha */}
                      <td className="py-2.5 px-3 text-center align-middle">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectDeal(deal.id)}
                          aria-label={`Selecionar oportunidade ${deal.title}`}
                          className="rounded-[2px] border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0 cursor-pointer h-3.5 w-3.5"
                        />
                      </td>

                      {/* Negociação / Empresa */}
                      <td className="py-2.5 px-3 max-w-[280px]">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-white group-hover:text-red-400 transition-colors">
                              {deal.title}
                            </span>
                            {/* Badges de Status (Atrasada ou Diretriz Concluída) */}
                            {deal.isDelayed && (
                              <span className="rounded-[2px] border border-amber-500/40 bg-amber-950/30 text-amber-400 px-1.5 py-0.2 text-[9px] font-bold inline-flex items-center gap-1">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                <span>ATRASADA NO CONSULTOR</span>
                              </span>
                            )}
                            {deal.hasDirectiveCompleted && (
                              <span className="rounded-[2px] border border-emerald-500/40 bg-emerald-950/30 text-emerald-400 px-1.5 py-0.2 text-[9px] font-bold inline-flex items-center gap-1">
                                <Check className="h-2.5 w-2.5" />
                                <span>DIRETRIZ CONCLUÍDA</span>
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-zinc-400 leading-tight">
                            {deal.title} •
                          </span>
                        </div>
                      </td>

                      {/* Telefone / Contato */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {deal.phone ? (
                          <button
                            type="button"
                            onClick={() => onCallContact?.(deal.phone!, deal.title)}
                            className="rounded-[2px] border border-zinc-700/60 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 p-1.5 transition-colors cursor-pointer inline-flex items-center justify-center"
                            title={`Ligar para ${deal.phone}`}
                          >
                            <Phone className="h-3 w-3" />
                          </button>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>

                      {/* Valor Negociação */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <span className="font-bold text-emerald-400 text-sm">
                          {formatDealCurrencyDetail(deal.value)}
                        </span>
                      </td>

                      {/* Horizonte / Idade (Box Verde Esmeralda da Foto 2) */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 rounded-[2px] border border-emerald-500/30 bg-emerald-950/30 px-2 py-0.5 text-emerald-300 text-[11px] font-mono">
                          <Clock className="h-3 w-3 text-emerald-400" />
                          <span>{deal.ageDays} dias em aberto</span>
                        </div>
                      </td>

                      {/* Faixa Previsão */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span className="inline-block rounded-[2px] border border-amber-500/40 bg-amber-950/20 text-amber-400 px-2 py-0.5 text-[10px] font-bold">
                          {deal.faixaPrevisaoLabel}
                        </span>
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

        {/* ─── RODAPÉ COM CONTADOR SELECIONADO & AÇÃO DE DIRETRIZES (FOTO 3) ─── */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950/90 p-4 shrink-0 font-mono">
          <div className="flex items-center gap-2 text-xs">
            {selectedDealIds.size > 0 ? (
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>
                  {selectedDealIds.size} oportunidades selecionadas • Total:{" "}
                  {formatDeparaMeta(selectedTotalValue)}
                </span>
              </div>
            ) : (
              <span className="text-zinc-500">0 oportunidades selecionadas</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[2px] border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 transition-colors cursor-pointer"
            >
              Fechar
            </button>

            <button
              type="button"
              onClick={handleExecuteSaveDirectives}
              disabled={selectedDealIds.size === 0}
              className={`rounded-[2px] px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                selectedDealIds.size > 0
                  ? "bg-[#059669] hover:bg-[#047857] text-white shadow-md cursor-pointer active:scale-95"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/40"
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>Concluir e Salvar Diretrizes ({selectedDealIds.size})</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
