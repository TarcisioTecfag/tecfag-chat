import React, { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  UserPlus,
  Loader2,
  Building2,
  Phone,
  Mail,
  X,
  UserCheck,
  Pencil,
  Unlink,
  ArrowLeft,
  Check,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { maskPhone } from "@/lib/utils";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { SystemTooltip } from "@/components/ui/tooltip";

export const CONTACT_ROLE_LABELS: Record<string, string> = {
  buyer: "Comprador",
  decision_maker: "Decisor",
  "decision-maker": "Decisor",
  decisionmaker: "Decisor",
  "buyer_decision_maker": "Comprador / Decisor",
  "buyer decision maker": "Comprador / Decisor",
  technical: "Técnico",
  user: "Usuário",
  influencer: "Influenciador",
  financial: "Financeiro",
  champion: "Defensor / Aliado",
  gatekeeper: "Filtro / Guardião",
  approver: "Aprovador",
  sponsor: "Patrocinador",
  executive: "Executivo",
  partner: "Parceiro",
  commercial: "Comercial",
  operational: "Operacional",
  other: "Outro",
};

export function formatContactRoleLabel(role?: string | null): string {
  if (!role) return "Comprador";
  const normalized = role.trim().toLowerCase();
  if (CONTACT_ROLE_LABELS[normalized]) {
    return CONTACT_ROLE_LABELS[normalized];
  }
  const underscored = normalized.replace(/[\s-]+/g, "_");
  if (CONTACT_ROLE_LABELS[underscored]) {
    return CONTACT_ROLE_LABELS[underscored];
  }
  if (normalized.includes("buyer") && normalized.includes("decision")) {
    return "Comprador / Decisor";
  }
  if (normalized.includes("decision")) {
    return "Decisor";
  }
  if (normalized.includes("buyer")) {
    return "Comprador";
  }
  return role;
}

export interface LinkedDealContactItem {
  id: string;
  contactId: string;
  role?: string | null;
  isPrimary?: boolean;
  contact?: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    cpf?: string | null;
    cnpj?: string | null;
    whatsappUsername?: string | null;
    customFields?: Record<string, unknown> | null;
  } | null;
}

interface ContactSearchResult {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  accountName?: string | null;
  accountId?: string | null;
}

interface DealAddContactDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  dealId: string;
  accountId?: string | null;
  linkedContacts?: LinkedDealContactItem[];
  initialEditContactId?: string | null;
  onContactLinked: () => void;
}

