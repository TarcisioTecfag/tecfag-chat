import React, { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Loader2, Package, ExternalLink, Layers } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";
import { fetchPipelinesCached, getCachedPipelinesSync } from "@/lib/crm/deal-prefetch";

export interface DuplicateDealTarget {
  id: string;
  title: string;
  pipelineId?: string | null;
  stageId?: string | null;
  operatorId?: string | null;
  account?: {
    name?: string | null;
  } | null;
}

export interface DuplicateDealPipelineOption {
  id: string;
  name: string;
  stages: Array<{
    id: string;
    name: string;
    orderIndex?: number;
    isWinStage?: boolean;
    isLossStage?: boolean;
  }>;
}

interface DuplicateDealDialogProps {
  isOpen: boolean;
  deal: DuplicateDealTarget | null;
  pipelines?: DuplicateDealPipelineOption[];
  defaultOpenAfter?: boolean;
  onClose: () => void;
  onDuplicated: (newDeal: any, options: { openAfter: boolean }) => void;
}

function resolveDefaultStageId(
  pipeline: DuplicateDealPipelineOption | undefined,
  preferredStageId?: string | null,
): string {
  if (!pipeline || !Array.isArray(pipeline.stages) || pipeline.stages.length === 0) return "";
  const sorted = [...pipeline.stages].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  if (preferredStageId) {
    const matched = sorted.find((s) => s.id === preferredStageId);
    if (matched && !matched.isWinStage && !matched.isLossStage) {
      return matched.id;
    }
  }
  const firstOpen = sorted.find((s) => !s.isWinStage && !s.isLossStage);
  return (firstOpen || sorted[0]).id;
}

