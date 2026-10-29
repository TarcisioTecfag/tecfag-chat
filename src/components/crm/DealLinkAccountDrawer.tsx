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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Building2,
  Plus,
  Loader2,
  Phone,
  Mail,
  Globe,
  MapPin,
  X,
  Check,
  Pencil,
  Unlink,
  ArrowLeft,
  User,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { maskPhone } from "@/lib/utils";
import { CatalogSelect } from "./CatalogSelect";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  formatAccountDocumentInput,
  getInlineDocumentMismatch,
  validateAccountDocument,
  validateCnpj,
} from "../../lib/crm/account-validation";
import {
  useCheckDuplicateDocument,
  findDuplicateAccountByDocument,
} from "../../lib/crm/use-check-duplicate-document";
import { fetchCnpjInfo, type CnpjFullDetails } from "../../lib/valentina/cnpj-service";
import {
  buildAccountAddressFromCnpjDetails,
  createEmptyCnpjDetails,
} from "../../lib/crm/cnpj-account-mapper";

export interface LinkedDealAccount {
  id: string;
  name: string;
  tradeName?: string | null;
  type?: "company" | "person" | string | null;
  segment?: string | null;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  } | null;
  customFields?: Record<string, unknown> | null;
}

interface DealLinkAccountDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  dealId: string;
  currentAccount?: LinkedDealAccount | null;
  initialMode?: "search" | "create" | "edit";
  onAccountChanged: () => void;
}

function formatDoc(doc?: string | null) {
  if (!doc) return "";
  const digits = doc.replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return doc;
}

