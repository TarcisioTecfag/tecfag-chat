// src/routes/api/voice-enrich-contact.ts
// Pipeline pós-ligação: enriquece o contato no banco de dados e sincroniza com o RD Station CRM

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { contacts, voiceCalls, tasks } from "../../db/schema";
import { eq } from "drizzle-orm";
import { rdCrmService } from "../../lib/rdCrmService";

export const Route = createFileRoute("/api/voice-enrich-contact")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId = "valem", contactId, callId, extractedInfo } = body;

          if (!extractedInfo) {
            return new Response(JSON.stringify({ error: "extractedInfo é obrigatório" }), { status: 400 });
          }

          const { nome, empresa, interesse, objecoes, proximo_passo } = extractedInfo;

          // 1. Se existir contactId, atualiza os dados do contato
          if (contactId) {
            const [existingContact] = await db.select().from(contacts).where(eq(contacts.id, contactId));

            if (existingContact) {
              const currentTags = (existingContact.tags as string[]) || [];
              const newTags = new Set(currentTags);
              if (interesse) newTags.add(interesse);
              newTags.add("Ligação Realizada");

              await db
                .update(contacts)
                .set({
                  name: existingContact.name || nome || existingContact.name,
                  tags: Array.from(newTags),
                })
                .where(eq(contacts.id, contactId));

              // 2. Se o contato tiver deal no RD Station CRM, sincroniza as anotações
              if (existingContact.rdCrmDealId) {
                const noteText = `[Valentina Voz - Resumo da Ligação]\n` +
                  `• Interesse: ${interesse || "Não especificado"}\n` +
                  `• Objeções: ${objecoes || "Nenhuma"}\n` +
                  `• Próximo Passo: ${proximo_passo || "Nenhum"}`;

                await rdCrmService.addNoteToDeal(tenantId, existingContact.rdCrmDealId, noteText).catch((err) => {
                  console.error("[VoiceEnrich] Erro ao adicionar nota no RD CRM:", err?.message || err);
                });
              }
            }
          }

          // 3. Se houver próximo passo extraído, cria uma Tarefa automatizada no banco
          if (proximo_passo) {
            await db.insert(tasks).values({
              id: `task_voice_${Date.now()}`,
              tenantId,
              name: `Follow-up Voz: ${proximo_passo}`,
              type: "CALL_FOLLOWUP",
              status: "pending",
              dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // +24h
              clientName: nome || "Cliente Ligação",
              createdAt: new Date(),
            }).catch((err) => console.error("[VoiceEnrich] Erro ao criar task:", err?.message || err));
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[VoiceEnrich API] Erro no enriquecimento:", err?.message || err);
          return new Response(JSON.stringify({ error: "Erro no enriquecimento de contato" }), { status: 500 });
        }
      },
    },
  },
});
