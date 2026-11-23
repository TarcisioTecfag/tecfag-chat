// ══════════════════════════════════════════════════════════════════════════════
// 📋 SDR TAB — Monitoramento em Tempo Real do Agente SDR Fagner / Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useDeferredValue,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus,
  CheckCircle,
  Clock,
  Bot,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Circle,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  MessageSquare,
  Square,
  UserCheck,
  Calendar,
  X,
  Play,
  Pause,
  FileText,
  Download,
  PanelRightOpen,
  PanelRightClose,
  Loader2,
  Info,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { AiAvatar } from "@/components/ui/AiAvatar";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  SystemTooltip,
} from "@/components/ui/tooltip";
import { SdrKanbanBoard } from "./SdrKanbanBoard";
import {
  SdrFilterState,
  DEFAULT_SDR_FILTER_STATE,
  SdrViewMode,
  filterSdrSessions,
  getSessionActivityTimestamp,
  hasActiveSdrFilters,
  mergeSessionsPreservingRefs,
  computeAdaptiveSdrPollDelayMs,
} from "./sdr-kanban-data";
import type { IndustrialMonitoring } from "@/lib/triage/industrial-monitor";
import type { AgentMonitoringSummary } from "@/lib/triage/agent-monitor-store";
import { IndustrialMonitoringPanel } from "./IndustrialMonitoringPanel";
import { IndustrialApprovalPanel } from "./IndustrialApprovalPanel";
import {
  SdrKanbanSkeleton,
  SdrLiveListSkeleton,
  SdrChatMessagesSkeleton,
  SdrRightPanelSkeleton,
} from "./SdrSkeletons";
import { getAdaptiveIndustrialCollectedData } from "@/lib/triage/industrial-policy";
import {
  useAudioPlaybackRate,
  formatAudioPlaybackRate,
  applyAudioPlaybackRate,
} from "@/lib/audio-playback-rate";

export interface SdrTriageMessage {
  id?: string;
  sender: "client" | "bot" | "agent" | "system";
  senderName?: string;
  senderAvatar?: string | null;
  text: string;
  time: string;
  date?: string;
  sentAt?: string;
  isInternalNote?: boolean;
  isCycleReset?: boolean;
  mediaUrl?: string | null;
  mediaType?: string | null;
  fileName?: string | null;
}

export interface SdrPreviousTriage {
  id: string;
  startedAt: string;
  completedAt: string;
  outcome?: string;
  targetFunnel?: string;
  subflow?: string;
  company?: string;
  document?: string;
  clientName?: string;
  interest?: string;
  responsibleName?: string;
}

export interface SdrKnownClient {
  companyName: string;
  document?: string | null;
  contactName?: string | null;
  accountId?: string | null;
  lastSector?: string | null;
  lastInterest?: string | null;
  source?: string;
  confirmed?: boolean;
}

export type SdrSessionStatus =
  | "active"
  | "awaiting_approval"
  | "completed"
  | "abandoned"
  | "stopped"
  | "manual";

export interface SdrTriageSession {
  id: string;
  conversationId: string;
  contactName: string;
  contactAvatar?: string | null;
  company: string;
  phone: string;
  currentStep: string;
  collectedData: Record<string, { value: string; status: "filled" | "pending" }>;
  startedAt: string;
  completedAt?: string | null;
  lastClientMessageAt?: string | null;
  lastMessageAt?: string | null;
  lastMessagePreview?: string;
  status: SdrSessionStatus;
  outcome?: string;
  responsibleName?: string;
  unreadCount?: number;
  channel?: string;
  monitoring?: IndustrialMonitoring;
  pendingApproval?: IndustrialMonitoring["pendingApproval"] | null;
  subflow?: string;
  funnelStage?: string;
  targetFunnel?: string;
  triageProgress?: {
    filledCount: number;
    totalCount: number;
    percentage: number;
    targetFields: string[];
  };
  knownClient?: SdrKnownClient | null;
  linkedDeal?: {
    dealId: string;
    dealTitle: string;
    action?: string;
    createdAt?: string;
  } | null;
  previousTriages?: SdrPreviousTriage[];
  messagesLoaded?: boolean;
  messages: SdrTriageMessage[];
}

export function getSdrSessionLatestClientTimestamp(session: SdrTriageSession): number {
  return getSessionActivityTimestamp(session);
}

export type SdrTimelineItem =
  | {
      type: "date-divider";
      id: string;
      label: string;
    }
  | {
      type: "cycle-divider";
      id: string;
      variant: "previous-triage" | "new-triage" | "operator-handoff";
      title: string;
      subtitle?: string;
    }
  | {
      type: "system-event";
      id: string;
      text: string;
      time: string;
    }
  | {
      type: "message";
      id: string;
      msg: SdrTriageMessage;
      index: number;
    };

function formatDateMarkerLabel(dateStr?: string): string {
  if (!dateStr) return "Hoje";
  const now = new Date();
  const todayStr = now.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });

  if (dateStr === todayStr) return `Hoje, ${dateStr}`;
  if (dateStr === yesterdayStr) return `Ontem, ${dateStr}`;
  return dateStr;
}

