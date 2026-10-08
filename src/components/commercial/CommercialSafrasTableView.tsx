import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { motion } from "framer-motion";
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
  TrendingUp,
  Tv,
  Pause,
  Play,
  AlertCircle,
  ArrowUpRight,
  RefreshCw,
  Maximize2,
} from "lucide-react";
import {
  TVCohortsResponse,
  TVCohortTierConfig,
  formatBrlK,
  getBaselineSafrasCohortsData,
  getBaselineUnclassifiedDeals,
} from "@/lib/commercial/safras-cohorts-data";
import { CommercialSafrasDrilldownModal } from "./CommercialSafrasDrilldownModal";

export interface TVPointData {
  x: number;
  y: number;
  monthIndex: number;
  monthName: string;
  fullLabel: string;
  count: number;
  totalValue: number;
  tierIndex: number;
  tierLabel: string;
  tierRule: string;
  color: string;
}

interface CohortPointDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: any;
  tierIndex: number;
  tierColor: string;
  onRegisterPoint: (tierIndex: number, monthIndex: number, point: TVPointData) => void;
}

const CohortPointDot = React.memo(function CohortPointDot(props: CohortPointDotProps) {
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
      r={4.5}
      fill={tierColor}
      stroke="#0c0d12"
      strokeWidth={2}
    />
  );
});

interface CohortAutonomousTvOverlayProps {
  isTvModeActive: boolean;
  tiersConfig: TVCohortTierConfig[];
  activeTiers: Record<number, boolean>;
  pointsRegistry: Record<number, Record<number, TVPointData>>;
  chartWrapperRef: React.RefObject<HTMLDivElement | null>;
}

