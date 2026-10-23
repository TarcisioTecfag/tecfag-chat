// ══════════════════════════════════════════════════════════════════════════════
// 📋 SDR TAB — Monitoramento em Tempo Real do Agente SDR Valentina (100% Dados Reais)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus, CheckCircle, Clock, XCircle, Bot, User as UserIcon,
  ChevronRight, ChevronDown, ChevronUp, Circle, Search, ExternalLink, ShieldCheck, Smartphone,
  Power, Save, RefreshCw, MessageSquare, Square, UserCheck, Calendar, Filter, X,
  Play, Pause, FileText, Download, Globe, PanelRightOpen, PanelRightClose
} from "lucide-react";
import { WhatsappLogo, InstagramLogo, MessengerLogo } from "@/components/chat/ChatList";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { AiAvatar } from "@/components/ui/AiAvatar";
import { toast } from "sonner";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, SystemTooltip } from "@/components/ui/tooltip";
import { SdrKanbanBoard } from "./SdrKanbanBoard";
import { SdrFilterState, DEFAULT_SDR_FILTER_STATE } from "./sdr-kanban-data";
import type { IndustrialMonitoring } from "@/lib/triage/industrial-monitor";
import type { AgentMonitoringSummary } from "@/lib/triage/agent-monitor-store";
import { IndustrialMonitoringPanel } from "./IndustrialMonitoringPanel";
import {
  computeIndustrialTriageProgress,
  getAdaptiveIndustrialCollectedData,
} from "@/lib/triage/industrial-policy";

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
  status: "active" | "completed" | "abandoned";
  outcome?: string;
  responsibleName?: string;
  monitoring?: IndustrialMonitoring;
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
  messages: SdrTriageMessage[];
}

export function getSdrSessionLatestClientTimestamp(session: SdrTriageSession): number {
  let maxClientTs = 0;
  if (session.lastClientMessageAt) {
    const parsed = Date.parse(session.lastClientMessageAt);
    if (!Number.isNaN(parsed)) maxClientTs = parsed;
  }

  let maxAnyTs = 0;
  if (session.lastMessageAt) {
    const parsed = Date.parse(session.lastMessageAt);
    if (!Number.isNaN(parsed)) maxAnyTs = parsed;
  }

  if (Array.isArray(session.messages)) {
    for (const msg of session.messages) {
      if (!msg.sentAt) continue;
      const ts = Date.parse(msg.sentAt);
      if (Number.isNaN(ts)) continue;
      if (ts > maxAnyTs) maxAnyTs = ts;
      if (msg.sender === "client" && ts > maxClientTs) {
        maxClientTs = ts;
      }
    }
  }

  if (maxClientTs > 0) return maxClientTs;
  if (maxAnyTs > 0) return maxAnyTs;
  if (session.startedAt) {
    const started = Date.parse(session.startedAt);
    if (!Number.isNaN(started)) return started;
  }
  return 0;
}

type SdrTimelineItem =
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

