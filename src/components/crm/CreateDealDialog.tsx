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
} from "lucide-react";
import { toast } from "sonner";

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
  const [ownerId, setOwnerId] = useState(currentOperatorId || "");
  const [accountName, setAccountName] = useState(defaultAccountName || "");
  const [accountCnpj, setAccountCnpj] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    }
  }, [defaultAccountName]);

  if (!isOpen) return null;

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

    setIsSubmitting(true);
    try {
      // 1. Se informou nome de conta, podemos criar ou associar conta se necessário
      let accountId: string | undefined = undefined;
      if (accountName.trim()) {
        try {
          const accRes = await fetch("/api/crm/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: accountName.trim(),
              cnpj: accountCnpj.trim() || undefined,
              isCompany: !!accountCnpj.trim(),
            }),
          });
          if (accRes.ok) {
            const accData = await accRes.json();
            accountId = accData.account?.id;
          }
        } catch (accErr) {
          console.warn("[CreateDealDialog] Falha ao criar conta, prosseguindo com deal:", accErr);
        }
      }

      // 2. Criação do Deal
      const numValue = value ? parseFloat(value.replace(/\./g, "").replace(",", ".")) : undefined;

      const res = await fetch("/api/crm/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          pipelineId,
          stageId,
          ownerId: ownerId || null,
          accountId: accountId || null,
          contactId: defaultContactId || undefined,
          conversationId: defaultConversationId || undefined,
          value: numValue && !isNaN(numValue) ? numValue : undefined,
          rating,
          initialNote: note.trim() || undefined,
        }),
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
              <p className="text-[11px] text-muted-foreground">Cadastre um novo negócio no funil de vendas</p>
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
              <select
                value={pipelineId}
                onChange={(e) => setPipelineId(e.target.value)}
                className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground font-semibold outline-none cursor-pointer"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-foreground mb-1">Etapa Inicial</label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground font-semibold outline-none cursor-pointer"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Valor Comercial e Qualificação */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-foreground mb-1">Valor Estimado (R$)</label>
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

          {/* Responsável */}
          <div>
            <label className="block text-xs font-bold text-foreground mb-1">Vendedor / Responsável</label>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground font-semibold outline-none cursor-pointer"
            >
              <option value="">Sem responsável atribuído</option>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.name}
                </option>
              ))}
            </select>
          </div>

          {/* Empresa / Cliente */}
          <div className="border-t border-border/60 pt-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">
              Comprador / Empresa (Opcional)
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <input
                  type="text"
                  placeholder="Nome do cliente ou Razão Social"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <input
                  type="text"
                  placeholder="CNPJ ou CPF (opcional)"
                  value={accountCnpj}
                  onChange={(e) => setAccountCnpj(e.target.value)}
                  className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Anotação Inicial */}
          <div>
            <label className="block text-xs font-bold text-foreground mb-1">Nota Inicial (Opcional)</label>
            <textarea
              rows={2}
              placeholder="Descreva detalhes preliminares da negociação..."
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
