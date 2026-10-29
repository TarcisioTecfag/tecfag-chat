import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Info,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CustomFieldsEditor,
  changedCustomFieldValues,
  useCustomFields,
} from "./CustomFieldsEditor";
import {
  classifyCrmProductGroup,
  filterAndGroupCatalogProducts,
  formatShortProductCategory,
  type CrmProductGroup,
  type CrmProductGroupFilter,
} from "@/lib/crm/product-grouping";

export interface CrmProductItem {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unitPrice: string;
  unit: string;
  category: string | null;
  isActive: boolean;
  customFields: Record<string, unknown>;
}

function formatBrlValue(raw: string | number | null | undefined): string {
  const num = typeof raw === "number" ? raw : Number.parseFloat(String(raw || "0"));
  if (!Number.isFinite(num)) return "R$ 0,00";
  return num.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatCurrencyInputDisplay(rawPrice: string | number | null | undefined): string {
  const num = typeof rawPrice === "number" ? rawPrice : Number.parseFloat(String(rawPrice || "0"));
  if (!Number.isFinite(num) || num <= 0) return "";
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseCurrencyInputToDecimalString(input: string): string {
  const cleaned = String(input || "")
    .replace(/[R$\s]/gi, "")
    .trim();
  if (!cleaned) return "0.00";
  const normalized =
    cleaned.includes(",") && cleaned.includes(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.includes(",")
        ? cleaned.replace(",", ".")
        : cleaned;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : "0.00";
}

export function CrmProductsSettingsModal({
  isOpen,
  onClose,
  onOpenCustomFields,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenCustomFields?: () => void;
}) {
  const [products, setProducts] = useState<CrmProductItem[]>([]);
  const [canManage, setCanManage] = useState(true);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<CrmProductGroupFilter>("all");
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Drawer de criar / editar produto ou serviço
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CrmProductItem | null>(null);
  const [showCustomFieldsBanner, setShowCustomFieldsBanner] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [productGroup, setProductGroup] = useState<CrmProductGroup>("maquinas");
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // Popover de ações por linha e confirmação de exclusão
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<CrmProductItem | null>(null);
  const [deletingLoading, setDeletingLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Modal de Importação / Sincronização VTEX
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [syncingVtex, setSyncingVtex] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [csvText, setCsvText] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const productCustomFields = useCustomFields("product", isOpen);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/crm/products", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível carregar os produtos e serviços.");
      }
      setProducts(data.products || []);
      if (typeof data.canManageProducts === "boolean") {
        setCanManage(data.canManageProducts);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao carregar produtos e serviços."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadProducts();
      setSearch("");
      setGroupFilter("all");
      setCurrentPage(1);
      setDrawerOpen(false);
      setEditing(null);
    }
  }, [isOpen, loadProducts]);

  const groupedCatalog = useMemo(
    () => filterAndGroupCatalogProducts(products, search, groupFilter),
    [products, search, groupFilter],
  );

  const filteredProducts = groupedCatalog.filtered;

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [search, groupFilter, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, currentPage, pageSize]);

  const visiblePageNumbers = useMemo(() => {
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + maxButtons - 1);
    if (end - start + 1 < maxButtons) {
      start = Math.max(1, end - maxButtons + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [currentPage, totalPages]);

  if (!isOpen) return null;

  const openDrawer = (product?: CrmProductItem) => {
    setEditing(product || null);
    setName(product?.name || "");
    setDescription(product?.description || "");
    setPriceInput(product ? formatCurrencyInputDisplay(product.unitPrice) : "");
    setProductGroup(
      product
        ? classifyCrmProductGroup(product)
        : groupFilter !== "all"
          ? groupFilter
          : "maquinas",
    );
    setCustomFields(product?.customFields || {});
    setShowCustomFieldsBanner(true);
    setDrawerOpen(true);
  };

  const handleSaveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Informe o nome do produto ou serviço.");
      return;
    }

    setSaving(true);
    try {
      const normalizedPrice = parseCurrencyInputToDecimalString(priceInput);
      const resolvedCategory =
        productGroup === "pecas"
          ? "Peças e Insumos"
          : productGroup === "servicos"
            ? "Serviços"
            : editing?.category && classifyCrmProductGroup(editing) === "maquinas"
              ? editing.category
              : "Máquinas e Equipamentos";

      const response = await fetch(
        editing ? `/api/crm/products/${editing.id}` : "/api/crm/products",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            unitPrice: normalizedPrice,
            category: resolvedCategory,
            customFields: editing
              ? changedCustomFieldValues(editing.customFields || {}, customFields)
              : customFields,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível salvar o produto ou serviço.");
      }
      toast.success(
        editing
          ? "Produto ou serviço atualizado com sucesso."
          : "Produto ou serviço cadastrado com sucesso."
      );
      setDrawerOpen(false);
      setEditing(null);
      await loadProducts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar produto.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (product: CrmProductItem, nextActive: boolean) => {
    if (!canManage) return;
    setTogglingId(product.id);
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, isActive: nextActive } : p))
    );
    try {
      const response = await fetch(`/api/crm/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Não foi possível alterar a exibição na negociação.");
      }
      toast.success(
        nextActive
          ? `"${product.name}" habilitado para exibição nas negociações.`
          : `"${product.name}" ocultado das negociações.`
      );
    } catch (error) {
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, isActive: product.isActive } : p))
      );
      toast.error(
        error instanceof Error ? error.message : "Erro ao atualizar visibilidade."
      );
    } finally {
      setTogglingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingProduct) return;
    setDeletingLoading(true);
    try {
      const response = await fetch(`/api/crm/products/${deletingProduct.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Não foi possível excluir o produto ou serviço.");
      }
      toast.success(`"${deletingProduct.name}" excluído com sucesso.`);
      setDeletingProduct(null);
      await loadProducts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao excluir item.");
    } finally {
      setDeletingLoading(false);
    }
  };

  const handleSyncVtex = async () => {
    setSyncingVtex(true);
    try {
      const response = await fetch("/api/crm/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_vtex" }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Falha ao sincronizar catálogo da VTEX.");
      }
      toast.success(
        `${data.synced || 0} produtos sincronizados da loja VTEX com sucesso!`
      );
      setImportModalOpen(false);
      await loadProducts();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao sincronizar catálogo VTEX."
      );
    } finally {
      setSyncingVtex(false);
    }
  };

  const parseCsvLinesToItems = (rawText: string) => {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];

    const items: Array<{ name: string; description: string | null; unitPrice: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const sep = line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
      const parts = line.split(sep).map((p) => p.replace(/^["']|["']$/g, "").trim());
      if (
        i === 0 &&
        /^(nome|produto|item|name)$/i.test(parts[0] || "")
      ) {
        continue;
      }
      const itemName = parts[0] || "";
      if (!itemName) continue;
      const itemDesc = parts.length >= 3 ? parts[1] || null : null;
      const rawVal = parts.length >= 3 ? parts[2] : parts[1] || "0";
      items.push({
        name: itemName,
        description: itemDesc,
        unitPrice: parseCurrencyInputToDecimalString(rawVal),
      });
    }
    return items;
  };

  const handleImportCsvSubmit = async () => {
    const parsedItems = parseCsvLinesToItems(csvText);
    if (parsedItems.length === 0) {
      toast.error("Informe ao menos uma linha válida (Nome;Descrição;Valor).");
      return;
    }
    setImportingCsv(true);
    try {
      const response = await fetch("/api/crm/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import_batch", items: parsedItems }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Falha ao importar produtos.");
      }
      toast.success(`${data.imported || parsedItems.length} produtos importados com sucesso!`);
      setCsvText("");
      setImportModalOpen(false);
      await loadProducts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao importar lista.");
    } finally {
      setImportingCsv(false);
    }
  };

  const handleCsvFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setCsvText(text);
    } catch {
      toast.error("Não foi possível ler o arquivo selecionado.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label="Produtos e Serviços"
    >
      {/* CABEÇALHO SEGUINDO A REFERÊNCIA VISUAL E O DESIGN SYSTEM */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <SystemTooltip content="Voltar às Configurações do CRM">
            <button
              type="button"
              onClick={onClose}
              aria-label="Voltar ao CRM"
              className="rounded-lg p-2 text-primary hover:bg-primary/10 transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </SystemTooltip>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium">
              Configurações do CRM
            </p>
            <h2 className="text-lg font-bold text-foreground">Produtos e Serviços</h2>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {canManage && (
            <>
              <SystemTooltip content="Importar produtos via planilha/CSV ou sincronizar catálogo completo da loja VTEX">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(true)}
                  className="rounded-lg bg-primary/15 px-3.5 py-2 text-xs font-bold text-primary hover:bg-primary/25 transition-colors cursor-pointer"
                >
                  Importar
                </button>
              </SystemTooltip>
              <SystemTooltip content="Cadastrar um novo produto ou serviço no catálogo comercial">
                <button
                  type="button"
                  onClick={() => openDrawer()}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 transition shadow-soft cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" /> Cadastrar produto ou serviço
                </button>
              </SystemTooltip>
            </>
          )}
          <SystemTooltip content="Fechar">
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>
      </header>

      {/* CONTEÚDO PRINCIPAL: BUSCA + TABELA + PAGINAÇÃO */}
      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-6xl space-y-5">
          {/* Barra de Busca + Abas de Agrupamento (Máquinas | Peças | Serviços) */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative w-full sm:w-72">
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar máquina, peça ou SKU..."
                  className="h-9 w-full rounded-lg border border-border bg-card pl-3.5 pr-9 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition"
                />
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>

              <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/50 p-1">
                {(
                  [
                    { id: "all" as const, label: "Todos", count: groupedCatalog.counts.all },
                    { id: "maquinas" as const, label: "Máquinas", count: groupedCatalog.counts.maquinas },
                    { id: "pecas" as const, label: "Peças e Insumos", count: groupedCatalog.counts.pecas },
                    ...(groupedCatalog.counts.servicos > 0
                      ? [{ id: "servicos" as const, label: "Serviços", count: groupedCatalog.counts.servicos }]
                      : []),
                  ]
                ).map((tab) => {
                  const active = groupFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setGroupFilter(tab.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                        active
                          ? "bg-card text-primary shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                          active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Exibindo:{" "}
              <strong className="text-foreground">{filteredProducts.length}</strong>{" "}
              {filteredProducts.length === 1 ? "item" : "itens"}
            </div>
          </div>

          {/* Tabela de Produtos e Serviços */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-12 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Carregando produtos e serviços...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center space-y-3">
              <ShoppingBag className="mx-auto h-7 w-7 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-foreground">
                  Nenhum produto ou serviço encontrado
                </p>
                <p className="text-xs text-muted-foreground">
                  {search
                    ? "Nenhum item corresponde à busca digitada."
                    : "Cadastre um novo produto ou sincronize os itens da loja VTEX."}
                </p>
              </div>
              {canManage && !search && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => openDrawer()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" /> Cadastrar produto ou serviço
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-border bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 w-[34%]">Nome</th>
                    <th className="py-3.5 px-3 w-[36%]">Descrição</th>
                    <th className="py-3.5 px-3 w-[14%]">Valor</th>
                    <th className="py-3.5 px-3 text-center w-[12%]">Exibir na negociação</th>
                    <th className="py-3.5 pl-2 pr-4 text-right w-[4%]" />
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((product) => {
                    const group = classifyCrmProductGroup(product);
                    return (
                      <tr
                        key={product.id}
                        className="border-b border-border/60 last:border-0 hover:bg-muted/20 transition-colors"
                      >
                        <td className="py-3.5 pl-4 pr-3 align-middle">
                          <button
                            type="button"
                            onClick={() => openDrawer(product)}
                            className="text-left font-bold text-primary hover:underline cursor-pointer line-clamp-2"
                          >
                            {product.name}
                          </button>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span
                              className={`rounded-md px-1.5 py-0.5 font-semibold ${
                                group === "maquinas"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {group === "maquinas"
                                ? "Máquina"
                                : group === "pecas"
                                  ? "Peça / Insumo"
                                  : "Serviço"}
                            </span>
                            {product.category && group === "maquinas" && (
                              <span className="truncate max-w-[220px]">
                                {formatShortProductCategory(product.category)}
                              </span>
                            )}
                            {product.sku && (
                              <span className="opacity-75">• {product.sku}</span>
                            )}
                          </div>
                        </td>
                      <td className="py-3.5 px-3 align-middle text-muted-foreground">
                        {product.description ? (
                          <SystemTooltip content={product.description.slice(0, 400)}>
                            <p className="line-clamp-2 leading-relaxed">
                              {product.description}
                            </p>
                          </SystemTooltip>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 align-middle font-semibold text-foreground whitespace-nowrap">
                        {formatBrlValue(product.unitPrice)}
                      </td>
                      <td className="py-3.5 px-3 align-middle text-center">
                        <div className="inline-flex items-center justify-center">
                          <SystemTooltip
                            content={
                              product.isActive
                                ? "Ativo nas negociações (clique para ocultar)"
                                : "Oculto nas negociações (clique para exibir)"
                            }
                          >
                            <span>
                              <Switch
                                checked={product.isActive}
                                disabled={!canManage || togglingId === product.id}
                                onCheckedChange={(checked) =>
                                  void handleToggleActive(product, checked)
                                }
                              />
                            </span>
                          </SystemTooltip>
                        </div>
                      </td>
                      <td className="py-3.5 pl-2 pr-4 align-middle text-right">
                        {canManage && (
                          <Popover
                            open={openMenuId === product.id}
                            onOpenChange={(open) =>
                              setOpenMenuId(open ? product.id : null)
                            }
                          >
                            <SystemTooltip content="Opções do produto">
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={`Opções de ${product.name}`}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </button>
                              </PopoverTrigger>
                            </SystemTooltip>
                            <PopoverContent align="end" className="w-48 p-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  openDrawer(product);
                                }}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
                              >
                                <Pencil className="h-3.5 w-3.5 text-primary" />
                                Editar produto ou serviço
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setDeletingProduct(product);
                                }}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Excluir produto ou serviço
                              </button>
                            </PopoverContent>
                          </Popover>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Rodapé de Paginação (Idêntico à referência) */}
          {filteredProducts.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Exibindo</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(val) => setPageSize(Number(val) || 10)}
                >
                  <SystemTooltip content="Quantidade de produtos exibidos por página">
                    <SelectTrigger className="h-8 w-[70px] rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                  </SystemTooltip>
                  <SelectContent>
                    <SelectItem value="10" className="text-xs">10</SelectItem>
                    <SelectItem value="25" className="text-xs">25</SelectItem>
                    <SelectItem value="50" className="text-xs">50</SelectItem>
                    <SelectItem value="100" className="text-xs">100</SelectItem>
                  </SelectContent>
                </Select>
                <span>de {filteredProducts.length} produtos e serviços</span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                >
                  Anterior
                </button>
                {visiblePageNumbers.map((pageNum) => (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setCurrentPage(pageNum)}
                    className={`min-w-[28px] h-7 rounded-lg px-2 text-xs font-bold transition-colors cursor-pointer ${
                      pageNum === currentPage
                        ? "bg-primary/15 text-primary"
                        : "text-primary/80 hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {pageNum}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                >
                  Próximo
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* GAVETA LATERAL: CRIAR / EDITAR PRODUTO OU SERVIÇO (REFERÊNCIA FOTO 4) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[70] flex justify-end bg-black/50 backdrop-blur-xs animate-in fade-in-0 duration-200"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDrawerOpen(false);
          }}
        >
          <aside
            className="flex h-full w-full max-w-[460px] flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200"
            aria-label={editing ? "Editar produto ou serviço" : "Criar produto ou serviço"}
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-base font-bold text-foreground">
                {editing ? "Editar produto ou serviço" : "Criar produto ou serviço"}
              </h3>
              <SystemTooltip content="Fechar">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Fechar"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </SystemTooltip>
            </div>

            <form
              onSubmit={(event) => void handleSaveProduct(event)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex-1 space-y-5 overflow-y-auto p-6 text-xs">
                {/* Banner para personalizar formulário e criar novos campos */}
                {showCustomFieldsBanner && (
                  <div className="relative rounded-xl border border-border border-l-4 border-l-primary bg-muted/20 p-4 pr-8">
                    <button
                      type="button"
                      onClick={() => setShowCustomFieldsBanner(false)}
                      aria-label="Fechar aviso"
                      className="absolute right-2.5 top-2.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Info className="h-3 w-3" />
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-foreground leading-relaxed">
                          Personalize o formulário de cadastro de Produtos e Serviços
                        </p>
                        {onOpenCustomFields && (
                          <button
                            type="button"
                            onClick={() => {
                              setDrawerOpen(false);
                              onOpenCustomFields();
                            }}
                            className="text-xs font-bold text-primary hover:underline cursor-pointer"
                          >
                            Criar novos campos
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Grupo / Tipo do item */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-foreground">
                    Grupo do item
                  </label>
                  <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-border bg-muted/40 p-1">
                    {(
                      [
                        { id: "maquinas" as const, label: "Máquina" },
                        { id: "pecas" as const, label: "Peça / Insumo" },
                        { id: "servicos" as const, label: "Serviço" },
                      ]
                    ).map((opt) => {
                      const active = productGroup === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setProductGroup(opt.id)}
                          className={`rounded-lg px-2.5 py-2 text-xs font-semibold transition cursor-pointer ${
                            active
                              ? "bg-card text-primary shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Nome do produto ou serviço */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="crm-product-name"
                    className="block text-xs font-bold text-foreground"
                  >
                    Nome do produto ou serviço
                  </label>
                  <input
                    id="crm-product-name"
                    type="text"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:border-primary"
                  />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Esse item será exibido em todos os funis de venda que podem ver todos os produtos e serviços.
                  </p>
                </div>

                {/* Descrição (opcional) */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="crm-product-description"
                    className="block text-xs font-bold text-foreground"
                  >
                    Descrição (opcional)
                  </label>
                  <textarea
                    id="crm-product-description"
                    rows={4}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background p-3 text-xs text-foreground focus:outline-none focus:border-primary resize-y"
                  />
                </div>

                {/* Valor */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="crm-product-price"
                    className="block text-xs font-bold text-foreground"
                  >
                    Valor
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs font-semibold text-muted-foreground select-none">
                      R$
                    </span>
                    <input
                      id="crm-product-price"
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={priceInput}
                      onChange={(event) =>
                        setPriceInput(event.target.value.replace(/[^0-9.,]/g, ""))
                      }
                      className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                {/* CAMPOS PERSONALIZADOS */}
                <div className="pt-2 space-y-3 border-t border-border">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Campos personalizados
                  </h4>
                  {productCustomFields.fields.length > 0 ? (
                    <CustomFieldsEditor
                      entity="product"
                      values={customFields}
                      onChange={setCustomFields}
                      create={!editing}
                      definitions={productCustomFields.fields}
                      hideTitle
                    />
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Nenhum campo personalizado configurado para Produtos e Serviços.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4 bg-card">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition shadow-soft cursor-pointer"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Salvar
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {/* MODAL DE IMPORTAÇÃO & SINCRONIZAÇÃO VTEX */}
      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Importar Produtos e Serviços
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2 text-xs">
            {/* Opção 1: Sincronização Direta VTEX */}
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5 text-primary" />
                    Sincronizar Catálogo da Loja VTEX
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Puxa automaticamente todos os itens vendidos na loja VTEX (Nome, Descrição e Valor) e atualiza o catálogo do sistema.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={syncingVtex}
                  onClick={() => void handleSyncVtex()}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {syncingVtex ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {syncingVtex ? "Sincronizando..." : "Sincronizar VTEX"}
                </button>
              </div>
            </div>

            {/* Opção 2: Importar via CSV / Texto */}
            <div className="space-y-2.5 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground">
                  Importar lista em CSV / Planilha (Nome;Descrição;Valor)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => void handleCsvFileChange(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" /> Carregar arquivo .CSV
                </button>
              </div>
              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={"Exemplo:\nEnvasadora de Líquidos;Envasadora pneumática em inox;14373,14\nEnvasadora de Pastosos;Dosagem de alta precisão;19522,07"}
                className="w-full rounded-lg border border-border bg-background p-3 font-mono text-[11px] text-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setImportModalOpen(false)}
              className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              disabled={importingCsv || !csvText.trim()}
              onClick={() => void handleImportCsvSubmit()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {importingCsv && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Importar Lista
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
      <Dialog
        open={Boolean(deletingProduct)}
        onOpenChange={(open) => {
          if (!open) setDeletingProduct(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Excluir produto ou serviço?
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Tem certeza que deseja excluir{" "}
            <strong className="text-foreground">{deletingProduct?.name}</strong> do catálogo?
            As negociações que já possuem este item vinculado preservarão o histórico.
          </p>
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setDeletingProduct(null)}
              className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={deletingLoading}
              onClick={() => void handleConfirmDelete()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-xs font-bold text-destructive-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {deletingLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Excluir
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
