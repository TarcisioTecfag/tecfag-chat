// src/routes/api/voice-clients.ts
// Agrega clientes únicos das ligações cruzando voice_calls com contacts pelo número de telefone

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { voiceCalls, contacts } from "../../db/schema";
import { eq, desc, sql, and } from "drizzle-orm";

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

/** Normaliza número de telefone para os últimos 10 dígitos */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/** Formata número para exibição legível quando não há contato */
function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13) {
    // +55 (XX) XXXXX-XXXX
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 11) {
    // (XX) XXXXX-XXXX
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    // (XX) XXXX-XXXX
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
          // 1. Busca todas as ligações do tenant ordenadas por data recente (limite 500)
          const callsList = await db
            .select()
            .from(voiceCalls)
            .where(eq(voiceCalls.tenantId, tenantId))
            .orderBy(desc(voiceCalls.createdAt))
            .limit(500);

          // 2. Agrupa por número do cliente
          const clientMap = new Map<string, ClientData>();

          for (const call of callsList) {
            // Determina o número do cliente conforme direção
            const rawPhone =
              call.direction === "outbound" ? call.toNumber : call.fromNumber;

            if (!rawPhone) continue;

            const normalizedPhone = normalizePhone(rawPhone);
            if (!normalizedPhone) continue;

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

            if (clientMap.has(normalizedPhone)) {
              const existing = clientMap.get(normalizedPhone)!;
              existing.calls.push(callEntry);
              existing.totalCalls += 1;

              // Atualiza lastCallDate se esta é mais recente
              if (callDate > existing.lastCallDate) {
                existing.lastCallDate = callDate;
                existing.lastCallDuration = call.durationSeconds ?? 0;
              }

              // Contagem de sentimentos
              const s = (call.sentiment ?? "neutral") as
                | "positive"
                | "neutral"
                | "negative";
              if (s === "positive") existing.sentiments.positive += 1;
              else if (s === "negative") existing.sentiments.negative += 1;
              else existing.sentiments.neutral += 1;
            } else {
              const s = (call.sentiment ?? "neutral") as
                | "positive"
                | "neutral"
                | "negative";
              clientMap.set(normalizedPhone, {
                phone: normalizedPhone,
                contactId: null,
                name: formatPhoneDisplay(rawPhone),
                avatar: null,
                rdCrmDealLink: null,
                tags: [],
                totalCalls: 1,
                lastCallDate: callDate,
                lastCallDuration: call.durationSeconds ?? 0,
                sentiments: {
                  positive: s === "positive" ? 1 : 0,
                  neutral: s === "neutral" ? 1 : 0,
                  negative: s === "negative" ? 1 : 0,
                },
                calls: [callEntry],
              });
            }
          }

          // 3. Para cada número único, tenta encontrar o contato correspondente
          const phoneNumbers = Array.from(clientMap.keys());

          await Promise.all(
            phoneNumbers.map(async (normalizedPhone) => {
              try {
                const [contact] = await db
                  .select()
                  .from(contacts)
                  .where(
                    and(
                      eq(contacts.tenantId, tenantId),
                      sql`${contacts.phone} LIKE ${"%" + normalizedPhone}`
                    )
                  )
                  .limit(1);

                if (contact) {
                  const clientData = clientMap.get(normalizedPhone)!;
                  clientData.contactId = contact.id;
                  clientData.name = contact.name;
                  clientData.avatar = contact.avatar ?? null;
                  clientData.rdCrmDealLink = contact.rdCrmDealLink ?? null;
                  clientData.tags = Array.isArray(contact.tags)
                    ? contact.tags
                    : [];
                }
              } catch (err) {
                // Ignora falha de lookup individual — mantém dados sem contato
                console.warn(
                  `[VoiceClients] Falha ao buscar contato para ${normalizedPhone}:`,
                  err
                );
              }
            })
          );

          // 4. Converte o Map em array e ordena por lastCallDate DESC
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
