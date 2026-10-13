// ══════════════════════════════════════════════════════════════════════════════
// FLUXOS TAB — Gestão em Tempo Real da Escala Local e Rodízios por Área
// 100% Harmonizado com o Design System Tecfag & Diretrizes Multi-Tenant
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  Workflow,
  UserCheck,
  UserX,
  Palmtree,
  ExternalLink,
  Users,
  RefreshCw,
  Clock,
  Shuffle,
  Folder,
  Plus,
  Trash2,
  SlidersHorizontal,
  Sparkles,
  Gem,
  Wrench,
  Settings,
  Package,
  CircleDollarSign,
  Search,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  X,
  AlertTriangle,
  UserPlus,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { getAiPersona } from "@/lib/ai-persona";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  FlowOperator,
  FLOW_AREAS,
  ALL_FLOW_FUNNELS,
} from "@/lib/valentina/rodizio-types";

// ─── Ícone por Área ─────────────────────────────────────────────────────────

function getAreaIcon(iconName: string) {
  switch (iconName) {
    case "Gem":
      return Gem;
    case "Wrench":
      return Wrench;
    case "Settings":
      return Settings;
    case "Package":
      return Package;
    case "CircleDollarSign":
      return CircleDollarSign;
    case "Folder":
    default:
      return Folder;
  }
}

// ─── Avatar do Operador com Fallback ────────────────────────────────────────

