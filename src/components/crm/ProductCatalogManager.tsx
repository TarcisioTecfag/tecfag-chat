import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { CustomFieldsEditor, changedCustomFieldValues } from "./CustomFieldsEditor";
import { SystemTooltip } from "@/components/ui/tooltip";

interface Product {
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

export function ProductCatalogManager({ enabled }: { enabled: boolean }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0");
  const [unit, setUnit] = useState("UN");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    const response = await fetch("/api/crm/products");
    if (response.ok) setProducts((await response.json()).products || []);
  };
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled]);
  const open = (product?: Product) => {
    setEditing(product || null);
    setCreating(true);
    setName(product?.name || "");
    setSku(product?.sku || "");
    setDescription(product?.description || "");
    setPrice(product?.unitPrice || "0");
    setUnit(product?.unit || "UN");
    setCategory(product?.category || "");
    setCustomFields(product?.customFields || {});
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(
        editing ? `/api/crm/products/${editing.id}` : "/api/crm/products",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            sku,
            description,
            unitPrice: price,
            unit,
            category,
            customFields: editing
              ? changedCustomFieldValues(editing.customFields || {}, customFields)
              : customFields,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar o produto.");
      toast.success(editing ? "Produto atualizado." : "Produto criado.");
      setCreating(false);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold">Catálogo de produtos e serviços</h3>
        <button
          type="button"
          onClick={() => open()}
          className="flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"
        >
          <Plus className="h-3.5 w-3.5" /> Criar produto
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {!products.length ? (
          <p className="p-5 text-xs text-muted-foreground">Nenhum produto cadastrado.</p>
        ) : (
          products.map((product) => (
            <div
              key={product.id}
              className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-xs last:border-0"
            >
              <div>
                <b>{product.name}</b>
                <p className="text-muted-foreground">
                  {product.sku || "Sem SKU"} · R$ {Number(product.unitPrice).toFixed(2)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => open(product)}
                className="font-semibold text-primary hover:underline"
              >
                Editar
              </button>
            </div>
          ))
        )}
      </div>
      {creating && (
        <div
          className="fixed inset-0 z-[80] flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in-0 duration-200"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCreating(false);
          }}
        >
          <aside className="flex h-full w-full max-w-[460px] flex-col bg-card shadow-2xl animate-in slide-in-from-right duration-300 ease-out border-l border-border">
            <div className="flex items-center justify-between border-b border-border p-5 text-sm font-bold text-foreground">
              <span>{editing ? "Editar produto" : "Criar produto"}</span>
              <SystemTooltip content="Fechar gaveta">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  aria-label="Fechar"
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </SystemTooltip>
            </div>
            <form onSubmit={(event) => void save(event)} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
                {(
                  [
                    ["Nome *", name, setName],
                    ["SKU", sku, setSku],
                    ["Descrição", description, setDescription],
                    ["Preço unitário", price, setPrice],
                    ["Unidade", unit, setUnit],
                    ["Categoria", category, setCategory],
                  ] as const
                ).map(([label, value, setter]) => (
                  <label key={label} className="block space-y-1 font-semibold">
                    {label}
                    <input
                      required={label === "Nome *"}
                      type={label === "Preço unitário" ? "number" : "text"}
                      min={label === "Preço unitário" ? "0" : undefined}
                      step={label === "Preço unitário" ? "0.01" : undefined}
                      value={value}
                      onChange={(event) => setter(event.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 font-normal"
                    />
                  </label>
                ))}
                <CustomFieldsEditor
                  entity="product"
                  values={customFields}
                  onChange={setCustomFields}
                  create={!editing}
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-border p-4">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="rounded-lg bg-primary/10 px-3 py-2 text-primary"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50"
                >
                  Salvar
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </section>
  );
}
