import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  agentConfigs,
  agentFlowStates,
  conversations,
  contacts,
  messages,
  operators,
  crmConversationDeals,
  crmDeals,
} from "../../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";

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

function safeFormatDate(dateVal: any): string {
  if (!dateVal) {
    return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) {
      return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    }
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
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
        const persona = getAiPersona(tenantId);

        let config = {
          enabled: true,
        };

        const sessions: any[] = [];
        const addedConvIds = new Set<string>();
        const sessionsByConvId = new Map<string, any>();

        // Mapa de operadores do tenant para identificar nome e foto nas mensagens de operador
        const operatorsById = new Map<string, { id: string; name: string; avatar: string | null }>();
        const operatorsByName = new Map<string, { id: string; name: string; avatar: string | null }>();
        try {
          const tenantOps = await db
            .select({
              id: operators.id,
              name: operators.name,
              avatar: operators.avatar,
            })
            .from(operators)
            .where(eq(operators.tenantId, tenantId));

          for (const op of tenantOps) {
            operatorsById.set(op.id, op);
            if (op.name) {
              operatorsByName.set(op.name.trim().toLowerCase(), op);
            }
          }
        } catch (err) {
          console.warn("[api/valentina/sdr] Erro ao carregar operadores do tenant:", err);
        }

        const formatConversationMessages = (
          rawMsgs: any[],
          defaultOperator: { id: string; name: string; avatar: string | null } | null,
          contactName: string,
        ) => {
          return rawMsgs.map((m: any) => {
            const mediaInfo = parseMediaInfo(m.content, m.mediaUrl, m.mediaType, m.fileName);
            const rawText = (m.content || "").trim();
            const isSystemResetMsg =
              m.senderType === "system" ||
              rawText.toLowerCase() === "!reset" ||
              rawText.includes("Fluxo de triagem reiniciado") ||
              rawText.includes("Triagem anterior encerrada");

            let sender: "client" | "bot" | "agent" | "system" = "bot";
            if (isSystemResetMsg) {
              sender = "system";
            } else if (m.senderType === "client") {
              sender = "client";
            } else if (m.senderType === "agent") {
              sender = "agent";
            } else {
              sender = "bot";
            }

            let senderName = persona.name;
            let senderAvatar: string | null = null;

            if (sender === "client") {
              senderName = contactName;
            } else if (sender === "system") {
              senderName = "Sistema";
            } else if (sender === "agent") {
              const metaOpId = (m.metaDetails as any)?.operatorId;
              const byId = metaOpId ? operatorsById.get(String(metaOpId)) : undefined;
              const byName = m.senderName
                ? operatorsByName.get(String(m.senderName).trim().toLowerCase())
                : undefined;
              const resolvedOp = byId || byName || defaultOperator;

              senderName = resolvedOp?.name || m.senderName || "Operador";
              senderAvatar = resolvedOp?.avatar || null;
            }

            return {
              id: m.id,
              sender,
              senderName,
              senderAvatar,
              text: m.content,
              time: safeFormatTime(m.sentAt),
              date: safeFormatDate(m.sentAt),
              sentAt: safeFormatIso(m.sentAt),
              isInternalNote: Boolean(m.isInternalNote),
              mediaUrl: mediaInfo.mediaUrl,
              mediaType: mediaInfo.mediaType,
              fileName: mediaInfo.fileName,
            };
          });
        };

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
              // Evitar duplicar cards/chats para o mesmo cliente: compilar ciclos anteriores na mesma sessão
              if (addedConvIds.has(fs.conversationId)) {
                const existingSession = sessionsByConvId.get(fs.conversationId);
                if (existingSession) {
                  const fsMeta = (fs.metadata as Record<string, any>) || {};
                  const alreadyAdded = existingSession.previousTriages.some((p: any) => p.id === fs.id);
                  if (!alreadyAdded) {
                    existingSession.previousTriages.push({
                      id: fs.id,
                      startedAt: safeFormatIso(fs.startedAt),
                      completedAt: fs.completedAt ? safeFormatIso(fs.completedAt) : safeFormatIso(fs.lastInteractionAt),
                      outcome: fs.outcome || "completed",
                      targetFunnel: fsMeta.targetFunnel || undefined,
                      responsibleName: fsMeta.allocatedOperatorName || undefined,
                    });
                  }
                }
                continue;
              }

              addedConvIds.add(fs.conversationId);

              const conv = await db.query.conversations.findFirst({
                where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, fs.conversationId), dEq(t.tenantId, tenantId)),
              });

              const contact = conv
                ? await db.query.contacts.findFirst({
                    where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, conv.contactId), dEq(t.tenantId, tenantId)),
                  })
                : null;

              const operator = conv?.operatorId
                ? operatorsById.get(conv.operatorId) ||
                  (await db.query.operators.findFirst({
                    where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, conv.operatorId!), dEq(t.tenantId, tenantId)),
                  })) ||
                  null
                : null;

              const recentMsgsDesc = await db
                .select()
                .from(messages)
                .where(and(eq(messages.conversationId, fs.conversationId), eq(messages.tenantId, tenantId)))
                .orderBy(desc(messages.sentAt))
                .limit(200);
              const realMsgs = recentMsgsDesc.reverse();

              const collectedData = (fs.collectedData as any) || {};
              const resolvedContactName =
                contact?.name || collectedData["NOME COMPLETO"]?.value || "Contato WhatsApp";

              const formattedMessages = formatConversationMessages(realMsgs, operator, resolvedContactName);

              let status: "active" | "completed" | "abandoned" = "active";
              if (fs.outcome === "completed" || fs.outcome === "transferred") status = "completed";
              if (fs.outcome === "abandoned" || fs.outcome === "stopped") status = "abandoned";

              const meta = (fs.metadata as Record<string, any>) || {};
              let responsibleName = "IA (Em Triagem)";
              if (status === "completed") {
                responsibleName = operator?.name || meta.allocatedOperatorName || "Vendedor Alocado (Rodízio)";
              } else if (fs.outcome === "stopped") {
                responsibleName = operator?.name || "Interrompido (Atendimento Manual)";
              }

              const companyVal =
                collectedData["EMPRESA"]?.value ||
                collectedData["empresa"]?.value ||
                (typeof collectedData["EMPRESA"] === "string" ? collectedData["EMPRESA"] : "") ||
                (contact?.cnpjDetails as any)?.razaoSocial ||
                "Empresa não informada";

              // Buscar negociação vinculada no CRM Local (se houver)
              let linkedDeal: {
                dealId: string;
                dealTitle: string;
                action?: string;
                createdAt?: string;
              } | null = null;

              if (meta.localCrmDealId) {
                linkedDeal = {
                  dealId: meta.localCrmDealId,
                  dealTitle: meta.localCrmDealTitle || "Negociação CRM Local",
                  action: meta.localCrmDealAction || "created_new",
                };
              } else {
                const [convDealRow] = await db
                  .select({
                    dealId: crmDeals.id,
                    dealTitle: crmDeals.title,
                    createdAt: crmDeals.createdAt,
                  })
                  .from(crmConversationDeals)
                  .innerJoin(
                    crmDeals,
                    and(
                      eq(crmConversationDeals.dealId, crmDeals.id),
                      eq(crmDeals.tenantId, tenantId),
                    ),
                  )
                  .where(
                    and(
                      eq(crmConversationDeals.tenantId, tenantId),
                      eq(crmConversationDeals.conversationId, fs.conversationId),
                    ),
                  )
                  .orderBy(desc(crmDeals.createdAt))
                  .limit(1);

                if (convDealRow) {
                  linkedDeal = {
                    dealId: convDealRow.dealId,
                    dealTitle: convDealRow.dealTitle,
                    createdAt: safeFormatIso(convDealRow.createdAt),
                  };
                }
              }

              const previousTriages = Array.isArray(meta.previousTriages) ? [...meta.previousTriages] : [];

              const sessionObj = {
                id: fs.id,
                conversationId: fs.conversationId,
                contactName: resolvedContactName,
                contactAvatar: contact?.avatar || null,
                company: companyVal,
                phone: contact?.phone || "",
                currentStep: fs.currentStep,
                collectedData,
                startedAt: safeFormatIso(fs.startedAt),
                completedAt: fs.completedAt ? safeFormatIso(fs.completedAt) : null,
                status,
                outcome: fs.outcome || undefined,
                responsibleName,
                unreadCount: conv?.unreadCount || 0,
                channel: contact?.mainChannel || "whatsapp",
                funnelStage: meta.funnelStage || meta.targetArea || undefined,
                targetFunnel: meta.targetFunnel || collectedData["SETOR / FUNIL DE DESTINO"]?.value || undefined,
                linkedDeal,
                previousTriages,
                messages: formattedMessages.length > 0 ? formattedMessages : [
                  {
                    sender: "bot",
                    senderName: persona.name,
                    text: "Atendimento em andamento...",
                    time: "Agora",
                    date: safeFormatDate(fs.startedAt),
                    sentAt: safeFormatIso(fs.startedAt),
                  }
                ],
              };

              sessions.push(sessionObj);
              sessionsByConvId.set(fs.conversationId, sessionObj);
            } catch (innerErr) {
              console.warn("[api/valentina/sdr] Erro ao processar flowState individual:", innerErr);
            }
          }
        } catch (err) {
          console.warn("[api/valentina/sdr] Erro ao buscar agentFlowStates:", err);
        }

        // 3. Buscar conversas que estão em queueState === "automacao" mas ainda não geraram agentFlowStates
        try {
          const allConvs = await db
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                eq(conversations.queueState, "automacao"),
              ),
            )
            .orderBy(desc(conversations.lastMessageTime))
            .limit(30);

          for (const c of allConvs) {
            if (c.id === "tec-1" || c.id === "tec-2" || c.id === "val-1" || c.id === "val-2") continue;

            if (!addedConvIds.has(c.id)) {
              try {
                addedConvIds.add(c.id);

                const contact = await db.query.contacts.findFirst({
                  where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, c.contactId), dEq(t.tenantId, tenantId)),
                });

                const operator = c.operatorId
                  ? operatorsById.get(c.operatorId) ||
                    (await db.query.operators.findFirst({
                      where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, c.operatorId!), dEq(t.tenantId, tenantId)),
                    })) ||
                    null
                  : null;

                const recentMsgsDesc = await db
                  .select()
                  .from(messages)
                  .where(and(eq(messages.conversationId, c.id), eq(messages.tenantId, tenantId)))
                  .orderBy(desc(messages.sentAt))
                  .limit(200);
                const realMsgs = recentMsgsDesc.reverse();

                const resolvedContactName = contact?.name || "Contato WhatsApp";
                const formattedMessages = formatConversationMessages(realMsgs, operator, resolvedContactName);

                const isFinished = c.queueState === "finalizados";

                const sessionObj = {
                  id: `fs-auto-${c.id}`,
                  conversationId: c.id,
                  contactName: resolvedContactName,
                  contactAvatar: contact?.avatar || null,
                  company: (contact?.cnpjDetails as any)?.razaoSocial || "Empresa não informada",
                  phone: contact?.phone || "",
                  currentStep: isFinished ? "Concluído" : "Em Qualificação",
                  collectedData: {},
                  startedAt: safeFormatIso(c.createdAt),
                  completedAt: null,
                  status: isFinished ? "completed" : "active",
                  outcome: isFinished ? "completed" : "in_progress",
                  responsibleName: operator?.name || "IA (Em Triagem)",
                  unreadCount: c.unreadCount || 0,
                  channel: contact?.mainChannel || "whatsapp",
                  funnelStage: "triagem",
                  previousTriages: [],
                  messages: formattedMessages.length > 0 ? formattedMessages : [
                    {
                      sender: "bot",
                      senderName: persona.name,
                      text: "Atendimento iniciado...",
                      time: "Agora",
                      date: safeFormatDate(c.createdAt),
                      sentAt: safeFormatIso(c.createdAt),
                    }
                  ],
                };

                sessions.push(sessionObj);
                sessionsByConvId.set(c.id, sessionObj);
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
