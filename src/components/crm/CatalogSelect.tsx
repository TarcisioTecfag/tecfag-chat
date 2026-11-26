import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { CatalogKind } from "@/lib/crm/catalogs";
import { filterCatalogSearchOptions } from "@/lib/crm/catalog-search";

type CatalogItem = { id: string; name: string };

const CATALOG_SEARCH_COPY: Record<
  CatalogKind,
  {
    searchPlaceholder: string;
    emptyResult: string;
    pluralLabel: string;
  }
> = {
  source: {
    searchPlaceholder: "Pesquisar fonte...",
    emptyResult: "Nenhuma fonte encontrada",
    pluralLabel: "fontes",
  },
  campaign: {
    searchPlaceholder: "Pesquisar campanha...",
    emptyResult: "Nenhuma campanha encontrada",
    pluralLabel: "campanhas",
  },
  segment: {
    searchPlaceholder: "Pesquisar segmento...",
    emptyResult: "Nenhum segmento encontrado",
    pluralLabel: "segmentos",
  },
  loss_reason: {
    searchPlaceholder: "Pesquisar motivo de perda...",
    emptyResult: "Nenhum motivo encontrado",
    pluralLabel: "motivos",
  },
};

export function CatalogSelect({
  kind,
  value,
  onChange,
  className,
  placeholder = "Selecionar",
  hideCreate = true,
  pipelineId,
  stageId,
  searchPlaceholder,
}: {
  kind: CatalogKind;
  value?: string | null;
  onChange: (name: string) => void;
  className?: string;
  placeholder?: string;
  hideCreate?: boolean;
  pipelineId?: string | null;
  stageId?: string | null;
  searchPlaceholder?: string;
}) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowCreate, setAllowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ kind });
    if (pipelineId) params.set("pipelineId", pipelineId);
    if (stageId) params.set("stageId", stageId);
    fetch(`/api/crm/catalogs?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar o catálogo.");
        return response.json();
      })
      .then((data) => {
        if (active) {
          setItems(data.options || data.items || []);
          setAllowCreate(Boolean(data.allowUserCreate || data.isAdmin));
        }
      })
      .catch((error) => {
        if (active) toast.error(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, pipelineId, stageId]);

  const add = async (explicitName?: string) => {
    const candidate = (explicitName ?? newName).trim();
    if (!candidate) return;
    setAdding(true);
    try {
      const response = await fetch("/api/crm/catalogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name: candidate }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível criar o item.");
      setItems((current) =>
        [...current, data.item].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      );
      onChange(data.item.name);
      setNewName("");
      setCreating(false);
      setSearch("");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o item.");
    } finally {
      setAdding(false);
    }
  };

  const copy = CATALOG_SEARCH_COPY[kind];
  const resolvedSearchPlaceholder = searchPlaceholder || copy.searchPlaceholder;
  const trimmedSearch = search.trim();

  const allOptions = useMemo<CatalogItem[]>(() => {
    const normalizedValue = value?.trim() || "";
    const hasLegacy =
      Boolean(normalizedValue) && !items.some((item) => item.name === normalizedValue);
    if (!hasLegacy) return items;
    return [{ id: `__legacy__:${normalizedValue}`, name: normalizedValue }, ...items];
  }, [items, value]);

  const filteredOptions = useMemo(
    () => filterCatalogSearchOptions(allOptions, search, (item) => item.name),
    [allOptions, search],
  );

  // Lista navegável por teclado (inclui opção vazia quando sem busca)
  const navigableEntries = useMemo(() => {
    const entries: Array<{ id: string; value: string; label: string; isPlaceholder?: boolean }> =
      [];
    if (!trimmedSearch) {
      entries.push({ id: "__none__", value: "", label: placeholder, isPlaceholder: true });
    }
    for (const item of filteredOptions) {
      entries.push({ id: item.id, value: item.name, label: item.name });
    }
    return entries;
  }, [filteredOptions, placeholder, trimmedSearch]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setHighlightedIndex(-1);
      return;
    }
    if (trimmedSearch) {
      setHighlightedIndex(navigableEntries.length > 0 ? 0 : -1);
    } else {
      const currentIdx = navigableEntries.findIndex((entry) => entry.value === (value || ""));
      setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
    }
  }, [open, trimmedSearch, navigableEntries.length]);

  useEffect(() => {
    if (highlightedIndex >= 0 && open) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex, open]);

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setSearch("");
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (navigableEntries.length === 0) return;
      setHighlightedIndex((prev) => (prev + 1) % navigableEntries.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (navigableEntries.length === 0) return;
      setHighlightedIndex((prev) =>
        prev <= 0 ? navigableEntries.length - 1 : prev - 1,
      );
      return;
    }
    if (event.key === "Enter") {
      if (navigableEntries.length === 0) return;
      event.preventDefault();
      const targetIndex = highlightedIndex >= 0 ? highlightedIndex : 0;
      const target = navigableEntries[targetIndex];
      if (target) {
        handleSelect(target.value);
      }
    }
  };

  const canQuickCreateFromSearch =
    !hideCreate &&
    allowCreate &&
    trimmedSearch.length > 0 &&
    !allOptions.some(
      (item) => item.name.toLocaleLowerCase("pt-BR") === trimmedSearch.toLocaleLowerCase("pt-BR"),
    );

  return (
    <div className="min-w-0 flex-1">
      <Popover open={open} onOpenChange={setOpen}>
        <SystemTooltip content={value ? `Selecionado: ${value}` : placeholder}>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-label={value ? `${placeholder}: ${value}` : placeholder}
              className={cn(
                "flex items-center justify-between gap-2 whitespace-nowrap border shadow-sm ring-offset-background cursor-pointer transition-colors hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50",
                className ||
                  "h-9 w-full rounded-[8px] border border-slate-300/85 dark:border-slate-700/80 bg-muted/35 dark:bg-slate-900/60 px-3 text-xs font-medium text-foreground hover:border-primary/40 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/15",
              )}
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-left",
                  !value && "text-muted-foreground",
                )}
              >
                {value || placeholder}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 opacity-50 transition-transform duration-150",
                  open && "rotate-180",
                )}
              />
            </button>
          </PopoverTrigger>
        </SystemTooltip>

        <PopoverContent
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchInputRef.current?.focus();
          }}
          className="min-w-[var(--radix-popover-trigger-width)] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-xl"
        >
          {/* Campo de pesquisa */}
          <div className="border-b border-border bg-muted/20 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={resolvedSearchPlaceholder}
                aria-label={resolvedSearchPlaceholder}
                autoComplete="off"
                className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              {search && (
                <SystemTooltip content="Limpar pesquisa">
                  <button
                    type="button"
                    aria-label="Limpar pesquisa"
                    onClick={() => {
                      setSearch("");
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </SystemTooltip>
              )}
            </div>
          </div>

          {/* Lista filtrável de opções */}
          <div role="listbox" className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
            {loading && allOptions.length === 0 ? (
              <div className="flex items-center justify-center gap-1.5 py-5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Carregando opções...</span>
              </div>
            ) : navigableEntries.length === 0 ? (
              <div className="px-3 py-5 text-center text-xs text-muted-foreground">
                <p>
                  {copy.emptyResult}
                  {trimmedSearch ? ` para "${trimmedSearch}"` : ""}.
                </p>
                {canQuickCreateFromSearch && (
                  <SystemTooltip content={`Cadastrar "${trimmedSearch}" no catálogo`}>
                    <button
                      type="button"
                      disabled={adding}
                      onClick={() => void add(trimmedSearch)}
                      className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    >
                      + Criar &quot;{trimmedSearch}&quot;
                    </button>
                  </SystemTooltip>
                )}
              </div>
            ) : (
              navigableEntries.map((entry, idx) => {
                const isSelected = entry.isPlaceholder ? !value : value === entry.value;
                const isHighlighted = highlightedIndex === idx;
                return (
                  <button
                    key={entry.id}
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onClick={() => handleSelect(entry.value)}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                      isSelected
                        ? "bg-primary/10 text-primary font-semibold"
                        : isHighlighted
                          ? "bg-muted text-foreground"
                          : entry.isPlaceholder
                            ? "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            : "text-foreground hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0 flex-1 break-words leading-snug">{entry.label}</span>
                    {isSelected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })
            )}
          </div>

          {/* Rodapé discreto com contador quando há muitas opções */}
          {allOptions.length > 8 && (
            <div className="flex items-center justify-between border-t border-border/70 bg-muted/15 px-2.5 py-1.5 text-[10px] text-muted-foreground">
              <span>
                {trimmedSearch
                  ? `${filteredOptions.length} de ${allOptions.length} ${copy.pluralLabel}`
                  : `${allOptions.length} ${copy.pluralLabel} cadastradas`}
              </span>
              {value && (
                <SystemTooltip content="Remover seleção atual">
                  <button
                    type="button"
                    onClick={() => handleSelect("")}
                    className="font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Limpar
                  </button>
                </SystemTooltip>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {!hideCreate && allowCreate && !creating && (
        <SystemTooltip content="Adicionar nova opção ao catálogo">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer"
          >
            + Criar nova opção
          </button>
        </SystemTooltip>
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
          <SystemTooltip content="Confirmar criação da opção">
            <button
              type="button"
              disabled={adding || !newName.trim()}
              onClick={() => void add()}
              className="rounded bg-primary px-2 text-xs font-semibold text-primary-foreground disabled:opacity-50 cursor-pointer"
            >
              Criar
            </button>
          </SystemTooltip>
          <SystemTooltip content="Cancelar criação">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              className="px-1 text-xs text-muted-foreground cursor-pointer"
              aria-label="Cancelar criação"
            >
              Cancelar
            </button>
          </SystemTooltip>
        </div>
      )}
    </div>
  );
}
