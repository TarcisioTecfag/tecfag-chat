import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useChat } from "@/hooks/useChatState";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Expand,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { CommercialForecastDrilldown } from "./CommercialForecastDrilldown";
import {
  CommercialCohortsPanel,
  CommercialResponsibilitiesPanel,
} from "./CommercialAnalysisPanels";
import { CommercialPipelineTableView } from "./CommercialPipelineTableView";
import { CommercialDealFilterModal } from "./CommercialDealFilterModal";
import { CommercialDeparaTableView } from "./CommercialDeparaTableView";
import { CommercialDeparaFilterModal } from "./CommercialDeparaFilterModal";
import {
  BASELINE_PERSONNALITE,
  BASELINE_SEMI_MAQUINAS,
  getBaselineDeals,
  PipelineStageKey,
  SellerPipelineRow,
} from "@/lib/commercial/pipeline-data";
import {
  BASELINE_DEPARA_PERSONNALITE,
  BASELINE_DEPARA_SEMI_MAQUINAS,
  getBaselineDeparaDeals,
  DeparaTierKey,
  SellerDeparaRow,
} from "@/lib/commercial/depara-data";
import { CommercialPrevistasTableView } from "./CommercialPrevistasTableView";
import { CommercialPrevistasFilterModal } from "./CommercialPrevistasFilterModal";
import {
  BASELINE_PREVISTAS_PERSONNALITE,
  BASELINE_PREVISTAS_SEMI_MAQUINAS,
  getBaselinePrevistasDeals,
  PrevistasTierKey,
  SellerPrevistasRow,
} from "@/lib/commercial/previstas-data";
import { CommercialPacingTableView } from "./CommercialPacingTableView";
import { CommercialPacingFilterModal } from "./CommercialPacingFilterModal";
import {
  BASELINE_PACING_PERSONNALITE,
  BASELINE_PACING_SEMI_MAQUINAS,
  getBaselinePacingDeals,
  PacingSellerRow,
  PacingViewMode,
} from "@/lib/commercial/pacing-data";
import { CommercialPerdasTableView } from "./CommercialPerdasTableView";
import {
  ALL_PERDAS_PERIODS,
  PerdasPeriodKey,
} from "@/lib/commercial/perdas-data";
import { CommercialRankingTableView } from "./CommercialRankingTableView";
import { CommercialDiretrizesTableView } from "./CommercialDiretrizesTableView";
import { CommercialDiretrizesDetailModal } from "./CommercialDiretrizesDetailModal";
import { CommercialDiretrizesBreakdownModal } from "./CommercialDiretrizesBreakdownModal";
import {
  BASELINE_DIRETRIZES_KPIS,
  BASELINE_DIRETRIZES_PERSONNALITE,
  BASELINE_DIRETRIZES_MAQUINAS,
  ALL_BASELINE_DIRETRIZES_CONSULTANTS,
  DiretrizesConsultantRow,
} from "@/lib/commercial/diretrizes-crm-data";
import { CommercialTmaTableView } from "./CommercialTmaTableView";
import {
  BASELINE_TMA_KPIS,
  BASELINE_TMA_PERSONNALITE,
  BASELINE_TMA_MAQUINAS,
} from "@/lib/commercial/tma-whatsapp-data";
import { CommercialSafrasTableView } from "./CommercialSafrasTableView";
import { MaturityCohortFullscreenModal } from "./MaturityCohortFullscreenModal";



