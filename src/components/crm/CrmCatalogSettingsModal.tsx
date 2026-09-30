import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { CatalogKind } from "@/lib/crm/catalogs";

type Item = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};
const tabs: Array<{ kind: CatalogKind; label: string; description: string }> = [
  {
    kind: "segment",
    label: "Segmentos",
    description: "Classifique as empresas para filtrar e organizar sua carteira.",
  },
  { kind: "source", label: "Fontes", description: "Identifique a origem de cada negociação." },
  {
    kind: "campaign",
    label: "Campanhas",
    description: "Organize as campanhas associadas às negociações.",
  },
  {
    kind: "loss_reason",
    label: "Motivos de perda",
    description: "Padronize os motivos informados ao marcar uma negociação como perdida.",
  },
];

export function CrmCatalogSettingsModal({
  isOpen,
  onClose,
  initialKind,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialKind: CatalogKind;
}) {
  const [kind, setKind] = useState<CatalogKind>(initialKind);
  const [items, setItems] = useState<Item[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allowUserCreate, setAllowUserCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Item | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setKind(initialKind);
  }, [isOpen, initialKind]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/crm/catalogs?kind=${kind}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar o catálogo.");
      setItems(data.items || []);
      setIsAdmin(data.isAdmin);
      setAllowUserCreate(data.allowUserCreate);
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

  const openDraft = (item: Item | "new") => {
    setDraft(item);
    setName(item === "new" ? "" : item.name);
    setDescription(item === "new" ? "" : item.description || "");
  };
  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(
        draft === "new" ? "/api/crm/catalogs" : `/api/crm/catalogs/${(draft as Item).id}`,
        {
          method: draft === "new" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, name, description }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setDraft(null);
      await load();
      toast.success("Item salvo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };
  const archive = async (item: Item) => {
    if (
      !window.confirm(
        `Arquivar “${item.name}”? Os registros já preenchidos continuarão com esse valor.`,
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
      toast.success("Item arquivado.");
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
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível alterar a preferência.",
      );
    }
  };
  const current = tabs.find((tab) => tab.kind === kind)!;
  const visible = items.filter((item) =>
    item.name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")),
  );
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl p-5 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={onClose}
              className="mb-3 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar às configurações
            </button>
            <h2 className="text-xl font-bold">Catálogos do CRM</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Configure segmentos, fontes, campanhas e motivos de perda do seu ambiente.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-6 flex flex-wrap gap-2 border-b border-border pb-3">
          {tabs.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              onClick={() => {
                setKind(tab.kind);
                setSearch("");
                setDraft(null);
              }}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${kind === tab.kind ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="mt-7 rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold">{current.label}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{current.description}</p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => openDraft("new")}
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
              >
                <Plus className="h-4 w-4" /> Adicionar{" "}
                {current.label === "Motivos de perda"
                  ? "motivo"
                  : current.label.slice(0, -1).toLowerCase()}
              </button>
            )}
          </div>
          {kind !== "loss_reason" && isAdmin && (
            <label className="mt-5 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={allowUserCreate}
                onChange={() => void togglePolicy()}
              />{" "}
              Permitir que usuários criem novos itens dessa lista
            </label>
          )}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar..."
            className="mt-5 w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-xs"
          />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="p-3">Nome ({items.length})</th>
                  {kind === "campaign" && <th className="p-3">Descrição</th>}
                  <th className="p-3">Criado em</th>
                  <th className="p-3">Atualizado em</th>
                  <th className="p-3">ID</th>
                  {isAdmin && <th className="p-3">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id} className="border-b border-border/70">
                    <td className="p-3 font-semibold">{item.name}</td>
                    {kind === "campaign" && <td className="p-3">{item.description || "—"}</td>}
                    <td className="p-3 text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString("pt-BR")}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {new Date(item.updatedAt).toLocaleString("pt-BR")}
                    </td>
                    <td className="p-3 font-mono text-muted-foreground">{item.id}</td>
                    {isAdmin && (
                      <td className="whitespace-nowrap p-3">
                        <button
                          type="button"
                          onClick={() => openDraft(item)}
                          className="mr-3 text-primary hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void archive(item)}
                          className="text-destructive hover:underline"
                        >
                          Arquivar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && visible.length === 0 && (
              <p className="p-6 text-center text-xs text-muted-foreground">
                {search
                  ? "Nenhum resultado."
                  : "Nenhum item cadastrado. Adicione o primeiro pela interface."}
              </p>
            )}
          </div>
        </div>
      </div>
      {draft && (
        <div className="fixed inset-0 z-[110] flex justify-end bg-black/50">
          <div className="flex h-full w-full max-w-md flex-col bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">
                {draft === "new" ? "Adicionar" : "Editar"} {current.label.toLowerCase()}
              </h3>
              <button type="button" onClick={() => setDraft(null)} aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-7 text-xs font-semibold">Nome *</label>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              className="mt-1 rounded-lg border border-border bg-background p-2 text-sm"
            />
            {kind === "campaign" && (
              <>
                <label className="mt-5 text-xs font-semibold">Descrição</label>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={500}
                  className="mt-1 min-h-24 rounded-lg border border-border bg-background p-2 text-sm"
                />
              </>
            )}
            <div className="mt-auto flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg border border-border px-4 py-2 text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !name.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
