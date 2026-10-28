import {
  ContactDealModal,
  ContactDealPicker,
  isContactDealInputComplete,
  type DealCardSummary,
} from "./ContactDealPicker";
import {
  PhoneContactSuggestions,
  SelectedExistingContactBanner,
  type ExistingPhoneContact,
} from "./PhoneContactSuggestions";
import type { ContactDealInput } from "@/lib/crm/contact-deal-input";
import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { maskPhone } from "@/lib/utils";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { CatalogSelect } from "./CatalogSelect";
import {
  formatAccountDocumentInput,
  getInlineDocumentMismatch,
  validateAccountDocument,
} from "../../lib/crm/account-validation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemDateTimePicker } from "@/components/ui/system-date-time-picker";

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
  const [contactDealInput, setContactDealInput] = useState<ContactDealInput>({});
  const [selectedDealMeta, setSelectedDealMeta] = useState<DealCardSummary | null>(null);
  const [showDealModalOnSave, setShowDealModalOnSave] = useState(false);
  const [existingContact, setExistingContact] = useState<ExistingPhoneContact | null>(null);
  const [accountType, setAccountType] = useState<"company" | "person">("company");
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
    setAccountType("company");
    setContactDealInput({});
    setSelectedDealMeta(null);
    setShowDealModalOnSave(false);
    setExistingContact(null);
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

  const executeSubmit = async (dealSelection: ContactDealInput) => {
    if (!kind || !name.trim()) return;
    if (kind === "task" && !selectedDeal) {
      toast.error("Selecione uma negociação para a tarefa.");
      return;
    }
    if (kind === "company") {
      const docValidation = validateAccountDocument(accountType, document);
      if (!docValidation.valid) {
        toast.error(docValidation.error || "Documento inválido.");
        return;
      }
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
              type: accountType,
              tradeName: accountType === "company" ? tradeName.trim() || undefined : undefined,
              segment: accountType === "company" ? segment || undefined : undefined,
              document: document.replace(/\D/g, ""),
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
                ...dealSelection,
                existingContactId: existingContact?.id,
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
      if (!response.ok && data.code === "CONTACT_EXISTS" && data.contact) {
        setExistingContact(data.contact);
        setName(data.contact.name);
        setShowDealModalOnSave(true);
        toast.info("Este contato já existe e foi selecionado. Confirme a negociação para continuar.");
        return;
      }
      if (!response.ok) throw new Error(data.error || "Não foi possível concluir o cadastro.");
      toast.success(
        kind === "company"
          ? "Empresa criada."
          : kind === "contact"
            ? existingContact
              ? "Contato existente vinculado."
              : "Contato criado."
            : "Tarefa criada.",
      );
      setShowDealModalOnSave(false);
      onCreated();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir o cadastro.");
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!kind || !name.trim()) return;
    if (kind === "contact" && !isContactDealInputComplete(contactDealInput)) {
      setShowDealModalOnSave(true);
      return;
    }
    await executeSubmit(contactDealInput);
  };

  return (
    <>
      <Sheet open={kind !== null} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="flex h-full w-full max-w-[480px] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-[480px] shadow-2xl border-l border-border"
        >
          <SheetHeader className="flex h-16 shrink-0 flex-row items-center justify-between border-b border-border px-6 bg-card space-y-0">
            <SheetTitle className="text-base font-bold text-foreground">
              {kind ? headings[kind] : "Criar"}
            </SheetTitle>
          </SheetHeader>
          <form data-tour={kind === "company" ? "crm.quick-company" : "crm.quick-contact"} onSubmit={submit} className="flex min-h-0 flex-1 flex-col justify-between overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-xs">
              {kind === "contact" && existingContact && (
                <SelectedExistingContactBanner
                  contact={existingContact}
                  onClear={() => setExistingContact(null)}
                />
              )}

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
            {kind === "company" && (
              <div className="space-y-1.5">
                <Label>Tipo de Cliente *</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAccountType("company");
                      if (document) setDocument(formatAccountDocumentInput(document, "company"));
                    }}
                    className={`py-2 rounded-lg border text-xs font-bold transition cursor-pointer ${
                      accountType === "company"
                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                        : "bg-card border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Pessoa Jurídica (PJ)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountType("person");
                      if (document) setDocument(formatAccountDocumentInput(document, "person"));
                    }}
                    className={`py-2 rounded-lg border text-xs font-bold transition cursor-pointer ${
                      accountType === "person"
                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                        : "bg-card border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Pessoa Física (PF)
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="crm-quick-name">
                {kind === "task"
                  ? "Título da tarefa"
                  : kind === "company"
                    ? accountType === "company"
                      ? "Razão social / Nome da empresa"
                      : "Nome completo"
                    : "Nome do contato"}{" "}
                *
              </Label>
              <Input
                id="crm-quick-name"
                disabled={kind === "contact" && !!existingContact} value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={200}
                autoFocus
              />
            </div>
            {kind === "company" && (
              <>
                {accountType === "company" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="crm-quick-trade-name">Nome fantasia</Label>
                    <Input
                      id="crm-quick-trade-name"
                      value={tradeName}
                      onChange={(event) => setTradeName(event.target.value)}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="crm-quick-document">
                    {accountType === "company" ? "CNPJ (14 dígitos)" : "CPF (11 dígitos)"} *
                  </Label>
                  <Input
                    id="crm-quick-document"
                    value={document}
                    required
                    placeholder={accountType === "company" ? "00.000.000/0000-00" : "000.000.000-00"}
                    onChange={(event) =>
                      setDocument(formatAccountDocumentInput(event.target.value, accountType))
                    }
                    className="font-mono"
                  />
                  {(() => {
                    const mismatch = getInlineDocumentMismatch(accountType, document);
                    if (!mismatch) return null;
                    return (
                      <div className="mt-1 space-y-1">
                        <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                          {mismatch.message}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setAccountType(mismatch.suggestedType);
                            setDocument(formatAccountDocumentInput(document, mismatch.suggestedType));
                          }}
                          className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                        >
                          {mismatch.suggestedLabel}
                        </button>
                      </div>
                    );
                  })()}
                </div>
                {accountType === "company" && (
                  <div className="space-y-1.5"><Label>Segmento</Label><CatalogSelect kind="segment" value={segment} onChange={setSegment} /></div>
                )}
              </>
            )}
            {(kind === "company" || (kind === "contact" && !existingContact)) && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="crm-quick-phone">Telefone</Label>
                  <Input
                    id="crm-quick-phone"
                    disabled={kind === "contact" && !!existingContact}
                    value={phone}
                    placeholder="(14) 99999-8888"
                    onChange={(event) => setPhone(maskPhone(event.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="crm-quick-email">E-mail</Label>
                  <Input
                    id="crm-quick-email"
                    type="email"
                    disabled={kind === "contact" && !!existingContact}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              </div>
            )}
            {kind === "contact" && !existingContact && (
              <PhoneContactSuggestions
                endpoint="/api/crm/contacts"
                phone={phone}
                name={name}
                onSelect={(contact) => {
                  setExistingContact(contact);
                  setName(contact.name);
                  setPhone(contact.phone ? maskPhone(contact.phone) : "");
                  setEmail(contact.email || "");
                }}
              />
            )}
            {kind === "contact" && (
              <ContactDealPicker
                value={contactDealInput}
                onChange={setContactDealInput}
                selectedDealMeta={selectedDealMeta}
                onSelectedDealMetaChange={setSelectedDealMeta}
                contactContext={{
                  contactId: existingContact?.id || null,
                  name: existingContact?.name || name,
                  phone: existingContact?.phone || phone,
                  accountId: existingContact?.accountId || null,
                  accountName: existingContact?.accountName || null,
                  linkedDeals: existingContact?.linkedDeals,
                }}
              />
            )}
            {(kind === "company" || (kind === "contact" && !existingContact)) && (
              <CustomFieldsEditor entity={kind} values={customFields} onChange={setCustomFields} create />
            )}
            {kind === "task" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="crm-quick-due">Prazo</Label>
                  <SystemDateTimePicker
                    id="crm-quick-due"
                    mode="datetime"
                    allowClear
                    value={dueDate}
                    onChange={setDueDate}
                    tooltip="Selecione a data e horário de prazo da tarefa"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="crm-quick-assignee">Responsável</Label>
                  <Select
                    value={assignedTo || "__default__"}
                    onValueChange={(val) => setAssignedTo(val === "__default__" ? "" : val)}
                  >
                    <SelectTrigger id="crm-quick-assignee" className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs">
                      <SelectValue placeholder="Responsável atual" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__" className="text-xs">Responsável atual</SelectItem>
                      {operators.map((operator) => (
                        <SelectItem key={operator.id} value={operator.id} className="text-xs">
                          {operator.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4 bg-muted/20">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={saving || (kind === "task" && !selectedDeal)}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {kind === "task"
                ? "Criar tarefa"
                : kind === "company"
                  ? "Criar empresa"
                  : existingContact
                    ? isContactDealInputComplete(contactDealInput)
                      ? "Vincular contato existente"
                      : "Escolher negociação e vincular"
                    : isContactDealInputComplete(contactDealInput)
                      ? "Criar contato"
                      : "Escolher negociação e salvar"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>

    {kind === "contact" && (
      <ContactDealModal
        open={showDealModalOnSave}
        onOpenChange={setShowDealModalOnSave}
        value={contactDealInput}
        onChange={setContactDealInput}
        onSelectDealMeta={setSelectedDealMeta}
        confirmLabel={existingContact ? "Confirmar e Vincular Contato" : "Confirmar e Criar Contato"}
        submitting={saving}
        contactContext={{
          contactId: existingContact?.id || null,
          name: existingContact?.name || name,
          phone: existingContact?.phone || phone,
          accountId: existingContact?.accountId || null,
          accountName: existingContact?.accountName || null,
          linkedDeals: existingContact?.linkedDeals,
        }}
        onConfirm={async (confirmedDeal, meta) => {
          setContactDealInput(confirmedDeal);
          setSelectedDealMeta(meta || null);
          await executeSubmit(confirmedDeal);
        }}
      />
    )}
    </>
  );
}
