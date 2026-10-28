import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Globe,
  Clock,
  TrendingUp,
  Eye,
  MessageSquare,
  ExternalLink,
  Smartphone,
  Laptop,
  Tablet,
  MapPin,
  Mail,
  Phone,
  FileText,
  Sparkles,
  User,
  MousePointerClick,
  Layers,
  Building2,
  RefreshCw,
  ArrowRight,
  Package,
  Link2,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useTrainingSurface } from "@/hooks/useTrainingSurface";

export interface CustomerJourneyModalProps {
  open: boolean;
  visitorId?: string | null;
  contactId?: string | null;
  initialName?: string | null;
  onClose: () => void;
  onOpenChat?: (contactId: string) => void;
}

interface JourneyVisitorProfile {
  id: string;
  contactId: string | null;
  cookieId: string;
  name: string;
  email: string | null;
  phone: string | null;
  cpfCnpj: string | null;
  company: string | null;
  productInterest: string | null;
  currentPage: string | null;
  currentPageTitle: string | null;
  referrer: string | null;
  source: string;
  device: string;
  userAgent: string | null;
  ipAddress: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  isOnline: boolean;
  visitCount: number;
  totalTimeOnSite: number;
  avgScrollDepth: number;
  leadScore: number;
  engagementScore: number;
  pipelineStage: string;
  temperature: string;
  firstSeenAt: string;
  lastSeenAt: string;
  linkedWhatsApp: boolean;
  siteContinuityCode: string | null;
  siteContext: any;
}

interface JourneyPageview {
  id: string;
  url: string;
  pageTitle: string;
  timestamp: string;
  timeOnPage: number;
  scrollDepth: number;
  intent: "high" | "medium" | "low";
}

interface JourneyClickEvent {
  id: string;
  clickType: string;
  eventType: string;
  url: string;
  pageTitle: string;
  elementId?: string;
  elementText?: string;
  timestamp: string;
}

interface JourneyChat {
  id: string;
  status: string;
  outcome: string | null;
  aiSummary: string | null;
  startedAt: string;
  closedAt: string | null;
}

interface JourneyTimelineEvent {
  type: string;
  timestamp: string;
  data: Record<string, any>;
}

interface JourneyDetailResponse {
  visitor: JourneyVisitorProfile;
  pageviews: JourneyPageview[];
  clickEvents: JourneyClickEvent[];
  chats: JourneyChat[];
  timeline: JourneyTimelineEvent[];
}