type Tier = {
  tier: number;
  days: number;
  maxValue: number | null;
  readyCount: number;
  readyValue: number;
  pendingCount: number;
  pendingValue: number;
  expectedValue: number;
};
type Cohort = {
  dealId: string;
  title: string;
  operatorId: string;
  operatorName: string;
  stageName: string;
  value: number;
  tier: number;
  ageDays: number;
  daysRemaining: number;
  expectedValue: number;
};
type Goal = {
  operatorId: string;
  name: string;
  division: string | null;
  activeOnTv: boolean;
  targetValue: number;
  realizedValue: number;
  coveragePercent: number;
  expectedPercent: number;
  dailyRequired: number;
  wonCount: number;
};
type BiData = {
  asOf: string;
  month: string;
  division: string | null;
  settings: {
    slaLimitMinutes: number;
    tvSettings: {
      rotationSeconds?: number;
      activeModules?: number[];
      showSidebar?: boolean;
      liveNotice?: string;
    };
  };
  summary: {
    openCount: number;
    openValue: number;
    wonCount: number;
    faturado: number;
    targetValue: number;
    coveragePercent: number;
  };
  pipeline: Array<{ stageId: string; name: string; count: number; value: number }>;
  maturity: { tiers: Tier[]; cohorts: Cohort[] };
  goals: Goal[];
  losses: {
    currentCount: number;
    currentValue: number;
    previousCount: number;
    previousValue: number;
    historicalCount: number;
    reasons: Array<{ reason: string; count: number; value: number }>;
  };
  tma: {
    answeredCount: number;
    pendingCount: number;
    averageSeconds: number | null;
    slaPercent: number | null;
    byOperator: Array<{
      operatorId: string;
      name: string;
      count: number;
      averageSeconds: number | null;
      pending: number;
    }>;
  };
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const surface = "rounded-[4px] border border-zinc-800 bg-zinc-950/70 p-4";
const badge = "text-[10px] font-mono font-bold uppercase tracking-[.18em] text-red-400";
const TOTAL_SLIDES = 9;

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-[4px] border border-dashed border-zinc-800 p-5 text-xs font-mono text-zinc-400">
      {text}
    </p>
  );
}
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={surface}>
      <p className={badge}>{label}</p>
      <strong className="mt-2 block text-xl font-bold font-mono tracking-tight text-white">
        {value}
      </strong>
      {hint && <p className="mt-1 text-[11px] font-mono text-zinc-400">{hint}</p>}
    </div>
  );
}

