import React, { useCallback, useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import {
  bodyVariableIndexes,
  collectTemplateCustomGroups,
  isSupportedMetaTemplate,
  matchesMetaTemplateFilter,
  normalizeTemplateCustomGroups,
  stripTemplateAccents,
  type TemplateBinding,
  type TemplateBindings,
} from "@/lib/whatsapp/meta-template-common";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  MessageSquare,
  Sparkles,
  Plus,
  Trash2,
  ExternalLink,
  PhoneCall,
  HelpCircle,
  Smartphone,
  Eye,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Type,
  Check,
  X,
  Layers,
  Folder,
  FolderPlus,
  Search,
  Edit2,
} from "lucide-react";

const BASE = import.meta.env.VITE_BACKEND_URL || "";

type MetaTemplate = {
  metaTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string;
  components: Array<{
    type?: string;
    format?: string;
    text?: string;
    buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string }>;
  }>;
  bindings: TemplateBindings;
  customGroups?: string[];
  rejectedReason: string | null;
};

type MetaTemplateGroup = {
  id: string;
  name: string;
  createdAt?: string;
};

type HeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
type ButtonType = "NONE" | "QUICK_REPLY" | "CTA";

interface TemplateButtonForm {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phoneNumber?: string;
}

interface FormState {
  metaTemplateId?: string;
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  customGroups: string[];
  headerType: HeaderType;
  headerText: string;
  bodyText: string;
  examples: string[];
  bindings: TemplateBindings;
  footerText: string;
  buttonType: ButtonType;
  buttons: TemplateButtonForm[];
}

const emptyForm = (): FormState => ({
  name: "",
  language: "pt_BR",
  category: "UTILITY",
  customGroups: [],
  headerType: "NONE",
  headerText: "",
  bodyText: "",
  examples: [],
  bindings: {},
  footerText: "",
  buttonType: "NONE",
  buttons: [],
});

function formatRejectionReason(reason?: string | null): string {
  if (!reason) return "";
  const trimmed = reason.trim();
  if (trimmed.toUpperCase() === "NONE") return "";
  const map: Record<string, string> = {
    INCORRECT_CATEGORY: "Categoria incorreta (o conteúdo da mensagem não corresponde à categoria selecionada)",
    INVALID_FORMAT: "Formato inválido (variáveis em posições inválidas, sem amostra ou caracteres não permitidos)",
    PROMOTIONAL: "Conteúdo promocional/marketing em template marcado como Utilidade",
    TAG_CONTENT_MISMATCH: "Divergência entre o conteúdo e as diretrizes da Meta",
    SCAM: "Conteúdo suspeito ou que viola as políticas de segurança da Meta",
    ABUSIVE_CONTENT: "Violação dos Termos e Políticas Comerciais do WhatsApp",
  };
  return map[trimmed.toUpperCase()] || trimmed;
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Falha na comunicação com a Meta.");
  return data;
}

function bindingLabel(binding: TemplateBinding) {
  return binding === "customer_name"
    ? "@nome do cliente"
    : binding === "operator_name"
    ? "@nome do operador"
    : "Preencher no envio";
}

