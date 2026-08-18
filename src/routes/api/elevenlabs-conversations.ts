import { createFileRoute } from '@tanstack/react-router'

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

        const conversations: Array<Record<string, unknown>> = Array.isArray(raw)
          ? raw
          : (raw.conversations ?? [])

        const mapped = conversations
          .map((c: Record<string, unknown>) => ({
            conversation_id: c.conversation_id,
            start_time_unix_secs: c.start_time_unix_secs ?? 0,
            call_duration_secs: c.call_duration_secs ?? null,
            status: c.status ?? null,
            sentiment_analysis: c.metadata
              ? (c.metadata as Record<string, unknown>).sentiment_analysis ?? null
              : null,
            call_summary_title: c.metadata
              ? (c.metadata as Record<string, unknown>).call_summary_title ?? null
              : null,
            direction: c.direction ?? null,
            termination_reason: c.termination_reason ?? null,
          }))
          .sort(
            (a, b) =>
              (b.start_time_unix_secs as number) - (a.start_time_unix_secs as number),
          )

        return jsonResponse(mapped)
      },
    },
  },
})