export function CommercialBiView() {
  const navigate = useNavigate();
  const { tenant } = useChat();
  const panelRef = useRef<HTMLElement>(null);
  const [division, setDivision] = useState("");
  const [module, setModule] = useState(0);
  const [rotating, setRotating] = useState(true);
  const [data, setData] = useState<BiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDealIds, setSelectedDealIds] = useState<string[]>([]);
  const [pointing, setPointing] = useState(false);
  const [pointResult, setPointResult] = useState<string | null>(null);

  // Monitorar visibilidade da aba para pausar timer em background
  const [isTabVisible, setIsTabVisible] = useState(() =>
    typeof document !== "undefined" ? !document.hidden : true,
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Estados para o Modal de Detalhamento de Negociações (Foto 2)
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSeller, setModalSeller] = useState<SellerPipelineRow | null>(null);
  const [modalStageKey, setModalStageKey] = useState<PipelineStageKey | "all">("all");
  const [modalDivision, setModalDivision] = useState<"personnalite" | "maquinas">("personnalite");

  // Estados para o Modal de Detalhamento De-Para / Maturidade (Slide 2 / Fotos 2 e 3)
  const [deparaModalOpen, setDeparaModalOpen] = useState(false);
  const [deparaModalSeller, setDeparaModalSeller] = useState<SellerDeparaRow | null>(null);
  const [deparaModalTierKey, setDeparaModalTierKey] = useState<DeparaTierKey | "all">("all");

  // Estados para o Modal de Previsão e Diretrizes Temporais (Slide 3 / Fotos 2 e 3)
  const [previstasModalOpen, setPrevistasModalOpen] = useState(false);
  const [previstasModalSeller, setPrevistasModalSeller] = useState<SellerPrevistasRow | null>(null);
  const [previstasModalHorizonKey, setPrevistasModalHorizonKey] = useState<PrevistasTierKey | "all">("all");

  // Estados para o Modal de Pacing / Oportunidades do Dia (Slide 4 / Fotos 1, 2 e 3)
  const [pacingModalOpen, setPacingModalOpen] = useState(false);
  const [pacingModalSeller, setPacingModalSeller] = useState<PacingSellerRow | null>(null);
  const [pacingViewMode, setPacingViewMode] = useState<PacingViewMode>("daily");

  // Estado para o Slide 5 (Perdas do Mês & Motivos de Perda)
  const [perdasPeriod, setPerdasPeriod] = useState<PerdasPeriodKey>("mes_atual");

  // Estados para o Slide 6 (Diretrizes CRM / Fotos 1, 2, 3 e 4)
  const [diretrizesDetailOpen, setDiretrizesDetailOpen] = useState(false);
  const [diretrizesBreakdownOpen, setDiretrizesBreakdownOpen] = useState(false);
  const [diretrizesModalConsultant, setDiretrizesModalConsultant] = useState<DiretrizesConsultantRow | null>(null);

  // Estado para o Slide 8 (Safras & Régua De-Para Fullscreen)
  const [safrasFullscreenOpen, setSafrasFullscreenOpen] = useState(false);



  // Relógio digital e data ao vivo
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const formattedDate = useMemo(() => {
    const day = String(currentTime.getDate()).padStart(2, "0");
    const months = [
      "JAN",
      "FEV",
      "MAR",
      "ABR",
      "MAI",
      "JUN",
      "JUL",
      "AGO",
      "SET",
      "OUT",
      "NOV",
      "DEZ",
    ];
    const m = months[currentTime.getMonth()];
    const y = currentTime.getFullYear();
    return `${day} DE ${m}. DE ${y}`;
  }, [currentTime]);

  const formattedClock = useMemo(() => {
    const h = String(currentTime.getHours()).padStart(2, "0");
    const m = String(currentTime.getMinutes()).padStart(2, "0");
    const s = String(currentTime.getSeconds()).padStart(2, "0");
    return `${h} : ${m} : ${s}`;
  }, [currentTime]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/commercial/bi${division ? `?division=${encodeURIComponent(division)}` : ""}`,
          { credentials: "same-origin", signal },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Falha ao carregar BI comercial.");
        if (!signal?.aborted) setData(body);
      } catch (cause) {
        if (!signal?.aborted)
          setError(cause instanceof Error ? cause.message : "Falha ao carregar BI comercial.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [division],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  // Pausa a rotação enquanto o usuário estiver interagindo com qualquer modal de detalhamento
  const isAnyModalOpen =
    modalOpen ||
    deparaModalOpen ||
    previstasModalOpen ||
    pacingModalOpen ||
    diretrizesDetailOpen ||
    diretrizesBreakdownOpen;

  // Rotação automática de slides (8 módulos TV)
  useEffect(() => {
    if (!rotating || isAnyModalOpen || !isTabVisible) return;
    const rotationSeconds = Math.max(
      10,
      data?.settings?.tvSettings?.rotationSeconds || 24,
    );
    const interval = window.setInterval(() => {
      setModule((current) => (current + 1) % TOTAL_SLIDES);
    }, rotationSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [rotating, module, isAnyModalOpen, isTabVisible, data?.settings?.tvSettings?.rotationSeconds]);

  const openDeal = (dealId: string) =>
    navigate({ to: "/crm/deals/$dealId", params: { dealId }, search: { from: "crm" } });

  const selectedDeals =
    data?.maturity.cohorts.filter((item) => selectedDealIds.includes(item.dealId)) || [];
  const selectedOperatorId = selectedDeals[0]?.operatorId;

  const toggleDeal = (item: Cohort) => {
    setPointResult(null);
    setSelectedDealIds((current) => {
      if (current.includes(item.dealId)) return current.filter((id) => id !== item.dealId);
      const first = data?.maturity.cohorts.find((deal) => deal.dealId === current[0]);
      return first && first.operatorId !== item.operatorId
        ? [item.dealId]
        : [...current, item.dealId];
    });
  };

  const pointResponsibilities = async () => {
    if (!selectedOperatorId || !selectedDeals.length) return;
    setPointing(true);
    setError(null);
    setPointResult(null);
    try {
      const response = await fetch("/api/commercial/directives/point", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorId: selectedOperatorId,
          dealIds: selectedDeals.map((deal) => deal.dealId),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Falha ao pontuar responsabilidades.");
      setPointResult(
        `${body.createdCount} responsabilidade(s) pontuada(s); ${body.alreadyAssignedCount} já registrada(s) hoje.`,
      );
      setSelectedDealIds([]);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao pontuar responsabilidades.");
    } finally {
      setPointing(false);
    }
  };

  const handleCellClick = (
    seller: SellerPipelineRow | null,
    stageKey: PipelineStageKey | "all",
    div: "personnalite" | "maquinas" = "personnalite",
  ) => {
    setModalSeller(seller);
    setModalStageKey(stageKey);
    setModalDivision(seller?.division || div);
    setModalOpen(true);
  };

  const handleHeaderStageClick = (stageKey: PipelineStageKey) => {
    setModalSeller(null);
    setModalStageKey(stageKey);
    setModalOpen(true);
  };

  const activeModalDeals = useMemo(() => {
    if (modalSeller) {
      return getBaselineDeals(modalSeller.sellerId);
    }
    return getBaselineDeals().filter((d) => d.division === modalDivision);
  }, [modalSeller, modalDivision]);

  // Handlers para o Modal de De-Para / Maturidade (Slide 2)
  const handleDeparaCellClick = (seller: SellerDeparaRow, tierKey: DeparaTierKey | "all") => {
    setDeparaModalSeller(seller);
    setDeparaModalTierKey(tierKey);
    setDeparaModalOpen(true);
  };

  const handleDeparaTasksClick = (seller: SellerDeparaRow) => {
    setDeparaModalSeller(seller);
    setDeparaModalTierKey("all");
    setDeparaModalOpen(true);
  };

  const handleDeparaHeaderTierClick = (tierKey: DeparaTierKey) => {
    setDeparaModalSeller(BASELINE_DEPARA_PERSONNALITE.sellers[0]);
    setDeparaModalTierKey(tierKey);
    setDeparaModalOpen(true);
  };

  const activeDeparaModalDeals = useMemo(() => {
    if (deparaModalSeller) {
      return getBaselineDeparaDeals(deparaModalSeller.sellerId);
    }
    return getBaselineDeparaDeals();
  }, [deparaModalSeller]);

  // Handlers para o Modal de Previsão e Diretrizes (Slide 3)
  const handlePrevistasCellClick = (
    seller: SellerPrevistasRow,
    horizonKey: PrevistasTierKey | "all"
  ) => {
    setPrevistasModalSeller(seller);
    setPrevistasModalHorizonKey(horizonKey);
    setPrevistasModalOpen(true);
  };

  const handlePrevistasHeaderTierClick = (horizonKey: PrevistasTierKey) => {
    setPrevistasModalSeller(BASELINE_PREVISTAS_PERSONNALITE.sellers[0]);
    setPrevistasModalHorizonKey(horizonKey);
    setPrevistasModalOpen(true);
  };

  const activePrevistasModalDeals = useMemo(() => {
    if (previstasModalSeller) {
      return getBaselinePrevistasDeals(previstasModalSeller.sellerId);
    }
    return getBaselinePrevistasDeals();
  }, [previstasModalSeller]);

  // Handlers para o Modal de Pacing / Oportunidades do Dia (Slide 4)
  const handlePacingSellerClick = (seller: PacingSellerRow) => {
    setPacingModalSeller(seller);
    setPacingModalOpen(true);
  };

  const activePacingModalDeals = useMemo(() => {
    if (pacingModalSeller) {
      return getBaselinePacingDeals(pacingModalSeller.sellerId);
    }
    return getBaselinePacingDeals();
  }, [pacingModalSeller]);

  return (
    <section
      ref={panelRef}
      className="flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden rounded-[4px] border border-zinc-800 bg-[#0c0d12] text-white shadow-sm select-none"
    >
      {/* ─── CABEÇALHO SUPERIOR EXECUTIVO (FIEL À GESTÃO COMERCIAL & FOTO 1) ─── */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/90 px-4 py-2 sm:px-6 shrink-0 backdrop-blur-sm">
        {/* Esquerda: Logo Oficial e Nome da Empresa */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-[2px] bg-zinc-900 border border-zinc-800/80 px-2.5 py-1">
            <img
              src={tenant === "tecfag" ? "/logo_tecfag.png" : "/logo_valem.jpg"}
              alt={tenant === "tecfag" ? "Tecfag" : "Valem"}
              className="h-5 w-auto max-w-[80px] object-contain"
              onError={(e) => {
                (e.target as HTMLElement).style.display = "none";
              }}
            />
            <span className="font-mono text-sm font-black tracking-tight text-white">
              {tenant === "tecfag" ? "TECFAG" : "VALEM"}
            </span>
          </div>
        </div>

        {/* Centro: Título do War Room */}
        <div className="hidden xl:block text-center">
          <h1 className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-400">
            COMMERCIAL WAR ROOM & SLA • INTELIGÊNCIA OPERACIONAL
          </h1>
        </div>

        {/* Direita: Data + Relógio Digital + Controles + 5 Pontos de Slide */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Data */}
          <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            {formattedDate}
          </span>

          {/* Relógio Digital */}
          <div className="inline-flex items-center gap-1.5 rounded-[2px] border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-200">
            <Clock className="h-3 w-3 text-zinc-400" />
            <span>{formattedClock}</span>
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center gap-1">
            {/* Slide Anterior */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                setModule((current) => (current === 0 ? TOTAL_SLIDES - 1 : current - 1));
              }}
              className="rounded-[2px] border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              title="Slide Anterior"
              aria-label="Slide Anterior"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </motion.button>

            {/* Play / Pause */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => setRotating((current) => !current)}
              className={`rounded-[2px] border p-1 transition-colors cursor-pointer ${
                rotating
                  ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-900/40 hover:text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              }`}
              title={rotating ? "Pausar rotação automática" : "Iniciar rotação automática"}
              aria-label={rotating ? "Pausar rotação" : "Iniciar rotação"}
            >
              {rotating ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
            </motion.button>

            {/* Próximo Slide */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                setModule((current) => (current + 1) % TOTAL_SLIDES);
              }}
              className="rounded-[2px] border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              title="Próximo Slide"
              aria-label="Próximo Slide"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </motion.button>

            {/* Tela Cheia */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => void panelRef.current?.requestFullscreen()}
              className="rounded-[2px] border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              title="Tela Cheia"
            >
              <Expand className="h-3.5 w-3.5" />
            </motion.button>

            {/* Abrir Nova Aba */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => window.open(window.location.href, "_blank")}
              className="rounded-[2px] border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              title="Abrir em Nova Aba"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </motion.button>

            {/* Atualizar */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => void load()}
              disabled={loading}
              className="rounded-[2px] border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              title="Atualizar dados agora"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </motion.button>
          </div>

          {/* 8 Dots de Navegação Angular (Dashboard TV) */}
          <div className="flex items-center gap-1 ml-1">
            {Array.from({ length: TOTAL_SLIDES }, (_, idx) => {
              const isActive = module === idx;
              return (
                <motion.button
                  key={idx}
                  type="button"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => {
                    setModule(idx);
                  }}
                  className={`transition-all duration-200 cursor-pointer ${
                    isActive
                      ? "h-1.5 w-5 rounded-[2px] bg-[#df3d3d] shadow-sm"
                      : "h-1.5 w-2 rounded-[2px] bg-zinc-800 hover:bg-zinc-600"
                  }`}
                  title={`Slide ${idx + 1}`}
                  aria-label={`Ir para Slide ${idx + 1}`}
                />
              );
            })}
          </div>
        </div>
      </header>

      {/* ─── CORPO PRINCIPAL: FIXO E CENTRALIZADO NA TELA (ZERO SCROLLBAR) ─── */}
      <div className="flex-1 w-full overflow-hidden flex flex-col justify-start items-center px-2 py-1 sm:px-3 sm:py-1.5 xl:px-4 xl:py-2">
        <div className="w-full max-w-[1720px] h-full flex flex-col justify-between">
          {error && (
            <p
              role="alert"
              className="mb-2 rounded-[4px] border border-red-800 bg-red-950/40 p-3 text-xs text-red-200 font-mono"
            >
              {error}
            </p>
          )}
          {pointResult && (
            <p
              role="status"
              className="mb-2 rounded-[4px] border border-emerald-700 bg-emerald-950/30 p-2 text-xs text-emerald-200 font-mono"
            >
              {pointResult}
            </p>
          )}

          {loading && !data ? (
            <div className="flex h-72 items-center justify-center text-red-400">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={module}
                initial={{ opacity: 0, y: 7, scale: 0.996 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -7, scale: 0.996 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full flex flex-col justify-between"
              >
                {/* ─── SLIDE 0: PIPELINE POR FASE CRM ─── */}
                {module === 0 && (
                  <CommercialPipelineTableView
                    personnaliteData={BASELINE_PERSONNALITE}
                    semiMaquinasData={BASELINE_SEMI_MAQUINAS}
                    onCellClick={handleCellClick}
                    onHeaderStageClick={handleHeaderStageClick}
                  />
                )}

                {/* ─── SLIDE 1: RESPONSABILIDADES POR DEPARA CWR (RÉPLICA FIEL) ─── */}
                {module === 1 && (
                  <CommercialDeparaTableView
                    personnaliteData={BASELINE_DEPARA_PERSONNALITE}
                    semiMaquinasData={BASELINE_DEPARA_SEMI_MAQUINAS}
                    onCellClick={handleDeparaCellClick}
                    onTasksClick={handleDeparaTasksClick}
                    onHeaderTierClick={handleDeparaHeaderTierClick}
                  />
                )}

                {/* ─── SLIDE 2: RESPONSABILIDADES PREVISTAS CWR (RÉPLICA FIEL) ─── */}
                {module === 2 && (
                  <CommercialPrevistasTableView
                    personnaliteData={BASELINE_PREVISTAS_PERSONNALITE}
                    semiMaquinasData={BASELINE_PREVISTAS_SEMI_MAQUINAS}
                    onCellClick={handlePrevistasCellClick}
                    onHeaderTierClick={handlePrevistasHeaderTierClick}
                  />
                )}

                {/* ─── SLIDE 3: COCKPIT DE METAS & PACING DIÁRIO / SEMANAL (RÉPLICA FIEL) ─── */}
                {module === 3 && (
                  <CommercialPacingTableView
                    personnaliteData={BASELINE_PACING_PERSONNALITE}
                    semiMaquinasData={BASELINE_PACING_SEMI_MAQUINAS}
                    viewMode={pacingViewMode}
                    onToggleViewMode={setPacingViewMode}
                    onSellerClick={handlePacingSellerClick}
                    tenantId={tenant}
                  />
                )}

                {/* ─── SLIDE 4: PERDAS DO MÊS & MOTIVOS DE PERDA (RÉPLICA FIEL) ─── */}
                {module === 4 && (
                  <CommercialPerdasTableView
                    selectedPeriod={perdasPeriod}
                    onSelectPeriod={setPerdasPeriod}
                  />
                )}

                {/* ─── SLIDE 5: RANKING GERAL DE RESPOSTA & SLA (RÉPLICA FIEL) ─── */}
                {module === 5 && <CommercialRankingTableView />}

                {/* ─── SLIDE 6: DIRETRIZES CRM (RÉPLICA FIEL FOTOS 1 E 4) ─── */}
                {module === 6 && (
                  <CommercialDiretrizesTableView
                    kpis={BASELINE_DIRETRIZES_KPIS}
                    personnaliteData={BASELINE_DIRETRIZES_PERSONNALITE}
                    semiMaquinasData={BASELINE_DIRETRIZES_MAQUINAS}
                    onConsultantClick={(consultant) => {
                      setDiretrizesModalConsultant(consultant);
                      setDiretrizesDetailOpen(true);
                    }}
                    onBreakdownClick={() => setDiretrizesBreakdownOpen(true)}
                  />
                )}

                {/* ─── SLIDE 7: TMA WHATSAPP (RÉPLICA FIEL FOTOS 1 E 2) ─── */}
                {module === 7 && (
                  <CommercialTmaTableView
                    kpis={BASELINE_TMA_KPIS}
                    personnaliteData={BASELINE_TMA_PERSONNALITE}
                    semiMaquinasData={BASELINE_TMA_MAQUINAS}
                    tenantId={tenant}
                    onOpenChat={(convId) => {
                      navigate({ to: "/chat" as any, search: { conversationId: convId } as any });
                    }}
                  />
                )}

                {/* ─── SLIDE 8: SAFRAS & RÉGUA DE-PARA (EVOLUÇÃO MENSAL POR FAIXA DE VALOR) ─── */}
                {module === 8 && (
                  <CommercialSafrasTableView
                    tenantId={tenant}
                    onOpenDeal={openDeal}
                    onFullscreen={() => setSafrasFullscreenOpen(true)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}

          {/* Rodapé com Aviso ao Vivo no BI TV */}
          {data?.settings?.tvSettings?.liveNotice && (
            <div className="mt-2 flex items-center justify-center gap-2 rounded-[4px] border border-red-500/40 bg-red-950/20 px-4 py-2 text-center shadow-sm">
              <span className="text-sm">📢</span>
              <span className="text-xs font-bold font-mono tracking-wide text-white">
                {data.settings.tvSettings.liveNotice}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ─── MODAL DETALHADO DE NEGOCIAÇÕES PIPELINE (FOTO 2 SLIDE 1) ─── */}
      <CommercialDealFilterModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        sellerName={
          modalSeller?.sellerName ||
          (modalDivision === "personnalite" ? "Time Personnalité" : "Time Semi (Máquinas)")
        }
        sellerId={modalSeller?.sellerId}
        division={modalDivision}
        initialStageKey={modalStageKey}
        deals={activeModalDeals}
        onOpenDeal={openDeal}
        onOpenProfile={() => {
          navigate({ to: "/commercial-management" as any });
        }}
      />

      {/* ─── MODAL DETALHADO DE MATURIDADE DE-PARA (FOTOS 2 E 3 SLIDE 2) ─── */}
      <CommercialDeparaFilterModal
        isOpen={deparaModalOpen}
        onClose={() => setDeparaModalOpen(false)}
        sellerName={deparaModalSeller?.sellerName || "Diana Gimenes"}
        sellerId={deparaModalSeller?.sellerId}
        division={deparaModalSeller?.division || "personnalite"}
        metaValue={deparaModalSeller?.metaValue || 1_000_000}
        initialTierKey={deparaModalTierKey}
        deals={activeDeparaModalDeals}
        sellerAvatar={deparaModalSeller?.avatarUrl}
        onOpenDeal={(dealId) => openDeal(dealId)}
        onOpenProfile={() => {
          navigate({ to: "/commercial-management" as any });
        }}
        onCallContact={(phone, dealTitle) => {
          console.log(`[DE-PARA] Contatando telefone: ${phone} (${dealTitle})`);
        }}
      />

      {/* ─── MODAL DETALHADO DE PREVISÕES E DIRETRIZES (SLIDE 3 / FOTOS 2 E 3) ─── */}
      <CommercialPrevistasFilterModal
        isOpen={previstasModalOpen}
        onClose={() => setPrevistasModalOpen(false)}
        sellerName={previstasModalSeller?.sellerName || "Diana Gimenes"}
        sellerId={previstasModalSeller?.sellerId}
        division={previstasModalSeller?.division || "personnalite"}
        metaValue={previstasModalSeller?.metaValue || 1_000_000}
        initialHorizonKey={previstasModalHorizonKey}
        deals={activePrevistasModalDeals}
        sellerAvatar={previstasModalSeller?.avatarUrl}
        onOpenDeal={(dealId) => openDeal(dealId)}
        onOpenProfile={() => {
          navigate({ to: "/commercial-management" as any });
        }}
        onCallContact={(phone, dealTitle) => {
          console.log(`[PREVISTAS] Contatando telefone: ${phone} (${dealTitle})`);
        }}
        onSaveDirectives={(dealIds) => {
          console.log(`[PREVISTAS] Salvando diretrizes para ${dealIds.length} oportunidades:`, dealIds);
        }}
      />

      {/* ─── MODAL DETALHADO DE PACING / OPORTUNIDADES DO DIA (SLIDE 4 / FOTO 2) ─── */}
      <CommercialPacingFilterModal
        isOpen={pacingModalOpen}
        onClose={() => setPacingModalOpen(false)}
        sellerName={pacingModalSeller?.sellerName || "Marcelo Nardelli"}
        sellerId={pacingModalSeller?.sellerId}
        division={pacingModalSeller?.division || "personnalite"}
        metaValue={pacingModalSeller?.metaMonthly || 880_000}
        deals={activePacingModalDeals}
        sellerAvatar={pacingModalSeller?.avatarUrl}
        onOpenDeal={(dealId) => openDeal(dealId)}
        onOpenProfile={() => {
          navigate({ to: "/commercial-management" as any });
        }}
        onCallContact={(phone, dealTitle) => {
          console.log(`[PACING] Contatando telefone: ${phone} (${dealTitle})`);
        }}
      />

      {/* ─── MODAL DETALHADO DE TRATATIVAS POR CONSULTOR (DIRETRIZES CRM / FOTO 2) ─── */}
      <CommercialDiretrizesDetailModal
        isOpen={diretrizesDetailOpen}
        onClose={() => setDiretrizesDetailOpen(false)}
        consultant={diretrizesModalConsultant}
        onOpenDeal={(dealId) => openDeal(dealId)}
        onOpenProfile={() => {
          navigate({ to: "/commercial-management" as any });
        }}
      />

      {/* ─── MODAL BREAKDOWN DE TAXA DE EXECUÇÃO (DIRETRIZES CRM / FOTO 3) ─── */}
      <CommercialDiretrizesBreakdownModal
        isOpen={diretrizesBreakdownOpen}
        onClose={() => setDiretrizesBreakdownOpen(false)}
        kpis={BASELINE_DIRETRIZES_KPIS}
        consultants={ALL_BASELINE_DIRETRIZES_CONSULTANTS}
        onSelectConsultant={(c) => {
          setDiretrizesBreakdownOpen(false);
          setDiretrizesModalConsultant(c);
          setDiretrizesDetailOpen(true);
        }}
      />

      {/* ─── MODAL FULLSCREEN DE SAFRAS & RÉGUA DE-PARA (SLIDE 8) ─── */}
      <MaturityCohortFullscreenModal
        isOpen={safrasFullscreenOpen}
        onClose={() => setSafrasFullscreenOpen(false)}
        tenantId={tenant}
        onOpenDeal={openDeal}
      />
    </section>
  );
}


