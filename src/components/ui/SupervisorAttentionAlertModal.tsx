import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Building2,
  Clock,
  Cog,
  Globe,
  MessageSquare,
  Package,
  Phone,
  ShieldAlert,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { isAppShellPath } from "@/lib/app-routes";
import { playSupervisorAttentionAlertSound } from "@/lib/sound-notifications";
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

function formatDisplayPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw.trim() || null;
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return raw.trim();
}

function formatPreviewClientMessage(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[MEDIA:") || trimmed.startsWith("[LOCAL_MEDIA:")) {
    const nl = trimmed.indexOf("\n");
    const caption = nl !== -1 ? trimmed.slice(nl + 1).trim() : "";
    if (trimmed.includes(":image]")) return caption ? `Imagem: ${caption}` : "Enviou uma imagem";
    if (trimmed.includes(":audio]")) return "Enviou um áudio";
    if (trimmed.includes(":video]")) return caption ? `Vídeo: ${caption}` : "Enviou um vídeo";
    if (trimmed.includes(":sticker]")) return "Enviou uma figurinha";
    return caption ? `Documento: ${caption}` : "Enviou um documento";
  }
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

/**
 * Pop-up de interrupção em tela cheia sobre todo o sistema quando a gestão/supervisão
 * cobra ou orienta um consultor específico a partir do módulo de Monitoramento.
 *
 * Montado na raiz (`__root.tsx`) via Portal (`z-[10085]`), garantindo visibilidade
 * imediata em qualquer tela (Chat, CRM, Negociação, Tarefas ou Mobile).
 */
export function SupervisorAttentionAlertModal() {
  const {
    tenant,
    isAuthenticated,
    isRestoringSession,
    mustChangePassword,
    incomingSupervisorAlerts,
    dismissIncomingSupervisorAlert,
    openIncomingSupervisorAlert,
  } = useChat();
  const navigate = useNavigate();
  const location = useLocation();

  const [isMuted, setIsMuted] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const reminderCountRef = useRef(0);

  const activeAlert = incomingSupervisorAlerts[0] || null;
  const activeAlertId = activeAlert?.id || null;
  const isVisible = Boolean(
    isAuthenticated && !isRestoringSession && !mustChangePassword && activeAlert,
  );

  // Atualiza contador de tempo decorrido enquanto o pop-up estiver aberto
  useEffect(() => {
    if (!isVisible || !activeAlertId) return;
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isVisible, activeAlertId]);

  // Reforço sonoro periódico caso o consultor esteja olhando outro monitor (até 3 repetições)
  useEffect(() => {
    if (!isVisible || !activeAlertId || isMuted) return;
    reminderCountRef.current = 0;

    const interval = setInterval(() => {
      if (reminderCountRef.current >= MAX_REMINDER_REPLAYS) {
        clearInterval(interval);
        return;
      }
      reminderCountRef.current += 1;
      playSupervisorAttentionAlertSound();
    }, REMINDER_SOUND_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isVisible, activeAlertId, isMuted]);

  if (!isVisible || !activeAlert || typeof document === "undefined") {
    return null;
  }

  const persona = getAiPersona(tenant || "valem");
  const isIndustrial = persona.triagePolicy === "industrial";
  const machineFieldLabel = isIndustrial ? "Máquina / Interesse" : "Produto / Interesse";
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

  const queueCount = incomingSupervisorAlerts.length;
  const elapsedLabel = formatElapsedSince(activeAlert.receivedAt, nowMs);
  const isOpening = openingId === activeAlert.id;
  const formattedPhone = formatDisplayPhone(activeAlert.clientPhone);
  const lastClientSnippet = formatPreviewClientMessage(activeAlert.lastClientMessage);
  const channelLabel =
    activeAlert.channel === "livechat"
      ? "Chat do Site"
      : activeAlert.channel === "instagram"
        ? "Instagram"
        : activeAlert.channel === "messenger"
          ? "Messenger"
          : "WhatsApp";

  const handleOpenConversation = async () => {
    if (isOpening) return;
    const targetAlert = activeAlert;
    setOpeningId(targetAlert.id);
    try {
      await openIncomingSupervisorAlert(targetAlert);
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
    dismissIncomingSupervisorAlert(activeAlert.id, activeAlert.conversationId);
  };

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="supervisor-attention-alert-title"
      aria-describedby="supervisor-attention-alert-subtitle"
      className="fixed inset-0 z-[10085] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-150"
      style={themeStyles}
    >
      <div className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl border-2 border-amber-500/85 bg-card text-foreground shadow-[0_32px_96px_-16px_rgba(0,0,0,0.8)] ring-4 ring-amber-500/25 animate-in zoom-in-95 fade-in duration-200">
        {/* Barra superior de destaque pulsante */}
        <div className="h-2.5 w-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-pulse" />
        </div>

        <div className="p-6 sm:p-7 space-y-5">
          {/* Cabeçalho de Alerta */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="relative shrink-0">
                <div className="grid h-15 w-15 sm:h-16 sm:w-16 place-items-center rounded-2xl bg-amber-500 text-neutral-950 shadow-lg shadow-amber-500/30">
                  <AlertTriangle className="h-8 w-8 animate-bounce stroke-[2.4]" />
                </div>
                <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-80" />
                  <span className="relative inline-flex rounded-full h-5 w-5 bg-amber-500 border-2 border-card" />
                </span>
              </div>

              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-500 text-neutral-950 shadow-2xs">
                    <ShieldAlert className="h-3 w-3" />
                    <span>ATENÇÃO!</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-muted text-muted-foreground border border-border">
                    <Clock className="h-3 w-3" />
                    <span>{elapsedLabel}</span>
                  </span>
                  {queueCount > 1 && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-primary/15 text-primary border border-primary/30">
                      1 de {queueCount} avisos
                    </span>
                  )}
                </div>

                <h1
                  id="supervisor-attention-alert-title"
                  className="text-2xl sm:text-3xl font-black tracking-tight uppercase text-foreground leading-none"
                >
                  ORIENTAÇÃO DA GESTÃO
                </h1>
                <p
                  id="supervisor-attention-alert-subtitle"
                  className="text-xs sm:text-sm font-medium text-muted-foreground truncate"
                >
                  Enviado por{" "}
                  <span className="font-bold text-foreground">{activeAlert.supervisorName}</span>
                  {activeAlert.didAssignOperator
                    ? " · Atendimento atribuído para você"
                    : activeAlert.alertReason
                      ? ` · ${activeAlert.alertReason}`
                      : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <SystemTooltip
                content={
                  isMuted
                    ? "Reativar alerta sonoro de lembrete"
                    : "Silenciar lembrete sonoro deste aviso"
                }
                side="bottom"
              >
                <button
                  type="button"
                  onClick={() => setIsMuted((prev) => !prev)}
                  aria-label={isMuted ? "Reativar som do aviso" : "Silenciar som do aviso"}
                  className="h-10 w-10 grid place-items-center rounded-xl border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                >
                  {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </button>
              </SystemTooltip>

              <SystemTooltip
                content="Ver depois (a conversa continua em 1º lugar com a tag ATENÇÃO! até você responder ao cliente)"
                side="bottom"
              >
                <button
                  type="button"
                  onClick={handleDismiss}
                  disabled={isOpening}
                  aria-label="Fechar aviso da gestão"
                  className="h-10 w-10 grid place-items-center rounded-xl border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </SystemTooltip>
            </div>
          </div>

          {/* Bloco 1: O Aviso / Orientação do Gestor */}
          <div className="rounded-2xl border-2 border-amber-500/45 bg-amber-500/[0.09] dark:bg-amber-400/[0.10] px-5 py-4 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>Aviso de {activeAlert.supervisorName}</span>
              </p>
              {activeAlert.alertReason && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30">
                  {activeAlert.alertReason}
                </span>
              )}
            </div>
            <p className="text-base sm:text-lg font-bold text-foreground leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto pr-1">
              {activeAlert.warningText}
            </p>
          </div>

          {/* Bloco 2: Informações sobre o Cliente */}
          <div className="space-y-2.5">
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground px-0.5">
              Informações do cliente
            </p>

            {/* Nome + Telefone + Canal + Setor */}
            <div className="rounded-2xl border border-border/90 bg-muted/35 px-4 py-3.5 flex items-center gap-3.5">
              {activeAlert.clientAvatar ? (
                <img
                  src={activeAlert.clientAvatar}
                  alt={activeAlert.clientName}
                  className="h-12 w-12 shrink-0 rounded-xl object-cover border border-border"
                />
              ) : (
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary border border-primary/25">
                  <User className="h-6 w-6" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xl sm:text-2xl font-black text-foreground leading-tight break-words">
                    {activeAlert.clientName || "Cliente"}
                  </p>
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                    <Globe className="h-3 w-3 text-primary" />
                    <span>{channelLabel}</span>
                  </span>
                  {activeAlert.sectorName && (
                    <span className="inline-flex items-center rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-primary">
                      {activeAlert.sectorName}
                    </span>
                  )}
                </div>

                {formattedPhone && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span>{formattedPhone}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Grid: Empresa & Máquina/Produto (e Negociação CRM se existir) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="rounded-2xl border border-border/90 bg-muted/35 px-4 py-3 flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card text-foreground border border-border mt-0.5">
                  <Building2 className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                    Empresa
                  </p>
                  <p
                    className={`text-sm sm:text-base font-extrabold leading-snug break-words mt-0.5 ${
                      activeAlert.company ? "text-foreground" : "text-muted-foreground italic"
                    }`}
                  >
                    {activeAlert.company || "Não informada"}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-primary/25 bg-primary/[0.05] px-4 py-3 flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary border border-primary/25 mt-0.5">
                  {isIndustrial ? (
                    <Cog className="h-4.5 w-4.5" />
                  ) : (
                    <Package className="h-4.5 w-4.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-primary">
                    {machineFieldLabel}
                  </p>
                  <p
                    className={`text-sm sm:text-base font-extrabold leading-snug break-words mt-0.5 ${
                      activeAlert.machine ? "text-foreground" : "text-muted-foreground italic"
                    }`}
                  >
                    {activeAlert.machine || "Não informada"}
                  </p>
                </div>
              </div>
            </div>

            {/* Negociação CRM vinculada (quando houver) */}
            {activeAlert.dealTitle && (
              <div className="rounded-2xl border border-border/80 bg-muted/25 px-4 py-2.5 flex items-center gap-3">
                <Briefcase className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mr-2">
                    Negociação CRM:
                  </span>
                  <span className="text-xs font-bold text-foreground break-words">
                    {activeAlert.dealTitle}
                  </span>
                  {(activeAlert.dealPipelineName || activeAlert.dealStageName) && (
                    <span className="text-[11px] text-muted-foreground ml-1.5">
                      (
                      {[activeAlert.dealPipelineName, activeAlert.dealStageName]
                        .filter(Boolean)
                        .join(" · ")}
                      )
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Preview da última mensagem do cliente (quando houver) */}
            {lastClientSnippet && (
              <div className="rounded-xl border border-border/70 bg-background/60 px-3.5 py-2 text-xs text-muted-foreground">
                <span className="font-bold text-foreground mr-1.5">
                  Última mensagem do cliente:
                </span>
                <span className="italic">&ldquo;{lastClientSnippet}&rdquo;</span>
              </div>
            )}
          </div>

          {/* Ação Principal Gigante */}
          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              onClick={handleOpenConversation}
              disabled={isOpening}
              className="w-full min-h-[60px] sm:min-h-[64px] px-6 py-3.5 rounded-2xl bg-primary hover:bg-primary/90 active:scale-[0.99] disabled:opacity-60 text-primary-foreground text-base sm:text-lg font-black tracking-tight shadow-xl shadow-primary/30 transition flex items-center justify-center gap-3 cursor-pointer"
            >
              <MessageSquare className="h-6 w-6 shrink-0" />
              <span>{isOpening ? "Abrindo conversa..." : "Abrir conversa agora"}</span>
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
                  ? `Ver depois (próximo de ${queueCount} avisos · mantém tag ATENÇÃO! no topo)`
                  : "Ver depois (mantém tag ATENÇÃO! no 1º lugar até responder)"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
