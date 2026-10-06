import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { STANDARD_CATALOG_ITEMS, type CatalogKind } from "@/lib/crm/catalogs";
import { Switch } from "@/components/ui/switch";
import { SystemTooltip } from "@/components/ui/tooltip";

export type CatalogScope = "sources_campaigns" | "loss_reasons" | "segments" | "all";

type Item = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type CatalogTabMeta = {
  kind: CatalogKind;
  label: string;
  description: string;
  itemLabel: string;
  itemPlural: string;
};

const allTabs: Record<CatalogKind, CatalogTabMeta> = {
  segment: {
    kind: "segment",
    label: "Segmentos",
    description: "Classifique as empresas para filtrar e organizar sua carteira de clientes.",
    itemLabel: "Segmento",
    itemPlural: "Segmentos",
  },
  source: {
    kind: "source",
    label: "Fontes",
    description: "Identifique a origem e canal de aquisição de cada negociação comercial.",
    itemLabel: "Fonte",
    itemPlural: "Fontes",
  },
  campaign: {
    kind: "campaign",
    label: "Campanhas",
    description: "Organize as campanhas de marketing e mídia associadas às negociações.",
    itemLabel: "Campanha",
    itemPlural: "Campanhas",
  },
  loss_reason: {
    kind: "loss_reason",
    label: "Motivos de perda",
    description: "Padronize os motivos informados pela equipe ao encerrar uma negociação como perdida.",
    itemLabel: "Motivo de perda",
    itemPlural: "Motivos de perda",
  },
};

function getScopeTabs(scope: CatalogScope): CatalogTabMeta[] {
  if (scope === "sources_campaigns") return [allTabs.source, allTabs.campaign];
  if (scope === "segments") return [allTabs.segment];
  if (scope === "loss_reasons") return [allTabs.loss_reason];
  return [allTabs.segment, allTabs.source, allTabs.campaign, allTabs.loss_reason];
}

