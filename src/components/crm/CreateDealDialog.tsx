import React, { useState, useEffect } from "react";
import {
  X,
  Plus,
  Building2,
  DollarSign,
  Star,
  User,
  FileText,
  Layers,
  CheckCircle2,
  Loader2,
  Phone,
  Mail,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { AccountPicker } from "./AccountPicker";
import type { CrmAccountDTO } from "../../lib/crm/crm-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StageOption {
  id: string;
  name: string;
}

interface PipelineOption {
  id: string;
  name: string;
  stages: StageOption[];
}

interface OperatorOption {
  id: string;
  name: string;
}

interface CreateDealDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newDeal: any) => void;
  pipelines: PipelineOption[];
  operators: OperatorOption[];
  defaultPipelineId?: string;
  defaultStageId?: string;
  defaultContactId?: string;
  defaultConversationId?: string;
  defaultAccountName?: string;
  currentOperatorId?: string;
}

// Máscaras de documento
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

export function CreateDealDialog({
  isOpen,
  onClose,
  onSuccess,
  pipelines,
  operators,
  defaultPipelineId,
  defaultStageId,
  defaultContactId,
  defaultConversationId,
  defaultAccountName,
  currentOperatorId,
}: CreateDealDialogProps) {
  const [title, setTitle] = useState("");
  const [pipelineId, setPipelineId] = useState(defaultPipelineId || pipelines[0]?.id || "");
  const [stageId, setStageId] = useState(defaultStageId || "");
  const [value, setValue] = useState("");
  const [rating, setRating] = useState<number>(3);
  const [operatorId, setOperatorId] = useState(currentOperatorId || "");

  // Cliente / Comprador
  const [selectedAccount, setSelectedAccount] = useState<CrmAccountDTO | null>(null);
  const [isCreatingNewAccount, setIsCreatingNewAccount] = useState(false);
  const [contactOriginalAccount, setContactOriginalAccount] = useState<{ id: string; name: string } | null>(null);
  const [hasAccount, setHasAccount] = useState(!!defaultAccountName);
  const [accountType, setAccountType] = useState<"person" | "company">("company");
  const [accountName, setAccountName] = useState(defaultAccountName || "");
  const [accountTradeName, setAccountTradeName] = useState("");
  const [accountDocument, setAccountDocument] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [accountEmail, setAccountEmail] = useState("");

  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Busca conta vinculada ao contato pré-selecionado (se houver)
  useEffect(() => {
    if (defaultContactId) {
      fetch(`/api/contacts/${defaultContactId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.account) {
            setContactOriginalAccount({ id: data.account.id, name: data.account.name });
            if (!selectedAccount) {
              setSelectedAccount(data.account);
              setHasAccount(true);
            }
          }
        })
        .catch((err) => console.error("Erro ao carregar contato no dialog:", err));
    }
  }, [defaultContactId]);

  // Sincroniza pipeline e estágios
  useEffect(() => {
    if (defaultPipelineId) {
      setPipelineId(defaultPipelineId);
    } else if (pipelines.length > 0 && !pipelineId) {
      setPipelineId(pipelines[0].id);
    }
  }, [defaultPipelineId, pipelines]);

  const activePipeline = pipelines.find((p) => p.id === pipelineId) || pipelines[0];
  const stages = activePipeline?.stages || [];

  useEffect(() => {
    if (defaultStageId && stages.some((s) => s.id === defaultStageId)) {
      setStageId(defaultStageId);
    } else if (stages.length > 0 && (!stageId || !stages.some((s) => s.id === stageId))) {
      setStageId(stages[0].id);
    }
  }, [pipelineId, defaultStageId, stages]);

  useEffect(() => {
    if (defaultAccountName) {
      setAccountName(defaultAccountName);
      setHasAccount(true);
    }
  }, [defaultAccountName]);

  useEffect(() => {
    if (currentOperatorId && !operatorId) {
      setOperatorId(currentOperatorId);
    }
  }, [currentOperatorId]);

  if (!isOpen) return null;

  const divergentWarning =
    contactOriginalAccount &&
    selectedAccount &&
    contactOriginalAccount.id !== selectedAccount.id
      ? `Atenção: Este contato está associado à empresa "${contactOriginalAccount.name}". A negociação será criada para "${selectedAccount.name}", preservando o histórico e os vínculos existentes sem sobrescrevê-los.`
      : null;

  const handleDocumentChange = (val: string) => {
    if (accountType === "person") {
      setAccountDocument(maskCpf(val));
    } else {
      setAccountDocument(maskCnpj(val));
    }
  };

  const handleTypeChange = (newType: "person" | "company") => {
    setAccountType(newType);
    setAccountDocument(""); // limpa documento ao alternar tipo
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Por favor, informe o título da negociação.");
      return;
    }
    if (!stageId) {
      toast.error("Selecione a etapa inicial da negociação.");
      return;
    }

    const cleanDoc = accountDocument.replace(/\D/g, "");
    if (hasAccount && cleanDoc) {
      if (accountType === "person" && cleanDoc.length !== 11) {
        toast.error("CPF deve conter exatamente 11 dígitos numéricos.");
        return;
      }
      if (accountType === "company" && cleanDoc.length !== 14) {
        toast.error("CNPJ deve conter exatamente 14 dígitos numéricos.");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      // Valor comercial: se em branco, envia null; se preenchido, converte
      let dealValue: number | null = null;
      if (value.trim()) {
        const parsed = parseFloat(value.replace(/\./g, "").replace(",", "."));
        if (!isNaN(parsed)) {
          dealValue = parsed;
        }
      }

      // Payload atômico: cria conta + negociação + nota na mesma transação
      const payload: any = {
        title: title.trim(),
        pipelineId,
        stageId,
        operatorId: operatorId || null,
        value: dealValue,
        rating,
        contactId: defaultContactId || undefined,
        conversationId: defaultConversationId || undefined,
        initialNote: note.trim() || undefined,
      };

      if (selectedAccount) {
        payload.accountId = selectedAccount.id;
      } else if (hasAccount && isCreatingNewAccount && accountName.trim()) {
        payload.account = {
          name: accountName.trim(),
          type: accountType,
          tradeName: accountTradeName.trim() || undefined,
          document: cleanDoc || undefined,
          phone: accountPhone.replace(/\D/g, "") || undefined,
          email: accountEmail.trim() || undefined,
        };
      }

      const res = await fetch("/api/crm/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Erro ao criar negociação.");
      }

      const data = await res.json();
      toast.success("Negociação criada com sucesso!");
      onSuccess(data.deal);
      onClose();
    } catch (err: any) {
      console.error("[CreateDealDialog] Erro:", err);
      toast.error(err.message || "Falha ao criar negociação.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4 bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Nova Negociação</h3>
              <p className="text-[11px] text-muted-foreground">Cadastre um novo negócio com dados do cliente e vendedor</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Título da Negociação */}
          <div>
            <label className="block text-xs font-bold text-foreground mb-1">
              Título da Negociação <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Ex: Compra de 50.000 Válvulas Spray Recrave"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Funil e Etapa */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-foreground mb-1">Funil</label>
              <Select value={pipelineId} onValueChange={setPipelineId}>
                <SelectTrigger className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground font-semibold">
                  <SelectValue placeholder="Selecione um funil..." />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs font-medium">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-bold text-foreground mb-1">Etapa Inicial</label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground font-semibold">
                  <SelectValue placeholder="Selecione a etapa inicial..." />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs font-medium">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Valor Comercial e Qualificação */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-foreground">Valor Comercial</label>
                <span className="text-[10px] text-muted-foreground italic">Vazio = A combinar</span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                  R$
                </span>
                <input
                  type="text"
                  placeholder="0,00"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="h-9 w-full rounded-xl border border-border bg-muted/20 pl-9 pr-3 text-xs text-foreground font-bold placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-foreground mb-1">Qualificação</label>
              <div className="flex h-9 items-center gap-1 px-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    type="button"
                    key={star}
                    onClick={() => setRating(star)}
                    className="p-1 hover:scale-110 transition-transform cursor-pointer"
                  >
                    <Star
                      className={`h-4 w-4 ${
                        rating >= star
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/30"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Vendedor / Responsável */}
          <div>
            <label className="block text-xs font-bold text-foreground mb-1">Vendedor Responsável</label>
            <Select value={operatorId || "__none__"} onValueChange={(val) => setOperatorId(val === "__none__" ? "" : val)}>
              <SelectTrigger className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground font-semibold">
                <SelectValue placeholder="Selecione o vendedor responsável..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs text-muted-foreground">
                  Sem vendedor atribuído
                </SelectItem>
                {operators.map((op) => (
                  <SelectItem key={op.id} value={op.id} className="text-xs font-medium">
                    {op.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Seção do Cliente / Comprador */}
          <div className="border-t border-border/60 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block">
                Cliente / Comprador
              </span>
              {!isCreatingNewAccount ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingNewAccount(true);
                    setSelectedAccount(null);
                    setHasAccount(true);
                  }}
                  className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
                >
                  + Cadastrar nova conta
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingNewAccount(false);
                    setAccountName("");
                    setAccountDocument("");
                  }}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                >
                  Voltar para busca
                </button>
              )}
            </div>

            {!isCreatingNewAccount ? (
              <div className="space-y-2">
                <AccountPicker
                  selectedAccount={selectedAccount}
                  onSelectAccount={(acc) => {
                    setSelectedAccount(acc);
                    setHasAccount(!!acc);
                  }}
                  onAddNew={() => {
                    setIsCreatingNewAccount(true);
                    setSelectedAccount(null);
                    setHasAccount(true);
                  }}
                  divergentWarning={divergentWarning}
                />
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-3 animate-in fade-in duration-150">
                {/* Seletor PF / PJ */}
                <div className="flex rounded-lg bg-muted/40 p-1 border border-border/60">
                  <button
                    type="button"
                    onClick={() => handleTypeChange("company")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1 text-xs font-bold rounded-md transition-colors ${
                      accountType === "company"
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    <span>Pessoa Jurídica (PJ)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTypeChange("person")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1 text-xs font-bold rounded-md transition-colors ${
                      accountType === "person"
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <User className="h-3.5 w-3.5" />
                    <span>Pessoa Física (PF)</span>
                  </button>
                </div>

                {/* Nome / Razão Social */}
                <div>
                  <label className="block text-[11px] font-semibold text-foreground mb-1">
                    {accountType === "company" ? "Razão Social / Nome da Empresa" : "Nome Completo do Cliente"} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={accountType === "company" ? "Ex: Valem Embalagens Ltda" : "Ex: João Carlos da Silva"}
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Nome Fantasia (apenas PJ) */}
                {accountType === "company" && (
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground mb-1">
                      Nome Fantasia (Opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Valem Válvulas"
                      value={accountTradeName}
                      onChange={(e) => setAccountTradeName(e.target.value)}
                      className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                )}

                {/* Documento (CPF / CNPJ) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-foreground">
                      {accountType === "company" ? "CNPJ (14 dígitos)" : "CPF (11 dígitos)"}
                    </label>
                    <span className="text-[10px] text-muted-foreground italic">Opcional</span>
                  </div>
                  <input
                    type="text"
                    placeholder={accountType === "company" ? "00.000.000/0000-00" : "000.000.000-00"}
                    value={accountDocument}
                    onChange={(e) => handleDocumentChange(e.target.value)}
                    className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Contato (Telefone e E-mail) */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground mb-1">Telefone / WhatsApp</label>
                    <div className="relative">
                      <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="(00) 00000-0000"
                        value={accountPhone}
                        onChange={(e) => setAccountPhone(maskPhone(e.target.value))}
                        className="h-8 w-full rounded-lg border border-border bg-card pl-7 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground mb-1">E-mail</label>
                    <div className="relative">
                      <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <input
                        type="email"
                        placeholder="contato@empresa.com"
                        value={accountEmail}
                        onChange={(e) => setAccountEmail(e.target.value)}
                        className="h-8 w-full rounded-lg border border-border bg-card pl-7 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Anotação Inicial */}
          <div>
            <label className="block text-xs font-bold text-foreground mb-1">Nota Inicial (Opcional)</label>
            <textarea
              rows={2}
              placeholder="Descreva detalhes preliminares da negociação (salva como atividade no histórico)..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-border bg-muted/20 p-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          {/* Rodapé com botões de ação */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Criando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Criar Negociação</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
