import { useEffect, useState } from "react";
import {
  ShoppingBag,
  Globe,
  MessageSquare,
  ShieldCheck,
  Lock,
  Check,
  ChevronDown,
  HelpCircle,
  Search,
  Hash,
  Link2,
  FileText,
  Tag,
  Truck,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Loader2,
  CalendarClock,
  KeyRound,
  Layers,
  Store,
  SlidersHorizontal,
  FlaskConical,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import {
  defaultVtexSettings,
  type VtexSettings,
  type VtexResult,
  type VtexChannel,
} from "@/lib/vtex/contract";
import { formatVtexAnswer } from "@/lib/vtex/turn";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemDateTimePicker } from "@/components/ui/system-date-time-picker";

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";
const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer";

type State = {
  revision: number;
  settings: VtexSettings;
  hasCredentials: boolean;
  encryptionReady: boolean;
};

const POLICY_META: Record<
  keyof VtexSettings["channels"]["livechat"],
  { label: string; description: string; tooltip: string }
> = {
  catalog: {
    label: "Especificações",
    description: "Ficha técnica, modelo, tensão, dimensões e descrição oficial.",
    tooltip:
      "Permite que a IA confirme dados técnicos oficiais do catálogo VTEX (nome do SKU, voltagem, especificações e link do produto).",
  },
  price: {
    label: "Preço público",
    description: "Valor de tabela pública cadastrado na oferta comercial.",
    tooltip:
      "Quando marcado, a IA pode informar o preço público do SKU. Quando desmarcado (recomendado no WhatsApp B2B/industrial), o preço é omitido e encaminhado ao consultor.",
  },
  availability: {
    label: "Disponibilidade",
    description: "Confirmação de saldo disponível em estoque para o SKU.",
    tooltip:
      "Permite informar ao cliente se o item possui estoque imediato no Seller configurado na VTEX.",
  },
  shipping: {
    label: "Frete público",
    description: "Simulação de prazo e valor de entrega via CEP.",
    tooltip:
      "Habilita a simulação anônima de frete e prazo de entrega na API de Checkout da VTEX quando o cliente informa um CEP válido.",
  },
};

const QUERY_KIND_OPTIONS: Array<{
  value: "sku" | "url" | "term";
  label: string;
  shortDesc: string;
  placeholder: string;
  tooltip: string;
}> = [
  {
    value: "sku",
    label: "SKU",
    shortDesc: "Busca exata pelo ID numérico do item na VTEX",
    placeholder: "Ex: 147",
    tooltip: "Consulta diretamente o código identificador único do SKU (itemId) no catálogo VTEX.",
  },
  {
    value: "url",
    label: "URL do produto",
    shortDesc: "Extrai o slug da página da loja e valida o domínio",
    placeholder: "Ex: https://www.sualoja.com.br/seladora-s100/p",
    tooltip: "Simula quando o visitante envia o link de uma página de produto ou conversa a partir dela.",
  },
  {
    value: "term",
    label: "Nome ou termo",
    shortDesc: "Pesquisa textual por nome, modelo ou referência",
    placeholder: "Ex: Seladora de bancada",
    tooltip: "Realiza busca textual inteligente no catálogo VTEX pelo nome ou referência do equipamento.",
  },
];

const CHANNEL_OPTIONS: Array<{
  value: VtexChannel;
  label: string;
  shortDesc: string;
  tooltip: string;
}> = [
  {
    value: "livechat",
    label: "Site",
    shortDesc: "Aplica as permissões configuradas para o Widget Web",
    tooltip: "Simula a resposta aplicando as políticas de exibição do canal Site (Live Chat).",
  },
  {
    value: "whatsapp",
    label: "WhatsApp",
    shortDesc: "Aplica as permissões restritas do canal WhatsApp",
    tooltip: "Simula a resposta aplicando as políticas do canal WhatsApp (ex.: ocultando preço se desmarcado).",
  },
];

