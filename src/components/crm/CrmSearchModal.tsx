import React, { useEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  Building2,
  ChevronLeft,
  Loader2,
  Mail,
  Phone,
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DealResult = {
  id: string;
  title: string;
  status: string;
  value: string | null;
  currency: string;
  accountName: string | null;
  stageName: string | null;
  pipelineName: string | null;
};
type CompanyResult = {
  id: string;
  name: string;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
};
type ContactResult = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  accountId: string | null;
  accountName: string | null;
};
type ResultSection<T> = { items: T[]; total: number };
type Results = {
  deals: ResultSection<DealResult>;
  companies: ResultSection<CompanyResult>;
  contacts: ResultSection<ContactResult>;
};
type Category = keyof Results;

const emptyResults = (): Results => ({
  deals: { items: [], total: 0 },
  companies: { items: [], total: 0 },
  contacts: { items: [], total: 0 },
});

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLocaleLowerCase("pt-BR").indexOf(query.toLocaleLowerCase("pt-BR"));
  if (index < 0 || !query) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-sky-200/80 px-0.5 text-inherit dark:bg-sky-700/70">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

export function CrmSearchModal({
  open,
  onOpenChange,
  onOpenDeal,
  onOpenCompany,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenDeal: (id: string) => void;
  onOpenCompany: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>(emptyResults);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState<Category | null>(null);
  const [error, setError] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!open) {
      requestId.current += 1;
      setQuery("");
      setResults(emptyResults());
      setSelectedContact(null);
      setError("");
      setLoading(false);
      setLoadingMore(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || trimmedQuery.length < 2) {
      requestId.current += 1;
      setResults(emptyResults());
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    const currentRequest = ++requestId.current;
    setResults(emptyResults());
    setSelectedContact(null);
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/crm/search?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Não foi possível pesquisar no CRM.");
        const data = (await response.json()) as Results;
        if (requestId.current === currentRequest) setResults(data);
      } catch (cause) {
        if (!controller.signal.aborted && requestId.current === currentRequest) {
          setError(cause instanceof Error ? cause.message : "Erro na busca.");
        }
      } finally {
        if (requestId.current === currentRequest) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, trimmedQuery]);

  const loadMore = async (category: Category) => {
    if (loadingMore) return;
    const currentRequest = requestId.current;
    const offset = results[category].items.length;
    setLoadingMore(category);
    setError("");
    try {
      const params = new URLSearchParams({ q: trimmedQuery, category, offset: String(offset) });
      const response = await fetch(`/api/crm/search?${params}`);
      if (!response.ok) throw new Error("Não foi possível carregar mais resultados.");
      const data = (await response.json()) as Partial<Results>;
      if (requestId.current === currentRequest && data[category]) {
        setResults((previous) => ({
          ...previous,
          [category]: {
            items: [...previous[category].items, ...data[category]!.items],
            total: data[category]!.total,
          },
        }));
      }
    } catch (cause) {
      if (requestId.current === currentRequest)
        setError(cause instanceof Error ? cause.message : "Erro na busca.");
    } finally {
      if (requestId.current === currentRequest) setLoadingMore(null);
    }
  };

  const sections: { key: Category; title: string; icon: typeof Search }[] = [
    { key: "deals", title: "Negociações", icon: BriefcaseBusiness },
    { key: "companies", title: "Empresas", icon: Building2 },
    { key: "contacts", title: "Contatos", icon: UserRound },
  ];
  const hasResults = sections.some(({ key }) => results[key].total > 0);
  const money = (value: string | null, currency: string) =>
    value == null
      ? null
      : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(value));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(76vh,680px)] w-[calc(100vw-2rem)] max-w-[580px] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-full"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle>Busca</DialogTitle>
          <DialogDescription className="sr-only">
            Pesquise negociações, empresas e contatos no CRM.
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 pt-4 pb-3">
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/40">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="search"
              aria-label="Pesquisar no CRM"
              placeholder="Nome, telefone, empresa ou email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {selectedContact ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSelectedContact(null)}
                className="flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ChevronLeft className="h-4 w-4" /> Voltar aos resultados
              </button>
              <div className="rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 text-base font-semibold">
                  <UserRound className="h-5 w-5 text-muted-foreground" />
                  {selectedContact.name}
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  {selectedContact.email && (
                    <a
                      href={`mailto:${selectedContact.email}`}
                      className="flex items-center gap-2 text-primary hover:underline"
                    >
                      <Mail className="h-4 w-4" />
                      {selectedContact.email}
                    </a>
                  )}
                  {selectedContact.phone && (
                    <a
                      href={`tel:${selectedContact.phone}`}
                      className="flex items-center gap-2 text-primary hover:underline"
                    >
                      <Phone className="h-4 w-4" />
                      {selectedContact.phone}
                    </a>
                  )}
                  {selectedContact.accountId && (
                    <button
                      type="button"
                      className="flex items-center gap-2 text-primary hover:underline"
                      onClick={() => onOpenCompany(selectedContact.accountId!)}
                    >
                      <Building2 className="h-4 w-4" />
                      {selectedContact.accountName || "Abrir empresa"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : trimmedQuery.length < 2 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Digite pelo menos 2 caracteres para buscar.
            </p>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Pesquisando...
            </div>
          ) : (
            <>
              {error && (
                <p
                  role="alert"
                  className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              {!hasResults && !error && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Nenhum resultado para “{trimmedQuery}”.
                </p>
              )}
              {sections.map(({ key, title, icon: Icon }) => {
                const section = results[key];
                if (!section.total) return null;
                return (
                  <section key={key} className="border-b border-border py-3 last:border-0">
                    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {title} ({section.total})
                    </h3>
                    <div className="space-y-0.5">
                      {section.items.map((item) => {
                        const name =
                          key === "deals"
                            ? (item as DealResult).title
                            : (item as CompanyResult | ContactResult).name;
                        const subtitle =
                          key === "deals"
                            ? [
                                (item as DealResult).accountName,
                                (item as DealResult).pipelineName,
                                (item as DealResult).stageName,
                                money((item as DealResult).value, (item as DealResult).currency),
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : key === "companies"
                              ? [
                                  (item as CompanyResult).tradeName,
                                  (item as CompanyResult).email,
                                  (item as CompanyResult).phone,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : [
                                  (item as ContactResult).email,
                                  (item as ContactResult).phone,
                                  (item as ContactResult).accountName,
                                ]
                                  .filter(Boolean)
                                  .join(" · ");
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={() =>
                              key === "deals"
                                ? onOpenDeal(item.id)
                                : key === "companies"
                                  ? onOpenCompany(item.id)
                                  : setSelectedContact(item as ContactResult)
                            }
                          >
                            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-foreground">
                                <Highlight text={name} query={trimmedQuery} />
                              </span>
                              {subtitle && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {subtitle}
                                </span>
                              )}
                            </span>
                            {key === "deals" && (
                              <span
                                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${(item as DealResult).status === "won" ? "bg-emerald-100 text-emerald-800" : (item as DealResult).status === "lost" ? "bg-rose-100 text-rose-800" : "bg-sky-100 text-sky-800"}`}
                              >
                                {(
                                  {
                                    won: "Ganha",
                                    lost: "Perdida",
                                    paused: "Pausada",
                                    open: "Aberta",
                                  } as Record<string, string>
                                )[(item as DealResult).status] || (item as DealResult).status}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {section.items.length < section.total && (
                      <button
                        type="button"
                        disabled={loadingMore === key}
                        onClick={() => loadMore(key)}
                        className="ml-8 mt-2 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                      >
                        {loadingMore === key
                          ? "Carregando..."
                          : `Mostrar mais ${title.toLowerCase()}`}
                      </button>
                    )}
                  </section>
                );
              })}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
