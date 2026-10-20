import { isSdrTenant, getAiPersona } from "../ai-persona";
import { db } from "../../db";
import { agentConfigs, agentFlowStates, conversations, messages, contacts } from "../../db/schema";
import { eq, and, gte, desc, isNull, ne, sql } from "drizzle-orm";
import { SdrEngine } from "./sdr-engine";
import { SdrDebouncer, type QueuedMessageItem } from "./sdr-debouncer";
import { isSiteConversationId } from "../livechat/site-channel-policy";
import {
  evaluateIndustrialTurnRecovery,
  selectRecentCycleMessages,
} from "../triage/industrial-silence-policy";

// Janela de recuperacao: so reativa conversas interrompidas nas ultimas 24 horas.
const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Recuperação periódica multi-canal (Meta, Baileys e Site) para tenants industriais.
 * Não depende de `connection.open` do Baileys e respeita janela de debounce (45s),
 * backoff exponencial e limite máximo de 3 tentativas por mensagem do cliente.
 */
export async function recoverIndustrialInterruptedTurns(nowOverride?: Date): Promise<number> {
  const now = nowOverride || new Date();
  const windowStart = new Date(now.getTime() - RECOVERY_WINDOW_MS);
  let recoveredCount = 0;

  try {
    const enabledConfigs = await db
      .select({ tenantId: agentConfigs.tenantId, enabled: agentConfigs.enabled })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.agentType, "sdr"), eq(agentConfigs.enabled, 1)));

    for (const cfg of enabledConfigs) {
      const tenantId = cfg.tenantId;
      if (!isSdrTenant(tenantId)) continue;
      if (getAiPersona(tenantId).triagePolicy !== "industrial") continue;

      const candidateConvs = await db
        .select({
          id: conversations.id,
          contactId: conversations.contactId,
          queueState: conversations.queueState,
          operatorId: conversations.operatorId,
          lastMessageTime: conversations.lastMessageTime,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.queueState, "automacao"),
            isNull(conversations.operatorId),
            gte(conversations.lastMessageTime, windowStart),
          ),
        );

      for (const conv of candidateConvs) {
        try {
          const isBusy = SdrDebouncer.getInstance().isBusy(conv.id);
          if (isBusy) continue;

          let flow = await db.query.agentFlowStates.findFirst({
            where: (t, { eq: dEq, and: dAnd }) =>
              dAnd(
                dEq(t.tenantId, tenantId),
                dEq(t.conversationId, conv.id),
                dEq(t.agentType, "sdr"),
              ),
          });

          const rawRecentMsgs = await db
            .select({
              id: messages.id,
              senderType: messages.senderType,
              sentAt: messages.sentAt,
              content: messages.content,
            })
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.conversationId, conv.id),
                ne(messages.content, "!reset"),
                ...(flow?.startedAt ? [gte(messages.sentAt, flow.startedAt)] : []),
              ),
            )
            .orderBy(desc(messages.sentAt), desc(messages.id))
            .limit(20);

          const cycleMsgs = selectRecentCycleMessages(rawRecentMsgs, flow?.startedAt || null, 20);

          const decision = evaluateIndustrialTurnRecovery({
            now,
            isDebouncerBusy: false,
            conversation: {
              id: conv.id,
              queueState: conv.queueState,
              operatorId: conv.operatorId,
            },
            flow: flow
              ? {
                  id: flow.id,
                  startedAt: flow.startedAt,
                  outcome: flow.outcome,
                  completedAt: flow.completedAt,
                  metadata: (flow.metadata as Record<string, unknown>) || {},
                }
              : null,
            recentMessages: cycleMsgs,
          });

          if (!decision.shouldRecover || !decision.lastClientMessageId) {
            continue;
          }

          // Claim atômico da tentativa de recovery para evitar disparo concorrente
          if (!flow) {
            const newFlowId = `fs-sdr-${tenantId}-${conv.id}`;
            const firstMsgTs = cycleMsgs[0]?.sentAt
              ? new Date(new Date(cycleMsgs[0].sentAt).getTime() - 5000)
              : new Date(now.getTime() - 60000);
            await db
              .insert(agentFlowStates)
              .values({
                id: newFlowId,
                tenantId,
                conversationId: conv.id,
                agentType: "sdr",
                currentStep: "Em Qualificação",
                collectedData: {},
                metadata: {
                  stepNumber: 1,
                  totalSteps: 7,
                  followUpStage: 0,
                  funnelStage: "triagem",
                  targetFunnel: null,
                  turnRecoveryMessageId: decision.lastClientMessageId,
                  turnRecoveryAttempts: decision.nextAttemptNumber,
                  turnRecoveryNextAttemptAt: decision.nextAttemptAtIso,
                },
                startedAt: firstMsgTs,
                lastInteractionAt: now,
                outcome: "in_progress",
              })
              .onConflictDoNothing();

            flow = await db.query.agentFlowStates.findFirst({
              where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, newFlowId), dEq(t.tenantId, tenantId)),
            });
            if (!flow) continue;
          } else {
            const meta = (flow.metadata as Record<string, unknown>) || {};
            const nextMeta = {
              ...meta,
              turnRecoveryMessageId: decision.lastClientMessageId,
              turnRecoveryAttempts: decision.nextAttemptNumber,
              turnRecoveryNextAttemptAt: decision.nextAttemptAtIso,
            };
            const claimed = await db
              .update(agentFlowStates)
              .set({
                metadata: nextMeta,
              })
              .where(
                and(
                  eq(agentFlowStates.id, flow.id),
                  eq(agentFlowStates.tenantId, tenantId),
                  isNull(agentFlowStates.completedAt),
                  sql`(${agentFlowStates.metadata}->>'turnRecoveryMessageId' IS DISTINCT FROM ${decision.lastClientMessageId} OR COALESCE((${agentFlowStates.metadata}->>'turnRecoveryNextAttemptAt')::timestamptz, '1970-01-01T00:00:00.000Z'::timestamptz) <= ${now.toISOString()}::timestamptz)`,
                ),
              )
              .returning({ id: agentFlowStates.id });
            if (claimed.length === 0) continue;
          }

          // Coletar lote de mensagens do cliente após a última resposta de bot/agent
          let lastNonClientIdx = -1;
          for (let i = cycleMsgs.length - 1; i >= 0; i--) {
            if (cycleMsgs[i].senderType === "bot" || cycleMsgs[i].senderType === "agent") {
              lastNonClientIdx = i;
              break;
            }
          }
          const pendingClientMsgs = cycleMsgs
            .slice(lastNonClientIdx + 1)
            .filter((m) => m.senderType === "client");
          if (pendingClientMsgs.length === 0) continue;

          let contactPhone = conv.contactId.replace(/^c-/, "");
          if (isSiteConversationId(conv.id)) {
            contactPhone = conv.contactId;
          } else if (conv.contactId) {
            const [cnt] = await db
              .select({ phone: contacts.phone, whatsappUserId: contacts.whatsappUserId })
              .from(contacts)
              .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)))
              .limit(1);
            if (cnt?.phone) contactPhone = cnt.phone;
            else if (cnt?.whatsappUserId) contactPhone = cnt.whatsappUserId;
          }

          const batchItems: QueuedMessageItem[] = pendingClientMsgs.map((m) => ({
            messageId: m.id,
            text: m.content || "",
            mediaType: "text" as const,
            receivedAt: new Date(m.sentAt),
          }));

          recoveredCount++;
          const abortController = new AbortController();
          void SdrEngine.getInstance()
            .processBatchMessages(tenantId, conv.id, contactPhone, batchItems, abortController.signal)
            .catch((err: any) =>
              console.error(
                `[SdrRecovery][${tenantId}] Erro ao recuperar turno interrompido (${conv.id}):`,
                err?.message || err,
              ),
            );
        } catch (convErr: any) {
          console.error(
            `[SdrRecovery][${tenantId}] Erro ao avaliar conversa ${conv.id}:`,
            convErr?.message || convErr,
          );
        }
      }
    }
  } catch (err: any) {
    console.error("[SdrRecovery] Erro no ciclo recoverIndustrialInterruptedTurns:", err?.message || err);
  }

  return recoveredCount;
}