export function DealAddContactDrawer({
  isOpen,
  onClose,
  dealId,
  accountId,
  linkedContacts = [],
  initialEditContactId = null,
  onContactLinked,
}: DealAddContactDrawerProps) {
  const [tab, setTab] = useState<"search" | "create">("search");

  // Estado da aba de busca
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ContactSearchResult[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null);
  const [searchRole, setSearchRole] = useState("buyer");
  const [searchIsPrimary, setSearchIsPrimary] = useState(false);
  const [linkingSearch, setLinkingSearch] = useState(false);

  // Estado de edição de contato já vinculado
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [loadingEditDetails, setLoadingEditDetails] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editWhatsappUsername, setEditWhatsappUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editCpf, setEditCpf] = useState("");
  const [editCnpj, setEditCnpj] = useState("");
  const [editRole, setEditRole] = useState("buyer");
  const [editIsPrimary, setEditIsPrimary] = useState(false);
  const [editCustomFields, setEditCustomFields] = useState<Record<string, unknown>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [unlinkingContactId, setUnlinkingContactId] = useState<string | null>(null);

  // Estado da aba de criação
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createRole, setCreateRole] = useState("buyer");
  const [createIsPrimary, setCreateIsPrimary] = useState(false);
  const [createCustomFields, setCreateCustomFields] = useState<Record<string, unknown>>({});
  const [creating, setCreating] = useState(false);

  const startEditingLinkedContact = async (item: LinkedDealContactItem) => {
    setEditingContactId(item.contactId);
    setEditName(item.contact?.name || "");
    setEditPhone(item.contact?.phone ? maskPhone(item.contact.phone) : "");
    setEditWhatsappUsername(item.contact?.whatsappUsername || "");
    setEditEmail(item.contact?.email || "");
    setEditCpf(item.contact?.cpf || "");
    setEditCnpj(item.contact?.cnpj || "");
    setEditRole((item.role || "buyer").toLowerCase());
    setEditIsPrimary(Boolean(item.isPrimary));
    setEditCustomFields((item.contact?.customFields as Record<string, unknown>) || {});

    setLoadingEditDetails(true);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(item.contactId)}`);
      if (res.ok) {
        const data = await res.json();
        setEditName(data.name || item.contact?.name || "");
        setEditPhone(data.phone ? maskPhone(data.phone) : "");
        setEditWhatsappUsername(data.whatsappUsername || "");
        setEditEmail(data.email || "");
        setEditCpf(data.cpf || "");
        setEditCnpj(data.cnpj || "");
        setEditCustomFields((data.customFields as Record<string, unknown>) || {});
      }
    } catch {
      // Usa dados locais já presentes no item
    } finally {
      setLoadingEditDetails(false);
    }
  };

  // Reset ao abrir
  useEffect(() => {
    if (isOpen) {
      setTab("search");
      setSearchQuery("");
      setSearchResults([]);
      setSelectedContact(null);
      setSearchRole("buyer");
      setSearchIsPrimary(linkedContacts.length === 0);
      setCreateName("");
      setCreatePhone("");
      setCreateEmail("");
      setCreateRole("buyer");
      setCreateIsPrimary(linkedContacts.length === 0);
      setCreateCustomFields({});

      if (initialEditContactId) {
        const found = linkedContacts.find((c) => c.contactId === initialEditContactId);
        if (found) {
          startEditingLinkedContact(found);
        } else {
          setEditingContactId(null);
        }
      } else {
        setEditingContactId(null);
      }
    }
  }, [isOpen, initialEditContactId]);

  // Busca com debounce de contatos (a partir de 1 caractere)
  useEffect(() => {
    if (!isOpen || tab !== "search") return;
    const q = searchQuery.trim();
    if (q.length < 1) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/crm/search?category=contacts&q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Erro ao pesquisar contatos.");
        const data = await res.json();
        const items = data.contacts?.items || [];
        setSearchResults(items);
      } catch (err: any) {
        if (!controller.signal.aborted) {
          setSearchResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, isOpen, tab]);

  // Salvar edição de contato vinculado
  const handleSaveEditedContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContactId || !editName.trim()) {
      toast.error("O nome do contato é obrigatório.");
      return;
    }

    setSavingEdit(true);
    try {
      // 1. Atualiza dados cadastrais do contato
      const patchRes = await fetch(`/api/contacts/${encodeURIComponent(editingContactId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          phone: editPhone.trim() || null,
          whatsappUsername: editWhatsappUsername.trim() || null,
          email: editEmail.trim() || null,
          cpf: editCpf.trim() || null,
          cnpj: editCnpj.trim() || null,
          customFields: editCustomFields,
        }),
      });

      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao atualizar informações do contato.");
      }

      // 2. Atualiza papel comercial e flag de contato principal na negociação
      const dealLinkRes = await fetch(`/api/crm/deals/${dealId}/contacts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: editingContactId,
          role: editRole,
          isPrimary: editIsPrimary,
        }),
      });

      if (!dealLinkRes.ok) {
        const err = await dealLinkRes.json().catch(() => ({}));
        throw new Error(err.error || "Contato salvo, mas falha ao atualizar vínculo na negociação.");
      }

      toast.success("Informações do contato atualizadas com sucesso!");
      setEditingContactId(null);
      onContactLinked();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar alterações do contato.");
    } finally {
      setSavingEdit(false);
    }
  };

  // Desvincular contato da negociação
  const handleUnlinkContact = async (contactId: string, contactName?: string) => {
    if (!dealId) return;
    setUnlinkingContactId(contactId);
    try {
      const res = await fetch(
        `/api/crm/deals/${dealId}/contacts?contactId=${encodeURIComponent(contactId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao desvincular contato.");
      }
      toast.success(
        contactName
          ? `${contactName} desvinculado da negociação.`
          : "Contato desvinculado da negociação."
      );
      if (editingContactId === contactId) {
        setEditingContactId(null);
      }
      onContactLinked();
    } catch (err: any) {
      toast.error(err.message || "Erro ao desvincular contato.");
    } finally {
      setUnlinkingContactId(null);
    }
  };

  // Definir como contato principal diretamente da lista
  const handleSetPrimary = async (contactId: string) => {
    if (!dealId) return;
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/contacts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, isPrimary: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao definir contato principal.");
      }
      toast.success("Contato principal atualizado!");
      onContactLinked();
    } catch (err: any) {
      toast.error(err.message || "Erro ao definir contato principal.");
    }
  };

  // Vincular contato existente
  const handleLinkExisting = async () => {
    if (!selectedContact || !dealId) return;
    setLinkingSearch(true);
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: selectedContact.id,
          role: searchRole,
          isPrimary: searchIsPrimary,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao vincular participante.");
      }

      toast.success(`Contato ${selectedContact.name} vinculado com sucesso!`);
      setSelectedContact(null);
      setSearchQuery("");
      onContactLinked();
    } catch (err: any) {
      toast.error(err.message || "Erro ao vincular contato.");
    } finally {
      setLinkingSearch(false);
    }
  };

  // Criar novo contato e vincular
  const handleCreateAndLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) {
      toast.error("Informe o nome do contato.");
      return;
    }
    setCreating(true);
    try {
      // 1. Criar ou obter contato
      const contactPayload: any = {
        name: createName.trim(),
        phone: createPhone.trim() || undefined,
        email: createEmail.trim() || undefined,
        accountId: accountId || undefined,
        customFields: Object.keys(createCustomFields).length > 0 ? createCustomFields : undefined,
        channel: "whatsapp",
      };

      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactPayload),
      });

      let targetContactId = "";
      if (res.ok) {
        const data = await res.json();
        targetContactId = data.contactId;
      } else if (res.status === 409) {
        // Contato já existe — recupera o ID
        const data = await res.json();
        if (data.contactId) {
          targetContactId = data.contactId;
        } else {
          throw new Error(data.error || "Contato já cadastrado.");
        }
      } else {
        const err = await res.json();
        throw new Error(err.error || "Erro ao criar contato.");
      }

      // 2. Vincular contato à negociação
      const linkRes = await fetch(`/api/crm/deals/${dealId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: targetContactId,
          role: createRole,
          isPrimary: createIsPrimary,
        }),
      });

      if (!linkRes.ok) {
        const err = await linkRes.json();
        throw new Error(err.error || "Contato criado, mas houve erro ao vincular à negociação.");
      }

      toast.success("Contato criado e vinculado à negociação com sucesso!");
      onContactLinked();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao processar contato.");
    } finally {
      setCreating(false);
    }
  };

  const linkedIdsSet = new Set(linkedContacts.map((c) => c.contactId));

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[460px] p-0 flex flex-col bg-card border-l border-border text-foreground"
      >
        <SheetHeader className="p-4 border-b border-border/70 shrink-0">
          <SheetTitle className="text-sm font-bold text-foreground">
            {editingContactId ? "Editar Contato Participante" : "Gerenciar e Adicionar Contatos"}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {editingContactId
              ? "Altere os dados cadastrais, papel comercial ou vínculo deste contato na negociação."
              : "Visualize, edite ou desvincule os contatos atuais, busque na base ou cadastre um novo."}
          </SheetDescription>

          {/* Abas Superiores (ocultas durante edição individual) */}
          {!editingContactId && (
            <div className="flex border border-border rounded-sm p-0.5 bg-muted/30 mt-3">
              <button
                type="button"
                onClick={() => {
                  setTab("search");
                  setSelectedContact(null);
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-sm transition-colors cursor-pointer ${
                  tab === "search"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Search className="h-3.5 w-3.5" />
                <span>Vinculados / Buscar</span>
              </button>
              <button
                type="button"
                onClick={() => setTab("create")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-sm transition-colors cursor-pointer ${
                  tab === "create"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Criar novo contato</span>
              </button>
            </div>
          )}
        </SheetHeader>

        {/* Conteúdo com scroll independente */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {editingContactId ? (
            /* Formulário Completo de Edição do Contato Vinculado */
            <form onSubmit={handleSaveEditedContact} className="space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <button
                  type="button"
                  onClick={() => setEditingContactId(null)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Voltar para contatos vinculados</span>
                </button>
                {loadingEditDetails && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    Carregando...
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">
                  Nome Completo <span className="text-primary">*</span>
                </Label>
                <Input
                  type="text"
                  placeholder="Nome do contato..."
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="h-8 text-xs rounded-sm border-border bg-card"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">
                    Telefone / WhatsApp
                  </Label>
                  <Input
                    type="text"
                    placeholder="(14) 99999-8888"
                    value={editPhone}
                    onChange={(e) => setEditPhone(maskPhone(e.target.value))}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">
                    Usuário WhatsApp (@)
                  </Label>
                  <Input
                    type="text"
                    placeholder="@usuario"
                    value={editWhatsappUsername}
                    onChange={(e) => setEditWhatsappUsername(e.target.value)}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">
                  E-mail
                </Label>
                <Input
                  type="email"
                  placeholder="contato@empresa.com.br"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="h-8 text-xs rounded-sm border-border bg-card"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">
                    CPF
                  </Label>
                  <Input
                    type="text"
                    placeholder="000.000.000-00"
                    value={editCpf}
                    onChange={(e) => setEditCpf(e.target.value)}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">
                    CNPJ
                  </Label>
                  <Input
                    type="text"
                    placeholder="00.000.000/0000-00"
                    value={editCnpj}
                    onChange={(e) => setEditCnpj(e.target.value)}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">
                  Papel na Negociação
                </Label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger className="h-8 rounded-sm text-xs border-border bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[220]">
                    <SelectItem value="buyer" className="text-xs">Comprador</SelectItem>
                    <SelectItem value="decision_maker" className="text-xs">Decisor</SelectItem>
                    <SelectItem value="technical" className="text-xs">Técnico</SelectItem>
                    <SelectItem value="influencer" className="text-xs">Influenciador</SelectItem>
                    <SelectItem value="financial" className="text-xs">Financeiro</SelectItem>
                    <SelectItem value="user" className="text-xs">Usuário</SelectItem>
                    <SelectItem value="other" className="text-xs">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="edit-primary"
                  checked={editIsPrimary}
                  onCheckedChange={(checked) => setEditIsPrimary(!!checked)}
                  className="rounded-sm"
                />
                <label
                  htmlFor="edit-primary"
                  className="text-xs font-medium text-foreground cursor-pointer select-none"
                >
                  Contato principal desta negociação
                </label>
              </div>

              <div className="pt-2 border-t border-border/50">
                <CustomFieldsEditor
                  entity="contact"
                  values={editCustomFields}
                  onChange={setEditCustomFields}
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => handleUnlinkContact(editingContactId, editName)}
                  disabled={unlinkingContactId === editingContactId || savingEdit}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {unlinkingContactId === editingContactId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Unlink className="h-3.5 w-3.5" />
                  )}
                  <span>Desvincular</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingContactId(null)}
                    className="rounded-sm border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit || !editName.trim()}
                    className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    {savingEdit ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    <span>Salvar alterações</span>
                  </button>
                </div>
              </div>
            </form>
          ) : tab === "search" ? (
            <div className="space-y-4">
              {/* Campo de Busca */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Pesquisar na base de contatos para vincular
                </Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Digite nome, telefone, e-mail ou empresa..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (selectedContact) setSelectedContact(null);
                    }}
                    className="pl-8 pr-8 h-9 text-xs rounded-sm border-border bg-card"
                    autoFocus
                  />
                  {searching ? (
                    <Loader2 className="absolute right-2.5 top-2.5 h-3.5 w-3.5 animate-spin text-primary" />
                  ) : searchQuery ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        setSelectedContact(null);
                      }}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Enquanto não pesquisar nenhuma letra: exibe os contatos já vinculados à negociação */}
              {searchQuery.trim().length === 0 && !selectedContact && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Contatos vinculados a esta negociação ({linkedContacts.length})
                    </span>
                  </div>

                  {linkedContacts.length > 0 ? (
                    <div className="space-y-2">
                      {linkedContacts.map((item) => {
                        const cName = item.contact?.name || "Contato";
                        const cPhone = item.contact?.phone ? maskPhone(item.contact.phone) : null;
                        const cEmail = item.contact?.email || null;
                        const roleLabel = formatContactRoleLabel(item.role);

                        return (
                          <div
                            key={item.id || item.contactId}
                            className="rounded-sm border border-border bg-muted/25 p-3 space-y-2 transition-colors hover:border-primary/30"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-xs text-foreground truncate">
                                    {cName}
                                  </span>
                                  <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary uppercase">
                                    {roleLabel}
                                  </span>
                                  {item.isPrimary ? (
                                    <span className="inline-flex items-center gap-0.5 rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-bold text-foreground">
                                      <Star className="h-2.5 w-2.5 fill-primary text-primary" />
                                      Principal
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleSetPrimary(item.contactId)}
                                      className="text-[9px] font-semibold text-muted-foreground hover:text-primary hover:underline cursor-pointer"
                                    >
                                      Tornar principal
                                    </button>
                                  )}
                                </div>

                                {cPhone && (
                                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
                                    <Phone className="h-3 w-3 shrink-0 opacity-70" />
                                    <span>{cPhone}</span>
                                  </div>
                                )}
                                {cEmail && (
                                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <Mail className="h-3 w-3 shrink-0 opacity-70" />
                                    <span className="break-all">{cEmail}</span>
                                  </div>
                                )}
                              </div>

                              {/* Botões de ação: Editar e Desvincular */}
                              <div className="flex items-center gap-1 shrink-0">
                                <SystemTooltip content="Editar dados deste contato">
                                  <button
                                    type="button"
                                    onClick={() => startEditingLinkedContact(item)}
                                    className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground hover:border-primary/40 hover:text-primary transition-colors cursor-pointer"
                                  >
                                    <Pencil className="h-3 w-3" />
                                    <span>Editar</span>
                                  </button>
                                </SystemTooltip>

                                <SystemTooltip content="Desvincular contato da negociação">
                                  <button
                                    type="button"
                                    onClick={() => handleUnlinkContact(item.contactId, cName)}
                                    disabled={unlinkingContactId === item.contactId}
                                    className="inline-flex items-center gap-1 rounded-sm border border-rose-500/25 bg-rose-500/5 px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-500/15 transition-colors cursor-pointer disabled:opacity-50"
                                  >
                                    {unlinkingContactId === item.contactId ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Unlink className="h-3 w-3" />
                                    )}
                                    <span>Desvincular</span>
                                  </button>
                                </SystemTooltip>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-sm border border-dashed border-border p-4 text-center space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Nenhum contato vinculado a esta negociação.
                      </p>
                      <p className="text-[11px] text-muted-foreground/70">
                        Pesquise no campo acima para vincular um contato existente ou clique na aba &ldquo;Criar novo contato&rdquo;.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Contato Selecionado da Busca */}
              {selectedContact && (
                <div className="rounded-sm border-2 border-primary/40 bg-primary/[0.04] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1">
                      <UserCheck className="h-3.5 w-3.5" />
                      Contato Selecionado
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedContact(null)}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Trocar</span>
                    </button>
                  </div>

                  <div className="font-bold text-xs text-foreground">
                    {selectedContact.name}
                  </div>
                  {selectedContact.phone && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3 shrink-0" />
                      <span>{selectedContact.phone}</span>
                    </div>
                  )}
                  {selectedContact.email && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate">{selectedContact.email}</span>
                    </div>
                  )}
                  {selectedContact.accountName && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Building2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{selectedContact.accountName}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Lista de Resultados da Busca (quando há texto digitado) */}
              {!selectedContact && searchQuery.trim().length >= 1 && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    {searchResults.length > 0
                      ? `Contatos encontrados (${searchResults.length})`
                      : !searching
                      ? "Nenhum contato encontrado para esta busca"
                      : "Pesquisando contatos..."}
                  </span>

                  <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                    {searchResults.map((contact) => {
                      const alreadyLinked = linkedIdsSet.has(contact.id);
                      return (
                        <div
                          key={contact.id}
                          onClick={() => {
                            if (alreadyLinked) {
                              const linkedItem = linkedContacts.find((c) => c.contactId === contact.id);
                              if (linkedItem) startEditingLinkedContact(linkedItem);
                            } else {
                              setSelectedContact(contact);
                            }
                          }}
                          className="rounded-sm border border-border bg-card p-2.5 hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-xs text-foreground truncate">
                              {contact.name}
                            </span>
                            {alreadyLinked ? (
                              <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary font-bold shrink-0">
                                Já vinculado · Editar
                              </span>
                            ) : (
                              <span className="text-[10px] text-primary font-semibold hover:underline shrink-0">
                                Selecionar
                              </span>
                            )}
                          </div>
                          {contact.phone && (
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3 shrink-0 opacity-70" />
                              <span>{contact.phone}</span>
                            </div>
                          )}
                          {contact.email && (
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Mail className="h-3 w-3 shrink-0 opacity-70" />
                              <span className="truncate">{contact.email}</span>
                            </div>
                          )}
                          {contact.accountName && (
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Building2 className="h-3 w-3 shrink-0 opacity-70" />
                              <span className="truncate">{contact.accountName}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Configurações de Vínculo ao Selecionar um Contato da Busca */}
              {selectedContact && (
                <div className="space-y-3 pt-2 border-t border-border/60">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-foreground">
                      Papel Comercial
                    </Label>
                    <Select value={searchRole} onValueChange={setSearchRole}>
                      <SelectTrigger className="h-8 rounded-sm text-xs border-border bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[220]">
                        <SelectItem value="buyer" className="text-xs">Comprador</SelectItem>
                        <SelectItem value="decision_maker" className="text-xs">Decisor</SelectItem>
                        <SelectItem value="technical" className="text-xs">Técnico</SelectItem>
                        <SelectItem value="influencer" className="text-xs">Influenciador</SelectItem>
                        <SelectItem value="financial" className="text-xs">Financeiro</SelectItem>
                        <SelectItem value="user" className="text-xs">Usuário</SelectItem>
                        <SelectItem value="other" className="text-xs">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox
                      id="search-primary"
                      checked={searchIsPrimary}
                      onCheckedChange={(checked) => setSearchIsPrimary(!!checked)}
                      className="rounded-sm"
                    />
                    <label
                      htmlFor="search-primary"
                      className="text-xs font-medium text-foreground cursor-pointer select-none"
                    >
                      Definir como contato principal da negociação
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={handleLinkExisting}
                    disabled={linkingSearch}
                    className="w-full h-9 rounded-sm bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 mt-2"
                  >
                    {linkingSearch && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>Vincular Contato à Negociação</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Aba de Criar Novo Contato */
            <form onSubmit={handleCreateAndLink} className="space-y-3.5">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">
                  Nome Completo <span className="text-primary">*</span>
                </Label>
                <Input
                  type="text"
                  placeholder="Nome do cliente/contato..."
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  required
                  className="h-8 text-xs rounded-sm border-border bg-card"
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">
                  Telefone / WhatsApp
                </Label>
                <Input
                  type="text"
                  placeholder="Ex: (14) 99999-8888..."
                  value={createPhone}
                  onChange={(e) => setCreatePhone(maskPhone(e.target.value))}
                  className="h-8 text-xs rounded-sm border-border bg-card"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">
                  E-mail
                </Label>
                <Input
                  type="email"
                  placeholder="contato@empresa.com.br..."
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  className="h-8 text-xs rounded-sm border-border bg-card"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">
                  Papel Comercial
                </Label>
                <Select value={createRole} onValueChange={setCreateRole}>
                  <SelectTrigger className="h-8 rounded-sm text-xs border-border bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[220]">
                    <SelectItem value="buyer" className="text-xs">Comprador</SelectItem>
                    <SelectItem value="decision_maker" className="text-xs">Decisor</SelectItem>
                    <SelectItem value="technical" className="text-xs">Técnico</SelectItem>
                    <SelectItem value="influencer" className="text-xs">Influenciador</SelectItem>
                    <SelectItem value="financial" className="text-xs">Financeiro</SelectItem>
                    <SelectItem value="user" className="text-xs">Usuário</SelectItem>
                    <SelectItem value="other" className="text-xs">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="create-primary"
                  checked={createIsPrimary}
                  onCheckedChange={(checked) => setCreateIsPrimary(!!checked)}
                  className="rounded-sm"
                />
                <label
                  htmlFor="create-primary"
                  className="text-xs font-medium text-foreground cursor-pointer select-none"
                >
                  Definir como contato principal da negociação
                </label>
              </div>

              <div className="pt-2 border-t border-border/50">
                <CustomFieldsEditor
                  entity="contact"
                  values={createCustomFields}
                  onChange={setCreateCustomFields}
                  create
                />
              </div>

              <button
                type="submit"
                disabled={creating || !createName.trim()}
                className="w-full h-9 rounded-sm bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 mt-4"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Criar e Vincular à Negociação</span>
              </button>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
