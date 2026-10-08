import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  AlertCircle,
  Search,
  Building2,
  User,
  Calendar,
  ExternalLink,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { TVUnclassifiedDeal } from "@/lib/commercial/safras-cohorts-data";
import { buildConsultantAvatarResolver } from "@/lib/commercial/avatar-matcher";

interface CommercialSafrasDrilldownModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthKey: string;
  monthLabel: string;
  deals: TVUnclassifiedDeal[];
  loading?: boolean;
  error?: string | null;
  onOpenDeal?: (dealId: string) => void;
}

export function CommercialSafrasDrilldownModal({
  isOpen,
  onClose,
  monthKey,
  monthLabel,
  deals,
  loading = false,
  error = null,
  onOpenDeal,
}: CommercialSafrasDrilldownModalProps) {
  const [dealsSearch, setDealsSearch] = useState("");
  const avatarResolver = useMemo(() => buildConsultantAvatarResolver(), []);

  // Tecla ESC para fechar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Reset da busca ao trocar de mês ou abrir
  useEffect(() => {
    if (isOpen) {
      setDealsSearch("");
    }
  }, [isOpen, monthKey]);

  const filteredDeals = useMemo(() => {
    if (!dealsSearch.trim()) return deals;
    const q = dealsSearch.toLowerCase().trim();
    return deals.filter(
      (d) =>
        d.name?.toLowerCase().includes(q) ||
        d.userName?.toLowerCase().includes(q) ||
        d.clientName?.toLowerCase().includes(q) ||
        d.companyName?.toLowerCase().includes(q) ||
        d.stageName?.toLowerCase().includes(q) ||
        d.id?.toLowerCase().includes(q),
    );
  }, [deals, dealsSearch]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 dark:bg-black/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[1240px] h-[86vh] rounded-[4px] border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#121215] text-slate-900 dark:text-zinc-100 flex flex-col shadow-2xl shadow-slate-900/20 dark:shadow-black/90 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header do Modal Drilldown */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 bg-slate-50 dark:bg-gradient-to-b dark:from-zinc-900 dark:to-zinc-950 border-b border-slate-200 dark:border-zinc-800 gap-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-[2px] bg-amber-500/15 border border-amber-500/35 text-amber-600 dark:text-amber-400 grid place-items-center">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm sm:text-base font-mono font-bold text-slate-900 dark:text-white tracking-tight">
                    Oportunidades Sem Classificação • {monthLabel}
                  </h2>
                  <span className="text-[10px] font-mono font-black bg-amber-500 text-zinc-950 px-2 py-0.5 rounded-[2px]">
                    {deals.length} CARDS
                  </span>
                </div>
                <p className="text-[11px] font-mono text-slate-500 dark:text-zinc-400">
                  Cards criados nesta safra que ainda não possuem valor preenchido no CRM.
                </p>
              </div>
            </div>

            {/* Barra de Busca e Botão Fechar */}
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 px-3 py-1.5 rounded-[2px] w-48 sm:w-72">
                <Search className="h-3.5 w-3.5 text-slate-400 dark:text-zinc-500 shrink-0" />
                <input
                  type="text"
                  placeholder="Buscar cliente, negócio ou consultor..."
                  value={dealsSearch}
                  onChange={(e) => setDealsSearch(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 w-full font-mono"
                />
                {dealsSearch && (
                  <button
                    type="button"
                    onClick={() => setDealsSearch("")}
                    className="text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onClose}
                className="rounded-[2px] border border-slate-200 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-mono font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">FECHAR</span>
              </motion.button>
            </div>
          </div>

          {/* Tabela de Oportunidades Sem Classificação */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            {error ? (
              <div role="alert" className="p-6 text-center text-sm text-red-500">
                {error}
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center h-full gap-3 text-slate-500 dark:text-zinc-400 font-mono text-xs">
                <RefreshCw className="h-5 w-5 animate-spin text-amber-500 dark:text-amber-400" />
                <span>Buscando oportunidades sem valor no banco de dados...</span>
              </div>
            ) : filteredDeals.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2.5 text-slate-400 dark:text-zinc-500 font-mono py-12">
                <Inbox className="h-10 w-10 text-slate-300 dark:text-zinc-600" />
                <p className="text-xs font-semibold">
                  {dealsSearch
                    ? "Nenhuma oportunidade corresponde ao filtro de busca."
                    : "Nenhuma oportunidade sem valor encontrada para este mês."}
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 text-[10px] uppercase tracking-wider bg-slate-50 dark:bg-zinc-900/40">
                    <th className="py-2.5 px-3 font-bold">Negociação / Empresa</th>
                    <th className="py-2.5 px-3 font-bold">Consultor / Equipe</th>
                    <th className="py-2.5 px-3 font-bold">Funil / Etapa</th>
                    <th className="py-2.5 px-3 font-bold">Data de Criação</th>
                    <th className="py-2.5 px-3 font-bold text-right">Ação Oficial</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60">
                  {filteredDeals.map((deal, idx) => {
                    const isPersonnalite =
                      deal.team === "PERSONNALITE" ||
                      deal.pipelineName?.toLowerCase().includes("personnalite");
                    const formattedDate = deal.dealCreatedAt
                      ? new Date(deal.dealCreatedAt).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—";

                    return (
                      <tr
                        key={deal.id || idx}
                        className="hover:bg-slate-50/80 dark:hover:bg-zinc-900/50 transition-colors"
                      >
                        {/* Nome do Negócio e Empresa */}
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-0.5">
                            <strong className="text-slate-900 dark:text-white text-xs sm:text-[13px] font-bold">
                              {deal.name}
                            </strong>
                            <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-400 text-[11px]">
                              {deal.companyName && (
                                <span className="inline-flex items-center gap-1">
                                  <Building2 className="h-3 w-3 text-slate-400 dark:text-zinc-500" />
                                  {deal.companyName}
                                </span>
                              )}
                              {deal.clientName && deal.companyName && <span>•</span>}
                              {deal.clientName && (
                                <span className="inline-flex items-center gap-1">
                                  <User className="h-3 w-3 text-slate-400 dark:text-zinc-500" />
                                  {deal.clientName}
                                </span>
                              )}
                              {!deal.companyName && !deal.clientName && (
                                <span className="text-slate-400 dark:text-zinc-600 italic">
                                  Contato não informado
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Consultor e Equipe */}
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div
                              className={`relative h-6 w-6 shrink-0 overflow-hidden rounded-[2px] font-bold text-[10px] grid place-items-center ${
                                isPersonnalite
                                  ? "bg-red-500/10 border border-red-500/30 text-red-600 dark:bg-red-500/20 dark:border-red-500/50 dark:text-red-300"
                                  : "bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:bg-blue-500/20 dark:border-blue-500/50 dark:text-blue-300"
                              }`}
                            >
                              {(() => {
                                const avatar = deal.userAvatar || avatarResolver(undefined, deal.userName);
                                return avatar ? (
                                  <img
                                    src={avatar}
                                    alt={deal.userName}
                                    className="h-full w-full object-cover"
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = "none";
                                    }}
                                  />
                                ) : (
                                  deal.userName.slice(0, 2).toUpperCase()
                                );
                              })()}
                            </div>
                            <div>
                              <strong className="text-slate-800 dark:text-zinc-200 block text-xs font-semibold">
                                {deal.userName}
                              </strong>
                              <span
                                className={`text-[9px] font-black uppercase tracking-wider ${
                                  isPersonnalite
                                    ? "text-red-600 dark:text-red-400"
                                    : "text-blue-600 dark:text-blue-400"
                                }`}
                              >
                                {isPersonnalite ? "Personnalité" : "Máquinas"}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Funil e Etapa */}
                        <td className="py-3 px-3">
                          <div className="flex flex-col">
                            <span className="text-slate-800 dark:text-zinc-200 font-medium">
                              {deal.stageName}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                              {deal.pipelineName}
                            </span>
                          </div>
                        </td>

                        {/* Data de Criação */}
                        <td className="py-3 px-3 text-slate-500 dark:text-zinc-400 font-mono text-[11px]">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="h-3 w-3 text-slate-400 dark:text-zinc-500" />
                            {formattedDate}
                          </span>
                        </td>

                        {/* Ação Oficial ABRIR NO CRM */}
                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            {onOpenDeal && (
                              <button
                                type="button"
                                onClick={() => onOpenDeal(deal.id)}
                                className="rounded-[2px] border border-slate-200 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 px-2.5 py-1 text-[11px] font-mono font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                              >
                                Abrir Detalhe
                              </button>
                            )}
                            <a
                              href={`https://crm.rdstation.com/app/deals/${deal.id}?view=pipeline`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-[2px] border border-red-600 bg-gradient-to-b from-[#c83d4e] to-[#962234] px-3 py-1 text-[11px] font-mono font-black text-white hover:brightness-110 shadow-sm shadow-red-950 flex items-center gap-1.5 transition-all"
                              title="Abrir esta oportunidade diretamente no CRM"
                            >
                              <span>ABRIR NO CRM</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Rodapé do Modal Drilldown */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-slate-50 dark:bg-zinc-950 border-t border-slate-200 dark:border-zinc-800 text-[11px] font-mono text-slate-500 dark:text-zinc-400">
            <span>
              Exibindo{" "}
              <strong className="text-slate-900 dark:text-white">{filteredDeals.length}</strong> de{" "}
              <strong className="text-slate-900 dark:text-white">{deals.length}</strong>{" "}
              oportunidades sem valor.
            </span>

            <motion.button
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={onClose}
              className="rounded-[2px] border border-slate-200 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 px-4 py-1 text-xs font-mono font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              Concluído
            </motion.button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
