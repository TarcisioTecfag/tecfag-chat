import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, MessageSquare, Phone, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { SystemTooltip } from "@/components/ui/tooltip";
import type { BlockingDealItem } from "@/lib/crm/deal-associations";

export interface DeleteDealTarget {
  id: string;
  title: string;
  status?: string;
  account?: {
    name?: string | null;
  } | null;
}

interface DeleteDealDialogProps {
  isOpen: boolean;
  deal: DeleteDealTarget | null;
  onClose: () => void;
  onDeleted: (dealId: string, mode: "trash" | "permanent") => void;
}

export function DeleteDealDialog({
  isOpen,
  deal,
  onClose,
  onDeleted,
}: DeleteDealDialogProps) {
  const [loadingMode, setLoadingMode] = useState<"trash" | "permanent" | null>(null);
  const [confirmPermanent, setConfirmPermanent] = useState(false);
  const [blockingDeals, setBlockingDeals] = useState<BlockingDealItem[]>([]);
  const [flaggedConversationIds, setFlaggedConversationIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    setLoadingMode(null);
    setConfirmPermanent(false);
    setBlockingDeals([]);
    setFlaggedConversationIds(new Set());
  }, [isOpen, deal?.id]);

  const isExpanded = blockingDeals.length > 0;
  const allBlockingConversations = useMemo(
    () => blockingDeals.flatMap((d) => d.conversations),
    [blockingDeals],
  );
  const allConversationsFlagged =
    allBlockingConversations.length > 0 &&
    allBlockingConversations.every((c) => flaggedConversationIds.has(c.id));

  const toggleConversation = (convId: string, checked: boolean) => {
    setFlaggedConversationIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(convId);
      else next.delete(convId);
      return next;
    });
  };

  const toggleAllConversations = (checked: boolean) => {
    if (checked) {
      setFlaggedConversationIds(new Set(allBlockingConversations.map((c) => c.id)));
    } else {
      setFlaggedConversationIds(new Set());
    }
  };

  const handleTrash = async () => {
    if (!deal || loadingMode) return;
    setLoadingMode("trash");
    try {
      const res = await fetch(`/api/crm/deals/${encodeURIComponent(deal.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: "delete_trash" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Não foi possível enviar a negociação para a lixeira.");
      }
      toast.success("Negociação enviada para a lixeira.");
      onClose();
      onDeleted(deal.id, "trash");
    } catch (err: any) {
      console.error("[DeleteDealDialog] Erro ao enviar para lixeira:", err);
      toast.error(err?.message || "Erro ao enviar para a lixeira.");
    } finally {
      setLoadingMode(null);
    }
  };

  const handlePermanentDelete = async () => {
    if (!deal || loadingMode) return;
    if (!confirmPermanent) {
      toast.error("Marque a caixa de confirmação para excluir permanentemente.");
      return;
    }
    if (isExpanded && !allConversationsFlagged) {
      toast.error(
        "Marque as conversas/chats vinculados abaixo para confirmar a exclusão conjunta, ou envie a negociação para a lixeira.",
      );
      return;
    }

    setLoadingMode("permanent");
    try {
      const selectedContactIds = new Set<string>();
      if (isExpanded) {
        for (const bd of blockingDeals) {
          for (const conv of bd.conversations) {
            if (flaggedConversationIds.has(conv.id)) {
              selectedContactIds.add(conv.contactId);
            }
          }
        }
      }

      const res = await fetch(`/api/crm/deals/${encodeURIComponent(deal.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "delete_permanent",
          deleteConversationIds:
            isExpanded && flaggedConversationIds.size > 0
              ? Array.from(flaggedConversationIds)
              : undefined,
          deleteContactIds:
            isExpanded && selectedContactIds.size > 0
              ? Array.from(selectedContactIds)
              : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (
          data?.code === "DEAL_REQUIRED" &&
          Array.isArray(data?.blockingDeals) &&
          data.blockingDeals.length > 0
        ) {
          setBlockingDeals(data.blockingDeals);
          setFlaggedConversationIds(new Set());
          toast.warning(
            "Esta negociação é o único vínculo ativo do contato/chat. Selecione abaixo as conversas/contatos para excluir junto ou envie para a lixeira.",
          );
          return;
        }
        throw new Error(data?.error || "Não foi possível excluir permanentemente a negociação.");
      }

      toast.success(data?.message || "Negociação excluída permanentemente.");
      onClose();
      onDeleted(deal.id, "permanent");
    } catch (err: any) {
      console.error("[DeleteDealDialog] Erro na exclusão permanente:", err);
      toast.error(err?.message || "Erro ao excluir negociação.");
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <Dialog
      open={isOpen && Boolean(deal)}
      onOpenChange={(open) => {
        if (!open && !loadingMode) onClose();
      }}
    >
      <DialogContent
        className={
          isExpanded
            ? "max-w-xl transition-all duration-200"
            : "max-w-md transition-all duration-200"
        }
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-destructive/10 text-destructive shrink-0">
              <Trash2 className="h-4 w-4" />
            </span>
            <span className="truncate">Excluir negociação</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5 py-1 text-xs">
          {deal && (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-destructive">
                Negociação selecionada
              </p>
              <p className="font-bold text-foreground truncate mt-0.5">{deal.title}</p>
              {deal.account?.name && (
                <p className="text-[11px] text-muted-foreground truncate">{deal.account.name}</p>
              )}
            </div>
          )}

          <p className="text-muted-foreground leading-relaxed">
            Escolha entre <strong>enviar para a lixeira</strong> (pausa o card e mantém o histórico)
            ou <strong>excluir permanentemente</strong>. A exclusão permanente não pode ser desfeita.
          </p>

          {isExpanded && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-foreground">
                    Contato/chat vinculado exclusivamente a esta negociação
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Todo contato e atendimento precisa de uma negociação ativa. Para excluir
                    permanentemente, confirme abaixo os chats/contatos que também serão excluídos —
                    ou clique em <strong>Enviar para a lixeira</strong> para preservar o chat.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <SystemTooltip
                    content={
                      allConversationsFlagged
                        ? "Desmarcar todos os vínculos"
                        : "Marcar todos os chats/contatos vinculados para excluir junto"
                    }
                  >
                    <span className="inline-flex items-center">
                      <Checkbox
                        id="delete-single-deal-flag-all"
                        checked={allConversationsFlagged}
                        disabled={Boolean(loadingMode)}
                        onCheckedChange={(val) => toggleAllConversations(Boolean(val))}
                        className="data-[state=checked]:bg-primary data-[state=checked]:border-primary rounded-sm"
                      />
                    </span>
                  </SystemTooltip>
                  <label
                    htmlFor="delete-single-deal-flag-all"
                    className="text-[11px] font-bold text-foreground cursor-pointer select-none"
                  >
                    Marcar todos ({flaggedConversationIds.size}/{allBlockingConversations.length})
                  </label>
                </div>
              </div>

              <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                {blockingDeals.map((bd) =>
                  bd.conversations.map((conv) => {
                    const checked = flaggedConversationIds.has(conv.id);
                    const queueLabel =
                      conv.queueState === "meus"
                        ? "Em atendimento"
                        : conv.queueState === "fila"
                          ? "Na fila"
                          : conv.queueState === "automacao"
                            ? "Triagem IA"
                            : conv.queueState === "finalizados"
                              ? "Finalizado"
                              : "Contato";

                    return (
                      <div
                        key={conv.id}
                        onClick={() => !loadingMode && toggleConversation(conv.id, !checked)}
                        className={`flex items-start justify-between gap-2 rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
                          checked
                            ? "border-primary/40 bg-primary/5"
                            : "border-border bg-card hover:bg-muted/40"
                        }`}
                      >
                        <div
                          className="flex items-start gap-2 min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <SystemTooltip
                            content={
                              checked
                                ? "Desmarcar exclusão deste chat/contato"
                                : "Marcar para excluir junto com a negociação"
                            }
                          >
                            <span className="inline-flex items-center mt-0.5">
                              <Checkbox
                                checked={checked}
                                disabled={Boolean(loadingMode)}
                                onCheckedChange={(val) => toggleConversation(conv.id, Boolean(val))}
                                className="data-[state=checked]:bg-primary data-[state=checked]:border-primary rounded-sm"
                              />
                            </span>
                          </SystemTooltip>
                          <div
                            className="min-w-0"
                            onClick={() => !loadingMode && toggleConversation(conv.id, !checked)}
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <MessageSquare className="h-3 w-3 text-primary shrink-0" />
                              <span className="text-[11px] font-bold text-foreground">
                                {conv.contactName}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border">
                                {queueLabel}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                              {conv.contactPhone && (
                                <span className="inline-flex items-center gap-1">
                                  <Phone className="h-2.5 w-2.5" />
                                  {conv.contactPhone}
                                </span>
                              )}
                              {!conv.contactPhone && (
                                <span className="inline-flex items-center gap-1">
                                  <User className="h-2.5 w-2.5" />
                                  Sem telefone
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5 max-w-sm">
                              {conv.lastMessageText || "Sem mensagens recentes"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }),
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2.5 rounded-xl border border-border/80 bg-card px-3 py-2.5">
            <SystemTooltip
              content={
                confirmPermanent
                  ? "Desmarcar confirmação"
                  : "Confirmar que a exclusão permanente é irreversível"
              }
            >
              <span className="inline-flex items-center">
                <Checkbox
                  id="delete-single-deal-confirm"
                  checked={confirmPermanent}
                  disabled={Boolean(loadingMode)}
                  onCheckedChange={(val) => setConfirmPermanent(Boolean(val))}
                  className="data-[state=checked]:bg-destructive data-[state=checked]:border-destructive rounded-sm"
                />
              </span>
            </SystemTooltip>
            <label
              htmlFor="delete-single-deal-confirm"
              className="text-xs font-medium text-foreground cursor-pointer select-none leading-snug"
            >
              Entendo que a exclusão permanente não poderá ser desfeita.
            </label>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-2">
          <button
            type="button"
            disabled={Boolean(loadingMode)}
            onClick={onClose}
            className="rounded-xl border border-border px-3.5 py-2 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>

          <div className="flex items-center justify-end gap-2 flex-wrap">
            <SystemTooltip content="Pausa a negociação e move para a Lixeira sem apagar histórico">
              <button
                type="button"
                disabled={Boolean(loadingMode)}
                onClick={handleTrash}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
              >
                {loadingMode === "trash" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Enviar para a lixeira</span>
              </button>
            </SystemTooltip>

            <SystemTooltip content="Remove permanentemente esta negociação da conta">
              <button
                type="button"
                disabled={
                  Boolean(loadingMode) ||
                  !confirmPermanent ||
                  (isExpanded && !allConversationsFlagged)
                }
                onClick={handlePermanentDelete}
                className="inline-flex items-center gap-1.5 rounded-xl bg-destructive px-3.5 py-2 text-xs font-bold text-destructive-foreground shadow-sm hover:opacity-90 transition cursor-pointer disabled:opacity-50"
              >
                {loadingMode === "permanent" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                <span>Excluir permanentemente</span>
              </button>
            </SystemTooltip>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
