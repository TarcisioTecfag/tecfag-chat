import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Radio,
  RefreshCw,
  Clock,
  Bot,
  UserCheck,
  Users,
  MessageSquare,
  ExternalLink,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Globe,
  Calendar,
  Filter,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SystemTooltip } from "@/components/ui/tooltip";
import { CrmDatePicker } from "@/components/crm/CrmDatePicker";
import type {
  SdrSweepItem,
  SdrSweepPeriod,
  SdrSweepResult,
} from "@/lib/triage/sdr-sweep";

export interface SdrSweepModalProps {
  personaName: string;
  onSelectConversation: (conversationId: string) => void;
  onOpenChat: (conversationId: string) => void;
}

type SweepTabKey = "awaitingFagner" | "awaitingClient" | "transferred";

function getTodayBrtInput(): string {
  const shifted = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatBrtShort(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWaitDuration(mins?: number | null): string {
  if (mins === null || mins === undefined) return "—";
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  if (h < 24) return rem > 0 ? `${h}h ${rem}min` : `${h}h`;
  const days = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

function getInitials(name?: string | null): string {
  if (!name) return "OP";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function SdrSweepModal({
  personaName,
  onSelectConversation,
  onOpenChat,
}: SdrSweepModalProps) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<SdrSweepPeriod>("today");
  const [startDate, setStartDate] = useState<string | null>(() => getTodayBrtInput());
  const [endDate, setEndDate] = useState<string | null>(() => getTodayBrtInput());
  const [activeTab, setActiveTab] = useState<SweepTabKey>("awaitingFagner");
  const [selectedOperatorKey, setSelectedOperatorKey] = useState<string | null>(null);

  const [data, setData] = useState<SdrSweepResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  const runSweep = useCallback(
    async (
      targetPeriod: SdrSweepPeriod = period,
      targetStart: string | null = startDate,
      targetEnd: string | null = endDate,
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ period: targetPeriod });
        if (targetPeriod === "range") {
          if (targetStart) params.set("startDate", targetStart);
          if (targetEnd) params.set("endDate", targetEnd);
        }
        const res = await fetch(`${BACKEND_URL}/api/valentina/sdr-sweep?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload.error || "Não foi possível executar a varredura.");
        }
        if (!controller.signal.aborted) {
          setData(payload);
          setSelectedOperatorKey(null);
          // Escolhe automaticamente a aba mais relevante se a atual estiver vazia
          if (payload.summary) {
            if (payload.summary.awaitingFagnerCount > 0) {
              setActiveTab("awaitingFagner");
            } else if (payload.summary.awaitingClientCount > 0) {
              setActiveTab("awaitingClient");
            } else if (payload.summary.transferredCount > 0) {
              setActiveTab("transferred");
            }
          }
        }
      } catch (err: any) {
        if (!controller.signal.aborted) {
          setError(err?.message || "Erro de comunicação ao executar a varredura.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [BACKEND_URL, period, startDate, endDate],
  );

  useEffect(() => {
    if (open) {
      void runSweep(period, startDate, endDate);
    } else {
      abortRef.current?.abort();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [open]);

  const displayedItems: SdrSweepItem[] = useMemo(() => {
    if (!data) return [];
    if (activeTab === "awaitingFagner") return data.awaitingFagner;
    if (activeTab === "awaitingClient") return data.awaitingClient;
    if (selectedOperatorKey) {
      const group = data.transferredByOperator.find(
        (g) => (g.operatorId || `name:${g.operatorName}`) === selectedOperatorKey,
      );
      return group ? group.items : data.transferred;
    }
    return data.transferred;
  }, [data, activeTab, selectedOperatorKey]);

  const handleOpenInSdr = (conversationId: string) => {
    setOpen(false);
    onSelectConversation(conversationId);
  };

  const handleOpenInChat = (conversationId: string) => {
    setOpen(false);
    onOpenChat(conversationId);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <SystemTooltip
        content={`Executar varredura real das triagens do ${personaName} (pendentes de cliente, pendentes da IA e transferidos por consultor)`}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="Varredura de triagens"
            className="px-2.5 py-1.5 sm:py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 border border-border bg-card text-foreground hover:bg-muted/60 cursor-pointer shadow-soft"
          >
            <Radio className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">Varredura</span>
          </button>
        </DialogTrigger>
      </SystemTooltip>

      <DialogContent className="w-[96vw] max-w-5xl max-h-[90dvh] flex flex-col overflow-hidden p-0 gap-0 rounded-2xl md:rounded-3xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <DialogHeader className="px-4 py-3 sm:px-6 sm:py-4 border-b border-border/80 bg-muted/15 shrink-0">
          <div className="flex items-center justify-between gap-3 pr-6 flex-wrap">
            <div className="flex items-center gap-2.5 sm:gap-3 text-left">
              <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl sm:rounded-2xl bg-primary/12 border border-primary/25 text-primary shrink-0">
                <Radio className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
              </div>
              <div>
                <DialogTitle className="text-sm sm:text-base font-extrabold text-foreground">
                  Varredura de Triagens — {personaName}
                </DialogTitle>
                <DialogDescription className="hidden sm:block text-xs text-muted-foreground mt-0.5">
                  Diagnóstico real em banco: quem aguarda resposta do cliente, quem aguarda resposta do {personaName}, quantos foram transferidos e para qual consultor.
                </DialogDescription>
              </div>
            </div>

            {data && (
              <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
                Atualizado às {formatBrtShort(data.generatedAt)} (Brasília) · {data.summary.totalAnalyzed} triagens analisadas
              </span>
            )}
          </div>

          {/* Barra de Seleção de Período */}
          <div className="mt-3.5 flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center rounded-xl border border-border bg-card p-0.5 shadow-2xs">
              {(
                [
                  { id: "today", label: "Hoje" },
                  { id: "range", label: "Tempo definido" },
                  { id: "all", label: "Todo tempo" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setPeriod(opt.id);
                    if (opt.id !== "range") {
                      void runSweep(opt.id, startDate, endDate);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    period === opt.id
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {period === "range" && (
              <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                <div className="flex-1 min-w-[130px] sm:flex-none sm:w-40">
                  <CrmDatePicker
                    value={startDate}
                    onChange={setStartDate}
                    placeholder="Data inicial"
                    tooltipText="Data inicial da varredura (Horário de Brasília)"
                  />
                </div>
                <span className="text-xs font-bold text-muted-foreground">até</span>
                <div className="flex-1 min-w-[130px] sm:flex-none sm:w-40">
                  <CrmDatePicker
                    value={endDate}
                    onChange={setEndDate}
                    placeholder="Data final"
                    tooltipText="Data final da varredura (Horário de Brasília)"
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={loading}
              onClick={() => void runSweep(period, startDate, endDate)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-extrabold text-primary-foreground shadow-soft hover:bg-primary-hover disabled:opacity-50 transition cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>{loading ? "Varrendo..." : "Executar Varredura"}</span>
            </button>
          </div>
        </DialogHeader>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs font-semibold text-destructive"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 4 Cards de KPI clicáveis */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => {
                setActiveTab("awaitingFagner");
                setSelectedOperatorKey(null);
              }}
              className={`text-left rounded-2xl border p-3.5 transition cursor-pointer ${
                activeTab === "awaitingFagner"
                  ? "border-primary bg-primary-soft/50 ring-2 ring-primary/20"
                  : "border-border bg-muted/20 hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Falta resposta ({personaName})
                </span>
                <Bot className="h-4 w-4 text-rose-500 shrink-0" />
              </div>
              <p className="text-2xl font-black text-foreground mt-1.5 tabular-nums">
                {data ? data.summary.awaitingFagnerCount : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Cliente aguardando IA ou handoff preso
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("awaitingClient");
                setSelectedOperatorKey(null);
              }}
              className={`text-left rounded-2xl border p-3.5 transition cursor-pointer ${
                activeTab === "awaitingClient"
                  ? "border-primary bg-primary-soft/50 ring-2 ring-primary/20"
                  : "border-border bg-muted/20 hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Falta resposta (Cliente)
                </span>
                <Clock className="h-4 w-4 text-amber-500 shrink-0" />
              </div>
              <p className="text-2xl font-black text-foreground mt-1.5 tabular-nums">
                {data ? data.summary.awaitingClientCount : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Sem resposta ou aguardando retorno
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("transferred");
                setSelectedOperatorKey(null);
              }}
              className={`text-left rounded-2xl border p-3.5 transition cursor-pointer ${
                activeTab === "transferred"
                  ? "border-primary bg-primary-soft/50 ring-2 ring-primary/20"
                  : "border-border bg-muted/20 hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Transferidos
                </span>
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              </div>
              <p className="text-2xl font-black text-foreground mt-1.5 tabular-nums">
                {data ? data.summary.transferredCount : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Triagens concluídas/encaminhadas
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("transferred");
                setSelectedOperatorKey(null);
              }}
              className="text-left rounded-2xl border border-border bg-muted/20 hover:bg-muted/40 p-3.5 transition cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Consultores Recebendo
                </span>
                <Users className="h-4 w-4 text-primary shrink-0" />
              </div>
              <p className="text-2xl font-black text-foreground mt-1.5 tabular-nums">
                {data ? data.summary.distinctOperatorsCount : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Operadores com leads transferidos
              </p>
            </button>
          </div>

          {/* Seção: Para quem foi transferido (Ranking por Consultor) */}
          {data && data.transferredByOperator.length > 0 && (
            <div className="rounded-2xl border border-border bg-muted/15 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-primary" />
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                    Para quem foi transferido ({data.summary.transferredCount})
                  </h4>
                </div>
                {selectedOperatorKey && (
                  <button
                    type="button"
                    onClick={() => setSelectedOperatorKey(null)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[10px] font-bold text-primary hover:bg-muted cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                    Mostrar todos os consultores
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {data.transferredByOperator.map((group) => {
                  const key = group.operatorId || `name:${group.operatorName}`;
                  const isSel = activeTab === "transferred" && selectedOperatorKey === key;
                  const funnelBadges = Object.entries(group.funnels);

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setActiveTab("transferred");
                        setSelectedOperatorKey(isSel ? null : key);
                      }}
                      className={`text-left rounded-xl border p-3 transition cursor-pointer flex items-start gap-2.5 ${
                        isSel
                          ? "border-primary bg-primary-soft/50 shadow-xs"
                          : "border-border/80 bg-card hover:border-primary/40"
                      }`}
                    >
                      {group.operatorAvatar ? (
                        <img
                          src={group.operatorAvatar}
                          alt={group.operatorName}
                          className="h-8 w-8 rounded-full object-cover border border-primary/25 shrink-0"
                        />
                      ) : (
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/12 text-primary font-extrabold text-[10px] border border-primary/20 shrink-0">
                          {getInitials(group.operatorName)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-xs font-extrabold text-foreground truncate">
                            {group.operatorName}
                          </span>
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-extrabold text-primary-foreground shrink-0 tabular-nums">
                            {group.count}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {funnelBadges.map(([funnel, cnt]) => (
                            <span
                              key={funnel}
                              className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground"
                            >
                              {funnel}: {cnt}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lista Detalhada da Categoria Selecionada */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-primary" />
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                  {activeTab === "awaitingFagner"
                    ? `Faltam resposta do ${personaName} (${data?.summary.awaitingFagnerCount ?? 0})`
                    : activeTab === "awaitingClient"
                      ? `Faltam resposta do cliente (${data?.summary.awaitingClientCount ?? 0})`
                      : `Transferidos${selectedOperatorKey ? " (filtrado por consultor)" : ""} (${displayedItems.length})`}
                </h4>
              </div>
              {data && (data.summary.manualWithoutCompletionCount > 0 || data.summary.stoppedCount > 0) && (
                <span className="text-[10px] text-muted-foreground">
                  Outras no período: {data.summary.manualWithoutCompletionCount} assumida(s) manualmente · {data.summary.stoppedCount} interrompida(s)
                </span>
              )}
            </div>

            {loading && !data ? (
              <div className="rounded-2xl border border-border/70 bg-muted/15 py-10 text-center text-xs text-muted-foreground">
                Varrendo triagens no banco de dados…
              </div>
            ) : displayedItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-muted/15 py-10 text-center space-y-1">
                <p className="text-xs font-bold text-foreground">
                  Nenhum atendimento encontrado nesta categoria para o período selecionado.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Experimente mudar para &ldquo;Tempo definido&rdquo; ou &ldquo;Todo tempo&rdquo; acima.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {displayedItems.map((item) => (
                  <div
                    key={`${item.flowId}-${item.conversationId}`}
                    className="rounded-2xl border border-border/80 bg-card hover:border-primary/40 transition p-3.5 flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {item.contactAvatar ? (
                        <img
                          src={item.contactAvatar}
                          alt={item.contactName}
                          className="h-9 w-9 rounded-full object-cover border border-primary/20 shrink-0"
                        />
                      ) : (
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/12 text-primary font-extrabold text-xs border border-primary/20 shrink-0">
                          {getInitials(item.contactName)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-extrabold text-foreground truncate">
                            {item.contactName}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold border ${
                              item.channel === "site"
                                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20"
                                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            }`}
                          >
                            {item.channel === "site" ? (
                              <>
                                <Globe className="h-2.5 w-2.5" /> Site
                              </>
                            ) : (
                              <>
                                <MessageSquare className="h-2.5 w-2.5" /> WhatsApp
                              </>
                            )}
                          </span>
                          {item.targetFunnel && (
                            <span className="rounded-md bg-primary-soft px-1.5 py-0.5 text-[9px] font-extrabold text-primary border border-primary/20">
                              {item.targetFunnel}
                            </span>
                          )}
                          {item.operatorName && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold text-foreground border border-border">
                              <UserCheck className="h-2.5 w-2.5 text-primary" />
                              {item.operatorName}
                            </span>
                          )}
                        </div>

                        <p className="text-[10px] text-muted-foreground truncate">
                          {item.company}
                          {item.phone ? ` · ${item.phone}` : ""}
                          {` · ${item.reason}`}
                        </p>

                        {item.lastMessagePreview && (
                          <p className="text-[11px] text-foreground/85 bg-muted/35 rounded-lg px-2.5 py-1 truncate">
                            <span className="font-bold text-muted-foreground mr-1">
                              {item.lastMessageSender === "client"
                                ? "Cliente:"
                                : item.lastMessageSender === "agent"
                                  ? "Operador:"
                                  : `${personaName}:`}
                            </span>
                            {item.lastMessagePreview}
                          </p>
                        )}

                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-2.5 w-2.5" />
                            Última interação: {formatBrtShort(item.lastMessageAt || item.lastInteractionAt)}
                          </span>
                          {item.waitingMinutes !== null && activeTab !== "transferred" && (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400">
                              <Clock className="h-2.5 w-2.5" />
                              Aguardando há {formatWaitDuration(item.waitingMinutes)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 self-center">
                      <SystemTooltip content="Focar atendimento na tela SDR (Ao Vivo)">
                        <button
                          type="button"
                          onClick={() => handleOpenInSdr(item.conversationId)}
                          className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/40 hover:bg-muted px-2.5 py-1.5 text-[10px] font-extrabold text-foreground transition cursor-pointer"
                        >
                          <Eye className="h-3 w-3 text-primary" />
                          <span>Ver no SDR</span>
                        </button>
                      </SystemTooltip>
                      <SystemTooltip content="Abrir conversa completa no módulo Chat">
                        <button
                          type="button"
                          onClick={() => handleOpenInChat(item.conversationId)}
                          className="inline-flex items-center gap-1 rounded-xl bg-primary/12 hover:bg-primary/20 border border-primary/25 px-2.5 py-1.5 text-[10px] font-extrabold text-primary transition cursor-pointer"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>Abrir Chat</span>
                        </button>
                      </SystemTooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