function buildSdrTimelineItems(session: SdrTriageSession, personaName: string): SdrTimelineItem[] {
  const rawMessages = session.messages || [];
  if (rawMessages.length === 0) return [];

  // 1. Identificar fronteiras de ciclos de triagem na mesma conversa
  // Um novo ciclo se inicia quando:
  // - Há mensagem de sistema de reinício ("!reset", "Fluxo de triagem reiniciado", "Triagem anterior encerrada")
  // - Ou já houve atendimento humano ("agent") no ciclo atual e a IA ("bot") volta a atender em outra data ou após intervalo >= 30 min
  // - Ou há mensagens anteriores ao início do ciclo atual (session.startedAt) separadas por intervalo relevante
  const cycleStartIndices: number[] = [0];
  let hadAgentInCurrentCycle = false;
  let hadBotInCurrentCycle = false;

  const sessionStartMs = session.startedAt ? new Date(session.startedAt).getTime() : NaN;
  const hasRecordedPreviousTriages = Array.isArray(session.previousTriages) && session.previousTriages.length > 0;
  let splitBySessionStartUsed = false;

  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i];
    const prev = i > 0 ? rawMessages[i - 1] : null;

    if (i > 0) {
      const isSystemReset = m.sender === "system";
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
        (hasRecordedPreviousTriages || hadAgentInCurrentCycle || (hadBotInCurrentCycle && diffMinutes >= 60));

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

  const items: SdrTimelineItem[] = [];
  let lastRenderedDate: string | undefined = undefined;
  let currentCycleIdx = 0;
  let operatorHandoffShownInCycle = false;

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];

    // Verificar início de ciclo de triagem
    if (cycleStartSet.has(i)) {
      currentCycleIdx = cycleStartSet.get(i)!;
      operatorHandoffShownInCycle = false;

      const isPreviousCycle = currentCycleIdx < totalCycles - 1;
      const cycleDate = msg.date || undefined;

      if (isPreviousCycle) {
        const prevMeta = session.previousTriages?.[currentCycleIdx];
        const subtitleParts: string[] = [];
        if (cycleDate) subtitleParts.push(cycleDate);
        if (prevMeta?.targetFunnel) subtitleParts.push(prevMeta.targetFunnel);
        if (prevMeta?.responsibleName) subtitleParts.push(`Atendido por ${prevMeta.responsibleName}`);

        items.push({
          type: "cycle-divider",
          id: `cycle-prev-${currentCycleIdx}-${i}`,
          variant: "previous-triage",
          title: "Esta é a triagem anterior",
          subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : "Histórico de triagem concluída anteriormente",
        });
      } else if (totalCycles > 1) {
        items.push({
          type: "cycle-divider",
          id: `cycle-new-${currentCycleIdx}-${i}`,
          variant: "new-triage",
          title: "Triagem anterior encerrada · Novo atendimento de triagem",
          subtitle: cycleDate ? `Iniciado em ${formatDateMarkerLabel(cycleDate)} com ${personaName}` : `Novo ciclo iniciado com ${personaName}`,
        });
      } else if (hasRecordedPreviousTriages) {
        const lastPrev = session.previousTriages![session.previousTriages!.length - 1];
        const prevDate = lastPrev?.completedAt
          ? new Date(lastPrev.completedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
          : undefined;
        items.push({
          type: "cycle-divider",
          id: `cycle-archived-prev-${i}`,
          variant: "previous-triage",
          title: "Cliente com triagem anterior concluída",
          subtitle: [
            prevDate ? `Última triagem em ${prevDate}` : null,
            lastPrev?.targetFunnel ? `Setor: ${lastPrev.targetFunnel}` : null,
            lastPrev?.responsibleName ? `Operador: ${lastPrev.responsibleName}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Novo atendimento compilado no mesmo chat",
        });
      }
    }

    // Separador discreto por data (sempre que o dia mudar)
    if (msg.date && msg.date !== lastRenderedDate) {
      lastRenderedDate = msg.date;
      items.push({
        type: "date-divider",
        id: `date-${msg.date}-${i}`,
        label: formatDateMarkerLabel(msg.date),
      });
    }

    // Se a mensagem for apenas o comando técnico "!reset" ou aviso de sistema já representado pelo divisor de ciclo, não duplicar bolha
    if (msg.sender === "system") {
      continue;
    }

    // Separador de transição: quando o Operador Humano assume a conversa após ou durante a triagem
    if (msg.sender === "agent" && !operatorHandoffShownInCycle) {
      operatorHandoffShownInCycle = true;
      const isPreviousCycle = currentCycleIdx < totalCycles - 1;
      const opName = msg.senderName || session.responsibleName || "Operador";
      items.push({
        type: "cycle-divider",
        id: `handoff-${currentCycleIdx}-${i}`,
        variant: "operator-handoff",
        title: isPreviousCycle
          ? `Triagem anterior concluída · Atendimento com ${opName}`
          : `Triagem concluída · Atendimento com ${opName}`,
        subtitle: session.targetFunnel ? `Setor: ${session.targetFunnel}` : undefined,
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

const VALENTINA_AVATAR = "/valentina.png";

function AudioPlayerBubble({ src, isBot }: { src: string; isBot: boolean }) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
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
    <div className="flex items-center gap-3 py-1 px-1 min-w-[210px] max-w-[250px]">
      <audio
        ref={audioRef}
        src={src}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
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
          isBot ? "bg-white text-primary hover:bg-white/90" : "bg-primary text-white hover:bg-primary-hover"
        }`}
      >
        {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
      </button>

      <div className="flex-1 space-y-1">
        <div className="relative w-full h-1.5 rounded-full bg-black/10 overflow-hidden cursor-pointer">
          <div
            className={`h-full rounded-full transition-all duration-100 ${isBot ? "bg-white" : "bg-primary"}`}
            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-[9px] opacity-80 font-mono">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

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

const TECFAG_SDR_FIELDS = [
  "NOME COMPLETO",
  "EMPRESA",
  "CNPJ OU CPF",
  "RAMO / O QUE EMBALA",
  "MÁQUINA / PEÇA / INTERESSE",
  "VOLUME / PRODUÇÃO",
  "SETOR / FUNIL DE DESTINO",
];

function normalizeKey(key: string, tenantId: string = "valem"): string {
  const clean = key.toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, " ")
    .trim();

  if (clean.includes("NOME")) return "NOME COMPLETO";
  if (clean.includes("EMPRESA") || clean.includes("RAZAO")) return "EMPRESA";

  if (tenantId === "tecfag") {
    if (clean.includes("CNPJ") || clean.includes("CPF") || clean.includes("DOCUMENTO")) return "CNPJ OU CPF";
    if (clean.includes("RAMO") || clean.includes("EMBALA") || clean.includes("ENVASA")) return "RAMO / O QUE EMBALA";
    if (clean.includes("MAQUINA") || clean.includes("PECA") || clean.includes("INTERESSE") || clean.includes("PRODUTO")) {
      return "MÁQUINA / PEÇA / INTERESSE";
    }
    if (clean.includes("VOLUME") || clean.includes("PRODUCAO") || clean.includes("QUANTIDADE")) return "VOLUME / PRODUÇÃO";
    if (clean.includes("SETOR") || clean.includes("FUNIL") || clean.includes("DESTINO")) return "SETOR / FUNIL DE DESTINO";
    return key.trim().toUpperCase();
  }

  // Suporta tanto "CNPJ" quanto "CNPJ OU CPF" legado na Valem
  if (clean.includes("CNPJ") || clean.includes("CPF") || clean.includes("DOCUMENTO")) return "CNPJ";
  if (clean.includes("EMAIL") || clean.includes("E MAIL") || clean.includes("CORREIO")) return "EMAIL";
  if (clean.includes("PRODUTO")) return "QUAL O TIPO DE PRODUTO?";
  if (clean.includes("PROJETO") || clean.includes("DESENVOLVIMENTO")) return "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO";
  if (clean.includes("TEMPERATURA")) return "QUALIFICAÇÃO (TEMPERATURA)";
  if (clean.includes("QUALIFICACAO")) return "TIPO DE QUALIFICAÇÃO";

  return key.trim().toUpperCase();
}

function getMergedCollectedData(
  rawCollected: Record<string, any> = {},
  tenantId: string = "valem",
  session?: Partial<SdrTriageSession> | null,
) {
  if (tenantId === "tecfag") {
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
        const canonicalKey = normalizeKey(rawKey, "tecfag");
        canonicalRaw[canonicalKey] = {
          value: String(textVal).trim(),
          status: "filled",
        };
      }
    }

    const isCompleted =
      session?.status === "completed" ||
      session?.outcome === "completed" ||
      session?.outcome === "transferred";

    const adaptive = getAdaptiveIndustrialCollectedData({
      subflow: session?.subflow || null,
      funnelStage: session?.funnelStage || null,
      targetFunnel: session?.targetFunnel || null,
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
  const targetFields = VALEM_SDR_FIELDS;

  for (const field of targetFields) {
    merged[field] = {
      value: "Aguardando...",
      status: "pending",
    };
  }

  for (const [rawKey, rawVal] of Object.entries(rawCollected)) {
    if (!rawVal) continue;
    let textVal = typeof rawVal === "string" ? rawVal : rawVal.value;
    const isFilled = typeof rawVal === "object" && rawVal.status === "filled" 
      ? true 
      : Boolean(textVal && textVal.trim() !== "" && textVal !== "Aguardando..." && !textVal.toLowerCase().includes("mantem"));

    if (isFilled && textVal) {
      const canonicalKey = normalizeKey(rawKey, tenantId);

      // Normalização das 6 categorias oficiais da Valem para TIPO DE QUALIFICAÇÃO
      if (tenantId === "valem" && canonicalKey === "TIPO DE QUALIFICAÇÃO") {
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

function StatusBadge({ status }: { status: SdrTriageSession["status"] }) {
  const styles = {
    active: "bg-primary-soft text-primary border-primary/20",
    completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
    abandoned: "bg-primary-soft/50 text-muted-foreground border-border",
  };
  const labels = { active: "Ativo", completed: "Concluído", abandoned: "Encerrado" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${styles[status]}`}>
      {status === "active" && <Circle className="h-2 w-2 fill-primary text-primary animate-pulse" />}
      {status === "completed" && <CheckCircle className="h-2.5 w-2.5 text-emerald-600" />}
      {status === "abandoned" && <Clock className="h-2.5 w-2.5 text-muted-foreground" />}
      {labels[status]}
    </span>
  );
}

export interface SdrTabProps {
  sdrEnabled?: boolean;
  onSdrConfigChange?: (enabled: boolean) => void;
  filterState?: SdrFilterState;
  refreshKey?: number;
  onLoadingChange?: (loading: boolean) => void;
  onSelectedConversationChange?: (conversationId: string | undefined) => void;
  targetConversation?: { conversationId: string; leadName?: string; ts: number } | null;
  onTargetConversationHandled?: () => void;
}

export function SdrTab({
  sdrEnabled: externalSdrEnabled,
  onSdrConfigChange,
  filterState,
  refreshKey,
  onLoadingChange,
  onSelectedConversationChange,
  targetConversation,
  onTargetConversationHandled,
}: SdrTabProps = {}) {
  const { tenant, setActiveView, setSelectedChatId, operators, operatorProfile } = useChat();
  const navigate = useNavigate();
  const persona = getAiPersona(tenant || "valem");

  const [sdrEnabled, setSdrEnabled] = useState(externalSdrEnabled ?? true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Sincroniza estado de carregamento com o cabeçalho superior
  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  // Sincroniza estado vindo do Header superior
  useEffect(() => {
    if (externalSdrEnabled !== undefined) {
      setSdrEnabled(externalSdrEnabled);
    }
  }, [externalSdrEnabled]);

  // Atualização forçada vinda do botão Atualizar do header
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      fetchSdrData();
    }
  }, [refreshKey]);

  // Menu lateral direito de dados coletados (minimizado por padrão conforme solicitação de UX)
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(false);

  // Mini pop-up personalizado do botão "Abrir" (escolher entre Abrir Chat ou Abrir Card Vinculado)
  const [isOpenActionPopupOpen, setIsOpenActionPopupOpen] = useState(false);
  const openActionPopupRef = useRef<HTMLDivElement | null>(null);

  // Filtros
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const [channelFilter, setChannelFilter] = useState<"all" | "whatsapp" | "instagram" | "messenger" | "site">("all");
  const [isChannelDropdownOpen, setIsChannelDropdownOpen] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<"todos" | "hoje" | "7dias" | "30dias">("todos");
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = useState(false);
  const [isStoppingValentina, setIsStoppingValentina] = useState(false);

  // Modal de visualização em tela cheia da foto de perfil
  const [previewModalImage, setPreviewModalImage] = useState<{ url: string; title: string } | null>(null);

  // SESSÕES DE TRIAGEM (100% Reais do banco de dados)
  const [sessions, setSessions] = useState<SdrTriageSession[]>([]);
  const [monitoringSummary, setMonitoringSummary] = useState<AgentMonitoringSummary | null>(null);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  const monitorFetchRef = useRef<AbortController | null>(null);
  useEffect(() => {
    setSessions([]);
    setSelectedSession(null);
    setMonitoringSummary(null);
    setMonitoringError(null);
    return () => {
      monitorFetchRef.current?.abort();
      monitorFetchRef.current = null;
    };
  }, [tenant]);
  const [selectedSession, setSelectedSession] = useState<SdrTriageSession | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isChatHighlighted, setIsChatHighlighted] = useState(false);

  useEffect(() => {
    onSelectedConversationChange?.(selectedSession?.conversationId);
  }, [selectedSession?.conversationId, onSelectedConversationChange]);

  // Ref para rolagem automática do chat para o final (mensagem/imagem mais recente)
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

  // Sempre que abrir/trocar de chat na aba SDR, rolar para o final (mensagem mais recente)
  useEffect(() => {
    setIsOpenActionPopupOpen(false);
    if (!selectedSession?.id) return;
    chatOpenedAtRef.current = Date.now();
    shouldStickChatToBottomRef.current = true;
    scrollChatToBottom();
    const rafId = requestAnimationFrame(() => scrollChatToBottom());
    const t1 = setTimeout(() => scrollChatToBottom(), 60);
    const t2 = setTimeout(() => scrollChatToBottom(), 180);
    const t3 = setTimeout(() => scrollChatToBottom(), 350);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [selectedSession?.id, selectedSession?.conversationId, scrollChatToBottom]);

  // Rola para o final quando novas mensagens chegarem na sessão aberta
  useEffect(() => {
    if (!selectedSession?.messages?.length) return;
    shouldStickChatToBottomRef.current = true;
    const rafId = requestAnimationFrame(() => scrollChatToBottom());
    const t1 = setTimeout(() => scrollChatToBottom(), 80);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
    };
  }, [selectedSession?.messages?.length, scrollChatToBottom]);

  // Fechar mini pop-up do botão "Abrir" ao clicar fora ou pressionar ESC
  useEffect(() => {
    if (!isOpenActionPopupOpen) return;
    const handlePointerDownOutside = (ev: MouseEvent) => {
      if (openActionPopupRef.current && !openActionPopupRef.current.contains(ev.target as Node)) {
        setIsOpenActionPopupOpen(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setIsOpenActionPopupOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDownOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDownOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpenActionPopupOpen]);

  // Controle de navegação vertical suave entre Kanban (topo) e Triagens ao Vivo (baixo)
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeViewportSection, setActiveViewportSection] = useState<"kanban" | "chat">("kanban");

  const scrollToKanban = useCallback(() => {
    setActiveViewportSection("kanban");
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = document.getElementById("sdr-kanban-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const scrollToLiveChat = useCallback(() => {
    setActiveViewportSection("chat");
    const el = document.getElementById("sdr-live-chat-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const handleMainScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const threshold = Math.max(160, target.clientHeight * 0.35);
    if (target.scrollTop >= threshold) {
      setActiveViewportSection((prev) => (prev !== "chat" ? "chat" : prev));
    } else {
      setActiveViewportSection((prev) => (prev !== "kanban" ? "kanban" : prev));
    }
  }, []);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  // Resolve nome e foto real do operador a partir da mensagem + sessão + estado global de operadores
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
        !session.responsibleName.includes("Interrompido")
          ? session.responsibleName.trim()
          : null;

      const candidateName = rawMsgName || rawSessionResp;

      if (candidateName && Array.isArray(operators) && operators.length > 0) {
        const matchedOp = operators.find(
          (op) => op.name?.trim().toLowerCase() === candidateName.toLowerCase(),
        );
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

      if (operatorProfile?.name && operatorProfile.name.trim().toLowerCase() !== "operador") {
        return {
          name: operatorProfile.name,
          avatar: msg.senderAvatar || operatorProfile.avatar || null,
        };
      }

      return {
        name: msg.senderName || "Operador",
        avatar: msg.senderAvatar || null,
      };
    },
    [operators, operatorProfile],
  );

  // Ação para abrir o Chat da triagem selecionada
  const handleOpenChatFromPopup = useCallback(
    (session: SdrTriageSession) => {
      setIsOpenActionPopupOpen(false);
      setSelectedChatId(session.conversationId);
      setActiveView("chat");
      toast.info("Abrindo conversa no chat...");
    },
    [setSelectedChatId, setActiveView],
  );

  // Ação para abrir o Card vinculado àquela triagem em específico (Negociação no CRM ou Card no Kanban)
  const handleOpenLinkedCardFromPopup = useCallback(
    (session: SdrTriageSession) => {
      setIsOpenActionPopupOpen(false);
      if (session.linkedDeal?.dealId) {
        toast.info(`Abrindo card vinculado: ${session.linkedDeal.dealTitle}`);
        navigate({
          to: "/crm/deals/$dealId",
          params: { dealId: session.linkedDeal.dealId },
          search: { from: "valentina" },
        });
        return;
      }

      // Caso a triagem ainda esteja em andamento e não possua card criado no CRM, leva para o card no Kanban SDR
      scrollToKanban();
      toast.info("Exibindo o card desta triagem no quadro acima.");
    },
    [navigate, scrollToKanban],
  );

  // Manipulação de seleção via card do Kanban com scroll suave para a área de chat
  const handleSelectSessionFromKanban = (session: SdrTriageSession) => {
    setSelectedSession(session);
    setSelectedChatId(session.conversationId);
    setIsChatHighlighted(true);
    setTimeout(() => setIsChatHighlighted(false), 1400);

    setTimeout(() => {
      scrollToLiveChat();
      scrollChatToBottom();
    }, 60);
  };

  // Quando o usuário clica em "Ver Triagem" na aba de Rodízio, seleciona a sessão correspondente e rola para o chat SDR
  useEffect(() => {
    if (!targetConversation?.conversationId || sessions.length === 0) return;

    const targetId = targetConversation.conversationId;
    const normLeadName = (targetConversation.leadName || "").trim().toLowerCase();

    const matched =
      sessions.find(
        (s) =>
          s.conversationId === targetId ||
          s.id === targetId ||
          (s.linkedDeal?.dealId && s.linkedDeal.dealId === targetId)
      ) ||
      (normLeadName
        ? sessions.find((s) => s.contactName.trim().toLowerCase() === normLeadName)
        : undefined);

    if (matched) {
      setStatusFilter("all");
      setPeriodFilter("todos");
      setChannelFilter("all");
      setSearchQuery("");
      setSelectedSession(matched);
      setSelectedChatId(matched.conversationId);
      setIsChatHighlighted(true);
      setTimeout(() => setIsChatHighlighted(false), 1600);

      setTimeout(() => {
        scrollToLiveChat();
        scrollChatToBottom();
      }, 90);
    } else {
      setTimeout(() => {
        scrollToLiveChat();
      }, 90);
    }

    onTargetConversationHandled?.();
  }, [
    targetConversation,
    sessions,
    setSelectedChatId,
    scrollToLiveChat,
    scrollChatToBottom,
    onTargetConversationHandled,
  ]);

  // Carregar dados e configurações REAIS do SDR via API
  const fetchSdrData = useCallback(async () => {
    if (!tenant || monitorFetchRef.current) return;
    const controller = new AbortController();
    monitorFetchRef.current = controller;
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        if (controller.signal.aborted) return;
        setMonitoringSummary(data.monitoringSummary?.available === true ? data.monitoringSummary : null);
        setMonitoringError(data.monitoringSummary?.available === true ? null : "Métricas temporariamente indisponíveis.");
        if (data.config) {
          const isEn = Boolean(data.config.enabled);
          setSdrEnabled(isEn);
          onSdrConfigChange?.(isEn);
        }
        if (Array.isArray(data.sessions)) {
          const formattedLiveSessions: SdrTriageSession[] = data.sessions
            .map((s: any) => ({
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
              status: s.status,
              outcome: s.outcome,
              responsibleName: s.responsibleName,
              monitoring: s.monitoring,
              previousTriages: Array.isArray(s.previousTriages) ? s.previousTriages : [],
              messages: s.messages || [],
              ...(s.subflow ? { subflow: s.subflow } : {}),
              ...(s.funnelStage ? { funnelStage: s.funnelStage } : {}),
              ...(s.targetFunnel ? { targetFunnel: s.targetFunnel } : {}),
              ...(s.triageProgress ? { triageProgress: s.triageProgress } : {}),
              ...(s.knownClient ? { knownClient: s.knownClient } : {}),
              ...(s.linkedDeal ? { linkedDeal: s.linkedDeal } : {}),
              ...(s.unreadCount !== undefined ? { unreadCount: s.unreadCount } : {}),
              ...(s.channel ? { channel: s.channel === "livechat" ? "site" : s.channel } : {}),
              ...(s.timeAgo ? { timeAgo: s.timeAgo } : {}),
            }))
            .sort(
              (a: SdrTriageSession, b: SdrTriageSession) =>
                getSdrSessionLatestClientTimestamp(b) - getSdrSessionLatestClientTimestamp(a),
            );

          setSessions(formattedLiveSessions);
          setSelectedSession((prev) => {
            if (!prev) return formattedLiveSessions[0] || null;
            const match = formattedLiveSessions.find(
              (s) => s.id === prev.id || (s.conversationId && s.conversationId === prev.conversationId)
            );
            return match || formattedLiveSessions[0] || null;
          });
        }
      } else {
        setMonitoringSummary(null);
        setMonitoringError("Não foi possível atualizar o monitor. Os atendimentos exibidos podem estar desatualizados.");
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setMonitoringSummary(null);
      setMonitoringError("Sem conexão com o monitor. Os atendimentos exibidos podem estar desatualizados.");
      console.warn("[SdrTab] Erro ao carregar dados reais do SDR:", e);
    } finally {
      if (monitorFetchRef.current === controller) {
        monitorFetchRef.current = null;
        setIsLoading(false);
      }
    }
  }, [tenant, BACKEND_URL, onSdrConfigChange]);

  // Polling a cada 3 segundos para atualização ao vivo da triagem no WhatsApp
  useEffect(() => {
    fetchSdrData();
    const interval = setInterval(fetchSdrData, 3000);
    return () => clearInterval(interval);
  }, [fetchSdrData]);

  const handleToggleSdr = async () => {
    const nextState = !sdrEnabled;
    setSdrEnabled(nextState);
    setIsSavingConfig(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          enabled: nextState,
        }),
      });

      if (res.ok) {
        toast.success(nextState ? `SDR ${persona.name} ativado para todos os contatos!` : `SDR ${persona.name} pausado com sucesso!`);
      } else {
        setSdrEnabled(!nextState); // rollback
        toast.error("Erro ao alternar status do SDR.");
      }
    } catch (e) {
      console.error("Erro ao alternar status do SDR:", e);
      setSdrEnabled(!nextState); // rollback
      toast.error("Erro de comunicação com o servidor.");
    } finally {
      setIsSavingConfig(false);
    }
  };

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
            (selectedSession.company !== "Empresa não informada" ? selectedSession.company : undefined),
          document: selectedSession.knownClient?.document || undefined,
          contactName: selectedSession.knownClient?.contactName || selectedSession.contactName || undefined,
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
        setSelectedSession((prev) =>
          prev
            ? {
                ...prev,
                company: payload.knownClient?.companyName || prev.company,
                collectedData: payload.collectedData || prev.collectedData,
                knownClient: payload.knownClient || prev.knownClient,
                triageProgress: payload.triageProgress || prev.triageProgress,
              }
            : null,
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

  const handleStopValentina = async () => {
    if (!selectedSession) return;
    setIsStoppingValentina(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          conversationId: selectedSession.conversationId,
          tenantId: tenant,
        }),
      });

      if (res.ok) {
        toast.success(`Atendimento ${persona.gender === "female" ? "da" : "do"} ${persona.name} interrompido para este contato!`);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === selectedSession.id
              ? {
                  ...s,
                  status: "abandoned",
                  outcome: "stopped",
                  responsibleName: "Interrompido (Atendimento Manual)",
                }
              : s
          )
        );
        setSelectedSession((prev) =>
          prev
            ? {
                ...prev,
                status: "abandoned",
                outcome: "stopped",
                responsibleName: "Interrompido (Atendimento Manual)",
              }
            : null
        );
      } else {
        toast.error(`Erro ao interromper ${persona.gender === "female" ? "a" : "o"} ${persona.name}.`);
      }
    } catch (e) {
      console.error(`Erro ao interromper ${persona.name}:`, e);
      toast.error(`Erro de conexão ao interromper ${persona.gender === "female" ? "a" : "o"} ${persona.name}.`);
    } finally {
      setIsStoppingValentina(false);
    }
  };

  const filteredSessions = sessions.filter((session) => {
    // Filtro por canal
    if (channelFilter !== "all") {
      const sessionChannel = (session as any).channel || "whatsapp";
      if (sessionChannel !== channelFilter) return false;
    }

    if (statusFilter === "active") {
      if (session.status !== "active") return false;
    } else if (statusFilter === "completed") {
      const isCompleted = session.status === "completed" || session.outcome === "completed" || session.outcome === "transferred";
      if (!isCompleted) return false;
    }

    if (periodFilter !== "todos" && session.startedAt) {
      const sessionDate = new Date(session.startedAt);
      const now = new Date();
      if (periodFilter === "hoje") {
        if (sessionDate.toDateString() !== now.toDateString()) return false;
      } else if (periodFilter === "7dias") {
        const diffDays = (now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 7) return false;
      } else if (periodFilter === "30dias") {
        const diffDays = (now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 30) return false;
      }
    }

    const activeSearchQuery = (filterState?.searchQuery ?? searchQuery).trim().toLowerCase();
    if (activeSearchQuery) {
      const matchName = (session.contactName || "").toLowerCase().includes(activeSearchQuery);
      const matchCompany = (session.company || "").toLowerCase().includes(activeSearchQuery);
      const matchPhone = (session.phone || "").toLowerCase().includes(activeSearchQuery);
      const matchMessages = (session.messages || []).some((msg) =>
        (msg.text || "").toLowerCase().includes(activeSearchQuery)
      );
      if (!matchName && !matchCompany && !matchPhone && !matchMessages) return false;
    }

    if (filterState) {
      if (filterState.statusFilter === "analisando" && session.status !== "active") return false;
      if (filterState.statusFilter === "concluida" && session.status !== "completed") return false;
      if (filterState.unreadOnly) {
        const unread = (session as any).unreadCount || 0;
        if (unread <= 0) return false;
      }
      if (!filterState.showCompleted && session.status === "completed") return false;
      if (filterState.selectedDate && session.startedAt) {
        const sessDate = new Date(session.startedAt);
        const sameDay =
          sessDate.getDate() === filterState.selectedDate.getDate() &&
          sessDate.getMonth() === filterState.selectedDate.getMonth() &&
          sessDate.getFullYear() === filterState.selectedDate.getFullYear();
        if (!sameDay) return false;
      }
    }

    return true;
  }).sort((a, b) => getSdrSessionLatestClientTimestamp(b) - getSdrSessionLatestClientTimestamp(a));

  const effectiveFilterState = filterState || DEFAULT_SDR_FILTER_STATE;

  const timelineItems = useMemo(
    () => (selectedSession ? buildSdrTimelineItems(selectedSession, persona.name) : []),
    [selectedSession, persona.name]
  );

  return (
    <div className="relative flex-1 h-full overflow-hidden flex flex-col">
      <div
        ref={mainScrollRef}
        onScroll={handleMainScroll}
        className="flex flex-col flex-1 h-full overflow-y-auto scrollbar-thin scroll-smooth space-y-2.5 pr-1"
      >
        {/* ── PARTE SUPERIOR: KANBAN DE TRIAGEM (ORGANIZADOR DO FUNIL) ────────── */}
        <div
          id="sdr-kanban-section"
          className="h-[calc(100%-64px)] min-h-[420px] flex flex-col shrink-0 scroll-mt-1"
        >
          <SdrKanbanBoard
            sessions={sessions}
            selectedSessionId={selectedSession?.id}
            onSelectSession={handleSelectSessionFromKanban}
            filterState={effectiveFilterState}
          />
        </div>

        {/* ── PAINÉIS DE CONTEÚDO AO VIVO REAIS (TELA CHEIA 100% DA VIEWPORT) ──── */}
        <div
          id="sdr-live-chat-section"
          className={`flex gap-4 h-full min-h-full overflow-hidden shrink-0 transition-all duration-300 rounded-2xl scroll-mt-1 ${
            isChatHighlighted ? "ring-2 ring-primary/40" : ""
          }`}
        >
          {/* ── PAINEL ESQUERDO — Lista de sessões reais (30%) ────────────────── */}
          <div className="w-[30%] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
            <div className="px-4 py-3 border-b border-line shrink-0 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
                    <UserPlus className="h-3.5 w-3.5 text-primary" />
                    Triagens SDR (Ao Vivo)
                  </h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5" title="Ciclos SDR registrados: somente o ciclo mais recente de cada atendimento. Hoje usa o horário de Brasília.">
                    {monitoringSummary
                      ? `${monitoringSummary.byAgent.sdr?.activeFlows || 0} em triagem · ${monitoringSummary.byAgent.sdr?.currentCycles || 0} ciclos atuais · ${monitoringSummary.byAgent.sdr?.startedToday || 0} iniciados hoje (Brasília)`
                      : "Métricas indisponíveis"}
                    {` · ${sessions.length} atendimentos carregados`}
                  </p>
                  {monitoringError && <p className="text-[10px] text-amber-700 dark:text-amber-400" role="status">{monitoringError}</p>}
                </div>
                <div className="flex items-center gap-1">
                  {/* Dois ícones discretos para angular a tela entre Kanban (cima) e Chat (baixo) */}
                  <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
                    <SystemTooltip content="Subir para o Quadro Kanban">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: 0.94 }}
                        onClick={scrollToKanban}
                        className={`p-1 rounded-md transition cursor-pointer ${
                          activeViewportSection === "kanban"
                            ? "bg-primary text-primary-foreground shadow-2xs"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                        aria-label="Subir para o Kanban"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </motion.button>
                    </SystemTooltip>
                    <SystemTooltip content="Enquadrar Triagens SDR (Ao Vivo) em tela cheia">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: 0.94 }}
                        onClick={scrollToLiveChat}
                        className={`p-1 rounded-md transition cursor-pointer ${
                          activeViewportSection === "chat"
                            ? "bg-primary text-primary-foreground shadow-2xs"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                        aria-label="Descer para o Chat de Triagem"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </motion.button>
                    </SystemTooltip>
                  </div>

                  <SystemTooltip content="Atualizar sessões ao vivo">
                    <button
                      onClick={fetchSdrData}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
                    </button>
                  </SystemTooltip>
                </div>
              </div>

              {/* ── BOTÕES DE FILTRO: ATIVOS, CONCLUÍDOS, CANAL E PERÍODO ───────── */}
              <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                <button
                  onClick={() => setStatusFilter(statusFilter === "active" ? "all" : "active")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1 cursor-pointer border ${
                    statusFilter === "active"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-primary-soft text-primary border-primary/20 hover:bg-primary-soft/80"
                  }`}
                >
                  <Circle className="h-2.5 w-2.5 fill-current" />
                  Ativos
                </button>

                <button
                  onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1 cursor-pointer border ${
                    statusFilter === "completed"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-primary-soft text-primary border-primary/20 hover:bg-primary-soft/80"
                  }`}
                >
                  <CheckCircle className="h-3 w-3" />
                  Concluídos
                </button>

                {/* ── FILTRO: CANAL (WhatsApp, Instagram, Messenger, Site) ── */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setIsChannelDropdownOpen(!isChannelDropdownOpen);
                      setIsPeriodDropdownOpen(false);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1.5 cursor-pointer shadow-xs border ${
                      channelFilter !== "all"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-primary-soft text-primary border-primary/20 hover:bg-primary-soft/80"
                    }`}
                  >
                    {channelFilter === "whatsapp" && <WhatsappLogo className="h-3 w-3 fill-current" />}
                    {channelFilter === "instagram" && <InstagramLogo className="h-3 w-3 stroke-current" />}
                    {channelFilter === "messenger" && <MessengerLogo className="h-3 w-3 fill-current" />}
                    {channelFilter === "site" && <Globe className="h-3 w-3 text-current" />}
                    {channelFilter === "all" && <MessageSquare className="h-3 w-3 text-primary" />}
                    <span>
                      {channelFilter === "all"
                        ? "Canal: Todos"
                        : channelFilter === "whatsapp"
                        ? "WhatsApp"
                        : channelFilter === "instagram"
                        ? "Instagram"
                        : channelFilter === "messenger"
                        ? "Messenger"
                        : "Site"}
                    </span>
                    <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isChannelDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  <AnimatePresence>
                    {isChannelDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-30"
                          onClick={() => setIsChannelDropdownOpen(false)}
                        />
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 1 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 mt-1.5 z-40 w-44 rounded-xl bg-card border border-border shadow-xl p-1 space-y-0.5 overflow-hidden"
                        >
                          {[
                            { id: "all", label: "Canal: Todos", icon: MessageSquare },
                            { id: "whatsapp", label: "WhatsApp", icon: WhatsappLogo },
                            { id: "instagram", label: "Instagram", icon: InstagramLogo },
                            { id: "messenger", label: "Messenger", icon: MessengerLogo },
                            { id: "site", label: "Site (Web Chat)", icon: Globe },
                          ].map((item) => {
                            const isSelected = channelFilter === item.id;
                            const Icon = item.icon;
                            return (
                              <button
                                key={item.id}
                                onClick={() => {
                                  setChannelFilter(item.id as any);
                                  setIsChannelDropdownOpen(false);
                                }}
                                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center justify-between cursor-pointer ${
                                  isSelected
                                    ? "bg-primary-soft text-primary font-extrabold"
                                    : "text-foreground hover:bg-muted/60"
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <Icon className="h-3 w-3 text-primary shrink-0" />
                                  <span>{item.label}</span>
                                </span>
                                {isSelected && <CheckCircle className="h-3 w-3 text-primary shrink-0" />}
                              </button>
                            );
                          })}
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── FILTRO: PERÍODO ── */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setIsPeriodDropdownOpen(!isPeriodDropdownOpen);
                      setIsChannelDropdownOpen(false);
                    }}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-primary-soft text-primary border border-primary/20 hover:bg-primary-soft/80 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Calendar className="h-3 w-3 text-primary" />
                    <span>
                      {periodFilter === "todos"
                        ? "Período: Todos"
                        : periodFilter === "hoje"
                        ? "Período: Hoje"
                        : periodFilter === "7dias"
                        ? "Período: 7 dias"
                        : "Período: 30 dias"}
                    </span>
                    <ChevronDown className={`h-3 w-3 text-primary transition-transform duration-200 ${isPeriodDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  <AnimatePresence>
                    {isPeriodDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-30"
                          onClick={() => setIsPeriodDropdownOpen(false)}
                        />
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 1 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 mt-1.5 z-40 w-44 rounded-xl bg-card border border-border shadow-xl p-1 space-y-0.5 overflow-hidden"
                        >
                          {[
                            { id: "todos", label: "Período: Todos" },
                            { id: "hoje", label: "Período: Hoje" },
                            { id: "7dias", label: "Período: 7 dias" },
                            { id: "30dias", label: "Período: 30 dias" },
                          ].map((item) => {
                            const isSelected = periodFilter === item.id;
                            return (
                              <button
                                key={item.id}
                                onClick={() => {
                                  setPeriodFilter(item.id as any);
                                  setIsPeriodDropdownOpen(false);
                                }}
                                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center justify-between cursor-pointer ${
                                  isSelected
                                    ? "bg-primary-soft text-primary font-extrabold"
                                    : "text-foreground hover:bg-muted/60"
                                }`}
                              >
                                <span>{item.label}</span>
                                {isSelected && <CheckCircle className="h-3 w-3 text-primary shrink-0" />}
                              </button>
                            );
                          })}
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
                <input
                  type="text"
                  placeholder="Buscar por nome, empresa ou mensagem..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-border bg-muted/20 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50 text-foreground"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {filteredSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center h-full gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-primary-soft/50 grid place-items-center text-primary">
                    <Bot className="h-6 w-6 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-xs font-extrabold text-foreground">
                      {statusFilter === "completed"
                        ? "Nenhuma Triagem Concluída Encontrada"
                        : statusFilter === "active"
                        ? "Nenhuma Triagem Ativa Encontrada"
                        : "Aguardando Triagens ao Vivo"}
                    </h4>
                    <p className="text-[10px] text-muted-foreground mt-1 max-w-[220px]">
                      {statusFilter !== "all" ? (
                        <>
                          Você está filtrando por <span className="font-bold text-primary">{statusFilter === "completed" ? "Concluídos" : "Ativos"}</span>. Clique no botão abaixo para ver todas as triagens!
                        </>
                      ) : (
                        <>
                          Envie uma mensagem pelo WhatsApp para iniciar o atendimento e triagem ao vivo com {persona.gender === "female" ? "a" : "o"} {persona.name}!
                        </>
                      )}
                    </p>
                    {statusFilter !== "all" && (
                      <button
                        onClick={() => setStatusFilter("all")}
                        className="mt-3 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-extrabold hover:bg-primary-hover transition cursor-pointer shadow-soft"
                      >
                        Ver Todas as Triagens
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                filteredSessions.map((session) => {
                  const isSelected = selectedSession?.id === session.id;
                  const mergedData = getMergedCollectedData(session.collectedData, tenant || "valem", session);
                  const completedCount = Object.values(mergedData).filter((d) => d.status === "filled").length;
                  const totalCount = Object.keys(mergedData).length;
                  const progressPct =
                    session.triageProgress?.percentage ??
                    (session.status === "completed" || session.outcome === "completed" || session.outcome === "transferred"
                      ? 100
                      : totalCount > 0
                        ? (completedCount / totalCount) * 100
                        : 0);
                  const hasPreviousCycles = (session.previousTriages?.length || 0) > 0 || Boolean(session.knownClient?.companyName);

                  return (
                    <button
                      key={session.id}
                      onClick={() => setSelectedSession(session)}
                      className={`w-full text-left px-4 py-3 border-b border-line transition cursor-pointer ${
                        isSelected
                          ? "bg-primary-soft border-l-2 border-l-primary"
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
                      <p className="text-[10px] text-muted-foreground truncate">{session.company} {session.phone ? `· ${session.phone}` : ""}</p>
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground">
                            Campos {completedCount}/{totalCount}
                          </span>
                          <span className="text-[10px] font-semibold text-primary">
                            {Math.round(progressPct)}%
                          </span>
                        </div>
                        <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── PAINEL CENTRAL — Chat Compilado em Tempo Real (45% / Flex-1) ────── */}
          <div className="flex-1 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
            {selectedSession ? (
              <>
                <div className="px-4 py-3 border-b border-line shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {selectedSession.contactAvatar ? (
                        <SystemTooltip content="Ver foto do cliente em tela cheia">
                          <button
                            onClick={() => setPreviewModalImage({ url: selectedSession.contactAvatar!, title: selectedSession.contactName })}
                            className="cursor-pointer group focus:outline-none shrink-0"
                          >
                            <img
                              src={selectedSession.contactAvatar}
                              alt={selectedSession.contactName}
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
                        <h3 className="text-xs font-extrabold text-foreground truncate">{selectedSession.contactName}</h3>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {selectedSession.company} · {selectedSession.currentStep}
                          {selectedSession.responsibleName ? ` · ${selectedSession.responsibleName}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {selectedSession.monitoring
                        ? <span className="text-[10px] font-bold text-primary">{selectedSession.monitoring.label}</span>
                        : <StatusBadge status={selectedSession.status} />}

                      {/* Ícones discretos de navegação rápida no cabeçalho do chat */}
                      <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
                        <SystemTooltip content="Ver Kanban (Subir)">
                          <motion.button
                            type="button"
                            whileHover={{ scale: 1.06 }}
                            whileTap={{ scale: 0.94 }}
                            onClick={scrollToKanban}
                            className={`p-1 rounded-md transition cursor-pointer ${
                              activeViewportSection === "kanban"
                                ? "bg-primary text-primary-foreground shadow-2xs"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            }`}
                            aria-label="Ver Kanban"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </motion.button>
                        </SystemTooltip>
                        <SystemTooltip content="Ver Chat Ao Vivo em tela cheia (Descer)">
                          <motion.button
                            type="button"
                            whileHover={{ scale: 1.06 }}
                            whileTap={{ scale: 0.94 }}
                            onClick={scrollToLiveChat}
                            className={`p-1 rounded-md transition cursor-pointer ${
                              activeViewportSection === "chat"
                                ? "bg-primary text-primary-foreground shadow-2xs"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            }`}
                            aria-label="Ver Chat Ao Vivo"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </motion.button>
                        </SystemTooltip>
                      </div>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setIsInfoPanelOpen((prev) => !prev)}
                              className={`p-1.5 rounded-lg border transition cursor-pointer flex items-center justify-center ${
                                isInfoPanelOpen
                                  ? "bg-primary-soft text-primary border-primary/30 hover:bg-primary-soft/80"
                                  : "bg-muted/60 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                              }`}
                              aria-label={isInfoPanelOpen ? "Minimizar dados coletados" : "Expandir dados coletados"}
                            >
                              {isInfoPanelOpen ? (
                                <PanelRightClose className="h-3.5 w-3.5" />
                              ) : (
                                <PanelRightOpen className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {isInfoPanelOpen ? "Minimizar menu de informações coletadas" : "Expandir menu de informações coletadas"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </div>

                <div
                  ref={chatMessagesContainerRef}
                  onScroll={handleChatContainerScroll}
                  onLoadCapture={handleChatMediaLoad}
                  className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 scrollbar-thin"
                >
                  <AnimatePresence initial={false}>
                    {timelineItems.map((item) => {
                      if (item.type === "date-divider") {
                        return (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.18 }}
                            className="flex items-center gap-3 my-3 select-none"
                          >
                            <div className="h-px flex-1 bg-border/70" />
                            <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-muted/80 border border-border text-[10px] font-bold text-muted-foreground tracking-wide shadow-2xs">
                              <Calendar className="h-2.5 w-2.5 text-primary/80" />
                              {item.label}
                            </span>
                            <div className="h-px flex-1 bg-border/70" />
                          </motion.div>
                        );
                      }

                      if (item.type === "cycle-divider") {
                        const isPrev = item.variant === "previous-triage";
                        const isHandoff = item.variant === "operator-handoff";

                        return (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, scale: 0.98, y: 4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-center gap-3 my-3.5 select-none"
                          >
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
                          </motion.div>
                        );
                      }

                      const { msg, index: idx } = item;
                      const isOutbound = msg.sender === "bot" || msg.sender === "agent";
                      const isAgent = msg.sender === "agent";
                      const isBot = msg.sender === "bot";
                      const agentInfo = isAgent ? resolveAgentSenderInfo(msg, selectedSession) : null;

                      return (
                        <motion.div
                          key={`${selectedSession.id}-${item.id}`}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.16, delay: Math.min(idx * 0.015, 0.2) }}
                          className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
                        >
                          {/* Avatar do Cliente (Esquerda) */}
                          {msg.sender === "client" && (
                            selectedSession.contactAvatar ? (
                              <SystemTooltip content="Ver foto do cliente em tela cheia">
                                <button
                                  onClick={() => setPreviewModalImage({ url: selectedSession.contactAvatar!, title: selectedSession.contactName })}
                                  className="shrink-0 mr-2 self-end group cursor-pointer focus:outline-none"
                                >
                                  <img
                                    src={selectedSession.contactAvatar}
                                    alt={selectedSession.contactName}
                                    className="h-7 w-7 rounded-full object-cover border-2 border-primary/20 shadow-soft group-hover:scale-110 group-hover:border-primary transition duration-200"
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = "none";
                                    }}
                                  />
                                </button>
                              </SystemTooltip>
                            ) : (
                              <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary shrink-0 mr-2 self-end font-bold text-[10px] shadow-soft border border-primary/20">
                                {selectedSession.contactName[0]?.toUpperCase() || "C"}
                              </div>
                            )
                          )}

                          {/* Bolha da Mensagem */}
                          <div
                            className={`max-w-[75%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed shadow-soft transition-colors ${
                              isBot
                                ? "bg-primary text-primary-foreground rounded-br-[5px]"
                                : isAgent
                                ? "bg-primary-soft/75 border border-primary/25 text-foreground rounded-br-[5px]"
                                : "bg-muted border border-border text-foreground rounded-bl-[5px]"
                            }`}
                          >
                            {/* Cabeçalho discreto identificando o nome do Operador que enviou */}
                            {isAgent && agentInfo && (
                              <div className="flex items-center justify-between gap-2 mb-1 pb-1 border-b border-primary/15">
                                <span className="text-[10px] font-extrabold text-primary truncate">
                                  {agentInfo.name}
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
                                  {persona.name} · IA
                                </span>
                              </div>
                            )}

                            {(() => {
                              const text = msg.text || "";
                              let mediaUrl = msg.mediaUrl || null;
                              let mediaType = msg.mediaType || null;
                              let fileName = msg.fileName || null;

                              const lines = text.split(/\r?\n/);
                              const mediaTag = lines[0].trim();
                              const captionText = lines.slice(1).join("\n").trim();

                              if (mediaTag.startsWith("[MEDIA:")) {
                                const match = mediaTag.match(/^\[MEDIA:([a-zA-Z0-9]+)\]([^:]+)(?::(.+))?$/i);
                                if (match) {
                                  const type = match[1].toLowerCase();
                                  const mediaId = match[2].trim();
                                  const fn = match[3] ? match[3].trim() : null;

                                  mediaType = type === "sticker" ? "image" : type;
                                  mediaUrl = `/api/baileys/media?messageId=${mediaId}`;
                                  if (fn && !fileName) {
                                    fileName = fn;
                                  }
                                }
                              }

                              if (mediaUrl && mediaUrl.includes("/api/media/")) {
                                const mediaId = mediaUrl.split("/api/media/")[1]?.trim();
                                if (mediaId) {
                                  mediaUrl = `/api/baileys/media?messageId=${mediaId}`;
                                }
                              }

                              const isImage = mediaType === "image" || (mediaUrl && mediaUrl.match(/\.(jpeg|jpg|gif|png|webp)/i));
                              const isVideo = mediaType === "video" || (mediaUrl && mediaUrl.match(/\.(mp4|webm|mov|avi|mkv)/i));
                              const isAudio = mediaType === "audio" || (mediaUrl && mediaUrl.match(/\.(ogg|mp3|wav|m4a|opus)/i));
                              const isDoc = mediaType === "document" || (mediaUrl && mediaUrl.match(/\.(pdf|doc|docx|xls|xlsx|json|rar|zip)/i)) || text.match(/\.(pdf|doc|docx|xls|xlsx|json|rar|zip)/i);

                              if (isImage && mediaUrl) {
                                return (
                                  <div className="space-y-1 my-1">
                                    <button
                                      onClick={() => setPreviewModalImage({ url: mediaUrl!, title: "Imagem enviada no WhatsApp" })}
                                      className="overflow-hidden rounded-2xl border border-white/20 cursor-pointer block max-w-xs hover:opacity-95 transition shadow-soft group"
                                    >
                                      <img src={mediaUrl} alt="Imagem enviada" className="w-full max-h-56 object-cover rounded-2xl group-hover:scale-[1.02] transition duration-300" />
                                    </button>
                                    {captionText && <p className="text-[11px] whitespace-pre-wrap font-medium">{captionText}</p>}
                                    {!captionText && text && !text.startsWith("[MEDIA:") && <p className="text-[11px] whitespace-pre-wrap">{text}</p>}
                                  </div>
                                );
                              }

                              if (isVideo && mediaUrl) {
                                return (
                                  <div className="space-y-1 my-1">
                                    <div
                                      className="relative group max-w-xs rounded-2xl overflow-hidden border border-white/20 bg-black/10 cursor-pointer flex items-center justify-center shadow-soft"
                                      onClick={() => setPreviewModalImage({ url: mediaUrl!, title: "Vídeo enviado no WhatsApp" })}
                                    >
                                      <video src={mediaUrl} className="max-h-56 w-full object-contain rounded-2xl pointer-events-none" />
                                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/35 transition rounded-2xl">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-md backdrop-blur-xs transition group-hover:scale-110">
                                          <Play className="h-5 w-5 fill-slate-800 ml-0.5" />
                                        </div>
                                      </div>
                                    </div>
                                    {captionText && <p className="text-[11px] whitespace-pre-wrap font-medium">{captionText}</p>}
                                    {!captionText && text && !text.startsWith("[MEDIA:") && <p className="text-[11px] whitespace-pre-wrap">{text}</p>}
                                  </div>
                                );
                              }

                              if (isAudio && mediaUrl) {
                                return (
                                  <div className="space-y-1 py-0.5">
                                    <AudioPlayerBubble src={mediaUrl} isBot={isBot} />
                                    {captionText && <p className="text-[11px] whitespace-pre-wrap font-medium">{captionText}</p>}
                                    {!captionText && text && !text.startsWith("[MEDIA:") && <p className="text-[11px] whitespace-pre-wrap">{text}</p>}
                                  </div>
                                );
                              }

                              if (isDoc && mediaUrl) {
                                return (
                                  <div className="space-y-1 my-1">
                                    <a
                                      href={mediaUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={`flex items-center gap-3 p-2.5 rounded-2xl border transition decoration-none text-current ${
                                        isBot ? "bg-white/10 border-white/20 hover:bg-white/20" : "bg-black/5 border-black/10 hover:bg-black/10"
                                      }`}
                                    >
                                      <div className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${isBot ? "bg-white/20 text-white" : "bg-primary/20 text-primary"}`}>
                                        <FileText className="h-5 w-5" />
                                      </div>
                                      <div className="truncate flex-1">
                                        <p className="font-bold text-[11px] truncate">{fileName || "Documento.pdf"}</p>
                                        <p className="text-[9px] opacity-80 flex items-center gap-1 mt-0.5">
                                          <Download className="h-3 w-3 inline" /> Clique para abrir / baixar
                                        </p>
                                      </div>
                                    </a>
                                    {captionText && <p className="text-[11px] whitespace-pre-wrap font-medium">{captionText}</p>}
                                    {!captionText && text && !text.startsWith("[MEDIA:") && <p className="text-[11px] whitespace-pre-wrap">{text}</p>}
                                  </div>
                                );
                              }

                              return <span className="whitespace-pre-wrap break-words">{captionText || text}</span>;
                            })()}
                            <span
                              className={`block mt-1 text-[9px] ${
                                isBot ? "text-white/60" : "text-muted-foreground"
                              }`}
                            >
                              {msg.time}
                            </span>
                          </div>

                          {/* Avatar da IA (Direita — somente quando enviado pela IA) */}
                          {isBot && (
                            <SystemTooltip content={`Ver foto ${persona.gender === "female" ? "da" : "do"} ${persona.name} em tela cheia`}>
                              <button
                                onClick={() => setPreviewModalImage({ url: (document.documentElement.classList.contains("dark") ? persona.avatarDarkUrl : persona.avatarLightUrl) || persona.avatarUrl, title: `${persona.name} IA — ${persona.company}` })}
                                className="shrink-0 ml-2 self-end group cursor-pointer focus:outline-none"
                              >
                                <AiAvatar
                                  tenantId={tenant}
                                  className="h-7 w-7 rounded-full border-2 border-primary/30 shadow-soft group-hover:scale-110 group-hover:border-primary transition duration-200"
                                />
                              </button>
                            </SystemTooltip>
                          )}

                          {/* Avatar do Operador Humano (Direita — quando enviado por um operador) */}
                          {isAgent && agentInfo && (
                            <SystemTooltip content={agentInfo.name}>
                              {agentInfo.avatar ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewModalImage({
                                      url: agentInfo.avatar!,
                                      title: agentInfo.name,
                                    })
                                  }
                                  className="shrink-0 ml-2 self-end group cursor-pointer focus:outline-none"
                                >
                                  <img
                                    src={agentInfo.avatar}
                                    alt={agentInfo.name}
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
                                    {getOperatorInitials(agentInfo.name)}
                                  </div>
                                </button>
                              ) : (
                                <div className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft text-primary shrink-0 ml-2 self-end font-extrabold text-[10px] shadow-soft border-2 border-primary/30 select-none">
                                  {getOperatorInitials(agentInfo.name)}
                                </div>
                              )}
                            </SystemTooltip>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>

                  {selectedSession.outcome && selectedSession.outcome !== "in_progress" && (
                    <div className="flex justify-center mt-3 animate-fadeIn">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-primary-soft text-primary border border-primary/20">
                        <CheckCircle className="h-3 w-3 text-primary" />
                        {selectedSession.monitoring ? selectedSession.monitoring.label : selectedSession.outcome === "completed"
                          ? `Triagem Concluída${selectedSession.responsibleName ? ` · ${selectedSession.responsibleName}` : ""}`
                          : selectedSession.outcome === "transferred"
                          ? `Transferido para ${selectedSession.responsibleName || "Vendedor"}`
                          : selectedSession.outcome === "stopped"
                          ? "Atendimento Interrompido"
                          : selectedSession.outcome}
                      </span>
                    </div>
                  )}
                </div>
              </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-xs font-bold text-muted-foreground">Nenhuma conversa selecionada</p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">Selecione uma triagem na lista ao lado para acompanhar as mensagens em tempo real.</p>
            </div>
          )}
        </div>

        {/* ── PAINEL DIREITO — Dados Coletados Reais (Expandível / Minimizado por Padrão) ───────── */}
        <AnimatePresence>
          {isInfoPanelOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "26%", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="w-[26%] min-w-[270px] max-w-[340px] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft"
            >
              {selectedSession ? (
                (() => {
                  const mergedData = getMergedCollectedData(
                    selectedSession.collectedData,
                    tenant || "valem",
                    selectedSession,
                  );
                  const filledCount = Object.values(mergedData).filter((d) => d.status === "filled").length;
                  const totalCount = Object.keys(mergedData).length;
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
                      (!mergedData["CNPJ OU CPF"] || mergedData["CNPJ OU CPF"]?.status === "filled"));

                  return (
                    <>
                      <div className="px-4 py-3 border-b border-line shrink-0 flex items-center justify-between gap-2">
                        <div>
                          <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                            <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                            Dados Coletados
                          </h3>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {filledCount} de {totalCount} campos
                            {selectedSession.targetFunnel ? ` · ${selectedSession.targetFunnel}` : ""}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={handleStopValentina}
                                  disabled={isStoppingValentina || selectedSession.status === "abandoned" || selectedSession.outcome === "stopped"}
                                  className="text-[10px] font-extrabold text-primary hover:text-primary-hover bg-primary-soft hover:bg-primary-soft/80 border border-primary/20 px-2 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                >
                                  <Square className="h-2.5 w-2.5 text-primary fill-primary/30" />
                                  <span className="hidden sm:inline">{isStoppingValentina ? "Parando..." : `Parar ${persona.name}`}</span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                Interromper instantaneamente as ações {persona.gender === "female" ? "da" : "do"} {persona.name} para este contato
                              </TooltipContent>
                            </Tooltip>

                            {/* Botão "Abrir" com Mini Pop-up Personalizado do Sistema */}
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
                                    className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-card border border-border shadow-2xl p-2 z-50 select-none"
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

                                      <motion.button
                                        type="button"
                                        whileHover={{ x: 2 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => handleOpenLinkedCardFromPopup(selectedSession)}
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
                                            {selectedSession.linkedDeal?.dealTitle
                                              ? `Card: ${selectedSession.linkedDeal.dealTitle}`
                                              : "Ver card vinculado a esta triagem em específico"}
                                          </p>
                                        </div>
                                      </motion.button>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => setIsInfoPanelOpen(false)}
                                  className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer shrink-0"
                                >
                                  <PanelRightClose className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">Minimizar</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 scrollbar-thin">
                        {tenant === "tecfag" && knownCompany && (
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
                            <p className="text-[11px] font-extrabold text-foreground truncate" title={knownCompany}>
                              {knownCompany}
                            </p>
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
                            <p className={`text-xs font-bold ${
                              data.status === "filled" ? "text-foreground" : "text-muted-foreground/40 italic"
                            }`}>
                              {data.status === "filled" ? data.value : "Aguardando..."}
                            </p>
                          </div>
                        ))}
                      </div>

                      {selectedSession.monitoring && <IndustrialMonitoringPanel monitoring={selectedSession.monitoring} />}
                      {/* ── SEÇÃO NEGOCIAÇÃO CRM LOCAL + RESPONSÁVEL (RODÍZIO ALOCADO) ── */}
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
                                {selectedSession.linkedDeal
                                  ? selectedSession.linkedDeal.action === "reused_within_3h"
                                    ? "Vinculado (< 3h)"
                                    : selectedSession.linkedDeal.action === "created_new" ? "Criado neste ciclo" : "Vinculado"
                                  : "Ao Transferir (3h)"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-1 mt-0.5">
                              <p className="text-xs font-extrabold text-foreground truncate group-hover:text-primary transition">
                                {selectedSession.linkedDeal?.dealTitle ||
                                  `${selectedSession.contactName} — ${selectedSession.targetFunnel || "Em Triagem"}`}
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
                                  ? selectedSession.monitoring.operatorId ? "Atribuído" : "Sem atribuição"
                                  : selectedSession.status === "completed" ? "Alocado" : "Pendente"}
                            </span>
                          </div>
                          <p className="text-xs font-extrabold text-foreground mt-0.5">
                            {selectedSession.responsibleName || `${persona.name} IA (Em Triagem)`}
                          </p>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-primary" />
                            Início: {selectedSession.startedAt ? new Date(selectedSession.startedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—"}
                          </span>
                          <span className="flex items-center gap-1 truncate max-w-[140px]">
                            <ChevronRight className="h-3 w-3 text-primary" />
                            Etapa: <span className="font-bold text-foreground truncate">{selectedSession.currentStep || "—"}</span>
                          </span>
                        </div>
                      </div>
                    </>
                  );
                })()
              ) : (
                <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                  <div className="flex items-center justify-between w-full px-4 py-2 border-b border-line mb-4">
                    <span className="text-xs font-bold text-foreground">Informações</span>
                    <button
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
        </div>
      </div>

      {/* ── MODAL DE VISUALIZAÇÃO EM TELA CHEIA DA FOTO DE PERFIL ────────── */}
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
                  onClick={() => setPreviewModalImage(null)}
                  className="absolute top-4 right-4 p-2 rounded-full bg-muted/80 hover:bg-muted text-foreground transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </SystemTooltip>

              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                <h3 className="text-xs font-extrabold text-foreground">{previewModalImage.title}</h3>
              </div>

              <div className="relative rounded-2xl overflow-hidden border-2 border-primary/30 shadow-xl bg-black/40 p-1 max-h-[70vh] flex items-center justify-center w-full">
                {previewModalImage.url.match(/\.(mp4|webm|mov|avi|mkv)/i) || previewModalImage.title.toLowerCase().includes("vídeo") ? (
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

              <p className="text-[10px] text-muted-foreground">Clique fora ou no X para fechar a visualização.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
