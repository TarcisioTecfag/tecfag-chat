import React, { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";

interface StageTerminalConfirmDialogProps {
  isOpen: boolean;
  type: "win" | "loss";
  stageName: string;
  dealTitle: string;
  currentValue?: string | number | null;
  onConfirm: (data: { status: "won" | "lost"; lossReason?: string; value?: string | number | null }) => void;
  onCancel: () => void;
}

export function StageTerminalConfirmDialog({
  isOpen,
  type,
  stageName,
  dealTitle,
  currentValue,
  onConfirm,
  onCancel,
}: StageTerminalConfirmDialogProps) {
  const [lossReason, setLossReason] = useState("");
  const [finalValue, setFinalValue] = useState(currentValue ? String(currentValue) : "");

  if (!isOpen) return null;

  const isWin = type === "win";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isWin) {
      onConfirm({
        status: "won",
        value: finalValue ? finalValue : currentValue,
      });
    } else {
      onConfirm({
        status: "lost",
        lossReason: lossReason.trim() || "Perdido sem motivo informado",
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in">
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4"
      >
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isWin ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-red-500/15 text-red-600 dark:text-red-400"
            }`}
          >
            {isWin ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">
              {isWin ? "Confirmar Ganho da Negociação" : "Confirmar Perda da Negociação"}
            </h3>
            <p className="text-xs text-muted-foreground">
              Etapa terminal: <span className="font-semibold text-foreground">{stageName}</span>
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
          <p className="font-semibold text-foreground line-clamp-1">{dealTitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isWin ? (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground">
                Valor Final Fechado (R$)
              </label>
              <input
                type="text"
                value={finalValue}
                onChange={(e) => setFinalValue(e.target.value)}
                placeholder="Ex: 5000.00"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground">
                Ao confirmar, o status da negociação será alterado para <strong>Vendido (Won)</strong> com data de fechamento registrada.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground">
                Motivo da Perda (obrigatório para análise comercial)
              </label>
              <textarea
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                placeholder="Ex: Preço acima do orçamento, optou por concorrente, sem retorno..."
                rows={3}
                required
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground">
                Ao confirmar, o status será alterado para <strong>Perdido (Lost)</strong> e auditado no histórico da negociação.
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`rounded-xl px-4 py-2 text-xs font-bold text-white shadow-sm transition-opacity cursor-pointer hover:opacity-90 ${
                isWin ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {isWin ? "Confirmar Ganho" : "Confirmar Perda"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
