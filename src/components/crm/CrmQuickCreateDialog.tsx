import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { CatalogSelect } from "./CatalogSelect";

export type CrmQuickCreateKind = "company" | "contact" | "task";

interface DealOption {
  id: string;
  title: string;
  account?: { name: string } | null;
}

interface CrmQuickCreateDialogProps {
  kind: CrmQuickCreateKind | null;
  onClose: () => void;
  onCreated: () => void;
  operators: Array<{ id: string; name: string }>;
  currentOperatorId?: string | null;
}

const headings: Record<CrmQuickCreateKind, string> = {
  company: "Criar empresa",
  contact: "Criar contato",
  task: "Criar tarefa",
};

export function CrmQuickCreateDialog({
  kind,
  onClose,
  onCreated,
  operators,
  currentOperatorId,
}: CrmQuickCreateDialogProps) {
  const [name, setName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [segment, setSegment] = useState("");
  const [document, setDocument] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState(currentOperatorId || "");
  const [dealQuery, setDealQuery] = useState("");
  const [dealOptions, setDealOptions] = useState<DealOption[]>([]);
  const [selectedDeal, setSelectedDeal] = useState<DealOption | null>(null);
  const [searchingDeals, setSearchingDeals] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!kind) return;
    setName("");
    setTradeName("");
    setSegment("");
    setDocument("");
    setPhone("");
    setEmail("");
    setDescription("");
    setDueDate("");
    setAssignedTo(currentOperatorId || "");
    setDealQuery("");
    setSelectedDeal(null);
    setDealOptions([]);
    setSaving(false);
    setCustomFields({});
  }, [kind, currentOperatorId]);

  useEffect(() => {
    if (kind !== "task") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchingDeals(true);
      try {
        const params = new URLSearchParams({ limit: "20", status: "open" });
        if (dealQuery.trim()) params.set("search", dealQuery.trim());
        const response = await fetch(`/api/crm/deals?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Não foi possível buscar negociações.");
        const data = await response.json();
        setDealOptions(data.deals || []);
      } catch (error) {
        if (!controller.signal.aborted)
          toast.error(error instanceof Error ? error.message : "Falha ao buscar negociações.");
      } finally {
        if (!controller.signal.aborted) setSearchingDeals(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [kind, dealQuery]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!kind || !name.trim()) return;
    if (kind === "task" && !selectedDeal) {
      toast.error("Selecione uma negociação para a tarefa.");
      return;
    }
    setSaving(true);
    try {
      const endpoint =
        kind === "company"
          ? "/api/crm/accounts"
          : kind === "contact"
            ? "/api/crm/contacts"
            : `/api/crm/deals/${selectedDeal!.id}/activities`;
      const payload =
        kind === "company"
          ? {
              name: name.trim(),
              type: "company",
              tradeName: tradeName.trim() || undefined,
              segment: segment || undefined,
              document: document.trim() || undefined,
              phone: phone.trim() || undefined,
              email: email.trim() || undefined,
              customFields,
            }
          : kind === "contact"
            ? {
                name: name.trim(),
                phone: phone.trim() || undefined,
                email: email.trim() || undefined,
                customFields,
              }
            : {
                type: "task",
                title: name.trim(),
                description: description.trim() || undefined,
                dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
                assignedToOperatorId: assignedTo || undefined,
              };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível concluir o cadastro.");
      toast.success(
        kind === "company"
          ? "Empresa criada."
          : kind === "contact"
            ? "Contato criado."
            : "Tarefa criada.",
      );
      onCreated();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir o cadastro.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-border bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="text-base">{kind ? headings[kind] : "Criar"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 text-xs">
          {kind === "task" && (
            <div className="space-y-2">
              <Label>Negociação *</Label>
              {selectedDeal ? (
                <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
                  <span className="truncate font-semibold text-primary">{selectedDeal.title}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDeal(null)}
                    className="ml-2 text-primary underline"
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={dealQuery}
                      onChange={(event) => setDealQuery(event.target.value)}
                      placeholder="Buscar negociação"
                      className="pl-8"
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-background">
                    {searchingDeals ? (
                      <p className="p-2 text-muted-foreground">Buscando...</p>
                    ) : dealOptions.length ? (
                      dealOptions.map((deal) => (
                        <button
                          type="button"
                          key={deal.id}
                          onClick={() => setSelectedDeal(deal)}
                          className="block w-full border-b border-border/50 px-3 py-2 text-left hover:bg-primary/10 last:border-b-0"
                        >
                          <span className="block font-semibold">{deal.title}</span>
                          {deal.account?.name && (
                            <span className="text-muted-foreground">{deal.account.name}</span>
                          )}
                        </button>
                      ))
                    ) : (
                      <p className="p-2 text-muted-foreground">Nenhuma negociação encontrada.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="crm-quick-name">
              {kind === "task"
                ? "Título da tarefa"
                : kind === "company"
                  ? "Nome ou razão social"
                  : "Nome do contato"}{" "}
              *
            </Label>
            <Input
              id="crm-quick-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
              autoFocus
            />
          </div>
          {kind === "company" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="crm-quick-trade-name">Nome fantasia</Label>
                <Input
                  id="crm-quick-trade-name"
                  value={tradeName}
                  onChange={(event) => setTradeName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-quick-document">CNPJ</Label>
                <Input
                  id="crm-quick-document"
                  value={document}
                  onChange={(event) => setDocument(event.target.value)}
                />
              </div>
              <div className="space-y-1.5"><Label>Segmento</Label><CatalogSelect kind="segment" value={segment} onChange={setSegment} /></div>
            </>
          )}
          {(kind === "company" || kind === "contact") && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="crm-quick-phone">Telefone</Label>
                <Input
                  id="crm-quick-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-quick-email">E-mail</Label>
                <Input
                  id="crm-quick-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>
          )}
          {(kind === "company" || kind === "contact") && (
            <CustomFieldsEditor entity={kind} values={customFields} onChange={setCustomFields} create />
          )}
          {kind === "task" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="crm-quick-due">Prazo</Label>
                <Input
                  id="crm-quick-due"
                  type="datetime-local"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-quick-assignee">Responsável</Label>
                <select
                  id="crm-quick-assignee"
                  value={assignedTo}
                  onChange={(event) => setAssignedTo(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
                >
                  <option value="">Responsável atual</option>
                  {operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operator.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-quick-description">Descrição</Label>
                <Textarea
                  id="crm-quick-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                />
              </div>
            </>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={saving || (kind === "task" && !selectedDeal)}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {kind === "task"
                ? "Criar tarefa"
                : kind === "company"
                  ? "Criar empresa"
                  : "Criar contato"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
