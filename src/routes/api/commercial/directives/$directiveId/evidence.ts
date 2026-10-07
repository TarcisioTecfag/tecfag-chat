import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "../../../../../db";
import {
  commercialDirectives,
  commercialEvidence,
  commercialEvidenceMessages,
  crmConversationDeals,
  crmDealActivities,
  crmDealContacts,
  crmDealEmails,
  crmDeals,
  messages,
  voiceCalls,
} from "../../../../../db/schema";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/commercial/directives/$directiveId/evidence")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const permError = requireCrmPermission(session, "canViewCrm");
        if (permError) return permError;
        const [directive] = await db
          .select()
          .from(commercialDirectives)
          .where(
            and(
              eq(commercialDirectives.tenantId, tenantId),
              eq(commercialDirectives.id, params.directiveId),
            ),
          )
          .limit(1);
        if (!directive) return json({ error: "Diretriz não encontrada." }, 404);
        if (
          session.operator.role !== "admin" &&
          directive.assignedToOperatorId !== session.operator.id
        ) {
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        }
        try {
          const [emails, calls, whatsapp, evidence, deal, tasks] = await Promise.all([
            db
              .select({
                id: crmDealEmails.id,
                subject: crmDealEmails.subject,
                sentAt: crmDealEmails.sentAt,
                direction: crmDealEmails.direction,
                isVerified: crmDealEmails.isVerified,
                metadata: crmDealEmails.metadata,
              })
              .from(crmDealEmails)
              .where(
                and(
                  eq(crmDealEmails.tenantId, tenantId),
                  eq(crmDealEmails.dealId, directive.dealId),
                ),
              )
              .orderBy(desc(crmDealEmails.sentAt))
              .limit(30),
            db
              .selectDistinct({
                id: voiceCalls.id,
                startedAt: voiceCalls.startedAt,
                direction: voiceCalls.direction,
                status: voiceCalls.status,
                durationSeconds: voiceCalls.durationSeconds,
              })
              .from(voiceCalls)
              .innerJoin(
                crmDealContacts,
                and(
                  eq(crmDealContacts.contactId, voiceCalls.contactId),
                  eq(crmDealContacts.tenantId, tenantId),
                  eq(crmDealContacts.dealId, directive.dealId),
                ),
              )
              .where(and(eq(voiceCalls.tenantId, tenantId), eq(voiceCalls.status, "completed")))
              .orderBy(desc(voiceCalls.startedAt))
              .limit(30),
            db
              .selectDistinct({
                id: messages.id,
                content: messages.content,
                createdAt: messages.sentAt,
                senderName: messages.senderName,
              })
              .from(messages)
              .innerJoin(
                crmConversationDeals,
                and(
                  eq(crmConversationDeals.conversationId, messages.conversationId),
                  eq(crmConversationDeals.tenantId, tenantId),
                  eq(crmConversationDeals.dealId, directive.dealId),
                  eq(crmConversationDeals.isActive, true),
                ),
              )
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  eq(messages.senderType, "agent"),
                  eq(messages.isInternalNote, false),
                  ne(messages.status, "failed"),
                ),
              )
              .orderBy(desc(messages.sentAt))
              .limit(50),
            db
              .select()
              .from(commercialEvidence)
              .where(
                and(
                  eq(commercialEvidence.tenantId, tenantId),
                  eq(commercialEvidence.directiveId, directive.id),
                ),
              )
              .orderBy(desc(commercialEvidence.createdAt)),
            db
              .select({ status: crmDeals.status, lossReason: crmDeals.lossReason })
              .from(crmDeals)
              .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, directive.dealId)))
              .limit(1),
            db
              .select({
                id: crmDealActivities.id,
                title: crmDealActivities.title,
                dueDate: crmDealActivities.dueDate,
              })
              .from(crmDealActivities)
              .where(
                and(
                  eq(crmDealActivities.tenantId, tenantId),
                  eq(crmDealActivities.dealId, directive.dealId),
                  eq(crmDealActivities.status, "pending"),
                  gte(crmDealActivities.dueDate, new Date()),
                  gte(crmDealActivities.createdAt, directive.createdAt),
                  ne(crmDealActivities.type, "note"),
                ),
              )
              .orderBy(desc(crmDealActivities.createdAt))
              .limit(30),
          ]);
          return json({
            directive: { id: directive.id, status: directive.status, dealId: directive.dealId },
            deal: deal[0] || null,
            tasks,
            emails,
            calls,
            whatsapp,
            evidence,
          });
        } catch (error) {
          console.error("[commercial/evidence] GET:", error);
          return json({ error: "Falha ao carregar evidências." }, 500);
        }
      },
      POST: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const permError = requireCrmPermission(session, "canEditDeals");
        if (permError) return permError;
        try {
          const body = await request.json();
          const channel = body.channel;
          const source = body.source;
          const summary = typeof body.summary === "string" ? body.summary.trim() : "";
          const emailContent =
            typeof body.emailContent === "string" ? body.emailContent.trim() : "";
          const nextAction = body.nextAction;
          const nextActionActivityId =
            typeof body.nextActionActivityId === "string" ? body.nextActionActivityId.trim() : "";
          const callId = typeof body.callId === "string" ? body.callId.trim() : "";
          const emailId = typeof body.emailId === "string" ? body.emailId.trim() : "";
          const messageIds: string[] = Array.isArray(body.messageIds)
            ? [
                ...new Set(
                  (body.messageIds as unknown[]).filter(
                    (item): item is string => typeof item === "string" && Boolean(item.trim()),
                  ),
                ),
              ]
            : [];
          if (
            !["call", "email", "whatsapp"].includes(channel) ||
            !["internal_record", "manual_report"].includes(source) ||
            (channel === "whatsapp" && source !== "internal_record") ||
            summary.length < 3 ||
            summary.length > 2000 ||
            emailContent.length > 20000 ||
            messageIds.length > 20 ||
            !["won", "lost", "continue"].includes(nextAction) ||
            (nextAction === "continue" && !nextActionActivityId) ||
            (source === "internal_record" &&
              ((channel === "call" && !callId) ||
                (channel === "email" && !emailId) ||
                (channel === "whatsapp" && messageIds.length === 0))) ||
            (source === "manual_report" && (callId || emailId || messageIds.length))
          ) {
            return json(
              {
                error:
                  "Informe um canal, a origem e um resumo válido; registros internos exigem seu vínculo.",
              },
              400,
            );
          }
          const result = await db.transaction(async (tx) => {
            const [directive] = await tx
              .select()
              .from(commercialDirectives)
              .where(
                and(
                  eq(commercialDirectives.tenantId, tenantId),
                  eq(commercialDirectives.id, params.directiveId),
                ),
              )
              .for("update")
              .limit(1);
            if (!directive) return { status: 404, error: "Diretriz não encontrada." };
            if (
              session.operator.role !== "admin" &&
              directive.assignedToOperatorId !== session.operator.id
            ) {
              return { status: 403, error: "Permissão insuficiente." };
            }
            if (directive.status !== "pending")
              return { status: 409, error: "Diretriz já concluída ou cancelada." };

            const [deal] = await tx
              .select({ status: crmDeals.status, lossReason: crmDeals.lossReason })
              .from(crmDeals)
              .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, directive.dealId)))
              .for("update")
              .limit(1);
            if (!deal) return { status: 404, error: "Negociação não encontrada neste tenant." };
            if (nextAction === "won" && deal.status !== "won")
              return {
                status: 409,
                error: "Registre o ganho da negociação no CRM antes de concluir.",
              };
            if (nextAction === "lost" && (deal.status !== "lost" || !deal.lossReason?.trim()))
              return {
                status: 409,
                error: "Registre a perda e seu motivo no CRM antes de concluir.",
              };
            if (nextAction === "continue") {
              if (deal.status !== "open")
                return { status: 409, error: "Continuidade exige uma negociação aberta." };
              const [task] = await tx
                .select({ id: crmDealActivities.id })
                .from(crmDealActivities)
                .where(
                  and(
                    eq(crmDealActivities.tenantId, tenantId),
                    eq(crmDealActivities.dealId, directive.dealId),
                    eq(crmDealActivities.id, nextActionActivityId),
                    eq(crmDealActivities.status, "pending"),
                    gte(crmDealActivities.dueDate, new Date()),
                    gte(crmDealActivities.createdAt, directive.createdAt),
                    ne(crmDealActivities.type, "note"),
                  ),
                )
                .for("update")
                .limit(1);
              if (!task)
                return {
                  status: 409,
                  error: "Crie uma tarefa futura nesta negociação antes de concluir.",
                };
            }

            let recordOrigin: string | null = null;
            if (source === "internal_record" && channel === "email") {
              const [email] = await tx
                .select({ id: crmDealEmails.id, metadata: crmDealEmails.metadata })
                .from(crmDealEmails)
                .where(
                  and(
                    eq(crmDealEmails.tenantId, tenantId),
                    eq(crmDealEmails.dealId, directive.dealId),
                    eq(crmDealEmails.id, emailId),
                  ),
                )
                .limit(1);
              if (!email) return { status: 400, error: "E-mail não pertence a esta negociação." };
              recordOrigin =
                (email.metadata as Record<string, unknown>)?.source === "manual"
                  ? "crm_manual"
                  : "crm_record";
            }
            if (source === "internal_record" && channel === "call") {
              const [call] = await tx
                .select({ id: voiceCalls.id })
                .from(voiceCalls)
                .innerJoin(
                  crmDealContacts,
                  and(
                    eq(crmDealContacts.contactId, voiceCalls.contactId),
                    eq(crmDealContacts.tenantId, tenantId),
                    eq(crmDealContacts.dealId, directive.dealId),
                  ),
                )
                .where(
                  and(
                    eq(voiceCalls.tenantId, tenantId),
                    eq(voiceCalls.id, callId),
                    eq(voiceCalls.status, "completed"),
                  ),
                )
                .limit(1);
              if (!call)
                return {
                  status: 400,
                  error: "Ligação não está vinculada aos contatos desta negociação.",
                };
              recordOrigin = "voice_call";
            }
            if (source === "internal_record" && channel === "whatsapp") {
              const linked = await tx
                .selectDistinct({ id: messages.id })
                .from(messages)
                .innerJoin(
                  crmConversationDeals,
                  and(
                    eq(crmConversationDeals.conversationId, messages.conversationId),
                    eq(crmConversationDeals.tenantId, tenantId),
                    eq(crmConversationDeals.dealId, directive.dealId),
                    eq(crmConversationDeals.isActive, true),
                  ),
                )
                .where(
                  and(
                    eq(messages.tenantId, tenantId),
                    inArray(messages.id, messageIds),
                    eq(messages.senderType, "agent"),
                    eq(messages.isInternalNote, false),
                    ne(messages.status, "failed"),
                  ),
                );
              if (linked.length !== messageIds.length)
                return {
                  status: 400,
                  error: "Mensagem não pertence a uma conversa ativa desta negociação.",
                };
              recordOrigin = "conversation_messages";
            }

            const [evidence] = await tx
              .insert(commercialEvidence)
              .values({
                id: crypto.randomUUID(),
                tenantId,
                directiveId: directive.id,
                dealId: directive.dealId,
                operatorId: session.operator.id,
                channel,
                source,
                summary,
                emailContent:
                  source === "manual_report" && channel === "email" ? emailContent || null : null,
                callId: source === "internal_record" && channel === "call" ? callId : null,
                emailId: source === "internal_record" && channel === "email" ? emailId : null,
                metadata: {
                  recordOrigin,
                  nextAction,
                  nextActionActivityId: nextAction === "continue" ? nextActionActivityId : null,
                },
              })
              .returning();
            if (source === "internal_record" && channel === "whatsapp") {
              await tx.insert(commercialEvidenceMessages).values(
                messageIds.map((messageId) => ({
                  id: crypto.randomUUID(),
                  tenantId,
                  evidenceId: evidence.id,
                  messageId,
                })),
              );
            }
            await tx
              .update(commercialDirectives)
              .set({
                status: "completed",
                completionNote: summary,
                completedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(commercialDirectives.tenantId, tenantId),
                  eq(commercialDirectives.id, directive.id),
                ),
              );
            return { status: 201, evidence };
          });
          return "error" in result
            ? json({ error: result.error }, result.status)
            : json({ evidence: result.evidence }, 201);
        } catch (error) {
          console.error("[commercial/evidence] POST:", error);
          return json({ error: "Falha ao concluir diretriz com evidência." }, 500);
        }
      },
    },
  },
});