const INTENT_OPTIONS: Array<{
  value: "details" | "price" | "shipping";
  label: string;
  shortDesc: string;
  tooltip: string;
}> = [
  {
    value: "details",
    label: "Especificações",
    shortDesc: "Ficha técnica, variantes e resumo do produto",
    tooltip: "Testa a formatação de resposta para dúvidas técnicas e especificações do produto.",
  },
  {
    value: "price",
    label: "Preço",
    shortDesc: "Valor comercial e disponibilidade em estoque",
    tooltip: "Testa como a IA responde quando o cliente pergunta o preço e estoque do produto.",
  },
  {
    value: "shipping",
    label: "Frete",
    shortDesc: "Cálculo de entrega e prazo para o CEP informado",
    tooltip: "Testa a simulação de transporte e SLA de entrega (requer preenchimento do CEP de teste).",
  },
];

export function VtexStoreCard({ backendUrl }: { backendUrl: string }) {
  const { sessionRole, tenant } = useChat();
  const [state, setState] = useState<State | null>(null);
  const [settings, setSettings] = useState(defaultVtexSettings);
  const [appKey, setAppKey] = useState(""),
    [appToken, setAppToken] = useState("");
  const [clearCredentials, setClearCredentials] = useState(false);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"sku" | "url" | "term">("sku"),
    [value, setValue] = useState("");
  const [channel, setChannel] = useState<VtexChannel>("livechat");
  const [intent, setIntent] = useState<"details" | "price" | "shipping">("details");
  const [postalCode, setPostalCode] = useState(""),
    [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState<VtexResult | null>(null);

  // Estados de UI para Popovers customizados e Data de referência
  const [kindPopoverOpen, setKindPopoverOpen] = useState(false);
  const [channelPopoverOpen, setChannelPopoverOpen] = useState(false);
  const [intentPopoverOpen, setIntentPopoverOpen] = useState(false);
  const [credentialsExpanded, setCredentialsExpanded] = useState(false);
  const [simulationRefDate, setSimulationRefDate] = useState<Date | undefined>(() => new Date());

  useEffect(() => {
    if (sessionRole !== "admin") return;
    const controller = new AbortController();
    setState(null);
    setMessage("");
    setAppKey("");
    setAppToken("");
    setResult(null);
    void fetch(`${backendUrl}/api/livechat/vtex-config`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar a integração.");
        if (!controller.signal.aborted) {
          setState(data);
          setSettings(data.settings);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [backendUrl, tenant, sessionRole]);

  if (sessionRole !== "admin") return null;

  async function submit(action: "save" | "test") {
    if (!state || busy) return;
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const body =
        action === "save"
          ? {
              action,
              expectedRevision: state.revision,
              settings,
              ...(appKey ? { appKey } : {}),
              ...(appToken ? { appToken } : {}),
              clearCredentials,
            }
          : {
              action,
              settings,
              channel,
              intent,
              query: { kind, value, quantity, ...(postalCode ? { postalCode } : {}) },
            };
      const response = await fetch(`${backendUrl}/api/livechat/vtex-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
      if (action === "save") {
        setState(data);
        setSettings(data.settings);
        setAppKey("");
        setAppToken("");
        setClearCredentials(false);
        setMessage("Integração salva. A habilitação do SDR e do site continua independente.");
      } else {
        setResult(data.result);
        setMessage("Consulta de teste concluída sem salvar configurações ou criar pedidos.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro de comunicação.");
    } finally {
      setBusy(false);
    }
  }

  const selectedKindOption =
    QUERY_KIND_OPTIONS.find((item) => item.value === kind) || QUERY_KIND_OPTIONS[0];
  const selectedChannelOption =
    CHANNEL_OPTIONS.find((item) => item.value === channel) || CHANNEL_OPTIONS[0];
  const selectedIntentOption =
    INTENT_OPTIONS.find((item) => item.value === intent) || INTENT_OPTIONS[0];

  const isSuccessMessage =
    message.includes("Integração salva") || message.includes("Consulta de teste concluída");

  return (
    <section
      className="rounded-2xl border border-border bg-card p-6 shadow-soft space-y-6"
      aria-label="Integração VTEX"
    >
      {/* ── Cabeçalho Principal ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-foreground">Loja VTEX</h3>
              {state && (
                <>
                  <SystemTooltip
                    content={
                      settings.enabled
                        ? "Consultas em tempo real ao catálogo VTEX estão habilitadas para apoiar o atendimento."
                        : "A integração VTEX está configurada em modo inativo; a IA não fará consultas externas até ser ativada."
                    }
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                        settings.enabled
                          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/25"
                          : "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          settings.enabled ? "bg-emerald-500" : "bg-muted-foreground"
                        }`}
                      />
                      {settings.enabled ? "Consultas Ativas" : "Consultas Desativadas"}
                    </span>
                  </SystemTooltip>

                  <SystemTooltip
                    content={
                      state.hasCredentials
                        ? "AppKey e AppToken estão criptografados com AES-256-GCM no banco de dados."
                        : "Operando em modo de consulta pública (sem necessidade de AppKey/AppToken)."
                    }
                  >
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                      <ShieldCheck className="h-3 w-3" />
                      {state.hasCredentials ? "Credenciais Criptografadas" : "Modo Catálogo Público"}
                    </span>
                  </SystemTooltip>

                  <SystemTooltip content="Controle de concorrência otimista (impede que dois administradores sobrescrevam alterações simultaneamente).">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-muted/70 border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                      Rev #{state.revision}
                    </span>
                  </SystemTooltip>
                </>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Catálogo oficial, preço e simulação pública de frete. Configuração por empresa com isolamento por canal.
            </p>
          </div>
        </div>
      </div>

      {/* ── Banner de Feedback / Status ───────────────────────────────────── */}
      {message && (
        <div
          role="status"
          className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs whitespace-pre-wrap ${
            isSuccessMessage
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
          }`}
        >
          {isSuccessMessage ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          )}
          <span className="font-medium leading-relaxed">{message}</span>
        </div>
      )}

      {!state ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/20 p-5 text-xs text-muted-foreground">
          {message ? (
            <>
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
              <span>Reabra a aba para tentar carregar novamente.</span>
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              <span>Carregando configuração…</span>
            </>
          )}
        </div>
      ) : (
        <fieldset disabled={busy} className="space-y-6">
          {/* ── Chave Geral de Ativação VTEX (Checkbox #1 para manter ordem determinística) ── */}
          <SystemTooltip
            content={
              settings.enabled
                ? "Desmarque para pausar todas as buscas na VTEX durante o atendimento sem perder os dados configurados."
                : "Marque para permitir que a IA consulte especificações, estoque, preço e frete diretamente na VTEX."
            }
          >
            <label
              className={`group flex items-center justify-between gap-4 rounded-xl border p-4 transition-all cursor-pointer ${
                settings.enabled
                  ? "border-primary/40 bg-primary/5 shadow-sm"
                  : "border-border bg-muted/20 hover:border-primary/30 hover:bg-muted/40"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    settings.enabled
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-muted-foreground/40 bg-background group-hover:border-primary/60"
                  }`}
                >
                  {settings.enabled && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                </div>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={settings.enabled}
                  onChange={(event) =>
                    setSettings({ ...settings, enabled: event.target.checked })
                  }
                />
                <div className="space-y-0.5">
                  <span className="block text-sm font-semibold text-foreground">
                    Usar consultas VTEX no atendimento
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Quando habilitado, a IA utiliza os dados oficiais da loja VTEX como fonte única de verdade antes de responder sobre produtos.
                  </span>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                  settings.enabled
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {settings.enabled ? "Habilitado" : "Desativado"}
              </span>
            </label>
          </SystemTooltip>

          {/* ── SEÇÃO 1: Identificação da Conta e Loja VTEX ───────────────── */}
          <div className="rounded-xl border border-border bg-muted/10 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 text-xs font-bold text-primary">
                  1
                </span>
                <div>
                  <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <Store className="h-4 w-4 text-primary" />
                    Identificação da Conta e Vitrine VTEX
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    Informe os dados estruturais da sua loja VTEX para conexão ao catálogo e validação de links.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Conta VTEX */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Conta VTEX (Account Name)</label>
                  <SystemTooltip content="Identificador técnico da sua conta na VTEX (encontrado em Configurações da Conta → Gerenciamento da conta). Use apenas letras minúsculas, números ou hífen.">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Ajuda sobre Conta VTEX"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                </div>
                <input
                  aria-label="Conta VTEX"
                  className={inputClass}
                  value={settings.account}
                  onChange={(event) => setSettings({ ...settings, account: event.target.value })}
                  placeholder="nome-da-conta"
                />
                <p className="text-[11px] text-muted-foreground">
                  Subdomínio usado na API (<code className="rounded bg-muted px-1 py-0.5 text-[10px]">{settings.account || "conta"}.vtexcommercestable.com.br</code>).
                </p>
              </div>

              {/* Domínio da loja */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Domínio público da loja</label>
                  <SystemTooltip content="Endereço principal (com https://) onde os clientes acessam a vitrine. Usado para montar links de produtos e validar URLs enviadas no chat com proteção anti-SSRF.">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Ajuda sobre Domínio da loja"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                </div>
                <input
                  aria-label="Domínio da loja VTEX"
                  className={inputClass}
                  value={settings.storefrontOrigin}
                  onChange={(event) =>
                    setSettings({ ...settings, storefrontOrigin: event.target.value })
                  }
                  placeholder="https://www.sualoja.com.br"
                />
                <p className="text-[11px] text-muted-foreground">
                  URL canônica da vitrine para reconhecer páginas de produtos abertas pelo visitante.
                </p>
              </div>

              {/* Canal de venda */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Política Comercial / Canal de Venda (sc)</label>
                  <SystemTooltip content="Código numérico da Política Comercial (Trade Policy / Sales Channel) na VTEX. O padrão da loja principal geralmente é 1.">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Ajuda sobre Canal de venda VTEX"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                </div>
                <input
                  aria-label="Canal de venda VTEX"
                  className={inputClass}
                  value={settings.salesChannel}
                  onChange={(event) => setSettings({ ...settings, salesChannel: event.target.value })}
                  placeholder="1"
                />
                <p className="text-[11px] text-muted-foreground">
                  Define qual tabela de preço e sortimento será consultada (padrão: <code className="rounded bg-muted px-1 py-0.5 text-[10px]">1</code>).
                </p>
              </div>

              {/* Vendedor */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">ID do Vendedor (Seller ID)</label>
                  <SystemTooltip content="Identificador do Seller responsável pelo estoque e cálculo de entrega na VTEX. O estoque próprio principal utiliza o valor 1.">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Ajuda sobre Vendedor VTEX"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                </div>
                <input
                  aria-label="Vendedor VTEX"
                  className={inputClass}
                  value={settings.sellerId}
                  onChange={(event) => setSettings({ ...settings, sellerId: event.target.value })}
                  placeholder="1"
                />
                <p className="text-[11px] text-muted-foreground">
                  Filtra a oferta comercial e simulações logísticas do vendedor principal (padrão: <code className="rounded bg-muted px-1 py-0.5 text-[10px]">1</code>).
                </p>
              </div>
            </div>
          </div>

          {/* ── SEÇÃO 2: Políticas de Permissão por Canal (Checkboxes #2 a #9) ── */}
          <div className="rounded-xl border border-border bg-muted/10 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 text-xs font-bold text-primary">
                  2
                </span>
                <div>
                  <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <SlidersHorizontal className="h-4 w-4 text-primary" />
                    Políticas de Exibição por Canal (Site vs. WhatsApp)
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    Escolha exatamente quais informações da VTEX a IA está autorizada a revelar em cada canal de atendimento.
                  </p>
                </div>
              </div>
              <SystemTooltip content="Informações desmarcadas são automaticamente censuradas (redacted) antes de chegar ao prompt da IA, garantindo que dados sensíveis como preço não vazem no canal restrito.">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                  <Lock className="h-3 w-3" /> Proteção ativa por canal
                </span>
              </SystemTooltip>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {(["livechat", "whatsapp"] as const).map((key) => {
                const isSite = key === "livechat";
                const channelPolicies = settings.channels[key];
                const activeCount = Object.values(channelPolicies).filter(Boolean).length;

                return (
                  <fieldset
                    className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm"
                    key={key}
                  >
                    <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                      <legend className="flex items-center gap-2 text-sm font-bold text-foreground">
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                            isSite
                              ? "bg-primary/10 text-primary"
                              : "bg-emerald-500/10 text-emerald-600"
                          }`}
                        >
                          {isSite ? (
                            <Globe className="h-4 w-4" />
                          ) : (
                            <MessageSquare className="h-4 w-4" />
                          )}
                        </span>
                        {isSite ? "Site" : "WhatsApp"}
                      </legend>
                      <SystemTooltip
                        content={`${activeCount} de 4 categorias de dados liberadas para o canal ${
                          isSite ? "Site (Widget Web)" : "WhatsApp"
                        }.`}
                      >
                        <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                          {activeCount}/4 liberadas
                        </span>
                      </SystemTooltip>
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                      {isSite
                        ? "Visitantes navegando na loja virtual costumam ver preços, estoque e frete públicos."
                        : "No WhatsApp industrial, você pode liberar apenas especificações e deixar preço/frete para o consultor."}
                    </p>

                    <div className="space-y-2">
                      {(Object.keys(POLICY_META) as (keyof typeof POLICY_META)[]).map((field) => {
                        const checked = settings.channels[key][field];
                        const meta = POLICY_META[field];

                        return (
                          <SystemTooltip key={field} content={meta.tooltip}>
                            <label
                              className={`group flex items-start justify-between gap-3 rounded-xl border p-3 transition-all cursor-pointer ${
                                checked
                                  ? "border-primary/35 bg-primary/5"
                                  : "border-border/70 bg-muted/15 hover:border-primary/25 hover:bg-muted/30"
                              }`}
                            >
                              <div className="flex items-start gap-2.5">
                                <div
                                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                                    checked
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-muted-foreground/40 bg-background group-hover:border-primary/60"
                                  }`}
                                >
                                  {checked && <Check className="h-3 w-3 stroke-[3]" />}
                                </div>
                                <input
                                  type="checkbox"
                                  className="sr-only"
                                  checked={checked}
                                  onChange={(event) =>
                                    setSettings({
                                      ...settings,
                                      channels: {
                                        ...settings.channels,
                                        [key]: {
                                          ...settings.channels[key],
                                          [field]: event.target.checked,
                                        },
                                      },
                                    })
                                  }
                                />
                                <div className="space-y-0.5">
                                  <span className="block text-xs font-semibold text-foreground">
                                    {meta.label}
                                  </span>
                                  <span className="block text-[11px] text-muted-foreground leading-snug">
                                    {meta.description}
                                  </span>
                                </div>
                              </div>
                              <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-primary transition-colors mt-0.5" />
                            </label>
                          </SystemTooltip>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </div>

          {/* ── SEÇÃO 3: Credenciais Opcionais de API (Checkboxes #10 e #11) ── */}
          <div className="rounded-xl border border-border bg-muted/10 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-muted/20 border-b border-border/50">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 text-xs font-bold text-primary">
                  3
                </span>
                <div>
                  <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <KeyRound className="h-4 w-4 text-primary" />
                    Credenciais opcionais (AppKey & AppToken VTEX)
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    Consultas públicas não exigem chaves. Configure apenas se o catálogo da sua loja exigir autenticação privada.
                  </p>
                </div>
              </div>

              <SystemTooltip
                content={
                  credentialsExpanded
                    ? "Ocultar campos de AppKey e AppToken"
                    : "Expandir configurações de chaves privadas e criptografia"
                }
              >
                <button
                  type="button"
                  onClick={() => setCredentialsExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  <span>{credentialsExpanded ? "Recolher" : "Configurar chaves"}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      credentialsExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </SystemTooltip>
            </div>

            <div className={`p-5 space-y-4 ${credentialsExpanded ? "block" : "hidden"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card p-3 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                  <span>
                    Consultas públicas não exigem AppKey/AppToken. Quando informados, os valores são
                    criptografados no servidor e não são devolvidos ao navegador. Simulações de frete
                    são anônimas.
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                      state.hasCredentials
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {state.hasCredentials
                      ? "Credenciais armazenadas."
                      : "Sem credenciais armazenadas."}
                  </span>
                  <span
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                      state.encryptionReady
                        ? "bg-primary/10 text-primary"
                        : "bg-amber-500/10 text-amber-600"
                    }`}
                  >
                    {state.encryptionReady
                      ? "Criptografia disponível."
                      : "Criptografia ainda não configurada no servidor; consultas públicas continuam disponíveis."}
                  </span>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Usar credenciais no catálogo */}
                <SystemTooltip content="Envia cabeçalhos X-VTEX-API-AppKey e X-VTEX-API-AppToken nas buscas de catálogo. Simulações de frete permanecem anônimas por segurança.">
                  <label
                    className={`group flex items-start gap-3 rounded-xl border p-3.5 transition-all cursor-pointer ${
                      settings.useCredentials
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-card hover:border-primary/30"
                    }`}
                  >
                    <div
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        settings.useCredentials
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40 bg-background"
                      }`}
                    >
                      {settings.useCredentials && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={settings.useCredentials}
                      onChange={(event) =>
                        setSettings({ ...settings, useCredentials: event.target.checked })
                      }
                    />
                    <div className="space-y-0.5">
                      <span className="block text-xs font-semibold text-foreground">
                        Usar credenciais no catálogo
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        Autentica requisições de busca de produtos usando o cofre criptografado.
                      </span>
                    </div>
                  </label>
                </SystemTooltip>

                {/* Remover credenciais armazenadas ao salvar */}
                <SystemTooltip content="Se marcado, apaga definitivamente o AppKey e AppToken salvos no banco ao clicar em Salvar integração VTEX.">
                  <label
                    className={`group flex items-start gap-3 rounded-xl border p-3.5 transition-all cursor-pointer ${
                      clearCredentials
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border bg-card hover:border-destructive/30"
                    }`}
                  >
                    <div
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        clearCredentials
                          ? "border-destructive bg-destructive text-destructive-foreground"
                          : "border-muted-foreground/40 bg-background"
                      }`}
                    >
                      {clearCredentials && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={clearCredentials}
                      onChange={(event) => setClearCredentials(event.target.checked)}
                    />
                    <div className="space-y-0.5">
                      <span className="block text-xs font-semibold text-foreground">
                        Remover credenciais armazenadas ao salvar
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        Limpa as chaves existentes e retorna ao modo exclusivamente público.
                      </span>
                    </div>
                  </label>
                </SystemTooltip>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-foreground">AppKey</label>
                    <SystemTooltip content="Chave de aplicação gerada em Configurações da Conta → Chaves de API na VTEX. Deixe em branco para manter a chave já salva.">
                      <span className="text-muted-foreground hover:text-foreground cursor-help">
                        <HelpCircle className="h-3.5 w-3.5" />
                      </span>
                    </SystemTooltip>
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={inputClass}
                    value={appKey}
                    onChange={(event) => setAppKey(event.target.value)}
                    placeholder="Vazio mantém a credencial atual"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-foreground">AppToken</label>
                    <SystemTooltip content="Token secreto correspondente à AppKey. Criptografado com AES-256-GCM antes de persistir no banco.">
                      <span className="text-muted-foreground hover:text-foreground cursor-help">
                        <HelpCircle className="h-3.5 w-3.5" />
                      </span>
                    </SystemTooltip>
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={inputClass}
                    value={appToken}
                    onChange={(event) => setAppToken(event.target.value)}
                    placeholder="Vazio mantém a credencial atual"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Barra de Salvamento das Configurações ─────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <span>
                Revise os parâmetros acima e salve para aplicar na operação da empresa.
              </span>
            </div>
            <SystemTooltip content="Persiste todas as configurações da loja, políticas de canal e credenciais com verificação de revisão.">
              <button
                className={`${buttonClass} bg-primary text-primary-foreground border-primary hover:bg-primary/90 shadow-sm`}
                type="button"
                onClick={() => void submit("save")}
              >
                Salvar integração VTEX
              </button>
            </SystemTooltip>
          </div>

          {/* ── SEÇÃO 4: Simulador & Teste de Consulta sem Salvar ─────────── */}
          <div className="rounded-xl border border-border bg-muted/10 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 text-xs font-bold text-primary">
                  4
                </span>
                <div>
                  <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <FlaskConical className="h-4 w-4 text-primary" />
                    Testar consulta sem salvar
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    Simule exatamente como a IA buscará produtos, preços e fretes na VTEX usando os campos preenchidos acima, sem gravar no banco nem gerar pedidos.
                  </p>
                </div>
              </div>

              {/* Calendário do Design System para referência temporal da simulação */}
              <div className="w-full sm:w-64">
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    <CalendarClock className="h-3 w-3 text-primary" />
                    Janela de referência do teste
                  </span>
                  <SystemTooltip content="Registra a data e horário de referência da homologação para conferência de tabelas promocionais, vigência de preços e prazos de expedição (SLA).">
                    <span className="text-muted-foreground hover:text-foreground cursor-help">
                      <HelpCircle className="h-3 w-3" />
                    </span>
                  </SystemTooltip>
                </div>
                <SystemDateTimePicker
                  mode="datetime"
                  value={simulationRefDate}
                  onChange={setSimulationRefDate}
                  placeholder="Data/hora da simulação"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {/* Menu Suspenso Customizado 1: Buscar por */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Buscar por</label>
                  <SystemTooltip content="Escolha o método de identificação do produto na VTEX: código numérico do SKU, link completo da página ou termo de pesquisa.">
                    <span className="text-muted-foreground hover:text-foreground cursor-help">
                      <HelpCircle className="h-3.5 w-3.5" />
                    </span>
                  </SystemTooltip>
                </div>
                <Popover open={kindPopoverOpen} onOpenChange={setKindPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Selecionar tipo de busca VTEX"
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-medium text-foreground hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer"
                    >
                      <span className="flex items-center gap-2 truncate">
                        {kind === "sku" ? (
                          <Hash className="h-4 w-4 text-primary shrink-0" />
                        ) : kind === "url" ? (
                          <Link2 className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <Search className="h-4 w-4 text-primary shrink-0" />
                        )}
                        <span>{selectedKindOption.label}</span>
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-1.5" align="start">
                    <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Modo de Pesquisa no Catálogo
                    </div>
                    {QUERY_KIND_OPTIONS.map((opt) => {
                      const active = kind === opt.value;
                      return (
                        <SystemTooltip key={opt.value} content={opt.tooltip} side="right">
                          <button
                            type="button"
                            onClick={() => {
                              setKind(opt.value);
                              setKindPopoverOpen(false);
                            }}
                            className={`flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                              active
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-muted text-foreground"
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="text-xs font-semibold">{opt.label}</div>
                              <div className="text-[11px] text-muted-foreground leading-tight">
                                {opt.shortDesc}
                              </div>
                            </div>
                            {active && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                          </button>
                        </SystemTooltip>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>

              {/* Campo de Consulta */}
              <div className="space-y-1.5 md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    Consulta ({selectedKindOption.label})
                  </label>
                  <SystemTooltip content={selectedKindOption.tooltip}>
                    <span className="text-muted-foreground hover:text-foreground cursor-help">
                      <HelpCircle className="h-3.5 w-3.5" />
                    </span>
                  </SystemTooltip>
                </div>
                <input
                  aria-label="Consulta VTEX"
                  className={inputClass}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={selectedKindOption.placeholder}
                />
              </div>

              {/* Menu Suspenso Customizado 2: Canal */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Canal simulado</label>
                  <SystemTooltip content="Selecione em qual canal a pergunta do cliente está sendo simulada para testar o filtro de políticas (Site vs. WhatsApp).">
                    <span className="text-muted-foreground hover:text-foreground cursor-help">
                      <HelpCircle className="h-3.5 w-3.5" />
                    </span>
                  </SystemTooltip>
                </div>
                <Popover open={channelPopoverOpen} onOpenChange={setChannelPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Selecionar canal simulado VTEX"
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-medium text-foreground hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer"
                    >
                      <span className="flex items-center gap-2 truncate">
                        {channel === "livechat" ? (
                          <Globe className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <MessageSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                        )}
                        <span>{selectedChannelOption.label}</span>
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-1.5" align="start">
                    <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Política de Canal Aplicada
                    </div>
                    {CHANNEL_OPTIONS.map((opt) => {
                      const active = channel === opt.value;
                      return (
                        <SystemTooltip key={opt.value} content={opt.tooltip} side="right">
                          <button
                            type="button"
                            onClick={() => {
                              setChannel(opt.value);
                              setChannelPopoverOpen(false);
                            }}
                            className={`flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                              active
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-muted text-foreground"
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="text-xs font-semibold">{opt.label}</div>
                              <div className="text-[11px] text-muted-foreground leading-tight">
                                {opt.shortDesc}
                              </div>
                            </div>
                            {active && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                          </button>
                        </SystemTooltip>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>

              {/* Menu Suspenso Customizado 3: Informação */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Informação solicitada</label>
                  <SystemTooltip content="Define a intenção principal da pergunta do cliente (ficha técnica, preço ou cálculo de frete).">
                    <span className="text-muted-foreground hover:text-foreground cursor-help">
                      <HelpCircle className="h-3.5 w-3.5" />
                    </span>
                  </SystemTooltip>
                </div>
                <Popover open={intentPopoverOpen} onOpenChange={setIntentPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Selecionar informação solicitada VTEX"
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-medium text-foreground hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer"
                    >
                      <span className="flex items-center gap-2 truncate">
                        {intent === "details" ? (
                          <FileText className="h-4 w-4 text-primary shrink-0" />
                        ) : intent === "price" ? (
                          <Tag className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <Truck className="h-4 w-4 text-primary shrink-0" />
                        )}
                        <span>{selectedIntentOption.label}</span>
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-1.5" align="start">
                    <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Objetivo da Pergunta
                    </div>
                    {INTENT_OPTIONS.map((opt) => {
                      const active = intent === opt.value;
                      return (
                        <SystemTooltip key={opt.value} content={opt.tooltip} side="right">
                          <button
                            type="button"
                            onClick={() => {
                              setIntent(opt.value);
                              setIntentPopoverOpen(false);
                            }}
                            className={`flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                              active
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-muted text-foreground"
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="text-xs font-semibold">{opt.label}</div>
                              <div className="text-[11px] text-muted-foreground leading-tight">
                                {opt.shortDesc}
                              </div>
                            </div>
                            {active && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                          </button>
                        </SystemTooltip>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>

              {/* Quantidade e CEP lado a lado */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">Qtd.</label>
                    <SystemTooltip content="Quantidade de unidades do SKU para simulação de disponibilidade e cálculo de cubagem no frete (1 a 100).">
                      <span className="text-muted-foreground hover:text-foreground cursor-help">
                        <HelpCircle className="h-3.5 w-3.5" />
                      </span>
                    </SystemTooltip>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className={inputClass}
                    value={quantity}
                    onChange={(event) => setQuantity(Number(event.target.value))}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">CEP</label>
                    <SystemTooltip content="Informe um CEP de 8 dígitos (com ou sem hífen) para simular opções de frete e prazo de entrega na VTEX.">
                      <span className="text-muted-foreground hover:text-foreground cursor-help">
                        <HelpCircle className="h-3.5 w-3.5" />
                      </span>
                    </SystemTooltip>
                  </div>
                  <input
                    className={inputClass}
                    value={postalCode}
                    onChange={(event) => setPostalCode(event.target.value)}
                    placeholder="00000-000"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/50">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
                Executa leitura segura em tempo real sem criar carrinho nem alterar dados salvos.
              </span>
              <SystemTooltip content="Executa uma consulta real na API da VTEX usando os parâmetros acima e exibe exatamente a resposta que a IA receberá.">
                <button
                  className={`${buttonClass} bg-card hover:bg-muted text-foreground shadow-sm`}
                  type="button"
                  onClick={() => void submit("test")}
                >
                  Testar consulta VTEX
                </button>
              </SystemTooltip>
            </div>

            {result && (
              <div
                className="rounded-xl border border-primary/25 bg-card p-4 text-xs whitespace-pre-wrap break-words space-y-2 shadow-sm"
                aria-label="Resultado da consulta VTEX"
              >
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                  <span className="font-bold text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Evidência retornada pela VTEX ({selectedChannelOption.label} •{" "}
                    {selectedIntentOption.label})
                  </span>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                    Status: {result.status}
                  </span>
                </div>
                <div className="text-foreground/90 leading-relaxed font-mono text-[11px]">
                  {formatVtexAnswer(result, intent).join("\n\n")}
                </div>
              </div>
            )}
          </div>
        </fieldset>
      )}
    </section>
  );
}

