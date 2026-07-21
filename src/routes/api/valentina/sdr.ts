import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { agentConfigs, agentFlowStates, conversations, contacts, messages } from "../../../db/schema";
import { eq, desc, asc } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function safeFormatTime(dateVal: any): string {
  if (!dateVal) return "Agora";
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return "Agora";
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "Agora";
  }
}

function safeFormatIso(dateVal: any): string {
  if (!dateVal) return new Date().toISOString();
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export const Route = createFileRoute('/api/valentina/sdr')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Configurações do SDR + Lista de Triagens Reais do Banco (100% Fail-Safe) ─────────
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "valem";

        let config = {
          enabled: true,
          testMode: true,
          whitelistPhone: "14998364338",
        };

        const sessions: any[] = [];
        const addedConvIds = new Set<string>();

        // 1. Tentar buscar Config do SDR no banco de forma segura
        try {
          let dbConfig = await db.query.agentConfigs.findFirst({
            where: (table, { eq: dEq, and: dAnd }) =>
              dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
          });

          if (!dbConfig) {
            dbConfig = await db.query.agentConfigs.findFirst({
              where: (table, { eq: dEq }) => dEq(table.agentType, "sdr"),
            });
          }

          if (dbConfig) {
            const configData = (dbConfig.config as Record<string, any>) || {};
            config = {
              enabled: dbConfig.enabled === 1,
              testMode: configData.testMode !== undefined ? Boolean(configData.testMode) : true,
              whitelistPhone: configData.whitelistPhone || "14998364338",
            };
          }
        } catch (err) {
          console.warn("[api/valentina/sdr] Erro ao buscar agentConfigs (usando fallback seguro):", err);
        }

        // 2. Tentar buscar sessões registradas em agentFlowStates
        try {
          let flowStates = await db.select()
            .from(agentFlowStates)
            .orderBy(desc(agentFlowStates.lastInteractionAt))
            .limit(50);

          for (const fs of flowStates) {
            try {
              addedConvIds.add(fs.conversationId);

              const conv = await db.query.conversations.findFirst({
                where: (t, { eq: dEq }) => dEq(t.id, fs.conversationId),
              });

              const contact = conv
                ? await db.query.contacts.findFirst({
                    where: (t, { eq: dEq }) => dEq(t.id, conv.contactId),
                  })
                : null;

              const realMsgs = await db
                .select()
                .from(messages)
                .where(eq(messages.conversationId, fs.conversationId))
                .orderBy(asc(messages.sentAt))
                .limit(100);

              const formattedMessages = realMsgs.map((m) => ({
                sender: m.senderType === "client" ? "client" : "bot",
                text: m.content,
                time: safeFormatTime(m.sentAt),
              }));

              const collectedData = (fs.collectedData as any) || {};

              let status: "active" | "completed" | "abandoned" = "active";
              if (fs.outcome === "completed" || fs.outcome === "transferred") status = "completed";
              if (fs.outcome === "abandoned" || fs.outcome === "stopped") status = "abandoned";

              const operator = conv?.operatorId
                ? await db.query.operators.findFirst({
                    where: (t, { eq: dEq }) => dEq(t.id, conv.operatorId),
                  })
                : null;

              let responsibleName = "Valentina IA (Em Triagem)";
              if (status === "completed") {
                responsibleName = operator?.name || "Vendedor Alocado (Rodízio)";
              } else if (fs.outcome === "stopped") {
                responsibleName = "Interrompido (Atendimento Manual)";
              }

              sessions.push({
                id: fs.id,
                conversationId: fs.conversationId,
                contactName: contact?.name || collectedData["NOME COMPLETO"]?.value || "Contato WhatsApp",
                contactAvatar: contact?.avatar || null,
                company: collectedData["EMPRESA"]?.value || "Empresa não informada",
                phone: contact?.phone || "",
                currentStep: fs.currentStep,
                collectedData,
                startedAt: safeFormatIso(fs.startedAt),
                status,
                outcome: fs.outcome || undefined,
                responsibleName,
                messages: formattedMessages.length > 0 ? formattedMessages : [
                  { sender: "bot", text: "Atendimento em andamento...", time: "Agora" }
                ],
              });
            } catch (innerErr) {
              console.warn("[api/valentina/sdr] Erro ao processar flowState individual:", innerErr);
            }
          }
        } catch (err) {
          console.warn("[api/valentina/sdr] Erro ao buscar agentFlowStates:", err);
        }

        // 3. Tentar buscar todas as conversas ativas do banco
        try {
          const allConvs = await db
            .select()
            .from(conversations)
            .orderBy(desc(conversations.lastMessageTime))
            .limit(50);

          for (const c of allConvs) {
            if (!addedConvIds.has(c.id)) {
              try {
                addedConvIds.add(c.id);

                const contact = await db.query.contacts.findFirst({
                  where: (t, { eq: dEq }) => dEq(t.id, c.contactId),
                });

                const operator = c.operatorId
                  ? await db.query.operators.findFirst({
                      where: (t, { eq: dEq }) => dEq(t.id, c.operatorId),
                    })
                  : null;

                const realMsgs = await db
                  .select()
                  .from(messages)
                  .where(eq(messages.conversationId, c.id))
                  .orderBy(asc(messages.sentAt))
                  .limit(100);

                const formattedMessages = realMsgs.map((m) => ({
                  sender: m.senderType === "client" ? "client" : "bot",
                  text: m.content,
                  time: safeFormatTime(m.sentAt),
                }));

                sessions.push({
                  id: `fs-auto-${c.id}`,
                  conversationId: c.id,
                  contactName: contact?.name || "Contato WhatsApp",
                  contactAvatar: contact?.avatar || null,
                  company: "Empresa não informada",
                  phone: contact?.phone || "",
                  currentStep: "Em Qualificação",
                  collectedData: {},
                  startedAt: safeFormatIso(c.createdAt),
                  status: "active",
                  outcome: "in_progress",
                  responsibleName: operator?.name || "Valentina IA (Em Triagem)",
                  messages: formattedMessages.length > 0 ? formattedMessages : [
                    { sender: "bot", text: "Atendimento iniciado...", time: "Agora" }
                  ],
                });
              } catch (innerErr) {
                console.warn("[api/valentina/sdr] Erro ao processar conversa individual:", innerErr);
              }
            }
          }
        } catch (err) {
          console.warn("[api/valentina/sdr] Erro ao buscar conversations:", err);
        }

        // Garantia absoluta: Nunca retorna 500 para o navegador
        return new Response(JSON.stringify({ config, sessions }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      },

      // ── POST: Salvar configurações do SDR ou Interromper Valentina ──
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { action, conversationId, tenantId = "valem", enabled, testMode, whitelistPhone } = body;

          // Ação de Parar a Valentina instantaneamente para um contato específico
          if (action === "stop" && conversationId) {
            try {
              const { SdrDebouncer } = await import("../../../lib/valentina/sdr-debouncer");
              SdrDebouncer.getInstance().clearSession(conversationId);
            } catch (err) {
              console.warn("[api/valentina/sdr] Erro ao limpar debouncer no stop:", err);
            }

            await db
              .update(agentFlowStates)
              .set({
                outcome: "stopped",
                currentStep: "Interrompido Manualmente",
                lastInteractionAt: new Date(),
              })
              .where(eq(agentFlowStates.conversationId, conversationId));

            await db
              .update(conversations)
              .set({
                queueState: "fila",
              })
              .where(eq(conversations.id, conversationId));

            return new Response(JSON.stringify({ success: true, message: "Valentina interrompida para esta conversa." }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const existingConfig = await db.query.agentConfigs.findFirst({
            where: (table, { eq: dEq, and: dAnd }) =>
              dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
          });

          const currentJson = (existingConfig?.config as Record<string, any>) || {};
          const updatedJson = {
            ...currentJson,
            testMode: testMode !== undefined ? Boolean(testMode) : true,
            whitelistPhone: whitelistPhone !== undefined ? String(whitelistPhone).trim() : "14998364338",
          };

          if (existingConfig) {
            await db
              .update(agentConfigs)
              .set({
                enabled: enabled !== undefined ? (enabled ? 1 : 0) : existingConfig.enabled,
                config: updatedJson,
                updatedAt: new Date(),
              })
              .where(eq(agentConfigs.id, existingConfig.id));
          } else {
            await db.insert(agentConfigs).values({
              id: `cfg-sdr-${Date.now()}`,
              tenantId,
              agentType: "sdr",
              enabled: enabled ? 1 : 0,
              config: updatedJson,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        } catch (e: any) {
          console.error("[api/valentina/sdr] Erro ao processar POST no SDR:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
