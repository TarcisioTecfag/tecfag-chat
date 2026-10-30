import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Users,
  Search,
  Settings,
  Gem,
  Download,
  Link2,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Copy,
  AlertCircle,
  Loader2,
  Eye,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { getDeterministicConsultantAvatar } from "@/lib/commercial/avatar-matcher";

export type ConsultantRow = {
  operatorId: string;
  name: string;
  email: string;
  avatar?: string | null;
  division?: string | null; // 'personnalite' | 'maquinas'
  activeOnTv?: boolean | null;
  status?: string | null; // 'disponivel' | 'ocupado' | 'ausente'
  role?: string | null;
  isOnline?: boolean | null;
};

interface CommercialConsultantsViewProps {
  consultants: ConsultantRow[];
  loading?: boolean;
  onRefresh?: () => Promise<void> | void;
  onSelectProfile?: (operatorId: string) => void;
}

const DEFAULT_PAGE_SIZE = 7;
const MODAL_USERS_PAGE_SIZE = 5;

export const CommercialConsultantsView = React.memo(function CommercialConsultantsView({
  consultants,
  loading = false,
  onRefresh,
  onSelectProfile,
}: CommercialConsultantsViewProps) {
  // Estados de busca e filtro
  const [searchTerm, setSearchTerm] = useState("");
  const [teamFilter, setTeamFilter] = useState<"all" | "maquinas" | "personnalite">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  // Calcula dinamicamente quantos consultores cabem na altura disponível da tela sem precisar de scroll vertical
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const updatePageSize = () => {
      const rect = el.getBoundingClientRect();
      // Subtrai cabeçalho da tabela (~38px) e barra de paginação (~46px)
      const availableBodyHeight = rect.height - 84;
      if (availableBodyHeight > 120) {
        // Cada linha compacta ocupa ~49px
        const fittedRows = Math.floor(availableBodyHeight / 49);
        const clamped = Math.max(4, Math.min(12, fittedRows));
        setPageSize((prev) => (prev !== clamped ? clamped : prev));
      }
    };

    updatePageSize();
    const observer = new ResizeObserver(updatePageSize);
    observer.observe(el);
    window.addEventListener("resize", updatePageSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePageSize);
    };
  }, []);

  // Estados de modais
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [editingConsultant, setEditingConsultant] = useState<ConsultantRow | null>(null);
  const [deletingConsultant, setDeletingConsultant] = useState<ConsultantRow | null>(null);

  // Formulário Novo Consultor (com busca e paginação 1 2 3 sem precisar scrollar)
  const [selectedOperatorId, setSelectedOperatorId] = useState("");
  const [modalUserSearch, setModalUserSearch] = useState("");
  const [modalUserPage, setModalUserPage] = useState(1);
  const [newDivision, setNewDivision] = useState<"maquinas" | "personnalite">("maquinas");
  const [newActiveOnTv, setNewActiveOnTv] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Formulário Edição
  const [editDivision, setEditDivision] = useState<"maquinas" | "personnalite">("maquinas");
  const [editActiveOnTv, setEditActiveOnTv] = useState(true);

  // Lista de operadores elegíveis para "Novo Consultor" (operadores que ainda não têm equipe definida)
  const unassignedOperators = useMemo(() => {
    return consultants.filter((c) => !c.division);
  }, [consultants]);

  const filteredUnassignedOperators = useMemo(() => {
    const q = modalUserSearch.trim().toLowerCase();
    if (!q) return unassignedOperators;
    return unassignedOperators.filter(
      (op) =>
        op.name.toLowerCase().includes(q) ||
        op.email.toLowerCase().includes(q) ||
        op.operatorId.toLowerCase().includes(q),
    );
  }, [unassignedOperators, modalUserSearch]);

  const modalTotalPages = Math.max(
    1,
    Math.ceil(filteredUnassignedOperators.length / MODAL_USERS_PAGE_SIZE),
  );
  const validModalUserPage = Math.min(modalUserPage, modalTotalPages);
  const paginatedUnassignedOperators = useMemo(() => {
    const start = (validModalUserPage - 1) * MODAL_USERS_PAGE_SIZE;
    return filteredUnassignedOperators.slice(start, start + MODAL_USERS_PAGE_SIZE);
  }, [filteredUnassignedOperators, validModalUserPage]);

  // Filtragem principal
  const filteredConsultants = useMemo(() => {
    let result = consultants.filter((c) => Boolean(c.division));

    if (teamFilter !== "all") {
      result = result.filter((c) => c.division?.toLowerCase() === teamFilter.toLowerCase());
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.email.toLowerCase().includes(term) ||
          (c.division && c.division.toLowerCase().includes(term)) ||
          c.operatorId.toLowerCase().includes(term),
      );
    }

    return result;
  }, [consultants, teamFilter, searchTerm]);

  // Paginação principal
  const totalPages = Math.max(1, Math.ceil(filteredConsultants.length / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);

  const paginatedConsultants = useMemo(() => {
    const start = (validCurrentPage - 1) * pageSize;
    return filteredConsultants.slice(start, start + pageSize);
  }, [filteredConsultants, validCurrentPage, pageSize]);

  // Alternar Visibilidade no BI TV com clique direto no Pill Switch
  const handleToggleTv = useCallback(
    async (consultant: ConsultantRow) => {
      const nextTvState = !(consultant.activeOnTv ?? true);
      try {
        const response = await fetch("/api/commercial/consultants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            operatorId: consultant.operatorId,
            activeOnTv: nextTvState,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao alterar visibilidade no BI TV");
        }

        toast.success(
          `${consultant.name} agora está ${nextTvState ? "visível" : "oculto"} no BI TV.`,
        );
        if (onRefresh) await onRefresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao atualizar TV");
      }
    },
    [onRefresh],
  );

  const handleCopyOperatorId = useCallback((operatorId: string) => {
    void navigator.clipboard.writeText(operatorId);
    toast.success("ID do usuário copiado.");
  }, []);

  // Exportar para CSV compatível com Excel
  const handleExportCsv = useCallback(() => {
    if (filteredConsultants.length === 0) {
      toast.info("Nenhum registro para exportar.");
      return;
    }

    const headers = [
      "Consultor",
      "E-mail",
      "Equipe",
      "Visível no BI TV",
      "ID do usuário",
      "Status",
    ];

    const rows = filteredConsultants.map((c) => [
      `"${c.name.replace(/"/g, '""')}"`,
      `"${c.email.replace(/"/g, '""')}"`,
      `"${(c.division || "NÃO ATRIBUÍDO").toUpperCase()}"`,
      (c.activeOnTv ?? true) ? "SIM" : "NÃO",
      `"${c.operatorId}"`,
      c.status === "ausente" ? "Ausente" : "Ativo",
    ]);

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `consultores-equipes-tecfag-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Relatório de consultores exportado com sucesso!");
  }, [filteredConsultants]);

  // Abertura do Modal de Edição
  const handleOpenEdit = useCallback((consultant: ConsultantRow) => {
    setEditingConsultant(consultant);
    setEditDivision(consultant.division === "personnalite" ? "personnalite" : "maquinas");
    setEditActiveOnTv(consultant.activeOnTv ?? true);
  }, []);

  // Salvar Edição
  const handleSaveEdit = useCallback(async () => {
    if (!editingConsultant) return;
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/commercial/consultants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          operatorId: editingConsultant.operatorId,
          division: editDivision,
          activeOnTv: editActiveOnTv,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao salvar dados do consultor.");
      }

      toast.success(`Consultor ${editingConsultant.name} atualizado com sucesso!`);
      setEditingConsultant(null);
      if (onRefresh) await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setIsSubmitting(false);
    }
  }, [editingConsultant, editDivision, editActiveOnTv, onRefresh]);

  // Confirmar Exclusão / Remoção da Equipe Comercial
  const handleConfirmDelete = useCallback(async () => {
    if (!deletingConsultant) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/commercial/consultants?operatorId=${encodeURIComponent(
          deletingConsultant.operatorId,
        )}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        },
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao desvincular consultor da equipe.");
      }

      toast.success(`${deletingConsultant.name} foi removido da equipe comercial.`);
      setDeletingConsultant(null);
      if (onRefresh) await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao desvincular.");
    } finally {
      setIsSubmitting(false);
    }
  }, [deletingConsultant, onRefresh]);

  // Salvar Novo Consultor
  const handleSaveNewConsultant = useCallback(async () => {
    setIsSubmitting(true);
    try {
      if (!selectedOperatorId) {
        throw new Error("Selecione um usuário existente do sistema.");
      }

      const response = await fetch("/api/commercial/consultants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          operatorId: selectedOperatorId,
          division: newDivision,
          activeOnTv: newActiveOnTv,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao vincular consultor à equipe comercial.");
      }

      toast.success("Novo consultor comercial adicionado com sucesso!");
      setIsNewModalOpen(false);
      setSelectedOperatorId("");
      setModalUserSearch("");
      setModalUserPage(1);
      if (onRefresh) await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar consultor.");
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedOperatorId, newDivision, newActiveOnTv, onRefresh]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 h-full overflow-hidden">
      {/* ── 1. Search, Filters & Action Bar (Compact Single Row) ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 shrink-0">
        {/* Barra de busca */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Buscar consultor, e-mail ou equipe..."
            className="w-full rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/80 pl-9 pr-8 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary transition"
          />
          {searchTerm && (
            <SystemTooltip content="Limpar busca">
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setCurrentPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          )}
        </div>

        {/* Botões de Filtro de Equipes, Exportar & Novo Consultor */}
        <div className="flex flex-wrap items-center gap-1.5 font-mono">
          <SystemTooltip content="Mostrar consultores de todas as equipes">
            <button
              type="button"
              onClick={() => {
                setTeamFilter("all");
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-[4px] text-xs font-bold font-mono uppercase tracking-wider transition cursor-pointer whitespace-nowrap border shadow-sm ${
                teamFilter === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 bg-card/60 dark:border-zinc-800 dark:bg-zinc-900/60 text-muted-foreground hover:border-zinc-600 hover:text-foreground dark:text-zinc-400"
              }`}
            >
              Todas ({consultants.filter((c) => Boolean(c.division)).length})
            </button>
          </SystemTooltip>

          <SystemTooltip content="Filtrar consultores da equipe Máquinas">
            <button
              type="button"
              onClick={() => {
                setTeamFilter("maquinas");
                setCurrentPage(1);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-xs font-bold font-mono uppercase tracking-wider transition cursor-pointer whitespace-nowrap border shadow-sm ${
                teamFilter === "maquinas"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 bg-card/60 dark:border-zinc-800 dark:bg-zinc-900/60 text-muted-foreground hover:border-zinc-600 hover:text-foreground dark:text-zinc-400"
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>Máquinas</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content="Filtrar consultores da equipe Personnalité">
            <button
              type="button"
              onClick={() => {
                setTeamFilter("personnalite");
                setCurrentPage(1);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-xs font-bold font-mono uppercase tracking-wider transition cursor-pointer whitespace-nowrap border shadow-sm ${
                teamFilter === "personnalite"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 bg-card/60 dark:border-zinc-800 dark:bg-zinc-900/60 text-muted-foreground hover:border-zinc-600 hover:text-foreground dark:text-zinc-400"
              }`}
            >
              <Gem className="h-3.5 w-3.5" />
              <span>Personnalité</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content="Exportar consultores para planilha CSV">
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-xs font-bold font-mono border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-foreground hover:border-zinc-600 transition cursor-pointer whitespace-nowrap shadow-sm"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exportar</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content="Adicionar novo consultor ou vincular usuário existente à equipe comercial">
            <button
              type="button"
              onClick={() => {
                setIsNewModalOpen(true);
                setModalUserSearch("");
                setModalUserPage(1);
                if (unassignedOperators.length > 0 && !selectedOperatorId) {
                  setSelectedOperatorId(unassignedOperators[0].operatorId);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-[4px] bg-primary px-3.5 py-1.5 text-xs font-mono font-bold text-primary-foreground shadow-sm transition hover:opacity-95 cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
              <span>Novo consultor</span>
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* ── 2. Data Table (Viewport-Fitted with Pagination 1 2 3) ── */}
      <div
        ref={tableContainerRef}
        className="flex-1 min-h-0 flex flex-col justify-between rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 overflow-hidden shadow-sm"
      >
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border/80 dark:border-zinc-800 bg-muted/30 dark:bg-zinc-900/60">
                <th className="px-5 py-2.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                  CONSULTOR
                </th>
                <th className="px-5 py-2.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                  EQUIPE
                </th>
                <th className="px-5 py-2.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                  E-MAIL
                </th>
                <th className="px-5 py-2.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 text-center">
                  VISÍVEL NO BI TV
                </th>
                <th className="px-5 py-2.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 text-center">
                  STATUS
                </th>
                <th className="px-5 py-2.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 text-right">
                  AÇÕES
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 dark:divide-zinc-800/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    <span className="text-xs font-mono">Carregando consultores...</span>
                  </td>
                </tr>
              ) : paginatedConsultants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    <AlertCircle className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    <p className="text-xs font-mono font-semibold">Nenhum consultor encontrado.</p>
                    <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                      Tente ajustar os filtros ou clique em &quot;Novo consultor&quot;.
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedConsultants.map((consultant) => {
                  const isVisibleOnTv = consultant.activeOnTv ?? true;
                  const divisionDisplay = (consultant.division || "Sem equipe").toUpperCase();

                  return (
                    <tr
                      key={consultant.operatorId}
                      className="hover:bg-muted/30 dark:hover:bg-zinc-900/40 transition-colors group"
                    >
                      {/* 1. Consultor vinculado ao usuário local */}
                      <td className="px-5 py-2">
                        <div className="flex items-center gap-2.5">
                          <div className="relative shrink-0">
                            <img
                              src={
                                consultant.avatar ||
                                getDeterministicConsultantAvatar(consultant.name)
                              }
                              alt={consultant.name}
                              className="h-8 w-8 rounded-[2px] object-cover border border-border dark:border-zinc-700"
                              onError={(e) => {
                                const img = e.currentTarget;
                                const fallback = getDeterministicConsultantAvatar(consultant.name);
                                if (img.src !== fallback) {
                                  img.src = fallback;
                                }
                              }}
                            />
                            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-[1px] bg-emerald-500 ring-1 ring-card" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-foreground dark:text-zinc-100 truncate">
                              {consultant.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground dark:text-zinc-400 flex items-center gap-1 font-mono">
                              <SystemTooltip
                                content={`ID do usuário: ${consultant.operatorId} (clique para copiar)`}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleCopyOperatorId(consultant.operatorId)}
                                  className="hover:text-primary transition flex items-center gap-1 cursor-pointer"
                                >
                                  <span>
                                    ID:{" "}
                                    {consultant.operatorId.length > 10
                                      ? `${consultant.operatorId.slice(0, 8)}...`
                                      : consultant.operatorId}
                                  </span>
                                  <Copy className="h-2.5 w-2.5 opacity-60 hover:opacity-100" />
                                </button>
                              </SystemTooltip>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 2. Equipe */}
                      <td className="px-5 py-2">
                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-zinc-300">
                          {divisionDisplay}
                        </span>
                      </td>

                      {/* 3. E-mail */}
                      <td className="px-5 py-2">
                        <span className="text-xs font-mono text-muted-foreground dark:text-zinc-400">
                          {consultant.email}
                        </span>
                      </td>

                      {/* 4. Visível no BI TV */}
                      <td className="px-5 py-2 text-center">
                        <div className="inline-flex justify-center">
                          <SystemTooltip
                            content={
                              isVisibleOnTv
                                ? "Visível no BI TV — Clique para ocultar"
                                : "Oculto do BI TV — Clique para exibir"
                            }
                          >
                            <button
                              type="button"
                              onClick={() => void handleToggleTv(consultant)}
                              className={`rounded-[2px] px-2.5 py-0.5 text-[10px] font-mono font-bold transition flex items-center gap-1 shadow-sm cursor-pointer select-none active:scale-95 ${
                                isVisibleOnTv
                                  ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                                  : "bg-muted hover:bg-muted/80 text-muted-foreground dark:bg-zinc-800 dark:text-zinc-400"
                              }`}
                            >
                              {isVisibleOnTv ? (
                                <>
                                  <Check className="h-3 w-3 stroke-[3]" />
                                  <span>ON</span>
                                </>
                              ) : (
                                <>
                                  <X className="h-3 w-3 stroke-[3]" />
                                  <span>OFF</span>
                                </>
                              )}
                            </button>
                          </SystemTooltip>
                        </div>
                      </td>

                      {/* 5. Status */}
                      <td className="px-5 py-2 text-center">
                        <div className="inline-flex justify-center">
                          <SystemTooltip content="Status operacional do consultor no sistema">
                            <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-border/60 bg-muted/40 dark:border-zinc-800 dark:bg-zinc-900/60 px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-foreground dark:text-zinc-300">
                              <span className="h-1.5 w-1.5 rounded-[1px] bg-emerald-500" />
                              <span>Ativo</span>
                            </span>
                          </SystemTooltip>
                        </div>
                      </td>

                      {/* 6. Ações */}
                      <td className="px-5 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <SystemTooltip content="Copiar ID do usuário local">
                            <button
                              type="button"
                              onClick={() => handleCopyOperatorId(consultant.operatorId)}
                              className="h-7 w-7 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-primary hover:border-primary/50 transition cursor-pointer shadow-sm"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>

                          {Boolean(consultant.division) && onSelectProfile && (
                            <SystemTooltip content="Acessar tela de Início do consultor">
                              <button
                                type="button"
                                onClick={() => onSelectProfile(consultant.operatorId)}
                                className="h-7 w-7 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-emerald-400 hover:border-emerald-500/50 transition cursor-pointer shadow-sm"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                            </SystemTooltip>
                          )}

                          <SystemTooltip content="Editar dados e equipe do consultor">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(consultant)}
                              className="h-7 w-7 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-foreground hover:border-zinc-600 transition cursor-pointer shadow-sm"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>

                          <SystemTooltip content="Remover consultor da equipe comercial">
                            <button
                              type="button"
                              onClick={() => setDeletingConsultant(consultant)}
                              className="h-7 w-7 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-red-500 hover:border-red-500/50 transition cursor-pointer shadow-sm"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── 3. Table Footer / Paginação Sempre Visível (1 2 3...) ── */}
        <div className="shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-2.5 border-t border-border/80 dark:border-zinc-800 bg-muted/20 dark:bg-zinc-950/60 font-mono">
          <div className="text-[11px] text-muted-foreground dark:text-zinc-400">
            {filteredConsultants.length > 0 ? (
              <>
                Mostrando{" "}
                <span className="font-bold text-foreground dark:text-zinc-100">
                  {Math.min((validCurrentPage - 1) * pageSize + 1, filteredConsultants.length)}
                </span>{" "}
                a{" "}
                <span className="font-bold text-foreground dark:text-zinc-100">
                  {Math.min(validCurrentPage * pageSize, filteredConsultants.length)}
                </span>{" "}
                de{" "}
                <span className="font-bold text-foreground dark:text-zinc-100">
                  {filteredConsultants.length}
                </span>{" "}
                consultores
              </>
            ) : (
              "Nenhum registro"
            )}
          </div>

          <div className="flex items-center gap-1">
            <SystemTooltip content="Página anterior">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={validCurrentPage === 1}
                className="h-7 w-7 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-foreground hover:border-zinc-600 disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer shadow-sm"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>

            {Array.from({ length: totalPages }).map((_, idx) => {
              const pageNum = idx + 1;
              const isActive = pageNum === validCurrentPage;
              return (
                <SystemTooltip key={pageNum} content={`Página ${pageNum}`}>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(pageNum)}
                    className={`h-7 min-w-[28px] px-2 rounded-[2px] text-xs font-mono font-bold transition cursor-pointer border shadow-sm ${
                      isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/60 bg-card/60 dark:border-zinc-800 dark:bg-zinc-900/60 text-muted-foreground hover:border-zinc-600 hover:text-foreground dark:text-zinc-400"
                    }`}
                  >
                    {pageNum}
                  </button>
                </SystemTooltip>
              );
            })}

            <SystemTooltip content="Próxima página">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={validCurrentPage === totalPages}
                className="h-7 w-7 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-foreground hover:border-zinc-600 disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer shadow-sm"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          </div>
        </div>
      </div>

      {/* ── 4. Modais Customizados ── */}

      {/* Modal: Novo Consultor (Com listagem de usuários paginada 1 2 3 sem precisar scrollar) */}
      <Dialog open={isNewModalOpen} onOpenChange={setIsNewModalOpen}>
        <DialogContent className="sm:max-w-lg rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950 p-6 shadow-xl font-sans">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <span className="font-mono">Novo Consultor Comercial</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground dark:text-zinc-400">
              Selecione um usuário para vincular a uma equipe comercial.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Campo de Usuários posicionado na tela com paginação 1 2 3 (sem precisar scrollar) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                  Usuários disponíveis ({filteredUnassignedOperators.length})
                </label>
                <div className="relative w-52">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={modalUserSearch}
                    onChange={(e) => {
                      setModalUserSearch(e.target.value);
                      setModalUserPage(1);
                    }}
                    placeholder="Filtrar usuário..."
                    className="w-full rounded-[3px] border border-border/80 dark:border-zinc-800 bg-background dark:bg-zinc-900/80 pl-7 pr-6 py-1 text-[11px] font-mono text-foreground outline-none focus:border-primary"
                  />
                  {modalUserSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalUserSearch("");
                        setModalUserPage(1);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-[4px] border border-border/80 dark:border-zinc-800 bg-background/60 dark:bg-zinc-900/50 overflow-hidden">
                {paginatedUnassignedOperators.length === 0 ? (
                  <div className="py-6 text-center text-xs font-mono text-muted-foreground">
                    Nenhum usuário disponível para vínculo.
                  </div>
                ) : (
                  <div className="divide-y divide-border/60 dark:divide-zinc-800/60">
                    {paginatedUnassignedOperators.map((op) => {
                      const isSelected = selectedOperatorId === op.operatorId;
                      return (
                        <button
                          key={op.operatorId}
                          type="button"
                          onClick={() => setSelectedOperatorId(op.operatorId)}
                          className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition cursor-pointer ${
                            isSelected
                              ? "bg-primary/10 dark:bg-primary/20 text-foreground"
                              : "hover:bg-muted/40 dark:hover:bg-zinc-800/60 text-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <img
                              src={op.avatar || getDeterministicConsultantAvatar(op.name)}
                              alt={op.name}
                              className="h-7 w-7 rounded-[2px] object-cover shrink-0 border border-border/80 dark:border-zinc-700"
                              onError={(e) => {
                                const fallback = getDeterministicConsultantAvatar(op.name);
                                if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                              }}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-mono font-bold truncate">{op.name}</div>
                              <div className="text-[10px] font-mono text-muted-foreground truncate">
                                {op.email}
                              </div>
                            </div>
                          </div>
                          <div
                            className={`h-4 w-4 rounded-[2px] border flex items-center justify-center shrink-0 ${
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border dark:border-zinc-700"
                            }`}
                          >
                            {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Paginação 1 2 3 dos usuários disponíveis */}
                {modalTotalPages > 1 && (
                  <div className="flex items-center justify-between px-3 py-2 border-t border-border/80 dark:border-zinc-800 bg-muted/20 dark:bg-zinc-950/60 font-mono">
                    <span className="text-[10px] text-muted-foreground">
                      Página {validModalUserPage} de {modalTotalPages}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setModalUserPage((p) => Math.max(1, p - 1))}
                        disabled={validModalUserPage === 1}
                        className="h-6 w-6 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      {Array.from({ length: modalTotalPages }).map((_, idx) => {
                        const pageNum = idx + 1;
                        const active = pageNum === validModalUserPage;
                        return (
                          <button
                            key={pageNum}
                            type="button"
                            onClick={() => setModalUserPage(pageNum)}
                            className={`h-6 min-w-[24px] px-1.5 rounded-[2px] text-[11px] font-mono font-bold border transition cursor-pointer ${
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border/60 bg-card dark:border-zinc-800 dark:bg-zinc-900 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setModalUserPage((p) => Math.min(modalTotalPages, p + 1))}
                        disabled={validModalUserPage === modalTotalPages}
                        className="h-6 w-6 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Seleção de Equipe */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                Equipe Comercial
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setNewDivision("maquinas")}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-[4px] border text-xs font-mono font-bold transition cursor-pointer ${
                    newDivision === "maquinas"
                      ? "border-primary bg-primary/10 text-primary dark:bg-primary/20"
                      : "border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900/60 text-muted-foreground hover:bg-muted dark:hover:bg-zinc-800"
                  }`}
                >
                  <Settings className="h-4 w-4" />
                  <span>Máquinas</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNewDivision("personnalite")}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-[4px] border text-xs font-mono font-bold transition cursor-pointer ${
                    newDivision === "personnalite"
                      ? "border-primary bg-primary/10 text-primary dark:bg-primary/20"
                      : "border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900/60 text-muted-foreground hover:bg-muted dark:hover:bg-zinc-800"
                  }`}
                >
                  <Gem className="h-4 w-4" />
                  <span>Personnalité</span>
                </button>
              </div>
            </div>

            {/* Visibilidade no BI TV */}
            <div className="flex items-center justify-between p-3 rounded-[4px] border border-border/80 dark:border-zinc-800 bg-muted/20 dark:bg-zinc-900/40">
              <div>
                <div className="text-xs font-mono font-bold text-foreground dark:text-zinc-100">
                  Visível no BI TV
                </div>
                <div className="text-[11px] text-muted-foreground dark:text-zinc-400">
                  Exibir os resultados e métricas no painel de TV
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNewActiveOnTv((prev) => !prev)}
                className={`rounded-[2px] px-2.5 py-1 text-xs font-mono font-bold transition flex items-center gap-1 cursor-pointer border ${
                  newActiveOnTv
                    ? "bg-emerald-500 border-emerald-600 text-white"
                    : "bg-muted dark:bg-zinc-800 border-border dark:border-zinc-700 text-muted-foreground"
                }`}
              >
                {newActiveOnTv ? (
                  <>
                    <Check className="h-3 w-3 stroke-[3]" /> ON
                  </>
                ) : (
                  <>
                    <X className="h-3 w-3 stroke-[3]" /> OFF
                  </>
                )}
              </button>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setIsNewModalOpen(false)}
              className="px-4 py-2 rounded-[4px] text-xs font-mono font-bold text-muted-foreground hover:bg-muted dark:hover:bg-zinc-900 transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSubmitting || !selectedOperatorId}
              onClick={() => void handleSaveNewConsultant()}
              className="px-4 py-2 rounded-[4px] bg-primary text-primary-foreground text-xs font-mono font-bold shadow-sm hover:brightness-110 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Salvar consultor</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Editar Consultor */}
      <Dialog
        open={Boolean(editingConsultant)}
        onOpenChange={(open) => !open && setEditingConsultant(null)}
      >
        <DialogContent className="sm:max-w-md rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950 p-6 shadow-xl font-sans">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              <span className="font-mono">Editar Consultor Comercial</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground dark:text-zinc-400">
              Atualize a equipe e a visibilidade no BI TV de{" "}
              <strong className="text-foreground dark:text-zinc-100">
                {editingConsultant?.name}
              </strong>
              .
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Seleção de Equipe */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                Equipe Comercial
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditDivision("maquinas")}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-[4px] border text-xs font-mono font-bold transition cursor-pointer ${
                    editDivision === "maquinas"
                      ? "border-primary bg-primary/10 text-primary dark:bg-primary/20"
                      : "border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900/60 text-muted-foreground hover:bg-muted dark:hover:bg-zinc-800"
                  }`}
                >
                  <Settings className="h-4 w-4" />
                  <span>Máquinas</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditDivision("personnalite")}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-[4px] border text-xs font-mono font-bold transition cursor-pointer ${
                    editDivision === "personnalite"
                      ? "border-primary bg-primary/10 text-primary dark:bg-primary/20"
                      : "border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900/60 text-muted-foreground hover:bg-muted dark:hover:bg-zinc-800"
                  }`}
                >
                  <Gem className="h-4 w-4" />
                  <span>Personnalité</span>
                </button>
              </div>
            </div>

            {/* Visibilidade no BI TV */}
            <div className="flex items-center justify-between p-3 rounded-[4px] border border-border/80 dark:border-zinc-800 bg-muted/20 dark:bg-zinc-900/40">
              <div>
                <div className="text-xs font-mono font-bold text-foreground dark:text-zinc-100">
                  Visível no BI TV
                </div>
                <div className="text-[11px] text-muted-foreground dark:text-zinc-400">
                  Exibir os resultados e métricas no painel de TV
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditActiveOnTv((prev) => !prev)}
                className={`rounded-[2px] px-2.5 py-1 text-xs font-mono font-bold transition flex items-center gap-1 cursor-pointer border ${
                  editActiveOnTv
                    ? "bg-emerald-500 border-emerald-600 text-white"
                    : "bg-muted dark:bg-zinc-800 border-border dark:border-zinc-700 text-muted-foreground"
                }`}
              >
                {editActiveOnTv ? (
                  <>
                    <Check className="h-3 w-3 stroke-[3]" /> ON
                  </>
                ) : (
                  <>
                    <X className="h-3 w-3 stroke-[3]" /> OFF
                  </>
                )}
              </button>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setEditingConsultant(null)}
              className="px-4 py-2 rounded-[4px] text-xs font-mono font-bold text-muted-foreground hover:bg-muted dark:hover:bg-zinc-900 transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleSaveEdit()}
              className="px-4 py-2 rounded-[4px] bg-primary text-primary-foreground text-xs font-mono font-bold shadow-sm hover:brightness-110 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Salvar alterações</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Confirmação de Remoção / Desvinculação */}
      <Dialog
        open={Boolean(deletingConsultant)}
        onOpenChange={(open) => !open && setDeletingConsultant(null)}
      >
        <DialogContent className="sm:max-w-md rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950 p-6 shadow-xl font-sans">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <span className="font-mono">Remover da Equipe Comercial</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground dark:text-zinc-400">
              Tem certeza de que deseja remover{" "}
              <strong className="text-foreground dark:text-zinc-100">
                {deletingConsultant?.name}
              </strong>{" "}
              da equipe comercial?
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <p className="text-xs text-muted-foreground dark:text-zinc-400 leading-relaxed">
              O operador continuará existindo no sistema e mantendo seu histórico de conversas e
              negociações, mas não terá equipe comercial atribuída e não será exibido no BI TV.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setDeletingConsultant(null)}
              className="px-4 py-2 rounded-[4px] text-xs font-mono font-bold text-muted-foreground hover:bg-muted dark:hover:bg-zinc-900 transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleConfirmDelete()}
              className="px-4 py-2 rounded-[4px] bg-red-600 hover:bg-red-700 text-white text-xs font-mono font-bold shadow-sm disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Remover da equipe</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
