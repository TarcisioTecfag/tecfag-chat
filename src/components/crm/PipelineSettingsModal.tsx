import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  GripVertical,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCustomFields } from "./CustomFieldsEditor";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  computeEdgeAutoScrollStep,
  reorderByIndex,
  resolveDefaultStageMigrationTarget,
  resolveHorizontalDropIndex,
} from "@/lib/crm/pipeline-stage-organizer";

interface StageItem {
  id: string;
  name: string;
  orderIndex: number;
  isWinStage: boolean;
  isLossStage: boolean;
  requiredFields: string[];
  dealsCount?: number;
}

interface PipelineItem {
  id: string;
  name: string;
  orderIndex: number;
  isDefault: boolean;
  coolingDays: number;
  dealsCount?: number;
  stages: StageItem[];
}

interface StageSettings {
  stageId: string;
  abbreviation: string | null;
  objective: string | null;
  description: string | null;
  coolingEnabled: boolean;
  coolingDays: number;
}

interface StageDraft {
  id: string;
  pipelineId: string;
  name: string;
  abbreviation: string;
  objective: string;
  description: string;
  coolingEnabled: boolean;
  coolingDays: number;
  isWinStage: boolean;
  isLossStage: boolean;
  requiredFields: string[];
  lossReasonNames: string[];
}

interface CatalogLossReasonItem {
  id: string;
  name: string;
  isActive?: boolean;
  allPipelines?: boolean;
  pipelineIds?: string[];
  stageIds?: string[];
}

interface PipelineDraft {
  id: string | null;
  name: string;
  coolingDays: number;
  isDefault: boolean;
}

interface AddingStageState {
  pipelineId: string;
  insertAtIndex: number | null; // null = adicionar ao final
}

interface DeleteStagesState {
  stageIds: string[];
  preferredPipelineId: string | null;
  targetPipelineId: string;
  targetStageId: string;
}

interface DeletePipelineState {
  pipeline: PipelineItem;
  targetPipelineId: string;
  targetStageId: string;
}

interface ActiveStageDragOverlay {
  stage: StageItem;
  stageNumber: number;
  abbreviation?: string | null;
  width: number;
  x: number;
  y: number;
}

interface PipelineSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPipelinesChanged?: () => void;
  selectedPipelineId?: string;
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
  return data;
}

function jsonRequest(method: string, body: object): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function notifyCrmChanged(cb?: () => void) {
  cb?.();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("crm-deals-changed"));
  }
}

interface PipelineStagesRowProps {
  pipeline: PipelineItem;
  pipelineIndex: number;
  totalPipelines: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onMovePipeline: (direction: -1 | 1) => void;
  onEditPipeline: () => void;
  onRequestDeletePipeline: () => void;
  settingsByStage: Record<string, StageSettings>;
  selectedStages: string[];
  onToggleSelectStage: (stageId: string, checked: boolean) => void;
  onOpenStageSettings: (stage: StageItem) => void;
  onRequestDeleteStage: (stage: StageItem) => void;
  onToggleCooling: (stage: StageItem, enabled: boolean) => void;
  onUpdateCoolingDays: (stage: StageItem, days: number) => void;
  onRenameStageInline: (stage: StageItem, nextName: string) => Promise<boolean>;
  onCommitStageOrder: (orderedStages: StageItem[]) => void;
  addingStage: AddingStageState | null;
  newStageName: string;
  onNewStageNameChange: (val: string) => void;
  onStartAddStage: (insertAtIndex: number | null) => void;
  onCancelAddStage: () => void;
  onSubmitAddStage: (event: React.FormEvent) => void;
  busy: boolean;
  highlightStageQuery: string;
  sectionRef?: (el: HTMLElement | null) => void;
}

