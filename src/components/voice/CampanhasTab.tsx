import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  Upload,
  Play,
  Pause,
  Square,
  FileSpreadsheet,
  CheckCircle2,
  Clock,
  PhoneCall,
  Download,
  XCircle,
  RefreshCw,
  AlertCircle,
  Target,
  Phone,
  Sparkles,
} from 'lucide-react'

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface ObjectiveItem {
  id: string
  name: string
  emoji: string
  description?: string
  isActive: boolean
}

interface LeadItem {
  id?: string
  name: string
  phone: string
  company: string
  productInterest: string
  status: 'pending' | 'calling' | 'done' | 'no-answer' | 'failed'
  attempts: number
}

interface Campaign {
  id?: string
  name: string
  status: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled'
  leads: LeadItem[]
  intervalSeconds: number
  objectiveId?: string | null
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

const parseCSV = (text: string): LeadItem[] => {
  const lines = text.trim().split('\n')
  if (lines.length < 2) throw new Error('CSV vazio ou sem dados')

  const headers = lines[0]
    .split(',')
    .map(h =>
      h
        .trim()
        .toLowerCase()
        .replace(/[àáâã]/g, 'a')
        .replace(/[èéê]/g, 'e')
        .replace(/[ìí]/g, 'i')
        .replace(/[òóôõ]/g, 'o')
        .replace(/[ùú]/g, 'u')
        .replace(/\s+/g, '_'),
    )

  const getCol = (row: string[], keys: string[]): string => {
    for (const key of keys) {
      const idx = headers.indexOf(key)
      if (idx >= 0) return row[idx]?.trim() ?? ''
    }
    return ''
  }

  return lines
    .slice(1)
    .filter(l => l.trim())
    .map(line => {
      const cols = line.split(',')
      return {
        name: getCol(cols, ['nome', 'name', 'cliente']),
        phone: getCol(cols, ['telefone', 'phone', 'cel', 'celular', 'fone']),
        company: getCol(cols, ['empresa', 'company', 'razao_social']),
        productInterest: getCol(cols, [
          'produto',
          'product',
          'interesse',
          'product_interest',
        ]),
        status: 'pending' as const,
        attempts: 0,
      }
    })
    .filter(l => l.phone)
}

// ─── Template CSV Download ────────────────────────────────────────────────────

const downloadTemplate = () => {
  const csv =
    'nome,telefone,empresa,produto\nJoao Silva,5514999990000,Empresa ABC,Valvulas Aerosol'
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'template_campanha_valentina.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: LeadItem['status'] }) {
  if (status === 'done')
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 className="w-3 h-3" /> Concluído
      </span>
    )
  if (status === 'calling')
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-lg bg-primary/20 text-primary border border-primary/40 animate-pulse">
        <PhoneCall className="w-3 h-3" /> Discando...
      </span>
    )
  if (status === 'pending')
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-lg bg-muted text-muted-foreground border border-border">
        <Clock className="w-3 h-3" /> Aguardando
      </span>
    )
  if (status === 'no-answer')
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
        <AlertCircle className="w-3 h-3" /> Sem Resposta
      </span>
    )
  if (status === 'failed')
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20">
        <XCircle className="w-3 h-3" /> Falhou
      </span>
    )
  return null
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CampanhasTab({ tenantId = 'valem' }: { tenantId?: string }) {
  const [campaignName, setCampaignName] = useState('Nova Campanha')
  const [leads, setLeads] = useState<LeadItem[]>([])
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [campaignStatus, setCampaignStatus] =
    useState<Campaign['status']>('idle')
  const [intervalSeconds, setIntervalSeconds] = useState(30)
  const [isPaused, setIsPaused] = useState(false)
  const [fileUploaded, setFileUploaded] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [objectives, setObjectives] = useState<ObjectiveItem[]>([])
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string>('')

  // ─── Estado do Disparo Individual ──────────────────────────────────────────
  const [singlePhone, setSinglePhone] = useState('')
  const [singleObjectiveId, setSingleObjectiveId] = useState('')
  const [singleCalling, setSingleCalling] = useState(false)
  const [singleCallResult, setSingleCallResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  // ref para controle do loop async sem re-render
  const isPausedRef = useRef(false)

  // ─── Carregar Objetivos da Valentina ─────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/voice-objectives?tenantId=${tenantId}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.objectives)) {
          setObjectives(data.objectives.filter((o: any) => o.isActive))
        }
      })
      .catch(() => {})
  }, [tenantId])

  // ─── Handler de Disparo Individual ─────────────────────────────────────────
  const handleSingleCall = async () => {
    const cleanPhone = singlePhone.replace(/\D/g, '')
    if (cleanPhone.length < 10) {
      setSingleCallResult({
        success: false,
        message: 'Digite um número válido com DDD (ex: 14998887766)',
      })
      return
    }

    setSingleCalling(true)
    setSingleCallResult(null)

    try {
      const res = await fetch('/api/trigger-outbound-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: singlePhone,
          tenantId,
          objectiveId: singleObjectiveId || undefined,
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setSingleCallResult({
          success: true,
          message: `Ligação iniciada com sucesso para ${singlePhone}!`,
        })
        setSinglePhone('')
      } else {
        setSingleCallResult({
          success: false,
          message: data.message || data.error || 'Erro ao disparar ligação.',
        })
      }
    } catch (err: any) {
      setSingleCallResult({
        success: false,
        message: err?.message || 'Falha de conexão com o servidor.',
      })
    } finally {
      setSingleCalling(false)
    }
  }

  // ─── CSV File Handler ───────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(null)
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const text = ev.target?.result as string
        const parsed = parseCSV(text)
        setLeads(parsed)
        setFileUploaded(true)
      } catch (err: any) {
        setParseError(err.message)
      }
    }
    reader.readAsText(file, 'UTF-8')
    // Reset input para permitir re-upload do mesmo arquivo
    e.target.value = ''
  }

  // ─── Loop de Chamadas para Leads Pendentes ──────────────────────────────────

  const runLeadsLoop = useCallback(
    async (pendingLeads: LeadItem[]) => {
      for (const lead of pendingLeads) {
        if (isPausedRef.current) break

        // Marca como discando
        setLeads(prev =>
          prev.map(l =>
            l.phone === lead.phone ? { ...l, status: 'calling' } : l,
          ),
        )

        try {
          await fetch('/api/trigger-outbound-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: lead.phone,
              tenantId,
              objectiveId: selectedObjectiveId || undefined,
            }),
          })
          setLeads(prev =>
            prev.map(l =>
              l.phone === lead.phone
                ? { ...l, status: 'done', attempts: l.attempts + 1 }
                : l,
            ),
          )
        } catch {
          setLeads(prev =>
            prev.map(l =>
              l.phone === lead.phone
                ? { ...l, status: 'failed', attempts: l.attempts + 1 }
                : l,
            ),
          )
        }

        // Aguarda intervalo antes da próxima chamada (se não pausado)
        if (!isPausedRef.current) {
          await new Promise<void>(resolve =>
            setTimeout(resolve, intervalSeconds * 1000),
          )
        }
      }

      if (!isPausedRef.current) {
        setCampaignStatus('completed')
      }
    },
    [intervalSeconds, tenantId, selectedObjectiveId],
  )

  // ─── Criar Campanha + Iniciar Loop ─────────────────────────────────────────

  const createAndRun = async () => {
    try {
      const res = await fetch('/api/voice-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          name: campaignName,
          intervalSeconds,
          leads,
          objectiveId: selectedObjectiveId || undefined,
        }),
      })
      const { id: newCampaignId, leads: savedLeads } = await res.json()
      setCampaignId(newCampaignId)
      if (savedLeads) setLeads(savedLeads)

      setCampaignStatus('running')
      isPausedRef.current = false
      setIsPaused(false)

      const toRun: LeadItem[] = savedLeads ?? leads.filter(l => l.status === 'pending')
      await runLeadsLoop(toRun)
    } catch (err) {
      console.error('[CampanhasTab] createAndRun error:', err)
    }
  }

  // ─── Retomar: roda apenas os leads ainda pendentes ─────────────────────────

  const runRemainingLeads = useCallback(async () => {
    const remaining = leads.filter(l => l.status === 'pending')
    await runLeadsLoop(remaining)
  }, [leads, runLeadsLoop])

  // ─── Controles de Campanha ─────────────────────────────────────────────────

  const handlePause = () => {
    isPausedRef.current = true
    setIsPaused(true)
    setCampaignStatus('paused')
  }

  const handleResume = () => {
    isPausedRef.current = false
    setIsPaused(false)
    setCampaignStatus('running')
    runRemainingLeads()
  }

  const handleStop = async () => {
    isPausedRef.current = true
    setCampaignStatus('cancelled')
    if (campaignId) {
      await fetch('/api/voice-campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, campaignId, status: 'cancelled' }),
      })
    }
  }

  const handleReset = () => {
    isPausedRef.current = true
    setLeads([])
    setCampaignId(null)
    setCampaignStatus('idle')
    setIsPaused(false)
    setFileUploaded(false)
    setParseError(null)
    setCampaignName('Nova Campanha')
  }

  // ─── Métricas ──────────────────────────────────────────────────────────────

  const totalLeads = leads.length
  const doneLeads = leads.filter(l => l.status === 'done').length
  const failedLeads = leads.filter(
    l => l.status === 'failed' || l.status === 'no-answer',
  ).length
  const progressPct = totalLeads > 0 ? Math.round((doneLeads / totalLeads) * 100) : 0

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 overflow-y-auto h-full pr-1">
      {/* ── SEÇÃO DE DISPARO INDIVIDUAL (LIGAÇÃO AVULSA) ────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Phone className="w-4 h-4 text-primary" />
              Disparo Individual de Ligação IA
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Dispare uma ligação imediata da Valentina para um número específico com o objetivo desejado.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Número de Telefone
            </label>
            <input
              type="text"
              value={singlePhone}
              onChange={e => setSinglePhone(e.target.value)}
              placeholder="Ex: (14) 99888-7766 ou 5514998887766"
              className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Target className="w-3 h-3 text-primary" />
              Objetivo da Valentina
            </label>
            <select
              value={singleObjectiveId}
              onChange={e => setSingleObjectiveId(e.target.value)}
              className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
            >
              <option value="">Padrão (SDR Comercial Geral)</option>
              {objectives.map(obj => (
                <option key={obj.id} value={obj.id}>
                  {obj.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSingleCall}
            disabled={singleCalling || !singlePhone.trim()}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:opacity-90 disabled:opacity-50 text-primary-foreground rounded-xl text-xs font-semibold cursor-pointer transition shadow-soft h-[36px]"
          >
            {singleCalling ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Discando...
              </>
            ) : (
              <>
                <PhoneCall className="w-3.5 h-3.5" />
                Disparar Ligação Agora
              </>
            )}
          </button>
        </div>

        {singleCallResult && (
          <div
            className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${
              singleCallResult.success
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 border border-rose-500/20 text-rose-500'
            }`}
          >
            {singleCallResult.success ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            {singleCallResult.message}
          </div>
        )}
      </div>

      {/* ── Cabeçalho e Upload / Configuração da Campanha em Massa ─────── */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="text-base font-bold text-foreground">
              Disparo em Massa de Ligações IA
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Importe um CSV com contatos para a Valentina discar
              automaticamente em sequência.
            </p>
          </div>
          {/* Botão download template sempre visível */}
          <button
            onClick={downloadTemplate}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted-foreground border border-border bg-muted/40 hover:bg-muted rounded-xl transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Template CSV
          </button>
        </div>

        {/* ── ETAPA 1: idle sem upload ─────────────────────────────────────── */}
        {campaignStatus === 'idle' && !fileUploaded && (
          <div className="flex flex-col gap-4 mt-4">
            {/* Campos de configuração */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Nome da Campanha
                </label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                  placeholder="Ex: Campanha Agosto 2026"
                  className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Target className="w-3 h-3 text-primary" />
                  Objetivo da Valentina
                </label>
                <select
                  value={selectedObjectiveId}
                  onChange={e => setSelectedObjectiveId(e.target.value)}
                  className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
                >
                  <option value="">Padrão (SDR Comercial Geral)</option>
                  {objectives.map(obj => (
                    <option key={obj.id} value={obj.id}>
                      {obj.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Intervalo entre ligações
                </label>
                <select
                  value={intervalSeconds}
                  onChange={e => setIntervalSeconds(Number(e.target.value))}
                  className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={15}>15 segundos</option>
                  <option value={30}>30 segundos</option>
                  <option value={60}>60 segundos</option>
                  <option value={120}>120 segundos</option>
                </select>
              </div>
            </div>

            {/* Drop zone de upload */}
            <div className="border-2 border-dashed border-border hover:border-primary/50 rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-3 transition-colors bg-muted/20">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">
                  Arraste seu arquivo CSV ou clique para selecionar
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Colunas: <span className="font-mono">nome, telefone, empresa, produto</span>
                </p>
              </div>
              <label className="px-4 py-2 bg-primary hover:opacity-90 text-primary-foreground rounded-xl text-xs font-semibold cursor-pointer transition shadow-soft mt-1 flex items-center gap-2">
                <Upload className="w-3.5 h-3.5" />
                Selecionar Planilha CSV
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            {/* Erro de parse */}
            {parseError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-medium">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* ── ETAPA 1b: idle com upload → Preview + Iniciar ───────────────── */}
        {campaignStatus === 'idle' && fileUploaded && (
          <div className="flex flex-col gap-4 mt-4">
            {/* Configurações resumidas */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Nome da Campanha
                </label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                  className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Target className="w-3 h-3 text-primary" />
                  Objetivo da Valentina
                </label>
                <select
                  value={selectedObjectiveId}
                  onChange={e => setSelectedObjectiveId(e.target.value)}
                  className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
                >
                  <option value="">Padrão (SDR Comercial Geral)</option>
                  {objectives.map(obj => (
                    <option key={obj.id} value={obj.id}>
                      {obj.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Intervalo entre ligações
                </label>
                <select
                  value={intervalSeconds}
                  onChange={e => setIntervalSeconds(Number(e.target.value))}
                  className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={15}>15 segundos</option>
                  <option value={30}>30 segundos</option>
                  <option value={60}>60 segundos</option>
                  <option value={120}>120 segundos</option>
                </select>
              </div>
            </div>

            {/* Info do arquivo + trocar */}
            <div className="flex items-center justify-between px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                {totalLeads} lead{totalLeads !== 1 ? 's' : ''} importado
                {totalLeads !== 1 ? 's' : ''} com sucesso
              </div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition">
                <RefreshCw className="w-3.5 h-3.5" />
                Trocar arquivo
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            {/* Botão iniciar */}
            <button
              onClick={createAndRun}
              disabled={totalLeads === 0}
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold shadow-soft transition cursor-pointer"
            >
              <Play className="w-4 h-4" />
              Iniciar Campanha ({totalLeads} leads)
            </button>
          </div>
        )}

        {/* ── ETAPA 2: running / paused → Barra de progresso + controles ──── */}
        {(campaignStatus === 'running' || campaignStatus === 'paused') && (
          <div className="flex flex-col gap-4 mt-4">
            {/* Barra de progresso */}
            <div className="bg-muted/30 border border-border rounded-2xl p-4">
              <div className="flex justify-between text-xs font-semibold text-foreground mb-2">
                <span>
                  {campaignStatus === 'running' ? '📞 Campanha em execução…' : '⏸ Campanha pausada'}
                </span>
                <span>
                  {doneLeads} / {totalLeads} ({progressPct}%)
                </span>
              </div>
              <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden border border-border">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Controles */}
            <div className="flex items-center gap-3 flex-wrap">
              {!isPaused ? (
                <button
                  onClick={handlePause}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  <Pause className="w-4 h-4" />
                  Pausar
                </button>
              ) : (
                <button
                  onClick={handleResume}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-soft transition cursor-pointer"
                >
                  <Play className="w-4 h-4" />
                  Retomar
                </button>
              )}
              <button
                onClick={handleStop}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-xl text-xs font-semibold transition cursor-pointer shadow-soft"
              >
                <Square className="w-3.5 h-3.5 text-rose-500" />
                Parar Campanha
              </button>
              <span className="text-[11px] text-muted-foreground ml-auto">
                Intervalo: {intervalSeconds}s entre ligações
              </span>
            </div>
          </div>
        )}

        {/* ── ETAPA 3: completed / cancelled → Resumo ─────────────────────── */}
        {(campaignStatus === 'completed' || campaignStatus === 'cancelled') && (
          <div className="flex flex-col gap-4 mt-4">
            <div
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${
                campaignStatus === 'completed'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
              }`}
            >
              {campaignStatus === 'completed' ? (
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="text-sm font-bold">
                  {campaignStatus === 'completed'
                    ? 'Campanha concluída!'
                    : 'Campanha cancelada'}
                </p>
                <p className="text-[11px] opacity-80 mt-0.5">
                  {doneLeads} concluída{doneLeads !== 1 ? 's' : ''} · {failedLeads} falha
                  {failedLeads !== 1 ? 's' : ''} · {totalLeads} total
                </p>
              </div>
            </div>

            {/* Cards de resumo */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{totalLeads}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">
                  Total
                </p>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {doneLeads}
                </p>
                <p className="text-[10px] text-emerald-600/70 mt-0.5 uppercase tracking-wide">
                  Sucesso
                </p>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-rose-500">{failedLeads}</p>
                <p className="text-[10px] text-rose-500/70 mt-0.5 uppercase tracking-wide">
                  Falhas
                </p>
              </div>
            </div>

            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 py-2 px-4 bg-muted hover:bg-muted/80 border border-border text-foreground rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Nova Campanha
            </button>
          </div>
        )}
      </div>

      {/* ── Tabela de Leads ────────────────────────────────────────────────── */}
      {leads.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft">
          <h4 className="text-sm font-bold text-foreground mb-3">
            Leads na Fila ({leads.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-foreground">
              <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border">
                <tr>
                  <th className="p-3 font-semibold">Nome / Empresa</th>
                  <th className="p-3 font-semibold">Telefone</th>
                  <th className="p-3 font-semibold">Produto / Interesse</th>
                  <th className="p-3 font-semibold text-center">Tentativas</th>
                  <th className="p-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((lead, idx) => (
                  <tr
                    key={lead.id ?? `${lead.phone}-${idx}`}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="p-3 font-bold text-foreground">
                      {lead.name || '—'}
                      {lead.company && (
                        <span className="block text-[11px] text-muted-foreground font-normal">
                          {lead.company}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-foreground font-mono">{lead.phone}</td>
                    <td className="p-3 text-foreground">
                      {lead.productInterest || '—'}
                    </td>
                    <td className="p-3 text-muted-foreground text-center">
                      {lead.attempts}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={lead.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
