import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { agentConfigs, agentFlowStates, conversations, contacts, messages } from "../../../db/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

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
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
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

function parseMediaInfo(content: string, mediaUrl?: string | null, mediaType?: string | null, fileName?: string | null) {
  let url = mediaUrl || undefined;
  let type = mediaType || undefined;
  let name = fileName || undefined;

  if (content) {
    const firstLine = content.split(/\r?\n/)[0].trim();
    if (firstLine.startsWith("[MEDIA:")) {
      const match = firstLine.match(/^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::(.+))?$/i);
      if (match) {
        type = match[1].toLowerCase() === "sticker" ? "image" : match[1].toLowerCase();
        const mediaId = match[2].trim();
        name = match[3] ? match[3].trim() : name;
        url = `/api/baileys/media?messageId=${mediaId}`;
      }
    }
  }

  if (url && url.includes("/api/media/")) {
    const mediaId = url.split("/api/media/")[1]?.trim();
    if (mediaId) {
      url = `/api/baileys/media?messageId=${mediaId}`;
    }
  }

  return { mediaUrl: url, mediaType: type, fileName: name };
}

export const Route = createFileRoute('/api/valentina/sdr')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Configurações do SDR + Lista de Triagens Reais do Banco ─────────
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        let config = {
          enabled: true,
        };

        const sessions: any[] = [];
        const addedConvIds = new Set<string>();

        // 1. Tentar buscar Config do SDR no banco de forma segura
        try {
          const dbConfig = await db.query.agentConfigs.findFirst({
            where: (table, { eq: dEq, and: dAnd }) =>
              dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
          });

          if (dbConfig) {
            config = {
              enabled: dbConfig.enabled === 1,
            };
          }
        } catch (err) {
          console.warn("[api/valentina/sdr] Erro ao buscar agentConfigs:", err);
        }

        // 2. Buscar sessões registradas em agentFlowStates do tenant
        try {
          const flowStates = await db.select()
            .from(agentFlowStates)
            .where(eq(agentFlowStates.tenantId, tenantId))
            .orderBy(desc(agentFlowStates.lastInteractionAt))
            .limit(50);

          for (const fs of flowStates) {
            try {
              addedConvIds.add(fs.conversationId);

              const conv = await db.query.conversations.findFirst({
                where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, fs.conversationId), dEq(t.tenantId, tenantId)),
              });

              const contact = conv
                ? await db.query.contacts.findFirst({
                    where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, conv.contactId), dEq(t.tenantId, tenantId)),
                  })
                : null;

              const realMsgs = await db
                .select()
                .from(messages)
                .where(and(eq(messages.conversationId, fs.conversationId), eq(messages.tenantId, tenantId)))
                .orderBy(asc(messages.sentAt))
                .limit(100);

              const formattedMessages = realMsgs.map((m: any) => {
                const mediaInfo = parseMediaInfo(m.content, m.mediaUrl, m.mediaType, m.fileName);
                return {
                  id: m.id,
                  sender: m.senderType === "client" ? "client" : "bot",
                  text: m.content,
                  time: safeFormatTime(m.sentAt),
                  mediaUrl: mediaInfo.mediaUrl,
                  mediaType: mediaInfo.mediaType,
                  fileName: mediaInfo.fileName,
                };
              });

              const collectedData = (fs.collectedData as any) || {};

              let status: "active" | "completed" | "abandoned" = "active";
              if (fs.outcome === "completed" || fs.outcome === "transferred") status = "completed";
              if (fs.outcome === "abandoned" || fs.outcome === "stopped") status = "abandoned";

              const operator = conv?.operatorId
                ? await db.query.operators.findFirst({
                    where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, conv.operatorId!), dEq(t.tenantId, tenantId)),
                  })
                : null;

              let responsibleName = "IA (Em Triagem)";
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

        // 3. Buscar conversas ativas reais do tenant (excluindo apenas dados mock de teste)
        try {
          const allConvs = await db
            .select()
            .from(conversations)
            .where(eq(conversations.tenantId, tenantId))
            .orderBy(desc(conversations.lastMessageTime))
            .limit(50);

          for (const c of allConvs) {
            if (c.id === "tec-1" || c.id === "tec-2") continue;

            if (!addedConvIds.has(c.id)) {
              try {
                addedConvIds.add(c.id);

                const contact = await db.query.contacts.findFirst({
                  where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, c.contactId), dEq(t.tenantId, tenantId)),
                });

                const operator = c.operatorId
                  ? await db.query.operators.findFirst({
                      where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, c.operatorId!), dEq(t.tenantId, tenantId)),
                    })
                  : null;

                const realMsgs = await db
                  .select()
                  .from(messages)
                  .where(and(eq(messages.conversationId, c.id), eq(messages.tenantId, tenantId)))
                  .orderBy(asc(messages.sentAt))
                  .limit(100);

                const formattedMessages = realMsgs.map((m: any) => {
                  const mediaInfo = parseMediaInfo(m.content, m.mediaUrl, m.mediaType, m.fileName);
                  return {
                    id: m.id,
                    sender: m.senderType === "client" ? "client" : "bot",
                    text: m.content,
                    time: safeFormatTime(m.sentAt),
                    mediaUrl: mediaInfo.mediaUrl,
                    mediaType: mediaInfo.mediaType,
                    fileName: mediaInfo.fileName,
                  };
                });

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
                  responsibleName: operator?.name || "IA (Em Triagem)",
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

        return new Response(JSON.stringify({ config, sessions }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      },

      // ── POST: Salvar configurações do SDR ou Interromper IA ──
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        try {
          const body = await request.json();
          const { action, conversationId, enabled, testMode, whitelistPhone } = body;

          // Ação de Parar a IA instantaneamente para uma conversa específica do tenant
          if (action === "stop" && conversationId) {
            const [conv] = await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
              .limit(1);

            if (!conv) {
              return new Response(
                JSON.stringify({ error: "Conversa não encontrada ou não pertence a este tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

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
              .where(and(eq(agentFlowStates.conversationId, conversationId), eq(agentFlowStates.tenantId, tenantId)));

            await db
              .update(conversations)
              .set({
                queueState: "fila",
              })
              .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));

            return new Response(JSON.stringify({ success: true, message: "IA de triagem interrompida para esta conversa." }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Apenas administradores podem salvar/alterar configurações globais de SDR
          if (session.operator.role !== "admin") {
            return new Response(
              JSON.stringify({ error: "Permissão insuficiente. Apenas administradores podem alterar configurações do SDR.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const existingConfig = await db.query.agentConfigs.findFirst({
            where: (table, { eq: dEq, and: dAnd }) =>
              dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
          });

          const currentJson = (existingConfig?.config as Record<string, any>) || {};
          const updatedJson = {
            ...currentJson,
          };
          if (testMode !== undefined) updatedJson.testMode = Boolean(testMode);
          if (whitelistPhone !== undefined) updatedJson.whitelistPhone = String(whitelistPhone).trim();

          if (existingConfig) {
            await db
              .update(agentConfigs)
              .set({
                enabled: enabled !== undefined ? (enabled ? 1 : 0) : existingConfig.enabled,
                config: updatedJson,
                updatedAt: new Date(),
              })
              .where(and(eq(agentConfigs.id, existingConfig.id), eq(agentConfigs.tenantId, tenantId)));
          } else {
            await db.insert(agentConfigs).values({
              id: `cfg-sdr-${tenantId}-${Date.now()}`,
              tenantId,
              agentType: "sdr",
              enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1,
              config: updatedJson,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          return new Response(JSON.stringify({ success: true, enabled: enabled !== undefined ? Boolean(enabled) : true }), {
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
