import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Maximize2,
  Minimize2,
  ArrowUpRight,
  ExternalLink,
  Search,
  User,
  Building2,
  Calendar,
  Inbox,
  Play,
  Pause,
  Tv,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";
import {
  TVCohortsResponse,
  TVCohortTierConfig,
  TVUnclassifiedDeal,
  formatBrlK,
  getBaselineSafrasCohortsData,
  getBaselineUnclassifiedDeals,
} from "@/lib/commercial/safras-cohorts-data";
import { CommercialSafrasDrilldownModal } from "./CommercialSafrasDrilldownModal";
import { TVPointData } from "./CommercialSafrasTableView";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultTiersConfig?: TVCohortTierConfig[];
  tenantId?: string | null;
  onOpenDeal?: (dealId: string) => void;
}

const CohortPointDot = React.memo(function CohortPointDot(props: {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: any;
  tierIndex: number;
  tierColor: string;
  onRegisterPoint: (tierIndex: number, monthIndex: number, point: TVPointData) => void;
}) {
  const { cx, cy, index, payload, tierIndex, tierColor, onRegisterPoint } = props;

  useEffect(() => {
    if (
      typeof cx === "number" &&
      typeof cy === "number" &&
      typeof index === "number" &&
      !isNaN(cx) &&
      !isNaN(cy)
    ) {
      onRegisterPoint(tierIndex, index, {
        x: cx,
        y: cy,
        monthIndex: index,
        monthName: payload?.monthName || "",
        fullLabel: payload?.fullLabel || "",
        count: Number(payload?.[`tier_${tierIndex}`] ?? 0),
        totalValue: Number(payload?.[`tier_${tierIndex}_val`] ?? 0),
        tierIndex,
        tierLabel: payload?.[`tier_${tierIndex}_label`] || "",
        tierRule: payload?.[`tier_${tierIndex}_rule`] || "",
        color: tierColor,
      });
    }
  }, [cx, cy, index, payload, tierIndex, tierColor, onRegisterPoint]);

  if (typeof cx !== "number" || typeof cy !== "number" || isNaN(cx) || isNaN(cy)) {
    return null;
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={tierColor}
      stroke="#121215"
      strokeWidth={2}
    />
  );
});

