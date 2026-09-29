import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, ArrowRightLeft, UserCheck, CheckCircle2, AlertTriangle } from "lucide-react";

export type BulkActionType = "stage" | "operator" | "status";

interface BulkActionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  actionType: BulkActionType;
  selectedDealIds: string[];
  stages: Array<{ id: string; name: string; isWinStage?: boolean; isLossStage?: boolean }>;
  operators: Array<{ id: string; name: string }>;
  onSuccess: () => void;
}

export function BulkActionsDialog({
  isOpen,
  onClose,
  actionType,
  selectedDealIds,
  stages,
  operators,
  onSuccess,
}: BulkActionsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [targetStageId, setTargetStageId] = useState<string>("");
  const [targetOperatorId, setTargetOperatorId] = useState<string>("");
  const [targetStatus, setTargetStatus] = useState<"open" | "won" | "lost" | "paused">("open");
  const [lossReason, setLossReason] = useState("");

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const payload: Record<string, any> = {
        dealIds: selectedDealIds,
      };

      if (actionType === "stage") {
        if (!targetStageId) {
          toast.error("Selecione a etapa de destino.");
          setLoading(false);
          return;
        }
        payload.stageId = targetStageId;
        const selectedStage = stages.find((s) => s.id === targetStageId);
        if (selectedStage?.isLossStage && lossReason.trim()) {
          payload.lossReason = lossReason.trim();
        }
      } else if (actionType === "operator") {
        if (!targetOperatorId) {
          toast.error("Selecione o vendedor responsável.");
          setLoading(false);
          return;
        }
        payload.operatorId = targetOperatorId;
      } else if (actionType === "status") {
        payload.status = targetStatus;
        if (targetStatus === "lost" && lossReason.trim()) {
          payload.lossReason = lossReason.trim();
        }
      }

      const res = await fetch("/api/crm/deals/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha na ação em massa.");
      }

      toast.success(`${selectedDealIds.length} negociações atualizadas com sucesso!`);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error("[BulkActionsDialog] Erro:", err);
      toast.error(err.message || "Erro ao processar ação em massa.");
    } finally {
      setLoading(false);
    }
  };

  const selectedStage = stages.find((s) => s.id === targetStageId);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            {actionType === "stage" && <ArrowRightLeft className="h-4 w-4 text-primary" />}
            {actionType === "operator" && <UserCheck className="h-4 w-4 text-primary" />}
            {actionType === "status" && <CheckCircle2 className="h-4 w-4 text-primary" />}
            <span>
              {actionType === "stage" && "Mover Negociações em Massa"}
              {actionType === "operator" && "Alterar Vendedor Responsável em Massa"}
              {actionType === "status" && "Alterar Status Comercial em Massa"}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          <p className="text-muted-foreground">
            Você está prestes a atualizar{" "}
            <span className="font-bold text-foreground">{selectedDealIds.length}</span>{" "}
            negociação(ões) selecionada(s).
          </p>

          {/* Ação 1: Mover de Etapa */}
          {actionType === "stage" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Etapa de Destino</Label>
                <Select value={targetStageId} onValueChange={setTargetStageId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Selecione a nova etapa..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((stg) => (
                      <SelectItem key={stg.id} value={stg.id} className="text-xs">
                        {stg.name} {stg.isWinStage ? "(Ganho)" : ""} {stg.isLossStage ? "(Perda)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedStage?.isLossStage && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Motivo da Perda
                  </Label>
                  <Input
                    placeholder="Ex: Preço acima do orçamento..."
                    value={lossReason}
                    onChange={(e) => setLossReason(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              )}
            </div>
          )}

          {/* Ação 2: Alterar Vendedor */}
          {actionType === "operator" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Novo Vendedor Responsável</Label>
              <Select value={targetOperatorId} onValueChange={setTargetOperatorId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione o vendedor..." />
                </SelectTrigger>
                <SelectContent>
                  {operators.map((op) => (
                    <SelectItem key={op.id} value={op.id} className="text-xs">
                      {op.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Ação 3: Alterar Status */}
          {actionType === "status" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Novo Status Comercial</Label>
                <Select
                  value={targetStatus}
                  onValueChange={(val: any) => setTargetStatus(val)}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open" className="text-xs">Em andamento</SelectItem>
                    <SelectItem value="won" className="text-xs">Vendido (Ganho)</SelectItem>
                    <SelectItem value="lost" className="text-xs">Perdido</SelectItem>
                    <SelectItem value="paused" className="text-xs">Pausado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {targetStatus === "lost" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-red-600 dark:text-red-400">
                    Motivo da Perda
                  </Label>
                  <Input
                    placeholder="Ex: Cliente desistiu da compra..."
                    value={lossReason}
                    onChange={(e) => setLossReason(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={loading}
            className="text-xs"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={loading}
            className="text-xs font-bold"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                Atualizando...
              </>
            ) : (
              "Confirmar Ação em Massa"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
