import React, { useEffect, useState } from "react";
import { AlertTriangle, EyeOff, UserCheck, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface HiddenTransferOperatorOption {
  id: string;
  name: string;
  role?: string;
}

interface HiddenStageTransferDialogProps {
  open?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCancel?: () => void;
  dealTitle: string;
  targetPipelineName?: string;
  targetStageName: string;
  /** Se true, o operador atual é o responsável pelo card e é obrigado a escolher outro responsável */
  requiresReassignment: boolean;
  currentOperatorId?: string | null;
  operators: HiddenTransferOperatorOption[];
  isSubmitting?: boolean;
  loading?: boolean;
  onConfirm: (payload: { newOperatorId?: string }) => void;
}

export const HiddenStageTransferDialog: React.FC<HiddenStageTransferDialogProps> = ({
  open,
  isOpen,
  onOpenChange,
  onCancel,
  dealTitle,
  targetPipelineName,
  targetStageName,
  requiresReassignment,
  currentOperatorId,
  operators,
  isSubmitting = false,
  loading = false,
  onConfirm,
}) => {
  const resolvedOpen = open ?? isOpen ?? false;
  const resolvedLoading = isSubmitting || loading;
  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(next);
    if (!next) onCancel?.();
  };
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>("");

  const eligibleOperators = operators.filter(
    (op) => !currentOperatorId || op.id !== currentOperatorId,
  );

  useEffect(() => {
    if (resolvedOpen) {
      setSelectedOperatorId("");
    }
  }, [resolvedOpen]);

  const canConfirm = !requiresReassignment || Boolean(selectedOperatorId.trim());

  const handleConfirm = () => {
    if (!canConfirm || resolvedLoading) return;
    onConfirm({
      newOperatorId: requiresReassignment
        ? selectedOperatorId
        : selectedOperatorId || undefined,
    });
  };

  return (
    <Dialog open={resolvedOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[460px] border-border bg-card">
        <DialogHeader>
          <div className="flex items-center gap-2.5 text-amber-500 mb-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/30">
              <EyeOff className="h-4.5 w-4.5" />
            </div>
            <DialogTitle className="text-base font-semibold text-foreground">
              Transferência para Etapa sem Visibilidade
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
            Tem certeza que deseja fazer isso?{" "}
            <strong className="text-foreground">
              Você não poderá mais visualizar ou atualizar essa negociação
            </strong>{" "}
            após movê-la para{" "}
            {targetPipelineName ? (
              <span className="font-semibold text-foreground">
                {targetPipelineName} <ArrowRight className="inline h-3 w-3 mx-0.5" />{" "}
                {targetStageName}
              </span>
            ) : (
              <span className="font-semibold text-foreground">{targetStageName}</span>
            )}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Negociação: </span>
            <span className="font-semibold text-foreground">{dealTitle}</span>
          </div>

          {requiresReassignment && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-2.5">
              <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Antes de prosseguir, escolha outro responsável para a negociação:
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                  <UserCheck className="h-3.5 w-3.5 text-primary" />
                  Novo responsável pela negociação
                </label>
                <Select
                  value={selectedOperatorId}
                  onValueChange={(val) => setSelectedOperatorId(val)}
                >
                  <SelectTrigger className="h-9 text-xs bg-background border-border">
                    <SelectValue placeholder="Selecione o novo responsável..." />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleOperators.map((op) => (
                      <SelectItem key={op.id} value={op.id} className="text-xs">
                        {op.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canConfirm || isSubmitting}
            onClick={handleConfirm}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isSubmitting ? "Transferindo..." : "Confirmar e Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