export function MaturityCohortFullscreenModal({
  isOpen,
  onClose,
  defaultTiersConfig,
  tenantId = "tecfag",
  onOpenDeal,
}: Props) {
  const [data, setData] = useState<TVCohortsResponse>(getBaselineSafrasCohortsData);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTiers, setActiveTiers] = useState<Record<number, boolean>>({});

  const [isTvModeActive, setIsTvModeActive] = useState(true);
  const [pointsRegistry, setPointsRegistry] = useState<Record<number, Record<number, TVPointData>>>({});
  const chartWrapperRef = useRef<HTMLDivElement>(null);

  const [selectedMonthDrilldown, setSelectedMonthDrilldown] = useState<{
    monthKey: string;
    fullLabel: string;
  } | null>(null);

  const tiersConfig = useMemo(() => {
    if (data?.tiersConfig && data.tiersConfig.length > 0) return data.tiersConfig;
    if (defaultTiersConfig && defaultTiersConfig.length > 0) return defaultTiersConfig;
    return getBaselineSafrasCohortsData().tiersConfig;
  }, [data, defaultTiersConfig]);

  useEffect(() => {
    if (tiersConfig.length > 0 && Object.keys(activeTiers).length === 0) {
      const initial: Record<number, boolean> = {};
      tiersConfig.forEach((t) => {
        initial[t.index] = true;
      });
      setActiveTiers(initial);
    }
  }, [tiersConfig, activeTiers]);

  const toggleTier = (index: number) => {
    setActiveTiers((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const handleRegisterPoint = useCallback(
    (tierIndex: number, monthIndex: number, point: TVPointData) => {
      setPointsRegistry((prev) => {
        const existing = prev[tierIndex]?.[monthIndex];
        if (
          existing &&
          existing.x === point.x &&
          existing.y === point.y &&
          existing.count === point.count &&
          existing.totalValue === point.totalValue
        ) {
          return prev;
        }
        return {
          ...prev,
          [tierIndex]: {
            ...(prev[tierIndex] || {}),
            [monthIndex]: point,
          },
        };
      });
    },
    [],
  );

  const chartData = useMemo(() => {
    if (!data?.months) return [];
    return data.months.map((m) => {
      const item: any = {
        monthKey: m.monthKey,
        monthName: m.monthName,
        monthShort: m.monthShort,
        fullLabel: m.fullLabel,
        isCurrentMonth: m.isCurrentMonth,
        unclassifiedCount: m.unclassifiedCount,
        unclassifiedValue: m.unclassifiedValue,
        totalCards: m.totalCards,
        totalValue: m.totalValue,
      };
      m.tiers.forEach((t) => {
        item[`tier_${t.tierIndex}`] = Number(t.count ?? 0);
        item[`tier_${t.tierIndex}_val`] = Number(t.totalValue ?? 0);
        item[`tier_${t.tierIndex}_label`] = t.label;
        item[`tier_${t.tierIndex}_rule`] = t.valueRuleLabel;
      });
      return item;
    });
  }, [data]);

  // Tecla ESC para fechar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (selectedMonthDrilldown) {
          setSelectedMonthDrilldown(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedMonthDrilldown, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[999999] bg-[#09090b] text-zinc-100 flex flex-col overflow-hidden font-sans">
        {/* HEADER SUPERIOR FULLSCREEN */}
        <header className="flex items-center justify-between px-6 py-3 bg-gradient-to-b from-zinc-900 to-[#111113] border-b border-zinc-800 gap-4 shrink-0">
          <div className="flex items-center gap-3.5">
            <span className="text-sm font-mono font-black tracking-widest text-red-500 uppercase">
              {tenantId === "valem" ? "VALEM" : "TECFAG"}
            </span>

            <div className="h-6 w-px bg-zinc-700" />

            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-extrabold tracking-wider text-red-500 uppercase inline-flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Safras &amp; Régua De-Para
                </span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-[2px] bg-red-500/15 border border-red-500/30 text-red-400">
                  ÚLTIMOS 6 MESES
                </span>
              </div>
              <h1 className="text-sm sm:text-[15px] font-mono font-bold text-white tracking-tight mt-0.5">
                Evolução Mensal de Criação de Oportunidades por Faixa de Valor
              </h1>
            </div>
          </div>

          {/* Hero KPIs */}
          <div className="hidden md:flex items-center gap-3">
            <div className="bg-zinc-900/80 border border-zinc-800 px-3.5 py-1.5 rounded-[4px] text-center">
              <span className="text-[9px] font-mono font-bold text-zinc-400 uppercase tracking-wider block">
                Total Cards (6m)
              </span>
              <div className="text-sm sm:text-[15px] font-mono font-black text-white">
                {data.summary.totalCardsAllMonths.toLocaleString("pt-BR")}
              </div>
            </div>

            <div className="bg-emerald-950/20 border border-emerald-500/40 px-3.5 py-1.5 rounded-[4px] text-center">
              <span className="text-[9px] font-mono font-bold text-emerald-400 uppercase tracking-wider block">
                Classificados De-Para
              </span>
              <div className="text-sm sm:text-[15px] font-mono font-black text-emerald-400">
                {data.summary.totalClassifiedAllMonths.toLocaleString("pt-BR")}
              </div>
            </div>

            <div className="bg-amber-950/20 border border-amber-500/40 px-3.5 py-1.5 rounded-[4px] text-center">
              <span className="text-[9px] font-mono font-bold text-amber-400 uppercase tracking-wider block">
                Sem Classificação
              </span>
              <div className="text-sm sm:text-[15px] font-mono font-black text-amber-300">
                {data.summary.totalUnclassifiedAllMonths.toLocaleString("pt-BR")}
              </div>
            </div>

            <div className="bg-zinc-900/80 border border-zinc-800 px-3.5 py-1.5 rounded-[4px] text-center">
              <span className="text-[9px] font-mono font-bold text-zinc-400 uppercase tracking-wider block">
                Volume Faturável Total
              </span>
              <div className="text-sm sm:text-[15px] font-mono font-black text-cyan-400">
                {formatBrlK(data.summary.totalValueAllMonths)}
              </div>
            </div>
          </div>

          {/* Ações Direitas */}
          <div className="flex items-center gap-2.5">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-mono font-bold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
              AO VIVO • WEBHOOK RD
            </div>

            <motion.button
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setIsTvModeActive((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] text-xs font-mono font-bold transition-all cursor-pointer ${
                isTvModeActive
                  ? "bg-blue-950/40 border border-blue-500 text-blue-300 shadow-xs"
                  : "bg-zinc-800 border border-zinc-700 text-zinc-400"
              }`}
            >
              {isTvModeActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              <span>{isTvModeActive ? "RASTREADOR TV: ON" : "RASTREADOR TV: OFF"}</span>
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onClose}
              className="bg-red-500/15 border border-red-500/40 rounded-[2px] text-red-400 px-3 py-1 flex items-center gap-1.5 text-xs font-mono font-extrabold hover:bg-red-500/25 transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              <span>FECHAR (ESC)</span>
            </motion.button>
          </div>
        </header>

        {/* LEGENDA / FILTROS DA RÉGUA DE-PARA */}
        <div className="flex items-center justify-between px-6 py-2 bg-[#111113] border-b border-zinc-800/80 flex-wrap gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
              Faixas da Régua De-Para (Funis Máquinas 2.0 &amp; Personnalité 2.0):
            </span>
            <span className="text-[10px] font-mono text-zinc-500 hidden sm:inline">
              (Clique em uma faixa para filtrar no gráfico)
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {tiersConfig.map((tier) => {
              const isVisible = activeTiers[tier.index] !== false;
              return (
                <motion.button
                  key={tier.index}
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => toggleTier(tier.index)}
                  className={`flex items-center gap-2 px-2.5 py-1 rounded-[2px] border text-xs font-mono font-bold transition-all cursor-pointer ${
                    isVisible
                      ? "bg-zinc-800/90 text-white shadow-xs"
                      : "bg-zinc-900/40 text-zinc-500 opacity-40 border-zinc-800"
                  }`}
                  style={{
                    borderColor: isVisible ? tier.color : undefined,
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: tier.color,
                      boxShadow: isVisible ? `0 0 8px ${tier.color}` : "none",
                    }}
                  />
                  <span style={{ color: isVisible ? tier.color : undefined }}>{tier.label}</span>
                  <span className="text-[10px] text-zinc-400">({tier.valueRuleLabel})</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* CORPO DO MODAL FULLSCREEN */}
        <div className="flex-1 flex flex-col min-h-0 px-6 py-3.5 gap-3 bg-gradient-to-b from-[#121215] to-[#09090b]">
          {/* GRÁFICO CENTRAL */}
          <div className="flex-1 min-h-[260px] bg-[#121215]/80 border border-zinc-800 rounded-[4px] p-4 flex flex-col relative">
            <div className="flex items-center justify-between mb-1 px-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-extrabold uppercase tracking-wider text-zinc-400">
                  Volume de Cards Criados (Por Mês de Criação)
                </span>
                {isTvModeActive && (
                  <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-950/40 border border-blue-500/30 px-2 py-0.5 rounded-[2px] flex items-center gap-1">
                    <Tv className="h-3 w-3" />
                    Rastreador Automático TV Ativo
                  </span>
                )}
              </div>
              <span className="text-[10px] font-mono text-zinc-500 italic hidden sm:inline">
                * Baseado na data original de criação do negócio no RD CRM • Funis Máquinas 2.0 e Personnalité 2.0
              </span>
            </div>

            <div ref={chartWrapperRef} className="flex-1 w-full min-h-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 16, right: 30, left: 10, bottom: 5 }}>
                  <CartesianGrid stroke="#222226" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="monthName"
                    stroke="#52525b"
                    tickLine={false}
                    axisLine={{ stroke: "#3f3f46" }}
                    tick={({ x, y, payload }) => {
                      const monthObj = chartData.find((m) => m.monthName === payload.value);
                      const isCurr = monthObj?.isCurrentMonth;
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text
                            x={0}
                            y={0}
                            dy={16}
                            textAnchor="middle"
                            fill={isCurr ? "#ffffff" : "#a1a1aa"}
                            fontSize={12}
                            fontWeight={isCurr ? 800 : 600}
                            fontFamily="monospace"
                          >
                            {payload.value} {isCurr ? "★" : ""}
                          </text>
                          {isCurr && (
                            <text
                              x={0}
                              y={0}
                              dy={30}
                              textAnchor="middle"
                              fill="#ef4444"
                              fontSize={9}
                              fontWeight={800}
                              fontFamily="monospace"
                            >
                              MÊS ATUAL
                            </text>
                          )}
                        </g>
                      );
                    }}
                    height={42}
                  />
                  <YAxis
                    stroke="#52525b"
                    tick={{ fill: "#71717a", fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}
                    tickLine={false}
                    axisLine={{ stroke: "#3f3f46" }}
                    allowDecimals={false}
                  />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const monthData = payload[0]?.payload;
                      return (
                        <div className="bg-[#18181b] border border-zinc-700 rounded-[4px] p-3 text-white shadow-2xl min-w-[220px] text-xs font-mono">
                          <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
                            <strong className="text-red-400 font-bold">{monthData.fullLabel}</strong>
                            {monthData.isCurrentMonth && (
                              <span className="text-[9px] font-black bg-red-600 text-white px-2 py-0.5 rounded-[2px]">
                                MÊS ATUAL
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {tiersConfig.map((t) => {
                              const count = monthData[`tier_${t.index}`] || 0;
                              const val = monthData[`tier_${t.index}_val`] || 0;
                              return (
                                <div key={t.index} className="flex items-center justify-between gap-3 text-xs">
                                  <div className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                                    <span className="text-zinc-300 font-semibold">{t.label}</span>
                                  </div>
                                  <div className="text-right">
                                    <strong style={{ color: t.color }}>{count} cards</strong>
                                    <span className="block text-[10px] text-zinc-400">{formatBrlK(val)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-2.5 pt-2 border-t border-zinc-800 flex flex-col gap-1 text-xs">
                            <div className="flex justify-between text-amber-400">
                              <span>Sem Classificação:</span>
                              <strong>{monthData.unclassifiedCount} cards</strong>
                            </div>
                            <div className="flex justify-between text-white font-bold">
                              <span>Total Oportunidades:</span>
                              <span className="text-blue-400">{monthData.totalCards} cards</span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  {tiersConfig.map((tier) => {
                    if (activeTiers[tier.index] === false) return null;
                    return (
                      <Line
                        key={tier.index}
                        type="monotone"
                        dataKey={`tier_${tier.index}`}
                        name={tier.label}
                        stroke={tier.color}
                        strokeWidth={3}
                        strokeOpacity={1}
                        isAnimationActive={false}
                        connectNulls={true}
                        dot={
                          <CohortPointDot
                            tierIndex={tier.index}
                            tierColor={tier.color}
                            onRegisterPoint={handleRegisterPoint}
                          />
                        }
                        activeDot={{ r: 8, fill: tier.color, stroke: "#ffffff", strokeWidth: 2 }}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* PARTE INFERIOR: BLOCO DEDICADO "CARDS SEM CLASSIFICAÇÃO" */}
          <div className="bg-[#121215] border border-zinc-800 rounded-[4px] p-3 flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-amber-400 inline-flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Cards Sem Classificação (Sem Valor no CRM)
                </span>
                <span className="text-[11px] font-mono text-zinc-500">
                  — Clique em qualquer mês para abrir a lista de oportunidades e o link direto no CRM
                </span>
              </div>
            </div>

            <div className="grid grid-cols-6 gap-2.5">
              {data.months.map((m) => {
                const hasZero = m.unclassifiedCount === 0;
                const unclassPct =
                  m.totalCards > 0 ? Math.round((m.unclassifiedCount / m.totalCards) * 100) : 0;

                return (
                  <motion.button
                    key={m.monthKey}
                    type="button"
                    whileHover={{ scale: 1.025, y: -1 }}
                    whileTap={{ scale: 0.975 }}
                    onClick={() =>
                      setSelectedMonthDrilldown({
                        monthKey: m.monthKey,
                        fullLabel: m.fullLabel,
                      })
                    }
                    className={`rounded-[2px] border p-2.5 text-left transition-all cursor-pointer relative flex flex-col justify-between ${
                      m.isCurrentMonth
                        ? "border-amber-500/50 bg-amber-950/25"
                        : "border-zinc-800 bg-zinc-950/60 hover:border-amber-500/40"
                    }`}
                  >
                    {m.isCurrentMonth && (
                      <span className="absolute top-2 right-2 text-[8px] font-mono font-black bg-red-600 text-white px-1.5 py-0.2 rounded-[2px]">
                        ATUAL
                      </span>
                    )}

                    <div className="flex items-center justify-between pr-8">
                      <span className="text-xs font-mono font-bold text-white">{m.monthName}</span>
                      <span className="text-[10px] font-mono text-zinc-500">{m.year}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 my-1.5">
                      <span
                        className={`text-xs font-mono font-bold ${
                          hasZero ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        Sem classificação &gt;
                      </span>
                      <strong
                        className={`text-base font-mono font-black ${
                          hasZero ? "text-emerald-300" : "text-amber-300"
                        }`}
                      >
                        {m.unclassifiedCount}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 pt-1 border-t border-zinc-800/60">
                      <span>{hasZero ? "100% qualificado" : `${unclassPct}% da safra`}</span>
                      <span className="text-blue-400 font-bold inline-flex items-center gap-0.5">
                        Ver cards <ArrowUpRight className="h-3 w-3" />
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <footer className="flex items-center justify-between px-6 py-2 bg-[#111113] border-t border-zinc-800 text-[11px] font-mono text-zinc-400 shrink-0">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            <span>
              <strong>War Room Comercial:</strong> Régua De-Para dinâmica integrada ao banco de dados. Monitoramento exclusivo dos Funis <strong>Máquinas 2.0 (Semi)</strong> e <strong>Personnalité 2.0</strong>.
            </span>
          </div>
          <div>
            Pressione <strong>[ESC]</strong> ou clique em <strong>FECHAR</strong> para retornar
          </div>
        </footer>

        {/* MODAL DE DRILLDOWN */}
        {selectedMonthDrilldown && (
          <CommercialSafrasDrilldownModal
            isOpen={Boolean(selectedMonthDrilldown)}
            onClose={() => setSelectedMonthDrilldown(null)}
            monthKey={selectedMonthDrilldown.monthKey}
            monthLabel={selectedMonthDrilldown.fullLabel}
            deals={getBaselineUnclassifiedDeals(selectedMonthDrilldown.monthKey)}
            onOpenDeal={onOpenDeal}
          />
        )}
      </div>
    </AnimatePresence>
  );
}
