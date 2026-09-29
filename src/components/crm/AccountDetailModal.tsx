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
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Phone,
  Mail,
  Globe,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
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
  const [type, setType] = useState<"person" | "company">("company");
  const [document, setDocument] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");

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

  if (!isOpen || !accountId) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
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
          type,
          document: document ? document.replace(/\D/g, "") : null,
          phone: phone ? phone.replace(/\D/g, "") : null,
          email: email.trim() || null,
          website: website.trim() || null,
          notes: notes.trim() || null,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-300">
              {type === "company" ? <Building2 className="w-5 h-5" /> : <User className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 truncate max-w-md">
                  {name || "Carregando..."}
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {type === "company" ? "PJ" : "PF"}
                </span>
              </div>
              {tradeName && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Nome Fantasia: {tradeName}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas */}
        <div className="flex items-center px-6 border-b border-slate-200 dark:border-slate-800 space-x-6 text-sm font-medium text-slate-500 dark:text-slate-400">
          <button
            type="button"
            onClick={() => setActiveTab("details")}
            className={`py-3 flex items-center space-x-2 border-b-2 transition-colors ${
              activeTab === "details"
                ? "border-sky-600 text-sky-600 dark:text-sky-400 font-semibold"
                : "border-transparent hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Dados Cadastrais</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("contacts")}
            className={`py-3 flex items-center space-x-2 border-b-2 transition-colors ${
              activeTab === "contacts"
                ? "border-sky-600 text-sky-600 dark:text-sky-400 font-semibold"
                : "border-transparent hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Contatos ({accountData?.contacts?.length || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("deals")}
            className={`py-3 flex items-center space-x-2 border-b-2 transition-colors ${
              activeTab === "deals"
                ? "border-sky-600 text-sky-600 dark:text-sky-400 font-semibold"
                : "border-transparent hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <Briefcase className="w-4 h-4" />
            <span>Negociações ({accountData?.deals?.length || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("conversations")}
            className={`py-3 flex items-center space-x-2 border-b-2 transition-colors ${
              activeTab === "conversations"
                ? "border-sky-600 text-sky-600 dark:text-sky-400 font-semibold"
                : "border-transparent hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Atendimentos ({accountData?.conversations?.length || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`py-3 flex items-center space-x-2 border-b-2 transition-colors ${
              activeTab === "history"
                ? "border-sky-600 text-sky-600 dark:text-sky-400 font-semibold"
                : "border-transparent hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <History className="w-4 h-4" />
            <span>Histórico ({accountData?.history?.length || 0})</span>
          </button>
        </div>

        {/* Conteúdo das Abas */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
              <p className="text-sm text-slate-500">Carregando dados do cliente...</p>
            </div>
          ) : (
            <>
              {/* ABA 1: DADOS CADASTRAIS */}
              {activeTab === "details" && (
                <form onSubmit={handleSave} className="space-y-4 max-w-2xl">
                  {/* Tipo PF/PJ */}
                  <div className="flex items-center space-x-3 pb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tipo de Cliente:</span>
                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-100 dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          setType("company");
                          if (document) setDocument(maskCnpj(document));
                        }}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                          type === "company"
                            ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Pessoa Jurídica (PJ)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setType("person");
                          if (document) setDocument(maskCpf(document));
                        }}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                          type === "person"
                            ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Pessoa Física (PF)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        {type === "company" ? "Razão Social *" : "Nome Completo *"}
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-sky-500 dark:text-slate-100"
                      />
                    </div>

                    {type === "company" && (
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Nome Fantasia
                        </label>
                        <input
                          type="text"
                          value={tradeName}
                          onChange={(e) => setTradeName(e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-sky-500 dark:text-slate-100"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        {type === "company" ? "CNPJ (14 dígitos)" : "CPF (11 dígitos)"}
                      </label>
                      <input
                        type="text"
                        value={document}
                        onChange={(e) =>
                          setDocument(type === "company" ? maskCnpj(e.target.value) : maskCpf(e.target.value))
                        }
                        placeholder={type === "company" ? "00.000.000/0000-00" : "000.000.000-00"}
                        className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-sky-500 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Telefone Principal
                      </label>
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(maskPhone(e.target.value))}
                        placeholder="(00) 00000-0000"
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-sky-500 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        E-mail de Contato
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="contato@empresa.com"
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-sky-500 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Website
                      </label>
                      <input
                        type="text"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                        placeholder="https://empresa.com.br"
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-sky-500 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Observações Internas
                    </label>
                    <textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Notas contextuais sobre este cliente, ramo de atividade, perfil de compras..."
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-sky-500 dark:text-slate-100"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={handleArchive}
                      className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Arquivar Cliente</span>
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-lg shadow-sm transition-all disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      <span>Salvar Alterações</span>
                    </button>
                  </div>
                </form>
              )}

              {/* ABA 2: CONTATOS (1:N) */}
              {activeTab === "contacts" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        Contatos vinculados a esta empresa
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Pessoas físicas cadastradas na base que representam este cliente.
                      </p>
                    </div>
                  </div>

                  {accountData?.contacts && accountData.contacts.length > 0 ? (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                      {accountData.contacts.map((c) => (
                        <div key={c.id} className="p-3.5 flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 font-semibold text-xs">
                              {c.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                {c.name}
                              </div>
                              <div className="text-xs text-slate-400 flex items-center space-x-3">
                                {c.phone && (
                                  <span className="flex items-center space-x-1">
                                    <Phone className="w-3 h-3" />
                                    <span>{c.phone}</span>
                                  </span>
                                )}
                                {c.email && (
                                  <span className="flex items-center space-x-1">
                                    <Mail className="w-3 h-3" />
                                    <span>{c.email}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => handleUnlinkContact(c.id)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-md transition-colors"
                            >
                              Desvincular
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-slate-500">
                      <Users className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                      <p className="text-sm font-medium">Nenhum contato vinculado ainda.</p>
                      <p className="text-xs text-slate-400 mt-1">
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
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Negociações deste Cliente
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Todos os cards vinculados a esta conta compradora nos funis de venda.
                    </p>
                  </div>

                  {accountData?.deals && accountData.deals.length > 0 ? (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                      {accountData.deals.map((d) => (
                        <div
                          key={d.id}
                          onClick={() => onOpenDeal?.(d.id)}
                          className="p-3.5 flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors group"
                        >
                          <div>
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-200 group-hover:text-sky-600 transition-colors">
                              {d.title}
                            </div>
                            <div className="text-xs text-slate-400 flex items-center space-x-2 mt-0.5">
                              <span className="font-semibold text-slate-600 dark:text-slate-300">
                                {d.value !== null ? `R$ ${parseFloat(d.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "A combinar"}
                              </span>
                              <span>•</span>
                              <span>Criado em {new Date(d.createdAt).toLocaleDateString("pt-BR")}</span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                                d.status === "won"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                  : d.status === "lost"
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                                  : "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                              }`}
                            >
                              {d.status === "won" ? "Ganho" : d.status === "lost" ? "Perdido" : "Aberto"}
                            </span>
                            <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-sky-500" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-slate-500">
                      <Briefcase className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                      <p className="text-sm font-medium">Nenhuma negociação encontrada para este cliente.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ABA 4: ATENDIMENTOS / CONVERSAS VINCULADAS */}
              {activeTab === "conversations" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Atendimentos Vinculados à Conta
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Conversas de WhatsApp e canais associadas formalmente a esta conta compradora.
                    </p>
                  </div>

                  {accountData?.conversations && accountData.conversations.length > 0 ? (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                      {accountData.conversations.map((cv) => (
                        <div
                          key={cv.id}
                          className="p-3.5 flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-semibold uppercase px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded">
                                {cv.conversation?.channel || "chat"}
                              </span>
                              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                {cv.conversation?.contactName || "Atendimento"}
                              </span>
                            </div>
                            {cv.contextNote && (
                              <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                                "{cv.contextNote}"
                              </p>
                            )}
                            <div className="text-[11px] text-slate-400">
                              Vinculado por {cv.operatorName || "Sistema"} em {new Date(cv.createdAt).toLocaleDateString("pt-BR")}
                            </div>
                          </div>
                          {onOpenChat && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenChat(cv.conversationId);
                                onClose();
                              }}
                              className="px-3 py-1.5 text-xs font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded-lg transition-colors flex items-center space-x-1"
                            >
                              <span>Ver no Chat</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-slate-500">
                      <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                      <p className="text-sm font-medium">Nenhum atendimento vinculado diretamente.</p>
                      <p className="text-xs text-slate-400 mt-1">
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
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Histórico de Transições de Contatos
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Registro auditável de contatos vinculados ou transferidos desta conta.
                    </p>
                  </div>

                  {accountData?.history && accountData.history.length > 0 ? (
                    <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                      {accountData.history.map((h) => (
                        <div key={h.id} className="relative group">
                          <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-sky-500 ring-4 ring-white dark:ring-slate-900" />
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                            {h.contactName || "Contato"} associado à conta
                          </div>
                          {h.reason && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              Motivo: {h.reason}
                            </p>
                          )}
                          <div className="text-[11px] text-slate-400 mt-1">
                            Alterado por {h.operatorName || "Operador"} em {new Date(h.createdAt).toLocaleString("pt-BR")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-slate-500">
                      <History className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                      <p className="text-sm font-medium">Nenhum evento histórico registrado para esta conta.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
