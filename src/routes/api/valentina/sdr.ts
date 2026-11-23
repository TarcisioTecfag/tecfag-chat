import crypto from "node:crypto";
import zlib from "node:zlib";
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
  crmDealContacts,
} from "../../../db/schema";
import { eq, and, desc, inArray, isNotNull, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import { projectIndustrialMonitoring } from "../../../lib/triage/industrial-monitor";
import { readAgentMonitoringSummary, readLatestSdrFlows } from "../../../lib/triage/agent-monitor-store";
import { stopIndustrialCycle } from "../../../lib/triage/industrial-cycle-stop";
import {
  computeIndustrialTriageProgress,
  resolveEffectiveIndustrialSubflow,
} from "../../../lib/triage/industrial-policy";
import {
  applyKnownClientConfirmationToData,
  isValidKnownCompanyName,
} from "../../../lib/triage/known-client-lookup";
import {
  batchLookupKnownClientsByPhoneOrContact,
  lookupKnownClientByPhoneOrContact,
} from "../../../lib/triage/known-client-db";
import { syncContactDataFromTriage } from "../../../lib/valentina/sdr-engine";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
  "Access-Control-Expose-Headers": "ETag",
};

/**
 * Gera ETag fraco estável para o payload do SDR (ignorando campos voláteis como `generatedAt`),
 * permitindo respostas `304 Not Modified` (0 bytes) em internet lenta quando nada mudou.
 */
export function computeStableSdrEtag(jsonForHash: string): string {
  const digest = crypto.createHash("sha1").update(jsonForHash).digest("hex").slice(0, 20);
  return `W/"sdr-${digest}"`;
}

function etagMatchesHeader(ifNoneMatch: string | null, currentEtag: string): boolean {
  if (!ifNoneMatch) return false;
  const normalize = (v: string) => v.trim().replace(/^W\//i, "");
  const target = normalize(currentEtag);
  return ifNoneMatch
    .split(",")
    .some((part) => {
      const clean = part.trim();
      return clean === "*" || normalize(clean) === target;
    });
}

export function buildSdrJsonResponse(
  request: Request,
  payload: unknown,
  etagPayload?: unknown,
): Response {
  const bodyJson = JSON.stringify(payload);
  const hashJson = etagPayload !== undefined ? JSON.stringify(etagPayload) : bodyJson;
  const etag = computeStableSdrEtag(hashJson);

  if (etagMatchesHeader(request.headers.get("if-none-match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        ...corsHeaders,
        ETag: etag,
        "Cache-Control": "private, no-cache",
        Vary: "Accept-Encoding",
      },
    });
  }

  const acceptEncoding = (request.headers.get("accept-encoding") || "").toLowerCase();
  const rawBuffer = Buffer.from(bodyJson, "utf8");
  if (acceptEncoding.includes("gzip") && rawBuffer.byteLength > 1024) {
    const gzipped = zlib.gzipSync(rawBuffer, { level: 6 });
    return new Response(gzipped, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "gzip",
        ETag: etag,
        "Cache-Control": "private, no-cache",
        Vary: "Accept-Encoding",
      },
    });
  }

  return new Response(rawBuffer, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      "Cache-Control": "private, no-cache",
      Vary: "Accept-Encoding",
    },
  });
}

function canAccessSdrApi(session: {
  operator: { role: string };
  permissions?: { valentina?: { canAccessSdr?: boolean } } | null;
}): boolean {
  return (
    session.operator.role === "admin" ||
    session.permissions?.valentina?.canAccessSdr === true
  );
}

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

