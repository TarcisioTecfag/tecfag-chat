import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Search,
  ChevronDown,
  ChevronUp,
  Smile,
  Frown,
  Meh,
  PhoneOutgoing,
  PhoneIncoming,
  RefreshCw,
  Volume2,
} from 'lucide-react'
import { VoiceAudioPlayer } from './VoiceAudioPlayer'

// ─────────────────────────── TIPOS ───────────────────────────

interface ElevenLabsConversation {
  conversation_id: string
  start_time_unix_secs: number
  call_duration_secs: number
  status: string
  termination_reason: string | null
  call_summary_title: string | null
  direction: 'outbound' | 'inbound' | null
  sentiment_analysis: {
    overall_label: 'positive' | 'neutral' | 'negative'
    overall_sentiment_score: number
  } | null
}

interface TranscriptMessage {
  role: 'user' | 'agent'
  message: string
  time_in_call_secs: number
}

interface ConversationDetail {
  conversation_id: string
  transcript: TranscriptMessage[]
  sentiment_analysis: {
    overall_label: 'positive' | 'neutral' | 'negative'
    overall_sentiment_score: number
  } | null
  call_duration_secs: number
  has_audio: boolean
}

// ─────────────────────────── HELPERS ─────────────────────────

function formatDuration(secs: number): string {
  if (!secs || secs < 0) return '0s'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function formatDateTime(unixSecs: number): string {
  const date = new Date(unixSecs * 1000)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (d.getTime() === today.getTime()) return `Hoje, ${timeStr}`
  if (d.getTime() === yesterday.getTime()) return `Ontem, ${timeStr}`
  return (
    date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ` ${timeStr}`
  )
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ─────────────────────────── COMPONENTE ──────────────────────

export function HistoricoTab({ tenantId = 'valem' }: { tenantId?: string }) {
  const [conversations, setConversations] = useState<ElevenLabsConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedDetail, setExpandedDetail] = useState<Record<string, ConversationDetail>>({})
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null)
  const [audioTimes, setAudioTimes] = useState<Record<string, number>>({})

  // ── Busca inicial ────────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/elevenlabs-conversations?tenantId=${tenantId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setConversations(data.conversations ?? data ?? [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setLoadError(msg)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  // ── Lazy-load detalhe ────────────────────────────────────────
  const fetchDetail = useCallback(
    async (conversationId: string): Promise<ConversationDetail | null> => {
      try {
        const res = await fetch(
          `/api/elevenlabs-conversations?tenantId=${tenantId}&id=${conversationId}`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json()
      } catch {
        return null
      }
    },
    [tenantId]
  )

  const handleExpand = useCallback(
    async (convId: string) => {
      if (expandedId === convId) {
        setExpandedId(null)
        return
      }
      setExpandedId(convId)
      if (!expandedDetail[convId]) {
        setLoadingDetail(convId)
        const detail = await fetchDetail(convId)
        if (detail) {
          setExpandedDetail((prev) => ({ ...prev, [convId]: detail }))
        }
        setLoadingDetail(null)
      }
    },
    [expandedId, expandedDetail, fetchDetail]
  )

  // ── Filtro ───────────────────────────────────────────────────
  const filtered = conversations.filter((c) => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (c.call_summary_title ?? '').toLowerCase().includes(term)
  })

  // ── Helpers de render ────────────────────────────────────────
  const sentimentIcon = (label: 'positive' | 'neutral' | 'negative' | undefined) => {
    if (label === 'positive') return <Smile className="w-4 h-4 text-emerald-500" />
    if (label === 'negative') return <Frown className="w-4 h-4 text-rose-500" />
    return <Meh className="w-4 h-4 text-muted-foreground" />
  }

  const sentimentLabel = (label: 'positive' | 'neutral' | 'negative' | undefined) => {
    if (label === 'positive') return 'Positivo'
    if (label === 'negative') return 'Negativo'
    return 'Neutro'
  }

  const sentimentColor = (label: 'positive' | 'neutral' | 'negative' | undefined) => {
    if (label === 'positive') return 'text-emerald-600 dark:text-emerald-400'
    if (label === 'negative') return 'text-rose-600 dark:text-rose-400'
    return 'text-muted-foreground'
  }

  const statusLabel = (termination_reason: string | null, status: string) => {
    if (termination_reason === 'agent_ended') return 'IA Finalizou'
    if (termination_reason === 'user_ended') return 'Encerrada pelo cliente'
    if (termination_reason === 'timeout') return 'Timeout'
    if (termination_reason === 'error') return 'Erro'
    return status ?? 'Desconhecido'
  }

  const statusBadgeColor = (termination_reason: string | null) => {
    if (termination_reason === 'agent_ended')
      return 'bg-primary/10 text-primary border border-primary/20'
    if (termination_reason === 'user_ended')
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
    if (termination_reason === 'error')
      return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
    return 'bg-muted/50 text-muted-foreground border border-border'
  }

  // ─────────────────────────── JSX ─────────────────────────────

  return (
    <div className="flex flex-col gap-6 overflow-y-auto h-full pr-1">

      {/* ── Barra de pesquisa ── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card border border-border rounded-2xl p-4 shadow-soft">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por resumo da ligação..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-muted/40 border border-border rounded-xl pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>

        <button
          onClick={fetchConversations}
          disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-card border border-border hover:bg-muted rounded-xl text-xs font-semibold text-foreground transition cursor-pointer shadow-soft disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-primary ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* ── Estado de carregamento / erro ── */}
      {loading && (
        <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground text-xs">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Carregando histórico de ligações...
        </div>
      )}

      {!loading && loadError && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-5 text-xs text-rose-600 dark:text-rose-400">
          Erro ao carregar conversas: {loadError}
        </div>
      )}

      {!loading && !loadError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground text-xs">
          <Volume2 className="w-8 h-8 opacity-30" />
          {searchTerm
            ? 'Nenhuma ligação encontrada para essa busca.'
            : 'Nenhuma ligação registrada.'}
        </div>
      )}

      {/* ── Lista de conversas ── */}
      {!loading && !loadError && (
        <div className="flex flex-col gap-4">
          {filtered.map((conv) => {
            const isExpanded = expandedId === conv.conversation_id
            const detail = expandedDetail[conv.conversation_id]
            const isLoadingDetail = loadingDetail === conv.conversation_id
            const currentAudioTime = audioTimes[conv.conversation_id] ?? 0
            const sentLabel = conv.sentiment_analysis?.overall_label

            return (
              <div
                key={conv.conversation_id}
                className="bg-card border border-border rounded-2xl overflow-hidden shadow-soft transition-colors"
              >
                {/* ── Cabeçalho do card ── */}
                <div
                  onClick={() => handleExpand(conv.conversation_id)}
                  className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary/10 text-primary border border-primary/20"
                    >
                      {conv.direction === 'inbound' ? (
                        <PhoneIncoming className="w-5 h-5" />
                      ) : (
                        <PhoneOutgoing className="w-5 h-5" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-foreground truncate">
                        {conv.call_summary_title ?? `Ligação ${conv.conversation_id.slice(-6)}`}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDateTime(conv.start_time_unix_secs)} •{' '}
                        {formatDuration(conv.call_duration_secs)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span
                      className={`px-3 py-1 text-[11px] font-bold rounded-lg ${statusBadgeColor(conv.termination_reason)}`}
                    >
                      {statusLabel(conv.termination_reason, conv.status)}
                    </span>

                    <div
                      className={`flex items-center gap-1 text-xs font-medium ${sentimentColor(sentLabel)}`}
                    >
                      {sentimentIcon(sentLabel)}
                      {sentimentLabel(sentLabel)}
                    </div>

                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* ── Painel expandido ── */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-5 flex flex-col gap-5">

                    {isLoadingDetail && (
                      <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-xs">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Carregando transcrição...
                      </div>
                    )}

                    {!isLoadingDetail && detail && (
                      <>
                        {/* ── Cards de métricas ── */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-card border border-border rounded-xl p-3 text-center shadow-soft">
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                              Duração
                            </p>
                            <p className="text-sm font-bold text-foreground mt-1">
                              {formatDuration(detail.call_duration_secs)}
                            </p>
                          </div>

                          <div className="bg-card border border-border rounded-xl p-3 text-center shadow-soft">
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                              Sentimento
                            </p>
                            <div
                              className={`flex items-center justify-center gap-1 mt-1 text-sm font-bold ${sentimentColor(detail.sentiment_analysis?.overall_label)}`}
                            >
                              {sentimentIcon(detail.sentiment_analysis?.overall_label)}
                              {sentimentLabel(detail.sentiment_analysis?.overall_label)}
                            </div>
                          </div>

                          <div className="bg-card border border-border rounded-xl p-3 text-center shadow-soft">
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                              Turnos
                            </p>
                            <p className="text-sm font-bold text-foreground mt-1">
                              {detail.transcript?.length ?? 0}
                            </p>
                          </div>

                          <div className="bg-card border border-border rounded-xl p-3 text-center shadow-soft">
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                              Encerramento
                            </p>
                            <p className="text-sm font-bold text-foreground mt-1 truncate">
                              {statusLabel(conv.termination_reason, conv.status)}
                            </p>
                          </div>
                        </div>

                        {/* ── Player de áudio customizado ── */}
                        {detail.has_audio && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 pl-1">
                              <Volume2 className="w-3.5 h-3.5 text-primary" />
                              Áudio da ligação
                            </p>
                            <VoiceAudioPlayer
                              src={`/api/elevenlabs-conversations?tenantId=${tenantId}&id=${conv.conversation_id}&audio=true`}
                              onTimeUpdate={(currentTime) =>
                                setAudioTimes((prev) => ({
                                  ...prev,
                                  [conv.conversation_id]: currentTime,
                                }))
                              }
                            />
                          </div>
                        )}

                        {/* ── Transcript sincronizado ── */}
                        {detail.transcript && detail.transcript.length > 0 && (
                          <div>
                            <h5 className="text-xs font-bold text-foreground mb-3 flex items-center gap-2">
                              <Volume2 className="w-4 h-4 text-muted-foreground" />
                              Transcrição Completa
                            </h5>

                            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
                              {detail.transcript.map((msg, idx) => {
                                const nextMsg = detail.transcript[idx + 1]
                                const isActive =
                                  msg.time_in_call_secs <= currentAudioTime &&
                                  (nextMsg
                                    ? nextMsg.time_in_call_secs > currentAudioTime
                                    : true)

                                return (
                                  <div
                                    key={idx}
                                    className={`p-3 rounded-xl transition-colors ${
                                      isActive
                                        ? 'bg-primary/10 border border-primary/30'
                                        : msg.role === 'user'
                                        ? 'bg-muted/30'
                                        : 'bg-card border border-border'
                                    }`}
                                  >
                                    <span
                                      className={`text-[10px] font-bold ${
                                        msg.role === 'user' ? 'text-blue-500' : 'text-primary'
                                      }`}
                                    >
                                      {msg.role === 'user' ? 'CLIENTE' : 'VALENTINA'}
                                      <span className="text-muted-foreground font-normal ml-2">
                                        {formatTime(msg.time_in_call_secs)}
                                      </span>
                                    </span>
                                    <p className="text-xs text-foreground mt-0.5 leading-relaxed">
                                      {msg.message}
                                    </p>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {(!detail.transcript || detail.transcript.length === 0) && (
                          <p className="text-xs text-muted-foreground text-center py-4">
                            Transcrição não disponível para esta ligação.
                          </p>
                        )}
                      </>
                    )}

                    {!isLoadingDetail && !detail && (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        Não foi possível carregar os detalhes desta ligação.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
