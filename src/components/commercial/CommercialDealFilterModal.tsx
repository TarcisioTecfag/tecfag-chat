import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, ExternalLink, Search, X } from "lucide-react";
import {
  CommercialPipelineDeal,
  formatDealValue,
  PipelineStageKey,
  PIPELINE_STAGES,
  PipelineStageDef,
} from "@/lib/commercial/pipeline-data";

interface CommercialDealFilterModalProps {
  stages?: PipelineStageDef[];
  isOpen: boolean;
  onClose: () => void;
  sellerName?: string;
  sellerId?: string;
  division?: "personnalite" | "maquinas";
  initialStageKey?: PipelineStageKey | "all";
  deals: CommercialPipelineDeal[];
  loading?: boolean;
  sellerAvatar?: string;
  onOpenDeal?: (dealId: string) => void;
  onOpenProfile?: (sellerId?: string) => void;
}

export function CommercialDealFilterModal({
  stages = PIPELINE_STAGES,
  isOpen,
  onClose,
  sellerName = "Equipe comercial",
  sellerId,
  division = "personnalite",
  initialStageKey = "all",
  deals,
  loading = false,
  sellerAvatar,
  onOpenDeal,
  onOpenProfile,
}: CommercialDealFilterModalProps) {
  const [selectedStage, setSelectedStage] = useState<PipelineStageKey | "all">(initialStageKey);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setSelectedStage(initialStageKey);
  }, [initialStageKey]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = { all: deals.length };
    for (const stage of stages) counts[stage.key] = 0;
    for (const deal of deals) {
      if (counts[deal.stageKey] !== undefined) {
        counts[deal.stageKey] += 1;
      }
    }
    return counts;
  }, [deals, stages]);

  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      if (selectedStage !== "all" && deal.stageKey !== selectedStage) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        deal.title.toLowerCase().includes(q) ||
        deal.funnelName.toLowerCase().includes(q) ||
        deal.responsibleName.toLowerCase().includes(q) ||
        deal.id.toLowerCase().includes(q) ||
        (deal.rdDealId && deal.rdDealId.toLowerCase().includes(q))
      );
    });
  }, [deals, selectedStage, searchQuery]);

  if (!isOpen) return null;

  const activeStageLabel =
    selectedStage === "all"
      ? "Todas as Fases"
      : stages.find((s) => s.key === selectedStage)?.label || "Todas as Fases";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col rounded-[4px] border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0c0d12] text-slate-900 dark:text-white shadow-2xl overflow-hidden animate-in zoom-in-95 duration-100">
        {/* Cabeçalho do Modal */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/90 p-4 shrink-0">
          <div className="flex items-center gap-3">
            {/* Avatar Angular */}
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[2px] border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900">
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
                <div className="flex h-full w-full items-center justify-center font-mono font-bold text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30">
                  {sellerName
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
              )}
            </div>

            {/* Informações do Consultor */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white font-mono">
                  {sellerName}
                </h2>

                {/* Badge Divisão */}
                <span className="rounded-[2px] border border-red-200 dark:border-red-500/40 bg-red-50 dark:bg-red-950/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-600 dark:text-red-400 font-mono">
                  {division === "personnalite" ? "PERSONNALITÉ" : "MÁQUINAS"}
                </span>

                {/* Pill Fase Atual */}
                <span className="rounded-[2px] border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 font-mono">
                  Fase: {activeStageLabel}
                </span>

                {/* Botão Abrir Perfil */}
                <button
                  type="button"
                  onClick={() => onOpenProfile?.(sellerId)}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer font-mono ml-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>Abrir perfil</span>
                </button>
              </div>

              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400 font-mono">
                Rastreamento detalhado de negociações ativas no CRM com link direto para o card
              </p>
            </div>
          </div>

          {/* Botão Fechar X */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-[2px] p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Abas de Filtro de Fases */}
        <div className="border-b border-slate-200 dark:border-zinc-800 bg-slate-100/60 dark:bg-zinc-950/60 px-4 py-2 shrink-0">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none" role="tablist">
            {/* Todas as Fases */}
            <button
              type="button"
              role="tab"
              aria-selected={selectedStage === "all"}
              onClick={() => setSelectedStage("all")}
              className={`shrink-0 rounded-[2px] border px-3 py-1.5 text-xs transition-colors cursor-pointer flex items-center gap-1.5 font-mono ${
                selectedStage === "all"
                  ? "border-slate-300 bg-white font-black text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white shadow-sm"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-white hover:text-slate-900 dark:border-zinc-800/80 dark:bg-zinc-950/60 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white font-medium"
              }`}
            >
              <span>Todas as Fases</span>
              <span className="font-mono font-bold text-slate-800 dark:text-zinc-200">
                {stageCounts.all}
              </span>
            </button>

            {/* Fases Individuais */}
            {stages.map((stage) => {
              const count = stageCounts[stage.key] || 0;
              const isSelected = selectedStage === stage.key;
              return (
                <button
                  key={stage.key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSelectedStage(stage.key)}
                  className={`shrink-0 rounded-[2px] border px-2.5 py-1.5 text-xs transition-colors cursor-pointer flex items-center gap-1.5 font-mono ${
                    isSelected
                      ? "border-slate-300 bg-white font-black text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white shadow-sm"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-white hover:text-slate-900 dark:border-zinc-800/80 dark:bg-zinc-950/60 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white font-medium"
                  }`}
                >
                  <span>{stage.label}</span>
                  <span className="font-mono text-[10px] text-slate-600 dark:text-zinc-300 font-semibold">
                    {count} negoc.
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Barra de Busca e Contador */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 dark:bg-zinc-950/40 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar por oportunidade, empresa, contato ou ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-[2px] border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 py-1.5 pl-9 pr-3 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 outline-none transition-colors focus:border-primary"
            />
          </div>

          <div className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono">
            Exibindo{" "}
            <strong className="text-slate-900 dark:text-white font-bold">
              {filteredDeals.length}
            </strong>{" "}
            negociações
          </div>
        </div>

        {/* Tabela de Negociações */}
        <div className="flex-1 overflow-y-auto max-h-[50vh] scrollbar-thin">
          <table className="w-full text-left border-collapse font-mono">
            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
              <tr>
                <th className="py-2 px-4">NEGOCIAÇÃO / EMPRESA</th>
                <th className="py-2 px-3">RESPONSÁVEL</th>
                <th className="py-2 px-3">VALOR NEGOCIAÇÃO</th>
                <th className="py-2 px-3">DIAS EM ABERTO</th>
                <th className="py-2 px-3">DATA DE CRIAÇÃO</th>
                <th className="py-2 px-3">ETAPA NO FUNIL</th>
                <th className="py-2 px-4 text-right">CARD NO CRM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                    Carregando negociações...
                  </td>
                </tr>
              ) : filteredDeals.length > 0 ? (
                filteredDeals.map((deal) => (
                  <tr
                    key={deal.id}
                    className="hover:bg-slate-50 dark:hover:bg-zinc-900/40 transition-colors"
                  >
                    {/* Negociação / Empresa */}
                    <td className="py-2 px-4">
                      <div className="font-bold text-slate-900 dark:text-white tracking-tight">
                        {deal.title}
                      </div>
                      <div className="text-[9.5px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                        {deal.funnelName}
                      </div>
                    </td>

                    {/* Responsável */}
                    <td className="py-2 px-3 font-medium text-slate-700 dark:text-zinc-200">
                      {deal.responsibleName}
                    </td>

                    {/* Valor */}
                    <td className="py-2 px-3 font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      {formatDealValue(deal.value)}
                    </td>

                    {/* Dias em Aberto */}
                    <td className="py-2 px-3">
                      <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-800 dark:text-emerald-400">
                        <Clock className="h-3 w-3" />
                        <span>{deal.daysOpen} dias</span>
                      </span>
                    </td>

                    {/* Data de Criação */}
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-zinc-300">
                      {deal.createdAt}
                    </td>

                    {/* Etapa no Funil */}
                    <td className="py-2 px-3">
                      <span className="inline-block rounded-[2px] border border-sky-300 dark:border-sky-800/50 bg-sky-50 dark:bg-sky-950/40 px-2.5 py-0.5 text-[10px] font-medium text-sky-800 dark:text-sky-300">
                        {deal.stageName}
                      </span>
                    </td>

                    {/* Card no CRM */}
                    <td className="py-2 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          if (deal.rdDealUrl) {
                            window.open(deal.rdDealUrl, "_blank", "noopener,noreferrer");
                          } else {
                            onOpenDeal?.(deal.id, deal.rdDealUrl);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-[2px] border border-sky-400 dark:border-sky-600/50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-600/20 transition-colors cursor-pointer"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>Abrir no CRM</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-xs text-slate-500 dark:text-zinc-400 font-mono"
                  >
                    Nenhuma negociação encontrada para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé do Modal */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 p-3 sm:px-4 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-400 font-mono">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Dados em tempo real sincronizados com o CRM.</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] bg-[#df3d3d] hover:bg-[#c93232] px-5 py-1.5 text-xs font-bold text-white shadow-md transition-colors cursor-pointer font-mono"
          >
            Concluir Visualização
          </button>
        </footer>
      </div>
    </div>
  );
}
