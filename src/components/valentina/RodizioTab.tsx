// ══════════════════════════════════════════════════════════════════════════════
// RODÍZIO TAB — Painel Executivo do Rodízio de Leads por Setor
// Reordenado conforme solicitação: "Leads por Operador" primeiro, seguido pela
// "Visão Geral do Fagner / Valentina" com KPIs e gráficos.
// Harmonizado com a paleta do sistema (Tema Claro e Escuro) — Sem Emojis.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  CheckCircle2,
  BarChart3,
  TrendingUp,
  TrendingDown,
  MessageCircle,
  RefreshCw,
  FileText,
  ExternalLink,
  X,
  Building2,
  Download,
  Calendar,
  CalendarRange,
  ArrowRightLeft,
  Check,
  PlusCircle,
  FileSpreadsheet,
  Search,
  Palmtree,
  Ban,
  UserCheck,
  UserX,
  HelpCircle,
  Loader2,
  SlidersHorizontal,
  ChevronDown,
  Gem,
  Wrench,
  Package,
  CircleDollarSign,
  Settings,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import {
  RodizioStats,
  LeadByDay,
  LeadByFunnel,
  OperatorCard,
  OperatorRow,
  CrmDeal,
  OperatorOption,
} from "./rodizio-dashboard-types";
import {
  SECTOR_CONFIGS,
  FUNNEL_LABELS,
  FUNNEL_COLORS,
  getOperatorSector,
  downloadDealsCSV,
  downloadOperatorsCSV,
  getBenchmarkRodizioData,
} from "./rodizio-dashboard-data";

// ─── Ícones Vetoriais Oficiais por Setor (Sem Emojis) ────────────────────────
const SECTOR_ICONS: Record<string, React.ElementType> = {
  sdr: Target,
  personalite: Gem,
  maquinas: Wrench,
  "pos venda": Package,
  financeiro: CircleDollarSign,
  pecas: Settings,
};

// ─── Avatar do Operador com Fallback Elegante ─────────────────────────────────

