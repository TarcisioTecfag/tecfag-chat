import React, { useState, useMemo, useEffect } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  ExternalLink,
  Eye,
  Gem,
  Package,
  RefreshCw,
  Search,
  Sparkles,
  Tv,
  UserCheck,
  Users,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SystemTooltip } from "@/components/ui/tooltip";
import { type ConsultantRow } from "./CommercialConsultantsView";
import { CommercialHomeView } from "./CommercialHomeView";
import { getDeterministicConsultantAvatar } from "@/lib/commercial/avatar-matcher";

interface CommercialProfilesViewProps {
  consultants: ConsultantRow[];
  onRefresh?: () => Promise<void> | void;
  initialOperatorId?: string | null;
}

export function CommercialProfilesView({
  consultants,
  onRefresh,
  initialOperatorId = null,
}: CommercialProfilesViewProps) {
  const [selectedConsultantId, setSelectedConsultantId] = useState<string | null>(initialOperatorId);
  const [searchTerm, setSearchTerm] = useState("");
  const [teamFilter, setTeamFilter] = useState<"all" | "maquinas" | "personnalite">("all");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (initialOperatorId) {
      setSelectedConsultantId(initialOperatorId);
    }
  }, [initialOperatorId]);

  // Apenas consultores com equipe configurada (cadastrados no Gestão Comercial)
  const commercialConsultants = useMemo(() => {
    return consultants.filter((c) => Boolean(c.division));
  }, [consultants]);

  // Contadores por equipe
  const personnaliteCount = useMemo(
    () => commercialConsultants.filter((c) => c.division === "personnalite").length,
    [commercialConsultants],
  );
  const maquinasCount = useMemo(
    () => commercialConsultants.filter((c) => c.division === "maquinas").length,
    [commercialConsultants],
  );

  // Filtragem de busca e equipe
  const filteredConsultants = useMemo(() => {
    return commercialConsultants.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTeam =
        teamFilter === "all" ||
        (teamFilter === "personnalite" && c.division === "personnalite") ||
        (teamFilter === "maquinas" && c.division === "maquinas");
      return matchesSearch && matchesTeam;
    });
  }, [commercialConsultants, searchTerm, teamFilter]);

  const selectedConsultant = useMemo(() => {
    if (!selectedConsultantId) return null;
    return commercialConsultants.find((c) => c.operatorId === selectedConsultantId) || null;
  }, [commercialConsultants, selectedConsultantId]);

  const handleManualRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  // Se um consultor estiver selecionado, exibe exatamente a tela de Início dele com barra de controle executiva fixa no topo
  if (selectedConsultantId && selectedConsultant) {
    const avatarUrl =
      selectedConsultant.avatar || getDeterministicConsultantAvatar(selectedConsultant.name);

    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden h-full">
        {/* Barra Superior Executiva de Modo Gestão — FIXA NO TOPO (Não acompanha scroll do mouse, não sobrepõe campos) */}
        <div className="shrink-0 border-b border-border/80 bg-card/95 px-4 sm:px-6 py-2.5 sm:py-3 dark:border-zinc-800 dark:bg-zinc-950/95 shadow-sm flex flex-wrap items-center justify-between gap-3 z-10 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedConsultantId(null)}
              className="flex items-center gap-1.5 rounded-[4px] border border-border/80 bg-muted/60 dark:border-zinc-800 dark:bg-zinc-900 px-3 py-1.5 font-mono text-xs font-bold text-foreground hover:bg-muted dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar aos Consultores
            </button>

            <div className="h-4 w-[1px] bg-border dark:bg-zinc-800 hidden sm:block" />

            <div className="flex items-center gap-2.5">
              <div className="relative h-7 w-7 rounded-full overflow-hidden border border-border dark:border-zinc-700 bg-muted shrink-0">
                <img
                  src={avatarUrl}
                  alt={selectedConsultant.name}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    const fallback = getDeterministicConsultantAvatar(selectedConsultant.name);
                    if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                  }}
                />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-foreground dark:text-zinc-50">
                    {selectedConsultant.name}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                      selectedConsultant.division === "personnalite"
                        ? "border border-amber-500/40 bg-amber-500/10 text-amber-400"
                        : "border border-blue-500/40 bg-blue-500/10 text-blue-400"
                    }`}
                  >
                    {selectedConsultant.division === "personnalite" ? (
                      <>
                        <Gem className="h-2.5 w-2.5" /> Personnalité
                      </>
                    ) : (
                      <>
                        <Package className="h-2.5 w-2.5" /> Máquinas
                      </>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground dark:text-zinc-400">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Espelhando tela de Início em tempo real</span>
                </div>
              </div>
            </div>
          </div>

          {/* Seletor Rápido de Consultores (Pills horizontais) */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0 scrollbar-none">
            {commercialConsultants.map((c) => {
              const isCurrent = c.operatorId === selectedConsultantId;
              const pillAvatar = c.avatar || getDeterministicConsultantAvatar(c.name);
              return (
                <button
                  key={c.operatorId}
                  type="button"
                  onClick={() => setSelectedConsultantId(c.operatorId)}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-mono font-medium transition-all shrink-0 cursor-pointer ${
                    isCurrent
                      ? "border border-primary bg-primary text-primary-foreground font-bold shadow-sm"
                      : "border border-border/80 bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground dark:border-zinc-800 dark:bg-zinc-900/60"
                  }`}
                  title={`Ver início de ${c.name}`}
                >
                  <img
                    src={pillAvatar}
                    alt={c.name}
                    className="h-4 w-4 rounded-full object-cover"
                    onError={(e) => {
                      const fallback = getDeterministicConsultantAvatar(c.name);
                      if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                    }}
                  />
                  <span className="truncate max-w-[100px]">{c.name.split(" ")[0]}</span>
                </button>
              );
            })}

            {onRefresh && (
              <SystemTooltip content="Recarregar dados" side="bottom">
                <button
                  type="button"
                  onClick={() => void handleManualRefresh()}
                  disabled={refreshing}
                  className="rounded-[4px] border border-border/80 bg-muted/40 dark:border-zinc-800 p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  aria-label="Atualizar"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-primary" : ""}`} />
                </button>
              </SystemTooltip>
            )}
          </div>
        </div>

        {/* Componente CommercialHomeView com scroll exclusivo e isolado (abaixo da barra fixa) */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <CommercialHomeView
            operatorId={selectedConsultantId}
            isManagementPreview={true}
            onBack={() => setSelectedConsultantId(null)}
          />
        </div>
      </div>
    );
  }

  // Visualização de Grade de Perfis (quando nenhum consultor está aberto)
  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-6">
      <div className="w-full space-y-6">
      {/* Header Executivo da Aba Perfis */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/80 dark:border-zinc-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-primary" />
            <h2 className="font-mono text-lg font-bold text-foreground dark:text-zinc-50">
              Perfis dos Consultores Comerciais
            </h2>
            <span className="rounded-[3px] border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">
              {commercialConsultants.length} Consultores
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground dark:text-zinc-400">
            Selecione qualquer consultor para abrir e acompanhar sua tela oficial de Início (metas, pacing diário, diretrizes, agenda e tratativas).
          </p>
        </div>

        {/* Filtros de Equipe */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-900/60 p-0.5">
            <button
              type="button"
              onClick={() => setTeamFilter("all")}
              className={`rounded-[3px] px-3 py-1 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                teamFilter === "all"
                  ? "bg-primary text-white font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Todos ({commercialConsultants.length})
            </button>
            <button
              type="button"
              onClick={() => setTeamFilter("personnalite")}
              className={`rounded-[3px] px-3 py-1 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                teamFilter === "personnalite"
                  ? "bg-amber-600 text-white font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              ★ Personnalité ({personnaliteCount})
            </button>
            <button
              type="button"
              onClick={() => setTeamFilter("maquinas")}
              className={`rounded-[3px] px-3 py-1 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                teamFilter === "maquinas"
                  ? "bg-blue-600 text-white font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              ⚍ Máquinas ({maquinasCount})
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar consultor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-900/80 pl-8 pr-3 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:border-primary outline-none"
            />
          </div>
        </div>
      </div>

      {/* Grid de Cards dos Consultores */}
      {filteredConsultants.length === 0 ? (
        <div className="rounded-[4px] border border-dashed border-border/80 dark:border-zinc-800 p-8 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
          <h3 className="font-mono text-sm font-bold text-foreground">Nenhum consultor encontrado</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {commercialConsultants.length === 0
              ? "Cadastre operadores na aba 'Consultores' e defina suas equipes para ativar seus perfis de Início."
              : "Nenhum consultor corresponde aos filtros de busca selecionados."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredConsultants.map((consultant, index) => {
            const avatarUrl =
              consultant.avatar || getDeterministicConsultantAvatar(consultant.name);
            const isPersonnalite = consultant.division === "personnalite";

            return (
              <motion.div
                key={consultant.operatorId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: index * 0.03 }}
                whileHover={{ y: -3, transition: { duration: 0.15 } }}
                onClick={() => setSelectedConsultantId(consultant.operatorId)}
                className="group relative flex flex-col justify-between rounded-[4px] border border-border/80 bg-card p-4 shadow-sm hover:border-primary/60 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/70 transition-all cursor-pointer"
              >
                {/* Linha Superior: Avatar, Nome e Equipe */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="relative">
                      <div className="h-12 w-12 rounded-full overflow-hidden border border-border/80 dark:border-zinc-700 bg-muted shrink-0 group-hover:ring-2 group-hover:ring-primary/40 transition-all">
                        <img
                          src={avatarUrl}
                          alt={consultant.name}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            const fallback = getDeterministicConsultantAvatar(consultant.name);
                            if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                          }}
                        />
                      </div>
                      {consultant.isOnline && (
                        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-card dark:ring-zinc-950" />
                      )}
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 rounded-[3px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                        isPersonnalite
                          ? "border border-amber-500/40 bg-amber-500/10 text-amber-400"
                          : "border border-blue-500/40 bg-blue-500/10 text-blue-400"
                      }`}
                    >
                      {isPersonnalite ? (
                        <>
                          <Gem className="h-2.5 w-2.5" /> Personnalité
                        </>
                      ) : (
                        <>
                          <Package className="h-2.5 w-2.5" /> Máquinas
                        </>
                      )}
                    </span>
                  </div>

                  <h3 className="font-mono text-sm font-bold text-foreground group-hover:text-primary dark:text-zinc-100 transition-colors truncate">
                    {consultant.name}
                  </h3>
                  <p className="text-[11px] font-mono text-muted-foreground dark:text-zinc-400 truncate mb-3">
                    {consultant.email}
                  </p>
                </div>

                {/* Linha Inferior: Status e Ação */}
                <div className="pt-3 border-t border-border/60 dark:border-zinc-800/80 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-1.5 text-muted-foreground dark:text-zinc-400">
                    <Tv className={`h-3 w-3 ${consultant.activeOnTv !== false ? "text-emerald-400" : "text-zinc-500"}`} />
                    <span className="text-[11px]">
                      {consultant.activeOnTv !== false ? "TV Ativa" : "TV Oculta"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 font-bold text-primary group-hover:translate-x-0.5 transition-transform text-[11px]">
                    <span>Acessar Início</span>
                    <ExternalLink className="h-3 w-3" />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
