import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  type CustomFieldEntity,
  type CustomFieldStatusFilter,
  type CustomFieldType,
  isCustomFieldInactive,
} from "@/lib/crm/custom-field-common";
import {
  type FieldDefinition,
  type FieldOption,
  normalizeFieldOptions,
  normalizePipelineIds,
} from "./CustomFieldsEditor";
import { ProductCatalogManager } from "./ProductCatalogManager";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";

const entities: Array<{ id: CustomFieldEntity; label: string }> = [
  { id: "deal", label: "Negociação" },
  { id: "company", label: "Empresa" },
  { id: "contact", label: "Contato" },
  { id: "product", label: "Produto e Serviço" },
];
const types: Array<{ id: CustomFieldType; label: string; hint: string }> = [
  { id: "text", label: "Texto", hint: "Campo aberto para escrita" },
  { id: "date", label: "Data", hint: "DD/MM/AAAA" },
  { id: "single", label: "Seleção única", hint: "Escolha uma opção" },
  { id: "multiple", label: "Seleção múltipla", hint: "Escolha várias opções" },
  { id: "number", label: "Número simples", hint: "Valor numérico" },
  { id: "url", label: "Hiperlink", hint: "URL clicável" },
];
const standardFields: Record<CustomFieldEntity, string[]> = {
  deal: [
    "Nome da negociação",
    "Empresa",
    "Valor total",
    "Qualificação",
    "Previsão de fechamento",
    "Fonte",
    "Campanha",
    "Funil",
    "Etapa do funil",
  ],
  company: ["Nome da empresa", "Nome fantasia", "Segmento", "CNPJ ou CPF", "Telefone", "E-mail", "URL"],
  contact: ["Nome do contato", "Telefone", "E-mail", "Empresa vinculada"],
  product: ["Nome", "SKU", "Descrição", "Valor", "Unidade", "Categoria"],
};

export type PipelineWithStages = {
  id: string;
  name: string;
  orderIndex: number;
  stages?: Array<{
    id: string;
    name: string;
    orderIndex: number;
    pipelineId: string;
  }>;
};

type FieldDraft = {
  id?: string;
  name: string;
  fieldType: CustomFieldType;
  options: FieldOption[];
  required: boolean;
  requiredRule: "always" | "stage_onwards";
  requiredFromStageId: string;
  isUnique: boolean;
  visibleOnCreate: boolean;
  allPipelines: boolean;
  pipelineIds: string[];
  archivedAt?: string | null;
};

type ConfirmBulkOrSingleAction =
  | { kind: "single_inactivate"; field: FieldDefinition }
  | { kind: "bulk_inactivate"; fieldIds: string[]; fields: FieldDefinition[] }
  | { kind: "bulk_keep_only"; keepIds: string[]; inactivateFields: FieldDefinition[] }
  | { kind: "bulk_reactivate"; fieldIds: string[]; fields: FieldDefinition[] };

const emptyDraft = (): FieldDraft => ({
  name: "",
  fieldType: "text",
  options: [],
  required: false,
  requiredRule: "always",
  requiredFromStageId: "",
  isUnique: false,
  visibleOnCreate: true,
  allPipelines: true,
  pipelineIds: [],
});

function emitCustomFieldsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("crm-custom-fields-changed"));
  }
}

function CustomRadioOption({
  checked,
  onSelect,
  label,
  description,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 text-xs">
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onSelect}
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors cursor-pointer ${
          checked
            ? "border-primary bg-primary/15"
            : "border-muted-foreground/50 bg-background hover:border-primary/60"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
      </button>
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={onSelect}
          className="text-left cursor-pointer block w-full"
        >
          <span className="font-semibold text-foreground block">{label}</span>
          {description && (
            <span className="text-[11px] text-muted-foreground block">{description}</span>
          )}
        </button>
        {children}
      </div>
    </div>
  );
}