export function DealLinkAccountDrawer({
  isOpen,
  onClose,
  dealId,
  currentAccount = null,
  initialMode = "search",
  onAccountChanged,
}: DealLinkAccountDrawerProps) {
  const [tab, setTab] = useState<"search" | "create">("search");

  // Estado da busca
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<LinkedDealAccount[]>([]);
  const [linkingAccountId, setLinkingAccountId] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  // Estado de edição da empresa vinculada
  const [isEditingCurrent, setIsEditingCurrent] = useState(false);
  const [editType, setEditType] = useState<"company" | "person">("company");
  const [editName, setEditName] = useState("");
  const [editTradeName, setEditTradeName] = useState("");
  const [editDocument, setEditDocument] = useState("");
  const [editSegment, setEditSegment] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editState, setEditState] = useState("");
  const [editCustomFields, setEditCustomFields] = useState<Record<string, unknown>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  // Estado de criação de nova empresa
  const [createType, setCreateType] = useState<"company" | "person">("company");
  const [createName, setCreateName] = useState("");
  const [createTradeName, setCreateTradeName] = useState("");
  const [createDocument, setCreateDocument] = useState("");
  const [createSegment, setCreateSegment] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createWebsite, setCreateWebsite] = useState("");
  const [createCity, setCreateCity] = useState("");
  const [createState, setCreateState] = useState("");
  const [createCustomFields, setCreateCustomFields] = useState<Record<string, unknown>>({});
  const [createCnpjDetails, setCreateCnpjDetails] = useState<CnpjFullDetails>(() =>
    createEmptyCnpjDetails(),
  );
  const [isSearchingCreateCnpj, setIsSearchingCreateCnpj] = useState(false);
  const [creating, setCreating] = useState(false);

  const { duplicateAccount: duplicateCreateAccount } = useCheckDuplicateDocument(
    createDocument,
    isOpen && tab === "create" && !isEditingCurrent,
  );

  const { duplicateAccount: duplicateEditAccount } = useCheckDuplicateDocument(
    editDocument,
    isOpen && isEditingCurrent && Boolean(currentAccount),
    currentAccount?.id,
  );

  const queryReceitaForCreate = async (rawDoc?: string) => {
    const cleanDoc = (rawDoc ?? createDocument).replace(/\D/g, "");
    if (cleanDoc.length !== 14 || !validateCnpj(cleanDoc)) return;
    const existing = await findDuplicateAccountByDocument(cleanDoc);
    if (existing) return;
    setIsSearchingCreateCnpj(true);
    try {
      const info = await fetchCnpjInfo(cleanDoc);
      if (info && info.valid && info.details) {
        const d = info.details;
        if (d.razaoSocial) setCreateName((prev) => d.razaoSocial || prev);
        if (d.nomeFantasia) setCreateTradeName((prev) => d.nomeFantasia || prev);
        if (d.telefone) setCreatePhone((prev) => (d.telefone ? maskPhone(d.telefone) : prev));
        if (d.email) setCreateEmail((prev) => d.email || prev);
        if (d.municipio) setCreateCity((prev) => d.municipio || prev);
        if (d.uf) setCreateState((prev) => d.uf || prev);
        setCreateCnpjDetails((prev) => ({
          ...prev,
          ...d,
          municipio: d.municipio || prev.municipio,
          uf: d.uf || prev.uf,
        }));
        toast.success("Dados da Receita Federal preenchidos automaticamente!");
      }
    } catch {
      // Silencioso no auto-lookup
    } finally {
      setIsSearchingCreateCnpj(false);
    }
  };

  const populateEditForm = (acc: LinkedDealAccount) => {
    setEditType(acc.type === "person" ? "person" : "company");
    setEditName(acc.name || "");
    setEditTradeName(acc.tradeName || "");
    setEditDocument(acc.document ? formatDoc(acc.document) : "");
    setEditSegment(acc.segment || "");
    setEditPhone(acc.phone ? maskPhone(acc.phone) : "");
    setEditEmail(acc.email || "");
    setEditWebsite(acc.website || "");
    setEditCity(acc.address?.city || "");
    setEditState(acc.address?.state || "");
    setEditCustomFields((acc.customFields as Record<string, unknown>) || {});
  };

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setSearchResults([]);
      setCreateType("company");
      setCreateName("");
      setCreateTradeName("");
      setCreateDocument("");
      setCreateSegment("");
      setCreatePhone("");
      setCreateEmail("");
      setCreateWebsite("");
      setCreateCity("");
      setCreateState("");
      setCreateCustomFields({});
      setCreateCnpjDetails(createEmptyCnpjDetails());
      setIsSearchingCreateCnpj(false);

      if (initialMode === "edit" && currentAccount) {
        setTab("search");
        populateEditForm(currentAccount);
        setIsEditingCurrent(true);
      } else if (initialMode === "create") {
        setIsEditingCurrent(false);
        setTab("create");
      } else {
        setIsEditingCurrent(false);
        setTab("search");
      }
    }
  }, [isOpen, initialMode]);

  // Busca empresas (tanto quando há query quanto listagem inicial rápida)
  useEffect(() => {
    if (!isOpen || tab !== "search" || isEditingCurrent) return;
    const q = searchQuery.trim();

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ limit: "25" });
        if (q.length > 0) {
          params.set("search", q);
        }
        const res = await fetch(`/api/crm/accounts?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Erro ao pesquisar empresas.");
        const data = await res.json();
        const list = Array.isArray(data.accounts) ? data.accounts : [];
        setSearchResults(list);
      } catch {
        if (!controller.signal.aborted) {
          setSearchResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, q.length > 0 ? 220 : 40);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, isOpen, tab, isEditingCurrent]);

  // Vincular uma empresa existente à negociação
  const handleLinkAccount = async (account: LinkedDealAccount) => {
    if (!dealId) return;
    setLinkingAccountId(account.id);
    try {
      const res = await fetch(`/api/crm/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.id }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao vincular empresa à negociação.");
      }

      toast.success(`Empresa "${account.name}" vinculada à negociação!`);
      onAccountChanged();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Falha ao vincular empresa.");
    } finally {
      setLinkingAccountId(null);
    }
  };

  // Desvincular empresa atual da negociação
  const handleUnlinkAccount = async () => {
    if (!dealId || !currentAccount) return;
    setUnlinking(true);
    try {
      const res = await fetch(`/api/crm/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: null }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao desvincular empresa.");
      }

      toast.success("Empresa desvinculada da negociação.");
      setIsEditingCurrent(false);
      onAccountChanged();
    } catch (err: any) {
      toast.error(err.message || "Falha ao desvincular empresa.");
    } finally {
      setUnlinking(false);
    }
  };

  // Salvar edição dos dados da empresa vinculada
  const handleSaveEditedAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAccount || !editName.trim()) {
      toast.error("Informe a razão social ou nome da empresa.");
      return;
    }

    if (duplicateEditAccount) {
      toast.error(
        `Já existe outra empresa cadastrada com este ${editType === "company" ? "CNPJ" : "CPF"} (${duplicateEditAccount.name}).`,
      );
      return;
    }

    const docValidation = validateAccountDocument(editType, editDocument);
    if (!docValidation.valid) {
      toast.error(docValidation.error || "Documento inválido.");
      return;
    }

    setSavingEdit(true);
    try {
      const res = await fetch(`/api/crm/accounts/${encodeURIComponent(currentAccount.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          tradeName: editTradeName.trim() || null,
          type: editType,
          document: editDocument.replace(/\D/g, ""),
          segment: editSegment || null,
          phone: editPhone.trim() || null,
          email: editEmail.trim() || null,
          website: editWebsite.trim() || null,
          address: {
            ...(currentAccount.address || {}),
            city: editCity.trim() || undefined,
            state: editState.trim().toUpperCase() || undefined,
          },
          customFields: editCustomFields,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao atualizar dados da empresa.");
      }

      toast.success("Dados da empresa atualizados com sucesso!");
      setIsEditingCurrent(false);
      onAccountChanged();
    } catch (err: any) {
      toast.error(err.message || "Falha ao atualizar empresa.");
    } finally {
      setSavingEdit(false);
    }
  };

  // Criar nova empresa e já vincular à negociação
  const handleCreateAndLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (duplicateCreateAccount) {
      toast.error(
        `Já existe uma empresa cadastrada com este ${createType === "company" ? "CNPJ" : "CPF"} (${duplicateCreateAccount.name}).`,
      );
      return;
    }
    if (!createName.trim()) {
      toast.error("Informe a razão social ou nome da empresa.");
      return;
    }

    const docValidation = validateAccountDocument(createType, createDocument);
    if (!docValidation.valid) {
      toast.error(docValidation.error || "Documento inválido.");
      return;
    }

    setCreating(true);
    try {
      const createRes = await fetch("/api/crm/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          type: createType,
          tradeName: createTradeName.trim() || undefined,
          segment: createSegment || undefined,
          document: createDocument.replace(/\D/g, ""),
          phone: createPhone.trim() || undefined,
          email: createEmail.trim() || undefined,
          website: createWebsite.trim() || undefined,
          address:
            createType === "company"
              ? buildAccountAddressFromCnpjDetails(
                  {
                    ...createCnpjDetails,
                    municipio: createCity.trim() || createCnpjDetails.municipio,
                    uf: createState.trim().toUpperCase() || createCnpjDetails.uf,
                  },
                  null,
                )
              : createCity.trim() || createState.trim()
                ? {
                    city: createCity.trim() || undefined,
                    state: createState.trim().toUpperCase() || undefined,
                  }
                : undefined,
          customFields: Object.keys(createCustomFields).length > 0 ? createCustomFields : undefined,
        }),
      });

      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        throw new Error(createData.error || "Erro ao cadastrar empresa.");
      }

      const newAccountId = createData.account?.id;
      if (!newAccountId) {
        throw new Error("Empresa criada, mas ID não retornado.");
      }

      const linkRes = await fetch(`/api/crm/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: newAccountId }),
      });

      if (!linkRes.ok) {
        const err = await linkRes.json().catch(() => ({}));
        throw new Error(err.error || "Empresa criada, mas falha ao vincular à negociação.");
      }

      toast.success("Empresa cadastrada e vinculada à negociação com sucesso!");
      onAccountChanged();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar e vincular empresa.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        data-tour="deal.account"
        side="right"
        className="w-full sm:max-w-[460px] p-0 flex flex-col bg-card border-l border-border text-foreground"
      >
        <SheetHeader className="p-4 border-b border-border/70 shrink-0">
          <SheetTitle className="text-sm font-bold text-foreground">
            {isEditingCurrent
              ? "Editar Empresa Vinculada"
              : currentAccount
              ? "Gerenciar ou Alterar Empresa"
              : "Vincular ou Criar Empresa"}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {isEditingCurrent
              ? "Atualize os dados cadastrais da empresa vinculada a esta negociação."
              : "Busque uma empresa já cadastrada na base ou crie uma nova caso não exista."}
          </SheetDescription>

          {!isEditingCurrent && (
            <div className="flex border border-border rounded-sm p-0.5 bg-muted/30 mt-3">
              <button
                type="button"
                onClick={() => setTab("search")}
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
                onClick={() => {
                  if (searchQuery.trim() && !createName.trim()) {
                    setCreateName(searchQuery.trim());
                  }
                  setTab("create");
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-sm transition-colors cursor-pointer ${
                  tab === "create"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Criar nova empresa</span>
              </button>
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isEditingCurrent && currentAccount ? (
            <form onSubmit={handleSaveEditedAccount} className="space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <button
                  type="button"
                  onClick={() => setIsEditingCurrent(false)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Voltar</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">Tipo</Label>
                  <Select value={editType} disabled>
                    <SystemTooltip content="Tipo de cadastro da empresa">
                      <SelectTrigger className="h-8 rounded-sm text-xs border-border bg-muted/50 opacity-80 cursor-not-allowed">
                        <SelectValue />
                      </SelectTrigger>
                    </SystemTooltip>
                    <SelectContent className="z-[220]">
                      <SelectItem value="company" className="text-xs">Pessoa Jurídica (PJ)</SelectItem>
                      <SelectItem value="person" className="text-xs">Pessoa Física (PF)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <Label className="text-xs font-semibold text-foreground">
                    {editType === "company" ? "CNPJ" : "CPF"}{" "}
                    <span className="text-primary">*</span>
                  </Label>
                  <Input
                    type="text"
                    required
                    placeholder={editType === "company" ? "00.000.000/0000-00" : "000.000.000-00"}
                    value={editDocument}
                    onChange={(e) => setEditDocument(formatAccountDocumentInput(e.target.value, editType))}
                    className={`h-8 text-xs rounded-sm bg-card font-mono ${
                      duplicateEditAccount ? "border-rose-500" : "border-border"
                    }`}
                  />
                  {duplicateEditAccount && (
                    <div className="mt-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-[11px] text-rose-700 dark:text-rose-300 space-y-1.5">
                      <p className="font-bold">
                        Já existe uma empresa cadastrada com este {editType === "company" ? "CNPJ" : "CPF"}:{" "}
                        <span className="underline">{duplicateEditAccount.name}</span>.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleLinkAccount(duplicateEditAccount as LinkedDealAccount)}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
                      >
                        Usar empresa existente ({duplicateEditAccount.name})
                      </button>
                    </div>
                  )}
                  {(() => {
                    const mismatch = getInlineDocumentMismatch(editType, editDocument);
                    if (!mismatch) return null;
                    return (
                      <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                        {mismatch.message}
                      </p>
                    );
                  })()}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">
                  {editType === "company" ? "Razão Social / Nome da Empresa" : "Nome Completo"}{" "}
                  <span className="text-primary">*</span>
                </Label>
                <Input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="h-8 text-xs rounded-sm border-border bg-card"
                />
              </div>

              {editType === "company" && (
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">Nome Fantasia</Label>
                  <Input
                    type="text"
                    value={editTradeName}
                    onChange={(e) => setEditTradeName(e.target.value)}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Segmento</Label>
                <CatalogSelect
                  kind="segment"
                  value={editSegment}
                  onChange={setEditSegment}
                  placeholder="Selecionar segmento"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">Telefone</Label>
                  <Input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(maskPhone(e.target.value))}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">E-mail</Label>
                  <Input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <Label className="text-xs font-semibold text-foreground">Cidade</Label>
                  <Input
                    type="text"
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">UF</Label>
                  <Input
                    type="text"
                    maxLength={2}
                    value={editState}
                    onChange={(e) => setEditState(e.target.value.toUpperCase())}
                    className="h-8 text-xs rounded-sm border-border bg-card uppercase"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Site</Label>
                <Input
                  type="text"
                  placeholder="https://..."
                  value={editWebsite}
                  onChange={(e) => setEditWebsite(e.target.value)}
                  className="h-8 text-xs rounded-sm border-border bg-card"
                />
              </div>

              <div className="pt-2 border-t border-border/50">
                <CustomFieldsEditor
                  entity="company"
                  values={editCustomFields}
                  onChange={setEditCustomFields}
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/60">
                <button
                  type="button"
                  onClick={handleUnlinkAccount}
                  disabled={unlinking || savingEdit}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {unlinking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Unlink className="h-3.5 w-3.5" />
                  )}
                  <span>Desvincular</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingCurrent(false)}
                    className="rounded-sm border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit || !editName.trim() || Boolean(duplicateEditAccount)}
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
                  Pesquisar empresa ou cliente na base
                </Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Razão social, nome fantasia, CNPJ ou CPF..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 pr-8 h-9 text-xs rounded-sm border-border bg-card"
                    autoFocus
                  />
                  {searching ? (
                    <Loader2 className="absolute right-2.5 top-2.5 h-3.5 w-3.5 animate-spin text-primary" />
                  ) : searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Empresa atualmente vinculada (quando o campo de busca está vazio) */}
              {searchQuery.trim().length === 0 && currentAccount && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Empresa vinculada a esta negociação
                  </span>

                  <div className="rounded-sm border-2 border-primary/30 bg-primary/[0.03] p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {currentAccount.type === "person" ? (
                            <User className="h-3.5 w-3.5 text-primary shrink-0" />
                          ) : (
                            <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                          )}
                          <span className="font-bold text-xs text-foreground break-words">
                            {currentAccount.name}
                          </span>
                          <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary uppercase">
                            {currentAccount.type === "person" ? "PF" : "PJ"}
                          </span>
                        </div>

                        {currentAccount.tradeName && (
                          <p className="text-[11px] text-muted-foreground">
                            Fantasia: <span className="text-foreground">{currentAccount.tradeName}</span>
                          </p>
                        )}
                        {currentAccount.document && (
                          <p className="text-[11px] text-muted-foreground font-mono">
                            {formatDoc(currentAccount.document)}
                          </p>
                        )}
                        {currentAccount.phone && (
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Phone className="h-3 w-3 shrink-0 opacity-70" />
                            <span>{currentAccount.phone}</span>
                          </div>
                        )}
                        {currentAccount.email && (
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Mail className="h-3 w-3 shrink-0 opacity-70" />
                            <span className="break-all">{currentAccount.email}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <SystemTooltip content="Editar dados da empresa">
                          <button
                            type="button"
                            onClick={() => {
                              populateEditForm(currentAccount);
                              setIsEditingCurrent(true);
                            }}
                            className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground hover:border-primary/40 hover:text-primary transition-colors cursor-pointer"
                          >
                            <Pencil className="h-3 w-3" />
                            <span>Editar</span>
                          </button>
                        </SystemTooltip>

                        <SystemTooltip content="Desvincular empresa da negociação">
                          <button
                            type="button"
                            onClick={handleUnlinkAccount}
                            disabled={unlinking}
                            className="inline-flex items-center gap-1 rounded-sm border border-rose-500/25 bg-rose-500/5 px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-500/15 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {unlinking ? (
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
                </div>
              )}

              {/* Lista de Empresas Encontradas / Recentes */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  {searchQuery.trim().length > 0
                    ? searchResults.length > 0
                      ? `Empresas encontradas (${searchResults.length})`
                      : !searching
                      ? "Nenhuma empresa encontrada com esse termo"
                      : "Buscando empresas..."
                    : `Empresas cadastradas na base (${searchResults.length})`}
                </span>

                <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
                  {searchResults.map((acc) => {
                    const isCurrent = currentAccount?.id === acc.id;
                    const isLinking = linkingAccountId === acc.id;

                    return (
                      <div
                        key={acc.id}
                        onClick={() => {
                          if (isCurrent) {
                            populateEditForm(acc);
                            setIsEditingCurrent(true);
                          } else if (!isLinking) {
                            handleLinkAccount(acc);
                          }
                        }}
                        className="rounded-sm border border-border bg-card p-2.5 hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="font-bold text-xs text-foreground truncate">
                              {acc.name}
                            </span>
                          </div>
                          {isCurrent ? (
                            <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary shrink-0">
                              Vinculada · Editar
                            </span>
                          ) : isLinking ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary shrink-0">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Vinculando...
                            </span>
                          ) : (
                            <span className="text-[10px] text-primary font-semibold hover:underline shrink-0">
                              Vincular
                            </span>
                          )}
                        </div>

                        {acc.tradeName && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            Fantasia: {acc.tradeName}
                          </div>
                        )}
                        {acc.document && (
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {formatDoc(acc.document)}
                          </div>
                        )}
                        {(acc.phone || acc.email) && (
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                            {acc.phone && (
                              <span className="inline-flex items-center gap-1">
                                <Phone className="h-3 w-3 opacity-70" />
                                {acc.phone}
                              </span>
                            )}
                            {acc.email && (
                              <span className="inline-flex items-center gap-1 truncate">
                                <Mail className="h-3 w-3 opacity-70" />
                                {acc.email}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Atalho para criar nova empresa caso a busca não encontre */}
                {searchQuery.trim().length > 0 && !searching && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateName(searchQuery.trim());
                        setTab("create");
                      }}
                      className="w-full rounded-sm border border-dashed border-primary/40 bg-primary/[0.03] p-2.5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>
                        Não encontrou? Criar empresa &ldquo;{searchQuery.trim()}&rdquo;
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Aba de Criar Nova Empresa */
            <form onSubmit={handleCreateAndLink} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">Tipo</Label>
                  <Select
                    value={createType}
                    onValueChange={(v) => {
                      const nextType = v as "company" | "person";
                      setCreateType(nextType);
                      if (createDocument) {
                        setCreateDocument(formatAccountDocumentInput(createDocument, nextType));
                      }
                    }}
                  >
                    <SystemTooltip content="Selecionar tipo de cadastro (PJ ou PF)">
                      <SelectTrigger className="h-8 rounded-sm text-xs border-border bg-card">
                        <SelectValue />
                      </SelectTrigger>
                    </SystemTooltip>
                    <SelectContent className="z-[220]">
                      <SelectItem value="company" className="text-xs">Pessoa Jurídica (PJ)</SelectItem>
                      <SelectItem value="person" className="text-xs">Pessoa Física (PF)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-semibold text-foreground">
                      {createType === "company" ? "CNPJ" : "CPF"}{" "}
                      <span className="text-primary">*</span>
                    </Label>
                    {createType === "company" && isSearchingCreateCnpj && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Consultando Receita...
                      </span>
                    )}
                  </div>
                  <Input
                    type="text"
                    required
                    placeholder={createType === "company" ? "00.000.000/0000-00" : "000.000.000-00"}
                    value={createDocument}
                    onChange={(e) => {
                      const prevDigits = createDocument.replace(/\D/g, "");
                      const nextFormatted = formatAccountDocumentInput(e.target.value, createType);
                      const nextDigits = nextFormatted.replace(/\D/g, "");
                      setCreateDocument(nextFormatted);
                      if (
                        createType === "company" &&
                        nextDigits.length === 14 &&
                        nextDigits !== prevDigits &&
                        validateCnpj(nextDigits)
                      ) {
                        void queryReceitaForCreate(nextDigits);
                      }
                    }}
                    className={`h-8 text-xs rounded-sm bg-card font-mono ${
                      duplicateCreateAccount ? "border-rose-500" : "border-border"
                    }`}
                  />
                  {duplicateCreateAccount && (
                    <div className="mt-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-[11px] text-rose-700 dark:text-rose-300 space-y-1.5">
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-500" />
                        <div>
                          <p className="font-bold">
                            Já existe uma empresa cadastrada com este {createType === "company" ? "CNPJ" : "CPF"}:{" "}
                            <span className="underline">{duplicateCreateAccount.name}</span>
                          </p>
                          <p className="text-[10px] opacity-90 mt-0.5">
                            Não é permitido criar cadastros duplicados. Você pode vincular a empresa existente diretamente:
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLinkAccount(duplicateCreateAccount as LinkedDealAccount)}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
                      >
                        Vincular empresa existente ({duplicateCreateAccount.name})
                      </button>
                    </div>
                  )}
                  {(() => {
                    const mismatch = getInlineDocumentMismatch(createType, createDocument);
                    if (!mismatch) return null;
                    return (
                      <div className="mt-1 space-y-1">
                        <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                          {mismatch.message}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setCreateType(mismatch.suggestedType);
                            setCreateDocument(
                              formatAccountDocumentInput(createDocument, mismatch.suggestedType)
                            );
                          }}
                          className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                        >
                          {mismatch.suggestedLabel}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">
                  {createType === "company" ? "Razão Social / Nome da Empresa" : "Nome Completo"}{" "}
                  <span className="text-primary">*</span>
                </Label>
                <Input
                  type="text"
                  placeholder={createType === "company" ? "Ex: Indústria ABC Ltda..." : "Nome completo..."}
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  required
                  className="h-8 text-xs rounded-sm border-border bg-card"
                  autoFocus
                />
              </div>

              {createType === "company" && (
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">Nome Fantasia</Label>
                  <Input
                    type="text"
                    placeholder="Nome fantasia..."
                    value={createTradeName}
                    onChange={(e) => setCreateTradeName(e.target.value)}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Segmento</Label>
                <CatalogSelect
                  kind="segment"
                  value={createSegment}
                  onChange={setCreateSegment}
                  placeholder="Selecionar segmento"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">Telefone / WhatsApp</Label>
                  <Input
                    type="text"
                    placeholder="(14) 99999-8888"
                    value={createPhone}
                    onChange={(e) => setCreatePhone(maskPhone(e.target.value))}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">E-mail</Label>
                  <Input
                    type="email"
                    placeholder="contato@empresa.com.br"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <Label className="text-xs font-semibold text-foreground">Cidade</Label>
                  <Input
                    type="text"
                    placeholder="Cidade..."
                    value={createCity}
                    onChange={(e) => setCreateCity(e.target.value)}
                    className="h-8 text-xs rounded-sm border-border bg-card"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">UF</Label>
                  <Input
                    type="text"
                    maxLength={2}
                    placeholder="SP"
                    value={createState}
                    onChange={(e) => setCreateState(e.target.value.toUpperCase())}
                    className="h-8 text-xs rounded-sm border-border bg-card uppercase"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Site</Label>
                <Input
                  type="text"
                  placeholder="https://www.empresa.com.br"
                  value={createWebsite}
                  onChange={(e) => setCreateWebsite(e.target.value)}
                  className="h-8 text-xs rounded-sm border-border bg-card"
                />
              </div>

              <div className="pt-2 border-t border-border/50">
                <CustomFieldsEditor
                  entity="company"
                  values={createCustomFields}
                  onChange={setCreateCustomFields}
                  create
                />
              </div>

              <button
                type="submit"
                disabled={creating || !createName.trim() || Boolean(duplicateCreateAccount)}
                className="w-full h-9 rounded-sm bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 mt-4"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Criar e Vincular Empresa à Negociação</span>
              </button>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
