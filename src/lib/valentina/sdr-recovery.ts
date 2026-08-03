import { db } from "../../db";
import { agentFlowStates, conversations, messages } from "../../db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { SdrEngine } from "./sdr-engine";
import type { QueuedMessageItem } from "./sdr-debouncer";

// Janela de recuperacao: so reativa conversas interrompidas nos ultimos 30 minutos.
const RECOVERY_WINDOW_MS = 30 * 60 * 1000;

/**
 * Executa no evento connection.open do Baileys (apos deploy ou reconexao).
 * Detecta triagens SDR interrompidas e as reinicia silenciosamente, sem avisar o cliente.
 * A Valentina continua exatamente de onde parou.
 *
 * Criterios de reativacao:
 *   1. outcome = "in_progress" (triagem nao concluida)
 *   2. lastInteractionAt dentro dos ultimos 30 min
 *   3. Ultima mensagem da conversa eh do cliente (Valentina nao respondeu)
 */
export async function recoverInterruptedConversations(tenantId: string): Promise<void> {
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
          gte(agentFlowStates.lastInteractionAt, windowStart)
        )
      );

    if (activeSdrFlows.length === 0) {
      console.log(`${tag} Nenhuma conversa interrompida para recuperacao.`);
      return;
    }

    console.log(`${tag} Encontradas ${activeSdrFlows.length} conversa(s) potencialmente interrompida(s). Verificando...`);
    let recoveredCount = 0;

    for (const flow of activeSdrFlows) {
      const conversationId = flow.conversationId;
      try {
        const conv = await db.query.conversations.findFirst({
          where: (t: any, { eq: dEq }: any) => dEq(t.id, conversationId),
        });
        if (!conv) continue;

        // Se ja tem operador alocado ou saiu da automacao, nao interferir
        if (conv.operatorId || conv.queueState === "meus" || conv.queueState === "finalizados") {
          console.log(`${tag} Conversa ${conversationId} ja tem operador ou nao esta em automacao. Pulando.`);
          continue;
        }

        // Buscar as ultimas mensagens para ver quem foi o ultimo a falar
        const recentMsgs = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(desc(messages.sentAt))
          .limit(10);

        if (recentMsgs.length === 0) continue;

        // So recuperar se a ultima mensagem e do CLIENTE (Valentina nao respondeu)
        const lastMsg = recentMsgs[0];
        if (lastMsg.senderType !== "client") {
          console.log(`${tag} Conversa ${conversationId}: ultima msg e da Valentina, sem necessidade de recovery.`);
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
        const contactPhone = conv.contactId.startsWith("c-")
          ? conv.contactId.slice(2)
          : conv.contactId;

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
          `com ${batchItems.length} msg(s) do cliente sem resposta...`
        );
        recoveredCount++;

        // Chamar SdrEngine diretamente, sem debounce de 15s
        const abortController = new AbortController();
        SdrEngine.getInstance()
          .processBatchMessages(tenantId, conversationId, contactPhone, batchItems, abortController.signal)
          .then((ok: boolean) => {
            if (ok) {
              console.log(`${tag} SUCESSO no recovery da conversa ${conversationId}.`);
            } else {
              console.log(`${tag} Recovery retornou false para ${conversationId} (SDR off, operador ou concluida).`);
            }
          })
          .catch((err: any) => {
            console.error(`${tag} Erro no recovery de ${conversationId}:`, err?.message || err);
          });

        // Pequeno delay entre recoveries para nao sobrecarregar o socket recem-conectado
        await new Promise((r) => setTimeout(r, 1500));

      } catch (convErr: any) {
        console.error(`${tag} Erro ao processar conversa ${flow.conversationId}:`, convErr?.message);
      }
    }

    console.log(`${tag} Recovery finalizado: ${recoveredCount} conversa(s) reiniciada(s).`);
  } catch (err: any) {
    // Recovery nao pode quebrar o fluxo de inicializacao — falha silenciosa com log
    console.error(`${tag} Erro critico no recovery:`, err?.message || err);
  }
}