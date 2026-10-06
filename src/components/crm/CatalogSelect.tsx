import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { CatalogKind } from "@/lib/crm/catalogs";

type CatalogItem = { id: string; name: string };

export function CatalogSelect({
  kind,
  value,
  onChange,
  className,
  placeholder = "Selecionar",
  hideCreate = true,
}: {
  kind: CatalogKind;
  value?: string | null;
  onChange: (name: string) => void;
  className?: string;
  placeholder?: string;
  hideCreate?: boolean;
}) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [allowCreate, setAllowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/crm/catalogs?kind=${kind}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar o catálogo.");
        return response.json();
      })
      .then((data) => {
        if (active) {
          setItems(data.options || data.items || []);
          setAllowCreate(data.allowUserCreate || data.isAdmin);
        }
      })
      .catch((error) => {
        if (active) toast.error(error.message);
      });
    return () => {
      active = false;
    };
  }, [kind]);

  const add = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const response = await fetch("/api/crm/catalogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name: newName.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível criar o item.");
      setItems((current) =>
        [...current, data.item].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      );
      onChange(data.item.name);
      setNewName("");
      setCreating(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o item.");
    } finally {
      setAdding(false);
    }
  };

  const legacy = value && !items.some((item) => item.name === value);
  return (
    <div className="min-w-0 flex-1">
      <Select
        value={value || "__none__"}
        onValueChange={(next) => onChange(next === "__none__" ? "" : next)}
      >
        <SelectTrigger
          className={className || "h-9 w-full rounded-lg border-border bg-card text-xs"}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{placeholder}</SelectItem>
          {legacy && <SelectItem value={value}>{value} (valor anterior)</SelectItem>}
          {items.map((item) => (
            <SelectItem key={item.id} value={item.name}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!hideCreate && allowCreate && !creating && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mt-1 text-[11px] font-semibold text-primary hover:underline"
        >
          + Criar nova opção
        </button>
      )}
      {!hideCreate && allowCreate && creating && (
        <div className="mt-1 flex gap-1">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void add();
              }
            }}
            placeholder="Adicionar opção"
            aria-label="Novo item do catálogo"
            className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={adding || !newName.trim()}
            onClick={() => void add()}
            className="rounded bg-primary px-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            Criar
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
            className="px-1 text-xs text-muted-foreground"
            aria-label="Cancelar criação"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