export function CrmCatalogSettingsModal({
  isOpen,
  onClose,
  initialKind,
  scope,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialKind?: CatalogKind;
  scope?: CatalogScope;
}) {
  const resolvedScope: CatalogScope =
    scope ??
    (initialKind === "segment"
      ? "segments"
      : initialKind === "loss_reason"
        ? "loss_reasons"
        : initialKind === "source" || initialKind === "campaign"
          ? "sources_campaigns"
          : "all");

  const scopeTabs = getScopeTabs(resolvedScope);

  const defaultKind =
    initialKind && scopeTabs.some((t) => t.kind === initialKind)
      ? initialKind
      : scopeTabs[0].kind;

  const [kind, setKind] = useState<CatalogKind>(defaultKind);
  const [items, setItems] = useState<Item[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allowUserCreate, setAllowUserCreate] = useState(false);
  const [includeStandard, setIncludeStandard] = useState(true);
  const [disabledStandardItems, setDisabledStandardItems] = useState<string[]>([]);
  const [updatingStandard, setUpdatingStandard] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Item | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const target =
        initialKind && scopeTabs.some((t) => t.kind === initialKind)
          ? initialKind
          : scopeTabs[0].kind;
      setKind(target);
      setSearch("");
      setDraft(null);
    }
  }, [isOpen, initialKind, resolvedScope]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/crm/catalogs?kind=${kind}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar o catálogo.");
      setItems(data.items || []);
      setIsAdmin(data.isAdmin);
      setAllowUserCreate(data.allowUserCreate ?? false);
      setIncludeStandard(data.includeStandard ?? true);
      setDisabledStandardItems(data.disabledStandardItems || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao carregar catálogo.");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  const currentTab = allTabs[kind];

  const openDraft = (item: Item | "new") => {
    setDraft(item);
    setName(item === "new" ? "" : item.name);
    setDescription(item === "new" ? "" : item.description || "");
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const response = await fetch(
        draft === "new" ? "/api/crm/catalogs" : `/api/crm/catalogs/${(draft as Item).id}`,
        {
          method: draft === "new" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, name: name.trim(), description: description.trim() }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setDraft(null);
      await load();
      toast.success(draft === "new" ? "Item criado com sucesso." : "Item atualizado com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const archive = async (item: Item) => {
    if (
      !window.confirm(
        `Arquivar "${item.name}"? Os registros já preenchidos continuarão preservados.`,
      )
    )
      return;
    try {
      const response = await fetch(`/api/crm/catalogs/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Não foi possível arquivar.");
      }
      await load();
      toast.success("Item arquivado com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível arquivar.");
    }
  };

  const togglePolicy = async () => {
    try {
      const response = await fetch("/api/crm/catalogs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, allowUserCreate: !allowUserCreate }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Não foi possível alterar a preferência.");
      }
      setAllowUserCreate(!allowUserCreate);
      toast.success(
        !allowUserCreate
          ? "Criação rápida permitida para operadores."
          : "Criação restrita aos administradores.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível alterar a preferência.",
      );
    }
  };

  const toggleIncludeStandard = async (targetValue?: boolean) => {
    if (!isAdmin) return;
    const nextValue = typeof targetValue === "boolean" ? targetValue : !includeStandard;
    const prevValue = includeStandard;
    setIncludeStandard(nextValue);
    setUpdatingStandard(true);
    try {
      const response = await fetch("/api/crm/catalogs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          includeStandard: nextValue,
          disabledStandardItems,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Não foi possível alterar a preferência.");
      }
      toast.success(
        nextValue
          ? `${currentTab.itemPlural} padrão ativad${kind === "campaign" || kind === "source" ? "as" : "os"} com sucesso.`
          : `${currentTab.itemPlural} padrão desativad${kind === "campaign" || kind === "source" ? "as" : "os"}. Apenas opções personalizadas serão utilizadas.`,
      );
    } catch (error) {
      setIncludeStandard(prevValue);
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar a preferência.");
    } finally {
      setUpdatingStandard(false);
    }
  };

  const toggleStandardItem = async (itemName: string) => {
    if (!isAdmin) return;
    const isCurrentlyDisabled = disabledStandardItems.includes(itemName);
    const nextDisabled = isCurrentlyDisabled
      ? disabledStandardItems.filter((name) => name !== itemName)
      : [...disabledStandardItems, itemName];

    const prevDisabled = disabledStandardItems;
    setDisabledStandardItems(nextDisabled);
    setUpdatingStandard(true);
    try {
      const response = await fetch("/api/crm/catalogs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          includeStandard,
          disabledStandardItems: nextDisabled,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Não foi possível atualizar o item padrão.");
      }
      toast.success(
        isCurrentlyDisabled
          ? `"${itemName}" reativado.`
          : `"${itemName}" desativado.`,
      );
    } catch (error) {
      setDisabledStandardItems(prevDisabled);
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar item padrão.");
    } finally {
      setUpdatingStandard(false);
    }
  };

  const setAllStandardStatus = async (activate: boolean) => {
    if (!isAdmin) return;
    const standards = Array.from(STANDARD_CATALOG_ITEMS[kind] || []);
    const nextDisabled = activate ? [] : standards;
    const prevDisabled = disabledStandardItems;
    const prevInclude = includeStandard;

    setIncludeStandard(true);
    setDisabledStandardItems(nextDisabled);
    setUpdatingStandard(true);
    try {
      const response = await fetch("/api/crm/catalogs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          includeStandard: true,
          disabledStandardItems: nextDisabled,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Não foi possível atualizar.");
      }
      toast.success(
        activate
          ? `Todos os ${currentTab.itemPlural.toLowerCase()} padrão foram ativados.`
          : `Todos os ${currentTab.itemPlural.toLowerCase()} padrão foram desativados.`,
      );
    } catch (error) {
      setDisabledStandardItems(prevDisabled);
      setIncludeStandard(prevInclude);
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar.");
    } finally {
      setUpdatingStandard(false);
    }
  };

  const visible = items.filter((item) =>
    item.name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")),
  );

  const getModalTitle = () => {
    if (resolvedScope === "sources_campaigns") return "Configurar fontes e campanhas";
    if (resolvedScope === "segments") return "Configurar segmentos";
    if (resolvedScope === "loss_reasons") return "Configurar motivos de perda";
    return "Catálogos do CRM";
  };

  const getCreateButtonLabel = () => {
    if (kind === "campaign") return "Criar campanha";
    if (kind === "source") return "Criar fonte";
    if (kind === "segment") return "Criar segmento";
    if (kind === "loss_reason") return "Criar motivo";
    return "Criar item";
  };

  const getPreferenceBadgeText = () => {
    if (kind === "segment") return "Visível no cadastro de empresa";
    if (kind === "loss_reason") return "Obrigatório no fechamento";
    if (kind === "campaign") return "Visível no cadastro e negociação";
    return "Visível no cadastro e negociação";
  };

  const getSystemBadgeText = () => {
    if (kind === "segment") return "Segmento do sistema";
    if (kind === "loss_reason") return "Motivo do sistema";
    if (kind === "campaign") return "Campanha do sistema";
    return "Origem do sistema";
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label={getModalTitle()}
    >
      {/* HEADER NO PADRÃO DE CAMPOS DE CADASTRO */}
      <header className="flex items-center justify-between border-b border-border bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Voltar ao CRM"
            className="rounded-lg p-2 text-primary hover:bg-primary/10 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium">Configurações do CRM</p>
            <h2 className="text-lg font-bold text-foreground">{getModalTitle()}</h2>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {isAdmin && (
            <button
              type="button"
              onClick={() => openDraft("new")}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 transition shadow-soft cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" /> {getCreateButtonLabel()}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ÁREA PRINCIPAL */}
      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-6xl">
          {/* ABAS NO MESMO PADRÃO COM INDICADOR SMOOTH */}
          {scopeTabs.length > 1 && (
            <nav className="flex gap-6 border-b border-border" aria-label="Abas de configuração">
              {scopeTabs.map((tab) => {
                const active = kind === tab.kind;
                return (
                  <button
                    key={tab.kind}
                    type="button"
                    onClick={() => {
                      setKind(tab.kind);
                      setSearch("");
                      setDraft(null);
                    }}
                    className={`relative pb-3 text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                      active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                    {active && (
                      <motion.div
                        layoutId="catalog-active-tab-indicator"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                        transition={{ type: "spring", stiffness: 450, damping: 32 }}
                      />
                    )}
                  </button>
                );
              })}
            </nav>
          )}

          {/* TRANSIÇÃO SUAVE ENTRE CONTEÚDOS */}
          <AnimatePresence mode="wait">
            <motion.div
              key={kind}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={scopeTabs.length > 1 ? "mt-7 space-y-10" : "space-y-10"}
            >
              {/* SEÇÃO 1: ITENS PERSONALIZADOS */}
              <section>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      {currentTab.itemPlural} personalizad
                      {kind === "campaign" || kind === "source" ? "as" : "os"}{" "}
                      <span className="text-muted-foreground">({items.length})</span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {currentTab.description}
                    </p>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={`Buscar ${currentTab.itemLabel.toLowerCase()}...`}
                      className="h-8 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition"
                    />
                  </div>
                </div>

                {/* CARD DE POLÍTICA DE CRIAÇÃO RÁPIDA (QUANDO APLICÁVEL) */}
                {kind !== "loss_reason" && isAdmin && (
                  <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-soft flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="text-xs font-semibold text-foreground">
                        Criação rápida por operadores
                      </span>
                      <p className="text-[11px] text-muted-foreground">
                        {kind === "segment"
                          ? "Permitir que operadores criem novos segmentos diretamente na ficha da empresa."
                          : `Permitir que operadores criem novas ${currentTab.label.toLowerCase()} diretamente na negociação.`}
                      </p>
                    </div>
                    <Switch
                      checked={allowUserCreate}
                      onCheckedChange={() => void togglePolicy()}
                    />
                  </div>
                )}

                {/* TABELA DE ITENS NO PADRÃO VISUAL */}
                {loading ? (
                  <p className="py-8 text-xs text-muted-foreground">Carregando itens...</p>
                ) : !items.length ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                    Nenhum(a) {currentTab.itemLabel.toLowerCase()} personalizad
                    {kind === "campaign" || kind === "source" ? "a" : "o"} criado(a).
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
                    <table className="w-full min-w-[760px] text-left text-xs">
                      <thead className="border-b border-border bg-muted/30 text-[10px] uppercase text-muted-foreground font-semibold">
                        <tr>
                          <th className="p-3">
                            Nome {currentTab.itemLabel.toLowerCase().startsWith("a") ? "da" : "do"}{" "}
                            {currentTab.itemLabel.toLowerCase()}
                          </th>
                          {kind === "campaign" && <th className="p-3">Descrição</th>}
                          <th className="p-3">Preferências</th>
                          <th className="p-3">Criado em</th>
                          <th className="p-3">Atualizado em</th>
                          {isAdmin && <th className="p-3">Ações</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((item) => (
                          <tr
                            key={item.id}
                            className="border-b border-border/60 last:border-0 hover:bg-muted/15 transition-colors"
                          >
                            <td className="p-3">
                              <b className="block text-foreground">{item.name}</b>
                              <span className="text-[10px] text-muted-foreground font-mono">
                                ID: {item.id}
                              </span>
                            </td>
                            {kind === "campaign" && (
                              <td className="p-3 text-muted-foreground max-w-xs truncate">
                                {item.description || "—"}
                              </td>
                            )}
                            <td className="p-3">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                                {getPreferenceBadgeText()}
                              </span>
                            </td>
                            <td className="p-3 text-muted-foreground">
                              {new Date(item.createdAt).toLocaleDateString("pt-BR")}
                            </td>
                            <td className="p-3 text-muted-foreground">
                              {new Date(item.updatedAt).toLocaleDateString("pt-BR")}
                            </td>
                            {isAdmin && (
                              <td className="p-3 whitespace-nowrap">
                                <div className="flex gap-3">
                                  <button
                                    type="button"
                                    onClick={() => openDraft(item)}
                                    className="font-semibold text-primary hover:underline cursor-pointer"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void archive(item)}
                                    className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                                  >
                                    Arquivar
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {visible.length === 0 && (
                      <p className="p-6 text-center text-xs text-muted-foreground">
                        Nenhum resultado encontrado para &quot;{search}&quot;.
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* SEÇÃO 2: ITENS PADRÃO DO SISTEMA COM CONTROLE DE ATIVAÇÃO / DESATIVAÇÃO */}
              <section>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      {kind === "segment"
                        ? "Segmentos padrão"
                        : kind === "source"
                          ? "Fontes padrão"
                          : kind === "campaign"
                            ? "Campanhas padrão"
                            : "Motivos padrão"}
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {kind === "loss_reason"
                        ? "Motivos de perda fornecidos de fábrica pelo sistema. Você pode desativá-los para manter apenas os motivos personalizados da sua empresa."
                        : `Itens de ${currentTab.label.toLowerCase()} fornecidos pelo sistema. Você pode ativá-los ou desativá-los conforme a necessidade da operação.`}
                    </p>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={updatingStandard}
                        onClick={() => void setAllStandardStatus(false)}
                        className="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer disabled:opacity-50"
                      >
                        Desativar todos
                      </button>
                      <span className="text-muted-foreground/40 text-xs">•</span>
                      <button
                        type="button"
                        disabled={updatingStandard}
                        onClick={() => void setAllStandardStatus(true)}
                        className="text-[11px] font-semibold text-primary hover:underline transition cursor-pointer disabled:opacity-50"
                      >
                        Ativar todos
                      </button>
                    </div>
                  )}
                </div>

                {/* CARD DE CONTROLE GERAL DOS ITENS PADRÃO */}
                {isAdmin && (
                  <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-soft flex items-center justify-between">
                    <div className="space-y-0.5 pr-4">
                      <span className="text-xs font-semibold text-foreground">
                        {kind === "loss_reason"
                          ? "Habilitar motivos de perda padrão do sistema"
                          : `Habilitar ${currentTab.label.toLowerCase()} padrão do sistema`}
                      </span>
                      <p className="text-[11px] text-muted-foreground">
                        {includeStandard
                          ? "Ativo. Os itens abaixo com chave ligada estarão disponíveis nas opções operacionais do CRM."
                          : "Desativado globalmente. Apenas itens personalizados cadastrados pela sua empresa estarão disponíveis."}
                      </p>
                    </div>
                    <Switch
                      checked={includeStandard}
                      disabled={updatingStandard}
                      onCheckedChange={(val) => void toggleIncludeStandard(val)}
                    />
                  </div>
                )}

                {/* LISTA DE ITENS PADRÃO COM CONTROLE INDIVIDUAL */}
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
                  {STANDARD_CATALOG_ITEMS[kind].map((name) => {
                    const isItemDisabled = !includeStandard || disabledStandardItems.includes(name);
                    const isActive = !isItemDisabled;

                    return (
                      <div
                        key={name}
                        className={`flex justify-between items-center border-b border-border/60 px-4 py-3 text-xs last:border-0 transition-colors ${
                          isActive ? "hover:bg-muted/10" : "bg-muted/5 opacity-75"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <span
                            className={`font-semibold block ${
                              isActive
                                ? "text-foreground"
                                : "text-muted-foreground line-through decoration-muted-foreground/50"
                            }`}
                          >
                            {name}
                          </span>
                          <span className="text-muted-foreground text-[10px] flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                            {getSystemBadgeText()}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          {isActive ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Ativo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                              Desativado
                            </span>
                          )}

                          {isAdmin && (
                            <Switch
                              checked={isActive}
                              disabled={updatingStandard}
                              onCheckedChange={() => {
                                if (!includeStandard) {
                                  const standards = Array.from(STANDARD_CATALOG_ITEMS[kind] || []);
                                  const otherDisabled = standards.filter((s) => s !== name);
                                  setIncludeStandard(true);
                                  setDisabledStandardItems(otherDisabled);
                                  void fetch("/api/crm/catalogs", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      kind,
                                      includeStandard: true,
                                      disabledStandardItems: otherDisabled,
                                    }),
                                  });
                                } else {
                                  void toggleStandardItem(name);
                                }
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* DRAWER LATERAL DE CRIAÇÃO / EDIÇÃO COM ANIMAÇÕES SMOOTH */}
      <AnimatePresence>
        {draft && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[110] flex justify-end bg-black/50 backdrop-blur-xs"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDraft(null);
            }}
          >
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="flex h-full w-full max-w-[460px] flex-col bg-card shadow-2xl border-l border-border"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h3 className="text-sm font-bold text-foreground">
                  {draft === "new"
                    ? `Adicionar ${currentTab.itemLabel.toLowerCase()}`
                    : `Editar ${currentTab.itemLabel.toLowerCase()}`}
                </h3>
                <SystemTooltip content="Fechar gaveta">
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    aria-label="Fechar"
                    className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </SystemTooltip>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
                  <p className="font-semibold text-muted-foreground">
                    Catálogo: {currentTab.label}
                  </p>
                  <label className="block space-y-1.5 font-semibold text-foreground">
                    Nome{" "}
                    {currentTab.itemLabel.toLowerCase().startsWith("a") ? "da" : "do"}{" "}
                    {currentTab.itemLabel.toLowerCase()} *
                    <input
                      autoFocus
                      required
                      maxLength={120}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={`Ex: Nome d${
                        currentTab.itemLabel.toLowerCase().startsWith("a") ? "a" : "o"
                      } ${currentTab.itemLabel.toLowerCase()}`}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 font-normal text-xs text-foreground focus:outline-none focus:border-primary transition"
                    />
                  </label>

                  {kind === "campaign" && (
                    <label className="block space-y-1.5 font-semibold text-foreground">
                      Descrição
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        maxLength={500}
                        rows={4}
                        placeholder="Detalhes ou objetivos desta campanha..."
                        className="w-full rounded-lg border border-border bg-background p-3 font-normal text-xs text-foreground focus:outline-none focus:border-primary transition resize-none"
                      />
                    </label>
                  )}
                </div>

                <div className="flex justify-end gap-2 border-t border-border p-4 bg-card">
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="rounded-lg border border-border bg-muted/50 px-4 py-2 font-semibold text-xs text-foreground hover:bg-muted transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !name.trim()}
                    className="rounded-lg bg-primary px-4 py-2 font-bold text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50 transition shadow-soft cursor-pointer"
                  >
                    {saving ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </form>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
