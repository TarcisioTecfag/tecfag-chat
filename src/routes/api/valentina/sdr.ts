import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { agentConfigs, agentFlowStates, conversations, contacts, messages } from "../../../db/schema";
import { eq, desc, asc } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute('/api/valentina/sdr')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Configurações do SDR + Lista de Triagens Reais do Banco ─────────
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "valem";

        try {
          // 1. Config do SDR no banco
          let dbConfig = await db.query.agentConfigs.findFirst({
            where: (table, { eq: dEq, and: dAnd }) =>
              dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
          });

          if (!dbConfig) {
            dbConfig = await db.query.agentConfigs.findFirst({
              where: (table, { eq: dEq }) => dEq(table.agentType, "sdr"),
            });
          }

          const configData = (dbConfig?.config as Record<string, any>) || {};

          const config = {
            enabled: dbConfig ? dbConfig.enabled === 1 : true,
            testMode: configData.testMode !== undefined ? Boolean(configData.testMode) : true,
            whitelistPhone: configData.whitelistPhone || "14998364338",
          };

          // 2. Buscar sessões de triagem registradas na tabela agentFlowStates
          let flowStates = await db.select()
            .from(agentFlowStates)
            .orderBy(desc(agentFlowStates.lastInteractionAt))
            .limit(50);

          const sessions: any[] = [];
          const addedConvIds = new Set<string>();

          for (const fs of flowStates) {
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
              time: new Date(m.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            }));

            const collectedData = (fs.collectedData as any) || {};

            let status: "active" | "completed" | "abandoned" = "active";
            if (fs.outcome === "completed" || fs.outcome === "transferred") status = "completed";
            if (fs.outcome === "abandoned") status = "abandoned";

            sessions.push({
              id: fs.id,
              conversationId: fs.conversationId,
              contactName: contact?.name || collectedData["NOME COMPLETO"]?.value || "Contato WhatsApp",
              company: collectedData["EMPRESA"]?.value || "Empresa não informada",
              phone: contact?.phone || "",
              currentStep: fs.currentStep,
              collectedData,
              startedAt: fs.startedAt ? new Date(fs.startedAt).toISOString() : new Date().toISOString(),
              status,
              outcome: fs.outcome || undefined,
              messages: formattedMessages.length > 0 ? formattedMessages : [
                { sender: "bot", text: "Atendimento iniciado com a Valentina SDR...", time: "Agora" }
              ],
            });
          }

          // 3. Garantia: buscar todas as conversas na fila 'automacao' (Valentina IA) que ainda não foram catalogadas
          const automacaoConvs = await db
            .select()
            .from(conversations)
            .where(eq(conversations.queueState, "automacao"))
            .orderBy(desc(conversations.lastMessageTime))
            .limit(20);

          for (const c of automacaoConvs) {
            if (!addedConvIds.has(c.id)) {
              addedConvIds.add(c.id);

              const contact = await db.query.contacts.findFirst({
                where: (t, { eq: dEq }) => dEq(t.id, c.contactId),
              });

              const realMsgs = await db
                .select()
                .from(messages)
                .where(eq(messages.conversationId, c.id))
                .orderBy(asc(messages.sentAt))
                .limit(100);

              const formattedMessages = realMsgs.map((m) => ({
                sender: m.senderType === "client" ? "client" : "bot",
                text: m.content,
                time: new Date(m.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
              }));

              sessions.push({
                id: `fs-auto-${c.id}`,
                conversationId: c.id,
                contactName: contact?.name || "Contato WhatsApp",
                company: "Empresa não informada",
                phone: contact?.phone || "",
                currentStep: "Em Qualificação",
                collectedData: {},
                startedAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
                status: "active",
                outcome: "in_progress",
                messages: formattedMessages.length > 0 ? formattedMessages : [
                  { sender: "bot", text: "Atendimento iniciado com a Valentina SDR...", time: "Agora" }
                ],
              });
            }
          }

          return new Response(JSON.stringify({ config, sessions }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        } catch (e: any) {
          console.error("[api/valentina/sdr] Erro ao buscar dados do SDR:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── POST: Salvar configurações do SDR (enabled, testMode, whitelistPhone) ──
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId = "valem", enabled, testMode, whitelistPhone } = body;

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
          console.error("[api/valentina/sdr] Erro ao salvar config SDR:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
