// src/routes/api/voice-clients.ts
// Agrega clientes únicos das ligações cruzando voice_calls e ElevenLabs com contacts pelo número de telefone

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { voiceCalls, contacts } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface CallEntry {
  id: string;
  direction: string;
  status: string;
  startedAt: string;
  durationSeconds: number;
  sentiment: string | null;
  summary: string | null;
}

interface ClientData {
  phone: string;
  contactId: string | null;
  name: string;
  avatar: string | null;
  rdCrmDealLink: string | null;
  tags: string[];
  totalCalls: number;
  lastCallDate: string;
  lastCallDuration: number;
  sentiments: { positive: number; neutral: number; negative: number };
  calls: CallEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanPhoneDigits(phone?: string | null): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "").replace(/^55/, "");
}

function formatPhoneDisplay(phone?: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "").replace(/^55/, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/voice-clients")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      GET: async ({ request }) => {
        const url = new URL(request.url);

        // Validação obrigatória do tenantId
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) {
          return new Response(
            JSON.stringify({ error: "tenantId é obrigatório" }),
            { status: 400, headers: CORS_HEADERS }
          );
        }

        try {
          // 1. Busca todas as ligações locais do banco
          let callsList: any[] = [];
          try {
            callsList = await db
              .select()
              .from(voiceCalls)
              .where(eq(voiceCalls.tenantId, tenantId))
              .orderBy(desc(voiceCalls.createdAt))
              .limit(500);
          } catch {
            // Tabela pode estar vazia ou recém criada
          }

          // 2. Busca todos os contatos do tenant
          let dbContacts: any[] = [];
          try {
            dbContacts = await db
              .select()
              .from(contacts)
              .where(eq(contacts.tenantId, tenantId));
          } catch {
            // Ignora se tabela vazia
          }

          // 3. Busca conversas do ElevenLabs para garantir que nenhuma ligação fique de fora
          const apiKey = process.env.ELEVENLABS_API_KEY;
          const agentId = process.env.ELEVENLABS_AGENT_ID;
          let elevenConversations: any[] = [];

          if (apiKey && agentId) {
            try {
              const res = await fetch(
                `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${agentId}&page_size=50`,
                { headers: { "xi-api-key": apiKey } }
              );
              if (res.ok) {
                const data = await res.json();
                elevenConversations = Array.isArray(data) ? data : (data.conversations ?? []);
              }
            } catch (e: any) {
              console.warn("[VoiceClients] Aviso ao buscar ElevenLabs:", e?.message);
            }
          }

          // 4. Agrupa por número do cliente
          const clientMap = new Map<string, ClientData>();

          // Processa chamadas locais do banco
          for (const call of callsList) {
            const rawPhone =
              call.direction === "outbound" ? (call.toNumber && call.toNumber !== "Valem Line" ? call.toNumber : call.fromNumber) : call.fromNumber;

            if (!rawPhone || rawPhone === "Desconhecido") continue;

            const cleanPhone = cleanPhoneDigits(rawPhone);
            const keyPhone = cleanPhone.slice(-9) || cleanPhone;
            if (!keyPhone) continue;

            const callDate = call.startedAt
              ? new Date(call.startedAt).toISOString()
              : new Date(call.createdAt).toISOString();

            const callEntry: CallEntry = {
              id: call.id,
              direction: call.direction,
              status: call.status,
              startedAt: callDate,
              durationSeconds: call.durationSeconds ?? 0,
              sentiment: call.sentiment ?? null,
              summary: call.summary ?? null,
            };

            const sentimentKey = (call.sentiment ?? "neutral") as "positive" | "neutral" | "negative";

            if (clientMap.has(keyPhone)) {
              const existing = clientMap.get(keyPhone)!;
              if (!existing.calls.some(c => c.id === call.id)) {
                existing.calls.push(callEntry);
                existing.totalCalls += 1;
                if (callDate > existing.lastCallDate) {
                  existing.lastCallDate = callDate;
                  existing.lastCallDuration = call.durationSeconds ?? 0;
                }
                if (sentimentKey === "positive") existing.sentiments.positive += 1;
                else if (sentimentKey === "negative") existing.sentiments.negative += 1;
                else existing.sentiments.neutral += 1;
              }
            } else {
              clientMap.set(keyPhone, {
                phone: rawPhone,
                contactId: call.contactId || null,
                name: formatPhoneDisplay(rawPhone),
                avatar: null,
                rdCrmDealLink: null,
                tags: [],
                totalCalls: 1,
                lastCallDate: callDate,
                lastCallDuration: call.durationSeconds ?? 0,
                sentiments: {
                  positive: sentimentKey === "positive" ? 1 : 0,
                  neutral: sentimentKey === "neutral" ? 1 : 0,
                  negative: sentimentKey === "negative" ? 1 : 0,
                },
                calls: [callEntry],
              });
            }
          }

          // Processa conversas da ElevenLabs
          for (const conv of elevenConversations) {
            const convId = conv.conversation_id;
            const startUnix = Number(conv.start_time_unix_secs || 0);
            const callDate = startUnix ? new Date(startUnix * 1000).toISOString() : new Date().toISOString();
            const meta = conv.metadata || {};
            const sentLabel = meta.sentiment_analysis?.overall_label || "neutral";

            // Procura se já está nas chamadas locais
            const matchedLocal = callsList.find(c => c.campaignId === convId || c.id === convId);
            const rawPhone = matchedLocal
              ? (matchedLocal.toNumber && matchedLocal.toNumber !== "Valem Line" ? matchedLocal.toNumber : matchedLocal.fromNumber)
              : "14998364338"; // Telefone principal de teste / operação

            const cleanPhone = cleanPhoneDigits(rawPhone);
            const keyPhone = cleanPhone.slice(-9) || cleanPhone;
            if (!keyPhone) continue;

            const callEntry: CallEntry = {
              id: convId,
              direction: conv.direction || "outbound",
              status: conv.status || "done",
              startedAt: callDate,
              durationSeconds: conv.call_duration_secs ?? 0,
              sentiment: sentLabel,
              summary: meta.call_summary_title || null,
            };

            if (clientMap.has(keyPhone)) {
              const existing = clientMap.get(keyPhone)!;
              if (!existing.calls.some(c => c.id === convId || (matchedLocal && c.id === matchedLocal.id))) {
                existing.calls.push(callEntry);
                existing.totalCalls += 1;
                if (callDate > existing.lastCallDate) {
                  existing.lastCallDate = callDate;
                  existing.lastCallDuration = conv.call_duration_secs ?? 0;
                }
                if (sentLabel === "positive") existing.sentiments.positive += 1;
                else if (sentLabel === "negative") existing.sentiments.negative += 1;
                else existing.sentiments.neutral += 1;
              }
            } else {
              clientMap.set(keyPhone, {
                phone: rawPhone,
                contactId: matchedLocal?.contactId || null,
                name: formatPhoneDisplay(rawPhone),
                avatar: null,
                rdCrmDealLink: null,
                tags: [],
                totalCalls: 1,
                lastCallDate: callDate,
                lastCallDuration: conv.call_duration_secs ?? 0,
                sentiments: {
                  positive: sentLabel === "positive" ? 1 : 0,
                  neutral: sentLabel === "neutral" ? 1 : 0,
                  negative: sentLabel === "negative" ? 1 : 0,
                },
                calls: [callEntry],
              });
            }
          }

          // 5. Cruza com os contatos da tabela contacts do WhatsApp
          for (const [keyPhone, clientData] of clientMap.entries()) {
            const cleanTarget = cleanPhoneDigits(clientData.phone);
            const suffix8 = cleanTarget.slice(-8);

            // Busca contato pelo contactId ou pelos 8 dígitos finais do telefone/WhatsApp
            let matchedContact = null;
            if (clientData.contactId) {
              matchedContact = dbContacts.find(ct => ct.id === clientData.contactId);
            }
            if (!matchedContact && suffix8) {
              matchedContact = dbContacts.find(ct => {
                const ctClean = cleanPhoneDigits(ct.phone || ct.whatsappJid);
                return ctClean.endsWith(suffix8) || ctClean.includes(suffix8);
              });
            }

            if (matchedContact) {
              clientData.contactId = matchedContact.id;
              clientData.name = matchedContact.name;
              clientData.avatar = matchedContact.avatar ?? null;
              clientData.rdCrmDealLink = matchedContact.rdCrmDealLink ?? null;
              clientData.tags = Array.isArray(matchedContact.tags) ? matchedContact.tags : [];
            }
          }

          // 6. Converte em array e ordena por lastCallDate DESC
          const clients = Array.from(clientMap.values()).sort((a, b) =>
            b.lastCallDate.localeCompare(a.lastCallDate)
          );

          return new Response(
            JSON.stringify({ clients, total: clients.length }),
            { headers: CORS_HEADERS }
          );
        } catch (err: any) {
          console.error(
            "[VoiceClients API] Erro ao agregar clientes:",
            err?.message || err
          );
          return new Response(
            JSON.stringify({ error: "Erro interno do servidor" }),
            { status: 500, headers: CORS_HEADERS }
          );
        }
      },
    },
  },
});