function parseBrowserName(ua?: string | null): string {
  if (!ua) return "Navegador";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  if (/Firefox\//i.test(ua)) return "Firefox";
  return "Web";
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0));
  if (safe < 60) return `${safe}s`;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatTimeAgo(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInitials(name: string): string {
  if (
    !name ||
    name === "Visitante Anônimo" ||
    name === "Visitante do Site" ||
    name.startsWith("Visitante #")
  ) {
    return "?";
  }
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const STAGE_LABELS: Record<
  string,
  { label: string; colorClass: string }
> = {
  new_visitor: {
    label: "Novo Visitante",
    colorClass: "text-muted-foreground bg-muted border-border",
  },
  interested: {
    label: "Interessado",
    colorClass: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20",
  },
  negotiating: {
    label: "Negociando",
    colorClass: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
  attending: {
    label: "Em Atendimento",
    colorClass: "text-primary bg-primary/10 border-primary/25",
  },
  converted: {
    label: "Convertido",
    colorClass: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  lost: {
    label: "Perdido",
    colorClass: "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20",
  },
};

const INTENT_CONFIG: Record<string, { label: string; badgeClass: string }> = {
  high: {
    label: "Alta intenção",
    badgeClass:
      "bg-primary/12 text-primary border border-primary/25",
  },
  medium: {
    label: "Média",
    badgeClass:
      "bg-amber-500/12 text-amber-600 dark:text-amber-400 border border-amber-500/25",
  },
  low: {
    label: "Baixa",
    badgeClass:
      "bg-muted text-muted-foreground border border-border",
  },
};

const CLICK_TYPE_LABELS: Record<string, { label: string; colorClass: string }> = {
  whatsapp_click: {
    label: "Clicou no WhatsApp",
    colorClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  },
  phone_click: {
    label: "Clicou para Ligar",
    colorClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25",
  },
  cta_click: {
    label: "Clicou em CTA / Orçamento",
    colorClass: "bg-primary/10 text-primary border-primary/25",
  },
  widget_open: {
    label: "Abriu o Chat do Site",
    colorClass: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25",
  },
  add_to_cart: {
    label: "Adicionou ao Carrinho / Comprar",
    colorClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
  },
  product_view: {
    label: "Consultou Equipamento / Produto",
    colorClass: "bg-primary/10 text-primary border-primary/25",
  },
  chat_sent: {
    label: "Enviou Mensagem no Chat",
    colorClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25",
  },
};

function DeviceIcon({ device }: { device?: string }) {
  if (device === "mobile") return <Smartphone className="w-3.5 h-3.5" />;
  if (device === "tablet") return <Tablet className="w-3.5 h-3.5" />;
  return <Laptop className="w-3.5 h-3.5" />;
}

function InfoChip({
  icon,
  label,
  value,
  delay = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  delay?: number;
}) {
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className="animate-stagger-in flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border hover:border-primary/30 hover:bg-card transition-all duration-150"
    >
      <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground shrink-0 shadow-xs">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none mb-0.5">
          {label}
        </p>
        {value ? (
          <p className="text-xs font-semibold text-foreground truncate">{value}</p>
        ) : (
          <p className="text-xs text-muted-foreground/60 italic">Não informado</p>
        )}
      </div>
    </div>
  );
}

export const CustomerJourneyModal: React.FC<CustomerJourneyModalProps> = ({
  open,
  visitorId,
  contactId,
  initialName,
  onClose,
  onOpenChat,
}) => {
  const [data, setData] = useState<JourneyDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"info" | "pages" | "journey">("pages");
  const [tabKey, setTabKey] = useState(0);
  useTrainingSurface("journey", (step) => {
    if (loading || !data) return false;
    setActiveTab(step.id === "chat.journey-client" ? "info" : step.id === "chat.journey-timeline" ? "journey" : "pages");
    return true;
  });

  const loadJourney = useCallback(async () => {
    if (!visitorId && !contactId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (visitorId) qs.set("visitorId", visitorId);
      if (contactId) qs.set("contactId", contactId);
      const res = await fetch(`/api/livechat/journey?${qs.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Não foi possível carregar a jornada do cliente.");
      }
      const json = (await res.json()) as JourneyDetailResponse;
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Erro ao carregar jornada do site.");
    } finally {
      setLoading(false);
    }
  }, [visitorId, contactId]);

  useEffect(() => {
    if (open) {
      void loadJourney();
    } else {
      setData(null);
      setError(null);
    }
  }, [open, loadJourney]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleTabChange = (tab: "info" | "pages" | "journey") => {
    setActiveTab(tab);
    setTabKey((k) => k + 1);
  };

  if (!open || typeof document === "undefined") return null;

  const v = data?.visitor;
  const pageviews = data?.pageviews || [];
  const clickEvents = data?.clickEvents || [];
  const chats = data?.chats || [];
  const timeline = data?.timeline || [];

  const displayName = v?.name || initialName || "Visitante do Site";
  const stageCfg = STAGE_LABELS[v?.pipelineStage || "new_visitor"] || STAGE_LABELS.new_visitor;
  const browserName = parseBrowserName(v?.userAgent);
  const locationParts = [v?.city, v?.region, v?.country].filter(Boolean);

  const tabs: { id: "info" | "pages" | "journey"; label: string; count?: number }[] = [
    { id: "info", label: "Cliente" },
    { id: "pages", label: "Navegação", count: pageviews.length },
    { id: "journey", label: "Jornada", count: timeline.length },
  ];

  const modalContent = (
    <div
      data-tour="journey.dialog" className="fixed inset-0 z-[120] flex items-center justify-center p-4 animate-fade-in"
      style={{
        backgroundColor: "rgba(9, 13, 22, 0.62)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="animate-scale-in bg-card text-card-foreground rounded-3xl w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── HEADER COM TEMA DO SISTEMA ────────────────────────────────────── */}
        <div
          className="relative px-6 pt-5 pb-10 shrink-0 overflow-hidden text-primary-foreground"
          style={{
            background:
              "linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 78%, #090d16) 100%)",
          }}
        >
          {/* Decorative circles */}
          <div
            className="absolute -right-8 -top-8 w-36 h-36 rounded-full opacity-15 pointer-events-none"
            style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
          />
          <div
            className="absolute right-16 bottom-0 w-20 h-20 rounded-full opacity-10 pointer-events-none"
            style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
          />

          <div className="relative flex items-start justify-between gap-3">
            {/* Avatar + Name */}
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="relative shrink-0">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg text-white select-none"
                  style={{
                    background: "rgba(255,255,255,0.2)",
                    backdropFilter: "blur(8px)",
                    border: "1.5px solid rgba(255,255,255,0.35)",
                  }}
                >
                  {getInitials(displayName)}
                </div>
                {v?.isOnline && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full" />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-bold text-white leading-snug truncate">
                    {displayName}
                  </h2>
                  {v?.isOnline && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-400/25 text-emerald-100 border border-emerald-300/30">
                      ● Online
                    </span>
                  )}
                </div>

                {/* Location + Device + Visits */}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {locationParts.length > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-white/80">
                      <MapPin className="w-3 h-3" />
                      {locationParts.join(", ")}
                    </span>
                  )}
                  {v?.device && (
                    <span className="flex items-center gap-1 text-[11px] text-white/80">
                      <DeviceIcon device={v.device} />
                      {v.device} · {browserName}
                    </span>
                  )}
                  {v?.visitCount && v.visitCount > 0 && (
                    <span className="text-[11px] text-white/80">
                      # {v.visitCount} {v.visitCount === 1 ? "visita" : "visitas"}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {onOpenChat && v?.contactId && (
                <SystemTooltip content="Abrir conversa deste contato">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChat(v.contactId!);
                      onClose();
                    }}
                    className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-xl text-white/95 hover:text-white transition-all cursor-pointer"
                    style={{
                      background: "rgba(255,255,255,0.18)",
                      border: "1px solid rgba(255,255,255,0.28)",
                    }}
                  >
                    <MessageSquare className="w-3 h-3" />
                    Abrir Chat
                  </button>
                </SystemTooltip>
              )}

              <SystemTooltip content="Atualizar dados da jornada">
                <button
                  type="button"
                  onClick={() => void loadJourney()}
                  className="p-1.5 rounded-xl text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </SystemTooltip>

              <SystemTooltip content="Fechar modal">
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-xl text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </SystemTooltip>
            </div>
          </div>
        </div>

        {/* ── FLOATING KPI BAR (5 MÉTRICAS ESTILO LEGADO) ──────────────────── */}
        <div className="px-5 -mt-5 shrink-0 z-10">
          <div className="bg-card rounded-2xl border border-border grid grid-cols-5 divide-x divide-border shadow-lg">
            {[
              {
                label: "Páginas",
                value: pageviews.length,
                colorClass: "text-foreground",
              },
              {
                label: "Chats",
                value: chats.length,
                colorClass: "text-foreground",
              },
              {
                label: "Eng.",
                value: v?.engagementScore ?? 0,
                colorClass: "text-primary",
              },
              {
                label: "Intenção",
                value: v?.leadScore ?? 0,
                colorClass:
                  (v?.leadScore ?? 0) >= 60
                    ? "text-emerald-600 dark:text-emerald-400"
                    : (v?.leadScore ?? 0) >= 35
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground",
              },
              {
                label: "Tempo",
                value: formatDuration(v?.totalTimeOnSite || 0),
                colorClass: "text-foreground",
                small: true,
              },
            ].map((stat, i) => (
              <div
                key={stat.label}
                style={{ animationDelay: `${60 + i * 40}ms` }}
                className="animate-stagger-in py-2.5 px-2 text-center"
              >
                <p
                  className={`font-extrabold leading-none ${
                    stat.small ? "text-xs mt-0.5" : "text-base"
                  } ${stat.colorClass}`}
                >
                  {stat.value}
                </p>
                <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wide mt-1">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* ── BADGES DE ORIGEM, ESTÁGIO E VÍNCULO WHATSAPP ────────────────── */}
        {v && (
          <div className="px-6 pt-3 pb-1 flex items-center gap-1.5 flex-wrap shrink-0">
            {v.source && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25">
                <TrendingUp className="w-3 h-3" />
                {v.source}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${stageCfg.colorClass}`}
            >
              <Layers className="w-3 h-3" />
              {stageCfg.label}
            </span>
            {v.productInterest && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 truncate max-w-[230px]">
                <Sparkles className="w-3 h-3 shrink-0" />
                {v.productInterest}
              </span>
            )}
            {v.linkedWhatsApp && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                <Link2 className="w-3 h-3 shrink-0" />
                Vinculado ao WhatsApp
              </span>
            )}
            {clickEvents.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                <MousePointerClick className="w-3 h-3 shrink-0 text-primary" />
                {clickEvents.length} {clickEvents.length === 1 ? "clique" : "cliques"}
              </span>
            )}
          </div>
        )}

        {/* ── TABS (CLIENTE / NAVEGAÇÃO / JORNADA) ─────────────────────────── */}
        <div className="px-6 pt-2 shrink-0 border-b border-border flex gap-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                data-tour={`journey.${tab.id === "journey" ? "timeline" : tab.id}`} key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`relative px-3.5 py-2 text-xs font-semibold rounded-t-lg transition-colors duration-150 flex items-center gap-1.5 cursor-pointer ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full transition-colors ${
                      isActive
                        ? "bg-primary/12 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* ── CONTEÚDO DAS ABAS ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && !data ? (
            <div className="space-y-3 py-2">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-14 bg-muted/60 rounded-xl animate-pulse border border-border"
                />
              ))}
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <Globe className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          ) : (
            <div key={tabKey}>
              {/* ── ABA 1: CLIENTE ── */}
              {activeTab === "info" && v && (
                <div className="space-y-3 animate-slide-up">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <InfoChip
                      icon={<User className="w-3.5 h-3.5" />}
                      label="Nome"
                      value={
                        v.name !== "Visitante Anônimo" && v.name !== "Visitante do Site"
                          ? v.name
                          : undefined
                      }
                      delay={0}
                    />
                    <InfoChip
                      icon={<Phone className="w-3.5 h-3.5" />}
                      label="Telefone / WhatsApp"
                      value={v.phone}
                      delay={40}
                    />
                    <InfoChip
                      icon={<Mail className="w-3.5 h-3.5" />}
                      label="E-mail"
                      value={v.email}
                      delay={80}
                    />
                    <InfoChip
                      icon={<FileText className="w-3.5 h-3.5" />}
                      label="CPF / CNPJ"
                      value={v.cpfCnpj}
                      delay={120}
                    />
                  </div>

                  {v.company && (
                    <InfoChip
                      icon={<Building2 className="w-3.5 h-3.5" />}
                      label="Empresa"
                      value={v.company}
                      delay={140}
                    />
                  )}

                  {(v.productInterest || v.siteContext?.product?.name) && (
                    <div
                      style={{ animationDelay: "160ms" }}
                      className="animate-stagger-in p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-2.5"
                    >
                      <Package className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          Interesse Detectado no Site
                        </p>
                        <p className="text-xs font-semibold text-foreground mt-0.5">
                          {v.productInterest || v.siteContext?.product?.name}
                        </p>
                        {v.siteContext?.product?.url && (
                          <a
                            href={v.siteContext.product.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
                          >
                            Abrir página do equipamento
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {v.currentPage && (
                    <div
                      style={{ animationDelay: "190ms" }}
                      className="animate-stagger-in p-3.5 rounded-xl bg-muted/50 border border-border"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                        Última Página Visualizada
                      </p>
                      <p className="text-xs font-semibold text-foreground truncate">
                        {v.currentPageTitle || v.currentPage}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {v.currentPage}
                      </p>
                    </div>
                  )}

                  {v.siteContinuityCode && (
                    <div
                      style={{ animationDelay: "210ms" }}
                      className="animate-stagger-in p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-emerald-500" />
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                            Continuidade Site → WhatsApp
                          </p>
                          <p className="text-xs text-foreground font-medium">
                            Código vinculado:{" "}
                            <span className="font-mono font-bold">{v.siteContinuityCode}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div
                    style={{ animationDelay: "230ms" }}
                    className="animate-stagger-in pt-1 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border"
                  >
                    <span>Primeiro acesso: {formatTimeAgo(v.firstSeenAt)}</span>
                    <span>·</span>
                    <span>Última visita: {formatTimeAgo(v.lastSeenAt)}</span>
                  </div>
                </div>
              )}

              {/* ── ABA 2: NAVEGAÇÃO (LISTA NUMERADA DE PÁGINAS VISITADAS) ── */}
              {activeTab === "pages" && (
                <div className="space-y-1.5 animate-slide-in-right">
                  {pageviews.length === 0 ? (
                    <div className="text-center py-10">
                      <Eye className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">
                        Nenhuma página registrada ainda para este visitante.
                      </p>
                    </div>
                  ) : (
                    pageviews.map((pv, i) => {
                      const intentCfg = pv.intent ? INTENT_CONFIG[pv.intent] : null;
                      return (
                        <div
                          key={pv.id || i}
                          style={{ animationDelay: `${i * 25}ms` }}
                          className="animate-stagger-in flex items-start gap-3 p-3 rounded-xl bg-muted/40 hover:bg-muted/80 border border-border hover:border-primary/30 transition-all duration-150 group"
                        >
                          {/* Number badge */}
                          <div className="w-6 h-6 rounded-lg bg-card border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0 mt-0.5 group-hover:border-primary/40 group-hover:text-primary transition-colors">
                            {i + 1}
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate leading-snug">
                              {pv.pageTitle || pv.url}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                              {pv.url}
                            </p>

                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {intentCfg && (
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${intentCfg.badgeClass}`}
                                >
                                  {intentCfg.label}
                                </span>
                              )}
                              {pv.timeOnPage > 0 && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 font-medium">
                                  ⏱ {formatDuration(pv.timeOnPage)}
                                </span>
                              )}
                              {pv.scrollDepth > 0 && (
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  📜 {pv.scrollDepth}%
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 ml-auto">
                                <Clock className="w-2.5 h-2.5" />
                                {formatTimeAgo(pv.timestamp)}
                              </span>
                            </div>
                          </div>

                          {pv.url && pv.url.startsWith("http") && (
                            <SystemTooltip content="Abrir página em nova aba">
                              <a
                                href={pv.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-card text-muted-foreground hover:text-primary transition-all shrink-0 mt-0.5"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </SystemTooltip>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* ── ABA 3: JORNADA COMPLETA (TIMELINE DE PÁGINAS, CLIQUES E CHATS) ── */}
              {activeTab === "journey" && (
                <div className="animate-slide-in-right">
                  {timeline.length === 0 ? (
                    <div className="text-center py-10">
                      <Globe className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">
                        Nenhum evento registrado na jornada.
                      </p>
                    </div>
                  ) : (
                    <div className="relative pl-7">
                      {/* Vertical connecting line */}
                      <div
                        className="absolute left-2.5 top-3 bottom-3 w-px"
                        style={{
                          background:
                            "linear-gradient(to bottom, color-mix(in srgb, var(--primary) 50%, transparent), var(--border) 80%, transparent)",
                        }}
                      />

                      <div className="space-y-2.5">
                        {timeline.map((event, idx) => {
                          const isStart = event.type === "session_start";
                          const isPage = event.type === "pageview";
                          const isClick = event.type === "click_event";
                          const isChat = event.type === "chat_start";
                          const isContinuity = event.type === "whatsapp_continuity";

                          const dotClass = isStart
                            ? "bg-primary border-primary/40 text-primary-foreground"
                            : isClick
                              ? "bg-amber-500 border-amber-300 text-white"
                              : isChat
                                ? "bg-emerald-500 border-emerald-300 text-white"
                                : isContinuity
                                  ? "bg-emerald-600 border-emerald-400 text-white"
                                  : "bg-card border-primary/50 text-primary";

                          const clickCfg = isClick
                            ? CLICK_TYPE_LABELS[event.data.clickType] || {
                                label: event.data.clickType || "Clique no site",
                                colorClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
                              }
                            : null;

                          return (
                            <div
                              key={idx}
                              style={{ animationDelay: `${idx * 30}ms` }}
                              className="animate-stagger-in relative flex items-start gap-3"
                            >
                              {/* Dot */}
                              <div
                                className={`absolute -left-7 mt-2.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 shadow-xs ${dotClass}`}
                              >
                                {isStart && <Globe className="w-2 h-2" />}
                                {isPage && <Eye className="w-2 h-2" />}
                                {isClick && <MousePointerClick className="w-2 h-2" />}
                                {isChat && <MessageSquare className="w-2 h-2" />}
                                {isContinuity && <ArrowRight className="w-2 h-2" />}
                              </div>

                              {/* Card */}
                              <div className="flex-1 bg-muted/40 hover:bg-muted/75 border border-border rounded-xl p-3 transition-colors duration-100">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    {isStart && (
                                      <>
                                        <p className="text-xs font-semibold text-foreground">
                                          Sessão iniciada via{" "}
                                          <span className="text-primary">{event.data.source}</span>
                                        </p>
                                        {event.data.device && (
                                          <p className="text-[11px] text-muted-foreground mt-0.5">
                                            {event.data.device} · {parseBrowserName(event.data.browser)}
                                          </p>
                                        )}
                                      </>
                                    )}

                                    {isPage && (
                                      <>
                                        <p className="text-xs font-semibold text-foreground truncate">
                                          {event.data.pageTitle || event.data.url}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                          {event.data.url}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                          {event.data.intent && INTENT_CONFIG[event.data.intent] && (
                                            <span
                                              className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                                INTENT_CONFIG[event.data.intent].badgeClass
                                              }`}
                                            >
                                              {INTENT_CONFIG[event.data.intent].label}
                                            </span>
                                          )}
                                          {event.data.timeOnPage > 0 && (
                                            <span className="text-[10px] text-muted-foreground font-medium">
                                              ⏱ {formatDuration(event.data.timeOnPage)}
                                            </span>
                                          )}
                                          {event.data.scrollDepth > 0 && (
                                            <span className="text-[10px] text-muted-foreground font-medium">
                                              📜 {event.data.scrollDepth}%
                                            </span>
                                          )}
                                        </div>
                                      </>
                                    )}

                                    {isClick && (
                                      <>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span
                                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${clickCfg?.colorClass}`}
                                          >
                                            {clickCfg?.label}
                                          </span>
                                        </div>
                                        {event.data.elementText && (
                                          <p className="text-xs font-semibold text-foreground truncate mt-1">
                                            ↗ "{event.data.elementText}"
                                          </p>
                                        )}
                                        {event.data.pageTitle && (
                                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                            em {event.data.pageTitle}
                                          </p>
                                        )}
                                      </>
                                    )}

                                    {isChat && (
                                      <>
                                        <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                          Conversa iniciada no Chat do Site
                                        </p>
                                        {event.data.summary && (
                                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                            {event.data.summary}
                                          </p>
                                        )}
                                      </>
                                    )}

                                    {isContinuity && (
                                      <>
                                        <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                          Continuou o atendimento no WhatsApp
                                        </p>
                                        {event.data.code && (
                                          <p className="text-[11px] text-muted-foreground mt-0.5">
                                            Código de vínculo:{" "}
                                            <span className="font-mono font-semibold text-foreground">
                                              {event.data.code}
                                            </span>
                                          </p>
                                        )}
                                      </>
                                    )}

                                    {!isStart && !isPage && !isClick && !isChat && !isContinuity && (
                                      <p className="text-xs text-muted-foreground">{event.type}</p>
                                    )}
                                  </div>

                                  <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                                    {formatTimeAgo(event.timestamp)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