function CohortAutonomousTvOverlay({
  isTvModeActive,
  tiersConfig,
  activeTiers,
  pointsRegistry,
  chartWrapperRef,
}: CohortAutonomousTvOverlayProps) {
  const particleRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const popupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(performance.now());
  const pathsCacheRef = useRef<Record<string, SVGPathElement>>({});
  const lookupTablesRef = useRef<Record<number, { x: number; y: number }[][]>>({});

  const visibleTiers = useMemo(
    () => tiersConfig.filter((t) => activeTiers[t.index] !== false),
    [tiersConfig, activeTiers],
  );

  const sortedPointsMap = useMemo(() => {
    const map: Record<number, TVPointData[]> = {};
    visibleTiers.forEach((tier) => {
      const tierPointsMap = pointsRegistry[tier.index];
      if (tierPointsMap) {
        map[tier.index] = Object.values(tierPointsMap).sort((a, b) => a.monthIndex - b.monthIndex);
      }
    });
    return map;
  }, [visibleTiers, pointsRegistry]);

  const getPathForColor = useCallback(
    (color: string): SVGPathElement | null => {
      const key = color.toLowerCase();
      if (pathsCacheRef.current[key] && pathsCacheRef.current[key].isConnected) {
        return pathsCacheRef.current[key];
      }
      if (!chartWrapperRef.current) return null;
      const paths = chartWrapperRef.current.querySelectorAll("path.recharts-line-curve");
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i] as SVGPathElement;
        const stroke = p.getAttribute("stroke");
        if (stroke && stroke.toLowerCase() === key) {
          pathsCacheRef.current[key] = p;
          return p;
        }
      }
      return null;
    },
    [chartWrapperRef],
  );

  const getDistanceForX = useCallback((pathEl: SVGPathElement, targetX: number): number => {
    const totalLen = pathEl.getTotalLength();
    if (totalLen <= 0) return 0;
    let low = 0;
    let high = totalLen;
    for (let step = 0; step < 14; step++) {
      const mid = (low + high) / 2;
      const pt = pathEl.getPointAtLength(mid);
      if (pt.x < targetX) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return (low + high) / 2;
  }, []);

  // Pré-calcula a tabela de lookup de trajetórias para cada tier (executado UMA ÚNICA VEZ por mudança de dados/layout)
  useEffect(() => {
    if (!chartWrapperRef.current) return;

    visibleTiers.forEach((tier) => {
      const points = sortedPointsMap[tier.index];
      if (!points || points.length < 2) return;

      const pathEl = getPathForColor(tier.color);
      const tierSegments: { x: number; y: number }[][] = [];

      for (let s = 0; s < points.length - 1; s++) {
        const pStart = points[s];
        const pEnd = points[s + 1];
        const segmentSamples: { x: number; y: number }[] = [];
        const numSamples = 60;

        if (pathEl) {
          const dStart = getDistanceForX(pathEl, pStart.x);
          const dEnd = getDistanceForX(pathEl, pEnd.x);

          for (let k = 0; k < numSamples; k++) {
            const frac = k / (numSamples - 1);
            const dist = dStart + frac * (dEnd - dStart);
            const pt = pathEl.getPointAtLength(dist);
            segmentSamples.push({ x: pt.x, y: pt.y });
          }
        } else {
          for (let k = 0; k < numSamples; k++) {
            const frac = k / (numSamples - 1);
            segmentSamples.push({
              x: pStart.x + frac * (pEnd.x - pStart.x),
              y: pStart.y + frac * (pEnd.y - pStart.y),
            });
          }
        }
        tierSegments.push(segmentSamples);
      }

      lookupTablesRef.current[tier.index] = tierSegments;
    });
  }, [visibleTiers, sortedPointsMap, getPathForColor, getDistanceForX, chartWrapperRef]);

  // Loop de alta performance 60FPS: manipulação direta do DOM via GPU transform3d (ZERO re-renders de React)
  useEffect(() => {
    if (!isTvModeActive) {
      Object.values(particleRefs.current).forEach((el) => {
        if (el) el.style.opacity = "0";
      });
      Object.values(popupRefs.current).forEach((el) => {
        if (el) {
          el.style.opacity = "0";
          el.style.visibility = "hidden";
        }
      });
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    startTimeRef.current = performance.now();

    const DWELL_TIME = 2600; // 2.6s parado no ponto
    const TRAVEL_TIME = 2200; // 2.2s em trânsito lento
    const SEGMENT_TIME = DWELL_TIME + TRAVEL_TIME;
    const RESET_TIME = 1200;

    const tick = (now: number) => {
      const elapsed = now - startTimeRef.current;

      visibleTiers.forEach((tier, tierRank) => {
        const pEl = particleRefs.current[tier.index];
        const samples = lookupTablesRef.current[tier.index];
        const points = sortedPointsMap[tier.index];
        if (!pEl || !points || points.length < 2) return;

        const numPoints = points.length;
        const forwardTime = (numPoints - 1) * SEGMENT_TIME + DWELL_TIME;
        const totalCycle = forwardTime + RESET_TIME;

        // Deslocamento escalonado (staggered) assíncrono entre as faixas
        const staggerOffset = (tierRank * totalCycle) / Math.max(1, visibleTiers.length);
        const localTime = (elapsed + staggerOffset) % totalCycle;

        let curX = points[0].x;
        let curY = points[0].y;
        let pOpacity = 1;
        let activeIdx = 0;
        let activeOpacity = 0;
        let incomingIdx = -1;
        let incomingOpacity = 0;

        if (localTime < (numPoints - 1) * SEGMENT_TIME) {
          const segIdx = Math.floor(localTime / SEGMENT_TIME);
          const timeInSeg = localTime % SEGMENT_TIME;

          if (timeInSeg < DWELL_TIME) {
            curX = points[segIdx].x;
            curY = points[segIdx].y;
            pOpacity = 1;
            activeIdx = segIdx;
            activeOpacity = 1;
          } else {
            const travelProgress = (timeInSeg - DWELL_TIME) / TRAVEL_TIME;
            const eased = travelProgress * travelProgress * (3 - 2 * travelProgress);

            const segSamples = samples?.[segIdx];
            if (segSamples && segSamples.length > 0) {
              const sampleIdx = Math.min(
                segSamples.length - 1,
                Math.max(0, Math.floor(eased * (segSamples.length - 1))),
              );
              curX = segSamples[sampleIdx].x;
              curY = segSamples[sampleIdx].y;
            } else {
              curX = points[segIdx].x + eased * (points[segIdx + 1].x - points[segIdx].x);
              curY = points[segIdx].y + eased * (points[segIdx + 1].y - points[segIdx].y);
            }

            pOpacity = 1;

            if (travelProgress < 0.35) {
              activeIdx = segIdx;
              activeOpacity = 1 - travelProgress / 0.35;
            } else {
              activeIdx = -1;
              activeOpacity = 0;
            }

            if (travelProgress > 0.65) {
              incomingIdx = segIdx + 1;
              incomingOpacity = (travelProgress - 0.65) / 0.35;
            }
          }
        } else if (localTime < forwardTime) {
          curX = points[numPoints - 1].x;
          curY = points[numPoints - 1].y;
          pOpacity = 1;
          activeIdx = numPoints - 1;
          activeOpacity = 1;
        } else {
          const resetProgress = (localTime - forwardTime) / RESET_TIME;
          if (resetProgress < 0.5) {
            curX = points[numPoints - 1].x;
            curY = points[numPoints - 1].y;
            pOpacity = 1 - resetProgress / 0.5;
            activeIdx = numPoints - 1;
            activeOpacity = Math.max(0, 1 - resetProgress / 0.35);
          } else {
            curX = points[0].x;
            curY = points[0].y;
            pOpacity = (resetProgress - 0.5) / 0.5;
            activeIdx = 0;
            activeOpacity = Math.max(0, (resetProgress - 0.65) / 0.35);
          }
        }

        pEl.style.transform = `translate3d(${curX}px, ${curY}px, 0) translate(-50%, -50%)`;
        pEl.style.opacity = `${pOpacity}`;

        points.forEach((pt, idx) => {
          const popEl = popupRefs.current[`${tier.index}_${pt.monthIndex}`];
          if (!popEl) return;

          let targetOp = 0;
          if (idx === activeIdx) {
            targetOp = activeOpacity;
          } else if (idx === incomingIdx) {
            targetOp = incomingOpacity;
          }

          if (targetOp > 0.01) {
            popEl.style.opacity = `${targetOp}`;
            popEl.style.visibility = "visible";
          } else {
            popEl.style.opacity = "0";
            popEl.style.visibility = "hidden";
          }
        });
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isTvModeActive, visibleTiers, sortedPointsMap]);

  if (!isTvModeActive) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "visible",
        zIndex: 35,
      }}
    >
      {/* 1. Bolinhas de Luz renderizadas uma única vez no DOM com aceleração de GPU */}
      {visibleTiers.map((tier) => (
        <div
          key={`particle-${tier.index}`}
          ref={(el) => {
            particleRefs.current[tier.index] = el;
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: "translate3d(-9999px, -9999px, 0)",
            width: "11px",
            height: "11px",
            borderRadius: "50%",
            backgroundColor: "#ffffff",
            border: `2px solid ${tier.color}`,
            boxShadow: `0 0 10px ${tier.color}, 0 0 18px ${tier.color}`,
            pointerEvents: "none",
            zIndex: 45,
            opacity: 0,
            willChange: "transform, opacity",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: -3,
              borderRadius: "50%",
              background: tier.color,
              opacity: 0.35,
            }}
          />
        </div>
      ))}

      {/* 2. Mini Popups fixos ancorados diretamente nos pontos, ativados via GPU opacity */}
      {visibleTiers.map((tier) => {
        const points = sortedPointsMap[tier.index] || [];
        return points.map((pt) => {
          const isNearTop = pt.y < 65;
          return (
            <div
              key={`popup-${tier.index}-${pt.monthIndex}`}
              ref={(el) => {
                popupRefs.current[`${tier.index}_${pt.monthIndex}`] = el;
              }}
              style={{
                position: "absolute",
                left: pt.x,
                top: isNearTop ? pt.y + 14 : pt.y - 14,
                transform: isNearTop ? "translate(-50%, 0)" : "translate(-50%, -100%)",
                opacity: 0,
                visibility: "hidden",
                pointerEvents: "none",
                zIndex: 50,
                willChange: "opacity",
              }}
            >
              <div
                style={{
                  background: "#161619",
                  border: `1.5px solid ${tier.color}`,
                  borderRadius: "4px",
                  padding: "5px 10px",
                  boxShadow: `0 8px 24px rgba(0, 0, 0, 0.8), 0 0 12px ${tier.color}30`,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  minWidth: "120px",
                  textAlign: "center",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                  <span
                    style={{
                      width: "5px",
                      height: "5px",
                      borderRadius: "50%",
                      background: tier.color,
                      boxShadow: `0 0 5px ${tier.color}`,
                    }}
                  />
                  <span style={{ fontSize: "9px", fontWeight: 800, color: tier.color, letterSpacing: "0.04em" }}>
                    {pt.tierLabel || tier.label}
                  </span>
                  <span style={{ fontSize: "8px", color: "#71717a" }}>•</span>
                  <span style={{ fontSize: "9px", fontWeight: 700, color: "#f4f4f5" }}>
                    {pt.monthName}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: "3px", marginTop: "1px" }}>
                  <strong style={{ fontSize: "14px", fontWeight: 900, color: "#ffffff", fontVariantNumeric: "tabular-nums" }}>
                    {pt.count}
                  </strong>
                  <span style={{ fontSize: "10px", fontWeight: 700, color: "#a1a1aa" }}>
                    {pt.count === 1 ? "card" : "cards"}
                  </span>
                </div>

                <div style={{ fontSize: "10px", fontWeight: 800, color: tier.color, fontVariantNumeric: "tabular-nums" }}>
                  {formatBrlK(pt.totalValue)}
                </div>
              </div>
            </div>
          );
        });
      })}
    </div>
  );
}

interface CommercialSafrasTableViewProps {
  data?: TVCohortsResponse;
  tenantId?: string | null;
  onOpenDeal?: (dealId: string) => void;
  onRefresh?: () => void;
  onFullscreen?: () => void;
}

export function CommercialSafrasTableView({
  data = getBaselineSafrasCohortsData(),
  tenantId = "tecfag",
  onOpenDeal,
  onRefresh,
  onFullscreen,
}: CommercialSafrasTableViewProps) {
  const [activeTiers, setActiveTiers] = useState<Record<number, boolean>>({});
  const [isTvModeActive, setIsTvModeActive] = useState(true);
  const [pointsRegistry, setPointsRegistry] = useState<Record<number, Record<number, TVPointData>>>({});
  const chartWrapperRef = useRef<HTMLDivElement>(null);

  // Modal de Drilldown de Oportunidades Sem Classificação
  const [selectedDrilldown, setSelectedDrilldown] = useState<{
    monthKey: string;
    monthLabel: string;
  } | null>(null);

  const tiersConfig = useMemo(() => {
    return data.tiersConfig || [];
  }, [data]);

  // Inicializa activeTiers como true para todos os tiers
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

  return (
    <div className="w-full h-full flex flex-col justify-between overflow-hidden">
      {/* ─── 1. HEADER DO SLIDE 9: SAFRAS & RÉGUA DE-PARA ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-2 mb-1.5 shrink-0">
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-[2px] bg-red-600 px-2 py-0.5 text-[11px] font-mono font-black uppercase tracking-wider text-white shadow-sm flex items-center gap-1.5"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            <span>SAFRAS &amp; RÉGUA DE-PARA</span>
          </motion.div>
          <span className="rounded-[2px] border border-red-500/40 bg-red-950/30 px-2 py-0.5 text-[10px] font-mono font-bold text-red-300">
            ÚLTIMOS 6 MESES
          </span>
          <span className="text-xs sm:text-[13px] font-mono font-bold text-zinc-300 tracking-tight">
            Evolução Mensal de Criação de Oportunidades por Faixa de Valor
          </span>
        </div>

        {/* Top 4 Hero KPIs */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <motion.div
            whileHover={{ y: -1.5, scale: 1.01 }}
            className="rounded-[4px] border border-zinc-800 bg-[#0e0f14] px-3 py-1 text-center"
          >
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-zinc-400 block">
              Total Cards (6m)
            </span>
            <strong className="text-sm font-mono font-extrabold text-white">
              {data.summary.totalCardsAllMonths.toLocaleString("pt-BR")}
            </strong>
          </motion.div>

          <motion.div
            whileHover={{ y: -1.5, scale: 1.01 }}
            className="rounded-[4px] border border-emerald-500/40 bg-emerald-950/20 px-3 py-1 text-center shadow-xs"
          >
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-emerald-400 block">
              Classificados
            </span>
            <strong className="text-sm font-mono font-extrabold text-emerald-400">
              {data.summary.totalClassifiedAllMonths.toLocaleString("pt-BR")}
            </strong>
          </motion.div>

          <motion.div
            whileHover={{ y: -1.5, scale: 1.01 }}
            className="rounded-[4px] border border-amber-500/40 bg-amber-950/20 px-3 py-1 text-center shadow-xs"
          >
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-amber-400 block">
              Sem Classificação
            </span>
            <strong className="text-sm font-mono font-extrabold text-amber-300">
              {data.summary.totalUnclassifiedAllMonths.toLocaleString("pt-BR")}
            </strong>
          </motion.div>

          <motion.div
            whileHover={{ y: -1.5, scale: 1.01 }}
            className="rounded-[4px] border border-cyan-500/40 bg-cyan-950/20 px-3 py-1 text-center shadow-xs"
          >
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-cyan-400 block">
              Volume Faturável
            </span>
            <strong className="text-sm font-mono font-extrabold text-cyan-300">
              {formatBrlK(data.summary.totalValueAllMonths)}
            </strong>
          </motion.div>

          {/* Badge AO VIVO e Botão Rastreador TV */}
          <div className="hidden lg:flex items-center gap-1.5 ml-1">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]" />
              AO VIVO
            </span>

            <motion.button
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setIsTvModeActive((prev) => !prev)}
              className={`rounded-[2px] border px-2.5 py-1 text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                isTvModeActive
                  ? "border-blue-500/60 bg-blue-950/40 text-blue-300 shadow-xs"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400"
              }`}
              title={isTvModeActive ? "Pausar rastreador autônomo da TV" : "Ativar rastreador autônomo da TV"}
            >
              <Tv className="h-3 w-3" />
              <span>{isTvModeActive ? "RASTREADOR TV: ON" : "RASTREADOR TV: OFF"}</span>
            </motion.button>

            {onFullscreen && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={onFullscreen}
                className="rounded-[2px] border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                title="Expandir tela cheia"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </motion.button>
            )}
          </div>
        </div>
      </div>

      {/* ─── 2. BARRA DE LEGENDA / FILTROS DA RÉGUA DE-PARA ─── */}
      <div className="flex items-center justify-between px-2 py-1 bg-zinc-950/70 border border-zinc-800/80 rounded-[4px] mb-2 shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
            Faixas da Régua De-Para:
          </span>
          <span className="text-[10px] font-mono text-zinc-500 hidden sm:inline">
            (Clique para alternar linha no gráfico)
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {tiersConfig.map((tier) => {
            const isVisible = activeTiers[tier.index] !== false;
            return (
              <motion.button
                key={tier.index}
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => toggleTier(tier.index)}
                className={`rounded-[2px] border px-2.5 py-0.5 text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  isVisible
                    ? "bg-zinc-900/90 text-white shadow-xs"
                    : "border-zinc-800/60 bg-zinc-950/40 text-zinc-500 opacity-40"
                }`}
                style={{
                  borderColor: isVisible ? tier.color : undefined,
                }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: tier.color,
                    boxShadow: isVisible ? `0 0 6px ${tier.color}` : "none",
                  }}
                />
                <span style={{ color: isVisible ? tier.color : undefined }}>{tier.label}</span>
                <span className="text-[9px] text-zinc-400">({tier.valueRuleLabel})</span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ─── 3. GRÁFICO CENTRAL MULTILINHAS COM RASTREADOR AUTÔNOMO ─── */}
      <div className="flex-1 min-h-[220px] max-h-[460px] rounded-[4px] border border-zinc-800 bg-[#0c0d12] p-3 flex flex-col relative mb-2">
        <div className="flex items-center justify-between mb-1 px-1 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
              Volume de Cards Criados (Por Mês de Criação)
            </span>
            {isTvModeActive && (
              <span className="text-[9px] font-mono font-bold text-blue-400 bg-blue-950/40 border border-blue-500/30 px-2 py-0.5 rounded-[2px] flex items-center gap-1">
                <Tv className="h-2.5 w-2.5" />
                Rastreador TV Ativo
              </span>
            )}
          </div>
          <span className="text-[10px] font-mono text-zinc-500 hidden md:inline italic">
            * Baseado na data original de criação do negócio no CRM • Funis Máquinas 2.0 e Personnalité 2.0
          </span>
        </div>

        <div ref={chartWrapperRef} className="flex-1 w-full min-h-0 relative">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 12, right: 24, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#1f2026" strokeDasharray="3 3" vertical={false} />
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
                        dy={14}
                        textAnchor="middle"
                        fill={isCurr ? "#ffffff" : "#a1a1aa"}
                        fontSize={11}
                        fontWeight={isCurr ? 800 : 600}
                        fontFamily="monospace"
                      >
                        {payload.value} {isCurr ? "★" : ""}
                      </text>
                      {isCurr && (
                        <text
                          x={0}
                          y={0}
                          dy={26}
                          textAnchor="middle"
                          fill="#ef4444"
                          fontSize={8}
                          fontWeight={800}
                          fontFamily="monospace"
                        >
                          MÊS ATUAL
                        </text>
                      )}
                    </g>
                  );
                }}
                height={36}
              />
              <YAxis
                stroke="#52525b"
                tick={{ fill: "#71717a", fontSize: 10, fontFamily: "monospace", fontWeight: 700 }}
                tickLine={false}
                axisLine={{ stroke: "#3f3f46" }}
                allowDecimals={false}
              />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const monthData = payload[0]?.payload;
                  return (
                    <div className="rounded-[4px] border border-zinc-700 bg-zinc-950/95 p-3 text-white shadow-xl min-w-[210px] text-xs font-mono">
                      <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-2">
                        <strong className="text-red-400 font-bold">{monthData.fullLabel}</strong>
                        {monthData.isCurrentMonth && (
                          <span className="text-[9px] font-black bg-red-600 text-white px-1.5 py-0.5 rounded-[2px]">
                            MÊS ATUAL
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        {tiersConfig.map((t) => {
                          const count = monthData[`tier_${t.index}`] || 0;
                          const val = monthData[`tier_${t.index}_val`] || 0;
                          return (
                            <div key={t.index} className="flex items-center justify-between gap-3 text-[11px]">
                              <div className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                                <span className="text-zinc-300 font-semibold">{t.label}</span>
                              </div>
                              <div className="text-right">
                                <strong style={{ color: t.color }}>{count} cards</strong>
                                <span className="block text-[9px] text-zinc-400">{formatBrlK(val)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 pt-1.5 border-t border-zinc-800 flex flex-col gap-0.5 text-[11px]">
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
                    activeDot={{ r: 7, fill: tier.color, stroke: "#ffffff", strokeWidth: 2 }}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>

          {/* Rastreador Autônomo TV */}
          <CohortAutonomousTvOverlay
            isTvModeActive={isTvModeActive}
            tiersConfig={tiersConfig}
            activeTiers={activeTiers}
            pointsRegistry={pointsRegistry}
            chartWrapperRef={chartWrapperRef}
          />
        </div>
      </div>

      {/* ─── 4. PARTE INFERIOR: BLOCO DEDICADO "CARDS SEM CLASSIFICAÇÃO" COM DRILLDOWN ─── */}
      <div className="rounded-[4px] border border-zinc-800 bg-[#0e0f14] p-2.5 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-amber-400 inline-flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              Cards Sem Classificação (Sem Valor no CRM)
            </span>
            <span className="text-[11px] font-mono text-zinc-500 hidden md:inline">
              — Clique em qualquer mês para abrir a lista de oportunidades e o link direto no CRM
            </span>
          </div>

          <div className="text-[10px] font-mono text-zinc-400 hidden sm:block">
            💡 <em>Ao receber valor via webhook, o card é alocado na régua do mês de criação.</em>
          </div>
        </div>

        {/* Grid de 6 colunas alinhadas aos 6 meses */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
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
                  setSelectedDrilldown({
                    monthKey: m.monthKey,
                    monthLabel: m.fullLabel,
                  })
                }
                className={`rounded-[2px] border p-2 text-left transition-all cursor-pointer relative flex flex-col justify-between ${
                  m.isCurrentMonth
                    ? "border-amber-500/50 bg-amber-950/25 shadow-xs"
                    : "border-zinc-800 bg-zinc-950/60 hover:border-amber-500/40 hover:bg-zinc-900/60"
                }`}
                title={`Clique para ver as ${m.unclassifiedCount} oportunidades sem valor em ${m.monthName}`}
              >
                {m.isCurrentMonth && (
                  <span className="absolute top-1.5 right-1.5 text-[8px] font-mono font-black bg-red-600 text-white px-1.5 py-0.2 rounded-[2px]">
                    ATUAL
                  </span>
                )}

                <div className="flex items-center justify-between pr-8">
                  <span className="text-[11px] font-mono font-bold text-white">
                    {m.monthName}
                  </span>
                  <span className="text-[9px] font-mono text-zinc-500">{m.year}</span>
                </div>

                <div className="flex items-baseline gap-1.5 my-1">
                  <span
                    className={`text-[11px] font-mono font-bold ${
                      hasZero ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    Sem classificação &gt;
                  </span>
                  <strong
                    className={`text-sm sm:text-base font-mono font-black ${
                      hasZero ? "text-emerald-300" : "text-amber-300"
                    }`}
                  >
                    {m.unclassifiedCount}
                  </strong>
                </div>

                <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500 pt-0.5 border-t border-zinc-800/60">
                  <span>{hasZero ? "100% qualificado" : `${unclassPct}% da safra`}</span>
                  <span className="text-blue-400 font-bold inline-flex items-center gap-0.5">
                    Ver cards <ArrowUpRight className="h-2.5 w-2.5" />
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ─── 5. MODAL DE DRILLDOWN DE CARDS SEM CLASSIFICAÇÃO ─── */}
      {selectedDrilldown && (
        <CommercialSafrasDrilldownModal
          isOpen={Boolean(selectedDrilldown)}
          onClose={() => setSelectedDrilldown(null)}
          monthKey={selectedDrilldown.monthKey}
          monthLabel={selectedDrilldown.monthLabel}
          deals={getBaselineUnclassifiedDeals(selectedDrilldown.monthKey)}
          onOpenDeal={onOpenDeal}
        />
      )}
    </div>
  );
}
