import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { conversations, contacts, messages, operators } from "../../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { auditService } from "../../../lib/audit-service";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";

export const Route = createFileRoute("/api/chats/update-queue")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const body = await request.json();
          const { conversationId, queueState, operatorId, sectorId, expectedVersion } = body;

          if (!conversationId || !queueState) {
            return new Response(
              JSON.stringify({ error: "conversationId e queueState são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (expectedVersion === undefined || expectedVersion === null || isNaN(Number(expectedVersion))) {
            return new Response(
              JSON.stringify({ error: "expectedVersion é obrigatório para controle de concorrência otimista" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 1. Verificar conversa existente dentro do tenant da sessão
          const [conv] = await db
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, session.tenantId)
              )
            );

          if (!conv) {
            return new Response(
              JSON.stringify({ error: "Conversa não encontrada para este tenant" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 2. Determinar responsável e persona dinamicamente
          const aiPersona = getAiPersona(session.tenantId);
          const aiName = `${aiPersona.name} IA`;
          const targetOpId = operatorId !== undefined ? operatorId : conv.operatorId;

          let respName = "Na Fila";
          let systemMessageText = "";

          if (queueState === "meus" && targetOpId) {
            const [op] = await db
              .select({ name: operators.name })
              .from(operators)
              .where(
                and(
                  eq(operators.id, targetOpId),
                  eq(operators.tenantId, session.tenantId)
                )
              );
            const opName = op?.name || "Operador";
            respName = opName;
            systemMessageText = `Atendimento assumido por ${opName}.`;
          } else if (queueState === "fila") {
            respName = "Na Fila";
            systemMessageText = `Atendimento devolvido para a Fila de Espera.`;
          } else if (queueState === "finalizados") {
            respName = "Finalizado";
            systemMessageText = `Atendimento encerrado e encaminhado para os Finalizados.`;
          } else if (queueState === "automacao") {
            respName = aiName;
            systemMessageText = `Atendimento direcionado para a Automação (${aiName}).`;
          }

          // 3. Concorrência Atômica com incremento de version dentro de db.transaction
          const updateData: Record<string, any> = {
            queueState,
            responsibleName: respName,
            version: sql`${conversations.version} + 1`,
            updatedAt: new Date(),
          };

          if (operatorId !== undefined) {
            updateData.operatorId = operatorId || null;
          }
          if (sectorId !== undefined) {
            updateData.sectorId = sectorId || null;
          }

          class ConcurrencyConflictError extends Error {
            currentConv: any;
            constructor(currentConv: any) {
              super("Conflito de concorrência detectado");
              this.name = "ConcurrencyConflictError";
              this.currentConv = currentConv;
            }
          }

          let updatedConv: any;
          try {
            updatedConv = await db.transaction(async (tx) => {
              const updatedRows = await tx
                .update(conversations)
                .set(updateData)
                .where(
                  and(
                    eq(conversations.id, conversationId),
                    eq(conversations.tenantId, session.tenantId),
                    eq(conversations.version, Number(expectedVersion))
                  )
                )
                .returning();

              if (updatedRows.length === 0) {
                const [current] = await tx
                  .select()
                  .from(conversations)
                  .where(
                    and(
                      eq(conversations.id, conversationId),
                      eq(conversations.tenantId, session.tenantId)
                    )
                  );
                throw new ConcurrencyConflictError(current);
              }

              const convResult = updatedRows[0];

              // Atualizar responsável no contato atomicamente
              if (convResult.contactId) {
                await tx
                  .update(contacts)
                  .set({ responsibleName: respName })
                  .where(
                    and(
                      eq(contacts.id, convResult.contactId),
                      eq(contacts.tenantId, session.tenantId)
                    )
                  );
              }

              // Gravar mensagem de sistema atômica no histórico
              if (systemMessageText) {
                const messageId = `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                await tx.insert(messages).values({
                  id: messageId,
                  tenantId: session.tenantId,
                  conversationId,
                  senderType: "system",
                  senderName: "Sistema",
                  content: systemMessageText,
                  isInternalNote: true,
                  direction: "outbound",
                  status: "accepted",
                  sentAt: new Date(),
                  updatedAt: new Date(),
                });
              }

              return convResult;
            });
          } catch (err: any) {
            if (err instanceof ConcurrencyConflictError || err?.name === "ConcurrencyConflictError") {
              console.warn(
                `[update-queue] Conflito de concorrência detectado na conversa ${conversationId}. Versão esperada: ${expectedVersion}, atual: ${err.currentConv?.version}`
              );

              return new Response(
                JSON.stringify({
                  error: "Conflito de concorrência: a conversa foi modificada ou capturada por outro atendente.",
                  code: "CONCURRENCY_CONFLICT",
                  current: err.currentConv,
                }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            throw err;
          }

          // 7. Notificar SSE em tempo real para os atendentes conectados deste tenant
          const finalOperatorId = operatorId !== undefined ? operatorId : updatedConv.operatorId ?? null;
          const finalSectorId = sectorId !== undefined ? sectorId : updatedConv.sectorId ?? null;

          SessionManager.getInstance().notifyPublic(session.tenantId, {
            type: "queue_update",
            conversationId,
            queueState,
            operatorId: finalOperatorId,
            sectorId: finalSectorId,
            responsibleName: respName,
            version: updatedConv.version,
          });

          // 8. Se a conversa foi finalizada, enfileira auditoria de IA (apenas Valem no MVP)
          if (queueState === "finalizados" && session.tenantId === "valem") {
            auditService.enqueueAudit({
              tenantId: session.tenantId,
              conversationId,
              operatorId: finalOperatorId,
              contactName: null,
            }).catch((err) =>
              console.error("[update-queue] Erro ao enfileirar auditoria:", err)
            );
          }

          return new Response(
            JSON.stringify({
              success: true,
              conversationId,
              queueState,
              operatorId: finalOperatorId,
              sectorId: finalSectorId,
              responsibleName: respName,
              version: updatedConv.version,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );

        } catch (e: any) {
          console.error("[api/chats/update-queue] Erro ao atualizar fila da conversa:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
