import { CheckCircle2, X } from "lucide-react";
import {
  DiretrizesConsultantRow,
  DiretrizesKpis,
} from "@/lib/commercial/diretrizes-crm-data";

interface CommercialDiretrizesBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  kpis: DiretrizesKpis;
  consultants: DiretrizesConsultantRow[];
  onSelectConsultant?: (consultant: DiretrizesConsultantRow) => void;
}

export function CommercialDiretrizesBreakdownModal({
  isOpen,
  onClose,
  kpis,
  consultants,
  onSelectConsultant,
}: CommercialDiretrizesBreakdownModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col max-h-[90vh] overflow-hidden rounded-[4px] border border-zinc-800 bg-[#0c0d12] text-zinc-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── CABEÇALHO (FOTO 3) ─── */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <h2 className="font-mono text-sm sm:text-base font-bold text-white tracking-tight">
              Taxa de Execução — Breakdown por Consultor
            </h2>
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

        {/* ─── SUBTÍTULO COM INDICADORES GERAIS (FOTO 3) ─── */}
        <div className="flex items-center gap-4 border-b border-zinc-800/80 bg-zinc-950/40 px-4 py-2.5 sm:px-6 font-mono text-xs">
          <span className="font-bold text-white">
            {kpis.concluidasCount} concluídas de {kpis.totalCount} totais
          </span>
          <span className="text-emerald-400 font-bold">
            Taxa geral: {kpis.taxaExecucaoPercent}%
          </span>
          <span className="text-red-400 font-bold">
            {kpis.atrasoCount} em atraso
          </span>
        </div>

        {/* ─── LISTA DOS 10 CONSULTORES COM BARRAS DE EXECUÇÃO (FOTO 3) ─── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 sm:px-6">
          {consultants.map((c) => {
            const hasDirectives = c.totalDirectives > 0;
            const pct = c.taxaExecucaoPercent ?? 0;

            return (
              <div
                key={c.consultantId}
                onClick={() => {
                  if (hasDirectives && onSelectConsultant) {
                    onSelectConsultant(c);
                  }
                }}
                className={`rounded-[3px] border border-zinc-850 bg-zinc-950/50 p-2.5 transition-colors ${
                  hasDirectives ? "hover:border-zinc-700 cursor-pointer" : "opacity-90"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  {/* Nome do Consultor */}
                  <span className="font-mono text-xs font-bold text-white min-w-[150px] truncate">
                    {c.name}
                  </span>

                  {/* Barra de Progresso + Contadores */}
                  <div className="flex-1 max-w-md mx-3">
                    {/* Barra */}
                    <div className="h-3 sm:h-3.5 w-full overflow-hidden rounded-full bg-zinc-800/80 border border-zinc-700/50">
                      {hasDirectives ? (
                        <div
                          className="h-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.35)] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      ) : null}
                    </div>

                    {/* Contadores sob a barra */}
                    <div className="mt-1 flex items-center gap-3.5 font-mono text-[11px] sm:text-xs">
                      <span className={c.concluidas > 0 ? "text-emerald-400 font-black" : "text-zinc-500 font-semibold"}>
                        {c.concluidas} conc.
                      </span>
                      <span className={c.pendenteHoje > 0 ? "text-amber-400 font-black" : "text-zinc-500 font-semibold"}>
                        {c.pendenteHoje} hoje
                      </span>
                      <span className={c.atrasadas > 0 ? "text-red-400 font-black" : "text-zinc-500 font-semibold"}>
                        {c.atrasadas} atras.
                      </span>
                    </div>
                  </div>

                  {/* Badge de Taxa / Status */}
                  <div className="w-14 text-right">
                    {hasDirectives ? (
                      <span className="inline-block rounded-[2px] border border-emerald-500/40 bg-emerald-950/50 px-2 py-0.5 font-mono text-xs font-bold text-emerald-300">
                        {pct}%
                      </span>
                    ) : (
                      <span className="inline-block rounded-[2px] border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 font-mono text-xs font-bold text-zinc-500">
                        —
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
