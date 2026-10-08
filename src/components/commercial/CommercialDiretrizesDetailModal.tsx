import { useState, useMemo } from "react";
import { X, Search, CheckCircle2, ExternalLink } from "lucide-react";
import {
  DiretrizesConsultantRow,
  DiretrizDealDetail,
} from "@/lib/commercial/diretrizes-crm-data";

interface CommercialDiretrizesDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  consultant: DiretrizesConsultantRow | null;
  onOpenDeal?: (dealId: string) => void;
  onOpenProfile?: () => void;
}

type FilterTabKey = "todas" | "atrasadas" | "hoje" | "concluidas";

export function CommercialDiretrizesDetailModal({
  isOpen,
  onClose,
  consultant,
  onOpenDeal,
  onOpenProfile,
}: CommercialDiretrizesDetailModalProps) {
  const [activeTab, setActiveTab] = useState<FilterTabKey>("todas");
  const [searchQuery, setSearchQuery] = useState("");

  const deals = consultant?.deals || [];

  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      // Filtro de aba
      if (activeTab === "atrasadas" && deal.status !== "atrasada") return false;
      if (activeTab === "hoje" && deal.status !== "hoje") return false;
      if (activeTab === "concluidas" && deal.status !== "concluida") return false;

      // Filtro de busca
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = deal.title.toLowerCase().includes(q);
        const matchesCompany = deal.companyName.toLowerCase().includes(q);
        const matchesStage = deal.crmStage.toLowerCase().includes(q);
        const matchesDirective = deal.gestorDirective.toLowerCase().includes(q);
        const matchesResponse = deal.consultantResponse.toLowerCase().includes(q);
        return (
          matchesTitle || matchesCompany || matchesStage || matchesDirective || matchesResponse
        );
      }
      return true;
    });
  }, [deals, activeTab, searchQuery]);

  if (!isOpen || !consultant) return null;

  const divisionLabel =
    consultant.division === "personnalite" ? "Personnalité" : "Máquinas / Semi";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-4xl flex-col max-h-[92vh] overflow-hidden rounded-[4px] border border-zinc-800 bg-[#0c0d12] text-zinc-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── CABEÇALHO DO MODAL (FOTO 2) ─── */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            {consultant.avatarUrl ? (
              <img
                src={consultant.avatarUrl}
                alt={consultant.name}
                className="h-9 w-9 rounded-[2px] border border-zinc-800 object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-[2px] border border-zinc-800 bg-zinc-900 font-mono text-xs font-bold text-zinc-300">
                {consultant.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-mono text-base font-bold text-white tracking-tight">
                  {consultant.name}
                </h2>
                <span className="rounded-[2px] bg-zinc-800/80 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                  {divisionLabel}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs text-zinc-400">
                  Gestão de Diretrizes e Responsabilidades Comerciais
                </p>
                {onOpenProfile && (
                  <button
                    type="button"
                    onClick={onOpenProfile}
                    className="inline-flex items-center gap-1 rounded-[2px] border border-[#8b1d1d]/60 bg-[#8b1d1d]/20 px-2 py-0.5 text-[10px] font-mono font-semibold text-red-300 hover:bg-[#8b1d1d]/40 transition-colors cursor-pointer"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    Abrir perfil
                  </button>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-[2px] p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
            title="Fechar (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ─── 4 MINI KPIS SUPERIORES (FOTO 2) ─── */}
        <div className="grid grid-cols-2 gap-2 border-b border-zinc-800/80 bg-zinc-950/40 p-3 sm:grid-cols-4 sm:px-6">
          {/* 1. Total Sob Gestão */}
          <div className="rounded-[3px] border border-zinc-800/80 bg-zinc-900/60 p-2.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
              TOTAL SOB GESTÃO
            </span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-base font-black text-white">
                {consultant.totalDirectives}
              </span>
              <span className="text-xs text-zinc-400">deals</span>
            </div>
            <span className="block font-mono text-xs font-semibold text-emerald-400 mt-0.5">
              R$ {consultant.totalValue.toLocaleString("pt-BR")}.000
            </span>
          </div>

          {/* 2. Concluídas */}
          <div className="rounded-[3px] border border-zinc-800/80 bg-zinc-900/60 p-2.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
              CONCLUÍDAS
            </span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-base font-black text-emerald-400">
                {consultant.concluidas}
              </span>
              <span className="text-xs font-mono text-emerald-400/80">
                ({consultant.taxaExecucaoPercent ?? 0}%)
              </span>
            </div>
            <span className="block font-mono text-xs text-zinc-400 mt-0.5">
              R$ {consultant.totalValue.toLocaleString("pt-BR")}.000
            </span>
          </div>

          {/* 3. Pendentes Hoje */}
          <div className="rounded-[3px] border border-zinc-800/80 bg-zinc-900/60 p-2.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
              PENDENTES HOJE
            </span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-base font-black text-amber-400">
                {consultant.pendenteHoje}
              </span>
            </div>
            <span className="block font-mono text-xs text-zinc-400 mt-0.5">R$ 0</span>
          </div>

          {/* 4. Em Atraso */}
          <div className="rounded-[3px] border border-zinc-800/80 bg-zinc-900/60 p-2.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
              EM ATRASO
            </span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-base font-black text-emerald-400">
                {consultant.atrasadas}
              </span>
            </div>
            <span className="block font-mono text-xs text-zinc-400 mt-0.5">R$ 0</span>
          </div>
        </div>

        {/* ─── FILTROS DE ABA E BUSCA (FOTO 2) ─── */}
        <div className="flex flex-col gap-2 border-b border-zinc-800/80 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {/* Abas */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("todas")}
              className={`rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-colors cursor-pointer ${
                activeTab === "todas"
                  ? "border border-zinc-700 bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Todas ({consultant.totalDirectives})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("atrasadas")}
              className={`rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-colors cursor-pointer ${
                activeTab === "atrasadas"
                  ? "border border-red-500/40 bg-red-950/30 text-red-300"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Atrasadas ({consultant.atrasadas})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("hoje")}
              className={`rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-colors cursor-pointer ${
                activeTab === "hoje"
                  ? "border border-amber-500/40 bg-amber-950/30 text-amber-300"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Hoje ({consultant.pendenteHoje})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("concluidas")}
              className={`rounded-[2px] px-2.5 py-1 font-mono text-xs font-bold transition-colors cursor-pointer ${
                activeTab === "concluidas"
                  ? "border border-emerald-500/40 bg-emerald-950/30 text-emerald-300"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Concluídas ({consultant.concluidas})
            </button>
          </div>

          {/* Campo de Busca */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar oportunidade..."
              className="w-full rounded-[3px] border border-zinc-800 bg-zinc-900/80 py-1 pl-8 pr-3 font-mono text-xs text-zinc-200 placeholder-zinc-500 focus:border-red-500 focus:outline-none"
            />
          </div>
        </div>

        {/* ─── LISTA DE CARDS DE DEALS COM DIRETRIZ E TRATATIVA (FOTO 2) ─── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 sm:px-6">
          {filteredDeals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="font-mono text-xs text-zinc-500">
                Nenhuma oportunidade encontrada para este filtro.
              </p>
            </div>
          ) : (
            filteredDeals.map((deal) => (
              <div
                key={deal.id}
                className="rounded-[3px] border border-zinc-800/90 bg-zinc-950/70 p-3.5 transition-colors hover:border-zinc-700 relative overflow-hidden"
              >
                {/* Linha 1: Título + Badge + Valor + Botão CRM */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="font-mono text-sm font-bold text-white truncate">
                      {deal.title}
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-[2px] border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                      ✓ Concluída
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-emerald-400">
                      {deal.formattedValue}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenDeal?.(deal.dealId)}
                      className="inline-flex items-center gap-1 rounded-[2px] border border-red-900/60 bg-red-950/30 px-2 py-1 font-mono text-[10px] font-bold text-red-300 hover:bg-red-900/40 transition-colors cursor-pointer"
                    >
                      CRM
                      <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>

                {/* Linha 2: Subtítulo de Etapa e Data */}
                <p className="mt-1 text-[11px] font-mono text-zinc-400">
                  {deal.companyName} • Etapa: {deal.crmStage} • Atribuída em: {deal.assignedAt}
                </p>

                {/* Linha 3: Caixa DIRETRIZ DO GESTOR (Fundo bordô) */}
                <div className="mt-2.5 rounded-[2px] border border-red-900/40 bg-[#1f1013] p-2 text-xs font-mono">
                  <span className="font-bold text-red-400 mr-1.5">DIRETRIZ DO GESTOR:</span>
                  <span className="text-zinc-200">{deal.gestorDirective}</span>
                </div>

                {/* Linha 4: Caixa TRATATIVA DO CONSULTOR (Fundo verde esmeralda) */}
                <div className="mt-1.5 rounded-[2px] border border-emerald-900/40 bg-[#0c1c16] p-2 text-xs font-mono">
                  <span className="font-bold text-emerald-400 mr-1.5">TRATATIVA DO CONSULTOR:</span>
                  <span className="text-zinc-200">{deal.consultantResponse}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ─── RODAPÉ DO MODAL (FOTO 2) ─── */}
        <div className="flex items-center justify-between border-t border-zinc-800/80 bg-zinc-950/90 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>Diretrizes monitoradas em tempo real com retorno do consultor.</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] bg-[#df3d3d] px-5 py-1.5 font-mono text-xs font-bold text-white hover:bg-[#c93535] transition-colors cursor-pointer shadow-sm"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
