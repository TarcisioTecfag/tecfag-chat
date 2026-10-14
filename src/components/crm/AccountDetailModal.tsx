import React, { useState, useEffect } from "react";
import {
  X,
  Building2,
  User,
  Users,
  Briefcase,
  MessageSquare,
  History,
  Save,
  Trash2,
  ExternalLink,
  Loader2,
  Phone,
  Mail,
  Globe,
  FileText,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { CustomFieldsEditor, changedCustomFieldValues } from "./CustomFieldsEditor";
import { CatalogSelect } from "./CatalogSelect";
import { DealStatusBadge } from "./deal-status-config";
import { SystemTooltip } from "@/components/ui/tooltip";
import type { CrmAccountDetailDTO } from "../../lib/crm/crm-types";

interface AccountDetailModalProps {
  accountId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onAccountUpdated?: () => void;
  onOpenDeal?: (dealId: string) => void;
  onOpenChat?: (conversationId: string) => void;
}

function maskCpf(val: string): string {
  const digits = val.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function maskCnpj(val: string): string {
  const digits = val.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

function maskPhone(val: string): string {
  const digits = val.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }
  return digits
    .replace(/(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
}

const UNIFORM_INPUT_CLASS =
  "h-9 w-full rounded-[8px] border border-slate-300/85 dark:border-slate-700/80 bg-muted/35 dark:bg-slate-900/60 px-3 text-xs font-medium text-foreground placeholder:text-muted-foreground/60 outline-none transition-all hover:border-primary/40 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/15";

const UNIFORM_LABEL_CLASS =
  "block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5";

export function AccountDetailModal({
  accountId,
  isOpen,
  onClose,
  onAccountUpdated,
  onOpenDeal,
  onOpenChat,
}: AccountDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"details" | "contacts" | "deals" | "conversations" | "history">("details");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accountData, setAccountData] = useState<CrmAccountDetailDTO | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [segment, setSegment] = useState("");
  const [type, setType] = useState<"person" | "company">("company");
  const [document, setDocument] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [originalCustomFields, setOriginalCustomFields] = useState<Record<string, unknown>>({});

  const loadAccount = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/accounts/${id}`);
      if (!res.ok) {
        throw new Error("Não foi possível carregar os dados da conta.");
      }
      const data = await res.json();
      setAccountData(data);
      setName(data.account.name || "");
      setTradeName(data.account.tradeName || "");
      setSegment(data.account.segment || "");
      setType(data.account.type || "company");
      setDocument(
        data.account.document
          ? data.account.type === "company"
            ? maskCnpj(data.account.document)
            : maskCpf(data.account.document)
          : ""
      );
      setPhone(data.account.phone ? maskPhone(data.account.phone) : "");
      setEmail(data.account.email || "");
      setWebsite(data.account.website || "");
      setNotes(data.account.notes || "");
      setCustomFields(data.account.customFields || {});
      setOriginalCustomFields(data.account.customFields || {});
    } catch (err: any) {
      toast.error(err.message || "Erro ao buscar detalhes da conta.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && accountId) {
      loadAccount(accountId);
    } else {
      setAccountData(null);
      setActiveTab("details");
    }
  }, [isOpen, accountId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, saving, onClose]);

  if (!isOpen || !accountId) return null;

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!name.trim()) {
      toast.error("O nome ou razão social é obrigatório.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/crm/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          tradeName: tradeName.trim() || null,
          segment: type === "company" ? segment || null : null,
          type,
          document: document ? document.replace(/\D/g, "") : null,
          phone: phone ? phone.replace(/\D/g, "") : null,
          email: email.trim() || null,
          website: website.trim() || null,
          notes: notes.trim() || null,
          customFields: changedCustomFieldValues(originalCustomFields, customFields),
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Erro ao salvar alterações da conta.");
      }

      toast.success("Dados do cliente atualizados com sucesso!");
      loadAccount(accountId);
      onAccountUpdated?.();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar conta.");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!confirm("Tem certeza que deseja arquivar este cliente? O histórico referencial será preservado.")) {
      return;
    }

    try {
      const res = await fetch(`/api/crm/accounts/${accountId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Erro ao arquivar cliente.");
      }

      toast.success("Cliente arquivado com sucesso.");
      onAccountUpdated?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao arquivar cliente.");
    }
  };

  const handleUnlinkContact = async (contactId: string) => {
    if (!confirm("Deseja desvincular este contato da empresa? O contato continuará existindo e o histórico de transição será registrado.")) {
      return;
    }

    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: null,
          accountChangeReason: `Desvinculado manualmente da conta ${name}`,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao desvincular contato.");
      }

      toast.success("Contato desvinculado com sucesso!");
      loadAccount(accountId);
      onAccountUpdated?.();
    } catch (err: any) {
      toast.error(err.message || "Erro ao desvincular contato.");
    }
  };

  const tabs = [
    {
      id: "details" as const,
      label: "Dados Cadastrais",
      icon: Building2,
      count: null as number | null,
    },
    {
      id: "contacts" as const,
      label: "Contatos",
      icon: Users,
      count: accountData?.contacts?.length ?? 0,
    },
    {
      id: "deals" as const,
      label: "Negociações",
      icon: Briefcase,
      count: accountData?.deals?.length ?? 0,
    },
    {
      id: "conversations" as const,
      label: "Atendimentos",
      icon: MessageSquare,
      count: accountData?.conversations?.length ?? 0,
    },
    {
      id: "history" as const,
      label: "Histórico",
      icon: History,
      count: accountData?.history?.length ?? 0,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="bg-card text-foreground border border-slate-300/70 dark:border-slate-800 ring-1 ring-black/5 dark:ring-white/10 rounded-[14px] shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary border border-primary/20">
              {type === "company" ? <Building2 className="w-5 h-5" /> : <User className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-extrabold text-foreground truncate max-w-md">
                  {name || "Carregando..."}
                </h2>
                <span className="rounded-[6px] bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  {type === "company" ? "PJ" : "PF"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                {tradeName && (
                  <span>
                    Fantasia: <strong className="font-semibold text-foreground">{tradeName}</strong>
                  </span>
                )}
                {tradeName && document && <span>•</span>}
                {document && (
                  <span className="font-mono">{document}</span>
                )}
                {!tradeName && !document && (
                  <span>Ficha cadastral e vínculos comerciais do cliente</span>
                )}
              </div>
            </div>
          </div>
          <SystemTooltip content="Fechar (Esc)">
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
              aria-label="Fechar modal"
            >
              <X className="w-4 h-4" />
            </button>
          </SystemTooltip>
        </div>

        {/* Barra de Abas */}
        <div className="flex items-center px-6 border-b border-border bg-muted/20 gap-5 overflow-x-auto shrink-0">
          {tabs.map((t) => {
            const TabIcon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`py-3 flex items-center gap-2 border-b-2 text-xs transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? "border-primary text-primary font-bold"
                    : "border-transparent text-muted-foreground hover:text-foreground font-semibold"
                }`}
              >
                <TabIcon className="w-3.5 h-3.5 shrink-0" />
                <span>{t.label}</span>
                {t.count !== null && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      isActive
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Conteúdo das Abas */}
        <div className="flex-1 overflow-y-auto p-6 bg-muted/15">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-56 space-y-3">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
              <p className="text-xs font-medium text-muted-foreground">
                Carregando dados do cliente...
              </p>
            </div>
          ) : (
            <>
              {/* ABA 1: DADOS CADASTRAIS */}
              {activeTab === "details" && (
                <form id="account-detail-form" onSubmit={handleSave} className="w-full space-y-4">
                  {/* Bloco 1: Dados Principais & Canais de Contato */}
                  <div className="rounded-[10px] border border-slate-200/90 dark:border-slate-800 bg-card p-4 shadow-2xs space-y-4">
                    {/* Barra de Seção + Seletor Tipo PF/PJ */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/70">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-primary" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                          Identificação Cadastral
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Tipo de Cliente:
                        </span>
                        <div className="inline-flex rounded-[8px] border border-slate-300/80 dark:border-slate-700/80 p-0.5 bg-muted/50">
                          <button
                            type="button"
                            onClick={() => {
                              setType("company");
                              if (document) setDocument(maskCnpj(document));
                            }}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-[6px] transition-all cursor-pointer ${
                              type === "company"
                                ? "bg-primary text-primary-foreground font-bold shadow-2xs"
                                : "text-muted-foreground hover:text-foreground font-medium"
                            }`}
                          >
                            <Building2 className="w-3 h-3" />
                            <span>Pessoa Jurídica (PJ)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setType("person");
                              if (document) setDocument(maskCpf(document));
                            }}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-[6px] transition-all cursor-pointer ${
                              type === "person"
                                ? "bg-primary text-primary-foreground font-bold shadow-2xs"
                                : "text-muted-foreground hover:text-foreground font-medium"
                            }`}
                          >
                            <User className="w-3 h-3" />
                            <span>Pessoa Física (PF)</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Grid Simétrico de Identificação (2 Colunas) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      <div>
                        <label className={UNIFORM_LABEL_CLASS}>
                          {type === "company" ? "Razão Social" : "Nome Completo"}{" "}
                          <span className="text-primary">*</span>
                        </label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          required
                          placeholder={type === "company" ? "Informe a razão social..." : "Informe o nome completo..."}
                          className={UNIFORM_INPUT_CLASS}
                        />
                      </div>

                      {type === "company" && (
                        <div>
                          <label className={UNIFORM_LABEL_CLASS}>
                            Nome Fantasia
                          </label>
                          <input
                            type="text"
                            value={tradeName}
                            onChange={(e) => setTradeName(e.target.value)}
                            placeholder="Nome comercial da empresa..."
                            className={UNIFORM_INPUT_CLASS}
                          />
                        </div>
                      )}

                      <div>
                        <label className={UNIFORM_LABEL_CLASS}>
                          {type === "company" ? "CNPJ (14 dígitos)" : "CPF (11 dígitos)"}
                        </label>
                        <input
                          type="text"
                          value={document}
                          onChange={(e) =>
                            setDocument(type === "company" ? maskCnpj(e.target.value) : maskCpf(e.target.value))
                          }
                          placeholder={type === "company" ? "00.000.000/0000-00" : "000.000.000-00"}
                          className={`${UNIFORM_INPUT_CLASS} font-mono`}
                        />
                      </div>

                      {type === "company" && (
                        <div>
                          <label className={UNIFORM_LABEL_CLASS}>Segmento</label>
                          <CatalogSelect
                            kind="segment"
                            value={segment}
                            onChange={setSegment}
                            className={UNIFORM_INPUT_CLASS}
                          />
                        </div>
                      )}
                    </div>

                    {/* Grid Simétrico de Canais de Contato (3 Colunas Iguais — Sem Campo Órfão) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1">
                      <div>
                        <label className={UNIFORM_LABEL_CLASS}>
                          Telefone Principal
                        </label>
                        <div className="relative flex items-center">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground absolute left-3 pointer-events-none" />
                          <input
                            type="text"
                            value={phone}
                            onChange={(e) => setPhone(maskPhone(e.target.value))}
                            placeholder="(00) 00000-0000"
                            className={`${UNIFORM_INPUT_CLASS} pl-8`}
                          />
                        </div>
                      </div>

                      <div>
                        <label className={UNIFORM_LABEL_CLASS}>
                          E-mail de Contato
                        </label>
                        <div className="relative flex items-center">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground absolute left-3 pointer-events-none" />
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="contato@empresa.com"
                            className={`${UNIFORM_INPUT_CLASS} pl-8`}
                          />
                        </div>
                      </div>

                      <div>
                        <label className={UNIFORM_LABEL_CLASS}>
                          Website
                        </label>
                        <div className="relative flex items-center">
                          <Globe className="w-3.5 h-3.5 text-muted-foreground absolute left-3 pointer-events-none" />
                          <input
                            type="text"
                            value={website}
                            onChange={(e) => setWebsite(e.target.value)}
                            placeholder="https://empresa.com.br"
                            className={`${UNIFORM_INPUT_CLASS} pl-8`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Observações Internas (Largura Total) */}
                    <div className="pt-1">
                      <label className={UNIFORM_LABEL_CLASS}>
                        Observações Internas
                      </label>
                      <textarea
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Notas contextuais sobre este cliente, ramo de atividade, perfil de compras..."
                        className="w-full rounded-[8px] border border-slate-300/85 dark:border-slate-700/80 bg-muted/35 dark:bg-slate-900/60 px-3 py-2 text-xs font-medium text-foreground placeholder:text-muted-foreground/60 outline-none transition-all hover:border-primary/40 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/15 resize-y min-h-[72px]"
                      />
                    </div>
                  </div>

                  {/* Bloco 2: Campos Personalizados em Grid de 2 Colunas */}
                  <div className="rounded-[10px] border border-slate-200/90 dark:border-slate-800 bg-card p-4 shadow-2xs space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-border/70">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                        Campos Personalizados
                      </span>
                    </div>
                    <CustomFieldsEditor
                      entity="company"
                      values={customFields}
                      onChange={setCustomFields}
                      hideTitle
                      columns={2}
                    />
                  </div>
                </form>
              )}

              {/* ABA 2: CONTATOS (1:N) */}
              {activeTab === "contacts" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Contatos vinculados a esta empresa
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Pessoas físicas cadastradas na base que representam este cliente.
                      </p>
                    </div>
                  </div>

                  {accountData?.contacts && accountData.contacts.length > 0 ? (
                    <div className="divide-y divide-border border border-slate-200/90 dark:border-slate-800 rounded-[10px] overflow-hidden bg-card shadow-2xs">
                      {accountData.contacts.map((c) => (
                        <div
                          key={c.id}
                          className="p-3.5 flex items-center justify-between bg-card hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-[8px] bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                              {c.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-foreground truncate">
                                {c.name}
                              </div>
                              <div className="text-[11px] text-muted-foreground flex items-center gap-3 mt-0.5 flex-wrap">
                                {c.phone && (
                                  <span className="flex items-center gap-1 font-mono">
                                    <Phone className="w-3 h-3 text-primary/70" />
                                    <span>{maskPhone(c.phone)}</span>
                                  </span>
                                )}
                                {c.email && (
                                  <span className="flex items-center gap-1 truncate">
                                    <Mail className="w-3 h-3 text-primary/70" />
                                    <span>{c.email}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleUnlinkContact(c.id)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/25 bg-rose-500/5 hover:bg-rose-500/15 rounded-[6px] transition-colors cursor-pointer"
                            >
                              Desvincular
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-[10px] bg-card text-muted-foreground">
                      <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                      <p className="text-xs font-bold text-foreground">Nenhum contato vinculado ainda.</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Ao criar ou editar contatos, defina esta conta como cliente principal.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ABA 3: NEGOCIAÇÕES / CARDS */}
              {activeTab === "deals" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Negociações deste Cliente
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Todos os cards vinculados a esta conta compradora nos funis de venda.
                    </p>
                  </div>

                  {accountData?.deals && accountData.deals.length > 0 ? (
                    <div className="divide-y divide-border border border-slate-200/90 dark:border-slate-800 rounded-[10px] overflow-hidden bg-card shadow-2xs">
                      {accountData.deals.map((d) => (
                        <div
                          key={d.id}
                          onClick={() => onOpenDeal?.(d.id)}
                          className="p-3.5 flex items-center justify-between bg-card hover:bg-muted/30 cursor-pointer transition-colors group"
                        >
                          <div className="min-w-0 pr-3">
                            <div className="text-xs font-bold text-foreground group-hover:text-primary transition-colors truncate">
                              {d.title}
                            </div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                              <span className="font-bold text-primary">
                                {d.value !== null
                                  ? `R$ ${parseFloat(d.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                                  : "A combinar"}
                              </span>
                              <span>•</span>
                              <span>Criado em {new Date(d.createdAt).toLocaleDateString("pt-BR")}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <DealStatusBadge status={d.status} size="sm" className="rounded-full" />
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-[10px] bg-card text-muted-foreground">
                      <Briefcase className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                      <p className="text-xs font-bold text-foreground">
                        Nenhuma negociação encontrada para este cliente.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ABA 4: ATENDIMENTOS / CONVERSAS VINCULADAS */}
              {activeTab === "conversations" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Atendimentos Vinculados à Conta
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Conversas de WhatsApp e canais associadas formalmente a esta conta compradora.
                    </p>
                  </div>

                  {accountData?.conversations && accountData.conversations.length > 0 ? (
                    <div className="divide-y divide-border border border-slate-200/90 dark:border-slate-800 rounded-[10px] overflow-hidden bg-card shadow-2xs">
                      {accountData.conversations.map((cv) => (
                        <div
                          key={cv.id}
                          className="p-3.5 flex items-center justify-between bg-card hover:bg-muted/30 transition-colors"
                        >
                          <div className="space-y-1 min-w-0 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-[5px]">
                                {cv.conversation?.channel || "chat"}
                              </span>
                              <span className="text-xs font-bold text-foreground truncate">
                                {cv.conversation?.contactName || "Atendimento"}
                              </span>
                            </div>
                            {cv.contextNote && (
                              <p className="text-xs text-muted-foreground italic">
                                &ldquo;{cv.contextNote}&rdquo;
                              </p>
                            )}
                            <div className="text-[11px] text-muted-foreground">
                              Vinculado por {cv.operatorName || "Sistema"} em{" "}
                              {new Date(cv.createdAt).toLocaleDateString("pt-BR")}
                            </div>
                          </div>
                          {onOpenChat && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenChat(cv.conversationId);
                                onClose();
                              }}
                              className="px-3 py-1.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-[8px] transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                            >
                              <span>Ver no Chat</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-[10px] bg-card text-muted-foreground">
                      <MessageSquare className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                      <p className="text-xs font-bold text-foreground">
                        Nenhum atendimento vinculado diretamente.
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Conversas podem ser associadas pelo painel lateral do chat.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ABA 5: HISTÓRICO DE TRANSIÇÕES */}
              {activeTab === "history" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Histórico de Transições de Contatos
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Registro auditável de contatos vinculados ou transferidos desta conta.
                    </p>
                  </div>

                  {accountData?.history && accountData.history.length > 0 ? (
                    <div className="rounded-[10px] border border-slate-200/90 dark:border-slate-800 bg-card p-5 shadow-2xs">
                      <div className="relative pl-6 space-y-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                        {accountData.history.map((h) => (
                          <div key={h.id} className="relative group">
                            <div className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-card" />
                            <div className="text-xs font-bold text-foreground">
                              {h.contactName || "Contato"} associado à conta
                            </div>
                            {h.reason && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Motivo: <span className="text-foreground/90 font-medium">{h.reason}</span>
                              </p>
                            )}
                            <div className="text-[11px] text-muted-foreground mt-1">
                              Alterado por <strong className="font-semibold text-foreground">{h.operatorName || "Operador"}</strong> em{" "}
                              {new Date(h.createdAt).toLocaleString("pt-BR")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-[10px] bg-card text-muted-foreground">
                      <History className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                      <p className="text-xs font-bold text-foreground">
                        Nenhum evento histórico registrado para esta conta.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé Fixo de Ações (Sempre visível na aba de Dados Cadastrais) */}
        {!loading && activeTab === "details" && (
          <div className="flex items-center justify-between gap-3 px-6 py-3.5 border-t border-border bg-card shrink-0">
            <button
              type="button"
              onClick={handleArchive}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/25 bg-rose-500/5 hover:bg-rose-500/15 rounded-[8px] transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Arquivar Cliente</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground border border-border bg-card hover:bg-muted rounded-[8px] transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="account-detail-form"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-primary-foreground bg-primary hover:opacity-90 rounded-[8px] shadow-xs transition-opacity cursor-pointer disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Salvar Alterações</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

