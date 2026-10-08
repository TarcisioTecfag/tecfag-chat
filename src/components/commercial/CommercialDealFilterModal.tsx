import { useMemo, useState } from "react";
import { CheckCircle2, Clock, ExternalLink, Search, X } from "lucide-react";
import {
  CommercialPipelineDeal,
  formatDealValue,
  PipelineStageKey,
  PIPELINE_STAGES,
} from "@/lib/commercial/pipeline-data";

interface CommercialDealFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerName?: string;
  sellerId?: string;
  division?: "personnalite" | "maquinas";
  initialStageKey?: PipelineStageKey | "all";
  deals: CommercialPipelineDeal[];
  sellerAvatar?: string;
  onOpenDeal?: (dealId: string, rdUrl?: string) => void;
  onOpenProfile?: (sellerId?: string) => void;
}

export function CommercialDealFilterModal({
  isOpen,
  onClose,
  sellerName = "Diana Gimenes",
  sellerId,
  division = "personnalite",
  initialStageKey = "all",
  deals,
  sellerAvatar,
  onOpenDeal,
  onOpenProfile,
}: CommercialDealFilterModalProps) {
  const [selectedStage, setSelectedStage] = useState<PipelineStageKey | "all">(initialStageKey);
  const [searchQuery, setSearchQuery] = useState("");

  // Re-sincroniza o estágio inicial quando o modal abre ou initialStageKey muda
  useMemo(() => {
    setSelectedStage(initialStageKey);
  }, [initialStageKey]);

  // Contagem de negociações por fase para as abas
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: deals.length,
      requalificacao: 0,
      esfriando: 0,
      leads_recebidos: 0,
      abordagem_comercial: 0,
      qualificado: 0,
      proposta_enviada: 0,
      fechamento: 0,
    };
    for (const deal of deals) {
      if (counts[deal.stageKey] !== undefined) {
        counts[deal.stageKey] += 1;
      }
    }
    return counts;
  }, [deals]);

  // Filtragem de deals pelo estágio selecionado e pela busca
  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      // Filtro de fase
      if (selectedStage !== "all" && deal.stageKey !== selectedStage) {
        return false;
      }
      // Filtro de busca textual
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

  // Nome formatado da fase ativa para a pílula do header
  const activeStageLabel =
    selectedStage === "all"
      ? "Todas as Fases"
      : PIPELINE_STAGES.find((s) => s.key === selectedStage)?.label || "Todas as Fases";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl border border-zinc-800 bg-[#0f1117] text-white shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Cabeçalho do Modal */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 bg-[#12141c] p-4 sm:p-6">
          <div className="flex items-center gap-3.5">
            {/* Avatar */}
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-zinc-800">
              {sellerAvatar ? (
                <img
                  src={sellerAvatar}
                  alt={sellerName}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    // Fallback para iniciais
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center font-mono font-bold text-sm text-red-400 bg-red-950/40">
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
                <h2 className="text-xl font-black tracking-tight text-white">{sellerName}</h2>

                {/* Badge Divisão */}
                <span className="rounded border border-red-500/50 bg-red-950/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-red-400">
                  {division === "personnalite" ? "PERSONNALITÉ" : "MÁQUINAS"}
                </span>

                {/* Pill Fase Atual */}
                <span className="rounded-full border border-emerald-500/40 bg-emerald-950/40 px-3 py-0.5 text-[11px] font-bold text-emerald-300">
                  Fase: {activeStageLabel}
                </span>

                {/* Botão Abrir Perfil */}
                <button
                  type="button"
                  onClick={() => onOpenProfile?.(sellerId)}
                  className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer ml-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>Abrir perfil</span>
                </button>
              </div>

              <p className="mt-1 text-xs text-zinc-400">
                Rastreamento detalhado de negociações ativas no RD Station CRM com link direto para o card
              </p>
            </div>
          </div>

          {/* Botão Fechar X */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Abas de Filtro de Fases */}
        <div className="border-b border-zinc-800 bg-[#12141c]/50 px-4 py-3 sm:px-6">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="tablist">
            {/* Todas as Fases */}
            <button
              type="button"
              role="tab"
              aria-selected={selectedStage === "all"}
              onClick={() => setSelectedStage("all")}
              className={`shrink-0 rounded-xl border px-3.5 py-2 text-xs transition-colors cursor-pointer flex items-center gap-2 ${
                selectedStage === "all"
                  ? "border-white/40 bg-[#1e222d] font-black text-white shadow-sm"
                  : "border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white font-medium"
              }`}
            >
              <span>Todas as Fases</span>
              <span className="font-mono font-bold text-zinc-200">{stageCounts.all}</span>
            </button>

            {/* Fases Individuais */}
            {PIPELINE_STAGES.map((stage) => {
              const count = stageCounts[stage.key] || 0;
              const isSelected = selectedStage === stage.key;
              return (
                <button
                  key={stage.key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSelectedStage(stage.key)}
                  className={`shrink-0 rounded-xl border px-3.5 py-2 text-xs transition-colors cursor-pointer flex items-center gap-2 ${
                    isSelected
                      ? "border-white/40 bg-[#1e222d] font-black text-white shadow-sm"
                      : "border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white font-medium"
                  }`}
                >
                  <span>{stage.label}</span>
                  <span className="font-mono text-[11px] text-zinc-300 font-semibold">{count} negoc.</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Barra de Busca e Contador */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 bg-[#0f1117] border-b border-zinc-800/60">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar por oportunidade, empresa, contato ou ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/70 py-2 pl-10 pr-4 text-xs text-white placeholder-zinc-500 outline-none transition-colors focus:border-red-500/50"
            />
          </div>

          <div className="text-xs text-zinc-400 font-mono">
            Exibindo <strong className="text-white font-bold">{filteredDeals.length}</strong> negociações
          </div>
        </div>

        {/* Tabela de Negociações */}
        <div className="flex-1 overflow-y-auto max-h-[50vh] scrollbar-thin">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-[#141720] border-b border-zinc-800 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="py-3 px-4 sm:px-6">NEGOCIAÇÃO / EMPRESA</th>
                <th className="py-3 px-4">RESPONSÁVEL</th>
                <th className="py-3 px-4">VALOR NEGOCIAÇÃO</th>
                <th className="py-3 px-4">DIAS EM ABERTO</th>
                <th className="py-3 px-4">DATA DE CRIAÇÃO</th>
                <th className="py-3 px-4">ETAPA NO FUNIL</th>
                <th className="py-3 px-4 sm:pr-6 text-right">CARD NO CRM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-xs">
              {filteredDeals.length > 0 ? (
                filteredDeals.map((deal) => (
                  <tr key={deal.id} className="hover:bg-white/[0.03] transition-colors">
                    {/* Negociação / Empresa */}
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="font-bold text-white tracking-tight">{deal.title}</div>
                      <div className="mt-0.5 text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                        {deal.funnelName}
                      </div>
                    </td>

                    {/* Responsável */}
                    <td className="py-3.5 px-4 font-medium text-zinc-200">{deal.responsibleName}</td>

                    {/* Valor */}
                    <td className="py-3.5 px-4 font-mono font-bold text-emerald-400">
                      {formatDealValue(deal.value)}
                    </td>

                    {/* Dias em Aberto */}
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/20 px-2.5 py-1 text-[11px] font-mono font-semibold text-emerald-400">
                        <Clock className="h-3 w-3" />
                        <span>{deal.daysOpen} dias</span>
                      </span>
                    </td>

                    {/* Data de Criação */}
                    <td className="py-3.5 px-4 font-mono text-zinc-300">{deal.createdAt}</td>

                    {/* Etapa no Funil */}
                    <td className="py-3.5 px-4">
                      <span className="inline-block rounded-lg border border-sky-800/50 bg-sky-950/40 px-3 py-1 text-[11px] font-medium text-sky-300">
                        {deal.stageName}
                      </span>
                    </td>

                    {/* Card no CRM */}
                    <td className="py-3.5 px-4 sm:pr-6 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          if (deal.rdDealUrl) {
                            window.open(deal.rdDealUrl, "_blank", "noopener,noreferrer");
                          } else {
                            onOpenDeal?.(deal.id, deal.rdDealUrl);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-sky-600/50 px-3 py-1.5 text-xs font-semibold text-sky-400 hover:bg-sky-600/20 transition-colors cursor-pointer"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Abrir no CRM</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-zinc-400">
                    Nenhuma negociação encontrada para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé do Modal */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-800/80 bg-[#12141c] p-4 sm:px-6">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span>Dados em tempo real sincronizados com o RD Station CRM.</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#df3d3d] hover:bg-[#c93232] px-6 py-2 text-xs font-bold text-white shadow-lg transition-colors cursor-pointer"
          >
            Concluir Visualização
          </button>
        </footer>
      </div>
    </div>
  );
}
