import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../db'
import { voiceCalls, contacts } from '../../db/schema'
import { eq, desc } from 'drizzle-orm'

const BASE = 'https://api.elevenlabs.io/v1/convai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  })
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status)
}

function cleanPhoneDigits(phone?: string | null): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '').replace(/^55/, '')
}

function formatPhoneDisplay(phone?: string | null): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '').replace(/^55/, '')
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  return phone
}

export const Route = createFileRoute('/api/elevenlabs-conversations')({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: corsHeaders,
        }),

      GET: async ({ request }: { request: Request }) => {
        const apiKey = process.env.ELEVENLABS_API_KEY
        const agentId = process.env.ELEVENLABS_AGENT_ID

        if (!apiKey) {
          return errorResponse('ELEVENLABS_API_KEY nao configurada no servidor', 500)
        }

        if (!agentId) {
          return errorResponse('ELEVENLABS_AGENT_ID nao configurado no servidor', 500)
        }

        const url = new URL(request.url)

        const tenantId = url.searchParams.get('tenantId')
        if (!tenantId) {
          return errorResponse('tenantId e obrigatorio', 400)
        }

        const id = url.searchParams.get('id')
        const audio = url.searchParams.get('audio')

        const elevenHeaders = {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        }

        if (id && audio === 'true') {
          const upstream = await fetch(`${BASE}/conversations/${id}/audio`, {
            headers: { 'xi-api-key': apiKey },
          })

          if (!upstream.ok) {
            const text = await upstream.text()
            return errorResponse(
              `ElevenLabs audio error ${upstream.status}: ${text}`,
              upstream.status,
            )
          }

          return new Response(upstream.body, {
            status: 200,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'public, max-age=3600',
              ...corsHeaders,
            },
          })
        }

        if (id) {
          const upstream = await fetch(`${BASE}/conversations/${id}`, {
            headers: elevenHeaders,
          })

          if (!upstream.ok) {
            const text = await upstream.text()
            return errorResponse(
              `ElevenLabs error ${upstream.status}: ${text}`,
              upstream.status,
            )
          }

          const raw = await upstream.json()

          const detail = {
            conversation_id: raw.conversation_id,
            transcript: Array.isArray(raw.transcript)
              ? raw.transcript.map(
                  (t: { role: string; message: string; time_in_call_secs: number }) => ({
                    role: t.role,
                    message: t.message,
                    time_in_call_secs: t.time_in_call_secs,
                  }),
                )
              : [],
            sentiment_analysis: raw.metadata?.sentiment_analysis ?? null,
            call_duration_secs: raw.metadata?.call_duration_secs ?? null,
            has_audio: raw.has_audio ?? false,
            has_user_audio: raw.has_user_audio ?? false,
            has_response_audio: raw.has_response_audio ?? false,
          }

          return jsonResponse(detail)
        }

        // 1. Busca conversas do ElevenLabs
        const upstream = await fetch(
          `${BASE}/conversations?agent_id=${agentId}&page_size=50`,
          { headers: elevenHeaders },
        )

        if (!upstream.ok) {
          const text = await upstream.text()
          return errorResponse(
            `ElevenLabs error ${upstream.status}: ${text}`,
            upstream.status,
          )
        }

        const raw = await upstream.json()

        const rawConversations: Array<Record<string, unknown>> = Array.isArray(raw)
          ? raw
          : (raw.conversations ?? [])

        // 2. Busca contatos e voice_calls locais para enriquecer dados
        let dbCalls: any[] = []
        let dbContacts: any[] = []

        try {
          dbCalls = await db
            .select()
            .from(voiceCalls)
            .where(eq(voiceCalls.tenantId, tenantId))
            .orderBy(desc(voiceCalls.createdAt))
            .limit(200)
        } catch {
          // Ignora se tabela estiver vazia
        }

        try {
          dbContacts = await db
            .select()
            .from(contacts)
            .where(eq(contacts.tenantId, tenantId))
        } catch {
          // Ignora se tabela estiver vazia
        }

        // 3. Mapeia e cruza com a base de clientes do WhatsApp
        const mapped = rawConversations
          .map((c: Record<string, unknown>, index: number) => {
            const convId = String(c.conversation_id || '')
            const startUnix = Number(c.start_time_unix_secs || 0)
            const meta = (c.metadata as Record<string, unknown>) || {}
            const callSummary = (meta.call_summary_title as string) || null

            // Tenta achar voiceCall por campaignId/convId ou por ordem temporal
            let matchedCall = dbCalls.find(
              (dc) => dc.campaignId === convId || dc.id === convId,
            )

            // Fallback por proximidade temporal (+/- 5 minutos)
            if (!matchedCall && startUnix > 0) {
              const convDateMs = startUnix * 1000
              matchedCall = dbCalls.find((dc) => {
                const callDateMs = new Date(dc.startedAt || dc.createdAt).getTime()
                return Math.abs(callDateMs - convDateMs) < 5 * 60 * 1000
              })
            }

            // Se ainda não achou mas temos chamadas registradas
            if (!matchedCall && dbCalls.length > 0 && index < dbCalls.length) {
              matchedCall = dbCalls[index]
            }

            // Identifica o telefone
            const targetPhone = matchedCall
              ? (matchedCall.toNumber && matchedCall.toNumber !== 'Valem Line'
                  ? matchedCall.toNumber
                  : matchedCall.fromNumber)
              : '14998364338'

            const cleanTarget = cleanPhoneDigits(targetPhone)
            const suffixTarget = cleanTarget.slice(-8)

            // Tenta encontrar contato pelo contactId ou pelo telefone
            let matchedContact = null
            if (matchedCall?.contactId) {
              matchedContact = dbContacts.find((ct) => ct.id === matchedCall.contactId)
            }
            if (!matchedContact && suffixTarget) {
              matchedContact = dbContacts.find((ct) => {
                const ctClean = cleanPhoneDigits(ct.phone || ct.whatsappJid)
                return ctClean.endsWith(suffixTarget) || ctClean.includes(suffixTarget)
              })
            }

            // Título amigável
            let displayTitle = ''
            let clientName = ''
            let clientPhone = formatPhoneDisplay(targetPhone)

            if (matchedContact) {
              clientName = matchedContact.name
              clientPhone = formatPhoneDisplay(matchedContact.phone || targetPhone)
              displayTitle = matchedContact.name
            } else if (targetPhone && cleanTarget.length >= 8) {
              clientName = formatPhoneDisplay(targetPhone)
              displayTitle = `Ligação com ${clientName}`
            } else if (callSummary && callSummary.trim()) {
              displayTitle = callSummary
            } else {
              displayTitle = 'Ligação de Voz (Valentina)'
            }

            return {
              conversation_id: convId,
              start_time_unix_secs: startUnix,
              call_duration_secs: c.call_duration_secs ?? null,
              status: c.status ?? null,
              sentiment_analysis: meta.sentiment_analysis ?? null,
              call_summary_title: callSummary,
              display_title: displayTitle,
              client_name: clientName || displayTitle,
              client_phone: clientPhone,
              client_avatar: matchedContact?.avatar ?? null,
              client_contact_id: matchedContact?.id ?? null,
              rd_crm_deal_link: matchedContact?.rdCrmDealLink ?? null,
              is_system_contact: !!matchedContact,
              direction: c.direction ?? (matchedCall?.direction || 'outbound'),
              termination_reason: c.termination_reason ?? null,
            }
          })
          .sort(
            (a, b) =>
              (b.start_time_unix_secs as number) - (a.start_time_unix_secs as number),
          )

        return jsonResponse(mapped)
      },
    },
  },
})