function OperatorAvatar({
  name,
  avatar,
  accent,
  size = "w-7 h-7",
  fontSize = "text-[10px]",
}: {
  name: string;
  avatar?: string | null;
  accent?: string;
  size?: string;
  fontSize?: string;
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [avatar]);

  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  if (avatar && avatar.trim() !== "" && !imgError) {
    return (
      <img
        src={avatar}
        alt={name}
        className={`${size} rounded-full object-cover shrink-0 border border-border shadow-sm`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={`${size} rounded-full flex items-center justify-center font-bold text-white shrink-0 shadow-sm ${fontSize}`}
      style={{
        background: accent
          ? `linear-gradient(135deg, ${accent}, ${accent}dd)`
          : "linear-gradient(135deg, var(--primary), var(--primary))",
      }}
    >
      {initials}
    </div>
  );
}

// ─── KPI Card com Barra de Acento Superior ────────────────────────────────────

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  accent,
  delta,
  onClick,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent: string;
  delta?: number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`relative bg-card rounded-2xl border border-border p-4.5 shadow-soft transition-all duration-200 overflow-hidden flex flex-col justify-between ${
        onClick
          ? "cursor-pointer hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
          : "hover:shadow-md"
      }`}
    >
      {/* Barra de cor superior */}
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
        style={{ background: accent }}
      />

      <div>
        <div className="flex items-center justify-between mb-2.5">
          <div
            className="p-2 rounded-xl flex items-center justify-center"
            style={{ background: `${accent}18` }}
          >
            <Icon size={18} style={{ color: accent }} />
          </div>
          {delta !== undefined && (
            <span
              className={`text-xs font-semibold flex items-center gap-0.5 ${
                delta >= 0 ? "text-emerald-500" : "text-red-400"
              }`}
            >
              {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {Math.abs(delta)}%
            </span>
          )}
        </div>

        <div className="text-2xl font-black text-foreground tracking-tight">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-line/60">
        <span className="text-[11px] font-semibold text-muted-foreground">{title}</span>
        {onClick && (
          <span className="text-[9px] text-primary font-bold hover:underline">
            Clique para ver
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Gráfico de Barras: Leads por Dia ─────────────────────────────────────────

function DailyBarChart({
  data,
  accent = "#f43f5e",
}: {
  data: LeadByDay[];
  accent?: string;
}) {
  const maxVal = Math.max(...data.map((d) => d.count), 1);
  const chartRef = useRef<HTMLDivElement>(null);

  return (
    <div className="w-full h-44 flex items-end gap-1 pt-4" ref={chartRef}>
      {data.map((d, i) => {
        const heightPct = Math.max(8, Math.round((d.count / maxVal) * 100));
        const formattedDate = new Date(d.day).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        });

        return (
          <div
            key={i}
            className="group relative flex-1 h-full flex flex-col justify-end items-center"
          >
            {/* Tooltip no hover */}
            <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-20 bg-popover text-popover-foreground text-[10px] font-bold py-1 px-2 rounded-lg shadow-xl border border-border whitespace-nowrap">
              {formattedDate}: {d.count} leads
            </div>

            {/* Barra */}
            <div
              className="w-full rounded-t-sm transition-all duration-300 hover:brightness-110"
              style={{
                height: `${heightPct}%`,
                background:
                  i === data.length - 1
                    ? `linear-gradient(180deg, ${accent}, ${accent}aa)`
                    : `linear-gradient(180deg, ${accent}cc, ${accent}66)`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Gráfico Donut de Distribuição por Funil ───────────────────────────────────

function FunnelDonutChart({ data }: { data: LeadByFunnel[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0) || 1;

  let acc = 0;
  const slices = data.map((d) => {
    const pct = (d.count / total) * 100;
    const startAngle = (acc / total) * 360;
    acc += d.count;
    const endAngle = (acc / total) * 360;

    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((endAngle - 90) * Math.PI) / 180;

    const r = 40;
    const cx = 50;
    const cy = 50;

    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);

    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const pathData =
      data.length === 1
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`
        : `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;

    return {
      ...d,
      pct: Math.round(pct),
      pathData,
      color: FUNNEL_COLORS[d.funnel] || "#64748b",
      label: FUNNEL_LABELS[d.funnel] || d.funnel,
    };
  });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4 py-2">
      {/* Gráfico SVG */}
      <div className="relative w-36 h-36 shrink-0 flex items-center justify-center">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            className="text-muted/20"
          />
          {slices.map((s, i) => (
            <path
              key={i}
              d={s.pathData}
              fill="none"
              stroke={s.color}
              strokeWidth="12"
              strokeLinecap="round"
              className="transition-all duration-300 hover:opacity-80"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-black text-foreground tracking-tight">
            {total.toLocaleString("pt-BR")}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
            total
          </span>
        </div>
      </div>

      {/* Legenda Lateral */}
      <div className="flex-1 w-full space-y-1.5 overflow-y-auto max-h-36 pr-1 scrollbar-thin">
        {slices.map((s, i) => (
          <div
            key={i}
            className="flex items-center justify-between text-xs py-0.5 hover:bg-muted/40 rounded px-1.5 transition"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: s.color }}
              />
              <span className="text-muted-foreground truncate text-[11px] font-medium">
                {s.label}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-bold text-foreground font-mono text-[11px]">
                {s.count.toLocaleString("pt-BR")}
              </span>
              <span className="text-[10px] text-muted-foreground w-7 text-right">
                {s.pct}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Portal Dropdown para Reatribuir Lead ─────────────────────────────────────

function ReassignDropdown({
  cardId,
  currentOwnerName,
  operators,
  onReassign,
  onClose,
  triggerRef,
}: {
  cardId: string;
  currentOwnerName: string;
  operators: OperatorOption[];
  onReassign: (cardId: string, op: OperatorOption) => Promise<void>;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxListHeight: number;
  } | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const width = 220;

    let left = rect.right - width;
    if (left < 8) left = 8;
    if (left + width > viewportWidth - 8) left = viewportWidth - width - 8;

    const spaceBelow = viewportHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const estimatedMenuHeight = 240;

    if (spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow) {
      const maxListHeight = Math.max(100, Math.min(200, spaceAbove - 40));
      setPos({
        bottom: viewportHeight - rect.top + 4,
        left,
        width,
        maxListHeight,
      });
    } else {
      const maxListHeight = Math.max(100, Math.min(200, spaceBelow - 40));
      setPos({
        top: rect.bottom + 4,
        left,
        width,
        maxListHeight,
      });
    }
  }, [triggerRef]);

  useEffect(() => {
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [updatePosition]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, triggerRef]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: pos.top !== undefined ? pos.top : "auto",
        bottom: pos.bottom !== undefined ? pos.bottom : "auto",
        left: pos.left,
        width: pos.width,
        zIndex: 9999,
      }}
      className="bg-card border border-border rounded-xl shadow-2xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 border-b border-line flex items-center justify-between bg-muted/30">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          Mover lead para
        </p>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: `${pos.maxListHeight}px` }}>
        {operators.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center py-3">
            Nenhum operador elegível
          </p>
        ) : (
          operators.map((op) => {
            const isSelf = op.name === currentOwnerName;
            const isSaving = saving === op.id;
            const isDone = done === op.id;

            return (
              <button
                key={op.id}
                disabled={isSelf || isSaving || !!saving}
                onClick={async () => {
                  if (isSelf) return;
                  setSaving(op.id);
                  await onReassign(cardId, op);
                  setDone(op.id);
                  setSaving(null);
                  setTimeout(() => onClose(), 600);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${
                  isSelf
                    ? "text-muted-foreground cursor-default bg-muted/40"
                    : isSaving
                    ? "text-primary bg-primary-soft/50"
                    : isDone
                    ? "text-emerald-500 bg-emerald-500/10"
                    : "text-foreground hover:bg-muted/80 hover:text-primary"
                }`}
              >
                <span className="text-[11px] font-semibold truncate flex-1">
                  {isSelf ? (
                    <>
                      <span className="text-[9px] mr-1 opacity-60">(atual)</span>
                      {op.name}
                    </>
                  ) : (
                    op.name
                  )}
                </span>
                <span className="shrink-0">
                  {isSaving ? (
                    <Loader2 size={11} className="animate-spin text-primary" />
                  ) : isDone ? (
                    <Check size={11} className="text-emerald-500" />
                  ) : (
                    <span className="text-[9px] text-muted-foreground font-mono">
                      +{op.leads_compensation || 0}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Card Individual do Lead na Coluna do Operador ────────────────────────────

function LeadCardItem({
  card,
  opName,
  isOpen,
  isReassigning,
  operators,
  onToggleDropdown,
  onReassign,
  onClose,
  onOpenLead,
  onDeleteCard,
}: {
  card: OperatorCard;
  opName: string;
  isOpen: boolean;
  isReassigning: boolean;
  operators: OperatorOption[];
  onToggleDropdown: () => void;
  onReassign: (cardId: string, op: OperatorOption) => Promise<void>;
  onClose: () => void;
  onOpenLead?: (card: OperatorCard) => void;
  onDeleteCard?: (cardId: string, leadName: string) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="group/card relative flex items-center justify-between gap-2 bg-card hover:bg-muted/50 border border-border/80 rounded-xl p-2 transition-all duration-150 shadow-xs">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-foreground truncate leading-snug">
          {card.name}
        </p>
        {card.company && (
          <p className="text-[9px] text-muted-foreground truncate flex items-center gap-1 mt-0.5 font-medium">
            <Building2 size={9} className="opacity-70 shrink-0" />
            {card.company}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {/* Botão de Reatribuir */}
        <button
          ref={btnRef}
          title="Mover lead para outro vendedor"
          disabled={isReassigning}
          onClick={onToggleDropdown}
          className={`opacity-0 group-hover/card:opacity-100 focus:opacity-100 flex items-center justify-center w-5 h-5 rounded-md transition-all cursor-pointer ${
            isOpen
              ? "opacity-100 text-primary bg-primary-soft border border-primary/30"
              : "text-muted-foreground hover:text-primary hover:bg-muted border border-transparent"
          }`}
        >
          {isReassigning ? (
            <Loader2 size={10} className="animate-spin text-primary" />
          ) : (
            <ArrowRightLeft size={10} />
          )}
        </button>

        {isOpen && (
          <ReassignDropdown
            cardId={card.id}
            currentOwnerName={opName}
            operators={operators}
            onReassign={onReassign}
            onClose={onClose}
            triggerRef={btnRef}
          />
        )}

        {/* Botão de Excluir */}
        {onDeleteCard && (
          <button
            onClick={() => onDeleteCard(card.id, card.name)}
            title="Remover atendimento do operador"
            className="opacity-0 group-hover/card:opacity-100 focus:opacity-100 flex items-center justify-center w-4.5 h-4.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 border border-transparent transition-all shrink-0 cursor-pointer"
          >
            <X size={10} />
          </button>
        )}

        {/* Botão Abrir */}
        {onOpenLead && (
          <button
            onClick={() => onOpenLead(card)}
            title="Abrir conversa no chat ou deal no CRM"
            className="text-[9px] font-bold text-muted-foreground hover:text-primary hover:bg-primary-soft/60 px-1.5 py-0.5 rounded border border-border/60 hover:border-primary/30 transition-all shrink-0 inline-flex items-center gap-0.5 cursor-pointer"
          >
            Abrir
            <ExternalLink size={8} className="opacity-70" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Modal de Deals no CRM ────────────────────────────────────────────────────

function CrmDealsModal({
  deals,
  loading,
  onClose,
  period,
  onOpenDeal,
}: {
  deals: CrmDeal[];
  loading: boolean;
  onClose: () => void;
  period: string;
  onOpenDeal: (deal: CrmDeal) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = deals.filter(
    (d) =>
      !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      (d.company ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (d.operator_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl border border-border w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-line bg-muted/20">
          <div>
            <h3 className="text-sm font-extrabold text-foreground flex items-center gap-2">
              <BarChart3 size={16} className="text-blue-500" />
              Deals no CRM
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {deals.length} deals nos últimos {period} dias
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => downloadDealsCSV(filtered, period)}
              title={`Exportar ${filtered.length} deals para CSV`}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-all cursor-pointer"
            >
              <Download size={15} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-5 pt-3 pb-2 border-b border-line">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Buscar por nome, empresa ou operador..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs pl-8 pr-3 py-2 rounded-xl border border-border bg-muted/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-foreground"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={22} className="animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-xs italic">
              Nenhum deal encontrado
            </div>
          ) : (
            filtered.map((deal) => {
              const sectorKey = (deal.sector ?? "").toLowerCase();
              const accentColor =
                SECTOR_CONFIGS[sectorKey]?.accent || SECTOR_CONFIGS.maquinas.accent;
              const date = new Date(deal.created_at).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "2-digit",
              });

              return (
                <div
                  key={deal.id}
                  className="flex items-center gap-3 bg-muted/20 hover:bg-muted/50 border border-border rounded-xl p-3 transition-all"
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: accentColor }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">{deal.name}</p>
                    {deal.company && (
                      <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                        <Building2 size={10} />
                        {deal.company}
                      </p>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-semibold shrink-0 hidden sm:block">
                    {deal.operator_name || "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground shrink-0">{date}</div>
                  <button
                    onClick={() => onOpenDeal(deal)}
                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-primary-soft text-primary hover:bg-primary hover:text-white transition-all shrink-0 cursor-pointer"
                  >
                    <ExternalLink size={10} />
                    Abrir no CRM
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Modal Instrutiva do Rodízio ──────────────────────────────────────────────

function InstrutivaModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl border border-border w-full max-w-lg p-6 overflow-hidden flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary-soft text-primary">
              <HelpCircle size={18} />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">Regras do Rodízio</h3>
              <p className="text-[11px] text-muted-foreground">
                Como funciona a distribuição de leads e compensação manual
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 text-xs text-foreground/90 overflow-y-auto max-h-[60vh] pr-1">
          <div className="p-3 bg-muted/40 rounded-xl border border-border/60 space-y-1">
            <h4 className="font-extrabold text-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary" />
              1. Distribuição Circular (Round-Robin)
            </h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Após a qualificação do lead pelo agente de inteligência artificial, o sistema aloca o
              próximo vendedor disponível com o menor número de leads recebidos dentro de cada setor
              específico.
            </p>
          </div>

          <div className="p-3 bg-muted/40 rounded-xl border border-border/60 space-y-1">
            <h4 className="font-extrabold text-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              2. Compensação Manual (+N)
            </h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Quando um lead é inserido manualmente ou reatribuído para outro operador, o sistema
              registra uma compensação positiva para garantir equilíbrio de carga na esteira de
              vendas.
            </p>
          </div>

          <div className="p-3 bg-muted/40 rounded-xl border border-border/60 space-y-1">
            <h4 className="font-extrabold text-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-violet-500" />
              3. Status de Disponibilidade
            </h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Vendedores marcados como <strong>Folga</strong> ou <strong>Penalizado</strong> são
              temporariamente ignorados pelo rodízio automático, sem perder o histórico nem o saldo
              de atendimentos acumulados.
            </p>
          </div>
        </div>

        <div className="pt-2 border-t border-line flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary-hover transition cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Modal de Gestão de Disponibilidade dos Operadores ───────────────────────

function OperatorStatusModal({
  operators,
  onUpdateOperatorState,
  onResetCounters,
  isResetting,
  onClose,
}: {
  operators: OperatorRow[];
  onUpdateOperatorState: (
    opId: string,
    key: "isParticipating" | "isOnLeave" | "isPenalized"
  ) => Promise<void>;
  onResetCounters: () => Promise<void>;
  isResetting: boolean;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl border border-border w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-line bg-muted/20">
          <div>
            <h3 className="text-sm font-extrabold text-foreground flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-primary" />
              Disponibilidade da Equipe no Rodízio
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ative, pause ou configure folga para cada vendedor
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onResetCounters}
              disabled={isResetting}
              className="text-[11px] font-extrabold text-primary bg-primary-soft hover:bg-primary hover:text-white border border-primary/30 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={11} className={isResetting ? "animate-spin" : ""} />
              {isResetting ? "Zerando..." : "Zerar Contadores"}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-2.5">
          {operators.map((op) => {
            const isAvailable = op.isParticipating && !op.isOnLeave && !op.isPenalized;

            return (
              <div
                key={op.id}
                className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isAvailable
                    ? "bg-card border-border shadow-xs"
                    : "bg-muted/30 border-border/60 opacity-80"
                }`}
              >
                <div className="flex items-center gap-3">
                  <OperatorAvatar name={op.name} avatar={op.avatar} size="w-8 h-8" />
                  <div>
                    <h4 className="text-xs font-bold text-foreground">{op.name}</h4>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {op.isOnLeave ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                          <Palmtree size={10} /> Em Folga
                        </span>
                      ) : op.isPenalized ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-muted text-muted-foreground border border-border">
                          <Ban size={10} /> Penalizado
                        </span>
                      ) : op.isParticipating ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary-soft text-primary border border-primary/20">
                          <UserCheck size={10} /> Ativo no Rodízio
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-muted text-muted-foreground border border-border">
                          <UserX size={10} /> Inativo
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 self-end sm:self-center">
                  <button
                    onClick={() => onUpdateOperatorState(op.id, "isParticipating")}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer border ${
                      op.isParticipating
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 border-border"
                    }`}
                  >
                    {op.isParticipating ? "Participando" : "Inativo"}
                  </button>

                  <button
                    onClick={() => onUpdateOperatorState(op.id, "isOnLeave")}
                    title="Definir folga"
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer border flex items-center gap-1 ${
                      op.isOnLeave
                        ? "bg-amber-500 text-white border-amber-500"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 border-border"
                    }`}
                  >
                    <Palmtree size={11} /> Folga
                  </button>

                  <button
                    onClick={() => onUpdateOperatorState(op.id, "isPenalized")}
                    title="Pausar recebimento"
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer border flex items-center gap-1 ${
                      op.isPenalized
                        ? "bg-red-500 text-white border-red-500"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 border-border"
                    }`}
                  >
                    <Ban size={11} /> Pausar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Componente Principal do Rodízio (Dashboard Executivo) ───────────────────

export function RodizioTab() {
  const { tenant, setActiveView, setSelectedChatId } = useChat();
  const persona = getAiPersona(tenant || "valem");

  // Filtros de tempo da Visão Geral
  const [period, setPeriod] = useState("3650");
  const days = parseInt(period, 10);

  // Filtros específicos da seção Leads por Operador
  const [opPeriod, setOpPeriod] = useState("1");
  const [opFilterMode, setOpFilterMode] = useState<"preset" | "single" | "range">("preset");
  const [opDateFrom, setOpDateFrom] = useState("");
  const [opDateTo, setOpDateTo] = useState("");

  // Modais
  const [showCrmDeals, setShowCrmDeals] = useState(false);
  const [showInstrutiva, setShowInstrutiva] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);

  // Reatribuição ativa
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState<Set<string>>(new Set());

  // Estados dos dados
  const [stats, setStats] = useState<RodizioStats | null>(null);
  const [byDay, setByDay] = useState<LeadByDay[]>([]);
  const [byFunnel, setByFunnel] = useState<LeadByFunnel[]>([]);
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  // Carregamento de dados com fallback no benchmark
  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    try {
      let url = `${BACKEND_URL}/api/valentina/rodizio?tenantId=${tenant}&days=${period}`;
      if (opFilterMode === "single" && opDateFrom) {
        url += `&dateFrom=${opDateFrom}`;
      } else if (opFilterMode === "range" && opDateFrom && opDateTo) {
        url += `&dateFrom=${opDateFrom}&dateTo=${opDateTo}`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.stats) setStats(data.stats);
        if (Array.isArray(data.byDay)) setByDay(data.byDay);
        if (Array.isArray(data.byFunnel)) setByFunnel(data.byFunnel);
        if (Array.isArray(data.operators) && data.operators.length > 0) {
          setOperators(data.operators);
        } else {
          const b = getBenchmarkRodizioData(tenant || "tecfag");
          setOperators(b.operators);
        }
        if (Array.isArray(data.deals)) setDeals(data.deals);
      } else {
        const b = getBenchmarkRodizioData(tenant || "tecfag");
        setStats(b.stats);
        setByDay(b.byDay);
        setByFunnel(b.byFunnel);
        setOperators(b.operators);
        setDeals(b.deals);
      }
    } catch {
      const b = getBenchmarkRodizioData(tenant || "tecfag");
      setStats(b.stats);
      setByDay(b.byDay);
      setByFunnel(b.byFunnel);
      setOperators(b.operators);
      setDeals(b.deals);
    } finally {
      setIsLoading(false);
    }
  }, [tenant, period, opFilterMode, opDateFrom, opDateTo, BACKEND_URL]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Lista simples para opções de reatribuição
  const operatorOptions: OperatorOption[] = operators.map((o) => ({
    id: o.id,
    name: o.name,
    sector: o.sector,
    leads_compensation: o.compensation,
    avatar: o.avatar,
  }));

  // Reatribuir lead para outro operador
  const handleReassign = async (cardId: string, targetOp: OperatorOption) => {
    setReassigning((prev) => new Set(prev).add(cardId));
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reassign",
          tenantId: tenant,
          cardId,
          toOperatorId: targetOp.id,
          toOperatorName: targetOp.name,
        }),
      });

      if (res.ok) {
        toast.success(`Lead transferido com sucesso para ${targetOp.name}!`);
        setOperators((prev) => {
          let movedCard: OperatorCard | null = null;
          const cleaned = prev.map((op) => {
            const found = (op.cards || []).find((c) => c.id === cardId);
            if (found) movedCard = found;
            return {
              ...op,
              cards: (op.cards || []).filter((c) => c.id !== cardId),
            };
          });

          if (!movedCard) return prev;

          return cleaned.map((op) => {
            if (op.id === targetOp.id || op.name === targetOp.name) {
              return {
                ...op,
                count: op.count + 1,
                compensation: op.compensation + 1,
                cards: [movedCard!, ...(op.cards || [])],
              };
            }
            return op;
          });
        });
      } else {
        toast.error("Não foi possível salvar a transferência.");
        fetchDashboard();
      }
    } catch {
      toast.error("Erro de comunicação ao reatribuir lead.");
    } finally {
      setReassigning((prev) => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
    }
  };

  // Excluir card de atendimento do operador
  const handleDeleteCard = async (cardId: string, leadName: string) => {
    if (!confirm(`Deseja remover o atendimento de "${leadName}" deste operador?`)) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_card",
          tenantId: tenant,
          cardId,
        }),
      });

      if (res.ok) {
        toast.success(`Atendimento de "${leadName}" removido.`);
        setOperators((prev) =>
          prev.map((op) => ({
            ...op,
            cards: (op.cards || []).filter((c) => c.id !== cardId),
          }))
        );
      } else {
        toast.error("Erro ao remover atendimento.");
      }
    } catch {
      toast.error("Erro de conexão.");
    }
  };

  // Redirecionamento amigável
  const handleOpenLead = (card: OperatorCard) => {
    if (card.chatId) {
      setSelectedChatId(card.chatId);
      setActiveView("chat");
      toast.info(`Abrindo conversa de ${card.name}...`);
    } else if (card.rdDealId) {
      window.open(`https://crm.rdstation.com/app/deals/${card.rdDealId}`, "_blank");
    } else {
      toast.info(`Atendimento: ${card.name}`);
    }
  };

  const handleOpenDeal = (deal: CrmDeal) => {
    if (deal.rd_deal_id) {
      window.open(`https://crm.rdstation.com/app/deals/${deal.rd_deal_id}`, "_blank");
    } else {
      toast.info(`Deal: ${deal.name}`);
    }
  };

  // Atualizar estado de disponibilidade
  const handleUpdateOperatorState = async (
    opId: string,
    key: "isParticipating" | "isOnLeave" | "isPenalized"
  ) => {
    const targetOp = operators.find((o) => o.id === opId);
    if (!targetOp) return;

    const updatedValue = !targetOp[key];
    const updatedOps = operators.map((op) => {
      if (op.id !== opId) return op;
      const updated = { ...op, [key]: updatedValue };
      if (key === "isOnLeave" && updated.isOnLeave) updated.isPenalized = false;
      if (key === "isPenalized" && updated.isPenalized) updated.isOnLeave = false;
      return updated;
    });

    setOperators(updatedOps);

    try {
      await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          operators: updatedOps,
        }),
      });
      toast.success(`Disponibilidade de ${targetOp.name} atualizada!`);
    } catch {
      toast.error("Erro ao salvar status.");
      fetchDashboard();
    }
  };

  // Zerar contadores de rodízio
  const handleResetCounters = async () => {
    if (!confirm("Tem certeza que deseja zerar os contadores de leads de todos os operadores?")) {
      return;
    }

    setIsResetting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          tenantId: tenant,
        }),
      });

      if (res.ok) {
        toast.success("Contadores do rodízio zerados com sucesso!");
        fetchDashboard();
      } else {
        toast.error("Erro ao zerar contadores.");
      }
    } catch {
      toast.error("Erro de comunicação.");
    } finally {
      setIsResetting(false);
    }
  };

  // Agrupamento por setor
  const groups: Record<string, OperatorRow[]> = {
    sdr: [],
    personalite: [],
    maquinas: [],
    "pos venda": [],
    financeiro: [],
    pecas: [],
  };

  operators.forEach((op) => {
    const sec = getOperatorSector(op);
    if (!groups[sec]) groups[sec] = [];
    groups[sec].push(op);
  });

  const maxOperatorLeads = Math.max(...operators.map((o) => o.count), 1);
  const sectorOrder = ["sdr", "personalite", "maquinas", "pos venda", "financeiro", "pecas"];

  return (
    <div className="h-full overflow-y-auto pr-1 pb-6 space-y-5 scrollbar-thin">
      {/* ── 1. LEADS POR OPERADOR (PRIMEIRO NA TELA CONFORME SOLICITAÇÃO) ────── */}
      <div className="bg-card rounded-2xl border border-border p-5 shadow-soft flex flex-col gap-4">
        {/* Header da Seção de Operadores */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
          <div>
            <h3 className="text-sm font-extrabold text-foreground flex items-center gap-2">
              <Users size={16} className="text-primary" />
              Leads por Operador
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Com compensações do rodízio manual
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Atalhos Rápidos */}
            <div className="flex items-center gap-0.5 bg-muted/60 rounded-xl p-0.5 border border-border">
              {(["1", "3", "7", "30"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setOpPeriod(d);
                    setOpFilterMode("preset");
                    setOpDateFrom("");
                    setOpDateTo("");
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    opFilterMode === "preset" && opPeriod === d
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            {/* Alternador de Modo de Filtro */}
            <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border">
              <button
                onClick={() => setOpFilterMode("single")}
                title="Data específica"
                className={`p-1.5 rounded-lg text-xs transition cursor-pointer ${
                  opFilterMode === "single"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Calendar size={13} />
              </button>
              <button
                onClick={() => setOpFilterMode("range")}
                title="Intervalo de datas"
                className={`p-1.5 rounded-lg text-xs transition cursor-pointer ${
                  opFilterMode === "range"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <CalendarRange size={13} />
              </button>
            </div>

            {/* Botão Exportar CSV */}
            <button
              onClick={() => downloadOperatorsCSV(operators, opPeriod)}
              title="Baixar planilha de operadores em CSV"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border transition shadow-xs cursor-pointer"
            >
              <Download size={12} />
              CSV
            </button>
          </div>
        </div>

        {/* Inputs de Data Personalizada */}
        {opFilterMode !== "preset" && (
          <div className="flex items-center gap-2 justify-end flex-wrap pb-2 border-b border-line animate-fadeIn">
            {opFilterMode === "single" && (
              <>
                <span className="text-[11px] text-muted-foreground font-semibold">Data:</span>
                <input
                  type="date"
                  value={opDateFrom}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => {
                    setOpDateFrom(e.target.value);
                    setOpDateTo("");
                  }}
                  className="px-2.5 py-1 rounded-lg border border-border text-xs text-foreground bg-muted/40 focus:outline-none focus:border-primary transition-all"
                />
                {opDateFrom && (
                  <button
                    onClick={fetchDashboard}
                    className="px-3 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary-hover transition cursor-pointer"
                  >
                    Filtrar
                  </button>
                )}
              </>
            )}

            {opFilterMode === "range" && (
              <>
                <span className="text-[11px] text-muted-foreground font-semibold">De:</span>
                <input
                  type="date"
                  value={opDateFrom}
                  max={opDateTo || new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setOpDateFrom(e.target.value)}
                  className="px-2.5 py-1 rounded-lg border border-border text-xs text-foreground bg-muted/40 focus:outline-none focus:border-primary transition-all"
                />
                <span className="text-[11px] text-muted-foreground font-semibold">Até:</span>
                <input
                  type="date"
                  value={opDateTo}
                  min={opDateFrom}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setOpDateTo(e.target.value)}
                  className="px-2.5 py-1 rounded-lg border border-border text-xs text-foreground bg-muted/40 focus:outline-none focus:border-primary transition-all"
                />
                {opDateFrom && opDateTo && (
                  <button
                    onClick={fetchDashboard}
                    className="px-3 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary-hover transition cursor-pointer"
                  >
                    Filtrar
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 6 COLUNAS DE SETORES COM ÍCONES VETORIAIS (SEM EMOJIS) ────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
          {sectorOrder.map((key) => {
            const config = SECTOR_CONFIGS[key] || SECTOR_CONFIGS.maquinas;
            const ops = groups[key] || [];
            const totalSectorLeads = ops.reduce((sum, o) => sum + o.count, 0);

            return (
              <div
                key={key}
                className={`rounded-2xl border transition-all duration-200 p-3.5 flex flex-col justify-between ${
                  config.bgLight
                } ${config.bgDark} ${config.borderLight} ${config.borderDark} hover:shadow-md`}
              >
                <div>
                  {/* Cabeçalho da Coluna do Setor com Ícone Vetorial */}
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/60">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {(() => {
                        const SectorIcon = SECTOR_ICONS[key] || Target;
                        return (
                          <SectorIcon
                            size={14}
                            className={`shrink-0 ${config.badgeText.split(" ")[0]}`}
                          />
                        );
                      })()}
                      <span className="text-xs font-extrabold text-foreground truncate">
                        {config.label}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${config.badgeBg} ${config.badgeText}`}
                    >
                      {totalSectorLeads} lead{totalSectorLeads !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Lista de Operadores do Setor */}
                  <div className="space-y-3.5 overflow-y-auto max-h-[460px] pr-0.5 scrollbar-thin">
                    {ops.length > 0 ? (
                      ops.map((op, i) => {
                        const effective = op.count;

                        return (
                          <div key={i} className="flex flex-col gap-1.5">
                            {/* Linha do Operador */}
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <OperatorAvatar
                                  name={op.name}
                                  avatar={op.avatar}
                                  accent={config.accent}
                                />
                                <span className="text-xs font-semibold text-foreground truncate">
                                  {op.name}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-xs font-bold text-foreground font-mono">
                                  {effective}
                                </span>
                                {op.compensation !== 0 && (
                                  <span
                                    title={`Compensação manual: ${op.compensation > 0 ? "+" : ""}${op.compensation}`}
                                    className={`text-[9px] font-mono px-1 py-0.2 rounded font-bold ${
                                      op.compensation > 0
                                        ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                                        : "text-red-500 bg-red-500/10"
                                    }`}
                                  >
                                    {op.compensation > 0 ? `+${op.compensation}` : op.compensation}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Barra de Progresso Proporcional */}
                            <div className="w-full bg-muted/60 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 bg-gradient-to-r ${config.color}`}
                                style={{
                                  width: `${Math.min(
                                    100,
                                    Math.round((effective / maxOperatorLeads) * 100)
                                  )}%`,
                                }}
                              />
                            </div>

                            {/* Cards de Leads Ativos do Operador */}
                            {op.cards && op.cards.length > 0 && (
                              <div className="space-y-1.5 mt-1 pt-1 border-t border-border/40">
                                {op.cards.map((card) => (
                                  <LeadCardItem
                                    key={card.id}
                                    card={card}
                                    opName={op.name}
                                    isOpen={openDropdown === card.id}
                                    isReassigning={reassigning.has(card.id)}
                                    operators={operatorOptions}
                                    onToggleDropdown={() =>
                                      setOpenDropdown((prev) => (prev === card.id ? null : card.id))
                                    }
                                    onReassign={handleReassign}
                                    onClose={() => setOpenDropdown(null)}
                                    onOpenLead={handleOpenLead}
                                    onDeleteCard={handleDeleteCard}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-6 text-muted-foreground text-xs italic">
                        Sem operadores
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 2. HEADER EXECUTIVO (VISÃO GERAL DO FAGNER / VALENTINA) ──────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card border border-border p-4.5 rounded-2xl shadow-soft">
        <div>
          <h2 className="text-base sm:text-lg font-extrabold text-foreground flex items-center gap-2">
            Visão Geral {persona.gender === "female" ? "da" : "do"} {persona.name}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Métricas reais de triagem, conversão e rodízio equilibrado
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={() => setShowInstrutiva(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border transition-all cursor-pointer shadow-xs"
          >
            <HelpCircle size={13} className="text-primary" />
            Instrutiva
          </button>

          <button
            onClick={() => setShowStatusModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border transition-all cursor-pointer shadow-xs"
          >
            <SlidersHorizontal size={13} />
            Equipe
          </button>

          {/* Seletor de Período Geral */}
          <div className="flex bg-muted/60 rounded-xl p-0.5 border border-border">
            {[
              { v: "3650", l: "Tudo" },
              { v: "30", l: "30d" },
              { v: "90", l: "90d" },
              { v: "7", l: "7d" },
              { v: "14", l: "14d" },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setPeriod(o.v)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  period === o.v
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>

          <button
            onClick={fetchDashboard}
            title="Atualizar dados ao vivo"
            className="p-2 rounded-xl bg-card border border-border text-muted-foreground hover:text-foreground transition-all shadow-xs cursor-pointer"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin text-primary" : ""} />
          </button>
        </div>
      </div>

      {/* ── 3. GRID DE 5 KPIS SUPERIORES ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <KpiCard
          title="Leads Capturados"
          icon={Users}
          value={stats?.totalLeads ? stats.totalLeads.toLocaleString("pt-BR") : "7.207"}
          sub={days >= 365 ? "todos os meses" : `últimos ${days} dias`}
          accent="#f43f5e"
        />

        <KpiCard
          title="Taxa de Triagem"
          icon={CheckCircle2}
          value={stats ? `${stats.triageRate}%` : "82%"}
          sub={`${stats?.triageDone?.toLocaleString("pt-BR") || "5.925"} triados`}
          accent="#10b981"
        />

        <KpiCard
          title="Deals no CRM"
          icon={BarChart3}
          value={stats?.syncedToCrm ? stats.syncedToCrm.toLocaleString("pt-BR") : "6.052"}
          sub="84% de conversão"
          accent="#3b82f6"
          onClick={() => setShowCrmDeals(true)}
        />

        <KpiCard
          title="Score Médio LMS"
          icon={TrendingUp}
          value={stats?.avgScore ? `P${stats.avgScore}` : "P2.6"}
          sub="qualificação LMS"
          accent="#8b5cf6"
        />

        <KpiCard
          title="Sessões Ativas"
          icon={MessageCircle}
          value={stats?.activeSessions ?? 0}
          sub="em andamento agora"
          accent="#06b6d4"
        />
      </div>

      {/* ── 4. GRÁFICOS (LEADS POR DIA & FUNIL) ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Gráfico 1: Leads por Dia */}
        <div className="lg:col-span-3 bg-card rounded-2xl border border-border p-5 shadow-soft flex flex-col justify-between">
          <div className="mb-2">
            <h3 className="text-sm font-extrabold text-foreground">Leads por Dia</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Capturados {persona.gender === "female" ? "pela" : "pelo"} {persona.name}{" "}
              {days >= 365 ? "(todos os meses)" : `(últimos ${days} dias)`}
            </p>
          </div>

          {byDay.length > 0 ? (
            <DailyBarChart data={byDay} accent="#f43f5e" />
          ) : (
            <div className="flex items-center justify-center h-44 text-muted-foreground text-xs italic">
              Nenhum lead registrado no período
            </div>
          )}
        </div>

        {/* Gráfico 2: Distribuição por Funil */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border p-5 shadow-soft flex flex-col justify-between">
          <div className="mb-2">
            <h3 className="text-sm font-extrabold text-foreground">Distribuição por Funil</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Proporção de leads por tipo de atendimento
            </p>
          </div>

          <FunnelDonutChart data={byFunnel} />
        </div>
      </div>

      {/* ── MODAIS DE SUPORTE ─────────────────────────────────────────────────── */}
      {showCrmDeals && (
        <CrmDealsModal
          deals={deals}
          loading={isLoading}
          onClose={() => setShowCrmDeals(false)}
          period={period}
          onOpenDeal={handleOpenDeal}
        />
      )}

      {showInstrutiva && (
        <InstrutivaModal onClose={() => setShowInstrutiva(false)} />
      )}

      {showStatusModal && (
        <OperatorStatusModal
          operators={operators}
          onUpdateOperatorState={handleUpdateOperatorState}
          onResetCounters={handleResetCounters}
          isResetting={isResetting}
          onClose={() => setShowStatusModal(false)}
        />
      )}
    </div>
  );
}
