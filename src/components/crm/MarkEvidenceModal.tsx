import React, { useState, useEffect } from "react";
import { X, Bookmark, CheckCircle2, Loader2, Columns3 } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MarkEvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: { id: string; text: string; author?: string; time?: string } | null;
  conversationId: string;
}

export function MarkEvidenceModal({
  isOpen,
  onClose,
  message,
  conversationId,
}: MarkEvidenceModalProps) {
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<any[]>([]);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && conversationId) {
      setLoading(true);
      fetch(`/api/chats/${conversationId}/deals`)
        .then((res) => (res.ok ? res.json() : { deals: [] }))
        .then((data) => {
          const list = data.deals || [];
          setDeals(list);
          if (list.length > 0) {
            setSelectedDealId(list[0].id);
          }
        })
        .catch((e) => console.error("Erro ao carregar deals da conversa:", e))
        .finally(() => setLoading(false));
    } else {
      setNote("");
      setSelectedDealId("");
    }
  }, [isOpen, conversationId]);

  if (!isOpen || !message) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDealId) {
      toast.error("Selecione uma negociação para anexar a evidência.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/crm/deals/${selectedDealId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: message.id,
          note: note.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao registrar evidência.");
      }

      toast.success("Mensagem vinculada como evidência da negociação!");
      onClose();
    } catch (err: any) {
      console.error("[MarkEvidenceModal] Erro:", err);
      toast.error(err.message || "Erro ao salvar evidência.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl p-5 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bookmark className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Marcar como Evidência</h3>
              <p className="text-[11px] text-muted-foreground">Vincule esta mensagem a uma negociação comercial</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Pré-visualização da Mensagem */}
        <div className="my-4 rounded-xl border border-border/80 bg-muted/30 p-3 text-xs">
          <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">
            {message.author || "Mensagem"} {message.time ? `às ${message.time}` : ""}
          </div>
          <p className="text-xs text-foreground italic line-clamp-3">
            "{message.text}"
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Seletor do Deal */}
          <div>
            <label className="block text-xs font-bold text-foreground mb-1">
              Negociação de Destino <span className="text-red-500">*</span>
            </label>
            {loading ? (
              <div className="flex items-center gap-2 h-9 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>Carregando negociações da conversa...</span>
              </div>
            ) : deals.length === 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                Esta conversa não possui nenhuma negociação vinculada ainda. Crie ou vincule uma negociação no painel lateral antes de marcar evidências.
              </div>
            ) : (
              <Select value={selectedDealId} onValueChange={setSelectedDealId}>
                <SelectTrigger className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground font-semibold">
                  <SelectValue placeholder="Selecione uma negociação..." />
                </SelectTrigger>
                <SelectContent>
                  {deals.map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-xs font-medium">
                      {d.title} {d.value ? `(R$ ${Number(d.value).toLocaleString("pt-BR")})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Nota Explicativa */}
          <div>
            <label className="block text-xs font-bold text-foreground mb-1">
              Nota Comercial (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: Aceite formal do orçamento / Comprovante de sinal"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Ações */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || deals.length === 0 || !selectedDealId}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer shadow-xs"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              <span>Salvar Evidência</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
