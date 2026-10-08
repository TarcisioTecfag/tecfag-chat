import React, { useMemo, useState } from "react";
import {
  Users,
  Zap,
  Layers,
  CircleDollarSign,
  Clock,
  HelpCircle,
} from "lucide-react";
import {
  ALL_PERDAS_PERIODS,
  PerdasCategory,
  PerdasPeriodData,
  PerdasPeriodKey,
} from "@/lib/commercial/perdas-data";

export interface CommercialPerdasTableViewProps {
  periods?: Record<PerdasPeriodKey, PerdasPeriodData>;
  initialPeriod?: PerdasPeriodKey;
  selectedPeriod?: PerdasPeriodKey;
  onSelectPeriod?: (period: PerdasPeriodKey) => void;
  onCategoryClick?: (category: PerdasCategory) => void;
}

// ─── SVG DONUT CHART VECTORIAL & PURO ───
function DonutChart({
  total,
  categories,
  size = 96,
}: {
  total: number;
  categories: PerdasCategory[];
  size?: number;
}) {
  const strokeWidth = 10;
  const radius = 38;
  const circumference = 2 * Math.PI * radius; // ~238.76

  // Calcula segmentos acumulados
  let accumulatedOffset = -circumference / 4; // Começa no topo (12 horas)

  const slices = useMemo(() => {
    let currentOffset = -circumference / 4;
    return categories.map((cat) => {
      const sliceLength = (cat.percent / 100) * circumference;
      const slice = {
        key: cat.key,
        color: cat.colorHex,
        dashArray: `${Math.max(1, sliceLength)} ${circumference - Math.max(1, sliceLength)}`,
        dashOffset: -currentOffset,
      };
      currentOffset += sliceLength;
      return slice;
    });
  }, [categories, circumference]);

  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="rotate-[-90deg] transform"
      >
        {/* Trilho base escuro */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="transparent"
          stroke="#18181b"
          strokeWidth={strokeWidth}
        />
        {/* Fatias coloridas do Donut */}
        {slices.map((slice) => (
          <circle
            key={slice.key}
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke={slice.color}
            strokeWidth={strokeWidth}
            strokeDasharray={slice.dashArray}
            strokeDashoffset={slice.dashOffset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      {/* Totalizador central em destaque */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="font-mono text-base sm:text-lg xl:text-xl font-black text-white tracking-tight leading-none">
          {total >= 1000 ? total.toLocaleString("pt-BR") : total}
        </span>
      </div>
    </div>
  );
}

// ─── ÍCONE DINÂMICO POR CATEGORIA ───
function CategoryIcon({ iconName, colorHex }: { iconName: string; colorHex: string }) {
  const iconProps = { className: "h-3.5 w-3.5 sm:h-4 sm:w-4", style: { color: colorHex } };
  switch (iconName) {
    case "users":
      return <Users {...iconProps} />;
    case "zap":
      return <Zap {...iconProps} />;
    case "layers":
      return <Layers {...iconProps} />;
    case "dollar":
      return <CircleDollarSign {...iconProps} />;
    case "clock":
      return <Clock {...iconProps} />;
    default:
      return <HelpCircle {...iconProps} />;
  }
}

export function CommercialPerdasTableView({
  periods = ALL_PERDAS_PERIODS,
  initialPeriod = "mes_atual",
  selectedPeriod: controlledPeriod,
  onSelectPeriod,
  onCategoryClick,
}: CommercialPerdasTableViewProps) {
  const [internalPeriod, setInternalPeriod] = useState<PerdasPeriodKey>(initialPeriod);
  const activePeriodKey = controlledPeriod ?? internalPeriod;

  const handlePeriodChange = (key: PerdasPeriodKey) => {
    setInternalPeriod(key);
    onSelectPeriod?.(key);
  };

  const activePeriodData: PerdasPeriodData =
    periods[activePeriodKey] || periods.mes_atual || ALL_PERDAS_PERIODS.mes_atual;

  const periodKeys: PerdasPeriodKey[] = ["mes_atual", "mes_passado", "geral_historico"];

  return (
    <div className="flex h-full w-full flex-col justify-between overflow-hidden select-none">
      {/* ─── HEADER DA SEÇÃO: PERDAS DO MÊS & MOTIVOS DE PERDA ─── */}
      <div className="mb-1.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-[#df3d3d]">
            ⬎ PERDAS DO MÊS & MOTIVOS DE PERDA
          </span>
        </div>
      </div>

      {/* ─── CONTAINER PRINCIPAL: COLUNA ESQUERDA (CARDS DONUT) + PAINEL DIREITO (CATEGORIAS) ─── */}
      <div className="flex-1 min-h-0 w-full flex flex-row gap-2.5 sm:gap-3 overflow-hidden">
        {/* ─── COLUNA LATERAL ESQUERDA: 3 CARDS DE HORIZONTE TEMPORAL ─── */}
        <div className="w-[15%] min-w-[150px] max-w-[190px] flex flex-col justify-between gap-2 shrink-0 h-full">
          {periodKeys.map((pKey) => {
            const pData = periods[pKey];
            if (!pData) return null;
            const isSelected = activePeriodKey === pKey;

            return (
              <button
                key={pKey}
                type="button"
                onClick={() => handlePeriodChange(pKey)}
                className={`flex-1 w-full rounded-[4px] bg-[#0c0d12] p-2 sm:p-2.5 flex flex-col items-center justify-center transition-all cursor-pointer text-center relative ${
                  isSelected
                    ? "border border-red-500/80 shadow-[0_0_12px_rgba(239,68,68,0.22)] bg-zinc-950"
                    : "border border-zinc-800/80 hover:border-zinc-700 bg-zinc-950/60"
                }`}
              >
                {/* Donut Chart com Total Central */}
                <div className="my-auto">
                  <DonutChart
                    total={pData.totalCount}
                    categories={pData.categories}
                    size={74}
                  />
                </div>

                {/* Textos Informativos Inferiores */}
                <div className="mt-1 flex flex-col items-center justify-center leading-tight">
                  <span className="font-mono text-[10px] sm:text-[11px] font-black tracking-wider text-emerald-400 uppercase">
                    {pData.title}
                  </span>
                  <span className="font-mono text-[9px] text-zinc-500 mt-0.5">
                    {pData.subtitlePeriod}
                  </span>
                  <span
                    className={`font-mono text-[8.5px] sm:text-[9px] mt-0.5 ${
                      pKey === "mes_atual"
                        ? "text-cyan-400 font-semibold"
                        : pKey === "mes_passado"
                        ? "text-amber-400 font-semibold"
                        : "text-zinc-500"
                    }`}
                  >
                    {pData.subtitleMetric}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* ─── PAINEL DIREITO: MOTIVOS DE PERDA MAPEADOS ─── */}
        <div className="flex-1 min-w-0 h-full rounded-[4px] border border-zinc-800 bg-[#0c0d12] p-3 sm:p-3.5 flex flex-col justify-between overflow-hidden">
          {/* Cabeçalho do Painel Direito */}
          <div className="flex items-center justify-between border-b border-zinc-800/70 pb-2 mb-2 shrink-0">
            <span className="font-mono text-[10px] sm:text-[11px] font-bold text-zinc-300 uppercase tracking-wide">
              MOTIVOS DE PERDA MAPEADOS • {activePeriodData.title} ({activePeriodData.totalCount} PERDAS)
            </span>
            <span className="font-mono text-[9px] sm:text-[10px] text-zinc-500">
              Filtro Selecionado: {activePeriodData.headerFilterLabel}
            </span>
          </div>

          {/* Lista das 5 Categorias de Perda */}
          <div className="flex-1 min-h-0 flex flex-col justify-around gap-2 overflow-hidden">
            {activePeriodData.categories.map((category) => {
              return (
                <div
                  key={category.key}
                  onClick={() => onCategoryClick?.(category)}
                  className="flex flex-col justify-center rounded-[2px] transition-colors cursor-pointer group"
                >
                  {/* Linha Superior: Ícone + Nome da Categoria (Esquerda) e Contagem + Pill % (Direita) */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <CategoryIcon
                        iconName={category.iconName}
                        colorHex={category.colorHex}
                      />
                      <span className="font-mono text-[11px] sm:text-xs xl:text-sm font-bold text-white tracking-wide group-hover:text-zinc-200">
                        {category.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] sm:text-xs xl:text-sm font-black text-white">
                        {category.count} perdas
                      </span>
                      <span
                        className="rounded-[2px] px-1.5 py-0.5 font-mono text-[9.5px] sm:text-[10.5px] font-black text-white tracking-wide shadow-xs"
                        style={{ backgroundColor: category.colorHex }}
                      >
                        {category.percent.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Barra de Progresso Fina */}
                  <div className="w-full h-1 sm:h-1.5 bg-zinc-900 rounded-full overflow-hidden mb-1.5">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(category.percent, 0.4)}%`,
                        backgroundColor: category.colorHex,
                      }}
                    />
                  </div>

                  {/* Tags Subordinadas dos Motivos Específicos com Contadores Táteis */}
                  <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
                    {category.subReasons.map((sub, sIdx) => (
                      <div
                        key={sIdx}
                        className="rounded-[2px] bg-zinc-900/90 border border-zinc-800/80 px-1.5 py-0.5 flex items-center gap-1.5 text-[9px] sm:text-[10px] font-mono text-zinc-300 hover:border-zinc-700 transition-colors"
                      >
                        <span className="text-zinc-500">•</span>
                        <span className="truncate max-w-[260px] sm:max-w-[340px] xl:max-w-none">
                          {sub.label}
                        </span>
                        <span
                          className="rounded-[2px] px-1 py-0.1 font-mono text-[8.5px] sm:text-[9px] font-black text-white"
                          style={{ backgroundColor: category.colorHex }}
                        >
                          {sub.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
