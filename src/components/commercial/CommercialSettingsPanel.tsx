import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Check,
  Clock,
  ExternalLink,
  Gauge,
  Layers,
  Plus,
  Save,
  Sliders,
  Trash2,
  Tv,
} from "lucide-react";
import { DEFAULT_MATURITY_RULES, type MaturityRule } from "@/lib/commercial/metrics";
import { useChat } from "@/hooks/useChatState";
import { SystemTooltip } from "@/components/ui/tooltip";

export type SettingsSubTab = "sla" | "maturity" | "tv" | "taxonomy";

type Stage = { id: string; name: string; pipelineId: string };

type TvSettings = {
  rotationSeconds: number;
  activeModules: number[];
  showSidebar: boolean;
  liveNotice: string;
};

type FullSettings = {
  maturityRules: MaturityRule[];
  excludedStageIds: string[];
  slaLimitMinutes: number;
  slaBuckets: number[];
  lossReasonCategories: Array<{ name: string; reasons: string[] }>;
  tvSettings: TvSettings;
};

const MODULE_DEFINITIONS = [
  {
    id: 0,
    number: 1,
    title: "Módulo 1 — Pipeline CRM",
    description: "Funil de deals ativos por etapa e por equipe",
    shortName: "Pipeline CRM",
    color: "#ef4444", // red
    barClass: "bg-red-500",
  },
  {
    id: 1,
    number: 2,
    title: "Módulo 2 — Responsabilidades por depara CWR",
    description: "Status dos deals por tier de maturação",
    shortName: "Responsabilidades por depara CWR",
    color: "#f59e0b", // amber
    barClass: "bg-amber-500",
  },
  {
    id: 2,
    number: 3,
    title: "Módulo 3 — Responsabilidades previstas CWR",
    description: "Cronograma futuro e negociações atrasadas/prontas a faturar",
    shortName: "Responsabilidades previstas CWR",
    color: "#10b981", // emerald
    barClass: "bg-emerald-500",
  },
  {
    id: 3,
    number: 4,
    title: "Módulo 4 — Cockpit de Metas",
    description: "Pacing e run rate de cada consultor",
    shortName: "Cockpit de Metas",
    color: "#3b82f6", // blue
    barClass: "bg-blue-500",
  },
  {
    id: 4,
    number: 5,
    title: "Módulo 5 — Motivos de Perda",
    description: "Ranking de categorias de deals perdidos",
    shortName: "Motivos de Perda",
    color: "#8b5cf6", // purple
    barClass: "bg-purple-500",
  },
  {
    id: 5,
    number: 6,
    title: "Módulo 6 — Ranking de SLA",
    description: "Classificação de consultores por TMA",
    shortName: "Ranking de SLA",
    color: "#ec4899", // pink
    barClass: "bg-pink-500",
  },
] as const;

const TIER_METADATA = [
  {
    tierNumber: 1,
    label: "Grupo 1",
    subtitle: "Entrada",
    dotColor: "bg-red-500",
    blockColor: "bg-red-500 text-white",
    borderColor: "border-red-500/30",
    desc: "Tickets de entrada — decisão rápida",
    descColor: "text-red-500 dark:text-red-400",
  },
  {
    tierNumber: 2,
    label: "Grupo 2",
    subtitle: "Ciclo Ágil",
    dotColor: "bg-amber-500",
    blockColor: "bg-amber-500 text-white",
    borderColor: "border-amber-500/30",
    desc: "Tickets baixos/médios — ciclo ágil",
    descColor: "text-amber-500 dark:text-amber-400",
  },
  {
    tierNumber: 3,
    label: "Grupo 3",
    subtitle: "Padrão",
    dotColor: "bg-blue-500",
    blockColor: "bg-blue-500 text-white",
    borderColor: "border-blue-500/30",
    desc: "Tickets médios — ciclo padrão",
    descColor: "text-blue-500 dark:text-blue-400",
  },
  {
    tierNumber: 4,
    label: "Grupo 4",
    subtitle: "Consultivo",
    dotColor: "bg-purple-500",
    blockColor: "bg-purple-500 text-white",
    borderColor: "border-purple-500/30",
    desc: "Tickets altos — processo consultivo",
    descColor: "text-purple-500 dark:text-purple-400",
  },
  {
    tierNumber: 5,
    label: "Grupo 5",
    subtitle: "Enterprise",
    dotColor: "bg-emerald-500",
    blockColor: "bg-emerald-500 text-white",
    borderColor: "border-emerald-500/30",
    desc: "Tickets enterprise — negociação longa",
    descColor: "text-emerald-500 dark:text-emerald-400",
  },
] as const;

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "R$ 0";
  return currencyFormatter.format(value);
}

