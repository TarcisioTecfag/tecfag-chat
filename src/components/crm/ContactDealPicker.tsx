import React, { useEffect, useState, useMemo } from "react";
import type { ContactDealInput } from "@/lib/crm/contact-deal-input";
import type { LinkedDealSummary } from "./PhoneContactSuggestions";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { DealStatusBadge, DEAL_STATUS_OPTIONS } from "./deal-status-config";
import { formatPhoneNumber, formatCNPJ, formatCPF } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Columns3,
  Search,
  Plus,
  Link2,
  Building2,
  User,
  DollarSign,
  Calendar,
  CheckCircle2,
  Star,
  Loader2,
  X,
  Phone,
  Mail,
  Sparkles,
  ArrowRight,
  Clock,
  FileText,
  Layers,
  Eye,
  AlertCircle,
} from "lucide-react";

export interface DealPreviewItem {
  id: string;
  title: string;
  status?: string | null;
  value?: number | string | null;
  currency?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  operatorId?: string | null;
  accountId?: string | null;
  account?: {
    id: string;
    name: string;
    tradeName?: string | null;
    document?: string | null;
    type?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  rating?: number | null;
  source?: string | null;
  campaign?: string | null;
  expectedCloseDate?: string | null;
  lastActivityAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  contactsCount?: number;
  conversationsCount?: number;
  nextTask?: {
    id: string;
    title: string;
    type: string;
    dueDate: string | null;
    isOverdue?: boolean;
    responsibleName?: string | null;
  } | null;
}

export interface PipelineOption {
  id: string;
  name: string;
  isDefault?: boolean;
  stages: Array<{
    id: string;
    name: string;
    orderIndex?: number;
    requiredFields?: string[];
  }>;
}

export interface ContactDealContext {
  id?: string | null;
  name?: string;
  phone?: string | null;
  email?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  isExisting?: boolean;
  linkedDeals?: LinkedDealSummary[];
}

export function isContactDealInputComplete(value?: ContactDealInput | null): boolean {
  if (!value) return false;
  if (typeof value.dealId === "string" && value.dealId.trim().length > 0 && !value.newDeal) {
    return true;
  }
  if (
    value.newDeal &&
    typeof value.newDeal.title === "string" &&
    value.newDeal.title.trim().length > 0 &&
    typeof value.newDeal.pipelineId === "string" &&
    value.newDeal.pipelineId.trim().length > 0 &&
    typeof value.newDeal.stageId === "string" &&
    value.newDeal.stageId.trim().length > 0
  ) {
    return true;
  }
  return false;
}

function formatCurrencyBRL(value?: number | string | null): string {
  if (value === null || value === undefined || value === "") return "Sem valor";
  const num = Number(value);
  if (Number.isNaN(num)) return "Sem valor";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

function formatDateShort(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDoc(doc?: string | null, type?: string | null): string | null {
  if (!doc) return null;
  const digits = doc.replace(/\D/g, "");
  if (digits.length === 14 || type === "company") return formatCNPJ(digits);
  if (digits.length === 11 || type === "person") return formatCPF(digits);
  return doc;
}

/**
 * Modal detalhado para buscar, visualizar preview e vincular/criar negociação
 * antes de salvar um contato ou iniciar um atendimento.
 */
export function ContactDealModal({
  isOpen,
  onClose,
  value,
  onChange,
  onConfirm,
  confirmLabel = "Confirmar Negociação",
  saving = false,
  contactContext,
}: {
  isOpen: boolean;
  onClose: () => void;
  value: ContactDealInput;
  onChange: (value: ContactDealInput, selectedDealMeta?: DealPreviewItem | null) => void;
  onConfirm?: (value: ContactDealInput, selectedDealMeta?: DealPreviewItem | null) => void;
  confirmLabel?: string;
  saving?: boolean;
  contactContext?: ContactDealContext;
}) {
  const [mode, setMode] = useState<"existing" | "new">(value.newDeal ? "new" : "existing");
  const [search, setSearch] = useState("");
  const [pipelineFilter, setPipelineFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [deals, setDeals] = useState<DealPreviewItem[]>([]);
  const [contactLinkedDeals, setContactLinkedDeals] = useState<DealPreviewItem[]>([]);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([]);

  const [loadingDeals, setLoadingDeals] = useState(false);
  const [loadingContactDeals, setLoadingContactDeals] = useState(false);
  const [error, setError] = useState("");

  // Card atualmente inspecionado na coluna de Preview
  const [inspectedDealId, setInspectedDealId] = useState<string>(value.dealId || "");
  const [detailedDeal, setDetailedDeal] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Sincroniza modo quando abre o modal
  useEffect(() => {
    if (!isOpen) return;
    if (value.newDeal) {
      setMode("new");
    } else {
      setMode("existing");
      if (value.dealId) {
        setInspectedDealId(value.dealId);
      }
    }
  }, [isOpen]);

  // Carrega funis e operadores ao abrir
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();

    fetch("/api/crm/pipelines", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { pipelines: [] }))
      .then((data) => {
        if (!controller.signal.aborted) {
          setPipelines(Array.isArray(data?.pipelines) ? data.pipelines : []);
        }
      })
      .catch(() => {});

    fetch("/api/operators", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { operators: [] }))
      .then((data) => {
        if (!controller.signal.aborted) {
          const list = Array.isArray(data)
            ? data
            : Array.isArray(data?.operators)
              ? data.operators
              : [];
          setOperators(list);
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, [isOpen]);

  // Carrega as negociações que JÁ estão vinculadas ao contato (ou empresa/telefone do contato)
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const contactId = contactContext?.id?.trim();
    const accountId = contactContext?.accountId?.trim();
    const contactPhone = (contactContext?.phone || "").replace(/\D/g, "");
    const contactName = (contactContext?.name || "").trim();

    if (!contactId && !accountId && contactPhone.length < 8 && contactName.length < 3) {
      setContactLinkedDeals([]);
      return;
    }

    setLoadingContactDeals(true);
    (async () => {
      try {
        const collected: DealPreviewItem[] = [];
        const seen = new Set<string>();

        if (contactId) {
          const res = await fetch(
            `/api/crm/deals?contactId=${encodeURIComponent(contactId)}&limit=15`,
            { signal: controller.signal }
          );
          if (res.ok) {
            const data = await res.json();
            for (const d of data.deals || []) {
              if (!seen.has(d.id)) {
                seen.add(d.id);
                collected.push(d);
              }
            }
          }
        }

        if (accountId && collected.length < 10) {
          const res = await fetch(
            `/api/crm/deals?accountId=${encodeURIComponent(accountId)}&limit=10`,
            { signal: controller.signal }
          );
          if (res.ok) {
            const data = await res.json();
            for (const d of data.deals || []) {
              if (!seen.has(d.id)) {
                seen.add(d.id);
                collected.push(d);
              }
            }
          }
        }

        // Se é um contato novo mas informou telefone ou nome, busca cards com esse telefone/nome como sugestão
        if (!contactId && collected.length === 0 && (contactPhone.length >= 8 || contactName.length >= 3)) {
          const term = contactPhone.length >= 8 ? contactPhone.slice(-8) : contactName;
          const res = await fetch(
            `/api/crm/deals?search=${encodeURIComponent(term)}&limit=8`,
            { signal: controller.signal }
          );
          if (res.ok) {
            const data = await res.json();
            for (const d of data.deals || []) {
              if (!seen.has(d.id)) {
                seen.add(d.id);
                collected.push(d);
              }
            }
          }
        }

        if (!controller.signal.aborted) {
          setContactLinkedDeals(collected);
          // Se ainda não há um card selecionado e existem cards vinculados ao contato, pré-seleciona o primeiro
          if (collected.length > 0 && !value.dealId && !value.newDeal) {
            const first = collected[0];
            setInspectedDealId(first.id);
            onChange({ dealId: first.id }, first);
          }
        }
      } catch {
        // Silencioso
      } finally {
        if (!controller.signal.aborted) setLoadingContactDeals(false);
      }
    })();

    return () => controller.abort();
  }, [
    isOpen,
    contactContext?.id,
    contactContext?.accountId,
    contactContext?.phone,
    contactContext?.name,
  ]);

  // Busca de negociações conforme filtros e pesquisa
  useEffect(() => {
    if (!isOpen || mode !== "existing") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingDeals(true);
      setError("");
      try {
        const params = new URLSearchParams({ limit: "30" });
        if (search.trim()) params.set("search", search.trim());
        if (pipelineFilter && pipelineFilter !== "all") params.set("pipelineId", pipelineFilter);
        if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);

        const response = await fetch(`/api/crm/deals?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            data.error ||
              "Não foi possível carregar negociações. Verifique sua permissão com um administrador."
          );
        }
        if (!controller.signal.aborted) {
          const list: DealPreviewItem[] = Array.isArray(data.deals) ? data.deals : [];
          setDeals(list);
          if (!inspectedDealId && list.length > 0 && contactLinkedDeals.length === 0) {
            setInspectedDealId(list[0].id);
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Falha ao carregar opções.");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingDeals(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [isOpen, mode, search, pipelineFilter, statusFilter]);

  // Carrega detalhes completos da negociação inspecionada para a Preview
  useEffect(() => {
    if (!isOpen || mode !== "existing" || !inspectedDealId) {
      setDetailedDeal(null);
      return;
    }
    const controller = new AbortController();
    setLoadingDetail(true);
    fetch(`/api/crm/deals/${encodeURIComponent(inspectedDealId)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!controller.signal.aborted && data?.deal) {
          setDetailedDeal(data.deal);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDetail(false);
      });

    return () => controller.abort();
  }, [isOpen, mode, inspectedDealId]);

  const linkedIdsSet = useMemo(
    () => new Set(contactLinkedDeals.map((d) => d.id)),
    [contactLinkedDeals]
  );

  // Filtra a lista geral para não duplicar os cards que já aparecem na seção superior (quando sem busca ativa)
  const searchResultDeals = useMemo(() => {
    if (search.trim()) return deals;
    return deals.filter((d) => !linkedIdsSet.has(d.id));
  }, [deals, linkedIdsSet, search]);

  const inspectedBaseDeal = useMemo(() => {
    if (!inspectedDealId) return null;
    return (
      contactLinkedDeals.find((d) => d.id === inspectedDealId) ||
      deals.find((d) => d.id === inspectedDealId) ||
      (detailedDeal?.id === inspectedDealId ? detailedDeal : null)
    );
  }, [inspectedDealId, contactLinkedDeals, deals, detailedDeal]);

  const activePreviewDeal = detailedDeal?.id === inspectedDealId ? detailedDeal : inspectedBaseDeal;

  const getPipelineAndStage = (pipelineId?: string | null, stageId?: string | null) => {
    const pipeline = pipelines.find((p) => p.id === pipelineId);
    const stage = pipeline?.stages?.find((s) => s.id === stageId);
    return {
      pipelineName: pipeline?.name || "Funil Comercial",
      stageName: stage?.name || "Etapa Inicial",
      stages: pipeline?.stages || [],
      stageIndex: pipeline?.stages ? pipeline.stages.findIndex((s) => s.id === stageId) : -1,
    };
  };

  const getOperatorName = (operatorId?: string | null) => {
    if (!operatorId) return "Sem responsável";
    return operators.find((o) => o.id === operatorId)?.name || "Consultor atribuído";
  };

  const draft = value.newDeal || { title: "", pipelineId: "", stageId: "" };
  const currentDraftPipeline = pipelines.find((p) => p.id === draft.pipelineId);
  const draftStages = currentDraftPipeline?.stages || [];

  const handleSelectDealItem = (deal: DealPreviewItem) => {
    setInspectedDealId(deal.id);
    onChange({ dealId: deal.id }, deal);
  };

  const handleSwitchToNew = () => {
    setMode("new");
    const defaultPipeline = pipelines.find((p) => p.isDefault) || pipelines[0];
    const defaultStage = defaultPipeline?.stages?.[0];
    const suggestedTitle =
      contactContext?.accountName?.trim() || contactContext?.name?.trim() || "";
    onChange(
      {
        newDeal: {
          title: draft.title || suggestedTitle,
          pipelineId: draft.pipelineId || defaultPipeline?.id || "",
          stageId: draft.stageId || defaultStage?.id || "",
          customFields: draft.customFields || {},
        },
      },
      null
    );
  };

  const handleConfirm = () => {
    if (mode === "existing") {
      const chosenId = value.dealId || inspectedDealId;
      if (!chosenId) {
        setError("Selecione uma negociação na lista para continuar.");
        return;
      }
      const chosenMeta =
        contactLinkedDeals.find((d) => d.id === chosenId) ||
        deals.find((d) => d.id === chosenId) ||
        activePreviewDeal ||
        null;
      const nextVal: ContactDealInput = { dealId: chosenId };
      onChange(nextVal, chosenMeta);
      if (onConfirm) onConfirm(nextVal, chosenMeta);
      else onClose();
    } else {
      if (!draft.title.trim()) {
        setError("Informe o título da nova negociação.");
        return;
      }
      if (!draft.pipelineId) {
        setError("Selecione o funil da nova negociação.");
        return;
      }
      if (!draft.stageId) {
        setError("Selecione a etapa da nova negociação.");
        return;
      }
      setError("");
      if (onConfirm) onConfirm(value, null);
      else onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/65 backdrop-blur-xs p-3 sm:p-5 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Vincular negociação ao contato e atendimento"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl"
      >
        {/* ── HEADER DO MODAL ── */}
        <div className="flex flex-col gap-3 border-b border-border bg-muted/25 px-6 py-4 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary border border-primary/25 shadow-2xs">
                <Columns3 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-extrabold text-foreground leading-tight">
                  Vincular Negociação ao Atendimento
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Confira as negociações já vinculadas ao contato, pesquise um card com visualização detalhada ou crie uma oportunidade.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Barra de Contexto do Contato + Abas de Modo */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {/* Pílula de Contexto do Contato */}
            {contactContext && (contactContext.name || contactContext.phone) ? (
              <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs shadow-2xs max-w-full">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    contactContext.isExisting ? "bg-emerald-500" : "bg-primary"
                  }`}
                />
                <span className="font-bold text-foreground truncate max-w-[180px]">
                  {contactContext.name || "Contato"}
                </span>
                {contactContext.phone && (
                  <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                    {formatPhoneNumber(contactContext.phone)}
                  </span>
                )}
                {contactContext.accountName && (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground/80 truncate max-w-[150px]">
                    <Building2 className="h-2.5 w-2.5 text-primary shrink-0" />
                    <span className="truncate">{contactContext.accountName}</span>
                  </span>
                )}
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
                    contactContext.isExisting
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  {contactContext.isExisting ? "Contato Existente" : "Novo Contato"}
                </span>
              </div>
            ) : (
              <div />
            )}

            {/* Segmented Control: Vincular Existente vs Criar Nova */}
            <div className="inline-flex rounded-xl border border-border bg-card p-1 shadow-2xs">
              <button
                type="button"
                aria-pressed={mode === "existing"}
                onClick={() => {
                  setMode("existing");
                  setError("");
                  if (inspectedDealId) {
                    onChange({ dealId: inspectedDealId }, activePreviewDeal);
                  } else {
                    onChange({});
                  }
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                  mode === "existing"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>Vincular existente</span>
                {contactLinkedDeals.length > 0 && (
                  <span
                    className={`ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-extrabold ${
                      mode === "existing"
                        ? "bg-white/20 text-primary-foreground"
                        : "bg-primary/15 text-primary"
                    }`}
                  >
                    {contactLinkedDeals.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                aria-pressed={mode === "new"}
                onClick={handleSwitchToNew}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                  mode === "new"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Criar nova negociação</span>
              </button>
            </div>
          </div>
        </div>

        {/* Alerta de Erro */}
        {error && (
          <div
            role="alert"
            className="mx-6 mt-3 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs font-semibold text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── CORPO DO MODAL ── */}
        {mode === "existing" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Barra de Pesquisa e Filtros com Selects Estilizados */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 border-b border-border bg-card px-6 py-3 shrink-0">
              <div className="relative sm:col-span-6">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  aria-label="Buscar negociação"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por título, empresa, CNPJ, contato ou telefone..."
                  className="h-9 w-full rounded-xl border border-border bg-muted/35 pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Filtro por Funil (Radix Select estilizado) */}
              <div className="sm:col-span-3">
                <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
                  <SelectTrigger className="h-9 w-full rounded-xl border-border bg-muted/35 text-xs">
                    <SelectValue placeholder="Todos os funis" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      Todos os funis
                    </SelectItem>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro por Status (Radix Select estilizado) */}
              <div className="sm:col-span-3">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 w-full rounded-xl border-border bg-muted/35 text-xs">
                    <SelectValue placeholder="Todos os status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      Todos os status
                    </SelectItem>
                    {DEAL_STATUS_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <Icon className={`h-3.5 w-3.5 ${opt.iconColor}`} />
                            <span>{opt.label}</span>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Painel Master-Detail (Lista à Esquerda + Preview Detalhado à Direita) */}
            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-border overflow-hidden">
              {/* COLUNA ESQUERDA: Cards Vinculados + Resultados da Busca */}
              <div className="md:col-span-5 overflow-y-auto p-4 space-y-4 scrollbar-thin bg-muted/10">
                {/* Seção 1: Cards que JÁ possuem este contato / empresa vinculada */}
                {(loadingContactDeals || contactLinkedDeals.length > 0) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        <Sparkles className="h-3 w-3" />
                        {contactContext?.id
                          ? "Cards já vinculados a este contato"
                          : "Cards encontrados para este contato"}
                      </span>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-400">
                        {contactLinkedDeals.length}
                      </span>
                    </div>

                    {loadingContactDeals ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span>Verificando cards do contato...</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {contactLinkedDeals.map((deal) => {
                          const isSelected =
                            (value.dealId || inspectedDealId) === deal.id;
                          const { pipelineName, stageName } = getPipelineAndStage(
                            deal.pipelineId,
                            deal.stageId
                          );

                          return (
                            <button
                              key={`linked-${deal.id}`}
                              type="button"
                              onClick={() => handleSelectDealItem(deal)}
                              className={`w-full rounded-2xl border p-3 text-left transition-all cursor-pointer ${
                                isSelected
                                  ? "border-primary bg-primary/[0.06] ring-2 ring-primary/25 shadow-sm"
                                  : "border-emerald-500/35 bg-emerald-500/[0.04] hover:border-primary/50 hover:bg-card"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-extrabold text-xs text-foreground line-clamp-1">
                                  {deal.title}
                                </span>
                                <DealStatusBadge
                                  status={deal.status}
                                  size="xs"
                                  className="rounded-full shrink-0"
                                />
                              </div>

                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-emerald-700 dark:text-emerald-400">
                                  <CheckCircle2 className="h-2.5 w-2.5" />
                                  {contactContext?.id ? "Já vinculado" : "Sugerido"}
                                </span>
                                <span className="text-[10px] font-semibold text-muted-foreground truncate">
                                  {pipelineName} • {stageName}
                                </span>
                              </div>

                              <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/50 pt-1.5 text-[11px]">
                                <span className="inline-flex items-center gap-1 text-muted-foreground truncate">
                                  <Building2 className="h-3 w-3 text-primary shrink-0" />
                                  <span className="truncate">
                                    {deal.account?.name || "Sem empresa"}
                                  </span>
                                </span>
                                <span className="font-bold text-primary shrink-0">
                                  {formatCurrencyBRL(deal.value)}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Seção 2: Resultados da Busca / Outras Negociações */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      {search.trim()
                        ? `Resultados da busca por "${search.trim()}"`
                        : "Todas as negociações disponíveis"}
                    </span>
                    <span className="text-[10px] font-bold text-muted-foreground">
                      {searchResultDeals.length} {searchResultDeals.length === 1 ? "card" : "cards"}
                    </span>
                  </div>

                  {loadingDeals ? (
                    <div className="flex flex-col items-center justify-center py-10 text-xs text-muted-foreground gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <span>Buscando negociações...</span>
                    </div>
                  ) : searchResultDeals.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-6 text-center space-y-2">
                      <p className="text-xs font-bold text-foreground">
                        Nenhuma outra negociação encontrada
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Altere os termos da pesquisa ou crie uma nova negociação para este contato.
                      </p>
                      <button
                        type="button"
                        onClick={handleSwitchToNew}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Criar nova negociação</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {searchResultDeals.map((deal) => {
                        const isSelected =
                          (value.dealId || inspectedDealId) === deal.id;
                        const isAlreadyLinked = linkedIdsSet.has(deal.id);
                        const { pipelineName, stageName } = getPipelineAndStage(
                          deal.pipelineId,
                          deal.stageId
                        );

                        return (
                          <button
                            key={deal.id}
                            type="button"
                            onClick={() => handleSelectDealItem(deal)}
                            className={`w-full rounded-2xl border p-3 text-left transition-all cursor-pointer ${
                              isSelected
                                ? "border-primary bg-primary/[0.06] ring-2 ring-primary/25 shadow-sm"
                                : "border-border/80 bg-card hover:border-primary/40 hover:bg-muted/20"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-bold text-xs text-foreground line-clamp-1">
                                {deal.title}
                              </span>
                              <DealStatusBadge
                                status={deal.status}
                                size="xs"
                                className="rounded-full shrink-0"
                              />
                            </div>

                            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              {isAlreadyLinked && (
                                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:text-emerald-400">
                                  Já vinculado
                                </span>
                              )}
                              <span className="truncate font-medium">
                                {pipelineName} • <strong className="text-foreground/85">{stageName}</strong>
                              </span>
                            </div>

                            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 text-[11px]">
                              <span className="inline-flex items-center gap-1 text-muted-foreground truncate">
                                <Building2 className="h-3 w-3 shrink-0 opacity-75" />
                                <span className="truncate">
                                  {deal.account?.name || "Sem empresa"}
                                </span>
                              </span>
                              <span className="font-bold text-primary shrink-0">
                                {formatCurrencyBRL(deal.value)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* COLUNA DIREITA: Preview Detalhada do Card Procurado / Selecionado */}
              <div className="md:col-span-7 overflow-y-auto p-5 bg-card scrollbar-thin">
                {activePreviewDeal ? (
                  (() => {
                    const { pipelineName, stageName, stages, stageIndex } =
                      getPipelineAndStage(
                        activePreviewDeal.pipelineId,
                        activePreviewDeal.stageId
                      );
                    const isAlreadyLinked = linkedIdsSet.has(activePreviewDeal.id);
                    const accountObj = activePreviewDeal.account;
                    const formattedDoc = formatDoc(
                      accountObj?.document,
                      accountObj?.type
                    );
                    const dealContacts: any[] = Array.isArray(detailedDeal?.contacts)
                      ? detailedDeal.contacts
                      : [];
                    const dealProducts: any[] = Array.isArray(detailedDeal?.products)
                      ? detailedDeal.products
                      : [];

                    return (
                      <div className="space-y-4 animate-in fade-in duration-150">
                        {/* Cabeçalho da Preview */}
                        <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-primary">
                                <Eye className="h-3 w-3" />
                                Preview do Card
                              </span>
                              <DealStatusBadge
                                status={activePreviewDeal.status}
                                size="xs"
                                className="rounded-full"
                              />
                              {isAlreadyLinked && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-400">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Já vinculado a este contato
                                </span>
                              )}
                            </div>

                            {Number(activePreviewDeal.rating) > 0 && (
                              <div className="flex items-center gap-0.5">
                                {Array.from({
                                  length: Math.min(Number(activePreviewDeal.rating), 5),
                                }).map((_, idx) => (
                                  <Star
                                    key={idx}
                                    className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
                                  />
                                ))}
                              </div>
                            )}
                          </div>

                          <div>
                            <h4 className="text-base font-extrabold text-foreground leading-snug">
                              {activePreviewDeal.title}
                            </h4>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Criada em {formatDateShort(activePreviewDeal.createdAt)} • Última atualização em{" "}
                              {formatDateShort(
                                activePreviewDeal.lastActivityAt || activePreviewDeal.updatedAt
                              )}
                            </p>
                          </div>

                          {/* Barra de Progresso do Funil e Etapa */}
                          <div className="rounded-xl border border-border/80 bg-card p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-muted-foreground flex items-center gap-1.5">
                                <Layers className="h-3.5 w-3.5 text-primary" />
                                {pipelineName}
                              </span>
                              <span className="rounded-lg bg-primary/10 px-2.5 py-0.5 text-xs font-extrabold text-primary">
                                Etapa: {stageName}
                              </span>
                            </div>

                            {stages.length > 0 && (
                              <div className="grid grid-cols-5 sm:grid-cols-6 gap-1 pt-1">
                                {stages.map((st, idx) => {
                                  const isPassedOrCurrent =
                                    stageIndex >= 0 && idx <= stageIndex;
                                  const isCurrent = idx === stageIndex;
                                  return (
                                    <div key={st.id} className="space-y-1 min-w-0">
                                      <div
                                        className={`h-1.5 w-full rounded-full transition-colors ${
                                          isCurrent
                                            ? "bg-primary"
                                            : isPassedOrCurrent
                                              ? "bg-primary/45"
                                              : "bg-muted"
                                        }`}
                                      />
                                      <span
                                        className={`block truncate text-[9px] ${
                                          isCurrent
                                            ? "font-extrabold text-primary"
                                            : "font-medium text-muted-foreground"
                                        }`}
                                        title={st.name}
                                      >
                                        {st.name}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Grade de Informações Comerciais da Negociação */}
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {/* Valor */}
                          <div className="rounded-2xl border border-border bg-card p-3 space-y-1">
                            <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase text-muted-foreground">
                              <DollarSign className="h-3.5 w-3.5 text-primary" />
                              Valor da Negociação
                            </span>
                            <p className="text-sm font-extrabold text-primary">
                              {formatCurrencyBRL(activePreviewDeal.value)}
                            </p>
                            {activePreviewDeal.expectedCloseDate && (
                              <p className="text-[10px] text-muted-foreground">
                                Previsão: {formatDateShort(activePreviewDeal.expectedCloseDate)}
                              </p>
                            )}
                          </div>

                          {/* Responsável */}
                          <div className="rounded-2xl border border-border bg-card p-3 space-y-1">
                            <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase text-muted-foreground">
                              <User className="h-3.5 w-3.5 text-primary" />
                              Responsável Comercial
                            </span>
                            <p className="text-xs font-extrabold text-foreground truncate">
                              {getOperatorName(activePreviewDeal.operatorId)}
                            </p>
                            {(activePreviewDeal.source || activePreviewDeal.campaign) && (
                              <p className="text-[10px] text-muted-foreground truncate">
                                Origem: {activePreviewDeal.source || "Direto"}
                                {activePreviewDeal.campaign ? ` • ${activePreviewDeal.campaign}` : ""}
                              </p>
                            )}
                          </div>

                          {/* Empresa Vinculada */}
                          <div className="col-span-2 rounded-2xl border border-border bg-card p-3 space-y-1">
                            <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase text-muted-foreground">
                              <Building2 className="h-3.5 w-3.5 text-primary" />
                              Empresa / Cliente Vinculado ao Card
                            </span>
                            {accountObj ? (
                              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                                <div>
                                  <p className="text-xs font-extrabold text-foreground">
                                    {accountObj.name}
                                  </p>
                                  {accountObj.tradeName && (
                                    <p className="text-[11px] text-muted-foreground">
                                      Fantasia: {accountObj.tradeName}
                                    </p>
                                  )}
                                </div>
                                {formattedDoc && (
                                  <span className="rounded-lg bg-muted px-2.5 py-1 font-mono text-[11px] font-bold text-foreground">
                                    {formattedDoc}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs italic text-muted-foreground">
                                Nenhuma empresa associada a este card
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Próxima Tarefa / Atividade Pendente */}
                        {activePreviewDeal.nextTask && (
                          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-3 flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                              <div className="min-w-0">
                                <span className="block text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-400">
                                  Próxima Tarefa Pendente
                                </span>
                                <span className="block font-bold text-foreground truncate">
                                  {activePreviewDeal.nextTask.title}
                                </span>
                              </div>
                            </div>
                            {activePreviewDeal.nextTask.dueDate && (
                              <span className="shrink-0 rounded-lg bg-card border border-border px-2 py-1 text-[10px] font-bold text-foreground">
                                {formatDateShort(activePreviewDeal.nextTask.dueDate)}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Contatos Participantes já vinculados a este Card */}
                        <div className="rounded-2xl border border-border bg-card p-3.5 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                              Contatos Participantes deste Card (
                              {dealContacts.length || activePreviewDeal.contactsCount || 0})
                            </span>
                            {loadingDetail && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                Atualizando detalhes...
                              </span>
                            )}
                          </div>

                          {dealContacts.length > 0 ? (
                            <div className="space-y-1.5">
                              {dealContacts.map((dc: any) => {
                                const c = dc.contact || {};
                                const isCurrentContact =
                                  contactContext?.id && c.id === contactContext.id;
                                return (
                                  <div
                                    key={dc.id || dc.contactId}
                                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                                      isCurrentContact
                                        ? "border-emerald-500/40 bg-emerald-500/[0.06]"
                                        : "border-border/60 bg-muted/20"
                                    }`}
                                  >
                                    <div className="min-w-0 space-y-0.5">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="font-bold text-foreground truncate">
                                          {c.name || "Contato"}
                                        </span>
                                        {dc.isPrimary && (
                                          <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                                            <Star className="h-2.5 w-2.5 fill-primary text-primary" />
                                            Principal
                                          </span>
                                        )}
                                        {isCurrentContact && (
                                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-700 dark:text-emerald-300">
                                            Este contato
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                                        {c.phone && (
                                          <span className="font-mono">
                                            {formatPhoneNumber(c.phone)}
                                          </span>
                                        )}
                                        {c.email && (
                                          <span className="truncate max-w-[160px]">{c.email}</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">
                              {loadingDetail
                                ? "Carregando contatos vinculados..."
                                : "Ao confirmar, este contato será vinculado automaticamente como participante deste card."}
                            </p>
                          )}
                        </div>

                        {/* Produtos vinculados (se houver) */}
                        {dealProducts.length > 0 && (
                          <div className="rounded-2xl border border-border bg-card p-3.5 space-y-2">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                              Produtos / Equipamentos ({dealProducts.length})
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {dealProducts.map((prod: any) => (
                                <span
                                  key={prod.id}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1 text-xs font-semibold text-foreground"
                                >
                                  <FileText className="h-3 w-3 text-primary" />
                                  <span>{prod.name || prod.productName || "Produto"}</span>
                                  {prod.quantity > 1 && (
                                    <span className="text-muted-foreground">x{prod.quantity}</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center p-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-3">
                      <Eye className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-bold text-foreground">
                      Selecione um card ao lado para visualizar a preview completa
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Ao clicar em qualquer negociação da lista, todos os dados de funil, etapa, valor, empresa e contatos vinculados aparecerão aqui.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ── MODO CRIAR NOVA NEGOCIAÇÃO ── */
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-border overflow-y-auto">
            {/* Formulário de Nova Negociação */}
            <div className="md:col-span-7 p-6 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Título da Nova Negociação *
                  </label>
                  {(contactContext?.name || contactContext?.accountName) && (
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          newDeal: {
                            ...draft,
                            title:
                              contactContext?.accountName?.trim() ||
                              contactContext?.name?.trim() ||
                              "",
                          },
                        })
                      }
                      className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                    >
                      Usar nome do cliente
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  required
                  aria-label="Título da nova negociação"
                  placeholder="Ex: Aquisição de Envasadora — Empresa X"
                  value={draft.title}
                  onChange={(e) =>
                    onChange({ newDeal: { ...draft, title: e.target.value } })
                  }
                  className="h-10 w-full rounded-xl border border-border bg-muted/35 px-3.5 text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Funil com Radix Select estilizado */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Funil Comercial *
                  </label>
                  <Select
                    value={draft.pipelineId || undefined}
                    onValueChange={(newPipelineId) => {
                      const found = pipelines.find((p) => p.id === newPipelineId);
                      const firstStageId = found?.stages?.[0]?.id || "";
                      onChange({
                        newDeal: {
                          ...draft,
                          pipelineId: newPipelineId,
                          stageId: firstStageId,
                          customFields: {},
                        },
                      });
                    }}
                  >
                    <SelectTrigger
                      aria-label="Funil da nova negociação"
                      className="h-10 w-full rounded-xl border-border bg-muted/35 text-xs font-semibold"
                    >
                      <SelectValue placeholder="Selecione o funil..." />
                    </SelectTrigger>
                    <SelectContent>
                      {pipelines.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Etapa com Radix Select estilizado */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Etapa do Funil *
                  </label>
                  <Select
                    value={draft.stageId || undefined}
                    disabled={!draft.pipelineId}
                    onValueChange={(newStageId) =>
                      onChange({ newDeal: { ...draft, stageId: newStageId } })
                    }
                  >
                    <SelectTrigger
                      aria-label="Etapa da nova negociação"
                      className="h-10 w-full rounded-xl border-border bg-muted/35 text-xs font-semibold"
                    >
                      <SelectValue
                        placeholder={
                          draft.pipelineId ? "Selecione a etapa..." : "Escolha o funil primeiro"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {draftStages.map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-xs">
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Seletor Visual de Etapas */}
              {draftStages.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Progresso das Etapas no Funil
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {draftStages.map((s, idx) => {
                      const active = draft.stageId === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            onChange({ newDeal: { ...draft, stageId: s.id } })
                          }
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                            active
                              ? "border-primary bg-primary text-primary-foreground shadow-2xs"
                              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                          }`}
                        >
                          <span className="opacity-70">{idx + 1}.</span>
                          <span>{s.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Campos Personalizados do Funil/Etapa */}
              {draft.pipelineId && (
                <div className="pt-2 border-t border-border/60">
                  <CustomFieldsEditor
                    entity="deal"
                    pipelineId={draft.pipelineId}
                    values={draft.customFields || {}}
                    onChange={(customFields) =>
                      onChange({ newDeal: { ...draft, customFields } })
                    }
                    create
                    requiredIds={
                      draftStages.find((s) => s.id === draft.stageId)?.requiredFields || []
                    }
                  />
                </div>
              )}
            </div>

            {/* Preview ao Vivo da Nova Negociação */}
            <div className="md:col-span-5 bg-muted/15 p-6 space-y-4">
              <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Preview da Nova Negociação</span>
              </div>

              <div className="rounded-2xl border border-primary/30 bg-card p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-primary">
                    Novo Card CRM
                  </span>
                  <DealStatusBadge status="open" size="xs" className="rounded-full" />
                </div>

                <div>
                  <h4 className="text-sm font-extrabold text-foreground">
                    {draft.title.trim() || "Título da negociação..."}
                  </h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {currentDraftPipeline?.name || "Selecione um funil"} •{" "}
                    <strong className="text-foreground">
                      {draftStages.find((s) => s.id === draft.stageId)?.name ||
                        "Selecione uma etapa"}
                    </strong>
                  </p>
                </div>

                {contactContext && (
                  <div className="border-t border-border/60 pt-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground font-semibold">Contato:</span>
                      <span className="font-bold text-foreground truncate max-w-[180px]">
                        {contactContext.name || "Novo contato"}
                      </span>
                    </div>
                    {contactContext.accountName && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground font-semibold">Empresa:</span>
                        <span className="font-bold text-foreground truncate max-w-[180px]">
                          {contactContext.accountName}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── RODAPÉ DO MODAL ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/25 px-6 py-4 shrink-0">
          <div className="min-w-0 text-xs">
            {mode === "existing" ? (
              activePreviewDeal ? (
                <div className="flex items-center gap-2 truncate">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="text-muted-foreground">Card selecionado:</span>
                  <strong className="text-foreground truncate max-w-[260px]">
                    {activePreviewDeal.title}
                  </strong>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  Clique em uma negociação da lista para revisar e vincular.
                </span>
              )
            ) : (
              <div className="flex items-center gap-2 truncate">
                <Plus className="h-4 w-4 text-primary shrink-0" />
                <span className="text-muted-foreground">Criando card:</span>
                <strong className="text-foreground truncate max-w-[260px]">
                  {draft.title.trim() || "Preencha o título, funil e etapa"}
                </strong>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-10 rounded-xl border border-border bg-card px-4 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              Voltar
            </button>
            <button
              type="button"
              disabled={
                saving ||
                (mode === "existing"
                  ? !(value.dealId || inspectedDealId)
                  : !draft.title.trim() || !draft.pipelineId || !draft.stageId)
              }
              onClick={handleConfirm}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-xs font-extrabold text-primary-foreground shadow-soft hover:opacity-90 transition cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <span>{saving ? "Salvando..." : confirmLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Componente compacto e elegante exibido nos drawers de cadastro de contato.
 * Exibe o resumo/preview do card selecionado (ou dos cards já vinculados ao contato)
 * e permite abrir o Modal Detalhado de Vínculo de Negociação.
 */
export function ContactDealPicker({
  value,
  onChange,
  contactContext,
  selectedDealMeta,
  onSelectedDealMetaChange,
}: {
  value: ContactDealInput;
  onChange: (value: ContactDealInput) => void;
  contactContext?: ContactDealContext;
  selectedDealMeta?: DealPreviewItem | null;
  onSelectedDealMetaChange?: (meta: DealPreviewItem | null) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [internalMeta, setInternalMeta] = useState<DealPreviewItem | null>(null);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);

  const dealMeta = selectedDealMeta !== undefined ? selectedDealMeta : internalMeta;
  const setDealMeta = (meta: DealPreviewItem | null) => {
    setInternalMeta(meta);
    onSelectedDealMetaChange?.(meta);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/crm/pipelines", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { pipelines: [] }))
      .then((data) => {
        if (!controller.signal.aborted) {
          setPipelines(Array.isArray(data?.pipelines) ? data.pipelines : []);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Quando há um dealId selecionado mas ainda não temos os metadados, carrega para exibir o card de resumo
  useEffect(() => {
    if (!value.dealId || (dealMeta && dealMeta.id === value.dealId)) return;
    const controller = new AbortController();
    fetch(`/api/crm/deals/${encodeURIComponent(value.dealId)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!controller.signal.aborted && data?.deal) {
          setDealMeta(data.deal);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [value.dealId]);

  const linkedSummaries = contactContext?.linkedDeals || [];
  const hasCompleteSelection = isContactDealInputComplete(value);

  const getPipelineStageLabel = (pipelineId?: string | null, stageId?: string | null) => {
    const p = pipelines.find((item) => item.id === pipelineId);
    const s = p?.stages?.find((item) => item.id === stageId);
    if (p && s) return `${p.name} • ${s.name}`;
    if (p) return p.name;
    return "Funil Comercial";
  };

  return (
    <fieldset className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.04] to-card p-3.5 space-y-2.5 shadow-2xs">
      <legend className="px-1.5 text-[11px] font-extrabold uppercase tracking-wider text-primary flex items-center gap-1.5">
        <Columns3 className="h-3.5 w-3.5" />
        <span>Negociação obrigatória</span>
      </legend>

      {hasCompleteSelection ? (
        /* ── ESTADO COM NEGOCIAÇÃO SELECIONADA (PREVIEW COMPACTO) ── */
        <div className="rounded-xl border border-primary/35 bg-card p-3 space-y-2 shadow-2xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  {value.newDeal ? "Nova negociação configurada" : "Card vinculado"}
                </span>
                {!value.newDeal && dealMeta?.status && (
                  <DealStatusBadge status={dealMeta.status} size="xs" className="rounded-full" />
                )}
              </div>
              <p className="text-xs font-extrabold text-foreground truncate pt-0.5">
                {value.newDeal
                  ? value.newDeal.title
                  : dealMeta?.title || "Negociação selecionada"}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {value.newDeal
                  ? getPipelineStageLabel(value.newDeal.pipelineId, value.newDeal.stageId)
                  : getPipelineStageLabel(dealMeta?.pipelineId, dealMeta?.stageId)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="shrink-0 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-bold text-foreground hover:border-primary hover:text-primary transition cursor-pointer"
            >
              Alterar / Preview
            </button>
          </div>

          {!value.newDeal && dealMeta && (
            <div className="flex items-center justify-between border-t border-border/50 pt-1.5 text-[11px]">
              <span className="inline-flex items-center gap-1 text-muted-foreground truncate">
                <Building2 className="h-3 w-3 text-primary shrink-0" />
                <span className="truncate">{dealMeta.account?.name || "Sem empresa"}</span>
              </span>
              <span className="font-bold text-primary">
                {formatCurrencyBRL(dealMeta.value)}
              </span>
            </div>
          )}
        </div>
      ) : (
        /* ── ESTADO INICIAL (SEM NEGOCIAÇÃO DEFINIDA AINDA) ── */
        <div className="space-y-2.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Todo contato e atendimento precisa de pelo menos uma negociação. Escolha agora ou clique em{" "}
            <strong className="text-foreground">Salvar</strong> ao final para abrir a busca detalhada com preview do card.
          </p>

          {/* Se o contato selecionado já tem cards vinculados, exibe atalho rápido */}
          {linkedSummaries.length > 0 && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-2.5 space-y-1.5">
              <span className="block text-[10px] font-extrabold uppercase text-emerald-700 dark:text-emerald-400">
                Cards já vinculados a este contato ({linkedSummaries.length})
              </span>
              <div className="space-y-1">
                {linkedSummaries.slice(0, 2).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      onChange({ dealId: d.id });
                      setDealMeta({
                        id: d.id,
                        title: d.title,
                        status: d.status,
                        value: d.value,
                        pipelineId: d.pipelineId,
                        stageId: d.stageId,
                      });
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/80 bg-card px-2.5 py-1.5 text-left text-xs hover:border-primary transition cursor-pointer"
                  >
                    <span className="font-bold text-foreground truncate">{d.title}</span>
                    <span className="shrink-0 text-[10px] font-extrabold text-primary">
                      Usar este card →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onChange({});
                setModalOpen(true);
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-primary/35 bg-primary/10 py-2 px-3 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition cursor-pointer shadow-2xs"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Vincular existente</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const defaultPipeline = pipelines.find((p) => p.isDefault) || pipelines[0];
                const defaultStage = defaultPipeline?.stages?.[0];
                onChange({
                  newDeal: {
                    title: contactContext?.accountName || contactContext?.name || "",
                    pipelineId: defaultPipeline?.id || "",
                    stageId: defaultStage?.id || "",
                  },
                });
                setModalOpen(true);
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2 px-3 text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-primary" />
              <span>Criar nova</span>
            </button>
          </div>
        </div>
      )}

      <ContactDealModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        value={value}
        onChange={(nextVal, meta) => {
          onChange(nextVal);
          if (meta !== undefined) setDealMeta(meta);
        }}
        onConfirm={(nextVal, meta) => {
          onChange(nextVal);
          if (meta !== undefined) setDealMeta(meta);
          setModalOpen(false);
        }}
        confirmLabel="Confirmar Negociação"
        contactContext={contactContext}
      />
    </fieldset>
  );
}
