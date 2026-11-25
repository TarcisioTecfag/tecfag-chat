import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  BellRing,
  Building2,
  Clock,
  Cog,
  MessageSquare,
  Package,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { isAppShellPath } from "@/lib/app-routes";
import { playNewLeadAlertSound } from "@/lib/sound-notifications";
import { SystemTooltip } from "@/components/ui/tooltip";

const REMINDER_SOUND_INTERVAL_MS = 15_000;
const MAX_REMINDER_REPLAYS = 3;

function formatElapsedSince(isoString: string, nowMs: number): string {
  const parsed = new Date(isoString).getTime();
  if (!Number.isFinite(parsed)) return "Agora mesmo";
  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSec < 10) return "Agora mesmo";
  if (diffSec < 60) return `há ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  return `há ${diffHours}h`;
}

/**
 * Pop-up grande de interrupção em tela cheia sobre todo o sistema
 * quando surge um Lead Novo para o vendedor.
 *
 * Montado na raiz (`__root.tsx`) via Portal (`z-[10080]`), garantindo visibilidade
 * imediata independente da tela em que o vendedor esteja (Chat, CRM, Negociação,
 * Gestão Comercial, Tarefas ou Mobile).
 */
export function NewLeadAlertModal() {
  const {
    tenant,
    isAuthenticated,
    isRestoringSession,
    mustChangePassword,
    incomingLeadAlerts,
    dismissIncomingLeadAlert,
    openIncomingLeadAlert,
  } = useChat();
  const navigate = useNavigate();
  const location = useLocation();

  const [isMuted, setIsMuted] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const reminderCountRef = useRef(0);

  const activeAlert = incomingLeadAlerts[0] || null;
  const isVisible = Boolean(
    isAuthenticated && !isRestoringSession && !mustChangePassword && activeAlert,
  );

  // Atualiza contador de tempo decorrido enquanto o pop-up estiver aberto
  useEffect(() => {
    if (!isVisible) return;
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isVisible, activeAlert?.id]);

  // Reforço sonoro periódico caso o vendedor esteja olhando outro monitor (até 3 repetições)
  useEffect(() => {
    if (!isVisible || !activeAlert || isMuted) return;
    reminderCountRef.current = 0;

    const interval = setInterval(() => {
      if (reminderCountRef.current >= MAX_REMINDER_REPLAYS) {
        clearInterval(interval);
        return;
      }
      reminderCountRef.current += 1;
      playNewLeadAlertSound();
    }, REMINDER_SOUND_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isVisible, activeAlert?.id, isMuted]);

  if (!isVisible || !activeAlert || typeof document === "undefined") {
    return null;
  }

  const persona = getAiPersona(tenant || "valem");
  const isIndustrial = persona.triagePolicy === "industrial";
  const machineFieldLabel = isIndustrial ? "Máquina" : "Produto / Interesse";
  const isTecfag = tenant === "tecfag";

  const themeStyles = (
    isTecfag
      ? {
          "--primary": "#df3d3d",
          "--primary-soft": "rgba(223, 61, 61, 0.15)",
        }
      : {
          "--primary": "#2dc4a0",
          "--primary-soft": "rgba(45, 196, 160, 0.15)",
        }
  ) as React.CSSProperties;

  const queueCount = incomingLeadAlerts.length;
  const elapsedLabel = formatElapsedSince(activeAlert.receivedAt, nowMs);
  const isOpening = openingId === activeAlert.id;

  const originSubtitle =
    activeAlert.transferSource === "manual_transfer" && activeAlert.transferredBy
      ? `Transferido por ${activeAlert.transferredBy}`
      : activeAlert.transferSource === "rodizio_reassignment"
        ? "Direcionado para você no Rodízio"
        : `Encaminhado por ${persona.name} IA`;

  const handleOpenConversation = async () => {
    if (isOpening) return;
    const targetAlert = activeAlert;
    setOpeningId(targetAlert.id);
    try {
      await openIncomingLeadAlert(targetAlert);
      // Se o vendedor estava numa rota dedicada (ex: /crm/deals/$dealId), navega para o chat
      if (!isAppShellPath(location.pathname)) {
        navigate({
          to: "/chat/$chatKey",
          params: { chatKey: targetAlert.conversationId },
        });
      }
    } finally {
      setOpeningId(null);
    }
  };

  const handleDismiss = () => {
    if (isOpening) return;
    dismissIncomingLeadAlert(activeAlert.id, activeAlert.conversationId);
  };

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="new-lead-alert-title"
      aria-describedby="new-lead-alert-subtitle"
      className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-150"
      style={themeStyles}
    >
      <div className="relative w-full max-w-2xl rounded-3xl border-2 border-primary/80 bg-card text-foreground shadow-[0_32px_96px_-16px_rgba(0,0,0,0.75)] ring-4 ring-primary/25 overflow-hidden animate-in zoom-in-95 fade-in duration-200">
        {/* Barra superior de destaque pulsante */}
        <div className="h-2.5 w-full bg-primary relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-pulse" />
        </div>

        <div className="p-6 sm:p-8 space-y-6">
          {/* Cabeçalho de Alerta */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="relative shrink-0">
                <div className="grid h-16 w-16 sm:h-18 sm:w-18 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
                  <BellRing className="h-8 w-8 sm:h-9 sm:w-9 animate-bounce" />
                </div>
                <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-80" />
                  <span className="relative inline-flex rounded-full h-5 w-5 bg-primary border-2 border-card" />
                </span>
              </div>

              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-primary/15 text-primary border border-primary/30">
                    <Clock className="h-3 w-3" />
                    <span>{elapsedLabel}</span>
                  </span>
                  {queueCount > 1 && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                      1 de {queueCount} leads novos
                    </span>
                  )}
                </div>

                <h1
                  id="new-lead-alert-title"
                  className="text-3xl sm:text-4xl font-black tracking-tight uppercase text-foreground leading-none"
                >
                  LEAD NOVO
                </h1>
                <p
                  id="new-lead-alert-subtitle"
                  className="text-xs sm:text-sm font-medium text-muted-foreground truncate"
                >
                  {originSubtitle}
                  {activeAlert.targetFunnel ? ` · ${activeAlert.targetFunnel}` : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <SystemTooltip
                content={
                  isMuted
                    ? "Reativar alerta sonoro de lembrete"
                    : "Silenciar lembrete sonoro deste alerta"
                }
                side="bottom"
              >
                <button
                  type="button"
                  onClick={() => setIsMuted((prev) => !prev)}
                  aria-label={isMuted ? "Reativar som do alerta" : "Silenciar som do alerta"}
                  className="h-10 w-10 grid place-items-center rounded-xl border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                >
                  {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </button>
              </SystemTooltip>

              <SystemTooltip
                content="Ver depois (o lead permanece no topo de Meus Atendimentos)"
                side="bottom"
              >
                <button
                  type="button"
                  onClick={handleDismiss}
                  disabled={isOpening}
                  aria-label="Fechar alerta de lead novo"
                  className="h-10 w-10 grid place-items-center rounded-xl border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </SystemTooltip>
            </div>
          </div>

          {/* Ficha Grande em Destaque: Nome · Máquina · Empresa */}
          <div className="space-y-3">
            {/* Nome */}
            <div className="rounded-2xl border border-border/90 bg-muted/35 px-5 py-4 flex items-start gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary border border-primary/25 mt-0.5">
                <User className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground">
                  Nome
                </p>
                <p className="text-2xl sm:text-3xl font-black text-foreground leading-tight break-words mt-0.5">
                  {activeAlert.clientName || "Cliente"}
                </p>
              </div>
            </div>

            {/* Máquina e Empresa */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] px-5 py-4 flex items-start gap-3.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary border border-primary/25 mt-0.5">
                  {isIndustrial ? <Cog className="h-5 w-5" /> : <Package className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-extrabold uppercase tracking-widest text-primary">
                    {machineFieldLabel}
                  </p>
                  <p
                    className={`text-lg sm:text-xl font-extrabold leading-snug break-words mt-0.5 ${
                      activeAlert.machine ? "text-foreground" : "text-muted-foreground italic"
                    }`}
                  >
                    {activeAlert.machine || "Não informada"}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-border/90 bg-muted/35 px-5 py-4 flex items-start gap-3.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-card text-foreground border border-border mt-0.5">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground">
                    Empresa
                  </p>
                  <p
                    className={`text-lg sm:text-xl font-extrabold leading-snug break-words mt-0.5 ${
                      activeAlert.company ? "text-foreground" : "text-muted-foreground italic"
                    }`}
                  >
                    {activeAlert.company || "Não informada"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Ação Principal Gigante */}
          <div className="space-y-3 pt-1">
            <button
              type="button"
              onClick={handleOpenConversation}
              disabled={isOpening}
              className="w-full min-h-[62px] sm:min-h-[68px] px-6 py-4 rounded-2xl bg-primary hover:bg-primary/90 active:scale-[0.99] disabled:opacity-60 text-primary-foreground text-base sm:text-lg font-black tracking-tight shadow-xl shadow-primary/30 transition flex items-center justify-center gap-3 cursor-pointer"
            >
              <MessageSquare className="h-6 w-6 shrink-0" />
              <span>
                {isOpening ? "Abrindo conversa..." : "Clique aqui para falar com ele"}
              </span>
              <ArrowRight className="h-6 w-6 shrink-0" />
            </button>

            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={handleDismiss}
                disabled={isOpening}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground transition px-3 py-1.5 rounded-lg hover:bg-muted/60 cursor-pointer disabled:opacity-50"
              >
                {queueCount > 1
                  ? `Ver depois (próximo de ${queueCount} leads)`
                  : "Ver depois (manter em Meus Atendimentos)"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