export function MetaTemplatesManager({ tenant }: { tenant: string | null }) {
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [groups, setGroups] = useState<MetaTemplateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [formNewGroupInput, setFormNewGroupInput] = useState("");
  const [mappingId, setMappingId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<TemplateBindings>({});

  // Busca e Filtros de Organização Interna
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<string>("ALL");

  // Modal de Criar / Gerenciar Grupos e Vincular Templates em Lote
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupTemplateIds, setGroupTemplateIds] = useState<string[]>([]);
  const [groupTemplateSearch, setGroupTemplateSearch] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);

  // Modal Rápido para Vincular Grupos em um Template Específico
  const [linkingTemplate, setLinkingTemplate] = useState<MetaTemplate | null>(null);
  const [linkingGroups, setLinkingGroups] = useState<string[]>([]);
  const [quickNewGroupName, setQuickNewGroupName] = useState("");
  const [savingTemplateGroups, setSavingTemplateGroups] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/whatsapp/meta-templates");
      setTemplates((data.templates || []).filter((item: MetaTemplate) => item.status !== "DELETED"));
      if (Array.isArray(data.groups)) {
        setGroups(data.groups);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar templates.");
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Lista consolidada de nomes de grupos personalizados (do catálogo + dos templates)
  const allCustomGroupNames = useMemo(
    () =>
      collectTemplateCustomGroups(
        templates,
        groups.map((g) => g.name),
      ),
    [templates, groups],
  );

  // Templates filtrados pela barra de busca e pela categoria/grupo selecionado
  const filteredTemplates = useMemo(() => {
    return templates.filter((item) =>
      matchesMetaTemplateFilter(item, { search, selectedFilter }),
    );
  }, [templates, search, selectedFilter]);

  const utilityCount = useMemo(
    () => templates.filter((t) => (t.category || "").toUpperCase() === "UTILITY").length,
    [templates],
  );
  const marketingCount = useMemo(
    () => templates.filter((t) => (t.category || "").toUpperCase() === "MARKETING").length,
    [templates],
  );
  const ungroupedCount = useMemo(
    () => templates.filter((t) => normalizeTemplateCustomGroups(t.customGroups).length === 0).length,
    [templates],
  );

  // Abrir modal de grupos em modo "Novo Grupo"
  const openCreateGroupModal = () => {
    setEditingGroupId(null);
    setGroupNameInput("");
    setGroupTemplateIds([]);
    setGroupTemplateSearch("");
    setGroupModalOpen(true);
  };

  // Abrir modal de grupos selecionando um grupo existente para editar/vincular templates
  const openEditGroupModal = (groupName: string) => {
    const existingGroup = groups.find((g) => g.name.toLowerCase() === groupName.toLowerCase());
    setEditingGroupId(existingGroup?.id || null);
    setGroupNameInput(existingGroup?.name || groupName);
    const linkedIds = templates
      .filter((t) =>
        normalizeTemplateCustomGroups(t.customGroups).some(
          (g) => g.toLowerCase() === groupName.toLowerCase(),
        ),
      )
      .map((t) => t.metaTemplateId);
    setGroupTemplateIds(linkedIds);
    setGroupTemplateSearch("");
    setGroupModalOpen(true);
  };

  const handleSaveGroupWithLinks = async () => {
    const cleanName = groupNameInput.trim().replace(/\s+/g, " ");
    if (!cleanName) {
      toast.error("Informe um nome para o grupo (ex: Assistência Técnica, Pós-Venda).");
      return;
    }
    setSavingGroup(true);
    try {
      const data = await api("/api/whatsapp/meta-templates", {
        method: "POST",
        body: JSON.stringify({
          action: "save_group",
          groupId: editingGroupId || undefined,
          name: cleanName,
          templateIds: groupTemplateIds,
        }),
      });
      if (Array.isArray(data.templates)) {
        setTemplates(data.templates.filter((item: MetaTemplate) => item.status !== "DELETED"));
      }
      if (Array.isArray(data.groups)) {
        setGroups(data.groups);
      }
      if (selectedFilter.startsWith("GRP:")) {
        setSelectedFilter(`GRP:${cleanName}`);
      }
      toast.success(
        editingGroupId
          ? `Grupo "${cleanName}" e templates vinculados atualizados!`
          : `Grupo "${cleanName}" criado com ${groupTemplateIds.length} template(s) vinculado(s)!`,
      );
      setGroupModalOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Falha ao salvar grupo.");
    } finally {
      setSavingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupName: string) => {
    if (
      !window.confirm(
        `Remover o grupo interno "${groupName}"? Os templates vinculados continuarão intactos na Meta, apenas deixarão de fazer parte deste grupo.`,
      )
    ) {
      return;
    }
    const existingGroup = groups.find((g) => g.name.toLowerCase() === groupName.toLowerCase());
    setSavingGroup(true);
    try {
      const data = await api("/api/whatsapp/meta-templates", {
        method: "POST",
        body: JSON.stringify({
          action: "delete_group",
          groupId: existingGroup?.id,
          name: groupName,
        }),
      });
      if (Array.isArray(data.templates)) {
        setTemplates(data.templates.filter((item: MetaTemplate) => item.status !== "DELETED"));
      }
      if (Array.isArray(data.groups)) {
        setGroups(data.groups);
      }
      if (selectedFilter === `GRP:${groupName}`) {
        setSelectedFilter("ALL");
      }
      if (editingGroupId && existingGroup?.id === editingGroupId) {
        setEditingGroupId(null);
        setGroupNameInput("");
        setGroupTemplateIds([]);
      }
      toast.success(`Grupo "${groupName}" removido.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Falha ao remover grupo.");
    } finally {
      setSavingGroup(false);
    }
  };

  const openQuickLinkTemplate = (item: MetaTemplate) => {
    setLinkingTemplate(item);
    setLinkingGroups(normalizeTemplateCustomGroups(item.customGroups));
    setQuickNewGroupName("");
  };

  const handleSaveTemplateGroups = async () => {
    if (!linkingTemplate) return;
    setSavingTemplateGroups(true);
    try {
      const pendingNew = quickNewGroupName.trim().replace(/\s+/g, " ");
      const finalGroups = pendingNew
        ? normalizeTemplateCustomGroups([...linkingGroups, pendingNew])
        : normalizeTemplateCustomGroups(linkingGroups);

      const data = await api("/api/whatsapp/meta-templates", {
        method: "POST",
        body: JSON.stringify({
          action: "set_template_groups",
          metaTemplateId: linkingTemplate.metaTemplateId,
          customGroups: finalGroups,
        }),
      });
      if (Array.isArray(data.groups)) {
        setGroups(data.groups);
      }
      setTemplates((prev) =>
        prev.map((t) =>
          t.metaTemplateId === linkingTemplate.metaTemplateId
            ? { ...t, customGroups: finalGroups }
            : t,
        ),
      );
      toast.success(`Grupos do template "${linkingTemplate.name}" atualizados!`);
      setLinkingTemplate(null);
      setQuickNewGroupName("");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Falha ao atualizar grupos do template.");
    } finally {
      setSavingTemplateGroups(false);
    }
  };

  // Templates filtrados dentro do modal de criação/edição de grupo
  const groupModalFilteredTemplates = useMemo(() => {
    const q = stripTemplateAccents(groupTemplateSearch);
    if (!q) return templates;
    return templates.filter(
      (t) =>
        stripTemplateAccents(t.name).includes(q) ||
        stripTemplateAccents(t.bodyText).includes(q) ||
        normalizeTemplateCustomGroups(t.customGroups).some((g) => stripTemplateAccents(g).includes(q)),
    );
  }, [templates, groupTemplateSearch]);

  // Inserir tag dinâmica no corpo
  const insertVariable = (binding: TemplateBinding) => {
    if (!form) return;
    const indexes = bodyVariableIndexes(form.bodyText);
    const next = indexes.length > 0 ? Math.max(...indexes) + 1 : 1;
    const spacer = form.bodyText && !form.bodyText.endsWith(" ") ? " " : "";
    const nextBody = `${form.bodyText}${spacer}{{${next}}}`;
    const nextExample =
      binding === "customer_name" ? "Maria" : binding === "operator_name" ? "João" : "Exemplo";

    setForm({
      ...form,
      bodyText: nextBody,
      examples: [...form.examples, nextExample],
      bindings: { ...form.bindings, [next]: binding },
    });
  };

  const openEdit = (item: MetaTemplate) => {
    const indexes = bodyVariableIndexes(item.bodyText);
    const headerComponent = item.components?.find((c) => c.type === "HEADER");
    const footerComponent = item.components?.find((c) => c.type === "FOOTER");
    const buttonsComponent = item.components?.find((c) => c.type === "BUTTONS");

    let headerType: HeaderType = "NONE";
    let headerText = "";
    if (headerComponent) {
      if (headerComponent.format === "TEXT") {
        headerType = "TEXT";
        headerText = headerComponent.text || "";
      } else if (headerComponent.format) {
        headerType = headerComponent.format as HeaderType;
      }
    }

    let buttonType: ButtonType = "NONE";
    let buttons: TemplateButtonForm[] = [];
    if (buttonsComponent?.buttons && buttonsComponent.buttons.length > 0) {
      const first = buttonsComponent.buttons[0];
      if (first.type === "QUICK_REPLY") {
        buttonType = "QUICK_REPLY";
      } else {
        buttonType = "CTA";
      }
      buttons = buttonsComponent.buttons.map((b) => ({
        type: (b.type as any) || "QUICK_REPLY",
        text: b.text || "",
        url: b.url,
        phoneNumber: b.phone_number,
      }));
    }

    setFormNewGroupInput("");
    setForm({
      metaTemplateId: item.metaTemplateId,
      name: item.name,
      language: item.language,
      category: item.category === "MARKETING" ? "MARKETING" : "UTILITY",
      customGroups: normalizeTemplateCustomGroups(item.customGroups),
      headerType,
      headerText,
      bodyText: item.bodyText,
      examples: indexes.map(
        (index) =>
          item.bindings[String(index)] === "customer_name"
            ? "Maria"
            : item.bindings[String(index)] === "operator_name"
            ? "João"
            : "Exemplo"
      ),
      bindings: item.bindings || {},
      footerText: footerComponent?.text || "",
      buttonType,
      buttons,
    });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const payload: any = {
        name: form.name,
        language: form.language,
        category: form.category,
        customGroups: normalizeTemplateCustomGroups(form.customGroups),
        bodyText: form.bodyText,
        examples: form.examples,
        bindings: form.bindings,
        ...(form.headerType !== "NONE"
          ? {
              header: {
                type: form.headerType,
                ...(form.headerType === "TEXT" ? { text: form.headerText } : {}),
              },
            }
          : {}),
        ...(form.footerText.trim() ? { footerText: form.footerText.trim() } : {}),
        ...(form.buttonType !== "NONE" && form.buttons.length > 0
          ? { buttons: form.buttons }
          : {}),
      };

      if (form.metaTemplateId) {
        payload.metaTemplateId = form.metaTemplateId;
      }

      await api("/api/whatsapp/meta-templates", {
        method: form.metaTemplateId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });

      toast.success(
        form.metaTemplateId
          ? "Alteração enviada à Meta para revisão."
          : "Template oficial enviado para análise da Meta!"
      );
      setForm(null);
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Falha ao salvar template.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: MetaTemplate) => {
    if (!window.confirm(`Excluir permanentemente o template oficial "${item.name}" da Meta?`)) return;
    try {
      await api(`/api/whatsapp/meta-templates?id=${encodeURIComponent(item.metaTemplateId)}`, {
        method: "DELETE",
      });
      toast.success("Exclusão enviada à Meta.");
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Falha ao excluir template.");
    }
  };

  const saveMapping = async () => {
    if (!mappingId) return;
    try {
      await api("/api/whatsapp/meta-templates", {
        method: "PATCH",
        body: JSON.stringify({ metaTemplateId: mappingId, bindings: mapping }),
      });
      toast.success("Variáveis configuradas com sucesso.");
      setMappingId(null);
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Falha ao salvar variáveis.");
    }
  };

  // Preview interpolado da mensagem
  const livePreviewBody = useMemo(() => {
    if (!form) return "";
    return form.bodyText.replace(/\{\{(\d+)\}\}/g, (_, num) => {
      const idx = Number(num) - 1;
      const example = form.examples[idx]?.trim();
      if (example) return example;
      const binding = form.bindings[num];
      if (binding === "customer_name") return "Maria da Silva";
      if (binding === "operator_name") return "João Atendente";
      return `{{${num}}}`;
    });
  }, [form]);

  return (
    <section className="space-y-5 border-t border-border pt-6">
      {/* Cabeçalho da Seção */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-extrabold text-foreground">
              Templates Oficiais da Meta WhatsApp
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Cloud API v21.0
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Modelos de mensagem pré-aprovados pela Meta. Crie grupos personalizados (ex: Assistência Técnica, Pós-Venda) para organizar internamente e encontrar fácil nos canais de envio do chat.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
            <span>{loading ? "Sincronizando..." : "Sincronizar Meta"}</span>
          </button>
          <button
            type="button"
            onClick={openCreateGroupModal}
            className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/15 px-3.5 py-2 text-xs font-bold text-primary transition-colors cursor-pointer shadow-xs"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>Gerenciar Grupos{allCustomGroupNames.length > 0 ? ` (${allCustomGroupNames.length})` : ""}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setFormNewGroupInput("");
              setForm(emptyForm());
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary hover:opacity-90 px-4 py-2 text-xs font-bold text-primary-foreground transition-all cursor-pointer shadow-soft"
          >
            <Plus className="h-4 w-4" />
            <span>Criar Template Meta</span>
          </button>
        </div>
      </div>

      {/* Barra de Busca + Pílulas de Categorias Oficiais e Grupos Personalizados */}
      {templates.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-3.5 space-y-3 shadow-2xs">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar template por nome, texto da mensagem ou grupo personalizado..."
                className="pl-9 pr-8 h-9 text-xs rounded-xl bg-background border-border"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={openCreateGroupModal}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition-colors cursor-pointer shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Criar Grupo Personalizado</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
            <button
              type="button"
              onClick={() => setSelectedFilter("ALL")}
              className={`shrink-0 px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
                selectedFilter === "ALL"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              Todos ({templates.length})
            </button>

            {utilityCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedFilter("CAT:UTILITY")}
                className={`shrink-0 px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                  selectedFilter === "CAT:UTILITY"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Utilidade ({utilityCount})
              </button>
            )}

            {marketingCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedFilter("CAT:MARKETING")}
                className={`shrink-0 px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                  selectedFilter === "CAT:MARKETING"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Marketing ({marketingCount})
              </button>
            )}

            {allCustomGroupNames.length > 0 && (
              <span className="h-4 w-px bg-border shrink-0 mx-0.5" />
            )}

            {allCustomGroupNames.map((groupName) => {
              const filterKey = `GRP:${groupName}`;
              const isSelected = selectedFilter === filterKey;
              const count = templates.filter((t) =>
                normalizeTemplateCustomGroups(t.customGroups).some(
                  (g) => g.toLowerCase() === groupName.toLowerCase(),
                ),
              ).length;

              return (
                <div
                  key={filterKey}
                  className={`shrink-0 inline-flex items-center rounded-lg border transition-all ${
                    isSelected
                      ? "bg-primary text-primary-foreground border-primary shadow-xs"
                      : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedFilter(filterKey)}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 font-bold cursor-pointer"
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                    <span>{groupName}</span>
                    <span className="opacity-80">({count})</span>
                  </button>
                  <SystemTooltip content={`Editar grupo "${groupName}" e vincular templates`}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditGroupModal(groupName);
                      }}
                      className={`pr-2 pl-1 py-1.5 transition-opacity cursor-pointer ${
                        isSelected
                          ? "text-primary-foreground/85 hover:text-primary-foreground"
                          : "text-primary/70 hover:text-primary"
                      }`}
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                  </SystemTooltip>
                </div>
              );
            })}

            {allCustomGroupNames.length > 0 && ungroupedCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedFilter("UNGROUPED")}
                className={`shrink-0 px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                  selectedFilter === "UNGROUPED"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Sem Grupo ({ungroupedCount})
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Grid de Templates Existentes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredTemplates.map((item) => {
          const indexes = bodyVariableIndexes(item.bodyText);
          const hasHeader = item.components?.some((c) => c.type === "HEADER");
          const hasFooter = item.components?.some((c) => c.type === "FOOTER");
          const hasButtons = item.components?.some((c) => c.type === "BUTTONS");
          const headerComponent = item.components?.find((c) => c.type === "HEADER");
          const buttonsComponent = item.components?.find((c) => c.type === "BUTTONS");
          const itemGroups = normalizeTemplateCustomGroups(item.customGroups);

          const isApproved = item.status === "APPROVED";
          const isRejected = item.status === "REJECTED";

          return (
            <article
              key={item.metaTemplateId}
              className="rounded-2xl border border-border bg-card p-5 text-xs shadow-xs hover:border-primary/40 transition-all flex flex-col justify-between"
            >
              <div>
                {/* Header do Card */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <MessageSquare className="h-3.5 w-3.5 fill-current" />
                    </div>
                    <strong className="font-mono text-sm text-foreground">{item.name}</strong>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      isApproved
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : isRejected
                        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {isApproved ? <CheckCircle2 className="h-3 w-3" /> : isRejected ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    {item.status}
                  </span>
                </div>

                {/* Sub-informações / Badges + Grupos Personalizados */}
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground mb-3">
                  <span className="font-medium">{item.language}</span>
                  <span>•</span>
                  <span className="font-semibold text-foreground">
                    {item.category === "UTILITY" ? "Utilidade" : item.category}
                  </span>
                  {hasHeader && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                      Cabeçalho: {headerComponent?.format || "TEXTO"}
                    </span>
                  )}
                  {hasButtons && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                      {buttonsComponent?.buttons?.length} Botão(ões)
                    </span>
                  )}
                  {itemGroups.map((groupName) => (
                    <button
                      key={groupName}
                      type="button"
                      onClick={() => openQuickLinkTemplate(item)}
                      className="inline-flex items-center gap-1 rounded-md bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 px-2 py-0.5 text-[10px] font-bold transition-colors cursor-pointer"
                      title="Clique para alterar os grupos deste template"
                    >
                      <Folder className="h-2.5 w-2.5" />
                      <span>{groupName}</span>
                    </button>
                  ))}
                  {itemGroups.length === 0 && (
                    <button
                      type="button"
                      onClick={() => openQuickLinkTemplate(item)}
                      className="inline-flex items-center gap-1 rounded-md border border-dashed border-border hover:border-primary/40 hover:text-primary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors cursor-pointer"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      <span>Grupo</span>
                    </button>
                  )}
                </div>

                {/* Corpo do template com highlight de variáveis */}
                <div className="rounded-xl bg-muted/40 border border-border/60 p-3.5 space-y-1.5">
                  {hasHeader && headerComponent?.format === "TEXT" && (
                    <p className="font-bold text-foreground text-xs">{headerComponent.text}</p>
                  )}
                  <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed font-sans">
                    {item.bodyText.replace(/\{\{(\d+)\}\}/g, (_, number) => {
                      const binding = item.bindings?.[number] || "manual";
                      return `[${bindingLabel(binding)}]`;
                    })}
                  </p>
                  {hasFooter && (
                    <p className="text-[11px] text-muted-foreground italic pt-1">
                      {item.components?.find((c) => c.type === "FOOTER")?.text}
                    </p>
                  )}

                  {/* Prévia de botões */}
                  {hasButtons && buttonsComponent?.buttons && (
                    <div className="pt-2 border-t border-border/60 flex flex-wrap gap-1.5">
                      {buttonsComponent.buttons.map((btn, bIdx) => (
                        <span
                          key={bIdx}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-card text-foreground border border-border/70"
                        >
                          {btn.type === "URL" ? <ExternalLink className="h-2.5 w-2.5" /> : btn.type === "PHONE_NUMBER" ? <PhoneCall className="h-2.5 w-2.5" /> : null}
                          {btn.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {item.status === "REJECTED" && item.rejectedReason && item.rejectedReason.trim().toUpperCase() !== "NONE" && (
                  <div className="mt-2.5 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                    <strong>Motivo da recusa pela Meta:</strong> {formatRejectionReason(item.rejectedReason)}
                  </div>
                )}
              </div>

              {/* Ações do Card */}
              <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  {indexes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setMappingId(item.metaTemplateId);
                        setMapping({ ...item.bindings });
                      }}
                      className="font-semibold text-primary hover:underline cursor-pointer"
                    >
                      Configurar Variáveis
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openQuickLinkTemplate(item)}
                    className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    <Folder className="h-3 w-3 text-primary" />
                    <span>Vincular Grupo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    Editar
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void remove(item)}
                  className="text-destructive/80 hover:text-destructive font-semibold transition-colors cursor-pointer"
                >
                  Excluir da Meta
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {!loading && !error && templates.length > 0 && filteredTemplates.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center space-y-2">
          <Folder className="h-7 w-7 text-muted-foreground mx-auto" />
          <p className="text-sm font-bold text-foreground">Nenhum template encontrado neste filtro</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {selectedFilter.startsWith("GRP:")
              ? `O grupo "${selectedFilter.slice(4)}" ainda não possui templates que correspondam à busca.`
              : "Tente limpar a busca ou alternar o grupo selecionado."}
          </p>
          {selectedFilter.startsWith("GRP:") && (
            <button
              type="button"
              onClick={() => openEditGroupModal(selectedFilter.slice(4))}
              className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Vincular Templates a "{selectedFilter.slice(4)}"</span>
            </button>
          )}
        </div>
      )}

      {!loading && !error && templates.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center space-y-2">
          <MessageSquare className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-bold text-foreground">Nenhum template oficial cadastrado</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Crie seu primeiro template da Meta para poder enviar mensagens de utilidade ou marketing fora da janela de 24 horas.
          </p>
        </div>
      )}

      {/* Modal Rápido: Vincular Grupos a um Template Específico */}
      {linkingTemplate && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Folder className="h-4 w-4 text-primary" />
                  <span>Vincular Grupo Interno</span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Template: <strong className="font-mono text-foreground">{linkingTemplate.name}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLinkingTemplate(null)}
                className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl bg-muted/40 border border-border/60 p-3 text-[11px] text-muted-foreground leading-relaxed">
              Esta organização é <strong>100% interna da operação</strong> para facilitar a busca nos canais de envio do chat. Não altera a categoria na Meta e não impacta o cliente.
            </div>

            <div className="space-y-2.5">
              <Label className="text-xs font-bold text-foreground">Grupos disponíveis (clique para marcar/desmarcar)</Label>
              {allCustomGroupNames.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Nenhum grupo criado ainda. Digite abaixo para criar o primeiro grupo já vinculado a este template.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto p-1">
                  {allCustomGroupNames.map((gName) => {
                    const isChecked = linkingGroups.some((g) => g.toLowerCase() === gName.toLowerCase());
                    return (
                      <button
                        key={gName}
                        type="button"
                        onClick={() => {
                          setLinkingGroups((prev) =>
                            isChecked
                              ? prev.filter((g) => g.toLowerCase() !== gName.toLowerCase())
                              : [...prev, gName],
                          );
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          isChecked
                            ? "bg-primary text-primary-foreground border-primary shadow-xs"
                            : "bg-background text-foreground border-border hover:border-primary/40"
                        }`}
                      >
                        {isChecked ? <Check className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span>{gName}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="pt-2 space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Ou criar e vincular novo grupo agora</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={quickNewGroupName}
                    onChange={(e) => setQuickNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const clean = quickNewGroupName.trim().replace(/\s+/g, " ");
                        if (clean) {
                          setLinkingGroups((prev) => normalizeTemplateCustomGroups([...prev, clean]));
                          setQuickNewGroupName("");
                        }
                      }
                    }}
                    placeholder="Ex: Assistência Técnica, Pós-Venda..."
                    className="h-9 text-xs rounded-xl bg-background border-border"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = quickNewGroupName.trim().replace(/\s+/g, " ");
                      if (!clean) return;
                      setLinkingGroups((prev) => normalizeTemplateCustomGroups([...prev, clean]));
                      setQuickNewGroupName("");
                    }}
                    className="px-3 h-9 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-colors cursor-pointer shrink-0"
                  >
                    + Adicionar
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setLinkingTemplate(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-border text-foreground hover:bg-muted cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingTemplateGroups}
                onClick={() => void handleSaveTemplateGroups()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-soft"
              >
                {savingTemplateGroups ? "Salvando..." : "Salvar Vínculo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Completo: Criar / Gerenciar Grupos e Vincular Templates em Lote */}
      {groupModalOpen && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            {/* Header do Modal de Grupos */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/20 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <FolderPlus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    Grupos Personalizados de Templates Meta
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Crie grupos (ex: Assistência Técnica, Pós-Venda) e escolha quais templates pertencem a cada grupo para facilitar o envio no chat.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGroupModalOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Corpo do Modal: Lista de Grupos + Formulário e Seleção de Templates */}
            <div className="grid grid-cols-1 md:grid-cols-12 flex-1 min-h-0 overflow-hidden">
              {/* Coluna Esquerda: Grupos Existentes */}
              <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-border bg-muted/15 p-4 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Seus Grupos ({allCustomGroupNames.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingGroupId(null);
                      setGroupNameInput("");
                      setGroupTemplateIds([]);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Novo</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {allCustomGroupNames.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                      Nenhum grupo personalizado criado ainda. Use o painel ao lado para criar o primeiro!
                    </div>
                  ) : (
                    allCustomGroupNames.map((gName) => {
                      const groupObj = groups.find((g) => g.name.toLowerCase() === gName.toLowerCase());
                      const isCurrent =
                        (editingGroupId && groupObj?.id === editingGroupId) ||
                        (!editingGroupId && groupNameInput.trim().toLowerCase() === gName.toLowerCase());
                      const count = templates.filter((t) =>
                        normalizeTemplateCustomGroups(t.customGroups).some(
                          (g) => g.toLowerCase() === gName.toLowerCase(),
                        ),
                      ).length;

                      return (
                        <div
                          key={gName}
                          className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${
                            isCurrent
                              ? "border-primary bg-primary/10 text-primary font-bold"
                              : "border-border bg-card text-foreground hover:border-primary/40"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => openEditGroupModal(gName)}
                            className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                          >
                            <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="truncate">{gName}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">({count})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteGroup(gName)}
                            title={`Excluir grupo ${gName}`}
                            className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Coluna Direita: Nome do Grupo + Checklist de Templates Vinculados */}
              <div className="md:col-span-8 p-5 flex flex-col min-h-0 space-y-4 overflow-hidden">
                <div className="space-y-1.5 shrink-0">
                  <Label className="text-xs font-bold text-foreground">
                    {editingGroupId ? "Editar Nome do Grupo" : "Nome do Novo Grupo Personalizado"}
                  </Label>
                  <Input
                    value={groupNameInput}
                    onChange={(e) => setGroupNameInput(e.target.value)}
                    placeholder="Ex: Assistência Técnica, Pós-Venda, Comercial, Cobrança..."
                    className="h-10 text-xs rounded-xl bg-background border-border"
                  />
                </div>

                {/* Checklist de Templates para Vincular ao Grupo */}
                <div className="flex-1 flex flex-col min-h-0 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                    <Label className="text-xs font-bold text-foreground">
                      Vincular Templates a este Grupo ({groupTemplateIds.length} selecionado{groupTemplateIds.length === 1 ? "" : "s"})
                    </Label>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          const visibleIds = groupModalFilteredTemplates.map((t) => t.metaTemplateId);
                          setGroupTemplateIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
                        }}
                        className="font-semibold text-primary hover:underline cursor-pointer"
                      >
                        Marcar visíveis
                      </button>
                      <span className="text-muted-foreground">•</span>
                      <button
                        type="button"
                        onClick={() => setGroupTemplateIds([])}
                        className="font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        Limpar seleção
                      </button>
                    </div>
                  </div>

                  <div className="relative shrink-0">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={groupTemplateSearch}
                      onChange={(e) => setGroupTemplateSearch(e.target.value)}
                      placeholder="Filtrar templates para vincular..."
                      className="pl-9 h-9 text-xs rounded-xl bg-background border-border"
                    />
                  </div>

                  <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-background/60 p-2 space-y-1.5 min-h-[180px]">
                    {groupModalFilteredTemplates.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        Nenhum template encontrado para este filtro.
                      </div>
                    ) : (
                      groupModalFilteredTemplates.map((tpl) => {
                        const checked = groupTemplateIds.includes(tpl.metaTemplateId);
                        return (
                          <label
                            key={tpl.metaTemplateId}
                            onClick={() => {
                              setGroupTemplateIds((prev) =>
                                checked
                                  ? prev.filter((id) => id !== tpl.metaTemplateId)
                                  : [...prev, tpl.metaTemplateId],
                              );
                            }}
                            className={`flex items-start gap-3 rounded-xl border p-2.5 text-xs transition-all cursor-pointer select-none ${
                              checked
                                ? "border-primary/50 bg-primary/5"
                                : "border-border/70 bg-card hover:border-primary/30"
                            }`}
                          >
                            <div
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                                checked
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background"
                              }`}
                            >
                              {checked && <Check className="h-3 w-3" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-mono font-bold text-foreground">{tpl.name}</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                    {tpl.category === "UTILITY" ? "Utilidade" : tpl.category}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">{tpl.status}</span>
                                </div>
                              </div>
                              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                                {tpl.bodyText}
                              </p>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer do Modal de Grupos */}
            <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-muted/20 shrink-0">
              <span className="text-[11px] text-muted-foreground">
                Os grupos são exclusivos para organização interna e aparecem nos seletores de envio do chat.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGroupModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border border-border text-foreground hover:bg-muted cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  disabled={savingGroup || !groupNameInput.trim()}
                  onClick={() => void handleSaveGroupWithLinks()}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-soft"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>{savingGroup ? "Salvando..." : editingGroupId ? "Salvar Alterações do Grupo" : "Criar Grupo e Vincular"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Simples de Configurar Variáveis */}
      {mappingId && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div>
              <h3 className="text-base font-bold text-foreground">Configurar Variáveis do Template</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Defina quais dados o sistema preencherá automaticamente ao enviar este template.
              </p>
            </div>

            <div className="space-y-3 py-2">
              {bodyVariableIndexes(
                templates.find((item) => item.metaTemplateId === mappingId)?.bodyText || ""
              ).map((index) => (
                <div key={index} className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-bold text-foreground font-mono">{`{{${index}}}`}</span>
                  <Select
                    value={mapping[String(index)] || "manual"}
                    onValueChange={(val) => setMapping({ ...mapping, [index]: val as TemplateBinding })}
                  >
                    <SelectTrigger className="w-48 h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[300]">
                      <SelectItem value="customer_name">@nome do cliente</SelectItem>
                      <SelectItem value="operator_name">@nome do operador</SelectItem>
                      <SelectItem value="manual">Preencher no envio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setMappingId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-border text-foreground hover:bg-muted cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void saveMapping()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 cursor-pointer shadow-soft"
              >
                Salvar Configuração
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DRAWER LATERAL (SHEET) COMPLETO DE NOVO / EDITAR TEMPLATE META ── */}
      <Sheet open={!!form} onOpenChange={(open) => { if (!open) setForm(null); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-4xl lg:max-w-5xl xl:max-w-6xl p-0 flex flex-col h-full bg-background border-l border-border"
        >
          {/* Header Fixo */}
          <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/20 shrink-0">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <MessageSquare className="h-5 w-5 fill-current" />
              </div>
              <div>
                <SheetTitle className="text-base font-bold text-foreground">
                  {form?.metaTemplateId ? "Editar Template Oficial Meta" : "Novo Template Oficial Meta"}
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">
                  Crie mensagens padronizadas em conformidade com as diretrizes do WhatsApp Cloud API.
                </SheetDescription>
              </div>
            </div>
          </div>

          {form && (
            /* Split-Screen: Formulário à Esquerda (65%) e Live Preview à Direita (35%) */
            <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 overflow-hidden">
              {/* ── COLUNA ESQUERDA: FORMULÁRIO COMPLETO ── */}
              <div className="lg:col-span-7 overflow-y-auto p-6 space-y-6 pr-4">
                {/* 1. Identificação Geral */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-primary" />
                    <span>Identificação, Categoria & Grupo Interno</span>
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1">
                        <Label className="text-xs font-semibold text-foreground">Nome Técnico do Template</Label>
                        <SystemTooltip content="Identificador único exigido pela Meta. Use apenas letras minúsculas sem acento, números e underline (_). Ex: retomar_atendimento">
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </SystemTooltip>
                      </div>
                      <Input
                        disabled={!!form.metaTemplateId}
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                        placeholder="ex: retomar_atendimento"
                        className="h-10 text-xs font-mono rounded-xl bg-background border-border"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1">
                        <Label className="text-xs font-semibold text-foreground">Idioma</Label>
                        <SystemTooltip content="Idioma no qual a mensagem foi redigida para a revisão da IA da Meta.">
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </SystemTooltip>
                      </div>
                      <Select
                        disabled={!!form.metaTemplateId}
                        value={form.language}
                        onValueChange={(val) => setForm({ ...form, language: val })}
                      >
                        <SelectTrigger className="h-10 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[300]">
                          <SelectItem value="pt_BR">Português (Brasil) - pt_BR</SelectItem>
                          <SelectItem value="en_US">Inglês (EUA) - en_US</SelectItem>
                          <SelectItem value="es_ES">Espanhol - es_ES</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs font-semibold text-foreground">Categoria Oficial da Meta</Label>
                      <SystemTooltip content="Utilidade: notificações operacionais, atualizações de pedidos e retomada pós-24h (tarifa menor). Marketing: promoções, ofertas e engajamento comercial.">
                        <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                      </SystemTooltip>
                    </div>
                    <Select
                      value={form.category}
                      onValueChange={(val) => setForm({ ...form, category: val as FormState["category"] })}
                    >
                      <SelectTrigger className="h-10 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[300]">
                        <SelectItem value="UTILITY">Utilidade (Atendimento & Transacional - Tarifa Econômica)</SelectItem>
                        <SelectItem value="MARKETING">Marketing (Campanhas & Ofertas Comerciais)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Grupos Internos da Operação */}
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Folder className="h-3.5 w-3.5 text-primary" />
                        <Label className="text-xs font-semibold text-foreground">
                          Grupo Interno da Operação (Opcional)
                        </Label>
                        <SystemTooltip content="Agrupamento personalizado (ex: Assistência Técnica, Pós-Venda) apenas para facilitar a busca pelos operadores no chat. Não tem impacto no cliente nem na Meta.">
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </SystemTooltip>
                      </div>
                      <span className="text-[10px] text-muted-foreground">Apenas organização interna</span>
                    </div>

                    {collectTemplateCustomGroups(templates, [
                      ...groups.map((g) => g.name),
                      ...(form.customGroups || []),
                    ]).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {collectTemplateCustomGroups(templates, [
                          ...groups.map((g) => g.name),
                          ...(form.customGroups || []),
                        ]).map((gName) => {
                          const isSelected = (form.customGroups || []).some(
                            (g) => g.toLowerCase() === gName.toLowerCase(),
                          );
                          return (
                            <button
                              key={gName}
                              type="button"
                              onClick={() => {
                                const current = form.customGroups || [];
                                const next = isSelected
                                  ? current.filter((g) => g.toLowerCase() !== gName.toLowerCase())
                                  : [...current, gName];
                                setForm({ ...form, customGroups: next });
                              }}
                              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary shadow-2xs"
                                  : "bg-background text-foreground border-border hover:border-primary/40"
                              }`}
                            >
                              {isSelected ? <Check className="h-3 w-3" /> : <Folder className="h-3 w-3 text-muted-foreground" />}
                              <span>{gName}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Input
                        value={formNewGroupInput}
                        onChange={(e) => setFormNewGroupInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const clean = formNewGroupInput.trim().replace(/\s+/g, " ");
                            if (clean) {
                              setForm({
                                ...form,
                                customGroups: normalizeTemplateCustomGroups([...(form.customGroups || []), clean]),
                              });
                              setFormNewGroupInput("");
                            }
                          }
                        }}
                        placeholder="Criar novo grupo interno (ex: Assistência Técnica, Pós-Venda)..."
                        className="h-9 text-xs rounded-xl bg-background border-border"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const clean = formNewGroupInput.trim().replace(/\s+/g, " ");
                          if (!clean) return;
                          setForm({
                            ...form,
                            customGroups: normalizeTemplateCustomGroups([...(form.customGroups || []), clean]),
                          });
                          setFormNewGroupInput("");
                        }}
                        className="px-3 h-9 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-colors cursor-pointer shrink-0"
                      >
                        + Adicionar Grupo
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2. Cabeçalho (Header - Opcional) */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Type className="h-3.5 w-3.5 text-primary" />
                      <span>Cabeçalho da Mensagem (Opcional)</span>
                    </h4>
                    <span className="text-[11px] text-muted-foreground">Mídia ou Texto em destaque</span>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">Tipo de Cabeçalho</Label>
                    <Select
                      value={form.headerType}
                      onValueChange={(val) => setForm({ ...form, headerType: val as HeaderType })}
                    >
                      <SelectTrigger className="h-10 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[300]">
                        <SelectItem value="NONE">Nenhum cabeçalho</SelectItem>
                        <SelectItem value="TEXT">Texto em Destaque (Título)</SelectItem>
                        <SelectItem value="IMAGE">Mídia: Imagem (JPG, PNG)</SelectItem>
                        <SelectItem value="VIDEO">Mídia: Vídeo (MP4)</SelectItem>
                        <SelectItem value="DOCUMENT">Mídia: Documento (PDF)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {form.headerType === "TEXT" && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <Label className="text-xs font-semibold text-foreground">Texto do Cabeçalho</Label>
                        <span className="text-[10px] text-muted-foreground">{form.headerText.length}/60</span>
                      </div>
                      <Input
                        maxLength={60}
                        value={form.headerText}
                        onChange={(e) => setForm({ ...form, headerText: e.target.value })}
                        placeholder="ex: Novidades da Tecfag"
                        className="h-10 text-xs rounded-xl bg-background border-border"
                      />
                    </div>
                  )}

                  {form.headerType !== "NONE" && form.headerType !== "TEXT" && (
                    <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 text-xs text-muted-foreground flex items-center gap-2.5">
                      {form.headerType === "IMAGE" ? <ImageIcon className="h-5 w-5 text-primary" /> : form.headerType === "VIDEO" ? <VideoIcon className="h-5 w-5 text-primary" /> : <FileText className="h-5 w-5 text-primary" />}
                      <span>A Meta aprova o modelo para envio de arquivos de <strong>{form.headerType}</strong>. O arquivo real é anexado no momento do disparo.</span>
                    </div>
                  )}
                </div>

                {/* 3. Mensagem Principal (Body) */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5 text-primary" />
                      <span>Corpo da Mensagem (Obrigatório)</span>
                    </h4>
                    <span className="text-[10px] text-muted-foreground">{form.bodyText.length}/1024 caracteres</span>
                  </div>

                  <div className="space-y-2">
                    <textarea
                      maxLength={1024}
                      value={form.bodyText}
                      onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
                      placeholder="Olá, {{1}}. Notamos seu interesse em nossos equipamentos e gostaríamos de retomar nosso contato..."
                      className="w-full min-h-[120px] rounded-xl border border-border bg-background p-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 leading-relaxed font-sans"
                    />

                    {/* Barra de atalhos rápidos */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-[11px] font-semibold text-muted-foreground">Inserir tag:</span>
                      <button
                        type="button"
                        onClick={() => insertVariable("customer_name")}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>@nome do cliente</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => insertVariable("operator_name")}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>@nome do operador</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => insertVariable("manual")}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-foreground hover:bg-muted/80 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Variável manual</span>
                      </button>
                    </div>
                  </div>

                  {/* Configuração de Exemplos & Mapeamento de Variáveis */}
                  {bodyVariableIndexes(form.bodyText).length > 0 && (
                    <div className="pt-3 border-t border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-bold text-foreground">
                          Mapeamento & Exemplos Obrigatórios da Meta
                        </Label>
                        <SystemTooltip content="A Meta exige um exemplo real para cada variável numérica para aprovar o template.">
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </SystemTooltip>
                      </div>

                      {bodyVariableIndexes(form.bodyText).map((index) => {
                        const num = String(index);
                        const binding = form.bindings[num] || "manual";
                        return (
                          <div key={index} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3 rounded-xl bg-muted/30 border border-border/60 items-center">
                            <div className="sm:col-span-3 flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-foreground bg-muted px-2 py-1 rounded">
                                {`{{${index}}}`}
                              </span>
                            </div>

                            <div className="sm:col-span-4">
                              <Select
                                value={binding}
                                onValueChange={(val) =>
                                  setForm({ ...form, bindings: { ...form.bindings, [num]: val as TemplateBinding } })
                                }
                              >
                                <SelectTrigger className="h-9 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="z-[300]">
                                  <SelectItem value="customer_name">@nome do cliente</SelectItem>
                                  <SelectItem value="operator_name">@nome do operador</SelectItem>
                                  <SelectItem value="manual">Manual no envio</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="sm:col-span-5">
                              <Input
                                value={form.examples[index - 1] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForm({
                                    ...form,
                                    examples: Array.from(
                                      { length: Math.max(form.examples.length, index) },
                                      (_, offset) => (offset === index - 1 ? val : form.examples[offset] || "")
                                    ),
                                  });
                                }}
                                placeholder={`Exemplo real para {{${index}}} (ex: Maria)`}
                                className="h-9 text-xs rounded-xl bg-background border-border"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 4. Rodapé (Footer - Opcional) */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Rodapé da Mensagem (Opcional)
                    </h4>
                    <span className="text-[10px] text-muted-foreground">{form.footerText.length}/60</span>
                  </div>
                  <Input
                    maxLength={60}
                    value={form.footerText}
                    onChange={(e) => setForm({ ...form, footerText: e.target.value })}
                    placeholder="ex: Para não receber mais novidades, responda PARAR"
                    className="h-10 text-xs rounded-xl bg-background border-border"
                  />
                </div>

                {/* 5. Botões Interativos (Buttons - Opcional) */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Botões Interativos (Opcional)
                    </h4>
                    <SystemTooltip content="A Meta permite até 3 botões de resposta rápida ou até 2 botões de chamada para ação (links ou telefones).">
                      <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                    </SystemTooltip>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">Tipo de Botões</Label>
                    <Select
                      value={form.buttonType}
                      onValueChange={(val) => {
                        const bType = val as ButtonType;
                        let initialButtons: TemplateButtonForm[] = [];
                        if (bType === "QUICK_REPLY") {
                          initialButtons = [{ type: "QUICK_REPLY", text: "Sim, tenho interesse" }];
                        } else if (bType === "CTA") {
                          initialButtons = [{ type: "URL", text: "Acessar Site", url: "https://tecfag.com.br" }];
                        }
                        setForm({ ...form, buttonType: bType, buttons: initialButtons });
                      }}
                    >
                      <SelectTrigger className="h-10 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[300]">
                        <SelectItem value="NONE">Nenhum botão</SelectItem>
                        <SelectItem value="QUICK_REPLY">Respostas Rápidas (Caixa de Escolha / Até 3)</SelectItem>
                        <SelectItem value="CTA">Chamada para Ação (Site e Telefone / Até 2)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {form.buttonType === "QUICK_REPLY" && (
                    <div className="space-y-3 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Botões de Resposta Rápida</span>
                        {form.buttons.length < 3 && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                buttons: [...form.buttons, { type: "QUICK_REPLY", text: `Opção ${form.buttons.length + 1}` }],
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Adicionar Botão</span>
                          </button>
                        )}
                      </div>

                      {form.buttons.map((btn, bIdx) => (
                        <div key={bIdx} className="flex items-center gap-2">
                          <Input
                            maxLength={25}
                            value={btn.text}
                            onChange={(e) => {
                              const val = e.target.value;
                              setForm({
                                ...form,
                                buttons: form.buttons.map((b, i) => (i === bIdx ? { ...b, text: val } : b)),
                              });
                            }}
                            placeholder={`Texto do botão ${bIdx + 1} (máx 25 car.)`}
                            className="h-9 text-xs rounded-xl bg-background border-border flex-1"
                          />
                          {form.buttons.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setForm({ ...form, buttons: form.buttons.filter((_, i) => i !== bIdx) })
                              }
                              className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer"
                              title="Remover botão"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {form.buttonType === "CTA" && (
                    <div className="space-y-3 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Botões de Chamada para Ação</span>
                        {form.buttons.length < 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                buttons: [...form.buttons, { type: "PHONE_NUMBER", text: "Ligar Agora", phoneNumber: "+5514991522605" }],
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Adicionar Ação</span>
                          </button>
                        )}
                      </div>

                      {form.buttons.map((btn, bIdx) => (
                        <div key={bIdx} className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <Select
                              value={btn.type}
                              onValueChange={(val) => {
                                setForm({
                                  ...form,
                                  buttons: form.buttons.map((b, i) =>
                                    i === bIdx
                                      ? {
                                          type: val as "URL" | "PHONE_NUMBER",
                                          text: b.text,
                                          url: val === "URL" ? "https://tecfag.com.br" : undefined,
                                          phoneNumber: val === "PHONE_NUMBER" ? "+5514991522605" : undefined,
                                        }
                                      : b
                                  ),
                                });
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs w-44">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="z-[300]">
                                <SelectItem value="URL">Visitar Site (URL)</SelectItem>
                                <SelectItem value="PHONE_NUMBER">Ligar para Telefone</SelectItem>
                              </SelectContent>
                            </Select>

                            <button
                              type="button"
                              onClick={() =>
                                setForm({ ...form, buttons: form.buttons.filter((_, i) => i !== bIdx) })
                              }
                              className="p-1 text-destructive hover:bg-destructive/10 rounded transition-colors cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Input
                              maxLength={25}
                              value={btn.text}
                              onChange={(e) => {
                                const val = e.target.value;
                                setForm({
                                  ...form,
                                  buttons: form.buttons.map((b, i) => (i === bIdx ? { ...b, text: val } : b)),
                                });
                              }}
                              placeholder="Texto do botão (máx 25)"
                              className="h-8 text-xs rounded-lg bg-background border-border"
                            />
                            {btn.type === "URL" ? (
                              <Input
                                value={btn.url || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForm({
                                    ...form,
                                    buttons: form.buttons.map((b, i) => (i === bIdx ? { ...b, url: val } : b)),
                                  });
                                }}
                                placeholder="https://tecfag.com.br"
                                className="h-8 text-xs rounded-lg bg-background border-border"
                              />
                            ) : (
                              <Input
                                value={btn.phoneNumber || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForm({
                                    ...form,
                                    buttons: form.buttons.map((b, i) => (i === bIdx ? { ...b, phoneNumber: val } : b)),
                                  });
                                }}
                                placeholder="+55 14 99152-2605"
                                className="h-8 text-xs rounded-lg bg-background border-border"
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── COLUNA DIREITA: LIVE PREVIEW REALISTA DO WHATSAPP ── */}
              <div className="lg:col-span-5 bg-muted/30 border-l border-border/80 p-6 flex flex-col items-center justify-center shrink-0">
                <div className="w-full max-w-sm flex flex-col items-center space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground self-start">
                    <Eye className="h-4 w-4 text-primary" />
                    <span>Visualização em Tempo Real (WhatsApp)</span>
                  </div>

                  {/* Smartphone Frame / Mockup WhatsApp */}
                  <div className="w-full rounded-3xl border-4 border-muted-foreground/30 bg-[#0b141a] text-white shadow-2xl overflow-hidden flex flex-col h-[520px]">
                    {/* Header do WhatsApp */}
                    <div className="bg-[#1f2c34] px-4 py-3 flex items-center justify-between border-b border-white/5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-xs text-white">
                          T
                        </div>
                        <div>
                          <p className="text-xs font-bold leading-none text-white">Tecfag Atendimento</p>
                          <p className="text-[10px] text-emerald-400 leading-none mt-1">online</p>
                        </div>
                      </div>
                    </div>

                    {/* Chat Area com Wallpaper sutil */}
                    <div className="flex-1 p-3.5 overflow-y-auto flex flex-col justify-end bg-[#0b141a]">
                      {/* Balão WhatsApp Oficial */}
                      <div className="max-w-[90%] self-end rounded-2xl rounded-tr-xs bg-[#005c4b] text-white text-xs p-3 shadow-md space-y-2 border border-emerald-800/40">
                        {/* Header de Mídia ou Texto */}
                        {form.headerType === "TEXT" && form.headerText && (
                          <p className="font-bold text-white text-xs border-b border-emerald-700/60 pb-1">
                            {form.headerText}
                          </p>
                        )}
                        {form.headerType === "IMAGE" && (
                          <div className="w-full h-28 rounded-lg bg-emerald-950/60 flex flex-col items-center justify-center border border-emerald-800/50 text-emerald-300">
                            <ImageIcon className="h-8 w-8 mb-1 opacity-70" />
                            <span className="text-[10px] font-semibold">Imagem do Cabeçalho</span>
                          </div>
                        )}
                        {form.headerType === "VIDEO" && (
                          <div className="w-full h-28 rounded-lg bg-emerald-950/60 flex flex-col items-center justify-center border border-emerald-800/50 text-emerald-300">
                            <VideoIcon className="h-8 w-8 mb-1 opacity-70" />
                            <span className="text-[10px] font-semibold">Vídeo de Apresentação</span>
                          </div>
                        )}
                        {form.headerType === "DOCUMENT" && (
                          <div className="p-2.5 rounded-lg bg-emerald-950/60 flex items-center gap-2 border border-emerald-800/50 text-emerald-200">
                            <FileText className="h-5 w-5 text-emerald-400 shrink-0" />
                            <span className="text-[10px] font-medium truncate">Documento_Oficial.pdf</span>
                          </div>
                        )}

                        {/* Corpo Interpolado */}
                        <p className="whitespace-pre-wrap leading-relaxed font-sans text-white/95">
                          {livePreviewBody || "Digite a mensagem do template para ver a prévia..."}
                        </p>

                        {/* Rodapé */}
                        {form.footerText && (
                          <p className="text-[10px] text-white/60 italic pt-0.5 border-t border-emerald-700/40">
                            {form.footerText}
                          </p>
                        )}

                        {/* Horário & Double Check */}
                        <div className="flex items-center justify-end gap-1 text-[9px] text-white/70 pt-0.5">
                          <span>17:15</span>
                          <span className="text-sky-400 font-bold">✓✓</span>
                        </div>
                      </div>

                      {/* Botões do WhatsApp abaixo do balão */}
                      {form.buttonType !== "NONE" && form.buttons.length > 0 && (
                        <div className="max-w-[90%] self-end w-full mt-1.5 space-y-1">
                          {form.buttons.map((btn, bIdx) => (
                            <div
                              key={bIdx}
                              className="w-full py-2 px-3 rounded-xl bg-[#1f2c34] text-sky-400 text-center font-semibold text-xs border border-white/5 flex items-center justify-center gap-1.5 shadow-xs"
                            >
                              {btn.type === "URL" ? (
                                <ExternalLink className="h-3 w-3 text-sky-400" />
                              ) : btn.type === "PHONE_NUMBER" ? (
                                <PhoneCall className="h-3 w-3 text-sky-400" />
                              ) : (
                                <MessageSquare className="h-3 w-3 text-sky-400" />
                              )}
                              <span>{btn.text || `Botão ${bIdx + 1}`}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer Fixo do Sheet */}
          <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-muted/20 shrink-0">
            <button
              type="button"
              onClick={() => setForm(null)}
              className="px-4 py-2 rounded-xl text-xs font-semibold border border-border text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || !form?.name || !form?.bodyText}
              onClick={() => void save()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer shadow-soft"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <SendIcon className="h-3.5 w-3.5" />}
              <span>{saving ? "Enviando à Meta..." : form?.metaTemplateId ? "Salvar Alterações" : "Enviar para Análise da Meta"}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function SendIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
