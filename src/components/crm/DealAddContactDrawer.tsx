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
  Check,
  X,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

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
  onContactLinked: () => void;
}

export function DealAddContactDrawer({
  isOpen,
  onClose,
  dealId,
  accountId,
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

  // Estado da aba de criação
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createRole, setCreateRole] = useState("buyer");
  const [createIsPrimary, setCreateIsPrimary] = useState(false);
  const [creating, setCreating] = useState(false);

  // Reset ao abrir
  useEffect(() => {
    if (isOpen) {
      setTab("search");
      setSearchQuery("");
      setSearchResults([]);
      setSelectedContact(null);
      setSearchRole("buyer");
      setSearchIsPrimary(false);
      setCreateName("");
      setCreatePhone("");
      setCreateEmail("");
      setCreateRole("buyer");
      setCreateIsPrimary(false);
    }
  }, [isOpen]);

  // Busca com debounce de contatos
  useEffect(() => {
    if (!isOpen || tab !== "search") return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
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
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, isOpen, tab]);

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
      onContactLinked();
      onClose();
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

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[460px] p-0 flex flex-col bg-card border-l border-border text-foreground"
      >
        <SheetHeader className="p-4 border-b border-border/70 shrink-0">
          <SheetTitle className="text-sm font-bold text-foreground">
            Adicionar Contato Participante
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Vincule um contato existente da base ou cadastre um novo para esta negociação.
          </SheetDescription>

          {/* Abas Superiores */}
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
              <span>Buscar existente</span>
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
        </SheetHeader>

        {/* Conteúdo com scroll independente */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {tab === "search" ? (
            <div className="space-y-4">
              {/* Campo de Busca */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Pesquisar na base de contatos
                </Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Nome, telefone, e-mail ou empresa..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-9 text-xs rounded-sm border-border bg-card"
                    autoFocus
                  />
                  {searching && (
                    <Loader2 className="absolute right-2.5 top-2.5 h-3.5 w-3.5 animate-spin text-primary" />
                  )}
                </div>
              </div>

              {/* Contato Selecionado */}
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

              {/* Lista de Resultados da Busca */}
              {!selectedContact && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    {searchResults.length > 0
                      ? `Contatos encontrados (${searchResults.length})`
                      : searchQuery.trim().length >= 2 && !searching
                      ? "Nenhum contato encontrado para esta busca"
                      : "Digite ao menos 2 caracteres para buscar"}
                  </span>

                  <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                    {searchResults.map((contact) => (
                      <div
                        key={contact.id}
                        onClick={() => setSelectedContact(contact)}
                        className="rounded-sm border border-border bg-card p-2.5 hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-foreground truncate">
                            {contact.name}
                          </span>
                          <span className="text-[10px] text-primary font-semibold hover:underline">
                            Selecionar
                          </span>
                        </div>
                        {contact.phone && (
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3 shrink-0 opacity-70" />
                            <span>{contact.phone}</span>
                          </div>
                        )}
                        {contact.accountName && (
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Building2 className="h-3 w-3 shrink-0 opacity-70" />
                            <span className="truncate">{contact.accountName}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Configurações de Vínculo */}
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
                      <SelectContent>
                        <SelectItem value="buyer" className="text-xs">Comprador</SelectItem>
                        <SelectItem value="decision_maker" className="text-xs">Decisor</SelectItem>
                        <SelectItem value="technical" className="text-xs">Técnico</SelectItem>
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
                  placeholder="Ex: 5514999998888 ou (14) 99999-8888..."
                  value={createPhone}
                  onChange={(e) => setCreatePhone(e.target.value)}
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
                  <SelectContent>
                    <SelectItem value="buyer" className="text-xs">Comprador</SelectItem>
                    <SelectItem value="decision_maker" className="text-xs">Decisor</SelectItem>
                    <SelectItem value="technical" className="text-xs">Técnico</SelectItem>
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
