import { useEffect, useState } from "react";
import {
  Copy,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  HelpCircle,
  Info,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  ArrowRightLeft,
  Target,
  GitBranch,
  User,
  Layers,
  Megaphone,
  Play,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Clock,
  ExternalLink,
  FileJson,
  ShieldCheck,
  Sliders,
  CheckCircle,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  availablePaths,
  attributionForLead,
  conversionForLead,
  defaultMappings,
  extractLeads,
  standardTargets,
  type FlowSettings,
  type Mapping,
} from "@/lib/rd-marketing/mapping";

type Field = {
  id: string;
  name: string;
  fieldType: string;
  options: { id: string; label: string }[];
};

type Options = {
  pipelines: { id: string; name: string }[];
  stages: { id: string; name: string; pipelineId: string }[];
  owners: { id: string; name: string }[];
  fields: Record<"contact" | "company" | "deal", Field[]>;
};

type Flow = { id: string; settings: FlowSettings };

type Log = {
  id: string;
  flowId: string;
  status: string;
  dealId?: string;
  message: string;
  createdAt: string;
};

type PreviewResult = Record<"contact" | "company" | "deal", Record<string, unknown>>;

const blank = (): FlowSettings => ({
  name: "",
  enabled: true,
  pipelineId: "",
  stageId: "",
  operatorId: null,
  deduplication: "event",
  eventIdPath: "rd_conversion.id",
  attributionConversion: "last",
  campaignFromFlow: false,
  requireAttribution: true,
  mappings: defaultMappings.map((m) => ({ ...m })),
});

const sample = JSON.stringify(
  {
    leads: [
      {
        uuid: "lead-exemplo",
        name: "Contato de Exemplo",
        email: "contato@empresa.com.br",
        mobile_phone: "11999990000",
        cf_produto: "Seladora Automática Contínua",
        first_conversion: {
          conversion_origin: { source: "Google Ads", campaign: "Campanha Institucional" },
        },
        last_conversion: {
          created_at: new Date().toISOString(),
          content: { identificador: "pedido-de-orcamento-site" },
          conversion_origin: { source: "Google", campaign: "Oferta Máquinas Outubro" },
        },
      },
    ],
  },
  null,
  2,
);