function parseMediaInfo(
  content: string,
  mediaUrl?: string | null,
  mediaType?: string | null,
  fileName?: string | null,
) {
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

export type SdrResolvedStatus =
  | "active"
  | "awaiting_approval"
  | "completed"
  | "abandoned"
  | "stopped"
  | "manual";

export function resolveFaithfulSdrStatus(
  outcome: string | null | undefined,
  monitoringState?: string | null,
): SdrResolvedStatus {
  // Desfechos explícitos do ciclo de triagem NUNCA podem ser mascarados como "completed"
  if (outcome === "abandoned") return "abandoned";
  if (outcome === "stopped" || outcome === "escalated") return "stopped";
  if (outcome === "completed" || outcome === "transferred") return "completed";

  if (monitoringState) {
    if (monitoringState === "awaiting_approval") return "awaiting_approval";
    if (monitoringState === "no_response") return "abandoned";
    if (monitoringState === "stopped") return "stopped";
    if (monitoringState === "transferred" || monitoringState === "resolved") return "completed";
    if (
      monitoringState === "manual" ||
      monitoringState === "manual_queue" ||
      monitoringState === "closed" ||
      monitoringState === "continued"
    ) {
      return "manual";
    }
    return "active";
  }

  return "active";
}

export function resolveCleanTargetFunnel(
  meta: Record<string, any> | null | undefined,
  collectedData: Record<string, any> | null | undefined,
): string | undefined {
  const fromMeta = typeof meta?.targetFunnel === "string" ? meta.targetFunnel.trim() : "";
  if (fromMeta && !/^aguardando/i.test(fromMeta)) return fromMeta;

  const entry = collectedData?.["SETOR / FUNIL DE DESTINO"];
  if (entry && entry.status === "filled" && typeof entry.value === "string") {
    const val = entry.value.trim();
    if (val && !/^aguardando/i.test(val)) return val;
  }

  return undefined;
}

export const Route = createFileRoute("/api/valentina/sdr")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Configurações do SDR + Sessões em Lote (Zero N+1) ou Mensagens sob Demanda ──
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (!canAccessSdrApi(session)) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para acessar o módulo SDR.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const persona = getAiPersona(tenantId);
        const isIndustrial = persona.triagePolicy === "industrial";
        const url = new URL(request.url);
        const onDemandConversationId = (url.searchParams.get("conversationId") || "").trim();
        const selectedConversationId = (url.searchParams.get("selectedConversationId") || "").trim();
        const includeMessagesParam = (url.searchParams.get("includeMessages") || "").trim().toLowerCase();
        const includeMessages = includeMessagesParam !== "0" && includeMessagesParam !== "false";

        // Mapa de operadores do tenant (populado em paralelo com as queries principais)
        const operatorsById = new Map<string, { id: string; name: string; avatar: string | null }>();
        const operatorsByName = new Map<string, { id: string; name: string; avatar: string | null }>();
        const populateOperators = (tenantOps: Array<{ id: string; name: string; avatar: string | null }>) => {
          for (const op of tenantOps) {
            operatorsById.set(op.id, op);
            if (op.name) {
              operatorsByName.set(op.name.trim().toLowerCase(), op);
            }
          }
        };
        const fetchTenantOperators = () =>
          db
            .select({
              id: operators.id,
              name: operators.name,
              avatar: operators.avatar,
            })
            .from(operators)
            .where(eq(operators.tenantId, tenantId))
            .catch((err) => {
              console.warn("[api/valentina/sdr] Erro ao carregar operadores do tenant:", err);
              return [] as Array<{ id: string; name: string; avatar: string | null }>;
            });

        const resolveConversationOperator = (
          convOperatorId?: string | null,
          meta?: Record<string, any>,
          walletOperatorId?: string | null,
          dealOperatorId?: string | null,
          rawMsgs?: any[],
        ) => {
          if (isIndustrial) {
            return convOperatorId ? operatorsById.get(convOperatorId) || null : null;
          }
          const candidateIds = [
            convOperatorId,
            meta?.allocatedOperatorId,
            dealOperatorId,
            walletOperatorId,
          ].filter(Boolean) as string[];

          for (const cid of candidateIds) {
            const found = operatorsById.get(String(cid));
            if (found) return found;
          }

          if (meta?.allocatedOperatorName) {
            const byAllocName = operatorsByName.get(String(meta.allocatedOperatorName).trim().toLowerCase());
            if (byAllocName) return byAllocName;
          }

          if (Array.isArray(rawMsgs)) {
            for (let i = rawMsgs.length - 1; i >= 0; i--) {
              const m = rawMsgs[i];
              if (m?.senderType !== "agent") continue;
              const mOpId = (m.metaDetails as any)?.operatorId;
              if (mOpId && operatorsById.has(String(mOpId))) {
                return operatorsById.get(String(mOpId))!;
              }
              if (m?.senderName && m.senderName !== "Operador") {
                const byMsgName = operatorsByName.get(String(m.senderName).trim().toLowerCase());
                if (byMsgName) return byMsgName;
              }
            }
          }

          return null;
        };

        const formatConversationMessages = (
          rawMsgs: any[],
          defaultOperator: { id: string; name: string; avatar: string | null } | null,
          contactName: string,
        ) => {
          return rawMsgs.map((m: any) => {
            const mediaInfo = parseMediaInfo(m.content, m.mediaUrl, m.mediaType, m.fileName);
            const rawText = (m.content || "").trim();
            const isCycleReset =
              rawText.toLowerCase() === "!reset" ||
              rawText.includes("Fluxo de triagem reiniciado") ||
              rawText.includes("Triagem anterior encerrada");
            const isSystemMsg = m.senderType === "system" || isCycleReset;

            let sender: "client" | "bot" | "agent" | "system" = "bot";
            if (isSystemMsg) {
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
              const byName =
                m.senderName && m.senderName !== "Operador"
                  ? operatorsByName.get(String(m.senderName).trim().toLowerCase())
                  : undefined;
              // Nunca atribui ao operador que está apenas visualizando a tela (sem currentSessionOp)
              const resolvedOp = byId || byName || defaultOperator || null;

              const cleanMsgSenderName =
                m.senderName && String(m.senderName).trim().toLowerCase() !== "operador"
                  ? String(m.senderName).trim()
                  : null;

              senderName = resolvedOp?.name || cleanMsgSenderName || "Operador";
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
              isCycleReset,
              mediaUrl: mediaInfo.mediaUrl,
              mediaType: mediaInfo.mediaType,
              fileName: mediaInfo.fileName,
            };
          });
        };

        const messageSelectColumns = {
          id: messages.id,
          senderType: messages.senderType,
          senderName: messages.senderName,
          content: messages.content,
          sentAt: messages.sentAt,
          isInternalNote: messages.isInternalNote,
          metaDetails: messages.metaDetails,
        };

        // ── MODO SOB DEMANDA: Mensagens completas de 1 conversa específica ──────
        if (onDemandConversationId) {
          try {
            const [convRows, tenantOps, recentMsgsDesc] = await Promise.all([
              db
                .select({
                  id: conversations.id,
                  contactId: conversations.contactId,
                  operatorId: conversations.operatorId,
                })
                .from(conversations)
                .where(
                  and(
                    eq(conversations.id, onDemandConversationId),
                    eq(conversations.tenantId, tenantId),
                  ),
                )
                .limit(1),
              fetchTenantOperators(),
              db
                .select(messageSelectColumns)
                .from(messages)
                .where(
                  and(
                    eq(messages.conversationId, onDemandConversationId),
                    eq(messages.tenantId, tenantId),
                    isIndustrial ? sql`${messages.metaDetails}->'industrialTriage' IS NULL` : undefined,
                  ),
                )
                .orderBy(desc(messages.sentAt))
                .limit(200),
            ]);

            const conv = convRows[0];
            if (!conv) {
              return new Response(
                JSON.stringify({ error: "Conversa não encontrada.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            populateOperators(tenantOps);

            const [contactRow] = conv.contactId
              ? await db
                  .select({ name: contacts.name })
                  .from(contacts)
                  .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)))
                  .limit(1)
              : [];

            const realMsgs = recentMsgsDesc.reverse();
            const defaultOp = conv.operatorId ? operatorsById.get(conv.operatorId) || null : null;
            const formattedMessages = formatConversationMessages(
              realMsgs,
              defaultOp,
              contactRow?.name || "Contato WhatsApp",
            );

            return buildSdrJsonResponse(request, {
              conversationId: onDemandConversationId,
              messages: formattedMessages,
            });
          } catch (err) {
            console.error("[api/valentina/sdr] Erro ao carregar mensagens sob demanda:", err);
            return new Response(
              JSON.stringify({ error: "Erro ao carregar mensagens da conversa." }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }

        // ── MODO LISTAGEM OTIMIZADO (Batch Queries — Zero N+1 + ETag + Gzip) ────
        let config = { enabled: false };

        const [tenantOps, dbConfig, flowStates, automacaoConvs, monitoringSummary] = await Promise.all([
          fetchTenantOperators(),
          db.query.agentConfigs
            .findFirst({
              where: (table, { eq: dEq, and: dAnd }) =>
                dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
            })
            .catch((err) => {
              console.warn("[api/valentina/sdr] Erro ao buscar agentConfigs:", err);
              return null;
            }),
          (isIndustrial
            ? readLatestSdrFlows(db, tenantId, 100)
            : db
                .select()
                .from(agentFlowStates)
                .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.agentType, "sdr")))
                .orderBy(desc(agentFlowStates.lastInteractionAt))
                .limit(100)
          ).catch((err) => {
            console.warn("[api/valentina/sdr] Erro ao buscar agentFlowStates:", err);
            return [] as (typeof agentFlowStates.$inferSelect)[];
          }),
          db
            .select({
              id: conversations.id,
              contactId: conversations.contactId,
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
              unreadCount: conversations.unreadCount,
              lastMessageTime: conversations.lastMessageTime,
              createdAt: conversations.createdAt,
            })
            .from(conversations)
            .where(and(eq(conversations.tenantId, tenantId), eq(conversations.queueState, "automacao")))
            .orderBy(desc(conversations.lastMessageTime))
            .limit(30)
            .catch((err) => {
              console.warn("[api/valentina/sdr] Erro ao buscar conversations automacao:", err);
              return [] as Array<{
                id: string;
                contactId: string;
                operatorId: string | null;
                queueState: string;
                unreadCount: number;
                lastMessageTime: Date | null;
                createdAt: Date;
              }>;
            }),
          readAgentMonitoringSummary(db, tenantId).catch((error) => {
            console.error("[api/valentina/sdr] Métricas indisponíveis:", error);
            return { available: false as const, reason: "Métricas temporariamente indisponíveis." };
          }),
        ]);

        populateOperators(tenantOps);

        if (dbConfig) {
          config = { enabled: dbConfig.enabled === 1 };
        }

        // Deduplicar flowStates por conversationId preservando ciclos anteriores
        const primaryFlows: (typeof agentFlowStates.$inferSelect)[] = [];
        const previousTriagesByConv = new Map<string, any[]>();
        const seenFlowConvIds = new Set<string>();

        for (const fs of flowStates) {
          if (seenFlowConvIds.has(fs.conversationId)) {
            const list = previousTriagesByConv.get(fs.conversationId) || [];
            if (!list.some((p) => p.id === fs.id)) {
              const fsMeta = (fs.metadata as Record<string, any>) || {};
              const fsData = (fs.collectedData as Record<string, any>) || {};
              list.push({
                id: fs.id,
                startedAt: safeFormatIso(fs.startedAt),
                completedAt: fs.completedAt
                  ? safeFormatIso(fs.completedAt)
                  : safeFormatIso(fs.lastInteractionAt),
                outcome: fs.outcome || "completed",
                targetFunnel: resolveCleanTargetFunnel(fsMeta, fsData),
                subflow: fsMeta.subflow || undefined,
                company: fsData["EMPRESA"]?.value || undefined,
                document: fsData["CNPJ OU CPF"]?.value || fsData["CNPJ"]?.value || undefined,
                clientName: fsData["NOME COMPLETO"]?.value || undefined,
                interest: fsData["MÁQUINA / PEÇA / INTERESSE"]?.value || undefined,
                responsibleName: fsMeta.allocatedOperatorName || undefined,
              });
              previousTriagesByConv.set(fs.conversationId, list);
            }
            continue;
          }
          seenFlowConvIds.add(fs.conversationId);
          primaryFlows.push(fs);
        }

        const orphanAutoConvs = automacaoConvs.filter(
          (c) =>
            !seenFlowConvIds.has(c.id) &&
            c.id !== "tec-1" &&
            c.id !== "tec-2" &&
            c.id !== "val-1" &&
            c.id !== "val-2",
        );

        const allConvIds = [
          ...new Set([
            ...primaryFlows.map((f) => f.conversationId),
            ...orphanAutoConvs.map((c) => c.id),
          ]),
        ];

        // Batch fetch conversations, contacts, linked deals e última msg (any + client)
        type SlimConvRow = {
          id: string;
          contactId: string;
          operatorId: string | null;
          queueState: string;
          unreadCount: number;
          lastMessageTime: Date | null;
          createdAt: Date;
        };
        type SlimContactRow = {
          id: string;
          name: string;
          phone: string | null;
          avatar: string | null;
          mainChannel: string | null;
          walletOperatorId: string | null;
          accountId: string | null;
          cnpj: string | null;
          cpf: string | null;
          cnpjDetails: unknown;
          customFields: unknown;
        };
        const convById = new Map<string, SlimConvRow>();
        const contactById = new Map<string, SlimContactRow>();
        const dealByConvId = new Map<
          string,
          { dealId: string; dealTitle: string; createdAt?: string; operatorId?: string | null; action?: string }
        >();
        const dealByContactId = new Map<
          string,
          { dealId: string; dealTitle: string; createdAt?: string; operatorId?: string | null }
        >();
        const lastAnyMsgByConv = new Map<string, { sentAt: Date; content: string; senderType: string }>();
        const lastClientMsgByConv = new Map<string, { sentAt: Date }>();

        if (allConvIds.length > 0) {
          const [convRows, convDealRows, lastAnyRows, lastClientRows] = await Promise.all([
            db
              .select({
                id: conversations.id,
                contactId: conversations.contactId,
                operatorId: conversations.operatorId,
                queueState: conversations.queueState,
                unreadCount: conversations.unreadCount,
                lastMessageTime: conversations.lastMessageTime,
                createdAt: conversations.createdAt,
              })
              .from(conversations)
              .where(and(eq(conversations.tenantId, tenantId), inArray(conversations.id, allConvIds))),
            db
              .select({
                conversationId: crmConversationDeals.conversationId,
                dealId: crmDeals.id,
                dealTitle: crmDeals.title,
                createdAt: crmDeals.createdAt,
                operatorId: crmDeals.operatorId,
              })
              .from(crmConversationDeals)
              .innerJoin(
                crmDeals,
                and(eq(crmConversationDeals.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)),
              )
              .where(
                and(
                  eq(crmConversationDeals.tenantId, tenantId),
                  inArray(crmConversationDeals.conversationId, allConvIds),
                  eq(crmConversationDeals.isActive, true),
                ),
              )
              .orderBy(desc(crmDeals.createdAt)),
            db
              .selectDistinctOn([messages.conversationId], {
                conversationId: messages.conversationId,
                sentAt: messages.sentAt,
                content: messages.content,
                senderType: messages.senderType,
              })
              .from(messages)
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  inArray(messages.conversationId, allConvIds),
                  isNotNull(messages.sentAt),
                  isIndustrial ? sql`${messages.metaDetails}->'industrialTriage' IS NULL` : undefined,
                ),
              )
              .orderBy(messages.conversationId, desc(messages.sentAt), desc(messages.id)),
            db
              .selectDistinctOn([messages.conversationId], {
                conversationId: messages.conversationId,
                sentAt: messages.sentAt,
              })
              .from(messages)
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  inArray(messages.conversationId, allConvIds),
                  eq(messages.senderType, "client"),
                  isNotNull(messages.sentAt),
                ),
              )
              .orderBy(messages.conversationId, desc(messages.sentAt), desc(messages.id)),
          ]);

          const contactIds = new Set<string>();
          for (const c of convRows) {
            convById.set(c.id, c);
            if (c.contactId) contactIds.add(c.contactId);
          }
          for (const d of convDealRows) {
            if (!dealByConvId.has(d.conversationId)) {
              dealByConvId.set(d.conversationId, {
                dealId: d.dealId,
                dealTitle: d.dealTitle,
                createdAt: safeFormatIso(d.createdAt),
                operatorId: d.operatorId || null,
              });
            }
          }
          for (const row of lastAnyRows) {
            lastAnyMsgByConv.set(row.conversationId, {
              sentAt: row.sentAt,
              content: row.content,
              senderType: row.senderType,
            });
          }
          for (const row of lastClientRows) {
            lastClientMsgByConv.set(row.conversationId, { sentAt: row.sentAt });
          }

          if (contactIds.size > 0) {
            const contactIdArr = [...contactIds];
            const [contactRows, contactDealRows] = await Promise.all([
              db
                .select({
                  id: contacts.id,
                  name: contacts.name,
                  phone: contacts.phone,
                  avatar: contacts.avatar,
                  mainChannel: contacts.mainChannel,
                  walletOperatorId: contacts.walletOperatorId,
                  accountId: contacts.accountId,
                  cnpj: contacts.cnpj,
                  cpf: contacts.cpf,
                  cnpjDetails: contacts.cnpjDetails,
                  customFields: contacts.customFields,
                })
                .from(contacts)
                .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, contactIdArr))),
              !isIndustrial
                ? db
                    .select({
                      contactId: crmDealContacts.contactId,
                      dealId: crmDeals.id,
                      dealTitle: crmDeals.title,
                      createdAt: crmDeals.createdAt,
                      operatorId: crmDeals.operatorId,
                    })
                    .from(crmDeals)
                    .innerJoin(
                      crmDealContacts,
                      and(
                        eq(crmDealContacts.dealId, crmDeals.id),
                        eq(crmDealContacts.tenantId, tenantId),
                      ),
                    )
                    .where(
                      and(
                        eq(crmDeals.tenantId, tenantId),
                        inArray(crmDealContacts.contactId, contactIdArr),
                      ),
                    )
                    .orderBy(desc(crmDeals.createdAt))
                : Promise.resolve([]),
            ]);

            for (const ct of contactRows) {
              contactById.set(ct.id, ct);
            }
            for (const cd of contactDealRows) {
              if (!dealByContactId.has(cd.contactId)) {
                dealByContactId.set(cd.contactId, {
                  dealId: cd.dealId,
                  dealTitle: cd.dealTitle,
                  createdAt: safeFormatIso(cd.createdAt),
                  operatorId: cd.operatorId || null,
                });
              }
            }
          }
        }

        // Batch lookup de clientes recorrentes (Zero N+1 — substitui até ~500 queries sequenciais por 1–3 queries em lote)
        const knownClientsBatchInput: Array<{
          key: string;
          contactId?: string | null;
          phone?: string | null;
          conversationId?: string | null;
          previousTriages?: Array<Record<string, any>> | null;
        }> = [];
        if (isIndustrial) {
          for (const fs of primaryFlows) {
            const meta = (fs.metadata as Record<string, any>) || {};
            if (meta.knownClient) continue;
            const conv = convById.get(fs.conversationId) || null;
            const contact = conv ? contactById.get(conv.contactId) || null : null;
            const previousTriages = [
              ...(Array.isArray(meta.previousTriages) ? meta.previousTriages : []),
              ...(previousTriagesByConv.get(fs.conversationId) || []),
            ];
            knownClientsBatchInput.push({
              key: `flow:${fs.id}`,
              contactId: conv?.contactId || null,
              phone: contact?.phone || null,
              conversationId: fs.conversationId,
              previousTriages,
            });
          }
          for (const c of orphanAutoConvs) {
            const contact = contactById.get(c.contactId) || null;
            knownClientsBatchInput.push({
              key: `orphan:${c.id}`,
              contactId: c.contactId,
              phone: contact?.phone || null,
              conversationId: c.id,
            });
          }
        }

        const batchKnownClientsByKey =
          isIndustrial && knownClientsBatchInput.length > 0
            ? await batchLookupKnownClientsByPhoneOrContact(
                tenantId,
                knownClientsBatchInput,
                contactById,
              )
            : new Map();

        // Pré-ordenar e determinar qual conversa única terá as 200 mensagens completas carregadas agora
        const sessions: any[] = [];

        // Montar sessões de agentFlowStates
        for (const fs of primaryFlows) {
          try {
            const conv = convById.get(fs.conversationId) || null;
            const contact = conv ? contactById.get(conv.contactId) || null : null;
            const meta = (fs.metadata as Record<string, any>) || {};
            const collectedData = (fs.collectedData as Record<string, any>) || {};

            const linkedDealRow =
              (!isIndustrial && meta?.localCrmDealId
                ? {
                    dealId: String(meta.localCrmDealId),
                    dealTitle: String(meta.localCrmDealTitle || "Negociação CRM Local"),
                    action: String(meta.localCrmDealAction || "created_new"),
                    operatorId: meta.allocatedOperatorId ? String(meta.allocatedOperatorId) : null,
                  }
                : null) ||
              dealByConvId.get(fs.conversationId) ||
              (!isIndustrial && conv?.contactId ? dealByContactId.get(conv.contactId) || null : null);

            const linkedDeal = linkedDealRow
              ? {
                  dealId: linkedDealRow.dealId,
                  dealTitle: linkedDealRow.dealTitle,
                  ...("action" in linkedDealRow && linkedDealRow.action
                    ? { action: linkedDealRow.action }
                    : {}),
                  ...("createdAt" in linkedDealRow && linkedDealRow.createdAt
                    ? { createdAt: linkedDealRow.createdAt }
                    : {}),
                }
              : null;

            const operator = resolveConversationOperator(
              conv?.operatorId,
              meta,
              contact?.walletOperatorId,
              linkedDealRow?.operatorId,
            );

            const resolvedContactName =
              contact?.name || collectedData["NOME COMPLETO"]?.value || "Contato WhatsApp";

            const monitoring = isIndustrial
              ? projectIndustrialMonitoring(fs, conv || null)
              : undefined;

            const status = resolveFaithfulSdrStatus(fs.outcome, monitoring?.state);

            let responsibleName = `${persona.name} IA (Em Triagem)`;
            if (status === "awaiting_approval") {
              responsibleName =
                monitoring?.pendingApproval?.suggestedOperatorName
                  ? `Aguardando aprovação → ${monitoring.pendingApproval.suggestedOperatorName}`
                  : "Aguardando Aprovação SDR";
            } else if (status === "completed") {
              responsibleName =
                operator?.name || meta.allocatedOperatorName || "Vendedor Alocado (Rodízio)";
            } else if (status === "stopped") {
              responsibleName = operator?.name || "Interrompido (Atendimento Manual)";
            } else if (status === "abandoned") {
              responsibleName = operator?.name || "Sem resposta do cliente";
            } else if (status === "manual") {
              responsibleName = operator?.name || "Atendimento humano";
            } else if (monitoring) {
              responsibleName =
                operator?.name ||
                (monitoring.state === "collecting" || monitoring.state === "ready"
                  ? `${persona.name} IA`
                  : "Sem responsável atribuído");
            }

            const previousTriages = [
              ...(Array.isArray(meta.previousTriages) ? meta.previousTriages : []),
              ...(previousTriagesByConv.get(fs.conversationId) || []),
            ];

            const knownClient = isIndustrial
              ? meta.knownClient || batchKnownClientsByKey.get(`flow:${fs.id}`) || null
              : null;

            const companyVal =
              (collectedData["EMPRESA"]?.status === "filled" ? collectedData["EMPRESA"]?.value : "") ||
              (collectedData["empresa"]?.status === "filled" ? collectedData["empresa"]?.value : "") ||
              (typeof collectedData["EMPRESA"] === "string" ? collectedData["EMPRESA"] : "") ||
              (contact?.cnpjDetails as any)?.razaoSocial ||
              (contact?.customFields as any)?.company ||
              knownClient?.companyName ||
              "Empresa não informada";

            const cleanTargetFunnel = resolveCleanTargetFunnel(meta, collectedData);

            const resolvedSubflow = isIndustrial
              ? resolveEffectiveIndustrialSubflow({
                  subflow: meta.subflow || null,
                  funnelStage: meta.funnelStage || meta.targetArea || null,
                  targetFunnel: cleanTargetFunnel || null,
                  collectedData,
                  company: companyVal !== "Empresa não informada" ? companyVal : null,
                  document:
                    collectedData["CNPJ OU CPF"]?.value ||
                    contact?.cnpj ||
                    contact?.cpf ||
                    knownClient?.document ||
                    null,
                  isCompleted: status === "completed",
                })
              : undefined;

            const industrialProgress = isIndustrial
              ? computeIndustrialTriageProgress({
                  subflow: resolvedSubflow || null,
                  funnelStage: meta.funnelStage || meta.targetArea || null,
                  targetFunnel: cleanTargetFunnel || null,
                  collectedData,
                  company: companyVal !== "Empresa não informada" ? companyVal : null,
                  document:
                    collectedData["CNPJ OU CPF"]?.value ||
                    contact?.cnpj ||
                    contact?.cpf ||
                    knownClient?.document ||
                    null,
                  isCompleted: status === "completed",
                })
              : null;

            const effectiveCollectedData = industrialProgress
              ? industrialProgress.adaptiveData
              : collectedData;

            const effectiveTargetFunnel = resolveCleanTargetFunnel(meta, effectiveCollectedData);

            const lastAny = lastAnyMsgByConv.get(fs.conversationId);
            const lastClient = lastClientMsgByConv.get(fs.conversationId);
            const lastMessageAtIso = lastAny
              ? safeFormatIso(lastAny.sentAt)
              : conv?.lastMessageTime
                ? safeFormatIso(conv.lastMessageTime)
                : safeFormatIso(fs.lastInteractionAt || fs.startedAt);
            const lastClientMessageAtIso = lastClient
              ? safeFormatIso(lastClient.sentAt)
              : lastMessageAtIso;

            const rawChannel = contact?.mainChannel || "whatsapp";
            const normalizedChannel =
              rawChannel === "livechat" || rawChannel === "site" ? "site" : "whatsapp";

            sessions.push({
              id: fs.id,
              conversationId: fs.conversationId,
              contactName: resolvedContactName,
              contactAvatar: contact?.avatar || null,
              company: companyVal,
              phone: contact?.phone || "",
              currentStep: fs.currentStep,
              collectedData: effectiveCollectedData,
              startedAt: safeFormatIso(fs.startedAt),
              completedAt: fs.completedAt ? safeFormatIso(fs.completedAt) : null,
              lastClientMessageAt: lastClientMessageAtIso,
              lastMessageAt: lastMessageAtIso,
              lastMessagePreview: lastAny?.content ? String(lastAny.content).slice(0, 160) : undefined,
              status,
              outcome: fs.outcome || undefined,
              responsibleName,
              unreadCount: conv?.unreadCount || 0,
              channel: normalizedChannel,
              subflow: resolvedSubflow || meta.subflow || undefined,
              funnelStage: meta.funnelStage || meta.targetArea || undefined,
              targetFunnel: effectiveTargetFunnel,
              ...(industrialProgress
                ? {
                    triageProgress: {
                      filledCount: industrialProgress.filledCount,
                      totalCount: industrialProgress.totalCount,
                      percentage: industrialProgress.percentage,
                      targetFields: industrialProgress.targetFields,
                    },
                  }
                : {}),
              ...(knownClient ? { knownClient } : {}),
              linkedDeal,
              ...(monitoring ? { monitoring } : {}),
              ...(monitoring?.pendingApproval ? { pendingApproval: monitoring.pendingApproval } : {}),
              previousTriages,
              messagesLoaded: false,
              messages: [],
              _defaultOperator: operator,
            });
          } catch (innerErr) {
            console.warn("[api/valentina/sdr] Erro ao processar flowState individual:", innerErr);
          }
        }

        // Montar sessões órfãs em queueState === "automacao"
        for (const c of orphanAutoConvs) {
          try {
            const contact = contactById.get(c.contactId) || null;
            const linkedDealRow =
              dealByConvId.get(c.id) ||
              (!isIndustrial ? dealByContactId.get(c.contactId) || null : null);
            const linkedDeal = linkedDealRow
              ? {
                  dealId: linkedDealRow.dealId,
                  dealTitle: linkedDealRow.dealTitle,
                  ...(linkedDealRow.createdAt ? { createdAt: linkedDealRow.createdAt } : {}),
                }
              : null;

            const operator = resolveConversationOperator(
              c.operatorId,
              undefined,
              contact?.walletOperatorId,
              linkedDealRow?.operatorId,
            );

            const resolvedContactName = contact?.name || "Contato WhatsApp";
            const lastAny = lastAnyMsgByConv.get(c.id);
            const lastClient = lastClientMsgByConv.get(c.id);
            const lastMessageAtIso = lastAny
              ? safeFormatIso(lastAny.sentAt)
              : safeFormatIso(c.lastMessageTime || c.createdAt);
            const lastClientMessageAtIso = lastClient
              ? safeFormatIso(lastClient.sentAt)
              : lastMessageAtIso;

            const knownClient = isIndustrial
              ? batchKnownClientsByKey.get(`orphan:${c.id}`) || null
              : null;

            const rawChannel = contact?.mainChannel || "whatsapp";
            const normalizedChannel =
              rawChannel === "livechat" || rawChannel === "site" ? "site" : "whatsapp";

            sessions.push({
              id: `fs-auto-${c.id}`,
              conversationId: c.id,
              contactName: resolvedContactName,
              contactAvatar: contact?.avatar || null,
              company:
                (contact?.cnpjDetails as any)?.razaoSocial ||
                (contact?.customFields as any)?.company ||
                knownClient?.companyName ||
                "Empresa não informada",
              phone: contact?.phone || "",
              currentStep: "Em Qualificação",
              collectedData: {},
              startedAt: safeFormatIso(c.createdAt),
              completedAt: null,
              lastClientMessageAt: lastClientMessageAtIso,
              lastMessageAt: lastMessageAtIso,
              lastMessagePreview: lastAny?.content ? String(lastAny.content).slice(0, 160) : undefined,
              status: "active",
              outcome: "in_progress",
              responsibleName: operator?.name || `${persona.name} IA (Em Triagem)`,
              unreadCount: c.unreadCount || 0,
              channel: normalizedChannel,
              funnelStage: "triagem",
              ...(knownClient ? { knownClient } : {}),
              linkedDeal,
              ...(isIndustrial
                ? {
                    monitoring: projectIndustrialMonitoring(
                      { startedAt: c.createdAt, outcome: "in_progress", metadata: {} },
                      c,
                    ),
                  }
                : {}),
              previousTriages: [],
              messagesLoaded: false,
              messages: [],
              _defaultOperator: operator,
            });
          } catch (innerErr) {
            console.warn("[api/valentina/sdr] Erro ao processar conversa automacao:", innerErr);
          }
        }

        // Ordenar sessões da mais recente para a mais antiga
        sessions.sort((a, b) => {
          const tsA = Date.parse(a.lastClientMessageAt || a.lastMessageAt || a.startedAt || "") || 0;
          const tsB = Date.parse(b.lastClientMessageAt || b.lastMessageAt || b.startedAt || "") || 0;
          return tsB - tsA;
        });

        // Carregar mensagens completas APENAS quando solicitado (modo Ao Vivo) e apenas da conversa selecionada
        const targetMsgSession = includeMessages
          ? (selectedConversationId
              ? sessions.find((s) => s.conversationId === selectedConversationId)
              : null) || sessions[0]
          : null;

        if (targetMsgSession) {
          try {
            const recentMsgsDesc = await db
              .select(messageSelectColumns)
              .from(messages)
              .where(
                and(
                  eq(messages.conversationId, targetMsgSession.conversationId),
                  eq(messages.tenantId, tenantId),
                  isIndustrial ? sql`${messages.metaDetails}->'industrialTriage' IS NULL` : undefined,
                ),
              )
              .orderBy(desc(messages.sentAt))
              .limit(200);
            const realMsgs = recentMsgsDesc.reverse();
            targetMsgSession.messages = formatConversationMessages(
              realMsgs,
              targetMsgSession._defaultOperator || null,
              targetMsgSession.contactName,
            );
            targetMsgSession.messagesLoaded = true;
          } catch (err) {
            console.warn("[api/valentina/sdr] Erro ao carregar mensagens da sessão selecionada:", err);
          }
        }

        // Remover helper interno antes de serializar
        for (const s of sessions) {
          delete s._defaultOperator;
        }

        // Excluir `generatedAt` do hash ETag para que polls sem alterações retornem `304 Not Modified` (0 bytes)
        const stableMonitoringForEtag =
          monitoringSummary && "generatedAt" in monitoringSummary
            ? { ...monitoringSummary, generatedAt: "" }
            : monitoringSummary;

        return buildSdrJsonResponse(
          request,
          { config, sessions, monitoringSummary },
          { config, sessions, monitoringSummary: stableMonitoringForEtag },
        );
      },

      // ── POST: Salvar configurações do SDR, Vincular Cliente Recorrente ou Interromper IA ──
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (!canAccessSdrApi(session)) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para operar o módulo SDR.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        try {
          const body = await request.json();
          const { action, conversationId, enabled } = body;

          // Ação de vincular/confirmar dados de cliente recorrente na triagem atual
          if (action === "link_known_client" && conversationId) {
            const [conv] = await db
              .select()
              .from(conversations)
              .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
              .limit(1);

            if (!conv) {
              return new Response(
                JSON.stringify({ error: "Conversa não encontrada ou não pertence a este tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            const contact = await db.query.contacts.findFirst({
              where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, conv.contactId), dEq(t.tenantId, tenantId)),
            });

            const flowState = await db.query.agentFlowStates.findFirst({
              where: (t, { eq: dEq, and: dAnd }) =>
                dAnd(dEq(t.tenantId, tenantId), dEq(t.conversationId, conversationId), dEq(t.agentType, "sdr")),
              orderBy: (t, { desc: dDesc }) => [dDesc(t.startedAt), dDesc(t.id)],
            });

            const meta = (flowState?.metadata as Record<string, any>) || {};
            const knownClient =
              (body.companyName && isValidKnownCompanyName(body.companyName)
                ? {
                    companyName: String(body.companyName).trim(),
                    document: body.document ? String(body.document).trim() : null,
                    contactName: body.contactName ? String(body.contactName).trim() : contact?.name || null,
                    accountId: body.accountId || contact?.accountId || null,
                    contactId: conv.contactId,
                    source: "contact_company" as const,
                  }
                : null) ||
              (await lookupKnownClientByPhoneOrContact(tenantId, {
                contactId: conv.contactId,
                phone: contact?.phone || null,
                conversationId,
                previousTriages: Array.isArray(meta.previousTriages) ? meta.previousTriages : null,
              }));

            if (!knownClient) {
              return new Response(
                JSON.stringify({
                  error: "Nenhum cadastro ou triagem anterior com empresa foi encontrado para este telefone.",
                  code: "NOT_FOUND",
                }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            const existingData = (flowState?.collectedData as Record<string, any>) || {};
            const enrichedData = applyKnownClientConfirmationToData(existingData, knownClient);

            const progress = computeIndustrialTriageProgress({
              subflow: meta.subflow || null,
              funnelStage: meta.funnelStage || null,
              targetFunnel: resolveCleanTargetFunnel(meta, enrichedData) || null,
              collectedData: enrichedData,
              company: knownClient.companyName,
              document: knownClient.document || null,
              isCompleted: flowState?.outcome === "completed" || flowState?.outcome === "transferred",
            });

            if (flowState) {
              const updatedMeta = {
                ...meta,
                stepNumber: progress.filledCount,
                totalSteps: progress.totalCount,
                knownClient: {
                  ...knownClient,
                  confirmed: true,
                },
              };
              await db
                .update(agentFlowStates)
                .set({
                  collectedData: enrichedData,
                  metadata: updatedMeta,
                  lastInteractionAt: new Date(),
                })
                .where(and(eq(agentFlowStates.id, flowState.id), eq(agentFlowStates.tenantId, tenantId)));
            }

            if (conv.contactId) {
              await syncContactDataFromTriage(
                tenantId,
                conv.contactId,
                enrichedData,
                undefined,
                knownClient.accountId || null,
              );
            }

            return new Response(
              JSON.stringify({
                success: true,
                knownClient: { ...knownClient, confirmed: true },
                collectedData: progress.adaptiveData,
                triageProgress: {
                  filledCount: progress.filledCount,
                  totalCount: progress.totalCount,
                  percentage: progress.percentage,
                  targetFields: progress.targetFields,
                },
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

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
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            try {
              const { SdrDebouncer } = await import("../../../lib/valentina/sdr-debouncer");
              SdrDebouncer.getInstance().clearSession(conversationId);
            } catch (err) {
              console.warn("[api/valentina/sdr] Erro ao limpar debouncer no stop:", err);
            }

            if (getAiPersona(tenantId).triagePolicy === "industrial") {
              await stopIndustrialCycle(db, tenantId, conversationId, session.operator.id);
            } else {
              await db
                .update(agentFlowStates)
                .set({
                  outcome: "stopped",
                  currentStep: "Interrompido Manualmente",
                  lastInteractionAt: new Date(),
                })
                .where(
                  and(
                    eq(agentFlowStates.conversationId, conversationId),
                    eq(agentFlowStates.tenantId, tenantId),
                    eq(agentFlowStates.outcome, "in_progress"),
                  ),
                );

              await db
                .update(conversations)
                .set({ queueState: "fila" })
                .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
            }

            return new Response(
              JSON.stringify({ success: true, message: "IA de triagem interrompida para esta conversa." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // Ação de Retomar a IA para uma conversa específica interrompida
          if (action === "resume" && conversationId) {
            const [conv] = await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
              .limit(1);

            if (!conv) {
              return new Response(
                JSON.stringify({ error: "Conversa não encontrada ou não pertence a este tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            const persona = getAiPersona(tenantId);
            if (persona.triagePolicy === "industrial") {
              const { resumeStoppedIndustrialFlow } = await import("../../../lib/triage/sdr-disabled-routing");
              const res = await resumeStoppedIndustrialFlow(
                db,
                tenantId,
                conversationId,
                session.operator.name || "Operador",
              );
              if (!res.resumed) {
                return new Response(
                  JSON.stringify({
                    error:
                      res.reason === "conversation_closed"
                        ? "Conversa já está finalizada."
                        : "Não foi possível retomar esta triagem.",
                  }),
                  { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
              }
              void import("../../../lib/valentina/sdr-recovery")
                .then(({ recoverIndustrialInterruptedTurns }) => recoverIndustrialInterruptedTurns())
                .catch(() => {});
              return new Response(
                JSON.stringify({
                  success: true,
                  currentStep: res.currentStep,
                  message: `Triagem do ${persona.name} retomada com sucesso.`,
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            await db
              .update(agentFlowStates)
              .set({
                outcome: "in_progress",
                currentStep: "Em Qualificação",
                completedAt: null,
                lastInteractionAt: new Date(),
              })
              .where(
                and(
                  eq(agentFlowStates.conversationId, conversationId),
                  eq(agentFlowStates.tenantId, tenantId),
                  eq(agentFlowStates.agentType, "sdr"),
                ),
              );
            await db
              .update(conversations)
              .set({ queueState: "automacao", operatorId: null, updatedAt: new Date() })
              .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));

            return new Response(
              JSON.stringify({ success: true, message: `Triagem do ${persona.name} retomada com sucesso.` }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // Ação de Reverter em lote triagens interrompidas por desativação acidental do SDR
          if (action === "restore_sdr_disabled") {
            const { restoreSdrDisabledFlows } = await import("../../../lib/triage/sdr-disabled-routing");
            const result = await restoreSdrDisabledFlows(db, tenantId, {
              includeRouted: Boolean(body.includeRouted),
            });
            if (result.restoredCount > 0) {
              void import("../../../lib/valentina/sdr-recovery")
                .then(({ recoverIndustrialInterruptedTurns }) => recoverIndustrialInterruptedTurns())
                .catch(() => {});
            }
            return new Response(
              JSON.stringify({
                success: true,
                ...result,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // Apenas administradores podem salvar/alterar configurações globais de SDR
          if (session.operator.role !== "admin") {
            return new Response(
              JSON.stringify({
                error: "Permissão insuficiente. Apenas administradores podem alterar configurações do SDR.",
                code: "FORBIDDEN",
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          const existingConfig = await db.query.agentConfigs.findFirst({
            where: (table, { eq: dEq, and: dAnd }) =>
              dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
          });

          const currentJson = (existingConfig?.config as Record<string, any>) || {};

          if (existingConfig) {
            await db
              .update(agentConfigs)
              .set({
                enabled: enabled !== undefined ? (enabled ? 1 : 0) : existingConfig.enabled,
                config: currentJson,
                updatedAt: new Date(),
              })
              .where(and(eq(agentConfigs.id, existingConfig.id), eq(agentConfigs.tenantId, tenantId)));
          } else {
            await db.insert(agentConfigs).values({
              id: `cfg-sdr-${tenantId}-${Date.now()}`,
              tenantId,
              agentType: "sdr",
              enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1,
              config: currentJson,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          if (enabled === false) {
            void import("../../../lib/triage/sdr-disabled-routing")
              .then(({ sweepUnassignedAutomacaoWhenSdrDisabled }) =>
                sweepUnassignedAutomacaoWhenSdrDisabled(db, tenantId),
              )
              .catch((sweepErr) =>
                console.warn(
                  "[api/valentina/sdr] Falha ao varrer conversas órfãs em automacao:",
                  sweepErr,
                ),
              );
          } else if (enabled === true) {
            void import("../../../lib/triage/sdr-disabled-routing")
              .then(async ({ restoreSdrDisabledFlows }) => {
                const res = await restoreSdrDisabledFlows(db, tenantId, { includeRouted: false });
                if (res.restoredCount > 0) {
                  const { recoverIndustrialInterruptedTurns } = await import(
                    "../../../lib/valentina/sdr-recovery"
                  );
                  await recoverIndustrialInterruptedTurns();
                }
              })
              .catch((restoreErr) =>
                console.warn(
                  "[api/valentina/sdr] Falha ao restaurar fluxos após reativar SDR:",
                  restoreErr,
                ),
              );
          }

          return new Response(
            JSON.stringify({ success: true, enabled: enabled !== undefined ? Boolean(enabled) : true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
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
