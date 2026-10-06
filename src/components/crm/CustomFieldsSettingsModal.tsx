import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import type { CustomFieldEntity, CustomFieldType } from "@/lib/crm/custom-fields";
import type { FieldDefinition, FieldOption } from "./CustomFieldsEditor";
import { ProductCatalogManager } from "./ProductCatalogManager";
import { Checkbox } from "@/components/ui/checkbox";
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
};

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

export function CustomFieldsSettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [entity, setEntity] = useState<CustomFieldEntity>("deal");
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingPipelines, setLoadingPipelines] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<FieldDraft | null>(null);
  const [showUniqueBanner, setShowUniqueBanner] = useState(true);

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
        fetch(`/api/crm/custom-fields?entity=${entity}`, { cache: "no-store" }),
        fetch("/api/crm/pipelines", {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        }),
      ]);
      if (!fieldsResponse.ok) throw new Error("Não foi possível carregar os campos.");
      const data = await fieldsResponse.json();
      setFields(data.fields || []);
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
  }, [entity]);
  if (!isOpen) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    if (
      (draft.fieldType === "single" || draft.fieldType === "multiple") &&
      draft.options.some((option) => !option.label.trim())
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
    if (entity === "deal" && !draft.allPipelines && draft.pipelineIds.length === 0) {
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
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const patchField = async (field: FieldDefinition, patch: object) => {
    try {
      const response = await fetch(`/api/crm/custom-fields/${field.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível atualizar o campo.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar.");
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const next = fields[index + direction];
    if (!next) return;
    const current = fields[index];
    const first = await fetch(`/api/crm/custom-fields/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: next.sortOrder }),
    });
    if (!first.ok) {
      toast.error("Não foi possível alterar a ordem.");
      return;
    }
    await patchField(next, { sortOrder: current.sortOrder });
  };

  const openEdit = (field: FieldDefinition) => {
    setShowUniqueBanner(true);
    setDraft({
      id: field.id,
      name: field.name,
      fieldType: field.fieldType,
      options: field.options,
      required: field.required,
      requiredRule: field.requiredRule || "always",
      requiredFromStageId: field.requiredFromStageId || "",
      isUnique: field.isUnique === true,
      visibleOnCreate: field.visibleOnCreate,
      allPipelines: field.allPipelines,
      pipelineIds: field.pipelineIds || [],
    });
  };

  const availableStages = useMemo(() => {
    const relevantPipelines =
      !draft?.allPipelines && draft?.pipelineIds?.length
        ? pipelines.filter((p) => draft.pipelineIds.includes(p.id))
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

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label="Configurar campos de cadastro"
    >
      <header className="flex items-center justify-between border-b border-border bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Voltar ao CRM"
            className="rounded-lg p-2 text-primary hover:bg-primary/10"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
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
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Criar campo
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
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
                className={`border-b-2 pb-3 text-xs font-semibold ${entity === item.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <section className="mt-7">
            <h3 className="mb-3 text-sm font-bold">
              Campos personalizados <span className="text-muted-foreground">({fields.length})</span>
            </h3>
            {loading ? (
              <p className="py-8 text-xs text-muted-foreground">Carregando campos...</p>
            ) : !fields.length ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                Nenhum campo personalizado criado para{" "}
                {entities.find((item) => item.id === entity)?.label.toLowerCase()}.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="border-b border-border bg-muted/30 text-[10px] uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3">Ordem</th>
                      <th className="p-3">Nome do campo</th>
                      <th className="p-3">Tipo</th>
                      <th className="p-3">Obrigatoriedade</th>
                      <th className="p-3">Preferências</th>
                      <th className="p-3">Criado em</th>
                      <th className="p-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, index) => (
                      <tr key={field.id} className="border-b border-border/60 last:border-0">
                        <td className="p-3">
                          {isAdmin && (
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => void move(index, -1)}
                                disabled={index === 0}
                                aria-label="Subir campo"
                                className="text-primary disabled:opacity-25"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void move(index, 1)}
                                disabled={index === fields.length - 1}
                                aria-label="Descer campo"
                                className="text-primary disabled:opacity-25"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <b className="block">{field.name}</b>
                          <span className="text-[10px] text-muted-foreground">ID: {field.id}</span>
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
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => openEdit(field)}
                                className="font-semibold text-primary hover:underline"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Arquivar ${field.name}? Os valores já preenchidos serão preservados.`,
                                    )
                                  )
                                    void patchField(field, { archive: true });
                                }}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                Arquivar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
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
              <button type="button" onClick={() => setDraft(null)} aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={(event) => void save(event)} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
                <p className="font-semibold text-muted-foreground">
                  Campo para cadastro: {entities.find((item) => item.id === entity)?.label}
                </p>
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
                <div className="space-y-1.5 font-semibold">
                  <label htmlFor="custom-field-type" className="block text-xs font-semibold text-foreground">
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
                    <SelectTrigger id="custom-field-type" className="h-9 w-full rounded-lg border border-border bg-background px-3 font-normal text-xs">
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
                    {draft.options.map((option, index) => (
                      <div key={option.id} className="flex gap-2">
                        <input
                          value={option.label}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              options: draft.options.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, label: event.target.value }
                                  : entry,
                              ),
                            })
                          }
                          placeholder={`Opção ${index + 1}`}
                          className="h-9 w-full rounded-lg border border-border bg-background px-3"
                        />
                        {!fields
                          .find((field) => field.id === draft.id)
                          ?.options.some((saved) => saved.id === option.id) && (
                          <button
                            type="button"
                            aria-label={`Remover opção ${index + 1}`}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                options: draft.options.filter((entry) => entry.id !== option.id),
                              })
                            }
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          options: [
                            ...draft.options,
                            { id: `opt-${crypto.randomUUID()}`, label: "" },
                          ],
                        })
                      }
                      className="flex items-center gap-1 font-semibold text-primary"
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
                            Ativando este campo as informações repetidas já cadastradas anteriormente ficarão indisponíveis ao salvar.
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
                    <div className="space-y-3 pl-1 pt-1">
                      <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                        <input
                          type="radio"
                          name="requiredRule"
                          checked={draft.requiredRule === "always"}
                          onChange={() =>
                            setDraft({ ...draft, requiredRule: "always", requiredFromStageId: "" })
                          }
                          className="mt-0.5"
                        />
                        <div>
                          <span className="font-semibold text-foreground block">Sempre obrigatório</span>
                          <span className="text-[11px] text-muted-foreground">
                            O campo não pode ficar em branco em nenhuma etapa.
                          </span>
                        </div>
                      </label>

                      <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                        <input
                          type="radio"
                          name="requiredRule"
                          checked={draft.requiredRule === "stage_onwards"}
                          onChange={() => setDraft({ ...draft, requiredRule: "stage_onwards" })}
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <span className="font-semibold text-foreground block">Obrigatório a partir da etapa</span>
                          <span className="text-[11px] text-muted-foreground block mb-2">
                            O campo não pode ficar em branco a partir da etapa escolhida.
                          </span>

                          {draft.requiredRule === "stage_onwards" && (
                            <Select
                              value={draft.requiredFromStageId}
                              onValueChange={(val) => setDraft({ ...draft, requiredFromStageId: val })}
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
                          )}
                        </div>
                      </label>
                    </div>
                  )}
                </div>

                {entity === "deal" && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <b className="text-foreground">Visibilidade por funil</b>
                      <button
                        type="button"
                        onClick={() => void loadPipelines()}
                        className="text-[10px] text-primary hover:underline flex items-center gap-1 cursor-pointer"
                        title="Atualizar lista de funis"
                      >
                        <RefreshCw className={`h-3 w-3 ${loadingPipelines ? "animate-spin" : ""}`} /> Atualizar
                      </button>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="radio"
                        name="visibility-funnel"
                        checked={draft.allPipelines}
                        onChange={() => setDraft({ ...draft, allPipelines: true, pipelineIds: [] })}
                      />{" "}
                      Exibir em todos os funis
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="radio"
                        name="visibility-funnel"
                        checked={!draft.allPipelines}
                        onChange={() => setDraft({ ...draft, allPipelines: false })}
                      />{" "}
                      Escolher funis
                    </label>
                    {!draft.allPipelines && (
                      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                        {loadingPipelines ? (
                          <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-2">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando funis...
                          </div>
                        ) : pipelines.length === 0 ? (
                          <div className="py-4 text-center text-xs text-muted-foreground space-y-2">
                            <p>Nenhum funil cadastrado no momento.</p>
                            <p className="text-[11px]">Crie um funil em Configurações &gt; Funis de Vendas para associar.</p>
                            <button
                              type="button"
                              onClick={() => void loadPipelines()}
                              className="text-xs font-semibold text-primary hover:underline"
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
                                  checked={draft.pipelineIds.includes(pipeline.id)}
                                  onCheckedChange={(checked) =>
                                    setDraft({
                                      ...draft,
                                      pipelineIds: checked
                                        ? [...draft.pipelineIds, pipeline.id]
                                        : draft.pipelineIds.filter((id) => id !== pipeline.id),
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
              </div>
              <div className="flex justify-end gap-2 border-t border-border p-4">
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="rounded-lg bg-primary/10 px-3 py-2 font-semibold text-primary"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}