function getOperatorInitials(name?: string): string {
  if (!name) return "OP";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function isExplicitCycleResetMessage(m: SdrTriageMessage): boolean {
  if (m.isCycleReset === true) return true;
  if (m.sender !== "system") return false;
  const raw = (m.text || "").trim();
  return (
    raw.toLowerCase() === "!reset" ||
    raw.includes("Fluxo de triagem reiniciado") ||
    raw.includes("Triagem anterior encerrada")
  );
}

function getCleanTargetFunnel(targetFunnel?: string | null): string | undefined {
  if (!targetFunnel) return undefined;
  const trimmed = targetFunnel.trim();
  if (!trimmed || /^aguardando/i.test(trimmed)) return undefined;
  return trimmed;
}

export function buildSdrTimelineItems(
  session: SdrTriageSession,
  personaName: string,
): SdrTimelineItem[] {
  const rawMessages = session.messages || [];
  if (rawMessages.length === 0) return [];

  // 1. Identificar apenas fronteiras REAIS de ciclos de triagem (nunca eventos genéricos de sistema)
  const cycleStartIndices: number[] = [0];
  let hadAgentInCurrentCycle = false;
  let hadBotInCurrentCycle = false;

  const sessionStartMs = session.startedAt ? new Date(session.startedAt).getTime() : NaN;
  const hasRecordedPreviousTriages =
    Array.isArray(session.previousTriages) && session.previousTriages.length > 0;
  let splitBySessionStartUsed = false;

  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i];
    const prev = i > 0 ? rawMessages[i - 1] : null;

    if (i > 0) {
      const isSystemReset = isExplicitCycleResetMessage(m);
      const prevMs = prev?.sentAt ? new Date(prev.sentAt).getTime() : NaN;
      const currMs = m.sentAt ? new Date(m.sentAt).getTime() : NaN;
      const diffMinutes = !isNaN(prevMs) && !isNaN(currMs) ? (currMs - prevMs) / (1000 * 60) : 0;
      const dateChanged = Boolean(prev?.date && m.date && prev.date !== m.date);

      const botResumedAfterOperator =
        m.sender === "bot" &&
        hadAgentInCurrentCycle &&
        (dateChanged || diffMinutes >= 30);

      const crossedCurrentSessionStart =
        !splitBySessionStartUsed &&
        !isNaN(sessionStartMs) &&
        !isNaN(prevMs) &&
        !isNaN(currMs) &&
        prevMs < sessionStartMs - 2 * 60 * 1000 &&
        currMs >= sessionStartMs - 60 * 1000 &&
        (hasRecordedPreviousTriages ||
          hadAgentInCurrentCycle ||
          (hadBotInCurrentCycle && diffMinutes >= 60));

      if (isSystemReset || botResumedAfterOperator || crossedCurrentSessionStart) {
        cycleStartIndices.push(i);
        hadAgentInCurrentCycle = false;
        hadBotInCurrentCycle = false;
        if (crossedCurrentSessionStart) {
          splitBySessionStartUsed = true;
        }
      }
    }

    if (m.sender === "agent") hadAgentInCurrentCycle = true;
    if (m.sender === "bot") hadBotInCurrentCycle = true;
  }

  const totalCycles = cycleStartIndices.length;
  const cycleStartSet = new Map<number, number>();
  cycleStartIndices.forEach((msgIdx, cycleIdx) => {
    cycleStartSet.set(msgIdx, cycleIdx);
  });

  const cleanFunnel = getCleanTargetFunnel(session.targetFunnel);
  const items: SdrTimelineItem[] = [];
  let lastRenderedDate: string | undefined = undefined;
  let currentCycleIdx = 0;
  let operatorHandoffShownInCycle = false;
  let sawBotInCycle = false;

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];

    // Verificar início de ciclo real de triagem
    if (cycleStartSet.has(i)) {
      currentCycleIdx = cycleStartSet.get(i)!;
      operatorHandoffShownInCycle = false;
      sawBotInCycle = false;

      const isPreviousCycle = currentCycleIdx < totalCycles - 1;
      const cycleDate = msg.date || undefined;

      if (isPreviousCycle) {
        const prevMeta = session.previousTriages?.[currentCycleIdx];
        const subtitleParts: string[] = [];
        if (cycleDate) subtitleParts.push(cycleDate);
        const prevFunnel = getCleanTargetFunnel(prevMeta?.targetFunnel);
        if (prevFunnel) subtitleParts.push(prevFunnel);
        if (prevMeta?.responsibleName) subtitleParts.push(`Atendido por ${prevMeta.responsibleName}`);

        items.push({
          type: "cycle-divider",
          id: `cycle-prev-${currentCycleIdx}-${i}`,
          variant: "previous-triage",
          title: "Triagem anterior",
          subtitle:
            subtitleParts.length > 0
              ? subtitleParts.join(" · ")
              : "Histórico de triagem concluída anteriormente",
        });
      } else if (totalCycles > 1) {
        items.push({
          type: "cycle-divider",
          id: `cycle-new-${currentCycleIdx}-${i}`,
          variant: "new-triage",
          title: "Triagem anterior encerrada · Novo ciclo de triagem",
          subtitle: cycleDate
            ? `Iniciado em ${formatDateMarkerLabel(cycleDate)} com ${personaName}`
            : `Novo ciclo iniciado com ${personaName}`,
        });
      } else if (hasRecordedPreviousTriages) {
        const lastPrev = session.previousTriages![session.previousTriages!.length - 1];
        const prevDate = lastPrev?.completedAt
          ? new Date(lastPrev.completedAt).toLocaleDateString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })
          : undefined;
        const prevFunnel = getCleanTargetFunnel(lastPrev?.targetFunnel);
        items.push({
          type: "cycle-divider",
          id: `cycle-archived-prev-${i}`,
          variant: "previous-triage",
          title: "Cliente com triagem anterior registrada",
          subtitle:
            [
              prevDate ? `Última triagem em ${prevDate}` : null,
              prevFunnel ? `Setor: ${prevFunnel}` : null,
              lastPrev?.responsibleName ? `Operador: ${lastPrev.responsibleName}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Histórico consolidado no mesmo chat",
        });
      }
    }

    // Separador discreto por data
    if (msg.date && msg.date !== lastRenderedDate) {
      lastRenderedDate = msg.date;
      items.push({
        type: "date-divider",
        id: `date-${msg.date}-${i}`,
        label: formatDateMarkerLabel(msg.date),
      });
    }

    // Mensagens explícitas de reset já estão representadas pelo divisor de ciclo
    if (isExplicitCycleResetMessage(msg)) {
      continue;
    }

    // Eventos reais do sistema (ex: "Atendimento assumido por Denise Gomes", "Atendimento encerrado...")
    if (msg.sender === "system") {
      const cleanText = (msg.text || "").trim();
      if (cleanText) {
        items.push({
          type: "system-event",
          id: msg.id || `sys-${i}`,
          text: cleanText,
          time: msg.time,
        });
      }
      continue;
    }

    if (msg.sender === "bot") {
      sawBotInCycle = true;
    }

    // Separador de transição só quando houve de fato triagem do bot neste ciclo (ou ciclo concluído/transferido)
    if (
      msg.sender === "agent" &&
      !operatorHandoffShownInCycle &&
      (sawBotInCycle || session.status === "completed")
    ) {
      operatorHandoffShownInCycle = true;
      const isPreviousCycle = currentCycleIdx < totalCycles - 1;
      const opName = msg.senderName || session.responsibleName || "Operador";
      items.push({
        type: "cycle-divider",
        id: `handoff-${currentCycleIdx}-${i}`,
        variant: "operator-handoff",
        title: isPreviousCycle
          ? `Triagem anterior concluída · Atendimento com ${opName}`
          : `Atendimento com ${opName}`,
        subtitle: cleanFunnel ? `Setor: ${cleanFunnel}` : undefined,
      });
    }

    items.push({
      type: "message",
      id: msg.id || `msg-${i}`,
      msg,
      index: i,
    });
  }

  return items;
}

const AudioPlayerBubble = React.memo(function AudioPlayerBubble({
  src,
  isBot,
}: {
  src: string;
  isBot: boolean;
}) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const { playbackRate, cyclePlaybackRate, syncAudioElement } = useAudioPlaybackRate(audioRef, src);

  const togglePlay = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      syncAudioElement();
      audioRef.current.play().catch((err) => console.error("Erro ao tocar áudio:", err));
      setIsPlaying(true);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs <= 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="flex items-center gap-3 py-1 px-1 min-w-[225px] max-w-[270px]">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => syncAudioElement()}
        onLoadedMetadata={() => {
          applyAudioPlaybackRate(audioRef.current, playbackRate);
          setDuration(audioRef.current?.duration || 0);
        }}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />
      <button
        type="button"
        onClick={togglePlay}
        className={`h-9 w-9 rounded-full grid place-items-center shrink-0 transition cursor-pointer shadow-soft ${
          isBot
            ? "bg-white text-primary hover:bg-white/90"
            : "bg-primary text-white hover:bg-primary-hover"
        }`}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="h-4 w-4 fill-current ml-0.5" />
        )}
      </button>

      <div className="flex-1 space-y-1">
        <div className="relative w-full h-1.5 rounded-full bg-black/10 overflow-hidden cursor-pointer">
          <div
            className={`h-full rounded-full transition-all duration-100 ${isBot ? "bg-white" : "bg-primary"}`}
            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration > 0 && isFinite(duration) ? duration : 1}
            step={0.05}
            value={currentTime}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              const v = Number(e.target.value);
              setCurrentTime(v);
              if (audioRef.current && isFinite(v)) {
                audioRef.current.currentTime = v;
              }
            }}
            className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
          />
        </div>
        <div className="flex justify-between items-center text-[9px] opacity-85 font-mono">
          <span>{formatTime(currentTime)}</span>
          <div className="flex items-center gap-1.5">
            <SystemTooltip
              content={`Velocidade ${formatAudioPlaybackRate(playbackRate)} (clique para alternar: 1x → 1.5x → 2.0x → 2.5x)`}
            >
              <button
                type="button"
                onClick={cyclePlaybackRate}
                aria-label={`Velocidade de reprodução: ${formatAudioPlaybackRate(playbackRate)}`}
                className={`inline-flex h-4 px-1.5 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold tracking-tight transition active:scale-95 cursor-pointer tabular-nums ${
                  isBot
                    ? playbackRate > 1
                      ? "bg-white text-primary shadow-2xs"
                      : "bg-white/20 text-white hover:bg-white/30"
                    : playbackRate > 1
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "bg-primary/15 text-primary hover:bg-primary/25"
                }`}
              >
                {formatAudioPlaybackRate(playbackRate)}
              </button>
            </SystemTooltip>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

const VALEM_SDR_FIELDS = [
  "NOME COMPLETO",
  "EMPRESA",
  "CNPJ",
  "EMAIL",
  "QUAL O TIPO DE PRODUTO?",
  "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO",
  "TIPO DE QUALIFICAÇÃO",
  "QUALIFICAÇÃO (TEMPERATURA)",
];

function normalizeKey(key: string, isIndustrial: boolean): string {
  const clean = key
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, " ")
    .trim();

  if (clean.includes("NOME")) return "NOME COMPLETO";
  if (clean.includes("EMPRESA") || clean.includes("RAZAO")) return "EMPRESA";

  if (isIndustrial) {
    if (clean.includes("CNPJ") || clean.includes("CPF") || clean.includes("DOCUMENTO"))
      return "CNPJ OU CPF";
    if (clean.includes("RAMO") || clean.includes("EMBALA") || clean.includes("ENVASA"))
      return "RAMO / O QUE EMBALA";
    if (
      clean.includes("MAQUINA") ||
      clean.includes("PECA") ||
      clean.includes("INTERESSE") ||
      clean.includes("PRODUTO")
    ) {
      return "MÁQUINA / PEÇA / INTERESSE";
    }
    if (clean.includes("VOLUME") || clean.includes("PRODUCAO") || clean.includes("QUANTIDADE"))
      return "VOLUME / PRODUÇÃO";
    if (clean.includes("SETOR") || clean.includes("FUNIL") || clean.includes("DESTINO"))
      return "SETOR / FUNIL DE DESTINO";
    return key.trim().toUpperCase();
  }

  if (clean.includes("CNPJ") || clean.includes("CPF") || clean.includes("DOCUMENTO")) return "CNPJ";
  if (clean.includes("EMAIL") || clean.includes("E MAIL") || clean.includes("CORREIO"))
    return "EMAIL";
  if (clean.includes("PRODUTO")) return "QUAL O TIPO DE PRODUTO?";
  if (clean.includes("PROJETO") || clean.includes("DESENVOLVIMENTO"))
    return "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO";
  if (clean.includes("TEMPERATURA")) return "QUALIFICAÇÃO (TEMPERATURA)";
  if (clean.includes("QUALIFICACAO")) return "TIPO DE QUALIFICAÇÃO";

  return key.trim().toUpperCase();
}

function getMergedCollectedData(
  rawCollected: Record<string, any> = {},
  isIndustrial: boolean,
  session?: Partial<SdrTriageSession> | null,
) {
  if (isIndustrial) {
    const canonicalRaw: Record<string, { value?: string; status?: string }> = {};
    for (const [rawKey, rawVal] of Object.entries(rawCollected || {})) {
      if (!rawVal) continue;
      if (rawKey.startsWith("_")) {
        canonicalRaw[rawKey] =
          typeof rawVal === "string" ? { value: rawVal, status: "filled" } : rawVal;
        continue;
      }
      const textVal = typeof rawVal === "string" ? rawVal : rawVal.value;
      const isFilled =
        typeof rawVal === "object" && rawVal.status === "filled"
          ? true
          : Boolean(
              textVal &&
                String(textVal).trim() !== "" &&
                String(textVal) !== "Aguardando..." &&
                !String(textVal).toLowerCase().includes("mantem"),
            );
      if (isFilled && textVal) {
        const canonicalKey = normalizeKey(rawKey, true);
        canonicalRaw[canonicalKey] = {
          value: String(textVal).trim(),
          status: "filled",
        };
      }
    }

    const isCompleted = session?.status === "completed";

    const adaptive = getAdaptiveIndustrialCollectedData({
      subflow: session?.subflow || null,
      funnelStage: session?.funnelStage || null,
      targetFunnel: getCleanTargetFunnel(session?.targetFunnel) || null,
      collectedData: canonicalRaw,
      company:
        session?.company && session.company !== "Empresa não informada"
          ? session.company
          : session?.knownClient?.companyName || null,
      document: session?.knownClient?.document || null,
      isCompleted,
    });

    const result: Record<string, { value: string; status: "filled" | "pending" }> = {};
    for (const [k, entry] of Object.entries(adaptive)) {
      result[k] = {
        value: entry?.value || "Aguardando...",
        status: entry?.status === "filled" ? "filled" : "pending",
      };
    }
    return result;
  }

  const merged: Record<string, { value: string; status: "filled" | "pending" }> = {};
  for (const field of VALEM_SDR_FIELDS) {
    merged[field] = { value: "Aguardando...", status: "pending" };
  }

  for (const [rawKey, rawVal] of Object.entries(rawCollected)) {
    if (!rawVal) continue;
    let textVal = typeof rawVal === "string" ? rawVal : rawVal.value;
    const isFilled =
      typeof rawVal === "object" && rawVal.status === "filled"
        ? true
        : Boolean(
            textVal &&
              textVal.trim() !== "" &&
              textVal !== "Aguardando..." &&
              !textVal.toLowerCase().includes("mantem"),
          );

    if (isFilled && textVal) {
      const canonicalKey = normalizeKey(rawKey, false);

      if (canonicalKey === "TIPO DE QUALIFICAÇÃO") {
        const lower = textVal.toLowerCase();
        if (lower.includes("varejo") || lower.includes("baixo volume") || lower.includes("pequeno")) {
          textVal = "Varejo / Baixo Volume";
        } else if (lower.includes("fora") || lower.includes("portfólio") || lower.includes("vidro")) {
          textVal = "Fora de Portfólio";
        } else if (lower.includes("cotação") || lower.includes("comparação") || lower.includes("preço")) {
          textVal = "Cotação para Comparação";
        } else if (lower.includes("lançamento") || lower.includes("novo") || lower.includes("amostra")) {
          textVal = "Industrial – Lançamento";
        } else if (lower.includes("troca") || lower.includes("fornecedor") || lower.includes("concorrente")) {
          textVal = "Industrial – Troca de Fornecedor";
        } else {
          textVal = "Industrial – Recorrência";
        }
      }

      merged[canonicalKey] = {
        value: textVal.trim(),
        status: "filled",
      };
    }
  }

  return merged;
}

const StatusBadge = React.memo(function StatusBadge({ status }: { status: SdrSessionStatus }) {
  const styles: Record<SdrSessionStatus, string> = {
    active: "bg-primary-soft text-primary border-primary/25",
    awaiting_approval:
      "bg-amber-500/18 text-amber-700 dark:text-amber-300 border-amber-500/40",
    completed: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    abandoned: "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30",
    stopped: "bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/25",
    manual: "bg-sky-500/12 text-sky-600 dark:text-sky-400 border-sky-500/25",
  };
  const labels: Record<SdrSessionStatus, string> = {
    active: "Em Triagem",
    awaiting_approval: "Aguardando Aprovação",
    completed: "Transferido",
    abandoned: "Sem Resposta",
    stopped: "Interrompido",
    manual: "Manual",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-colors ${styles[status]}`}
    >
      {status === "active" && <Circle className="h-2 w-2 fill-primary text-primary animate-pulse" />}
      {status === "awaiting_approval" && (
        <Circle className="h-2 w-2 fill-amber-500 text-amber-500 animate-pulse" />
      )}
      {status === "completed" && <CheckCircle className="h-2.5 w-2.5" />}
      {status === "abandoned" && <Clock className="h-2.5 w-2.5" />}
      {status === "stopped" && <Square className="h-2.5 w-2.5" />}
      {status === "manual" && <UserCheck className="h-2.5 w-2.5" />}
      {labels[status]}
    </span>
  );
});

// ── Cache Stale-While-Revalidate em sessionStorage (isolado por tenant) ───────
const SDR_CACHE_TTL_MS = 10 * 60 * 1000;

interface SdrCachedSnapshot {
  savedAt: number;
  sdrEnabled?: boolean;
  monitoringSummary: AgentMonitoringSummary | null;
  sessions: SdrTriageSession[];
}

function getSdrCacheKey(tenantId: string): string {
  return `sdr_swr_cache_v1:${tenantId}`;
}

