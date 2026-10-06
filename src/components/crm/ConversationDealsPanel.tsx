import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Columns3,
  Plus,
  Link2,
  Unlink,
  CheckCircle2,
  XCircle,
  PauseCircle,
  ExternalLink,
  Loader2,
  Star,
  Building2,
  Check,
  Pencil,
  Save,
  X,
  User,
  DollarSign,
  Activity,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { CreateDealDialog } from "./CreateDealDialog";
import { useChat } from "@/hooks/useChatState";
import { useNavigate } from "@tanstack/react-router";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ConversationDealsPanelProps {
  conversationId: string;
  contactId?: string;
  customerName?: string;
}

interface CustomFieldDef {
  id: string;
  name: string;
  fieldType: string;
  options?: Array<{ id?: string; label?: string; value?: string }> | string[];
  required?: boolean;
  visibleOnCreate?: boolean;
  allPipelines?: boolean;
  pipelineIds?: string[];
}

interface DealEditForm {
  title: string;
  value: string;
  pipelineId: string;
  stageId: string;
  operatorId: string;
  status: "open" | "won" | "lost" | "paused";
  customFields: Record<string, any>;
}

export function ConversationDealsPanel({
  conversationId,
  contactId,
  customerName,
}: ConversationDealsPanelProps) {
  const { currentOperatorId } = useChat();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<any[]>([]);
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<CustomFieldDef[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLinkingOpen, setIsLinkingOpen] = useState(false);

  // Estados de Edição Inline
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [savingDealId, setSavingDealId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DealEditForm>({
    title: "",
    value: "",
    pipelineId: "",
    stageId: "",
    operatorId: "__none__",
    status: "open",
    customFields: {},
  });

  // Cards expandidos para ver todos os campos personalizados
  const [expandedDealIds, setExpandedDealIds] = useState<Set<string>>(new Set());

  // Dados para os modais e selects
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);

  // Estado para busca no modal de vincular existente
  const [searchDealsQuery, setSearchDealsQuery] = useState("");
  const [searchingDeals, setSearchingDeals] = useState(false);
  const [availableDealsToLink, setAvailableDealsToLink] = useState<any[]>([]);

  const [contactInfo, setContactInfo] = useState<{
    id: string;
    name: string;
    accountId: string | null;
    accountName: string | null;
  } | null>(null);

  // Carrega pipelines e operadores
  useEffect(() => {
    fetch("/api/crm/pipelines")
      .then((res) => (res.ok ? res.json() : { pipelines: [] }))
      .then((data) => setPipelines(data.pipelines || []))
      .catch(() => {});

    fetch("/api/operators")
      .then((res) => (res.ok ? res.json() : { operators: [] }))
      .then((data) => setOperators(Array.isArray(data) ? data : data.operators || []))
      .catch(() => {});
  }, []);

  // Carrega negócios vinculados a esta conversa
  const fetchLinkedDeals = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/chats/${conversationId}/deals`);
      if (!res.ok) throw new Error("Erro ao carregar negociações da conversa.");
      const data = await res.json();
      const loadedDeals = data.deals || [];
      setDeals(loadedDeals);

      if (data.customFieldDefinitions) {
        setCustomFieldDefinitions(data.customFieldDefinitions);
      } else {
        // Fallback para buscar definições
        fetch("/api/crm/custom-fields?entity=deal")
          .then((r) => (r.ok ? r.json() : { fields: [] }))
          .then((fData) => setCustomFieldDefinitions(fData.fields || []))
          .catch(() => {});
      }

      if (data.contact) {
        setContactInfo(data.contact);
      }

      // Se houver apenas 1 negócio, expande-o automaticamente
      if (loadedDeals.length === 1) {
        setExpandedDealIds(new Set([loadedDeals[0].id]));
      }
    } catch (err: any) {
      console.warn("[ConversationDealsPanel] Erro ao buscar deals:", err);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    fetchLinkedDeals();
  }, [fetchLinkedDeals]);

  // Alterna expansão de campos personalizados do deal
  const toggleExpand = (dealId: string) => {
    setExpandedDealIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) {
        next.delete(dealId);
      } else {
        next.add(dealId);
      }
      return next;
    });
  };

  // Iniciar edição inline de um deal
  const handleStartEdit = (deal: any) => {
    setEditingDealId(deal.id);
    setEditForm({
      title: deal.title || "",
      value: deal.value !== null && deal.value !== undefined ? String(deal.value) : "",
      pipelineId: deal.pipelineId || pipelines[0]?.id || "",
      stageId: deal.stageId || "",
      operatorId: deal.operatorId || "__none__",
      status: (deal.status as any) || "open",
      customFields: { ...(deal.customFields || {}) },
    });
  };

  // Cancelar edição inline
  const handleCancelEdit = () => {
    setEditingDealId(null);
  };

  // Troca de funil no formulário de edição
  const handlePipelineChange = (newPipelineId: string) => {
    const selectedPipeline = pipelines.find((p) => p.id === newPipelineId);
    const firstStageId = selectedPipeline?.stages?.[0]?.id || "";
    setEditForm((prev) => ({
      ...prev,
      pipelineId: newPipelineId,
      stageId: firstStageId,
    }));
  };

  // Salvar alterações inline
  const handleSaveEdit = async (dealId: string) => {
    if (!editForm.title.trim()) {
      toast.error("O título da negociação é obrigatório.");
      return;
    }

    setSavingDealId(dealId);
    try {
      const payload: Record<string, any> = {
        title: editForm.title.trim(),
        value: editForm.value.trim() !== "" ? Number(editForm.value) : null,
        pipelineId: editForm.pipelineId,
        stageId: editForm.stageId,
        status: editForm.status,
        operatorId: editForm.operatorId === "__none__" ? null : editForm.operatorId,
        customFields: editForm.customFields,
      };

      const res = await fetch(`/api/crm/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Falha ao salvar" }));
        throw new Error(errData.error || "Erro ao atualizar negociação.");
      }

      toast.success("Negociação atualizada com sucesso!");
      setEditingDealId(null);
      fetchLinkedDeals();
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar negociação.");
    } finally {
      setSavingDealId(null);
    }
  };

  // Desvincular conversa de um deal
  const handleUnlink = async (dealId: string) => {
    if (!confirm("Deseja realmente desvincular esta conversa da negociação?")) return;
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/conversations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      if (!res.ok) throw new Error("Falha ao desvincular conversa.");
      toast.success("Conversa desvinculada da negociação.");
      fetchLinkedDeals();
    } catch (e: any) {
      toast.error(e.message || "Erro ao desvincular.");
    }
  };

  // Buscar negociações existentes para vincular
  const handleSearchDeals = async () => {
    setSearchingDeals(true);
    try {
      const params = new URLSearchParams();
      if (searchDealsQuery.trim()) {
        params.set("search", searchDealsQuery.trim());
      }
      params.set("limit", "15");
      const res = await fetch(`/api/crm/deals?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const linkedIds = new Set(deals.map((d) => d.id));
        setAvailableDealsToLink((data.deals || []).filter((d: any) => !linkedIds.has(d.id)));
      }
    } catch (e) {
      console.error("[ConversationDealsPanel] Erro ao buscar deals existentes:", e);
    } finally {
      setSearchingDeals(false);
    }
  };

  // Vincular negociação existente com aviso preventivo de divergência de conta
  const handleLinkExistingDeal = async (dealItem: any) => {
    if (
      dealItem.accountId &&
      contactInfo?.accountId &&
      dealItem.accountId !== contactInfo.accountId
    ) {
      const dealAccName = dealItem.account?.name || "Empresa da Negociação";
      const contactAccName = contactInfo.accountName || "Empresa do Contato";
      const proceed = window.confirm(
        `Aviso preventivo:\nA negociação "${dealItem.title}" pertence à empresa "${dealAccName}", mas o contato deste atendimento está vinculado à empresa "${contactAccName}".\n\nDeseja confirmar o vínculo desta negociação mesmo com empresas diferentes?`
      );
      if (!proceed) return;
    }

    try {
      const res = await fetch(`/api/crm/deals/${dealItem.id}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, isPrimary: deals.length === 0 }),
      });
      if (!res.ok) throw new Error("Falha ao vincular conversa.");
      toast.success("Negociação vinculada com sucesso!");
      setIsLinkingOpen(false);
      setSearchDealsQuery("");
      fetchLinkedDeals();
    } catch (e: any) {
      toast.error(e.message || "Erro ao vincular.");
    }
  };

  // Helper para formatar e extrair valor de campo personalizado
  const getFieldValue = (customFields: Record<string, any> | undefined | null, field: CustomFieldDef): string | null => {
    if (!customFields || typeof customFields !== "object") return null;
    const val =
      customFields[field.id] !== undefined
        ? customFields[field.id]
        : customFields[field.name] !== undefined
        ? customFields[field.name]
        : customFields[field.name.toLowerCase()] !== undefined
        ? customFields[field.name.toLowerCase()]
        : undefined;

    if (val === undefined || val === null || val === "") return null;

    if (Array.isArray(val)) {
      if (val.length === 0) return null;
      return val
        .map((item) => {
          if (field.options && Array.isArray(field.options)) {
            const match = field.options.find(
              (o: any) =>
                (typeof o === "string" ? o : o.id || o.value) === item ||
                (typeof o === "string" ? o : o.label) === item
            );
            return match ? (typeof match === "string" ? match : String(match.label || match.value || item)) : String(item);
          }
          return String(item);
        })
        .join(", ");
    }

    if (field.options && Array.isArray(field.options)) {
      const match = field.options.find(
        (o: any) =>
          (typeof o === "string" ? o : o.id || o.value) === val ||
          (typeof o === "string" ? o : o.label) === val
      );
      if (match) {
        if (typeof match === "string") return match;
        const resolved = (match as any)?.label ?? (match as any)?.value ?? val;
        return resolved !== undefined && resolved !== null ? String(resolved) : null;
      }
    }

    return String(val);
  };

  // Status badge helper
  const renderStatusBadge = (status?: string | null) => {
    switch (status) {
      case "won":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="h-2.5 w-2.5" />
            Vendido
          </span>
        );
      case "lost":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] font-bold text-red-600 dark:text-red-400 border border-red-500/30">
            <XCircle className="h-2.5 w-2.5" />
            Perdido
          </span>
        );
      case "paused":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 border border-amber-500/30">
            <PauseCircle className="h-2.5 w-2.5" />
            Pausado
          </span>
        );
      case "open":
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[9px] font-semibold text-muted-foreground border border-border/70">
            <Activity className="h-2.5 w-2.5 text-primary" />
            Em andamento
          </span>
        );
    }
  };

  return (
    <div className="space-y-3 bg-muted/40 p-3.5 rounded-2xl border border-line animate-fade-in">
      {/* Cabeçalho Geral do Bloco */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Columns3 className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-bold text-foreground">Negociações CRM</span>
          <span className="flex h-4 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[9px] font-bold text-primary">
            {deals.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <SystemTooltip content="Vincular negociação existente">
            <button
              onClick={() => {
                handleSearchDeals();
                setIsLinkingOpen(true);
              }}
              aria-label="Vincular negociação existente"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground transition-colors cursor-pointer"
            >
              <Link2 className="h-3 w-3" />
            </button>
          </SystemTooltip>
          <SystemTooltip content="Criar nova negociação para este atendimento">
            <button
              onClick={() => setIsCreateOpen(true)}
              aria-label="Criar nova negociação para este atendimento"
              className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Lista de Cards Vinculados */}
      {loading ? (
        <div className="flex items-center justify-center py-5">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      ) : deals.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-[11px] text-muted-foreground/60 italic">
            Nenhuma negociação vinculada a esta conversa.
          </p>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline cursor-pointer"
          >
            <Plus className="h-3 w-3" />
            <span>Criar primeira negociação</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {deals.map((deal) => {
            const isEditing = editingDealId === deal.id;
            const isSaving = savingDealId === deal.id;
            const isExpanded = expandedDealIds.has(deal.id);

            const rawValue = deal.value !== null && deal.value !== undefined ? Number(deal.value) : null;
            const formattedValue =
              rawValue !== null && !isNaN(rawValue)
                ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(rawValue)
                : "Sem valor";

            // Coleta os campos personalizados que possuem valor preenchido e pertencem ao funil da negociação
            const filledCustomFields = customFieldDefinitions
              .filter(
                (def) =>
                  def.allPipelines ||
                  (deal.pipelineId && def.pipelineIds?.includes(deal.pipelineId))
              )
              .map((def) => {
                const val = getFieldValue(deal.customFields, def);
                return { def, value: val };
              })
              .filter((item) => item.value !== null);

            // Estágios do funil atualmente selecionado na edição
            const currentEditPipeline = pipelines.find((p) => p.id === editForm.pipelineId);
            const currentEditStages = currentEditPipeline?.stages || [];

            return (
              <div
                key={deal.id}
                className="group relative rounded-2xl border border-border/80 bg-card p-3 shadow-xs hover:border-primary/40 transition-all duration-150"
              >
                {isEditing ? (
                  /* ── MODO EDIÇÃO INLINE DO CARD ── */
                  <div className="space-y-3">
                    {/* Header da Edição */}
                    <div className="flex items-center justify-between border-b border-border/60 pb-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        <Pencil className="h-3.5 w-3.5 text-primary" />
                        <span>Editar Negociação</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <SystemTooltip content="Cancelar alterações">
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            disabled={isSaving}
                            className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </SystemTooltip>
                        <SystemTooltip content="Salvar alterações">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(deal.id)}
                            disabled={isSaving}
                            className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition cursor-pointer disabled:opacity-50"
                          >
                            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          </button>
                        </SystemTooltip>
                      </div>
                    </div>

                    {/* Formulário de Edição */}
                    <div className="space-y-2.5 text-xs">
                      {/* Título */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase">Título do Negócio</label>
                        <input
                          type="text"
                          value={editForm.title}
                          onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                          className="h-8 w-full rounded-lg border border-border bg-muted/20 px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Nome da oportunidade..."
                        />
                      </div>

                      {/* Valor */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase">Valor do Negócio (R$)</label>
                        <div className="relative">
                          <DollarSign className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                          <input
                            type="number"
                            step="any"
                            value={editForm.value}
                            onChange={(e) => setEditForm({ ...editForm, value: e.target.value })}
                            className="h-8 w-full rounded-lg border border-border bg-muted/20 pl-7 pr-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder="0,00"
                          />
                        </div>
                      </div>

                      {/* Funil e Etapa */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">Funil</label>
                          <Select
                            value={editForm.pipelineId}
                            onValueChange={(val) => handlePipelineChange(val)}
                          >
                            <SelectTrigger className="h-8 w-full bg-card text-xs">
                              <SelectValue placeholder="Selecione o funil..." />
                            </SelectTrigger>
                            <SelectContent>
                              {pipelines.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">Etapa</label>
                          <Select
                            value={editForm.stageId}
                            onValueChange={(val) => setEditForm({ ...editForm, stageId: val })}
                          >
                            <SelectTrigger className="h-8 w-full bg-card text-xs">
                              <SelectValue placeholder="Selecione a etapa..." />
                            </SelectTrigger>
                            <SelectContent>
                              {currentEditStages.map((s: any) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Status e Responsável */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">Status</label>
                          <Select
                            value={editForm.status}
                            onValueChange={(val: any) => setEditForm({ ...editForm, status: val })}
                          >
                            <SelectTrigger className="h-8 w-full bg-card text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Em andamento</SelectItem>
                              <SelectItem value="won">Vendido</SelectItem>
                              <SelectItem value="lost">Perdido</SelectItem>
                              <SelectItem value="paused">Pausado</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">Responsável</label>
                          <Select
                            value={editForm.operatorId}
                            onValueChange={(val) => setEditForm({ ...editForm, operatorId: val })}
                          >
                            <SelectTrigger className="h-8 w-full bg-card text-xs">
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Sem responsável</SelectItem>
                              {operators.map((op) => (
                                <SelectItem key={op.id} value={op.id}>
                                  {op.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Campos Personalizados do Tenant */}
                      {customFieldDefinitions.length > 0 && (
                        <div className="space-y-2 border-t border-border/60 pt-2.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                            Campos Personalizados
                          </span>

                          {customFieldDefinitions
                            .filter(
                              (def) =>
                                def.allPipelines ||
                                (editForm.pipelineId && def.pipelineIds?.includes(editForm.pipelineId))
                            )
                            .map((field) => {
                              const val =
                                editForm.customFields[field.id] ??
                                editForm.customFields[field.name] ??
                                "";
                              const options = (field.options as any[]) || [];

                              if (field.fieldType === "single" || field.fieldType === "multiple") {
                                return (
                                  <div key={field.id} className="space-y-1">
                                    <label className="text-[9px] font-bold text-muted-foreground uppercase">
                                      {field.name}
                                    </label>
                                    <Select
                                      value={val ? String(val) : "__none__"}
                                      onValueChange={(newVal) =>
                                        setEditForm((prev) => ({
                                          ...prev,
                                          customFields: {
                                            ...prev.customFields,
                                            [field.id]: newVal === "__none__" ? "" : newVal,
                                          },
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="h-8 w-full bg-card text-xs">
                                        <SelectValue placeholder="Selecione uma opção..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__none__">Não informado</SelectItem>
                                        {options.map((opt: any) => {
                                          const optId = typeof opt === "string" ? opt : opt.id || opt.value;
                                          const optLabel = typeof opt === "string" ? opt : opt.label || opt.value;
                                          if (!optId) return null;
                                          return (
                                            <SelectItem key={optId} value={optId}>
                                              {optLabel}
                                            </SelectItem>
                                          );
                                        })}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                );
                              }

                              if (field.fieldType === "date") {
                                return (
                                  <div key={field.id} className="space-y-1">
                                    <label className="text-[9px] font-bold text-muted-foreground uppercase">
                                      {field.name}
                                    </label>
                                    <input
                                      type="date"
                                      value={val || ""}
                                      onChange={(e) =>
                                        setEditForm((prev) => ({
                                          ...prev,
                                          customFields: { ...prev.customFields, [field.id]: e.target.value },
                                        }))
                                      }
                                      className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                  </div>
                                );
                              }

                              if (field.fieldType === "number") {
                                return (
                                  <div key={field.id} className="space-y-1">
                                    <label className="text-[9px] font-bold text-muted-foreground uppercase">
                                      {field.name}
                                    </label>
                                    <input
                                      type="number"
                                      step="any"
                                      value={val || ""}
                                      onChange={(e) =>
                                        setEditForm((prev) => ({
                                          ...prev,
                                          customFields: { ...prev.customFields, [field.id]: e.target.value },
                                        }))
                                      }
                                      className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                      placeholder="0"
                                    />
                                  </div>
                                );
                              }

                              return (
                                <div key={field.id} className="space-y-1">
                                  <label className="text-[9px] font-bold text-muted-foreground uppercase">
                                    {field.name}
                                  </label>
                                  <input
                                    type="text"
                                    value={val || ""}
                                    onChange={(e) =>
                                      setEditForm((prev) => ({
                                        ...prev,
                                        customFields: { ...prev.customFields, [field.id]: e.target.value },
                                      }))
                                    }
                                    className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    placeholder="Preencher campo..."
                                  />
                                </div>
                              );
                            })}
                        </div>
                      )}

                      {/* Botões de Ação na Edição */}
                      <div className="flex items-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={isSaving}
                          className="flex-1 h-8 rounded-xl border border-border text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(deal.id)}
                          disabled={isSaving}
                          className="flex-1 h-8 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          <span>Salvar</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── MODO VISUALIZAÇÃO DO CARD (ENRIQUECIDO E ELEGANTE) ── */
                  <div className="space-y-2.5">
                    {/* Linha Superior: Status, Rating e Ações */}
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {renderStatusBadge(deal.status)}

                        {/* Estrelas de Qualificação */}
                        {deal.rating > 0 && (
                          <div className="flex items-center gap-0.5">
                            {Array.from({ length: Math.min(deal.rating, 5) }).map((_, i) => (
                              <Star key={i} className="h-2.5 w-2.5 fill-primary text-primary" />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Barra de Ações Rápidas */}
                      <div className="flex items-center gap-1 shrink-0">
                        <SystemTooltip content="Editar informações deste card">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(deal)}
                            aria-label="Editar negociação"
                            className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </SystemTooltip>

                        <SystemTooltip content="Abrir negociação no CRM">
                          <button
                            type="button"
                            onClick={() =>
                              navigate({
                                to: "/crm/deals/$dealId",
                                params: { dealId: deal.id },
                                search: { from: "chat" },
                              })
                            }
                            aria-label="Abrir negociação no CRM"
                            className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-primary transition cursor-pointer"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        </SystemTooltip>

                        <SystemTooltip content="Desvincular negociação deste atendimento">
                          <button
                            type="button"
                            onClick={() => handleUnlink(deal.id)}
                            aria-label="Desvincular negociação"
                            className="p-1 rounded-lg text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10 transition cursor-pointer"
                          >
                            <Unlink className="h-3 w-3" />
                          </button>
                        </SystemTooltip>
                      </div>
                    </div>

                    {/* Título da Oportunidade */}
                    <div>
                      <h5
                        onClick={() =>
                          navigate({
                            to: "/crm/deals/$dealId",
                            params: { dealId: deal.id },
                            search: { from: "chat" },
                          })
                        }
                        className="text-xs font-bold text-foreground leading-snug hover:text-primary transition-colors cursor-pointer"
                      >
                        {deal.title}
                      </h5>
                    </div>

                    {/* Grade de Detalhes Básicos (Empresa, Valor, Funil/Etapa, Responsável) */}
                    <div className="grid grid-cols-2 gap-2 bg-muted/30 p-2.5 rounded-xl border border-border/50 text-[11px]">
                      {/* Empresa */}
                      <div className="space-y-0.5 min-w-0">
                        <span className="text-[9px] text-muted-foreground uppercase font-bold flex items-center gap-1">
                          <Building2 className="h-2.5 w-2.5 shrink-0" />
                          Empresa
                        </span>
                        <SystemTooltip content={deal.accountName || "Sem empresa associada"}>
                          <span className="text-xs font-semibold text-foreground truncate block cursor-default">
                            {deal.accountName || "Sem empresa"}
                          </span>
                        </SystemTooltip>
                      </div>

                      {/* Valor */}
                      <div className="space-y-0.5">
                        <span className="text-[9px] text-muted-foreground uppercase font-bold flex items-center gap-1">
                          <DollarSign className="h-2.5 w-2.5 shrink-0 text-primary" />
                          Valor
                        </span>
                        <span className="text-xs font-bold text-primary block">
                          {formattedValue}
                        </span>
                      </div>

                      {/* Funil e Etapa */}
                      <div className="space-y-0.5 min-w-0 col-span-2 border-t border-border/40 pt-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold">
                            Funil & Etapa
                          </span>
                          <span className="text-[10px] font-semibold text-foreground truncate">
                            {deal.pipelineName || "Funil Padrão"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: deal.stageColor || "var(--primary)" }}
                          />
                          <span className="text-xs font-medium text-foreground truncate">
                            {deal.stageName || "Etapa inicial"}
                          </span>
                        </div>
                      </div>

                      {/* Responsável */}
                      {deal.operatorName && (
                        <div className="space-y-0.5 min-w-0 col-span-2 border-t border-border/40 pt-1.5 flex items-center justify-between text-[10px]">
                          <span className="text-muted-foreground flex items-center gap-1 font-semibold">
                            <User className="h-2.5 w-2.5 shrink-0" />
                            Responsável:
                          </span>
                          <span className="font-bold text-foreground truncate">
                            {deal.operatorName}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Campos Personalizados (Estilo RD CRM, Enxuto e Detalhado) */}
                    {filledCustomFields.length > 0 ? (
                      <div className="border-t border-border/50 pt-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                            Campos Personalizados ({filledCustomFields.length})
                          </span>
                          {filledCustomFields.length > 2 && (
                            <button
                              type="button"
                              onClick={() => toggleExpand(deal.id)}
                              className="inline-flex items-center gap-0.5 text-[10px] font-bold text-primary hover:underline cursor-pointer"
                            >
                              <span>{isExpanded ? "Recolher" : `Ver mais (${filledCustomFields.length - 2})`}</span>
                              {isExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                            </button>
                          )}
                        </div>

                        {/* Listagem dos Campos Preenchidos */}
                        <div className="space-y-1">
                          {(isExpanded ? filledCustomFields : filledCustomFields.slice(0, 2)).map(
                            ({ def, value }) => (
                              <div
                                key={def.id}
                                className="flex items-start justify-between gap-2 text-[10px] py-0.5 border-b border-border/30 last:border-0"
                              >
                                <span className="text-muted-foreground font-semibold shrink-0">
                                  {def.name}:
                                </span>
                                <SystemTooltip content={value || ""}>
                                  <span className="font-bold text-foreground text-right truncate max-w-[65%] cursor-default">
                                    {value}
                                  </span>
                                </SystemTooltip>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="border-t border-border/40 pt-1 flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground/60 italic">Nenhum campo personalizado</span>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(deal)}
                          className="font-bold text-primary hover:underline cursor-pointer"
                        >
                          + Preencher
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para Vincular Negociação Existente */}
      {isLinkingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-2xl animate-in fade-in">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h4 className="text-xs font-bold text-foreground">Vincular Negociação Existente</h4>
              <button
                onClick={() => setIsLinkingOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>

            <div className="my-3 flex gap-2">
              <input
                type="text"
                placeholder="Buscar negociação por título..."
                value={searchDealsQuery}
                onChange={(e) => setSearchDealsQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearchDeals()}
                className="h-8 flex-1 rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={handleSearchDeals}
                className="h-8 px-3 rounded-xl bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
              >
                Buscar
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {searchingDeals ? (
                <div className="py-6 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                </div>
              ) : availableDealsToLink.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground/60 italic">
                  Nenhuma negociação disponível para vincular.
                </p>
              ) : (
                availableDealsToLink.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between p-2 rounded-xl border border-border/60 hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-bold text-foreground truncate">{d.title}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {d.account?.name && (
                          <SystemTooltip content={`Empresa: ${d.account.name}`}>
                            <span className="inline-flex items-center gap-1 text-[10px] text-primary font-medium truncate max-w-[140px] cursor-default">
                              <Building2 className="h-3 w-3 shrink-0" />
                              <span className="truncate">{d.account.name}</span>
                            </span>
                          </SystemTooltip>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {d.value ? `R$ ${Number(d.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "Sem valor"}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleLinkExistingDeal(d)}
                      className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer shrink-0"
                    >
                      <Check className="h-3 w-3" />
                      <span>Vincular</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Criação de Negociação a partir do Chat */}
      <CreateDealDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={(newDeal, createAnother) => {
          fetchLinkedDeals();
          if (!createAnother) {
            navigate({
              to: "/crm/deals/$dealId",
              params: { dealId: newDeal.id },
              search: { from: "chat" },
            });
          }
        }}
        pipelines={pipelines}
        operators={operators}
        defaultContactId={contactId}
        defaultConversationId={conversationId}
        defaultAccountName={customerName}
        currentOperatorId={currentOperatorId}
      />
    </div>
  );
}