export function DuplicateDealDialog({
  isOpen,
  deal,
  pipelines: propPipelines,
  defaultOpenAfter = false,
  onClose,
  onDuplicated,
}: DuplicateDealDialogProps) {
  const [loadedPipelines, setLoadedPipelines] = useState<DuplicateDealPipelineOption[]>(
    () => (propPipelines && propPipelines.length > 0 ? propPipelines : getCachedPipelinesSync() || []),
  );
  const [title, setTitle] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [copyProducts, setCopyProducts] = useState(true);
  const [openAfter, setOpenAfter] = useState(defaultOpenAfter);
  const [submitting, setSubmitting] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const effectivePipelines = useMemo(
    () => (propPipelines && propPipelines.length > 0 ? propPipelines : loadedPipelines),
    [propPipelines, loadedPipelines],
  );

  useEffect(() => {
    if (!isOpen) return;
    if (propPipelines && propPipelines.length > 0) return;
    let active = true;
    fetchPipelinesCached()
      .then((list) => {
        if (active && Array.isArray(list)) {
          setLoadedPipelines(list);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen, propPipelines]);

  useEffect(() => {
    if (!isOpen || !deal) return;
    setTitle(`${deal.title} (Cópia)`);
    setCopyProducts(true);
    setOpenAfter(defaultOpenAfter);
    setSubmitting(false);

    const matchedPipe =
      effectivePipelines.find((p) => p.id === deal.pipelineId) || effectivePipelines[0];
    const nextPipeId = matchedPipe?.id || deal.pipelineId || "";
    setPipelineId(nextPipeId);
    setStageId(
      matchedPipe
        ? resolveDefaultStageId(matchedPipe, matchedPipe.id === deal.pipelineId ? deal.stageId : null)
        : deal.stageId || "",
    );

    const timer = window.setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [isOpen, deal?.id, defaultOpenAfter]);

  useEffect(() => {
    if (!isOpen || !deal || effectivePipelines.length === 0) return;
    if (!pipelineId) {
      const matchedPipe =
        effectivePipelines.find((p) => p.id === deal.pipelineId) || effectivePipelines[0];
      if (matchedPipe) {
        setPipelineId(matchedPipe.id);
        setStageId(
          resolveDefaultStageId(matchedPipe, matchedPipe.id === deal.pipelineId ? deal.stageId : null),
        );
      }
    }
  }, [isOpen, deal, effectivePipelines, pipelineId]);

  const activePipeline = useMemo(
    () => effectivePipelines.find((p) => p.id === pipelineId),
    [effectivePipelines, pipelineId],
  );

  const sortedStages = useMemo(() => {
    if (!activePipeline?.stages) return [];
    return [...activePipeline.stages].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  }, [activePipeline]);

  const handlePipelineChange = (nextPipeId: string) => {
    setPipelineId(nextPipeId);
    const nextPipe = effectivePipelines.find((p) => p.id === nextPipeId);
    setStageId(
      resolveDefaultStageId(
        nextPipe,
        deal && nextPipeId === deal.pipelineId ? deal.stageId : null,
      ),
    );
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!deal || submitting) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      toast.error("Informe o título da nova negociação.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/crm/deals/${encodeURIComponent(deal.id)}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: cleanTitle,
          pipelineId: pipelineId || undefined,
          stageId: stageId || undefined,
          copyProducts,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Não foi possível duplicar a negociação.");
      }

      const omittedCount = Array.isArray(data?.omittedUniqueFields)
        ? data.omittedUniqueFields.length
        : 0;
      if (omittedCount > 0) {
        toast.success(
          `Negociação duplicada! (${omittedCount} campo(s) único(s) foram mantidos em branco para evitar duplicidade.)`,
        );
      } else {
        toast.success("Negociação duplicada com sucesso!");
      }

      onClose();
      onDuplicated(data.deal, { openAfter });
    } catch (err: any) {
      console.error("[DuplicateDealDialog] Erro:", err);
      toast.error(err?.message || "Erro ao duplicar negociação.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen && Boolean(deal)}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <Copy className="h-4 w-4" />
            </span>
            <span className="truncate">Duplicar negociação</span>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {deal && (
            <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Negociação de origem
              </p>
              <p className="font-bold text-foreground truncate mt-0.5">{deal.title}</p>
              {deal.account?.name && (
                <p className="text-[11px] text-muted-foreground truncate">{deal.account.name}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="duplicate-deal-title" className="text-xs font-bold text-foreground">
              Título da nova negociação
            </Label>
            <Input
              id="duplicate-deal-title"
              ref={titleInputRef}
              value={title}
              disabled={submitting}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Cliente X - Novo pedido"
              maxLength={250}
              className="h-9 text-xs bg-card"
            />
          </div>

          {effectivePipelines.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-foreground flex items-center gap-1">
                  <Layers className="h-3 w-3 text-muted-foreground" />
                  <span>Funil de destino</span>
                </Label>
                <Select
                  value={pipelineId}
                  onValueChange={handlePipelineChange}
                  disabled={submitting}
                >
                  <SelectTrigger className="h-9 text-xs bg-card">
                    <SelectValue placeholder="Selecione o funil" />
                  </SelectTrigger>
                  <SelectContent>
                    {effectivePipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-foreground">Etapa de destino</Label>
                <Select
                  value={stageId}
                  onValueChange={setStageId}
                  disabled={submitting || sortedStages.length === 0}
                >
                  <SelectTrigger className="h-9 text-xs bg-card">
                    <SelectValue placeholder="Selecione a etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedStages.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-border/80 bg-card p-3">
            <div className="flex items-center gap-2.5">
              <SystemTooltip content="Duplica os itens e produtos cadastrados na negociação original">
                <span className="inline-flex items-center">
                  <Checkbox
                    id="duplicate-deal-copy-products"
                    checked={copyProducts}
                    disabled={submitting}
                    onCheckedChange={(v) => setCopyProducts(Boolean(v))}
                    className="data-[state=checked]:bg-primary data-[state=checked]:border-primary rounded-sm"
                  />
                </span>
              </SystemTooltip>
              <label
                htmlFor="duplicate-deal-copy-products"
                className="flex items-center gap-1.5 text-xs font-medium text-foreground cursor-pointer select-none"
              >
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Copiar produtos / itens vinculados</span>
              </label>
            </div>

            <div className="flex items-center gap-2.5">
              <SystemTooltip content="Abre automaticamente o card recém-criado ao concluir">
                <span className="inline-flex items-center">
                  <Checkbox
                    id="duplicate-deal-open-after"
                    checked={openAfter}
                    disabled={submitting}
                    onCheckedChange={(v) => setOpenAfter(Boolean(v))}
                    className="data-[state=checked]:bg-primary data-[state=checked]:border-primary rounded-sm"
                  />
                </span>
              </SystemTooltip>
              <label
                htmlFor="duplicate-deal-open-after"
                className="flex items-center gap-1.5 text-xs font-medium text-foreground cursor-pointer select-none"
              >
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Abrir nova negociação após duplicar</span>
              </label>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Empresa, contatos, valor, responsável, origem e campos personalizados serão copiados.
            A nova negociação inicia com status <strong>Em andamento</strong> e histórico limpo.
          </p>

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-90 transition cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{submitting ? "Duplicando..." : "Duplicar negociação"}</span>
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