function PipelineStagesRow({
  pipeline,
  pipelineIndex,
  totalPipelines,
  collapsed,
  onToggleCollapse,
  onMovePipeline,
  onEditPipeline,
  onRequestDeletePipeline,
  settingsByStage,
  selectedStages,
  onToggleSelectStage,
  onOpenStageSettings,
  onRequestDeleteStage,
  onToggleCooling,
  onUpdateCoolingDays,
  onRenameStageInline,
  onCommitStageOrder,
  addingStage,
  newStageName,
  onNewStageNameChange,
  onStartAddStage,
  onCancelAddStage,
  onSubmitAddStage,
  busy,
  highlightStageQuery,
  sectionRef,
}: PipelineStagesRowProps) {
  const sortedStages = useMemo(
    () => [...pipeline.stages].sort((a, b) => a.orderIndex - b.orderIndex),
    [pipeline.stages],
  );

  // Ordem local durante o drag-and-drop para preview instantâneo a 60/120fps
  const [dragOrderedStages, setDragOrderedStages] = useState<StageItem[] | null>(null);
  const [draggingStageId, setDraggingStageId] = useState<string | null>(null);
  const [dragOverlay, setDragOverlay] = useState<ActiveStageDragOverlay | null>(null);

  // Edição rápida inline do nome da etapa
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState("");
  const [savingInlineId, setSavingInlineId] = useState<string | null>(null);

  const stages = dragOrderedStages ?? sortedStages;
  const stagesRef = useRef(stages);
  stagesRef.current = stages;

  const pipelineDealsCount = useMemo(() => {
    if (typeof pipeline.dealsCount === "number") return pipeline.dealsCount;
    return sortedStages.reduce((acc, s) => acc + (s.dealsCount || 0), 0);
  }, [pipeline.dealsCount, sortedStages]);

  // Refs e estado de rolagem horizontal
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollTrackRef = useRef<HTMLDivElement | null>(null);
  const scrollThumbRef = useRef<HTMLDivElement | null>(null);
  const addInputRef = useRef<HTMLInputElement | null>(null);

  const [scrollState, setScrollState] = useState({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  const syncScrollMetrics = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const hasOverflow = maxScroll > 4;
    const canScrollLeft = hasOverflow && el.scrollLeft > 6;
    const canScrollRight = hasOverflow && el.scrollLeft < maxScroll - 6;

    setScrollState((prev) =>
      prev.hasOverflow === hasOverflow &&
      prev.canScrollLeft === canScrollLeft &&
      prev.canScrollRight === canScrollRight
        ? prev
        : { hasOverflow, canScrollLeft, canScrollRight },
    );

    const track = scrollTrackRef.current;
    const thumb = scrollThumbRef.current;
    if (track && thumb) {
      const trackWidth = track.clientWidth;
      if (trackWidth > 0) {
        if (!hasOverflow) {
          thumb.style.width = `${trackWidth}px`;
          thumb.style.transform = "translate3d(0px, 0, 0)";
        } else {
          const thumbWidth = Math.max(
            48,
            Math.min(trackWidth, (el.clientWidth / el.scrollWidth) * trackWidth),
          );
          const maxThumbLeft = Math.max(0, trackWidth - thumbWidth);
          const ratio = Math.min(1, Math.max(0, el.scrollLeft / maxScroll));
          thumb.style.width = `${thumbWidth}px`;
          thumb.style.transform = `translate3d(${Math.round(ratio * maxThumbLeft)}px, 0, 0)`;
        }
      }
    }
  }, []);

  useEffect(() => {
    if (collapsed) return;
    syncScrollMetrics();
    const el = scrollContainerRef.current;
    if (!el) return;

    const onScroll = () => syncScrollMetrics();
    el.addEventListener("scroll", onScroll, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => syncScrollMetrics());
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }
    window.addEventListener("resize", onScroll);

    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      ro?.disconnect();
    };
  }, [collapsed, stages.length, addingStage, syncScrollMetrics]);

  // Quando abrir o formulário de nova etapa no final (ou no meio), rola suavemente até ele
  useEffect(() => {
    if (addingStage?.pipelineId === pipeline.id && !collapsed) {
      requestAnimationFrame(() => {
        syncScrollMetrics();
        if (addingStage.insertAtIndex === null && scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            left: scrollContainerRef.current.scrollWidth,
            behavior: "smooth",
          });
        }
        addInputRef.current?.focus();
      });
    }
  }, [addingStage, pipeline.id, collapsed, syncScrollMetrics]);

  const scrollByStep = (direction: -1 | 1) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const step = Math.max(440, Math.round(el.clientWidth * 0.65));
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  // Arraste direto na barra de rolagem horizontal customizada
  const handleScrollbarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const container = scrollContainerRef.current;
      const track = scrollTrackRef.current;
      const thumb = scrollThumbRef.current;
      if (!container || !track || !thumb) return;

      const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
      if (maxScroll <= 0) return;

      const trackRect = track.getBoundingClientRect();
      const thumbRect = thumb.getBoundingClientRect();
      const cssScale = track.offsetWidth > 0 ? trackRect.width / track.offsetWidth : 1;
      const trackWidth = track.clientWidth;
      const thumbWidth = Math.max(
        48,
        Math.min(trackWidth, (container.clientWidth / container.scrollWidth) * trackWidth),
      );
      const maxThumbLeft = Math.max(1, trackWidth - thumbWidth);

      const clickedInsideThumb =
        e.clientX >= thumbRect.left && e.clientX <= thumbRect.right;

      let startThumbLeft = (container.scrollLeft / maxScroll) * maxThumbLeft;
      if (!clickedInsideThumb) {
        const clickXInTrack = (e.clientX - trackRect.left) / (cssScale || 1);
        startThumbLeft = Math.max(0, Math.min(maxThumbLeft, clickXInTrack - thumbWidth / 2));
        container.scrollLeft = (startThumbLeft / maxThumbLeft) * maxScroll;
        syncScrollMetrics();
      }

      const startClientX = e.clientX;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startClientX) / (cssScale || 1);
        const nextThumbLeft = Math.max(0, Math.min(maxThumbLeft, startThumbLeft + dx));
        container.scrollLeft = (nextThumbLeft / maxThumbLeft) * maxScroll;
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };

      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [syncScrollMetrics],
  );

  // Pan horizontal segurando e arrastando em áreas livres da faixa de etapas
  const handleStripPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    const isMiddleClick = e.button === 1;
    if (e.button !== 0 && !isMiddleClick) return;

    const target = e.target as HTMLElement;
    if (
      !isMiddleClick &&
      target.closest(
        '[data-stage-drag-trigger], button, a, input, textarea, label, [role="checkbox"], [role="switch"], [role="button"], [data-no-pan]',
      )
    ) {
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) return;
    const maxScroll = container.scrollWidth - container.clientWidth;
    if (maxScroll <= 2) return;

    if (isMiddleClick) e.preventDefault();

    const cRect = container.getBoundingClientRect();
    const cssScale = container.offsetWidth > 0 ? cRect.width / container.offsetWidth : 1;

    const pan = {
      startX: e.clientX,
      startY: e.clientY,
      initialScrollLeft: container.scrollLeft,
      cssScale: cssScale || 1,
      moved: false,
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - pan.startX;
      const dy = ev.clientY - pan.startY;
      if (!pan.moved && Math.hypot(dx, dy) > 5) {
        pan.moved = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      if (pan.moved && scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft = pan.initialScrollLeft - dx / pan.cssScale;
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (pan.moved) {
        const suppressClick = (clickEv: MouseEvent) => {
          clickEv.stopImmediatePropagation();
          clickEv.preventDefault();
          window.removeEventListener("click", suppressClick, true);
        };
        window.addEventListener("click", suppressClick, true);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  // Drag-and-Drop de etapa com preview ao vivo + auto-scroll horizontal de borda
  const handleStageDragPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, stage: StageItem) => {
      if (busy || editingStageId) return;
      if (e.button !== 0) return;

      const target = e.target as HTMLElement;
      if (
        target.closest(
          'button:not([data-stage-drag-handle]), input, textarea, label, [role="checkbox"], [role="switch"]',
        )
      ) {
        return;
      }

      const cardEl = (e.currentTarget as HTMLElement).closest(
        "[data-stage-card-id]",
      ) as HTMLDivElement | null;
      const container = scrollContainerRef.current;
      if (!cardEl || !container) return;

      const cardRect = cardEl.getBoundingClientRect();
      const cssScale = cardEl.offsetWidth > 0 ? cardRect.width / cardEl.offsetWidth : 1;
      const scale = cssScale || 1;

      const initialOrder = [...sortedStages];
      let workingOrder = [...sortedStages];
      let hasStartedDrag = false;
      let latestClientX = e.clientX;
      let latestClientY = e.clientY;
      let autoScrollRaf: number | null = null;

      const startX = e.clientX;
      const startY = e.clientY;
      const startRectLeft = cardRect.left;
      const startRectTop = cardRect.top;
      const cardOffsetWidth = cardEl.offsetWidth;

      const updateDropPosition = (clientX: number) => {
        const scroller = scrollContainerRef.current;
        if (!scroller) return;
        const stageNodes = Array.from(
          scroller.querySelectorAll<HTMLElement>("[data-stage-card-id]"),
        );
        if (stageNodes.length <= 1) return;

        const rects = stageNodes.map((node) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, width: r.width };
        });

        const currentIdx = workingOrder.findIndex((s) => s.id === stage.id);
        const nextIdx = resolveHorizontalDropIndex(clientX, rects);
        if (currentIdx >= 0 && nextIdx >= 0 && currentIdx !== nextIdx) {
          workingOrder = reorderByIndex(workingOrder, currentIdx, nextIdx);
          setDragOrderedStages(workingOrder);
        }
      };

      const runAutoScrollTick = () => {
        if (!hasStartedDrag || !scrollContainerRef.current) {
          autoScrollRaf = null;
          return;
        }
        const scroller = scrollContainerRef.current;
        const cRect = scroller.getBoundingClientRect();
        const step = computeEdgeAutoScrollStep(latestClientX, cRect.left, cRect.right, 84, 15);
        if (step !== 0) {
          const prevScroll = scroller.scrollLeft;
          scroller.scrollLeft += step;
          if (scroller.scrollLeft !== prevScroll) {
            updateDropPosition(latestClientX);
          }
        }
        const currentPos = workingOrder.findIndex((s) => s.id === stage.id);
        setDragOverlay({
          stage,
          stageNumber: (currentPos >= 0 ? currentPos : 0) + 1,
          abbreviation: settingsByStage[stage.id]?.abbreviation,
          width: cardOffsetWidth,
          x: (startRectLeft + (latestClientX - startX)) / scale,
          y: (startRectTop + (latestClientY - startY)) / scale,
        });
        autoScrollRaf = requestAnimationFrame(runAutoScrollTick);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("keydown", onKeyDown);
        if (autoScrollRaf !== null) {
          cancelAnimationFrame(autoScrollRaf);
          autoScrollRaf = null;
        }
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        setDraggingStageId(null);
        setDragOverlay(null);
        setDragOrderedStages(null);
      };

      const onPointerMove = (ev: PointerEvent) => {
        latestClientX = ev.clientX;
        latestClientY = ev.clientY;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (!hasStartedDrag && Math.hypot(dx, dy) > 5) {
          hasStartedDrag = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
          setDraggingStageId(stage.id);
          setDragOrderedStages(workingOrder);
          autoScrollRaf = requestAnimationFrame(runAutoScrollTick);
        }

        if (hasStartedDrag) {
          updateDropPosition(ev.clientX);
        }
      };

      const onKeyDown = (keyEv: KeyboardEvent) => {
        if (keyEv.key === "Escape" && hasStartedDrag) {
          keyEv.preventDefault();
          cleanup();
        }
      };

      const onPointerCancel = () => {
        cleanup();
      };

      const onPointerUp = () => {
        const wasDragging = hasStartedDrag;
        const finalOrder = workingOrder;
        cleanup();

        if (wasDragging) {
          const suppressClick = (clickEv: MouseEvent) => {
            clickEv.stopImmediatePropagation();
            clickEv.preventDefault();
            window.removeEventListener("click", suppressClick, true);
          };
          window.addEventListener("click", suppressClick, true);

          const changed = finalOrder.some((item, idx) => item.id !== initialOrder[idx]?.id);
          if (changed) {
            onCommitStageOrder(finalOrder);
          }
        }
      };

      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("keydown", onKeyDown);
    },
    [busy, editingStageId, onCommitStageOrder, settingsByStage, sortedStages],
  );

  const nudgeStage = (stageId: string, direction: -1 | 1) => {
    const idx = sortedStages.findIndex((s) => s.id === stageId);
    const nextIdx = idx + direction;
    if (idx < 0 || nextIdx < 0 || nextIdx >= sortedStages.length) return;
    onCommitStageOrder(reorderByIndex(sortedStages, idx, nextIdx));
  };

  const startInlineRename = (stage: StageItem) => {
    setEditingStageId(stage.id);
    setEditingStageName(stage.name);
  };

  const commitInlineRename = async (stage: StageItem) => {
    const trimmed = editingStageName.trim();
    if (!trimmed) {
      setEditingStageId(null);
      return;
    }
    if (trimmed === stage.name) {
      setEditingStageId(null);
      return;
    }
    setSavingInlineId(stage.id);
    const ok = await onRenameStageInline(stage, trimmed);
    setSavingInlineId(null);
    if (ok) setEditingStageId(null);
  };

  const isAddingHere = addingStage?.pipelineId === pipeline.id;
  const insertAtIndex = isAddingHere ? addingStage.insertAtIndex : null;

  const renderInlineNewStageCard = (positionLabel?: string) => (
    <div
      key="inline-new-stage-card"
      data-no-pan="true"
      className="relative w-56 shrink-0 pt-9"
    >
      <span className="absolute left-2 top-0 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
        <Plus className="h-3.5 w-3.5" />
      </span>
      <form
        onSubmit={onSubmitAddStage}
        className="rounded-xl border border-primary/50 bg-card p-3 shadow-sm"
      >
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">
          {positionLabel || "Nova etapa"}
        </p>
        <input
          ref={addInputRef}
          autoFocus
          value={newStageName}
          onChange={(event) => onNewStageNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancelAddStage();
            }
          }}
          maxLength={120}
          placeholder="Nome da etapa..."
          aria-label="Nome da nova etapa"
          className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary"
        />
        <div className="mt-2.5 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onCancelAddStage}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <X className="h-3 w-3" /> Cancelar
          </button>
          <button
            type="submit"
            disabled={!newStageName.trim() || busy}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:opacity-90 disabled:opacity-40 cursor-pointer"
          >
            <Check className="h-3 w-3" /> Criar
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <section
      ref={sectionRef}
      className="mb-7 rounded-2xl border border-border bg-card/40 px-4 py-4 transition-colors"
    >
      {/* Cabeçalho do Funil */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <SystemTooltip content={collapsed ? "Expandir etapas do funil" : "Recolher etapas do funil"}>
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? `Expandir ${pipeline.name}` : `Recolher ${pipeline.name}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </SystemTooltip>

          <div className="flex items-center gap-0.5 mr-1">
            <SystemTooltip content="Mover funil para cima">
              <button
                type="button"
                disabled={busy || pipelineIndex === 0}
                onClick={() => onMovePipeline(-1)}
                aria-label={`Mover funil ${pipeline.name} para cima`}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-25 cursor-pointer"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
            <SystemTooltip content="Mover funil para baixo">
              <button
                type="button"
                disabled={busy || pipelineIndex === totalPipelines - 1}
                onClick={() => onMovePipeline(1)}
                aria-label={`Mover funil ${pipeline.name} para baixo`}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-25 cursor-pointer"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          </div>

          <h2
            onClick={onToggleCollapse}
            className="truncate text-sm font-bold uppercase tracking-wide cursor-pointer select-none"
          >
            {pipeline.name}
          </h2>

          {pipeline.isDefault && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
              Padrão
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Opções do funil ${pipeline.name}`}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={onEditPipeline}>
                <Settings2 /> Configurar funil
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (collapsed) onToggleCollapse();
                  onStartAddStage(null);
                }}
              >
                <Plus /> Adicionar etapa
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={pipelineIndex === 0}
                onSelect={() => onMovePipeline(-1)}
              >
                <ArrowUp /> Mover funil para cima
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={pipelineIndex === totalPipelines - 1}
                onSelect={() => onMovePipeline(1)}
              >
                <ArrowDown /> Mover funil para baixo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onRequestDeletePipeline}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 /> Excluir funil
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border bg-background/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {stages.length} {stages.length === 1 ? "etapa" : "etapas"} ·{" "}
            {pipelineDealsCount.toLocaleString("pt-BR")}{" "}
            {pipelineDealsCount === 1 ? "negociação" : "negociações"}
          </span>

          {!collapsed && scrollState.hasOverflow && (
            <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background/80 p-0.5">
              <SystemTooltip content="Rolar etapas para a esquerda">
                <button
                  type="button"
                  disabled={!scrollState.canScrollLeft}
                  onClick={() => scrollByStep(-1)}
                  aria-label={`Rolar etapas de ${pipeline.name} para a esquerda`}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
              <SystemTooltip content="Rolar etapas para a direita">
                <button
                  type="button"
                  disabled={!scrollState.canScrollRight}
                  onClick={() => scrollByStep(1)}
                  aria-label={`Rolar etapas de ${pipeline.name} para a direita`}
                  className="relative flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                  {scrollState.canScrollRight && (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </button>
              </SystemTooltip>
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (collapsed) onToggleCollapse();
              onStartAddStage(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/35 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" /> Nova etapa
          </button>
        </div>
      </div>

      {/* Corpo expansível com barra de scroll horizontal customizada + timeline de etapas */}
      {!collapsed && (
        <div className="mt-4">
          {/* Barra de scroll horizontal sempre visível quando há mais etapas que a tela comporta */}
          {scrollState.hasOverflow && (
            <div className="mb-3 flex items-center gap-2 select-none">
              <div
                ref={scrollTrackRef}
                onPointerDown={handleScrollbarPointerDown}
                onWheel={(e) => {
                  if (scrollContainerRef.current) {
                    e.preventDefault();
                    scrollContainerRef.current.scrollLeft +=
                      Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
                  }
                }}
                role="scrollbar"
                aria-orientation="horizontal"
                aria-valuenow={0}
                aria-label={`Barra de rolagem horizontal de ${pipeline.name}`}
                className="relative h-2.5 flex-1 rounded-full border border-border/80 bg-muted/70 dark:bg-muted/40 overflow-hidden cursor-pointer hover:border-primary/45 transition-colors"
              >
                <div
                  ref={scrollThumbRef}
                  className="h-full rounded-full bg-primary/65 hover:bg-primary active:bg-primary cursor-grab active:cursor-grabbing will-change-transform transition-colors"
                  style={{ width: "100%", transform: "translate3d(0px, 0, 0)" }}
                />
              </div>
              <span className="hidden sm:inline text-[10px] text-muted-foreground whitespace-nowrap">
                Arraste a barra ou use as setas para ver todas as etapas
              </span>
            </div>
          )}

          <div className="relative">
            {/* Botão flutuante esquerdo quando rolado */}
            {scrollState.canScrollLeft && (
              <div className="pointer-events-none absolute inset-y-0 left-0 z-20 flex items-center bg-gradient-to-r from-background/90 via-background/40 to-transparent pr-5">
                <SystemTooltip content="Ver etapas anteriores">
                  <button
                    type="button"
                    onClick={() => scrollByStep(-1)}
                    aria-label="Ver etapas anteriores"
                    className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:border-primary hover:text-primary cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </SystemTooltip>
              </div>
            )}

            {/* Botão flutuante direito quando há etapas fora da tela */}
            {scrollState.canScrollRight && (
              <div className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center justify-end bg-gradient-to-l from-background/90 via-background/40 to-transparent pl-5">
                <SystemTooltip content="Avançar para ver mais etapas">
                  <button
                    type="button"
                    onClick={() => scrollByStep(1)}
                    aria-label="Avançar para ver mais etapas"
                    className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-primary/40 bg-card text-primary shadow-md hover:bg-primary hover:text-primary-foreground cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </SystemTooltip>
              </div>
            )}

            <div
              ref={scrollContainerRef}
              onPointerDown={handleStripPointerDown}
              className="overflow-x-auto pb-2 pt-1 select-none md:cursor-grab active:cursor-grabbing"
            >
              <div className="relative flex min-w-max gap-3 pt-2 pr-4 before:absolute before:left-3 before:right-6 before:top-3 before:h-0.5 before:bg-primary/70">
                {stages.map((stage, index) => {
                  const settings = settingsByStage[stage.id];
                  const coolingEnabled = settings?.coolingEnabled ?? true;
                  const coolingDays = settings?.coolingDays ?? pipeline.coolingDays;
                  const dealsCount = stage.dealsCount ?? 0;
                  const isDraggingThis = draggingStageId === stage.id;
                  const isEditingThis = editingStageId === stage.id;
                  const isHighlighted =
                    Boolean(highlightStageQuery) &&
                    stage.name.toLowerCase().includes(highlightStageQuery);

                  return (
                    <React.Fragment key={stage.id}>
                      {isAddingHere &&
                        insertAtIndex === index &&
                        renderInlineNewStageCard(`Inserir na posição ${index + 1}`)}

                      <div
                        data-stage-card-id={stage.id}
                        className={`group relative w-56 shrink-0 pt-9 transition-opacity ${
                          isDraggingThis ? "opacity-35" : "opacity-100"
                        }`}
                      >
                        {/* Nó numerado na linha do funil + alça de arrastar */}
                        <div
                          data-stage-drag-trigger="true"
                          onPointerDown={(ev) => handleStageDragPointerDown(ev, stage)}
                          className="absolute left-1 right-1 top-0 z-10 flex items-center justify-between cursor-grab active:cursor-grabbing"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-background text-[10px] font-bold text-primary shadow-xs">
                              {index + 1}
                            </span>
                            <SystemTooltip content="Clique e arraste para mover esta etapa">
                              <button
                                type="button"
                                data-stage-drag-handle="true"
                                aria-label={`Arrastar etapa ${stage.name}`}
                                className="inline-flex items-center gap-0.5 rounded-md border border-border/80 bg-card/95 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground opacity-80 group-hover:opacity-100 group-hover:border-primary/40 group-hover:text-foreground cursor-grab active:cursor-grabbing"
                              >
                                <GripVertical className="h-3 w-3" />
                                <span>Mover</span>
                              </button>
                            </SystemTooltip>
                          </div>
                        </div>

                        {/* Cartão da Etapa */}
                        <div
                          className={`flex h-full flex-col justify-between rounded-xl border p-3 transition-colors ${
                            isHighlighted
                              ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                              : selectedStages.includes(stage.id)
                                ? "border-primary/60 bg-primary/5"
                                : "border-border/80 bg-background/60 hover:border-border"
                          }`}
                        >
                          <div>
                            {/* Cabeçalho da etapa (também arrastável fora dos botões) */}
                            <div
                              data-stage-drag-trigger="true"
                              onPointerDown={(ev) => handleStageDragPointerDown(ev, stage)}
                              className="mb-2.5 flex min-h-11 items-start justify-between gap-2 cursor-grab active:cursor-grabbing"
                            >
                              <div className="min-w-0 flex-1">
                                {isEditingThis ? (
                                  <div className="flex items-center gap-1" data-no-pan="true">
                                    <input
                                      autoFocus
                                      value={editingStageName}
                                      disabled={savingInlineId === stage.id}
                                      onChange={(ev) => setEditingStageName(ev.target.value)}
                                      onKeyDown={(ev) => {
                                        if (ev.key === "Enter") {
                                          ev.preventDefault();
                                          void commitInlineRename(stage);
                                        } else if (ev.key === "Escape") {
                                          ev.preventDefault();
                                          setEditingStageId(null);
                                        }
                                      }}
                                      onBlur={() => void commitInlineRename(stage)}
                                      maxLength={120}
                                      aria-label={`Renomear etapa ${stage.name}`}
                                      className="h-7 w-full rounded-md border border-primary bg-background px-2 text-xs font-bold uppercase text-foreground outline-none"
                                    />
                                  </div>
                                ) : (
                                  <div className="flex items-start gap-1">
                                    <h3
                                      onDoubleClick={() => startInlineRename(stage)}
                                      className="break-words text-xs font-bold uppercase leading-4 text-foreground"
                                    >
                                      {stage.name}
                                    </h3>
                                    <SystemTooltip content="Renomear etapa (ou dê duplo clique no nome)">
                                      <button
                                        type="button"
                                        onClick={() => startInlineRename(stage)}
                                        aria-label={`Renomear etapa ${stage.name}`}
                                        className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-opacity cursor-pointer"
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                    </SystemTooltip>
                                  </div>
                                )}

                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {dealsCount.toLocaleString("pt-BR")}{" "}
                                    {dealsCount === 1 ? "negociação" : "negociações"}
                                  </span>
                                  {settings?.abbreviation && (
                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground/80">
                                      {settings.abbreviation}
                                    </span>
                                  )}
                                  {(stage.isWinStage || stage.isLossStage) && (
                                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                      {stage.isWinStage ? "Ganho" : "Perda"}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <SystemTooltip content="Selecionar etapa para exclusão em lote">
                                <div className="pt-0.5">
                                  <Checkbox
                                    checked={selectedStages.includes(stage.id)}
                                    onCheckedChange={(checked) =>
                                      onToggleSelectStage(stage.id, Boolean(checked))
                                    }
                                    aria-label={`Selecionar etapa ${stage.name}`}
                                  />
                                </div>
                              </SystemTooltip>
                            </div>

                            {/* Configuração de esfriamento */}
                            <div className="flex items-start justify-between gap-2 border-t border-border/60 pt-2.5">
                              <span className="text-[11px] font-semibold leading-4">
                                Destacar negociações esfriando na etapa
                              </span>
                              <Switch
                                checked={coolingEnabled}
                                onCheckedChange={(checked) => onToggleCooling(stage, checked)}
                                aria-label={`Alerta de esfriamento em ${stage.name}`}
                              />
                            </div>

                            {coolingEnabled && (
                              <label className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span>Após</span>
                                <div className="relative inline-flex items-center">
                                  <input
                                    key={`${stage.id}-${coolingDays}`}
                                    type="text"
                                    inputMode="numeric"
                                    defaultValue={coolingDays}
                                    aria-label={`Dias para esfriamento em ${stage.name}`}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") event.currentTarget.blur();
                                    }}
                                    onBlur={(event) => {
                                      const days = Number(
                                        event.currentTarget.value.replace(/\D/g, ""),
                                      );
                                      if (!Number.isInteger(days) || days < 1 || days > 365) {
                                        event.currentTarget.value = String(coolingDays);
                                        toast.error("Informe entre 1 e 365 dias.");
                                      } else if (days !== coolingDays) {
                                        onUpdateCoolingDays(stage, days);
                                      }
                                    }}
                                    className="h-7 w-20 rounded-md border border-border bg-background pl-2 pr-11 text-xs text-foreground"
                                  />
                                  <div className="absolute right-0.5 flex items-center gap-0.5">
                                    <SystemTooltip content="Diminuir dias (-1)">
                                      <button
                                        type="button"
                                        disabled={coolingDays <= 1}
                                        onClick={() =>
                                          onUpdateCoolingDays(stage, Math.max(1, coolingDays - 1))
                                        }
                                        className="flex h-5 w-4.5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 cursor-pointer"
                                      >
                                        <ChevronDown className="h-3 w-3" />
                                      </button>
                                    </SystemTooltip>
                                    <SystemTooltip content="Aumentar dias (+1)">
                                      <button
                                        type="button"
                                        disabled={coolingDays >= 365}
                                        onClick={() =>
                                          onUpdateCoolingDays(stage, Math.min(365, coolingDays + 1))
                                        }
                                        className="flex h-5 w-4.5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 cursor-pointer"
                                      >
                                        <ChevronUp className="h-3 w-3" />
                                      </button>
                                    </SystemTooltip>
                                  </div>
                                </div>
                                <span>{coolingDays === 1 ? "dia" : "dias"} sem interação</span>
                              </label>
                            )}
                          </div>

                          {/* Rodapé de ações rápidas da etapa */}
                          <div className="mt-3.5 border-t border-border/50 pt-2.5">
                            <button
                              type="button"
                              onClick={() => onOpenStageSettings(stage)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
                            >
                              <Settings2 className="h-3.5 w-3.5" /> Configurar etapa
                            </button>

                            <div className="mt-2.5 flex items-center justify-between gap-1">
                              <div className="flex items-center gap-1">
                                <SystemTooltip content={`Mover ${stage.name} para a esquerda`}>
                                  <button
                                    type="button"
                                    disabled={busy || index === 0}
                                    onClick={() => nudgeStage(stage.id, -1)}
                                    aria-label={`Mover ${stage.name} para a esquerda`}
                                    className="rounded-md border border-border p-1 text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-30 cursor-pointer"
                                  >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                  </button>
                                </SystemTooltip>
                                <SystemTooltip content={`Mover ${stage.name} para a direita`}>
                                  <button
                                    type="button"
                                    disabled={busy || index === stages.length - 1}
                                    onClick={() => nudgeStage(stage.id, 1)}
                                    aria-label={`Mover ${stage.name} para a direita`}
                                    className="rounded-md border border-border p-1 text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-30 cursor-pointer"
                                  >
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  </button>
                                </SystemTooltip>
                                <SystemTooltip content="Inserir nova etapa logo após esta">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => onStartAddStage(index + 1)}
                                    aria-label={`Inserir nova etapa após ${stage.name}`}
                                    className="rounded-md border border-border p-1 text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-30 cursor-pointer"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </button>
                                </SystemTooltip>
                              </div>

                              <SystemTooltip content={`Excluir etapa ${stage.name}`}>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => onRequestDeleteStage(stage)}
                                  aria-label={`Excluir etapa ${stage.name}`}
                                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Excluir</span>
                                </button>
                              </SystemTooltip>
                            </div>
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}

                {/* Card final para adicionar etapa no fim do funil */}
                {isAddingHere && insertAtIndex === null ? (
                  renderInlineNewStageCard("Adicionar ao final")
                ) : (
                  <div className="relative w-48 shrink-0 pt-9" data-no-pan="true">
                    <SystemTooltip content={`Adicionar etapa ao final de ${pipeline.name}`}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onStartAddStage(null)}
                        aria-label={`Adicionar etapa ao funil ${pipeline.name}`}
                        className="absolute left-1 top-0 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:opacity-90 cursor-pointer"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </SystemTooltip>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onStartAddStage(null)}
                      className="flex w-full flex-col items-start rounded-xl border border-dashed border-border/80 bg-background/40 p-3 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-foreground">Adicionar etapa</span>
                      <span className="mt-1 text-[11px] text-muted-foreground">
                        Criar nova etapa no final deste funil
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overlay flutuante durante o arraste da etapa */}
      {dragOverlay &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              width: `${dragOverlay.width}px`,
              transform: `translate3d(${Math.round(dragOverlay.x)}px, ${Math.round(dragOverlay.y)}px, 0)`,
              zIndex: 100000,
              pointerEvents: "none",
            }}
            className="rounded-xl border-2 border-primary bg-card p-3 shadow-2xl ring-4 ring-primary/15 select-none"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {dragOverlay.stageNumber}
              </span>
              <span className="truncate text-xs font-bold uppercase text-foreground">
                {dragOverlay.stage.name}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {(dragOverlay.stage.dealsCount ?? 0).toLocaleString("pt-BR")} negociação(ões) · Solte
              na posição desejada
            </p>
          </div>,
          document.body,
        )}
    </section>
  );
}

export function PipelineSettingsModal({
  isOpen,
  onClose,
  onPipelinesChanged,
  selectedPipelineId,
}: PipelineSettingsModalProps) {
  const [pipelines, setPipelines] = useState<PipelineItem[]>([]);
  const [settingsByStage, setSettingsByStage] = useState<Record<string, StageSettings>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pipelineDraft, setPipelineDraft] = useState<PipelineDraft | null>(null);
  const [stageDraft, setStageDraft] = useState<StageDraft | null>(null);
  const { fields: dealCustomFields } = useCustomFields("deal", isOpen);
  const [addingStage, setAddingStage] = useState<AddingStageState | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [lossReasonItems, setLossReasonItems] = useState<CatalogLossReasonItem[]>([]);

  // Controles de organização geral
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedPipelineIds, setCollapsedPipelineIds] = useState<Record<string, boolean>>({});

  // Modais customizados de exclusão (etapas e funis)
  const [deleteStagesState, setDeleteStagesState] = useState<DeleteStagesState | null>(null);
  const [deletePipelineState, setDeletePipelineState] = useState<DeletePipelineState | null>(null);

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [pipelineData, settingsData, lossCatalogData] = await Promise.all([
        requestJson("/api/crm/pipelines?scope=admin&includeDealCounts=true"),
        requestJson("/api/crm/stage-settings").catch(() => ({ settings: [] })),
        requestJson("/api/crm/catalogs?kind=loss_reason").catch(() => ({ items: [] })),
      ]);
      const nextPipelines: PipelineItem[] = [...(pipelineData.pipelines || [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      setPipelines(nextPipelines);
      setLossReasonItems(
        Array.isArray(lossCatalogData.items)
          ? lossCatalogData.items.filter((item: CatalogLossReasonItem) => item.isActive !== false)
          : [],
      );
      const visibleStageIds = new Set(
        nextPipelines.flatMap((pipeline) => pipeline.stages.map((stage) => stage.id)),
      );
      setSelectedStages((current) => current.filter((id) => visibleStageIds.has(id)));
      setSettingsByStage(
        Object.fromEntries(
          (settingsData.settings || []).map((item: StageSettings) => [item.stageId, item]),
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar funis.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      void reload(false);
    }
  }, [isOpen, reload]);

  // Se aberto a partir de um funil selecionado, foca suavemente nele após carregar
  useEffect(() => {
    if (isOpen && selectedPipelineId && pipelines.length > 0) {
      const el = sectionRefs.current[selectedPipelineId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [isOpen, selectedPipelineId, pipelines.length]);

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(successMessage);
      await reload(true);
      notifyCrmChanged(onPipelinesChanged);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openStage = (pipeline: PipelineItem, stage: StageItem) => {
    const settings = settingsByStage[stage.id];
    const linkedLossReasons = lossReasonItems
      .filter((item) => Array.isArray(item.stageIds) && item.stageIds.includes(stage.id))
      .map((item) => item.name);
    setStageDraft({
      id: stage.id,
      pipelineId: pipeline.id,
      name: stage.name,
      abbreviation: settings?.abbreviation || "",
      objective: settings?.objective || "",
      description: settings?.description || "",
      coolingEnabled: settings?.coolingEnabled ?? true,
      coolingDays: settings?.coolingDays ?? pipeline.coolingDays,
      isWinStage: stage.isWinStage,
      isLossStage: stage.isLossStage,
      requiredFields: stage.requiredFields || [],
      lossReasonNames: linkedLossReasons,
    });
  };

  const savePipeline = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pipelineDraft?.name.trim()) return;
    const draft = pipelineDraft;
    const success = await run(
      () =>
        draft.id
          ? requestJson(
              `/api/crm/pipelines/${draft.id}`,
              jsonRequest("PATCH", {
                name: draft.name.trim(),
                coolingDays: draft.coolingDays,
                isDefault: draft.isDefault,
              }),
            )
          : requestJson(
              "/api/crm/pipelines",
              jsonRequest("POST", {
                name: draft.name.trim(),
                orderIndex: pipelines.length,
                isDefault: pipelines.length === 0 || draft.isDefault,
                coolingDays: draft.coolingDays,
                stages: [],
              }),
            ),
      draft.id ? "Funil atualizado." : "Funil criado. Adicione a primeira etapa.",
    );
    if (success) setPipelineDraft(null);
  };

  const saveStage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stageDraft?.name.trim()) return;
    const draft = stageDraft;
    const success = await run(async () => {
      await requestJson(
        "/api/crm/stage-settings",
        jsonRequest("PUT", {
          stageId: draft.id,
          abbreviation: draft.abbreviation,
          objective: draft.objective,
          description: draft.description,
          coolingEnabled: draft.coolingEnabled,
          coolingDays: draft.coolingDays,
        }),
      );
      await requestJson(
        `/api/crm/stages/${draft.id}`,
        jsonRequest("PATCH", {
          name: draft.name.trim(),
          isWinStage: draft.isWinStage,
          isLossStage: draft.isLossStage,
          requiredFields: draft.requiredFields,
        }),
      );
      await requestJson(
        "/api/crm/catalogs",
        jsonRequest("PATCH", {
          action: "set_stage_items",
          kind: "loss_reason",
          pipelineId: draft.pipelineId,
          stageId: draft.id,
          selectedNames: draft.lossReasonNames,
        }),
      );
    }, "Etapa atualizada.");
    if (success) setStageDraft(null);
  };

  const addStage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!addingStage || !newStageName.trim()) return;
    const { pipelineId, insertAtIndex } = addingStage;
    const payload: { name: string; orderIndex?: number } = { name: newStageName.trim() };
    if (insertAtIndex !== null) {
      payload.orderIndex = insertAtIndex;
    }
    const success = await run(
      () => requestJson(`/api/crm/pipelines/${pipelineId}/stages`, jsonRequest("POST", payload)),
      "Etapa adicionada.",
    );
    if (success) {
      setAddingStage(null);
      setNewStageName("");
    }
  };

  // Reordenação otimista de etapas (arrastar e soltar ou setas < >)
  const commitStageOrder = async (pipelineId: string, orderedStages: StageItem[]) => {
    const previousPipelines = pipelines;
    const normalized = orderedStages.map((s, idx) => ({ ...s, orderIndex: idx }));

    setPipelines((current) =>
      current.map((p) => (p.id === pipelineId ? { ...p, stages: normalized } : p)),
    );

    try {
      await requestJson(
        `/api/crm/pipelines/${pipelineId}/stages`,
        jsonRequest("PATCH", {
          stageOrders: normalized.map((stage, orderIndex) => ({ id: stage.id, orderIndex })),
        }),
      );
      toast.success("Ordem das etapas atualizada.");
      notifyCrmChanged(onPipelinesChanged);
    } catch (error) {
      setPipelines(previousPipelines);
      toast.error(error instanceof Error ? error.message : "Falha ao reordenar etapas.");
    }
  };

  // Reordenação otimista de funis
  const movePipeline = async (pipelineId: string, direction: -1 | 1) => {
    const idx = pipelines.findIndex((p) => p.id === pipelineId);
    const nextIdx = idx + direction;
    if (idx < 0 || nextIdx < 0 || nextIdx >= pipelines.length) return;

    const previousPipelines = pipelines;
    const reordered = reorderByIndex(pipelines, idx, nextIdx);
    setPipelines(reordered);

    try {
      await requestJson(
        "/api/crm/pipelines",
        jsonRequest("PATCH", {
          pipelineOrders: reordered.map((p, orderIndex) => ({ id: p.id, orderIndex })),
        }),
      );
      toast.success("Ordem dos funis atualizada.");
      notifyCrmChanged(onPipelinesChanged);
    } catch (error) {
      setPipelines(previousPipelines);
      toast.error(error instanceof Error ? error.message : "Falha ao reordenar funis.");
    }
  };

  // Renomeação rápida inline da etapa
  const renameStageInline = async (stage: StageItem, nextName: string): Promise<boolean> => {
    const previousPipelines = pipelines;
    setPipelines((current) =>
      current.map((p) => ({
        ...p,
        stages: p.stages.map((s) => (s.id === stage.id ? { ...s, name: nextName } : s)),
      })),
    );
    try {
      await requestJson(`/api/crm/stages/${stage.id}`, jsonRequest("PATCH", { name: nextName }));
      toast.success("Nome da etapa atualizado.");
      notifyCrmChanged(onPipelinesChanged);
      return true;
    } catch (error) {
      setPipelines(previousPipelines);
      toast.error(error instanceof Error ? error.message : "Não foi possível renomear a etapa.");
      return false;
    }
  };

  // Atualizações otimistas de esfriamento (sem travar a tela inteira)
  const toggleCooling = async (pipeline: PipelineItem, stage: StageItem, enabled: boolean) => {
    const previousSettings = settingsByStage;
    const current = settingsByStage[stage.id];
    const nextEntry: StageSettings = {
      stageId: stage.id,
      abbreviation: current?.abbreviation ?? null,
      objective: current?.objective ?? null,
      description: current?.description ?? null,
      coolingEnabled: enabled,
      coolingDays: current?.coolingDays ?? pipeline.coolingDays,
    };

    setSettingsByStage((prev) => ({ ...prev, [stage.id]: nextEntry }));
    try {
      await requestJson(
        "/api/crm/stage-settings",
        jsonRequest("PUT", {
          stageId: stage.id,
          abbreviation: nextEntry.abbreviation || "",
          objective: nextEntry.objective || "",
          description: nextEntry.description || "",
          coolingEnabled: nextEntry.coolingEnabled,
          coolingDays: nextEntry.coolingDays,
        }),
      );
      toast.success(
        enabled ? "Alerta de esfriamento ativado." : "Alerta de esfriamento desativado.",
      );
      notifyCrmChanged(onPipelinesChanged);
    } catch (error) {
      setSettingsByStage(previousSettings);
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar alerta.");
    }
  };

  const updateCoolingDays = async (pipeline: PipelineItem, stage: StageItem, days: number) => {
    const current = settingsByStage[stage.id];
    if (days === (current?.coolingDays ?? pipeline.coolingDays)) return;

    const previousSettings = settingsByStage;
    const nextEntry: StageSettings = {
      stageId: stage.id,
      abbreviation: current?.abbreviation ?? null,
      objective: current?.objective ?? null,
      description: current?.description ?? null,
      coolingEnabled: current?.coolingEnabled ?? true,
      coolingDays: days,
    };

    setSettingsByStage((prev) => ({ ...prev, [stage.id]: nextEntry }));
    try {
      await requestJson(
        "/api/crm/stage-settings",
        jsonRequest("PUT", {
          stageId: stage.id,
          abbreviation: nextEntry.abbreviation || "",
          objective: nextEntry.objective || "",
          description: nextEntry.description || "",
          coolingEnabled: nextEntry.coolingEnabled,
          coolingDays: nextEntry.coolingDays,
        }),
      );
      toast.success("Prazo de esfriamento atualizado.");
      notifyCrmChanged(onPipelinesChanged);
    } catch (error) {
      setSettingsByStage(previousSettings);
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar prazo.");
    }
  };

  // Preparar exclusão de 1 ou mais etapas com resolução automática de destino
  const openDeleteStagesModal = (stageIds: string[], preferredPipelineId: string | null) => {
    if (stageIds.length === 0) return;
    const defaultTarget = resolveDefaultStageMigrationTarget(
      pipelines,
      stageIds,
      preferredPipelineId,
    );
    setDeleteStagesState({
      stageIds,
      preferredPipelineId,
      targetPipelineId: defaultTarget?.targetPipelineId || "",
      targetStageId: defaultTarget?.targetStageId || "",
    });
  };

  const confirmDeleteStages = async () => {
    if (!deleteStagesState) return;
    const { stageIds, targetStageId } = deleteStagesState;
    const stageMap = new Map<string, StageItem>();
    for (const p of pipelines) {
      for (const s of p.stages) stageMap.set(s.id, s);
    }

    const totalDealsToMove = stageIds.reduce(
      (acc, id) => acc + (stageMap.get(id)?.dealsCount || 0),
      0,
    );

    if (totalDealsToMove > 0 && !targetStageId) {
      toast.error("Escolha uma etapa de destino para mover as negociações antes de excluir.");
      return;
    }

    setBusy(true);
    let deletedCount = 0;
    let migratedTotal = 0;
    const failures: string[] = [];

    for (const id of stageIds) {
      const st = stageMap.get(id);
      const needsMigration = (st?.dealsCount || 0) > 0 || Boolean(targetStageId);
      const url =
        needsMigration && targetStageId
          ? `/api/crm/stages/${encodeURIComponent(id)}?migrateToStageId=${encodeURIComponent(targetStageId)}`
          : `/api/crm/stages/${encodeURIComponent(id)}`;
      try {
        const res = await requestJson(url, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(targetStageId ? { migrateToStageId: targetStageId } : {}),
        });
        deletedCount += 1;
        migratedTotal += Number(res?.migratedDealsCount) || 0;
      } catch (error) {
        failures.push(
          `${st?.name || id}: ${error instanceof Error ? error.message : "falha ao excluir"}`,
        );
      }
    }

    setSelectedStages((prev) => prev.filter((id) => !stageIds.includes(id)));
    if (stageDraft && stageIds.includes(stageDraft.id)) {
      setStageDraft(null);
    }
    setDeleteStagesState(null);
    await reload(true);
    notifyCrmChanged(onPipelinesChanged);
    setBusy(false);

    if (failures.length > 0) {
      toast.error(failures.join(" | "));
    } else if (migratedTotal > 0) {
      toast.success(
        `${deletedCount === 1 ? "Etapa excluída" : `${deletedCount} etapas excluídas`} e ${migratedTotal.toLocaleString("pt-BR")} negociação(ões) movida(s) com segurança.`,
      );
    } else {
      toast.success(deletedCount === 1 ? "Etapa excluída." : `${deletedCount} etapas excluídas.`);
    }
  };

  // Preparar exclusão de funil
  const openDeletePipelineModal = (pipeline: PipelineItem) => {
    const otherPipelines = pipelines.filter(
      (p) => p.id !== pipeline.id && p.stages.length > 0,
    );
    const firstOther = otherPipelines[0];
    const firstStage = firstOther
      ? [...firstOther.stages].sort((a, b) => a.orderIndex - b.orderIndex)[0]
      : undefined;

    setDeletePipelineState({
      pipeline,
      targetPipelineId: firstOther?.id || "",
      targetStageId: firstStage?.id || "",
    });
  };

  const confirmDeletePipeline = async () => {
    if (!deletePipelineState) return;
    const { pipeline, targetStageId } = deletePipelineState;
    const dealsCount =
      pipeline.dealsCount ?? pipeline.stages.reduce((acc, s) => acc + (s.dealsCount || 0), 0);

    if (dealsCount > 0 && !targetStageId) {
      toast.error("Escolha um funil e etapa de destino para migrar as negociações.");
      return;
    }

    const url =
      dealsCount > 0 && targetStageId
        ? `/api/crm/pipelines/${encodeURIComponent(pipeline.id)}?migrateToStageId=${encodeURIComponent(targetStageId)}`
        : `/api/crm/pipelines/${encodeURIComponent(pipeline.id)}`;

    const ok = await run(
      () =>
        requestJson(url, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(targetStageId ? { migrateToStageId: targetStageId } : {}),
        }),
      dealsCount > 0
        ? `Funil excluído e ${dealsCount.toLocaleString("pt-BR")} negociação(ões) migrada(s).`
        : "Funil excluído.",
    );
    if (ok) setDeletePipelineState(null);
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredPipelines = useMemo(() => {
    if (!normalizedQuery) return pipelines;
    return pipelines.filter(
      (p) =>
        p.name.toLowerCase().includes(normalizedQuery) ||
        p.stages.some((s) => s.name.toLowerCase().includes(normalizedQuery)),
    );
  }, [pipelines, normalizedQuery]);

  const totalStagesCount = useMemo(
    () => pipelines.reduce((acc, p) => acc + p.stages.length, 0),
    [pipelines],
  );

  const allCollapsed =
    filteredPipelines.length > 0 &&
    filteredPipelines.every((p) => Boolean(collapsedPipelineIds[p.id]));

  const toggleAllCollapsed = () => {
    if (allCollapsed) {
      setCollapsedPipelineIds({});
    } else {
      const next: Record<string, boolean> = {};
      for (const p of pipelines) next[p.id] = true;
      setCollapsedPipelineIds(next);
    }
  };

  // Dados derivados do modal de exclusão de etapas
  const deletingStageDetails = useMemo(() => {
    if (!deleteStagesState) return null;
    const deletingSet = new Set(deleteStagesState.stageIds);
    const items: Array<{ stage: StageItem; pipelineName: string }> = [];
    for (const p of pipelines) {
      for (const s of p.stages) {
        if (deletingSet.has(s.id)) {
          items.push({ stage: s, pipelineName: p.name });
        }
      }
    }
    const totalDeals = items.reduce((acc, item) => acc + (item.stage.dealsCount || 0), 0);
    const availableTargetPipelines = pipelines
      .map((p) => ({
        ...p,
        availableStages: [...p.stages]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .filter((s) => !deletingSet.has(s.id)),
      }))
      .filter((p) => p.availableStages.length > 0);

    const selectedTargetPipeline =
      availableTargetPipelines.find((p) => p.id === deleteStagesState.targetPipelineId) ||
      availableTargetPipelines[0] ||
      null;

    return {
      items,
      totalDeals,
      availableTargetPipelines,
      selectedTargetPipeline,
    };
  }, [deleteStagesState, pipelines]);

  // Dados derivados do modal de exclusão de funil
  const deletingPipelineDetails = useMemo(() => {
    if (!deletePipelineState) return null;
    const { pipeline } = deletePipelineState;
    const totalDeals =
      pipeline.dealsCount ?? pipeline.stages.reduce((acc, s) => acc + (s.dealsCount || 0), 0);
    const availableTargetPipelines = pipelines
      .filter((p) => p.id !== pipeline.id)
      .map((p) => ({
        ...p,
        availableStages: [...p.stages].sort((a, b) => a.orderIndex - b.orderIndex),
      }))
      .filter((p) => p.availableStages.length > 0);

    const selectedTargetPipeline =
      availableTargetPipelines.find((p) => p.id === deletePipelineState.targetPipelineId) ||
      availableTargetPipelines[0] ||
      null;

    return {
      totalDeals,
      availableTargetPipelines,
      selectedTargetPipeline,
    };
  }, [deletePipelineState, pipelines]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label="Funis de vendas"
    >
      {/* Barra superior com busca, recolher/expandir, exclusão em lote e novo funil */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-3.5">
        <div className="flex items-center gap-3">
          <SystemTooltip content="Voltar para Configurações">
            <button
              type="button"
              onClick={onClose}
              aria-label="Voltar ao CRM"
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-primary cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </SystemTooltip>
          <div>
            <h1 className="text-lg font-bold leading-tight">Funis de vendas</h1>
            <p className="text-xs text-muted-foreground">
              {pipelines.length} {pipelines.length === 1 ? "funil" : "funis"} · {totalStagesCount}{" "}
              {totalStagesCount === 1 ? "etapa" : "etapas"} · Arraste etapas para reordenar
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pipelines.length > 0 && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(ev) => setSearchQuery(ev.target.value)}
                  placeholder="Buscar funil ou etapa..."
                  aria-label="Buscar funil ou etapa"
                  className="h-8 w-48 sm:w-56 rounded-lg border border-border bg-background pl-8 pr-7 text-xs text-foreground outline-none focus:border-primary"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Limpar busca"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <SystemTooltip
                content={allCollapsed ? "Expandir todos os funis" : "Recolher todos os funis"}
              >
                <button
                  type="button"
                  onClick={toggleAllCollapsed}
                  aria-label={allCollapsed ? "Expandir todos os funis" : "Recolher todos os funis"}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                >
                  {allCollapsed ? (
                    <>
                      <ChevronsUpDown className="h-3.5 w-3.5" />
                      <span className="hidden md:inline">Expandir todos</span>
                    </>
                  ) : (
                    <>
                      <ChevronsDownUp className="h-3.5 w-3.5" />
                      <span className="hidden md:inline">Recolher todos</span>
                    </>
                  )}
                </button>
              </SystemTooltip>
            </>
          )}

          {selectedStages.length > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const firstPipeline = pipelines.find((p) =>
                    p.stages.some((s) => selectedStages.includes(s.id)),
                  );
                  openDeleteStagesModal(selectedStages, firstPipeline?.id ?? null);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive hover:underline disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir {selectedStages.length} selecionada(s)
              </button>
              <SystemTooltip content="Limpar seleção">
                <button
                  type="button"
                  onClick={() => setSelectedStages([])}
                  aria-label="Limpar seleção de etapas"
                  className="rounded p-0.5 text-destructive/80 hover:bg-destructive/15 hover:text-destructive cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setPipelineDraft({
                id: null,
                name: "",
                coolingDays: 10,
                isDefault: pipelines.length === 0,
              })
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" /> Novo funil
          </button>
        </div>
      </header>

      {/* Lista de Funis */}
      <main className="flex-1 overflow-y-auto px-5 pb-12 pt-5">
        {loading && pipelines.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando funis...
          </div>
        ) : pipelines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <p className="font-semibold">Nenhum funil cadastrado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie um funil para começar a organizar as negociações.
            </p>
          </div>
        ) : filteredPipelines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-semibold">
              Nenhum funil ou etapa encontrado para “{searchQuery}”
            </p>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="mt-2 text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              Limpar filtro de busca
            </button>
          </div>
        ) : (
          filteredPipelines.map((pipeline) => {
            const realIndex = pipelines.findIndex((p) => p.id === pipeline.id);
            return (
              <PipelineStagesRow
                key={pipeline.id}
                pipeline={pipeline}
                pipelineIndex={realIndex}
                totalPipelines={pipelines.length}
                collapsed={Boolean(collapsedPipelineIds[pipeline.id])}
                onToggleCollapse={() =>
                  setCollapsedPipelineIds((prev) => ({
                    ...prev,
                    [pipeline.id]: !prev[pipeline.id],
                  }))
                }
                onMovePipeline={(dir) => void movePipeline(pipeline.id, dir)}
                onEditPipeline={() =>
                  setPipelineDraft({
                    id: pipeline.id,
                    name: pipeline.name,
                    coolingDays: pipeline.coolingDays,
                    isDefault: pipeline.isDefault,
                  })
                }
                onRequestDeletePipeline={() => openDeletePipelineModal(pipeline)}
                settingsByStage={settingsByStage}
                selectedStages={selectedStages}
                onToggleSelectStage={(stageId, checked) =>
                  setSelectedStages((current) =>
                    checked ? [...current, stageId] : current.filter((id) => id !== stageId),
                  )
                }
                onOpenStageSettings={(stage) => openStage(pipeline, stage)}
                onRequestDeleteStage={(stage) => openDeleteStagesModal([stage.id], pipeline.id)}
                onToggleCooling={(stage, enabled) => void toggleCooling(pipeline, stage, enabled)}
                onUpdateCoolingDays={(stage, days) => void updateCoolingDays(pipeline, stage, days)}
                onRenameStageInline={(stage, nextName) => renameStageInline(stage, nextName)}
                onCommitStageOrder={(orderedStages) =>
                  void commitStageOrder(pipeline.id, orderedStages)
                }
                addingStage={addingStage}
                newStageName={newStageName}
                onNewStageNameChange={setNewStageName}
                onStartAddStage={(insertAtIndex) => {
                  setAddingStage({ pipelineId: pipeline.id, insertAtIndex });
                  setNewStageName("");
                }}
                onCancelAddStage={() => {
                  setAddingStage(null);
                  setNewStageName("");
                }}
                onSubmitAddStage={(ev) => void addStage(ev)}
                busy={busy}
                highlightStageQuery={normalizedQuery}
                sectionRef={(el) => {
                  sectionRefs.current[pipeline.id] = el;
                }}
              />
            );
          })
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setPipelineDraft({
              id: null,
              name: "",
              coolingDays: 10,
              isDefault: pipelines.length === 0,
            })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Adicionar funil de vendas
        </button>
      </main>

      {/* Modal de Criar / Configurar Funil */}
      <Dialog
        open={pipelineDraft !== null}
        onOpenChange={(open) => !open && setPipelineDraft(null)}
      >
        <DialogContent className="max-w-md bg-card">
          <DialogHeader>
            <DialogTitle>
              {pipelineDraft?.id ? "Configurar funil" : "Adicionar funil de vendas"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={(event) => void savePipeline(event)} className="space-y-4 text-xs">
            <label className="block space-y-1.5 font-semibold">
              Nome do funil
              <input
                autoFocus
                required
                maxLength={120}
                value={pipelineDraft?.name || ""}
                onChange={(event) =>
                  setPipelineDraft((current) => current && { ...current, name: event.target.value })
                }
                className="h-9 w-full rounded-lg border border-input bg-background px-3 font-normal"
              />
            </label>
            <label className="block space-y-1.5 font-semibold">
              Alerta padrão de esfriamento (dias)
              <div className="relative flex items-center">
                <input
                  type="text"
                  inputMode="numeric"
                  value={pipelineDraft?.coolingDays ?? 10}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, "");
                    setPipelineDraft(
                      (current) =>
                        current && {
                          ...current,
                          coolingDays: digits ? Math.min(365, Math.max(1, Number(digits))) : 1,
                        },
                    );
                  }}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 pr-16 font-normal"
                />
                <div className="absolute right-1.5 flex items-center gap-1">
                  <SystemTooltip content="Diminuir dias (-1)">
                    <button
                      type="button"
                      onClick={() =>
                        setPipelineDraft(
                          (current) =>
                            current && {
                              ...current,
                              coolingDays: Math.max(1, (current.coolingDays ?? 10) - 1),
                            },
                        )
                      }
                      className="flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                  <SystemTooltip content="Aumentar dias (+1)">
                    <button
                      type="button"
                      onClick={() =>
                        setPipelineDraft(
                          (current) =>
                            current && {
                              ...current,
                              coolingDays: Math.min(365, (current.coolingDays ?? 10) + 1),
                            },
                        )
                      }
                      className="flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                </div>
              </div>
            </label>

            <label className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2.5 font-medium cursor-pointer">
              <Checkbox
                checked={Boolean(pipelineDraft?.isDefault)}
                onCheckedChange={(checked) =>
                  setPipelineDraft(
                    (current) => current && { ...current, isDefault: Boolean(checked) },
                  )
                }
              />
              <span>Definir como funil principal padrão</span>
            </label>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setPipelineDraft(null)}
                className="rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || !pipelineDraft?.name.trim()}
                className="rounded-lg bg-primary px-3 py-2 font-bold text-primary-foreground disabled:opacity-50 cursor-pointer"
              >
                Salvar
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Customizado de Exclusão de Etapa(s) com Migração Segura de Negociações */}
      <Dialog
        open={deleteStagesState !== null}
        onOpenChange={(open) => !open && !busy && setDeleteStagesState(null)}
      >
        <DialogContent className="max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-4 w-4 text-destructive" />
              {deleteStagesState && deleteStagesState.stageIds.length > 1
                ? `Excluir ${deleteStagesState.stageIds.length} etapas selecionadas`
                : "Excluir etapa do funil"}
            </DialogTitle>
          </DialogHeader>

          {deletingStageDetails && deleteStagesState && (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-border bg-background/60 p-3">
                <p className="font-semibold text-foreground">
                  {deletingStageDetails.items.length === 1
                    ? `Etapa: ${deletingStageDetails.items[0].stage.name} (${deletingStageDetails.items[0].pipelineName})`
                    : "Etapas selecionadas para exclusão:"}
                </p>
                {deletingStageDetails.items.length > 1 && (
                  <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-muted-foreground">
                    {deletingStageDetails.items.map(({ stage, pipelineName }) => (
                      <li key={stage.id} className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-foreground">
                          {pipelineName} → {stage.name}
                        </span>
                        <span className="shrink-0">
                          {(stage.dealsCount || 0).toLocaleString("pt-BR")} negociação(ões)
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {deletingStageDetails.totalDeals === 0 ? (
                <p className="text-muted-foreground leading-relaxed">
                  Nenhuma negociação está vinculada a{" "}
                  {deletingStageDetails.items.length === 1 ? "esta etapa" : "estas etapas"}. A
                  exclusão é permanente e reorganizará automaticamente a numeração do funil.
                </p>
              ) : deletingStageDetails.availableTargetPipelines.length === 0 ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      Não há outra etapa disponível para receber as{" "}
                      {deletingStageDetails.totalDeals.toLocaleString("pt-BR")} negociações.
                    </p>
                    <p className="mt-1 text-[11px] opacity-90">
                      Crie ao menos uma nova etapa antes de excluir esta para não perder o histórico
                      das negociações.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="font-semibold text-foreground">
                        Transferência automática de{" "}
                        {deletingStageDetails.totalDeals.toLocaleString("pt-BR")}{" "}
                        {deletingStageDetails.totalDeals === 1 ? "negociação" : "negociações"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Escolha para qual funil e etapa as negociações existentes devem ser movidas
                        antes da exclusão:
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <span className="block font-semibold text-foreground">Funil de destino</span>
                      <Select
                        value={deletingStageDetails.selectedTargetPipeline?.id || ""}
                        onValueChange={(nextPipeId) => {
                          const found = deletingStageDetails.availableTargetPipelines.find(
                            (p) => p.id === nextPipeId,
                          );
                          setDeleteStagesState((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  targetPipelineId: nextPipeId,
                                  targetStageId: found?.availableStages[0]?.id || "",
                                }
                              : null,
                          );
                        }}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Selecione o funil" />
                        </SelectTrigger>
                        <SelectContent>
                          {deletingStageDetails.availableTargetPipelines.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <span className="block font-semibold text-foreground">Etapa de destino</span>
                      <Select
                        value={deleteStagesState.targetStageId}
                        onValueChange={(nextStageId) =>
                          setDeleteStagesState((prev) =>
                            prev ? { ...prev, targetStageId: nextStageId } : null,
                          )
                        }
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Selecione a etapa" />
                        </SelectTrigger>
                        <SelectContent>
                          {(deletingStageDetails.selectedTargetPipeline?.availableStages || []).map(
                            (s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleteStagesState(null)}
                  className="rounded-lg px-3 py-2 font-medium text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    (deletingStageDetails.totalDeals > 0 &&
                      (!deleteStagesState.targetStageId ||
                        deletingStageDetails.availableTargetPipelines.length === 0))
                  }
                  onClick={() => void confirmDeleteStages()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3.5 py-2 font-bold text-white hover:opacity-90 disabled:opacity-40 cursor-pointer"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  {deletingStageDetails.totalDeals > 0
                    ? `Mover ${deletingStageDetails.totalDeals.toLocaleString("pt-BR")} e excluir`
                    : "Confirmar exclusão"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Customizado de Exclusão de Funil */}
      <Dialog
        open={deletePipelineState !== null}
        onOpenChange={(open) => !open && !busy && setDeletePipelineState(null)}
      >
        <DialogContent className="max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-4 w-4 text-destructive" />
              Excluir funil “{deletePipelineState?.pipeline.name}”
            </DialogTitle>
          </DialogHeader>

          {deletingPipelineDetails && deletePipelineState && (
            <div className="space-y-4 text-xs">
              {deletingPipelineDetails.totalDeals === 0 ? (
                <p className="text-muted-foreground leading-relaxed">
                  Este funil não possui negociações vinculadas. Todas as{" "}
                  {deletePipelineState.pipeline.stages.length} etapas dele serão removidas
                  permanentemente.
                </p>
              ) : deletingPipelineDetails.availableTargetPipelines.length === 0 ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      Existem {deletingPipelineDetails.totalDeals.toLocaleString("pt-BR")}{" "}
                      negociações neste funil e nenhum outro funil com etapas para recebê-las.
                    </p>
                    <p className="mt-1 text-[11px] opacity-90">
                      Crie outro funil com pelo menos uma etapa antes de excluir este funil.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="font-semibold text-foreground">
                        Este funil possui{" "}
                        {deletingPipelineDetails.totalDeals.toLocaleString("pt-BR")} negociação(ões)
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Selecione para qual funil e etapa todas as negociações devem ser migradas
                        antes de excluir:
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <span className="block font-semibold text-foreground">Funil de destino</span>
                      <Select
                        value={deletingPipelineDetails.selectedTargetPipeline?.id || ""}
                        onValueChange={(nextPipeId) => {
                          const found = deletingPipelineDetails.availableTargetPipelines.find(
                            (p) => p.id === nextPipeId,
                          );
                          setDeletePipelineState((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  targetPipelineId: nextPipeId,
                                  targetStageId: found?.availableStages[0]?.id || "",
                                }
                              : null,
                          );
                        }}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Selecione o funil" />
                        </SelectTrigger>
                        <SelectContent>
                          {deletingPipelineDetails.availableTargetPipelines.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <span className="block font-semibold text-foreground">Etapa de destino</span>
                      <Select
                        value={deletePipelineState.targetStageId}
                        onValueChange={(nextStageId) =>
                          setDeletePipelineState((prev) =>
                            prev ? { ...prev, targetStageId: nextStageId } : null,
                          )
                        }
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Selecione a etapa" />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            deletingPipelineDetails.selectedTargetPipeline?.availableStages || []
                          ).map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDeletePipelineState(null)}
                  className="rounded-lg px-3 py-2 font-medium text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    (deletingPipelineDetails.totalDeals > 0 &&
                      (!deletePipelineState.targetStageId ||
                        deletingPipelineDetails.availableTargetPipelines.length === 0))
                  }
                  onClick={() => void confirmDeletePipeline()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3.5 py-2 font-bold text-white hover:opacity-90 disabled:opacity-40 cursor-pointer"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  {deletingPipelineDetails.totalDeals > 0
                    ? `Migrar ${deletingPipelineDetails.totalDeals.toLocaleString("pt-BR")} e excluir funil`
                    : "Excluir funil"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Gaveta lateral direita: Configuração detalhada da etapa */}
      <Sheet open={stageDraft !== null} onOpenChange={(open) => !open && setStageDraft(null)}>
        <SheetContent
          side="right"
          className="grid w-full max-w-[440px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-card p-0 sm:max-w-[440px]"
        >
          <SheetHeader className="border-b border-border px-5 py-5">
            <SheetTitle className="text-base">Configuração da etapa</SheetTitle>
          </SheetHeader>
          {stageDraft && (
            <form onSubmit={(event) => void saveStage(event)} className="flex min-h-0 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 text-xs">
                <label className="block space-y-1.5 font-semibold">
                  Nome da etapa *
                  <input
                    required
                    maxLength={120}
                    value={stageDraft.name}
                    onChange={(event) =>
                      setStageDraft(
                        (current) => current && { ...current, name: event.target.value },
                      )
                    }
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 font-normal"
                  />
                </label>
                <label className="block space-y-1.5 font-semibold">
                  Sigla
                  <input
                    maxLength={12}
                    value={stageDraft.abbreviation}
                    onChange={(event) =>
                      setStageDraft(
                        (current) => current && { ...current, abbreviation: event.target.value },
                      )
                    }
                    placeholder="Ex.: QLF"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 font-normal"
                  />
                </label>
                <label className="block space-y-1.5 font-semibold">
                  Objetivo da etapa
                  <textarea
                    maxLength={200}
                    rows={3}
                    value={stageDraft.objective}
                    onChange={(event) =>
                      setStageDraft(
                        (current) => current && { ...current, objective: event.target.value },
                      )
                    }
                    placeholder="O que você quer alcançar nesta etapa?"
                    className="w-full resize-y rounded-lg border border-input bg-background p-3 font-normal"
                  />
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    Até 200 caracteres.
                  </span>
                </label>
                <label className="block space-y-1.5 font-semibold">
                  Descrição da etapa
                  <textarea
                    maxLength={1500}
                    rows={6}
                    value={stageDraft.description}
                    onChange={(event) =>
                      setStageDraft(
                        (current) => current && { ...current, description: event.target.value },
                      )
                    }
                    placeholder="Orientações para o time de vendas nesta etapa"
                    className="w-full resize-y rounded-lg border border-input bg-background p-3 font-normal"
                  />
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    Até 1.500 caracteres.
                  </span>
                </label>
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <label className="flex items-center justify-between gap-3 font-semibold">
                    <span>Destacar negociações esfriando</span>
                    <Switch
                      checked={stageDraft.coolingEnabled}
                      onCheckedChange={(checked) =>
                        setStageDraft(
                          (current) => current && { ...current, coolingEnabled: checked },
                        )
                      }
                    />
                  </label>
                  {stageDraft.coolingEnabled && (
                    <label className="block space-y-1.5 font-semibold">
                      Dias sem interação
                      <div className="relative flex items-center">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={stageDraft.coolingDays}
                          onChange={(event) => {
                            const digits = event.target.value.replace(/\D/g, "");
                            setStageDraft(
                              (current) =>
                                current && {
                                  ...current,
                                  coolingDays: digits
                                    ? Math.min(365, Math.max(1, Number(digits)))
                                    : 1,
                                },
                            );
                          }}
                          className="h-9 w-full rounded-lg border border-input bg-background px-3 pr-16 font-normal"
                        />
                        <div className="absolute right-1.5 flex items-center gap-1">
                          <SystemTooltip content="Diminuir dias (-1)">
                            <button
                              type="button"
                              onClick={() =>
                                setStageDraft(
                                  (current) =>
                                    current && {
                                      ...current,
                                      coolingDays: Math.max(1, (current.coolingDays ?? 10) - 1),
                                    },
                                )
                              }
                              className="flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>
                          <SystemTooltip content="Aumentar dias (+1)">
                            <button
                              type="button"
                              onClick={() =>
                                setStageDraft(
                                  (current) =>
                                    current && {
                                      ...current,
                                      coolingDays: Math.min(365, (current.coolingDays ?? 10) + 1),
                                    },
                                )
                              }
                              className="flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>
                        </div>
                      </div>
                    </label>
                  )}
                </div>
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <p className="font-semibold">Campos exigidos para entrar nesta etapa</p>
                  <p className="text-[11px] text-muted-foreground">
                    Ao mover uma negociação, os campos selecionados devem estar preenchidos.
                  </p>
                  {dealCustomFields
                    .filter(
                      (field) =>
                        field.allPipelines || field.pipelineIds.includes(stageDraft.pipelineId),
                    )
                    .map((field) => (
                      <label key={field.id} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={stageDraft.requiredFields.includes(field.id)}
                          onCheckedChange={(checked) =>
                            setStageDraft(
                              (current) =>
                                current && {
                                  ...current,
                                  requiredFields: checked
                                    ? [...current.requiredFields, field.id]
                                    : current.requiredFields.filter((id) => id !== field.id),
                                },
                            )
                          }
                        />{" "}
                        {field.name}
                      </label>
                    ))}
                  {dealCustomFields.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Crie campos personalizados em Configurar campos de cadastro.
                    </p>
                  )}
                </div>
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <p className="font-semibold">Resultado da etapa</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={stageDraft.isWinStage}
                      onCheckedChange={(checked) =>
                        setStageDraft(
                          (current) =>
                            current && {
                              ...current,
                              isWinStage: !!checked,
                              isLossStage: checked ? false : current.isLossStage,
                            },
                        )
                      }
                    />{" "}
                    Etapa de ganho
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={stageDraft.isLossStage}
                      onCheckedChange={(checked) =>
                        setStageDraft(
                          (current) =>
                            current && {
                              ...current,
                              isLossStage: !!checked,
                              isWinStage: checked ? false : current.isWinStage,
                            },
                        )
                      }
                    />{" "}
                    Etapa de perda
                  </label>
                </div>
                <div className="space-y-2.5 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">Motivos de perda exclusivos desta etapa</p>
                    {stageDraft.lossReasonNames.length > 0 && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                        {stageDraft.lossReasonNames.length} selecionado(s)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-normal text-muted-foreground">
                    Quando a restrição por etapa estiver ativa em Motivos de Perda, os negócios
                    nesta etapa exibirão apenas os motivos marcados abaixo (ou os do funil/globais
                    se nenhum for marcado).
                  </p>
                  {lossReasonItems.length === 0 ? (
                    <p className="text-[11px] font-normal text-muted-foreground">
                      Nenhum motivo de perda cadastrado.
                    </p>
                  ) : (
                    <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1 pt-1">
                      {lossReasonItems.map((reason) => {
                        const checked = stageDraft.lossReasonNames.includes(reason.name);
                        return (
                          <label
                            key={reason.id}
                            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs font-normal hover:bg-muted/40 cursor-pointer"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(nextChecked) =>
                                setStageDraft(
                                  (current) =>
                                    current && {
                                      ...current,
                                      lossReasonNames: nextChecked
                                        ? Array.from(
                                            new Set([...current.lossReasonNames, reason.name]),
                                          )
                                        : current.lossReasonNames.filter((n) => n !== reason.name),
                                    },
                                )
                              }
                            />
                            <span className="truncate">{reason.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <SheetFooter className="flex items-center justify-between gap-2 border-t border-border px-5 py-4 sm:justify-between">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openDeleteStagesModal([stageDraft.id], stageDraft.pipelineId)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Excluir etapa
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStageDraft(null)}
                    className="rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={
                      busy ||
                      !stageDraft.name.trim() ||
                      stageDraft.coolingDays < 1 ||
                      stageDraft.coolingDays > 365
                    }
                    className="rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50 cursor-pointer"
                  >
                    Salvar
                  </button>
                </div>
              </SheetFooter>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