function OperatorAvatar({
  name,
  avatar,
  size = "h-11 w-11",
  fontSize = "text-xs",
}: {
  name: string;
  avatar?: string | null;
  size?: string;
  fontSize?: string;
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [avatar]);

  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  if (avatar && avatar.trim() !== "" && !imgError) {
    return (
      <img
        src={avatar}
        alt={name}
        className={`${size} rounded-full object-cover shrink-0 border border-border shadow-xs`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={`${size} rounded-full bg-primary/10 flex items-center justify-center font-black ${fontSize} text-primary shrink-0 border border-primary/25 shadow-xs`}
    >
      {initials}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: FLUXOS TAB
// ══════════════════════════════════════════════════════════════════════════════

export function FluxosTab() {
  const { tenant, operators: globalOperators, setActiveView, setSelectedChatId } = useChat();
  const persona = getAiPersona(tenant || "tecfag");

  const [operators, setOperators] = useState<FlowOperator[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<string>("all");
  const [collapsedAreas, setCollapsedAreas] = useState<Record<string, boolean>>({});

  // Modais
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [preselectedAreaForAdd, setPreselectedAreaForAdd] = useState<string>("maquinas");

  const [operatorToRemove, setOperatorToRemove] = useState<FlowOperator | null>(null);
  const [operatorForCompensation, setOperatorForCompensation] = useState<FlowOperator | null>(null);
  const [tempCompValue, setTempCompValue] = useState<number>(0);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  // Carregar dados REAIS da escala e operadores do rodízio via API
  const fetchRodizioData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio?tenantId=${tenant}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.operators)) {
          setOperators(data.operators);
        }
      }
    } catch (e) {
      console.warn("[FluxosTab] Erro ao carregar operadores:", e);
    } finally {
      setIsLoading(false);
    }
  }, [tenant, BACKEND_URL]);

  useEffect(() => {
    fetchRodizioData();
    const interval = setInterval(fetchRodizioData, 4000);
    return () => clearInterval(interval);
  }, [fetchRodizioData]);

  // Alternar colapso de uma área
  const toggleAreaCollapse = (areaId: string) => {
    setCollapsedAreas((prev) => ({
      ...prev,
      [areaId]: !prev[areaId],
    }));
  };

  // Alternar participação em um funil específico
  const handleToggleFunnel = async (operatorId: string, funnel: string) => {
    const targetOp = operators.find((o) => o.id === operatorId);
    if (!targetOp) return;

    const currentFunnels = Array.isArray(targetOp.funnels) ? [...targetOp.funnels] : [];
    const exists = currentFunnels.includes(funnel);
    const nextFunnels = exists
      ? currentFunnels.filter((f) => f !== funnel)
      : [...currentFunnels, funnel];

    // Atualização otimista
    setOperators((prev) =>
      prev.map((o) => (o.id === operatorId ? { ...o, funnels: nextFunnels } : o))
    );

    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_funnel",
          tenantId: tenant,
          operatorId,
          funnel,
        }),
      });

      if (res.ok) {
        toast.success(
          exists
            ? `Funil "${funnel}" desativado para ${targetOp.name}!`
            : `Funil "${funnel}" ativado para ${targetOp.name}!`
        );
      } else {
        toast.error("Erro ao alternar funil no servidor.");
        fetchRodizioData();
      }
    } catch (e) {
      console.error("Erro ao alternar funil:", e);
      toast.error("Erro de comunicação ao salvar funil.");
      fetchRodizioData();
    }
  };

  // Alternar Folga do Operador
  const handleToggleLeave = async (operatorId: string) => {
    const targetOp = operators.find((o) => o.id === operatorId);
    if (!targetOp) return;

    const nextLeave = !targetOp.isOnLeave;

    // Atualização otimista
    setOperators((prev) =>
      prev.map((o) => (o.id === operatorId ? { ...o, isOnLeave: nextLeave } : o))
    );

    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_leave",
          tenantId: tenant,
          operatorId,
        }),
      });

      if (res.ok) {
        toast.success(
          nextLeave
            ? `${targetOp.name} agora está em folga (pausado do rodízio).`
            : `${targetOp.name} retornou da folga e está ATIVO no rodízio!`
        );
      } else {
        toast.error("Erro ao atualizar folga no servidor.");
        fetchRodizioData();
      }
    } catch (e) {
      console.error("Erro ao alternar folga:", e);
      toast.error("Erro de comunicação com o servidor.");
      fetchRodizioData();
    }
  };

  // Alternar Status Ativo / Inativo
  const handleToggleParticipating = async (operatorId: string) => {
    const targetOp = operators.find((o) => o.id === operatorId);
    if (!targetOp) return;

    const nextPart = !targetOp.isParticipating;

    // Atualização otimista
    setOperators((prev) =>
      prev.map((o) => (o.id === operatorId ? { ...o, isParticipating: nextPart } : o))
    );

    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_operator",
          tenantId: tenant,
          operatorId,
          patch: { isParticipating: nextPart },
        }),
      });

      if (res.ok) {
        toast.success(
          nextPart
            ? `${targetOp.name} marcado como ATIVO na escala!`
            : `${targetOp.name} marcado como INATIVO no fluxo.`
        );
      } else {
        toast.error("Erro ao atualizar status do operador.");
        fetchRodizioData();
      }
    } catch (e) {
      console.error("Erro ao atualizar status:", e);
      toast.error("Erro de conexão ao salvar status.");
      fetchRodizioData();
    }
  };

  // Ajustar Compensação
  const handleSaveCompensation = async (operatorId: string, value: number) => {
    const targetOp = operators.find((o) => o.id === operatorId);
    if (!targetOp) return;

    const cleanVal = Math.max(0, value);

    setOperators((prev) =>
      prev.map((o) => (o.id === operatorId ? { ...o, compensation: cleanVal } : o))
    );
    setOperatorForCompensation(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_compensation",
          tenantId: tenant,
          operatorId,
          value: cleanVal,
          isAbsolute: true,
        }),
      });

      if (res.ok) {
        toast.success(`Compensação de ${targetOp.name} atualizada para +${cleanVal}!`);
      } else {
        toast.error("Erro ao atualizar compensação.");
        fetchRodizioData();
      }
    } catch (e) {
      console.error("Erro ao atualizar compensação:", e);
      toast.error("Erro de comunicação ao salvar compensação.");
      fetchRodizioData();
    }
  };

  // Remover Operador da Escala
  const handleConfirmRemoveOperator = async () => {
    if (!operatorToRemove) return;
    const op = operatorToRemove;
    setOperatorToRemove(null);

    // Otimista
    setOperators((prev) => prev.filter((o) => o.id !== op.id));

    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_operator",
          tenantId: tenant,
          operatorId: op.id,
        }),
      });

      if (res.ok) {
        toast.success(`${op.name} removido da escala de atendimento!`);
      } else {
        toast.error("Erro ao remover operador da escala.");
        fetchRodizioData();
      }
    } catch (e) {
      console.error("Erro ao remover operador:", e);
      toast.error("Erro de comunicação ao remover operador.");
      fetchRodizioData();
    }
  };

  // Zerar contadores de leads
  const handleResetCounters = async () => {
    setIsResetting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          tenantId: tenant,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.operators)) {
          setOperators(data.operators);
        }
        toast.success("Contadores de leads dos fluxos reiniciados!");
      } else {
        toast.error("Erro ao reiniciar contadores.");
      }
    } catch (e) {
      console.error("Erro ao zerar contadores:", e);
      toast.error("Erro de comunicação ao zerar contadores.");
    } finally {
      setIsResetting(false);
    }
  };

  const handleOpenLeadChat = (chatId: string) => {
    setSelectedChatId(chatId);
    setActiveView("chat");
    toast.info("Redirecionando para a conversa...");
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copiado para a área de transferência!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Operadores filtrados por busca e por área
  const filteredOperators = useMemo(() => {
    return operators.filter((op) => {
      const query = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !query ||
        op.name.toLowerCase().includes(query) ||
        (op.email && op.email.toLowerCase().includes(query)) ||
        (op.crmId && op.crmId.toLowerCase().includes(query)) ||
        (op.funnels && op.funnels.some((f) => f.toLowerCase().includes(query)));

      const matchesArea =
        selectedAreaFilter === "all" || op.area === selectedAreaFilter;

      return matchesQuery && matchesArea;
    });
  }, [operators, searchQuery, selectedAreaFilter]);

  // Agrupamento por área
  const operatorsByArea = useMemo(() => {
    const map: Record<string, FlowOperator[]> = {};
    for (const area of FLOW_AREAS) {
      map[area.id] = [];
    }
    for (const op of filteredOperators) {
      const areaKey = op.area || "maquinas";
      if (!map[areaKey]) map[areaKey] = [];
      map[areaKey].push(op);
    }
    return map;
  }, [filteredOperators]);

  // Contadores globais
  const totalEnrolled = operators.length;
  const totalActive = operators.filter((o) => o.isParticipating && !o.isOnLeave).length;
  const totalOnLeave = operators.filter((o) => o.isOnLeave).length;
  const totalLeadsToday = operators.reduce((acc, o) => acc + (o.leadsReceivedCount || 0), 0);

  return (
    <div className="flex flex-col gap-5 h-full overflow-y-auto scrollbar-thin pr-1 animate-fadeIn pb-12">
      {/* ── HEADER PRINCIPAL ─────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-extrabold text-foreground flex items-center gap-2">
                Operadores na Escala Local
              </h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Gerencie a atividade e saldos de compensação de leads. A I.A. direciona novos clientes apenas para operadores marcados como <span className="font-extrabold text-emerald-600 dark:text-emerald-400">ATIVO</span> no respectivo rodízio.
              </p>
            </div>
          </div>
        </div>

        {/* Ações do Topo */}
        <div className="flex items-center gap-2 shrink-0">
          <SystemTooltip content="Adicionar um colaborador cadastrado no sistema à escala de rodízio">
            <button
              onClick={() => {
                setPreselectedAreaForAdd("maquinas");
                setIsAddModalOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-extrabold flex items-center gap-1.5 shadow-soft transition cursor-pointer"
            >
              <UserPlus className="h-4 w-4" />
              <span>Adicionar Operador</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content="Atualizar escala e contadores em tempo real">
            <button
              onClick={fetchRodizioData}
              className="p-2 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin text-primary" : ""}`} />
            </button>
          </SystemTooltip>

          <SystemTooltip content="Zerar os contadores de leads recebidos hoje por todos os operadores">
            <button
              onClick={handleResetCounters}
              disabled={isResetting}
              className="px-3 py-2 rounded-xl border border-border hover:bg-muted text-xs font-extrabold text-muted-foreground hover:text-foreground transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${isResetting ? "animate-spin text-primary" : ""}`} />
              <span>{isResetting ? "Zerando..." : "Zerar Leads"}</span>
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* ── KPI STRIP RESUMO ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl bg-card border border-border shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Total na Escala</p>
            <p className="text-xl font-black text-foreground mt-0.5">{totalEnrolled}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-muted/60 text-muted-foreground">
            <Users className="h-4 w-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-card border border-emerald-500/20 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Ativos no Rodízio</p>
            <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{totalActive}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <UserCheck className="h-4 w-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-card border border-amber-500/20 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">Em Folga</p>
            <p className="text-xl font-black text-amber-600 dark:text-amber-400 mt-0.5">{totalOnLeave}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Palmtree className="h-4 w-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-card border border-primary/20 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-primary">Leads Atribuídos Hoje</p>
            <p className="text-xl font-black text-primary mt-0.5">{totalLeadsToday}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <Shuffle className="h-4 w-4" />
          </div>
        </div>
      </div>

      {/* ── BARRA DE PESQUISA & FILTRO RÁPIDO DE ÁREAS ──────────────────────── */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-muted/20 p-2.5 rounded-2xl border border-border">
        {/* Input de Busca */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por operador, e-mail, funil ou CRM ID..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Chips de Área */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          <SystemTooltip content="Exibir operadores de todas as áreas">
            <button
              onClick={() => setSelectedAreaFilter("all")}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold transition cursor-pointer shrink-0 border ${
                selectedAreaFilter === "all"
                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                  : "bg-card text-muted-foreground hover:bg-muted border-border"
              }`}
            >
              Todas as Áreas
            </button>
          </SystemTooltip>

          {FLOW_AREAS.map((area) => {
            const isSelected = selectedAreaFilter === area.id;
            const countInArea = operators.filter((o) => o.area === area.id).length;

            return (
              <SystemTooltip key={area.id} content={`Filtrar apenas rodízio de ${area.name}`}>
                <button
                  onClick={() => setSelectedAreaFilter(area.id)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold transition cursor-pointer shrink-0 border flex items-center gap-1.5 ${
                    isSelected
                      ? "bg-primary text-primary-foreground border-primary shadow-xs"
                      : "bg-card text-muted-foreground hover:bg-muted border-border"
                  }`}
                >
                  <span>{area.name}</span>
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded-md ${
                      isSelected ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {countInArea}
                  </span>
                </button>
              </SystemTooltip>
            );
          })}
        </div>
      </div>

      {/* ── LISTAGEM DE SEÇÕES POR ÁREA (RODÍZIOS SEPARADOS) ─────────────────── */}
      <div className="flex flex-col gap-5">
        {FLOW_AREAS.filter((area) => selectedAreaFilter === "all" || selectedAreaFilter === area.id).map(
          (area) => {
            const areaOperators = operatorsByArea[area.id] || [];
            const activeInArea = areaOperators.filter((o) => o.isParticipating && !o.isOnLeave).length;
            const isCollapsed = Boolean(collapsedAreas[area.id]);
            const AreaIcon = getAreaIcon(area.icon);

            return (
              <div
                key={area.id}
                className="rounded-3xl border border-border bg-card shadow-xs overflow-hidden transition-all"
              >
                {/* Cabeçalho da Área */}
                <div
                  onClick={() => toggleAreaCollapse(area.id)}
                  className="px-5 py-3.5 border-b border-line flex items-center justify-between gap-3 cursor-pointer hover:bg-muted/30 transition select-none"
                >
                  <div className="flex items-center gap-2.5">
                    {/* Ícone de Pasta Vermelha como na referência */}
                    <div className="p-2 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                      <Folder className="h-4.5 w-4.5 fill-red-500/20" />
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-extrabold text-foreground">{area.name}</h2>
                        <span className="text-[11px] font-bold text-muted-foreground">
                          ({activeInArea} ativos / {areaOperators.length} total)
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{area.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <SystemTooltip content={`Adicionar operador especificamente no rodízio de ${area.name}`}>
                      <button
                        onClick={() => {
                          setPreselectedAreaForAdd(area.id);
                          setIsAddModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-xl text-[11px] font-extrabold text-primary hover:text-primary-hover bg-primary-soft/80 hover:bg-primary-soft border border-primary/20 transition flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Adicionar</span>
                      </button>
                    </SystemTooltip>

                    <button
                      onClick={() => toggleAreaCollapse(area.id)}
                      className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                    >
                      {isCollapsed ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronUp className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Conteúdo da Área (Cards dos Operadores) */}
                <AnimatePresence>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="p-4 flex flex-col gap-3"
                    >
                      {areaOperators.length === 0 ? (
                        <div className="p-8 rounded-2xl border border-dashed border-border text-center space-y-2.5">
                          <Users className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                          <div>
                            <p className="text-xs font-bold text-foreground">
                              Nenhum operador configurado em {area.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Adicione operadores para ativar a distribuição automática desta área.
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setPreselectedAreaForAdd(area.id);
                              setIsAddModalOpen(true);
                            }}
                            className="px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-extrabold inline-flex items-center gap-1.5 shadow-soft hover:bg-primary-hover transition cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Adicionar Operador em {area.name}</span>
                          </button>
                        </div>
                      ) : (
                        areaOperators.map((op) => {
                          const isOnlineActive = op.isParticipating && !op.isOnLeave;

                          return (
                            <div
                              key={op.id}
                              className={`p-4 rounded-2xl border transition-all flex flex-col xl:flex-row xl:items-center justify-between gap-4 ${
                                isOnlineActive
                                  ? "bg-card border-border hover:border-primary/30 shadow-xs"
                                  : "bg-muted/15 border-border/80 opacity-80"
                              }`}
                            >
                              {/* ── COLUNA ESQUERDA: Avatar, Dados, Badges e Funis ── */}
                              <div className="flex flex-col gap-3 flex-1 min-w-0">
                                {/* Linha 1: Avatar, Nome, Badges */}
                                <div className="flex items-start md:items-center gap-3">
                                  <OperatorAvatar
                                    name={op.name}
                                    avatar={op.avatar}
                                    size="h-10 w-10"
                                    fontSize="text-xs"
                                  />

                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h3 className="text-xs font-extrabold text-foreground truncate">
                                        {op.name}
                                      </h3>

                                      {/* Badge Departamento */}
                                      <span className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                                        {op.departmentTag || "COMERCIAL"}
                                      </span>

                                      {/* Badge Status */}
                                      {op.isOnLeave ? (
                                        <span className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                          <Palmtree className="h-2.5 w-2.5" />
                                          FOLGA
                                        </span>
                                      ) : op.isParticipating ? (
                                        <span className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                          ATIVO
                                        </span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-muted text-muted-foreground border border-border">
                                          INATIVO
                                        </span>
                                      )}

                                      {/* Badge Role */}
                                      <span className="px-2 py-0.5 rounded-lg text-[9px] font-bold text-muted-foreground border border-border bg-card">
                                        {op.roleTag || "SDR"}
                                      </span>
                                    </div>

                                    {/* Linha de IDs / Metadados */}
                                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1 flex-wrap">
                                      {op.talosId && (
                                        <span className="flex items-center gap-1 font-mono">
                                          <span>Talos ID:</span>
                                          <span className="font-semibold text-foreground/80">{op.talosId}</span>
                                          <button
                                            onClick={() => copyToClipboard(op.talosId!, `talos-${op.id}`)}
                                            className="hover:text-foreground cursor-pointer"
                                            title="Copiar Talos ID"
                                          >
                                            {copiedId === `talos-${op.id}` ? (
                                              <Check className="h-2.5 w-2.5 text-emerald-500" />
                                            ) : (
                                              <Copy className="h-2.5 w-2.5" />
                                            )}
                                          </button>
                                        </span>
                                      )}

                                      <span className="flex items-center gap-1">
                                        <span>CRM ID:</span>
                                        <span className="font-semibold text-foreground/80">
                                          {op.crmId || `${op.name} (${op.email || ""})`}
                                        </span>
                                        <button
                                          onClick={() =>
                                            copyToClipboard(
                                              op.crmId || `${op.name} (${op.email || ""})`,
                                              `crm-${op.id}`
                                            )
                                          }
                                          className="hover:text-foreground cursor-pointer"
                                          title="Copiar CRM ID"
                                        >
                                          {copiedId === `crm-${op.id}` ? (
                                            <Check className="h-2.5 w-2.5 text-emerald-500" />
                                          ) : (
                                            <Copy className="h-2.5 w-2.5" />
                                          )}
                                        </button>
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Linha 2: "ATENDE NOS FUNIS:" com Pills Clicáveis */}
                                <div className="flex flex-col gap-1.5 pt-1 border-t border-line/50">
                                  <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                                    Atende nos Funis:
                                  </span>

                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {ALL_FLOW_FUNNELS.map((funnel) => {
                                      const isAttending = Array.isArray(op.funnels) && op.funnels.includes(funnel);

                                      return (
                                        <SystemTooltip
                                          key={funnel}
                                          content={`Clique para ${isAttending ? "desativar" : "ativar"} o recebimento de leads no funil "${funnel}"`}
                                        >
                                          <button
                                            onClick={() => handleToggleFunnel(op.id, funnel)}
                                            className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition cursor-pointer border ${
                                              isAttending
                                                ? "bg-primary/10 text-primary border-primary/35 shadow-2xs font-extrabold"
                                                : "bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground border-border"
                                            }`}
                                          >
                                            {isAttending ? `+ ${funnel}` : funnel}
                                          </button>
                                        </SystemTooltip>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>

                              {/* ── COLUNA DIREITA: Compensações, Folga & Ações ── */}
                              <div className="flex items-center gap-4 shrink-0 pt-3 xl:pt-0 border-t xl:border-t-0 border-line justify-end">
                                {/* Saldo de Compensações */}
                                <div className="flex flex-col items-center">
                                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">
                                    Compensações
                                  </span>
                                  <SystemTooltip content="Clique para ajustar o saldo de compensação de leads deste operador">
                                    <button
                                      onClick={() => {
                                        setOperatorForCompensation(op);
                                        setTempCompValue(op.compensation || 0);
                                      }}
                                      className="flex items-center gap-1 text-xs font-black text-foreground hover:text-primary transition cursor-pointer mt-0.5 px-2 py-0.5 rounded-lg hover:bg-muted"
                                    >
                                      <span>
                                        {op.compensation && op.compensation > 0
                                          ? `+${op.compensation}`
                                          : op.compensation || 0}
                                      </span>
                                      <RotateCcw className="h-3 w-3 text-muted-foreground hover:text-primary" />
                                    </button>
                                  </SystemTooltip>
                                </div>

                                {/* Botão Colocar/Retirar Folga */}
                                <SystemTooltip
                                  content={
                                    op.isOnLeave
                                      ? "Retirar operador da folga e reativar recebimento de leads"
                                      : "Colocar operador em folga (pausa recebimento de leads temporariamente)"
                                  }
                                >
                                  <button
                                    onClick={() => handleToggleLeave(op.id)}
                                    className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 shadow-xs border ${
                                      op.isOnLeave
                                        ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30"
                                        : "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                                    }`}
                                  >
                                    <Palmtree className="h-3.5 w-3.5" />
                                    <span>{op.isOnLeave ? "Retirar Folga" : "Colocar Folga"}</span>
                                  </button>
                                </SystemTooltip>

                                {/* Ações Extras / Excluir da Escala */}
                                <SystemTooltip content="Remover este operador da escala do fluxo">
                                  <button
                                    onClick={() => setOperatorToRemove(op)}
                                    className="p-2 rounded-xl border border-border hover:bg-red-500/10 hover:border-red-500/30 text-muted-foreground hover:text-red-500 transition cursor-pointer"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </SystemTooltip>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          }
        )}
      </div>

      {/* ── SEÇÃO INFERIOR: HISTÓRICO RECENTE DE DISTRIBUIÇÃO DA IA ─────────── */}
      <div className="p-5 rounded-3xl border border-border bg-card shadow-xs flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-line pb-2.5">
          <div className="flex items-center gap-2">
            <Shuffle className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
              Histórico Recente de Alocações ({persona.name})
            </h3>
          </div>
          <span className="text-[10px] text-muted-foreground">Últimos atendimentos alocados pelo rodízio</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {operators
            .filter((o) => o.recentLeads && o.recentLeads.length > 0)
            .flatMap((o) =>
              (o.recentLeads || []).map((lead) => ({
                ...lead,
                operatorName: o.name,
                operatorArea: o.area,
              }))
            )
            .slice(0, 6)
            .map((item, idx) => (
              <div
                key={idx}
                className="p-3 rounded-2xl bg-muted/20 border border-border flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-extrabold text-foreground truncate">{item.clientName}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Alocado para <span className="font-bold text-primary">{item.operatorName}</span> ({item.operatorArea})
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[9px] text-muted-foreground font-mono">{item.receivedAt}</span>
                  <SystemTooltip content="Abrir conversa no chat principal">
                    <button
                      onClick={() => handleOpenLeadChat(item.chatId)}
                      className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition cursor-pointer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                </div>
              </div>
            ))}

          {operators.every((o) => !o.recentLeads || o.recentLeads.length === 0) && (
            <div className="col-span-full py-6 text-center text-muted-foreground text-xs font-medium">
              Nenhuma alocação registrada hoje ainda. Os novos contatos qualificados pelo {persona.name} aparecerão aqui.
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: ADICIONAR OPERADOR À ESCALA (MANUAL SOB DEMANDA)                */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {isAddModalOpen && (
        <AddOperatorModal
          tenantId={tenant || "tecfag"}
          availableSystemOperators={globalOperators || []}
          alreadyEnrolledIds={operators.map((o) => o.id)}
          initialArea={preselectedAreaForAdd}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={() => {
            setIsAddModalOpen(false);
            fetchRodizioData();
          }}
        />
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: CONFIRMAR REMOÇÃO DA ESCALA                                    */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {operatorToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-card border border-border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-500">
              <div className="p-2.5 rounded-2xl bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-foreground">Remover Operador da Escala</h3>
                <p className="text-[11px] text-muted-foreground">Confirmação de desativação do rodízio</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Tem certeza que deseja remover <strong className="text-foreground">{operatorToRemove.name}</strong> da escala de rodízio da área{" "}
              <strong className="text-foreground">{operatorToRemove.area}</strong>? O operador deixará de receber novos leads da IA, mas seu cadastro no sistema continuará intacto.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <SystemTooltip content="Cancelar e manter o operador na escala">
                <button
                  onClick={() => setOperatorToRemove(null)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
                >
                  Cancelar
                </button>
              </SystemTooltip>

              <SystemTooltip content="Remover definitivamente deste rodízio">
                <button
                  onClick={handleConfirmRemoveOperator}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold shadow-soft transition cursor-pointer"
                >
                  Confirmar Remoção
                </button>
              </SystemTooltip>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: AJUSTAR COMPENSAÇÃO                                            */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {operatorForCompensation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-card border border-border rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-foreground">Saldo de Compensação</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">{operatorForCompensation.name}</p>
              </div>
              <button
                onClick={() => setOperatorForCompensation(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Defina quantos leads de bônus/prioridade este operador deve receber antes dos demais no rodízio.
            </p>

            <div className="flex items-center justify-center gap-3 py-3">
              <SystemTooltip content="Diminuir saldo (-1)">
                <button
                  onClick={() => setTempCompValue((v) => Math.max(0, v - 1))}
                  className="p-2.5 rounded-xl border border-border hover:bg-muted text-foreground font-black text-sm cursor-pointer"
                >
                  -1
                </button>
              </SystemTooltip>

              <div className="px-5 py-2.5 rounded-2xl bg-muted/40 border border-primary/30 text-center min-w-[80px]">
                <span className="text-2xl font-black text-primary">+{tempCompValue}</span>
              </div>

              <SystemTooltip content="Aumentar saldo (+1)">
                <button
                  onClick={() => setTempCompValue((v) => v + 1)}
                  className="p-2.5 rounded-xl border border-border hover:bg-muted text-foreground font-black text-sm cursor-pointer"
                >
                  +1
                </button>
              </SystemTooltip>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
              <SystemTooltip content="Zerar imediatamente para 0">
                <button
                  onClick={() => setTempCompValue(0)}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Zerar
                </button>
              </SystemTooltip>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOperatorForCompensation(null)}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleSaveCompensation(operatorForCompensation.id, tempCompValue)}
                  className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-extrabold shadow-soft hover:bg-primary-hover cursor-pointer"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL: ADICIONAR OPERADOR AO FLUXO (SELETOR DE USUÁRIOS REAIS)
// ══════════════════════════════════════════════════════════════════════════════

interface AddOperatorModalProps {
  tenantId: string;
  availableSystemOperators: Array<{ id: string; name: string; email?: string; avatar?: string; role?: string }>;
  alreadyEnrolledIds: string[];
  initialArea: string;
  onClose: () => void;
  onSuccess: () => void;
}

function AddOperatorModal({
  tenantId,
  availableSystemOperators,
  alreadyEnrolledIds,
  initialArea,
  onClose,
  onSuccess,
}: AddOperatorModalProps) {
  const [searchUser, setSearchUser] = useState("");
  const [selectedOpId, setSelectedOpId] = useState<string>("");
  const [selectedArea, setSelectedArea] = useState<string>(initialArea || "maquinas");
  const [selectedFunnels, setSelectedFunnels] = useState<string[]>([]);
  const [departmentTag, setDepartmentTag] = useState("COMERCIAL");
  const [roleTag, setRoleTag] = useState("SDR");
  const [compensation, setCompensation] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inicializar funis padrão quando troca a área
  useEffect(() => {
    const areaDef = FLOW_AREAS.find((a) => a.id === selectedArea);
    if (areaDef) {
      setSelectedFunnels([...areaDef.defaultFunnels]);
    }
  }, [selectedArea]);

  // Filtrar operadores do sistema disponíveis
  const candidateOperators = useMemo(() => {
    return availableSystemOperators.filter((op) => {
      // Ignorar robôs ou sintéticos
      if (op.id.startsWith("bot-") || op.name.toLowerCase().includes("robô")) return false;
      const q = searchUser.toLowerCase().trim();
      if (!q) return true;
      return (
        op.name.toLowerCase().includes(q) ||
        (op.email && op.email.toLowerCase().includes(q))
      );
    });
  }, [availableSystemOperators, searchUser]);

  const selectedOperator = availableSystemOperators.find((o) => o.id === selectedOpId);

  const toggleFunnelInForm = (funnel: string) => {
    setSelectedFunnels((prev) =>
      prev.includes(funnel) ? prev.filter((f) => f !== funnel) : [...prev, funnel]
    );
  };

  const handleAdd = async () => {
    if (!selectedOpId || !selectedOperator) {
      toast.error("Por favor, selecione um operador do sistema.");
      return;
    }

    if (selectedFunnels.length === 0) {
      toast.error("Selecione pelo menos um funil de atendimento.");
      return;
    }

    setIsSubmitting(true);
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_operator",
          tenantId,
          operator: {
            id: selectedOperator.id,
            name: selectedOperator.name,
            email: selectedOperator.email || "",
            avatar: selectedOperator.avatar || "",
            area: selectedArea,
            funnels: selectedFunnels,
            compensation,
            departmentTag,
            roleTag,
            isParticipating: true,
            isOnLeave: false,
          },
        }),
      });

      if (res.ok) {
        toast.success(`${selectedOperator.name} adicionado com sucesso ao rodízio de ${selectedArea}!`);
        onSuccess();
      } else {
        const data = await res.json();
        toast.error(data.error || "Erro ao adicionar operador à escala.");
      }
    } catch (e) {
      console.error("Erro ao adicionar operador:", e);
      toast.error("Erro de comunicação com o servidor.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-card border border-border rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin shadow-2xl flex flex-col p-6 gap-5">
        {/* Topo do Modal */}
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-foreground">
                Adicionar Operador à Escala
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Escolha um usuário já existente no sistema e configure sua área de atuação.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 1. SELETOR DE USUÁRIO DO SISTEMA */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <span>1. Selecionar Usuário do Sistema</span>
          </label>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchUser}
              onChange={(e) => setSearchUser(e.target.value)}
              placeholder="Digite o nome ou e-mail do colaborador..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-muted/20 border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Lista de Sugestões de Usuários */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-44 overflow-y-auto scrollbar-thin p-1 border border-border rounded-2xl bg-muted/10">
            {candidateOperators.map((op) => {
              const isSelected = selectedOpId === op.id;
              const isAlreadyIn = alreadyEnrolledIds.includes(op.id);

              return (
                <div
                  key={op.id}
                  onClick={() => setSelectedOpId(op.id)}
                  className={`p-2.5 rounded-xl border flex items-center gap-2.5 cursor-pointer transition ${
                    isSelected
                      ? "bg-primary/10 border-primary text-foreground shadow-2xs"
                      : "bg-card hover:bg-muted/40 border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <OperatorAvatar name={op.name} avatar={op.avatar} size="h-7 w-7" fontSize="text-[10px]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold truncate text-foreground">{op.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{op.email || "Sem e-mail"}</p>
                  </div>
                  {isAlreadyIn && (
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0">
                      Na escala
                    </span>
                  )}
                  {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                </div>
              );
            })}

            {candidateOperators.length === 0 && (
              <div className="col-span-full py-4 text-center text-xs text-muted-foreground">
                Nenhum colaborador encontrado com esta busca.
              </div>
            )}
          </div>
        </div>

        {/* 2. SELETOR DE ÁREA / RODÍZIO */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">
            2. Área / Rodízio de Atuação
          </label>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {FLOW_AREAS.map((area) => {
              const isSelected = selectedArea === area.id;
              const AreaIcon = getAreaIcon(area.icon);

              return (
                <SystemTooltip key={area.id} content={area.description}>
                  <button
                    type="button"
                    onClick={() => setSelectedArea(area.id)}
                    className={`p-3 rounded-2xl border text-left flex items-center gap-2.5 transition cursor-pointer ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-soft"
                        : "bg-card hover:bg-muted/40 border-border text-foreground"
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-lg ${
                        isSelected ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <AreaIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-extrabold truncate">{area.name}</p>
                    </div>
                  </button>
                </SystemTooltip>
              );
            })}
          </div>
        </div>

        {/* 3. SELEÇÃO DE FUNIS ATENDIDOS */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">
              3. Atende nos Funis (Multi-seleção)
            </label>
            <span className="text-[10px] text-muted-foreground">
              {selectedFunnels.length} selecionado(s)
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-2xl bg-muted/20 border border-border">
            {ALL_FLOW_FUNNELS.map((funnel) => {
              const isSelected = selectedFunnels.includes(funnel);

              return (
                <SystemTooltip key={funnel} content={`Ativar/desativar atendimento no funil "${funnel}"`}>
                  <button
                    type="button"
                    onClick={() => toggleFunnelInForm(funnel)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer border ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-2xs font-extrabold"
                        : "bg-card text-muted-foreground hover:bg-muted border-border"
                    }`}
                  >
                    {isSelected ? `+ ${funnel}` : funnel}
                  </button>
                </SystemTooltip>
              );
            })}
          </div>
        </div>

        {/* 4. CONFIGURAÇÕES ADICIONAIS: TAGS E SALDO */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Tag Departamento */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
              Departamento
            </label>
            <div className="flex gap-1 flex-wrap">
              {["COMERCIAL", "PÓS-VENDA", "FINANCEIRO", "TÉCNICA"].map((tag) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => setDepartmentTag(tag)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-extrabold border cursor-pointer ${
                    departmentTag === tag
                      ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 font-black"
                      : "bg-card text-muted-foreground border-border hover:bg-muted"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Tag Cargo / Role */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
              Função
            </label>
            <div className="flex gap-1 flex-wrap">
              {["SDR", "VENDEDOR", "CONSULTOR", "TÉCNICO"].map((role) => (
                <button
                  type="button"
                  key={role}
                  onClick={() => setRoleTag(role)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-extrabold border cursor-pointer ${
                    roleTag === role
                      ? "bg-primary/10 text-primary border-primary/30 font-black"
                      : "bg-card text-muted-foreground border-border hover:bg-muted"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          {/* Saldo Inicial de Compensações */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
              Compensação Inicial
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCompensation((c) => Math.max(0, c - 1))}
                className="p-1.5 rounded-lg border border-border text-foreground hover:bg-muted text-xs font-black cursor-pointer"
              >
                -1
              </button>
              <span className="text-xs font-black text-primary px-2">+{compensation}</span>
              <button
                type="button"
                onClick={() => setCompensation((c) => c + 1)}
                className="p-1.5 rounded-lg border border-border text-foreground hover:bg-muted text-xs font-black cursor-pointer"
              >
                +1
              </button>
            </div>
          </div>
        </div>

        {/* Rodapé com Botões de Ação */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
          <SystemTooltip content="Cancelar e fechar o formulário">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
            >
              Cancelar
            </button>
          </SystemTooltip>

          <SystemTooltip content="Confirmar inserção deste operador na escala">
            <button
              type="button"
              onClick={handleAdd}
              disabled={isSubmitting || !selectedOpId}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-extrabold shadow-soft transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>Adicionar à Escala</span>
                </>
              )}
            </button>
          </SystemTooltip>
        </div>
      </div>
    </div>
  );
}
