import React, { useState, useMemo, useCallback } from "react";
import {
  Users,
  Tv,
  Star,
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
  ShieldCheck,
  CheckCircle2,
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

export type ConsultantRow = {
  operatorId: string;
  name: string;
  email: string;
  avatar?: string | null;
  division?: string | null; // 'personnalite' | 'maquinas'
  activeOnTv?: boolean | null;
  rdUserId?: string | null;
  status?: string | null; // 'disponivel' | 'ocupado' | 'ausente'
  role?: string | null;
  isOnline?: boolean | null;
};

interface CommercialConsultantsViewProps {
  consultants: ConsultantRow[];
  loading?: boolean;
  onRefresh?: () => Promise<void> | void;
}

const PAGE_SIZE = 10;

export function CommercialConsultantsView({
  consultants,
  loading = false,
  onRefresh,
}: CommercialConsultantsViewProps) {
  // Estados de busca e filtro
  const [searchTerm, setSearchTerm] = useState("");
  const [teamFilter, setTeamFilter] = useState<"all" | "maquinas" | "personnalite">("all");
  const [currentPage, setCurrentPage] = useState(1);

  // Estados de modais
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [editingConsultant, setEditingConsultant] = useState<ConsultantRow | null>(null);
  const [linkingConsultant, setLinkingConsultant] = useState<ConsultantRow | null>(null);
  const [deletingConsultant, setDeletingConsultant] = useState<ConsultantRow | null>(null);

  // Formulário Novo Consultor
  const [newConsultantType, setNewConsultantType] = useState<"existing" | "new">("existing");
  const [selectedOperatorId, setSelectedOperatorId] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newDivision, setNewDivision] = useState<"maquinas" | "personnalite">("maquinas");
  const [newActiveOnTv, setNewActiveOnTv] = useState(true);
  const [newRdUserId, setNewRdUserId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Formulário Edição
  const [editDivision, setEditDivision] = useState<"maquinas" | "personnalite">("maquinas");
  const [editActiveOnTv, setEditActiveOnTv] = useState(true);
  const [editRdUserId, setEditRdUserId] = useState("");

  // Formulário Vínculo RD direto
  const [directRdUserId, setDirectRdUserId] = useState("");

  // Lista de operadores elegíveis para "Novo Consultor" (operadores que ainda não têm equipe definida)
  const unassignedOperators = useMemo(() => {
    return consultants.filter((c) => !c.division);
  }, [consultants]);

  // Estatísticas do Topo (KPIs)
  // Consultores ativos são aqueles cadastrados na operação comercial com status ativo/disponível
  const activeConsultantsCount = useMemo(() => {
    return consultants.filter((c) => Boolean(c.division)).length;
  }, [consultants]);

  const visibleOnTvCount = useMemo(() => {
    return consultants.filter((c) => Boolean(c.division) && (c.activeOnTv ?? true)).length;
  }, [consultants]);

  const teamsCount = useMemo(() => {
    const teams = new Set(
      consultants.map((c) => c.division?.toLowerCase()).filter(Boolean)
    );
    return teams.size || 2; // Máquinas e Personnalité
  }, [consultants]);

  // Filtragem
  const filteredConsultants = useMemo(() => {
    let result = consultants.filter((c) => Boolean(c.division));

    // Se não tiver nenhum com divisão mas houver consultores na lista, mostra todos
    if (result.length === 0 && consultants.length > 0) {
      result = consultants;
    }

    if (teamFilter !== "all") {
      result = result.filter(
        (c) => c.division?.toLowerCase() === teamFilter.toLowerCase()
      );
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.email.toLowerCase().includes(term) ||
          (c.division && c.division.toLowerCase().includes(term)) ||
          (c.rdUserId && c.rdUserId.toLowerCase().includes(term))
      );
    }

    return result;
  }, [consultants, teamFilter, searchTerm]);

  // Paginação
  const totalPages = Math.max(1, Math.ceil(filteredConsultants.length / PAGE_SIZE));
  const validCurrentPage = Math.min(currentPage, totalPages);

  const paginatedConsultants = useMemo(() => {
    const start = (validCurrentPage - 1) * PAGE_SIZE;
    return filteredConsultants.slice(start, start + PAGE_SIZE);
  }, [filteredConsultants, validCurrentPage]);

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
          `${consultant.name} agora está ${nextTvState ? "visível" : "oculto"} no BI TV.`
        );
        if (onRefresh) await onRefresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao atualizar TV");
      }
    },
    [onRefresh]
  );

  // Copiar ID do RD Station CRM
  const handleCopyRdId = useCallback((rdId: string) => {
    navigator.clipboard.writeText(rdId);
    toast.success("ID RD Station copiado com sucesso!");
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
      "Vínculo RD CRM",
      "Status",
    ];

    const rows = filteredConsultants.map((c) => [
      `"${c.name.replace(/"/g, '""')}"`,
      `"${c.email.replace(/"/g, '""')}"`,
      `"${(c.division || "NÃO ATRIBUÍDO").toUpperCase()}"`,
      c.activeOnTv ?? true ? "SIM" : "NÃO",
      `"${c.rdUserId || "NÃO VINCULADO"}"`,
      c.status === "ausente" ? "Ausente" : "Ativo",
    ]);

    const csvContent =
      "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `consultores-equipes-tecfag-${new Date().toISOString().slice(0, 10)}.csv`
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
    setEditDivision(
      consultant.division === "personnalite" ? "personnalite" : "maquinas"
    );
    setEditActiveOnTv(consultant.activeOnTv ?? true);
    setEditRdUserId(consultant.rdUserId || "");
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
          rdUserId: editRdUserId.trim() || null,
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
  }, [editingConsultant, editDivision, editActiveOnTv, editRdUserId, onRefresh]);

  // Abertura do Modal de Vínculo RD Direto
  const handleOpenLinkRd = useCallback((consultant: ConsultantRow) => {
    setLinkingConsultant(consultant);
    setDirectRdUserId(consultant.rdUserId || "");
  }, []);

  // Salvar Vínculo RD Direto
  const handleSaveDirectRd = useCallback(async () => {
    if (!linkingConsultant) return;
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/commercial/consultants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          operatorId: linkingConsultant.operatorId,
          rdUserId: directRdUserId.trim() || null,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao atualizar vínculo RD Station.");
      }

      toast.success(
        directRdUserId.trim()
          ? `Vínculo com RD Station CRM atualizado para ${linkingConsultant.name}!`
          : `Vínculo com RD Station CRM removido para ${linkingConsultant.name}.`
      );
      setLinkingConsultant(null);
      if (onRefresh) await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar vínculo.");
    } finally {
      setIsSubmitting(false);
    }
  }, [linkingConsultant, directRdUserId, onRefresh]);

  // Confirmar Exclusão / Remoção da Equipe Comercial
  const handleConfirmDelete = useCallback(async () => {
    if (!deletingConsultant) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/commercial/consultants?operatorId=${encodeURIComponent(
          deletingConsultant.operatorId
        )}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        }
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
      let targetOperatorId = selectedOperatorId;

      if (newConsultantType === "new") {
        if (!newName.trim() || !newEmail.trim()) {
          throw new Error("Nome e E-mail são obrigatórios para novo cadastro.");
        }

        const generatedId = `op-tf-${newEmail
          .split("@")[0]
          .replace(/[^a-zA-Z0-9]/g, ".")
          .toLowerCase()}`;

        // Cria operador no sistema
        const createOpRes = await fetch("/api/operators", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            id: generatedId,
            name: newName.trim(),
            email: newEmail.trim().toLowerCase(),
            password: "Mudar@123456",
            role: "agent",
            status: "disponivel",
          }),
        });

        if (!createOpRes.ok) {
          const err = await createOpRes.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao criar operador no sistema.");
        }

        targetOperatorId = generatedId;
      }

      if (!targetOperatorId) {
        throw new Error("Selecione um operador ou cadastre um novo.");
      }

      // Vincula à equipe comercial
      const response = await fetch("/api/commercial/consultants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          operatorId: targetOperatorId,
          division: newDivision,
          activeOnTv: newActiveOnTv,
          rdUserId: newRdUserId.trim() || null,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao vincular consultor à equipe comercial.");
      }

      toast.success("Novo consultor comercial adicionado com sucesso!");
      setIsNewModalOpen(false);
      setSelectedOperatorId("");
      setNewName("");
      setNewEmail("");
      setNewRdUserId("");
      if (onRefresh) await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar consultor.");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    newConsultantType,
    selectedOperatorId,
    newName,
    newEmail,
    newDivision,
    newActiveOnTv,
    newRdUserId,
    onRefresh,
  ]);

  return (
    <div className="space-y-6">
      {/* ── 1. Top Section: Header & Action ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[.18em] text-primary block mb-0.5 font-mono">
            EQUIPE & OPERAÇÃO
          </span>
          <h2 className="font-mono text-2xl sm:text-3xl font-bold tracking-[-.05em] text-foreground dark:text-zinc-50">
            Consultores & Equipes
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground dark:text-zinc-400 mt-1">
            Gerencie quem aparece no BI TV e os dados de cada consultor comercial.
          </p>
        </div>

        <div>
          <SystemTooltip content="Adicionar novo consultor ou vincular operador existente à equipe">
            <button
              onClick={() => {
                setIsNewModalOpen(true);
                if (unassignedOperators.length > 0 && !selectedOperatorId) {
                  setSelectedOperatorId(unassignedOperators[0].operatorId);
                }
              }}
              className="inline-flex items-center gap-2 rounded-[4px] bg-primary px-4 py-2.5 text-xs font-mono font-bold text-primary-foreground shadow-sm transition hover:opacity-95 cursor-pointer"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              <span>Novo consultor</span>
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* ── 2. Top Metric KPI Cards (3 Cards) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1: Consultores Ativos */}
        <div className="rounded-[4px] border border-border/80 bg-card p-5 dark:border-zinc-800 dark:bg-zinc-950/70 shadow-sm flex items-center gap-4 transition-all hover:border-primary/50">
          <div className="h-11 w-11 rounded-[4px] bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-foreground dark:text-zinc-50 font-mono leading-none tracking-tight">
              {activeConsultantsCount}
            </div>
            <div className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 mt-1.5">
              consultores ativos
            </div>
          </div>
        </div>

        {/* Card 2: Visíveis no BI TV */}
        <div className="rounded-[4px] border border-border/80 bg-card p-5 dark:border-zinc-800 dark:bg-zinc-950/70 shadow-sm flex items-center gap-4 transition-all hover:border-primary/50">
          <div className="h-11 w-11 rounded-[4px] bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Tv className="h-5 w-5" />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-foreground dark:text-zinc-50 font-mono leading-none tracking-tight">
              {visibleOnTvCount}
            </div>
            <div className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 mt-1.5">
              visíveis no BI TV
            </div>
          </div>
        </div>

        {/* Card 3: Equipes */}
        <div className="rounded-[4px] border border-border/80 bg-card p-5 dark:border-zinc-800 dark:bg-zinc-950/70 shadow-sm flex items-center gap-4 transition-all hover:border-primary/50">
          <div className="h-11 w-11 rounded-[4px] bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Star className="h-5 w-5" />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-foreground dark:text-zinc-50 font-mono leading-none tracking-tight">
              {teamsCount}
            </div>
            <div className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 mt-1.5">
              equipes ativas
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Search & Filter Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Barra de busca */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Buscar consultor ou equipe..."
            className="w-full rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/80 pl-10 pr-9 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary transition"
          />
          {searchTerm && (
            <SystemTooltip content="Limpar busca">
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          )}
        </div>

        {/* Botões de Filtro de Equipes & Exportar */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          <SystemTooltip content="Mostrar consultores de todas as equipes">
            <button
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
              Todas as equipes
            </button>
          </SystemTooltip>

          <SystemTooltip content="Filtrar consultores da equipe Máquinas">
            <button
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
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[4px] text-xs font-bold font-mono border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-foreground hover:border-zinc-600 transition cursor-pointer whitespace-nowrap shadow-sm"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exportar</span>
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* ── 4. Data Table ── */}
      <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border/80 dark:border-zinc-800 bg-muted/30 dark:bg-zinc-900/60">
                <th className="px-6 py-3.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                  CONSULTOR
                </th>
                <th className="px-6 py-3.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                  EQUIPE
                </th>
                <th className="px-6 py-3.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                  E-MAIL
                </th>
                <th className="px-6 py-3.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 text-center">
                  VISÍVEL NO BI TV
                </th>
                <th className="px-6 py-3.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 text-center">
                  STATUS
                </th>
                <th className="px-6 py-3.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 text-right">
                  {/* Ações */}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    <span className="text-xs">Carregando consultores...</span>
                  </td>
                </tr>
              ) : paginatedConsultants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-muted-foreground">
                    <AlertCircle className="h-7 w-7 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-semibold">Nenhum consultor encontrado.</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Tente ajustar os filtros ou cadastre um novo consultor.
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedConsultants.map((consultant) => {
                  const isVisibleOnTv = consultant.activeOnTv ?? true;
                  const divisionDisplay = (consultant.division || "Sem equipe").toUpperCase();
                  const rdId = consultant.rdUserId;

                  // Iniciais para avatar
                  const initials = consultant.name
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((n) => n[0].toUpperCase())
                    .join("");

                  return (
                    <tr
                      key={consultant.operatorId}
                      className="hover:bg-muted/30 transition-colors group"
                    >
                      {/* 1. Consultor (Avatar + Nome + Vínculo RD) */}
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            {consultant.avatar ? (
                              <img
                                src={consultant.avatar}
                                alt={consultant.name}
                                className="h-9 w-9 rounded-[2px] object-cover border border-border dark:border-zinc-700"
                              />
                            ) : (
                              <div className="h-9 w-9 rounded-[2px] bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-mono font-bold text-xs">
                                {initials || "C"}
                              </div>
                            )}
                            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-[1px] bg-emerald-500 ring-1 ring-card" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-foreground dark:text-zinc-100">
                              {consultant.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground dark:text-zinc-400 mt-0.5 flex items-center gap-1 font-mono">
                              {rdId ? (
                                <SystemTooltip content={`ID RD Station: ${rdId} (Clique para copiar)`}>
                                  <button
                                    onClick={() => handleCopyRdId(rdId)}
                                    className="hover:text-primary transition flex items-center gap-1 cursor-pointer"
                                  >
                                    <span>
                                      Vínculo RD: {rdId.length > 10 ? `${rdId.slice(0, 8)}...` : rdId}
                                    </span>
                                    <Copy className="h-2.5 w-2.5 opacity-60 hover:opacity-100" />
                                  </button>
                                </SystemTooltip>
                              ) : (
                                <SystemTooltip content="Consultor não vinculado ao RD Station. Clique no ícone de link ao lado para vincular.">
                                  <span className="text-muted-foreground/60 italic">
                                    Vínculo RD: Não vinculado
                                  </span>
                                </SystemTooltip>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 2. Equipe */}
                      <td className="px-6 py-3.5">
                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-zinc-400">
                          {divisionDisplay}
                        </span>
                      </td>

                      {/* 3. E-mail */}
                      <td className="px-6 py-3.5">
                        <span className="text-xs font-mono text-muted-foreground dark:text-zinc-400">
                          {consultant.email}
                        </span>
                      </td>

                      {/* 4. Visível no BI TV (Green Pill Toggle) */}
                      <td className="px-6 py-3.5 text-center">
                        <div className="inline-flex justify-center">
                          <SystemTooltip
                            content={
                              isVisibleOnTv
                                ? "Visível no BI TV — Clique para ocultar"
                                : "Oculto do BI TV — Clique para exibir"
                            }
                          >
                            <button
                              onClick={() => void handleToggleTv(consultant)}
                              className={`rounded-[2px] px-2.5 py-1 text-[10px] font-mono font-bold transition flex items-center gap-1 shadow-sm cursor-pointer select-none active:scale-95 ${
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

                      {/* 5. Status (Badge Pílula Ativo) */}
                      <td className="px-6 py-3.5 text-center">
                        <div className="inline-flex justify-center">
                          <SystemTooltip content="Status operacional do consultor no sistema">
                            <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-border/60 bg-muted/40 dark:border-zinc-800 dark:bg-zinc-900/60 px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase text-foreground dark:text-zinc-300">
                              <span className="h-1.5 w-1.5 rounded-[1px] bg-emerald-500" />
                              <span>Ativo</span>
                            </span>
                          </SystemTooltip>
                        </div>
                      </td>

                      {/* 6. Ações (Vínculo RD, Editar, Excluir) */}
                      <td className="px-6 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Botão Vínculo RD */}
                          <SystemTooltip content="Configurar Vínculo com RD Station CRM">
                            <button
                              onClick={() => handleOpenLinkRd(consultant)}
                              className="h-7 w-7 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-primary hover:border-primary/50 transition cursor-pointer shadow-sm"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>

                          {/* Botão Editar */}
                          <SystemTooltip content="Editar dados e equipe do consultor">
                            <button
                              onClick={() => handleOpenEdit(consultant)}
                              className="h-7 w-7 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-foreground hover:border-zinc-600 transition cursor-pointer shadow-sm"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>

                          {/* Botão Excluir */}
                          <SystemTooltip content="Remover consultor da equipe comercial">
                            <button
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

        {/* ── 5. Table Footer / Paginação ── */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3 border-t border-border/80 dark:border-zinc-800 bg-muted/20 dark:bg-zinc-950/60 font-mono">
          <div className="text-[11px] text-muted-foreground dark:text-zinc-400">
            {filteredConsultants.length > 0 ? (
              <>
                Mostrando{" "}
                <span className="font-bold text-foreground dark:text-zinc-100">
                  {Math.min(
                    (validCurrentPage - 1) * PAGE_SIZE + 1,
                    filteredConsultants.length
                  )}
                </span>{" "}
                a{" "}
                <span className="font-bold text-foreground dark:text-zinc-100">
                  {Math.min(validCurrentPage * PAGE_SIZE, filteredConsultants.length)}
                </span>{" "}
                de{" "}
                <span className="font-bold text-foreground dark:text-zinc-100">
                  {filteredConsultants.length}
                </span>{" "}
                registros
              </>
            ) : (
              "Nenhum registro"
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <SystemTooltip content="Página anterior">
                <button
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
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={validCurrentPage === totalPages}
                  className="h-7 w-7 rounded-[2px] flex items-center justify-center border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 text-muted-foreground hover:text-foreground hover:border-zinc-600 disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer shadow-sm"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
            </div>
          )}
        </div>
      </div>

      {/* ── 6. Modais / Diálogos Customizados (Zero tooltips nativos, Zero selects nativos feios) ── */}

      {/* Modal: Novo Consultor */}
      <Dialog open={isNewModalOpen} onOpenChange={setIsNewModalOpen}>
        <DialogContent className="sm:max-w-md rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950 p-6 shadow-xl font-sans">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <span>Novo Consultor Comercial</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Vincule um operador existente da Tecfag a uma equipe ou crie um novo consultor.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Seletor de Modo: Operador Existente vs Novo Cadastro */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-muted/40 border border-border">
              <button
                type="button"
                onClick={() => setNewConsultantType("existing")}
                className={`py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                  newConsultantType === "existing"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Operador Existente
              </button>
              <button
                type="button"
                onClick={() => setNewConsultantType("new")}
                className={`py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                  newConsultantType === "new"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Novo Cadastro
              </button>
            </div>

            {newConsultantType === "existing" ? (
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Selecione o Operador
                </label>
                <div className="relative">
                  <select
                    value={selectedOperatorId}
                    onChange={(e) => setSelectedOperatorId(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs sm:text-sm text-foreground outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="">Selecione um operador...</option>
                    {consultants.map((op) => (
                      <option key={op.operatorId} value={op.operatorId}>
                        {op.name} ({op.email})
                        {op.division ? ` - Já em ${op.division.toUpperCase()}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex: Beatriz Ribeiro"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs sm:text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    E-mail Corporativo
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="Ex: vendas7@tecfag.com.br"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs sm:text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>
              </>
            )}

            {/* Seleção de Equipe */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Equipe Comercial
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setNewDivision("maquinas")}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                    newDivision === "maquinas"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Settings className="h-4 w-4" />
                  <span>Máquinas</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNewDivision("personnalite")}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                    newDivision === "personnalite"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Gem className="h-4 w-4" />
                  <span>Personnalité</span>
                </button>
              </div>
            </div>

            {/* Visibilidade no BI TV */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20">
              <div>
                <div className="text-xs font-bold text-foreground">Visível no BI TV</div>
                <div className="text-[11px] text-muted-foreground">
                  Exibir os resultados e métricas no painel de TV
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNewActiveOnTv((prev) => !prev)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                  newActiveOnTv
                    ? "bg-emerald-500 text-white"
                    : "bg-muted text-muted-foreground"
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

            {/* Vínculo RD Station CRM */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>Vínculo RD Station CRM (Opcional)</span>
                <span className="text-[10px] text-muted-foreground/80 lowercase">
                  user_id do crm
                </span>
              </label>
              <input
                type="text"
                value={newRdUserId}
                onChange={(e) => setNewRdUserId(e.target.value)}
                placeholder="Ex: 67b482ec047d9c001e3b5e4a"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs sm:text-sm text-foreground font-mono outline-none focus:border-primary"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setIsNewModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleSaveNewConsultant()}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-soft hover:brightness-110 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
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
        <DialogContent className="sm:max-w-md rounded-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              <span>Editar Consultor Comercial</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Atualize a equipe, visibilidade no BI TV e vínculo RD de{" "}
              <strong className="text-foreground">{editingConsultant?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Seleção de Equipe */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Equipe Comercial
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditDivision("maquinas")}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                    editDivision === "maquinas"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Settings className="h-4 w-4" />
                  <span>Máquinas</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditDivision("personnalite")}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                    editDivision === "personnalite"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Gem className="h-4 w-4" />
                  <span>Personnalité</span>
                </button>
              </div>
            </div>

            {/* Visibilidade no BI TV */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20">
              <div>
                <div className="text-xs font-bold text-foreground">Visível no BI TV</div>
                <div className="text-[11px] text-muted-foreground">
                  Exibir os resultados e métricas no painel de TV
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditActiveOnTv((prev) => !prev)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                  editActiveOnTv
                    ? "bg-emerald-500 text-white"
                    : "bg-muted text-muted-foreground"
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

            {/* Vínculo RD Station CRM */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>Vínculo RD Station CRM</span>
                <span className="text-[10px] text-muted-foreground/80 lowercase">
                  user_id do crm
                </span>
              </label>
              <input
                type="text"
                value={editRdUserId}
                onChange={(e) => setEditRdUserId(e.target.value)}
                placeholder="Ex: 67b482ec047d9c001e3b5e4a"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs sm:text-sm text-foreground font-mono outline-none focus:border-primary"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setEditingConsultant(null)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleSaveEdit()}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-soft hover:brightness-110 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Salvar alterações</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Vínculo Rápido RD Station */}
      <Dialog
        open={Boolean(linkingConsultant)}
        onOpenChange={(open) => !open && setLinkingConsultant(null)}
      >
        <DialogContent className="sm:max-w-md rounded-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Link2 className="h-5 w-5 text-primary" />
              <span>Vínculo com RD Station CRM</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Defina o identificador do consultor no RD Station para sincronização de
              negociações e histórico de vendas de{" "}
              <strong className="text-foreground">{linkingConsultant?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                ID de Usuário no RD Station (user_id)
              </label>
              <input
                type="text"
                value={directRdUserId}
                onChange={(e) => setDirectRdUserId(e.target.value)}
                placeholder="Ex: 67b482ec047d9c001e3b5e4a"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs sm:text-sm text-foreground font-mono outline-none focus:border-primary"
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Dica: O ID de usuário é o hash hexadecimal (ObjectId de 24 caracteres)
              encontrado na URL do RD Station CRM ou no cadastro de usuários.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setLinkingConsultant(null)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleSaveDirectRd()}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-soft hover:brightness-110 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Salvar vínculo</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Confirmação de Remoção / Desvinculação */}
      <Dialog
        open={Boolean(deletingConsultant)}
        onOpenChange={(open) => !open && setDeletingConsultant(null)}
      >
        <DialogContent className="sm:max-w-md rounded-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <span>Remover da Equipe Comercial</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Tem certeza de que deseja remover{" "}
              <strong className="text-foreground">{deletingConsultant?.name}</strong> da equipe
              comercial?
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              O operador continuará existindo no sistema e mantendo seu histórico de conversas e
              negociações, mas não terá equipe comercial atribuída e não será exibido no BI TV.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setDeletingConsultant(null)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleConfirmDelete()}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-soft disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Remover da equipe</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