function readSdrCachedSnapshot(tenantId: string | null | undefined): SdrCachedSnapshot | null {
  if (!tenantId || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getSdrCacheKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SdrCachedSnapshot;
    if (!parsed || typeof parsed.savedAt !== "number" || !Array.isArray(parsed.sessions)) {
      return null;
    }
    if (Date.now() - parsed.savedAt > SDR_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSdrCachedSnapshot(
  tenantId: string | null | undefined,
  snapshot: SdrCachedSnapshot,
): void {
  if (!tenantId || typeof window === "undefined") return;
  try {
    // Salva snapshot enxuto (sem as 200 mensagens completas para caber em poucos KB no sessionStorage)
    const compactSessions = snapshot.sessions.slice(0, 100).map((s) => ({
      ...s,
      messagesLoaded: false,
      messages: [],
    }));
    window.sessionStorage.setItem(
      getSdrCacheKey(tenantId),
      JSON.stringify({
        savedAt: snapshot.savedAt,
        sdrEnabled: snapshot.sdrEnabled,
        monitoringSummary: snapshot.monitoringSummary,
        sessions: compactSessions,
      }),
    );
  } catch {
    // Ignora erros de quota/modo privado sem impactar a UI
  }
}

function getNetworkHints(): { effectiveType: string | null; saveData: boolean } {
  if (typeof navigator === "undefined") return { effectiveType: null, saveData: false };
  const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  if (!conn) return { effectiveType: null, saveData: false };
  return {
    effectiveType: typeof conn.effectiveType === "string" ? conn.effectiveType : null,
    saveData: Boolean(conn.saveData),
  };
}

interface SdrLiveSessionItemProps {
  session: SdrTriageSession;
  isSelected: boolean;
  isCompactViewport: boolean;
  isIndustrial: boolean;
  onSelect: (session: SdrTriageSession) => void;
}

const SdrLiveSessionItem = React.memo(function SdrLiveSessionItem({
  session,
  isSelected,
  isCompactViewport,
  isIndustrial,
  onSelect,
}: SdrLiveSessionItemProps) {
  let completedCount: number;
  let totalCount: number;
  let progressPct: number;

  if (session.triageProgress) {
    completedCount = session.triageProgress.filledCount;
    totalCount = session.triageProgress.totalCount;
    progressPct = Math.round(session.triageProgress.percentage);
  } else {
    const mergedData = getMergedCollectedData(session.collectedData, isIndustrial, session);
    completedCount = Object.values(mergedData).filter((d) => d.status === "filled").length;
    totalCount = Object.keys(mergedData).length;
    progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  }

  const hasPreviousCycles =
    (session.previousTriages?.length || 0) > 0 || Boolean(session.knownClient?.companyName);

  return (
    <button
      type="button"
      onClick={() => onSelect(session)}
      className={`w-full text-left px-4 py-3 border-b border-line transition-[background-color,border-color,transform] duration-200 ease-out active:scale-[0.995] cursor-pointer [contain:layout_style] ${
        isSelected && !isCompactViewport
          ? "bg-primary-soft border-l-2 border-l-primary"
          : session.status === "awaiting_approval"
            ? "bg-amber-500/[0.06] border-l-2 border-l-amber-500 hover:bg-amber-500/10"
            : "hover:bg-muted/50"
      }`}
    >
      <div className="flex items-center justify-between mb-1 gap-1.5">
        <span className="text-xs font-bold text-foreground truncate">{session.contactName}</span>
        <div className="flex items-center gap-1 shrink-0">
          {hasPreviousCycles && (
            <span className="px-1.5 py-0.5 rounded-md bg-muted border border-border text-[9px] font-bold text-muted-foreground">
              Recorrente
            </span>
          )}
          <StatusBadge status={session.status} />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground truncate">
        {session.company} {session.phone ? `· ${session.phone}` : ""}
      </p>
      <div className="mt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground">
            Campos {completedCount}/{totalCount}
          </span>
          <span className="text-[10px] font-semibold text-primary tabular-nums">
            {progressPct}%
          </span>
        </div>
        <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width,background-color] duration-500 ease-out ${
              progressPct >= 100 ? "bg-emerald-500" : "bg-primary"
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </button>
  );
});

interface SdrTimelineRowProps {
  item: SdrTimelineItem;
  tenant: string | null | undefined;
  personaName: string;
  personaGender: "female" | "male";
  personaCompany: string;
  personaAvatarUrl: string;
  personaAvatarLightUrl?: string;
  personaAvatarDarkUrl?: string;
  contactName: string;
  contactAvatar?: string | null;
  agentName: string | null;
  agentAvatar: string | null;
  onPreviewMedia: (media: { url: string; title: string }) => void;
}

const SdrTimelineRow = React.memo(function SdrTimelineRow({
  item,
  tenant,
  personaName,
  personaGender,
  personaCompany,
  personaAvatarUrl,
  personaAvatarLightUrl,
  personaAvatarDarkUrl,
  contactName,
  contactAvatar,
  agentName,
  agentAvatar,
  onPreviewMedia,
}: SdrTimelineRowProps) {
  if (item.type === "date-divider") {
    return (
      <div className="flex items-center gap-3 my-3 select-none">
        <div className="h-px flex-1 bg-border/70" />
        <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-muted/80 border border-border text-[10px] font-bold text-muted-foreground tracking-wide shadow-2xs">
          <Calendar className="h-2.5 w-2.5 text-primary/80" />
          {item.label}
        </span>
        <div className="h-px flex-1 bg-border/70" />
      </div>
    );
  }

  if (item.type === "system-event") {
    return (
      <div className="flex justify-center my-2 select-none">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/60 border border-border/80 text-[10px] font-semibold text-muted-foreground max-w-[85%] text-center">
          <Info className="h-3 w-3 text-muted-foreground/80 shrink-0" />
          <span className="break-words">{item.text}</span>
          <span className="text-[9px] opacity-70 shrink-0 font-mono">{item.time}</span>
        </span>
      </div>
    );
  }

  if (item.type === "cycle-divider") {
    const isPrev = item.variant === "previous-triage";
    const isHandoff = item.variant === "operator-handoff";

    return (
      <div className="flex items-center gap-3 my-3.5 select-none">
        <div className="h-px flex-1 bg-border" />
        <div
          className={`flex flex-col items-center text-center px-3.5 py-1.5 rounded-xl border shadow-2xs ${
            isPrev
              ? "bg-muted/70 border-border text-muted-foreground"
              : isHandoff
                ? "bg-primary-soft/60 border-primary/25 text-foreground"
                : "bg-primary-soft border-primary/30 text-primary"
          }`}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wide">
            {isPrev && <Clock className="h-3 w-3 text-muted-foreground shrink-0" />}
            {isHandoff && <UserCheck className="h-3 w-3 text-primary shrink-0" />}
            {!isPrev && !isHandoff && <Bot className="h-3 w-3 text-primary shrink-0" />}
            <span>{item.title}</span>
          </div>
          {item.subtitle && (
            <span className="text-[9px] text-muted-foreground font-medium mt-0.5">
              {item.subtitle}
            </span>
          )}
        </div>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  const { msg } = item;
  const isOutbound = msg.sender === "bot" || msg.sender === "agent";
  const isAgent = msg.sender === "agent";
  const isBot = msg.sender === "bot";

  const text = msg.text || "";
  let mediaUrl = msg.mediaUrl || null;
  let mediaType = msg.mediaType || null;
  let fileName = msg.fileName || null;

  const lines = text.split(/\r?\n/);
  const mediaTag = lines[0].trim();
  const hasMediaTag = mediaTag.startsWith("[MEDIA:");
  const captionText = hasMediaTag ? lines.slice(1).join("\n").trim() : "";

  if (hasMediaTag) {
    const match = mediaTag.match(/^\[MEDIA:([a-zA-Z0-9]+)\]([^:]+)(?::(.+))?$/i);
    if (match) {
      const type = match[1].toLowerCase();
      const mediaId = match[2].trim();
      const fn = match[3] ? match[3].trim() : null;

      mediaType = type === "sticker" ? "image" : type;
      mediaUrl = `/api/baileys/media?messageId=${mediaId}`;
      if (fn && !fileName) fileName = fn;
    }
  }

  if (mediaUrl && mediaUrl.includes("/api/media/")) {
    const mediaId = mediaUrl.split("/api/media/")[1]?.trim();
    if (mediaId) {
      mediaUrl = `/api/baileys/media?messageId=${mediaId}`;
    }
  }

  const isImage =
    mediaType === "image" || (mediaUrl && /\.(jpeg|jpg|gif|png|webp)/i.test(mediaUrl));
  const isVideo =
    mediaType === "video" || (mediaUrl && /\.(mp4|webm|mov|avi|mkv)/i.test(mediaUrl));
  const isAudio =
    mediaType === "audio" || (mediaUrl && /\.(ogg|mp3|wav|m4a|opus)/i.test(mediaUrl));
  const isDoc =
    mediaType === "document" ||
    (mediaUrl && /\.(pdf|doc|docx|xls|xlsx|json|rar|zip)/i.test(mediaUrl)) ||
    /\.(pdf|doc|docx|xls|xlsx|json|rar|zip)/i.test(text);

  return (
    <div className={`flex [contain:layout_style] ${isOutbound ? "justify-end" : "justify-start"}`}>
      {msg.sender === "client" &&
        (contactAvatar ? (
          <SystemTooltip content="Ver foto do cliente em tela cheia">
            <button
              type="button"
              onClick={() =>
                onPreviewMedia({
                  url: contactAvatar,
                  title: contactName,
                })
              }
              className="shrink-0 mr-2 self-end group cursor-pointer focus:outline-none"
            >
              <img
                src={contactAvatar}
                alt={contactName}
                loading="lazy"
                decoding="async"
                className="h-7 w-7 rounded-full object-cover border-2 border-primary/20 shadow-soft group-hover:scale-110 group-hover:border-primary transition duration-200"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            </button>
          </SystemTooltip>
        ) : (
          <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary shrink-0 mr-2 self-end font-bold text-[10px] shadow-soft border border-primary/20">
            {contactName[0]?.toUpperCase() || "C"}
          </div>
        ))}

      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed shadow-soft transition-colors ${
          isBot
            ? "bg-primary text-primary-foreground rounded-br-[5px]"
            : isAgent
              ? "bg-primary-soft/75 border border-primary/25 text-foreground rounded-br-[5px]"
              : "bg-muted border border-border text-foreground rounded-bl-[5px]"
        }`}
      >
        {isAgent && agentName && (
          <div className="flex items-center justify-between gap-2 mb-1 pb-1 border-b border-primary/15">
            <span className="text-[10px] font-extrabold text-primary truncate">
              {agentName}
            </span>
            {msg.isInternalNote && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-primary/15 text-primary shrink-0">
                Nota Interna
              </span>
            )}
          </div>
        )}

        {isBot && (
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-[9px] font-extrabold text-primary-foreground/85 tracking-wide">
              {personaName} · IA
            </span>
          </div>
        )}

        {isImage && mediaUrl ? (
          <div className="space-y-1 my-1">
            <button
              type="button"
              onClick={() =>
                onPreviewMedia({
                  url: mediaUrl!,
                  title: "Imagem enviada no WhatsApp",
                })
              }
              className="overflow-hidden rounded-2xl border border-white/20 cursor-pointer block max-w-xs hover:opacity-95 transition shadow-soft group"
            >
              <img
                src={mediaUrl}
                alt="Imagem enviada"
                loading="lazy"
                decoding="async"
                className="w-full max-h-56 object-cover rounded-2xl group-hover:scale-[1.02] transition duration-300"
              />
            </button>
            {captionText && (
              <p className="text-[11px] whitespace-pre-wrap font-medium">{captionText}</p>
            )}
            {!captionText && text && !text.startsWith("[MEDIA:") && (
              <p className="text-[11px] whitespace-pre-wrap">{text}</p>
            )}
          </div>
        ) : isVideo && mediaUrl ? (
          <div className="space-y-1 my-1">
            <div
              className="relative group max-w-xs rounded-2xl overflow-hidden border border-white/20 bg-black/10 cursor-pointer flex items-center justify-center shadow-soft"
              onClick={() =>
                onPreviewMedia({
                  url: mediaUrl!,
                  title: "Vídeo enviado no WhatsApp",
                })
              }
            >
              <video
                src={mediaUrl}
                preload="metadata"
                className="max-h-56 w-full object-contain rounded-2xl pointer-events-none"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/35 transition rounded-2xl">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-md backdrop-blur-xs transition group-hover:scale-110">
                  <Play className="h-5 w-5 fill-slate-800 ml-0.5" />
                </div>
              </div>
            </div>
            {captionText && (
              <p className="text-[11px] whitespace-pre-wrap font-medium">{captionText}</p>
            )}
            {!captionText && text && !text.startsWith("[MEDIA:") && (
              <p className="text-[11px] whitespace-pre-wrap">{text}</p>
            )}
          </div>
        ) : isAudio && mediaUrl ? (
          <div className="space-y-1 py-0.5">
            <AudioPlayerBubble src={mediaUrl} isBot={isBot} />
            {captionText && (
              <p className="text-[11px] whitespace-pre-wrap font-medium">{captionText}</p>
            )}
            {!captionText && text && !text.startsWith("[MEDIA:") && (
              <p className="text-[11px] whitespace-pre-wrap">{text}</p>
            )}
          </div>
        ) : isDoc && mediaUrl ? (
          <div className="space-y-1 my-1">
            <a
              href={mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-3 p-2.5 rounded-2xl border transition decoration-none text-current ${
                isBot
                  ? "bg-white/10 border-white/20 hover:bg-white/20"
                  : "bg-black/5 border-black/10 hover:bg-black/10"
              }`}
            >
              <div
                className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${
                  isBot ? "bg-white/20 text-white" : "bg-primary/20 text-primary"
                }`}
              >
                <FileText className="h-5 w-5" />
              </div>
              <div className="truncate flex-1">
                <p className="font-bold text-[11px] truncate">{fileName || "Documento.pdf"}</p>
                <p className="text-[9px] opacity-80 flex items-center gap-1 mt-0.5">
                  <Download className="h-3 w-3 inline" /> Clique para abrir / baixar
                </p>
              </div>
            </a>
            {captionText && (
              <p className="text-[11px] whitespace-pre-wrap font-medium">{captionText}</p>
            )}
            {!captionText && text && !text.startsWith("[MEDIA:") && (
              <p className="text-[11px] whitespace-pre-wrap">{text}</p>
            )}
          </div>
        ) : (
          <span className="whitespace-pre-wrap break-words">
            {hasMediaTag ? captionText || text : text}
          </span>
        )}

        <span
          className={`block mt-1 text-[9px] ${
            isBot ? "text-white/60" : "text-muted-foreground"
          }`}
        >
          {msg.time}
        </span>
      </div>

      {isBot && (
        <SystemTooltip
          content={`Ver foto ${personaGender === "female" ? "da" : "do"} ${personaName} em tela cheia`}
        >
          <button
            type="button"
            onClick={() =>
              onPreviewMedia({
                url:
                  (document.documentElement.classList.contains("dark")
                    ? personaAvatarDarkUrl
                    : personaAvatarLightUrl) || personaAvatarUrl,
                title: `${personaName} IA — ${personaCompany}`,
              })
            }
            className="shrink-0 ml-2 self-end group cursor-pointer focus:outline-none"
          >
            <AiAvatar
              tenantId={tenant}
              className="h-7 w-7 rounded-full border-2 border-primary/30 shadow-soft group-hover:scale-110 group-hover:border-primary transition duration-200"
            />
          </button>
        </SystemTooltip>
      )}

      {isAgent && agentName && (
        <SystemTooltip content={agentName}>
          {agentAvatar ? (
            <button
              type="button"
              onClick={() =>
                onPreviewMedia({
                  url: agentAvatar,
                  title: agentName,
                })
              }
              className="shrink-0 ml-2 self-end group cursor-pointer focus:outline-none"
            >
              <img
                src={agentAvatar}
                alt={agentName}
                loading="lazy"
                decoding="async"
                className="h-7 w-7 rounded-full object-cover border-2 border-primary/40 shadow-soft group-hover:scale-110 group-hover:border-primary transition duration-200"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = "none";
                  const fallback = target.nextElementSibling as HTMLElement | null;
                  if (fallback) fallback.style.display = "grid";
                }}
              />
              <div
                style={{ display: "none" }}
                className="h-7 w-7 place-items-center rounded-full bg-primary-soft text-primary border-2 border-primary/30 font-extrabold text-[10px] shadow-soft"
              >
                {getOperatorInitials(agentName)}
              </div>
            </button>
          ) : (
            <div className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft text-primary shrink-0 ml-2 self-end font-extrabold text-[10px] shadow-soft border-2 border-primary/30 select-none">
              {getOperatorInitials(agentName)}
            </div>
          )}
        </SystemTooltip>
      )}
    </div>
  );
});

export interface SdrTabProps {
  sdrEnabled?: boolean;
  onSdrConfigChange?: (enabled: boolean) => void;
  filterState?: SdrFilterState;
  onFilterChange?: React.Dispatch<React.SetStateAction<SdrFilterState>>;
  viewMode?: SdrViewMode;
  onViewModeChange?: (mode: SdrViewMode) => void;
  refreshKey?: number;
  onLoadingChange?: (loading: boolean) => void;
  onSelectedConversationChange?: (
    conversationId: string | undefined,
    contactName?: string,
  ) => void;
  targetConversation?: {
    conversationId: string;
    dealId?: string;
    phone?: string;
    leadName?: string;
    ts: number;
  } | null;
  onTargetConversationHandled?: () => void;
}

export function SdrTab({
  sdrEnabled = false,
  onSdrConfigChange,
  filterState,
  onFilterChange,
  viewMode = "live",
  onViewModeChange,
  refreshKey,
  onLoadingChange,
  onSelectedConversationChange,
  targetConversation,
  onTargetConversationHandled,
}: SdrTabProps = {}) {
  const { tenant, setActiveView, setSelectedChatId, operators } = useChat();
  const navigate = useNavigate();
  const persona = getAiPersona(tenant || "");
  const isIndustrial = persona.triagePolicy === "industrial";

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  // Viewport compacto (< 1024px): alterna entre Lista -> Detalhe (Aprovar & Dados | Conversa)
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < 1024 : false,
  );
  const [mobileStage, setMobileStage] = useState<"list" | "detail">("list");
  const [mobileDetailTab, setMobileDetailTab] = useState<"approval" | "chat">("approval");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsCompactViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Painel direito aberto por padrão em desktop (minimizável)
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );

  // Mini pop-up personalizado do botão "Abrir"
  const [isOpenActionPopupOpen, setIsOpenActionPopupOpen] = useState(false);
  const openActionPopupRef = useRef<HTMLDivElement | null>(null);
  const [isStoppingBot, setIsStoppingBot] = useState(false);
  const [isResumingBot, setIsResumingBot] = useState(false);

  // Modal de visualização em tela cheia de mídia/foto
  const [previewModalImage, setPreviewModalImage] = useState<{ url: string; title: string } | null>(
    null,
  );

  // SESSÕES DE TRIAGEM (100% reais do banco + hidratação imediata SWR por tenant)
  const [sessions, setSessions] = useState<SdrTriageSession[]>(() => {
    const cached = readSdrCachedSnapshot(tenant);
    return cached?.sessions || [];
  });
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(() => {
    const cached = readSdrCachedSnapshot(tenant);
    return Boolean(cached && cached.sessions.length > 0);
  });
  const sessionsCountRef = useRef<number>(sessions.length);
  sessionsCountRef.current = sessions.length;

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => {
    const cached = readSdrCachedSnapshot(tenant);
    return cached?.sessions?.[0]?.id || null;
  });
  const selectedConversationIdRef = useRef<string | null>(null);
  const viewModeRef = useRef<SdrViewMode>(viewMode);
  viewModeRef.current = viewMode;
  const messagesCacheRef = useRef<Map<string, SdrTriageMessage[]>>(new Map());
  const sdrEtagRef = useRef<{ queryKey: string; etag: string } | null>(null);
  const msgEtagMapRef = useRef<Map<string, string>>(new Map());
  const lastRttMsRef = useRef<number>(0);
  const errorStreakRef = useRef<number>(0);
  const [monitoringSummary, setMonitoringSummary] = useState<AgentMonitoringSummary | null>(() => {
    const cached = readSdrCachedSnapshot(tenant);
    return cached?.monitoringSummary || null;
  });
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  const monitorFetchRef = useRef<AbortController | null>(null);
  const msgFetchRef = useRef<AbortController | null>(null);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  useEffect(() => {
    const cached = readSdrCachedSnapshot(tenant);
    setSessions(cached?.sessions || []);
    setHasLoadedOnce(Boolean(cached && cached.sessions.length > 0));
    setSelectedSessionId(cached?.sessions?.[0]?.id || null);
    selectedConversationIdRef.current = cached?.sessions?.[0]?.conversationId || null;
    messagesCacheRef.current.clear();
    sdrEtagRef.current = null;
    msgEtagMapRef.current.clear();
    lastRttMsRef.current = 0;
    errorStreakRef.current = 0;
    setMonitoringSummary(cached?.monitoringSummary || null);
    setMonitoringError(null);
    if (cached && typeof cached.sdrEnabled === "boolean") {
      onSdrConfigChange?.(cached.sdrEnabled);
    }
    return () => {
      monitorFetchRef.current?.abort();
      monitorFetchRef.current = null;
      msgFetchRef.current?.abort();
      msgFetchRef.current = null;
    };
  }, [tenant, onSdrConfigChange]);

  const effectiveFilterState = filterState || DEFAULT_SDR_FILTER_STATE;
  const deferredFilterState = useDeferredValue(effectiveFilterState);
  const filteredSessions = useMemo(
    () => filterSdrSessions(sessions, deferredFilterState),
    [sessions, deferredFilterState],
  );

  const selectedSession = useMemo(
    () =>
      sessions.find((s) => s.id === selectedSessionId || s.conversationId === selectedSessionId) ||
      filteredSessions[0] ||
      sessions[0] ||
      null,
    [sessions, selectedSessionId, filteredSessions],
  );

  useEffect(() => {
    selectedConversationIdRef.current = selectedSession?.conversationId || null;
    onSelectedConversationChange?.(selectedSession?.conversationId, selectedSession?.contactName);
  }, [selectedSession?.conversationId, selectedSession?.contactName, onSelectedConversationChange]);

  // Carregamento sob demanda de mensagens ao trocar de conversa (com ETag + timeout seguro)
  const loadSessionMessages = useCallback(
    async (conversationId: string, options?: { silent?: boolean }) => {
      if (!tenant || !conversationId) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      msgFetchRef.current?.abort();
      const controller = new AbortController();
      msgFetchRef.current = controller;
      const net = getNetworkHints();
      const timeoutMs =
        net.saveData || net.effectiveType === "slow-2g" || net.effectiveType === "2g"
          ? 22_000
          : 15_000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      if (!options?.silent) {
        setIsLoadingMessages(true);
      }
      try {
        const headers: Record<string, string> = {};
        const prevEtag = msgEtagMapRef.current.get(conversationId);
        if (prevEtag && messagesCacheRef.current.has(conversationId)) {
          headers["If-None-Match"] = prevEtag;
        }
        const res = await fetch(
          `${BACKEND_URL}/api/valentina/sdr?conversationId=${encodeURIComponent(conversationId)}`,
          { signal: controller.signal, headers },
        );
        if (controller.signal.aborted) return;
        if (res.status === 304) {
          const cachedMsgs = messagesCacheRef.current.get(conversationId);
          if (cachedMsgs) {
            setSessions((prev) =>
              prev.map((s) =>
                s.conversationId === conversationId && !s.messagesLoaded
                  ? { ...s, messages: cachedMsgs, messagesLoaded: true }
                  : s,
              ),
            );
          }
          return;
        }
        if (!res.ok) return;
        const nextEtag = res.headers.get("etag");
        if (nextEtag) {
          msgEtagMapRef.current.set(conversationId, nextEtag);
        }
        const payload = await res.json();
        if (controller.signal.aborted || !Array.isArray(payload.messages)) return;
        messagesCacheRef.current.set(conversationId, payload.messages);
        setSessions((prev) =>
          prev.map((s) =>
            s.conversationId === conversationId
              ? { ...s, messages: payload.messages, messagesLoaded: true }
              : s,
          ),
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          console.warn("[SdrTab] Erro ao carregar mensagens sob demanda:", err);
        }
      } finally {
        clearTimeout(timeoutId);
        if (msgFetchRef.current === controller) {
          msgFetchRef.current = null;
          setIsLoadingMessages(false);
        }
      }
    },
    [tenant, BACKEND_URL],
  );

  useEffect(() => {
    if (
      viewMode === "live" &&
      selectedSession &&
      !selectedSession.messagesLoaded
    ) {
      void loadSessionMessages(selectedSession.conversationId);
    }
  }, [viewMode, selectedSession?.conversationId, selectedSession?.messagesLoaded, loadSessionMessages]);

  // Ref para rolagem automática do chat para o final
  const chatMessagesContainerRef = useRef<HTMLDivElement | null>(null);
  const chatOpenedAtRef = useRef<number>(0);
  const shouldStickChatToBottomRef = useRef<boolean>(true);

  const scrollChatToBottom = useCallback(() => {
    const el = chatMessagesContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const handleChatContainerScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickChatToBottomRef.current = distanceFromBottom <= 160;
  }, []);

  const handleChatMediaLoad = useCallback(
    (e: React.SyntheticEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (!target || (target.tagName !== "IMG" && target.tagName !== "VIDEO")) return;
      if (Date.now() - chatOpenedAtRef.current < 3000 || shouldStickChatToBottomRef.current) {
        scrollChatToBottom();
        requestAnimationFrame(() => scrollChatToBottom());
      }
    },
    [scrollChatToBottom],
  );

  useEffect(() => {
    setIsOpenActionPopupOpen(false);
    if (!selectedSession?.id || viewMode !== "live") return;
    if (isCompactViewport && (mobileStage !== "detail" || mobileDetailTab !== "chat")) return;
    chatOpenedAtRef.current = Date.now();
    shouldStickChatToBottomRef.current = true;
    scrollChatToBottom();
    const rafId = requestAnimationFrame(() => scrollChatToBottom());
    const t1 = setTimeout(() => scrollChatToBottom(), 80);
    const t2 = setTimeout(() => scrollChatToBottom(), 220);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [
    selectedSession?.id,
    selectedSession?.conversationId,
    viewMode,
    isCompactViewport,
    mobileStage,
    mobileDetailTab,
    scrollChatToBottom,
  ]);

  useEffect(() => {
    if (!selectedSession?.messages?.length || !shouldStickChatToBottomRef.current) return;
    const rafId = requestAnimationFrame(() => scrollChatToBottom());
    return () => cancelAnimationFrame(rafId);
  }, [selectedSession?.messages?.length, scrollChatToBottom]);

  // Fechar mini pop-up do botão "Abrir" ao clicar fora ou ESC
  useEffect(() => {
    if (!isOpenActionPopupOpen) return;
    const handlePointerDownOutside = (ev: MouseEvent) => {
      if (openActionPopupRef.current && !openActionPopupRef.current.contains(ev.target as Node)) {
        setIsOpenActionPopupOpen(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setIsOpenActionPopupOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDownOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDownOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpenActionPopupOpen]);

  // Índice O(1) de operadores por nome em minúsculas para evitar `.find()` a cada mensagem
  const operatorsByLowerName = useMemo(() => {
    const map = new Map<string, { name: string; avatar?: string | null }>();
    if (Array.isArray(operators)) {
      for (const op of operators) {
        if (op?.name) {
          map.set(op.name.trim().toLowerCase(), op);
        }
      }
    }
    return map;
  }, [operators]);

  // Resolve nome e foto real do operador (NUNCA atribui ao usuário logado que só observa)
  const resolveAgentSenderInfo = useCallback(
    (msg: SdrTriageMessage, session: SdrTriageSession) => {
      const rawMsgName =
        msg.senderName && msg.senderName.trim().toLowerCase() !== "operador"
          ? msg.senderName.trim()
          : null;

      const rawSessionResp =
        session.responsibleName &&
        !session.responsibleName.includes("IA (") &&
        !session.responsibleName.includes("Vendedor Alocado") &&
        !session.responsibleName.includes("Interrompido") &&
        !session.responsibleName.includes("Sem resposta") &&
        !session.responsibleName.includes("Atendimento humano")
          ? session.responsibleName.trim()
          : null;

      const candidateName = rawMsgName || rawSessionResp;

      if (candidateName && operatorsByLowerName.size > 0) {
        const matchedOp = operatorsByLowerName.get(candidateName.toLowerCase());
        if (matchedOp) {
          return {
            name: matchedOp.name,
            avatar: msg.senderAvatar || matchedOp.avatar || null,
          };
        }
      }

      if (candidateName) {
        return {
          name: candidateName,
          avatar: msg.senderAvatar || null,
        };
      }

      return {
        name: "Operador",
        avatar: msg.senderAvatar || null,
      };
    },
    [operatorsByLowerName],
  );

  const handleOpenChatFromPopup = useCallback(
    (session: SdrTriageSession) => {
      setIsOpenActionPopupOpen(false);
      setSelectedChatId(session.conversationId);
      setActiveView("chat");
      toast.info("Abrindo conversa no chat...");
    },
    [setSelectedChatId, setActiveView],
  );

  const handleOpenLinkedCardFromPopup = useCallback(
    (session: SdrTriageSession) => {
      if (!session.linkedDeal?.dealId) return;
      setIsOpenActionPopupOpen(false);
      toast.info(`Abrindo card vinculado: ${session.linkedDeal.dealTitle}`);
      navigate({
        to: "/crm/deals/$dealId",
        params: { dealId: session.linkedDeal.dealId },
        search: { from: "valentina" },
      });
    },
    [navigate],
  );

  const handleSelectSessionFromKanban = useCallback(
    (session: SdrTriageSession) => {
      setSelectedSessionId(session.id);
      setSelectedChatId(session.conversationId);
      setMobileStage("detail");
      setMobileDetailTab(session.status === "awaiting_approval" ? "approval" : "chat");
      onViewModeChange?.("live");
    },
    [setSelectedChatId, onViewModeChange],
  );

  const handleSelectLiveSession = useCallback(
    (session: SdrTriageSession) => {
      setSelectedSessionId(session.id);
      if (isCompactViewport) {
        setMobileStage("detail");
        setMobileDetailTab(session.status === "awaiting_approval" ? "approval" : "chat");
      }
    },
    [isCompactViewport],
  );

  // Carregar dados reais do SDR via API (Batch Zero N+1 + ETag 304 + Gzip + Timeout + includeMessages=0 no Kanban)
  const fetchSdrData = useCallback(
    async (options?: { force?: boolean }) => {
      if (!tenant) return;
      if (typeof document !== "undefined" && document.hidden && !options?.force) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setMonitoringError(
          "Sem conexão com a internet. Exibindo últimos dados carregados.",
        );
        return;
      }

      if (monitorFetchRef.current) {
        if (options?.force) {
          monitorFetchRef.current.abort();
          monitorFetchRef.current = null;
        } else {
          return;
        }
      }

      const controller = new AbortController();
      monitorFetchRef.current = controller;
      const showSpinner = Boolean(options?.force) || sessionsCountRef.current === 0;
      if (showSpinner) {
        setIsLoading(true);
      }

      const net = getNetworkHints();
      const timeoutMs =
        net.saveData || net.effectiveType === "slow-2g" || net.effectiveType === "2g"
          ? 22_000
          : 15_000;
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      const startedMs = performance.now();

      try {
        const isKanbanMode = viewModeRef.current === "kanban";
        const selConv = isKanbanMode ? null : selectedConversationIdRef.current;
        const params = new URLSearchParams();
        if (isKanbanMode) {
          params.set("includeMessages", "0");
        } else if (selConv) {
          params.set("selectedConversationId", selConv);
        }
        const queryString = params.toString();
        const queryKey = `${tenant}:${queryString}`;

        const headers: Record<string, string> = {};
        if (
          !options?.force &&
          sdrEtagRef.current &&
          sdrEtagRef.current.queryKey === queryKey &&
          sessionsCountRef.current > 0
        ) {
          headers["If-None-Match"] = sdrEtagRef.current.etag;
        }

        const res = await fetch(
          `${BACKEND_URL}/api/valentina/sdr${queryString ? `?${queryString}` : ""}`,
          {
            signal: controller.signal,
            headers,
          },
        );

        lastRttMsRef.current = Math.round(performance.now() - startedMs);

        if (controller.signal.aborted) return;

        if (res.status === 304) {
          errorStreakRef.current = 0;
          setMonitoringError((prev) => (prev ? null : prev));
          return;
        }

        if (res.ok) {
          const nextEtag = res.headers.get("etag");
          if (nextEtag) {
            sdrEtagRef.current = { queryKey, etag: nextEtag };
          }
          const data = await res.json();
          if (controller.signal.aborted) return;

          errorStreakRef.current = 0;

          const nextSummary =
            data.monitoringSummary?.available === true ? data.monitoringSummary : null;
          setMonitoringSummary(nextSummary);
          setMonitoringError(
            nextSummary ? null : "Métricas temporariamente indisponíveis.",
          );
          if (data.config) {
            onSdrConfigChange?.(Boolean(data.config.enabled));
          }
          if (Array.isArray(data.sessions)) {
            const formattedLiveSessions: SdrTriageSession[] = data.sessions
              .map((s: any) => {
                const incomingLoaded = Boolean(s.messagesLoaded && Array.isArray(s.messages));
                if (incomingLoaded) {
                  messagesCacheRef.current.set(s.conversationId, s.messages);
                }
                const cachedMsgs = messagesCacheRef.current.get(s.conversationId);
                const messagesLoaded = incomingLoaded || Boolean(cachedMsgs);
                return {
                  id: s.id,
                  conversationId: s.conversationId,
                  contactName: s.contactName || "Cliente WhatsApp",
                  contactAvatar: s.contactAvatar || null,
                  company: s.company || "Empresa não informada",
                  phone: s.phone || "",
                  currentStep: s.currentStep || "Qualificação",
                  collectedData: s.collectedData || {},
                  startedAt: s.startedAt,
                  completedAt: s.completedAt || null,
                  lastClientMessageAt: s.lastClientMessageAt || null,
                  lastMessageAt: s.lastMessageAt || null,
                  lastMessagePreview: s.lastMessagePreview || undefined,
                  status: s.status as SdrSessionStatus,
                  outcome: s.outcome,
                  responsibleName: s.responsibleName,
                  unreadCount: s.unreadCount || 0,
                  channel: s.channel === "livechat" || s.channel === "site" ? "site" : "whatsapp",
                  monitoring: s.monitoring,
                  ...(s.pendingApproval ? { pendingApproval: s.pendingApproval } : {}),
                  previousTriages: Array.isArray(s.previousTriages) ? s.previousTriages : [],
                  messagesLoaded,
                  messages: incomingLoaded ? s.messages : cachedMsgs || [],
                  ...(s.subflow ? { subflow: s.subflow } : {}),
                  ...(s.funnelStage ? { funnelStage: s.funnelStage } : {}),
                  ...(getCleanTargetFunnel(s.targetFunnel)
                    ? { targetFunnel: getCleanTargetFunnel(s.targetFunnel) }
                    : {}),
                  ...(s.triageProgress ? { triageProgress: s.triageProgress } : {}),
                  ...(s.knownClient ? { knownClient: s.knownClient } : {}),
                  ...(s.linkedDeal ? { linkedDeal: s.linkedDeal } : {}),
                };
              })
              .sort(
                (a: SdrTriageSession, b: SdrTriageSession) =>
                  getSessionActivityTimestamp(b) - getSessionActivityTimestamp(a),
              );

            setSessions((prev) => mergeSessionsPreservingRefs(prev, formattedLiveSessions));
            setSelectedSessionId((prev) => {
              if (!prev) return formattedLiveSessions[0]?.id || null;
              const match = formattedLiveSessions.find(
                (s) => s.id === prev || s.conversationId === prev,
              );
              return match ? match.id : formattedLiveSessions[0]?.id || null;
            });

            writeSdrCachedSnapshot(tenant, {
              savedAt: Date.now(),
              sdrEnabled: data.config ? Boolean(data.config.enabled) : undefined,
              monitoringSummary: nextSummary,
              sessions: formattedLiveSessions,
            });
          }
        } else {
          errorStreakRef.current = Math.min(errorStreakRef.current + 1, 6);
          setMonitoringError(
            "Não foi possível atualizar o monitor. Os atendimentos exibidos podem estar desatualizados.",
          );
        }
      } catch (e) {
        if (controller.signal.aborted && !timedOut) return;
        errorStreakRef.current = Math.min(errorStreakRef.current + 1, 6);
        lastRttMsRef.current = timedOut ? timeoutMs : Math.max(lastRttMsRef.current, 2500);
        setMonitoringError(
          timedOut
            ? "Conexão lenta detectada. Tentando sincronizar novamente em segundo plano..."
            : "Sem conexão com o monitor. Os atendimentos exibidos podem estar desatualizados.",
        );
        console.warn("[SdrTab] Erro ao carregar dados reais do SDR:", e);
      } finally {
        clearTimeout(timeoutId);
        if (monitorFetchRef.current === controller) {
          monitorFetchRef.current = null;
          setIsLoading(false);
          setHasLoadedOnce(true);
        }
      }
    },
    [tenant, BACKEND_URL, onSdrConfigChange],
  );

  // Atualização forçada vinda do botão Atualizar do header
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      void fetchSdrData({ force: true });
    }
  }, [refreshKey, fetchSdrData]);

  // Polling adaptativo (setTimeout recursivo com backoff + ETag 304) + atualização imediata via SSE
  useEffect(() => {
    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let sseDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextPoll = () => {
      if (disposed) return;
      if (pollTimer) clearTimeout(pollTimer);
      const net = getNetworkHints();
      const delayMs = computeAdaptiveSdrPollDelayMs({
        viewMode: viewModeRef.current,
        effectiveType: net.effectiveType,
        saveData: net.saveData,
        lastRttMs: lastRttMsRef.current,
        errorStreak: errorStreakRef.current,
      });
      pollTimer = setTimeout(async () => {
        if (disposed) return;
        if (
          typeof document === "undefined" ||
          (!document.hidden && (typeof navigator === "undefined" || navigator.onLine !== false))
        ) {
          await fetchSdrData();
        }
        scheduleNextPoll();
      }, delayMs);
    };

    void fetchSdrData().finally(() => {
      scheduleNextPoll();
    });

    const triggerDebouncedSseRefresh = (delayMs = 450) => {
      if (disposed) return;
      if (sseDebounceTimer) clearTimeout(sseDebounceTimer);
      sseDebounceTimer = setTimeout(() => {
        sseDebounceTimer = null;
        if (!disposed) {
          void fetchSdrData().finally(() => scheduleNextPoll());
        }
      }, delayMs);
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        errorStreakRef.current = 0;
        void fetchSdrData().finally(() => scheduleNextPoll());
      }
    };
    const handleOnline = () => {
      errorStreakRef.current = 0;
      setMonitoringError(null);
      void fetchSdrData().finally(() => scheduleNextPoll());
    };
    const handleOffline = () => {
      setMonitoringError("Sem conexão com a internet. Exibindo últimos dados carregados.");
    };
    const handleApprovalPending = () => {
      triggerDebouncedSseRefresh(250);
    };
    const handleLiveActivity = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      triggerDebouncedSseRefresh(450);
      if (
        viewModeRef.current === "live" &&
        detail?.conversationId &&
        detail.conversationId === selectedConversationIdRef.current
      ) {
        void loadSessionMessages(String(detail.conversationId), { silent: true });
      }
    };
    const handleApprovalOpen = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      void fetchSdrData({ force: true }).finally(() => scheduleNextPoll());
      if (detail?.conversationId) {
        onFilterChange?.(DEFAULT_SDR_FILTER_STATE);
        setSelectedSessionId(String(detail.conversationId));
        setSelectedChatId(String(detail.conversationId));
        setMobileStage("detail");
        setMobileDetailTab("approval");
        onViewModeChange?.("live");
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("sdr_approval_pending", handleApprovalPending);
    window.addEventListener("sdr_approval_open", handleApprovalOpen);
    window.addEventListener("sdr_live_activity", handleLiveActivity);

    return () => {
      disposed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (sseDebounceTimer) clearTimeout(sseDebounceTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("sdr_approval_pending", handleApprovalPending);
      window.removeEventListener("sdr_approval_open", handleApprovalOpen);
      window.removeEventListener("sdr_live_activity", handleLiveActivity);
    };
  }, [fetchSdrData, loadSessionMessages, onFilterChange, onViewModeChange, setSelectedChatId]);

  // Deep-link vindo do Rodízio ou da Varredura
  useEffect(() => {
    if (
      !targetConversation ||
      (!targetConversation.conversationId &&
        !targetConversation.dealId &&
        !targetConversation.phone &&
        !targetConversation.leadName) ||
      sessions.length === 0
    ) {
      return;
    }

    const targetId = (targetConversation.conversationId || "").trim();
    const targetDealId = (targetConversation.dealId || "").trim();
    const normPhone = (targetConversation.phone || "").replace(/\D/g, "");
    const normLeadName = (targetConversation.leadName || "").trim().toLowerCase();

    const phonesMatch = (sessionPhone: string | undefined | null) => {
      if (!normPhone || !sessionPhone) return false;
      const sDigits = sessionPhone.replace(/\D/g, "");
      if (!sDigits) return false;
      if (sDigits === normPhone) return true;
      const tailA = sDigits.slice(-8);
      const tailB = normPhone.slice(-8);
      return (
        tailA.length === 8 &&
        tailA === tailB &&
        sDigits.slice(-10, -8) === normPhone.slice(-10, -8)
      );
    };

    const matched =
      sessions.find(
        (s) =>
          (Boolean(targetId) &&
            (s.conversationId === targetId ||
              s.id === targetId ||
              (s.linkedDeal?.dealId && s.linkedDeal.dealId === targetId))) ||
          (Boolean(targetDealId) && s.linkedDeal?.dealId === targetDealId),
      ) ||
      (normPhone ? sessions.find((s) => phonesMatch(s.phone)) : undefined) ||
      (normLeadName
        ? sessions.find((s) => s.contactName.trim().toLowerCase() === normLeadName)
        : undefined);

    if (matched) {
      onFilterChange?.(DEFAULT_SDR_FILTER_STATE);
      setSelectedSessionId(matched.id);
      setSelectedChatId(matched.conversationId);
      setMobileStage("detail");
      setMobileDetailTab(matched.status === "awaiting_approval" ? "approval" : "chat");
      onViewModeChange?.("live");
    }

    onTargetConversationHandled?.();
  }, [
    targetConversation,
    sessions,
    setSelectedChatId,
    onFilterChange,
    onViewModeChange,
    onTargetConversationHandled,
  ]);

  const [isLinkingKnownClient, setIsLinkingKnownClient] = useState(false);

  const handleLinkKnownClient = async () => {
    if (!selectedSession) return;
    setIsLinkingKnownClient(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link_known_client",
          conversationId: selectedSession.conversationId,
          companyName:
            selectedSession.knownClient?.companyName ||
            (selectedSession.company !== "Empresa não informada"
              ? selectedSession.company
              : undefined),
          document: selectedSession.knownClient?.document || undefined,
          contactName:
            selectedSession.knownClient?.contactName || selectedSession.contactName || undefined,
          accountId: selectedSession.knownClient?.accountId || undefined,
        }),
      });
      if (res.ok) {
        const payload = await res.json();
        toast.success(
          `Cadastro vinculado com sucesso: ${payload.knownClient?.companyName || selectedSession.company}!`,
        );
        setSessions((prev) =>
          prev.map((s) =>
            s.id === selectedSession.id
              ? {
                  ...s,
                  company: payload.knownClient?.companyName || s.company,
                  collectedData: payload.collectedData || s.collectedData,
                  knownClient: payload.knownClient || s.knownClient,
                  triageProgress: payload.triageProgress || s.triageProgress,
                }
              : s,
          ),
        );
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Não foi possível vincular o cadastro deste cliente.");
      }
    } catch (e) {
      console.error("Erro ao vincular cliente recorrente:", e);
      toast.error("Erro de conexão ao vincular cadastro.");
    } finally {
      setIsLinkingKnownClient(false);
    }
  };

  const handleStopBot = async () => {
    if (!selectedSession || selectedSession.status !== "active") return;
    setIsStoppingBot(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          conversationId: selectedSession.conversationId,
        }),
      });

      if (res.ok) {
        toast.success(
          `Atendimento ${persona.gender === "female" ? "da" : "do"} ${persona.name} interrompido para este contato!`,
        );
        setSessions((prev) =>
          prev.map((s) =>
            s.id === selectedSession.id
              ? {
                  ...s,
                  status: "stopped",
                  outcome: "stopped",
                  responsibleName: "Interrompido (Atendimento Manual)",
                }
              : s,
          ),
        );
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(
          err.error ||
            `Erro ao interromper ${persona.gender === "female" ? "a" : "o"} ${persona.name}.`,
        );
      }
    } catch (e) {
      console.error(`Erro ao interromper ${persona.name}:`, e);
      toast.error(
        `Erro de conexão ao interromper ${persona.gender === "female" ? "a" : "o"} ${persona.name}.`,
      );
    } finally {
      setIsStoppingBot(false);
    }
  };

  const handleResumeBot = async () => {
    if (!selectedSession || selectedSession.status !== "stopped" || isResumingBot) return;
    setIsResumingBot(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resume",
          conversationId: selectedSession.conversationId,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.success(
          data.message ||
            `Triagem ${persona.gender === "female" ? "da" : "do"} ${persona.name} retomada com sucesso!`,
        );
        void fetchSdrData({ force: true });
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(
          err.error ||
            `Erro ao retomar ${persona.gender === "female" ? "a" : "o"} ${persona.name}.`,
        );
      }
    } catch (e) {
      console.error(`Erro ao retomar ${persona.name}:`, e);
      toast.error(
        `Erro de conexão ao retomar ${persona.gender === "female" ? "a" : "o"} ${persona.name}.`,
      );
    } finally {
      setIsResumingBot(false);
    }
  };

  const timelineItems = useMemo(
    () => (selectedSession ? buildSdrTimelineItems(selectedSession, persona.name) : []),
    [selectedSession, persona.name],
  );

  const anyFilterActive =
    hasActiveSdrFilters(effectiveFilterState) || Boolean(effectiveFilterState.searchQuery.trim());

  const awaitingApprovalSessions = useMemo(
    () => sessions.filter((s) => s.status === "awaiting_approval"),
    [sessions],
  );

  const handleApprovalActionCompleted = useCallback(
    (kind: "approved" | "dismissed" | "assumed", completedConvId: string) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.conversationId !== completedConvId) return s;
          const nextStatus: SdrSessionStatus = kind === "assumed" ? "manual" : "completed";
          return {
            ...s,
            status: nextStatus,
            pendingApproval: null,
          };
        }),
      );
      if (!effectiveFilterState.showCompleted) {
        setSelectedSessionId((prev) =>
          prev === selectedSession?.id || prev === completedConvId ? null : prev,
        );
        if (isCompactViewport) {
          setMobileStage("list");
        }
      }
      sdrEtagRef.current = null;
      void fetchSdrData({ force: true });
    },
    [effectiveFilterState.showCompleted, selectedSession?.id, isCompactViewport, fetchSdrData],
  );

  const showListPanel = !isCompactViewport || mobileStage === "list";
  const showChatPanel = !isCompactViewport || (mobileStage === "detail" && mobileDetailTab === "chat");
  const showRightPanel = isCompactViewport
    ? mobileStage === "detail" && mobileDetailTab === "approval"
    : isInfoPanelOpen;
  const isInitialLoading = !hasLoadedOnce && sessions.length === 0;

  return (
    <div className="relative flex-1 h-full overflow-hidden flex flex-col">
      {/* Barra ultra-discreta de sincronização no topo quando atualiza sobre dados já visíveis */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 z-30 h-[2px] transition-opacity duration-200 ${
          isLoading && sessions.length > 0 ? "opacity-90 sdr-sync-bar" : "opacity-0"
        }`}
      />

      <AnimatePresence initial={false}>
      {isIndustrial && awaitingApprovalSessions.length > 0 && (
        <motion.div
          key="sdr-approval-banner"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="mb-2 shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:py-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span className="text-[11px] font-extrabold text-amber-800 dark:text-amber-200 leading-tight sm:truncate">
              {awaitingApprovalSessions.length === 1
                ? `1 triagem concluída pelo ${persona.name} aguardando aprovação SDR`
                : `${awaitingApprovalSessions.length} triagens concluídas pelo ${persona.name} aguardando aprovação SDR`}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto justify-end">
            {onFilterChange && effectiveFilterState.statusFilter !== "awaiting_approval" && (
              <button
                type="button"
                onClick={() => {
                  onFilterChange((prev) => ({ ...prev, statusFilter: "awaiting_approval" }));
                  if (isCompactViewport) setMobileStage("list");
                }}
                className="px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-lg text-[10px] font-bold border border-amber-500/40 bg-card hover:bg-amber-500/15 text-amber-800 dark:text-amber-200 transition active:scale-[0.97] cursor-pointer"
              >
                Filtrar pendentes
              </button>
            )}
            <button
              type="button"
              onClick={() => handleSelectSessionFromKanban(awaitingApprovalSessions[0])}
              className="px-3 py-1.5 sm:px-2.5 sm:py-1 rounded-lg text-[10px] font-extrabold bg-amber-600 hover:bg-amber-700 text-white transition active:scale-[0.97] cursor-pointer shadow-2xs"
            >
              Revisar agora
            </button>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
      {viewMode === "kanban" ? (
        <motion.div
          key="sdr-view-kanban"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex-1 h-full min-h-0 flex flex-col"
        >
          {isInitialLoading ? (
            <SdrKanbanSkeleton />
          ) : (
            <SdrKanbanBoard
              tenant={tenant}
              sessions={sessions}
              selectedSessionId={selectedSession?.id}
              onSelectSession={handleSelectSessionFromKanban}
              filterState={deferredFilterState}
              sdrEnabled={sdrEnabled}
            />
          )}
        </motion.div>
      ) : (
        <motion.div
          key="sdr-view-live"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className={`flex flex-1 h-full min-h-0 overflow-hidden ${
            isCompactViewport ? "flex-col gap-2" : "gap-3.5"
          }`}
        >
          {/* ── CABEÇALHO + SUB-ABAS MOBILE/TABLET (QUANDO EM DETALHE) ──────── */}
          {isCompactViewport && mobileStage === "detail" && (
            <div className="shrink-0 bg-card rounded-2xl border border-border shadow-soft px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setMobileStage("list")}
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-xl bg-muted/70 hover:bg-muted text-foreground text-[11px] font-extrabold transition cursor-pointer shrink-0"
                    aria-label="Voltar para a lista de triagens"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Lista</span>
                  </button>

                  {selectedSession && (
                    <div className="flex items-center gap-2 min-w-0">
                      {selectedSession.contactAvatar ? (
                        <img
                          src={selectedSession.contactAvatar}
                          alt={selectedSession.contactName}
                          loading="lazy"
                          decoding="async"
                          className="h-7 w-7 rounded-full object-cover border border-primary/25 shrink-0"
                        />
                      ) : (
                        <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary font-bold text-[10px] shrink-0 border border-primary/20">
                          {selectedSession.contactName[0]?.toUpperCase() || "C"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-xs font-extrabold text-foreground truncate leading-tight">
                          {selectedSession.contactName}
                        </h3>
                        <p className="text-[10px] text-muted-foreground truncate leading-tight">
                          {selectedSession.company}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {selectedSession && (
                  <div className="shrink-0">
                    <StatusBadge status={selectedSession.status} />
                  </div>
                )}
              </div>

              {/* Alternador de Sub-abas: Aprovar & Dados | Conversa */}
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/50 border border-border/70 p-1">
                <button
                  type="button"
                  onClick={() => setMobileDetailTab("approval")}
                  className={`py-2 px-2.5 rounded-lg text-[11px] font-extrabold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    mobileDetailTab === "approval"
                      ? selectedSession?.status === "awaiting_approval"
                        ? "bg-amber-600 text-white shadow-xs"
                        : "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {isIndustrial ? "Aprovar & Dados" : "Dados Coletados"}
                  </span>
                  {selectedSession?.status === "awaiting_approval" && (
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 animate-pulse ${
                        mobileDetailTab === "approval" ? "bg-white" : "bg-amber-500"
                      }`}
                    />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setMobileDetailTab("chat")}
                  className={`py-2 px-2.5 rounded-lg text-[11px] font-extrabold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    mobileDetailTab === "chat"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span>Conversa</span>
                </button>
              </div>
            </div>
          )}

          {/* ── PAINEL ESQUERDO — Lista de sessões reais (28% desktop / 100% mobile) ── */}
          {showListPanel && (
          <div
            className={
              isCompactViewport
                ? "w-full flex-1 min-h-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft"
                : "w-[28%] min-w-[270px] max-w-[360px] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft"
            }
          >
            <div className="px-4 py-3 border-b border-line shrink-0 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
                    <UserPlus className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">Triagens SDR (Ao Vivo)</span>
                  </h3>
                  <SystemTooltip content="Ciclos SDR registrados: considera o ciclo mais recente de cada atendimento. Hoje usa o horário de Brasília.">
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate cursor-default">
                      {monitoringSummary
                        ? `${monitoringSummary.byAgent.sdr?.activeFlows || 0} em triagem · ${monitoringSummary.byAgent.sdr?.currentCycles || 0} ciclos atuais · ${monitoringSummary.byAgent.sdr?.startedToday || 0} hoje`
                        : "Métricas indisponíveis"}
                      {` · ${filteredSessions.length}/${sessions.length} exibidos`}
                    </p>
                  </SystemTooltip>
                  {monitoringError && (
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5" role="status">
                      {monitoringError}
                    </p>
                  )}
                </div>

                <SystemTooltip content="Atualizar sessões ao vivo">
                  <button
                    type="button"
                    onClick={() => void fetchSdrData({ force: true })}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer shrink-0"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
                  </button>
                </SystemTooltip>
              </div>

              {anyFilterActive && onFilterChange && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-primary-soft/50 border border-primary/20 px-2.5 py-1.5">
                  <span className="text-[10px] font-bold text-primary truncate">
                    Filtros ativos ({filteredSessions.length} resultado(s))
                  </span>
                  <button
                    type="button"
                    onClick={() => onFilterChange(DEFAULT_SDR_FILTER_STATE)}
                    className="inline-flex items-center gap-1 text-[10px] font-extrabold text-primary hover:underline cursor-pointer shrink-0"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    Limpar
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {isInitialLoading ? (
                <SdrLiveListSkeleton />
              ) : filteredSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center h-full gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-primary-soft/50 grid place-items-center text-primary">
                    <Bot className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-xs font-extrabold text-foreground">
                      {anyFilterActive
                        ? "Nenhuma Triagem Encontrada"
                        : "Aguardando Triagens ao Vivo"}
                    </h4>
                    <p className="text-[10px] text-muted-foreground mt-1 max-w-[220px]">
                      {anyFilterActive
                        ? "Nenhum atendimento corresponde aos filtros ativos no cabeçalho."
                        : `Assim que novas conversas entrarem na triagem com ${persona.gender === "female" ? "a" : "o"} ${persona.name}, elas aparecerão aqui.`}
                    </p>
                    {anyFilterActive && onFilterChange && (
                      <button
                        type="button"
                        onClick={() => onFilterChange(DEFAULT_SDR_FILTER_STATE)}
                        className="mt-3 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-extrabold hover:bg-primary-hover transition cursor-pointer shadow-soft"
                      >
                        Ver Todas as Triagens
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                filteredSessions.map((session) => (
                  <SdrLiveSessionItem
                    key={session.id}
                    session={session}
                    isSelected={selectedSession?.id === session.id}
                    isCompactViewport={isCompactViewport}
                    isIndustrial={isIndustrial}
                    onSelect={handleSelectLiveSession}
                  />
                ))
              )}
            </div>
          </div>
          )}

          {/* ── PAINEL CENTRAL — Chat Compilado em Tempo Real ─────────────────── */}
          {showChatPanel && (
          <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
            {selectedSession ? (
              <>
                {!isCompactViewport && (
                <div className="px-4 py-3 border-b border-line shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {selectedSession.contactAvatar ? (
                        <SystemTooltip content="Ver foto do cliente em tela cheia">
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewModalImage({
                                url: selectedSession.contactAvatar!,
                                title: selectedSession.contactName,
                              })
                            }
                            className="cursor-pointer group focus:outline-none shrink-0"
                          >
                            <img
                              src={selectedSession.contactAvatar}
                              alt={selectedSession.contactName}
                              loading="lazy"
                              decoding="async"
                              className="h-8 w-8 rounded-full object-cover border-2 border-primary/20 shadow-soft group-hover:scale-105 group-hover:border-primary transition duration-200"
                            />
                          </button>
                        </SystemTooltip>
                      ) : (
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-primary font-bold text-xs shrink-0 border border-primary/20 shadow-soft">
                          {selectedSession.contactName[0]?.toUpperCase() || "C"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-xs font-extrabold text-foreground truncate">
                          {selectedSession.contactName}
                        </h3>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {selectedSession.company} · {selectedSession.currentStep}
                          {selectedSession.responsibleName
                            ? ` · ${selectedSession.responsibleName}`
                            : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={selectedSession.status} />
                      {selectedSession.monitoring && (
                        <span className="hidden xl:inline-flex text-[10px] font-bold text-muted-foreground px-2 py-0.5 rounded-lg bg-muted/60 border border-border">
                          {selectedSession.monitoring.label}
                        </span>
                      )}

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setIsInfoPanelOpen((prev) => !prev)}
                              className={`p-1.5 rounded-lg border transition cursor-pointer flex items-center justify-center ${
                                isInfoPanelOpen
                                  ? "bg-primary-soft text-primary border-primary/30 hover:bg-primary-soft/80"
                                  : "bg-muted/60 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                              }`}
                              aria-label={
                                isInfoPanelOpen
                                  ? "Minimizar dados coletados"
                                  : "Expandir dados coletados"
                              }
                            >
                              {isInfoPanelOpen ? (
                                <PanelRightClose className="h-3.5 w-3.5" />
                              ) : (
                                <PanelRightOpen className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {isInfoPanelOpen
                              ? "Minimizar painel de dados coletados"
                              : "Expandir painel de dados coletados"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </div>
                )}

                <div
                  ref={chatMessagesContainerRef}
                  onScroll={handleChatContainerScroll}
                  onLoadCapture={handleChatMediaLoad}
                  className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-2.5 scrollbar-thin"
                >
                  {isLoadingMessages && !selectedSession.messagesLoaded ? (
                    <SdrChatMessagesSkeleton />
                  ) : (
                    <div key={selectedSession.id} className="space-y-2.5 sdr-enter">
                      {timelineItems.map((item) => {
                        const agentInfo =
                          item.type === "message" && item.msg.sender === "agent"
                            ? resolveAgentSenderInfo(item.msg, selectedSession)
                            : null;
                        return (
                          <SdrTimelineRow
                            key={
                              item.type === "message"
                                ? `${selectedSession.id}-${item.id}`
                                : item.id
                            }
                            item={item}
                            tenant={tenant}
                            personaName={persona.name}
                            personaGender={persona.gender}
                            personaCompany={persona.company}
                            personaAvatarUrl={persona.avatarUrl}
                            personaAvatarLightUrl={persona.avatarLightUrl}
                            personaAvatarDarkUrl={persona.avatarDarkUrl}
                            contactName={selectedSession.contactName}
                            contactAvatar={selectedSession.contactAvatar}
                            agentName={agentInfo?.name ?? null}
                            agentAvatar={agentInfo?.avatar ?? null}
                            onPreviewMedia={setPreviewModalImage}
                          />
                        );
                      })}
                    </div>
                  )}

                  {selectedSession.outcome && selectedSession.outcome !== "in_progress" && (
                    <div className="flex flex-wrap items-center justify-center gap-2 mt-3 animate-fadeIn">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-muted/70 text-foreground border border-border">
                        {selectedSession.status === "completed" ? (
                          <CheckCircle className="h-3 w-3 text-emerald-500" />
                        ) : selectedSession.status === "abandoned" ? (
                          <Clock className="h-3 w-3 text-amber-500" />
                        ) : (
                          <Info className="h-3 w-3 text-primary" />
                        )}
                        {selectedSession.status === "abandoned"
                          ? `Ciclo sem resposta do cliente${selectedSession.responsibleName ? ` · ${selectedSession.responsibleName}` : ""}`
                          : selectedSession.status === "stopped"
                            ? selectedSession.currentStep === "Encaminhado (SDR Desativado)"
                              ? "Triagem interrompida (SDR desativado)"
                              : "Triagem interrompida manualmente"
                            : selectedSession.status === "completed"
                              ? `Triagem concluída${selectedSession.responsibleName ? ` · ${selectedSession.responsibleName}` : ""}`
                              : selectedSession.monitoring?.label || selectedSession.outcome}
                      </span>
                      {selectedSession.status === "stopped" && sdrEnabled && (
                        <button
                          type="button"
                          onClick={handleResumeBot}
                          disabled={isResumingBot}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-extrabold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 transition cursor-pointer disabled:opacity-50"
                        >
                          {isResumingBot ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          {isResumingBot ? "Retomando..." : `Retomar ${persona.name}`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : isInitialLoading ? (
              <div className="flex-1 overflow-hidden px-3 sm:px-4 py-3">
                <SdrChatMessagesSkeleton />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <MessageSquare className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <p className="text-xs font-bold text-muted-foreground">
                  Nenhuma conversa selecionada
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  Selecione uma triagem na lista ao lado para acompanhar as mensagens em tempo real.
                </p>
              </div>
            )}
          </div>
          )}

          {/* ── PAINEL DIREITO — Aprovação & Dados Coletados Reais ── */}
          <AnimatePresence>
            {showRightPanel && (
              <motion.div
                initial={isCompactViewport ? { opacity: 0, y: 6 } : { width: 0, opacity: 0 }}
                animate={isCompactViewport ? { opacity: 1, y: 0 } : { width: "26%", opacity: 1 }}
                exit={isCompactViewport ? { opacity: 0, y: 6 } : { width: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className={
                  isCompactViewport
                    ? "w-full flex-1 min-h-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft"
                    : "w-[26%] min-w-[270px] max-w-[340px] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft"
                }
              >
                {selectedSession ? (
                  (() => {
                    const mergedData = getMergedCollectedData(
                      selectedSession.collectedData,
                      isIndustrial,
                      selectedSession,
                    );
                    const filledCount = Object.values(mergedData).filter(
                      (d) => d.status === "filled",
                    ).length;
                    const totalCount = Object.keys(mergedData).length;
                    const cleanTargetFunnel = getCleanTargetFunnel(selectedSession.targetFunnel);
                    const knownCompany =
                      selectedSession.knownClient?.companyName ||
                      selectedSession.previousTriages?.find((p) => p.company)?.company ||
                      (selectedSession.company && selectedSession.company !== "Empresa não informada"
                        ? selectedSession.company
                        : null);
                    const knownDoc =
                      selectedSession.knownClient?.document ||
                      selectedSession.previousTriages?.find((p) => p.document)?.document ||
                      null;
                    const isKnownConfirmed =
                      Boolean(selectedSession.knownClient?.confirmed) ||
                      (mergedData["EMPRESA"]?.status === "filled" &&
                        (!mergedData["CNPJ OU CPF"] ||
                          mergedData["CNPJ OU CPF"]?.status === "filled"));
                    const canStopBot = selectedSession.status === "active";
                    const hasLinkedDeal = Boolean(selectedSession.linkedDeal?.dealId);

                    return (
                      <>
                        <div className="px-4 py-3 border-b border-line shrink-0 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                              <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                              <span className="truncate">Dados Coletados</span>
                            </h3>
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                              {filledCount} de {totalCount} campos
                              {cleanTargetFunnel ? ` · ${cleanTargetFunnel}` : ""}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  {selectedSession.status === "stopped" && sdrEnabled ? (
                                    <button
                                      type="button"
                                      onClick={handleResumeBot}
                                      disabled={isResumingBot}
                                      className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 px-2 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                      {isResumingBot ? (
                                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                      ) : (
                                        <RotateCcw className="h-2.5 w-2.5" />
                                      )}
                                      <span className="hidden sm:inline">
                                        {isResumingBot ? "Retomando..." : `Retomar ${persona.name}`}
                                      </span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={handleStopBot}
                                      disabled={isStoppingBot || !canStopBot}
                                      className="text-[10px] font-extrabold text-primary hover:text-primary-hover bg-primary-soft hover:bg-primary-soft/80 border border-primary/20 px-2 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                      <Square className="h-2.5 w-2.5 text-primary fill-primary/30" />
                                      <span className="hidden sm:inline">
                                        {isStoppingBot ? "Parando..." : `Parar ${persona.name}`}
                                      </span>
                                    </button>
                                  )}
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                  {selectedSession.status === "stopped" && sdrEnabled
                                    ? `Retomar a triagem automática ${persona.gender === "female" ? "da" : "do"} ${persona.name} exatamente de onde parou`
                                    : canStopBot
                                      ? `Interromper instantaneamente as ações ${persona.gender === "female" ? "da" : "do"} ${persona.name} para este contato`
                                      : `Disponível apenas enquanto a triagem estiver ativa (${persona.name} não está atuando neste ciclo)`}
                                </TooltipContent>
                              </Tooltip>

                              {/* Botão "Abrir" com Mini Pop-up Personalizado */}
                              <div ref={openActionPopupRef} className="relative">
                                <button
                                  type="button"
                                  onClick={() => setIsOpenActionPopupOpen((prev) => !prev)}
                                  className={`text-[10px] font-black px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1 cursor-pointer shrink-0 ${
                                    isOpenActionPopupOpen
                                      ? "bg-primary text-primary-foreground border-primary shadow-soft"
                                      : "text-primary hover:text-primary-hover bg-primary/10 hover:bg-primary/15 border-primary/20"
                                  }`}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  <span className="hidden sm:inline">Abrir</span>
                                  <ChevronDown
                                    className={`h-2.5 w-2.5 transition-transform duration-200 ${
                                      isOpenActionPopupOpen ? "rotate-180" : ""
                                    }`}
                                  />
                                </button>

                                <AnimatePresence>
                                  {isOpenActionPopupOpen && (
                                    <motion.div
                                      initial={{ opacity: 0, y: 6, scale: 0.96 }}
                                      animate={{ opacity: 1, y: 0, scale: 1 }}
                                      exit={{ opacity: 0, y: 4, scale: 0.96 }}
                                      transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
                                      className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl bg-card border border-border shadow-2xl p-2 z-50 select-none"
                                    >
                                      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/70 mb-1.5">
                                        <span className="text-[10px] font-extrabold text-foreground tracking-wide">
                                          O que deseja abrir?
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => setIsOpenActionPopupOpen(false)}
                                          className="p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                                          aria-label="Fechar opções"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </div>

                                      <div className="space-y-1">
                                        <motion.button
                                          type="button"
                                          whileHover={{ x: 2 }}
                                          whileTap={{ scale: 0.98 }}
                                          onClick={() => handleOpenChatFromPopup(selectedSession)}
                                          className="w-full flex items-start gap-2.5 p-2 rounded-xl text-left hover:bg-primary-soft/60 border border-transparent hover:border-primary/20 transition cursor-pointer group"
                                        >
                                          <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 text-primary grid place-items-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition">
                                            <MessageSquare className="h-3.5 w-3.5" />
                                          </div>
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-1">
                                              <span className="text-[11px] font-extrabold text-foreground group-hover:text-primary transition">
                                                Abrir Chat
                                              </span>
                                              <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-primary transition shrink-0" />
                                            </div>
                                            <p className="text-[9px] text-muted-foreground leading-snug mt-0.5">
                                              Ir para a conversa deste atendimento no módulo de Chat
                                            </p>
                                          </div>
                                        </motion.button>

                                        {hasLinkedDeal ? (
                                          <motion.button
                                            type="button"
                                            whileHover={{ x: 2 }}
                                            whileTap={{ scale: 0.98 }}
                                            onClick={() =>
                                              handleOpenLinkedCardFromPopup(selectedSession)
                                            }
                                            className="w-full flex items-start gap-2.5 p-2 rounded-xl text-left hover:bg-primary-soft/60 border border-transparent hover:border-primary/20 transition cursor-pointer group"
                                          >
                                            <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 text-primary grid place-items-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition">
                                              <ShieldCheck className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <div className="flex items-center justify-between gap-1">
                                                <span className="text-[11px] font-extrabold text-foreground group-hover:text-primary transition">
                                                  Abrir Card Vinculado
                                                </span>
                                                <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-primary transition shrink-0" />
                                              </div>
                                              <p className="text-[9px] text-muted-foreground leading-snug mt-0.5 truncate">
                                                Card: {selectedSession.linkedDeal!.dealTitle}
                                              </p>
                                            </div>
                                          </motion.button>
                                        ) : (
                                          <div className="w-full flex items-start gap-2.5 p-2 rounded-xl text-left bg-muted/30 border border-border/50 opacity-60 cursor-not-allowed">
                                            <div className="h-7 w-7 rounded-lg bg-muted border border-border text-muted-foreground grid place-items-center shrink-0">
                                              <ShieldCheck className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <span className="text-[11px] font-bold text-muted-foreground block">
                                                Sem Card no CRM
                                              </span>
                                              <p className="text-[9px] text-muted-foreground leading-snug mt-0.5">
                                                Nenhuma negociação vinculada a esta conversa
                                              </p>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>

                              {!isCompactViewport && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => setIsInfoPanelOpen(false)}
                                      className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer shrink-0"
                                    >
                                      <PanelRightClose className="h-3.5 w-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom">Minimizar</TooltipContent>
                                </Tooltip>
                              )}
                            </TooltipProvider>
                          </div>
                        </div>

                        <div
                          key={selectedSession.id}
                          className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-2.5 scrollbar-thin sdr-enter"
                        >
                          {isIndustrial && selectedSession && (
                            <IndustrialApprovalPanel
                              tenantId={tenant || ""}
                              personaName={persona.name}
                              session={selectedSession}
                              onActionCompleted={handleApprovalActionCompleted}
                            />
                          )}

                          {isIndustrial && knownCompany && (
                            <div className="rounded-xl border border-primary/25 bg-primary-soft/40 p-2.5 space-y-1.5">
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="text-[9px] font-extrabold uppercase tracking-wide text-primary flex items-center gap-1">
                                  <RefreshCw className="h-2.5 w-2.5" />
                                  Cliente Recorrente na Base
                                </span>
                                {isKnownConfirmed ? (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                                    Vinculado
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={handleLinkKnownClient}
                                    disabled={isLinkingKnownClient}
                                    className="text-[9px] font-extrabold px-2 py-0.5 rounded-md bg-primary text-primary-foreground hover:bg-primary-hover transition cursor-pointer disabled:opacity-50"
                                  >
                                    {isLinkingKnownClient ? "Vinculando..." : "Vincular Triagem"}
                                  </button>
                                )}
                              </div>
                              <SystemTooltip content={knownCompany}>
                                <p className="text-[11px] font-extrabold text-foreground truncate cursor-default">
                                  {knownCompany}
                                </p>
                              </SystemTooltip>
                              {knownDoc && (
                                <p className="text-[9px] text-muted-foreground font-mono">
                                  Doc: {knownDoc}
                                </p>
                              )}
                            </div>
                          )}

                          {Object.entries(mergedData).map(([key, data]) => (
                            <div
                              key={key}
                              className={`rounded-xl border p-3 transition ${
                                data.status === "filled"
                                  ? "border-primary/20 bg-primary-soft/30"
                                  : "border-border bg-muted/30"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                                  {key}
                                </span>
                                {data.status === "filled" ? (
                                  <CheckCircle className="h-3 w-3 text-primary" />
                                ) : (
                                  <Clock className="h-3 w-3 text-muted-foreground/50" />
                                )}
                              </div>
                              <p
                                className={`text-xs font-bold ${
                                  data.status === "filled"
                                    ? "text-foreground"
                                    : "text-muted-foreground/40 italic"
                                }`}
                              >
                                {data.status === "filled" ? data.value : "Aguardando..."}
                              </p>
                            </div>
                          ))}

                          {isCompactViewport && selectedSession.monitoring && (
                            <IndustrialMonitoringPanel
                              monitoring={selectedSession.monitoring}
                              className="rounded-xl border border-border bg-muted/30 p-3 space-y-2"
                            />
                          )}

                          {isCompactViewport && (
                            <div className="pt-2 border-t border-line space-y-2">
                              {selectedSession.linkedDeal && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenLinkedCardFromPopup(selectedSession)}
                                  className="w-full text-left rounded-xl border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/15 hover:border-emerald-500/40 p-2.5 transition cursor-pointer group"
                                >
                                  <div className="flex items-center justify-between mb-0.5">
                                    <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                                      <ShieldCheck className="h-3 w-3 text-emerald-600" />
                                      Negociação (CRM Local)
                                    </span>
                                    <span className="text-[9px] font-extrabold px-1.5 py-0.2 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded-md">
                                      {selectedSession.linkedDeal.action === "reused_within_3h"
                                        ? "Vinculado (< 3h)"
                                        : selectedSession.linkedDeal.action === "created_new"
                                          ? "Criado neste ciclo"
                                          : "Vinculado"}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-1 mt-0.5">
                                    <p className="text-xs font-extrabold text-foreground truncate group-hover:text-primary transition">
                                      {selectedSession.linkedDeal.dealTitle}
                                    </p>
                                    <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary transition shrink-0" />
                                  </div>
                                </button>
                              )}

                              <div className="rounded-xl border border-primary/20 bg-primary-soft/30 p-2.5">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-[10px] font-bold text-primary uppercase tracking-wide flex items-center gap-1">
                                    <UserCheck className="h-3 w-3 text-primary" />
                                    Responsável (Rodízio)
                                  </span>
                                  <span className="text-[9px] font-extrabold px-1.5 py-0.2 bg-primary/15 text-primary rounded-md">
                                    {selectedSession.monitoring
                                      ? selectedSession.monitoring.operatorId
                                        ? "Atribuído"
                                        : "Sem atribuição"
                                      : selectedSession.status === "completed"
                                        ? "Alocado"
                                        : "Pendente"}
                                  </span>
                                </div>
                                <p className="text-xs font-extrabold text-foreground mt-0.5">
                                  {selectedSession.responsibleName || `${persona.name} IA (Em Triagem)`}
                                </p>
                              </div>

                              <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5 pb-1">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3 text-primary" />
                                  Início:{" "}
                                  {selectedSession.startedAt
                                    ? new Date(selectedSession.startedAt).toLocaleTimeString("pt-BR", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        timeZone: "America/Sao_Paulo",
                                      })
                                    : "—"}
                                </span>
                                <span className="flex items-center gap-1 truncate max-w-[160px]">
                                  <ChevronRight className="h-3 w-3 text-primary" />
                                  Etapa:{" "}
                                  <span className="font-bold text-foreground truncate">
                                    {selectedSession.currentStep || "—"}
                                  </span>
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        {!isCompactViewport && selectedSession.monitoring && (
                          <IndustrialMonitoringPanel monitoring={selectedSession.monitoring} />
                        )}

                        {!isCompactViewport && (
                        <div className="px-4 py-3 border-t border-line shrink-0 space-y-2">
                          {selectedSession.linkedDeal && (
                            <button
                              type="button"
                              onClick={() => handleOpenLinkedCardFromPopup(selectedSession)}
                              className="w-full text-left rounded-xl border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/15 hover:border-emerald-500/40 p-2.5 transition cursor-pointer group"
                            >
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                                  <ShieldCheck className="h-3 w-3 text-emerald-600" />
                                  Negociação (CRM Local)
                                </span>
                                <span className="text-[9px] font-extrabold px-1.5 py-0.2 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded-md">
                                  {selectedSession.linkedDeal.action === "reused_within_3h"
                                    ? "Vinculado (< 3h)"
                                    : selectedSession.linkedDeal.action === "created_new"
                                      ? "Criado neste ciclo"
                                      : "Vinculado"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-1 mt-0.5">
                                <p className="text-xs font-extrabold text-foreground truncate group-hover:text-primary transition">
                                  {selectedSession.linkedDeal.dealTitle}
                                </p>
                                <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary transition shrink-0" />
                              </div>
                            </button>
                          )}

                          <div className="rounded-xl border border-primary/20 bg-primary-soft/30 p-2.5">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] font-bold text-primary uppercase tracking-wide flex items-center gap-1">
                                <UserCheck className="h-3 w-3 text-primary" />
                                Responsável (Rodízio)
                              </span>
                              <span className="text-[9px] font-extrabold px-1.5 py-0.2 bg-primary/15 text-primary rounded-md">
                                {selectedSession.monitoring
                                  ? selectedSession.monitoring.operatorId
                                    ? "Atribuído"
                                    : "Sem atribuição"
                                  : selectedSession.status === "completed"
                                    ? "Alocado"
                                    : "Pendente"}
                              </span>
                            </div>
                            <p className="text-xs font-extrabold text-foreground mt-0.5">
                              {selectedSession.responsibleName || `${persona.name} IA (Em Triagem)`}
                            </p>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3 text-primary" />
                              Início:{" "}
                              {selectedSession.startedAt
                                ? new Date(selectedSession.startedAt).toLocaleTimeString("pt-BR", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: "America/Sao_Paulo",
                                  })
                                : "—"}
                            </span>
                            <span className="flex items-center gap-1 truncate max-w-[140px]">
                              <ChevronRight className="h-3 w-3 text-primary" />
                              Etapa:{" "}
                              <span className="font-bold text-foreground truncate">
                                {selectedSession.currentStep || "—"}
                              </span>
                            </span>
                          </div>
                        </div>
                        )}
                      </>
                    );
                  })()
                ) : isInitialLoading ? (
                  <SdrRightPanelSkeleton />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                    <div className="flex items-center justify-between w-full px-4 py-2 border-b border-line mb-4">
                      <span className="text-xs font-bold text-foreground">Informações</span>
                      <button
                        type="button"
                        onClick={() => setIsInfoPanelOpen(false)}
                        className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                      >
                        <PanelRightClose className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Clock className="h-8 w-8 text-muted-foreground/30 mb-2" />
                    <p className="text-xs font-bold text-muted-foreground">Sem dados selecionados</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── MODAL DE VISUALIZAÇÃO EM TELA CHEIA DA FOTO / MÍDIA ────────── */}
      <AnimatePresence>
        {previewModalImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewModalImage(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-md w-full bg-card rounded-3xl border border-border shadow-2xl overflow-hidden p-5 flex flex-col items-center gap-4 text-center"
            >
              <SystemTooltip content="Fechar visualização">
                <button
                  type="button"
                  onClick={() => setPreviewModalImage(null)}
                  className="absolute top-4 right-4 p-2 rounded-full bg-muted/80 hover:bg-muted text-foreground transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </SystemTooltip>

              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                <h3 className="text-xs font-extrabold text-foreground">
                  {previewModalImage.title}
                </h3>
              </div>

              <div className="relative rounded-2xl overflow-hidden border-2 border-primary/30 shadow-xl bg-black/40 p-1 max-h-[70vh] flex items-center justify-center w-full">
                {previewModalImage.url.match(/\.(mp4|webm|mov|avi|mkv)/i) ||
                previewModalImage.title.toLowerCase().includes("vídeo") ? (
                  <video
                    src={previewModalImage.url}
                    controls
                    autoPlay
                    className="max-h-[60vh] max-w-full w-auto object-contain rounded-xl shadow-2xl"
                  />
                ) : (
                  <img
                    src={previewModalImage.url}
                    alt={previewModalImage.title}
                    className="max-h-[60vh] max-w-full w-auto object-contain rounded-xl shadow-2xl"
                  />
                )}
              </div>

              <p className="text-[10px] text-muted-foreground">
                Clique fora ou no X para fechar a visualização.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
