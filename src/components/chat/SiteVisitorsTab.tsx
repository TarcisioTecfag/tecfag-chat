import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Globe,
  MousePointerClick,
  Users2,
  Flame,
  RefreshCw,
  Search,
  MapPin,
  Smartphone,
  Monitor,
  ExternalLink,
  Clock,
  Sparkles,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { CustomerJourneyModal } from "./CustomerJourneyModal";
import { useChat } from "@/hooks/useChatState";

interface SiteVisitorsTabProps {
  tenantId: string | null;
}

interface SiteVisitorRow {
  id: string;
  tenantId: string;
  cookieId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  device?: string | null;
  browser?: string | null;
  os?: string | null;
  currentPage?: string | null;
  currentPageTitle?: string | null;
  entryPage?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  isOnline?: boolean | null;
  intentScore?: number | null;
  temperature?: string | null;
  visitCount?: number | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "Agora mesmo";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `há ${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `há ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `há ${days}d`;
}

function cleanPath(url?: string | null): string {
  if (!url) return "/";
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

export function SiteVisitorsTab({ tenantId }: SiteVisitorsTabProps) {
  const { setActiveView, setActiveQueue, setSelectedChatId } = useChat();
  const [visitors, setVisitors] = useState<SiteVisitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "online" | "hot">("all");
  const [selectedVisitor, setSelectedVisitor] = useState<{
    visitorId: string;
    name?: string;
  } | null>(null);

  const fetchVisitors = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/livechat/visitors?includeRecent=1");
      if (res.ok) {
        const data = await res.json();
        setVisitors(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore network error on poll
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchVisitors(false);
    const interval = setInterval(() => {
      void fetchVisitors(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchVisitors, tenantId]);

  const onlineCount = useMemo(
    () => visitors.filter((v) => Boolean(v.isOnline)).length,
    [visitors],
  );
  const hotCount = useMemo(
    () =>
      visitors.filter(
        (v) => v.temperature === "hot" || Number(v.intentScore || 0) >= 50,
      ).length,
    [visitors],
  );

  const filteredVisitors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visitors.filter((v) => {
      if (filterMode === "online" && !v.isOnline) return false;
      if (
        filterMode === "hot" &&
        v.temperature !== "hot" &&
        Number(v.intentScore || 0) < 50
      ) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        v.name,
        v.email,
        v.phone,
        v.city,
        v.region,
        v.currentPageTitle,
        v.currentPage,
        v.referrer,
        v.utmSource,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [visitors, filterMode, search]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header da aba */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary-soft text-primary">
            <Globe className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-xs font-extrabold text-foreground">
              Visitantes do Site & Jornada de Cliques
            </h2>
            <p className="text-[10px] text-muted-foreground">
              Rastreamento em tempo real de páginas, tempo de leitura, rolagem e cliques
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tenantId && (
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider border border-border rounded-lg px-2 py-0.5">
              {tenantId}
            </span>
          )}
          <SystemTooltip content="Atualizar lista de visitantes">
            <button
              type="button"
              onClick={() => void fetchVisitors(true)}
              className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-primary" : ""}`} />
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Cards de métricas */}
      <div className="grid grid-cols-3 gap-3 px-5 py-3.5 shrink-0">
        <button
          type="button"
          onClick={() => setFilterMode("online")}
          className={`flex flex-col items-center justify-center gap-1 rounded-2xl border py-3 shadow-soft transition cursor-pointer ${
            filterMode === "online"
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-border bg-card hover:bg-muted/40"
          }`}
        >
          <Users2 className="h-4.5 w-4.5 text-emerald-500" />
          <span className="text-base font-extrabold text-foreground">{onlineCount}</span>
          <span className="text-[10px] font-bold text-muted-foreground">Online agora</span>
        </button>

        <button
          type="button"
          onClick={() => setFilterMode("all")}
          className={`flex flex-col items-center justify-center gap-1 rounded-2xl border py-3 shadow-soft transition cursor-pointer ${
            filterMode === "all"
              ? "border-primary/40 bg-primary/10"
              : "border-border bg-card hover:bg-muted/40"
          }`}
        >
          <MousePointerClick className="h-4.5 w-4.5 text-primary" />
          <span className="text-base font-extrabold text-foreground">{visitors.length}</span>
          <span className="text-[10px] font-bold text-muted-foreground">Visitantes recentes</span>
        </button>

        <button
          type="button"
          onClick={() => setFilterMode("hot")}
          className={`flex flex-col items-center justify-center gap-1 rounded-2xl border py-3 shadow-soft transition cursor-pointer ${
            filterMode === "hot"
              ? "border-rose-500/40 bg-rose-500/10"
              : "border-border bg-card hover:bg-muted/40"
          }`}
        >
          <Flame className="h-4.5 w-4.5 text-rose-500" />
          <span className="text-base font-extrabold text-foreground">{hotCount}</span>
          <span className="text-[10px] font-bold text-muted-foreground">Alta intenção</span>
        </button>
      </div>

      {/* Barra de busca e filtros */}
      <div className="flex items-center gap-2 px-5 pb-3 shrink-0">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar visitante por nome, página, cidade ou origem..."
            className="h-8 w-full rounded-xl border border-border bg-card pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Lista de Visitantes */}
      <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2.5">
        {loading ? (
          <div className="py-12 text-center text-xs text-muted-foreground font-semibold">
            Carregando visitantes do site...
          </div>
        ) : filteredVisitors.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center rounded-2xl border border-dashed border-border bg-card/50">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Globe className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">
                Nenhum visitante encontrado para este filtro
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground max-w-xs">
                Assim que clientes navegarem no site integrado com o widget, você verá aqui as páginas visitadas, tempo de leitura e cliques em tempo real.
              </p>
            </div>
          </div>
        ) : (
          filteredVisitors.map((v) => {
            const displayName = v.name?.trim() || "Visitante do Site";
            const score = Number(v.intentScore || 0);
            const isHot = v.temperature === "hot" || score >= 50;
            const isWarm = !isHot && (v.temperature === "warm" || score >= 20);

            return (
              <div
                key={v.id}
                onClick={() => setSelectedVisitor({ visitorId: v.id, name: displayName })}
                className="group rounded-2xl border border-border bg-card p-3.5 shadow-soft hover:border-primary/40 hover:bg-muted/20 transition cursor-pointer space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary font-extrabold text-xs border border-primary/20">
                        {displayName.slice(0, 2).toUpperCase()}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card ${
                          v.isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-extrabold text-foreground truncate">
                          {displayName}
                        </span>
                        {v.isOnline && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-600 dark:text-emerald-400">
                            Online
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold border ${
                            isHot
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25"
                              : isWarm
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"
                                : "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25"
                          }`}
                        >
                          {isHot ? "🔥 Quente" : isWarm ? "🌤️ Morno" : "❄️ Frio"} · {score} pts
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                        {(v.city || v.region) && (
                          <span className="inline-flex items-center gap-0.5">
                            <MapPin className="h-2.5 w-2.5" />
                            {[v.city, v.region].filter(Boolean).join(", ")}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-0.5">
                          {v.device === "mobile" ? (
                            <Smartphone className="h-2.5 w-2.5" />
                          ) : (
                            <Monitor className="h-2.5 w-2.5" />
                          )}
                          {v.browser || v.device || "Web"}
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {formatRelativeTime(v.lastSeenAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedVisitor({ visitorId: v.id, name: displayName });
                    }}
                    className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-[10px] font-bold text-primary group-hover:bg-primary group-hover:text-primary-foreground transition cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3" />
                    Jornada
                  </button>
                </div>

                {/* Página atual & origem */}
                <div className="rounded-xl bg-muted/40 border border-border/50 px-3 py-2 text-[11px] space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-extrabold uppercase text-muted-foreground">
                      Página Atual
                    </span>
                    {v.utmSource && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                        UTM: {v.utmSource}
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-foreground truncate">
                    {v.currentPageTitle || cleanPath(v.currentPage)}
                  </div>
                  {v.currentPage && (
                    <div className="text-[10px] text-muted-foreground font-mono truncate flex items-center gap-1">
                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{cleanPath(v.currentPage)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal de Jornada Completa do Visitante */}
      <CustomerJourneyModal
        open={selectedVisitor !== null}
        visitorId={selectedVisitor?.visitorId}
        initialName={selectedVisitor?.name}
        onClose={() => setSelectedVisitor(null)}
        onOpenChat={(conversationId) => {
          setSelectedVisitor(null);
          setActiveQueue("todos");
          setSelectedChatId(conversationId);
          setActiveView("chat");
        }}
      />
    </div>
  );
}