export function CommercialSettingsPanel() {
  const { setActiveView } = useChat();
  const [subTab, setSubTab] = useState<SettingsSubTab>("sla");
  const [settings, setSettings] = useState<FullSettings | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Carrega configurações do servidor
  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/commercial/settings", {
        credentials: "same-origin",
        signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao carregar configurações.");

      const s = data.settings || {};
      const tv = s.tvSettings || {};

      setSettings({
        maturityRules:
          Array.isArray(s.maturityRules) && s.maturityRules.length === 5
            ? s.maturityRules
            : DEFAULT_MATURITY_RULES,
        excludedStageIds: Array.isArray(s.excludedStageIds) ? s.excludedStageIds : [],
        slaLimitMinutes: typeof s.slaLimitMinutes === "number" ? s.slaLimitMinutes : 15,
        slaBuckets:
          Array.isArray(s.slaBuckets) && s.slaBuckets.length === 3 ? s.slaBuckets : [5, 15, 30],
        lossReasonCategories: Array.isArray(s.lossReasonCategories) ? s.lossReasonCategories : [],
        tvSettings: {
          rotationSeconds: typeof tv.rotationSeconds === "number" ? tv.rotationSeconds : 24,
          activeModules:
            Array.isArray(tv.activeModules) && tv.activeModules.length
              ? tv.activeModules
              : [0, 1, 2, 3, 4, 5],
          showSidebar: tv.showSidebar === true,
          liveNotice: typeof tv.liveNotice === "string" ? tv.liveNotice : "",
        },
      });
      setStages(data.stages || []);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : "Falha ao carregar configurações.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings]);

  // Salva no backend
  const saveAll = async (customSuccessMessage?: string) => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        ...settings,
        lossReasonCategories: settings.lossReasonCategories.map((category) => ({
          name: category.name.trim(),
          reasons: category.reasons.map((reason) => reason.trim()).filter(Boolean),
        })),
      };

      const response = await fetch("/api/commercial/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao salvar configurações.");

      setNotice(customSuccessMessage || "Configurações atualizadas com sucesso.");
      setTimeout(() => setNotice(null), 4000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  };

  // Módulos da TV ativos ordenados
  const activeModulesSorted = useMemo(() => {
    if (!settings) return [];
    return settings.tvSettings.activeModules
      .map((id) => MODULE_DEFINITIONS.find((m) => m.id === id))
      .filter((m): m is (typeof MODULE_DEFINITIONS)[number] => !!m);
  }, [settings]);

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center p-8 text-primary">
        <div className="flex flex-col items-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-xs font-mono font-semibold text-muted-foreground">
            Carregando parâmetros comerciais...
          </p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="rounded-[4px] border border-destructive/30 bg-destructive/5 p-6 text-center text-xs font-mono text-destructive dark:border-destructive/40 dark:bg-destructive/10">
        <p className="font-bold text-sm">Não foi possível carregar as configurações.</p>
        <p className="mt-1">{error || "Tente atualizar a página."}</p>
        <button
          onClick={() => void loadSettings()}
          className="mt-4 inline-flex items-center gap-2 rounded-[2px] bg-primary px-4 py-2 text-xs font-mono font-bold text-primary-foreground hover:brightness-110"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  // Valores dos buckets desconstruídos
  const [b1, b2, b3] = settings.slaBuckets;
  const isBucketsValid = b1 < b2 && b2 < b3;

  // Régua de maturidade desconstruída
  const rules = settings.maturityRules;

  return (
    <div className="space-y-6">
      {/* Sub-navegação das Configurações */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
        <div className="flex flex-wrap items-center gap-1.5 rounded-[4px] bg-muted/20 dark:bg-zinc-900/60 p-1 border border-border/80 dark:border-zinc-800">
          <SystemTooltip content="Configuração dos limites de tempo e faixas de TMA para o semáforo da TV">
            <button
              type="button"
              onClick={() => {
                setSubTab("sla");
                setError(null);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-[2px] font-mono text-xs font-bold tracking-tight transition-all cursor-pointer ${
                subTab === "sla"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/70 dark:hover:bg-zinc-800/60"
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Parâmetros de SLA</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content="Régua dos 5 grupos de maturação (dias e limites em R$) para o BI TV">
            <button
              type="button"
              onClick={() => {
                setSubTab("maturity");
                setError(null);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-[2px] font-mono text-xs font-bold tracking-tight transition-all cursor-pointer ${
                subTab === "maturity"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/70 dark:hover:bg-zinc-800/60"
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Régua De-Para</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content="Controle de rotação, módulos ativos, painel lateral e avisos ao vivo do BI TV">
            <button
              type="button"
              onClick={() => {
                setSubTab("tv");
                setError(null);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-[2px] font-mono text-xs font-bold tracking-tight transition-all cursor-pointer ${
                subTab === "tv"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/70 dark:hover:bg-zinc-800/60"
              }`}
            >
              <Tv className="h-3.5 w-3.5" />
              <span>Controle da TV</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content="Etapas fora do pipeline e taxonomia de motivos de perda do CRM">
            <button
              type="button"
              onClick={() => {
                setSubTab("taxonomy");
                setError(null);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-[2px] font-mono text-xs font-bold tracking-tight transition-all cursor-pointer ${
                subTab === "taxonomy"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/70 dark:hover:bg-zinc-800/60"
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>Categorias & Etapas</span>
            </button>
          </SystemTooltip>
        </div>

        {/* Feedback visual de ações */}
        {notice && (
          <div className="flex items-center gap-2 rounded-[2px] font-mono bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 animate-in fade-in">
            <Check className="h-3.5 w-3.5" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 rounded-[2px] font-mono bg-destructive/10 border border-destructive/30 px-3 py-1.5 text-xs font-semibold text-destructive animate-in fade-in">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* TELA 1: PARÂMETROS DE SLA (TEMPO DE ATENDIMENTO)                           */}
      {/* ========================================================================= */}
      {subTab === "sla" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Header Superior com Tag e Botão de Ação */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-primary">
                TEMPO DE ATENDIMENTO
              </p>
              <h1 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-[-.04em] text-foreground">
                Parâmetros de SLA
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Configure os limites de TMA exibidos no BI TV. Alterações refletem em tempo real nos
                gráficos e alertas.
              </p>
            </div>
            <SystemTooltip content="Salvar limites de SLA principal e faixas de TMA">
              <button
                type="button"
                onClick={() => void saveAll("Parâmetros de SLA salvos com sucesso.")}
                disabled={saving}
                className="flex items-center gap-2 rounded-[2px] font-mono bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:brightness-110 transition cursor-pointer disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? "Salvando..." : "Salvar parâmetros"}</span>
              </button>
            </SystemTooltip>
          </div>

          {/* Card 1: Limite de SLA principal */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">Limite de SLA principal</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tempo máximo aceitável de atendimento. Usado nos alertas do painel e no semáforo da TV.
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div>
                <label className="text-xs font-semibold text-foreground/90 block mb-1.5 font-mono">
                  Limite de SLA (minutos) <span className="text-primary">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  required
                  value={settings.slaLimitMinutes}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(1440, Number(e.target.value) || 1));
                    setSettings((curr) => curr && { ...curr, slaLimitMinutes: val });
                  }}
                  className="w-full rounded-[4px] border border-border/80 bg-background px-3.5 py-2 text-xs font-mono text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-900 transition"
                />
              </div>

              <div className="flex items-center gap-3 rounded-[2px] border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs font-mono text-foreground/90 md:mt-5 dark:border-primary/30 dark:bg-primary/10">
                <Clock className="h-4 w-4 shrink-0 text-primary" />
                <span>
                  Atendimentos acima de{" "}
                  <strong className="text-primary font-bold">
                    {settings.slaLimitMinutes} min
                  </strong>{" "}
                  disparam alerta crítico no painel.
                </span>
              </div>
            </div>
          </section>

          {/* Card 2: Faixas de TMA (Buckets) */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">Faixas de TMA (Buckets)</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Defina os 4 grupos de tempo exibidos nas barras do lado esquerdo do BI TV.
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-foreground/90 block mb-1.5 font-mono">
                  Bucket 1 — limite superior (min) <span className="text-primary">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  required
                  value={b1}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 1;
                    setSettings(
                      (curr) =>
                        curr && { ...curr, slaBuckets: [val, curr.slaBuckets[1], curr.slaBuckets[2]] },
                    );
                  }}
                  className="w-full rounded-[4px] border border-border/80 bg-background px-3.5 py-2 text-xs font-mono text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-900 transition"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground/90 block mb-1.5 font-mono">
                  Bucket 2 — limite superior (min) <span className="text-primary">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  required
                  value={b2}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 1;
                    setSettings(
                      (curr) =>
                        curr && { ...curr, slaBuckets: [curr.slaBuckets[0], val, curr.slaBuckets[2]] },
                    );
                  }}
                  className="w-full rounded-[4px] border border-border/80 bg-background px-3.5 py-2 text-xs font-mono text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-900 transition"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground/90 block mb-1.5 font-mono">
                  Bucket 3 — limite superior (min) <span className="text-primary">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  required
                  value={b3}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 1;
                    setSettings(
                      (curr) =>
                        curr && { ...curr, slaBuckets: [curr.slaBuckets[0], curr.slaBuckets[1], val] },
                    );
                  }}
                  className="w-full rounded-[4px] border border-border/80 bg-background px-3.5 py-2 text-xs font-mono text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-900 transition"
                />
              </div>

              <div className="flex items-center gap-3 rounded-[2px] border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs font-mono text-foreground/90 md:mt-5 dark:border-primary/30 dark:bg-primary/10">
                <Layers className="h-4 w-4 shrink-0 text-primary" />
                <span>
                  Bucket 4 é automático: qualquer atendimento{" "}
                  <strong className="text-primary font-bold">acima de {b3}min</strong>.
                </span>
              </div>
            </div>
          </section>

          {/* Card 3: Preview dos Buckets na TV */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">Preview dos Buckets na TV</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Como as faixas ficam visualmente no BI TV com as configurações atuais.
            </p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Bucket 1 */}
              <div className="rounded-[4px] border border-emerald-500/40 bg-emerald-500/5 p-4 text-center flex flex-col items-center justify-center transition-all hover:bg-emerald-500/10 dark:bg-emerald-950/20">
                <div className="h-2 w-2 rounded-[1px] bg-emerald-500 mb-2 shadow-xs" />
                <strong className="text-xs font-mono font-bold text-foreground">Bucket 1</strong>
                <span className="mt-1 font-mono text-base font-bold text-foreground tracking-tight">
                  Até {b1} min
                </span>
                <span className="mt-1 text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  Excelente — verde na TV
                </span>
              </div>

              {/* Bucket 2 */}
              <div className="rounded-[4px] border border-amber-500/40 bg-amber-500/5 p-4 text-center flex flex-col items-center justify-center transition-all hover:bg-amber-500/10 dark:bg-amber-950/20">
                <div className="h-2 w-2 rounded-[1px] bg-amber-500 mb-2 shadow-xs" />
                <strong className="text-xs font-mono font-bold text-foreground">Bucket 2</strong>
                <span className="mt-1 font-mono text-base font-bold text-foreground tracking-tight">
                  {b1}–{b2} min
                </span>
                <span className="mt-1 text-[11px] font-mono font-semibold text-amber-600 dark:text-amber-400">
                  Atenção — amarelo na TV
                </span>
              </div>

              {/* Bucket 3 */}
              <div className="rounded-[4px] border border-orange-500/40 bg-orange-500/5 p-4 text-center flex flex-col items-center justify-center transition-all hover:bg-orange-500/10 dark:bg-orange-950/20">
                <div className="h-2 w-2 rounded-[1px] bg-orange-500 mb-2 shadow-xs" />
                <strong className="text-xs font-mono font-bold text-foreground">Bucket 3</strong>
                <span className="mt-1 font-mono text-base font-bold text-foreground tracking-tight">
                  {b2}–{b3} min
                </span>
                <span className="mt-1 text-[11px] font-mono font-semibold text-orange-600 dark:text-orange-400">
                  Crítico — laranja na TV
                </span>
              </div>

              {/* Bucket 4 */}
              <div className="rounded-[4px] border border-red-500/40 bg-red-500/5 p-4 text-center flex flex-col items-center justify-center transition-all hover:bg-red-500/10 dark:bg-red-950/20">
                <div className="h-2 w-2 rounded-[1px] bg-red-500 mb-2 shadow-xs" />
                <strong className="text-xs font-mono font-bold text-foreground">Bucket 4</strong>
                <span className="mt-1 font-mono text-base font-bold text-foreground tracking-tight">
                  +{b3} min
                </span>
                <span className="mt-1 text-[11px] font-mono font-semibold text-red-600 dark:text-red-400">
                  Urgente — vermelho na TV
                </span>
              </div>
            </div>

            {/* Aviso Informativo sobre Ordem Crescente */}
            <div
              className={`mt-4 flex items-center gap-2.5 rounded-[2px] border p-3 text-xs font-mono font-medium ${
                isBucketsValid
                  ? "border-primary/20 bg-primary/5 text-foreground/85 dark:border-primary/30 dark:bg-primary/10"
                  : "border-destructive/40 bg-destructive/10 text-destructive font-bold"
              }`}
            >
              <AlertTriangle
                className={`h-4 w-4 shrink-0 ${isBucketsValid ? "text-primary" : "text-destructive"}`}
              />
              <span>
                {isBucketsValid
                  ? "Os valores dos buckets devem ser crescentes: Bucket 1 < Bucket 2 < Bucket 3. Valores inválidos podem causar comportamentos inesperados no BI TV."
                  : "Atenção: Os valores informados não estão em ordem estritamente crescente (Bucket 1 < Bucket 2 < Bucket 3). Corrija antes de salvar."}
              </span>
            </div>
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TELA 2: RÉGUA DE-PARA (MATURIDADE DE PIPELINE)                             */}
      {/* ========================================================================= */}
      {subTab === "maturity" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Header Superior com Tag e Botão de Ação */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-primary">
                MATURIDADE DE PIPELINE
              </p>
              <h1 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-[-.04em] text-foreground">
                Régua De-Para
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Configure os 5 grupos de maturação (dias e limites de valor). O sistema classifica
                cada oportunidade e monitora o tempo de permanência no BI TV.
              </p>
            </div>
            <SystemTooltip content="Salvar faixas e limites da régua de maturação de pipeline">
              <button
                type="button"
                onClick={() => void saveAll("Régua De-Para salva com sucesso.")}
                disabled={saving}
                className="flex items-center gap-2 rounded-[2px] font-mono bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:brightness-110 transition cursor-pointer disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? "Salvando..." : "Salvar régua"}</span>
              </button>
            </SystemTooltip>
          </div>

          {/* Card 1: Configuração dos 5 Grupos (Tiers) */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">
              Configuração dos 5 Grupos (Tiers)
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Personalize os dias tolerados de maturação e o teto financeiro de cada grupo. O último
              grupo abrange todos os deals acima do teto do Grupo 4.
            </p>

            <div className="mt-4 space-y-3">
              {rules.map((rule, index) => {
                const meta = TIER_METADATA[index] || TIER_METADATA[0];
                return (
                  <div
                    key={index}
                    className="grid grid-cols-1 md:grid-cols-[180px_1fr_1fr] items-center gap-4 rounded-[4px] border border-border/80 bg-background/50 p-3.5 transition-colors hover:border-primary/30 dark:border-zinc-800 dark:bg-zinc-900/40"
                  >
                    {/* Identificação do Grupo */}
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-[2px] shrink-0 ${meta.dotColor}`} />
                      <div>
                        <strong className="text-xs font-mono font-bold text-foreground block">
                          {meta.label}
                        </strong>
                        <span className="text-[11px] font-mono text-muted-foreground">{meta.subtitle}</span>
                      </div>
                    </div>

                    {/* Dias de Maturação */}
                    <div>
                      <label className="text-xs font-mono font-semibold text-foreground/90 block mb-1">
                        Dias de Maturação <span className="text-primary">*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="365"
                        required
                        value={rule.days}
                        onChange={(e) => {
                          const daysVal = Math.max(1, Number(e.target.value) || 1);
                          setSettings(
                            (curr) =>
                              curr && {
                                ...curr,
                                maturityRules: curr.maturityRules.map((r, i) =>
                                  i === index ? { ...r, days: daysVal } : r,
                                ),
                              },
                          );
                        }}
                        className="w-full rounded-[4px] border border-border/80 bg-background px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-900 transition"
                      />
                    </div>

                    {/* Valor Máximo ou Caixa Automática */}
                    <div>
                      {index < 4 ? (
                        <div>
                          <label className="text-xs font-mono font-semibold text-foreground/90 block mb-1">
                            Valor Máximo da Faixa (R$) <span className="text-primary">*</span>
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="100"
                            required
                            value={rule.maxValue ?? ""}
                            onChange={(e) => {
                              const maxVal = Math.max(1, Number(e.target.value) || 1);
                              setSettings(
                                (curr) =>
                                  curr && {
                                    ...curr,
                                    maturityRules: curr.maturityRules.map((r, i) =>
                                      i === index ? { ...r, maxValue: maxVal } : r,
                                    ),
                                  },
                              );
                            }}
                            className="w-full rounded-[4px] border border-border/80 bg-background px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-900 transition"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2.5 rounded-[2px] border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-mono text-foreground/90 md:mt-4 dark:border-primary/30 dark:bg-primary/10">
                          <Gauge className="h-4 w-4 shrink-0 text-primary" />
                          <span>
                            Automático: Qualquer deal{" "}
                            <strong className="text-primary font-bold">
                              acima de {formatMoney(rules[3]?.maxValue)}
                            </strong>
                            .
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Card 2: Preview dos 5 Grupos no BI TV */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">
              Preview dos 5 Grupos no BI TV
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Visualização das faixas de maturação calculadas a partir dos valores e dias definidos
              acima.
            </p>

            <div className="mt-4 space-y-2.5">
              {/* Grupo 1 */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[4px] border border-border/80 bg-background/40 p-3.5 transition-all hover:border-red-500/40 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-12 shrink-0 flex-col items-center justify-center rounded-[2px] bg-red-500 text-white shadow-xs font-mono">
                    <span className="text-sm font-bold leading-none">{rules[0]?.days}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-90">
                      dias
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xs font-mono font-bold text-foreground">
                      {rules[0]?.days} DIAS — Grupo 1
                    </h3>
                    <p className="text-[11px] font-mono font-bold text-muted-foreground">
                      até {formatMoney(rules[0]?.maxValue)}
                    </p>
                    <p className="text-[11px] font-mono font-semibold text-red-500 dark:text-red-400">
                      Tickets de entrada — decisão rápida
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="rounded-[2px] font-mono bg-muted/60 dark:bg-zinc-800 px-2.5 py-1 text-[11px] font-bold text-foreground/90 border border-border/80 dark:border-zinc-700">
                    até {formatMoney(rules[0]?.maxValue)}
                  </span>
                </div>
              </div>

              {/* Grupo 2 */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[4px] border border-border/80 bg-background/40 p-3.5 transition-all hover:border-amber-500/40 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-12 shrink-0 flex-col items-center justify-center rounded-[2px] bg-amber-500 text-white shadow-xs font-mono">
                    <span className="text-sm font-bold leading-none">{rules[1]?.days}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-90">
                      dias
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xs font-mono font-bold text-foreground">
                      {rules[1]?.days} DIAS — Grupo 2
                    </h3>
                    <p className="text-[11px] font-mono font-bold text-muted-foreground">
                      {formatMoney(rules[0]?.maxValue)} – {formatMoney(rules[1]?.maxValue)}
                    </p>
                    <p className="text-[11px] font-mono font-semibold text-amber-500 dark:text-amber-400">
                      Tickets baixos/médios — ciclo ágil
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="rounded-[2px] font-mono bg-muted/60 dark:bg-zinc-800 px-2.5 py-1 text-[11px] font-bold text-foreground/90 border border-border/80 dark:border-zinc-700">
                    {formatMoney(rules[0]?.maxValue)} – {formatMoney(rules[1]?.maxValue)}
                  </span>
                </div>
              </div>

              {/* Grupo 3 */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[4px] border border-border/80 bg-background/40 p-3.5 transition-all hover:border-blue-500/40 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-12 shrink-0 flex-col items-center justify-center rounded-[2px] bg-blue-500 text-white shadow-xs font-mono">
                    <span className="text-sm font-bold leading-none">{rules[2]?.days}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-90">
                      dias
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xs font-mono font-bold text-foreground">
                      {rules[2]?.days} DIAS — Grupo 3
                    </h3>
                    <p className="text-[11px] font-mono font-bold text-muted-foreground">
                      {formatMoney(rules[1]?.maxValue)} – {formatMoney(rules[2]?.maxValue)}
                    </p>
                    <p className="text-[11px] font-mono font-semibold text-blue-500 dark:text-blue-400">
                      Tickets médios — ciclo padrão
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="rounded-[2px] font-mono bg-muted/60 dark:bg-zinc-800 px-2.5 py-1 text-[11px] font-bold text-foreground/90 border border-border/80 dark:border-zinc-700">
                    {formatMoney(rules[1]?.maxValue)} – {formatMoney(rules[2]?.maxValue)}
                  </span>
                </div>
              </div>

              {/* Grupo 4 */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[4px] border border-border/80 bg-background/40 p-3.5 transition-all hover:border-purple-500/40 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-12 shrink-0 flex-col items-center justify-center rounded-[2px] bg-purple-500 text-white shadow-xs font-mono">
                    <span className="text-sm font-bold leading-none">{rules[3]?.days}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-90">
                      dias
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xs font-mono font-bold text-foreground">
                      {rules[3]?.days} DIAS — Grupo 4
                    </h3>
                    <p className="text-[11px] font-mono font-bold text-muted-foreground">
                      {formatMoney(rules[2]?.maxValue)} – {formatMoney(rules[3]?.maxValue)}
                    </p>
                    <p className="text-[11px] font-mono font-semibold text-purple-500 dark:text-purple-400">
                      Tickets altos — processo consultivo
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="rounded-[2px] font-mono bg-muted/60 dark:bg-zinc-800 px-2.5 py-1 text-[11px] font-bold text-foreground/90 border border-border/80 dark:border-zinc-700">
                    {formatMoney(rules[2]?.maxValue)} – {formatMoney(rules[3]?.maxValue)}
                  </span>
                </div>
              </div>

              {/* Grupo 5 */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[4px] border border-border/80 bg-background/40 p-3.5 transition-all hover:border-emerald-500/40 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-12 shrink-0 flex-col items-center justify-center rounded-[2px] bg-emerald-500 text-white shadow-xs font-mono">
                    <span className="text-sm font-bold leading-none">{rules[4]?.days}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-90">
                      dias
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xs font-mono font-bold text-foreground">
                      {rules[4]?.days} DIAS — Grupo 5
                    </h3>
                    <p className="text-[11px] font-mono font-bold text-muted-foreground">
                      acima de {formatMoney(rules[3]?.maxValue)}
                    </p>
                    <p className="text-[11px] font-mono font-semibold text-emerald-500 dark:text-emerald-400">
                      Tickets enterprise — negociação longa
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="rounded-[2px] font-mono bg-muted/60 dark:bg-zinc-800 px-2.5 py-1 text-[11px] font-bold text-foreground/90 border border-border/80 dark:border-zinc-700">
                    acima de {formatMoney(rules[3]?.maxValue)}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TELA 3: CONTROLE DA TV (BI TV)                                             */}
      {/* ========================================================================= */}
      {subTab === "tv" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Header Superior com Tag e Duplo Botão de Ação */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-primary">BI TV</p>
              <h1 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-[-.04em] text-foreground">
                Controle da TV
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Gerencie quais módulos aparecem no BI TV, o tempo de rotação e envie avisos ao vivo.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SystemTooltip content="Abrir o cockpit e semáforo da TV em visualização dedicada">
                <button
                  type="button"
                  onClick={() => setActiveView("commercialBi")}
                  className="flex items-center gap-1.5 rounded-[2px] font-mono border border-border/80 bg-card px-3.5 py-2 text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Abrir BI TV</span>
                </button>
              </SystemTooltip>

              <SystemTooltip content="Salvar e aplicar imediatamente as configurações na TV">
                <button
                  type="button"
                  onClick={() => void saveAll("Configurações do BI TV aplicadas com sucesso.")}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-[2px] font-mono bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:brightness-110 transition cursor-pointer disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  <span>{saving ? "Salvando..." : "Aplicar configurações"}</span>
                </button>
              </SystemTooltip>
            </div>
          </div>

          {/* Card 1: Painel lateral fixo (Diretrizes CRM / TMA WhatsApp) */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">
                  Painel lateral fixo (Diretrizes CRM / TMA WhatsApp)
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground max-w-2xl">
                  Define se a coluna esquerda com métricas operacionais e de cobrança deve ser
                  exibida no BI TV. Quando oculto, os módulos da direita ocupam 100% da largura da
                  tela.
                </p>
              </div>
              <span className="rounded-[2px] font-mono border border-border/80 bg-muted/40 dark:bg-zinc-900 px-2.5 py-0.5 text-[10px] font-bold text-muted-foreground dark:border-zinc-800">
                {settings.tvSettings.showSidebar ? "Visível" : "Oculto (Full Width)"}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[4px] border border-border/80 bg-background/50 p-4 transition-colors hover:border-primary/30 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div>
                <h3 className="text-xs font-mono font-bold text-foreground">
                  Exibir Painel Lateral Esquerdo
                </h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {settings.tvSettings.showSidebar
                    ? "Layout com painel lateral ativo: Exibe resumo de diretrizes e TMA fixados à esquerda."
                    : "Layout de tela cheia (100% da largura): O painel lateral fica oculto e os módulos rotativos expandem por todo o monitor."}
                </p>
              </div>

              {/* Switch / Toggle Customizado Angular */}
              <SystemTooltip
                content={
                  settings.tvSettings.showSidebar
                    ? "Clique para ocultar o painel lateral e deixar a TV em tela cheia (100%)"
                    : "Clique para exibir o painel lateral fixo no BI TV"
                }
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.tvSettings.showSidebar}
                  onClick={() => {
                    setSettings((curr) => {
                      if (!curr) return curr;
                      return {
                        ...curr,
                        tvSettings: {
                          ...curr.tvSettings,
                          showSidebar: !curr.tvSettings.showSidebar,
                        },
                      };
                    });
                  }}
                  className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-[2px] transition-colors focus:outline-none ${
                    settings.tvSettings.showSidebar ? "bg-primary" : "bg-muted-foreground/30 dark:bg-zinc-700"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-[2px] bg-white shadow-xs transition-transform ${
                      settings.tvSettings.showSidebar ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </SystemTooltip>
            </div>
          </section>

          {/* Card 2: Módulos rotativos */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">Módulos rotativos</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Selecione quais módulos aparecem na rotação da TV. Pelo menos 1 módulo deve estar
                  ativo.
                </p>
              </div>
              <span className="rounded-[2px] font-mono border border-border/80 bg-muted/40 dark:bg-zinc-900 px-2.5 py-0.5 text-[10px] font-bold text-foreground dark:border-zinc-800">
                {settings.tvSettings.activeModules.length} de {MODULE_DEFINITIONS.length} ativos
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {MODULE_DEFINITIONS.map((mod) => {
                const isActive = settings.tvSettings.activeModules.includes(mod.id);
                return (
                  <div
                    key={mod.id}
                    onClick={() => {
                      setSettings((curr) => {
                        if (!curr) return curr;
                        const currentActive = curr.tvSettings.activeModules;
                        if (isActive) {
                          // Impede desmarcar se for o único ativo
                          if (currentActive.length <= 1) return curr;
                          return {
                            ...curr,
                            tvSettings: {
                              ...curr.tvSettings,
                              activeModules: currentActive.filter((id) => id !== mod.id),
                            },
                          };
                        } else {
                          return {
                            ...curr,
                            tvSettings: {
                              ...curr.tvSettings,
                              activeModules: [...currentActive, mod.id].sort((a, b) => a - b),
                            },
                          };
                        }
                      });
                    }}
                    className={`flex items-center justify-between gap-4 rounded-[4px] border p-3 transition-all cursor-pointer dark:border-zinc-800 ${
                      isActive
                        ? "border-primary/40 bg-background/60 shadow-xs dark:bg-zinc-900/60"
                        : "border-border/60 bg-background/20 opacity-70 hover:opacity-100 dark:bg-zinc-950/40"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Checkbox Customizado Angular */}
                      <div
                        className={`h-4 w-4 rounded-[2px] border flex items-center justify-center transition-colors ${
                          isActive
                            ? "bg-primary border-primary text-primary-foreground shadow-xs"
                            : "border-border/80 bg-background dark:border-zinc-700 dark:bg-zinc-900"
                        }`}
                      >
                        {isActive && <Check className="h-3 w-3 stroke-[3]" />}
                      </div>

                      <div>
                        <strong className="text-xs font-mono font-bold text-foreground block">
                          {mod.title}
                        </strong>
                        <span className="text-[11px] text-muted-foreground">{mod.description}</span>
                      </div>
                    </div>

                    <span
                      className={`rounded-[2px] font-mono px-2 py-0.5 text-[10px] font-bold border ${
                        isActive
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          : "bg-muted dark:bg-zinc-900 text-muted-foreground border-border/80 dark:border-zinc-800"
                      }`}
                    >
                      {isActive ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Card 3: Tempo de rotação */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">Tempo de rotação</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Intervalo em segundos entre a troca automática de módulos na TV.
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div>
                <label className="text-xs font-mono font-semibold text-foreground/90 block mb-1.5">
                  Tempo por módulo (segundos) <span className="text-primary">*</span>
                </label>
                <input
                  type="number"
                  min="10"
                  max="300"
                  required
                  value={settings.tvSettings.rotationSeconds}
                  onChange={(e) => {
                    const sec = Math.max(10, Math.min(300, Number(e.target.value) || 24));
                    setSettings((curr) => {
                      if (!curr) return curr;
                      return {
                        ...curr,
                        tvSettings: {
                          ...curr.tvSettings,
                          rotationSeconds: sec,
                        },
                      };
                    });
                  }}
                  className="w-full rounded-[4px] border border-border/80 bg-background px-3.5 py-2 text-xs font-mono text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-900 transition"
                />
              </div>

              <div className="flex items-center gap-3 rounded-[2px] border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs font-mono text-foreground/90 md:mt-5 dark:border-primary/30 dark:bg-primary/10">
                <Clock className="h-4 w-4 shrink-0 text-primary" />
                <span>
                  Com{" "}
                  <strong className="text-primary font-bold">
                    {activeModulesSorted.length} módulos
                  </strong>{" "}
                  e{" "}
                  <strong className="text-primary font-bold">
                    {settings.tvSettings.rotationSeconds}s
                  </strong>{" "}
                  por módulo, o ciclo completo leva ~
                  <strong className="text-primary font-bold">
                    {(
                      (activeModulesSorted.length * settings.tvSettings.rotationSeconds) /
                      60
                    ).toFixed(1)}
                    min
                  </strong>
                  .
                </span>
              </div>
            </div>

            {/* Barra de Progresso Multi-colorida de Rotação */}
            <div className="mt-5 space-y-2">
              <div className="h-2.5 w-full overflow-hidden rounded-[2px] bg-muted/60 dark:bg-zinc-900 p-0.5 flex gap-1 border border-border/80 dark:border-zinc-800">
                {activeModulesSorted.map((mod) => (
                  <SystemTooltip key={mod.id} content={mod.shortName}>
                    <div
                      style={{ backgroundColor: mod.color }}
                      className="h-full flex-1 rounded-[1px] transition-all duration-300"
                    />
                  </SystemTooltip>
                ))}
              </div>

              {/* Legenda com a sequência de rotação */}
              <p className="text-[11px] font-mono text-muted-foreground flex flex-wrap items-center gap-1 font-medium">
                <span className="font-bold text-foreground">Sequência de rotação:</span>
                {activeModulesSorted.map((mod, index) => (
                  <span key={mod.id} className="inline-flex items-center gap-1">
                    <span style={{ color: mod.color }} className="font-semibold">
                      {mod.shortName}
                    </span>
                    {index < activeModulesSorted.length - 1 && (
                      <span className="text-muted-foreground">→</span>
                    )}
                  </span>
                ))}
              </p>
            </div>
          </section>

          {/* Card 4: Aviso ao vivo */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">Aviso ao vivo</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Mensagem exibida em destaque no rodapé do BI TV. Deixe em branco para ocultar.
            </p>

            <div className="mt-4">
              <label className="text-xs font-mono font-semibold text-foreground/90 block mb-1.5">
                Mensagem de aviso (opcional)
              </label>
              <input
                type="text"
                maxLength={300}
                value={settings.tvSettings.liveNotice}
                onChange={(e) => {
                  const val = e.target.value;
                  setSettings((curr) => {
                    if (!curr) return curr;
                    return {
                      ...curr,
                      tvSettings: {
                        ...curr.tvSettings,
                        liveNotice: val,
                      },
                    };
                  });
                }}
                placeholder="Ex: Reunião de equipe às 14h na sala de vendas."
                className="w-full rounded-[4px] border border-border/80 bg-background px-3.5 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-900 transition"
              />
            </div>
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TELA 4: CATEGORIAS & ETAPAS DO CRM (FUNCIONALIDADE PRESERVADA)              */}
      {/* ========================================================================= */}
      {subTab === "taxonomy" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-primary">
                PIPELINE & PERDAS
              </p>
              <h1 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-[-.04em] text-foreground">
                Categorias & Etapas do CRM
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Exclua etapas do cálculo de funil ativo e associe motivos de perda cadastrados no CRM
                às categorias executivas do BI.
              </p>
            </div>
            <SystemTooltip content="Salvar etapas excluídas e categorias de perda">
              <button
                type="button"
                onClick={() => void saveAll("Categorias e etapas salvas com sucesso.")}
                disabled={saving}
                className="flex items-center gap-2 rounded-[2px] font-mono bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:brightness-110 transition cursor-pointer disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? "Salvando..." : "Salvar alterações"}</span>
              </button>
            </SystemTooltip>
          </div>

          {/* Etapas fora do pipeline ativo */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">
              Etapas fora do pipeline ativo
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Selecione fases como Requalificação ou Congelado que não devem contar como
              oportunidades e maturidade no funil do War Room.
            </p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {stages.map((stage) => {
                const isExcluded = settings.excludedStageIds.includes(stage.id);
                return (
                  <div
                    key={stage.id}
                    onClick={() => {
                      setSettings((curr) => {
                        if (!curr) return curr;
                        return {
                          ...curr,
                          excludedStageIds: isExcluded
                            ? curr.excludedStageIds.filter((id) => id !== stage.id)
                            : [...curr.excludedStageIds, stage.id],
                        };
                      });
                    }}
                    className={`flex items-center gap-2.5 rounded-[4px] border p-2.5 text-xs font-mono transition-all cursor-pointer dark:border-zinc-800 ${
                      isExcluded
                        ? "border-primary/40 bg-primary/5 font-semibold text-foreground dark:bg-primary/10"
                        : "border-border/80 bg-background/50 text-muted-foreground hover:border-primary/30 dark:bg-zinc-900/40"
                    }`}
                  >
                    <div
                      className={`h-4 w-4 rounded-[2px] border flex items-center justify-center shrink-0 transition-colors ${
                        isExcluded
                          ? "bg-primary border-primary text-primary-foreground shadow-xs"
                          : "border-border/80 bg-background dark:border-zinc-700 dark:bg-zinc-900"
                      }`}
                    >
                      {isExcluded && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <span>{stage.name}</span>
                  </div>
                );
              })}
              {!stages.length && (
                <p className="text-xs font-mono text-muted-foreground italic col-span-full">
                  Nenhuma etapa cadastrada no CRM deste tenant.
                </p>
              )}
            </div>
          </section>

          {/* Categorias de perdas */}
          <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 transition-colors">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold font-mono tracking-tight text-foreground">Categorias de perdas</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Agrupe motivos cadastrados no CRM para o ranking executivo do War Room.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSettings((curr) => {
                    if (!curr) return curr;
                    return {
                      ...curr,
                      lossReasonCategories: [
                        ...curr.lossReasonCategories,
                        { name: "", reasons: [] },
                      ],
                    };
                  });
                }}
                className="flex items-center gap-1.5 rounded-[2px] font-mono border border-border/80 bg-background px-3 py-1.5 text-xs font-bold text-primary hover:bg-muted transition cursor-pointer dark:border-zinc-800 dark:bg-zinc-900"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Adicionar categoria</span>
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {settings.lossReasonCategories.map((category, index) => (
                <div
                  key={index}
                  className="rounded-[4px] border border-border/80 bg-background/40 p-4 transition-colors hover:border-border dark:border-zinc-800 dark:bg-zinc-900/40"
                >
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={`Nome da categoria ${index + 1}`}
                      value={category.name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSettings((curr) => {
                          if (!curr) return curr;
                          return {
                            ...curr,
                            lossReasonCategories: curr.lossReasonCategories.map((cat, i) =>
                              i === index ? { ...cat, name: val } : cat,
                            ),
                          };
                        });
                      }}
                      placeholder="Nome da categoria (ex: Preço / Condição Comercial)"
                      className="flex-1 rounded-[4px] border border-border/80 bg-background px-3 py-2 text-xs font-mono font-bold text-foreground outline-none focus:border-primary dark:border-zinc-800 dark:bg-zinc-900 transition"
                    />
                    <SystemTooltip content="Excluir esta categoria">
                      <button
                        type="button"
                        onClick={() => {
                          setSettings((curr) => {
                            if (!curr) return curr;
                            return {
                              ...curr,
                              lossReasonCategories: curr.lossReasonCategories.filter(
                                (_, i) => i !== index,
                              ),
                            };
                          });
                        }}
                        className="rounded-[2px] border border-destructive/20 p-2 text-destructive hover:bg-destructive/10 transition cursor-pointer dark:border-destructive/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </SystemTooltip>
                  </div>

                  <div className="mt-3">
                    <label className="text-[11px] font-mono font-semibold text-muted-foreground block mb-1">
                      Motivos do CRM associados (um por linha):
                    </label>
                    <textarea
                      rows={3}
                      value={category.reasons.join("\n")}
                      onChange={(e) => {
                        const lines = e.target.value.split("\n");
                        setSettings((curr) => {
                          if (!curr) return curr;
                          return {
                            ...curr,
                            lossReasonCategories: curr.lossReasonCategories.map((cat, i) =>
                              i === index ? { ...cat, reasons: lines } : cat,
                            ),
                          };
                        });
                      }}
                      placeholder="Ex:&#10;Preço alto&#10;Falta de verba do cliente"
                      className="w-full rounded-[4px] border border-border/80 bg-background p-3 text-xs text-foreground outline-none focus:border-primary transition resize-y font-mono dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </div>
                </div>
              ))}
              {!settings.lossReasonCategories.length && (
                <p className="text-xs font-mono text-muted-foreground italic">
                  Nenhuma categoria cadastrada. Os motivos aparecerão sem agrupamento no BI.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