export function CustomFieldsSettingsModal({
  isOpen,
  onClose,
  initialEntity,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialEntity?: CustomFieldEntity;
}) {
  const [entity, setEntity] = useState<CustomFieldEntity>(initialEntity || "deal");
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingPipelines, setLoadingPipelines] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CustomFieldStatusFilter>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<ConfirmBulkOrSingleAction | null>(null);
  const [executingStatusChange, setExecutingStatusChange] = useState(false);
  const [draft, setDraft] = useState<FieldDraft | null>(null);
  const [showUniqueBanner, setShowUniqueBanner] = useState(true);

  useEffect(() => {
    if (isOpen && initialEntity) {
      setEntity(initialEntity);
    }
  }, [isOpen, initialEntity]);

  const loadPipelines = useCallback(async () => {
    setLoadingPipelines(true);
    try {
      const response = await fetch("/api/crm/pipelines", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (response.ok) {
        const data = await response.json();
        setPipelines(data.pipelines || []);
      }
    } catch {
      // Falha silenciosa no refresh avulso
    } finally {
      setLoadingPipelines(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fieldsResponse, pipelinesResponse] = await Promise.all([
        fetch(`/api/crm/custom-fields?entity=${entity}&includeArchived=true`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        }),
        fetch("/api/crm/pipelines", {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        }),
      ]);
      if (!fieldsResponse.ok) throw new Error("Não foi possível carregar os campos.");
      const data = await fieldsResponse.json();
      const raw: any[] = data.fields || [];
      setFields(
        raw.map((f) => ({
          ...f,
          options: normalizeFieldOptions(f.options),
          pipelineIds: normalizePipelineIds(f.pipelineIds),
          archivedAt: f.archivedAt ?? null,
        })),
      );
      setIsAdmin(data.isAdmin === true);
      if (pipelinesResponse.ok) {
        const pData = await pipelinesResponse.json();
        setPipelines(pData.pipelines || []);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar campos.");
    } finally {
      setLoading(false);
    }
  }, [entity]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  useEffect(() => {
    setDraft(null);
    setSelectedIds(new Set());
    setSearchQuery("");
  }, [entity]);

  const counts = useMemo(() => {
    const inactive = fields.filter((f) => isCustomFieldInactive(f)).length;
    return {
      active: fields.length - inactive,
      inactive,
      total: fields.length,
    };
  }, [fields]);

  const filteredFields = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return fields.filter((field) => {
      const inactive = isCustomFieldInactive(field);
      if (statusFilter === "active" && inactive) return false;
      if (statusFilter === "inactive" && !inactive) return false;
      if (normalizedSearch) {
        const inName = field.name.toLowerCase().includes(normalizedSearch);
        const inId = field.id.toLowerCase().includes(normalizedSearch);
        if (!inName && !inId) return false;
      }
      return true;
    });
  }, [fields, statusFilter, searchQuery]);

  const activeFields = useMemo(
    () => fields.filter((field) => !isCustomFieldInactive(field)),
    [fields],
  );

  const selectedVisibleCount = useMemo(
    () => filteredFields.filter((f) => selectedIds.has(f.id)).length,
    [filteredFields, selectedIds],
  );

  const selectedActiveFields = useMemo(
    () => fields.filter((f) => selectedIds.has(f.id) && !isCustomFieldInactive(f)),
    [fields, selectedIds],
  );

  const selectedInactiveFields = useMemo(
    () => fields.filter((f) => selectedIds.has(f.id) && isCustomFieldInactive(f)),
    [fields, selectedIds],
  );

  const otherActiveFieldsIfKeepOnly = useMemo(() => {
    if (selectedActiveFields.length === 0) return [];
    const keepSet = new Set(selectedActiveFields.map((f) => f.id));
    return activeFields.filter((f) => !keepSet.has(f.id));
  }, [activeFields, selectedActiveFields]);

  const availableStages = useMemo(() => {
    const draftPipelines = draft?.pipelineIds || [];
    const relevantPipelines =
      !draft?.allPipelines && draftPipelines.length
        ? pipelines.filter((p) => draftPipelines.includes(p.id))
        : pipelines;

    return relevantPipelines.flatMap((p) =>
      (p.stages || [])
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((s) => ({
          id: s.id,
          name: s.name,
          orderIndex: s.orderIndex,
          pipelineId: p.id,
          pipelineName: p.name,
        })),
    );
  }, [pipelines, draft?.allPipelines, draft?.pipelineIds]);

  if (!isOpen) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    const safeOptions = draft.options || [];
    if (
      (draft.fieldType === "single" || draft.fieldType === "multiple") &&
      safeOptions.some((option) => !option.label.trim())
    ) {
      toast.error("Preencha o nome de todas as opções.");
      return;
    }
    if (
      draft.required &&
      entity === "deal" &&
      draft.requiredRule === "stage_onwards" &&
      !draft.requiredFromStageId
    ) {
      toast.error("Selecione a partir de qual etapa o campo é obrigatório.");
      return;
    }
    if (entity === "deal" && !draft.allPipelines && (draft.pipelineIds || []).length === 0) {
      toast.error("Selecione ao menos um funil para a visibilidade do campo.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        draft.id ? `/api/crm/custom-fields/${draft.id}` : "/api/crm/custom-fields",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft, entityType: entity }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      toast.success(draft.id ? "Campo atualizado." : "Campo criado.");
      setDraft(null);
      emitCustomFieldsChanged();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const patchField = async (field: FieldDefinition, patch: object, successMessage?: string) => {
    try {
      const response = await fetch(`/api/crm/custom-fields/${field.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível atualizar o campo.");
      if (successMessage) toast.success(successMessage);
      emitCustomFieldsChanged();
      await load();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar.");
      return false;
    }
  };

  const executeBulkStatusUpdate = async (payload: {
    action: "inactivate" | "reactivate";
    fieldIds?: string[];
    keepActiveIds?: string[];
  }) => {
    const response = await fetch("/api/crm/custom-fields", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: entity,
        ...payload,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Não foi possível atualizar os campos selecionados.");
    }
    return data as { updatedCount: number };
  };

  const handleConfirmPendingAction = async () => {
    if (!pendingAction) return;
    setExecutingStatusChange(true);
    try {
      if (pendingAction.kind === "single_inactivate") {
        const ok = await patchField(
          pendingAction.field,
          { active: false },
          `Campo "${pendingAction.field.name}" inativado.`,
        );
        if (ok) {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(pendingAction.field.id);
            return next;
          });
          setPendingAction(null);
        }
      } else if (pendingAction.kind === "bulk_inactivate") {
        const res = await executeBulkStatusUpdate({
          action: "inactivate",
          fieldIds: pendingAction.fieldIds,
        });
        toast.success(`${res.updatedCount} campo(s) inativado(s) com histórico preservado.`);
        setSelectedIds(new Set());
        setPendingAction(null);
        emitCustomFieldsChanged();
        await load();
      } else if (pendingAction.kind === "bulk_keep_only") {
        const res = await executeBulkStatusUpdate({
          action: "inactivate",
          keepActiveIds: pendingAction.keepIds,
        });
        toast.success(`${res.updatedCount} campo(s) inativado(s). Apenas os selecionados continuam ativos.`);
        setSelectedIds(new Set());
        setPendingAction(null);
        emitCustomFieldsChanged();
        await load();
      } else if (pendingAction.kind === "bulk_reactivate") {
        const res = await executeBulkStatusUpdate({
          action: "reactivate",
          fieldIds: pendingAction.fieldIds,
        });
        toast.success(`${res.updatedCount} campo(s) reativado(s).`);
        setSelectedIds(new Set());
        setPendingAction(null);
        emitCustomFieldsChanged();
        await load();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar status.");
    } finally {
      setExecutingStatusChange(false);
    }
  };

  const move = async (field: FieldDefinition, direction: -1 | 1) => {
    const activeIndex = activeFields.findIndex((f) => f.id === field.id);
    if (activeIndex < 0) return;
    const next = activeFields[activeIndex + direction];
    if (!next) return;
    const first = await fetch(`/api/crm/custom-fields/${field.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: next.sortOrder }),
    });
    if (!first.ok) {
      toast.error("Não foi possível alterar a ordem.");
      return;
    }
    await patchField(next, { sortOrder: field.sortOrder });
  };

  const openEdit = (field: FieldDefinition) => {
    setShowUniqueBanner(true);
    setDraft({
      id: field.id,
      name: field.name,
      fieldType: field.fieldType,
      options: normalizeFieldOptions(field.options),
      required: field.required,
      requiredRule: field.requiredRule || "always",
      requiredFromStageId: field.requiredFromStageId || "",
      isUnique: field.isUnique === true,
      visibleOnCreate: field.visibleOnCreate,
      allPipelines: field.allPipelines,
      pipelineIds: normalizePipelineIds(field.pipelineIds),
      archivedAt: field.archivedAt ?? null,
    });
  };

  const toggleSelectAllFiltered = (checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const f of filteredFields) next.add(f.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const f of filteredFields) next.delete(f.id);
        return next;
      });
    }
  };

  const canReorder = statusFilter === "active" && !searchQuery.trim();

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label="Configurar campos de cadastro"
    >
      <header className="flex items-center justify-between border-b border-border bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <SystemTooltip content="Voltar para Configurações">
            <button
              type="button"
              onClick={onClose}
              aria-label="Voltar ao CRM"
              className="rounded-lg p-2 text-primary hover:bg-primary/10 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </SystemTooltip>
          <div>
            <p className="text-[10px] text-muted-foreground">Configurações do CRM</p>
            <h2 className="text-lg font-bold">Configurar campos de cadastro</h2>
          </div>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setShowUniqueBanner(true);
                setDraft(emptyDraft());
              }}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground cursor-pointer hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> Criar campo
            </button>
          )}
          <SystemTooltip content="Fechar janela">
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-6xl">
          <nav className="flex gap-6 border-b border-border" aria-label="Tipo de cadastro">
            {entities.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setEntity(item.id)}
                className={`border-b-2 pb-3 text-xs font-semibold cursor-pointer ${
                  entity === item.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <section className="mt-7">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-bold">
                  Campos personalizados{" "}
                  <span className="text-muted-foreground">({filteredFields.length})</span>
                </h3>
                <div
                  className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-xs"
                  role="tablist"
                  aria-label="Filtrar campos por status"
                >
                  {(
                    [
                      { id: "active", label: `Ativos (${counts.active})` },
                      { id: "inactive", label: `Inativos (${counts.inactive})` },
                      { id: "all", label: `Todos (${counts.total})` },
                    ] as Array<{ id: CustomFieldStatusFilter; label: string }>
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={statusFilter === tab.id}
                      onClick={() => {
                        setStatusFilter(tab.id);
                        setSelectedIds(new Set());
                      }}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                        statusFilter === tab.id
                          ? "bg-primary text-primary-foreground shadow-2xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nome ou ID..."
                  className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                {searchQuery && (
                  <SystemTooltip content="Limpar busca">
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      aria-label="Limpar busca"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                )}
              </div>
            </div>

            {isAdmin && selectedIds.size > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-xs">
                <span className="font-semibold text-foreground">
                  {selectedIds.size} campo(s) selecionado(s)
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedActiveFields.length > 0 && (
                    <SystemTooltip content="Inativa os campos marcados preservando todos os dados já preenchidos">
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAction({
                            kind: "bulk_inactivate",
                            fieldIds: selectedActiveFields.map((f) => f.id),
                            fields: selectedActiveFields,
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Inativar selecionados ({selectedActiveFields.length})
                      </button>
                    </SystemTooltip>
                  )}

                  {otherActiveFieldsIfKeepOnly.length > 0 && (
                    <SystemTooltip content="Mantém ativos apenas os campos marcados e inativa todos os outros desta entidade">
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAction({
                            kind: "bulk_keep_only",
                            keepIds: selectedActiveFields.map((f) => f.id),
                            inactivateFields: otherActiveFieldsIfKeepOnly,
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90 cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Manter marcados e inativar os outros ({otherActiveFieldsIfKeepOnly.length})
                      </button>
                    </SystemTooltip>
                  )}

                  {selectedInactiveFields.length > 0 && (
                    <SystemTooltip content="Reativa os campos inativos marcados para voltarem aos formulários">
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAction({
                            kind: "bulk_reactivate",
                            fieldIds: selectedInactiveFields.map((f) => f.id),
                            fields: selectedInactiveFields,
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reativar selecionados ({selectedInactiveFields.length})
                      </button>
                    </SystemTooltip>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  >
                    Limpar seleção
                  </button>
                </div>
              </div>
            )}

            {loading ? (
              <p className="py-8 text-xs text-muted-foreground">Carregando campos...</p>
            ) : !filteredFields.length ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                {searchQuery.trim()
                  ? `Nenhum campo encontrado para "${searchQuery.trim()}".`
                  : statusFilter === "inactive"
                    ? `Nenhum campo inativo para ${entities.find((item) => item.id === entity)?.label.toLowerCase()}.`
                    : `Nenhum campo personalizado criado para ${entities.find((item) => item.id === entity)?.label.toLowerCase()}.`}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[820px] text-left text-xs">
                  <thead className="border-b border-border bg-muted/30 text-[10px] uppercase text-muted-foreground">
                    <tr>
                      {isAdmin && (
                        <th className="w-9 p-3">
                          <SystemTooltip content="Selecionar todos os campos visíveis">
                            <div className="inline-flex items-center">
                              <Checkbox
                                checked={
                                  filteredFields.length > 0 &&
                                  selectedVisibleCount === filteredFields.length
                                }
                                onCheckedChange={(checked) => toggleSelectAllFiltered(!!checked)}
                                aria-label="Selecionar todos os campos"
                              />
                            </div>
                          </SystemTooltip>
                        </th>
                      )}
                      <th className="p-3">Ordem</th>
                      <th className="p-3">Nome do campo</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Tipo</th>
                      <th className="p-3">Obrigatoriedade</th>
                      <th className="p-3">Preferências</th>
                      <th className="p-3">Criado em</th>
                      <th className="p-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFields.map((field) => {
                      const inactive = isCustomFieldInactive(field);
                      const activeIdx = activeFields.findIndex((f) => f.id === field.id);
                      const isSelected = selectedIds.has(field.id);
                      return (
                        <tr
                          key={field.id}
                          className={`border-b border-border/60 last:border-0 transition-colors ${
                            inactive ? "bg-muted/15 opacity-80" : ""
                          } ${isSelected ? "bg-primary/5" : ""}`}
                        >
                          {isAdmin && (
                            <td className="p-3">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) => {
                                  setSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    if (checked) next.add(field.id);
                                    else next.delete(field.id);
                                    return next;
                                  });
                                }}
                                aria-label={`Selecionar ${field.name}`}
                              />
                            </td>
                          )}
                          <td className="p-3">
                            {isAdmin && !inactive && canReorder ? (
                              <div className="flex gap-1">
                                <SystemTooltip content="Subir ordem do campo">
                                  <button
                                    type="button"
                                    onClick={() => void move(field, -1)}
                                    disabled={activeIdx <= 0}
                                    aria-label="Subir campo"
                                    className="text-primary disabled:opacity-25 cursor-pointer disabled:cursor-default"
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </button>
                                </SystemTooltip>
                                <SystemTooltip content="Descer ordem do campo">
                                  <button
                                    type="button"
                                    onClick={() => void move(field, 1)}
                                    disabled={activeIdx < 0 || activeIdx >= activeFields.length - 1}
                                    aria-label="Descer campo"
                                    className="text-primary disabled:opacity-25 cursor-pointer disabled:cursor-default"
                                  >
                                    <ArrowDown className="h-3.5 w-3.5" />
                                  </button>
                                </SystemTooltip>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-3">
                            <b className="block">{field.name}</b>
                            <span className="text-[10px] text-muted-foreground">ID: {field.id}</span>
                          </td>
                          <td className="p-3">
                            {inactive ? (
                              <SystemTooltip
                                content={
                                  field.archivedAt
                                    ? `Inativado em ${new Date(field.archivedAt).toLocaleDateString("pt-BR")} · Valores existentes preservados`
                                    : "Campo inativo · Valores existentes preservados"
                                }
                              >
                                <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 cursor-default">
                                  Inativo
                                </span>
                              </SystemTooltip>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                Ativo
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            {types.find((type) => type.id === field.fieldType)?.label}
                          </td>
                          <td className="p-3">
                            {field.required ? (
                              field.requiredRule === "stage_onwards" && field.requiredFromStageId ? (
                                <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                  A partir de etapa
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
                                  Sempre obrigatório
                                </span>
                              )
                            ) : (
                              <span className="text-muted-foreground">Não obrigatório</span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col gap-1">
                              <span>
                                {field.visibleOnCreate ? "Visível no cadastro" : "Visível nos detalhes"}
                                {entity === "deal" && !field.allPipelines
                                  ? ` · ${field.pipelineIds?.length || 0} funil(is)`
                                  : ""}
                              </span>
                              {field.isUnique && (
                                <span className="inline-flex w-fit items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                  Único
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {new Date(field.createdAt).toLocaleDateString("pt-BR")}
                          </td>
                          <td className="p-3">
                            {isAdmin && (
                              <div className="flex items-center gap-2.5">
                                {inactive ? (
                                  <>
                                    <SystemTooltip content="Reativar campo para voltar a aparecer nos cadastros">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void patchField(
                                            field,
                                            { active: true },
                                            `Campo "${field.name}" reativado.`,
                                          )
                                        }
                                        className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                      >
                                        Reativar
                                      </button>
                                    </SystemTooltip>
                                    <button
                                      type="button"
                                      onClick={() => openEdit(field)}
                                      className="font-medium text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                                    >
                                      Editar
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openEdit(field)}
                                      className="font-semibold text-primary hover:underline cursor-pointer"
                                    >
                                      Editar
                                    </button>
                                    <SystemTooltip content="Inativar campo sem apagar os dados preenchidos nos cards">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPendingAction({
                                            kind: "single_inactivate",
                                            field,
                                          })
                                        }
                                        className="text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer"
                                      >
                                        Inativar
                                      </button>
                                    </SystemTooltip>
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-10">
            <h3 className="mb-3 text-sm font-bold">Campos padrão</h3>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {standardFields[entity].map((name) => (
                <div
                  key={name}
                  className="flex justify-between border-b border-border/60 px-4 py-3 text-xs last:border-0"
                >
                  <span className="font-semibold">{name}</span>
                  <span className="text-muted-foreground">Campo do sistema</span>
                </div>
              ))}
            </div>
          </section>

          {entity === "product" && isAdmin && (
            <ProductCatalogManager enabled={isOpen && entity === "product"} />
          )}
        </div>
      </main>

      {draft && (
        <div
          className="absolute inset-0 z-10 flex justify-end bg-black/40"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDraft(null);
          }}
        >
          <aside
            className="flex h-full w-full max-w-[460px] flex-col bg-card shadow-xl"
            aria-label={draft.id ? "Editar campo personalizado" : "Criar campo personalizado"}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-sm font-bold">
                {draft.id ? "Editar campo personalizado" : "Criar campo personalizado"}
              </h3>
              <SystemTooltip content="Fechar formulário">
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  aria-label="Fechar"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </SystemTooltip>
            </div>
            <form onSubmit={(event) => void save(event)} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
                <p className="font-semibold text-muted-foreground">
                  Campo para cadastro: {entities.find((item) => item.id === entity)?.label}
                </p>

                {draft.archivedAt && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-800 dark:text-amber-200 flex items-start justify-between gap-2">
                    <span>
                      Este campo está <b>inativo</b>. Você pode renomeá-lo ou reativá-lo agora.
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!draft.id) return;
                        const fieldObj = fields.find((f) => f.id === draft.id);
                        if (!fieldObj) return;
                        const ok = await patchField(
                          fieldObj,
                          { active: true, name: draft.name },
                          `Campo "${draft.name}" reativado.`,
                        );
                        if (ok) setDraft(null);
                      }}
                      className="shrink-0 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                    >
                      Reativar agora
                    </button>
                  </div>
                )}

                <label className="block space-y-1.5 font-semibold">
                  Nome do campo *
                  <input
                    required
                    maxLength={120}
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 font-normal"
                  />
                </label>

                {!draft.archivedAt && (
                  <>
                    <div className="space-y-1.5 font-semibold">
                      <label
                        htmlFor="custom-field-type"
                        className="block text-xs font-semibold text-foreground"
                      >
                        Tipo do campo *
                      </label>
                      <Select
                        disabled={!!draft.id}
                        value={draft.fieldType}
                        onValueChange={(val) =>
                          setDraft({
                            ...draft,
                            fieldType: val as CustomFieldType,
                            options: [],
                          })
                        }
                      >
                        <SelectTrigger
                          id="custom-field-type"
                          className="h-9 w-full rounded-lg border border-border bg-background px-3 font-normal text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {types.map((type) => (
                            <SelectItem key={type.id} value={type.id} className="text-xs">
                              {type.label} — {type.hint}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {(draft.fieldType === "single" || draft.fieldType === "multiple") && (
                      <div className="space-y-2">
                        <b>Opções *</b>
                        {(draft.options || []).map((option, index) => (
                          <div key={option.id} className="flex gap-2">
                            <input
                              value={option.label}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  options: (draft.options || []).map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, label: event.target.value }
                                      : entry,
                                  ),
                                })
                              }
                              placeholder={`Opção ${index + 1}`}
                              className="h-9 w-full rounded-lg border border-border bg-background px-3"
                            />
                            {!(
                              fields.find((field) => field.id === draft.id)?.options || []
                            ).some((saved) => saved.id === option.id) && (
                              <SystemTooltip content={`Remover opção ${index + 1}`}>
                                <button
                                  type="button"
                                  aria-label={`Remover opção ${index + 1}`}
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      options: (draft.options || []).filter(
                                        (entry) => entry.id !== option.id,
                                      ),
                                    })
                                  }
                                  className="text-muted-foreground hover:text-destructive cursor-pointer"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </SystemTooltip>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              options: [
                                ...(draft.options || []),
                                { id: `opt-${crypto.randomUUID()}`, label: "" },
                              ],
                            })
                          }
                          className="flex items-center gap-1 font-semibold text-primary cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" /> Adicionar opção
                        </button>
                        <p className="text-[10px] text-muted-foreground">
                          Opções existentes podem ser renomeadas; seus valores históricos são
                          preservados.
                        </p>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-border pt-4 font-semibold text-xs">
                      <div>
                        <span className="text-foreground block">Visível no cadastro</span>
                        <span className="text-[11px] font-normal text-muted-foreground">
                          Exibe este campo diretamente na criação da entidade.
                        </span>
                      </div>
                      <Checkbox
                        checked={draft.visibleOnCreate}
                        disabled={draft.required}
                        onCheckedChange={(checked) =>
                          setDraft({ ...draft, visibleOnCreate: !!checked })
                        }
                      />
                    </div>

                    {entity === "deal" && (
                      <div className="border-t border-border pt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-xs text-foreground block">Único</span>
                            <span className="text-[11px] text-muted-foreground">
                              Não permite ter 2 negociações com a mesma informação para este campo.
                            </span>
                          </div>
                          <Checkbox
                            checked={draft.isUnique}
                            onCheckedChange={(checked) => {
                              setDraft({ ...draft, isUnique: !!checked });
                              if (checked) setShowUniqueBanner(true);
                            }}
                          />
                        </div>

                        {draft.isUnique && showUniqueBanner && (
                          <div className="relative rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                            <div className="flex items-start gap-2.5 pr-6">
                              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                              <p className="text-[11px] leading-relaxed">
                                Ativando este campo as informações repetidas já cadastradas
                                anteriormente ficarão indisponíveis ao salvar.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowUniqueBanner(false)}
                              aria-label="Fechar aviso"
                              className="absolute top-2 right-2 text-amber-700/70 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="border-t border-border pt-4 space-y-3">
                      <div className="flex items-center justify-between font-semibold text-xs">
                        <div>
                          <span className="text-foreground block">Obrigatório</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            Define se o preenchimento deste campo deve ser exigido.
                          </span>
                        </div>
                        <Checkbox
                          checked={draft.required}
                          onCheckedChange={(checked) => {
                            const req = !!checked;
                            setDraft({
                              ...draft,
                              required: req,
                              requiredRule: req ? draft.requiredRule : "always",
                              visibleOnCreate: req ? true : draft.visibleOnCreate,
                            });
                          }}
                        />
                      </div>

                      {draft.required && entity === "deal" && (
                        <div className="space-y-3 pl-1 pt-1" role="radiogroup" aria-label="Regra de obrigatoriedade">
                          <CustomRadioOption
                            checked={draft.requiredRule === "always"}
                            onSelect={() =>
                              setDraft({ ...draft, requiredRule: "always", requiredFromStageId: "" })
                            }
                            label="Sempre obrigatório"
                            description="O campo não pode ficar em branco em nenhuma etapa."
                          />

                          <CustomRadioOption
                            checked={draft.requiredRule === "stage_onwards"}
                            onSelect={() => setDraft({ ...draft, requiredRule: "stage_onwards" })}
                            label="Obrigatório a partir da etapa"
                            description="O campo não pode ficar em branco a partir da etapa escolhida."
                          >
                            {draft.requiredRule === "stage_onwards" && (
                              <div className="mt-2">
                                <Select
                                  value={draft.requiredFromStageId}
                                  onValueChange={(val) =>
                                    setDraft({ ...draft, requiredFromStageId: val })
                                  }
                                >
                                  <SelectTrigger className="h-9 w-full rounded-lg border border-border bg-background px-3 font-normal text-xs">
                                    <SelectValue placeholder="Selecione a etapa inicial..." />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-60">
                                    {availableStages.length === 0 ? (
                                      <div className="p-2 text-center text-xs text-muted-foreground">
                                        Nenhuma etapa disponível.
                                      </div>
                                    ) : (
                                      availableStages.map((stage) => (
                                        <SelectItem key={stage.id} value={stage.id} className="text-xs">
                                          {stage.pipelineName} — {stage.name}
                                        </SelectItem>
                                      ))
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </CustomRadioOption>
                        </div>
                      )}
                    </div>

                    {entity === "deal" && (
                      <div className="space-y-3 border-t border-border pt-4">
                        <div className="flex items-center justify-between">
                          <b className="text-foreground">Visibilidade por funil</b>
                          <SystemTooltip content="Atualizar lista de funis">
                            <button
                              type="button"
                              onClick={() => void loadPipelines()}
                              className="text-[10px] text-primary hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <RefreshCw
                                className={`h-3 w-3 ${loadingPipelines ? "animate-spin" : ""}`}
                              />{" "}
                              Atualizar
                            </button>
                          </SystemTooltip>
                        </div>
                        <div className="space-y-2.5" role="radiogroup" aria-label="Visibilidade por funil">
                          <CustomRadioOption
                            checked={draft.allPipelines}
                            onSelect={() =>
                              setDraft({ ...draft, allPipelines: true, pipelineIds: [] })
                            }
                            label="Exibir em todos os funis"
                          />
                          <CustomRadioOption
                            checked={!draft.allPipelines}
                            onSelect={() => setDraft({ ...draft, allPipelines: false })}
                            label="Escolher funis"
                          />
                        </div>
                        {!draft.allPipelines && (
                          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                            {loadingPipelines ? (
                              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-2">
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando funis...
                              </div>
                            ) : pipelines.length === 0 ? (
                              <div className="py-4 text-center text-xs text-muted-foreground space-y-2">
                                <p>Nenhum funil cadastrado no momento.</p>
                                <p className="text-[11px]">
                                  Crie um funil em Configurações &gt; Funis de Vendas para associar.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => void loadPipelines()}
                                  className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                                >
                                  Tentar novamente
                                </button>
                              </div>
                            ) : (
                              <div className="max-h-48 space-y-2 overflow-y-auto">
                                {pipelines.map((pipeline) => (
                                  <label
                                    key={pipeline.id}
                                    className="flex items-center gap-2 cursor-pointer text-xs select-none hover:bg-muted/40 p-1.5 rounded-md transition-colors"
                                  >
                                    <Checkbox
                                      checked={(draft.pipelineIds || []).includes(pipeline.id)}
                                      onCheckedChange={(checked) =>
                                        setDraft({
                                          ...draft,
                                          pipelineIds: checked
                                            ? [...(draft.pipelineIds || []), pipeline.id]
                                            : (draft.pipelineIds || []).filter(
                                                (id) => id !== pipeline.id,
                                              ),
                                        })
                                      }
                                    />
                                    <span className="font-medium text-foreground">{pipeline.name}</span>
                                    <span className="text-[10px] text-muted-foreground ml-auto">
                                      {pipeline.stages?.length || 0} etapa(s)
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-border p-4">
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="rounded-lg bg-primary/10 px-3 py-2 font-semibold text-primary cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50 cursor-pointer"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      <Dialog open={Boolean(pendingAction)} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent className="max-w-md z-[70]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {pendingAction?.kind === "single_inactivate"
                ? `Inativar "${pendingAction.field.name}"?`
                : pendingAction?.kind === "bulk_inactivate"
                  ? `Inativar ${pendingAction.fields.length} campo(s)?`
                  : pendingAction?.kind === "bulk_keep_only"
                    ? `Inativar outros ${pendingAction.inactivateFields.length} campo(s)?`
                    : pendingAction?.kind === "bulk_reactivate"
                      ? `Reativar ${pendingAction.fields.length} campo(s)?`
                      : "Confirmar ação"}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {pendingAction?.kind === "bulk_reactivate"
                ? "Os campos selecionados voltarão a aparecer nos formulários de cadastro e edição de novos registros."
                : "Os campos inativados NÃO serão excluídos: todos os valores já preenchidos em registros existentes continuarão preservados como histórico (somente leitura) e você poderá reativar qualquer campo a qualquer momento na aba Inativos."}
            </DialogDescription>
          </DialogHeader>

          {pendingAction &&
            pendingAction.kind !== "single_inactivate" &&
            (() => {
              const previewList =
                pendingAction.kind === "bulk_keep_only"
                  ? pendingAction.inactivateFields
                  : pendingAction.fields;
              return (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2.5 space-y-1 text-xs">
                  {previewList.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{item.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{item.id}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              disabled={executingStatusChange}
              onClick={() => setPendingAction(null)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={executingStatusChange}
              onClick={() => void handleConfirmPendingAction()}
              className={`rounded-lg px-4 py-2 text-xs font-bold text-white cursor-pointer disabled:opacity-50 ${
                pendingAction?.kind === "bulk_reactivate"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-amber-600 hover:bg-amber-700"
              }`}
            >
              {executingStatusChange
                ? "Aplicando..."
                : pendingAction?.kind === "bulk_reactivate"
                  ? "Confirmar reativação"
                  : "Confirmar inativação"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