/**
 * Executa no evento connection.open do Baileys (apos deploy ou reconexao).
 * Detecta triagens SDR interrompidas e as reinicia silenciosamente, sem avisar o cliente.
 * A Valentina continua exatamente de onde parou.
 *
 * Criterios de reativacao:
 *   1. outcome = "in_progress" (triagem nao concluida)
 *   2. lastInteractionAt dentro dos ultimos 24 horas
 *   3. Ultima mensagem da conversa eh do cliente (Valentina nao respondeu)
 */
export async function recoverInterruptedConversations(tenantId: string): Promise<void> {
  if (!isSdrTenant(tenantId)) return;
  if (getAiPersona(tenantId).triagePolicy === "industrial") {
    await recoverIndustrialInterruptedTurns();
    return;
  }
  const tag = `[SdrRecovery][${tenantId}]`;
  try {
    const windowStart = new Date(Date.now() - RECOVERY_WINDOW_MS);

    const activeSdrFlows = await db
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.agentType, "sdr"),
          eq(agentFlowStates.outcome as any, "in_progress"),
          gte(agentFlowStates.lastInteractionAt, windowStart),
        ),
      );

    if (activeSdrFlows.length === 0) {
      console.log(`${tag} Nenhuma conversa interrompida para recuperacao.`);
      return;
    }

    console.log(
      `${tag} Encontradas ${activeSdrFlows.length} conversa(s) potencialmente interrompida(s). Verificando...`,
    );
    let recoveredCount = 0;

    for (const flow of activeSdrFlows) {
      // Encaminhamento já pronto tem recuperação transacional própria, inclusive para Meta.
      if (getAiPersona(tenantId).triagePolicy === "industrial" && (flow.metadata as Record<string, unknown>)?.handoffRequest) continue;
      const conversationId = flow.conversationId;
      try {
        const conv = await db.query.conversations.findFirst({
          where: (t, { eq: dEq, and: dAnd }) =>
            dAnd(dEq(t.id, conversationId), dEq(t.tenantId, tenantId)),
        });
        if (!conv) continue;

        // Se ja tem operador alocado ou saiu da automacao, nao interferir
        if (conv.operatorId || conv.queueState === "meus" || conv.queueState === "finalizados") {
          console.log(
            `${tag} Conversa ${conversationId} ja tem operador ou nao esta em automacao. Pulando.`,
          );
          continue;
        }

        // Buscar as ultimas mensagens para ver quem foi o ultimo a falar
        const recentMsgs = await db
          .select()
          .from(messages)
          .where(and(eq(messages.conversationId, conversationId), eq(messages.tenantId, tenantId)))
          .orderBy(desc(messages.sentAt))
          .limit(100);

        if (recentMsgs.length === 0) continue;

        // So recuperar se a ultima mensagem e do CLIENTE (Valentina nao respondeu)
        const lastMsg = recentMsgs[0];
        if (lastMsg.senderType !== "client") {
          console.log(
            `${tag} Conversa ${conversationId}: ultima msg e da Valentina, sem necessidade de recovery.`,
          );
          continue;
        }

        // Coletar mensagens do cliente sem resposta (apos a ultima resposta da Valentina)
        const lastBotMsg = recentMsgs.find((m: any) => m.senderType === "bot");
        const clientMsgsToReprocess = recentMsgs
          .filter((m: any) => {
            if (m.senderType !== "client") return false;
            if (lastBotMsg) return m.sentAt > lastBotMsg.sentAt;
            return true;
          })
          .reverse(); // restaurar ordem cronologica (estava em DESC)

        if (clientMsgsToReprocess.length === 0) continue;

        // Determinar o telefone do contato a partir do contactId
        const [contact] = await db
          .select({ phone: contacts.phone })
          .from(contacts)
          .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, conv.contactId)));
        if (!contact?.phone) continue;
        const contactPhone = contact.phone;

        // Montar batchItems sem binarios de midia (deploy apagou a memoria RAM)
        // SdrEngine usara mediaInterpretation do banco no historico se existir
        const batchItems: QueuedMessageItem[] = clientMsgsToReprocess.map((m: any) => ({
          messageId: m.id,
          text: m.content || "",
          mediaType: "text" as const,
          receivedAt: m.sentAt,
        }));

        console.log(
          `${tag} RECOVERY: Reiniciando conversa ${conversationId} (${contactPhone}) ` +
            `com ${batchItems.length} msg(s) do cliente sem resposta...`,
        );
        recoveredCount++;

        // Chamar SdrEngine diretamente, sem debounce de 15s
        const abortController = new AbortController();
        SdrEngine.getInstance()
          .processBatchMessages(
            tenantId,
            conversationId,
            contactPhone,
            batchItems,
            abortController.signal,
          )
          .then((ok: boolean) => {
            if (ok) {
              console.log(`${tag} SUCESSO no recovery da conversa ${conversationId}.`);
            } else {
              console.log(
                `${tag} Recovery retornou false para ${conversationId} (SDR off, operador ou concluida).`,
              );
            }
          })
          .catch((err: any) => {
            console.error(`${tag} Erro no recovery de ${conversationId}:`, err?.message || err);
          });

        // Pequeno delay entre recoveries para nao sobrecarregar o socket recem-conectado
        await new Promise((r) => setTimeout(r, 1500));
      } catch (convErr: any) {
        console.error(
          `${tag} Erro ao processar conversa ${flow.conversationId}:`,
          convErr?.message,
        );
      }
    }

    console.log(`${tag} Recovery finalizado: ${recoveredCount} conversa(s) reiniciada(s).`);
  } catch (err: any) {
    // Recovery nao pode quebrar o fluxo de inicializacao — falha silenciosa com log
    console.error(`${tag} Erro critico no recovery:`, err?.message || err);
  }
}