// Formatação amigável de datas e tempos relativos
function formatFullDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function formatRelativeTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    const diffMs = Date.now() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "agora há pouco";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `há ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "ontem";
    return `há ${diffDays} dias`;
  } catch {
    return "";
  }
}

// Chips de sugestão rápida de campos comumente enviados pelo RD Station
const QUICK_RD_FIELDS = [
  { field: "name", label: "Nome", desc: "Nome completo do lead" },
  { field: "email", label: "E-mail", desc: "Endereço de e-mail corporativo" },
  { field: "mobile_phone", label: "WhatsApp / Celular", desc: "Telefone com DDD" },
  { field: "company_name", label: "Empresa", desc: "Razão social ou fantasia" },
  { field: "job_title", label: "Cargo", desc: "Função ou ocupação" },
  { field: "cf_produto", label: "cf_produto", desc: "Campo personalizado de produto" },
];

export function RdMarketingSettings({ tenant }: { tenant: string }) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [id, setId] = useState("");
  const [form, setForm] = useState<FlowSettings>(blank);
  const [url, setUrl] = useState("");
  const [payload, setPayload] = useState(sample);
  const [preview, setPreview] = useState<PreviewResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [copied, setCopied] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [refreshingLogs, setRefreshingLogs] = useState(false);

  async function load(signal?: AbortSignal) {
    const response = await fetch("/api/settings/rd-marketing", { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setFlows(data.flows || []);
    setLogs(data.logs || []);
    setOptions(data.options || null);
  }

  useEffect(() => {
    const controller = new AbortController();
    setOptions(null);
    setFlows([]);
    setLogs([]);
    setId("");
    setForm(blank());
    setUrl("");
    setPreview(null);
    setLoadError("");
    setPayload(sample);
    load(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setLoadError(error.message);
    });
    return () => controller.abort();
  }, [tenant]);

  const change = (patch: Partial<FlowSettings>) => {
    setForm((old) => ({ ...old, ...patch }));
    setPreview(null);
  };

  const changeMapping = (index: number, patch: Partial<Mapping>) =>
    change({
      mappings: form.mappings.map((mapping, i) =>
        i === index ? { ...mapping, ...patch } : mapping,
      ),
    });

  async function perform(action: "save" | "preview" | "rotate") {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/rd-marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id: id || undefined,
          settings: form,
          payload: action === "preview" ? JSON.parse(payload) : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (action === "preview") {
        setPreview(data.results);
        toast.success("Simulação executada com sucesso!");
      } else {
        if (data.id) setId(data.id);
        if (data.webhookUrl) setUrl(data.webhookUrl);
        await load();
        toast.success(
          action === "save"
            ? "Fluxo de integração salvo com sucesso."
            : "Nova URL gerada com sucesso! Atualize o webhook no RD Marketing.",
        );
      }
    } catch (error) {
      if (action === "preview") setPreview(null);
      toast.error(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  }

  const handleCopyUrl = (textToCopy: string) => {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        setCopied(true);
        toast.success("URL do webhook copiada para a área de transferência!");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error("Não foi possível copiar. Selecione e copie o texto manualmente."));
  };

  const handleRefreshLogs = async () => {
    setRefreshingLogs(true);
    try {
      await load();
      toast.success("Histórico de recebimentos atualizado.");
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar histórico.");
    } finally {
      setTimeout(() => setRefreshingLogs(false), 400);
    }
  };

  const updateSimulationTimestamp = () => {
    try {
      const parsed = JSON.parse(payload);
      if (parsed.leads?.[0]?.last_conversion) {
        parsed.leads[0].last_conversion.created_at = new Date().toISOString();
        setPayload(JSON.stringify(parsed, null, 2));
        toast.success("Data e hora atualizadas no JSON de teste.");
      }
    } catch {
      toast.error("JSON inválido no campo de teste.");
    }
  };

  let paths: string[] = [];
  try {
    const lead = extractLeads(JSON.parse(payload))[0];
    paths = availablePaths({
      ...lead,
      rd_attribution: attributionForLead(lead, form),
      rd_conversion: conversionForLead(lead),
    });
  } catch {
    /* Validação contextual */
  }

  const customTargets = options
    ? Object.entries(options.fields).flatMap(([entity, fields]) =>
        fields.map((field) => ({
          value: `${entity}.customFields.${field.id}`,
          label: `${entity === "contact" ? "Contato" : entity === "company" ? "Empresa" : "Negociação"} · ${field.name}`,
          field,
        })),
      )
    : [];

  const selectedFlow = flows.find((f) => f.id === id);

  if (loadError)
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive shadow-soft flex items-start gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-bold text-base">Falha ao carregar parâmetros do RD Marketing</h4>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
        </div>
      </div>
    );

  if (!options)
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-card border border-border rounded-3xl shadow-soft min-h-[220px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
        <span className="text-sm font-semibold text-foreground">Carregando integração RD Marketing...</span>
        <span className="text-xs text-muted-foreground mt-1">Carregando funis, etapas, vendedores e mapeamento</span>
      </div>
    );

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="space-y-6"
    >
      {/* 1. CABEÇALHO DA INTEGRAÇÃO COM BARRA DE SELEÇÃO DE FLUXO */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft transition-all">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 border-b border-border pb-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-black text-sm select-none shadow-soft shrink-0">
              RD
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-primary">
                  Integração Oficial de Leads
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                  <Sparkles className="h-3 w-3" />
                  {tenant.toUpperCase()}
                </span>
              </div>
              <h3 className="text-xl font-extrabold text-foreground mt-0.5">
                RD Station Marketing → CRM Tecfag
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
                Capture leads instantaneamente via Webhook da RD Station. Os dados recebidos geram
                automaticamente contatos, empresas e oportunidades no funil selecionado sem duplicidades.
              </p>
            </div>
          </div>

          {/* Status Geral do Fluxo Atual */}
          {selectedFlow && (
            <div className="flex items-center gap-3 bg-muted/40 border border-border rounded-2xl p-3 shrink-0">
              <div className="text-right">
                <div className="text-[11px] font-bold text-muted-foreground uppercase">Status do Fluxo</div>
                <div className="text-xs font-extrabold text-foreground flex items-center justify-end gap-1.5 mt-0.5">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      selectedFlow.settings.enabled ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"
                    }`}
                  />
                  {selectedFlow.settings.enabled ? "Recebendo Leads" : "Fluxo Pausado"}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* BARRA DE CONTROLE: SELETOR DE FLUXO E BOTÃO NOVO FLUXO */}
        <div className="pt-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <label htmlFor="flow-selector" className="sr-only">
                Selecionar Fluxo de Integração
              </label>
              <SystemTooltip content="Selecione um fluxo existente para editar suas regras ou crie um novo">
                <select
                  id="flow-selector"
                  aria-label="Fluxo de integração"
                  className="w-full h-11 rounded-2xl border border-border bg-background/80 px-4 text-xs font-semibold text-foreground shadow-sm transition-all hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                  value={id}
                  disabled={busy}
                  onChange={(event) => {
                    const flow = flows.find((f) => f.id === event.target.value);
                    setId(flow?.id || "");
                    setForm(flow ? structuredClone(flow.settings) : blank());
                    setUrl("");
                    setPreview(null);
                  }}
                >
                  <option value="">➕ Criar Novo Fluxo de Integração</option>
                  {flows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.settings.name || "Fluxo sem nome"} · {flow.settings.enabled ? "🟢 Ativo" : "⚪ Pausado"}
                    </option>
                  ))}
                </select>
              </SystemTooltip>
            </div>

            <SystemTooltip content="Iniciar a criação de uma nova URL de webhook e regras para uma campanha ou landing page diferente">
              <button
                type="button"
                disabled={busy}
                className="h-11 px-4 inline-flex items-center justify-center gap-2 rounded-2xl bg-muted/60 hover:bg-muted text-foreground text-xs font-bold transition-all border border-border hover:border-primary/40 cursor-pointer disabled:opacity-50"
                onClick={() => {
                  setId("");
                  setForm(blank());
                  setUrl("");
                  setPreview(null);
                  toast.info("Configurando um novo fluxo. Defina o nome e as regras abaixo.");
                }}
              >
                <Plus className="h-4 w-4 text-primary" />
                Novo Fluxo
              </button>
            </SystemTooltip>
          </div>

          {/* Atalho Rápido de Salvar no Topo */}
          <div className="flex items-center gap-2">
            <SystemTooltip content="Salva e sincroniza as definições do fluxo ativo no servidor">
              <button
                type="button"
                disabled={busy || !form.name.trim()}
                className="h-11 px-5 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground text-xs font-extrabold shadow-soft transition-all hover:opacity-90 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                onClick={() => perform("save")}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {id ? "Salvar Alterações" : "Criar e Gerar Webhook"}
              </button>
            </SystemTooltip>
          </div>
        </div>
      </div>

      <fieldset disabled={busy} className="space-y-6 disabled:opacity-75">
        {/* 2. CARD: DESTINO & REGRAS DO FLUXO */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="rounded-3xl border border-border bg-card p-6 shadow-soft space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Target className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-foreground">
                  1. Destino e Regras do Fluxo no CRM
                </h4>
                <p className="text-xs text-muted-foreground">
                  Nomeie o fluxo e escolha para qual funil e etapa comercial os cards serão enviados.
                </p>
              </div>
            </div>

            {/* Switch de Ativação do Fluxo */}
            <div className="flex items-center gap-3 bg-muted/30 border border-border/80 px-3.5 py-2 rounded-2xl">
              <div className="flex flex-col text-right">
                <span className="text-xs font-bold text-foreground">
                  {form.enabled ? "Fluxo Ativo" : "Fluxo Pausado"}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {form.enabled ? "Criando cards no CRM" : "Webhook suspenso"}
                </span>
              </div>
              <SystemTooltip
                content={
                  form.enabled
                    ? "Clique para pausar o fluxo (novos leads não criarão oportunidades no CRM)"
                    : "Clique para ativar o fluxo e permitir que leads recebidos criem cards imediatamente"
                }
              >
                <div className="flex items-center">
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(checked) => change({ enabled: checked })}
                    aria-label="Ativar recebimento de leads"
                  />
                </div>
              </SystemTooltip>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Nome do Fluxo */}
            <div className="space-y-1.5 md:col-span-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  Nome de Identificação do Fluxo
                  <span className="text-destructive">*</span>
                </label>
                <SystemTooltip content="Identificador para a sua equipe localizar facilmente este formulário ou campanha de origem">
                  <span className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </SystemTooltip>
              </div>
              <input
                className="w-full h-10 rounded-xl border border-border bg-background px-3.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                maxLength={120}
                value={form.name}
                onChange={(e) => change({ name: e.target.value })}
                placeholder="Ex.: Formulário Orçamento Site / Landing Page Seladoras Outubro"
              />
            </div>

            {/* Funil de Destino */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-primary" />
                  Funil Comercial de Destino
                  <span className="text-destructive">*</span>
                </label>
                <SystemTooltip content="O funil do CRM Tecfag para onde os leads deste webhook serão direcionados">
                  <span className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </SystemTooltip>
              </div>
              <SystemTooltip content="Selecione o funil comercial no CRM">
                <select
                  className="w-full h-10 rounded-xl border border-border bg-background px-3 text-xs text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                  value={form.pipelineId}
                  onChange={(e) => change({ pipelineId: e.target.value, stageId: "" })}
                >
                  <option value="">Selecione um Funil Comercial...</option>
                  {options.pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </SystemTooltip>
            </div>

            {/* Etapa Inicial */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5 text-primary" />
                  Etapa Inicial do Funil
                  <span className="text-destructive">*</span>
                </label>
                <SystemTooltip content="A etapa inicial do funil onde o novo negócio será criado (ex: Para Triar, Abordagem Inicial)">
                  <span className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </SystemTooltip>
              </div>
              <SystemTooltip content="Selecione a etapa inicial deste funil">
                <select
                  className="w-full h-10 rounded-xl border border-border bg-background px-3 text-xs text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer disabled:opacity-50"
                  value={form.stageId}
                  disabled={!form.pipelineId}
                  onChange={(e) => change({ stageId: e.target.value })}
                >
                  <option value="">
                    {form.pipelineId ? "Selecione a Etapa Inicial..." : "Escolha o funil primeiro"}
                  </option>
                  {options.stages
                    .filter((s) => s.pipelineId === form.pipelineId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </SystemTooltip>
            </div>

            {/* Responsável Padrão */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-primary" />
                  Vendedor / Responsável Padrão
                </label>
                <SystemTooltip content="Colaborador que assumirá o card. Deixe 'Sem responsável' caso queira distribuição manual ou por rodízio">
                  <span className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </SystemTooltip>
              </div>
              <SystemTooltip content="Selecione o vendedor ou deixe em branco">
                <select
                  className="w-full h-10 rounded-xl border border-border bg-background px-3 text-xs text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                  value={form.operatorId || ""}
                  onChange={(e) => change({ operatorId: e.target.value || null })}
                >
                  <option value="">Sem responsável inicial (Triagem / Rodízio)</option>
                  {options.owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </SystemTooltip>
            </div>

            {/* Regra de Criação de Cards */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  Estratégia de Deduplicação e Cards
                </label>
                <SystemTooltip content="Define se cada conversão de formulário vira uma nova negociação ou se reutiliza o lead existente">
                  <span className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </SystemTooltip>
              </div>
              <SystemTooltip content="Escolha a estratégia de criação de cards no CRM">
                <select
                  className="w-full h-10 rounded-xl border border-border bg-background px-3 text-xs text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                  value={form.deduplication}
                  onChange={(e) =>
                    change({
                      deduplication: e.target.value as FlowSettings["deduplication"],
                      eventIdPath:
                        e.target.value === "event" && !form.eventIdPath
                          ? "rd_conversion.id"
                          : form.eventIdPath,
                    })
                  }
                >
                  <option value="event">Um card por conversão (Recomendado — Padrão)</option>
                  <option value="lead">Apenas um card por lead (Ignora novas conversões)</option>
                </select>
              </SystemTooltip>
            </div>

            {/* Campo Identificador do Evento (Quando por evento) */}
            {form.deduplication === "event" && (
              <div className="space-y-1.5 md:col-span-2 rounded-2xl bg-muted/30 border border-border/80 p-3.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                    Campo Identificador de Evento Único (Anti-duplicidade)
                  </label>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    rd_conversion.id (automático)
                  </Badge>
                </div>
                <input
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  list="rd-marketing-paths"
                  value={form.eventIdPath}
                  onChange={(e) => change({ eventIdPath: e.target.value })}
                  placeholder="rd_conversion.id"
                />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Identifica cada conversão de forma determinística pela data e pelo formulário.
                  Tentativas duplicadas de reenvio do mesmo webhook não geram cards duplicados,
                  enquanto o contato e a empresa são reutilizados de forma inteligente.
                </p>
              </div>
            )}
          </div>
        </motion.div>

        {/* 3. CARD: ATRIBUIÇÃO DE MARKETING (FONTE E CAMPANHA) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          className="rounded-3xl border border-border bg-card p-6 shadow-soft space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Megaphone className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-foreground">
                  2. Atribuição de Marketing (Fonte & Campanha)
                </h4>
                <p className="text-xs text-muted-foreground">
                  Configure como a origem do lead (Google, Meta, E-mail) e a campanha são associadas à negociação.
                </p>
              </div>
            </div>

            {/* Botão de Mapeamento Automático Inteligente */}
            <SystemTooltip content="Adiciona automaticamente as variáveis de Fonte e Campanha padrão ao mapeamento de campos do CRM">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs font-extrabold text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer shadow-xs active:scale-[0.98]"
                onClick={() => {
                  change({
                    mappings: [
                      ...form.mappings.filter(
                        (mapping) => !["deal.source", "deal.campaign"].includes(mapping.target),
                      ),
                      ...defaultMappings
                        .filter((mapping) =>
                          ["deal.source", "deal.campaign"].includes(mapping.target),
                        )
                        .map((mapping) => ({ ...mapping })),
                    ],
                  });
                  toast.success("Mapeamento automático de Fonte e Campanha aplicado!");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Mapeamento Automático de Fonte/Campanha
              </button>
            </SystemTooltip>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Conversão Usada na Atribuição */}
            <div className="space-y-1.5 md:col-span-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  Momento de Conversão para Atribuição
                </label>
                <SystemTooltip content="Define qual conversão do histórico do lead terá seus dados de UTM Source e Campaign gravados no card">
                  <span className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </SystemTooltip>
              </div>
              <SystemTooltip content="Escolha entre a primeira ou a última conversão">
                <select
                  className="w-full h-10 rounded-xl border border-border bg-background px-3 text-xs text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                  value={form.attributionConversion || "last"}
                  onChange={(e) =>
                    change({ attributionConversion: e.target.value as "first" | "last" })
                  }
                >
                  <option value="last">
                    Última Conversão (Recomendado — Canal recente que gerou o pedido de contato)
                  </option>
                  <option value="first">
                    Primeira Conversão (Primeiro ponto de contato histórico do lead com a marca)
                  </option>
                </select>
              </SystemTooltip>
            </div>

            {/* Toggle 1: Nome do fluxo como campanha */}
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-muted/30 border border-border/80">
              <div className="space-y-0.5 pr-2">
                <label className="text-xs font-bold text-foreground block cursor-pointer">
                  Usar nome do fluxo como Campanha
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Substitui a tag UTM de campanha pelo nome configurado neste fluxo.
                </p>
              </div>
              <SystemTooltip content="Quando ativo, o nome deste fluxo substitui a campanha da conversão nos campos automáticos do CRM">
                <div className="flex items-center">
                  <Switch
                    checked={!!form.campaignFromFlow}
                    onCheckedChange={(checked) => change({ campaignFromFlow: checked })}
                    aria-label="Usar nome deste fluxo como campanha"
                  />
                </div>
              </SystemTooltip>
            </div>

            {/* Toggle 2: Exigir Fonte e Campanha */}
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-muted/30 border border-border/80">
              <div className="space-y-0.5 pr-2">
                <label className="text-xs font-bold text-foreground block cursor-pointer">
                  Exigir Fonte e Campanha no Card
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Garante que nenhum card seja criado sem parâmetros de origem válidos.
                </p>
              </div>
              <SystemTooltip content="Se o webhook do RD não contiver detalhes de campanha, configure uma campanha fixa ou mapeie o campo">
                <div className="flex items-center">
                  <Switch
                    checked={!!form.requireAttribution}
                    onCheckedChange={(checked) => change({ requireAttribution: checked })}
                    aria-label="Exigir Fonte e Campanha antes de criar o card"
                  />
                </div>
              </SystemTooltip>
            </div>
          </div>
        </motion.div>

        {/* 4. CARD: MAPEAMENTO DE DADOS (DE/PARA RD MARKETING ➔ CRM TECFAG) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.15 }}
          className="rounded-3xl border border-border bg-card p-6 shadow-soft space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ArrowRightLeft className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-extrabold text-foreground">
                    3. Mapeamento de Campos (De / Para)
                  </h4>
                  <Badge variant="secondary" className="text-[10px] font-bold">
                    {form.mappings.length} campos mapeados
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Associe quais campos do RD Station Marketing preencherão os dados de Contato, Empresa e Negociação.
                </p>
              </div>
            </div>

            <SystemTooltip content="Adiciona uma nova linha de correspondência de campo">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs font-extrabold text-primary-foreground bg-primary hover:bg-primary/90 px-4 py-2 rounded-2xl transition-all cursor-pointer shadow-soft active:scale-[0.98]"
                onClick={() =>
                  change({
                    mappings: [
                      ...form.mappings,
                      { source: "", target: "deal.initialNote" },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Adicionar Campo
              </button>
            </SystemTooltip>
          </div>

          {/* CHIPS DE ATALHO RÁPIDO PARA CAMPOS POPULARES DO RD */}
          <div className="rounded-2xl bg-muted/20 border border-border/80 p-3.5 space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block">
              Sugestões rápidas de campos do RD Station:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK_RD_FIELDS.map((item) => (
                <SystemTooltip key={item.field} content={`${item.desc} (clique para adicionar)`}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2.5 py-1 rounded-xl bg-background border border-border hover:border-primary/40 text-foreground transition-all cursor-pointer shadow-2xs hover:bg-muted/40"
                    onClick={() => {
                      const exists = form.mappings.some((m) => m.source === item.field);
                      if (exists) {
                        toast.info(`O campo ${item.field} já está na lista.`);
                        return;
                      }
                      change({
                        mappings: [
                          ...form.mappings,
                          {
                            source: item.field,
                            target:
                              item.field === "company_name"
                                ? "company.name"
                                : item.field === "email"
                                  ? "contact.email"
                                  : item.field === "mobile_phone"
                                    ? "contact.phone"
                                    : item.field === "name"
                                      ? "contact.name"
                                      : "deal.initialNote",
                          },
                        ],
                      });
                      toast.success(`Campo ${item.field} adicionado ao mapeamento.`);
                    }}
                  >
                    <Plus className="h-3 w-3 text-primary" />
                    {item.label}
                  </button>
                </SystemTooltip>
              ))}
            </div>
          </div>

          <datalist id="rd-marketing-paths">
            {paths.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>

          {/* TABELA / LISTA DE MAPEAMENTO DE CAMPOS COM ANIMAÇÃO */}
          <div className="space-y-3">
            <div className="hidden md:grid md:grid-cols-[1.2fr_auto_1.6fr_1fr_auto] gap-3 px-3 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
              <span>Campo no RD Station</span>
              <span className="w-5 text-center">→</span>
              <span>Inserir no CRM Tecfag</span>
              <span>Valor Padrão (Fallback Opcional)</span>
              <span className="w-8 text-center">Ações</span>
            </div>

            <AnimatePresence initial={false}>
              {form.mappings.map((mapping, index) => {
                const custom = customTargets.find((target) => target.value === mapping.target)?.field;
                return (
                  <motion.div
                    key={`${index}-${mapping.target}`}
                    initial={{ opacity: 0, height: 0, y: -6 }}
                    animate={{ opacity: 1, height: "auto", y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-3 rounded-2xl border border-border bg-card/60 hover:bg-card hover:border-primary/30 p-3.5 transition-all shadow-2xs"
                  >
                    <div className="grid items-center gap-3 md:grid-cols-[1.2fr_auto_1.6fr_1fr_auto]">
                      {/* Campo de Origem */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-muted-foreground md:hidden">
                          Campo no RD Station
                        </label>
                        <SystemTooltip content="Nome da chave/variável enviada no webhook (ex: name, email, mobile_phone, cf_produto)">
                          <input
                            aria-label={`Campo de origem ${index + 1}`}
                            className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            list="rd-marketing-paths"
                            value={mapping.source}
                            onChange={(e) => changeMapping(index, { source: e.target.value })}
                            placeholder="Ex.: cf_produto"
                          />
                        </SystemTooltip>
                      </div>

                      {/* Seta Visual */}
                      <div className="hidden md:flex items-center justify-center w-5 text-muted-foreground">
                        <ArrowRight className="h-4 w-4 text-primary" />
                      </div>

                      {/* Campo de Destino */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-muted-foreground md:hidden">
                          Inserir no CRM
                        </label>
                        <SystemTooltip content="Campo onde o dado será gravado no cadastro do contato, empresa ou negociação">
                          <select
                            aria-label={`Campo de destino ${index + 1}`}
                            className="w-full h-9 rounded-xl border border-border bg-background px-2.5 text-xs text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                            value={mapping.target}
                            onChange={(e) =>
                              changeMapping(index, { target: e.target.value, valueMap: undefined })
                            }
                          >
                            <optgroup label="Campos Padrão do CRM">
                              {Object.entries(standardTargets).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </optgroup>
                            {customTargets.length > 0 && (
                              <optgroup label="Campos Personalizados">
                                {customTargets.map((target) => (
                                  <option key={target.value} value={target.value}>
                                    {target.label}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </SystemTooltip>
                      </div>

                      {/* Valor Padrão (Fallback) */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-muted-foreground md:hidden">
                          Valor padrão se vier vazio
                        </label>
                        <SystemTooltip content="Valor preenchido caso o formulário seja enviado com este campo em branco">
                          <input
                            className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            value={
                              Array.isArray(mapping.fallback)
                                ? JSON.stringify(mapping.fallback)
                                : (mapping.fallback ?? "")
                            }
                            onChange={(e) => {
                              let value: Mapping["fallback"] = e.target.value || undefined;
                              if (custom?.fieldType === "multiple") {
                                try {
                                  const parsed = JSON.parse(e.target.value);
                                  if (Array.isArray(parsed)) value = parsed;
                                } catch {
                                  /* Mantém edição */
                                }
                              }
                              changeMapping(index, { fallback: value });
                            }}
                            placeholder={
                              custom?.fieldType === "multiple"
                                ? '["opcao-id"]'
                                : "Se vier vazio..."
                            }
                          />
                        </SystemTooltip>
                      </div>

                      {/* Botão de Excluir Linha */}
                      <div className="flex items-center justify-end md:justify-center">
                        <SystemTooltip content="Remover este campo do mapeamento">
                          <button
                            type="button"
                            aria-label={`Remover mapeamento ${index + 1}`}
                            className="h-9 w-9 inline-flex items-center justify-center rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all cursor-pointer"
                            onClick={() =>
                              change({ mappings: form.mappings.filter((_, i) => i !== index) })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </SystemTooltip>
                      </div>
                    </div>

                    {/* MAPEAMENTO DE VALORES PARA CAMPOS SELECT COM OPÇÕES */}
                    {!!custom?.options.length && (
                      <div className="mt-2 space-y-2 rounded-xl bg-muted/30 border border-border p-3 text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground font-semibold">
                          <Sliders className="h-3.5 w-3.5 text-primary" />
                          <span>Correspondência de Opções do CRM para "{custom.name}":</span>
                        </div>
                        <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                          {custom.options.map((option) => (
                            <div key={option.id} className="space-y-1">
                              <span className="text-[11px] font-bold text-foreground block truncate">
                                {option.label}
                              </span>
                              <SystemTooltip content={`Digite como o valor de '${option.label}' chega no payload do RD`}>
                                <input
                                  className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                                  placeholder="Valor no RD"
                                  value={
                                    Object.entries(mapping.valueMap || {}).find(
                                      ([, value]) => value === option.id,
                                    )?.[0] || ""
                                  }
                                  onChange={(e) => {
                                    const valueMap = Object.fromEntries(
                                      Object.entries(mapping.valueMap || {}).filter(
                                        ([, value]) => value !== option.id,
                                      ),
                                    );
                                    if (e.target.value) valueMap[e.target.value] = option.id;
                                    changeMapping(index, { valueMap });
                                  }}
                                />
                              </SystemTooltip>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* 5. CARD: SIMULADOR INTERATIVO & VALIDAÇÃO DE PAYLOAD */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.2 }}
          className="rounded-3xl border border-border bg-card p-6 shadow-soft space-y-4"
        >
          <div
            className="flex items-center justify-between cursor-pointer select-none"
            onClick={() => setSimulatorOpen(!simulatorOpen)}
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Play className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-foreground">
                  4. Simulador e Validador de Integração
                </h4>
                <p className="text-xs text-muted-foreground">
                  Cole um exemplo de JSON recebido do RD Station para testar os mapeamentos sem alterar dados reais.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-muted-foreground">
                {simulatorOpen ? "Recolher" : "Expandir"}
              </span>
              <div className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition">
                {simulatorOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </div>
          </div>

          <AnimatePresence>
            {simulatorOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22 }}
                className="space-y-4 pt-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SystemTooltip content="Carrega o formato padrão do webhook enviado pelo RD Station">
                      <button
                        type="button"
                        className="text-xs font-semibold text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-xl bg-muted/40 border border-border transition-all cursor-pointer"
                        onClick={() => {
                          setPayload(sample);
                          setPreview(null);
                          toast.info("JSON padrão restaurado.");
                        }}
                      >
                        Restaurar Modelo Padrão
                      </button>
                    </SystemTooltip>

                    <SystemTooltip content="Atualiza o campo last_conversion.created_at para o momento atual">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-xl bg-muted/40 border border-border transition-all cursor-pointer"
                        onClick={updateSimulationTimestamp}
                      >
                        <Clock className="h-3 w-3 text-primary" />
                        Atualizar Data/Hora para Agora
                      </button>
                    </SystemTooltip>
                  </div>

                  <SystemTooltip content="Executa o motor de mapeamento sem gravar nada no banco de dados">
                    <button
                      type="button"
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-3.5 py-1.5 text-xs font-bold shadow-soft transition-all hover:opacity-90 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                      onClick={() => perform("preview")}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      Simular Importação
                    </button>
                  </SystemTooltip>
                </div>

                <div className="relative">
                  <textarea
                    aria-label="Exemplo de dados do RD Marketing"
                    className="w-full h-52 rounded-2xl border border-border bg-muted/30 p-3.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-y"
                    value={payload}
                    onChange={(e) => {
                      setPayload(e.target.value);
                      setPreview(null);
                    }}
                  />
                </div>

                {/* RESULTADOS DA SIMULAÇÃO */}
                {preview !== null && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-3 pt-2 border-t border-border"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        Resultado da Prévia ({preview.length} lead(s) processado(s)):
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Nenhum registro real foi gravado.
                      </span>
                    </div>

                    {preview.map((result, leadIndex) => (
                      <div key={leadIndex} className="grid gap-3 md:grid-cols-3">
                        {(["contact", "company", "deal"] as const).map((entity) => (
                          <div
                            key={entity}
                            className="rounded-2xl bg-card border border-border/80 p-3.5 shadow-2xs space-y-2"
                          >
                            <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
                              <h5 className="font-extrabold text-xs text-foreground flex items-center gap-1.5">
                                {entity === "contact" ? (
                                  <>
                                    <User className="h-3.5 w-3.5 text-primary" />
                                    Contato
                                  </>
                                ) : entity === "company" ? (
                                  <>
                                    <Target className="h-3.5 w-3.5 text-primary" />
                                    Empresa
                                  </>
                                ) : (
                                  <>
                                    <Layers className="h-3.5 w-3.5 text-primary" />
                                    Negociação
                                  </>
                                )}
                              </h5>
                              <Badge variant="outline" className="text-[10px]">
                                Lead {leadIndex + 1}
                              </Badge>
                            </div>

                            <dl className="space-y-1.5 text-xs">
                              {Object.entries(result[entity])
                                .flatMap(([field, value]) =>
                                  field === "customFields"
                                    ? Object.entries(value as Record<string, unknown>).map(
                                        ([key, customValue]) => [
                                          options.fields[entity].find(
                                            (definition) => definition.id === key,
                                          )?.name || key,
                                          customValue,
                                        ],
                                      )
                                    : [
                                        [
                                          standardTargets[
                                            `${entity}.${field}` as keyof typeof standardTargets
                                          ]?.split(" · ")[1] || field,
                                          value,
                                        ],
                                      ],
                                )
                                .filter(
                                  ([, value]) =>
                                    value !== "" && value !== null && value !== undefined,
                                )
                                .map(([label, value], idx) => (
                                  <div
                                    key={idx}
                                    className="flex flex-col bg-muted/20 p-1.5 rounded-lg border border-border/50"
                                  >
                                    <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                      {String(label)}
                                    </dt>
                                    <dd className="mt-0.5 font-medium text-foreground break-words text-xs">
                                      {Array.isArray(value) ? value.join(", ") : String(value)}
                                    </dd>
                                  </div>
                                ))}
                            </dl>
                          </div>
                        ))}
                      </div>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* 6. CARD: WEBHOOK & URL DE INTEGRAÇÃO (SE DISPONÍVEL) */}
        {url && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-3 rounded-3xl border border-primary/40 bg-primary/5 p-6 shadow-soft"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground font-black text-xs">
                  URL
                </div>
                <h4 className="font-extrabold text-sm text-foreground">
                  URL do Webhook para o RD Station Marketing
                </h4>
              </div>

              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                Pronto para receber
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                aria-label="URL da integração"
                readOnly
                className="w-full h-11 rounded-2xl border border-primary/30 bg-background px-4 font-mono text-xs text-foreground focus:outline-none shadow-sm"
                value={url}
              />
              <SystemTooltip content={copied ? "Copiado!" : "Copiar URL do Webhook"}>
                <button
                  type="button"
                  aria-label="Copiar URL"
                  onClick={() => handleCopyUrl(url)}
                  className="h-11 px-4 inline-flex items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold text-xs shadow-soft transition-all hover:opacity-90 active:scale-[0.98] cursor-pointer shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-white" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </SystemTooltip>
            </div>

            <div className="rounded-xl bg-card/60 border border-primary/20 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">
                📌 Como configurar no painel do RD Station Marketing:
              </p>
              <p>
                1. No RD Station, acesse <strong>Automações</strong> ou <strong>Fluxos de Automação</strong>.
              </p>
              <p>
                2. Adicione a ação <strong>"Enviar Leads para Integração"</strong> (Webhook).
              </p>
              <p>
                3. Cole a URL acima. Cada novo lead qualificado será importado automaticamente para o funil do CRM Tecfag.
              </p>
            </div>
          </motion.div>
        )}

        {/* 7. BARRA DE AÇÕES INFERIOR */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-3">
            <SystemTooltip content="Salva todas as configurações de destino, atribuição e mapeamento deste fluxo">
              <button
                type="button"
                disabled={busy || !form.name.trim()}
                className="h-12 px-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground text-xs font-extrabold shadow-soft transition-all hover:opacity-90 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                onClick={() => perform("save")}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar Configurações do Fluxo
              </button>
            </SystemTooltip>

            {id && (
              <SystemTooltip content="Gera uma nova chave de segurança para este fluxo, invalidando o link de webhook antigo">
                <button
                  type="button"
                  disabled={busy}
                  className="h-12 px-5 inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-card hover:bg-muted text-foreground text-xs font-bold transition-all cursor-pointer disabled:opacity-50 shadow-2xs"
                  onClick={() => {
                    if (
                      confirm(
                        "Deseja gerar uma nova URL? O webhook anterior configurado no RD Station deixará de funcionar imediatamente.",
                      )
                    ) {
                      perform("rotate");
                    }
                  }}
                >
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                  Gerar Nova URL de Segurança
                </button>
              </SystemTooltip>
            )}
          </div>
        </div>
      </fieldset>

      {/* 8. CARD: HISTÓRICO DE EVENTOS E RECEBIMENTOS (LOGS) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.25 }}
        className="rounded-3xl border border-border bg-card p-6 shadow-soft space-y-4"
      >
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-foreground">
                Últimos Recebimentos de Webhook
              </h4>
              <p className="text-xs text-muted-foreground">
                Auditoria em tempo real das notificações recebidas da RD Station para este tenant.
              </p>
            </div>
          </div>

          <SystemTooltip content="Recarregar eventos de webhook recentes">
            <button
              type="button"
              disabled={busy || refreshingLogs}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-foreground bg-muted/60 hover:bg-muted border border-border px-3.5 py-1.5 rounded-xl transition-all cursor-pointer"
              onClick={handleRefreshLogs}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-primary ${refreshingLogs ? "animate-spin" : ""}`}
              />
              Atualizar
            </button>
          </SystemTooltip>
        </div>

        {!logs.length ? (
          <div className="flex flex-col items-center justify-center p-8 bg-muted/20 border border-border/80 rounded-2xl text-center">
            <Clock className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-xs font-semibold text-muted-foreground">
              Nenhum recebimento registrado recentemente.
            </p>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              Quando o RD Station disparar o webhook deste fluxo, os eventos aparecerão listados aqui.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {logs.map((log) => {
              const flowName = flows.find((f) => f.id === log.flowId)?.settings.name || "Fluxo Geral";
              const isSuccess = log.status === "created";
              const isDuplicate = log.status === "duplicate";
              const isError = log.status === "error";

              return (
                <div
                  key={log.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border bg-card/60 p-3.5 hover:bg-card transition-all shadow-2xs"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {isSuccess ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : isDuplicate ? (
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                    </div>

                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={isSuccess ? "default" : isDuplicate ? "secondary" : "destructive"}
                          className={`text-[10px] font-bold ${
                            isSuccess
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                              : isDuplicate
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                : "bg-destructive/10 text-destructive border border-destructive/20"
                          }`}
                        >
                          {isSuccess
                            ? "Card Criado no CRM"
                            : isDuplicate
                              ? "Reenvio Ignorado"
                              : "Falha de Processamento"}
                        </Badge>
                        <span className="text-xs font-bold text-foreground">{flowName}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {log.message}
                      </p>
                    </div>
                  </div>

                  {/* Informações de Data / Hora com Tooltip do Sistema */}
                  <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                    {log.dealId && (
                      <SystemTooltip content={`Ver negociação ${log.dealId} no CRM`}>
                        <a
                          href={`/crm/deals/${log.dealId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-lg"
                        >
                          Card #{log.dealId.slice(0, 8)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </SystemTooltip>
                    )}

                    <SystemTooltip
                      content={
                        <div className="flex flex-col gap-0.5 text-xs">
                          <div className="flex items-center gap-1.5 font-bold">
                            <Calendar className="h-3 w-3 text-primary" />
                            <span>{formatFullDate(log.createdAt)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>{formatRelativeTime(log.createdAt)}</span>
                          </div>
                        </div>
                      }
                    >
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground bg-muted/40 border border-border px-2.5 py-1 rounded-xl cursor-default">
                        <Clock className="h-3 w-3 text-primary" />
                        <span>{formatFullDate(log.createdAt).split(" ")[0]}</span>
                        <span className="font-mono">{formatFullDate(log.createdAt).split(" ")[1]}</span>
                      </div>
                    </SystemTooltip>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.section>
  );
}
